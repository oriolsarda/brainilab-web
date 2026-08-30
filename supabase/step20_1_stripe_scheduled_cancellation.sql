-- BrainiLab Step 20.1
-- Stripe scheduled-cancellation compatibility
-- Safe to run after Step 20. Idempotent where practical.

begin;

alter table public.brainilab_subscriptions
  add column if not exists cancel_at timestamptz null;

alter table public.brainilab_subscriptions
  add column if not exists canceled_at timestamptz null;


create or replace function public.get_my_brainilab_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_plus_enabled boolean:=false;
  v_subscription public.brainilab_subscriptions%rowtype;
  v_has_plus boolean:=false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(rf.enabled,false)
    into v_plus_enabled
  from public.runtime_flags rf
  where rf.flag_key='plus_enabled';

  select *
    into v_subscription
  from public.brainilab_subscriptions bs
  where bs.user_id=v_uid;

  v_has_plus:=(
    v_subscription.user_id is not null
    and v_subscription.plan in (
      'plus_monthly',
      'plus_yearly'
    )
    and v_subscription.status in (
      'active',
      'trialing'
    )
  );

  return jsonb_build_object(
    'plus_enabled',v_plus_enabled,
    'plus',v_has_plus,
    'ads_free',v_has_plus,

    'plan',
      case
        when v_subscription.user_id is null then null
        else v_subscription.plan
      end,

    'status',
      case
        when v_subscription.user_id is null then 'free'
        else v_subscription.status
      end,

    'current_period_end',
      case
        when v_subscription.user_id is null then null
        else v_subscription.current_period_end
      end,

    'cancel_at_period_end',
      case
        when v_subscription.user_id is null then false
        else v_subscription.cancel_at_period_end
      end,

    'cancel_at',
      case
        when v_subscription.user_id is null then null
        else v_subscription.cancel_at
      end,

    'canceled_at',
      case
        when v_subscription.user_id is null then null
        else v_subscription.canceled_at
      end,

    'scheduled_to_cancel',
      case
        when v_subscription.user_id is null then false
        else (
          v_subscription.status in ('active','trialing')
          and (
            v_subscription.cancel_at is not null
            or v_subscription.cancel_at_period_end=true
          )
        )
      end,

    'cancellation_effective_at',
      case
        when v_subscription.user_id is null then null
        when v_subscription.cancel_at is not null
          then v_subscription.cancel_at
        when v_subscription.cancel_at_period_end=true
          then v_subscription.current_period_end
        else null
      end
  );
end;
$$;

revoke execute on function public.get_my_brainilab_entitlements()
  from public,anon;

grant execute on function public.get_my_brainilab_entitlements()
  to authenticated;


create or replace function public.admin_get_monetization_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner']::text[]
  );

  return jsonb_build_object(
    'subscriptions',
    (
      select jsonb_build_object(
        'total',count(*),

        'active',
          count(*) filter(
            where status in ('active','trialing')
          ),

        'monthly',
          count(*) filter(
            where plan='plus_monthly'
              and status in ('active','trialing')
          ),

        'yearly',
          count(*) filter(
            where plan='plus_yearly'
              and status in ('active','trialing')
          ),

        'past_due',
          count(*) filter(
            where status='past_due'
          ),

        'scheduled_cancellations',
          count(*) filter(
            where status in ('active','trialing')
              and (
                cancel_at is not null
                or cancel_at_period_end=true
              )
          )
      )
      from public.brainilab_subscriptions
    ),

    'webhooks',
    (
      select jsonb_build_object(
        'total',count(*),

        'failed',
          count(*) filter(
            where processing_status='failed'
          ),

        'pending',
          count(*) filter(
            where processing_status='pending'
          ),

        'latest_received_at',
          max(received_at),

        'latest_processed_at',
          max(processed_at) filter(
            where processing_status='processed'
          )
      )
      from public.stripe_webhook_events
    ),

    'flags',
    (
      select coalesce(
        jsonb_object_agg(
          rf.flag_key,
          jsonb_build_object(
            'enabled',rf.enabled,
            'message',rf.message,
            'updated_at',rf.updated_at
          )
        ),
        '{}'::jsonb
      )
      from public.runtime_flags rf
      where rf.flag_key in (
        'ads_enabled',
        'plus_enabled',

        'ad_home_after_play_enabled',
        'ad_games_mid_content_enabled',
        'ad_daily_lower_enabled',
        'ad_quiz_result_enabled',
        'ad_rankings_after_board_enabled',
        'ad_about_lower_enabled',

        'anchor_ads_enabled',
        'vignette_ads_enabled'
      )
    ),

    'generated_at',now()
  );
end;
$$;

revoke execute on function public.admin_get_monetization_health()
  from public,anon,authenticated;

grant execute on function public.admin_get_monetization_health()
  to authenticated;

analyze public.brainilab_subscriptions;

commit;


-- After deploying the V40.6 stripe-webhook, verify with:
--
-- select
--   status,
--   cancel_at_period_end,
--   cancel_at,
--   canceled_at,
--   current_period_end,
--   last_stripe_event_id
-- from public.brainilab_subscriptions;
