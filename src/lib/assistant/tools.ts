import "server-only";

import { z } from "zod";

import { compareEstimates, estimateLineDetail, estimateLines, estimateOutline, type EstimateReading } from "@/lib/assistant/estimate-reading";
import { listAffaireEstimateVersions, loadEstimateReading } from "@/lib/assistant/estimate-reading-server";
import { AssistantToolError, type AssistantTool } from "@/lib/assistant/loop";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { getTakeoffJobDetails, listTakeoffJobs } from "@/lib/takeoff/job-read-server";
import { getEstimateVersionProjectIdOrThrow } from "@/lib/takeoff/version-access-server";

const id = z.string().uuid();
const TAKEOFF_ITEMS_PAGE = 100;

/** A refusal the application worded for its user (4xx) is told as is; anything else stays a failure. */
async function userFacing<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (error instanceof Error && typeof status === "number" && status >= 400 && status < 500) {
      throw new AssistantToolError(error.message);
    }
    throw error;
  }
}

/**
 * The reads of one conversation. Every tool is bound to the conversation's
 * affaire and runs with the member's own rights: the identifiers the model
 * passes are checked against that affaire before anything is returned.
 */
export function buildAssistantTools(scope: { context: AuthenticatedContext; projectId: string }): AssistantTool[] {
  // One user turn reads the same estimate several times: compute it once.
  const readings = new Map<string, Promise<EstimateReading>>();
  const reading = (versionId: string) => {
    const cached = readings.get(versionId);
    if (cached) return cached;
    const loaded = loadEstimateReading(scope.context, { versionId, projectId: scope.projectId });
    readings.set(versionId, loaded);
    // A refused reading (edited meanwhile, no access) is not kept: the next call reads again.
    loaded.catch(() => { if (readings.get(versionId) === loaded) readings.delete(versionId); });
    return loaded;
  };

  return [
    {
      name: "lister_devis", activity: "Liste des devis de l’affaire",
      description: "Liste les versions de devis de l’affaire (identifiant, version, statut). À utiliser quand aucun devis n’est ouvert ou pour comparer deux versions.",
      input: z.object({}).strict(),
      run: () => listAffaireEstimateVersions(scope.context, scope.projectId),
    },
    {
      name: "lire_devis", activity: "Lecture du devis",
      description: "Vue d’ensemble d’un devis : paramètres de calcul, totaux du pied de devis, avertissements, et chaque section avec son total et son nombre de lignes. Commence par cet outil.",
      input: z.object({ versionId: id }).strict(),
      run: async (input) => estimateOutline(await reading((input as { versionId: string }).versionId)),
    },
    {
      name: "lire_lignes_devis", activity: "Lecture des lignes du devis",
      description: "Lignes d’un devis (désignation, quantité, unité, PU HT, total HT, statut), 80 par page. Filtres possibles : une section (sous-sections comprises), un texte de désignation, ou seulement les lignes « Non chiffrée » avec `nonChiffrees`. `lignes_restantes` indique s’il faut demander la page suivante avec `offset`.",
      input: z.object({
        versionId: id, sectionId: id.optional(), recherche: z.string().trim().min(1).max(120).optional(),
        nonChiffrees: z.boolean().optional(), offset: z.number().int().min(0).max(100_000).optional(),
      }).strict(),
      run: async (raw) => {
        const input = raw as { versionId: string; sectionId?: string; recherche?: string; nonChiffrees?: boolean; offset?: number };
        return estimateLines(await reading(input.versionId), {
          sectionId: input.sectionId, search: input.recherche, offset: input.offset, unpricedOnly: input.nonChiffrees,
        });
      },
    },
    {
      name: "lire_ligne_devis", activity: "Lecture du calcul d’une ligne",
      description: "Détail d’une ligne de devis : ce qui a été saisi (prix de base FO, heures MO, K MO, TVA) et ce que le moteur en calcule (PU HT, total HT, total net après remise s’il diffère, déboursé, parts FO et MO, détail du coût FO). À utiliser pour expliquer un prix. Le taux horaire de main-d’œuvre n’est pas fourni.",
      input: z.object({ versionId: id, lineId: id }).strict(),
      run: async (raw) => {
        const input = raw as { versionId: string; lineId: string };
        return estimateLineDetail(await reading(input.versionId), input.lineId);
      },
    },
    {
      name: "comparer_devis", activity: "Comparaison de deux devis",
      description: "Compare deux versions de devis de l’affaire : écart du total HT (B moins A) et sections dont le total diffère ou qui n’existent que dans une version. Les écarts sont déjà calculés : recopie-les.",
      input: z.object({ versionIdA: id, versionIdB: id }).strict(),
      run: async (raw) => {
        const input = raw as { versionIdA: string; versionIdB: string };
        return compareEstimates(await reading(input.versionIdA), await reading(input.versionIdB));
      },
    },
    {
      name: "lire_metre", activity: "Lecture du métré",
      description: "Sans `jobId` : liste les métrés de l’affaire. Avec `jobId` : lignes du métré (désignation, quantité, unité, confiance, preuve, fichier et page source, vérifiée ou exclue), 100 par page.",
      input: z.object({ jobId: id.optional(), offset: z.number().int().min(0).max(100_000).optional() }).strict(),
      run: (raw) => userFacing(async () => {
        const input = raw as { jobId?: string; offset?: number };
        if (!input.jobId) {
          const list = await listTakeoffJobs({ project_id: scope.projectId, limit: 50 });
          return {
            metres: list.jobs.map((job) => ({
              id: job.id, statut: job.status, niveau: job.level, devis_version_id: job.estimate_version_id,
              lignes: job.items_count, cree_le: job.created_at,
            })),
          };
        }
        // The affaire is checked on the job's own row before any of its lines is read.
        const job = await scope.context.supabase.from("takeoff_jobs").select("id, estimate_version_id")
          .eq("id", input.jobId).eq("tenant_id", scope.context.tenantId).maybeSingle();
        if (job.error || !job.data) throw new AssistantToolError("Ce métré est introuvable ou vous n’y avez pas accès.");
        const projectId = await getEstimateVersionProjectIdOrThrow({
          supabase: scope.context.supabase, tenantId: scope.context.tenantId, versionId: job.data.estimate_version_id,
        });
        if (projectId !== scope.projectId) throw new AssistantToolError("Ce métré n’appartient pas à l’affaire de cette conversation.");
        const offset = input.offset ?? 0;
        const detail = await getTakeoffJobDetails(input.jobId, { items_limit: TAKEOFF_ITEMS_PAGE, items_offset: offset });
        return {
          metre: { id: detail.job.id, statut: detail.job.status, niveau: detail.job.level, devis_version_id: detail.job.estimate_version_id },
          lignes: detail.items.data.map((item) => ({
            id: item.id, designation: item.designation, quantite: item.quantity, unite: item.unit, confiance: item.confidence,
            preuve: item.evidence, fichier_source: item.source_file_name, page_source: item.source_page,
            verifiee: item.is_verified, exclue: item.is_excluded, motif_exclusion: item.exclusion_reason,
          })),
          lignes_restantes: Math.max(0, detail.items.pagination.total - offset - detail.items.data.length),
        };
      }),
    },
  ];
}
