"""One explicitly approved local CORE07 application; never automatic or remote.

Default is offline validation. --execute additionally requires an approval
reference, exact reviewed SHA, and a fresh exclusive receipt directory.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(__file__).resolve().parent
CONFIG = ROOT / '.e2e/retro-runtime/config/recipe-go-20261012-03/native-config.json'
CONFIG_SHA = '1be0fbd0e439ea6cac061d7fe5c66ea608ed9dab5c5e9d1376a7dd6bc5bfbcf0'
MIGRATION = ROOT / 'supabase/migrations/20261012215942_generated_ouvrage_component_decisions.sql'
MIGRATION_SHA = '7638482293bfe35b39a4defde39c9bd427c900dd715829ff61c8ed11d26573ef'
QUALIFICATION = ROOT / '.e2e/core07-sql/candidate-corrected-20261013-01/results/receipt.json'
QUALIFICATION_SHA = 'eb1252ff38905d06490f095bd89f2fecf8ab91812ca43c5c7cbb5c844132f547'
VERSION = '20261012215942'
NAME = 'generated_ouvrage_component_decisions'
CHANGED = {('public','persist_generated_ouvrage_review'),('private','generated_ouvrage_components'),
           ('public','commit_generated_ouvrages'),('private','source_coverage_target')}
NEW = {('private','generated_ouvrage_component_content')}

def sha(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def require(condition,message):
    if not condition: raise RuntimeError(message)
def save(out,name,value):
    with (out/name).open('x',encoding='utf-8') as file: file.write(json.dumps(value,indent=2)+'\n')
def sql_literal(value): return "'"+value.replace("'","''")+"'"

def validate_sources():
    require(sha(CONFIG)==CONFIG_SHA and sha(MIGRATION)==MIGRATION_SHA and sha(QUALIFICATION)==QUALIFICATION_SHA,'Reviewed source/qualification SHA differs')
    proof=json.loads(QUALIFICATION.read_text());directory=QUALIFICATION.parent
    require(proof['status']=='verified' and proof['rollbackVerified'] and proof['dataConserved'] and proof['catalogConserved'] and proof['privilegesConserved'],'Verified qualification required')
    require([(r['kind'],r['cases'],r['passed'],r['failed']) for r in proof['suites']]==[('components',39,39,0),('atomic',100,100,0),('cctp',34,34,0)],'Exact three-suite qualification required')
    require({p.name for p in directory.iterdir()}=={'receipt.json',*[r['name'] for r in proof['artifacts']]},'Qualification artifact inventory differs')
    for entry in proof['artifacts']:
        file=directory/entry['name'];require(file.name==entry['name'] and not file.is_symlink() and file.resolve().parent==directory.resolve() and sha(file)==entry['sha256'],'Qualification artifact escaped or changed')
    for name,digest in proof['sources'].items():
        if not name.startswith('docs/'):
            require(sha(ROOT/name)==digest,'Qualified executable source changed')
    require(all((directory/'before.json').read_bytes()==(directory/f'after-{kind}.json').read_bytes() for kind in ('components','atomic','cctp')),'Rollback conservation proof differs')
    return proof

def assertion_sql(definitions):
    payload=sql_literal(json.dumps(definitions['functions'],ensure_ascii=False))
    return """do $core07_install_assert$
declare expected jsonb; actual record;
begin
  for expected in select value from jsonb_array_elements("""+payload+"""::jsonb) loop
    select p.*,pg_get_userbyid(p.proowner) owner_name,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=pg_catalog.to_regprocedure(expected->>'signature');
    if not found or actual.owner_name<>'postgres' or btrim(actual.prosrc,E' \\n\\r\\t')<>expected->>'body'
      or actual.prosecdef is distinct from (expected->>'definer')::boolean or to_jsonb(actual.proconfig) is distinct from expected->'config'
      or actual.lanname is distinct from expected->>'language' or actual.provolatile::text is distinct from expected->>'volatility'
      or has_function_privilege('authenticated',actual.oid,'EXECUTE') is distinct from (expected->>'authenticated')::boolean
      or has_function_privilege('service_role',actual.oid,'EXECUTE') is distinct from (expected->>'service')::boolean
      or has_function_privilege('anon',actual.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) where grantee=0 and privilege_type='EXECUTE')
    then raise exception 'CORE07_INSTALL_BODY_ACL_MISMATCH'; end if;
  end loop;
