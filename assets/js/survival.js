/* BrainiLab Survival — V41.8.0 */
window.BrainiSurvival=(function(){
  const MAX_QUESTIONS=30, START_LIVES=3;
  function client(){return window.BrainiBackendAuth?.getClient?.()||null}
  function configured(){return !!window.BrainiBackendAuth?.isConfigured?.()}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
  function hash(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
  function localExclude(){try{return (BrainiData.anytimePlayedIds?.("survival")||[]).filter(x=>/^[0-9a-f-]{36}$/i.test(x)).slice(0,600)}catch{return[]}}
  function stagePoints(difficulty,combo){const base=difficulty==="hard"?200:difficulty==="medium"?150:100;return base+Math.min(200,Math.max(0,combo-1)*25)}
  function shuffled(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function mapCloud(data){return (data?.questions||[]).map(x=>({id:x.question_version_id,q:x.prompt,a:(x.options||[]).map(o=>o.text),optionIds:(x.options||[]).map(o=>o.id),difficulty:x.difficulty,topic:x.topic,cloud:true}))}
  function flagInfo(question){
    const text=String(question||"");
    const m=text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if(!m)return null;
    const flag=m[0];
    const code=Array.from(flag).map(ch=>String.fromCharCode(ch.codePointAt(0)-0x1F1E6+65)).join("").toLowerCase();
    const clean=(text.slice(0,m.index)+text.slice(m.index+flag.length)).replace(/\s+/g," ").trim();
    return {flag,code,clean};
  }
  function renderQuestion(el,question){
    const info=flagInfo(question);
    if(!info){el.textContent=String(question||"");return;}
    el.innerHTML="";
    const text=document.createElement("span");
    text.textContent=info.clean;
    const flag=document.createElement("img");
    flag.className="question-flag-emoji survival-question-flag";
    flag.src=window.BrainiIcons?.flagEmojiAsset?BrainiIcons.flagEmojiAsset(info.code):`../../assets/flags/emoji/${info.code}.png`;
    flag.alt=info.flag;
    flag.decoding="async";
    flag.addEventListener("error",()=>{const fallback=document.createElement("span");fallback.className="question-flag-text";fallback.textContent=info.flag;flag.replaceWith(fallback)},{once:true});
    el.append(text,document.createElement("br"),flag);
  }
  function localPool(){
    const topics=["generalknowledge","worldflags","worldcapitals","science","history","sports"], out=[];
    for(const difficulty of ["easy","medium","hard"]){
      let bucket=[]; for(const topic of topics){for(const q of (BrainiQuizPacks?.get?.(topic,difficulty,"1")||[])){bucket.push({...q,id:`local-${hash(topic+"|"+difficulty+"|"+q.q)}`,difficulty,topic,cloud:false})}}
      out.push(...shuffled(bucket).slice(0,10));
    }
    return out;
  }
  async function load(){
    if(configured()) try{const {data,error}=await client().rpc("get_brainilab_survival_game",{p_exclude_question_ids:localExclude()});if(error)throw error;const q=mapCloud(data);if(q.length>=15)return {source:"supabase",questions:q}}catch(e){console.warn("Survival cloud fallback:",e.message||e)}
    return {source:"local",questions:localPool()};
  }
  async function check(item,choice){
    if(!item.cloud){const ok=choice===item.c;return {ok,correctIndex:item.c,correctAnswer:item.a[item.c],explanation:item.f||""}}
    const {data,error}=await client().rpc("check_brainilab_quiz_answer",{p_question_version_id:item.id,p_selected_option_id:item.optionIds[choice]});if(error)throw error;
    return {ok:!!data?.is_correct,correctIndex:item.optionIds.indexOf(data?.correct_option_id),correctAnswer:data?.correct_answer,explanation:data?.explanation||""};
  }
  async function verify(result,answers){
    if(!configured()||!result?.clientResultId||result.cloudSyncStatus!=="synced")return;
    const session=await BrainiBackendAuth?.getSession?.();if(!session?.user)return;
    const rows=answers.filter(x=>/^[0-9a-f-]{36}$/i.test(x.questionId)).map(x=>({question_version_id:x.questionId,selected_option_id:x.selectedOptionId,response_time_ms:x.responseTimeMs}));
    if(!rows.length)return;
    try{const {data,error}=await client().rpc("verify_brainilab_survival_result",{p_client_result_id:result.clientResultId,p_answers:rows});if(error)throw error;await BrainiData.api.markResultAnswerVerified?.(result.clientResultId,data||{})}catch(e){console.warn("Survival verification:",e.message||e)}
  }
  function mount(root){
    const intro=root.querySelector("[data-intro]"),loading=root.querySelector("[data-loading]"),stage=root.querySelector("[data-stage]"),resultEl=root.querySelector("[data-result]"),start=root.querySelector("[data-start]"),qEl=root.querySelector("[data-question]"),meta=root.querySelector("[data-meta]"),answersEl=root.querySelector("[data-answers]"),feedback=root.querySelector("[data-feedback]"),next=root.querySelector("[data-next]"),scoreEl=root.querySelector("[data-score]"),countEl=root.querySelector("[data-count]"),livesEl=root.querySelector("[data-lives]"),progress=root.querySelector("[data-progress]");
    let questions=[],idx=0,lives=START_LIVES,score=0,combo=0,correct=0,locked=false,details=[],started=0,questionStarted=0,source="local",finished=false,healthTracker=null;
    function livesMarkup(){return Array.from({length:START_LIVES},(_,i)=>`<span class="survival-life ${i>=lives?"lost":""}">♥</span>`).join("")}
    function render(){
      const item=questions[idx];if(!item){finish();return} locked=false;healthTracker?.checkpoint(idx+1);questionStarted=performance.now();feedback.innerHTML="";next.hidden=true;scoreEl.textContent=`${score.toLocaleString()} pts`;countEl.textContent=`Question ${idx+1}`;livesEl.innerHTML=livesMarkup();progress.style.width=`${Math.min(100,(idx/MAX_QUESTIONS)*100)}%`;meta.innerHTML=`${esc(item.topic||"Mixed")} <span class="survival-difficulty">${esc(item.difficulty||"mixed")}</span>`;renderQuestion(qEl,item.q);answersEl.innerHTML="";
      item.a.forEach((txt,i)=>{const b=document.createElement("button");b.className="labgame-answer";b.type="button";b.innerHTML=`<span>${esc(txt)}</span>`;b.onclick=()=>choose(item,i,b);answersEl.appendChild(b)});
    }
    async function choose(item,choice,btn){if(locked)return;locked=true;[...answersEl.children].forEach(x=>x.disabled=true);feedback.textContent="Checking…";const responseTimeMs=Math.max(0,Math.round(performance.now()-questionStarted));let r;try{r=await check(item,choice)}catch(e){locked=false;[...answersEl.children].forEach(x=>x.disabled=false);feedback.textContent="Could not check that answer. Try again.";return}
      const selectedOptionId=item.cloud?item.optionIds[choice]:null;details.push({questionId:item.id,selectedOptionId,responseTimeMs,isCorrect:r.ok,difficulty:item.difficulty});
      [...answersEl.children].forEach((x,i)=>{if(i===r.correctIndex)x.classList.add("correct")});
      if(r.ok){correct++;combo++;const gain=stagePoints(item.difficulty,combo);score+=gain;btn.classList.add("correct");feedback.innerHTML=`<strong>✓ +${gain.toLocaleString()} pts</strong><span>${esc(r.explanation||r.correctAnswer||"")}</span>`}else{combo=0;lives--;btn.classList.add("wrong");feedback.innerHTML=`<strong style="color:#ff9b96">Life lost · ${lives} remaining</strong><span>Correct: ${esc(r.correctAnswer||"")}${r.explanation?` · ${esc(r.explanation)}`:""}</span>`}
      scoreEl.textContent=`${score.toLocaleString()} pts`;livesEl.innerHTML=livesMarkup();progress.style.width=`${Math.min(100,((idx+1)/MAX_QUESTIONS)*100)}%`;next.textContent=(lives<=0||idx>=questions.length-1)?"See result":"Next question";next.hidden=false;locked=false;
    }
    next.onclick=()=>{if(lives<=0||idx>=questions.length-1)finish();else{idx++;render()}};
    async function finish(){if(finished)return;finished=true;const played=details.length,timeSec=Math.max(1,Math.round((performance.now()-started)/1000));try{BrainiData.recordAnytimeHistory?.("survival",details.map(x=>x.questionId))}catch{}
      healthTracker?.complete(details.map((x,i)=>({contentId:x.questionId,position:i+1,attempts:1,isCorrect:x.isCorrect,responseTimeMs:x.responseTimeMs})));
      let result=await BrainiData.api.submitGameResult("survival",{score,correct,total:played,accuracy:played?Math.round(correct/played*100):0,timeSec,livesRemaining:lives,bestCombo:null,contentSource:source});await verify(result,details);stage.hidden=true;resultEl.hidden=false;resultEl.innerHTML=`<div class="labgame-result-inner"><span class="simple-result-kicker">Survival complete</span><h2>${correct}<small> correct</small></h2><p>${score.toLocaleString()} points</p><div class="labgame-result-grid"><div><span>Questions faced</span><strong>${played}</strong></div><div><span>Accuracy</span><strong>${played?Math.round(correct/played*100):0}%</strong></div><div><span>Lives left</span><strong>${Math.max(0,lives)}</strong></div></div><div class="inline-quiz-result-actions"><a class="simple-result-play" href="./">Play Survival again</a><a class="simple-result-progress" href="../index.html">Choose another game</a></div></div>`;
    }
    start.onclick=async()=>{start.disabled=true;intro.hidden=true;loading.hidden=false;const loaded=await load();questions=loaded.questions.slice(0,MAX_QUESTIONS);source=loaded.source;loading.hidden=true;if(!questions.length){intro.hidden=false;start.disabled=false;root.querySelector("[data-load-error]").hidden=false;return}healthTracker=window.BrainiContentHealth?BrainiContentHealth.create({gameId:"survival",contentType:"question",contentIds:questions.map(q=>q.id)}):null;stage.hidden=false;started=performance.now();render()};
  }
  return {mount,load};
})();
