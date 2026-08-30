/*
  BrainiLab Player Analytics — Step 17
  Private cloud adapter for My BrainiLab → My Stats.
*/
window.BrainiAnalytics=(function(){
  const cache=new Map();
  let lastError=null;
  let loading=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  async function session(){
    if(!configured()) return null;
    return BrainiBackendAuth.getSession();
  }

  function normalizeDays(days){
    const n=Number(days);
    if(n===0) return 0;
    if(n===7 || n===30 || n===90) return n;
    return 30;
  }

  async function fetchStats(days=30,{force=false}={}){
    const range=normalizeDays(days);

    if(!configured()){
      return null;
    }

    const current=await session();
    if(!current?.user){
      return null;
    }

    if(!force && cache.has(range)){
      return structuredClone(cache.get(range));
    }

    if(loading && loading.range===range){
      return loading.promise;
    }

    lastError=null;

    const promise=(async()=>{
      const sb=client();

      const {data,error}=await sb.rpc(
        "get_my_brainilab_stats",
        {p_days:range}
      );

      if(error){
        lastError=error;
        throw error;
      }

      const snapshot=data||{};
      cache.set(range,snapshot);

      window.dispatchEvent(
        new CustomEvent(
          "brainilab:analyticschange",
          {
            detail:{
              range,
              snapshot
            }
          }
        )
      );

      return structuredClone(snapshot);
    })();

    loading={range,promise};

    try{
      return await promise;
    }finally{
      if(loading?.promise===promise){
        loading=null;
      }
    }
  }

  function getCached(days=30){
    const range=normalizeDays(days);
    const value=cache.get(range);
    return value?structuredClone(value):null;
  }

  function invalidate(){
    cache.clear();
  }

  function getLastError(){
    return lastError;
  }

  window.addEventListener(
    "brainilab:authchange",
    invalidate
  );

  window.addEventListener(
    "brainilab:cloudgame",
    invalidate
  );

  window.addEventListener(
    "brainilab:progressionchange",
    invalidate
  );

  return {
    configured,
    fetchStats,
    getCached,
    invalidate,
    getLastError
  };
})();
