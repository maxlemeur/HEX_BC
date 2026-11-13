import { z } from "zod";

import { describeV3EntryRefusal } from "@/lib/estimates/assemblies-server";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

export type ApplyTakeoffRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type TakeoffV3UnresolvedUnit = {
  takeoff_item_id: string | null;
  designation: string;
  unit: string | null;
};

const takeoffV3UnresolvedUnitsDetailSchema = z.object({
  items: z.array(
    z.object({
      takeoff_item_id: z.string().nullable().optional(),
      designation: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
    })
  ),
});

/** Les items dont l'unité n'a pas de code dans le référentiel, tels que la migration M2 les nomme (détail JSON). */
function parseTakeoffV3UnresolvedUnits(detail: string | null | undefined): TakeoffV3UnresolvedUnit[] {
  if (!detail) return [];
  try {
    const parsed = takeoffV3UnresolvedUnitsDetailSchema.safeParse(JSON.parse(detail));
    if (!parsed.success) return [];
    return parsed.data.items.map((item) => ({
      takeoff_item_id: item.takeoff_item_id ?? null,
      designation: item.designation?.trim() || "Item sans désignation",
      unit: item.unit ?? null,
    }));
  } catch {
    return [];
  }
}

const TAKEOFF_V3_UNRESOLVED_UNITS_NAMED = 5;

function takeoffV3UnresolvedUnitsMessage(items: TakeoffV3UnresolvedUnit[]) {
  const advice =
    "Corrigez l’unité dans la revue (par exemple ml, m2, u, ens ou PM) ou excluez l’item, puis appliquez à nouveau.";
  if (items.length === 0) {
    return `Une unité du métré est inconnue du devis moteur 3. ${advice}`;
  }
  const named = items
    .slice(0, TAKEOFF_V3_UNRESOLVED_UNITS_NAMED)
    .map((item) => `« ${item.designation} » (${item.unit?.trim() ? item.unit.trim() : "sans unité"})`)
    .join(", ");
  const others = items.length - TAKEOFF_V3_UNRESOLVED_UNITS_NAMED;
  const more = others > 0 ? ` et ${others} autre${others > 1 ? "s" : ""}` : "";
  return `Unité inconnue du devis moteur 3 pour ${named}${more}. ${advice}`;
}

const takeoffSourcesConflictSchema = z.object({
  scope: z.enum(["group", "page"]),
  dimension: z.string().nullable().optional(),
  source_file_name: z.string().nullable().optional(),
  source_page: z.number().int().nullable().optional(),
});

