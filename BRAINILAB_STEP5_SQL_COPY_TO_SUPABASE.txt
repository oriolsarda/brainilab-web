-- BrainiLab Backend — Step 5: automated Daily Brain Challenge
-- Run this file after Steps 1–4.
--
-- Daily product contract:
-- - exactly 10 questions
-- - one challenge per UTC calendar date
-- - 4 Easy + 4 Medium + 2 Hard
-- - rotating topic mix
-- - 14-day question cooldown with graceful fallback
-- - generated 14 days ahead
-- - current day published automatically by a daily cron job
--
-- The main migration seeds today + the next 14 days immediately.
-- Cron scheduling is provided separately in BRAINILAB_STEP5_CRON_SQL.txt.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- DAILY GENERATION SETTINGS
-- One row, editable later without redesigning the schema.
-- ============================================================

create table if not exists public.daily_generation_settings (
  singleton boolean primary key default true
    check (singleton = true),

  launch_date date not null,
  launch_daily_number integer not null default 142,

  lookahead_days integer not null default 14,
  cooldown_days integer not null default 14,

  timezone text not null default 'UTC',

  updated_at timestamptz not null default now(),

  constraint daily_settings_number_positive
    check (launch_daily_number > 0),

  constraint daily_settings_lookahead_range
    check (lookahead_days between 1 and 60),

  constraint daily_settings_cooldown_range
    check (cooldown_days between 0 and 365)
);

insert into public.daily_generation_settings(
  singleton,
  launch_date,
  launch_daily_number,
  lookahead_days,
  cooldown_days,
  timezone
)
values(
  true,
  current_date,
  142,
  14,
  14,
  'UTC'
)
on conflict(singleton) do nothing;


-- ============================================================
-- DAILY CHALLENGES
-- ============================================================

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),

  challenge_date date not null unique,
  daily_number integer not null unique,

  status text not null default 'ready',

  generation_version integer not null default 1,
  generated_at timestamptz not null default now(),
  published_at timestamptz null,

  created_at timestamptz not null default now(),

  constraint daily_challenges_number_positive
    check (daily_number > 0),

  constraint daily_challenges_status_check
    check (status in ('ready','published','retired')),

  constraint daily_challenges_generation_version_positive
    check (generation_version > 0)
);

create index if not exists daily_challenges_status_date_idx
  on public.daily_challenges(status,challenge_date);


create table if not exists public.daily_challenge_questions (
  daily_challenge_id uuid not null
    references public.daily_challenges(id) on delete cascade,

  question_version_id uuid not null
    references public.question_versions(id) on delete restrict,

  position integer not null,

  primary key(daily_challenge_id,position),
  unique(daily_challenge_id,question_version_id),

  constraint daily_challenge_position_range
    check (position between 1 and 10)
);

create index if not exists daily_challenge_questions_question_idx
  on public.daily_challenge_questions(question_version_id);


-- Link Step 3 sessions to the concrete Daily Challenge once verified.
alter table public.game_sessions
  add column if not exists daily_challenge_id uuid null
    references public.daily_challenges(id) on delete set null;

create index if not exists game_sessions_daily_challenge_idx
  on public.game_sessions(daily_challenge_id)
  where daily_challenge_id is not null;


-- ============================================================
-- DAILY NUMBER
-- ============================================================

