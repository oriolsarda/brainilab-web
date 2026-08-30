# BrainiLab V40.4 — Supabase Auth → Stripe Edge Function bridge

## What changed

BrainiLab now sends billing function credentials explicitly:

Authorization: Bearer <SIGNED-IN USER ACCESS TOKEN>
apikey: <PUBLIC sb_publishable_... key>

The publishable key is never used as a Bearer credential.

## Local diagnostic

Open:

http://localhost:8000/plus/

Expected before Checkout:

Account: SIGNED IN
Supabase JWT: READY
Plus sales: ON
Billing backend: READY

If `Supabase JWT: MISSING`, the local BrainiLab account state exists but the
real Supabase browser session is missing.

## Edge Function setting

The deployed billing functions use:

withSupabase({ auth: "user" })

For projects using the new `sb_publishable_...` API-key model, BrainiLab's
recommended configuration is to let `@supabase/server` perform the user
authorization itself.

Set in Supabase Dashboard:

create-plus-checkout  → Verify JWT ON
create-billing-portal → Verify JWT ON
stripe-webhook        → Verify JWT OFF

Security remains:

- Checkout / Portal require a valid user JWT because `auth:"user"` verifies it.
- Stripe webhook uses `auth:"none"` but verifies Stripe's cryptographic
  `stripe-signature` in the function itself.

## Test

Click Monthly.

Expected:
1. Clicks increments.
2. Connecting securely to Stripe…
3. Opening secure checkout…
4. Redirect to Stripe-hosted Checkout.

If it fails, the visible message is now the actual Edge Function/platform
response rather than a generic local-auth mismatch.
