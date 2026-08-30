# BrainiLab V34 — Order Up QA

## Daily lineup

Expected everywhere:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Flag Dash must not appear as a current Daily Game.

## Order Up start

Open:

```text
/games/order-up/
```

Expected intro:

```text
2 rounds
10 items each
2,500 max points
```

No correct order should be visible before a round is locked.

## Round 1

Expected:

```text
Round 1 of 2
direction label
title
prompt
10 numbered items
```

Desktop:
- drag and drop reorders cards.

Mobile / keyboard-friendly fallback:
- up/down buttons reorder cards.

Lock the round.

Expected result:

```text
x / 1,250
x / 45 ordered pairs correct
x exact positions
Correct order
```

Only after locking should the canonical order be shown.

## Round 2

Exactly the same mechanic with a different topic.

After locking:

```text
See result
```

## Final result

Expected:

```text
x / 2,500
x% order accuracy
2 rounds complete
```

Then:

```text
Continue Daily
Share result
See my progress
```

and the four-game Daily Journey.

## Daily score migration

If today's Flag Dash was already played before Step 16:

- historical Flag Dash result remains in Results.
- Flag Dash no longer counts in today's Daily slot.
- Order Up becomes pending.
- after playing Order Up, 4/4 Full Daily returns.

## Daily Hub / Home

Both should display:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

No current Flag Dash card.

## Rankings

Daily-game selector should include:

```text
Order Up
```

and not present Flag Dash as a current Daily option.

Historical Flag Dash records can remain in backend history.

## World Flags

Old:

```text
/games/flag-dash/
```

redirects to:

```text
/geography/world-flags-quiz/
```

World Flags remains a replayable 20-question quiz with Easy / Medium / Hard.

## Admin

Check:

```text
Dashboard
Daily
Content Pools
```

Expected:

- Daily health = Order Up `2 / 2`.
- Daily detail shows both canonical rounds and all 10 items.
- Content Pools has `Order Up`.
- pool count = 37 active.
- create round requires exactly 10 canonical lines.
- disabling cannot reduce active pool below 30.

Run the public-payload test. `get_brainilab_daily_order_up()` must not expose:

```text
sort_position
correct_order
correct_answer
```

## Responsive

Test at desktop and mobile widths.

On mobile the 10-item order is one vertical list and the ↑ / ↓ controls must remain usable.
