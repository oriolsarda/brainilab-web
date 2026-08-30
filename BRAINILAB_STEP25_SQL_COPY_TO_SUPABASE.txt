-- BrainiLab Step 25 — V41.6.0
-- Content Health telemetry + game Health + rotating Daily lineup
-- Run once AFTER Step 24.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- CONTENT HEALTH TELEMETRY
-- One start, sparse checkpoints, one completion per authenticated play.
-- A started session with no update for 15 minutes is treated as an exit.
-- ============================================================

create table if not exists public.content_play_sessions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_play_id text not null,
  game_id text not null,
  content_type text not null,
  content_ids text[] not null,
  daily_number integer null,
  last_position integer not null default 1,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(user_id,client_play_id),
  constraint content_play_status check(status in ('started','completed')),
  constraint content_play_ids check(cardinality(content_ids) between 1 and 60),
  constraint content_play_position check(last_position between 1 and 60),
  constraint content_play_type check(content_type in (
    'question','brainiword','topicrush','orderup','connections','oddoneout','higherlower'
  ))
);

create index if not exists content_play_sessions_started_idx
  on public.content_play_sessions(started_at desc,game_id);
create index if not exists content_play_sessions_content_idx
  on public.content_play_sessions(content_type,started_at desc);
create index if not exists content_play_sessions_user_idx
  on public.content_play_sessions(user_id,started_at desc);

create table if not exists public.content_play_outcomes(
  play_session_id uuid not null references public.content_play_sessions(id) on delete cascade,
  content_id text not null,
  position integer not null,
  attempts integer null,
  is_correct boolean null,
  skipped boolean not null default false,
  score numeric null,
  response_time_ms integer null,
  created_at timestamptz not null default now(),
  primary key(play_session_id,content_id),
  constraint content_outcome_position check(position between 1 and 60),
  constraint content_outcome_attempts check(attempts is null or attempts between 1 and 1000),
  constraint content_outcome_response check(response_time_ms is null or response_time_ms>=0)
);

create index if not exists content_play_outcomes_content_idx
  on public.content_play_outcomes(content_id,created_at desc);

alter table public.content_play_sessions enable row level security;
alter table public.content_play_outcomes enable row level security;
revoke all on table public.content_play_sessions from anon,authenticated;
revoke all on table public.content_play_outcomes from anon,authenticated;

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
  if p_content_type not in ('question','brainiword','topicrush','orderup','connections','oddoneout','higherlower') then raise exception 'Invalid content type'; end if;
  if coalesce(cardinality(p_content_ids),0) not between 1 and 60 then raise exception 'Content list must contain 1–60 items'; end if;

  insert into public.content_play_sessions(
    user_id,client_play_id,game_id,content_type,content_ids,daily_number,last_position,status,started_at,last_seen_at
  ) values(
    v_uid,btrim(p_client_play_id),btrim(p_game_id),p_content_type,p_content_ids,p_daily_number,1,'started',now(),now()
  )
  on conflict(user_id,client_play_id) do update
    set last_seen_at=now()
  returning id into v_id;

  return jsonb_build_object('ok',true,'play_session_id',v_id);
end;
$$;
revoke execute on function public.start_brainilab_content_play(text,text,text,text[],integer) from public,anon;
grant execute on function public.start_brainilab_content_play(text,text,text,text[],integer) to authenticated;

