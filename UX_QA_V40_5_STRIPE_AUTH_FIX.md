# BrainiLab V40.5 — Stripe Auth Fix

## Root cause

`@supabase/server` exposes the authenticated user identity as:

```ts
ctx.userClaims.id
```

The previous BrainiLab Stripe functions incorrectly read:

```ts
ctx.userClaims?.sub
```

The JWT itself contains a `sub` claim, but `userClaims` is the normalized
identity object. As a result, the wrapper authenticated the request correctly
while BrainiLab's own `userId` check became empty and returned:

```text
Authentication required
```

## Corrected functions

- `create-plus-checkout`
- `create-billing-portal`

Both now use:

```ts
const userId = String(ctx.userClaims?.id || "");
```

## Verify JWT

Correct production/test configuration:

```text
create-plus-checkout  → Verify JWT ON
create-billing-portal → Verify JWT ON
stripe-webhook        → Verify JWT OFF
```

Checkout and Portal use `withSupabase({ auth: "user" })`.
Stripe webhook uses `withSupabase({ auth: "none" })` and authenticates Stripe
using `stripe-signature`.
