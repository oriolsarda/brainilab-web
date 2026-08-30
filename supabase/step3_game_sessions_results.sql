-- BrainiLab Backend — Step 3: game sessions + results
-- Run this entire file once in Supabase SQL Editor.
--
-- Goals:
-- - persist authenticated BrainiLab game sessions/results
-- - support idempotent retry from the browser
-- - keep browser INSERT access closed
-- - expose one controlled RPC for result submission
-- - prepare guest -> account migration by accepting stable client_result_id values
--
-- IMPORTANT:
-- Scores are persisted but marked server_verified = false at this stage.
-- Once questions/game validation moves server-side, the RPC can calculate and
-- verify competitive scores instead of trusting client-provided metrics.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- GAME SESSIONS
-- ============================================================

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  -- Stable ID generated in the browser. Used for offline retry / guest merge.
  client_result_id text not null,

  game_id text not null,
  source text not null default 'web',

  difficulty text null,
  set_number integer null,
  daily_number integer null,

  status text not null default 'completed',

  started_at timestamptz not null,
  completed_at timestamptz not null,

  created_at timestamptz not null default now(),

  constraint game_sessions_client_result_id_length
    check (char_length(client_result_id) between 8 and 100),

  constraint game_sessions_game_id_length
    check (char_length(game_id) between 2 and 60),

  constraint game_sessions_source_check
    check (source in ('web','mobile_web','import')),

  constraint game_sessions_difficulty_check
    check (difficulty is null or difficulty in ('easy','medium','hard')),

  constraint game_sessions_set_number_check
    check (set_number is null or set_number > 0),

  constraint game_sessions_status_check
    check (status in ('started','completed','abandoned')),

  constraint game_sessions_time_order
    check (completed_at >= started_at),

  unique (user_id, client_result_id)
);

create index if not exists game_sessions_user_completed_idx
  on public.game_sessions (user_id, completed_at desc);

create index if not exists game_sessions_game_completed_idx
  on public.game_sessions (game_id, completed_at desc);

create index if not exists game_sessions_daily_idx
  on public.game_sessions (daily_number)
  where daily_number is not null;


-- ============================================================
-- GAME RESULTS
-- ============================================================

create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null unique
    references public.game_sessions(id) on delete cascade,

  user_id uuid not null
    references auth.users(id) on delete cascade,

  score integer null,

  correct_answers integer null,
  total_questions integer null,
  accuracy numeric(5,2) null,

  duration_ms integer null,

  -- Percentile is currently a client/mock display metric.
  -- Do not use client_percentile for authoritative rankings.
  client_percentile integer null,

  -- Flexible game-specific metrics:
  -- attempts, won, bestCombo, avgDistanceKm, BrainiWord pattern, etc.
  result_payload jsonb not null default '{}'::jsonb,

  -- Becomes true only when future server-side game validation confirms result.
  server_verified boolean not null default false,

  created_at timestamptz not null default now(),

  constraint game_results_score_nonnegative
    check (score is null or score >= 0),

  constraint game_results_correct_nonnegative
    check (correct_answers is null or correct_answers >= 0),

  constraint game_results_total_nonnegative
    check (total_questions is null or total_questions >= 0),

  constraint game_results_correct_lte_total
    check (
      correct_answers is null
      or total_questions is null
      or correct_answers <= total_questions
    ),

  constraint game_results_accuracy_range
    check (accuracy is null or (accuracy >= 0 and accuracy <= 100)),

  constraint game_results_duration_nonnegative
    check (duration_ms is null or duration_ms >= 0),

  constraint game_results_percentile_range
    check (
      client_percentile is null
      or (client_percentile >= 0 and client_percentile <= 100)
    ),

  -- Protect the free-tier DB from accidental giant JSON payloads.
  constraint game_results_payload_size
    check (octet_length(result_payload::text) <= 20000)
);

create index if not exists game_results_user_created_idx
  on public.game_results (user_id, created_at desc);

create index if not exists game_results_score_idx
  on public.game_results (score desc)
  where score is not null;


-- ============================================================
-- OPTIONAL ANSWER-LEVEL ANALYTICS
-- ============================================================
-- At this stage the actual questions still live in the frontend.
-- We therefore store only position + correctness when available.
-- Later question_version_id will replace question_ref.

create table if not exists public.game_answers (
  id bigint generated by default as identity primary key,

  session_id uuid not null
    references public.game_sessions(id) on delete cascade,

  user_id uuid not null
    references auth.users(id) on delete cascade,

  position integer not null,

  question_ref text null,
  selected_option_ref text null,

  is_correct boolean null,
  response_time_ms integer null,

  created_at timestamptz not null default now(),

  constraint game_answers_position_positive
    check (position > 0),

  constraint game_answers_response_time_nonnegative
    check (response_time_ms is null or response_time_ms >= 0),

  unique (session_id, position)
);

create index if not exists game_answers_session_idx
  on public.game_answers (session_id, position);

create index if not exists game_answers_user_created_idx
  on public.game_answers (user_id, created_at desc);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.game_sessions enable row level security;
