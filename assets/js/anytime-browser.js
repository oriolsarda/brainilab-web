/*
  BrainiLab Play Anytime Browser — V32
  Shared replayable quiz browser used below Home and Daily Quiz.
*/
window.BrainiAnytimeBrowser=(function(){
  const SCRIPT_URL=(()=>{
    const current=document.currentScript?.src;
    if(current) return current;

    const found=[...document.scripts]
      .map(s=>s.src)
      .find(src=>src && src.includes("/assets/js/anytime-browser.js"));

    return found||location.href;
  })();

  const SITE_ROOT=new URL("../../",SCRIPT_URL);

  function siteUrl(path=""){
    const raw=String(path).replace(/^\/+/, "");
    const url=new URL(raw,SITE_ROOT);

    // Static local browsing has no web server to resolve directory routes
    // to index.html. Chrome otherwise shows a directory listing.
    if(
      url.protocol==="file:" &&
      url.pathname.endsWith("/")
    ){
      url.pathname+="index.html";
    }

    return url.href;
  }

  const GAMES=[
    {id:"generalknowledge",name:"General Knowledge",icon:"mixed-general-knowledge",accent:"accent-yellow",copy:"A mixed quiz across everyday knowledge.",base:"/general-knowledge/general-knowledge-quiz/"},
    {id:"connections",name:"Connections",gameIcon:"connections",accent:"",copy:"Find the common link across 4–8 clues over a 20-round challenge.",base:"/games/connections/",single:true,difficultyLabel:"20 rounds · score by attempts",action:"Play Connections"},
    {id:"survival",name:"Survival",gameIcon:"survival",accent:"accent-red",copy:"Three lives. Questions get harder until you run out of lives or clear the challenge.",base:"/games/survival/",single:true,difficultyLabel:"3 lives · adaptive difficulty",action:"Play Survival"},
    {id:"oddoneout",name:"Odd One Out",gameIcon:"odd-one-out",accent:"accent-green",copy:"Spot the one item that does not belong across ten quick rounds.",base:"/games/odd-one-out/",single:true,difficultyLabel:"10 rounds · one outsider",action:"Play Odd One Out"},
    {id:"higherlower",name:"Higher or Lower",gameIcon:"higher-lower",accent:"accent-orange",copy:"Compare real facts and decide which side is older, bigger, faster, higher and more.",base:"/games/higher-lower/",single:true,difficultyLabel:"10 comparisons · build a combo",action:"Play Higher or Lower"},
    {id:"mathrush",name:"Math Rush",gameIcon:"math-rush",accent:"accent-yellow",copy:"One minute of simple mental maths. Answer fast, build a combo, or skip.",base:"/games/math-rush/",single:true,difficultyLabel:"60 seconds · generated endlessly",action:"Play Math Rush"},
    {id:"numberroute",name:"Number Route",gameIcon:"number-route",accent:"accent-orange",copy:"Use four numbers in order and choose operators to hit the target.",base:"/games/number-route/",single:true,difficultyLabel:"10 Easy routes · left to right",action:"Play Number Route"},
    {id:"sequence",name:"Sequence",gameIcon:"sequence",accent:"accent-green",copy:"Spot the number pattern and choose what comes next.",base:"/games/sequence/",single:true,difficultyLabel:"10 pattern rounds",action:"Play Sequence"},
    {id:"worldflags",name:"World Flags",icon:"world-flags",accent:"accent-orange",copy:"Recognise countries from their national flags.",base:"/geography/world-flags-quiz/"},
    {id:"worldcapitals",name:"World Capitals",icon:"world-capitals",accent:"accent-orange",copy:"Test how well you know capital cities.",base:"/geography/world-capitals-quiz/"},
    {id:"science",name:"Science",icon:"science",accent:"accent-green",copy:"Biology, chemistry, physics and space.",base:"/science/science-quiz/"},
    {id:"history",name:"History",icon:"history",accent:"accent-red",copy:"People, events, civilizations and timelines.",base:"/history/history-quiz/"},
    {id:"sports",name:"Sports",icon:"sports",accent:"accent-navy",copy:"Rules, competitions and sporting knowledge.",base:"/sports/sports-quiz/"}
  ];

  function bestLabel(gameId){
    const results=BrainiData.recentResults(gameId)||[];
    const best=BrainiData.personalBest(gameId);

    if(!results.length){
      return `<span class="anytime-new">Not played yet</span>`;
    }

    let label="";
    if(best){
      if(gameId==="connections" && Number.isFinite(Number(best.score))){
        label=`Best ${Number(best.score).toLocaleString()} pts`;
      }else if(Number.isFinite(Number(best.correct)) && Number.isFinite(Number(best.total))){
        label=`Best ${Number(best.correct)}/${Number(best.total)}`;
      }else if(Number.isFinite(Number(best.score))){
        label=`Best ${Number(best.score).toLocaleString()} pts`;
      }
    }

    return `
      <span class="anytime-played">${BrainiIcons.product("check-completed","braini-inline-icon")} Played</span>
      <span>${label||`${results.length} result${results.length===1?"":"s"}`}</span>
    `;
  }

  function card(game){
    if(game.single){
      return `
        <article class="anytime-game-card ${game.accent}">
          <div class="anytime-game-head">
            <span class="anytime-category-icon"><img class="braini-category-icon" loading="lazy" decoding="async" src="${siteUrl(`assets/icons/games/standard/${game.gameIcon}.svg`)}" alt="" aria-hidden="true"></span>
            <div><h3>${game.name}</h3><p>${game.copy}</p></div>
          </div>
          <div class="anytime-status">${bestLabel(game.id)}</div>
          <div class="anytime-difficulty-label">${game.difficultyLabel||"Play anytime"}</div>
          <div class="difficulty-actions single-action"><a href="${siteUrl(game.base)}">${game.action||`Play ${game.name}`}</a></div>
        </article>`;
    }

    const difficulty=d=>siteUrl(
      `${game.base.replace(/^\/+/, "")}?difficulty=${d}&set=1`
    );

    return `
      <article class="anytime-game-card ${game.accent}">
        <div class="anytime-game-head">
          <span class="anytime-category-icon">${BrainiIcons.category(game.icon)}</span>
          <div>
            <h3>${game.name}</h3>
            <p>${game.copy}</p>
          </div>
        </div>

        <div class="anytime-status">
          ${bestLabel(game.id)}
        </div>

        <div class="anytime-difficulty-label">Choose difficulty</div>
        <div class="difficulty-actions">
          <a href="${difficulty("easy")}">Easy</a>
          <a href="${difficulty("medium")}">Medium</a>
          <a href="${difficulty("hard")}">Hard</a>
        </div>
      </article>
    `;
  }

  function renderOne(root){
    const daily=root.dataset.anytimeVariant==="daily";

    root.innerHTML=`
      <section class="anytime-browser ${daily?"is-daily-context":""}">
        <div class="anytime-browser-head">
          <div>
            ${daily
              ? `<span class="anytime-browser-kicker">PLAY ANYTIME · NOT PART OF TODAY’S DAILY</span>`
              : `<span class="anytime-browser-kicker">PLAY ANYTIME</span>`
            }

            <h2>${daily ? "More games, whenever you want" : "Pick another quiz"}</h2>

            <p>${daily
              ? "These quizzes are replayable and earn XP, but they do not change today’s 10,000-point Daily Brain Score."
              : "Choose a category and difficulty. These quizzes are replayable whenever you want."
            }</p>
          </div>

          <a class="anytime-browser-all" href="${siteUrl("games/")}">All games →</a>
        </div>

        <div class="anytime-grid">
          ${GAMES.map(card).join("")}
        </div>
      </section>
    `;
  }

  function render(){
    document.querySelectorAll("[data-anytime-browser]").forEach(renderOne);
  }

  document.addEventListener("DOMContentLoaded",render);
  window.addEventListener("brainilab:datachange",render);
  window.addEventListener("brainilab:progressionchange",render);

  return {render,GAMES};
})();
