# BrainiLab — Step 4: Question bank, topics & quiz packs

Step 1: Supabase Auth ✓  
Step 2: Profiles ✓  
Step 3: Game sessions/results ✓  
Step 4: Questions move from frontend data into PostgreSQL.

## What this step creates

PostgreSQL tables:

- `topics`
- `questions`
- `question_versions`
- `question_options`
- `tags`
- `question_tags`
- `quiz_packs`
- `quiz_pack_questions`

It also imports the **360 existing BrainiLab questions**:

- 6 quiz families
- 3 difficulties each
- 20 questions per pack
- 18 published packs
- 1,440 answer options

## Run the SQL

In Supabase:

1. Open **SQL Editor → New query**.
2. Open:
   `BRAINILAB_STEP4_SQL_COPY_TO_SUPABASE.txt`
3. Copy everything.
4. Paste it into Supabase.
5. Click **Run**.

The same migration is also stored as:

`supabase/step4_question_bank.sql`

## Expected counts

After the migration, run:

```sql
select count(*) as questions from public.questions;
select count(*) as versions from public.question_versions;
select count(*) as options from public.question_options;
select count(*) as packs from public.quiz_packs where status='published';
```

Expected:

```text
questions = 360
versions  = 360
options   = 1440
packs     = 18
```

Check pack integrity:

```sql
select
  qp.title,
  count(qpq.question_version_id) as questions
from public.quiz_packs qp
join public.quiz_pack_questions qpq
  on qpq.quiz_pack_id=qp.id
where qp.status='published'
group by qp.id,qp.title
order by qp.title;
```

Every published pack should show exactly `20`.

---

# Security model

The browser does **not** receive direct `SELECT` access to the content tables.

A playable pack is obtained through:

```text
get_brainilab_quiz_pack(topic,difficulty,set)
```

That RPC returns:

```json
{
  "pack_id": "...",
  "difficulty": "medium",
  "set_number": 1,
  "questions": [
    {
      "question_version_id": "...",
      "prompt": "What is the capital of Canada?",
      "options": [
        {"id":"...","text":"Toronto"},
        {"id":"...","text":"Ottawa"},
        {"id":"...","text":"Vancouver"},
        {"id":"...","text":"Montreal"}
      ]
    }
  ]
}
```

Notice what is missing:

```text
is_correct
correct_answer
explanation
```

Those are not shipped in the initial quiz payload.

When a player chooses an answer, the frontend calls:

```text
check_brainilab_quiz_answer(...)
```

Supabase then returns the result for that answered question:

- correct / incorrect
- correct answer
- explanation

That preserves the current immediate-feedback UX without publishing all answers up front.

---

# Explanations and answer guides

The six evergreen topic quiz pages no longer render their answer guides before gameplay.

Correct answers/explanations appear only after the player completes all 20 questions.

The Quiz JSON-LD also no longer embeds `acceptedAnswer` values.

This is important because hiding answers only with CSS would still expose them in the page source.

---

# Question versions

BrainiLab separates:

```text
questions
        │
        ├── version 1
        ├── version 2
        └── version 3
```

A quiz pack points to a specific `question_version_id`.

If a question explanation or wording changes later, historical packs/results can still refer to the exact version that was played.

Do not overwrite historical meaning by editing old published versions in production; create a new version.

---

# Classification

Topics are hierarchical.

Initial structure:

```text
General Knowledge
Science
History
Sports
Geography
   ├── World Capitals
   └── World Flags
```

Each question version has:

- one `primary_topic_id`
- one editorial difficulty:
  - easy
  - medium
  - hard

`tags` + `question_tags` are already prepared for richer classification later:

```text
canada
north-america
capital-city
astronomy
world-war-ii
football
```

---

# 20-question pack rule

A BrainiLab evergreen quiz pack is exactly:

```text
topic
+
difficulty
+
set number
+
version
+
20 question versions
```

Example:

```text
Science
Medium
Set 1
Version 1
20 questions
```

A database trigger prevents a pack being changed from draft/review to `published` unless it contains exactly 20 questions.

---

# Initial import file

The package also includes:

`content/questions_seed_v1.json`

This is the normalized machine-readable representation of the same 360 questions.

It is useful as the starting point for the future automated content pipeline.

See:

`CONTENT_IMPORT_SCHEMA.md`

---

# Server answer verification

Step 4 adds:

```text
verify_brainilab_quiz_result(...)
```

After Step 3 saves the game result, BrainiLab submits the 20 selected option IDs.

PostgreSQL recalculates:

- verified correct answers
- verified total
- verified accuracy

and stores:

```text
answers_verified = true
```

`server_verified` remains `false` for the overall score for now, because the current points formula still includes client-side timing.

So the distinction becomes:

```text
answers_verified = true
    Correctness checked by PostgreSQL.

server_verified = false
    Full competitive score/timing not yet fully server-authoritative.
```

That is intentional and avoids claiming stronger anti-cheat protection than we actually have.

---

# Guest flow

A guest can still play.

If the question-bank SQL is available:

- questions come from Supabase;
- answers are checked via Supabase;
- the completed result stays pending locally.

After Google/email sign-in:

1. Step 3 uploads the pending result.
2. Step 4 uploads the 20 answer IDs.
3. PostgreSQL verifies correctness.
4. The local result becomes `answerVerificationStatus = verified`.

---

# Local fallback

If Step 4 has not been installed yet or Supabase content is temporarily unavailable, BrainiLab lazy-loads the existing local quiz packs.

This prevents the site from becoming unusable during development.

The fallback is not considered server-verified content.

---

# What is cloud-backed after Step 4

```text
AUTH
✓ Users
✓ Google/email
✓ Sessions

PROFILE
✓ Display name
✓ Country
✓ Friend code

GAME DATA
✓ Sessions
✓ Results
✓ Guest result migration
✓ Answer correctness history

CONTENT
✓ Topics
✓ Questions
✓ Question versions
✓ Options
✓ Difficulty
✓ 20-question packs
✓ 360 initial questions
✓ Answer checking via PostgreSQL
✓ Server-verified correctness
```

Still to build:

```text
- automated Daily Quiz generation
- question admin/backoffice
- automated question-generation/import pipeline
- server-authoritative timing/score
- streak aggregation
- personal best aggregation
- friends
- groups
- rankings
```

The logical next backend step is **Daily Quiz scheduling/generation**, now that the database has a real question pool to select from.
