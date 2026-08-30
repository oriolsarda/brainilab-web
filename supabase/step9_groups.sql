-- BrainiLab Backend — Step 9: Real Groups + Group Rankings
-- Run after Steps 1–8.
--
-- Product rules:
-- - a group has 1–5 active members
-- - one owner; roles are owner / admin / member
-- - name + country + controlled BrainiLab crest
-- - direct friend invitations + shareable invite link
-- - at least 3 members required to enter Group Rankings
-- - Group Score = sum of the 3 best member scores for the selected period
-- - Group Streak = consecutive UTC days with at least 3 active members
-- - global and country rankings
-- - daily / weekly / monthly and per-game aggregates
--
-- All browser writes happen through SECURITY DEFINER RPCs.
-- Direct group table access is not granted to anon/authenticated.

begin;

create extension if not exists pgcrypto;


-- ============================================================
-- GROUPS
-- ============================================================

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null
    references auth.users(id) on delete cascade,

  name text not null,
  country_code varchar(2) not null,

  crest_icon text not null default '⚡',
  crest_color text not null default '#FFD813',

  invite_code text not null unique,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint groups_name_length
    check (char_length(btrim(name)) between 2 and 28),

  constraint groups_country_code
    check (country_code ~ '^[A-Z]{2}$'),

  constraint groups_crest_icon
    check (crest_icon in ('⚡','🧠','🌍','🚩','🏆','💡','🧩','⭐')),

  constraint groups_crest_color
    check (crest_color in (
      '#FFD813',
      '#40AB34',
      '#E52720',
      '#E6680C',
      '#2D296E'
    )),

  constraint groups_status
    check (status in ('active','deleted')),

  constraint groups_invite_code
    check (invite_code ~ '^GRP-[A-Z0-9]{8}$')
);

create index if not exists groups_country_status_idx
  on public.groups(country_code,status);

create index if not exists groups_owner_idx
  on public.groups(owner_id,status);


create table if not exists public.group_members (
  group_id uuid not null
    references public.groups(id) on delete cascade,

  user_id uuid not null
    references auth.users(id) on delete cascade,

  role text not null default 'member',

  joined_at timestamptz not null default now(),

  primary key(group_id,user_id),

  constraint group_members_role
    check (role in ('owner','admin','member'))
);

create index if not exists group_members_user_idx
  on public.group_members(user_id,joined_at desc);


create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),

  group_id uuid not null
    references public.groups(id) on delete cascade,

  inviter_id uuid not null
    references auth.users(id) on delete cascade,

  target_user_id uuid null
    references auth.users(id) on delete cascade,

  source text not null default 'friend',

  status text not null default 'pending',

  created_at timestamptz not null default now(),
  responded_at timestamptz null,

  constraint group_invites_source
    check (source in ('friend','invite_link')),

  constraint group_invites_status
    check (status in ('pending','accepted','declined','cancelled'))
);

create unique index if not exists group_invites_one_pending_target_idx
  on public.group_invites(group_id,target_user_id)
  where target_user_id is not null
    and status='pending';

create index if not exists group_invites_target_pending_idx
  on public.group_invites(target_user_id,created_at desc)
  where status='pending';

create index if not exists group_invites_group_pending_idx
  on public.group_invites(group_id,created_at desc)
  where status='pending';


-- ============================================================
-- GROUP AGGREGATES
-- ============================================================

create table if not exists public.group_daily_stats (
  group_id uuid not null
    references public.groups(id) on delete cascade,

  stat_date date not null,

  member_count integer not null default 0,
  active_members integer not null default 0,

  group_score bigint not null default 0,

  eligible boolean not null default false,

  top_contributors jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),

  primary key(group_id,stat_date),

  constraint group_daily_counts
    check (
      member_count between 0 and 5
      and active_members between 0 and 5
    ),

  constraint group_daily_score_nonnegative
    check (group_score >= 0)
);

create index if not exists group_daily_rank_idx
  on public.group_daily_stats(stat_date,eligible,group_score desc);


create table if not exists public.group_period_stats (
  group_id uuid not null
    references public.groups(id) on delete cascade,

  period_type text not null,
  period_start date not null,

  member_count integer not null default 0,
  active_members integer not null default 0,

  group_score bigint not null default 0,

  eligible boolean not null default false,

  top_contributors jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),

  primary key(group_id,period_type,period_start),

  constraint group_period_type
    check (period_type in ('week','month')),

  constraint group_period_counts
    check (
      member_count between 0 and 5
      and active_members between 0 and 5
    ),

  constraint group_period_score_nonnegative
    check (group_score >= 0)
);

create index if not exists group_period_rank_idx
  on public.group_period_stats(
    period_type,
    period_start,
    eligible,
    group_score desc
  );


