# BrainiLab V41.8.0 — Daily replay, archive, Stats and gameplay regression QA

## Scope

This release validates the Daily replay lock, real-format Try First flow, integrated Past Daily launch UX, Number Route Daily speed scoring, Connections round-count split, My Stats catalogue refresh and all V41.7 SEO/performance invariants.

## Functional changes validated

### Number Route
- Play Anytime: 10 rounds, attempt-based score.
- Daily / Past Daily / Try First: 3 rounds.
- Daily score is server-verifiable and time-sensitive: round caps are 834 / 833 / 833 for an exact 2,500-point ceiling.
- The first 5 seconds of a solved route keep full round value; each complete second after that removes 10 points, with a 200-point solved-route floor.
- Skip scores 0.
- All 40 seed puzzles were exhaustively checked across all 64 operator combinations; every seed has exactly one valid left-to-right solution and the stored solution matches it.

### Connections
- Play Anytime: 20 rounds.
- Daily / Past Daily / Try First: 3 rounds.
- Play Anytime updates the no-repeat history; Daily/practice modes do not contaminate that history.

### Daily / Try First
- Brain Mix and BrainiWord remain fixed Daily games; the two rotating slots continue using the 28-pair deterministic rotation from the eight eligible rotating games.
- Completed Daily games hide Try First and normal Daily replay actions.
- A server-side per-user/per-game/per-Daily lock rejects duplicate scored submissions, including multi-tab races.
- Try First launches the real game route/mechanic with a different practice/archive date and disables result submission, Health telemetry and persistent resume/finished state.

### Past Daily UX
- The standalone Past Daily section is removed.
- Games owns one past-date selector.
- Daily-eligible game cards expose the selected historical Daily batch only when that game belonged to that day's lineup.
- Official archive epoch is Daily #1 = 2026-08-29.

### My Stats
- Filters/per-game reporting cover the current catalogue: Brain Mix, BrainiWord, Order Up, Topic Rush, Connections, Survival, Odd One Out, Higher or Lower, Math Rush, Number Route, Sequence and category quizzes including Sports.
- The `Recent Activity / Your latest results` block is removed.
- Analytics classification maps the new games to useful math/logic/knowledge/mixed categories while retaining Map Hunt / Flag Dash only as legacy historical categories.

## Automated regression results

Final automated suite result: **PASS — 0 errors, 0 warnings**.

- JavaScript parsed: 73 files.
- HTML checked: 43 files.
- Inline scripts parsed: 27.
- Local asset references checked: 1,074.
- SVG files parsed: 156.
- JSON files parsed: 5.
- CSV templates checked: 10.
- Indexable pages: 27.
- Sitemap URLs: 27, exact parity with indexable canonicals.
- Number Route seed puzzles: 40/40 unique-solution valid.
- Sequence seed puzzles: 40/40 structurally valid.
- Daily rotating pairs: all 28/28 combinations covered.
- HTTP route smoke test: 42/42 route directories returned HTTP 200 from a clean local server.

## SEO / GEO / performance regression

The V41.7 SEO/GEO and performance work was rechecked after the V41.8 changes rather than reverted:

- Canonical, title, description, H1, Open Graph, Twitter, hreflang and JSON-LD checks remain valid on indexable routes.
- Sitemap/indexability parity remains exact (27/27).
- No broken local assets were detected.
- Production role bundles were regenerated from the V41.8 sources so stale V41.7 logic is not shipped.
- Service Worker/static cache version is V41.8.0.
- Approximate first-party core gzip footprint remains ~109 KB on Home and ~100.5 KB on Daily in the QA harness.

## Supabase

Run `BRAINILAB_STEP27_SQL_COPY_TO_SUPABASE.txt` once **after Step 26**. The migration is transactional and does not require a new Cron.
