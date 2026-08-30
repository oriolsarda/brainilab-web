/*
  BrainiLab Progression UX — V27
  Academic-style ranks derived from the canonical player level.
*/
window.BrainiProgressUI=(function(){
  const TIERS=[
    {min:1, max:4,  key:"rookie",     name:"Rookie",      icon:"●", halo:"starter"},
    {min:5, max:9,  key:"elementary", name:"Elementary",  icon:"✦", halo:"learner"},
    {min:10,max:14, key:"highschool", name:"High School", icon:"◆", halo:"scholar"},
    {min:15,max:19, key:"college",    name:"College",     icon:"⬟", halo:"graduate"},
    {min:20,max:24, key:"graduate",   name:"Graduate",    icon:"✧", halo:"doctorate"},
    {min:25,max:29, key:"phd",        name:"PhD",         icon:"⬢", halo:"doctorate"},
    {min:30,max:39, key:"researcher", name:"Researcher",  icon:"⌁", halo:"professor"},
    {min:40,max:49, key:"professor",  name:"Professor",   icon:"★", halo:"professor"},
    {min:50,max:59, key:"dean",       name:"Dean",        icon:"♛", halo:"dean"},
    {min:60,max:999,key:"nobel",      name:"Nobel Mind",  icon:"🏅", halo:"laureate"}
  ];

  function tier(level){
    const n=Math.max(1,Number(level||1));
    return TIERS.find(t=>n>=t.min && n<=t.max)||TIERS[0];
  }

  function nextTier(level){
    const current=tier(level);
    const index=TIERS.indexOf(current);
    return TIERS[index+1]||null;
  }

  function xpForLevel(level){
    const n=Math.max(1,Number(level||1));
    return Math.max(0,Math.ceil(20*Math.pow(n-1,2)));
  }

  function xpProgress(level,xp){
    const current=tier(level);
    const next=nextTier(level);
    if(!next){
      return {percent:100,currentXp:Number(xp||0),nextXp:null,label:"Top rank"};
    }

    const start=xpForLevel(current.min);
    const end=xpForLevel(next.min);
    const value=Math.max(start,Number(xp||0));
    const percent=Math.max(0,Math.min(100,(value-start)/(end-start)*100));

    return {
      percent,
      currentXp:value,
      nextXp:end,
      label:`${Math.max(0,end-value).toLocaleString()} XP to ${next.name}`
    };
  }

  function avatarClass(level){
    return `rank-ring rank-${tier(level).key}`;
  }

  function avatarMarkup(initial,level,extraClass=""){
    const t=tier(level);
    return `<span class="rank-avatar ${avatarClass(level)} ${extraClass}" title="${t.name} · Level ${Number(level||1)}">
      <span>${String(initial||"B").slice(0,1).toUpperCase()}</span>
    </span>`;
  }

  function badgeMarkup(level){
    const t=tier(level);
    return `<span class="brain-rank-badge rank-${t.key}">
      <span class="brain-rank-icon">${BrainiIcons.rankHalo(t.halo,"brain-rank-halo")}</span>
      ${t.name}
      <small>Lv ${Number(level||1)}</small>
    </span>`;
  }

  function xpEarned(correct){
    return 50+Math.min(50,Math.max(0,Number(correct||0)))*5;
  }

  function rankStorageKey(){
    const auth=window.BrainiData?.authState?.();
    const id=auth?.user?.id||"guest";
    return `brainilab-rank-tier-v38-${id}`;
  }

  function showRankUp(level){
    const current=tier(level);

    document.querySelector(".rank-up-toast")?.remove();

    const el=document.createElement("aside");
    el.className=`rank-up-toast rank-${current.key}`;
    el.setAttribute("role","status");
    el.innerHTML=`
      <button
        type="button"
        class="rank-up-close"
        aria-label="Close rank celebration"
      >×</button>

      <span class="rank-up-kicker">NEW BRAIN RANK UNLOCKED</span>

      <div class="rank-up-main">
        <span class="brain-rank-icon">${BrainiIcons.rankHalo(current.halo,"brain-rank-halo")}</span>
        <div>
          <strong>${current.name}</strong>
          <small>Level ${Number(level||1)}</small>
        </div>
      </div>

      <p>
        Your BrainiLab rank just moved up.
        Keep playing to reach the next tier.
      </p>
    `;

    document.body.appendChild(el);

    const close=()=>el.remove();
    el.querySelector(".rank-up-close")?.addEventListener("click",close);

    requestAnimationFrame(
      ()=>el.classList.add("show")
    );

    setTimeout(close,6500);
  }

  function rememberRank(level,{celebrate=true}={}){
    const current=tier(level);
    const key=rankStorageKey();

    let previous=null;
    try{
      previous=localStorage.getItem(key);
    }catch(err){}

    const previousIndex=TIERS.findIndex(
      x=>x.key===previous
    );
    const currentIndex=TIERS.findIndex(
      x=>x.key===current.key
    );

    try{
      localStorage.setItem(key,current.key);
    }catch(err){}

    if(
      celebrate &&
      previous &&
      previousIndex>=0 &&
      currentIndex>previousIndex
    ){
      showRankUp(level);
    }
  }

  function watchRankUps(){
    // Store a baseline on page load. Existing high-rank players do not
    // receive a fake "unlock" just because they opened a new page.
    const initial=window.BrainiData?.player?.();
    if(initial?.level){
      rememberRank(initial.level,{celebrate:false});
    }

    window.addEventListener(
      "brainilab:progressionchange",
      event=>{
        const level=
          event.detail?.summary?.progression?.level
          || window.BrainiData?.player?.()?.level;

        if(level){
          rememberRank(level,{celebrate:true});
        }
      }
    );
  }

  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      watchRankUps,
      {once:true}
    );
  }else{
    queueMicrotask(watchRankUps);
  }

  return {
    TIERS,tier,nextTier,xpForLevel,xpProgress,
    avatarClass,avatarMarkup,badgeMarkup,xpEarned,
    showRankUp,rememberRank
  };
})();
