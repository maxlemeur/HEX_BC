import { z } from "zod";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import * as durableIntake from "@/lib/workflows/affaire-intake-lifecycle";
import {
  isAffaireIntakeCadDocument,
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  affaireIntakeBriefDraftSchema,
  normalizeAffaireIntakeTextList,
  type AffaireIntakeBriefBlockKey,
  type AffaireIntakeBriefDraft,
  type AffaireIntakeBriefStatus,
  type AffaireIntakeWorkspaceMissingPiece,
} from "@/lib/affaires/intake";
import type { AffaireAccessProject } from "@/lib/affaires/access-server";
import type { AffaireIntakeDocumentRow } from "@/lib/affaires/intake-rows";
import { getSafeProviderErrorCode } from "@/lib/affaires/intake-classification";

export const AFFAIRE_BRIEF_PROMPT_VERSION = "dos01_affaire_brief_v2";
const AFFAIRE_BRIEF_MODEL = "gemini-3-flash-preview";

const affaireBriefEntrySchema = z
  .object({
    text: z.string().trim().min(1).max(320),
    sourceDocumentIds: z.array(z.string().uuid()).max(6).default([]),
  })
  .strict();

const affaireBriefGenerationSchema = z
  .object({
    summary: affaireBriefEntrySchema,
    projectObject: affaireBriefEntrySchema,
    scope: z.array(affaireBriefEntrySchema).max(12),
    lots: z.array(affaireBriefEntrySchema).max(20),
    receivedPieces: z.array(affaireBriefEntrySchema).max(20),
    assumptions: z.array(affaireBriefEntrySchema).max(12),
    vigilancePoints: z.array(affaireBriefEntrySchema).max(12),
    missingElements: z.array(affaireBriefEntrySchema).max(12),
  })
  .strict();

type AffaireBriefEntry = z.infer<typeof affaireBriefEntrySchema>;
type AffaireBriefGeneration = z.infer<typeof affaireBriefGenerationSchema>;

type AffaireBriefGenerationDocument = Pick<
  AffaireIntakeDocumentRow,
  "id" | "file_name" | "document_kind" | "confidence" | "issues" | "extracted_metadata"
>;

function pickPrimaryMetadataValue(
  documents: AffaireBriefGenerationDocument[],
  selector: (document: AffaireBriefGenerationDocument) => string | null
) {
  const counts = new Map<string, number>();

  for (const document of documents) {
    const value = selector(document)?.trim();
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "fr"))
    .at(0)?.[0] ?? null;
}

function pickEarliestDeadline(documents: AffaireBriefGenerationDocument[]) {
  const deadlines = documents
    .map((document) => document.extracted_metadata.deadlineAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  return deadlines[0]?.toISOString() ?? null;
}

function pickDocumentIdsForBrief(
  documents: AffaireBriefGenerationDocument[],
  predicate: (document: AffaireBriefGenerationDocument) => boolean,
  limit = 4
) {
  return documents
    .filter(predicate)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, limit)
    .map((document) => document.id);
}

function createBriefEntry(
  text: string,
  sourceDocumentIds: string[]
): AffaireBriefEntry {
  return affaireBriefEntrySchema.parse({
    text,
    sourceDocumentIds,
  });
}

function buildReceivedPiecesEntries(
  documents: AffaireBriefGenerationDocument[]
) {
  return documents.map((document) =>
    createBriefEntry(
      `${AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[document.document_kind]} · ${document.file_name}`,
      [document.id]
    )
  );
}

