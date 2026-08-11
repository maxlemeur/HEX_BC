import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export interface ArchitectureBudgetConfig {
  version: 1;
  sourceDirectory: string;
  excludedModulePaths: string[];
  allowedCycles: string[][];
  hotspotNonEmptyLineBudgets: Record<string, number>;
  maxNewModuleNonEmptyLines: number;
}

export interface ArchitectureModuleMetric {
  path: string;
  nonEmptyLines: number;
  runtimeDependencies: string[];
}

export interface ArchitectureAnalysis {
  modules: ArchitectureModuleMetric[];
  cycles: string[][];
}

export interface ArchitectureBudgetResult {
  analysis: ArchitectureAnalysis;
  errors: string[];
}

interface AnalyzeArchitectureOptions {
  config: ArchitectureBudgetConfig;
  rootDirectory: string;
}

const TYPESCRIPT_MODULE_PATTERN = /\.(?:[cm]?ts|tsx)$/;
const TEST_MODULE_PATTERN =
  /(?:^|\/)(?:__tests__\/|test\/)|\.(?:test|spec|test-utils)\.(?:[cm]?ts|tsx)$/;
const CODE_MODULE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function canonicalCycle(cycle: readonly string[]) {
  return [...cycle].sort().join("\0");
}

function countNonEmptyLines(source: string) {
  return source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function isCodeLikeModuleSpecifier(specifier: string) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const extension = path.posix.extname(cleanSpecifier);
  return extension.length === 0 || CODE_MODULE_EXTENSIONS.has(extension);
}

function isRuntimeImportDeclaration(node: ts.ImportDeclaration) {
  const clause = node.importClause;
  if (!clause) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  if (clause.name || !clause.namedBindings) {
    return true;
  }
  if (ts.isNamespaceImport(clause.namedBindings)) {
    return true;
  }
  return (
    clause.namedBindings.elements.length === 0 ||
    clause.namedBindings.elements.some((element) => !element.isTypeOnly)
  );
}

function isRuntimeExportDeclaration(node: ts.ExportDeclaration) {
  if (node.isTypeOnly) {
    return false;
  }
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return true;
  }
  return (
    node.exportClause.elements.length === 0 ||
    node.exportClause.elements.some((element) => !element.isTypeOnly)
  );
}

function collectRuntimeModuleSpecifiers(sourceFile: ts.SourceFile) {
  const specifiers = new Set<string>();

  function addStringLiteral(node: ts.Node | undefined) {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.add(node.text);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && isRuntimeImportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isRuntimeExportDeclaration(node)
    ) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequireCall) {
        addStringLiteral(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...specifiers];
}

function loadCompilerOptions(rootDirectory: string) {
  const configPath = ts.findConfigFile(
    rootDirectory,
    ts.sys.fileExists,
    "tsconfig.json"
  );
  if (!configPath) {
    throw new Error(`Unable to find tsconfig.json below ${rootDirectory}`);
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      ts.formatDiagnostic(configFile.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => rootDirectory,
        getNewLine: () => "\n",
      })
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      ts.formatDiagnostics(parsed.errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => rootDirectory,
        getNewLine: () => "\n",
      })
    );
  }
  return parsed.options;
}

function listSourceModules(
  rootDirectory: string,
  config: ArchitectureBudgetConfig
) {
  const sourceDirectory = path.resolve(rootDirectory, config.sourceDirectory);
  if (!fs.existsSync(sourceDirectory)) {
    throw new Error(`Architecture source directory does not exist: ${sourceDirectory}`);
  }

  const excludedPaths = new Set(config.excludedModulePaths.map(normalizePath));
  const modules = new Map<string, string>();

  function visitDirectory(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(absolutePath);
        continue;
      }
      if (!entry.isFile() || !TYPESCRIPT_MODULE_PATTERN.test(entry.name)) {
        continue;
      }

      const relativePath = normalizePath(path.relative(rootDirectory, absolutePath));
      if (
        relativePath.endsWith(".d.ts") ||
        TEST_MODULE_PATTERN.test(relativePath) ||
        excludedPaths.has(relativePath)
      ) {
        continue;
      }
      modules.set(path.resolve(absolutePath), relativePath);
    }
  }

  visitDirectory(sourceDirectory);
  return modules;
}

