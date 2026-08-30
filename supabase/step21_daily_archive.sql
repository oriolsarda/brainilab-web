-- BrainiLab Step 21 — Past Daily archive / Play Anytime
-- V41.3.0
--
-- Adds read-only date-addressable Daily loaders for dates before today and
-- allows answer/round checks against any already-published Daily challenge.
-- Final Daily verification RPCs are intentionally unchanged: archive replays
-- are practice-only in the web client and do not affect today's Daily score,
-- streak, XP cloud progression or rankings.

-- ============================================================
-- BRAIN MIX — ARCHIVE LOADER
-- ============================================================
create or replace function public.get_brainilab_daily_challenge_archive(
  p_challenge_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daily public.daily_challenges%rowtype;
  v_questions jsonb;
begin
  if p_challenge_date is null or p_challenge_date >= current_date then
    return null;
  end if;

  select dc.*
    into v_daily
  from public.daily_challenges dc
  where dc.challenge_date = p_challenge_date
    and dc.status = 'published'
  order by dc.generation_version desc
  limit 1;

  if v_daily.id is null then return null; end if;

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
            jsonb_build_object('id',qo.id,'text',qo.option_text)
            order by qo.position
          )
          from public.question_options qo
          where qo.question_version_id=qv.id
        )
      ) order by dcq.position
    ),
    '[]'::jsonb
  ) into v_questions
  from public.daily_challenge_questions dcq
  join public.question_versions qv on qv.id=dcq.question_version_id
  join public.questions q on q.id=qv.question_id
  join public.topics t on t.id=qv.primary_topic_id
  where dcq.daily_challenge_id=v_daily.id
    and q.status='active'
    and qv.status='published';

  if jsonb_array_length(v_questions)<>10 then
    raise exception 'Archived Daily Challenge is incomplete';
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

revoke execute on function public.get_brainilab_daily_challenge_archive(date) from public;
grant execute on function public.get_brainilab_daily_challenge_archive(date) to anon,authenticated;

-- ============================================================
-- ORDER UP — ARCHIVE LOADER
-- ============================================================
create or replace function public.get_brainilab_daily_order_up_archive(
  p_challenge_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_payload jsonb;
begin
  if p_challenge_date is null or p_challenge_date >= (now() at time zone 'UTC')::date then
    return null;
  end if;

  select jsonb_build_object(
    'daily_challenge_id',dc.id,
    'daily_number',dc.daily_number,
    'challenge_date',dc.challenge_date,
    'rounds',(
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'round_id',our.id,
            'position',dour.position,
            'title',our.title,
            'prompt',our.prompt,
            'direction_label',our.direction_label,
            'items',(
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('item_id',oui.id,'label',oui.label)
                  order by md5(
                    oui.id::text||':'||dc.challenge_date::text||':'||dour.position::text
                  )
                ),
                '[]'::jsonb
              )
              from public.order_up_items oui
              where oui.round_id=our.id
            )
          ) order by dour.position
        ),
        '[]'::jsonb
      )
      from public.daily_order_up_rounds dour
      join public.order_up_rounds our on our.id=dour.round_id
      where dour.daily_challenge_id=dc.id
    )
  ) into v_payload
  from public.daily_challenges dc
  where dc.challenge_date=p_challenge_date
    and dc.status='published'
  order by dc.generation_version desc
  limit 1;

  if v_payload is null then return null; end if;
  if jsonb_array_length(v_payload->'rounds')<>2 then
    raise exception 'Archived Order Up is incomplete';
  end if;
  return v_payload;
end;
$$;

revoke execute on function public.get_brainilab_daily_order_up_archive(date) from public;
grant execute on function public.get_brainilab_daily_order_up_archive(date) to anon,authenticated;