function buildFallbackAffaireBrief(input: {
  project: AffaireAccessProject;
  uploadId: string;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}): AffaireBriefGeneration {
  const projectName =
    pickPrimaryMetadataValue(
      input.documents,
      (document) => document.extracted_metadata.projectName
    ) ?? input.project.name;
  const clientName = pickPrimaryMetadataValue(
    input.documents,
    (document) => document.extracted_metadata.clientName
  ) ?? input.project.client_name;
  const earliestDeadline = pickEarliestDeadline(input.documents);
  const lots = normalizeAffaireIntakeTextList(
    input.documents.flatMap((document) => document.extracted_metadata.detectedLots),
    {
      maxItems: 20,
      maxLength: 160,
    }
  );
  const reviewDocuments = input.documents.filter(
    (document) => document.document_kind === "a_classer" || (document.confidence ?? 0) < 0.65
  );
  const scopeEntries: AffaireBriefEntry[] = [];
  const assumptionEntries: AffaireBriefEntry[] = [];
  const vigilanceEntries: AffaireBriefEntry[] = [];
  const missingEntries: AffaireBriefEntry[] = [];

  if (lots.length > 0) {
    for (const lot of lots.slice(0, 8)) {
      scopeEntries.push(
        createBriefEntry(
          `Le dossier couvre le lot ${lot}.`,
          pickDocumentIdsForBrief(input.documents, (document) =>
            document.extracted_metadata.detectedLots.includes(lot)
          )
        )
      );
    }
  } else {
    scopeEntries.push(
      createBriefEntry(
        "Le perimetre détaillé reste à confirmer à partir des pièces reçues.",
        []
      )
    );
  }

  if (clientName) {
    scopeEntries.unshift(
      createBriefEntry(
        `Le projet semble porte pour ${clientName}.`,
        pickDocumentIdsForBrief(
          input.documents,
          (document) => document.extracted_metadata.clientName === clientName
        )
      )
    );
  }

  if (earliestDeadline) {
    vigilanceEntries.push(
      createBriefEntry(
        `Une échéance explicite a été détectée pour le ${new Date(earliestDeadline).toLocaleDateString("fr-FR")}.`,
        pickDocumentIdsForBrief(
          input.documents,
          (document) => document.extracted_metadata.deadlineAt === earliestDeadline
        )
      )
    );
  }

  if (reviewDocuments.length > 0) {
    vigilanceEntries.push(
      createBriefEntry(
        `${reviewDocuments.length} pièce(s) doivent encore être confirmées ou reclassifiees avant cadrage final.`,
        reviewDocuments.map((document) => document.id).slice(0, 6)
      )
    );
  }

  if (!clientName) {
    assumptionEntries.push(
      createBriefEntry(
        "Le client ou maitre d'ouvrage reste a confirmer humainement.",
        []
      )
    );
  }

  if (lots.length === 0) {
    assumptionEntries.push(
      createBriefEntry(
        "Les lots concernes doivent etre verifies avant lancement du chiffrage detaille.",
        []
      )
    );
  }

  for (const piece of input.missingPieces) {
    missingEntries.push(
      createBriefEntry(
        piece.label,
        []
      )
    );
  }

  for (const document of reviewDocuments.slice(0, 6)) {
    const issue = document.issues[0] ?? "Classification à confirmer.";
    missingEntries.push(createBriefEntry(issue, [document.id]));
  }

  const receivedPieces = buildReceivedPiecesEntries(input.documents).slice(0, 20);
  const projectSourceIds = pickDocumentIdsForBrief(
    input.documents,
    (document) =>
      Boolean(document.extracted_metadata.projectName) ||
      Boolean(document.extracted_metadata.clientName) ||
      document.extracted_metadata.detectedLots.length > 0,
    6
  );
  const summaryParts = [
    `Brief provisoire du dossier ${projectName}.`,
    clientName ? `Client detecte: ${clientName}.` : "Client à confirmer.",
    `${input.documents.length} pièce(s) ont été retenues dans l'intake.`,
    lots.length > 0
      ? `${lots.length} lot(s) ont été identifies.`
      : "Le lotissement reste à préciser.",
  ];

  return affaireBriefGenerationSchema.parse({
    summary: createBriefEntry(summaryParts.join(" "), projectSourceIds),
    projectObject: createBriefEntry(
      lots.length > 0
        ? `${projectName} · lots ${lots.slice(0, 4).join(", ")}`
        : `${projectName} · perimetre à confirmer`,
      projectSourceIds
    ),
    scope: scopeEntries.slice(0, 12),
    lots: lots
      .slice(0, 20)
      .map((lot) =>
        createBriefEntry(
          lot,
          pickDocumentIdsForBrief(input.documents, (document) =>
            document.extracted_metadata.detectedLots.includes(lot)
          )
        )
      ),
    receivedPieces,
    assumptions: assumptionEntries.slice(0, 12),
    vigilancePoints: vigilanceEntries.slice(0, 12),
    missingElements: missingEntries.slice(0, 12),
  });
}

