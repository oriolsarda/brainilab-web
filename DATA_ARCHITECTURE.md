# BrainiLab data architecture — mock-ready / backend-ready

## Goal

All UI should talk to `BrainiData.api`, never directly to `localStorage` or hard-coded collective stats.

Current implementation is local/mock. Later, replace the methods inside `assets/js/data.js` with real API calls.

## Core entities

### Player
- id
- displayName
- countryCode
- createdAt
- currentStreak
- bestStreak
- xp / level
- totalQuestions / totalGames / totalShares
- favoriteCategory
- categoryAccuracy

### GameResult
Common fields:
- id
- gameId
- playedAt
- dailyNumber
- percentile
- streakAfter

Game-specific fields:
- Brain Mix: score, correct, total, accuracy, timeSec
- Flag Dash: correct, total, accuracy, bestCombo, timeSec
- Map Hunt: score, correct, total, accuracy, avgDistanceKm
- BrainiWord: won, attempts, evaluations

### DailyState
- key
- number
- completedGames
- brainScore
- brainScorePercentile

### PersonalBest
Stored by gameId. Payload depends on game mechanic.

### CollectiveStats
- active players today
- total games
- total answers
- shares
- per-game averages / win rates / distributions
- leaderboards

### ShareEvent
- id
- gameId
- channel
- at
- resultId / context

### AnalyticsEvent
- event
- at
- props

## Public repository contract

```js
await BrainiData.api.getGame(gameId)
await BrainiData.api.getPlayer()
await BrainiData.api.getDaily()
await BrainiData.api.getPersonalBest(gameId)
await BrainiData.api.getRecentResults(gameId)
await BrainiData.api.getCollectiveStats(gameId)
await BrainiData.api.getLeaderboard(gameId)
await BrainiData.api.submitGameResult(gameId, payload)
await BrainiData.api.recordShare(gameId, channel, context)
await BrainiData.api.track(event, props)
await BrainiData.api.getShareUrl(gameId, channel)
```

## Future backend endpoints

Suggested REST mapping:

- `GET /api/v1/me`
- `GET /api/v1/me/daily`
- `GET /api/v1/me/results?game_id=...`
- `GET /api/v1/me/personal-bests`
- `POST /api/v1/game-results`
- `GET /api/v1/games/:gameId/stats`
- `GET /api/v1/games/:gameId/leaderboard?scope=global|country|friends`
- `POST /api/v1/share-events`
- `POST /api/v1/events`

## Important rule

Do not trust client-submitted scores in production.
Scores for competitive leaderboards should be server-validated or derived from signed game sessions.

## Sharing

All games use `BrainiShare.open(gameId, result)`.

Supported:
- native Web Share API
- copy result
- copy tracked URL
- generated PNG result card
- WhatsApp
- Telegram
- X
- Facebook

Every share calls `recordShare()` and uses UTM/ref parameters.

## Daily Brain Score

Daily games:
- Brain Mix
- Flag Dash
- Map Hunt
- BrainiWord

Each game maps its native score into a max 2,500-point contribution.
Daily Brain Score therefore tops out at 10,000.

This normalization belongs on the server in production.


## UI surfaces currently consuming the data layer

- Home: Daily Brain Score, global activity, Brain Mix leaderboard, player summary.
- My Stats: streaks, totals, category accuracy, recent results.
- Leaderboards: Brain Mix, Flag Dash and Map Hunt collective rankings.
- Quiz result screens: result submission + percentile + unified sharing.
- BrainiWord: attempts, win/loss, evaluation pattern, personal best, sharing.
- Flag Dash: correct answers, accuracy, best combo, sharing.
- Map Hunt: score, accuracy, average distance, sharing.

## Production security / integrity

Competitive and collective data must not rely on client-side truth:
- issue a game session ID from the server;
- version the question set / daily seed;
- submit answer events or a signed result;
- calculate or verify competitive scores server-side;
- rate-limit result and share endpoints;
- treat country/friends leaderboards as derived views, not client claims.

## Suggested data warehouse events

- page_view
- game_started
- question_answered
- game_completed
- daily_completed
- personal_best
- streak_extended
- result_share_opened
- result_shared
- share_link_clicked
- next_game_clicked
- account_created
- login
- premium_viewed
- premium_started

These can later feed retention, DAU/MAU, games/session, share conversion and revenue cohorts.


## Authentication and guest migration

