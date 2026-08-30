# BrainiLab V40.6 — Stripe scheduled cancellation

## Why this exists

Stripe can schedule a subscription cancellation with:

- `cancel_at` = future Unix timestamp
- `cancel_at_period_end` = false

That is exactly what the BrainiLab Test Mode Customer Portal returned.

## Changes

1. `brainilab_subscriptions`
   - adds `cancel_at`
   - adds `canceled_at`

2. Stripe webhook
   - persists both Stripe fields on every subscription sync
   - continues to persist `cancel_at_period_end`

3. Entitlements RPC
   - returns `cancel_at`
   - returns `canceled_at`
   - returns derived `scheduled_to_cancel`
   - returns derived `cancellation_effective_at`

4. BrainiLab+ UI
   - keeps Plus active while Stripe status is `active` / `trialing`
   - shows the effective cancellation date
   - says the plan will not renew

5. Admin monetization
   - counts all scheduled cancellations, whether Stripe uses
     `cancel_at` or `cancel_at_period_end`.

## Required deployment order

1. Run `supabase/step20_1_stripe_scheduled_cancellation.sql`.
2. Replace/deploy `stripe-webhook` with the V40.6 source.
3. Keep `stripe-webhook` Verify JWT = OFF.
4. Because the prior Stripe event was already idempotently marked `processed`,
   trigger one fresh subscription update in Stripe (for example resume and
   cancel again in Test Mode) so the new webhook receives current state.
5. Serve/deploy V40.6 frontend.

## Correct end state

For the tested cancellation, BrainiLab may legitimately store:

status = active
cancel_at_period_end = false
cancel_at = 2026-09-29...
scheduled_to_cancel = true

This means the membership remains entitled until the cancellation date and
will not renew.
