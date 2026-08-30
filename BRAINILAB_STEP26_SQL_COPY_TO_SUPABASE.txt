-- BrainiLab Step 26 — V41.7.0
-- Math Rush + Number Route + Sequence + expanded rotating Daily + Try First support
-- Run once AFTER Step 25.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- CONTENT HEALTH: NEW GAME TYPES
-- ============================================================

alter table public.content_play_sessions
  drop constraint if exists content_play_type;

alter table public.content_play_sessions
  add constraint content_play_type check(content_type in (
    'question','brainiword','topicrush','orderup','connections','oddoneout','higherlower',
    'mathrush','numberroute','sequence'
  ));

create or replace function public.start_brainilab_content_play(
  p_client_play_id text,
  p_game_id text,
  p_content_type text,
  p_content_ids text[],
  p_daily_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_client_play_id,''))) not between 8 and 100 then raise exception 'Invalid client play ID'; end if;
  if char_length(btrim(coalesce(p_game_id,''))) not between 2 and 60 then raise exception 'Invalid game ID'; end if;
  if p_content_type not in ('question','brainiword','topicrush','orderup','connections','oddoneout','higherlower','mathrush','numberroute','sequence') then raise exception 'Invalid content type'; end if;
  if coalesce(cardinality(p_content_ids),0) not between 1 and 60 then raise exception 'Content list must contain 1–60 items'; end if;

  insert into public.content_play_sessions(
    user_id,client_play_id,game_id,content_type,content_ids,daily_number,last_position,status,started_at,last_seen_at
  ) values(
    v_uid,btrim(p_client_play_id),btrim(p_game_id),p_content_type,p_content_ids,p_daily_number,1,'started',now(),now()
  )
  on conflict(user_id,client_play_id) do update set last_seen_at=now()
  returning id into v_id;

  return jsonb_build_object('ok',true,'play_session_id',v_id);
end;
$$;
revoke execute on function public.start_brainilab_content_play(text,text,text,text[],integer) from public,anon;
grant execute on function public.start_brainilab_content_play(text,text,text,text[],integer) to authenticated;

-- Keep the exact final exposed position when a run ends early (for example Survival or timed Math Rush).
create or replace function public.complete_brainilab_content_play(
  p_client_play_id text,
  p_last_position integer,
  p_outcomes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_session public.content_play_sessions%rowtype;
  v_row jsonb;
  v_content_id text;
  v_position integer;
  v_attempts integer;
  v_response integer;
  v_final_position integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_outcomes,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_outcomes,'[]'::jsonb))>60 then
    raise exception 'Invalid outcomes';
  end if;

  select * into v_session
  from public.content_play_sessions
  where user_id=v_uid and client_play_id=p_client_play_id
  for update;

  if v_session.id is null then return jsonb_build_object('ok',false); end if;

  v_final_position:=greatest(
    1,
    least(
      cardinality(v_session.content_ids),
      coalesce(p_last_position,v_session.last_position,1)
    )
  );

  for v_row in
    select value from jsonb_array_elements(coalesce(p_outcomes,'[]'::jsonb))
  loop
    v_content_id:=btrim(coalesce(v_row->>'content_id',''));
    if v_content_id='' or not (v_content_id=any(v_session.content_ids)) then continue; end if;

    v_position:=greatest(
      1,
      least(
        cardinality(v_session.content_ids),
        coalesce(nullif(v_row->>'position','')::integer,1)
      )
    );
    v_attempts:=case
      when nullif(v_row->>'attempts','') is null then null
      else greatest(1,least(1000,(v_row->>'attempts')::integer))
    end;
    v_response:=case
      when nullif(v_row->>'response_time_ms','') is null then null
      else greatest(0,(v_row->>'response_time_ms')::integer)
    end;

    insert into public.content_play_outcomes(
      play_session_id,content_id,position,attempts,is_correct,skipped,score,response_time_ms
    ) values(
      v_session.id,v_content_id,v_position,v_attempts,
      case when v_row ? 'is_correct' then (v_row->>'is_correct')::boolean else null end,
      coalesce((v_row->>'skipped')::boolean,false),
      case when nullif(v_row->>'score','') is null then null else (v_row->>'score')::numeric end,
      v_response
    )
    on conflict(play_session_id,content_id) do update set
      position=excluded.position,
      attempts=excluded.attempts,
      is_correct=excluded.is_correct,
      skipped=excluded.skipped,
      score=excluded.score,
      response_time_ms=excluded.response_time_ms;
  end loop;

  update public.content_play_sessions
  set status='completed',
      last_position=v_final_position,
      last_seen_at=now(),
      completed_at=coalesce(completed_at,now())
  where id=v_session.id;

  return jsonb_build_object('ok',true,'last_position',v_final_position);
end;
$$;
revoke execute on function public.complete_brainilab_content_play(text,integer,jsonb) from public,anon;
grant execute on function public.complete_brainilab_content_play(text,integer,jsonb) to authenticated;

create or replace function public.admin_content_health_overview(
  p_days integer default 30,
  p_content_type text default null
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

  with sessions as (
    select s.*,
      (s.status='started' and s.last_seen_at<now()-interval '15 minutes') as abandoned,
      greatest(1,least(cardinality(s.content_ids),coalesce(s.last_position,1))) as exposed_to
    from public.content_play_sessions s
    where s.started_at>=now()-(v_days||' days')::interval
      and (p_content_type is null or s.content_type=p_content_type)
  ),
  exposures as (
    select
      s.content_type,
      x.content_id,
      count(*)::integer as exposures,
      count(*) filter(where s.abandoned and x.ordinality=s.exposed_to)::integer as exits
    from sessions s
    cross join lateral unnest(s.content_ids) with ordinality as x(content_id,ordinality)
    where x.ordinality<=s.exposed_to
    group by s.content_type,x.content_id
  ),
  outcomes as (
    select
      s.content_type,
      o.content_id,
      count(*)::integer as outcome_count,
      count(*) filter(where o.is_correct is not null)::integer as graded_count,
      round(100.0*count(*) filter(where o.is_correct=true)/nullif(count(*) filter(where o.is_correct is not null),0),1) as accuracy,
      round(100.0*count(*) filter(where o.skipped)/nullif(count(*),0),1) as skip_rate,
      round(avg(o.attempts)::numeric,2) as avg_attempts,
      round(avg(o.score)::numeric,1) as avg_score,
      round(avg(o.response_time_ms)::numeric,0) as avg_response_time_ms
    from public.content_play_outcomes o
    join public.content_play_sessions s on s.id=o.play_session_id
    where s.started_at>=now()-(v_days||' days')::interval
      and (p_content_type is null or s.content_type=p_content_type)
    group by s.content_type,o.content_id
  ),
  merged as (
    select
      e.content_type,
      e.content_id,
      e.exposures,
      coalesce(o.outcome_count,0) as attempts,
      o.accuracy,
      o.skip_rate,
      o.avg_attempts,
      o.avg_score,
      o.avg_response_time_ms,
      round(100.0*e.exits/nullif(e.exposures,0),1) as exit_rate,
      e.exits
    from exposures e
    left join outcomes o on o.content_type=e.content_type and o.content_id=e.content_id
  ),
  scored as (
    select m.*,
      round(
        0.45*greatest(0,100-coalesce(m.exit_rate,0))
        +0.35*case
          when m.accuracy is null then 70
          when m.content_type in ('question','oddoneout','higherlower','numberroute','sequence')
            then greatest(0,100-least(70,abs(m.accuracy-65)*1.4))
          else greatest(0,least(100,m.accuracy))
        end
        +0.20*greatest(0,100-least(80,greatest(0,coalesce(m.avg_attempts,1)-1)*20))
      )::integer as health_score
    from merged m
  )
  select jsonb_build_object(
    'days',v_days,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'content_type',content_type,
      'content_id',content_id,
      'exposures',exposures,
      'attempts',attempts,
      'accuracy',accuracy,
      'skip_rate',skip_rate,
      'avg_attempts',avg_attempts,
      'avg_score',avg_score,
      'avg_response_time_ms',avg_response_time_ms,
      'exit_rate',exit_rate,
      'health_score',health_score,
      'sample_state',case when exposures<10 then 'building' else 'established' end,
      'health_label',case when exposures<10 then 'Building sample' when health_score>=80 then 'Strong' when health_score>=60 then 'Healthy' when health_score>=40 then 'Watch' else 'Poor' end
    ) order by health_score asc,exposures desc),'[]'::jsonb)
  ) into v_payload
  from scored;

  return v_payload;
end;
$$;
revoke execute on function public.admin_content_health_overview(integer,text) from public,anon;
grant execute on function public.admin_content_health_overview(integer,text) to authenticated;


-- ============================================================
-- NUMBER ROUTE CONTENT POOL
-- ============================================================

