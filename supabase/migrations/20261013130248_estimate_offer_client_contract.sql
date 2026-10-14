-- Frozen customer copy, document proof and dispatch-bound portal capability.
-- Prepared against the PRECODE offer-contract regression. SQL compares stored
-- metadata; the server still verifies original PDF bytes and JS seal1-5 hashes.
begin;

alter table public.estimate_emails
  add column request_contract_version smallint,
  add column portal_url text,
  add column offer_identity_snapshot jsonb;
alter table public.portal_tokens
  add column estimate_email_dispatch_id uuid,
  add column capability_contract_version smallint;
alter table public.estimate_documents
  add column client_contract_version smallint,
  add column client_contract_snapshot jsonb;
alter table public.estimate_versions add column seal_payload_version smallint;

-- Classify ONLY rows already present. Never reconstruct an old envelope,
-- identity, URL, PDF, CGV, seal or timestamp from current project/profile data.
alter table public.estimate_emails disable trigger set_estimate_emails_updated_at;
update public.estimate_emails set request_contract_version=1;
alter table public.estimate_emails enable trigger set_estimate_emails_updated_at;
update public.portal_tokens set capability_contract_version=1;
alter table public.estimate_emails alter column request_contract_version set not null;
alter table public.portal_tokens alter column capability_contract_version set not null;
alter table public.estimate_emails alter column request_contract_version set default 2;
alter table public.portal_tokens alter column capability_contract_version set default 2;
alter table public.estimate_emails add constraint estimate_emails_request_contract_version_check
  check(request_contract_version in(1,2));
alter table public.portal_tokens add constraint portal_tokens_capability_contract_version_check
  check(capability_contract_version in(1,2));
alter table public.estimate_documents add constraint estimate_documents_client_contract_pair_check
  check((client_contract_version is null and client_contract_snapshot is null)
    or (client_contract_version is not null and client_contract_version=1 and client_contract_snapshot is not null));
alter table public.estimate_versions add constraint estimate_versions_seal_payload_version_check
  check(seal_payload_version is null or seal_payload_version between 1 and 5);
alter table public.estimate_emails add constraint estimate_emails_dispatch_tenant_version_key
  unique(id,tenant_id,version_id);
alter table public.portal_tokens add constraint portal_tokens_dispatch_tenant_version_fkey
  foreign key(estimate_email_dispatch_id,tenant_id,version_id)
  references public.estimate_emails(id,tenant_id,version_id) on delete restrict;
alter table public.portal_tokens add constraint portal_tokens_capability_contract_pair_check
  check((capability_contract_version=1 and estimate_email_dispatch_id is null)
    or (capability_contract_version=2 and estimate_email_dispatch_id is not null));
create unique index portal_tokens_one_dispatch_capability_idx
  on public.portal_tokens(estimate_email_dispatch_id)
  where estimate_email_dispatch_id is not null;

create function public.estimate_offer_keys(value jsonb,required text[],optional text[] default '{}')
returns boolean language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(value)='object' then
    value ?& required and not exists(select 1 from jsonb_object_keys(value) k where not(k=any(required||optional)))
    else false end;
