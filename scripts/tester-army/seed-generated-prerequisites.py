"""Owned generated-work prerequisites. No DB/process effect on import or --validate-only."""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SUPPORT = ROOT / '.e2e/estimate-generated-atomic/native/installed-support.py'
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
    recovery = plan['schemaVersion'] == 'estimate-generated-recovery-plan-1'
    require(recovery or plan['schemaVersion'] == 'estimate-generated-atomic-plan-1', 'Unknown plan')
    require(plan['status'] == 'prepared-no-mutation' and plan['approvalReference'].strip(), 'Reviewed plan required')
    from urllib.parse import urlsplit
    origin = urlsplit(plan['apiUrl'])
    require(origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port and plan['apiUrl'] == f'http://127.0.0.1:{origin.port}'
            and plan['prefix'].startswith('ARMY-GENERATED-ATOMIC-'), 'Local fixture scope differs')
    if not plan.get('nativeRecipePath'):
        require(plan['apiUrl'] == 'http://127.0.0.1:45585', 'Historical fixture scope differs')
    require([s['label'] for s in plan['scenarios']] == (['lost', 'malformed', 'stale', 'partial', 'abandon'] if recovery else ['existing', 'fallback']), 'Exact witnesses required')
    owner = plan['owner']
    require(set(owner) == {'userId', 'tenantId', 'membershipId', 'laborRoleId'} and all(UUID.fullmatch(v) for v in owner.values()), 'Invalid owner')
    common = {'tenant_id': owner['tenantId']}
    rows = []

    def add(table, row):
        rows.append((table, row))

    def base(s, label, sections):
        add('estimate_projects', dict(common, id=s['projectId'], user_id=owner['userId'], name=plan['prefix'] + ' ' + label))
        add('estimate_versions', dict(common, id=s['versionId'], project_id=s['projectId'], version_number=1, title=label, status='draft', currency='EUR', calc_engine_version=2, max_section_depth=3, margin_mode='fixed', margin_multiplier=1, margin_bp=0, discount_bp=0 if recovery else 1667, discount_mode='simple', discount_steps=[], global_coefficient=1, tax_rate_bp=2000 if recovery else 0, rounding_mode='none', rounding_step_cents=1, total_ht_cents=0, total_tax_cents=0, total_ttc_cents=0))
        for index, section in enumerate(sections):
            title = plan['prefix'] + (' génération lot' + str(index + 1) if label == 'generation' else ' ' + label + ' S')
            add('estimate_items', dict(common, id=section, version_id=s['versionId'], item_type='section', title=title, position=index + 1, parent_id=None))

    for s in plan['scenarios']:
        allowed = {'label', 'projectId', 'versionId', 'sectionId', 'draftId', 'candidates'} if recovery else {'label', 'projectId', 'versionId', 'sectionId', 'draftId', 'candidateId', 'fragmentId', 'subdetailId', 'componentId', 'designation', 'componentDesignation', 'requestedLot'}
        require(set(s) == allowed, 'Unexpected scenario fields')
        base(s, s['label'], [s['sectionId']])
        lot = s['sectionId'] if recovery or s['label'] == 'existing' else None
        if not recovery:
            require(s['requestedLot'] == ('section' if lot else 'fallback'), 'Lot oracle differs')
        context = dict(common, project_id=s['projectId'], target_version_id=s['versionId'])
        add('estimate_generated_ouvrage_drafts', dict(context, id=s['draftId'], created_by=owner['userId'], source_kind='internal_note', preferred_lot_id=lot, status='pending', summary={}, generation_metadata={'fixture': 'Synthetic pending prerequisite; no model'}))
        candidates = s['candidates'] if recovery else [s]
        require(len(candidates) == (2 if s['label'] == 'partial' else 1), 'Candidate count differs')
        for index, c in enumerate(candidates):
            if recovery:
                require(set(c) == {'candidateId', 'fragmentId', 'subdetailId', 'componentId', 'designation', 'componentDesignation', 'unitCostHtCents'}, 'Unexpected candidate fields')
                require(type(c['unitCostHtCents']) is int and c['unitCostHtCents'] == (1000 if index == 0 else 2000), 'Cost oracle differs')
            require(all(isinstance(c[k], str) and 1 <= len(c[k]) <= 500 and c[k].startswith(plan['prefix']) for k in ('designation', 'componentDesignation')), 'Owned labels required')
            add('estimate_generated_ouvrage_source_fragments', dict(common, id=c['fragmentId'], project_id=s['projectId'], draft_id=s['draftId'], fragment_order=index, source_kind='internal_note', label='ARMY generated work', excerpt=c['designation'], normalized_excerpt=c['designation'].lower()))
            add('estimate_generated_ouvrage_candidates', dict(context, id=c['candidateId'], draft_id=s['draftId'], candidate_order=index, suggested_lot_id=lot, lot_label=plan['prefix'] + ' ' + s['label'] + ' S' if lot else None, designation=c['designation'], normalized_designation=c['designation'].lower(), unit='u', quantity=1, confidence=1, ai_status='certain', resolution_status='pending', reasoning='Prepared fixture; review in real UI'))
            add('estimate_generated_ouvrage_candidate_sources', dict(common, draft_id=s['draftId'], candidate_id=c['candidateId'], source_fragment_id=c['fragmentId'], source_rank=0))
            add('estimate_generated_ouvrage_subdetail_drafts', dict(context, id=c['subdetailId'], draft_id=s['draftId'], parent_work_id=c['candidateId'], created_by=owner['userId'], status='pending_review', summary={}, generation_metadata={'fixture': 'Real human review still required'}))
            add('estimate_generated_ouvrage_subdetail_items', dict(common, id=c['componentId'], project_id=s['projectId'], draft_id=s['draftId'], subdetail_id=c['subdetailId'], parent_work_id=c['candidateId'], source_fragment_id=c['fragmentId'], component_order=0, status='manual', designation=c['componentDesignation'], cost_type='material', quantity=1, unit='u', unit_cost_ht_cents=c['unitCostHtCents'] if recovery else 3, loss_coeff_bp=0, yield_value=None, yield_unit=None, confidence=1, source_label='ARMY generated work', facts=['Synthetic supply prerequisite'], hypotheses=[], inferences=[]))
    if recovery:
        require(set(plan['generation']) == {'projectId', 'versionId', 'sectionA', 'sectionB'}, 'Empty generation witness differs')
        base(plan['generation'], 'generation', [plan['generation']['sectionA'], plan['generation']['sectionB']])
    ids = [row['id'] for _, row in rows if 'id' in row]
    require(all(UUID.fullmatch(v) for v in ids) and len(set(ids)) == len(ids) and not set(ids).intersection(owner.values()), 'All planned row IDs must be new and distinct')
    return rows


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=True, separators=(',', ':')).replace("'", "''") + "'::jsonb"