function buildBriefGenerationPrompt(input: {
  project: AffaireAccessProject;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}) {
  return [
    "RÔLE",
    "Tu produis un brief affaire BTP à partir d'un workspace d'intake déjà classe.",
    "",
    "CONTRAINTE",
    "Retourne uniquement un JSON strict conforme au schema fourni.",
    "Chaque entrée doit reutiliser uniquement les sourceDocumentIds presents dans l'inventaire.",
    "Un lien documentaire n'est pas une citation verifiee. N'attribue un document que si ses metadonnees etayent directement l'entree.",
    "N'invente ni document, ni lot, ni client, ni échéance.",
    "Le ton doit être professionnel, concis et exploitable par un chiffreur ou une validatrice.",
    "",
    "PROMPT_VERSION",
    AFFAIRE_BRIEF_PROMPT_VERSION,
    "",
    "PROJET",
    JSON.stringify(
      {
        projectId: input.project.id,
        projectName: input.project.name,
        projectReference: input.project.reference,
        clientName: input.project.client_name,
        ownerUserId: input.project.user_id,
      },
      null,
      2
    ),
    "",
    "INVENTAIRE_DOCUMENTS",
    JSON.stringify(
      input.documents.map((document) => ({
        documentId: document.id,
        fileName: document.file_name,
        detectedCategory: document.document_kind,
        confidence: document.confidence,
        extractedMetadata: document.extracted_metadata,
        issues: document.issues,
      })),
      null,
      2
    ),
    "",
    "PIECES_MANQUANTES",
    JSON.stringify(input.missingPieces, null, 2),
    "",
    "REGLES_METIER",
    "1. summary et projectObject doivent être une phrase courte et lisible.",
    "2. receivedPieces doit lister les pièces reçues sans omettre une catégorie importante.",
    "3. assumptions et vigilancePoints doivent mettre en evidence les zones grises, sans dramatiser.",
    "4. missingElements doit reprendre les vrais manques ou doutes encore ouverts.",
    "5. Quand aucune source documentaire directe n'est disponible pour une entrée, retourne sourceDocumentIds: []. Ne remplace jamais une preuve absente par une piece proche.",
  ].join("\n");
}

function sanitizeEntrySourceDocumentIds(
  sourceDocumentIds: ReadonlyArray<string>,
  validDocumentIds: Set<string>
) {
  return normalizeAffaireIntakeTextList(
    sourceDocumentIds.map((value) => (validDocumentIds.has(value) ? value : null)),
    {
      maxItems: 6,
      maxLength: 64,
    }
  );
}

function sanitizeBriefEntry(
  entry: AffaireBriefEntry | null | undefined,
  fallbackEntry: AffaireBriefEntry,
  validDocumentIds: Set<string>
) {
  const selectedEntry = entry && typeof entry.text === "string" && entry.text.trim().length > 0
    ? entry
    : fallbackEntry;

  return createBriefEntry(
    selectedEntry.text,
    sanitizeEntrySourceDocumentIds(
      selectedEntry.sourceDocumentIds,
      validDocumentIds
    )
  );
}

function sanitizeBriefEntryArray(
  entries: ReadonlyArray<AffaireBriefEntry> | null | undefined,
  fallbackEntries: ReadonlyArray<AffaireBriefEntry>,
  validDocumentIds: Set<string>
) {
  if (!entries || entries.length === 0) {
    return fallbackEntries.map((entry) => sanitizeBriefEntry(entry, entry, validDocumentIds));
  }

  return Array.from({
    length:
      fallbackEntries.length > 0
        ? Math.max(entries.length, fallbackEntries.length)
        : entries.length,
  })
    .map((_, index) =>
      sanitizeBriefEntry(
        entries[index],
        fallbackEntries[index] ?? fallbackEntries[0] ?? createBriefEntry("Source à confirmer.", []),
        validDocumentIds
      )
    );
}

export function mergeGeneratedAffaireBriefWithFallback(input: {
  generated: AffaireBriefGeneration | null;
  fallback: AffaireBriefGeneration;
  documents: AffaireBriefGenerationDocument[];
}): AffaireBriefGeneration {
  const validDocumentIds = new Set(input.documents.map((document) => document.id));
  const generated = input.generated;

  return affaireBriefGenerationSchema.parse({
    summary: sanitizeBriefEntry(generated?.summary, input.fallback.summary, validDocumentIds),
    projectObject: sanitizeBriefEntry(
      generated?.projectObject,
      input.fallback.projectObject,
      validDocumentIds
    ),
    scope: sanitizeBriefEntryArray(
      generated?.scope,
      input.fallback.scope,
      validDocumentIds
    )
      .slice(0, 12),
    lots: sanitizeBriefEntryArray(
      generated?.lots,
      input.fallback.lots,
      validDocumentIds
    )
      .slice(0, 20),
    receivedPieces: sanitizeBriefEntryArray(null, input.fallback.receivedPieces, validDocumentIds),
    assumptions: sanitizeBriefEntryArray(
      generated?.assumptions,
      input.fallback.assumptions,
      validDocumentIds
    )
      .slice(0, 12),
    vigilancePoints: sanitizeBriefEntryArray(
      generated?.vigilancePoints,
      input.fallback.vigilancePoints,
      validDocumentIds
    )
      .slice(0, 12),
    missingElements: sanitizeBriefEntryArray(
      generated?.missingElements,
      input.fallback.missingElements,
      validDocumentIds
    )
      .slice(0, 12),
  });
}

