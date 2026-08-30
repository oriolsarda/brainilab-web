
/*
 BrainiLab UI hydration from data layer.
 UI components read from BrainiData; when the backend changes,
 these components do not need to know where the data comes from.
*/
window.BrainiUI = (function(){
  function setText(selector,value){
    document.querySelectorAll(selector).forEach(el=>{
      // Data-display selectors must never replace an entire structural component.
      // If an attribute is accidentally reused on a container, skip it instead of
      // destroying all of its child markup with textContent.
      if(el.matches("article,section,main,header,footer,nav,form")){
        console.warn("BrainiLab UI skipped structural setText target:",selector,el);
        return;
      }
      el.textContent=value;
    });
  }

  function renderDailyScoreCards(daily){
    const root=document.querySelector(".brain-score-games");
    if(!root) return;
    const meta={
      brainmix:["Brain Mix","brainmix"],
      orderup:["Order Up","orderup"],
      topicrush:["Topic Rush","topicrush"],
      connections:["Connections","connections"],
      oddoneout:["Odd One Out","odd-one-out"],
      higherlower:["Higher or Lower","higher-lower"],
      mathrush:["Math Rush","math-rush"],
      numberroute:["Number Route","number-route"],
      sequence:["Sequence","sequence"],
      brainiword:["BrainiWord","brainiword"]
    };
    const ids=BrainiData.dailyGameIdsForNumber?.(daily.number)||BrainiData.DAILY_GAME_IDS;
    root.innerHTML=ids.map(id=>{
      const [name,icon]=meta[id]||[id,id];
      return `<article class="brain-score-game" data-daily-item="${id}">
        <div class="brain-score-game-head"><div><span class="brain-score-game-icon">${window.BrainiIcons?.game?BrainiIcons.game(icon,"mini","braini-game-mini"):""}</span><strong>${name}</strong></div><span class="brain-score-game-points" data-item-value>—</span></div>
        <div class="brain-score-game-track"><span data-item-bar style="width:0%"></span></div>
        <small data-item-note>Not played yet · worth up to 2,500</small>
      </article>`;
    }).join("");
  }

  async function hydrate(){
    const player=await BrainiData.api.getPlayer();
    const daily=await BrainiData.api.getDaily();
    const collective=BrainiData.getCollective();
    renderDailyScoreCards(daily);

    setText("[data-player-streak]",player.currentStreak);
    setText("[data-player-best-streak]",player.bestStreak);
    setText("[data-player-total-games]",player.totalGames.toLocaleString());
    setText("[data-player-total-questions]",player.totalQuestions.toLocaleString());
    setText("[data-player-level]",player.level);
    setText("[data-player-xp]",Number(player.xp||0).toLocaleString());
    setText("[data-player-full-daily]",Number(player.fullDailyCount||0).toLocaleString());

    const cloudProgression=BrainiData.getState().cloudProgression||null;
    const week=cloudProgression?.week||{};
    const month=cloudProgression?.month||{};

    setText("[data-week-brain-score]",Number(week.daily_brain_score||0).toLocaleString());
    setText("[data-week-active-days]",Number(week.active_days||0));
    setText("[data-week-full-dailies]",Number(week.full_daily_count||0));

    setText("[data-month-brain-score]",Number(month.daily_brain_score||0).toLocaleString());
    setText("[data-month-active-days]",Number(month.active_days||0));
    setText("[data-month-full-dailies]",Number(month.full_daily_count||0));

    setText("[data-daily-number]",daily.number);
    setText("[data-daily-score]",daily.brainScore.toLocaleString());
    setText("[data-daily-completed]",daily.completedGames.length);
    setText("[data-daily-total]",(BrainiData.dailyGameIdsForNumber?.(daily.number)||BrainiData.DAILY_GAME_IDS).length);
    document.querySelectorAll("[data-daily-item]").forEach(el=>{
      const id=el.dataset.dailyItem;
      const item=daily.dailyBreakdown?.[id];
      if(!item) return;
      const valueEl=el.querySelector("[data-item-value]");
      const barEl=el.querySelector("[data-item-bar]");
      const noteEl=el.querySelector("[data-item-note]");
      if(valueEl) valueEl.textContent=item.points ? item.points.toLocaleString() : "—";
      if(barEl) barEl.style.width=((item.points||0)/(item.max||2500)*100)+"%";
      if(noteEl) noteEl.textContent=item.label + " · worth up to " + (item.max||2500).toLocaleString();
    });
    const community=collective?.today||{};
    setText("[data-today-active]",community.activePlayers==null?"—":Number(community.activePlayers).toLocaleString());
    setText("[data-today-games]",community.gamesPlayed==null?"—":Number(community.gamesPlayed).toLocaleString());
    setText("[data-today-shares]",community.shares==null?"—":Number(community.shares).toLocaleString());

    document.querySelectorAll("[data-game-players]").forEach(async el=>{
      const s=await BrainiData.api.getCollectiveStats(el.dataset.gamePlayers);
      if(s?.playersToday!=null) el.textContent=s.playersToday.toLocaleString();
    });
  }

  function renderLeaderboard(container,gameId){
    const rows=BrainiData.leaderboard(gameId);
    if(!container) return;
    if(!rows.length){
      container.innerHTML='<div class="sub">Leaderboard data will appear here.</div>';
      return;
    }
    container.innerHTML=rows.map(r=>`
      <div class="data-row ${r.isMe?"is-me":""}">
        <span class="data-rank">#${r.rank}</span>
        <span class="data-name">${r.name}${r.isMe?" · You":""}</span>
        <span class="data-value">${r.score!=null?r.score.toLocaleString():r.correct+" correct"}</span>
      </div>`).join("");
  }

  function renderPlayerSummary(container){
    if(!container) return;
    const p=BrainiData.player(),d=BrainiData.daily();
    container.innerHTML=`
      <div class="player-data-card">
        <div><strong>${p.currentStreak} 🔥</strong><span>Current streak</span></div>
        <div><strong>${d.brainScore.toLocaleString()}</strong><span>Daily Brain Score</span></div>
        <div><strong>${p.totalQuestions.toLocaleString()}</strong><span>Questions answered</span></div>
      </div>`;
  }

  function renderGameStats(container,gameId){
    if(!container) return;
    const collective=BrainiData.collectiveStats(gameId)||{};
    const pb=BrainiData.personalBest(gameId)||{};
    const latest=BrainiData.recentResults(gameId)[0]||null;
    const def=BrainiData.game(gameId);

    let pbText="No personal best yet";
    if(gameId==="brainiword" && pb.attempts) pbText=pb.attempts+"/5";
    else if(gameId==="flagdash" && pb.correct!=null) pbText=pb.correct+" flags";
    else if(gameId==="orderup" && pb.score!=null) pbText=Number(pb.score).toLocaleString()+" pts";
    else if(pb.score!=null) pbText=Number(pb.score).toLocaleString()+" pts";

    let avgText="—";
    if(collective.avgScore!=null) avgText=Number(collective.avgScore).toLocaleString()+" pts";
    else if(collective.avgCorrect!=null) avgText=collective.avgCorrect+" correct";
    else if(collective.avgAttempts!=null) avgText=collective.avgAttempts+" attempts";

    container.innerHTML=`
      <div class="data-strip">
        <div class="data-metric"><strong>${collective.playersToday?.toLocaleString?.()||"—"}</strong><span>Players today</span></div>
        <div class="data-metric"><strong>${avgText}</strong><span>Community average</span></div>
        <div class="data-metric"><strong>${pbText}</strong><span>Your personal best</span></div>
        <div class="data-metric"><strong>${latest?.percentile!=null?"Top "+latest.percentile+"%":"—"}</strong><span>Your latest rank</span></div>
      </div>`;
  }

  function renderRecentResults(container,limit=8){
    if(!container) return;
    const rows=BrainiData.recentResults().slice(0,limit);
    container.innerHTML=rows.map(r=>{
      const d=BrainiData.game(r.gameId);
      let result="Completed";
      if(r.gameId==="brainiword") result=r.won?r.attempts+"/5":"X/5";
      else if(r.gameId==="flagdash") result=(r.correct||0)+" flags";
      else if(r.gameId==="orderup") result=Number(r.score||0).toLocaleString()+" / 2,500";
      else if(r.score!=null) result=Number(r.score).toLocaleString()+" pts";
      return `<div class="data-row">
        <span class="data-rank">${d?.icon||"🧠"}</span>
        <span class="data-name">${d?.name||r.gameId}<small style="display:block;color:var(--muted);font-weight:650">${new Date(r.playedAt).toLocaleDateString()}</small></span>
        <span class="data-value">${result}</span>
      </div>`;
    }).join("") || '<div class="sub">No games played yet.</div>';
  }

  window.addEventListener("brainilab:datachange",hydrate);
  document.addEventListener("DOMContentLoaded",hydrate);

  return {hydrate,renderLeaderboard,renderPlayerSummary,renderGameStats,renderRecentResults};
})();
