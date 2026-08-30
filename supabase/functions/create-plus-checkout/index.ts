import {withSupabase} from "npm:@supabase/server@^1";
import {
  stripe,
  siteUrl,
  priceForPlan,
  corsHeaders,
  json
} from "../_shared/monetization.ts";

export default {
  fetch:withSupabase(
    {auth:"user"},
    async(req,ctx)=>{
      const origin=req.headers.get("Origin");
      const cors=corsHeaders(origin);

      if(req.method==="OPTIONS"){
        return new Response(
          "ok",
          {headers:cors}
        );
      }

      if(req.method!=="POST"){
        return json(
          {message:"Method not allowed"},
          405,
          cors
        );
      }

      const userId=String(
        ctx.userClaims?.id||""
      );

      if(!userId){
        return json(
          {message:"Authentication required"},
          401,
          cors
        );
      }

      const body=await req.json().catch(()=>({}));
      const plan=
        body?.plan==="yearly"
          ?"yearly"
          :"monthly";

      const {
        data:plusFlag,
        error:flagError
      }=await ctx.supabaseAdmin
        .from("runtime_flags")
        .select("enabled")
        .eq("flag_key","plus_enabled")
        .maybeSingle();

      if(flagError){
        return json(
          {message:"Could not read Plus launch status"},
          500,
          cors
        );
      }

      if(plusFlag?.enabled!==true){
        return json(
          {message:"BrainiLab+ is not available yet"},
          409,
          cors
        );
      }

      const {
        data:subscription
      }=await ctx.supabaseAdmin
        .from("brainilab_subscriptions")
        .select(
          "status,plan,stripe_subscription_id"
        )
        .eq("user_id",userId)
        .maybeSingle();

      if(
        subscription
        && ["active","trialing"].includes(
          subscription.status
        )
      ){
        return json(
          {
            message:
              "BrainiLab+ is already active. Use Manage subscription instead."
          },
          409,
          cors
        );
      }

      const {
        data:existingCustomer,
        error:customerReadError
      }=await ctx.supabaseAdmin
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("user_id",userId)
        .maybeSingle();

      if(customerReadError){
        return json(
          {message:"Could not load billing customer"},
          500,
          cors
        );
      }

      let customerId=
        existingCustomer?.stripe_customer_id
        ||null;

      if(!customerId){
        const email=
          typeof ctx.userClaims?.email==="string"
            ?ctx.userClaims.email
            :undefined;

        const customer=
          await stripe.customers.create({
            email,
            metadata:{
              brainilab_user_id:userId
            }
          });

        customerId=customer.id;

        const {error:saveCustomerError}=
          await ctx.supabaseAdmin
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

        if(saveCustomerError){
          return json(
            {message:"Could not save billing customer"},
            500,
            cors
          );
        }
      }

      const priceId=
        priceForPlan(plan);

      const checkout=
        await stripe.checkout.sessions.create({
          mode:"subscription",
          customer:customerId,
          line_items:[
            {
              price:priceId,
              quantity:1
            }
          ],
          allow_promotion_codes:true,

          client_reference_id:userId,

          metadata:{
            brainilab_user_id:userId,
            brainilab_plan:plan
          },

          subscription_data:{
            metadata:{
              brainilab_user_id:userId,
              brainilab_plan:plan
            }
          },

          success_url:
            siteUrl(
              "/plus/?checkout=success"
              +"&session_id={CHECKOUT_SESSION_ID}"
            ),

          cancel_url:
            siteUrl(
              "/plus/?checkout=cancel"
            )
        });

      return json(
        {
          url:checkout.url
        },
        200,
        cors
      );
    }
  )
};
