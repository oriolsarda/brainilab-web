# BrainiLab Icon System v1.0

Web-ready vector asset library derived from the approved BrainiLab visual direction.

## Structure
- `games/standard` — primary game pictograms
- `games/mini` — compact variants
- `games/mono` — monochrome variants
- `games/card` — card-ready variants
- `categories` — 17 category icons
- `product` — 49 navigation/action/status glyphs
- `group-badges/base-shapes` — badge containers
- `group-badges/symbols` — combinable badge symbols
- `group-badges/examples` — 16 ready-made examples
- `rank-halos` — 8 profile-rank halo assets
- `tokens` — CSS color/system tokens

## Technical baseline
- SVG viewBox: 24×24
- Default stroke: 2
- Rounded joins and terminals
- Functional UI icons: monochrome / `currentColor` is recommended in production
- Brand pictograms may use up to 2 colors; multicolor is reserved for hero/identity moments

## Recommended sizes
- 16 px: dense UI
- 24 px: default UI
- 32–48 px: game/category cards
- 64 px+: hero/card applications

## Publishing
Prefer SVG in production. Rasterize only for platforms that cannot consume SVG.
