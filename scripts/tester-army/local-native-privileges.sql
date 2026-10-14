select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),
    'securityDefiner',p.prosecdef,'configuration',p.proconfig,'acl',p.proacl::text)
    order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in('get_estimate_source_review','reserve_estimate_source_reference_copy','complete_estimate_source_reference_copy','confirm_estimate_source_reference'))
      or (n.nspname='private' and p.proname like 'source_review_%')),
  'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text)
    order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where (n.nspname='private' and c.relname in('estimate_source_reviews','estimate_source_reference_copies','estimate_source_reference_events'))
      or (n.nspname='public' and c.relname in('tenants','tenant_memberships','estimate_projects','estimate_versions','affaire_intake_documents','affaire_intake_uploads'))
      or (n.nspname='storage' and c.relname in('buckets','objects'))),
  'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,
    'roles',roles,'command',cmd,'permissive',permissive,'using',qual,'check',with_check)
    order by schemaname,tablename,policyname)
    from pg_policies where schemaname in('public','private','storage')),
  'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)
    order by nspname) from pg_namespace where nspname in('public','private','storage')),
  'roleMemberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
    'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'adminOption',admin_option,
    'inheritOption',inherit_option,'setOption',set_option) order by roleid,member,grantor),'[]') from pg_auth_members),
  'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,
    'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls)
    order by rolname) from pg_roles)
);