end $core07_install_assert$;
"""

def build_application(native):
    definitions={}
    for kind in ('generated','cctp'):
        describe=subprocess.run([native.CONFIG['nodePath'],str(BASE/f'{kind}-native-contract.mjs'),'--describe'],env=native.safe_env(),capture_output=True,text=True,timeout=45)
        require(describe.returncode==0,'Current declaration oracle failed');definitions[kind]=json.loads(describe.stdout)
    source=MIGRATION.read_text();require(source.startswith('begin;\n') and source.rstrip().endswith('commit;'),'Candidate transaction boundary differs')
    inner=source[len('begin;\n'):source.rfind('commit;')]
    script='BEGIN;\nSET LOCAL standard_conforming_strings=on;\n'+inner+'\n'+assertion_sql(definitions['generated'])+assertion_sql(definitions['cctp'])
    script+='insert into supabase_migrations.schema_migrations(version,name,statements) values('+sql_literal(VERSION)+','+sql_literal(NAME)+',array['+sql_literal(source)+']::text[]);\nCOMMIT;\n'
    return script,definitions,source

def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--validate-only',action='store_true');mode.add_argument('--execute',action='store_true')
    parser.add_argument('--approval-reference');parser.add_argument('--output');parser.add_argument('--migration-sha',required=True)
    args=parser.parse_args();require(args.migration_sha==MIGRATION_SHA,'Exact reviewed migration SHA required')
    validate_sources()
    spec=importlib.util.spec_from_file_location('native_core07_apply',BASE/'local-native.py');native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
    target=native.configure(json.loads(CONFIG.read_text()))
    if args.validate_only:
        preparation=None
        if args.output:
            out=native.owned(args.output);out.mkdir(exist_ok=False);script,definitions,source=build_application(native)
            (out/'application.sql').write_text(script)
            save(out,'plan.json',{'schemaVersion':'core07-local-application-plan-1','status':'prepared-no-database-access','databaseAccess':False,'migrationApplied':False,
                                 'target':{'apiPort':45585,'dbPort':33485,'systemIdentifier':target['systemIdentifier'],'serverVersionNum':target['serverVersionNum']},
                                 'migrationSha256':MIGRATION_SHA,'qualificationSha256':QUALIFICATION_SHA,'scriptSha256':sha(__file__),'applicationSqlSha256':sha(out/'application.sql'),
                                 'atomicHistory':True,'backfill':False,'permissionRequiredBeforeExecution':True,
                                 'expectedFunctions':{kind:[r['signature'] for r in value['functions']] for kind,value in definitions.items()}})
            preparation=(out/'plan.json').relative_to(ROOT).as_posix()
        print(json.dumps({'status':'validated-offline','databaseAccess':False,'migrationApplied':False,'migrationSha256':MIGRATION_SHA,'plan':preparation}));return
    require(args.approval_reference and args.approval_reference.strip() and args.output,'Explicit prior user approval and new receipt directory required')
    out=native.owned(args.output);out.mkdir(exist_ok=False)
    receipt={'schemaVersion':'core07-local-application-1','status':'requested','phase':'preflight','approvalReference':args.approval_reference,
             'configSha256':CONFIG_SHA,'migrationSha256':MIGRATION_SHA,'qualificationSha256':QUALIFICATION_SHA,'scriptSha256':sha(__file__),
             'target':{'apiPort':45585,'dbPort':33485,'systemIdentifier':target['systemIdentifier'],'serverVersionNum':target['serverVersionNum']},
             'backfill':False,'reset':False,'remote':False,'migrationApplied':None,'limits':['Explicit local application only; no browser, pgTAP, real concurrency or production qualification.']}
    save(out,'requested.json',receipt)
    read=lambda sql:native.query(target,sql)
    def inspect():
        guards=native.guards(read,verify=False);return {'guards':guards,'data':native.rows(read,guards['catalog']['dataTables'])}
    proc=None;before=None
    try:
        before=inspect();save(out,'before.json',before)
        inventory=native.inventory(ROOT/'supabase/migrations');stack=Path(target['stackDirectory'])/'supabase/migrations';copied=native.inventory(stack)
        old_inventory=[r for r in inventory if r['name']!=MIGRATION.name]
        require([r for r in copied if r['name']!=MIGRATION.name]==old_inventory,'Preexisting copied migration files differ')
        require({r['version'] for r in before['guards']['catalog']['migrations']}=={r['name'].split('_',1)[0] for r in old_inventory} and VERSION not in {r['version'] for r in before['guards']['catalog']['migrations']},'Only exact candidate may be pending')
        columns={r['name']:r['type'] for r in before['guards']['catalog']['historyColumns']}
        require(all(columns.get(name)==kind for name,kind in [('version','text'),('name','text'),('statements','text[]')]),'Migration history representation differs')
        script,definitions,source=build_application(native)
        for kind,value in definitions.items():save(out,f'{kind}-expected.json',value)
        save(out,'command.json',{'command':native.psql_command(),'input':'application.sql','credentials':'memory environment only'})
        (out/'application.sql').write_text(script)
        receipt['phase']='transaction-requested';env=native.connection_env(target)
        proc=subprocess.run(native.psql_command(),input=script,env=env,capture_output=True,text=True,timeout=120)
        # Only sanitized bounded diagnostics are retained; no live stdout forwarding.
        for stream,value in [('stdout',proc.stdout),('stderr',proc.stderr)]:
            value=value.replace(env['PGPASSWORD'],'[REDACTED]');value=re.sub(r'(postgres(?:ql)?://[^:\s]+:)[^@\s]+@',r'\1[REDACTED]@',value)
            (out/f'psql-{stream}.txt').write_text(value[:1_048_576])
        after=inspect();save(out,'after-independent.json',after)
        receipt.update(migrationApplied=VERSION in {r['version'] for r in after['guards']['catalog']['migrations']},transactionExitCode=proc.returncode)
        require(proc.returncode==0,'Transaction failed; reconcile history, never reapply automatically')
        require(before['data']==after['data'] and before['guards']['privileges']==after['guards']['privileges'],'Existing rows/permissions changed')
        old=copy.deepcopy(before['guards']['catalog']);new=copy.deepcopy(after['guards']['catalog'])
        old_functions=old.pop('functions');new_functions=new.pop('functions');old_history=old.pop('migrations');new_history=new.pop('migrations')
        require(old==new,'Relations/triggers/history schema or other catalogue state changed')
        remaining={(r['schema'],r['name'],r['arguments']):r for r in new_functions};require(len(remaining)==len(new_functions),'Function identities duplicated')
        for row in old_functions:
            now=remaining.pop((row['schema'],row['name'],row['arguments']),None);require(now is not None,'Existing function removed')
            if (row['schema'],row['name']) in CHANGED:
                require({k:v for k,v in row.items() if k!='definitionMd5'}=={k:v for k,v in now.items() if k!='definitionMd5'},'Existing function security/signature changed')
            else:require(now==row,'Unrelated function changed')
        require({(r['schema'],r['name']) for r in remaining.values()}==NEW and len(remaining)==1,'Unexpected function additions')
        previous={r['version']:r for r in old_history};current={r['version']:r for r in new_history}
        require(set(current)==set(previous)|{VERSION} and all(current[k]==v for k,v in previous.items()) and current[VERSION]['name']==NAME,'History changed beyond candidate')
        require(read('select jsonb_build_object(\'exactSource\',statements=array['+sql_literal(source)+']::text[]) from supabase_migrations.schema_migrations where version='+sql_literal(VERSION)+';')['exactSource'] is True,'Committed history source differs')
        save(out,'generated-installed.json',native.generated_evidence(read,definitions['generated']));save(out,'cctp-installed.json',native.cctp_evidence(read,definitions['cctp']))
        destination=stack/MIGRATION.name
        if destination.exists():require(not destination.is_symlink() and sha(destination)==MIGRATION_SHA,'Copied candidate differs; do not overwrite')
        else:
            with destination.open('xb') as file:file.write(MIGRATION.read_bytes())
        require(native.inventory(stack)==inventory,'Copied current migration inventory differs')
        reload=subprocess.run(native.psql_command(),input="select pg_notify('pgrst','reload schema');\n",env=env,capture_output=True,text=True,timeout=15)
        require(reload.returncode==0,'Schema reload request failed after verified commit; do not reapply')
        receipt.update(status='verified',phase='commit-verified',migrationApplied=True,businessDataPreserved=True,catalogueChangesVerified=True,
                       existingPrivilegesPreserved=True,migrationHistoryVerified=True,bodiesAndAclVerified=True,schemaCacheReloadRequested=True,finishedAt=native.now())
    except Exception:
        # A timeout/unknown outcome must be audited by read; this script never retries.
        if before is not None:
            try:
                failure_after=inspect();save(out,'after-failure-independent.json',failure_after)
                receipt['migrationApplied']=VERSION in {r['version'] for r in failure_after['guards']['catalog']['migrations']}
            except Exception:pass
        receipt.update(status='failed',phase='needs-independent-reconciliation',error='Application failed or outcome unqualified; inspect receipt and database, never reapply automatically')
    receipt['artifacts']=[{'name':p.name,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file()]
    save(out,'receipt.json',receipt)
    print(json.dumps({'status':receipt['status'],'phase':receipt['phase'],'receipt':(out/'receipt.json').relative_to(ROOT).as_posix(),'sha256':sha(out/'receipt.json')}))
    if receipt['status']!='verified':raise SystemExit(1)

if __name__=='__main__':main()
