/* BrainiLab Math Rush — V41.8.0 */
window.BrainiMathRush=(function(){
  const LIMIT=60;
  const PARAMS=new URLSearchParams(location.search);
  const dailyDate=PARAMS.get("daily")||PARAMS.get("archive")||null;
  const archiveMode=!!PARAMS.get("archive");
  const dailyMode=!!dailyDate;
  const scoringDaily=dailyMode&&!archiveMode;
  function client(){return window.BrainiBackendAuth?.getClient?.()||null}
  function configured(){return !!window.BrainiBackendAuth?.isConfigured?.()}
  function uid(){return globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}
  function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function rand(seed,n){let x=hash(`${seed}:${n}`);x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296}
  function localOperations(seed){
    const ops=[];
    for(let i=1;i<=LIMIT;i++){
      const kind=Math.floor(rand(seed,i*7)*4);let a=1,b=1,op="+",answer=2;
      if(kind===0){a=1+Math.floor(rand(seed,i*11)*9);b=1+Math.floor(rand(seed,i*13)*9);op="+";answer=a+b}
      if(kind===1){a=1+Math.floor(rand(seed,i*17)*9);b=1+Math.floor(rand(seed,i*19)*9);if(b>a)[a,b]=[b,a];op="−";answer=a-b}
      if(kind===2){a=1+Math.floor(rand(seed,i*23)*9);b=1+Math.floor(rand(seed,i*29)*9);op="×";answer=a*b}
      if(kind===3){b=1+Math.floor(rand(seed,i*31)*9);const maxQ=Math.max(1,Math.floor(9/b));answer=1+Math.floor(rand(seed,i*37)*maxQ);a=b*answer;op="÷"}
      ops.push({id:`${seed}:${i}`,position:i,a,b,op,answer,display:`${a} ${op} ${b}`});
    }
    return ops;
  }
  async function load(){
    const seed=dailyMode?`daily:${dailyDate}:mathrush`:`anytime:${uid()}`;
    if(configured()){
      try{
        const {data,error}=await client().rpc("get_brainilab_math_rush_game",{p_seed:seed,p_challenge_date:dailyMode?dailyDate:null});
        if(error)throw error;
        const operations=(data?.operations||[]).map(x=>{const a=Number(x.a),b=Number(x.b),op=x.operator;const answer=op==="+"?a+b:op==="−"?a-b:op==="×"?a*b:a/b;return {id:String(x.operation_id||`${data.seed}:${x.position}`),position:Number(x.position),a,b,op,answer,display:`${a} ${op} ${b}`}});
        if(operations.length===LIMIT)return {source:"supabase",seed:data.seed||seed,operations};
      }catch(e){console.warn("Math Rush cloud fallback:",e.message||e)}
    }
    return {source:"local",seed,operations:localOperations(seed)};
  }
  async function verify(result,seed,answers,source){
    if(source!=="supabase"||!configured()||result?.cloudSyncStatus!=="synced")return;
    const session=await BrainiBackendAuth?.getSession?.();if(!session?.user)return;
    try{const {data,error}=await client().rpc("verify_brainilab_math_rush_result",{p_client_result_id:result.clientResultId,p_seed:seed,p_answers:answers});if(error)throw error;await BrainiData.api.markResultAnswerVerified?.(result.clientResultId,data||{})}catch(e){console.warn("Math Rush verification:",e.message||e)}
  }
  async function mount(root){
    if(scoringDaily && await window.BrainiDailyCompletionGuard?.check?.()) return;
    const intro=root.querySelector("[data-intro]"),loading=root.querySelector("[data-loading]"),stage=root.querySelector("[data-stage]"),resultEl=root.querySelector("[data-result]"),start=root.querySelector("[data-start]"),timeEl=root.querySelector("[data-time]"),meta=root.querySelector("[data-meta]"),scoreEl=root.querySelector("[data-score]"),progress=root.querySelector("[data-progress]"),problem=root.querySelector("[data-problem]"),form=root.querySelector("[data-form]"),input=root.querySelector("[data-answer]"),skip=root.querySelector("[data-skip]"),feedback=root.querySelector("[data-feedback]");
    let data=null,idx=0,score=0,correct=0,attempted=0,combo=0,bestCombo=0,answers=[],started=0,timer=null,ended=false,healthTracker=null;
    function current(){return data.operations[idx]}
    function render(){const op=current();if(!op)return finish();meta.textContent=`${dailyMode?(archiveMode?"Past Daily · Practice":"Daily")+" · ":""}Question ${idx+1}`;problem.textContent=op.display;scoreEl.textContent=`${score.toLocaleString()} pts`;input.value="";input.focus();feedback.textContent=""}
    function advance(){idx++;render()}
    function consume(value,skipped=false){if(ended)return;const op=current();if(!op)return;let ok=false;if(!skipped){attempted++;ok=Number(value)===Number(op.answer)}
      if(skipped){combo=0;feedback.textContent="Skipped"}else if(ok===true){correct++;combo++;bestCombo=Math.max(bestCombo,combo);score+=100+Math.min(100,Math.max(0,combo-1)*10);feedback.textContent="Correct ✓"}else if(ok===false){combo=0;feedback.textContent="Not quite"}else{combo=0;feedback.textContent="Not quite"}
      answers.push({position:op.position,answer:skipped?null:Number(value),skipped,correct:skipped?null:ok});healthTracker?.checkpoint(Math.min(LIMIT,idx+1));setTimeout(advance,70)}
    form.onsubmit=e=>{e.preventDefault();const raw=input.value.trim();if(raw==="")return;consume(Number(raw),false)};
    skip.onclick=()=>consume(null,true);
    async function finish(){if(ended)return;ended=true;clearInterval(timer);stage.hidden=true;resultEl.hidden=false;const timeSec=Math.max(1,Math.round((performance.now()-started)/1000));const accuracy=attempted?Math.round(correct/attempted*100):0;healthTracker?.complete(answers.slice(0,60).map((x,i)=>({contentId:`${data.seed}:${x.position}`,position:i+1,attempts:1,isCorrect:x.correct,skipped:x.skipped,score:x.correct?(100):0})));let result=await BrainiData.api.submitGameResult("mathrush",{score,correct,total:attempted,accuracy,timeSec,bestCombo,skips:answers.filter(x=>x.skipped).length,seed:data.seed,contentSource:data.source,dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,archiveDailyNumber:archiveMode?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,practice:archiveMode,challengeDate:dailyDate||null});await verify(result,data.seed,answers,data.source);resultEl.innerHTML=`<div class="labgame-result-inner"><span class="simple-result-kicker">${dailyMode?`${archiveMode?"Past Daily · Practice":"Daily"} #${BrainiData.dailyNumberForDate?.(dailyDate)||""} · `:""}Math Rush complete</span><h2>${correct}<small> correct</small></h2><p>${score.toLocaleString()} points</p><div class="labgame-result-grid"><div><span>Accuracy</span><strong>${accuracy}%</strong></div><div><span>Best combo</span><strong>${bestCombo}</strong></div><div><span>Skipped</span><strong>${answers.filter(x=>x.skipped).length}</strong></div></div><div class="inline-quiz-result-actions"><a class="simple-result-play" href="${scoringDaily?"../../daily-quiz/":archiveMode?"../index.html":"./"}">${scoringDaily?"Continue Daily":archiveMode?"Choose another Past Daily game":"Play again"}</a><a class="simple-result-progress" href="../index.html">Choose another game</a></div></div>`}
    start.onclick=async()=>{start.disabled=true;intro.hidden=true;loading.hidden=false;data=await load();loading.hidden=true;if(!data?.operations?.length){intro.hidden=false;start.disabled=false;root.querySelector("[data-load-error]").hidden=false;return}healthTracker=window.BrainiContentHealth?BrainiContentHealth.create({gameId:"mathrush",contentType:"mathrush",contentIds:data.operations.slice(0,60).map(x=>String(x.id)),dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null}):null;stage.hidden=false;started=performance.now();let remaining=60;timeEl.textContent=remaining;progress.style.width="100%";render();timer=setInterval(()=>{remaining--;timeEl.textContent=Math.max(0,remaining);progress.style.width=`${Math.max(0,remaining/60*100)}%`;if(remaining<=0)finish()},1000)};
  }
  return {mount,localOperations};
})();
