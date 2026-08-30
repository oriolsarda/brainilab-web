# BrainiLab Ads — V39

## Launch philosophy

Monetize transitions and browsing, not concentration.

V39 implements manual display inventory only.

## Prepared placements

```text
home_after_play
games_mid_content
daily_lower
quiz_result
rankings_after_board
about_lower
```

Each placement requires three independent conditions:

```text
Ads global flag ON
placement flag ON
AdSense publisher + slot ID configured
```

For a signed-in user, entitlement must also be resolved before an ad may render.

If:

```text
ads_free=true
```

the slot is suppressed.

## Lazy loading

AdSense itself is not loaded merely because BrainiLab has an Ads Manager.

The provider script loads only when:

```text
eligible slot approaches viewport
AND
user is not Plus
AND
runtime flags allow it
AND
publisher/slot IDs exist
```

## Layout stability

Ad containers are hidden until eligible.

Once active, BrainiLab reserves a controlled display surface so the ad is not placed directly beside answer/play controls.

## Initial launch

Do not enable:

```text
anchor_ads_enabled
vignette_ads_enabled
```

The V39 Admin exposes those switches only as future post-launch experiments.

## Product analytics events

Prepared browser events:

```text
ad_slot_viewed
ad_slot_filled
ad_slot_unfilled

plus_checkout_started
plus_checkout_returned
plus_checkout_completed
```

Every ad event includes the placement ID.
