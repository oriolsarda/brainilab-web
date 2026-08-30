/* ===== supabase-config.js ===== */

/*
  BrainiLab Supabase public configuration
  ----------------------------------------
  Publishable browser credentials configured.

  IMPORTANT:
  - The publishable key is safe for browser use.
  - NEVER place a service_role / secret key in this file.
*/
window.BRAINI_SUPABASE = {
  url: "https://wvgcdlxebbybthyuajgb.supabase.co",
  publishableKey: "sb_publishable_8spWjgOq3d5KJsynwrx71Q_h1OJ34b7",
  authRedirectUrl: "",
  passwordResetRedirectUrl: "",
};

/* ===== supabase-auth.js ===== */

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

/* ===== supabase-profile.js ===== */

/*
  BrainiLab Supabase Profile adapter — Step 2 backend
  --------------------------------------------------
  Reads/writes public.profiles for the currently authenticated user.

  Security is enforced by PostgreSQL RLS; this browser module never receives
  service-role credentials.
*/
window.BrainiProfiles = (function(){
  let currentProfile=null;
  let lastError=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  function normalizeCountryCode(value){
    const code=(value||"").trim().toUpperCase();
    if(!code) return null;
    if(!/^[A-Z]{2}$/.test(code)) throw new Error("Use a 2-letter country code, for example ES, US or GB.");
    return code;
  }

  async function currentUserId(){
    const session=await BrainiBackendAuth.getSession();
    return session?.user?.id || null;
  }

  async function fetchMyProfile(){
    if(!configured()) return null;
    const sb=client();
    const uid=await currentUserId();
    if(!uid) return null;

    const {data,error}=await sb
      .from("profiles")
      .select("user_id,display_name,avatar_url,country_code,friend_code,leaderboard_enabled,leaderboard_display_name,created_at,updated_at")
      .eq("user_id",uid)
      .single();

    if(error) throw error;
    currentProfile=data;
    return data;
  }

  async function sync(){
    lastError=null;
    if(!configured()) return null;

    try{
      const profile=await fetchMyProfile();
      if(profile){
        await BrainiData.api.syncCloudProfile(profile);
        window.dispatchEvent(new CustomEvent("brainilab:profilechange",{detail:{profile}}));
      }
      return profile;
    }catch(err){
      lastError=err;
      console.warn("BrainiLab profile sync:",err.message||err);
      return null;
    }
  }


  function validateAvatarFile(file){
    if(!file) throw new Error("Choose an image first.");

    const allowed=new Set([
      "image/jpeg",
      "image/png",
      "image/webp"
    ]);

    if(!allowed.has(file.type)){
      throw new Error("Use a JPG, PNG or WebP image.");
    }

    if(file.size>8*1024*1024){
      throw new Error("Choose an image smaller than 8 MB.");
    }
  }

  function loadBrowserImage(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();

      img.onload=()=>{
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror=()=>{
        URL.revokeObjectURL(url);
        reject(new Error("The selected image could not be opened."));
      };

      img.src=url;
    });
  }

  async function avatarBlob(file){
    validateAvatarFile(file);

    const img=await loadBrowserImage(file);
    const sourceWidth=img.naturalWidth||img.width;
    const sourceHeight=img.naturalHeight||img.height;

    if(!sourceWidth || !sourceHeight){
      throw new Error("The selected image has invalid dimensions.");
    }

    const side=Math.min(sourceWidth,sourceHeight);
    const sx=Math.max(0,(sourceWidth-side)/2);
    const sy=Math.max(0,(sourceHeight-side)/2);

    const canvas=document.createElement("canvas");
    canvas.width=512;
    canvas.height=512;

    const ctx=canvas.getContext("2d");
    if(!ctx) throw new Error("This browser cannot process the image.");

    // JPEG has no alpha channel. A white backing avoids black transparent areas.
    ctx.fillStyle="#ffffff";
    ctx.fillRect(0,0,512,512);
    ctx.drawImage(
      img,
      sx,sy,side,side,
      0,0,512,512
    );

    const blob=await new Promise((resolve,reject)=>{
      canvas.toBlob(
        value=>value?resolve(value):reject(new Error("Could not prepare the profile image.")),
        "image/jpeg",
        .88
      );
    });

    if(blob.size>2*1024*1024){
      throw new Error("The processed avatar is still too large.");
    }

    return blob;
  }

  async function uploadAvatar(file){
    if(!configured()) throw new Error("Supabase is not configured.");

    const sb=client();
    const uid=await currentUserId();
    if(!uid) throw new Error("Sign in before changing your profile photo.");

    const blob=await avatarBlob(file);
    const objectPath=`${uid}/avatar.jpg`;

    const {error:uploadError}=await sb.storage
      .from("brainilab-avatars")
      .upload(
        objectPath,
        blob,
        {
          contentType:"image/jpeg",
          cacheControl:"3600",
          upsert:true
        }
      );

    if(uploadError) throw uploadError;

    const {data}=sb.storage
      .from("brainilab-avatars")
      .getPublicUrl(objectPath);

    if(!data?.publicUrl){
      throw new Error("The profile image URL could not be created.");
    }

    const avatarUrl=`${data.publicUrl}?v=${Date.now()}`;
    return updateMyProfile({avatarUrl});
  }

  async function removeAvatar(){
    if(!configured()) throw new Error("Supabase is not configured.");

    const sb=client();
    const uid=await currentUserId();
    if(!uid) throw new Error("Sign in before changing your profile photo.");

    // Removing a missing object is harmless for the profile flow.
    const {error}=await sb.storage
      .from("brainilab-avatars")
      .remove([`${uid}/avatar.jpg`]);

    if(error && !/not found/i.test(error.message||"")){
      throw error;
    }

    return updateMyProfile({avatarUrl:null});
  }

  async function updateMyProfile(patch={}){
    if(!configured()) throw new Error("Supabase is not configured.");
    const sb=client();
    const uid=await currentUserId();
    if(!uid) throw new Error("Sign in before editing your profile.");

    const payload={};

    if(Object.prototype.hasOwnProperty.call(patch,"displayName")){
      const name=(patch.displayName||"").trim().replace(/\s+/g," ");
      if(name.length<2 || name.length>30) throw new Error("Display name must be between 2 and 30 characters.");
      payload.display_name=name;
    }

    if(Object.prototype.hasOwnProperty.call(patch,"countryCode")){
      payload.country_code=normalizeCountryCode(patch.countryCode);
    }

    if(Object.prototype.hasOwnProperty.call(patch,"avatarUrl")){
      const url=(patch.avatarUrl||"").trim();
      payload.avatar_url=url || null;
    }

    if(Object.prototype.hasOwnProperty.call(patch,"leaderboardEnabled")){
      payload.leaderboard_enabled=!!patch.leaderboardEnabled;
    }

    if(Object.prototype.hasOwnProperty.call(patch,"leaderboardDisplayName")){
      const name=(patch.leaderboardDisplayName||"").trim().replace(/\s+/g," ");
      if(name && (name.length<2 || name.length>30)){
        throw new Error("Ranking display name must be between 2 and 30 characters.");
      }
      payload.leaderboard_display_name=name || null;
    }

    if(!Object.keys(payload).length) return currentProfile;

    const {data,error}=await sb
      .from("profiles")
      .update(payload)
      .eq("user_id",uid)
      .select("user_id,display_name,avatar_url,country_code,friend_code,leaderboard_enabled,leaderboard_display_name,created_at,updated_at")
      .single();

    if(error) throw error;

    currentProfile=data;
    await BrainiData.api.syncCloudProfile(data);
    window.dispatchEvent(new CustomEvent("brainilab:profilechange",{detail:{profile:data}}));
    return data;
  }

  async function setRankingVisibility(enabled,displayName=null){
    return updateMyProfile({
      leaderboardEnabled:enabled,
      leaderboardDisplayName:enabled ? displayName : null
    });
  }

  function getCached(){
    return currentProfile ? JSON.parse(JSON.stringify(currentProfile)) : null;
  }

  function getLastError(){
    return lastError;
  }

  return {
    sync,
    fetchMyProfile,
    updateMyProfile,
    setRankingVisibility,
    uploadAvatar,
    removeAvatar,
    getCached,
    getLastError,
    normalizeCountryCode
  };
})();

