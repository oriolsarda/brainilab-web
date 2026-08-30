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

/* ===== supabase-daily.js ===== */

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

/* ===== daily-hub.js ===== */

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

/* ===== daily-journey.js ===== */

/*
  BrainiLab Daily Journey — V41.8.0
  One reusable visual for today's four Daily Games.
*/
window.BrainiDailyJourney=(function(){
  const SCRIPT_URL=(()=>{
    const current=document.currentScript?.src;
    if(current) return current;

    const found=[...document.scripts]
      .map(s=>s.src)
      .find(src=>src && src.includes("/assets/js/daily-journey.js"));

    return found||location.href;
  })();

  const SITE_ROOT=new URL("../../",SCRIPT_URL);

  function siteUrl(path=""){
    const raw=String(path).replace(/^\/+/, "");
    const url=new URL(raw,SITE_ROOT);

    // Static local browsing has no web server to resolve directory routes
    // to index.html. Chrome otherwise shows a directory listing.
    if(
      url.protocol==="file:" &&
      url.pathname.endsWith("/")
    ){
      url.pathname+="index.html";
    }

    return url.href;
  }

  const META={
    brainmix:{name:"Brain Mix",icon:"brainmix",href:"games/brain-mix/"},
    orderup:{name:"Order Up",icon:"orderup",href:"games/order-up/"},
    topicrush:{name:"Topic Rush",icon:"topicrush",href:"games/topic-rush/"},
    connections:{name:"Connections",icon:"connections",href:"games/connections/",dailyQuery:true},
    oddoneout:{name:"Odd One Out",icon:"odd-one-out",href:"games/odd-one-out/",dailyQuery:true},
    higherlower:{name:"Higher or Lower",icon:"higher-lower",href:"games/higher-lower/",dailyQuery:true},
    mathrush:{name:"Math Rush",icon:"math-rush",href:"games/math-rush/",dailyQuery:true},
    numberroute:{name:"Number Route",icon:"number-route",href:"games/number-route/",dailyQuery:true},
    sequence:{name:"Sequence",icon:"sequence",href:"games/sequence/",dailyQuery:true},
    brainiword:{name:"BrainiWord",icon:"brainiword",href:"games/brainiword/"}
  };
  const ORDER=["brainmix","orderup","topicrush","connections","oddoneout","higherlower","mathrush","numberroute","sequence","brainiword"];

  function orderFor(status){
    return status?.dailyIds||BrainiData.dailyGameIdsForNumber?.(status?.dailyNumber)||["brainmix","orderup","topicrush","brainiword"];
  }

  function practiceDateFor(gameId,currentDate){
    const base=new Date(`${currentDate}T12:00:00Z`),d=new Date(base);
    for(let i=1;i<=90;i++){
      d.setUTCDate(d.getUTCDate()-1);
      const key=d.toISOString().slice(0,10);
      if((BrainiData.dailyGameIdsForDate?.(key)||[]).includes(gameId)) return key;
    }
    base.setUTCDate(base.getUTCDate()-1);
    return base.toISOString().slice(0,10);
  }

  function formatPoints(n){
    return Number(n||0).toLocaleString();
  }

  async function markup(options={}){
    const status=options.status||await BrainiDailyHub.resolve(
      options.dailyNumber,
      {forceCloud:!!options.forceCloud}
    );
    const current=options.currentGame||"";

    return `
      <section class="daily-journey ${status.completedCount===4?"is-full":""}">
        <div class="daily-journey-head">
          <div>
            <span class="daily-journey-eyebrow">Today's Daily · #${status.dailyNumber}</span>
            <h3>${status.completedCount===4?"Full Daily complete ✓":"Finish today's 4 challenges"}</h3>
          </div>
          <div class="daily-journey-score">
            <strong>${formatPoints(status.brainScore)}</strong>
            <span>/ 10,000</span>
          </div>
        </div>

        <div class="daily-journey-progress">
          <span style="width:${Math.min(100,status.completedCount/4*100)}%"></span>
        </div>

        <div class="daily-journey-grid">
          ${orderFor(status).map(id=>{
            const meta=META[id];
            const game=status.games[id]||{};
            const complete=!!game.completed;
            const dailyDate=BrainiData.dateForDailyNumber?.(status.dailyNumber)||BrainiData.todayKey();
            const playHref=meta.dailyQuery
              ? `${siteUrl(meta.href)}?daily=${encodeURIComponent(dailyDate)}`
              : siteUrl(meta.href);
            const practiceDate=practiceDateFor(id,dailyDate);
            const tryHref=`${siteUrl(meta.href)}?archive=${encodeURIComponent(practiceDate)}&try=1&today=${encodeURIComponent(dailyDate)}`;
            return `
              <article class="daily-journey-card-v2 ${complete?"is-complete":"is-pending"} ${id===current?"is-current":""}">
                <div class="daily-journey-card-main">
                  <span class="daily-journey-icon">${BrainiIcons.game(meta.icon,"mini","braini-game-mini")}</span>
                  <span class="daily-journey-copy">
                    <strong>${meta.name}</strong>
                    <small>${complete
                      ? `${formatPoints(game.points)} / 2,500 points`
                      : "Up to 2,500 Daily points"
                    }</small>
                  </span>
                  <span class="daily-journey-state">${complete?BrainiIcons.product("check-completed","braini-inline-icon"):BrainiIcons.product("continue","braini-inline-icon")}</span>
                </div>
                ${complete
                  ? `<div class="daily-journey-completed-lock">Completed today · result locked ✓</div>`
                  : `<div class="daily-journey-actions">
                      <a class="daily-journey-try" href="${tryHref}">Try first</a>
                      <a class="daily-journey-play" href="${playHref}">Play Daily</a>
                    </div>`
                }
              </article>`;
          }).join("")}
        </div>

        <div class="daily-journey-foot">
          ${status.completedCount===4
            ? `<strong>+250 XP Full Daily bonus earned</strong><span>Come back tomorrow for a new four-game set.</span>`
            : `<strong>${4-status.completedCount} ${4-status.completedCount===1?"challenge":"challenges"} left</strong><span>Complete all four for +250 bonus XP.</span>`
          }
        </div>
      </section>`;
  }

  async function render(container,options={}){
    if(!container) return null;
    const status=options.status||await BrainiDailyHub.resolve(
      options.dailyNumber,
      {forceCloud:!!options.forceCloud}
    );
    container.innerHTML=await markup({...options,status});
    return status;
  }

  return {META,ORDER,markup,render};
})();

/* ===== daily-games.js ===== */