create or replace function public.checkpoint_brainilab_content_play(
  p_client_play_id text,
  p_last_position integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_uid uuid:=auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  update public.content_play_sessions
  set last_position=least(cardinality(content_ids),greatest(last_position,coalesce(p_last_position,1))),
      last_seen_at=now()
  where user_id=v_uid and client_play_id=p_client_play_id and status='started';
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',v_count>0);
end;
$$;
revoke execute on function public.checkpoint_brainilab_content_play(text,integer) from public,anon;
grant execute on function public.checkpoint_brainilab_content_play(text,integer) to authenticated;

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
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_outcomes,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_outcomes,'[]'::jsonb))>60 then
    raise exception 'Invalid outcomes';
  end if;

  select * into v_session
  from public.content_play_sessions
  where user_id=v_uid and client_play_id=p_client_play_id
  for update;
  if v_session.id is null then return jsonb_build_object('ok',false); end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_outcomes,'[]'::jsonb)) loop
    v_content_id=btrim(coalesce(v_row->>'content_id',''));
    if v_content_id='' or not (v_content_id=any(v_session.content_ids)) then continue; end if;
    v_position=greatest(1,least(cardinality(v_session.content_ids),coalesce(nullif(v_row->>'position','')::integer,1)));
    v_attempts=case when nullif(v_row->>'attempts','') is null then null else greatest(1,least(1000,(v_row->>'attempts')::integer)) end;
    v_response=case when nullif(v_row->>'response_time_ms','') is null then null else greatest(0,(v_row->>'response_time_ms')::integer) end;

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
      last_position=cardinality(content_ids),
      last_seen_at=now(),
      completed_at=coalesce(completed_at,now())
  where id=v_session.id;

  return jsonb_build_object('ok',true);
end;
$$;
revoke execute on function public.complete_brainilab_content_play(text,integer,jsonb) from public,anon;
grant execute on function public.complete_brainilab_content_play(text,integer,jsonb) to authenticated;

-- Health formula:
-- 45% completion/exit signal, 35% answer success around a useful 65% target,
-- 20% attempt efficiency. Fewer than 10 exposures is flagged as Building sample.
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
      case
        when s.status='completed' then cardinality(s.content_ids)
        else greatest(1,least(cardinality(s.content_ids),s.last_position))
      end as exposed_to
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
          when m.content_type in ('question','oddoneout','higherlower')
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
-- DAILY ROTATION
-- Brain Mix + BrainiWord are fixed. Two structured slots rotate by UTC date.
-- Rotation starts with the next clean Daily after V41.6 deployment.
-- ============================================================

create or replace function public.brainilab_daily_number_for_date(p_date date)
returns integer
language sql
immutable
set search_path=public
as $$
  select 1 + (p_date-date '2026-08-29')::integer;
$$;

create or replace function public.brainilab_daily_game_ids(p_date date)
returns text[]
language plpgsql
immutable
set search_path=public
as $$
declare
  v_number integer;
  v_index integer;
  v_pair text[];
begin
  if p_date<date '2026-08-31' then
    return array['brainmix','orderup','topicrush','brainiword']::text[];
  end if;

  v_number:=public.brainilab_daily_number_for_date(p_date);
  v_index:=mod(v_number*7+3,10);
  v_pair:=case v_index
    when 0 then array['orderup','topicrush']::text[]
    when 1 then array['connections','oddoneout']::text[]
    when 2 then array['higherlower','orderup']::text[]
    when 3 then array['topicrush','connections']::text[]
    when 4 then array['oddoneout','higherlower']::text[]
    when 5 then array['orderup','connections']::text[]
    when 6 then array['topicrush','higherlower']::text[]
    when 7 then array['orderup','oddoneout']::text[]
    when 8 then array['topicrush','oddoneout']::text[]
    else array['connections','higherlower']::text[]
  end;
  return array['brainmix',v_pair[1],v_pair[2],'brainiword']::text[];
end;
$$;

create or replace function public.get_brainilab_daily_lineup(p_challenge_date date default current_date)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'challenge_date',p_challenge_date,
    'daily_number',public.brainilab_daily_number_for_date(p_challenge_date),
    'games',to_jsonb(public.brainilab_daily_game_ids(p_challenge_date))
  );
$$;
revoke execute on function public.get_brainilab_daily_lineup(date) from public;
grant execute on function public.get_brainilab_daily_lineup(date) to anon,authenticated;

create table if not exists public.daily_rotating_content(
  daily_challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  game_id text not null,
  position integer not null,
  content_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(daily_challenge_id,game_id,position),
  unique(daily_challenge_id,game_id,content_id),
  constraint daily_rotating_game check(game_id in ('connections','oddoneout','higherlower')),
  constraint daily_rotating_position check(position between 1 and 10)
);
create index if not exists daily_rotating_content_lookup_idx
  on public.daily_rotating_content(game_id,content_id);
