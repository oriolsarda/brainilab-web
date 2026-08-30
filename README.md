# BrainiLab static site prototype

Entry point: `index.html`

Official profiles:
- YouTube: https://www.youtube.com/@BrainiLab
- Instagram: https://www.instagram.com/brainilab/

Structured data:
- Home: Organization + WebSite + WebPage, with Organization.sameAs for YouTube/Instagram.
- About: Organization + WebSite + AboutPage + BreadcrumbList.
- Hubs: CollectionPage + ItemList + BreadcrumbList.
- Quiz leaf pages: WebPage + Quiz + visible Question/Answer content + BreadcrumbList.
- Game mechanic pages: WebPage + Game + BreadcrumbList.
- VideoObject is intentionally not emitted until a page embeds a specific BrainiLab video with real title, thumbnail, upload date and duration.

Before production:
1. Replace `https://brainilabgames.com` if the final domain differs.
2. Serve pretty URLs so `/geography/` maps to `/geography/index.html`.
3. Validate deployed URLs in Google Rich Results Test and Schema.org Validator.
4. Add real source URLs and last-verified timestamps to the quiz CMS/database.
5. Add VideoObject only when a specific matching BrainiLab YouTube video is embedded.


## Backend Step 1 — Authentication

See `SUPABASE_AUTH_SETUP.md` for the Supabase + Google + email/password setup.


## Backend Step 2 — Profiles

Run `supabase/step2_profiles.sql` in Supabase SQL Editor, then see `SUPABASE_PROFILES_SETUP.md`.


## Backend Step 3 — Game sessions & results

Run `BRAINILAB_STEP3_SQL_COPY_TO_SUPABASE.txt` in Supabase SQL Editor, then see `SUPABASE_GAME_RESULTS_SETUP.md`.


## Backend Step 4 — Question bank

Run `BRAINILAB_STEP4_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_QUESTION_BANK_SETUP.md` and `CONTENT_IMPORT_SCHEMA.md`.


## Backend Step 5 — Automated Daily

Run `BRAINILAB_STEP5_SQL_COPY_TO_SUPABASE.txt`, enable Supabase Cron, then run `BRAINILAB_STEP5_CRON_SQL.txt`. See `SUPABASE_DAILY_SETUP.md`.


## Backend Step 6 — Player progression

Run `BRAINILAB_STEP6_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_PROGRESSION_SETUP.md`.


## V20.2 — Daily result rendering fix

Fixed a collision where the Daily challenge root used `data-daily-number`, the same attribute used by UI text hydration. A post-game data refresh could therefore replace the entire challenge DOM with the Daily number. The root now uses `data-challenge-number`, and the generic UI text hydrator refuses to overwrite structural elements.


## Backend Step 7 — All Daily Games

Run `BRAINILAB_STEP7_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_DAILY_GAMES_SETUP.md`. No new Cron is required.


## Backend Step 8 — Real Friends

Run `BRAINILAB_STEP8_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_FRIENDS_SETUP.md`. No Cron is required.


## Backend Step 9 — Real Groups

Run `BRAINILAB_STEP9_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_GROUPS_SETUP.md`. No new Cron is required.


## Backend Step 10 — Final Rankings

Run `BRAINILAB_STEP10_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_RANKINGS_SETUP.md`. Individual public rankings are opt-in and no new Cron is required.


## Backend Step 11 — Admin / Backoffice V1

Run `BRAINILAB_STEP11_SQL_COPY_TO_SUPABASE.txt`, bootstrap the first owner in Supabase SQL Editor, then see `SUPABASE_ADMIN_SETUP.md`.

Local Admin: `http://localhost:8000/admin/`

Security/operating rules: `ADMIN_OPERATIONS.md`.


## Step 12 — Gameplay pass + Topic Rush

Run `BRAINILAB_STEP12_SQL_COPY_TO_SUPABASE.txt`, then see `SUPABASE_TOPIC_RUSH_SETUP.md`. Map Hunt is retained only for historical compatibility; Topic Rush is the current fourth Daily Game.


## V27 — Gameplay, Navigation & Retention

V27 separates the product into:
- `Games`: replayable anytime quizzes
- `Daily Quiz`: today's four-game Daily Hub
- `My BrainiLab`: Progress / Profile / Social / Account & Security

Evergreen results are inline rather than modal, Topic Rush does not reveal the topic before Start, and Brain Rank visual tiers are derived from the existing canonical level.

See:
- `GAMEPLAY_UX_QA_V27.md`
- `SUPABASE_STEP13_RANKING_LEVEL_SETUP.md`


