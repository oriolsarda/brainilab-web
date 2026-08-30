# BrainiLab V40.2 — Stripe Checkout Click Fix

## Fix

V40.1 could fail silently on BrainiLab+ Checkout because the error path tried
to call a page-global toast function that does not exist on every Plus page.

V40.2 now:

- disables the selected plan button while opening Checkout
- changes its text to `Opening secure checkout…`
- shows Edge Function / Stripe errors inline on `/plus/`
- safely loads the billing cloud adapter
- parses Supabase Edge Function response errors
- uses the current cloud bundle version instead of the stale V37 loader URL

## Expected test

1. `BrainiLab+ sales = ON`
2. Signed in at `http://localhost:8000`
3. Open `http://localhost:8000/plus/`
4. Click monthly

Expected immediately:

`Opening secure checkout…`

Then either:

A. Redirect to Stripe Checkout

or

B. A visible error box explaining the actual failure.

There must no longer be a silent click.

## Common visible errors

`BrainiLab+ sales are currently disabled`
→ Admin runtime flag is OFF.

`Authentication required`
→ Browser session is not signed in.

`STRIPE_SECRET_KEY is not configured`
→ Supabase Edge Function secret is missing.

`STRIPE_PRICE_MONTHLY is not configured`
→ Supabase monthly Price secret is missing.

`Could not ... billing customer`
→ inspect the `create-plus-checkout` Edge Function logs.

`Failed to send a request to the Edge Function`
→ function is missing, deployment failed, CORS/network issue, or wrong function name.
