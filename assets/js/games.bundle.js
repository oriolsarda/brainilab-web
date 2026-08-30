/* ===== games-library.js ===== */

/* BrainiLab Games library — V41.8.0 */
window.BrainiGamesLibrary=(function(){
  const DAILY_LAUNCH_DATE="2026-08-29",ARCHIVE_STORAGE_KEY="brainilab.games.archiveDate.v2";
  const DAILY_META={
    brainmix:{name:"Brain Mix",route:"brain-mix/index.html"},brainiword:{name:"BrainiWord",route:"brainiword/index.html"},
    orderup:{name:"Order Up",route:"order-up/index.html"},topicrush:{name:"Topic Rush",route:"topic-rush/index.html"},
    connections:{name:"Connections",route:"connections/index.html"},oddoneout:{name:"Odd One Out",route:"odd-one-out/index.html"},
    higherlower:{name:"Higher or Lower",route:"higher-lower/index.html"},mathrush:{name:"Math Rush",route:"math-rush/index.html"},
    numberroute:{name:"Number Route",route:"number-route/index.html"},sequence:{name:"Sequence",route:"sequence/index.html"}
  };
  function yesterdayKey(){const d=new Date();d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
  function formatDate(date){try{return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}catch{return date}}
  function validArchiveDate(value){const raw=String(value||"").slice(0,10);return BrainiData.pastDailyDate?.(raw)||null}
  function initialArchiveDate(){const max=yesterdayKey();let stored=null;try{stored=localStorage.getItem(ARCHIVE_STORAGE_KEY)}catch{}const valid=validArchiveDate(stored);if(valid&&valid<=max)return valid;return max>=DAILY_LAUNCH_DATE?max:DAILY_LAUNCH_DATE}
  function renderPastActions(date){
    const ids=BrainiData.dailyGameIdsForDate?.(date)||["brainmix","orderup","topicrush","brainiword"];
    const number=BrainiData.dailyNumberForDate?.(date);const label=`Daily #${number} · ${formatDate(date)}`;
    document.querySelectorAll("[data-past-daily-action]").forEach(slot=>{
      const id=slot.dataset.pastDailyAction,meta=DAILY_META[id];if(!meta)return;
      if(ids.includes(id)) slot.innerHTML=`<a class="archive-play-action" href="${meta.route}?archive=${encodeURIComponent(date)}">Play ${label} · practice</a>`;
      else slot.innerHTML=`<span class="archive-unavailable">Not in ${label}</span>`;
    });
    const context=document.querySelector("[data-daily-archive-context]");
    if(context) context.innerHTML=`<strong>${label}</strong><span>Past Daily batches are practice and never change today’s score or streak.</span>`;
  }
  function hydrateArchive(){
    const input=document.querySelector("[data-daily-archive-date]");if(!input)return;
    const max=yesterdayKey();input.min=DAILY_LAUNCH_DATE;input.max=max;
    const setDate=value=>{let date=validArchiveDate(value);if(!date||date<DAILY_LAUNCH_DATE||date>max)date=initialArchiveDate();input.value=date;try{localStorage.setItem(ARCHIVE_STORAGE_KEY,date)}catch{}renderPastActions(date)};
    if(!input.dataset.archiveBound){input.dataset.archiveBound="1";input.addEventListener("change",()=>setDate(input.value))}setDate(input.value||initialArchiveDate());
  }
  function hydrate(){
    document.querySelectorAll("[data-anytime-game]").forEach(card=>{const gameId=card.dataset.anytimeGame,results=BrainiData.recentResults(gameId)||[],best=BrainiData.personalBest(gameId),status=card.querySelector("[data-anytime-status]");if(!status)return;if(!results.length){status.innerHTML='<span class="anytime-new">Not played yet</span>';return}let bestLabel="";if(best){if(["connections","survival","oddoneout","higherlower","mathrush","numberroute","sequence"].includes(gameId)&&Number.isFinite(Number(best.score)))bestLabel=`Best ${Number(best.score).toLocaleString()} pts`;else if(Number.isFinite(Number(best.correct))&&Number.isFinite(Number(best.total)))bestLabel=`Best ${Number(best.correct)}/${Number(best.total)}`;else if(Number.isFinite(Number(best.score)))bestLabel=`Best ${Number(best.score).toLocaleString()} pts`}status.innerHTML=`<span class="anytime-played">${BrainiIcons.product("check-completed","braini-inline-icon")} Played</span><span>${bestLabel||`${results.length} result${results.length===1?"":"s"}`}</span>`});
    const player=BrainiData.player();document.querySelectorAll("[data-games-rank]").forEach(el=>{if(window.BrainiProgressUI)el.innerHTML=BrainiProgressUI.badgeMarkup(player.level||1)});hydrateArchive();
  }
  document.addEventListener("DOMContentLoaded",hydrate);window.addEventListener("brainilab:datachange",hydrate);window.addEventListener("brainilab:progressionchange",hydrate);
  return {hydrate,hydrateArchive};
})();
