-- BrainiLab Step 27 — V41.8.0
-- Daily replay lock + Number Route Daily speed format + Connections 20-round Anytime
-- + analytics classification refresh.
-- Run once AFTER Step 26.

begin;

-- ============================================================
-- 1) PLAYER ANALYTICS CLASSIFICATION — CURRENT GAME CATALOGUE
-- ============================================================

create or replace function public.brainilab_analytics_category(
  p_game_id text
)
returns text
language sql
immutable
set search_path=public
as $$
  select case lower(coalesce(p_game_id,''))
    when 'generalknowledge' then 'general'
    when 'worldflags' then 'geography'
    when 'worldcapitals' then 'geography'
    when 'science' then 'science'
    when 'history' then 'history'
    when 'sports' then 'sports'

    when 'brainmix' then 'daily'
    when 'brainiword' then 'language'
    when 'orderup' then 'logic'
    when 'topicrush' then 'knowledge'
    when 'connections' then 'logic'
    when 'survival' then 'mixed'
    when 'oddoneout' then 'logic'
    when 'higherlower' then 'knowledge'
    when 'mathrush' then 'math'
    when 'numberroute' then 'math'
    when 'sequence' then 'logic'

    when 'flagdash' then 'legacy'
    when 'maphunt' then 'legacy'
    else 'other'
  end;
$$;

revoke execute on function public.brainilab_analytics_category(text)
  from public,anon,authenticated;

-- Refresh the classification on previously aggregated rows without changing
-- any counts/scores. My Stats per-game data already works generically.
update public.player_analytics_daily
set category_key=public.brainilab_analytics_category(game_id)
where category_key is distinct from public.brainilab_analytics_category(game_id);


-- ============================================================
-- 2) CONNECTIONS — 20 ROUNDS ANYTIME, 3 ROUNDS DAILY
-- ============================================================

create or replace function public.get_brainilab_connections_game(
  p_exclude_puzzle_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_puzzles jsonb;
begin
  with ranked as (
    select
      cp.*,
      coalesce(ph.times_played,0)
        +case
          when cp.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then 1
          else 0
        end as effective_play_count,
      case
        when cp.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then now()
        else ph.last_played_at
      end as effective_last_played
    from public.connections_puzzles cp
    left join public.player_connections_history ph
      on v_uid is not null
     and ph.user_id=v_uid
     and ph.puzzle_id=cp.id
    where cp.is_active=true
      and (
        select count(*)
        from public.connections_choices cc
        where cc.puzzle_id=cp.id
      )=4
    order by
      effective_play_count asc,
      effective_last_played asc nulls first,
      random()
    limit 20
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'puzzle_id',r.id,
        'external_key',r.external_key,
        'category',r.category,
        'prompt',r.prompt,
        'clues',r.clues,
        'choices',(
          select jsonb_agg(
            jsonb_build_object('id',x.id,'text',x.choice_text)
          )
          from (
            select cc.id,cc.choice_text
            from public.connections_choices cc
            where cc.puzzle_id=r.id
            order by random()
          ) x
        )
      )
    ),
    '[]'::jsonb
  )
  into v_puzzles
  from ranked r;

  return jsonb_build_object(
    'rounds',20,
    'puzzles',v_puzzles
  );
end;
$$;

revoke execute on function public.get_brainilab_connections_game(uuid[])
  from public;
grant execute on function public.get_brainilab_connections_game(uuid[])
  to anon,authenticated;


