# BrainiLab Admin — Operating principles

## The Admin is not analytics theatre

Dashboard counts are explicitly cloud/backend counts.

For example:

```text
Cloud users
Synced results today
Cloud Daily players
```

They are not presented as total anonymous site visitors.

Guest-first web analytics should be a separate analytics system if/when needed.

## Safe content rule

Prefer:

```text
Draft
Review
Publish
Disable future use
New pack version
```

over mutation/deletion.

Do not alter content already consumed by players.

## Daily incident rule

Future Daily:

```text
inspect
regenerate if necessary
```

Today/past:

```text
do not regenerate
use feature kill switch
investigate
fix future content
```

## User-support rule

Inspect game/progression state.

Do not manually "fix":

```text
XP
score
streak
rank
```

If derived state is wrong, fix the canonical result/calculation path and rebuild it.

## Ranking moderation rule

Moderation action:

```text
suspend from rankings
```

not:

```text
change score
delete history
```

## Privacy rule

Normal Admin views do not browse:

```text
auth.users emails
Google identity metadata
password/auth internals
full friendship graph
```

Add a protected server-side support endpoint later only if a real support workflow requires auth metadata.

## Audit rule

Every production mutation should answer:

```text
who
what
which entity
when
why/context
```

The audit table is not browser-editable.
