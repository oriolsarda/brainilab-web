/* ===== supabase-analytics.js ===== */

/*
  BrainiLab Player Analytics — Step 17
  Private cloud adapter for My BrainiLab → My Stats.
*/
window.BrainiAnalytics=(function(){
  const cache=new Map();
  let lastError=null;
  let loading=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  async function session(){
    if(!configured()) return null;
    return BrainiBackendAuth.getSession();
  }

  function normalizeDays(days){
    const n=Number(days);
    if(n===0) return 0;
    if(n===7 || n===30 || n===90) return n;
    return 30;
  }

  async function fetchStats(days=30,{force=false}={}){
    const range=normalizeDays(days);

    if(!configured()){
      return null;
    }

    const current=await session();
    if(!current?.user){
      return null;
    }

    if(!force && cache.has(range)){
      return structuredClone(cache.get(range));
    }

    if(loading && loading.range===range){
      return loading.promise;
    }

    lastError=null;

    const promise=(async()=>{
      const sb=client();

      const {data,error}=await sb.rpc(
        "get_my_brainilab_stats",
        {p_days:range}
      );

      if(error){
        lastError=error;
        throw error;
      }

      const snapshot=data||{};
      cache.set(range,snapshot);

      window.dispatchEvent(
        new CustomEvent(
          "brainilab:analyticschange",
          {
            detail:{
              range,
              snapshot
            }
          }
        )
      );

      return structuredClone(snapshot);
    })();

    loading={range,promise};

    try{
      return await promise;
    }finally{
      if(loading?.promise===promise){
        loading=null;
      }
    }
  }

  function getCached(days=30){
    const range=normalizeDays(days);
    const value=cache.get(range);
    return value?structuredClone(value):null;
  }

  function invalidate(){
    cache.clear();
  }

  function getLastError(){
    return lastError;
  }

  window.addEventListener(
    "brainilab:authchange",
    invalidate
  );

  window.addEventListener(
    "brainilab:cloudgame",
    invalidate
  );

  window.addEventListener(
    "brainilab:progressionchange",
    invalidate
  );

  return {
    configured,
    fetchStats,
    getCached,
    invalidate,
    getLastError
  };
})();

/* ===== stats-ui.js ===== */

