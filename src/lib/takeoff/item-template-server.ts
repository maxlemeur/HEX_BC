import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { conflict, forbidden, internalError, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";
import {
  diffItemTemplateDefinitions,
  itemTemplateDefinitionFromTemplate,
  itemTemplateDefinitionSchema,
  itemTemplateFromDefinition,
  type ItemTemplateDefinition,
  type ItemTemplateKey,
} from "./item-template";
import { PLUMBING_TEMPLATE, type PosteTemplate } from "./plumbing-template";

type Service = SupabaseClient<Database>;

/** The definitions shipped with the application: a tenant that published none reads these. */
const SHIPPED: Record<ItemTemplateKey, PosteTemplate> = { plomberie: PLUMBING_TEMPLATE };

export type PublishedItemTemplate = {
  key: ItemTemplateKey;
  version: number;
  /**
   * Every line identifier the template ever used (this version's, the earlier versions', the shipped one's): a line
   * added later never takes one of them, so that an item never follows a retired line without a decision.
   */
  usedLineIds: string[];
  /** Null for the definition shipped with the application. */
  publicationId: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  definition: ItemTemplateDefinition;
  template: PosteTemplate;
};

/** The line identifiers of the shipped definition, which the database cannot know: the server names them. */
export function shippedItemTemplateLineIds(key: ItemTemplateKey) {
  return SHIPPED[key].families.flatMap(({ lines }) => lines.map(({ id }) => id));
}

function shipped(key: ItemTemplateKey): PublishedItemTemplate {
  const template = SHIPPED[key];
  return { key, version: template.version, usedLineIds: shippedItemTemplateLineIds(key), publicationId: null,
    publishedAt: null, publishedBy: null, definition: itemTemplateDefinitionFromTemplate(template), template };
}

/** The latest version a tenant published, else the shipped one. A stored definition that no longer reads fails loudly. */
export async function readPublishedItemTemplate(service: Service, tenantId: string, key: ItemTemplateKey): Promise<PublishedItemTemplate> {
  const { data, error } = await service.from("takeoff_item_template_versions")
    .select("id, version, definition, used_line_ids, published_at, published_by")
    .eq("tenant_id", tenantId).eq("template_key", key).order("version", { ascending: false }).limit(1);
  if (error) throw mapSupabaseError(error, "Impossible de lire le gabarit de l’entreprise.");
  const [row] = data;
  if (!row) return shipped(key);
  const parsed = itemTemplateDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) throw internalError("Le gabarit publié de l’entreprise est illisible.");
  return {
    key, version: row.version, usedLineIds: row.used_line_ids, publicationId: row.id, publishedAt: row.published_at,
    publishedBy: row.published_by, definition: parsed.data,
    template: itemTemplateFromDefinition({ key, version: row.version, publicationId: row.id, definition: parsed.data }),
  };
}

/** A draft and its token: what a later save, discard or publication names (renewed at each save, never reused). */
export type ItemTemplateDraft = {
  revision: number; token: string; baseVersion: number; definition: ItemTemplateDefinition; updatedAt: string;
};

export type ItemTemplateAdministration = {
  published: Omit<PublishedItemTemplate, "template">;
  draft: ItemTemplateDraft | null;
  /** The draft against the published version: what publishing it adds, removes and changes. */
  diff: ReturnType<typeof diffItemTemplateDefinitions> | null;
};

async function requireTemplateAdministrator() {
  const context = await getAuthenticatedContext();
  if (context.tenantRole !== "admin") {
    throw forbidden("Seul un administrateur de l’entreprise modifie et publie le gabarit.");
  }
  return context;
}

export async function loadItemTemplateAdministration(key: ItemTemplateKey): Promise<ItemTemplateAdministration> {
  const context = await requireTemplateAdministrator();
  const service = createServiceRoleClient();
  const [published, draftRead] = await Promise.all([
    readPublishedItemTemplate(service, context.tenantId, key),
    service.from("takeoff_item_template_drafts").select("revision, token, base_version, definition, updated_at")
      .eq("tenant_id", context.tenantId).eq("template_key", key).maybeSingle(),
  ]);
  if (draftRead.error) throw mapSupabaseError(draftRead.error, "Impossible de lire le brouillon du gabarit.");
  const parsed = draftRead.data ? itemTemplateDefinitionSchema.safeParse(draftRead.data.definition) : null;
  const draft = draftRead.data && parsed?.success ? {
    revision: draftRead.data.revision, token: draftRead.data.token, baseVersion: draftRead.data.base_version,
    definition: parsed.data, updatedAt: draftRead.data.updated_at,
  } : null;
  return {
    published: { key: published.key, version: published.version, usedLineIds: published.usedLineIds,
      publicationId: published.publicationId,
      publishedAt: published.publishedAt, publishedBy: published.publishedBy, definition: published.definition },
    draft, diff: draft ? diffItemTemplateDefinitions(published.definition, draft.definition) : null,
  };
}

