-- BrainiLab Step 23 — V41.5.0
-- Survival + Odd One Out + Higher or Lower + Content Pool CSV imports + Game Analytics
-- Run once AFTER Step 22.

begin;

create extension if not exists pgcrypto;

-- Step 22 compatibility / safety.
alter table public.game_results
  add column if not exists answers_verified boolean not null default false,
  add column if not exists verified_correct_answers integer null,
  add column if not exists verified_total_questions integer null,
  add column if not exists answers_verified_at timestamptz null;

alter table public.verified_question_answers
  drop constraint if exists verified_question_answers_context;
alter table public.verified_question_answers
  add constraint verified_question_answers_context
  check (context_type in ('quiz_pack','daily','anytime'));

create index if not exists verified_question_answers_user_question_idx
  on public.verified_question_answers(user_id,question_version_id,created_at desc);

-- ============================================================
-- SURVIVAL — history-aware mixed Question Bank loader
-- ============================================================
create or replace function public.get_brainilab_survival_game(
  p_exclude_question_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_questions jsonb;
begin
  with candidates as (
    select
      qv.id as question_version_id,
      qv.prompt,
      qv.difficulty,
      t.slug as topic,
      coalesce(h.play_count,0)
        + case when qv.id=any(coalesce(p_exclude_question_ids,array[]::uuid[])) then 1 else 0 end
        as effective_play_count,
      case
        when qv.id=any(coalesce(p_exclude_question_ids,array[]::uuid[])) then now()
        else h.last_played_at
      end as effective_last_played
    from public.question_versions qv
    join public.questions q on q.id=qv.question_id
    join public.topics t on t.id=qv.primary_topic_id
    left join lateral (
      select count(*)::integer as play_count,max(vqa.created_at) as last_played_at
      from public.verified_question_answers vqa
      where v_uid is not null
        and vqa.user_id=v_uid
        and vqa.question_version_id=qv.id
    ) h on true
    where qv.status='published'
      and q.status='active'
      and t.is_active=true
      and qv.difficulty in ('easy','medium','hard')
  ), ranked as (
    select c.*,
      row_number() over(
        partition by c.difficulty
        order by c.effective_play_count asc,c.effective_last_played asc nulls first,random()
      ) as rn
    from candidates c
  ), picked as (
    select * from ranked
    where (difficulty='easy' and rn<=10)
       or (difficulty='medium' and rn<=10)
       or (difficulty='hard' and rn<=10)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_version_id',p.question_version_id,
      'prompt',p.prompt,
      'difficulty',p.difficulty,
      'topic',p.topic,
      'options',(
        select jsonb_agg(jsonb_build_object('id',qo.id,'text',qo.option_text) order by qo.position)
        from public.question_options qo
        where qo.question_version_id=p.question_version_id
      )
    )
    order by case p.difficulty when 'easy' then 1 when 'medium' then 2 else 3 end,p.rn
  ),'[]'::jsonb)
  into v_questions
  from picked p;

  return jsonb_build_object('questions',v_questions,'total_questions',jsonb_array_length(v_questions));
end;
$$;
revoke execute on function public.get_brainilab_survival_game(uuid[]) from public;
grant execute on function public.get_brainilab_survival_game(uuid[]) to anon,authenticated;

