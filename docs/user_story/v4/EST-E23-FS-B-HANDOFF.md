# V3-010 / EST-E23 FS-B -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-B

FS-B porte les contrats backend pour :

- `V3-010` comparaison DPGF vs takeoff preuve-centrique
- `EST-391` evidence graph par ligne
- `EST-393` radar de risque explicable par affaire / lot / ligne
- `EST-392` suggestion de prix avec fourchette et sources

Ces surfaces doivent etre deleguees a une equipe UX.

## Backend contract cible

### 1) Compare DPGF / takeoff

Server fetcher:
```ts
fetchDpgfTakeoffComparison(input: {
  projectId: string;
  versionId: string;
  takeoffJobId?: string | null;
  view: "all" | "exceptions_only";
}): Promise<{
  summary: {
    reliableMatches: number;
    toConfirm: number;
    significantGaps: number;
    forcedManual: number;
    linesWithoutProof: number;
    unusedTakeoffItems: number;
  };
  rows: Array<{
    lineId: string;
    lineLabel: string;
    dpgf: {
      estimateItemId: string;
      title: string;
      description: string | null;
      quantity: number;
      unit: string | null;
      sourceFileName: string | null;
      sourcePage: number | null;
      position: number;
    };
    linkedTakeoffItems: Array<{
      itemId: string;
      designation: string;
      quantity: number;
      unit: string;
      sourceFileName: string | null;
      sourcePage: number | null;
      confidence: number | null;
      evidence: string | null;
    }>;
    dpgfQuantity: number;
    takeoffQuantity: number | null;
    quantityUnit: string | null;
    matchingScore: number;
    confidenceScore: number;
    reviewStatus: "reliable_match" | "to_confirm" | "significant_gap" | "unlinked" | "forced_manual";
    proofs: Array<{
      proofId: string;
      type: "dpgf" | "takeoff" | "plan_zone" | "formula" | "price_source" | "comment";
      kind: "fact" | "hypothesis" | "inference";
      label: string;
      source: string;
      confidenceScore: number | null;
      note: string | null;
    }>;
    suggestedDecision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope" | null;
    appliedDecision: {
      id: string;
      decision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope";
      reason: string | null;
      source: "current_version" | "carried_over";
      carriedOverFromVersionId: string | null;
      carriedOverFromVersionNumber: number | null;
      decidedAt: string;
      decidedBy: string | null;
    } | null;
    deltaAbsolute: number | null;
    deltaPercent: number | null;
    matchedBy: "auto" | "manual" | null;
    isException: boolean;
    manualLinkCount: number;
  }>;
  unusedTakeoffItems: Array<{
    itemId: string;
    designation: string;
    quantity: number;
    unit: string;
    sourceFileName: string | null;
    sourcePage: number | null;
    confidenceScore: number | null;
    evidence: string | null;
  }>;
}>;
```

Mutations:
```ts
saveTakeoffReviewDecision(input: {
  versionId: string;
  estimateItemId: string;
  decision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope";
  reason?: string | null;
}): Promise<{
  decision: {
    id: string;
    decision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope";
    reason: string | null;
    source: "current_version" | "carried_over";
    carriedOverFromVersionId: string | null;
    carriedOverFromVersionNumber: number | null;
    decidedAt: string;
    decidedBy: string | null;
  };
}>;

linkDpgfLineToTakeoffItems(input: {
  versionId: string;
  estimateItemId: string;
  takeoffItemIds: string[];
}): Promise<{
  links: Array<{
    id: string;
    estimateItemId: string;
    takeoffItemId: string;
    linkedBy: string | null;
    createdAt: string;
  }>;
}>;
```

Note:
- `rows[].proofs` est hydrate depuis la projection persistante `estimate_line_evidences`, pas depuis un calcul uniquement en memoire.
- `linesWithoutProof` doit compter les lignes dont les preuves actives sont limitees a `dpgf`.
- `rows[].risk` resume le score ligne visible dans la review, mais n'applique jamais un statut ou une decision automatiquement.

### 2) Evidence graph