/** The refusals of the template's functions, by their own code: a fixed French answer, never the database's text. */
function templateWriteFailure(error: { code?: string; message?: string }): never {
  const message = error.message ?? "";
  if (message.includes("TAKEOFF_ITEM_TEMPLATE_FORBIDDEN")) {
    throw forbidden("Seul un administrateur de l’entreprise modifie et publie le gabarit.");
  }
  if (message.includes("TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE") || message.includes("TAKEOFF_ITEM_TEMPLATE_STALE")) {
    throw conflict("Le gabarit a changé depuis votre lecture : rechargez la page avant d’enregistrer.", undefined,
      "TAKEOFF_ITEM_TEMPLATE_STALE");
  }
  if (message.includes("TAKEOFF_ITEM_TEMPLATE_INTENT_CONFLICT")) {
    throw conflict("Cette publication a déjà été faite avec un autre brouillon : rechargez la page.", undefined,
      "TAKEOFF_ITEM_TEMPLATE_INTENT_CONFLICT");
  }
  if (message.includes("TAKEOFF_ITEM_TEMPLATE_LINE_REUSED")) {
    throw unprocessableEntity("Un poste ajouté reprend l’identifiant d’un poste retiré : donnez-lui un nouvel identifiant.",
      undefined, "TAKEOFF_ITEM_TEMPLATE_LINE_REUSED");
  }
  if (message.includes("TAKEOFF_ITEM_TEMPLATE_INVALID")) {
    throw unprocessableEntity("Le gabarit n’est pas valide : vérifiez les postes et leurs identifiants.", undefined,
      "TAKEOFF_ITEM_TEMPLATE_INVALID");
  }
  throw internalError("Impossible d’enregistrer le gabarit.");
}

/**
 * Save the draft the administrator edits: the token of the draft it replaces (null for none) and the published version
 * its form started from. A publication, a discard or another save in between refuses, so that a correction never
 * reverts or overwrites one it did not see.
 */
export async function saveItemTemplateDraft(key: ItemTemplateKey, input: {
  expectedToken: string | null; baseVersion: number; definition: unknown;
}) {
  const context = await requireTemplateAdministrator();
  const parsed = itemTemplateDefinitionSchema.safeParse(input.definition);
  if (!parsed.success) {
    throw unprocessableEntity(parsed.error.issues[0]?.message ?? "Le gabarit n’est pas valide.",
      { issues: parsed.error.issues.slice(0, 20).map(({ path, message }) => ({ path, message })) }, "TAKEOFF_ITEM_TEMPLATE_INVALID");
  }
  const service = createServiceRoleClient();
  // Without a publication the database cannot know the shipped version: the server checks it (the database checks a
  // published one again under its lock).
  const published = await readPublishedItemTemplate(service, context.tenantId, key);
  if (input.baseVersion !== published.version) {
    throw conflict("Le gabarit a changé depuis votre lecture : rechargez la page avant d’enregistrer.", undefined,
      "TAKEOFF_ITEM_TEMPLATE_STALE");
  }
  const { data, error } = await service.rpc("save_takeoff_item_template_draft", {
    p_tenant_id: context.tenantId, p_actor: context.userId, p_template_key: key,
    p_expected_token: input.expectedToken as string, p_base_version: input.baseVersion,
    p_definition: parsed.data as unknown as Json, p_shipped_line_ids: shippedItemTemplateLineIds(key),
  });
  if (error) templateWriteFailure(error);
  const [saved] = (data ?? []) as Array<{ revision: number; token: string }>;
  if (!saved) throw internalError("Impossible d’enregistrer le gabarit.");
  return { revision: saved.revision, token: saved.token };
}

export async function discardItemTemplateDraft(key: ItemTemplateKey, input: { expectedToken: string }) {
  const context = await requireTemplateAdministrator();
  const { error } = await createServiceRoleClient().rpc("discard_takeoff_item_template_draft", {
    p_tenant_id: context.tenantId, p_actor: context.userId, p_template_key: key, p_expected_token: input.expectedToken,
  });
  if (error) templateWriteFailure(error);
  return { discarded: true };
}

export async function publishItemTemplate(key: ItemTemplateKey, input: { expectedToken: string; intentKey: string }) {
  const context = await requireTemplateAdministrator();
  const { data, error } = await createServiceRoleClient().rpc("publish_takeoff_item_template", {
    p_tenant_id: context.tenantId, p_actor: context.userId, p_template_key: key,
    p_expected_token: input.expectedToken, p_intent_key: input.intentKey, p_shipped_line_ids: shippedItemTemplateLineIds(key),
  });
  if (error) templateWriteFailure(error);
  const [published] = (data ?? []) as Array<{ version_id: string; version: number; replayed: boolean }>;
  if (!published) throw internalError("Impossible de publier le gabarit.");
  return { versionId: published.version_id, version: published.version, replayed: published.replayed };
}
