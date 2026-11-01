import { statSync } from "node:fs";

import { checkTakeoffBenchDataset, formatBenchIssue } from "../src/lib/takeoff/bench/check";

// `npm run takeoff:bench:check -- --dataset <dir>`: read-only check of the private
// takeoff bench dataset (TI-659). Exit 0 when it passes, 1 on dataset errors,
// 2 on a usage error, 3 when the check itself crashes (a bug, not a dataset error).

const USAGE = "Usage: npm run takeoff:bench:check -- --dataset <dataset directory>";

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function parseDataset(args: readonly string[]) {
  let dataset: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    let value: string | undefined;
    if (arg === "--dataset") {
      value = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--dataset=")) {
      value = arg.slice("--dataset=".length);
    } else {
      usageError(`Unknown argument: ${arg}`);
    }
    if (!value || value.startsWith("--")) usageError("--dataset needs a directory.");
    if (dataset !== null) usageError("--dataset is given once.");
    dataset = value;
  }
  if (dataset === null) usageError("--dataset is required.");
  try {
    if (!statSync(dataset).isDirectory()) usageError(`${dataset} is not a directory.`);
  } catch {
    usageError(`${dataset} is not a directory.`);
  }
  return dataset;
}

async function main() {
  const result = await checkTakeoffBenchDataset(parseDataset(process.argv.slice(2)));
  const { summary } = result;
  if (!result.ok) {
    for (const issue of result.errors) console.error(formatBenchIssue(issue));
    const count = result.errors.length;
    console.error(`Takeoff bench dataset failed: ${count} ${count === 1 ? "error" : "errors"}.`);
    process.exitCode = 1;
    return;
  }
  const lots = Object.entries(summary.lots)
    .map(([lot, { lines, observable }]) => `${lot.toUpperCase()} ${observable}/${lines} observable`)
    .join(", ");
  const withoutBinary = summary.truthWithoutBinary;
  console.log(
    `Takeoff bench dataset passed: ${summary.documents} documents (${summary.verifiedBinaries} binaries verified), `
    + `${summary.truthFiles} truth files, ${summary.truthLines} lines${lots ? ` (${lots})` : ""}, `
    + `noise ${summary.noise}, ${summary.pageFiles} page files, ${summary.groupFiles} group files`
    + (withoutBinary.length > 0
      ? `, ${withoutBinary.length} truth plan${withoutBinary.length === 1 ? "" : "s"} without binary `
        + `(${withoutBinary.join(", ")}), skipped by the bench`
      : "")
    + "."
  );
}

void main().catch((error: unknown) => {
  console.error(`takeoff:bench:check crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 3;
});
