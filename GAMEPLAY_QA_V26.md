# BrainiLab V26 — gameplay QA decisions

This pass intentionally reduces visual and decision load.

## Quiz questions

Long prompts use smaller typography and a wider question measure. The visible question number remains, but no longer competes with the prompt.

## Result screens

Primary post-game hierarchy:

```text
result
↓
Play another game
Share result
```

Share opens the common compact modal. The modal closes with its ×, backdrop click or Escape.

## Flag Dash

The native `[hidden]` state is now forced with:

```css
[hidden]{display:none!important}
```

This fixes the loader remaining visible because component CSS had overridden the browser's native hidden rule.

## Games page

The large descriptive hero was replaced with a compact game picker titled:

```text
What do you want to play?
```

The four Daily games are clickable directly inside the principal navy panel. Classic 20-question quizzes sit immediately below.

## Categories

Music was removed because BrainiLab does not yet have a real Music category/quiz. No category card should point to unrelated content.

## Map Hunt → Topic Rush

Map Hunt is no longer a current user-facing game. Its old URL redirects to Topic Rush and is `noindex`.

Historical Map Hunt result compatibility remains internally.
