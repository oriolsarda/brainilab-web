/*
  BrainiLab Content Health tracker — V41.8.0
  One lightweight start RPC + sparse checkpoints + one completion RPC.
  Authenticated cloud players only; gameplay never blocks on analytics.
*/
window.BrainiContentHealth=(function(){
  function configured(){return !!window.BrainiBackendAuth?.isConfigured?.()}
  function client(){return window.BrainiBackendAuth?.getClient?.()||null}
  function id(){
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `play-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  }
  async function signedIn(){
    if(!configured()) return false;
    try{return !!(await BrainiBackendAuth.getSession?.())?.user}catch{return false}
  }
  function cleanIds(ids){
    return [...new Set((ids||[]).map(v=>String(v||"").trim()).filter(Boolean))].slice(0,60);
  }
  function create({gameId,contentType,contentIds,dailyNumber=null}={}){
    if(new URLSearchParams(location.search).get("try")==="1") return {clientPlayId:null,start:async()=>false,checkpoint:async()=>{},complete:async()=>{},contentIds:cleanIds(contentIds)};
    const clientPlayId=id();
    const ids=cleanIds(contentIds);
    let started=false,startPromise=null,lastSent=0,lastAt=0,completed=false;

    async function start(){
      if(startPromise) return startPromise;
      startPromise=(async()=>{
        if(!gameId||!contentType||!ids.length||!(await signedIn())) return false;
        try{
          const {error}=await client().rpc("start_brainilab_content_play",{
            p_client_play_id:clientPlayId,
            p_game_id:gameId,
            p_content_type:contentType,
            p_content_ids:ids,
            p_daily_number:Number.isFinite(Number(dailyNumber))?Number(dailyNumber):null
          });
          if(error) throw error;
          started=true;
          return true;
        }catch(err){
          console.warn("BrainiLab content health start:",err.message||err);
          return false;
        }
      })();
      return startPromise;
    }

    async function checkpoint(position,{force=false}={}){
      if(completed) return;
      const pos=Math.max(1,Math.min(ids.length,Number(position)||1));
      const now=Date.now();
      // Sparse checkpoints: every 3 items or every 25 seconds.
      if(!force && pos-lastSent<3 && now-lastAt<25000) return;
      if(!(await start())) return;
      try{
        const {error}=await client().rpc("checkpoint_brainilab_content_play",{
          p_client_play_id:clientPlayId,
          p_last_position:pos
        });
        if(error) throw error;
        lastSent=pos;lastAt=now;
      }catch(err){console.warn("BrainiLab content health checkpoint:",err.message||err)}
    }

    async function complete(outcomes=[]){
      if(completed) return;
      completed=true;
      if(!(await start())) return;
      const clean=(outcomes||[]).slice(0,60).map((x,i)=>({
        content_id:String(x.contentId||ids[i]||""),
        position:Number(x.position||i+1),
        attempts:x.attempts==null?null:Math.max(1,Number(x.attempts)||1),
        is_correct:x.isCorrect==null?null:!!x.isCorrect,
        skipped:!!x.skipped,
        score:x.score==null?null:Number(x.score),
        response_time_ms:x.responseTimeMs==null?null:Math.max(0,Math.round(Number(x.responseTimeMs)||0))
      })).filter(x=>x.content_id);
      try{
        const lastPosition=Math.max(1,Math.min(ids.length,clean.reduce((m,x)=>Math.max(m,Number(x.position)||0),lastSent||1)));
        const {error}=await client().rpc("complete_brainilab_content_play",{
          p_client_play_id:clientPlayId,
          p_last_position:lastPosition,
          p_outcomes:clean
        });
        if(error) throw error;
      }catch(err){console.warn("BrainiLab content health complete:",err.message||err)}
    }

    start();
    return {clientPlayId,start,checkpoint,complete,contentIds:ids};
  }

  return {create};
})();
