# BrainiLab V40.3 — Stripe Checkout Interaction Hardening

On localhost `/plus/` now displays a local-only diagnostic box:

LOCAL STRIPE TEST
Checkout UI ready
Account: SIGNED IN/GUEST
Plus sales: ON/OFF
Billing backend: READY/LOADING
Clicks: N

Clicking Monthly or Annual is handled by a capture-phase delegated event,
so the listener survives every dynamic rerender.

Expected on click, before any network result:

1. `Clicks` increments.
2. Inline status says `Connecting securely to Stripe…`.
3. Button changes to `Opening secure checkout…`.

Then:
- successful request → redirect to Stripe Checkout
- failed request → actual error shown inline

V40.3 also unregisters old BrainiLab service workers and deletes old
`brainilab-static-*` caches on localhost/127.0.0.1, then reloads once if an old
worker was actively controlling the page.

This cleanup never runs on production hostnames.
