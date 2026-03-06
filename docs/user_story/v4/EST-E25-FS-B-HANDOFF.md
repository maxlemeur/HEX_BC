# EST-E25 FS-B -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-B

FS-B porte les contrats backend pour :

- `EST-411` lecture des retours client et detection des changements
- `EST-413` reponse assistee et contre-proposition structuree

Le front de synthese de revision et de reponse assistee doit etre delegue a une equipe UX.

## Backend contract cible

### 1) Ingestion d'un retour client

Server Action:
```ts
ingestClientRevisionInput(input: {
  projectId: string;
  sourceKind: "portal_comment" | "email" | "updated_dpgf" | "attachment";
  rawText?: string | null;
  fileIds?: string[];
}): Promise<{
  revisionId: string;
  status: "ingested";
}>;
```

### 2) Synthese des changements

Server fetcher:
```ts
fetchClientRevisionSummary(revisionId: string): Promise<{
  revisionId: string;
  summary: {
    addedCount: number;
    removedCount: number;
    ambiguousCount: number;
    openQuestionsCount: number;
  };
  changes: Array<{
    changeId: string;
    kind: "added" | "removed" | "changed" | "ambiguous";
    lotLabel: string | null;
    lineLabel: string | null;
    certainty: "confirmed" | "assumed";
    explanation: string;
  }>;
}>;
```

### 3) Brouillon de reponse

Server Action:
```ts
generateClientResponseDraft(input: {
  revisionId: string;
  tone: "neutral" | "commercial";
  includeVariantProposal: boolean;
}): Promise<{
  draftId: string;
  paragraphs: Array<{
    paragraphId: string;
    text: string;
    facts: string[];
  }>;
}>;
```

## UX frontend scope (delegue a equipe UX)

- Construire la synthese de changements corrigeable avant impact/V2.
- Construire l'editeur de brouillon de reponse avec rattachement factuel.
- Rendre clairs les changements `confirmes` vs `supposes`.

## Points UX a respecter

- Le chiffreur doit pouvoir valider ou corriger la synthese avant de poursuivre.
- Chaque paragraphe de reponse doit rester editable.
- Le produit ne doit jamais donner l'impression d'une reponse auto-envoyee.

## Scenarios de validation partages

1. Mail client ambigu avec questions ouvertes.
2. Nouveau DPGF detecte avec changements mappes par lots.
3. Brouillon de reponse avec proposition de variante.
