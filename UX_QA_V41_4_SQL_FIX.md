# UX/Backend QA — V41.4 Step 22 SQL fix

- Fixed `public.admin_list_connections_puzzles()` migration syntax by selecting the aggregate payload into a PL/pgSQL variable before returning it.
- The original Step 22 migration is wrapped in `BEGIN ... COMMIT`; a syntax failure before `COMMIT` rolls the transaction back, so the corrected migration can be rerun in full.
- Front-end behavior is unchanged.
