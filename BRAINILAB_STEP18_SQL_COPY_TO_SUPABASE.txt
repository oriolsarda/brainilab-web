-- BrainiLab Backend — Step 18: Performance indexes + incremental analytics
-- Run after Step 17.
--
-- Goal:
-- - stop rebuilding a player's full analytics history after every result
-- - add high-value indexes used by My Stats, Rankings, Friends and Groups
-- - keep public/private behavior unchanged
--
-- No new Cron.

begin;

-- ============================================================
-- HIGH-VALUE QUERY INDEXES
-- ============================================================

create index if not exists game_sessions_user_completed_idx
  on public.game_sessions(
    user_id,
    completed_at desc
  )
  where status='completed';

create index if not exists game_sessions_user_game_completed_idx
  on public.game_sessions(
    user_id,
    game_id,
    completed_at desc
  )
  where status='completed';

create index if not exists game_sessions_user_daily_game_idx
  on public.game_sessions(
    user_id,
    daily_number,
    game_id
  )
  where status='completed'
    and daily_number is not null;

create index if not exists player_daily_stats_user_date_idx
  on public.player_daily_stats(
    user_id,
    stat_date desc
  );

create index if not exists player_daily_stats_daily_score_idx
  on public.player_daily_stats(
    stat_date,
    daily_brain_score desc
  );

create index if not exists player_game_period_rank_idx
  on public.player_game_period_stats(
    period_type,
    period_start,
    game_id,
    total_score desc
  );

create index if not exists player_game_period_user_idx
  on public.player_game_period_stats(
    user_id,
    game_id,
    period_type,
    period_start desc
  );

create index if not exists friendships_user_b_idx
  on public.friendships(
    user_b,
    user_a
  );

create index if not exists friend_requests_receiver_pending_idx
  on public.friend_requests(
    receiver_id,
    created_at desc
  )
  where status='pending';

create index if not exists friend_requests_sender_pending_idx
  on public.friend_requests(
    sender_id,
    created_at desc
  )
  where status='pending';

create index if not exists group_members_user_group_idx
  on public.group_members(
    user_id,
    group_id
  );

create index if not exists profiles_public_ranking_country_idx
  on public.profiles(
    country_code,
    user_id
  )
  where leaderboard_enabled=true;


-- ============================================================
-- INCREMENTAL PLAYER ANALYTICS BUCKET
-- ============================================================
--
-- Step 17 rebuilt ALL analytics rows for a user after every result.
-- Step 18 recalculates only the affected:
--
--   user + UTC date + game + difficulty
--
-- My Stats reads the same player_analytics_daily table and therefore needs
-- no frontend/API contract change.

create or replace function public.refresh_brainilab_player_analytics_bucket(
  p_user_id uuid,
  p_stat_date date,
  p_game_id text,
  p_difficulty_key text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_game_id text:=lower(coalesce(p_game_id,''));
  v_difficulty text:=case
    when lower(coalesce(p_difficulty_key,'')) in ('easy','medium','hard')
      then lower(p_difficulty_key)
    else 'none'
  end;
begin
  if p_user_id is null
     or p_stat_date is null
     or v_game_id='' then
    return;
  end if;

  delete from public.player_analytics_daily pad
  where pad.user_id=p_user_id
    and pad.stat_date=p_stat_date
    and pad.game_id=v_game_id
    and pad.difficulty_key=v_difficulty;

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

      lower(gs.game_id)
        as game_id,

      public.brainilab_analytics_category(
        gs.game_id
      ) as category_key,

      case
        when lower(coalesce(gs.difficulty,'')) in (
          'easy','medium','hard'
        )
          then lower(gs.difficulty)
        else 'none'
      end as difficulty_key,

      coalesce(gr.score,0)
        as score,

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

      coalesce(gr.duration_ms,0)
        as duration_ms,

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
      and (gs.completed_at at time zone 'UTC')::date=p_stat_date
      and lower(gs.game_id)=v_game_id
      and (
        case
          when lower(coalesce(gs.difficulty,'')) in (
            'easy','medium','hard'
          )
            then lower(gs.difficulty)
          else 'none'
        end
      )=v_difficulty
  )

  select
    user_id,
    stat_date,
    game_id,
    category_key,
    difficulty_key,

    count(*)::integer,

    coalesce(sum(score),0)::bigint,

    max(score)::integer,

    coalesce(sum(correct_answers),0)::bigint,

    coalesce(sum(questions_answered),0)::bigint,

    case
      when sum(questions_answered)>0 then
        round(
          sum(correct_answers)::numeric
          /sum(questions_answered)::numeric
          *100,
          2
        )
      else null
    end,

    coalesce(sum(duration_ms),0)::bigint,

    coalesce(sum(won),0)::integer,

    coalesce(sum(attempts),0)::integer,

    coalesce(sum(order_pairs_correct),0)::integer,

    coalesce(sum(order_pairs_total),0)::integer,

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