alter table public.daily_rotating_content enable row level security;
revoke all on table public.daily_rotating_content from anon,authenticated;

create or replace function public.ensure_brainilab_rotating_daily_content(p_daily_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_games text[];
begin
  select challenge_date into v_date from public.daily_challenges where id=p_daily_challenge_id;
  if v_date is null then raise exception 'Daily Challenge not found'; end if;
  if v_date<date '2026-08-31' then return; end if;
  v_games:=public.brainilab_daily_game_ids(v_date);

  if 'connections'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='connections') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'connections',row_number() over(order by usage_count,hash_key)::integer,id
    from (
      select p.id,
        (select count(*) from public.daily_rotating_content d where d.game_id='connections' and d.content_id=p.id) as usage_count,
        md5(p.id::text||':'||v_date::text) as hash_key
      from public.connections_puzzles p where p.is_active=true
      order by usage_count,hash_key limit 3
    ) q;
  end if;

  if 'oddoneout'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='oddoneout') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'oddoneout',row_number() over(order by usage_count,hash_key)::integer,id
    from (
      select p.id,
        (select count(*) from public.daily_rotating_content d where d.game_id='oddoneout' and d.content_id=p.id) as usage_count,
        md5(p.id::text||':'||v_date::text) as hash_key
      from public.odd_one_out_puzzles p where p.is_active=true
      order by usage_count,hash_key limit 10
    ) q;
  end if;

  if 'higherlower'=any(v_games) and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=p_daily_challenge_id and game_id='higherlower') then
    insert into public.daily_rotating_content(daily_challenge_id,game_id,position,content_id)
    select p_daily_challenge_id,'higherlower',row_number() over(order by usage_count,hash_key)::integer,id
    from (
      select p.id,
        (select count(*) from public.daily_rotating_content d where d.game_id='higherlower' and d.content_id=p.id) as usage_count,
        md5(p.id::text||':'||v_date::text) as hash_key
      from public.higher_lower_pairs p where p.is_active=true
      order by usage_count,hash_key limit 10
    ) q;
  end if;
end;
$$;
revoke execute on function public.ensure_brainilab_rotating_daily_content(uuid) from public,anon,authenticated;

create or replace function public.handle_brainilab_daily_games_generation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_games text[];
begin
  v_games:=public.brainilab_daily_game_ids(new.challenge_date);
  perform public.ensure_brainilab_daily_games(new.id);
  if 'topicrush'=any(v_games) then perform public.ensure_brainilab_topic_rush(new.id); end if;
  if 'orderup'=any(v_games) then perform public.ensure_brainilab_order_up(new.id); end if;
  perform public.ensure_brainilab_rotating_daily_content(new.id);
  return new;
end;
$$;

-- Backfill already-generated future rows.
do $$
declare v_daily record; v_games text[];
begin
  for v_daily in select id,challenge_date from public.daily_challenges where challenge_date>=date '2026-08-31' loop
    v_games:=public.brainilab_daily_game_ids(v_daily.challenge_date);
    if 'topicrush'=any(v_games) then perform public.ensure_brainilab_topic_rush(v_daily.id); end if;
    if 'orderup'=any(v_games) then perform public.ensure_brainilab_order_up(v_daily.id); end if;
    perform public.ensure_brainilab_rotating_daily_content(v_daily.id);
  end loop;
end;
$$;

-- Daily loaders for newly rotating structured games.
create or replace function public.get_brainilab_daily_connections(p_challenge_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_daily record; v_puzzles jsonb;
begin
  select id,daily_number,challenge_date into v_daily
  from public.daily_challenges
  where challenge_date=p_challenge_date and status='published'
  order by generation_version desc limit 1;
  if v_daily.id is null or not ('connections'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',p.id,'external_key',p.external_key,'category',p.category,'prompt',p.prompt,'clues',p.clues,
    'choices',(select jsonb_agg(jsonb_build_object('id',cc.id,'text',cc.choice_text) order by md5(cc.id::text||':'||p_challenge_date::text)) from public.connections_choices cc where cc.puzzle_id=p.id)
  ) order by d.position),'[]'::jsonb) into v_puzzles
  from public.daily_rotating_content d
  join public.connections_puzzles p on p.id=d.content_id
  where d.daily_challenge_id=v_daily.id and d.game_id='connections';

  if jsonb_array_length(v_puzzles)<>3 then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'puzzles',v_puzzles);
