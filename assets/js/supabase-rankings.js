/*
  BrainiLab Final Rankings — Step 10
  ---------------------------------
  Real Individual public opt-in leaderboard adapter.
*/
window.BrainiRankingsCloud=(function(){
  let lastError=null;

  function configured(){
    return !!window.BrainiBackendAuth?.isConfigured?.();
  }

  function client(){
    return window.BrainiBackendAuth?.getClient?.()||null;
  }

  function normalizeRow(r){
    return {
      rank:Number(r.rank||0),
      name:r.name||"Braini Player",
      country:r.country||"",
      avatar:r.avatar||((r.name||"B")[0]||"B").toUpperCase(),
      avatarUrl:r.avatar_url||null,
      score:Number(r.score||0),
      streak:Number(r.streak||0),
      level:Number(r.level||1),
      displayValue:r.display_value||null,
      isMe:!!r.is_me,
      cloud:true
    };
  }

  async function individual(filters={}){
    if(!configured()) return null;

    const auth=BrainiData.authState();
    const country=(
      auth.status==="authenticated"
      ? BrainiData.player()?.countryCode||null
      : null
    );

    const {data,error}=await client().rpc(
      "get_brainilab_individual_rankings",
      {
        p_region:filters.region||"global",
        p_country_code:filters.region==="country" ? country : null,
        p_period:filters.period||"daily",
        p_game_id:filters.gameId||"all",
        p_metric:filters.metric||"score",
        p_limit:100
      }
    );

    if(error){
      lastError=error;
      throw error;
    }

    lastError=null;

    return {
      rows:(data?.rows||[]).map(normalizeRow),
      user:data?.user ? normalizeRow(data.user) : null,

      totalPlayers:Number(data?.total_players||0),
      metricLabel:data?.metric_label||"Score",

      leaderboardEnabled:!!data?.leaderboard_enabled,
      leaderboardDisplayName:data?.leaderboard_display_name||null,
      userEligible:!!data?.user_eligible,

      countryRequired:!!data?.country_required,
      myCountry:data?.my_country||null,
      country:data?.country||null,

      cloud:true
    };
  }

  function getLastError(){
    return lastError;
  }

  return {
    configured,
    individual,
    getLastError
  };
})();
