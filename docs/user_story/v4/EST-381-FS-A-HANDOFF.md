# EST-381 FS-A -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-A

FS-A porte le service de generation et les mutations d'insertion pour `EST-381`.

Le front de review des ouvrages generes doit etre delegue a une equipe UX.

## Backend contract cible

### 1) Generation d'ouvrages

Server Action:
```ts
generateOuvragesFromText(input: {
  projectId: string;
  versionId: string;
  sourceKind: "free_text" | "cctp_excerpt" | "internal_note";
  sourceText: string;
  preferredLotId?: string | null;
}): Promise<{
  draftId: string;
  candidates: Array<{
    candidateId: string;
    lotLabel: string | null;
    designation: string;
    unit: string | null;
    quantity: number | null;
    confidence: number;
    status: "certain" | "plausible" | "question";
    sources: Array<{
      type: "text" | "cctp" | "history" | "library";
      label: string;
      excerpt: string | null;
    }>;
  }>;
}>;
```

### 2) Review et insertion

Server Actions:
```ts
insertGeneratedOuvrages(input: {
  versionId: string;
  draftId: string;
  acceptedCandidates: Array<{
    candidateId: string;
    designation: string;
    unit: string | null;
    quantity: number | null;
    lotId: string | null;
  }>;
}): Promise<{ ok: true; insertedCount: number }>;

rejectGeneratedOuvrageDraft(input: {
  draftId: string;
  candidateId: string;
  reason?: string;
}): Promise<{ ok: true }>;
```

## UX frontend scope (delegue a equipe UX)

- Construire un panneau de review avec source a gauche, propositions a droite.
- Permettre `accepter`, `editer avant insertion`, `rejeter`.
- Afficher la provenance et le niveau de confiance sans surcharge cognitive.
- Eviter toute impression d'insertion automatique.

## Points UX a respecter

- Les propositions `question` doivent etre visuellement distinctes des propositions `certaines`.
- Le chiffreur doit pouvoir editer sans perdre la provenance source.
- Le CTA principal doit rester `Inserer les ouvrages selectionnes`, jamais `Generer et appliquer`.

## Scenarios de validation partages

1. Texte libre avec 3 ouvrages dont 1 incertain.
2. Extrait CCTP avec quantite deduite et lot pre-rempli.
3. Rejet complet d'un draft sans insertion.
4. Edition d'une proposition avant insertion.