end;
$$;
revoke execute on function public.get_brainilab_daily_connections(date) from public;
grant execute on function public.get_brainilab_daily_connections(date) to anon,authenticated;

create or replace function public.get_brainilab_daily_odd_one_out(p_challenge_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_daily record; v_puzzles jsonb;
begin
  select id,daily_number,challenge_date into v_daily from public.daily_challenges
  where challenge_date=p_challenge_date and status='published' order by generation_version desc limit 1;
  if v_daily.id is null or not ('oddoneout'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',p.id,'external_key',p.external_key,'category',p.category,'prompt',p.prompt,'items',p.items
  ) order by d.position),'[]'::jsonb) into v_puzzles
  from public.daily_rotating_content d join public.odd_one_out_puzzles p on p.id=d.content_id
  where d.daily_challenge_id=v_daily.id and d.game_id='oddoneout';
  if jsonb_array_length(v_puzzles)<>10 then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'puzzles',v_puzzles);
end;
$$;
revoke execute on function public.get_brainilab_daily_odd_one_out(date) from public;
grant execute on function public.get_brainilab_daily_odd_one_out(date) to anon,authenticated;

create or replace function public.get_brainilab_daily_higher_lower(p_challenge_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_daily record; v_pairs jsonb;
begin
  select id,daily_number,challenge_date into v_daily from public.daily_challenges
  where challenge_date=p_challenge_date and status='published' order by generation_version desc limit 1;
  if v_daily.id is null or not ('higherlower'=any(public.brainilab_daily_game_ids(p_challenge_date))) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'pair_id',p.id,'external_key',p.external_key,'category',p.category,'comparison_type',p.comparison_type,
    'metric',p.metric,'left_label',p.left_label,'left_value',p.left_value,'right_label',p.right_label,'unit',p.unit
  ) order by d.position),'[]'::jsonb) into v_pairs
  from public.daily_rotating_content d join public.higher_lower_pairs p on p.id=d.content_id
  where d.daily_challenge_id=v_daily.id and d.game_id='higherlower';
  if jsonb_array_length(v_pairs)<>10 then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'pairs',v_pairs);
end;
$$;
revoke execute on function public.get_brainilab_daily_higher_lower(date) from public;
grant execute on function public.get_brainilab_daily_higher_lower(date) to anon,authenticated;

-- Add a non-secret content reference for BrainiWord Health; the word itself stays hidden.
create or replace function public.get_brainilab_daily_brainiword()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_daily record;
begin
  select dc.id,dc.daily_number,dc.challenge_date,dbw.word_id
  into v_daily
  from public.daily_challenges dc join public.daily_brainiword dbw on dbw.daily_challenge_id=dc.id
  where dc.challenge_date=current_date and dc.status='published' limit 1;
  if v_daily.id is null then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'letters',5,'attempts',5,'content_ref',v_daily.word_id);
end;
$$;

