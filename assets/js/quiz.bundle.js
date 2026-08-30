/* ===== share.js ===== */


/*
 BrainiLab Share Layer
 ---------------------
 Shared modal + text/image generation for all game types.
 Depends on BrainiData.
*/
window.BrainiShare = (function(){
  let modal;

  function bindEscCloser(node){
    if(node.__escBound) return;
    node.__escBound = true;
    node.addEventListener("keydown", e=>{
      if(e.key === "Escape"){
        node.classList.remove("show");
      }
    });
  }

  function ensureModal(){
    if(modal) return modal;
    modal=document.createElement("div");
    modal.className="share-modal";
    modal.tabIndex=-1;
    modal.innerHTML=`
      <div class="share-sheet share-sheet-compact" role="dialog" aria-modal="true" aria-label="Share result">
        <button class="share-close" type="button" aria-label="Close share options">×</button>
        <div class="share-preview" data-share-preview></div>
        <div class="share-icon-actions" aria-label="Share result options">
          <button class="share-icon-btn whatsapp" data-channel="whatsapp" type="button" aria-label="Share on WhatsApp" title="WhatsApp">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.5-1.7a11.8 11.8 0 0 0 5.4 1.4h.1c6.5 0 11.8-5.3 11.8-11.8 0-3.1-1.2-6-3.5-8.4Zm-8.4 18.2h-.1a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.9 1 1-3.8-.2-.4a9.8 9.8 0 1 1 8.6 4.8Zm5.4-7.3c-.3-.1-1.8-.9-2.1-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5 0-.2-.7-1.8-1-2.4-.3-.7-.6-.6-.8-.6h-.7c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.3 3.4 1.5 3.6c.2.2 2.5 3.8 6 5.3.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4Z"/></svg>
          </button>
          <button class="share-icon-btn telegram" data-channel="telegram" type="button" aria-label="Share on Telegram" title="Telegram">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22.9 2.3 19.5 21c-.3 1.3-1 1.6-2 1l-5.2-3.8-2.5 2.4c-.3.3-.5.5-1 .5l.4-5.3 9.6-8.7c.4-.4-.1-.6-.6-.2L6.3 14.4 1.2 12.8c-1.1-.3-1.1-1.1.2-1.6L21.3 1.5c.9-.3 1.8.2 1.6.8Z"/></svg>
          </button>
          <button class="share-icon-btn x" data-channel="x" type="button" aria-label="Share on X" title="X">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.2 2H22l-8.3 9.5L23.5 22h-7.7l-6-7.8L3 22H-.8l8.9-10.2L-1.3 2h7.9l5.4 7.1L18.2 2Zm-1.4 18h2.1L5.4 3.9H3.1L16.8 20Z"/></svg>
          </button>
          <button class="share-icon-btn facebook" data-channel="facebook" type="button" aria-label="Share on Facebook" title="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.1C24 5.4 18.6 0 12 0S0 5.4 0 12.1c0 6 4.4 11 10.1 11.9v-8.4H7.1v-3.5h3V9.5c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5h-2.9V24C19.6 23.1 24 18.1 24 12.1Z"/></svg>
          </button>
          <button class="share-icon-btn copy" data-action="copy" type="button" aria-label="Copy result" title="Copy result">
            ${BrainiIcons.product("copy-result","share-system-icon")}
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector(".share-close").onclick=()=>modal.classList.remove("show");
    modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("show")});
    bindEscCloser(modal);
    return modal;
  }

  function emojiGrid(result){
    if(result.gameId==="topicrush") return "";
    if(result.gameId==="brainiword"){
      if(Array.isArray(result.evaluations)){
        return result.evaluations.map(row=>row.map(s=>s==="correct"?"🟩":s==="present"?"🟨":"⬛").join("")).join("\n");
      }
      if(Array.isArray(result.pattern)){
        const rows=[];
        for(let i=0;i<result.pattern.length;i+=5){
          rows.push(result.pattern.slice(i,i+5).map(s=>s==="correct"?"🟩":s==="present"?"🟨":"⬛").join(""));
        }
        return rows.join("\n");
      }
    }
    if(Number.isFinite(result.correct) && Number.isFinite(result.total) && result.total<=20){
      const cells=[];
      for(let i=0;i<result.total;i++) cells.push(i<result.correct?"🟩":"🟥");
      const rows=[];
      for(let i=0;i<cells.length;i+=5) rows.push(cells.slice(i,i+5).join(""));
      return rows.join("\n");
    }
    return "";
  }

  function resultHeadline(gameId,result){
    if(gameId==="brainiword") return result.won ? `${result.attempts}/5` : "X/5";
    if(gameId==="flagdash") return `${result.correct||0} flags`;
    if(gameId==="orderup") return `${Number(result.score||0).toLocaleString()} / 2,500`;
    if(gameId==="topicrush") return `${result.correct||0} answers`;
    if(gameId==="connections") return `${Number(result.score||0).toLocaleString()} / 3,000`;
    if(gameId==="maphunt") return `${(result.score||0).toLocaleString()} pts`;
    if(Number.isFinite(result.correct)&&Number.isFinite(result.total)) return `${result.correct}/${result.total}`;
    if(Number.isFinite(result.score)) return `${result.score.toLocaleString()} pts`;
    return "Completed";
  }

  function extraLines(gameId,result){
    const lines=[];
    if(gameId==="flagdash"){
      if(result.accuracy!=null) lines.push(`${result.accuracy}% accuracy`);
      if(result.bestCombo!=null) lines.push(`🔥 Best combo: ${result.bestCombo}`);
    } else if(gameId==="orderup"){
      if(result.accuracy!=null) lines.push(`${Math.round(Number(result.accuracy))}% order accuracy`);
      if(result.correct!=null) lines.push(`${Number(result.correct)} / 20 exact positions`);
    } else if(gameId==="topicrush"){
      if(result.topicTitle) lines.push(result.topicTitle);
      if(result.score!=null) lines.push(`${Number(result.score).toLocaleString()} Daily points`);
    } else if(gameId==="connections"){
      if(result.attempts!=null) lines.push(`${Number(result.attempts)} total attempts`);
      if(result.score!=null) lines.push(`${Number(result.score).toLocaleString()} Connections points`);
    } else if(gameId==="maphunt"){
      if(result.avgDistanceKm!=null) lines.push(`Average distance: ${result.avgDistanceKm} km`);
      if(result.accuracy!=null) lines.push(`${result.accuracy}% accuracy`);
    } else if(gameId!=="brainiword"){
      if(result.accuracy!=null) lines.push(`${result.accuracy}% accuracy`);
      if(result.score!=null && Number.isFinite(result.correct)) lines.push(`${result.score.toLocaleString()} pts`);
    }
    if(result.percentile!=null) lines.push(`🏆 Top ${result.percentile}%`);
    if(result.streakAfter!=null) lines.push(`🔥 ${result.streakAfter} day streak`);
    return lines;
  }

  async function buildText(gameId,result,channel="native"){
    const def=BrainiData.game(gameId);
    const daily=result.dailyNumber ? ` #${result.dailyNumber}` : "";
    const url=await BrainiData.api.getShareUrl(gameId,channel);
    const grid=emojiGrid(result);
    const parts=[
      `${def?.name||"BrainiLab"}${daily} ${def?.icon||"🧠"}`,
      "",
      resultHeadline(gameId,result)
    ];
    const extras=extraLines(gameId,result);
    if(extras.length) parts.push(...extras);
    if(grid) parts.push("",grid);
    parts.push("","Can you beat me?",url);
    return parts.join("\n");
  }

  function previewHtml(gameId,result){
    const def=BrainiData.game(gameId);
    const daily=result.dailyNumber ? ` #${result.dailyNumber}` : "";
    const grid=emojiGrid(result);
    const extras=extraLines(gameId,result).map(x=>`<div>${x}</div>`).join("");
    return `
      <div class="share-card">
        <div class="share-card-brand">BrainiLab</div>
        <div class="share-card-game">${def?.icon||"🧠"} ${def?.name||"Game"}${daily}</div>
        <div class="share-card-score">${resultHeadline(gameId,result)}</div>
        <div class="share-card-extra">${extras}</div>
        ${grid?`<pre class="share-card-grid">${grid}</pre>`:""}
        <div class="share-card-cta">Can you beat me?</div>
      </div>`;
  }

  function canvasCard(gameId,result,format="square"){
    const w=1080;
    const h=format==="story"?1920:1080;
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    const ctx=c.getContext("2d");
    const navy="#2D296E", yellow="#FFD813", green="#40AB34", white="#FFFFFF", muted="#D9D7F4";
    ctx.fillStyle=navy;ctx.fillRect(0,0,w,h);

    const colors=["#E6680C","#FFD813","#E52720","#40AB34","#2D296E"];
    colors.forEach((col,i)=>{ctx.fillStyle=col;ctx.fillRect(i*w/5,0,w/5,18)});

    ctx.textAlign="center";
    ctx.fillStyle=white;ctx.font="900 54px Montserrat, Arial";
    ctx.fillText("BrainiLab",w/2,format==="story"?260:150);

    const def=BrainiData.game(gameId);
    ctx.font="800 42px Montserrat, Arial";ctx.fillStyle=muted;
    ctx.fillText(`${def?.name||"Game"}${result.dailyNumber?" #"+result.dailyNumber:""}`,w/2,format==="story"?365:250);

    ctx.fillStyle=yellow;ctx.font="900 118px Montserrat, Arial";
    ctx.fillText(resultHeadline(gameId,result),w/2,format==="story"?650:475);

    let y=format==="story"?770:585;
    ctx.fillStyle=white;ctx.font="800 35px Montserrat, Arial";
    extraLines(gameId,result).forEach(line=>{ctx.fillText(line.replace(/[🏆🔥]/g,""),w/2,y);y+=55});

    const grid=emojiGrid(result);
    if(grid){
      y+=35;
      ctx.font="44px Arial";
      grid.split("\n").forEach(row=>{ctx.fillText(row,w/2,y);y+=62});
    }

    ctx.fillStyle=white;ctx.font="900 38px Montserrat, Arial";
    ctx.fillText("CAN YOU BEAT ME?",w/2,format==="story"?1680:930);
    ctx.fillStyle=green;ctx.fillRect(w/2-190,(format==="story"?1735:965),380,8);
    return c;
  }

  async function nativeShare(gameId,result){
    const text=await buildText(gameId,result,"native");
    if(navigator.share){
      try{
        await navigator.share({title:"BrainiLab result",text});
        await BrainiData.api.recordShare(gameId,"native",{resultId:result.id});
        return true;
      }catch(e){}
    }
    return false;
  }

  async function copyResult(gameId,result){
    const text=await buildText(gameId,result,"copy");
    try{
      await navigator.clipboard.writeText(text);
      showToast("Result copied");
      await BrainiData.api.recordShare(gameId,"copy",{resultId:result.id});
      return true;
    }catch(e){
      showToast("Copy failed");
      return false;
    }
  }

  async function copyLink(gameId,result){
    const url=await BrainiData.api.getShareUrl(gameId,"copy_link");
    try{
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
      await BrainiData.api.recordShare(gameId,"copy_link",{resultId:result?.id});
      return true;
    }catch(e){
      showToast("Copy failed");
      return false;
    }
  }

  async function shareImage(gameId,result){
    const c=canvasCard(gameId,result,window.innerHeight>window.innerWidth?"story":"square");
    const blob=await new Promise(r=>c.toBlob(r,"image/png",.95));
    const file=new File([blob],`brainilab-${gameId}-result.png`,{type:"image/png"});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file],title:"BrainiLab result"});
        await BrainiData.api.recordShare(gameId,"image",{resultId:result.id});
        return true;
      }catch(e){}
    }
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=file.name;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
    await BrainiData.api.recordShare(gameId,"image_download",{resultId:result.id});
    showToast("Image downloaded");
    return true;
  }

  async function channelShare(channel,gameId,result){
    const text=await buildText(gameId,result,channel);
    const url=await BrainiData.api.getShareUrl(gameId,channel);
    const encText=encodeURIComponent(text);
    const encUrl=encodeURIComponent(url);
    let href="";
    if(channel==="whatsapp") href=`https://wa.me/?text=${encText}`;
    if(channel==="telegram") href=`https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent(text.replace(url,"").trim())}`;
    if(channel==="x") href=`https://twitter.com/intent/tweet?text=${encText}`;
    if(channel==="facebook") href=`https://www.facebook.com/sharer/sharer.php?u=${encUrl}`;
    if(href) window.open(href,"_blank","noopener,noreferrer");
    await BrainiData.api.recordShare(gameId,channel,{resultId:result.id});
    return true;
  }

  async function open(gameId,result){
    const m=ensureModal();
    m.querySelector("[data-share-preview]").innerHTML=previewHtml(gameId,result);
    m.classList.add("show");
    m.focus();

    const copy=m.querySelector("[data-action='copy']");

    copy.onclick=()=>copyResult(gameId,result);
    m.querySelectorAll("[data-channel]").forEach(
      b=>b.onclick=()=>channelShare(b.dataset.channel,gameId,result)
    );
  }

  return {
    open, buildText, canvasCard,
    nativeShare, copyResult, copyLink, shareImage, channelShare
  };
})();

