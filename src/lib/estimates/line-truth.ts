type EstimateLineTruthSourceKind =
  | "manual"
  | "dpgf"
  | "plan"
  | "brief"
  | "cctp"
  | "assembly"
  | "mixed"
  | "unknown";

export type EstimateLineTruthQtyStatus =
  | "imported_unverified"
  | "measured"
  | "assumed"
  | "provisional"
  | "to_confirm"
  | "missing";

export type EstimateLineTruthConfidenceLabel = "faible" | "moyenne" | "forte";

export type EstimateLineTruth = {
  source: {
    kind: EstimateLineTruthSourceKind;
    label: string;
    detail: string | null;
  };
  qtyStatus: {
    code: EstimateLineTruthQtyStatus;
    label: string;
    detail: string | null;
  };
  confidence: {
    label: EstimateLineTruthConfidenceLabel;
    score: number | null;
    detail: string | null;
  };
  needsReview: boolean;
};

type EstimateLineTruthCarrier = {
  item_type?: "section" | "line" | null;
  quantity?: number | null;
  source_provider?: string | null;
  source_file_name?: string | null;
  source_level?: string | null;
  source_metadata?: unknown;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampConfidenceScore(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.min(1, Math.max(0, value));
}

function toConfidenceLabel(score: number): EstimateLineTruthConfidenceLabel {
  if (score >= 0.75) {
    return "forte";
  }
  if (score >= 0.45) {
    return "moyenne";
  }
  return "faible";
}

function formatConfidenceDetail(
  label: EstimateLineTruthConfidenceLabel,
  score: number | null
) {
  if (score === null) {
    return `Confiance ${label}.`;
  }

  return `Confiance ${label} (${Math.round(score * 100)}%).`;
}

function normalizeProvider(value: unknown) {
  return toNonEmptyString(value)?.toLowerCase() ?? null;
}

function normalizeTakeoffLevel(value: unknown) {
  const normalized = toNonEmptyString(value)?.toUpperCase() ?? null;
  if (normalized === "A" || normalized === "B" || normalized === "C") {
    return normalized;
  }

  const matched = normalized?.match(/(?:NIVEAU|LEVEL)[\s:_-]*([ABC])\b/);
  const level = matched?.[1] ?? null;
  return level === "A" || level === "B" || level === "C" ? level : null;
}

function readMetadataConfidence(metadata: unknown): number | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const directConfidence = clampConfidenceScore(
    toFiniteNumber(metadata.confidence) ?? toFiniteNumber(metadata.confidence_score)
  );
  if (directConfidence !== null) {
    return directConfidence;
  }

  const summary = isRecord(metadata.subdetail_summary) ? metadata.subdetail_summary : null;
  const summaryConfidence = clampConfidenceScore(toFiniteNumber(summary?.confidence));
  if (summaryConfidence !== null) {
    return summaryConfidence;
  }

  const applications = Array.isArray(metadata.applications) ? metadata.applications : [];
  for (const application of applications) {
    if (!isRecord(application)) {
      continue;
    }

    const confidence = clampConfidenceScore(
      toFiniteNumber(application.confidence) ?? toFiniteNumber(application.confidence_score)
    );
    if (confidence !== null) {
      return confidence;
    }
  }

  return null;
}

function readMetadataProvenanceTypes(metadata: unknown) {
  if (!isRecord(metadata) || !Array.isArray(metadata.applications)) {
    return new Set<string>();
  }

  const types = new Set<string>();

  metadata.applications.forEach((application) => {
    if (!isRecord(application) || !Array.isArray(application.provenance)) {
      return;
    }

    application.provenance.forEach((entry) => {
      if (!isRecord(entry)) {
        return;
      }

      const type = toNonEmptyString(entry.type)?.toLowerCase();
      if (type) {
        types.add(type);
      }
    });
  });

  return types;
}

