-- On an owned database at #547, run this file with psql -X -v ON_ERROR_STOP=1.
-- The rows exist before the actual migration, as during a mixed-version rollout.
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae5b0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(1),'intake-upgrade@example.test',now());
insert into public.estimate_projects(id,tenant_id,user_id,name)
  select pg_temp.f(n),m.tenant_id,m.user_id,'Upgrade fixture' from public.tenant_memberships m,generate_series(10,14) n
  where m.user_id=pg_temp.f(1) and m.is_default;
insert into public.affaire_intake_uploads(id,project_id,created_by,status,last_error,completed_at)
  select pg_temp.f(n+10),pg_temp.f(n),pg_temp.f(1),case when n<13 then 'failed' else 'deposited' end,
    case when n<12 then 'Liens Drive en cours d''enregistrement.' end,case when n=12 then now() end
  from generate_series(10,14) n;
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(n+10),'Plan.pdf',case when n=13 then 'rejected' else 'uploaded' end,
    case when n=13 then 'failed' when n=14 then 'awaiting_launch' else 'queued' end from generate_series(10,14) n;

insert into public.affaire_briefs(project_id,upload_id,status,summary,project_object)
  select pg_temp.f(n),pg_temp.f(n+10),'a_confirmer','Historique','Dossier fictif' from generate_series(10,12) n;

-- record_send includes every column, its type, nullness and binary value.
-- Compare all rows, including timestamps, before performing any later gesture.
create temporary view live_fingerprints as
  select 'documents' as relation,count(*) as rows,sha256(string_agg(record_send(d),''::bytea order by d.id)) digest
    from public.affaire_intake_documents d
  union all select 'uploads',count(*),sha256(string_agg(record_send(u),''::bytea order by u.id))
    from public.affaire_intake_uploads u
  union all select 'briefs',count(*),sha256(string_agg(record_send(b),''::bytea order by b.id))
    from public.affaire_briefs b;
create temporary table before_install as table live_fingerprints;

\ir ../../migrations/20261125004459_intake_current_brief_contract.sql

do $$begin
  if exists(select * from before_install except select * from live_fingerprints) then
    raise exception 'Upgrade changed existing business rows: %',
      (select string_agg(relation,', ') from (select * from before_install except select * from live_fingerprints) changed);
  end if;
  if exists(select 1 from private.intake_current_brief_activation) then raise exception 'Migration activated enforcement'; end if;
end$$;

-- The first Drive selection is still being filled. The second was interrupted.
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(20),'Second.pdf','uploaded','queued');
update public.affaire_intake_uploads set status='queued',last_error=null where id=pg_temp.f(20);
do $$begin
  if exists(select 1 from public.affaire_intake_documents where upload_id in (pg_temp.f(20),pg_temp.f(21))
    and (classification_status<>'queued' or issues<>'{}')) then raise exception 'Upgrade opened an unfinished Drive deposit for retry'; end if;
  if (select classification_status from public.affaire_intake_documents where upload_id=pg_temp.f(22)) is distinct from 'queued'
    then raise exception 'Upgrade rewrote the terminal failure'; end if;
  if (select array_agg(project_id order by project_id) from private.affaire_intake_contracts where project_id between pg_temp.f(10) and pg_temp.f(14))
    is distinct from array[pg_temp.f(14)] then raise exception 'Upgrade enrolled a rejected or historical deposit'; end if;
  if exists(select 1 from private.intake_current_brief_activation) then raise exception 'Migration activated enforcement'; end if;
end$$;
