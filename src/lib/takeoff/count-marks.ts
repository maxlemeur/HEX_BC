import { isTakeoffCountUnit } from "@/lib/takeoff/units";
import { asFiniteNumber, asRecord } from "@/lib/value-guards";

/**
 * The counted marks of an item on a page (lot 5, migration 20261122144104_takeoff_count_marks.sql): one physical object
 * on an original page of a plan's bytes, its source proposals, its attribution to the answer of an item of a sealed list
 * (lot 4's stored answers), and, per answer, a marks revision and a journal. The database is the one judge of a command
 * (public.edit_takeoff_count_marks, public.publish_takeoff_count_marks) and gives the server-side count
 * (private.takeoff_count_mark_summary). This module names their codes and gestures, reads their documents, and holds the
 * same derivation as a pure function, so that a screen can show the count a set of gestures would give before they are
 * saved; what is saved is always the database's.
 */

/** proposed: by a machine reading, undecided; to_attribute: a machine reading that could not tell the item; retained:
 * kept or added by a member; removed: by a member, with a reason; pending: a mark of a machine generation that came after
 * the answer's marks were changed, not attributed until a member retains it. */
export const TAKEOFF_COUNT_MARK_STATES = ["proposed", "to_attribute", "retained", "removed", "pending"] as const;
export type TakeoffCountMarkState = (typeof TAKEOFF_COUNT_MARK_STATES)[number];

/** The state of an answer's marks, or of one page of them (the database's rule, also in deriveTakeoffCountMarkSummary). */
export const TAKEOFF_COUNT_MARK_SUMMARY_STATES = ["none", "to_check", "to_verify_again", "verified", "no_mark_retained"] as const;
export type TakeoffCountMarkSummaryState = (typeof TAKEOFF_COUNT_MARK_SUMMARY_STATES)[number];

export const TAKEOFF_COUNT_MARK_SUMMARY_STATE_LABELS: Record<TakeoffCountMarkSummaryState, string> = {
  none: "Aucun repère",
  to_check: "Repères proposés à vérifier",
  to_verify_again: "À vérifier à nouveau",
  verified: "Comptage vérifié",
  no_mark_retained: "Aucun repère retenu",
};

/** The label of a summary: a verified scope of an item that is not counted in pieces locates objects, it counts none. */
export function takeoffCountMarkSummaryLabel(summary: Pick<TakeoffCountMarkSummary, "state" | "counted">) {
  return summary.state === "verified" && !summary.counted ? "Repères vérifiés, sans quantité"
    : TAKEOFF_COUNT_MARK_SUMMARY_STATE_LABELS[summary.state];
}

export const TAKEOFF_COUNT_MARK_STATE_LABELS: Record<TakeoffCountMarkState, string> = {
  proposed: "Repère proposé — à vérifier",
  to_attribute: "À attribuer",
  retained: "Retenu",
  removed: "Retiré",
  pending: "Nouvelle lecture à examiner",
};

export const TAKEOFF_COUNT_MARK_ORIGIN_LABELS = {
  machine: "Proposé par l'analyse",
  manual: "Ajouté à la main",
} as const satisfies Record<"machine" | "manual", string>;

/** The reasons a member gives to remove a mark (other asks for a note); reattributed is the database's own. */
export const TAKEOFF_COUNT_MARK_REMOVAL_REASONS = ["duplicate", "not_this_item", "legend_or_detail", "not_installed",
  "outside_scope", "other"] as const;
export type TakeoffCountMarkRemovalReason = (typeof TAKEOFF_COUNT_MARK_REMOVAL_REASONS)[number];

export const TAKEOFF_COUNT_MARK_REASON_LABELS: Record<TakeoffCountMarkRemovalReason | "reattributed" | "same_object", string> = {
  duplicate: "Doublon",
  not_this_item: "Pas ce poste",
  legend_or_detail: "Légende ou détail",
  not_installed: "Objet non posé",
  outside_scope: "Hors du périmètre",
  other: "Autre motif",
  reattributed: "Affecté à un autre poste",
  same_object: "Même objet qu'un repère retenu",
};