create table if not exists public.group_game_period_stats (
  group_id uuid not null
    references public.groups(id) on delete cascade,

  game_id text not null,
  period_type text not null,
  period_start date not null,

  member_count integer not null default 0,
  active_members integer not null default 0,

  group_score bigint not null default 0,

  eligible boolean not null default false,

  top_contributors jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),

  primary key(group_id,game_id,period_type,period_start),

  constraint group_game_period_type
    check (period_type in ('day','week','month')),

  constraint group_game_period_counts
    check (
      member_count between 0 and 5
      and active_members between 0 and 5
    ),

  constraint group_game_period_score_nonnegative
    check (group_score >= 0)
);

create index if not exists group_game_period_rank_idx
  on public.group_game_period_stats(
    game_id,
    period_type,
    period_start,
    eligible,
    group_score desc
  );


-- ============================================================
-- INVITE CODE + TIMESTAMPS
-- ============================================================

create or replace function public.generate_brainilab_group_invite_code()
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_code text;
begin
  loop
    v_code:='GRP-' || upper(
      substr(replace(gen_random_uuid()::text,'-',''),1,8)
    );

    exit when not exists(
      select 1
      from public.groups g
      where g.invite_code=v_code
    );
  end loop;

  return v_code;
end;
$$;

revoke execute on function public.generate_brainilab_group_invite_code()
  from public,anon,authenticated;


create or replace function public.set_brainilab_group_updated_at()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.updated_at:=now();
  return new;
end;
$$;

drop trigger if exists groups_set_updated_at
  on public.groups;

create trigger groups_set_updated_at
before update on public.groups
for each row
execute function public.set_brainilab_group_updated_at();


-- ============================================================
-- MAX 5 + ROLE INTEGRITY
-- ============================================================

create or replace function public.enforce_brainilab_group_member_limit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer;
  v_owner uuid;
begin
  select owner_id
    into v_owner
  from public.groups
  where id=new.group_id
    and status='active'
  for update;

  if v_owner is null then
    raise exception 'Group is not available';
  end if;

  if new.user_id=v_owner then
    new.role:='owner';
  elsif new.role='owner' then
    raise exception 'Only the group owner can have owner role';
  end if;

  select count(*)::integer
    into v_count
  from public.group_members
  where group_id=new.group_id;

  if tg_op='INSERT' and v_count>=5 then
    raise exception 'This group already has 5 members';
  end if;

  return new;
end;
$$;

drop trigger if exists group_members_limit
  on public.group_members;

create trigger group_members_limit
before insert or update on public.group_members
for each row
execute function public.enforce_brainilab_group_member_limit();


create or replace function public.handle_brainilab_group_owner_member()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.group_members(
    group_id,
    user_id,
    role
  )
  values(
    new.id,
    new.owner_id,
    'owner'
  )
  on conflict(group_id,user_id)
  do update set role='owner';

  return new;
end;
$$;

drop trigger if exists groups_create_owner_member
  on public.groups;

create trigger groups_create_owner_member
after insert on public.groups
for each row
execute function public.handle_brainilab_group_owner_member();


-- ============================================================
-- GROUP STAT REFRESH
-- Group Score = top 3 member scores.
-- ============================================================

