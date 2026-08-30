/* BrainiLab Odd One Out — V41.8.0 */
window.BrainiOddOneOut=(function(){
  const ROUNDS=10;
  const PARAMS=new URLSearchParams(location.search);
  const dailyDate=PARAMS.get("daily")||PARAMS.get("archive")||null;
  const archiveMode=!!PARAMS.get("archive");
  const dailyMode=!!dailyDate;
  const scoringDaily=dailyMode&&!archiveMode;

  function client(){return window.BrainiBackendAuth?.getClient?.()||null}
  function configured(){return !!window.BrainiBackendAuth?.isConfigured?.()}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
  function localHistory(){try{return BrainiData.anytimeHistory?.("oddoneout")||{}}catch{return{}}}
  function excludes(){return Object.entries(localHistory()).filter(([,v])=>Number(v?.timesPlayed||0)>0).map(([id])=>id).filter(id=>/^[0-9a-f-]{36}$/i.test(id)).slice(0,500)}
  function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}function seedHash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function localDaily(){
    const key=String(dailyDate||"");
    return (BrainiOddOneOutPuzzles?.all?.()||[]).slice().sort((a,b)=>(seedHash(`${key}:${a.id}`)-seedHash(`${key}:${b.id}`))||String(a.id).localeCompare(String(b.id))).slice(0,ROUNDS).map(x=>({...x,cloud:false}));
  }
  async function load(){
    if(configured()){
      try{
        const {data,error}=dailyMode
          ? await client().rpc("get_brainilab_daily_odd_one_out",{p_challenge_date:dailyDate})
          : await client().rpc("get_brainilab_odd_one_out_game",{p_exclude_puzzle_ids:excludes()});
        if(error)throw error;
        const rows=(data?.puzzles||[]).map(x=>({id:x.puzzle_id,category:x.category,prompt:x.prompt,items:x.items,cloud:true}));
        if(rows.length===ROUNDS)return {source:"supabase",rounds:rows};
      }catch(e){console.warn("Odd One Out cloud fallback:",e.message||e)}
    }
    if(dailyMode)return {source:"local",rounds:localDaily()};
    const hist=localHistory();
    const all=shuffle(BrainiOddOneOutPuzzles?.all?.()||[]).sort((a,b)=>(hist[a.id]?.timesPlayed||0)-(hist[b.id]?.timesPlayed||0));
    return {source:"local",rounds:all.slice(0,ROUNDS).map(x=>({...x,cloud:false}))};
  }
  async function check(round,index){
    if(!round.cloud)return {correct:index===round.odd,correctIndex:round.odd,explanation:round.explanation};
    const {data,error}=await client().rpc("check_brainilab_odd_one_out_answer",{p_puzzle_id:round.id,p_item_index:index});
    if(error)throw error;
    return {correct:!!data?.correct,correctIndex:Number(data?.correct_index),explanation:data?.explanation||""};
  }
  async function syncHistory(ids){
    try{BrainiData.recordAnytimeHistory?.("oddoneout",ids)}catch{}
    if(!configured())return;
    const session=await BrainiBackendAuth?.getSession?.();
    if(!session?.user)return;
    const cloud=ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x));
    if(cloud.length)try{await client().rpc("record_brainilab_odd_one_out_history",{p_puzzle_ids:cloud})}catch(e){console.warn(e)}
  }
  async function verify(result,details){
    if(!configured()||result?.cloudSyncStatus!=="synced")return;
    const session=await BrainiBackendAuth?.getSession?.();
    if(!session?.user)return;
    const rows=details.filter(x=>/^[0-9a-f-]{36}$/i.test(x.puzzleId)).map(x=>({puzzle_id:x.puzzleId,selected_index:x.selectedIndex}));
    if(rows.length!==ROUNDS)return;
    try{
      const {data,error}=await client().rpc("verify_brainilab_odd_one_out_result",{p_client_result_id:result.clientResultId,p_rounds:rows});
      if(error)throw error;
      await BrainiData.api.markResultAnswerVerified?.(result.clientResultId,data||{});
    }catch(e){console.warn(e)}
  }

  async function mount(root){
    if(scoringDaily && await window.BrainiDailyCompletionGuard?.check?.()) return;
    const intro=root.querySelector("[data-intro]"),loading=root.querySelector("[data-loading]"),stage=root.querySelector("[data-stage]"),resultEl=root.querySelector("[data-result]"),start=root.querySelector("[data-start]"),meta=root.querySelector("[data-meta]"),q=root.querySelector("[data-question]"),items=root.querySelector("[data-items]"),feedback=root.querySelector("[data-feedback]"),next=root.querySelector("[data-next]"),scoreEl=root.querySelector("[data-score]"),progress=root.querySelector("[data-progress]");
    let rounds=[],idx=0,correct=0,score=0,locked=false,details=[],started=0,source="local",finished=false,healthTracker=null;

    function render(){
      locked=false;
      const r=rounds[idx];
      healthTracker?.checkpoint(idx+1);
      meta.textContent=`${dailyMode?(archiveMode?"Past Daily · Practice":"Daily")+" · ":""}Round ${idx+1} of ${ROUNDS} · ${r.category||"general"}`;
      q.textContent=r.prompt||"Which one does not belong?";
      scoreEl.textContent=`${score} / 1,000`;
      progress.style.width=`${(idx/ROUNDS)*100}%`;
      feedback.innerHTML="";next.hidden=true;items.innerHTML="";
      r.items.forEach((txt,i)=>{const b=document.createElement("button");b.className="labgame-answer odd-item";b.textContent=txt;b.onclick=()=>choose(r,i,b);items.appendChild(b)});
    }
    async function choose(r,i,b){
      if(locked)return;
      locked=true;[...items.children].forEach(x=>x.disabled=true);feedback.textContent="Checking…";
      let x;try{x=await check(r,i)}catch(e){locked=false;[...items.children].forEach(x=>x.disabled=false);feedback.textContent="Could not check that answer.";return}
      details.push({puzzleId:r.id,selectedIndex:i,correct:x.correct});
      [...items.children].forEach((el,j)=>{if(j===x.correctIndex)el.classList.add("correct")});
      if(x.correct){correct++;score+=100;b.classList.add("correct");feedback.innerHTML=`<strong>✓ Correct · +100 pts</strong><span>${esc(x.explanation)}</span>`}
      else{b.classList.add("wrong");feedback.innerHTML=`<strong style="color:#ff9b96">Not this one</strong><span>${esc(x.explanation)}</span>`}
      progress.style.width=`${((idx+1)/ROUNDS)*100}%`;scoreEl.textContent=`${score} / 1,000`;next.textContent=idx===ROUNDS-1?"See result":"Next round";next.hidden=false;locked=false;
    }
    next.onclick=()=>idx===ROUNDS-1?finish():(idx++,render());
    async function finish(){
      if(finished)return;finished=true;
      if(!dailyMode) await syncHistory(details.map(x=>x.puzzleId));
      healthTracker?.complete(details.map((x,i)=>({contentId:x.puzzleId,position:i+1,attempts:1,isCorrect:x.correct,score:x.correct?100:0})));
      const timeSec=Math.max(1,Math.round((performance.now()-started)/1000));
      let result=await BrainiData.api.submitGameResult("oddoneout",{score,correct,total:ROUNDS,accuracy:correct*10,timeSec,contentSource:source,dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,archiveDailyNumber:archiveMode?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,practice:archiveMode,challengeDate:dailyDate||null});
      await verify(result,details);
      stage.hidden=true;resultEl.hidden=false;
      resultEl.innerHTML=`<div class="labgame-result-inner"><span class="simple-result-kicker">${dailyMode?`${archiveMode?"Past Daily · Practice":"Daily"} #${BrainiData.dailyNumberForDate?.(dailyDate)||""} · `:""}Odd One Out complete</span><h2>${correct}<small> / ${ROUNDS}</small></h2><p>${score} points</p><div class="labgame-result-grid"><div><span>Correct</span><strong>${correct}</strong></div><div><span>Accuracy</span><strong>${correct*10}%</strong></div><div><span>Rounds</span><strong>${ROUNDS}</strong></div></div><div class="inline-quiz-result-actions"><a class="simple-result-play" href="${scoringDaily?"../../daily-quiz/":archiveMode?"../index.html":"./"}">${scoringDaily?"Continue Daily":archiveMode?"Choose another Past Daily game":"Play another set"}</a><a class="simple-result-progress" href="../index.html">Choose another game</a></div></div>`;
    }
    start.onclick=async()=>{
      start.disabled=true;intro.hidden=true;loading.hidden=false;
      const x=await load();rounds=x.rounds;source=x.source;loading.hidden=true;
      if(rounds.length!==ROUNDS){intro.hidden=false;start.disabled=false;root.querySelector("[data-load-error]").hidden=false;return}
      healthTracker=window.BrainiContentHealth?BrainiContentHealth.create({gameId:"oddoneout",contentType:"oddoneout",contentIds:rounds.map(r=>r.id),dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null}):null;
      stage.hidden=false;started=performance.now();render();
    };
  }
  return {mount,load};
})();
