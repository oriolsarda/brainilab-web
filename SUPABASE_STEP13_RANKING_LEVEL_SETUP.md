# BrainiLab — Step 13: Ranking Level Payload for V27

Run after Step 12.

V27's Brain Rank is derived from the existing canonical `player_progression.level`.

Most V27 progression UI works from the player's own progression data without a database migration.

Step 13 only extends the existing:
- Individual Ranking RPC
- Friends Ranking RPC

so ranking rows also receive:

```text
level
```

No new table is created.

No email, auth-provider metadata or private profile field is added to public ranking payloads.

## Install

Supabase:

```text
SQL Editor
→ New query
```

Run:

```text
BRAINILAB_STEP13_SQL_COPY_TO_SUPABASE.txt
```

No new Cron is required.

## Verify

```sql
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'get_my_brainilab_friends_ranking',
    'get_brainilab_individual_rankings'
  )
order by routine_name;
```

Expected:

```text
get_brainilab_individual_rankings
get_my_brainilab_friends_ranking
```

The function signatures are unchanged, so their existing execute grants remain in force after `CREATE OR REPLACE FUNCTION`.

## Level source

Canonical level remains Step 6 / Step 12 progression:

```text
level = floor(sqrt(xp / 20)) + 1
```

V27 simply maps that level to a presentation tier.

There is no second level system and no extra XP source.