function buildBriefSourcesFromGeneration(
  generation: AffaireBriefGeneration,
  documents: AffaireBriefGenerationDocument[]
) {
  const documentsById = new Map(
    documents.map((document) => [document.id, document.file_name] as const)
  );
  const sources: AffaireIntakeBriefDraft["sources"] = [];
  const pushSources = (
    blockKey: AffaireIntakeBriefBlockKey,
    entryIndex: number,
    entry: AffaireBriefEntry
  ) => {
    for (const sourceDocumentId of entry.sourceDocumentIds) {
      const sourceFileName = documentsById.get(sourceDocumentId);
      if (!sourceFileName) {
        continue;
      }

      sources.push({
        blockKey,
        entryIndex,
        sourceDocumentId,
        sourceFileName,
        rationale: null,
      });
    }
  };

  pushSources("summary", 0, generation.summary);
  pushSources("project_object", 0, generation.projectObject);
  generation.scope.forEach((entry, index) => pushSources("scope", index, entry));
  generation.lots.forEach((entry, index) => pushSources("lots", index, entry));
  generation.receivedPieces.forEach((entry, index) =>
    pushSources("received_pieces", index, entry)
  );
  generation.assumptions.forEach((entry, index) =>
    pushSources("assumptions", index, entry)
  );
  generation.vigilancePoints.forEach((entry, index) =>
    pushSources("vigilance_points", index, entry)
  );
  generation.missingElements.forEach((entry, index) =>
    pushSources("missing_elements", index, entry)
  );

  return sources;
}

function toAffaireBriefDraft(input: {
  generation: AffaireBriefGeneration;
  uploadId: string;
  status: AffaireIntakeBriefStatus;
  lastGeneratedAt: string;
  confirmedAt: string | null;
  documents: AffaireBriefGenerationDocument[];
}): AffaireIntakeBriefDraft {
  return affaireIntakeBriefDraftSchema.parse({
    status: input.status,
    summary: input.generation.summary.text,
    projectObject: input.generation.projectObject.text,
    scope: input.generation.scope.map((entry) => entry.text),
    lots: input.generation.lots.map((entry) => entry.text),
    receivedPieces: input.generation.receivedPieces.map((entry) => entry.text),
    assumptions: input.generation.assumptions.map((entry) => entry.text),
    vigilancePoints: input.generation.vigilancePoints.map((entry) => entry.text),
    missingElements: input.generation.missingElements.map((entry) => entry.text),
    sources: buildBriefSourcesFromGeneration(input.generation, input.documents),
    uploadId: input.uploadId,
    lastGeneratedAt: input.lastGeneratedAt,
    confirmedAt: input.confirmedAt,
  });
}

export async function generateAffaireBriefDraft(input: {
  project: AffaireAccessProject;
  uploadId: string;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
  renewLease?: () => Promise<void>;
  aiOwner?: ChatGptOwner | null;
}): Promise<AffaireIntakeBriefDraft> {
  const fallback = buildFallbackAffaireBrief({
    project: input.project,
    uploadId: input.uploadId,
    documents: input.documents,
    missingPieces: input.missingPieces,
  });

  const aiDocuments = input.documents.filter((document) => !isAffaireIntakeCadDocument(document.file_name));
  let generated: AffaireBriefGeneration | null = null;

  try {
    if (aiDocuments.length > 0) {
      const result = await durableIntake.runAffaireIntakeLeasedProviderEffect({
        renewLease: input.renewLease ?? (async () => undefined),
        effect: () => callStructuredAi({
          prompt: buildBriefGenerationPrompt({
            project: input.project,
            documents: aiDocuments,
            missingPieces: input.missingPieces,
          }),
          schema: affaireBriefGenerationSchema,
          beforeSend: input.renewLease,
          context: { model: AFFAIRE_BRIEF_MODEL, promptVersion: AFFAIRE_BRIEF_PROMPT_VERSION },
        }, input.aiOwner),
      });

      generated = result.data;
    }
  } catch (error) {
    if (!(error instanceof durableIntake.AffaireIntakeProviderCallError)) throw error;
    console.error("Affaire brief AI generation failed", { projectId: input.project.id, uploadId: input.uploadId, error_code: getSafeProviderErrorCode(error.cause) });
  }

  const generation = mergeGeneratedAffaireBriefWithFallback({
    generated,
    fallback,
    documents: input.documents,
  });
  const lastGeneratedAt = new Date().toISOString();

  return toAffaireBriefDraft({
    generation,
    uploadId: input.uploadId,
    status: "a_confirmer",
    lastGeneratedAt,
    confirmedAt: null,
    documents: input.documents,
  });
}
