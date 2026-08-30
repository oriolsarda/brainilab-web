/*
  BrainiLab Topic Rush — V27
  The topic is not revealed until the player deliberately starts the timer.
*/
window.BrainiTopicRush=(function(){
  const TRY_FIRST_MODE=new URLSearchParams(location.search).get("try")==="1";
  function stateKey(date){
    return `brainilab-topicrush-${date}`;
  }

  function read(key){
    if(TRY_FIRST_MODE) return null;
    try{return JSON.parse(localStorage.getItem(key)||"null");}
    catch(e){return null;}
  }

  function write(key,value){
    if(TRY_FIRST_MODE) return;
    try{localStorage.setItem(key,JSON.stringify(value));}
    catch(e){}
  }

  function format(seconds){
    const s=Math.max(0,Math.ceil(seconds));
    return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }

  function escapeHtml(value){
    return String(value??"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function localHref(relativePath){
    const url=new URL(relativePath,location.href);
    if(url.protocol==="file:" && url.pathname.endsWith("/")){
      url.pathname+="index.html";
    }
    return url.href;
  }

  async function mount(root){
    const loading=root.querySelector("[data-tr-loading]");
    const intro=root.querySelector("[data-tr-intro]");
    const play=root.querySelector("[data-tr-play]");
    const resultBox=root.querySelector("[data-tr-result]");
    const dailyLabel=root.querySelector("[data-tr-daily]");
    const activeTopic=root.querySelector("[data-tr-active-topic]");
    const activePrompt=root.querySelector("[data-tr-active-prompt]");
    const startBtn=root.querySelector("[data-tr-start]");
    const form=root.querySelector("[data-tr-form]");
    const input=root.querySelector("[data-tr-input]");
    const timerEl=root.querySelector("[data-tr-timer]");
    const countEl=root.querySelector("[data-tr-count]");
    const feedback=root.querySelector("[data-tr-feedback]");
    const answersEl=root.querySelector("[data-tr-answers]");

    let content=null;
    let contentPromise=null;
    let timer=null;
    let finishing=false;
    let finishRequested=false;
    let pendingChecks=0;
    const pendingGuesses=new Set();

    const archiveDate=BrainiData.pastDailyDate?.(new URLSearchParams(location.search).get("archive"));
    const archiveMode=!!archiveDate;
    if(archiveMode){
      const back=root.querySelector(".daily-mechanic-back");
      if(back){
        back.href=localHref("../../games/index.html");
        back.textContent="Games →";
      }
      const introCopy=root.querySelector("[data-tr-intro] p");
      if(introCopy) introCopy.textContent="The topic appears only after you start. The timer begins at the same moment.";
    }
    const localDaily=BrainiData.daily();
    const currentDailyNumber=Number(
      archiveMode
        ? BrainiData.dailyNumberForDate(archiveDate)
        : localDaily?.number||0
    );
    const todayDate=new Date().toISOString().slice(0,10);
    const key=stateKey(archiveMode?archiveDate:todayDate);

    if(dailyLabel){
      dailyLabel.textContent=currentDailyNumber
        ? archiveMode?"Play anytime":`Daily #${currentDailyNumber}`
        : "Today’s Daily";
    }

    function genericIntro(){
      loading.hidden=true;
      intro.hidden=false;
      play.hidden=true;
      resultBox.hidden=true;
    }

    async function ensureContent(){
      if(content) return content;
      if(contentPromise) return contentPromise;

      contentPromise=BrainiDailyGames.loadTopicRush(archiveMode?{date:archiveDate}:{})
        .then(data=>{
          if(!data?.title){
            throw new Error("Today’s Topic Rush is unavailable.");
          }
          content=data;
          if(dailyLabel){
            dailyLabel.textContent=archiveMode?"Play anytime":`Daily #${content.dailyNumber}`;
          }
          return content;
        })
        .finally(()=>{contentPromise=null;});

      return contentPromise;
    }

    let startedAt=null;
    let accepted=[];
    let acceptedIds=new Set();
    let rawAnswers=[];
    let totalGuesses=0;
    let healthTracker=null;

    const saved=read(key);
    const existing=archiveMode?null:BrainiData.recentResults("topicrush").find(
      r=>Number(r.dailyNumber)===currentDailyNumber
    );

    if(existing){
      loading.hidden=false;
      intro.hidden=true;
      loading.innerHTML="<strong>Loading today’s result…</strong>";
      try{
        await ensureContent();
        await showResult(existing);
      }catch(err){
        loading.innerHTML="<strong>Today’s Topic Rush could not load.</strong><span>Refresh and try again.</span>";
      }
      return;
    }

    if(
      saved &&
      Number(saved.dailyNumber)===currentDailyNumber &&
      !saved.finished &&
      Number(saved.startedAt)>0
    ){
      loading.hidden=false;
      intro.hidden=true;
      loading.innerHTML="<strong>Resuming your Topic Rush…</strong>";

      try{
        await ensureContent();

        startedAt=Number(saved.startedAt);
        accepted=Array.isArray(saved.accepted)?saved.accepted:[];
        rawAnswers=Array.isArray(saved.rawAnswers)?saved.rawAnswers:[];
        totalGuesses=Number(saved.totalGuesses||rawAnswers.length||0);
        if(window.BrainiContentHealth && content?.topicId){
          healthTracker=BrainiContentHealth.create({gameId:"topicrush",contentType:"topicrush",contentIds:[content.topicId],dailyNumber:archiveMode?null:content.dailyNumber});
          healthTracker?.checkpoint(1,true);
        }
        acceptedIds=new Set(
          Array.isArray(saved.acceptedIds)?saved.acceptedIds:[]
        );

        const remaining=Number(content.durationSeconds||60)-(Date.now()-startedAt)/1000;

        if(remaining>0){
          loading.hidden=true;
          revealPlay();
          renderAccepted();
          beginTimer();
          requestAnimationFrame(()=>input.focus());
        }else{
          loading.hidden=true;
          await finish();
        }
      }catch(err){
        loading.innerHTML="<strong>Topic Rush could not resume.</strong><span>Refresh and try again.</span>";
      }
      return;
    }

    genericIntro();

    function save(){
      write(key,{
        dailyNumber:content?.dailyNumber||currentDailyNumber,
        startedAt,
        accepted,
        acceptedIds:[...acceptedIds],
        rawAnswers,
        totalGuesses,
        finished:false
      });
    }

    function revealPlay(){
      intro.hidden=true;
      loading.hidden=true;
      play.hidden=false;

      activeTopic.textContent=content.title;
      if(activePrompt) activePrompt.textContent=content.prompt;

      const target=Math.max(1,Number(content.targetCount||15));
      setFeedback(`Full-score target: ${target}. Type an answer and press Enter.`,"neutral");
    }

    function renderAccepted(){
      countEl.textContent=String(acceptedIds.size);
      answersEl.innerHTML=accepted
        .map(x=>`<span class="topic-rush-chip">✓ ${escapeHtml(x)}</span>`)
        .join("");
    }

    function setFeedback(text,type=""){
      feedback.textContent=text;
      feedback.className=`topic-rush-feedback ${type}`.trim();
    }

    function remainingSeconds(){
      if(!startedAt || !content) return 60;
      return Number(content.durationSeconds||60)-(Date.now()-startedAt)/1000;
    }

    function beginTimer(){
      if(timer) clearInterval(timer);

      const tick=()=>{
        const remaining=remainingSeconds();
        timerEl.textContent=format(remaining);
        timerEl.classList.toggle("urgent",remaining<=10);

        if(remaining<=0){
          clearInterval(timer);
          timer=null;
          finish();
        }
      };

      tick();
      timer=setInterval(tick,200);
    }

    async function start(){
      if(startedAt) return;

      startBtn.disabled=true;
      startBtn.textContent="Revealing topic…";

      try{
        await ensureContent();

        // The timer starts only after the topic has arrived, so network latency
        // never consumes the player's 60 seconds.
        startedAt=Date.now();
        accepted=[];
        acceptedIds=new Set();
        rawAnswers=[];
        totalGuesses=0;
        if(window.BrainiContentHealth && content?.topicId){
          healthTracker=BrainiContentHealth.create({gameId:"topicrush",contentType:"topicrush",contentIds:[content.topicId],dailyNumber:archiveMode?null:content.dailyNumber});
          healthTracker?.checkpoint(1,true);
        }

        revealPlay();
        save();
        renderAccepted();
        beginTimer();
        requestAnimationFrame(()=>input.focus());
      }catch(err){
        startBtn.disabled=false;
        startBtn.textContent="Reveal topic & start";
        if(typeof showToast==="function"){
          showToast(err.message||"Topic Rush could not start");
        }
      }
    }

    async function submitGuess(event){
      event?.preventDefault();
      if(finishing || finishRequested || !startedAt || remainingSeconds()<=0) return;

      const guess=input.value.trim();
      if(!guess) return;

      totalGuesses++;
      const guessKey=guess.toLowerCase();
      if(pendingGuesses.has(guessKey)){
        input.value="";
        setFeedback("Already checking that.","neutral");
        return;
      }

      input.value="";
      pendingGuesses.add(guessKey);
      pendingChecks++;
      setFeedback(pendingChecks>1?`${pendingChecks} answers checking…`:"Checking…");
      input.focus();

      try{
        const checked=await BrainiDailyGames.checkTopicRushAnswer(content,guess);
        if(finishing) return;

        if(checked.valid){
          if(acceptedIds.has(checked.answerId)){
            setFeedback("Already got it.","neutral");
          }else{
            acceptedIds.add(checked.answerId);
            accepted.push(checked.canonicalAnswer||guess);
            rawAnswers.push(checked.canonicalAnswer||guess);
            renderAccepted();
            save();
            setFeedback(`✓ ${checked.canonicalAnswer||guess}`,"good");
          }
        }else{
          setFeedback("Not accepted for this topic.","bad");
        }
      }catch(err){
        if(!finishing){
          setFeedback("Couldn’t check that answer. Keep going.","bad");
        }
      }finally{
        pendingGuesses.delete(guessKey);
        pendingChecks=Math.max(0,pendingChecks-1);

        if((finishRequested || remainingSeconds()<=0) && pendingChecks===0){
          await finish();
        }
      }
    }

    async function finish(){
      if(finishing) return;

      if(pendingChecks>0){
        finishRequested=true;
        input.disabled=true;
        setFeedback(`Time! Finishing ${pendingChecks} ${pendingChecks===1?"answer":"answers"}…`);
        return;
      }

      finishing=true;
      finishRequested=false;

      if(timer) clearInterval(timer);
      timer=null;

      input.disabled=true;
      play.hidden=true;
      intro.hidden=true;

      const target=Math.max(1,Number(content.targetCount||15));
      const correct=acceptedIds.size;
      const score=Math.min(2500,Math.max(0,Math.round(correct/target*2500)));

      healthTracker?.complete([{contentId:content.topicId,position:1,attempts:Math.max(1,totalGuesses),isCorrect:correct>=target,skipped:false,score}]);

      let result=await BrainiData.api.submitGameResult("topicrush",{
        score,
        correct,
        total:target,
        accuracy:Math.min(100,Math.round(correct/target*100)),
        timeSec:Number(content.durationSeconds||60),
        topicTitle:content.title,
        topicId:content.topicId,
        targetCount:target,
        topicRushAnswers:rawAnswers,
        dailyChallengeId:content.dailyChallengeId,
        dailyNumber:archiveMode?null:content.dailyNumber,
        archiveDailyNumber:archiveMode?content.dailyNumber:null,
        practice:archiveMode,
        challengeDate:content.challengeDate,
        dailyContentSource:content.source
      });

      if(content.source==="supabase" && !archiveMode){
        try{
          await BrainiDailyGames.verifyResult(result,content);
          result=BrainiData.recentResults("topicrush").find(
            r=>r.clientResultId===result.clientResultId
          )||result;
        }catch(err){
          console.warn("Topic Rush verification pending:",err.message||err);
        }
      }

      write(key,{
        dailyNumber:content.dailyNumber,
        finished:true,
        resultId:result.id
      });

      await showResult(result);
    }

    async function showResult(result){
      if(timer) clearInterval(timer);

      loading.hidden=true;
      intro.hidden=true;
      play.hidden=true;
      resultBox.hidden=false;

      const correct=Number(result.correct||0);
      const target=Number(result.total||result.targetCount||content.targetCount||15);
      const points=Number(result.score||0);

      resultBox.innerHTML=`
        <div class="simple-game-result">
          <div class="simple-result-kicker">${archiveMode?"Topic Rush · Complete ✓":`Daily #${content.dailyNumber} · Topic Rush · Complete ✓`}</div>
          <h2>${correct} ${correct===1?"answer":"answers"}</h2>
          <p>${points.toLocaleString()} ${archiveMode?"":"Daily "}points · ${escapeHtml(content.title)}</p>

          ${archiveMode?`
            
            <div class="simple-result-actions archive-result-actions">
              <a class="simple-result-play" href="${localHref("../../games/index.html#topic-rush")}">Play another Topic Rush</a>
              <a class="simple-result-share archive-result-other" href="${localHref("../../games/index.html")}">Choose another game</a>
            </div>
          `:`
            <div class="simple-result-actions">
              <a class="simple-result-play" href="${localHref("../../daily-quiz/index.html")}">Continue Daily</a>
              <button class="simple-result-share" type="button" data-tr-share>Share result</button>
              <a class="simple-result-progress" href="${localHref("../../profile/index.html?section=progress")}">See my progress</a>
            </div>
            <div data-tr-daily-journey></div>
          `}
        </div>`;

      resultBox.querySelector("[data-tr-share]")?.addEventListener(
        "click",
        ()=>BrainiShare.open("topicrush",result)
      );

      if(!archiveMode && window.BrainiDailyJourney){
        const status=await BrainiDailyHub.resolve(content.dailyNumber);
        const primary=resultBox.querySelector(".simple-result-play");

        if(primary && status.completedCount===4){
          primary.href="/games/";
          primary.textContent="Play an anytime quiz";
        }

        await BrainiDailyJourney.render(
          resultBox.querySelector("[data-tr-daily-journey]"),
          {status,currentGame:"topicrush"}
        );
      }
    }

    startBtn.addEventListener("click",start);
    form.addEventListener("submit",submitGuess);
  }

  return {mount};
})();
