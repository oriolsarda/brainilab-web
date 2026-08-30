-- BrainiLab Backend — Step 19: Question Quality + difficulty calibration
-- Run after Step 18.
--
-- Adds editorial analytics for the Backoffice.
-- No player-facing scoring/ranking behavior changes.
-- No Cron.

begin;

-- ============================================================
-- ANALYTICS INDEXES
-- ============================================================

create index if not exists verified_question_answers_quality_idx
  on public.verified_question_answers(
    question_version_id,
    selected_option_id,
    is_correct
  );

create index if not exists verified_question_answers_context_created_idx
  on public.verified_question_answers(
    context_type,
    created_at desc
  );


-- ============================================================
-- QUESTION QUALITY OVERVIEW
-- ============================================================

create or replace function public.admin_question_quality_overview(
  p_topic_slug text default null,
  p_status text default 'published',
  p_min_attempts integer default 0,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_limit integer:=least(500,greatest(1,coalesce(p_limit,250)));
  v_min_attempts integer:=greatest(0,coalesce(p_min_attempts,0));
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  return (
    with base as (
      select
        qv.id as question_version_id,
        q.external_key,
        qv.prompt,
        qv.difficulty,
        qv.status,
        t.slug as topic_slug,
        t.name as topic_name,

        count(vqa.id)::integer as attempts,

        count(vqa.id) filter(
          where vqa.is_correct=true
        )::integer as correct,

        count(vqa.id) filter(
          where vqa.selected_option_id is null
        )::integer as skips,

        round(
          avg(
            case
              when vqa.is_correct then 100
              else 0
            end
          )::numeric,
          1
        ) as accuracy,

        round(
          (
            count(vqa.id) filter(
              where vqa.selected_option_id is null
            )::numeric
            /nullif(count(vqa.id),0)::numeric
          )*100,
          1
        ) as skip_rate,

        round(
          avg(vqa.response_time_ms) filter(
            where vqa.response_time_ms is not null
          )::numeric
        ) as avg_response_ms

      from public.question_versions qv

      join public.questions q
        on q.id=qv.question_id

      join public.topics t
        on t.id=qv.primary_topic_id

      left join public.verified_question_answers vqa
        on vqa.question_version_id=qv.id

      where
        (
          p_status is null
          or p_status=''
          or qv.status=p_status
        )
        and (
          p_topic_slug is null
          or p_topic_slug=''
          or t.slug=p_topic_slug
        )

      group by
        qv.id,
        q.external_key,
        qv.prompt,
        qv.difficulty,
        qv.status,
        t.slug,
        t.name
    ),

    enriched as (
      select
        b.*,

        case
          when b.attempts<30
            then 'insufficient_sample'

          when coalesce(b.skip_rate,0)>=20
            then 'review_skip_rate'

          when (
            b.difficulty='easy'
            and b.accuracy>=96
          ) or (
            b.difficulty='medium'
            and b.accuracy>=86
          ) or (
            b.difficulty='hard'
            and b.accuracy>=76
          )
            then 'too_easy'

          when (
            b.difficulty='easy'
            and b.accuracy<=54
          ) or (
            b.difficulty='medium'
            and b.accuracy<=34
          ) or (
            b.difficulty='hard'
            and b.accuracy<=14
          )
            then 'too_hard'

          when b.attempts>=50
            and (
              select count(*)
              from public.question_options qo
              where qo.question_version_id=b.question_version_id
                and qo.is_correct=false
                and (
                  select count(*)
                  from public.verified_question_answers x
                  where x.question_version_id=b.question_version_id
                    and x.selected_option_id=qo.id
                ) <= greatest(
                  2,
                  floor(b.attempts*0.03)::integer
                )
            )>=2
            then 'weak_distractors'

          else 'healthy'
        end as quality_state,

        case
          when b.attempts<30
            then null

          when b.accuracy>=75
            then 'easy'

          when b.accuracy>=40
            then 'medium'

          else 'hard'
        end as suggested_difficulty,

        case
          when b.attempts<50 then 0
          else (
            select count(*)::integer
            from public.question_options qo
            where qo.question_version_id=b.question_version_id
              and qo.is_correct=false
              and (
                select count(*)
                from public.verified_question_answers x
                where x.question_version_id=b.question_version_id
                  and x.selected_option_id=qo.id
              ) <= greatest(
                2,
                floor(b.attempts*0.03)::integer
              )
          )
        end as weak_distractor_count

      from base b

      where b.attempts>=v_min_attempts
    ),

    limited as (
      select *
      from enriched
      order by
        case quality_state
          when 'review_skip_rate' then 1
          when 'too_easy' then 2
          when 'too_hard' then 3
          when 'weak_distractors' then 4
          when 'insufficient_sample' then 5
          else 6
        end,
        attempts desc,
        prompt
      limit v_limit
    )

    select jsonb_build_object(
      'summary',
      (
        select jsonb_build_object(
          'questions',count(*),

          'healthy',
            count(*) filter(
              where quality_state='healthy'
            ),

          'needs_review',
            count(*) filter(
              where quality_state in (
                'review_skip_rate',
                'too_easy',
                'too_hard',
                'weak_distractors'
              )
            ),

          'insufficient_sample',
            count(*) filter(
              where quality_state='insufficient_sample'
            ),

          'too_easy',
            count(*) filter(
              where quality_state='too_easy'
            ),

          'too_hard',
            count(*) filter(
              where quality_state='too_hard'
            ),

          'high_skip',
            count(*) filter(
              where quality_state='review_skip_rate'
            ),

          'weak_distractors',
            count(*) filter(
              where quality_state='weak_distractors'
            )
        )
        from enriched
      ),

      'rows',
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'question_version_id',question_version_id,
              'external_key',external_key,
              'prompt',prompt,
              'difficulty',difficulty,
              'status',status,
              'topic_slug',topic_slug,
              'topic_name',topic_name,
              'attempts',attempts,
              'correct',correct,
              'skips',skips,
              'accuracy',accuracy,
              'skip_rate',skip_rate,
              'avg_response_ms',avg_response_ms,
              'quality_state',quality_state,
              'suggested_difficulty',suggested_difficulty,
              'weak_distractor_count',weak_distractor_count
            )
            order by
              case quality_state
                when 'review_skip_rate' then 1
                when 'too_easy' then 2
                when 'too_hard' then 3
                when 'weak_distractors' then 4
                when 'insufficient_sample' then 5
                else 6
              end,
              attempts desc,
              prompt
          ),
          '[]'::jsonb
        )
        from limited
      )
    )
  );