create table if not exists public.number_route_puzzles(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  category text not null default 'math',
  numbers integer[] not null,
  target integer not null,
  solution text[] not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint number_route_key_format check(external_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint number_route_numbers check(
    cardinality(numbers)=4
    and numbers[1] between 1 and 9 and numbers[2] between 1 and 9
    and numbers[3] between 1 and 9 and numbers[4] between 1 and 9
  ),
  constraint number_route_target check(target between 0 and 200),
  constraint number_route_solution check(
    cardinality(solution)=3
    and solution[1] in ('+','−','×','÷')
    and solution[2] in ('+','−','×','÷')
    and solution[3] in ('+','−','×','÷')
  )
);

create table if not exists public.player_number_route_history(
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id uuid not null references public.number_route_puzzles(id) on delete cascade,
  times_played integer not null default 1,
  first_played_at timestamptz not null default now(),
  last_played_at timestamptz not null default now(),
  primary key(user_id,puzzle_id),
  constraint player_number_route_times_positive check(times_played>0)
);
create index if not exists player_number_route_history_user_idx
  on public.player_number_route_history(user_id,times_played,last_played_at);
alter table public.number_route_puzzles enable row level security;
alter table public.player_number_route_history enable row level security;
revoke all on table public.number_route_puzzles from anon,authenticated;
revoke all on table public.player_number_route_history from anon,authenticated;

create or replace function public.brainilab_number_route_solutions(
  p_numbers integer[], p_target integer
)
returns jsonb
language plpgsql
immutable
set search_path=public
as $$
declare
  v_ops text[]:=array['+','−','×','÷']::text[];
  i integer; j integer; k integer; step integer;
  v_route text[];
  v_value numeric;
  v_next integer;
  v_valid boolean;
  v_count integer:=0;
  v_solution text[]:=null;
begin
  if cardinality(p_numbers)<>4 then
    return jsonb_build_object('count',0,'solution',null);
  end if;
  for i in 1..4 loop
    for j in 1..4 loop
      for k in 1..4 loop
        v_route:=array[v_ops[i],v_ops[j],v_ops[k]];
        v_value:=p_numbers[1];
        v_valid:=true;
        for step in 1..3 loop
          v_next:=p_numbers[step+1];
          if v_route[step]='+' then v_value:=v_value+v_next;
          elsif v_route[step]='−' then v_value:=v_value-v_next;
          elsif v_route[step]='×' then v_value:=v_value*v_next;
          elsif v_route[step]='÷' then
            if v_next=0 or mod(v_value,v_next)<>0 then v_valid:=false; exit;
            end if;
            v_value:=v_value/v_next;
          end if;
          if abs(v_value)>1000 then v_valid:=false; exit; end if;
        end loop;
        if v_valid and v_value=p_target then
          v_count:=v_count+1;
          if v_count=1 then v_solution:=v_route; end if;
        end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('count',v_count,'solution',to_jsonb(v_solution));
end;
$$;

create or replace function public.get_brainilab_number_route_game(
  p_exclude_puzzle_ids uuid[] default array[]::uuid[]
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_payload jsonb;
begin
  with ranked as (
    select p.*,
      coalesce(h.times_played,0)+case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then 1 else 0 end as play_weight,
      case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then now() else h.last_played_at end as last_weight
    from public.number_route_puzzles p
    left join public.player_number_route_history h on v_uid is not null and h.user_id=v_uid and h.puzzle_id=p.id
    where p.is_active=true
    order by play_weight,last_weight asc nulls first,random()
    limit 10
  )
  select jsonb_build_object('puzzles',coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',id,'external_key',external_key,'category',category,'numbers',to_jsonb(numbers),'target',target
  )),'[]'::jsonb)) into v_payload from ranked;
  return v_payload;
end;$$;
revoke execute on function public.get_brainilab_number_route_game(uuid[]) from public;
grant execute on function public.get_brainilab_number_route_game(uuid[]) to anon,authenticated;

