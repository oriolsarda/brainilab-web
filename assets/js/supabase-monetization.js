/*
  BrainiLab Monetization Backend Adapter — V40.4
  Explicit Supabase-session bridge for Stripe Edge Functions.
*/
window.BrainiMonetizationBackend=(function(){
  let sessionState="checking";

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  function publicConfig(){
    return window.BRAINI_SUPABASE||{};
  }

  function sessionStatus(){
    return sessionState;
  }

  async function ensureInitialized(){
    if(!configured()){
      sessionState="missing";
      return null;
    }

    if(window.BrainiBackendAuth?.init){
      try{
        await BrainiBackendAuth.init();
      }catch(err){
        console.warn(
          "BrainiLab Supabase auth init:",
          err?.message||err
        );
      }
    }

    return client();
  }

  async function session(){
    const sb=await ensureInitialized();

    if(!sb){
      sessionState="missing";
      return null;
    }

    let current=null;

    try{
      current=
        await BrainiBackendAuth.getSession();
    }catch(err){
      console.warn(
        "BrainiLab billing getSession:",
        err?.message||err
      );
    }

    // If a token exists but is very close to expiry, refresh it before billing.
    if(
      current?.refresh_token
      && current?.expires_at
      && (
        Number(current.expires_at)*1000
        - Date.now()
      ) < 60000
    ){
      try{
        const {data,error}=
          await sb.auth.refreshSession();

        if(!error && data?.session){
          current=data.session;
        }
      }catch(err){
        console.warn(
          "BrainiLab billing refreshSession:",
          err?.message||err
        );
      }
    }

    sessionState=
      current?.user
      && current?.access_token
        ?"ready"
        :"missing";

    window.dispatchEvent(
      new CustomEvent(
        "brainilab:billingsession",
        {
          detail:{
            status:sessionState
          }
        }
      )
    );

    return current||null;
  }

  async function getEntitlements(){
    const current=await session();

    if(!current?.user){
      return null;
    }

    const sb=client();

    const {data,error}=await sb.rpc(
      "get_my_brainilab_entitlements"
    );

    if(error) throw error;
    return data||null;
  }

  async function responseMessage(response){
    try{
      const payload=await response.clone().json();

      if(payload?.message){
        return String(payload.message);
      }

      if(payload?.error){
        return String(payload.error);
      }
    }catch(_jsonError){}

    try{
      const text=await response.clone().text();

      if(text?.trim()){
        return text.trim();
      }
    }catch(_textError){}

    return `Billing request failed (${response.status})`;
  }

  async function invoke(name,body={}){
    const current=await session();

    if(
      !current?.user
      || !current?.access_token
    ){
      throw new Error(
        "Your BrainiLab profile is signed in, but the Supabase session token is missing. Sign out, sign in with Google again, and retry."
      );
    }

    const cfg=publicConfig();
    const url=String(cfg.url||"").replace(/\/+$/,"");
    const publishableKey=String(
      cfg.publishableKey||""
    ).trim();

    if(!url || !publishableKey){
      throw new Error(
        "BrainiLab Supabase configuration is incomplete."
      );
    }

    /*
      Explicit auth bridge.
      Do not rely on functions.invoke to infer the caller session:
      - Authorization carries the actual USER access token.
      - apikey carries the project's PUBLIC publishable key.
      The publishable key is never used as a Bearer credential.
    */
    const response=
      await fetch(
        `${url}/functions/v1/${encodeURIComponent(name)}`,
        {
          method:"POST",
          headers:{
            "Authorization":
              `Bearer ${current.access_token}`,

            "apikey":
              publishableKey,

            "Content-Type":
              "application/json"
          },
          body:JSON.stringify(body||{}),
          cache:"no-store"
        }
      );

    if(!response.ok){
      throw new Error(
        await responseMessage(response)
      );
    }

    const data=
      await response
        .json()
        .catch(()=>({}));

    return data||{};
  }

  async function createCheckout(plan){
    const fn=
      window.BRAINI_MONETIZATION_CONFIG
        ?.plus?.checkoutFunction
      ||"create-plus-checkout";

    return invoke(fn,{plan});
  }

  async function createPortal(){
    const fn=
      window.BRAINI_MONETIZATION_CONFIG
        ?.plus?.portalFunction
      ||"create-billing-portal";

    return invoke(fn,{});
  }

  return {
    configured,
    session,
    sessionStatus,
    getEntitlements,
    createCheckout,
    createPortal
  };
})();
