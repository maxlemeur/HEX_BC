import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveCalcEngineVersion,
  type CalcEngineVersion,
} from "@/lib/estimates/calc-engine-version";
import { mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { Database } from "@/types/database";

/**
 * `SupabaseClient<Database>` couvre a la fois le client anon de
 * `createSupabaseServerClient` (`@supabase/ssr` renvoie
 * `SupabaseClient<Database, "public">`) et le client service-role du portail
 * (`createServiceRoleClient`). Aucun des deux modules n'est importe ici, meme
 * en type-only : ce module ne doit dependre ni de `next/headers` ni de la
 * configuration service-role.
 */
type Supabase = SupabaseClient<Database>;

type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

/** Cle du flag qui active le split main-d'oeuvre atelier / chantier. */
export const ESTIMATE_LABOR_SPLIT_FLAG_KEY = "EST_031_LABOR_SPLIT";

const LOAD_ERROR_MESSAGE =
  "Impossible de charger le contexte de calcul du devis.";

/**
 * Colonnes lues sur `estimate_versions`. Volontairement ecrite en un seul
 * litteral (et non concatenee) pour que TypeScript en conserve le type
 * litteral et puisse typer le retour de `.select()`.
 *
 * C'est le SUPERSET des colonnes utilisees aujourd'hui par les 5 appelants
 * (page detail, page print, portail, `server.ts`, `pdf-generator`), plus
 * `calc_engine_version` ajoutee a l'etape 2 de la phase A.
 */
export const ESTIMATE_CALC_CONTEXT_VERSION_COLUMNS =
  "id, tenant_id, project_id, version_number, status, title, exclusions, date_devis, validite_jours, currency, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents, seal_hash, calc_engine_version";

export type EstimateCalcContextVersion = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "exclusions"
  | "date_devis"
  | "validite_jours"
  | "currency"
  | "margin_multiplier"
  | "margin_mode"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "seal_hash"
  | "calc_engine_version"
>;

export type EstimateCalcContext = {
  version: EstimateCalcContextVersion;
  /**
   * TOUS les `item_type` (sections comprises), tries par `position` croissante.
   * Les sections sont indispensables a `computeAllSectionTotals` ; les
   * appelants qui ne veulent que les lignes filtrent en memoire.
   */
  items: EstimateItemRow[];
  /**
   * Bareme de marge du tenant. `[]` quand le tenant n'en a pas : c'est une
   * valeur significative, PAS un repli sur `getMarginTiers()`.
   */
  marginTiers: MarginTier[];
  isLaborSplitEnabled: boolean;
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
  calcEngineVersion: CalcEngineVersion;
};

export type LoadEstimateCalcContextOptions = {
  /** Pre-controle facultatif : le portail connait le tenant via son token. */
  expectedTenantId?: string;
};

function collectLaborRoleIds(items: EstimateItemRow[]): string[] {
  return Array.from(
    new Set(
      items
        .flatMap((item) => [
          item.labor_role_id,
          item.labor_role_atelier_id,
          item.labor_role_chantier_id,
        ])
        .filter((value): value is string => Boolean(value))
    )
  );
}

/**
 * Charge, en un seul endroit, tout ce dont le moteur de totaux a besoin pour
 * une version de devis : la ligne `estimate_versions`, ses `estimate_items`,
 * les taux horaires des roles de main-d'oeuvre references, le bareme de marge
 * du tenant, l'etat du flag `EST_031_LABOR_SPLIT` et la version du moteur de
 * calcul epinglee sur la version.
 *
 * Ce module ne CALCULE rien : il n'importe aucune fonction de
 * `@/lib/estimate-calculations`. C'est un pur chargeur.
 *
 * Le client Supabase est INJECTE : `createSupabaseServerClient` n'est jamais
 * appele ici, pour que la fonction reste utilisable par le portail (client
 * service-role), par `server.ts` et par `pdf-generator`, et testable hors
 * contexte de requete HTTP.
 *
 * ---------------------------------------------------------------------------
 * COMPORTEMENT CANONIQUE ARRETE, ET ECARTS ASSUMES
 *
 * Ce module n'a AUCUN appelant en phase A : il est cree et teste, mais aucun
 * des 5 sites de calcul n'est rebranche dessus. Les ecarts ci-dessous ne se
 * materialiseront donc QU'A LA PHASE B, au rebranchement — en phase A, le
 * comportement de l'application est strictement inchange.
 *
 * 1. `labor_roles` est filtre sur `tenant_id` et **PAS** sur `user_id`.
 *    `server.ts` (`recalculateEstimateVersionTotals`) est aujourd'hui le seul
 *    site a ajouter `.eq("user_id", project.user_id)` ; les 4 autres (page
 *    detail, page print, portail, `pdf-generator`) ne filtrent que par `id`.
 *    Adopter le filtre `user_id` ferait tomber des taux a 0 sur ces 4 sites ;
 *    l'abandonner fera au contraire REMONTER certains taux cote `server.ts`
 *    lorsque le role appartient a un autre utilisateur du meme tenant.
 *    C'est un changement de comportement connu, volontaire et DIFFERE A LA
 *    PHASE B.
 *
 * 2. `margin_tiers` est TOUJOURS charge, y compris en `margin_mode: "fixed"`
 *    (`server.ts` ne le charge qu'en `"tiered"`), pour que le contexte soit
 *    utilisable sans branche. Quand le tenant n'a pas de bareme, on renvoie
 *    `[]` et **on ne replie pas sur `getMarginTiers()`** : `computeEstimateTotals`
 *    le fait deja en interne, et un repli ici masquerait la divergence
 *    "bareme tenant vs `DEFAULT_MARGIN_TIERS`" que la phase B doit corriger.
 *    Ce point aussi ne change rien tant qu'aucun appelant n'est rebranche.
 *
 * 3. Erreurs : on converge sur le `throw` de `server.ts` / `pdf-generator`.
 *    Les pages qui appellent aujourd'hui `notFound()` de `next/navigation`
 *    devront attraper l'erreur a la phase B. En particulier, une erreur sur
 *    `labor_roles` fait echouer le chargement, alors que le portail continue
 *    aujourd'hui silencieusement avec des taux a 0.
 *
 * 4. Les 3 Map de taux sont alimentees depuis la MEME colonne
 *    `labor_roles.hourly_rate_cents` : les colonnes
 *    `hourly_rate_atelier_cents` / `hourly_rate_chantier_cents` n'existent pas
 *    en base. Elles sont malgre tout renvoyees separement pour que la phase B
 *    n'ait pas a changer de signature le jour ou elles divergeront.
 * ---------------------------------------------------------------------------
 *
 * @param supabase Client Supabase injecte (anon RLS ou service-role).
 * @param versionId Identifiant de la version de devis a charger.
 * @param options `expectedTenantId` : pre-controle facultatif du tenant.
 * @throws {ApiError} `NOT_FOUND` si la version est absente ou si son tenant ne
 *   correspond pas a `expectedTenantId` ; l'erreur mappee par
 *   `mapSupabaseError` sur toute erreur Supabase.
 */
export async function loadEstimateCalcContext(
  supabase: Supabase,
  versionId: string,
  options: LoadEstimateCalcContextOptions = {}
): Promise<EstimateCalcContext> {
  // --- Etape 1 : la version. Le tenant_id est lu SUR LA LIGNE puis propage a
  // toutes les requetes suivantes : c'est le seul schema qui fonctionne a la
  // fois avec un client anon (RLS) et avec un client service-role (portail).
  const versionResult = await supabase
    .from("estimate_versions")
    .select(ESTIMATE_CALC_CONTEXT_VERSION_COLUMNS)
    .eq("id", versionId)
    .single();

  if (versionResult.error) {
    throw mapSupabaseError(versionResult.error, LOAD_ERROR_MESSAGE);
  }

  if (!versionResult.data) {
    throw notFound("Version de devis introuvable.");
  }

  const version = versionResult.data as unknown as EstimateCalcContextVersion;
  const tenantId = version.tenant_id;

  if (options.expectedTenantId && options.expectedTenantId !== tenantId) {
    throw notFound("Version de devis introuvable.");
  }

  // --- Etapes 2, 4 et 5 en parallele (aucune ne depend des autres).
  const [itemsResult, marginTiersResult, isLaborSplitEnabled] = await Promise.all([
    // Etape 2 : superset des items, tri deterministe.
    supabase
      .from("estimate_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .order("position", { ascending: true }),
    // Etape 4 : bareme du tenant, charge sans condition sur margin_mode.
    supabase
      .from("margin_tiers")
      .select("threshold_cents, multiplier")
      .eq("tenant_id", tenantId)
      .order("threshold_cents", { ascending: true })
      .order("position", { ascending: true }),
    // Etape 5a : le flag, lu UNE SEULE FOIS (isFeatureEnabled est fail-closed
    // et sans cache).
    isFeatureEnabled(tenantId, ESTIMATE_LABOR_SPLIT_FLAG_KEY, { supabase }),
  ]);

  if (itemsResult.error) {
    throw mapSupabaseError(itemsResult.error, LOAD_ERROR_MESSAGE);
  }

  if (marginTiersResult.error) {
    throw mapSupabaseError(marginTiersResult.error, LOAD_ERROR_MESSAGE);
  }

  const items = (itemsResult.data ?? []) as EstimateItemRow[];
  const marginTiers: MarginTier[] = (marginTiersResult.data ?? []).map(
    (tier) => ({
      threshold_cents: tier.threshold_cents,
      multiplier: tier.multiplier,
    })
  );

  // --- Etape 3 : les taux horaires, apres l'etape 2 (elle en fournit les ids).
  const laborRoleIds = collectLaborRoleIds(items);
  const laborRateById = new Map<string, number>();

  if (laborRoleIds.length > 0) {
    const laborRolesResult = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      // Pas de filtre user_id : cf. point 1 du bloc de documentation ci-dessus.
      .eq("tenant_id", tenantId)
      .in("id", laborRoleIds);

    if (laborRolesResult.error) {
      throw mapSupabaseError(laborRolesResult.error, LOAD_ERROR_MESSAGE);
    }

    (laborRolesResult.data ?? []).forEach((role) => {
      laborRateById.set(role.id, role.hourly_rate_cents ?? 0);
    });
  }

  return {
    version,
    items,
    marginTiers,
    isLaborSplitEnabled,
    laborRateById,
    // Copies independantes : meme source aujourd'hui (cf. point 4), signature
    // deja prete pour le jour ou les taux atelier/chantier divergeront.
    laborRateAtelierById: new Map(laborRateById),
    laborRateChantierById: new Map(laborRateById),
    // Etape 5b : version du moteur epinglee sur la ligne.
    calcEngineVersion: resolveCalcEngineVersion(version),
  };
}
