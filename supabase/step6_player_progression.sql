-- BrainiLab Backend — Step 6: player progression + aggregates
-- Run after Steps 1–5.
--
-- Product rules implemented here:
-- - A streak day = completing at least 1 of the 4 Daily Games.
-- - Full Daily = completing all 4 Daily Games on the same UTC date.
-- - Daily Brain Score = best contribution from each Daily Game, max 2,500 each.
-- - Maximum Daily Brain Score = 10,000.
-- - XP is cumulative progression and is NOT used as a competitive score.
-- - Daily / weekly / monthly aggregates are precomputed for future rankings.
--
-- Daily Game contribution formulas preserve the existing BrainiLab frontend:
--   Brain Mix   = min(2500, raw_score * 0.25)
--   Flag Dash   = min(2500, correct * 70 + best_combo * 15)
--   Map Hunt    = min(2500, raw_score * 0.42)
--   BrainiWord  = win in 1/2/3/4/5 -> 2500/2250/2000/1750/1500
--                 fail -> 250
--
-- UTC is the authoritative BrainiLab day boundary.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- PLAYER PROGRESSION
-- ============================================================

create table if not exists public.player_progression (
  user_id uuid primary key
    references auth.users(id) on delete cascade,

  current_streak integer not null default 0,
  best_streak integer not null default 0,
  full_daily_count integer not null default 0,

  xp bigint not null default 0,
  level integer not null default 1,

  total_games integer not null default 0,
  total_questions bigint not null default 0,

  favorite_game_id text null,

  last_streak_date date null,
  last_active_at timestamptz null,

  updated_at timestamptz not null default now(),

  constraint player_progression_streak_nonnegative
    check (current_streak >= 0 and best_streak >= 0),

  constraint player_progression_xp_nonnegative
    check (xp >= 0),

  constraint player_progression_level_positive
    check (level >= 1),

  constraint player_progression_totals_nonnegative
    check (total_games >= 0 and total_questions >= 0)
);


-- ============================================================
-- DAILY PLAYER AGGREGATE
-- One row per player / UTC date.
-- ============================================================

create table if not exists public.player_daily_stats (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  stat_date date not null,

  games_played integer not null default 0,
  questions_answered integer not null default 0,

  daily_games_completed integer not null default 0,
  full_daily boolean not null default false,

  brainmix_points integer not null default 0,
  flagdash_points integer not null default 0,
  maphunt_points integer not null default 0,
  brainiword_points integer not null default 0,

  daily_brain_score integer not null default 0,

  xp_earned integer not null default 0,

  updated_at timestamptz not null default now(),

  primary key(user_id,stat_date),

  constraint player_daily_games_range
    check (daily_games_completed between 0 and 4),

  constraint player_daily_points_range
    check (
      brainmix_points between 0 and 2500
      and flagdash_points between 0 and 2500
      and maphunt_points between 0 and 2500
      and brainiword_points between 0 and 2500
      and daily_brain_score between 0 and 10000
    ),

  constraint player_daily_totals_nonnegative
    check (
      games_played >= 0
      and questions_answered >= 0
      and xp_earned >= 0
    )
);

create index if not exists player_daily_stats_date_score_idx
  on public.player_daily_stats(stat_date,daily_brain_score desc);

create index if not exists player_daily_stats_user_date_idx
  on public.player_daily_stats(user_id,stat_date desc);


-- ============================================================
-- WEEKLY / MONTHLY PLAYER AGGREGATES
-- period_start is Monday for week and first day for month.
-- ============================================================

create table if not exists public.player_period_stats (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  period_type text not null,
  period_start date not null,

  games_played integer not null default 0,
  questions_answered bigint not null default 0,

  daily_brain_score integer not null default 0,
  full_daily_count integer not null default 0,
  active_days integer not null default 0,

  xp_earned bigint not null default 0,

  updated_at timestamptz not null default now(),

  primary key(user_id,period_type,period_start),

  constraint player_period_type_check
    check (period_type in ('week','month')),

  constraint player_period_nonnegative
    check (
      games_played >= 0
      and questions_answered >= 0
      and daily_brain_score >= 0
      and full_daily_count >= 0
      and active_days >= 0
      and xp_earned >= 0
    )
);

