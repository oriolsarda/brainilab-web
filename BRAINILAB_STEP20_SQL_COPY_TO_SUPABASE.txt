-- BrainiLab Backend — Step 20: Monetization Readiness
-- Run after Step 19.
--
-- Prepares BrainiLab+ entitlements, Stripe billing state, ad feature flags,
-- webhook idempotency and Admin monetization health.
--
-- IMPORTANT:
-- - No Stripe secret is stored in PostgreSQL.
-- - Browser users cannot write subscription/billing state.
-- - Ads and Plus launch OFF.
-- - No new Cron.

begin;

-- ============================================================
-- MONETIZATION RUNTIME FLAGS — OFF BY DEFAULT
-- ============================================================

alter table public.runtime_flags
  drop constraint if exists runtime_flags_key_check;

alter table public.runtime_flags
  add constraint runtime_flags_key_check
  check(flag_key in (
    'brainmix_enabled',
    'flagdash_enabled',
    'orderup_enabled',
    'topicrush_enabled',
    'brainiword_enabled',
    'rankings_enabled',
    'groups_enabled',
    'maintenance_enabled',

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
  ));

insert into public.runtime_flags(
  flag_key,
  enabled,
  message
)
values
  ('ads_enabled',false,'Advertising is not live yet.'),
  ('plus_enabled',false,'BrainiLab+ is not live yet.'),

  ('ad_home_after_play_enabled',false,null),
  ('ad_games_mid_content_enabled',false,null),
  ('ad_daily_lower_enabled',false,null),
  ('ad_quiz_result_enabled',false,null),
  ('ad_rankings_after_board_enabled',false,null),
  ('ad_about_lower_enabled',false,null),

  ('anchor_ads_enabled',false,null),
  ('vignette_ads_enabled',false,null)
on conflict(flag_key) do nothing;


-- ============================================================
-- STRIPE CUSTOMER MAP
-- One Stripe customer per BrainiLab account.
-- ============================================================

create table if not exists public.billing_customers (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  stripe_customer_id text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint billing_customers_stripe_customer_length
    check(char_length(stripe_customer_id) between 5 and 255)
);


-- ============================================================
-- BRAINILAB+ SUBSCRIPTION STATE
-- Canonical application copy of the current Stripe subscription state.
-- Stripe/webhook is authoritative; browser cannot write this table.
-- ============================================================

create table if not exists public.brainilab_subscriptions (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  provider text not null default 'stripe',

  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,

  plan text null,

  status text not null,

  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz null,
  canceled_at timestamptz null,

  last_stripe_event_id text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint brainilab_subscriptions_provider_check
    check(provider='stripe'),

  constraint brainilab_subscriptions_plan_check
    check(
      plan is null
      or plan in (
        'plus_monthly',
        'plus_yearly'
      )
    ),

  constraint brainilab_subscriptions_status_check
    check(status in (
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )),

  constraint brainilab_subscriptions_customer_length
    check(char_length(stripe_customer_id) between 5 and 255),

  constraint brainilab_subscriptions_subscription_length
    check(char_length(stripe_subscription_id) between 5 and 255)
);

create index if not exists brainilab_subscriptions_status_idx
  on public.brainilab_subscriptions(
    status,
    updated_at desc
  );

create index if not exists brainilab_subscriptions_customer_idx
  on public.brainilab_subscriptions(
    stripe_customer_id
  );


-- ============================================================
-- STRIPE WEBHOOK IDEMPOTENCY / OPERATIONS
-- Browser has no access.
-- ============================================================

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,

  event_type text not null,
  processing_status text not null default 'pending',
  processing_error text null,

  received_at timestamptz not null default now(),
  processed_at timestamptz null,

  constraint stripe_webhook_events_status_check
    check(processing_status in (
      'pending',
      'processed',
      'failed'
    )),

  constraint stripe_webhook_events_error_length
    check(
      processing_error is null
      or char_length(processing_error)<=2000
    )
);

create index if not exists stripe_webhook_events_received_idx
  on public.stripe_webhook_events(
    received_at desc
  );


