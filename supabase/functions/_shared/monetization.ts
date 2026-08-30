import Stripe from "npm:stripe@22.6.0";

export const stripe=new Stripe(
  Deno.env.get("STRIPE_SECRET_KEY")!
);

export function siteUrl(path="/"){
  const base=(
    Deno.env.get("SITE_URL")
    ||""
  ).replace(/\/+$/,"");

  if(!base){
    throw new Error("SITE_URL is not configured");
  }

  return new URL(path,base+"/").href;
}

export function priceForPlan(
  plan:"monthly"|"yearly"
){
  const key=
    plan==="yearly"
      ?"STRIPE_PRICE_YEARLY"
      :"STRIPE_PRICE_MONTHLY";

  const price=Deno.env.get(key);

  if(!price){
    throw new Error(
      `${key} is not configured`
    );
  }

  return price;
}

export function planFromPrice(
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

export function corsHeaders(
  origin:string|null
){
  const site=(
    Deno.env.get("SITE_URL")
    ||""
  ).replace(/\/+$/,"");

  const allowed=
    origin
    && site
    && origin===new URL(site).origin
      ? origin
      : site
        ? new URL(site).origin
        : "";

  return {
    "Access-Control-Allow-Origin":
      allowed||"null",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
      "POST, OPTIONS",
    "Vary":"Origin"
  };
}

export function json(
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