## V28 — Home Daily clarity + profile avatars

V28 makes the header avatar open the account menu immediately, adds a real `My BrainiLab` entry, introduces secure custom avatar uploads, and changes the Home completion state from Brain-Mix-only to a full four-game Daily status.

`Categories` is no longer a player-facing section; `/categories/` redirects to `/games/`.

Run `BRAINILAB_STEP14_SQL_COPY_TO_SUPABASE.txt` to enable profile-photo Storage.

See:
- `SUPABASE_STEP14_PROFILE_AVATARS_SETUP.md`
- `UX_QA_V28.md`


## V29 — Account menu refinement

The avatar popover has been simplified:
- no icons in the option list
- larger typography
- explicit `My BrainiLab` entry
- guest state split into separate `Log in` and `Sign up` actions
- cleaner premium card layout


## V30 — Home cleanup + completed Daily closure

- `/daily-quiz/` now switches to the same caught-up experience as Home when all 4 Daily Games are complete.
- Removed the demo Brain Mix leaderboard from Home.
- Removed `Learn from every answer` from Home.
- No backend migration is required for V30.


## V31 — Daily #1, share icons, BrainiWord dictionary & ranking avatars

- Step 15 makes the current UTC date the official public Daily #1 and regenerates future Daily content as #2, #3, ... without changing today’s challenge content/results.
- BrainiWord rejects guesses outside the server-side 5-letter English word list without consuming an attempt.
- Public Individual Rankings can display the opted-in profile photo; Friends Rankings also render their existing avatar URL.
- Share Result uses only WhatsApp, Telegram, X, Facebook and a copy-to-clipboard icon.

Run `BRAINILAB_STEP15_SQL_COPY_TO_SUPABASE.txt` after Step 14.


## V32 — Play Anytime placement

- Home shows replayable category quizzes directly below the Daily experience.
- Removed the old `Keep playing` block.
- Home Groups now sits lower, after the gameplay area.
- Daily Quiz always shows a clearly separated `Play Anytime` block under today's Daily.
- The Daily page explicitly states that these replayable quizzes are not part of today's Daily Brain Score.
- No backend migration is required.


## V33 — OAuth same-origin fix

Google OAuth no longer uses a hard-coded `http://localhost:8000/profile/index.html`
from `supabase-config.js`.

The redirect is resolved from the origin that actually initiated login. This
prevents a V33 page opened from one local origin/port from returning into an
older BrainiLab copy running on another local origin.

For normal local testing use one origin consistently, preferably:

`http://localhost:8000`

Supabase Authentication Redirect URLs should include:

`http://localhost:8000/profile/index.html`

No database migration is required.


## V34 — Order Up Daily

Order Up replaces Flag Dash in the current Daily lineup.

Format:

```text
2 rounds × 10 ordered items
```

Daily lineup:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Flag Dash remains historical and its old Daily URL redirects to the replayable World Flags quiz.

Run `BRAINILAB_STEP16_SQL_COPY_TO_SUPABASE.txt`.

See:
- `SUPABASE_STEP16_ORDER_UP_SETUP.md`
- `UX_QA_V34_ORDER_UP.md`


## V35 — Guest route fix + Order Up click-to-lock

- Play Anytime and Daily Journey links resolve from the real site root, so guest quiz navigation no longer depends on being logged in or on root-absolute URLs.
- Order Up now uses click-to-lock instead of drag/reorder.
- Every tap locks the next position.
- The tenth tap scores the round automatically.
- Direction guidance and option typography are larger.
- No backend migration is required after Step 16.


## V35.1 — file:// route resolution

When BrainiLab is opened directly from Finder / `file://`, replayable quiz links now append `index.html` automatically.

Example:

`geography/world-flags-quiz/?difficulty=medium`

becomes, only under `file://`:

`geography/world-flags-quiz/index.html?difficulty=medium`

HTTP/localhost/production routing is unchanged.


## V36 — My Stats / Step 17 Player Analytics

`My BrainiLab` now separates:

```text
My Progress = gamification
My Stats    = performance analytics
```

My Stats includes real private cloud data for performance trends, category strengths, difficulty, Daily Brain Score, mechanic-specific Daily stats, deterministic insights and recent activity.

Run:

```text
BRAINILAB_STEP17_SQL_COPY_TO_SUPABASE.txt
```

No new Cron.

See:
- `SUPABASE_STEP17_PLAYER_ANALYTICS_SETUP.md`
- `UX_QA_V36_MY_STATS.md`


## V38 — Product Depth / Step 19 Question Quality

Product changes:

