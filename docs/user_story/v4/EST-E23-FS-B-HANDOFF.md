# V3-010 / EST-E23 FS-B -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-B

FS-B porte les contrats backend pour :

- `V3-010` comparaison DPGF vs takeoff preuve-centrique
- `EST-391` evidence graph par ligne
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

### 3) Suggestion de prix

Server Action:
```ts
requestPriceSuggestion(input: {
  lineId: string;
}): Promise<{
  lineId: string;
  suggestion: {
    lowCents: number;
    targetCents: number;
    highCents: number;
    justification: string;
    sources: Array<{
      kind: "history" | "pricebook" | "similar_item" | "external_reference";
      label: string;
      freshnessLabel: string | null;
    }>;
  };
}>;
```

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
