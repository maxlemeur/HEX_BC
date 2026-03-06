# EST-412 FS-A -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-A

FS-A porte le moteur d'analyse d'impact et la creation de V2 a partir de l'impact.

Le front d'analyse et de priorisation doit etre delegue a une equipe UX.

## Backend contract cible

### 1) Lecture d'impact

Server fetcher:
```ts
fetchRevisionImpact(input: {
  projectId: string;
  revisionId: string;
}): Promise<{
  revisionId: string;
  impactLevel: "minor" | "significant" | "critical";
  totals: {
    amountDeltaCents: number;
    marginDeltaBp: number | null;
    impactedLotsCount: number;
    impactedLinesCount: number;
    invalidatedProofsCount: number;
  };
  impactedLots: Array<{
    lotId: string;
    lotLabel: string;
    impactLevel: "minor" | "significant" | "critical";
    amountDeltaCents: number;
    impactedLinesCount: number;
  }>;
  impactedLines: Array<{
    lineId: string;
    lineLabel: string;
    lotLabel: string;
    impactType: "quantity" | "price" | "proof" | "scope";
    certainty: "confirmed" | "assumed";
    amountDeltaCents: number | null;
    marginDeltaBp: number | null;
  }>;
  carryOverZones: Array<{
    scopeRef: string;
    label: string;
    reason: string;
  }>;
}>;
```

### 2) Creation de V2

Server Action:
```ts
createVersionFromImpact(input: {
  projectId: string;
  revisionId: string;
  includeScopes: string[];
  carryOverScopes: string[];
}): Promise<{
  versionId: string;
  versionNumber: number;
  createdFromRevisionId: string;
}>;
```

## UX frontend scope (delegue a equipe UX)

- Construire la synthese haut de page de l'impact.
- Construire les listes `lots touches`, `lignes touchees`, `preuves invalidees`.
- Rendre le choix `conserver via carry-over` comprehensible et sur.
- Construire le flux `Creer V2 a partir de l'impact`.

## Points UX a respecter

- L'utilisateur doit comprendre en quelques secondes ce qui change vraiment.
- Les zones `confirmees` et `supposees` doivent etre distinguees visuellement.
- Le CTA de creation V2 doit expliciter le perimetre retenu.

## Scenarios de validation partages

1. Revision mineure avec 2 lignes touchees.
2. Revision critique avec preuves invalidees et delta marge.
3. Creation V2 en conservant les zones non impactees.
