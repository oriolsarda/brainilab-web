# BrainiLab V41.7.0 — Math/Logic Daily + SEO/GEO + Performance final QA

## Scope completed
- Added **Math Rush**, **Number Route** and **Sequence** as permanent Play Anytime games on Home and Games.
- Added all three to the rotating Daily pool. Brain Mix + BrainiWord remain fixed; the other two slots rotate across all 28 unordered pairs of the eight eligible rotating games.
- Added **Try first · no score** for every Daily game. Practice content is intentionally separate from the scored Daily and never writes game results, Daily score, XP, streak, rankings or Content Health sessions.
- Added Admin Content Pool support and CSV templates for Number Route and Sequence. Math Rush is deterministic/generated and needs no content CSV.
- Number Route import validation requires exactly one valid left-to-right solution.
- Added the three new game types to Content Health and Game Analytics.

## Final functional/static QA — PASS
Automated QA passed with zero errors and zero warnings:
- 71 JavaScript files parse with `node --check`.
- 43 HTML files parsed; 27 indexable pages all have one H1, canonical URL, 100–165 character description, 20–60 character title, Open Graph, Twitter metadata, `hreflang=en`, `hreflang=x-default` and valid JSON-LD.
- 27 sitemap URLs exactly match the 27 indexable canonical URLs.
- 27 inline JavaScript blocks parse successfully.
- 1,078 local HTML asset/navigation references resolve.
- 4 JSON files parse.
- 156 SVG files parse as XML.
- 10 Admin CSV templates have consistent column counts.
- 40 Number Route starter puzzles validated by exhaustively checking all 64 operator combinations per puzzle. Every puzzle has exactly one valid solution and the stored solution matches it.
- 40 Sequence starter puzzles validated for 5-value sequence, 4 unique options and included correct answer.
- All 28 two-game Daily rotation pairs are unique, cover every possible pair from the eight rotating games, and the JavaScript ordering matches the Supabase SQL ordering exactly.
- Math Rush local generation tested across 200 deterministic seeds × 60 operations: all displayed operands remain 1–9 and every division is exact.
- Math Rush SQL generator uses the same one-digit constraint for division (`q <= floor(9 / divisor)`).
- Try First contains all ten Daily-capable mechanics and has no game-result, verification or Content Health write path.
- New game pages and four SVG icon variants exist for Math Rush, Number Route and Sequence.
- Admin import templates are wired for Number Route and Sequence.
- Step 26 contains the required loaders, validators, verification RPCs, Daily functions, Admin import support and 40+40 starter seeds. The canonical SQL file and copy-to-Supabase file are byte-identical.
- Package/build/Service Worker cache markers are V41.7.0.
- A local Python HTTP server returned HTTP 200 for all 43 HTML routes.

## Fixes found during the final pass
- Fixed Math Rush SQL division generation so the dividend can no longer become two digits. Both operands are now always one digit.
- Updated the Math Rush Try First example from `24 ÷ 6` to `8 ÷ 4` so the practice mechanic follows the same rule as the real game.
- Removed obsolete Flag Dash / Map Hunt client loaders and their large country/clue fallback datasets from active Daily bundles. Legacy server-side verification hooks remain only to avoid breaking old synchronized results.
- Added a deterministic bundle rebuild helper (`tools/rebuild-bundles.py`) and made `npm run build` rebuild role bundles before esbuild minification. This prevents production bundles drifting behind source files.

## SEO / GEO audit — PASS
- Indexable pages have complete canonical, robots, Open Graph, Twitter and hreflang metadata.
- Titles/descriptions were tightened across Games, General Knowledge, Geography, Flags, Capitals, History, Sports, Survival and Higher or Lower so they describe the actual playable intent and mechanics more clearly.
- Home exposes Organization, WebSite, WebPage and featured-game ItemList schema.
- Games exposes CollectionPage + 13-game ItemList schema.
- Daily exposes CollectionPage, Daily game ItemList and FAQ schema with matching visible explanatory content.
- Math Rush, Number Route and Sequence each expose WebPage, BreadcrumbList and WebApplication schema.
- Sitemap and canonical coverage are exactly aligned: 27 indexable URLs, 27 sitemap URLs.
- Retired/redirect/private surfaces remain `noindex`; Map Hunt is not exposed in Home, Games or sitemap.
- `robots.txt` allows normal crawlers and OAI-SearchBot and points to the canonical sitemap.

## Performance audit — PASS
- Home local core payload is ~107.0 KB gzip (site + mobile CSS + shell + cloud + Home bundle), excluding the third-party Supabase SDK.
- Daily local core payload is ~98.5 KB gzip, excluding the third-party Supabase SDK.
- Obsolete Flag Dash / Map Hunt fallback data was removed from active Daily/Home bundles, reducing parse/download work.
- Static JS/CSS use one-year immutable caching via `_headers`; brand/icons/flags have dedicated cache policies; `sw.js` is no-cache.
- Service Worker uses the V41.7.0 cache namespace and removes previous BrainiLab static caches on activation.
- Gameplay/card images use lazy loading and async decoding where appropriate; primary brand imagery keeps eager/high-priority loading.
- Existing `content-visibility` and deferred scripts keep below-the-fold work away from initial layout.
- Largest first-party asset is `assets/css/site.css` at ~154.8 KB raw / ~26.7 KB gzip; no oversized raster asset is in the critical path.

## Runtime browser note
All routes were exercised through a real local HTTP server. A Chromium headless navigation attempt in this container hangs/is blocked by the environment, consistent with earlier QA runs, so this report does not claim an interactive Chromium session that the environment cannot complete. The static/runtime contract checks above are exhaustive for the deliverable; a short normal Mac Safari/Chrome smoke test remains appropriate before pushing production.

## Supabase
V41.7.0 requires **Step 26 once, after Step 25**. No new Cron is required.
