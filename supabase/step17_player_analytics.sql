-- BrainiLab Backend — Step 17: Player Analytics + My Stats
-- Run after Step 16.
--
-- Private personal analytics for My BrainiLab → My Stats.
--
-- Design:
-- - aggregate from canonical game_sessions / game_results
-- - verified correctness wins when available
-- - one compact daily aggregate row per user/game/difficulty
-- - browser never receives another user's detailed stats
-- - no raw answer payload is exposed by the stats RPC
-- - no new Cron required

begin;

-- ============================================================
-- PRIVATE DAILY ANALYTICS AGGREGATE
-- ============================================================

create table if not exists public.player_analytics_daily(
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  stat_date date not null,
  game_id text not null,
  category_key text not null,
  difficulty_key text not null default 'none',

  games_played integer not null default 0,

  total_score bigint not null default 0,
  best_score integer null,

  correct_answers bigint not null default 0,
  questions_answered bigint not null default 0,
  average_accuracy numeric(5,2) null,

  total_duration_ms bigint not null default 0,

  wins integer not null default 0,
  attempts_total integer not null default 0,

  order_pairs_correct integer not null default 0,
  order_pairs_total integer not null default 0,

  updated_at timestamptz not null default now(),

  primary key(
    user_id,
    stat_date,
    game_id,
    difficulty_key
  ),

  constraint player_analytics_daily_difficulty_check
    check(
      difficulty_key in (
        'none','easy','medium','hard'
      )
    ),

  constraint player_analytics_daily_nonnegative
    check(
      games_played >= 0
      and total_score >= 0
      and correct_answers >= 0
      and questions_answered >= 0
      and total_duration_ms >= 0
      and wins >= 0
      and attempts_total >= 0
      and order_pairs_correct >= 0
      and order_pairs_total >= 0
    ),

  constraint player_analytics_daily_accuracy_check
    check(
      average_accuracy is null
      or average_accuracy between 0 and 100
    )
);

create index if not exists player_analytics_daily_user_date_idx
  on public.player_analytics_daily(
    user_id,
    stat_date desc
  );

create index if not exists player_analytics_daily_category_idx
  on public.player_analytics_daily(
    user_id,
    category_key,
    stat_date desc
  );

create index if not exists player_analytics_daily_game_idx
  on public.player_analytics_daily(
    user_id,
    game_id,
    stat_date desc
  );


-- ============================================================
-- INTERNAL CLASSIFICATION HELPERS
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
    when 'orderup' then 'daily'
    when 'topicrush' then 'daily'
    when 'brainiword' then 'language'

    when 'flagdash' then 'legacy'
    when 'maphunt' then 'legacy'

    else 'other'
  end;
$$;

revoke execute on function public.brainilab_analytics_category(text)
  from public,anon,authenticated;


create or replace function public.brainilab_analytics_is_quiz(
  p_game_id text
)
returns boolean
language sql
immutable
set search_path=public
as $$
  select lower(coalesce(p_game_id,'')) in (
    'brainmix',
    'generalknowledge',
    'worldflags',
    'worldcapitals',
    'science',
    'history',
    'sports'
  );
$$;

revoke execute on function public.brainilab_analytics_is_quiz(text)
  from public,anon,authenticated;


create or replace function public.brainilab_jsonb_int(
  p_payload jsonb,
  p_key text
)
returns integer
language plpgsql
immutable
set search_path=public
as $$
declare
  v_value text;
begin
  v_value:=nullif(p_payload->>p_key,'');

  if v_value is null then
    return 0;
  end if;

  begin
    return greatest(0,v_value::numeric::integer);
  exception when others then
    return 0;
  end;
end;
$$;

revoke execute on function public.brainilab_jsonb_int(jsonb,text)
  from public,anon,authenticated;


-- ============================================================
-- REBUILD ONE PLAYER'S PRIVATE ANALYTICS
-- ============================================================