create or replace function public.verify_brainilab_connections_result(
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
  v_result_id uuid;
  v_session_id uuid;
  v_daily_number integer;
  v_daily_id uuid;
  v_expected_rounds integer;

  v_round jsonb;
  v_puzzle uuid;
  v_choices jsonb;
  v_choice_text text;
  v_choice uuid;
  v_is_correct boolean;
  v_attempts integer;
  v_score integer:=0;
  v_seen uuid[]:=array[]::uuid[];
  v_round_seen_choices uuid[];
  v_i integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select gs.id,gr.id,gs.daily_number
  into v_session_id,v_result_id,v_daily_number
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid
    and gs.client_result_id=p_client_result_id
    and gs.game_id='connections'
  limit 1;

  if v_result_id is null then
    raise exception 'Connections result not found';
  end if;

  if v_daily_number is not null then
    v_expected_rounds:=3;

    select dc.id
    into v_daily_id
    from public.daily_challenges dc
    where dc.daily_number=v_daily_number
      and dc.challenge_date=current_date
      and dc.status='published'
    order by dc.generation_version desc
    limit 1;

    if v_daily_id is null
       or not ('connections'=any(public.brainilab_daily_game_ids(current_date))) then
      raise exception 'Connections is not in today''s Daily';
    end if;
  else
    v_expected_rounds:=20;
  end if;

  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_rounds)<>v_expected_rounds then
    raise exception 'Connections requires exactly % rounds in this mode',v_expected_rounds;
  end if;

  for v_round in
    select value from jsonb_array_elements(p_rounds)
  loop
    v_puzzle:=(v_round->>'puzzle_id')::uuid;

    if v_puzzle=any(v_seen) then
      raise exception 'Duplicate Connections puzzle';
    end if;
    v_seen:=array_append(v_seen,v_puzzle);

    if not exists(
      select 1
      from public.connections_puzzles
      where id=v_puzzle
    ) then
      raise exception 'Connections puzzle not found';
    end if;

    if v_daily_id is not null and not exists(
      select 1
      from public.daily_rotating_content
      where daily_challenge_id=v_daily_id
        and game_id='connections'
        and content_id=v_puzzle
        and position between 1 and 3
    ) then
      raise exception 'Connections puzzle is not assigned to today''s Daily';
    end if;

    v_choices:=coalesce(v_round->'attempted_choice_ids','[]'::jsonb);
    if jsonb_typeof(v_choices)<>'array' then
      raise exception 'Invalid Connections attempts';
    end if;

    v_round_seen_choices:=array[]::uuid[];
    v_attempts:=jsonb_array_length(v_choices);

    if v_attempts<1
       or v_attempts>4
       or v_attempts<>coalesce((v_round->>'attempts')::integer,0) then
      raise exception 'Invalid Connections attempt count';
    end if;

    for v_i in 0..v_attempts-1 loop
      v_choice_text:=v_choices->>v_i;
      v_choice:=v_choice_text::uuid;

      if v_choice=any(v_round_seen_choices) then
        raise exception 'Duplicate Connections choice attempt';
      end if;
      v_round_seen_choices:=array_append(v_round_seen_choices,v_choice);

      select cc.is_correct
      into v_is_correct
      from public.connections_choices cc
      where cc.id=v_choice
        and cc.puzzle_id=v_puzzle;

      if v_is_correct is null then
        raise exception 'Choice does not belong to Connections puzzle';
      end if;
      if v_i<v_attempts-1 and v_is_correct then
        raise exception 'A solved round cannot continue after the correct answer';
      end if;
      if v_i=v_attempts-1 and not v_is_correct then
        raise exception 'Connections round must end on the correct answer';
      end if;
    end loop;

    v_score:=v_score+case v_attempts
      when 1 then 1000
      when 2 then 700
      when 3 then 400
      else 200
    end;
  end loop;

  update public.game_results
  set
    score=v_score,
    correct_answers=v_expected_rounds,
    total_questions=v_expected_rounds,
    accuracy=100,
    answers_verified=true,
    verified_correct_answers=v_expected_rounds,
    verified_total_questions=v_expected_rounds,
    answers_verified_at=now()
  where id=v_result_id;

  return jsonb_build_object(
    'answers_verified',true,
    'correct_answers',v_expected_rounds,
    'total_questions',v_expected_rounds,
    'accuracy',100,
    'score',v_score
  );
end;
$$;

revoke execute on function public.verify_brainilab_connections_result(text,jsonb)
  from public,anon;
grant execute on function public.verify_brainilab_connections_result(text,jsonb)
  to authenticated;


-- ============================================================
-- 3) NUMBER ROUTE — DAILY = 3 ROUNDS, SPEED SCORING
--    ANYTIME = 10 ROUNDS, ATTEMPT SCORING
-- ============================================================

-- Keep future Daily assignments compact. Step 26's generic assignment helper
-- may attempt ten Number Route rows; this trigger accepts only positions 1–3.
create or replace function public.brainilab_limit_number_route_daily_rows()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.game_id='numberroute' and new.position>3 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists brainilab_limit_number_route_daily_rows_trg
  on public.daily_rotating_content;

