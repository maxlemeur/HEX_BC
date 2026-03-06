# EST-384 FS-B -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-B

FS-B porte l'orchestrateur de generation `dossier -> V0` et les etats de review.

La surface de review V0 doit etre deleguee a une equipe UX.

## Backend contract cible

### 1) Generation V0

Server Action:
```ts
generateVersionZeroDraft(input: {
  projectId: string;
  briefId: string;
  selectedLots?: string[];
}): Promise<{
  draftId: string;
  versionLabel: string;
  status: "ia_a_revoir";
  generatedLotsCount: number;
  generatedLinesCount: number;
}>;
```

### 2) Review V0

Server fetcher:
```ts
fetchVersionZeroReview(draftId: string): Promise<{
  draftId: string;
  status: "ia_a_revoir" | "ready_for_version";
  summary: {
    generatedLotsCount: number;
    generatedLinesCount: number;
    missingAreasCount: number;
    lowConfidenceLinesCount: number;
  };
  lots: Array<{
    lotId: string;
    lotLabel: string;
    status: "generated" | "partial" | "missing";
    lines: Array<{
      lineTempId: string;
      label: string;
      quantity: number | null;
      confidence: number;
      provenance: string[];
      assumptions: string[];
      reviewStatus: "pending" | "accepted" | "edited" | "rejected";
    }>;
  }>;
}>;
```

### 3) Mutations de review

Server Actions:
```ts
reviewVersionZeroLine(input: {
  draftId: string;
  lineTempId: string;
  reviewStatus: "accepted" | "edited" | "rejected";
  editedValues?: {
    label?: string;
    quantity?: number | null;
  };
}): Promise<{ ok: true }>;

materializeVersionZeroDraft(input: {
  draftId: string;
}): Promise<{
  versionId: string;
  versionNumber: number;
}>;
```

## UX frontend scope (delegue a equipe UX)

- Construire la page `Review V0` avant toute materialisation.
- Rendre visibles les zones manquees et les lignes peu fiables.
- Permettre une revue par lot et par exception.
- Expliquer clairement ce qui est genere, ce qui manque et ce qui reste incertain.

## Points UX a respecter

- Le badge `IA - a revoir` doit etre omnipresent jusqu'a materialisation.
- Les lignes rejetees ou modifiees doivent rester tracables.
- Le front doit encourager une revue active, pas un clic global d'acceptation aveugle.

## Scenarios de validation partages

1. Generation V0 complete avec peu de lignes peu fiables.
2. Generation partielle avec lots manquants.
3. Review ligne par ligne puis materialisation en version.
