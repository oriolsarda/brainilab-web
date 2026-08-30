# BrainiLab V41.2 — Visual Icon System Integration

## Installed
The full supplied BrainiLab Icon System v1.0 is available under:

`/assets/icons/`

It includes:
- 4 games × standard / mini / mono / card
- 17 category icons
- 49 product/navigation/status glyphs
- 4 group badge base shapes
- 16 group badge symbols
- 16 ready-made group badge examples
- 8 subtle rank halo assets
- design tokens + manifest

## Wired into the live product

### Games
- Daily Brain Score uses the new mini game pictograms.
- Daily journey uses the new mini game pictograms.
- General Knowledge / Geography / Science / History / Sports use the new category system.

### Navigation/status
- Header streak uses the BrainiLab streak glyph.
- Suggestions/help uses the BrainiLab help glyph.
- Modal close/delete states use the BrainiLab product glyphs.
- Success states and selected completion states use BrainiLab glyphs.
- Share copy action uses the approved copy glyph.

### Groups
The current database still stores the original 8 `crest_icon` values.
V41.2 maps those persisted values to the new BrainiLab badge symbols, so:
- no SQL migration is required,
- existing groups keep working,
- crests now look cohesive and vector-based.

The remaining supplied badge symbols/base shapes/examples are installed and ready
for a future expanded group-customization backend.

### Ranks
The existing Brain Rank names/thresholds remain unchanged.
The old thick coloured rings are replaced by the supplied subtle halo system.
Ten existing tiers are mapped onto the eight supplied visual progression assets,
with very small rotations on intermediary tiers to preserve visible progression
without making the profile photo feel over-gamified.

## Deliberately retained
- Country flag emoji remain real country flags.
- BrainiWord share grids remain emoji squares because they encode game results.
- Official WhatsApp/Telegram/X/Facebook marks remain their official brand marks.
- Text arrows in prose links remain typographic affordances rather than decorative icons.
- Account popover remains text-first, matching the established BrainiLab IA.

## Static QA
- All SVG paths resolve locally.
- All modified JS bundles pass `node --check`.
- No backend schema changes required.