```text
Daily Quiz → Daily
Next Daily UTC countdown
Brain Rank unlock milestone
Question Quality Backoffice
subcategory tag suggestions
Service Worker disabled by default
production esbuild scaffold
```

Question Quality uses the existing verified question-answer events and never changes content difficulty automatically.

Run:

```text
BRAINILAB_STEP19_SQL_COPY_TO_SUPABASE.txt
```

No Cron.

See:
- `SUPABASE_STEP19_QUESTION_QUALITY_SETUP.md`
- `UX_QA_V38_PRODUCT_DEPTH.md`
- `PRODUCTION_BUILD_V38.md`


## V39 — Monetization Readiness / Step 20

Prepared but OFF by default:

```text
manual Ads Manager
six display placements
BrainiLab+
Stripe Checkout
Stripe Customer Portal
signed Stripe webhook
private Plus entitlements
Admin Monetization view
ads.txt placeholder
Privacy / Cookies / Manage privacy entry point
```

Run:

```text
BRAINILAB_STEP20_SQL_COPY_TO_SUPABASE.txt
```

Then follow:

```text
MONETIZATION_SETUP_V39.md
```

No Stripe secret is included in the browser or ZIP.

## V40 — Mobile / Tablet Polish

V40 makes the existing V39 product responsive as a first-class mobile experience rather than relying only on incidental responsive grids.

Key changes:

```text
accessible mobile navigation on every public header
account avatar remains available on phones
mobile/touch sizing and typography
Home / Games / Daily / quiz result responsive pass
Order Up / Topic Rush / BrainiWord mobile pass
Rankings / Groups / My BrainiLab / My Stats mobile pass
bottom-sheet modals on phones
Admin horizontal mobile dock + constrained logo
ads_test=1 rendering bug fixed
production ad lazy-loading probe fixed
viewport safe-area support
```

No database migration is required for V40.

See:

```text
UX_QA_V40_MOBILE.md
```

## V41.3 — Past Daily Play Anytime

Games now includes a **Past Daily** archive. Pick any published date before today and replay that date's:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Archive replays are deliberately practice-only: they do not alter today's Daily Brain Score or streak and their final result is not submitted to cloud progression/rankings.

Run once after the existing Supabase steps:

```text
BRAINILAB_STEP21_SQL_COPY_TO_SUPABASE.txt
```

See:
- `SUPABASE_STEP21_DAILY_ARCHIVE_SETUP.md`
- `UX_QA_V41_3_DAILY_ARCHIVE_PLAY_ANYTIME.md`

## V41.4 — Connections + no-repeat Play Anytime

Adds the replayable **Connections** mechanic to Games. Every game contains three rounds. Each round supports 4–8 clues and shows four possible connections; scoring rewards solving with fewer attempts:

```text
1st attempt = 1,000 pts
2nd attempt =   700 pts
3rd attempt =   400 pts
4th attempt =   200 pts
Maximum     = 3,000 pts
```

The initial pool contains 20 Connections puzzles. Admin → Content Pools includes a Connections tab for creating, reviewing, activating and deactivating puzzles.

Play Anytime category quizzes are now history-aware. For signed-in players, Supabase stores verified question history and the selector prioritises questions that user has not played before. Local browser history provides the same first-cycle preference on the current device. Repeats are allowed only when the available topic+difficulty pool has been exhausted. Past Daily replays and future Daily appearances are intentionally exempt from this filter.

Run once after Step 21:

```text
BRAINILAB_STEP22_SQL_COPY_TO_SUPABASE.txt
```

No new Cron is required.

See:
- `SUPABASE_STEP22_CONNECTIONS_ANYTIME_HISTORY_SETUP.md`
- `UX_QA_V41_4_CONNECTIONS_ANYTIME_HISTORY.md`

## V41.5.0 — Survival, Odd One Out, Higher or Lower + Content Ops

Adds three Play Anytime modes:
- Survival: 3 lives, 30-question cap, Easy → Medium → Hard, history-aware Question Bank selection.
- Odd One Out: 10 structured rounds, 20 starter puzzles.
- Higher or Lower: 10 structured comparisons with combo scoring, 20 starter pairs.

Admin changes:
- Global Results view removed.
- New Game Analytics view for completed cloud plays + Question Quality signals.
- Question Bank is explicitly the home for normal 4-option questions.
- Content Pools now manages BrainiWord, Topic Rush, Order Up, Connections, Odd One Out and Higher or Lower.
- CSV template + validated bulk importer per content type (up to 500 rows/import).
- Daily content map documents which source pool feeds each Daily game.

