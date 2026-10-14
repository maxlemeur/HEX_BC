"""CORE-07 proposals only; shared native conservation primitives, no DB effect on import."""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def require(value, message):
    if not value:
        raise RuntimeError(message)


def owned(value):
    require(isinstance(value, str) and value and not Path(value).is_absolute() and '\\' not in value and ':' not in value, 'Owned relative path required')
    target = (ROOT / value).resolve()
    require(target.is_relative_to((ROOT / '.e2e').resolve()), 'Evidence escaped owned root')
    return target


def proof(runtime, value, expected):
    file = owned(value)
    require(re.fullmatch(r'[0-9a-f]{64}', expected or '') and runtime.digest(file) == expected, 'Proof SHA differs')
    return file, json.loads(file.read_text())


def prerequisites(plan):
    require(plan['schemaVersion'] == 'estimate-generated-components-plan-1', 'Exact component plan required')
    return [(r['table'], r['row']) for r in plan['records']]


spec = importlib.util.spec_from_file_location('generated_seed_primitives', ROOT / 'scripts/tester-army/seed-generated-prerequisites.py')
primitives = importlib.util.module_from_spec(spec)
spec.loader.exec_module(primitives)
Session = primitives.Session
literal = primitives.literal
selector = primitives.selector
derived_audits = primitives.derived_audits
without_counter = primitives.without_counter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--execute', action='store_true')
    mode.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    require(not sys.flags.optimize, 'Optimized Python is forbidden')
    plan_file = owned(args.plan)
    import hashlib
    require(hashlib.sha256(plan_file.read_bytes()).hexdigest() == args.plan_sha, 'Plan SHA differs')
    plan = json.loads(plan_file.read_text())
    verifier = ROOT / 'scripts/tester-army/generated-components-plan.mjs'
    check = subprocess.run([plan['nativeNodePath'], str(verifier), '--validate', str(plan_file), args.plan_sha], cwd=ROOT, capture_output=True, text=True, timeout=30)
    require(check.returncode == 0, 'Exact offline component plan verification failed; output withheld')
    require(hashlib.sha256((ROOT / 'scripts/tester-army/seed-generated-prerequisites.py').read_bytes()).hexdigest() == plan['nativePrimitivesSha256'], 'Shared native primitives changed')
    support_file = ROOT / 'scripts/tester-army/local-native.py'
    require(hashlib.sha256(support_file.read_bytes()).hexdigest() == plan['nativeSupportSha256'], 'Reviewed support changed')
    spec = importlib.util.spec_from_file_location('generated_installed', support_file)
    support = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(support)
    require(hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == plan['nativeHelperSha256'], 'Reviewed native helper changed')
    rows = prerequisites(plan)
    require(plan['schemaVersion'] == 'estimate-generated-components-plan-1', 'Autonomous component proposals required')
    _, target = support.load_recipe(plan)
    runtime = support
    stack_file, stack = proof(runtime, plan['stackReceiptPath'], plan['stackReceiptSha256'])
    require(stack['schemaVersion'] == 'army-local-native-stack-1' and stack['status'] == 'ready' and stack['target'] == target
            and stack['nativeRecipeSha256'] == plan['nativeRecipeSha256'], 'Autonomous qualified transport differs')
    pg_file = support.RECEIPT
    _, owner_fixture = proof(runtime, plan['ownerFixturePath'], plan['ownerFixtureSha256'])
    require(owner_fixture['status'] == 'ready' and owner_fixture['owner'] == plan['owner'] and owner_fixture['apiUrl'] == plan['apiUrl'], 'Ordinary owner proof differs')
    if args.validate_only:
        print(json.dumps({'status': 'validated-offline', 'databaseAccess': False, 'plannedRows': len(rows), 'planSha256': args.plan_sha}))
        return
    out = plan_file.parent / 'native-seed'
    out.mkdir(exist_ok=False)
    receipt = {'status': 'requested', 'phase': 'before_connection', 'startedAt': runtime.now(), 'planPath': str(plan_file), 'planSha256': args.plan_sha, 'stackReceiptPath': str(owned(plan['stackReceiptPath'])), 'stackReceiptSha256': plan['stackReceiptSha256'], 'target': target['identity'], 'apiUrl': target['apiUrl'], 'approvalReference': plan['approvalReference'], 'plannedRows': len(rows), 'command': [sys.executable, *sys.argv], 'sources': []}
    sources = [Path(__file__), support_file, verifier, ROOT / 'scripts/tester-army/seed-generated-prerequisites.py', plan_file, owned(plan['stackReceiptPath']), support.RECEIPT, support.INSTALLED, support.CATALOG, support.PRIVILEGES]
    for index, source in enumerate(sources):
        copied = out / (str(index) + '-' + source.name)
        copied.write_bytes(source.read_bytes())
        receipt['sources'].append({'path': str(source), 'copy': copied.name, 'sha256': runtime.digest(source)})
    runtime.save(out / 'receipt.json', receipt)
    connection = None
    try:
        connection = Session(runtime, target)
        connection.read("BEGIN; SELECT jsonb_build_object('transaction',true);")
        before_guards = support.guards(connection.read)
        tables = before_guards['catalog']['dataTables']
        before = support.rows(connection.read, tables)
        runtime.save(out / 'before.json', {'guards': before_guards, 'data': before})
        o = plan['owner']
        counter_sql = "select jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) as value from private.estimate_reference_counters t where tenant_id='" + o['tenantId'] + "' and reference_year=extract(year from current_date)::int"
        counters_before = connection.read("select coalesce(jsonb_agg(x.value),'[]') from (" + counter_sql + ' for update) x;')
        require(len(counters_before) == 1, 'Expected existing fixture reference counter is missing')
        counter_before = counters_before[0]
        require(set(counter_before['row']) == {'tenant_id', 'reference_year', 'last_value'}, 'Counter schema changed; explicit review required')
        runtime.save(out / 'counter-before.json', counter_before)
        owner_ok = connection.read("select jsonb_build_object('valid',exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id join public.labor_roles r on r.tenant_id=t.id join auth.users u on u.id=m.user_id where m.id='" + o['membershipId'] + "' and m.user_id='" + o['userId'] + "' and m.tenant_id='" + o['tenantId'] + "' and m.role='admin' and t.is_active and r.id='" + o['laborRoleId'] + "' and r.hourly_rate_cents=4000 and r.user_id=m.user_id and r.is_active and r.id=(select r2.id from public.labor_roles r2 where r2.tenant_id=m.tenant_id and r2.user_id=m.user_id and r2.is_active order by r2.position,r2.id limit 1)));")
        require(owner_ok['valid'], 'Live owner/membership/RMO differs')
        for table, row in rows:
            require(connection.read('select jsonb_build_object(\'count\',count(*)) from public."' + table + '" where ' + selector(row) + ';')['count'] == 0, 'Planned identity already exists; rollback without retry')
        for table, row in rows:
            columns = ','.join('"' + k + '"' for k in row)
            require(all(re.fullmatch(r'[a-z_]+', k) for k in row), 'Invalid fixed column')
            sql = 'insert into public."' + table + '" (' + columns + ') select ' + columns + ' from jsonb_populate_record(null::public."' + table + '",' + literal(row) + ');'
            connection.read(sql + " select jsonb_build_object('inserted',true);")
        allowed = {}
        records = []
        for table, expected in rows:
            actual = connection.read("select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))),'[]') from public.\"" + table + '\" t where ' + selector(expected) + ';')
            require(len(actual) == 1 and all(actual[0]['row'].get(k) == v for k, v in expected.items()), 'Persisted prerequisite differs from exact plan')
            allowed.setdefault(('public', table), Counter())[actual[0]['hash']] += 1
            records.append({'table': table, **actual[0]})
        audits = derived_audits(connection.read, [r for r in records if r['table'] != 'estimate_generated_ouvrage_subdetail_item_sources'], o)
        allowed[('public', 'audit_logs')] = Counter(entry['hash'] for entry in audits)
        runtime.save(out / 'derived-audits.json', audits)
        counter_after = connection.read(counter_sql + ';')
        projects = [r['row'] for r in records if r['table'] == 'estimate_projects']
        expected_counter = dict(counter_before['row'], last_value=counter_before['row']['last_value'] + len(projects))
        require(counter_after['row'] == expected_counter, 'Reference counter changed beyond exact new project count')
        year = expected_counter['reference_year'] % 100
        for index, project in enumerate(projects):
            sequence = counter_before['row']['last_value'] + index + 1
            require(re.fullmatch('HEX_D' + f'{year:02d}{sequence:03d}' + '[A-Z]{2}', project['estimate_reference']), 'New project reference is outside the exact assigned sequence')
        runtime.save(out / 'counter-after.json', counter_after)
        after = support.rows(connection.read, tables)
        invariant_before, invariant_after = without_counter(before, counter_before), without_counter(after, counter_after)
        require(support.preserved(invariant_before, invariant_after), 'Preexisting business rows changed beyond exact reference counter; rollback')
        before_map = {(r['schema'], r['name']): Counter(r['hashes']) for r in invariant_before}
        for row in invariant_after:
            key = (row['schema'], row['name'])
            require(Counter(row['hashes']) - before_map[key] == allowed.get(key, Counter()), 'Additional rows escape the exact fixture plan; rollback')
        after_guards = support.guards(connection.read)
        require(after_guards == before_guards, 'Catalogue/history/rights changed; rollback')
        expected_after = {'guards': after_guards, 'data': after}
        runtime.save(out / 'after-before-commit.json', expected_after)
        runtime.save(out / 'prerequisites.json', records)
        receipt.update(phase='commit_requested', businessDataPreserved=True, exactPlannedAdditionsVerified=True, catalogueAndPrivilegesPreserved=True,
                       referenceCounterException={'tenantId': o['tenantId'], 'year': expected_counter['reference_year'], 'before': counter_before['row']['last_value'], 'after': expected_counter['last_value'], 'delta': len(projects), 'assignedReferences': [p['estimate_reference'] for p in projects]}, derivedAuditCount=len(audits))
        runtime.save(out / 'receipt.json', receipt)
        connection.read("COMMIT; select jsonb_build_object('committed',true);")
        connection.close()
        connection = Session(runtime, target)
        connection.read("BEGIN READ ONLY; select jsonb_build_object('readonly',current_setting('transaction_read_only'));")
        independent = {'guards': support.guards(connection.read), 'data': support.rows(connection.read, tables)}
        runtime.save(out / 'after-independent.json', independent)
        require(independent == expected_after, 'Committed state differs from transaction proof; preserve outcome without retry')
        connection.read("ROLLBACK; select jsonb_build_object('closed',true);")
        receipt.update(status='verified', phase='commit_verified', independentReadbackVerified=True, finishedAt=runtime.now(), limits=['Native prerequisite setup only; no ordinary application/RLS qualification.', 'Preservation covers public/private/auth.users/Storage metadata inventory; no Storage bytes or other Auth tables.'])
    except Exception as error:
        receipt.update(status='failed-or-ambiguous-no-retry', errorType=type(error).__name__, finishedAt=runtime.now())
        raise
    finally:
        if connection:
            connection.close()
        receipt['artifacts'] = [{'name': p.name, 'sha256': runtime.digest(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name != 'receipt.json']
        runtime.save(out / 'receipt.json', receipt)
    print(json.dumps({'status': receipt['status'], 'receipt': str(out / 'receipt.json'), 'receiptSha256': runtime.digest(out / 'receipt.json'), 'plannedRows': len(rows)}))


if __name__ == '__main__':
    main()
