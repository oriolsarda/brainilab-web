/*
  BrainiLab Order Up — V35

  Two rounds, 10 items each.
  Player taps the first item in the requested order, then the next one.
  Every tap immediately locks the next position.
  The 10th tap automatically submits the round.

  Scoring remains pairwise order accuracy:
  45 ordered pairs per round, 1,250 points max per round.
*/
window.BrainiOrderUp=(function(){
  const TRY_FIRST_MODE=new URLSearchParams(location.search).get("try")==="1";
  function stateKey(date){
    return `brainilab-orderup-v35-${date}`;
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

  function esc(value){
    return String(value??"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function localHref(relativePath){
    const url=new URL(relativePath,location.href);

    if(
      url.protocol==="file:" &&
      url.pathname.endsWith("/")
    ){
      url.pathname+="index.html";
    }

    return url.href;
  }

  function instructionFor(direction){
    const d=String(direction||"").toLowerCase();

    if(d.includes("earliest")) return "Tap the earliest first";
    if(d.includes("oldest")) return "Tap the oldest first";
    if(d.includes("newest")) return "Tap the newest first";
    if(d.includes("youngest")) return "Tap the youngest first";
    if(d.includes("highest")) return "Tap the highest first";
    if(d.includes("lowest")) return "Tap the lowest first";
    if(d.includes("largest")) return "Tap the largest first";
    if(d.includes("smallest")) return "Tap the smallest first";
    if(d.includes("north")) return "Tap the northernmost first";
    if(d.includes("south")) return "Tap the southernmost first";
    if(d.includes("west")) return "Tap the westernmost first";
    if(d.includes("east")) return "Tap the easternmost first";

    return "Tap the first item in the direction shown";
  }

  async function mount(root){
    const loading=root.querySelector("[data-ou-loading]");
    const intro=root.querySelector("[data-ou-intro]");
    const game=root.querySelector("[data-ou-game]");
    const resultBox=root.querySelector("[data-ou-result]");
    const dailyLabel=root.querySelector("[data-ou-daily]");
    const startBtn=root.querySelector("[data-ou-start]");
    const roundCount=root.querySelector("[data-ou-round-count]");
    const roundTitle=root.querySelector("[data-ou-title]");
    const roundPrompt=root.querySelector("[data-ou-prompt]");
    const direction=root.querySelector("[data-ou-direction]");
    const firstHint=root.querySelector("[data-ou-first-hint]");
    const choices=root.querySelector("[data-ou-choices]");
    const lockedList=root.querySelector("[data-ou-locked]");
    const feedback=root.querySelector("[data-ou-feedback]");
    const nextBtn=root.querySelector("[data-ou-next]");
    const progress=root.querySelector("[data-ou-progress]");
    const runningScore=root.querySelector("[data-ou-score]");
    const pickCount=root.querySelector("[data-ou-pick-count]");

    let content=null;
    let roundIndex=0;
    let selectedIds=[];
    let roundResults=[];
    let checking=false;
    let healthTracker=null;

    const archiveDate=BrainiData.pastDailyDate?.(new URLSearchParams(location.search).get("archive"));
    const archiveMode=!!archiveDate;
    if(archiveMode){
      const back=root.querySelector(".daily-mechanic-back");
      if(back){
        back.href=localHref("../../games/index.html");
        back.textContent="Games →";
      }
      const label=root.querySelector(".order-up-label");
      if(label) label.textContent="Play anytime";
      const preparing=root.querySelector("[data-ou-loading] strong");
      if(preparing) preparing.textContent="Preparing Order Up…";
    }
    const currentDaily=BrainiData.daily();

    const existingLocal=archiveMode?null:BrainiData
      .recentResults("orderup")
      .find(
        r=>Number(r.dailyNumber)===
          Number(currentDaily.number)
      );

    if(dailyLabel){
      dailyLabel.textContent=archiveMode
        ? "Play anytime"
        : `Daily #${currentDaily.number}`;
    }

    async function load(){
      if(content) return content;

      content=
        await BrainiDailyGames.loadOrderUp(archiveMode?{date:archiveDate}:{});


      if(dailyLabel){
        dailyLabel.textContent=archiveMode
          ? "Play anytime"
          : `Daily #${content.dailyNumber}`;
      }

      return content;
    }

    async function showExisting(){
      try{
        await load();
        await showResult(existingLocal);
      }catch(err){
        loading.hidden=false;
        loading.innerHTML=`
          <strong>Today’s Order Up could not load.</strong>
          <span>Please refresh and try again.</span>`;
      }
    }

    if(existingLocal){
      intro.hidden=true;
      loading.hidden=false;
      loading.innerHTML=
        "<strong>Loading today’s result…</strong>";
      showExisting();
      return;
    }

    const localKey=stateKey(
      archiveMode?archiveDate:new Date().toISOString().slice(0,10)
    );
    const saved=read(localKey);

    function round(){
      return content.rounds[roundIndex];
    }

    function labelFor(id){
      return round().items.find(
        item=>item.itemId===id
      )?.label||"";
    }

    function save(){
      if(!content) return;

      write(localKey,{
        dailyNumber:content.dailyNumber,
        roundIndex,
        roundResults,
        selectedIds,
        finished:false
      });
    }

    function availableItems(){
      const chosen=new Set(selectedIds);

      return round().items.filter(
        item=>!chosen.has(item.itemId)
      );
    }

    function renderLocked(){
      lockedList.innerHTML=
        Array.from({length:10},(_,index)=>{
          const id=selectedIds[index];
          const label=id?labelFor(id):"";

          return `
            <div class="order-up-locked-slot ${id?"is-filled":""}">
              <span>${index+1}</span>
              <strong>${id?esc(label):"—"}</strong>
            </div>`;
        }).join("");

      if(pickCount){
        pickCount.textContent=
          `${selectedIds.length}/10 locked`;
      }
    }

    function renderChoices(){
      choices.innerHTML=
        availableItems()
          .map(item=>`
            <button
              type="button"
              class="order-up-choice"
              data-order-choice="${esc(item.itemId)}"
              ${checking?"disabled":""}
            >
              ${esc(item.label)}
            </button>
          `)
          .join("");

      choices
        .querySelectorAll("[data-order-choice]")
        .forEach(button=>{
          button.onclick=async()=>{
            if(checking) return;

            const id=button.dataset.orderChoice;

            if(
              !id ||
              selectedIds.includes(id)
            ){
              return;
            }

            selectedIds.push(id);

            renderLocked();
            renderChoices();
            save();

            if(selectedIds.length===10){
              await submitRound();
            }
          };
        });
    }

    function renderRound(){
      healthTracker?.checkpoint(roundIndex+1);
      checking=false;

      const r=round();

      roundCount.textContent=
        `Round ${roundIndex+1} of 2`;

      roundTitle.textContent=r.title;
      roundPrompt.textContent=r.prompt;
      direction.textContent=r.directionLabel;

      if(firstHint){
        firstHint.textContent=
          instructionFor(r.directionLabel);
      }

      progress.style.width=
        `${roundIndex/2*100}%`;

      const previousScore=
        roundResults.reduce(
          (sum,x)=>sum+Number(x.score||0),
          0
        );

      runningScore.textContent=
        `${previousScore.toLocaleString()} / 2,500`;

      feedback.innerHTML=`
        <span>
          Tap the next item in the order shown above.
          Each choice locks immediately.
        </span>`;

      nextBtn.hidden=true;
      nextBtn.disabled=false;
      nextBtn.dataset.action="";

      renderLocked();
      renderChoices();
      save();
    }

    async function submitRound(){
      if(
        checking ||
        selectedIds.length!==10
      ){
        return;
      }

      checking=true;
      renderChoices();

      feedback.innerHTML=`
        <span class="daily-game-checking">
          Checking your order…
        </span>`;

      try{
        const evaluation=
          await BrainiDailyGames
            .checkOrderUpRound(
              content,
              round(),
              selectedIds
            );

        roundResults[roundIndex]={
          roundId:round().roundId,
          itemIds:selectedIds.slice(),
          score:Number(evaluation.score||0),
          exactPositions:Number(
            evaluation.exactPositions||0
          ),
          correctPairs:Number(
            evaluation.correctPairs||0
          ),
          totalPairs:Number(
            evaluation.totalPairs||45
          ),
          accuracy:Number(
            evaluation.accuracy||0
          )
        };

        const totalScore=
          roundResults.reduce(
            (sum,x)=>sum+Number(x.score||0),
            0
          );

        runningScore.textContent=
          `${totalScore.toLocaleString()} / 2,500`;

        const correct=
          (evaluation.correctOrder||[])
            .map((item,index)=>`
              <span class="order-up-correct-chip">
                <b>${index+1}</b>
                ${esc(item.label)}
              </span>
            `)
            .join("");

        feedback.innerHTML=`
          <div class="order-up-round-result">
            <div>
              <strong>
                ${Number(evaluation.score||0).toLocaleString()}
                / 1,250
              </strong>

              <span>
                ${Number(evaluation.correctPairs||0)}
                / 45 pairs correct
                ·
                ${Number(evaluation.exactPositions||0)}
                exact positions
              </span>
            </div>

            <div class="order-up-correct-order">
              <small>Correct order</small>
              <div>${correct}</div>
            </div>
          </div>`;

        save();

        nextBtn.hidden=false;
        nextBtn.textContent=
          roundIndex===0
            ? "Next round"
            : "See result";

        nextBtn.dataset.action=
          roundIndex===0
            ? "next"
            : "finish";
      }catch(err){
        checking=false;

        feedback.innerHTML=`
          <span class="daily-game-error">
            Could not check this round.
            Refresh and try again.
          </span>`;

        renderChoices();
      }
    }

    async function finish(){
      const totalScore=
        roundResults.reduce(
          (sum,x)=>sum+Number(x.score||0),
          0
        );

      const exact=
        roundResults.reduce(
          (sum,x)=>sum+
            Number(x.exactPositions||0),
          0
        );

      const pairs=
        roundResults.reduce(
          (sum,x)=>sum+
            Number(x.correctPairs||0),
          0
        );

      const accuracy=Math.round(
        pairs/90*100
      );

      healthTracker?.complete(roundResults.map((x,index)=>({
        contentId:x.roundId,
        position:index+1,
        attempts:1,
        isCorrect:Number(x.accuracy||0)>=70,
        skipped:false,
        score:Number(x.score||0)
      })));

      let result=
        await BrainiData.api.submitGameResult(
          "orderup",
          {
            score:totalScore,
            correct:exact,
            total:20,
            accuracy,
            orderPairsCorrect:pairs,
            orderPairsTotal:90,
            orderUpRounds:
              roundResults.map(x=>({
                round_id:x.roundId,
                item_ids:x.itemIds
              })),
            dailyChallengeId:
              content.dailyChallengeId,
            dailyNumber:
              archiveMode?null:content.dailyNumber,
            archiveDailyNumber:
              archiveMode?content.dailyNumber:null,
            practice:archiveMode,
            challengeDate:
              content.challengeDate,
            dailyContentSource:
              content.source
          }
        );

      if(content.source==="supabase" && !archiveMode){
        try{
          await BrainiDailyGames
            .verifyResult(
              result,
              content
            );

          result=
            BrainiData
              .recentResults("orderup")
              .find(
                r=>r.clientResultId===
                  result.clientResultId
              )||result;
        }catch(err){
          console.warn(
            "Order Up verification pending:",
            err.message||err
          );
        }
      }

      write(localKey,{
        dailyNumber:content.dailyNumber,
        finished:true,
        resultId:result.id
      });

      await showResult(result);
    }

    async function showResult(result){
      intro.hidden=true;
      game.hidden=true;
      loading.hidden=true;
      resultBox.hidden=false;

      const score=Number(result.score||0);
      const accuracy=Number(result.accuracy||0);

      resultBox.innerHTML=`
        <div class="simple-game-result">
          <div class="simple-result-kicker">
            ${archiveMode?"Order Up · Complete ✓":`Daily #${content.dailyNumber} · Order Up · Complete ✓`}
          </div>

          <h2>
            ${score.toLocaleString()}
            / 2,500
          </h2>

          <p>
            ${Math.round(accuracy)}%
            order accuracy
            · 2 rounds complete
          </p>

          ${archiveMode?`
            
            <div class="simple-result-actions archive-result-actions">
              <a class="simple-result-play" href="${localHref("../../games/index.html#order-up")}">Play another Order Up</a>
              <a class="simple-result-share archive-result-other" href="${localHref("../../games/index.html")}">Choose another game</a>
            </div>
          `:`
            <div class="simple-result-actions">
              <a class="simple-result-play" href="${localHref("../../daily-quiz/index.html")}">Continue Daily</a>
              <button class="simple-result-share" type="button" data-ou-share>Share result</button>
              <a class="simple-result-progress" href="${localHref("../../profile/index.html?section=progress")}">See my progress</a>
            </div>
            <div data-ou-daily-journey></div>
          `}
        </div>`;

      resultBox
        .querySelector("[data-ou-share]")
        ?.addEventListener(
          "click",
          ()=>BrainiShare.open(
            "orderup",
            result
          )
        );

      if(!archiveMode && window.BrainiDailyJourney){
        const status=
          await BrainiDailyHub.resolve(
            content.dailyNumber
          );

        const primary=
          resultBox.querySelector(
            ".simple-result-play"
          );

        if(
          primary &&
          status.completedCount===4
        ){
          primary.href=
            localHref("../../games/index.html");
          primary.textContent=
            "Play an anytime quiz";
        }

        await BrainiDailyJourney.render(
          resultBox.querySelector(
            "[data-ou-daily-journey]"
          ),
          {
            status,
            currentGame:"orderup"
          }
        );
      }
    }

    async function start(){
      startBtn.disabled=true;
      startBtn.textContent=archiveMode
        ? "Loading Order Up…"
        : "Loading today’s rounds…";

      try{
        await load();
        if(window.BrainiContentHealth && content?.rounds?.length && !healthTracker){
          healthTracker=BrainiContentHealth.create({gameId:"orderup",contentType:"orderup",contentIds:content.rounds.map(r=>r.roundId).filter(Boolean),dailyNumber:archiveMode?null:content.dailyNumber});
        }

        if(
          saved &&
          Number(saved.dailyNumber)===
            Number(content.dailyNumber) &&
          !saved.finished &&
          Array.isArray(
            saved.roundResults
          )
        ){
          roundIndex=Math.min(
            Number(saved.roundIndex||0),
            content.rounds.length-1
          );

          roundResults=
            saved.roundResults;

          selectedIds=
            Array.isArray(saved.selectedIds)
              ? saved.selectedIds.filter(
                  id=>
                    content.rounds[roundIndex]
                      .items.some(
                        item=>item.itemId===id
                      )
                )
              : [];
        }else{
          roundIndex=0;
          roundResults=[];
          selectedIds=[];
        }

        intro.hidden=true;
        loading.hidden=true;
        game.hidden=false;

        renderRound();

        if(
          selectedIds.length===10 &&
          !roundResults[roundIndex]
        ){
          await submitRound();
        }
      }catch(err){
        startBtn.disabled=false;
        startBtn.textContent=
          "Start Order Up";

        if(typeof showToast==="function"){
          showToast(
            err.message||
            "Order Up could not start"
          );
        }
      }
    }

    nextBtn.onclick=async()=>{
      if(
        nextBtn.dataset.action==="next"
      ){
        roundIndex=1;
        selectedIds=[];
        renderRound();
        return;
      }

      if(
        nextBtn.dataset.action==="finish"
      ){
        nextBtn.disabled=true;
        await finish();
      }
    };

    startBtn.onclick=start;
  }

  return {mount};
})();
