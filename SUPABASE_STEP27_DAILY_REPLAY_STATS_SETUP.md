# Supabase Step 27 — V41.8.0

Run `BRAINILAB_STEP27_SQL_COPY_TO_SUPABASE.txt` once after Step 26.

This migration:

- refreshes analytics category mapping for the current game catalogue;
- changes Connections to 20 rounds in Play Anytime while keeping Daily at 3;
- limits Number Route Daily assignments/play to 3 rounds and verifies its speed-based Daily score server-side;
- enforces one scored result per user + game + Daily number, including an advisory transaction lock to close multi-tab races.

It is wrapped in `BEGIN / COMMIT`, and no new Cron is required.

After it succeeds, the following checks are useful:

```sql
select (public.get_brainilab_connections_game(array[]::uuid[])->>'rounds')::integer;
-- expected: 20

select public.get_brainilab_daily_number_route(current_date);
-- when Number Route is in today's Daily: rounds = 3
```
