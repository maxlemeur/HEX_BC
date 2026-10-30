import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootFromModule = fileURLToPath(new URL("../../", import.meta.url));
const sections = ["dependencies", "devDependencies", "optionalDependencies"];
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

function json(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read dependency metadata at ${file}: ${error.message}`);
  }
}

function supportedNode(range) {
  const current = process.versions.node.split(".").map(Number);
  const alternatives = String(range ?? "").split("||").map((value) => value.trim());
  const minimums = alternatives.map((alternative) => {
    const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(alternative);
    if (!match) throw new Error(`Unsupported Node engines range ${JSON.stringify(range)}; update the dependency preflight.`);
    return match.slice(1).map(Number);
  });
  return minimums.some(([major, minor, patch]) => current[0] === major &&
    (current[1] > minor || (current[1] === minor && current[2] >= patch)));
}

/** Fail before tests start if their installed package versions differ from the lock. */
export function assertInstalledDependencies(root = rootFromModule) {
  const project = realpathSync(path.resolve(root));
  const manifest = json(path.join(project, "package.json"));
  const lock = json(path.join(project, "package-lock.json"));
  if (!lock.packages?.[""] || !Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2) {
    throw new Error("package-lock.json must contain the installed package graph (lockfile version 2 or newer).");
  }
  if (!supportedNode(manifest.engines?.node)) {
    throw new Error(`Node ${process.version} does not satisfy ${manifest.engines?.node}; use a supported Node version before testing.`);
  }

  const problems = [];
  for (const section of sections) {
    const declared = manifest[section] ?? {};
    const locked = lock.packages[""][section] ?? {};
    for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
      if (declared[name] !== locked[name]) problems.push(`${section} ${name}: package.json and package-lock.json differ`);
      if (name in declared && !lock.packages[`node_modules/${name}`]) problems.push(`Missing locked package: ${name}`);
    }
  }

  let checkedPackages = 0;
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location.startsWith("node_modules/")) continue;
    if (location.split("/").includes("..")) {
      problems.push(`Invalid package-lock location: ${location}`);
      continue;
    }
    const expected = entry.version ?? (entry.link ? lock.packages[entry.resolved]?.version : undefined);
    if (!expected) {
      problems.push(`Missing locked version: ${location}`);
      continue;
    }
    const file = path.join(project, location, "package.json");
    if (!existsSync(file)) {
      if (!entry.optional) problems.push(`Missing installed package: ${location} (expected ${expected})`);
      continue;
    }
    let installed;
    try {
      installed = json(file).version;
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    checkedPackages += 1;
    if (installed !== expected) problems.push(`${location}: installed ${installed ?? "unknown"}, expected ${expected}`);
  }

  // An unlocked nested package can shadow a correct root package when Node
  // resolves an import from its parent. Check the installed tree as well as the
  // lock, including nested node_modules, before claiming the versions used.
  const visited = new Set();
  function inspectModules(directory) {
    if (!existsSync(directory)) return;
    const resolved = realpathSync(directory);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    function inspectPackage(directoryPath) {
      const location = relative(project, directoryPath);
      if (!lock.packages[location]) problems.push(`Unlocked installed package: ${location}`);
      inspectModules(path.join(directoryPath, "node_modules"));
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(directory, entry.name);
      if (entry.name.startsWith("@") && (entry.isDirectory() || entry.isSymbolicLink())) {
        for (const scoped of readdirSync(file, { withFileTypes: true })) {
          if (!scoped.name.startsWith(".")) inspectPackage(path.join(file, scoped.name));
        }
      } else {
        inspectPackage(file);
      }
    }
  }
  inspectModules(path.join(project, "node_modules"));

  // The project has one root installation. A node_modules in a source tree
  // takes precedence for imports from that tree and is not covered by the
  // root lockfile. Generated evidence/build directories are outside these roots.
  const inspectedSourceDirectories = new Set();
  function inspectSourceDirectory(directory) {
    if (!existsSync(directory)) return;
    const resolved = realpathSync(directory);
    const location = path.relative(project, resolved);
    if (location === ".." || location.startsWith(`..${path.sep}`) || path.isAbsolute(location)) {
      problems.push(`Source directory link outside the checkout: ${relative(project, directory)}`);
      return;
    }
    if (inspectedSourceDirectories.has(resolved)) return;
    inspectedSourceDirectories.add(resolved);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      let linkedDirectory = false;
      if (entry.isSymbolicLink()) {
        try { linkedDirectory = statSync(file).isDirectory(); }
        catch (error) { if (error.code === "ENOENT") continue; throw error; }
      }
      if (entry.name === "node_modules" && (entry.isDirectory() || linkedDirectory)) {
        problems.push(`Nested source installation: ${relative(project, file)}`);
      } else if (entry.isDirectory() && entry.name !== ".git") {
        inspectSourceDirectory(file);
      } else if (linkedDirectory) {
        inspectSourceDirectory(file);
      }
    }
  }
  for (const directory of ["src", "e2e", "scripts", "tools", "config", "supabase"]) {
    inspectSourceDirectory(path.join(project, directory));
  }

  if (problems.length) {
    const detail = problems.slice(0, 12).join("; ");
    const remaining = problems.length > 12 ? `; and ${problems.length - 12} more` : "";
    throw new Error(`Installed dependencies do not match package-lock.json: ${detail}${remaining}. Run npm ci with a supported Node version in an isolated checkout.`);
  }

  function record(file) {
    const location = relative(project, file);
    const version = json(file).version;
    const packageDirectory = relative(project, path.dirname(file));
    if (!lock.packages[packageDirectory] || lock.packages[packageDirectory].version !== version) {
      throw new Error(`The resolved package ${packageDirectory} is not the version in package-lock.json.`);
    }
    return { version, path: location };
  }

  const webPackage = path.join(project, "node_modules/@e2e-dev/web/package.json");
  const webRequire = createRequire(webPackage);
  const browserDriver = webRequire.resolve("playwright-core/package.json");
  const packages = {
    "e2e": record(path.join(project, "node_modules/e2e/package.json")),
    "@e2e-dev/web": record(webPackage),
    "playwright": record(path.join(project, "node_modules/playwright/package.json")),
    "playwright-core": record(browserDriver),
  };
  for (const name of ["next", "react", "react-dom"]) {
    const file = path.join(project, "node_modules", name, "package.json");
    if (existsSync(file)) packages[name] = record(file);
  }
  return { node: process.version, checkedPackages, packages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(assertInstalledDependencies()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
