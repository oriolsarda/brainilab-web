/*
  BrainiLab Daily Overview — V27
*/
window.BrainiDailyOverview=(function(){
  async function render(){
    const root=document.querySelector("[data-daily-overview]");
    if(!root) return;

    root.innerHTML=`<div class="daily-overview-loading">Loading today's Daily…</div>`;

    try{
      const status=await BrainiDailyHub.resolve(undefined,{forceCloud:true});
      const p=BrainiData.player();

      if(status.completedCount===4){
        root.innerHTML=`
          <section class="daily-caught-up">
            <div class="home-daily-state is-caught-up">
              <div class="home-daily-state-top">
                <span>Daily #${status.dailyNumber}</span>
                <strong>4/4 complete ✓</strong>
              </div>

              <div class="home-daily-state-copy">
                <h1>You’re caught up for today!</h1>
                <p>
                  All four Daily challenges are done.
                  You scored ${Number(status.brainScore||0).toLocaleString()} / 10,000 today.
                  Want to keep testing yourself?
                </p>
              </div>

              <div class="home-daily-state-actions">
                <a class="home-daily-primary" href="../games/index.html">
                  Play more games
                </a>

                <a class="home-daily-tertiary" href="../profile/index.html?section=progress">
                  See my progress
                </a>
              </div>

              <div class="next-daily-countdown" data-next-daily-countdown></div>

              <div data-daily-journey-hub></div>
            </div>
          </section>
        `;

        if(window.BrainiDailyCountdown){
          BrainiDailyCountdown.mount(
            root.querySelector("[data-next-daily-countdown]")
          );
        }

        await BrainiDailyJourney.render(
          root.querySelector("[data-daily-journey-hub]"),
          {status}
        );

        return;
      }

      root.innerHTML=`
        <section class="daily-overview-hero">
          <div>
            <span class="daily-overview-kicker">Daily #${status.dailyNumber}</span>
            <h1>Today's Daily Challenge</h1>
            <p>Four different games. Up to 2,500 points each. Complete all four for the Full Daily bonus.</p>
          </div>

          <div class="daily-overview-summary">
            <div><strong>${status.completedCount}/4</strong><span>completed</span></div>
            <div><strong>${Number(status.brainScore||0).toLocaleString()}</strong><span>Brain Score</span></div>
            <div><strong>🔥 ${Number(p.currentStreak||0)}</strong><span>day streak</span></div>
          </div>
        </section>

        <div data-daily-journey-hub></div>

        <section class="daily-rules-compact">
          <div><strong>Daily Brain Score</strong><span>Only today's 4 Daily Games contribute to the 10,000-point Daily score.</span></div>
          <div><strong>XP</strong><span>Every completed game earns XP. Finishing all four Daily Games adds +250 XP.</span></div>
          <a href="../profile/index.html?section=progress">See my progress →</a>
        </section>
      `;

      await BrainiDailyJourney.render(
        root.querySelector("[data-daily-journey-hub]"),
        {status}
      );
    }catch(err){
      console.error("Daily overview:",err);
      root.innerHTML=`
        <section class="daily-overview-error">
          <h1>Today's Daily could not load.</h1>
          <p>Your saved progress is safe. Check the connection and try again.</p>
          <button type="button" onclick="location.reload()">Retry</button>
        </section>`;
    }
  }

  document.addEventListener("DOMContentLoaded",render);
  window.addEventListener("brainilab:datachange",render);
  window.addEventListener("brainilab:progressionchange",render);

  return {render};
})();
