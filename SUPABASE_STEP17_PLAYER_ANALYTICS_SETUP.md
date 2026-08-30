# BrainiLab — Step 17: Player Analytics + My Stats

Run after Step 16.

This step adds the private analytics backend used by:

```text
My BrainiLab
→ My Stats
```

## Product split

`My Progress` remains gamification:

```text
Brain Rank
Level
XP
streaks
Daily progress
recent results
rankings
```

`My Stats` is performance analysis:

```text
games played
quiz answers
quiz accuracy
knowledge profile
difficulty breakdown
performance trends
Daily Brain Score history
per-game analytics
personal insights
recent private activity
```

## Privacy

Detailed My Stats data is private.

The browser does not receive an arbitrary user ID parameter.

The RPC resolves:

```text
auth.uid()
```

internally and returns only that user's statistics.

Direct browser access to:

```text
player_analytics_daily
```

is revoked.

My Stats does not expose:

```text
email
raw answers
selected option IDs
question answer payloads
another user's detailed statistics
```

Public Rankings continue to use their separate privacy/opt-in contract.

## Aggregate table

Step 17 adds:

```text
player_analytics_daily
```

One row is stored per:

```text
user
UTC date
game
difficulty
```

It contains compact aggregates:

```text
games played
total / best score
correct answers
quiz questions answered
weighted accuracy
duration
BrainiWord wins / attempts
Order Up ordered-pair metrics
```

This avoids sending thousands of raw results to the browser every time My Stats opens.

## Refresh model

A PostgreSQL trigger runs after:

```text
game_results INSERT
game_results UPDATE
```

Therefore analytics are refreshed after:

```text
new synced result
server answer verification
Daily-game verification
```

Trigger:

```text
zz_game_results_refresh_analytics
```

No new Cron is required.

## Verification preference

When available, Step 17 uses:

```text
verified_correct_answers
verified_total_questions
```

before the original result fields.

Private personal analytics may still include synced result values for mechanics that do not have a question-level verification model.

This does not change public Rankings trust rules.

## Knowledge profile

Category analytics currently use replayable category quizzes:

```text
General Knowledge
Geography
Science
History
Sports
```

Mixed Daily mechanics are not pretended to be single-topic knowledge categories.

A category needs:

```text
20 answers
```

before My Stats labels it as a real strength.

This prevents misleading claims such as:

```text
100% Science
```

after only one or two questions.

## Difficulty

Difficulty analytics use:

```text
Easy
Medium
Hard
```

from replayable quizzes with a stored difficulty.

## Game-specific analytics

Brain Mix:

```text
average accuracy
average score
all-time personal best
```

Order Up:

```text
pair-order accuracy
exact positions
all-time personal best
```

Topic Rush:

```text
answers per round
target completion
all-time personal best
```

BrainiWord:

```text
win rate
average attempts
all-time personal best
```

## Time ranges

My Stats supports:

```text
7 days
30 days
3 months
All time
```

For finite ranges the backend also calculates the previous equivalent period.

The frontend uses that only for deterministic personal insights such as:

```text
Your accuracy improved versus the previous 30 days.
```

No generative AI inference is required for these claims.

## RPC

Authenticated browser call:

```text
get_my_brainilab_stats(p_days)
```

Allowed frontend ranges:

```text
7
30
90
0 = all time
```

The RPC returns:

```text
summary
previous_summary
categories
difficulties
games
series
daily_series
daily_summary
recent_results
```

## Install

Supabase:

```text
SQL Editor
→ New query
```

Run:

```text
BRAINILAB_STEP17_SQL_COPY_TO_SUPABASE.txt
```

No Cron.

## Verify

Table:

```sql
select to_regclass(
  'public.player_analytics_daily'
) as player_analytics_daily;
```

Expected:

```text
public.player_analytics_daily
```

RPC:

```sql
select to_regprocedure(
  'public.get_my_brainilab_stats(integer)'
) as my_stats_rpc;
```

Expected:

```text
public.get_my_brainilab_stats(integer)
```

Trigger:

```sql
select trigger_name
from information_schema.triggers
where trigger_name='zz_game_results_refresh_analytics';
```

Expected one row.

## Browser test

After running Step 17:

```text
My BrainiLab
→ My Stats
```

Test all four ranges.

Then play a new synced game and return to My Stats.

The new result should appear without manually rebuilding analytics.
