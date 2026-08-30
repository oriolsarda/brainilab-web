/*
  BrainiLab Groups — Step 9 backend adapter
  -----------------------------------------
  Real Supabase groups, membership, invites and Group Rankings.
*/
window.BrainiGroups=(function(){
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

  function normalizeGroup(g){
    const members=(g.members||[]).map(m=>({
      id:m.user_id,
      userId:m.user_id,
      name:m.name||"Braini Player",
      avatar:m.avatar||((m.name||"B")[0]||"B").toUpperCase(),
      avatarUrl:m.avatar_url||null,
      country:m.country||"",
      role:m.role||"member",
      currentStreak:Number(m.current_streak||0),
      xp:Number(m.xp||0),
      level:Number(m.level||1),
      dailyScore:Number(m.daily_score||0),
      joinedAt:m.joined_at||null
    }));

    const pendingInvites=(g.pending_invites||[]).map(i=>({
      id:i.id,
      userId:i.user_id,
      name:i.name||"Braini Player",
      avatar:i.avatar||((i.name||"B")[0]||"B").toUpperCase(),
      country:i.country||"",
      createdAt:i.created_at||null
    }));

    return {
      id:g.id,
      name:g.name||"Unnamed group",
      country:g.country||"",
      ownerId:g.owner_id,
      myRole:g.my_role||"member",
      crest:{
        icon:g.crest?.icon||"⚡",
        color:g.crest?.color||"#FFD813"
      },
      inviteCode:g.invite_code||null,
      memberCount:Number(g.member_count??members.length),
      eligible:!!g.eligible,
      currentStreak:Number(g.current_streak||0),
      dailyScore:Number(g.daily_score||0),
      dailyActiveMembers:Number(g.daily_active_members||0),
      weeklyScore:Number(g.weekly_score||0),
      monthlyScore:Number(g.monthly_score||0),
      members,
      pendingInvites,
      createdAt:g.created_at||null,
      cloud:true
    };
  }

  function normalizeSnapshot(data){
    return {
      groups:(data?.groups||[]).map(normalizeGroup),
      receivedInvites:(data?.received_invites||[]).map(i=>({
        id:i.id,
        groupId:i.group_id,
        groupName:i.group_name||"BrainiLab group",
        country:i.country||"",
        crest:{
          icon:i.crest?.icon||"⚡",
          color:i.crest?.color||"#FFD813"
        },
        inviterId:i.inviter_id,
        inviterName:i.inviter_name||"Braini Player",
        memberCount:Number(i.member_count||0),
        createdAt:i.created_at||null
      })),
      groupCount:Number(data?.group_count||0),
      generatedAt:data?.generated_at||new Date().toISOString()
    };
  }

  async function refresh(){
    if(syncing) return cached;
    if(!(await ready())) return null;

    syncing=true;
    lastError=null;

    try{
      const {data,error}=await client().rpc("get_my_brainilab_groups");
      if(error) throw error;

      cached=normalizeSnapshot(data||{});
      await BrainiData.api.syncCloudGroups(cached);

      window.dispatchEvent(new CustomEvent("brainilab:groupschange",{
        detail:{snapshot:cached}
      }));

      return cached;
    }catch(err){
      lastError=err;
      console.warn("BrainiLab groups sync:",err.message||err);
      return null;
    }finally{
      syncing=false;
    }
  }

  async function create(payload={}){
    if(!(await ready())) throw new Error("Sign in to create a group.");

    const {data,error}=await client().rpc("create_brainilab_group",{
      p_name:String(payload.name||"").trim(),
      p_country_code:String(payload.country||"").trim().toUpperCase(),
      p_crest_icon:payload.icon||"⚡",
      p_crest_color:payload.color||"#FFD813",
      p_friend_ids:Array.isArray(payload.friendIds)?payload.friendIds:[]
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function update(groupId,payload={}){
    if(!(await ready())) throw new Error("Sign in to edit a group.");

    const {error}=await client().rpc("update_brainilab_group",{
      p_group_id:groupId,
      p_name:String(payload.name||"").trim(),
      p_country_code:String(payload.country||"").trim().toUpperCase(),
      p_crest_icon:payload.icon||"⚡",
      p_crest_color:payload.color||"#FFD813"
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function inviteFriend(groupId,friendUserId){
    if(!(await ready())) throw new Error("Sign in to invite group members.");

    const {data,error}=await client().rpc("invite_brainilab_friend_to_group",{
      p_group_id:groupId,
      p_friend_user_id:friendUserId
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function acceptInvite(inviteId){
    if(!(await ready())) throw new Error("Sign in to join this group.");

    const {data,error}=await client().rpc("accept_brainilab_group_invite",{
      p_invite_id:inviteId
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function declineInvite(inviteId){
    if(!(await ready())) throw new Error("Sign in to manage group invites.");

    const {error}=await client().rpc("decline_brainilab_group_invite",{
      p_invite_id:inviteId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function cancelInvite(inviteId){
    if(!(await ready())) throw new Error("Sign in to manage group invites.");

    const {error}=await client().rpc("cancel_brainilab_group_invite",{
      p_invite_id:inviteId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function acceptLink(inviteCode){
    if(!(await ready())) throw new Error("Sign in to join this group.");

    const {data,error}=await client().rpc("accept_brainilab_group_link",{
      p_invite_code:String(inviteCode||"").trim().toUpperCase()
    });

    if(error) throw error;
    await refresh();
    return data||{};
  }

  async function removeMember(groupId,userId){
    if(!(await ready())) throw new Error("Sign in to manage group members.");

    const {error}=await client().rpc("remove_brainilab_group_member",{
      p_group_id:groupId,
      p_member_user_id:userId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function leave(groupId){
    if(!(await ready())) throw new Error("Sign in to leave this group.");

    const {error}=await client().rpc("leave_brainilab_group",{
      p_group_id:groupId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function removeGroup(groupId){
    if(!(await ready())) throw new Error("Sign in to delete this group.");

    const {error}=await client().rpc("delete_brainilab_group",{
      p_group_id:groupId
    });

    if(error) throw error;
    await refresh();
    return true;
  }

  async function ranking(filters={}){
    if(!(await ready())) return null;

    const snapshot=cached||await refresh();
    const firstGroup=(
      snapshot?.groups?.find(g=>g.eligible)
      || snapshot?.groups?.[0]
      || null
    );

    const country=filters.region==="country"
      ? (
          firstGroup?.country
          || BrainiData.player()?.countryCode
          || ""
        )
      : null;

    const {data,error}=await client().rpc("get_brainilab_group_rankings",{
      p_region:filters.region||"global",
      p_country_code:country,
      p_period:filters.period||"daily",
      p_game_id:filters.gameId||"all",
      p_metric:filters.metric||"score",
      p_limit:100
    });

    if(error) throw error;

    const mapRow=r=>({
      rank:Number(r.rank||0),
      id:r.group_id,
      groupId:r.group_id,
      name:r.name||"Group",
      country:r.country||"",
      crest:{
        icon:r.crest?.icon||"⚡",
        color:r.crest?.color||"#FFD813"
      },
      members:Number(r.members||0),
      score:Number(r.score||0),
      streak:Number(r.streak||0),
      displayValue:r.display_value||null,
      isMe:!!r.is_me
    });

    return {
      rows:(data?.rows||[]).map(mapRow),
      user:data?.user ? mapRow(data.user) : null,
      myGroups:(data?.my_groups||[]).map(g=>({
        id:g.group_id,
        groupId:g.group_id,
        name:g.name||"Group",
        country:g.country||"",
        crest:{
          icon:g.crest?.icon||"⚡",
          color:g.crest?.color||"#FFD813"
        },
        members:Number(g.members||0),
        eligible:!!g.eligible
      })),
      totalPlayers:Number(data?.total_players||0),
      metricLabel:data?.metric_label||"Group Score",
      countryRequired:!!data?.country_required,
      country:data?.country||null,
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
    create,
    update,
    inviteFriend,
    acceptInvite,
    declineInvite,
    cancelInvite,
    acceptLink,
    removeMember,
    leave,
    removeGroup,
    ranking,
    getCached,
    getLastError
  };
})();