create or replace function public.refresh_brainilab_player_analytics(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  delete from public.player_analytics_daily
  where user_id=p_user_id;

  insert into public.player_analytics_daily(
    user_id,
    stat_date,
    game_id,
    category_key,
    difficulty_key,
    games_played,
    total_score,
    best_score,
    correct_answers,
    questions_answered,
    average_accuracy,
    total_duration_ms,
    wins,
    attempts_total,
    order_pairs_correct,
    order_pairs_total,
    updated_at
  )
  with canonical as (
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date
        as stat_date,

      lower(gs.game_id) as game_id,

      public.brainilab_analytics_category(
        gs.game_id
      ) as category_key,

      case
        when gs.difficulty in ('easy','medium','hard')
          then gs.difficulty
        else 'none'
      end as difficulty_key,

      coalesce(gr.score,0) as score,

      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,

      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as questions_answered,

      coalesce(gr.duration_ms,0) as duration_ms,

      case
        when lower(
          coalesce(
            gr.result_payload->>'won',
            'false'
          )
        )='true'
          then 1
        else 0
      end as won,

      public.brainilab_jsonb_int(
        gr.result_payload,
        'attempts'
      ) as attempts,

      greatest(
        public.brainilab_jsonb_int(
          gr.result_payload,
          'verifiedOrderPairsCorrect'
        ),
        public.brainilab_jsonb_int(
          gr.result_payload,
          'orderPairsCorrect'
        )
      ) as order_pairs_correct,

      greatest(
        public.brainilab_jsonb_int(
          gr.result_payload,
          'verifiedOrderPairsTotal'
        ),
        public.brainilab_jsonb_int(
          gr.result_payload,
          'orderPairsTotal'
        )
      ) as order_pairs_total

    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id

    where gs.user_id=p_user_id
      and gs.status='completed'
  )

  select
    user_id,
    stat_date,
    game_id,
    category_key,
    difficulty_key,

    count(*)::integer as games_played,

    coalesce(sum(score),0)::bigint
      as total_score,

    max(score)::integer
      as best_score,

    coalesce(sum(correct_answers),0)::bigint
      as correct_answers,

    coalesce(sum(questions_answered),0)::bigint
      as questions_answered,

    case
      when sum(questions_answered)>0 then
        round(
          sum(correct_answers)::numeric
          /sum(questions_answered)::numeric
          *100,
          2
        )
      else null
    end as average_accuracy,

    coalesce(sum(duration_ms),0)::bigint
      as total_duration_ms,

    coalesce(sum(won),0)::integer
      as wins,

    coalesce(sum(attempts),0)::integer
      as attempts_total,

    coalesce(sum(order_pairs_correct),0)::integer
      as order_pairs_correct,

    coalesce(sum(order_pairs_total),0)::integer
      as order_pairs_total,

    now()

  from canonical

  group by
    user_id,
    stat_date,
    game_id,
    category_key,
    difficulty_key;
end;
$$;

revoke execute on function public.refresh_brainilab_player_analytics(uuid)
  from public,anon,authenticated;


-- ============================================================
-- AUTO-REFRESH AFTER RESULT CREATION / VERIFICATION
-- ============================================================

create or replace function public.handle_brainilab_player_analytics_refresh()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.refresh_brainilab_player_analytics(
    new.user_id
  );

  return new;
end;
$$;

drop trigger if exists zz_game_results_refresh_analytics
  on public.game_results;

create trigger zz_game_results_refresh_analytics
after insert or update
on public.game_results
for each row
execute function public.handle_brainilab_player_analytics_refresh();


-- ============================================================
-- PRIVATE MY STATS RPC
-- ============================================================

create or replace function public.get_my_brainilab_stats(
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();

  v_today date:=(now() at time zone 'UTC')::date;
  v_days integer;
  v_start date;
  v_previous_start date;
  v_previous_end date;

  v_summary jsonb;
  v_previous jsonb;
  v_categories jsonb;
  v_difficulties jsonb;
  v_games jsonb;
  v_series jsonb;
  v_daily_series jsonb;
  v_daily_summary jsonb;
  v_recent jsonb;

  v_current_streak integer:=0;
  v_best_streak integer:=0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_days:=case
    when p_days=0 then 0
    else least(365,greatest(7,coalesce(p_days,30)))
  end;

  if v_days=0 then
    v_start:=null;
    v_previous_start:=null;
    v_previous_end:=null;
  else
    v_start:=v_today-(v_days-1);
    v_previous_end:=v_start-1;
    v_previous_start:=v_previous_end-(v_days-1);
  end if;


  select
    coalesce(pp.current_streak,0),
    coalesce(pp.best_streak,0)
  into
    v_current_streak,
    v_best_streak
  from public.player_progression pp
  where pp.user_id=v_user_id;


  -- ----------------------------------------------------------
  -- Current-period summary.
  -- "Quiz answers / accuracy" intentionally uses only mechanics
  -- where total_questions represents actual quiz questions.
  -- ----------------------------------------------------------

  select jsonb_build_object(
    'days',v_days,

    'games_played',
      coalesce(sum(pad.games_played),0),

    'active_days',
      count(distinct pad.stat_date),

    'quiz_answers',
      coalesce(sum(pad.questions_answered) filter(
        where public.brainilab_analytics_is_quiz(
          pad.game_id
        )
      ),0),

    'quiz_correct',
      coalesce(sum(pad.correct_answers) filter(
        where public.brainilab_analytics_is_quiz(
          pad.game_id
        )
      ),0),

    'quiz_accuracy',
      case
        when coalesce(sum(pad.questions_answered) filter(
          where public.brainilab_analytics_is_quiz(
            pad.game_id
          )
        ),0)>0 then
          round(
            (
              sum(pad.correct_answers) filter(
                where public.brainilab_analytics_is_quiz(
                  pad.game_id
                )
              )
            )::numeric
            /
            (
              sum(pad.questions_answered) filter(
                where public.brainilab_analytics_is_quiz(
                  pad.game_id
                )
              )
            )::numeric
            *100,
            2
          )
        else null
      end,

    'current_streak',v_current_streak,
    'best_streak',v_best_streak
  )
  into v_summary
  from public.player_analytics_daily pad
  where pad.user_id=v_user_id
    and (
      v_start is null
      or pad.stat_date>=v_start
    );


  -- Previous equivalent period for trend insights.
  if v_days=0 then
    v_previous:=null;
  else
    select jsonb_build_object(
      'games_played',
        coalesce(sum(pad.games_played),0),

      'quiz_answers',
        coalesce(sum(pad.questions_answered) filter(
          where public.brainilab_analytics_is_quiz(
            pad.game_id
          )
        ),0),

      'quiz_accuracy',
        case
          when coalesce(sum(pad.questions_answered) filter(
            where public.brainilab_analytics_is_quiz(
              pad.game_id
            )
          ),0)>0 then
            round(
              (
                sum(pad.correct_answers) filter(
                  where public.brainilab_analytics_is_quiz(
                    pad.game_id
                  )
                )
              )::numeric
              /
              (
                sum(pad.questions_answered) filter(
                  where public.brainilab_analytics_is_quiz(
                    pad.game_id
                  )
                )
              )::numeric
              *100,
              2
            )
          else null
        end
    )
    into v_previous

    from public.player_analytics_daily pad

    where pad.user_id=v_user_id
      and pad.stat_date between
        v_previous_start
        and v_previous_end;
  end if;


  -- ----------------------------------------------------------
  -- Knowledge categories.
  -- Daily mechanics are deliberately excluded from this profile.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category',x.category_key,
        'games_played',x.games_played,
        'questions_answered',x.questions_answered,
        'correct_answers',x.correct_answers,
        'accuracy',x.accuracy,
        'qualified',x.questions_answered>=20
      )
      order by
        x.accuracy desc nulls last,
        x.questions_answered desc
    ),
    '[]'::jsonb
  )
  into v_categories

  from (
    select
      pad.category_key,

      sum(pad.games_played)::integer
        as games_played,

      sum(pad.questions_answered)::bigint
        as questions_answered,

      sum(pad.correct_answers)::bigint
        as correct_answers,

      case
        when sum(pad.questions_answered)>0 then
          round(
            sum(pad.correct_answers)::numeric
            /sum(pad.questions_answered)::numeric
            *100,
            2
          )
        else null
      end as accuracy

    from public.player_analytics_daily pad

    where pad.user_id=v_user_id
      and pad.category_key in (
        'general',
        'geography',
        'science',
        'history',
        'sports'
      )
      and (
        v_start is null
        or pad.stat_date>=v_start
      )

    group by pad.category_key
  ) x;


  -- ----------------------------------------------------------
  -- Difficulty profile — replayable category quizzes only.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'difficulty',x.difficulty_key,
        'games_played',x.games_played,
        'questions_answered',x.questions_answered,
        'correct_answers',x.correct_answers,
        'accuracy',x.accuracy
      )
      order by case x.difficulty_key
        when 'easy' then 1
        when 'medium' then 2
        when 'hard' then 3
        else 4
      end
    ),
    '[]'::jsonb
  )
  into v_difficulties

  from (
    select
      pad.difficulty_key,

      sum(pad.games_played)::integer
        as games_played,

      sum(pad.questions_answered)::bigint
        as questions_answered,

      sum(pad.correct_answers)::bigint
        as correct_answers,

      case
        when sum(pad.questions_answered)>0 then
          round(
            sum(pad.correct_answers)::numeric
            /sum(pad.questions_answered)::numeric
            *100,
            2
          )
        else null
      end as accuracy

    from public.player_analytics_daily pad

    where pad.user_id=v_user_id
      and pad.difficulty_key in (
        'easy','medium','hard'
      )
      and (
        v_start is null
        or pad.stat_date>=v_start
      )

    group by pad.difficulty_key
  ) x;


  -- ----------------------------------------------------------
  -- Per-game analytics + all-time personal best.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'game_id',x.game_id,
        'games_played',x.games_played,

        'total_score',x.total_score,
        'average_score',x.average_score,
        'best_score_period',x.best_score_period,

        'correct_answers',x.correct_answers,
        'questions_answered',x.questions_answered,
        'accuracy',x.accuracy,

        'wins',x.wins,
        'win_rate',x.win_rate,
        'average_attempts',x.average_attempts,

        'order_pairs_correct',x.order_pairs_correct,
        'order_pairs_total',x.order_pairs_total,
        'order_accuracy',x.order_accuracy,

        'personal_best',
          case
            when ppb.user_id is null then null
            else jsonb_build_object(
              'metric_name',ppb.metric_name,
              'metric_value',ppb.metric_value,
              'score',ppb.score,
              'correct_answers',ppb.correct_answers,
              'total_questions',ppb.total_questions,
              'accuracy',ppb.accuracy,
              'achieved_at',ppb.achieved_at
            )
          end
      )
      order by x.games_played desc,x.game_id
    ),
    '[]'::jsonb
  )
  into v_games

  from (
    select
      pad.game_id,

      sum(pad.games_played)::integer
        as games_played,

      sum(pad.total_score)::bigint
        as total_score,

      case
        when sum(pad.games_played)>0 then
          round(
            sum(pad.total_score)::numeric
            /sum(pad.games_played)::numeric,
            1
          )
        else null
      end as average_score,

      max(pad.best_score)::integer
        as best_score_period,

      sum(pad.correct_answers)::bigint
        as correct_answers,

      sum(pad.questions_answered)::bigint
        as questions_answered,

      case
        when sum(pad.questions_answered)>0 then
          round(
            sum(pad.correct_answers)::numeric
            /sum(pad.questions_answered)::numeric
            *100,
            2
          )
        else null
      end as accuracy,

      sum(pad.wins)::integer
        as wins,

      case
        when sum(pad.games_played)>0 then
          round(
            sum(pad.wins)::numeric
            /sum(pad.games_played)::numeric
            *100,
            2
          )
        else null
      end as win_rate,

      case
        when sum(pad.attempts_total)>0
             and sum(pad.games_played)>0 then
          round(
            sum(pad.attempts_total)::numeric
            /sum(pad.games_played)::numeric,
            2
          )
        else null
      end as average_attempts,

      sum(pad.order_pairs_correct)::integer
        as order_pairs_correct,

      sum(pad.order_pairs_total)::integer
        as order_pairs_total,

      case
        when sum(pad.order_pairs_total)>0 then
          round(
            sum(pad.order_pairs_correct)::numeric
            /sum(pad.order_pairs_total)::numeric
            *100,
            2
          )
        else null
      end as order_accuracy

    from public.player_analytics_daily pad

    where pad.user_id=v_user_id
      and (
        v_start is null
        or pad.stat_date>=v_start
      )

    group by pad.game_id
  ) x

  left join public.player_personal_bests ppb
    on ppb.user_id=v_user_id
   and ppb.game_id=x.game_id;


  -- ----------------------------------------------------------
  -- Daily per-game series. The frontend chooses the metric:
  -- accuracy, answers, attempts, order accuracy, etc.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',pad.stat_date,
        'game_id',pad.game_id,
        'category',pad.category_key,
        'difficulty',
          case
            when pad.difficulty_key='none'
              then null
            else pad.difficulty_key
          end,
        'games_played',pad.games_played,
        'total_score',pad.total_score,
        'best_score',pad.best_score,
        'correct_answers',pad.correct_answers,
        'questions_answered',pad.questions_answered,
        'accuracy',pad.average_accuracy,
        'wins',pad.wins,
        'attempts_total',pad.attempts_total,
        'order_pairs_correct',pad.order_pairs_correct,
        'order_pairs_total',pad.order_pairs_total
      )
      order by pad.stat_date,pad.game_id,pad.difficulty_key
    ),
    '[]'::jsonb
  )
  into v_series

  from public.player_analytics_daily pad

  where pad.user_id=v_user_id
    and (
      v_start is null
      or pad.stat_date>=v_start
    );


  -- ----------------------------------------------------------
  -- Daily Brain Score trend + aggregate summary.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',pds.stat_date,
        'daily_brain_score',pds.daily_brain_score,
        'games_completed',pds.daily_games_completed,
        'full_daily',pds.full_daily
      )
      order by pds.stat_date
    ),
    '[]'::jsonb
  )
  into v_daily_series

  from public.player_daily_stats pds

  where pds.user_id=v_user_id
    and (
      v_start is null
      or pds.stat_date>=v_start
    )
    and pds.daily_games_completed>0;


  select jsonb_build_object(
    'days_played',
      count(*) filter(
        where pds.daily_games_completed>0
      ),

    'average_daily_score',
      case
        when count(*) filter(
          where pds.daily_games_completed>0
        )>0 then
          round(
            avg(pds.daily_brain_score) filter(
              where pds.daily_games_completed>0
            ),
            0
          )
        else null
      end,

    'best_daily_score',
      max(pds.daily_brain_score) filter(
        where pds.daily_games_completed>0
      ),

    'full_dailies',
      count(*) filter(
        where pds.full_daily
      )
  )
  into v_daily_summary

  from public.player_daily_stats pds

  where pds.user_id=v_user_id
    and (
      v_start is null
      or pds.stat_date>=v_start
    );


  -- ----------------------------------------------------------
  -- Recent private activity. No raw answers / email / auth data.
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'result_id',r.result_id,
        'game_id',r.game_id,
        'difficulty',r.difficulty,
        'daily_number',r.daily_number,
        'completed_at',r.completed_at,
        'score',r.score,
        'correct_answers',r.correct_answers,
        'total_questions',r.total_questions,
        'accuracy',r.accuracy,
        'special',r.special
      )
      order by r.completed_at desc
    ),
    '[]'::jsonb
  )
  into v_recent

  from (
    select
      gr.id as result_id,
      lower(gs.game_id) as game_id,
      gs.difficulty,
      gs.daily_number,
      gs.completed_at,

      gr.score,

      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers
      ) as correct_answers,

      coalesce(
        gr.verified_total_questions,
        gr.total_questions
      ) as total_questions,

      case
        when coalesce(
          gr.verified_total_questions,
          gr.total_questions,
          0
        )>0 then
          round(
            coalesce(
              gr.verified_correct_answers,
              gr.correct_answers,
              0
            )::numeric
            /
            coalesce(
              gr.verified_total_questions,
              gr.total_questions
            )::numeric
            *100,
            2
          )
        else gr.accuracy
      end as accuracy,

      jsonb_strip_nulls(
        jsonb_build_object(
          'won',
            case
              when gr.result_payload ? 'won'
                then gr.result_payload->'won'
              else null
            end,

          'attempts',
            case
              when gr.result_payload ? 'attempts'
                then gr.result_payload->'attempts'
              else null
            end,

          'topic_title',
            case
              when gr.result_payload ? 'topicTitle'
                then gr.result_payload->'topicTitle'
              else null
            end,

          'order_pairs_correct',
            case
              when gr.result_payload ? 'verifiedOrderPairsCorrect'
                then gr.result_payload->'verifiedOrderPairsCorrect'
              when gr.result_payload ? 'orderPairsCorrect'
                then gr.result_payload->'orderPairsCorrect'
              else null
            end,

          'order_pairs_total',
            case
              when gr.result_payload ? 'verifiedOrderPairsTotal'
                then gr.result_payload->'verifiedOrderPairsTotal'
              when gr.result_payload ? 'orderPairsTotal'
                then gr.result_payload->'orderPairsTotal'
              else null
            end
        )
      ) as special

    from public.game_sessions gs

    join public.game_results gr
      on gr.session_id=gs.id

    where gs.user_id=v_user_id
      and gs.status='completed'

    order by gs.completed_at desc

    limit 30
  ) r;


  return jsonb_build_object(
    'generated_at',now(),
    'range_days',v_days,
    'summary',coalesce(v_summary,'{}'::jsonb),
    'previous_summary',v_previous,
    'categories',coalesce(v_categories,'[]'::jsonb),
    'difficulties',coalesce(v_difficulties,'[]'::jsonb),
    'games',coalesce(v_games,'[]'::jsonb),
    'series',coalesce(v_series,'[]'::jsonb),
    'daily_series',coalesce(v_daily_series,'[]'::jsonb),
    'daily_summary',coalesce(v_daily_summary,'{}'::jsonb),
    'recent_results',coalesce(v_recent,'[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_my_brainilab_stats(integer)
  from public,anon;

grant execute on function public.get_my_brainilab_stats(integer)
  to authenticated;


-- ============================================================
-- PRIVACY / DIRECT TABLE ACCESS
-- ============================================================

alter table public.player_analytics_daily
  enable row level security;

revoke all on table public.player_analytics_daily
  from anon,authenticated;

-- Detailed personal analytics are intentionally available only through
-- get_my_brainilab_stats(), which scopes itself to auth.uid().


-- ============================================================
-- INITIAL BACKFILL
-- ============================================================

do $$
declare
  v_player record;
begin
  for v_player in
    select distinct gr.user_id
    from public.game_results gr
    where gr.user_id is not null
  loop
    perform public.refresh_brainilab_player_analytics(
      v_player.user_id
    );
  end loop;
end;
$$;


commit;


-- ============================================================
-- VERIFICATION
-- ============================================================
--
-- Table:
--
-- select to_regclass(
--   'public.player_analytics_daily'
-- ) as player_analytics_daily;
--
-- Expected: public.player_analytics_daily
--
-- RPC:
--
-- select to_regprocedure(
--   'public.get_my_brainilab_stats(integer)'
-- ) as my_stats_rpc;
--
-- Expected: public.get_my_brainilab_stats(integer)
--
-- Trigger:
--
-- select trigger_name
-- from information_schema.triggers
-- where trigger_name='zz_game_results_refresh_analytics';
--
-- Expected: one row.
--
-- After logging into BrainiLab, My Stats should be able to call:
--   get_my_brainilab_stats(30)
-- without exposing any other user's detailed analytics.
