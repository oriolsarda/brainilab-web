-- BrainiLab Backend — Step 10: Final Rankings
-- Run after Steps 1–9.
--
-- Final ranking system:
-- - Individual: real public opt-in leaderboard
-- - Friends: real accepted-friends ranking
-- - Groups: real eligible-group ranking
-- - Global / Country
-- - Daily / Weekly / Monthly
-- - All games / specific games
-- - Score / current streak
-- - Top 100 + own exact rank
--
-- Privacy:
-- - Individual ranking includes ONLY profiles with leaderboard_enabled=true
-- - only leaderboard_display_name + country are exposed publicly
-- - email, friend code, Google/Auth data and private display name are not exposed
-- - Friends ranking is restricted to authenticated accepted-friend graph
--
-- Score semantics:
-- - All games = Daily Brain Score
-- - Daily games (Brain Mix / Flag Dash / Map Hunt / BrainiWord)
--   = sum of their normalized 0–2,500 Daily contribution points
-- - evergreen games = accumulated game score for the selected period
-- - streak = current Daily streak; period/game filters do not change it

begin;

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

create index if not exists profiles_public_ranking_idx
  on public.profiles(
    leaderboard_enabled,
    country_code,
    user_id
  )
  where leaderboard_enabled=true;

create index if not exists player_daily_brainmix_rank_idx
  on public.player_daily_stats(stat_date,brainmix_points desc);

create index if not exists player_daily_flagdash_rank_idx
  on public.player_daily_stats(stat_date,flagdash_points desc);

create index if not exists player_daily_maphunt_rank_idx
  on public.player_daily_stats(stat_date,maphunt_points desc);

create index if not exists player_daily_brainiword_rank_idx
  on public.player_daily_stats(stat_date,brainiword_points desc);


-- ============================================================
-- INTERNAL NORMALIZED PLAYER SCORE
-- Used by Friends + internal ranking calculations.
-- ============================================================

create or replace function public.brainilab_player_rank_value(
  p_user_id uuid,
  p_period text,
  p_game_id text,
  p_metric text
)
returns bigint
language plpgsql
stable
security definer
set search_path=public
as $$
declare
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

  v_value bigint:=0;
  v_period_type text;
  v_period_start date;
begin
  if p_user_id is null then
    return 0;
  end if;

  if v_metric='streak' then
    select coalesce(pp.current_streak,0)::bigint
      into v_value
    from public.player_progression pp
    where pp.user_id=p_user_id;

    return coalesce(v_value,0);
  end if;

  if v_period not in ('daily','weekly','monthly') then
    return 0;
  end if;

  -- All games: Daily Brain Score.
  if v_game='all' then
    if v_period='daily' then
      select coalesce(ds.daily_brain_score,0)::bigint
        into v_value
      from public.player_daily_stats ds
      where ds.user_id=p_user_id
        and ds.stat_date=v_today;
    elsif v_period='weekly' then
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='week'
        and ps.period_start=v_week;
    else
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='month'
        and ps.period_start=v_month;
    end if;

    return coalesce(v_value,0);
  end if;

  -- Daily games use normalized Daily Brain Score contribution points.
  if v_game in ('brainmix','flagdash','maphunt','brainiword') then
    select coalesce(
      sum(
        case v_game
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'maphunt' then ds.maphunt_points
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      ),
      0
    )::bigint
    into v_value
    from public.player_daily_stats ds
    where ds.user_id=p_user_id
      and (
        (v_period='daily' and ds.stat_date=v_today)
        or
        (
          v_period='weekly'
          and ds.stat_date between v_week and v_today
        )
        or
        (
          v_period='monthly'
          and ds.stat_date between v_month and v_today
        )
      );

    return coalesce(v_value,0);
  end if;

  -- Evergreen game score.
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

  select coalesce(gps.total_score,0)::bigint
    into v_value
  from public.player_game_period_stats gps
  where gps.user_id=p_user_id
    and gps.game_id=v_game
    and gps.period_type=v_period_type
    and gps.period_start=v_period_start;

  return coalesce(v_value,0);
end;
$$;

revoke execute on function public.brainilab_player_rank_value(
  uuid,text,text,text
) from public,anon,authenticated;


-- ============================================================
-- PUBLIC INDIVIDUAL RANKING
-- Safe for anon because only explicit leaderboard opt-ins are returned.
-- ============================================================

