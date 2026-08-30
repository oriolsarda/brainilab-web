-- BrainiLab Backend — Step 14: profile avatar uploads
-- Run after Step 13.
--
-- Purpose:
-- - one public avatar object per authenticated BrainiLab user
-- - browser uploads are restricted to the authenticated user's own folder
-- - no service-role credential is used in the browser
-- - profiles.avatar_url already exists from Step 2
--
-- Public read is intentional: profile photos can appear in BrainiLab social
-- and ranking surfaces. Write/delete access remains private per user.

begin;

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values(
  'brainilab-avatars',
  'brainilab-avatars',
  true,
  2097152,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict(id)
do update set
  public=true,
  file_size_limit=2097152,
  allowed_mime_types=array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

drop policy if exists "brainilab_avatars_public_read"
  on storage.objects;

create policy "brainilab_avatars_public_read"
on storage.objects
for select
to public
using(
  bucket_id='brainilab-avatars'
);

drop policy if exists "brainilab_avatars_insert_own"
  on storage.objects;

create policy "brainilab_avatars_insert_own"
on storage.objects
for insert
to authenticated
with check(
  bucket_id='brainilab-avatars'
  and name=((select auth.uid())::text||'/avatar.jpg')
);

drop policy if exists "brainilab_avatars_update_own"
  on storage.objects;

create policy "brainilab_avatars_update_own"
on storage.objects
for update
to authenticated
using(
  bucket_id='brainilab-avatars'
  and name=((select auth.uid())::text||'/avatar.jpg')
)
with check(
  bucket_id='brainilab-avatars'
  and name=((select auth.uid())::text||'/avatar.jpg')
);

drop policy if exists "brainilab_avatars_delete_own"
  on storage.objects;

create policy "brainilab_avatars_delete_own"
on storage.objects
for delete
to authenticated
using(
  bucket_id='brainilab-avatars'
  and name=((select auth.uid())::text||'/avatar.jpg')
);

commit;

-- Verify:
--
-- select
--   id,
--   public,
--   file_size_limit,
--   allowed_mime_types
-- from storage.buckets
-- where id='brainilab-avatars';
--
-- Expected:
-- public = true
-- file_size_limit = 2097152
