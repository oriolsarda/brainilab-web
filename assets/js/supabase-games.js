/*
  BrainiLab Cloud Games — Step 3 backend
  --------------------------------------
  Persists completed game sessions/results through a controlled Supabase RPC.

  Guest/offline behavior:
  - BrainiData records the result locally first.
  - Results created in Step 3 carry a stable clientResultId.
  - If no authenticated Supabase session exists, the result stays pending.
  - After sign-in, syncPendingResults() uploads those same results idempotently.
*/
window.BrainiCloudGames = (function(){
  let syncing=false;
  let lastError=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  function cleanNumber(value){
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function currentPackContext(){
    const params=new URLSearchParams(location.search);
    const difficulty=(params.get("difficulty")||"").toLowerCase();
    const set=Number(params.get("set")||"");

    return {
      difficulty:["easy","medium","hard"].includes(difficulty) ? difficulty : null,
      setNumber:Number.isInteger(set) && set>0 ? set : null
    };
  }

  function compactPayload(result={}){
    const blocked=new Set([
      "id","clientResultId","cloudSyncStatus","cloudSessionId",
      "cloudResultId","cloudSyncedAt","recordedAtStep","results","answerDetails"
    ]);

    const payload={};
    Object.entries(result).forEach(([key,value])=>{
      if(blocked.has(key)) return;
      if(value===undefined) return;

      if(Array.isArray(value)){
        // Keep small game-specific arrays such as BrainiWord pattern.
        if(value.length<=40) payload[key]=value;
        return;
      }

      if(value && typeof value==="object"){
        const txt=JSON.stringify(value);
        if(txt.length<=3000) payload[key]=value;
        return;
      }

      payload[key]=value;
    });

    return payload;
  }

  function correctnessArray(result={}){
    return Array.isArray(result.results)
      ? result.results.slice(0,100).map(v=>typeof v==="boolean"?v:null)
      : [];
  }

  async function currentUser(){
    if(!configured()) return null;
    const session=await BrainiBackendAuth.getSession();
    return session?.user||null;
  }

  async function saveCompletedResult(gameId,result){
    lastError=null;

    if(!configured()) return {saved:false,reason:"not_configured"};
    const user=await currentUser();
    if(!user) return {saved:false,reason:"not_authenticated"};

    if(!result?.clientResultId){
      throw new Error("Missing client result ID.");
    }

    const sb=client();
    const pack=currentPackContext();

    const durationMs=
      Number.isFinite(Number(result.timeSec))
        ? Math.max(0,Math.round(Number(result.timeSec)*1000))
        : Number.isFinite(Number(result.durationMs))
          ? Math.max(0,Math.round(Number(result.durationMs)))
          : null;

    const score=cleanNumber(result.score);
    const correct=cleanNumber(result.correct);
    const total=cleanNumber(result.total);
    const accuracy=cleanNumber(result.accuracy);
    const percentile=cleanNumber(result.percentile);

    const {data,error}=await sb.rpc("submit_brainilab_game_result",{
      p_client_result_id:result.clientResultId,
      p_game_id:gameId,
      p_played_at:result.playedAt||new Date().toISOString(),
      p_score:score===null?null:Math.round(score),
      p_correct_answers:correct===null?null:Math.round(correct),
      p_total_questions:total===null?null:Math.round(total),
      p_accuracy:accuracy,
      p_duration_ms:durationMs,
      p_client_percentile:percentile===null?null:Math.round(percentile),
      p_daily_number:Number.isFinite(Number(result.dailyNumber))?Math.round(Number(result.dailyNumber)):null,
      p_difficulty:result.difficulty||pack.difficulty,
      p_set_number:Number.isFinite(Number(result.setNumber))
        ? Math.round(Number(result.setNumber))
        : pack.setNumber,
      p_result_payload:compactPayload(result),
      p_answer_correctness:correctnessArray(result)
    });

    if(error){
      lastError=error;
      throw error;
    }

    const row=Array.isArray(data)?data[0]:data;
    const cloud={
      sessionId:row?.session_id||null,
      resultId:row?.result_id||null,
      alreadyExisted:!!row?.already_existed
    };

    await BrainiData.api.markResultCloudSynced(result.clientResultId,cloud);

    window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
      detail:{type:"result_synced",gameId,clientResultId:result.clientResultId,cloud}
    }));

    return {saved:true,...cloud};
  }

  async function syncPendingResults(){
    if(syncing || !configured()) return {synced:0,failed:0};
    const user=await currentUser();
    if(!user) return {synced:0,failed:0};

    syncing=true;
    let synced=0;
    let failed=0;

    try{
      const pending=await BrainiData.api.getPendingCloudResults();

      for(const result of pending){
        try{
          const response=await saveCompletedResult(result.gameId,result);
          if(response.saved) synced++;
        }catch(err){
          failed++;
          lastError=err;
          // Keep the result pending. Continue syncing the rest.
          console.warn("BrainiLab pending result sync:",err.message||err);
        }
      }
    }finally{
      syncing=false;
    }

    if(synced){
      window.dispatchEvent(new CustomEvent("brainilab:cloudgame",{
        detail:{type:"pending_sync_complete",synced,failed}
      }));
    }

    return {synced,failed};
  }

  async function getMyRecentResults(limit=20){
    if(!configured()) return [];
    const user=await currentUser();
    if(!user) return [];

    const sb=client();
    const safeLimit=Math.min(100,Math.max(1,Number(limit)||20));

    const {data,error}=await sb
      .from("game_sessions")
      .select(`
        id,
        client_result_id,
        game_id,
        difficulty,
        set_number,
        daily_number,
        started_at,
        completed_at,
        game_results (
          id,
          score,
          correct_answers,
          total_questions,
          accuracy,
          duration_ms,
          client_percentile,
          server_verified,
          result_payload
        )
      `)
      .eq("user_id",user.id)
      .order("completed_at",{ascending:false})
      .limit(safeLimit);

    if(error){
      lastError=error;
      throw error;
    }

    return data||[];
  }

  function getLastError(){
    return lastError;
  }

  function isSyncing(){
    return syncing;
  }

  return {
    configured,
    saveCompletedResult,
    syncPendingResults,
    getMyRecentResults,
    getLastError,
    isSyncing
  };
})();
