# BrainiLab — Step 11: Admin / Backoffice V1

Run after Steps 1–10.

The Admin is an **operations console**, not a generic database browser.

Current local URL:

```text
http://localhost:8000/admin/
```

The Admin browser uses the same normal Supabase **publishable key** as BrainiLab. It never receives `service_role`.

## 1. Install the backend

Supabase:

```text
SQL Editor → New query
```

Run all of:

```text
BRAINILAB_STEP11_SQL_COPY_TO_SUPABASE.txt
```

The migration creates:

```text
admin_users
admin_audit_log
suggestions
runtime_flags
admin_ranking_suspensions
verified_question_answers
```

plus controlled Admin RPCs.

Direct `anon` / `authenticated` table access to these operational tables is revoked.

## 2. Bootstrap the first owner

There is deliberately **no browser bootstrap endpoint**.

Find your Supabase user:

```sql
select
  id,
  email,
  created_at
from auth.users
order by created_at;
```

Then replace the email:

```sql
insert into public.admin_users(
  user_id,
  role,
  active,
  require_mfa
)
select
  id,
  'owner',
  true,
  false
from auth.users
where lower(email)=lower('YOUR_EMAIL@example.com')
on conflict(user_id)
do update set
  role='owner',
  active=true;
```

Verify:

```sql
select
  user_id,
  role,
  active,
  require_mfa
from public.admin_users;
```

## 3. Allow the Admin OAuth redirect

In:

```text
Supabase
Authentication
URL Configuration
Redirect URLs
```

add:

```text
http://localhost:8000/admin/
```

Keep the existing Google OAuth callback:

```text
https://wvgcdlxebbybthyuajgb.supabase.co/auth/v1/callback
```

Google Cloud needs the **origin**, not the `/admin/` path:

```text
http://localhost:8000
```

For production, add the exact production Admin redirect URL when deployment is decided.

## 4. Run locally

