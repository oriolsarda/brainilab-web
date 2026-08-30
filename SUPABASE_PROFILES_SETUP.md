# BrainiLab — Step 2: PostgreSQL `profiles`

Step 1 proved that Google OAuth + Supabase Auth works.

Step 2 creates the first BrainiLab-owned database row for each authenticated user.

## What this step stores in PostgreSQL

`public.profiles`

- `user_id` — same UUID as `auth.users.id`
- `display_name`
- `avatar_url`
- `country_code`
- `friend_code`
- `leaderboard_enabled`
- `leaderboard_display_name`
- `created_at`
- `updated_at`

Email/password/Google identity remain managed by Supabase Auth in `auth.users`.

Game results, streaks and Daily Brain Score are **not** moved to PostgreSQL yet.

---

## Run the migration

In Supabase:

1. Open your BrainiLab project.
2. Go to **SQL Editor**.
3. Click **New query**.
4. Open this file from the BrainiLab package:

   `supabase/step2_profiles.sql`

5. Copy the entire file into the SQL Editor.
6. Click **Run**.

It is designed to be run as one transaction.

## Why it also works for your existing Google account

Your Google user already exists from the Step 1 test.

The migration contains a backfill:

- it reads existing rows from `auth.users`;
- creates a corresponding `public.profiles` row;
- generates a unique BrainiLab friend code.

So you do not need to delete or recreate your Google account.

---

## Verify the database

After the SQL finishes, run:

```sql
select
  p.user_id,
  p.display_name,
  p.country_code,
  p.friend_code,
  p.created_at
from public.profiles p
order by p.created_at desc;
```

You should see your BrainiLab profile.

The friend code will look like:

```text
BRN-4C81A2F9
```

Then reload:

```text
http://localhost:8000/profile/index.html
```

My BrainiLab should change from:

`⚙ Profile setup needed`

to:

`☁ Profile synced`

The Friend code shown in the website should now be the same value stored in PostgreSQL.

---

## RLS security

Row Level Security is enabled.

An authenticated browser can:

- SELECT its own profile only;
- UPDATE its own profile only.

The browser cannot update:

- `user_id`
- `friend_code`
- `created_at`
- `updated_at`

Editable browser fields are limited to:

- display name
- avatar URL
- country
- leaderboard visibility/name

An unauthenticated user receives no access to `profiles`.

This is enforced by PostgreSQL, not by JavaScript.

---

## Automatic profile creation

A database trigger is installed on:

`auth.users`

Every new Google/email BrainiLab account automatically creates one `public.profiles` row.

The relationship is:

```text
auth.users.id
     │
     │ 1 : 1
     ▼
profiles.user_id
```

Deleting the Auth user cascades and deletes its profile.

---

## Friend codes

Friend codes are generated server-side:

```text
BRN-XXXXXXXX
```

They have a UNIQUE constraint.

The frontend can read a user's own code but cannot modify it.

Later, when Friends becomes real, we will not expose the whole `profiles` table to arbitrary users. Friend-code lookup will go through a controlled database function/API.

---

## Country

For this backend step the profile UI accepts an ISO-style 2-letter code:

```text
ES
US
GB
FR
DE
```

The database validates the format.

Later the UI can replace this with a proper country dropdown without changing the database design.

---

## Files added

- `supabase/step2_profiles.sql`
- `assets/js/supabase-profile.js`
- `SUPABASE_PROFILES_SETUP.md`

Updated:

- `assets/js/data.js`
- `assets/js/auth.js`
- all normal pages now load the Supabase profile adapter

---

## What is real after Step 2

Stored in Supabase:

```text
ACCOUNT
✓ Auth user
✓ Google/email identity
✓ Session
✓ Display name
✓ Avatar URL
✓ Country
✓ Friend code
✓ Ranking visibility preference
```

Still local:

```text
GAME DATA
- streak
- XP
- game results
- answers
- Daily Brain Score
- personal bests
- friends
- groups
```

The next backend step should create the gameplay identity/data foundation so the guest history can be migrated into the authenticated account.
