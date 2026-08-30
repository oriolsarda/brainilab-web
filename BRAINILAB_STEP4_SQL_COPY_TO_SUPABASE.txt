-- BrainiLab Backend — Step 4: question bank + topics + 20-question packs
-- Run this entire migration once in Supabase SQL Editor.
--
-- IMPORTANT SECURITY MODEL
-- ------------------------
-- The browser receives question text + option IDs/text through a controlled RPC.
-- It does NOT receive `is_correct` or explanations in the initial pack payload.
-- Correctness is checked by a separate RPC only after the player answers.
--
-- Direct SELECT access to the content tables is intentionally not granted to
-- anon/authenticated browser roles.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- TOPICS
-- ============================================================

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_id uuid null references public.topics(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint topics_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),

  constraint topics_name_length
    check (char_length(btrim(name)) between 2 and 80)
);

create index if not exists topics_parent_idx
  on public.topics(parent_id);


-- ============================================================
-- QUESTIONS + IMMUTABLE VERSIONS
-- ============================================================

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),

  -- Stable import/admin key, never shown to players.
  external_key text not null unique,

  status text not null default 'active',
  created_at timestamptz not null default now(),

  constraint questions_external_key_length
    check (char_length(external_key) between 4 and 160),

  constraint questions_status_check
    check (status in ('active','retired'))
);

create table if not exists public.question_versions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete restrict,

  external_key text not null unique,
  version integer not null default 1,

  language text not null default 'en',
  format text not null default 'multiple_choice',

  prompt text not null,
  explanation text not null default '',

  difficulty text not null,
  primary_topic_id uuid not null references public.topics(id) on delete restrict,

  source_url text null,
  fact_checked_at timestamptz null,

  status text not null default 'draft',
  created_at timestamptz not null default now(),
  published_at timestamptz null,

  constraint question_versions_version_positive
    check (version > 0),

  constraint question_versions_language_length
    check (char_length(language) between 2 and 12),

  constraint question_versions_format_check
    check (format in ('multiple_choice')),

  constraint question_versions_prompt_length
    check (char_length(btrim(prompt)) between 4 and 1000),

  constraint question_versions_explanation_length
    check (char_length(explanation) <= 3000),

  constraint question_versions_difficulty_check
    check (difficulty in ('easy','medium','hard')),

  constraint question_versions_status_check
    check (status in ('draft','review','published','retired')),

  unique(question_id,version)
);

create index if not exists question_versions_topic_difficulty_idx
  on public.question_versions(primary_topic_id,difficulty,status);

create index if not exists question_versions_question_idx
  on public.question_versions(question_id,version desc);


-- ============================================================
-- OPTIONS
-- ============================================================

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions(id) on delete cascade,

  position integer not null,
  option_text text not null,
  is_correct boolean not null default false,

  created_at timestamptz not null default now(),

  constraint question_options_position_range
    check (position between 1 and 10),

  constraint question_options_text_length
    check (char_length(btrim(option_text)) between 1 and 500),

  unique(question_version_id,position)
);

create unique index if not exists question_options_one_correct_idx
  on public.question_options(question_version_id)
  where is_correct = true;


