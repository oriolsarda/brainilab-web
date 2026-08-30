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