alter table public.game_results enable row level security;
alter table public.game_answers enable row level security;

drop policy if exists "game_sessions_select_own" on public.game_sessions;
create policy "game_sessions_select_own"
on public.game_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "game_results_select_own" on public.game_results;
create policy "game_results_select_own"
on public.game_results
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "game_answers_select_own" on public.game_answers;
create policy "game_answers_select_own"
on public.game_answers
for select
to authenticated
using ((select auth.uid()) = user_id);

-- No direct browser INSERT/UPDATE/DELETE.
revoke all on table public.game_sessions from anon, authenticated;
revoke all on table public.game_results from anon, authenticated;
revoke all on table public.game_answers from anon, authenticated;

grant select on table public.game_sessions to authenticated;
grant select on table public.game_results to authenticated;
grant select on table public.game_answers to authenticated;


-- ============================================================
-- CONTROLLED RESULT SUBMISSION RPC
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
set search_path = public
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_result_id uuid;
  v_started_at timestamptz;
  v_item jsonb;
  v_position integer := 0;
  v_payload jsonb;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_client_result_id is null
     or char_length(btrim(p_client_result_id)) < 8
     or char_length(p_client_result_id) > 100 then
    raise exception 'Invalid client result ID';
  end if;

  if p_game_id is null
     or char_length(btrim(p_game_id)) < 2
     or char_length(p_game_id) > 60 then
    raise exception 'Invalid game ID';
  end if;

  if p_difficulty is not null
     and p_difficulty not in ('easy','medium','hard') then
    raise exception 'Invalid difficulty';
  end if;

  if p_set_number is not null and p_set_number <= 0 then
    raise exception 'Invalid set number';
  end if;

  if p_accuracy is not null and (p_accuracy < 0 or p_accuracy > 100) then
    raise exception 'Invalid accuracy';
  end if;

  if p_correct_answers is not null and p_correct_answers < 0 then
    raise exception 'Invalid correct answer count';
  end if;

  if p_total_questions is not null and p_total_questions < 0 then
    raise exception 'Invalid total question count';
  end if;

  if p_correct_answers is not null
     and p_total_questions is not null
     and p_correct_answers > p_total_questions then
    raise exception 'Correct answers cannot exceed total questions';
  end if;

  if p_score is not null and p_score < 0 then
    raise exception 'Invalid score';
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'Invalid duration';
  end if;

  if p_client_percentile is not null
     and (p_client_percentile < 0 or p_client_percentile > 100) then
    raise exception 'Invalid percentile';
  end if;

  v_payload := coalesce(p_result_payload,'{}'::jsonb);

  if octet_length(v_payload::text) > 20000 then
    raise exception 'Result payload too large';
  end if;

  -- Idempotency: retrying the same browser result never duplicates it.
  select gs.id, gr.id
  into v_session_id, v_result_id
  from public.game_sessions gs
  left join public.game_results gr on gr.session_id = gs.id
  where gs.user_id = v_user_id
    and gs.client_result_id = p_client_result_id
  limit 1;

  if v_session_id is not null then
    return query
      select v_session_id, v_result_id, true;
    return;
  end if;

  v_started_at :=
    coalesce(p_played_at, now())
    - make_interval(secs => greatest(coalesce(p_duration_ms,0),0) / 1000.0);

  insert into public.game_sessions (
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
  values (
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

  insert into public.game_results (
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
  values (
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

  -- Optional compact answer-level correctness array:
  -- [true,false,true,...]
  if jsonb_typeof(coalesce(p_answer_correctness,'[]'::jsonb)) = 'array' then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_answer_correctness,'[]'::jsonb))
    loop
      v_position := v_position + 1;

      if v_position > 100 then
        exit;
      end if;

      insert into public.game_answers (
        session_id,
        user_id,
        position,
        is_correct
      )
      values (
        v_session_id,
        v_user_id,
        v_position,
        case
          when jsonb_typeof(v_item) = 'boolean'
            then (v_item #>> '{}')::boolean
          else null
        end
      );
    end loop;
  end if;

  return query
    select v_session_id, v_result_id, false;
end;
$$;

-- Only authenticated users may call this RPC.
revoke execute on function public.submit_brainilab_game_result(
  text,text,timestamptz,integer,integer,integer,numeric,integer,integer,
  integer,text,integer,jsonb,jsonb
) from public, anon;

grant execute on function public.submit_brainilab_game_result(
  text,text,timestamptz,integer,integer,integer,numeric,integer,integer,
  integer,text,integer,jsonb,jsonb
) to authenticated;

commit;


-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Run these separately after playing at least one game while signed in:
--
-- select
--   gs.game_id,
--   gs.completed_at,
--   gr.score,
--   gr.correct_answers,
--   gr.total_questions,
--   gr.accuracy,
--   gr.server_verified
-- from public.game_sessions gs
-- join public.game_results gr on gr.session_id = gs.id
-- order by gs.completed_at desc
-- limit 20;
--
-- select count(*) from public.game_answers;