-- ============================================================
-- TAGS — READY FOR FUTURE CLASSIFICATION
-- ============================================================

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),

  constraint tags_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.question_tags (
  question_version_id uuid not null references public.question_versions(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key(question_version_id,tag_id)
);


-- ============================================================
-- FINITE 20-QUESTION QUIZ PACKS
-- ============================================================

create table if not exists public.quiz_packs (
  id uuid primary key default gen_random_uuid(),

  external_key text not null unique,
  topic_id uuid not null references public.topics(id) on delete restrict,

  title text not null,
  difficulty text not null,
  set_number integer not null,
  version integer not null default 1,

  status text not null default 'draft',
  total_questions integer not null default 20,

  created_at timestamptz not null default now(),
  published_at timestamptz null,

  constraint quiz_packs_title_length
    check (char_length(btrim(title)) between 2 and 120),

  constraint quiz_packs_difficulty_check
    check (difficulty in ('easy','medium','hard')),

  constraint quiz_packs_set_positive
    check (set_number > 0),

  constraint quiz_packs_version_positive
    check (version > 0),

  constraint quiz_packs_status_check
    check (status in ('draft','review','published','retired')),

  constraint quiz_packs_exact_size
    check (total_questions = 20),

  unique(topic_id,difficulty,set_number,version)
);

create table if not exists public.quiz_pack_questions (
  quiz_pack_id uuid not null references public.quiz_packs(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete restrict,
  position integer not null,

  primary key(quiz_pack_id,position),
  unique(quiz_pack_id,question_version_id),

  constraint quiz_pack_questions_position_range
    check (position between 1 and 20)
);

create index if not exists quiz_pack_questions_question_idx
  on public.quiz_pack_questions(question_version_id);


-- ============================================================
-- SERVER VALIDATION FOR PUBLISHING PACKS
-- ============================================================

create or replace function public.validate_brainilab_pack_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if new.status = 'published'
     and (old.status is distinct from 'published') then

    select count(*)
      into v_count
    from public.quiz_pack_questions qpq
    where qpq.quiz_pack_id = new.id;

    if v_count <> 20 then
      raise exception 'A published BrainiLab quiz pack must contain exactly 20 questions. Current count: %', v_count;
    end if;

    new.published_at := coalesce(new.published_at,now());
  end if;

  return new;
end;
$$;

drop trigger if exists quiz_packs_validate_publish on public.quiz_packs;
create trigger quiz_packs_validate_publish
before update of status on public.quiz_packs
for each row
execute function public.validate_brainilab_pack_publish();


-- ============================================================
-- RLS — TABLES ARE NOT DIRECTLY READABLE BY THE BROWSER
-- ============================================================

alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.question_versions enable row level security;
alter table public.question_options enable row level security;
alter table public.tags enable row level security;
alter table public.question_tags enable row level security;
alter table public.quiz_packs enable row level security;
alter table public.quiz_pack_questions enable row level security;

revoke all on table public.topics from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
revoke all on table public.question_versions from anon, authenticated;
revoke all on table public.question_options from anon, authenticated;
revoke all on table public.tags from anon, authenticated;
revoke all on table public.question_tags from anon, authenticated;
revoke all on table public.quiz_packs from anon, authenticated;
revoke all on table public.quiz_pack_questions from anon, authenticated;


-- ============================================================
-- PUBLIC READ RPC: FETCH A PLAYABLE PACK WITHOUT ANSWERS
-- ============================================================

create or replace function public.get_brainilab_quiz_pack(
  p_topic_slug text,
  p_difficulty text,
  p_set_number integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack public.quiz_packs%rowtype;
  v_questions jsonb;
begin
  if p_difficulty not in ('easy','medium','hard') then
    raise exception 'Invalid difficulty';
  end if;

  if p_set_number is null or p_set_number <= 0 then
    raise exception 'Invalid set number';
  end if;

  select qp.*
    into v_pack
  from public.quiz_packs qp
  join public.topics t on t.id = qp.topic_id
  where t.slug = p_topic_slug
    and qp.difficulty = p_difficulty
    and qp.set_number = p_set_number
    and qp.status = 'published'
  order by qp.version desc
  limit 1;

  if v_pack.id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position', qpq.position,
        'question_version_id', qv.id,
        'prompt', qv.prompt,
        'options', (
          select jsonb_agg(
            jsonb_build_object(
              'id', qo.id,
              'text', qo.option_text
            )
            order by qo.position
          )
          from public.question_options qo
          where qo.question_version_id = qv.id
        )
      )
      order by qpq.position
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.quiz_pack_questions qpq
  join public.question_versions qv
    on qv.id = qpq.question_version_id
  join public.questions q
    on q.id = qv.question_id
  where qpq.quiz_pack_id = v_pack.id
    and qv.status = 'published'
    and q.status = 'active';

  return jsonb_build_object(
    'pack_id', v_pack.id,
    'external_key', v_pack.external_key,
    'title', v_pack.title,
    'difficulty', v_pack.difficulty,
    'set_number', v_pack.set_number,
    'version', v_pack.version,
    'total_questions', v_pack.total_questions,
    'questions', v_questions
  );
end;
$$;


-- ============================================================
-- PUBLIC ANSWER CHECK RPC
-- Called only after a player chooses/skips.
-- ============================================================

create or replace function public.check_brainilab_quiz_answer(
  p_question_version_id uuid,
  p_selected_option_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt text;
  v_explanation text;
  v_correct_id uuid;
  v_correct_text text;
  v_selected_text text;
  v_is_correct boolean := false;
begin
  select
    qv.prompt,
    qv.explanation,
    qo.id,
    qo.option_text
  into
    v_prompt,
    v_explanation,
    v_correct_id,
    v_correct_text
  from public.question_versions qv
  join public.questions q on q.id = qv.question_id
  join public.question_options qo
    on qo.question_version_id = qv.id
   and qo.is_correct = true
  where qv.id = p_question_version_id
    and qv.status = 'published'
    and q.status = 'active'
  limit 1;

  if v_correct_id is null then
    raise exception 'Question not available';
  end if;

  if p_selected_option_id is not null then
    select qo.option_text
      into v_selected_text
    from public.question_options qo
    where qo.id = p_selected_option_id
      and qo.question_version_id = p_question_version_id;

    if v_selected_text is null then
      raise exception 'Selected option does not belong to this question';
    end if;

    v_is_correct := p_selected_option_id = v_correct_id;
  end if;

  return jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_option_id', v_correct_id,
    'correct_answer', v_correct_text,
    'selected_answer', v_selected_text,
    'explanation', v_explanation
  );
end;
$$;

revoke execute on function public.get_brainilab_quiz_pack(text,text,integer)
  from public;
grant execute on function public.get_brainilab_quiz_pack(text,text,integer)
  to anon, authenticated;

revoke execute on function public.check_brainilab_quiz_answer(uuid,uuid)
  from public;
grant execute on function public.check_brainilab_quiz_answer(uuid,uuid)
  to anon, authenticated;


-- ============================================================
-- INITIAL TOPICS
-- ============================================================

insert into public.topics(slug,name,parent_id)
values
  ('general-knowledge','General Knowledge',null),
  ('geography','Geography',null),
  ('science','Science',null),
  ('history','History',null),
  ('sports','Sports',null)
on conflict(slug) do update
set name = excluded.name;

insert into public.topics(slug,name,parent_id)
select 'world-capitals','World Capitals',g.id
from public.topics g
where g.slug='geography'
on conflict(slug) do update
set name=excluded.name,
    parent_id=excluded.parent_id;

insert into public.topics(slug,name,parent_id)
select 'world-flags','World Flags',g.id
from public.topics g
where g.slug='geography'
on conflict(slug) do update
set name=excluded.name,
    parent_id=excluded.parent_id;


-- ============================================================
-- INITIAL PACK SHELLS
-- Seed as draft first. They are published only after 20 questions exist.
-- ============================================================
insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'general-knowledge.easy.set1.v1',t.id,'General Knowledge · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='general-knowledge'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'general-knowledge.medium.set1.v1',t.id,'General Knowledge · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='general-knowledge'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'general-knowledge.hard.set1.v1',t.id,'General Knowledge · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='general-knowledge'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'science.easy.set1.v1',t.id,'Science · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='science'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'science.medium.set1.v1',t.id,'Science · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='science'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'science.hard.set1.v1',t.id,'Science · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='science'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'history.easy.set1.v1',t.id,'History · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='history'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'history.medium.set1.v1',t.id,'History · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='history'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'history.hard.set1.v1',t.id,'History · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='history'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'sports.easy.set1.v1',t.id,'Sports · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='sports'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'sports.medium.set1.v1',t.id,'Sports · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='sports'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'sports.hard.set1.v1',t.id,'Sports · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='sports'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-capitals.easy.set1.v1',t.id,'World Capitals · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='world-capitals'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-capitals.medium.set1.v1',t.id,'World Capitals · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='world-capitals'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-capitals.hard.set1.v1',t.id,'World Capitals · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='world-capitals'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-flags.easy.set1.v1',t.id,'World Flags · Easy · Set 1','easy',1,1,'draft',20
from public.topics t
where t.slug='world-flags'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-flags.medium.set1.v1',t.id,'World Flags · Medium · Set 1','medium',1,1,'draft',20
from public.topics t
where t.slug='world-flags'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;

insert into public.quiz_packs(
  external_key,topic_id,title,difficulty,set_number,version,status,total_questions
)
select
  'world-flags.hard.set1.v1',t.id,'World Flags · Hard · Set 1','hard',1,1,'draft',20
from public.topics t
where t.slug='world-flags'
on conflict(external_key) do update
set topic_id=excluded.topic_id,
    title=excluded.title,
    difficulty=excluded.difficulty,
    set_number=excluded.set_number,
    version=excluded.version,
    total_questions=20;


-- ============================================================
-- TEMPORARY ADMIN SEED HELPER
-- ============================================================

create or replace function public._seed_brainilab_question_v18(
  p_external_key text,
  p_topic_slug text,
  p_difficulty text,
  p_prompt text,
  p_explanation text,
  p_options jsonb,
  p_correct_index integer,
  p_pack_external_key text,
  p_position integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic_id uuid;
  v_question_id uuid;
  v_version_id uuid;
  v_pack_id uuid;
  v_option jsonb;
  v_pos integer := 0;
begin
  select id into v_topic_id
  from public.topics
  where slug=p_topic_slug;

  if v_topic_id is null then
    raise exception 'Unknown topic %',p_topic_slug;
  end if;

  select id into v_pack_id
  from public.quiz_packs
  where external_key=p_pack_external_key;

  if v_pack_id is null then
    raise exception 'Unknown pack %',p_pack_external_key;
  end if;

  insert into public.questions(external_key,status)
  values(p_external_key,'active')
  on conflict(external_key) do update
    set status='active'
  returning id into v_question_id;

  insert into public.question_versions(
    question_id,
    external_key,
    version,
    language,
    format,
    prompt,
    explanation,
    difficulty,
    primary_topic_id,
    status,
    published_at
  )
  values(
    v_question_id,
    p_external_key||'.v1',
    1,
    'en',
    'multiple_choice',
    p_prompt,
    coalesce(p_explanation,''),
    p_difficulty,
    v_topic_id,
    'published',
    now()
  )
  on conflict(external_key) do update
  set
    prompt=excluded.prompt,
    explanation=excluded.explanation,
    difficulty=excluded.difficulty,
    primary_topic_id=excluded.primary_topic_id,
    status='published',
    published_at=coalesce(public.question_versions.published_at,now())
  returning id into v_version_id;

  -- Seed is idempotent and authoritative for these initial options.
  delete from public.question_options
  where question_version_id=v_version_id;

  for v_option in
    select value
    from jsonb_array_elements(p_options)
  loop
    v_pos := v_pos + 1;

    insert into public.question_options(
      question_version_id,
      position,
      option_text,
      is_correct
    )
    values(
      v_version_id,
      v_pos,
      v_option #>> '{}',
      (v_pos-1)=p_correct_index
    );
  end loop;

  if v_pos <> 4 then
    raise exception 'Initial BrainiLab multiple-choice questions require 4 options. Got %',v_pos;
  end if;

  insert into public.quiz_pack_questions(
    quiz_pack_id,
    question_version_id,
    position
  )
  values(
    v_pack_id,
    v_version_id,
    p_position
  )
  on conflict(quiz_pack_id,position) do update
  set question_version_id=excluded.question_version_id;
end;
$$;

revoke execute on function public._seed_brainilab_question_v18(
  text,text,text,text,text,jsonb,integer,text,integer
) from public, anon, authenticated;


-- ============================================================
-- IMPORT THE 360 EXISTING BRAiNILAB QUESTIONS
-- ============================================================
select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q01',
  'general-knowledge',
  'easy',
  'How many continents are commonly recognized?',
  'The common model recognizes seven continents.',
  '["7","5","6","8"]'::jsonb,
  0,
  'general-knowledge.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q02',
  'general-knowledge',
  'easy',
  'Which ocean is the largest on Earth?',
  'The Pacific Ocean is the largest.',
  '["Atlantic Ocean","Indian Ocean","Arctic Ocean","Pacific Ocean"]'::jsonb,
  3,
  'general-knowledge.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q03',
  'general-knowledge',
  'easy',
  'What is the capital of France?',
  'Paris is the capital of France.',
  '["Rome","Madrid","Paris","Lyon"]'::jsonb,
  2,
  'general-knowledge.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q04',
  'general-knowledge',
  'easy',
  'Which planet is known as the Red Planet?',
  'Iron minerals give Mars its reddish appearance.',
  '["Jupiter","Mars","Venus","Mercury"]'::jsonb,
  1,
  'general-knowledge.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q05',
  'general-knowledge',
  'easy',
  'How many sides does a hexagon have?',
  'A hexagon has six sides.',
  '["6","5","7","8"]'::jsonb,
  0,
  'general-knowledge.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q06',
  'general-knowledge',
  'easy',
  'Which animal is the largest mammal?',
  'The blue whale is the largest known animal.',
  '["African elephant","Giraffe","Orca","Blue whale"]'::jsonb,
  3,
  'general-knowledge.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q07',
  'general-knowledge',
  'easy',
  'What is the freezing point of water in Celsius at standard pressure?',
  'Water freezes at 0°C under standard conditions.',
  '["32°C","100°C","0°C","10°C"]'::jsonb,
  2,
  'general-knowledge.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q08',
  'general-knowledge',
  'easy',
  'Which language is primarily spoken in Brazil?',
  'Portuguese is Brazil''s official language.',
  '["Italian","Portuguese","Spanish","French"]'::jsonb,
  1,
  'general-knowledge.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q09',
  'general-knowledge',
  'easy',
  'Which instrument has black and white keys?',
  'A piano keyboard has black and white keys.',
  '["Piano","Violin","Trumpet","Flute"]'::jsonb,
  0,
  'general-knowledge.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q10',
  'general-knowledge',
  'easy',
  'Which shape has three sides?',
  'A triangle has three sides.',
  '["Square","Pentagon","Circle","Triangle"]'::jsonb,
  3,
  'general-knowledge.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q11',
  'general-knowledge',
  'easy',
  'Which country is famous for the pyramids of Giza?',
  'The pyramids of Giza are in Egypt.',
  '["Greece","Mexico","Egypt","Jordan"]'::jsonb,
  2,
  'general-knowledge.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q12',
  'general-knowledge',
  'easy',
  'Which month comes after September?',
  'October follows September.',
  '["December","October","August","November"]'::jsonb,
  1,
  'general-knowledge.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q13',
  'general-knowledge',
  'easy',
  'What do bees make from flower nectar?',
  'Bees transform nectar into honey.',
  '["Honey","Milk","Silk","Wax paper"]'::jsonb,
  0,
  'general-knowledge.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q14',
  'general-knowledge',
  'easy',
  'Which gas do humans need to breathe?',
  'Humans need oxygen for cellular respiration.',
  '["Helium","Carbon dioxide","Neon","Oxygen"]'::jsonb,
  3,
  'general-knowledge.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q15',
  'general-knowledge',
  'easy',
  'What is 12 × 12?',
  '12 multiplied by 12 is 144.',
  '["132","154","144","124"]'::jsonb,
  2,
  'general-knowledge.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q16',
  'general-knowledge',
  'easy',
  'Which continent is Japan part of?',
  'Japan is in East Asia.',
  '["Oceania","Asia","Europe","Africa"]'::jsonb,
  1,
  'general-knowledge.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q17',
  'general-knowledge',
  'easy',
  'How many days are in a leap year?',
  'Leap years have 366 days.',
  '["366","364","365","367"]'::jsonb,
  0,
  'general-knowledge.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q18',
  'general-knowledge',
  'easy',
  'Which metal is liquid near room temperature?',
  'Mercury is liquid at ordinary room temperatures.',
  '["Iron","Copper","Aluminium","Mercury"]'::jsonb,
  3,
  'general-knowledge.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q19',
  'general-knowledge',
  'easy',
  'Which sport uses a racket and a shuttlecock?',
  'Badminton is played with rackets and a shuttlecock.',
  '["Baseball","Golf","Badminton","Cricket"]'::jsonb,
  2,
  'general-knowledge.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'general-knowledge.easy.set1.q20',
  'general-knowledge',
  'easy',
  'What is the opposite direction of north?',
  'South is opposite north.',
  '["Up","South","East","West"]'::jsonb,
  1,
  'general-knowledge.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q01',
  'general-knowledge',
  'medium',
  'What is the chemical symbol for gold?',
  'Au comes from the Latin word aurum.',
  '["Au","Ag","Gd","Go"]'::jsonb,
  0,
  'general-knowledge.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q02',
  'general-knowledge',
  'medium',
  'Which city is the capital of Canada?',
  'Ottawa is Canada''s capital.',
  '["Toronto","Vancouver","Montreal","Ottawa"]'::jsonb,
  3,
  'general-knowledge.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q03',
  'general-knowledge',
  'medium',
  'Which novel begins with the character Ishmael as narrator?',
  'Ishmael narrates Herman Melville''s Moby-Dick.',
  '["Frankenstein","The Great Gatsby","Moby-Dick","Dracula"]'::jsonb,
  2,
  'general-knowledge.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q04',
  'general-knowledge',
  'medium',
  'Which country uses the yen as its currency?',
  'Japan''s currency is the yen.',
  '["Thailand","Japan","China","South Korea"]'::jsonb,
  1,
  'general-knowledge.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q05',
  'general-knowledge',
  'medium',
  'What is the largest internal organ in the human body?',
  'The liver is the largest internal organ.',
  '["Liver","Heart","Lung","Kidney"]'::jsonb,
  0,
  'general-knowledge.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q06',
  'general-knowledge',
  'medium',
  'Which mountain range separates much of Europe from Asia in Russia?',
  'The Urals are a conventional boundary between Europe and Asia.',
  '["Alps","Andes","Pyrenees","Ural Mountains"]'::jsonb,
  3,
  'general-knowledge.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q07',
  'general-knowledge',
  'medium',
  'Who painted The Starry Night?',
  'Vincent van Gogh painted The Starry Night in 1889.',
  '["Pablo Picasso","Salvador Dalí","Vincent van Gogh","Claude Monet"]'::jsonb,
  2,
  'general-knowledge.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q08',
  'general-knowledge',
  'medium',
  'Which element has atomic number 6?',
  'Carbon has atomic number 6.',
  '["Helium","Carbon","Oxygen","Nitrogen"]'::jsonb,
  1,
  'general-knowledge.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q09',
  'general-knowledge',
  'medium',
  'Which country contains the ancient city of Petra?',
  'Petra is in modern-day Jordan.',
  '["Jordan","Lebanon","Egypt","Turkey"]'::jsonb,
  0,
  'general-knowledge.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q10',
  'general-knowledge',
  'medium',
  'What is the name of the line at 0° latitude?',
  'The Equator is at 0° latitude.',
  '["Prime Meridian","Tropic of Cancer","International Date Line","Equator"]'::jsonb,
  3,
  'general-knowledge.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q11',
  'general-knowledge',
  'medium',
  'Which composer wrote The Four Seasons?',
  'Vivaldi composed The Four Seasons.',
  '["Bach","Beethoven","Antonio Vivaldi","Mozart"]'::jsonb,
  2,
  'general-knowledge.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q12',
  'general-knowledge',
  'medium',
  'What is the square root of 169?',
  '13 × 13 = 169.',
  '["14","13","11","12"]'::jsonb,
  1,
  'general-knowledge.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q13',
  'general-knowledge',
  'medium',
  'Which sea lies between Europe and Africa?',
  'The Mediterranean separates southern Europe from North Africa.',
  '["Mediterranean Sea","Baltic Sea","Black Sea","Arabian Sea"]'::jsonb,
  0,
  'general-knowledge.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q14',
  'general-knowledge',
  'medium',
  'What is the capital of New Zealand?',
  'Wellington is New Zealand''s capital.',
  '["Auckland","Christchurch","Hamilton","Wellington"]'::jsonb,
  3,
  'general-knowledge.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q15',
  'general-knowledge',
  'medium',
  'Which writing system is used for modern Korean?',
  'Hangul is the Korean alphabet.',
  '["Cyrillic","Devanagari","Hangul","Kanji"]'::jsonb,
  2,
  'general-knowledge.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q16',
  'general-knowledge',
  'medium',
  'Which organelle is often called the powerhouse of the cell?',
  'Mitochondria produce much of a cell''s ATP.',
  '["Golgi apparatus","Mitochondrion","Nucleus","Ribosome"]'::jsonb,
  1,
  'general-knowledge.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q17',
  'general-knowledge',
  'medium',
  'Which chess piece moves in an L-shape?',
  'The knight moves in an L-shaped pattern.',
  '["Knight","Bishop","Rook","Queen"]'::jsonb,
  0,
  'general-knowledge.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q18',
  'general-knowledge',
  'medium',
  'Which desert covers much of northern Africa?',
  'The Sahara spans much of North Africa.',
  '["Gobi","Kalahari","Atacama","Sahara"]'::jsonb,
  3,
  'general-knowledge.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q19',
  'general-knowledge',
  'medium',
  'Which country has Lisbon as its capital?',
  'Lisbon is the capital of Portugal.',
  '["Brazil","Angola","Portugal","Spain"]'::jsonb,
  2,
  'general-knowledge.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'general-knowledge.medium.set1.q20',
  'general-knowledge',
  'medium',
  'What is the Roman numeral for 50?',
  'L represents 50 in Roman numerals.',
  '["X","L","C","V"]'::jsonb,
  1,
  'general-knowledge.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q01',
  'general-knowledge',
  'hard',
  'Which SI base unit measures luminous intensity?',
  'The candela is the SI base unit of luminous intensity.',
  '["Candela","Lumen","Lux","Watt"]'::jsonb,
  0,
  'general-knowledge.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q02',
  'general-knowledge',
  'hard',
  'What is the largest desert on Earth by area?',
  'A desert is defined by low precipitation; Antarctica is the largest.',
  '["Sahara","Arabian Desert","Gobi","Antarctica"]'::jsonb,
  3,
  'general-knowledge.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q03',
  'general-knowledge',
  'hard',
  'Which strait separates Asia from North America?',
  'The Bering Strait lies between Russia and Alaska.',
  '["Strait of Gibraltar","Malacca Strait","Bering Strait","Bosporus"]'::jsonb,
  2,
  'general-knowledge.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q04',
  'general-knowledge',
  'hard',
  'Which language family includes Finnish, Estonian and Hungarian?',
  'These languages belong to the Uralic family.',
  '["Semitic","Uralic","Romance","Slavic"]'::jsonb,
  1,
  'general-knowledge.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q05',
  'general-knowledge',
  'hard',
  'What is the capital of Bhutan?',
  'Thimphu is Bhutan''s capital.',
  '["Thimphu","Kathmandu","Paro","Dhaka"]'::jsonb,
  0,
  'general-knowledge.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q06',
  'general-knowledge',
  'hard',
  'Which painter created Las Meninas?',
  'Velázquez painted Las Meninas.',
  '["El Greco","Goya","Murillo","Diego Velázquez"]'::jsonb,
  3,
  'general-knowledge.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q07',
  'general-knowledge',
  'hard',
  'Which number is represented by the Roman numeral CM?',
  'CM means 1000 minus 100, which is 900.',
  '["600","1100","900","400"]'::jsonb,
  2,
  'general-knowledge.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q08',
  'general-knowledge',
  'hard',
  'Which element''s chemical symbol is W?',
  'W comes from tungsten''s older name, wolfram.',
  '["Tantalum","Tungsten","Tin","Titanium"]'::jsonb,
  1,
  'general-knowledge.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q09',
  'general-knowledge',
  'hard',
  'Which country has the most natural lakes by many standard counts?',
  'Canada contains an exceptionally large share of the world''s lakes.',
  '["Canada","Finland","Russia","United States"]'::jsonb,
  0,
  'general-knowledge.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q10',
  'general-knowledge',
  'hard',
  'Which ancient wonder stood at the harbor of Rhodes?',
  'The Colossus was a monumental statue on Rhodes.',
  '["Lighthouse of Alexandria","Temple of Artemis","Hanging Gardens","Colossus of Rhodes"]'::jsonb,
  3,
  'general-knowledge.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q11',
  'general-knowledge',
  'hard',
  'What is the study of flags called?',
  'Vexillology is the study of flags.',
  '["Numismatics","Cartography","Vexillology","Heraldry"]'::jsonb,
  2,
  'general-knowledge.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q12',
  'general-knowledge',
  'hard',
  'Which moon is the largest in the Solar System?',
  'Ganymede, a moon of Jupiter, is the largest.',
  '["Europa","Ganymede","Titan","Callisto"]'::jsonb,
  1,
  'general-knowledge.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q13',
  'general-knowledge',
  'hard',
  'Which country has the city of Samarkand?',
  'Samarkand is in Uzbekistan.',
  '["Uzbekistan","Kazakhstan","Tajikistan","Azerbaijan"]'::jsonb,
  0,
  'general-knowledge.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q14',
  'general-knowledge',
  'hard',
  'What is the smallest prime number greater than 100?',
  '101 is prime and immediately follows 100.',
  '["103","107","109","101"]'::jsonb,
  3,
  'general-knowledge.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q15',
  'general-knowledge',
  'hard',
  'Which ocean trench contains Challenger Deep?',
  'Challenger Deep lies within the Mariana Trench.',
  '["Java Trench","Puerto Rico Trench","Mariana Trench","Tonga Trench"]'::jsonb,
  2,
  'general-knowledge.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q16',
  'general-knowledge',
  'hard',
  'Which philosopher wrote The Republic?',
  'Plato wrote The Republic.',
  '["Epicurus","Plato","Aristotle","Socrates"]'::jsonb,
  1,
  'general-knowledge.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q17',
  'general-knowledge',
  'hard',
  'What is the capital of Namibia?',
  'Windhoek is Namibia''s capital.',
  '["Windhoek","Gaborone","Lusaka","Harare"]'::jsonb,
  0,
  'general-knowledge.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q18',
  'general-knowledge',
  'hard',
  'Which gas is most abundant in Earth''s atmosphere?',
  'Nitrogen makes up about 78% of the atmosphere.',
  '["Oxygen","Argon","Carbon dioxide","Nitrogen"]'::jsonb,
  3,
  'general-knowledge.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q19',
  'general-knowledge',
  'hard',
  'Which musical interval spans eight diatonic scale degrees?',
  'An octave spans eight scale degrees.',
  '["Third","Seventh","Octave","Fifth"]'::jsonb,
  2,
  'general-knowledge.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'general-knowledge.hard.set1.q20',
  'general-knowledge',
  'hard',
  'Which branch of mathematics studies properties preserved under continuous deformation?',
  'Topology studies properties preserved under continuous deformation.',
  '["Combinatorics","Topology","Trigonometry","Arithmetic"]'::jsonb,
  1,
  'general-knowledge.hard.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q01',
  'science',
  'easy',
  'What is the closest star to Earth?',
  'The Sun is Earth''s closest star.',
  '["The Sun","Sirius","Proxima Centauri","Betelgeuse"]'::jsonb,
  0,
  'science.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q02',
  'science',
  'easy',
  'What organ pumps blood around the human body?',
  'The heart pumps blood through the circulatory system.',
  '["Liver","Lungs","Kidney","Heart"]'::jsonb,
  3,
  'science.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q03',
  'science',
  'easy',
  'What is H₂O commonly called?',
  'H₂O is the chemical formula for water.',
  '["Oxygen","Hydrogen","Water","Salt"]'::jsonb,
  2,
  'science.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q04',
  'science',
  'easy',
  'Which force keeps planets in orbit?',
  'Gravity keeps planets in orbit around stars.',
  '["Electricity","Gravity","Magnetism","Friction"]'::jsonb,
  1,
  'science.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q05',
  'science',
  'easy',
  'Which part of a plant performs most photosynthesis?',
  'Leaves contain many chloroplasts.',
  '["Leaves","Roots","Flowers","Seeds"]'::jsonb,
  0,
  'science.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q06',
  'science',
  'easy',
  'How many planets are in the Solar System?',
  'Eight planets orbit the Sun.',
  '["7","9","10","8"]'::jsonb,
  3,
  'science.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q07',
  'science',
  'easy',
  'What gas do plants absorb for photosynthesis?',
  'Plants use carbon dioxide during photosynthesis.',
  '["Hydrogen","Helium","Carbon dioxide","Oxygen"]'::jsonb,
  2,
  'science.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q08',
  'science',
  'easy',
  'What is the boiling point of water in Celsius at standard pressure?',
  'Water boils at 100°C at standard atmospheric pressure.',
  '["212°C below zero","100°C","0°C","50°C"]'::jsonb,
  1,
  'science.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q09',
  'science',
  'easy',
  'Which planet is largest?',
  'Jupiter is the largest planet.',
  '["Jupiter","Earth","Saturn","Mars"]'::jsonb,
  0,
  'science.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q10',
  'science',
  'easy',
  'What is the basic unit of life?',
  'Cells are the basic structural units of living organisms.',
  '["Atom","Tissue","Organ","Cell"]'::jsonb,
  3,
  'science.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q11',
  'science',
  'easy',
  'Which organ is mainly responsible for breathing?',
  'The lungs exchange oxygen and carbon dioxide.',
  '["Pancreas","Bladder","Lungs","Stomach"]'::jsonb,
  2,
  'science.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q12',
  'science',
  'easy',
  'Which substance do magnets strongly attract?',
  'Iron is ferromagnetic.',
  '["Plastic","Iron","Wood","Glass"]'::jsonb,
  1,
  'science.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q13',
  'science',
  'easy',
  'What do we call animals that eat only plants?',
  'Herbivores feed on plants.',
  '["Herbivores","Carnivores","Omnivores","Decomposers"]'::jsonb,
  0,
  'science.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q14',
  'science',
  'easy',
  'Which state of matter has a fixed volume but takes the shape of its container?',
  'Liquids have fixed volume but no fixed shape.',
  '["Solid","Gas","Plasma","Liquid"]'::jsonb,
  3,
  'science.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q15',
  'science',
  'easy',
  'What is Earth''s natural satellite?',
  'The Moon is Earth''s natural satellite.',
  '["Europa","Titan","The Moon","Mars"]'::jsonb,
  2,
  'science.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q16',
  'science',
  'easy',
  'Which blood cells carry oxygen?',
  'Red blood cells contain hemoglobin.',
  '["Neurons","Red blood cells","White blood cells","Platelets"]'::jsonb,
  1,
  'science.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q17',
  'science',
  'easy',
  'What is the center of an atom called?',
  'Protons and neutrons are located in the nucleus.',
  '["Nucleus","Shell","Membrane","Core electron"]'::jsonb,
  0,
  'science.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q18',
  'science',
  'easy',
  'Which vitamin can the skin produce with sunlight exposure?',
  'UVB exposure helps the skin synthesize vitamin D.',
  '["Vitamin C","Vitamin B12","Vitamin K only","Vitamin D"]'::jsonb,
  3,
  'science.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q19',
  'science',
  'easy',
  'What type of energy is stored in food?',
  'Food stores energy in chemical bonds.',
  '["Nuclear energy","Magnetic energy","Chemical energy","Sound energy"]'::jsonb,
  2,
  'science.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'science.easy.set1.q20',
  'science',
  'easy',
  'Which planet is famous for its prominent ring system?',
  'Saturn has the Solar System''s most visible ring system.',
  '["Earth","Saturn","Venus","Mercury"]'::jsonb,
  1,
  'science.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q01',
  'science',
  'medium',
  'Which organelle contains most of a eukaryotic cell''s genetic material?',
  'Most DNA in eukaryotic cells is housed in the nucleus.',
  '["Nucleus","Golgi apparatus","Lysosome","Cytoskeleton"]'::jsonb,
  0,
  'science.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q02',
  'science',
  'medium',
  'What is the pH of a neutral aqueous solution at about 25°C?',
  'A neutral solution has pH 7 at about 25°C.',
  '["0","5","14","7"]'::jsonb,
  3,
  'science.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q03',
  'science',
  'medium',
  'Which particle has a negative electric charge?',
  'Electrons carry negative charge.',
  '["Neutron","Photon","Electron","Proton"]'::jsonb,
  2,
  'science.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q04',
  'science',
  'medium',
  'Which process converts glucose into usable cellular energy with oxygen?',
  'Aerobic cellular respiration extracts energy from glucose.',
  '["Transpiration","Cellular respiration","Photosynthesis","Osmosis"]'::jsonb,
  1,
  'science.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q05',
  'science',
  'medium',
  'What is the chemical symbol for sodium?',
  'Na comes from the Latin natrium.',
  '["Na","S","So","Sd"]'::jsonb,
  0,
  'science.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q06',
  'science',
  'medium',
  'Which layer of Earth is liquid and surrounds the inner core?',
  'Earth''s outer core is liquid iron-rich material.',
  '["Mantle","Crust","Lithosphere","Outer core"]'::jsonb,
  3,
  'science.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q07',
  'science',
  'medium',
  'Which law states that pressure and volume of a gas are inversely related at constant temperature?',
  'Boyle''s law describes the inverse pressure-volume relationship.',
  '["Hooke''s law","Kepler''s law","Boyle''s law","Ohm''s law"]'::jsonb,
  2,
  'science.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q08',
  'science',
  'medium',
  'Which molecule carries genetic instructions in most organisms?',
  'DNA stores hereditary information.',
  '["Cholesterol","DNA","ATP","Glucose"]'::jsonb,
  1,
  'science.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q09',
  'science',
  'medium',
  'What is the acceleration due to gravity near Earth''s surface approximately?',
  'Near Earth''s surface, g is about 9.8 m/s².',
  '["9.8 m/s²","1.6 m/s²","3.7 m/s²","24.8 m/s²"]'::jsonb,
  0,
  'science.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q10',
  'science',
  'medium',
  'Which type of bond involves sharing electron pairs?',
  'Covalent bonds involve shared electron pairs.',
  '["Ionic bond","Metallic bond only","Hydrogen nucleus bond","Covalent bond"]'::jsonb,
  3,
  'science.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q11',
  'science',
  'medium',
  'Which part of the electromagnetic spectrum has a longer wavelength than visible red light?',
  'Infrared wavelengths are longer than visible light.',
  '["X-rays","Gamma rays","Infrared","Ultraviolet"]'::jsonb,
  2,
  'science.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q12',
  'science',
  'medium',
  'What is the largest organ of the human body?',
  'The skin is the body''s largest organ.',
  '["Brain","Skin","Liver","Lung"]'::jsonb,
  1,
  'science.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q13',
  'science',
  'medium',
  'Which blood type is often called the universal red-cell donor?',
  'O-negative red cells lack A, B and Rh D antigens.',
  '["O negative","AB positive","A positive","B negative"]'::jsonb,
  0,
  'science.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q14',
  'science',
  'medium',
  'What is the name of the process by which liquid water becomes vapor?',
  'Evaporation converts liquid into gas at the surface.',
  '["Condensation","Freezing","Sublimation","Evaporation"]'::jsonb,
  3,
  'science.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q15',
  'science',
  'medium',
  'Which planet has the shortest year?',
  'Mercury completes an orbit in about 88 Earth days.',
  '["Earth","Mars","Mercury","Venus"]'::jsonb,
  2,
  'science.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q16',
  'science',
  'medium',
  'Which scientist formulated the three laws of motion?',
  'Newton formulated the classical laws of motion.',
  '["Niels Bohr","Isaac Newton","Michael Faraday","Gregor Mendel"]'::jsonb,
  1,
  'science.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q17',
  'science',
  'medium',
  'What is the atomic number of oxygen?',
  'Oxygen has eight protons.',
  '["8","6","7","16"]'::jsonb,
  0,
  'science.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q18',
  'science',
  'medium',
  'Which structure connects muscles to bones?',
  'Tendons attach muscle to bone.',
  '["Ligament","Cartilage","Nerve","Tendon"]'::jsonb,
  3,
  'science.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q19',
  'science',
  'medium',
  'What is the term for a species'' role in an ecosystem?',
  'A niche describes a species'' ecological role and relationships.',
  '["Genotype","Trophic atom","Ecological niche","Biome"]'::jsonb,
  2,
  'science.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'science.medium.set1.q20',
  'science',
  'medium',
  'Which gas law relates volume directly to absolute temperature at constant pressure?',
  'Charles''s law states V is proportional to absolute temperature at constant pressure.',
  '["Snell''s law","Charles''s law","Boyle''s law","Coulomb''s law"]'::jsonb,
  1,
  'science.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q01',
  'science',
  'hard',
  'Which quantum number determines an orbital''s shape?',
  'The azimuthal quantum number l determines orbital shape.',
  '["Azimuthal quantum number","Principal quantum number","Magnetic spin only","Mass quantum number"]'::jsonb,
  0,
  'science.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q02',
  'science',
  'hard',
  'Which enzyme unwinds the DNA double helix during replication?',
  'Helicase separates the DNA strands.',
  '["Ligase","Amylase","Pepsin","Helicase"]'::jsonb,
  3,
  'science.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q03',
  'science',
  'hard',
  'What is the SI unit of electric capacitance?',
  'Capacitance is measured in farads.',
  '["Weber","Henry","Farad","Tesla"]'::jsonb,
  2,
  'science.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q04',
  'science',
  'hard',
  'Which organelle modifies and packages many proteins for secretion?',
  'The Golgi apparatus modifies, sorts and packages proteins.',
  '["Nucleolus","Golgi apparatus","Centrosome","Peroxisome"]'::jsonb,
  1,
  'science.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q05',
  'science',
  'hard',
  'What is Avogadro''s constant approximately?',
  'Avogadro''s constant is about 6.022 × 10²³ per mole.',
  '["6.022 × 10²³ mol⁻¹","9.81 × 10²","3.00 × 10⁸","1.602 × 10⁻¹⁹"]'::jsonb,
  0,
  'science.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q06',
  'science',
  'hard',
  'Which fundamental force binds quarks together?',
  'The strong interaction binds quarks inside hadrons.',
  '["Weak interaction","Gravity","Electromagnetism","Strong interaction"]'::jsonb,
  3,
  'science.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q07',
  'science',
  'hard',
  'What type of RNA carries amino acids to the ribosome?',
  'Transfer RNA carries amino acids during translation.',
  '["rRNA only","miRNA","tRNA","mRNA"]'::jsonb,
  2,
  'science.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q08',
  'science',
  'hard',
  'Which law says entropy of an isolated system tends not to decrease?',
  'The second law describes the statistical tendency of entropy to increase.',
  '["Newton''s second law","Second law of thermodynamics","First law of thermodynamics","Zeroth law"]'::jsonb,
  1,
  'science.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q09',
  'science',
  'hard',
  'Which atmospheric layer contains most of the ozone layer?',
  'Most atmospheric ozone is in the stratosphere.',
  '["Stratosphere","Troposphere","Mesosphere","Thermosphere"]'::jsonb,
  0,
  'science.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q10',
  'science',
  'hard',
  'What is the term for programmed cell death?',
  'Apoptosis is regulated programmed cell death.',
  '["Mitosis","Necrosis only","Diffusion","Apoptosis"]'::jsonb,
  3,
  'science.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q11',
  'science',
  'hard',
  'Which equation relates energy and mass in special relativity?',
  'Einstein''s mass-energy equivalence is E = mc².',
  '["PV = nRT","V = IR","E = mc²","F = ma"]'::jsonb,
  2,
  'science.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q12',
  'science',
  'hard',
  'Which molecule is the primary energy currency of cells?',
  'ATP transfers usable chemical energy in cells.',
  '["Cellulose","ATP","DNA","NADH only"]'::jsonb,
  1,
  'science.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q13',
  'science',
  'hard',
  'What is the name of the boundary around a black hole beyond which escape is impossible?',
  'The event horizon is the causal boundary of a black hole.',
  '["Event horizon","Photosphere","Magnetopause","Roche limit"]'::jsonb,
  0,
  'science.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q14',
  'science',
  'hard',
  'Which amino acid contains sulfur in a thiol group?',
  'Cysteine contains a sulfur-bearing thiol group.',
  '["Glycine","Alanine","Valine","Cysteine"]'::jsonb,
  3,
  'science.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q15',
  'science',
  'hard',
  'What is the SI unit of magnetic flux?',
  'Magnetic flux is measured in webers.',
  '["Farad","Siemens","Weber","Tesla"]'::jsonb,
  2,
  'science.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q16',
  'science',
  'hard',
  'Which geological process forms new oceanic crust at mid-ocean ridges?',
  'Magma rises and creates new crust at spreading centers.',
  '["Isostasy","Seafloor spreading","Subduction","Weathering"]'::jsonb,
  1,
  'science.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q17',
  'science',
  'hard',
  'Which blood vessel carries oxygenated blood from the lungs to the heart?',
  'Pulmonary veins return oxygenated blood to the left atrium.',
  '["Pulmonary vein","Pulmonary artery","Aorta","Vena cava"]'::jsonb,
  0,
  'science.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q18',
  'science',
  'hard',
  'What is the term for a change in allele frequency caused by chance?',
  'Genetic drift is stochastic change in allele frequencies.',
  '["Gene flow","Natural selection","Speciation","Genetic drift"]'::jsonb,
  3,
  'science.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q19',
  'science',
  'hard',
  'Which principle states that no two electrons in an atom can have the same four quantum numbers?',
  'The Pauli exclusion principle restricts electron quantum states.',
  '["Aufbau rule","Le Chatelier principle","Pauli exclusion principle","Heisenberg uncertainty principle"]'::jsonb,
  2,
  'science.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'science.hard.set1.q20',
  'science',
  'hard',
  'Which type of star is the Sun?',
  'The Sun is a G-type main-sequence star.',
  '["Neutron star","G-type main-sequence star","Red giant","White dwarf"]'::jsonb,
  1,
  'science.hard.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q01',
  'history',
  'easy',
  'Which ancient civilization built the pyramids of Giza?',
  'The pyramids of Giza were built in ancient Egypt.',
  '["Ancient Egyptians","Romans","Vikings","Aztecs"]'::jsonb,
  0,
  'history.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q02',
  'history',
  'easy',
  'In which country did the Renaissance begin?',
  'The Renaissance began in Italian city-states.',
  '["France","England","Germany","Italy"]'::jsonb,
  3,
  'history.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q03',
  'history',
  'easy',
  'Who was the first president of the United States?',
  'George Washington served as the first U.S. president.',
  '["Thomas Jefferson","John Adams","George Washington","Abraham Lincoln"]'::jsonb,
  2,
  'history.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q04',
  'history',
  'easy',
  'Which empire used Rome as its central city?',
  'Rome was the political heart of the Roman Empire.',
  '["Inca Empire","Roman Empire","Ottoman Empire","Mughal Empire"]'::jsonb,
  1,
  'history.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q05',
  'history',
  'easy',
  'Which ship famously sank on its maiden voyage in 1912?',
  'RMS Titanic sank in April 1912.',
  '["Titanic","Lusitania","Bismarck","Mayflower"]'::jsonb,
  0,
  'history.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q06',
  'history',
  'easy',
  'Which civilization built Machu Picchu?',
  'Machu Picchu was built by the Inca.',
  '["Maya","Aztec","Olmec","Inca"]'::jsonb,
  3,
  'history.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q07',
  'history',
  'easy',
  'The Great Wall is located in which country?',
  'The Great Wall stretches across northern China.',
  '["Japan","Mongolia","China","India"]'::jsonb,
  2,
  'history.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q08',
  'history',
  'easy',
  'Which war ended in 1945?',
  'World War II ended in 1945.',
  '["Seven Years'' War","World War II","World War I","Crimean War"]'::jsonb,
  1,
  'history.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q09',
  'history',
  'easy',
  'Which city was buried by Mount Vesuvius in AD 79?',
  'Pompeii was buried by the eruption of Vesuvius.',
  '["Pompeii","Athens","Sparta","Carthage"]'::jsonb,
  0,
  'history.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q10',
  'history',
  'easy',
  'Which ancient people are associated with democracy in Athens?',
  'Classical Athens developed an early form of democracy.',
  '["Persians","Phoenicians","Hittites","Greeks"]'::jsonb,
  3,
  'history.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q11',
  'history',
  'easy',
  'Who wrote the Declaration of Independence''s main draft?',
  'Thomas Jefferson wrote the principal draft.',
  '["Benjamin Franklin","James Madison","Thomas Jefferson","George Washington"]'::jsonb,
  2,
  'history.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q12',
  'history',
  'easy',
  'Which country was ruled by pharaohs?',
  'Pharaoh was the title of ancient Egyptian rulers.',
  '["Spain","Egypt","Norway","Peru"]'::jsonb,
  1,
  'history.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q13',
  'history',
  'easy',
  'Which medieval pandemic was known as the Black Death?',
  'The Black Death was largely caused by plague.',
  '["Bubonic plague","Smallpox","Influenza","Cholera"]'::jsonb,
  0,
  'history.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q14',
  'history',
  'easy',
  'Which explorer''s 1492 voyage crossed the Atlantic under Spanish sponsorship?',
  'Columbus crossed the Atlantic in 1492.',
  '["James Cook","Marco Polo","Ferdinand Magellan","Christopher Columbus"]'::jsonb,
  3,
  'history.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q15',
  'history',
  'easy',
  'Which empire was centered in Constantinople after the western Roman Empire fell?',
  'The Eastern Roman Empire is commonly called the Byzantine Empire.',
  '["Aztec Empire","British Empire","Byzantine Empire","Mali Empire"]'::jsonb,
  2,
  'history.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q16',
  'history',
  'easy',
  'Which invention is strongly associated with Johannes Gutenberg?',
  'Gutenberg is associated with movable-type printing in Europe.',
  '["Compass","Movable-type printing press","Steam engine","Telephone"]'::jsonb,
  1,
  'history.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q17',
  'history',
  'easy',
  'Which country gifted the Statue of Liberty to the United States?',
  'France gifted the Statue of Liberty.',
  '["France","Spain","Italy","Canada"]'::jsonb,
  0,
  'history.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q18',
  'history',
  'easy',
  'Who was known as the Maid of Orléans?',
  'Joan of Arc is known as the Maid of Orléans.',
  '["Marie Curie","Catherine de'' Medici","Eleanor of Aquitaine","Joan of Arc"]'::jsonb,
  3,
  'history.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q19',
  'history',
  'easy',
  'Which civilization used cuneiform writing in Mesopotamia?',
  'Sumerians used cuneiform script.',
  '["Celts","Maori","Sumerians","Minoans"]'::jsonb,
  2,
  'history.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'history.easy.set1.q20',
  'history',
  'easy',
  'Which document signed in 1215 limited the English king''s power?',
  'Magna Carta was sealed in 1215.',
  '["Treaty of Versailles","Magna Carta","Bill of Rights","Domesday Book"]'::jsonb,
  1,
  'history.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q01',
  'history',
  'medium',
  'Which treaty formally ended World War I between Germany and the Allies?',
  'The Treaty of Versailles was signed in 1919.',
  '["Treaty of Versailles","Treaty of Tordesillas","Treaty of Utrecht","Treaty of Paris 1763"]'::jsonb,
  0,
  'history.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q02',
  'history',
  'medium',
  'Which empire was ruled by Mansa Musa?',
  'Mansa Musa ruled the Mali Empire.',
  '["Songhai Empire","Ottoman Empire","Aksumite Empire","Mali Empire"]'::jsonb,
  3,
  'history.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q03',
  'history',
  'medium',
  'What was the capital of the Aztec Empire?',
  'Tenochtitlan stood where Mexico City is today.',
  '["Teotihuacan","Chichén Itzá","Tenochtitlan","Cusco"]'::jsonb,
  2,
  'history.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q04',
  'history',
  'medium',
  'Which dynasty built much of the present-day Great Wall of China?',
  'Large surviving sections were built under the Ming.',
  '["Qing dynasty","Ming dynasty","Tang dynasty","Han dynasty"]'::jsonb,
  1,
  'history.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q05',
  'history',
  'medium',
  'Which battle in 1066 led to Norman rule in England?',
  'William the Conqueror won at Hastings.',
  '["Battle of Hastings","Battle of Agincourt","Battle of Tours","Battle of Bosworth"]'::jsonb,
  0,
  'history.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q06',
  'history',
  'medium',
  'Which civilization had its capital at Cusco?',
  'Cusco was the capital of the Inca Empire.',
  '["Maya civilization","Mali Empire","Khmer Empire","Inca Empire"]'::jsonb,
  3,
  'history.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q07',
  'history',
  'medium',
  'Which movement began with Martin Luther''s Ninety-five Theses?',
  'Luther''s challenge helped launch the Protestant Reformation.',
  '["Industrial Revolution","Great Awakening","Protestant Reformation","Enlightenment"]'::jsonb,
  2,
  'history.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q08',
  'history',
  'medium',
  'Which empire captured Constantinople in 1453?',
  'Ottoman forces under Mehmed II captured Constantinople.',
  '["Safavid Empire","Ottoman Empire","Mongol Empire","Holy Roman Empire"]'::jsonb,
  1,
  'history.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q09',
  'history',
  'medium',
  'Which queen ruled England during the defeat of the Spanish Armada?',
  'Elizabeth I reigned in 1588.',
  '["Elizabeth I","Victoria","Mary I","Anne"]'::jsonb,
  0,
  'history.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q10',
  'history',
  'medium',
  'Which country was formerly known as Persia?',
  'Iran was commonly called Persia in the West until the 20th century.',
  '["Iraq","Syria","Turkey","Iran"]'::jsonb,
  3,
  'history.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q11',
  'history',
  'medium',
  'Which revolution began with the storming of the Bastille in 1789?',
  'The Bastille was stormed on 14 July 1789.',
  '["Haitian Revolution","Glorious Revolution","French Revolution","Russian Revolution"]'::jsonb,
  2,
  'history.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q12',
  'history',
  'medium',
  'Which Roman city was the eastern capital refounded by Constantine?',
  'Constantine refounded Byzantium as Constantinople.',
  '["Ravenna","Constantinople","Alexandria","Antioch"]'::jsonb,
  1,
  'history.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q13',
  'history',
  'medium',
  'Which empire built Angkor Wat?',
  'Angkor Wat was built by the Khmer Empire.',
  '["Khmer Empire","Maurya Empire","Majapahit Empire","Gupta Empire"]'::jsonb,
  0,
  'history.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q14',
  'history',
  'medium',
  'Who led the Soviet Union during most of World War II?',
  'Stalin led the USSR during most of the war.',
  '["Vladimir Lenin","Nikita Khrushchev","Leon Trotsky","Joseph Stalin"]'::jsonb,
  3,
  'history.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q15',
  'history',
  'medium',
  'Which ancient Greek city-state was famous for its military society?',
  'Sparta was known for its military-centered society.',
  '["Delphi","Miletus","Sparta","Corinth"]'::jsonb,
  2,
  'history.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q16',
  'history',
  'medium',
  'Which event triggered the start of World War I in 1914?',
  'The assassination in Sarajevo triggered the July Crisis.',
  '["Wall Street Crash","Assassination of Archduke Franz Ferdinand","Sinking of the Titanic","Russian Revolution"]'::jsonb,
  1,
  'history.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q17',
  'history',
  'medium',
  'Which ruler issued the Edict of Milan with Licinius in 313?',
  'The Edict of Milan granted religious toleration in the Roman Empire.',
  '["Constantine I","Augustus","Nero","Trajan"]'::jsonb,
  0,
  'history.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q18',
  'history',
  'medium',
  'Which African country defeated Italy at the Battle of Adwa in 1896?',
  'Ethiopian forces defeated Italy at Adwa.',
  '["Kenya","Sudan","Ghana","Ethiopia"]'::jsonb,
  3,
  'history.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q19',
  'history',
  'medium',
  'Which civilization created the Rosetta Stone?',
  'The Rosetta Stone dates to Ptolemaic Egypt.',
  '["Achaemenid Persia","Minoan Crete","Ptolemaic Egypt","Roman Republic"]'::jsonb,
  2,
  'history.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'history.medium.set1.q20',
  'history',
  'medium',
  'Which English king had six wives?',
  'Henry VIII married six times.',
  '["Edward I","Henry VIII","Henry V","Richard III"]'::jsonb,
  1,
  'history.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q01',
  'history',
  'hard',
  'Which peace settlement ended the Thirty Years'' War in 1648?',
  'The Peace of Westphalia ended the Thirty Years'' War.',
  '["Peace of Westphalia","Treaty of Utrecht","Congress of Vienna","Treaty of Aachen"]'::jsonb,
  0,
  'history.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q02',
  'history',
  'hard',
  'Which dynasty ruled China when Zheng He led his major voyages?',
  'Zheng He''s voyages occurred under the Ming.',
  '["Song dynasty","Yuan dynasty","Qing dynasty","Ming dynasty"]'::jsonb,
  3,
  'history.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q03',
  'history',
  'hard',
  'Which Persian ruler founded the Achaemenid Empire?',
  'Cyrus II founded the Achaemenid Empire.',
  '["Xerxes II","Artaxerxes III","Cyrus the Great","Darius III"]'::jsonb,
  2,
  'history.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q04',
  'history',
  'hard',
  'Which battle in 732 is associated with Charles Martel?',
  'Charles Martel''s forces won near Tours/Poitiers in 732.',
  '["Battle of Crécy","Battle of Tours","Battle of Poitiers 1356","Battle of Bouvines"]'::jsonb,
  1,
  'history.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q05',
  'history',
  'hard',
  'Which ruler commissioned the Domesday Book?',
  'William the Conqueror ordered the Domesday survey.',
  '["William I of England","Alfred the Great","Henry II","Edward the Confessor"]'::jsonb,
  0,
  'history.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q06',
  'history',
  'hard',
  'Which dynasty ruled the Byzantine Empire during the reign of Justinian I?',
  'Justinian I belonged to the Justinian dynasty.',
  '["Komnenian dynasty","Palaiologan dynasty","Macedonian dynasty","Justinian dynasty"]'::jsonb,
  3,
  'history.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q07',
  'history',
  'hard',
  'Which treaty divided newly encountered lands outside Europe between Spain and Portugal in 1494?',
  'Tordesillas divided spheres of expansion between Spain and Portugal.',
  '["Treaty of Alcáçovas","Treaty of Cateau-Cambrésis","Treaty of Tordesillas","Treaty of Zaragoza only"]'::jsonb,
  2,
  'history.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q08',
  'history',
  'hard',
  'Which revolt began in India in 1857 against East India Company rule?',
  'The 1857 uprising challenged Company rule.',
  '["Sepoy War of 1919","Indian Rebellion of 1857","Boxer Rebellion","Taiping Rebellion"]'::jsonb,
  1,
  'history.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q09',
  'history',
  'hard',
  'Which ruler was defeated at the Battle of Waterloo?',
  'Napoleon was defeated at Waterloo in 1815.',
  '["Napoleon Bonaparte","Louis XIV","Charlemagne","Otto von Bismarck"]'::jsonb,
  0,
  'history.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q10',
  'history',
  'hard',
  'Which city served as the capital of the Abbasid Caliphate for much of its history?',
  'Baghdad was founded as the Abbasid capital in the 8th century.',
  '["Damascus","Cairo","Mecca","Baghdad"]'::jsonb,
  3,
  'history.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q11',
  'history',
  'hard',
  'Which civilization built the city of Great Zimbabwe?',
  'Great Zimbabwe was built by ancestors of the Shona peoples.',
  '["Romans","Aksumites","Shona ancestors","Phoenicians"]'::jsonb,
  2,
  'history.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q12',
  'history',
  'hard',
  'Which emperor was crowned in Rome on Christmas Day in 800?',
  'Pope Leo III crowned Charlemagne emperor in 800.',
  '["Justinian I","Charlemagne","Otto I","Frederick Barbarossa"]'::jsonb,
  1,
  'history.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q13',
  'history',
  'hard',
  'Which battle in 1709 was one of the bloodiest of the War of the Spanish Succession?',
  'Malplaquet in 1709 was exceptionally costly.',
  '["Battle of Malplaquet","Battle of Blenheim","Battle of Ramillies","Battle of Rocroi"]'::jsonb,
  0,
  'history.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q14',
  'history',
  'hard',
  'Which Japanese shogunate began in 1603?',
  'Tokugawa Ieyasu became shogun in 1603.',
  '["Kamakura shogunate","Ashikaga shogunate","Fujiwara shogunate","Tokugawa shogunate"]'::jsonb,
  3,
  'history.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q15',
  'history',
  'hard',
  'Which kingdom had its capital at Meroë?',
  'Meroë was a major capital of Kush.',
  '["Nabataean Kingdom","Ptolemaic Kingdom","Kingdom of Kush","Kingdom of Aksum"]'::jsonb,
  2,
  'history.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q16',
  'history',
  'hard',
  'Which 19th-century conference formalized many rules for European colonization in Africa?',
  'The Berlin Conference took place in 1884–85.',
  '["Potsdam Conference","Berlin Conference","Congress of Vienna","Algeciras Conference"]'::jsonb,
  1,
  'history.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q17',
  'history',
  'hard',
  'Which Roman emperor divided administration between a tetrarchy of rulers?',
  'Diocletian established the Tetrarchy.',
  '["Diocletian","Hadrian","Claudius","Marcus Aurelius"]'::jsonb,
  0,
  'history.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q18',
  'history',
  'hard',
  'Which 1688 event replaced James II in England?',
  'The Glorious Revolution deposed James II.',
  '["English Civil War","Wars of the Roses","Restoration","Glorious Revolution"]'::jsonb,
  3,
  'history.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q19',
  'history',
  'hard',
  'Which empire controlled much of the Andes before the Inca expansion?',
  'The Wari state was a major Andean power centuries before the Inca.',
  '["Sassanian Empire","Srivijaya","Wari Empire","Mughal Empire"]'::jsonb,
  2,
  'history.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'history.hard.set1.q20',
  'history',
  'hard',
  'Which ancient historian wrote The Histories about the Greco-Persian Wars?',
  'Herodotus authored The Histories.',
  '["Tacitus","Herodotus","Thucydides","Polybius"]'::jsonb,
  1,
  'history.hard.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q01',
  'sports',
  'easy',
  'How many players does a soccer team normally have on the field at once?',
  'A soccer team fields 11 players including the goalkeeper.',
  '["11","9","10","12"]'::jsonb,
  0,
  'sports.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q02',
  'sports',
  'easy',
  'Which sport uses a basketball hoop?',
  'Basketball is scored through a hoop.',
  '["Volleyball","Tennis","Rugby","Basketball"]'::jsonb,
  3,
  'sports.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q03',
  'sports',
  'easy',
  'How many points is a touchdown worth before the extra-point attempt?',
  'A touchdown is worth six points.',
  '["5","7","6","3"]'::jsonb,
  2,
  'sports.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q04',
  'sports',
  'easy',
  'Which sport is played at Wimbledon?',
  'Wimbledon is a major tennis championship.',
  '["Badminton","Tennis","Golf","Cricket"]'::jsonb,
  1,
  'sports.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q05',
  'sports',
  'easy',
  'How many rings are on the Olympic symbol?',
  'The Olympic symbol has five interlocking rings.',
  '["5","4","6","7"]'::jsonb,
  0,
  'sports.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q06',
  'sports',
  'easy',
  'Which sport uses clubs and a small ball on a course with holes?',
  'Golf is played with clubs and holes.',
  '["Hockey","Polo","Baseball","Golf"]'::jsonb,
  3,
  'sports.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q07',
  'sports',
  'easy',
  'What color card sends a soccer player off the field?',
  'A red card means dismissal.',
  '["Blue","Green","Red","Yellow"]'::jsonb,
  2,
  'sports.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q08',
  'sports',
  'easy',
  'Which sport uses a puck?',
  'Ice hockey is played with a puck.',
  '["Handball","Ice hockey","Basketball","Baseball"]'::jsonb,
  1,
  'sports.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q09',
  'sports',
  'easy',
  'How many bases are on a baseball diamond including home plate?',
  'There are first, second, third and home plate.',
  '["4","3","5","6"]'::jsonb,
  0,
  'sports.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q10',
  'sports',
  'easy',
  'Which sport features a pommel horse?',
  'The pommel horse is a gymnastics apparatus.',
  '["Swimming","Fencing","Rowing","Gymnastics"]'::jsonb,
  3,
  'sports.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q11',
  'sports',
  'easy',
  'What is the maximum score with one dart in standard darts?',
  'Triple 20 scores 60.',
  '["50","100","60","20"]'::jsonb,
  2,
  'sports.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q12',
  'sports',
  'easy',
  'Which sport uses a shuttlecock?',
  'Badminton uses a shuttlecock.',
  '["Lacrosse","Badminton","Squash","Table tennis"]'::jsonb,
  1,
  'sports.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q13',
  'sports',
  'easy',
  'How long is an Olympic swimming pool?',
  'Olympic long-course pools are 50 metres long.',
  '["50 metres","25 metres","40 metres","100 metres"]'::jsonb,
  0,
  'sports.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q14',
  'sports',
  'easy',
  'Which sport includes the positions quarterback and wide receiver?',
  'Those are American football positions.',
  '["Baseball","Rugby union","Basketball","American football"]'::jsonb,
  3,
  'sports.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q15',
  'sports',
  'easy',
  'Which sport is associated with the Tour de France?',
  'The Tour de France is a road cycling race.',
  '["Motorsport","Skiing","Cycling","Running"]'::jsonb,
  2,
  'sports.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q16',
  'sports',
  'easy',
  'How many points is a free throw worth in basketball?',
  'A made free throw scores one point.',
  '["4","1","2","3"]'::jsonb,
  1,
  'sports.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q17',
  'sports',
  'easy',
  'Which sport has a goalkeeper and a penalty area?',
  'Soccer uses goalkeepers and penalty areas.',
  '["Soccer","Tennis","Golf","Baseball"]'::jsonb,
  0,
  'sports.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q18',
  'sports',
  'easy',
  'Which combat sport uses throws, pins and grappling on a mat?',
  'Wrestling centers on grappling techniques.',
  '["Archery","Rowing","Cycling","Wrestling"]'::jsonb,
  3,
  'sports.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q19',
  'sports',
  'easy',
  'Which sport uses wickets, bats and overs?',
  'Cricket uses wickets and overs.',
  '["Field hockey","Baseball","Cricket","Rugby"]'::jsonb,
  2,
  'sports.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'sports.easy.set1.q20',
  'sports',
  'easy',
  'What is a score of zero called in tennis?',
  'In tennis, zero is called love.',
  '["Duck","Love","Blank","Nil"]'::jsonb,
  1,
  'sports.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q01',
  'sports',
  'medium',
  'How many minutes are in a standard soccer match excluding added time and extra time?',
  'A standard match is two 45-minute halves.',
  '["90","80","100","120"]'::jsonb,
  0,
  'sports.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q02',
  'sports',
  'medium',
  'How many points is a try worth in rugby union?',
  'A try is worth five points.',
  '["3","4","6","5"]'::jsonb,
  3,
  'sports.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q03',
  'sports',
  'medium',
  'What is the official marathon distance?',
  'The marathon distance is 42.195 km.',
  '["41.5 km","44.2 km","42.195 km","40 km"]'::jsonb,
  2,
  'sports.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q04',
  'sports',
  'medium',
  'Which tennis surface is used at Roland-Garros?',
  'The French Open is played on clay.',
  '["Carpet","Clay","Grass","Hard court"]'::jsonb,
  1,
  'sports.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q05',
  'sports',
  'medium',
  'How many outs does each team receive per half-inning in baseball?',
  'Three outs end a half-inning.',
  '["3","2","4","6"]'::jsonb,
  0,
  'sports.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q06',
  'sports',
  'medium',
  'What is the shot clock length in the NBA?',
  'NBA teams normally have 24 seconds to attempt a shot.',
  '["20 seconds","30 seconds","35 seconds","24 seconds"]'::jsonb,
  3,
  'sports.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q07',
  'sports',
  'medium',
  'Which chess time-control term describes a very fast game, often under 10 minutes per player?',
  'Blitz chess uses short time controls.',
  '["Correspondence","Adjourned","Blitz","Classical"]'::jsonb,
  2,
  'sports.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q08',
  'sports',
  'medium',
  'How many players are on the court for one volleyball team?',
  'Six players per team are on the court.',
  '["8","6","5","7"]'::jsonb,
  1,
  'sports.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q09',
  'sports',
  'medium',
  'What is a birdie in golf?',
  'A birdie is one under par.',
  '["One stroke under par","One stroke over par","Two strokes under par","Exactly par"]'::jsonb,
  0,
  'sports.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q10',
  'sports',
  'medium',
  'Which athletics event combines ten track-and-field disciplines?',
  'A decathlon has ten events.',
  '["Heptathlon","Pentathlon","Triathlon","Decathlon"]'::jsonb,
  3,
  'sports.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q11',
  'sports',
  'medium',
  'What is the diameter of a basketball hoop in inches?',
  'A regulation basketball rim is 18 inches in diameter.',
  '["20 inches","24 inches","18 inches","16 inches"]'::jsonb,
  2,
  'sports.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q12',
  'sports',
  'medium',
  'How many periods are in a standard NHL ice hockey game?',
  'NHL regulation games have three periods.',
  '["5","3","2","4"]'::jsonb,
  1,
  'sports.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q13',
  'sports',
  'medium',
  'What is the maximum break in snooker under normal circumstances?',
  'A standard maximum break is 147.',
  '["147","155","180","100"]'::jsonb,
  0,
  'sports.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q14',
  'sports',
  'medium',
  'Which swimming stroke uses a frog-like kick?',
  'Breaststroke uses a simultaneous frog-style kick.',
  '["Backstroke","Butterfly","Freestyle","Breaststroke"]'::jsonb,
  3,
  'sports.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q15',
  'sports',
  'medium',
  'How many sets must a team normally win to win an indoor volleyball match?',
  'Standard matches are best of five sets.',
  '["4","5","3","2"]'::jsonb,
  2,
  'sports.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q16',
  'sports',
  'medium',
  'In baseball, how many strikes normally make an out?',
  'Three strikes result in a strikeout.',
  '["5","3","2","4"]'::jsonb,
  1,
  'sports.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q17',
  'sports',
  'medium',
  'Which lane is closest to the inside of a standard running track?',
  'Lane 1 is the innermost lane.',
  '["Lane 1","Lane 4","Lane 8","Lane 9"]'::jsonb,
  0,
  'sports.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q18',
  'sports',
  'medium',
  'In Formula One, what color flag signals the end of a race?',
  'The chequered flag marks the finish.',
  '["Red flag","Yellow flag","Blue flag","Chequered flag"]'::jsonb,
  3,
  'sports.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q19',
  'sports',
  'medium',
  'Which sport uses the term ''scrum''?',
  'Scrums are a set piece in rugby.',
  '["Tennis","Baseball","Rugby","Basketball"]'::jsonb,
  2,
  'sports.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'sports.medium.set1.q20',
  'sports',
  'medium',
  'How many points is the bullseye worth in standard darts?',
  'The inner bull is worth 50 points.',
  '["60","50","25","40"]'::jsonb,
  1,
  'sports.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q01',
  'sports',
  'hard',
  'In tennis, what is the minimum point margin required to win a standard tiebreak?',
  'A standard tiebreak must be won by two points.',
  '["2 points","1 point","3 points","4 points"]'::jsonb,
  0,
  'sports.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q02',
  'sports',
  'hard',
  'What is the maximum legal weight of a standard table tennis ball under current rules?',
  'A regulation table tennis ball weighs 2.7 g.',
  '["2.0 grams","3.2 grams","4.0 grams","2.7 grams"]'::jsonb,
  3,
  'sports.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q03',
  'sports',
  'hard',
  'How far is the penalty spot from the goal line in association football?',
  'The penalty mark is 12 yards from the goal line.',
  '["11 yards","15 yards","12 yards","10 yards"]'::jsonb,
  2,
  'sports.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q04',
  'sports',
  'hard',
  'In rugby union, how many players are in a full scrum?',
  'Eight forwards per team form a full scrum.',
  '["9 per team","8 per team","6 per team","7 per team"]'::jsonb,
  1,
  'sports.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q05',
  'sports',
  'hard',
  'What is the standard height of a basketball rim above the floor?',
  'The rim is 10 feet above the court.',
  '["10 feet","9 feet","11 feet","12 feet"]'::jsonb,
  0,
  'sports.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q06',
  'sports',
  'hard',
  'In cricket, how many legal balls are in a standard over?',
  'Modern standard overs contain six legal deliveries.',
  '["5","7","8","6"]'::jsonb,
  3,
  'sports.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q07',
  'sports',
  'hard',
  'What is the maximum number of clubs a golfer may carry in a round under the Rules of Golf?',
  'The maximum is 14 clubs.',
  '["15","16","14","12"]'::jsonb,
  2,
  'sports.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q08',
  'sports',
  'hard',
  'How many points is a safety worth in American football?',
  'A safety scores two points.',
  '["4","2","1","3"]'::jsonb,
  1,
  'sports.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q09',
  'sports',
  'hard',
  'In fencing, which weapon has the entire body as valid target area?',
  'Épée target area includes the entire body.',
  '["Épée","Foil","Sabre","Rapier"]'::jsonb,
  0,
  'sports.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q10',
  'sports',
  'hard',
  'How wide is a standard soccer goal?',
  'A full-size goal is 8 yards wide.',
  '["6 yards","7 yards","10 yards","8 yards"]'::jsonb,
  3,
  'sports.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q11',
  'sports',
  'hard',
  'Which swimming stroke begins from the water rather than a starting block in competition?',
  'Backstroke starts are made in the water.',
  '["Breaststroke","Freestyle","Backstroke","Butterfly"]'::jsonb,
  2,
  'sports.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q12',
  'sports',
  'hard',
  'What is the maximum score for one arrow in standard target archery?',
  'The innermost scoring ring is worth 10.',
  '["20","10","9","12"]'::jsonb,
  1,
  'sports.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q13',
  'sports',
  'hard',
  'How many points is a conversion worth in rugby union?',
  'A successful conversion adds two points.',
  '["2","1","3","5"]'::jsonb,
  0,
  'sports.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q14',
  'sports',
  'hard',
  'In baseball, how far apart are the bases in Major League Baseball?',
  'MLB bases are 90 feet apart.',
  '["60 feet","75 feet","100 feet","90 feet"]'::jsonb,
  3,
  'sports.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q15',
  'sports',
  'hard',
  'What is the length of one lap of a standard outdoor athletics track in lane 1?',
  'A standard outdoor track is 400 m around lane 1.',
  '["300 metres","500 metres","400 metres","200 metres"]'::jsonb,
  2,
  'sports.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q16',
  'sports',
  'hard',
  'In snooker, which colored ball is worth the most points?',
  'The black is worth seven points.',
  '["Brown","Black","Pink","Blue"]'::jsonb,
  1,
  'sports.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q17',
  'sports',
  'hard',
  'What is the net height at the center in men''s singles tennis?',
  'The tennis net is 3 feet high at the center.',
  '["3 feet","2 feet 6 inches","3 feet 6 inches","4 feet"]'::jsonb,
  0,
  'sports.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q18',
  'sports',
  'hard',
  'How many rounds are in a standard professional boxing world-title bout?',
  'Modern world-title bouts are generally scheduled for 12 rounds.',
  '["10","15","20","12"]'::jsonb,
  3,
  'sports.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q19',
  'sports',
  'hard',
  'In ice hockey, how many skaters per team are normally on the ice at even strength, excluding the goaltender?',
  'At even strength, each team has five skaters plus a goaltender.',
  '["6","7","5","4"]'::jsonb,
  2,
  'sports.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'sports.hard.set1.q20',
  'sports',
  'hard',
  'Which athletics throwing event uses a wire-handled metal ball?',
  'The hammer is a metal ball attached to a wire and handle.',
  '["Javelin","Hammer throw","Shot put","Discus"]'::jsonb,
  1,
  'sports.hard.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q01',
  'world-capitals',
  'easy',
  'What is the capital of France?',
  'Paris is the capital of France.',
  '["Paris","Ottawa","Rome","Buenos Aires"]'::jsonb,
  0,
  'world-capitals.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q02',
  'world-capitals',
  'easy',
  'What is the capital of Japan?',
  'Tokyo is the capital of Japan.',
  '["Brasília","Berlin","Mexico City","Tokyo"]'::jsonb,
  3,
  'world-capitals.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q03',
  'world-capitals',
  'easy',
  'What is the capital of Australia?',
  'Canberra is the capital of Australia.',
  '["New Delhi","Seoul","Canberra","Cairo"]'::jsonb,
  2,
  'world-capitals.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q04',
  'world-capitals',
  'easy',
  'What is the capital of Canada?',
  'Ottawa is the capital of Canada.',
  '["Bangkok","Ottawa","Madrid","Beijing"]'::jsonb,
  1,
  'world-capitals.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q05',
  'world-capitals',
  'easy',
  'What is the capital of Brazil?',
  'Brasília is the capital of Brazil.',
  '["Brasília","Rome","Buenos Aires","Athens"]'::jsonb,
  0,
  'world-capitals.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q06',
  'world-capitals',
  'easy',
  'What is the capital of Egypt?',
  'Cairo is the capital of Egypt.',
  '["Berlin","Mexico City","Lisbon","Cairo"]'::jsonb,
  3,
  'world-capitals.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q07',
  'world-capitals',
  'easy',
  'What is the capital of Spain?',
  'Madrid is the capital of Spain.',
  '["Seoul","Oslo","Madrid","New Delhi"]'::jsonb,
  2,
  'world-capitals.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q08',
  'world-capitals',
  'easy',
  'What is the capital of Italy?',
  'Rome is the capital of Italy.',
  '["Stockholm","Rome","Beijing","Bangkok"]'::jsonb,
  1,
  'world-capitals.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q09',
  'world-capitals',
  'easy',
  'What is the capital of Germany?',
  'Berlin is the capital of Germany.',
  '["Berlin","Buenos Aires","Athens","Nairobi"]'::jsonb,
  0,
  'world-capitals.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q10',
  'world-capitals',
  'easy',
  'What is the capital of India?',
  'New Delhi is the capital of India.',
  '["Mexico City","Lisbon","Paris","New Delhi"]'::jsonb,
  3,
  'world-capitals.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q11',
  'world-capitals',
  'easy',
  'What is the capital of China?',
  'Beijing is the capital of China.',
  '["Oslo","Tokyo","Beijing","Seoul"]'::jsonb,
  2,
  'world-capitals.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q12',
  'world-capitals',
  'easy',
  'What is the capital of Argentina?',
  'Buenos Aires is the capital of Argentina.',
  '["Canberra","Buenos Aires","Bangkok","Stockholm"]'::jsonb,
  1,
  'world-capitals.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q13',
  'world-capitals',
  'easy',
  'What is the capital of Mexico?',
  'Mexico City is the capital of Mexico.',
  '["Mexico City","Athens","Nairobi","Ottawa"]'::jsonb,
  0,
  'world-capitals.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q14',
  'world-capitals',
  'easy',
  'What is the capital of South Korea?',
  'Seoul is the capital of South Korea.',
  '["Lisbon","Paris","Brasília","Seoul"]'::jsonb,
  3,
  'world-capitals.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q15',
  'world-capitals',
  'easy',
  'What is the capital of Thailand?',
  'Bangkok is the capital of Thailand.',
  '["Tokyo","Cairo","Bangkok","Oslo"]'::jsonb,
  2,
  'world-capitals.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q16',
  'world-capitals',
  'easy',
  'What is the capital of Greece?',
  'Athens is the capital of Greece.',
  '["Madrid","Athens","Stockholm","Canberra"]'::jsonb,
  1,
  'world-capitals.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q17',
  'world-capitals',
  'easy',
  'What is the capital of Portugal?',
  'Lisbon is the capital of Portugal.',
  '["Lisbon","Nairobi","Ottawa","Rome"]'::jsonb,
  0,
  'world-capitals.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q18',
  'world-capitals',
  'easy',
  'What is the capital of Norway?',
  'Oslo is the capital of Norway.',
  '["Paris","Brasília","Berlin","Oslo"]'::jsonb,
  3,
  'world-capitals.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q19',
  'world-capitals',
  'easy',
  'What is the capital of Sweden?',
  'Stockholm is the capital of Sweden.',
  '["Cairo","New Delhi","Stockholm","Tokyo"]'::jsonb,
  2,
  'world-capitals.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-capitals.easy.set1.q20',
  'world-capitals',
  'easy',
  'What is the capital of Kenya?',
  'Nairobi is the capital of Kenya.',
  '["Beijing","Nairobi","Canberra","Madrid"]'::jsonb,
  1,
  'world-capitals.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q01',
  'world-capitals',
  'medium',
  'What is the capital of Morocco?',
  'Rabat is the capital of Morocco.',
  '["Rabat","Jakarta","Vienna","Warsaw"]'::jsonb,
  0,
  'world-capitals.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q02',
  'world-capitals',
  'medium',
  'What is the capital of Turkey?',
  'Ankara is the capital of Turkey.',
  '["Manila","Bern","Prague","Ankara"]'::jsonb,
  3,
  'world-capitals.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q03',
  'world-capitals',
  'medium',
  'What is the capital of Vietnam?',
  'Hanoi is the capital of Vietnam.',
  '["Brussels","Budapest","Hanoi","Wellington"]'::jsonb,
  2,
  'world-capitals.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q04',
  'world-capitals',
  'medium',
  'What is the capital of Indonesia?',
  'Jakarta is the capital of Indonesia.',
  '["Bucharest","Jakarta","Dublin","Amsterdam"]'::jsonb,
  1,
  'world-capitals.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q05',
  'world-capitals',
  'medium',
  'What is the capital of Philippines?',
  'Manila is the capital of Philippines.',
  '["Manila","Vienna","Warsaw","Sofia"]'::jsonb,
  0,
  'world-capitals.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q06',
  'world-capitals',
  'medium',
  'What is the capital of New Zealand?',
  'Wellington is the capital of New Zealand.',
  '["Bern","Prague","Helsinki","Wellington"]'::jsonb,
  3,
  'world-capitals.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q07',
  'world-capitals',
  'medium',
  'What is the capital of Ireland?',
  'Dublin is the capital of Ireland.',
  '["Budapest","Copenhagen","Dublin","Brussels"]'::jsonb,
  2,
  'world-capitals.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q08',
  'world-capitals',
  'medium',
  'What is the capital of Austria?',
  'Vienna is the capital of Austria.',
  '["Lima","Vienna","Amsterdam","Bucharest"]'::jsonb,
  1,
  'world-capitals.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q09',
  'world-capitals',
  'medium',
  'What is the capital of Switzerland?',
  'Bern is the capital of Switzerland.',
  '["Bern","Warsaw","Sofia","Bogotá"]'::jsonb,
  0,
  'world-capitals.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q10',
  'world-capitals',
  'medium',
  'What is the capital of Belgium?',
  'Brussels is the capital of Belgium.',
  '["Prague","Helsinki","Rabat","Brussels"]'::jsonb,
  3,
  'world-capitals.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q11',
  'world-capitals',
  'medium',
  'What is the capital of Netherlands?',
  'Amsterdam is the capital of Netherlands.',
  '["Copenhagen","Ankara","Amsterdam","Budapest"]'::jsonb,
  2,
  'world-capitals.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q12',
  'world-capitals',
  'medium',
  'What is the capital of Poland?',
  'Warsaw is the capital of Poland.',
  '["Hanoi","Warsaw","Bucharest","Lima"]'::jsonb,
  1,
  'world-capitals.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q13',
  'world-capitals',
  'medium',
  'What is the capital of Czechia?',
  'Prague is the capital of Czechia.',
  '["Prague","Sofia","Bogotá","Jakarta"]'::jsonb,
  0,
  'world-capitals.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q14',
  'world-capitals',
  'medium',
  'What is the capital of Hungary?',
  'Budapest is the capital of Hungary.',
  '["Helsinki","Rabat","Manila","Budapest"]'::jsonb,
  3,
  'world-capitals.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q15',
  'world-capitals',
  'medium',
  'What is the capital of Romania?',
  'Bucharest is the capital of Romania.',
  '["Ankara","Wellington","Bucharest","Copenhagen"]'::jsonb,
  2,
  'world-capitals.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q16',
  'world-capitals',
  'medium',
  'What is the capital of Bulgaria?',
  'Sofia is the capital of Bulgaria.',
  '["Dublin","Sofia","Lima","Hanoi"]'::jsonb,
  1,
  'world-capitals.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q17',
  'world-capitals',
  'medium',
  'What is the capital of Finland?',
  'Helsinki is the capital of Finland.',
  '["Helsinki","Bogotá","Jakarta","Vienna"]'::jsonb,
  0,
  'world-capitals.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q18',
  'world-capitals',
  'medium',
  'What is the capital of Denmark?',
  'Copenhagen is the capital of Denmark.',
  '["Rabat","Manila","Bern","Copenhagen"]'::jsonb,
  3,
  'world-capitals.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q19',
  'world-capitals',
  'medium',
  'What is the capital of Peru?',
  'Lima is the capital of Peru.',
  '["Wellington","Brussels","Lima","Ankara"]'::jsonb,
  2,
  'world-capitals.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-capitals.medium.set1.q20',
  'world-capitals',
  'medium',
  'What is the capital of Colombia?',
  'Bogotá is the capital of Colombia.',
  '["Amsterdam","Bogotá","Hanoi","Dublin"]'::jsonb,
  1,
  'world-capitals.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q01',
  'world-capitals',
  'hard',
  'What is the capital of Kazakhstan?',
  'Astana is the capital of Kazakhstan.',
  '["Astana","Kathmandu","Dodoma","Dakar"]'::jsonb,
  0,
  'world-capitals.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q02',
  'world-capitals',
  'hard',
  'What is the capital of Mongolia?',
  'Ulaanbaatar is the capital of Mongolia.',
  '["Vientiane","Abuja","Windhoek","Ulaanbaatar"]'::jsonb,
  3,
  'world-capitals.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q03',
  'world-capitals',
  'hard',
  'What is the capital of Bhutan?',
  'Thimphu is the capital of Bhutan.',
  '["Accra","Gaborone","Thimphu","Phnom Penh"]'::jsonb,
  2,
  'world-capitals.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q04',
  'world-capitals',
  'hard',
  'What is the capital of Nepal?',
  'Kathmandu is the capital of Nepal.',
  '["Harare","Kathmandu","Naypyidaw","Addis Ababa"]'::jsonb,
  1,
  'world-capitals.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q05',
  'world-capitals',
  'hard',
  'What is the capital of Laos?',
  'Vientiane is the capital of Laos.',
  '["Vientiane","Dodoma","Dakar","Montevideo"]'::jsonb,
  0,
  'world-capitals.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q06',
  'world-capitals',
  'hard',
  'What is the capital of Cambodia?',
  'Phnom Penh is the capital of Cambodia.',
  '["Abuja","Windhoek","Asunción","Phnom Penh"]'::jsonb,
  3,
  'world-capitals.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q07',
  'world-capitals',
  'hard',
  'What is the capital of Myanmar?',
  'Naypyidaw is the capital of Myanmar.',
  '["Gaborone","Quito","Naypyidaw","Accra"]'::jsonb,
  2,
  'world-capitals.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q08',
  'world-capitals',
  'hard',
  'What is the capital of Tanzania?',
  'Dodoma is the capital of Tanzania.',
  '["Belmopan","Dodoma","Addis Ababa","Harare"]'::jsonb,
  1,
  'world-capitals.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q09',
  'world-capitals',
  'hard',
  'What is the capital of Nigeria?',
  'Abuja is the capital of Nigeria.',
  '["Abuja","Dakar","Montevideo","Georgetown"]'::jsonb,
  0,
  'world-capitals.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q10',
  'world-capitals',
  'hard',
  'What is the capital of Ghana?',
  'Accra is the capital of Ghana.',
  '["Windhoek","Asunción","Astana","Accra"]'::jsonb,
  3,
  'world-capitals.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q11',
  'world-capitals',
  'hard',
  'What is the capital of Ethiopia?',
  'Addis Ababa is the capital of Ethiopia.',
  '["Quito","Ulaanbaatar","Addis Ababa","Gaborone"]'::jsonb,
  2,
  'world-capitals.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q12',
  'world-capitals',
  'hard',
  'What is the capital of Senegal?',
  'Dakar is the capital of Senegal.',
  '["Thimphu","Dakar","Harare","Belmopan"]'::jsonb,
  1,
  'world-capitals.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q13',
  'world-capitals',
  'hard',
  'What is the capital of Namibia?',
  'Windhoek is the capital of Namibia.',
  '["Windhoek","Montevideo","Georgetown","Kathmandu"]'::jsonb,
  0,
  'world-capitals.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q14',
  'world-capitals',
  'hard',
  'What is the capital of Botswana?',
  'Gaborone is the capital of Botswana.',
  '["Asunción","Astana","Vientiane","Gaborone"]'::jsonb,
  3,
  'world-capitals.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q15',
  'world-capitals',
  'hard',
  'What is the capital of Zimbabwe?',
  'Harare is the capital of Zimbabwe.',
  '["Ulaanbaatar","Phnom Penh","Harare","Quito"]'::jsonb,
  2,
  'world-capitals.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q16',
  'world-capitals',
  'hard',
  'What is the capital of Uruguay?',
  'Montevideo is the capital of Uruguay.',
  '["Naypyidaw","Montevideo","Belmopan","Thimphu"]'::jsonb,
  1,
  'world-capitals.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q17',
  'world-capitals',
  'hard',
  'What is the capital of Paraguay?',
  'Asunción is the capital of Paraguay.',
  '["Asunción","Georgetown","Kathmandu","Dodoma"]'::jsonb,
  0,
  'world-capitals.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q18',
  'world-capitals',
  'hard',
  'What is the capital of Ecuador?',
  'Quito is the capital of Ecuador.',
  '["Astana","Vientiane","Abuja","Quito"]'::jsonb,
  3,
  'world-capitals.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q19',
  'world-capitals',
  'hard',
  'What is the capital of Belize?',
  'Belmopan is the capital of Belize.',
  '["Phnom Penh","Accra","Belmopan","Ulaanbaatar"]'::jsonb,
  2,
  'world-capitals.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-capitals.hard.set1.q20',
  'world-capitals',
  'hard',
  'What is the capital of Guyana?',
  'Georgetown is the capital of Guyana.',
  '["Addis Ababa","Georgetown","Thimphu","Naypyidaw"]'::jsonb,
  1,
  'world-capitals.hard.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q01',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇫🇷',
  '🇫🇷 is the flag of France.',
  '["France","Brazil","India","South Korea"]'::jsonb,
  0,
  'world-flags.easy.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q02',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇯🇵',
  '🇯🇵 is the flag of Japan.',
  '["Egypt","China","Thailand","Japan"]'::jsonb,
  3,
  'world-flags.easy.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q03',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇦🇺',
  '🇦🇺 is the flag of Australia.',
  '["Argentina","Greece","Australia","Spain"]'::jsonb,
  2,
  'world-flags.easy.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q04',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇨🇦',
  '🇨🇦 is the flag of Canada.',
  '["Portugal","Canada","Italy","Mexico"]'::jsonb,
  1,
  'world-flags.easy.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q05',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇧🇷',
  '🇧🇷 is the flag of Brazil.',
  '["Brazil","Germany","South Korea","Norway"]'::jsonb,
  0,
  'world-flags.easy.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q06',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇪🇬',
  '🇪🇬 is the flag of Egypt.',
  '["India","Thailand","Sweden","Egypt"]'::jsonb,
  3,
  'world-flags.easy.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q07',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇪🇸',
  '🇪🇸 is the flag of Spain.',
  '["Greece","Kenya","Spain","China"]'::jsonb,
  2,
  'world-flags.easy.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q08',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇮🇹',
  '🇮🇹 is the flag of Italy.',
  '["France","Italy","Argentina","Portugal"]'::jsonb,
  1,
  'world-flags.easy.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q09',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇩🇪',
  '🇩🇪 is the flag of Germany.',
  '["Germany","Mexico","Norway","Japan"]'::jsonb,
  0,
  'world-flags.easy.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q10',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇮🇳',
  '🇮🇳 is the flag of India.',
  '["South Korea","Sweden","Australia","India"]'::jsonb,
  3,
  'world-flags.easy.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q11',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇨🇳',
  '🇨🇳 is the flag of China.',
  '["Kenya","Canada","China","Thailand"]'::jsonb,
  2,
  'world-flags.easy.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q12',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇦🇷',
  '🇦🇷 is the flag of Argentina.',
  '["Brazil","Argentina","Greece","France"]'::jsonb,
  1,
  'world-flags.easy.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q13',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇲🇽',
  '🇲🇽 is the flag of Mexico.',
  '["Mexico","Portugal","Japan","Egypt"]'::jsonb,
  0,
  'world-flags.easy.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q14',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇰🇷',
  '🇰🇷 is the flag of South Korea.',
  '["Norway","Australia","Spain","South Korea"]'::jsonb,
  3,
  'world-flags.easy.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q15',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇹🇭',
  '🇹🇭 is the flag of Thailand.',
  '["Canada","Italy","Thailand","Sweden"]'::jsonb,
  2,
  'world-flags.easy.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q16',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇬🇷',
  '🇬🇷 is the flag of Greece.',
  '["Germany","Greece","Kenya","Brazil"]'::jsonb,
  1,
  'world-flags.easy.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q17',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇵🇹',
  '🇵🇹 is the flag of Portugal.',
  '["Portugal","France","Egypt","India"]'::jsonb,
  0,
  'world-flags.easy.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q18',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇳🇴',
  '🇳🇴 is the flag of Norway.',
  '["Japan","Spain","China","Norway"]'::jsonb,
  3,
  'world-flags.easy.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q19',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇸🇪',
  '🇸🇪 is the flag of Sweden.',
  '["Italy","Argentina","Sweden","Australia"]'::jsonb,
  2,
  'world-flags.easy.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-flags.easy.set1.q20',
  'world-flags',
  'easy',
  'Which country does this flag represent? 🇰🇪',
  '🇰🇪 is the flag of Kenya.',
  '["Mexico","Kenya","Canada","Germany"]'::jsonb,
  1,
  'world-flags.easy.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q01',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇲🇦',
  '🇲🇦 is the flag of Morocco.',
  '["Morocco","Philippines","Belgium","Hungary"]'::jsonb,
  0,
  'world-flags.medium.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q02',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇹🇷',
  '🇹🇷 is the flag of Turkey.',
  '["New Zealand","Netherlands","Romania","Turkey"]'::jsonb,
  3,
  'world-flags.medium.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q03',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇻🇳',
  '🇻🇳 is the flag of Vietnam.',
  '["Poland","Bulgaria","Vietnam","Ireland"]'::jsonb,
  2,
  'world-flags.medium.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q04',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇮🇩',
  '🇮🇩 is the flag of Indonesia.',
  '["Finland","Indonesia","Austria","Czechia"]'::jsonb,
  1,
  'world-flags.medium.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q05',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇵🇭',
  '🇵🇭 is the flag of Philippines.',
  '["Philippines","Switzerland","Hungary","Denmark"]'::jsonb,
  0,
  'world-flags.medium.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q06',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇳🇿',
  '🇳🇿 is the flag of New Zealand.',
  '["Belgium","Romania","Peru","New Zealand"]'::jsonb,
  3,
  'world-flags.medium.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q07',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇮🇪',
  '🇮🇪 is the flag of Ireland.',
  '["Bulgaria","Colombia","Ireland","Netherlands"]'::jsonb,
  2,
  'world-flags.medium.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q08',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇦🇹',
  '🇦🇹 is the flag of Austria.',
  '["Morocco","Austria","Poland","Finland"]'::jsonb,
  1,
  'world-flags.medium.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q09',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇨🇭',
  '🇨🇭 is the flag of Switzerland.',
  '["Switzerland","Czechia","Denmark","Turkey"]'::jsonb,
  0,
  'world-flags.medium.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q10',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇧🇪',
  '🇧🇪 is the flag of Belgium.',
  '["Hungary","Peru","Vietnam","Belgium"]'::jsonb,
  3,
  'world-flags.medium.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q11',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇳🇱',
  '🇳🇱 is the flag of Netherlands.',
  '["Colombia","Indonesia","Netherlands","Romania"]'::jsonb,
  2,
  'world-flags.medium.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q12',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇵🇱',
  '🇵🇱 is the flag of Poland.',
  '["Philippines","Poland","Bulgaria","Morocco"]'::jsonb,
  1,
  'world-flags.medium.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q13',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇨🇿',
  '🇨🇿 is the flag of Czechia.',
  '["Czechia","Finland","Turkey","New Zealand"]'::jsonb,
  0,
  'world-flags.medium.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q14',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇭🇺',
  '🇭🇺 is the flag of Hungary.',
  '["Denmark","Vietnam","Ireland","Hungary"]'::jsonb,
  3,
  'world-flags.medium.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q15',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇷🇴',
  '🇷🇴 is the flag of Romania.',
  '["Indonesia","Austria","Romania","Peru"]'::jsonb,
  2,
  'world-flags.medium.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q16',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇧🇬',
  '🇧🇬 is the flag of Bulgaria.',
  '["Switzerland","Bulgaria","Colombia","Philippines"]'::jsonb,
  1,
  'world-flags.medium.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q17',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇫🇮',
  '🇫🇮 is the flag of Finland.',
  '["Finland","Morocco","New Zealand","Belgium"]'::jsonb,
  0,
  'world-flags.medium.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q18',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇩🇰',
  '🇩🇰 is the flag of Denmark.',
  '["Turkey","Ireland","Netherlands","Denmark"]'::jsonb,
  3,
  'world-flags.medium.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q19',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇵🇪',
  '🇵🇪 is the flag of Peru.',
  '["Austria","Poland","Peru","Vietnam"]'::jsonb,
  2,
  'world-flags.medium.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-flags.medium.set1.q20',
  'world-flags',
  'medium',
  'Which country does this flag represent? 🇨🇴',
  '🇨🇴 is the flag of Colombia.',
  '["Czechia","Colombia","Indonesia","Switzerland"]'::jsonb,
  1,
  'world-flags.medium.set1.v1',
  20
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q01',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇰🇿',
  '🇰🇿 is the flag of Kazakhstan.',
  '["Kazakhstan","Laos","Ghana","Botswana"]'::jsonb,
  0,
  'world-flags.hard.set1.v1',
  1
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q02',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇲🇳',
  '🇲🇳 is the flag of Mongolia.',
  '["Cambodia","Ethiopia","Zimbabwe","Mongolia"]'::jsonb,
  3,
  'world-flags.hard.set1.v1',
  2
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q03',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇧🇹',
  '🇧🇹 is the flag of Bhutan.',
  '["Senegal","Uruguay","Bhutan","Myanmar"]'::jsonb,
  2,
  'world-flags.hard.set1.v1',
  3
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q04',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇳🇵',
  '🇳🇵 is the flag of Nepal.',
  '["Paraguay","Nepal","Tanzania","Namibia"]'::jsonb,
  1,
  'world-flags.hard.set1.v1',
  4
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q05',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇱🇦',
  '🇱🇦 is the flag of Laos.',
  '["Laos","Nigeria","Botswana","Ecuador"]'::jsonb,
  0,
  'world-flags.hard.set1.v1',
  5
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q06',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇰🇭',
  '🇰🇭 is the flag of Cambodia.',
  '["Ghana","Zimbabwe","Belize","Cambodia"]'::jsonb,
  3,
  'world-flags.hard.set1.v1',
  6
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q07',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇲🇲',
  '🇲🇲 is the flag of Myanmar.',
  '["Uruguay","Guyana","Myanmar","Ethiopia"]'::jsonb,
  2,
  'world-flags.hard.set1.v1',
  7
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q08',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇹🇿',
  '🇹🇿 is the flag of Tanzania.',
  '["Kazakhstan","Tanzania","Senegal","Paraguay"]'::jsonb,
  1,
  'world-flags.hard.set1.v1',
  8
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q09',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇳🇬',
  '🇳🇬 is the flag of Nigeria.',
  '["Nigeria","Namibia","Ecuador","Mongolia"]'::jsonb,
  0,
  'world-flags.hard.set1.v1',
  9
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q10',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇬🇭',
  '🇬🇭 is the flag of Ghana.',
  '["Botswana","Belize","Bhutan","Ghana"]'::jsonb,
  3,
  'world-flags.hard.set1.v1',
  10
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q11',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇪🇹',
  '🇪🇹 is the flag of Ethiopia.',
  '["Guyana","Nepal","Ethiopia","Zimbabwe"]'::jsonb,
  2,
  'world-flags.hard.set1.v1',
  11
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q12',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇸🇳',
  '🇸🇳 is the flag of Senegal.',
  '["Laos","Senegal","Uruguay","Kazakhstan"]'::jsonb,
  1,
  'world-flags.hard.set1.v1',
  12
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q13',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇳🇦',
  '🇳🇦 is the flag of Namibia.',
  '["Namibia","Paraguay","Mongolia","Cambodia"]'::jsonb,
  0,
  'world-flags.hard.set1.v1',
  13
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q14',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇧🇼',
  '🇧🇼 is the flag of Botswana.',
  '["Ecuador","Bhutan","Myanmar","Botswana"]'::jsonb,
  3,
  'world-flags.hard.set1.v1',
  14
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q15',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇿🇼',
  '🇿🇼 is the flag of Zimbabwe.',
  '["Nepal","Tanzania","Zimbabwe","Belize"]'::jsonb,
  2,
  'world-flags.hard.set1.v1',
  15
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q16',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇺🇾',
  '🇺🇾 is the flag of Uruguay.',
  '["Nigeria","Uruguay","Guyana","Laos"]'::jsonb,
  1,
  'world-flags.hard.set1.v1',
  16
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q17',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇵🇾',
  '🇵🇾 is the flag of Paraguay.',
  '["Paraguay","Kazakhstan","Cambodia","Ghana"]'::jsonb,
  0,
  'world-flags.hard.set1.v1',
  17
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q18',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇪🇨',
  '🇪🇨 is the flag of Ecuador.',
  '["Mongolia","Myanmar","Ethiopia","Ecuador"]'::jsonb,
  3,
  'world-flags.hard.set1.v1',
  18
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q19',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇧🇿',
  '🇧🇿 is the flag of Belize.',
  '["Tanzania","Senegal","Belize","Bhutan"]'::jsonb,
  2,
  'world-flags.hard.set1.v1',
  19
);

select public._seed_brainilab_question_v18(
  'world-flags.hard.set1.q20',
  'world-flags',
  'hard',
  'Which country does this flag represent? 🇬🇾',
  '🇬🇾 is the flag of Guyana.',
  '["Namibia","Guyana","Nepal","Nigeria"]'::jsonb,
  1,
  'world-flags.hard.set1.v1',
  20
);

-- ============================================================
-- PUBLISH ONLY COMPLETE 20-QUESTION PACKS
-- ============================================================

update public.quiz_packs qp
set status='published'
where qp.external_key in (
  select qp2.external_key
  from public.quiz_packs qp2
  join public.quiz_pack_questions qpq
    on qpq.quiz_pack_id=qp2.id
  group by qp2.id,qp2.external_key
  having count(*)=20
)
and qp.status <> 'published';



-- ============================================================
-- VERIFIED QUIZ CORRECTNESS
-- Step 3 stored scores as client-submitted and server_verified=false.
-- Step 4 can now verify which answers were actually correct because the
-- correct options live only in PostgreSQL.
-- ============================================================

alter table public.game_results
  add column if not exists answers_verified boolean not null default false;

alter table public.game_results
  add column if not exists verified_correct_answers integer null;

alter table public.game_results
  add column if not exists verified_total_questions integer null;

alter table public.game_results
  add column if not exists answers_verified_at timestamptz null;


create or replace function public.verify_brainilab_quiz_result(
  p_client_result_id text,
  p_quiz_pack_id uuid,
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
  v_pack_count integer;
  v_answer_count integer;
  v_correct integer := 0;
  v_pack_question record;
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

  select gs.id,gr.id
    into v_session_id,v_result_id
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_user_id
    and gs.client_result_id=p_client_result_id
  limit 1;

  if v_result_id is null then
    raise exception 'Game result not found';
  end if;

  select count(*)
    into v_pack_count
  from public.quiz_pack_questions qpq
  join public.quiz_packs qp on qp.id=qpq.quiz_pack_id
  where qpq.quiz_pack_id=p_quiz_pack_id
    and qp.status='published';

  if v_pack_count <> 20 then
    raise exception 'Published quiz pack is not valid';
  end if;

  v_answer_count := jsonb_array_length(p_answers);

  if v_answer_count <> v_pack_count then
    raise exception 'Expected % submitted answers, got %',v_pack_count,v_answer_count;
  end if;

  for v_pack_question in
    select
      qpq.position,
      qpq.question_version_id
    from public.quiz_pack_questions qpq
    where qpq.quiz_pack_id=p_quiz_pack_id
    order by qpq.position
  loop
    select value
      into v_answer
    from jsonb_array_elements(p_answers)
    where value ->> 'question_version_id'
      = v_pack_question.question_version_id::text
    limit 1;

    if v_answer is null then
      raise exception 'Missing answer for pack position %',v_pack_question.position;
    end if;

    -- Null is a valid skip.
    if nullif(v_answer ->> 'selected_option_id','') is null then
      v_selected_option_id := null;
      v_is_correct := false;
    else
      begin
        v_selected_option_id := (v_answer ->> 'selected_option_id')::uuid;
      exception when others then
        raise exception 'Invalid option ID at position %',v_pack_question.position;
      end;

      select qo.is_correct
        into v_is_correct
      from public.question_options qo
      where qo.id=v_selected_option_id
        and qo.question_version_id=v_pack_question.question_version_id;

      if v_is_correct is null then
        raise exception 'Option does not belong to question at position %',v_pack_question.position;
      end if;
    end if;

    if v_is_correct then
      v_correct := v_correct + 1;
    end if;
  end loop;

  update public.game_results
  set
    correct_answers=v_correct,
    total_questions=v_pack_count,
    accuracy=round((v_correct::numeric / v_pack_count::numeric)*100,2),
    answers_verified=true,
    verified_correct_answers=v_correct,
    verified_total_questions=v_pack_count,
    answers_verified_at=now()
  where id=v_result_id;

  return jsonb_build_object(
    'answers_verified',true,
    'correct_answers',v_correct,
    'total_questions',v_pack_count,
    'accuracy',round((v_correct::numeric / v_pack_count::numeric)*100,2),
    'server_score_verified',false
  );
end;
$$;

revoke execute on function public.verify_brainilab_quiz_result(text,uuid,jsonb)
  from public,anon;

grant execute on function public.verify_brainilab_quiz_result(text,uuid,jsonb)
  to authenticated;


-- Seed helper is migration-only.
drop function if exists public._seed_brainilab_question_v18(
  text,text,text,text,text,jsonb,integer,text,integer
);

commit;


-- ============================================================
-- VERIFICATION QUERIES
-- Run separately after migration.
-- ============================================================
--
-- select count(*) as topics from public.topics;
-- select count(*) as questions from public.questions;
-- select count(*) as versions from public.question_versions;
-- select count(*) as options from public.question_options;
-- select count(*) as packs from public.quiz_packs where status='published';
--
-- Expected initial content:
-- questions = 360
-- versions  = 360
-- options   = 1440
-- packs     = 18
--
-- Pack integrity:
-- select
--   qp.title,
--   count(qpq.question_version_id) as questions
-- from public.quiz_packs qp
-- join public.quiz_pack_questions qpq on qpq.quiz_pack_id=qp.id
-- where qp.status='published'
-- group by qp.id,qp.title
-- order by qp.title;