/** The gestures of an edit, as public.edit_takeoff_count_marks takes them (every verify after every other gesture). */
export type TakeoffCountMarkBox = readonly [number, number, number, number];
export type TakeoffCountPageGeometry = {
  version: 1;
  /** The visible box in PDF units [x0, y0, x1, y1]. */
  view_box: readonly [number, number, number, number];
  rotation: 0 | 90 | 180 | 270;
  user_unit: number;
  /** The visible page at scale 1, after its intrinsic rotation. */
  width: number;
  height: number;
};
/**
 * The member's word when a gesture would leave a retained mark beside another retained mark of the same answer within 4
 * points (a possible duplicate): « same » (retain and restore only, with same_as, the retained mark: the proposals join
 * it, this mark is withdrawn for the answer) or « distinct » (any gesture: add, move, retain, restore, reattribute; both
 * stand, and the pair is recorded). The machine never decides it.
 */
export type TakeoffCountMarkObjectDecision =
  | { object?: undefined; same_as?: undefined }
  | { object: "distinct"; same_as?: undefined }
  | { object: "same"; same_as: string };
export type TakeoffCountMarkGesture =
  | { op: "add"; answer_id: string; key: string; page: number; x: number; y: number; box?: TakeoffCountMarkBox;
    geometry?: TakeoffCountPageGeometry; object?: "distinct" }
  | { op: "move"; mark_id: string; x: number; y: number; box?: TakeoffCountMarkBox; object?: "distinct" }
  | { op: "remove"; answer_id: string; mark_id: string; reason: TakeoffCountMarkRemovalReason; note?: string }
  | ({ op: "restore"; answer_id: string; mark_id: string } & TakeoffCountMarkObjectDecision)
  | ({ op: "retain"; answer_id: string; mark_id: string } & TakeoffCountMarkObjectDecision)
  | { op: "reattribute"; answer_id: string; mark_id: string; to_answer_id: string; object?: "distinct" }
  | { op: "verify"; answer_id: string; pages: readonly number[] };

/** The refusals of an edit, each with nothing written, and the French sentence a member reads. */
export const TAKEOFF_COUNT_MARK_EDIT_REFUSALS = {
  TAKEOFF_MARKS_INVALID: "Les repères envoyés sont illisibles.",
  TAKEOFF_MARKS_FORBIDDEN: "Vous ne pouvez pas modifier les repères de cette affaire.",
  TAKEOFF_MARKS_ANSWER_NOT_FOUND: "Ce poste n'a pas de lecture sur ce plan dans cette affaire.",
  TAKEOFF_MARKS_ANSWER_REPLACED:
    "Une lecture plus récente de ce poste sur ce plan a remplacé celle-ci : ses repères ne se modifient plus.",
  TAKEOFF_MARKS_REVISION_CONFLICT:
    "Les repères de ce poste ont changé depuis leur affichage. Rechargez-les avant d'enregistrer.",
  TAKEOFF_MARKS_INTENT_CONFLICT: "Cette modification a déjà été envoyée avec un autre contenu.",
  TAKEOFF_MARKS_PAGE_OUTSIDE: "Cette page n'a pas été lue pour ce poste.",
  TAKEOFF_MARKS_PAGE_GEOMETRY_REQUIRED: "Cette page du plan n'est pas encore décrite : rechargez-la avant de pointer.",
  TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT: "Ce plan ne correspond plus à la page affichée : rechargez-la.",
  TAKEOFF_MARKS_MARK_NOT_FOUND: "Ce repère n'existe pas pour ce poste.",
  TAKEOFF_MARKS_STATE_INVALID: "Ce geste n'est pas possible pour ce repère dans son état actuel.",
  TAKEOFF_MARKS_ATTRIBUTION_TAKEN: "Ce repère est déjà retenu pour un autre poste : affectez-le plutôt à ce poste.",
  TAKEOFF_MARKS_OBJECT_DUPLICATE:
    "Un repère retenu pour ce poste est tout proche : dites s'il s'agit du même objet ou d'un objet distinct.",
  TAKEOFF_MARKS_TARGET_INCOMPATIBLE:
    "Ce repère ne peut pas être affecté à ce poste : autre plan, page non lue ou autre unité.",
  TAKEOFF_MARKS_UNDECIDED: "Décidez de chaque repère proposé sur cette page avant de la déclarer vérifiée.",
  TAKEOFF_MARKS_LIMIT_EXCEEDED: "Ce poste a trop de repères sur ce plan.",
  TAKEOFF_MARKS_PLAN_SENT:
    "Ce plan a déjà été envoyé au devis : ses repères se consultent ici, une correction passera par une révision de l’apport.",
} as const;
export type TakeoffCountMarkEditRefusal = keyof typeof TAKEOFF_COUNT_MARK_EDIT_REFUSALS;

