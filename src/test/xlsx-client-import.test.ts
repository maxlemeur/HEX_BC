import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.join(process.cwd(), "src");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const XLSX_SPECIFIER = "xlsx";

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function hasDirective(source: string, directive: "use client" | "use server") {
  const withoutBom = source.replace(/^\uFEFF/, "");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    withoutBom
  );
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return false;
    if (
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      const text = scanner.getTokenValue();
      return text === directive;
    }
    return false;
  }
}

function hasUseClientDirective(source: string) {
  return hasDirective(source, "use client");
}

function hasUseServerDirective(source: string) {
  return hasDirective(source, "use server");
}

function isTypeOnlyImport(node: ts.ImportDeclaration) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return false;
  }
  if (clause.name) return false;
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function collectStaticSpecifiers(sourceFile: ts.SourceFile) {
  const specifiers: string[] = [];

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement) && !isTypeOnlyImport(statement)) {
      if (ts.isStringLiteralLike(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
      return;
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  });

  return specifiers;
}

function collectStaticXlsxImports(sourceFile: ts.SourceFile) {
  const hits: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && !isTypeOnlyImport(node)) {
      if (
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        node.moduleSpecifier.text === XLSX_SPECIFIER
      ) {
        hits.push("import");
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === XLSX_SPECIFIER
    ) {
      hits.push("export");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression) &&
      node.moduleReference.expression.text === XLSX_SPECIFIER
    ) {
      hits.push("import-equals");
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === XLSX_SPECIFIER
    ) {
      hits.push("require");
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
}

function resolveLocalSpecifier(fromFile: string, specifier: string) {
  if (specifier === XLSX_SPECIFIER) return XLSX_SPECIFIER;
  if (specifier.startsWith("node:") || !specifier.startsWith(".") && !specifier.startsWith("@/")) {
    return null;
  }

  const base = specifier.startsWith("@/")
    ? path.join(SRC_ROOT, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, "index" + extension)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolute));
      continue;
    }
    if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function parseSource(filePath: string) {
  // setParentNodes stays false: the walk uses forEachChild only, and building
  // parent pointers over the whole tree is the bulk of the parse cost.
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Breadth-first walk of the static (value) import graph from every "use client"
 * module. A module marked "use server" is a real bundle boundary (server action
 * reference), so the walk stops there; anything else that statically reaches
 * `xlsx` ends up in the client bundle, whatever the depth.
 */
function findClientXlsxViolations() {
  const files = listSourceFiles(SRC_ROOT);
  const clientFiles: string[] = [];
  const violations: string[] = [];
  const sourceCache = new Map<string, ts.SourceFile>();
  const textCache = new Map<string, string>();

  const readText = (filePath: string) => {
    let text = textCache.get(filePath);
    if (text === undefined) {
      text = fs.readFileSync(filePath, "utf8");
      textCache.set(filePath, text);
    }
    return text;
  };
  const parse = (filePath: string) => {
    let parsed = sourceCache.get(filePath);
    if (!parsed) {
      parsed = parseSource(filePath);
      sourceCache.set(filePath, parsed);
    }
    return parsed;
  };
  const label = (filePath: string) =>
    normalizePath(path.relative(process.cwd(), filePath));

  for (const filePath of files) {
    if (!hasUseClientDirective(readText(filePath))) continue;
    clientFiles.push(filePath);

    const seen = new Set<string>([filePath]);
    const queue: Array<{ file: string; chain: string[] }> = [
      { file: filePath, chain: [label(filePath)] },
    ];

    while (queue.length > 0) {
      const { file, chain } = queue.shift()!;
      const sourceFile = parse(file);
      if (collectStaticXlsxImports(sourceFile).length > 0) {
        violations.push(`${chain.join(" -> ")} statically imports xlsx`);
        break;
      }
      for (const specifier of collectStaticSpecifiers(sourceFile)) {
        const resolved = resolveLocalSpecifier(file, specifier);
        if (resolved === XLSX_SPECIFIER) {
          violations.push(`${chain.join(" -> ")} statically imports xlsx`);
          break;
        }
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        // Server action modules are referenced, not bundled, by client code.
        if (hasUseServerDirective(readText(resolved))) continue;
        queue.push({ file: resolved, chain: [...chain, label(resolved)] });
      }
    }
  }

  return { clientFiles, violations };
}

describe("xlsx is not statically reachable from use client modules", () => {
  // Whole-tree scan: give it a real budget instead of the 5s default, which it
  // exceeds under CI contention (observed 4.9s idle).
  it(
    "fails when a use client module statically reaches xlsx at any depth (stopping at use server boundaries)",
    () => {
      const { clientFiles, violations } = findClientXlsxViolations();

      expect(clientFiles.length).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    },
    30_000
  );
});
