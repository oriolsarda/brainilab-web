-- BrainiLab Step 24 — V41.6.0
-- Survival flag rendering is frontend-only.
-- This migration updates Higher or Lower comparison language/data,
-- removes deprecated Map Hunt from new cloud data collection,
-- and makes Admin Game Analytics show every active game (including Sports) even at 0 plays.
-- Run once AFTER Step 23.

begin;

-- ============================================================
-- HIGHER OR LOWER — NATURAL COMPARISON TYPES
-- ============================================================

alter table public.higher_lower_pairs
  add column if not exists comparison_type text not null default 'higher_lower';

alter table public.higher_lower_pairs
  drop constraint if exists higher_lower_comparison_type;

alter table public.higher_lower_pairs
  add constraint higher_lower_comparison_type
  check (
    comparison_type in (
      'higher_lower',
      'older_younger',
      'taller_shorter',
      'richer_poorer',
      'bigger_smaller',
      'faster_slower',
      'hotter_colder',
      'heavier_lighter',
      'longer_shorter',
      'farther_closer',
      'earlier_later',
      'more_less'
    )
  );

-- Migrate the 20 starter pairs to natural comparison language.
update public.higher_lower_pairs
set comparison_type = case external_key
  when 'hl-everest-k2' then 'higher_lower'
  when 'hl-earth-mars' then 'bigger_smaller'
  when 'hl-jupiter-saturn' then 'bigger_smaller'
  when 'hl-canada-china' then 'bigger_smaller'
  when 'hl-australia-india' then 'bigger_smaller'
  when 'hl-light-sound' then 'faster_slower'
  when 'hl-water-iron' then 'higher_lower'
  when 'hl-pacific-atlantic' then 'bigger_smaller'
  when 'hl-venus-mercury' then 'hotter_colder'
  when 'hl-moon-iss' then 'farther_closer'
  when 'hl-titanic-moon' then 'earlier_later'
  when 'hl-printing-phone' then 'earlier_later'
  when 'hl-ww2-iphone' then 'earlier_later'
  when 'hl-beethoven-mozart' then 'older_younger'
  when 'hl-whale-giraffe' then 'longer_shorter'
  when 'hl-cheetah-lion' then 'faster_slower'
  when 'hl-human-chimp' then 'more_less'
  when 'hl-h-he' then 'higher_lower'
  when 'hl-gold-silver' then 'higher_lower'
  when 'hl-fuji-montblanc' then 'higher_lower'
  else comparison_type
end,
left_label = case external_key
  when 'hl-moon-iss' then 'the Moon'
  when 'hl-titanic-moon' then 'the Titanic sinking'
  when 'hl-printing-phone' then 'the Gutenberg printing press'
  when 'hl-ww2-iphone' then 'World War II ending'
  when 'hl-whale-giraffe' then 'a blue whale'
  when 'hl-cheetah-lion' then 'a cheetah'
  when 'hl-human-chimp' then 'a human'
  else left_label
end,
right_label = case external_key
  when 'hl-moon-iss' then 'the ISS'
  when 'hl-titanic-moon' then 'the first Moon landing'
  when 'hl-printing-phone' then 'the telephone'
  when 'hl-ww2-iphone' then 'the first iPhone release'
  when 'hl-whale-giraffe' then 'a giraffe'
  when 'hl-cheetah-lion' then 'a lion'
  when 'hl-human-chimp' then 'a chimpanzee'
  else right_label
end,
explanation = case external_key
  when 'hl-beethoven-mozart' then 'Mozart was born 14 years before Beethoven, so Mozart was older.'
  else explanation
end,
updated_at = now()
where external_key in (
  'hl-everest-k2','hl-earth-mars','hl-jupiter-saturn','hl-canada-china',
  'hl-australia-india','hl-light-sound','hl-water-iron','hl-pacific-atlantic',
  'hl-venus-mercury','hl-moon-iss','hl-titanic-moon','hl-printing-phone',
  'hl-ww2-iphone','hl-beethoven-mozart','hl-whale-giraffe','hl-cheetah-lion',
  'hl-human-chimp','hl-h-he','hl-gold-silver','hl-fuji-montblanc'
);

