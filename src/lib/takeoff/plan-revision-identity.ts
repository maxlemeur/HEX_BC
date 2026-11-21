import { z } from "zod";

export const planIdentitySchema = z.object({
  number: z.string().nullable(), building: z.string().nullable(), level: z.string().nullable(),
  discipline: z.string().nullable(), revision: z.string().nullable(),
}).strict();

const fingerprintSchema = z.object({ document_id: z.string().min(1), content_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const planRevisionDecisionSchema = z.object({
  left: fingerprintSchema, right: fingerprintSchema, choice: z.enum(["left", "right", "distinct"]),
}).strict();

type PlanIdentity = z.infer<typeof planIdentitySchema>;
export type PlanRevisionDecision = z.infer<typeof planRevisionDecisionSchema>;

type PlanIdentitySource = {
  document_id: string; document_name: string; logical_document_id: string | null;
  content_hash: string | null; plan_identity?: PlanIdentity | null;
  declared_logical_document_id?: string | null;
  inferred_logical_reference?: boolean;
  plan_set_id?: string | null;
};

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

const dateSuffix = /(?:^|[\s_-])(?:\d{4}[._-]\d{2}[._-]\d{2}|\d{2}[._-]\d{2}[._-]\d{4}|20\d{6})$/;
// A drawing number followed by a single index letter (« P-101_A », « P101 B »): enough to ask the member.
const drawingIndexSuffix = /^([a-z]+(?:[\s._-]?\d+)+)[\s_-]([a-z])$/;
const revisionSuffix = /(?:^|[\s_-])(?:indice|revision|rev|ind)[\s._-]*([a-z]\d{0,2}|\d{1,3})$/;

function filenameIdentity(name: string) {
  let stem = normalized(name).replace(/\.pdf$/, "");
  let revision: string | null = null;
  for (;;) {
    const next = stem.replace(dateSuffix, "").replace(revisionSuffix, (_, index: string) => {
      revision ??= index.toUpperCase();
      return "";
    }).replace(/[\s_-]+$/, "");
    if (next === stem) {
      const drawing = stem.match(drawingIndexSuffix);
      return { name: (drawing?.[1] ?? stem).replace(/[^a-z0-9]+/g, " ").trim(), revision };
    }
    stem = next;
  }
}

export function readPlanFilenameRevision(name: string) {
  return filenameIdentity(name).revision;
}

export function inferPlanLogicalReference(source: PlanIdentitySource, confirmedSamePlan = false) {
  const identity = source.plan_identity;
  if (identity?.number && (identity.building || identity.level || identity.discipline)) {
    // Each part is named: a building « 1 » and a level « 1 » are two plans (values hold neither « : » nor « = »).
    return ["plan", identity.number, ...(["building", "level", "discipline"] as const).flatMap((part) =>
      identity[part] ? [`${({ building: "batiment", level: "niveau", discipline: "discipline" })[part]}=${identity[part]}`] : [])].join(":");
  }
  if (!confirmedSamePlan) return null;
  const name = identity?.number ?? filenameIdentity(source.document_name).name;
  return name ? `version:${source.plan_set_id ?? source.document_id}:${name}` : null;
}

export function readPlanTitleBlock(text: string): PlanIdentity | null {
  const labels = {
    number: "(?:n[°o]\\s*(?:de\\s+)?plan|numero\\s+(?:de\\s+)?plan|reference\\s+(?:du\\s+)?plan|plan\\s+n[°o])",
    building: "(?:batiment|bat[.])", level: "(?:niveau|etage)",
    discipline: "(?:discipline|corps d.etat)", revision: "(?:indice|revision|rev[.]?)",
  };
  const input = normalized(text);
  const read = (label: keyof typeof labels) => {
    const value = label === "revision" ? "[a-z]\\d{0,2}|\\d{1,3}" : "[a-z0-9][a-z0-9+._/-]{0,39}";
    const match = new RegExp(`(?:^|\\s)${labels[label]}(?:\\s*[:=]\\s*|[ \\t]+)(${value})(?=\\s|$)`, "g");
    const values = new Set(Array.from(input.matchAll(match), (entry) => entry[1]));
    return values.size === 1 ? [...values][0] : null;
  };
  const identity = { number: read("number"), building: read("building"), level: read("level"), discipline: read("discipline"), revision: read("revision")?.toUpperCase() ?? null };
  return Object.values(identity).some(Boolean) ? identity : null;
}

export function getDeclaredPlanReference(source: PlanIdentitySource) {
  return source.declared_logical_document_id === undefined
    ? (source.inferred_logical_reference ? null : source.logical_document_id)
    : source.declared_logical_document_id;
}

function samePlan(left: PlanIdentitySource, right: PlanIdentitySource) {
  const leftReference = getDeclaredPlanReference(left);
  const rightReference = getDeclaredPlanReference(right);
  if (leftReference && rightReference) {
    return normalized(leftReference) === normalized(rightReference);
  }
  const a = left.plan_identity;
  const b = right.plan_identity;
  if (a && b) {
    if ((["building", "level", "discipline", "number"] as const).some((key) => a[key] && b[key] && a[key] !== b[key])) return false;
    if (a.number && b.number) return true;
  }
  const name = filenameIdentity(left.document_name).name;
  return name !== "" && name === filenameIdentity(right.document_name).name;
}

function matches(source: PlanIdentitySource, fingerprint: PlanRevisionDecision["left"]) {
  return source.document_id === fingerprint.document_id && source.content_hash === fingerprint.content_hash;
}

export function validPlanRevisionDecisions(sources: readonly PlanIdentitySource[], decisions: readonly PlanRevisionDecision[]) {
  const byId = new Map(sources.map((source) => [source.document_id, source]));
  return decisions.filter(({ left, right }) => {
    const a = byId.get(left.document_id);
    const b = byId.get(right.document_id);
    return a && b && a !== b && matches(a, left) && matches(b, right) && samePlan(a, b);
  });
}

export function hasCyclicPlanRevisionDecisions(sources: readonly PlanIdentitySource[], choices: readonly PlanRevisionDecision[]) {
  const retainedBy = new Map<string, string[]>();
  for (const { left, right, choice } of validPlanRevisionDecisions(sources, choices)) {
    if (choice === "distinct") continue;
    const [retained, discarded] = choice === "left" ? [left, right] : [right, left];
    const successors = retainedBy.get(discarded.document_id) ?? [];
    successors.push(retained.document_id);
    retainedBy.set(discarded.document_id, successors);
  }
  const visiting = new Set<string>();
  const checked = new Set<string>();
  const visitsCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (checked.has(id)) return false;
    visiting.add(id);
    if (retainedBy.get(id)?.some(visitsCycle)) return true;
    visiting.delete(id);
    checked.add(id);
    return false;
  };
  return [...retainedBy.keys()].some(visitsCycle);
}

export function findPlanRevisionConflicts<T extends PlanIdentitySource>(sources: readonly T[], choices: readonly PlanRevisionDecision[]) {
  const decisions = validPlanRevisionDecisions(sources, choices);
  const retained = sources.filter((source) => !decisions.some((decision) =>
    (decision.choice === "left" && matches(source, decision.right)) || (decision.choice === "right" && matches(source, decision.left))));
  const conflicts: [T, T][] = [];
  for (const [index, left] of retained.entries()) {
    for (const right of retained.slice(index + 1)) {
      if (!left.content_hash || !right.content_hash || left.content_hash === right.content_hash || !samePlan(left, right)) continue;
      if (decisions.some((decision) => (matches(left, decision.left) && matches(right, decision.right)) || (matches(right, decision.left) && matches(left, decision.right)))) continue;
      conflicts.push([left, right]);
    }
  }
  return conflicts;
}