function findStronglyConnectedComponents(
  graph: ReadonlyMap<string, readonly string[]>
) {
  let nextIndex = 0;
  const indexByModule = new Map<string, number>();
  const lowLinkByModule = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function connect(modulePath: string) {
    const moduleIndex = nextIndex;
    nextIndex += 1;
    indexByModule.set(modulePath, moduleIndex);
    lowLinkByModule.set(modulePath, moduleIndex);
    stack.push(modulePath);
    onStack.add(modulePath);

    for (const dependency of graph.get(modulePath) ?? []) {
      if (!indexByModule.has(dependency)) {
        connect(dependency);
        lowLinkByModule.set(
          modulePath,
          Math.min(
            lowLinkByModule.get(modulePath) ?? moduleIndex,
            lowLinkByModule.get(dependency) ?? moduleIndex
          )
        );
      } else if (onStack.has(dependency)) {
        lowLinkByModule.set(
          modulePath,
          Math.min(
            lowLinkByModule.get(modulePath) ?? moduleIndex,
            indexByModule.get(dependency) ?? moduleIndex
          )
        );
      }
    }

    if (lowLinkByModule.get(modulePath) !== moduleIndex) {
      return;
    }

    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) {
        throw new Error("Architecture graph stack became inconsistent");
      }
      onStack.delete(member);
      component.push(member);
    } while (member !== modulePath);
    components.push(component.sort());
  }

  for (const modulePath of [...graph.keys()].sort()) {
    if (!indexByModule.has(modulePath)) {
      connect(modulePath);
    }
  }

  return components;
}

function assertPositiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function assertRelativeModulePath(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    normalizePath(value).split("/").includes("..")
  ) {
    throw new Error(`${label} must be a repository-relative module path`);
  }
  return normalizePath(value);
}

export function parseArchitectureBudgetConfig(
  value: unknown
): ArchitectureBudgetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture budget config must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Architecture budget config version must be 1");
  }
  const sourceDirectory = assertRelativeModulePath(
    raw.sourceDirectory,
    "sourceDirectory"
  );
  const maxNewModuleNonEmptyLines = assertPositiveInteger(
    raw.maxNewModuleNonEmptyLines,
    "maxNewModuleNonEmptyLines"
  );

  if (!Array.isArray(raw.excludedModulePaths)) {
    throw new Error("excludedModulePaths must be an array");
  }
  const excludedModulePaths = raw.excludedModulePaths.map((modulePath, index) =>
    assertRelativeModulePath(modulePath, `excludedModulePaths[${index}]`)
  );

  if (!Array.isArray(raw.allowedCycles)) {
    throw new Error("allowedCycles must be an array");
  }
  const allowedCycles = raw.allowedCycles.map((cycle, cycleIndex) => {
    if (!Array.isArray(cycle) || cycle.length === 0) {
      throw new Error(`allowedCycles[${cycleIndex}] must be a non-empty array`);
    }
    const modules = cycle.map((modulePath, moduleIndex) =>
      assertRelativeModulePath(
        modulePath,
        `allowedCycles[${cycleIndex}][${moduleIndex}]`
      )
    );
    if (new Set(modules).size !== modules.length) {
      throw new Error(`allowedCycles[${cycleIndex}] contains duplicate modules`);
    }
    return modules.sort();
  });

  if (
    !raw.hotspotNonEmptyLineBudgets ||
    typeof raw.hotspotNonEmptyLineBudgets !== "object" ||
    Array.isArray(raw.hotspotNonEmptyLineBudgets)
  ) {
    throw new Error("hotspotNonEmptyLineBudgets must be an object");
  }
  const hotspotNonEmptyLineBudgets = Object.fromEntries(
    Object.entries(raw.hotspotNonEmptyLineBudgets as Record<string, unknown>).map(
      ([modulePath, budget]) => [
        assertRelativeModulePath(modulePath, "hotspot module path"),
        assertPositiveInteger(budget, `hotspot budget for ${modulePath}`),
      ]
    )
  );

  return {
    version: 1,
    sourceDirectory,
    excludedModulePaths,
    allowedCycles,
    hotspotNonEmptyLineBudgets,
    maxNewModuleNonEmptyLines,
  };
}

