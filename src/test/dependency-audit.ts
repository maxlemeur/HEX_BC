import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const AUDIT_POLICY_PATH = "config/dependency-audit-policy.json";
const AUDIT_SEVERITIES = [
  "info",
  "low",
  "moderate",
  "high",
  "critical",
] as const;
const BLOCKING_SEVERITIES = new Set<AuditSeverity>([
  "moderate",
  "high",
  "critical",
]);
const POLICY_ROOT_KEYS = new Set(["version", "exceptions"]);
const POLICY_EXCEPTION_KEYS = new Set([
  "package",
  "source",
  "reason",
  "owner",
  "expiresAt",
]);
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

interface NpmAuditAdvisory {
  dependency: string;
  severity: AuditSeverity;
  source: number;
  title?: string;
  url?: string;
}

interface NpmAuditVulnerability {
  name: string;
  severity: AuditSeverity;
  via: Array<string | NpmAuditAdvisory>;
}

export interface NpmAuditReport {
  auditReportVersion: 2;
  metadata: {
    vulnerabilities: Record<AuditSeverity | "total", number>;
  };
  vulnerabilities: Record<string, NpmAuditVulnerability>;
}

export interface DependencyAuditException {
  expiresAt: string;
  owner: string;
  package: string;
  reason: string;
  source: number;
}

export interface DependencyAuditPolicy {
  exceptions: DependencyAuditException[];
  version: 1;
}

export interface DependencyAuditFinding {
  package: string;
  severity: "moderate" | "high" | "critical";
  source: number;
  title?: string;
  url?: string;
}

export interface DependencyAuditEvaluation {
  errors: string[];
  exceptedFindings: DependencyAuditFinding[];
  findings: DependencyAuditFinding[];
  unexceptedFindings: DependencyAuditFinding[];
}

interface AuditCommandResult {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status: number | null;
  stderr?: string;
  stdout?: string;
}

export interface DependencyAuditGateDependencies {
  executeCommand?: (
    command: string,
    args: readonly string[],
    rootDirectory: string
  ) => AuditCommandResult;
  now?: Date;
  readFile?: (filePath: string) => string;
  rootDirectory?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(input: string, label: string) {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  label: string
) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} has unknown fields: ${unknownKeys.join(", ")}`);
  }
}

function requireNonBlankString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not contain surrounding whitespace`);
  }
  return value;
}

function requireSource(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function parseSeverity(value: unknown, label: string): AuditSeverity {
  if (
    typeof value !== "string" ||
    !AUDIT_SEVERITIES.includes(value as AuditSeverity)
  ) {
    throw new Error(`${label} is not a recognized npm audit severity`);
  }
  return value as AuditSeverity;
}

function parseUtcTimestamp(value: unknown, label: string) {
  const timestamp = requireNonBlankString(value, label);
  if (!UTC_TIMESTAMP_PATTERN.test(timestamp)) {
    throw new Error(`${label} must be an ISO 8601 UTC timestamp`);
  }

  const parsed = new Date(timestamp);
  const normalized = timestamp.includes(".")
    ? timestamp
    : timestamp.replace(/Z$/, ".000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} must be a valid ISO 8601 UTC timestamp`);
  }
  return timestamp;
}

function parseAdvisory(value: unknown, label: string): NpmAuditAdvisory {
  const advisory = requireRecord(value, label);
  const title = advisory.title;
  const url = advisory.url;
  if (title !== undefined && typeof title !== "string") {
    throw new Error(`${label}.title must be a string when present`);
  }
  if (url !== undefined && typeof url !== "string") {
    throw new Error(`${label}.url must be a string when present`);
  }

  return {
    dependency: requireNonBlankString(
      advisory.dependency ?? advisory.name,
      `${label}.dependency`
    ),
    severity: parseSeverity(advisory.severity, `${label}.severity`),
    source: requireSource(advisory.source, `${label}.source`),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
  };
}

export function parseNpmAuditReport(input: string): NpmAuditReport {
  const report = requireRecord(parseJson(input, "npm audit output"), "npm audit output");
  if (report.auditReportVersion !== 2) {
    throw new Error("npm audit output must use audit report version 2");
  }

  const rawVulnerabilities = requireRecord(
    report.vulnerabilities,
    "npm audit vulnerabilities"
  );
  const vulnerabilities: Record<string, NpmAuditVulnerability> = {};

  for (const [packageName, rawValue] of Object.entries(rawVulnerabilities)) {
    const label = `npm audit vulnerability ${packageName}`;
    const vulnerability = requireRecord(rawValue, label);
    const name = requireNonBlankString(vulnerability.name, `${label}.name`);
    if (name !== packageName) {
      throw new Error(`${label}.name must exactly match its package key`);
    }
    if (!Array.isArray(vulnerability.via)) {
      throw new Error(`${label}.via must be an array`);
    }

    vulnerabilities[packageName] = {
      name,
      severity: parseSeverity(vulnerability.severity, `${label}.severity`),
      via: vulnerability.via.map((entry, index) => {
        if (typeof entry === "string") {
          return requireNonBlankString(entry, `${label}.via[${index}]`);
        }
        return parseAdvisory(entry, `${label}.via[${index}]`);
      }),
    };
  }

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    for (const via of vulnerability.via) {
      if (typeof via === "string" && !vulnerabilities[via]) {
        throw new Error(
          `npm audit vulnerability ${packageName} references missing dependency ${via}`
        );
      }
    }
  }

  const metadata = requireRecord(report.metadata, "npm audit metadata");
  const rawCounts = requireRecord(
    metadata.vulnerabilities,
    "npm audit metadata.vulnerabilities"
  );
  const counts = {} as Record<AuditSeverity | "total", number>;
  for (const severity of [...AUDIT_SEVERITIES, "total"] as const) {
    const count = rawCounts[severity];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error(
        `npm audit metadata.vulnerabilities.${severity} must be a non-negative integer`
      );
    }
    counts[severity] = count as number;
  }

  for (const severity of AUDIT_SEVERITIES) {
    const actualCount = Object.values(vulnerabilities).filter(
      (vulnerability) => vulnerability.severity === severity
    ).length;
    if (counts[severity] !== actualCount) {
      throw new Error(
        `npm audit ${severity} count is inconsistent with vulnerability records`
      );
    }
  }
  if (counts.total !== Object.keys(vulnerabilities).length) {
    throw new Error("npm audit total count is inconsistent with vulnerability records");
  }

  return {
    auditReportVersion: 2,
    metadata: { vulnerabilities: counts },
    vulnerabilities,
  };
}

