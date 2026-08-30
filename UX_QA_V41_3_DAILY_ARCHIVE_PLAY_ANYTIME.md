# UX / QA — V41.3 Past Daily Play Anytime

## Scope

- Removed the explanatory Quiz Points / XP / Daily Brain Score card from the bottom of Games.
- Preserved the V41.2.3 clearer Science flask icon.
- Added a Past Daily archive to Games with a date picker and four replayable game cards.
- Past Daily routes use `?archive=YYYY-MM-DD`.
- Added Supabase Step 21 date-addressable archive RPCs.
- Past Daily results are local-only practice and are excluded from pending cloud / Daily verification queues.
- Evergreen category quiz results now offer both **Play another [category] quiz** and **Choose another category**.

## Archive routes

```text
/games/brain-mix/?archive=YYYY-MM-DD
/games/order-up/?archive=YYYY-MM-DD
/games/topic-rush/?archive=YYYY-MM-DD
/games/brainiword/?archive=YYYY-MM-DD
```

Dates start at the official Daily #1 (`2026-08-29`) and stop at yesterday (UTC).

## Static QA completed

- All 57 JavaScript source/bundle files pass `node --check`.
- All 20 inline non-JSON scripts pass `node --check`.
- HTML local `src` / `href` asset scan reports 0 missing files.
- Archive SQL migration and copy-to-Supabase file are included.
- V41.3.0 cache-busting/build identity applied to runtime assets.

## Manual browser QA still recommended

1. Games → Past Daily defaults to yesterday and changes all four links when the date changes.
2. Brain Mix archive loads exact historical cloud content after Step 21; local fallback remains playable if Supabase is unavailable.
3. Order Up historical rounds can be checked and replayed repeatedly.
4. Topic Rush historical answers are accepted against that historical topic.
5. BrainiWord historical guesses are checked against that historical word and a finished archive can be replayed again.
6. Completing any archive game does not change today's 4/4 Daily state, Daily Brain Score or streak.
7. Evergreen quiz result buttons return to the same category anchor or the Games page.
8. Mobile: archive date control and four archive cards stack to one column.

Chromium headless remained unreliable in this environment, so no browser-render claim is made here.