In Terminal, from the V25 folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/admin/
```

Sign in with the Google account added to `admin_users`.

An authenticated normal BrainiLab user who is not in `admin_users` receives:

```text
Admin access required
```

The page displays their UUID only so the first owner can be bootstrapped from SQL Editor.

## 5. MFA / TOTP

The database supports per-admin MFA enforcement.

Initial owner:

```text
require_mfa = false
```

so the first login is possible.

Then go to:

```text
Admin → System → Enroll & require MFA
```

The Admin uses Supabase Auth TOTP:

```text
enroll factor
→ verify 6-digit code
→ JWT reaches AAL2
→ admin_enable_own_mfa_requirement()
→ require_mfa = true
```

After that, Admin RPCs reject that admin account unless its JWT is `aal2`.

If the factor is lost, recovery is intentionally a Supabase SQL/Auth administrative operation; there is no weak browser bypass.

## Roles

The schema supports:

```text
owner
editor
support
```

### owner

Can operate all V1 Admin areas, including:

```text
runtime kill switches
ranking moderation
content
Daily operations
MFA enforcement
```

### editor

Can operate:

```text
Daily
Question Bank
Quiz Packs
Content Pools
Results
Rankings inspection
System inspection
Audit
```

### support

Can inspect:

```text
Dashboard
Results
Users
Groups
Suggestions
Audit
```

Admin V1 does not contain a browser UI to grant new admin accounts. That remains an intentional SQL-owner operation for now, reducing privilege-management attack surface.

## Daily safety

Admin can inspect any generated Daily.

Admin V1 may regenerate **future dates only**.

It deliberately does not regenerate today/past because BrainiLab is guest-first and the backend cannot know every anonymous/local player who may already have seen that content.

For a serious problem affecting today, use:

```text
System → Emergency feature flags
```

to temporarily disable the affected game instead of changing content under players.

Daily Health checks:

```text
Brain Mix       10 questions
difficulty      4 Easy / 4 Medium / 2 Hard
Flag Dash       30 rounds
Map Hunt        10 clues
BrainiWord      1 word
```

The Admin can also call the same public initial payload RPCs used by players and scan them for forbidden answer/secret fields.

## Question Bank

Admin can:

```text
search
filter
create
edit draft/review
publish
inspect usage
inspect verified analytics
```

Published versions are read-only in Admin V1.

That is intentional: historical published content should not be silently mutated after players have consumed it.

A published question requires:

```text
valid topic
easy / medium / hard
exactly 4 options
4 unique option texts
exactly 1 correct option
explanation
```

## CSV import

Template:

```text
/admin/brainilab_questions_template.csv
```

Columns:

```text
external_key
topic_slug
difficulty
prompt
option_a
option_b
option_c
option_d
correct_option
explanation
tags
source_url
```

`correct_option` may be:

```text
A / B / C / D
```

or:

```text
1 / 2 / 3 / 4
```

Tags use:

```text
capitals|asia|geography
```

Import flow:

```text
CSV
→ browser parser
→ Admin preview RPC
→ duplicate / schema checks
→ only valid rows selectable for import
→ Draft or Published
```

Maximum:

```text
500 rows per import
```

## Quiz Packs

Question upload and evergreen quiz packs are intentionally separate.

New questions do **not** silently rewrite an existing finite quiz.

Admin can generate a new version of an already-visible set:

```text
Science · Easy · Set 1
v1 published
↓
generate v2 draft
↓
review 20 questions
↓
replace individual draft questions if needed
↓
publish v2
```

Public quiz loading already chooses the newest published version for the same:

```text
topic
difficulty
set number
```

Admin V1 does not create brand-new set numbers because the public category pages do not yet automatically surface new sets. This prevents creating invisible content.

## Content Pools

### BrainiWord

Admin can:

```text
add 5-letter words
enable / disable
see last-used date
```

PostgreSQL prevents reducing the active pool below:

```text
61
```

to protect the 60-day reuse window.

### Map Hunt

Admin can:

```text
add clue
choose country
enable / disable
see last-used date
```

The active pool cannot drop below:

```text
10
```

### Countries

Admin can enable/disable future Daily country use.

Flag Dash protection:

```text
minimum 30 active countries
```

## Results & Answers

Admin can filter cloud results by:

```text
player / friend code
game
date
verified / unverified
```

Result detail includes:

```text
session
score
correct / total
duration
answers_verified
server_verified
result_payload
base answer events
verified question-level events
```

`server_verified=false` remains visible and is not disguised.

## Question analytics

Step 11 adds:

```text
verified_question_answers
```

After canonical answer verification, the frontend makes a second non-competitive analytics write.

For Brain Mix / evergreen multiple-choice questions this can provide:

```text
attempts
accuracy
option distribution
average response time
```

This analytics table does **not** determine scores or rankings.

Historical games completed before Step 11 may not have these question-level events.

## Users

Admin Users works from:

```text
profiles
player_progression
player_daily_stats
game results
friend/group counts
```

It intentionally does **not** expose `auth.users` or emails in normal browser Admin.

Admin cannot manually edit:

```text
XP
streak
score
Daily Brain Score
```

Those remain derived from game results.

## Ranking moderation

Owner can suspend:

```text
user
group
```

from public ranking surfaces.

Suspension does not change:

```text
score
XP
streak
game history
account access
```

The reason is internal and audited.

There is no `Set score` control.

## Groups

Admin can inspect:

```text
group
owner
country
members
roles
ranking suspension
```

Admin V1 intentionally does not provide normal friendship-network browsing or arbitrary membership editing.

## Suggestions

The public Suggestions form now writes to Supabase through:

```text
submit_brainilab_suggestion(...)
```

Admin can mark:

```text
new
reviewing
planned
done
ignored
```

and store an internal note.

Optional reply email is visible only inside the protected Admin inbox.

A lightweight 5/hour user/client guard exists. Production abuse protection should additionally be enforced at the edge/CDN if necessary.

## System Health

Admin displays:

```text
backend table presence
Daily lookahead
Daily cooldown
latest generated date
future ready days
active BrainiWord pool
active Map Hunt pool
active country pool
pg_cron job
pg_cron last run status/time
runtime flags
current Admin AAL/MFA status
```

## Emergency runtime flags

Owner-only:

```text
brainmix_enabled
flagdash_enabled
maphunt_enabled
brainiword_enabled
rankings_enabled
groups_enabled
maintenance_enabled
```

These are kill switches, not a generic settings CMS.

Public pages fetch them through a safe read-only RPC.

Disabling a feature does not delete content or progress.

## Audit log

Mutating Admin RPCs record server-side events such as:

```text
QUESTION_CREATED
QUESTION_PUBLISHED
QUESTION_IMPORT_COMPLETED
QUIZ_PACK_GENERATED
QUIZ_PACK_QUESTION_REPLACED
QUIZ_PACK_PUBLISHED
DAILY_REGENERATED
RUNTIME_FLAG_UPDATED
RANKING_ENTITY_SUSPENDED
SUGGESTION_UPDATED
ADMIN_MFA_REQUIREMENT_ENABLED
```

Browser roles have no direct write/delete permission to `admin_audit_log`.

## What Admin V1 deliberately does NOT do

No:

```text
SQL editor
generic table explorer
service_role in browser
manual XP/score/streak editing
user impersonation
global friendship explorer
arbitrary Cron editor
Home/About page builder
asset/image uploads
account email browser
user deletion
automatic bans
cash-prize anti-cheat adjudication
```

These omissions reduce security surface and maintenance cost.

## Production deployment

The current V25 static build uses:

```text
/admin/
```

Authorization is server-side, so the URL is not the security boundary.

For the final production deployment, a dedicated Admin origin such as:

```text
admin.brainilab.com
```

is preferable because it isolates browser origin/session/storage and allows stricter HTTP headers.

At deployment level set real response headers, especially:

```text
Content-Security-Policy
frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy
Strict-Transport-Security
```

The HTML already uses `noindex,nofollow`, but `noindex` is SEO—not authentication.

## Verify Step 11

Tables:

```sql
select
  to_regclass('public.admin_users') as admin_users,
  to_regclass('public.admin_audit_log') as audit,
  to_regclass('public.suggestions') as suggestions,
  to_regclass('public.runtime_flags') as runtime_flags,
  to_regclass('public.verified_question_answers') as answer_analytics;
```

All should be non-null.

Admin RPCs:

```sql
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name like 'admin_%'
order by routine_name;
```

Runtime public RPCs:

```sql
select
  to_regprocedure('public.get_brainilab_runtime_flags()') as runtime_flags_rpc,
  to_regprocedure(
    'public.submit_brainilab_suggestion(text,text,text,text)'
  ) as suggestion_rpc;
```