create or replace function public.refresh_brainilab_group_stats(
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_group_id is null then
    return;
  end if;

  -- ----------------------------------------------------------
  -- All-game Daily.
  -- ----------------------------------------------------------

  delete from public.group_daily_stats
  where group_id=p_group_id;

  insert into public.group_daily_stats(
    group_id,
    stat_date,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  dates as (
    select distinct ds.stat_date
    from public.player_daily_stats ds
    join members m on m.user_id=ds.user_id
  ),
  ranked as (
    select
      d.stat_date,
      m.user_id,
      p.display_name,
      coalesce(ds.daily_brain_score,0)::bigint as score,

      row_number() over(
        partition by d.stat_date
        order by
          coalesce(ds.daily_brain_score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by d.stat_date
      )::integer as member_count,

      count(*) filter(
        where coalesce(ds.daily_games_completed,0)>0
      ) over(
        partition by d.stat_date
      )::integer as active_members

    from dates d
    cross join members m
    join public.profiles p
      on p.user_id=m.user_id
    left join public.player_daily_stats ds
      on ds.user_id=m.user_id
     and ds.stat_date=d.stat_date
  )
  select
    p_group_id,
    r.stat_date,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()
  from ranked r
  group by r.stat_date;


  -- ----------------------------------------------------------
  -- All-game Week / Month.
  -- ----------------------------------------------------------

  delete from public.group_period_stats
  where group_id=p_group_id;

  insert into public.group_period_stats(
    group_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  periods as (
    select distinct
      ps.period_type,
      ps.period_start
    from public.player_period_stats ps
    join members m on m.user_id=ps.user_id
  ),
  ranked as (
    select
      periods.period_type,
      periods.period_start,
      m.user_id,
      p.display_name,
      coalesce(ps.daily_brain_score,0)::bigint as score,

      row_number() over(
        partition by periods.period_type,periods.period_start
        order by
          coalesce(ps.daily_brain_score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by periods.period_type,periods.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(ps.active_days,0)>0
      ) over(
        partition by periods.period_type,periods.period_start
      )::integer as active_members

    from periods
    cross join members m
    join public.profiles p
      on p.user_id=m.user_id
    left join public.player_period_stats ps
      on ps.user_id=m.user_id
     and ps.period_type=periods.period_type
     and ps.period_start=periods.period_start
  )
  select
    p_group_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()
  from ranked r
  group by r.period_type,r.period_start;


  -- ----------------------------------------------------------
  -- Per-game Day / Week / Month.
  --
  -- BrainiWord uses its BrainiLab Daily contribution points rather than
  -- raw attempt counts, so "higher is better" remains consistent.
  -- ----------------------------------------------------------

  delete from public.group_game_period_stats
  where group_id=p_group_id;

  insert into public.group_game_period_stats(
    group_id,
    game_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  periods as (
    select distinct
      gps.game_id,
      gps.period_type,
      gps.period_start
    from public.player_game_period_stats gps
    join members m on m.user_id=gps.user_id
  ),
  ranked as (
    select
      periods.game_id,
      periods.period_type,
      periods.period_start,
      m.user_id,
      p.display_name,

      case
        when periods.game_id='brainiword'
          then coalesce(gps.best_daily_points,0)::bigint
        else coalesce(gps.total_score,0)::bigint
      end as score,

      row_number() over(
        partition by
          periods.game_id,
          periods.period_type,
          periods.period_start
        order by
          case
            when periods.game_id='brainiword'
              then coalesce(gps.best_daily_points,0)
            else coalesce(gps.total_score,0)
          end desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          periods.game_id,
          periods.period_type,
          periods.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(gps.games_played,0)>0
      ) over(
        partition by
          periods.game_id,
          periods.period_type,
          periods.period_start
      )::integer as active_members

    from periods
    cross join members m
    join public.profiles p
      on p.user_id=m.user_id
    left join public.player_game_period_stats gps
      on gps.user_id=m.user_id
     and gps.game_id=periods.game_id
     and gps.period_type=periods.period_type
     and gps.period_start=periods.period_start
  )
  select
    p_group_id,
    r.game_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()
  from ranked r
  group by
    r.game_id,
    r.period_type,
    r.period_start;
end;
$$;

revoke execute on function public.refresh_brainilab_group_stats(uuid)
  from public,anon,authenticated;


-- ============================================================
-- GROUP STREAK
-- A group streak day requires >=3 members to have played a Daily Game.
-- ============================================================

create or replace function public.brainilab_group_current_streak(
  p_group_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_today date:=(now() at time zone 'UTC')::date;
  v_last date;
  v_prev date:=null;
  v_day record;
  v_streak integer:=0;
begin
  select max(gds.stat_date)
    into v_last
  from public.group_daily_stats gds
  where gds.group_id=p_group_id
    and gds.eligible=true
    and gds.active_members>=3;

  if v_last is null or v_last < v_today-1 then
    return 0;
  end if;

  for v_day in
    select gds.stat_date
    from public.group_daily_stats gds
    where gds.group_id=p_group_id
      and gds.eligible=true
      and gds.active_members>=3
      and gds.stat_date<=v_last
    order by gds.stat_date desc
  loop
    if v_prev is null or v_day.stat_date=v_prev-1 then
      v_streak:=v_streak+1;
      v_prev:=v_day.stat_date;
    else
      exit;
    end if;
  end loop;

  return v_streak;
end;
$$;

revoke execute on function public.brainilab_group_current_streak(uuid)
  from public,anon,authenticated;


-- ============================================================
-- REFRESH WHEN MEMBERSHIP CHANGES
-- ============================================================

create or replace function public.handle_brainilab_group_membership_stats()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_group_id uuid;
begin
  if tg_op='DELETE' then
    v_group_id:=old.group_id;
  else
    v_group_id:=new.group_id;
  end if;

  perform public.refresh_brainilab_group_stats(v_group_id);

  if tg_op='DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists group_members_refresh_stats
  on public.group_members;

create trigger group_members_refresh_stats
after insert or update or delete on public.group_members
for each row
execute function public.handle_brainilab_group_membership_stats();


-- Step 6 refreshes player aggregates first. PostgreSQL fires same-kind triggers
-- in name order, so the zz_ prefix intentionally runs this after
-- game_results_refresh_progression.
create or replace function public.handle_brainilab_result_group_stats()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_group record;
begin
  for v_group in
    select gm.group_id
    from public.group_members gm
    where gm.user_id=new.user_id
  loop
    perform public.refresh_brainilab_group_stats(v_group.group_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists zz_game_results_refresh_groups
  on public.game_results;

create trigger zz_game_results_refresh_groups
after insert or update on public.game_results
for each row
execute function public.handle_brainilab_result_group_stats();


-- ============================================================
-- ROLE CHECK
-- ============================================================

create or replace function public.brainilab_group_role(
  p_group_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select gm.role
  from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where gm.group_id=p_group_id
    and gm.user_id=p_user_id
    and g.status='active';
$$;

revoke execute on function public.brainilab_group_role(uuid,uuid)
  from public,anon,authenticated;


-- ============================================================
-- CREATE / UPDATE
-- ============================================================

create or replace function public.create_brainilab_group(
  p_name text,
  p_country_code text,
  p_crest_icon text default '⚡',
  p_crest_color text default '#FFD813',
  p_friend_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_group_id uuid;
  v_code text;
  v_friend uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_country text:=upper(btrim(coalesce(p_country_code,'')));
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_name) not between 2 and 28 then
    raise exception 'Group name must be 2–28 characters';
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'Choose a valid two-letter country code';
  end if;

  if p_crest_icon not in ('⚡','🧠','🌍','🚩','🏆','💡','🧩','⭐') then
    raise exception 'Invalid group crest icon';
  end if;

  if p_crest_color not in (
    '#FFD813','#40AB34','#E52720','#E6680C','#2D296E'
  ) then
    raise exception 'Invalid group crest colour';
  end if;

  if cardinality(coalesce(p_friend_ids,'{}'::uuid[]))>4 then
    raise exception 'A group can invite at most 4 friends at creation';
  end if;

  v_code:=public.generate_brainilab_group_invite_code();

  insert into public.groups(
    owner_id,
    name,
    country_code,
    crest_icon,
    crest_color,
    invite_code
  )
  values(
    v_me,
    v_name,
    v_country,
    p_crest_icon,
    p_crest_color,
    v_code
  )
  returning id into v_group_id;

  foreach v_friend in array coalesce(p_friend_ids,'{}'::uuid[])
  loop
    if v_friend=v_me then
      continue;
    end if;

    if not public.brainilab_are_friends(v_me,v_friend) then
      raise exception 'Only accepted friends can receive direct group invitations';
    end if;

    insert into public.group_invites(
      group_id,
      inviter_id,
      target_user_id,
      source,
      status
    )
    values(
      v_group_id,
      v_me,
      v_friend,
      'friend',
      'pending'
    )
    on conflict do nothing;
  end loop;

  perform public.refresh_brainilab_group_stats(v_group_id);

  return jsonb_build_object(
    'group_id',v_group_id,
    'invite_code',v_code,
    'status','created'
  );
end;
$$;

revoke execute on function public.create_brainilab_group(
  text,text,text,text,uuid[]
) from public,anon;

grant execute on function public.create_brainilab_group(
  text,text,text,text,uuid[]
) to authenticated;


create or replace function public.update_brainilab_group(
  p_group_id uuid,
  p_name text,
  p_country_code text,
  p_crest_icon text,
  p_crest_color text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_name text:=btrim(coalesce(p_name,''));
  v_country text:=upper(btrim(coalesce(p_country_code,'')));
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if public.brainilab_group_role(p_group_id,v_me) is distinct from 'owner' then
    raise exception 'Only the group owner can edit group identity';
  end if;

  if char_length(v_name) not between 2 and 28 then
    raise exception 'Group name must be 2–28 characters';
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'Choose a valid two-letter country code';
  end if;

  update public.groups
  set
    name=v_name,
    country_code=v_country,
    crest_icon=p_crest_icon,
    crest_color=p_crest_color
  where id=p_group_id
    and status='active';
end;
$$;

revoke execute on function public.update_brainilab_group(
  uuid,text,text,text,text
) from public,anon;

grant execute on function public.update_brainilab_group(
  uuid,text,text,text,text
) to authenticated;


-- ============================================================
-- DIRECT FRIEND INVITATIONS
-- ============================================================

create or replace function public.invite_brainilab_friend_to_group(
  p_group_id uuid,
  p_friend_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_role text;
  v_members integer;
  v_pending integer;
  v_invite_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  v_role:=public.brainilab_group_role(p_group_id,v_me);

  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Only group owners/admins can invite members';
  end if;

  if p_friend_user_id=v_me then
    raise exception 'You are already in this group';
  end if;

  if not public.brainilab_are_friends(v_me,p_friend_user_id) then
    raise exception 'You can directly invite accepted friends only';
  end if;

  if exists(
    select 1
    from public.group_members gm
    where gm.group_id=p_group_id
      and gm.user_id=p_friend_user_id
  ) then
    return jsonb_build_object('status','already_member');
  end if;

  if exists(
    select 1
    from public.group_invites gi
    where gi.group_id=p_group_id
      and gi.target_user_id=p_friend_user_id
      and gi.status='pending'
  ) then
    return jsonb_build_object('status','already_pending');
  end if;

  select count(*)::integer
    into v_members
  from public.group_members
  where group_id=p_group_id;

  select count(*)::integer
    into v_pending
  from public.group_invites
  where group_id=p_group_id
    and status='pending'
    and target_user_id is not null;

  if v_members+v_pending>=5 then
    raise exception 'This group already has enough members/invitations to fill all 5 places';
  end if;

  insert into public.group_invites(
    group_id,
    inviter_id,
    target_user_id,
    source,
    status
  )
  values(
    p_group_id,
    v_me,
    p_friend_user_id,
    'friend',
    'pending'
  )
  returning id into v_invite_id;

  return jsonb_build_object(
    'status','pending',
    'invite_id',v_invite_id
  );
end;
$$;

revoke execute on function public.invite_brainilab_friend_to_group(uuid,uuid)
  from public,anon;

grant execute on function public.invite_brainilab_friend_to_group(uuid,uuid)
  to authenticated;


-- ============================================================
-- ACCEPT / DECLINE / CANCEL INVITES
-- ============================================================

create or replace function public.accept_brainilab_group_invite(
  p_invite_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_group_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select gi.group_id
    into v_group_id
  from public.group_invites gi
  join public.groups g on g.id=gi.group_id
  where gi.id=p_invite_id
    and gi.target_user_id=v_me
    and gi.status='pending'
    and g.status='active'
  for update;

  if v_group_id is null then
    raise exception 'Group invitation not found';
  end if;

  insert into public.group_members(
    group_id,
    user_id,
    role
  )
  values(
    v_group_id,
    v_me,
    'member'
  )
  on conflict(group_id,user_id) do nothing;

  update public.group_invites
  set
    status='accepted',
    responded_at=now()
  where id=p_invite_id;

  perform public.refresh_brainilab_group_stats(v_group_id);

  return jsonb_build_object(
    'status','accepted',
    'group_id',v_group_id
  );
end;
$$;

revoke execute on function public.accept_brainilab_group_invite(uuid)
  from public,anon;

grant execute on function public.accept_brainilab_group_invite(uuid)
  to authenticated;


create or replace function public.decline_brainilab_group_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  update public.group_invites
  set
    status='declined',
    responded_at=now()
  where id=p_invite_id
    and target_user_id=v_me
    and status='pending';

  if not found then
    raise exception 'Group invitation not found';
  end if;
end;
$$;

revoke execute on function public.decline_brainilab_group_invite(uuid)
  from public,anon;

grant execute on function public.decline_brainilab_group_invite(uuid)
  to authenticated;


create or replace function public.cancel_brainilab_group_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_group_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select gi.group_id
    into v_group_id
  from public.group_invites gi
  where gi.id=p_invite_id
    and gi.status='pending';

  if public.brainilab_group_role(v_group_id,v_me) is null
     or public.brainilab_group_role(v_group_id,v_me) not in ('owner','admin') then
    raise exception 'Not allowed';
  end if;

  update public.group_invites
  set
    status='cancelled',
    responded_at=now()
  where id=p_invite_id
    and status='pending';
end;
$$;

revoke execute on function public.cancel_brainilab_group_invite(uuid)
  from public,anon;

grant execute on function public.cancel_brainilab_group_invite(uuid)
  to authenticated;


-- ============================================================
-- SHARE LINK ACCEPTANCE
-- ============================================================

create or replace function public.accept_brainilab_group_link(
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_code text:=upper(btrim(coalesce(p_invite_code,'')));
  v_group_id uuid;
  v_owner uuid;
  v_invite_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select g.id,g.owner_id
    into v_group_id,v_owner
  from public.groups g
  where g.invite_code=v_code
    and g.status='active';

  if v_group_id is null then
    raise exception 'Group invite is no longer valid';
  end if;

  if exists(
    select 1
    from public.group_members gm
    where gm.group_id=v_group_id
      and gm.user_id=v_me
  ) then
    return jsonb_build_object(
      'status','already_member',
      'group_id',v_group_id
    );
  end if;

  insert into public.group_members(
    group_id,
    user_id,
    role
  )
  values(
    v_group_id,
    v_me,
    'member'
  );

  insert into public.group_invites(
    group_id,
    inviter_id,
    target_user_id,
    source,
    status,
    responded_at
  )
  values(
    v_group_id,
    v_owner,
    v_me,
    'invite_link',
    'accepted',
    now()
  )
  returning id into v_invite_id;

  perform public.refresh_brainilab_group_stats(v_group_id);

  return jsonb_build_object(
    'status','accepted',
    'group_id',v_group_id
  );
end;
$$;

revoke execute on function public.accept_brainilab_group_link(text)
  from public,anon;

grant execute on function public.accept_brainilab_group_link(text)
  to authenticated;


-- ============================================================
-- MEMBER MANAGEMENT
-- ============================================================

create or replace function public.remove_brainilab_group_member(
  p_group_id uuid,
  p_member_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_my_role text;
  v_target_role text;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  v_my_role:=public.brainilab_group_role(p_group_id,v_me);
  v_target_role:=public.brainilab_group_role(
    p_group_id,
    p_member_user_id
  );

  if v_my_role is null or v_my_role not in ('owner','admin') then
    raise exception 'Not allowed';
  end if;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role='owner' then
    raise exception 'The group owner cannot be removed';
  end if;

  if v_my_role='admin' and v_target_role='admin' then
    raise exception 'Admins cannot remove other admins';
  end if;

  delete from public.group_members
  where group_id=p_group_id
    and user_id=p_member_user_id;

  perform public.refresh_brainilab_group_stats(p_group_id);
end;
$$;

revoke execute on function public.remove_brainilab_group_member(uuid,uuid)
  from public,anon;

grant execute on function public.remove_brainilab_group_member(uuid,uuid)
  to authenticated;


create or replace function public.leave_brainilab_group(
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_role text;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  v_role:=public.brainilab_group_role(p_group_id,v_me);

  if v_role is null then
    raise exception 'You are not a member of this group';
  end if;

  if v_role='owner' then
    raise exception 'Owners must delete the group instead of leaving it';
  end if;

  delete from public.group_members
  where group_id=p_group_id
    and user_id=v_me;

  perform public.refresh_brainilab_group_stats(p_group_id);
end;
$$;

revoke execute on function public.leave_brainilab_group(uuid)
  from public,anon;

grant execute on function public.leave_brainilab_group(uuid)
  to authenticated;


create or replace function public.delete_brainilab_group(
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if public.brainilab_group_role(p_group_id,v_me) is distinct from 'owner' then
    raise exception 'Only the group owner can delete this group';
  end if;

  delete from public.groups
  where id=p_group_id
    and owner_id=v_me;
end;
$$;

revoke execute on function public.delete_brainilab_group(uuid)
  from public,anon;

grant execute on function public.delete_brainilab_group(uuid)
  to authenticated;


-- ============================================================
-- MY GROUPS SNAPSHOT
-- ============================================================

create or replace function public.get_my_brainilab_groups()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_groups jsonb;
  v_received jsonb;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',g.id,
        'name',g.name,
        'country',g.country_code,
        'owner_id',g.owner_id,
        'my_role',my_gm.role,

        'crest',jsonb_build_object(
          'icon',g.crest_icon,
          'color',g.crest_color
        ),

        'invite_code',case
          when my_gm.role in ('owner','admin')
            then g.invite_code
          else null
        end,

        'member_count',(
          select count(*)
          from public.group_members count_gm
          where count_gm.group_id=g.id
        ),

        'eligible',(
          select count(*)>=3
          from public.group_members count_gm
          where count_gm.group_id=g.id
        ),

        'current_streak',
          public.brainilab_group_current_streak(g.id),

        'daily_score',coalesce(gds.group_score,0),
        'daily_active_members',coalesce(gds.active_members,0),

        'weekly_score',coalesce(gws.group_score,0),
        'monthly_score',coalesce(gms.group_score,0),

        'members',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'user_id',gm.user_id,
              'name',p.display_name,
              'avatar',upper(left(p.display_name,1)),
              'avatar_url',p.avatar_url,
              'country',p.country_code,
              'role',gm.role,

              'current_streak',coalesce(pp.current_streak,0),
              'xp',coalesce(pp.xp,0),
              'level',coalesce(pp.level,1),
              'daily_score',coalesce(ds.daily_brain_score,0),

              'joined_at',gm.joined_at
            )
            order by
              case gm.role
                when 'owner' then 1
                when 'admin' then 2
                else 3
              end,
              p.display_name
          )
          from public.group_members gm
          join public.profiles p
            on p.user_id=gm.user_id
          left join public.player_progression pp
            on pp.user_id=gm.user_id
          left join public.player_daily_stats ds
            on ds.user_id=gm.user_id
           and ds.stat_date=v_today
          where gm.group_id=g.id
        ),'[]'::jsonb),

        'pending_invites',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',gi.id,
              'user_id',gi.target_user_id,
              'name',p.display_name,
              'avatar',upper(left(p.display_name,1)),
              'country',p.country_code,
              'created_at',gi.created_at
            )
            order by gi.created_at desc
          )
          from public.group_invites gi
          join public.profiles p
            on p.user_id=gi.target_user_id
          where gi.group_id=g.id
            and gi.status='pending'
            and gi.target_user_id is not null
        ),'[]'::jsonb),

        'created_at',g.created_at
      )
      order by g.created_at desc
    ),
    '[]'::jsonb
  )
  into v_groups
  from public.group_members my_gm
  join public.groups g
    on g.id=my_gm.group_id
   and g.status='active'

  left join public.group_daily_stats gds
    on gds.group_id=g.id
   and gds.stat_date=v_today

  left join public.group_period_stats gws
    on gws.group_id=g.id
   and gws.period_type='week'
   and gws.period_start=v_week

  left join public.group_period_stats gms
    on gms.group_id=g.id
   and gms.period_type='month'
   and gms.period_start=v_month

  where my_gm.user_id=v_me;


  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',gi.id,
        'group_id',g.id,
        'group_name',g.name,
        'country',g.country_code,

        'crest',jsonb_build_object(
          'icon',g.crest_icon,
          'color',g.crest_color
        ),

        'inviter_id',gi.inviter_id,
        'inviter_name',p.display_name,

        'member_count',(
          select count(*)
          from public.group_members gm
          where gm.group_id=g.id
        ),

        'created_at',gi.created_at
      )
      order by gi.created_at desc
    ),
    '[]'::jsonb
  )
  into v_received
  from public.group_invites gi
  join public.groups g
    on g.id=gi.group_id
   and g.status='active'
  join public.profiles p
    on p.user_id=gi.inviter_id
  where gi.target_user_id=v_me
    and gi.status='pending';


  return jsonb_build_object(
    'groups',v_groups,
    'received_invites',v_received,
    'group_count',jsonb_array_length(v_groups),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_my_brainilab_groups()
  from public,anon;

grant execute on function public.get_my_brainilab_groups()
  to authenticated;


-- ============================================================
-- GROUP RANKINGS
-- p_region: global | country
-- p_period: daily | weekly | monthly
-- p_game_id: all or a game_id
-- p_metric: score | streak
-- p_limit: browser can request max 100
-- ============================================================

create or replace function public.get_brainilab_group_rankings(
  p_region text default 'global',
  p_country_code text default null,
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();

  v_region text:=lower(coalesce(p_region,'global'));
  v_country text:=upper(nullif(btrim(coalesce(p_country_code,'')),''));
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_period_type text;
  v_period_start date;
  v_limit integer:=least(100,greatest(10,coalesce(p_limit,100)));

  v_rows jsonb;
  v_user jsonb;
  v_my_groups jsonb;
  v_total integer;
begin
  if v_region not in ('global','country') then
    raise exception 'Invalid group ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid group ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid group ranking metric';
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then
    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'my_groups','[]'::jsonb,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Group streak'
        else 'Group Score'
      end,
      'country_required',true
    );
  end if;

  if v_period='daily' then
    v_period_type:='day';
    v_period_start:=v_today;
  elsif v_period='weekly' then
    v_period_type:='week';
    v_period_start:=v_week;
  else
    v_period_type:='month';
    v_period_start:=v_month;
  end if;

  with group_base as (
    select
      g.id,
      g.name,
      g.country_code,
      g.crest_icon,
      g.crest_color,

      (
        select count(*)::integer
        from public.group_members gm
        where gm.group_id=g.id
      ) as member_count,

      exists(
        select 1
        from public.group_members mine
        where mine.group_id=g.id
          and mine.user_id=v_me
      ) as is_mine

    from public.groups g
    where g.status='active'
      and (
        v_region='global'
        or g.country_code=v_country
      )
  ),
  scored as (
    select
      gb.*,

      case
        when v_metric='streak'
          then public.brainilab_group_current_streak(gb.id)::bigint

        when v_game='all' and v_period='daily'
          then coalesce(gds.group_score,0)

        when v_game='all' and v_period in ('weekly','monthly')
          then coalesce(gps.group_score,0)

        else coalesce(ggps.group_score,0)
      end as score

    from group_base gb

    left join public.group_daily_stats gds
      on gds.group_id=gb.id
     and gds.stat_date=v_today

    left join public.group_period_stats gps
      on gps.group_id=gb.id
     and gps.period_type=case
       when v_period='weekly' then 'week'
       else 'month'
     end
     and gps.period_start=case
       when v_period='weekly' then v_week
       else v_month
     end

    left join public.group_game_period_stats ggps
      on ggps.group_id=gb.id
     and ggps.game_id=v_game
     and ggps.period_type=v_period_type
     and ggps.period_start=v_period_start

    where gb.member_count>=3
  ),
  ranked as (
    select
      s.*,
      row_number() over(
        order by
          s.score desc,
          lower(s.name),
          s.id
      ) as rank
    from scored s
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'group_id',r.id,
          'name',r.name,
          'country',r.country_code,
          'crest',jsonb_build_object(
            'icon',r.crest_icon,
            'color',r.crest_color
          ),
          'members',r.member_count,
          'score',r.score,
          'streak',case
            when v_metric='streak' then r.score
            else public.brainilab_group_current_streak(r.id)
          end,
          'is_me',r.is_mine
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),

    count(*)::integer,

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'group_id',mine.id,
        'name',mine.name,
        'country',mine.country_code,
        'crest',jsonb_build_object(
          'icon',mine.crest_icon,
          'color',mine.crest_color
        ),
        'members',mine.member_count,
        'score',mine.score,
        'streak',case
          when v_metric='streak' then mine.score
          else public.brainilab_group_current_streak(mine.id)
        end,
        'is_me',true
      )
      from ranked mine
      where mine.is_mine=true
      order by mine.rank
      limit 1
    )

  into v_rows,v_total,v_user
  from ranked r;


  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id',g.id,
        'name',g.name,
        'country',g.country_code,
        'crest',jsonb_build_object(
          'icon',g.crest_icon,
          'color',g.crest_color
        ),
        'members',(
          select count(*)
          from public.group_members cgm
          where cgm.group_id=g.id
        ),
        'eligible',(
          select count(*)>=3
          from public.group_members cgm
          where cgm.group_id=g.id
        )
      )
      order by g.created_at desc
    ),
    '[]'::jsonb
  )
  into v_my_groups
  from public.group_members gm
  join public.groups g
    on g.id=gm.group_id
   and g.status='active'
  where gm.user_id=v_me;


  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'my_groups',v_my_groups,
    'total_players',v_total,
    'metric_label',case
      when v_metric='streak' then 'Group streak'
      when v_game='brainiword' then 'BrainiWord points'
      else 'Group Score'
    end,
    'period',v_period,
    'game_id',v_game,
    'region',v_region,
    'country',v_country,
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_brainilab_group_rankings(
  text,text,text,text,text,integer
) from public,anon;