create or replace function public.check_brainilab_number_route_answer(p_puzzle_id uuid,p_operators text[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_solution text[]; v_target integer;
begin
  select solution,target into v_solution,v_target from public.number_route_puzzles where id=p_puzzle_id and is_active=true;
  if v_solution is null then raise exception 'Number Route puzzle unavailable'; end if;
  if cardinality(p_operators)<>3 then raise exception 'Number Route needs exactly 3 operators'; end if;
  return jsonb_build_object('correct',p_operators=v_solution,'target',v_target,'solution',case when p_operators=v_solution then to_jsonb(v_solution) else null end);
end;$$;
revoke execute on function public.check_brainilab_number_route_answer(uuid,text[]) from public;
grant execute on function public.check_brainilab_number_route_answer(uuid,text[]) to anon,authenticated;

create or replace function public.reveal_brainilab_number_route_solution(p_puzzle_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_solution text[];
begin
  select solution into v_solution from public.number_route_puzzles where id=p_puzzle_id and is_active=true;
  if v_solution is null then raise exception 'Number Route puzzle unavailable'; end if;
  return jsonb_build_object('solution',to_jsonb(v_solution));
end;$$;
revoke execute on function public.reveal_brainilab_number_route_solution(uuid) from public;
grant execute on function public.reveal_brainilab_number_route_solution(uuid) to anon,authenticated;

create or replace function public.record_brainilab_number_route_history(p_puzzle_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_count integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  for v_id in select distinct unnest(coalesce(p_puzzle_ids,array[]::uuid[])) loop
    if exists(select 1 from public.number_route_puzzles where id=v_id and is_active=true) then
      insert into public.player_number_route_history(user_id,puzzle_id,times_played,first_played_at,last_played_at)
      values(v_uid,v_id,1,now(),now())
      on conflict(user_id,puzzle_id) do update set times_played=public.player_number_route_history.times_played+1,last_played_at=now();
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('recorded',v_count);
end;$$;
revoke execute on function public.record_brainilab_number_route_history(uuid[]) from public,anon;
grant execute on function public.record_brainilab_number_route_history(uuid[]) to authenticated;

-- ============================================================
-- SEQUENCE CONTENT POOL
-- ============================================================

create table if not exists public.sequence_puzzles(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  category text not null default 'math',
  sequence_values numeric[] not null,
  answer_value numeric not null,
  options numeric[] not null,
  explanation text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sequence_key_format check(external_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint sequence_values_count check(cardinality(sequence_values)=5),
  constraint sequence_options_count check(cardinality(options)=4),
  constraint sequence_answer_in_options check(answer_value=any(options))
);
create table if not exists public.player_sequence_history(
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id uuid not null references public.sequence_puzzles(id) on delete cascade,
  times_played integer not null default 1,
  first_played_at timestamptz not null default now(),
  last_played_at timestamptz not null default now(),
  primary key(user_id,puzzle_id),
  constraint player_sequence_times_positive check(times_played>0)
);
create index if not exists player_sequence_history_user_idx on public.player_sequence_history(user_id,times_played,last_played_at);
alter table public.sequence_puzzles enable row level security;
alter table public.player_sequence_history enable row level security;
revoke all on table public.sequence_puzzles from anon,authenticated;
revoke all on table public.player_sequence_history from anon,authenticated;

create or replace function public.get_brainilab_sequence_game(p_exclude_puzzle_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_payload jsonb;
begin
  with ranked as (
    select p.*,
      coalesce(h.times_played,0)+case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then 1 else 0 end as play_weight,
      case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then now() else h.last_played_at end as last_weight
    from public.sequence_puzzles p
    left join public.player_sequence_history h on v_uid is not null and h.user_id=v_uid and h.puzzle_id=p.id
    where p.is_active=true
    order by play_weight,last_weight asc nulls first,random()
    limit 10
  )
  select jsonb_build_object('puzzles',coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',r.id,'external_key',r.external_key,'category',r.category,'sequence',to_jsonb(r.sequence_values),
    'options',(select jsonb_agg(x order by md5(x::text||':'||r.id::text)) from unnest(r.options) x)
  )),'[]'::jsonb)) into v_payload from ranked r;
  return v_payload;
end;$$;
revoke execute on function public.get_brainilab_sequence_game(uuid[]) from public;
grant execute on function public.get_brainilab_sequence_game(uuid[]) to anon,authenticated;

create or replace function public.check_brainilab_sequence_answer(p_puzzle_id uuid,p_answer numeric)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_answer numeric; v_exp text;
begin
  select answer_value,explanation into v_answer,v_exp from public.sequence_puzzles where id=p_puzzle_id and is_active=true;
  if v_answer is null then raise exception 'Sequence puzzle unavailable'; end if;
  return jsonb_build_object('correct',p_answer=v_answer,'answer',v_answer,'explanation',v_exp);
end;$$;
revoke execute on function public.check_brainilab_sequence_answer(uuid,numeric) from public;
grant execute on function public.check_brainilab_sequence_answer(uuid,numeric) to anon,authenticated;

create or replace function public.record_brainilab_sequence_history(p_puzzle_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_count integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  for v_id in select distinct unnest(coalesce(p_puzzle_ids,array[]::uuid[])) loop
    if exists(select 1 from public.sequence_puzzles where id=v_id and is_active=true) then
      insert into public.player_sequence_history(user_id,puzzle_id,times_played,first_played_at,last_played_at)
      values(v_uid,v_id,1,now(),now())
      on conflict(user_id,puzzle_id) do update set times_played=public.player_sequence_history.times_played+1,last_played_at=now();
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('recorded',v_count);
end;$$;
revoke execute on function public.record_brainilab_sequence_history(uuid[]) from public,anon;
grant execute on function public.record_brainilab_sequence_history(uuid[]) to authenticated;


-- ============================================================
-- MATH RUSH — DETERMINISTIC SAFE OPERATION GENERATOR
-- ============================================================

create or replace function public.brainilab_math_rush_operation(p_seed text,p_position integer)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
  v_kind integer;
  v_a integer; v_b integer; v_q integer; v_answer integer; v_op text;
  h bytea;
begin
  if char_length(coalesce(p_seed,'')) not between 3 and 140 or p_position not between 1 and 60 then
    raise exception 'Invalid Math Rush operation request';
  end if;
  h:=decode(md5(p_seed||':'||p_position::text),'hex');
  v_kind:=get_byte(h,0)%4;
  if v_kind=0 then
    v_a:=1+(get_byte(h,1)%9); v_b:=1+(get_byte(h,2)%9); v_op:='+'; v_answer:=v_a+v_b;
  elsif v_kind=1 then
    v_a:=1+(get_byte(h,1)%9); v_b:=1+(get_byte(h,2)%9);
    if v_b>v_a then v_q:=v_a; v_a:=v_b; v_b:=v_q; end if;
    v_op:='−'; v_answer:=v_a-v_b;
  elsif v_kind=2 then
    v_a:=1+(get_byte(h,1)%9); v_b:=1+(get_byte(h,2)%9); v_op:='×'; v_answer:=v_a*v_b;
  else
    v_b:=1+(get_byte(h,1)%9); v_q:=1+(get_byte(h,2)%(9/v_b)); v_a:=v_b*v_q; v_op:='÷'; v_answer:=v_q;
  end if;
  return jsonb_build_object('position',p_position,'operation_id',p_seed||':'||p_position::text,'a',v_a,'b',v_b,'operator',v_op,'answer',v_answer);
end;$$;

create or replace function public.get_brainilab_math_rush_game(p_seed text,p_challenge_date date default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_seed text; v_ops jsonb;
begin
  if p_challenge_date is not null then
    if not ('mathrush'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;
    if not exists(select 1 from public.daily_challenges where challenge_date=p_challenge_date and status='published') then return null; end if;
    v_seed:='daily:'||p_challenge_date::text||':mathrush';
  else
    v_seed:=left(coalesce(nullif(btrim(p_seed),''),'anytime:'||gen_random_uuid()::text),140);
  end if;
  select jsonb_agg((public.brainilab_math_rush_operation(v_seed,g.pos)-'answer') order by g.pos)
    into v_ops from generate_series(1,60) g(pos);
  return jsonb_build_object('seed',v_seed,'challenge_date',p_challenge_date,'operations',v_ops);
end;$$;
revoke execute on function public.get_brainilab_math_rush_game(text,date) from public;
grant execute on function public.get_brainilab_math_rush_game(text,date) to anon,authenticated;


-- ============================================================
-- INITIAL NUMBER ROUTE + SEQUENCE CONTENT (40 EACH)
-- ============================================================

create or replace function public._seed_number_route(p_key text,p_numbers integer[],p_target integer,p_solution text[])
returns void language plpgsql security definer set search_path=public as $$
declare v_check jsonb; v_found text[];
begin
  if exists(select 1 from public.number_route_puzzles where external_key=p_key) then return; end if;
  v_check:=public.brainilab_number_route_solutions(p_numbers,p_target);
  if coalesce((v_check->>'count')::integer,0)<>1 then
    raise exception 'Seed % must have exactly one solution',p_key;
  end if;
  select array_agg(value order by ordinality) into v_found
  from jsonb_array_elements_text(v_check->'solution') with ordinality;
  if v_found is distinct from p_solution then
    raise exception 'Seed % solution mismatch',p_key;
  end if;
  insert into public.number_route_puzzles(external_key,category,numbers,target,solution,is_active)
  values(p_key,'math',p_numbers,p_target,p_solution,true);
end; $$;

select public._seed_number_route('route-001',array[2,1,6,7]::integer[],16,array['+','+','+']::text[]);

select public._seed_number_route('route-002',array[5,2,6,5]::integer[],8,array['+','+','−']::text[]);

select public._seed_number_route('route-003',array[9,7,5,6]::integer[],1,array['−','+','−']::text[]);

select public._seed_number_route('route-004',array[6,5,3,6]::integer[],9,array['−','×','+']::text[]);

select public._seed_number_route('route-005',array[2,8,3,2]::integer[],38,array['×','+','×']::text[]);

select public._seed_number_route('route-006',array[9,3,3,1]::integer[],35,array['+','×','−']::text[]);

select public._seed_number_route('route-007',array[8,3,2,9]::integer[],0,array['+','−','−']::text[]);

select public._seed_number_route('route-008',array[2,2,1,6]::integer[],12,array['÷','+','×']::text[]);

select public._seed_number_route('route-009',array[8,3,1,5]::integer[],7,array['+','+','−']::text[]);

select public._seed_number_route('route-010',array[2,8,7,2]::integer[],25,array['×','+','+']::text[]);

select public._seed_number_route('route-011',array[9,4,3,7]::integer[],1,array['−','+','−']::text[]);

select public._seed_number_route('route-012',array[6,5,1,4]::integer[],33,array['×','−','+']::text[]);

select public._seed_number_route('route-013',array[5,5,1,7]::integer[],19,array['×','+','−']::text[]);

select public._seed_number_route('route-014',array[3,9,3,7]::integer[],8,array['+','+','−']::text[]);

select public._seed_number_route('route-015',array[3,7,8,5]::integer[],18,array['×','−','+']::text[]);

select public._seed_number_route('route-016',array[1,3,9,5]::integer[],22,array['×','×','−']::text[]);

select public._seed_number_route('route-017',array[9,7,7,9]::integer[],14,array['+','+','−']::text[]);

select public._seed_number_route('route-018',array[2,5,6,7]::integer[],11,array['×','−','+']::text[]);

select public._seed_number_route('route-019',array[8,3,6,2]::integer[],36,array['×','−','×']::text[]);

select public._seed_number_route('route-020',array[2,1,5,5]::integer[],20,array['+','×','+']::text[]);

select public._seed_number_route('route-021',array[2,3,2,3]::integer[],5,array['×','+','−']::text[]);

select public._seed_number_route('route-022',array[5,5,9,3]::integer[],22,array['+','+','+']::text[]);

select public._seed_number_route('route-023',array[3,9,6,3]::integer[],9,array['+','−','+']::text[]);

select public._seed_number_route('route-024',array[8,6,7,1]::integer[],10,array['−','+','+']::text[]);

select public._seed_number_route('route-025',array[1,9,3,3]::integer[],0,array['×','÷','−']::text[]);

select public._seed_number_route('route-026',array[8,3,7,5]::integer[],30,array['−','×','−']::text[]);

select public._seed_number_route('route-027',array[5,4,8,6]::integer[],18,array['×','−','+']::text[]);

select public._seed_number_route('route-028',array[8,4,8,4]::integer[],40,array['÷','+','×']::text[]);

select public._seed_number_route('route-029',array[9,1,2,6]::integer[],4,array['−','+','−']::text[]);

select public._seed_number_route('route-030',array[4,9,2,7]::integer[],8,array['+','+','−']::text[]);

select public._seed_number_route('route-031',array[2,7,6,8]::integer[],23,array['+','+','+']::text[]);

select public._seed_number_route('route-032',array[7,5,5,6]::integer[],23,array['+','+','+']::text[]);

select public._seed_number_route('route-033',array[1,2,3,6]::integer[],11,array['×','+','+']::text[]);

select public._seed_number_route('route-034',array[4,2,6,1]::integer[],37,array['+','×','+']::text[]);

select public._seed_number_route('route-035',array[7,3,8,3]::integer[],32,array['×','+','+']::text[]);

select public._seed_number_route('route-036',array[9,9,1,9]::integer[],18,array['÷','+','×']::text[]);

select public._seed_number_route('route-037',array[9,3,5,5]::integer[],37,array['×','+','+']::text[]);

select public._seed_number_route('route-038',array[1,7,3,8]::integer[],2,array['×','+','−']::text[]);

select public._seed_number_route('route-039',array[5,7,2,1]::integer[],9,array['+','−','−']::text[]);

select public._seed_number_route('route-040',array[4,9,2,1]::integer[],17,array['×','÷','−']::text[]);

drop function if exists public._seed_number_route(text,integer[],integer,text[]);

create or replace function public._seed_sequence(p_key text,p_sequence numeric[],p_answer numeric,p_options numeric[],p_explanation text)
returns void language plpgsql security definer set search_path=public as $$ begin
  if not exists(select 1 from public.sequence_puzzles where external_key=p_key) then
    insert into public.sequence_puzzles(external_key,category,sequence_values,answer_value,options,explanation,is_active)
    values(p_key,'math',p_sequence,p_answer,p_options,p_explanation,true);
  end if;
end; $$;

select public._seed_sequence('sequence-001',array[2,4,6,8,10]::numeric[],12,array[12,14,10,13]::numeric[],'Each number changes by +2.');

select public._seed_sequence('sequence-002',array[3,6,9,12,15]::numeric[],18,array[18,21,15,19]::numeric[],'Each number changes by +3.');

select public._seed_sequence('sequence-003',array[5,10,15,20,25]::numeric[],30,array[30,35,25,31]::numeric[],'Each number changes by +5.');

select public._seed_sequence('sequence-004',array[10,9,8,7,6]::numeric[],5,array[5,4,6,10]::numeric[],'Each number changes by -1.');

select public._seed_sequence('sequence-005',array[4,8,12,16,20]::numeric[],24,array[24,28,20,25]::numeric[],'Each number changes by +4.');

select public._seed_sequence('sequence-006',array[7,9,11,13,15]::numeric[],17,array[17,19,15,18]::numeric[],'Each number changes by +2.');

select public._seed_sequence('sequence-007',array[1,6,11,16,21]::numeric[],26,array[26,31,21,27]::numeric[],'Each number changes by +5.');

select public._seed_sequence('sequence-008',array[20,17,14,11,8]::numeric[],5,array[5,2,8,4]::numeric[],'Each number changes by -3.');

select public._seed_sequence('sequence-009',array[6,12,18,24,30]::numeric[],36,array[36,42,30,37]::numeric[],'Each number changes by +6.');

select public._seed_sequence('sequence-010',array[8,12,16,20,24]::numeric[],28,array[28,32,24,29]::numeric[],'Each number changes by +4.');

select public._seed_sequence('sequence-011',array[9,12,15,18,21]::numeric[],24,array[24,27,21,25]::numeric[],'Each number changes by +3.');

select public._seed_sequence('sequence-012',array[15,13,11,9,7]::numeric[],5,array[5,3,7,4]::numeric[],'Each number changes by -2.');

select public._seed_sequence('sequence-013',array[1,2,4,7,11]::numeric[],16,array[16,15,17,11]::numeric[],'The step grows by 1 each time, starting at +1.');

select public._seed_sequence('sequence-014',array[2,4,7,11,16]::numeric[],22,array[22,21,23,16]::numeric[],'The step grows by 1 each time, starting at +2.');

select public._seed_sequence('sequence-015',array[5,6,8,11,15]::numeric[],20,array[20,19,21,15]::numeric[],'The step grows by 1 each time, starting at +1.');

select public._seed_sequence('sequence-016',array[3,6,10,15,21]::numeric[],28,array[28,27,29,21]::numeric[],'The step grows by 1 each time, starting at +3.');

select public._seed_sequence('sequence-017',array[10,12,15,19,24]::numeric[],30,array[30,29,31,24]::numeric[],'The step grows by 1 each time, starting at +2.');

select public._seed_sequence('sequence-018',array[4,5,7,10,14]::numeric[],19,array[19,18,20,14]::numeric[],'The step grows by 1 each time, starting at +1.');

select public._seed_sequence('sequence-019',array[6,8,11,15,20]::numeric[],26,array[26,25,27,20]::numeric[],'The step grows by 1 each time, starting at +2.');

select public._seed_sequence('sequence-020',array[8,11,15,20,26]::numeric[],33,array[33,32,34,26]::numeric[],'The step grows by 1 each time, starting at +3.');

select public._seed_sequence('sequence-021',array[1,3,6,10,15]::numeric[],21,array[21,20,22,15]::numeric[],'The step grows by 1 each time, starting at +2.');

select public._seed_sequence('sequence-022',array[7,8,10,13,17]::numeric[],22,array[22,21,23,17]::numeric[],'The step grows by 1 each time, starting at +1.');

select public._seed_sequence('sequence-023',array[1,2,4,8,16]::numeric[],32,array[32,18,30,34]::numeric[],'Each number is multiplied by 2.');

select public._seed_sequence('sequence-024',array[2,4,8,16,32]::numeric[],64,array[64,34,62,66]::numeric[],'Each number is multiplied by 2.');

select public._seed_sequence('sequence-025',array[3,6,12,24,48]::numeric[],96,array[96,50,94,98]::numeric[],'Each number is multiplied by 2.');

select public._seed_sequence('sequence-026',array[1,3,9,27,81]::numeric[],243,array[243,84,240,246]::numeric[],'Each number is multiplied by 3.');

select public._seed_sequence('sequence-027',array[2,6,18,54,162]::numeric[],486,array[486,165,483,489]::numeric[],'Each number is multiplied by 3.');

select public._seed_sequence('sequence-028',array[5,10,20,40,80]::numeric[],160,array[160,82,158,162]::numeric[],'Each number is multiplied by 2.');

select public._seed_sequence('sequence-029',array[4,8,16,32,64]::numeric[],128,array[128,66,126,130]::numeric[],'Each number is multiplied by 2.');

select public._seed_sequence('sequence-030',array[3,9,27,81,243]::numeric[],729,array[729,246,726,732]::numeric[],'Each number is multiplied by 3.');

select public._seed_sequence('sequence-031',array[1,3,7,9,13]::numeric[],15,array[15,17,19,14]::numeric[],'The steps alternate between +2 and +4.');

select public._seed_sequence('sequence-032',array[3,4,7,8,11]::numeric[],12,array[12,13,15,11]::numeric[],'The steps alternate between +1 and +3.');

select public._seed_sequence('sequence-033',array[5,7,12,14,19]::numeric[],21,array[21,23,26,20]::numeric[],'The steps alternate between +2 and +5.');

select public._seed_sequence('sequence-034',array[2,5,6,9,10]::numeric[],13,array[13,16,14,12]::numeric[],'The steps alternate between +3 and +1.');

select public._seed_sequence('sequence-035',array[10,9,11,10,12]::numeric[],11,array[11,10,13,16]::numeric[],'The steps alternate between -1 and +2.');

select public._seed_sequence('sequence-036',array[4,8,9,13,14]::numeric[],18,array[18,22,19,17]::numeric[],'The steps alternate between +4 and +1.');

select public._seed_sequence('sequence-037',array[6,8,11,13,16]::numeric[],18,array[18,20,21,17]::numeric[],'The steps alternate between +2 and +3.');

select public._seed_sequence('sequence-038',array[8,9,13,14,18]::numeric[],19,array[19,20,23,18]::numeric[],'The steps alternate between +1 and +4.');

select public._seed_sequence('sequence-039',array[1,6,8,13,15]::numeric[],20,array[20,25,22,19]::numeric[],'The steps alternate between +5 and +2.');

select public._seed_sequence('sequence-040',array[7,10,12,15,17]::numeric[],20,array[20,23,22,19]::numeric[],'The steps alternate between +3 and +2.');

drop function if exists public._seed_sequence(text,numeric[],numeric,numeric[],text);


-- ============================================================
-- EXPANDED DAILY ROTATION — 8 ELIGIBLE ROTATING GAMES
-- Fixed: Brain Mix + BrainiWord. Variable: every unordered pair appears once per 28-day cycle.
-- ============================================================

create or replace function public.brainilab_daily_game_ids(p_date date)
returns text[] language plpgsql immutable set search_path=public as $$
declare v_number integer; v_index integer; v_pair text[];
begin
  if p_date<date '2026-08-31' then return array['brainmix','orderup','topicrush','brainiword']::text[]; end if;
  v_number:=public.brainilab_daily_number_for_date(p_date);
  v_index:=mod(v_number-3,28);
  if v_index<0 then v_index:=v_index+28; end if;
  v_pair:=case v_index
    when 0 then array['orderup','sequence']::text[]
    when 1 then array['topicrush','numberroute']::text[]
    when 2 then array['connections','mathrush']::text[]
    when 3 then array['oddoneout','higherlower']::text[]
    when 4 then array['orderup','numberroute']::text[]
    when 5 then array['sequence','mathrush']::text[]
    when 6 then array['topicrush','higherlower']::text[]
    when 7 then array['connections','oddoneout']::text[]
    when 8 then array['orderup','mathrush']::text[]
    when 9 then array['numberroute','higherlower']::text[]
    when 10 then array['sequence','oddoneout']::text[]
    when 11 then array['topicrush','connections']::text[]
    when 12 then array['orderup','higherlower']::text[]
    when 13 then array['mathrush','oddoneout']::text[]
    when 14 then array['numberroute','connections']::text[]
    when 15 then array['sequence','topicrush']::text[]
    when 16 then array['orderup','oddoneout']::text[]
    when 17 then array['higherlower','connections']::text[]
    when 18 then array['mathrush','topicrush']::text[]
    when 19 then array['numberroute','sequence']::text[]
    when 20 then array['orderup','connections']::text[]
    when 21 then array['oddoneout','topicrush']::text[]
    when 22 then array['higherlower','sequence']::text[]
    when 23 then array['mathrush','numberroute']::text[]
    when 24 then array['orderup','topicrush']::text[]
    when 25 then array['connections','sequence']::text[]
    when 26 then array['oddoneout','numberroute']::text[]
    when 27 then array['higherlower','mathrush']::text[]
    else array['orderup','sequence']::text[]
  end;
  return array['brainmix',v_pair[1],v_pair[2],'brainiword']::text[];
end;$$;

alter table public.daily_rotating_content drop constraint if exists daily_rotating_game;
alter table public.daily_rotating_content add constraint daily_rotating_game
  check(game_id in ('connections','oddoneout','higherlower','numberroute','sequence'));

create or replace function public.ensure_brainilab_rotating_daily_content(p_daily_challenge_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_date date; v_games text[];
begin
  select challenge_date into v_date from public.daily_challenges where id=p_daily_challenge_id;
  if v_date is null then raise exception 'Daily Challenge not found'; end if;
  if v_date<date '2026-08-31' then return; end if;
  v_games:=public.brainilab_daily_game_ids(v_date);

  if 'connections'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='connections') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'connections',row_number() over(order by usage_count,hash_key)::integer,id from (
      select p.id,(select count(*) from public.daily_rotating_content d where d.game_id='connections' and d.content_id=p.id) usage_count,md5(p.id::text||':'||v_date::text) hash_key
      from public.connections_puzzles p where p.is_active=true order by usage_count,hash_key limit 3
    ) q;
  end if;
  if 'oddoneout'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='oddoneout') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'oddoneout',row_number() over(order by usage_count,hash_key)::integer,id from (
      select p.id,(select count(*) from public.daily_rotating_content d where d.game_id='oddoneout' and d.content_id=p.id) usage_count,md5(p.id::text||':'||v_date::text) hash_key
      from public.odd_one_out_puzzles p where p.is_active=true order by usage_count,hash_key limit 10
    ) q;
  end if;
  if 'higherlower'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='higherlower') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'higherlower',row_number() over(order by usage_count,hash_key)::integer,id from (
      select p.id,(select count(*) from public.daily_rotating_content d where d.game_id='higherlower' and d.content_id=p.id) usage_count,md5(p.id::text||':'||v_date::text) hash_key
      from public.higher_lower_pairs p where p.is_active=true order by usage_count,hash_key limit 10
    ) q;
  end if;
  if 'numberroute'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='numberroute') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'numberroute',row_number() over(order by usage_count,hash_key)::integer,id from (
      select p.id,(select count(*) from public.daily_rotating_content d where d.game_id='numberroute' and d.content_id=p.id) usage_count,md5(p.id::text||':'||v_date::text) hash_key
      from public.number_route_puzzles p where p.is_active=true order by usage_count,hash_key limit 10
    ) q;
  end if;
  if 'sequence'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='sequence') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'sequence',row_number() over(order by usage_count,hash_key)::integer,id from (
      select p.id,(select count(*) from public.daily_rotating_content d where d.game_id='sequence' and d.content_id=p.id) usage_count,md5(p.id::text||':'||v_date::text) hash_key
      from public.sequence_puzzles p where p.is_active=true order by usage_count,hash_key limit 10
    ) q;
  end if;
end;$$;
revoke execute on function public.ensure_brainilab_rotating_daily_content(uuid) from public,anon,authenticated;

-- Re-run assignment for already-generated future Daily rows under the expanded lineup.
do $$
declare v_daily record; v_games text[];
begin
  for v_daily in select id,challenge_date from public.daily_challenges where challenge_date>=date '2026-08-31' loop
    v_games:=public.brainilab_daily_game_ids(v_daily.challenge_date);
    if 'topicrush'=any(v_games) then perform public.ensure_brainilab_topic_rush(v_daily.id); end if;
    if 'orderup'=any(v_games) then perform public.ensure_brainilab_order_up(v_daily.id); end if;
    perform public.ensure_brainilab_rotating_daily_content(v_daily.id);
  end loop;
end;$$;

create or replace function public.get_brainilab_daily_number_route(p_challenge_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_daily record; v_puzzles jsonb;
begin
  select id,daily_number,challenge_date into v_daily from public.daily_challenges
  where challenge_date=p_challenge_date and status='published' order by generation_version desc limit 1;
  if v_daily.id is null or not ('numberroute'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('puzzle_id',p.id,'external_key',p.external_key,'category',p.category,'numbers',to_jsonb(p.numbers),'target',p.target) order by d.position),'[]'::jsonb)
    into v_puzzles from public.daily_rotating_content d join public.number_route_puzzles p on p.id=d.content_id
    where d.daily_challenge_id=v_daily.id and d.game_id='numberroute';
  if jsonb_array_length(v_puzzles)<>10 then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'puzzles',v_puzzles);
end;$$;
revoke execute on function public.get_brainilab_daily_number_route(date) from public;
grant execute on function public.get_brainilab_daily_number_route(date) to anon,authenticated;

create or replace function public.get_brainilab_daily_sequence(p_challenge_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_daily record; v_puzzles jsonb;
begin
  select id,daily_number,challenge_date into v_daily from public.daily_challenges
  where challenge_date=p_challenge_date and status='published' order by generation_version desc limit 1;
  if v_daily.id is null or not ('sequence'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',p.id,'external_key',p.external_key,'category',p.category,'sequence',to_jsonb(p.sequence_values),
    'options',(select jsonb_agg(x order by md5(x::text||':'||p.id::text||':'||p_challenge_date::text)) from unnest(p.options) x)
  ) order by d.position),'[]'::jsonb) into v_puzzles
  from public.daily_rotating_content d join public.sequence_puzzles p on p.id=d.content_id
  where d.daily_challenge_id=v_daily.id and d.game_id='sequence';
  if jsonb_array_length(v_puzzles)<>10 then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'puzzles',v_puzzles);