revoke execute on function public.refresh_brainilab_player_analytics_bucket(
  uuid,date,text,text
) from public,anon,authenticated;


-- ============================================================
-- FAST RESULT TRIGGER
-- ============================================================

create or replace function public.handle_brainilab_player_analytics_refresh()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new_user uuid;
  v_new_date date;
  v_new_game text;
  v_new_difficulty text;

  v_old_user uuid;
  v_old_date date;
  v_old_game text;
  v_old_difficulty text;
begin
  if tg_op in ('INSERT','UPDATE') then
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date,
      lower(gs.game_id),
      case
        when lower(coalesce(gs.difficulty,'')) in (
          'easy','medium','hard'
        )
          then lower(gs.difficulty)
        else 'none'
      end
    into
      v_new_user,
      v_new_date,
      v_new_game,
      v_new_difficulty
    from public.game_sessions gs
    where gs.id=new.session_id;

    perform public.refresh_brainilab_player_analytics_bucket(
      v_new_user,
      v_new_date,
      v_new_game,
      v_new_difficulty
    );
  end if;

  -- Defensive support if a result is reassigned/deleted administratively.
  if tg_op in ('UPDATE','DELETE') then
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date,
      lower(gs.game_id),
      case
        when lower(coalesce(gs.difficulty,'')) in (
          'easy','medium','hard'
        )
          then lower(gs.difficulty)
        else 'none'
      end
    into
      v_old_user,
      v_old_date,
      v_old_game,
      v_old_difficulty
    from public.game_sessions gs
    where gs.id=old.session_id;

    if tg_op='DELETE'
       or old.session_id is distinct from new.session_id then
      perform public.refresh_brainilab_player_analytics_bucket(
        v_old_user,
        v_old_date,
        v_old_game,
        v_old_difficulty
      );
    end if;
  end if;

  if tg_op='DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_game_results_refresh_analytics
  on public.game_results;

create trigger zz_game_results_refresh_analytics
after insert or update or delete
on public.game_results
for each row
execute function public.handle_brainilab_player_analytics_refresh();


-- ============================================================
-- PLANNER STATISTICS
-- ============================================================

analyze public.game_sessions;
analyze public.game_results;
analyze public.player_analytics_daily;
analyze public.player_daily_stats;
analyze public.player_game_period_stats;
analyze public.friendships;
analyze public.friend_requests;
analyze public.group_members;
analyze public.profiles;

commit;


-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1) Incremental trigger:
--
-- select trigger_name
-- from information_schema.triggers
-- where trigger_name='zz_game_results_refresh_analytics';
--
-- Expected: one row.
--
-- 2) Bucket function:
--
-- select to_regprocedure(
--   'public.refresh_brainilab_player_analytics_bucket(uuid,date,text,text)'
-- ) as analytics_bucket;
--
-- Expected: non-null.
--
-- 3) Useful indexes:
--
-- select indexname
-- from pg_indexes
-- where schemaname='public'
--   and indexname in (
--     'game_sessions_user_completed_idx',
--     'game_sessions_user_game_completed_idx',
--     'player_game_period_rank_idx',
--     'group_members_user_group_idx',
--     'friendships_user_b_idx'
--   )
-- order by indexname;
--
-- Expected: five rows.