create or replace function public.get_brainilab_individual_rankings(
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
  v_country text:=upper(
    nullif(btrim(coalesce(p_country_code,'')),'')
  );
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_limit integer:=least(
    100,
    greatest(10,coalesce(p_limit,100))
  );

  v_my_country text;
  v_my_enabled boolean:=false;
  v_my_public_name text;

  v_rows jsonb;
  v_user jsonb;
  v_total integer:=0;
  v_user_eligible boolean:=false;
begin
  if v_region not in ('global','country') then
    raise exception 'Invalid ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
  end if;

  if v_me is not null then
    select
      p.country_code,
      p.leaderboard_enabled,
      p.leaderboard_display_name
    into
      v_my_country,
      v_my_enabled,
      v_my_public_name
    from public.profiles p
    where p.user_id=v_me;

    if v_country is null then
      v_country:=v_my_country;
    end if;
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then

    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Streak'
        when v_game='all' then 'Brain Score'
        when v_game in (
          'brainmix','flagdash','maphunt','brainiword'
        ) then 'Daily points'
        else 'Points'
      end,
      'leaderboard_enabled',v_my_enabled,
      'leaderboard_display_name',v_my_public_name,
      'user_eligible',false,
      'country_required',true,
      'my_country',v_my_country,
      'generated_at',now()
    );
  end if;

  with candidates as (
    select
      p.user_id,
      p.leaderboard_display_name as public_name,
      p.country_code,

      public.brainilab_player_rank_value(
        p.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value

    from public.profiles p
    where p.leaderboard_enabled=true
      and p.leaderboard_display_name is not null
      and char_length(btrim(p.leaderboard_display_name))>=2
      and (
        v_region='global'
        or p.country_code=v_country
      )
  ),
  eligible as (
    select *
    from candidates
    where rank_value>0
  ),
  ranked as (
    select
      e.*,
      row_number() over(
        order by
          e.rank_value desc,
          lower(e.public_name),
          e.user_id
      ) as rank
    from eligible e
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'name',r.public_name,
          'country',r.country_code,
          'avatar',upper(left(r.public_name,1)),
          'score',r.rank_value,
          'streak',case
            when v_metric='streak' then r.rank_value
            else (
              select coalesce(pp.current_streak,0)
              from public.player_progression pp
              where pp.user_id=r.user_id
            )
          end,
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text || ' days'
            else to_char(
              r.rank_value,
              'FM999G999G999G990'
            )
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),

    count(*)::integer,

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'name',mine.public_name,
        'country',mine.country_code,
        'avatar',upper(left(mine.public_name,1)),
        'score',mine.rank_value,
        'streak',case
          when v_metric='streak' then mine.rank_value
          else (
            select coalesce(pp.current_streak,0)
            from public.player_progression pp
            where pp.user_id=mine.user_id
          )
        end,
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text || ' days'
          else to_char(
            mine.rank_value,
            'FM999G999G999G990'
          )
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
      limit 1
    ),

    exists(
      select 1
      from ranked mine
      where mine.user_id=v_me
    )

  into
    v_rows,
    v_total,
    v_user,
    v_user_eligible
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'total_players',v_total,

    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in (
        'brainmix','flagdash','maphunt','brainiword'
      ) then 'Daily points'
      else 'Points'
    end,

    'leaderboard_enabled',v_my_enabled,
    'leaderboard_display_name',v_my_public_name,
    'user_eligible',v_user_eligible,

    'region',v_region,
    'country',v_country,
    'my_country',v_my_country,
    'period',v_period,
    'game_id',v_game,

    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_brainilab_individual_rankings(
  text,text,text,text,text,integer
) from public;

grant execute on function public.get_brainilab_individual_rankings(
  text,text,text,text,text,integer
) to anon,authenticated;


-- ============================================================
-- FINAL FRIENDS RANKING
-- Standardizes selected Daily games to 0–2,500/day BrainiLab points.
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

  with members as (
    select v_me as user_id

    union

    select
      case
        when f.user_a=v_me then f.user_b
        else f.user_a
      end
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

      public.brainilab_player_rank_value(
        m.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value

    from members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_progression pp
      on pp.user_id=m.user_id
  ),
  ranked as (
    select
      v.*,
      row_number() over(
        order by
          v.rank_value desc,
          lower(v.display_name),
          v.user_id
      ) as rank
    from values_by_member v
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'user_id',r.user_id,
          'name',r.display_name,
          'country',r.country_code,
          'avatar_url',r.avatar_url,
          'avatar',upper(left(r.display_name,1)),
          'score',r.rank_value,
          'streak',r.streak,
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text || ' days'
            else to_char(
              r.rank_value,
              'FM999G999G999G990'
            )
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ),
      '[]'::jsonb
    ),

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'user_id',mine.user_id,
        'name',mine.display_name,
        'country',mine.country_code,
        'avatar_url',mine.avatar_url,
        'avatar',upper(left(mine.display_name,1)),
        'score',mine.rank_value,
        'streak',mine.streak,
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text || ' days'
          else to_char(
            mine.rank_value,
            'FM999G999G999G990'
          )
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
    )

  into v_rows,v_me_row
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_me_row,

    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in (
        'brainmix','flagdash','maphunt','brainiword'
      ) then 'Daily points'
      else 'Points'
    end,

    'total_players',jsonb_array_length(v_rows),
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.get_my_brainilab_friends_ranking(
  text,text,text
) from public,anon;

grant execute on function public.get_my_brainilab_friends_ranking(
  text,text,text
) to authenticated;


-- ============================================================
-- FINAL NORMALIZED GROUP PER-GAME AGGREGATES
-- Step 9 already owns All-game Daily/Week/Month.
-- This replaces only per-game aggregate semantics.
-- ============================================================