create or replace function public.verify_brainilab_survival_result(
  p_client_result_id text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_session_id uuid;
  v_result_id uuid;
  v_item jsonb;
  v_qv uuid;
  v_selected uuid;
  v_topic_id uuid;
  v_difficulty text;
  v_is_correct boolean;
  v_response integer;
  v_correct integer:=0;
  v_total integer;
  v_mistakes integer:=0;
  v_combo integer:=0;
  v_score integer:=0;
  v_base integer;
  v_index integer:=0;
  v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb))<>'array' then raise exception 'Answers must be an array'; end if;
  v_total:=jsonb_array_length(p_answers);
  if v_total<1 or v_total>30 then raise exception 'Invalid Survival answer count'; end if;

  select gs.id,gr.id into v_session_id,v_result_id
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='survival'
  limit 1;
  if v_result_id is null then raise exception 'Survival result not found'; end if;

  for v_item in select value from jsonb_array_elements(p_answers) loop
    v_index:=v_index+1;
    v_qv:=(v_item->>'question_version_id')::uuid;
    if v_qv=any(v_seen) then raise exception 'Duplicate Survival question'; end if;
    v_seen:=array_append(v_seen,v_qv);

    select qv.primary_topic_id,qv.difficulty into v_topic_id,v_difficulty
    from public.question_versions qv join public.questions q on q.id=qv.question_id
    where qv.id=v_qv and qv.status='published' and q.status='active';
    if v_topic_id is null then raise exception 'Survival question unavailable'; end if;

    if nullif(v_item->>'selected_option_id','') is null then
      v_selected:=null; v_is_correct:=false;
    else
      v_selected:=(v_item->>'selected_option_id')::uuid;
      select qo.is_correct into v_is_correct
      from public.question_options qo where qo.id=v_selected and qo.question_version_id=v_qv;
      if v_is_correct is null then raise exception 'Option does not belong to Survival question'; end if;
    end if;

    v_response:=case when nullif(v_item->>'response_time_ms','') is null then null else greatest(0,(v_item->>'response_time_ms')::integer) end;
    if v_is_correct then
      v_correct:=v_correct+1; v_combo:=v_combo+1;
      v_base:=case v_difficulty when 'hard' then 200 when 'medium' then 150 else 100 end;
      v_score:=v_score+v_base+least(200,greatest(0,v_combo-1)*25);
    else
      v_mistakes:=v_mistakes+1; v_combo:=0;
    end if;

    insert into public.verified_question_answers(
      result_id,session_id,user_id,question_version_id,selected_option_id,is_correct,response_time_ms,context_type,context_id
    ) values(
      v_result_id,v_session_id,v_uid,v_qv,v_selected,coalesce(v_is_correct,false),v_response,'anytime',v_topic_id
    ) on conflict(result_id,question_version_id) do nothing;

    if v_mistakes>=3 and v_index<v_total then raise exception 'Survival answers continue after third lost life'; end if;
  end loop;

  update public.game_results set
    score=v_score,correct_answers=v_correct,total_questions=v_total,
    accuracy=round((v_correct::numeric/v_total::numeric)*100,2),
    answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=v_total,answers_verified_at=now()
  where id=v_result_id;

  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',v_total,'score',v_score,'accuracy',round((v_correct::numeric/v_total::numeric)*100,2));
end;
$$;
revoke execute on function public.verify_brainilab_survival_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_survival_result(text,jsonb) to authenticated;