/** Which reasoning refused two readings, as the guard's detail says it (JSON); null when it says nothing readable. */
function parseTakeoffSourcesConflict(detail: string | null | undefined) {
  if (!detail) return null;
  try {
    const parsed = takeoffSourcesConflictSchema.safeParse(JSON.parse(detail));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** « de la page 3 de plan.pdf », with what the guard named. */
function takeoffConflictPage(conflict: { source_file_name?: string | null; source_page?: number | null }) {
  const page = typeof conflict.source_page === "number" ? `de la page ${conflict.source_page}` : "d’une même page";
  return conflict.source_file_name ? `${page} de « ${conflict.source_file_name} »` : page;
}

const takeoffPageRefusalSchema = z.object({
  scope: z.literal("page"),
  reason: z.string().optional(),
  source_file_name: z.string().nullable().optional(),
  source_page: z.number().int().nullable().optional(),
  plan_file_id: z.string().nullable().optional(),
  earlier_job_ids: z.array(z.string()).optional(),
  line_count: z.number().int().optional(),
  estimate_item_id: z.string().optional(),
  takeoff_item_id: z.string().optional(),
  paired_estimate_item_id: z.string().nullable().optional(),
});

/** What the page guard named (JSON detail); null when it says nothing readable. */
function parseTakeoffPageRefusal(detail: string | null | undefined) {
  if (!detail) return null;
  try {
    const parsed = takeoffPageRefusalSchema.safeParse(JSON.parse(detail));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** « La page 3 de « plan.pdf » », with what the guard named. */
function pageName(page: { source_file_name?: string | null; source_page?: number | null }) {
  const name = typeof page.source_page === "number" ? `La page ${page.source_page}` : "Une page";
  return page.source_file_name ? `${name} de « ${page.source_file_name} »` : name;
}

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const listOf = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;

type RefusedPage = { source_file_name: string | null; source_page: number | null; decision: "replace" | "keep_both" | null };

/** « la page 1 de « plan.pdf » », « les pages 1 et 2 de « plan.pdf » et la page 4 de « b.pdf » », by file. */
function pagesOf(pages: readonly RefusedPage[]) {
  const byFile = new Map<string | null, Array<number | null>>();
  for (const page of pages) byFile.set(page.source_file_name, [...(byFile.get(page.source_file_name) ?? []), page.source_page]);
  return listOf([...byFile.entries()].map(([file, numbers]) => {
    const known = numbers.filter((value): value is number => value !== null).sort((left, right) => left - right);
    const unknown = numbers.length - known.length;
    const named = [...(known.length > 0 ? [`${known.length > 1 ? "les pages" : "la page"} ${listOf(known.map(String))}`] : []),
      ...(unknown > 0 ? [unknown > 1 ? `${unknown} pages sans numéro` : "une page sans numéro"] : [])];
    return `${listOf(named)} ${file ? `de « ${file} »` : "d’un plan sans nom"}`;
  }));
}

const dpgfPartUnknownSchema = z.object({
  designation: z.string(),
  unit: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  fed: z.boolean().optional(),
  earlier_job_id: z.string().optional(),
  pages: z.array(z.object({ source_file_name: z.string().nullable(), source_page: z.number().int().nullable(),
    decision: z.enum(["replace", "keep_both"]).nullable(), fed_again: z.boolean().optional() })).min(1),
});

type DpgfPartUnknown = z.infer<typeof dpgfPartUnknownSchema>;

/** What the database named of a part that cannot be cut (TI-716); null when it named nothing readable. */
function parseDpgfPartUnknown(detail: string | null | undefined): DpgfPartUnknown | null {
  if (!detail) return null;
  try {
    const parsed = dpgfPartUnknownSchema.safeParse(JSON.parse(detail));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const DPGF_PART_UNKNOWN_DEFAULT = "Une ligne DPGF tient la mesure d’un métré appliqué avant le cumul, qui mêle plusieurs pages sans la "
  + "part de chacune : elle ne sort pas avec une seule d’entre elles. Rien n’est appliqué. Recommandé : relancez le métré en lisant "
  + "aussi ses autres pages, puis remplacez ces pages ensemble : la mesure précédente sort alors entière. Sinon, gardez les deux "
  + "mesures de la page : la page comptera deux fois au devis, à corriger à la main.";

/**
 * TI-716: a page whose DPGF part cannot be cut (dpgf_part_unknown, a policy applied before D4) is refused, never all of the
 * part removed. The refusal names the line as the database read it before the application, the pages the part mixes,
 * the way out recommended (the pages it does not replace, read again by a relaunch or replaced here, replaced together:
 * the part leaves whole) and the other (both kept on the page replaced, which then counts twice). Never « reset the line »:
 * it would remove the measures of the other pages unseen. Without the line named (an older database), the same ways out.
 */
function dpgfPartUnknownMessage(parsed: DpgfPartUnknown | null) {
  if (!parsed) return DPGF_PART_UNKNOWN_DEFAULT;
  const replaced = parsed.pages.filter((page) => page.decision === "replace");
  const keptBoth = parsed.pages.filter((page) => page.decision === "keep_both");
  const notRead = parsed.pages.filter((page) => page.decision === null);
  const quantity = typeof parsed.quantity === "number"
    ? ` (${quantityFormat.format(parsed.quantity)}${parsed.unit?.trim() ? ` ${parsed.unit.trim()}` : ""})` : "";
  const several = replaced.length > 1;
  const alone = replaced.length > 0 ? `${pagesOf(replaced)} seule${several ? "s" : ""}` : "une seule de ses pages";
  const ways = [...(notRead.length > 0 ? [`relancez le métré en lisant aussi ${pagesOf(notRead)}`] : []),
    ...(keptBoth.length > 0 ? [`remplacez aussi ${pagesOf(keptBoth)}`] : [])];
  const recommended = ways.length > 0
    ? `Recommandé : ${ways.join(", ")}, puis remplacez ces pages ensemble : la mesure précédente sort alors entière.` : "";
  // Whether this takeoff feeds the line again from the pages replaced (per page; the line's own flag from an older detail).
  const refed = replaced.length > 0 && replaced.every((page) => page.fed_again ?? parsed.fed !== false);
  const counted = several ? "ces pages compteront" : "la page comptera";
  const twice = refed ? `${counted} deux fois sur cette ligne`
    : `la ligne garde la mesure précédente et ${several ? "leur" : "sa"} nouvelle mesure entre ailleurs, ${counted} deux fois au devis`;
  return [`La ligne DPGF « ${parsed.designation} »${quantity} tient la mesure d’un métré appliqué avant le cumul, qui mêle `
    + `${pagesOf(parsed.pages)} sans la part de chacune : elle ne sort pas avec ${alone}. Rien n’est appliqué.`, recommended,
  `Sinon, gardez les deux mesures ${ofPages(replaced.length > 0 ? pagesOf(replaced) : "la page")} : ${twice}, à corriger à la main.`]
    .filter(Boolean).join(" ");
}

/** « de la page 1 », « des pages 1 et 2 », « d’une page sans numéro ». */
const ofPages = (pages: string) => (pages.startsWith("les ") ? `des ${pages.slice(4)}` : pages.startsWith("une ") ? `d’${pages}` : `de ${pages}`);

const dpgfMergedSchema = z.object({
  reason: z.literal("merged_outside_reconciliation"),
  estimate_item_id: z.string().optional(),
  dpgf_title: z.string(),
  takeoff_item_id: z.string().optional(),
  designation: z.string().nullable(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  fed: z.boolean().optional(),
  /**
   * TI-723: whether this application composes the DPGF line (feeds it, or replaces one of its pages). False: neither, the
   * merge would make it an ordinary takeoff line. Absent (a detail written before TI-723): composed.
   */
  composed: z.boolean().optional(),
  /** TI-723: what the DPGF line holds before the application. */
  dpgf_quantity: z.number().nullable().optional(),
  dpgf_unit: z.string().nullable().optional(),
  /** The reconciliation links the line to another DPGF target, where it is counted. */
  linked: z.boolean().optional(),
});

/** TI-716, TI-723: what the database named when « Fusionner » sent a takeoff line onto a DPGF line outside the reconciliation. */
function parseDpgfMerged(detail: string | null | undefined) {
  if (!detail) return null;
  try {
    const parsed = dpgfMergedSchema.safeParse(JSON.parse(detail));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Why the database refused a page decision (TAKEOFF_PAGE_DECISION_INVALID). */
const PAGE_DECISION_MESSAGES: Record<string, string> = {
  remove_other_pages: "Une ligne à retirer porte aussi d’autres pages du plan : la retirer les retirerait. Gardez-la, ou corrigez-la dans le devis.",
  assembly_line: "Une ligne d’ouvrage tient sa quantité de l’ouvrage : elle se garde ou se retire, jamais une ligne du métré ne la remplace.",
  nothing_replaced: "Rien n’est remplacé sur une page : gardez les deux mesures avec un motif.",
  dpgf_not_replaced: "Une ligne DPGF de la page n’est pas alimentée par ce métré : sa mesure resterait à côté de la nouvelle. Gardez les deux mesures avec un motif.",
  take_required: "Une quantité de ligne a été modifiée à la main : choisissez de prendre la nouvelle mesure ou de garder la vôtre.",
  dpgf_keep_both: "Garder les deux mesures n’est pas possible sur une page qui alimente une ligne DPGF déjà alimentée par un autre métré : la ligne DPGF ne garde qu’une mesure. Remplacez la mesure précédente.",
  ambiguous_document: "Une ligne du métré ne connaît que le nom de son plan, et deux plans de même nom sont au devis sur cette page : rattachez-la à la main ou ajoutez-la.",
  unit_mismatch: "Une ligne ne peut remplacer qu’une ligne de même unité.",
  strategy_replace: "« Remplacer la section » vide la section entière : il ne se combine pas avec un remplacement ligne à ligne. Choisissez « Ajouter ».",
  dpgf_target: "Une ligne DPGF suit son rapprochement : elle n’est ni remplacée ni retirée ici.",
  conflicting_actions: "Une même ligne a reçu deux choix contraires sur deux pages.",
  update_without_pair: "Une ligne à mettre à jour n’a pas de ligne du nouveau métré.",
  pair_without_update: "Une ligne rattachée n’est pas marquée à mettre à jour.",
  new_line_paired_twice: "Une ligne du nouveau métré est rattachée deux fois.",
  new_line_not_applied: "Une ligne rattachée n’entre pas au devis (exclue, ignorée ou intégrée à un ouvrage).",
  job_not_completed: "Seul un métré terminé reçoit des choix sur ses pages.",
  page_twice: "Une même page a reçu deux choix.",
  shape: "Les choix des pages déjà au devis sont incomplets : choisissez pour chaque page et chaque ligne.",
};

export function mapApplyTakeoffRpcError(
  error: ApplyTakeoffRpcError,
  input: { jobId: string }
): TakeoffError {
  const normalized = [
    error.code ?? "",
    error.message ?? "",
    error.details ?? "",
    error.hint ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const details = {
    rpc: {
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    },
  };

  if (normalized.includes("takeoff_alternative_sources_conflict")) {
    // TI-682 (D11): the guard says which reasoning refused (private.assert_takeoff_single_quantity_source): two readings
    // the worker paired, or a vector line it did not pair beside a vision line of its page that nothing proves to
    // count something else. The detail's dimension (the measure's own) is kept for the diagnosis.
    const conflict = parseTakeoffSourcesConflict(error.details);
    return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message: conflict?.scope === "page"
        ? `Une mesure vectorielle et une ligne lue sur le plan ${takeoffConflictPage(conflict)} sont retenues ensemble. Conservez une seule lecture par page : excluez l’une des deux dans la revue. Seuls un comptage ou une mesure d’une autre nature, dans une unité connue, restent à côté d’une mesure.`
        : "Deux lectures alternatives sont retenues pour la même quantité. Conservez une seule source par poste ou zone.",
      details: { ...details, guard: "quantity_sources", ...(conflict ?? {}) }, retryable: false, jobId: input.jobId });
  }

  if (normalized.includes("takeoff_page_")) {
    // TI-682 lot D: a plan page enters an estimate once (private.assert_takeoff_pages_once and the page decisions).
    const page = parseTakeoffPageRefusal(error.details);
    const guardDetails = { ...details, ...(page ?? {}) };
    if (normalized.includes("takeoff_page_already_applied")) {
      const lines = typeof page?.line_count === "number" ? ` (${page.line_count} ligne${page.line_count > 1 ? "s" : ""})` : "";
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
        message: `${pageName(page ?? {})} est déjà au devis par un autre métré${lines}. `
          + "Choisissez à l’étape « Pages déjà au devis » de remplacer sa mesure ou de garder les deux.",
        details: { ...guardDetails, guard: "page_already_applied" }, retryable: false, jobId: input.jobId });
    }
    if (normalized.includes("takeoff_page_replace_conflict")) {
      // Deterministic: the same decisions would meet the same match again. The proposal replays the merge (mergeMatches),
      // so this happens only when the section changed or a pair was chosen by hand; the step reads its proposal again
      // (guard page_decision) with the merge's own pair locked. On DPGF « Fusionner » is required: no « Ajouter » there.
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
        message: "La fusion rattache une ligne du nouveau métré à une autre ligne de la page que celle choisie. "
          + "La proposition est relue avec le rattachement de la fusion : vérifiez-le puis confirmez. Hors DPGF, « Ajouter » évite la fusion.",
        details: { ...guardDetails, guard: "page_decision", reason: "merge_elsewhere" }, retryable: false, jobId: input.jobId });
    }
    if (normalized.includes("takeoff_page_decision_stale")) {
      return new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
        message: "Le devis a changé depuis la proposition des pages déjà au devis. Relisez-la et confirmez à nouveau.",
        details: { ...guardDetails, guard: "page_decision" }, retryable: true, jobId: input.jobId });
    }
    if (normalized.includes("takeoff_page_decisions_frozen")) {
      return new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
        message: "Ce métré est déjà appliqué : ses choix sur les pages déjà au devis ne changent plus.",
        details: { ...guardDetails, guard: "page_decision" }, retryable: false, jobId: input.jobId });
    }
    if (page?.reason === "dpgf_part_unknown") {
      // TI-716: the DPGF line, the pages its part mixes and the ways out, as the database named them.
      const named = parseDpgfPartUnknown(error.details);
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
        message: dpgfPartUnknownMessage(named), details: { ...guardDetails, ...(named ?? {}), guard: "page_decision" },
        retryable: false, jobId: input.jobId });
    }
    return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message: PAGE_DECISION_MESSAGES[page?.reason ?? ""] ?? PAGE_DECISION_MESSAGES.shape,
      details: { ...guardDetails, guard: "page_decision" }, retryable: false, jobId: input.jobId });
  }

  if (normalized.includes("takeoff_dpgf_quantity_")) {
    const stale = normalized.includes("snapshot_stale");
    const merge = normalized.includes("merge_required");
    // TI-716: « Fusionner » sent a takeoff line onto a DPGF line outside the reconciliation; its sum would erase it. TI-723:
    // or onto a DPGF line this application does not compose, which would lose its DPGF quantity.
    const merged = normalized.includes("mapping_conflict") ? parseDpgfMerged(error.details) : null;
    if (merged) {
      const measureOf = (quantity: number | null | undefined, unit: string | null | undefined) => (typeof quantity === "number"
        ? ` (${quantityFormat.format(quantity)}${unit?.trim() ? ` ${unit.trim()}` : ""})` : "");
      const line = `« ${merged.designation?.trim() || "une ligne"} »${measureOf(merged.quantity, merged.unit)}`;
      // TI-723: onto a DPGF line this application neither feeds nor replaces a page of. The merge would make it an
      // ordinary takeoff line; linked to it in the reconciliation, the line feeds it through its composition instead.
      const target = `la ligne DPGF « ${merged.dpgf_title} »${measureOf(merged.dpgf_quantity, merged.dpgf_unit)}, que ce métré n’alimente pas : `
        + "la fusion en ferait une ligne de métré ordinaire, sans sa quantité du DPGF ni sa composition. Rien n’est appliqué.";
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
        message: merged.composed === false
          ? merged.linked
            ? `La fusion par désignation enverrait ${line} de ce métré, que le rapprochement relie à une autre ligne DPGF, aussi sur ${target} `
              + "Vérifiez les rattachements DPGF de cette ligne dans le rapprochement, puis appliquez à nouveau."
            : `La fusion par désignation enverrait ${line} de ce métré sur ${target} Reliez cette ligne à la ligne DPGF dans le `
              + "rapprochement : elle l’alimentera, sa quantité du DPGF gardée. Sinon, excluez-la à la revue du métré. Puis appliquez à nouveau."
          : merged.linked
          ? `La fusion par désignation enverrait ${line} de ce métré, que le rapprochement relie à une autre ligne DPGF, aussi sur la `
            + `ligne DPGF « ${merged.dpgf_title} » : la somme de cette ligne effacerait la mesure. Rien n’est appliqué. Vérifiez les `
            + "rattachements DPGF de cette ligne dans le rapprochement, puis appliquez à nouveau."
          : `La fusion par désignation enverrait ${line} de ce métré sur la ligne DPGF « ${merged.dpgf_title} », à laquelle le `
            + "rapprochement ne la relie pas : la ligne DPGF tient la somme de ce qui l’alimente et effacerait cette mesure. Rien n’est "
            + "appliqué. Reliez cette ligne à la ligne DPGF dans le rapprochement, ou excluez-la à la revue du métré, puis appliquez à nouveau.",
        details: { ...details, ...merged, guard: "dpgf_quantities" }, retryable: false, jobId: input.jobId });
    }
    return new TakeoffError({ status: stale ? 409 : 422,
      code: stale ? TakeoffErrorCode.CONFLICT : TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message: stale ? "Les quantités, les rattachements ou la revue ont changé. Rechargez la comparaison avant d’appliquer."
        : merge ? "Utilisez la fusion pour conserver les références DPGF et appliquer les quantités protectrices."
          : "Vérifiez les quantités et les rattachements DPGF avant l’application. Une même prestation doit conserver une base et un chiffrage cohérents.",
      details: { ...details, guard: "dpgf_quantities" }, retryable: stale, jobId: input.jobId });
  }

  if (error.code === "PGRST202") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application atomique du métré n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "atomic_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Métré M2 v0.1 : refus nommés de l'application à un brouillon du moteur 3.
  if (error.message === "TAKEOFF_V3_UNIT_UNRESOLVED") {
    const items = parseTakeoffV3UnresolvedUnits(error.details);
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: takeoffV3UnresolvedUnitsMessage(items),
      details: {
        ...details,
        guard: "v3_unit_unresolved",
        items,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED") {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Ce devis n’est plus un brouillon : le métré ne peut plus s’y appliquer. Créez un brouillon depuis cette version, puis relancez le métré sur ce brouillon.",
      details: {
        ...details,
        guard: "target_version_draft_required",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  const v3EntryRefusal = describeV3EntryRefusal(error);
  if (v3EntryRefusal) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: v3EntryRefusal.message,
      details: {
        ...details,
        guard: "v3_entry_refusal",
        refusal: v3EntryRefusal.code,
        title: v3EntryRefusal.title,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_WRITER_NOT_SUPPORTED") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré à un devis moteur 3 n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "v3_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Refus du moteur 3 au calcul des lignes : rien n'est appliqué, la revue reste corrigeable.
  if (error.message === "ESTIMATE_V3_INPUT_INVALID" || error.message === "ESTIMATE_AMOUNT_OVERFLOW") {
    const overflow = error.message === "ESTIMATE_AMOUNT_OVERFLOW";
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: overflow
        ? "Avec ce métré, un montant du devis moteur 3 dépasserait la limite autorisée : rien n’a été appliqué. Vérifiez les quantités dans la revue, puis appliquez à nouveau."
        : "Une quantité ou un prix du métré ne peut pas être chiffré par le devis moteur 3 (valeur négative, illisible ou trop précise) : rien n’a été appliqué. Corrigez-le dans la revue, puis appliquez à nouveau.",
      details: {
        ...details,
        guard: overflow ? "v3_amount_overflow" : "v3_input_invalid",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_PROJECTION_MISMATCH") {
    return new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "Le calcul moteur 3 du devis ne concorde pas après ce métré : rien n’a été appliqué. Signalez-le avant d’appliquer à nouveau.",
      details: {
        ...details,
        guard: "v3_projection_mismatch",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.code === "57014") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré a pris trop de temps et a été annulée : rien n’a été appliqué. Réessayez dans un instant.",
      details: {
        ...details,
        guard: "statement_timeout",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (normalized.includes("takeoff_root_replace_disabled")) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message:
        "Le remplacement complet du devis est désactivé : choisissez une section pour limiter l’application et protéger le chiffrage existant.",
      details: {
        ...details,
        guard: "root_replace_disabled",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_atomic_mapping_plan") ||
    normalized.includes("takeoff_atomic_line_mapping_failed")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Le métré ou le devis a changé depuis l’aperçu. Rechargez la revue avant d’appliquer.",
      details: {
        ...details,
        guard: "atomic_mapping_stale",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_dpgf_apply_authorization_required") ||
    normalized.includes("takeoff_dpgf_apply_authorization_invalid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message:
        "La validation DPGF a expiré ou n’est plus valable. Relancez l’application pour recalculer les contrôles.",
      details: {
        ...details,
        guard: "dpgf_authorization",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // The trigger's own count (TI-664: the same lines as checkApplyGuard) refused the application: a guard failure,
  // never a generic conflict, so that the review shows what to settle.
  if (normalized.includes("takeoff_apply_guard_failed")) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message: "Le contrôle d’application de la base refuse des lignes non tranchées. Rechargez la revue pour voir leurs raisons.",
      details: {
        ...details,
        guard: "database",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "PGRST116" ||
    normalized.includes("not found") ||
    normalized.includes("introuvable")
  ) {
    return new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "P0001" ||
    error.code === "23505" ||
    normalized.includes("conflict") ||
    normalized.includes("already applied") ||
    normalized.includes("deja applique") ||
    normalized.includes("lock")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Conflit lors de l'application du job takeoff.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514" ||
    normalized.includes("validation") ||
    normalized.includes("invalid") ||
    normalized.includes("invalide") ||
    normalized.includes("uuid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: "Le payload d'application takeoff est invalide.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  return new TakeoffError({
    status: 500,
    code: TakeoffErrorCode.INTERNAL_ERROR,
    message: "Erreur interne lors de l'application du job takeoff.",
    details,
    retryable: false,
    jobId: input.jobId,
  });
}