create or replace function public.brainilab_higher_lower_direction(
  p_comparison_type text,
  p_left_value numeric,
  p_right_value numeric
)
returns text
language plpgsql
immutable
set search_path=public
as $$
begin
  if p_left_value is null or p_right_value is null or p_left_value=p_right_value then
    raise exception 'Higher or Lower values must be distinct';
  end if;

  if p_comparison_type in ('older_younger','earlier_later') then
    return case when p_right_value>p_left_value then 'second' else 'first' end;
  end if;

  return case when p_right_value>p_left_value then 'first' else 'second' end;
end;
$$;

create or replace function public.brainilab_higher_lower_label(
  p_comparison_type text,
  p_direction text
)
returns text
language sql
immutable
set search_path=public
as $$
  select case p_comparison_type
    when 'higher_lower' then case p_direction when 'first' then 'Higher' else 'Lower' end
    when 'older_younger' then case p_direction when 'first' then 'Older' else 'Younger' end
    when 'taller_shorter' then case p_direction when 'first' then 'Taller' else 'Shorter' end
    when 'richer_poorer' then case p_direction when 'first' then 'Richer' else 'Poorer' end
    when 'bigger_smaller' then case p_direction when 'first' then 'Bigger' else 'Smaller' end
    when 'faster_slower' then case p_direction when 'first' then 'Faster' else 'Slower' end
    when 'hotter_colder' then case p_direction when 'first' then 'Hotter' else 'Colder' end
    when 'heavier_lighter' then case p_direction when 'first' then 'Heavier' else 'Lighter' end
    when 'longer_shorter' then case p_direction when 'first' then 'Longer' else 'Shorter' end
    when 'farther_closer' then case p_direction when 'first' then 'Farther' else 'Closer' end
    when 'earlier_later' then case p_direction when 'first' then 'Earlier' else 'Later' end
    when 'more_less' then case p_direction when 'first' then 'More' else 'Less' end
    else case p_direction when 'first' then 'Higher' else 'Lower' end
  end;
$$;

create or replace function public.get_brainilab_higher_lower_game(
  p_exclude_pair_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_payload jsonb;
begin
  with ranked as (
    select
      p.*,
      coalesce(h.times_played,0)
        +case when p.id=any(coalesce(p_exclude_pair_ids,array[]::uuid[])) then 1 else 0 end as play_weight,
      case when p.id=any(coalesce(p_exclude_pair_ids,array[]::uuid[])) then now() else h.last_played_at end as last_weight
    from public.higher_lower_pairs p
    left join public.player_higher_lower_history h
      on v_uid is not null
      and h.user_id=v_uid
      and h.pair_id=p.id
    where p.is_active=true
    order by play_weight asc,last_weight asc nulls first,random()
    limit 10
  )
  select jsonb_build_object(
    'pairs',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'pair_id',id,
          'external_key',external_key,
          'category',category,
          'comparison_type',comparison_type,
          'metric',metric,
          'left_label',left_label,
          'left_value',left_value,
          'right_label',right_label,
          'unit',unit
        )
      ),
      '[]'::jsonb
    )
  ) into v_payload
  from ranked;

  return v_payload;
end;
$$;

revoke execute on function public.get_brainilab_higher_lower_game(uuid[]) from public;
grant execute on function public.get_brainilab_higher_lower_game(uuid[]) to anon,authenticated;

