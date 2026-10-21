-- TREST-07E collection submission diagnostics.
-- Forward-only. Do not apply to the hosted database without a separate approval.
-- Stores the blockhash and a bounded RPC diagnostic. Does not store wire bytes, keys, or RPC credentials.

alter table public.reward_intents
  add column recent_blockhash text,
  add column submission_code text,
  add column submission_detail text;

alter table public.reward_intents
  add constraint reward_intents_recent_blockhash_check
  check (recent_blockhash is null or recent_blockhash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

alter table public.reward_intents
  add constraint reward_intents_submission_code_check
  check (submission_code is null or char_length(submission_code) between 1 and 40);

alter table public.reward_intents
  add constraint reward_intents_submission_detail_check
  check (submission_detail is null or char_length(submission_detail) <= 240);
