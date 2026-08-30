# BrainiLab V38 — Product Depth QA

## Main navigation

Expected visible navigation:

```text
Games
Daily
Rankings
Groups
About
```

The URL remains:

```text
/daily-quiz/
```

for compatibility/SEO. Only the product label changes to `Daily`.

## Completed Daily

Complete all four Daily Games.

Home and Daily should show:

```text
You're caught up for today!
Next Daily
HH:MM:SS
UTC
```

Countdown must roll toward the next 00:00 UTC.

## Brain Rank milestone

A normal page load must not show a fake rank celebration.

After genuinely crossing from one Brain Rank tier to the next, show one compact message:

```text
NEW BRAIN RANK UNLOCKED
<Rank name>
Level <n>
```

It should:

- not block the game
- have a close button
- disappear automatically
- not reappear on every page load

## Question Quality

Backoffice:

```text
Question Bank
→ Question Quality
```

Expected summary:

```text
Healthy
Needs review
Building sample
Too easy
Too hard
Weak distractors
```

Only verified question-level events should power these metrics.

## Individual question analytics

Open a published question with analytics.

Expected:

```text
Quality
Attempts
Accuracy
Skip rate
Avg response
Difficulty signal
Option distribution
```

Weak distractors should only be evaluated after 50 attempts.

Difficulty calibration should only begin after 30 attempts.

## Taxonomy

Create/edit a draft question.

Under:

```text
Subcategory tags
```

topic-aware chips should appear.

Clicking a chip toggles it in the comma-separated tag field.

Published immutable versions remain read-only.

## Service Worker

Default V38 behavior:

```text
BRAINI_ENABLE_SW = false
```

No Service Worker should register on a normal launch unless production explicitly opts in.

Localhost remains Service-Worker-free.

## Existing gameplay

Regression test:

- Brain Mix
- Order Up
- Topic Rush
- BrainiWord
- category quizzes
- My Stats
- Rankings
- Groups
- account menu

No scoring or ranking formula changes are part of Step 19.