def selector(row):
    fields = ['id'] if 'id' in row else ['tenant_id', 'draft_id', 'candidate_id', 'source_fragment_id']
    require(all(UUID.fullmatch(row[k]) for k in fields), 'Unsafe selector')
    return ' and '.join('"' + k + '"=' + "'" + row[k] + "'::uuid" for k in fields)


class Session:
    def __init__(self, runtime, target):
        self.command = [str(runtime.BIN / 'psql'), '--host=127.0.0.1', '--port=' + str(target['ports']['54322']), '--username=postgres', '--dbname=postgres', '--no-password', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
        env = runtime.connection_env(target)
        env['PGOPTIONS'] = '-c statement_timeout=90000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000'
        self.process = subprocess.Popen(self.command, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)

    def read(self, sql):
        require(self.process.poll() is None, 'Native session terminated; no retry')
        self.process.stdin.write(sql.strip() + '\n')
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        require(bool(line), 'Native statement failed; output withheld, no retry')
        return json.loads(line)

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=10)


def derived_audits(read, records, owner):
    audited = {r['row']['id']: r for r in records if r['table'] not in ('estimate_generated_ouvrage_subdetail_drafts', 'estimate_generated_ouvrage_subdetail_items')}
    require(all(UUID.fullmatch(key) for key in audited), 'Audit relation lacks its generated row identity')
    ids = ','.join("'" + key + "'::uuid" for key in audited)
    audits = read("select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))),'[]') from public.audit_logs t where record_id in (" + ids + ');')
    insert_counts, revisions = Counter(), {}
    for entry in audits:
        row = entry['row']
        source = audited[row['record_id']]
        table, actual = source['table'], source['row']
        expected_user = owner['userId'] if table in ('estimate_projects', 'estimate_versions', 'estimate_items', 'estimate_generated_ouvrage_drafts') else None
        expected_version = actual['id'] if table == 'estimate_versions' else actual['version_id'] if table == 'estimate_items' else None
        require(row['table_name'] == table and row['tenant_id'] == owner['tenantId'] and row['user_id'] == expected_user and row['estimate_version_id'] == expected_version, 'Derived audit escaped owner/new row scope')
        before, after = row['before_data'], row['after_data']
        require(isinstance(after, dict), 'Audit after image missing')
        omit = {'updated_at', 'content_revision'} if table == 'estimate_versions' else set()
        require({k: v for k, v in after.items() if k not in omit} == {k: v for k, v in actual.items() if k not in omit}, 'Audit payload differs from new prerequisite')
        if row['action'] == 'INSERT':
            require(before is None, 'Insert audit has a before image')
            insert_counts[row['record_id']] += 1
        else:
            require(row['action'] == 'UPDATE' and table == 'estimate_versions' and isinstance(before, dict), 'Unexpected derived audit operation')
            require({k: v for k, v in before.items() if k not in omit} == {k: v for k, v in after.items() if k not in omit} and after['content_revision'] == before['content_revision'] + 1, 'Derived update is not the exact section revision bump')
            revisions.setdefault(actual['id'], []).append((before['content_revision'], after['content_revision']))
    require(insert_counts == Counter({key: 1 for key in audited}), 'Missing or extra insert audits')
    for version in (r['row'] for r in records if r['table'] == 'estimate_versions'):
        sections = sum(r['table'] == 'estimate_items' and r['row']['version_id'] == version['id'] for r in records)
        final = version['content_revision']
        require(sorted(revisions.get(version['id'], [])) == [(n, n + 1) for n in range(final - sections, final)], 'Missing or extra version revision audits')
    return audits


