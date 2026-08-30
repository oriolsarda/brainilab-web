/* BrainiLab Daily Try First — V41.8.0
   Compatibility dispatcher: Try First always opens the full real game in a
   different archived batch. The game engine/UI is identical; ?try=1 prevents
   result/Health recording.
*/
window.BrainiTryFirst=(function(){
  const P=new URLSearchParams(location.search);
  const game=P.get("game")||"brainmix";
  const today=P.get("date")||BrainiData.todayKey?.()||new Date().toISOString().slice(0,10);
  const META={
    brainmix:"../brain-mix/",brainiword:"../brainiword/",orderup:"../order-up/",topicrush:"../topic-rush/",
    connections:"../connections/",oddoneout:"../odd-one-out/",higherlower:"../higher-lower/",mathrush:"../math-rush/",
    numberroute:"../number-route/",sequence:"../sequence/"
  };
  function previousDateFor(id,date){
    const d=new Date(`${date}T12:00:00Z`);
    for(let i=1;i<=90;i++){
      d.setUTCDate(d.getUTCDate()-1);
      const key=d.toISOString().slice(0,10);
      const ids=BrainiData.dailyGameIdsForDate?.(key)||[];
      if(ids.includes(id)) return key;
    }
    const fallback=new Date(`${date}T12:00:00Z`);fallback.setUTCDate(fallback.getUTCDate()-1);
    return fallback.toISOString().slice(0,10);
  }
  function redirect(){
    const root=document.getElementById("tryFirstGame");
    const dailyNumber=BrainiData.dailyNumberForDate?.(today);
    const already=(BrainiData.recentResults?.(game)||[]).some(r=>!r.practice&&Number(r.dailyNumber)===Number(dailyNumber));
    if(already){ location.replace("../../daily-quiz/"); return; }
    const route=META[game]||META.brainmix;
    const practiceDate=previousDateFor(game,today);
    if(root){
      root.querySelector("[data-title]")?.replaceChildren(document.createTextNode("Loading the full practice game…"));
      const desc=root.querySelector("[data-description]");
      if(desc) desc.textContent="Same rules and full gameplay as the scored Daily, with a different batch and no score.";
    }
    const qs=new URLSearchParams({archive:practiceDate,try:"1",today});
    location.replace(`${route}?${qs}`);
  }
  document.addEventListener("DOMContentLoaded",redirect);
  return {redirect};
})();