end;$$;
revoke execute on function public.get_brainilab_daily_sequence(date) from public;
grant execute on function public.get_brainilab_daily_sequence(date) to anon,authenticated;


-- ============================================================
-- SERVER VERIFICATION — NEW GAMES
-- ============================================================

create or replace function public.verify_brainilab_math_rush_result(p_client_result_id text,p_seed text,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_result uuid; v_daily_number integer; v_expected_seed text;
  v_row jsonb; v_pos integer; v_given integer; v_skipped boolean; v_op jsonb; v_answer integer;
  v_correct integer:=0; v_total integer:=0; v_combo integer:=0; v_score integer:=0; v_seen integer[]:=array[]::integer[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(coalesce(p_seed,'')) not between 3 and 140 then raise exception 'Invalid Math Rush seed'; end if;
  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb))<>'array' or jsonb_array_length(p_answers) not between 1 and 60 then raise exception 'Invalid Math Rush answers'; end if;
  select gr.id,gs.daily_number into v_result,v_daily_number from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
    where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='mathrush' limit 1;
  if v_result is null then raise exception 'Math Rush result not found'; end if;
  if v_daily_number is not null then
    if not ('mathrush'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Math Rush is not in today''s Daily'; end if;
    v_expected_seed:='daily:'||current_date::text||':mathrush';
    if p_seed<>v_expected_seed then raise exception 'Math Rush Daily seed mismatch'; end if;
  end if;
  for v_row in select value from jsonb_array_elements(p_answers) loop
    v_pos:=(v_row->>'position')::integer;
    if v_pos not between 1 and 60 or v_pos=any(v_seen) then raise exception 'Invalid or duplicate Math Rush position'; end if;
    v_seen:=array_append(v_seen,v_pos); v_skipped:=coalesce((v_row->>'skipped')::boolean,false);
    v_op:=public.brainilab_math_rush_operation(p_seed,v_pos); v_answer:=(v_op->>'answer')::integer;
    if v_skipped then v_combo:=0; continue; end if;
    v_total:=v_total+1; v_given:=(v_row->>'answer')::integer;
    if v_given=v_answer then v_correct:=v_correct+1; v_combo:=v_combo+1; v_score:=v_score+100+least(100,greatest(0,v_combo-1)*10); else v_combo:=0; end if;
  end loop;
  update public.game_results set score=v_score,correct_answers=v_correct,total_questions=v_total,
    accuracy=case when v_total>0 then round(v_correct::numeric/v_total*100,2) else 0 end,
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=v_total,answers_verified_at=now()
    where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',v_total,'accuracy',case when v_total>0 then round(v_correct::numeric/v_total*100,2) else 0 end,'score',v_score);
end;$$;
revoke execute on function public.verify_brainilab_math_rush_result(text,text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_math_rush_result(text,text,jsonb) to authenticated;

create or replace function public.verify_brainilab_number_route_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_result uuid; v_daily_number integer; v_daily_id uuid;
  v_row jsonb; v_id uuid; v_ops text[]; v_solution text[]; v_attempts integer; v_skipped boolean;
  v_correct integer:=0; v_score integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Number Route requires exactly 10 rounds'; end if;
  select gr.id,gs.daily_number into v_result,v_daily_number from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
    where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='numberroute' limit 1;
  if v_result is null then raise exception 'Number Route result not found'; end if;
  if v_daily_number is not null then
    select id into v_daily_id from public.daily_challenges where daily_number=v_daily_number and challenge_date=current_date and status='published' limit 1;
    if v_daily_id is null or not ('numberroute'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Number Route is not in today''s Daily'; end if;
  end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'puzzle_id')::uuid; if v_id=any(v_seen) then raise exception 'Duplicate Number Route puzzle'; end if; v_seen:=array_append(v_seen,v_id);
    if v_daily_id is not null and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=v_daily_id and game_id='numberroute' and content_id=v_id) then raise exception 'Number Route puzzle is not assigned to today''s Daily'; end if;
    select solution into v_solution from public.number_route_puzzles where id=v_id; if v_solution is null then raise exception 'Number Route puzzle not found'; end if;
    v_skipped:=coalesce((v_row->>'skipped')::boolean,false); v_attempts:=greatest(1,least(100,coalesce((v_row->>'attempts')::integer,1)));
    if not v_skipped then
      select array_agg(value order by ordinality) into v_ops from jsonb_array_elements_text(coalesce(v_row->'operators','[]'::jsonb)) with ordinality;
      if cardinality(v_ops)<>3 or v_ops<>v_solution then raise exception 'Invalid Number Route solved route'; end if;
      v_correct:=v_correct+1; v_score:=v_score+case v_attempts when 1 then 250 when 2 then 180 when 3 then 120 else 80 end;
    end if;
  end loop;
  update public.game_results set score=v_score,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_score);
