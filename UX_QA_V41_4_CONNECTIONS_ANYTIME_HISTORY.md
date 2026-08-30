# UX / QA — V41.4 Connections + Play Anytime history

## Connections

- Games, Home and Daily Play Anytime surfaces expose Connections.
- A run contains exactly 3 rounds.
- The mechanic supports 4–8 clue concepts per round; the 20 seeded rounds currently use 4 clues each and 4 candidate connections.
- Candidate connection order is shuffled.
- A wrong candidate is disabled and cannot be selected again in the UI.
- Scoring is 1000 / 700 / 400 / 200 points for attempts 1 / 2 / 3 / 4.
- Maximum score is 3,000.
- The result screen offers Play another Connections, Share result and Choose another game.
- 20 initial puzzles are seeded by Step 22 and mirrored in the local fallback.

## Connections Admin

- Admin → Content Pools → Connections lists the pool and play count.
- Owner/editor can create a puzzle with external key, category, prompt, 4–8 clues, 1 correct connection, 3 distractors and explanation.
- Owner/editor can activate/deactivate a puzzle.
- Direct browser table access remains revoked; player reads/checks use RPCs.

## History-aware Play Anytime

- General Knowledge, World Flags, World Capitals, Science, History and Sports request the least-played published questions for the selected difficulty.
- Authenticated history uses `verified_question_answers` and is written once, in batch, after verified quiz completion.
- A composite `(user_id, question_version_id, created_at desc)` index supports the selector.
- Local device history is persisted separately from the 100-result recent-activity cap.
- The selector prefers zero-play questions first. Only after every available question in that topic+difficulty has been played can repeats enter the selection.
- Newly published Admin questions automatically join the unseen pool; no quiz-pack regeneration is required for this selector.
- Daily games and Past Daily replays do not consult this history, so Daily content may legitimately reappear on a later day.

## Server-load design

- Play Anytime adds one lightweight selection RPC at quiz start.
- Existing answer-check RPCs are unchanged.
- History is batch-written during result verification rather than one write per question.
- Connections adds one selector RPC, one tiny correctness RPC per attempted connection, and one history write at completion.
- No polling and no new Cron are introduced.

## Required backend

Run `BRAINILAB_STEP22_SQL_COPY_TO_SUPABASE.txt` once after Step 21.
