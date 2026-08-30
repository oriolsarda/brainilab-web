# BrainiLab V40 — Mobile / Tablet QA

V40 is a frontend-only responsive/polish release based on V39. No scoring, Supabase schema, ranking or monetization entitlement logic changes.

## Target widths

Test at least:

```text
320 × 568
375 × 812
390 × 844
430 × 932
768 × 1024
1024+ desktop regression
```

Also test one phone in landscape.

## Global header

At <= 920px:

```text
logo
streak
account avatar
Menu
```

The account avatar must remain accessible on mobile.

`Menu` opens a full-width dropdown below the header. It must close after selecting a link, tapping outside, pressing Escape, or returning to desktop width.

At very narrow widths the Help icon may disappear before the account/avatar or Menu controls do.

## Home

Verify:

- Daily question never overflows horizontally.
- Answer buttons are one column and easy to tap.
- Next/continue CTA spans the usable width.
- Daily result metrics wrap without clipping.
- Brain Score becomes two cards per row, then one per row on small phones.
- Play Anytime cards are one column.
- Group card actions remain reachable.

## Games

Verify all six replayable category cards:

- one card per row
- Easy / Medium / Hard remain three clear tap targets
- no text truncation
- no horizontal scrolling

### Ad test regression

On localhost:

```text
http://localhost:8000/games/?ads_test=1
```

Expected: the `games_mid_content` AD TEST placeholder renders immediately, even if the slot is below the first viewport.

The V39 bug was caused by observing an HTML `[hidden]` element with IntersectionObserver; a hidden element has no layout box and could never intersect. V40 uses an invisible one-pixel probe for production lazy loading and renders test slots immediately.

## Daily

Verify:

- hero copy and three summary values fit
- Daily journey is one card per row
- Next Daily countdown fits
- Play Anytime is clearly separated

## Replayable quizzes / Brain Mix

Verify:

- question typography adapts to long prompts
- answer targets >= ~44px / comfortable touch height
- difficulty selector remains usable
- feedback and Next do not overlap
- result CTAs stack vertically
- share sheet opens as a bottom sheet

## Order Up

Verify:

- direction remains dominant
- locked-order area uses two columns
- choices use one column
- every choice remains large enough to tap
- 10th selection / auto-submit flow does not jump horizontally

## Topic Rush

Verify:

- timer and score blocks fit side by side
- answer input is 16px+ so iOS does not zoom the page
- submit button moves below input
- keyboard opening does not create horizontal overflow

## BrainiWord

Verify:

- 5×5 board fits 320px width
- keyboard fits without horizontal scroll
- title/back/meta reorganize on small phones
- Enter/Backspace remain comfortable touch targets

## Rankings

Verify:

- Individual / Friends / Groups remain a 3-button mode row
- filters collapse safely
- podium remains three columns at common phone widths
- ranking rows preserve position / player / score hierarchy
- <= 370px can fall back to a vertical podium

## Groups & Friends

Verify:

- group hero stacks
- friend rows do not overflow
- group stats collapse
- group action buttons become full-width grid controls
- create/invite dialogs behave as bottom sheets

## My BrainiLab / My Stats

Verify:

- My BrainiLab tabs scroll horizontally instead of shrinking text
- active tab scrolls into view
- rank hero is readable
- metrics use 2 columns, 1 column on very small phones
- security/account cards stack
- My Stats filters use touch-size buttons
- SVG charts scroll inside their chart wrapper, not the whole page

## BrainiLab+

Verify:

- benefits and pricing stack
- no pricing card overflows
- Manage subscription / Checkout buttons are full usable touch targets

## Account menu / auth / share

On mobile:

- account menu width never exceeds viewport
- auth modal is a bottom sheet
- share modal is a bottom sheet
- social/group dialogs are bottom sheets
- sheets scroll internally if the keyboard or short viewport reduces space

## Admin

Desktop/tablet:

- BrainiLab Admin logo is constrained to ~108px wide / 40px high max
- it never stretches from the HTML intrinsic `height` attribute

Mobile <= 760px:

- sidebar becomes a sticky horizontal admin dock
- logo becomes a compact mark area
- admin sections scroll horizontally in the dock
- page content uses full width below the dock
- metrics use 2 columns when possible, 1 on tiny phones
- tables scroll inside their table wrapper
- forms stack
- drawer becomes full-screen width
- Question Quality / Monetization controls remain reachable

## Accessibility / mobile quality

Verify:

- browser zoom is not disabled
- form text stays >= 16px on mobile to avoid forced iOS input zoom
- account access is never hidden on phones
- focus outlines remain visible for keyboard users
- hover transforms are disabled on touch-only devices
- reduced-motion preference suppresses decorative motion
- `viewport-fit=cover` is present for safe-area-aware devices

## Desktop regression

At >= 1024px verify V39 visual structure is preserved. V40 mobile overrides should not modify the desktop layout except for the intentionally smaller Admin logo.
