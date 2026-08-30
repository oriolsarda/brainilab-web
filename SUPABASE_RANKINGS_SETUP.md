# BrainiLab — Step 10: Final Rankings

Steps 1–9 ✓  
Step 10 closes the ranking layer.

## Final product structure

```text
Individual | Friends | Groups

Global / My country
Daily / Weekly / Monthly
Score / Streak
All games / specific game
```

Display:

```text
Top 3 podium
Top 10 highlighted
See more → Top 100
Own position if <= #1000
—
Ranking available from #1000
```

## Individual Rankings are real and opt-in

Individual public rankings now use:

```text
get_brainilab_individual_rankings(...)
```

Only profiles where:

```text
leaderboard_enabled = true
```

are candidates.

The public RPC returns only:

```text
leaderboard display name
country
avatar initial
ranking score
rank
streak
```

It does **not** return:

```text
email
friend code
Google/Auth metadata
private profile display name
internal user UUID
```

A guest can browse Global Individual rankings without an account.

A signed-in user remains private until they explicitly choose:

```text
Join rankings
```

The chosen public ranking name can differ from the private BrainiLab display name.

## Country rankings

For Individual:

```text
My country
```

uses the country stored in the signed-in BrainiLab profile.

If a country has not been configured, the UI asks the user to update My BrainiLab.

Guests may browse Global rankings but need a signed-in country profile for My country.

For Groups, Country ranking continues to use the eligible group's own country.

Friends are already a private subset, so the Region filter is disabled there.

## Ranking Score semantics

The final score semantics are intentionally consistent.

### All games

```text
Daily   -> Daily Brain Score
Weekly  -> sum of Daily Brain Scores this week
Monthly -> sum of Daily Brain Scores this month
```

### Daily games

For:

```text
Brain Mix
Flag Dash
Map Hunt
BrainiWord
```

the ranking uses each game's normalized Daily contribution:

```text
0–2,500 per UTC day
```

Weekly / Monthly is the sum of those normalized daily contributions.

This is important because it prevents raw scores from different mechanics being compared incorrectly and avoids rewarding repeated frontend replays.

### Evergreen games

For quizzes such as:

```text
World Flags
World Capitals
Science
History
Sports
```

the selected-period ranking uses accumulated game score from:

```text
player_game_period_stats
```

### Streak

Streak means:

```text
current Daily streak
```

When Streak is selected, Game and Period are disabled because they do not change the definition of current streak.

## Friends Rankings

Step 10 replaces the Step 8 Friends ranking RPC with the final scoring semantics.

Friends still do not require public leaderboard opt-in.

Accepted friends can compare each other privately using the friend graph.

Daily games now use the same normalized 0–2,500/day scoring used by Individual and Daily Brain Score.

## Group Rankings

Groups retain the Step 9 rule:

```text
minimum 3 members
maximum 5 members
Group Score = top 3 member scores
```

Step 10 normalizes per-game Group Rankings.

For Daily Games, each member contributes the selected game's normalized Daily points.

For evergreen games, the member contributes accumulated game score.

The top three member values are then summed.

Example:

```text
Member A  6,800 weekly Flag Dash points
Member B  6,100
Member C  5,900
Member D  4,000
Member E  3,200

Group Flag Dash = 18,800
                  top 3
```

Existing Step 9 all-game Daily / Weekly / Monthly Group Brain Score remains unchanged.

## Automatic updates

No Cron is needed.

The existing flow remains:

```text
game result
↓
Step 6 player progression
↓
Step 9/10 group aggregates
↓
Rankings query current aggregates
```

Individual and Friends rankings read the player aggregates directly.

Group per-game aggregate rows are refreshed whenever:

```text
a member result changes
membership changes
```

The migration also backfills current groups.

## Rankings privacy controls

My BrainiLab still contains:

```text
Rankings visibility
Private by default
Join rankings / Leave rankings
```

The Rankings page now also exposes the same action contextually:

```text
Your ranking profile is private
Join rankings
```

or:

```text
Public as <ranking name>
Hide ranking profile
```

The UI explicitly states that email is never shown.

## Early-stage empty rankings

The production frontend no longer needs to invent players when the Supabase ranking backend is configured.

If only one real user has opted in, that is what the ranking shows.

If nobody has an eligible score:

```text
No ranked scores here yet
```

This is preferable to fake activity.

The old deterministic ranking data remains only as a local fallback when Supabase is deliberately not configured.

## Own-rank rule

If a player/group is not visible in the loaded Top 100:

```text
rank <= 1000
-> show exact own rank

rank > 1000
-> show:
   —
   Ranking available from #1000
```

Friends do not need this rule because the entire accepted-friend list is small.

## SQL installation

Supabase:

```text
SQL Editor → New query
```

Run:

```text
BRAINILAB_STEP10_SQL_COPY_TO_SUPABASE.txt
```

Step 10 adds no new public data tables. It creates/replaces controlled ranking functions and performance indexes.

## Verify installation

```sql
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'get_brainilab_individual_rankings',
    'get_my_brainilab_friends_ranking',
    'get_brainilab_group_rankings'
  )
order by routine_name;
```

Expected:

```text
get_brainilab_group_rankings
get_brainilab_individual_rankings
get_my_brainilab_friends_ranking
```

Check how many profiles have explicitly joined public rankings:

```sql
select count(*) as public_ranking_profiles
from public.profiles
where leaderboard_enabled=true;
```

## First real test

With one signed-in account:

1. Open `My BrainiLab`.
2. Set a country if none exists.
3. Under Rankings visibility click `Join rankings`.
4. Choose the public ranking name.
5. Complete a Daily Game.
6. Open `Rankings`.
7. Check:
   - Individual / Global
   - Individual / My country
   - Daily / All games
   - Daily / selected Daily game
   - Score / Streak

With two friend accounts, test Friends.

With an eligible 3-member group, test Groups.

## Competitive integrity note

Step 10 makes ranking data real, private-by-default and internally consistent.

It does **not** yet claim prize-grade anti-cheat integrity.

The current backend verifies much of the Daily content and answers, but some game timing / interaction remains client-originated and not fully server-authoritative.

This is suitable for ordinary social rankings and product launch.

Before cash prizes, high-value rewards or adversarial competition, add a dedicated server-authoritative competitive-session layer.