end;$$;
revoke execute on function public.verify_brainilab_number_route_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_number_route_result(text,jsonb) to authenticated;

create or replace function public.verify_brainilab_sequence_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_result uuid; v_daily_number integer; v_daily_id uuid;
  v_row jsonb; v_id uuid; v_given numeric; v_answer numeric; v_correct integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Sequence requires exactly 10 rounds'; end if;
  select gr.id,gs.daily_number into v_result,v_daily_number from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
    where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='sequence' limit 1;
  if v_result is null then raise exception 'Sequence result not found'; end if;
  if v_daily_number is not null then
    select id into v_daily_id from public.daily_challenges where daily_number=v_daily_number and challenge_date=current_date and status='published' limit 1;
    if v_daily_id is null or not ('sequence'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Sequence is not in today''s Daily'; end if;
  end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'puzzle_id')::uuid; v_given:=(v_row->>'answer')::numeric;
    if v_id=any(v_seen) then raise exception 'Duplicate Sequence puzzle'; end if; v_seen:=array_append(v_seen,v_id);
    if v_daily_id is not null and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=v_daily_id and game_id='sequence' and content_id=v_id) then raise exception 'Sequence puzzle is not assigned to today''s Daily'; end if;
    select answer_value into v_answer from public.sequence_puzzles where id=v_id; if v_answer is null then raise exception 'Sequence puzzle not found'; end if;
    if v_given=v_answer then v_correct:=v_correct+1; end if;
  end loop;
  update public.game_results set score=v_correct*250,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_correct*250);
