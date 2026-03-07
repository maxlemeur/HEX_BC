# EST-384 FS-B -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-B

FS-B porte l'orchestrateur de generation `dossier -> V0` et les etats de review.

La surface de review V0 doit etre deleguee a une equipe UX.

## Backend contract cible

### 1) Generation V0

Server Action:
```ts
generateVersionZeroDraft(input: {
  versionId: string;
  briefId?: string;
  selectedLots?: string[];
}): Promise<VersionZeroReview>;
```

### 2) Review V0

Server fetcher:
```ts
fetchVersionZeroReview(input: {
  versionId: string;
  draftId?: string;
}): Promise<VersionZeroReview>;
```

### 3) Mutations de review

Server Actions:
```ts
reviewVersionZeroLine(input: {
  versionId: string;
  draftId: string;
  lineDraftId: string;
  reviewStatus: "accepted" | "edited" | "rejected";
  editedValues?: {
    title?: string;
    description?: string | null;
    quantity?: number | null;
    unit?: string | null;
  };
}): Promise<VersionZeroReview>;

materializeVersionZeroDraft(input: {
  versionId: string;
  draftId: string;
}): Promise<VersionZeroReview>;
```

### 4) Summary / gate state

Server fetcher:
```ts
fetchVersionZeroDraftSummary(input: {
  versionId: string;
}): Promise<{
  versionId: string;
  hasConfirmedBrief: boolean;
  isVersionEmpty: boolean;
  canGenerate: boolean;
  availableLots: string[];
  activeDraft: {
    id: string;
    status: "ia_a_revoir" | "ready_for_version";
    selectedLots: string[];
    counts: {
      lots: number;
      lines: number;
      pending: number;
      accepted: number;
      edited: number;
      rejected: number;
      missingLots: number;
      partialLots: number;
      lowConfidenceLines: number;
    };
  } | null;
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
