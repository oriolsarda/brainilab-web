# BrainiLab — Step 5: Automated Daily Brain Challenge

Step 1: Auth ✓  
Step 2: Profiles ✓  
Step 3: Game sessions/results ✓  
Step 4: Question bank ✓  
Step 5: Daily generation + verification ✓

## Daily product contract

The Daily Brain Challenge is separate from evergreen quiz packs.

```text
Evergreen topic quiz
topic + difficulty + set
20 questions

Daily Brain Challenge
date + daily number
10 questions
```

Step 5 creates a real Daily record for each UTC calendar date.

## What is created

Tables:

- `daily_generation_settings`
- `daily_challenges`
- `daily_challenge_questions`

The existing `game_sessions` table also receives:

- `daily_challenge_id`

## Initial generation

When the Step 5 migration runs it immediately creates:

- today
- the next 14 days

Today is marked:

```text
published
```

Future challenges are:

```text
ready
```

The initial real Daily number is configured as:

```text
#1 after the Step 15 official launch reset
```

This preserves the current BrainiLab prototype numbering. It can be changed later in `daily_generation_settings` before launch if desired.

## Daily composition

Every Daily contains:

```text
4 Easy
4 Medium
2 Hard
```

There are three rotating category templates so the mix changes across days.

The generator draws from:

- General Knowledge
- Geography
- Science
- History
- Sports

Geography includes both:

- World Capitals
- World Flags

## No-repeat policy

Current cooldown:

```text
14 days
```

A question used during the previous 14 Daily challenges is excluded if possible.

This value is intentionally configurable.

With the current 360-question pool, 14 days is realistic. When the question bank grows substantially we can increase this to:

```text
30 / 60 / 90 days
```

If a category/difficulty pool ever becomes too small, the generator falls back to the least-recently-used eligible question instead of failing the Daily.

## Database functions

### Generate one date

```sql
select public.generate_brainilab_daily_challenge('2026-09-20');
```

This is admin/server-only.

### Maintain schedule

```sql
select public.maintain_brainilab_daily_schedule(current_date);
```

This:

1. ensures today exists;
2. ensures the next 14 days exist;
3. publishes today;
4. leaves future dates ready.

### Browser Daily fetch

```text
get_brainilab_daily_challenge()
```

The browser can only fetch the current published Daily.

It cannot request tomorrow's challenge.

The response contains:

- Daily ID
- date
- Daily number
- 10 prompts
- option IDs
- option text

It does **not** contain correct-answer flags or explanations.

## Answer checking

Individual answers continue to use:

```text
check_brainilab_quiz_answer(...)
```

The correct answer and explanation are returned only after the player responds.

## Daily result verification

After the game result has been written by Step 3, BrainiLab calls:

```text
verify_brainilab_daily_result(...)
```

PostgreSQL verifies all 10 selected option IDs against the exact Daily Challenge.

It then stores:

```text
answers_verified = true
verified_correct_answers
verified_total_questions = 10
verified_accuracy
answers_verified_at
```

The session is also linked to:

```text
daily_challenge_id
daily_number
```

Full score remains:

```text
server_verified = false
```

because speed/timing points are still client-side.

## Guest → account behavior

Guest:

```text
plays Daily
↓
result + answer IDs saved locally
↓
cloud sync pending
```

Later signs in:

```text
Step 3 uploads result
↓
Step 5 verifies the 10 answers
↓
Daily session linked to authenticated user
```

The Daily is therefore compatible with the guest-first strategy.

---

# Enable the automatic Cron job

The main migration generates the initial 15-day window, but we also need one recurring job.

In Supabase Dashboard enable the **Cron** integration / `pg_cron`.

Then run:

`BRAINILAB_STEP5_CRON_SQL.txt`

It schedules:

```text
brainilab-daily-maintenance
```

at:

```text
00:05 UTC every day
```

Command:

```sql
select public.maintain_brainilab_daily_schedule(current_date);
```

Because the function always maintains 14 days ahead, BrainiLab does not generate the Daily at the moment a player opens the page.

The next two weeks are already prepared.

## Verify Cron

```sql
select
  jobid,
  jobname,
  schedule,
  command,
  active
from cron.job
where jobname='brainilab-daily-maintenance';
```

---

# Verify the Daily schedule

After the main SQL:

```sql
select
  challenge_date,
  daily_number,
  status
from public.daily_challenges
order by challenge_date;
```

You should see 15 rows.

Then:

```sql
select
  dc.challenge_date,
  dc.daily_number,
  count(dcq.question_version_id) as questions
from public.daily_challenges dc
join public.daily_challenge_questions dcq
  on dcq.daily_challenge_id = dc.id
group by dc.id,dc.challenge_date,dc.daily_number
order by dc.challenge_date;
```

Every row must show:

```text
questions = 10
```

---

# Frontend changes

Both:

- Home Daily Brain Challenge
- `/daily-quiz/`

now load the same Daily from PostgreSQL.

This prevents Home and the Daily page from accidentally showing different questions.

The old hardcoded Ottawa/Mars/etc. Daily has been removed from those page sources.

The Home result also now stays inside the existing challenge box rather than opening a popup.

On `/daily-quiz/`, explanations remain hidden until all 10 questions are complete.

---

# Production timezone

Current Daily rollover uses:

```text
UTC
```

That is deliberate because one global Daily needs one unambiguous boundary.

If BrainiLab later wants a local-midnight Daily by region, that is a product change rather than a database limitation.

---

# Next backend step

Now that Daily content itself is automated, the next logical backend layer is:

**player progression aggregation**

- authoritative Daily completion
- streaks
- personal bests
- Daily Brain Score
- daily / weekly / monthly player aggregates

Those aggregates are also the foundation for Friends and Group rankings.