create trigger brainilab_limit_number_route_daily_rows_trg
before insert or update
on public.daily_rotating_content
for each row
execute function public.brainilab_limit_number_route_daily_rows();

-- No scored Number Route Daily existed before the expanded rotation starts;
-- trim any pre-generated assignments to the new three-round format.
delete from public.daily_rotating_content d
using public.daily_challenges dc
where d.daily_challenge_id=dc.id
  and d.game_id='numberroute'
  and d.position>3
  and dc.challenge_date>=date '2026-08-31';


create or replace function public.get_brainilab_daily_number_route(
  p_challenge_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_daily record;
  v_puzzles jsonb;
begin
  select id,daily_number,challenge_date
  into v_daily
  from public.daily_challenges
  where challenge_date=p_challenge_date
    and status='published'
  order by generation_version desc
  limit 1;

  if v_daily.id is null
     or not ('numberroute'=any(public.brainilab_daily_game_ids(p_challenge_date))) then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'puzzle_id',p.id,
        'external_key',p.external_key,
        'category',p.category,
        'numbers',to_jsonb(p.numbers),
        'target',p.target
      )
      order by d.position
    ),
    '[]'::jsonb
  )
  into v_puzzles
  from public.daily_rotating_content d
  join public.number_route_puzzles p on p.id=d.content_id
  where d.daily_challenge_id=v_daily.id
    and d.game_id='numberroute'
    and d.position between 1 and 3;

  if jsonb_array_length(v_puzzles)<>3 then
    return null;
  end if;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'daily_number',v_daily.daily_number,
    'challenge_date',v_daily.challenge_date,
    'rounds',3,
    'scoring','speed',
    'puzzles',v_puzzles
  );
end;
$$;

revoke execute on function public.get_brainilab_daily_number_route(date)
  from public;
grant execute on function public.get_brainilab_daily_number_route(date)
  to anon,authenticated;


