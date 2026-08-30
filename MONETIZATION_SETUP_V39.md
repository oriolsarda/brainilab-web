# BrainiLab V39 — Monetization Launch Setup

V39 prepares advertising and BrainiLab+ but launches both OFF.

## 1. Database

Run after Step 19:

```text
BRAINILAB_STEP20_SQL_COPY_TO_SUPABASE.txt
```

Step 20 adds:

```text
billing_customers
brainilab_subscriptions
stripe_webhook_events
get_my_brainilab_entitlements()
admin_get_monetization_health()
```

and launch flags:

```text
ads_enabled
plus_enabled

ad_home_after_play_enabled
ad_games_mid_content_enabled
ad_daily_lower_enabled
ad_quiz_result_enabled
ad_rankings_after_board_enabled
ad_about_lower_enabled

anchor_ads_enabled
vignette_ads_enabled
```

All monetization launch flags start OFF.

## 2. Stripe Edge Functions

Prepared functions:

```text
supabase/functions/create-plus-checkout
supabase/functions/create-billing-portal
supabase/functions/stripe-webhook
```

Required secrets:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SIGNING_SECRET
STRIPE_PRICE_MONTHLY
STRIPE_PRICE_YEARLY
SITE_URL
```

Copy:

```text
supabase/stripe-secrets.example
```

to a private local env file and replace the placeholders.

Never put these secrets in:

```text
assets/js/
HTML
Git
browser localStorage
```

## 3. Stripe products

Create two recurring Stripe Prices:

```text
BrainiLab+ Monthly
€2.99 / month

BrainiLab+ Annual
€24.99 / year
```

Put the resulting `price_...` IDs into the Edge Function secrets:

```text
STRIPE_PRICE_MONTHLY
STRIPE_PRICE_YEARLY
```

The browser never receives those IDs as authority. It sends only:

```text
monthly
yearly
```

and the server maps that to the configured Stripe Price.

## 4. Deploy Edge Functions

Using the Supabase CLI:

```bash
supabase functions deploy create-plus-checkout
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook
```

`supabase/config.toml` already marks:

```text
stripe-webhook
verify_jwt = false
```

because Stripe authenticates that endpoint using its signed webhook request.

The Checkout and Portal endpoints require an authenticated BrainiLab user.

## 5. Stripe webhook

Production endpoint:

```text
https://wvgcdlxebbybthyuajgb.supabase.co/functions/v1/stripe-webhook
```

Subscribe at minimum to:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Copy the endpoint signing secret to:

```text
STRIPE_WEBHOOK_SIGNING_SECRET
```

The webhook is authoritative for BrainiLab+ entitlement state.

A return to:

```text
/plus/?checkout=success
```

does not unlock Plus by itself.

## 6. Customer Portal

Enable/configure Stripe Customer Portal in Stripe.

BrainiLab uses it for:

```text
payment-method changes
invoices
cancellation
subscription management
```

BrainiLab does not build its own card-management UI.

## 7. AdSense configuration

V39 includes a public-ID helper:

```bash
python3 tools/configure-monetization.py \
  --publisher ca-pub-... \
  --home ... \
  --games ... \
  --daily ... \
  --quiz-result ... \
  --rankings ... \
  --about ...
```

It updates:

```text
assets/js/monetization-config.js
/ads.txt
google-adsense-account meta verification
```

It accepts public AdSense identifiers only and never handles Stripe secrets.

You can also configure the same values manually in:

```text
assets/js/monetization-config.js
```

Fill:

```text
publisherId

home_after_play
games_mid_content
daily_lower
quiz_result
rankings_after_board
about_lower
```

Only public AdSense publisher/slot identifiers belong in this file.

## 8. ads.txt

V39 contains a safe non-authorizing placeholder:

```text
/ads.txt
```

Replace the commented placeholder with the exact line supplied by the AdSense account before enabling production ads.

## 9. Consent / CMP

Before production advertising, finish the certified CMP setup.

V39 already provides:

```text
/privacy/
/cookies/
Manage privacy
```

and marks the Ads configuration as:

```text
consentProvider = google_cmp
```

The footer's `Manage privacy` entry is the prepared consent-control entry point. Until the real CMP is wired, it safely falls back to the Cookies page.

## 10. Local ad-placement QA

On localhost or `file://` only:

```text
?ads_test=1
```

Example:

```text
http://localhost:8000/games/?ads_test=1
```

This renders a BrainiLab test placeholder without calling AdSense.

It lets you inspect layout before real publisher/slot IDs exist.

## 11. Launch order

Recommended:

```text
1. Step 20 database migration
2. Stripe TEST products/prices
3. Deploy Edge Functions
4. Stripe TEST webhook
5. Test Checkout → webhook → Plus entitlement → Portal
6. Configure production CMP
7. AdSense approval
8. Add AdSense publisher + six slot IDs
9. Publish real ads.txt
10. Stripe LIVE products/prices/secrets
11. Test one real low-risk subscription
12. Admin → Monetization
13. Enable selected manual placements
14. Enable BrainiLab+ sales
15. Enable Ads globally
```

Keep:

```text
anchor_ads_enabled = false
vignette_ads_enabled = false
```

for the initial launch.
