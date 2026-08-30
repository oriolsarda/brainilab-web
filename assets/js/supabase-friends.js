/*
  BrainiLab Friends — Step 8 backend adapter
  ------------------------------------------
  Real Supabase friendships, requests, friend invites and Friends Ranking.
*/
window.BrainiFriends=(function(){
  let cached=null;
  let lastError=null;
  let syncing=false;

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

  async function ready(){
    const current=await session();
    return !!current?.user;
  }

  function normalizeSnapshot(data){
    const friends=(data?.friends||[]).map(f=>({
      id:f.user_id,
      userId:f.user_id,
      name:f.name||"Braini Player",
      country:f.country||"",
      avatar:f.avatar||((f.name||"B")[0]||"B").toUpperCase(),
      avatarUrl:f.avatar_url||null,
      currentStreak:Number(f.current_streak||0),
      bestStreak:Number(f.best_streak||0),
      xp:Number(f.xp||0),
      level:Number(f.level||1),
      dailyScore:Number(f.daily_score||0),
      dailyGamesCompleted:Number(f.daily_games_completed||0),
      fullDaily:!!f.full_daily,
      weeklyScore:Number(f.weekly_score||0),
      monthlyScore:Number(f.monthly_score||0),
      friendsSince:f.friends_since||null,
      status:"accepted",
      cloud:true
    }));

    const mapRequest=(r,direction)=>({
      id:r.id,
      userId:r.user_id,
      name:r.name||"Braini Player",
      country:r.country||"",
      avatar:r.avatar||((r.name||"B")[0]||"B").toUpperCase(),
      avatarUrl:r.avatar_url||null,
      direction,
      createdAt:r.created_at||null,
      cloud:true
    });

    return {
      friendCode:data?.friend_code||null,
      friends,
      incoming:(data?.incoming||[]).map(r=>mapRequest(r,"incoming")),
      outgoing:(data?.outgoing||[]).map(r=>mapRequest(r,"outgoing")),
      friendCount:Number(data?.friend_count??friends.length),
      incomingCount:Number(data?.incoming_count??0),
      outgoingCount:Number(data?.outgoing_count??0),
      generatedAt:data?.generated_at||new Date().toISOString()
    };
  }

  async function refresh(){
    if(syncing) return cached;
    if(!(await ready())) return null;

    syncing=true;
    lastError=null;

    try{
      const {data,error}=await client().rpc("get_my_brainilab_friends");
      if(error) throw error;

      cached=normalizeSnapshot(data||{});
      await BrainiData.api.syncCloudFriends(cached);

      window.dispatchEvent(new CustomEvent("brainilab:friendschange",{
        detail:{snapshot:cached}
      }));

      return cached;
    }catch(err){
      lastError=err;
      console.warn("BrainiLab friends sync:",err.message||err);
      return null;
    }finally{
      syncing=false;
    }
  }

  async function sendRequest(friendCode){
    if(!(await ready())) throw new Error("Sign in to add friends.");

    const {data,error}=await client().rpc("send_brainilab_friend_request",{
      p_friend_code:String(friendCode||"").trim().toUpperCase()
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function acceptRequest(requestId){
    if(!(await ready())) throw new Error("Sign in to manage friends.");

    const {data,error}=await client().rpc("accept_brainilab_friend_request",{
      p_request_id:requestId
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function declineRequest(requestId){
    if(!(await ready())) throw new Error("Sign in to manage friends.");

    const {error}=await client().rpc("decline_brainilab_friend_request",{
      p_request_id:requestId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function cancelRequest(requestId){
    if(!(await ready())) throw new Error("Sign in to manage friends.");

    const {error}=await client().rpc("cancel_brainilab_friend_request",{
      p_request_id:requestId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function remove(friendUserId){
    if(!(await ready())) throw new Error("Sign in to manage friends.");

    const {error}=await client().rpc("remove_brainilab_friend",{
      p_friend_user_id:friendUserId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function acceptInvite(friendCode){
    if(!(await ready())) throw new Error("Sign in to accept this invite.");

    const {data,error}=await client().rpc("accept_brainilab_friend_invite",{
      p_friend_code:String(friendCode||"").trim().toUpperCase()
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function ranking(filters={}){
    if(!(await ready())) return null;

    const {data,error}=await client().rpc("get_my_brainilab_friends_ranking",{
      p_period:filters.period||"daily",
      p_game_id:filters.gameId||"all",
      p_metric:filters.metric||"score"
    });

    if(error) throw error;

    return {
      rows:(data?.rows||[]).map(r=>({
        rank:Number(r.rank||0),
        id:r.user_id,
        userId:r.user_id,
        name:r.name||"Braini Player",
        country:r.country||"",
        avatar:r.avatar||((r.name||"B")[0]||"B").toUpperCase(),
        avatarUrl:r.avatar_url||null,
        score:Number(r.score||0),
        streak:Number(r.streak||0),
        level:Number(r.level||1),
        displayValue:r.display_value||null,
        isMe:!!r.is_me
      })),
      user:data?.user ? {
        rank:Number(data.user.rank||0),
        id:data.user.user_id,
        userId:data.user.user_id,
        name:data.user.name||"You",
        country:data.user.country||"",
        avatar:data.user.avatar||"B",
        avatarUrl:data.user.avatar_url||null,
        score:Number(data.user.score||0),
        streak:Number(data.user.streak||0),
        level:Number(data.user.level||1),
        displayValue:data.user.display_value||null,
        isMe:true
      } : null,
      metricLabel:data?.metric_label||"Score",
      totalPlayers:Number(data?.total_players||0),
      cloud:true
    };
  }

  function getCached(){
    return cached ? JSON.parse(JSON.stringify(cached)) : null;
  }

  function getLastError(){
    return lastError;
  }

  return {
    configured,
    ready,
    refresh,
    sendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    remove,
    acceptInvite,
    ranking,
    getCached,
    getLastError
  };
})();
