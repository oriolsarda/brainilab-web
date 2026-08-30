/*
  BrainiLab Cloud Progression — Step 6 backend
  --------------------------------------------
  Reads authoritative progression aggregates from PostgreSQL.

  Cloud authority:
  - current/best streak
  - XP + level
  - total games/questions
  - Full Daily count
  - Daily Brain Score + 4-game breakdown
  - weekly/monthly aggregates
  - personal bests
*/
window.BrainiProgression = (function(){
  let cached=null;
  let lastError=null;
  let syncing=false;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.() || null;
  }

  async function session(){
    if(!configured()) return null;
    return BrainiBackendAuth.getSession();
  }

  async function fetchSummary(){
    const current=await session();
    if(!current?.user) return null;

    const sb=client();
    const {data,error}=await sb.rpc("get_my_brainilab_progression");

    if(error) throw error;
    return data||null;
  }

  async function sync(){
    if(syncing) return cached;
    if(!configured()) return null;

    const current=await session();
    if(!current?.user) return null;

    syncing=true;
    lastError=null;

    try{
      const summary=await fetchSummary();

      if(summary){
        cached=summary;
        await BrainiData.api.syncCloudProgression(summary);

        window.dispatchEvent(new CustomEvent("brainilab:progressionchange",{
          detail:{summary}
        }));
      }

      return summary;
    }catch(err){
      lastError=err;
      console.warn("BrainiLab progression sync:",err.message||err);
      return null;
    }finally{
      syncing=false;
    }
  }

  function getCached(){
    return cached ? JSON.parse(JSON.stringify(cached)) : null;
  }

  function getLastError(){
    return lastError;
  }

  function isSyncing(){
    return syncing;
  }

  return {
    configured,
    fetchSummary,
    sync,
    getCached,
    getLastError,
    isSyncing
  };
})();