create index if not exists player_period_rank_idx
  on public.player_period_stats(
    period_type,
    period_start,
    daily_brain_score desc
  );


-- ============================================================
-- PER-GAME DAY/WEEK/MONTH AGGREGATES
-- Foundation for filtered Rankings.
-- ============================================================

create table if not exists public.player_game_period_stats (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  game_id text not null,
  period_type text not null,
  period_start date not null,

  games_played integer not null default 0,

  total_score bigint not null default 0,
  best_score integer null,

  total_correct integer not null default 0,
  total_questions integer not null default 0,
  average_accuracy numeric(5,2) null,

  best_daily_points integer not null default 0,

  metric_name text not null,
  best_metric_value numeric null,

  updated_at timestamptz not null default now(),

  primary key(user_id,game_id,period_type,period_start),

  constraint player_game_period_type_check
    check (period_type in ('day','week','month')),

  constraint player_game_period_nonnegative
    check (
      games_played >= 0
      and total_score >= 0
      and total_correct >= 0
      and total_questions >= 0
      and best_daily_points between 0 and 2500
    )
);

create index if not exists player_game_period_rank_idx
  on public.player_game_period_stats(
    game_id,
    period_type,
    period_start,
    best_metric_value desc
  );


-- ============================================================
-- PERSONAL BESTS
-- One current PB row per user / game.
-- ============================================================

create table if not exists public.player_personal_bests (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  game_id text not null,

  result_id uuid not null
    references public.game_results(id) on delete cascade,

  metric_name text not null,
  metric_value numeric not null,

  score integer null,
  correct_answers integer null,
  total_questions integer null,
  accuracy numeric(5,2) null,
  duration_ms integer null,

  result_payload jsonb not null default '{}'::jsonb,

  achieved_at timestamptz not null,
  updated_at timestamptz not null default now(),

  primary key(user_id,game_id)
);

create index if not exists player_personal_bests_game_metric_idx
  on public.player_personal_bests(game_id,metric_value desc);


-- ============================================================
-- DAILY CONTRIBUTION HELPER
-- ============================================================

create or replace function public.brainilab_daily_game_points(
  p_game_id text,
  p_score integer,
  p_correct integer,
  p_payload jsonb
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_points integer := 0;
  v_attempts integer;
  v_won boolean := false;
  v_best_combo integer := 0;
begin
  if p_game_id = 'brainmix' then
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.25)::integer)
    );

  elsif p_game_id = 'flagdash' then
    begin
      v_best_combo := coalesce((p_payload ->> 'bestCombo')::integer,0);
    exception when others then
      v_best_combo := 0;
    end;

    v_points := least(
      2500,
      greatest(
        0,
        coalesce(p_correct,0) * 70 + v_best_combo * 15
      )
    );

  elsif p_game_id = 'maphunt' then
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.42)::integer)
    );

  elsif p_game_id = 'brainiword' then
    v_won := lower(coalesce(p_payload ->> 'won','false')) = 'true';

    begin
      v_attempts := (p_payload ->> 'attempts')::integer;
    exception when others then
      v_attempts := null;
    end;

    if not v_won then
      v_points := 250;
    else
      v_points := case v_attempts
        when 1 then 2500
        when 2 then 2250
        when 3 then 2000
        when 4 then 1750
        when 5 then 1500
        else 1000
      end;
    end if;
  end if;

  return least(2500,greatest(0,coalesce(v_points,0)));
end;
$$;

revoke execute on function public.brainilab_daily_game_points(
  text,integer,integer,jsonb
) from public,anon,authenticated;


-- ============================================================
-- REBUILD ONE PLAYER'S PROGRESSION
-- Recomputes from canonical game_sessions/game_results.
-- This is intentionally deterministic and idempotent.
-- ============================================================