create or replace function public.brainilab_daily_number(p_date date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    s.launch_daily_number + (p_date - s.launch_date)
  from public.daily_generation_settings s
  where s.singleton = true;
$$;

revoke execute on function public.brainilab_daily_number(date)
  from public,anon,authenticated;


-- ============================================================
-- GENERATE ONE DAILY CHALLENGE
-- ============================================================

create or replace function public.generate_brainilab_daily_challenge(
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_challenge_id uuid;
  v_daily_number integer;
  v_cooldown_days integer;
  v_template integer;
  v_slot record;
  v_question_version_id uuid;
  v_count integer;
begin
  if p_date is null then
    raise exception 'Daily challenge date is required';
  end if;

  select dc.id
    into v_existing_id
  from public.daily_challenges dc
  where dc.challenge_date = p_date;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select
    public.brainilab_daily_number(p_date),
    s.cooldown_days
  into
    v_daily_number,
    v_cooldown_days
  from public.daily_generation_settings s
  where s.singleton = true;

  if v_daily_number is null or v_daily_number <= 0 then
    raise exception 'Daily number is invalid for date %',p_date;
  end if;

  -- Three rotating templates. Every template is:
  -- 4 Easy + 4 Medium + 2 Hard.
  v_template := mod(v_daily_number - 1,3) + 1;

  insert into public.daily_challenges(
    challenge_date,
    daily_number,
    status,
    generation_version
  )
  values(
    p_date,
    v_daily_number,
    'ready',
    1
  )
  returning id into v_challenge_id;

  for v_slot in
    select *
    from (
      values
        -- Template 1
        (1,1,'general-knowledge','easy'),
        (1,2,'geography','easy'),
        (1,3,'science','easy'),
        (1,4,'sports','easy'),
        (1,5,'general-knowledge','medium'),
        (1,6,'geography','medium'),
        (1,7,'science','medium'),
        (1,8,'history','medium'),
        (1,9,'general-knowledge','hard'),
        (1,10,'history','hard'),

        -- Template 2
        (2,1,'science','easy'),
        (2,2,'geography','easy'),
        (2,3,'history','easy'),
        (2,4,'general-knowledge','easy'),
        (2,5,'sports','medium'),
        (2,6,'geography','medium'),
        (2,7,'general-knowledge','medium'),
        (2,8,'science','medium'),
        (2,9,'sports','hard'),
        (2,10,'geography','hard'),

        -- Template 3
        (3,1,'history','easy'),
        (3,2,'sports','easy'),
        (3,3,'geography','easy'),
        (3,4,'general-knowledge','easy'),
        (3,5,'science','medium'),
        (3,6,'history','medium'),
        (3,7,'geography','medium'),
        (3,8,'general-knowledge','medium'),
        (3,9,'science','hard'),
        (3,10,'general-knowledge','hard')
    ) as slots(template_no,position,topic_family,difficulty)
    where template_no = v_template
    order by position
  loop

    v_question_version_id := null;

    -- Preferred selection: respect the cooldown window.
    select qv.id
      into v_question_version_id
    from public.question_versions qv
    join public.questions q
      on q.id = qv.question_id
    join public.topics t
      on t.id = qv.primary_topic_id
    left join public.topics parent
      on parent.id = t.parent_id
    where q.status = 'active'
      and qv.status = 'published'
      and qv.difficulty = v_slot.difficulty
      and (
        (
          v_slot.topic_family = 'geography'
          and coalesce(parent.slug,t.slug) = 'geography'
        )
        or
        (
          v_slot.topic_family <> 'geography'
          and t.slug = v_slot.topic_family
        )
      )
      and not exists (
        select 1
        from public.daily_challenge_questions current_q
        where current_q.daily_challenge_id = v_challenge_id
          and current_q.question_version_id = qv.id
      )
      and not exists (
        select 1
        from public.daily_challenge_questions old_q
        join public.daily_challenges old_daily
          on old_daily.id = old_q.daily_challenge_id
        where old_q.question_version_id = qv.id
          and old_daily.challenge_date < p_date
          and old_daily.challenge_date >= p_date - v_cooldown_days
      )
    order by
      md5(
        qv.id::text
        || ':' || p_date::text
        || ':' || v_slot.position::text
      )
    limit 1;

    -- Graceful fallback: if the current question pool is not large enough
    -- for the cooldown, reuse the least-recently-used eligible question.
    if v_question_version_id is null then
      select qv.id
        into v_question_version_id
      from public.question_versions qv
      join public.questions q
        on q.id = qv.question_id
      join public.topics t
        on t.id = qv.primary_topic_id
      left join public.topics parent
        on parent.id = t.parent_id
      where q.status = 'active'
        and qv.status = 'published'
        and qv.difficulty = v_slot.difficulty
        and (
          (
            v_slot.topic_family = 'geography'
            and coalesce(parent.slug,t.slug) = 'geography'
          )
          or
          (
            v_slot.topic_family <> 'geography'
            and t.slug = v_slot.topic_family
          )
        )
        and not exists (
          select 1
          from public.daily_challenge_questions current_q
          where current_q.daily_challenge_id = v_challenge_id
            and current_q.question_version_id = qv.id
        )
      order by
        (
          select max(old_daily.challenge_date)
          from public.daily_challenge_questions old_q
          join public.daily_challenges old_daily
            on old_daily.id = old_q.daily_challenge_id
          where old_q.question_version_id = qv.id
            and old_daily.challenge_date < p_date
        ) asc nulls first,
        md5(qv.id::text || ':' || p_date::text)
      limit 1;
    end if;

    if v_question_version_id is null then
      raise exception
        'Could not generate Daily %: no eligible % / % question for position %',
        p_date,
        v_slot.topic_family,
        v_slot.difficulty,
        v_slot.position;
    end if;

    insert into public.daily_challenge_questions(
      daily_challenge_id,
      question_version_id,
      position
    )
    values(
      v_challenge_id,
      v_question_version_id,
      v_slot.position
    );
  end loop;

  select count(*)
    into v_count
  from public.daily_challenge_questions dcq
  where dcq.daily_challenge_id = v_challenge_id;

  if v_count <> 10 then
    raise exception
      'Daily challenge must contain exactly 10 questions. Generated %',
      v_count;
  end if;

  return v_challenge_id;
exception when others then
  if v_challenge_id is not null then
    delete from public.daily_challenges
    where id = v_challenge_id;
  end if;
  raise;
end;
$$;

revoke execute on function public.generate_brainilab_daily_challenge(date)
  from public,anon,authenticated;


-- ============================================================
-- MAINTAIN TODAY + LOOKAHEAD
-- Called once manually by this migration and then once/day by Cron.
-- ============================================================

create or replace function public.maintain_brainilab_daily_schedule(
  p_base_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lookahead integer;
  v_offset integer;
  v_id uuid;
  v_generated integer := 0;
  v_published integer := 0;
begin
  select lookahead_days
    into v_lookahead
  from public.daily_generation_settings
  where singleton = true;

  for v_offset in 0..v_lookahead loop
    if not exists (
      select 1
      from public.daily_challenges dc
      where dc.challenge_date = p_base_date + v_offset
    ) then
      v_id := public.generate_brainilab_daily_challenge(
        p_base_date + v_offset
      );
      v_generated := v_generated + 1;
    end if;
  end loop;

  update public.daily_challenges
  set
    status = 'published',
    published_at = coalesce(published_at,now())
  where challenge_date <= p_base_date
    and status = 'ready';

  get diagnostics v_published = row_count;

  return jsonb_build_object(
    'base_date',p_base_date,
    'generated',v_generated,
    'published',v_published,
    'lookahead_days',v_lookahead
  );
end;
$$;

revoke execute on function public.maintain_brainilab_daily_schedule(date)
  from public,anon,authenticated;


-- ============================================================
-- PUBLIC RPC: TODAY'S DAILY WITHOUT ANSWERS
-- ============================================================

create or replace function public.get_brainilab_daily_challenge()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily public.daily_challenges%rowtype;
  v_questions jsonb;
begin
  select dc.*
    into v_daily
  from public.daily_challenges dc
  where dc.challenge_date = current_date
    and dc.status = 'published'
  limit 1;

  if v_daily.id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position',dcq.position,
        'question_version_id',qv.id,
        'prompt',qv.prompt,
        'difficulty',qv.difficulty,
        'topic',t.slug,
        'options',(
          select jsonb_agg(
            jsonb_build_object(
              'id',qo.id,
              'text',qo.option_text
            )
            order by qo.position
          )
          from public.question_options qo
          where qo.question_version_id = qv.id
        )
      )
      order by dcq.position
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.daily_challenge_questions dcq
  join public.question_versions qv
    on qv.id = dcq.question_version_id
  join public.questions q
    on q.id = qv.question_id
  join public.topics t
    on t.id = qv.primary_topic_id
  where dcq.daily_challenge_id = v_daily.id
    and q.status = 'active'
    and qv.status = 'published';

  if jsonb_array_length(v_questions) <> 10 then
    raise exception 'Published Daily Challenge is incomplete';
  end if;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'challenge_date',v_daily.challenge_date,
    'daily_number',v_daily.daily_number,
    'generation_version',v_daily.generation_version,
    'total_questions',10,
    'questions',v_questions
  );
end;
$$;

revoke execute on function public.get_brainilab_daily_challenge()
  from public;

grant execute on function public.get_brainilab_daily_challenge()
  to anon,authenticated;


-- ============================================================
-- VERIFY A COMPLETED 10-QUESTION DAILY
-- ============================================================

create or replace function public.verify_brainilab_daily_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_result_id uuid;
  v_daily_number integer;
  v_challenge_count integer;
  v_answer_count integer;
  v_correct integer := 0;
  v_daily_question record;
  v_answer jsonb;
  v_selected_option_id uuid;
  v_is_correct boolean;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb)) <> 'array' then
    raise exception 'Answers must be an array';
  end if;

  select
    gs.id,
    gr.id
  into
    v_session_id,
    v_result_id
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id = gs.id
  where gs.user_id = v_user_id
    and gs.client_result_id = p_client_result_id
  limit 1;

  if v_result_id is null then
    raise exception 'Game result not found';
  end if;

  select dc.daily_number
    into v_daily_number
  from public.daily_challenges dc
  where dc.id = p_daily_challenge_id
    and dc.status in ('published','retired');

  if v_daily_number is null then
    raise exception 'Daily challenge not found';
  end if;

  select count(*)
    into v_challenge_count
  from public.daily_challenge_questions dcq
  where dcq.daily_challenge_id = p_daily_challenge_id;

  if v_challenge_count <> 10 then
    raise exception 'Daily challenge is not valid';
  end if;

  v_answer_count := jsonb_array_length(p_answers);

  if v_answer_count <> 10 then
    raise exception 'Expected 10 submitted answers, got %',v_answer_count;
  end if;

  for v_daily_question in
    select
      dcq.position,
      dcq.question_version_id
    from public.daily_challenge_questions dcq
    where dcq.daily_challenge_id = p_daily_challenge_id
    order by dcq.position
  loop

    select value
      into v_answer
    from jsonb_array_elements(p_answers)
    where value ->> 'question_version_id'
      = v_daily_question.question_version_id::text
    limit 1;

    if v_answer is null then
      raise exception
        'Missing answer for Daily position %',
        v_daily_question.position;
    end if;

    if nullif(v_answer ->> 'selected_option_id','') is null then
      v_selected_option_id := null;
      v_is_correct := false;
    else
      begin
        v_selected_option_id :=
          (v_answer ->> 'selected_option_id')::uuid;
      exception when others then
        raise exception
          'Invalid selected option ID at Daily position %',
          v_daily_question.position;
      end;

      select qo.is_correct
        into v_is_correct
      from public.question_options qo
      where qo.id = v_selected_option_id
        and qo.question_version_id =
          v_daily_question.question_version_id;

      if v_is_correct is null then
        raise exception
          'Option does not belong to Daily question at position %',
          v_daily_question.position;
      end if;
    end if;

    if v_is_correct then
      v_correct := v_correct + 1;
    end if;
  end loop;

  update public.game_sessions
  set
    daily_number = v_daily_number,
    daily_challenge_id = p_daily_challenge_id
  where id = v_session_id;

  update public.game_results
  set
    correct_answers = v_correct,
    total_questions = 10,
    accuracy = round((v_correct::numeric / 10::numeric) * 100,2),
    answers_verified = true,
    verified_correct_answers = v_correct,
    verified_total_questions = 10,
    answers_verified_at = now()
  where id = v_result_id;

  return jsonb_build_object(
    'answers_verified',true,
    'daily_number',v_daily_number,
    'correct_answers',v_correct,
    'total_questions',10,
    'accuracy',round((v_correct::numeric / 10::numeric) * 100,2),
    'server_score_verified',false
  );