The browser starts with an anonymous player identity. Playing never requires an account.

### Guest state
- anonymous_player_id
- local player profile
- game results
- personal bests
- Daily Brain Score
- streak
- preferences

### Account state
- user_id
- verified email
- auth provider
- cloud sync flag
- player profile
- leaderboard opt-in

### Conversion rule
Creating an account must **merge the anonymous history into the authenticated player**, not create a blank profile.

Current prototype contract:

```js
await BrainiData.api.getAuthState()
await BrainiData.api.requestMagicLink(email)
await BrainiData.api.completeMockSignIn(provider, profile)
await BrainiData.api.signOut()
await BrainiData.api.updatePlayerProfile(patch)
await BrainiData.api.joinLeaderboard(displayName)
await BrainiData.api.leaveLeaderboard()
```

The current provider flow is intentionally mocked. In production these methods should map to a managed auth provider such as Supabase Auth / Clerk and a server-side merge transaction.

Suggested production routes:

- `POST /api/v1/auth/anonymous-session`
- `POST /api/v1/auth/merge-guest`
- `GET /api/v1/me`
- `PATCH /api/v1/me/profile`
- `POST /api/v1/me/leaderboard-profile`
- `DELETE /api/v1/me/leaderboard-profile`

### Privacy defaults
- Account creation is optional for playing.
- Public leaderboard visibility is opt-in.
- Email is never exposed as a public display name.
- A player chooses a public display name only when joining leaderboards.


## Friends, groups and rankings

### Friend connections

Recommended production tables:

- `friend_requests`
  - id
  - requester_player_id
  - addressee_player_id
  - status: `pending | accepted | declined | blocked`
  - created_at
  - responded_at
- `friendships`
  - player_id_a
  - player_id_b
  - created_at

A public BrainiLab friend code should resolve server-side to a player ID and should be revocable. Email addresses should never be used as public friend identifiers.

### Groups

Recommended tables:

- `groups`
  - id
  - owner_player_id
  - name
  - crest_icon
  - crest_color
  - country_code
  - created_at
- `group_members`
  - group_id
  - player_id
  - role: `owner | member`
  - joined_at
- `group_invites`
  - group_id
  - inviter_player_id
  - invited_player_id
  - status

**Server invariant:** a group can have a maximum of 5 active members including the owner. This must be enforced transactionally on the backend, not only in JavaScript.

### Rankings dimensions

The Rankings UI supports:

- mode: `individual | friends | group`
- region: `global | country`
- period: `daily | weekly | monthly`
- metric: `score | streak`
- game: `all | brainmix | flagdash | maphunt | brainiword | worldflags | ...`

Suggested endpoint:

`GET /api/v1/rankings?mode=individual&region=global&period=daily&metric=score&game=all&limit=100`

Suggested response:

```json
{
  "total_ranked": 28431,
  "top": [],
  "viewer": {
    "rank": 185,
    "eligible": true
  }
}
```

Viewer ranking behavior:
- ranks 1–100 can be included in the returned Top 100;
- ranks 101–1000 return the exact viewer rank separately;
- rank >1000 or insufficient activity returns no numeric position and the UI displays `Ranking available from #1000`;
- friends rankings include accepted friends plus the viewer;
- group country rankings use the group's country.

### Ranking performance

Do not calculate global rankings from raw answers on every request. Recommended production design:

- server-validated `game_results`;
- daily / weekly / monthly aggregation jobs;
- ranking snapshots, materialized views or Redis sorted sets;
- aggregates by game + period + country;
- group scores computed server-side from member results.

### Prototype repository methods

```js
await BrainiData.api.getSocialState()
await BrainiData.api.getFriends()
await BrainiData.api.sendFriendRequest(code)
await BrainiData.api.acceptFriendRequest(requestId)
await BrainiData.api.removeFriend(friendId)

await BrainiData.api.getGroups()
await BrainiData.api.createGroup(payload)
await BrainiData.api.updateGroup(groupId, patch)
await BrainiData.api.leaveGroup(groupId)

await BrainiData.api.getRankings(filters)
```

Current values are mock/deterministic data for UX development.


## Finite 20-question quiz packs

Evergreen topic quizzes are not endless streams. The product contract is:

- one quiz session = exactly 20 questions;
- questions belong to a `topic`;
- every pack has a `difficulty`: `easy | medium | hard`;
- packs are versioned/grouped with a `set` number;
- the player sees question 1 immediately after opening the pack;
- finishing question 20 produces one immutable `game_result`.