export function parseDependencyAuditPolicy(
  input: string | unknown
): DependencyAuditPolicy {
  const parsed = typeof input === "string" ? parseJson(input, "dependency audit policy") : input;
  const policy = requireRecord(parsed, "dependency audit policy");
  requireExactKeys(policy, POLICY_ROOT_KEYS, "dependency audit policy");
  if (policy.version !== 1) {
    throw new Error("dependency audit policy version must be 1");
  }
  if (!Array.isArray(policy.exceptions)) {
    throw new Error("dependency audit policy exceptions must be an array");
  }

  const seenKeys = new Set<string>();
  const exceptions = policy.exceptions.map((rawException, index) => {
    const label = `dependency audit exception[${index}]`;
    const exception = requireRecord(rawException, label);
    requireExactKeys(exception, POLICY_EXCEPTION_KEYS, label);
    const parsedException: DependencyAuditException = {
      expiresAt: parseUtcTimestamp(exception.expiresAt, `${label}.expiresAt`),
      owner: requireNonBlankString(exception.owner, `${label}.owner`),
      package: requireNonBlankString(exception.package, `${label}.package`),
      reason: requireNonBlankString(exception.reason, `${label}.reason`),
      source: requireSource(exception.source, `${label}.source`),
    };
    const key = findingKey(parsedException.package, parsedException.source);
    if (seenKeys.has(key)) {
      throw new Error(
        `${label} duplicates package ${parsedException.package} source ${parsedException.source}`
      );
    }
    seenKeys.add(key);
    return parsedException;
  });

  return { exceptions, version: 1 };
}

function findingKey(packageName: string, source: number) {
  return `${packageName}\0${source}`;
}

function severityRank(severity: AuditSeverity) {
  return AUDIT_SEVERITIES.indexOf(severity);
}

function collectAdvisories(
  packageName: string,
  report: NpmAuditReport,
  visited: Set<string>
): NpmAuditAdvisory[] {
  if (visited.has(packageName)) {
    return [];
  }
  visited.add(packageName);

  const vulnerability = report.vulnerabilities[packageName];
  if (!vulnerability) {
    return [];
  }

  return vulnerability.via.flatMap((entry) =>
    typeof entry === "string"
      ? collectAdvisories(entry, report, new Set(visited))
      : [entry]
  );
}

