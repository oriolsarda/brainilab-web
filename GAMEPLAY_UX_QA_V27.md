# BrainiLab V27 — Gameplay, Navigation & Retention QA

## Product rule: three different score concepts

BrainiLab now labels these separately:

### Quiz Points
Score earned inside an evergreen / category quiz.

Used for:
- personal bests
- game-specific ranking periods

It is **not** part of the 10,000-point Daily Brain Score.

### XP
Every completed game earns:

```text
50 XP
+ 5 XP per correct answer
(maximum +250 correctness XP)
```

Completing all four Daily Games adds:

```text
+250 XP Full Daily bonus
```

XP determines the canonical BrainiLab level.

### Daily Brain Score
Only today's four Daily Games contribute:

```text
Brain Mix
Flag Dash
Topic Rush
BrainiWord
```

Maximum:

```text
2,500 per game
10,000 total
```

## Navigation

Primary navigation is intentionally:

```text
Games
Daily Quiz
Rankings
Groups
About
```

`Categories` remains an indexable discovery URL, but it is no longer a primary-navigation step.

## Games

`/games/` means:

```text
Play anytime
```

It contains replayable evergreen quizzes only.

Each card directly exposes:

```text
Easy
Medium
Hard
```

The card also says:

```text
Not played yet
```

or:

```text
✓ Played
Best ...
```

This prevents a user from mistaking a completed one-shot Daily Game for a replayable game.

## Historical Dailies

V27 does **not** expose previous Daily Games as normal Games yet.

Reason:

Current Daily results affect:
- Daily Brain Score
- Daily completion
- progression
- streak calculations

A previous Daily must therefore be introduced as a dedicated **Practice Archive** where replay results cannot rewrite historical competitive Daily state.

Showing old Daily links before defining that server-side practice mode would create ambiguous scoring and potentially retroactive progress changes.

## Daily Quiz

`/daily-quiz/` is now a Daily Hub.

It never automatically starts Brain Mix.

It shows all four Daily Games together with:
- Daily number
- `x / 4` completed
- Daily Brain Score
- streak
- each game's `x / 2,500` when completed
- `Play now` when pending
- clear pending glow
- Full Daily completion
- +250 XP Full Daily bonus explanation

Brain Mix remains available directly from Home and its dedicated route:

```text
/games/brain-mix/
```

## Daily completion

Every Daily result screen now provides:
1. result
2. primary continuation CTA
3. Share result
4. See my progress
5. visual four-game Daily Journey

If Daily is incomplete, the primary action is:

```text
Continue Daily
```

If all four are complete:

```text
Play an anytime quiz
```

## Evergreen quiz completion

Category quiz result modals were removed.

After question 20:
- the play stage is replaced in-place
- the result stays visible
- no close button can strand the player on the last question
- primary CTA returns to the same quiz topic
- Share result opens the existing dismissible share dialog
- `See my progress` links to XP / Brain Rank / results

The final question button says:

```text
See result
```

instead of:

```text
Next question
```

## Topic Rush

The topic is secret until the user explicitly clicks:

```text
Reveal topic & start
```

Sequence:

```text
generic ready screen
↓
user clicks start
↓
fetch today's Topic Rush
↓
topic arrives
↓
60-second timer starts
↓
topic + prompt become visible
```

Network latency therefore cannot consume the player's 60 seconds.

## My BrainiLab

Clicking the header avatar opens a menu:

```text
My Progress
Edit Profile
Groups & Friends
Account & Security
Sign out
```

Guest sessions get:

```text
Save my progress
```

`My BrainiLab` uses the same four sections.

### My Progress
- Brain Rank
- level
- XP
- progress toward next Brain Rank
- current / best streak
- Full Dailies
- results
- Daily / weekly / monthly Brain Score
- strengths
- rankings CTA

### Edit Profile
- display identity
- country
- public ranking identity / privacy
- provider profile photo when available

Custom image uploads are intentionally not introduced in V27; this avoids adding an unnecessary Storage upload surface until avatar lifecycle/moderation is specified.

### Groups & Friends
Uses the existing real Friends and Groups backend.

### Account & Security
- sign-in provider
- account email for the owner only
- password reset when using email authentication
- ranking privacy context
- sign out

Google-provider passwords remain managed by Google rather than BrainiLab.

## Brain Ranks

Brain Ranks are visual labels derived from the existing canonical level; they do not create a second progression currency.

```text
Lv 1–4    Rookie
Lv 5–9    Elementary
Lv 10–14  High School
Lv 15–19  College
Lv 20–24  Graduate
Lv 25–29  PhD
Lv 30–39  Researcher
Lv 40–49  Professor
Lv 50–59  Dean
Lv 60+    Nobel Mind
```

`Nobel Mind` deliberately avoids claiming that the user has received a real Nobel Prize.

The ring becomes visually more premium as rank increases.

Displayed:
- top-right profile avatar
- My Progress
- Individual Rankings
- Friends Rankings

Group Rankings continue to display the group crest because the ranked entity is the group.

## Accessibility / continuation

V27 also:
- adds visible keyboard focus states to important gameplay controls
- keeps Share Result dismissible using its existing close button / outside-click / Escape behavior
- adapts layouts for mobile
- keeps a visible next step after every completed quiz
- changes evergreen `Speed bonus enabled` wording to `Quiz Points · speed bonus`

## Regression checks

Before publishing, manually test:
1. Home → Brain Mix.
2. Daily Quiz → each of 4 cards.
3. Complete one Daily → Daily Journey shows one ✓ and 3 pending.
4. Complete all four → Full Daily and anytime CTA.
5. Topic Rush → topic is invisible until Start.
6. Every evergreen difficulty → question 20 → See result → inline result.
7. Play another topic quiz.
8. Share result → close button / outside click / Escape.
9. Games cards → played/best context.
10. Categories → Easy/Medium/Hard directly.
11. Avatar → menu → all four profile sections.
12. Rankings → Brain Rank ring.
13. Mobile viewport.