create or replace function public.verify_brainilab_number_route_result(
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
  v_daily_number integer;
  v_daily_id uuid;
  v_expected_rounds integer;

  v_row jsonb;
  v_id uuid;
  v_ops text[];
  v_solution text[];
  v_attempts integer;
  v_skipped boolean;
  v_response_ms integer;
  v_round_index integer:=0;
  v_round_cap integer;
  v_round_score integer;

  v_correct integer:=0;
  v_score integer:=0;
  v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select gr.id,gs.daily_number
  into v_result,v_daily_number
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid
    and gs.client_result_id=p_client_result_id
    and gs.game_id='numberroute'
  limit 1;

  if v_result is null then
    raise exception 'Number Route result not found';
  end if;

  if v_daily_number is not null then
    v_expected_rounds:=3;

    select id
    into v_daily_id
    from public.daily_challenges
    where daily_number=v_daily_number
      and challenge_date=current_date
      and status='published'
    order by generation_version desc
    limit 1;

    if v_daily_id is null
       or not ('numberroute'=any(public.brainilab_daily_game_ids(current_date))) then
      raise exception 'Number Route is not in today''s Daily';
    end if;
  else
    v_expected_rounds:=10;
  end if;

  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_rounds)<>v_expected_rounds then
    raise exception 'Number Route requires exactly % rounds in this mode',v_expected_rounds;
  end if;

  for v_row in
    select value from jsonb_array_elements(p_rounds)
  loop
    v_round_index:=v_round_index+1;
    v_id:=(v_row->>'puzzle_id')::uuid;

    if v_id=any(v_seen) then
      raise exception 'Duplicate Number Route puzzle';
    end if;
    v_seen:=array_append(v_seen,v_id);

    if v_daily_id is not null and not exists(
      select 1
      from public.daily_rotating_content
      where daily_challenge_id=v_daily_id
        and game_id='numberroute'
        and content_id=v_id
        and position between 1 and 3
    ) then
      raise exception 'Number Route puzzle is not assigned to today''s Daily';
    end if;

    select solution
    into v_solution
    from public.number_route_puzzles
    where id=v_id;

    if v_solution is null then
      raise exception 'Number Route puzzle not found';
    end if;

    v_skipped:=coalesce((v_row->>'skipped')::boolean,false);
    v_attempts:=greatest(1,least(100,coalesce((v_row->>'attempts')::integer,1)));
    v_response_ms:=greatest(0,least(600000,coalesce((v_row->>'response_time_ms')::integer,0)));

    if not v_skipped then
      select array_agg(value order by ordinality)
      into v_ops
      from jsonb_array_elements_text(
        coalesce(v_row->'operators','[]'::jsonb)
      ) with ordinality;

      if cardinality(v_ops)<>3 or v_ops<>v_solution then
        raise exception 'Invalid Number Route solved route';
      end if;

      v_correct:=v_correct+1;

      if v_daily_number is not null then
        -- 834 + 833 + 833 = exactly 2,500 maximum Daily points.
        -- First 5 seconds are full value. Then lose 10 points per completed
        -- second, with a 200-point floor for a solved route. Trial-and-error
        -- naturally costs points because all attempts consume the same timer.
        v_round_cap:=case when v_round_index=1 then 834 else 833 end;
        v_round_score:=greatest(
          200,
          v_round_cap
            -floor(greatest((v_response_ms::numeric/1000)-5,0))::integer*10
        );
      else
        v_round_score:=case v_attempts
          when 1 then 250
          when 2 then 180
          when 3 then 120
          else 80
        end;
      end if;

      v_score:=v_score+v_round_score;
    end if;
  end loop;

  update public.game_results
  set
    score=v_score,
    correct_answers=v_correct,
    total_questions=v_expected_rounds,
    accuracy=round(v_correct::numeric/v_expected_rounds::numeric*100,2),
    answers_verified=true,
    verified_correct_answers=v_correct,
    verified_total_questions=v_expected_rounds,
    answers_verified_at=now()
  where id=v_result;

  return jsonb_build_object(
    'answers_verified',true,
    'correct_answers',v_correct,
    'total_questions',v_expected_rounds,
    'accuracy',round(v_correct::numeric/v_expected_rounds::numeric*100,2),
    'score',v_score,
    'scoring',case when v_daily_number is not null then 'speed' else 'attempts' end
  );
end;
$$;

revoke execute on function public.verify_brainilab_number_route_result(text,jsonb)
  from public,anon;
grant execute on function public.verify_brainilab_number_route_result(text,jsonb)
  to authenticated;


-- ============================================================
-- 4) ONE SCORED RESULT PER DAILY GAME / USER / DAILY NUMBER
-- ============================================================

