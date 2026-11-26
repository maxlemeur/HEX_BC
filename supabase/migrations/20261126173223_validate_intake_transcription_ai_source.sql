begin;
set local lock_timeout = '5s';

-- The preceding migration committed the nullable column and its NOT VALID
-- check. The existing rows can now be scanned under SHARE UPDATE EXCLUSIVE.
alter table public.affaire_intake_document_transcriptions
  validate constraint affaire_intake_transcriptions_ai_source_check;
commit;
