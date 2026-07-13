-- Keep public self-signup usable without granting access to an existing tenant.
-- Authorization data is selected by this trusted trigger, never by user metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup_tenant_id uuid;
begin
  insert into public.profiles (id, full_name, phone, job_title, work_email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
    'buyer'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    job_title = excluded.job_title,
    work_email = excluded.work_email;

  insert into public.tenants (name, slug, created_by)
  values (
    'Espace personnel',
    'signup-' || new.id::text,
    new.id
  )
  returning id into signup_tenant_id;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_default
  )
  values (
    signup_tenant_id,
    new.id,
    'admin'::public.tenant_role,
    true
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated, service_role;
