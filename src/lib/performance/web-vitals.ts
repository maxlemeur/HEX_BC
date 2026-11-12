const UUID_SEGMENT_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export const DEFAULT_WEB_VITALS_SAMPLE_RATE = 0.1;

/**
 * Name of the record carrying INP attribution. The plain INP stays the measure of record:
 * the attribution build loads later and cannot recover interactions under the 104 ms
 * event buffer that happened before it subscribed, so its value can be lower.
 */
export const INP_ATTRIBUTION_METRIC_NAME = "INP-attribution";

export type WebVitalRating = "good" | "needs-improvement" | "poor";

const SCRIPT_INVOKER_TYPES = [
  "user-callback",
  "event-listener",
  "resolve-promise",
  "reject-promise",
  "classic-script",
  "module-script",
] as const;
const INP_SUBPARTS = ["input-delay", "processing-duration", "presentation-delay"] as const;
const INTERACTION_TYPES = ["pointer", "keyboard"] as const;

const MAX_TARGET_LENGTH = 160;
const MAX_TARGET_ELEMENTS = 4;
const MAX_TARGET_CLASSES = 2;
const MAX_TARGET_TAG_LENGTH = 20;
const MAX_SCRIPT_PATH_LENGTH = 200;
const MAX_FUNCTION_NAME_LENGTH = 80;

export type ScriptInvokerType = (typeof SCRIPT_INVOKER_TYPES)[number];
export type InpSubpart = (typeof INP_SUBPARTS)[number];

/** Structural subset of `PerformanceScriptTiming` read from the longest INP script. */
export type InpScriptTimingInput = {
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  forcedStyleAndLayoutDuration?: number;
  forcedStyleDuration?: number;
  forcedLayoutDuration?: number;
};

/** Structural subset of web-vitals' `INPAttribution`, validated before it is sent. */
export type InpAttributionInput = {
  interactionType?: string;
  interactionTarget?: string;
  inputDelay?: number;
  processingDuration?: number;
  presentationDelay?: number;
  totalStyleAndLayoutDuration?: number;
  longestScript?: {
    subpart?: string;
    intersectingDuration?: number;
    entry?: InpScriptTimingInput;
  };
  longAnimationFrameEntries?: ReadonlyArray<{
    styleDuration?: number;
    layoutDuration?: number;
  }>;
};

export type WebVitalMetricInput = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: WebVitalRating;
  navigationType: string;
  attribution?: InpAttributionInput;
};

export type InpLongestScriptPayload = {
  invokerType: ScriptInvokerType | null;
  /** `cross-origin` also covers non-http(s) scripts (extensions, data:, blob:). */
  sourceOrigin: "same-origin" | "cross-origin" | null;
  /** Path of a same-origin script; the scheme alone (`chrome-extension:`) for non-http(s); null for another origin. */
  sourceURL: string | null;
  sourceFunctionName: string | null;
  subpart: InpSubpart | null;
  intersectingDuration: number;
  forcedStyleAndLayoutDuration: number | null;
  forcedStyleDuration: number | null;
  forcedLayoutDuration: number | null;
};

/** Why the INP interaction was slow. Durations are whole milliseconds. */
export type InpAttributionPayload = {
  interactionType: (typeof INTERACTION_TYPES)[number] | null;
  /** Anonymized selector, see `sanitizeInteractionTarget`. */
  interactionTarget: string | null;
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  longestScript: InpLongestScriptPayload | null;
  longAnimationFrameCount: number;
  /** Rendering style/layout of the intersecting long animation frames; null when the browser does not split them. */
  styleDuration: number | null;
  layoutDuration: number | null;
  /** web-vitals' combined value: from each frame's style/layout start to its end (paint included), plus forced style/layout. */
  totalStyleAndLayoutDuration: number | null;
};

export type WebVitalPayload = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: WebVitalRating;
  navigationType: string;
  route: string;
  viewport: "mobile" | "desktop";
  buildId: string | null;
  /** Present on the `INP-attribution` record only, never on the plain INP. */
  inp?: InpAttributionPayload;
};

export function parseWebVitalsSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function shouldSampleWebVitals(
  sampleRate: number,
  randomValue = Math.random()
): boolean {
  return sampleRate > 0 && randomValue < Math.min(1, sampleRate);
}

export function normalizeWebVitalsRoute(pathname: string): string {
  const route = pathname.split("?", 1)[0]?.trim() || "/";
  return route.replace(UUID_SEGMENT_PATTERN, "[id]").slice(0, 240);
}

