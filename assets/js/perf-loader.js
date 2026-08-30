/*
  BrainiLab Performance Loader — V37
  Loads Supabase/cloud only when a page actually needs it.
*/
window.BrainiPerf=(function(){
  const scriptUrl=document.currentScript?.src||location.href;
  const jsBase=new URL("./",scriptUrl);
  let supabasePromise=null;
  let cloudPromise=null;

  function loadScript(src,attrs={}){
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(s=>s.src===src);
      if(existing){
        if(existing.dataset.loaded==="1" || existing.readyState==="complete"){
          resolve();
          return;
        }
        existing.addEventListener("load",resolve,{once:true});
        existing.addEventListener("error",reject,{once:true});
        return;
      }

      const s=document.createElement("script");
      s.src=src;
      s.async=true;
      Object.entries(attrs).forEach(([k,v])=>{
        if(v===true) s.setAttribute(k,"");
        else if(v!==false && v!=null) s.setAttribute(k,String(v));
      });
      s.addEventListener("load",()=>{
        s.dataset.loaded="1";
        resolve();
      },{once:true});
      s.addEventListener("error",()=>reject(new Error(`Could not load ${src}`)),{once:true});
      document.head.appendChild(s);
    });
  }

  function ensureSupabase(){
    if(window.supabase?.createClient) return Promise.resolve();
    if(supabasePromise) return supabasePromise;

    supabasePromise=loadScript(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      {crossorigin:"anonymous"}
    );

    return supabasePromise;
  }

  async function ensureCloud(){
    if(window.BrainiBackendAuth && window.BrainiAuth) return true;
    if(cloudPromise) return cloudPromise;

    cloudPromise=(async()=>{
      await ensureSupabase();
      await loadScript(new URL("cloud.bundle.js?v=41.8.0",jsBase).href);
      window.dispatchEvent(new CustomEvent("brainilab:cloudready"));
      return true;
    })();

    try{
      return await cloudPromise;
    }catch(err){
      cloudPromise=null;
      console.warn("BrainiLab cloud bootstrap:",err.message||err);
      return false;
    }
  }

  function idleCloud(){
    // OAuth callbacks must complete immediately.
    const params=new URLSearchParams(location.search);
    if(params.has("code") || params.has("error")){
      ensureCloud();
      return;
    }

    const run=()=>ensureCloud();
    if("requestIdleCallback" in window){
      requestIdleCallback(run,{timeout:2500});
    }else{
      setTimeout(run,1500);
    }
  }

  // Make account/auth interaction responsive even on otherwise static pages.
  document.addEventListener("pointerdown",e=>{
    if(e.target.closest(".avatar,[data-account-login],[data-account-signup]")){
      ensureCloud();
    }
  },{capture:true,passive:true});


  function installNavigationPrefetch(){
    const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType||"")){
      return;
    }

    const seen=new Set();

    document.addEventListener("pointerover",e=>{
      const a=e.target.closest?.("a[href]");
      if(!a) return;

      try{
        const u=new URL(a.href,location.href);
        if(
          u.origin!==location.origin ||
          !["http:","https:"].includes(u.protocol) ||
          u.hash && u.pathname===location.pathname
        ){
          return;
        }

        const key=u.pathname+u.search;
        if(seen.has(key)) return;
        seen.add(key);

        const link=document.createElement("link");
        link.rel="prefetch";
        link.href=u.href;
        link.as="document";
        document.head.appendChild(link);
      }catch(err){}
    },{passive:true});
  }

  function cleanupLocalServiceWorkers(){
    const isLocal=
      location.protocol==="file:"
      || ["localhost","127.0.0.1","::1"]
        .includes(location.hostname);

    if(!isLocal) return;

    if("serviceWorker" in navigator){
      navigator.serviceWorker
        .getRegistrations()
        .then(async registrations=>{
          if(!registrations.length) return;

          await Promise.all(
            registrations.map(
              registration=>
                registration.unregister()
            )
          );

          if(
            navigator.serviceWorker.controller
            && sessionStorage.getItem(
              "brainilab-sw-cleaned-v410"
            )!=="1"
          ){
            sessionStorage.setItem(
              "brainilab-sw-cleaned-v410",
              "1"
            );

            location.reload();
          }
        })
        .catch(()=>{});
    }

    if("caches" in window){
      caches.keys()
        .then(keys=>
          Promise.all(
            keys
              .filter(
                key=>
                  key.startsWith(
                    "brainilab-static-"
                  )
              )
              .map(
                key=>caches.delete(key)
              )
          )
        )
        .catch(()=>{});
    }
  }

  function registerServiceWorker(){
    if(
      window.BRAINI_ENABLE_SW!==true ||
      !("serviceWorker" in navigator) ||
      !["http:","https:"].includes(location.protocol) ||
      ["localhost","127.0.0.1","::1"].includes(location.hostname)
    ){
      return;
    }

    window.addEventListener("load",()=>{
      navigator.serviceWorker.register("/sw.js").catch(err=>{
        console.warn("BrainiLab service worker:",err.message||err);
      });
    },{once:true});
  }

  function loadFeature(filename){
    return loadScript(
      new URL(
        `${filename}${filename.includes("?")?"&":"?"}v=37`,
        jsBase
      ).href
    );
  }

  installNavigationPrefetch();
  cleanupLocalServiceWorkers();
  registerServiceWorker();

  return {
    ensureSupabase,
    ensureCloud,
    idleCloud,
    loadFeature,
    jsBase
  };
})();