/* ===== supabase-games.js ===== */

/*
  BrainiLab Cloud Games — Step 3 backend
  --------------------------------------
  Persists completed game sessions/results through a controlled Supabase RPC.

  Guest/offline behavior:
  - BrainiData records the result locally first.
  - Results created in Step 3 carry a stable clientResultId.
  - If no authenticated Supabase session exists, the result stays pending.
  - After sign-in, syncPendingResults() uploads those same results idempotently.
*/
window.BrainiCloudGames = (function(){
  let syncing=false;
  let lastError=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  function cleanNumber(value){
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function currentPackContext(){
    const params=new URLSearchParams(location.search);
    const difficulty=(params.get("difficulty")||"").toLowerCase();
    const set=Number(params.get("set")||"");

    return {
      difficulty:["easy","medium","hard"].includes(difficulty) ? difficulty : null,
      setNumber:Number.isInteger(set) && set>0 ? set : null
    };
  }

  function compactPayload(result={}){
    const blocked=new Set([
      "id","clientResultId","cloudSyncStatus","cloudSessionId",
      "cloudResultId","cloudSyncedAt","recordedAtStep","results","answerDetails"
    ]);

    const payload={};
    Object.entries(result).forEach(([key,value])=>{
      if(blocked.has(key)) return;
      if(value===undefined) return;

      if(Array.isArray(value)){
        // Keep small game-specific arrays such as BrainiWord pattern.
        if(value.length<=40) payload[key]=value;
        return;
      }

      if(value && typeof value==="object"){
        const txt=JSON.stringify(value);
        if(txt.length<=3000) payload[key]=value;
        return;
      }

      payload[key]=value;
    });

    return payload;
  }

  function correctnessArray(result={}){
    return Array.isArray(result.results)
      ? result.results.slice(0,100).map(v=>typeof v==="boolean"?v:null)
      : [];
  }

  async function currentUser(){
    if(!configured()) return null;
    const session=await BrainiBackendAuth.getSession();
    return session?.user||null;
  }

  async function saveCompletedResult(gameId,result){
    lastError=null;

    if(!configured()) return {saved:false,reason:"not_configured"};
    const user=await currentUser();
    if(!user) return {saved:false,reason:"not_authenticated"};

    if(!result?.clientResultId){
      throw new Error("Missing client result ID.");
    }

    const sb=client();
    const pack=currentPackContext();

    const durationMs=
      Number.isFinite(Number(result.timeSec))
        ? Math.max(0,Math.round(Number(result.timeSec)*1000))
        : Number.isFinite(Number(result.durationMs))
          ? Math.max(0,Math.round(Number(result.durationMs)))
          : null;

    const score=cleanNumber(result.score);
    const correct=cleanNumber(result.correct);
    const total=cleanNumber(result.total);
    const accuracy=cleanNumber(result.accuracy);
    const percentile=cleanNumber(result.percentile);

    const {data,error}=await sb.rpc("submit_brainilab_game_result",{
      p_client_result_id:result.clientResultId,
      p_game_id:gameId,
      p_played_at:result.playedAt||new Date().toISOString(),
      p_score:score===null?null:Math.round(score),
      p_correct_answers:correct===null?null:Math.round(correct),
      p_total_questions:total===null?null:Math.round(total),
      p_accuracy:accuracy,
      p_duration_ms:durationMs,
      p_client_percentile:percentile===null?null:Math.round(percentile),
      p_daily_number:Number.isFinite(Number(result.dailyNumber))?Math.round(Number(result.dailyNumber)):null,
      p_difficulty:result.difficulty||pack.difficulty,
      p_set_number:Number.isFinite(Number(result.setNumber))
        ? Math.round(Number(result.setNumber))
        : pack.setNumber,
      p_result_payload:compactPayload(result),
      p_answer_correctness:correctnessArray(result)
    });

    if(error){
      lastError=error;
      throw error;
    }

    const row=Array.isArray(data)?data[0]:data;
    const cloud={
      sessionId:row?.session_id||null,
      resultId:row?.result_id||null,
      alreadyExisted:!!row?.already_existed
    };

    await BrainiData.api.markResultCloudSynced(result.clientResultId,cloud);

    window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
      detail:{type:"result_synced",gameId,clientResultId:result.clientResultId,cloud}
    }));

    return {saved:true,...cloud};
  }

  async function syncPendingResults(){
    if(syncing || !configured()) return {synced:0,failed:0};
    const user=await currentUser();
    if(!user) return {synced:0,failed:0};

    syncing=true;
    let synced=0;
    let failed=0;

    try{
      const pending=await BrainiData.api.getPendingCloudResults();

      for(const result of pending){
        try{
          const response=await saveCompletedResult(result.gameId,result);
          if(response.saved) synced++;
        }catch(err){
          failed++;
          lastError=err;
          // Keep the result pending. Continue syncing the rest.
          console.warn("BrainiLab pending result sync:",err.message||err);
        }
      }
    }finally{
      syncing=false;
    }

    if(synced){
      window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
        detail:{type:"pending_sync_complete",synced,failed}
      }));
    }

    return {synced,failed};
  }

  async function getMyRecentResults(limit=20){
    if(!configured()) return [];
    const user=await currentUser();
    if(!user) return [];

    const sb=client();
    const safeLimit=Math.min(100,Math.max(1,Number(limit)||20));

    const {data,error}=await sb
      .from("game_sessions")
      .select(`
        id,
        client_result_id,
        game_id,
        difficulty,
        set_number,
        daily_number,
        started_at,
        completed_at,
        game_results (
          id,
          score,
          correct_answers,
          total_questions,
          accuracy,
          duration_ms,
          client_percentile,
          server_verified,
          result_payload
        )
      `)
      .eq("user_id",user.id)
      .order("completed_at",{ascending:false})
      .limit(safeLimit);

    if(error){
      lastError=error;
      throw error;
    }

    return data||[];
  }

  function getLastError(){
    return lastError;
  }

  function isSyncing(){
    return syncing;
  }

  return {
    configured,
    saveCompletedResult,
    syncPendingResults,
    getMyRecentResults,
    getLastError,
    isSyncing
  };
})();

