# BrainiLab — Step 8: Real Friends

Steps 1–7 ✓  
Step 8 adds the real social friend layer.

## What Step 8 creates

PostgreSQL:

```text
friend_requests
friendships
```

RPCs:

```text
send_brainilab_friend_request(...)
accept_brainilab_friend_request(...)
decline_brainilab_friend_request(...)
cancel_brainilab_friend_request(...)
accept_brainilab_friend_invite(...)
remove_brainilab_friend(...)
get_my_brainilab_friends()
get_my_brainilab_friends_ranking(...)
```

## Friend flow

Manual friend code:

```text
Player A enters Player B's BRN-XXXXXXXX code
↓
pending request
↓
Player B sees the request
↓
Accept
↓
friendship
```

If both players send a request to one another, the second request automatically accepts the existing pending request.

## Invite link

The WhatsApp/share button uses:

```text
https://brainilabgames.com/profile/?friend=BRN-XXXXXXXX
```

The receiving player explicitly presses **Accept invite**.

If they are signed out:

```text
invite link
↓
Save progress / Google sign-in
↓
pending invite preserved in session
↓
friendship created after auth
```

This is deliberately different from silently adding someone just because they opened a URL.

## Privacy

Friends do not receive access to:

```text
email
auth provider
Google account data
private auth metadata
```

Accepted friends can see only social/game fields needed for BrainiLab:

```text
display name
avatar
country
current streak
best streak
XP / level
today's Daily Brain Score
Daily completion
weekly Brain Score
monthly Brain Score
```

`profiles` remains private under its existing RLS.

The new friend tables are browser-RPC-only: direct `SELECT`, `INSERT`, `UPDATE` and `DELETE` access is not granted to `anon` or `authenticated`.

## Friends Ranking

The Rankings page now uses PostgreSQL when:

```text
Friends
```

is selected.

Supported filters:

```text
Daily / Weekly / Monthly
Score / Streak
All games
Brain Mix
Flag Dash
Map Hunt
BrainiWord
other game IDs already present in the ranking selector
```

For **All games**:

```text
Daily   → Daily Brain Score
Weekly  → current week's accumulated Daily Brain Score
Monthly → current month's accumulated Daily Brain Score
```

For a specific game the ranking uses Step 6's precomputed per-game period stats.

For BrainiWord the UI can display attempts instead of pretending attempts are ordinary points.

## My BrainiLab

The Friends panel now shows real cloud data:

```text
Friend code
Invite on WhatsApp
Send request
Incoming requests
Outgoing requests
Cancel / Decline / Accept
Friends list
Streak
Today's Brain Score
XP
Friends Ranking link
```

The Groups UI can already use this real Friends list for member selection, while Groups themselves remain local/mock until the next backend step.

## Run the SQL

Supabase:

```text
SQL Editor → New query
```

Open:

```text
BRAINILAB_STEP8_SQL_COPY_TO_SUPABASE.txt
```

Copy all → Run.

The migration enables RLS and revokes direct browser access itself.

## Verify installation

```sql
select
  to_regclass('public.friend_requests') as friend_requests,
  to_regclass('public.friendships') as friendships;
```

Both columns should return table names.

Then:

```sql
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'get_my_brainilab_friends',
    'send_brainilab_friend_request',
    'accept_brainilab_friend_request',
    'accept_brainilab_friend_invite',
    'remove_brainilab_friend',
    'get_my_brainilab_friends_ranking'
  )
order by routine_name;
```

You should see all six RPC names.

## Testing with two accounts

The real Friends flow needs two Supabase users.

A practical local test:

```text
Chrome normal window → Google account A
Chrome Incognito      → Google account B
```

Both can use:

```text
http://localhost:8000/profile/
```

1. Copy account A's friend code.
2. Enter it in account B.
3. Account A should receive the request.
4. Accept.
5. Both profiles should show each other.
6. Open `Rankings → Friends`.

The same setup can test invite-link acceptance.

## No Cron

Step 8 does not need a Cron job.

Friendship state changes only when a user:

```text
sends
accepts
declines
cancels
removes
```

Progression values displayed next to friends stay current because Step 6 already recalculates player aggregates whenever results change.

## Next step

Step 9 is **Groups**:

```text
max 5 members
owner/admin
group name
crest icon + colour
invite link
membership requests/invites
group Daily/Weekly/Monthly aggregates
global group ranking
country group ranking
```
