/*
  BrainiLab My BrainiLab Sections — V27
*/
window.BrainiProfileSections=(function(){
  const valid=["progress","stats","profile","social","settings"];

  function selected(){
    const params=new URLSearchParams(location.search);
    const s=params.get("section")||"progress";
    return valid.includes(s)?s:"progress";
  }

  function show(section,{push=false}={}){
    if(!valid.includes(section)) section="progress";

    document.querySelectorAll("[data-profile-section]").forEach(el=>{
      el.hidden=el.dataset.profileSection!==section;
    });

    document.querySelectorAll("[data-profile-tab]").forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.profileTab===section);
      btn.setAttribute(
        "aria-current",
        btn.dataset.profileTab===section?"page":"false"
      );
    });

    if(push){
      const url=new URL(location.href);
      url.searchParams.set("section",section);
      history.pushState({},document.title,url.pathname+url.search);
    }

    if(section==="progress"){
      hydrateRankHero();
    }

    if(section==="stats" && window.BrainiStatsUI){
      BrainiStatsUI.render();
    }
  }

  function hydrateRankHero(){
    const root=document.querySelector("[data-profile-rank-hero]");
    if(!root || !window.BrainiProgressUI) return;

    const p=BrainiData.player();
    const tier=BrainiProgressUI.tier(p.level||1);
    const progress=BrainiProgressUI.xpProgress(p.level||1,p.xp||0);

    root.innerHTML=`
      <div class="profile-rank-avatar-wrap">
        ${BrainiProgressUI.avatarMarkup(
          p.avatarInitial||"B",
          p.level||1,
          "profile-rank-avatar"
        )}
      </div>
      <div class="profile-rank-main">
        <span>Your Brain Rank</span>
        <h2>${tier.name}</h2>
        <p>Level ${Number(p.level||1)} · ${Number(p.xp||0).toLocaleString()} XP</p>
        <div class="profile-rank-progress"><span style="width:${progress.percent}%"></span></div>
        <small>${progress.label}</small>
      </div>
      <a href="/rankings/" class="profile-rank-link">View rankings →</a>
    `;
  }


  function renderSecurity(){
    const root=document.querySelector("[data-profile-security-root]");
    if(!root) return;

    const auth=BrainiData.authState();
    const p=BrainiData.player();

    if(auth.status!=="authenticated"){
      root.innerHTML=`
        <div class="profile-security-card">
          <h2>Account & Security</h2>
          <p>You are currently playing as a guest on this browser.</p>
          <button class="btn" type="button" data-security-signin>Save my progress</button>
        </div>`;
      root.querySelector("[data-security-signin]")?.addEventListener(
        "click",
        ()=>BrainiAuth.open({source:"profile_security"})
      );
      return;
    }

    root.innerHTML=`
      <div class="profile-security-grid">
        <section class="profile-security-card">
          <span class="profile-settings-kicker">Account</span>
          <h2>Sign-in & security</h2>
          <dl>
            <dt>Email</dt><dd>${auth.user?.email||"—"}</dd>
            <dt>Provider</dt><dd>${auth.provider||"Account"}</dd>
            <dt>Account ID</dt><dd>${auth.user?.id ? auth.user.id.slice(0,8)+"…" : "—"}</dd>
          </dl>
          ${auth.provider==="email"
            ? `<button class="btn-light" type="button" data-security-password>Send password reset email</button>`
            : `<p class="profile-security-note">Password and sign-in security are managed by ${auth.provider==="google"?"Google":"your authentication provider"}.</p>`
          }
        </section>

        <section class="profile-security-card">
          <span class="profile-settings-kicker">Privacy</span>
          <h2>Public identity</h2>
          <p>
            Public rankings are ${auth.leaderboard?.enabled
              ? `<strong>enabled</strong> as ${auth.leaderboard.displayName||p.displayName}`
              : "<strong>private</strong>"
            }.
          </p>
          <a class="btn-light" href="?section=profile">Edit ranking privacy</a>
        </section>

        <section class="profile-security-card">
          <span class="profile-settings-kicker">Session</span>
          <h2>This browser</h2>
          <p>Signing out removes this account session from the browser. Synced progress stays in BrainiLab.</p>
          <button class="auth-signout" type="button" data-security-signout>Sign out</button>
        </section>
      </div>`;

    root.querySelector("[data-security-password]")?.addEventListener(
      "click",
      async()=>{
        try{
          await BrainiBackendAuth.requestPasswordReset(auth.user.email);
          if(typeof showToast==="function") showToast("Password reset email sent");
        }catch(err){
          if(typeof showToast==="function") showToast(err.message||"Could not send reset email");
        }
      }
    );

    root.querySelector("[data-security-signout]")?.addEventListener(
      "click",
      async()=>{
        if(!confirm("Sign out of BrainiLab on this browser?")) return;
        if(window.BrainiBackendAuth?.isConfigured?.()){
          await BrainiBackendAuth.signOut();
        }else{
          await BrainiData.api.signOut();
        }
        location.href="/";
      }
    );
  }

  function bind(){
    document.querySelectorAll("[data-profile-tab]").forEach(btn=>{
      btn.onclick=()=>show(btn.dataset.profileTab,{push:true});
    });

    window.addEventListener("popstate",()=>show(selected()));
    window.addEventListener("brainilab:progressionchange",hydrateRankHero);
    window.addEventListener("brainilab:authchange",renderSecurity);

    show(selected());
    hydrateRankHero();
    renderSecurity();
  }

  document.addEventListener("DOMContentLoaded",bind);

  return {show,hydrateRankHero};
})();
