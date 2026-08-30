# BrainiLab V41.6.0 QA — Survival flags, Higher or Lower language, Analytics cleanup

## Changes
- Survival now renders World Flags questions with local flag PNG assets instead of browser-dependent regional-indicator text.
- Higher or Lower supports 12 natural comparison types and sends semantic `first` / `second` answers to Supabase.
- Existing 20 Higher or Lower starter pairs are mapped to natural wording.
- Admin manual creation and CSV import require/validate `comparison_type`.
- Admin Game Analytics is driven by an active-game allowlist, so Sports appears even with zero plays and retired Map Hunt never appears.
- New Map Hunt game sessions are rejected in Supabase; frontend result submission also ignores Map Hunt.

## Manual browser checks
1. Open Survival until a World Flags question appears; verify an actual flag image is shown, not `BR`, `FR`, etc.
2. Open Higher or Lower and verify examples such as Mozart use “older or younger”, planets use “bigger or smaller”, and speed pairs use “faster or slower”.
3. Verify the two answer buttons change labels per comparison type.
4. Admin → Content Pools → Higher or Lower: confirm comparison-type selector, table column, CSV template and CSV validation.
5. Admin → Game Analytics: confirm Sports is listed even at zero plays; Map Hunt is absent.