/** The edit refusal a database error names, when it is one of the command's own. */
export function takeoffCountMarkEditRefusal(message: string | null | undefined): TakeoffCountMarkEditRefusal | null {
  const code = message?.trim() ?? "";
  return Object.hasOwn(TAKEOFF_COUNT_MARK_EDIT_REFUSALS, code) ? code as TakeoffCountMarkEditRefusal : null;
}

// The derivation (the database's private.takeoff_count_mark_summary, as a pure function).

/** One page of an answer's scope: its distinct marks by attribution state, and its last change and verification. */
export type TakeoffCountMarkPageFacts = {
  page: number;
  proposed: number;
  toAttribute: number;
  retained: number;
  removed: number;
  pending: number;
  /** The answer's marks revision of the page's last change (0 if none). */
  changedRevision: number;
  /** The answer's marks revision of the page's last verification, or null. */
  verifiedRevision: number | null;
};

export type TakeoffCountMarkPageSummary = TakeoffCountMarkPageFacts & {
  /** The marks retained on the page when it is verified, else 0. */
  reread: number;
  state: TakeoffCountMarkSummaryState;
};

export type TakeoffCountMarkSummary = {
  revision: number;
  /** The item's unit as its order sealed it, and whether it counts pieces: only then do marks give a quantity. */
  unit: string | null;
  counted: boolean;
  /** Undecided machine marks: the number proposed. */
  proposed: number;
  toAttribute: number;
  retained: number;
  removed: number;
  pending: number;
  /** The marks retained on the verified pages: the number reread on the scope. */
  reread: number;
  scopePages: number;
  verifiedPages: number;
  /**
   * The quantity retained: for an item counted in pieces, the marks retained once every page of the scope is verified,
   * one at least; else null, never 0.
   */
  quantity: number | null;
  state: TakeoffCountMarkSummaryState;
  pages: TakeoffCountMarkPageSummary[];
};

function pageIsVerified(facts: TakeoffCountMarkPageFacts) {
  return facts.verifiedRevision !== null && facts.verifiedRevision >= facts.changedRevision
    && facts.proposed === 0 && facts.toAttribute === 0;
}

function pageIsStale(facts: TakeoffCountMarkPageFacts) {
  return facts.verifiedRevision !== null && facts.verifiedRevision < facts.changedRevision;
}

/**
 * The count of an answer's marks, by page then in total: the same rule as the database. A page is verified when its last
 * verification is not older than its last change and nothing on it is undecided for the answer. Machine marks alone are
 * to check, with no quantity; a verified scope gives the marks retained, never 0 (« Aucun repère retenu » is a null); a
 * change after a verification makes it to verify again. Only an item counted in pieces (its sealed unit) gets a quantity;
 * a length or a surface keeps its three numbers. A grouped page total of lot 4 is not an input: it is never added.
 */
export function deriveTakeoffCountMarkSummary(input: {
  revision: number;
  /** The item's sealed unit. */
  unit: string | null;
  scopePages: readonly number[];
  pages: readonly TakeoffCountMarkPageFacts[];
}): TakeoffCountMarkSummary {
  const counted = isTakeoffCountUnit(input.unit);
  const byPage = new Map(input.pages.map((facts) => [facts.page, facts]));
  const scope = [...new Set(input.scopePages)].sort((a, b) => a - b);
  const pages = scope.map((page): TakeoffCountMarkPageSummary => {
    const facts = byPage.get(page) ?? { page, proposed: 0, toAttribute: 0, retained: 0, removed: 0, pending: 0,
      changedRevision: 0, verifiedRevision: null };
    const verified = pageIsVerified(facts);
    const state: TakeoffCountMarkSummaryState = verified ? (facts.retained > 0 ? "verified" : "no_mark_retained")
      : pageIsStale(facts) ? "to_verify_again"
      : facts.proposed + facts.toAttribute + facts.retained + facts.removed > 0 || facts.verifiedRevision !== null ? "to_check"
      : "none";
    return { ...facts, reread: verified ? facts.retained : 0, state };
  });
  const sum = (pick: (page: TakeoffCountMarkPageSummary) => number) => pages.reduce((total, page) => total + pick(page), 0);
  const verifiedPages = pages.filter(pageIsVerified).length;
  const retained = sum((page) => page.retained);
  const scopeVerified = pages.length > 0 && verifiedPages === pages.length;
  const decided = sum((page) => page.proposed + page.toAttribute + page.retained + page.removed);
  const state: TakeoffCountMarkSummaryState = scopeVerified ? (retained > 0 ? "verified" : "no_mark_retained")
    : pages.some(pageIsStale) ? "to_verify_again"
    : decided > 0 || pages.some((page) => page.verifiedRevision !== null) ? "to_check"
    : "none";
  return {
    revision: input.revision,
    unit: input.unit,
    counted,
    proposed: sum((page) => page.proposed),
    toAttribute: sum((page) => page.toAttribute),
    retained,
    removed: sum((page) => page.removed),
    pending: sum((page) => page.pending),
    reread: sum((page) => page.reread),
    scopePages: pages.length,
    verifiedPages,
    quantity: counted && scopeVerified && retained > 0 ? retained : null,
    state,
    pages,
  };
}