-- ============================================================
-- ODD ONE OUT
-- ============================================================
create table if not exists public.odd_one_out_puzzles(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  category text not null default 'general',
  prompt text not null default 'Which one does not belong?',
  items jsonb not null,
  odd_index integer not null,
  explanation text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odd_one_out_key_format check (external_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint odd_one_out_items_count check (jsonb_typeof(items)='array' and jsonb_array_length(items)=4),
  constraint odd_one_out_index check (odd_index between 0 and 3)
);
create table if not exists public.player_odd_one_out_history(
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id uuid not null references public.odd_one_out_puzzles(id) on delete cascade,
  times_played integer not null default 1,
  first_played_at timestamptz not null default now(),
  last_played_at timestamptz not null default now(),
  primary key(user_id,puzzle_id)
);
create index if not exists player_odd_one_out_history_user_idx on public.player_odd_one_out_history(user_id,times_played,last_played_at);
alter table public.odd_one_out_puzzles enable row level security;
alter table public.player_odd_one_out_history enable row level security;
revoke all on table public.odd_one_out_puzzles from anon,authenticated;
revoke all on table public.player_odd_one_out_history from anon,authenticated;

create or replace function public.get_brainilab_odd_one_out_game(p_exclude_puzzle_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_payload jsonb;
begin
  with ranked as (
    select p.*,
      coalesce(h.times_played,0)+case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then 1 else 0 end as play_weight,
      case when p.id=any(coalesce(p_exclude_puzzle_ids,array[]::uuid[])) then now() else h.last_played_at end as last_weight
    from public.odd_one_out_puzzles p
    left join public.player_odd_one_out_history h on v_uid is not null and h.user_id=v_uid and h.puzzle_id=p.id
    where p.is_active=true
    order by play_weight asc,last_weight asc nulls first,random()
    limit 10
  )
  select jsonb_build_object('puzzles',coalesce(jsonb_agg(jsonb_build_object(
    'puzzle_id',id,'external_key',external_key,'category',category,'prompt',prompt,'items',items
  )),'[]'::jsonb)) into v_payload from ranked;
  return v_payload;
end;$$;
revoke execute on function public.get_brainilab_odd_one_out_game(uuid[]) from public;
grant execute on function public.get_brainilab_odd_one_out_game(uuid[]) to anon,authenticated;

create or replace function public.check_brainilab_odd_one_out_answer(p_puzzle_id uuid,p_item_index integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_odd integer; v_exp text;
begin
  select odd_index,explanation into v_odd,v_exp from public.odd_one_out_puzzles where id=p_puzzle_id and is_active=true;
  if v_odd is null then raise exception 'Odd One Out puzzle unavailable'; end if;
  if p_item_index not between 0 and 3 then raise exception 'Invalid item index'; end if;
  return jsonb_build_object('correct',p_item_index=v_odd,'correct_index',v_odd,'explanation',v_exp);
end;$$;
revoke execute on function public.check_brainilab_odd_one_out_answer(uuid,integer) from public;
grant execute on function public.check_brainilab_odd_one_out_answer(uuid,integer) to anon,authenticated;

create or replace function public.record_brainilab_odd_one_out_history(p_puzzle_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_count integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  for v_id in select distinct unnest(coalesce(p_puzzle_ids,array[]::uuid[])) loop
    if exists(select 1 from public.odd_one_out_puzzles where id=v_id and is_active=true) then
      insert into public.player_odd_one_out_history(user_id,puzzle_id,times_played,first_played_at,last_played_at)
      values(v_uid,v_id,1,now(),now())
      on conflict(user_id,puzzle_id) do update set times_played=public.player_odd_one_out_history.times_played+1,last_played_at=now();
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('recorded',v_count);
end;$$;
revoke execute on function public.record_brainilab_odd_one_out_history(uuid[]) from public,anon;
grant execute on function public.record_brainilab_odd_one_out_history(uuid[]) to authenticated;

create or replace function public.verify_brainilab_odd_one_out_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_result uuid; v_row jsonb; v_id uuid; v_selected integer; v_odd integer; v_correct integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Odd One Out requires exactly 10 rounds'; end if;
  select gr.id into v_result from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='oddoneout' limit 1;
  if v_result is null then raise exception 'Odd One Out result not found'; end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'puzzle_id')::uuid; v_selected:=(v_row->>'selected_index')::integer;
    if v_id=any(v_seen) then raise exception 'Duplicate Odd One Out puzzle'; end if; v_seen:=array_append(v_seen,v_id);
    select odd_index into v_odd from public.odd_one_out_puzzles where id=v_id;
    if v_odd is null or v_selected not between 0 and 3 then raise exception 'Invalid Odd One Out round'; end if;
    if v_selected=v_odd then v_correct:=v_correct+1; end if;
  end loop;
  update public.game_results set score=v_correct*100,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_correct*100);
end;$$;
revoke execute on function public.verify_brainilab_odd_one_out_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_odd_one_out_result(text,jsonb) to authenticated;

-- ============================================================
-- HIGHER OR LOWER
-- ============================================================
create table if not exists public.higher_lower_pairs(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  category text not null default 'general',
  metric text not null,
  left_label text not null,
  left_value numeric not null,
  right_label text not null,
  right_value numeric not null,
  unit text not null default '',
  explanation text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint higher_lower_key_format check (external_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint higher_lower_not_tie check (left_value<>right_value)
);
create table if not exists public.player_higher_lower_history(
  user_id uuid not null references auth.users(id) on delete cascade,
  pair_id uuid not null references public.higher_lower_pairs(id) on delete cascade,
  times_played integer not null default 1,
  first_played_at timestamptz not null default now(),
  last_played_at timestamptz not null default now(),
  primary key(user_id,pair_id)
);
create index if not exists player_higher_lower_history_user_idx on public.player_higher_lower_history(user_id,times_played,last_played_at);
alter table public.higher_lower_pairs enable row level security;
alter table public.player_higher_lower_history enable row level security;
revoke all on table public.higher_lower_pairs from anon,authenticated;
revoke all on table public.player_higher_lower_history from anon,authenticated;

create or replace function public.get_brainilab_higher_lower_game(p_exclude_pair_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_payload jsonb;
begin
  with ranked as (
    select p.*,
      coalesce(h.times_played,0)+case when p.id=any(coalesce(p_exclude_pair_ids,array[]::uuid[])) then 1 else 0 end as play_weight,
      case when p.id=any(coalesce(p_exclude_pair_ids,array[]::uuid[])) then now() else h.last_played_at end as last_weight
    from public.higher_lower_pairs p
    left join public.player_higher_lower_history h on v_uid is not null and h.user_id=v_uid and h.pair_id=p.id
    where p.is_active=true
    order by play_weight asc,last_weight asc nulls first,random()
    limit 10
  )
  select jsonb_build_object('pairs',coalesce(jsonb_agg(jsonb_build_object(
    'pair_id',id,'external_key',external_key,'category',category,'metric',metric,
    'left_label',left_label,'left_value',left_value,'right_label',right_label,'unit',unit
  )),'[]'::jsonb)) into v_payload from ranked;
  return v_payload;
end;$$;
revoke execute on function public.get_brainilab_higher_lower_game(uuid[]) from public;
grant execute on function public.get_brainilab_higher_lower_game(uuid[]) to anon,authenticated;

create or replace function public.check_brainilab_higher_lower_answer(p_pair_id uuid,p_choice text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_left numeric; v_right numeric; v_exp text; v_direction text; v_choice text:=lower(btrim(coalesce(p_choice,'')));
begin
  if v_choice not in ('higher','lower') then raise exception 'Choice must be higher or lower'; end if;
  select left_value,right_value,explanation into v_left,v_right,v_exp from public.higher_lower_pairs where id=p_pair_id and is_active=true;
  if v_left is null then raise exception 'Higher or Lower pair unavailable'; end if;
  v_direction:=case when v_right>v_left then 'higher' else 'lower' end;
  return jsonb_build_object('correct',v_choice=v_direction,'direction',v_direction,'right_value',v_right,'explanation',v_exp);
end;$$;
revoke execute on function public.check_brainilab_higher_lower_answer(uuid,text) from public;
grant execute on function public.check_brainilab_higher_lower_answer(uuid,text) to anon,authenticated;

create or replace function public.record_brainilab_higher_lower_history(p_pair_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_count integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  for v_id in select distinct unnest(coalesce(p_pair_ids,array[]::uuid[])) loop
    if exists(select 1 from public.higher_lower_pairs where id=v_id and is_active=true) then
      insert into public.player_higher_lower_history(user_id,pair_id,times_played,first_played_at,last_played_at)
      values(v_uid,v_id,1,now(),now())
      on conflict(user_id,pair_id) do update set times_played=public.player_higher_lower_history.times_played+1,last_played_at=now();
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('recorded',v_count);
end;$$;
revoke execute on function public.record_brainilab_higher_lower_history(uuid[]) from public,anon;
grant execute on function public.record_brainilab_higher_lower_history(uuid[]) to authenticated;

create or replace function public.verify_brainilab_higher_lower_result(p_client_result_id text,p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_result uuid; v_row jsonb; v_id uuid; v_choice text; v_left numeric; v_right numeric; v_direction text; v_correct integer:=0; v_combo integer:=0; v_score integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array' or jsonb_array_length(p_rounds)<>10 then raise exception 'Higher or Lower requires exactly 10 rounds'; end if;
  select gr.id into v_result from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id where gs.user_id=v_uid and gs.client_result_id=p_client_result_id and gs.game_id='higherlower' limit 1;
  if v_result is null then raise exception 'Higher or Lower result not found'; end if;
  for v_row in select value from jsonb_array_elements(p_rounds) loop
    v_id:=(v_row->>'pair_id')::uuid; v_choice:=lower(btrim(v_row->>'choice'));
    if v_id=any(v_seen) then raise exception 'Duplicate Higher or Lower pair'; end if; v_seen:=array_append(v_seen,v_id);
    if v_choice not in ('higher','lower') then raise exception 'Invalid Higher or Lower choice'; end if;
    select left_value,right_value into v_left,v_right from public.higher_lower_pairs where id=v_id;
    if v_left is null then raise exception 'Higher or Lower pair not found'; end if;
    v_direction:=case when v_right>v_left then 'higher' else 'lower' end;
    if v_choice=v_direction then v_correct:=v_correct+1; v_combo:=v_combo+1; v_score:=v_score+100+least(100,greatest(0,v_combo-1)*20); else v_combo:=0; end if;
  end loop;
  update public.game_results set score=v_score,correct_answers=v_correct,total_questions=10,accuracy=v_correct*10,answers_verified=true,verified_correct_answers=v_correct,verified_total_questions=10,answers_verified_at=now() where id=v_result;
  return jsonb_build_object('answers_verified',true,'correct_answers',v_correct,'total_questions',10,'accuracy',v_correct*10,'score',v_score);
end;$$;
revoke execute on function public.verify_brainilab_higher_lower_result(text,jsonb) from public,anon;
grant execute on function public.verify_brainilab_higher_lower_result(text,jsonb) to authenticated;

-- ============================================================
-- ADMIN — Odd One Out / Higher or Lower
-- ============================================================
create or replace function public.admin_list_odd_one_out_puzzles()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid; v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'external_key',p.external_key,'category',p.category,'prompt',p.prompt,'items',p.items,'odd_index',p.odd_index,'explanation',p.explanation,'active',p.is_active,
    'play_count',(select coalesce(sum(h.times_played),0) from public.player_odd_one_out_history h where h.puzzle_id=p.id)
  ) order by p.is_active desc,p.category,p.external_key),'[]'::jsonb) into v_payload from public.odd_one_out_puzzles p;
  return v_payload;
end;$$;
revoke execute on function public.admin_list_odd_one_out_puzzles() from public,anon;
grant execute on function public.admin_list_odd_one_out_puzzles() to authenticated;

create or replace function public.admin_create_odd_one_out_puzzle(p_external_key text,p_category text,p_prompt text,p_items jsonb,p_odd_index integer,p_explanation text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  if lower(btrim(coalesce(p_external_key,''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid external key'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(p_items)<>4 then raise exception 'Odd One Out needs exactly 4 items'; end if;
  if p_odd_index not between 0 and 3 then raise exception 'Odd index must be 0–3'; end if;
  if (select count(distinct lower(btrim(x.value#>>'{}'))) from jsonb_array_elements(p_items) x)<>4 then raise exception 'Odd One Out items must be unique'; end if;
  insert into public.odd_one_out_puzzles(external_key,category,prompt,items,odd_index,explanation,is_active)
  values(lower(btrim(p_external_key)),lower(btrim(coalesce(p_category,'general'))),btrim(coalesce(nullif(p_prompt,''),'Which one does not belong?')),p_items,p_odd_index,btrim(coalesce(p_explanation,'')),true) returning id into v_id;
  perform public.log_brainilab_admin_action('ODD_ONE_OUT_CREATED','odd_one_out_puzzle',v_id::text,jsonb_build_object('external_key',p_external_key));
  return jsonb_build_object('id',v_id,'created',true);
end;$$;
revoke execute on function public.admin_create_odd_one_out_puzzle(text,text,text,jsonb,integer,text) from public,anon;
grant execute on function public.admin_create_odd_one_out_puzzle(text,text,text,jsonb,integer,text) to authenticated;

create or replace function public.admin_toggle_odd_one_out_puzzle(p_puzzle_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  update public.odd_one_out_puzzles set is_active=coalesce(p_active,false),updated_at=now() where id=p_puzzle_id;
  if not found then raise exception 'Odd One Out puzzle not found'; end if;
  return jsonb_build_object('id',p_puzzle_id,'active',p_active);
end;$$;
revoke execute on function public.admin_toggle_odd_one_out_puzzle(uuid,boolean) from public,anon;
grant execute on function public.admin_toggle_odd_one_out_puzzle(uuid,boolean) to authenticated;

create or replace function public.admin_list_higher_lower_pairs()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid; v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'external_key',p.external_key,'category',p.category,'metric',p.metric,'left_label',p.left_label,'left_value',p.left_value,'right_label',p.right_label,'right_value',p.right_value,'unit',p.unit,'explanation',p.explanation,'active',p.is_active,
    'play_count',(select coalesce(sum(h.times_played),0) from public.player_higher_lower_history h where h.pair_id=p.id)
  ) order by p.is_active desc,p.category,p.external_key),'[]'::jsonb) into v_payload from public.higher_lower_pairs p;
  return v_payload;
end;$$;
revoke execute on function public.admin_list_higher_lower_pairs() from public,anon;
grant execute on function public.admin_list_higher_lower_pairs() to authenticated;

create or replace function public.admin_create_higher_lower_pair(p_external_key text,p_category text,p_metric text,p_left_label text,p_left_value numeric,p_right_label text,p_right_value numeric,p_unit text default '',p_explanation text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  if lower(btrim(coalesce(p_external_key,''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid external key'; end if;
  if char_length(btrim(coalesce(p_metric,'')))<2 or char_length(btrim(coalesce(p_left_label,'')))<1 or char_length(btrim(coalesce(p_right_label,'')))<1 then raise exception 'Metric and both labels are required'; end if;
  if p_left_value=p_right_value then raise exception 'Higher or Lower values cannot tie'; end if;
  insert into public.higher_lower_pairs(external_key,category,metric,left_label,left_value,right_label,right_value,unit,explanation,is_active)
  values(lower(btrim(p_external_key)),lower(btrim(coalesce(p_category,'general'))),btrim(p_metric),btrim(p_left_label),p_left_value,btrim(p_right_label),p_right_value,btrim(coalesce(p_unit,'')),btrim(coalesce(p_explanation,'')),true) returning id into v_id;
  perform public.log_brainilab_admin_action('HIGHER_LOWER_CREATED','higher_lower_pair',v_id::text,jsonb_build_object('external_key',p_external_key));
  return jsonb_build_object('id',v_id,'created',true);
end;$$;
revoke execute on function public.admin_create_higher_lower_pair(text,text,text,text,numeric,text,numeric,text,text) from public,anon;
grant execute on function public.admin_create_higher_lower_pair(text,text,text,text,numeric,text,numeric,text,text) to authenticated;

create or replace function public.admin_toggle_higher_lower_pair(p_pair_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  update public.higher_lower_pairs set is_active=coalesce(p_active,false),updated_at=now() where id=p_pair_id;
  if not found then raise exception 'Higher or Lower pair not found'; end if;
  return jsonb_build_object('id',p_pair_id,'active',p_active);
end;$$;
revoke execute on function public.admin_toggle_higher_lower_pair(uuid,boolean) from public,anon;
grant execute on function public.admin_toggle_higher_lower_pair(uuid,boolean) to authenticated;

-- ============================================================
-- ADMIN — generic Content Pool CSV import target
-- Frontend parses CSV and sends normalized JSON rows here.
-- ============================================================
create or replace function public.admin_import_content_pool(p_pool_type text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_type text:=lower(btrim(coalesce(p_pool_type,''))); v_row jsonb; v_created integer:=0; v_failed integer:=0; v_errors jsonb:='[]'::jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then raise exception 'Import rows must be an array'; end if;
  if jsonb_array_length(p_rows)>500 then raise exception 'Import limit is 500 rows at a time'; end if;
  if v_type not in ('brainiword','topicrush','orderup','connections','oddoneout','higherlower') then raise exception 'Unsupported content pool type'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    begin
      case v_type
        when 'brainiword' then
          perform public.admin_add_brainiword_word(v_row->>'word');
        when 'topicrush' then
          perform public.admin_create_topic_rush_topic(v_row->>'external_key',v_row->>'title',v_row->>'prompt',(v_row->>'target_count')::integer,v_row->'answers');
        when 'orderup' then
          perform public.admin_create_order_up_round(v_row->>'external_key',v_row->>'title',v_row->>'prompt',v_row->>'direction_label',v_row->>'category',v_row->'items');
        when 'connections' then
          perform public.admin_create_connections_puzzle(v_row->>'external_key',v_row->>'category',v_row->>'prompt',v_row->'clues',v_row->>'correct_connection',v_row->'distractors',coalesce(v_row->>'explanation',''));
        when 'oddoneout' then
          perform public.admin_create_odd_one_out_puzzle(v_row->>'external_key',v_row->>'category',v_row->>'prompt',v_row->'items',(v_row->>'odd_index')::integer,coalesce(v_row->>'explanation',''));
        when 'higherlower' then
          perform public.admin_create_higher_lower_pair(v_row->>'external_key',v_row->>'category',v_row->>'metric',v_row->>'left_label',(v_row->>'left_value')::numeric,v_row->>'right_label',(v_row->>'right_value')::numeric,coalesce(v_row->>'unit',''),coalesce(v_row->>'explanation',''));
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
-- ADMIN — Game Analytics (completed cloud plays only; no fake abandonment)
-- ============================================================
create or replace function public.admin_get_game_analytics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid; v_days integer:=least(365,greatest(1,coalesce(p_days,30))); v_payload jsonb;
begin
  v_uid:=public.require_brainilab_admin(array['owner','editor']::text[]);
  with w as (
    select gs.game_id,gs.user_id,gs.completed_at,gr.score,gr.accuracy,gr.duration_ms,gr.answers_verified
    from public.game_sessions gs join public.game_results gr on gr.session_id=gs.id
    where gs.status='completed' and gs.completed_at>=now()-(v_days||' days')::interval
  ), per_game as (
    select game_id,count(*)::integer plays,count(distinct user_id)::integer unique_players,
      round(avg(score)::numeric,1) avg_score,round(avg(accuracy)::numeric,1) avg_accuracy,
      round((avg(duration_ms)/1000.0)::numeric,1) avg_duration_sec,max(completed_at) last_played,
      round((100.0*count(*) filter(where answers_verified=true)/nullif(count(*),0))::numeric,1) verified_pct
    from w group by game_id
  ), totals as (
    select count(*)::integer total_plays,count(distinct user_id)::integer unique_players,
      round(avg(accuracy)::numeric,1) avg_accuracy from w
  )
  select jsonb_build_object(
    'days',v_days,
    'summary',jsonb_build_object(
      'total_plays',coalesce((select total_plays from totals),0),
      'unique_players',coalesce((select unique_players from totals),0),
      'avg_accuracy',(select avg_accuracy from totals),
      'top_game',(select game_id from per_game order by plays desc,game_id limit 1)
    ),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'game_id',game_id,'plays',plays,'unique_players',unique_players,'avg_score',avg_score,'avg_accuracy',avg_accuracy,'avg_duration_sec',avg_duration_sec,'last_played',last_played,'verified_pct',verified_pct
    ) order by plays desc,game_id) from per_game),'[]'::jsonb)
  ) into v_payload;
  return v_payload;
end;$$;
revoke execute on function public.admin_get_game_analytics(integer) from public,anon;
grant execute on function public.admin_get_game_analytics(integer) to authenticated;

-- ============================================================
-- Seed helpers
-- ============================================================
create or replace function public._seed_brainilab_odd_one_out(p_key text,p_category text,p_prompt text,p_items jsonb,p_odd integer,p_explanation text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.odd_one_out_puzzles where external_key=p_key) then return; end if;
  insert into public.odd_one_out_puzzles(external_key,category,prompt,items,odd_index,explanation,is_active)
  values(p_key,p_category,p_prompt,p_items,p_odd,p_explanation,true);
end;$$;
create or replace function public._seed_brainilab_higher_lower(p_key text,p_category text,p_metric text,p_left text,p_left_value numeric,p_right text,p_right_value numeric,p_unit text,p_explanation text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.higher_lower_pairs where external_key=p_key) then return; end if;
  insert into public.higher_lower_pairs(external_key,category,metric,left_label,left_value,right_label,right_value,unit,explanation,is_active)
  values(p_key,p_category,p_metric,p_left,p_left_value,p_right,p_right_value,p_unit,p_explanation,true);
end;$$;
select public._seed_brainilab_odd_one_out('ooo-fruit-veg','general','Which one does not belong?',jsonb_build_array('Apple','Banana','Mango','Carrot'),3,'Carrot is a vegetable; the others are fruits.');
select public._seed_brainilab_odd_one_out('ooo-rivers-mountain','geography','Which one does not belong?',jsonb_build_array('Nile','Amazon','Yangtze','Everest'),3,'Everest is a mountain; the others are rivers.');
select public._seed_brainilab_odd_one_out('ooo-code-software','technology','Which one does not belong?',jsonb_build_array('Python','Java','Ruby','Photoshop'),3,'Photoshop is image-editing software; the others are programming languages.');
select public._seed_brainilab_odd_one_out('ooo-capitals','geography','Which one does not belong?',jsonb_build_array('Madrid','Rome','Lisbon','Barcelona'),3,'Barcelona is not a national capital; the others are.');
select public._seed_brainilab_odd_one_out('ooo-metals','science','Which one does not belong?',jsonb_build_array('Gold','Silver','Copper','Oxygen'),3,'Oxygen is a non-metal; the others are metals.');
select public._seed_brainilab_odd_one_out('ooo-artists','culture','Which one does not belong?',jsonb_build_array('Picasso','Monet','Van Gogh','Beethoven'),3,'Beethoven was primarily a composer; the others are painters.');
select public._seed_brainilab_odd_one_out('ooo-racket-sports','sports','Which one does not belong?',jsonb_build_array('Tennis','Badminton','Squash','Basketball'),3,'Basketball is not a racket sport.');
select public._seed_brainilab_odd_one_out('ooo-planets-moon','science','Which one does not belong?',jsonb_build_array('Saturn','Jupiter','Neptune','Europa'),3,'Europa is a moon of Jupiter; the others are planets.');
select public._seed_brainilab_odd_one_out('ooo-writers-composer','literature','Which one does not belong?',jsonb_build_array('Shakespeare','Dickens','Austen','Mozart'),3,'Mozart was a composer; the others are writers.');
select public._seed_brainilab_odd_one_out('ooo-asian-cities','geography','Which one does not belong?',jsonb_build_array('Tokyo','Seoul','Beijing','Sydney'),3,'Sydney is in Australia; the others are major East Asian capitals.');
select public._seed_brainilab_odd_one_out('ooo-units','science','Which one does not belong?',jsonb_build_array('Celsius','Kelvin','Fahrenheit','Kilogram'),3,'Kilogram measures mass; the others are temperature scales.');
select public._seed_brainilab_odd_one_out('ooo-birds','nature','Which one does not belong?',jsonb_build_array('Eagle','Falcon','Hawk','Dolphin'),3,'Dolphin is a mammal; the others are birds of prey.');
select public._seed_brainilab_odd_one_out('ooo-web-tech','technology','Which one does not belong?',jsonb_build_array('HTML','CSS','JavaScript','PostgreSQL'),3,'PostgreSQL is a database system; the others are core web-front-end technologies.');
select public._seed_brainilab_odd_one_out('ooo-europe','geography','Which one does not belong?',jsonb_build_array('France','Germany','Italy','Brazil'),3,'Brazil is in South America; the others are European countries.');
select public._seed_brainilab_odd_one_out('ooo-shapes','math','Which one does not belong?',jsonb_build_array('Triangle','Square','Pentagon','Sphere'),3,'Sphere is three-dimensional; the others are two-dimensional polygons.');
select public._seed_brainilab_odd_one_out('ooo-space','science','Which one does not belong?',jsonb_build_array('Mars','Venus','Jupiter','Europa'),3,'Europa is a moon; the others are planets.');
select public._seed_brainilab_odd_one_out('ooo-landforms','geography','Which one does not belong?',jsonb_build_array('Asia','Africa','Europe','Sahara'),3,'Sahara is a desert; the others are continents.');
select public._seed_brainilab_odd_one_out('ooo-team-sports','sports','Which one does not belong?',jsonb_build_array('Football','Basketball','Volleyball','Chess'),3,'Chess is not normally played as a team ball sport.');
select public._seed_brainilab_odd_one_out('ooo-scientists','science','Which one does not belong?',jsonb_build_array('Newton','Einstein','Curie','Shakespeare'),3,'Shakespeare was a playwright; the others are famous scientists.');
select public._seed_brainilab_odd_one_out('ooo-instruments','music','Which one does not belong?',jsonb_build_array('Violin','Cello','Guitar','Trumpet'),3,'Trumpet is a brass wind instrument; the others are string instruments.');
select public._seed_brainilab_higher_lower('hl-everest-k2','geography','Height','Mount Everest',8849,'K2',8611,'m','Everest is about 8,849 m high; K2 is about 8,611 m.');
select public._seed_brainilab_higher_lower('hl-earth-mars','science','Diameter','Earth',12742,'Mars',6779,'km','Earth is almost twice Mars''s diameter.');
select public._seed_brainilab_higher_lower('hl-jupiter-saturn','science','Equatorial diameter','Jupiter',142984,'Saturn',120536,'km','Jupiter is larger than Saturn by diameter.');
select public._seed_brainilab_higher_lower('hl-canada-china','geography','Total area','Canada',9984670,'China',9596961,'km²','Canada has a slightly larger total area than China.');
select public._seed_brainilab_higher_lower('hl-australia-india','geography','Total area','Australia',7692024,'India',3287263,'km²','Australia is more than twice India''s area.');
select public._seed_brainilab_higher_lower('hl-light-sound','science','Speed','Light in vacuum',299792458,'Sound in air',343,'m/s','Light is vastly faster than sound.');
select public._seed_brainilab_higher_lower('hl-water-iron','science','Temperature','Water boiling point',100,'Iron melting point',1538,'°C','Iron melts at a far higher temperature than water boils.');
select public._seed_brainilab_higher_lower('hl-pacific-atlantic','geography','Surface area','Pacific Ocean',165250000,'Atlantic Ocean',106460000,'km²','The Pacific is the world''s largest ocean.');
select public._seed_brainilab_higher_lower('hl-venus-mercury','science','Average surface temperature','Venus',464,'Mercury',167,'°C','Venus is hotter on average because of its dense greenhouse atmosphere.');
select public._seed_brainilab_higher_lower('hl-moon-iss','science','Distance from Earth''s surface','Moon',384400,'ISS',400,'km','The Moon is hundreds of thousands of kilometres away; the ISS orbits a few hundred kilometres up.');
select public._seed_brainilab_higher_lower('hl-titanic-moon','history','Year','Titanic sank',1912,'First Moon landing',1969,'year','Apollo 11 landed on the Moon in 1969, 57 years after Titanic sank.');
select public._seed_brainilab_higher_lower('hl-printing-phone','history','Approximate invention year','Gutenberg printing press',1450,'Telephone',1876,'year','The telephone came centuries after Gutenberg''s press.');
select public._seed_brainilab_higher_lower('hl-ww2-iphone','history','Year','World War II ended',1945,'First iPhone released',2007,'year','The first iPhone was released in 2007.');
select public._seed_brainilab_higher_lower('hl-beethoven-mozart','music','Birth year','Beethoven',1770,'Mozart',1756,'year','Mozart was born 14 years before Beethoven.');
select public._seed_brainilab_higher_lower('hl-whale-giraffe','nature','Typical maximum length/height','Blue whale',30,'Giraffe',5.5,'m','A blue whale can reach around 30 m; a giraffe is roughly 5–6 m tall.');
select public._seed_brainilab_higher_lower('hl-cheetah-lion','nature','Top speed','Cheetah',120,'Lion',80,'km/h','Cheetahs are the fastest land animals over short distances.');
select public._seed_brainilab_higher_lower('hl-human-chimp','science','Chromosome count','Human',46,'Chimpanzee',48,'chromosomes','Humans have 46 chromosomes; chimpanzees have 48.');
select public._seed_brainilab_higher_lower('hl-h-he','science','Atomic number','Hydrogen',1,'Helium',2,'','Hydrogen is element 1 and helium is element 2.');
select public._seed_brainilab_higher_lower('hl-gold-silver','science','Atomic number','Gold',79,'Silver',47,'','Gold is element 79; silver is element 47.');
select public._seed_brainilab_higher_lower('hl-fuji-montblanc','geography','Height','Mount Fuji',3776,'Mont Blanc',4806,'m','Mont Blanc is higher than Mount Fuji.');

drop function if exists public._seed_brainilab_odd_one_out(text,text,text,jsonb,integer,text);
drop function if exists public._seed_brainilab_higher_lower(text,text,text,text,numeric,text,numeric,text,text);

commit;

-- Verification:
-- select count(*) from public.odd_one_out_puzzles where is_active=true; -- expected >=20
-- select count(*) from public.higher_lower_pairs where is_active=true; -- expected >=20
