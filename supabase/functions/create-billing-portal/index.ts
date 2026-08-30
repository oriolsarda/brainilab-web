import {withSupabase} from "npm:@supabase/server@^1";
import {
  stripe,
  siteUrl,
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

      const {
        data:customer,
        error
      }=await ctx.supabaseAdmin
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("user_id",userId)
        .maybeSingle();

      if(error){
        return json(
          {message:"Could not load billing customer"},
          500,
          cors
        );
      }

      if(!customer?.stripe_customer_id){
        return json(
          {message:"No BrainiLab billing account exists yet"},
          404,
          cors
        );
      }

      const session=
        await stripe.billingPortal
          .sessions.create({
            customer:
              customer.stripe_customer_id,
            return_url:
              siteUrl(
                "/profile/?section=settings"
              )
          });

      return json(
        {url:session.url},
        200,
        cors
      );
    }
  )
};