// What the readers and commands give back.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(what: string): never {
  throw new TypeError(`Repères illisibles : ${what}.`);
}
const id = (value: unknown, what: string) => typeof value === "string" && UUID.test(value) ? value : invalid(what);
const optionalId = (value: unknown, what: string) => value === null || value === undefined ? null : id(value, what);
const optionalText = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
const number = (value: unknown, what: string) => asFiniteNumber(value) ?? invalid(what);
const optionalNumber = (value: unknown, what: string) => value === null || value === undefined ? null : number(value, what);
const integer = (value: unknown, what: string) => {
  const parsed = number(value, what);
  return Number.isInteger(parsed) ? parsed : invalid(what);
};
const oneOf = <T extends string>(values: readonly T[], value: unknown, what: string): T =>
  (values as readonly unknown[]).includes(value) ? value as T : invalid(what);
const numbers = (value: unknown, length: number, what: string) =>
  Array.isArray(value) && value.length === length ? value.map((entry) => number(entry, what)) : invalid(what);
const optionalNumbers = (value: unknown, length: number, what: string) =>
  value === null || value === undefined ? null : numbers(value, length, what);

/** The server-side count of an answer as private.takeoff_count_mark_summary gives it. */
export function parseTakeoffCountMarkSummary(document: unknown): TakeoffCountMarkSummary {
  const row = asRecord(document) ?? invalid("décompte");
  const pages = Array.isArray(row.pages) ? row.pages.map((entry): TakeoffCountMarkPageSummary => {
    const page = asRecord(entry) ?? invalid("page du décompte");
    return {
      page: integer(page.page, "page"),
      proposed: integer(page.proposed, "repères proposés"),
      toAttribute: integer(page.to_attribute, "repères à attribuer"),
      retained: integer(page.retained, "repères retenus"),
      removed: integer(page.removed, "repères retirés"),
      pending: integer(page.pending, "repères en attente"),
      reread: integer(page.reread, "repères relus"),
      changedRevision: integer(page.changed_revision, "révision du changement"),
      verifiedRevision: page.verified_revision === null || page.verified_revision === undefined ? null
        : integer(page.verified_revision, "révision de la vérification"),
      state: oneOf(TAKEOFF_COUNT_MARK_SUMMARY_STATES, page.state, "état de la page"),
    };
  }) : invalid("pages du décompte");
  return {
    revision: integer(row.revision, "révision"),
    unit: optionalText(row.unit),
    counted: typeof row.counted === "boolean" ? row.counted : invalid("unité comptée"),
    proposed: integer(row.proposed, "repères proposés"),
    toAttribute: integer(row.to_attribute, "repères à attribuer"),
    retained: integer(row.retained, "repères retenus"),
    removed: integer(row.removed, "repères retirés"),
    pending: integer(row.pending, "repères en attente"),
    reread: integer(row.reread, "repères relus"),
    scopePages: integer(row.scope_pages, "pages du périmètre"),
    verifiedPages: integer(row.verified_pages, "pages vérifiées"),
    quantity: row.quantity === null || row.quantity === undefined ? null : integer(row.quantity, "quantité retenue"),
    state: oneOf(TAKEOFF_COUNT_MARK_SUMMARY_STATES, row.state, "état"),
    pages,
  };
}

