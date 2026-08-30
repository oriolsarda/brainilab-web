# BrainiLab+ / Stripe — V39

## Security model

Browser:

```text
plan choice only
authenticated Supabase session
```

Server:

```text
Stripe secret key
Stripe Price IDs
Checkout session creation
Customer Portal creation
webhook signature verification
subscription state writes
```

Database/browser grants do not allow users to edit:

```text
billing_customers
brainilab_subscriptions
stripe_webhook_events
```

## Entitlement rule

BrainiLab+ is granted only when:

```text
plan = plus_monthly OR plus_yearly
AND
status = active OR trialing
```

Existing paid members remain entitled even if:

```text
plus_enabled = false
```

because that flag controls new sales, not already-paid access.

## No competitive advantage

BrainiLab+ changes:

```text
ads_free
```

It does not change:

```text
scores
Daily Brain Score
XP
attempts
streaks
rankings
Groups scoring
question availability
```

## Price display vs price authority

Browser display:

```text
€2.99 / month
€24.99 / year
```

Actual Stripe Price IDs are Edge Function secrets.

This prevents a browser request from choosing an arbitrary Stripe price.