end;$$;
revoke execute on function public.verify_brainilab_sequence_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_sequence_result(text,jsonb) to authenticated;


-- ============================================================
-- ADMIN — NEW CONTENT POOLS + CSV IMPORTS
-- ============================================================

create or replace function public.admin_list_number_route_puzzles()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid; v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'external_key',p.external_key,'category',p.category,'numbers',to_jsonb(p.numbers),'target',p.target,
    'active',p.is_active,'play_count',(select coalesce(sum(h.times_played),0) from public.player_number_route_history h where h.puzzle_id=p.id)
  ) order by p.is_active desc,p.external_key),'[]'::jsonb) into v_payload from public.number_route_puzzles p;
  return v_payload;
end;$$;
revoke execute on function public.admin_list_number_route_puzzles() from public,anon;
grant execute on function public.admin_list_number_route_puzzles() to authenticated;

create or replace function public.admin_create_number_route_puzzle(p_external_key text,p_category text,p_numbers integer[],p_target integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_eval jsonb; v_solution text[]; v_id uuid;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  if lower(btrim(coalesce(p_external_key,''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid external key'; end if;
  if cardinality(p_numbers)<>4 or p_numbers[1] not between 1 and 9 or p_numbers[2] not between 1 and 9 or p_numbers[3] not between 1 and 9 or p_numbers[4] not between 1 and 9 then raise exception 'Number Route requires four integers from 1 to 9'; end if;
  if p_target not between 0 and 200 then raise exception 'Target must be 0–200'; end if;
  v_eval:=public.brainilab_number_route_solutions(p_numbers,p_target);
  if coalesce((v_eval->>'count')::integer,0)<>1 then raise exception 'Number Route must have exactly one valid solution; found %',coalesce((v_eval->>'count')::integer,0); end if;
  select array_agg(value order by ordinality) into v_solution from jsonb_array_elements_text(v_eval->'solution') with ordinality;
  insert into public.number_route_puzzles(external_key,category,numbers,target,solution,is_active)
  values(lower(btrim(p_external_key)),lower(btrim(coalesce(p_category,'math'))),p_numbers,p_target,v_solution,true) returning id into v_id;
  perform public.log_brainilab_admin_action('NUMBER_ROUTE_CREATED','number_route_puzzle',v_id::text,jsonb_build_object('external_key',p_external_key));
  return jsonb_build_object('id',v_id,'created',true,'solution',to_jsonb(v_solution));
end;$$;
revoke execute on function public.admin_create_number_route_puzzle(text,text,integer[],integer) from public,anon;
grant execute on function public.admin_create_number_route_puzzle(text,text,integer[],integer) to authenticated;

create or replace function public.admin_toggle_number_route_puzzle(p_puzzle_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_brainilab_admin(array['owner','editor']::text[]);
  update public.number_route_puzzles set is_active=coalesce(p_active,false),updated_at=now() where id=p_puzzle_id;
  if not found then raise exception 'Number Route puzzle not found'; end if;
  return jsonb_build_object('id',p_puzzle_id,'active',p_active);
end;$$;
revoke execute on function public.admin_toggle_number_route_puzzle(uuid,boolean) from public,anon;
grant execute on function public.admin_toggle_number_route_puzzle(uuid,boolean) to authenticated;

create or replace function public.admin_list_sequence_puzzles()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid; v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'external_key',p.external_key,'category',p.category,'sequence',to_jsonb(p.sequence_values),'answer',p.answer_value,
    'options',to_jsonb(p.options),'explanation',p.explanation,'active',p.is_active,
    'play_count',(select coalesce(sum(h.times_played),0) from public.player_sequence_history h where h.puzzle_id=p.id)
  ) order by p.is_active desc,p.external_key),'[]'::jsonb) into v_payload from public.sequence_puzzles p;
  return v_payload;
end;$$;
revoke execute on function public.admin_list_sequence_puzzles() from public,anon;
grant execute on function public.admin_list_sequence_puzzles() to authenticated;

create or replace function public.admin_create_sequence_puzzle(p_external_key text,p_category text,p_sequence numeric[],p_answer numeric,p_options numeric[],p_explanation text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform public.require_brainilab_admin(array['owner','editor']::text[]);
  if lower(btrim(coalesce(p_external_key,''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid external key'; end if;
  if cardinality(p_sequence)<>5 then raise exception 'Sequence requires exactly five visible values'; end if;
  if cardinality(p_options)<>4 or not (p_answer=any(p_options)) then
    raise exception 'Sequence requires four options containing the answer';
  end if;
  if (select count(distinct x) from unnest(p_options) x)<>4 then raise exception 'Sequence options must be unique'; end if;
  insert into public.sequence_puzzles(external_key,category,sequence_values,answer_value,options,explanation,is_active)
  values(lower(btrim(p_external_key)),lower(btrim(coalesce(p_category,'math'))),p_sequence,p_answer,p_options,btrim(coalesce(p_explanation,'')),true) returning id into v_id;
  perform public.log_brainilab_admin_action('SEQUENCE_CREATED','sequence_puzzle',v_id::text,jsonb_build_object('external_key',p_external_key));
  return jsonb_build_object('id',v_id,'created',true);
end;$$;
revoke execute on function public.admin_create_sequence_puzzle(text,text,numeric[],numeric,numeric[],text) from public,anon;
grant execute on function public.admin_create_sequence_puzzle(text,text,numeric[],numeric,numeric[],text) to authenticated;

create or replace function public.admin_toggle_sequence_puzzle(p_puzzle_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_brainilab_admin(array['owner','editor']::text[]);
  update public.sequence_puzzles set is_active=coalesce(p_active,false),updated_at=now() where id=p_puzzle_id;
  if not found then raise exception 'Sequence puzzle not found'; end if;
  return jsonb_build_object('id',p_puzzle_id,'active',p_active);
end;$$;
revoke execute on function public.admin_toggle_sequence_puzzle(uuid,boolean) from public,anon;
grant execute on function public.admin_toggle_sequence_puzzle(uuid,boolean) to authenticated;

create or replace function public.admin_import_content_pool(p_pool_type text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid; v_type text:=lower(btrim(coalesce(p_pool_type,''))); v_row jsonb; v_created integer:=0; v_failed integer:=0; v_errors jsonb:='[]'::jsonb;
  v_nums integer[]; v_seq numeric[]; v_opts numeric[];
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then raise exception 'Import rows must be an array'; end if;
  if jsonb_array_length(p_rows)>500 then raise exception 'Import limit is 500 rows at a time'; end if;
  if v_type not in ('brainiword','topicrush','orderup','connections','oddoneout','higherlower','numberroute','sequence') then raise exception 'Unsupported content pool type'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    begin
      case v_type
        when 'brainiword' then perform public.admin_add_brainiword_word(v_row->>'word');
        when 'topicrush' then perform public.admin_create_topic_rush_topic(v_row->>'external_key',v_row->>'title',v_row->>'prompt',(v_row->>'target_count')::integer,v_row->'answers');
        when 'orderup' then perform public.admin_create_order_up_round(v_row->>'external_key',v_row->>'title',v_row->>'prompt',v_row->>'direction_label',v_row->>'category',v_row->'items');
        when 'connections' then perform public.admin_create_connections_puzzle(v_row->>'external_key',v_row->>'category',v_row->>'prompt',v_row->'clues',v_row->>'correct_connection',v_row->'distractors',coalesce(v_row->>'explanation',''));
        when 'oddoneout' then perform public.admin_create_odd_one_out_puzzle(v_row->>'external_key',v_row->>'category',v_row->>'prompt',v_row->'items',(v_row->>'odd_index')::integer,coalesce(v_row->>'explanation',''));
        when 'higherlower' then perform public.admin_create_higher_lower_pair(v_row->>'external_key',v_row->>'category',v_row->>'comparison_type',v_row->>'metric',v_row->>'left_label',(v_row->>'left_value')::numeric,v_row->>'right_label',(v_row->>'right_value')::numeric,coalesce(v_row->>'unit',''),coalesce(v_row->>'explanation',''));
        when 'numberroute' then
          select array_agg(value::integer order by ordinality) into v_nums from jsonb_array_elements_text(v_row->'numbers') with ordinality;
          perform public.admin_create_number_route_puzzle(v_row->>'external_key',v_row->>'category',v_nums,(v_row->>'target')::integer);
        when 'sequence' then
          select array_agg(value::numeric order by ordinality) into v_seq from jsonb_array_elements_text(v_row->'sequence') with ordinality;
          select array_agg(value::numeric order by ordinality) into v_opts from jsonb_array_elements_text(v_row->'options') with ordinality;
          perform public.admin_create_sequence_puzzle(v_row->>'external_key',v_row->>'category',v_seq,(v_row->>'answer')::numeric,v_opts,coalesce(v_row->>'explanation',''));
      end case;
      v_created:=v_created+1;
    exception when others then
      v_failed:=v_failed+1;
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object('external_key',coalesce(v_row->>'external_key',v_row->>'word'),'error',sqlerrm));
    end;
  end loop;
  perform public.log_brainilab_admin_action('CONTENT_POOL_IMPORT_COMPLETED',v_type,null,jsonb_build_object('created',v_created,'failed',v_failed));
  return jsonb_build_object('created',v_created,'failed',v_failed,'errors',v_errors);
end;$$;
revoke execute on function public.admin_import_content_pool(text,jsonb) from public,anon;
grant execute on function public.admin_import_content_pool(text,jsonb) to authenticated;


-- ============================================================
-- DAILY SCORE NORMALIZATION + CLOUD PROGRESSION
-- ============================================================

alter table public.player_daily_stats
  add column if not exists mathrush_points integer not null default 0,
  add column if not exists numberroute_points integer not null default 0,
  add column if not exists sequence_points integer not null default 0;

alter table public.player_daily_stats drop constraint if exists player_daily_points_range;
alter table public.player_daily_stats add constraint player_daily_points_range check(
  brainmix_points between 0 and 2500 and flagdash_points between 0 and 2500 and orderup_points between 0 and 2500
  and maphunt_points between 0 and 2500 and topicrush_points between 0 and 2500 and brainiword_points between 0 and 2500
  and connections_points between 0 and 2500 and oddoneout_points between 0 and 2500 and higherlower_points between 0 and 2500
  and mathrush_points between 0 and 2500 and numberroute_points between 0 and 2500 and sequence_points between 0 and 2500
  and daily_brain_score between 0 and 10000
);

create or replace function public.brainilab_daily_game_points(p_game_id text,p_score integer,p_correct integer,p_payload jsonb)
returns integer language plpgsql immutable set search_path=public as $$
declare v_points integer:=0; v_attempts integer; v_won boolean:=false; v_best_combo integer:=0;
begin
  if p_game_id='brainmix' then v_points:=least(2500,greatest(0,round(coalesce(p_score,0)*0.25)::integer));
  elsif p_game_id='flagdash' then begin v_best_combo:=coalesce((p_payload->>'bestCombo')::integer,0); exception when others then v_best_combo:=0; end; v_points:=least(2500,greatest(0,coalesce(p_correct,0)*70+v_best_combo*15));
  elsif p_game_id in ('orderup','topicrush','mathrush','numberroute','sequence') then v_points:=least(2500,greatest(0,coalesce(p_score,0)));
  elsif p_game_id='connections' then v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/3000.0*2500)::integer));
  elsif p_game_id='oddoneout' then v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/1000.0*2500)::integer));
  elsif p_game_id='higherlower' then v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/1700.0*2500)::integer));
  elsif p_game_id='maphunt' then v_points:=least(2500,greatest(0,round(coalesce(p_score,0)*0.42)::integer));
  elsif p_game_id='brainiword' then
    v_won:=lower(coalesce(p_payload->>'won','false'))='true'; begin v_attempts:=(p_payload->>'attempts')::integer; exception when others then v_attempts:=null; end;
    if not v_won then v_points:=250; else v_points:=case v_attempts when 1 then 2500 when 2 then 2250 when 3 then 2000 when 4 then 1750 when 5 then 1500 else 1000 end; end if;
  end if;
  return least(2500,greatest(0,coalesce(v_points,0)));