Prototype:

```js
BrainiQuizPacks.get(topic, difficulty, set)
```

Suggested production entities:

- `quiz_packs`
  - id
  - topic_id
  - difficulty
  - set_number
  - version
  - published_at
- `quiz_pack_questions`
  - pack_id
  - question_id
  - position (1–20)

Server invariant: every published evergreen quiz pack must contain exactly 20 active questions.

This model gives BrainiLab finite, comparable quiz sessions instead of an infinite question feed. Rankings can therefore compare equivalent 20-question sessions by topic and difficulty.


## Suggestions / feedback

Suggestions are a utility feature, intentionally de-emphasized in the primary navigation.

Prototype method:

```js
await BrainiData.api.submitSuggestion({
  type,
  message,
  email
})
```

Suggested production endpoint:

`POST /api/v1/suggestions`

Suggested fields:
- suggestion_id
- authenticated_player_id nullable
- type
- message
- reply_email nullable
- page_url / referrer
- created_at
- triage_status

The public Suggestions page should remain `noindex` and accessible through the small `?` utility button rather than competing with Games, Daily Quiz, Rankings or Groups.


### Friend invite links

The prototype can share:

`https://brainilabgames.com/profile/?friend=BRN-XXXX`

Production should not rely on a permanent raw friend code in a URL. Prefer a revocable invite token:

`https://brainilabgames.com/invite/friend/<token>`

Recommended table:

- `friend_invites`
  - id
  - inviter_player_id
  - token_hash
  - expires_at nullable
  - max_uses nullable
  - use_count
  - revoked_at nullable
  - created_at

Flow:

1. Authenticated player creates an invite.
2. Backend returns a signed / random high-entropy token.
3. WhatsApp shares the invite URL.
4. Recipient opens it.
5. If logged out, preserve the token through authentication.
6. Recipient confirms `Add friend`.
7. Backend creates or accepts the friendship transactionally and increments invite usage.

Never auto-create a friendship simply because a URL was opened; opening a link should not be sufficient consent.


## Supabase profiles — implemented Step 2

`auth.users` remains owned by Supabase Auth.

BrainiLab now introduces:

```text
public.profiles
```

with a one-to-one primary/foreign key:

```text
profiles.user_id -> auth.users.id
```

Current cloud profile fields:

- display name
- avatar URL
- ISO country code
- immutable server-generated friend code
- ranking visibility preference
- timestamps

RLS is owner-only at this stage. Public player discovery and friend-code resolution will later use explicit APIs / database functions rather than opening arbitrary profile rows to browser SELECT queries.


## Supabase game sessions/results — implemented Step 3

The local-first repository now generates a stable `clientResultId` for every newly completed game.

Cloud persistence:

```text
game_sessions
  1
  |
  1
game_results

game_sessions
  1
  |
  N
game_answers
```

Guest behavior:
- new results remain in local state with `cloudSyncStatus = pending`;
- after authentication, pending Step 3 results are uploaded;
- `(user_id, client_result_id)` prevents duplicate migrations/retries.

Security:
- game tables are owner-readable via RLS;
- authenticated browsers do not get direct INSERT/UPDATE/DELETE grants;
- writes go through `submit_brainilab_game_result(...)`;
- current scores are explicitly `server_verified = false`.

Question-bank/server validation is required before global competitive rankings can treat scores as authoritative.


## Supabase question bank — implemented Step 4

Content tables:
- topics
- questions
- question_versions
- question_options
- tags
- question_tags
- quiz_packs
- quiz_pack_questions

Direct browser table reads are disabled. Playable content is served through:
- `get_brainilab_quiz_pack(...)`
- `check_brainilab_quiz_answer(...)`

The initial pack payload omits correctness/explanations. Correctness is revealed only after an answer RPC.

The 360 existing topic questions are normalized and imported as 18 finite 20-question packs across Easy / Medium / Hard.

Step 4 also adds `verify_brainilab_quiz_result(...)`, which recomputes correctness from submitted question/option IDs and marks `game_results.answers_verified=true`. Full `server_verified` remains false until scoring/timing becomes server-authoritative.


## Automated Daily Challenge — implemented Step 5

Daily entities:

```text
daily_challenges
  1
  |
  10
daily_challenge_questions
```