/* ===== supabase-progression.js ===== */

/*
  BrainiLab Cloud Progression — Step 6 backend
  --------------------------------------------
  Reads authoritative progression aggregates from PostgreSQL.

  Cloud authority:
  - current/best streak
  - XP + level
  - total games/questions
  - Full Daily count
  - Daily Brain Score + 4-game breakdown
  - weekly/monthly aggregates
  - personal bests
*/
window.BrainiProgression = (function(){
  let cached=null;
  let lastError=null;
  let syncing=false;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  async function session(){
    if(!configured()) return null;
    return BrainiBackendAuth.getSession();
  }

  async function fetchSummary(){
    const current=await session();
    if(!current?.user) return null;

    const sb=client();
    const {data,error}=await sb.rpc("get_my_brainilab_progression");

    if(error) throw error;
    return data||null;
  }

  async function sync(){
    if(syncing) return cached;
    if(!configured()) return null;

    const current=await session();
    if(!current?.user) return null;

    syncing=true;
    lastError=null;

    try{
      const summary=await fetchSummary();

      if(summary){
        cached=summary;
        await BrainiData.api.syncCloudProgression(summary);

        window.dispatchEvent(new CustomEvent("brainilab:progressionchange",{
          detail:{summary}
        }));
      }

      return summary;
    }catch(err){
      lastError=err;
      console.warn("BrainiLab progression sync:",err.message||err);
      return null;
    }finally{
      syncing=false;
    }
  }

  function getCached(){
    return cached ? JSON.parse(JSON.stringify(cached)) : null;
  }

  function getLastError(){
    return lastError;
  }

  function isSyncing(){
    return syncing;
  }

  return {
    configured,
    fetchSummary,
    sync,
    getCached,
    getLastError,
    isSyncing
  };
})();

/* ===== supabase-runtime.js ===== */

