# Supabase Step 21 — Past Daily Archive

Run `BRAINILAB_STEP21_SQL_COPY_TO_SUPABASE.txt` once in the Supabase SQL Editor after the earlier BrainiLab steps.

It adds date-addressable read RPCs for **Brain Mix, Order Up, Topic Rush and BrainiWord** so Games can replay any published Daily before today. It also lets the existing Order Up / Topic Rush / BrainiWord answer-check RPCs validate historical published challenges.

Archive replays are intentionally **practice-only** in V41.3.0. The browser does not cloud-submit their final result, so they cannot alter today's Daily Brain Score, streak, XP cloud progression, friends/groups or rankings.

No cron change is required. Existing Daily generation continues to create the historical rows that the archive reads.