create or replace function public.check_brainilab_higher_lower_answer(
  p_pair_id uuid,
  p_choice text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_left numeric;
  v_right numeric;
  v_type text;
  v_exp text;
  v_direction text;
  v_label text;
  v_choice text:=lower(btrim(coalesce(p_choice,'')));
begin
  if v_choice not in ('first','second') then
    raise exception 'Choice must be first or second';
  end if;

  select left_value,right_value,comparison_type,explanation
  into v_left,v_right,v_type,v_exp
  from public.higher_lower_pairs
  where id=p_pair_id and is_active=true;

  if v_left is null then
    raise exception 'Higher or Lower pair unavailable';
  end if;

  v_direction:=public.brainilab_higher_lower_direction(v_type,v_left,v_right);
  v_label:=public.brainilab_higher_lower_label(v_type,v_direction);

  return jsonb_build_object(
    'correct',v_choice=v_direction,
    'direction',v_direction,
    'label',v_label,
    'right_value',v_right,
    'explanation',v_exp
  );
end;
$$;

revoke execute on function public.check_brainilab_higher_lower_answer(uuid,text) from public;
grant execute on function public.check_brainilab_higher_lower_answer(uuid,text) to anon,authenticated;

create or replace function public.verify_brainilab_higher_lower_result(
  p_client_result_id text,
  p_rounds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_result uuid;
  v_row jsonb;
  v_id uuid;
  v_choice text;
  v_left numeric;
  v_right numeric;
  v_type text;
  v_direction text;
  v_correct integer:=0;
  v_combo integer:=0;
  v_score integer:=0;
  v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_rounds)<>10 then
    raise exception 'Higher or Lower requires exactly 10 rounds';
  end if;

  select gr.id into v_result
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid
    and gs.client_result_id=p_client_result_id
    and gs.game_id='higherlower'
  limit 1;

  if v_result is null then raise exception 'Higher or Lower result not found'; end if;

  for v_row in select value from jsonb_array_elements(p_rounds)
  loop
    v_id:=(v_row->>'pair_id')::uuid;
    v_choice:=lower(btrim(v_row->>'choice'));

    if v_id=any(v_seen) then raise exception 'Duplicate Higher or Lower pair'; end if;
    v_seen:=array_append(v_seen,v_id);

    if v_choice not in ('first','second') then
      raise exception 'Invalid Higher or Lower choice';
    end if;

    select left_value,right_value,comparison_type
    into v_left,v_right,v_type
    from public.higher_lower_pairs
    where id=v_id;

    if v_left is null then raise exception 'Higher or Lower pair not found'; end if;

    v_direction:=public.brainilab_higher_lower_direction(v_type,v_left,v_right);

    if v_choice=v_direction then
      v_correct:=v_correct+1;
      v_combo:=v_combo+1;
      v_score:=v_score+100+least(100,greatest(0,v_combo-1)*20);
    else
      v_combo:=0;
    end if;
  end loop;

  update public.game_results
  set score=v_score,
      correct_answers=v_correct,
      total_questions=10,
      accuracy=v_correct*10,
      answers_verified=true,
      verified_correct_answers=v_correct,
      verified_total_questions=10,
      answers_verified_at=now()
  where id=v_result;

  return jsonb_build_object(
    'answers_verified',true,
    'correct_answers',v_correct,
    'total_questions',10,
    'accuracy',v_correct*10,
    'score',v_score
  );
end;
$$;

revoke execute on function public.verify_brainilab_higher_lower_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_higher_lower_result(text,jsonb) to authenticated;

-- Remove the old Admin creator signature so new content must declare its comparison language.
drop function if exists public.admin_create_higher_lower_pair(
  text,text,text,text,numeric,text,numeric,text,text
);

create or replace function public.admin_create_higher_lower_pair(
  p_external_key text,
  p_category text,
  p_comparison_type text,
  p_metric text,
  p_left_label text,
  p_left_value numeric,
  p_right_label text,
  p_right_value numeric,
  p_unit text default '',
  p_explanation text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_type text:=lower(btrim(coalesce(p_comparison_type,'')));
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);

  if lower(btrim(coalesce(p_external_key,''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Invalid external key';
  end if;

  if v_type not in (
    'higher_lower','older_younger','taller_shorter','richer_poorer',
    'bigger_smaller','faster_slower','hotter_colder','heavier_lighter',
    'longer_shorter','farther_closer','earlier_later','more_less'
  ) then
    raise exception 'Invalid comparison type';
  end if;

  if char_length(btrim(coalesce(p_metric,'')))<2
     or char_length(btrim(coalesce(p_left_label,'')))<1
     or char_length(btrim(coalesce(p_right_label,'')))<1 then
    raise exception 'Metric and both labels are required';
  end if;

  if p_left_value=p_right_value then
    raise exception 'Higher or Lower values cannot tie';
  end if;

  insert into public.higher_lower_pairs(
    external_key,category,comparison_type,metric,
    left_label,left_value,right_label,right_value,
    unit,explanation,is_active
  )
  values(
    lower(btrim(p_external_key)),
    lower(btrim(coalesce(p_category,'general'))),
    v_type,
    btrim(p_metric),
    btrim(p_left_label),p_left_value,
    btrim(p_right_label),p_right_value,
    btrim(coalesce(p_unit,'')),
    btrim(coalesce(p_explanation,'')),
    true
  )
  returning id into v_id;

  perform public.log_brainilab_admin_action(
    'HIGHER_LOWER_CREATED','higher_lower_pair',v_id::text,
    jsonb_build_object('external_key',p_external_key,'comparison_type',v_type)
  );

  return jsonb_build_object('id',v_id,'created',true);
end;
$$;

revoke execute on function public.admin_create_higher_lower_pair(
  text,text,text,text,text,numeric,text,numeric,text,text
) from public,anon;

grant execute on function public.admin_create_higher_lower_pair(
  text,text,text,text,text,numeric,text,numeric,text,text
) to authenticated;

create or replace function public.admin_list_higher_lower_pairs()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'external_key',p.external_key,
        'category',p.category,
        'comparison_type',p.comparison_type,
        'metric',p.metric,
        'left_label',p.left_label,
        'left_value',p.left_value,
        'right_label',p.right_label,
        'right_value',p.right_value,
        'unit',p.unit,
        'explanation',p.explanation,
        'active',p.is_active,
        'play_count',(
          select coalesce(sum(h.times_played),0)
          from public.player_higher_lower_history h
          where h.pair_id=p.id
        )
      )
      order by p.is_active desc,p.category,p.external_key
    ),
    '[]'::jsonb
  ) into v_payload
  from public.higher_lower_pairs p;

  return v_payload;
end;
$$;

revoke execute on function public.admin_list_higher_lower_pairs() from public,anon;
grant execute on function public.admin_list_higher_lower_pairs() to authenticated;

-- Recreate generic CSV importer with comparison_type support.
create or replace function public.admin_import_content_pool(
  p_pool_type text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_type text:=lower(btrim(coalesce(p_pool_type,'')));
  v_row jsonb;
  v_created integer:=0;
  v_failed integer:=0;
  v_errors jsonb:='[]'::jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);

  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then
    raise exception 'Import rows must be an array';
  end if;

  if jsonb_array_length(p_rows)>500 then
    raise exception 'Import limit is 500 rows at a time';
  end if;

  if v_type not in ('brainiword','topicrush','orderup','connections','oddoneout','higherlower') then
    raise exception 'Unsupported content pool type';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      case v_type
        when 'brainiword' then
          perform public.admin_add_brainiword_word(v_row->>'word');
        when 'topicrush' then
          perform public.admin_create_topic_rush_topic(
            v_row->>'external_key',v_row->>'title',v_row->>'prompt',
            (v_row->>'target_count')::integer,v_row->'answers'
          );
        when 'orderup' then
          perform public.admin_create_order_up_round(
            v_row->>'external_key',v_row->>'title',v_row->>'prompt',
            v_row->>'direction_label',v_row->>'category',v_row->'items'
          );
        when 'connections' then
          perform public.admin_create_connections_puzzle(
            v_row->>'external_key',v_row->>'category',v_row->>'prompt',
            v_row->'clues',v_row->>'correct_connection',v_row->'distractors',
            coalesce(v_row->>'explanation','')
          );
        when 'oddoneout' then
          perform public.admin_create_odd_one_out_puzzle(
            v_row->>'external_key',v_row->>'category',v_row->>'prompt',
            v_row->'items',(v_row->>'odd_index')::integer,
            coalesce(v_row->>'explanation','')
          );
        when 'higherlower' then
          perform public.admin_create_higher_lower_pair(
            v_row->>'external_key',
            v_row->>'category',
            v_row->>'comparison_type',
            v_row->>'metric',
            v_row->>'left_label',
            (v_row->>'left_value')::numeric,
            v_row->>'right_label',
            (v_row->>'right_value')::numeric,
            coalesce(v_row->>'unit',''),
            coalesce(v_row->>'explanation','')
          );
      end case;

      v_created:=v_created+1;
    exception when others then
      v_failed:=v_failed+1;
      v_errors:=v_errors||jsonb_build_array(
        jsonb_build_object(
          'external_key',coalesce(v_row->>'external_key',v_row->>'word'),
          'error',sqlerrm
        )
      );
    end;
  end loop;

  perform public.log_brainilab_admin_action(
    'CONTENT_POOL_IMPORT_COMPLETED',v_type,null,
    jsonb_build_object('created',v_created,'failed',v_failed)
  );

  return jsonb_build_object('created',v_created,'failed',v_failed,'errors',v_errors);
end;
$$;

revoke execute on function public.admin_import_content_pool(text,jsonb) from public,anon;
grant execute on function public.admin_import_content_pool(text,jsonb) to authenticated;

-- ============================================================
-- MAP HUNT — DEPRECATED: NO NEW CLOUD COLLECTION
-- ============================================================

create or replace function public.brainilab_block_deprecated_game_sessions()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.game_id='maphunt' then
    raise exception 'Map Hunt is deprecated and no longer accepts game results';
  end if;
  return new;
end;
$$;

drop trigger if exists brainilab_block_deprecated_game_sessions_trg
on public.game_sessions;

create trigger brainilab_block_deprecated_game_sessions_trg
before insert or update of game_id
on public.game_sessions
for each row
execute function public.brainilab_block_deprecated_game_sessions();

-- ============================================================
-- ADMIN GAME ANALYTICS — ACTIVE GAMES, INCLUDING ZERO-PLAY SPORTS
-- ============================================================

create or replace function public.admin_get_game_analytics(
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_days integer:=least(365,greatest(1,coalesce(p_days,30)));
  v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);

  with active_games(game_id) as (
    values
      ('brainmix'::text),
      ('orderup'::text),
      ('topicrush'::text),
      ('brainiword'::text),
      ('generalknowledge'::text),
      ('worldflags'::text),
      ('worldcapitals'::text),
      ('science'::text),
      ('history'::text),
      ('sports'::text),
      ('connections'::text),
      ('survival'::text),
      ('oddoneout'::text),
      ('higherlower'::text)
  ),
  w as (
    select
      gs.game_id,
      gs.user_id,
      gs.completed_at,
      gr.score,
      gr.accuracy,
      gr.duration_ms,
      gr.answers_verified
    from public.game_sessions gs
    join public.game_results gr on gr.session_id=gs.id
    join active_games ag on ag.game_id=gs.game_id
    where gs.status='completed'
      and gs.completed_at>=now()-(v_days||' days')::interval
  ),
  agg as (
    select
      game_id,
      count(*)::integer as plays,
      count(distinct user_id)::integer as unique_players,
      round(avg(score)::numeric,1) as avg_score,
      round(avg(accuracy)::numeric,1) as avg_accuracy,
      round((avg(duration_ms)/1000.0)::numeric,1) as avg_duration_sec,
      max(completed_at) as last_played,
      round((100.0*count(*) filter(where answers_verified=true)/nullif(count(*),0))::numeric,1) as verified_pct
    from w
    group by game_id
  ),
  per_game as (
    select
      ag.game_id,
      coalesce(a.plays,0) as plays,
      coalesce(a.unique_players,0) as unique_players,
      a.avg_score,
      a.avg_accuracy,
      a.avg_duration_sec,
      a.last_played,
      a.verified_pct
    from active_games ag
    left join agg a on a.game_id=ag.game_id
  ),
  totals as (
    select
      count(*)::integer as total_plays,
      count(distinct user_id)::integer as unique_players,
      round(avg(accuracy)::numeric,1) as avg_accuracy
    from w
  )
  select jsonb_build_object(
    'days',v_days,
    'summary',jsonb_build_object(
      'total_plays',coalesce((select total_plays from totals),0),
      'unique_players',coalesce((select unique_players from totals),0),
      'avg_accuracy',(select avg_accuracy from totals),
      'top_game',(
        select game_id
        from per_game
        where plays>0
        order by plays desc,game_id
        limit 1
      )
    ),
    'games',coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'game_id',game_id,
            'plays',plays,
            'unique_players',unique_players,
            'avg_score',avg_score,
            'avg_accuracy',avg_accuracy,
            'avg_duration_sec',avg_duration_sec,
            'last_played',last_played,
            'verified_pct',verified_pct
          )
          order by plays desc,game_id
        )
        from per_game
      ),
      '[]'::jsonb
    )
  ) into v_payload;

  return v_payload;
end;
$$;

revoke execute on function public.admin_get_game_analytics(integer) from public,anon;
grant execute on function public.admin_get_game_analytics(integer) to authenticated;

commit;

-- Optional checks after success:
-- select external_key, comparison_type from public.higher_lower_pairs order by external_key;
-- select public.admin_get_game_analytics(30); -- requires authenticated Admin context; use the UI instead.