-- ============================================================
-- RLS / DIRECT ACCESS
-- ============================================================

alter table public.billing_customers
  enable row level security;

alter table public.brainilab_subscriptions
  enable row level security;

alter table public.stripe_webhook_events
  enable row level security;

revoke all on table public.billing_customers
  from anon,authenticated;

revoke all on table public.brainilab_subscriptions
  from anon,authenticated;

revoke all on table public.stripe_webhook_events
  from anon,authenticated;


-- ============================================================
-- PRIVATE ACCOUNT ENTITLEMENTS
-- No arbitrary user ID parameter.
-- ============================================================

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

    -- An existing paid subscription remains entitled even if Plus sales
    -- are temporarily disabled with the launch flag.
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


-- ============================================================
-- ADMIN MONETIZATION HEALTH
-- No Stripe secret / card / invoice details.
-- ============================================================

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
  from public,anon;

grant execute on function public.admin_get_monetization_health()
  to authenticated;


-- ============================================================
-- EXPAND EXISTING OWNER-ONLY FLAG MUTATOR
-- ============================================================

create or replace function public.admin_set_brainilab_runtime_flag(
  p_flag_key text,
  p_enabled boolean,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner']::text[]
  );

  if p_flag_key not in (
    'brainmix_enabled',
    'flagdash_enabled',
    'orderup_enabled',
    'topicrush_enabled',
    'brainiword_enabled',
    'rankings_enabled',
    'groups_enabled',
    'maintenance_enabled',

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
  ) then
    raise exception 'Invalid runtime flag';
  end if;

  update public.runtime_flags
  set
    enabled=p_enabled,
    message=nullif(
      left(
        btrim(coalesce(p_message,'')),
        500
      ),
      ''
    ),
    updated_by=v_uid,
    updated_at=now()
  where flag_key=p_flag_key;

  if not found then
    raise exception 'Runtime flag not found';
  end if;

  perform public.log_brainilab_admin_action(
    'RUNTIME_FLAG_UPDATED',
    'runtime_flag',
    p_flag_key,
    jsonb_build_object(
      'enabled',p_enabled,
      'message',nullif(
        left(
          btrim(coalesce(p_message,'')),
          500
        ),
        ''
      )
    )
  );

  return (
    select jsonb_build_object(
      'flag_key',rf.flag_key,
      'enabled',rf.enabled,
      'message',rf.message,
      'updated_at',rf.updated_at
    )
    from public.runtime_flags rf
    where rf.flag_key=p_flag_key
  );
end;
$$;

revoke execute on function public.admin_set_brainilab_runtime_flag(
  text,boolean,text
) from public,anon;

grant execute on function public.admin_set_brainilab_runtime_flag(
  text,boolean,text
) to authenticated;


-- ============================================================
-- INITIAL SAFETY
-- Never make a rerun of this migration turn monetization on.
-- ============================================================

update public.runtime_flags
set enabled=false
where flag_key in (
  'ads_enabled',
  'plus_enabled',
  'anchor_ads_enabled',
  'vignette_ads_enabled'
)
and updated_by is null;


analyze public.billing_customers;
analyze public.brainilab_subscriptions;
analyze public.stripe_webhook_events;

commit;


-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1. Tables:
--
-- select
--   to_regclass('public.billing_customers') as billing_customers,
--   to_regclass('public.brainilab_subscriptions') as subscriptions,
--   to_regclass('public.stripe_webhook_events') as stripe_events;
--
-- All non-null.
--
-- 2. Entitlements:
--
-- select to_regprocedure(
--   'public.get_my_brainilab_entitlements()'
-- ) as entitlements;
--
-- 3. Admin:
--
-- select to_regprocedure(
--   'public.admin_get_monetization_health()'
-- ) as admin_monetization;
--
-- 4. Monetization launch flags must start OFF:
--
-- select flag_key,enabled
-- from public.runtime_flags
-- where flag_key in (
--   'ads_enabled',
--   'plus_enabled',
--   'anchor_ads_enabled',
--   'vignette_ads_enabled'
-- )
-- order by flag_key;
--
-- Expected: false for every row.