function isStableToken(token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(token) || /\d{3,}/.test(token)) {
    return false;
  }
  // Record ids, hashes and generated suffixes carry digits in long segments.
  return token.split(/[-_]+/).every((segment) => segment.length <= 3 || !/\d/.test(segment));
}

function formatTargetElement(tag: string, testId: string | null, classes: string[]): string {
  const testIdPart = testId ? `[data-testid=${testId}]` : "";
  const classPart = classes.slice(0, MAX_TARGET_CLASSES).map((name) => `.${name}`).join("");
  return `${tag}${testIdPart}${classPart}`;
}

const TEST_ID_MARKER = "\u0001";
const ATTRIBUTE_SELECTOR =
  /\[\s*([A-Za-z_-][A-Za-z0-9_-]*)\s*(?:[~|^$*]?=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z0-9_-]*)\s*[iIsS]?\s*)?\]/g;
// Left over after the passes below, these mean the selector was not understood: drop it all.
const UNPARSED_SELECTOR_SYNTAX = /[[\]\\"'(),]/;

function parseTargetElement(compound: string): string | null {
  const tagMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(compound);
  const rawTag = tagMatch?.[0].toLowerCase() ?? "";
  if (rawTag === "html" || rawTag === "body") return null;
  const tag = rawTag.length <= MAX_TARGET_TAG_LENGTH ? rawTag : "";
  let testId: string | null = null;
  const classes: string[] = [];
  for (const [, kind, token] of compound.matchAll(/([.#\u0001])([^.#\u0001]*)/g)) {
    if (!isStableToken(token)) continue;
    if (kind === ".") classes.push(token);
    else if (kind === TEST_ID_MARKER) testId ??= token;
  }
  const formatted = formatTargetElement(tag, testId, classes);
  return formatted || null;
}

/**
 * Reduces a CSS selector to an anonymized description of the interaction target.
 *
 * Kept: tag names, `data-testid` values and at most two classes per element, each a
 * stable token (letter first, `[A-Za-z0-9_-]`, at most 40 characters, no run of three
 * digits, no segment longer than three characters containing a digit). Dropped: ids,
 * every other attribute and its value, pseudo-classes and their arguments, `html`/`body`.
 * Combinators become `>`. Only the last four elements are kept, then the leading ones are
 * dropped until the selector fits in 160 characters. A selector the rule cannot read
 * exactly (escapes, unparsed attribute, unbalanced quote or parenthesis, selector list)
 * yields null rather than a partial reading. Text content never enters a selector.
 */
export function sanitizeInteractionTarget(selector: string | null | undefined): string | null {
  if (!selector) return null;
  if (selector.length > 2_000) return null;
  let simplified = selector.replace(
    ATTRIBUTE_SELECTOR,
    (_match, name: string, rawValue: string | undefined) => {
      if (name !== "data-testid" || !rawValue) return "";
      const value = /^["']/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
      return isStableToken(value) ? `${TEST_ID_MARKER}${value}` : "";
    }
  );
  // Pseudo-class arguments (`:not(.a)`, `:is(...)`), innermost first.
  for (let previous = ""; previous !== simplified; ) {
    previous = simplified;
    simplified = simplified.replace(/\([^()]*\)/g, "");
  }
  simplified = simplified.replace(/::?[A-Za-z-]+/g, "");
  if (UNPARSED_SELECTOR_SYNTAX.test(simplified)) return null;
  const elements = simplified
    .split(/[\s>+~]+/)
    .map(parseTargetElement)
    .filter((element): element is string => element !== null)
    .slice(-MAX_TARGET_ELEMENTS);
  while (elements.length > 1 && elements.join(">").length > MAX_TARGET_LENGTH) {
    elements.shift();
  }
  const result = elements.join(">").slice(0, MAX_TARGET_LENGTH);
  return result || null;
}

/** DOM subset used to describe an interaction target; `Element` satisfies it. */
export type InteractionTargetElement = {
  tagName: string;
  getAttribute(name: string): string | null;
  classList: Iterable<string>;
  parentElement: InteractionTargetElement | null;
};

/**
 * Describes an interaction target from the DOM, under the `sanitizeInteractionTarget`
 * rule: the element and up to three ancestors, stopping at the first one with a stable
 * `data-testid`. Never reads ids, other attributes or text.
 */
export function describeInteractionTarget(target: InteractionTargetElement): string | null {
  const elements: string[] = [];
  let node: InteractionTargetElement | null = target;
  while (node && elements.length < MAX_TARGET_ELEMENTS) {
    const tag = node.tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;
    const rawTestId = node.getAttribute("data-testid");
    const testId = rawTestId && isStableToken(rawTestId) ? rawTestId : null;
    elements.unshift(formatTargetElement(tag, testId, [...node.classList].filter(isStableToken)));
    if (testId) break;
    node = node.parentElement;
  }
  return sanitizeInteractionTarget(elements.join(">"));
}

function wholeMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function optionalWholeMs(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? wholeMs(value) : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

function sumOptional(values: Array<number | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? wholeMs(present.reduce((total, value) => total + value, 0)) : null;
}

function scriptSource(sourceURL: string | undefined, origin: string) {
  let url: URL;
  try {
    if (!sourceURL) throw new Error("No script URL");
    url = new URL(sourceURL);
  } catch {
    return { sourceOrigin: null, sourceURL: null } as const;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { sourceOrigin: "cross-origin", sourceURL: url.protocol.slice(0, 40) } as const;
  }
  if (url.origin !== origin) {
    // A third-party path can name an account or tenant; the origin kind is enough.
    return { sourceOrigin: "cross-origin", sourceURL: null } as const;
  }
  return {
    sourceOrigin: "same-origin",
    sourceURL: url.pathname.replace(UUID_SEGMENT_PATTERN, "[id]").slice(0, MAX_SCRIPT_PATH_LENGTH),
  } as const;
}

function buildLongestScript(
  longestScript: InpAttributionInput["longestScript"],
  origin: string
): InpLongestScriptPayload | null {
  const entry = longestScript?.entry;
  if (!longestScript || !entry) return null;
  return {
    invokerType: oneOf(SCRIPT_INVOKER_TYPES, entry.invokerType),
    ...scriptSource(entry.sourceURL, origin),
    sourceFunctionName:
      entry.sourceFunctionName?.replace(/[^A-Za-z0-9_$.-]/g, "").slice(0, MAX_FUNCTION_NAME_LENGTH) || null,
    subpart: oneOf(INP_SUBPARTS, longestScript.subpart),
    intersectingDuration: wholeMs(longestScript.intersectingDuration),
    forcedStyleAndLayoutDuration: optionalWholeMs(entry.forcedStyleAndLayoutDuration),
    forcedStyleDuration: optionalWholeMs(entry.forcedStyleDuration),
    forcedLayoutDuration: optionalWholeMs(entry.forcedLayoutDuration),
  };
}

export function buildInpAttribution(
  attribution: InpAttributionInput,
  origin: string
): InpAttributionPayload {
  const frames = attribution.longAnimationFrameEntries ?? [];
  return {
    interactionType: oneOf(INTERACTION_TYPES, attribution.interactionType),
    interactionTarget: sanitizeInteractionTarget(attribution.interactionTarget),
    inputDelay: wholeMs(attribution.inputDelay),
    processingDuration: wholeMs(attribution.processingDuration),
    presentationDelay: wholeMs(attribution.presentationDelay),
    longestScript: buildLongestScript(attribution.longestScript, origin),
    longAnimationFrameCount: frames.length,
    styleDuration: sumOptional(frames.map((frame) => frame.styleDuration)),
    layoutDuration: sumOptional(frames.map((frame) => frame.layoutDuration)),
    totalStyleAndLayoutDuration: optionalWholeMs(attribution.totalStyleAndLayoutDuration),
  };
}

export function buildWebVitalPayload(input: {
  metric: WebVitalMetricInput;
  pathname: string;
  viewportWidth: number;
  buildId?: string | null;
  /** Page origin, to tell same-origin scripts from third-party ones. */
  origin: string;
}): WebVitalPayload {
  const { metric } = input;
  const inp =
    metric.name === INP_ATTRIBUTION_METRIC_NAME && metric.attribution
      ? { inp: buildInpAttribution(metric.attribution, input.origin) }
      : {};
  return {
    id: metric.id.slice(0, 128),
    name: metric.name.slice(0, 40),
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigationType: metric.navigationType.slice(0, 40),
    route: normalizeWebVitalsRoute(input.pathname),
    viewport: input.viewportWidth < 768 ? "mobile" : "desktop",
    buildId: input.buildId?.trim().slice(0, 40) || null,
    ...inp,
  };
}
