# BrainiLab V28 — Home Daily / Account Menu / Avatar QA

## Account avatar menu

From any normal BrainiLab page:

```text
click profile avatar
```

The click must open the menu immediately.

It must **not** navigate to My BrainiLab first.

Menu order:

```text
My BrainiLab
Edit Profile
Groups & Friends
Account & Security
Sign out
```

`My BrainiLab` opens the normal profile dashboard.

Click outside or press Escape:

```text
menu closes
```

## Edit Profile photo

Authenticated synced account:

```text
My BrainiLab
→ Edit Profile
```

Expected:

```text
current photo / initial
Upload photo or Change photo
Remove
```

Upload test:
1. choose JPG/PNG/WebP
2. UI shows Uploading
3. image is cropped/resized
4. header avatar updates
5. menu avatar updates
6. refresh page
7. image remains

Remove test:
1. Remove
2. confirm
3. profile falls back to initial
4. refresh
5. remains removed

## Home after Brain Mix

### Brain Mix not completed

Home still opens directly into today's Brain Mix.

The Daily Brain Score section below can be used to understand the full Daily and open the Daily Hub.

### Brain Mix completed, Daily incomplete

The entire Home hero becomes:

```text
Daily #...
x/4 complete
Brain Mix complete. Keep your Daily going.
Daily Brain Score x / 10,000
Continue Daily
Share Brain Mix
See my progress
```

Below it:

```text
Brain Mix    ✓
Flag Dash    ✓ / pending
Topic Rush   ✓ / pending
BrainiWord   ✓ / pending
```

No large Brain-Mix-only completion screen should imply that the whole Daily is finished.

### All four Daily Games complete

Home hero must say:

```text
You’re caught up for today!
All four Daily challenges are done.
Want to keep testing yourself?
```

Primary CTA:

```text
Play more games
```

The four Daily cards must all show completed state.

## Home duplication

When the Home hero has become the full Daily state, the old lower Daily Brain Score block is hidden.

The separate `Today's Daily Games` card section was removed.

Fake/non-authoritative:

```text
Players today
Games today
Shares today
```

counters were removed from Home.

## Categories / Games

Primary navigation remains:

```text
Games
Daily Quiz
Rankings
Groups
About
```

There is no Categories navigation item.

`/categories/` redirects to:

```text
/games/
```

Games is the single player-facing anytime quiz browser.

Every game card explicitly shows:

```text
Choose difficulty
Easy
Medium
Hard
```

Topic SEO hub pages can continue to exist, but their breadcrumb parent is now:

```text
Games
```

rather than Categories.

## Regression checks

Manually test:
1. avatar click from Home
2. avatar click from Games
3. avatar click while already in My BrainiLab
4. upload avatar
5. replace avatar
6. remove avatar
7. refresh after each
8. Home with 0/4 Daily complete
9. Home with Brain Mix complete but 1–3 Daily complete
10. Home with 4/4 complete
11. Games difficulty buttons
12. `/categories/` redirect
13. mobile avatar menu
14. mobile Home caught-up state