A generator creates 10-question Daily Challenges from the published question bank using:
- 4 Easy / 4 Medium / 2 Hard;
- rotating topic templates;
- configurable 14-day question cooldown;
- deterministic selection within each slot;
- least-recently-used fallback when the pool is constrained.

`maintain_brainilab_daily_schedule()` keeps today + 14 future dates prepared.

The public frontend can fetch only the current published Daily through `get_brainilab_daily_challenge()`.

Completed authenticated/merged results are linked to the exact Daily and verified with `verify_brainilab_daily_result(...)`.

Home and `/daily-quiz/` now consume the same backend Daily instead of separate hardcoded question arrays.


## Player progression aggregates — implemented Step 6

Canonical cloud progression now uses:

```text
player_progression

player_daily_stats
player_period_stats
player_game_period_stats

player_personal_bests
```

A result INSERT/UPDATE triggers a deterministic rebuild for that player from `game_sessions + game_results`.

Daily habit rules:
- at least one of the four Daily Games = streak day;
- four of four = Full Daily;
- Daily Brain Score = best per-game contribution, 2,500 max each / 10,000 total.

`player_game_period_stats` pre-aggregates day/week/month game metrics and is the data foundation for future Individual/Friends/Groups ranking filters without scanning raw answer history on every request.


## All Daily Games — implemented Step 7

The single `daily_challenges` entity now owns all four Daily mechanics:

```text
daily_challenges
  ├── daily_challenge_questions       (Brain Mix ×10)
  ├── daily_brainiword                (×1 word)
  ├── daily_flag_dash_questions       (×30)
  └── daily_map_hunt_questions        (×10)
```

Reference pools:
- `brainiword_words`
- `daily_countries`
- `map_hunt_clues`

An AFTER INSERT trigger on `daily_challenges` generates the three additional Daily mechanics, so the existing Step 5 Cron automatically maintains all four games.

Flag Dash / Map Hunt option correctness and BrainiWord answers are not shipped as direct content fields in the initial page payload.

Final completed results are checked against the exact Daily assignment before aggregate progression refreshes.


## Real Friends — implemented Step 8

Social graph:

```text
friend_requests
      ↓ accepted
friendships
```

Friend lookup happens through stable `profiles.friend_code`; the browser never gets general profile-table search access.

Accepted-friend snapshots are returned through `get_my_brainilab_friends()` and combine:
- profile identity;
- `player_progression`;
- today's `player_daily_stats`;
- current week/month `player_period_stats`.

Friends Ranking is generated from the accepted friendship graph plus Step 6 aggregates. Email/auth metadata is never returned.


## Real Groups — implemented Step 9

Group social graph:

```text
groups
  ├── group_members       max 5
  └── group_invites
```

Ranking aggregates:

```text
group_daily_stats
group_period_stats
group_game_period_stats
```

Group scoring rule:

```text
sum(top 3 member scores)
```

Ranking eligibility:

```text
member_count >= 3
```

Group streak:

```text
consecutive UTC days with >=3 active Daily players
```

A post-result trigger runs after Step 6 progression refresh and rebuilds affected group aggregates.

Group tables are RPC-only for browser clients. Group membership exposes social/game identity only; auth email and provider metadata remain private.


## Final Rankings — implemented Step 10

Public Individual ranking eligibility:

```text
profiles.leaderboard_enabled = true
+ eligible selected-period score > 0
```

Public identity:

```text
leaderboard_display_name
country_code
derived avatar initial
```

No public email, friend code, auth metadata or internal user UUID is returned.

Score normalization:

```text
All games
  -> Daily Brain Score

Daily game selected
  -> normalized 0–2,500/day contribution

Evergreen game selected
  -> accumulated selected-period game score

Streak
  -> current Daily streak
```

Friends use the same normalized player scoring inside the accepted friendship graph.

Groups use:
```text
member_count >= 3
sum(top 3 member values)
```

Group per-game aggregates are rebuilt after player progression and membership changes.


## Admin / Backoffice — implemented Step 11

Authorization:

```text
Supabase Auth JWT
      ↓
admin_users
      ↓
require_brainilab_admin(...)
      ↓
controlled SECURITY DEFINER Admin RPC
      ↓
operational table / canonical BrainiLab data
      ↓
admin_audit_log on mutations
```

No `service_role` credential is shipped to the browser.

Admin roles:

```text
owner
editor
support
```