create or replace function public.get_brainilab_daily_brainiword_archive(p_challenge_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_daily record;
begin
  if p_challenge_date is null or p_challenge_date>=current_date then return null; end if;
  select dc.id,dc.daily_number,dc.challenge_date,dbw.word_id
  into v_daily
  from public.daily_challenges dc join public.daily_brainiword dbw on dbw.daily_challenge_id=dc.id
  where dc.challenge_date=p_challenge_date and dc.status='published'
  order by dc.generation_version desc limit 1;
  if v_daily.id is null then return null; end if;
  return jsonb_build_object('daily_challenge_id',v_daily.id,'daily_number',v_daily.daily_number,'challenge_date',v_daily.challenge_date,'letters',5,'attempts',5,'content_ref',v_daily.word_id);
end;
$$;
revoke execute on function public.get_brainilab_daily_brainiword_archive(date) from public;
grant execute on function public.get_brainilab_daily_brainiword_archive(date) to anon,authenticated;

-- ============================================================
-- DAILY SCORE COLUMNS + POINT NORMALIZATION
-- ============================================================

alter table public.player_daily_stats
  add column if not exists connections_points integer not null default 0,
  add column if not exists oddoneout_points integer not null default 0,
  add column if not exists higherlower_points integer not null default 0;

alter table public.player_daily_stats drop constraint if exists player_daily_points_range;
alter table public.player_daily_stats add constraint player_daily_points_range check(
  brainmix_points between 0 and 2500
  and flagdash_points between 0 and 2500
  and orderup_points between 0 and 2500
  and maphunt_points between 0 and 2500
  and topicrush_points between 0 and 2500
  and brainiword_points between 0 and 2500
  and connections_points between 0 and 2500
  and oddoneout_points between 0 and 2500
  and higherlower_points between 0 and 2500
  and daily_brain_score between 0 and 10000
);

create or replace function public.brainilab_daily_game_points(
  p_game_id text,p_score integer,p_correct integer,p_payload jsonb
)
returns integer
language plpgsql
immutable
set search_path=public
as $$
declare v_points integer:=0; v_attempts integer; v_won boolean:=false; v_best_combo integer:=0;
begin
  if p_game_id='brainmix' then
    v_points:=least(2500,greatest(0,round(coalesce(p_score,0)*0.25)::integer));
  elsif p_game_id='flagdash' then
    begin v_best_combo:=coalesce((p_payload->>'bestCombo')::integer,0); exception when others then v_best_combo:=0; end;
    v_points:=least(2500,greatest(0,coalesce(p_correct,0)*70+v_best_combo*15));
  elsif p_game_id in ('orderup','topicrush') then
    v_points:=least(2500,greatest(0,coalesce(p_score,0)));
  elsif p_game_id='connections' then
    v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/3000.0*2500)::integer));
  elsif p_game_id='oddoneout' then
    v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/1000.0*2500)::integer));
  elsif p_game_id='higherlower' then
    v_points:=least(2500,greatest(0,round(coalesce(p_score,0)/1700.0*2500)::integer));
  elsif p_game_id='maphunt' then
    v_points:=least(2500,greatest(0,round(coalesce(p_score,0)*0.42)::integer));
  elsif p_game_id='brainiword' then
    v_won:=lower(coalesce(p_payload->>'won','false'))='true';
    begin v_attempts:=(p_payload->>'attempts')::integer; exception when others then v_attempts:=null; end;
    if not v_won then v_points:=250;
    else v_points:=case v_attempts when 1 then 2500 when 2 then 2250 when 3 then 2000 when 4 then 1750 when 5 then 1500 else 1000 end;
    end if;
  end if;
  return least(2500,greatest(0,coalesce(v_points,0)));
end;
$$;


