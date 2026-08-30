/*
  BrainiLab Cloud Content — Step 4 backend
  ----------------------------------------
  Loads finite 20-question packs from PostgreSQL through controlled RPCs.

  Initial pack payload contains:
  - question version ID
  - prompt
  - option IDs + text

  It does NOT contain:
  - correct option
  - explanation

  Correctness is requested only after the player answers/skips.
*/
window.BrainiContent = (function(){
  const TOPIC_SLUGS={
    generalknowledge:"general-knowledge",
    science:"science",
    history:"history",
    sports:"sports",
    worldcapitals:"world-capitals",
    worldflags:"world-flags"
  };

  const scriptBase=(function(){
    const src=document.currentScript?.src;
    return src ? new URL("./",src) : null;
  })();

  let fallbackLoading=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  function slugFor(topicKey){
    return TOPIC_SLUGS[topicKey] || topicKey;
  }

  async function ensureFallbackPacks(){
    if(window.BrainiQuizPacks) return window.BrainiQuizPacks;
    if(fallbackLoading) return fallbackLoading;

    fallbackLoading=new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src=scriptBase
        ? new URL("quiz-packs.js",scriptBase).href
        : "assets/js/quiz-packs.js";
      s.onload=()=>resolve(window.BrainiQuizPacks);
      s.onerror=()=>reject(new Error("Could not load local quiz fallback."));
      document.head.appendChild(s);
    });

    return fallbackLoading;
  }

  function normalizeDifficulty(value){
    const d=(value||"easy").toLowerCase();
    return ["easy","medium","hard"].includes(d)?d:"easy";
  }

  function anytimeHistoryScope(topicKey,difficulty){
    return `quiz:${String(topicKey||"").toLowerCase()}:${normalizeDifficulty(difficulty)}`;
  }

  function localPlayedQuestionIds(topicKey,difficulty){
    const scope=anytimeHistoryScope(topicKey,difficulty);
    try{
      return (window.BrainiData?.anytimePlayedIds?.(scope)||[])
        .filter(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        .slice(0,1000);
    }catch(err){
      return [];
    }
  }

  function recordAnytimeHistory(pack,answerDetails=[]){
    if(!pack || pack.selectionMode!=="history_aware") return {};
    const ids=(answerDetails||[])
      .map(answer=>String(answer?.questionVersionId||""))
      .filter(Boolean);
    if(!ids.length) return {};
    try{
      return window.BrainiData?.recordAnytimeHistory?.(
        anytimeHistoryScope(pack.topicKey,pack.difficulty),
        ids
      )||{};
    }catch(err){
      console.warn("BrainiLab local Play Anytime history:",err?.message||err);
      return {};
    }
  }

  function mapAnytimePack(data,topicKey,difficulty){
    const questions=(data?.questions||[]).map(item=>{
      const options=item.options||[];
      return {
        q:item.prompt,
        a:options.map(o=>o.text),
        optionIds:options.map(o=>o.id),
        questionVersionId:item.question_version_id,
        cloudContent:true
      };
    });

    return {
      source:"supabase",
      selectionMode:"history_aware",
      topicKey,
      topicSlug:slugFor(topicKey),
      topicId:data?.topic_id||null,
      packId:null,
      externalKey:null,
      title:data?.title||null,
      difficulty,
      setNumber:1,
      version:1,
      totalQuestions:questions.length,
      questions
    };
  }

  function mapCloudPack(data,topicKey){
    const questions=(data?.questions||[]).map(item=>{
      const options=item.options||[];
      return {
        q:item.prompt,
        a:options.map(o=>o.text),
        optionIds:options.map(o=>o.id),
        questionVersionId:item.question_version_id,
        packPosition:item.position,
        cloudContent:true
      };
    });

    return {
      source:"supabase",
      topicKey,
      topicSlug:slugFor(topicKey),
      packId:data.pack_id,
      externalKey:data.external_key,
      title:data.title,
      difficulty:data.difficulty,
      setNumber:data.set_number,
      version:data.version,
      totalQuestions:data.total_questions,
      questions
    };
  }

  async function loadQuizPack(topicKey,difficulty="easy",setNumber=1){
    difficulty=normalizeDifficulty(difficulty);
    setNumber=Math.max(1,parseInt(setNumber,10)||1);

    if(configured()){
      const sb=client();

      // V41.4: Play Anytime is history-aware. The selector prioritises the
      // least-played published questions for this user/device, so a question
      // does not repeat until the available pool has been cycled through.
      try{
        const {data,error}=await sb.rpc("get_brainilab_anytime_quiz",{
          p_topic_slug:slugFor(topicKey),
          p_difficulty:difficulty,
          p_limit:20,
          p_exclude_question_ids:localPlayedQuestionIds(topicKey,difficulty)
        });
        if(error) throw error;
        if(data?.questions?.length===20){
          return mapAnytimePack(data,topicKey,difficulty);
        }
      }catch(err){
        console.warn("BrainiLab history-aware quiz selector unavailable; trying the fixed cloud pack:",err.message||err);
      }

      // Backwards-compatible cloud fallback if Step 22 has not been installed.
      try{
        const {data,error}=await sb.rpc("get_brainilab_quiz_pack",{
          p_topic_slug:slugFor(topicKey),
          p_difficulty:difficulty,
          p_set_number:setNumber
        });
        if(error) throw error;
        if(data?.questions?.length===20){
          return mapCloudPack(data,topicKey);
        }
      }catch(err){
        console.warn("BrainiLab cloud question pack unavailable; using local fallback:",err.message||err);
      }
    }

    const fallback=await ensureFallbackPacks();
    const questions=fallback.get(topicKey,difficulty,String(setNumber));

    return {
      source:"local",
      selectionMode:"fixed_local",
      topicKey,
      topicSlug:slugFor(topicKey),
      packId:null,
      externalKey:null,
      title:null,
      difficulty,
      setNumber,
      version:1,
      totalQuestions:questions.length,
      questions
    };
  }

  async function checkAnswer(item,choice,context={}){
    if(!item?.cloudContent){
      throw new Error("Cloud answer check requires a cloud question.");
    }

    const sb=client();
    if(!sb) throw new Error("Supabase content client unavailable.");

    const selectedOptionId=choice===null || choice===undefined
      ? null
      : item.optionIds?.[choice]||null;

    const {data,error}=await sb.rpc("check_brainilab_quiz_answer",{
      p_question_version_id:item.questionVersionId,
      p_selected_option_id:selectedOptionId
    });

    if(error) throw error;

    const correctIndex=item.optionIds.indexOf(data.correct_option_id);

    return {
      isCorrect:!!data.is_correct,
      correctOptionId:data.correct_option_id,
      correctIndex,
      correctAnswer:data.correct_answer,
      selectedAnswer:data.selected_answer,
      explanation:data.explanation,
      responseTimeMs:context.responseTimeMs||null
    };
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

  async function verifyQuizResult(result,pack,answerDetails=[]){
    if(!configured()) return {verified:false,reason:"not_configured"};
    if(!result?.clientResultId) return {verified:false,reason:"missing_result_id"};

    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:false,reason:"not_authenticated"};
    if(result.cloudSyncStatus!=="synced") return {verified:false,reason:"result_not_synced"};
    if(!Array.isArray(answerDetails) || !answerDetails.length){
      return {verified:false,reason:"incomplete_answers"};
    }

    const sb=client();
    let data;

    if(pack?.selectionMode==="history_aware"){
      const response=await sb.rpc("verify_brainilab_anytime_quiz_result",{
        p_client_result_id:result.clientResultId,
        p_topic_slug:pack.topicSlug,
        p_difficulty:pack.difficulty,
        p_answers:verificationPayload(answerDetails)
      });
      if(response.error) throw response.error;
      data=response.data;
    }else{
      if(!pack?.packId) return {verified:false,reason:"missing_pack_id"};
      const response=await sb.rpc("verify_brainilab_quiz_result",{
        p_client_result_id:result.clientResultId,
        p_quiz_pack_id:pack.packId,
        p_answers:verificationPayload(answerDetails)
      });
      if(response.error) throw response.error;
      data=response.data;

      // Fixed packs keep the Step 11 analytics recorder. History-aware packs
      // are recorded atomically by verify_brainilab_anytime_quiz_result.
      try{
        await sb.rpc("record_brainilab_verified_question_answers",{
          p_client_result_id:result.clientResultId,
          p_context_type:"quiz_pack",
          p_context_id:pack.packId,
          p_answers:verificationPayload(answerDetails)
        });
      }catch(analyticsError){
        console.warn("BrainiLab question analytics:",analyticsError?.message||analyticsError);
      }
    }

    await BrainiData.api.markResultAnswerVerified(result.clientResultId,data||{});

    window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
      detail:{type:"answers_verified",clientResultId:result.clientResultId,verification:data}
    }));

    return {verified:true,...(data||{})};
  }

  async function syncPendingVerifications(){
    if(!configured()) return {verified:0,failed:0};

    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:0,failed:0};

    const pending=await BrainiData.api.getPendingAnswerVerifications();
    let verified=0;
    let failed=0;

    for(const result of pending){
      try{
        const pack=result.quizPackId
          ? {packId:result.quizPackId,selectionMode:"fixed_pack"}
          : {
              selectionMode:"history_aware",
              topicKey:result.gameId,
              topicSlug:slugFor(result.gameId),
              difficulty:normalizeDifficulty(result.difficulty||"easy")
            };
        const response=await verifyQuizResult(result,pack,result.answerDetails);
        if(response.verified) verified++;
      }catch(err){
        failed++;
        console.warn("BrainiLab pending answer verification:",err.message||err);
      }
    }

    return {verified,failed};
  }

  function reviewMarkup(answerDetails=[]){
    return answerDetails.map((item,i)=>{
      const safeQuestion=item.questionText||"";
      return `<article class="qa">
        <h3>${i+1}. ${safeQuestion}</h3>
        <p><strong>${item.correctAnswer||""}.</strong> ${item.explanation||""}</p>
      </article>`;
    }).join("");
  }

  return {
    configured,
    slugFor,
    normalizeDifficulty,
    loadQuizPack,
    checkAnswer,
    recordAnytimeHistory,
    verifyQuizResult,
    syncPendingVerifications,
    reviewMarkup
  };
})();