create or replace function public.refresh_brainilab_player_progression(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_current_streak integer := 0;
  v_best_streak integer := 0;
  v_run integer := 0;
  v_previous_date date := null;
  v_last_streak_date date := null;

  v_total_games integer := 0;
  v_total_questions bigint := 0;
  v_full_daily_count integer := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_favorite_game text := null;
  v_last_active_at timestamptz := null;

  v_day record;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.player_progression(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  -- ----------------------------------------------------------
  -- Rebuild daily stats for this user.
  -- ----------------------------------------------------------

  delete from public.player_daily_stats
  where user_id = p_user_id;

  insert into public.player_daily_stats(
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    full_daily,
    brainmix_points,
    flagdash_points,
    maphunt_points,
    brainiword_points,
    daily_brain_score,
    xp_earned,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gs.game_id,
      gr.id as result_id,
      coalesce(gr.score,0) as score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.result_payload,
      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id = gs.id
    where gs.user_id = p_user_id
      and gs.status = 'completed'
  ),
  daily as (
    select
      user_id,
      stat_date,
      count(*)::integer as games_played,
      coalesce(sum(total_questions),0)::integer as questions_answered,

      count(distinct game_id) filter(
        where game_id in (
          'brainmix','flagdash','maphunt','brainiword'
        )
      )::integer as daily_games_completed,

      coalesce(max(daily_points) filter(where game_id='brainmix'),0)::integer
        as brainmix_points,

      coalesce(max(daily_points) filter(where game_id='flagdash'),0)::integer
        as flagdash_points,

      coalesce(max(daily_points) filter(where game_id='maphunt'),0)::integer
        as maphunt_points,

      coalesce(max(daily_points) filter(where game_id='brainiword'),0)::integer
        as brainiword_points,

      coalesce(sum(50 + least(correct_answers,50) * 5),0)::integer
        as base_xp
    from base
    group by user_id,stat_date
  )
  select
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    daily_games_completed = 4,

    brainmix_points,
    flagdash_points,
    maphunt_points,
    brainiword_points,

    brainmix_points
      + flagdash_points
      + maphunt_points
      + brainiword_points,

    base_xp + case when daily_games_completed=4 then 250 else 0 end,
    now()
  from daily;


  -- ----------------------------------------------------------
  -- Rebuild generic week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_period_stats
  where user_id = p_user_id;

  insert into public.player_period_stats(
    user_id,
    period_type,
    period_start,
    games_played,
    questions_answered,
    daily_brain_score,
    full_daily_count,
    active_days,
    xp_earned,
    updated_at
  )
  select
    p_user_id,
    periods.period_type,
    periods.period_start,
    sum(ds.games_played)::integer,
    sum(ds.questions_answered)::bigint,
    sum(ds.daily_brain_score)::integer,
    count(*) filter(where ds.full_daily)::integer,
    count(*) filter(where ds.daily_games_completed > 0)::integer,
    sum(ds.xp_earned)::bigint,
    now()
  from public.player_daily_stats ds
  cross join lateral (
    values
      (
        'week'::text,
        date_trunc('week',ds.stat_date::timestamp)::date
      ),
      (
        'month'::text,
        date_trunc('month',ds.stat_date::timestamp)::date
      )
  ) as periods(period_type,period_start)
  where ds.user_id = p_user_id
  group by periods.period_type,periods.period_start;


  -- ----------------------------------------------------------
  -- Rebuild per-game day/week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_game_period_stats
  where user_id = p_user_id;

  insert into public.player_game_period_stats(
    user_id,
    game_id,
    period_type,
    period_start,
    games_played,
    total_score,
    best_score,
    total_correct,
    total_questions,
    average_accuracy,
    best_daily_points,
    metric_name,
    best_metric_value,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      gs.game_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.accuracy,
      gr.result_payload,

      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  ),
  expanded as (
    select
      b.*,
      periods.period_type,
      periods.period_start
    from base b
    cross join lateral (
      values
        ('day'::text,b.stat_date),
        (
          'week'::text,
          date_trunc('week',b.stat_date::timestamp)::date
        ),
        (
          'month'::text,
          date_trunc('month',b.stat_date::timestamp)::date
        )
    ) as periods(period_type,period_start)
  )
  select
    p_user_id,
    game_id,
    period_type,
    period_start,

    count(*)::integer,
    coalesce(sum(score),0)::bigint,
    max(score),
    coalesce(sum(correct_answers),0)::integer,
    coalesce(sum(total_questions),0)::integer,
    round(avg(accuracy)::numeric,2),
    coalesce(max(daily_points),0)::integer,

    case
      when game_id='brainiword' then 'attempts'
      when game_id='flagdash' then 'correct'
      else 'score'
    end,

    case
      when game_id='brainiword' then min(metric_value)
      else max(metric_value)
    end,

    now()
  from expanded
  group by
    game_id,
    period_type,
    period_start;


  -- ----------------------------------------------------------
  -- Rebuild personal bests.
  -- ----------------------------------------------------------

  delete from public.player_personal_bests
  where user_id = p_user_id;

  insert into public.player_personal_bests(
    user_id,
    game_id,
    result_id,
    metric_name,
    metric_value,
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    achieved_at,
    updated_at
  )
  with ranked as (
    select
      gs.game_id,
      gr.id as result_id,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions
      ) as total_questions,
      gr.accuracy,
      gr.duration_ms,
      gr.result_payload,
      gs.completed_at,

      case
        when gs.game_id='brainiword'
          then 'attempts'
        when gs.game_id='flagdash'
          then 'correct'
        else 'score'
      end as metric_name,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value,

      row_number() over(
        partition by gs.game_id
        order by
          case
            when gs.game_id='brainiword'
              then case
                when lower(coalesce(gr.result_payload ->> 'won','false'))='true'
                  then 0
                else 1
              end
            else 0
          end asc,

          case
            when gs.game_id='brainiword'
              and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
              then nullif(gr.result_payload ->> 'attempts','')::numeric
            else null
          end asc nulls last,

          case
            when gs.game_id='flagdash'
              then coalesce(
                gr.verified_correct_answers,
                gr.correct_answers
              )::numeric
            when gs.game_id<>'brainiword'
              then gr.score::numeric
            else null
          end desc nulls last,

          gr.accuracy desc nulls last,
          gr.duration_ms asc nulls last,
          gs.completed_at asc
      ) as rn
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  )
  select
    p_user_id,
    game_id,
    result_id,
    metric_name,
    coalesce(metric_value,0),
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    completed_at,
    now()
  from ranked
  where rn=1
    and metric_value is not null;


  -- ----------------------------------------------------------
  -- Progression totals.
  -- ----------------------------------------------------------

  select
    count(*)::integer,
    coalesce(sum(
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      )
    ),0)::bigint,
    max(gs.completed_at)
  into
    v_total_games,
    v_total_questions,
    v_last_active_at
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=p_user_id
    and gs.status='completed';

  select count(*)::integer
    into v_full_daily_count
  from public.player_daily_stats
  where user_id=p_user_id
    and full_daily=true;

  select coalesce(sum(xp_earned),0)::bigint
    into v_xp
  from public.player_daily_stats
  where user_id=p_user_id;

  v_level := greatest(
    1,
    floor(sqrt(v_xp::numeric / 20.0))::integer + 1
  );

  select gs.game_id
    into v_favorite_game
  from public.game_sessions gs
  where gs.user_id=p_user_id
    and gs.status='completed'
  group by gs.game_id
  order by count(*) desc,gs.game_id
  limit 1;


  -- ----------------------------------------------------------
  -- Streaks: at least one Daily Game on a UTC date.
  -- ----------------------------------------------------------

  for v_day in
    select stat_date
    from public.player_daily_stats
    where user_id=p_user_id
      and daily_games_completed > 0
    order by stat_date
  loop
    if v_previous_date is null
       or v_day.stat_date = v_previous_date + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;

    v_best_streak := greatest(v_best_streak,v_run);
    v_previous_date := v_day.stat_date;
    v_last_streak_date := v_day.stat_date;
  end loop;

  if v_last_streak_date is not null
     and v_last_streak_date >= v_today - 1 then

    v_current_streak := 0;
    v_previous_date := null;

    for v_day in
      select stat_date
      from public.player_daily_stats
      where user_id=p_user_id
        and daily_games_completed > 0
        and stat_date <= v_last_streak_date
      order by stat_date desc
    loop
      if v_previous_date is null
         or v_day.stat_date = v_previous_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_previous_date := v_day.stat_date;
      else
        exit;
      end if;
    end loop;
  else
    v_current_streak := 0;
  end if;

  update public.player_progression
  set
    current_streak=v_current_streak,
    best_streak=v_best_streak,
    full_daily_count=v_full_daily_count,
    xp=v_xp,
    level=v_level,
    total_games=v_total_games,
    total_questions=v_total_questions,
    favorite_game_id=v_favorite_game,
    last_streak_date=v_last_streak_date,
    last_active_at=v_last_active_at,
    updated_at=now()
  where user_id=p_user_id;
