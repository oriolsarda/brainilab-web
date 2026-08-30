/*
  BrainiLab Monetization public configuration — V39

  Safe browser-side values only.
  NEVER place Stripe secret keys or Supabase secret/service-role keys here.
*/
window.BRAINI_MONETIZATION_CONFIG={
  ads:{
    provider:"adsense",

    // Add after AdSense approval:
    // publisherId:"ca-pub-1234567890123456"
    publisherId:"",

    slots:{
      home_after_play:"",
      games_mid_content:"",
      daily_lower:"",
      quiz_result:"",
      rankings_after_board:"",
      about_lower:""
    },

    // Google CMP / certified CMP remains the consent authority.
    consentProvider:"google_cmp",

    // Initial launch policy: manual display only.
    allowAnchor:false,
    allowVignette:false
  },

  plus:{
    monthlyLabel:"€2.99 / month",
    yearlyLabel:"€24.99 / year",

    checkoutFunction:"create-plus-checkout",
    portalFunction:"create-billing-portal"
  }
};
