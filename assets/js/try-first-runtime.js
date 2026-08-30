/* BrainiLab Try First runtime — V41.8.0 */
window.BrainiTryFirstRuntime=(function(){
  const P=new URLSearchParams(location.search);
  const active=P.get("try")==="1";
  const today=P.get("today")||BrainiData.todayKey?.()||new Date().toISOString().slice(0,10);
  const ROTATING=new Set(["connections","oddoneout","higherlower","mathrush","numberroute","sequence"]);
  const PATH_TO_GAME={"brain-mix":"brainmix","brainiword":"brainiword","order-up":"orderup","topic-rush":"topicrush","connections":"connections","odd-one-out":"oddoneout","higher-lower":"higherlower","math-rush":"mathrush","number-route":"numberroute","sequence":"sequence"};
  function gameId(){const parts=location.pathname.split("/").filter(Boolean);for(const [slug,id] of Object.entries(PATH_TO_GAME))if(parts.includes(slug))return id;return null}
  function todayHref(){const u=new URL(location.href);u.search="";const id=gameId();if(id&&ROTATING.has(id))u.searchParams.set("daily",today);return u.href}
  function decorate(){
    if(!active) return;
    document.documentElement.classList.add("try-first-active");
    if(!document.querySelector("[data-try-first-banner]")){
      const banner=document.createElement("div");banner.dataset.tryFirstBanner="1";banner.className="try-first-global-banner";
      banner.innerHTML='<strong>Try first · full practice game</strong><span>Same rules as the Daily. Different batch. No score, XP, streak, rankings or Health.</span>';
      document.body.prepend(banner);
    }
    document.querySelectorAll(".inline-quiz-result-actions,.simple-result-actions").forEach(box=>{
      if(box.querySelector("[data-play-real-daily]"))return;
      const first=box.querySelector("a");
      if(first){first.href=todayHref();first.textContent="Play today’s scored challenge";first.dataset.playRealDaily="1";}
      const back=[...box.querySelectorAll("a")].find(a=>a!==first&&/Choose another|Back to Daily|Continue Daily/i.test(a.textContent||""));
      if(back){back.href="../../daily-quiz/";back.textContent="Back to Daily";}
    });
  }
  if(active){document.addEventListener("DOMContentLoaded",decorate);new MutationObserver(decorate).observe(document.documentElement,{subtree:true,childList:true});}
  return {active,decorate};
})();