Server fetcher:
```ts
fetchTakeoffLineEvidencePanel(input: {
  versionId: string;
  takeoffJobId: string;
  lineId: string;
}): Promise<{
  lineId: string;
  versionId: string;
  jobId: string;
  evidences: Array<{
    evidenceId: string;
    type: "dpgf" | "takeoff" | "plan_zone" | "formula" | "price_source" | "comment";
    kind: "fact" | "hypothesis" | "inference";
    label: string;
    source: string;
    sourceFileName: string | null;
    sourcePage: number | null;
    confidenceScore: number | null;
    note: string | null;
    createdAt: string;
    authorName: string | null;
    status: "active" | "invalidated" | "replaced";
    supersedesEvidenceId: string | null;
    replacedByEvidenceId: string | null;
  }>;
  history: Array<{
    evidenceId: string;
    type: "dpgf" | "takeoff" | "plan_zone" | "formula" | "price_source" | "comment";
    kind: "fact" | "hypothesis" | "inference";
    label: string;
    source: string;
    sourceFileName: string | null;
    sourcePage: number | null;
    confidenceScore: number | null;
    note: string | null;
    createdAt: string;
    authorName: string | null;
    status: "active" | "invalidated" | "replaced";
    supersedesEvidenceId: string | null;
    replacedByEvidenceId: string | null;
  }>;
}>;
```

HTTP route:
```http
GET /api/takeoff/jobs/:jobId/lines/:lineId/evidence?version_id=:versionId
```

Notes:
- Scope canonique: `line + version + job`, pas `line` seul.
- Le panneau UX detaille reste delegue; FS-B livre ici le contrat, l'historique et la provenance.
- L'export PDF / annexe des preuves principales est hors scope `EST-391`.

### 3) Radar de risque explicable

Server fetcher:
```ts
fetchTakeoffRiskRadar(input: {
  versionId: string;
  takeoffJobId: string;
  severity?: "info" | "warning" | "critical" | null;
  status?: "to_process" | "assumed" | "false_positive" | null;
  scope?: "project" | "lot" | "line" | null;
  lotId?: string | null;
}): Promise<{
  summary: {
    toProcessCount: number;
    assumedCount: number;
    falsePositiveCount: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    topCauses: string[];
    projectScore: number;
    projectSeverity: "info" | "warning" | "critical";
  };
  project: {
    scopeType: "project";
    scopeId: string;
    scopeLabel: string;
    score: number;
    severity: "info" | "warning" | "critical";
    openAlertsCount: number;
    criticalAlertsCount: number;
    topCauses: string[];
  };
  lots: Array<{
    scopeType: "lot";
    scopeId: string | null;
    scopeLabel: string;
    score: number;
    severity: "info" | "warning" | "critical";
    openAlertsCount: number;
    criticalAlertsCount: number;
    topCauses: string[];
  }>;
  items: Array<{
    alertId: string;
    scopeType: "project" | "lot" | "line";
    scopeId: string | null;
    scopeLabel: string;
    lineId: string | null;
    lotId: string | null;
    causeCode:
      | "missing_proof"
      | "dpgf_takeoff_gap"
      | "atypical_price"
      | "insufficient_margin"
      | "vat_inconsistency"
      | "missing_piece";
    causeLabel: string;
    severity: "info" | "warning" | "critical";
    riskScore: number;
    status: "to_process" | "assumed" | "false_positive";
    marginBucket: "negative" | "thin" | "healthy" | "unknown";
    reasonLabels: string[];
    provenance: Array<{
      kind: "fact" | "hypothesis" | "inference";
      label: string;
      source: string;
      confidenceScore: number | null;
      note: string | null;
    }>;
    reviewNote: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}>;
```

Mutation:
```ts
updateTakeoffRiskAlertStatus(input: {
  versionId: string;
  takeoffJobId: string;
  alertId: string;
  status: "to_process" | "assumed" | "false_positive";
  reviewNote?: string | null;
}): Promise<{
  alert: {
    alertId: string;
    status: "to_process" | "assumed" | "false_positive";
    reviewNote: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
  };
}>;
```

HTTP routes:
```http
GET /api/takeoff/jobs/:jobId/risk-radar?version_id=:versionId&severity=:severity&status=:status&scope=:scope&lot_id=:lotId
PATCH /api/takeoff/jobs/:jobId/risk-alerts/:alertId
```

Notes:
- La projection persistante est `estimate_risk_alerts`, active / inactive, avec preservation du statut humain lors des recalculs.
- `warning` cote backend doit se rendre en label UX `Attention`.
- La marge utilise les regles `estimate_rules.min_margin` quand elles sont applicables; a defaut, le seuil de vigilance radar tombe a `10.0%` (`1000 bp`).
- Aucune action IA n'applique un statut sans validation humaine explicite; `assumed` et `false_positive` exigent une note humaine.

