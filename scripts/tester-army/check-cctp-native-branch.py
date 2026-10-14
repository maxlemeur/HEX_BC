"""Execute the CCTP collector branch without DB to detect runtime/ACL recovery gaps.

Bounded catalogue responses exercise the real collector and its checks. This
does not attest any database; the rollback/live recipe must do that separately.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts/tester-army/local-native.py'
spec = importlib.util.spec_from_file_location('native_cctp_branch_check', SOURCE)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

definition = {'schema':'private','name':'source_coverage_example','signature':'private.source_coverage_example(jsonb)',
              'body':'select value;','definer':False,'config':['search_path=""'],'language':'sql','volatility':'i',
              'authenticated':False,'service':False}
definitions = {'functions':[definition], 'tables':['private.requirements_example','private.links_example']}
actual_function = {**definition,'oid':12345,'owner':'postgres','publicExecute':False,'anon':False}
tables = [{'table':table,'role':role,'rls':True,'owner':'postgres','usagePrivate':False,'tableAny':False}
          for table in definitions['tables'] for role in ('anon','authenticated','service_role')]

def run_case(kind):
    rows=deepcopy(tables)
    if kind=='table-privilege-refused': rows[0]['tableAny']=True
    if kind=='missing-role-row-refused': rows.pop()
    if kind=='duplicate-role-row-refused': rows[-1]=deepcopy(rows[0])
    reads=[]
    def read(sql):
        reads.append(sql)
        if 'jsonb_to_recordset' in sql:return [deepcopy(actual_function)]
        if 'from pg_class c' in sql:return deepcopy(rows)
        raise RuntimeError('Unexpected collector operation')
    try:
        result=native.cctp_evidence(read,definitions)
    except RuntimeError as error:
        if kind!='complete-cctp-branch' and str(error)=='CCTP private table security/ACL differs' and len(reads)==2:return
        raise
    if kind!='complete-cctp-branch':raise RuntimeError('Unsafe catalogue evidence was accepted')
    if result!={'functions':[actual_function],'tables':tables} or len(reads)!=2:raise RuntimeError('Complete CCTP branch result differs')

cases=[]
for name in ('complete-cctp-branch','table-privilege-refused','missing-role-row-refused','duplicate-role-row-refused'):
    try:run_case(name);cases.append({'case':name,'passed':True,'error':None})
    except Exception as error:cases.append({'case':name,'passed':False,'error':type(error).__name__})
out=ROOT/'.e2e/core07-sql/cctp-branch-checks'/str(uuid.uuid4());out.mkdir(parents=True,exist_ok=False)
receipt={'schemaVersion':'cctp-native-branch-check-1','status':'verified' if all(row['passed'] for row in cases) else 'failed',
         'checkedAt':datetime.now(timezone.utc).isoformat(),'databaseAccess':False,'networkAccess':False,
         'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'checkSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
         'cases':cases,'limits':['Real Python collector with bounded in-memory catalogue replies; no installed database/ACL or product proof.']}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'status':receipt['status'],'passed':sum(row['passed'] for row in cases),'failed':sum(not row['passed'] for row in cases),
                  'receipt':(out/'receipt.json').relative_to(ROOT).as_posix()}))
if receipt['status']!='verified':raise SystemExit(1)