export type TakeoffCountMarkProposal = {
  proposalId: string;
  answerId: string;
  jobId: string;
  observationId: string | null;
  generation: number;
  sourceKey: string;
  method: string;
  methodVersion: string;
  state: "proposed" | "to_attribute";
  x: number;
  y: number;
  box: number[] | null;
  rawCentre: number[] | null;
  rawBox: number[] | null;
  rawFrame: string | null;
  sourceRef: string | null;
  subtype: string | null;
  diameterMm: number | null;
  diameterSource: string | null;
  confidence: number | null;
  publishedAt: string;
  qualified?: boolean;
};

export type TakeoffCountMark = {
  markId: string;
  /** The centre, normalised in [0, 1] in the visible page after its intrinsic rotation, from its top-left corner. */
  x: number;
  y: number;
  box: number[] | null;
  origin: "machine" | "manual";
  positionRevision: number;
  createdBy: string | null;
  createdJobId: string | null;
  createdAt: string;
  movedBy: string | null;
  movedAt: string | null;
  /** Its attribution to the answer read. */
  state: TakeoffCountMarkState;
  priorState: TakeoffCountMarkState | null;
  reasonCode: string | null;
  reasonText: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The marks of the same answer a machine generation found within 4 points of this one: possible duplicates. */
  possibleDuplicates: string[];
  /** Its attributions to other answers (competing items), each with that answer's marks revision. */
  others: Array<{ answerId: string; itemId: string; state: TakeoffCountMarkState; revision: number }>;
  proposals: TakeoffCountMarkProposal[];
};

export type TakeoffCountMarksPage = {
  answerId: string;
  page: number;
  revision: number;
  geometry: (TakeoffCountPageGeometry & { plan_file_id: string; plan_generation: string | null }) | null;
  /** The server's total of the marks in the states asked, apart from the number loaded. */
  total: number;
  loaded: number;
  nextAfter: string | null;
  marks: TakeoffCountMark[];
};

function text(value: unknown, what: string) {
  return typeof value === "string" && value.length > 0 ? value : invalid(what);
}

function proposal(entry: unknown): TakeoffCountMarkProposal {
  const row = asRecord(entry) ?? invalid("proposition");
  return {
    proposalId: id(row.proposal_id, "proposition"),
    answerId: id(row.answer_id, "réponse de la proposition"),
    jobId: id(row.job_id, "analyse de la proposition"),
    observationId: optionalId(row.observation_id, "observation de la proposition"),
    generation: integer(row.generation, "génération"),
    sourceKey: text(row.source_key, "clé de source"),
    method: text(row.method, "méthode"),
    methodVersion: text(row.method_version, "version de méthode"),
    state: oneOf(["proposed", "to_attribute"] as const, row.state, "état proposé"),
    x: number(row.x, "abscisse proposée"),
    y: number(row.y, "ordonnée proposée"),
    box: optionalNumbers(row.box, 4, "cadre proposé"),
    rawCentre: optionalNumbers(row.raw_centre, 2, "centre lu"),
    rawBox: optionalNumbers(row.raw_box, 4, "cadre lu"),
    rawFrame: optionalText(row.raw_frame),
    sourceRef: optionalText(row.source_ref),
    subtype: optionalText(row.subtype),
    diameterMm: optionalNumber(row.diameter_mm, "diamètre"),
    diameterSource: optionalText(row.diameter_source),
    confidence: optionalNumber(row.confidence, "confiance"),
    publishedAt: text(row.published_at, "date de publication"),
  };
}