export function loadArchitectureBudgetConfig(configPath: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read architecture budget config: ${details}`);
  }
  return parseArchitectureBudgetConfig(parsed);
}

export function analyzeArchitecture({
  config,
  rootDirectory,
}: AnalyzeArchitectureOptions): ArchitectureAnalysis {
  const compilerOptions = loadCompilerOptions(rootDirectory);
  const modulePaths = listSourceModules(rootDirectory, config);
  const sourceByRelativePath = new Map(
    [...modulePaths.entries()].map(([absolutePath, relativePath]) => [
      relativePath,
      fs.readFileSync(absolutePath, "utf8"),
    ])
  );
  const graph = new Map<string, string[]>();

  for (const [absolutePath, relativePath] of [...modulePaths.entries()].sort(
    ([, left], [, right]) => left.localeCompare(right)
  )) {
    const source = sourceByRelativePath.get(relativePath);
    if (source === undefined) {
      throw new Error(`Architecture source disappeared during scan: ${relativePath}`);
    }
    const scriptKind = relativePath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      absolutePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );
    const dependencies = new Set<string>();
    for (const specifier of collectRuntimeModuleSpecifiers(sourceFile)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        continue;
      }
      if (!isCodeLikeModuleSpecifier(specifier)) {
        continue;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        absolutePath,
        compilerOptions,
        ts.sys
      ).resolvedModule;
      if (!resolved) {
        throw new Error(
          `Unable to resolve local runtime import ${specifier} from ${relativePath}`
        );
      }
      const dependency = modulePaths.get(path.resolve(resolved.resolvedFileName));
      if (dependency) {
        dependencies.add(dependency);
      }
    }
    graph.set(relativePath, [...dependencies].sort());
  }

  const components = findStronglyConnectedComponents(graph);
  const cycles = components
    .filter((component) => {
      if (component.length > 1) {
        return true;
      }
      const [modulePath] = component;
      return graph.get(modulePath)?.includes(modulePath) ?? false;
    })
    .sort((left, right) => canonicalCycle(left).localeCompare(canonicalCycle(right)));

  return {
    modules: [...graph.entries()].map(([modulePath, dependencies]) => ({
      path: modulePath,
      nonEmptyLines: countNonEmptyLines(sourceByRelativePath.get(modulePath) ?? ""),
      runtimeDependencies: dependencies,
    })),
    cycles,
  };
}

export function validateArchitectureBudgets(
  analysis: ArchitectureAnalysis,
  config: ArchitectureBudgetConfig
): ArchitectureBudgetResult {
  const errors: string[] = [];
  const allowedCycles = new Set(config.allowedCycles.map(canonicalCycle));
  const hotspotPaths = new Set(
    Object.keys(config.hotspotNonEmptyLineBudgets).map(normalizePath)
  );
  for (const cycle of analysis.cycles) {
    if (!allowedCycles.has(canonicalCycle(cycle))) {
      errors.push(
        `new or expanded runtime dependency cycle: ${cycle.join(" <-> ")}`
      );
    }
  }

  for (const moduleMetric of analysis.modules) {
    const hotspotBudget =
      config.hotspotNonEmptyLineBudgets[moduleMetric.path];
    if (
      hotspotBudget !== undefined &&
      moduleMetric.nonEmptyLines > hotspotBudget
    ) {
      errors.push(
        `hotspot grew beyond its non-empty LOC budget: ${moduleMetric.path} ` +
          `(${moduleMetric.nonEmptyLines} > ${hotspotBudget})`
      );
    }
    if (
      !hotspotPaths.has(moduleMetric.path) &&
      moduleMetric.nonEmptyLines > config.maxNewModuleNonEmptyLines
    ) {
      errors.push(
        `module exceeds the new-module non-empty LOC ceiling: ` +
          `${moduleMetric.path} (${moduleMetric.nonEmptyLines} > ` +
          `${config.maxNewModuleNonEmptyLines})`
      );
    }
  }

  return { analysis, errors };
}

export function runArchitectureBudgetCheck(input?: {
  configPath?: string;
  rootDirectory?: string;
}) {
  const rootDirectory = path.resolve(input?.rootDirectory ?? process.cwd());
  const configPath = path.resolve(
    rootDirectory,
    input?.configPath ?? "config/architecture-budgets.json"
  );
  const config = loadArchitectureBudgetConfig(configPath);
  const analysis = analyzeArchitecture({ config, rootDirectory });
  const result = validateArchitectureBudgets(analysis, config);
  if (result.errors.length > 0) {
    throw new Error(
      `Architecture budget violations:\n${result.errors
        .map((error) => `- ${error}`)
        .join("\n")}`
    );
  }
  return result;
}
