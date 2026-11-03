import { CHATGPT_REASONING_EFFORTS, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

// Command line of `npm run takeoff:bench` (TI-660). Every flag is given once,
// as `--flag value` or `--flag=value`; lists are comma-separated, without empty
// or repeated items. `--efforts auto` is the model's automatic effort (null).

export const BENCH_USAGE = "Usage: npm run takeoff:bench -- --dataset <dir> --docs <ids|all> --models <model,...> "
  + `--efforts <auto|${CHATGPT_REASONING_EFFORTS.join("|")},...> [--repeat <n>] --out <run_path>`;

export class BenchUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchUsageError";
  }
}

export type BenchEffort = ChatGptReasoningEffort | null;

export type BenchArgs = {
  dataset: string;
  docs: "all" | string[];
  models: string[];
  efforts: BenchEffort[];
  repeat: number;
  out: string;
};

const FLAGS = ["dataset", "docs", "models", "efforts", "repeat", "out"] as const;
type Flag = (typeof FLAGS)[number];

function list(flag: Flag, value: string) {
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => item.length === 0)) throw new BenchUsageError(`--${flag} has an empty item.`);
  if (new Set(items).size !== items.length) throw new BenchUsageError(`--${flag} lists an item twice.`);
  return items;
}

function effort(value: string): BenchEffort {
  if (value === "auto") return null;
  const known = CHATGPT_REASONING_EFFORTS.find((candidate) => candidate === value);
  if (!known) throw new BenchUsageError(`Unknown effort ${value} (auto, ${CHATGPT_REASONING_EFFORTS.join(", ")}).`);
  return known;
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  const values = new Map<Flag, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg.slice(2), undefined];
    const flag = FLAGS.find((candidate) => candidate === name);
    if (!arg.startsWith("--") || !flag) throw new BenchUsageError(`Unknown argument: ${arg}`);
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.length === 0 || value.startsWith("--")) throw new BenchUsageError(`--${flag} needs a value.`);
    if (values.has(flag)) throw new BenchUsageError(`--${flag} is given once.`);
    values.set(flag, value);
  }
  const required = (flag: Flag) => {
    const value = values.get(flag);
    if (value === undefined) throw new BenchUsageError(`--${flag} is required.`);
    return value;
  };
  const docs = list("docs", required("docs"));
  if (docs.includes("all") && docs.length > 1) throw new BenchUsageError("--docs is all or a list of ids, not both.");
  const repeat = values.get("repeat") ?? "1";
  if (!/^[1-9]\d*$/.test(repeat)) throw new BenchUsageError("--repeat is a positive integer.");
  return {
    dataset: required("dataset"),
    docs: docs[0] === "all" ? "all" : docs,
    models: list("models", required("models")),
    efforts: list("efforts", required("efforts")).map(effort),
    repeat: Number(repeat),
    out: required("out"),
  };
}

/** Every model with every effort, in the order given; the bench runs them one couple at a time. */
export function benchCouples(models: readonly string[], efforts: readonly BenchEffort[]) {
  return models.flatMap((model) => efforts.map((reasoningEffort) => ({ model, reasoningEffort })));
}

/** TAKEOFF_BENCH_CHATGPT_OWNER: `<userId>:<tenantId>` of the local ChatGPT profile. */
export function parseBenchOwner(value: string | undefined): ChatGptOwner {
  const parts = (value ?? "").split(":");
  if (parts.length !== 2 || parts.some((part) => part.trim().length === 0)) {
    throw new BenchUsageError("TAKEOFF_BENCH_CHATGPT_OWNER is <userId>:<tenantId>.");
  }
  return { userId: parts[0].trim(), tenantId: parts[1].trim() };
}
