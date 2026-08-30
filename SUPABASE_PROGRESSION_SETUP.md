# BrainiLab — Step 6: Player progression & aggregates

Step 1: Auth ✓  
Step 2: Profiles ✓  
Step 3: Sessions/results ✓  
Step 4: Question bank ✓  
Step 5: Automated Daily ✓  
Step 6: Progression + aggregate stats ✓

## What Step 6 makes real

Stored and recalculated in PostgreSQL:

- current streak
- best streak
- Full Daily count
- XP
- level
- total games
- total questions
- favorite game
- Daily Brain Score
- Daily-game completion
- weekly totals
- monthly totals
- personal bests
- per-game day/week/month aggregates

These are no longer only mock/local values after sign-in.

---

# Product rules

## Streak

A streak day is earned by completing **at least one** of the four Daily Games:

```text
Brain Mix
Flag Dash
Map Hunt
BrainiWord
```

A user does not lose the visible current streak during the current UTC day if they completed yesterday. It drops to 0 only after a full UTC day is missed.

## Full Daily

```text
4 / 4 Daily Games completed
```

on the same UTC date.

This is tracked separately from the regular streak.

## Daily Brain Score

Maximum:

```text
10,000
```

Each game contributes up to:

```text
2,500
```

The best contribution from each Daily Game on that date is used.

Current formulas preserve the existing BrainiLab product:

```text
Brain Mix
min(2500, raw score × 0.25)

Flag Dash
min(2500, correct × 70 + best combo × 15)

Map Hunt
min(2500, raw score × 0.42)

BrainiWord
1 try  = 2500
2      = 2250
3      = 2000
4      = 1750
5      = 1500
failed = 250
```

Guest/local calculation was also changed to best-of-day so a guest sees the same Daily Brain Score after later signing in.

---

# XP

XP is progression, not a competitive ranking metric.

Current transparent formula:

```text
50 XP per completed game
+
5 XP per correct answer
  (correct-answer XP capped at 50 answers per result)
+
250 XP per Full Daily
```

Level is calculated from cumulative XP using a gradually increasing curve.

The exact XP economy can be adjusted later without changing the game-result schema.

---

# Tables

## `player_progression`

One row per authenticated user.

Important fields:

```text
current_streak
best_streak
full_daily_count
xp
level
total_games
total_questions
favorite_game_id
last_streak_date
last_active_at
```

## `player_daily_stats`

One row per:

```text
user + UTC date
```

Contains:

```text
daily_games_completed
full_daily

brainmix_points
flagdash_points
maphunt_points
brainiword_points

daily_brain_score

games_played
questions_answered
xp_earned
```

This table will later power Daily Rankings efficiently.

## `player_period_stats`

Pre-aggregated:

```text
week
month
```

Contains:

```text
daily_brain_score
full_daily_count
active_days
games_played
questions_answered
xp_earned
```

This is the foundation for general Weekly / Monthly Rankings.

## `player_game_period_stats`

Pre-aggregated by:

```text
user
game
day / week / month
```

Contains:

```text
games_played
total_score
best_score
total_correct
total_questions
average_accuracy
best_daily_points
best_metric_value
```

This is specifically designed for the future Rankings filters:

```text
Individual
Friends
Groups

Global
Country

Daily
Weekly
Monthly

Game
```

## `player_personal_bests`

One current PB per user/game.

Examples:

```text
Brain Mix   → highest score
Flag Dash   → most correct
Map Hunt    → highest score
BrainiWord  → fewest attempts on a win
```

---

# Automatic recalculation

Step 6 creates a PostgreSQL trigger on:

```text
game_results
```

Every result INSERT/UPDATE calls:

```text
refresh_brainilab_player_progression(user_id)
```

This means:

```text
new game result
      ↓
daily stats refreshed
      ↓
weekly/monthly refreshed
      ↓
personal best refreshed
      ↓
XP refreshed
      ↓
streak refreshed
```

When Step 4/5 later verifies answers and updates a result, progression is recalculated again using the verified correctness.

No separate Cron is required for Step 6.

---

# Existing data backfill

The migration automatically rebuilds progression for all profiles already present.

So your existing Google user and the game results already stored in Supabase are included.

You do not need to recreate the account or replay old stored games.

---

# Run Step 6

In Supabase:

**SQL Editor → New query**

Open:

```text
BRAINILAB_STEP6_SQL_COPY_TO_SUPABASE.txt
```

Copy all → paste → Run.

Supabase may show its generic warning about creating tables without RLS at the first CREATE statements.

The SQL itself explicitly enables RLS and removes direct write access later in the same transaction, so for this prepared migration choose:

```text
Run without RLS
```

The transaction does not commit until the RLS configuration has been applied.

---

# Verify

Run:

```sql
select
  current_streak,
  best_streak,
  full_daily_count,
  xp,
  level,
  total_games,
  total_questions,
  favorite_game_id
from public.player_progression;
```

Then:

```sql
select
  stat_date,
  daily_games_completed,
  full_daily,
  brainmix_points,
  flagdash_points,
  maphunt_points,
  brainiword_points,
  daily_brain_score,
  xp_earned
from public.player_daily_stats
order by stat_date desc;
```

And:

```sql
select
  period_type,
  period_start,
  games_played,
  daily_brain_score,
  active_days,
  full_daily_count,
  xp_earned
from public.player_period_stats
order by period_start desc,period_type;
```

Personal bests:

```sql
select
  game_id,
  metric_name,
  metric_value,
  achieved_at
from public.player_personal_bests
order by game_id;
```

---

# Frontend

V20 adds:

```text
assets/js/supabase-progression.js
```

My BrainiLab now reads the PostgreSQL progression summary after sign-in.

The Profile page shows:

- Current streak
- Best streak
- Level
- XP
- Full Dailies
- Total games
- Questions answered
- Today's Daily Brain Score
- Current week Brain Score / active days / Full Dailies
- Current month Brain Score / active days / Full Dailies

The rest of the site continues reading `BrainiData`, so the UI does not need to know whether the value came from localStorage or PostgreSQL.

---

# Security / competitive integrity

Progression is now canonical in PostgreSQL, but not every game score is fully anti-cheat yet.

Current state:

```text
quiz answer correctness → server verified
Daily answer correctness → server verified
speed/timing score      → still partly client-derived
other game mechanics    → not all fully server-authoritative yet
```

Therefore future **competitive global rankings** should use the appropriate verified fields / validation rules rather than blindly trusting every historical raw score.

This does not block streaks, XP, personal progress or the social product.

---

# Why aggregate now?

Without Step 6, a Weekly Ranking could require scanning all raw game history every time somebody opens Rankings.

With Step 6 we can query small aggregate tables instead.

That is:

- faster;
- cheaper on Supabase Free;
- easier to index;
- much better for Friends and Groups.

The next logical backend step is to make **Friends** real using the profile/progression data that now exists in PostgreSQL.