### 4) Suggestion de prix

Server fetchers / mutations:
```ts
getTakeoffPriceSuggestion(jobId: string, input: {
  version_id: string;
  estimate_item_id: string;
}): Promise<{
  suggestion: {
    suggestion_id: string;
    line_id: string;
    version_id: string;
    job_id: string;
    current_price_cents: number | null;
    low_cents: number;
    target_cents: number;
    high_cents: number;
    confidence_score: number | null;
    confidence_label: "low" | "medium" | "high";
    candidate_count: number;
    outlier_count: number;
    justification: string;
    factors: Array<{
      key: string;
      label: string;
      value: string;
      kind: "fact" | "hypothesis" | "inference";
    }>;
    sources: Array<{
      source_id: string;
      source_kind: "history" | "pricebook" | "similar_item" | "external_reference";
      kind: "fact" | "hypothesis" | "inference";
      label: string;
      source_ref: string;
      price_cents: number;
      freshness_label: string | null;
      confidence_score: number | null;
      rank: number;
      is_outlier: boolean;
      metadata: Record<string, unknown>;
    }>;
    status: "pending" | "applied" | "kept_current" | "rejected";
    selected_action:
      | "apply_low"
      | "apply_target"
      | "apply_high"
      | "keep_current"
      | "reject"
      | null;
    selected_price_cents: number | null;
    review_note: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
  };
}>;

requestTakeoffPriceSuggestion(jobId: string, input: {
  version_id: string;
  estimate_item_id: string;
  force_refresh?: boolean;
}): Promise<{
  suggestion: TakeoffPriceSuggestionSnapshot;
}>;

reviewTakeoffPriceSuggestion(jobId: string, suggestionId: string, input: {
  version_id: string;
  action: "apply_low" | "apply_target" | "apply_high" | "keep_current" | "reject";
  review_note: string;
}): Promise<{
  suggestion: TakeoffPriceSuggestionSnapshot;
  applied_item: {
    id: string;
    unit_price_ht_cents: number | null;
    updated_at: string;
  } | null;
}>;
```

HTTP routes:
```http
GET /api/takeoff/jobs/:jobId/price-suggestions?version_id=:versionId&estimate_item_id=:lineId
POST /api/takeoff/jobs/:jobId/price-suggestions
PATCH /api/takeoff/jobs/:jobId/price-suggestions/:suggestionId
```

Notes:
- Le backend persiste un snapshot actif par `version + job + ligne` dans `takeoff_price_suggestions`, avec sources detaillees dans `takeoff_price_suggestion_sources`.
- Les trois familles de sources livrees sont `pricebook`, `historique interne` et `ouvrage proche`; `external_reference` reste reserve si une source exploitable apparait plus tard.
- Le recalcul ne modifie jamais la ligne de devis.
- Toute application exige une action humaine explicite et une `review_note` non vide.
- `apply_low` / `apply_target` / `apply_high` passent par le chemin serveur existant de mise a jour de ligne (`updateEstimateItem`) et ne touchent pas `selected_supplier_price_id`.

## UX frontend scope (delegue a equipe UX)

- Construire la vue de comparaison et son panneau preuves.
- Construire le drawer de prix avec bornes, sources et choix d'application.
- Rendre les decisions de revue rapides et sans ambiguite.
- Maintenir une vue lisible pour Laurent comme pour Nadia.

## Points UX a respecter

- Le matching ne doit jamais ressembler a une boite noire.
- Les scores doivent etre traduits en statuts metier.
- Les preuves doivent etre consultables sans casser le contexte de comparaison.
- L'utilisateur doit toujours comprendre l'impact de `garder DPGF` vs `garder metre`.
- La provenance de decision doit distinguer `version courante` et `carry-over`.
- Les preuves doivent separer explicitement `faits`, `hypotheses` et `inferences`.

## Scenarios de validation partages

1. Match fiable avec preuve unique.
2. Ligne a confirmer avec plusieurs preuves et fourchette de prix.
3. Ecart significatif traite par decision manuelle.
4. Filtre `exceptions seulement` + export CSV des lignes visibles.
5. Liaison manuelle d'une ligne DPGF vers plusieurs items takeoff.
6. Decision reprise depuis une version precedente mais editable dans la version courante.
