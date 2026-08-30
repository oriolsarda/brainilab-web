# BrainiLab — Step 3: Game sessions & results

Step 1: Supabase Auth ✓  
Step 2: `public.profiles` ✓  
Step 3: completed games now persist in PostgreSQL.

## What Step 3 adds

Database tables:

- `public.game_sessions`
- `public.game_results`
- `public.game_answers`

Browser adapter:

- `assets/js/supabase-games.js`

The existing game pages do not need to know how Supabase works. They continue calling:

```js
await BrainiData.api.submitGameResult(gameId, payload)
```

The data layer now:

1. saves the completed result locally first;
2. assigns a stable `clientResultId`;
3. attempts to upload it to Supabase;
4. marks it synced if successful;
5. leaves it pending if the user is a guest/offline;
6. retries pending results automatically after sign-in.

That is the first real guest → account game-data migration behavior.

---

## 1. Run the SQL

Open Supabase:

**SQL Editor → New query**

For Mac convenience, open:

`BRAINILAB_STEP3_SQL_COPY_TO_SUPABASE.txt`

Copy all of it into Supabase and click **Run**.

The same migration also exists as:

`supabase/step3_game_sessions_results.sql`

---

## 2. What the SQL creates

### `game_sessions`

One row per completed gameplay session.

Important columns:

- authenticated `user_id`
- stable browser `client_result_id`
- `game_id`
- difficulty/set where applicable
- Daily number where applicable
- started/completed timestamps

There is a unique constraint on:

```text
(user_id, client_result_id)
```

This makes retries idempotent: refreshing/retrying a pending result cannot create duplicates.

### `game_results`

Stores the compact final result:

- score
- correct answers
- total questions
- accuracy
- duration
- client percentile
- game-specific JSON payload

It also has:

```text
server_verified = false
```

for now.

This is deliberate. Until question/game validation moves server-side, the database records the result but does not claim it is cheat-proof.

Future rankings will use server-verified competitive results.

### `game_answers`

For quizzes where BrainiLab already has a boolean result array, Step 3 stores:

- answer position
- correct / incorrect

It does **not** yet store the real `question_version_id`, because questions still live in frontend packs.

When the question bank moves to PostgreSQL, this table can be connected to the real question IDs.

---

## 3. RLS / security

Authenticated browsers may SELECT only their own rows.

They cannot directly INSERT/UPDATE/DELETE game tables.

Instead, result submission goes through one controlled PostgreSQL function:

```text
submit_brainilab_game_result(...)
```

This RPC:

- derives the user from `auth.uid()`;
- rejects unauthenticated calls;
- validates basic ranges;
- caps JSON payload size;
- inserts session/result/answer rows;
- handles retries idempotently.

The browser never receives a service-role key.

---

## 4. Test while signed in

After running the SQL:

1. Serve V17 on port 8000.
2. Sign in with Google.
3. Complete the Daily Quiz or a 20-question quiz.
4. Open Supabase SQL Editor and run:

```sql
select
  gs.game_id,
  gs.completed_at,
  gr.score,
  gr.correct_answers,
  gr.total_questions,
  gr.accuracy,
  gr.server_verified
from public.game_sessions gs
join public.game_results gr
  on gr.session_id = gs.id
order by gs.completed_at desc
limit 20;
```

You should see the game you just completed.

`server_verified` should currently be `false`.

That is expected.

---

## 5. Test guest → account migration

This is the important Step 3 test.

1. Sign out.
2. Play a quiz as guest and finish it.
3. The result is stored locally with `cloudSyncStatus = pending`.
4. Sign in with Google.
5. BrainiLab automatically calls `syncPendingResults()`.
6. Check Supabase with the query above.

The guest game should now exist under your authenticated `user_id`.

If the connection fails, BrainiLab keeps the result pending and retries later.

---

## 6. Check answer-level rows

After completing a multiple-choice quiz:

```sql
select
  ga.position,
  ga.is_correct,
  gs.game_id,
  gs.completed_at
from public.game_answers ga
join public.game_sessions gs
  on gs.id = ga.session_id
order by ga.created_at desc, ga.position asc
limit 100;
```

For a 20-question topic quiz, you should see up to 20 rows.

---

## 7. Free-tier design

Step 3 already includes two protections:

- result JSON is capped at 20 KB per result;
- answer-level rows are capped at 100 positions per submitted game.

Later, if answer-level analytics becomes large, `game_answers` can have a retention/aggregation policy without losing the compact `game_results` history.

---

## 8. What is cloud-backed now

```text
AUTH
✓ Supabase user
✓ Google/email identity
✓ Session

PROFILE
✓ Display name
✓ Avatar URL
✓ Country
✓ Friend code
✓ Ranking visibility

GAME DATA
✓ Completed game sessions
✓ Final results
✓ Compact answer correctness
✓ Guest result upload after sign-in
```

Still local / mock:

```text
- authoritative streak
- XP
- Daily Brain Score aggregation
- personal-best aggregation
- questions/question options
- Daily challenge schedule
- friends
- groups
- global rankings
```

---

## Recommended next step

Step 4 should move the **question bank + topics + options** into PostgreSQL.

Once the server knows the correct answer to each real question, BrainiLab can stop trusting browser-submitted quiz scores and start calculating `server_verified = true` results.