end;
$$;

revoke execute on function public.admin_question_quality_overview(
  text,text,integer,integer
) from public,anon;

grant execute on function public.admin_question_quality_overview(
  text,text,integer,integer
) to authenticated;


-- ============================================================
-- ENRICH SINGLE-QUESTION ANALYTICS
-- ============================================================

create or replace function public.admin_question_analytics(
  p_question_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;

  v_attempts integer:=0;
  v_correct integer:=0;
  v_skips integer:=0;

  v_accuracy numeric;
  v_skip_rate numeric;
  v_avg_response numeric;

  v_difficulty text;
  v_quality_state text;
  v_suggested text;
  v_weak integer:=0;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  select qv.difficulty
    into v_difficulty
  from public.question_versions qv
  where qv.id=p_question_version_id;

  if v_difficulty is null then
    raise exception 'Question version not found';
  end if;

  select
    count(*)::integer,
    count(*) filter(
      where vqa.is_correct=true
    )::integer,
    count(*) filter(
      where vqa.selected_option_id is null
    )::integer,
    round(
      avg(
        case
          when vqa.is_correct then 100
          else 0
        end
      )::numeric,
      1
    ),
    round(
      (
        count(*) filter(
          where vqa.selected_option_id is null
        )::numeric
        /nullif(count(*),0)::numeric
      )*100,
      1
    ),
    round(
      avg(vqa.response_time_ms) filter(
        where vqa.response_time_ms is not null
      )::numeric
    )
  into
    v_attempts,
    v_correct,
    v_skips,
    v_accuracy,
    v_skip_rate,
    v_avg_response
  from public.verified_question_answers vqa
  where vqa.question_version_id=p_question_version_id;

  if v_attempts>=50 then
    select count(*)::integer
      into v_weak
    from public.question_options qo
    where qo.question_version_id=p_question_version_id
      and qo.is_correct=false
      and (
        select count(*)
        from public.verified_question_answers x
        where x.question_version_id=p_question_version_id
          and x.selected_option_id=qo.id
      ) <= greatest(
        2,
        floor(v_attempts*0.03)::integer
      );
  end if;

  v_suggested:=case
    when v_attempts<30 then null
    when v_accuracy>=75 then 'easy'
    when v_accuracy>=40 then 'medium'
    else 'hard'
  end;

  v_quality_state:=case
    when v_attempts<30
      then 'insufficient_sample'

    when coalesce(v_skip_rate,0)>=20
      then 'review_skip_rate'

    when (
      v_difficulty='easy'
      and v_accuracy>=96
    ) or (
      v_difficulty='medium'
      and v_accuracy>=86
    ) or (
      v_difficulty='hard'
      and v_accuracy>=76
    )
      then 'too_easy'

    when (
      v_difficulty='easy'
      and v_accuracy<=54
    ) or (
      v_difficulty='medium'
      and v_accuracy<=34
    ) or (
      v_difficulty='hard'
      and v_accuracy<=14
    )
      then 'too_hard'

    when v_attempts>=50
      and v_weak>=2
      then 'weak_distractors'

    else 'healthy'
  end;

  return jsonb_build_object(
    'question_version_id',p_question_version_id,

    'attempts',v_attempts,
    'correct',v_correct,
    'skips',v_skips,

    'accuracy',v_accuracy,
    'skip_rate',v_skip_rate,
    'avg_response_ms',v_avg_response,

    'difficulty',v_difficulty,
    'suggested_difficulty',v_suggested,
    'quality_state',v_quality_state,
    'weak_distractor_count',v_weak,

    'options',(
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'option_id',qo.id,
            'position',qo.position,
            'text',qo.option_text,
            'is_correct',qo.is_correct,

            'selected_count',(
              select count(*)
              from public.verified_question_answers vqa
              where vqa.question_version_id=p_question_version_id
                and vqa.selected_option_id=qo.id
            ),

            'selection_rate',
              case
                when v_attempts>0 then
                  round(
                    (
                      select count(*)
                      from public.verified_question_answers vqa
                      where vqa.question_version_id=p_question_version_id
                        and vqa.selected_option_id=qo.id
                    )::numeric
                    /v_attempts::numeric
                    *100,
                    1
                  )
                else null
              end,

            'weak_distractor',
              case
                when qo.is_correct=true
                  or v_attempts<50
                  then false
                else (
                  select count(*)
                  from public.verified_question_answers vqa
                  where vqa.question_version_id=p_question_version_id
                    and vqa.selected_option_id=qo.id
                ) <= greatest(
                  2,
                  floor(v_attempts*0.03)::integer
                )
              end
          )
          order by qo.position
        ),
        '[]'::jsonb
      )
      from public.question_options qo
      where qo.question_version_id=p_question_version_id
    )
  );
end;
$$;

revoke execute on function public.admin_question_analytics(uuid)
  from public,anon;

grant execute on function public.admin_question_analytics(uuid)
  to authenticated;


analyze public.verified_question_answers;

commit;


-- ============================================================
-- VERIFY
-- ============================================================
--
-- select to_regprocedure(
--   'public.admin_question_quality_overview(text,text,integer,integer)'
-- ) as question_quality;
--
-- select to_regprocedure(
--   'public.admin_question_analytics(uuid)'
-- ) as question_analytics;
--
-- Both should be non-null.