Backend: run `BRAINILAB_STEP23_SQL_COPY_TO_SUPABASE.txt` once after Step 22. No new Cron is required.

## V41.5.1 — gameplay clarity + analytics cleanup

- Survival renders World Flags with local flag assets, avoiding browsers that display regional indicators as `BR`, `FR`, etc.
- Higher or Lower keeps its product name but supports 12 natural comparison types (older/younger, bigger/smaller, faster/slower, etc.).
- Admin Higher or Lower creation/import includes `comparison_type`; the CSV template documents every supported type.
- Game Analytics shows the current active game catalogue even when a game has zero plays, so Sports is always visible.
- Map Hunt is retired from active analytics and new Map Hunt cloud game sessions are rejected.
- Run `BRAINILAB_STEP24_SQL_COPY_TO_SUPABASE.txt` after Step 23.

## V41.6.0 — Content Health + rotating Daily lineup

Admin now exposes a consistent Health score for normal Question Bank rows, structured Content Pools and active games. Health uses content exposure, completion/exit behaviour, answer success and attempt efficiency; samples below 10 exposures/starts are labelled `Building sample` rather than over-interpreted. Question Bank, Content Pools and Game Analytics can be ordered by Health.

Home Play Anytime includes Connections, Survival, Odd One Out and Higher or Lower.

From 2026-08-31 UTC, the four-game Daily lineup is:

```text
Brain Mix      — fixed
BrainiWord     — fixed
Rotating slot 1
Rotating slot 2
```

The two rotating slots are selected deterministically by UTC date from Order Up, Topic Rush, Connections, Odd One Out and Higher or Lower. All players therefore receive the same Daily lineup for a given date, while the experience varies between days. Structured rotating content is persisted in Supabase so future archive replays use the same assigned content.

Run once after Step 24:

```text
BRAINILAB_STEP25_SQL_COPY_TO_SUPABASE.txt
```

No new Cron is required. See `UX_QA_V41_6_HEALTH_DAILY_ROTATION.md`.


## V41.7.0 — Math & Logic Daily expansion

V41.7.0 adds Math Rush, Number Route and Sequence as permanent Play Anytime games and Daily-eligible rotating games. Brain Mix and BrainiWord remain fixed Daily slots; the other two slots rotate deterministically across all 28 unique pairs from Order Up, Topic Rush, Connections, Odd One Out, Higher or Lower, Math Rush, Number Route and Sequence.

Every Daily card includes **Try first · no score**. Practice uses different content, does not submit a game result and does not affect Daily Brain Score, XP, streaks or rankings.

Admin Content Pools includes Number Route and Sequence CSV imports. Number Route imports are automatically rejected unless the four numbers and target have exactly one valid solution using `+`, `−`, `×`, `÷` evaluated strictly left to right. Math Rush is generated and requires no editorial pool.

Backend migration: run `BRAINILAB_STEP26_SQL_COPY_TO_SUPABASE.txt` once after Step 25. No new Cron is required.

Final V41.7.0 QA/SEO/GEO/performance audit: `UX_QA_V41_7_MATH_LOGIC_SEO_PERFORMANCE.md`.

Build workflow now regenerates role bundles before production minification:

```text
npm run bundle   # regenerate role bundles only
npm run build    # regenerate bundles + esbuild minification into dist/
```

## V41.8.0 — Daily replay lock, integrated archives + Stats refresh

V41.8.0 tightens the Daily/Play Anytime split and updates My Stats after the game catalogue expansion.

- **Number Route Daily** is 3 rounds and scores by solve speed (maximum 2,500 Daily points). Play Anytime remains 10 rounds and keeps attempt-based scoring.
- **Connections** is 3 rounds in Daily / Past Daily / Try First, and 20 rounds in Play Anytime.
- **Past Dailies are integrated into the normal Games grid**: choose a previous Daily date once, then launch the historical batch from the relevant game card. The old standalone Past Daily section is removed.
- **Try First is a full real game-format practice** using a different historical/practice batch. It never writes results, Health, Daily Score, XP, streaks or rankings.
- Once a scored Daily game is completed, its Daily card is locked: no Try First action is shown and duplicate scored submissions are rejected server-side as well.
- **My Stats** includes the current game catalogue and removes the obsolete Recent Activity / Your latest results block.
- Rotating fallback content is deterministically date-seeded so archived/practice batches remain different from today's batch.

Backend migration: run `BRAINILAB_STEP27_SQL_COPY_TO_SUPABASE.txt` once after Step 26. No new Cron is required.

Final regression report: `UX_QA_V41_8_DAILY_REPLAY_STATS.md`.
