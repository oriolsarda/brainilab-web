# BrainiLab V37 — Performance Optimization Audit

## Main changes

### JavaScript delivery
Before V37, most public pages loaded roughly 23–28 external scripts.

V37 groups shared code into role-based bundles and defers execution:

- `shell.bundle.js`
- `cloud.bundle.js`
- `quiz.bundle.js`
- `daily.bundle.js`
- `rankings.bundle.js`
- `social.bundle.js`
- `profile.bundle.js`

Static browsing pages now start with only the shell bundle and load cloud/auth during idle time or immediately when the account control is used.

### Quiz fallback
`quiz-packs.js` is no longer downloaded eagerly on every category quiz.

The cloud question pack is attempted first. The local 20-question fallback bundle is loaded only if cloud content is unavailable.

### CSS
Large feature-specific CSS was removed from the global stylesheet:

- Order Up
- My Stats
- BrainiWord
- Suggestions

Those pages load their own small feature CSS file.

The global stylesheet dropped from about 150 KB to about 118 KB uncompressed.

### Images
The 900px-wide logo used for a ~52px navigation display was oversized.

V37:
- optimized PNG fallback
- adds a WebP source
- sets intrinsic image dimensions
- uses async decoding
- lazy-loads footer/non-critical images
- keeps header logo high priority

### Rendering
Below-the-fold sections use `content-visibility:auto` and containment to reduce initial style/layout/paint work.

### Cloud/Supabase
Pages that require real-time/authenticated data still load Supabase eagerly but with deferred scripts and preconnect hints.

Static pages defer Supabase/cloud boot until idle time. Clicking the account avatar forces immediate cloud loading.

### Navigation
Internal links are prefetched on hover when the browser is not in Save Data / 2G mode.

### Repeat visits
A production-only service worker caches versioned same-origin JS/CSS/images. It is deliberately disabled on localhost/127.0.0.1 to avoid stale-cache problems during local development.

### Deployment caching
`_headers` contains long-lived cache hints for versioned JS/CSS, short revalidation for brand assets, and no-cache rules for the service worker/HTML.

## Backend — Step 18

Step 17 rebuilt a player's complete analytics history after every inserted or verified result.

Step 18 changes that to an incremental analytics refresh of only:

`user + UTC date + game + difficulty`

It also adds indexes for:

- completed sessions
- per-game period rankings
- Daily score lookups
- friendship lookups
- pending friend requests
- group membership
- public leaderboard country filtering

No new Cron is required.

## Important

Run Step 17 first if it has not yet been applied.

Then run:

`BRAINILAB_STEP18_SQL_COPY_TO_SUPABASE.txt`

V37 frontend does not require Step 18 to render, but Step 18 is recommended for database/write scalability.
