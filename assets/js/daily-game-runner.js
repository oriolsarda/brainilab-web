/*
  BrainiLab finite Daily multiple-choice runner
  Used by Flag Dash. Legacy Map Hunt adapter remains backend-only.
*/
window.BrainiDailyMCRunner=(function(){
  function safeStateKey(gameId,date){
    return `brainilab-${gameId}-${date}`;
  }

  function readState(key){
    try{return JSON.parse(localStorage.getItem(key)||"null");}catch(e){return null;}
  }

  function writeState(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}
  }

  function formatTime(seconds){
    const s=Math.max(0,Math.round(seconds||0));
    return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }

  async function mount(root,config){
    const loading=root.querySelector("[data-dg-loading]");
    const game=root.querySelector("[data-dg-game]");
    const question=root.querySelector("[data-dg-question]");
    const visual=root.querySelector("[data-dg-visual]");
    const choices=root.querySelector("[data-dg-choices]");
    const feedback=root.querySelector("[data-dg-feedback]");
    const next=root.querySelector("[data-dg-next]");
    const count=root.querySelector("[data-dg-count]");
    const scoreEl=root.querySelector("[data-dg-score]");
    const comboEl=root.querySelector("[data-dg-combo]");
    const progress=root.querySelector("[data-dg-progress]");
    const resultBox=root.querySelector("[data-dg-result]");
    const dailyLabel=root.querySelector("[data-dg-daily]");
    const timerEl=root.querySelector("[data-dg-timer]");

    let content;
    let timer=null;
    try{
      content=await config.load();
    }catch(err){
      loading.innerHTML=`<strong>Today’s ${config.name} could not load.</strong><span>Please refresh and try again.</span>`;
      console.error(config.name,err);
      return;
    }

    if(!content?.items?.length){
      loading.innerHTML=`<strong>Today’s ${config.name} is unavailable.</strong>`;
      return;
    }

    if(dailyLabel) dailyLabel.textContent=`Daily #${content.dailyNumber}`;
    loading.hidden=true;

    const existing=BrainiData.recentResults(config.gameId).find(
      r=>Number(r.dailyNumber)===Number(content.dailyNumber)
    );

    if(existing){
      await showResult(existing);
      return;
    }

    game.hidden=false;

    const key=safeStateKey(config.gameId,content.challengeDate||new Date().toISOString().slice(0,10));
    const saved=readState(key);

    let index=0;
    let correct=0;
    let combo=0;
    let bestCombo=0;
    let answers=[];
    let locked=false;
    let ready=false;
    let startedAt=Date.now();

    if(
      saved &&
      Number(saved.dailyNumber)===Number(content.dailyNumber) &&
      !saved.finished
    ){
      index=Math.min(Number(saved.index||0),content.items.length-1);
      correct=Number(saved.correct||0);
      combo=Number(saved.combo||0);
      bestCombo=Number(saved.bestCombo||0);
      answers=Array.isArray(saved.answers)?saved.answers:[];
      startedAt=Number(saved.startedAt||Date.now());
    }

    timer=setInterval(()=>{
      if(timerEl) timerEl.textContent=formatTime((Date.now()-startedAt)/1000);
    },500);

    function save(){
      writeState(key,{
        dailyNumber:content.dailyNumber,
        index,correct,combo,bestCombo,answers,
        startedAt,
        finished:false
      });
    }

    function render(){
      locked=false;
      ready=false;
      if(document.activeElement instanceof HTMLElement) document.activeElement.blur();

      const item=content.items[index];
      count.textContent=`${index+1} / ${content.items.length}`;
      scoreEl.textContent=config.liveScore({correct,bestCombo,index}).toLocaleString()+" pts";
      if(comboEl) comboEl.textContent=`Combo ${combo}`;
      progress.style.width=`${((index+1)/content.items.length)*100}%`;

      question.textContent=config.questionText(item);
      visual.innerHTML=config.visualMarkup(item);
      feedback.innerHTML="";
      next.hidden=true;
      choices.innerHTML="";

      item.options.forEach((option,i)=>{
        const b=document.createElement("button");
        b.type="button";
        b.className="daily-game-choice";
        b.innerHTML=`<span class="key">${i+1}</span><span>${option.text}</span>`;
        b.addEventListener("click",async e=>{
          e.currentTarget.blur();
          if(locked) return;
          locked=true;

          [...choices.children].forEach(x=>x.disabled=true);
          feedback.innerHTML=`<span class="daily-game-checking">Checking…</span>`;

          let evaluation;
          try{
            evaluation=await config.check(item,option.id);
          }catch(err){
            locked=false;
            [...choices.children].forEach(x=>x.disabled=false);
            feedback.innerHTML=`<span class="daily-game-error">Could not check that answer. Try again.</span>`;
            return;
          }

          const isCorrect=!!evaluation.isCorrect;
          if(isCorrect){
            correct++;
            combo++;
            bestCombo=Math.max(bestCombo,combo);
          }else{
            combo=0;
          }

          [...choices.children].forEach(btn=>{
            const optId=btn.dataset.optionId;
            if(optId===evaluation.correctCountryId) btn.classList.add("correct");
          });

          // dataset after creation loop below is already present.
          b.classList.add(isCorrect?"correct":"wrong");

          feedback.innerHTML=isCorrect
            ? `✓ <strong>${evaluation.correctAnswer}</strong>`
            : `✕ <strong>${option.text}</strong><small>Correct answer: ${evaluation.correctAnswer}</small>`;

          answers.push(config.answerRecord(item,option.id));
          scoreEl.textContent=config.liveScore({correct,bestCombo,index}).toLocaleString()+" pts";
          if(comboEl) comboEl.textContent=`Combo ${combo}`;

          ready=true;
          next.hidden=false;
        });
        b.dataset.optionId=option.id;
        choices.appendChild(b);
      });

      save();
    }

    async function advance(){
      if(!ready) return;
      ready=false;

      if(index<content.items.length-1){
        index++;
        save();
        render();
      }else{
        await finish();
      }
    }

    async function finish(){
      if(timer) clearInterval(timer);
      const timeSec=Math.max(1,Math.round((Date.now()-startedAt)/1000));
      const payload=config.finalPayload({
        content,correct,bestCombo,answers,timeSec
      });

      let result=await BrainiData.api.submitGameResult(config.gameId,payload);

      if(content.source==="supabase"){
        try{
          await BrainiDailyGames.verifyResult(result,content);
          result=BrainiData.recentResults(config.gameId).find(
            r=>r.clientResultId===result.clientResultId
          )||result;
        }catch(err){
          console.warn(`${config.name} verification pending:`,err.message||err);
        }
      }

      writeState(key,{
        dailyNumber:content.dailyNumber,
        finished:true,
        resultId:result.id
      });

      await showResult(result);
    }

    async function showResult(result){
      if(timer) clearInterval(timer);
      game.hidden=true;
      loading.hidden=true;
      resultBox.hidden=false;

      const accuracy=result.accuracy!=null
        ? Math.round(Number(result.accuracy))
        : result.total
          ? Math.round(Number(result.correct||0)/Number(result.total)*100)
          : 0;

      const correctText=Number.isFinite(Number(result.correct))
        ? `${Number(result.correct)} / ${Number(result.total??content.total)}`
        : "Complete";

      const points=Number(
        result.score
        || config.liveScore({
          correct:result.correct||0,
          bestCombo:result.bestCombo||0
        })
        || 0
      );

      resultBox.innerHTML=`
        <div class="simple-game-result">
          <div class="simple-result-kicker">Daily #${content.dailyNumber} · ${config.name}</div>
          <h2>${correctText}</h2>
          <p>${points.toLocaleString()} points${accuracy?` · ${accuracy}% accuracy`:""}</p>
          <div class="simple-result-actions">
            <a class="simple-result-play" href="/daily-quiz/">Continue Daily</a>
            <button class="simple-result-share" type="button" data-dg-share-result>Share result</button>
            <a class="simple-result-progress" href="/profile/?section=progress">See my progress</a>
          </div>
          <div data-dg-daily-journey></div>
        </div>`;

      resultBox.querySelector("[data-dg-share-result]")?.addEventListener(
        "click",
        ()=>BrainiShare.open(config.gameId,result)
      );

      if(window.BrainiDailyJourney){
        const status=await BrainiDailyHub.resolve(content.dailyNumber);
        const primary=resultBox.querySelector(".simple-result-play");

        if(primary && status.completedCount===4){
          primary.href="/games/";
          primary.textContent="Play an anytime quiz";
        }

        await BrainiDailyJourney.render(
          resultBox.querySelector("[data-dg-daily-journey]"),
          {
            status,
            currentGame:config.gameId
          }
        );
      }
    }

    next.addEventListener("click",advance);

    document.addEventListener("keydown",e=>{
      if(["1","2","3","4"].includes(e.key) && !locked){
        e.preventDefault();
        const b=choices.children[Number(e.key)-1];
        if(b) b.click();
        return;
      }
      if(e.key==="Enter"){
        e.preventDefault();
        if(ready) advance();
      }
    });

    render();
  }

  return {mount};
})();