/* ===== supabase-content.js ===== */

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

/* ===== quiz.js ===== */


window.BrainiQuiz = (function(){
  function inferGameId(){
    const p=location.pathname.toLowerCase();
    if(p.includes("/games/brain-mix/")) return "brainmix";
    if(p.includes("world-flags")) return "worldflags";
    if(p.includes("world-capitals")) return "worldcapitals";
    if(p.includes("/science/")) return "science";
    if(p.includes("/history/")) return "history";
    if(p.includes("/sports/")) return "sports";
    if(p.includes("general-knowledge")) return "generalknowledge";
    return "quiz";
  }

  function mount(el, questions, opts={}){
    let index=0, correct=0, points=0, locked=false, readyForNext=false, renderToken=0, results=[], answerDetails=[], started=performance.now(), completed=false, questionStarted=performance.now();
    const healthIds=(questions||[]).map(x=>x.questionVersionId||x.questionId).filter(Boolean);
    const healthTracker=window.BrainiContentHealth&&healthIds.length
      ? BrainiContentHealth.create({gameId:opts.gameId||inferGameId(),contentType:"question",contentIds:healthIds,dailyNumber:opts.dailyNumber??null})
      : null;

    const q=el.querySelector("[data-q]");
    const answers=el.querySelector("[data-answers]");
    const feedback=el.querySelector("[data-feedback]");
    const pointsEl=el.querySelector("[data-points]");
    const next=el.querySelector("[data-next]");
    const skip=el.querySelector("[data-skip]");
    const label=el.querySelector("[data-label]");
    const count=el.querySelector("[data-count]");
    const score=el.querySelector("[data-score]");
    const bar=el.querySelector("[data-bar]");
    const timer=el.querySelector("[data-timer]");

    const fmt=(ms)=>{
      const s=Math.floor(ms/1000);
      return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
    };

    if(timer){
      setInterval(()=>timer.textContent=fmt(performance.now()-started),300);
    }

    function render(){
      renderToken++;
      locked=false;
      readyForNext=false;
      questionStarted=performance.now();

      // Never carry keyboard focus from an old answer into the next question.
      if(document.activeElement instanceof HTMLElement){
        document.activeElement.blur();
      }

      pointsEl?.classList.remove("show");
      if(pointsEl) pointsEl.textContent="";
      if(feedback) feedback.innerHTML="";
      if(next){
        next.hidden=true;
        next.textContent=index===questions.length-1
          ? "See result"
          : "Next question";
      }

      const item=questions[index];
      healthTracker?.checkpoint(index+1);
      q.innerHTML="";
      const number=document.createElement("span");
      number.className="question-number";
      number.textContent=`${index+1}.`;
      q.append(number);

      const questionText=String(item.q||"");
      const flagMatch=questionText.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
      if(flagMatch){
        const flag=flagMatch[0];
        const code=Array.from(flag)
          .map(ch=>String.fromCharCode(ch.codePointAt(0)-0x1F1E6+65))
          .join("")
          .toLowerCase();
        const cleanText=(questionText.slice(0,flagMatch.index)+questionText.slice(flagMatch.index+flag.length))
          .replace(/\s+/g," ")
          .trim();

        const flagImg=document.createElement("img");
        flagImg.className="question-flag-emoji";
        flagImg.src=window.BrainiIcons?.flagEmojiAsset
          ? BrainiIcons.flagEmojiAsset(code)
          : `../../assets/flags/emoji/${code}.png`;
        flagImg.alt=flag;
        flagImg.decoding="async";
        flagImg.addEventListener("error",()=>{
          const fallback=document.createElement("span");
          fallback.className="question-flag-text";
          fallback.textContent=flag;
          flagImg.replaceWith(fallback);
        },{once:true});

        q.append(document.createTextNode(" "),flagImg,document.createTextNode(" "+cleanText));
      }else{
        q.append(document.createTextNode(" "+questionText));
      }
      q.classList.toggle("is-long",questionText.length>68 && questionText.length<=108);
      q.classList.toggle("is-very-long",questionText.length>108);

      if(label) label.textContent=`Question ${index+1} of ${questions.length}`;
      if(count) count.textContent=`${index+1} / ${questions.length}`;
      if(score) score.textContent=points.toLocaleString()+" pts";
      if(bar) bar.style.width=((index+1)/questions.length*100)+"%";

      answers.innerHTML="";
      item.a.forEach((txt,i)=>{
        const b=document.createElement("button");
        const buttonToken=renderToken;
        const buttonQuestionIndex=index;

        b.type="button";
        b.className="answer";
        b.innerHTML=`<span class="key">${i+1}</span><span>${txt}</span>`;
        b.addEventListener("click",e=>{
          e.currentTarget.blur();

          // Ignore a delayed/default click from a button belonging to the
          // previous question.
          if(
            buttonToken!==renderToken ||
            buttonQuestionIndex!==index ||
            !b.isConnected
          ){
            return;
          }

          choose(i,b);
        });
        answers.appendChild(b);
      });
    }

    function localEvaluation(item,choice,responseTimeMs,skipped=false){
      const correctIndex=item.c;
      const isCorrect=!skipped && choice===correctIndex;
      return {
        isCorrect,
        correctIndex,
        correctAnswer:item.a[correctIndex],
        selectedAnswer:choice===null?null:item.a[choice],
        explanation:item.f||"",
        responseTimeMs
      };
    }

    async function evaluate(item,choice,responseTimeMs,skipped=false){
      if(typeof opts.checkAnswer==="function"){
        return opts.checkAnswer(item,choice,{
          responseTimeMs,
          skipped,
          position:index+1
        });
      }
      return localEvaluation(item,choice,responseTimeMs,skipped);
    }

    function showChecking(){
      if(feedback){
        feedback.innerHTML=`<span class="quiz-checking">Checking answer…</span>`;
      }
    }

    function enableAnswers(){
      [...answers.children].forEach(b=>b.disabled=false);
    }

    async function choose(choice,button){
      if(locked) return;
      locked=true;
      readyForNext=false;

      const questionIndex=index;
      const questionToken=renderToken;
      const item=questions[index];
      const responseTimeMs=Math.max(0,Math.round(performance.now()-questionStarted));

      [...answers.children].forEach(b=>b.disabled=true);
      showChecking();

      let evaluation;
      try{
        evaluation=await evaluate(item,choice,responseTimeMs,false);
      }catch(err){
        locked=false;
        enableAnswers();
        if(feedback){
          feedback.innerHTML=`<span class="quiz-check-error">Could not check that answer. Please try again.</span>`;
        }
        console.warn("BrainiQuiz answer check:",err);
        return;
      }

      // If navigation happened while the answer RPC was in flight,
      // this response belongs to an old question and must not paint the new DOM.
      if(questionIndex!==index || questionToken!==renderToken){
        return;
      }

      const correctIndex=Number.isInteger(evaluation.correctIndex)
        ? evaluation.correctIndex
        : item.optionIds && evaluation.correctOptionId
          ? item.optionIds.indexOf(evaluation.correctOptionId)
          : item.c;

      [...answers.children].forEach((b,i)=>{
        b.disabled=true;
        if(i===correctIndex) b.classList.add("correct");
      });

      const isCorrect=!!evaluation.isCorrect;
      let gained=0;

      if(isCorrect){
        correct++;
        results.push(true);
        gained=500+Math.max(80,Math.round(300-((performance.now()-started)/1000%25)*8));
        points+=gained;

        const correctAnswer=evaluation.correctAnswer || item.a[correctIndex] || item.a[choice];
        feedback.innerHTML=`✓ <strong>${correctAnswer}</strong><small>${evaluation.explanation||item.f||""}</small>`;

        if(pointsEl){
          pointsEl.textContent="+"+gained;
          pointsEl.classList.add("show");
        }
      }else{
        results.push(false);
        button.classList.add("wrong");

        const selectedAnswer=evaluation.selectedAnswer || item.a[choice] || "";
        const correctAnswer=evaluation.correctAnswer || item.a[correctIndex] || "";

        feedback.innerHTML=`✕ <strong>${selectedAnswer}</strong><small>Correct answer: ${correctAnswer}. ${evaluation.explanation||item.f||""}</small>`;
      }

      answerDetails.push({
        position:index+1,
        questionId:item.questionId||item.questionVersionId||null,
        questionVersionId:item.questionVersionId||null,
        questionText:item.q,
        selectedOptionId:item.optionIds?.[choice]||null,
        correctOptionId:evaluation.correctOptionId||item.optionIds?.[correctIndex]||null,
        selectedAnswer:evaluation.selectedAnswer||item.a[choice]||null,
        correctAnswer:evaluation.correctAnswer||item.a[correctIndex]||null,
        explanation:evaluation.explanation||item.f||"",
        responseTimeMs,
        isCorrect,
        pointsAwarded:gained
      });

      if(score) score.textContent=points.toLocaleString()+" pts";
      readyForNext=true;
      if(next) next.hidden=false;
    }

    async function doSkip(){
      if(locked) return;
      locked=true;
      readyForNext=false;

      const questionIndex=index;
      const questionToken=renderToken;
      const item=questions[index];
      const responseTimeMs=Math.max(0,Math.round(performance.now()-questionStarted));
      [...answers.children].forEach(b=>b.disabled=true);
      showChecking();

      let evaluation;
      try{
        evaluation=await evaluate(item,null,responseTimeMs,true);
      }catch(err){
        locked=false;
        enableAnswers();
        if(feedback){
          feedback.innerHTML=`<span class="quiz-check-error">Could not skip this question right now. Please try again.</span>`;
        }
        console.warn("BrainiQuiz skip check:",err);
        return;
      }

      if(questionIndex!==index || questionToken!==renderToken){
        return;
      }

      const correctIndex=Number.isInteger(evaluation.correctIndex)
        ? evaluation.correctIndex
        : item.optionIds && evaluation.correctOptionId
          ? item.optionIds.indexOf(evaluation.correctOptionId)
          : item.c;

      results.push(false);

      [...answers.children].forEach((b,i)=>{
        b.disabled=true;
        if(i===correctIndex) b.classList.add("correct");
      });

      const correctAnswer=evaluation.correctAnswer || item.a[correctIndex] || "";
      feedback.innerHTML=`Skipped<small>Correct answer: ${correctAnswer}. ${evaluation.explanation||item.f||""}</small>`;

      answerDetails.push({
        position:index+1,
        questionId:item.questionId||item.questionVersionId||null,
        questionVersionId:item.questionVersionId||null,
        questionText:item.q,
        selectedOptionId:null,
        correctOptionId:evaluation.correctOptionId||item.optionIds?.[correctIndex]||null,
        selectedAnswer:null,
        correctAnswer,
        explanation:evaluation.explanation||item.f||"",
        responseTimeMs,
        isCorrect:false,
        skipped:true,
        pointsAwarded:0
      });

      readyForNext=true;
      if(next) next.hidden=false;
    }

    function advance(){
      if(completed || !readyForNext) return;

      // Consume the advance state immediately so one key press/click can never
      // advance twice.
      readyForNext=false;

      if(index<questions.length-1){
        index++;
        render();
      }else if(opts.onComplete){
        completed=true;
        healthTracker?.complete(answerDetails.map((a,i)=>({
          contentId:a.questionVersionId||a.questionId||healthIds[i],
          position:a.position||i+1,
          attempts:1,
          isCorrect:!!a.isCorrect,
          skipped:!!a.skipped,
          score:a.pointsAwarded||0,
          responseTimeMs:a.responseTimeMs
        })));
        opts.onComplete({
          correct,
          total:questions.length,
          points,
          results,
          answerDetails,
          timeSec:Math.round((performance.now()-started)/1000)
        });
      }
    }

    next?.addEventListener("click",advance);
    skip?.addEventListener("click",doSkip);

    document.addEventListener("keydown",e=>{
      if(["1","2","3","4"].includes(e.key)&&!locked){
        e.preventDefault();
        const b=answers.children[Number(e.key)-1];
        if(b) b.click();
        return;
      }

      if(e.key==="Enter"){
        // A focused <button> also treats Enter as a click by default. Preventing
        // that native activation avoids a stale answer click after render().
        e.preventDefault();

        if(readyForNext){
          if(document.activeElement instanceof HTMLElement){
            document.activeElement.blur();
          }
          advance();
        }
      }
    });

    render();

    return {
      restart(){
        index=0;
        correct=0;
        points=0;
        results=[];
        answerDetails=[];
        completed=false;
        readyForNext=false;
        started=performance.now();
        render();
      }
    };
  }

  return {mount};
})();

window.showToast=function(msg){
  const t=document.querySelector(".toast");
  if(!t)return;
  t.textContent=msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),1700);
}