-- Allow round checks for published historical Dailies as well as today.
create or replace function public.check_brainilab_order_up_round(
  p_daily_challenge_id uuid,
  p_round_id uuid,
  p_item_ids jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_today date:=(now() at time zone 'UTC')::date;
  v_eval jsonb;
begin
  if not exists(
    select 1
    from public.daily_challenges dc
    join public.daily_order_up_rounds dour on dour.daily_challenge_id=dc.id
    where dc.id=p_daily_challenge_id
      and dc.challenge_date<=v_today
      and dc.status='published'
      and dour.round_id=p_round_id
  ) then
    raise exception 'Order Up round is not part of an available Daily';
  end if;

  v_eval:=public.brainilab_score_order_up_round(p_round_id,p_item_ids);
  return v_eval;
end;
$$;

revoke execute on function public.check_brainilab_order_up_round(uuid,uuid,jsonb) from public;
grant execute on function public.check_brainilab_order_up_round(uuid,uuid,jsonb) to anon,authenticated;

-- ============================================================
-- TOPIC RUSH — ARCHIVE LOADER + HISTORICAL ANSWER CHECK
-- ============================================================
create or replace function public.get_brainilab_daily_topic_rush_archive(
  p_challenge_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_row record;
begin
  if p_challenge_date is null or p_challenge_date >= current_date then
    return null;
  end if;

  select
    dc.id as daily_challenge_id,
    dc.daily_number,
    dc.challenge_date,
    trt.id as topic_id,
    trt.title,
    trt.prompt,
    trt.target_count,
    trs.duration_seconds
  into v_row
  from public.daily_challenges dc
  join public.daily_topic_rush dtr on dtr.daily_challenge_id=dc.id
  join public.topic_rush_topics trt on trt.id=dtr.topic_id
  cross join public.topic_rush_settings trs
  where dc.challenge_date=p_challenge_date
    and dc.status='published'
    and trs.singleton=true
    and p_challenge_date>=trs.launch_date
  order by dc.generation_version desc
  limit 1;

  if v_row.daily_challenge_id is null then return null; end if;

  return jsonb_build_object(
    'daily_challenge_id',v_row.daily_challenge_id,
    'daily_number',v_row.daily_number,
    'challenge_date',v_row.challenge_date,
    'topic_id',v_row.topic_id,
    'title',v_row.title,
    'prompt',v_row.prompt,
    'target_count',v_row.target_count,
    'duration_seconds',v_row.duration_seconds
  );
end;
$$;

revoke execute on function public.get_brainilab_daily_topic_rush_archive(date) from public;
grant execute on function public.get_brainilab_daily_topic_rush_archive(date) to anon,authenticated;

create or replace function public.check_brainilab_topic_rush_answer(
  p_daily_challenge_id uuid,
  p_guess text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_norm text;
  v_answer record;
begin
  v_norm:=public.brainilab_normalize_topic_rush_answer(p_guess);
  if char_length(v_norm)<2 then
    return jsonb_build_object('valid',false,'reason','too_short');
  end if;

  select tra.id,tra.answer_text
  into v_answer
  from public.daily_topic_rush dtr
  join public.topic_rush_answers tra on tra.topic_id=dtr.topic_id
  join public.daily_challenges dc on dc.id=dtr.daily_challenge_id
  where dtr.daily_challenge_id=p_daily_challenge_id
    and dc.challenge_date<=current_date
    and dc.status='published'
    and (
      tra.normalized_answer=v_norm
      or v_norm=any(tra.normalized_aliases)
    )
  limit 1;

  if v_answer.id is null then
    return jsonb_build_object('valid',false,'reason','not_in_list');
  end if;

  return jsonb_build_object(
    'valid',true,
    'answer_id',v_answer.id,
    'canonical_answer',v_answer.answer_text
  );
end;
$$;

revoke execute on function public.check_brainilab_topic_rush_answer(uuid,text) from public;
grant execute on function public.check_brainilab_topic_rush_answer(uuid,text) to anon,authenticated;

-- ============================================================
-- BRAINIWORD — ARCHIVE LOADER + HISTORICAL GUESS CHECK
-- ============================================================
create or replace function public.get_brainilab_daily_brainiword_archive(
  p_challenge_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_daily record;
begin
  if p_challenge_date is null or p_challenge_date >= current_date then
    return null;
  end if;

  select dc.id,dc.daily_number,dc.challenge_date
    into v_daily
  from public.daily_challenges dc
  join public.daily_brainiword dbw on dbw.daily_challenge_id=dc.id
  where dc.challenge_date=p_challenge_date
    and dc.status='published'
  order by dc.generation_version desc
  limit 1;

  if v_daily.id is null then return null; end if;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'daily_number',v_daily.daily_number,
    'challenge_date',v_daily.challenge_date,
    'letters',5,
    'attempts',5
  );
end;
$$;

revoke execute on function public.get_brainilab_daily_brainiword_archive(date) from public;
grant execute on function public.get_brainilab_daily_brainiword_archive(date) to anon,authenticated;

create or replace function public.check_brainilab_brainiword_guess(
  p_daily_challenge_id uuid,
  p_guess text,
  p_attempt integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_answer text;
  v_guess text:=upper(trim(p_guess));
  v_answer_chars text[];
  v_guess_chars text[];
  v_states text[]:=array['absent','absent','absent','absent','absent'];
  v_used boolean[]:=array[false,false,false,false,false];
  i integer;
  j integer;
  v_won boolean;
  v_finished boolean;
begin
  if v_guess !~ '^[A-Z]{5}$' then
    raise exception 'Guess must contain exactly five letters';
  end if;
  if p_attempt not between 1 and 5 then
    raise exception 'Invalid attempt';
  end if;

  select bw.word into v_answer
  from public.daily_brainiword dbw
  join public.daily_challenges dc on dc.id=dbw.daily_challenge_id
  join public.brainiword_words bw on bw.id=dbw.word_id
  where dbw.daily_challenge_id=p_daily_challenge_id
    and dc.challenge_date<=current_date
    and dc.status='published';

  if v_answer is null then
    raise exception 'BrainiWord Daily not available';
  end if;

  v_answer_chars:=array[
    substr(v_answer,1,1),substr(v_answer,2,1),substr(v_answer,3,1),
    substr(v_answer,4,1),substr(v_answer,5,1)
  ];
  v_guess_chars:=array[
    substr(v_guess,1,1),substr(v_guess,2,1),substr(v_guess,3,1),
    substr(v_guess,4,1),substr(v_guess,5,1)
  ];

  for i in 1..5 loop
    if v_guess_chars[i]=v_answer_chars[i] then
      v_states[i]:='correct';
      v_used[i]:=true;
    end if;
  end loop;

  for i in 1..5 loop
    if v_states[i]='correct' then continue; end if;
    for j in 1..5 loop
      if not v_used[j] and v_guess_chars[i]=v_answer_chars[j] then
        v_states[i]:='present';
        v_used[j]:=true;
        exit;
      end if;
    end loop;
  end loop;

  v_won:=v_guess=v_answer;
  v_finished:=v_won or p_attempt=5;

  return jsonb_build_object(
    'states',to_jsonb(v_states),
    'won',v_won,
    'finished',v_finished,
    'answer',case when v_finished then v_answer else null end
  );
end;
$$;

revoke execute on function public.check_brainilab_brainiword_guess(uuid,text,integer) from public;
grant execute on function public.check_brainilab_brainiword_guess(uuid,text,integer) to anon,authenticated;
