# BrainiLab V39 — Monetization QA

## Default safety

After Step 20:

```text
Ads globally       OFF
BrainiLab+ sales   OFF
Anchor ads         OFF
Vignette ads       OFF
```

Opening the website before AdSense/Stripe setup must not:

```text
show a blank ad box
load an AdSense request
charge a user
unlock Plus
```

## Ads placements

Prepared manual placements:

```text
home_after_play
games_mid_content
daily_lower
quiz_result
rankings_after_board
about_lower
```

There must be no ad slot inside:

```text
active quiz questions
Brain Mix gameplay
Order Up gameplay
Topic Rush gameplay
BrainiWord gameplay
My BrainiLab / My Stats
Groups
Login
Account & Security
```

`quiz_result` applies to replayable category quiz results only.

## Local placement test

On localhost:

```text
?ads_test=1
```

Expected:

```text
AD TEST
<placement id>
```

No Google ad request is required for this QA mode.

## BrainiLab+ signed out

Directly open:

```text
/plus/
```

If Plus sales are disabled:

```text
BrainiLab+ is prepared for launch
Nothing will be charged
```

No active Checkout button.

## Plus enabled + signed out

When `plus_enabled=true`:

```text
Monthly €2.99
Annual €24.99
```

Clicking a plan while signed out must ask for BrainiLab login before any Checkout request.

## Plus enabled + signed in

Checkout request must go through:

```text
create-plus-checkout
```

The browser sends only:

```text
monthly
yearly
```

Stripe secret/Price authority remains server-side.

## Entitlement

A successful Stripe landing page alone is not enough.

Expected flow:

```text
Stripe payment
→ signed Stripe webhook
→ brainilab_subscriptions
→ get_my_brainilab_entitlements()
→ ads_free=true
```

## Ads vs Plus

For an authenticated Plus account:

```text
ads_free=true
```

Expected:

```text
zero BrainiLab ad slots rendered
```

even if Ads globally and every placement flag are ON.

## Billing management

For an active Plus account:

```text
My BrainiLab
→ Account & Security
→ BrainiLab+
→ Manage subscription
```

must open a server-created Stripe Customer Portal URL.

## Account menu

When Plus launch is disabled and user has no existing membership:

```text
no BrainiLab+ menu row
```

When Plus is enabled:

```text
BrainiLab+
Play without ads
```

When entitled:

```text
BrainiLab+
Active · No ads
```

## Admin

Owner:

```text
Admin
→ Monetization
```

Expected:

```text
Active Plus
Monthly
Annual
Past due
Ending period

Stripe webhook health

Ads globally
BrainiLab+ sales
six manual placements
Anchor ads
Vignette ads
```

Admin must refuse to enable Ads globally if no AdSense publisher ID / slot is configured in the public config.

## Privacy

Footer:

```text
Privacy
Cookies
Manage privacy
```

Before CMP connection, `Manage privacy` safely opens the Cookies/privacy choices page.

After CMP integration it becomes the CMP reopening control.

## Stripe webhook security

Invalid or missing `Stripe-Signature`:

```text
HTTP 400
no entitlement change
```

Duplicate processed Stripe event:

```text
acknowledged
no duplicate subscription effect
```
