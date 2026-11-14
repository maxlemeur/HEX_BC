-- TI-691, owner's walkthrough of 14/11/2026. While the product is tested, outgoing e-mails go to one test mailbox
-- (src/lib/email/outgoing-routing.ts, EMAIL_DELIVERY_MODE unset or « redirect »), but the estimate's send history kept
-- the client's address and « sent » with nothing telling a redirected send from a real one. Each row now says whether
-- the provider received it for the test mailbox instead of its written recipients.
--
-- Null means the routing was not recorded: every row before this migration (sends made in redirect mode since #341
-- included), and a dispatch whose attempt has not yet left. An estimate dispatch is marked by the application server
-- (service role) once it holds the dispatch's lease, before the provider call: the routing it read for that attempt.
-- The mark is written once. A later attempt (a deferred dispatch re-claimed) keeps it, since an earlier attempt may have
-- reached the provider: the application refuses to send under another routing. Only a request rearmed after a refusal
-- (failed -> preparing), which left nothing, forgets it. The portal's acceptance confirmation is logged once as it
-- leaves, with its mark. A member writes nothing on this table (grants); a claim does not mark.
-- Tests: supabase/tests/database/estimate-email-redirected.test.sql.

alter table public.estimate_emails
  add column redirected boolean;

comment on column public.estimate_emails.redirected is
  'Whether the provider received this e-mail for the test mailbox (EMAIL_DELIVERY_MODE redirect) instead of its written recipients, which stay recorded as written. Null: not recorded (every row before this column, or a dispatch not yet left). Written once by the application server for the attempt holding the dispatch''s lease (status processing), or when an acceptance confirmation is logged; never changed afterwards, except forgotten when a refused request is rearmed (failed -> preparing).';

create function public.guard_estimate_email_redirected()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A request rearmed after a refusal left nothing: its next attempt records its own routing.
  if old.status = 'failed' and new.status = 'preparing' then
    new.redirected := null;
    return new;
  end if;
  -- Only the attempt holding the dispatch, while its message leaves, writes its routing, once.
  if new.redirected is distinct from old.redirected and not (
    old.redirected is null
    and new.redirected is not null
    and old.request_id is not null
    and old.status = 'processing'
    and new.status = 'processing'
    and old.lease_token is not null
    and new.lease_token is not distinct from old.lease_token
  ) then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_estimate_email_redirected() from public, anon, authenticated;

create trigger guard_estimate_email_redirected
  before update on public.estimate_emails
  for each row execute function public.guard_estimate_email_redirected();