$$;
create function public.estimate_offer_trim(value text)
returns text language sql immutable security invoker set search_path='' as $$
  select regexp_replace(value,U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$','','g');
$$;
create function public.estimate_offer_text(value jsonb,nullable boolean default false)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce((nullable and value='null'::jsonb)
    or (jsonb_typeof(value)='string' and length(public.estimate_offer_trim(value#>>'{}'))>0),false);
$$;
create function public.estimate_offer_number(value jsonb,minimum numeric,maximum numeric,whole boolean default true)
returns boolean language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(value)='number' then
    (value#>>'{}')::numeric between minimum and maximum
      and (not whole or trunc((value#>>'{}')::numeric)=(value#>>'{}')::numeric)
    else false end;
$$;
create function public.estimate_offer_uuid(value jsonb,nullable boolean default false)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce((nullable and value='null'::jsonb)
    or (jsonb_typeof(value)='string' and (value#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),false);
$$;
create function public.estimate_offer_date(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare parsed date;
begin
  if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  parsed:=(value#>>'{}')::date;
  return to_char(parsed,'YYYY-MM-DD')=value#>>'{}' and extract(year from parsed) between 1 and 9999;
exception when others then return false;
end;
$$;
create function public.estimate_offer_instant(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare parsed timestamp; raw_value text; zone_value text; offset_minutes integer;
begin
  if jsonb_typeof(value) is distinct from 'string' then return false; end if;
  raw_value:=value#>>'{}';
  if raw_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
    or not public.estimate_offer_date(to_jsonb(left(raw_value,10))) then return false; end if;
  -- Same RFC3339 envelope as TS, including offsets up to 23:59. PostgreSQL's
  -- timestamptz input offset limit must not silently narrow the JSON contract.
  -- Fractional microseconds remain untouched in captured JSON; whole-second
  -- calendar arithmetic alone is enough to reject a UTC year outside 1..9999.
  parsed:=(left(raw_value,10)||' '||substring(raw_value from 12 for 8))::timestamp;
  if right(lower(raw_value),1)<>'z' then
    zone_value:=right(raw_value,6);
    offset_minutes:=(substring(zone_value from 2 for 2)::integer*60+right(zone_value,2)::integer)
      *case when left(zone_value,1)='-' then -1 else 1 end;
    parsed:=parsed-make_interval(mins=>offset_minutes);
  end if;
  return isfinite(parsed) and extract(year from parsed) between 1 and 9999;
exception when others then return false;
end;
$$;
create function public.estimate_offer_company_valid(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare part jsonb; k text;
begin
  if not public.estimate_offer_keys(value,array['name','tagline','address','registeredOffice','phone','legal'])
    or not public.estimate_offer_text(value->'name') or not public.estimate_offer_text(value->'tagline') then return false; end if;
  foreach k in array array['address','registeredOffice'] loop
    part:=value->k;
    if not public.estimate_offer_keys(part,array['street','postalCode','city'])
      or not public.estimate_offer_text(part->'street') or not public.estimate_offer_text(part->'postalCode')
      or not public.estimate_offer_text(part->'city') then return false; end if;
  end loop;
  part:=value->'phone';
  if not public.estimate_offer_keys(part,array['landline','mobile']) or not public.estimate_offer_text(part->'landline')
    or not public.estimate_offer_text(part->'mobile') then return false; end if;
  part:=value->'legal';
  return public.estimate_offer_keys(part,array['siret','vat']) and public.estimate_offer_text(part->'siret') and public.estimate_offer_text(part->'vat');
end;
$$;
create function public.estimate_offer_identity_valid(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare part jsonb; k text;
begin
  if not public.estimate_offer_keys(value,array['schemaVersion','version','project','issuer','company'])
    or value->'schemaVersion' is distinct from '1'::jsonb or not public.estimate_offer_company_valid(value->'company') then return false; end if;
  part:=value->'version';
  if not public.estimate_offer_keys(part,array['id','tenantId','projectId','contentRevision'])
    or not public.estimate_offer_uuid(part->'id') or not public.estimate_offer_uuid(part->'tenantId')
    or not public.estimate_offer_uuid(part->'projectId') or not public.estimate_offer_number(part->'contentRevision',1,9007199254740991) then return false; end if;
  part:=value->'project';
  if not public.estimate_offer_keys(part,array['name','reference','estimateReference','clientName','siteAddress']) or not public.estimate_offer_text(part->'name') then return false; end if;
  foreach k in array array['reference','estimateReference','clientName','siteAddress'] loop
    if not public.estimate_offer_text(part->k,true) then return false; end if;
  end loop;
  part:=value->'issuer';
  if not public.estimate_offer_keys(part,array['userId','displayName','displayRole','phone','email'])
    or not public.estimate_offer_uuid(part->'userId') or not public.estimate_offer_text(part->'displayName') then return false; end if;
  foreach k in array array['displayRole','phone','email'] loop
    if not public.estimate_offer_text(part->k,true) then return false; end if;
  end loop;
  return true;
end;
$$;
create function public.estimate_offer_layout_valid(value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(public.estimate_offer_keys(value,array['preset','detailLevel','priceMode','density','showNumbering','showSectionSubtotals','conditionsPlacement','includeTerms'])
    and value->'preset' in('"client_detailed"'::jsonb,'"decision_summary"'::jsonb,'"fo_mo"'::jsonb)
    and value->'detailLevel' in('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'"lines"'::jsonb)
    and value->'priceMode' in('"total_only"'::jsonb,'"unit_and_total"'::jsonb,'"fo_mo_and_total"'::jsonb)
    and value->'density' in('"compact"'::jsonb,'"standard"'::jsonb,'"comfortable"'::jsonb)
    and value->'conditionsPlacement' in('"auto"'::jsonb,'"new_page"'::jsonb)
    and jsonb_typeof(value->'showNumbering')='boolean' and jsonb_typeof(value->'showSectionSubtotals')='boolean'
    and jsonb_typeof(value->'includeTerms')='boolean',false);
$$;
create function public.estimate_offer_terms_valid(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if value is null or value='null'::jsonb then return true; end if;
  -- Structural union only. isDraft:true does NOT attest a legal review or
  -- production eligibility. Trusted server parsing refuses draft CGV by default
  -- and admits them only in its explicit local development context.
  return public.estimate_offer_keys(value,array['templateId','title','body','version','legalReviewedAt','capturedAt'],array['isDraft'])
    and public.estimate_offer_text(value->'templateId') and public.estimate_offer_text(value->'title')
    and public.estimate_offer_text(value->'body') and public.estimate_offer_number(value->'version',1,9007199254740991)
    and public.estimate_offer_instant(value->'capturedAt')
    and ((not(value ? 'isDraft') and (public.estimate_offer_date(value->'legalReviewedAt') or public.estimate_offer_instant(value->'legalReviewedAt')))
      or (value ? 'isDraft' and value->'isDraft'='true'::jsonb and (value->'legalReviewedAt'='null'::jsonb
        or public.estimate_offer_date(value->'legalReviewedAt') or public.estimate_offer_instant(value->'legalReviewedAt'))));
end;
$$;
create function public.estimate_offer_client_valid(value jsonb,layout jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; totals jsonb; row_value jsonb; rows_value jsonb; part jsonb; required text[];
  portions boolean; k text; row_sum numeric; section_sum numeric; section_fo numeric; section_mo numeric;
begin
  if not public.estimate_offer_keys(value,array['schemaVersion','version','project','issuer','company','rows','totals','exclusions'])
    or value->'schemaVersion' is distinct from '1'::jsonb or not public.estimate_offer_layout_valid(layout)
    or not public.estimate_offer_text(value->'exclusions',true) then return false; end if;
  v:=value->'version';
  if not public.estimate_offer_keys(v,array['id','tenantId','projectId','number','contentRevision','calcEngineVersion','dateDevis','validiteJours','currency','contractorRole','taxRateBp'])
    or not public.estimate_offer_uuid(v->'id') or not public.estimate_offer_uuid(v->'tenantId') or not public.estimate_offer_uuid(v->'projectId')
    or not public.estimate_offer_number(v->'number',1,2147483647) or not public.estimate_offer_number(v->'contentRevision',1,9007199254740991)
    or v->'calcEngineVersion' not in('1'::jsonb,'2'::jsonb) or not public.estimate_offer_date(v->'dateDevis')
    or not public.estimate_offer_number(v->'validiteJours',0,2147483647) or not public.estimate_offer_number(v->'taxRateBp',0,10000)
    or v->'currency' not in('"EUR"'::jsonb,'"USD"'::jsonb,'"GBP"'::jsonb)
    or v->'contractorRole' not in('"principal"'::jsonb,'"subcontractor"'::jsonb) then return false; end if;
  if not public.estimate_offer_identity_valid(jsonb_build_object('schemaVersion',1,
    'version',jsonb_build_object('id',v->'id','tenantId',v->'tenantId','projectId',v->'projectId','contentRevision',v->'contentRevision'),
    'project',value->'project','issuer',value->'issuer','company',value->'company')) then return false; end if;
  totals:=value->'totals';
  if not public.estimate_offer_keys(totals,array['saleHtCents','taxCents','calculatedTtcCents','payableTtcCents','roundingAdjustmentCents']) then return false; end if;
  foreach k in array array['saleHtCents','taxCents','calculatedTtcCents','payableTtcCents'] loop
    if not public.estimate_offer_number(totals->k,0,2147483647) then return false; end if;
  end loop;
  if not public.estimate_offer_number(totals->'roundingAdjustmentCents',-2147483647,2147483647)
    or (totals->>'saleHtCents')::numeric+(totals->>'taxCents')::numeric<>(totals->>'calculatedTtcCents')::numeric
    or (totals->>'calculatedTtcCents')::numeric+(totals->>'roundingAdjustmentCents')::numeric<>(totals->>'payableTtcCents')::numeric
    or (v->>'contractorRole'='subcontractor' and ((totals->>'taxCents')::numeric<>0 or (totals->>'roundingAdjustmentCents')::numeric<>0)) then return false; end if;
  rows_value:=value->'rows';
  if jsonb_typeof(rows_value) is distinct from 'array' then return false; end if;
  portions:=layout->>'priceMode'='fo_mo_and_total';
  for row_value in select * from jsonb_array_elements(rows_value) loop
    required:=array['kind','id','parentId','position','depth','title','saleHtCents'];
    if row_value->>'kind'='section' then required:=required||array['number'];
    elsif row_value->>'kind'='line' then required:=required||array['quantity','unit','unitSaleHtCents'];
    else return false; end if;
    if portions then required:=required||array['foSaleHtCents','moSaleHtCents']; end if;
    if not public.estimate_offer_keys(row_value,required) or not public.estimate_offer_uuid(row_value->'id')
      or not public.estimate_offer_uuid(row_value->'parentId',true) or not public.estimate_offer_text(row_value->'title')
      or not public.estimate_offer_number(row_value->'position',0,2147483647)
      or not public.estimate_offer_number(row_value->'depth',0,case when row_value->>'kind'='section' then 3 else 4 end)
      or not public.estimate_offer_number(row_value->'saleHtCents',0,2147483647) then return false; end if;
    if row_value->>'kind'='section' then
      if not public.estimate_offer_text(row_value->'number') then return false; end if;
    elsif not public.estimate_offer_number(row_value->'quantity',0,9007199254740991,false)
      or not public.estimate_offer_text(row_value->'unit') or not public.estimate_offer_number(row_value->'unitSaleHtCents',0,2147483647) then return false; end if;
    if portions and (not public.estimate_offer_number(row_value->'foSaleHtCents',0,2147483647)
      or not public.estimate_offer_number(row_value->'moSaleHtCents',0,2147483647)
      or (row_value->>'foSaleHtCents')::numeric+(row_value->>'moSaleHtCents')::numeric<>(row_value->>'saleHtCents')::numeric) then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(rows_value))<>(select count(distinct r->>'id') from jsonb_array_elements(rows_value)r) then return false; end if;
  for row_value in select * from jsonb_array_elements(rows_value) loop
    if row_value->'parentId'='null'::jsonb then
      if row_value->'depth'<>'0'::jsonb then return false; end if;
    else
      select r into part from jsonb_array_elements(rows_value)r where r->'id'=row_value->'parentId';
      if part is null or part->>'kind'<>'section' or (row_value->>'depth')::integer<>(part->>'depth')::integer+1 then return false; end if;
    end if;
  end loop;
  -- Bounded strictly increasing parent depth excludes cycles. Arrays retain
  -- their original order; SQL never sorts or repairs the captured presentation.
  if v->'calcEngineVersion'='2'::jsonb then
    select coalesce(sum((r->>'saleHtCents')::numeric),0) into row_sum from jsonb_array_elements(rows_value)r where r->>'kind'='line';
    if row_sum<>(totals->>'saleHtCents')::numeric then return false; end if;
    for row_value in select r from jsonb_array_elements(rows_value)r where r->>'kind'='section' loop
      with recursive descendants(descendant_value) as (
        select r from jsonb_array_elements(rows_value)r where r->'parentId'=row_value->'id'
        union all select r from jsonb_array_elements(rows_value)r join descendants d on r->'parentId'=d.descendant_value->'id'
      ) select coalesce(sum((descendant_value->>'saleHtCents')::numeric),0),
        coalesce(sum((descendant_value->>'foSaleHtCents')::numeric),0),coalesce(sum((descendant_value->>'moSaleHtCents')::numeric),0)
        into section_sum,section_fo,section_mo from descendants where descendant_value->>'kind'='line';
      if section_sum<>(row_value->>'saleHtCents')::numeric or (portions and
        (section_fo<>(row_value->>'foSaleHtCents')::numeric or section_mo<>(row_value->>'moSaleHtCents')::numeric)) then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;

-- Exact SQL image. UTC microseconds match the strict server proof parser; CGV
-- strings remain captured bytes, never timestamp-normalized inside JSON.
create function public.estimate_offer_document_proof(document public.estimate_documents,version public.estimate_versions)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('proofVersion',1,'documentId',(document).id,'tenantId',(document).tenant_id,'versionId',(document).version_id,
    'projectId',(version).project_id,'status',(document).status,'filePath',(document).file_path,'sha256Hash',(document).sha256_hash,
    'fileSizeBytes',(document).file_size_bytes,'generatedAt',case when (document).generated_at is null then null else to_char((document).generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'generatedBy',(document).generated_by,'publishedGenerationToken',(document).published_generation_token,'publishedPurpose',(document).published_purpose,
    'publishedDispatchId',(document).published_dispatch_id,'publishedContentRevision',(document).published_content_revision,
    'clientContractVersion',(document).client_contract_version,'clientContractSnapshot',(document).client_contract_snapshot,
    'layoutOptions',(document).layout_options,'termsSnapshot',(document).terms_snapshot);
$$;
create function public.estimate_offer_document_valid(document public.estimate_documents,version public.estimate_versions,allow_legacy boolean default false)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare expected_path text; prefix text; filename text; snapshot jsonb;
begin
  if document.id is null or document.tenant_id is distinct from version.tenant_id or document.version_id is distinct from version.id
    or document.status<>'ready' or document.generation_token is not null or document.sha256_hash !~ '^[0-9a-f]{64}$'
    or document.sha256_hash is null or document.published_content_revision is distinct from version.content_revision
    or not public.estimate_offer_layout_valid(document.layout_options) or not public.estimate_offer_terms_valid(document.terms_snapshot)
    or ((document.layout_options->>'includeTerms')::boolean and (document.terms_snapshot is null or document.terms_snapshot='null'::jsonb))
    or document.published_purpose is null or document.published_purpose not in('legacy','manual','email','workflow')
    or (document.file_size_bytes is not null and (document.file_size_bytes<=0 or document.file_size_bytes>9007199254740991))
    or (document.generated_at is not null and not public.estimate_offer_instant(to_jsonb(to_char(document.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))) then return false; end if;
  expected_path:=version.tenant_id||'/'||version.project_id||'/'||version.id||'/'||document.sha256_hash||'.pdf';
  if document.client_contract_version is null then
    if not allow_legacy or document.client_contract_snapshot is not null or version.seal_payload_version=5
      or not (document.layout_options->>'includeTerms')::boolean or document.terms_snapshot is null or document.terms_snapshot='null'::jsonb then return false; end if;
    prefix:=version.tenant_id||'/'||version.project_id||'/'; filename:=substring(document.file_path from length(prefix)+1);
    return coalesce(document.file_path=expected_path or (document.published_purpose='legacy' and left(document.file_path,length(prefix))=prefix
      and length(filename)>4 and position('/' in filename)=0 and right(filename,4)='.pdf'),false);
  end if;
  if document.client_contract_version<>1 or document.file_path is distinct from expected_path or document.published_purpose not in('manual','email','workflow')
    or document.published_purpose is null or document.file_size_bytes is null or document.file_size_bytes<=0 or document.file_size_bytes>9007199254740991
    or document.generated_at is null or document.generated_by is null or document.published_generation_token is null
    or (document.published_purpose='email') is distinct from (document.published_dispatch_id is not null)
    or not public.estimate_offer_client_valid(document.client_contract_snapshot,document.layout_options) then return false; end if;
  snapshot:=document.client_contract_snapshot;
  return coalesce(snapshot->'version'->>'id'=version.id::text and snapshot->'version'->>'tenantId'=version.tenant_id::text
    and snapshot->'version'->>'projectId'=version.project_id::text and (snapshot->'version'->>'contentRevision')::bigint=version.content_revision
    and snapshot->'issuer'->>'userId'=document.generated_by::text,false);
exception when others then return false;
end;
$$;

-- New helpers have no public invocation path; their trigger/RPC callers use
-- the existing service-role relation boundary.
revoke all on function public.estimate_offer_trim(text),public.estimate_offer_keys(jsonb,text[],text[]),public.estimate_offer_text(jsonb,boolean),
  public.estimate_offer_number(jsonb,numeric,numeric,boolean),public.estimate_offer_uuid(jsonb,boolean),public.estimate_offer_date(jsonb),
  public.estimate_offer_instant(jsonb),public.estimate_offer_company_valid(jsonb),public.estimate_offer_identity_valid(jsonb),
  public.estimate_offer_layout_valid(jsonb),public.estimate_offer_terms_valid(jsonb),public.estimate_offer_client_valid(jsonb,jsonb),
  public.estimate_offer_document_proof(public.estimate_documents,public.estimate_versions),
  public.estimate_offer_document_valid(public.estimate_documents,public.estimate_versions,boolean) from public,anon,authenticated;
grant execute on function public.estimate_offer_trim(text),public.estimate_offer_keys(jsonb,text[],text[]),public.estimate_offer_text(jsonb,boolean),
  public.estimate_offer_number(jsonb,numeric,numeric,boolean),public.estimate_offer_uuid(jsonb,boolean),public.estimate_offer_date(jsonb),
  public.estimate_offer_instant(jsonb),public.estimate_offer_company_valid(jsonb),public.estimate_offer_identity_valid(jsonb),
  public.estimate_offer_layout_valid(jsonb),public.estimate_offer_terms_valid(jsonb),public.estimate_offer_client_valid(jsonb,jsonb),
  public.estimate_offer_document_proof(public.estimate_documents,public.estimate_versions),
  public.estimate_offer_document_valid(public.estimate_documents,public.estimate_versions,boolean) to service_role;

create function public.assert_estimate_offer_actor(p_tenant_id uuid,p_version_id uuid,p_actor_user_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  perform public.assert_estimate_email_dispatch_actor(p_tenant_id,p_version_id,p_actor_user_id,false);
  -- Prevent membership/active-tenant changes during a new reservation, render
  -- publication or manual emission. Completion of existing provider proof does
  -- not call this helper, preserving its deliberate recovery behavior.
  perform t.id from public.tenants t join public.tenant_memberships m on m.tenant_id=t.id
    join public.estimate_versions v on v.tenant_id=t.id join public.estimate_projects p on p.id=v.project_id and p.tenant_id=t.id
    where t.id=p_tenant_id and t.is_active and m.user_id=p_actor_user_id and v.id=p_version_id and not p.is_archived
      and m.role in('admin'::public.tenant_role,'engineer'::public.tenant_role)
      and (p.user_id=p_actor_user_id or m.role='admin'::public.tenant_role)
    for share of t,m;
  if not found then raise exception using errcode='42501',message='ESTIMATE_EMAIL_DISPATCH_FORBIDDEN'; end if;
end;
$$;
create function public.capture_estimate_offer_identity(version public.estimate_versions,p_actor_user_id uuid,p_company_snapshot jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare project public.estimate_projects; issuer public.profiles; captured_source jsonb; raw_name text; raw_role text; raw_email text;
  name_source text; display_name text; display_email text; display_role text; identity_snapshot jsonb; reference text;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if not public.estimate_offer_company_valid(p_company_snapshot) then raise exception using errcode='22023',message='OFFER_COMPANY_SNAPSHOT_INVALID'; end if;
  -- Both rows are captured by ONE statement image. The issuer is the actual
  -- renderer actor, never project.user_id; sent resend does not call this path.
  select jsonb_build_object('project',to_jsonb(p),'issuer',to_jsonb(a)) into captured_source from public.estimate_projects p cross join public.profiles a
    where p.id=version.project_id and p.tenant_id=version.tenant_id and a.id=p_actor_user_id;
  project:=jsonb_populate_record(null::public.estimate_projects,captured_source->'project');
  issuer:=jsonb_populate_record(null::public.profiles,captured_source->'issuer');
  if project.id is null or issuer.id is null then raise exception using errcode='23514',message='OFFER_IDENTITY_SOURCE_MISSING'; end if;
  raw_name:=public.estimate_offer_trim(coalesce(issuer.full_name,'')); raw_role:=public.estimate_offer_trim(coalesce(issuer.job_title,'')); raw_email:=public.estimate_offer_trim(coalesce(issuer.work_email,''));
  name_source:=coalesce(nullif(raw_name,''),raw_email);
  display_email:=coalesce(nullif(raw_email,''),case when name_source ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then name_source else null end);
  if name_source ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    select string_agg(case when n=1 then upper(left(lower(part),1))||substring(lower(part) from 2) else upper(part) end,' ' order by n)
      into display_name from regexp_split_to_table(split_part(name_source,'@',1),'[._-]+') with ordinality s(part,n) where part<>'';
    display_name:=coalesce(display_name,'Utilisateur');
  else display_name:=coalesce(nullif(name_source,''),p_company_snapshot->>'name'); end if;
  display_role:=case when raw_role<>'' and raw_role !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and raw_role<>raw_name and raw_role is distinct from display_email then raw_role else null end;
  reference:=nullif(public.estimate_offer_trim(project.estimate_reference),'');
  if reference is not null and version.version_number>1 then reference:=reference||'_V'||version.version_number; end if;
  identity_snapshot:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
    'projectId',version.project_id,'contentRevision',version.content_revision),
    'project',jsonb_build_object('name',project.name,'reference',project.reference,'estimateReference',reference,
      'clientName',nullif(public.estimate_offer_trim(project.client_name),''),'siteAddress',nullif(public.estimate_offer_trim(project.site_address),'')),
    'issuer',jsonb_build_object('userId',p_actor_user_id,'displayName',display_name,'displayRole',display_role,
      'phone',nullif(public.estimate_offer_trim(issuer.phone),''),'email',display_email),'company',p_company_snapshot);
  if not public.estimate_offer_identity_valid(identity_snapshot) then raise exception using errcode='23514',message='OFFER_IDENTITY_SNAPSHOT_INVALID'; end if;
  return identity_snapshot;
end;
$$;
create function public.estimate_offer_client_items_match(snapshot jsonb,version public.estimate_versions)
returns boolean language sql stable security invoker set search_path='' as $$
  select (select count(*) from jsonb_array_elements(snapshot->'rows'))=(select count(*) from public.estimate_items where version_id=(version).id and tenant_id=(version).tenant_id)
    and not exists(
      select 1 from jsonb_array_elements(snapshot->'rows')r
      left join public.estimate_items i on i.id=(r->>'id')::uuid and i.version_id=(version).id and i.tenant_id=(version).tenant_id
      where i.id is null or r->>'kind' is distinct from i.item_type::text
        or r->'parentId' is distinct from coalesce(to_jsonb(i.parent_id),'null'::jsonb)
        or (r->>'position')::integer is distinct from i.position
        or r->>'title' is distinct from coalesce(nullif(public.estimate_offer_trim(i.title),''),'Sans titre')
        or (i.item_type='line' and ((r->>'quantity')::numeric is distinct from i.quantity
          or r->>'unit' is distinct from coalesce(nullif(public.estimate_offer_trim(i.description),''),'-')))
        or ((version).calc_engine_version=2 and i.item_type='line' and (
          i.snapshot_pu_ht_cents is null or i.snapshot_fo_ht_cents is null or i.snapshot_mo_ht_cents is null
          or i.snapshot_mo_atelier_ht_cents is null or i.snapshot_mo_chantier_ht_cents is null
          or i.line_total_ht_cents is null or i.line_tax_cents is null or i.line_total_ttc_cents is null
          or i.snapshot_fo_ht_cents::bigint+i.snapshot_mo_ht_cents::bigint<>i.line_total_ht_cents::bigint
          or i.snapshot_mo_atelier_ht_cents::bigint+i.snapshot_mo_chantier_ht_cents::bigint<>i.snapshot_mo_ht_cents::bigint
          or i.line_total_ht_cents::bigint+i.line_tax_cents::bigint<>i.line_total_ttc_cents::bigint
          or (r->>'saleHtCents')::bigint is distinct from i.line_total_ht_cents::bigint
          or (r->>'unitSaleHtCents')::bigint is distinct from i.snapshot_pu_ht_cents::bigint
          or (r ? 'foSaleHtCents' and ((r->>'foSaleHtCents')::bigint is distinct from i.snapshot_fo_ht_cents::bigint
            or (r->>'moSaleHtCents')::bigint is distinct from i.snapshot_mo_ht_cents::bigint)))))
    and ((version).calc_engine_version<>2 or ((version).calc_snapshot_content_revision=(version).content_revision and (version).calc_snapshot_context is not null));
$$;
revoke all on function public.assert_estimate_offer_actor(uuid,uuid,uuid),public.capture_estimate_offer_identity(public.estimate_versions,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assert_estimate_offer_actor(uuid,uuid,uuid),public.capture_estimate_offer_identity(public.estimate_versions,uuid,jsonb) to service_role;
revoke all on function public.estimate_offer_client_items_match(jsonb,public.estimate_versions) from public,anon,authenticated;
grant execute on function public.estimate_offer_client_items_match(jsonb,public.estimate_versions) to service_role;

create function public.guard_estimate_offer_request_insert()
returns trigger language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; document public.estimate_documents; legacy_identity boolean:=false;
begin
  if new.type<>'initial' then return new; end if;
  if new.offer_identity_snapshot is null then
    select * into version from public.estimate_versions where id=new.version_id and tenant_id=new.tenant_id;
    select * into document from public.estimate_documents where version_id=version.id and tenant_id=version.tenant_id;
    legacy_identity:=version.status='sent' and version.seal_hash ~ '^[0-9a-fA-F]{64}$' and version.seal_payload_version is distinct from 5
      and document.client_contract_version is null and document.client_contract_snapshot is null
      and public.estimate_offer_document_valid(document,version,true);
  end if;
  if new.request_contract_version<>2 or new.request_id is null or new.portal_url is null
    or (not coalesce(legacy_identity,false) and (not public.estimate_offer_identity_valid(new.offer_identity_snapshot)
      or new.offer_identity_snapshot->'version'->>'id' is distinct from new.version_id::text
      or new.offer_identity_snapshot->'version'->>'tenantId' is distinct from new.tenant_id::text
      or (new.offer_identity_snapshot->'version'->>'contentRevision')::bigint is distinct from new.version_content_revision))
    or new.portal_url !~ '^https?://[^?#[:space:]]+/portal/[0-9a-f-]{36}$' then
    raise exception using errcode='23514',message='ESTIMATE_EMAIL_REQUEST_CONTRACT_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger guard_estimate_offer_request_insert before insert on public.estimate_emails
  for each row execute function public.guard_estimate_offer_request_insert();

create function public.guard_estimate_offer_token()
returns trigger language plpgsql security invoker set search_path='' as $$
declare dispatch public.estimate_emails; version public.estimate_versions; bound timestamptz;
begin
  if tg_op='DELETE' then
    if old.capability_contract_version=2 then raise exception using errcode='42501',message='OFFER_CAPABILITY_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.capability_contract_version is distinct from old.capability_contract_version
      or new.estimate_email_dispatch_id is distinct from old.estimate_email_dispatch_id then
      raise exception using errcode='42501',message='OFFER_CAPABILITY_IMMUTABLE';
    end if;
    if old.capability_contract_version=2 and (new.token is distinct from old.token or new.tenant_id is distinct from old.tenant_id
      or new.version_id is distinct from old.version_id or new.email is distinct from old.email
      or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at) then
      raise exception using errcode='42501',message='OFFER_CAPABILITY_IMMUTABLE';
    end if;
    if new.status is distinct from old.status and not(old.status='pending' and new.status in('accepted','rejected','expired')) then
      raise exception using errcode='42501',message='OFFER_CAPABILITY_DECISION_IMMUTABLE';
    end if;
    if old.status in('accepted','rejected','expired') and (new.accepted_at is distinct from old.accepted_at
      or new.accepted_ip is distinct from old.accepted_ip or new.reject_reason is distinct from old.reject_reason) then
      raise exception using errcode='42501',message='OFFER_CAPABILITY_DECISION_IMMUTABLE';
    end if;
    if new.signature_url is distinct from old.signature_url and old.status<>'accepted' then
      raise exception using errcode='42501',message='OFFER_SIGNATURE_REQUIRES_ACCEPTANCE';
    end if;
    return new;
  end if;
  if new.capability_contract_version<>2 or new.estimate_email_dispatch_id is null then
    raise exception using errcode='23514',message='OFFER_CAPABILITY_DISPATCH_REQUIRED';
  end if;
  select * into dispatch from public.estimate_emails where id=new.estimate_email_dispatch_id;
  select * into version from public.estimate_versions where id=new.version_id;
  bound:=((version.date_devis+version.validite_jours+1)::timestamp at time zone 'Europe/Paris');
  if dispatch.id is null or dispatch.type<>'initial' or dispatch.request_contract_version<>2
    or dispatch.tenant_id is distinct from new.tenant_id or dispatch.version_id is distinct from new.version_id
    or dispatch.recipient is distinct from new.email or dispatch.portal_url not like '%/portal/'||new.token::text
    or new.status<>'pending' or new.accepted_at is not null or new.accepted_ip is not null or new.reject_reason is not null
    or new.expires_at>bound or new.expires_at<=clock_timestamp() then
    raise exception using errcode='23514',message='OFFER_CAPABILITY_DISPATCH_MISMATCH';
  end if;
  return new;
end;
$$;
-- Run before the old assign_tenant trigger so an attempted tenant rewrite is
-- rejected, not silently normalized into an apparently successful no-op.
create trigger aaa_guard_estimate_offer_token before insert or update or delete on public.portal_tokens
  for each row execute function public.guard_estimate_offer_token();
drop policy if exists "Tenant members can insert portal tokens" on public.portal_tokens;
drop policy if exists "Tenant members can update portal tokens" on public.portal_tokens;
revoke insert,update,delete on table public.portal_tokens from public,anon,authenticated;
-- Existing SELECT policy/grants remain exactly as deployed.

create function public.guard_estimate_offer_document()
returns trigger language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions;
begin
  if tg_op='DELETE' then
    select * into version from public.estimate_versions where id=old.version_id;
    if version.status in('sent','accepted','archived') or (old.client_contract_version=1 and version.status='sending' and version.seal_hash is not null) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    return old;
  end if;
  select * into version from public.estimate_versions where id=new.version_id;
  if new.status='ready' and (tg_op='INSERT' or (tg_op='UPDATE' and old.status<>'ready'))
    and new.client_contract_version is distinct from 1 then
    raise exception using errcode='23514',message='OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED';
  end if;
  if tg_op='UPDATE' and old.status='ready' and version.status in('sent','accepted','archived')
    and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
    raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
  end if;
  if tg_op='UPDATE' and old.client_contract_version=1 then
    if new.version_id is distinct from old.version_id or new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    if (version.status in('sent','accepted','archived') or (version.status='sending' and version.seal_hash is not null))
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    if version.status='draft' and old.status='ready' and new.status='ready'
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_PUBLICATION_CLAIM_REQUIRED';
    end if;
    if new.client_contract_version is distinct from old.client_contract_version or new.client_contract_snapshot is null then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_DOWNGRADE_FORBIDDEN';
    end if;
  end if;
  if new.status='ready' and new.client_contract_version=1 and not public.estimate_offer_document_valid(new,version,false) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID';
  end if;
  if new.status='ready' and new.client_contract_version=1 and (tg_op='INSERT'
    or (tg_op='UPDATE' and (old.status<>'processing' or old.generation_token is null)
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']))) then
    raise exception using errcode='42501',message='OFFER_DOCUMENT_PUBLICATION_CLAIM_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger aaa_guard_estimate_offer_document before insert or update or delete on public.estimate_documents
  for each row execute function public.guard_estimate_offer_document();
revoke all on function public.guard_estimate_offer_request_insert(),public.guard_estimate_offer_token(),public.guard_estimate_offer_document()
  from public,anon,authenticated;

drop function public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text);
create function public.reserve_estimate_email_dispatch(
  p_version_id uuid,p_tenant_id uuid,p_expected_updated_at timestamptz,p_actor_user_id uuid,
  p_request_id uuid,p_payload_hash text,p_recipient text,p_cc text[],p_subject text,p_body text,p_from_address text,
  p_portal_origin text,p_company_snapshot jsonb
) returns public.estimate_emails language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; existing public.estimate_emails; reserved public.estimate_emails;
  document public.estimate_documents; dispatch_id uuid:=gen_random_uuid(); capability_id uuid:=gen_random_uuid();
  capability_token uuid:=gen_random_uuid(); identity_snapshot jsonb; portal_url_value text; expiration timestamptz; frozen boolean;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_recipient,'')))=0 or length(btrim(coalesce(p_subject,'')))=0
    or length(btrim(coalesce(p_body,'')))=0 or length(btrim(coalesce(p_from_address,'')))=0 then
    raise exception using errcode='22023',message='ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID';
  end if;
  select v.* into version from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id
    join public.tenants t on t.id=v.tenant_id and t.is_active where v.id=p_version_id and v.tenant_id=p_tenant_id for update of v;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  if version.status in('sending','sent') then
    select e.* into existing from public.estimate_emails e where e.tenant_id=p_tenant_id and e.version_id=p_version_id
      and e.type='initial' and e.status in('preparing','queued','processing','unknown') for update;
  end if;
  if existing.id is null then
    select e.* into existing from public.estimate_emails e where e.tenant_id=p_tenant_id and e.request_id=p_request_id for update;
  end if;
  if existing.id is not null then
    if existing.version_id is distinct from p_version_id or existing.payload_hash is distinct from p_payload_hash
      or existing.created_by is distinct from p_actor_user_id or existing.recipient is distinct from btrim(p_recipient)
      or existing.cc is distinct from p_cc or existing.subject is distinct from btrim(p_subject) or existing.body is distinct from p_body then
      raise exception using errcode='23505',message='ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT';
    end if;
    if existing.status<>'failed' then return existing; end if;
    frozen:=existing.provider_payload_hash ~ '^[0-9a-f]{64}$' and length(coalesce(existing.html_body,''))>0
      and length(coalesce(existing.text_body,''))>0 and existing.document_path is not null
      and existing.document_sha256 ~ '^[0-9a-f]{64}$' and existing.attachment_filename is not null;
    if frozen then raise exception using errcode='23505',message='ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST'; end if;
    if existing.request_contract_version=1 then
      raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY';
    end if;
    if version.status not in('draft','sent') then raise exception using errcode='40001',message='ESTIMATE_EMAIL_RETRY_STATE_CONFLICT'; end if;
    if version.updated_at is distinct from p_expected_updated_at or version.content_revision is distinct from existing.version_content_revision then
      raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
    end if;
    if version.status='draft' then
      if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
        and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
      update public.estimate_versions set status='sending' where id=version.id;
    elsif version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$' then raise exception using errcode='23514',message='ESTIMATE_SEAL_INVALID'; end if;
    update public.estimate_emails set status='preparing',last_error_code=null,last_error_message=null,next_attempt_at=null,
      lease_token=null,lease_expires_at=null where id=existing.id returning * into reserved;
    insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
      values(reserved.tenant_id,reserved.version_id,reserved.id,'reserved',jsonb_build_object('retry',true),p_actor_user_id);
    return reserved;
  end if;
  if version.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  if version.status not in('draft','sent') then raise exception using errcode='42501',message='ESTIMATE_EMAIL_STATUS_FORBIDDEN'; end if;
  if p_portal_origin is null or p_portal_origin !~ '^https?://[^/?#[:space:]]+$' then
    raise exception using errcode='22023',message='OFFER_PORTAL_ORIGIN_INVALID';
  end if;
  if version.status='draft' then
    if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
      and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
    identity_snapshot:=public.capture_estimate_offer_identity(version,p_actor_user_id,p_company_snapshot);
  else
    if version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$' then raise exception using errcode='23514',message='ESTIMATE_SEAL_INVALID'; end if;
    select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
    if not public.estimate_offer_document_valid(document,version,true) then raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID'; end if;
    if document.client_contract_version=1 then
      identity_snapshot:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
        'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
        'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    else
      -- Original historical metadata only. TS still verifies original PDF/seal
      -- and legal/development context. Identity remains NULL forever.
      if version.seal_payload_version=5 or document.client_contract_snapshot is not null then
        raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID';
      end if;
      identity_snapshot:=null;
    end if;
  end if;
  -- Product convention, not a legal assertion: include the final validity day
  -- in Europe/Paris civil time. Resend never extends this original offer date.
  expiration:=((version.date_devis+version.validite_jours+1)::timestamp at time zone 'Europe/Paris');
  if expiration<=clock_timestamp() then raise exception using errcode='23514',message='OFFER_VALIDITY_EXPIRED'; end if;
  portal_url_value:=p_portal_origin||'/portal/'||capability_token::text;
  if version.status='draft' then update public.estimate_versions set status='sending' where id=version.id; end if;
  insert into public.estimate_emails(id,tenant_id,version_id,recipient,cc,subject,body,type,status,sent_at,request_id,payload_hash,
    idempotency_key,created_by,version_content_revision,from_address,request_contract_version,portal_url,offer_identity_snapshot)
    values(dispatch_id,p_tenant_id,p_version_id,btrim(p_recipient),p_cc,btrim(p_subject),p_body,'initial','preparing',null,p_request_id,p_payload_hash,
      'estimate-email/'||dispatch_id,p_actor_user_id,version.content_revision,btrim(p_from_address),2,portal_url_value,identity_snapshot)
    returning * into reserved;
  insert into public.portal_tokens(id,tenant_id,version_id,token,email,expires_at,status,estimate_email_dispatch_id,capability_contract_version)
    values(capability_id,p_tenant_id,p_version_id,capability_token,reserved.recipient,expiration,'pending',dispatch_id,2);
  insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
    values(reserved.tenant_id,reserved.version_id,reserved.id,'reserved',jsonb_build_object('request_id',p_request_id,'version_status',version.status),p_actor_user_id);
  return reserved;
end;
$$;
revoke all on function public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb) to service_role;

drop function public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb);
create function public.publish_estimate_pdf_generation(
  p_version_id uuid,p_tenant_id uuid,p_actor_user_id uuid,p_generation_token uuid,p_file_path text,p_sha256_hash text,
  p_file_size_bytes bigint,p_generated_at timestamptz,p_layout_options jsonb,p_terms_snapshot jsonb,p_client_contract_snapshot jsonb
) returns public.estimate_documents language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; document public.estimate_documents; dispatch public.estimate_emails;
  published public.estimate_documents; expected_path text; identity_snapshot jsonb; snapshot_version jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_generation_token is null or p_sha256_hash is null or p_sha256_hash !~ '^[0-9a-f]{64}$' or p_file_size_bytes is null
    or p_file_size_bytes<=0 or p_file_size_bytes>9007199254740991 or p_generated_at is null or not isfinite(p_generated_at)
    or not public.estimate_offer_client_valid(p_client_contract_snapshot,p_layout_options)
    or not public.estimate_offer_terms_valid(p_terms_snapshot)
    or ((p_layout_options->>'includeTerms')::boolean and (p_terms_snapshot is null or p_terms_snapshot='null'::jsonb)) then
    raise exception using errcode='22023',message='ESTIMATE_PDF_PUBLICATION_INVALID';
  end if;
  select v.* into version from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  select d.* into document from public.estimate_documents d where d.version_id=p_version_id and d.tenant_id=p_tenant_id for update;
  if document.id is null then raise exception using errcode='P0001',message='ESTIMATE_PDF_GENERATION_NOT_FOUND'; end if;
  expected_path:=p_tenant_id||'/'||version.project_id||'/'||p_version_id||'/'||p_sha256_hash||'.pdf';
  if p_file_path is distinct from expected_path then raise exception using errcode='23514',message='ESTIMATE_PDF_PATH_INVALID'; end if;
  snapshot_version:=p_client_contract_snapshot->'version';
  if snapshot_version is distinct from jsonb_build_object('id',version.id,'tenantId',version.tenant_id,'projectId',version.project_id,
    'number',version.version_number,'contentRevision',version.content_revision,'calcEngineVersion',version.calc_engine_version,
    'dateDevis',version.date_devis,'validiteJours',version.validite_jours,'currency',version.currency,
    'contractorRole',version.contractor_role,'taxRateBp',version.tax_rate_bp)
    or p_client_contract_snapshot->'exclusions' is distinct from coalesce(to_jsonb(version.exclusions),'null'::jsonb)
    or p_client_contract_snapshot->'issuer'->>'userId' is distinct from p_actor_user_id::text
    or public.estimate_offer_client_items_match(p_client_contract_snapshot,version) is distinct from true
    or (p_client_contract_snapshot->'totals'->>'saleHtCents')::bigint is distinct from version.total_ht_cents::bigint
    or (p_client_contract_snapshot->'totals'->>'payableTtcCents')::bigint is distinct from version.total_ttc_cents::bigint
    or (p_client_contract_snapshot->'totals'->>'roundingAdjustmentCents')::bigint is distinct from coalesce(version.rounding_adjustment_cents,0)::bigint
    or (p_client_contract_snapshot->'totals'->>'taxCents')::bigint is distinct from (version.total_tax_cents-coalesce(version.rounding_adjustment_cents,0))::bigint then
    raise exception using errcode='23514',message='OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH';
  end if;
  if document.generation_token is distinct from p_generation_token then
    if document.generation_token is null and document.published_generation_token=p_generation_token and document.status='ready'
      and document.client_contract_version=1 and document.file_path=p_file_path and document.sha256_hash=p_sha256_hash
      and document.file_size_bytes=p_file_size_bytes and document.generated_at=p_generated_at and document.generated_by=p_actor_user_id
      and document.layout_options=p_layout_options and document.terms_snapshot is not distinct from p_terms_snapshot
      and document.client_contract_snapshot=p_client_contract_snapshot and document.published_content_revision=version.content_revision
      and public.estimate_offer_document_valid(document,version,false) then return document; end if;
    raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;
  if document.generated_by is distinct from p_actor_user_id or document.generation_content_revision is distinct from version.content_revision then
    raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;
  if document.generation_purpose in('manual','workflow') then
    if version.status<>'draft' or document.generation_dispatch_id is not null then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
    identity_snapshot:=public.capture_estimate_offer_identity(version,p_actor_user_id,p_client_contract_snapshot->'company');
  elsif document.generation_purpose='email' then
    if version.status<>'sending' then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
    select e.* into dispatch from public.estimate_emails e where e.id=document.generation_dispatch_id and e.tenant_id=p_tenant_id
      and e.version_id=p_version_id and e.created_by=p_actor_user_id for update;
    if dispatch.id is null or dispatch.status<>'preparing' or dispatch.version_content_revision is distinct from document.generation_content_revision then
      raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
    end if;
    if dispatch.request_contract_version<>2 or dispatch.offer_identity_snapshot is null then
      raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY';
    end if;
    identity_snapshot:=dispatch.offer_identity_snapshot;
  else raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
  if identity_snapshot->'project' is distinct from p_client_contract_snapshot->'project'
    or identity_snapshot->'issuer' is distinct from p_client_contract_snapshot->'issuer'
    or identity_snapshot->'company' is distinct from p_client_contract_snapshot->'company' then
    raise exception using errcode='23514',message='OFFER_CLIENT_IDENTITY_MISMATCH';
  end if;
  update public.estimate_documents set status='ready',last_error=null,file_path=expected_path,sha256_hash=p_sha256_hash,
    file_size_bytes=p_file_size_bytes,generated_by=p_actor_user_id,generated_at=p_generated_at,layout_options=p_layout_options,
    terms_snapshot=p_terms_snapshot,client_contract_version=1,client_contract_snapshot=p_client_contract_snapshot,
    published_generation_token=p_generation_token,published_purpose=document.generation_purpose,published_dispatch_id=document.generation_dispatch_id,
    published_content_revision=document.generation_content_revision,generation_token=null,generation_purpose=null,generation_dispatch_id=null,
    generation_content_revision=null,generation_started_at=null where id=document.id and generation_token=p_generation_token returning * into published;
  if published.id is null then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
  return published;
end;
$$;
revoke all on function public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) to service_role;

drop function public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text);
create function public.prepare_estimate_email_dispatch(
  p_dispatch_id uuid,p_tenant_id uuid,p_actor_user_id uuid,p_seal_hash text,p_provider_payload_hash text,p_html_body text,p_text_body text,
  p_document_path text,p_document_sha256 text,p_attachment_filename text,p_expected_document_contract jsonb,p_seal_payload_version smallint
) returns public.estimate_emails language plpgsql security invoker set search_path='' as $$
declare dispatch public.estimate_emails; version public.estimate_versions; document public.estimate_documents;
  prepared public.estimate_emails; expected_identity jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$' or p_provider_payload_hash is null or p_provider_payload_hash !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_html_body,''))=0 or length(coalesce(p_text_body,''))=0 or length(btrim(coalesce(p_document_path,'')))=0
    or p_document_sha256 is null or p_document_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(coalesce(p_attachment_filename,'')))=0 then
    raise exception using errcode='22023',message='ESTIMATE_EMAIL_PREPARED_PAYLOAD_INVALID';
  end if;
  select e.* into dispatch from public.estimate_emails e where e.id=p_dispatch_id and e.tenant_id=p_tenant_id and e.request_id is not null for update;
  if dispatch.id is null then raise exception using errcode='P0001',message='ESTIMATE_EMAIL_DISPATCH_NOT_FOUND'; end if;
  select v.* into version from public.estimate_versions v where v.id=dispatch.version_id and v.tenant_id=dispatch.tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  -- Decision owns version→tenant. Acquire the version before actor's tenant /
  -- membership SHARE locks, never tenant SHARE while waiting for that version.
  perform public.assert_estimate_offer_actor(dispatch.tenant_id,dispatch.version_id,p_actor_user_id);
  select d.* into document from public.estimate_documents d where d.version_id=dispatch.version_id and d.tenant_id=dispatch.tenant_id for share;
  if not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version)
    or document.file_path is distinct from p_document_path or document.sha256_hash is distinct from p_document_sha256 then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if document.client_contract_version=1 then
    if p_seal_payload_version is distinct from 5 then raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED'; end if;
    expected_identity:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
      'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
      'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    if dispatch.request_contract_version=2 and dispatch.offer_identity_snapshot is distinct from expected_identity then
      raise exception using errcode='23514',message='OFFER_CLIENT_IDENTITY_MISMATCH';
    end if;
  elsif version.seal_payload_version=5 or p_seal_payload_version=5 or p_seal_payload_version is null
    or p_seal_payload_version not between 1 and 4 then raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED'; end if;
  if dispatch.status<>'preparing' then
    if dispatch.status in('queued','processing','sent','delivered','bounced') and dispatch.provider_payload_hash=p_provider_payload_hash
      and dispatch.html_body=p_html_body and dispatch.text_body=p_text_body and dispatch.document_path=p_document_path
      and dispatch.document_sha256=p_document_sha256 and dispatch.attachment_filename=p_attachment_filename
      and lower(version.seal_hash)=p_seal_hash and (version.seal_payload_version is not distinct from p_seal_payload_version
        or (version.seal_payload_version is null and p_seal_payload_version between 1 and 4)) then return dispatch; end if;
    raise exception using errcode='40001',message='ESTIMATE_EMAIL_PREPARE_STATE_CONFLICT';
  end if;
  if dispatch.request_contract_version=1 then raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY'; end if;
  if version.status='sending' then
    if document.client_contract_version is distinct from 1 or document.published_purpose is distinct from 'email'
      or document.published_dispatch_id is distinct from dispatch.id then raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH'; end if;
    if version.seal_hash is not null and lower(version.seal_hash)<>p_seal_hash then raise exception using errcode='23514',message='ESTIMATE_SEAL_MISMATCH'; end if;
    if version.seal_hash is null then update public.estimate_versions set seal_hash=p_seal_hash,seal_payload_version=5 where id=version.id; end if;
  elsif version.status in('sent','accepted','archived') then
    if lower(coalesce(version.seal_hash,''))<>p_seal_hash then raise exception using errcode='23514',message='ESTIMATE_SEAL_MISMATCH'; end if;
  else raise exception using errcode='40001',message='ESTIMATE_EMAIL_PREPARE_VERSION_STATE_CONFLICT'; end if;
  update public.estimate_emails set status='queued',provider_payload_hash=p_provider_payload_hash,html_body=p_html_body,text_body=p_text_body,
    document_path=p_document_path,document_sha256=p_document_sha256,attachment_filename=p_attachment_filename,next_attempt_at=now(),
    last_error_code=null,last_error_message=null where id=dispatch.id returning * into prepared;
  insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
    values(prepared.tenant_id,prepared.version_id,prepared.id,'prepared',jsonb_build_object('document_path',prepared.document_path,
      'document_sha256',prepared.document_sha256,'provider_payload_hash',prepared.provider_payload_hash),p_actor_user_id);
  return prepared;
end;
$$;
revoke all on function public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,smallint) from public,anon,authenticated;
grant execute on function public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,smallint) to service_role;

drop function public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz);
create function public.transition_estimate_version_status(
  p_version_id uuid,p_tenant_id uuid,p_expected_updated_at timestamptz,p_next_status public.estimate_status,p_seal_hash text,
  p_actor_user_id uuid,p_event_metadata jsonb,p_occurred_at timestamptz,p_seal_payload_version smallint,p_expected_document_contract jsonb
) returns public.estimate_versions language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; document public.estimate_documents; updated public.estimate_versions;
  event_type text; metadata jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select v.* into version from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  if version.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  event_type:=case p_next_status when 'sent' then 'sent' when 'accepted' then 'accepted' when 'archived' then 'archived' else null end;
  if event_type is null then raise exception using errcode='22023',message='ESTIMATE_STATUS_TRANSITION_INVALID'; end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
  if not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if version.status='draft' and p_next_status='sent' then
    if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$' or p_seal_payload_version is distinct from 5
      or document.client_contract_version is distinct from 1 or document.published_purpose not in('manual','workflow')
      or document.published_dispatch_id is not null then raise exception using errcode='23514',message='OFFER_MANUAL_EMISSION_CONTRACT_REQUIRED'; end if;
    if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
      and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
  else
    if p_seal_hash is not null then raise exception using errcode='22023',message='ESTIMATE_SEAL_UNEXPECTED'; end if;
    if document.client_contract_version=1 and (version.seal_payload_version is distinct from 5 or p_seal_payload_version is distinct from 5) then
      raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED';
    elsif document.client_contract_version is null and (p_seal_payload_version is null or p_seal_payload_version not between 1 and 4) then
      raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED';
    end if;
  end if;
  update public.estimate_versions set status=p_next_status,
    seal_hash=case when p_next_status='sent' then p_seal_hash else version.seal_hash end,
    seal_payload_version=case when p_next_status='sent' then 5 else version.seal_payload_version end
    where id=version.id and tenant_id=version.tenant_id and updated_at=version.updated_at returning * into updated;
  if updated.id is null then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  metadata:=coalesce(p_event_metadata,'{}')||jsonb_build_object('previous_status',version.status,'next_status',p_next_status);
  if p_seal_hash is not null then metadata:=metadata||jsonb_build_object('seal_hash',p_seal_hash,'seal_payload_version',5); end if;
  perform public.log_estimate_version_event(version.id,event_type,p_actor_user_id,metadata,coalesce(p_occurred_at,now()));
  return updated;
end;
$$;
revoke all on function public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb) from public,anon,authenticated;
grant execute on function public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb) to service_role;

drop function public.claim_portal_estimate_decision(uuid,text,inet,text);
create function public.claim_portal_estimate_decision(
  p_portal_token_id uuid,p_decision text,p_client_ip inet,p_reject_reason text,p_expected_seal_hash text,p_expected_document_contract jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare token public.portal_tokens; version public.estimate_versions; document public.estimate_documents;
  dispatch public.estimate_emails; decided_at timestamptz:=clock_timestamp(); metadata jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_decision not in('accepted','rejected') or p_decision is null then raise exception using errcode='22023',message='invalid portal decision'; end if;
  select * into token from public.portal_tokens where id=p_portal_token_id;
  if token.id is null then raise exception using errcode='P0001',message='portal capability is no longer claimable'; end if;
  select v.* into version from public.estimate_versions v join public.tenants t on t.id=v.tenant_id and t.is_active
    where v.id=token.version_id and v.tenant_id=token.tenant_id for update of v,t;
  if version.id is null or version.status<>'sent' then raise exception using errcode='P0001',message='estimate version is no longer claimable'; end if;
  select * into token from public.portal_tokens where id=p_portal_token_id and version_id=version.id and tenant_id=version.tenant_id for update;
  if token.id is null or token.status<>'pending' or token.expires_at<=decided_at then
    raise exception using errcode='P0001',message='portal capability is no longer claimable';
  end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
  if p_expected_seal_hash is null or p_expected_seal_hash !~ '^[0-9a-f]{64}$' or lower(version.seal_hash) is distinct from p_expected_seal_hash
    or not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version)
    or (document.client_contract_version=1 and version.seal_payload_version is distinct from 5)
    or (version.seal_payload_version=5 and document.client_contract_version is distinct from 1) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if token.capability_contract_version=2 then
    -- Do not lock the dispatch: completion owns dispatch→version. A committed
    -- successful dispatch is immutable. Uncommitted processing/success refuses
    -- and can be retried after completion; parent sent alone never suffices.
    select e.* into dispatch from public.estimate_emails e where e.id=token.estimate_email_dispatch_id;
    if dispatch.id is null or dispatch.tenant_id is distinct from token.tenant_id or dispatch.version_id is distinct from token.version_id
      or dispatch.request_contract_version<>2 or dispatch.type<>'initial' or dispatch.recipient is distinct from token.email
      or dispatch.portal_url not like '%/portal/'||token.token::text or dispatch.status not in('sent','delivered','bounced')
      or length(btrim(coalesce(dispatch.provider_id,'')))=0 or dispatch.sent_at is null
      or dispatch.document_path is distinct from document.file_path or dispatch.document_sha256 is distinct from document.sha256_hash
      or dispatch.version_content_revision is distinct from document.published_content_revision then
      raise exception using errcode='P0001',message='offer dispatch is not successfully emitted';
    end if;
  elsif token.capability_contract_version is distinct from 1 or token.estimate_email_dispatch_id is not null
    or document.client_contract_version is not null or document.client_contract_snapshot is not null or version.seal_payload_version=5 then
    raise exception using errcode='23514',message='OFFER_CAPABILITY_CONTRACT_INVALID';
  end if;
  update public.portal_tokens set status=p_decision,accepted_at=case when p_decision='accepted' then decided_at else null end,
    accepted_ip=case when p_decision='accepted' then p_client_ip else null end,
    reject_reason=case when p_decision='rejected' then nullif(left(btrim(p_reject_reason),1000),'') else null end where id=token.id;
  update public.estimate_versions set status=case when p_decision='accepted' then 'accepted'::public.estimate_status else 'archived'::public.estimate_status end
    where id=version.id and tenant_id=version.tenant_id and status='sent';
  if not found then raise exception using errcode='P0001',message='estimate version decision lost its concurrency claim'; end if;
  update public.portal_tokens set status='expired' where version_id=version.id and tenant_id=version.tenant_id and id<>token.id and status='pending';
  metadata:=jsonb_build_object('portal_token_id',token.id,case when p_decision='accepted' then 'accepted_via' else 'rejected_via' end,'portal');
  if p_decision='accepted' then metadata:=metadata||jsonb_build_object('client_ip',p_client_ip);
  elsif nullif(left(btrim(p_reject_reason),1000),'') is not null then metadata:=metadata||jsonb_build_object('reason',left(btrim(p_reject_reason),1000)); end if;
  perform public.log_estimate_version_event(version.id,p_decision,null,metadata,decided_at);
end;
$$;
revoke all on function public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb) to service_role;

create function public.assert_estimate_offer_dispatch_proof(dispatch public.estimate_emails,version public.estimate_versions)
returns void language plpgsql security invoker set search_path='' as $$
declare document public.estimate_documents; identity_snapshot jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if dispatch.request_contract_version=1 then return; end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id;
  if dispatch.request_contract_version<>2 or dispatch.version_id is distinct from version.id or dispatch.tenant_id is distinct from version.tenant_id
    or not public.estimate_offer_document_valid(document,version,true) or dispatch.document_path is distinct from document.file_path
    or dispatch.document_sha256 is distinct from document.sha256_hash or dispatch.version_content_revision is distinct from document.published_content_revision
    or version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$'
    or not exists(select 1 from public.portal_tokens t where t.estimate_email_dispatch_id=dispatch.id and t.capability_contract_version=2
      and t.version_id=dispatch.version_id and t.tenant_id=dispatch.tenant_id and t.email=dispatch.recipient
      and dispatch.portal_url like '%/portal/'||t.token::text) then
    raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
  end if;
  if document.client_contract_version=1 then
    identity_snapshot:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
      'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
      'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    if version.seal_payload_version is distinct from 5 or dispatch.offer_identity_snapshot is distinct from identity_snapshot then
      raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
    end if;
  elsif dispatch.offer_identity_snapshot is not null or version.seal_payload_version=5 then
    raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
  end if;
end;
$$;
revoke all on function public.assert_estimate_offer_dispatch_proof(public.estimate_emails,public.estimate_versions) from public,anon,authenticated;
grant execute on function public.assert_estimate_offer_dispatch_proof(public.estimate_emails,public.estimate_versions) to service_role;

create function public.guard_estimate_offer_seal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare document public.estimate_documents;
begin
  if new.seal_payload_version is distinct from old.seal_payload_version and current_user<>'service_role' then
    raise exception using errcode='42501',message='OFFER_SEAL_VERSION_REQUIRES_TRUSTED_WORKFLOW';
  end if;
  if old.status='sending' and new.status='draft' and new.seal_hash is null then
    -- Known no-provider-side-effect recovery. Keep document1, never downgrade
    -- it to manufacture a legacy fallback. All existing release RPCs benefit.
    new.seal_payload_version:=null;
    return new;
  end if;
  if old.seal_payload_version=5 and new.seal_payload_version is distinct from old.seal_payload_version then
    raise exception using errcode='42501',message='OFFER_SEAL_VERSION_IMMUTABLE';
  end if;
  if new.seal_payload_version=5 and (new.seal_hash is null or new.seal_hash !~ '^[0-9a-fA-F]{64}$') then
    raise exception using errcode='23514',message='OFFER_SEAL_VERSION_REQUIRES_SEAL';
  end if;
  if (old.seal_hash is null and new.seal_hash is not null) or new.seal_payload_version=5 then
    select d.* into document from public.estimate_documents d where d.version_id=new.id and d.tenant_id=new.tenant_id;
    if new.seal_payload_version is distinct from 5 or document.client_contract_version is distinct from 1
      or not public.estimate_offer_document_valid(document,new,false) then
      raise exception using errcode='23514',message='OFFER_NEW_EMISSION_CONTRACT_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
-- After the established aaa workflow/revision guard, before readonly checks.
create trigger aab_guard_estimate_offer_seal before update on public.estimate_versions
  for each row execute function public.guard_estimate_offer_seal();
revoke all on function public.guard_estimate_offer_seal() from public,anon,authenticated;

-- Existing signatures/owners/ACLs remain; targeted bodies preserve their leases,
-- provider replay, recovery and event behavior. Request1 is never rebuilt.
create or replace function public.guard_estimate_email_dispatch_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.request_contract_version is distinct from old.request_contract_version
    or new.portal_url is distinct from old.portal_url
    or new.offer_identity_snapshot is distinct from old.offer_identity_snapshot then
    raise exception using errcode = '42501', message = 'OFFER_DISPATCH_CONTRACT_IMMUTABLE';
  end if;
  if old.request_contract_version=2 and old.type='initial' and new.created_by is distinct from old.created_by then
    raise exception using errcode='42501',message='OFFER_DISPATCH_ACTOR_IMMUTABLE';
  end if;
  -- Compatibility path for acceptance_confirmation and all historical rows.
  if old.request_id is null and new.request_id is null then
    return new;
  end if;

  if old.request_id is null or new.request_id is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_REQUEST_ID_IMMUTABLE';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.version_id is distinct from old.version_id
    or new.request_id is distinct from old.request_id
    or new.payload_hash is distinct from old.payload_hash
    or new.idempotency_key is distinct from old.idempotency_key
    or new.version_content_revision is distinct from old.version_content_revision
    or new.from_address is distinct from old.from_address
    or new.recipient is distinct from old.recipient
    or new.cc is distinct from old.cc
    or new.subject is distinct from old.subject
    or new.body is distinct from old.body
    or new.type is distinct from old.type
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_ENVELOPE_IMMUTABLE';
  end if;

  if (
    new.provider_payload_hash is distinct from old.provider_payload_hash
    or new.html_body is distinct from old.html_body
    or new.text_body is distinct from old.text_body
    or new.document_path is distinct from old.document_path
    or new.document_sha256 is distinct from old.document_sha256
    or new.attachment_filename is distinct from old.attachment_filename
  ) and not (old.status = 'preparing' and new.status = 'queued') then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_PAYLOAD_IMMUTABLE';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'preparing' and new.status in ('queued', 'failed'))
    or (old.status = 'queued' and new.status in ('processing', 'failed', 'unknown'))
    or (old.status = 'processing' and new.status in ('queued', 'sent', 'failed', 'unknown'))
    or (old.status = 'unknown' and new.status in ('sent', 'failed'))
    or (old.status = 'failed' and new.status = 'preparing')
    or (old.status = 'sent' and new.status in ('delivered', 'bounced'))
  ) then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_STATUS_TRANSITION_INVALID';
  end if;

  if new.attempt_count < old.attempt_count then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_ATTEMPT_COUNT_DECREASED';
  end if;

  if old.provider_id is not null and new.provider_id is distinct from old.provider_id then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_PROVIDER_ID_IMMUTABLE';
  end if;

  if old.status in ('sent', 'delivered', 'bounced')
    and new.sent_at is distinct from old.sent_at then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_SENT_AT_IMMUTABLE';
  end if;

  if new.request_id is not null and new.status in ('sent', 'delivered', 'bounced')
    and (new.provider_id is null or new.sent_at is null)
  then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_SENT_PROOF_REQUIRED';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if (
      to_jsonb(new) - array['status', 'seal_hash', 'seal_payload_version', 'updated_at']
    ) is distinct from (
      to_jsonb(old) - array['status', 'seal_hash', 'seal_payload_version', 'updated_at']
    ) then
      raise exception 'Estimate version is read-only';
    end if;

    if old.status = 'sending' then
      if new.status = old.status and not (
        old.seal_hash is null
        and new.seal_hash is not null
        and new.seal_hash ~ '^[0-9a-fA-F]{64}$'
      ) then
        raise exception 'Estimate version is read-only';
      end if;
    else
      if new.status = old.status
        or new.seal_hash is distinct from old.seal_hash
      then
        raise exception 'Estimate version is read-only';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.begin_estimate_pdf_generation(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_purpose text,
  p_dispatch_id uuid default null
)
returns public.estimate_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_dispatch public.estimate_emails%rowtype;
  claimed_document public.estimate_documents%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose not in ('manual', 'email', 'workflow') then
    raise exception using errcode = '22023', message = 'ESTIMATE_PDF_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);

  if p_purpose in ('manual', 'workflow') then
    if p_dispatch_id is not null or target_version.status <> 'draft'::public.estimate_status then
      raise exception using errcode = '42501', message = 'ESTIMATE_PDF_STATUS_FORBIDDEN';
    end if;
  else
    if p_dispatch_id is null
      or target_version.status <> 'sending'::public.estimate_status
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_EMAIL_STATE_CONFLICT';
    end if;

    select dispatch.*
      into target_dispatch
    from public.estimate_emails dispatch
    where dispatch.id = p_dispatch_id
      and dispatch.tenant_id = p_tenant_id
      and dispatch.version_id = p_version_id
      and dispatch.created_by = p_actor_user_id
      and dispatch.request_id is not null
    for update;

    if target_dispatch.request_contract_version = 1 then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY';
    end if;

    if target_dispatch.id is null
      or target_dispatch.status <> 'preparing'
      or target_dispatch.version_content_revision is distinct from target_version.content_revision
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_EMAIL_STATE_CONFLICT';
    end if;
  end if;

  insert into public.estimate_documents (
    tenant_id,
    version_id,
    status,
    last_error,
    generated_by,
    generation_token,
    generation_purpose,
    generation_dispatch_id,
    generation_content_revision,
    generation_started_at
  ) values (
    p_tenant_id,
    p_version_id,
    'processing',
    null,
    p_actor_user_id,
    next_token,
    p_purpose,
    p_dispatch_id,
    target_version.content_revision,
    clock_timestamp()
  )
  on conflict (tenant_id, version_id)
  do update set
    status = 'processing',
    last_error = null,
    generated_by = excluded.generated_by,
    generation_token = excluded.generation_token,
    generation_purpose = excluded.generation_purpose,
    generation_dispatch_id = excluded.generation_dispatch_id,
    generation_content_revision = excluded.generation_content_revision,
    generation_started_at = excluded.generation_started_at
  returning * into claimed_document;

  return claimed_document;
end;
$$;

create or replace function public.complete_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_provider_id text,
  p_sent_at timestamptz default now()
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  completed_dispatch public.estimate_emails%rowtype;
  previous_version_status public.estimate_status;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if length(trim(coalesce(p_provider_id, ''))) = 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  if target_dispatch.status in ('sent', 'delivered', 'bounced') then
    if target_dispatch.provider_id is distinct from trim(p_provider_id) then
      raise exception using errcode = '23505', message = 'ESTIMATE_EMAIL_PROVIDER_ID_CONFLICT';
    end if;
    return target_dispatch;
  end if;

  if target_dispatch.status <> 'processing'
    or target_dispatch.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_COMPLETION_LEASE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  perform public.assert_estimate_offer_dispatch_proof(target_dispatch,target_version);
  previous_version_status := target_version.status;
  if target_version.status = 'sending'::public.estimate_status then
    update public.estimate_versions version
    set status = 'sent'::public.estimate_status
    where version.id = target_version.id
      and version.tenant_id = target_version.tenant_id;
  elsif target_version.status not in (
    'sent'::public.estimate_status,
    'accepted'::public.estimate_status,
    'archived'::public.estimate_status
  ) then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_COMPLETION_VERSION_STATE_CONFLICT';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'sent',
    provider_id = trim(p_provider_id),
    sent_at = coalesce(p_sent_at, now()),
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_code = null,
    last_error_message = null
  where dispatch.id = target_dispatch.id
  returning dispatch.* into completed_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    completed_dispatch.tenant_id,
    completed_dispatch.version_id,
    completed_dispatch.id,
    'sent',
    jsonb_build_object(
      'provider_id', completed_dispatch.provider_id,
      'attempt_count', completed_dispatch.attempt_count,
      'previous_version_status', previous_version_status
    ),
    target_dispatch.created_by
  );

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  ) values (
    completed_dispatch.tenant_id,
    completed_dispatch.version_id,
    'sent',
    jsonb_build_object(
      'dispatch_id', completed_dispatch.id,
      'provider_id', completed_dispatch.provider_id,
      'previous_status', previous_version_status,
      'next_status', case
        when previous_version_status = 'sending'::public.estimate_status then 'sent'
        else previous_version_status::text
      end,
      'resend', previous_version_status <> 'sending'::public.estimate_status
    ),
    target_dispatch.created_by,
    completed_dispatch.sent_at
  );

  return completed_dispatch;
end;
$$;

create or replace function public.reconcile_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_resolution text,
  p_actor_user_id uuid,
  p_provider_id text default null,
  p_note text default null
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  reconciled_dispatch public.estimate_emails%rowtype;
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  reconciliation_time timestamptz := now();
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if normalized_resolution not in ('sent', 'failed') then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_RECONCILIATION_INVALID';
  end if;

  if normalized_resolution = 'sent'
    and length(trim(coalesce(p_provider_id, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    target_dispatch.tenant_id,
    target_dispatch.version_id,
    p_actor_user_id,
    true
  );

  if target_dispatch.status <> 'unknown' then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_STATE_CONFLICT';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if normalized_resolution = 'sent' then
    perform public.assert_estimate_offer_dispatch_proof(target_dispatch,target_version);
    if target_version.status = 'sending'::public.estimate_status then
      update public.estimate_versions version
      set status = 'sent'::public.estimate_status
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    elsif target_version.status not in (
      'sent'::public.estimate_status,
      'accepted'::public.estimate_status,
      'archived'::public.estimate_status
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_VERSION_STATE_CONFLICT';
    end if;

    update public.estimate_emails dispatch
    set
      status = 'sent',
      provider_id = trim(p_provider_id),
      sent_at = reconciliation_time,
      last_error_code = null,
      last_error_message = null
    where dispatch.id = target_dispatch.id
    returning dispatch.* into reconciled_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      reconciled_dispatch.tenant_id,
      reconciled_dispatch.version_id,
      reconciled_dispatch.id,
      'reconciled_sent',
      jsonb_build_object(
        'provider_id', reconciled_dispatch.provider_id,
        'note', p_note,
        'previous_version_status', target_version.status
      ),
      p_actor_user_id
    );

    perform public.log_estimate_version_event(
      reconciled_dispatch.version_id,
      'sent',
      p_actor_user_id,
      jsonb_build_object(
        'dispatch_id', reconciled_dispatch.id,
        'provider_id', reconciled_dispatch.provider_id,
        'reconciled', true,
        'previous_status', target_version.status,
        'next_status', case
          when target_version.status = 'sending'::public.estimate_status then 'sent'
          else target_version.status::text
        end
      ),
      reconciliation_time
    );
  else
    if target_version.status = 'sending'::public.estimate_status then
      update public.estimate_versions version
      set
        status = 'draft'::public.estimate_status,
        seal_hash = null
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    elsif target_version.status not in (
      'sent'::public.estimate_status,
      'accepted'::public.estimate_status,
      'archived'::public.estimate_status
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_VERSION_STATE_CONFLICT';
    end if;

    update public.estimate_emails dispatch
    set
      status = 'failed',
      last_error_code = 'RECONCILED_FAILED',
      last_error_message = left(coalesce(p_note, 'Provider delivery was not confirmed.'), 2000)
    where dispatch.id = target_dispatch.id
    returning dispatch.* into reconciled_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      reconciled_dispatch.tenant_id,
      reconciled_dispatch.version_id,
      reconciled_dispatch.id,
      'reconciled_failed',
      jsonb_build_object(
        'note', p_note,
        'version_released_to_draft', target_version.status = 'sending'::public.estimate_status
      ),
      p_actor_user_id
    );
  end if;

  return reconciled_dispatch;
end;
$$;

commit;
