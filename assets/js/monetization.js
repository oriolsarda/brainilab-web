/*
  BrainiLab Monetization Controller — V39
  Ads / Plus remain OFF until Step 20 flags are explicitly enabled.
*/
window.BrainiMonetization=(function(){
  const config=
    window.BRAINI_MONETIZATION_CONFIG||{ads:{},plus:{}};

  let entitlements={
    plus:false,
    ads_free:false,
    status:"free",
    plan:null,
    current_period_end:null,
    cancel_at_period_end:false,
    cancel_at:null,
    canceled_at:null,
    scheduled_to_cancel:false,
    cancellation_effective_at:null
  };

  let entitlementReady=false;
  let refreshing=null;
  let checkoutBusy=false;
  let checkoutMessage="";
  let checkoutMessageType="info";

  function plusNotice(message,type="info"){
    const text=String(message||"").trim();

    checkoutMessage=text;
    checkoutMessageType=type;

    document
      .querySelectorAll(
        "[data-plus-status]"
      )
      .forEach(node=>{
        node.hidden=!text;
        node.dataset.state=type;
        node.textContent=text;
      });


    if(
      text
      && typeof window.showToast==="function"
    ){
      window.showToast(text);
    }
  }

  function setCheckoutBusy(busy,plan=null){
    checkoutBusy=!!busy;

    document
      .querySelectorAll(
        "[data-plus-checkout]"
      )
      .forEach(button=>{
        const isTarget=
          !plan
          || button.dataset.plusCheckout===plan;

        button.disabled=checkoutBusy;

        if(checkoutBusy && isTarget){
          if(!button.dataset.originalLabel){
            button.dataset.originalLabel=
              button.textContent.trim();
          }

          button.textContent=
            "Opening secure checkout…";
        }else if(
          !checkoutBusy
          && button.dataset.originalLabel
        ){
          button.textContent=
            button.dataset.originalLabel;

          delete button.dataset.originalLabel;
        }
      });

  }

  function auth(){
    return window.BrainiData?.authState?.()||{
      status:"guest"
    };
  }

  function runtimeEnabled(key){
    return !!(
      window.BrainiRuntime?.has?.(key)
      && BrainiRuntime.get(key)?.enabled===true
    );
  }

  function plusEnabled(){
    return runtimeEnabled("plus_enabled");
  }

  function adsEnabled(){
    return runtimeEnabled("ads_enabled");
  }

  function hasPlus(){
    return entitlements.plus===true;
  }

  function adsFree(){
    return entitlements.ads_free===true;
  }

  function canDecideAds(){
    return auth().status!=="authenticated"
      || entitlementReady;
  }

  function snapshot(){
    return {
      plusEnabled:plusEnabled(),
      adsEnabled:adsEnabled(),
      hasPlus:hasPlus(),
      adsFree:adsFree(),
      entitlementReady,
      entitlements:{...entitlements}
    };
  }

  function emit(){
    window.dispatchEvent(
      new CustomEvent(
        "brainilab:monetizationchange",
        {detail:snapshot()}
      )
    );
  }

  async function refresh({forceCloud=false}={}){
    if(refreshing) return refreshing;

    refreshing=(async()=>{
      const current=auth();

      if(current.status!=="authenticated"){
        entitlements={
          plus:false,
          ads_free:false,
          status:"free",
          plan:null,
          current_period_end:null,
          cancel_at_period_end:false,
          cancel_at:null,
          canceled_at:null,
          scheduled_to_cancel:false,
          cancellation_effective_at:null
        };
        entitlementReady=true;
        emit();
        renderAll();
        return snapshot();
      }

      if(
        !window.BrainiMonetizationBackend
        && forceCloud
        && window.BrainiPerf?.ensureCloud
      ){
        await BrainiPerf.ensureCloud();
      }

      if(!window.BrainiMonetizationBackend){
        entitlementReady=false;
        emit();
        return snapshot();
      }

      try{
        const value=
          await BrainiMonetizationBackend
            .getEntitlements();

        entitlements={
          ...entitlements,
          ...(value||{})
        };
        entitlementReady=true;
      }catch(err){
        // Fail closed for logged-in users: do not show ads until entitlement
        // state is known.
        entitlementReady=false;
        console.warn(
          "BrainiLab entitlements:",
          err.message||err
        );
      }

      emit();
      renderAll();
      return snapshot();
    })();

    try{
      return await refreshing;
    }finally{
      refreshing=null;
    }
  }

  function plusHref(){
    return "/plus/";
  }

  function ensureLogin(){
    if(window.BrainiAuth?.open){
      BrainiAuth.open({
        source:"brainilab_plus",
        mode:"signin"
      });
      return;
    }

    window.BrainiPerf
      ?.ensureCloud?.()
      .then(()=>{
        BrainiAuth?.open?.({
          source:"brainilab_plus",
          mode:"signin"
        });
      });
  }

  async function checkout(plan){
    const normalized=
      plan==="yearly"
        ?"yearly"
        :"monthly";

    if(checkoutBusy) return;


    plusNotice(
      "Connecting securely to Stripe…",
      "info"
    );

    BrainiData?.track?.(
      "plus_checkout_started",
      {plan:normalized}
    );

    if(auth().status!=="authenticated"){
      plusNotice(
        "Log in to BrainiLab before choosing a Plus plan.",
        "info"
      );

      ensureLogin();
      return;
    }

    if(!plusEnabled()){
      plusNotice(
        "BrainiLab+ sales are currently disabled. Enable BrainiLab+ sales in Admin → Monetization for this test.",
        "warning"
      );
      return;
    }

    setCheckoutBusy(
      true,
      normalized
    );

    try{
      if(
        !window.BrainiMonetizationBackend
        && window.BrainiPerf?.ensureCloud
      ){
        await BrainiPerf.ensureCloud();
      }

      if(!window.BrainiMonetizationBackend){
        throw new Error(
          "The BrainiLab billing connection did not load. Hard-refresh the page and try again."
        );
      }

      const data=
        await BrainiMonetizationBackend
          .createCheckout(
            normalized
          );

      if(!data?.url){
        throw new Error(
          "Stripe Checkout did not return a secure checkout URL."
        );
      }

      plusNotice(
        "Opening Stripe secure checkout…",
        "success"
      );

      location.assign(data.url);
    }catch(err){
      console.error(
        "BrainiLab+ checkout:",
        err
      );

      plusNotice(
        err?.message
        || "Could not start Stripe Checkout.",
        "error"
      );

      setCheckoutBusy(false);
    }
  }

  async function openPortal(){
    if(auth().status!=="authenticated"){
      ensureLogin();
      return;
    }

    if(!window.BrainiMonetizationBackend){
      await BrainiPerf?.ensureCloud?.();
    }

    try{
      const data=
        await BrainiMonetizationBackend
          .createPortal();

      if(!data?.url){
        throw new Error(
          "Billing portal URL was not returned"
        );
      }

      location.href=data.url;
    }catch(err){
      console.warn("BrainiLab billing portal:",err);
      plusNotice(
        err?.message
        || "Could not open billing.",
        "error"
      );
    }
  }

  function planName(){
    if(entitlements.plan==="plus_yearly"){
      return "Annual plan";
    }

    if(entitlements.plan==="plus_monthly"){
      return "Monthly plan";
    }

    return "BrainiLab+";
  }

  function dateText(value){
    if(!value) return "";

    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(
      undefined,
      {
        year:"numeric",
        month:"short",
        day:"numeric"
      }
    ).format(date);
  }

  function scheduledToCancel(){
    return (
      entitlements.scheduled_to_cancel===true
      || (
        ["active","trialing"].includes(
          String(entitlements.status||"")
        )
        && (
          !!entitlements.cancel_at
          || entitlements.cancel_at_period_end===true
        )
      )
    );
  }

  function cancellationDate(){
    return (
      entitlements.cancellation_effective_at
      || entitlements.cancel_at
      || (
        entitlements.cancel_at_period_end
          ?entitlements.current_period_end
          :null
      )
    );
  }

  function renderAccountCard(){
    document
      .querySelectorAll(
        "[data-plus-account-root]"
      )
      .forEach(root=>{
        if(auth().status!=="authenticated"){
          root.innerHTML=`
            <div class="plus-account-card">
              <div>
                <span>BrainiLab+</span>
                <strong>
                  Sign in to manage BrainiLab+
                </strong>
                <p>
                  Your subscription is tied to your
                  BrainiLab account.
                </p>
              </div>

              <button
                type="button"
                class="btn-light"
                data-plus-login
              >
                Log in
              </button>
            </div>
          `;

          root
            .querySelector("[data-plus-login]")
            ?.addEventListener(
              "click",
              ensureLogin
            );
          return;
        }

        if(!entitlementReady){
          root.innerHTML=`
            <div class="plus-account-card">
              <div>
                <span>BrainiLab+</span>
                <strong>Checking membership…</strong>
              </div>
            </div>
          `;
          return;
        }

        if(hasPlus()){
          const end=
            dateText(
              entitlements.current_period_end
            );

          root.innerHTML=`
            <div class="plus-account-card is-plus">
              <div>
                <span>BrainiLab+</span>
                <strong>${planName()}</strong>
                <p>
                  No ads anywhere in BrainiLab.
                  ${
                    scheduledToCancel()
                      ? (
                          dateText(cancellationDate())
                            ? `Access until ${dateText(cancellationDate())}. Your plan will not renew.`
                            : "Your plan is scheduled to end and will not renew."
                        )
                      : (
                          end
                            ? `Current period ends ${end}.`
                            : ""
                        )
                  }
                </p>
              </div>

              <button
                type="button"
                class="btn-light"
                data-plus-portal
              >
                Manage subscription
              </button>
            </div>
          `;

          root
            .querySelector("[data-plus-portal]")
            ?.addEventListener(
              "click",
              openPortal
            );

          return;
        }

        if(!plusEnabled()){
          root.innerHTML=`
            <div class="plus-account-card">
              <div>
                <span>BrainiLab+</span>
                <strong>Coming soon</strong>
                <p>
                  The ad-free membership is prepared
                  but not available yet.
                </p>
              </div>
            </div>
          `;
          return;
        }

        root.innerHTML=`
          <div class="plus-account-card">
            <div>
              <span>BrainiLab+</span>
              <strong>Play without ads</strong>
              <p>
                Upgrade for an ad-free BrainiLab
                experience.
              </p>
            </div>

            <a
              class="btn"
              href="${plusHref()}"
            >
              See BrainiLab+
            </a>
          </div>
        `;
      });
  }

  function renderPlusPage(){
    const root=
      document.querySelector(
        "[data-plus-page-root]"
      );

    if(!root) return;

    const monthly=
      config.plus?.monthlyLabel
      ||"€2.99 / month";

    const yearly=
      config.plus?.yearlyLabel
      ||"€24.99 / year";

    const logged=
      auth().status==="authenticated";

    const active=
      entitlementReady&&hasPlus();

    const salesOpen=plusEnabled();

    let action="";

    if(logged && !entitlementReady){
      action=`
        <div class="plus-current-card">
          <span>MEMBERSHIP STATUS</span>
          <h2>We couldn't verify your membership yet</h2>
          <p>
            Your billing status is protected while BrainiLab reconnects.
            You will not be asked to purchase again until verification succeeds.
          </p>
          <button
            type="button"
            class="btn-light"
            data-plus-retry
          >
            Try again
          </button>
        </div>
      `;
    }else if(active){
      action=`
        <div class="plus-current-card">
          <span>YOUR MEMBERSHIP</span>
          <h2>BrainiLab+ is active</h2>
          <p>
            You are playing without ads.
            ${scheduledToCancel()
              ? (
                  dateText(cancellationDate())
                    ? `Your membership will end on ${dateText(cancellationDate())} and will not renew.`
                    : "Your membership is scheduled to end and will not renew."
                )
              : ""
            }
          </p>
          <button
            type="button"
            class="btn-light"
            data-plus-portal
          >
            Manage subscription
          </button>
        </div>
      `;
    }else if(!salesOpen){
      action=`
        <div class="plus-current-card">
          <span>COMING SOON</span>
          <h2>BrainiLab+ is prepared for launch</h2>
          <p>
            Membership sales are currently disabled.
            Nothing will be charged.
          </p>
        </div>
      `;
    }else{
      action=`
        <div class="plus-pricing-grid">
          <article class="plus-price-card">
            <span>MONTHLY</span>
            <h2>€2.99</h2>
            <p>per month</p>
            <button
              type="button"
              class="btn-light"
              data-plus-checkout="monthly"
            >
              ${logged?"Choose monthly":"Log in to upgrade"}
            </button>
          </article>

          <article class="plus-price-card featured">
            <span>BEST VALUE · ANNUAL</span>
            <h2>€24.99</h2>
            <p>
              per year · about 30% less than monthly
            </p>
            <button
              type="button"
              class="btn"
              data-plus-checkout="yearly"
            >
              ${logged?"Choose annual":"Log in to upgrade"}
            </button>
          </article>
        </div>
      `;
    }

    root.innerHTML=`
      <section class="plus-hero">
        <span>BrainiLab+</span>
        <h1>A cleaner way to play.</h1>
        <p>
          Remove advertising everywhere in BrainiLab
          and support the games you play.
        </p>
      </section>

      <div class="plus-benefits">
        <article>
          <strong>No ads</strong>
          <p>
            No display ads across BrainiLab while
            your membership is active.
          </p>
        </article>

        <article>
          <strong>Support BrainiLab</strong>
          <p>
            Help fund new questions, Daily games
            and product improvements.
          </p>
        </article>

        <article>
          <strong>No competitive advantage</strong>
          <p>
            Plus never gives extra points, attempts,
            XP multipliers or ranking advantages.
          </p>
        </article>
      </div>

      <div
        class="plus-status"
        data-plus-status
        data-state="${checkoutMessageType}"
        role="status"
        aria-live="polite"
        ${checkoutMessage?"":"hidden"}
      >${checkoutMessage}</div>

      ${action}

      <div class="plus-fineprint">
        <strong>Simple membership.</strong>
        <span>
          Monthly: ${monthly}. Annual: ${yearly}.
          Billing is managed securely by Stripe.
        </span>
      </div>
    `;

    root
      .querySelectorAll(
        "[data-plus-checkout]"
      )
      .forEach(button=>{
        button.addEventListener(
          "click",
          ()=>checkout(
            button.dataset.plusCheckout
          )
        );
      });

    root
      .querySelector("[data-plus-portal]")
      ?.addEventListener(
        "click",
        openPortal
      );

    root
      .querySelector("[data-plus-retry]")
      ?.addEventListener(
        "click",
        ()=>refresh({forceCloud:true})
      );

    if(checkoutBusy){
      setCheckoutBusy(true);
    }


    const params=
      new URLSearchParams(location.search);

    if(params.get("checkout")==="success"){
      BrainiData?.track?.(
        "plus_checkout_returned",
        {status:"success"}
      );

      // Webhook remains authoritative. Refresh after a short
      // delay in case Stripe delivery is still in flight.
      setTimeout(
        async()=>{
          const state=
            await refresh({
              forceCloud:true
            });

          if(state?.hasPlus){
            BrainiData?.track?.(
              "plus_checkout_completed",
              {
                plan:
                  state.entitlements?.plan
                  ||null
              }
            );
          }
        },
        1200
      );
    }
  }

  function renderAll(){
    renderAccountCard();
    renderPlusPage();
  }

  async function boot(){
    const current=auth();

    if(
      current.status==="authenticated"
      && !window.BrainiMonetizationBackend
      && window.BrainiPerf?.ensureCloud
    ){
      // Static pages keep this outside critical rendering;
      // cloud may already be loading in idle time.
    }

    await refresh();
  }

  // Capture-phase delegated handler:
  // survives every dynamic Plus-page rerender and cannot lose its listener.
  document.addEventListener(
    "click",
    event=>{
      const button=
        event.target.closest?.(
          "[data-plus-checkout]"
        );

      if(!button) return;

      event.preventDefault();
      event.stopPropagation();

      checkout(
        button.dataset.plusCheckout
      );
    },
    true
  );

  document.addEventListener(
    "click",
    event=>{
      const link=
        event.target.closest?.(
          "[data-manage-privacy]"
        );

      if(!link) return;

      const handler=
        config.ads?.managePrivacy;

      if(typeof handler==="function"){
        event.preventDefault();
        handler();
      }
      // Otherwise the ordinary Cookies / Privacy href remains the fallback.
    }
  );

  window.addEventListener(
    "brainilab:cloudready",
    ()=>refresh()
  );


  window.addEventListener(
    "brainilab:authchange",
    ()=>refresh({forceCloud:true})
  );

  window.addEventListener(
    "brainilab:runtimechange",
    ()=>{
      emit();
      renderAll();
    }
  );

  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      {once:true}
    );
  }else{
    queueMicrotask(boot);
  }

  return {
    refresh,
    snapshot,
    plusEnabled,
    adsEnabled,
    hasPlus,
    adsFree,
    canDecideAds,
    checkout,
    openPortal,
    renderAll,
    plusHref
  };
})();
