# BrainiLab — Step 16: Order Up Daily

Run after Step 15.

Order Up replaces Flag Dash in the current four-game Daily lineup:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Flag Dash is not deleted. Its historical sessions/results stay valid, and the old `/games/flag-dash/` route redirects to the replayable 20-question World Flags quiz.

## Order Up format

Every Daily contains:

```text
2 rounds
10 items per round
```

The player must put all ten items into the requested order.

Examples:

```text
Earliest → Latest
Highest → Lowest
North → South
Oldest → Newest
```

The initial public payload sends the ten labels in shuffled order and does not expose the canonical `sort_position`.

## Scoring

Each 10-item list contains:

```text
45 ordered item pairs
```

For each pair, the backend checks whether the player kept the two items in the correct relative order.

Per round:

```text
correct pairs / 45 × 1,250
```

Two rounds:

```text
maximum 2,500 Daily points
```

The result also records:

```text
exact positions out of 20
pair-order accuracy out of 90 pairs
```

This gives partial credit even when the whole sequence is not perfect.

## Content pool

Step 16 seeds:

```text
37 active Order Up rounds
```

with exactly ten canonical items each.

Generation uses:

```text
2 rounds/day
14-day preferred cooldown
```

A minimum of 30 active rounds is protected in the Admin UI.

## Daily generation

No new Cron is needed.

The existing Daily-generation trigger still fires, but its function is replaced so new Daily rows generate:

```text
BrainiWord
Topic Rush
Order Up
```

rather than new Flag Dash rounds.

Existing future Flag Dash question rows are removed.

Today's existing Flag Dash content/results are retained in the database only so historical/pending result verification does not break.

## Important migration behavior for today

Step 16 uses its execution date as the Order Up launch date.

From that UTC date onward:

```text
Order Up occupies the Daily slot
Flag Dash no longer occupies the Daily slot
```

Therefore, if the development account already completed today's Flag Dash before running Step 16, today changes from:

```text
Brain Mix + Flag Dash + Topic Rush + BrainiWord
```

to:

```text
Brain Mix + Order Up + Topic Rush + BrainiWord
```

and Order Up will appear pending until it is played.

The historical Flag Dash result is not deleted and still keeps its normal XP as a completed game.

## Backend tables

```text
order_up_settings
order_up_rounds
order_up_items
daily_order_up_rounds
```

All have RLS enabled and direct browser table access is revoked.

## Public gameplay RPCs

```text
get_brainilab_daily_order_up()
check_brainilab_order_up_round(...)
verify_brainilab_order_up_result(...)
```

The initial payload does not reveal canonical order.

The round-check RPC returns the canonical order only after the player locks/submits that round.

Final authenticated verification recalculates both rounds from PostgreSQL content.

As with the existing Daily check APIs, `server_verified` remains conservative because a scripted client could call answer-check endpoints directly.

## Progression / rankings

Step 16 adds:

```text
player_daily_stats.orderup_points
```

and integrates Order Up into:

```text
Daily Brain Score
Full Daily
XP / progression rebuild
Individual Rankings
Friends Rankings
Group aggregates
Group Rankings
```

Daily maximum remains:

```text
10,000
```

## Admin

The Backoffice now includes Order Up in:

```text
Dashboard Daily Health
Daily Operations
public payload test
Content Pools
Results filters
Rankings filters
System/runtime flags
```

Admin can create a new Order Up round by entering:

```text
external key
category
title
prompt
direction
exactly 10 lines in canonical order
```

Published/used rounds are not edited in-place; create a new round instead.

## Install

Supabase:

```text
SQL Editor
→ New query
```

Run:

```text
BRAINILAB_STEP16_SQL_COPY_TO_SUPABASE.txt
```

No new Cron.

## Verify

Daily rows:

```sql
select
  dc.challenge_date,
  dc.daily_number,
  count(dour.round_id) as order_up_rounds
from public.daily_challenges dc
left join public.daily_order_up_rounds dour
  on dour.daily_challenge_id=dc.id
where dc.challenge_date>=current_date
group by dc.challenge_date,dc.daily_number
order by dc.challenge_date;
```

Expected:

```text
2 rounds
```

for today and each already-generated future Daily.

Pool:

```sql
select
  count(*) filter(where is_active) as active_rounds
from public.order_up_rounds;
```

Expected:

```text
37
```

RPCs:

```sql
select
  to_regprocedure('public.get_brainilab_daily_order_up()') as get_order_up,
  to_regprocedure(
    'public.check_brainilab_order_up_round(uuid,uuid,jsonb)'
  ) as check_order_up,
  to_regprocedure(
    'public.verify_brainilab_order_up_result(text,uuid,jsonb)'
  ) as verify_order_up;
```

All three should be non-null.
