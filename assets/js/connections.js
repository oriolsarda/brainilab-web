/* BrainiLab Connections — V41.8.0
   20 rounds Play Anytime; Daily/Past Daily use 3 rounds. Unseen puzzles are prioritised.
*/
window.BrainiConnections=(function(){
  const SCORE_BY_ATTEMPT=[1000,700,400,200];
  const DAILY_ROUNDS=3,ANYTIME_ROUNDS=20;
  const PARAMS=new URLSearchParams(location.search);
  const dailyDate=PARAMS.get("daily")||PARAMS.get("archive")||null;
  const archiveMode=!!PARAMS.get("archive");
  const dailyMode=!!dailyDate;
  const scoringDaily=dailyMode&&!archiveMode;
  const ROUND_COUNT=dailyMode?DAILY_ROUNDS:ANYTIME_ROUNDS;
  const MAX_SCORE=ROUND_COUNT*1000;

  function client(){ return window.BrainiBackendAuth?.getClient?.()||null; }
  function configured(){ return !!window.BrainiBackendAuth?.isConfigured?.(); }
  function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

  function localHistory(){
    const counts=new Map();
    try{
      const bucket=window.BrainiData?.anytimeHistory?.("connections")||{};
      Object.entries(bucket).forEach(([id,entry])=>{
        counts.set(String(id),Math.max(0,Number(entry?.timesPlayed||0)));
      });
    }catch(err){}
    return counts;
  }

  function recordLocalHistory(roundDetails){
    const ids=(roundDetails||[]).map(x=>String(x?.puzzleId||"")).filter(Boolean);
    if(!ids.length) return;
    try{ window.BrainiData?.recordAnytimeHistory?.("connections",ids); }
    catch(err){ console.warn("BrainiLab local Connections history:",err?.message||err); }
  }

  function cloudExcludeIds(){
    const ids=[];
    localHistory().forEach((count,id)=>{
      if(count>0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ids.push(id);
    });
    return ids.slice(0,200);
  }

  function shuffle(values){
    const a=values.slice();
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function seedHash(value){
    let h=2166136261;
    for(const c of String(value)){
      h^=c.charCodeAt(0);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function mapCloud(data){
    return (data?.puzzles||[]).map(row=>({
      id:row.puzzle_id,
      externalKey:row.external_key,
      category:row.category,
      prompt:row.prompt||"What connects these?",
      clues:row.clues||[],
      choices:(row.choices||[]).map(choice=>({id:choice.id,text:choice.text})),
      source:"supabase"
    }));
  }

  function loadLocal(){
    const all=window.BrainiConnectionsPuzzles?.all?.()||[];
    const history=localHistory();
    const ranked=shuffle(all).sort((a,b)=>(history.get(a.id)||0)-(history.get(b.id)||0));
    return ranked.slice(0,ROUND_COUNT).map(p=>({
      ...deepClone(p),
      choices:p.choices.map((text,index)=>({id:`${p.id}-choice-${index}`,text,index})),
      source:"local"
    }));
  }

  async function loadGame(){
    if(configured()){
      try{
        const sb=client();
        const {data,error}=dailyMode
          ? await sb.rpc("get_brainilab_daily_connections",{p_challenge_date:dailyDate})
          : await sb.rpc("get_brainilab_connections_game",{p_exclude_puzzle_ids:cloudExcludeIds()});
        if(error) throw error;
        const rows=mapCloud(data);
        if(rows.length===ROUND_COUNT) return {source:"supabase",rounds:rows};
      }catch(err){
        console.warn("BrainiLab Connections cloud pool unavailable; using local fallback:",err.message||err);
      }
    }
    if(dailyMode){
      const all=window.BrainiConnectionsPuzzles?.all?.()||[];
      const key=String(dailyDate||"");
      const ranked=all.slice().sort((a,b)=>(seedHash(`${key}:${a.id}`)-seedHash(`${key}:${b.id}`))||String(a.id).localeCompare(String(b.id)));
      return {source:"local",rounds:ranked.slice(0,ROUND_COUNT).map(p=>({...deepClone(p),choices:p.choices.map((text,index)=>({id:`${p.id}-choice-${index}`,text,index})),source:"local"}))};
    }
    return {source:"local",rounds:loadLocal()};
  }

  async function checkGuess(round,choice){
    if(round.source!=="supabase"){
      const index=round.choices.findIndex(x=>x.id===choice.id);
      const correct=index===round.correct;
      return {
        correct,
        answer:correct?round.choices[round.correct]?.text:null,
        explanation:correct?round.explanation:null
      };
    }

    const sb=client();
    if(!sb) throw new Error("Connections checker unavailable");
    const {data,error}=await sb.rpc("check_brainilab_connections_guess",{
      p_puzzle_id:round.id,
      p_choice_id:choice.id
    });
    if(error) throw error;
    return {
      correct:!!data?.correct,
      answer:data?.answer||null,
      explanation:data?.explanation||null
    };
  }

  async function recordCloudHistory(roundDetails){
    if(!configured()) return;
    const session=await BrainiBackendAuth?.getSession?.();
    if(!session?.user) return;
    const ids=(roundDetails||[])
      .map(x=>x.puzzleId)
      .filter(id=>/^[0-9a-f-]{36}$/i.test(String(id||"")));
    if(!ids.length) return;
    try{
      const {error}=await client().rpc("record_brainilab_connections_history",{p_puzzle_ids:ids});
      if(error) throw error;
    }catch(err){
      console.warn("BrainiLab Connections history sync:",err.message||err);
    }
  }

  async function verifyCloudResult(result,roundDetails){
    if(!configured() || !result?.clientResultId) return;
    const session=await BrainiBackendAuth?.getSession?.();
    if(!session?.user || result.cloudSyncStatus!=="synced") return;
    const payload=(roundDetails||[]).filter(x=>/^[0-9a-f-]{36}$/i.test(String(x.puzzleId||""))).map(x=>({
      puzzle_id:x.puzzleId,
      attempted_choice_ids:x.attemptedChoiceIds,
      attempts:x.attempts
    }));
    if(payload.length!==ROUND_COUNT) return;
    try{
      const {data,error}=await client().rpc("verify_brainilab_connections_result",{
        p_client_result_id:result.clientResultId,
        p_rounds:payload
      });
      if(error) throw error;
      await BrainiData.api.markResultAnswerVerified?.(result.clientResultId,data||{});
    }catch(err){
      console.warn("BrainiLab Connections result verification:",err.message||err);
    }
  }

  async function mount(root){
    if(scoringDaily && await window.BrainiDailyCompletionGuard?.check?.()) return;
    const intro=root.querySelector("[data-connections-intro]");
    const roundsStat=root.querySelector("[data-connections-rounds-stat]");
    const roundsLabel=root.querySelector("[data-connections-rounds-label]");
    const maxStat=root.querySelector("[data-connections-max-stat]");
    const maxLabel=root.querySelector("[data-connections-max-label]");
    if(roundsStat) roundsStat.textContent=String(ROUND_COUNT);
    if(roundsLabel) roundsLabel.textContent=dailyMode?"Daily rounds":"Anytime rounds";
    if(maxStat) maxStat.textContent=MAX_SCORE.toLocaleString();
    if(maxLabel) maxLabel.textContent=dailyMode?"Daily raw max":"Anytime max";
    const game=root.querySelector("[data-connections-game]");
    const resultEl=root.querySelector("[data-connections-result]");
    const loading=root.querySelector("[data-connections-loading]");
    const start=root.querySelector("[data-connections-start]");
    const roundCount=root.querySelector("[data-connections-round]");
    const scoreEl=root.querySelector("[data-connections-score]");
    const attemptsEl=root.querySelector("[data-connections-attempts]");
    const promptEl=root.querySelector("[data-connections-prompt]");
    const cluesEl=root.querySelector("[data-connections-clues]");
    const choicesEl=root.querySelector("[data-connections-choices]");
    const feedbackEl=root.querySelector("[data-connections-feedback]");
    const next=root.querySelector("[data-connections-next]");
    const progress=root.querySelector("[data-connections-progress]");

    let rounds=[],roundIndex=0,totalScore=0,attempts=0,locked=false,roundDetails=[],source="local",startedAt=0,healthTracker=null;

    function renderRound(){
      const round=rounds[roundIndex];
      healthTracker?.checkpoint(roundIndex+1);
      attempts=0;
      locked=false;
      roundCount.textContent=`Round ${roundIndex+1} of ${ROUND_COUNT}`;
      scoreEl.textContent=`${totalScore.toLocaleString()} / ${MAX_SCORE.toLocaleString()}`;
      attemptsEl.textContent="Attempt 1 · 1,000 pts available";
      promptEl.textContent=round.prompt||"What connects these?";
      progress.style.width=`${(roundIndex/ROUND_COUNT)*100}%`;
      feedbackEl.innerHTML="";
      next.hidden=true;
      next.textContent=roundIndex===ROUND_COUNT-1?"See result":"Next round";
      cluesEl.innerHTML=(round.clues||[]).map(clue=>`<div class="connections-clue">${escapeHtml(clue)}</div>`).join("");
      choicesEl.innerHTML="";
      shuffle(round.choices||[]).forEach(choice=>{
        const btn=document.createElement("button");
        btn.type="button";
        btn.className="connections-choice";
        btn.textContent=choice.text;
        btn.dataset.choiceId=choice.id;
        btn.addEventListener("click",()=>choose(round,choice,btn));
        choicesEl.appendChild(btn);
      });
    }

    async function choose(round,choice,button){
      if(locked || button.disabled) return;
      locked=true;
      button.disabled=true;
      attempts++;
      feedbackEl.innerHTML=`<span class="connections-checking">Checking…</span>`;

      let checked;
      try{ checked=await checkGuess(round,choice); }
      catch(err){
        locked=false;
        button.disabled=false;
        feedbackEl.innerHTML=`<span class="connections-error">Could not check that answer. Try again.</span>`;
        return;
      }

      const detail=roundDetails[roundIndex] || {
        puzzleId:round.id,
        attempts:0,
        attemptedChoiceIds:[],
        score:0
      };
      detail.attempts=attempts;
      detail.attemptedChoiceIds.push(choice.id);
      roundDetails[roundIndex]=detail;

      if(checked.correct){
        const gained=SCORE_BY_ATTEMPT[Math.min(attempts,4)-1]||200;
        detail.score=gained;
        totalScore+=gained;
        button.classList.add("correct");
        choicesEl.querySelectorAll("button").forEach(x=>x.disabled=true);
        scoreEl.textContent=`${totalScore.toLocaleString()} / ${MAX_SCORE.toLocaleString()}`;
        attemptsEl.textContent=`Solved in ${attempts} attempt${attempts===1?"":"s"} · +${gained.toLocaleString()} pts`;
        feedbackEl.innerHTML=`<strong>✓ ${escapeHtml(checked.answer||choice.text)}</strong>${checked.explanation?`<span>${escapeHtml(checked.explanation)}</span>`:""}`;
        progress.style.width=`${((roundIndex+1)/ROUND_COUNT)*100}%`;
        next.hidden=false;
        locked=false;
      }else{
        button.classList.add("wrong");
        const nextScore=SCORE_BY_ATTEMPT[Math.min(attempts,3)]||200;
        attemptsEl.textContent=`Attempt ${Math.min(attempts+1,4)} · ${nextScore.toLocaleString()} pts available`;
        feedbackEl.innerHTML=`<span>Not that connection. Try again.</span>`;
        locked=false;
      }
    }

    async function finish(){
      const timeSec=Math.max(1,Math.round((performance.now()-startedAt)/1000));
      const totalAttempts=roundDetails.reduce((sum,x)=>sum+Number(x?.attempts||0),0);
      if(!dailyMode) recordLocalHistory(roundDetails);
      healthTracker?.complete(roundDetails.map((r,i)=>({contentId:r.puzzleId,position:i+1,attempts:r.attempts,isCorrect:true,score:r.score})));
      let result=await BrainiData.api.submitGameResult("connections",{
        score:totalScore,
        correct:ROUND_COUNT,
        total:ROUND_COUNT,
        accuracy:100,
        timeSec,
        attempts:totalAttempts,
        roundDetails,
        contentSource:source,
        dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,
        archiveDailyNumber:archiveMode?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null,
        practice:archiveMode,
        challengeDate:dailyDate||null
      });
      if(!dailyMode) await recordCloudHistory(roundDetails);
      await verifyCloudResult(result,roundDetails);

      game.hidden=true;
      resultEl.hidden=false;
      resultEl.innerHTML=`
        <div class="connections-result-inner">
          <span class="simple-result-kicker">${dailyMode?`${archiveMode?"Past Daily · Practice":"Daily"} #${BrainiData.dailyNumberForDate?.(dailyDate)||""} · `:""}Connections · ${ROUND_COUNT} rounds complete ✓</span>
          <h2>${totalScore.toLocaleString()} <small>/ ${MAX_SCORE.toLocaleString()}</small></h2>
          <p>${totalAttempts} total attempt${totalAttempts===1?"":"s"}</p>
          <div class="connections-result-rounds">
            ${roundDetails.map((r,i)=>`<div><strong>Round ${i+1}</strong><span>${Number(r.score||0).toLocaleString()} pts · ${r.attempts} attempt${r.attempts===1?"":"s"}</span></div>`).join("")}
          </div>
          <div class="inline-quiz-result-actions">
            <a class="simple-result-play" href="${scoringDaily?"../../daily-quiz/":archiveMode?"../index.html":"./"}">${scoringDaily?"Continue Daily":archiveMode?"Choose another Past Daily game":"Play another Connections"}</a>
            <button class="simple-result-share" type="button" data-connections-share>Share result</button>
            <a class="simple-result-progress" href="../index.html">Choose another game</a>
          </div>
        </div>`;
      resultEl.querySelector("[data-connections-share]")?.addEventListener("click",()=>BrainiShare.open("connections",result));
    }

    next.addEventListener("click",()=>{
      if(roundIndex<ROUND_COUNT-1){ roundIndex++; renderRound(); }
      else finish();
    });

    start.addEventListener("click",async()=>{
      start.disabled=true;
      loading.hidden=false;
      intro.hidden=true;
      const loaded=await loadGame();
      source=loaded.source;
      rounds=loaded.rounds;
      loading.hidden=true;
      if(rounds.length!==ROUND_COUNT){
        intro.hidden=false;
        start.disabled=false;
        root.querySelector("[data-connections-load-error]").hidden=false;
        return;
      }
      game.hidden=false;
      healthTracker=window.BrainiContentHealth?BrainiContentHealth.create({gameId:"connections",contentType:"connections",contentIds:rounds.map(r=>r.id),dailyNumber:scoringDaily?(BrainiData.dailyNumberForDate?.(dailyDate)||null):null}):null;
      startedAt=performance.now();
      renderRound();
    });
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  }

  return {mount,loadGame,checkGuess};
})();
