# BrainiLab — Step 9: Real Groups

Steps 1–8 ✓  
Step 9 adds the real group/team layer.

## Product rules

```text
Group size       1–5 members
Ranking minimum  3 members
Group Score      top 3 member scores
Group Streak     >=3 active members on consecutive UTC days
```

A group can exist with 1 or 2 members, but it is not eligible for Group Rankings until it reaches 3.

This prevents a 5-person team from receiving an automatic advantage simply because it has more members.

Example:

```text
Anna   8,400
Marc   7,900
Pau    7,100
Laura  5,300
Nil    3,900

Group Daily Score = 23,400
                    top 3 only
```

## PostgreSQL tables

```text
groups
group_members
group_invites

group_daily_stats
group_period_stats
group_game_period_stats
```

## Group identity

Each group has:

```text
name
country
crest icon
crest colour
invite code
owner
```

Allowed crest icons:

```text
⚡ 🧠 🌍 🚩 🏆 💡 🧩 ⭐
```

Allowed colours are the BrainiLab palette:

```text
#FFD813
#40AB34
#E52720
#E6680C
#2D296E
```

This keeps group identity customizable without introducing image uploads, moderation or storage yet.

## Membership

Roles are backend-ready for:

```text
owner
admin
member
```

The current product UI keeps management owner-first.

PostgreSQL enforces the 5-member limit. It is not only a frontend restriction.

Membership inserts lock the group row before counting members, which prevents two simultaneous invite acceptances from creating a sixth member.

## Create a group

The owner chooses:

```text
name
country
crest
```

They may also select up to 4 accepted friends to invite immediately.

Selected friends are **invited**, not silently added.

The invited user must explicitly join.

## Direct invitations

Owners can invite accepted BrainiLab friends.

Flow:

```text
Owner
  ↓
Invite friend
  ↓
group_invites = pending
  ↓
Friend sees invitation
  ↓
Join / Decline
```

Pending direct invitations are visible in the group card and can be cancelled.

## Shareable group link

Owners receive a stable group invite code:

```text
GRP-XXXXXXXX
```

WhatsApp/share uses:

```text
https://brainilabgames.com/groups/?invite=GRP-XXXXXXXX
```

Opening the URL does not silently add the person.

The recipient sees:

```text
Group invite received
Join group
```

If signed out:

```text
invite link
↓
Google / account login
↓
invite preserved
↓
Join after authentication
```

The database still enforces the 5-member limit when the link is accepted.

## Group member visibility

Members of the same group can see the social/game fields required for the team experience:

```text
display name
avatar
country
role
current streak
level
XP
today's Daily Brain Score
```

Emails and Google/Auth metadata are never returned.

## Group Score aggregates

### Daily

`group_daily_stats`

uses each member's:

```text
player_daily_stats.daily_brain_score
```

and stores the top 3 sum.

### Weekly / Monthly

`group_period_stats`

uses:

```text
player_period_stats
```

and stores the top 3 member period scores.

### Per-game rankings

`group_game_period_stats`

uses:

```text
player_game_period_stats
```

for:

```text
day
week
month
```

For BrainiWord, the group uses BrainiLab performance points so higher remains better for ranking purposes.

## Automatic refresh

No new Cron is required.

Step 6 already refreshes player progression when a `game_result` changes.

Step 9 adds:

```text
zz_game_results_refresh_groups
```

which runs after the player-progression trigger and rebuilds group aggregates for any groups containing that player.

Flow:

```text
game result
↓
player progression refresh
↓
group aggregate refresh
↓
Friends / Group UI can fetch current values
```

Membership changes also refresh the affected group.

## Group Streak

A Group Streak day requires:

```text
at least 3 group members
who each played at least one Daily Game
```

The current streak remains alive if the latest qualifying day is today or yesterday, matching the player-streak grace pattern.

## Group Rankings

The real Group Ranking RPC is:

```text
get_brainilab_group_rankings(...)
```

Supported filters:

```text
Global / Country

Daily / Weekly / Monthly

Score / Streak

All games
Brain Mix
Flag Dash
Map Hunt
BrainiWord
other game IDs already available in the ranking UI
```

Only groups with at least 3 members are ranked.

The RPC returns:

```text
Top 100
total ranked groups
my best ranked group
my group eligibility state
```

The existing Rankings UI still follows BrainiLab's ranking display rules:

```text
Top 3 podium
Top 10 highlighted
See more → Top 100
```

and the own-rank card can support the existing #1000 threshold behavior.

## Global vs Country

Each group has its own country.

`Global`:

```text
all eligible groups
```

`Local / Country`:

```text
eligible groups with the same group country
```

The frontend uses the current user's first eligible group's country for the Local view.

## My BrainiLab / Groups

Groups are now more prominent.

The group panel appears before Friends on My BrainiLab.

A group card shows:

```text
crest + name
country
1–5 members
ranking eligibility
today score
weekly score
monthly score
group streak
member list
pending invites
invite
manage members
group ranking
leave / delete
```

The Home group module also shows whether the team is already ranking-eligible.

## Security

The browser does not receive direct table permissions for:

```text
groups
group_members
group_invites
group_daily_stats
group_period_stats
group_game_period_stats
```

All browser operations use controlled `SECURITY DEFINER` RPCs.

Important permission checks are repeated in PostgreSQL:

```text
owner-only group identity changes
owner/admin direct invitation capability
owner/admin member removal
owner cannot leave without deleting
max 5 members
```

## Install Step 9

Supabase:

```text
SQL Editor → New query
```

Open:

```text
BRAINILAB_STEP9_SQL_COPY_TO_SUPABASE.txt
```

Copy everything and Run.

If Supabase shows the generic RLS warning for new tables, this prepared migration enables RLS and removes direct browser permissions before `COMMIT`.

## Verify

Run:

```sql
select
  to_regclass('public.groups') as groups,
  to_regclass('public.group_members') as group_members,
  to_regclass('public.group_invites') as group_invites,
  to_regclass('public.group_daily_stats') as group_daily_stats,
  to_regclass('public.group_period_stats') as group_period_stats;
```

All five columns should show table names.

Then:

```sql
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'create_brainilab_group',
    'get_my_brainilab_groups',
    'invite_brainilab_friend_to_group',
    'accept_brainilab_group_invite',
    'accept_brainilab_group_link',
    'get_brainilab_group_rankings'
  )
order by routine_name;
```

You should see all six functions.

## Testing

One account can test:

```text
create
edit name
change country
change crest
delete
```

To test membership and rankings properly, use 3 accounts.

Example:

```text
Chrome normal       → account A
Chrome Incognito    → account B
another browser     → account C
```

1. Make A and B friends.
2. Make A and C friends.
3. A creates a group and invites B + C.
4. B and C accept.
5. Group reaches 3 members.
6. Group Ranking changes from locked to active.
7. Complete Daily Games on the accounts.
8. Confirm Group Score uses the best 3 member values.

## Next step

Step 10 is the final Rankings layer:

```text
Individual
Friends
Groups

Global / Country
Daily / Weekly / Monthly
All games / specific games
Top 3 podium
Top 10
Top 100
own rank up to #1000
```

At that point Friends + Groups are both backed by the real social graph and real progression aggregates.