end;$$;

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
  v_topicrush_launch_date date;
  v_orderup_launch_date date;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.player_progression(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  select trs.launch_date
    into v_topicrush_launch_date
  from public.topic_rush_settings trs
  where trs.singleton=true;

  v_topicrush_launch_date:=coalesce(v_topicrush_launch_date,current_date);

  select ous.launch_date
    into v_orderup_launch_date
  from public.order_up_settings ous
  where ous.singleton=true;

  v_orderup_launch_date:=coalesce(v_orderup_launch_date,current_date);

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
    orderup_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,
    connections_points,
    oddoneout_points,
    higherlower_points,
    mathrush_points,
    numberroute_points,
    sequence_points,
    daily_brain_score,
    xp_earned,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gs.game_id,
      gs.daily_number,
      gr.id as result_id,
      coalesce(gr.score,0) as score,
      coalesce(gr.verified_correct_answers,gr.correct_answers,0) as correct_answers,
      coalesce(gr.verified_total_questions,gr.total_questions,0) as total_questions,
      gr.result_payload,
      coalesce(gr.answers_verified,false) as answers_verified,
      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(gr.verified_correct_answers,gr.correct_answers),
        gr.result_payload
      ) as daily_points
    from public.game_sessions gs
    join public.game_results gr on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  ),
  marked as (
    select b.*,
      (
        b.daily_number is not null
        and b.daily_number=public.brainilab_daily_number_for_date(b.stat_date)
        and b.game_id=any(public.brainilab_daily_game_ids(b.stat_date))
        and (
          b.game_id not in ('connections','oddoneout','higherlower','mathrush','numberroute','sequence')
          or b.answers_verified=true
        )
      ) as valid_daily
    from base b
  ),
  daily as (
    select
      user_id,
      stat_date,
      count(*)::integer as games_played,
      coalesce(sum(total_questions),0)::integer as questions_answered,
      count(distinct game_id) filter(where valid_daily)::integer as daily_games_completed,
      coalesce(max(daily_points) filter(where valid_daily and game_id='brainmix'),0)::integer as brainmix_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='flagdash'),0)::integer as flagdash_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='orderup'),0)::integer as orderup_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='maphunt'),0)::integer as maphunt_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='topicrush'),0)::integer as topicrush_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='brainiword'),0)::integer as brainiword_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='connections'),0)::integer as connections_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='oddoneout'),0)::integer as oddoneout_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='higherlower'),0)::integer as higherlower_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='mathrush'),0)::integer as mathrush_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='numberroute'),0)::integer as numberroute_points,
      coalesce(max(daily_points) filter(where valid_daily and game_id='sequence'),0)::integer as sequence_points,
      coalesce(sum(50+least(correct_answers,50)*5),0)::integer as base_xp
    from marked
    group by user_id,stat_date
  )
  select
    user_id,
    stat_date,
    games_played,
    questions_answered,
    least(4,daily_games_completed),
    daily_games_completed>=4,
    brainmix_points,
    flagdash_points,
    orderup_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,
    connections_points,
    oddoneout_points,
    higherlower_points,
    mathrush_points,
    numberroute_points,
    sequence_points,
    least(10000,
      brainmix_points+flagdash_points+orderup_points+maphunt_points+topicrush_points+brainiword_points+
      connections_points+oddoneout_points+higherlower_points+mathrush_points+numberroute_points+sequence_points
    ),
    base_xp+case when daily_games_completed>=4 then 250 else 0 end,
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

