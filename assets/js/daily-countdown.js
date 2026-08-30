/*
  BrainiLab Daily Countdown — V38
  Next Daily rolls over at 00:00 UTC.
*/
window.BrainiDailyCountdown=(function(){
  const timers=new WeakMap();

  function remaining(){
    const now=new Date();
    const next=new Date(now);
    next.setUTCHours(24,0,0,0);

    const ms=Math.max(0,next-now);
    const total=Math.floor(ms/1000);

    return {
      hours:Math.floor(total/3600),
      minutes:Math.floor((total%3600)/60),
      seconds:total%60
    };
  }

  function pad(value){
    return String(value).padStart(2,"0");
  }

  function text(){
    const r=remaining();
    return `${pad(r.hours)}:${pad(r.minutes)}:${pad(r.seconds)}`;
  }

  function mount(element){
    if(!element) return;

    const previous=timers.get(element);
    if(previous) clearInterval(previous);

    const update=()=>{
      element.innerHTML=`
        <span>Next Daily</span>
        <strong>${text()}</strong>
        <small>UTC</small>
      `;
    };

    update();

    const id=setInterval(update,1000);
    timers.set(element,id);
  }

  return {mount,text};
})();
