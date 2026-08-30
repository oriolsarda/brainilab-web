/*
  BrainiLab Daily Journey — V41.8.0
  One reusable visual for today's four Daily Games.
*/
window.BrainiDailyJourney=(function(){
  const SCRIPT_URL=(()=>{
    const current=document.currentScript?.src;
    if(current) return current;

    const found=[...document.scripts]
      .map(s=>s.src)
      .find(src=>src && src.includes("/assets/js/daily-journey.js"));

    return found||location.href;
  })();

  const SITE_ROOT=new URL("../../",SCRIPT_URL);

  function siteUrl(path=""){
    const raw=String(path).replace(/^\/+/, "");
    const url=new URL(raw,SITE_ROOT);

    // Static local browsing has no web server to resolve directory routes
    // to index.html. Chrome otherwise shows a directory listing.
    if(
      url.protocol==="file:" &&
      url.pathname.endsWith("/")
    ){
      url.pathname+="index.html";
    }

    return url.href;
  }

  const META={
    brainmix:{name:"Brain Mix",icon:"brainmix",href:"games/brain-mix/"},
    orderup:{name:"Order Up",icon:"orderup",href:"games/order-up/"},
    topicrush:{name:"Topic Rush",icon:"topicrush",href:"games/topic-rush/"},
    connections:{name:"Connections",icon:"connections",href:"games/connections/",dailyQuery:true},
    oddoneout:{name:"Odd One Out",icon:"odd-one-out",href:"games/odd-one-out/",dailyQuery:true},
    higherlower:{name:"Higher or Lower",icon:"higher-lower",href:"games/higher-lower/",dailyQuery:true},
    mathrush:{name:"Math Rush",icon:"math-rush",href:"games/math-rush/",dailyQuery:true},
    numberroute:{name:"Number Route",icon:"number-route",href:"games/number-route/",dailyQuery:true},
    sequence:{name:"Sequence",icon:"sequence",href:"games/sequence/",dailyQuery:true},
    brainiword:{name:"BrainiWord",icon:"brainiword",href:"games/brainiword/"}
  };
  const ORDER=["brainmix","orderup","topicrush","connections","oddoneout","higherlower","mathrush","numberroute","sequence","brainiword"];

  function orderFor(status){
    return status?.dailyIds||BrainiData.dailyGameIdsForNumber?.(status?.dailyNumber)||["brainmix","orderup","topicrush","brainiword"];
  }

  function practiceDateFor(gameId,currentDate){
    const base=new Date(`${currentDate}T12:00:00Z`),d=new Date(base);
    for(let i=1;i<=90;i++){
      d.setUTCDate(d.getUTCDate()-1);
      const key=d.toISOString().slice(0,10);
      if((BrainiData.dailyGameIdsForDate?.(key)||[]).includes(gameId)) return key;
    }
    base.setUTCDate(base.getUTCDate()-1);
    return base.toISOString().slice(0,10);
  }

  function formatPoints(n){
    return Number(n||0).toLocaleString();
  }

  async function markup(options={}){
    const status=options.status||await BrainiDailyHub.resolve(
      options.dailyNumber,
      {forceCloud:!!options.forceCloud}
    );
    const current=options.currentGame||"";

    return `
      <section class="daily-journey ${status.completedCount===4?"is-full":""}">
        <div class="daily-journey-head">
          <div>
            <span class="daily-journey-eyebrow">Today's Daily · #${status.dailyNumber}</span>
            <h3>${status.completedCount===4?"Full Daily complete ✓":"Finish today's 4 challenges"}</h3>
          </div>
          <div class="daily-journey-score">
            <strong>${formatPoints(status.brainScore)}</strong>
            <span>/ 10,000</span>
          </div>
        </div>

        <div class="daily-journey-progress">
          <span style="width:${Math.min(100,status.completedCount/4*100)}%"></span>
        </div>

        <div class="daily-journey-grid">
          ${orderFor(status).map(id=>{
            const meta=META[id];
            const game=status.games[id]||{};
            const complete=!!game.completed;
            const dailyDate=BrainiData.dateForDailyNumber?.(status.dailyNumber)||BrainiData.todayKey();
            const playHref=meta.dailyQuery
              ? `${siteUrl(meta.href)}?daily=${encodeURIComponent(dailyDate)}`
              : siteUrl(meta.href);
            const practiceDate=practiceDateFor(id,dailyDate);
            const tryHref=`${siteUrl(meta.href)}?archive=${encodeURIComponent(practiceDate)}&try=1&today=${encodeURIComponent(dailyDate)}`;
            return `
              <article class="daily-journey-card-v2 ${complete?"is-complete":"is-pending"} ${id===current?"is-current":""}">
                <div class="daily-journey-card-main">
                  <span class="daily-journey-icon">${BrainiIcons.game(meta.icon,"mini","braini-game-mini")}</span>
                  <span class="daily-journey-copy">
                    <strong>${meta.name}</strong>
                    <small>${complete
                      ? `${formatPoints(game.points)} / 2,500 points`
                      : "Up to 2,500 Daily points"
                    }</small>
                  </span>
                  <span class="daily-journey-state">${complete?BrainiIcons.product("check-completed","braini-inline-icon"):BrainiIcons.product("continue","braini-inline-icon")}</span>
                </div>
                ${complete
                  ? `<div class="daily-journey-completed-lock">Completed today · result locked ✓</div>`
                  : `<div class="daily-journey-actions">
                      <a class="daily-journey-try" href="${tryHref}">Try first · full practice</a>
                      <a class="daily-journey-play" href="${playHref}">Play Daily</a>
                    </div>`
                }
              </article>`;
          }).join("")}
        </div>

        <div class="daily-journey-foot">
          ${status.completedCount===4
            ? `<strong>+250 XP Full Daily bonus earned</strong><span>Come back tomorrow for a new four-game set.</span>`
            : `<strong>${4-status.completedCount} ${4-status.completedCount===1?"challenge":"challenges"} left</strong><span>Complete all four for +250 bonus XP.</span>`
          }
        </div>
      </section>`;
  }

  async function render(container,options={}){
    if(!container) return null;
    const status=options.status||await BrainiDailyHub.resolve(
      options.dailyNumber,
      {forceCloud:!!options.forceCloud}
    );
    container.innerHTML=await markup({...options,status});
    return status;
  }

  return {META,ORDER,markup,render};
})();
