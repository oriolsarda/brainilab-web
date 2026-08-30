-- BrainiLab Backend — Step 8: Friends + friend invites + Friends Ranking
-- Run after Steps 1–7.
--
-- Adds:
-- - real friend requests
-- - accepted friendships
-- - friend-code lookup without exposing profiles publicly
-- - direct opt-in invite links
-- - remove / decline / cancel
-- - friend-only progression snapshot
-- - Friends Ranking using the progression aggregates from Step 6
--
-- Privacy:
-- - email is never exposed
-- - profiles remain non-public
-- - only accepted friends can see each other's social progression fields
-- - all social reads/writes go through controlled SECURITY DEFINER RPCs

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- FRIEND REQUESTS
-- ============================================================

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null
    references auth.users(id) on delete cascade,

  receiver_id uuid not null
    references auth.users(id) on delete cascade,

  status text not null default 'pending',

  source text not null default 'friend_code',

  created_at timestamptz not null default now(),
  responded_at timestamptz null,

  constraint friend_requests_not_self
    check (sender_id <> receiver_id),

  constraint friend_requests_status_check
    check (status in ('pending','accepted','declined','cancelled')),

  constraint friend_requests_source_check
    check (source in ('friend_code','invite_link'))
);

-- Only one pending request can exist for a pair in either direction.
create unique index if not exists friend_requests_one_pending_pair_idx
  on public.friend_requests(
    least(sender_id::text,receiver_id::text),
    greatest(sender_id::text,receiver_id::text)
  )
  where status='pending';

create index if not exists friend_requests_receiver_pending_idx
  on public.friend_requests(receiver_id,created_at desc)
  where status='pending';

create index if not exists friend_requests_sender_pending_idx
  on public.friend_requests(sender_id,created_at desc)
  where status='pending';


-- ============================================================
-- ACCEPTED FRIENDSHIPS
-- Canonical pair order prevents duplicates.
-- ============================================================

create table if not exists public.friendships (
  user_a uuid not null
    references auth.users(id) on delete cascade,

  user_b uuid not null
    references auth.users(id) on delete cascade,

  source text not null default 'friend_request',

  created_at timestamptz not null default now(),

  primary key(user_a,user_b),

  constraint friendships_not_self
    check (user_a <> user_b),

  constraint friendships_canonical_order
    check (user_a::text < user_b::text),

  constraint friendships_source_check
    check (source in ('friend_request','invite_link'))
);

create index if not exists friendships_user_a_idx
  on public.friendships(user_a);

create index if not exists friendships_user_b_idx
  on public.friendships(user_b);


-- ============================================================
-- INTERNAL HELPERS
-- ============================================================

create or replace function public.brainilab_friend_pair_a(
  p_user_1 uuid,
  p_user_2 uuid
)
returns uuid
language sql
immutable
as $$
  select case
    when p_user_1::text < p_user_2::text then p_user_1
    else p_user_2
  end;
$$;

create or replace function public.brainilab_friend_pair_b(
  p_user_1 uuid,
  p_user_2 uuid
)
returns uuid
language sql
immutable
as $$
  select case
    when p_user_1::text < p_user_2::text then p_user_2
    else p_user_1
  end;
$$;

revoke execute on function public.brainilab_friend_pair_a(uuid,uuid)
  from public,anon,authenticated;

revoke execute on function public.brainilab_friend_pair_b(uuid,uuid)
  from public,anon,authenticated;


create or replace function public.brainilab_are_friends(
  p_user_1 uuid,
  p_user_2 uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.friendships f
    where f.user_a=public.brainilab_friend_pair_a(p_user_1,p_user_2)
      and f.user_b=public.brainilab_friend_pair_b(p_user_1,p_user_2)
  );
$$;

revoke execute on function public.brainilab_are_friends(uuid,uuid)
  from public,anon,authenticated;