end;
$$;

revoke execute on function public.verify_brainilab_daily_result(
  text,uuid,jsonb
) from public,anon;

grant execute on function public.verify_brainilab_daily_result(
  text,uuid,jsonb
) to authenticated;


-- ============================================================
-- RLS
-- No direct browser reads: Daily content is served by RPC.
-- ============================================================

alter table public.daily_generation_settings enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_questions enable row level security;

revoke all on table public.daily_generation_settings
  from anon,authenticated;

revoke all on table public.daily_challenges
  from anon,authenticated;

revoke all on table public.daily_challenge_questions
  from anon,authenticated;


-- ============================================================
-- INITIAL GENERATION
-- Seeds today + 14 future days and publishes today.
-- ============================================================

select public.maintain_brainilab_daily_schedule(current_date);

commit;


-- ============================================================
-- VERIFICATION QUERIES
-- Run separately after migration.
-- ============================================================
--
-- select
--   challenge_date,
--   daily_number,
--   status,
--   generated_at,
--   published_at
-- from public.daily_challenges
-- order by challenge_date;
--
-- Expected immediately:
-- - today = published
-- - next 14 days = ready
--
-- Check every Daily has exactly 10 questions:
--
-- select
--   dc.challenge_date,
--   dc.daily_number,
--   count(dcq.question_version_id) as questions
-- from public.daily_challenges dc
-- join public.daily_challenge_questions dcq
--   on dcq.daily_challenge_id = dc.id
-- group by dc.id,dc.challenge_date,dc.daily_number
-- order by dc.challenge_date;
--
-- Every row should show questions = 10.
