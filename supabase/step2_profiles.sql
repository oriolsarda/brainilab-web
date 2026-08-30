-- BrainiLab Backend — Step 2: profiles
-- Run this entire file once in Supabase SQL Editor.
--
-- Result:
--   auth.users (managed by Supabase Auth)
--          1
--          |
--          1
--   public.profiles (managed by BrainiLab)
--
-- Security:
-- - RLS enabled
-- - authenticated users can SELECT only their own profile
-- - authenticated users can UPDATE only safe editable columns on their own profile
-- - friend_code, user_id and timestamps cannot be changed from the browser

begin;

-- gen_random_uuid() is available in Supabase projects.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,

  display_name text not null,
  avatar_url text null,
  country_code varchar(2) null,

  friend_code text not null unique,

  leaderboard_enabled boolean not null default false,
  leaderboard_display_name text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 2 and 30),

  constraint profiles_country_code_format
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),

  constraint profiles_friend_code_format
    check (friend_code ~ '^BRN-[A-Z0-9]{8}$'),

  constraint profiles_leaderboard_name_length
    check (
      leaderboard_display_name is null
      or char_length(btrim(leaderboard_display_name)) between 2 and 30
    )
);

comment on table public.profiles is
  'Private BrainiLab player profile linked 1:1 to Supabase auth.users.';

comment on column public.profiles.friend_code is
  'Stable public-facing BrainiLab friend code. Not editable from the browser.';

-- Generate a short BrainiLab code. UUID entropy makes collision probability tiny;
-- the loop also checks the unique column before returning.
create or replace function public.generate_brainilab_friend_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := 'BRN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.profiles p
      where p.friend_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

-- This helper is server-internal; do not expose it as a public RPC.
revoke execute on function public.generate_brainilab_friend_code() from public, anon, authenticated;

-- Keep updated_at server-controlled.
create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_profile_updated_at();

-- Create one BrainiLab profile whenever Supabase Auth creates a user.
create or replace function public.handle_new_brainilab_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proposed_name text;
  proposed_country text;
begin
  proposed_name := btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(new.email, ''), '@', 1),
    'Braini Player'
  ));

  if char_length(proposed_name) < 2 then
    proposed_name := 'Braini Player';
  end if;

  proposed_name := left(proposed_name, 30);

  proposed_country := upper(nullif(btrim(
    coalesce(new.raw_user_meta_data ->> 'country_code', '')
  ), ''));

  if proposed_country !~ '^[A-Z]{2}$' then
    proposed_country := null;
  end if;

  insert into public.profiles (
    user_id,
    display_name,
    avatar_url,
    country_code,
    friend_code
  )
  values (
    new.id,
    proposed_name,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    proposed_country,
    public.generate_brainilab_friend_code()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_brainilab_profile on auth.users;
create trigger on_auth_user_created_create_brainilab_profile
after insert on auth.users
for each row
execute function public.handle_new_brainilab_user();

-- IMPORTANT: your Google account already exists because Step 1 was tested.
-- This backfills profiles for every existing auth.users row.
insert into public.profiles (
  user_id,
  display_name,
  avatar_url,
  country_code,
  friend_code
)
select
  u.id,
  left(
    case
      when char_length(btrim(coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        u.raw_user_meta_data ->> 'display_name',
        split_part(coalesce(u.email, ''), '@', 1),
        'Braini Player'
      ))) >= 2
      then btrim(coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        u.raw_user_meta_data ->> 'display_name',
        split_part(coalesce(u.email, ''), '@', 1),
        'Braini Player'
      ))
      else 'Braini Player'
    end,
    30
  ),
  nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
  case
    when upper(coalesce(u.raw_user_meta_data ->> 'country_code', '')) ~ '^[A-Z]{2}$'
      then upper(u.raw_user_meta_data ->> 'country_code')
    else null
  end,
  public.generate_brainilab_friend_code()
from auth.users u
where not exists (
  select 1 from public.profiles p where p.user_id = u.id
);

-- Row Level Security
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Browser permissions.
-- Start from a restrictive state.
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;

-- Users may edit only these fields.
grant update (
  display_name,
  avatar_url,
  country_code,
  leaderboard_enabled,
  leaderboard_display_name
) on table public.profiles to authenticated;

-- No browser INSERT grant is required:
-- the auth.users trigger creates the row server-side.

commit;

-- Verification queries (safe to run after the transaction):
--
-- select count(*) as auth_users from auth.users;
-- select count(*) as brainilab_profiles from public.profiles;
--
-- The two counts should match after this first migration.
--
-- To inspect without exposing passwords (Supabase never stores them here):
-- select
--   p.user_id,
--   p.display_name,
--   p.country_code,
--   p.friend_code,
--   p.created_at
-- from public.profiles p
-- order by p.created_at desc;
