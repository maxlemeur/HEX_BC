import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export const PLATFORM_ENV_KEYS = [
  "CI",
  "NODE_ENV",
  "VERCEL_ENV",
  "NEXT_RUNTIME",
] as const;

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/)|(?:^|\/)test\/|\.(?:test|spec|test-utils)\.(?:[cm]?[jt]sx?)$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export type CollectProcessEnvKeysOptions = {
  sourceDirectory?: string;
};

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function isDeclarationFile(filePath: string) {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.cts") || filePath.endsWith(".d.mts");
}

export function isInventorySourceFile(relativePath: string) {
  const normalized = normalizePath(relativePath);
  if (normalized === "src/test" || normalized.startsWith("src/test/")) {
    return false;
  }
  if (TEST_FILE_PATTERN.test(normalized) || isDeclarationFile(normalized)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.posix.extname(normalized));
}

export function parseEnvExampleKeys(source: string) {
  const keys = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(trimmed);
    if (match) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

function isProcessEnvExpression(node: ts.Expression) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

function collectStringLiteralsFromType(typeNode: ts.TypeNode | undefined, keys: Set<string>) {
  if (!typeNode) {
    return;
  }
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteralLike(typeNode.literal)) {
    if (ENV_KEY_PATTERN.test(typeNode.literal.text)) {
      keys.add(typeNode.literal.text);
    }
    return;
  }
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    for (const part of typeNode.types) {
      collectStringLiteralsFromType(part, keys);
    }
    return;
  }
  if (ts.isParenthesizedTypeNode(typeNode)) {
    collectStringLiteralsFromType(typeNode.type, keys);
  }
}

function readConstStringLiteral(node: ts.Expression | undefined) {
  if (!node) {
    return null;
  }
  if (ts.isStringLiteralLike(node) && ENV_KEY_PATTERN.test(node.text)) {
    return node.text;
  }
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return readConstStringLiteral(node.expression);
  }
  return null;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function functionBindingName(fn: ts.SignatureDeclaration) {
  if (fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return fn.parent.name.text;
  }
  return null;
}

function resolveCalleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveCalleeName(expression.expression);
  }
  return null;
}

export function collectProcessEnvKeysFromSource(source: string) {
  const sourceFile = ts.createSourceFile(
    "module.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const keys = new Set<string>();
  const constBindings = new Map<string, string>();
  const envParamUsages: Array<{ functionName: string; parameterIndex: number }> = [];

  function visitBindings(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const literal = readConstStringLiteral(node.initializer);
      if (literal) {
        constBindings.set(node.name.text, literal);
      }
    }
    ts.forEachChild(node, visitBindings);
  }

  function visitAccesses(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && isProcessEnvExpression(node.expression)) {
      if (ENV_KEY_PATTERN.test(node.name.text)) {
        keys.add(node.name.text);
      }
    } else if (ts.isElementAccessExpression(node) && isProcessEnvExpression(node.expression)) {
      const argument = node.argumentExpression;
      if (argument && ts.isStringLiteralLike(argument) && ENV_KEY_PATTERN.test(argument.text)) {
        keys.add(argument.text);
      } else if (argument && ts.isIdentifier(argument)) {
        const bound = constBindings.get(argument.text);
        if (bound) {
          keys.add(bound);
        }

        const fn = enclosingFunction(node);
        const parameterIndex = fn
          ? fn.parameters.findIndex(
              (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === argument.text
            )
          : -1;
        if (fn && parameterIndex >= 0) {
          collectStringLiteralsFromType(fn.parameters[parameterIndex]?.type, keys);
          const functionName = functionBindingName(fn);
          if (functionName) {
            envParamUsages.push({ functionName, parameterIndex });
          }
        }
      }
    }

    ts.forEachChild(node, visitAccesses);
  }

  function visitCalls(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const calleeName = resolveCalleeName(node.expression);
      if (calleeName) {
        for (const usage of envParamUsages) {
          if (usage.functionName !== calleeName) {
            continue;
          }
          const argument = node.arguments[usage.parameterIndex];
          const literal = readConstStringLiteral(argument);
          if (literal) {
            keys.add(literal);
          }
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  }

  visitBindings(sourceFile);
  visitAccesses(sourceFile);
  visitCalls(sourceFile);
  return [...keys].sort();
}

export function collectProcessEnvKeysFromDirectory(
  rootDirectory: string,
  options: CollectProcessEnvKeysOptions = {}
) {
  const sourceDirectory = path.resolve(
    rootDirectory,
    options.sourceDirectory ?? "src"
  );
  const keys = new Set<string>();

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = normalizePath(path.relative(rootDirectory, absolutePath));
      if (!isInventorySourceFile(relativePath)) {
        continue;
      }
      for (const key of collectProcessEnvKeysFromSource(
        fs.readFileSync(absolutePath, "utf8")
      )) {
        keys.add(key);
      }
    }
  }

  if (fs.existsSync(sourceDirectory)) {
    visit(sourceDirectory);
  }
  return [...keys].sort();
}