create or replace function public.brainilab_create_friendship(
  p_user_1 uuid,
  p_user_2 uuid,
  p_source text default 'friend_request'
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  if p_user_1 is null or p_user_2 is null or p_user_1=p_user_2 then
    raise exception 'Invalid friendship';
  end if;

  v_a:=public.brainilab_friend_pair_a(p_user_1,p_user_2);
  v_b:=public.brainilab_friend_pair_b(p_user_1,p_user_2);

  insert into public.friendships(user_a,user_b,source)
  values(
    v_a,
    v_b,
    case when p_source='invite_link' then 'invite_link' else 'friend_request' end
  )
  on conflict(user_a,user_b) do nothing;

  update public.friend_requests
  set
    status='accepted',
    responded_at=coalesce(responded_at,now())
  where status='pending'
    and (
      (sender_id=p_user_1 and receiver_id=p_user_2)
      or
      (sender_id=p_user_2 and receiver_id=p_user_1)
    );
end;
$$;

revoke execute on function public.brainilab_create_friendship(uuid,uuid,text)
  from public,anon,authenticated;


-- ============================================================
-- SEND REQUEST BY FRIEND CODE
-- If the other player already requested me, this becomes an immediate
-- accepted friendship because both sides have now explicitly opted in.
-- ============================================================

create or replace function public.send_brainilab_friend_request(
  p_friend_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_code text:=upper(btrim(coalesce(p_friend_code,'')));
  v_target uuid;
  v_request_id uuid;
  v_reverse_request uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select p.user_id
    into v_target
  from public.profiles p
  where upper(p.friend_code)=v_code
  limit 1;

  if v_target is null then
    raise exception 'Friend code not found';
  end if;

  if v_target=v_me then
    raise exception 'That is your own friend code';
  end if;

  if public.brainilab_are_friends(v_me,v_target) then
    return jsonb_build_object(
      'status','already_friends',
      'friend_user_id',v_target
    );
  end if;

  select fr.id
    into v_reverse_request
  from public.friend_requests fr
  where fr.sender_id=v_target
    and fr.receiver_id=v_me
    and fr.status='pending'
  order by fr.created_at desc
  limit 1;

  if v_reverse_request is not null then
    perform public.brainilab_create_friendship(
      v_me,
      v_target,
      'friend_request'
    );

    return jsonb_build_object(
      'status','accepted',
      'friend_user_id',v_target
    );
  end if;

  select fr.id
    into v_request_id
  from public.friend_requests fr
  where fr.sender_id=v_me
    and fr.receiver_id=v_target
    and fr.status='pending'
  limit 1;

  if v_request_id is not null then
    return jsonb_build_object(
      'status','already_pending',
      'request_id',v_request_id
    );
  end if;

  insert into public.friend_requests(
    sender_id,
    receiver_id,
    status,
    source
  )
  values(
    v_me,
    v_target,
    'pending',
    'friend_code'
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status','pending',
    'request_id',v_request_id
  );
end;
$$;

revoke execute on function public.send_brainilab_friend_request(text)
  from public,anon;

grant execute on function public.send_brainilab_friend_request(text)
  to authenticated;


-- ============================================================
-- DIRECT INVITE-LINK ACCEPTANCE
-- The inviter has shared their private friend link and the current player
-- explicitly clicked Accept, so both sides have opted in.
-- ============================================================

create or replace function public.accept_brainilab_friend_invite(
  p_friend_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_code text:=upper(btrim(coalesce(p_friend_code,'')));
  v_inviter uuid;
  v_request_id uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select p.user_id
    into v_inviter
  from public.profiles p
  where upper(p.friend_code)=v_code
  limit 1;

  if v_inviter is null then
    raise exception 'Friend invite is no longer valid';
  end if;

  if v_inviter=v_me then
    raise exception 'You cannot accept your own friend invite';
  end if;

  if not public.brainilab_are_friends(v_me,v_inviter) then
    insert into public.friend_requests(
      sender_id,
      receiver_id,
      status,
      source,
      responded_at
    )
    values(
      v_inviter,
      v_me,
      'accepted',
      'invite_link',
      now()
    )
    returning id into v_request_id;

    perform public.brainilab_create_friendship(
      v_me,
      v_inviter,
      'invite_link'
    );
  end if;

  return jsonb_build_object(
    'status','accepted',
    'friend_user_id',v_inviter
  );
end;
$$;

revoke execute on function public.accept_brainilab_friend_invite(text)
  from public,anon;

grant execute on function public.accept_brainilab_friend_invite(text)
  to authenticated;


-- ============================================================
-- ACCEPT / DECLINE / CANCEL / REMOVE
-- ============================================================

create or replace function public.accept_brainilab_friend_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_sender uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select fr.sender_id
    into v_sender
  from public.friend_requests fr
  where fr.id=p_request_id
    and fr.receiver_id=v_me
    and fr.status='pending'
  for update;

  if v_sender is null then
    raise exception 'Friend request not found';
  end if;

  perform public.brainilab_create_friendship(
    v_me,
    v_sender,
    'friend_request'
  );

  return jsonb_build_object(
    'status','accepted',
    'friend_user_id',v_sender
  );
end;
$$;

revoke execute on function public.accept_brainilab_friend_request(uuid)
  from public,anon;

grant execute on function public.accept_brainilab_friend_request(uuid)
  to authenticated;


create or replace function public.decline_brainilab_friend_request(
  p_request_id uuid
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

  update public.friend_requests
  set status='declined',responded_at=now()
  where id=p_request_id
    and receiver_id=v_me
    and status='pending';

  if not found then
    raise exception 'Friend request not found';
  end if;
end;
$$;

revoke execute on function public.decline_brainilab_friend_request(uuid)
  from public,anon;

grant execute on function public.decline_brainilab_friend_request(uuid)
  to authenticated;


create or replace function public.cancel_brainilab_friend_request(
  p_request_id uuid
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

  update public.friend_requests
  set status='cancelled',responded_at=now()
  where id=p_request_id
    and sender_id=v_me
    and status='pending';

  if not found then
    raise exception 'Friend request not found';
  end if;
end;
$$;

revoke execute on function public.cancel_brainilab_friend_request(uuid)
  from public,anon;

grant execute on function public.cancel_brainilab_friend_request(uuid)
  to authenticated;


create or replace function public.remove_brainilab_friend(
  p_friend_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if p_friend_user_id is null or p_friend_user_id=v_me then
    raise exception 'Invalid friend';
  end if;

  v_a:=public.brainilab_friend_pair_a(v_me,p_friend_user_id);
  v_b:=public.brainilab_friend_pair_b(v_me,p_friend_user_id);

  delete from public.friendships
  where user_a=v_a
    and user_b=v_b;

  if not found then
    raise exception 'Friendship not found';
  end if;
end;
$$;

revoke execute on function public.remove_brainilab_friend(uuid)
  from public,anon;

grant execute on function public.remove_brainilab_friend(uuid)
  to authenticated;


-- ============================================================
-- MY FRIENDS SNAPSHOT
-- Returns only social identity/progression fields.
-- No email, auth metadata or private profile internals.
-- ============================================================

create or replace function public.get_my_brainilab_friends()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc('week',(now() at time zone 'UTC'))::date;
  v_month date:=date_trunc('month',(now() at time zone 'UTC'))::date;
  v_code text;
  v_friends jsonb;
  v_incoming jsonb;
  v_outgoing jsonb;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  select p.friend_code
    into v_code
  from public.profiles p
  where p.user_id=v_me;

  with friend_ids as (
    select
      case
        when f.user_a=v_me then f.user_b
        else f.user_a
      end as friend_user_id,
      f.created_at
    from public.friendships f
    where f.user_a=v_me or f.user_b=v_me
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id',fi.friend_user_id,
        'name',p.display_name,
        'avatar_url',p.avatar_url,
        'avatar',upper(left(p.display_name,1)),
        'country',p.country_code,

        'current_streak',coalesce(pp.current_streak,0),
        'best_streak',coalesce(pp.best_streak,0),
        'xp',coalesce(pp.xp,0),
        'level',coalesce(pp.level,1),

        'daily_score',coalesce(ds.daily_brain_score,0),
        'daily_games_completed',coalesce(ds.daily_games_completed,0),
        'full_daily',coalesce(ds.full_daily,false),

        'weekly_score',coalesce(ws.daily_brain_score,0),
        'monthly_score',coalesce(ms.daily_brain_score,0),

        'friends_since',fi.created_at
      )
      order by
        coalesce(ds.daily_brain_score,0) desc,
        p.display_name
    ),
    '[]'::jsonb
  )
  into v_friends
  from friend_ids fi
  join public.profiles p
    on p.user_id=fi.friend_user_id
  left join public.player_progression pp
    on pp.user_id=fi.friend_user_id
  left join public.player_daily_stats ds
    on ds.user_id=fi.friend_user_id
   and ds.stat_date=v_today
  left join public.player_period_stats ws
    on ws.user_id=fi.friend_user_id
   and ws.period_type='week'
   and ws.period_start=v_week
  left join public.player_period_stats ms
    on ms.user_id=fi.friend_user_id
   and ms.period_type='month'
   and ms.period_start=v_month;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',fr.id,
        'user_id',fr.sender_id,
        'name',p.display_name,
        'avatar_url',p.avatar_url,
        'avatar',upper(left(p.display_name,1)),
        'country',p.country_code,
        'direction','incoming',
        'created_at',fr.created_at
      )
      order by fr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_incoming
  from public.friend_requests fr
  join public.profiles p
    on p.user_id=fr.sender_id
  where fr.receiver_id=v_me
    and fr.status='pending';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',fr.id,
        'user_id',fr.receiver_id,
        'name',p.display_name,
        'avatar_url',p.avatar_url,
        'avatar',upper(left(p.display_name,1)),
        'country',p.country_code,
        'direction','outgoing',
        'created_at',fr.created_at
      )
      order by fr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_outgoing
  from public.friend_requests fr
  join public.profiles p
    on p.user_id=fr.receiver_id
  where fr.sender_id=v_me
    and fr.status='pending';

  return jsonb_build_object(
    'friend_code',v_code,
    'friends',v_friends,
    'incoming',v_incoming,
    'outgoing',v_outgoing,
    'friend_count',jsonb_array_length(v_friends),
    'incoming_count',jsonb_array_length(v_incoming),
    'outgoing_count',jsonb_array_length(v_outgoing),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_my_brainilab_friends()
  from public,anon;

grant execute on function public.get_my_brainilab_friends()
  to authenticated;


-- ============================================================
-- FRIENDS RANKING
-- Members = me + accepted friends.
--
-- All games:
--   daily   -> Daily Brain Score
--   weekly  -> sum of Daily Brain Scores for current week
--   monthly -> sum of Daily Brain Scores for current month
--
-- Specific game:
--   uses Step 6 player_game_period_stats.
--
-- Streak:
--   current streak, regardless of period/game filter.
-- ============================================================

create or replace function public.get_my_brainilab_friends_ranking(
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc('week',(now() at time zone 'UTC'))::date;
  v_month date:=date_trunc('month',(now() at time zone 'UTC'))::date;

  v_period_type text;
  v_period_start date;

  v_rows jsonb;
  v_me_row jsonb;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
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

  with members as (
    select v_me as user_id
    union
    select case when f.user_a=v_me then f.user_b else f.user_a end
    from public.friendships f
    where f.user_a=v_me or f.user_b=v_me
  ),
  values_by_member as (
    select
      m.user_id,
      p.display_name,
      p.country_code,
      p.avatar_url,
      coalesce(pp.current_streak,0) as streak,

      case
        when v_metric='streak'
          then coalesce(pp.current_streak,0)::numeric

        when v_game='all' and v_period='daily'
          then coalesce(ds.daily_brain_score,0)::numeric

        when v_game='all' and v_period in ('weekly','monthly')
          then coalesce(ps.daily_brain_score,0)::numeric

        else coalesce(gps.total_score,0)::numeric
      end as rank_value,

      case
        when v_metric='streak'
          then coalesce(pp.current_streak,0)::text || ' days'

        when v_game='brainiword'
             and gps.best_metric_value is not null
          then gps.best_metric_value::text || ' attempts'

        else to_char(
          case
            when v_game='all' and v_period='daily'
              then coalesce(ds.daily_brain_score,0)
            when v_game='all' and v_period in ('weekly','monthly')
              then coalesce(ps.daily_brain_score,0)
            else coalesce(gps.total_score,0)
          end,
          'FM999G999G999G990'
        )
      end as display_value,

      case
        when v_game='brainiword'
          then gps.best_metric_value
        else null
      end as brainiword_attempts

    from members m
    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_progression pp
      on pp.user_id=m.user_id

    left join public.player_daily_stats ds
      on ds.user_id=m.user_id
     and ds.stat_date=v_today

    left join public.player_period_stats ps
      on ps.user_id=m.user_id
     and ps.period_type=case when v_period='weekly' then 'week' else 'month' end
     and ps.period_start=case when v_period='weekly' then v_week else v_month end

    left join public.player_game_period_stats gps
      on gps.user_id=m.user_id
     and gps.game_id=v_game
     and gps.period_type=v_period_type
     and gps.period_start=v_period_start
  ),
  ranked as (
    select
      v.*,
      row_number() over(
        order by
          case
            when v_metric='score' and v_game='brainiword'
              then case
                when v.brainiword_attempts is null then 999999
                else v.brainiword_attempts
              end
            else null
          end asc nulls last,

          case
            when not (v_metric='score' and v_game='brainiword')
              then v.rank_value
            else null
          end desc nulls last,

          lower(v.display_name),
          v.user_id
      ) as rank
    from values_by_member v
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank',r.rank,
        'user_id',r.user_id,
        'name',r.display_name,
        'country',r.country_code,
        'avatar_url',r.avatar_url,
        'avatar',upper(left(r.display_name,1)),
        'score',case
          when v_metric='score' and v_game='brainiword'
            then coalesce((6-r.brainiword_attempts)::numeric,0)
          else r.rank_value
        end,
        'streak',r.streak,
        'display_value',r.display_value,
        'is_me',r.user_id=v_me
      )
      order by r.rank
    ),
    '[]'::jsonb
  ),
  (
    select jsonb_build_object(
      'rank',r.rank,
      'user_id',r.user_id,
      'name',r.display_name,
      'country',r.country_code,
      'avatar_url',r.avatar_url,
      'avatar',upper(left(r.display_name,1)),
      'score',case
        when v_metric='score' and v_game='brainiword'
          then coalesce((6-r.brainiword_attempts)::numeric,0)
        else r.rank_value
      end,
      'streak',r.streak,
      'display_value',r.display_value,
      'is_me',true
    )
    from ranked r
    where r.user_id=v_me
  )
  into v_rows,v_me_row
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_me_row,
    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game='brainiword' then 'Best attempts'
      else 'Points'
    end,
    'total_players',jsonb_array_length(v_rows),
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_my_brainilab_friends_ranking(text,text,text)
  from public,anon;

grant execute on function public.get_my_brainilab_friends_ranking(text,text,text)
  to authenticated;


-- ============================================================
-- RLS + DIRECT TABLE ACCESS
-- Tables are intentionally RPC-only for browser clients.
-- ============================================================

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

revoke all on table public.friend_requests
  from anon,authenticated;

revoke all on table public.friendships
  from anon,authenticated;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- Tables:
--
-- select
--   to_regclass('public.friend_requests') as friend_requests,
--   to_regclass('public.friendships') as friendships;
--
-- RPCs:
--
-- select routine_name
-- from information_schema.routines
-- where routine_schema='public'
--   and routine_name in (
--     'get_my_brainilab_friends',
--     'send_brainilab_friend_request',
--     'accept_brainilab_friend_request',
--     'accept_brainilab_friend_invite',
--     'remove_brainilab_friend',
--     'get_my_brainilab_friends_ranking'
--   )
-- order by routine_name;
--
-- With only one test account, get_my_brainilab_friends() should return
-- an empty friends array. A second account is needed to test the real flow.