function resolveSource(input: {
  provider: string | null;
  fileName: string | null;
  metadata: unknown;
}) {
  const { provider, fileName, metadata } = input;
  const provenanceTypes = readMetadataProvenanceTypes(metadata);

  switch (provider) {
    case "manual":
      return {
        kind: "manual" as const,
        label: "Saisie manuelle",
        detail: "Ligne saisie ou reprise manuellement, sans provenance documentaire explicite.",
      };
    case "dpgf":
      return {
        kind: "dpgf" as const,
        label: "DPGF importee",
        detail: fileName
          ? `Quantite reprise depuis ${fileName}.`
          : "Quantite reprise depuis la DPGF importee.",
      };
    case "takeoff":
    case "takeoff_gemini":
      return {
        kind: "plan" as const,
        label: "Plan / metre",
        detail: fileName
          ? `Quantite issue d'un metre sur plans depuis ${fileName}.`
          : "Quantite issue d'un metre sur plans.",
      };
    case "generated_ouvrage":
      return {
        kind: "assembly" as const,
        label: "Assemblage",
        detail: "Quantite issue d'un ouvrage compose ou d'un assemblage IA.",
      };
    case "version_zero_draft":
      return {
        kind: "brief" as const,
        label: "Brief confirme",
        detail: "Quantite issue d'une V0 materialisee a partir du brief confirme.",
      };
    case "ai_structure":
      if (provenanceTypes.has("brief") && provenanceTypes.has("cctp")) {
        return {
          kind: "mixed" as const,
          label: "Brief + CCTP",
          detail: "Structure preliminaire issue du brief confirme et du CCTP principal.",
        };
      }
      if (provenanceTypes.has("cctp")) {
        return {
          kind: "cctp" as const,
          label: "CCTP",
          detail: "Structure preliminaire issue du CCTP principal.",
        };
      }
      if (provenanceTypes.has("brief")) {
        return {
          kind: "brief" as const,
          label: "Brief confirme",
          detail: "Structure preliminaire issue du brief confirme.",
        };
      }
      return {
        kind: "mixed" as const,
        label: "Structure IA",
        detail: "Structure preliminaire issue d'une consolidation IA explicable.",
      };
    default:
      return {
        kind: "unknown" as const,
        label: "Source a confirmer",
        detail: "La provenance de cette ligne n'est pas encore normalisee.",
      };
  }
}

function resolveQtyStatus(input: {
  quantity: number | null;
  provider: string | null;
}): EstimateLineTruth["qtyStatus"] {
  if (input.quantity === null) {
    return {
      code: "missing",
      label: "Qte manquante",
      detail: "Aucune quantite n'est renseignee sur cette ligne.",
    };
  }

  switch (input.provider) {
    case "takeoff":
    case "takeoff_gemini":
      return {
        code: "measured",
        label: "Qte metree",
        detail: "Quantite issue d'un metre sur plans.",
      };
    case "dpgf":
      return {
        code: "imported_unverified",
        label: "Qte importee non verifiee",
        detail: "Quantite reprise du DPGF sans verification sur plans.",
      };
    case "generated_ouvrage":
      return {
        code: "provisional",
        label: "Qte provisionnelle",
        detail: "Quantite composee ou estimee pour un ouvrage provisoire.",
      };
    case "manual":
    case "ai_structure":
    case "version_zero_draft":
      return {
        code: "assumed",
        label: "Qte supposee",
        detail: "Quantite issue d'une base amont ou d'une hypothese de travail.",
      };
    default:
      return {
        code: "to_confirm",
        label: "Qte a confirmer",
        detail: "Quantite renseignee mais encore a confirmer.",
      };
  }
}

function resolveConfidence(input: {
  quantity: number | null;
  provider: string | null;
  sourceLevel: string | null;
  metadata: unknown;
}): EstimateLineTruth["confidence"] {
  if (input.quantity === null) {
    return {
      label: "faible",
      score: null,
      detail: "Confiance faible tant que la quantite n'est pas renseignee.",
    };
  }

  const metadataScore = readMetadataConfidence(input.metadata);
  if (metadataScore !== null) {
    const label = toConfidenceLabel(metadataScore);
    return {
      label,
      score: metadataScore,
      detail: formatConfidenceDetail(label, metadataScore),
    };
  }

  const level = normalizeTakeoffLevel(input.sourceLevel);
  if (input.provider === "takeoff" || input.provider === "takeoff_gemini") {
    const levelScore = level === "A" ? 0.92 : level === "B" ? 0.68 : 0.42;
    const label = toConfidenceLabel(levelScore);
    return {
      label,
      score: levelScore,
      detail: `Confiance ${label} issue du niveau ${level ?? "non renseigne"} du metre.`,
    };
  }

  const fallbackScore =
    input.provider === "dpgf"
      ? 0.6
      : input.provider === "manual"
        ? 0.55
        : input.provider === "generated_ouvrage"
          ? 0.5
          : input.provider === "version_zero_draft"
            ? 0.5
            : input.provider === "ai_structure"
              ? 0.42
              : 0.4;
  const label = toConfidenceLabel(fallbackScore);

  return {
    label,
    score: fallbackScore,
    detail: formatConfidenceDetail(label, fallbackScore),
  };
}

export function resolveEstimateLineTruth(
  item: EstimateLineTruthCarrier
): EstimateLineTruth | null {
  if (item.item_type === "section") {
    return null;
  }

  const provider = normalizeProvider(item.source_provider) ?? "manual";
  const fileName = toNonEmptyString(item.source_file_name);
  const quantity = toFiniteNumber(item.quantity);
  const source = resolveSource({
    provider,
    fileName,
    metadata: item.source_metadata,
  });
  const qtyStatus = resolveQtyStatus({
    quantity,
    provider,
  });
  const confidence = resolveConfidence({
    quantity,
    provider,
    sourceLevel: toNonEmptyString(item.source_level),
    metadata: item.source_metadata,
  });

  return {
    source,
    qtyStatus,
    confidence,
    needsReview:
      qtyStatus.code !== "measured" ||
      confidence.label === "faible" ||
      source.kind === "unknown",
  };
}