/*
  BrainiLab Runtime Safety Flags — Step 11
  ----------------------------------------
  Public, read-only emergency flags. No service role.
*/
window.BrainiRuntime=(function(){
  let flags={};

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  function get(key){
    return flags[key]||{enabled:true,message:null};
  }

  function has(key){
    return Object.prototype.hasOwnProperty.call(flags,key);
  }

  function routeFlag(){
    const p=location.pathname.replace(/\/+/g,"/");

    if(p.includes("/games/order-up")) return "orderup_enabled";
    if(p.includes("/games/topic-rush")) return "topicrush_enabled";
    if(p.includes("/games/brainiword")) return "brainiword_enabled";
    if(p.includes("/daily-quiz")) return "brainmix_enabled";
    if(p.includes("/rankings")) return "rankings_enabled";
    if(p.includes("/groups")) return "groups_enabled";

    return null;
  }

  function escapeHtml(value){
    return String(value??"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function blockPage(title,message){
    if(document.querySelector("[data-runtime-block]")) return;

    const overlay=document.createElement("div");
    overlay.className="runtime-block";
    overlay.dataset.runtimeBlock="true";
    overlay.innerHTML=`
      <div class="runtime-block-card">
        <img src="/assets/brand/brainilab-logo.png" alt="BrainiLab">
        <div class="auth-kicker">BrainiLab status</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message||"This part of BrainiLab is temporarily unavailable. Please try again soon.")}</p>
        <a href="${new URL("/",location.origin).href}">Back to BrainiLab</a>
      </div>`;
    document.body.appendChild(overlay);
  }

  function apply(){
    if(location.pathname.includes("/admin")) return;

    const maintenance=get("maintenance_enabled");
    if(maintenance.enabled){
      blockPage(
        "Maintenance in progress",
        maintenance.message||"BrainiLab is temporarily under maintenance."
      );
      return;
    }

    const path=location.pathname.replace(/\/+$/,"")||"/";

    if(path==="/"){
      const brainMix=get("brainmix_enabled");
      if(!brainMix.enabled){
        const homeQuiz=document.getElementById("homeQuiz");
        if(homeQuiz){
          homeQuiz.innerHTML=`
            <div class="challenge-inner">
              <div class="challenge-labels">
                <span class="challenge-pill">Daily Brain Challenge</span>
              </div>
              <h1 class="challenge-question">Brain Mix is temporarily unavailable</h1>
              <div class="daily-load-error">
                <span>${escapeHtml(brainMix.message||"Please try again soon. The other Daily Games remain available.")}</span>
                <a class="btn-secondary" href="/games/">Play other games</a>
              </div>
            </div>`;
        }
      }
    }

    const key=routeFlag();
    if(!key) return;

    const state=get(key);
    if(!state.enabled){
      const names={
        brainmix_enabled:"Brain Mix is temporarily unavailable",
        orderup_enabled:"Order Up is temporarily unavailable",
        topicrush_enabled:"Topic Rush is temporarily unavailable",
        brainiword_enabled:"BrainiWord is temporarily unavailable",
        rankings_enabled:"Rankings are temporarily unavailable",
        groups_enabled:"Groups are temporarily unavailable"
      };

      blockPage(
        names[key]||"Temporarily unavailable",
        state.message
      );
    }
  }

  async function load(){
    if(!configured()) return flags;

    try{
      const {data,error}=await client().rpc(
        "get_brainilab_runtime_flags"
      );

      if(error) throw error;
      flags=data||{};
      apply();

      window.dispatchEvent(
        new CustomEvent(
          "brainilab:runtimechange",
          {detail:{flags:{...flags}}}
        )
      );

      return flags;
    }catch(err){
      // Safety flags must never break the public product if the Admin migration
      // has not been installed yet.
      console.warn("BrainiLab runtime flags:",err.message||err);
      return flags;
    }
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",load,{once:true});
  }else{
    queueMicrotask(load);
  }

  return {load,get,has};
})();

/* ===== supabase-monetization.js ===== */

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

/* ===== auth.js ===== */


/*
  BrainiLab Auth UX — production adapter
  --------------------------------------
  Account actions require the configured Supabase Auth backend.
  Guest gameplay remains local-first, but sign-in never fabricates an account.
*/
window.BrainiAuth = (function(){
  let modal=null;
  let currentStep="options";
  let pendingEmail="";
  let emailMode="signup";
  let postAuthTarget=null;

  function toast(msg){
    if(typeof window.showToast==="function"){ window.showToast(msg); return; }
    let t=document.querySelector(".auth-toast");
    if(!t){
      t=document.createElement("div");
      t.className="auth-toast";
      document.body.appendChild(t);
    }
    t.textContent=msg;
    t.classList.add("show");
    setTimeout(()=>t.classList.remove("show"),1700);
  }

  function statsSummary(){
    const p=BrainiData.player();
    return [
      `${p.currentStreak} day streak`,
      `${p.totalGames.toLocaleString()} games`,
      `${p.totalQuestions.toLocaleString()} answers`
    ];
  }

  function ensureModal(){
    if(modal) return modal;
    modal=document.createElement("div");
    modal.className="auth-modal";
    modal.tabIndex=-1;
    modal.innerHTML=`
      <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <button class="auth-close" type="button" aria-label="Close">×</button>
        <div data-auth-view></div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector(".auth-close").onclick=close;
    modal.addEventListener("click",e=>{if(e.target===modal)close()});
    document.addEventListener("keydown",e=>{if(e.key==="Escape" && modal.classList.contains("show")) close()});
    return modal;
  }


  async function requireBackend(){
    if(
      !window.BrainiBackendAuth?.isConfigured?.()
      && window.BrainiPerf?.ensureCloud
    ){
      try{
        await BrainiPerf.ensureCloud();
      }catch(_err){}
    }

    if(!window.BrainiBackendAuth?.isConfigured?.()){
      throw new Error(
        "The sign-in service is temporarily unavailable. Please try again."
      );
    }

    return window.BrainiBackendAuth;
  }

  function optionsView(){
    const stats=statsSummary();
    const signup=emailMode==="signup";
    return `
      <div class="auth-brandmark">B</div>
      <div class="auth-kicker">Free BrainiLab account</div>
      <h2 id="authTitle">Save your progress</h2>
      <p class="auth-lead">Create an account or sign in to connect your BrainiLab identity.</p>

      <div class="auth-keep">
        <div><strong>${stats[0]}</strong><span>kept on device</span></div>
        <div><strong>${stats[1]}</strong><span>kept on device</span></div>
        <div><strong>${stats[2]}</strong><span>kept on device</span></div>
      </div>

      <div class="auth-provider-list">
        <button type="button" class="auth-provider auth-google" data-provider="google">
          <span class="auth-provider-icon">G</span>Continue with Google
        </button>
      </div>

      <div class="auth-divider"><span>or</span></div>

      <div class="auth-email-tabs" role="tablist" aria-label="Email account">
        <button type="button" class="${signup?"active":""}" data-email-mode="signup">Create account</button>
        <button type="button" class="${!signup?"active":""}" data-email-mode="signin">Sign in</button>
      </div>

      <form class="auth-email-form" data-email-form>
        <label for="brainilabAuthEmail">Email</label>
        <input class="auth-full-input" id="brainilabAuthEmail" type="email" autocomplete="email" placeholder="you@example.com" required>

        <label for="brainilabAuthPassword">Password</label>
        <input class="auth-full-input" id="brainilabAuthPassword" type="password" autocomplete="${signup?"new-password":"current-password"}" minlength="8" placeholder="At least 8 characters" required>

        ${signup?`
          <label for="brainilabAuthPasswordConfirm">Confirm password</label>
          <input class="auth-full-input" id="brainilabAuthPasswordConfirm" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat your password" required>
        `:""}

        <button class="auth-primary auth-email-submit" type="submit">${signup?"Create account":"Sign in"}</button>
        ${!signup?`<button type="button" class="auth-forgot" data-forgot-password>Forgot password?</button>`:""}
        <div class="auth-error" data-auth-error></div>
      </form>

      <button type="button" class="auth-not-now" data-auth-not-now>Not now</button>
      <p class="auth-prototype-note">Your account is secured by Supabase. Guest progress stays on this device until you sign in.</p>
    `;
  }

  function emailSentView(){
    const reset=currentStep==="resetSent";
    return `
      <div class="auth-brandmark auth-brandmark-icon">${reset?BrainiIcons.product("refresh","auth-state-icon"):BrainiIcons.product("email","auth-state-icon")}</div>
      <div class="auth-kicker">${reset?"Password reset":"Verify email"}</div>
      <h2 id="authTitle">Check your email</h2>
      <p class="auth-lead">${reset
        ? `If an account exists for <strong>${pendingEmail}</strong>, Supabase will send a password-reset email.`
        : `We sent a confirmation link to <strong>${pendingEmail}</strong>. Open it to activate your BrainiLab account.`
      }</p>
      <button type="button" class="auth-primary" data-back-options>Back to sign in</button>
    `;
  }

  function successView(){
    const p=BrainiData.player();
    const d=BrainiData.daily();
    return `
      <div class="auth-success-icon">${BrainiIcons.product("success","auth-state-icon")}</div>
      <div class="auth-kicker">Progress saved</div>
      <h2 id="authTitle">Your BrainiLab is ready</h2>
      <p class="auth-lead">Your account is active. Your profile, game results and progression can sync securely with BrainiLab.</p>
      <div class="auth-success-stats">
        <div><strong>${BrainiIcons.product("streak","braini-inline-icon")} ${p.currentStreak}</strong><span>day streak</span></div>
        <div><strong>${d.brainScore.toLocaleString()}</strong><span>Daily Brain Score</span></div>
        <div><strong>${p.totalGames.toLocaleString()}</strong><span>games played</span></div>
      </div>
      <div class="auth-success-actions">
        <a class="auth-primary auth-link-btn" data-profile-link href="#">Open My BrainiLab</a>
        <button class="auth-secondary" type="button" data-auth-done>Keep playing</button>
      </div>
    `;
  }

  function render(){
    const m=ensureModal();
    const view=m.querySelector("[data-auth-view]");

    if(currentStep==="emailConfirm" || currentStep==="resetSent") view.innerHTML=emailSentView();
    else if(currentStep==="success") view.innerHTML=successView();
    else view.innerHTML=optionsView();

    if(currentStep==="options"){
      const google=view.querySelector('[data-provider="google"]');
      if(google) google.onclick=()=>providerSignIn("google");

      view.querySelectorAll("[data-email-mode]").forEach(btn=>{
        btn.onclick=()=>{
          emailMode=btn.dataset.emailMode;
          render();
        };
      });

      view.querySelector("[data-auth-not-now]").onclick=close;

      view.querySelector("[data-email-form]").onsubmit=async e=>{
        e.preventDefault();
        const email=view.querySelector("#brainilabAuthEmail").value.trim();
        const password=view.querySelector("#brainilabAuthPassword").value;
        const error=view.querySelector("[data-auth-error]");
        error.textContent="";

        try{
          if(password.length<8) throw new Error("Use a password with at least 8 characters.");

          const backend=await requireBackend();

          if(emailMode==="signup"){
            const confirm=view.querySelector("#brainilabAuthPasswordConfirm")?.value||"";
            if(password!==confirm) throw new Error("Passwords do not match.");

            const data=await backend.signUpWithEmail(email,password);
            pendingEmail=email;

            if(data?.session){
              currentStep="success";
              render();
              hydrateHeader();
              hydrateProfilePage();
            }else{
              currentStep="emailConfirm";
              render();
            }
          }else{
            await backend.signInWithEmail(email,password);
            currentStep="success";
            render();
            hydrateHeader();
            hydrateProfilePage();
            document.querySelectorAll(".save-progress-card").forEach(x=>x.remove());
          }
        }catch(err){
          error.textContent=err.message||"Could not continue.";
        }
      };

      const forgot=view.querySelector("[data-forgot-password]");
      if(forgot){
        forgot.onclick=async()=>{
          const email=view.querySelector("#brainilabAuthEmail").value.trim();
          const error=view.querySelector("[data-auth-error]");
          error.textContent="";
          if(!email){
            error.textContent="Enter your email first.";
            return;
          }
          try{
            const backend=await requireBackend();
            await backend.requestPasswordReset(email);
            pendingEmail=email;
            currentStep="resetSent";
            render();
          }catch(err){
            error.textContent=err.message||"Could not send password reset.";
          }
        };
      }
    }

    if(currentStep==="emailConfirm" || currentStep==="resetSent"){
      view.querySelector("[data-back-options]").onclick=()=>{
        emailMode="signin";
        currentStep="options";
        render();
      };
    }

    if(currentStep==="success"){
      const profile=view.querySelector("[data-profile-link]");
      profile.href=profileUrl();
      profile.onclick=()=>close();
      view.querySelector("[data-auth-done]").onclick=close;
    }
  }

  function profileUrl(){
    // Works from nested static pages.
    const path=location.pathname.replace(/\\/g,"/");
    if(path.includes("/profile/")) return "./";
    const depth=Math.max(0,path.split("/").filter(Boolean).length-1);
    // localhost paths may include a folder prefix, so prefer discovered header link.
    const existing=document.querySelector('a[href*="profile/index.html"]');
    return existing ? existing.getAttribute("href") : "../".repeat(depth)+"profile/index.html";
  }

  async function providerSignIn(provider){
    try{
      if(provider!=="google"){
        throw new Error("This sign-in provider is not available.");
      }
      const backend=await requireBackend();
      await backend.signInWithGoogle();
    }catch(err){
      toast(err.message||"Could not sign in.");
    }
  }

  function open(opts={}){
    postAuthTarget=opts.target||null;
    currentStep="options";
    render();
    modal.classList.add("show");
    modal.focus();
    BrainiData.api.track("auth_prompt_opened",{source:opts.source||"unknown"});
  }

  function close(){
    if(!modal) return;
    modal.classList.remove("show");
  }

  async function hydrateHeader(){
    const auth=await BrainiData.api.getAuthState();
    const p=await BrainiData.api.getPlayer();

    document.querySelectorAll(".nav-right").forEach(nav=>{
      const oldCta=nav.querySelector("[data-auth-cta]");
      if(oldCta) oldCta.remove();

      const avatar=nav.querySelector(".avatar");
      if(avatar){
        if(auth.status==="authenticated"){
          if(p.avatarUrl){
            try{
              const u=new URL(p.avatarUrl,location.origin);
              if(!["https:","http:"].includes(u.protocol)){
                throw new Error("Unsafe avatar URL");
              }

              const img=document.createElement("img");
              img.src=u.href;
              img.alt="";
              avatar.replaceChildren(img);
            }catch(err){
              avatar.textContent=p.avatarInitial||"B";
            }
          }else{
            avatar.textContent=p.avatarInitial||"B";
          }

          avatar.title=(p.displayName||"My BrainiLab")+" · account & stats";
        }else{
          avatar.textContent="B";
          avatar.title="Guest profile & stats";
        }
      }
    });
  }

  function savePromptMarkup(){
    const p=BrainiData.player();
    return `
      <aside class="save-progress-card">
        <div class="save-progress-icon">☁</div>
        <div class="save-progress-copy">
          <strong>Save this progress</strong>
          <span>Keep your ${p.currentStreak}-day streak, scores and personal bests across devices.</span>
        </div>
        <button type="button" data-save-progress>Save progress</button>
      </aside>`;
  }

  async function addSavePrompt(container,source="game_result"){
    if(!container) return;
    const auth=await BrainiData.api.getAuthState();
    if(auth.status==="authenticated" || container.querySelector(".save-progress-card")) return;

    const wrap=document.createElement("div");
    wrap.innerHTML=savePromptMarkup();
    const card=wrap.firstElementChild;
    card.querySelector("[data-save-progress]").onclick=()=>open({source});
    container.appendChild(card);
  }

  async function detectActiveResult(){
    const auth=await BrainiData.api.getAuthState();
    if(auth.status==="authenticated") return;
    setTimeout(()=>{
      const candidates=[
        document.querySelector(".modal.show .result-body"),
        document.querySelector(".quiz-modal.show .quiz-modal-card"),
        document.querySelector(".bw-result.show")
      ].filter(Boolean);
      if(candidates[0]) addSavePrompt(candidates[0],"game_result");
    },80);
  }

  function guestProfileMarkup(){
    const p=BrainiData.player();
    const d=BrainiData.daily();
    return `
      <section class="profile-guest-hero">
        <div>
          <div class="auth-kicker">You’re playing as a guest</div>
          <h1>Your progress already exists.</h1>
          <p>BrainiLab is saving this progress on this browser. Create a free account to establish your BrainiLab identity; cloud game-history syncing is added in the next backend steps.</p>
          <button type="button" class="btn" data-profile-save>Save my progress</button>
          <button type="button" class="btn-light" data-profile-continue>Keep playing as guest</button>
        </div>
        <div class="profile-guest-preview">
          <div><strong>${BrainiIcons.product("streak","braini-inline-icon")} ${p.currentStreak}</strong><span>day streak</span></div>
          <div><strong>${d.brainScore.toLocaleString()}</strong><span>Daily Brain Score</span></div>
          <div><strong>${p.totalGames.toLocaleString()}</strong><span>games played</span></div>
          <div><strong>${p.totalQuestions.toLocaleString()}</strong><span>answers</span></div>
        </div>
      </section>`;
  }

  function accountPanelMarkup(){
    const auth=BrainiData.authState();
    const p=BrainiData.player();
    const lb=auth.leaderboard||{};
    const cloud=!!auth.cloudSync;
    const realAccount=auth.user?.source==="supabase";
    const profileError=window.BrainiProfiles?.getLastError?.();
    const pendingGames=typeof BrainiData.pendingCloudResults==="function"
      ? BrainiData.pendingCloudResults().length
      : 0;
    const cloudGamesReady=!!(
      realAccount &&
      window.BrainiCloudGames &&
      window.BrainiBackendAuth?.isConfigured?.()
    );
    const friendCode=BrainiData.socialState().friendCode||"—";

    let safeAvatarUrl="";
    try{
      if(p.avatarUrl){
        const u=new URL(p.avatarUrl,location.origin);
        if(["https:","http:"].includes(u.protocol)){
          safeAvatarUrl=u.href
            .replaceAll("&","&amp;")
            .replaceAll('"',"&quot;")
            .replaceAll("<","&lt;")
            .replaceAll(">","&gt;");
        }
      }
    }catch(err){}

    return `
      <section class="profile-account-panel">
        <div class="profile-account-head">
          <div class="profile-account-identity">
            <div class="profile-account-avatar profile-edit-avatar ${
              window.BrainiProgressUI
                ? `rank-ring rank-${BrainiProgressUI.tier(p.level||1).key}`
                : ""
            }">
              ${safeAvatarUrl
                ? `<img src="${safeAvatarUrl}" alt="">`
                : (p.avatarInitial||"B")
              }
            </div>
            <div>
              <div class="auth-kicker">Edit Profile</div>
              <h2>${p.displayName}</h2>
              <p>${window.BrainiProgressUI
                ? `${BrainiProgressUI.tier(p.level||1).name} · Level ${p.level||1}`
                : `Level ${p.level||1}`
              }</p>
            </div>
          </div>
          <div class="profile-cloud-badge ${cloud?"synced":""}">
            ${cloud?"☁ Profile synced":realAccount?"⚙ Profile setup needed":"Prototype account"}
          </div>
        </div>

        ${realAccount && !cloud ? `
          <div class="profile-backend-warning">
            <strong>Supabase account connected, profile table pending.</strong>
            <span>Run <code>supabase/step2_profiles.sql</code> in the Supabase SQL Editor, then reload this page.</span>
          </div>
        ` : ""}

        <div class="profile-settings-grid">
          <form data-profile-details-form>
            <label>Display name</label>
            <div class="profile-setting-row">
              <input name="displayName" maxlength="30" value="${(p.displayName||"").replace(/"/g,"&quot;")}" required>
            </div>

            <label>Country</label>
            <div class="profile-setting-row">
              <input name="countryCode" maxlength="2" pattern="[A-Za-z]{2}" value="${(p.countryCode||"").replace(/"/g,"&quot;")}" placeholder="ES">
              <button type="submit">${cloud?"Save profile":"Save locally"}</button>
            </div>
            <small class="profile-field-help">Use the 2-letter country code for now, e.g. ES, US, GB, FR. This powers local rankings.</small>
          </form>

          <div>
            <label>Rankings visibility</label>
            <div class="profile-leaderboard-setting">
              <span>${lb.enabled ? `Visible as <strong>${lb.displayName}</strong>` : "Private by default"}</span>
              <button type="button" data-leaderboard-toggle>${lb.enabled ? "Leave rankings" : "Join rankings"}</button>
            </div>
            <small class="profile-field-help">Public rankings show only your chosen ranking name and country. Your email is never shown.</small>
          </div>
        </div>

        <div class="profile-photo-editor">
          <div class="profile-photo-preview ${
            window.BrainiProgressUI
              ? `rank-ring rank-${BrainiProgressUI.tier(p.level||1).key}`
              : ""
          }">
            ${safeAvatarUrl
              ? `<img src="${safeAvatarUrl}" alt="">`
              : `<span>${p.avatarInitial||"B"}</span>`
            }
          </div>

          <div class="profile-photo-copy">
            <label>Profile photo</label>
            <strong>${p.avatarUrl ? "Change your photo" : "Add a profile photo"}</strong>
            <span>
              JPG, PNG or WebP. BrainiLab crops it square and stores a 512×512 version.
            </span>

            ${realAccount && cloud ? `
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                data-profile-avatar-file
                hidden
              >
              <div class="profile-photo-actions">
                <button type="button" data-profile-avatar-change>
                  ${p.avatarUrl ? "Change photo" : "Upload photo"}
                </button>
                ${p.avatarUrl
                  ? `<button type="button" class="secondary" data-profile-avatar-remove>Remove</button>`
                  : ""
                }
              </div>
            ` : `
              <small class="profile-field-help">
                Sign in with a synced BrainiLab account to upload a custom photo.
              </small>
            `}
          </div>
        </div>
      </section>`;
  }

  async function hydrateProfilePage(){
    const root=document.querySelector("[data-profile-auth-root]");
    const account=document.querySelector("[data-profile-account-root]");
    if(!root && !account) return;

    const auth=await BrainiData.api.getAuthState();

    if(root){
      if(auth.status==="guest"){
        root.innerHTML=guestProfileMarkup();
        root.querySelector("[data-profile-save]").onclick=()=>open({source:"profile"});
        const continueBtn=root.querySelector("[data-profile-continue]");
        if(continueBtn) continueBtn.onclick=()=>window.scrollTo({top:document.body.scrollHeight*.35,behavior:"smooth"});
      }else{
        root.innerHTML="";
      }
    }

    if(account){
      if(auth.status==="authenticated"){
        account.innerHTML=accountPanelMarkup();

        const form=account.querySelector("[data-profile-details-form]");
        form.onsubmit=async e=>{
          e.preventDefault();
          const fd=new FormData(form);
          const displayName=fd.get("displayName");
          const countryCode=fd.get("countryCode");

          try{
            if(
              window.BrainiProfiles &&
              window.BrainiBackendAuth?.isConfigured?.() &&
              BrainiData.authState().user?.source==="supabase"
            ){
              await BrainiProfiles.updateMyProfile({displayName,countryCode});
            }else{
              await BrainiData.api.updatePlayerProfile({
                displayName,
                countryCode:(countryCode||"").trim().toUpperCase()
              });
            }

            toast("Profile updated");
            hydrateProfilePage();
            hydrateHeader();
          }catch(err){
            toast(err.message||"Could not update profile");
          }
        };

        const avatarInput=account.querySelector("[data-profile-avatar-file]");
        const avatarChange=account.querySelector("[data-profile-avatar-change]");
        const avatarRemove=account.querySelector("[data-profile-avatar-remove]");

        if(avatarChange && avatarInput){
          avatarChange.onclick=()=>avatarInput.click();

          avatarInput.onchange=async()=>{
            const file=avatarInput.files?.[0];
            if(!file) return;

            avatarChange.disabled=true;
            const originalLabel=avatarChange.textContent;
            avatarChange.textContent="Uploading…";

            try{
              if(!window.BrainiProfiles?.uploadAvatar){
                throw new Error("Profile photo uploads are not configured yet.");
              }

              await BrainiProfiles.uploadAvatar(file);
              toast("Profile photo updated");
              await hydrateProfilePage();
              hydrateHeader();
            }catch(err){
              toast(err.message||"Could not update profile photo");
              avatarChange.disabled=false;
              avatarChange.textContent=originalLabel;
            }finally{
              avatarInput.value="";
            }
          };
        }

        if(avatarRemove){
          avatarRemove.onclick=async()=>{
            if(!confirm("Remove your current BrainiLab profile photo?")) return;

            avatarRemove.disabled=true;

            try{
              await BrainiProfiles.removeAvatar();
              toast("Profile photo removed");
              await hydrateProfilePage();
              hydrateHeader();
            }catch(err){
              toast(err.message||"Could not remove profile photo");
              avatarRemove.disabled=false;
            }
          };
        }

        const copyFriend=account.querySelector("[data-copy-profile-friend-code]");
        if(copyFriend){
          copyFriend.onclick=async()=>{
            const code=BrainiData.socialState().friendCode;
            try{
              await navigator.clipboard.writeText(code);
              toast("Friend code copied");
            }catch(err){
              toast("Could not copy friend code");
            }
          };
        }

        account.querySelector("[data-leaderboard-toggle]").onclick=async()=>{
          const current=BrainiData.authState().leaderboard;
          const useCloud=(
            window.BrainiProfiles &&
            window.BrainiBackendAuth?.isConfigured?.() &&
            BrainiData.authState().user?.source==="supabase"
          );

          try{
            if(current?.enabled){
              if(useCloud){
                await BrainiProfiles.setRankingVisibility(false,null);
              }else{
                await BrainiData.api.leaveLeaderboard();
              }
              toast("Ranking profile hidden");
            }else{
              const suggestion=BrainiData.player().displayName||"";
              const name=prompt("Choose the public name shown on BrainiLab rankings:",suggestion);
              if(name===null) return;

              if(useCloud){
                await BrainiProfiles.setRankingVisibility(true,name);
              }else{
                await BrainiData.api.joinLeaderboard(name);
              }
              toast("You joined the rankings");
            }
          }catch(err){
            toast(err.message||"Could not update rankings visibility");
          }

          hydrateProfilePage();
          hydrateHeader();
        };


      }else{
        account.innerHTML="";
      }
    }
  }

  async function boot(){
    try{
      if(window.BrainiBackendAuth){
        await BrainiBackendAuth.init();
      }

      if(
        window.BrainiProfiles &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiProfiles.sync();
      }

      if(
        window.BrainiCloudGames &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiCloudGames.syncPendingResults();
      }

      if(
        window.BrainiContent &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiContent.syncPendingVerifications();
      }

      if(
        window.BrainiDaily &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiDaily.syncPendingVerifications();
      }

      if(
        window.BrainiDailyGames &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiDailyGames.syncPendingVerifications();
      }

      if(
        window.BrainiProgression &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiProgression.sync();
      }

      if(
        window.BrainiFriends &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiFriends.refresh();
      }

      if(
        window.BrainiGroups &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiGroups.refresh();
      }
    }catch(err){
      console.warn("BrainiLab Supabase init:",err);
    }

    hydrateHeader();
    hydrateProfilePage();

    window.addEventListener("brainilab:authchange",async()=>{
      if(
        window.BrainiProfiles &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiProfiles.sync();
      }

      if(
        window.BrainiCloudGames &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiCloudGames.syncPendingResults();
      }

      if(
        window.BrainiContent &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiContent.syncPendingVerifications();
      }

      if(
        window.BrainiDaily &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiDaily.syncPendingVerifications();
      }

      if(
        window.BrainiDailyGames &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiDailyGames.syncPendingVerifications();
      }

      if(
        window.BrainiProgression &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiProgression.sync();
      }

      if(
        window.BrainiFriends &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiFriends.refresh();
      }

      if(
        window.BrainiGroups &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiGroups.refresh();
      }

      hydrateHeader();
      hydrateProfilePage();
    });

    window.addEventListener("brainilab:profilechange",()=>{
      hydrateHeader();
      hydrateProfilePage();
    });

    window.addEventListener("brainilab:progressionchange",()=>{
      hydrateHeader();
      hydrateProfilePage();
    });

    window.addEventListener("brainilab:cloudgame",async()=>{
      if(
        window.BrainiDailyGames &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiDailyGames.syncPendingVerifications();
      }

      if(
        window.BrainiProgression &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiProgression.sync();
      }

      if(
        window.BrainiFriends &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiFriends.refresh();
      }

      if(
        window.BrainiGroups &&
        window.BrainiBackendAuth?.isConfigured?.() &&
        BrainiData.isAuthenticated()
      ){
        await BrainiGroups.refresh();
      }
      hydrateProfilePage();
    });

    window.addEventListener("brainilab:datachange",e=>{
      if(e.detail?.type==="game_result") detectActiveResult();
    });

    document.querySelectorAll("[data-open-auth]").forEach(el=>{
      el.addEventListener("click",()=>open({source:el.dataset.openAuth||"button"}));
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",boot,{once:true});
  }else{
    queueMicrotask(boot);
  }

  return {
    open,close,hydrateHeader,hydrateProfilePage,addSavePrompt,detectActiveResult
  };
})();
