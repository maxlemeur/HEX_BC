select jsonb_build_object(
 'database',current_database(),'expectedUser',current_user='postgres',
 'historyColumns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum)
   from pg_attribute a where a.attrelid='supabase_migrations.schema_migrations'::regclass and a.attnum>0 and not a.attisdropped),
 'historyConstraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='supabase_migrations.schema_migrations'::regclass),
 'migrations',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsMd5',md5(to_jsonb(statements)::text)) order by version),'[]') from supabase_migrations.schema_migrations),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
   'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid=c.oid),
   'indexes',(select jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid::regclass::text) from pg_index where indrelid=c.oid),
   'view',case when c.relkind in('v','m') then pg_get_viewdef(c.oid,true) else null end)
   order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','private','auth','storage') and c.relkind in('r','p','v','m','S','f')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,
   'definitionMd5',md5(pg_get_functiondef(p.oid))) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','auth','storage') and p.prokind in('f','p')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
   order by n.nspname,c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','private','auth','storage') and not t.tgisinternal),
 'dataTables',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname),'[]')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and not c.relispartition
   and (n.nspname in('public','private') or (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname in('buckets','objects'))))
);
