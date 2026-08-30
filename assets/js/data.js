
/*
  BrainiLab Data Layer — local-first player state
  --------------------------------------------------------
  Purpose:
  - Keep game UI independent from backend implementation.
  - Provide stable local-first contracts for player data, sessions,
    sharing and analytics.
  - Cloud-backed public data is supplied by Supabase adapters.
  - Never seed public-facing player or leaderboard statistics.
*/
window.BrainiData = (function(){
  const STORAGE_KEY = "brainilab.mock.v1"; // retained for backwards-compatible local progress

  const GAME_DEFS = {
    brainmix: {
      id:"brainmix", name:"Brain Mix", route:"/daily-quiz/", icon:"🧠",
      metric:"score", maxScore:10000, daily:true
    },
    flagdash: {
      id:"flagdash", name:"Flag Dash", route:"/geography/world-flags-quiz/", icon:"🚩",
      metric:"correct", maxScore:null, daily:false, legacy:true
    },
    orderup: {
      id:"orderup", name:"Order Up", route:"/games/order-up/", icon:"↕️",
      metric:"score", maxScore:2500, daily:true
    },
    maphunt: {
      id:"maphunt", name:"Map Hunt", route:"/games/topic-rush/", icon:"🗺️",
      metric:"score", maxScore:6000, daily:false, legacy:true
    },
    topicrush: {
      id:"topicrush", name:"Topic Rush", route:"/games/topic-rush/", icon:"⚡",
      metric:"score", maxScore:2500, daily:true
    },
    brainiword: {
      id:"brainiword", name:"BrainiWord", route:"/games/brainiword/", icon:"🔤",
      metric:"attempts", maxScore:5, daily:true
    },
    worldflags: {
      id:"worldflags", name:"World Flags Quiz", route:"/geography/world-flags-quiz/", icon:"🚩",
      metric:"score", maxScore:20, daily:false
    },
    worldcapitals: {
      id:"worldcapitals", name:"World Capitals Quiz", route:"/geography/world-capitals-quiz/", icon:"🌍",
      metric:"score", maxScore:20, daily:false
    },
    science: {
      id:"science", name:"Science Quiz", route:"/science/science-quiz/", icon:"🔬",
      metric:"score", maxScore:20, daily:false
    },
    history: {
      id:"history", name:"History Quiz", route:"/history/history-quiz/", icon:"📜",
      metric:"score", maxScore:20, daily:false
    },
    sports: {
      id:"sports", name:"Sports Quiz", route:"/sports/sports-quiz/", icon:"⚽",
      metric:"score", maxScore:20, daily:false
    },
    generalknowledge: {
      id:"generalknowledge", name:"General Knowledge Quiz", route:"/general-knowledge/general-knowledge-quiz/", icon:"🧠",
      metric:"score", maxScore:20, daily:false
    },
    connections: {
      id:"connections", name:"Connections", route:"/games/connections/", icon:"🔗",
      metric:"score", maxScore:3000, daily:false
    },
    survival: {
      id:"survival", name:"Survival", route:"/games/survival/", icon:"🛡️",
      metric:"score", maxScore:null, daily:false
    },
    oddoneout: {
      id:"oddoneout", name:"Odd One Out", route:"/games/odd-one-out/", icon:"◉",
      metric:"score", maxScore:1000, daily:false
    },
    higherlower: {
      id:"higherlower", name:"Higher or Lower", route:"/games/higher-lower/", icon:"↕️",
      metric:"score", maxScore:1700, daily:false
    },
    mathrush: {
      id:"mathrush", name:"Math Rush", route:"/games/math-rush/", icon:"⚡",
      metric:"score", maxScore:null, daily:false
    },
    numberroute: {
      id:"numberroute", name:"Number Route", route:"/games/number-route/", icon:"➗",
      metric:"score", maxScore:2500, daily:false
    },
    sequence: {
      id:"sequence", name:"Sequence", route:"/games/sequence/", icon:"🔢",
      metric:"score", maxScore:2500, daily:false
    }
  };

  const DAILY_NUMBER_BASE = 1;
  const DAILY_EPOCH = Date.UTC(2026,7,29); // official public Daily #1

  function todayKey(){
    return new Date().toISOString().slice(0,10);
  }

  function dailyNumberForDate(dateValue){
    const raw=String(dateValue||"").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const parts=raw.split("-").map(Number);
    const utc=Date.UTC(parts[0],parts[1]-1,parts[2]);
    const check=new Date(utc).toISOString().slice(0,10);
    if(check!==raw) return null;
    return DAILY_NUMBER_BASE + Math.floor((utc-DAILY_EPOCH)/86400000);
  }

  function dailyNumber(){
    return dailyNumberForDate(todayKey());
  }

  const DAILY_ROTATION_START="2026-08-31";
  const DAILY_VARIABLE_PAIRS=[
    ["orderup","sequence"],
    ["topicrush","numberroute"],
    ["connections","mathrush"],
    ["oddoneout","higherlower"],
    ["orderup","numberroute"],
    ["sequence","mathrush"],
    ["topicrush","higherlower"],
    ["connections","oddoneout"],
    ["orderup","mathrush"],
    ["numberroute","higherlower"],
    ["sequence","oddoneout"],
    ["topicrush","connections"],
    ["orderup","higherlower"],
    ["mathrush","oddoneout"],
    ["numberroute","connections"],
    ["sequence","topicrush"],
    ["orderup","oddoneout"],
    ["higherlower","connections"],
    ["mathrush","topicrush"],
    ["numberroute","sequence"],
    ["orderup","connections"],
    ["oddoneout","topicrush"],
    ["higherlower","sequence"],
    ["mathrush","numberroute"],
    ["orderup","topicrush"],
    ["connections","sequence"],
    ["oddoneout","numberroute"],
    ["higherlower","mathrush"]
  ];

  function dateForDailyNumber(number){
    const n=Number(number);
    if(!Number.isFinite(n)) return todayKey();
    return new Date(DAILY_EPOCH+(n-DAILY_NUMBER_BASE)*86400000).toISOString().slice(0,10);
  }

  function dailyGameIdsForDate(dateValue=todayKey()){
    const date=String(dateValue||todayKey()).slice(0,10);
    if(date<DAILY_ROTATION_START){
      return ["brainmix","orderup","topicrush","brainiword"];
    }
    const number=dailyNumberForDate(date)||DAILY_NUMBER_BASE;
    const pairIndex=((number-3)%DAILY_VARIABLE_PAIRS.length+DAILY_VARIABLE_PAIRS.length)%DAILY_VARIABLE_PAIRS.length;
    const pair=DAILY_VARIABLE_PAIRS[pairIndex];
    return ["brainmix",pair[0],pair[1],"brainiword"];
  }

  function dailyGameIdsForNumber(number){
    return dailyGameIdsForDate(dateForDailyNumber(number));
  }

  function emptyDailyBreakdown(dateValue=todayKey()){
    const out={};
    dailyGameIdsForDate(dateValue).forEach(id=>{
      out[id]={points:0,max:2500,label:"Not played yet"};
    });
    return out;
  }

  function pastDailyDate(dateValue){
    const raw=String(dateValue||"").slice(0,10);
    const number=dailyNumberForDate(raw);
    return Number.isFinite(number) && number>=DAILY_NUMBER_BASE && raw<todayKey()
      ? raw
      : null;
  }

  function makeAnonId(){
    return "anon_"+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
  }

  const defaultState = {
    version:11,
    auth:{
      status:"guest",
      anonymousPlayerId:makeAnonId(),
      user:null,
      provider:null,
      cloudSync:false,
      leaderboard:{
        enabled:false,
        displayName:null
      }
    },
    social:{
      friendCode:"BRN-LOCAL",
      friends:[],
      pendingFriendRequests:[],
      outgoingFriendRequests:[],
      groups:[],
      groupInvites:[]
    },
    player:{
      id:"local-player-001",
      displayName:"You",
      avatarInitial:"B",
      countryCode:"",
      createdAt:null,
      currentStreak:0,
      bestStreak:0,
      xp:0,
      level:1,
      totalQuestions:0,
      totalGames:0,
      totalShares:0,
      fullDailyCount:0,
      favoriteCategory:null,
      categoryAccuracy:{}
    },
    daily:{
      key:todayKey(),
      number:dailyNumber(),
      completedGames:[],
      brainScore:0,
      brainScorePercentile:null,
dailyBreakdown:emptyDailyBreakdown()
    },
    personalBests:{},
    anytimeHistory:{},
    recentResults:[],
    shareEvents:[],
    analytics:[]
  };

  const collective = {
    generatedAt:null,
    today:{
      activePlayers:null,
      gamesPlayed:null,
      totalAnswers:null,
      shares:null,
      avgGamesPerPlayer:null
    },
    games:{},
    leaderboards:{}
  };

  function clone(x){ return JSON.parse(JSON.stringify(x)); }

  function loadState(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) return clone(defaultState);
      const parsed=JSON.parse(raw);
      if(!parsed.auth){
        parsed.auth=clone(defaultState.auth);
      }else{
        parsed.auth=Object.assign(clone(defaultState.auth),parsed.auth);
        parsed.auth.leaderboard=Object.assign(clone(defaultState.auth.leaderboard),parsed.auth.leaderboard||{});
      }
      if(!parsed.player) parsed.player=clone(defaultState.player);
      if(!parsed.anytimeHistory || typeof parsed.anytimeHistory!=="object") parsed.anytimeHistory={};
      if(!parsed.social){
        parsed.social=clone(defaultState.social);
      }else{
        parsed.social=Object.assign(clone(defaultState.social),parsed.social);
        parsed.social.friends=Array.isArray(parsed.social.friends)?parsed.social.friends:clone(defaultState.social.friends);
        parsed.social.pendingFriendRequests=Array.isArray(parsed.social.pendingFriendRequests)?parsed.social.pendingFriendRequests:[];
        parsed.social.outgoingFriendRequests=Array.isArray(parsed.social.outgoingFriendRequests)?parsed.social.outgoingFriendRequests:[];
        parsed.social.groups=Array.isArray(parsed.social.groups)?parsed.social.groups:clone(defaultState.social.groups);
        parsed.social.groupInvites=Array.isArray(parsed.social.groupInvites)?parsed.social.groupInvites:[];
      }
      if(parsed.daily?.key!==todayKey()){
        parsed.daily={
key:todayKey(),number:dailyNumber(),completedGames:[],brainScore:0,brainScorePercentile:null,
          dailyBreakdown:emptyDailyBreakdown()
        };
      }else if(Number(parsed.daily?.number)!==dailyNumber()){
        // V31 official-launch migration: development Daily #143 becomes public Daily #1
        // without erasing same-day guest progress already stored in this browser.
        const oldNumber=Number(parsed.daily?.number||0);
        const newNumber=dailyNumber();
        parsed.daily.number=newNumber;

        if(Array.isArray(parsed.recentResults)){
          parsed.recentResults.forEach(result=>{
            const playedDate=String(result.playedAt||"").slice(0,10);
            if(
              playedDate===todayKey() &&
              ["brainmix","orderup","flagdash","topicrush","brainiword","maphunt"].includes(result.gameId) &&
              Number(result.dailyNumber)===oldNumber
            ){
              result.dailyNumber=newNumber;
            }
          });
        }
      }

      // V34: Order Up replaces Flag Dash in the Daily lineup.
      // Preserve the historical Flag Dash result, but do not let it occupy
      // today's new Order Up slot.
      if(parsed.daily?.key===todayKey()){
        parsed.daily.dailyBreakdown=parsed.daily.dailyBreakdown||{};

        if(!parsed.daily.dailyBreakdown.orderup){
          parsed.daily.dailyBreakdown.orderup={
            points:0,
            max:2500,
            label:"Not played yet"
          };
        }

        const oldFlagPoints=Number(
          parsed.daily.dailyBreakdown.flagdash?.points||0
        );

        if(Array.isArray(parsed.daily.completedGames)){
          parsed.daily.completedGames=parsed.daily.completedGames
            .filter(id=>id!=="flagdash");
        }

        if(oldFlagPoints>0){
          parsed.daily.brainScore=Math.max(
            0,
            Number(parsed.daily.brainScore||0)-oldFlagPoints
          );
        }

        delete parsed.daily.dailyBreakdown.flagdash;
      }

      return Object.assign(clone(defaultState),parsed);
    }catch(e){
      return clone(defaultState);
    }
  }

  let state=loadState();

  function save(){
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }catch(e){}
  }

  function game(gameId){ return clone(GAME_DEFS[gameId]||null); }
  function player(){ return clone(state.player); }
  function daily(){ return clone(state.daily); }
  function personalBest(gameId){ return clone(state.personalBests[gameId]||null); }
  function anytimeHistory(scope){
    const key=String(scope||"").trim();
    if(!key) return {};
    return clone(state.anytimeHistory?.[key]||{});
  }

  function recordAnytimeHistory(scope,ids){
    const key=String(scope||"").trim();
    if(!key || !Array.isArray(ids) || !ids.length) return anytimeHistory(key);
    if(!state.anytimeHistory || typeof state.anytimeHistory!=="object") state.anytimeHistory={};
    const bucket=(state.anytimeHistory[key] && typeof state.anytimeHistory[key]==="object")
      ? state.anytimeHistory[key]
      : {};
    const now=new Date().toISOString();
    [...new Set(ids.map(id=>String(id||"").trim()).filter(Boolean))].forEach(id=>{
      const previous=bucket[id]||{};
      bucket[id]={
        timesPlayed:Math.max(0,Number(previous.timesPlayed||0))+1,
        lastPlayedAt:now
      };
    });
    state.anytimeHistory[key]=bucket;
    save();
    return clone(bucket);
  }

  function anytimePlayedIds(scope){
    return Object.keys(anytimeHistory(scope));
  }

  function recentResults(gameId){
    return clone(gameId ? state.recentResults.filter(x=>x.gameId===gameId) : state.recentResults);
  }
  function collectiveStats(gameId){
    return clone(gameId ? collective.games[gameId]||null : collective);
  }
  function leaderboard(gameId){ return clone(collective.leaderboards[gameId]||[]); }

  function computePercentile(){
    // Percentiles are authoritative only when returned by the backend.
    return null;
  }

  function scoreForDaily(gameId,payload){
    if(gameId==="brainmix") return Math.min(2500,Math.round((payload.score||0)*.25));
    if(gameId==="flagdash") return Math.min(2500,Math.round((payload.correct||0)*70 + (payload.bestCombo||0)*15));
    if(gameId==="orderup") return Math.min(2500,Math.max(0,Math.round(payload.score||0)));
    if(gameId==="topicrush") return Math.min(2500,Math.max(0,Math.round(payload.score||0)));
    if(gameId==="maphunt") return Math.min(2500,Math.round((payload.score||0)*.42));
    if(gameId==="brainiword"){
      if(!payload.won) return 250;
      return {1:2500,2:2250,3:2000,4:1750,5:1500}[payload.attempts]||1000;
    }
    if(gameId==="connections") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0)/3000*2500)));
    if(gameId==="oddoneout") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0)/1000*2500)));
    if(gameId==="higherlower") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0)/1700*2500)));
    if(gameId==="mathrush") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0))));
    if(gameId==="numberroute") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0))));
    if(gameId==="sequence") return Math.min(2500,Math.max(0,Math.round(Number(payload.score||0))));
    return 0;
  }

  function recomputeDailyBrainScore(){
    const today=state.daily.number;
    const todayDate=dateForDailyNumber(today);
    const dailyIds=dailyGameIdsForDate(todayDate);
    const acceptedIds=todayDate<DAILY_ROTATION_START?[...dailyIds,"maphunt"]:[...dailyIds];
    const bestByGame={};

    // V26 migration bridge: a Map Hunt result already completed today occupies
    // the new Topic Rush Daily slot instead of disappearing from 4/4 progress.
    state.recentResults
      .filter(r=>r.dailyNumber===today && acceptedIds.includes(r.gameId))
      .forEach(r=>{
        const sourceGameId=r.gameId;
        const slotGameId=sourceGameId==="maphunt" && todayDate<DAILY_ROTATION_START ? "topicrush" : sourceGameId;
        const points=scoreForDaily(sourceGameId,r);
        const previous=bestByGame[slotGameId];
        const previousPoints=previous?._dailyPoints ?? 0;

        if(!previous || points>previousPoints){
          bestByGame[slotGameId]={
            ...r,
            gameId:slotGameId,
            _dailySourceGameId:sourceGameId,
            _dailyPoints:points
          };
        }
      });

    state.daily.brainScore = Object.values(bestByGame)
      .reduce((sum,r)=>sum+(r._dailyPoints ?? scoreForDaily(r.gameId,r)),0);
    const completion=Object.keys(bestByGame).length;
    state.daily.brainScorePercentile = completion ? Math.max(4,Math.round(74-state.daily.brainScore/160)) : null;
    state.daily.completedGames=Object.keys(bestByGame);
    const breakdown={};
    dailyIds.forEach(gameId=>{
      const res=bestByGame[gameId];
      if(!res){
        breakdown[gameId]={points:0,max:2500,label:"Not played yet"};
        return;
      }
      const pts=res._dailyPoints ?? scoreForDaily(gameId,res);
      let label="Completed";
      if(gameId==="brainmix") label=`${res.correct||0}/${res.total||10} correct`;
      else if(gameId==="orderup") label=`${res.accuracy||0}% order accuracy`;
      else if(gameId==="topicrush"){
        label=res._dailySourceGameId==="maphunt"
          ? "Completed before Topic Rush update"
          : `${res.correct||0} answers`;
      }
      else if(gameId==="brainiword") label=res.won ? `${res.attempts}/5 tries` : "Not solved";
      else if(gameId==="connections") label=`${Number(res.attempts||0)} total attempts`;
      else if(gameId==="oddoneout") label=`${Number(res.correct||0)}/${Number(res.total||10)} correct`;
      else if(gameId==="higherlower") label=`${Number(res.correct||0)}/${Number(res.total||10)} correct`;
      else if(gameId==="mathrush") label=`${Number(res.correct||0)} correct · ${Number(res.bestCombo||0)} best combo`;
      else if(gameId==="numberroute") label=`${Number(res.correct||0)}/${Number(res.total||10)} routes solved`;
      else if(gameId==="sequence") label=`${Number(res.correct||0)}/${Number(res.total||10)} correct`;
      breakdown[gameId]={points:pts,max:2500,label};
    });
    state.daily.dailyBreakdown=breakdown;
  }



  function pendingAnswerVerifications(){
    return clone(
      state.recentResults.filter(r=>
        !r.practice &&
        (r.quizPackId || r.contentSource==="supabase") &&
        Array.isArray(r.answerDetails) &&
        r.answerDetails.length>0 &&
        r.answerDetails.every(a=>!!a.questionVersionId) &&
        r.cloudSyncStatus==="synced" &&
        r.answerVerificationStatus!=="verified"
      )
    );
  }

  function markResultAnswerVerified(clientResultId,verification={}){
    const result=state.recentResults.find(r=>r.clientResultId===clientResultId);
    if(!result) return null;

    result.answerVerificationStatus="verified";
    result.answersVerifiedAt=new Date().toISOString();
    result.verifiedCorrect=verification.correct_answers ?? result.correct ?? null;
    result.verifiedTotal=verification.total_questions ?? result.total ?? null;
    result.verifiedAccuracy=verification.accuracy ?? result.accuracy ?? null;

    // Make verified correctness the local canonical correctness too.
    if(result.verifiedCorrect!==null) result.correct=result.verifiedCorrect;
    if(result.verifiedTotal!==null) result.total=result.verifiedTotal;
    if(result.verifiedAccuracy!==null) result.accuracy=result.verifiedAccuracy;

    track("quiz_answers_server_verified",{
      gameId:result.gameId,
      clientResultId,
      correct:result.verifiedCorrect,
      total:result.verifiedTotal
    });

    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"answer_verification",gameId:result.gameId,result:clone(result)}
    }));

    return clone(result);
  }


  function syncDailyChallengeMeta(daily){
    if(!daily) return clone(state.daily);

    if(Number.isFinite(Number(daily.dailyNumber))){
      state.daily.number=Number(daily.dailyNumber);
    }

    if(daily.challengeDate){
      state.daily.challengeDate=daily.challengeDate;
    }

    if(daily.dailyChallengeId){
      state.daily.dailyChallengeId=daily.dailyChallengeId;
    }

    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"daily_meta",daily:clone(state.daily)}
    }));
    return clone(state.daily);
  }

  function pendingDailyVerifications(){
    return clone(
      state.recentResults.filter(r=>
        !r.practice &&
        r.dailyChallengeId &&
        Array.isArray(r.answerDetails) &&
        r.answerDetails.length===10 &&
        r.cloudSyncStatus==="synced" &&
        r.dailyAnswerVerificationStatus!=="verified"
      )
    );
  }

  function markResultDailyVerified(clientResultId,verification={}){
    const result=state.recentResults.find(r=>r.clientResultId===clientResultId);
    if(!result) return null;

    result.dailyAnswerVerificationStatus="verified";
    result.dailyAnswersVerifiedAt=new Date().toISOString();
    result.verifiedCorrect=verification.correct_answers ?? result.correct ?? null;
    result.verifiedTotal=verification.total_questions ?? result.total ?? null;
    result.verifiedAccuracy=verification.accuracy ?? result.accuracy ?? null;

    if(Number.isFinite(Number(verification.daily_number))){
      result.dailyNumber=Number(verification.daily_number);
    }
    if(result.verifiedCorrect!==null) result.correct=result.verifiedCorrect;
    if(result.verifiedTotal!==null) result.total=result.verifiedTotal;
    if(result.verifiedAccuracy!==null) result.accuracy=result.verifiedAccuracy;

    track("daily_answers_server_verified",{
      gameId:result.gameId,
      clientResultId,
      dailyNumber:result.dailyNumber,
      correct:result.verifiedCorrect,
      total:result.verifiedTotal
    });

    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"daily_answer_verification",result:clone(result)}
    }));

    return clone(result);
  }


  function pendingDailyGameVerifications(){
    const supported=new Set(["orderup","topicrush","brainiword"]);
    return clone(
      state.recentResults.filter(r=>
        !r.practice &&
        supported.has(r.gameId) &&
        r.dailyChallengeId &&
        r.cloudSyncStatus==="synced" &&
        r.dailyGameVerificationStatus!=="verified"
      )
    );
  }

  function markDailyGameVerified(clientResultId,verification={}){
    const result=state.recentResults.find(r=>r.clientResultId===clientResultId);
    if(!result) return null;

    result.dailyGameVerificationStatus="verified";
    result.dailyGameVerifiedAt=new Date().toISOString();

    if(Number.isFinite(Number(verification.daily_number))){
      result.dailyNumber=Number(verification.daily_number);
    }
    if(Number.isFinite(Number(verification.correct))){
      result.correct=Number(verification.correct);
    }
    if(Number.isFinite(Number(verification.total))){
      result.total=Number(verification.total);
    }
    if(Number.isFinite(Number(verification.accuracy))){
      result.accuracy=Number(verification.accuracy);
    }
    if(Number.isFinite(Number(verification.score))){
      result.score=Number(verification.score);
    }
    if(Number.isFinite(Number(verification.best_combo))){
      result.bestCombo=Number(verification.best_combo);
    }
    if(typeof verification.won==="boolean"){
      result.won=verification.won;
    }
    if(Number.isFinite(Number(verification.attempts))){
      result.attempts=Number(verification.attempts);
    }

    recomputeDailyBrainScore();

    track("daily_game_server_checked",{
      gameId:result.gameId,
      clientResultId,
      dailyNumber:result.dailyNumber
    });

    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"daily_game_verification",gameId:result.gameId,result:clone(result)}
    }));

    return clone(result);
  }

  function makeClientResultId(){
    if(window.crypto?.randomUUID){
      return "cr_"+window.crypto.randomUUID();
    }
    return "cr_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,12);
  }

  function pendingCloudResults(){
    return clone(
      state.recentResults.filter(r=>
        !r.practice &&
        r.recordedAtStep===3 &&
        r.clientResultId &&
        r.cloudSyncStatus!=="synced"
      )
    );
  }

  function markResultCloudSynced(clientResultId,cloud={}){
    const result=state.recentResults.find(r=>r.clientResultId===clientResultId);
    if(!result) return null;

    result.cloudSyncStatus="synced";
    result.cloudSessionId=cloud.sessionId||result.cloudSessionId||null;
    result.cloudResultId=cloud.resultId||result.cloudResultId||null;
    result.cloudSyncedAt=new Date().toISOString();

    track("game_result_cloud_synced",{
      gameId:result.gameId,
      clientResultId,
      cloudSessionId:result.cloudSessionId,
      alreadyExisted:!!cloud.alreadyExisted
    });

    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"cloud_result_synced",gameId:result.gameId,result:clone(result)}
    }));

    return clone(result);
  }

  async function submitGameResultHybrid(gameId,payload){
    // Try First runs the full real game engine but is deliberately invisible to results, XP and stats.
    if(new URLSearchParams(location.search).get("try")==="1"){
      return Object.assign({gameId,practice:true,tryFirst:true,cloudSyncStatus:"disabled",clientResultId:null},clone(payload));
    }
    // Map Hunt is retired. Do not add new local or cloud analytics/results.
    if(gameId==="maphunt"){
      return Object.assign({gameId,deprecated:true,practice:true,cloudSyncStatus:"disabled"},clone(payload));
    }
    const result=recordGameResult(gameId,payload);

    // Past Daily replays are deliberately local-only practice results.
    // They must never change today's Daily score, streak or cloud rankings.
    if(result.practice){
      const stored=state.recentResults.find(r=>r.clientResultId===result.clientResultId);
      if(stored){
        stored.cloudSyncStatus="local_only";
        stored.dailyAnswerVerificationStatus="practice";
        stored.dailyGameVerificationStatus="practice";
        save();
      }
      return clone(stored||result);
    }

    if(window.BrainiCloudGames){
      try{
        const sync=await BrainiCloudGames.saveCompletedResult(gameId,result);
        if(sync?.saved){
          return clone(
            state.recentResults.find(r=>r.clientResultId===result.clientResultId) || result
          );
        }
      }catch(err){
        // Local-first: never lose a completed game because cloud sync failed.
        console.warn("BrainiLab result saved locally; cloud sync pending:",err.message||err);
      }
    }

    return clone(result);
  }

  function recordGameResult(gameId,payload){
    const def=GAME_DEFS[gameId];
    if(!def) throw new Error("Unknown game: "+gameId);

    const requestedDaily=Number(payload?.dailyNumber);
    if(Number.isFinite(requestedDaily) && !payload?.practice){
      const existing=state.recentResults.find(r=>r.gameId===gameId && !r.practice && Number(r.dailyNumber)===requestedDaily);
      if(existing) return Object.assign(clone(existing),{dailyReplayBlocked:true});
    }

    const result=Object.assign({
      id:"r-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),
      clientResultId:makeClientResultId(),
      recordedAtStep:3,
      cloudSyncStatus:"pending",
      gameId,
      playedAt:new Date().toISOString(),
      dailyNumber:def.daily ? state.daily.number : null,
      percentile:null,
      streakAfter:state.player.currentStreak
    },clone(payload));

    result.percentile = payload.percentile ?? computePercentile(gameId,result);
    state.recentResults.unshift(result);
    state.recentResults=state.recentResults.slice(0,100);

    state.player.totalGames += 1;
    if(Number.isFinite(result.total)) state.player.totalQuestions += result.total;

    // Simplified personal best update
    const pb=state.personalBests[gameId]||{};
    if(gameId==="brainiword"){
      if(result.won && (!pb.attempts || result.attempts < pb.attempts)){
        state.personalBests[gameId]=Object.assign({},pb,{attempts:result.attempts});
      }
    }else if(gameId==="flagdash"){
      if((result.correct||0) > (pb.correct||0)) state.personalBests[gameId]=Object.assign({},pb,result);
    }else{
      if((result.score||0) > (pb.score||0)) state.personalBests[gameId]=Object.assign({},pb,result);
    }

    if(
      Number(result.dailyNumber)===Number(state.daily.number) &&
      dailyGameIdsForNumber(state.daily.number).includes(gameId) &&
      !result.practice
    ) recomputeDailyBrainScore();

    track("game_completed",{gameId,resultId:result.id,percentile:result.percentile});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"game_result",gameId,result:clone(result)}}));
    return clone(result);
  }

  function track(event,props={}){
    state.analytics.push({
      id:"e-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
      event,
      at:new Date().toISOString(),
      props:clone(props)
    });
    state.analytics=state.analytics.slice(-500);
    save();
  }

  function recordShare(gameId,channel,context={}){
    const event={
      id:"s-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
      gameId,channel,at:new Date().toISOString(),context:clone(context)
    };
    state.shareEvents.push(event);
    state.player.totalShares += 1;
    track("result_shared",{gameId,channel,...context});
    save();
    return clone(event);
  }

  function shareUrl(gameId,channel="native"){
    const route=GAME_DEFS[gameId]?.route || "/";
    const qs=new URLSearchParams({
      utm_source:channel,
      utm_medium:"organic_share",
      utm_campaign:gameId,
      ref:"share"
    });
    return location.origin + route + "?" + qs.toString();
  }


  function authState(){
    return clone(state.auth);
  }

  function isAuthenticated(){
    return state.auth?.status==="authenticated" && !!state.auth.user;
  }

  function accountSnapshot(){
    return {
      auth:authState(),
      player:player(),
      daily:daily(),
      personalBests:clone(state.personalBests),
      recentResults:recentResults()
    };
  }

  function completeMockSignIn(provider,profile={}){
    const now=new Date().toISOString();
    const oldAnonId=state.auth.anonymousPlayerId || makeAnonId();
    const email=(profile.email||(
      provider==="google" ? "player@gmail.com" :
      provider==="apple" ? "player@privaterelay.appleid.com" :
      "player@example.com"
    )).trim().toLowerCase();

    const suggestedName=(profile.displayName || (
      provider==="google" ? "Braini Player" :
      provider==="apple" ? "Brainiac" :
      (email.split("@")[0] || "Braini Player")
    )).trim();

    state.auth={
      status:"authenticated",
      anonymousPlayerId:oldAnonId,
      provider,
      cloudSync:true,
      user:{
        id:"usr_"+Math.random().toString(36).slice(2,9),
        email,
        emailVerified:true,
        createdAt:now,
        lastLoginAt:now
      },
      leaderboard:Object.assign(
        {enabled:false,displayName:null},
        state.auth?.leaderboard||{}
      )
    };

    // Guest progress is intentionally retained: this is the merge step.
    state.player.id="player_"+state.auth.user.id.slice(4);
    state.player.displayName=suggestedName || state.player.displayName || "Braini Player";
    state.player.avatarInitial=(state.player.displayName[0]||"B").toUpperCase();

    track("account_created",{
      provider,
      migratedAnonymousPlayerId:oldAnonId,
      retainedGames:state.player.totalGames,
      retainedQuestions:state.player.totalQuestions
    });
    save();
    window.dispatchEvent(new CustomEvent("brainilab:authchange",{detail:{status:"authenticated",provider}}));
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"auth"}}));
    return accountSnapshot();
  }

  function requestMagicLink(email){
    const clean=(email||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)){
      throw new Error("Enter a valid email address.");
    }
    track("magic_link_requested",{emailDomain:clean.split("@")[1]});
    save();
    return {ok:true,email:clean,expiresInMinutes:15};
  }

  function signOut(){
    const previousUser=state.auth?.user?.id || null;
    state.auth={
      status:"guest",
      anonymousPlayerId:makeAnonId(),
      user:null,
      provider:null,
      cloudSync:false,
      leaderboard:{enabled:false,displayName:null}
    };
    state.player.id="local-player-"+Math.random().toString(36).slice(2,7);
    state.player.displayName="You";
    state.player.avatarInitial="B";
    track("logout",{previousUser});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:authchange",{detail:{status:"guest"}}));
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"auth"}}));
    return authState();
  }

  function updatePlayerProfile(patch={}){
    if(!isAuthenticated()) throw new Error("Sign in to update your profile.");
    if(typeof patch.displayName==="string"){
      const clean=patch.displayName.trim().slice(0,30);
      if(clean){
        state.player.displayName=clean;
        state.player.avatarInitial=clean[0].toUpperCase();
      }
    }
    if(typeof patch.countryCode==="string" && patch.countryCode.trim()){
      state.player.countryCode=patch.countryCode.trim().slice(0,2).toUpperCase();
    }
    track("profile_updated",{fields:Object.keys(patch)});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"profile"}}));
    return player();
  }

  function joinLeaderboard(displayName){
    if(!isAuthenticated()) throw new Error("Sign in before joining leaderboards.");
    const clean=(displayName||state.player.displayName||"").trim().replace(/\s+/g," ").slice(0,24);
    if(clean.length<2) throw new Error("Choose a display name with at least 2 characters.");
    state.auth.leaderboard={enabled:true,displayName:clean};
    state.player.displayName=clean;
    state.player.avatarInitial=clean[0].toUpperCase();
    track("leaderboard_joined",{displayNameLength:clean.length});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"leaderboard"}}));
    return clone(state.auth.leaderboard);
  }

  function leaveLeaderboard(){
    if(!state.auth) return null;
    state.auth.leaderboard={enabled:false,displayName:null};
    track("leaderboard_left",{});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"leaderboard"}}));
    return clone(state.auth.leaderboard);
  }


  const RANKING_NAMES=[
    "MayaK","Atlas_7","LeoQ","GeoBee","QuizNinja","Nora","MapWizard","FlagFox","PixelBrain","Cortex",
    "TriviaCat","NovaMind","FactRunner","BlueOrbit","QuickThink","GlobeTrotter","Neuron","QuizPilot","DailyFox","BrainBolt",
    "EchoMind","KappaQuiz","WorldWise","AtlasBee","ThinkFast","MintBrain","QuizOtter","MangoMind","LogicLab","StarQuiz",
    "CleverCub","Factora","NimbleNerd","TopoFox","Quizzly","MindSprint","Brainwave","FactForge","GeoNova","PuzzleBee"
  ];
  const RANKING_COUNTRIES=["ES","US","GB","PT","DE","FR","IT","NL","CA","AU","BR","MX","JP","SE","NO"];
  const GROUP_NAMES=[
    "Brain Storm","Quiz Catalysts","Global Minds","Flag Hunters","Neuron Crew","Daily Thinkers","Atlas Club","Fast Facts",
    "Cortex Five","The Quizzards","Map Masters","Brain Sparks","Trivia Tribe","Knowledge Lab","Puzzle Union","Mind League",
    "Fact Pack","Bright Five","World Brains","Quiz Orbit","The Recall","Think Tank","Geo Gang","Daily League","Smart Squad",
    "Brain Fuel","Question Club","Mindset Five","Clever Collective","Quiz Forge"
  ];
  const GROUP_ICONS=["⚡","🧠","🌍","🚩","🏆","💡","🧩","⭐"];
  const GROUP_COLORS=["#FFD813","#40AB34","#E52720","#E6680C","#2D296E"];

  function hashString(str){
    let h=2166136261;
    for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); }
    return Math.abs(h>>>0);
  }

  function friends(){ return clone(state.social?.friends||[]); }
  function pendingFriendRequests(){ return clone(state.social?.pendingFriendRequests||[]); }
  function groups(){ return clone(state.social?.groups||[]); }
  function socialState(){ return clone(state.social); }


  function createFriendInvite(){
    if(!isAuthenticated()) throw new Error("Sign in to invite friends.");
    const code=state.social.friendCode;
    const invite={
      code,
      url:`https://brainilab.com/profile/?friend=${encodeURIComponent(code)}`,
      createdAt:new Date().toISOString()
    };
    track("friend_invite_created",{code});
    save();
    return clone(invite);
  }

  function sendFriendRequest(code){
    if(!isAuthenticated()) throw new Error("Sign in to connect with friends.");
    const clean=(code||"").trim().toUpperCase();
    if(clean.length<4) throw new Error("Enter a valid BrainiLab friend code.");
    if(clean===state.social.friendCode) throw new Error("That is your own friend code.");
    const seed=hashString(clean);
    const name=RANKING_NAMES[seed%RANKING_NAMES.length];
    if(state.social.friends.some(f=>f.name===name)) throw new Error("You are already connected with this player.");
    const friend={
      id:"fr-"+Date.now(),name,country:RANKING_COUNTRIES[(seed>>3)%RANKING_COUNTRIES.length],avatar:name[0].toUpperCase(),
      currentStreak:4+(seed%29),dailyScore:6400+(seed%3100),weeklyScore:42000+(seed%17000),
      monthlyScore:168000+(seed%69000),status:"accepted"
    };
    state.social.friends.push(friend);
    track("friend_connected",{friendId:friend.id,source:"friend_code"});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"friends"}}));
    return clone(friend);
  }

  function acceptFriendRequest(requestId){
    if(!isAuthenticated()) throw new Error("Sign in to manage friends.");
    const idx=state.social.pendingFriendRequests.findIndex(r=>r.id===requestId);
    if(idx<0) throw new Error("Friend request not found.");
    const req=state.social.pendingFriendRequests.splice(idx,1)[0];
    const seed=hashString(req.name);
    const friend={
      id:"fr-"+Date.now(),name:req.name,country:req.country||"ES",avatar:req.avatar||req.name[0],
      currentStreak:5+(seed%21),dailyScore:6800+(seed%2500),weeklyScore:45000+(seed%15000),
      monthlyScore:177000+(seed%62000),status:"accepted"
    };
    state.social.friends.push(friend);
    track("friend_request_accepted",{friendId:friend.id});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"friends"}}));
    return clone(friend);
  }

  function removeFriend(friendId){
    if(!isAuthenticated()) throw new Error("Sign in to manage friends.");
    const before=state.social.friends.length;
    state.social.friends=state.social.friends.filter(f=>f.id!==friendId);
    state.social.groups.forEach(g=>{ g.members=g.members.filter(m=>m.id!==friendId); });
    if(state.social.friends.length===before) throw new Error("Friend not found.");
    track("friend_removed",{friendId}); save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"friends"}}));
    return friends();
  }

  function createGroup(payload={}){
    if(!isAuthenticated()) throw new Error("Sign in to create a group.");
    const name=(payload.name||"").trim().replace(/\s+/g," ").slice(0,28);
    if(name.length<2) throw new Error("Choose a group name with at least 2 characters.");
    const friendIds=Array.isArray(payload.friendIds)?payload.friendIds.slice(0,4):[];
    const selected=state.social.friends.filter(f=>friendIds.includes(f.id)).slice(0,4);
    const members=[
      {id:"self",name:state.player.displayName||"You",country:state.player.countryCode||"ES",avatar:state.player.avatarInitial||"B"},
      ...selected.map(f=>({id:f.id,name:f.name,country:f.country,avatar:f.avatar}))
    ];
    if(members.length>5) throw new Error("Groups can have a maximum of 5 members.");
    const color=GROUP_COLORS.includes(payload.color)?payload.color:GROUP_COLORS[0];
    const icon=GROUP_ICONS.includes(payload.icon)?payload.icon:GROUP_ICONS[0];
    const seed=hashString(name);
    const group={
      id:"grp-"+Date.now(),name,crest:{icon,color},country:state.player.countryCode||"ES",ownerId:"self",members,
      currentStreak:1+(seed%14),
      dailyScore:Math.round(members.reduce((sum,m,i)=>sum+(m.id==="self"?state.daily.brainScore:7100+((seed+i*997)%2200)),0)),
      weeklyScore:members.length*(42000+(seed%9000)),
      monthlyScore:members.length*(169000+(seed%32000))
    };
    state.social.groups.push(group);
    track("group_created",{groupId:group.id,memberCount:members.length}); save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"groups"}}));
    return clone(group);
  }

  function updateGroup(groupId,patch={}){
    if(!isAuthenticated()) throw new Error("Sign in to manage groups.");
    const g=state.social.groups.find(x=>x.id===groupId);
    if(!g) throw new Error("Group not found.");
    if(g.ownerId!=="self") throw new Error("Only the group owner can edit this group.");
    if(typeof patch.name==="string"){
      const name=patch.name.trim().replace(/\s+/g," ").slice(0,28);
      if(name.length>=2) g.name=name;
    }
    if(GROUP_COLORS.includes(patch.color)) g.crest.color=patch.color;
    if(GROUP_ICONS.includes(patch.icon)) g.crest.icon=patch.icon;
    if(Array.isArray(patch.friendIds)){
      const selected=state.social.friends.filter(f=>patch.friendIds.includes(f.id)).slice(0,4);
      g.members=[
        {id:"self",name:state.player.displayName||"You",country:state.player.countryCode||"ES",avatar:state.player.avatarInitial||"B"},
        ...selected.map(f=>({id:f.id,name:f.name,country:f.country,avatar:f.avatar}))
      ];
    }
    if(g.members.length>5) throw new Error("Groups can have a maximum of 5 members.");
    track("group_updated",{groupId,memberCount:g.members.length}); save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"groups"}}));
    return clone(g);
  }

  function leaveGroup(groupId){
    if(!isAuthenticated()) throw new Error("Sign in to manage groups.");
    const g=state.social.groups.find(x=>x.id===groupId);
    if(!g) throw new Error("Group not found.");
    state.social.groups=state.social.groups.filter(x=>x.id!==groupId);
    track(g.ownerId==="self"?"group_deleted":"group_left",{groupId}); save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"groups"}}));
    return groups();
  }

  function rankingMetricLabel(filters={}){
    if(filters.metric==="streak") return filters.mode==="group"?"Group streak":"Streak";
    return filters.mode==="group"?"Group points":"Points";
  }

  function individualUserRank(filters={}){
    const key=[filters.region||"global",filters.period||"daily",filters.gameId||"all",filters.metric||"score"].join("|");
    const presets={
      "global|daily|all|score":185,"country|daily|all|score":43,"global|weekly|all|score":742,
      "global|monthly|all|score":1284,"country|weekly|all|score":67,"country|monthly|all|score":212,
      "global|daily|brainmix|score":96,"global|daily|brainiword|score":114,
      "global|daily|all|streak":638,"country|daily|all|streak":88
    };
    return presets[key] || (60+(hashString(key)%1080));
  }

  function groupUserRank(filters={}){
    if(!state.social.groups.length) return null;
    const key=[filters.region||"global",filters.period||"daily",filters.gameId||"all",filters.metric||"score"].join("|");
    const presets={
      "global|daily|all|score":72,"country|daily|all|score":9,"global|weekly|all|score":148,
      "global|monthly|all|score":1042,"country|weekly|all|score":21
    };
    return presets[key] || (8+(hashString("g|"+key)%1030));
  }

  function scoreForRank(seed,rank,filters={},mode="individual"){
    const period=filters.period||"daily";
    if(filters.metric==="streak") return Math.max(1,75-rank+(seed%11));
    const scale=period==="monthly"?28:period==="weekly"?7:1;
    const base=mode==="group"?31000:9900;
    const drop=mode==="group"?145:27;
    return Math.max(120,Math.round((base-rank*drop+(seed%190))*scale));
  }

  function buildIndividualRanking(filters={}){
    const region=filters.region||"global", country=state.player.countryCode||"ES";
    const key=[region,filters.period||"daily",filters.gameId||"all",filters.metric||"score"].join("|");
    const seedBase=hashString(key), rows=[];
    for(let rank=1;rank<=100;rank++){
      const seed=seedBase+rank*7919;
      const name=RANKING_NAMES[(seed+rank)%RANKING_NAMES.length]+(rank>40?String((seed%89)+1):"");
      const rowCountry=region==="country"?country:RANKING_COUNTRIES[(seed>>4)%RANKING_COUNTRIES.length];
      rows.push({rank,name,country:rowCountry,avatar:name[0].toUpperCase(),score:scoreForRank(seed,rank,filters,"individual"),streak:Math.max(1,54-Math.floor(rank/2)+(seed%13)),isMe:false});
    }
    const userRank=individualUserRank(filters);
    const user={rank:userRank,name:state.player.displayName||"You",country,avatar:state.player.avatarInitial||"B",score:scoreForRank(hashString("self|"+key),userRank,filters,"individual"),streak:state.player.currentStreak||0,isMe:true};
    if(userRank<=100) rows[userRank-1]=user;
    return {rows,user,metricLabel:rankingMetricLabel(filters),totalPlayers:28431+(seedBase%42000)};
  }

  function buildFriendRanking(filters={}){
    const period=filters.period||"daily", prop=period==="monthly"?"monthlyScore":period==="weekly"?"weeklyScore":"dailyScore";
    const all=[
      ...state.social.friends.map(f=>({id:f.id,name:f.name,country:f.country,avatar:f.avatar,score:f[prop]||0,streak:f.currentStreak||0,isMe:false})),
      {id:"self",name:state.player.displayName||"You",country:state.player.countryCode||"ES",avatar:state.player.avatarInitial||"B",score:period==="monthly"?186420:period==="weekly"?48620:state.daily.brainScore||0,streak:state.player.currentStreak||0,isMe:true}
    ];
    all.sort((a,b)=>filters.metric==="streak"?b.streak-a.streak:b.score-a.score);
    all.forEach((x,i)=>x.rank=i+1);
    return {rows:all,user:all.find(x=>x.isMe),metricLabel:filters.metric==="streak"?"Streak":"Points",totalPlayers:all.length};
  }

  function buildGroupRanking(filters={}){
    const region=filters.region||"global", country=state.player.countryCode||"ES";
    const key=[region,filters.period||"daily",filters.gameId||"all",filters.metric||"score"].join("|");
    const seedBase=hashString("groups|"+key), rows=[];
    for(let rank=1;rank<=100;rank++){
      const seed=seedBase+rank*6151;
      const name=GROUP_NAMES[(seed+rank)%GROUP_NAMES.length]+(rank>30?" "+((seed%19)+2):"");
      const rowCountry=region==="country"?country:RANKING_COUNTRIES[(seed>>5)%RANKING_COUNTRIES.length];
      rows.push({rank,name,country:rowCountry,crest:{icon:GROUP_ICONS[seed%GROUP_ICONS.length],color:GROUP_COLORS[(seed>>3)%GROUP_COLORS.length]},members:2+(seed%4),score:scoreForRank(seed,rank,filters,"group"),streak:Math.max(1,29-Math.floor(rank/5)+(seed%8)),isMe:false});
    }
    const userRank=groupUserRank(filters); let user=null;
    if(userRank && state.social.groups.length){
      const g=state.social.groups[0];
      user={rank:userRank,name:g.name,country:g.country||country,crest:clone(g.crest),members:g.members.length,score:scoreForRank(hashString("mygroup|"+key),userRank,filters,"group"),streak:g.currentStreak||0,isMe:true};
      if(userRank<=100) rows[userRank-1]=user;
    }
    return {rows,user,metricLabel:rankingMetricLabel({...filters,mode:"group"}),totalPlayers:6310+(seedBase%8400)};
  }

  function getRankings(filters={}){
    const mode=filters.mode||"individual";
    if(mode==="friends") return clone(buildFriendRanking(filters));
    if(mode==="group") return clone(buildGroupRanking(filters));
    return clone(buildIndividualRanking(filters));
  }


  function submitSuggestion(payload={}){
    const type=(payload.type||"general").trim().slice(0,32);
    const message=(payload.message||"").trim().slice(0,4000);
    const email=(payload.email||"").trim().slice(0,180);
    if(message.length<5) throw new Error("Tell us a little more about your suggestion.");

    const item={
      id:"suggestion_"+Date.now(),
      type,
      message,
      email:email||null,
      playerId:state.player?.id||null,
      authUserId:state.auth?.user?.id||null,
      createdAt:new Date().toISOString(),
      status:"received"
    };

    const key="brainilab_suggestions_v1";
    let items=[];
    try{ items=JSON.parse(localStorage.getItem(key)||"[]"); }catch(e){}
    items.unshift(item);
    localStorage.setItem(key,JSON.stringify(items.slice(0,50)));

    track("suggestion_submitted",{type,authenticated:isAuthenticated()});
    save();
    return clone(item);
  }


  function syncExternalAuthUser(user,provider="email"){
    if(!user?.id) throw new Error("Missing authenticated user.");

    const previousAnon=state.auth?.anonymousPlayerId || makeAnonId();
    const existingLeaderboard=state.auth?.leaderboard || {enabled:false,displayName:null};
    const email=(user.email||"").trim().toLowerCase();
    const meta=user.user_metadata||{};
    const suggestedName=(
      meta.full_name ||
      meta.name ||
      meta.display_name ||
      (email ? email.split("@")[0] : "") ||
      state.player.displayName ||
      "Braini Player"
    ).trim().slice(0,30);

    state.auth={
      status:"authenticated",
      anonymousPlayerId:previousAnon,
      provider,
      cloudSync:false,
      user:{
        id:user.id,
        email,
        emailVerified:!!user.email_confirmed_at,
        createdAt:user.created_at||null,
        lastLoginAt:new Date().toISOString(),
        source:"supabase"
      },
      leaderboard:existingLeaderboard
    };

    // Identity is real. Step 2 now syncs the public.profiles row separately.
    // Gameplay stats still remain local until the later results/statistics steps.
    state.player.id="local-linked-"+user.id.slice(0,8);
    if(!state.player.displayName || state.player.displayName==="You" || state.player.displayName==="Braini Player"){
      state.player.displayName=suggestedName;
      state.player.avatarInitial=(suggestedName[0]||"B").toUpperCase();
    }

    track("supabase_auth_synced",{provider,userId:user.id});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:authchange",{detail:{status:"authenticated",provider,source:"supabase"}}));
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"auth"}}));
    return accountSnapshot();
  }



  function syncCloudProgression(summary){
    if(!summary?.progression) return accountSnapshot();

    const p=summary.progression;
    const today=summary.today||{};
    const week=summary.week||{};
    const month=summary.month||{};

    state.player.currentStreak=Number(p.current_streak||0);
    state.player.bestStreak=Number(p.best_streak||0);
    state.player.xp=Number(p.xp||0);
    state.player.level=Number(p.level||1);
    state.player.totalGames=Number(p.total_games||0);
    state.player.totalQuestions=Number(p.total_questions||0);
    state.player.fullDailyCount=Number(p.full_daily_count||0);

    if(p.favorite_game_id){
      const favorite=GAME_DEFS[p.favorite_game_id];
      state.player.favoriteCategory=favorite?.name||p.favorite_game_id;
    }

    if(Number.isFinite(Number(today.daily_number))){
      state.daily.number=Number(today.daily_number);
    }

    state.daily.brainScore=Number(today.daily_brain_score||0);
    state.daily.completedGames=[];

    const todayDate=String(today.stat_date||dateForDailyNumber(state.daily.number)||todayKey()).slice(0,10);
    const dailyIds=Array.isArray(today.daily_game_ids)&&today.daily_game_ids.length
      ? today.daily_game_ids.map(String)
      : dailyGameIdsForDate(todayDate);
    const completedIds=new Set(
      Array.isArray(today.completed_game_ids)
        ? today.completed_game_ids.map(String)
        : []
    );
    const fieldByGame={
      brainmix:"brainmix",
      flagdash:"flagdash",
      orderup:"orderup",
      maphunt:"maphunt",
      topicrush:"topicrush",
      brainiword:"brainiword",
      connections:"connections",
      oddoneout:"oddoneout",
      higherlower:"higherlower",
      mathrush:"mathrush",
      numberroute:"numberroute",
      sequence:"sequence"
    };

    const breakdown={};
    dailyIds.forEach(gameId=>{
      const field=fieldByGame[gameId]||gameId;
      const played=completedIds.size
        ? completedIds.has(gameId)
        : !!today[`${field}_played`];
      breakdown[gameId]={
        points:Number(today[`${field}_points`]||0),
        max:2500,
        label:played?"Completed today":"Not played yet"
      };
      if(played) state.daily.completedGames.push(gameId);
    });

    state.daily.dailyBreakdown=breakdown;
    state.daily.fullDaily=!!today.full_daily;

    state.cloudProgression={
      synced:true,
      generatedAt:summary.generated_at||new Date().toISOString(),
      fullDailyCount:Number(p.full_daily_count||0),
      today:clone(today),
      week:clone(week),
      month:clone(month)
    };

    if(Array.isArray(summary.personal_bests)){
      summary.personal_bests.forEach(pb=>{
        const gameId=pb.game_id;
        if(!gameId) return;

        const payload=Object.assign({},pb.result_payload||{}, {
          score:pb.score,
          correct:pb.correct_answers,
          total:pb.total_questions,
          accuracy:pb.accuracy,
          timeSec:pb.duration_ms!=null
            ? Math.round(Number(pb.duration_ms)/1000)
            : undefined,
          achievedAt:pb.achieved_at,
          cloud:true
        });

        if(pb.metric_name==="attempts"){
          payload.attempts=Number(pb.metric_value);
          payload.won=true;
        }

        state.personalBests[gameId]=payload;
      });
    }

    state.auth.progressionSynced=true;

    save();

    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"progression",summary:clone(summary)}
    }));

    return accountSnapshot();
  }

  function syncCloudProfile(profile){
    if(!profile?.user_id) throw new Error("Invalid BrainiLab profile.");

    const name=(profile.display_name||state.player.displayName||"Braini Player").trim().slice(0,30);
    state.player.displayName=name;
    state.player.avatarInitial=(name[0]||"B").toUpperCase();
    state.player.avatarUrl=profile.avatar_url||null;

    state.player.countryCode=profile.country_code
      ? profile.country_code.toUpperCase()
      : "";

    if(profile.friend_code){
      state.social.friendCode=profile.friend_code;
    }

    state.auth.cloudSync=true;
    state.auth.profileSynced=true;
    state.auth.profileUpdatedAt=profile.updated_at||null;
    state.auth.leaderboard={
      enabled:!!profile.leaderboard_enabled,
      displayName:profile.leaderboard_display_name||null
    };

    track("cloud_profile_synced",{userId:profile.user_id});
    save();

    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"profile"}}));
    return accountSnapshot();
  }


  function syncCloudFriends(snapshot){
    if(!snapshot) return socialState();

    if(snapshot.friendCode){
      state.social.friendCode=snapshot.friendCode;
    }

    state.social.friends=Array.isArray(snapshot.friends)
      ? clone(snapshot.friends)
      : [];

    state.social.pendingFriendRequests=Array.isArray(snapshot.incoming)
      ? clone(snapshot.incoming)
      : [];

    state.social.outgoingFriendRequests=Array.isArray(snapshot.outgoing)
      ? clone(snapshot.outgoing)
      : [];

    state.social.cloudSynced=true;
    state.social.cloudSyncedAt=snapshot.generatedAt||new Date().toISOString();

    save();

    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"friends_cloud",snapshot:clone(snapshot)}
    }));

    return socialState();
  }


  function syncCloudGroups(snapshot){
    if(!snapshot) return socialState();

    state.social.groups=Array.isArray(snapshot.groups)
      ? clone(snapshot.groups)
      : [];

    state.social.groupInvites=Array.isArray(snapshot.receivedInvites)
      ? clone(snapshot.receivedInvites)
      : [];

    state.social.cloudGroupsSynced=true;
    state.social.cloudGroupsSyncedAt=
      snapshot.generatedAt||new Date().toISOString();

    save();

    window.dispatchEvent(new CustomEvent("brainilab:datachange",{
      detail:{type:"groups_cloud",snapshot:clone(snapshot)}
    }));

    return socialState();
  }

  function clearExternalAuthUser(){
    const previous=state.auth?.user?.id||null;
    state.auth={
      status:"guest",
      anonymousPlayerId:state.auth?.anonymousPlayerId || makeAnonId(),
      user:null,
      provider:null,
      cloudSync:false,
      leaderboard:{enabled:false,displayName:null}
    };
    state.player.id="local-player-"+Math.random().toString(36).slice(2,7);

    if(state.social?.cloudSynced || state.social?.cloudGroupsSynced){
      state.social.friendCode="BRN-LOCAL";
      state.social.friends=[];
      state.social.pendingFriendRequests=[];
      state.social.outgoingFriendRequests=[];
      state.social.groups=[];
      state.social.groupInvites=[];
      state.social.cloudSynced=false;
      state.social.cloudGroupsSynced=false;
    }

    track("supabase_auth_cleared",{previousUser:previous});
    save();
    window.dispatchEvent(new CustomEvent("brainilab:authchange",{detail:{status:"guest",source:"supabase"}}));
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"auth"}}));
    return authState();
  }

  function resetMock(){
    state=clone(defaultState);
    state.daily.key=todayKey(); state.daily.number=dailyNumber();
    save();
    window.dispatchEvent(new CustomEvent("brainilab:datachange",{detail:{type:"reset"}}));
  }

  // Future-compatible async repository surface.
  const api = {
    getAnytimeHistory: async scope => anytimeHistory(scope),
    getAnytimePlayedIds: async scope => anytimePlayedIds(scope),
    recordAnytimeHistory: async (scope,ids) => recordAnytimeHistory(scope,ids),
    getGame: async gameId => game(gameId),
    getAuthState: async () => authState(),
    isAuthenticated: async () => isAuthenticated(),
    getPlayer: async () => player(),
    getDaily: async () => daily(),
    getPersonalBest: async gameId => personalBest(gameId),
    getRecentResults: async gameId => recentResults(gameId),
    getPendingCloudResults: async () => pendingCloudResults(),
    syncDailyChallengeMeta: async daily => syncDailyChallengeMeta(daily),
    getPendingDailyVerifications: async () => pendingDailyVerifications(),
    getPendingDailyGameVerifications: async () => pendingDailyGameVerifications(),
    markDailyGameVerified: async (clientResultId,verification) => markDailyGameVerified(clientResultId,verification),
    markResultDailyVerified: async (clientResultId,verification) => markResultDailyVerified(clientResultId,verification),
    getPendingAnswerVerifications: async () => pendingAnswerVerifications(),
    markResultAnswerVerified: async (clientResultId,verification) => markResultAnswerVerified(clientResultId,verification),
    markResultCloudSynced: async (clientResultId,cloud) => markResultCloudSynced(clientResultId,cloud),
    getCollectiveStats: async gameId => collectiveStats(gameId),
    getLeaderboard: async gameId => leaderboard(gameId),
    getSocialState: async () => socialState(),
    getFriends: async () => friends(),
    getPendingFriendRequests: async () => pendingFriendRequests(),
    getGroups: async () => groups(),
    createFriendInvite: async () => createFriendInvite(),
    sendFriendRequest: async code => sendFriendRequest(code),
    acceptFriendRequest: async requestId => acceptFriendRequest(requestId),
    removeFriend: async friendId => removeFriend(friendId),
    createGroup: async payload => createGroup(payload),
    updateGroup: async (groupId,patch) => updateGroup(groupId,patch),
    leaveGroup: async groupId => leaveGroup(groupId),
    getRankings: async filters => getRankings(filters),
    submitGameResult: async (gameId,payload) => submitGameResultHybrid(gameId,payload),
    recordShare: async (gameId,channel,context) => recordShare(gameId,channel,context),
    track: async (event,props) => track(event,props),
    getShareUrl: async (gameId,channel) => shareUrl(gameId,channel),
    requestMagicLink: async email => requestMagicLink(email),
    completeMockSignIn: async (provider,profile) => completeMockSignIn(provider,profile),
    signOut: async () => signOut(),
    updatePlayerProfile: async patch => updatePlayerProfile(patch),
    joinLeaderboard: async displayName => joinLeaderboard(displayName),
    leaveLeaderboard: async () => leaveLeaderboard(),
    submitSuggestion: async payload => submitSuggestion(payload),
    syncExternalAuthUser: async (user,provider) => syncExternalAuthUser(user,provider),
    syncCloudProfile: async profile => syncCloudProfile(profile),
    syncCloudProgression: async summary => syncCloudProgression(summary),
    syncCloudFriends: async snapshot => syncCloudFriends(snapshot),
    syncCloudGroups: async snapshot => syncCloudGroups(snapshot),
    clearExternalAuthUser: async () => clearExternalAuthUser()
  };

  return {
    api,
    game,player,daily,personalBest,recentResults,anytimeHistory,anytimePlayedIds,recordAnytimeHistory,collectiveStats,leaderboard,
    friends,pendingFriendRequests,groups,socialState,getRankings,createFriendInvite,
    authState,isAuthenticated,accountSnapshot,
    completeMockSignIn,requestMagicLink,signOut,updatePlayerProfile,joinLeaderboard,leaveLeaderboard,submitSuggestion,syncExternalAuthUser,syncCloudProfile,syncCloudProgression,syncCloudFriends,syncCloudGroups,clearExternalAuthUser,
    recordGameResult,submitGameResultHybrid,pendingCloudResults,markResultCloudSynced,pendingAnswerVerifications,markResultAnswerVerified,syncDailyChallengeMeta,pendingDailyVerifications,markResultDailyVerified,pendingDailyGameVerifications,markDailyGameVerified,recordShare,track,shareUrl,resetMock,
    getState:()=>clone(state),
    getCollective:()=>clone(collective),
    todayKey,dailyNumber,dailyNumberForDate,pastDailyDate,dateForDailyNumber,
    dailyGameIdsForDate,dailyGameIdsForNumber,DAILY_ROTATION_START,
    DAILY_GAME_IDS:dailyGameIdsForDate(todayKey())
  };
})();
