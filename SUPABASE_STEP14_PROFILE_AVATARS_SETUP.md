# BrainiLab — Step 14: Profile Avatar Uploads

Run after the existing profile backend.

V28 allows an authenticated BrainiLab user to upload a custom profile photo from:

```text
My BrainiLab
→ Edit Profile
→ Profile photo
```

## Storage design

Bucket:

```text
brainilab-avatars
```

The avatar object path is always:

```text
<auth-user-uuid>/avatar.jpg
```

There is intentionally only **one writable object per user**.

The browser cannot use the bucket as generic file storage.

## Security

The browser still uses only the normal Supabase publishable key.

Storage policies enforce:

```text
authenticated user
        ↓
auth.uid()
        ↓
may INSERT / UPDATE / DELETE only
<their uid>/avatar.jpg
```

Other users cannot overwrite or delete that object.

The bucket is public-read because profile photos are social identity assets that may appear in BrainiLab interfaces.

Public-read does **not** grant public write access.

No service-role key is added to the website.

## Image processing

The browser accepts:

```text
JPG
PNG
WebP
```

Maximum source upload selected in the UI:

```text
8 MB
```

Before upload BrainiLab:

```text
center-crops square
↓
resizes to 512 × 512
↓
converts to JPEG
↓
uploads avatar.jpg
```

Storage itself also enforces:

```text
2 MB maximum object size
```

## Install

Supabase:

```text
SQL Editor
→ New query
```

Run:

```text
BRAINILAB_STEP14_SQL_COPY_TO_SUPABASE.txt
```

No new Cron is required.

`profiles.avatar_url` already exists from Step 2, so there is no profile-table migration.

## Verify

```sql
select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id='brainilab-avatars';
```

Expected:

```text
id              brainilab-avatars
public          true
file_size_limit 2097152
```

Then test:

```text
My BrainiLab
→ Edit Profile
→ Upload photo
```

The photo should update:

```text
header avatar
account menu
Edit Profile
```

and persist after refresh.

## Privacy note

V28 does not automatically add custom photos to the public Global Individual Ranking payload.

The existing public-ranking privacy contract remains conservative:

```text
public ranking name
country
rank/score
level/rank ring
```

Friends/social contexts can continue to use profile avatars where their existing controlled RPCs expose them.
