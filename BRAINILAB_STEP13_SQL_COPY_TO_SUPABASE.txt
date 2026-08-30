-- BrainiLab Backend — Step 13: UX progression tiers in rankings
-- Run after Step 12.
--
-- Adds the already-existing player progression LEVEL to ranking payloads.
-- No new player data is created and no email/auth metadata is exposed.
-- The frontend maps level -> BrainiLab academic rank/badge.

begin;

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
          'level',coalesce((
            select pp2.level
            from public.player_progression pp2
            where pp2.user_id=r.user_id
          ),1),
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
        'level',coalesce((
          select pp2.level
          from public.player_progression pp2
          where pp2.user_id=mine.user_id
        ),1),
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
        'brainmix','flagdash','maphunt','topicrush','brainiword'
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
  v_country text:=upper(nullif(btrim(coalesce(p_country_code,'')),''));
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));
  v_limit integer:=least(100,greatest(10,coalesce(p_limit,100)));
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
        when v_game in ('brainmix','flagdash','maphunt','topicrush','brainiword')
          then 'Daily points'
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
      and not exists(
        select 1
        from public.admin_ranking_suspensions ars
        where ars.entity_type='user'
          and ars.entity_id=p.user_id
          and ars.active=true
          and (
            ars.expires_at is null
            or ars.expires_at>now()
          )
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
          'level',coalesce((
            select pp_level.level
            from public.player_progression pp_level
            where pp_level.user_id=r.user_id
          ),1),
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
              then r.rank_value::text||' days'
            else to_char(r.rank_value,'FM999G999G999G990')
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
        'level',coalesce((
          select pp_level.level
          from public.player_progression pp_level
          where pp_level.user_id=mine.user_id
        ),1),
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
            then mine.rank_value::text||' days'
          else to_char(mine.rank_value,'FM999G999G999G990')
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
      limit 1
    ),
    exists(
      select 1 from ranked mine
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
      when v_game in ('brainmix','flagdash','maphunt','topicrush','brainiword')
        then 'Daily points'
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


commit;

-- Verify:
-- select routine_name
-- from information_schema.routines
-- where routine_schema='public'
--   and routine_name in (
--     'get_my_brainilab_friends_ranking',
--     'get_brainilab_individual_rankings'
--   )
-- order by routine_name;
