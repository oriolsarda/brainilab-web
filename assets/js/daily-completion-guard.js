/* BrainiLab Daily completion guard — V41.8.0
   Prevents a completed rotating Daily challenge being mounted/replayed from a direct URL.
   Server submission is also idempotent/locked by Step 27.
*/
window.BrainiDailyCompletionGuard=(function(){
  const P=new URLSearchParams(location.search);
  const date=P.get("daily");
  if(!date || P.get("archive") || P.get("try")==="1") return {active:false};
  const PATHS={connections:"connections",oddoneout:"odd-one-out",higherlower:"higher-lower",mathrush:"math-rush",numberroute:"number-route",sequence:"sequence"};
  const gameId=Object.entries(PATHS).find(([,slug])=>location.pathname.split("/").includes(slug))?.[0]||null;
  if(!gameId) return {active:false};
  const dailyNumber=BrainiData.dailyNumberForDate?.(date);
  let locked=false;
  function localComplete(){return (BrainiData.recentResults?.(gameId)||[]).some(r=>!r.practice&&Number(r.dailyNumber)===Number(dailyNumber))}
  function showLock(){
    if(locked)return;locked=true;
    const shell=document.querySelector(".labgame-shell");if(!shell)return;
    shell.innerHTML=`<div class="daily-completed-state simple-daily-result"><div class="daily-completed-kicker simple-result-kicker-row"><span>Daily #${Number(dailyNumber)||""}</span><strong>Completed ✓</strong></div><h1>Already played today</h1><p class="daily-completed-lead">This Daily result is locked. Each scored Daily game can only be completed once.</p><div class="simple-result-actions"><a class="simple-result-play" href="../../daily-quiz/">Continue Daily</a><a class="simple-result-progress" href="../index.html">Play Anytime</a></div></div>`;
  }
  async function check(){
    if(localComplete()){showLock();return true}
    if(window.BrainiCloudGames&&window.BrainiBackendAuth?.isConfigured?.()){
      try{const session=await BrainiBackendAuth.getSession?.();if(session?.user){const rows=await BrainiCloudGames.getMyRecentResults(80);if((rows||[]).some(r=>r.game_id===gameId&&Number(r.daily_number)===Number(dailyNumber))){showLock();return true}}}catch(err){console.warn("BrainiLab Daily completion guard:",err?.message||err)}
    }
    return false;
  }
  return {active:true,gameId,dailyNumber,check,isLocked:()=>locked};
})();