/*
  BrainiLab Daily Games — Step 7
  --------------------------------
  Backend adapters for active Daily games. Retired Flag Dash / Map Hunt loaders were removed from the client; legacy server verification remains isolated for old synced results.
  All games share the same UTC Daily number as Brain Mix.
*/
window.BrainiDailyGames=(function(){
  const REQUEST_TIMEOUT_MS=4500;
  const WORDS=["OCEAN", "BRAIN", "PLANT", "LIGHT", "WORLD", "MOUSE", "STONE", "RIVER", "CLOUD", "TRAIN", "EARTH", "HOUSE", "MUSIC", "FRUIT", "GREEN", "WATER", "SMILE", "NIGHT", "SPACE", "BEACH", "CHAIR", "SHEEP", "PLANE", "SOUND", "PAPER", "CLOCK", "GRASS", "BREAD", "TIGER", "SUGAR", "APPLE", "BRICK", "CROWN", "DREAM", "FLAME", "GIANT", "HONEY", "JUICE", "KNIFE", "LEMON", "METAL", "NURSE", "OPERA", "PEARL", "QUEEN", "ROBOT", "SHARK", "TABLE", "UNITY", "VOICE", "WHALE", "YOUTH", "ZEBRA", "ANGEL", "BLAST", "CANDY", "DRIVE", "EAGLE", "FROST", "GHOST", "HEART", "IVORY", "JELLY", "KAYAK", "LASER", "MAGIC", "NOVEL", "OLIVE", "PIZZA", "QUEST", "RADIO", "SOLAR", "TRUCK", "URBAN", "VIDEO", "WHEAT", "ALBUM", "BERRY", "CORAL", "DANCE"];
  const TOPIC_RUSH_TOPICS=[{"key":"african-countries","title":"Countries in Africa","prompt":"Name countries in Africa.","target":15,"answers":[{"answer":"Algeria","aliases":[]},{"answer":"Angola","aliases":[]},{"answer":"Benin","aliases":[]},{"answer":"Botswana","aliases":[]},{"answer":"Burkina Faso","aliases":[]},{"answer":"Burundi","aliases":[]},{"answer":"Cabo Verde","aliases":["Cape Verde"]},{"answer":"Cameroon","aliases":[]},{"answer":"Central African Republic","aliases":[]},{"answer":"Chad","aliases":[]},{"answer":"Comoros","aliases":[]},{"answer":"Democratic Republic of the Congo","aliases":["DR Congo","DRC","Congo Kinshasa","Congo-Kinshasa"]},{"answer":"Republic of the Congo","aliases":["Congo Republic","Congo Brazzaville","Congo-Brazzaville"]},{"answer":"Côte d'Ivoire","aliases":["Cote d'Ivoire","Ivory Coast"]},{"answer":"Djibouti","aliases":[]},{"answer":"Egypt","aliases":[]},{"answer":"Equatorial Guinea","aliases":[]},{"answer":"Eritrea","aliases":[]},{"answer":"Eswatini","aliases":["Swaziland"]},{"answer":"Ethiopia","aliases":[]},{"answer":"Gabon","aliases":[]},{"answer":"Gambia","aliases":["The Gambia"]},{"answer":"Ghana","aliases":[]},{"answer":"Guinea","aliases":[]},{"answer":"Guinea-Bissau","aliases":[]},{"answer":"Kenya","aliases":[]},{"answer":"Lesotho","aliases":[]},{"answer":"Liberia","aliases":[]},{"answer":"Libya","aliases":[]},{"answer":"Madagascar","aliases":[]},{"answer":"Malawi","aliases":[]},{"answer":"Mali","aliases":[]},{"answer":"Mauritania","aliases":[]},{"answer":"Mauritius","aliases":[]},{"answer":"Morocco","aliases":[]},{"answer":"Mozambique","aliases":[]},{"answer":"Namibia","aliases":[]},{"answer":"Niger","aliases":[]},{"answer":"Nigeria","aliases":[]},{"answer":"Rwanda","aliases":[]},{"answer":"São Tomé and Príncipe","aliases":["Sao Tome and Principe"]},{"answer":"Senegal","aliases":[]},{"answer":"Seychelles","aliases":[]},{"answer":"Sierra Leone","aliases":[]},{"answer":"Somalia","aliases":[]},{"answer":"South Africa","aliases":[]},{"answer":"South Sudan","aliases":[]},{"answer":"Sudan","aliases":[]},{"answer":"Tanzania","aliases":[]},{"answer":"Togo","aliases":[]},{"answer":"Tunisia","aliases":[]},{"answer":"Uganda","aliases":[]},{"answer":"Zambia","aliases":[]},{"answer":"Zimbabwe","aliases":[]}]},{"key":"countries-americas","title":"Countries in the Americas","prompt":"Name sovereign countries in North, Central or South America and the Caribbean.","target":15,"answers":[{"answer":"Antigua and Barbuda","aliases":[]},{"answer":"Argentina","aliases":[]},{"answer":"Bahamas","aliases":["The Bahamas"]},{"answer":"Barbados","aliases":[]},{"answer":"Belize","aliases":[]},{"answer":"Bolivia","aliases":[]},{"answer":"Brazil","aliases":[]},{"answer":"Canada","aliases":[]},{"answer":"Chile","aliases":[]},{"answer":"Colombia","aliases":[]},{"answer":"Costa Rica","aliases":[]},{"answer":"Cuba","aliases":[]},{"answer":"Dominica","aliases":[]},{"answer":"Dominican Republic","aliases":[]},{"answer":"Ecuador","aliases":[]},{"answer":"El Salvador","aliases":[]},{"answer":"Grenada","aliases":[]},{"answer":"Guatemala","aliases":[]},{"answer":"Guyana","aliases":[]},{"answer":"Haiti","aliases":[]},{"answer":"Honduras","aliases":[]},{"answer":"Jamaica","aliases":[]},{"answer":"Mexico","aliases":[]},{"answer":"Nicaragua","aliases":[]},{"answer":"Panama","aliases":[]},{"answer":"Paraguay","aliases":[]},{"answer":"Peru","aliases":[]},{"answer":"Saint Kitts and Nevis","aliases":[]},{"answer":"Saint Lucia","aliases":[]},{"answer":"Saint Vincent and the Grenadines","aliases":[]},{"answer":"Suriname","aliases":[]},{"answer":"Trinidad and Tobago","aliases":[]},{"answer":"United States","aliases":["USA","US","United States of America"]},{"answer":"Uruguay","aliases":[]},{"answer":"Venezuela","aliases":[]}]},{"key":"eu-members","title":"European Union countries","prompt":"Name current European Union member countries.","target":15,"answers":[{"answer":"Austria","aliases":[]},{"answer":"Belgium","aliases":[]},{"answer":"Bulgaria","aliases":[]},{"answer":"Croatia","aliases":[]},{"answer":"Cyprus","aliases":[]},{"answer":"Czechia","aliases":["Czech Republic"]},{"answer":"Denmark","aliases":[]},{"answer":"Estonia","aliases":[]},{"answer":"Finland","aliases":[]},{"answer":"France","aliases":[]},{"answer":"Germany","aliases":[]},{"answer":"Greece","aliases":[]},{"answer":"Hungary","aliases":[]},{"answer":"Ireland","aliases":[]},{"answer":"Italy","aliases":[]},{"answer":"Latvia","aliases":[]},{"answer":"Lithuania","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Malta","aliases":[]},{"answer":"Netherlands","aliases":[]},{"answer":"Poland","aliases":[]},{"answer":"Portugal","aliases":[]},{"answer":"Romania","aliases":[]},{"answer":"Slovakia","aliases":[]},{"answer":"Slovenia","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Sweden","aliases":[]}]},{"key":"spanish-official","title":"Countries where Spanish is an official language","prompt":"Name sovereign countries where Spanish is an official language.","target":12,"answers":[{"answer":"Argentina","aliases":[]},{"answer":"Bolivia","aliases":[]},{"answer":"Chile","aliases":[]},{"answer":"Colombia","aliases":[]},{"answer":"Costa Rica","aliases":[]},{"answer":"Cuba","aliases":[]},{"answer":"Dominican Republic","aliases":[]},{"answer":"Ecuador","aliases":[]},{"answer":"El Salvador","aliases":[]},{"answer":"Equatorial Guinea","aliases":[]},{"answer":"Guatemala","aliases":[]},{"answer":"Honduras","aliases":[]},{"answer":"Mexico","aliases":[]},{"answer":"Nicaragua","aliases":[]},{"answer":"Panama","aliases":[]},{"answer":"Paraguay","aliases":[]},{"answer":"Peru","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Uruguay","aliases":[]},{"answer":"Venezuela","aliases":[]}]},{"key":"us-states","title":"U.S. states","prompt":"Name U.S. states.","target":15,"answers":[{"answer":"Alabama","aliases":[]},{"answer":"Alaska","aliases":[]},{"answer":"Arizona","aliases":[]},{"answer":"Arkansas","aliases":[]},{"answer":"California","aliases":[]},{"answer":"Colorado","aliases":[]},{"answer":"Connecticut","aliases":[]},{"answer":"Delaware","aliases":[]},{"answer":"Florida","aliases":[]},{"answer":"Georgia","aliases":[]},{"answer":"Hawaii","aliases":[]},{"answer":"Idaho","aliases":[]},{"answer":"Illinois","aliases":[]},{"answer":"Indiana","aliases":[]},{"answer":"Iowa","aliases":[]},{"answer":"Kansas","aliases":[]},{"answer":"Kentucky","aliases":[]},{"answer":"Louisiana","aliases":[]},{"answer":"Maine","aliases":[]},{"answer":"Maryland","aliases":[]},{"answer":"Massachusetts","aliases":[]},{"answer":"Michigan","aliases":[]},{"answer":"Minnesota","aliases":[]},{"answer":"Mississippi","aliases":[]},{"answer":"Missouri","aliases":[]},{"answer":"Montana","aliases":[]},{"answer":"Nebraska","aliases":[]},{"answer":"Nevada","aliases":[]},{"answer":"New Hampshire","aliases":[]},{"answer":"New Jersey","aliases":[]},{"answer":"New Mexico","aliases":[]},{"answer":"New York","aliases":[]},{"answer":"North Carolina","aliases":[]},{"answer":"North Dakota","aliases":[]},{"answer":"Ohio","aliases":[]},{"answer":"Oklahoma","aliases":[]},{"answer":"Oregon","aliases":[]},{"answer":"Pennsylvania","aliases":[]},{"answer":"Rhode Island","aliases":[]},{"answer":"South Carolina","aliases":[]},{"answer":"South Dakota","aliases":[]},{"answer":"Tennessee","aliases":[]},{"answer":"Texas","aliases":[]},{"answer":"Utah","aliases":[]},{"answer":"Vermont","aliases":[]},{"answer":"Virginia","aliases":[]},{"answer":"Washington","aliases":[]},{"answer":"West Virginia","aliases":[]},{"answer":"Wisconsin","aliases":[]},{"answer":"Wyoming","aliases":[]}]},{"key":"us-state-capitals","title":"U.S. state capitals","prompt":"Name capital cities of U.S. states.","target":15,"answers":[{"answer":"Montgomery","aliases":[]},{"answer":"Juneau","aliases":[]},{"answer":"Phoenix","aliases":[]},{"answer":"Little Rock","aliases":[]},{"answer":"Sacramento","aliases":[]},{"answer":"Denver","aliases":[]},{"answer":"Hartford","aliases":[]},{"answer":"Dover","aliases":[]},{"answer":"Tallahassee","aliases":[]},{"answer":"Atlanta","aliases":[]},{"answer":"Honolulu","aliases":[]},{"answer":"Boise","aliases":[]},{"answer":"Springfield","aliases":[]},{"answer":"Indianapolis","aliases":[]},{"answer":"Des Moines","aliases":[]},{"answer":"Topeka","aliases":[]},{"answer":"Frankfort","aliases":[]},{"answer":"Baton Rouge","aliases":[]},{"answer":"Augusta","aliases":[]},{"answer":"Annapolis","aliases":[]},{"answer":"Boston","aliases":[]},{"answer":"Lansing","aliases":[]},{"answer":"Saint Paul","aliases":[]},{"answer":"Jackson","aliases":[]},{"answer":"Jefferson City","aliases":[]},{"answer":"Helena","aliases":[]},{"answer":"Lincoln","aliases":[]},{"answer":"Carson City","aliases":[]},{"answer":"Concord","aliases":[]},{"answer":"Trenton","aliases":[]},{"answer":"Santa Fe","aliases":[]},{"answer":"Albany","aliases":[]},{"answer":"Raleigh","aliases":[]},{"answer":"Bismarck","aliases":[]},{"answer":"Columbus","aliases":[]},{"answer":"Oklahoma City","aliases":[]},{"answer":"Salem","aliases":[]},{"answer":"Harrisburg","aliases":[]},{"answer":"Providence","aliases":[]},{"answer":"Columbia","aliases":[]},{"answer":"Pierre","aliases":[]},{"answer":"Nashville","aliases":[]},{"answer":"Austin","aliases":[]},{"answer":"Salt Lake City","aliases":[]},{"answer":"Montpelier","aliases":[]},{"answer":"Richmond","aliases":[]},{"answer":"Olympia","aliases":[]},{"answer":"Charleston","aliases":[]},{"answer":"Madison","aliases":[]},{"answer":"Cheyenne","aliases":[]}]},{"key":"african-capitals","title":"African capital cities","prompt":"Name national capital cities in Africa.","target":15,"answers":[{"answer":"Algiers","aliases":[]},{"answer":"Luanda","aliases":[]},{"answer":"Porto-Novo","aliases":[]},{"answer":"Gaborone","aliases":[]},{"answer":"Ouagadougou","aliases":[]},{"answer":"Gitega","aliases":[]},{"answer":"Praia","aliases":[]},{"answer":"Yaoundé","aliases":[]},{"answer":"Bangui","aliases":[]},{"answer":"N'Djamena","aliases":[]},{"answer":"Moroni","aliases":[]},{"answer":"Kinshasa","aliases":[]},{"answer":"Brazzaville","aliases":[]},{"answer":"Yamoussoukro","aliases":[]},{"answer":"Djibouti","aliases":[]},{"answer":"Cairo","aliases":[]},{"answer":"Malabo","aliases":[]},{"answer":"Asmara","aliases":[]},{"answer":"Mbabane","aliases":[]},{"answer":"Lobamba","aliases":[]},{"answer":"Addis Ababa","aliases":[]},{"answer":"Libreville","aliases":[]},{"answer":"Banjul","aliases":[]},{"answer":"Accra","aliases":[]},{"answer":"Conakry","aliases":[]},{"answer":"Bissau","aliases":[]},{"answer":"Nairobi","aliases":[]},{"answer":"Maseru","aliases":[]},{"answer":"Monrovia","aliases":[]},{"answer":"Tripoli","aliases":[]},{"answer":"Antananarivo","aliases":[]},{"answer":"Lilongwe","aliases":[]},{"answer":"Bamako","aliases":[]},{"answer":"Nouakchott","aliases":[]},{"answer":"Port Louis","aliases":[]},{"answer":"Rabat","aliases":[]},{"answer":"Maputo","aliases":[]},{"answer":"Windhoek","aliases":[]},{"answer":"Niamey","aliases":[]},{"answer":"Abuja","aliases":[]},{"answer":"Kigali","aliases":[]},{"answer":"São Tomé","aliases":[]},{"answer":"Dakar","aliases":[]},{"answer":"Victoria","aliases":[]},{"answer":"Freetown","aliases":[]},{"answer":"Mogadishu","aliases":[]},{"answer":"Pretoria","aliases":[]},{"answer":"Cape Town","aliases":[]},{"answer":"Bloemfontein","aliases":[]},{"answer":"Juba","aliases":[]},{"answer":"Khartoum","aliases":[]},{"answer":"Dodoma","aliases":[]},{"answer":"Lomé","aliases":[]},{"answer":"Tunis","aliases":[]},{"answer":"Kampala","aliases":[]},{"answer":"Lusaka","aliases":[]},{"answer":"Harare","aliases":[]}]},{"key":"eu-capitals","title":"European Union capital cities","prompt":"Name capital cities of current European Union member countries.","target":15,"answers":[{"answer":"Vienna","aliases":[]},{"answer":"Brussels","aliases":[]},{"answer":"Sofia","aliases":[]},{"answer":"Zagreb","aliases":[]},{"answer":"Nicosia","aliases":[]},{"answer":"Prague","aliases":[]},{"answer":"Copenhagen","aliases":[]},{"answer":"Tallinn","aliases":[]},{"answer":"Helsinki","aliases":[]},{"answer":"Paris","aliases":[]},{"answer":"Berlin","aliases":[]},{"answer":"Athens","aliases":[]},{"answer":"Budapest","aliases":[]},{"answer":"Dublin","aliases":[]},{"answer":"Rome","aliases":[]},{"answer":"Riga","aliases":[]},{"answer":"Vilnius","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Valletta","aliases":[]},{"answer":"Amsterdam","aliases":[]},{"answer":"Warsaw","aliases":[]},{"answer":"Lisbon","aliases":[]},{"answer":"Bucharest","aliases":[]},{"answer":"Bratislava","aliases":[]},{"answer":"Ljubljana","aliases":[]},{"answer":"Madrid","aliases":[]},{"answer":"Stockholm","aliases":[]}]},{"key":"chemical-elements","title":"Chemical elements","prompt":"Name chemical elements from the periodic table.","target":15,"answers":[{"answer":"Hydrogen","aliases":[]},{"answer":"Helium","aliases":[]},{"answer":"Lithium","aliases":[]},{"answer":"Beryllium","aliases":[]},{"answer":"Boron","aliases":[]},{"answer":"Carbon","aliases":[]},{"answer":"Nitrogen","aliases":[]},{"answer":"Oxygen","aliases":[]},{"answer":"Fluorine","aliases":[]},{"answer":"Neon","aliases":[]},{"answer":"Sodium","aliases":[]},{"answer":"Magnesium","aliases":[]},{"answer":"Aluminium","aliases":["Aluminum"]},{"answer":"Silicon","aliases":[]},{"answer":"Phosphorus","aliases":[]},{"answer":"Sulfur","aliases":["Sulphur"]},{"answer":"Chlorine","aliases":[]},{"answer":"Argon","aliases":[]},{"answer":"Potassium","aliases":[]},{"answer":"Calcium","aliases":[]},{"answer":"Scandium","aliases":[]},{"answer":"Titanium","aliases":[]},{"answer":"Vanadium","aliases":[]},{"answer":"Chromium","aliases":[]},{"answer":"Manganese","aliases":[]},{"answer":"Iron","aliases":[]},{"answer":"Cobalt","aliases":[]},{"answer":"Nickel","aliases":[]},{"answer":"Copper","aliases":[]},{"answer":"Zinc","aliases":[]},{"answer":"Gallium","aliases":[]},{"answer":"Germanium","aliases":[]},{"answer":"Arsenic","aliases":[]},{"answer":"Selenium","aliases":[]},{"answer":"Bromine","aliases":[]},{"answer":"Krypton","aliases":[]},{"answer":"Rubidium","aliases":[]},{"answer":"Strontium","aliases":[]},{"answer":"Yttrium","aliases":[]},{"answer":"Zirconium","aliases":[]},{"answer":"Niobium","aliases":[]},{"answer":"Molybdenum","aliases":[]},{"answer":"Technetium","aliases":[]},{"answer":"Ruthenium","aliases":[]},{"answer":"Rhodium","aliases":[]},{"answer":"Palladium","aliases":[]},{"answer":"Silver","aliases":[]},{"answer":"Cadmium","aliases":[]},{"answer":"Indium","aliases":[]},{"answer":"Tin","aliases":[]},{"answer":"Antimony","aliases":[]},{"answer":"Tellurium","aliases":[]},{"answer":"Iodine","aliases":[]},{"answer":"Xenon","aliases":[]},{"answer":"Caesium","aliases":["Cesium"]},{"answer":"Barium","aliases":[]},{"answer":"Lanthanum","aliases":[]},{"answer":"Cerium","aliases":[]},{"answer":"Praseodymium","aliases":[]},{"answer":"Neodymium","aliases":[]},{"answer":"Promethium","aliases":[]},{"answer":"Samarium","aliases":[]},{"answer":"Europium","aliases":[]},{"answer":"Gadolinium","aliases":[]},{"answer":"Terbium","aliases":[]},{"answer":"Dysprosium","aliases":[]},{"answer":"Holmium","aliases":[]},{"answer":"Erbium","aliases":[]},{"answer":"Thulium","aliases":[]},{"answer":"Ytterbium","aliases":[]},{"answer":"Lutetium","aliases":[]},{"answer":"Hafnium","aliases":[]},{"answer":"Tantalum","aliases":[]},{"answer":"Tungsten","aliases":[]},{"answer":"Rhenium","aliases":[]},{"answer":"Osmium","aliases":[]},{"answer":"Iridium","aliases":[]},{"answer":"Platinum","aliases":[]},{"answer":"Gold","aliases":[]},{"answer":"Mercury","aliases":[]},{"answer":"Thallium","aliases":[]},{"answer":"Lead","aliases":[]},{"answer":"Bismuth","aliases":[]},{"answer":"Polonium","aliases":[]},{"answer":"Astatine","aliases":[]},{"answer":"Radon","aliases":[]},{"answer":"Francium","aliases":[]},{"answer":"Radium","aliases":[]},{"answer":"Actinium","aliases":[]},{"answer":"Thorium","aliases":[]},{"answer":"Protactinium","aliases":[]},{"answer":"Uranium","aliases":[]},{"answer":"Neptunium","aliases":[]},{"answer":"Plutonium","aliases":[]},{"answer":"Americium","aliases":[]},{"answer":"Curium","aliases":[]},{"answer":"Berkelium","aliases":[]},{"answer":"Californium","aliases":[]},{"answer":"Einsteinium","aliases":[]},{"answer":"Fermium","aliases":[]},{"answer":"Mendelevium","aliases":[]},{"answer":"Nobelium","aliases":[]},{"answer":"Lawrencium","aliases":[]},{"answer":"Rutherfordium","aliases":[]},{"answer":"Dubnium","aliases":[]},{"answer":"Seaborgium","aliases":[]},{"answer":"Bohrium","aliases":[]},{"answer":"Hassium","aliases":[]},{"answer":"Meitnerium","aliases":[]},{"answer":"Darmstadtium","aliases":[]},{"answer":"Roentgenium","aliases":[]},{"answer":"Copernicium","aliases":[]},{"answer":"Nihonium","aliases":[]},{"answer":"Flerovium","aliases":[]},{"answer":"Moscovium","aliases":[]},{"answer":"Livermorium","aliases":[]},{"answer":"Tennessine","aliases":[]},{"answer":"Oganesson","aliases":[]}]},{"key":"greek-alphabet","title":"Greek alphabet letters","prompt":"Name letters of the Greek alphabet.","target":12,"answers":[{"answer":"Alpha","aliases":[]},{"answer":"Beta","aliases":[]},{"answer":"Gamma","aliases":[]},{"answer":"Delta","aliases":[]},{"answer":"Epsilon","aliases":[]},{"answer":"Zeta","aliases":[]},{"answer":"Eta","aliases":[]},{"answer":"Theta","aliases":[]},{"answer":"Iota","aliases":[]},{"answer":"Kappa","aliases":[]},{"answer":"Lambda","aliases":[]},{"answer":"Mu","aliases":[]},{"answer":"Nu","aliases":[]},{"answer":"Xi","aliases":[]},{"answer":"Omicron","aliases":[]},{"answer":"Pi","aliases":[]},{"answer":"Rho","aliases":[]},{"answer":"Sigma","aliases":[]},{"answer":"Tau","aliases":[]},{"answer":"Upsilon","aliases":[]},{"answer":"Phi","aliases":[]},{"answer":"Chi","aliases":[]},{"answer":"Psi","aliases":[]},{"answer":"Omega","aliases":[]}]},{"key":"nato-alphabet","title":"NATO phonetic alphabet","prompt":"Name code words from the NATO phonetic alphabet.","target":12,"answers":[{"answer":"Alfa","aliases":["Alpha"]},{"answer":"Bravo","aliases":[]},{"answer":"Charlie","aliases":[]},{"answer":"Delta","aliases":[]},{"answer":"Echo","aliases":[]},{"answer":"Foxtrot","aliases":[]},{"answer":"Golf","aliases":[]},{"answer":"Hotel","aliases":[]},{"answer":"India","aliases":[]},{"answer":"Juliett","aliases":["Juliet"]},{"answer":"Kilo","aliases":[]},{"answer":"Lima","aliases":[]},{"answer":"Mike","aliases":[]},{"answer":"November","aliases":[]},{"answer":"Oscar","aliases":[]},{"answer":"Papa","aliases":[]},{"answer":"Quebec","aliases":[]},{"answer":"Romeo","aliases":[]},{"answer":"Sierra","aliases":[]},{"answer":"Tango","aliases":[]},{"answer":"Uniform","aliases":[]},{"answer":"Victor","aliases":[]},{"answer":"Whiskey","aliases":[]},{"answer":"X-ray","aliases":["Xray","X Ray"]},{"answer":"Yankee","aliases":[]},{"answer":"Zulu","aliases":[]}]},{"key":"premier-league-2026-27","title":"Premier League clubs","prompt":"Name clubs playing in the 2026/27 English Premier League.","target":12,"answers":[{"answer":"AFC Bournemouth","aliases":["Bournemouth"]},{"answer":"Arsenal","aliases":[]},{"answer":"Aston Villa","aliases":[]},{"answer":"Brentford","aliases":[]},{"answer":"Brighton & Hove Albion","aliases":["Brighton","Brighton and Hove Albion"]},{"answer":"Chelsea","aliases":[]},{"answer":"Coventry City","aliases":[]},{"answer":"Crystal Palace","aliases":[]},{"answer":"Everton","aliases":[]},{"answer":"Fulham","aliases":[]},{"answer":"Hull City","aliases":[]},{"answer":"Ipswich Town","aliases":[]},{"answer":"Leeds United","aliases":[]},{"answer":"Liverpool","aliases":[]},{"answer":"Manchester City","aliases":["Man City"]},{"answer":"Manchester United","aliases":["Man United","Man Utd"]},{"answer":"Newcastle United","aliases":["Newcastle"]},{"answer":"Nottingham Forest","aliases":["Nottm Forest","Forest"]},{"answer":"Sunderland","aliases":[]},{"answer":"Tottenham Hotspur","aliases":["Tottenham","Spurs"]}]},{"key":"nba-teams","title":"NBA teams","prompt":"Name current NBA teams.","target":15,"answers":[{"answer":"Atlanta Hawks","aliases":["Hawks"]},{"answer":"Boston Celtics","aliases":["Celtics"]},{"answer":"Brooklyn Nets","aliases":["Nets"]},{"answer":"Charlotte Hornets","aliases":["Hornets"]},{"answer":"Chicago Bulls","aliases":["Bulls"]},{"answer":"Cleveland Cavaliers","aliases":["Cavaliers"]},{"answer":"Dallas Mavericks","aliases":["Mavericks"]},{"answer":"Denver Nuggets","aliases":["Nuggets"]},{"answer":"Detroit Pistons","aliases":["Pistons"]},{"answer":"Golden State Warriors","aliases":["Warriors"]},{"answer":"Houston Rockets","aliases":["Rockets"]},{"answer":"Indiana Pacers","aliases":["Pacers"]},{"answer":"LA Clippers","aliases":["Los Angeles Clippers","Clippers"]},{"answer":"Los Angeles Lakers","aliases":["Lakers"]},{"answer":"Memphis Grizzlies","aliases":["Grizzlies"]},{"answer":"Miami Heat","aliases":["Heat"]},{"answer":"Milwaukee Bucks","aliases":["Bucks"]},{"answer":"Minnesota Timberwolves","aliases":["Timberwolves"]},{"answer":"New Orleans Pelicans","aliases":["Pelicans"]},{"answer":"New York Knicks","aliases":["Knicks"]},{"answer":"Oklahoma City Thunder","aliases":["Thunder"]},{"answer":"Orlando Magic","aliases":["Magic"]},{"answer":"Philadelphia 76ers","aliases":["76ers","Sixers"]},{"answer":"Phoenix Suns","aliases":["Suns"]},{"answer":"Portland Trail Blazers","aliases":["Blazers"]},{"answer":"Sacramento Kings","aliases":["Kings"]},{"answer":"San Antonio Spurs","aliases":["Spurs"]},{"answer":"Toronto Raptors","aliases":["Raptors"]},{"answer":"Utah Jazz","aliases":["Jazz"]},{"answer":"Washington Wizards","aliases":["Wizards"]}]},{"key":"nfl-teams","title":"NFL teams","prompt":"Name current NFL teams.","target":15,"answers":[{"answer":"Arizona Cardinals","aliases":["Cardinals"]},{"answer":"Atlanta Falcons","aliases":["Falcons"]},{"answer":"Baltimore Ravens","aliases":["Ravens"]},{"answer":"Buffalo Bills","aliases":["Bills"]},{"answer":"Carolina Panthers","aliases":["Panthers"]},{"answer":"Chicago Bears","aliases":["Bears"]},{"answer":"Cincinnati Bengals","aliases":["Bengals"]},{"answer":"Cleveland Browns","aliases":["Browns"]},{"answer":"Dallas Cowboys","aliases":["Cowboys"]},{"answer":"Denver Broncos","aliases":["Broncos"]},{"answer":"Detroit Lions","aliases":["Lions"]},{"answer":"Green Bay Packers","aliases":["Packers"]},{"answer":"Houston Texans","aliases":["Texans"]},{"answer":"Indianapolis Colts","aliases":["Colts"]},{"answer":"Jacksonville Jaguars","aliases":["Jaguars"]},{"answer":"Kansas City Chiefs","aliases":["Chiefs","KC Chiefs"]},{"answer":"Las Vegas Raiders","aliases":["Raiders"]},{"answer":"Los Angeles Chargers","aliases":["Chargers"]},{"answer":"Los Angeles Rams","aliases":["Rams"]},{"answer":"Miami Dolphins","aliases":["Dolphins"]},{"answer":"Minnesota Vikings","aliases":["Vikings"]},{"answer":"New England Patriots","aliases":["Patriots"]},{"answer":"New Orleans Saints","aliases":["Saints"]},{"answer":"New York Giants","aliases":["Giants"]},{"answer":"New York Jets","aliases":["Jets"]},{"answer":"Philadelphia Eagles","aliases":["Eagles"]},{"answer":"Pittsburgh Steelers","aliases":["Steelers"]},{"answer":"San Francisco 49ers","aliases":["49ers","49ers","Niners"]},{"answer":"Seattle Seahawks","aliases":["Seahawks"]},{"answer":"Tampa Bay Buccaneers","aliases":["Buccaneers","Bucs"]},{"answer":"Tennessee Titans","aliases":["Titans"]},{"answer":"Washington Commanders","aliases":["Commanders"]}]},{"key":"mlb-teams","title":"MLB teams","prompt":"Name current Major League Baseball teams.","target":15,"answers":[{"answer":"Arizona Diamondbacks","aliases":["Diamondbacks"]},{"answer":"Atlanta Braves","aliases":["Braves"]},{"answer":"Baltimore Orioles","aliases":["Orioles"]},{"answer":"Boston Red Sox","aliases":["Red Sox"]},{"answer":"Chicago Cubs","aliases":["Cubs"]},{"answer":"Chicago White Sox","aliases":["White Sox"]},{"answer":"Cincinnati Reds","aliases":["Reds"]},{"answer":"Cleveland Guardians","aliases":["Guardians"]},{"answer":"Colorado Rockies","aliases":["Rockies"]},{"answer":"Detroit Tigers","aliases":["Tigers"]},{"answer":"Houston Astros","aliases":["Astros"]},{"answer":"Kansas City Royals","aliases":["Royals"]},{"answer":"Los Angeles Angels","aliases":["Angels"]},{"answer":"Los Angeles Dodgers","aliases":["Dodgers"]},{"answer":"Miami Marlins","aliases":["Marlins"]},{"answer":"Milwaukee Brewers","aliases":["Brewers"]},{"answer":"Minnesota Twins","aliases":["Twins"]},{"answer":"New York Mets","aliases":["Mets"]},{"answer":"New York Yankees","aliases":["Yankees"]},{"answer":"Athletics","aliases":["Athletics","A's","As","Oakland Athletics"]},{"answer":"Philadelphia Phillies","aliases":["Phillies"]},{"answer":"Pittsburgh Pirates","aliases":["Pirates"]},{"answer":"San Diego Padres","aliases":["Padres"]},{"answer":"San Francisco Giants","aliases":["Giants"]},{"answer":"Seattle Mariners","aliases":["Mariners"]},{"answer":"St. Louis Cardinals","aliases":["Cardinals","St Louis Cardinals"]},{"answer":"Tampa Bay Rays","aliases":["Rays"]},{"answer":"Texas Rangers","aliases":["Rangers"]},{"answer":"Toronto Blue Jays","aliases":["Jays","Blue Jays"]},{"answer":"Washington Nationals","aliases":["Nationals"]}]},{"key":"common-colors","title":"Common colors","prompt":"Name common color names.","target":15,"answers":[{"answer":"Red","aliases":[]},{"answer":"Orange","aliases":[]},{"answer":"Yellow","aliases":[]},{"answer":"Green","aliases":[]},{"answer":"Blue","aliases":[]},{"answer":"Purple","aliases":["Violet"]},{"answer":"Pink","aliases":[]},{"answer":"Brown","aliases":[]},{"answer":"Black","aliases":[]},{"answer":"White","aliases":[]},{"answer":"Grey","aliases":["Gray"]},{"answer":"Beige","aliases":[]},{"answer":"Turquoise","aliases":[]},{"answer":"Teal","aliases":[]},{"answer":"Cyan","aliases":[]},{"answer":"Magenta","aliases":[]},{"answer":"Maroon","aliases":[]},{"answer":"Navy","aliases":["Navy Blue"]},{"answer":"Olive","aliases":[]},{"answer":"Lime","aliases":["Lime Green"]},{"answer":"Gold","aliases":[]},{"answer":"Silver","aliases":[]},{"answer":"Coral","aliases":[]},{"answer":"Indigo","aliases":[]},{"answer":"Lavender","aliases":[]},{"answer":"Peach","aliases":[]},{"answer":"Cream","aliases":[]},{"answer":"Khaki","aliases":[]}]},{"key":"musical-instruments","title":"Musical instruments","prompt":"Name common musical instruments.","target":15,"answers":[{"answer":"Piano","aliases":[]},{"answer":"Guitar","aliases":[]},{"answer":"Violin","aliases":[]},{"answer":"Viola","aliases":[]},{"answer":"Cello","aliases":[]},{"answer":"Double bass","aliases":["Upright Bass"]},{"answer":"Harp","aliases":[]},{"answer":"Flute","aliases":[]},{"answer":"Piccolo","aliases":[]},{"answer":"Clarinet","aliases":[]},{"answer":"Oboe","aliases":[]},{"answer":"Bassoon","aliases":[]},{"answer":"Saxophone","aliases":["Sax"]},{"answer":"Trumpet","aliases":[]},{"answer":"Trombone","aliases":[]},{"answer":"French horn","aliases":["Horn"]},{"answer":"Tuba","aliases":[]},{"answer":"Drums","aliases":["Drum Kit","Drum Set"]},{"answer":"Xylophone","aliases":[]},{"answer":"Marimba","aliases":[]},{"answer":"Accordion","aliases":[]},{"answer":"Harmonica","aliases":[]},{"answer":"Banjo","aliases":[]},{"answer":"Ukulele","aliases":["Uke"]},{"answer":"Mandolin","aliases":[]},{"answer":"Organ","aliases":[]},{"answer":"Synthesizer","aliases":["Synth"]},{"answer":"Recorder","aliases":[]},{"answer":"Bagpipes","aliases":["Bagpipe"]},{"answer":"Tambourine","aliases":[]},{"answer":"Triangle","aliases":[]},{"answer":"Cymbals","aliases":["Cymbal"]},{"answer":"Bongos","aliases":["Bongo Drums"]},{"answer":"Congas","aliases":["Conga Drums"]},{"answer":"Lute","aliases":[]},{"answer":"Sitar","aliases":[]}]},{"key":"common-fruits","title":"Common fruits","prompt":"Name common fruits.","target":15,"answers":[{"answer":"Apple","aliases":[]},{"answer":"Banana","aliases":[]},{"answer":"Orange","aliases":[]},{"answer":"Pear","aliases":[]},{"answer":"Peach","aliases":[]},{"answer":"Plum","aliases":[]},{"answer":"Cherry","aliases":[]},{"answer":"Strawberry","aliases":[]},{"answer":"Raspberry","aliases":[]},{"answer":"Blueberry","aliases":[]},{"answer":"Blackberry","aliases":[]},{"answer":"Grape","aliases":["Grapes"]},{"answer":"Watermelon","aliases":[]},{"answer":"Melon","aliases":[]},{"answer":"Pineapple","aliases":[]},{"answer":"Mango","aliases":[]},{"answer":"Papaya","aliases":[]},{"answer":"Kiwi","aliases":["Kiwifruit"]},{"answer":"Lemon","aliases":[]},{"answer":"Lime","aliases":[]},{"answer":"Grapefruit","aliases":[]},{"answer":"Apricot","aliases":[]},{"answer":"Fig","aliases":[]},{"answer":"Pomegranate","aliases":[]},{"answer":"Coconut","aliases":[]},{"answer":"Avocado","aliases":[]},{"answer":"Guava","aliases":[]},{"answer":"Passion fruit","aliases":["Passionfruit"]},{"answer":"Dragon fruit","aliases":["Dragonfruit","Pitaya"]},{"answer":"Lychee","aliases":["Litchi"]},{"answer":"Nectarine","aliases":[]},{"answer":"Persimmon","aliases":[]}]},{"key":"european-countries","title":"Countries in Europe","prompt":"Name sovereign countries in Europe.","target":15,"answers":[{"answer":"Albania","aliases":[]},{"answer":"Andorra","aliases":[]},{"answer":"Austria","aliases":[]},{"answer":"Belarus","aliases":[]},{"answer":"Belgium","aliases":[]},{"answer":"Bosnia and Herzegovina","aliases":["Bosnia"]},{"answer":"Bulgaria","aliases":[]},{"answer":"Croatia","aliases":[]},{"answer":"Cyprus","aliases":[]},{"answer":"Czechia","aliases":["Czech Republic"]},{"answer":"Denmark","aliases":[]},{"answer":"Estonia","aliases":[]},{"answer":"Finland","aliases":[]},{"answer":"France","aliases":[]},{"answer":"Germany","aliases":[]},{"answer":"Greece","aliases":[]},{"answer":"Hungary","aliases":[]},{"answer":"Iceland","aliases":[]},{"answer":"Ireland","aliases":[]},{"answer":"Italy","aliases":[]},{"answer":"Latvia","aliases":[]},{"answer":"Liechtenstein","aliases":[]},{"answer":"Lithuania","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Malta","aliases":[]},{"answer":"Moldova","aliases":[]},{"answer":"Monaco","aliases":[]},{"answer":"Montenegro","aliases":[]},{"answer":"Netherlands","aliases":["The Netherlands","Holland"]},{"answer":"North Macedonia","aliases":["Macedonia"]},{"answer":"Norway","aliases":[]},{"answer":"Poland","aliases":[]},{"answer":"Portugal","aliases":[]},{"answer":"Romania","aliases":[]},{"answer":"San Marino","aliases":[]},{"answer":"Serbia","aliases":[]},{"answer":"Slovakia","aliases":[]},{"answer":"Slovenia","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Sweden","aliases":[]},{"answer":"Switzerland","aliases":[]},{"answer":"Ukraine","aliases":[]},{"answer":"United Kingdom","aliases":["UK","Great Britain"]},{"answer":"Vatican City","aliases":["Vatican"]}]},{"key":"world-currencies","title":"World currencies","prompt":"Name currencies used by countries around the world.","target":15,"answers":[{"answer":"Euro","aliases":["EUR"]},{"answer":"US dollar","aliases":["Dollar","USD","United States Dollar"]},{"answer":"Pound sterling","aliases":["British Pound","GBP","Sterling"]},{"answer":"Japanese yen","aliases":["Yen","JPY"]},{"answer":"Chinese yuan","aliases":["Yuan","Renminbi","CNY"]},{"answer":"Swiss franc","aliases":["Franc","CHF"]},{"answer":"Canadian dollar","aliases":["CAD"]},{"answer":"Australian dollar","aliases":["AUD"]},{"answer":"New Zealand dollar","aliases":["NZD"]},{"answer":"Indian rupee","aliases":["Rupee","INR"]},{"answer":"South Korean won","aliases":["Won","KRW"]},{"answer":"Mexican peso","aliases":["Peso","MXN"]},{"answer":"Brazilian real","aliases":["Real","BRL"]},{"answer":"Argentine peso","aliases":["ARS"]},{"answer":"Chilean peso","aliases":["CLP"]},{"answer":"Colombian peso","aliases":["COP"]},{"answer":"South African rand","aliases":["Rand","ZAR"]},{"answer":"Turkish lira","aliases":["Lira","TRY"]},{"answer":"Swedish krona","aliases":["Krona","SEK"]},{"answer":"Norwegian krone","aliases":["Krone","NOK"]},{"answer":"Danish krone","aliases":["DKK"]},{"answer":"Polish zloty","aliases":["Zloty","PLN"]},{"answer":"Czech koruna","aliases":["Koruna","CZK"]},{"answer":"Hungarian forint","aliases":["Forint","HUF"]},{"answer":"Romanian leu","aliases":["Leu","RON"]},{"answer":"Israeli new shekel","aliases":["Shekel","ILS"]},{"answer":"Saudi riyal","aliases":["Riyal","SAR"]},{"answer":"UAE dirham","aliases":["Dirham","AED"]},{"answer":"Thai baht","aliases":["Baht","THB"]},{"answer":"Indonesian rupiah","aliases":["Rupiah","IDR"]},{"answer":"Malaysian ringgit","aliases":["Ringgit","MYR"]},{"answer":"Singapore dollar","aliases":["SGD"]},{"answer":"Philippine peso","aliases":["PHP"]},{"answer":"Egyptian pound","aliases":["EGP"]}]}];

  const ORDER_UP_ROUNDS=[{"key":"history-milestones","title":"History timeline","prompt":"Put these events in chronological order.","direction":"Earliest → Latest","items":["Magna Carta is sealed","Columbus reaches the Americas","Martin Luther publishes the 95 Theses","US Declaration of Independence","French Revolution begins","On the Origin of Species is published","World War I begins","World War II begins","Apollo 11 Moon landing","Berlin Wall falls"]},{"key":"mountains-height","title":"Highest mountains","prompt":"Order these mountains by height above sea level.","direction":"Highest → Lowest","items":["Mount Everest","K2","Kangchenjunga","Lhotse","Makalu","Cho Oyu","Dhaulagiri I","Manaslu","Nanga Parbat","Annapurna I"]},{"key":"movies-release","title":"Movie timeline","prompt":"Order these films by their original release.","direction":"Oldest → Newest","items":["Snow White and the Seven Dwarfs","Citizen Kane","The Godfather","Jaws","Star Wars","E.T. the Extra-Terrestrial","Jurassic Park","Titanic","The Dark Knight","Parasite"]},{"key":"programming-languages","title":"Programming languages","prompt":"Order these languages by when they first appeared.","direction":"Oldest → Newest","items":["Fortran","Lisp","COBOL","BASIC","C","C++","Python","Java","C#","Swift"]},{"key":"space-milestones","title":"Space milestones","prompt":"Put these space milestones in chronological order.","direction":"Earliest → Latest","items":["Sputnik 1","Yuri Gagarin orbits Earth","Valentina Tereshkova flies to space","Apollo 8 orbits the Moon","Apollo 11 Moon landing","Salyut 1 launches","Voyager 1 launches","Hubble Space Telescope launches","First ISS module launches","James Webb Space Telescope launches"]},{"key":"internet-launches","title":"Internet brands","prompt":"Order these services by launch year.","direction":"Oldest → Newest","items":["Amazon","eBay","Google","Wikipedia","LinkedIn","Facebook","YouTube","Twitter / X","WhatsApp","Instagram"]},{"key":"books-publication","title":"Classic books","prompt":"Order these books by first publication.","direction":"Oldest → Newest","items":["Don Quixote","Robinson Crusoe","Pride and Prejudice","Frankenstein","Moby-Dick","Alice's Adventures in Wonderland","Dracula","Nineteen Eighty-Four","The Fellowship of the Ring","Harry Potter and the Philosopher's Stone"]},{"key":"skyscrapers-completion","title":"Skyscraper timeline","prompt":"Order these skyscrapers by completion.","direction":"Oldest → Newest","items":["Flatiron Building","Woolworth Building","Chrysler Building","Empire State Building","Original World Trade Center","Sears / Willis Tower","Petronas Towers","Taipei 101","Burj Khalifa","Shanghai Tower"]}];

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  function utcDate(){
    return new Date().toISOString().slice(0,10);
  }

  function resolveDate(options={}){
    const raw=String(options?.date||"").slice(0,10);
    if(!raw) return utcDate();
    if(raw===utcDate()) return raw;
    const past=BrainiData.pastDailyDate?.(raw);
    if(past) return past;
    throw new Error("Invalid Daily archive date.");
  }

  function numberForDate(date){
    return BrainiData.dailyNumberForDate?.(date) || BrainiData.daily().number;
  }

  function hash(text){
    let h=2166136261;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function shuffled(items,seed){
    const a=items.slice();
    let state=hash(seed)||1;
    for(let i=a.length-1;i>0;i--){
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      const j=state%(i+1);
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }


  async function withTimeout(promise){
    return Promise.race([
      promise,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("Daily game request timed out")),REQUEST_TIMEOUT_MS))
    ]);
  }


  function scoreOrder(round,orderedItemIds){
    const canonical=new Map(
      (round.canonicalItems||round.items||[]).map(
        (item,index)=>[item.itemId,index+1]
      )
    );

    const submitted=orderedItemIds
      .map(id=>canonical.has(id)?id:null)
      .filter(Boolean);

    if(submitted.length!==10 || new Set(submitted).size!==10){
      throw new Error("Order Up requires all 10 items.");
    }

    let exact=0;
    let pairs=0;

    submitted.forEach((id,index)=>{
      if(canonical.get(id)===index+1) exact++;
    });

    for(let i=0;i<submitted.length;i++){
      for(let j=i+1;j<submitted.length;j++){
        if(canonical.get(submitted[i])<canonical.get(submitted[j])){
          pairs++;
        }
      }
    }

    return {
      exactPositions:exact,
      correctPairs:pairs,
      totalPairs:45,
      score:Math.round(pairs/45*1250),
      accuracy:Math.round(pairs/45*100)
    };
  }

  function fallbackOrderUp(date=utcDate()){
    const selected=shuffled(
      ORDER_UP_ROUNDS,
      date+":orderup-rounds"
    ).slice(0,2);

    return {
      source:"local",
      dailyChallengeId:null,
      dailyNumber:numberForDate(date),
      challengeDate:date,
      totalRounds:2,
      itemsPerRound:10,
      rounds:selected.map((round,roundIndex)=>{
        const canonicalItems=round.items.map((label,index)=>({
          itemId:`local-orderup-${round.key}-${index+1}`,
          label
        }));

        return {
          roundId:`local-${round.key}`,
          position:roundIndex+1,
          title:round.title,
          prompt:round.prompt,
          directionLabel:round.direction,
          canonicalItems,
          items:shuffled(
            canonicalItems,
            `${date}:${round.key}:shuffle`
          )
        };
      })
    };
  }

  async function loadOrderUp(options={}){
    const date=resolveDate(options);
    const archive=date<utcDate();
    if(configured()){
      try{
        const {data,error}=await withTimeout(
          archive
            ? client().rpc("get_brainilab_daily_order_up_archive",{p_challenge_date:date})
            : client().rpc("get_brainilab_daily_order_up")
        );
        if(error) throw error;

        if(data?.rounds?.length===2){
          return {
            source:"supabase",
            dailyChallengeId:data.daily_challenge_id,
            dailyNumber:data.daily_number,
            challengeDate:data.challenge_date,
            totalRounds:2,
            itemsPerRound:10,
            rounds:data.rounds.map(round=>({
              roundId:round.round_id,
              position:Number(round.position),
              title:round.title,
              prompt:round.prompt,
              directionLabel:round.direction_label,
              items:(round.items||[]).map(item=>({
                itemId:item.item_id,
                label:item.label
              }))
            }))
          };
        }
      }catch(err){
        console.warn(
          "Order Up cloud Daily unavailable:",
          err.message||err
        );
      }
    }

    return fallbackOrderUp(date);
  }

  async function checkOrderUpRound(content,round,orderedItemIds){
    if(content.source==="supabase" && configured()){
      const {data,error}=await client().rpc(
        "check_brainilab_order_up_round",
        {
          p_daily_challenge_id:content.dailyChallengeId,
          p_round_id:round.roundId,
          p_item_ids:orderedItemIds
        }
      );

      if(error) throw error;

      return {
        score:Number(data.score||0),
        exactPositions:Number(data.exact_positions||0),
        correctPairs:Number(data.correct_pairs||0),
        totalPairs:Number(data.total_pairs||45),
        accuracy:Number(data.accuracy||0),
        correctOrder:data.correct_order||[]
      };
    }

    const local=scoreOrder(round,orderedItemIds);
    return {
      ...local,
      correctOrder:(round.canonicalItems||[]).map(item=>({
        item_id:item.itemId,
        label:item.label
      }))
    };
  }

  function fallbackBrainiWord(date=utcDate()){
    const word=shuffled(WORDS,date+":word")[0];
    return {
      source:"local",
      dailyChallengeId:null,
      dailyNumber:numberForDate(date),
      challengeDate:date,
      letters:5,
      attempts:5,
      fallbackAnswer:word
    };
  }


  function normalizeTopicRush(value){
    return String(value||"")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,"");
  }

  function fallbackTopicRush(date=utcDate()){
    const topic=shuffled(TOPIC_RUSH_TOPICS,date+":topicrush")[0];
    return {
      source:"local",
      dailyChallengeId:null,
      dailyNumber:numberForDate(date),
      challengeDate:date,
      topicId:"local-"+topic.key,
      title:topic.title,
      prompt:topic.prompt,
      targetCount:topic.target,
      durationSeconds:60,
      localAnswers:topic.answers
    };
  }

  async function loadTopicRush(options={}){
    const date=resolveDate(options);
    const archive=date<utcDate();
    if(configured()){
      try{
        const {data,error}=await withTimeout(
          archive
            ? client().rpc("get_brainilab_daily_topic_rush_archive",{p_challenge_date:date})
            : client().rpc("get_brainilab_daily_topic_rush")
        );
        if(error) throw error;
        if(data?.daily_challenge_id && data?.title){
          return {
            source:"supabase",
            dailyChallengeId:data.daily_challenge_id,
            dailyNumber:data.daily_number,
            challengeDate:data.challenge_date,
            topicId:data.topic_id,
            title:data.title,
            prompt:data.prompt,
            targetCount:Number(data.target_count||15),
            durationSeconds:Number(data.duration_seconds||60)
          };
        }
      }catch(err){
        console.warn("Topic Rush cloud Daily unavailable:",err.message||err);
      }
    }
    return fallbackTopicRush(date);
  }

  async function checkTopicRushAnswer(content,guess){
    if(content.source==="supabase" && configured()){
      const {data,error}=await client().rpc(
        "check_brainilab_topic_rush_answer",
        {
          p_daily_challenge_id:content.dailyChallengeId,
          p_guess:String(guess||"")
        }
      );
      if(error) throw error;
      return {
        valid:!!data.valid,
        reason:data.reason||null,
        answerId:data.answer_id||null,
        canonicalAnswer:data.canonical_answer||null
      };
    }

    const norm=normalizeTopicRush(guess);
    const row=(content.localAnswers||[]).find(item=>{
      if(normalizeTopicRush(item.answer)===norm) return true;
      return (item.aliases||[]).some(a=>normalizeTopicRush(a)===norm);
    });

    return row
      ? {
          valid:true,
          answerId:"local-"+normalizeTopicRush(row.answer),
          canonicalAnswer:row.answer
        }
      : {
          valid:false,
          reason:"not_in_list",
          answerId:null,
          canonicalAnswer:null
        };
  }

  async function loadBrainiWord(options={}){
    const date=resolveDate(options);
    const archive=date<utcDate();
    if(configured()){
      try{
        const {data,error}=await withTimeout(
          archive
            ? client().rpc("get_brainilab_daily_brainiword_archive",{p_challenge_date:date})
            : client().rpc("get_brainilab_daily_brainiword")
        );
        if(error) throw error;
        if(data?.daily_challenge_id){
          return {
            source:"supabase",
            dailyChallengeId:data.daily_challenge_id,
            dailyNumber:data.daily_number,
            challengeDate:data.challenge_date,
            letters:5,
            attempts:5,
            contentRef:data.content_ref||null
          };
        }
      }catch(err){
        console.warn("BrainiWord cloud Daily unavailable:",err.message||err);
      }
    }
    return fallbackBrainiWord(date);
  }

  function evaluateLocalWord(answer,guess){
    const target=answer.split("");
    const chars=guess.split("");
    const states=Array(5).fill("absent");
    const remaining={};

    for(let i=0;i<5;i++){
      if(chars[i]===target[i]) states[i]="correct";
      else remaining[target[i]]=(remaining[target[i]]||0)+1;
    }
    for(let i=0;i<5;i++){
      if(states[i]==="correct") continue;
      if((remaining[chars[i]]||0)>0){
        states[i]="present";
        remaining[chars[i]]--;
      }
    }
    return states;
  }

  async function checkBrainiWordGuess(content,guess,attempt){
    guess=String(guess||"").toUpperCase();

    if(content.source==="supabase" && configured()){
      const {data,error}=await client().rpc("check_brainilab_brainiword_guess",{
        p_daily_challenge_id:content.dailyChallengeId,
        p_guess:guess,
        p_attempt:attempt
      });
      if(error) throw error;
      return {
        validWord:data.valid_word!==false,
        message:data.message||null,
        states:data.states||[],
        won:!!data.won,
        finished:!!data.finished,
        answer:data.answer||null
      };
    }

    const states=evaluateLocalWord(content.fallbackAnswer,guess);
    const won=states.every(s=>s==="correct");
    const finished=won||attempt>=5;
    return {
      validWord:true,
      message:null,
      states,
      won,
      finished,
      answer:finished?content.fallbackAnswer:null
    };
  }

  async function verifyResult(result,gameContent){
    if(!result?.clientResultId || !gameContent?.dailyChallengeId) return {verified:false,reason:"missing_ids"};
    if(!configured()) return {verified:false,reason:"not_configured"};

    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:false,reason:"not_authenticated"};
    if(result.cloudSyncStatus!=="synced") return {verified:false,reason:"result_not_synced"};

    let rpc,args;
    if(result.gameId==="orderup"){
      rpc="verify_brainilab_order_up_result";
      args={
        p_client_result_id:result.clientResultId,
        p_daily_challenge_id:gameContent.dailyChallengeId,
        p_rounds:result.orderUpRounds||[]
      };
    }else if(result.gameId==="flagdash"){
      // Legacy verification remains for pre-Order-Up Daily results.
      rpc="verify_brainilab_flagdash_result";
      args={
        p_client_result_id:result.clientResultId,
        p_daily_challenge_id:gameContent.dailyChallengeId,
        p_answers:result.flagAnswers||[]
      };
    }else if(result.gameId==="maphunt"){
      rpc="verify_brainilab_maphunt_result";
      args={
        p_client_result_id:result.clientResultId,
        p_daily_challenge_id:gameContent.dailyChallengeId,
        p_answers:result.mapAnswers||[]
      };
    }else if(result.gameId==="topicrush"){
      rpc="verify_brainilab_topic_rush_result";
      args={
        p_client_result_id:result.clientResultId,
        p_daily_challenge_id:gameContent.dailyChallengeId,
        p_answers:result.topicRushAnswers||[]
      };
    }else if(result.gameId==="brainiword"){
      rpc="verify_brainilab_brainiword_result";
      args={
        p_client_result_id:result.clientResultId,
        p_daily_challenge_id:gameContent.dailyChallengeId,
        p_guesses:result.brainiwordGuesses||[]
      };
    }else{
      return {verified:false,reason:"unsupported_game"};
    }

    const {data,error}=await client().rpc(rpc,args);
    if(error) throw error;

    await BrainiData.api.markDailyGameVerified(result.clientResultId,data||{});
    return {verified:true,...(data||{})};
  }

  async function syncPendingVerifications(){
    if(!configured()) return {verified:0,failed:0};
    const session=await BrainiBackendAuth.getSession();
    if(!session?.user) return {verified:0,failed:0};

    const pending=await BrainiData.api.getPendingDailyGameVerifications();
    let verified=0,failed=0;

    for(const result of pending){
      try{
        const content={
          dailyChallengeId:result.dailyChallengeId
        };
        const response=await verifyResult(result,content);
        if(response.verified) verified++;
      }catch(err){
        failed++;
        console.warn("Pending Daily Game verification:",err.message||err);
      }
    }

    return {verified,failed};
  }

  return {
    loadOrderUp,
    checkOrderUpRound,
    loadTopicRush,
    checkTopicRushAnswer,
    loadBrainiWord,
    checkBrainiWordGuess,
    verifyResult,
    syncPendingVerifications
  };
})();
