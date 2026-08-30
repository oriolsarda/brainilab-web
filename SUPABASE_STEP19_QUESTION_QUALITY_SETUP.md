# BrainiLab — Step 19: Question Quality

Run after Step 18.

This step turns the existing verified question-answer events into a practical editorial quality layer for the Backoffice.

## What it analyses

Per published question version:

- verified attempts
- correct-answer rate
- skip rate
- average response time
- answer-option distribution
- weak distractors
- expected vs observed difficulty

## Quality states

### Building sample

Fewer than:

```text
30 verified attempts
```

No difficulty recommendation is trusted yet.

### High skip rate

At least:

```text
20% skipped
```

This is a wording/content review signal, not an automatic ambiguity diagnosis.

### Too easy / too hard

The quality service compares observed accuracy with deliberately wide bands for the question's editorial difficulty.

No question is changed automatically.

### Weak distractors

Starts only after:

```text
50 verified attempts
```

A wrong option is considered weak when it attracts roughly 3% or fewer selections. The Backoffice flags the question when at least two distractors are weak.

## Backoffice

Question Bank now has:

```text
Question Quality
```

The review dashboard shows:

- Healthy
- Needs review
- Building sample
- Too easy
- Too hard
- Weak distractors

Opening one question shows:

- attempts
- accuracy
- skip rate
- average response time
- difficulty signal
- option-selection rates
- weak distractor badges

## Subcategory tags

The question editor now suggests reusable taxonomy tags by topic.

Examples:

```text
History
  ancient-history
  medieval-history
  early-modern
  modern-history
  wars
  leaders
  inventions
  empires
```

These still use the existing BrainiLab `tags` / `question_tags` model. No duplicate taxonomy table was introduced.

The goal is to make future:

- My Stats subcategories
- recommendations
- smarter pack generation
- content-gap analysis

possible without changing the public category navigation now.

## Security

All Question Quality RPCs require the existing BrainiLab Admin authorization.

No player-facing table grants are added.

## Install

Supabase:

```text
SQL Editor
→ New query
```

Run:

```text
BRAINILAB_STEP19_SQL_COPY_TO_SUPABASE.txt
```

No Cron.

## Verify

```sql
select to_regprocedure(
  'public.admin_question_quality_overview(text,text,integer,integer)'
) as question_quality;
```

and:

```sql
select to_regprocedure(
  'public.admin_question_analytics(uuid)'
) as question_analytics;
```

Both should be non-null.