Optional `admin_users.require_mfa` makes Admin RPCs require an `aal2` Supabase JWT.

Operational tables:

```text
admin_users
admin_audit_log
suggestions
runtime_flags
admin_ranking_suspensions
verified_question_answers
```

Canonical product tables are not duplicated. Admin RPCs operate over the same question, Daily, result, progression, group and ranking data used by the public product.

Question-level analytics are recorded only after canonical answer verification and do not affect competitive scoring.


## Topic Rush — implemented Step 12

Current Daily slot 3:

```text
Topic Rush
60 seconds
free response
controlled server answer check
0–2,500 Daily points
```

Tables:

```text
topic_rush_settings
topic_rush_topics
topic_rush_answers
daily_topic_rush
```

Map Hunt tables/results remain historical only. On the migration date, an already-completed Map Hunt result can bridge the new Topic Rush Daily slot so progress is not lost. Future Map Hunt Daily rows are not generated.


## V27 UX progression presentation

Canonical progression remains:

```text
player_progression.xp
player_progression.level
```

V27 introduces no duplicate XP or level persistence.

The client presentation maps `level` to a Brain Rank badge/ring.

Step 13 adds `level` to Individual/Friends ranking JSON so those rows can render the same presentation tier.

Score terminology is now explicitly separated:

```text
Quiz Points
  evergreen/game score

XP
  cross-product progression

Daily Brain Score
  today's four Daily Games only
```

Historic Daily replay is deliberately not exposed until a non-competitive practice-mode result path exists.


## Order Up — Step 16

Current Daily mechanic slots:

```text
Brain Mix
Order Up
Topic Rush
BrainiWord
```

Order Up content:

```text
order_up_rounds
  ↓ 1:N
order_up_items
  sort_position = canonical order

daily_challenges
  ↓
daily_order_up_rounds
  exactly 2 round assignments
```

Public Daily payload returns shuffled item IDs/labels but not `sort_position`.

Scoring is pairwise ordering accuracy:

```text
10 items = 45 pairs
round score = correct pairs / 45 × 1,250
2 rounds = max 2,500
```

`player_daily_stats.orderup_points` becomes the fourth Daily contribution from `order_up_settings.launch_date` onward. Historical Flag Dash points remain stored but no longer occupy that slot after launch.


## Player Analytics — Step 17

Private aggregate flow:

```text
game_sessions
      +
game_results
      ↓
zz_game_results_refresh_analytics
      ↓
refresh_brainilab_player_analytics(user)
      ↓
player_analytics_daily
      ↓
get_my_brainilab_stats(range)
      ↓
My BrainiLab → My Stats
```

Aggregate grain:

```text
user_id
stat_date UTC
game_id
difficulty
```

`player_analytics_daily` has no authenticated browser table grant.

Detailed analytics are read through a SECURITY DEFINER RPC scoped internally to:

```text
auth.uid()
```

Category knowledge profile intentionally excludes mixed Daily mechanics because the current result schema does not persist authoritative per-question category references for those games.

Future question-level analytics can extend Step 17 when `game_answers` stores canonical `question_version_id` references.


## Question Quality — Step 19

Existing verified event stream:

```text
game result verified
        ↓
record_brainilab_verified_question_answers(...)
        ↓
verified_question_answers
        ↓
admin_question_quality_overview(...)
admin_question_analytics(...)
        ↓
Backoffice Question Quality
```

No player-facing scoring logic depends on the editorial quality classification.

Current sample thresholds:

```text
difficulty calibration  >= 30 verified attempts
distractor calibration  >= 50 verified attempts
```

Subcategories continue to use:

```text
tags
question_tags
```

rather than a second competing taxonomy model.


## Monetization — Step 20

BrainiLab+:

```text
user
 ↓
authenticated Edge Function
 ↓
Stripe Checkout
 ↓
signed Stripe webhook
 ↓
brainilab_subscriptions
 ↓
get_my_brainilab_entitlements()
 ↓
ads_free / Plus UI
```

Ads:

```text
runtime flags
 + public AdSense IDs
 + free-user entitlement
 + eligible placement
 ↓
lazy Ads Manager
 ↓
manual display slot
```

The browser has no direct write grant to billing/subscription/webhook tables.

`plus_enabled` controls new Plus sales.

It does not revoke an already-paid member's entitlement.

`ads_enabled` is a global kill switch; every manual placement also has its own independent flag.
