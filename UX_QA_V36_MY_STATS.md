# BrainiLab V36 — My Stats QA

## Navigation

Open:

```text
My BrainiLab
```

Tabs should be:

```text
My Progress
My Stats
Edit Profile
Groups & Friends
Account & Security
```

`My Progress` should no longer contain the old duplicate `Your strengths` block.

It should have:

```text
Explore My Stats →
```

## Logged-out state

Open My Stats while signed out.

Expected:

```text
Build your personal performance history
Log in
```

No demo statistics should be shown in My Stats.

## Logged-in state

Open My Stats while signed in.

Expected range controls:

```text
7 days
30 days
3 months
All time
```

Default:

```text
30 days
```

## Summary

Expected cards:

```text
Games played
Quiz answers
Quiz accuracy
Strongest category
```

`Strongest category` must remain `Building…` until at least one category has 20 answers.

## Performance chart

Filters:

```text
All quizzes
Brain Mix
Order Up
Topic Rush
BrainiWord
Anytime quizzes
```

Metrics:

```text
All quizzes      accuracy
Brain Mix        accuracy
Order Up         order accuracy
Topic Rush       answers found
BrainiWord       attempts — lower is better
Anytime quizzes  accuracy
```

No fake line should appear when there is no data.

## Knowledge profile

Only real replayable categories with data should appear.

Currently supported:

```text
General Knowledge
Geography
Science
History
Sports
```

Each row should show:

```text
accuracy
number of answers
```

Below 20 answers:

```text
building sample
```

## Difficulty

Expected:

```text
Easy
Medium
Hard
```

Each should display only real stored results.

## Daily performance

Expected:

```text
Daily Brain Score chart
Average
Best Daily
Full Dailies
Current streak
Best streak
```

## Daily-game analytics

Expected cards:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Check the metric labels are mechanic-specific.

## Insights

Insights must be deterministic and based only on actual sample sizes.

Examples:

```text
You’re improving
Your strongest category
Ready for Medium
Hard mode is waiting
Daily consistency
```

Do not display improvement comparisons when either current or previous period has fewer than 20 quiz answers.

## Recent activity

Expected private list:

```text
date
game
difficulty / Daily number
result
```

No raw answers or email.

## Live refresh

Keep My Stats open.

Play/sync another result.

Return to My Stats.

Expected:

```text
new result included
analytics refreshed
```

## Privacy

With two test users:

```text
Account A
Account B
```

Each My Stats view must show only its own history.

There is no browser RPC parameter for choosing another user's UUID.

## Responsive

Test:

```text
desktop
tablet
mobile
```

Charts may scroll horizontally on a narrow screen but should not overflow the page.

Summary cards and game cards should collapse cleanly.
