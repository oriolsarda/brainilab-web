# BrainiLab — Step 12: Gameplay pass + Topic Rush

Run after Steps 1–11.

## What changes

The current Daily lineup becomes:

```text
Brain Mix
Flag Dash
Topic Rush
BrainiWord
```

`Map Hunt` is retired from the current product. Historical Map Hunt tables and results remain so old progress/results are not destroyed.

Topic Rush is a 60-second free-response Daily game:

```text
one topic
↓
type an answer + Enter
↓
server checks normalized canonical answer / aliases
↓
correct counter rises
↓
60 seconds
```

Daily contribution:

```text
round(correct / daily_target × 2500)
max 2500
```

## Install

Supabase → SQL Editor → New query, then run:

```text
BRAINILAB_STEP12_SQL_COPY_TO_SUPABASE.txt
```

No new Cron is required. Step 12 replaces the existing Daily generation trigger function, so the Step 5 Cron continues to create future Dailies normally.

## Migration safety

Step 12 deliberately keeps today/historical Map Hunt data. If somebody completed Map Hunt on the migration date before Topic Rush was installed, that legacy result still occupies the fourth Daily slot for that date and its Daily points are preserved.

Future generated Map Hunt rows are deleted and are no longer regenerated.

## Topic Rush content

The migration seeds 20 launch topics, including geography, science, sports and broader free-response topics such as colors, fruits and musical instruments.

Admin → Content Pools now manages Topic Rush topics. A topic needs at least 20 canonical answers. You can provide aliases per answer.

Example:

```text
Canonical: Manchester United
Aliases: Man United | Man Utd
```

The public Daily payload returns only:

```text
topic title
prompt
target count
duration
```

It does not return the accepted-answer list.

## Verify

```sql
select
  count(*) as active_topics,
  min(answer_count) as smallest_topic
from (
  select
    t.id,
    count(a.id) as answer_count
  from public.topic_rush_topics t
  left join public.topic_rush_answers a
    on a.topic_id=t.id
  where t.is_active=true
  group by t.id
) x;
```

Expected after this build:

```text
active_topics >= 20
smallest_topic >= 20
```

Check assignments:

```sql
select
  dc.challenge_date,
  dc.daily_number,
  t.title,
  t.target_count
from public.daily_challenges dc
left join public.daily_topic_rush dtr
  on dtr.daily_challenge_id=dc.id
left join public.topic_rush_topics t
  on t.id=dtr.topic_id
where dc.challenge_date>=current_date
order by dc.challenge_date;
```

Every current/future Daily from the Topic Rush launch date should have a topic.

Check runtime flag:

```sql
select *
from public.runtime_flags
where flag_key='topicrush_enabled';
```

Check progression column:

```sql
select column_name
from information_schema.columns
where table_schema='public'
  and table_name='player_daily_stats'
  and column_name='topicrush_points';
```

## Gameplay QA

After SQL installation, test:

```text
/games/topic-rush/
```

Confirm:

```text
01:00 countdown
input remains fast while checks run
Enter submits
valid answer → accepted chip + counter
invalid answer → feedback
same canonical answer cannot score twice
last-second checks finish before result is locked
result → Play another game / Share result
```

Also verify Admin → Daily and Admin → Content Pools show Topic Rush instead of Map Hunt.
