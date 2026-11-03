import { CHATGPT_REASONING_EFFORTS, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

// Command line of `npm run takeoff:bench` (TI-660). Every flag is given once,
// as `--flag value` or `--flag=value`; lists are comma-separated, without empty
// or repeated items. `--efforts auto` is the model's automatic effort (null).
// `--mode triage` (TI-663) asks Decisions for the type, level and zone of every
// page instead of the level C reading: one pass per page and prompt version,
// always under `--max-decisions-tokens`. An extraction may read only some pages:
// `--pages 1,3-5` for every document, or `--pages-from <triage report.json>` for
// the pages each document keeps after the triage.

export const BENCH_USAGE = "Usage: npm run takeoff:bench -- --dataset <dir> --docs <ids|all> --models <model,...> "
  + `--efforts <auto|${CHATGPT_REASONING_EFFORTS.join("|")},...> [--repeat <n>] [--pages <list> | --pages-from <report.json>] --out <run_path>\n`
  + "       npm run takeoff:bench -- --mode triage --dataset <dir> --docs <ids|all> --max-decisions-tokens <n> --out <run_path>";

export class BenchUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchUsageError";
  }
}

export type BenchEffort = ChatGptReasoningEffort | null;

export type BenchArgs = {
  mode: "extract" | "triage";
  dataset: string;
  docs: "all" | string[];
  models: string[];
  efforts: BenchEffort[];
  repeat: number;
  out: string;
  /** Decisions token ceiling of a triage run (required there, refused elsewhere). */
  maxDecisionsTokens: number | null;
  /** Original page numbers read in every document (extraction only). */
  pages: number[] | null;
  /** Triage report whose kept pages are read (extraction only). */
  pagesFrom: string | null;
};

const FLAGS = ["mode", "dataset", "docs", "models", "efforts", "repeat", "out", "max-decisions-tokens", "pages", "pages-from"] as const;
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

/** `1,3-5` → [1, 3, 4, 5]: positive pages, increasing ranges, no page twice. */
export function parsePageList(value: string): number[] {
  const pages: number[] = [];
  for (const item of list("pages", value)) {
    const match = /^([1-9]\d{0,3})(?:-([1-9]\d{0,3}))?$/.exec(item);
    if (!match) throw new BenchUsageError(`--pages: ${item} is not a page or a range like 3-5.`);
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (to < from) throw new BenchUsageError(`--pages: the range ${item} goes backwards.`);
    for (let page = from; page <= to; page += 1) pages.push(page);
  }
  if (new Set(pages).size !== pages.length) throw new BenchUsageError("--pages lists a page twice.");
  return pages.sort((left, right) => left - right);
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
  const mode = values.get("mode") ?? "extract";
  if (mode !== "extract" && mode !== "triage") throw new BenchUsageError("--mode is extract or triage.");
  const docs = list("docs", required("docs"));
  if (docs.includes("all") && docs.length > 1) throw new BenchUsageError("--docs is all or a list of ids, not both.");
  const common = { dataset: required("dataset"), docs: docs[0] === "all" ? "all" as const : docs, out: required("out") };
  if (mode === "triage") {
    for (const flag of ["models", "efforts", "repeat", "pages", "pages-from"] as const) {
      if (values.has(flag)) throw new BenchUsageError(`--${flag} does not apply to a triage run (one Decisions pass per page and prompt version).`);
    }
    const ceiling = values.get("max-decisions-tokens");
    if (ceiling === undefined) throw new BenchUsageError("--max-decisions-tokens is required for a triage run.");
    if (!/^[1-9]\d{0,9}$/.test(ceiling)) throw new BenchUsageError("--max-decisions-tokens is a positive integer.");
    return { mode, ...common, models: [], efforts: [], repeat: 1, maxDecisionsTokens: Number(ceiling), pages: null, pagesFrom: null };
  }
  if (values.has("max-decisions-tokens")) throw new BenchUsageError("--max-decisions-tokens applies to a triage run only.");
  if (values.has("pages") && values.has("pages-from")) throw new BenchUsageError("--pages and --pages-from are exclusive.");
  const repeat = values.get("repeat") ?? "1";
  if (!/^[1-9]\d*$/.test(repeat)) throw new BenchUsageError("--repeat is a positive integer.");
  const pages = values.get("pages");
  return {
    mode,
    ...common,
    models: list("models", required("models")),
    efforts: list("efforts", required("efforts")).map(effort),
    repeat: Number(repeat),
    maxDecisionsTokens: null,
    pages: pages === undefined ? null : parsePageList(pages),
    pagesFrom: values.get("pages-from") ?? null,
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
