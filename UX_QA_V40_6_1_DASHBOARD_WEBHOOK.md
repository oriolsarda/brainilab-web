# BrainiLab V40.6.1 — Supabase Dashboard webhook deployment fix

The V40.6 webhook source imported:

../_shared/monetization.ts

That works when deploying the full Supabase functions directory, but the
Supabase Dashboard single-file editor does not automatically include the
sibling `_shared` module.

V40.6.1 inlines the required helpers directly into
`supabase/functions/stripe-webhook/index.ts`.

No database migration changes are required beyond Step 20.1 already run.

Deploy:
- stripe-webhook → Verify JWT OFF
- create-plus-checkout → Verify JWT ON
- create-billing-portal → Verify JWT ON
