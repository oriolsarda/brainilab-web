/*
  BrainiLab Admin V1 — Step 11
  ----------------------------
  Browser uses only the normal Supabase publishable key.
  Every privileged operation is authorized again by PostgreSQL.
*/
window.BrainiAdmin=(function(){
  const state={
    sb:null,
    authSession:null,
    admin:null,
    currentView:"dashboard",
    topics:[],
    questionRows:[],
    poolTab:"brainiword",
    poolHealthSort:"default",
    questionHealthSort:"default",
    analyticsHealthSort:"health_asc",
    contentHealthMap:new Map(),
    lastDailyDate:new Date().toISOString().slice(0,10)
  };

  const titles={
    dashboard:["Operations","Dashboard"],
    daily:["Daily operations","Daily"],
    questions:["Content","Question Bank"],
    content:["Content","Content Pools"],
    analytics:["Gameplay","Game Analytics"],
    users:["Accounts","Users"],
    rankings:["Competition","Rankings"],
    groups:["Social","Groups"],
    suggestions:["Feedback","Suggestions"],
    monetization:["Business","Monetization"],
    system:["Operations","System Health"],
    audit:["Security","Audit Log"]
  };

  const QUESTION_TAG_SUGGESTIONS={
    "general-knowledge":[
      "culture","literature","film-tv","music",
      "language","technology","food","art"
    ],
    "geography":[
      "countries","capitals","flags","landmarks",
      "physical-geography","rivers","mountains","maps","borders"
    ],
    "world-capitals":[
      "capitals","cities","countries","geography"
    ],
    "world-flags":[
      "flags","countries","geography"
    ],
    "science":[
      "biology","chemistry","physics","astronomy",
      "earth-science","medicine","technology","environment"
    ],
    "history":[
      "ancient-history","medieval-history","early-modern",
      "modern-history","wars","leaders","inventions","empires"
    ],
    "sports":[
      "football","basketball","tennis","olympics",
      "motorsport","athletics","records","rules"
    ]
  };

  function qualityMeta(stateName){
    const map={
      healthy:["Healthy","ok"],
      insufficient_sample:["Building sample","info"],
      review_skip_rate:["High skip rate","warn"],
      too_easy:["Too easy","warn"],
      too_hard:["Too hard","warn"],
      weak_distractors:["Weak distractors","warn"]
    };
    return map[stateName]||["No data","info"];
  }

  function qualityBadge(stateName){
    const [label,type]=qualityMeta(stateName);
    return badge(label,type);
  }

  function healthMeta(score,sampleState=""){
    const n=Number(score);
    if(sampleState==="building" || !Number.isFinite(n)) return ["Building sample","info"];
    if(n>=80) return ["Strong","ok"];
    if(n>=60) return ["Healthy","info"];
    if(n>=40) return ["Watch","warn"];
    return ["Poor","bad"];
  }

  function healthBadge(row){
    if(!row) return badge("No sample","info");
    const [label,type]=healthMeta(row.health_score,row.sample_state);
    const score=Number.isFinite(Number(row.health_score))?Math.round(Number(row.health_score)):null;
    return `<div class="admin-quality-cell">${badge(score==null?label:`${score} · ${label}`,type)}<small>${num(row.exposures||0)} exposures · ${row.exit_rate==null?"—":esc(row.exit_rate)+"%"} exit</small></div>`;
  }

  function healthFor(type,id){
    return state.contentHealthMap.get(`${type}:${id}`)||null;
  }

  function sortByHealth(rows,type,mode){
    if(!mode || mode==="default") return rows.slice();
    const dir=mode==="health_desc"?-1:1;
    return rows.slice().sort((a,b)=>{
      const ah=healthFor(type,a.question_version_id||a.id)?.health_score;
      const bh=healthFor(type,b.question_version_id||b.id)?.health_score;
      const av=Number.isFinite(Number(ah))?Number(ah):-1;
      const bv=Number.isFinite(Number(bh))?Number(bh):-1;
      return (av-bv)*dir;
    });
  }

  function addPoolHealthColumn(root,rows,type){
    const table=root.querySelector("table.admin-table");
    if(!table) return;
    const head=table.querySelector("thead tr");
    if(head){
      const th=document.createElement("th");
      th.textContent="Health";
      const last=head.lastElementChild;
      head.insertBefore(th,last||null);
    }
    [...table.querySelectorAll("tbody tr")].forEach((tr,index)=>{
      const row=rows[index];
      const td=document.createElement("td");
      td.innerHTML=healthBadge(row?healthFor(type,row.id):null);
      const last=tr.lastElementChild;
      tr.insertBefore(td,last||null);
    });
  }

  const viewPermission={
    dashboard:"dashboard",
    daily:"daily",
    questions:"questions",
    content:"content",
    analytics:"results",
    users:"users",
    rankings:"rankings",
    groups:"groups",
    suggestions:"suggestions",
    monetization:"system",
    system:"system",
    audit:"audit"
  };

  const $=s=>document.querySelector(s);

  function esc(value){
    return String(value??"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function num(value){
    return Number(value||0).toLocaleString();
  }

  function when(value){
    if(!value) return "—";
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return esc(value);
    return d.toLocaleString();
  }

  function millis(value){
    const n=Number(value);
    if(!Number.isFinite(n)) return "—";
    if(n<1000) return `${Math.round(n)} ms`;
    return `${(n/1000).toFixed(1)} s`;
  }

  function badge(text,type="info"){
    return `<span class="admin-badge ${type}">${esc(text)}</span>`;
  }

  function boolBadge(value,yes="OK",no="Issue"){
    return value?badge(yes,"ok"):badge(no,"bad");
  }

  function toast(message){
    const el=$("#adminToast");
    if(!el) return;
    el.textContent=message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>el.classList.remove("show"),2200);
  }

  function loading(){
    return `<div class="admin-loading">Loading…</div>`;
  }

  function has(permission){
    return !!state.admin?.permissions?.includes(permission);
  }

  function canEditContent(){
    return has("questions") && ["owner","editor"].includes(state.admin?.role);
  }

  function canOperateDaily(){
    return has("daily") && ["owner","editor"].includes(state.admin?.role);
  }

  function isOwner(){
    return state.admin?.role==="owner";
  }

  function cleanError(error){
    return String(
      error?.message
      || error?.details
      || error
      || "Unknown error"
    );
  }

  async function rpc(name,args={}){
    const {data,error}=await state.sb.rpc(name,args);
    if(error) throw error;
    return data;
  }

  function openDrawer(html){
    $("#adminDrawerContent").innerHTML=html;
    $("#adminDrawerBackdrop").hidden=false;
    document.body.style.overflow="hidden";
  }

  function closeDrawer(){
    $("#adminDrawerBackdrop").hidden=true;
    $("#adminDrawerContent").innerHTML="";
    document.body.style.overflow="";
  }

  function copyText(text){
    navigator.clipboard?.writeText(text)
      .then(()=>toast("Copied"))
      .catch(()=>toast("Copy failed"));
  }

  function renderAuth(message,actions=""){
    $("#adminAuthScreen").hidden=false;
    $("#adminShell").hidden=true;
    $("#adminAuthMessage").innerHTML=message;
    $("#adminAuthActions").innerHTML=actions;
  }

  async function signInGoogle(){
    const clean=new URL("./",location.href);
    clean.search="";
    clean.hash="";

    const {error}=await state.sb.auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo:clean.href}
    });

    if(error) throw error;
  }

  async function signOut(){
    await state.sb.auth.signOut();
    state.authSession=null;
    state.admin=null;
    renderAuth(
      "Signed out.",
      `<div class="admin-auth-actions">
        <button class="admin-auth-primary" data-admin-login>Continue with Google</button>
      </div>`
    );
    $("#adminAuthActions [data-admin-login]").onclick=()=>signInGoogle().catch(e=>toast(cleanError(e)));
  }

  async function resolveAccess(){
    const {data:{session},error}=await state.sb.auth.getSession();
    if(error) throw error;

    state.authSession=session||null;

    if(!session?.user){
      renderAuth(
        "Sign in with the Google account that has been authorized as a BrainiLab administrator.",
        `<div class="admin-auth-actions">
          <button class="admin-auth-primary" data-admin-login>Continue with Google</button>
        </div>`
      );

      $("#adminAuthActions [data-admin-login]").onclick=()=>signInGoogle().catch(e=>toast(cleanError(e)));
      return false;
    }

    const admin=await rpc("get_brainilab_admin_session");
    state.admin=admin;

    if(!admin?.admin){
      const uid=session.user.id;
      renderAuth(
        `<div class="admin-auth-denied">
          <strong>This BrainiLab account is authenticated but is not an active admin.</strong>
          <span class="admin-auth-code">${esc(uid)}</span>
          Add this user to <code>public.admin_users</code> from the Supabase SQL Editor. There is intentionally no browser bootstrap button.
        </div>`,
        `<div class="admin-auth-actions">
          <button class="admin-auth-secondary" data-copy-user>Copy user ID</button>
          <button class="admin-auth-secondary" data-admin-signout>Sign out</button>
        </div>`
      );
      $("#adminAuthActions [data-copy-user]").onclick=()=>copyText(uid);
      $("#adminAuthActions [data-admin-signout]").onclick=signOut;
      return false;
    }

    if(admin.require_mfa && !admin.mfa_satisfied){
      renderAuth(
        `<div class="admin-auth-denied">
          <strong>MFA is required for this admin account.</strong>
          Current assurance level: <code>${esc(admin.aal||"aal1")}</code>.
          Complete MFA in Supabase Auth and reload Admin.
        </div>`,
        `<div class="admin-auth-actions">
          <button class="admin-auth-secondary" data-admin-signout>Sign out</button>
        </div>`
      );
      $("#adminAuthActions [data-admin-signout]").onclick=signOut;
      return false;
    }

    $("#adminAuthScreen").hidden=true;
    $("#adminShell").hidden=false;
    $("#adminSessionName").textContent=admin.display_name||"BrainiLab Admin";
    $("#adminSessionRole").textContent=`${admin.role} · ${admin.aal||"aal1"}`;

    configureNavigation();
    return true;
  }

  function configureNavigation(){
    document.querySelectorAll("[data-admin-view]").forEach(btn=>{
      const permission=viewPermission[btn.dataset.adminView];
      btn.hidden=!has(permission);
      btn.onclick=()=>navigate(btn.dataset.adminView);
    });
  }

  function navigate(view,{replace=false}={}){
    if(!titles[view] || !has(viewPermission[view])){
      view="dashboard";
    }

    state.currentView=view;

    if(replace){
      history.replaceState(null,"",`#${view}`);
    }else if(location.hash!==`#${view}`){
      history.pushState(null,"",`#${view}`);
    }

    document.querySelectorAll("[data-admin-view]").forEach(btn=>{
      btn.classList.toggle(
        "active",
        btn.dataset.adminView===view
      );
    });

    const [eyebrow,title]=titles[view];
    $("#adminPageEyebrow").textContent=eyebrow;
    $("#adminPageTitle").textContent=title;

    renderView(view).catch(err=>{
      console.error(err);
      $("#adminContent").innerHTML=`
        <div class="admin-panel">
          <h2>Could not load this admin view</h2>
          <p>${esc(cleanError(err))}</p>
          <button class="admin-button" data-retry>Retry</button>
        </div>`;
      $("#adminContent [data-retry]").onclick=()=>navigate(view,{replace:true});
    });
  }

  async function renderView(view){
    $("#adminContent").innerHTML=loading();

    const renderer={
      dashboard:renderDashboard,
      daily:renderDaily,
      questions:renderQuestions,
      content:renderContent,
      analytics:renderAnalytics,
      users:renderUsers,
      rankings:renderRankings,
      groups:renderGroups,
      suggestions:renderSuggestions,
      monetization:renderMonetization,
      system:renderSystem,
      audit:renderAudit
    }[view];

    if(renderer) await renderer();
  }


  // ==========================================================
  // DASHBOARD
  // ==========================================================

  async function renderDashboard(){
    const [
      d,
      system,
      topicRush,
      topicRushTopics,
      orderUpDaily,
      orderUpRounds,
      connectionsPuzzles,
      oddPuzzles,
      higherPairs,
      numberRoutes,
      sequences
    ]=await Promise.all([
      rpc("admin_get_dashboard"),
      rpc("admin_get_system_health"),
      rpc("admin_get_topic_rush_daily"),
      rpc("admin_list_topic_rush_topics"),
      rpc("admin_get_order_up_daily"),
      rpc("admin_list_order_up_rounds"),
      rpc("admin_list_connections_puzzles"),
      rpc("admin_list_odd_one_out_puzzles"),
      rpc("admin_list_higher_lower_pairs"),
      rpc("admin_list_number_route_puzzles"),
      rpc("admin_list_sequence_puzzles")
    ]);

    const verifiedPct=Number(d.results_today||0)
      ? Math.round(Number(d.answers_verified_today||0)/Number(d.results_today)*1000)/10
      : 0;

    const daily=d.daily||{};
    const dailyHealthy=
      Number(daily.brainmix_questions||0)===10
      && Number(orderUpDaily?.count||0)===2
      && !!topicRush?.topic_id
      && Number(topicRush?.answer_count||0)>=Number(topicRush?.target_count||1)
      && Number(daily.brainiword_words||0)===1;

    const cron=(system.cron||[])[0]||null;

    $("#adminContent").innerHTML=`
      <div class="admin-grid metrics">
        ${metric("Cloud users",d.cloud_users,"Synced BrainiLab accounts")}
        ${metric("Synced results today",d.synced_results_today,"Authenticated cloud results")}
        ${metric("Daily players today",d.cloud_daily_players_today,"Cloud players with ≥1 Daily")}
        ${metric("Full Dailies today",d.full_dailies_today,"All 4 Daily Games")}
        ${metric("Verified answers",`${verifiedPct}%`,"Of today's synced results")}
        ${metric("Public ranking profiles",d.public_ranking_profiles,"Explicit ranking opt-ins")}
        ${metric("Active groups",d.active_groups,`${num(d.eligible_groups)} ranking-eligible`)}
        ${metric("New suggestions",d.new_suggestions,"Feedback inbox")}
      </div>

      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>Daily health</h2>
              <p>${esc(daily.date||d.date||"Today")} · Daily #${esc(daily.daily_number||"—")}</p>
            </div>
            ${dailyHealthy?badge("Healthy","ok"):badge("Needs attention","bad")}
          </div>

          <div class="admin-daily-score">
            ${dailyGameCard("Brain Mix",daily.brainmix_questions,10)}
            ${dailyGameCard("Order Up",orderUpDaily?.count,2)}
            ${dailyGameCard("Topic Rush",topicRush?.topic_id?1:0,1)}
            ${dailyGameCard("BrainiWord",daily.brainiword_words,1)}
          </div>

          <div class="admin-toolbar">
            <button class="admin-button primary" data-open-daily>Open Daily Operations</button>
            ${canOperateDaily()?`<button class="admin-button" data-run-maintenance>Run maintenance</button>`:""}
          </div>
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>System</h2>
              <p>Operational checks, not marketing analytics.</p>
            </div>
          </div>

          <div class="admin-health-list">
            ${healthRow("Future Daily coverage",`${num(d.future_daily_coverage)} ready days`,Number(d.future_daily_coverage)>=7)}
            ${healthRow(
              "Cron",
              cron
                ? `${esc(cron.schedule||"—")} · ${cron.active?"active":"inactive"}${cron.last_status?` · last ${esc(cron.last_status)}`:""}`
                : "Not available",
              !!cron?.active && (!cron?.last_status || cron.last_status==="succeeded")
            )}
            ${healthRow("Question Bank",`${num(d.question_bank?.published_versions)} published`,Number(d.question_bank?.published_versions)>0)}
            ${healthRow("BrainiWord pool",`${num(system.content_pools?.active_brainiword_words)} active`,Number(system.content_pools?.active_brainiword_words)>=61)}
            ${healthRow("Topic Rush pool",`${num((topicRushTopics||[]).filter(x=>x.active).length)} active topics`,(topicRushTopics||[]).filter(x=>x.active).length>=15)}
            ${healthRow("Order Up pool",`${num((orderUpRounds||[]).filter(x=>x.active).length)} active rounds`,(orderUpRounds||[]).filter(x=>x.active).length>=30)}
            ${healthRow("Connections pool",`${num((connectionsPuzzles||[]).filter(x=>x.active).length)} active puzzles`,(connectionsPuzzles||[]).filter(x=>x.active).length>=20)}
            ${healthRow("Odd One Out pool",`${num((oddPuzzles||[]).filter(x=>x.active).length)} active puzzles`,(oddPuzzles||[]).filter(x=>x.active).length>=20)}
            ${healthRow("Higher or Lower pool",`${num((higherPairs||[]).filter(x=>x.active).length)} active pairs`,(higherPairs||[]).filter(x=>x.active).length>=20)}
            ${healthRow("Number Route pool",`${num((numberRoutes||[]).filter(x=>x.active).length)} active routes`,(numberRoutes||[]).filter(x=>x.active).length>=20)}
            ${healthRow("Sequence pool",`${num((sequences||[]).filter(x=>x.active).length)} active sequences`,(sequences||[]).filter(x=>x.active).length>=20)}
            ${healthRow("Math Rush generator","Generated on demand",true)}
          </div>

          <div class="admin-toolbar" style="margin-top:12px">
            <button class="admin-button" data-open-system>Open System Health</button>
            <button class="admin-button" data-open-analytics>Game Analytics</button>
          </div>
        </section>
      </div>

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Question Bank</h2>
            <p>${num(d.question_bank?.questions)} active questions · ${num(d.question_bank?.draft_versions)} drafts/review</p>
          </div>
          ${canEditContent()?`<button class="admin-button primary" data-new-question>+ New question</button>`:""}
        </div>
      </section>
    `;

    $("#adminContent [data-open-daily]").onclick=()=>navigate("daily");
    $("#adminContent [data-open-system]").onclick=()=>navigate("system");
    $("#adminContent [data-open-analytics]")?.addEventListener("click",()=>navigate("analytics"));

    $("#adminContent [data-new-question]")?.addEventListener(
      "click",
      ()=>openQuestionEditor()
    );

    $("#adminContent [data-run-maintenance]")?.addEventListener(
      "click",
      async()=>{
        try{
          await rpc("admin_run_daily_maintenance");
          toast("Daily maintenance completed");
          renderDashboard();
        }catch(err){toast(cleanError(err))}
      }
    );
  }

  function metric(label,value,note){
    return `<div class="admin-metric">
      <span>${esc(label)}</span>
      <strong>${esc(num(value))}</strong>
      <small>${esc(note)}</small>
    </div>`;
  }

  function dailyGameCard(name,value,expected){
    const ok=Number(value||0)===expected;
    return `<div class="admin-daily-game">
      <span>${esc(name)}</span>
      <strong>${num(value)} / ${expected}</strong>
      <small>${ok?"Ready":"Check content"}</small>
    </div>`;
  }

  function healthRow(name,value,ok){
    return `<div class="admin-health-row">
      <div>
        <strong>${esc(name)}</strong>
        <span>${esc(value)}</span>
      </div>
      ${ok?badge("OK","ok"):badge("Check","bad")}
    </div>`;
  }


  // ==========================================================
  // DAILY OPERATIONS
  // ==========================================================

  async function renderDaily(){
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar">
        <div class="admin-field">
          <label>UTC date</label>
          <input class="admin-input" type="date" id="adminDailyDate" value="${esc(state.lastDailyDate)}">
        </div>
        <button class="admin-button primary" id="loadDailyHealth">Load Daily</button>
        <button class="admin-button" id="publicPayloadTest">Test today's public payloads</button>
        ${canOperateDaily()?`<button class="admin-button" id="runDailyMaintenance">Run schedule maintenance</button>`:""}
      </div>
      <div id="dailyHealthBody">${loading()}</div>
      <div id="dailyPayloadBody"></div>
    `;

    $("#loadDailyHealth").onclick=()=>{
      state.lastDailyDate=$("#adminDailyDate").value;
      loadDailyHealth();
    };

    $("#publicPayloadTest").onclick=runPublicPayloadTest;

    $("#runDailyMaintenance")?.addEventListener("click",async()=>{
      try{
        const result=await rpc("admin_run_daily_maintenance");
        toast(`Maintenance: ${result.generated||0} generated, ${result.published||0} published`);
        await loadDailyHealth();
      }catch(err){toast(cleanError(err))}
    });

    await loadDailyHealth();
  }

  async function loadDailyHealth(){
    const body=$("#dailyHealthBody");
    if(!body) return;

    body.innerHTML=loading();

    const date=$("#adminDailyDate")?.value||state.lastDailyDate;
    state.lastDailyDate=date;

    const [h,topicRush,orderUp]=await Promise.all([
      rpc("admin_get_daily_health",{p_date:date}),
      rpc("admin_get_topic_rush_daily",{p_date:date}),
      rpc("admin_get_order_up_daily",{p_date:date})
    ]);

    if(!h?.exists){
      body.innerHTML=`
        <div class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>${esc(date)}</h2>
              <p>Daily challenge does not exist.</p>
            </div>
            ${badge("Missing","bad")}
          </div>
          ${canOperateDaily()?`<button class="admin-button primary" data-regenerate>Create this Daily</button>`:""}
        </div>`;

      body.querySelector("[data-regenerate]")?.addEventListener("click",()=>regenerateDaily(date));
      return;
    }

    const locked=!!h.content_locked;
    const today=new Date().toISOString().slice(0,10);
    const futureOnly=String(h.date)>today;
    const canRegenerate=!locked && futureOnly;
    const topicRushReady=!!topicRush?.topic_id
      && Number(topicRush?.answer_count||0)>=Number(topicRush?.target_count||1);
    const dailyHealthy=Number(h.brainmix?.count||0)===10
      && Number(h.brainmix?.easy||0)===4
      && Number(h.brainmix?.medium||0)===4
      && Number(h.brainmix?.hard||0)===2
      && Number(orderUp?.count||0)===2
      && topicRushReady
      && Number(h.brainiword?.count||0)===1;

    body.innerHTML=`
      <section class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>Daily #${esc(h.daily_number)} · ${esc(h.date)}</h2>
            <p>Generation v${esc(h.generation_version)} · ${num(h.completed_sessions)} completed cloud sessions</p>
          </div>
          <div>
            ${dailyHealthy?badge("Healthy","ok"):badge("Needs attention","bad")}
            ${locked?badge("Content locked","warn"):badge("Unplayed","info")}
            ${badge(h.status||"—",h.status==="published"?"ok":"info")}
          </div>
        </div>

        <div class="admin-daily-score">
          ${dailyGameCard("Brain Mix",h.brainmix?.count,10)}
          ${dailyGameCard("Order Up",orderUp?.count,2)}
          ${dailyGameCard("Topic Rush",topicRush?.topic_id?1:0,1)}
          ${dailyGameCard("BrainiWord",h.brainiword?.count,1)}
        </div>

        <div class="admin-mini-grid">
          <div class="admin-mini-card"><span>Easy</span><strong>${num(h.brainmix?.easy)}</strong></div>
          <div class="admin-mini-card"><span>Medium</span><strong>${num(h.brainmix?.medium)}</strong></div>
          <div class="admin-mini-card"><span>Hard</span><strong>${num(h.brainmix?.hard)}</strong></div>
        </div>

        ${canOperateDaily()?`
          <div class="admin-toolbar" style="margin-top:12px">
            <button
              class="admin-button danger"
              data-regenerate
              ${canRegenerate?"":"disabled"}
              title="${locked
                ?"Completed sessions exist; content is immutable."
                :!futureOnly
                  ?"Admin V1 regenerates future Daily content only."
                  :""
              }"
            >Regenerate full Daily</button>
          </div>
          ${locked
            ?`<div class="admin-note admin-danger-note">This Daily cannot be regenerated because players have already completed sessions against it.</div>`
            :!futureOnly
              ?`<div class="admin-note">Today/past content is intentionally not regenerated from Admin because guest activity cannot be fully observed. Disable the affected game with a runtime flag if an emergency occurs.</div>`
              :""
          }
        `:""}
      </section>

      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Brain Mix</h2><p>4 Easy · 4 Medium · 2 Hard</p></div></div>
          <div class="admin-question-list">
            ${(h.brainmix?.questions||[]).map(q=>`
              <div class="admin-question-item">
                <span class="pos">${esc(q.position)}</span>
                <div>
                  <strong>${esc(q.prompt)}</strong>
                  <small>${esc(q.topic)} · ${esc(q.difficulty)}</small>
                </div>
                ${badge(q.difficulty,"info")}
                <button class="admin-button" data-open-q="${esc(q.question_version_id)}">Open</button>
              </div>`).join("")}
          </div>
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>BrainiWord</h2><p>Secret is visible only inside Admin.</p></div></div>
          <div class="admin-mini-card"><span>Today's word</span><strong class="admin-code">${esc(h.brainiword?.word||"—")}</strong></div>
          <div class="admin-panel-head" style="margin-top:15px"><div><h2>Generated</h2></div></div>
          <dl class="admin-kv">
            <dt>Generated</dt><dd>${when(h.generated_at)}</dd>
            <dt>Published</dt><dd>${when(h.published_at)}</dd>
            <dt>Status</dt><dd>${esc(h.status)}</dd>
          </dl>
        </section>
      </div>

      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>Order Up</h2>
              <p>2 rounds · 10 ordered items each.</p>
            </div>
          </div>

          ${(orderUp?.rounds||[]).map(round=>`
            <div class="admin-mini-card" style="margin-bottom:9px">
              <span>Round ${esc(round.position)} · ${esc(round.direction_label)}</span>
              <strong>${esc(round.title)}</strong>
              <small>${esc(round.prompt)}</small>
            </div>

            <div class="admin-question-list" style="margin-bottom:13px">
              ${(round.items||[]).map(item=>`
                <div class="admin-question-item">
                  <span class="pos">${esc(item.position)}</span>
                  <div><strong>${esc(item.label)}</strong></div>
                  <span></span><span></span>
                </div>`).join("")}
            </div>
          `).join("") || `<div class="admin-empty">Order Up is not assigned for this Daily.</div>`}
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Topic Rush</h2><p>60-second free-response Daily.</p></div></div>
          ${topicRush?.topic_id?`
            <div class="admin-mini-card"><span>Topic</span><strong>${esc(topicRush.title)}</strong></div>
            <dl class="admin-kv" style="margin-top:10px">
              <dt>Prompt</dt><dd>${esc(topicRush.prompt)}</dd>
              <dt>Daily target</dt><dd>${num(topicRush.target_count)}</dd>
              <dt>Accepted answers</dt><dd>${num(topicRush.answer_count)}</dd>
              <dt>Duration</dt><dd>${num(topicRush.duration_seconds)} seconds</dd>
            </dl>
          `:`<div class="admin-empty">Topic Rush is not assigned for this Daily.</div>`}
        </section>
      </div>
    `;

    body.querySelector("[data-regenerate]")?.addEventListener("click",()=>regenerateDaily(date));
    body.querySelectorAll("[data-open-q]").forEach(btn=>{
      btn.onclick=()=>openQuestionEditor(btn.dataset.openQ);
    });
  }

  async function regenerateDaily(date){
    if(!confirm(
      `Regenerate the full Daily for ${date}? This is allowed only before any completed session exists.`
    )) return;

    try{
      await rpc("admin_regenerate_brainilab_daily",{p_date:date});
      toast("Daily regenerated");
      await loadDailyHealth();
    }catch(err){
      toast(cleanError(err));
    }
  }

  function scanForbiddenKeys(value,path="",found=[]){
    const forbidden=new Set([
      "is_correct",
      "correct_option_id",
      "correct_answer",
      "correct_country_id",
      "correct_order",
      "sort_position",
      "explanation",
      "answer",
      "word"
    ]);

    if(Array.isArray(value)){
      value.forEach((v,i)=>scanForbiddenKeys(v,`${path}[${i}]`,found));
      return found;
    }

    if(value && typeof value==="object"){
      Object.entries(value).forEach(([key,v])=>{
        const next=path?`${path}.${key}`:key;
        if(forbidden.has(key)) found.push(next);
        scanForbiddenKeys(v,next,found);
      });
    }

    return found;
  }

  async function runPublicPayloadTest(){
    const out=$("#dailyPayloadBody");
    out.innerHTML=`
      <section class="admin-panel" style="margin-top:14px">
        <h2>Public payload test</h2>
        ${loading()}
      </section>`;

    const calls=[
      ["Brain Mix","get_brainilab_daily_challenge"],
      ["Order Up","get_brainilab_daily_order_up"],
      ["Topic Rush","get_brainilab_daily_topic_rush"],
      ["BrainiWord","get_brainilab_daily_brainiword"]
    ];

    const rows=[];

    for(const [label,fn] of calls){
      try{
        const payload=await rpc(fn);
        const leaks=scanForbiddenKeys(payload);
        rows.push({label,ok:!!payload && leaks.length===0,leaks,hasPayload:!!payload});
      }catch(err){
        rows.push({label,ok:false,leaks:[cleanError(err)],hasPayload:false});
      }
    }

    out.innerHTML=`
      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Today's public payload test</h2>
            <p>Checks the same initial RPCs used by players for answer/secret leakage.</p>
          </div>
          ${rows.every(r=>r.ok)?badge("No leaks detected","ok"):badge("Check payload","bad")}
        </div>
        <div class="admin-health-list">
          ${rows.map(r=>healthRow(
            r.label,
            r.ok
              ? "Payload present · no forbidden keys"
              : r.leaks.length
                ? r.leaks.join(", ")
                : "Payload missing",
            r.ok
          )).join("")}
        </div>
        <div class="admin-note" style="margin-top:10px">
          This is a structural payload test. It does not replace automated integration tests or adversarial security testing.
        </div>
      </section>`;
  }


  // ==========================================================
  // QUESTION BANK
  // ==========================================================

  async function ensureTopics(){
    if(state.topics.length) return state.topics;
    state.topics=await rpc("admin_list_question_topics");
    return state.topics;
  }

  async function renderQuestions(){
    await ensureTopics();

    $("#adminContent").innerHTML=`
      <div class="admin-note" style="margin-bottom:12px"><strong>Normal Question Bank:</strong> use this area for standard 4-option multiple-choice questions. Published questions feed the normal Play Anytime quizzes, Brain Mix and Survival. Connections, Odd One Out, Higher or Lower, Order Up, Topic Rush and BrainiWord belong in <strong>Content Pools</strong>. <button class="admin-button" id="qContentPools" style="margin-left:8px">Open Content Pools</button></div>
      <div class="admin-toolbar">
        <div class="admin-field grow">
          <label>Search</label>
          <input class="admin-input" id="qSearch" placeholder="Prompt or external key">
        </div>
        <div class="admin-field">
          <label>Status</label>
          <select class="admin-select" id="qStatus">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="published">Published</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Difficulty</label>
          <select class="admin-select" id="qDifficulty">
            <option value="">All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Topic</label>
          <select class="admin-select" id="qTopic">
            <option value="">All</option>
            ${state.topics.map(t=>`<option value="${esc(t.slug)}">${esc(t.name)}</option>`).join("")}
          </select>
        </div>
        <div class="admin-field">
          <label>Order</label>
          <select class="admin-select" id="qHealthSort">
            <option value="default" ${state.questionHealthSort==="default"?"selected":""}>Default</option>
            <option value="health_asc" ${state.questionHealthSort==="health_asc"?"selected":""}>Health · needs attention</option>
            <option value="health_desc" ${state.questionHealthSort==="health_desc"?"selected":""}>Health · strongest</option>
          </select>
        </div>
        <button class="admin-button" id="qFilter">Filter</button>
        <button class="admin-button" id="qQuality">Question Quality</button>
        <button class="admin-button" id="qPacks">Quiz Packs</button>
        ${canEditContent()?`
          <button class="admin-button" id="qImport">Import normal questions CSV</button>
          <button class="admin-button primary" id="qNew">+ New question</button>
        `:""}
      </div>

      <div id="questionTable">${loading()}</div>
    `;

    $("#qContentPools").onclick=()=>navigate("content");
    $("#qPacks").onclick=openQuizPacks;
    $("#qQuality").onclick=openQuestionQualityDashboard;
    $("#qFilter").onclick=loadQuestionTable;
    $("#qHealthSort").onchange=e=>{state.questionHealthSort=e.target.value;loadQuestionTable();};
    $("#qSearch").onkeydown=e=>{
      if(e.key==="Enter") loadQuestionTable();
    };
    $("#qNew")?.addEventListener("click",()=>openQuestionEditor());
    $("#qImport")?.addEventListener("click",openQuestionImport);

    await loadQuestionTable();
  }

  async function loadQuestionTable(){
    const holder=$("#questionTable");
    holder.innerHTML=loading();

    const filters={
      search:$("#qSearch")?.value||null,
      status:$("#qStatus")?.value||null,
      difficulty:$("#qDifficulty")?.value||null,
      topic:$("#qTopic")?.value||null
    };

    const [data,quality,health]=await Promise.all([
      rpc("admin_list_questions",{
        p_search:filters.search,
        p_status:filters.status,
        p_difficulty:filters.difficulty,
        p_topic_slug:filters.topic,
        p_limit:100,
        p_offset:0
      }),

      rpc("admin_question_quality_overview",{
        p_topic_slug:filters.topic,
        p_status:filters.status||null,
        p_min_attempts:0,
        p_limit:500
      }).catch(err=>{
        console.warn("Question Quality:",cleanError(err));
        return null;
      }),
      rpc("admin_content_health_overview",{p_days:30,p_content_type:"question"}).catch(err=>{
        console.warn("Content Health:",cleanError(err));
        return {rows:[]};
      })
    ]);

    (health?.rows||[]).forEach(row=>state.contentHealthMap.set(`${row.content_type}:${row.content_id}`,row));
    const rows=sortByHealth(data?.rows||[],"question",state.questionHealthSort);
    const qualityMap=new Map(
      (quality?.rows||[]).map(
        row=>[row.question_version_id,row]
      )
    );

    state.questionRows=rows;

    holder.innerHTML=`
      <div class="admin-panel-head">
        <div>
          <h2>${num(data?.total)} question versions</h2>
          <p>
            Showing up to 100. Published versions are immutable.
            Quality labels use verified player answers only.
          </p>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Question</th>
              <th>Topic</th>
              <th>Difficulty</th>
              <th>Usage</th>
              <th>Health</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(q=>{
              const qualityRow=qualityMap.get(q.question_version_id);
              const analytics=qualityRow
                ? `${num(qualityRow.attempts)} attempts · ${qualityRow.accuracy==null?"—":esc(qualityRow.accuracy)+"%"}`
                : (
                    q.analytics_attempts
                      ? `${num(q.analytics_attempts)} attempts · ${esc(q.analytics_accuracy??"—")}%`
                      : "No verified analytics yet"
                  );

              return `
                <tr class="clickable" data-qv="${esc(q.question_version_id)}">
                  <td>${badge(
                    q.version_status,
                    q.version_status==="published"
                      ?"ok"
                      :q.version_status==="draft"
                        ?"info"
                        :"warn"
                  )}</td>

                  <td>
                    <strong>${esc(q.prompt)}</strong>
                    <small>${esc(q.external_key)} · v${esc(q.version)}</small>
                  </td>

                  <td>${esc(q.topic_name)}</td>
                  <td>${esc(q.difficulty)}</td>

                  <td>
                    ${num(q.used_daily_count)} Daily ·
                    ${num(q.used_pack_count)} packs
                  </td>

                  <td>${healthBadge(healthFor("question",q.question_version_id))}</td>

                  <td>
                    <div class="admin-quality-cell">
                      ${qualityRow
                        ? qualityBadge(qualityRow.quality_state)
                        : badge("No sample","info")
                      }
                      <small>${analytics}</small>
                    </div>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>

        ${rows.length
          ? ""
          : `<div class="admin-empty">No questions match these filters.</div>`
        }
      </div>
    `;

    holder.querySelectorAll("[data-qv]").forEach(row=>{
      row.onclick=()=>openQuestionEditor(row.dataset.qv);
    });
  }

  async function openQuestionQualityDashboard(){
    const topic=$("#qTopic")?.value||null;

    openDrawer(`
      <span class="admin-eyebrow">Editorial analytics</span>
      <h2>Question Quality</h2>
      <p>
        Uses verified player answers to identify questions that deserve
        editorial attention. Nothing changes difficulty automatically.
      </p>
      ${loading()}
    `);

    try{
      const data=await rpc("admin_question_quality_overview",{
        p_topic_slug:topic,
        p_status:"published",
        p_min_attempts:0,
        p_limit:250
      });

      const s=data?.summary||{};
      const rows=data?.rows||[];
      const issues=rows.filter(
        r=>!["healthy","insufficient_sample"].includes(r.quality_state)
      );

      $("#adminDrawerContent").innerHTML=`
        <span class="admin-eyebrow">Editorial analytics</span>
        <h2>Question Quality</h2>
        <p>
          ${topic
            ? `Filtered to ${esc(topic)}. `
            : ""
          }
          Verified data only. Recommendations are review signals,
          never automatic content changes.
        </p>

        <div class="admin-mini-grid" style="margin-top:14px">
          <div class="admin-mini-card">
            <span>Healthy</span>
            <strong>${num(s.healthy)}</strong>
          </div>
          <div class="admin-mini-card">
            <span>Needs review</span>
            <strong>${num(s.needs_review)}</strong>
          </div>
          <div class="admin-mini-card">
            <span>Building sample</span>
            <strong>${num(s.insufficient_sample)}</strong>
          </div>
          <div class="admin-mini-card">
            <span>Too easy</span>
            <strong>${num(s.too_easy)}</strong>
          </div>
          <div class="admin-mini-card">
            <span>Too hard</span>
            <strong>${num(s.too_hard)}</strong>
          </div>
          <div class="admin-mini-card">
            <span>Weak distractors</span>
            <strong>${num(s.weak_distractors)}</strong>
          </div>
        </div>

        <section class="admin-panel" style="margin-top:14px">
          <div class="admin-panel-head">
            <div>
              <h2>Review queue</h2>
              <p>
                High skip rate, difficulty mismatch or weak distractors.
              </p>
            </div>
          </div>

          <div class="admin-quality-list">
            ${issues.length
              ? issues.slice(0,60).map(row=>`
                  <button
                    type="button"
                    class="admin-quality-row"
                    data-quality-qv="${esc(row.question_version_id)}"
                  >
                    <div>
                      <strong>${esc(row.prompt)}</strong>
                      <small>
                        ${esc(row.topic_name)}
                        · ${esc(row.difficulty)}
                        · ${num(row.attempts)} attempts
                      </small>
                    </div>

                    <div>
                      ${qualityBadge(row.quality_state)}
                      <small>
                        ${row.accuracy==null?"—":esc(row.accuracy)+"%"} correct
                        · ${row.skip_rate==null?"—":esc(row.skip_rate)+"%"} skip
                      </small>
                    </div>
                  </button>
                `).join("")
              : `<div class="admin-empty">
                   No published questions currently need review.
                 </div>`
            }
          </div>
        </section>

        <div class="admin-note" style="margin-top:12px">
          Difficulty calibration starts after 30 verified attempts.
          Weak-distractor checks start after 50.
        </div>
      `;

      $("#adminDrawerContent")
        .querySelectorAll("[data-quality-qv]")
        .forEach(button=>{
          button.onclick=()=>{
            const id=button.dataset.qualityQv;
            closeDrawer();
            openQuestionEditor(id);
          };
        });
    }catch(err){
      $("#adminDrawerContent").innerHTML=`
        <span class="admin-eyebrow">Editorial analytics</span>
        <h2>Question Quality could not load</h2>
        <p>${esc(cleanError(err))}</p>
      `;
    }
  }


  function topicOptions(selected){
    return state.topics.map(t=>
      `<option value="${esc(t.slug)}" ${t.slug===selected?"selected":""}>${esc(t.name)}</option>`
    ).join("");
  }

  async function openQuestionEditor(questionVersionId=null){
    await ensureTopics();

    let q=null;
    if(questionVersionId){
      q=await rpc("admin_get_question",{
        p_question_version_id:questionVersionId
      });
    }

    const immutable=q && !["draft","review"].includes(q.status);
    const options=q?.options?.length===4
      ? q.options
      : [
          {text:"",is_correct:true},
          {text:"",is_correct:false},
          {text:"",is_correct:false},
          {text:"",is_correct:false}
        ];

    openDrawer(`
      <span class="admin-eyebrow">${q?"Question version":"New content"}</span>
      <h2>${q?esc(q.prompt):"Create question"}</h2>
      <p>
        ${immutable
          ? "Published versions are read-only here to preserve historical game integrity."
          : "Drafts can be edited and published after validation."
        }
      </p>

      ${immutable?`
        <div class="admin-note">
          This version is already published or retired. Admin V1 does not mutate historical published content.
        </div>
      `:""}

      <div class="admin-form-grid" style="margin-top:14px">
        <div class="admin-field full">
          <label>External key ${q?"":"(optional)"}</label>
          <input class="admin-input" id="qeExternal" value="${esc(q?.external_key||"")}" ${q||immutable?"disabled":""} placeholder="e.g. geo-rivers-001">
        </div>

        <div class="admin-field full">
          <label>Prompt</label>
          <textarea class="admin-textarea" id="qePrompt" ${immutable?"disabled":""}>${esc(q?.prompt||"")}</textarea>
        </div>

        <div class="admin-field">
          <label>Topic</label>
          <select class="admin-select" id="qeTopic" ${immutable?"disabled":""}>
            ${topicOptions(q?.topic_slug||state.topics[0]?.slug)}
          </select>
        </div>

        <div class="admin-field">
          <label>Difficulty</label>
          <select class="admin-select" id="qeDifficulty" ${immutable?"disabled":""}>
            ${["easy","medium","hard"].map(x=>`<option value="${x}" ${x===(q?.difficulty||"medium")?"selected":""}>${x}</option>`).join("")}
          </select>
        </div>

        <div class="admin-field full">
          <label>Explanation</label>
          <textarea class="admin-textarea" id="qeExplanation" ${immutable?"disabled":""}>${esc(q?.explanation||"")}</textarea>
        </div>

        <div class="admin-field full">
          <label>Options · select the correct answer</label>
          <div class="admin-options-editor">
            ${options.map((o,i)=>`
              <label class="admin-option-edit">
                <input type="radio" name="qeCorrect" value="${i}" ${o.is_correct?"checked":""} ${immutable?"disabled":""}>
                <input class="admin-input" data-qe-option="${i}" value="${esc(o.text||"")}" ${immutable?"disabled":""} placeholder="Option ${i+1}">
              </label>`).join("")}
          </div>
        </div>

        <div class="admin-field full">
          <label>Subcategory tags</label>
          <input
            class="admin-input"
            id="qeTags"
            value="${esc((q?.tags||[]).join(", "))}"
            ${immutable?"disabled":""}
            placeholder="e.g. ancient-history, leaders"
          >
          <div
            class="admin-tag-suggestions"
            id="qeTagSuggestions"
            ${immutable?"hidden":""}
          ></div>
          <small class="admin-field-help">
            Use tags for subcategories and future My Stats / recommendations.
            Keep them factual and reusable.
          </small>
        </div>

        <div class="admin-field full">
          <label>Source URL · optional internal reference</label>
          <input class="admin-input" id="qeSource" value="${esc(q?.source_url||"")}" ${immutable?"disabled":""}>
        </div>

        ${!immutable?`
          <div class="admin-field">
            <label>Save as</label>
            <select class="admin-select" id="qeStatus">
              <option value="draft" ${q?.status==="draft"?"selected":""}>Draft</option>
              <option value="review" ${q?.status==="review"?"selected":""}>Review</option>
              <option value="published">Published</option>
            </select>
          </div>
        `:""}
      </div>

      ${q?`
        <div class="admin-mini-grid" style="margin-top:14px">
          <div class="admin-mini-card"><span>Daily uses</span><strong>${num(q.used_daily_count)}</strong></div>
          <div class="admin-mini-card"><span>Pack uses</span><strong>${num(q.used_pack_count)}</strong></div>
          <div class="admin-mini-card"><span>Version</span><strong>v${esc(q.version)}</strong></div>
        </div>
      `:""}

      <div class="admin-drawer-actions">
        ${q?`<button class="admin-button" id="qeAnalytics">Question analytics</button>`:""}
        ${!immutable && canEditContent()?`<button class="admin-button primary" id="qeSave">${q?"Save version":"Create question"}</button>`:""}
      </div>
    `);

    const renderTagSuggestions=()=>{
      const topic=$("#qeTopic")?.value||"general-knowledge";
      const suggestions=QUESTION_TAG_SUGGESTIONS[topic]||[];
      const holder=$("#qeTagSuggestions");

      if(!holder) return;

      const current=new Set(
        String($("#qeTags")?.value||"")
          .split(",")
          .map(x=>x.trim().toLowerCase())
          .filter(Boolean)
      );

      holder.innerHTML=suggestions.map(tag=>`
        <button
          type="button"
          class="admin-tag-chip ${current.has(tag)?"active":""}"
          data-question-tag="${esc(tag)}"
        >
          ${esc(tag)}
        </button>
      `).join("");

      holder.querySelectorAll("[data-question-tag]").forEach(button=>{
        button.onclick=()=>{
          const tag=button.dataset.questionTag;
          const input=$("#qeTags");
          const tags=String(input.value||"")
            .split(",")
            .map(x=>x.trim().toLowerCase())
            .filter(Boolean);

          const next=new Set(tags);
          if(next.has(tag)) next.delete(tag);
          else next.add(tag);

          input.value=[...next].join(", ");
          renderTagSuggestions();
        };
      });
    };

    if(!immutable){
      renderTagSuggestions();
      $("#qeTopic")?.addEventListener("change",renderTagSuggestions);
      $("#qeTags")?.addEventListener("input",renderTagSuggestions);
    }

    $("#qeAnalytics")?.addEventListener(
      "click",
      ()=>openQuestionAnalytics(q.question_version_id,q.prompt)
    );

    $("#qeSave")?.addEventListener("click",async()=>{
      const optionEls=[...document.querySelectorAll("[data-qe-option]")];
      const correct=Number(
        document.querySelector('input[name="qeCorrect"]:checked')?.value
      );

      const payload={
        p_question_version_id:q?.question_version_id||null,
        p_external_key:$("#qeExternal").value||null,
        p_prompt:$("#qePrompt").value,
        p_explanation:$("#qeExplanation").value,
        p_difficulty:$("#qeDifficulty").value,
        p_topic_slug:$("#qeTopic").value,
        p_options:optionEls.map((el,i)=>({
          text:el.value,
          is_correct:i===correct
        })),
        p_tags:$("#qeTags").value
          .split(",")
          .map(x=>x.trim())
          .filter(Boolean),
        p_source_url:$("#qeSource").value||null,
        p_status:$("#qeStatus").value
      };

      try{
        const saved=await rpc("admin_save_question",payload);
        toast(saved.status==="published"?"Question published":"Question saved");
        closeDrawer();
        if(state.currentView==="questions") await loadQuestionTable();
      }catch(err){
        toast(cleanError(err));
      }
    });
  }

  async function openQuestionAnalytics(id,prompt){
    const a=await rpc("admin_question_analytics",{
      p_question_version_id:id
    });

    const meta=qualityMeta(a.quality_state);
    const suggestion=
      ["too_easy","too_hard"].includes(a.quality_state) &&
      a.suggested_difficulty &&
      a.suggested_difficulty!==a.difficulty
        ? `${a.difficulty} → ${a.suggested_difficulty}`
        : "Keep current";

    openDrawer(`
      <span class="admin-eyebrow">Question Quality</span>
      <h2>${esc(prompt)}</h2>
      <p>
        Based only on canonical verified answers.
        Difficulty recommendations are editorial signals, not automatic changes.
      </p>

      <div class="admin-mini-grid">
        <div class="admin-mini-card">
          <span>Quality</span>
          <strong>${esc(meta[0])}</strong>
        </div>

        <div class="admin-mini-card">
          <span>Attempts</span>
          <strong>${num(a.attempts)}</strong>
        </div>

        <div class="admin-mini-card">
          <span>Accuracy</span>
          <strong>${a.accuracy==null?"—":esc(a.accuracy)+"%"}</strong>
        </div>

        <div class="admin-mini-card">
          <span>Skip rate</span>
          <strong>${a.skip_rate==null?"—":esc(a.skip_rate)+"%"}</strong>
        </div>

        <div class="admin-mini-card">
          <span>Avg response</span>
          <strong>${millis(a.avg_response_ms)}</strong>
        </div>

        <div class="admin-mini-card">
          <span>Difficulty signal</span>
          <strong>${esc(suggestion)}</strong>
        </div>
      </div>

      ${Number(a.attempts||0)<30
        ? `<div class="admin-note" style="margin-top:12px">
             Need 30 verified attempts before calibrating difficulty.
           </div>`
        : ""
      }

      ${Number(a.weak_distractor_count||0)>=2
        ? `<div class="admin-note warning" style="margin-top:12px">
             ${num(a.weak_distractor_count)} distractors attract almost no
             selections. Consider replacing them with more plausible wrong answers.
           </div>`
        : ""
      }

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Option distribution</h2>
            <p>
              A wrong option is marked weak after 50 attempts if it attracts
              roughly 3% or fewer selections.
            </p>
          </div>
        </div>

        <div class="admin-health-list" style="margin-top:10px">
          ${(a.options||[]).map(o=>`
            <div class="admin-health-row">
              <div>
                <strong>
                  ${esc(o.position)}. ${esc(o.text)}
                </strong>
                <span>
                  ${num(o.selected_count)} selections
                  ${o.selection_rate==null?"":` · ${esc(o.selection_rate)}%`}
                </span>
              </div>

              <div class="admin-quality-badges">
                ${o.is_correct?badge("Correct","ok"):""}
                ${o.weak_distractor?badge("Weak distractor","warn"):""}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `);
  }


  function parseCSV(text){
    const rows=[];
    let row=[],cell="",quoted=false;

    for(let i=0;i<text.length;i++){
      const ch=text[i];
      const next=text[i+1];

      if(ch==='"'){
        if(quoted && next==='"'){
          cell+='"';i++;
        }else{
          quoted=!quoted;
        }
      }else if(ch==="," && !quoted){
        row.push(cell);cell="";
      }else if((ch==="\n" || ch==="\r") && !quoted){
        if(ch==="\r" && next==="\n") i++;
        row.push(cell);cell="";
        if(row.some(v=>v.trim()!=="")) rows.push(row);
        row=[];
      }else{
        cell+=ch;
      }
    }

    row.push(cell);
    if(row.some(v=>v.trim()!=="")) rows.push(row);
    if(!rows.length) return [];

    const headers=rows[0].map(h=>h.trim().toLowerCase());
    return rows.slice(1).map(cols=>{
      const obj={};
      headers.forEach((h,i)=>obj[h]=(cols[i]||"").trim());
      return obj;
    });
  }

  function importRowFromCSV(r){
    const correctRaw=(r.correct_option||r.correct||"").trim().toUpperCase();
    const correctIndex=/^[A-D]$/.test(correctRaw)
      ? "ABCD".indexOf(correctRaw)
      : Math.max(0,Math.min(3,Number(correctRaw||1)-1));

    const prompt=r.prompt||r.question||"";
    const topic=r.topic_slug||r.category||"";

    return {
      external_key:r.external_key||null,
      topic_slug:topic.toLowerCase().replace(/\s+/g,"-"),
      difficulty:(r.difficulty||"medium").toLowerCase(),
      prompt,
      explanation:r.explanation||"",
      source_url:r.source_url||null,
      tags:(r.tags||"")
        .split("|")
        .map(x=>x.trim())
        .filter(Boolean),
      options:[
        {text:r.option_a||"",is_correct:correctIndex===0},
        {text:r.option_b||"",is_correct:correctIndex===1},
        {text:r.option_c||"",is_correct:correctIndex===2},
        {text:r.option_d||"",is_correct:correctIndex===3}
      ]
    };
  }

  function openQuestionImport(){
    openDrawer(`
      <span class="admin-eyebrow">Bulk content</span>
      <h2>Import normal questions</h2>
      <p>Use this importer only for standard four-option Question Bank questions. Game-specific formats belong in Content Pools. CSV is parsed in your browser, validated, then sent through controlled Admin RPCs.</p>

      <div class="admin-note">
        Maximum 500 rows per import. Use exactly four answer options and one correct answer.
      </div>

      <div class="admin-toolbar" style="margin-top:14px">
        <a class="admin-button" href="brainilab_questions_template.csv" download>Download CSV template</a>
      </div>

      <div class="admin-field">
        <label>CSV file</label>
        <input class="admin-input" type="file" id="qiFile" accept=".csv,text/csv">
      </div>

      <div id="qiPreview" style="margin-top:12px"></div>
    `);

    $("#qiFile").onchange=async e=>{
      const file=e.target.files?.[0];
      if(!file) return;

      const raw=await file.text();
      const parsed=parseCSV(raw).map(importRowFromCSV);

      if(parsed.length>500){
        $("#qiPreview").innerHTML=`<div class="admin-note admin-danger-note">This file has ${num(parsed.length)} rows. Split it into batches of at most 500.</div>`;
        return;
      }

      $("#qiPreview").innerHTML=loading();

      try{
        const preview=await rpc("admin_preview_question_import",{
          p_rows:parsed
        });

        renderImportPreview(preview);
      }catch(err){
        $("#qiPreview").innerHTML=`<div class="admin-note admin-danger-note">${esc(cleanError(err))}</div>`;
      }
    };
  }

  function renderImportPreview(preview){
    const rows=preview?.rows||[];
    const valid=rows.filter(x=>x.valid);

    $("#qiPreview").innerHTML=`
      <div class="admin-import-summary">
        <div class="admin-mini-card"><span>Total</span><strong>${num(rows.length)}</strong></div>
        <div class="admin-mini-card"><span>Valid</span><strong>${num(valid.length)}</strong></div>
        <div class="admin-mini-card"><span>Needs review</span><strong>${num(rows.length-valid.length)}</strong></div>
      </div>

      <div class="admin-table-wrap" style="max-height:330px">
        ${rows.slice(0,150).map((r,i)=>`
          <div class="admin-import-row ${r.valid?"":"bad"}">
            <strong>#${i+1}</strong>
            <span>${esc(r.row?.prompt||"")}</span>
            <span class="${r.valid?"":"issues"}">${r.valid?"Valid":esc((r.issues||[]).join("; "))}</span>
          </div>`).join("")}
      </div>

      ${rows.length>150?`<div class="admin-note">Preview shows the first 150 rows.</div>`:""}

      <label class="admin-note" style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <input type="checkbox" id="qiPublish">
        Publish imported valid questions immediately. Leave unchecked to import as drafts.
      </label>

      <div class="admin-drawer-actions">
        <button class="admin-button primary" id="qiImport" ${valid.length?"":"disabled"}>
          Import ${num(valid.length)} valid questions
        </button>
      </div>
    `;

    $("#qiImport")?.addEventListener("click",async()=>{
      if(!valid.length) return;

      const publish=$("#qiPublish").checked;

      if(publish && !confirm(
        `Publish ${valid.length} imported questions immediately? They will become eligible for future Daily generation.`
      )) return;

      try{
        $("#qiImport").disabled=true;
        const result=await rpc("admin_import_questions",{
          p_rows:valid.map(x=>x.row),
          p_publish:publish
        });

        toast(`${result.created||0} questions imported`);

        $("#qiPreview").innerHTML=`
          <div class="admin-note ${result.failed?"admin-danger-note":""}">
            Created: <strong>${num(result.created)}</strong> · Failed: <strong>${num(result.failed)}</strong>
          </div>
          ${(result.errors||[]).map(e=>`
            <div class="admin-import-row bad">
              <span>Failed</span>
              <span>${esc(e.prompt||e.external_key||"Question")}</span>
              <span class="issues">${esc(e.error)}</span>
            </div>`).join("")}
        `;
      }catch(err){
        toast(cleanError(err));
        $("#qiImport").disabled=false;
      }
    });
  }



  async function openQuizPacks(){
    await ensureTopics();
    const packs=await rpc("admin_list_quiz_packs");

    openDrawer(`
      <span class="admin-eyebrow">Finite evergreen quizzes</span>
      <h2>Quiz Packs</h2>
      <p>Each published pack is exactly 20 questions. New question-bank content never silently rewrites an existing pack.</p>

      ${canEditContent()?`
        <section class="admin-panel" style="margin-top:14px">
          <div class="admin-panel-head">
            <div>
              <h2>Generate new draft pack</h2>
              <p>Creates a new version of an existing 20-question set using least-used published questions. Admin V1 does not create invisible new set numbers.</p>
            </div>
          </div>

          <div class="admin-form-grid">
            <div class="admin-field">
              <label>Topic</label>
              <select class="admin-select" id="packTopic">
                ${state.topics.map(t=>`<option value="${esc(t.slug)}">${esc(t.name)}</option>`).join("")}
              </select>
            </div>

            <div class="admin-field">
              <label>Difficulty</label>
              <select class="admin-select" id="packDifficulty">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div class="admin-field">
              <label>Set number</label>
              <input class="admin-input" id="packSet" type="number" min="1" value="1">
            </div>

            <div class="admin-field">
              <label>Title · optional</label>
              <input class="admin-input" id="packTitle" placeholder="Auto-generated if blank">
            </div>
          </div>

          <div class="admin-toolbar" style="margin-top:10px">
            <button class="admin-button primary" id="generatePack">Generate draft</button>
          </div>
        </section>
      `:""}

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head"><div><h2>Existing packs</h2><p>${num((packs||[]).length)} versions</p></div></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Status</th><th>Pack</th><th>Topic</th><th>Difficulty</th><th>Questions</th></tr></thead>
            <tbody>
              ${(packs||[]).map(pk=>`
                <tr class="clickable" data-pack="${esc(pk.pack_id)}">
                  <td>${badge(pk.status,pk.status==="published"?"ok":"info")}</td>
                  <td><strong>${esc(pk.title)}</strong><small>Set ${esc(pk.set_number)} · v${esc(pk.version)}</small></td>
                  <td>${esc(pk.topic_name)}</td>
                  <td>${esc(pk.difficulty)}</td>
                  <td>${num(pk.question_count)} / 20</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `);

    $("#generatePack")?.addEventListener("click",async()=>{
      try{
        const pack=await rpc("admin_generate_quiz_pack",{
          p_topic_slug:$("#packTopic").value,
          p_difficulty:$("#packDifficulty").value,
          p_set_number:Number($("#packSet").value),
          p_title:$("#packTitle").value||null
        });

        toast("Draft pack generated");
        await openQuizPackDetail(pack.pack_id);
      }catch(err){
        toast(cleanError(err));
      }
    });

    document.querySelectorAll("[data-pack]").forEach(row=>{
      row.onclick=()=>openQuizPackDetail(row.dataset.pack);
    });
  }


  async function openPackReplacement(pack,position){
    openDrawer(`
      <span class="admin-eyebrow">Quiz Pack · replacement</span>
      <h2>Replace question #${esc(position)}</h2>
      <p>${esc(pack.topic_name)} · ${esc(pack.difficulty)}. Only active published questions matching this pack can be selected.</p>

      <div class="admin-toolbar">
        <div class="admin-field grow">
          <label>Search candidate questions</label>
          <input class="admin-input" id="packCandidateSearch" placeholder="Search prompt">
        </div>
        <button class="admin-button primary" id="loadPackCandidates">Search</button>
      </div>

      <div id="packCandidateRows">${loading()}</div>
    `);

    async function loadCandidates(){
      const data=await rpc("admin_list_questions",{
        p_search:$("#packCandidateSearch")?.value||null,
        p_status:"published",
        p_difficulty:pack.difficulty,
        p_topic_slug:pack.topic_slug,
        p_limit:100,
        p_offset:0
      });

      const rows=data?.rows||[];
      const used=new Set(
        (pack.questions||[]).map(q=>q.question_version_id)
      );

      $("#packCandidateRows").innerHTML=`
        <div class="admin-question-list">
          ${rows.map(q=>`
            <div class="admin-question-item">
              <span class="pos">?</span>
              <div>
                <strong>${esc(q.prompt)}</strong>
                <small>${num(q.used_pack_count)} pack uses · ${num(q.used_daily_count)} Daily uses</small>
              </div>
              ${used.has(q.question_version_id)
                ? badge("Already in pack","info")
                : `<button class="admin-button" data-use-pack-q="${esc(q.question_version_id)}">Use</button>`
              }
              <span></span>
            </div>`).join("")}
        </div>
      `;

      document.querySelectorAll("[data-use-pack-q]").forEach(btn=>{
        btn.onclick=async()=>{
          try{
            await rpc("admin_replace_quiz_pack_question",{
              p_pack_id:pack.pack_id,
              p_position:position,
              p_question_version_id:btn.dataset.usePackQ
            });
            toast("Pack question replaced");
            await openQuizPackDetail(pack.pack_id);
          }catch(err){toast(cleanError(err))}
        };
      });
    }

    $("#loadPackCandidates").onclick=loadCandidates;
    $("#packCandidateSearch").onkeydown=e=>{
      if(e.key==="Enter") loadCandidates();
    };

    await loadCandidates();
  }


  async function openQuizPackDetail(packId){
    const pack=await rpc("admin_get_quiz_pack",{
      p_pack_id:packId
    });

    openDrawer(`
      <span class="admin-eyebrow">Quiz Pack · Set ${esc(pack.set_number)} · v${esc(pack.version)}</span>
      <h2>${esc(pack.title)}</h2>
      <p>${esc(pack.topic_name)} · ${esc(pack.difficulty)} · ${esc(pack.status)}</p>

      <div class="admin-note">
        Publishing does not modify older packs. The public quiz loader chooses the newest published version for the same topic / difficulty / set.
      </div>

      <div class="admin-question-list" style="margin-top:12px">
        ${(pack.questions||[]).map(q=>`
          <div class="admin-question-item">
            <span class="pos">${esc(q.position)}</span>
            <div>
              <strong>${esc(q.prompt)}</strong>
              <small>${esc(q.topic_slug)} · ${esc(q.difficulty)}</small>
            </div>
            <button class="admin-button" data-pack-q="${esc(q.question_version_id)}">Open</button>
            ${pack.status!=="published" && canEditContent()
              ? `<button class="admin-button" data-pack-replace="${esc(q.position)}">Replace</button>`
              : `<span></span>`
            }
          </div>`).join("")}
      </div>

      ${pack.status!=="published" && canEditContent()?`
        <div class="admin-drawer-actions">
          <button class="admin-button primary" id="publishPack" ${Number(pack.questions?.length)!==20?"disabled":""}>Publish 20-question pack</button>
        </div>
      `:""}
    `);

    document.querySelectorAll("[data-pack-q]").forEach(btn=>{
      btn.onclick=()=>openQuestionEditor(btn.dataset.packQ);
    });

    document.querySelectorAll("[data-pack-replace]").forEach(btn=>{
      btn.onclick=()=>openPackReplacement(
        pack,
        Number(btn.dataset.packReplace)
      );
    });

    $("#publishPack")?.addEventListener("click",async()=>{
      if(!confirm(
        `Publish "${pack.title}"? It will become available to players as the newest version of this set.`
      )) return;

      try{
        await rpc("admin_publish_quiz_pack",{
          p_pack_id:pack.pack_id
        });
        toast("Quiz pack published");
        await openQuizPackDetail(pack.pack_id);
      }catch(err){toast(cleanError(err))}
    });
  }


  // ==========================================================
  // CONTENT POOLS
  // ==========================================================

  const CONTENT_POOL_IMPORTS={
    brainiword:{label:"BrainiWord",template:"brainilab_brainiword_template.csv"},
    topicrush:{label:"Topic Rush",template:"brainilab_topic_rush_template.csv"},
    orderup:{label:"Order Up",template:"brainilab_order_up_template.csv"},
    connections:{label:"Connections",template:"brainilab_connections_template.csv"},
    oddoneout:{label:"Odd One Out",template:"brainilab_odd_one_out_template.csv"},
    higherlower:{label:"Higher or Lower",template:"brainilab_higher_lower_template.csv"},
    numberroute:{label:"Number Route",template:"brainilab_number_route_template.csv"},
    sequence:{label:"Sequence",template:"brainilab_sequence_template.csv"}
  };

  const HIGHER_LOWER_TYPES={
    higher_lower:"Higher / Lower",
    older_younger:"Older / Younger",
    taller_shorter:"Taller / Shorter",
    richer_poorer:"Richer / Poorer",
    bigger_smaller:"Bigger / Smaller",
    faster_slower:"Faster / Slower",
    hotter_colder:"Hotter / Colder",
    heavier_lighter:"Heavier / Lighter",
    longer_shorter:"Longer / Shorter",
    farther_closer:"Farther / Closer",
    earlier_later:"Earlier / Later",
    more_less:"More / Less"
  };

  function higherLowerTypeOptions(selected="higher_lower"){
    return Object.entries(HIGHER_LOWER_TYPES).map(([value,label])=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`).join("");
  }

  function csvList(value,separator=";"){
    return String(value||"").split(separator).map(x=>x.trim()).filter(Boolean);
  }

  function normalizePoolImport(type,rows){
    return (rows||[]).map((r,index)=>{
      const issues=[];
      let row={};
      const key=(r.external_key||"").trim().toLowerCase();
      try{
        if(type==="brainiword"){
          row={word:String(r.word||"").trim().toUpperCase()};
          if(!/^[A-Z]{5}$/.test(row.word)) issues.push("word must be exactly 5 A–Z letters");
        }
        if(type==="topicrush"){
          const answers=csvList(r.answers,";").map(entry=>{
            const [answer,...aliases]=entry.split("|").map(x=>x.trim()).filter(Boolean);
            return {answer,aliases};
          }).filter(x=>x.answer);
          row={external_key:key,title:r.title||"",prompt:r.prompt||"",target_count:Number(r.target_count||15),answers};
          if(!key) issues.push("external_key required");
          if(!row.title) issues.push("title required");
          if(!row.prompt) issues.push("prompt required");
          if(answers.length<20) issues.push("at least 20 canonical answers required");
          if(!(row.target_count>=5&&row.target_count<=30)) issues.push("target_count must be 5–30");
        }
        if(type==="orderup"){
          const items=Array.from({length:10},(_,i)=>String(r[`item_${i+1}`]||"").trim());
          row={external_key:key,title:r.title||"",prompt:r.prompt||"",direction_label:r.direction_label||"",category:(r.category||"general").toLowerCase(),items};
          if(!key||!row.title||!row.prompt||!row.direction_label) issues.push("key, title, prompt and direction_label are required");
          if(items.some(x=>!x)) issues.push("all 10 items are required");
          if(new Set(items.map(x=>x.toLowerCase())).size!==10) issues.push("items must be unique");
        }
        if(type==="connections"){
          const clues=Array.from({length:8},(_,i)=>String(r[`clue_${i+1}`]||"").trim()).filter(Boolean);
          const distractors=Array.from({length:3},(_,i)=>String(r[`distractor_${i+1}`]||"").trim()).filter(Boolean);
          row={external_key:key,category:(r.category||"general").toLowerCase(),prompt:r.prompt||"What connects these?",clues,correct_connection:r.correct_connection||"",distractors,explanation:r.explanation||""};
          if(!key) issues.push("external_key required");
          if(clues.length<4||clues.length>8) issues.push("4–8 clues required");
          if(!row.correct_connection) issues.push("correct_connection required");
          if(distractors.length!==3) issues.push("exactly 3 distractors required");
        }
        if(type==="oddoneout"){
          const items=Array.from({length:4},(_,i)=>String(r[`item_${i+1}`]||"").trim());
          const odd=Number(r.odd_item||r.odd_index||0);
          row={external_key:key,category:(r.category||"general").toLowerCase(),prompt:r.prompt||"Which one does not belong?",items,odd_index:odd>=1&&odd<=4?odd-1:odd,explanation:r.explanation||""};
          if(!key) issues.push("external_key required");
          if(items.some(x=>!x)) issues.push("all 4 items are required");
          if(new Set(items.map(x=>x.toLowerCase())).size!==4) issues.push("items must be unique");
          if(!(row.odd_index>=0&&row.odd_index<=3)) issues.push("odd_item must be 1–4");
        }
        if(type==="higherlower"){
          row={external_key:key,category:(r.category||"general").toLowerCase(),comparison_type:String(r.comparison_type||"higher_lower").trim().toLowerCase(),metric:r.metric||"",left_label:r.left_label||"",left_value:Number(r.left_value),right_label:r.right_label||"",right_value:Number(r.right_value),unit:r.unit||"",explanation:r.explanation||""};
          if(!key||!row.metric||!row.left_label||!row.right_label) issues.push("key, metric and both labels are required");
          if(!HIGHER_LOWER_TYPES[row.comparison_type]) issues.push("comparison_type must be one of the supported types in the template");
          if(!Number.isFinite(row.left_value)||!Number.isFinite(row.right_value)) issues.push("both values must be numbers");
          if(row.left_value===row.right_value) issues.push("values cannot tie");
        }
        if(type==="numberroute"){
          const numbers=Array.from({length:4},(_,i)=>Number(r[`number_${i+1}`]));
          row={external_key:key,category:(r.category||"math").toLowerCase(),numbers,target:Number(r.target)};
          if(!key) issues.push("external_key required");
          if(numbers.some(n=>!Number.isInteger(n)||n<1||n>9)) issues.push("number_1–number_4 must be integers 1–9");
          if(!Number.isInteger(row.target)||row.target<0||row.target>200) issues.push("target must be an integer 0–200");
        }
        if(type==="sequence"){
          const sequence=Array.from({length:5},(_,i)=>Number(r[`number_${i+1}`]));
          const options=Array.from({length:4},(_,i)=>Number(r[`option_${i+1}`]));
          row={external_key:key,category:(r.category||"math").toLowerCase(),sequence,answer:Number(r.answer),options,explanation:r.explanation||""};
          if(!key) issues.push("external_key required");
          if(sequence.some(n=>!Number.isFinite(n))) issues.push("number_1–number_5 must be numeric");
          if(options.some(n=>!Number.isFinite(n))||new Set(options).size!==4) issues.push("four unique numeric options required");
          if(!Number.isFinite(row.answer)||!options.includes(row.answer)) issues.push("answer must be one of option_1–option_4");
        }
      }catch(err){issues.push(cleanError(err))}
      return {index:index+1,row,valid:issues.length===0,issues};
    });
  }

  function openPoolImport(type){
    const cfg=CONTENT_POOL_IMPORTS[type];
    if(!cfg) return;
    openDrawer(`
      <span class="admin-eyebrow">Content Pools · CSV</span>
      <h2>Import ${esc(cfg.label)}</h2>
      <p>Use one row per ${type==="brainiword"?"word":"content item"}. The browser validates the CSV first, then sends only normalized rows through a controlled Admin RPC.</p>
      <div class="admin-note">Maximum 500 rows per import. New valid pool content is activated immediately and becomes eligible automatically when the corresponding game needs new content.</div>
      <div class="admin-toolbar" style="margin-top:12px"><a class="admin-button" href="${esc(cfg.template)}" download>Download ${esc(cfg.label)} CSV template</a></div>
      <div class="admin-field"><label>CSV file</label><input class="admin-input" type="file" id="poolImportFile" accept=".csv,text/csv"></div>
      <div id="poolImportPreview" style="margin-top:12px"></div>
    `);

    $("#poolImportFile").onchange=async e=>{
      const file=e.target.files?.[0]; if(!file) return;
      const parsed=parseCSV(await file.text());
      const checked=normalizePoolImport(type,parsed);
      const valid=checked.filter(x=>x.valid);
      const holder=$("#poolImportPreview");
      if(checked.length>500){holder.innerHTML=`<div class="admin-note admin-danger-note">${num(checked.length)} rows found. Split the file into batches of 500 or fewer.</div>`;return;}
      holder.innerHTML=`
        <div class="admin-import-summary">
          <div class="admin-mini-card"><span>Total</span><strong>${num(checked.length)}</strong></div>
          <div class="admin-mini-card"><span>Valid</span><strong>${num(valid.length)}</strong></div>
          <div class="admin-mini-card"><span>Needs review</span><strong>${num(checked.length-valid.length)}</strong></div>
        </div>
        <div class="admin-table-wrap" style="max-height:330px">
          ${checked.slice(0,150).map(x=>`<div class="admin-import-row ${x.valid?"":"bad"}"><strong>#${x.index}</strong><span>${esc(x.row.external_key||x.row.word||cfg.label)}</span><span class="${x.valid?"":"issues"}">${x.valid?"Valid":esc(x.issues.join("; "))}</span></div>`).join("")}
        </div>
        <div class="admin-drawer-actions"><button class="admin-button primary" id="poolDoImport" ${valid.length?"":"disabled"}>Import ${num(valid.length)} valid rows</button></div>`;
      $("#poolDoImport")?.addEventListener("click",async()=>{
        if(!valid.length) return;
        try{
          $("#poolDoImport").disabled=true;
          const result=await rpc("admin_import_content_pool",{p_pool_type:type,p_rows:valid.map(x=>x.row)});
          holder.innerHTML=`<div class="admin-note ${result.failed?"admin-danger-note":""}">Created: <strong>${num(result.created)}</strong> · Failed: <strong>${num(result.failed)}</strong></div>${(result.errors||[]).map(x=>`<div class="admin-import-row bad"><span>Failed</span><span>${esc(x.external_key||cfg.label)}</span><span class="issues">${esc(x.error)}</span></div>`).join("")}`;
          toast(`${result.created||0} ${cfg.label} items imported`);
        }catch(err){toast(cleanError(err));$("#poolDoImport").disabled=false;}
      });
    };
  }

  async function renderContent(){
    const [pools,topicRushTopics,orderUpRounds,connectionsPuzzles,oddPuzzles,higherPairs,numberRoutes,sequences,health]=await Promise.all([
      rpc("admin_get_content_pools"),rpc("admin_list_topic_rush_topics"),rpc("admin_list_order_up_rounds"),rpc("admin_list_connections_puzzles"),rpc("admin_list_odd_one_out_puzzles"),rpc("admin_list_higher_lower_pairs"),rpc("admin_list_number_route_puzzles"),rpc("admin_list_sequence_puzzles"),rpc("admin_content_health_overview",{p_days:30,p_content_type:null}).catch(err=>{console.warn("Content Health:",cleanError(err));return {rows:[]}})
    ]);
    state.contentHealthMap=new Map((health?.rows||[]).map(row=>[`${row.content_type}:${row.content_id}`,row]));
    const counts={
      brainiword:Number(pools.brainiword?.active_count||0),
      topicrush:(topicRushTopics||[]).filter(x=>x.active).length,
      orderup:(orderUpRounds||[]).filter(x=>x.active).length,
      connections:(connectionsPuzzles||[]).filter(x=>x.active).length,
      oddoneout:(oddPuzzles||[]).filter(x=>x.active).length,
      higherlower:(higherPairs||[]).filter(x=>x.active).length,
      numberroute:(numberRoutes||[]).filter(x=>x.active).length,
      sequence:(sequences||[]).filter(x=>x.active).length
    };
    const allData={pools,topicRushTopics,orderUpRounds,connectionsPuzzles,oddPuzzles,higherPairs,numberRoutes,sequences};
    const validTabs=["brainiword","topicrush","orderup","connections","oddoneout","higherlower","numberroute","sequence","survival","mathrush"];
    if(!validTabs.includes(state.poolTab)) state.poolTab="connections";

    $("#adminContent").innerHTML=`
      <div class="admin-grid metrics">
        ${metric("BrainiWord",counts.brainiword,"Active words")}
        ${metric("Topic Rush",counts.topicrush,"Active topics")}
        ${metric("Order Up",counts.orderup,"Active rounds")}
        ${metric("Connections",counts.connections,"Active puzzles")}
        ${metric("Odd One Out",counts.oddoneout,"Active puzzles")}
        ${metric("Higher or Lower",counts.higherlower,"Active pairs")}
        ${metric("Number Route",counts.numberroute,"Active routes")}
        ${metric("Sequence",counts.sequence,"Active puzzles")}
      </div>
      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head"><div><h2>Bulk content imports</h2><p>Question Bank is for normal multiple-choice questions. Content Pools is for game-specific structured content.</p></div><a class="admin-button" href="brainilab_daily_content_map.csv" download>Daily content map CSV</a></div>
        <div class="admin-note"><strong>Daily automation:</strong> Brain Mix and BrainiWord are fixed every day. Two additional slots rotate between Order Up, Topic Rush, Connections, Odd One Out, Higher or Lower, Math Rush, Number Route and Sequence. You do not upload a separate “Daily CSV”; add content to the correct Question Bank or Content Pool and the Daily scheduler selects eligible content automatically.</div>
        <div class="content-import-hub">
          ${Object.entries(CONTENT_POOL_IMPORTS).map(([id,cfg])=>`<div class="content-import-card"><strong>${esc(cfg.label)}</strong><span>${id==="connections"?"4–8 clues + 4 connection choices":id==="oddoneout"?"4 items + the odd item":id==="higherlower"?"Comparison type + two labelled numeric values":id==="numberroute"?"4 one-digit numbers + target; unique route validated automatically":id==="sequence"?"5-number sequence + correct answer + 4 choices":id==="orderup"?"Exactly 10 ordered items":id==="topicrush"?"Topic + accepted answer list":"5-letter words"}</span><button class="admin-button" data-import-pool="${id}">Import CSV</button> <a class="admin-button" href="${esc(cfg.template)}" download>Template</a></div>`).join("")}
        </div>
      </section>
      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-toolbar" style="justify-content:flex-end"><div class="admin-field"><label>Order content</label><select class="admin-select" id="poolHealthSort"><option value="default" ${state.poolHealthSort==="default"?"selected":""}>Default</option><option value="health_asc" ${state.poolHealthSort==="health_asc"?"selected":""}>Health · needs attention</option><option value="health_desc" ${state.poolHealthSort==="health_desc"?"selected":""}>Health · strongest</option></select></div></div>
        <div class="admin-pool-tabs">
          <button data-pool="brainiword" class="${state.poolTab==="brainiword"?"active":""}">BrainiWord</button>
          <button data-pool="topicrush" class="${state.poolTab==="topicrush"?"active":""}">Topic Rush</button>
          <button data-pool="orderup" class="${state.poolTab==="orderup"?"active":""}">Order Up</button>
          <button data-pool="connections" class="${state.poolTab==="connections"?"active":""}">Connections</button>
          <button data-pool="oddoneout" class="${state.poolTab==="oddoneout"?"active":""}">Odd One Out</button>
          <button data-pool="higherlower" class="${state.poolTab==="higherlower"?"active":""}">Higher or Lower</button>
          <button data-pool="numberroute" class="${state.poolTab==="numberroute"?"active":""}">Number Route</button>
          <button data-pool="sequence" class="${state.poolTab==="sequence"?"active":""}">Sequence</button>
          <button data-pool="mathrush" class="${state.poolTab==="mathrush"?"active":""}">Math Rush</button>
          <button data-pool="survival" class="${state.poolTab==="survival"?"active":""}">Survival</button>
        </div><div id="poolBody"></div>
      </section>`;
    document.querySelectorAll("[data-import-pool]").forEach(btn=>btn.onclick=()=>openPoolImport(btn.dataset.importPool));
    $("#poolHealthSort").onchange=e=>{state.poolHealthSort=e.target.value;renderPoolBody(allData);};
    document.querySelectorAll("[data-pool]").forEach(btn=>btn.onclick=()=>{state.poolTab=btn.dataset.pool;document.querySelectorAll("[data-pool]").forEach(x=>x.classList.toggle("active",x===btn));renderPoolBody(allData)});
    renderPoolBody(allData);
  }

  function parseTopicRushAnswers(text){
    return String(text||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split("|").map(x=>x.trim()).filter(Boolean);return {answer:parts[0],aliases:parts.slice(1)}});
  }

  function poolImportButton(type){
    const cfg=CONTENT_POOL_IMPORTS[type];
    return cfg&&canEditContent()?`<button class="admin-button" data-inline-import="${type}">Import CSV</button><a class="admin-button" href="${esc(cfg.template)}" download>CSV template</a>`:"";
  }

  function bindInlineImport(root){root.querySelectorAll("[data-inline-import]").forEach(btn=>btn.onclick=()=>openPoolImport(btn.dataset.inlineImport));}

  function renderPoolBody(data){
    const {pools,topicRushTopics,orderUpRounds,connectionsPuzzles,oddPuzzles,higherPairs,numberRoutes,sequences}=data;
    const root=$("#poolBody"),editable=canEditContent();
    if(state.poolTab==="mathrush"){
      root.innerHTML=`<div class="admin-note"><strong>Math Rush has no editorial content pool.</strong> Its 60-second operations are generated deterministically from safe one-digit rules: addition, non-negative subtraction, multiplication and exact whole-number division. There is nothing to upload; every run can generate fresh content automatically.</div>`;
      return;
    }
    if(state.poolTab==="survival"){
      root.innerHTML=`<div class="admin-note"><strong>Survival does not have a separate content pool.</strong> It draws history-aware mixed questions directly from the published Question Bank, moving from Easy → Medium → Hard. Add more Survival content by importing normal questions into Question Bank.</div><div class="admin-toolbar" style="margin-top:12px"><button class="admin-button primary" id="survivalQuestions">Open Question Bank</button><a class="admin-button" href="brainilab_questions_template.csv" download>Normal question CSV template</a></div>`;
      $("#survivalQuestions").onclick=()=>navigate("questions"); return;
    }
    if(state.poolTab==="brainiword"){
      const rows=sortByHealth(pools.brainiword?.rows||[],"brainiword",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${editable?`<div class="admin-field grow"><label>Add 5-letter word</label><input class="admin-input" id="newBrainiWord" maxlength="5" placeholder="CRANE"></div><button class="admin-button primary" id="addBrainiWord">Add word</button>`:""}${poolImportButton("brainiword")}</div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Word</th><th>Status</th><th>Last used</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong class="admin-code">${esc(r.word)}</strong></td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${esc(r.last_used||"Never")}</td><td>${editable?`<button class="admin-button" data-word-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      $("#addBrainiWord")?.addEventListener("click",async()=>{try{await rpc("admin_add_brainiword_word",{p_word:$("#newBrainiWord").value});toast("BrainiWord added");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-word-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_brainiword_word",{p_word_id:btn.dataset.wordToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"brainiword");bindInlineImport(root);return;
    }
    if(state.poolTab==="topicrush"){
      const rows=sortByHealth(topicRushTopics||[],"topicrush",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("topicrush")}</div>${editable?`<div class="admin-note">Manual editor: one canonical answer per line. Aliases go after <code>|</code>. CSV batch imports use <code>;</code> between canonical answers and <code>|</code> for aliases.</div><div class="admin-form-grid" style="margin-top:10px"><div class="admin-field"><label>External key</label><input class="admin-input" id="trExternal"></div><div class="admin-field"><label>Title</label><input class="admin-input" id="trTitle"></div><div class="admin-field full"><label>Player prompt</label><input class="admin-input" id="trPrompt"></div><div class="admin-field"><label>Daily target</label><input class="admin-input" id="trTarget" type="number" min="5" max="30" value="15"></div><div class="admin-field full"><label>Accepted answers</label><textarea class="admin-textarea" id="trAnswers" style="min-height:190px"></textarea></div></div><div class="admin-toolbar"><button class="admin-button primary" id="addTopicRush">Create Topic Rush topic</button></div>`:""}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Topic</th><th>Target</th><th>Answers</th><th>Last used</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.title)}</strong><small>${esc(r.external_key)} · ${esc(r.prompt)}</small></td><td>${num(r.target_count)}</td><td>${num(r.answer_count)}</td><td>${esc(r.last_used||"Never")}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-tr-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      $("#addTopicRush")?.addEventListener("click",async()=>{const answers=parseTopicRushAnswers($("#trAnswers").value);if(answers.length<20){toast("Add at least 20 canonical answers");return}try{await rpc("admin_create_topic_rush_topic",{p_external_key:$("#trExternal").value,p_title:$("#trTitle").value,p_prompt:$("#trPrompt").value,p_target_count:Number($("#trTarget").value),p_answers:answers});toast("Topic Rush topic created");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-tr-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_topic_rush_topic",{p_topic_id:btn.dataset.trToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"topicrush");bindInlineImport(root);return;
    }
    if(state.poolTab==="orderup"){
      const rows=sortByHealth(orderUpRounds||[],"orderup",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("orderup")}</div>${editable?`<div class="admin-form-grid"><div class="admin-field"><label>External key</label><input class="admin-input" id="ouExternal"></div><div class="admin-field"><label>Category</label><input class="admin-input" id="ouCategory" value="general"></div><div class="admin-field"><label>Title</label><input class="admin-input" id="ouTitle"></div><div class="admin-field"><label>Direction</label><input class="admin-input" id="ouDirection" placeholder="Earliest → Latest"></div><div class="admin-field full"><label>Prompt</label><input class="admin-input" id="ouPrompt"></div><div class="admin-field full"><label>Correct order · exactly 10 lines</label><textarea class="admin-textarea" id="ouItems" style="min-height:210px"></textarea></div></div><div class="admin-toolbar"><button class="admin-button primary" id="addOrderUpRound">Create Order Up round</button></div>`:""}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Round</th><th>Category</th><th>Items</th><th>Last used</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.title)}</strong><small>${esc(r.external_key)} · ${esc(r.direction_label)}</small></td><td>${esc(r.category)}</td><td>${num(r.item_count)} / 10</td><td>${esc(r.last_used||"Never")}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-ou-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      $("#addOrderUpRound")?.addEventListener("click",async()=>{const items=$("#ouItems").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(items.length!==10){toast("Order Up needs exactly 10 items");return}try{await rpc("admin_create_order_up_round",{p_external_key:$("#ouExternal").value,p_title:$("#ouTitle").value,p_prompt:$("#ouPrompt").value,p_direction_label:$("#ouDirection").value,p_category:$("#ouCategory").value,p_items:items});toast("Order Up round created");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-ou-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_order_up_round",{p_round_id:btn.dataset.ouToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"orderup");bindInlineImport(root);return;
    }
    if(state.poolTab==="connections"){
      const rows=sortByHealth(connectionsPuzzles||[],"connections",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("connections")}</div>${editable?`<div class="admin-form-grid"><div class="admin-field"><label>External key</label><input class="admin-input" id="cnExternal"></div><div class="admin-field"><label>Category</label><input class="admin-input" id="cnCategory" value="general"></div><div class="admin-field full"><label>Prompt</label><input class="admin-input" id="cnPrompt" value="What connects these?"></div><div class="admin-field full"><label>Clues · 4–8 lines</label><textarea class="admin-textarea" id="cnClues"></textarea></div><div class="admin-field full"><label>Correct connection</label><input class="admin-input" id="cnCorrect"></div><div class="admin-field full"><label>Wrong connections · exactly 3 lines</label><textarea class="admin-textarea" id="cnDistractors"></textarea></div><div class="admin-field full"><label>Explanation</label><textarea class="admin-textarea" id="cnExplanation"></textarea></div></div><div class="admin-toolbar"><button class="admin-button primary" id="addConnectionsPuzzle">Create Connections puzzle</button></div>`:""}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Puzzle</th><th>Category</th><th>Clues</th><th>Correct</th><th>Played</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>{const correct=(r.choices||[]).find(x=>x.correct);return `<tr><td><strong>${esc(r.external_key)}</strong><small>${esc(r.prompt)}</small></td><td>${esc(r.category)}</td><td>${num((r.clues||[]).length)}</td><td>${esc(correct?.text||"—")}</td><td>${num(r.play_count)}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-cn-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`}).join("")}</tbody></table></div>`;
      $("#addConnectionsPuzzle")?.addEventListener("click",async()=>{const clues=$("#cnClues").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),distractors=$("#cnDistractors").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(clues.length<4||clues.length>8){toast("Add 4–8 clues");return}if(distractors.length!==3){toast("Add exactly 3 wrong connections");return}try{await rpc("admin_create_connections_puzzle",{p_external_key:$("#cnExternal").value,p_category:$("#cnCategory").value,p_prompt:$("#cnPrompt").value,p_clues:clues,p_correct_connection:$("#cnCorrect").value,p_distractors:distractors,p_explanation:$("#cnExplanation").value});toast("Connections puzzle created");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-cn-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_connections_puzzle",{p_puzzle_id:btn.dataset.cnToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"connections");bindInlineImport(root);return;
    }
    if(state.poolTab==="oddoneout"){
      const rows=sortByHealth(oddPuzzles||[],"oddoneout",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("oddoneout")}</div>${editable?`<div class="admin-note">Exactly four items. <strong>Odd item</strong> is numbered 1–4 in CSV and in this editor.</div><div class="admin-form-grid"><div class="admin-field"><label>External key</label><input class="admin-input" id="ooExternal"></div><div class="admin-field"><label>Category</label><input class="admin-input" id="ooCategory" value="general"></div><div class="admin-field full"><label>Prompt</label><input class="admin-input" id="ooPrompt" value="Which one does not belong?"></div>${[1,2,3,4].map(i=>`<div class="admin-field"><label>Item ${i}</label><input class="admin-input" id="ooItem${i}"></div>`).join("")}<div class="admin-field"><label>Odd item</label><select class="admin-select" id="ooOdd">${[1,2,3,4].map(i=>`<option value="${i-1}">${i}</option>`).join("")}</select></div><div class="admin-field full"><label>Explanation</label><textarea class="admin-textarea" id="ooExplanation"></textarea></div></div><div class="admin-toolbar"><button class="admin-button primary" id="addOdd">Create Odd One Out puzzle</button></div>`:""}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Puzzle</th><th>Category</th><th>Items</th><th>Odd item</th><th>Played</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.external_key)}</strong><small>${esc(r.prompt)}</small></td><td>${esc(r.category)}</td><td>${(r.items||[]).map(x=>esc(x)).join(" · ")}</td><td>${esc((r.items||[])[Number(r.odd_index)]||"—")}</td><td>${num(r.play_count)}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-oo-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      $("#addOdd")?.addEventListener("click",async()=>{const items=[1,2,3,4].map(i=>$("#ooItem"+i).value.trim());if(items.some(x=>!x)){toast("Add all four items");return}try{await rpc("admin_create_odd_one_out_puzzle",{p_external_key:$("#ooExternal").value,p_category:$("#ooCategory").value,p_prompt:$("#ooPrompt").value,p_items:items,p_odd_index:Number($("#ooOdd").value),p_explanation:$("#ooExplanation").value});toast("Odd One Out puzzle created");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-oo-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_odd_one_out_puzzle",{p_puzzle_id:btn.dataset.ooToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"oddoneout");bindInlineImport(root);return;
    }
    if(state.poolTab==="higherlower"){
      const rows=sortByHealth(higherPairs||[],"higherlower",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("higherlower")}</div>${editable?`<div class="admin-note"><strong>Choose the comparison language first.</strong> This controls the natural question and the two answer buttons. Examples: <em>Is Mozart older or younger than Beethoven?</em>, <em>Is K2 higher or lower than Everest?</em>, <em>Is a lion faster or slower than a cheetah?</em>. For <strong>Older / Younger</strong>, store birth years (a later year means younger). For <strong>Earlier / Later</strong>, store event years.</div><div class="admin-form-grid"><div class="admin-field"><label>External key</label><input class="admin-input" id="hlExternal"></div><div class="admin-field"><label>Category</label><input class="admin-input" id="hlCategory" value="general"></div><div class="admin-field"><label>Comparison type</label><select class="admin-select" id="hlComparisonType">${higherLowerTypeOptions()}</select></div><div class="admin-field"><label>Metric / stored value</label><input class="admin-input" id="hlMetric" placeholder="Birth year, height, speed…"></div><div class="admin-field"><label>Left label</label><input class="admin-input" id="hlLeftLabel"></div><div class="admin-field"><label>Left value</label><input class="admin-input" id="hlLeftValue" type="number" step="any"></div><div class="admin-field"><label>Right label</label><input class="admin-input" id="hlRightLabel"></div><div class="admin-field"><label>Right value</label><input class="admin-input" id="hlRightValue" type="number" step="any"></div><div class="admin-field"><label>Unit</label><input class="admin-input" id="hlUnit" placeholder="m, km/h, year…"></div><div class="admin-field full"><label>Explanation</label><textarea class="admin-textarea" id="hlExplanation"></textarea></div></div><div class="admin-toolbar"><button class="admin-button primary" id="addHL">Create Higher or Lower pair</button></div>`:""}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Pair</th><th>Type</th><th>Metric</th><th>Left</th><th>Right</th><th>Played</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.external_key)}</strong><small>${esc(r.category)}</small></td><td>${esc(HIGHER_LOWER_TYPES[r.comparison_type]||r.comparison_type||"Higher / Lower")}</td><td>${esc(r.metric)}</td><td>${esc(r.left_label)} · ${esc(r.left_value)} ${esc(r.unit||"")}</td><td>${esc(r.right_label)} · ${esc(r.right_value)} ${esc(r.unit||"")}</td><td>${num(r.play_count)}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-hl-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      $("#addHL")?.addEventListener("click",async()=>{try{await rpc("admin_create_higher_lower_pair",{p_external_key:$("#hlExternal").value,p_category:$("#hlCategory").value,p_comparison_type:$("#hlComparisonType").value,p_metric:$("#hlMetric").value,p_left_label:$("#hlLeftLabel").value,p_left_value:Number($("#hlLeftValue").value),p_right_label:$("#hlRightLabel").value,p_right_value:Number($("#hlRightValue").value),p_unit:$("#hlUnit").value,p_explanation:$("#hlExplanation").value});toast("Higher or Lower pair created");renderContent()}catch(err){toast(cleanError(err))}});
      root.querySelectorAll("[data-hl-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_higher_lower_pair",{p_pair_id:btn.dataset.hlToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"higherlower");bindInlineImport(root);return;
    }
    if(state.poolTab==="numberroute"){
      const rows=sortByHealth(numberRoutes||[],"numberroute",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("numberroute")}</div><div class="admin-note"><strong>Unique-solution validation is automatic.</strong> Every imported route is tested against all 64 possible +, −, × and ÷ combinations using strict left-to-right calculation. Rows with zero or multiple solutions are rejected.</div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Route</th><th>Numbers</th><th>Target</th><th>Played</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.external_key)}</strong><small>${esc(r.category||"math")}</small></td><td>${(r.numbers||[]).map(esc).join(" · ")}</td><td><strong>${esc(r.target)}</strong></td><td>${num(r.play_count)}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-nr-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      root.querySelectorAll("[data-nr-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_number_route_puzzle",{p_puzzle_id:btn.dataset.nrToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"numberroute");bindInlineImport(root);return;
    }
    if(state.poolTab==="sequence"){
      const rows=sortByHealth(sequences||[],"sequence",state.poolHealthSort);
      root.innerHTML=`<div class="admin-toolbar">${poolImportButton("sequence")}</div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Puzzle</th><th>Sequence</th><th>Answer</th><th>Played</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.external_key)}</strong><small>${esc(r.category||"math")}</small></td><td>${(r.sequence||[]).map(esc).join(" · ")} · ?</td><td><strong>${esc(r.answer)}</strong><small>${esc(r.explanation||"")}</small></td><td>${num(r.play_count)}</td><td>${r.active?badge("Active","ok"):badge("Inactive","warn")}</td><td>${editable?`<button class="admin-button" data-seq-toggle="${esc(r.id)}" data-active="${r.active}">${r.active?"Disable":"Enable"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
      root.querySelectorAll("[data-seq-toggle]").forEach(btn=>btn.onclick=async()=>{try{await rpc("admin_toggle_sequence_puzzle",{p_puzzle_id:btn.dataset.seqToggle,p_active:btn.dataset.active!=="true"});renderContent()}catch(err){toast(cleanError(err))}});addPoolHealthColumn(root,rows,"sequence");bindInlineImport(root);return;
    }
    root.innerHTML=`<div class="admin-empty">Select a content pool above.</div>`;
  }

  // ==========================================================
  // GAME ANALYTICS
  // ==========================================================

  const GAME_LABELS={brainmix:"Brain Mix",orderup:"Order Up",topicrush:"Topic Rush",brainiword:"BrainiWord",connections:"Connections",survival:"Survival",oddoneout:"Odd One Out",higherlower:"Higher or Lower",mathrush:"Math Rush",numberroute:"Number Route",sequence:"Sequence",worldflags:"World Flags",worldcapitals:"World Capitals",science:"Science",history:"History",sports:"Sports",generalknowledge:"General Knowledge"};

  async function renderAnalytics(days=30){
    const [analytics,quality]=await Promise.all([
      rpc("admin_get_game_analytics",{p_days:days}),
      rpc("admin_question_quality_overview",{p_topic_slug:null,p_status:"published",p_min_attempts:0,p_limit:250})
    ]);
    let games=analytics?.games||[];const summary=analytics?.summary||{},qSummary=quality?.summary||{},issues=(quality?.rows||[]).filter(r=>!["healthy","insufficient_sample"].includes(r.quality_state));
    if(state.analyticsHealthSort==="health_asc" || state.analyticsHealthSort==="health_desc"){
      const dir=state.analyticsHealthSort==="health_desc"?-1:1;
      games=games.slice().sort((a,b)=>(Number(a.health_score??-1)-Number(b.health_score??-1))*dir);
    }
    const maxPlays=Math.max(0,...games.map(g=>Number(g.plays||0)));
    const topLabel=GAME_LABELS[summary.top_game]||summary.top_game||"—";
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar"><div class="admin-field"><label>Period</label><select class="admin-select" id="analyticsDays"><option value="7" ${days===7?"selected":""}>Last 7 days</option><option value="30" ${days===30?"selected":""}>Last 30 days</option><option value="90" ${days===90?"selected":""}>Last 90 days</option></select></div><div class="admin-field"><label>Order games</label><select class="admin-select" id="analyticsHealthSort"><option value="health_asc" ${state.analyticsHealthSort==="health_asc"?"selected":""}>Health · needs attention</option><option value="health_desc" ${state.analyticsHealthSort==="health_desc"?"selected":""}>Health · strongest</option><option value="default" ${state.analyticsHealthSort==="default"?"selected":""}>Usage order</option></select></div><button class="admin-button" id="analyticsRefresh">Refresh</button></div>
      <div class="admin-grid metrics">
        ${metric("Completed plays",summary.total_plays,`Cloud results · ${days} days`)}
        ${metric("Unique players",summary.unique_players,"Authenticated cloud players")}
        ${metric("Top game",topLabel,"By completed plays")}
        ${metric("Questions needing review",qSummary.needs_review,"Verified-answer quality signals")}
      </div>
      <section class="admin-panel" style="margin-top:14px"><div class="admin-panel-head"><div><h2>Game performance & Health</h2><p>Health combines starts, completed plays, exit/abandonment, accuracy and relative usage. A session that stays unfinished for 15 minutes is treated as an exit.</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Game</th><th>Health</th><th>Starts</th><th>Plays</th><th>Exit</th><th>Players</th><th>Avg accuracy</th><th>Avg score</th><th>Avg time</th><th>Verified</th><th>Signal</th></tr></thead><tbody>${games.map(g=>{const plays=Number(g.plays||0);const ratio=maxPlays?plays/maxPlays:0;const cls=plays===0?"low":ratio>=.75?"top":ratio<.25?"low":"mid";const signal=plays===0?"No plays":cls==="top"?"Strong usage":cls==="low"?"Low usage":"Healthy usage";return `<tr><td><strong>${esc(GAME_LABELS[g.game_id]||g.game_id)}</strong><small>Last: ${when(g.last_played)}</small></td><td>${healthBadge({health_score:g.health_score,sample_state:g.sample_state,exposures:g.starts,exit_rate:g.exit_rate})}</td><td>${num(g.starts||0)}</td><td>${num(g.plays)}</td><td>${g.exit_rate==null?"—":esc(g.exit_rate)+"%"}</td><td>${num(g.unique_players)}</td><td>${g.avg_accuracy==null?"—":esc(g.avg_accuracy)+"%"}</td><td>${g.avg_score==null?"—":num(g.avg_score)}</td><td>${g.avg_duration_sec==null?"—":esc(g.avg_duration_sec)+" s"}</td><td>${g.verified_pct==null?"—":esc(g.verified_pct)+"%"}</td><td><span class="admin-analytics-signal ${cls}">${signal}</span></td></tr>`}).join("")}</tbody></table>${games.length?"":`<div class="admin-empty">No game telemetry in this period.</div>`}</div></section>
      <section class="admin-panel" style="margin-top:14px"><div class="admin-panel-head"><div><h2>Questions that need attention</h2><p>Signals from verified answers: unusual difficulty, high skip rate or weak distractors.</p></div><button class="admin-button" id="analyticsQuestionBank">Open Question Bank</button></div><div class="admin-mini-grid"><div class="admin-mini-card"><span>Too easy</span><strong>${num(qSummary.too_easy)}</strong></div><div class="admin-mini-card"><span>Too hard</span><strong>${num(qSummary.too_hard)}</strong></div><div class="admin-mini-card"><span>High skip</span><strong>${num(qSummary.high_skip)}</strong></div><div class="admin-mini-card"><span>Weak distractors</span><strong>${num(qSummary.weak_distractors)}</strong></div></div><div class="admin-table-wrap" style="margin-top:12px"><table class="admin-table"><thead><tr><th>Signal</th><th>Question</th><th>Topic</th><th>Attempts</th><th>Accuracy</th><th>Skip</th></tr></thead><tbody>${issues.slice(0,40).map(r=>`<tr class="clickable" data-analytics-q="${esc(r.question_version_id)}"><td>${qualityBadge(r.quality_state)}</td><td><strong>${esc(r.prompt)}</strong><small>${esc(r.external_key||"")}</small></td><td>${esc(r.topic_name||r.topic_slug)}</td><td>${num(r.attempts)}</td><td>${r.accuracy==null?"—":esc(r.accuracy)+"%"}</td><td>${r.skip_rate==null?"—":esc(r.skip_rate)+"%"}</td></tr>`).join("")}</tbody></table>${issues.length?"":`<div class="admin-empty">No question-quality issues with enough verified data.</div>`}</div></section>`;
    $("#analyticsDays").onchange=e=>renderAnalytics(Number(e.target.value));
    $("#analyticsHealthSort").onchange=e=>{state.analyticsHealthSort=e.target.value;renderAnalytics(Number($("#analyticsDays").value));};
    $("#analyticsRefresh").onclick=()=>renderAnalytics(Number($("#analyticsDays").value));
    $("#analyticsQuestionBank").onclick=()=>navigate("questions");
    document.querySelectorAll("[data-analytics-q]").forEach(row=>row.onclick=()=>openQuestionEditor(row.dataset.analyticsQ));
  }

  // ==========================================================
  // USERS
  // ==========================================================

  async function renderUsers(){
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar">
        <div class="admin-field grow"><label>Search</label><input class="admin-input" id="uSearch" placeholder="Display name, friend code, ranking name or UUID"></div>
        <button class="admin-button primary" id="uFilter">Search</button>
      </div>
      <div class="admin-note">
        Admin V1 intentionally does not browse <code>auth.users</code> or expose account emails in the browser. Account-level support requiring auth metadata should use a protected server-side/Edge Function later.
      </div>
      <div id="usersTable" style="margin-top:12px">${loading()}</div>
    `;

    $("#uFilter").onclick=loadUsersTable;
    $("#uSearch").onkeydown=e=>{if(e.key==="Enter") loadUsersTable()};
    await loadUsersTable();
  }

  async function loadUsersTable(){
    const holder=$("#usersTable");
    holder.innerHTML=loading();

    const data=await rpc("admin_list_users",{
      p_search:$("#uSearch")?.value||null,
      p_limit:100,
      p_offset:0
    });

    const rows=data?.rows||[];

    holder.innerHTML=`
      <div class="admin-panel-head">
        <div><h2>${num(data?.total)} cloud profiles</h2><p>Showing up to 100.</p></div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Player</th><th>Progression</th><th>Today</th><th>Social</th><th>Ranking</th></tr></thead>
          <tbody>
            ${rows.map(u=>`
              <tr class="clickable" data-user="${esc(u.user_id)}">
                <td><strong>${esc(u.display_name)}</strong><small>${esc(u.friend_code)} · ${esc(u.country||"—")}</small></td>
                <td>Lv ${num(u.level)} · ${num(u.xp)} XP<small>🔥 ${num(u.current_streak)} · ${num(u.total_games)} games</small></td>
                <td>${num(u.daily_score)}<small>${num(u.daily_games)} / 4 Daily Games</small></td>
                <td>${num(u.friend_count)} friends · ${num(u.group_count)} groups</td>
                <td>
                  ${u.leaderboard_enabled?badge("Public","ok"):badge("Private","info")}
                  ${u.ranking_suspended?badge("Suspended","bad"):""}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${rows.length?"":`<div class="admin-empty">No users found.</div>`}
      </div>
    `;

    holder.querySelectorAll("[data-user]").forEach(row=>{
      row.onclick=()=>openUserDetail(row.dataset.user);
    });
  }

  async function openUserDetail(id){
    const data=await rpc("admin_get_user_detail",{p_user_id:id});
    const p=data?.profile||{};
    const prog=data?.progression||{};
    const today=data?.today||{};
    const suspension=data?.ranking_suspension||null;

    openDrawer(`
      <span class="admin-eyebrow">Cloud profile</span>
      <h2>${esc(p.display_name||"Player")}</h2>
      <p>${esc(p.friend_code||"")} · ${esc(p.country||"No country")}</p>

      <div class="admin-mini-grid">
        <div class="admin-mini-card"><span>Level</span><strong>${num(prog.level||1)}</strong></div>
        <div class="admin-mini-card"><span>XP</span><strong>${num(prog.xp)}</strong></div>
        <div class="admin-mini-card"><span>Current streak</span><strong>🔥 ${num(prog.current_streak)}</strong></div>
        <div class="admin-mini-card"><span>Total games</span><strong>${num(prog.total_games)}</strong></div>
        <div class="admin-mini-card"><span>Today</span><strong>${num(today.daily_brain_score)}</strong></div>
        <div class="admin-mini-card"><span>Daily Games</span><strong>${num(today.daily_games_completed)} / 4</strong></div>
      </div>

      <dl class="admin-kv" style="margin-top:14px">
        <dt>User ID</dt><dd class="admin-code">${esc(p.user_id)}</dd>
        <dt>Friend code</dt><dd>${esc(p.friend_code)}</dd>
        <dt>Country</dt><dd>${esc(p.country||"—")}</dd>
        <dt>Public ranking</dt><dd>${p.leaderboard_enabled?`Enabled as ${esc(p.ranking_name||"—")}`:"Private"}</dd>
        <dt>Created</dt><dd>${when(p.created_at)}</dd>
      </dl>

      ${suspension?.active?`
        <div class="admin-note admin-danger-note" style="margin-top:12px">
          Public ranking suspended: ${esc(suspension.reason||"No reason")} ${suspension.expires_at?`· until ${when(suspension.expires_at)}`:""}
        </div>
      `:""}

      ${isOwner()?`
        <div class="admin-drawer-actions">
          <button class="admin-button ${suspension?.active?"success":"danger"}" id="userRankModeration">
            ${suspension?.active?"Restore public ranking":"Suspend from public rankings"}
          </button>
        </div>
      `:""}

      <section class="admin-panel" style="margin-top:14px">
        <h2>Recent results</h2>
        <div class="admin-question-list" style="margin-top:10px">
          ${(data.recent_results||[]).map(r=>`
            <div class="admin-question-item">
              <span class="pos">▶</span>
              <div><strong>${esc(r.game_id)}</strong><small>${when(r.completed_at)}</small></div>
              <strong>${r.score==null?"—":num(r.score)}</strong>
              ${r.answers_verified?badge("Verified","ok"):badge("Unverified","warn")}
            </div>`).join("")}
        </div>
      </section>

      <section class="admin-panel" style="margin-top:14px">
        <h2>Groups</h2>
        <div class="admin-question-list" style="margin-top:10px">
          ${(data.groups||[]).map(g=>`
            <div class="admin-question-item">
              <span class="pos">🛡</span>
              <div><strong>${esc(g.name)}</strong><small>${esc(g.country||"")} · ${esc(g.role)}</small></div>
              <span></span><span></span>
            </div>`).join("") || `<div class="admin-empty">No active groups.</div>`}
        </div>
      </section>
    `);

    $("#userRankModeration")?.addEventListener("click",async()=>{
      const active=!suspension?.active;
      const reason=active
        ? prompt("Internal moderation reason:")
        : "Restored by admin";

      if(reason===null) return;

      try{
        await rpc("admin_set_ranking_suspension",{
          p_entity_type:"user",
          p_entity_id:p.user_id,
          p_active:active,
          p_reason:reason,
          p_expires_at:null
        });
        toast(active?"Ranking suspended":"Ranking restored");
        await openUserDetail(p.user_id);
      }catch(err){toast(cleanError(err))}
    });
  }


  // ==========================================================
  // RANKINGS
  // ==========================================================

  async function renderRankings(){
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar">
        <div class="admin-field">
          <label>Region</label>
          <select class="admin-select" id="aRankRegion">
            <option value="global">Global</option>
            <option value="country">Country</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Country</label>
          <input class="admin-input" id="aRankCountry" maxlength="2" placeholder="ES">
        </div>
        <div class="admin-field">
          <label>Period</label>
          <select class="admin-select" id="aRankPeriod">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Game</label>
          <select class="admin-select" id="aRankGame">
            <option value="all">All games</option>
            ${["brainmix","orderup","topicrush","brainiword","worldflags","worldcapitals","science","history","sports"].map(x=>`<option value="${x}">${x}</option>`).join("")}
          </select>
        </div>
        <div class="admin-field">
          <label>Metric</label>
          <select class="admin-select" id="aRankMetric">
            <option value="score">Score</option>
            <option value="streak">Streak</option>
          </select>
        </div>
        <button class="admin-button primary" id="aRankLoad">Load</button>
      </div>

      <div class="admin-note">
        Friends Rankings are intentionally not exposed as a global social graph in Admin. They remain private per accepted friendship network. Use a specific user's support context only when needed.
      </div>

      <div id="adminRankingBody" style="margin-top:12px">${loading()}</div>
    `;

    $("#aRankLoad").onclick=loadAdminRankings;
    await loadAdminRankings();
  }

  async function loadAdminRankings(){
    const holder=$("#adminRankingBody");
    holder.innerHTML=loading();

    const region=$("#aRankRegion").value;
    const country=region==="country"
      ? ($("#aRankCountry").value||"").trim().toUpperCase()
      : null;
    const period=$("#aRankPeriod").value;
    const game=$("#aRankGame").value;
    const metric=$("#aRankMetric").value;

    let individual={rows:[],total_players:0};
    let groups={rows:[],total_players:0};

    try{
      individual=await rpc("get_brainilab_individual_rankings",{
        p_region:region,
        p_country_code:country,
        p_period:period,
        p_game_id:game,
        p_metric:metric,
        p_limit:100
      })||individual;
    }catch(err){
      individual={rows:[],total_players:0,error:cleanError(err)};
    }

    try{
      groups=await rpc("get_brainilab_group_rankings",{
        p_region:region,
        p_country_code:country,
        p_period:period,
        p_game_id:game,
        p_metric:metric,
        p_limit:100
      })||groups;
    }catch(err){
      groups={rows:[],total_players:0,error:cleanError(err)};
    }

    holder.innerHTML=`
      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Individual</h2><p>${num(individual.total_players)} ranked public profiles</p></div></div>
          ${rankingTable(individual.rows||[],"player")}
          ${individual.error?`<div class="admin-note admin-danger-note">${esc(individual.error)}</div>`:""}
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Groups</h2><p>${num(groups.total_players)} eligible ranked groups</p></div></div>
          ${rankingTable(groups.rows||[],"group")}
          ${groups.error?`<div class="admin-note admin-danger-note">${esc(groups.error)}</div>`:""}
        </section>
      </div>
    `;
  }

  function rankingTable(rows,type){
    if(!rows.length) return `<div class="admin-empty">No ranked scores in this selection.</div>`;

    return `<div class="admin-table-wrap">
      <table class="admin-table" style="min-width:560px">
        <thead><tr><th>Rank</th><th>${type==="group"?"Group":"Player"}</th><th>Country</th><th>Score</th></tr></thead>
        <tbody>
          ${rows.slice(0,20).map(r=>`
            <tr>
              <td><strong>#${esc(r.rank)}</strong></td>
              <td>${esc(r.name)}</td>
              <td>${esc(r.country||"—")}</td>
              <td><strong>${esc(r.display_value||num(r.score))}</strong></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }


  // ==========================================================
  // GROUPS
  // ==========================================================

  async function renderGroups(){
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar">
        <div class="admin-field grow"><label>Search</label><input class="admin-input" id="gSearch" placeholder="Group name, owner or UUID"></div>
        <button class="admin-button primary" id="gFilter">Search</button>
      </div>
      <div id="groupsTable">${loading()}</div>
    `;

    $("#gFilter").onclick=loadGroupsTable;
    $("#gSearch").onkeydown=e=>{if(e.key==="Enter") loadGroupsTable()};
    await loadGroupsTable();
  }

  async function loadGroupsTable(){
    const data=await rpc("admin_list_groups",{
      p_search:$("#gSearch")?.value||null,
      p_limit:100,
      p_offset:0
    });

    const rows=data?.rows||[];
    const holder=$("#groupsTable");

    holder.innerHTML=`
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Group</th><th>Owner</th><th>Country</th><th>Members</th><th>Ranking</th><th>Created</th></tr></thead>
          <tbody>
            ${rows.map(g=>`
              <tr class="clickable" data-group="${esc(g.group_id)}">
                <td><strong>${esc(g.crest?.icon||"🛡")} ${esc(g.name)}</strong></td>
                <td>${esc(g.owner_name)}</td>
                <td>${esc(g.country||"—")}</td>
                <td>${num(g.member_count)} / 5 ${g.eligible?badge("Eligible","ok"):badge("Building","info")}</td>
                <td>${g.ranking_suspended?badge("Suspended","bad"):badge("Active","ok")}</td>
                <td>${when(g.created_at)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${rows.length?"":`<div class="admin-empty">No groups found.</div>`}
      </div>
    `;

    holder.querySelectorAll("[data-group]").forEach(row=>{
      row.onclick=()=>openGroupDetail(row.dataset.group);
    });
  }

  async function openGroupDetail(id){
    const data=await rpc("admin_get_group_detail",{p_group_id:id});
    const g=data?.group||{};
    const suspension=data?.ranking_suspension||null;

    openDrawer(`
      <span class="admin-eyebrow">Group</span>
      <h2>${esc(g.crest?.icon||"🛡")} ${esc(g.name||"Group")}</h2>
      <p>${esc(g.country||"No country")} · created ${when(g.created_at)}</p>

      ${suspension?.active?`
        <div class="admin-note admin-danger-note">
          Group ranking suspended: ${esc(suspension.reason||"No reason")}
        </div>
      `:""}

      <section class="admin-panel" style="margin-top:14px">
        <h2>Members</h2>
        <div class="admin-question-list" style="margin-top:10px">
          ${(data.members||[]).map(m=>`
            <div class="admin-question-item">
              <span class="pos">${m.role==="owner"?"★":"•"}</span>
              <div><strong>${esc(m.name)}</strong><small>${esc(m.friend_code)} · ${esc(m.country||"")} · ${esc(m.role)}</small></div>
              <span></span><span></span>
            </div>`).join("")}
        </div>
      </section>

      ${isOwner()?`
        <div class="admin-drawer-actions">
          <button class="admin-button ${suspension?.active?"success":"danger"}" id="groupRankModeration">
            ${suspension?.active?"Restore group ranking":"Suspend group from rankings"}
          </button>
        </div>
      `:""}
    `);

    $("#groupRankModeration")?.addEventListener("click",async()=>{
      const active=!suspension?.active;
      const reason=active
        ? prompt("Internal moderation reason:")
        : "Restored by admin";

      if(reason===null) return;

      try{
        await rpc("admin_set_ranking_suspension",{
          p_entity_type:"group",
          p_entity_id:g.id,
          p_active:active,
          p_reason:reason,
          p_expires_at:null
        });
        toast(active?"Group ranking suspended":"Group ranking restored");
        await openGroupDetail(g.id);
      }catch(err){toast(cleanError(err))}
    });
  }


  // ==========================================================
  // SUGGESTIONS
  // ==========================================================

  async function renderSuggestions(){
    $("#adminContent").innerHTML=`
      <div class="admin-toolbar">
        <div class="admin-field">
          <label>Status</label>
          <select class="admin-select" id="sStatus">
            <option value="">All</option>
            <option value="new">New</option>
            <option value="reviewing">Reviewing</option>
            <option value="planned">Planned</option>
            <option value="done">Done</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
        <button class="admin-button primary" id="sFilter">Load</button>
      </div>
      <div id="suggestionList">${loading()}</div>
    `;

    $("#sFilter").onclick=loadSuggestions;
    await loadSuggestions();
  }

  async function loadSuggestions(){
    const rows=await rpc("admin_list_suggestions",{
      p_status:$("#sStatus")?.value||null,
      p_limit:200
    });

    const root=$("#suggestionList");

    root.innerHTML=(rows||[]).map(s=>`
      <article class="admin-suggestion">
        <div class="admin-suggestion-head">
          <div>
            ${badge(s.type,"info")}
            ${badge(s.status,s.status==="new"?"warn":s.status==="done"?"ok":"info")}
          </div>
          <small>${when(s.created_at)}</small>
        </div>

        <p>${esc(s.message)}</p>

        <small>
          ${s.player?`Player: ${esc(s.player)} · `:""}
          ${s.reply_email?`Reply email: ${esc(s.reply_email)}`:"No reply email"}
        </small>

        <div class="admin-suggestion-actions">
          <select class="admin-select" data-s-status="${esc(s.id)}">
            ${["new","reviewing","planned","done","ignored"].map(x=>`<option value="${x}" ${x===s.status?"selected":""}>${x}</option>`).join("")}
          </select>
          <input class="admin-input" data-s-note="${esc(s.id)}" value="${esc(s.internal_note||"")}" placeholder="Internal note">
          <button class="admin-button" data-s-save="${esc(s.id)}">Save</button>
        </div>
      </article>`).join("") || `<div class="admin-empty">No suggestions in this filter.</div>`;

    root.querySelectorAll("[data-s-save]").forEach(btn=>{
      btn.onclick=async()=>{
        const id=btn.dataset.sSave;
        try{
          await rpc("admin_update_suggestion",{
            p_suggestion_id:id,
            p_status:root.querySelector(`[data-s-status="${id}"]`).value,
            p_internal_note:root.querySelector(`[data-s-note="${id}"]`).value||null
          });
          toast("Suggestion updated");
          loadSuggestions();
        }catch(err){toast(cleanError(err))}
      };
    });
  }


  // ==========================================================
  // MONETIZATION
  // ==========================================================

  async function renderMonetization(){
    if(!isOwner()){
      $("#adminContent").innerHTML=`
        <div class="admin-panel">
          <h2>Owner access required</h2>
          <p>
            Billing state and monetization launch switches are
            owner-only operations.
          </p>
        </div>`;
      return;
    }

    const health=
      await rpc(
        "admin_get_monetization_health"
      );

    const subscriptions=
      health.subscriptions||{};
    const webhooks=
      health.webhooks||{};
    const flags=
      health.flags||{};

    const config=
      window.BRAINI_MONETIZATION_CONFIG||{};

    const adConfig=config.ads||{};
    const publisherReady=
      !!String(adConfig.publisherId||"").trim();

    const configuredSlots=
      Object.values(adConfig.slots||{})
        .filter(value=>String(value||"").trim())
        .length;

    const flagLabels={
      ads_enabled:"Ads globally",
      plus_enabled:"BrainiLab+ sales",

      ad_home_after_play_enabled:"Home · after Play Anytime",
      ad_games_mid_content_enabled:"Games · mid content",
      ad_daily_lower_enabled:"Daily · lower page",
      ad_quiz_result_enabled:"Anytime quiz result",
      ad_rankings_after_board_enabled:"Rankings · after board",
      ad_about_lower_enabled:"About · lower page",

      anchor_ads_enabled:"Anchor ads",
      vignette_ads_enabled:"Vignette ads"
    };

    const launchFlags=[
      "ads_enabled",
      "plus_enabled"
    ];

    const displayFlags=[
      "ad_home_after_play_enabled",
      "ad_games_mid_content_enabled",
      "ad_daily_lower_enabled",
      "ad_quiz_result_enabled",
      "ad_rankings_after_board_enabled",
      "ad_about_lower_enabled"
    ];

    const futureFlags=[
      "anchor_ads_enabled",
      "vignette_ads_enabled"
    ];

    function flagRow(key){
      const value=flags[key]||{
        enabled:false,
        message:null
      };

      return `
        <div class="admin-flag-row">
          <div>
            <strong>
              ${esc(flagLabels[key]||key)}
            </strong>
            <small>
              ${esc(
                value.message
                || (
                  value.enabled
                    ?"Enabled"
                    :"Disabled"
                )
              )}
            </small>
          </div>

          <button
            class="admin-toggle ${value.enabled?"on":""}"
            data-monetization-flag="${esc(key)}"
            data-enabled="${value.enabled===true}"
            aria-label="Toggle ${esc(flagLabels[key]||key)}"
          ></button>
        </div>
      `;
    }

    $("#adminContent").innerHTML=`
      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>BrainiLab+</h2>
              <p>
                Subscription state synchronized from Stripe webhooks.
              </p>
            </div>
          </div>

          <div class="admin-mini-grid">
            <div class="admin-mini-card">
              <span>Active Plus</span>
              <strong>${num(subscriptions.active)}</strong>
            </div>

            <div class="admin-mini-card">
              <span>Monthly</span>
              <strong>${num(subscriptions.monthly)}</strong>
            </div>

            <div class="admin-mini-card">
              <span>Annual</span>
              <strong>${num(subscriptions.yearly)}</strong>
            </div>

            <div class="admin-mini-card">
              <span>Past due</span>
              <strong>${num(subscriptions.past_due)}</strong>
            </div>

            <div class="admin-mini-card">
              <span>Scheduled cancellations</span>
              <strong>${num(subscriptions.scheduled_cancellations)}</strong>
            </div>
          </div>
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>Stripe webhooks</h2>
              <p>
                Operational health only. No card data is stored here.
              </p>
            </div>
          </div>

          <dl class="admin-kv">
            <dt>Events received</dt>
            <dd>${num(webhooks.total)}</dd>

            <dt>Failed</dt>
            <dd>${num(webhooks.failed)}</dd>

            <dt>Pending</dt>
            <dd>${num(webhooks.pending)}</dd>

            <dt>Latest received</dt>
            <dd>${when(webhooks.latest_received_at)}</dd>

            <dt>Latest processed</dt>
            <dd>${when(webhooks.latest_processed_at)}</dd>
          </dl>
        </section>
      </div>

      <div class="admin-panels" style="margin-top:14px">
        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>Launch readiness</h2>
              <p>
                Public IDs are checked in the browser config.
                Stripe secrets remain server-only.
              </p>
            </div>
          </div>

          <div class="admin-health-list">
            ${healthRow(
              "AdSense publisher ID",
              publisherReady
                ?"Configured"
                :"Not configured",
              publisherReady
            )}

            ${healthRow(
              "AdSense manual slots",
              `${configuredSlots}/6 configured`,
              configuredSlots===6
            )}

            ${healthRow(
              "Ads global launch flag",
              flags.ads_enabled?.enabled
                ?"ON"
                :"OFF",
              flags.ads_enabled?.enabled!==true
            )}

            ${healthRow(
              "Plus sales launch flag",
              flags.plus_enabled?.enabled
                ?"ON"
                :"OFF",
              flags.plus_enabled?.enabled!==true
            )}

            ${healthRow(
              "Anchor ads",
              flags.anchor_ads_enabled?.enabled
                ?"ON"
                :"OFF",
              flags.anchor_ads_enabled?.enabled!==true
            )}

            ${healthRow(
              "Vignette ads",
              flags.vignette_ads_enabled?.enabled
                ?"ON"
                :"OFF",
              flags.vignette_ads_enabled?.enabled!==true
            )}
          </div>

          <div class="admin-note" style="margin-top:12px">
            Launch order: configure CMP + AdSense IDs + ads.txt,
            verify Stripe live Checkout/webhook/Portal, then turn on
            individual placements before enabling Ads globally.
          </div>
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>Global launch switches</h2>
              <p>
                Keep both OFF until the corresponding production services are configured and verified.
              </p>
            </div>
          </div>

          ${launchFlags.map(flagRow).join("")}
        </section>
      </div>

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Manual display placements</h2>
            <p>
              No active gameplay placement exists by design.
            </p>
          </div>
        </div>

        ${displayFlags.map(flagRow).join("")}
      </section>

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Future ad formats</h2>
            <p>
              Prepared but keep OFF for the initial launch.
            </p>
          </div>
        </div>

        ${futureFlags.map(flagRow).join("")}
      </section>
    `;

    document
      .querySelectorAll(
        "[data-monetization-flag]"
      )
      .forEach(button=>{
        button.onclick=async()=>{
          const key=
            button.dataset
              .monetizationFlag;

          const currently=
            button.dataset.enabled==="true";

          const enabled=!currently;

          if(
            key==="ads_enabled"
            && enabled
            && (
              !publisherReady
              || configuredSlots<1
            )
          ){
            alert(
              "Configure the AdSense publisher ID and at least one slot before enabling Ads globally."
            );
            return;
          }

          if(
            (
              key==="anchor_ads_enabled"
              || key==="vignette_ads_enabled"
            )
            && enabled
          ){
            if(
              !confirm(
                `${flagLabels[key]} is intentionally a post-launch experiment. Enable it anyway?`
              )
            ){
              return;
            }
          }else if(
            !confirm(
              `${enabled?"Enable":"Disable"} ${flagLabels[key]}?`
            )
          ){
            return;
          }

          try{
            await rpc(
              "admin_set_brainilab_runtime_flag",
              {
                p_flag_key:key,
                p_enabled:enabled,
                p_message:null
              }
            );

            toast(
              "Monetization flag updated"
            );

            renderMonetization();
          }catch(err){
            toast(cleanError(err));
          }
        };
      });
  }


  // ==========================================================
  // SYSTEM
  // ==========================================================

  async function renderSystem(){
    const [h,topicRushTopics]=await Promise.all([
      rpc("admin_get_system_health"),
      rpc("admin_list_topic_rush_topics")
    ]);
    const db=h.database||{};
    const flags=h.runtime_flags||{};

    $("#adminContent").innerHTML=`
      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Backend components</h2><p>Schema presence checks.</p></div></div>
          <div class="admin-health-list">
            ${Object.entries(db).map(([k,v])=>healthRow(k.replaceAll("_"," "),v?"Installed":"Missing",!!v)).join("")}
          </div>
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Daily generation</h2><p>UTC automated schedule.</p></div></div>
          <dl class="admin-kv">
            <dt>Latest generated</dt><dd>${esc(h.daily?.latest_generated_date||"—")}</dd>
            <dt>Future ready days</dt><dd>${num(h.daily?.future_ready_days)}</dd>
            <dt>Configured lookahead</dt><dd>${num(h.daily?.lookahead_days)} days</dd>
            <dt>Question cooldown</dt><dd>${num(h.daily?.cooldown_days)} days</dd>
            <dt>Topic Rush active topics</dt><dd>${num((topicRushTopics||[]).filter(x=>x.active).length)} / minimum 15</dd>
          </dl>

          ${canOperateDaily()?`
            <div class="admin-toolbar" style="margin-top:12px">
              <button class="admin-button primary" id="systemMaintenance">Run maintenance now</button>
            </div>
          `:""}
        </section>
      </div>

      <div class="admin-panels">
        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Cron</h2><p>brainilab-daily-maintenance</p></div></div>
          ${(h.cron||[]).length
            ? (h.cron||[]).map(c=>`
              <dl class="admin-kv">
                <dt>Job</dt><dd>${esc(c.jobname||c.error||"—")}</dd>
                <dt>Schedule</dt><dd class="admin-code">${esc(c.schedule||"—")}</dd>
                <dt>Active</dt><dd>${c.active===true?"Yes":c.active===false?"No":"—"}</dd>
                <dt>Last status</dt><dd>${esc(c.last_status||"—")}</dd>
                <dt>Last start</dt><dd>${when(c.last_start)}</dd>
                <dt>Last end</dt><dd>${when(c.last_end)}</dd>
              </dl>`).join("")
            : `<div class="admin-empty">Cron metadata unavailable.</div>`
          }
        </section>

        <section class="admin-panel">
          <div class="admin-panel-head"><div><h2>Admin security</h2><p>Current browser session.</p></div></div>
          <dl class="admin-kv">
            <dt>Role</dt><dd>${esc(state.admin.role)}</dd>
            <dt>JWT AAL</dt><dd>${esc(state.admin.aal||"aal1")}</dd>
            <dt>MFA required</dt><dd>${state.admin.require_mfa?"Yes":"No"}</dd>
            <dt>MFA satisfied</dt><dd>${state.admin.mfa_satisfied?"Yes":"No"}</dd>
          </dl>
          ${!state.admin.require_mfa && state.admin.role==="owner"?`
            <div class="admin-note" style="margin-top:10px">
              Owner MFA is not required yet. Enroll a TOTP authenticator here, verify it to reach AAL2, then Admin will make MFA mandatory for future admin sessions.
            </div>
            <div class="admin-toolbar" style="margin-top:10px">
              <button class="admin-button primary" id="adminEnableMfa">Enroll & require MFA</button>
            </div>`:""}
        </section>
      </div>

      <section class="admin-panel" style="margin-top:14px">
        <div class="admin-panel-head">
          <div>
            <h2>Emergency feature flags</h2>
            <p>Owner-only kill switches. These do not delete data.</p>
          </div>
        </div>

        ${Object.entries(flags).map(([key,val])=>`
          <div class="admin-flag-row">
            <div>
              <strong>${esc(key.replaceAll("_"," "))}</strong>
              <small>${esc(val.message||"No status message")}</small>
            </div>
            <button
              class="admin-toggle ${val.enabled?"on":""}"
              data-runtime-flag="${esc(key)}"
              data-enabled="${val.enabled}"
              ${isOwner()?"":"disabled"}
              aria-label="Toggle ${esc(key)}"
            ></button>
          </div>`).join("")}
      </section>
    `;

    $("#adminEnableMfa")?.addEventListener("click",setupAdminMfa);

    $("#systemMaintenance")?.addEventListener("click",async()=>{
      try{
        await rpc("admin_run_daily_maintenance");
        toast("Maintenance completed");
        renderSystem();
      }catch(err){toast(cleanError(err))}
    });

    document.querySelectorAll("[data-runtime-flag]").forEach(btn=>{
      btn.onclick=async()=>{
        if(!isOwner()) return;

        const key=btn.dataset.runtimeFlag;
        const currently=btn.dataset.enabled==="true";
        const enabled=!currently;

        let message=null;
        if(!enabled || key==="maintenance_enabled"){
          message=prompt(
            enabled
              ? "Optional status message:"
              : "Message shown to users while this feature is disabled:",
            ""
          );
          if(message===null) return;
        }

        if(
          !confirm(
            `${enabled?"Enable":"Disable"} ${key.replaceAll("_"," ")}?`
          )
        ) return;

        try{
          await rpc("admin_set_brainilab_runtime_flag",{
            p_flag_key:key,
            p_enabled:enabled,
            p_message:message||null
          });
          toast("Runtime flag updated");
          renderSystem();
        }catch(err){toast(cleanError(err))}
      };
    });
  }


  // ==========================================================
  // AUDIT
  // ==========================================================

  async function renderAudit(){
    const rows=await rpc("admin_list_audit_log",{p_limit:200});

    $("#adminContent").innerHTML=`
      <div class="admin-note">
        Audit entries are written by server-side admin RPCs. Browser roles have no direct INSERT, UPDATE or DELETE access to the audit table.
      </div>
      <div class="admin-table-wrap" style="margin-top:12px">
        <table class="admin-table">
          <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Entity</th><th>Metadata</th></tr></thead>
          <tbody>
            ${(rows||[]).map(r=>`
              <tr>
                <td>${when(r.created_at)}</td>
                <td>${esc(r.admin_name||r.admin_user_id)}</td>
                <td><strong>${esc(r.action)}</strong></td>
                <td>${esc(r.entity_type||"—")}<small class="admin-code">${esc(r.entity_id||"")}</small></td>
                <td><span class="admin-code">${esc(JSON.stringify(r.metadata||{}))}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${(rows||[]).length?"":`<div class="admin-empty">No audited admin mutations yet.</div>`}
      </div>
    `;
  }



  async function setupAdminMfa(){
    try{
      const {data:list,error:listError}=await state.sb.auth.mfa.listFactors();
      if(listError) throw listError;

      const verified=(list?.totp||[]).filter(
        f=>f.status==="verified"
      );

      if(verified.length){
        const factor=verified[0];
        const code=prompt(
          "Enter the 6-digit code from your authenticator to reach AAL2:"
        );
        if(code===null) return;

        const {data:challenge,error:challengeError}=
          await state.sb.auth.mfa.challenge({
            factorId:factor.id
          });
        if(challengeError) throw challengeError;

        const {error:verifyError}=await state.sb.auth.mfa.verify({
          factorId:factor.id,
          challengeId:challenge.id,
          code:code.trim()
        });
        if(verifyError) throw verifyError;

        await rpc("admin_enable_own_mfa_requirement");
        toast("MFA is now required for Admin");
        await state.sb.auth.refreshSession();
        await resolveAccess();
        renderSystem();
        return;
      }

      const {data:enrolled,error:enrollError}=
        await state.sb.auth.mfa.enroll({
          factorType:"totp"
        });

      if(enrollError) throw enrollError;

      const factorId=enrolled?.id;
      const totp=enrolled?.totp||{};
      const qr=totp.qr_code||"";
      const secret=totp.secret||"";

      openDrawer(`
        <span class="admin-eyebrow">Admin security</span>
        <h2>Set up authenticator MFA</h2>
        <p>Scan the QR code in an authenticator app, or enter the secret manually. Then type the current 6-digit code.</p>

        ${qr && String(qr).startsWith("data:image/")
          ? `<div style="display:grid;place-items:center;padding:15px"><img src="${esc(qr)}" alt="TOTP QR code" style="width:210px;max-width:70%"></div>`
          : ""
        }

        <div class="admin-field">
          <label>TOTP secret</label>
          <div style="display:flex;gap:6px">
            <input class="admin-input admin-code" id="mfaSecret" value="${esc(secret)}" readonly>
            <button class="admin-button" id="copyMfaSecret">Copy</button>
          </div>
        </div>

        <div class="admin-field" style="margin-top:10px">
          <label>6-digit verification code</label>
          <input class="admin-input" id="mfaCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456">
        </div>

        <div class="admin-note" style="margin-top:10px">
          Once verified, BrainiLab will set <code>require_mfa=true</code> for this admin account. Losing the factor requires recovery from Supabase SQL Editor.
        </div>

        <div class="admin-drawer-actions">
          <button class="admin-button primary" id="verifyMfa">Verify & require MFA</button>
        </div>
      `);

      $("#copyMfaSecret").onclick=()=>copyText(secret);

      $("#verifyMfa").onclick=async()=>{
        try{
          const code=$("#mfaCode").value.trim();

          const {data:challenge,error:challengeError}=
            await state.sb.auth.mfa.challenge({
              factorId
            });
          if(challengeError) throw challengeError;

          const {error:verifyError}=await state.sb.auth.mfa.verify({
            factorId,
            challengeId:challenge.id,
            code
          });
          if(verifyError) throw verifyError;

          await state.sb.auth.refreshSession();
          await rpc("admin_enable_own_mfa_requirement");

          toast("MFA enrolled and required");
          closeDrawer();

          await resolveAccess();
          renderSystem();
        }catch(err){
          toast(cleanError(err));
        }
      };

    }catch(err){
      toast(cleanError(err));
    }
  }


  // ==========================================================
  // BOOT
  // ==========================================================

  async function boot(){
    const cfg=window.BRAINI_SUPABASE||{};

    if(
      !window.supabase
      || !cfg.url
      || !cfg.publishableKey
    ){
      renderAuth(
        "Supabase configuration is missing. Admin cannot run without the normal BrainiLab publishable client configuration."
      );
      return;
    }

    state.sb=window.supabase.createClient(
      cfg.url,
      cfg.publishableKey,
      {
        auth:{
          persistSession:true,
          autoRefreshToken:true,
          detectSessionInUrl:true
        }
      }
    );

    $("#adminDrawerClose").onclick=closeDrawer;
    $("#adminDrawerBackdrop").onclick=e=>{
      if(e.target===$("#adminDrawerBackdrop")) closeDrawer();
    };

    $("#adminSignOut").onclick=signOut;
    $("#adminRefresh").onclick=()=>navigate(state.currentView,{replace:true});

    window.addEventListener("popstate",()=>{
      const view=location.hash.slice(1)||"dashboard";
      navigate(view,{replace:true});
    });

    state.sb.auth.onAuthStateChange(()=>{
      setTimeout(async()=>{
        try{
          const ok=await resolveAccess();
          if(ok){
            const requested=location.hash.slice(1)||"dashboard";
            navigate(requested,{replace:true});
          }
        }catch(err){
          console.error(err);
        }
      },0);
    });

    try{
      const ok=await resolveAccess();
      if(ok){
        const requested=location.hash.slice(1)||"dashboard";
        navigate(requested,{replace:true});
      }
    }catch(err){
      renderAuth(
        `<div class="admin-auth-denied">
          Admin initialization failed: ${esc(cleanError(err))}
        </div>`,
        `<div class="admin-auth-actions">
          <button class="admin-auth-secondary" data-reload>Reload</button>
        </div>`
      );
      $("#adminAuthActions [data-reload]").onclick=()=>location.reload();
    }
  }

  document.addEventListener("DOMContentLoaded",boot);

  return {
    boot,
    navigate,
    state
  };
})();
