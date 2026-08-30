window.BrainiRankings=(function(){
  const state={
    mode:"individual",
    region:"global",
    period:"daily",
    gameId:"all",
    metric:"score",
    expanded:false
  };

  const $=s=>document.querySelector(s);
  let renderToken=0;

  function authState(){
    return BrainiData.authState();
  }

  function cloudConfigured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function countryFlag(code){
    if(!code || code.length!==2) return "🌐";
    return String.fromCodePoint(
      ...code.toUpperCase().split("").map(
        c=>127397+c.charCodeAt()
      )
    );
  }

  function crestHtml(c){
    return BrainiIcons.groupCrest(
      c||{icon:"⚡",color:"#FFD813"},
      "ranking-crest"
    );
  }

  function scoreText(row){
    if(row?.displayValue) return row.displayValue;

    return state.metric==="streak"
      ? `${row?.streak||0} days`
      : Number(row?.score||0).toLocaleString();
  }

  function currentPeriodLabel(){
    if(state.metric==="streak") return "Current";

    return state.period[0].toUpperCase()+state.period.slice(1);
  }

  function syncControls(){
    document.querySelectorAll("[data-ranking-mode]").forEach(b=>{
      b.classList.toggle(
        "active",
        b.dataset.rankingMode===state.mode
      );
    });

    const region=$("#rankingRegion");
    const period=$("#rankingPeriod");
    const game=$("#rankingGame");
    const metric=$("#rankingMetric");

    if(region){
      region.disabled=state.mode==="friends";

      if(state.mode==="friends"){
        state.region="global";
        region.value="global";
      }else{
        region.value=state.region;
      }
    }

    if(period){
      period.disabled=state.metric==="streak";
      period.value=state.period;
    }

    if(game){
      game.disabled=state.metric==="streak";
      game.value=state.gameId;
    }

    if(metric) metric.value=state.metric;
  }

  function updateUrl(){
    const url=new URL(location.href);

    if(state.mode==="individual"){
      url.searchParams.delete("mode");
    }else{
      url.searchParams.set("mode",state.mode);
    }

    if(state.region==="global"){
      url.searchParams.delete("region");
    }else{
      url.searchParams.set("region",state.region);
    }

    if(state.period==="daily"){
      url.searchParams.delete("period");
    }else{
      url.searchParams.set("period",state.period);
    }

    if(state.gameId==="all"){
      url.searchParams.delete("game");
    }else{
      url.searchParams.set("game",state.gameId);
    }

    if(state.metric==="score"){
      url.searchParams.delete("metric");
    }else{
      url.searchParams.set("metric",state.metric);
    }

    history.replaceState(
      {},
      document.title,
      url.pathname+url.search
    );
  }

  function safeAvatarUrl(value){
    try{
      if(!value) return "";
      const url=new URL(value,location.origin);
      if(!["https:","http:"].includes(url.protocol)) return "";
      return url.href
        .replaceAll("&","&amp;")
        .replaceAll('\"',"&quot;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;");
    }catch(err){
      return "";
    }
  }

  function playerAvatar(row,small=false){
    const initial=row?.avatar||row?.name?.[0]||"B";
    const photo=safeAvatarUrl(row?.avatarUrl);

    if(window.BrainiProgressUI){
      const rank=BrainiProgressUI.avatarClass(Number(row?.level||1));
      return `<span class="rank-avatar ${rank} ${small?"small":""}" title="${BrainiProgressUI.tier(Number(row?.level||1)).name} · Level ${Number(row?.level||1)}">
        ${photo
          ? `<img src="${photo}" alt="">`
          : `<span>${String(initial).slice(0,1).toUpperCase()}</span>`
        }
      </span>`;
    }

    return `<span class="ranking-avatar ${small?"small":""}">${photo?`<img src="${photo}" alt="">`:initial}</span>`;
  }

  function podiumCard(row,place){
    const avatar=state.mode==="group"
      ? crestHtml(row.crest)
      : playerAvatar(row,false);

    return `<article class="podium-card ${
      place===1?"first":place===2?"second":"third"
    } ${row.isMe?"is-me":""}">
      <div class="podium-medal">
        ${BrainiIcons.product("medal-achievement","podium-medal-icon")}
        <strong>${place}</strong>
      </div>

      ${avatar}

      <strong class="podium-name">${row.name}</strong>

      <span class="podium-country">
        ${countryFlag(row.country)} ${row.country||""}
      </span>

      <span class="podium-score">${scoreText(row)}</span>

      ${state.mode==="group"
        ? `<small>${row.members||0}/5 members</small>`
        : ""
      }
    </article>`;
  }

  function tableRow(row){
    const identity=state.mode==="group"
      ? `${crestHtml(row.crest)}
         <div>
           <strong>${row.name}</strong>
           <small>
             ${countryFlag(row.country)} ${row.country||""}
             · ${row.members||0}/5 members
           </small>
         </div>`
      : `${playerAvatar(row,true)}
         <div>
           <strong>${row.name}</strong>
           <small>
             ${countryFlag(row.country)} ${row.country||""}
             ${row.level?` · ${BrainiProgressUI?.tier?.(row.level)?.name||"Level"} Lv ${row.level}`:""}
           </small>
         </div>`;

    return `<div class="ranking-row ${
      row.isMe?"is-me":""
    } ${Number(row.rank)<=10?"top-ten":""}">
      <span class="ranking-position">#${row.rank}</span>
      <div class="ranking-identity">${identity}</div>
      <span class="ranking-row-score">${scoreText(row)}</span>
    </div>`;
  }

  function personalRankMarkup(user,visibleRanks,data){
    if(state.mode==="friends") return "";

    const auth=authState();

    if(state.mode==="individual"){
      if(auth.status!=="authenticated") return "";
      if(!data?.leaderboardEnabled) return "";

      if(!user){
        return `<div class="your-rank-card unavailable">
          <div>
            <span>Your ranking</span>
            <strong>—</strong>
          </div>
          <small>
            Play this ${state.metric==="streak"?"Daily challenge":"ranking selection"} to receive a position.
          </small>
        </div>`;
      }
    }

    if(state.mode==="group" && !user){
      return `<div class="your-rank-card unavailable">
        <div>
          <span>Your group ranking</span>
          <strong>—</strong>
        </div>
        <small>
          Your eligible group needs a score in this selection before it receives a position.
        </small>
      </div>`;
    }

    if(!user) return "";
    if(visibleRanks.has(user.rank)) return "";

    if(Number(user.rank)<=1000){
      return `<div class="your-rank-card">
        <div>
          <span>
            ${state.mode==="group"?"Your group":"Your ranking"}
          </span>
          <strong>#${user.rank}</strong>
        </div>

        <div class="your-rank-name">
          ${state.mode==="group"
            ? crestHtml(user.crest)
            : playerAvatar(user,true)
          }
          <b>${user.name}</b>
        </div>

        <span class="your-rank-score">
          ${scoreText(user)}
        </span>
      </div>`;
    }

    return `<div class="your-rank-card unavailable">
      <div>
        <span>
          ${state.mode==="group"
            ? "Your group ranking"
            : "Your ranking"
          }
        </span>
        <strong>—</strong>
      </div>

      <small class="ranking-warning">
        Ranking available from #1000
      </small>
    </div>`;
  }

  function gateMarkup(){
    const auth=authState();

    if(
      state.mode==="friends" &&
      auth.status!=="authenticated"
    ){
      return `<div class="ranking-gate">
        <div>
          <strong>Friends rankings need a BrainiLab account</strong>
          <span>
            Save your progress, connect with friends and compare
            scores and streaks.
          </span>
        </div>
        <button class="btn-secondary" data-rank-auth>
          Sign in
        </button>
      </div>`;
    }

    if(
      state.mode==="group" &&
      auth.status!=="authenticated"
    ){
      return `<div class="ranking-gate">
        <div>
          <strong>Create or join a group to compete together</strong>
          <span>
            Groups can have up to 5 players and rank globally
            or by country.
          </span>
        </div>
        <button class="btn-secondary" data-rank-auth>
          Sign in
        </button>
      </div>`;
    }

    return "";
  }

  function individualPrivacyMarkup(data){
    if(state.mode!=="individual" || !cloudConfigured()){
      return "";
    }

    const auth=authState();

    if(auth.status!=="authenticated"){
      return `<div class="ranking-privacy-card guest">
        <div>
          <strong>Public rankings are opt-in</strong>
          <span>
            You can browse rankings as a guest. Sign in only if
            you want your own public ranking profile.
          </span>
        </div>

        <button class="ranking-privacy-action" data-ranking-signin>
          Sign in to compete
        </button>
      </div>`;
    }

    if(!data?.leaderboardEnabled){
      return `<div class="ranking-privacy-card private">
        <div>
          <strong>Your ranking profile is private</strong>
          <span>
            Join only when you want to appear publicly. Rankings
            show your chosen ranking name and country — never your email.
          </span>
        </div>

        <button class="ranking-privacy-action primary" data-ranking-join>
          Join rankings
        </button>
      </div>`;
    }

    return `<div class="ranking-privacy-card public">
      <div>
        <strong>
          Public as ${data.leaderboardDisplayName||"Braini Player"}
        </strong>
        <span>
          ${data.userEligible
            ? "Your current score is eligible for this ranking."
            : "Your profile is public, but you need a score in this selection to receive a rank."
          }
        </span>
      </div>

      <button class="ranking-privacy-action" data-ranking-hide>
        Hide ranking profile
      </button>
    </div>`;
  }

  function countryRequiredMarkup(){
    if(state.mode==="individual"){
      const signedIn=authState().status==="authenticated";

      return `<div class="ranking-friends-empty">
        <div class="ranking-friends-empty-icon">🌍</div>
        <h2>
          ${signedIn?"Add your country":"Sign in for My country rankings"}
        </h2>
        <p>
          ${signedIn
            ? "Country rankings use the country saved in My BrainiLab. Add a two-letter country to your profile first."
            : "Global rankings are public. My country rankings need a signed-in BrainiLab profile with a country."
          }
        </p>

        ${signedIn
          ? `<a class="btn-secondary" href="../profile/index.html">
               Update profile
             </a>`
          : `<button class="btn-secondary" data-rank-auth>
               Sign in
             </button>`
        }
      </div>`;
    }

    return `<div class="ranking-friends-empty">
      <div class="ranking-friends-empty-icon">🌍</div>
      <h2>Choose a country for your group</h2>
      <p>
        Country Group Rankings require a group country.
        Open your group settings and select one.
      </p>
      <a class="btn-secondary" href="../groups/index.html">
        Edit group
      </a>
    </div>`;
  }

  function rankingEmptyMarkup(data){
    if(state.mode==="individual"){
      return `<div class="ranking-friends-empty ranking-no-scores">
        <div class="ranking-friends-empty-icon">🏆</div>
        <h2>No ranked scores here yet</h2>
        <p>
          Only players who explicitly join public rankings and have
          a score in this selection appear here.
        </p>
      </div>`;
    }

    if(state.mode==="friends"){
      return `<div class="ranking-friends-empty">
        <div class="ranking-friends-empty-icon">🤝</div>
        <h2>Connect with friends to start this ranking</h2>
        <p>
          Your Friends Ranking only contains people you have
          explicitly connected with.
        </p>
        <a class="btn-secondary" href="../profile/index.html#friends">
          Manage friends
        </a>
      </div>`;
    }

    return "";
  }

  function loadingMarkup(){
    return `<div class="ranking-loading" aria-live="polite">
      <span class="ranking-loading-dot"></span>
      <strong>Loading rankings…</strong>
    </div>`;
  }

  function errorMarkup(error){
    return `<div class="ranking-friends-empty ranking-error-state">
      <div class="ranking-friends-empty-icon">↻</div>
      <h2>Rankings could not load</h2>
      <p>
        ${String(error?.message||"The ranking service is temporarily unavailable.")
          .replace(/</g,"&lt;")
          .replace(/>/g,"&gt;")}
      </p>
      <button class="btn-secondary" data-ranking-retry>
        Retry
      </button>
    </div>`;
  }

  async function loadData(){
    const realCloud=cloudConfigured();

    if(
      state.mode==="individual" &&
      realCloud &&
      window.BrainiRankingsCloud
    ){
      return BrainiRankingsCloud.individual(state);
    }

    if(
      state.mode==="friends" &&
      realCloud &&
      window.BrainiFriends &&
      authState().user?.source==="supabase"
    ){
      return BrainiFriends.ranking(state);
    }

    if(
      state.mode==="group" &&
      realCloud &&
      window.BrainiGroups &&
      authState().user?.source==="supabase"
    ){
      return BrainiGroups.ranking(state);
    }

    throw new Error(
      "The ranking service is temporarily unavailable. Please try again."
    );
  }

  async function joinPublicRanking(){
    if(authState().status!=="authenticated"){
      BrainiAuth.open({source:"individual_rankings_join"});
      return;
    }

    const suggestion=BrainiData.player().displayName||"";
    const name=prompt(
      "Choose the public name shown on BrainiLab rankings:",
      suggestion
    );

    if(name===null) return;

    try{
      if(
        window.BrainiProfiles &&
        cloudConfigured() &&
        authState().user?.source==="supabase"
      ){
        await BrainiProfiles.setRankingVisibility(true,name);
      }else{
        await BrainiData.api.joinLeaderboard(name);
      }

      if(window.BrainiProfiles?.sync){
        await BrainiProfiles.sync();
      }

      if(typeof showToast==="function"){
        showToast("You joined the rankings");
      }

      render();
    }catch(err){
      if(typeof showToast==="function"){
        showToast(err.message||"Could not join rankings");
      }
    }
  }

  async function hidePublicRanking(){
    if(!confirm(
      "Hide your public ranking profile? Your game progress will not be deleted."
    )){
      return;
    }

    try{
      if(
        window.BrainiProfiles &&
        cloudConfigured() &&
        authState().user?.source==="supabase"
      ){
        await BrainiProfiles.setRankingVisibility(false,null);
      }else{
        await BrainiData.api.leaveLeaderboard();
      }

      if(window.BrainiProfiles?.sync){
        await BrainiProfiles.sync();
      }

      if(typeof showToast==="function"){
        showToast("Ranking profile hidden");
      }

      render();
    }catch(err){
      if(typeof showToast==="function"){
        showToast(err.message||"Could not update ranking privacy");
      }
    }
  }

  function bindDynamicActions(root){
    root.querySelector("[data-rank-auth]")?.addEventListener(
      "click",
      ()=>BrainiAuth.open({source:"rankings_"+state.mode})
    );

    root.querySelector("[data-ranking-signin]")?.addEventListener(
      "click",
      ()=>BrainiAuth.open({source:"individual_rankings"})
    );

    root.querySelector("[data-ranking-join]")?.addEventListener(
      "click",
      joinPublicRanking
    );

    root.querySelector("[data-ranking-hide]")?.addEventListener(
      "click",
      hidePublicRanking
    );

    root.querySelector("[data-ranking-retry]")?.addEventListener(
      "click",
      render
    );

    root.querySelector("[data-rank-more]")?.addEventListener(
      "click",
      ()=>{
        state.expanded=!state.expanded;
        render();
      }
    );
  }

  async function render(){
    syncControls();

    const root=$("#rankingsRoot");
    if(!root) return;

    const gate=gateMarkup();

    if(gate){
      root.innerHTML=gate;
      bindDynamicActions(root);
      return;
    }

    const token=++renderToken;
    root.innerHTML=loadingMarkup();

    let data;

    try{
      data=await loadData();
    }catch(err){
      if(token!==renderToken) return;
      console.error("BrainiLab Rankings:",err);

      root.innerHTML=errorMarkup(err);
      bindDynamicActions(root);
      return;
    }

    if(token!==renderToken) return;

    data=data||{};
    const rows=data.rows||[];

    if(data.countryRequired){
      root.innerHTML=`
        ${individualPrivacyMarkup(data)}
        ${countryRequiredMarkup()}
      `;
      bindDynamicActions(root);
      return;
    }

    if(state.mode==="friends" && Number(data.totalPlayers||0)<=1){
      root.innerHTML=rankingEmptyMarkup(data);
      bindDynamicActions(root);
      return;
    }

    if(state.mode==="group"){
      const myGroups=data.myGroups||[];

      if(myGroups.length===0){
        root.innerHTML=`
          <div class="ranking-friends-empty">
            <div class="ranking-friends-empty-icon">🛡️</div>
            <h2>Create or join a group first</h2>
            <p>
              Group Rankings are for teams of 3–5 players.
              Create a group, invite friends and compete globally
              or by country.
            </p>
            <a class="btn-secondary" href="../groups/index.html">
              Create a group
            </a>
          </div>`;
        return;
      }

      if(!myGroups.some(g=>g.eligible)){
        const closest=myGroups
          .slice()
          .sort((a,b)=>b.members-a.members)[0];

        const remaining=Math.max(
          0,
          3-(closest?.members||0)
        );

        root.innerHTML=`
          <div class="ranking-friends-empty group-ranking-waiting">
            <div class="ranking-friends-empty-icon">
              ${crestHtml(closest?.crest)}
            </div>
            <h2>Complete your team</h2>
            <p>
              <strong>${closest?.name||"Your group"}</strong>
              has ${closest?.members||0}/3 members required for
              Group Rankings. Invite ${remaining} more
              ${remaining===1?"player":"players"}.
            </p>
            <a class="btn-secondary" href="../groups/index.html">
              Manage group
            </a>
          </div>`;
        return;
      }
    }

    const privacy=individualPrivacyMarkup(data);

    if(rows.length===0){
      root.innerHTML=`
        ${privacy}
        ${rankingEmptyMarkup(data)}
        ${personalRankMarkup(data.user,new Set(),data)}
      `;
      bindDynamicActions(root);
      return;
    }

    const limit=state.expanded?100:10;
    const visible=rows.slice(0,limit);
    const visibleRanks=new Set(
      visible.map(r=>Number(r.rank))
    );

    const podium=rows.slice(0,3);
    const listRows=rows.slice(3,limit);

    root.innerHTML=`
      ${privacy}

      <div class="ranking-summary">
        <div>
          <span>Ranking</span>
          <strong>
            ${state.mode==="friends"
              ? "Friends"
              : state.mode==="group"
                ? "Groups"
                : "Individual"
            }
          </strong>
        </div>

        <div>
          <span>Region</span>
          <strong>
            ${state.mode==="friends"
              ? "Friends only"
              : state.region==="country"
                ? `Country${data.country?` · ${countryFlag(data.country)} ${data.country}`:""}`
                : "Global"
            }
          </strong>
        </div>

        <div>
          <span>Period</span>
          <strong>${currentPeriodLabel()}</strong>
        </div>

        <div>
          <span>Ranked</span>
          <strong>
            ${Number(data.totalPlayers||rows.length).toLocaleString()}
          </strong>
        </div>
      </div>

      <section class="ranking-podium" aria-label="Top 3">
        ${podium.map((r,i)=>podiumCard(r,i+1)).join("")}
      </section>

      ${listRows.length ? `
        <section class="ranking-list">
          <div class="ranking-list-head">
            <span>Rank</span>
            <span>${state.mode==="group"?"Group":"Player"}</span>
            <span>${data.metricLabel||"Score"}</span>
          </div>

          ${listRows.map(tableRow).join("")}
        </section>
      ` : ""}

      ${personalRankMarkup(
        data.user,
        visibleRanks,
        data
      )}

      ${rows.length>10 ? `
        <div class="ranking-more-wrap">
          <button class="ranking-more" data-rank-more>
            ${state.expanded
              ? "Show top 10"
              : "See more · Top 100"
            }
          </button>
        </div>
      ` : ""}
    `;

    bindDynamicActions(root);
  }

  function applyUrlState(){
    const params=new URLSearchParams(location.search);

    const mode=params.get("mode");
    if(["individual","friends","group"].includes(mode)){
      state.mode=mode;
    }

    const region=params.get("region");
    if(["global","country"].includes(region)){
      state.region=region;
    }

    const period=params.get("period");
    if(["daily","weekly","monthly"].includes(period)){
      state.period=period;
    }

    const metric=params.get("metric");
    if(["score","streak"].includes(metric)){
      state.metric=metric;
    }

    const game=params.get("game");
    const gameSelect=$("#rankingGame");

    if(
      game &&
      gameSelect &&
      [...gameSelect.options].some(o=>o.value===game)
    ){
      state.gameId=game;
    }
  }

  function bind(){
    applyUrlState();
    syncControls();

    document.querySelectorAll("[data-ranking-mode]").forEach(b=>{
      b.onclick=()=>{
        state.mode=b.dataset.rankingMode;
        state.expanded=false;

        if(state.mode==="friends"){
          state.region="global";
        }

        updateUrl();
        render();
      };
    });

    [
      ["#rankingRegion","region"],
      ["#rankingPeriod","period"],
      ["#rankingMetric","metric"],
      ["#rankingGame","gameId"]
    ].forEach(([selector,key])=>{
      const el=$(selector);
      if(!el) return;

      el.onchange=()=>{
        state[key]=el.value;
        state.expanded=false;
        updateUrl();
        render();
      };
    });

    window.addEventListener(
      "brainilab:datachange",
      e=>{
        if(
          [
            "leaderboard",
            "profile",
            "game_result",
            "groups_cloud",
            "friends_cloud"
          ].includes(e.detail?.type)
        ){
          render();
        }
      }
    );

    window.addEventListener("brainilab:authchange",render);
    window.addEventListener("brainilab:profilechange",render);
    window.addEventListener("brainilab:progressionchange",render);
    window.addEventListener("brainilab:friendschange",render);
    window.addEventListener("brainilab:groupschange",render);

    render();
  }

  document.addEventListener("DOMContentLoaded",bind);

  return {
    render,
    state
  };
})();