-- ============================================================
-- PROGRESSION REBUILD WITH ROTATING DAILY GAME IDS
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
          b.game_id not in ('connections','oddoneout','higherlower')
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
    least(10000,
      brainmix_points+flagdash_points+orderup_points+maphunt_points+topicrush_points+brainiword_points+
      connections_points+oddoneout_points+higherlower_points
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


-- Return the current rotating Daily fields to the web client.
-- The selected game IDs and completed game IDs are explicit so the UI does not
-- have to infer today's lineup from legacy fixed columns.
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
      gs.game_id not in ('connections','oddoneout','higherlower')
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

      'brainmix_played','brainmix'=any(v_completed_daily_games),
      'flagdash_played','flagdash'=any(v_completed_daily_games),
      'orderup_played','orderup'=any(v_completed_daily_games),
      'maphunt_played','maphunt'=any(v_completed_daily_games),
      'topicrush_played','topicrush'=any(v_completed_daily_games),
      'brainiword_played','brainiword'=any(v_completed_daily_games),
      'connections_played','connections'=any(v_completed_daily_games),
      'oddoneout_played','oddoneout'=any(v_completed_daily_games),
      'higherlower_played','higherlower'=any(v_completed_daily_games),

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
-- DAILY MEMBERSHIP VERIFICATION FOR ROTATING STRUCTURED GAMES
-- Anytime remains unrestricted; a Daily session must use that day's assigned rows.
-- ============================================================

create or replace function public.verify_brainilab_connections_result(
  p_client_result_id text,p_rounds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid(); v_result_id uuid; v_session_id uuid; v_daily_number integer; v_daily_id uuid;
  v_round jsonb; v_puzzle uuid; v_choices jsonb; v_choice_text text; v_choice uuid; v_is_correct boolean;
  v_attempts integer; v_score integer:=0; v_seen uuid[]:=array[]::uuid[]; v_round_seen_choices uuid[]; v_i integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>3 then raise exception 'Connections requires exactly 3 rounds'; end if;

  select gs.id,gr.id,gs.daily_number into v_session_id,v_result_id,v_daily_number
  from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='connections' limit 1;
  if v_result_id is null then raise exception 'Connections result not found'; end if;

  if v_daily_number is not null then
    select dc.id into v_daily_id from public.daily_challenges dc
    where dc.daily_number=v_daily_number and dc.challenge_date=current_date and dc.status='published' limit 1;
    if v_daily_id is null or not ('connections'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Connections is not in today''s Daily'; end if;
  end if;

  for v_round in select value from jsonb_array_elements(p_rounds) loop
    v_puzzle:=(v_round->>'puzzle_id')::uuid;
    if v_puzzle=any(v_seen) then raise exception 'Duplicate Connections puzzle'; end if;
    v_seen:=array_append(v_seen,v_puzzle);
    if not exists(select 1 from public.connections_puzzles where id=v_puzzle) then raise exception 'Connections puzzle not found'; end if;
    if v_daily_id is not null and not exists(
      select 1 from public.daily_rotating_content where daily_challenge_id=v_daily_id and game_id='connections' and content_id=v_puzzle
    ) then raise exception 'Connections puzzle is not assigned to today''s Daily'; end if;

    v_choices:=coalesce(v_round->'attempted_choice_ids','[]'::jsonb);
    if jsonb_typeof(v_choices)<>'array' then raise exception 'Invalid Connections attempts'; end if;
    v_round_seen_choices:=array[]::uuid[]; v_attempts:=jsonb_array_length(v_choices);
    if v_attempts<1 or v_attempts>4 or v_attempts<>coalesce((v_round->>'attempts')::integer,0) then raise exception 'Invalid Connections attempt count'; end if;
    for v_i in 0..v_attempts-1 loop
      v_choice_text:=v_choices->>v_i; v_choice:=v_choice_text::uuid;
      if v_choice=any(v_round_seen_choices) then raise exception 'Duplicate Connections choice attempt'; end if;
      v_round_seen_choices:=array_append(v_round_seen_choices,v_choice);
      select cc.is_correct into v_is_correct from public.connections_choices cc where cc.id=v_choice and cc.puzzle_id=v_puzzle;
      if v_is_correct is null then raise exception 'Choice does not belong to Connections puzzle'; end if;
      if v_i<v_attempts-1 and v_is_correct then raise exception 'A solved round cannot continue after the correct answer'; end if;
      if v_i=v_attempts-1 and not v_is_correct then raise exception 'Connections round must end on the correct answer'; end if;
    end loop;
    v_score:=v_score+case v_attempts when 1 then 1000 when 2 then 700 when 3 then 400 else 200 end;
  end loop;

  update public.game_results set score=v_score,correct_answers=3,total_questions=3,accuracy=100,
    answers_verified=true,verified_correct_answers=3,verified_total_questions=3,answers_verified_at=now()
  where id=v_result_id;
  return jsonb_build_object('answers_verified',true,'correct_answers',3,'total_questions',3,'accuracy',100,'score',v_score);
end;
$$;
revoke execute on function public.verify_brainilab_connections_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_connections_result(text,jsonb) to authenticated;

create or replace function public.verify_brainilab_odd_one_out_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_result uuid; v_daily_number integer; v_daily_id uuid;
  v_row jsonb; v_id uuid; v_selected integer; v_odd integer; v_correct integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Odd One Out requires exactly 10 rounds'; end if;
  select gr.id,gs.daily_number into v_result,v_daily_number
  from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='oddoneout' limit 1;
  if v_result is null then raise exception 'Odd One Out result not found'; end if;
  if v_daily_number is not null then
    select dc.id into v_daily_id from public.daily_challenges dc where dc.daily_number=v_daily_number and dc.challenge_date=current_date and dc.status='published' limit 1;
    if v_daily_id is null or not ('oddoneout'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Odd One Out is not in today''s Daily'; end if;
  end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'puzzle_id')::uuid; v_selected:=(v_row->>'selected_index')::integer;
    if v_id=any(v_seen) then raise exception 'Duplicate Odd One Out puzzle'; end if; v_seen:=array_append(v_seen,v_id);
    if v_daily_id is not null and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=v_daily_id and game_id='oddoneout' and content_id=v_id) then raise exception 'Odd One Out puzzle is not assigned to today''s Daily'; end if;
    select odd_index into v_odd from public.odd_one_out_puzzles where id=v_id;
    if v_odd is null or v_selected not between 0 and 3 then raise exception 'Invalid Odd One Out round'; end if;
    if v_selected=v_odd then v_correct:=v_correct+1; end if;
  end loop;
  update public.game_results set score=v_correct*100,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_correct*100);
end;$$;
revoke execute on function public.verify_brainilab_odd_one_out_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_odd_one_out_result(text,jsonb) to authenticated;

create or replace function public.verify_brainilab_higher_lower_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_result uuid; v_daily_number integer; v_daily_id uuid;
  v_row jsonb; v_id uuid; v_choice text; v_left numeric; v_right numeric; v_type text; v_direction text;
  v_correct integer:=0; v_combo integer:=0; v_score integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Higher or Lower requires exactly 10 rounds'; end if;
  select gr.id,gs.daily_number into v_result,v_daily_number
  from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='higherlower' limit 1;
  if v_result is null then raise exception 'Higher or Lower result not found'; end if;
  if v_daily_number is not null then
    select dc.id into v_daily_id from public.daily_challenges dc where dc.daily_number=v_daily_number and dc.challenge_date=current_date and dc.status='published' limit 1;
    if v_daily_id is null or not ('higherlower'=any(public.brainilab_daily_game_ids(current_date))) then raise exception 'Higher or Lower is not in today''s Daily'; end if;
  end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'pair_id')::uuid; v_choice:=lower(btrim(v_row->>'choice'));
    if v_id=any(v_seen) then raise exception 'Duplicate Higher or Lower pair'; end if; v_seen:=array_append(v_seen,v_id);
    if v_choice not in ('first','second') then raise exception 'Invalid Higher or Lower choice'; end if;
    if v_daily_id is not null and not exists(select 1 from public.daily_rotating_content where daily_challenge_id=v_daily_id and game_id='higherlower' and content_id=v_id) then raise exception 'Higher or Lower pair is not assigned to today''s Daily'; end if;
    select left_value,right_value,comparison_type into v_left,v_right,v_type from public.higher_lower_pairs where id=v_id;
    if v_left is null then raise exception 'Higher or Lower pair not found'; end if;
    v_direction:=public.brainilab_higher_lower_direction(v_type,v_left,v_right);
    if v_choice=v_direction then v_correct:=v_correct+1; v_combo:=v_combo+1; v_score:=v_score+100+least(100,greatest(0,v_combo-1)*20); else v_combo:=0; end if;
  end loop;
  update public.game_results set score=v_score,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_score);
end;$$;
revoke execute on function public.verify_brainilab_higher_lower_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_higher_lower_result(text,jsonb) to authenticated;

-- ============================================================
-- GAME HEALTH ANALYTICS
-- Health = 45% completion, 25% success/accuracy, 30% relative usage.
-- ============================================================

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
    ('connections'),('survival'),('oddoneout'),('higherlower')
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

-- Rebuild derived progression using the new Daily lineup and columns.
do $$
declare v_user record;
begin
  for v_user in select user_id from public.player_progression loop
    perform public.refresh_brainilab_player_progression(v_user.user_id);
  end loop;
end;
$$;

commit;

-- Verification examples after execution:
-- select public.brainilab_daily_game_ids(date '2026-08-31');
-- select public.get_brainilab_daily_lineup(date '2026-08-31');
-- select count(*) from public.daily_rotating_content;
