"""Explicit local rollback probe. No persistent migration, seed or history write."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "scripts/tester-army/local-native.py"
CONFIG = ROOT / ".e2e/retro-runtime/config/recipe-go-20261012-03/native-config.json"
FIXTURE = ROOT / "src/test/fixtures/estimate-offer-contract-regression.sql"
DOC = ROOT / "docs/testing/offer-contract-sql.md"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
parser.add_argument("--migration", required=True)
args = parser.parse_args()
out = (ROOT / args.output).resolve()
scope = (ROOT / ".e2e/offer-emission/sql-runs").resolve()
if not out.is_relative_to(scope) or out == scope:
    raise RuntimeError("Output must be a fresh directory in the dedicated ignored scope")
out.mkdir(parents=True, exist_ok=False)
private = out / "private"
private.mkdir()
migration = (ROOT / args.migration).resolve()
if migration.parent != (ROOT / "supabase/migrations").resolve() or migration.is_symlink():
    raise RuntimeError("Explicit repository migration required")
sources = [NATIVE, NATIVE.parent / "local-native-catalog.sql", NATIVE.parent / "local-native-privileges.sql", CONFIG, FIXTURE, DOC, Path(__file__).resolve(), migration]
hashes = {p.relative_to(ROOT).as_posix(): sha(p) for p in sources}


def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


receipt = {
    "schemaVersion": "offer-contract-rollback-1",
    "status": "requested",
    "sources": hashes,
    "command": [sys.executable, "-B", str(Path(__file__).resolve()), *sys.argv[1:]],
    "candidateDdl": True,
    "migrationHistoryWritten": False,
    "seedPersistent": False,
    "concurrencyExecuted": False,
    "transportExecuted": False,
}
try:
    if sha(CONFIG) != "1be0fbd0e439ea6cac061d7fe5c66ea608ed9dab5c5e9d1376a7dd6bc5bfbcf0":
        raise RuntimeError("Native configuration SHA changed")
    spec = importlib.util.spec_from_file_location("offer_native", NATIVE)
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    target = native.configure(json.loads(CONFIG.read_text()))
    read = lambda sql: native.query(target, sql)
    bodies_sql = """select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'signature',p.oid::regprocedure::text,'oid',p.oid::bigint,
      'bodySha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
      'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,'definer',p.prosecdef,
      'acl',p.proacl::text,'language',l.lanname,'volatility',p.provolatile)
      order by n.nspname,p.oid::regprocedure::text),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      join pg_language l on l.oid=p.prolang
      where n.nspname in ('public','private','auth','storage') and p.prokind in ('f','p');"""

    def image():
        guard = native.guards(read, verify=False)
        return {"guards": guard, "data": native.rows(read, guard["catalog"]["dataTables"]), "functions": read(bodies_sql)}

    before = image()
    save("before.json", before)
    fixture = FIXTURE.read_text()
    match = re.search(r"foreach case_name in array array\[([\s\S]*?)\]\s+loop", fixture)
    cases = re.findall(r"'([a-z0-9-]+)'", match.group(1)) if match else []
    boundaries = list(re.finditer(r"^\s*(begin|commit|rollback)\s*;\s*$", fixture, re.M | re.I))
    if not cases or len(set(cases)) != len(cases) or [m.group(1).lower() for m in boundaries] != ["begin", "rollback"]:
        raise RuntimeError("Fixture inventory or transaction boundaries differ")
    if not fixture[:boundaries[0].start()].lstrip().startswith("-- PRECODE") or not fixture[boundaries[-1].end():].strip() == "":
        raise RuntimeError("Fixture boundary placement differs")
    fixture_body = fixture[:boundaries[0].start()] + fixture[boundaries[0].end():boundaries[-1].start()]
    ddl = migration.read_text()
    ddl_boundaries = list(re.finditer(r"^\s*(begin|commit|rollback)\s*;\s*$", ddl, re.M | re.I))
    preamble = ddl[:ddl_boundaries[0].start()] if ddl_boundaries else ""
    comments_only = all(not line.strip() or line.lstrip().startswith("--") for line in preamble.splitlines())
    if [m.group(1).lower() for m in ddl_boundaries] != ["begin", "commit"] or not comments_only or ddl[ddl_boundaries[-1].end():].strip():
        raise RuntimeError("Candidate DDL must have exactly one outer transaction")
    ddl_body = ddl[ddl_boundaries[0].end():ddl_boundaries[-1].start()]
    script = "\\set VERBOSITY verbose\nBEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='90s';\n" + ddl_body + "\n" + bodies_sql + "\n" + fixture_body
    (private / "input.sql").write_text(script, encoding="utf-8")
    receipt.update(startedAt=native.now(), target={
        "apiPort": 45585, "dbPort": target["dbPort"], "systemIdentifier": target["systemIdentifier"], "serverVersionNum": target["serverVersionNum"]
    }, expectedCases=cases)
    try:
        proc = subprocess.run(native.psql_command(), input=script, env=native.connection_env(target), capture_output=True, text=True, timeout=180)
    finally:
        # This independent connection runs even if setup/psql/timeout fails.
        after = image()
        save("after.json", after)
        if before != after:
            raise RuntimeError("Data/catalogue/history/functions/OIDs/ACL conservation differs")
        receipt.update(rollbackVerified=True, dataConserved=True, catalogConserved=True, historyConserved=True, privilegesConserved=True, bodiesAndOidsConserved=True)
    (private / "stdout.txt").write_text(proc.stdout, encoding="utf-8")
    (private / "stderr.txt").write_text(proc.stderr, encoding="utf-8")
    receipt["psqlExitCode"] = proc.returncode
    proofs = re.findall(r"ESTIMATE_OFFER_CONTRACT_PROOF:(\{[^\r\n]+\})", proc.stderr)
    if proc.returncode != 3 or not re.search(r"ERROR:\s+P9001:", proc.stderr) or len(proofs) != 1:
        # SQLSTATE only: PostgreSQL context may contain capability/private values.
        receipt["setupSqlstates"] = re.findall(r"ERROR:\s+([A-Z0-9]{5}):", proc.stderr)
        raise RuntimeError("Mandatory P9001 terminal absent; setup is missing proof")
    proof = json.loads(proofs[0])
    save("cases.json", proof)
    if [c["case"] for c in proof["cases"]] != cases or proof["caseCount"] != len(cases) or proof["fixturePrefix"] != "efca0700" or any(proof[k] is not False for k in ("concurrencyExecuted", "transportExecuted", "pdfBytesVerified", "sealHashVerified", "genuineLegacyOfferVerified")):
        raise RuntimeError("Terminal inventory or proof boundaries differ")
    body_outputs = [json.loads(line) for line in proc.stdout.splitlines() if line.startswith("[")]
    if len(body_outputs) != 1:
        raise RuntimeError("Transient function metadata absent")
    save("candidate-functions.json", body_outputs[0])
    if {p.relative_to(ROOT).as_posix(): sha(p) for p in sources} != hashes:
        raise RuntimeError("Frozen SQL sources changed during the probe")
    passed = sum(c["passed"] is True for c in proof["cases"])
    if proof["allPassed"] != (passed == len(cases)) or proof["failedCount"] != len(cases) - passed or any(c["passed"] is True and c["errorSqlstate"] is not None for c in proof["cases"]):
        raise RuntimeError("Terminal totals contradict individual results")
    receipt.update(status="verified" if passed == len(cases) else "regression-red", finishedAt=native.now(), cases=len(cases), passed=passed, failures=[c for c in proof["cases"] if c["passed"] is not True])
except Exception as exc:
    receipt.update(status="failed-setup-or-oracle", error=str(exc), finishedAt=native.now() if "native" in locals() else None)
receipt["artifacts"] = [{"name": p.relative_to(out).as_posix(), "sha256": sha(p)} for p in sorted(out.rglob("*")) if p.is_file()]
save("receipt.json", receipt)
print(json.dumps({"status": receipt["status"], "receipt": (out / "receipt.json").relative_to(ROOT).as_posix(), "sha256": sha(out / "receipt.json"), "cases": receipt.get("cases"), "passed": receipt.get("passed"), "error": receipt.get("error"), "setupSqlstates": receipt.get("setupSqlstates"), "failedCaseNames": [c["case"] for c in receipt.get("failures", [])]}))
if receipt["status"] != "verified":
    sys.exit(1)
