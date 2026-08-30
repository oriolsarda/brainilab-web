/* BrainiLab Higher or Lower — V41.8.0 */
window.BrainiHigherLower=(function(){
  const ROUNDS=10;
  const PARAMS=new URLSearchParams(location.search);
  const dailyDate=PARAMS.get("daily")||PARAMS.get("archive")||null;
  const archiveMode=!!PARAMS.get("archive");
  const dailyMode=!!dailyDate;
  const scoringDaily=dailyMode&&!archiveMode;

  const TYPES={
    higher_lower:{first:"Higher",second:"Lower",greater:"first",question:r=>`Is ${r.right} higher or lower than ${r.left}?`},
    older_younger:{first:"Older",second:"Younger",greater:"second",question:r=>`Is ${r.right} older or younger than ${r.left}?`},
    taller_shorter:{first:"Taller",second:"Shorter",greater:"first",question:r=>`Is ${r.right} taller or shorter than ${r.left}?`},
    richer_poorer:{first:"Richer",second:"Poorer",greater:"first",question:r=>`Is ${r.right} richer or poorer than ${r.left}?`},
    bigger_smaller:{first:"Bigger",second:"Smaller",greater:"first",question:r=>`Is ${r.right} bigger or smaller than ${r.left}?`},
    faster_slower:{first:"Faster",second:"Slower",greater:"first",question:r=>`Is ${r.right} faster or slower than ${r.left}?`},
    hotter_colder:{first:"Hotter",second:"Colder",greater:"first",question:r=>`Is ${r.right} hotter or colder than ${r.left}?`},
    heavier_lighter:{first:"Heavier",second:"Lighter",greater:"first",question:r=>`Is ${r.right} heavier or lighter than ${r.left}?`},
    longer_shorter:{first:"Longer",second:"Shorter",greater:"first",question:r=>`Is ${r.right} longer or shorter than ${r.left}?`},
    farther_closer:{first:"Farther",second:"Closer",greater:"first",question:r=>`Is ${r.right} farther or closer than ${r.left}?`},
    earlier_later:{first:"Earlier",second:"Later",greater:"second",question:r=>`Did ${r.right} happen earlier or later than ${r.left}?`},
    more_less:{first:"More",second:"Less",greater:"first",question:r=>`Does ${r.right} have more or less ${String(r.metric||"of this").toLowerCase()} than ${r.left}?`}
  };

  function typeOf(r){return TYPES[r.comparisonType]||TYPES.higher_lower}
  function client(){return window.BrainiBackendAuth?.getClient?.()||null}
  function configured(){return !!window.BrainiBackendAuth?.isConfigured?.()}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
  function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}function seedHash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function hist(){try{return BrainiData.anytimeHistory?.("higherlower")||{}}catch{return{}}}
  function excludes(){return Object.entries(hist()).filter(([,v])=>Number(v?.timesPlayed||0)>0).map(([id])=>id).filter(x=>/^[0-9a-f-]{36}$/i.test(x)).slice(0,500)}
  function points(combo){return 100+Math.min(100,Math.max(0,combo-1)*20)}
  function formatValue(v,unit){const n=Number(v);const text=Number.isFinite(n)?new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(n):String(v);return `${text}${unit?` ${unit}`:""}`}
  function localDirection(r){const cfg=typeOf(r),greater=r.rightValue>r.leftValue;return greater?cfg.greater:(cfg.greater==="first"?"second":"first")}
  function mapRows(data){return (data?.pairs||[]).map(x=>({id:x.pair_id,category:x.category,metric:x.metric,comparisonType:x.comparison_type||"higher_lower",left:x.left_label,leftValue:Number(x.left_value),right:x.right_label,unit:x.unit,cloud:true}))}
  function localDaily(){const key=String(dailyDate||"");return (BrainiHigherLowerPairs?.all?.()||[]).slice().sort((a,b)=>(seedHash(`${key}:${a.id}`)-seedHash(`${key}:${b.id}`))||String(a.id).localeCompare(String(b.id))).slice(0,ROUNDS).map(x=>({...x,cloud:false}))}

  async function load(){
    if(configured())try{
      const {data,error}=dailyMode
        ? await client().rpc("get_brainilab_daily_higher_lower",{p_challenge_date:dailyDate})
        : await client().rpc("get_brainilab_higher_lower_game",{p_exclude_pair_ids:excludes()});
      if(error)throw error;
      const rows=mapRows(data);
      if(rows.length===ROUNDS)return {source:"supabase",rounds:rows};
    }catch(e){console.warn("Higher Lower cloud fallback:",e.message||e)}
    if(dailyMode)return {source:"local",rounds:localDaily()};
    const h=hist(),all=shuffle(BrainiHigherLowerPairs?.all?.()||[]).sort((a,b)=>(h[a.id]?.timesPlayed||0)-(h[b.id]?.timesPlayed||0));
    return {source:"local",rounds:all.slice(0,ROUNDS).map(x=>({...x,cloud:false}))};
  }

  async function check(r,choice){
    if(!r.cloud){const direction=localDirection(r),cfg=typeOf(r);return {correct:choice===direction,direction,label:cfg[direction],rightValue:r.rightValue,explanation:r.explanation}}
    const {data,error}=await client().rpc("check_brainilab_higher_lower_answer",{p_pair_id:r.id,p_choice:choice});
    if(error)throw error;
    return {correct:!!data?.correct,direction:data?.direction,label:data?.label||typeOf(r)[data?.direction]||"",rightValue:Number(data?.right_value),explanation:data?.explanation||""};
  }
  async function syncHistory(ids){try{BrainiData.recordAnytimeHistory?.("higherlower",ids)}catch{};if(!configured())return;const s=await BrainiBackendAuth?.getSession?.();if(!s?.user)return;const cloud=ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x));if(cloud.length)try{await client().rpc("record_brainilab_higher_lower_history",{p_pair_ids:cloud})}catch(e){console.warn(e)}}
  async function verify(result,details){if(!configured()||result?.cloudSyncStatus!=="synced")return;const s=await BrainiBackendAuth?.getSession?.();if(!s?.user)return;const rows=details.filter(x=>/^[0-9a-f-]{36}$/i.test(x.pairId)).map(x=>({pair_id:x.pairId,choice:x.choice}));if(rows.length!==ROUNDS)return;try{const {data,error}=await client().rpc("verify_brainilab_higher_lower_result",{p_client_result_id:result.clientResultId,p_rounds:rows});if(error)throw error;await BrainiData.api.markResultAnswerVerified?.(result.clientResultId,data||{})}catch(e){console.warn(e)}}

  async function mount(root){
    if(scoringDaily && await window.BrainiDailyCompletionGuard?.check?.()) return;
    const intro=root.querySelector("[data-intro]"),loading=root.querySelector("[data-loading]"),stage=root.querySelector("[data-stage]"),resultEl=root.querySelector("[data-result]"),start=root.querySelector("[data-start]"),meta=root.querySelector("[data-meta]"),metric=root.querySelector("[data-metric]"),left=root.querySelector("[data-left]"),right=root.querySelector("[data-right]"),firstBtn=root.querySelector("[data-higher]"),secondBtn=root.querySelector("[data-lower]"),feedback=root.querySelector("[data-feedback]"),next=root.querySelector("[data-next]"),scoreEl=root.querySelector("[data-score]"),progress=root.querySelector("[data-progress]");
    let rounds=[],idx=0,correct=0,score=0,combo=0,bestCombo=0,locked=false,details=[],started=0,source="local",finished=false,healthTracker=null;
    function render(){
      const r=rounds[idx],cfg=typeOf(r);locked=false;healthTracker?.checkpoint(idx+1);
      meta.textContent=`${dailyMode?(archiveMode?"Past Daily · Practice":"Daily")+" · ":""}Round ${idx+1} of ${ROUNDS} · ${r.category||"general"}`;
      metric.textContent=cfg.question(r);
      left.innerHTML=`<small>${esc(r.metric)}</small><strong>${esc(r.left)}</strong><span class="hl-value">${esc(formatValue(r.leftValue,r.unit))}</span>`;
      right.innerHTML=`<small>${esc(r.metric)}</small><strong>${esc(r.right)}</strong><span class="hl-value">?</span>`;
      firstBtn.textContent=cfg.first;secondBtn.textContent=cfg.second;feedback.innerHTML="";firstBtn.disabled=secondBtn.disabled=false;next.hidden=true;scoreEl.textContent=`${score.toLocaleString()} pts`;progress.style.width=`${(idx/ROUNDS)*100}%`;
    }
    async function choose(choice){
      if(locked)return;locked=true;firstBtn.disabled=secondBtn.disabled=true;feedback.textContent="Checking…";const r=rounds[idx];let x;
      try{x=await check(r,choice)}catch(e){locked=false;firstBtn.disabled=secondBtn.disabled=false;feedback.textContent="Could not check that answer.";return}
      details.push({pairId:r.id,choice,correct:x.correct});right.querySelector(".hl-value").textContent=formatValue(x.rightValue,r.unit);
      if(x.correct){correct++;combo++;bestCombo=Math.max(bestCombo,combo);const gain=points(combo);score+=gain;feedback.innerHTML=`<strong>✓ ${esc(x.label)} · +${gain} pts</strong><span>${esc(x.explanation)}</span>`}
      else{combo=0;feedback.innerHTML=`<strong style="color:#ff9b96">${esc(x.label)}</strong><span>${esc(x.explanation)}</span>`}
      scoreEl.textContent=`${score.toLocaleString()} pts`;progress.style.width=`${((idx+1)/ROUNDS)*100}%`;next.textContent=idx===ROUNDS-1?"See result":"Next comparison";next.hidden=false;locked=false;
    }
    firstBtn.onclick=()=>choose("first");secondBtn.onclick=()=>choose("second");next.onclick=()=>idx===ROUNDS-1?finish():(idx++,render());
    async function finish(){
      if(finished)return;finished=true;if(!dailyMode)await syncHistory(details.map(x=>x.pairId));
      healthTracker?.complete(details.map((x,i)=>({contentId:x.pairId,position:i+1,attempts:1,isCorrect:x.correct,score:x.correct?100:0})));
      const timeSec=Math.max(1,Math.round((performance.now()-started)/1000));
      let result=await BrainiData.api.submitGameResult("higherlower",{score,correct,total:ROUNDS,accuracy:correct*10,timeSec,bestCombo,contentSource:source,dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,archiveDailyNumber:archiveMode?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,practice:archiveMode,challengeDate:dailyDate||null});
      await verify(result,details);stage.hidden=true;resultEl.hidden=false;
      resultEl.innerHTML=`<div class="labgame-result-inner"><span class="simple-result-kicker">${dailyMode?`${archiveMode?"Past Daily · Practice":"Daily"} #${BrainiData.dailyNumberForDate?.(dailyDate)||""} · `:""}Higher or Lower complete</span><h2>${correct}<small> / ${ROUNDS}</small></h2><p>${score.toLocaleString()} points</p><div class="labgame-result-grid"><div><span>Correct</span><strong>${correct}</strong></div><div><span>Best combo</span><strong>${bestCombo}</strong></div><div><span>Accuracy</span><strong>${correct*10}%</strong></div></div><div class="inline-quiz-result-actions"><a class="simple-result-play" href="${scoringDaily?"../../daily-quiz/":archiveMode?"../index.html":"./"}">${scoringDaily?"Continue Daily":archiveMode?"Choose another Past Daily game":"Play another set"}</a><a class="simple-result-progress" href="../index.html">Choose another game</a></div></div>`;
    }
    start.onclick=async()=>{
      start.disabled=true;intro.hidden=true;loading.hidden=false;const x=await load();rounds=x.rounds;source=x.source;loading.hidden=true;
      if(rounds.length!==ROUNDS){intro.hidden=false;start.disabled=false;root.querySelector("[data-load-error]").hidden=false;return}
      healthTracker=window.BrainiContentHealth?BrainiContentHealth.create({gameId:"higherlower",contentType:"higherlower",contentIds:rounds.map(r=>r.id),dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null}):null;
      stage.hidden=false;started=performance.now();render();
    };
  }
  return {mount,load,TYPES};
})();