create or replace function public.get_my_brainilab_progression()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_week date := date_trunc('week',(now() at time zone 'UTC'))::date;
  v_month date := date_trunc('month',(now() at time zone 'UTC'))::date;

  v_daily_number integer;
  v_daily_games text[];
  v_completed_daily_games text[] := array[]::text[];

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

  v_daily_number:=coalesce(
    v_daily_number,
    public.brainilab_daily_number_for_date(v_today)
  );
  v_daily_games:=public.brainilab_daily_game_ids(v_today);

  select coalesce(array_agg(distinct gs.game_id order by gs.game_id),array[]::text[])
    into v_completed_daily_games
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=v_user_id
    and gs.status='completed'
    and gs.daily_number=v_daily_number
    and (gs.completed_at at time zone 'UTC')::date=v_today
    and gs.game_id=any(v_daily_games)
    and (
      gs.game_id not in ('connections','oddoneout','higherlower','mathrush','numberroute','sequence')
      or coalesce(gr.answers_verified,false)=true
    );

  select to_jsonb(pp)
    into v_progression
  from public.player_progression pp
  where pp.user_id=v_user_id;

  select
    coalesce(to_jsonb(ds),'{}'::jsonb)
    || jsonb_build_object(
      'stat_date',v_today,
      'daily_number',v_daily_number,
      'daily_game_ids',to_jsonb(v_daily_games),
      'completed_game_ids',to_jsonb(v_completed_daily_games),

      'games_played',coalesce(ds.games_played,0),
      'questions_answered',coalesce(ds.questions_answered,0),
      'daily_games_completed',coalesce(ds.daily_games_completed,0),
      'full_daily',coalesce(ds.full_daily,false),

      'brainmix_points',coalesce(ds.brainmix_points,0),
      'flagdash_points',coalesce(ds.flagdash_points,0),
      'orderup_points',coalesce(ds.orderup_points,0),
      'maphunt_points',coalesce(ds.maphunt_points,0),
      'topicrush_points',coalesce(ds.topicrush_points,0),
      'brainiword_points',coalesce(ds.brainiword_points,0),
      'connections_points',coalesce(ds.connections_points,0),
      'oddoneout_points',coalesce(ds.oddoneout_points,0),
      'higherlower_points',coalesce(ds.higherlower_points,0),
      'mathrush_points',coalesce(ds.mathrush_points,0),
      'numberroute_points',coalesce(ds.numberroute_points,0),
      'sequence_points',coalesce(ds.sequence_points,0),

      'brainmix_played','brainmix'=any(v_completed_daily_games),
      'flagdash_played','flagdash'=any(v_completed_daily_games),
      'orderup_played','orderup'=any(v_completed_daily_games),
      'maphunt_played','maphunt'=any(v_completed_daily_games),
      'topicrush_played','topicrush'=any(v_completed_daily_games),
      'brainiword_played','brainiword'=any(v_completed_daily_games),
      'connections_played','connections'=any(v_completed_daily_games),
      'oddoneout_played','oddoneout'=any(v_completed_daily_games),
      'higherlower_played','higherlower'=any(v_completed_daily_games),
      'mathrush_played','mathrush'=any(v_completed_daily_games),
      'numberroute_played','numberroute'=any(v_completed_daily_games),
      'sequence_played','sequence'=any(v_completed_daily_games),

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
revoke execute on function public.get_my_brainilab_progression() from public,anon;
grant execute on function public.get_my_brainilab_progression() to authenticated;

create or replace function public.admin_get_game_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid; v_days integer:=least(365,greatest(1,coalesce(p_days,30))); v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);

  with active_games(game_id) as (values
    ('brainmix'::text),('orderup'),('topicrush'),('brainiword'),
    ('generalknowledge'),('worldflags'),('worldcapitals'),('science'),('history'),('sports'),
    ('connections'),('survival'),('oddoneout'),('higherlower'),('mathrush'),('numberroute'),('sequence')
  ),
  starts as (
    select cps.game_id,
      count(*)::integer as starts,
      count(distinct cps.user_id)::integer as start_players,
      count(*) filter(where cps.status='started' and cps.last_seen_at<now()-interval '15 minutes')::integer as exits
    from public.content_play_sessions cps
    join active_games ag on ag.game_id=cps.game_id
    where cps.started_at>=now()-(v_days||' days')::interval
    group by cps.game_id
  ),
  completed_raw as (
    select gs.game_id,gs.user_id,gs.completed_at,gr.score,gr.accuracy,gr.duration_ms,gr.answers_verified
    from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
    join active_games ag on ag.game_id=gs.game_id
    where gs.status='completed' and gs.completed_at>=now()-(v_days||' days')::interval
  ),
  completed as (
    select game_id,count(*)::integer as plays,count(distinct user_id)::integer as unique_players,
      round(avg(score)::numeric,1) as avg_score,round(avg(accuracy)::numeric,1) as avg_accuracy,
      round((avg(duration_ms)/1000.0)::numeric,1) as avg_duration_sec,max(completed_at) as last_played,
      round((100.0*count(*) filter(where answers_verified=true)/nullif(count(*),0))::numeric,1) as verified_pct
    from completed_raw group by game_id
  ),
  joined as (
    select ag.game_id,
      coalesce(s.starts,c.plays,0) as starts,
      coalesce(c.plays,0) as plays,
      coalesce(c.unique_players,s.start_players,0) as unique_players,
      coalesce(s.exits,0) as exits,
      c.avg_score,c.avg_accuracy,c.avg_duration_sec,c.last_played,c.verified_pct
    from active_games ag
    left join starts s on s.game_id=ag.game_id
    left join completed c on c.game_id=ag.game_id
  ),
  usage as (
    select j.*,max(starts) over() as max_starts,
      round(100.0*exits/nullif(starts,0),1) as exit_rate,
      round(100.0*plays/nullif(starts,0),1) as completion_rate
    from joined j
  ),
  scored as (
    select u.*,
      round(
        0.45*greatest(0,least(100,coalesce(completion_rate,case when starts=0 then 0 else 100 end)))
        +0.25*greatest(0,least(100,coalesce(avg_accuracy,65)))
        +0.30*case when coalesce(max_starts,0)=0 then 0 else least(100,100.0*starts/max_starts) end
      )::integer as health_score
    from usage u
  ),
  totals as (
    select count(*)::integer as total_plays,count(distinct user_id)::integer as unique_players,round(avg(accuracy)::numeric,1) as avg_accuracy
    from completed_raw
  )
  select jsonb_build_object(
    'days',v_days,
    'summary',jsonb_build_object(
      'total_plays',coalesce((select total_plays from totals),0),
      'unique_players',coalesce((select unique_players from totals),0),
      'avg_accuracy',(select avg_accuracy from totals),
      'top_game',(select game_id from scored where plays>0 order by plays desc,game_id limit 1)
    ),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'game_id',game_id,'starts',starts,'plays',plays,'unique_players',unique_players,
      'avg_score',avg_score,'avg_accuracy',avg_accuracy,'avg_duration_sec',avg_duration_sec,'last_played',last_played,
      'verified_pct',verified_pct,'exit_rate',exit_rate,'completion_rate',completion_rate,'health_score',health_score,
      'sample_state',case when starts<10 then 'building' else 'established' end,
      'health_label',case when starts<10 then 'Building sample' when health_score>=80 then 'Strong' when health_score>=60 then 'Healthy' when health_score>=40 then 'Watch' else 'Poor' end
    ) order by health_score asc,starts desc) from scored),'[]'::jsonb)
  ) into v_payload;
  return v_payload;
end;
$$;
revoke execute on function public.admin_get_game_analytics(integer) from public,anon;
grant execute on function public.admin_get_game_analytics(integer) to authenticated;


-- Force a refresh for authenticated players lazily on next result; no global user scan is performed here.
-- Verification / smoke tests after execution:
-- select public.brainilab_daily_game_ids(date '2026-08-31');
-- select public.brainilab_daily_game_ids(date '2026-09-01');
-- select count(*) from public.number_route_puzzles where is_active=true;
-- select count(*) from public.sequence_puzzles where is_active=true;
-- select public.brainilab_number_route_solutions(array[2,1,6,7],16);

commit;
