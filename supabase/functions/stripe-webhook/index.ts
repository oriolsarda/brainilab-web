import Stripe from "npm:stripe@22.6.0";
import {withSupabase} from "npm:@supabase/server@^1";
const stripe=new Stripe(
  Deno.env.get("STRIPE_SECRET_KEY")!
);

function planFromPrice(
  priceId:string|null|undefined
){
  if(
    priceId
    && priceId===Deno.env.get(
      "STRIPE_PRICE_MONTHLY"
    )
  ){
    return "plus_monthly";
  }

  if(
    priceId
    && priceId===Deno.env.get(
      "STRIPE_PRICE_YEARLY"
    )
  ){
    return "plus_yearly";
  }

  return null;
}

function json(
  body:unknown,
  status=200,
  headers:Record<string,string>={}
){
  return Response.json(
    body,
    {
      status,
      headers:{
        "Cache-Control":"no-store",
        ...headers
      }
    }
  );
}

const cryptoProvider=
  Stripe.createSubtleCryptoProvider();

async function resolveUserId(
  subscription:Stripe.Subscription,
  supabaseAdmin:any
){
  const fromMetadata=
    subscription.metadata
      ?.brainilab_user_id;

  if(fromMetadata){
    return String(fromMetadata);
  }

  const customerId=
    typeof subscription.customer==="string"
      ?subscription.customer
      :subscription.customer?.id;

  if(!customerId) return null;

  const {data}=
    await supabaseAdmin
      .from("billing_customers")
      .select("user_id")
      .eq(
        "stripe_customer_id",
        customerId
      )
      .maybeSingle();

  return data?.user_id||null;
}

async function syncSubscription(
  subscription:Stripe.Subscription,
  eventId:string,
  supabaseAdmin:any
){
  const userId=
    await resolveUserId(
      subscription,
      supabaseAdmin
    );

  if(!userId){
    throw new Error(
      `No BrainiLab user for Stripe subscription ${subscription.id}`
    );
  }

  const customerId=
    typeof subscription.customer==="string"
      ?subscription.customer
      :subscription.customer.id;

  const priceId=
    subscription.items
      .data?.[0]
      ?.price?.id||null;

  const plan=
    planFromPrice(priceId);

  const periodEnd=
    subscription.items
      .data?.[0]
      ?.current_period_end
    ?? null;

  const status=
    String(subscription.status);

  const supportedStatus=[
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused"
  ].includes(status)
    ?status
    :"incomplete";

  const {error}=
    await supabaseAdmin
      .from("brainilab_subscriptions")
      .upsert(
        {
          user_id:userId,
          provider:"stripe",
          stripe_customer_id:customerId,
          stripe_subscription_id:
            subscription.id,
          plan,
          status:supportedStatus,
          current_period_end:
            periodEnd
              ?new Date(
                  periodEnd*1000
                ).toISOString()
              :null,
          cancel_at_period_end:
            subscription
              .cancel_at_period_end===true,
          cancel_at:
            subscription.cancel_at
              ?new Date(
                  subscription.cancel_at*1000
                ).toISOString()
              :null,
          canceled_at:
            subscription.canceled_at
              ?new Date(
                  subscription.canceled_at*1000
                ).toISOString()
              :null,
          last_stripe_event_id:eventId,
          updated_at:
            new Date().toISOString()
        },
        {
          onConflict:"user_id"
        }
      );

  if(error){
    throw new Error(
      `Could not sync subscription: ${error.message}`
    );
  }

  const {error:customerError}=
    await supabaseAdmin
      .from("billing_customers")
      .upsert(
        {
          user_id:userId,
          stripe_customer_id:customerId,
          updated_at:
            new Date().toISOString()
        },
        {
          onConflict:"user_id"
        }
      );

  if(customerError){
    throw new Error(
      `Could not sync customer: ${customerError.message}`
    );
  }
}

export default {
  fetch:withSupabase(
    {auth:"none"},
    async(req,ctx)=>{
      if(req.method!=="POST"){
        return json(
          {message:"Method not allowed"},
          405
        );
      }

      const signature=
        req.headers.get(
          "Stripe-Signature"
        );

      const secret=
        Deno.env.get(
          "STRIPE_WEBHOOK_SIGNING_SECRET"
        );

      if(!signature||!secret){
        return json(
          {message:"Missing webhook signature configuration"},
          400
        );
      }

      const body=await req.text();

      let event:Stripe.Event;

      try{
        event=
          await stripe.webhooks
            .constructEventAsync(
              body,
              signature,
              secret,
              undefined,
              cryptoProvider
            );
      }catch(err){
        return json(
          {
            message:
              err instanceof Error
                ?err.message
                :"Invalid Stripe signature"
          },
          400
        );
      }

      const {
        data:existing
      }=await ctx.supabaseAdmin
        .from("stripe_webhook_events")
        .select(
          "processing_status"
        )
        .eq(
          "stripe_event_id",
          event.id
        )
        .maybeSingle();

      if(
        existing?.processing_status
          ==="processed"
      ){
        return json({
          received:true,
          duplicate:true
        });
      }

      await ctx.supabaseAdmin
        .from("stripe_webhook_events")
        .upsert(
          {
            stripe_event_id:event.id,
            event_type:event.type,
            processing_status:"pending",
            processing_error:null,
            received_at:
              new Date().toISOString()
          },
          {
            onConflict:"stripe_event_id"
          }
        );

      try{
        switch(event.type){
          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted":{
            await syncSubscription(
              (event.data.object as Stripe.Subscription),
              event.id,
              ctx.supabaseAdmin
            );
            break;
          }

          case "checkout.session.completed":{
            const session=(event.data.object as Stripe.Checkout.Session);

            const subscriptionId=
              typeof session.subscription
                ==="string"
                ?session.subscription
                :session.subscription?.id;

            if(subscriptionId){
              const subscription=
                await stripe.subscriptions
                  .retrieve(
                    subscriptionId
                  );

              await syncSubscription(
                subscription,
                event.id,
                ctx.supabaseAdmin
              );
            }
            break;
          }

          default:
            // Other Stripe events are acknowledged without
            // changing BrainiLab entitlement state.
            break;
        }

        await ctx.supabaseAdmin
          .from("stripe_webhook_events")
          .update({
            processing_status:"processed",
            processing_error:null,
            processed_at:
              new Date().toISOString()
          })
          .eq(
            "stripe_event_id",
            event.id
          );

        return json({
          received:true
        });
      }catch(err){
        const message=
          err instanceof Error
            ?err.message
            :String(err);

        await ctx.supabaseAdmin
          .from("stripe_webhook_events")
          .update({
            processing_status:"failed",
            processing_error:
              message.slice(0,2000),
            processed_at:
              new Date().toISOString()
          })
          .eq(
            "stripe_event_id",
            event.id
          );

        return json(
          {
            received:false,
            message
          },
          500
        );
      }
    }
  )
};
