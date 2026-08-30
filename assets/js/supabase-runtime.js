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