create or replace function public.refresh_brainilab_group_game_rank_stats(
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

  delete from public.group_game_period_stats
  where group_id=p_group_id;

  -- ----------------------------------------------------------
  -- Daily Games: normalized Daily contribution points.
  -- ----------------------------------------------------------

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
  daily_values as (
    select
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start,

      sum(
        case games.game_id
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'maphunt' then ds.maphunt_points
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      )::bigint as score

    from public.player_daily_stats ds

    join members m
      on m.user_id=ds.user_id

    cross join (
      values
        ('brainmix'::text),
        ('flagdash'::text),
        ('maphunt'::text),
        ('brainiword'::text)
    ) games(game_id)

    cross join lateral (
      values
        ('day'::text,ds.stat_date),
        (
          'week'::text,
          date_trunc(
            'week',
            ds.stat_date::timestamp
          )::date
        ),
        (
          'month'::text,
          date_trunc(
            'month',
            ds.stat_date::timestamp
          )::date
        )
    ) periods(period_type,period_start)

    group by
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start
  ),
  period_keys as (
    select distinct
      dv.game_id,
      dv.period_type,
      dv.period_start
    from daily_values dv
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(dv.score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(dv.score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(dv.score,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join daily_values dv
      on dv.user_id=m.user_id
     and dv.game_id=pk.game_id
     and dv.period_type=pk.period_type
     and dv.period_start=pk.period_start
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


  -- ----------------------------------------------------------
  -- Evergreen games: accumulated raw score.
  -- ----------------------------------------------------------

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
  period_keys as (
    select distinct
      gps.game_id,
      gps.period_type,
      gps.period_start
    from public.player_game_period_stats gps
    join members m
      on m.user_id=gps.user_id
    where gps.game_id not in (
      'brainmix','flagdash','maphunt','brainiword'
    )
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(gps.total_score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(gps.total_score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(gps.games_played,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_game_period_stats gps
      on gps.user_id=m.user_id
     and gps.game_id=pk.game_id
     and gps.period_type=pk.period_type
     and gps.period_start=pk.period_start
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

revoke execute on function public.refresh_brainilab_group_game_rank_stats(
  uuid
) from public,anon,authenticated;


-- Membership changes: rebuild Step 9 all-game stats, then normalized game stats.
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
  perform public.refresh_brainilab_group_game_rank_stats(v_group_id);

  if tg_op='DELETE' then
    return old;
  end if;

  return new;
end;
$$;


-- Game results: Step 6 progression refresh trigger runs before this zz trigger.
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
    perform public.refresh_brainilab_group_stats(
      v_group.group_id
    );

    perform public.refresh_brainilab_group_game_rank_stats(
      v_group.group_id
    );
  end loop;

  return new;
end;
$$;


-- ============================================================
-- FINAL GROUP RANKING RPC
-- Same interface as Step 9; normalized per-game table now backs it.
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
  v_country text:=upper(
    nullif(btrim(coalesce(p_country_code,'')),'')
  );
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

  v_limit integer:=least(
    100,
    greatest(10,coalesce(p_limit,100))
  );

  v_rows jsonb;
  v_user jsonb;
  v_my_groups jsonb;
  v_total integer;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

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
        when v_game='all' then 'Group Brain Score'
        when v_game in (
          'brainmix','flagdash','maphunt','brainiword'
        ) then 'Group Daily points'
        else 'Group points'
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
          then public.brainilab_group_current_streak(
            gb.id
          )::bigint

        when v_game='all'
             and v_period='daily'
          then coalesce(gds.group_score,0)

        when v_game='all'
             and v_period in ('weekly','monthly')
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
  eligible as (
    select *
    from scored
    where score>0
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
    from eligible s
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
            else public.brainilab_group_current_streak(
              r.id
            )
          end,

          'display_value',case
            when v_metric='streak'
              then r.score::text || ' days'
            else to_char(
              r.score,
              'FM999G999G999G990'
            )
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
          else public.brainilab_group_current_streak(
            mine.id
          )
        end,

        'display_value',case
          when v_metric='streak'
            then mine.score::text || ' days'
          else to_char(
            mine.score,
            'FM999G999G999G990'
          )
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
      when v_game='all' then 'Group Brain Score'
      when v_game in (
        'brainmix','flagdash','maphunt','brainiword'
      ) then 'Group Daily points'
      else 'Group points'
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
-- BACKFILL NORMALIZED GROUP PER-GAME STATS
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
    perform public.refresh_brainilab_group_game_rank_stats(
      v_group.id
    );
  end loop;
end;
$$;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- Public individual ranking RPC:
--
-- select routine_name
-- from information_schema.routines
-- where routine_schema='public'
--   and routine_name='get_brainilab_individual_rankings';
--
-- Current public opt-ins:
--
-- select
--   count(*) as public_ranking_profiles
-- from public.profiles
-- where leaderboard_enabled=true;
--
-- Test as your signed-in user in the frontend:
-- Rankings → Individual
--
-- If your ranking profile is private, use the "Join rankings" control.
--
-- The ranking should never expose email:
-- get_brainilab_individual_rankings() returns only
-- public leaderboard name, country, initial and ranking metrics.
