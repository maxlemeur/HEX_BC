"""Explicit native test-stack qualification. Import performs no IO or DB action.

CLI status uses a clean environment; SQL credentials exist only in memory.
No reset, migration application, fixture cleanup, runtime install or retry.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(__file__).resolve().parent
CATALOG = BASE / 'local-native-catalog.sql'
PRIVILEGES = BASE / 'local-native-privileges.sql'
CONFIG = None
BIN = None
CLI = None
RECEIPT = None
INSTALLED = None
TARGET = None


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def save(file, value):
    Path(file).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def owned(value):
    require(isinstance(value, str) and value.startswith('.e2e/') and ':' not in value and '\\' not in value
            and not any(p in ('', '.', '..') for p in value.split('/')), 'Owned ignored path required')
    file = (ROOT / value).resolve()
    require(file.is_relative_to((ROOT / '.e2e').resolve()) and (ROOT / '.e2e').resolve().is_relative_to(ROOT), 'Evidence escaped checkout')
    return file


def inventory(directory):
    files = sorted(Path(directory).rglob('*.sql'))
    require(files and all(not p.is_symlink() and p.resolve().is_relative_to(Path(directory).resolve()) for p in files), 'SQL inventory empty or linked')
    return [{'name': p.relative_to(directory).as_posix(), 'sha256': digest(p)} for p in files]


def metadata(value):
    if isinstance(value, dict):
        for key, child in value.items():
            require(not re.search(r'password|secret|token|cookie|authorization|service.?role|anon.?key', key, re.I), 'Native configuration must be non-secret')
            metadata(child)
    elif isinstance(value, list):
        for child in value:
            metadata(child)
    elif isinstance(value, str):
        require(not re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.', value), 'Native configuration must be non-secret')


def configure(config):
    global CONFIG, BIN, CLI
    require(sys.platform == 'linux' and hasattr(os, 'geteuid') and os.geteuid() != 0, 'Native local recipe requires non-root Linux (WSL on Windows)')
    metadata(config)
    required = {'schemaVersion', 'stackDirectory', 'projectId', 'configSha256', 'cliPath', 'cliSha256',
                'postgresBinDirectory', 'psqlSha256', 'nodePath', 'apiUrl', 'dbPort', 'systemIdentifier', 'serverVersionNum'}
    require(set(config) == required and config['schemaVersion'] == 'army-local-native-config-1', 'Exact native configuration fields required')
    api = urlsplit(config['apiUrl'])
    require(api.scheme == 'http' and api.hostname == '127.0.0.1' and api.port and config['apiUrl'] == f'http://127.0.0.1:{api.port}', 'Native origin must be explicit loopback')
    require(type(config['dbPort']) is int and 1024 < config['dbPort'] < 65536 and config['dbPort'] != api.port, 'Native DB port invalid')
    require(re.fullmatch(r'[0-9]{10,20}', config['systemIdentifier']) and re.fullmatch(r'[0-9]{6}', config['serverVersionNum']), 'Exact PostgreSQL identity required')
    require(re.fullmatch(r'[a-z][a-z0-9-]{2,80}', config['projectId']), 'Explicit local project ID required')
    work = Path(config['stackDirectory'])
    require(work.is_absolute() and work == work.resolve() and work.is_dir() and not (work / 'supabase/.temp/project-ref').exists(), 'Native workdir must be physical and unlinked')
    toml = work / 'supabase/config.toml'
    require(digest(toml) == config['configSha256'], 'Native config SHA differs')
    values = tomllib.loads(toml.read_text())
    require(values['project_id'] == config['projectId'] and values['db']['port'] == config['dbPort']
            and values['api']['port'] == api.port and values['experimental']['stack'] is True
            and values['db']['seed']['enabled'] is False, 'Native workdir ports/project/seed mode differ')
    CLI, BIN = Path(config['cliPath']), Path(config['postgresBinDirectory'])
    require(CLI.is_absolute() and CLI.is_file() and BIN.is_absolute() and (BIN / 'psql').is_file()
            and digest(CLI) == config['cliSha256'] and digest(BIN / 'psql') == config['psqlSha256'], 'Explicit native executable hashes differ')
    node = Path(config['nodePath'])
    require(node.is_absolute() and node.is_file(), 'Explicit native Node path required')
    CONFIG = config
    return config


def safe_env():
    env = {k: v for k, v in os.environ.items() if not re.search(r'SUPABASE|DATABASE_URL|^PG|^E2E_|^POSTGRES|PROXY|^LD_|^PYTHON|^NODE_OPTIONS$|^NODE_PATH$|_KEY|TOKEN|SECRET|PASSWORD', k, re.I)}
    env.update(PATH=str(Path(CONFIG['nodePath']).parent) + os.pathsep + env.get('PATH', ''), DO_NOT_TRACK='1', SUPABASE_TELEMETRY_DISABLED='1')
    return env


def status_values(target):
    # Ambient SQL credentials never reach Supabase CLI status/test processes.
    result = subprocess.run([str(CLI), '--workdir', target['stackDirectory'], 'status', '--env'],
                            cwd=target['stackDirectory'], env=safe_env(), capture_output=True, text=True, timeout=45)
    require(result.returncode == 0, 'Native status failed; secret-bearing output withheld')
    values = {}
    for line in result.stdout.splitlines():
        match = re.fullmatch(r'([A-Z0-9_]+)=(.*)', line)
        if match:
            values[match[1]] = match[2].strip().strip('"').strip("'")
    api, db = urlsplit(values.get('API_URL', '')), urlsplit(values.get('DB_URL', ''))
    require(api.scheme == 'http' and api.hostname in ('127.0.0.1', 'localhost') and api.port == urlsplit(CONFIG['apiUrl']).port
            and not (api.path or api.query or api.fragment or api.username), 'Status API differs from reviewed configuration')
    require(db.scheme in ('postgres', 'postgresql') and db.hostname in ('127.0.0.1', 'localhost') and db.port == CONFIG['dbPort']
            and db.path == '/postgres' and unquote(db.username or '') == 'postgres' and db.password and not (db.query or db.fragment), 'Status DB differs from reviewed configuration')
    return values


def connection_env(target):
    db = urlsplit(status_values(target)['DB_URL'])
    env = safe_env()
    env.update(PGHOST='127.0.0.1', PGPORT=str(CONFIG['dbPort']), PGUSER='postgres', PGDATABASE='postgres',
               PGPASSWORD=unquote(db.password), PGCONNECT_TIMEOUT='5', PGSSLMODE='disable',
               PGOPTIONS='-c statement_timeout=90000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000')
    return env


def psql_command():
    return [str(BIN / 'psql'), '--host=127.0.0.1', '--port=' + str(CONFIG['dbPort']), '--username=postgres', '--dbname=postgres', '--no-password', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']


def query(target, sql):
    result = subprocess.run(psql_command(), input='BEGIN READ ONLY;\n' + sql + '\nROLLBACK;\n', env=connection_env(target), capture_output=True, text=True, timeout=105)
    require(result.returncode == 0, 'Native read failed; output withheld')
    return json.loads(result.stdout.strip())


def guards(read, verify=True):
    identity = read("select jsonb_build_object('database',current_database(),'user',current_user,'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'));")
    require(identity == {'database': 'postgres', 'user': 'postgres', 'systemIdentifier': CONFIG['systemIdentifier'], 'serverVersionNum': CONFIG['serverVersionNum']}, 'PostgreSQL identity differs')
    value = {'catalog': read(CATALOG.read_text()), 'privileges': read(PRIVILEGES.read_text())}
    if verify and INSTALLED:
        require(value == json.loads(INSTALLED.read_text())['guards'], 'Qualified catalogue/history/rights differ')
    return value


def rows_sql(tables):
    parts = []
    for table in tables:
        schema, name = table['schema'], table['name']
        require(schema in ('public', 'private', 'auth', 'storage') and re.fullmatch(r'[a-zA-Z0-9_]+', name), 'Invalid table inventory')
        parts.append("select '" + schema + "' as schema,'" + name + "' as name,coalesce(sum(n),0) as rows,coalesce(jsonb_object_agg(h,n),'{}') as hashes from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h,count(*) n from \"" + schema + '\".\"' + name + '\" t group by 1) x')
    return 'select jsonb_agg(to_jsonb(x) order by schema,name) from (' + ' union all '.join(parts) + ') x;'


def rows(read, tables):
    result = read(rows_sql(tables))
    require(len(result) == len(tables) and all(r['rows'] <= 50000 for r in result), 'Table scope exceeds bounded local recipe')
    return result


def preserved(before, after):
    actual = {(r['schema'], r['name']): r for r in after}
    return len(before) == len(after) and all((r['schema'], r['name']) in actual and all(actual[(r['schema'], r['name'])]['hashes'].get(h, 0) >= n for h, n in r['hashes'].items()) for r in before)


def source_inventory(target):
    migrations, tests = inventory(ROOT / 'supabase/migrations'), inventory(ROOT / 'supabase/tests')
    require(inventory(Path(target['stackDirectory']) / 'supabase/migrations') == migrations, 'Native copied migrations differ; synchronize explicitly outside recipe')
    require(inventory(Path(target['stackDirectory']) / 'supabase/tests') == tests, 'Native copied tests differ; synchronize explicitly outside recipe')
    return migrations, tests


def function_evidence(read, migration):
    sql = migration.read_text()
    expected = set(re.findall(r'create (?:or replace )?function (public|private)\.([a-z_]+)\(', sql))
    require(expected, 'Generated function source inventory empty')
    names = ','.join("'" + name + "'" for _, name in sorted(expected))
    definitions = read("select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in(" + names + ');')
    require(len(definitions) == len(expected) and {(r['schema'], r['name']) for r in definitions} == expected, 'Installed generated function set differs')
    for row in definitions:
        match = re.search(r'create (?:or replace )?function ' + re.escape(row['schema'] + '.' + row['name']) + r'\(.*?as \$\$(.*?)\$\$;', sql, re.S | re.I)
        require(match and match.group(1).strip() == row['body'].strip(), 'Installed generated body differs from current migration')
        require(row['owner'] == 'postgres' and 'search_path=""' in row['config'] and row['definer'] == (row['schema'] == 'public' or row['name'] == 'guard_generated_ouvrage_receipt_scope')
                and row['authenticated'] == (row['schema'] == 'public') and not any(row[k] for k in ('publicExecute', 'anon', 'service')), 'Generated function owner/security/ACL differs')
    ledger = read("select jsonb_agg(jsonb_build_object('role',r,'usagePrivate',has_schema_privilege(r,'private','USAGE'),'ledgerAny',has_table_privilege(r,'private.generated_ouvrage_application_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) order by r) from unnest(array['anon','authenticated','service_role']) r;")
    require(all(not r['usagePrivate'] and not r['ledgerAny'] for r in ledger), 'Private receipt ledger exposed')
    return {'functions': definitions, 'ledger': ledger}


def redact(value, secret):
    text = value.replace(secret, '[REDACTED]') if secret else value
    return re.sub(r'eyJ[A-Za-z0-9_.-]+|postgres(?:ql)?://[^\s"\']+', '[REDACTED]', text)


def declaration_query(definitions):
    labels = [{'schema': r['schema'], 'name': r['name'], 'signature': r['signature']} for r in definitions['functions']]
    source = json.dumps(labels).replace("'", "''")
    # Resolve source aliases through regprocedure, and retain OID uniqueness.
    # Unmatched overloads are collected too; exact inventory checks reject them.
    return "set local search_path=''; with expected as(select * from jsonb_to_recordset('" + source + "'::jsonb) as e(schema text,name text,signature text)) select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid::bigint,'signature',coalesce(e.signature,n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'),'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname,p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang left join expected e on p.oid=pg_catalog.to_regprocedure(e.signature) where exists(select 1 from expected x where x.schema=n.nspname and x.name=p.proname);"


def declaration_evidence(read, definitions):
    expected = definitions['functions']
    actual = read(declaration_query(definitions))
    require(isinstance(actual, list) and len(actual) == len(expected) and len({r['signature'] for r in actual}) == len(expected)
            and len({r['oid'] for r in actual}) == len(expected), 'Current function inventory/signatures/OIDs differ')
    for definition in expected:
        matches = [r for r in actual if r['signature'] == definition['signature']]
        require(len(matches) == 1, 'Current installed signature differs')
        row = matches[0]
        require(row['schema'] == definition['schema'] and row['name'] == definition['name'] and row['owner'] == 'postgres'
                and row['definer'] == definition['definer'] and row['config'] == definition['config'] and row['language'] == definition['language']
                and row['volatility'] == definition['volatility'] and row['body'].strip() == definition['body']
                and row['authenticated'] == definition['authenticated'] and row['service'] == definition['service']
                and not row['publicExecute'] and not row['anon'], 'Current body/security/configuration/ACL differs')
    return actual


def generated_evidence(read, definitions):
    ledger = read("select jsonb_agg(jsonb_build_object('role',r,'usagePrivate',has_schema_privilege(r,'private','USAGE'),'ledgerAny',has_table_privilege(r,'private.generated_ouvrage_application_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) order by r) from unnest(array['anon','authenticated','service_role']) r;")
    require(len(ledger) == 3 and all(not r['usagePrivate'] and not r['ledgerAny'] for r in ledger), 'Private receipt access differs')
    return {'functions': declaration_evidence(read, definitions), 'ledger': ledger}


def cctp_evidence(read, definitions):
    actual = declaration_evidence(read, definitions)
    names = ','.join("'" + table.replace("'", "''") + "'" for table in definitions['tables'])
    tables = read("select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'role',r,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'usagePrivate',has_schema_privilege(r,'private','USAGE'),'tableAny',has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) order by c.relname,r) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r where n.nspname||'.'||c.relname in(" + names + ');')
    require(len(tables) == len(definitions['tables']) * 3 and len({(r['table'], r['role']) for r in tables}) == len(tables)
            and all(r['rls'] and r['owner'] == 'postgres' and not r['usagePrivate'] and not r['tableAny'] for r in tables), 'CCTP private table security/ACL differs')
    return {'functions': actual, 'tables': tables}


def verify_artifacts(receipt_file, receipt):
    entries = receipt['artifacts']
    require(entries and len({e['name'] for e in entries}) == len(entries), 'Native artifacts missing or duplicated')
    for entry in entries:
        file = receipt_file.parent / entry['name']
        require(not file.is_symlink() and file.resolve().is_relative_to(receipt_file.parent.resolve()) and digest(file) == entry['sha256'], 'Native artifact escaped or changed')


def load_recipe(plan):
    global RECEIPT, INSTALLED, TARGET
    RECEIPT = owned(plan['nativeRecipePath'])
    require(digest(RECEIPT) == plan['nativeRecipeSha256'], 'Native recipe receipt SHA differs')
    receipt = json.loads(RECEIPT.read_text())
    require(receipt['schemaVersion'] == 'army-local-native-qualification-1' and receipt['status'] == 'verified'
            and all(receipt[k] is True for k in ('rollbackVerified', 'migrationHistoryVerified', 'bodiesAndAclVerified'))
            and receipt['pgTap']['complete'] and receipt['regression']['allPassed'], 'Executed native qualification required')
    verify_artifacts(RECEIPT, receipt)
    config_file = owned(receipt['configPath'])
    require(digest(config_file) == receipt['configSha256'], 'Native qualification configuration differs')
    configure(json.loads(config_file.read_text()))
    result = subprocess.run([CONFIG['nodePath'], str(BASE / 'local-native-proof.mjs'), '--verify', plan['nativeRecipePath'], plan['nativeRecipeSha256'], plan.get('scenarioSet', 'generated-recovery')],
                            cwd=ROOT, env=safe_env(), capture_output=True, text=True, timeout=45)
    require(result.returncode == 0, 'Native recipe executed evidence failed independent offline verification; output withheld')
    TARGET = receipt['target']
    require(TARGET['apiUrl'] == plan['apiUrl'], 'Qualified native origin differs')
    require(source_inventory(TARGET) == (receipt['migrationInventory'], receipt['testInventory']), 'Current native source inventories differ')
    INSTALLED = RECEIPT.parent / 'after-independent.json'
    return receipt, TARGET


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--config-sha', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--approval-reference', required=True)
    parser.add_argument('--scenario-set', choices=('generated-recovery', 'source-coverage'), default='generated-recovery')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--execute', action='store_true')
    modes.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    require(not sys.flags.optimize and args.approval_reference.strip(), 'Explicit unoptimized local qualification required')
    file = owned(args.config)
    require(digest(file) == args.config_sha, 'Native configuration SHA differs')
    configure(json.loads(file.read_text()))
    target = {'stackDirectory': CONFIG['stackDirectory'], 'apiUrl': CONFIG['apiUrl'], 'projectId': CONFIG['projectId'],
              'ports': {'54321': urlsplit(CONFIG['apiUrl']).port, '54322': CONFIG['dbPort']},
              'identity': {'database': 'postgres', 'user': 'postgres', 'systemIdentifier': CONFIG['systemIdentifier'], 'serverVersionNum': CONFIG['serverVersionNum']}}
    migrations, tests = source_inventory(target)
    source_files = [Path(__file__), CATALOG, PRIVILEGES, file, BASE / 'generated-native-contract.mjs', BASE / 'sql-function-declarations.mjs', ROOT / 'src/test/fixtures/estimate-generated-components-regression.sql', ROOT / 'src/test/fixtures/estimate-generated-atomic-regression.sql', *[ROOT / 'supabase/migrations' / r['name'] for r in migrations], *[ROOT / 'supabase/tests' / r['name'] for r in tests]]
    if args.scenario_set == 'source-coverage':
        source_files.extend([BASE / 'cctp-native-contract.mjs', ROOT / 'src/test/fixtures/source-coverage-regression.sql'])
    source_bytes = {p: p.read_bytes() for p in source_files}
    if args.validate_only:
        print(json.dumps({'status': 'validated-offline', 'databaseAccess': False, 'migrationFiles': len(migrations), 'testFiles': len(tests)}))
        return
    out = owned(args.output)
    out.mkdir(exist_ok=False)
    receipt = {'schemaVersion': 'army-local-native-qualification-1', 'status': 'requested', 'startedAt': now(),
               'configPath': args.config, 'configSha256': args.config_sha, 'approvalReference': args.approval_reference,
               'target': target, 'command': [sys.executable, *sys.argv], 'migrationInventory': migrations, 'testInventory': tests,
               'reset': False, 'migrationApplied': False, 'seed': False,
               'host': {'platform': sys.platform, 'machine': platform.machine(), 'uid': os.geteuid()},
               'limits': ['Sequential regression and existing pgTAP only; no real concurrency, Storage bytes or browser qualification.', 'Data conservation covers public/private/auth.users/Storage metadata; other Auth tables excluded.', 'pg_prove validates TAP plans; only its aggregate CLI output is archived.']}
    save(out / 'receipt.json', receipt)
    try:
        node = subprocess.run([CONFIG['nodePath'], '--version'], env=safe_env(), capture_output=True, text=True, timeout=10)
        require(node.returncode == 0 and re.fullmatch(r'v24\.\d+\.\d+\s*', node.stdout), 'Native Node 24 required')
        cli = subprocess.run([str(CLI), '--version'], env=safe_env(), capture_output=True, text=True, timeout=15)
        pinned = json.loads((ROOT / 'package.json').read_text())['devDependencies']['supabase']
        require(cli.returncode == 0 and cli.stdout.strip() == pinned and re.fullmatch(r'\d+\.\d+\.\d+', pinned), 'Native CLI version differs from exact repository pin')
        receipt['cliVersion'] = cli.stdout.strip()
        receipt['nativeNodeVersion'] = node.stdout.strip()
        env = connection_env(target)
        read = lambda sql: query(target, sql)
        before_guards = guards(read, verify=False)
        before = {'guards': before_guards, 'data': rows(read, before_guards['catalog']['dataTables'])}
        save(out / 'before.json', before)
        require({r['version'] for r in before_guards['catalog']['migrations']} == {r['name'].split('_', 1)[0] for r in migrations}, 'Installed migration history differs from current source inventory')
        descriptor = subprocess.run([CONFIG['nodePath'], str(BASE / 'generated-native-contract.mjs'), '--describe'], env=safe_env(), capture_output=True, text=True, timeout=30)
        require(descriptor.returncode == 0, 'Current generated declaration oracle refused')
        generated_definitions = json.loads(descriptor.stdout)
        save(out / 'generated-functions.json', generated_evidence(read, generated_definitions))
        fixture = ROOT / 'src/test/fixtures/estimate-generated-atomic-regression.sql'
        source = source_bytes[fixture].decode('utf-8')
        require(source.startswith('-- WFC02: native assertions written BEFORE') and source.rstrip().endswith('$generated_atomic_probe$;') and not re.search(r'\b(?:commit|rollback)\s*;', source, re.I), 'Mandatory abort regression contract differs')
        native = subprocess.run([*psql_command(), '--set=VERBOSITY=verbose'], input=source, env=env, capture_output=True, text=True, timeout=180)
        output = redact(native.stdout + '\n' + native.stderr, env['PGPASSWORD'])
        (out / 'regression-output.txt').write_text(output)
        matches = re.findall(r'ESTIMATE_GENERATED_ATOMIC_PROOF:(\{[^\n]+\})', output)
        require(native.returncode == 3 and len(matches) == 1 and re.search(r'ERROR:\s+P9001:', output), 'Regression mandatory rollback/result missing')
        result = json.loads(matches[0])
        expected_match = re.search(r'foreach case_name in array array\[(.*?)\] loop', source, re.S | re.I)
        require(expected_match, 'Regression case inventory missing')
        expected = re.findall(r"'([a-z0-9-]+)'", expected_match.group(1))
        require(result['allPassed'] and result['fixturePrefix'] == 'cfc20000' and result['concurrencyExecuted'] is False
                and [r['case'] for r in result['cases']] == expected and len(set(expected)) == len(expected)
                and all(r['passed'] and r['error'] is None for r in result['cases']), 'Sequential regression cases incomplete')
        receipt['regression'] = result
        component_fixture = ROOT / generated_definitions['componentFixturePath']
        component_source = component_fixture.read_text()
        component_run = subprocess.run(psql_command(), input='\\set VERBOSITY verbose\n' + component_source, env=env, capture_output=True, text=True, timeout=105)
        (out / 'component-regression-output.txt').write_text(component_run.stdout + component_run.stderr)
        component_matches = re.findall(r'ESTIMATE_GENERATED_COMPONENTS_PROOF:(\{[^\n]+\})', component_run.stderr)
        require(component_run.returncode == 3 and re.search(r'ERROR:\s+P9001:', component_run.stderr) and len(component_matches) == 1, 'Component mandatory rollback proof absent')
        component_proof = json.loads(component_matches[0])
        require(component_proof['allPassed'] is True and component_proof['fixturePrefix'] == 'cfc70000' and component_proof['concurrencyExecuted'] is False
                and [r['case'] for r in component_proof['cases']] == generated_definitions['componentCases']
                and all(r['passed'] is True and r['error'] is None for r in component_proof['cases']), 'Component exact sequential cases failed')
        receipt['componentRegression'] = {'regression': component_proof, 'exitCode': component_run.returncode, 'rollbackVerified': False}
        component_after = {'guards': guards(read, verify=False), 'data': rows(read, before_guards['catalog']['dataTables'])}
        save(out / 'after-component-regression.json', component_after)
        require(component_after == before, 'Component regression leaked catalogue, rights or data')
        receipt['componentRegression']['rollbackVerified'] = True
        if args.scenario_set == 'source-coverage':
            declarations = subprocess.run([CONFIG['nodePath'], str(BASE / 'cctp-native-contract.mjs'), '--describe'], cwd=ROOT, env=safe_env(), capture_output=True, text=True, timeout=45)
            require(declarations.returncode == 0, 'CCTP declaration oracle refused')
            definitions = json.loads(declarations.stdout)
            save(out / 'cctp-functions.json', cctp_evidence(read, definitions))
            source = source_bytes[ROOT / definitions['fixturePath']].decode('utf-8')
            native = subprocess.run([*psql_command(), '--set=VERBOSITY=verbose'], input=source, env=env, capture_output=True, text=True, timeout=180)
            output = redact(native.stdout + '\n' + native.stderr, env['PGPASSWORD'])
            (out / 'cctp-regression-output.txt').write_text(output)
            matches = re.findall(r'SOURCE_COVERAGE_PROOF:(\{[^\n]+\})', output)
            require(native.returncode == 3 and len(matches) == 1 and re.search(r'ERROR:\s+P9001:', output), 'CCTP mandatory abort/result missing')
            result = json.loads(matches[0])
            require(result['allPassed'] is True and result['fixturePrefix'] == 'dc510000' and result['physicalStorageProof'] is False and result['concurrencyExecuted'] is False
                    and [r['case'] for r in result['cases']] == definitions['cases'] and all(r['passed'] is True and r['error'] is None for r in result['cases']), 'CCTP exact 34 cases incomplete')
            receipt['sourceCoverage'] = {'bodiesAndAclVerified': True, 'exitCode': native.returncode, 'regression': result, 'rollbackVerified': False}
        command = [str(CLI), '--workdir', target['stackDirectory'], 'test', 'db', '--local', str(Path(target['stackDirectory']) / 'supabase/tests/database')]
        run = subprocess.run(command, cwd=target['stackDirectory'], env=safe_env(), capture_output=True, text=True, timeout=240)
        output = redact(run.stdout + '\n' + run.stderr, env['PGPASSWORD'])
        (out / 'pgtap-output.txt').write_text(output)
        executed = [p.rstrip() for p in re.findall(r'^(.+\.sql)\s+\.{2,}\s+ok\s*$', output, re.M)]
        expected = sorted(str(Path(target['stackDirectory']) / 'supabase/tests' / r['name']) for r in tests)
        summary = re.findall(r'^Files=(\d+), Tests=(\d+),.*$', output, re.M)
        calls = [r['name'] for r in tests if re.search(r'\b(?:skip|skip_all|todo|todo_start|todo_end|bail_out)\s*\(', (ROOT / 'supabase/tests' / r['name']).read_text(), re.I)]
        require(run.returncode == 0 and len(executed) == len(set(executed)) and sorted(executed) == expected
                and len(summary) == 1 and int(summary[0][0]) == len(expected) and int(summary[0][1]) > 0
                and len(re.findall(r'^Result: PASS\s*$', output, re.M)) == 1 and 'All tests successful.' in output and not calls
                and not re.search(r'^(?:not ok\b|Bail out!|Dubious\b|Failed\b)|\b(?:ERROR|FATAL|PANIC):|#\s*(?:SKIP|TODO)\b', output, re.M | re.I), 'pgTAP exact current file set or plan incomplete')
        receipt['pgTap'] = {'complete': True, 'cliExitCode': run.returncode, 'command': command, 'files': len(expected), 'tests': int(summary[0][1]), 'rawTapStored': False}
        after_guards = guards(read, verify=False)
        after = {'guards': after_guards, 'data': rows(read, after_guards['catalog']['dataTables'])}
        save(out / 'after-independent.json', after)
        require(before == after, 'Native qualification changed data/catalogue/rights')
        if receipt.get('sourceCoverage'):
            receipt['sourceCoverage']['rollbackVerified'] = True
        require(source_inventory(target) == (migrations, tests), 'Native SQL sources changed during qualification')
        require(all(p.read_bytes() == original for p, original in source_bytes.items()), 'Native helper/config/fixture/SQL changed during qualification')
        require(digest(CLI) == CONFIG['cliSha256'] and digest(BIN / 'psql') == CONFIG['psqlSha256'], 'Native executable changed during qualification')
        receipt.update(status='verified', rollbackVerified=True, migrationHistoryVerified=True, bodiesAndAclVerified=True)
    except Exception as error:
        receipt.update(status='failed-or-ambiguous-no-retry', errorType=type(error).__name__)
        raise
    finally:
        for index, source in enumerate(source_files):
            (out / f'source-{index}-{source.name}').write_bytes(source_bytes[source])
        receipt.update(finishedAt=now(), artifacts=[{'name': p.name, 'sha256': digest(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name != 'receipt.json'])
        save(out / 'receipt.json', receipt)
    print(json.dumps({'status': receipt['status'], 'receipt': str(out / 'receipt.json'), 'sha256': digest(out / 'receipt.json')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Local native recipe refused: ' + str(error), file=sys.stderr)
        sys.exit(3)