grant execute on function public.get_brainilab_group_rankings(
  text,text,text,text,text,integer
) to authenticated;


-- ============================================================
-- RLS + TABLE PERMISSIONS
-- RPC-only in browser.
-- ============================================================

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_daily_stats enable row level security;
alter table public.group_period_stats enable row level security;
alter table public.group_game_period_stats enable row level security;

revoke all on table public.groups
  from anon,authenticated;

revoke all on table public.group_members
  from anon,authenticated;

revoke all on table public.group_invites
  from anon,authenticated;

revoke all on table public.group_daily_stats
  from anon,authenticated;

revoke all on table public.group_period_stats
  from anon,authenticated;

revoke all on table public.group_game_period_stats
  from anon,authenticated;


-- ============================================================
-- INITIAL BACKFILL
-- ============================================================

do $$
declare
  v_group record;
begin
  for v_group in
    select g.id
    from public.groups g
    where g.status='active'
  loop
    perform public.refresh_brainilab_group_stats(v_group.id);
  end loop;
end;
$$;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- Tables:
--
-- select
--   to_regclass('public.groups') as groups,
--   to_regclass('public.group_members') as group_members,
--   to_regclass('public.group_invites') as group_invites,
--   to_regclass('public.group_daily_stats') as group_daily_stats,
--   to_regclass('public.group_period_stats') as group_period_stats;
--
-- RPCs:
--
-- select routine_name
-- from information_schema.routines
-- where routine_schema='public'
--   and routine_name in (
--     'create_brainilab_group',
--     'get_my_brainilab_groups',
--     'invite_brainilab_friend_to_group',
--     'accept_brainilab_group_invite',
--     'accept_brainilab_group_link',
--     'get_brainilab_group_rankings'
--   )
-- order by routine_name;
--
-- With one user, create a group in the frontend and then:
--
-- select
--   g.name,
--   g.country_code,
--   count(gm.user_id) as members
-- from public.groups g
-- join public.group_members gm on gm.group_id=g.id
-- group by g.id,g.name,g.country_code;
