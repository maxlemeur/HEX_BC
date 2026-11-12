// The declarations a journey may not make (docs/testing/tester-army-ci.md, "Tentative unique et quarantaine"),
// read from the journeys' source before any campaign runs. A campaign that executes such a journey is red too
// (journey-outcomes.ts); this guard says so in `npm run verify:pr`, without a stack.
//
// - `test.fail` is accepted in e2e/ only with a reason written as a literal that cites a ticket: the option
//   `{ fail: "TI-681: …" }` or, in a body, `test.fail("TI-681: …")` and `test.fail(condition, "TI-681: …")`.
//   The registration form `test.fail(title, fn)` and `{ fail: true }` carry no reason and are refused.
// - A journey sets no `retries` of its own other than 0: the runner accepts up to 10 on a test or a describe,
//   above the configuration, and the one retry of CI would no longer be the only one.
//
// Run as a script (check:army-recipes), it reads every source file under e2e/ and exits 1 on an offender.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { quarantineTicket } from "./journey-outcomes";

const rootName = (node: ts.Expression): string | undefined => {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
};

/**
 * The runner's registration API under any local name: `import { test as it }`, `const it = test.extend(…)`,
 * and an extended API imported from a fixtures module, which most journeys use (`armyTest`, `offerTest`).
 */
function registrationApi(source: ts.SourceFile): Set<string> {
  const api = new Set(["test", "describe"]);
  for (let size = -1; size !== api.size;) {
    size = api.size;
    const collect = (node: ts.Node) => {
      if (ts.isImportSpecifier(node) && (api.has((node.propertyName ?? node.name).text) || /Test$/u.test((node.propertyName ?? node.name).text))) api.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && api.has(rootName(node.initializer) ?? "")) api.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  return api;
}

const position = (source: ts.SourceFile, file: string, node: ts.Node) =>
  `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

/** The `test.fail` marks of a journey file that are not a quarantine with a ticket. */
export function quarantineOffenders(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const api = registrationApi(source);
  const literal = (node: ts.Node | undefined) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const offenders: string[] = [];
  const offend = (node: ts.Node, what: string) => { offenders.push(`${position(source, file, node)}: ${what}`); };
  const checkReason = (node: ts.Node, reason: ts.Node | undefined) => {
    const text = literal(reason);
    if (text === undefined) offend(node, "test.fail without a reason written as a string literal");
    else if (!quarantineTicket(text)) offend(node, `test.fail reason "${text}" cites no ticket`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && api.has(rootName(node.expression) ?? "")) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fail") {
        if (node.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
          offend(node, "test.fail(title, fn) registers an expected failure without a reason: use the option { fail: \"TI-…: reason\" }");
        } else checkReason(node, node.arguments.length === 1 ? node.arguments[0] : node.arguments[1]);
      }
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (!property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || property.name.text !== "fail") continue;
          checkReason(property, ts.isPropertyAssignment(property) ? property.initializer : undefined);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

/** The `retries` a journey file gives one of its tests or describes, other than the literal 0. */
export function retriesOffenders(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const api = registrationApi(source);
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && api.has(rootName(node.expression) ?? "")) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (!property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || property.name.text !== "retries") continue;
          const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
          if (!(value && ts.isNumericLiteral(value) && Number(value.text) === 0)) {
            offenders.push(`${position(source, file, property)}: a journey sets no retries of its own other than 0 (CI retries a failed journey once, to classify it)`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

/** Every offender of the source files under e2e/, and how many files were read. */
export function journeyDeclarationProblems(root: string): { files: number; offenders: string[] } {
  const files = fs.readdirSync(path.join(root, "e2e"), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.[cm]?[jt]sx?$/u.test(name))
    .map((name) => path.posix.join("e2e", name.split(path.sep).join("/")))
    .sort();
  const offenders = files.flatMap((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return [...quarantineOffenders(file, text), ...retriesOffenders(file, text)];
  });
  return { files: files.length, offenders };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, offenders } = journeyDeclarationProblems(process.cwd());
  if (files < 100) offenders.push(`Only ${files} source file(s) found under e2e/: run this check from the repository root.`);
  if (offenders.length) {
    console.error(["Journey declarations refused (docs/testing/tester-army-ci.md, « Tentative unique et quarantaine »):",
      ...offenders.map((offender) => `- ${offender}`),
      "test.fail is a quarantine for a journey that is red on main: its reason is a string literal that cites an open " +
      "Linear id (TI-681) or GitHub issue (#123)."].join("\n"));
    process.exit(1);
  }
  console.log(`Journey declarations: ${files} file(s), no test.fail without a ticket, no retries of their own.`);
}