function mark(entry: unknown): TakeoffCountMark {
  const row = asRecord(entry) ?? invalid("repère");
  return {
    markId: id(row.mark_id, "repère"),
    x: number(row.x, "abscisse"),
    y: number(row.y, "ordonnée"),
    box: optionalNumbers(row.box, 4, "cadre"),
    origin: oneOf(["machine", "manual"] as const, row.origin, "origine"),
    positionRevision: integer(row.position_revision, "révision de position"),
    createdBy: optionalId(row.created_by, "auteur"),
    createdJobId: optionalId(row.created_job_id, "analyse d'origine"),
    createdAt: text(row.created_at, "date de création"),
    movedBy: optionalId(row.moved_by, "auteur du déplacement"),
    movedAt: optionalText(row.moved_at),
    state: oneOf(TAKEOFF_COUNT_MARK_STATES, row.state, "état"),
    priorState: row.prior_state === null || row.prior_state === undefined ? null
      : oneOf(TAKEOFF_COUNT_MARK_STATES, row.prior_state, "état antérieur"),
    reasonCode: optionalText(row.reason_code),
    reasonText: optionalText(row.reason_text),
    possibleDuplicates: Array.isArray(row.possible_duplicates)
      ? row.possible_duplicates.map((other) => id(other, "doublon possible")) : invalid("doublons possibles"),
    decidedBy: optionalId(row.decided_by, "auteur de la décision"),
    decidedAt: optionalText(row.decided_at),
    others: Array.isArray(row.others) ? row.others.map((other) => {
      const attribution = asRecord(other) ?? invalid("autre affectation");
      return { answerId: id(attribution.answer_id, "autre réponse"), itemId: id(attribution.item_id, "autre poste"),
        state: oneOf(TAKEOFF_COUNT_MARK_STATES, attribution.state, "autre état"),
        revision: integer(attribution.revision, "autre révision") };
    }) : invalid("autres affectations"),
    proposals: Array.isArray(row.proposals) ? row.proposals.map(proposal) : invalid("propositions"),
  };
}

/** The marks of an answer on one page as public.read_takeoff_count_marks gives them. */
export function parseTakeoffCountMarksPage(document: unknown): TakeoffCountMarksPage {
  const row = asRecord(document) ?? invalid("page de repères");
  const geometry = row.geometry === null || row.geometry === undefined ? null : (() => {
    const value = asRecord(row.geometry) ?? invalid("géométrie");
    const box = numbers(value.view_box, 4, "boîte visible");
    const rotation: TakeoffCountPageGeometry["rotation"] = value.rotation === 0 || value.rotation === 90
      || value.rotation === 180 || value.rotation === 270 ? value.rotation : invalid("rotation");
    return {
      version: value.version === 1 ? 1 as const : invalid("version de géométrie"),
      view_box: [box[0], box[1], box[2], box[3]] as const,
      rotation,
      user_unit: number(value.user_unit, "unité"),
      width: number(value.width, "largeur"),
      height: number(value.height, "hauteur"),
      plan_file_id: id(value.plan_file_id, "copie du plan"),
      plan_generation: optionalText(value.plan_generation),
    };
  })();
  return {
    answerId: id(row.answer_id, "réponse"),
    page: integer(row.page, "page"),
    revision: integer(row.revision, "révision"),
    geometry,
    total: integer(row.total, "total"),
    loaded: integer(row.loaded, "nombre chargé"),
    nextAfter: optionalId(row.next_after, "suite"),
    marks: Array.isArray(row.marks) ? row.marks.map(mark) : invalid("repères"),
  };
}

export type TakeoffCountMarkEditResult = {
  replayed: boolean;
  commandId: string;
  /** The new marks revision of each answer the edit changed. */
  revisions: Record<string, number>;
  /** The marks added, by the caller's key. */
  added: Array<{ key: string; markId: string }>;
  /** Each changed answer's totals and state as the command committed them, and only the pages this edit changed. */
  summaries: Record<string, TakeoffCountMarkSummary>;
};

/** What public.edit_takeoff_count_marks answers. */
export function parseTakeoffCountMarkEditResult(document: unknown): TakeoffCountMarkEditResult {
  const row = asRecord(document) ?? invalid("réponse de la modification");
  const revisions = asRecord(row.revisions) ?? invalid("révisions");
  const summaries = asRecord(row.summaries) ?? invalid("décomptes");
  return {
    replayed: row.replayed === true,
    commandId: id(row.command_id, "commande"),
    revisions: Object.fromEntries(Object.entries(revisions).map(([answerId, revision]) =>
      [id(answerId, "réponse modifiée"), integer(revision, "révision")])),
    added: Array.isArray(row.added) ? row.added.map((entry) => {
      const added = asRecord(entry) ?? invalid("repère ajouté");
      return { key: id(added.key, "clé de l'ajout"), markId: id(added.mark_id, "repère ajouté") };
    }) : invalid("repères ajoutés"),
    summaries: Object.fromEntries(Object.entries(summaries).map(([answerId, summary]) =>
      [id(answerId, "réponse décomptée"), parseTakeoffCountMarkSummary(summary)])),
  };
}
