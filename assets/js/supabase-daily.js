/*
  BrainiLab Daily Challenge — resilient loader
  --------------------------------------------
  Reliability rules:
  - never leave the Daily box blank
  - use today's cached cloud payload immediately when available
  - cap the Supabase request with a timeout
  - fall back to bundled local quiz content
  - validate that a playable Daily has exactly 10 valid questions
  - cache only question/options payload; no correct-answer data
*/
window.BrainiDaily = (function(){
  let cachedToday=null;
  let lastError=null;
  let inFlight=null;

  const CACHE_PREFIX="brainilab_daily_payload_v1_";
  const REQUEST_TIMEOUT_MS=4500;

  const scriptBase=(function(){
    const src=document.currentScript?.src;
    return src ? new URL("./",src) : null;
  })();

  function todayKey(){
    return new Date().toISOString().slice(0,10);
  }

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  function validQuestions(questions){
    return Array.isArray(questions)
      && questions.length===10
      && questions.every(q=>
        q &&
        typeof q.q==="string" &&
        q.q.trim().length>0 &&
        Array.isArray(q.a) &&
        q.a.length===4 &&
        q.a.every(a=>typeof a==="string" && a.trim().length>0)
      );
  }

  function validDaily(daily){
    return !!daily && validQuestions(daily.questions);
  }

  function mapCloudDaily(data){
    const questions=(data?.questions||[]).map(item=>{
      const options=item.options||[];
      return {
        q:item.prompt,
        a:options.map(o=>o.text),
        optionIds:options.map(o=>o.id),
        questionVersionId:item.question_version_id,
        packPosition:item.position,
        difficulty:item.difficulty||null,
        topic:item.topic||null,
        cloudContent:true
      };
    });

    return {
      source:"supabase",
      dailyChallengeId:data.daily_challenge_id,
      challengeDate:data.challenge_date,
      dailyNumber:data.daily_number,
      generationVersion:data.generation_version,
      totalQuestions:data.total_questions,
      questions
    };
  }

  function cacheKey(date=todayKey()){
    return CACHE_PREFIX+date;
  }

  function readCachedDaily(date=todayKey()){
    try{
      const raw=localStorage.getItem(cacheKey(date));
      if(!raw) return null;

      const parsed=JSON.parse(raw);
      if(
        parsed?.challengeDate===date
        && parsed?.source==="supabase"
        && validDaily(parsed)
      ){
        return parsed;
      }
    }catch(err){}

    return null;
  }

  function writeCachedDaily(daily){
    if(!validDaily(daily) || daily.source!=="supabase") return;

    try{
      localStorage.setItem(cacheKey(daily.challengeDate||todayKey()),JSON.stringify(daily));

      // Keep a compact rolling cache. Archive mode may revisit older Dailies.
      const keys=Object.keys(localStorage)
        .filter(k=>k.startsWith(CACHE_PREFIX))
        .sort()
        .reverse();
      keys.slice(31).forEach(k=>localStorage.removeItem(k));
    }catch(err){}
  }

  function withTimeout(promise,ms=REQUEST_TIMEOUT_MS){
    return Promise.race([
      promise,
      new Promise((_,reject)=>{
        setTimeout(
          ()=>reject(new Error("Daily request timed out")),
          ms
        );
      })
    ]);
  }

  async function ensureFallbackPacks(){
    if(window.BrainiQuizPacks) return window.BrainiQuizPacks;

    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-braini-daily-fallback]');
      if(existing){
        existing.addEventListener("load",()=>resolve(window.BrainiQuizPacks),{once:true});
        existing.addEventListener("error",()=>reject(new Error("Could not load Daily fallback content.")),{once:true});
        return;
      }

      const s=document.createElement("script");
      s.dataset.brainiDailyFallback="1";
      s.src=scriptBase
        ? new URL("quiz-packs.js",scriptBase).href
        : "/assets/js/quiz-packs.js";

      s.onload=()=>{
        if(window.BrainiQuizPacks) resolve(window.BrainiQuizPacks);
        else reject(new Error("Daily fallback content loaded incorrectly."));
      };
      s.onerror=()=>reject(new Error("Could not load Daily fallback content."));
      document.head.appendChild(s);
    });
  }

  function hash(text){
    let h=2166136261;
    for(let i=0;i<String(text).length;i++){
      h^=String(text).charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function seededShuffle(items,seed){
    const out=items.slice();
    let state=hash(seed)||1;
    for(let i=out.length-1;i>0;i--){
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      const j=state%(i+1);
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  }

  async function localFallback(date=todayKey()){
    const fallback=await ensureFallbackPacks();

    const pick=(game,difficulty,count,label)=>
      seededShuffle(fallback.get(game,difficulty,"1"),`${date}:${label}`).slice(0,count);

    const pools=[
      ...pick("generalknowledge","easy",2,"gk-easy"),
      ...pick("science","easy",2,"science"),
      ...pick("history","medium",2,"history"),
      ...pick("sports","medium",1,"sports"),
      ...pick("worldcapitals","medium",1,"capitals"),
      ...pick("worldflags","medium",1,"flags"),
      ...pick("generalknowledge","hard",1,"gk-hard")
    ];

    const daily={
      source:"local",
      dailyChallengeId:null,
      challengeDate:date,
      dailyNumber:BrainiData.dailyNumberForDate?.(date)||1,
      generationVersion:0,
      totalQuestions:10,
      questions:seededShuffle(pools,`${date}:daily-order`).slice(0,10)
    };

    if(!validDaily(daily)){
      throw new Error("Local Daily fallback is incomplete.");
    }

    return daily;
  }

  async function fetchCloudToday(){
    if(!configured()) return null;

    const sb=client();
    if(!sb) return null;

    const request=sb.rpc("get_brainilab_daily_challenge");
    const {data,error}=await withTimeout(request);

    if(error) throw error;
    if(!data) throw new Error("No Daily Challenge was returned.");

    const mapped=mapCloudDaily(data);
    if(!validDaily(mapped)){
      throw new Error("Supabase returned an incomplete Daily Challenge.");
    }

    return mapped;
  }

  async function fetchCloudDate(date){
    if(!configured()) return null;

    const sb=client();
    if(!sb) return null;

    const request=sb.rpc("get_brainilab_daily_challenge_archive",{
      p_challenge_date:date
    });
    const {data,error}=await withTimeout(request);

    if(error) throw error;
    if(!data) return null;

    const mapped=mapCloudDaily(data);
    if(!validDaily(mapped)){
      throw new Error("Supabase returned an incomplete archived Daily Challenge.");
    }

    return mapped;
  }

  async function loadDate(date,options={}){
    const archiveDate=BrainiData.pastDailyDate?.(date);
    if(!archiveDate){
      throw new Error("Past Daily date is invalid or is not before today.");
    }

    const force=!!options.force;
    if(!force){
      const cached=readCachedDaily(archiveDate);
      if(cached) return cached;
    }

    lastError=null;
    try{
      const cloud=await fetchCloudDate(archiveDate);
      if(cloud){
        writeCachedDaily(cloud);
        return cloud;
      }
    }catch(err){
      lastError=err;
      console.warn(
        "BrainiLab archived Daily unavailable in cloud; using deterministic local fallback:",
        err.message||err
      );
    }

    return localFallback(archiveDate);
  }

  async function loadToday(options={}){
    const force=!!options.force;

    if(!force && cachedToday && validDaily(cachedToday)){
      return cachedToday;
    }

    if(!force && inFlight){
      return inFlight;
    }

    inFlight=(async()=>{
      lastError=null;

      try{
        const cloud=await fetchCloudToday();

        if(cloud){
          cachedToday=cloud;
          writeCachedDaily(cloud);
          await BrainiData.api.syncDailyChallengeMeta(cloud);
          return cloud;
        }
      }catch(err){
        lastError=err;
        console.warn(
          "BrainiLab Daily cloud challenge unavailable; using resilient fallback:",
          err.message||err
        );
      }

      try{
        const fallback=await localFallback(todayKey());
        cachedToday=fallback;
        return fallback;
      }catch(fallbackError){
        console.error("BrainiLab Daily local fallback failed:",fallbackError);

        // Last resort: a cached real Daily is better than a collapsed/empty box.
        const stored=readCachedDaily(todayKey());
        if(stored && validDaily(stored)){
          cachedToday=stored;
          return stored;
        }

        throw fallbackError;
      }
    })();

    try{
      return await inFlight;
    }finally{
      inFlight=null;
    }
  }

  async function retryToday(){
    cachedToday=null;
    return loadToday({force:true});
  }

  function verificationPayload(answerDetails=[]){
    return answerDetails.map(item=>({
      question_version_id:item.questionVersionId,
      selected_option_id:item.selectedOptionId||null,
      response_time_ms:Number.isFinite(Number(item.responseTimeMs))
        ? Math.max(0,Math.round(Number(item.responseTimeMs)))
        : null
    }));
  }

  async function verifyDailyResult(result,daily,answerDetails=[]){
    if(!configured()) return {verified:false,reason:"not_configured"};
    if(!result?.clientResultId || !daily?.dailyChallengeId){
      return {verified:false,reason:"missing_ids"};
    }

    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:false,reason:"not_authenticated"};
    if(result.cloudSyncStatus!=="synced"){
      return {verified:false,reason:"result_not_synced"};
    }
    if(!Array.isArray(answerDetails) || answerDetails.length!==10){
      return {verified:false,reason:"incomplete_answers"};
    }

    const sb=client();
    const {data,error}=await sb.rpc("verify_brainilab_daily_result",{
      p_client_result_id:result.clientResultId,
      p_daily_challenge_id:daily.dailyChallengeId,
      p_answers:verificationPayload(answerDetails)
    });

    if(error) throw error;

    // Step 11: record question-level analytics only after the canonical
    // correctness verification has succeeded. This analytics write is
    // deliberately non-blocking for the player's result.
    try{
      await sb.rpc("record_brainilab_verified_question_answers",{
        p_client_result_id:result.clientResultId,
        p_context_type:"daily",
        p_context_id:daily.dailyChallengeId,
        p_answers:verificationPayload(answerDetails)
      });
    }catch(analyticsError){
      console.warn(
        "BrainiLab question analytics:",
        analyticsError?.message||analyticsError
      );
    }

    await BrainiData.api.markResultDailyVerified(result.clientResultId,data||{});

    window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
      detail:{
        type:"daily_answers_verified",
        clientResultId:result.clientResultId,
        verification:data
      }
    }));

    return {verified:true,...(data||{})};
  }

  async function syncPendingVerifications(){
    if(!configured()) return {verified:0,failed:0};

    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:0,failed:0};

    const pending=await BrainiData.api.getPendingDailyVerifications();
    let verified=0;
    let failed=0;

    for(const result of pending){
      try{
        const daily={
          dailyChallengeId:result.dailyChallengeId,
          dailyNumber:result.dailyNumber
        };
        const response=await verifyDailyResult(
          result,
          daily,
          result.answerDetails
        );
        if(response.verified) verified++;
      }catch(err){
        failed++;
        lastError=err;
        console.warn("BrainiLab pending Daily verification:",err.message||err);
      }
    }

    return {verified,failed};
  }

  function getCached(){
    return cachedToday;
  }

  function getLastError(){
    return lastError;
  }

  return {
    configured,
    loadToday,
    loadDate,
    retryToday,
    verifyDailyResult,
    syncPendingVerifications,
    getCached,
    getLastError,
    validDaily
  };
})();
