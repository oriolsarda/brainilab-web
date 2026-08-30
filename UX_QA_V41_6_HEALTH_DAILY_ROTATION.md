# BrainiLab V41.6.0 — Health + Daily rotation QA

## Implemented
- Content Health telemetry for standard Question Bank questions and structured pools.
- Admin Health column and Health sorting in Question Bank and Content Pools.
- Game Health in Game Analytics using starts, completions, stale exits, accuracy and relative usage.
- Home Play Anytime includes Connections, Survival, Odd One Out and Higher or Lower.
- Daily lineup is four games: Brain Mix + BrainiWord fixed, plus two deterministic rotating games selected from Order Up, Topic Rush, Connections, Odd One Out and Higher or Lower.
- Past Daily archive renders the actual four-game lineup for the selected date.
- Daily structured content assignments are persisted in Supabase for Connections, Odd One Out and Higher or Lower.

## Health semantics
A content play sends one lightweight start event, sparse checkpoints (at most every 3 items / 25 seconds), and one completion batch. A started session with no activity for 15 minutes is treated as an exit. This avoids a request per question while retaining enough information to estimate content health.

Content Health uses exposure/exit, answer success or useful-difficulty accuracy, and attempt efficiency. Under 10 exposures is shown as `Building sample`.

Game Health uses completion rate, average success/accuracy and relative usage. Under 10 starts is shown as `Building sample`.

## Daily rollout
Rotation begins 2026-08-31 UTC so the in-progress 2026-08-30 Daily is not changed mid-day. Earlier Daily archive dates retain Brain Mix + Order Up + Topic Rush + BrainiWord.

## Manual browser checklist
1. Home: confirm all four new Play Anytime cards are visible.
2. Admin > Question Bank: confirm Health column and both Health sort directions.
3. Admin > Content Pools: verify Health column for BrainiWord, Topic Rush, Order Up, Connections, Odd One Out and Higher or Lower; verify sorting.
4. Admin > Game Analytics: confirm Starts, Exit and Health columns and no Map Hunt row.
5. Daily on/after 2026-08-31: confirm Brain Mix and BrainiWord are present plus exactly two rotating games.
6. Finish a rotating Daily structured game and confirm it contributes up to 2,500 Daily points.
7. Games > Past Daily: select different dates and confirm the archived four-card lineup changes when appropriate.
8. Leave a tracked game mid-session; after 15+ minutes refresh Admin analytics and confirm exit/Health telemetry can reflect it.

## Final static QA — 2026-08-30
Passed:
- 65 JavaScript files parse with `node --check`.
- 24 inline scripts parse with `node --check`.
- 333 local HTML asset references resolve.
- 4 JSON files parse.
- 144 SVG icon assets parse as XML.
- Step 25 transaction/dollar-quote/parenthesis lexical checks pass and all required RPC/function definitions are present.
- The Daily rotation covers all 10 unique two-game combinations from the five rotating games.
- Health tracker is linked on 14 gameplay entry pages.
- Service worker/build/package cache markers are V41.6.0.

Runtime Chromium navigation could not be executed in this QA container because local/file navigation is blocked by the environment administrator. A normal desktop/mobile browser pass remains recommended before production deployment.