create or replace function public.submit_brainilab_game_result(
  p_client_result_id text,
  p_game_id text,
  p_played_at timestamptz,
  p_score integer default null,
  p_correct_answers integer default null,
  p_total_questions integer default null,
  p_accuracy numeric default null,
  p_duration_ms integer default null,
  p_client_percentile integer default null,
  p_daily_number integer default null,
  p_difficulty text default null,
  p_set_number integer default null,
  p_result_payload jsonb default '{}'::jsonb,
  p_answer_correctness jsonb default '[]'::jsonb
)
returns table (
  session_id uuid,
  result_id uuid,
  already_existed boolean
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_result_id uuid;
  v_started_at timestamptz;
  v_item jsonb;
  v_position integer:=0;
  v_payload jsonb;
begin
  v_user_id:=auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_client_result_id is null
     or char_length(btrim(p_client_result_id))<8
     or char_length(p_client_result_id)>100 then
    raise exception 'Invalid client result ID';
  end if;

  if p_game_id is null
     or char_length(btrim(p_game_id))<2
     or char_length(p_game_id)>60 then
    raise exception 'Invalid game ID';
  end if;

  if p_difficulty is not null
     and p_difficulty not in ('easy','medium','hard') then
    raise exception 'Invalid difficulty';
  end if;

  if p_set_number is not null and p_set_number<=0 then
    raise exception 'Invalid set number';
  end if;

  if p_accuracy is not null and (p_accuracy<0 or p_accuracy>100) then
    raise exception 'Invalid accuracy';
  end if;

  if p_correct_answers is not null and p_correct_answers<0 then
    raise exception 'Invalid correct answer count';
  end if;

  if p_total_questions is not null and p_total_questions<0 then
    raise exception 'Invalid total question count';
  end if;

  if p_correct_answers is not null
     and p_total_questions is not null
     and p_correct_answers>p_total_questions then
    raise exception 'Correct answers cannot exceed total questions';
  end if;

  if p_score is not null and p_score<0 then
    raise exception 'Invalid score';
  end if;

  if p_duration_ms is not null and p_duration_ms<0 then
    raise exception 'Invalid duration';
  end if;

  if p_client_percentile is not null
     and (p_client_percentile<0 or p_client_percentile>100) then
    raise exception 'Invalid percentile';
  end if;

  v_payload:=coalesce(p_result_payload,'{}'::jsonb);

  if octet_length(v_payload::text)>20000 then
    raise exception 'Result payload too large';
  end if;

  -- Browser retry idempotency.
  select gs.id,gr.id
  into v_session_id,v_result_id
  from public.game_sessions gs
  left join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_user_id
    and gs.client_result_id=p_client_result_id
  limit 1;

  if v_session_id is not null then
    return query select v_session_id,v_result_id,true;
    return;
  end if;

  -- Daily result lock. The advisory lock closes the tiny race window where
  -- two tabs could otherwise submit the same Daily game simultaneously.
  if p_daily_number is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        v_user_id::text||':'||lower(btrim(p_game_id))||':'||p_daily_number::text,
        0
      )
    );

    select gs.id,gr.id
    into v_session_id,v_result_id
    from public.game_sessions gs
    left join public.game_results gr on gr.session_id=gs.id
    where gs.user_id=v_user_id
      and gs.game_id=btrim(p_game_id)
      and gs.daily_number=p_daily_number
      and gs.status='completed'
    order by gs.completed_at desc nulls last
    limit 1;

    if v_session_id is not null then
      return query select v_session_id,v_result_id,true;
      return;
    end if;
  end if;

  v_started_at:=
    coalesce(p_played_at,now())
    -make_interval(secs=>greatest(coalesce(p_duration_ms,0),0)/1000.0);

  insert into public.game_sessions(
    user_id,
    client_result_id,
    game_id,
    source,
    difficulty,
    set_number,
    daily_number,
    status,
    started_at,
    completed_at
  )
  values(
    v_user_id,
    btrim(p_client_result_id),
    btrim(p_game_id),
    'web',
    p_difficulty,
    p_set_number,
    p_daily_number,
    'completed',
    v_started_at,
    coalesce(p_played_at,now())
  )
  returning id into v_session_id;

  insert into public.game_results(
    session_id,
    user_id,
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    client_percentile,
    result_payload,
    server_verified
  )
  values(
    v_session_id,
    v_user_id,
    p_score,
    p_correct_answers,
    p_total_questions,
    p_accuracy,
    p_duration_ms,
    p_client_percentile,
    v_payload,
    false
  )
  returning id into v_result_id;

  if jsonb_typeof(coalesce(p_answer_correctness,'[]'::jsonb))='array' then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_answer_correctness,'[]'::jsonb))
    loop
      v_position:=v_position+1;
      if v_position>100 then exit; end if;

      insert into public.game_answers(
        session_id,
        user_id,
        position,
        is_correct
      )
      values(
        v_session_id,
        v_user_id,
        v_position,
        case
          when jsonb_typeof(v_item)='boolean'
            then (v_item#>>'{}')::boolean
          else null
        end
      );
    end loop;
  end if;

  return query select v_session_id,v_result_id,false;
end;
$$;

revoke execute on function public.submit_brainilab_game_result(
  text,text,timestamptz,integer,integer,integer,numeric,integer,integer,
  integer,text,integer,jsonb,jsonb
) from public,anon;

grant execute on function public.submit_brainilab_game_result(
  text,text,timestamptz,integer,integer,integer,numeric,integer,integer,
  integer,text,integer,jsonb,jsonb
) to authenticated;

commit;

-- Verification examples (run separately after the migration):
-- select (public.get_brainilab_connections_game(array[]::uuid[])->>'rounds')::integer;
-- Expected: 20
--
-- select public.get_brainilab_daily_number_route(current_date);
-- When Number Route is in today's Daily, expected: rounds = 3.
