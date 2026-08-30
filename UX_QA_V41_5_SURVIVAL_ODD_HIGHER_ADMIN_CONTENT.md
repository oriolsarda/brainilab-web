# UX / Static QA — V41.6.0

## Implemented
- Games cards + dedicated pages for Survival, Odd One Out and Higher or Lower.
- Distinct SVG icons for all three modes.
- 20 local/Supabase seed items each for Odd One Out and Higher or Lower.
- Survival reuses published Question Bank content and server-side history.
- New game result actions return to the same mode or Games.
- Admin global Results section removed.
- Admin Game Analytics added.
- Question Bank / Content Pools separation clarified.
- CSV template/import flow added for BrainiWord, Topic Rush, Order Up, Connections, Odd One Out and Higher or Lower.
- Daily content map CSV added.

## Static checks
- JavaScript syntax: pass.
- Inline JavaScript syntax: pass.
- SVG XML parse: pass.
- JSON parse: pass.
- Local HTML asset/link references: pass.
- SQL migration delimiter / transaction sanity: pass.

## Manual browser QA still recommended
Chromium headless is not reliable in this environment. Before production, manually test desktop/mobile for:
- all three new games;
- signed-out fallback and signed-in Supabase content;
- repeat avoidance over multiple runs;
- Admin CSV preview/import for each format;
- Game Analytics at 7/30/90 days.