def without_counter(rows, counter):
    copied = json.loads(json.dumps(rows))
    row = next(r for r in copied if (r['schema'], r['name']) == ('private', 'estimate_reference_counters'))
    require(row['hashes'].get(counter['hash']) == 1, 'Counter fingerprint is not unique')
    del row['hashes'][counter['hash']]
    row['rows'] -= 1
    return copied


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
    recipe = bool(plan.get('nativeRecipePath') or plan.get('nativeRecipeSha256'))
    support_file = ROOT / 'scripts/tester-army/local-native.py' if recipe else SUPPORT
    require(hashlib.sha256(support_file.read_bytes()).hexdigest() == plan['nativeSupportSha256'], 'Reviewed support changed')
    spec = importlib.util.spec_from_file_location('generated_installed', support_file)
    support = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(support)
    require(hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == plan['nativeHelperSha256'], 'Reviewed native helper changed')
    rows = prerequisites(plan)
    if recipe:
        require(plan['schemaVersion'] == 'estimate-generated-recovery-plan-1', 'Autonomous recipe prepares recovery only')
        _, target = support.load_recipe(plan)
        runtime = support
        stack_file, stack = proof(runtime, plan['stackReceiptPath'], plan['stackReceiptSha256'])
        require(stack['schemaVersion'] == 'army-local-native-stack-1' and stack['status'] == 'ready' and stack['target'] == target
                and stack['nativeRecipeSha256'] == plan['nativeRecipeSha256'], 'Autonomous qualified transport differs')
        pg_file = support.RECEIPT
    else:
        runtime, installed = support.load(plan['generatedApplicationSha256'])
        require(owned(plan['generatedApplicationPath']) == support.RECEIPT, 'Installation path differs')
        target = runtime.load_target(owned(plan['stackReceiptPath']), plan['stackReceiptSha256'])
        pg_file, pg = proof(runtime, plan['generatedPgTapPath'], plan['generatedPgTapSha256'])
        require(target['pgTapPassed'] is True and pg['status'] == 'verified' and pg['cliExitCode'] == 0 and pg['rollbackVerified'] is True and pg['qualification']['complete'] is True, 'Current pgTAP required')
        require(pg['stackReceiptSha256'] == support.STACK_SHA and pg['stackReceiptPath'] == str(support.STACK) and pg['generatedInstallationSha256'] == support.RECEIPT_SHA and pg['generatedInstallationPath'] == str(support.RECEIPT), 'pgTAP installation chain differs')
        require(pg['transportReceiptSha256'] == plan['stackReceiptSha256'] and pg['transportReceiptPath'] == str(owned(plan['stackReceiptPath'])) and target['generatedPgTapReceipt'] == str(pg_file), 'Qualified transport chain differs')
        require(target['predecessorStackReceipt'] == {'path': str(support.STACK), 'sha256': support.STACK_SHA} and target['pgTap'] == {'files': pg['qualification']['observedFileCount'], 'tests': pg['qualification']['observedAssertionCount']}, 'Qualified result differs')
        omit = {'verifiedAt', 'pgTapPassed', 'pgTap', 'predecessorStackReceipt', 'generatedPgTapReceipt'}
        require({k: v for k, v in target.items() if k not in omit} == {k: v for k, v in installed.items() if k not in omit}, 'Qualified identity changed')
    _, owner_fixture = proof(runtime, plan['ownerFixturePath'], plan['ownerFixtureSha256'])
    require(owner_fixture['status'] == 'ready' and owner_fixture['owner'] == plan['owner'] and owner_fixture['apiUrl'] == plan['apiUrl'], 'Ordinary owner proof differs')
    if args.validate_only:
        print(json.dumps({'status': 'validated-offline', 'databaseAccess': False, 'plannedRows': len(rows), 'planSha256': args.plan_sha}))
        return
    out = plan_file.parent / 'native-seed'
    out.mkdir(exist_ok=False)
    receipt = {'status': 'requested', 'phase': 'before_connection', 'startedAt': runtime.now(), 'planPath': str(plan_file), 'planSha256': args.plan_sha, 'stackReceiptPath': str(owned(plan['stackReceiptPath'])), 'stackReceiptSha256': plan['stackReceiptSha256'], 'target': target['identity'], 'apiUrl': target['apiUrl'], 'approvalReference': plan['approvalReference'], 'plannedRows': len(rows), 'command': [sys.executable, *sys.argv], 'sources': []}
    sources = [Path(__file__), support_file, plan_file, owned(plan['stackReceiptPath']), support.RECEIPT, support.INSTALLED, support.CATALOG, support.PRIVILEGES] if recipe else [Path(__file__), SUPPORT, support.RUNTIME, plan_file, owned(plan['stackReceiptPath']), support.RECEIPT, support.INSTALLED, support.MIGRATION, pg_file, support.BASE / 'catalog.sql', support.BASE / 'privileges.sql']
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
        owner_ok = connection.read("select jsonb_build_object('valid',exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id join public.labor_roles r on r.tenant_id=t.id join auth.users u on u.id=m.user_id where m.id='" + o['membershipId'] + "' and m.user_id='" + o['userId'] + "' and m.tenant_id='" + o['tenantId'] + "' and m.role='admin' and t.is_active and r.id='" + o['laborRoleId'] + "' and r.hourly_rate_cents=4000));")
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
        audits = derived_audits(connection.read, records, o)
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
