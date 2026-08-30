/* ===== supabase-friends.js ===== */

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

/* ===== supabase-groups.js ===== */

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

/* ===== social.js ===== */


window.BrainiSocial = (function(){
  let modal=null;
  function toast(m){ if(typeof showToast==="function") showToast(m); }
  function flag(code){
    if(!code || code.length!==2) return "🌐";
    return String.fromCodePoint(...code.toUpperCase().split("").map(c=>127397+c.charCodeAt()));
  }
  function needsAuth(source){
    if(BrainiData.isAuthenticated()) return false;
    BrainiAuth.open({source}); return true;
  }

  function cloudFriendsReady(){
    return !!(
      window.BrainiFriends &&
      window.BrainiBackendAuth?.isConfigured?.() &&
      BrainiData.authState().user?.source==="supabase"
    );
  }

  async function refreshCloudFriends(){
    if(!cloudFriendsReady()) return null;
    return BrainiFriends.refresh();
  }

  function cloudGroupsReady(){
    return !!(
      window.BrainiGroups &&
      window.BrainiBackendAuth?.isConfigured?.() &&
      BrainiData.authState().user?.source==="supabase"
    );
  }

  async function refreshCloudGroups(){
    if(!cloudGroupsReady()) return null;
    return BrainiGroups.refresh();
  }

  const GROUP_COUNTRIES=[
    ["ES","Spain"],["US","United States"],["GB","United Kingdom"],["PT","Portugal"],
    ["FR","France"],["DE","Germany"],["IT","Italy"],["NL","Netherlands"],
    ["BE","Belgium"],["CH","Switzerland"],["AT","Austria"],["IE","Ireland"],
    ["CA","Canada"],["MX","Mexico"],["BR","Brazil"],["AR","Argentina"],
    ["CL","Chile"],["CO","Colombia"],["PE","Peru"],["UY","Uruguay"],
    ["AU","Australia"],["NZ","New Zealand"],["JP","Japan"],["KR","South Korea"],
    ["IN","India"],["SG","Singapore"],["SE","Sweden"],["NO","Norway"],
    ["DK","Denmark"],["FI","Finland"],["PL","Poland"],["CZ","Czechia"],
    ["GR","Greece"],["TR","Türkiye"],["ZA","South Africa"],["MA","Morocco"],
    ["EG","Egypt"],["NG","Nigeria"],["AE","United Arab Emirates"]
  ];

  function groupCountryOptions(selected){
    const value=(selected||BrainiData.player()?.countryCode||"ES").toUpperCase();
    return GROUP_COUNTRIES.map(([code,name])=>
      `<option value="${code}" ${code===value?"selected":""}>${flag(code)} ${name}</option>`
    ).join("");
  }

  function crest(c){ return BrainiIcons.groupCrest(c||{icon:"⚡",color:"#FFD813"},"social-group-crest"); }

  function ensureModal(){
    if(modal) return modal;
    modal=document.createElement("div");modal.className="social-modal";
    modal.innerHTML='<div class="social-dialog"><button class="social-modal-close" aria-label="Close">×</button><div data-social-modal-view></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".social-modal-close").onclick=()=>modal.classList.remove("show");
    modal.onclick=e=>{if(e.target===modal)modal.classList.remove("show")};
    document.addEventListener("keydown",e=>{if(e.key==="Escape")modal.classList.remove("show")});
    return modal;
  }

  function openGroupModal(group=null){
    if(needsAuth("group_create")) return;

    const m=ensureModal();
    const friends=BrainiData.friends();
    const cloud=cloudGroupsReady();

    const currentMemberIds=new Set(
      (group?.members||[]).map(x=>x.userId||x.id)
    );
    const pendingIds=new Set(
      (group?.pendingInvites||[]).map(x=>x.userId||x.id)
    );

    const availableFriends=friends.filter(f=>{
      const id=f.userId||f.id;
      return !currentMemberIds.has(id) && !pendingIds.has(id);
    });

    const icons=["⚡","🧠","🌍","🚩","🏆","💡","🧩","⭐"];
    const colors=["#FFD813","#40AB34","#E52720","#E6680C","#2D296E"];

    const memberCount=Number(group?.memberCount||group?.members?.length||1);
    const openPlaces=Math.max(0,5-memberCount-(group?.pendingInvites?.length||0));

    m.querySelector("[data-social-modal-view]").innerHTML=`
      <div class="auth-kicker">${group?"Manage group":"New group"}</div>
      <h2>${group?"Customize & invite":"Create a group"}</h2>
      <p class="auth-lead">
        Maximum 5 members. Group Rankings unlock at 3 members and use the
        top 3 member scores.
      </p>

      <label class="social-label">Group name</label>
      <input
        class="social-input"
        maxlength="28"
        data-group-name
        value="${(group?.name||"").replace(/"/g,"&quot;")}"
        placeholder="e.g. Brain Storm"
      >

      <label class="social-label">Group country</label>
      <select class="social-input social-select" data-group-country>
        ${groupCountryOptions(group?.country)}
      </select>

      <label class="social-label">Crest icon</label>
      <div class="social-choice-row">
        ${icons.map(i=>`
          <button
            type="button"
            class="social-icon-choice ${i===(group?.crest?.icon||"⚡")?"active":""}"
            data-group-icon="${i}"
          >${BrainiIcons.groupSymbol(i,"social-choice-symbol")}</button>`).join("")}
      </div>

      <label class="social-label">Crest colour</label>
      <div class="social-choice-row">
        ${colors.map(c=>`
          <button
            type="button"
            class="social-color-choice ${c===(group?.crest?.color||"#FFD813")?"active":""}"
            style="--choice:${c}"
            data-group-color="${c}"
            aria-label="${c}"
          ></button>`).join("")}
      </div>

      <label class="social-label">
        ${group?"Invite more friends":"Invite friends now"}
        <span data-member-count>
          ${group ? `${memberCount}/5 members · ${openPlaces} open` : "1/5 members"}
        </span>
      </label>

      <div class="social-friend-select">
        ${availableFriends.length
          ? availableFriends.map(f=>`
              <label>
                <input
                  type="checkbox"
                  value="${f.userId||f.id}"
                  data-group-friend
                >
                <span class="social-avatar">${f.avatar||f.name?.[0]||"B"}</span>
                <span>
                  <strong>${f.name}</strong>
                  <small>${flag(f.country)} ${f.country||""}</small>
                </span>
              </label>`).join("")
          : `<div class="group-modal-empty">
              ${friends.length
                ? "All available friends are already members or invited."
                : "Connect with friends first, or create the group and share its invite link."
              }
            </div>`
        }
      </div>

      ${group?.pendingInvites?.length ? `
        <div class="group-modal-pending">
          <strong>Pending invitations</strong>
          ${group.pendingInvites.map(i=>`
            <span>${i.avatar||i.name?.[0]||"B"} ${i.name}</span>
          `).join("")}
        </div>
      ` : ""}

      <div class="auth-error" data-group-error></div>

      <button type="button" class="auth-primary" data-group-save>
        ${group?"Save & send invites":"Create group"}
      </button>
    `;

    m.classList.add("show");

    let icon=group?.crest?.icon||"⚡";
    let color=group?.crest?.color||"#FFD813";

    m.querySelectorAll("[data-group-icon]").forEach(b=>{
      b.onclick=()=>{
        icon=b.dataset.groupIcon;
        m.querySelectorAll("[data-group-icon]").forEach(
          x=>x.classList.toggle("active",x===b)
        );
      };
    });

    m.querySelectorAll("[data-group-color]").forEach(b=>{
      b.onclick=()=>{
        color=b.dataset.groupColor;
        m.querySelectorAll("[data-group-color]").forEach(
          x=>x.classList.toggle("active",x===b)
        );
      };
    });

    const checks=[...m.querySelectorAll("[data-group-friend]")];
    const maxInvites=group ? openPlaces : 4;

    function sync(changed){
      let chosen=checks.filter(x=>x.checked);

      if(chosen.length>maxInvites && changed){
        changed.checked=false;
        chosen=checks.filter(x=>x.checked);
        toast("This group can have a maximum of 5 members");
      }

      const counter=m.querySelector("[data-member-count]");
      if(counter){
        counter.textContent=group
          ? `${memberCount}/5 members · ${chosen.length} invite${chosen.length===1?"":"s"} selected`
          : `${1+chosen.length}/5 potential members`;
      }
    }

    checks.forEach(c=>c.onchange=()=>sync(c));
    sync();

    m.querySelector("[data-group-save]").onclick=async()=>{
      const error=m.querySelector("[data-group-error]");
      error.textContent="";

      const payload={
        name:m.querySelector("[data-group-name]").value,
        country:m.querySelector("[data-group-country]").value,
        icon,
        color,
        friendIds:checks.filter(x=>x.checked).map(x=>x.value)
      };

      try{
        if(cloud){
          if(group){
            await BrainiGroups.update(group.id,payload);

            for(const friendId of payload.friendIds){
              await BrainiGroups.inviteFriend(group.id,friendId);
            }
          }else{
            await BrainiGroups.create(payload);
          }
        }else{
          throw new Error(
            "The groups service is temporarily unavailable. Please try again."
          );
        }

        m.classList.remove("show");
        toast(group?"Group updated":"Group created");
        await render();
        renderHomeGroup();
      }catch(e){
        error.textContent=e.message||"Could not save group";
      }
    };
  }


  function friendInviteUrl(){
    const code=BrainiData.socialState().friendCode;
    const base=location.hostname==="localhost" || location.hostname==="127.0.0.1"
      ? "https://brainilabgames.com"
      : location.origin;
    return `${base}/profile/?friend=${encodeURIComponent(code)}&utm_source=whatsapp&utm_medium=friend_invite&utm_campaign=friend_referral`;
  }

  async function shareFriendInvite(){
    if(needsAuth("friend_invite")) return;
    const code=BrainiData.socialState().friendCode;
    const url=friendInviteUrl();
    const text=`Add me on BrainiLab 🤝\n\nUse my friend invite and compare streaks, scores and Daily Brain Scores:\n${url}`;

    BrainiData.api.track("friend_invite_opened",{channel:"whatsapp"});
    const href=`https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(href,"_blank","noopener,noreferrer");
  }

  function inviteBannerMarkup(code){
    return `<div class="friend-invite-banner" data-friend-invite-banner>
      <div class="friend-invite-icon">🤝</div>
      <div>
        <strong>Friend invite received</strong>
        <span>A BrainiLab player invited you to connect. Accept to compare streaks and scores.</span>
      </div>
      <button type="button" data-accept-link-invite>Accept invite</button>
    </div>`;
  }

  async function processFriendInviteFromUrl(){
    const params=new URLSearchParams(location.search);
    const code=(params.get("friend")||"").trim().toUpperCase();
    if(!code) return;

    let holder=document.querySelector("[data-profile-auth-root]") || document.querySelector("main .wrap");
    if(!holder) return;

    if(!document.querySelector("[data-friend-invite-banner]")){
      const tmp=document.createElement("div");
      tmp.innerHTML=inviteBannerMarkup(code);
      holder.prepend(tmp.firstElementChild);
    }

    const banner=document.querySelector("[data-friend-invite-banner]");
    const btn=banner?.querySelector("[data-accept-link-invite]");
    if(!btn) return;

    btn.onclick=async()=>{
      if(!BrainiData.isAuthenticated()){
        sessionStorage.setItem("brainilab_pending_friend_invite",code);
        BrainiAuth.open({source:"friend_invite_link"});
        return;
      }
      try{
        if(cloudFriendsReady()){
          await BrainiFriends.acceptInvite(code);
        }else{
          throw new Error(
            "The friends service is temporarily unavailable. Please try again."
          );
        }
        BrainiData.api.track("friend_invite_accepted",{source:"link"});
        banner.remove();
        const cleanUrl=new URL(location.href);
        cleanUrl.searchParams.delete("friend");
        cleanUrl.searchParams.delete("utm_source");
        cleanUrl.searchParams.delete("utm_medium");
        cleanUrl.searchParams.delete("utm_campaign");
        history.replaceState({},document.title,cleanUrl.pathname+cleanUrl.search);
        toast("Friend added");
        render();
      }catch(e){
        toast(e.message||"Could not add friend");
      }
    };
  }

  async function resumePendingFriendInvite(){
    if(!BrainiData.isAuthenticated()) return;
    const code=sessionStorage.getItem("brainilab_pending_friend_invite");
    if(!code) return;
    sessionStorage.removeItem("brainilab_pending_friend_invite");
    try{
      if(cloudFriendsReady()){
        await BrainiFriends.acceptInvite(code);
      }else{
        throw new Error(
          "The friends service is temporarily unavailable. Please try again."
        );
      }
      BrainiData.api.track("friend_invite_accepted",{source:"post_auth"});
      const banner=document.querySelector("[data-friend-invite-banner]");
      if(banner) banner.remove();
      toast("Friend added");
      render();
    }catch(e){
      toast(e.message||"Could not add friend");
    }
  }


  function groupInviteUrl(group){
    const code=group?.inviteCode;
    if(!code) return null;

    const base=location.hostname==="localhost" || location.hostname==="127.0.0.1"
      ? "https://brainilabgames.com"
      : location.origin;

    return `${base}/groups/?invite=${encodeURIComponent(code)}&utm_source=whatsapp&utm_medium=group_invite&utm_campaign=group_referral`;
  }

  async function shareGroupInvite(group){
    if(needsAuth("group_invite")) return;
    if(!group?.inviteCode){
      toast("Only group owners/admins can share this invite");
      return;
    }

    const url=groupInviteUrl(group);
    const text=`Join ${group.name} on BrainiLab 🛡️\n\nWe compete together in Daily, Weekly and Monthly Group Rankings:\n${url}`;

    BrainiData.api.track("group_invite_opened",{
      groupId:group.id,
      channel:"whatsapp"
    });

    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function groupInviteBannerMarkup(code){
    return `<div class="group-invite-banner" data-group-invite-banner>
      <div class="group-invite-banner-icon">🛡️</div>
      <div>
        <strong>Group invite received</strong>
        <span>Join this BrainiLab group to build a shared score and compete in Group Rankings.</span>
      </div>
      <button type="button" data-accept-group-link>Join group</button>
    </div>`;
  }

  async function processGroupInviteFromUrl(){
    const params=new URLSearchParams(location.search);
    const code=(params.get("invite")||"").trim().toUpperCase();

    if(!code || !location.pathname.includes("/groups")) return;

    const holder=document.querySelector(".groups-hero .wrap")
      || document.querySelector("main .wrap");

    if(!holder) return;

    if(!document.querySelector("[data-group-invite-banner]")){
      const tmp=document.createElement("div");
      tmp.innerHTML=groupInviteBannerMarkup(code);
      holder.prepend(tmp.firstElementChild);
    }

    const banner=document.querySelector("[data-group-invite-banner]");
    const btn=banner?.querySelector("[data-accept-group-link]");
    if(!btn) return;

    btn.onclick=async()=>{
      if(!BrainiData.isAuthenticated()){
        sessionStorage.setItem(
          "brainilab_pending_group_invite",
          code
        );
        BrainiAuth.open({source:"group_invite_link"});
        return;
      }

      try{
        if(cloudGroupsReady()){
          await BrainiGroups.acceptLink(code);
        }else{
          throw new Error("Group invites require the BrainiLab cloud backend.");
        }

        BrainiData.api.track("group_invite_accepted",{
          source:"link"
        });

        banner.remove();

        const cleanUrl=new URL(location.href);
        cleanUrl.searchParams.delete("invite");
        cleanUrl.searchParams.delete("utm_source");
        cleanUrl.searchParams.delete("utm_medium");
        cleanUrl.searchParams.delete("utm_campaign");

        history.replaceState(
          {},
          document.title,
          cleanUrl.pathname+cleanUrl.search
        );

        toast("Joined group");
        await render();
        renderHomeGroup();
      }catch(e){
        toast(e.message||"Could not join group");
      }
    };
  }

  async function resumePendingGroupInvite(){
    if(!BrainiData.isAuthenticated() || !cloudGroupsReady()) return;

    const code=sessionStorage.getItem(
      "brainilab_pending_group_invite"
    );

    if(!code) return;

    sessionStorage.removeItem(
      "brainilab_pending_group_invite"
    );

    try{
      await BrainiGroups.acceptLink(code);

      const banner=document.querySelector(
        "[data-group-invite-banner]"
      );
      if(banner) banner.remove();

      toast("Joined group");
      await render();
      renderHomeGroup();
    }catch(e){
      toast(e.message||"Could not join group");
    }
  }

  function friendsMarkup(){
    const social=BrainiData.socialState(), auth=BrainiData.authState();

    if(auth.status!=="authenticated"){
      return `<div class="social-locked"><div><strong>Connect with friends</strong><span>Create a free account to compare streaks, scores and Daily Brain Scores.</span></div><button class="btn-secondary" data-social-auth>Save progress</button></div>`;
    }

    const incoming=social.pendingFriendRequests||[];
    const outgoing=social.outgoingFriendRequests||[];
    const cloud=cloudFriendsReady();

    return `
      <div class="social-panel-head">
        <div>
          <h2>Friends</h2>
          <p>Compare streaks, XP and Daily Brain Scores with people you know.</p>
        </div>

        <div class="friend-head-actions">
          <div class="friend-code">
            <span>Your code</span>
            <strong>${social.friendCode||"—"}</strong>
            <button data-copy-friend-code>Copy</button>
          </div>
          <button class="friend-invite-button" type="button" data-share-friend-invite aria-label="Invite a friend on WhatsApp" title="Invite on WhatsApp">↗</button>
        </div>
      </div>

      ${cloud ? `
        <div class="friend-cloud-status">☁ Friends synced with your BrainiLab account</div>
      ` : ""}

      <form class="add-friend-row" data-add-friend-form>
        <input name="friendCode" placeholder="BRN-XXXXXXXX" autocomplete="off" maxlength="12">
        <button type="submit">Send request</button>
      </form>
      <div class="auth-error" data-friend-error></div>

      ${incoming.length ? `
        <div class="social-subtitle">Requests received · ${incoming.length}</div>
        <div class="friend-list">
          ${incoming.map(r=>`
            <div class="friend-row">
              <span class="social-avatar">${r.avatar||r.name?.[0]||"B"}</span>
              <div class="friend-main">
                <strong>${r.name}</strong>
                <small>${flag(r.country)} ${r.country||""}</small>
              </div>
              <div class="friend-request-actions">
                <button class="friend-action primary" data-accept-request="${r.id}">Accept</button>
                <button class="friend-action" data-decline-request="${r.id}">Decline</button>
              </div>
            </div>`).join("")}
        </div>
      ` : ""}

      ${outgoing.length ? `
        <div class="social-subtitle">Requests sent · ${outgoing.length}</div>
        <div class="friend-list">
          ${outgoing.map(r=>`
            <div class="friend-row">
              <span class="social-avatar">${r.avatar||r.name?.[0]||"B"}</span>
              <div class="friend-main">
                <strong>${r.name}</strong>
                <small>${flag(r.country)} ${r.country||""} · Pending</small>
              </div>
              <button class="friend-action" data-cancel-request="${r.id}">Cancel</button>
            </div>`).join("")}
        </div>
      ` : ""}

      <div class="social-subtitle">${social.friends.length} ${social.friends.length===1?"friend":"friends"}</div>

      <div class="friend-list">
        ${social.friends.map(f=>`
          <div class="friend-row">
            <span class="social-avatar">${f.avatar||f.name?.[0]||"B"}</span>
            <div class="friend-main">
              <strong>${f.name}</strong>
              <small>${flag(f.country)} ${f.country||""} · Level ${f.level||1}</small>
            </div>

            <div class="friend-stat">
              <strong>🔥 ${f.currentStreak||0}</strong>
              <span>streak</span>
            </div>

            <div class="friend-stat">
              <strong>${Number(f.dailyScore||0).toLocaleString()}</strong>
              <span>today</span>
            </div>

            <div class="friend-stat friend-stat-xp">
              <strong>${Number(f.xp||0).toLocaleString()}</strong>
              <span>XP</span>
            </div>

            <button class="friend-menu" data-remove-friend="${f.userId||f.id}" title="Remove friend">×</button>
          </div>`).join("")}
      </div>

      ${social.friends.length===0 && incoming.length===0 ? `
        <div class="friend-empty-state">
          <strong>Your Friends Ranking starts here</strong>
          <span>Send your friend code or invite someone on WhatsApp. Once connected, your streaks and scores will appear here automatically.</span>
        </div>
      ` : ""}

      <a class="social-ranking-link" href="../rankings/index.html?mode=friends">View friends ranking →</a>`;
  }

  function groupsMarkup(){
    const auth=BrainiData.authState();
    const social=BrainiData.socialState();
    const groups=BrainiData.groups();
    const received=Array.isArray(social.groupInvites)
      ? social.groupInvites
      : [];

    if(auth.status!=="authenticated"){
      return `<div class="social-locked">
        <div>
          <strong>Create a group</strong>
          <span>Build a team of up to 5 people and compete in global and country rankings.</span>
        </div>
        <button class="btn-secondary" data-social-auth>Save progress</button>
      </div>`;
    }

    return `
      <div class="social-panel-head group-panel-head">
        <div>
          <h2>Groups</h2>
          <p>
            Up to 5 members. Group Rankings use the top 3 member scores,
            so teams become eligible from 3 members.
          </p>
        </div>
        <button class="btn-secondary" data-create-group>
          + Create group
        </button>
      </div>

      ${cloudGroupsReady() ? `
        <div class="friend-cloud-status">
          ☁ Groups synced with your BrainiLab account
        </div>
      ` : ""}

      ${received.length ? `
        <div class="group-invites-box">
          <div class="social-subtitle">
            Group invitations · ${received.length}
          </div>

          ${received.map(inv=>`
            <div class="group-invite-row">
              ${crest(inv.crest)}
              <div>
                <strong>${inv.groupName}</strong>
                <small>
                  ${flag(inv.country)} ${inv.country||""}
                  · ${inv.memberCount}/5 members
                  · invited by ${inv.inviterName}
                </small>
              </div>

              <div class="group-invite-actions">
                <button
                  class="friend-action primary"
                  data-accept-group-invite="${inv.id}"
                >Join</button>

                <button
                  class="friend-action"
                  data-decline-group-invite="${inv.id}"
                >Decline</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <div class="group-grid group-grid-real">
        ${groups.map(g=>{
          const role=g.myRole || (
            g.ownerId==="self" ? "owner" : "member"
          );
          const canManage=role==="owner";
          const memberCount=Number(
            g.memberCount||g.members?.length||0
          );

          return `
            <article class="group-card group-card-real">
              <div class="group-card-head">
                ${crest(g.crest)}

                <div class="group-card-title">
                  <div class="group-role-line">
                    <span>${role}</span>
                    ${g.eligible
                      ? `<b class="group-eligible">Ranking active</b>`
                      : `<b class="group-ineligible">Need ${Math.max(0,3-memberCount)} more</b>`
                    }
                  </div>

                  <h3>${g.name}</h3>

                  <small>
                    ${flag(g.country)} ${g.country}
                    · ${memberCount}/5 members
                  </small>
                </div>

                ${role==="owner"
                  ? `<button class="group-edit" data-edit-group="${g.id}">Edit</button>`
                  : ""
                }
              </div>

              <div class="group-score-rule">
                <span>Group Score</span>
                <strong>Top 3 members</strong>
              </div>

              <div class="group-stats group-stats-real">
                <div>
                  <strong>${Number(g.dailyScore||0).toLocaleString()}</strong>
                  <span>Today</span>
                </div>
                <div>
                  <strong>${Number(g.weeklyScore||0).toLocaleString()}</strong>
                  <span>This week</span>
                </div>
                <div>
                  <strong>${Number(g.monthlyScore||0).toLocaleString()}</strong>
                  <span>This month</span>
                </div>
                <div>
                  <strong>🔥 ${g.currentStreak||0}</strong>
                  <span>Group streak</span>
                </div>
              </div>

              <div class="group-members-real">
                ${g.members.map(m=>`
                  <div class="group-member-real">
                    <span class="social-avatar">
                      ${m.avatar||m.name?.[0]||"B"}
                    </span>

                    <div>
                      <strong>
                        ${m.name}
                        ${m.role==="owner"
                          ? `<small class="group-owner-tag">Owner</small>`
                          : m.role==="admin"
                            ? `<small class="group-owner-tag">Admin</small>`
                            : ""
                        }
                      </strong>

                      <small>
                        ${flag(m.country)} ${m.country||""}
                        · 🔥 ${m.currentStreak||0}
                        · ${Number(m.dailyScore||0).toLocaleString()} today
                      </small>
                    </div>

                    ${canManage && m.role!=="owner"
                      ? `<button
                           class="group-member-remove"
                           data-remove-group-member="${g.id}|${m.userId||m.id}"
                           title="Remove member"
                         >×</button>`
                      : ""
                    }
                  </div>
                `).join("")}
              </div>

              ${g.pendingInvites?.length ? `
                <div class="group-pending-list">
                  <strong>Pending invitations</strong>
                  ${g.pendingInvites.map(i=>`
                    <span>
                      ${i.avatar||i.name?.[0]||"B"} ${i.name}
                      <button
                        data-cancel-group-invite="${i.id}"
                        title="Cancel invitation"
                      >×</button>
                    </span>
                  `).join("")}
                </div>
              ` : ""}

              ${!g.eligible ? `
                <div class="group-ranking-lock">
                  <strong>Complete your team</strong>
                  <span>
                    ${memberCount}/3 members required for Group Rankings.
                  </span>
                </div>
              ` : ""}

              <div class="group-card-actions group-actions-real">
                <a href="../rankings/index.html?mode=group">
                  Group ranking
                </a>

                ${canManage && g.inviteCode ? `
                  <button data-share-group="${g.id}">
                    ↗ Invite
                  </button>
                ` : ""}

                ${canManage ? `
                  <button data-edit-group="${g.id}">
                    + Members
                  </button>
                ` : ""}

                <button data-leave-group="${g.id}">
                  ${role==="owner"?"Delete group":"Leave group"}
                </button>
              </div>
            </article>`;
        }).join("")}

        ${groups.length===0 ? `
          <div class="group-empty group-empty-real">
            <div>🛡️</div>
            <strong>Create your first group</strong>
            <span>
              Invite up to 4 friends. Once the group reaches 3 members,
              it can enter Global and Country Group Rankings.
            </span>
            <button class="btn-secondary" data-create-group>
              + Create group
            </button>
          </div>
        ` : ""}
      </div>`;
  }


  function homeGroupMarkup(){
    const auth=BrainiData.authState();
    const groups=BrainiData.groups();

    if(auth.status!=="authenticated"){
      return `<div class="home-group-card guest">
        <div class="home-group-symbol">${BrainiIcons.img(BrainiIcons.asset("icons/group-badges/examples/brain-league.svg"),"home-group-badge")}</div>
        <div class="home-group-copy">
          <div class="auth-kicker">Groups</div>
          <h2>Create your BrainiLab group</h2>
          <p>
            Team up with up to 4 friends. Group Rankings use your top
            3 member scores.
          </p>
        </div>

        <div class="home-group-actions">
          <button class="btn-secondary" data-home-group-auth>
            Save progress & create group
          </button>
          <a href="rankings/index.html?mode=group">
            View group rankings →
          </a>
        </div>
      </div>`;
    }

    if(!groups.length){
      return `<div class="home-group-card">
        <div class="home-group-symbol">${BrainiIcons.img(BrainiIcons.asset("icons/group-badges/examples/brain-league.svg"),"home-group-badge")}</div>
        <div class="home-group-copy">
          <div class="auth-kicker">Your group</div>
          <h2>Start a group</h2>
          <p>
            Create a team of up to 5 players. Rankings unlock when
            you reach 3 members.
          </p>
        </div>

        <div class="home-group-actions">
          <a class="btn-secondary" href="groups/index.html">
            Create group
          </a>
          <a href="rankings/index.html?mode=group">
            Group rankings →
          </a>
        </div>
      </div>`;
    }

    const g=groups[0];
    const memberCount=Number(g.memberCount||g.members?.length||0);

    return `<div class="home-group-card has-group">
      ${crest(g.crest)}

      <div class="home-group-copy">
        <div class="auth-kicker">
          ${g.eligible?"My ranked group":"My group · building team"}
        </div>
        <h2>${g.name}</h2>
        <p>
          ${memberCount}/5 members
          · 🔥 ${g.currentStreak||0} group streak
          ${g.eligible
            ? "· Ranking active"
            : `· ${Math.max(0,3-memberCount)} more needed for rankings`
          }
        </p>
      </div>

      <div class="home-group-score">
        <span>Top 3 · Today</span>
        <strong>${Number(g.dailyScore||0).toLocaleString()}</strong>
      </div>

      <div class="home-group-actions">
        <a class="btn-secondary" href="groups/index.html">
          Open my group
        </a>
        <a href="rankings/index.html?mode=group">
          See ranking →
        </a>
      </div>
    </div>`;
  }

  function renderHomeGroup(){
    const root=document.querySelector("[data-home-group-root]");
    if(!root) return;
    root.innerHTML=homeGroupMarkup();
    const authBtn=root.querySelector("[data-home-group-auth]");
    if(authBtn) authBtn.onclick=()=>BrainiAuth.open({source:"home_group"});
  }

  async function render(){
    const fr=document.querySelector("[data-friends-root]"), gr=document.querySelector("[data-groups-root]");
    if(!fr && !gr) return;
    if(fr){
      fr.innerHTML=friendsMarkup();
      fr.querySelectorAll("[data-social-auth]").forEach(b=>b.onclick=()=>BrainiAuth.open({source:"friends"}));
      const copy=fr.querySelector("[data-copy-friend-code]");if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(BrainiData.socialState().friendCode);toast("Friend code copied")}catch(e){toast("Copy failed")}};
      const invite=fr.querySelector("[data-share-friend-invite]");
      if(invite) invite.onclick=shareFriendInvite;
      const form=fr.querySelector("[data-add-friend-form]");
      if(form) form.onsubmit=async e=>{
        e.preventDefault();
        const er=fr.querySelector("[data-friend-error]");
        const code=new FormData(form).get("friendCode");
        try{
          if(cloudFriendsReady()){
            const response=await BrainiFriends.sendRequest(code);
            if(response.status==="accepted") toast("Friend added");
            else if(response.status==="already_friends") toast("You are already friends");
            else if(response.status==="already_pending") toast("Request already sent");
            else toast("Friend request sent");
          }else{
            throw new Error(
              "The friends service is temporarily unavailable. Please try again."
            );
          }
          form.reset();
          er.textContent="";
          render();
        }catch(x){
          er.textContent=x.message||"Could not send friend request";
        }
      };

      fr.querySelectorAll("[data-accept-request]").forEach(b=>b.onclick=async()=>{
        try{
          if(cloudFriendsReady()) await BrainiFriends.acceptRequest(b.dataset.acceptRequest);
          else throw new Error("The friends service is temporarily unavailable. Please try again.");
          toast("Friend added");
          render();
        }catch(e){toast(e.message||"Could not accept request")}
      });

      fr.querySelectorAll("[data-decline-request]").forEach(b=>b.onclick=async()=>{
        try{
          if(cloudFriendsReady()) await BrainiFriends.declineRequest(b.dataset.declineRequest);
          toast("Request declined");
          render();
        }catch(e){toast(e.message||"Could not decline request")}
      });

      fr.querySelectorAll("[data-cancel-request]").forEach(b=>b.onclick=async()=>{
        try{
          if(cloudFriendsReady()) await BrainiFriends.cancelRequest(b.dataset.cancelRequest);
          toast("Request cancelled");
          render();
        }catch(e){toast(e.message||"Could not cancel request")}
      });

      fr.querySelectorAll("[data-remove-friend]").forEach(b=>b.onclick=async()=>{
        if(!confirm("Remove this friend?")) return;
        try{
          if(cloudFriendsReady()) await BrainiFriends.remove(b.dataset.removeFriend);
          else throw new Error("The friends service is temporarily unavailable. Please try again.");
          toast("Friend removed");
          render();
        }catch(e){toast(e.message||"Could not remove friend")}
      });
    }
    if(gr){
      gr.innerHTML=groupsMarkup();

      gr.querySelectorAll("[data-social-auth]").forEach(
        b=>b.onclick=()=>BrainiAuth.open({source:"groups"})
      );

      gr.querySelectorAll("[data-create-group]").forEach(
        b=>b.onclick=()=>openGroupModal()
      );

      gr.querySelectorAll("[data-edit-group]").forEach(b=>{
        b.onclick=()=>{
          const g=BrainiData.groups().find(
            x=>x.id===b.dataset.editGroup
          );
          if(g) openGroupModal(g);
        };
      });

      gr.querySelectorAll("[data-share-group]").forEach(b=>{
        b.onclick=()=>{
          const g=BrainiData.groups().find(
            x=>x.id===b.dataset.shareGroup
          );
          if(g) shareGroupInvite(g);
        };
      });

      gr.querySelectorAll("[data-accept-group-invite]").forEach(b=>{
        b.onclick=async()=>{
          try{
            if(!cloudGroupsReady()){
              throw new Error("Group invitations require cloud sync.");
            }

            await BrainiGroups.acceptInvite(
              b.dataset.acceptGroupInvite
            );

            toast("Joined group");
            await render();
            renderHomeGroup();
          }catch(e){
            toast(e.message||"Could not join group");
          }
        };
      });

      gr.querySelectorAll("[data-decline-group-invite]").forEach(b=>{
        b.onclick=async()=>{
          try{
            if(cloudGroupsReady()){
              await BrainiGroups.declineInvite(
                b.dataset.declineGroupInvite
              );
            }

            toast("Invitation declined");
            await render();
          }catch(e){
            toast(e.message||"Could not decline invitation");
          }
        };
      });

      gr.querySelectorAll("[data-cancel-group-invite]").forEach(b=>{
        b.onclick=async()=>{
          try{
            if(cloudGroupsReady()){
              await BrainiGroups.cancelInvite(
                b.dataset.cancelGroupInvite
              );
            }

            toast("Invitation cancelled");
            await render();
          }catch(e){
            toast(e.message||"Could not cancel invitation");
          }
        };
      });

      gr.querySelectorAll("[data-remove-group-member]").forEach(b=>{
        b.onclick=async()=>{
          const [groupId,userId]=b.dataset.removeGroupMember.split("|");

          if(!confirm("Remove this member from the group?")){
            return;
          }

          try{
            if(!cloudGroupsReady()){
              throw new Error("Member management requires cloud sync.");
            }

            await BrainiGroups.removeMember(
              groupId,
              userId
            );

            toast("Member removed");
            await render();
            renderHomeGroup();
          }catch(e){
            toast(e.message||"Could not remove member");
          }
        };
      });

      gr.querySelectorAll("[data-leave-group]").forEach(b=>{
        b.onclick=async()=>{
          const g=BrainiData.groups().find(
            x=>x.id===b.dataset.leaveGroup
          );
          if(!g) return;

          const role=g.myRole || (
            g.ownerId==="self" ? "owner" : "member"
          );

          const isOwner=role==="owner";

          if(!confirm(
            isOwner
              ? "Delete this group permanently?"
              : "Leave this group?"
          )){
            return;
          }

          try{
            if(cloudGroupsReady()){
              if(isOwner){
                await BrainiGroups.removeGroup(g.id);
              }else{
                await BrainiGroups.leave(g.id);
              }
            }else{
              throw new Error(
                "The groups service is temporarily unavailable. Please try again."
              );
            }

            toast(isOwner?"Group deleted":"Left group");
            await render();
            renderHomeGroup();
          }catch(e){
            toast(e.message||"Could not update group");
          }
        };
      });
    }
  }
  async function bootSocial(){
    if(cloudFriendsReady()) await refreshCloudFriends();
    if(cloudGroupsReady()) await refreshCloudGroups();

    render();
    renderHomeGroup();

    processFriendInviteFromUrl();
    processGroupInviteFromUrl();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bootSocial,{once:true});
  }else{
    queueMicrotask(bootSocial);
  }

  window.addEventListener("brainilab:datachange",()=>{
    render();
    renderHomeGroup();
  });

  window.addEventListener("brainilab:friendschange",()=>{
    render();
  });

  window.addEventListener("brainilab:groupschange",()=>{
    render();
    renderHomeGroup();
  });

  window.addEventListener("brainilab:authchange",async()=>{
    if(cloudFriendsReady()) await refreshCloudFriends();
    if(cloudGroupsReady()) await refreshCloudGroups();

    render();
    renderHomeGroup();

    resumePendingFriendInvite();
    resumePendingGroupInvite();
  });

  return {
    render,
    renderHomeGroup,
    openGroupModal,
    refreshCloudFriends,
    refreshCloudGroups
  };
})();
