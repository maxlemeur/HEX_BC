import { describe, expect, it, vi } from "vitest";

import {
  assertDependencyAudit,
  evaluateDependencyAudit,
  parseDependencyAuditPolicy,
  parseNpmAuditReport,
  runDependencyAuditGate,
} from "@/test/dependency-audit";

type Severity = "info" | "low" | "moderate" | "high" | "critical";

const severities: Severity[] = [
  "info",
  "low",
  "moderate",
  "high",
  "critical",
];

function auditReport(
  vulnerabilities: Record<string, Record<string, unknown>> = {}
) {
  const counts = Object.fromEntries(
    severities.map((severity) => [
      severity,
      Object.values(vulnerabilities).filter(
        (vulnerability) => vulnerability.severity === severity
      ).length,
    ])
  );
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        ...counts,
        total: Object.keys(vulnerabilities).length,
      },
      dependencies: { total: 1 },
    },
  });
}

function advisory(
  packageName: string,
  source: number,
  severity: Severity = "high"
) {
  return {
    dependency: packageName,
    name: packageName,
    severity,
    source,
    title: `${packageName} advisory`,
    url: `https://example.test/advisories/${source}`,
  };
}

function policy(
  exceptions: Array<Record<string, unknown>> = []
) {
  return JSON.stringify({ version: 1, exceptions });
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    package: "vulnerable-package",
    source: 12345,
    reason: "Accepted temporarily while the upstream fix is validated.",
    owner: "security@example.test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dependency audit gate", () => {
  it("accepts a readable npm audit v2 report without moderate-or-higher vulnerabilities", () => {
    const report = parseNpmAuditReport(
      auditReport({
        "low-package": {
          name: "low-package",
          severity: "low",
          via: [advisory("low-package", 10, "low")],
        },
      })
    );
    const parsedPolicy = parseDependencyAuditPolicy(policy());

    expect(assertDependencyAudit(report, parsedPolicy)).toMatchObject({
      errors: [],
      findings: [],
    });
  });

  it("fails closed on unreadable, non-v2, and inconsistent audit output", () => {
    expect(() => parseNpmAuditReport("not json")).toThrow("not valid JSON");
    expect(() =>
      parseNpmAuditReport(
        JSON.stringify({ auditReportVersion: 1, vulnerabilities: {} })
      )
    ).toThrow("version 2");

    const inconsistent = JSON.parse(auditReport()) as Record<string, unknown>;
    const metadata = inconsistent.metadata as {
      vulnerabilities: Record<string, number>;
    };
    metadata.vulnerabilities.high = 1;
    expect(() => parseNpmAuditReport(JSON.stringify(inconsistent))).toThrow(
      "high count is inconsistent"
    );

    expect(() =>
      parseNpmAuditReport(
        JSON.stringify({ error: { code: "ENOAUDIT", summary: "network" } })
      )
    ).toThrow("version 2");
  });

  it("blocks moderate, high, and critical advisories and resolves transitive npm via entries", () => {
    const report = parseNpmAuditReport(
      auditReport({
        "direct-parent": {
          name: "direct-parent",
          severity: "critical",
          via: ["vulnerable-package"],
        },
        "vulnerable-package": {
          name: "vulnerable-package",
          severity: "high",
          via: [advisory("vulnerable-package", 12345)],
        },
      })
    );
    const evaluation = evaluateDependencyAudit(
      report,
      parseDependencyAuditPolicy(policy())
    );

    expect(evaluation.findings).toEqual([
      expect.objectContaining({
        package: "vulnerable-package",
        severity: "critical",
        source: 12345,
      }),
    ]);
    expect(evaluation.errors).toContain(
      "critical vulnerability: vulnerable-package source 12345"
    );

    const inconsistentSeverity = evaluateDependencyAudit(
      parseNpmAuditReport(
        auditReport({
          "vulnerable-package": {
            name: "vulnerable-package",
            severity: "moderate",
            via: [advisory("vulnerable-package", 12345, "critical")],
          },
        })
      ),
      parseDependencyAuditPolicy(policy())
    );
    expect(inconsistentSeverity.errors).toContain(
      "critical vulnerability: vulnerable-package source 12345"
    );

    const moderate = evaluateDependencyAudit(
      parseNpmAuditReport(
        auditReport({
          "moderate-package": {
            name: "moderate-package",
            severity: "moderate",
            via: [advisory("moderate-package", 23456, "moderate")],
          },
        })
      ),
      parseDependencyAuditPolicy(policy())
    );
    expect(moderate.errors).toContain(
      "moderate vulnerability: moderate-package source 23456"
    );
  });

  it("accepts only an exact, justified, owned, unexpired package-source exception", () => {
    const report = parseNpmAuditReport(
      auditReport({
        "vulnerable-package": {
          name: "vulnerable-package",
          severity: "high",
          via: [advisory("vulnerable-package", 12345)],
        },
      })
    );
    const parsedPolicy = parseDependencyAuditPolicy(policy([exception()]));

    expect(
      assertDependencyAudit(
        report,
        parsedPolicy,
        new Date("2098-12-31T23:59:59.999Z")
      )
    ).toMatchObject({
      errors: [],
      exceptedFindings: [
        expect.objectContaining({
          package: "vulnerable-package",
          source: 12345,
        }),
      ],
    });
  });

  it("rejects mismatched, expired, and unused exceptions", () => {
    const report = parseNpmAuditReport(
      auditReport({
        "vulnerable-package": {
          name: "vulnerable-package",
          severity: "high",
          via: [advisory("vulnerable-package", 12345)],
        },
      })
    );

    const mismatch = evaluateDependencyAudit(
      report,
      parseDependencyAuditPolicy(
        policy([exception({ package: "other-package" })])
      )
    );
    expect(mismatch.errors).toEqual(
      expect.arrayContaining([
        "unused exception: other-package source 12345",
        "high vulnerability: vulnerable-package source 12345",
      ])
    );

    const expired = evaluateDependencyAudit(
      report,
      parseDependencyAuditPolicy(
        policy([exception({ expiresAt: "2026-08-12T00:00:00.000Z" })])
      ),
      new Date("2026-08-12T00:00:00.000Z")
    );
    expect(expired.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expired exception: vulnerable-package source 12345"),
        "high vulnerability: vulnerable-package source 12345",
      ])
    );

    const unused = evaluateDependencyAudit(
      parseNpmAuditReport(auditReport()),
      parseDependencyAuditPolicy(policy([exception()]))
    );
    expect(unused.errors).toContain(
      "unused exception: vulnerable-package source 12345"
    );
  });

  it("rejects incomplete, ambiguous, duplicated, or misspelled policy entries", () => {
    for (const field of ["reason", "owner", "expiresAt"] as const) {
      const invalid = exception({ [field]: "" });
      expect(() => parseDependencyAuditPolicy(policy([invalid]))).toThrow(field);
    }
    expect(() =>
      parseDependencyAuditPolicy(
        policy([exception({ expiresAt: "2099-02-30T00:00:00.000Z" })])
      )
    ).toThrow("valid ISO 8601 UTC timestamp");
    expect(() =>
      parseDependencyAuditPolicy(
        policy([exception({ unexpectedField: true })])
      )
    ).toThrow("unknown fields");
    expect(() =>
      parseDependencyAuditPolicy(policy([exception(), exception()]))
    ).toThrow("duplicates package");
  });

  it("runs the full npm audit command and applies the tracked policy", () => {
    const executeCommand = vi.fn(
      (command: string, args: readonly string[], rootDirectory: string) => {
        expect(command).toBe(
          process.platform === "win32" ? process.execPath : "npm"
        );
        expect(args.slice(-2)).toEqual(["audit", "--json"]);
        expect(args).not.toContain("--omit");
        expect(rootDirectory).toBe("C:\\fixture");
        return {
          status: 0,
          stdout: auditReport(),
        };
      }
    );
    const readFile = vi.fn(() => policy());

    expect(
      runDependencyAuditGate({
        executeCommand,
        readFile,
        rootDirectory: "C:\\fixture",
      })
    ).toMatchObject({ errors: [], findings: [] });
    expect(executeCommand).toHaveBeenCalledOnce();
    expect(readFile).toHaveBeenCalledWith(
      expect.stringMatching(/config[\\/]dependency-audit-policy\.json$/)
    );
  });

  it("fails closed when npm audit cannot run or returns an error document", () => {
    expect(() =>
      runDependencyAuditGate({
        executeCommand: () => ({ status: 1, stdout: "" }),
        readFile: () => policy(),
      })
    ).toThrow("not valid JSON");

    expect(() =>
      runDependencyAuditGate({
        executeCommand: () => ({
          status: 1,
          stdout: JSON.stringify({
            error: { code: "ENOAUDIT", summary: "registry unavailable" },
          }),
        }),
        readFile: () => policy(),
      })
    ).toThrow("version 2");

    expect(() =>
      runDependencyAuditGate({
        executeCommand: () => ({ status: 2, stdout: auditReport() }),
        readFile: () => policy(),
      })
    ).toThrow("unexpected exit status 2");
  });
});
