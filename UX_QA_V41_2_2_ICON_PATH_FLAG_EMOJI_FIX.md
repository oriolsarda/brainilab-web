# BrainiLab V41.2.3 — Icon Path + Flag Emoji Fix

## Fixed
- Static SVG references no longer depend on site-root absolute `/assets/...` paths during local `file://` QA.
- Dynamic `BrainiIcons` paths resolve from the executing JS bundle and therefore work both locally and in production.
- CSS icon paths resolve relative to `assets/css/site.css`.
- World Flags questions render the country flag as a bundled local color-emoji asset derived from the Unicode flag stored in the question.
- If that asset ever fails to load, the original Unicode flag is shown as the fallback.
- No Supabase question migration is required.

Build/cache identity: `41.2.3`.