function collectBlockingFindings(report: NpmAuditReport) {
  const findings = new Map<string, DependencyAuditFinding>();

  for (const [packageName, vulnerability] of Object.entries(
    report.vulnerabilities
  )) {
    const advisories = collectAdvisories(packageName, report, new Set());
    if (advisories.length === 0) {
      if (BLOCKING_SEVERITIES.has(vulnerability.severity)) {
        throw new Error(
          `blocking npm audit vulnerability ${packageName} has no exact advisory source`
        );
      }
      continue;
    }

    for (const advisory of advisories) {
      const severity =
        severityRank(vulnerability.severity) >= severityRank(advisory.severity)
          ? vulnerability.severity
          : advisory.severity;
      if (!BLOCKING_SEVERITIES.has(severity)) {
        continue;
      }

      const key = findingKey(advisory.dependency, advisory.source);
      const existing = findings.get(key);
      if (!existing || severityRank(severity) > severityRank(existing.severity)) {
        findings.set(key, {
          package: advisory.dependency,
          severity: severity as "moderate" | "high" | "critical",
          source: advisory.source,
          ...(advisory.title ? { title: advisory.title } : {}),
          ...(advisory.url ? { url: advisory.url } : {}),
        });
      }
    }
  }

  return [...findings.values()].sort(
    (left, right) =>
      left.package.localeCompare(right.package) || left.source - right.source
  );
}

export function evaluateDependencyAudit(
  report: NpmAuditReport,
  policy: DependencyAuditPolicy,
  now = new Date()
): DependencyAuditEvaluation {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("dependency audit evaluation time must be valid");
  }

  const findings = collectBlockingFindings(report);
  const findingKeys = new Set(
    findings.map((finding) => findingKey(finding.package, finding.source))
  );
  const activeExceptions = new Set<string>();
  const errors: string[] = [];

  for (const exception of policy.exceptions) {
    const key = findingKey(exception.package, exception.source);
    if (new Date(exception.expiresAt).getTime() <= now.getTime()) {
      errors.push(
        `expired exception: ${exception.package} source ${exception.source} expired at ${exception.expiresAt}`
      );
    } else {
      activeExceptions.add(key);
    }
    if (!findingKeys.has(key)) {
      errors.push(
        `unused exception: ${exception.package} source ${exception.source}`
      );
    }
  }

  const exceptedFindings = findings.filter((finding) =>
    activeExceptions.has(findingKey(finding.package, finding.source))
  );
  const unexceptedFindings = findings.filter(
    (finding) => !activeExceptions.has(findingKey(finding.package, finding.source))
  );
  for (const finding of unexceptedFindings) {
    errors.push(
      `${finding.severity} vulnerability: ${finding.package} source ${finding.source}`
    );
  }

  return { errors, exceptedFindings, findings, unexceptedFindings };
}

export function assertDependencyAudit(
  report: NpmAuditReport,
  policy: DependencyAuditPolicy,
  now = new Date()
) {
  const evaluation = evaluateDependencyAudit(report, policy, now);
  if (evaluation.errors.length > 0) {
    throw new Error(
      `Dependency audit gate failed:\n- ${evaluation.errors.join("\n- ")}`
    );
  }
  return evaluation;
}

function executeNpmAudit(
  command: string,
  args: readonly string[],
  rootDirectory: string
): AuditCommandResult {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  return {
    error: result.error,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function npmAuditInvocation() {
  if (process.platform !== "win32") {
    return { args: ["audit", "--json"], command: "npm" };
  }

  // Node 24 refuses to spawn .cmd shims without a shell. Invoke npm's bundled
  // CLI with the current Node binary so command arguments stay non-shell data.
  const npmCliPath = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  return {
    args: [npmCliPath, "audit", "--json"],
    command: process.execPath,
  };
}

export function runDependencyAuditGate(
  dependencies: DependencyAuditGateDependencies = {}
) {
  const rootDirectory = dependencies.rootDirectory ?? process.cwd();
  const executeCommand = dependencies.executeCommand ?? executeNpmAudit;
  const invocation = npmAuditInvocation();
  const result = executeCommand(
    invocation.command,
    invocation.args,
    rootDirectory
  );

  if (result.error) {
    throw new Error(`npm audit could not start: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`npm audit was terminated by signal ${result.signal}`);
  }
  if (result.status === null || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit failed with unexpected exit status ${result.status}`);
  }

  const report = parseNpmAuditReport(result.stdout ?? "");
  const policyPath = path.join(rootDirectory, AUDIT_POLICY_PATH);
  const readFile = dependencies.readFile ?? ((filePath) => fs.readFileSync(filePath, "utf8"));
  let policyText: string;
  try {
    policyText = readFile(policyPath);
  } catch {
    throw new Error(`dependency audit policy could not be read at ${AUDIT_POLICY_PATH}`);
  }
  const policy = parseDependencyAuditPolicy(policyText);
  return assertDependencyAudit(report, policy, dependencies.now);
}
