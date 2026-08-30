
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
