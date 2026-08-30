/*
  BrainiLab Daily Hub
  -------------------
  Persistent 4-game Daily state for Home + Daily Quiz.

  If today's Brain Mix has already been completed, the quiz is not mounted
  again. The same box becomes a completed-state hub with links to the
  remaining Daily Games.
*/
window.BrainiDailyHub=(function(){
  const GAME_META={
    brainmix:{
      id:"brainmix",
      name:"Brain Mix",
      icon:"brainmix",
      href:"games/brain-mix/index.html"
    },
    brainiword:{
      id:"brainiword",
      name:"BrainiWord",
      icon:"brainiword",
      href:"games/brainiword/index.html"
    },
    orderup:{
      id:"orderup",
      name:"Order Up",
      icon:"orderup",
      href:"games/order-up/index.html"
    },
    topicrush:{
      id:"topicrush",
      name:"Topic Rush",
      icon:"topicrush",
      href:"games/topic-rush/index.html"
    },
    connections:{
      id:"connections",name:"Connections",icon:"connections",href:"games/connections/index.html"
    },
    oddoneout:{
      id:"oddoneout",name:"Odd One Out",icon:"odd-one-out",href:"games/odd-one-out/index.html"
    },
    higherlower:{
      id:"higherlower",name:"Higher or Lower",icon:"higher-lower",href:"games/higher-lower/index.html"
    },
    mathrush:{id:"mathrush",name:"Math Rush",icon:"math-rush",href:"games/math-rush/index.html"},
    numberroute:{id:"numberroute",name:"Number Route",icon:"number-route",href:"games/number-route/index.html"},
    sequence:{id:"sequence",name:"Sequence",icon:"sequence",href:"games/sequence/index.html"}
  };

  function dailyIds(dailyNumber=currentDailyNumber()){
    return BrainiData.dailyGameIdsForNumber?.(dailyNumber)||BrainiData.DAILY_GAME_IDS||["brainmix","orderup","topicrush","brainiword"];
  }

  function currentDailyNumber(){
    return Number(BrainiData.daily()?.number||0);
  }

  function localResult(gameId,dailyNumber=currentDailyNumber()){
    return BrainiData.recentResults(gameId)
      .find(r=>Number(r.dailyNumber)===Number(dailyNumber))||null;
  }

  function cloudResultToLocal(row){
    if(!row) return null;
    const gr=Array.isArray(row.game_results)
      ? row.game_results[0]
      : row.game_results;

    if(!gr) return null;

    const payload=gr.result_payload||{};
    return Object.assign({},payload,{
      id:gr.id,
      gameId:row.game_id,
      playedAt:row.completed_at,
      dailyNumber:row.daily_number,
      score:gr.score,
      correct:gr.correct_answers,
      total:gr.total_questions,
      accuracy:gr.accuracy,
      percentile:gr.client_percentile,
      timeSec:gr.duration_ms!=null
        ? Math.round(Number(gr.duration_ms)/1000)
        : payload.timeSec
    });
  }

  async function cloudTodayRows(dailyNumber){
    if(
      !window.BrainiCloudGames ||
      !window.BrainiBackendAuth?.isConfigured?.()
    ){
      return [];
    }

    try{
      const session=await BrainiBackendAuth.getSession();
      if(!session?.user) return [];

      const rows=await BrainiCloudGames.getMyRecentResults(80);
      const ids=dailyIds(dailyNumber);
      return (rows||[]).filter(row=>
        ids.includes(row.game_id) &&
        Number(row.daily_number)===Number(dailyNumber)
      );
    }catch(err){
      console.warn("BrainiLab Daily Hub cloud status:",err.message||err);
      return [];
    }
  }

  async function resolve(dailyNumber=currentDailyNumber(),options={}){
    const daily=BrainiData.daily();
    const games={};

    function build(cloudRows=[]){
      const ids=dailyIds(dailyNumber);
      ids.forEach(gameId=>{
        let result=localResult(gameId,dailyNumber);

        if(!result && cloudRows.length){
          const cloudRow=cloudRows.find(row=>row.game_id===gameId);
          result=cloudResultToLocal(cloudRow);
        }

        const completedFromState=
          Number(daily.number)===Number(dailyNumber) &&
          Array.isArray(daily.completedGames) &&
          daily.completedGames.includes(gameId);

        const breakdown=daily.dailyBreakdown?.[gameId]||{
          points:0,
          max:2500,
          label:"Not played yet"
        };

        games[gameId]={
          id:gameId,
          completed:!!result||completedFromState,
          result,
          points:Number(breakdown.points||0),
          max:Number(breakdown.max||2500),
          label:breakdown.label||""
        };
      });
    }

    // Fast path for normal same-browser navigation: do not delay the UI
    // with another network request when local/cloud-synced state already
    // knows that Brain Mix was completed.
    build();

    if(options.forceCloud || !games.brainmix.completed){
      const cloudRows=await cloudTodayRows(dailyNumber);
      if(cloudRows.length){
        Object.keys(games).forEach(k=>delete games[k]);
        build(cloudRows);
      }
    }

    return {
      dailyNumber:Number(dailyNumber),
      brainScore:Number(daily.brainScore||0),
      completedCount:Object.values(games).filter(g=>g.completed).length,
      dailyIds:dailyIds(dailyNumber),
      games
    };
  }

  function path(prefix,href){
    return (prefix||"")+href;
  }

  function miniCardsMarkup(status,prefix="",exclude="brainmix"){
    return (status.dailyIds||dailyIds(status.dailyNumber))
      .filter(id=>id!==exclude)
      .map(id=>{
        const meta=GAME_META[id];
        const game=status.games[id];
        const completed=!!game?.completed;

        const body=`
            <div class="daily-next-icon">${window.BrainiIcons?.game?BrainiIcons.game(meta.icon,"mini","braini-game-mini"):meta.icon}</div>
            <div class="daily-next-copy">
              <strong>${meta.name}</strong>
              <span>${completed?`Completed · ${(game.points||0).toLocaleString()} / 2,500`:"Play today’s challenge →"}</span>
            </div>
            <div class="daily-next-status">${completed?"✓":"→"}</div>`;
        if(completed) return `<div class="daily-next-card is-complete" aria-label="${meta.name} completed today">${body}</div>`;
        return `<a class="daily-next-card" href="${path(prefix,meta.href)}${["connections","oddoneout","higherlower","mathrush","numberroute","sequence"].includes(id)?`?daily=${encodeURIComponent(BrainiData.dateForDailyNumber?.(status.dailyNumber)||BrainiData.todayKey())}`:""}">${body}</a>`;
      }).join("");
  }

  function completedMarkup(status,options={}){
    const prefix=options.prefix||"";
    const result=options.result||status.games.brainmix?.result||null;
    const hasQuizNumbers=
      result &&
      Number.isFinite(Number(result.correct)) &&
      Number.isFinite(Number(result.total));

    const headline=hasQuizNumbers
      ? `${Number(result.correct)} / ${Number(result.total)}`
      : "Daily complete";

    const accuracy=result?.accuracy!=null
      ? ` · ${Math.round(Number(result.accuracy))}% accuracy`
      : "";

    const points=result?.score!=null
      ? `${Number(result.score).toLocaleString()} quiz points${accuracy}`
      : "Your result is saved for today.";

    return `
      <div class="daily-completed-state simple-daily-result">
        <div class="daily-completed-kicker simple-result-kicker-row">
          <span>Daily #${status.dailyNumber}</span>
          <strong>Completed ✓</strong>
        </div>

        <h1>${headline}</h1>
        <p class="daily-completed-lead">${points}</p>

        <div class="simple-result-actions">
          <a class="simple-result-play" href="${path(
            prefix,
            status.completedCount===4
              ? "games/index.html"
              : "daily-quiz/index.html"
          )}">
            ${status.completedCount===4
              ? "Play an anytime quiz"
              : "Continue Daily"
            }
          </a>
          ${result
            ? '<button class="simple-result-share" type="button" data-daily-share-result>Share result</button>'
            : ''
          }
          <a class="simple-result-progress" href="${path(prefix,"profile/index.html?section=progress")}">
            See my progress
          </a>
        </div>
        <div data-daily-result-journey></div>
      </div>`;
  }

  function bindCompleted(container,status,options={}){
    if(!container) return;
    const result=options.result||status.games.brainmix?.result||null;
    const share=container.querySelector("[data-daily-share-result]");

    if(share && result && window.BrainiShare){
      share.addEventListener("click",()=>{
        BrainiShare.open("brainmix",result);
      });
    }
  }

  async function renderBrainMixCompleted(container,options={}){
    const status=options.status||await resolve(options.dailyNumber);
    const result=options.result||status.games.brainmix?.result||null;

    container.innerHTML=completedMarkup(status,{
      prefix:options.prefix||"",
      result
    });

    bindCompleted(container,status,{result});

    if(window.BrainiDailyJourney){
      await BrainiDailyJourney.render(
        container.querySelector("[data-daily-result-journey]"),
        {
          status,
          currentGame:"brainmix"
        }
      );
    }

    return status;
  }

  return {
    GAME_META,
    DAILY_IDS:dailyIds(currentDailyNumber()),
    dailyIds,
    resolve,
    localResult,
    completedMarkup,
    bindCompleted,
    renderBrainMixCompleted,
    miniCardsMarkup
  };
})();
