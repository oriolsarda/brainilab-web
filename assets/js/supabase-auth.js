/*
  BrainiLab Supabase Auth adapter — Step 1 backend
  ------------------------------------------------
  Real responsibilities in this step:
  - Supabase session
  - Google OAuth
  - email/password sign-up
  - email/password sign-in
  - sign-out
  - password reset

  Player/profile/game data remains in BrainiData/localStorage until Step 2.
*/
window.BrainiBackendAuth = (function(){
  let client=null;
  let initialized=false;
  let listenerSubscription=null;

  function config(){
    return window.BRAINI_SUPABASE || {};
  }

  function isConfigured(){
    const c=config();
    return /^https:\/\/.+\.supabase\.co$/i.test((c.url||"").trim())
      && (c.publishableKey||"").trim().length>20;
  }

  function getClient(){
    if(client) return client;
    if(!isConfigured()) return null;
    if(!window.supabase || typeof window.supabase.createClient!=="function"){
      throw new Error("Supabase JS did not load. Check your internet connection or the CDN script.");
    }

    const c=config();
    client=window.supabase.createClient(c.url,c.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true
      }
    });
    return client;
  }

  function sameOriginUrl(value,fallbackPath){
    try{
      if(value){
        const candidate=new URL(value,location.origin);

        // Never let a local/dev build jump to a different local origin.
        // This prevents OAuth from returning into an older BrainiLab copy
        // running on another localhost/port.
        if(candidate.origin===location.origin){
          return candidate.href;
        }

        if(!["localhost","127.0.0.1"].includes(location.hostname)){
          return candidate.href;
        }
      }
    }catch(err){}

    return new URL(fallbackPath,location.origin+"/").href;
  }

  function profileRedirectUrl(){
    const c=config();

    if(c.authRedirectUrl){
      return sameOriginUrl(
        c.authRedirectUrl,
        "profile/index.html"
      );
    }

    const profileLink=document.querySelector(
      'a[href*="profile/index.html"],a[href*="/profile/"]'
    );

    if(profileLink){
      const href=new URL(
        profileLink.getAttribute("href"),
        location.href
      );

      // The page that initiated OAuth owns the origin.
      href.protocol=location.protocol;
      href.host=location.host;
      return href.href;
    }

    return new URL(
      "profile/index.html",
      location.origin+"/"
    ).href;
  }

  function passwordResetRedirectUrl(){
    const c=config();

    return sameOriginUrl(
      c.passwordResetRedirectUrl,
      "auth/reset-password/index.html"
    );
  }

  function providerFromUser(user){
    return user?.app_metadata?.provider
      || user?.identities?.[0]?.provider
      || "email";
  }

  async function syncSession(session){
    if(session?.user){
      await BrainiData.api.syncExternalAuthUser(session.user,providerFromUser(session.user));
    }else{
      const local=BrainiData.authState();
      if(local?.status==="authenticated"){
        await BrainiData.api.clearExternalAuthUser();
      }
    }
  }

  async function init(){
    if(initialized) return {configured:isConfigured(),client};
    initialized=true;
    if(!isConfigured()) return {configured:false,client:null};

    const sb=getClient();
    const {data,error}=await sb.auth.getSession();
    if(error) console.warn("BrainiLab Supabase getSession:",error.message);
    await syncSession(data?.session||null);

    const listener=sb.auth.onAuthStateChange((event,session)=>{
      setTimeout(async()=>{
        try{
          await syncSession(session);
          window.dispatchEvent(new CustomEvent("brainilab:backend-auth",{detail:{event,session}}));
        }catch(err){
          console.error("BrainiLab auth sync:",err);
        }
      },0);
    });
    listenerSubscription=listener?.data?.subscription||null;
    return {configured:true,client:sb,session:data?.session||null};
  }

  async function signInWithGoogle(){
    const sb=getClient();
    if(!sb) throw new Error("Supabase is not configured yet.");

    try{
      sessionStorage.setItem(
        "brainilab_oauth_origin",
        location.origin
      );
      sessionStorage.setItem(
        "brainilab_oauth_build",
        window.BRAINI_BUILD||"33"
      );
    }catch(err){}

    const {data,error}=await sb.auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo:profileRedirectUrl()}
    });

    if(error) throw error;
    return data;
  }

  async function signUpWithEmail(email,password){
    const sb=getClient();
    if(!sb) throw new Error("Supabase is not configured yet.");
    const {data,error}=await sb.auth.signUp({
      email:(email||"").trim().toLowerCase(),
      password,
      options:{emailRedirectTo:profileRedirectUrl()}
    });
    if(error) throw error;
    if(data?.session) await syncSession(data.session);
    return data;
  }

  async function signInWithEmail(email,password){
    const sb=getClient();
    if(!sb) throw new Error("Supabase is not configured yet.");
    const {data,error}=await sb.auth.signInWithPassword({
      email:(email||"").trim().toLowerCase(),
      password
    });
    if(error) throw error;
    if(data?.session) await syncSession(data.session);
    return data;
  }

  async function requestPasswordReset(email){
    const sb=getClient();
    if(!sb) throw new Error("Supabase is not configured yet.");
    const {data,error}=await sb.auth.resetPasswordForEmail(
      (email||"").trim().toLowerCase(),
      {redirectTo:passwordResetRedirectUrl()}
    );
    if(error) throw error;
    return data;
  }

  async function updatePassword(password){
    const sb=getClient();
    if(!sb) throw new Error("Supabase is not configured yet.");
    const {data,error}=await sb.auth.updateUser({password});
    if(error) throw error;
    return data;
  }

  async function signOut(){
    const sb=getClient();
    if(!sb){
      await BrainiData.api.clearExternalAuthUser();
      return;
    }
    const {error}=await sb.auth.signOut();
    if(error) throw error;
    await BrainiData.api.clearExternalAuthUser();
  }

  async function getSession(){
    const sb=getClient();
    if(!sb) return null;
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    return data?.session||null;
  }

  function destroy(){
    listenerSubscription?.unsubscribe?.();
    listenerSubscription=null;
    client=null;
    initialized=false;
  }

  return {
    init,isConfigured,getClient,getSession,
    signInWithGoogle,signUpWithEmail,signInWithEmail,
    requestPasswordReset,updatePassword,signOut,
    profileRedirectUrl,passwordResetRedirectUrl,destroy
  };
})();