/*
  BrainiLab My Stats — V41.8.0
  No chart library: small accessible SVG charts + semantic HTML.
*/
window.BrainiStatsUI=(function(){
  const RANGE_OPTIONS=[
    {days:7,label:"7 days"},
    {days:30,label:"30 days"},
    {days:90,label:"3 months"},
    {days:0,label:"All time"}
  ];

  const GAME_FILTERS=[
    {id:"allquiz",label:"All quizzes"},{id:"brainmix",label:"Brain Mix"},{id:"brainiword",label:"BrainiWord"},
    {id:"orderup",label:"Order Up"},{id:"topicrush",label:"Topic Rush"},{id:"connections",label:"Connections"},
    {id:"survival",label:"Survival"},{id:"oddoneout",label:"Odd One Out"},{id:"higherlower",label:"Higher / Lower"},
    {id:"mathrush",label:"Math Rush"},{id:"numberroute",label:"Number Route"},{id:"sequence",label:"Sequence"},
    {id:"anytime",label:"Category quizzes"}
  ];

  const QUIZ_IDS=new Set([
    "brainmix",
    "generalknowledge",
    "worldflags",
    "worldcapitals",
    "science",
    "history",
    "sports"
  ]);

  const ANYTIME_IDS=new Set([
    "generalknowledge",
    "worldflags",
    "worldcapitals",
    "science",
    "history",
    "sports"
  ]);

  const GAME_NAMES={
    brainmix:"Brain Mix",brainiword:"BrainiWord",orderup:"Order Up",topicrush:"Topic Rush",connections:"Connections",
    survival:"Survival",oddoneout:"Odd One Out",higherlower:"Higher or Lower",mathrush:"Math Rush",numberroute:"Number Route",sequence:"Sequence",
    generalknowledge:"General Knowledge",worldflags:"World Flags",worldcapitals:"World Capitals",science:"Science",history:"History",sports:"Sports"
  };

  const CATEGORY_NAMES={
    general:"General Knowledge",
    geography:"Geography",
    science:"Science",
    history:"History",
    sports:"Sports"
  };

  let range=30;
  let gameFilter="allquiz";
  let renderToken=0;

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

  function pct(value,digits=0){
    if(value===null || value===undefined || value===""){
      return "—";
    }

    const n=Number(value);
    if(!Number.isFinite(n)) return "—";

    return `${n.toFixed(digits)}%`;
  }

  function shortDate(value){
    if(!value) return "—";

    const d=new Date(
      String(value).length===10
        ? `${value}T12:00:00`
        : value
    );

    return new Intl.DateTimeFormat(
      undefined,
      {
        month:"short",
        day:"numeric"
      }
    ).format(d);
  }

  function longDate(value){
    if(!value) return "—";

    const d=new Date(value);

    return new Intl.DateTimeFormat(
      undefined,
      {
        month:"short",
        day:"numeric",
        year:"numeric"
      }
    ).format(d);
  }

  function rangeLabel(){
    return RANGE_OPTIONS.find(
      x=>x.days===range
    )?.label||"30 days";
  }

  function root(){
    return document.querySelector(
      "[data-my-stats-root]"
    );
  }

  function authenticated(){
    return BrainiData.authState().status===
      "authenticated";
  }

  function signInState(container){
    container.innerHTML=`
      <div class="stats-signin-card">
        <span>MY STATS</span>
        <h2>Build your personal performance history</h2>
        <p>
          Sign in to keep your BrainiLab statistics synced across devices
          and unlock trends, category strengths, Daily performance and
          detailed game analytics.
        </p>
        <button
          class="btn"
          type="button"
          data-stats-signin
        >
          Log in
        </button>
      </div>`;

    container
      .querySelector("[data-stats-signin]")
      ?.addEventListener(
        "click",
        ()=>BrainiAuth.open({
          source:"my_stats"
        })
      );
  }

  function loadingState(container){
    container.innerHTML=`
      <div class="stats-loading">
        <div class="stats-loading-dot"></div>
        <strong>Building your stats…</strong>
        <span>
          Analysing your synced BrainiLab results.
        </span>
      </div>`;
  }

  function errorState(container,error){
    container.innerHTML=`
      <div class="stats-error">
        <strong>My Stats could not load.</strong>
        <span>${esc(
          error?.message||
          "Please refresh and try again."
        )}</span>
        <button
          type="button"
          class="btn-light"
          data-stats-retry
        >
          Try again
        </button>
      </div>`;

    container
      .querySelector("[data-stats-retry]")
      ?.addEventListener(
        "click",
        ()=>render({force:true})
      );
  }

  function bestCategory(snapshot){
    return (snapshot.categories||[])
      .filter(x=>
        x.qualified &&
        Number.isFinite(Number(x.accuracy))
      )
      .sort(
        (a,b)=>Number(b.accuracy)-
          Number(a.accuracy)
      )[0]||null;
  }

  function summaryMarkup(snapshot){
    const s=snapshot.summary||{};
    const best=bestCategory(snapshot);

    return `
      <div class="stats-summary-grid">
        <article class="stats-summary-card">
          <span>Games played</span>
          <strong>${num(s.games_played)}</strong>
          <small>
            ${num(s.active_days)} active
            ${Number(s.active_days)===1?"day":"days"}
          </small>
        </article>

        <article class="stats-summary-card">
          <span>Quiz answers</span>
          <strong>${num(s.quiz_answers)}</strong>
          <small>
            Multiple-choice questions answered
          </small>
        </article>

        <article class="stats-summary-card">
          <span>Quiz accuracy</span>
          <strong>${pct(s.quiz_accuracy)}</strong>
          <small>
            Across verified/synced quiz results
          </small>
        </article>

        <article class="stats-summary-card is-best">
          <span>Strongest category</span>
          <strong>
            ${best
              ? esc(
                  CATEGORY_NAMES[best.category]||
                  best.category
                )
              : "Building…"
            }
          </strong>
          <small>
            ${best
              ? `${pct(best.accuracy)} · ${num(best.questions_answered)} answers`
              : "Needs at least 20 answers in a category"
            }
          </small>
        </article>
      </div>`;
  }

  function aggregateSeries(snapshot,filterId){
    const rows=snapshot.series||{};
    const byDate=new Map();

    function include(row){
      if(filterId==="allquiz"){
        return QUIZ_IDS.has(row.game_id);
      }

      if(filterId==="anytime"){
        return ANYTIME_IDS.has(row.game_id);
      }

      return row.game_id===filterId;
    }

    (Array.isArray(rows)?rows:[])
      .filter(include)
      .forEach(row=>{
        const date=row.date;

        if(!byDate.has(date)){
          byDate.set(date,{
            date,
            games:0,
            correct:0,
            questions:0,
            score:0,
            wins:0,
            attempts:0,
            orderCorrect:0,
            orderTotal:0
          });
        }

        const x=byDate.get(date);
        x.games+=Number(row.games_played||0);
        x.correct+=Number(row.correct_answers||0);
        x.questions+=Number(row.questions_answered||0);
        x.score+=Number(row.total_score||0);
        x.wins+=Number(row.wins||0);
        x.attempts+=Number(row.attempts_total||0);
        x.orderCorrect+=Number(
          row.order_pairs_correct||0
        );
        x.orderTotal+=Number(
          row.order_pairs_total||0
        );
      });

    const values=[...byDate.values()]
      .sort(
        (a,b)=>String(a.date)
          .localeCompare(String(b.date))
      );

    return values.map(x=>{
      if(filterId==="topicrush"){
        return {
          date:x.date,
          value:x.games
            ? x.correct/x.games
            : null,
          label:"Answers found",
          suffix:""
        };
      }

      if(filterId==="brainiword"){
        return {
          date:x.date,
          value:x.games
            ? x.attempts/x.games
            : null,
          label:"Attempts",
          suffix:"",
          lowerBetter:true
        };
      }

      if(filterId==="orderup"){
        return {date:x.date,value:x.orderTotal?x.orderCorrect/x.orderTotal*100:null,label:"Order accuracy",suffix:"%"};
      }
      if(filterId==="connections" || filterId==="numberroute"){
        return {date:x.date,value:x.games?x.score/x.games:null,label:"Average score",suffix:""};
      }
      if(filterId==="mathrush"){
        return {date:x.date,value:x.games?x.correct/x.games:null,label:"Correct answers per run",suffix:""};
      }

      return {
        date:x.date,
        value:x.questions
          ? x.correct/x.questions*100
          : null,
        label:"Accuracy",
        suffix:"%"
      };
    }).filter(x=>
      Number.isFinite(Number(x.value))
    );
  }

  function lineChart(
    points,
    {
      maxValue=null,
      minValue=null,
      suffix="",
      empty="Play more games to build this chart."
    }={}
  ){
    if(!points.length){
      return `
        <div class="stats-chart-empty">
          ${esc(empty)}
        </div>`;
    }

    const width=760;
    const height=250;
    const pad={
      left:52,
      right:20,
      top:22,
      bottom:38
    };

    const values=points.map(
      x=>Number(x.value)
    );

    let min=minValue===null
      ? Math.min(...values)
      : Number(minValue);

    let max=maxValue===null
      ? Math.max(...values)
      : Number(maxValue);

    if(max===min){
      max+=1;
      min=Math.max(0,min-1);
    }

    if(
      suffix==="%" &&
      minValue===null &&
      maxValue===null
    ){
      min=Math.max(
        0,
        Math.floor((min-10)/10)*10
      );
      max=Math.min(
        100,
        Math.ceil((max+10)/10)*10
      );
      if(max<=min) max=Math.min(100,min+20);
    }

    const plotW=width-pad.left-pad.right;
    const plotH=height-pad.top-pad.bottom;

    const xFor=i=>
      pad.left+
      (
        points.length===1
          ? plotW/2
          : i/(points.length-1)*plotW
      );

    const yFor=value=>
      pad.top+
      (
        1-(value-min)/(max-min)
      )*plotH;

    const path=points
      .map(
        (p,i)=>
          `${i?"L":"M"} ${xFor(i).toFixed(1)} ${yFor(Number(p.value)).toFixed(1)}`
      )
      .join(" ");

    const grid=[0,.25,.5,.75,1]
      .map(t=>{
        const value=max-(max-min)*t;
        const y=pad.top+plotH*t;

        return `
          <line
            x1="${pad.left}"
            x2="${width-pad.right}"
            y1="${y}"
            y2="${y}"
            class="stats-chart-gridline"
          />
          <text
            x="${pad.left-9}"
            y="${y+4}"
            text-anchor="end"
            class="stats-chart-axis"
          >
            ${Math.round(value)}${suffix}
          </text>`;
      })
      .join("");

    const first=points[0];
    const last=points[points.length-1];
    const mid=points[
      Math.floor((points.length-1)/2)
    ];

    const dots=points
      .map(
        (p,i)=>`
          <circle
            cx="${xFor(i)}"
            cy="${yFor(Number(p.value))}"
            r="${i===points.length-1?5:3.5}"
            class="stats-chart-dot"
          >
            <title>
              ${shortDate(p.date)} ·
              ${Number(p.value).toFixed(1)}${suffix}
            </title>
          </circle>`
      )
      .join("");

    return `
      <div class="stats-chart-scroll">
        <svg
          class="stats-line-chart"
          viewBox="0 0 ${width} ${height}"
          role="img"
          aria-label="Performance trend"
        >
          ${grid}

          <path
            d="${path}"
            class="stats-chart-line"
          />

          ${dots}

          <text
            x="${pad.left}"
            y="${height-10}"
            text-anchor="start"
            class="stats-chart-axis"
          >${esc(shortDate(first.date))}</text>

          ${
            points.length>2
              ? `<text
                   x="${width/2}"
                   y="${height-10}"
                   text-anchor="middle"
                   class="stats-chart-axis"
                 >${esc(shortDate(mid.date))}</text>`
              : ""
          }

          <text
            x="${width-pad.right}"
            y="${height-10}"
            text-anchor="end"
            class="stats-chart-axis"
          >${esc(shortDate(last.date))}</text>
        </svg>
      </div>`;
  }

  function performanceMarkup(snapshot){
    const points=aggregateSeries(
      snapshot,
      gameFilter
    );

    const metric=points[0]||{
      label:
        gameFilter==="topicrush"
          ? "Answers found"
          : gameFilter==="brainiword"
            ? "Attempts"
            : gameFilter==="orderup"
              ? "Order accuracy"
              : "Accuracy",
      suffix:
        ["topicrush","brainiword"].includes(
          gameFilter
        )
          ? ""
          : "%"
    };

    let chartOptions={
      suffix:metric.suffix||""
    };

    if(gameFilter==="brainiword"){
      chartOptions={
        ...chartOptions,
        minValue:1,
        maxValue:5
      };
    }

    if(
      ["allquiz","anytime","brainmix","orderup"]
        .includes(gameFilter)
    ){
      chartOptions={
        ...chartOptions,
        minValue:0,
        maxValue:100
      };
    }

    return `
      <section class="stats-panel stats-performance-panel">
        <div class="stats-panel-head">
          <div>
            <span>PERFORMANCE OVER TIME</span>
            <h2>${esc(metric.label)}</h2>
            <p>
              ${
                gameFilter==="brainiword"
                  ? "Lower is better for BrainiWord attempts."
                  : "Track how your performance changes as you keep playing."
              }
            </p>
          </div>

          <div
            class="stats-game-filters"
            role="group"
            aria-label="Performance game"
          >
            ${GAME_FILTERS.map(x=>`
              <button
                type="button"
                data-stats-game="${x.id}"
                class="${x.id===gameFilter?"active":""}"
              >
                ${x.label}
              </button>
            `).join("")}
          </div>
        </div>

        <div data-performance-chart>
          ${lineChart(points,chartOptions)}
        </div>
      </section>`;
  }

  function categoriesMarkup(snapshot){
    const rows=(snapshot.categories||[])
      .filter(x=>
        Number.isFinite(Number(x.accuracy))
      );

    return `
      <section class="stats-panel">
        <div class="stats-panel-head compact">
          <div>
            <span>KNOWLEDGE PROFILE</span>
            <h2>Your strongest topics</h2>
            <p>
              A category needs 20 answers before BrainiLab calls it
              a strength or weakness.
            </p>
          </div>
        </div>

        ${
          rows.length
            ? `<div class="stats-bars">
                ${rows.map(row=>`
                  <div class="stats-bar-row">
                    <div class="stats-bar-meta">
                      <strong>
                        ${esc(
                          CATEGORY_NAMES[row.category]||
                          row.category
                        )}
                      </strong>

                      <span>
                        ${pct(row.accuracy)}
                        · ${num(row.questions_answered)}
                        answers
                        ${
                          row.qualified
                            ? ""
                            : " · building sample"
                        }
                      </span>
                    </div>

                    <div class="stats-bar-track">
                      <span
                        style="width:${Math.max(
                          0,
                          Math.min(
                            100,
                            Number(row.accuracy||0)
                          )
                        )}%"
                      ></span>
                    </div>
                  </div>
                `).join("")}
              </div>`
            : `<div class="stats-chart-empty">
                Play category quizzes to build your knowledge profile.
              </div>`
        }
      </section>`;
  }

  function difficultyMarkup(snapshot){
    const map=new Map(
      (snapshot.difficulties||[])
        .map(x=>[x.difficulty,x])
    );

    const rows=[
      {key:"easy",label:"Easy"},
      {key:"medium",label:"Medium"},
      {key:"hard",label:"Hard"}
    ];

    return `
      <section class="stats-panel">
        <div class="stats-panel-head compact">
          <div>
            <span>DIFFICULTY</span>
            <h2>How hard can you go?</h2>
            <p>
              Accuracy from replayable Easy, Medium and Hard quizzes.
            </p>
          </div>
        </div>

        <div class="stats-difficulty-grid">
          ${rows.map(x=>{
            const row=map.get(x.key);
            const value=Number(
              row?.accuracy||0
            );

            return `
              <article class="stats-difficulty-card">
                <div>
                  <span>${x.label}</span>
                  <strong>
                    ${row?pct(row.accuracy):"—"}
                  </strong>
                </div>

                <div class="stats-difficulty-meter">
                  <span
                    style="width:${row?Math.max(
                      0,
                      Math.min(100,value)
                    ):0}%"
                  ></span>
                </div>

                <small>
                  ${
                    row
                      ? `${num(row.questions_answered)} answers`
                      : "Not played yet"
                  }
                </small>
              </article>`;
          }).join("")}
        </div>
      </section>`;
  }

  function dailyMarkup(snapshot){
    const d=snapshot.daily_summary||{};
    const s=snapshot.summary||{};

    const points=(snapshot.daily_series||[])
      .map(x=>({
        date:x.date,
        value:Number(x.daily_brain_score||0)
      }));

    return `
      <section class="stats-panel stats-daily-panel">
        <div class="stats-panel-head">
          <div>
            <span>DAILY PERFORMANCE</span>
            <h2>Your Daily Brain Score</h2>
            <p>
              Your four Daily Games combine for a maximum of 10,000.
            </p>
          </div>

          <a
            class="stats-panel-link"
            href="../daily-quiz/index.html"
          >
            Today’s Daily →
          </a>
        </div>

        <div class="stats-daily-layout">
          <div>
            ${lineChart(
              points,
              {
                minValue:0,
                maxValue:10000,
                suffix:"",
                empty:
                  "Complete a Daily Game to start your Daily Brain Score history."
              }
            )}
          </div>

          <div class="stats-daily-metrics">
            <div>
              <span>Average</span>
              <strong>
                ${
                  d.average_daily_score!==null &&
                  d.average_daily_score!==undefined
                    ? num(d.average_daily_score)
                    : "—"
                }
              </strong>
            </div>

            <div>
              <span>Best Daily</span>
              <strong>
                ${
                  d.best_daily_score!==null &&
                  d.best_daily_score!==undefined
                    ? num(d.best_daily_score)
                    : "—"
                }
              </strong>
            </div>

            <div>
              <span>Full Dailies</span>
              <strong>${num(d.full_dailies)}</strong>
            </div>

            <div>
              <span>Current streak</span>
              <strong>🔥 ${num(s.current_streak)}</strong>
            </div>

            <div>
              <span>Best streak</span>
              <strong>${num(s.best_streak)} days</strong>
            </div>
          </div>
        </div>
      </section>`;
  }

  function gameById(snapshot,id){
    return (snapshot.games||[])
      .find(x=>x.game_id===id)||null;
  }

  function pbScore(row){
    const pb=row?.personal_best;

    if(!pb) return "—";

    if(
      pb.score!==null &&
      pb.score!==undefined
    ){
      return num(pb.score);
    }

    if(
      pb.metric_value!==null &&
      pb.metric_value!==undefined
    ){
      return num(pb.metric_value);
    }

    return "—";
  }

  function dailyGamesMarkup(snapshot){
    function icon(id){
      const names={brainmix:"brainmix",brainiword:"brainiword",orderup:"orderup",topicrush:"topicrush",connections:"connections",survival:"survival",oddoneout:"odd-one-out",higherlower:"higher-lower",mathrush:"math-rush",numberroute:"number-route",sequence:"sequence"};
      return window.BrainiIcons?.game?BrainiIcons.game(names[id]||id,"mini","braini-game-mini"):"●";
    }
    function avg(row,field="average_score",digits=0){const v=row?.[field];return v===null||v===undefined?"—":Number(v).toFixed(digits)}
    function perGame(row){return row&&Number(row.games_played)?Number(row.correct_answers||0)/Number(row.games_played):null}
    const configs=[
      {id:"brainmix",primary:r=>r?pct(r.accuracy):"—",pl:"Average accuracy",secondary:r=>avg(r),sl:"Average score"},
      {id:"brainiword",primary:r=>r?pct(r.win_rate):"—",pl:"Win rate",secondary:r=>avg(r,"average_attempts",2),sl:"Average attempts"},
      {id:"orderup",primary:r=>r?pct(r.order_accuracy):"—",pl:"Order accuracy",secondary:r=>avg(r),sl:"Average score"},
      {id:"topicrush",primary:r=>{const v=perGame(r);return v===null?"—":v.toFixed(1)},pl:"Answers per round",secondary:r=>r?pct(r.accuracy):"—",sl:"Completion accuracy"},
      {id:"connections",primary:r=>avg(r),pl:"Average score",secondary:r=>avg(r,"average_attempts",2),sl:"Attempts per game"},
      {id:"survival",primary:r=>r?pct(r.accuracy):"—",pl:"Average accuracy",secondary:r=>avg(r),sl:"Average score"},
      {id:"oddoneout",primary:r=>r?pct(r.accuracy):"—",pl:"Average accuracy",secondary:r=>avg(r),sl:"Average score"},
      {id:"higherlower",primary:r=>r?pct(r.accuracy):"—",pl:"Average accuracy",secondary:r=>avg(r),sl:"Average score"},
      {id:"mathrush",primary:r=>{const v=perGame(r);return v===null?"—":v.toFixed(1)},pl:"Correct per 60s run",secondary:r=>r?pct(r.accuracy):"—",sl:"Answer accuracy"},
      {id:"numberroute",primary:r=>avg(r),pl:"Average score",secondary:r=>r?pct(r.accuracy):"—",sl:"Routes solved"},
      {id:"sequence",primary:r=>r?pct(r.accuracy):"—",pl:"Average accuracy",secondary:r=>avg(r),sl:"Average score"}
    ];
    function card(c){const row=gameById(snapshot,c.id);return `<article class="stats-game-card"><div class="stats-game-card-head"><span>${icon(c.id)}</span><div><strong>${GAME_NAMES[c.id]}</strong><small>${row?`${num(row.games_played)} games in ${rangeLabel()}`:"No results in this range"}</small></div></div><div class="stats-game-card-metrics"><div><span>${c.pl}</span><strong>${c.primary(row)}</strong></div><div><span>${c.sl}</span><strong>${c.secondary(row)}</strong></div><div><span>All-time best</span><strong>${pbScore(row)}</strong></div></div></article>`}
    return `<section class="stats-panel"><div class="stats-panel-head"><div><span>GAME PERFORMANCE</span><h2>Your BrainiLab games</h2><p>Every current mechanic is tracked with metrics that fit how that game is actually played.</p></div></div><div class="stats-game-grid">${configs.map(card).join("")}</div></section>`;
  }

  function insights(snapshot){
    const out=[];
    const s=snapshot.summary||{};
    const prev=snapshot.previous_summary||null;
    const categories=(snapshot.categories||[])
      .filter(x=>
        x.qualified &&
        Number.isFinite(Number(x.accuracy))
      )
      .sort(
        (a,b)=>Number(b.accuracy)-
          Number(a.accuracy)
      );

    if(
      prev &&
      Number.isFinite(Number(s.quiz_accuracy)) &&
      Number.isFinite(Number(prev.quiz_accuracy)) &&
      Number(s.quiz_answers)>=20 &&
      Number(prev.quiz_answers)>=20
    ){
      const diff=
        Number(s.quiz_accuracy)-
        Number(prev.quiz_accuracy);

      if(diff>=3){
        out.push({
          title:"You’re improving",
          text:
            `Your quiz accuracy is up ${diff.toFixed(1)} points versus the previous ${rangeLabel()}.`
        });
      }else if(diff<=-5){
        out.push({
          title:"A tougher stretch",
          text:
            `Your quiz accuracy is ${Math.abs(diff).toFixed(1)} points below the previous period. A few Medium games can rebuild momentum.`
        });
      }
    }

    if(categories[0]){
      const c=categories[0];

      out.push({
        title:"Your strongest category",
        text:
          `${CATEGORY_NAMES[c.category]||c.category} leads at ${pct(c.accuracy)} across ${num(c.questions_answered)} answers.`
      });
    }

    const diffMap=new Map(
      (snapshot.difficulties||[])
        .map(x=>[x.difficulty,x])
    );

    const easy=diffMap.get("easy");
    const medium=diffMap.get("medium");
    const hard=diffMap.get("hard");

    if(
      easy &&
      Number(easy.questions_answered)>=20 &&
      Number(easy.accuracy)>=85 &&
      (
        !medium ||
        Number(medium.questions_answered)<20
      )
    ){
      out.push({
        title:"Ready for Medium",
        text:
          `You’re at ${pct(easy.accuracy)} on Easy. Medium is the clearest next challenge.`
      });
    }else if(
      medium &&
      Number(medium.questions_answered)>=20 &&
      Number(medium.accuracy)>=78 &&
      (
        !hard ||
        Number(hard.questions_answered)<20
      )
    ){
      out.push({
        title:"Hard mode is waiting",
        text:
          `Your Medium accuracy is ${pct(medium.accuracy)}. Try a Hard quiz and see where the ceiling is.`
      });
    }

    const daily=snapshot.daily_summary||{};

    if(
      Number(daily.full_dailies)>=3
    ){
      out.push({
        title:"Daily consistency",
        text:
          `You completed ${num(daily.full_dailies)} Full Dailies in this range. Keep the four-game habit going.`
      });
    }

    if(!out.length){
      out.push({
        title:"Your profile is taking shape",
        text:
          "Keep playing across several categories and difficulties. BrainiLab will surface meaningful patterns once the sample is large enough."
      });
    }

    return out.slice(0,3);
  }

  function insightsMarkup(snapshot){
    const rows=insights(snapshot);

    return `
      <section class="stats-panel stats-insights">
        <div class="stats-panel-head compact">
          <div>
            <span>PERSONAL INSIGHTS</span>
            <h2>What your results are saying</h2>
            <p>
              Rule-based insights from your own BrainiLab history.
            </p>
          </div>
        </div>

        <div class="stats-insight-grid">
          ${rows.map((x,index)=>`
            <article>
              <span>0${index+1}</span>
              <strong>${esc(x.title)}</strong>
              <p>${esc(x.text)}</p>
            </article>
          `).join("")}
        </div>
      </section>`;
  }



  function pageMarkup(snapshot){
    return `
      <div class="stats-toolbar">
        <div>
          <span>TIME RANGE</span>
          <div
            class="stats-range-switch"
            role="group"
            aria-label="Stats time range"
          >
            ${RANGE_OPTIONS.map(x=>`
              <button
                type="button"
                data-stats-range="${x.days}"
                class="${x.days===range?"active":""}"
              >
                ${x.label}
              </button>
            `).join("")}
          </div>
        </div>

        <small>
          Updated from your synced results
        </small>
      </div>

      ${summaryMarkup(snapshot)}
      ${performanceMarkup(snapshot)}

      <div class="stats-two-col">
        ${categoriesMarkup(snapshot)}
        ${difficultyMarkup(snapshot)}
      </div>

      ${dailyMarkup(snapshot)}
      ${dailyGamesMarkup(snapshot)}
      ${insightsMarkup(snapshot)}
    `;
  }

  function bind(container,snapshot){
    container
      .querySelectorAll("[data-stats-range]")
      .forEach(button=>{
        button.onclick=()=>{
          const next=Number(
            button.dataset.statsRange
          );

          if(next===range) return;

          range=next;
          render();
        };
      });

    container
      .querySelectorAll("[data-stats-game]")
      .forEach(button=>{
        button.onclick=()=>{
          gameFilter=
            button.dataset.statsGame;

          const panel=
            button.closest(
              ".stats-performance-panel"
            );

          if(!panel) return;

          panel.outerHTML=
            performanceMarkup(snapshot);

          bindPerformance(
            container,
            snapshot
          );
        };
      });
  }

  function bindPerformance(container,snapshot){
    container
      .querySelectorAll("[data-stats-game]")
      .forEach(button=>{
        button.onclick=()=>{
          gameFilter=
            button.dataset.statsGame;

          const panel=
            button.closest(
              ".stats-performance-panel"
            );

          if(!panel) return;

          const holder=
            document.createElement("div");

          holder.innerHTML=
            performanceMarkup(snapshot);

          panel.replaceWith(
            holder.firstElementChild
          );

          bindPerformance(
            container,
            snapshot
          );
        };
      });
  }

  async function render({force=false}={}){
    const container=root();
    if(!container) return;

    const token=++renderToken;

    if(!authenticated()){
      signInState(container);
      return;
    }

    const cached=
      window.BrainiAnalytics?.getCached?.(
        range
      );

    if(!cached){
      loadingState(container);
    }

    try{
      const snapshot=
        await BrainiAnalytics.fetchStats(
          range,
          {force}
        );

      if(token!==renderToken) return;

      if(!snapshot){
        signInState(container);
        return;
      }

      container.innerHTML=
        pageMarkup(snapshot);

      bind(container,snapshot);
    }catch(err){
      if(token!==renderToken) return;
      errorState(container,err);
    }
  }

  window.addEventListener(
    "brainilab:authchange",
    ()=>render()
  );

  window.addEventListener(
    "brainilab:cloudgame",
    ()=>{
      if(
        document.querySelector(
          '[data-profile-section="stats"]:not([hidden])'
        )
      ){
        render({force:true});
      }
    }
  );

  return {
    render
  };
})();

/* ===== profile-sections.js ===== */

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