end;
$$;

revoke execute on function public.refresh_brainilab_player_progression(uuid)
  from public,anon,authenticated;


-- ============================================================
-- TRIGGERS
-- ============================================================

create or replace function public.handle_brainilab_progression_result_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_brainilab_player_progression(new.user_id);
  return new;
end;
$$;

drop trigger if exists game_results_refresh_progression
  on public.game_results;

create trigger game_results_refresh_progression
after insert or update
on public.game_results
for each row
execute function public.handle_brainilab_progression_result_change();


create or replace function public.handle_brainilab_progression_profile_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_progression(user_id)
  values(new.user_id)
  on conflict(user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists profiles_create_progression
  on public.profiles;

create trigger profiles_create_progression
after insert
on public.profiles
for each row
execute function public.handle_brainilab_progression_profile_created();


-- ============================================================
-- RLS / BROWSER PERMISSIONS
-- Owner-readable; all writes are server/trigger controlled.
-- ============================================================

alter table public.player_progression enable row level security;
alter table public.player_daily_stats enable row level security;
alter table public.player_period_stats enable row level security;
alter table public.player_game_period_stats enable row level security;
alter table public.player_personal_bests enable row level security;

drop policy if exists "player_progression_select_own"
  on public.player_progression;

create policy "player_progression_select_own"
on public.player_progression
for select
to authenticated
using ((select auth.uid())=user_id);


drop policy if exists "player_daily_stats_select_own"
  on public.player_daily_stats;

create policy "player_daily_stats_select_own"
on public.player_daily_stats
for select
to authenticated
using ((select auth.uid())=user_id);


drop policy if exists "player_period_stats_select_own"
  on public.player_period_stats;

create policy "player_period_stats_select_own"
on public.player_period_stats
for select
to authenticated
using ((select auth.uid())=user_id);


drop policy if exists "player_game_period_stats_select_own"
  on public.player_game_period_stats;

create policy "player_game_period_stats_select_own"
on public.player_game_period_stats
for select
to authenticated
using ((select auth.uid())=user_id);


drop policy if exists "player_personal_bests_select_own"
  on public.player_personal_bests;

create policy "player_personal_bests_select_own"
on public.player_personal_bests
for select
to authenticated
using ((select auth.uid())=user_id);


revoke all on table public.player_progression
  from anon,authenticated;
revoke all on table public.player_daily_stats
  from anon,authenticated;
revoke all on table public.player_period_stats
  from anon,authenticated;
revoke all on table public.player_game_period_stats
  from anon,authenticated;
revoke all on table public.player_personal_bests
  from anon,authenticated;

grant select on table public.player_progression
  to authenticated;
grant select on table public.player_daily_stats
  to authenticated;
grant select on table public.player_period_stats
  to authenticated;
grant select on table public.player_game_period_stats
  to authenticated;
grant select on table public.player_personal_bests
  to authenticated;


-- ============================================================
-- ONE RPC FOR MY BRAINILAB
-- ============================================================

create or replace function public.get_my_brainilab_progression()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_week date := date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date := date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_daily_number integer;
  v_progression jsonb;
  v_today_stats jsonb;
  v_week_stats jsonb;
  v_month_stats jsonb;
  v_personal_bests jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select dc.daily_number
    into v_daily_number
  from public.daily_challenges dc
  where dc.challenge_date=v_today
  order by dc.generation_version desc
  limit 1;

  select to_jsonb(pp)
    into v_progression
  from public.player_progression pp
  where pp.user_id=v_user_id;

  select jsonb_build_object(
    'stat_date',v_today,
    'daily_number',v_daily_number,
    'games_played',coalesce(ds.games_played,0),
    'questions_answered',coalesce(ds.questions_answered,0),
    'daily_games_completed',coalesce(ds.daily_games_completed,0),
    'full_daily',coalesce(ds.full_daily,false),
    'brainmix_points',coalesce(ds.brainmix_points,0),
    'flagdash_points',coalesce(ds.flagdash_points,0),
    'maphunt_points',coalesce(ds.maphunt_points,0),
    'brainiword_points',coalesce(ds.brainiword_points,0),

    'brainmix_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainmix'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'flagdash_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='flagdash'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'maphunt_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='maphunt'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'brainiword_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainiword'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),

    'daily_brain_score',coalesce(ds.daily_brain_score,0),
    'xp_earned',coalesce(ds.xp_earned,0)
  )
  into v_today_stats
  from (select 1) seed
  left join public.player_daily_stats ds
    on ds.user_id=v_user_id
   and ds.stat_date=v_today;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','week',
      'period_start',v_week,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_week_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='week'
   and ps.period_start=v_week;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','month',
      'period_start',v_month,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_month_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='month'
   and ps.period_start=v_month;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'game_id',pb.game_id,
        'result_id',pb.result_id,
        'metric_name',pb.metric_name,
        'metric_value',pb.metric_value,
        'score',pb.score,
        'correct_answers',pb.correct_answers,
        'total_questions',pb.total_questions,
        'accuracy',pb.accuracy,
        'duration_ms',pb.duration_ms,
        'result_payload',pb.result_payload,
        'achieved_at',pb.achieved_at
      )
      order by pb.game_id
    ),
    '[]'::jsonb
  )
  into v_personal_bests
  from public.player_personal_bests pb
  where pb.user_id=v_user_id;

  return jsonb_build_object(
    'progression',coalesce(
      v_progression,
      jsonb_build_object(
        'user_id',v_user_id,
        'current_streak',0,
        'best_streak',0,
        'full_daily_count',0,
        'xp',0,
        'level',1,
        'total_games',0,
        'total_questions',0,
        'favorite_game_id',null
      )
    ),
    'today',v_today_stats,
    'week',v_week_stats,
    'month',v_month_stats,
    'personal_bests',v_personal_bests,
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_my_brainilab_progression()
  from public,anon;

grant execute on function public.get_my_brainilab_progression()
  to authenticated;


-- ============================================================
-- INITIAL BACKFILL
-- Creates progression rows for every current profile and rebuilds
-- any game history already stored by Steps 3–5.
-- ============================================================

insert into public.player_progression(user_id)
select p.user_id
from public.profiles p
on conflict(user_id) do nothing;

do $$
declare
  v_user record;
begin
  for v_user in
    select p.user_id
    from public.profiles p
  loop
    perform public.refresh_brainilab_player_progression(
      v_user.user_id
    );
  end loop;
end;
$$;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- My current progression:
--
-- select *
-- from public.player_progression;
--
-- Daily stats:
--
-- select *
-- from public.player_daily_stats
-- order by stat_date desc;
--
-- Current week/month:
--
-- select *
-- from public.player_period_stats
-- order by period_start desc,period_type;
--
-- Personal bests:
--
-- select
--   game_id,
--   metric_name,
--   metric_value,
--   score,
--   correct_answers,
--   accuracy,
--   achieved_at
-- from public.player_personal_bests
-- order by game_id;
