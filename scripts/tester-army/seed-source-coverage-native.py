"""Existing-owner CCTP prerequisites. Import and validate-only perform no DB action.

Preparation and finalization are separate exclusive transactions. Failed or
ambiguous outcomes remain visible; no reset, replay, cleanup or Auth provisioning.
"""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'scripts/tester-army'
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
SHA = re.compile(r'[0-9a-f]{64}')


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def physical(file):
    file = Path(file)
    require(file.is_absolute() and file == file.resolve() and not file.is_symlink(), 'Physical evidence/source path required')
    return file


def owned(value):
    require(isinstance(value, str) and value.startswith('.e2e/') and ':' not in value and '\\' not in value
            and not any(p in ('', '.', '..') for p in value.split('/')), 'Owned relative evidence path required')
    file = physical(ROOT / value)
    require(file.is_relative_to(ROOT / '.e2e'), 'Evidence escaped checkout')
    return file


def read_proof(value, expected):
    file = owned(value)
    require(SHA.fullmatch(expected or '') and digest(file) == expected, 'Evidence SHA differs')
    return file, json.loads(file.read_text(encoding='utf-8'))


def module(file, expected, name):
    file = physical(file)
    require(SHA.fullmatch(expected or '') and digest(file) == expected, 'Reviewed executable SHA differs')
    spec = importlib.util.spec_from_file_location(name, file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def validate_delta(before, after, allowed):
    require(len(before) == len(after), 'Data table inventory changed')
    previous = {(r['schema'], r['name']): Counter(r['hashes']) for r in before}
    current = {(r['schema'], r['name']): Counter(r['hashes']) for r in after}
    require(len(previous) == len(before) and len(current) == len(after) and set(previous) == set(current)
            and set(allowed).issubset(previous), 'Data table inventory missing or duplicated')
    for rows in (before, after):
        require(all(type(r['rows']) is int and r['rows'] == sum(r['hashes'].values())
                    and all(type(n) is int and n > 0 for n in r['hashes'].values()) for r in rows), 'Invalid row multiset')
    for key in previous:
        require(current[key] == previous[key] + allowed.get(key, Counter()), 'Data delta escaped exact planned additions')


def objects(read, plan):
    docs = [r['row'] for r in plan['records'] if r['table'] == 'affaire_intake_documents']
    names = ','.join("'" + d['storage_path'].replace("'", "''") + "'" for d in docs)
    actual = read("select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))),'[]') from storage.objects t where bucket_id='affaire-intake' and name in (" + names + ');')
    require(len(actual) == len(docs) and len({r['row']['name'] for r in actual}) == len(docs), 'Missing or duplicate uploaded objects')
    expected = {d['storage_path']: d for d in docs}
    for entry in actual:
        row = entry['row']
        metadata = row.get('metadata') or {}
        require(row['name'] in expected and row['bucket_id'] == 'affaire-intake' and row.get('owner_id') == plan['owner']['userId']
                and row.get('owner') in (None, plan['owner']['userId']) and metadata.get('mimetype') == 'application/pdf'
                and type(metadata.get('size')) is int and metadata['size'] == expected[row['name']]['size_bytes'], 'Uploaded object owner/PDF metadata differs')
    bucket_verified(read)
    return actual


def bucket_verified(read):
    bucket = read("select coalesce(jsonb_agg(to_jsonb(t)),'[]') from storage.buckets t where id='affaire-intake';")
    require(len(bucket) == 1 and bucket[0]['public'] is False and
            (bucket[0].get('allowed_mime_types') is None or 'application/pdf' in bucket[0]['allowed_mime_types']),
            'Existing private intake bucket must accept PDF; no repair')
    require(bucket[0].get('file_size_limit') is None or bucket[0]['file_size_limit'] >= 4370, 'Existing intake bucket PDF size limit differs')
    return bucket[0]


def same_field(key, actual, expected):
    if key in ('completed_at', 'classified_at', 'manually_overridden_at') and expected is not None:
        a, b = datetime.fromisoformat(actual.replace('Z', '+00:00')), datetime.fromisoformat(expected.replace('Z', '+00:00'))
        return a.tzinfo is not None and b.tzinfo is not None and a == b
    return actual == expected


def actual_records(read, records, primitives):
    result = []
    for expected in records:
        table, row = expected['table'], expected['row']
        actual = read("select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))),'[]') from public.\"" + table + '\" t where ' + primitives.selector(row) + ';')
        require(len(actual) == 1 and all(same_field(k, actual[0]['row'].get(k), v) for k, v in row.items()), 'Prerequisite differs from exact plan')
        result.append({'table': table, **actual[0]})
    return result


def allowed_records(records):
    allowed = {}
    for r in records:
        allowed.setdefault(('public', r['table']), Counter())[r['hash']] += 1
    return allowed


def validate_labor_selection(roles, owner):
    require(isinstance(roles, list), 'Existing labor-role read required')
    active = [r for r in roles if r.get('user_id') == owner['userId'] and r.get('tenant_id') == owner['tenantId'] and r.get('is_active') is True]
    require(all(UUID.fullmatch(r.get('id', '')) and type(r.get('position')) is int for r in active), 'Existing active role ordering differs')
    active.sort(key=lambda r: (r['position'], r['id']))
    require(active and active[0]['id'] == owner['laborRoleId'] and active[0]['hourly_rate_cents'] == 4000, 'Effective first active owner RMO differs; no repair')
    return active[0]


def owner_verified(read, owner):
    require(all(UUID.fullmatch(v) for v in owner.values()), 'Invalid existing owner')
    valid = read("select jsonb_build_object('valid',exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id join auth.users u on u.id=m.user_id where m.id='" + owner['membershipId'] + "' and m.user_id='" + owner['userId'] + "' and m.tenant_id='" + owner['tenantId'] + "' and m.role='admin' and t.is_active));")
    require(valid['valid'], 'Live existing owner/admin/active tenant/RMO differs')
    roles = read("select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]') from public.labor_roles r where tenant_id='" + owner['tenantId'] + "' and user_id='" + owner['userId'] + "' and is_active;")
    return {'roles': roles, 'selected': validate_labor_selection(roles, owner)}


def counter_query(owner):
    return "select jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) as value from private.estimate_reference_counters t where tenant_id='" + owner['tenantId'] + "' and reference_year=extract(year from current_date)::int"


def prepare(connection, runtime, primitives, plan, out, receipt, before, guards):
    counter_sql = counter_query(plan['owner'])
    previous = connection.read("select coalesce(jsonb_agg(x.value),'[]') from (" + counter_sql + ' for update) x;')
    require(len(previous) == 1 and set(previous[0]['row']) == {'tenant_id', 'reference_year', 'last_value'}, 'Existing exact reference counter required; no creation')
    counter_before = previous[0]
    runtime.save(out / 'counter-before.json', counter_before)
    for record in plan['records']:
        table, row = record['table'], record['row']
        require(re.fullmatch(r'[a-z_]+', table) and all(re.fullmatch(r'[a-z_]+', k) for k in row), 'Unsafe record identifier')
        require(connection.read('select jsonb_build_object(\'count\',count(*)) from public."' + table + '" where ' + primitives.selector(row) + ';')['count'] == 0, 'Planned identity already exists; no replay')
    for record in plan['records']:
        table, row = record['table'], record['row']
        columns = ','.join('"' + k + '"' for k in row)
        sql = 'insert into public."' + table + '" (' + columns + ') select ' + columns + ' from jsonb_populate_record(null::public."' + table + '",' + primitives.literal(row) + ');'
        connection.read(sql + " select jsonb_build_object('inserted',true);")
    records = actual_records(connection.read, plan['records'], primitives)
    audited = [r for r in records if r['table'] not in ('affaire_intake_uploads', 'affaire_intake_documents')]
    audits = primitives.derived_audits(connection.read, audited, plan['owner'])
    require(len(audits) == 110, 'Exact 88 INSERT and 22 section-revision audits required')
    allowed = allowed_records(records)
    allowed[('public', 'audit_logs')] = Counter(entry['hash'] for entry in audits)
    counter_after = connection.read(counter_sql + ';')
    expected_counter = dict(counter_before['row'], last_value=counter_before['row']['last_value'] + 11)
    require(counter_after['row'] == expected_counter, 'Reference counter changed beyond eleven projects')
    projects = [r['row'] for r in records if r['table'] == 'estimate_projects']
    for index, project in enumerate(projects):
        sequence = counter_before['row']['last_value'] + index + 1
        require(re.fullmatch('HEX_D' + f"{expected_counter['reference_year'] % 100:02d}{sequence:03d}" + '[A-Z]{2}', project['estimate_reference']), 'Project reference differs from exact new sequence')
    after = runtime.rows(connection.read, guards['catalog']['dataTables'])
    validate_delta(primitives.without_counter(before, counter_before), primitives.without_counter(after, counter_after), allowed)
    runtime.save(out / 'prerequisites.json', records)
    runtime.save(out / 'derived-audits.json', audits)
    runtime.save(out / 'counter-after.json', counter_after)
    receipt.update(derivedAuditCount=len(audits), referenceCounterException={'tenantId': plan['owner']['tenantId'],
        'year': expected_counter['reference_year'], 'before': counter_before['row']['last_value'], 'after': expected_counter['last_value'],
        'delta': 11, 'assignedReferences': [p['estimate_reference'] for p in projects]})
    return after


def finalize(connection, runtime, primitives, plan, out, receipt, before, guards, prepared):
    prepare_out = owned(receipt['preparePath']).parent
    baseline = json.loads((prepare_out / 'after-independent.json').read_text(encoding='utf-8'))
    require(baseline['guards'] == guards, 'Catalogue/history/rights differ from preparation')
    uploaded = objects(connection.read, plan)
    validate_delta(baseline['data'], before, {('storage', 'objects'): Counter(r['hash'] for r in uploaded)})
    runtime.save(out / 'storage-objects.json', uploaded)
    docs = [r for r in prepared if r['table'] == 'affaire_intake_documents']
    require(len(docs) == 22 and all(r['row']['upload_status'] == 'pending' for r in docs), 'Exact pending documents required')
    updated = []
    for record in docs:
        row = record['row']
        current = connection.read("select jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) from public.affaire_intake_documents t where " + primitives.selector(row) + ' for update;')
        require(current['row'] == row and current['hash'] == record['hash'], 'New pending document changed before finalization')
        connection.read("update public.affaire_intake_documents set upload_status='uploaded' where " + primitives.selector(row) + " and upload_status='pending'; select jsonb_build_object('updated',true);")
        actual = connection.read("select jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) from public.affaire_intake_documents t where " + primitives.selector(row) + ';')
        omit = {'upload_status', 'updated_at'}
        require(actual['row']['upload_status'] == 'uploaded'
                and {k: v for k, v in actual['row'].items() if k not in omit} == {k: v for k, v in row.items() if k not in omit}, 'Document changed beyond exact uploaded status/timestamp')
        updated.append({'table': record['table'], **actual})
    after = runtime.rows(connection.read, guards['catalog']['dataTables'])
    reduced_before, reduced_after = json.loads(json.dumps(before)), json.loads(json.dumps(after))
    for collection, records in ((reduced_before, docs), (reduced_after, updated)):
        matches = [r for r in collection if (r['schema'], r['name']) == ('public', 'affaire_intake_documents')]
        require(len(matches) == 1, 'Document table inventory differs')
        table = matches[0]
        for record in records:
            require(table['hashes'].get(record['hash']) == 1, 'New document fingerprint not unique')
            del table['hashes'][record['hash']]
            table['rows'] -= 1
    validate_delta(reduced_before, reduced_after, {})
    runtime.save(out / 'documents-before.json', docs)
    runtime.save(out / 'documents-after.json', updated)
    receipt.update(uploadedObjectCount=len(uploaded), documentTransitionCount=len(updated), ordinaryUploadOwnerVerified=True)
    return after


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha', required=True)
    parser.add_argument('--phase', choices=('prepare', 'finalize'), required=True)
    parser.add_argument('--prepare-proof')
    parser.add_argument('--prepare-sha')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--execute', action='store_true')
    mode.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    require(not sys.flags.optimize, 'Optimized Python forbidden')
    plan_file, plan = read_proof(args.plan, args.plan_sha)
    require(plan['schemaVersion'] == 'army-local-cctp-plan-1' and plan['scenarioSet'] == 'source-coverage', 'Explicit CCTP plan required')
    require(digest(Path(__file__)) == plan['nativeHelperSha256'], 'Reviewed CCTP seed changed')
    support_file, primitives_file = BASE / 'local-native.py', BASE / 'seed-generated-prerequisites.py'
    runtime = module(support_file, plan['nativeSupportSha256'], 'cctp_native_support')
    primitives = module(primitives_file, plan['nativePrimitivesSha256'], 'cctp_native_primitives')
    _, native = read_proof(plan['nativeRecipePath'], plan['nativeRecipeSha256'])
    _, config = read_proof(native['configPath'], native['configSha256'])
    runtime.configure(config)
    validate = subprocess.run([config['nodePath'], str(BASE / 'cctp-seed-plan.mjs'), '--validate', '--plan', args.plan, '--plan-sha', args.plan_sha],
                              cwd=ROOT, env=runtime.safe_env(), capture_output=True, text=True, timeout=60)
    require(validate.returncode == 0, 'Exact CCTP plan failed offline validation; output withheld')
    checked = json.loads(validate.stdout)
    require(checked['status'] == 'validated-offline' and checked['databaseAccess'] is False
            and checked['records'] == plan['records'] and len(checked['records']) == 176, 'CCTP plan validation result differs')
    _, target = runtime.load_recipe(plan)
    _, stack = read_proof(plan['stackReceiptPath'], plan['stackReceiptSha256'])
    _, owner = read_proof(plan['ownerFixturePath'], plan['ownerFixtureSha256'])
    require(stack['schemaVersion'] == 'army-local-native-stack-1' and stack['status'] == 'ready' and stack['runtime'] == 'native'
            and stack['pgTapPassed'] is True and stack['target'] == target
            and stack['apiUrl'] == plan['apiUrl'] and stack['nativeRecipePath'] == plan['nativeRecipePath']
            and stack['nativeRecipeSha256'] == plan['nativeRecipeSha256'], 'Qualified stack chain differs')
    require(owner['schemaVersion'] == 'army-local-owner-fixture-1' and owner['status'] == 'ready' and owner['owner'] == plan['owner']
            and owner['apiUrl'] == plan['apiUrl'] and owner['nativeRecipeSha256'] == plan['nativeRecipeSha256']
            and owner['ordinaryLoginVerified'] is True and owner['adminMembershipVerified'] is True and owner['laborRateCents'] == 4000, 'Existing ordinary owner chain differs')
    prepared = None
    if args.phase == 'finalize':
        prepare_file, prepare_receipt = read_proof(args.prepare_proof, args.prepare_sha)
        verification = subprocess.run([config['nodePath'], str(BASE / 'cctp-seed-proof.mjs'), '--verify-phase', '--plan', args.plan,
            '--plan-sha', args.plan_sha, '--receipt', args.prepare_proof, '--receipt-sha', args.prepare_sha, '--phase', 'prepare'],
            cwd=ROOT, env=runtime.safe_env(), capture_output=True, text=True, timeout=60)
        require(verification.returncode == 0 and prepare_receipt['status'] == 'verified' and prepare_receipt['planSha256'] == args.plan_sha, 'Preparation evidence failed independent offline reader')
        prepared = json.loads((prepare_file.parent / 'prerequisites.json').read_text(encoding='utf-8'))
    else:
        require(args.prepare_proof is None and args.prepare_sha is None, 'Prepare must not reuse a previous phase')
    if args.validate_only:
        print(json.dumps({'status': 'validated-offline', 'databaseAccess': False, 'phase': args.phase, 'plannedRows': 176, 'planSha256': args.plan_sha}))
        return
    out = physical(plan_file.parent) / ('native-seed-' + args.phase)
    out.mkdir(exist_ok=False)
    receipt = {'schemaVersion': 'army-local-cctp-seed-1', 'status': 'requested', 'phase': args.phase,
        'transactionState': 'before_connection', 'startedAt': runtime.now(), 'planPath': args.plan, 'planSha256': args.plan_sha,
        'apiUrl': plan['apiUrl'], 'target': target['identity'], 'owner': plan['owner'], 'approvalReference': plan['approvalReference'],
        'plannedRows': 176, 'command': [sys.executable, *sys.argv], 'sources': []}
    if args.phase == 'finalize':
        receipt.update(preparePath=args.prepare_proof, prepareSha256=args.prepare_sha)
    sources = [Path(__file__), support_file, primitives_file, BASE / 'cctp-seed-plan.mjs', BASE / 'cctp-seed-proof.mjs',
        BASE / 'local-recipe-common.mjs', plan_file, owned(plan['ownerFixturePath']), owned(plan['stackReceiptPath']),
        runtime.RECEIPT, runtime.INSTALLED, runtime.CATALOG, runtime.PRIVILEGES, ROOT / 'e2e/fixtures/source-coverage/manifest.json',
        ROOT / 'e2e/fixtures/source-coverage/A/ARMY-CCTP-calorifuge.pdf', ROOT / 'e2e/fixtures/source-coverage/B/ARMY-CCTP-calorifuge.pdf']
    if args.phase == 'finalize':
        sources.extend([prepare_file, prepare_file.parent / 'after-independent.json', prepare_file.parent / 'prerequisites.json'])
    for index, source in enumerate(sources):
        physical(source)
        copied = out / ('source-' + str(index) + '-' + source.name)
        copied.write_bytes(source.read_bytes())
        receipt['sources'].append({'path': source.relative_to(ROOT).as_posix(), 'copy': copied.name, 'sha256': digest(source)})
    runtime.save(out / 'seed-receipt.json', receipt)
    connection = None
    try:
        connection = primitives.Session(runtime, target)
        connection.read("BEGIN; SELECT jsonb_build_object('transaction',true);")
        before_guards = runtime.guards(connection.read)
        tables = before_guards['catalog']['dataTables']
        before = runtime.rows(connection.read, tables)
        runtime.save(out / 'before.json', {'guards': before_guards, 'data': before})
        runtime.save(out / 'labor-role.json', owner_verified(connection.read, plan['owner']))
        runtime.save(out / 'bucket.json', bucket_verified(connection.read))
        after = prepare(connection, runtime, primitives, plan, out, receipt, before, before_guards) if args.phase == 'prepare' else finalize(connection, runtime, primitives, plan, out, receipt, before, before_guards, prepared)
        after_guards = runtime.guards(connection.read)
        require(after_guards == before_guards, 'Catalogue/history/rights changed; rollback')
        expected_after = {'guards': after_guards, 'data': after}
        runtime.save(out / 'after-before-commit.json', expected_after)
        require(all(digest(ROOT / s['path']) == s['sha256'] for s in receipt['sources']), 'Source changed before commit; rollback')
        receipt.update(transactionState='commit_requested', businessDataPreserved=True, exactPlannedAdditionsVerified=True, catalogueAndPrivilegesPreserved=True)
        runtime.save(out / 'seed-receipt.json', receipt)
        connection.read("COMMIT; SELECT jsonb_build_object('committed',true);")
        connection.close()
        connection = primitives.Session(runtime, target)
        connection.read("BEGIN READ ONLY; SELECT jsonb_build_object('readonly',current_setting('transaction_read_only'));")
        independent = {'guards': runtime.guards(connection.read), 'data': runtime.rows(connection.read, tables)}
        runtime.save(out / 'after-independent.json', independent)
        require(independent == expected_after, 'Independent committed state differs; preserve outcome without retry')
        require(all(digest(ROOT / s['path']) == s['sha256'] for s in receipt['sources']), 'Source changed after commit; preserve outcome without retry')
        connection.read("ROLLBACK; SELECT jsonb_build_object('closed',true);")
        receipt.update(status='verified', transactionState='commit_verified', independentReadbackVerified=True, finishedAt=runtime.now(),
            limits=['Existing-owner native prerequisite transaction only; no application/RLS or browser qualification.',
                    'Preservation covers public/private/auth.users and Storage metadata; other Auth tables and object bytes require separate evidence.'])
    except Exception as error:
        receipt.update(status='failed-or-ambiguous-no-retry', errorType=type(error).__name__, finishedAt=runtime.now())
        raise
    finally:
        if connection:
            connection.close()
        receipt['artifacts'] = [{'name': p.name, 'sha256': digest(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name != 'seed-receipt.json']
        runtime.save(out / 'seed-receipt.json', receipt)
    print(json.dumps({'status': receipt['status'], 'phase': args.phase, 'receipt': str(out / 'seed-receipt.json'), 'receiptSha256': digest(out / 'seed-receipt.json'), 'plannedRows': 176}))


if __name__ == '__main__':
    main()
