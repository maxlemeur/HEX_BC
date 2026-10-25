-- Lot 3.3 D2/D3: no public-schema RPC has an anonymous application consumer.
begin;

-- Preserve effective signed-in/service access, including functions whose old
-- permission came only from PUBLIC. Never grant a previously denied RPC.
do $grants$
declare
  target record;
begin
  for target in select p.oid, p.oid::regprocedure as signature
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    if has_function_privilege('authenticated', target.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', target.signature);
    end if;
    if has_function_privilege('service_role', target.oid, 'execute') then
      execute format('grant execute on function %s to service_role', target.signature);
    end if;
  end loop;
end;
$grants$;
revoke execute on all functions in schema public from public, anon;

-- PostgreSQL's global PUBLIC default cannot be revoked by a per-schema rule.
-- Both scopes are necessary. postgres owns every application function; managed
-- supabase_admin defaults are outside this role's authority and are not changed.
alter default privileges for role postgres revoke execute on functions from public, anon;
-- PUBLIC previously also gave these roles global execute (including temporary
-- SQL helpers). Preserve that effective signed-in default when removing PUBLIC.
alter default privileges for role postgres grant execute on functions to authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;

-- These four invokers require auth.uid(); every application consumer uses the
-- signed-in client. Keep authenticated access, remove the unused service path.
revoke execute on function public.insert_estimate_template_into_version(uuid,uuid,uuid),
  public.insert_estimate_assembly_into_version(uuid,uuid,uuid),
  public.insert_estimate_template_with_receipt(uuid,uuid,uuid),
  public.insert_estimate_assembly_with_receipt(uuid,uuid,uuid) from service_role;

notify pgrst, 'reload schema';
commit;
