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
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  sourcePageFrom?: number | null;
  sourcePageTo?: number | null;
  selectionLabel?: string | null;
}): Promise<{
  draftId: string;
  versionId: string;
  projectId: string;
  preferredLotId: string | null;
  status: "pending" | "partially_applied" | "applied" | "discarded";
  candidates: Array<{
    candidateId: string;
    suggestedLotId: string | null;
    lotLabel: string | null;
    designation: string;
    unit: string | null;
    quantity: number | null;
    confidence: number;
    status: "certain" | "plausible" | "question";
    resolutionStatus: "pending" | "inserted" | "rejected";
    reasoning: string | null;
    sources: Array<{
      sourceFragmentId: string;
      sourceDocumentId: string | null;
      type: "text" | "cctp" | "history" | "library";
      label: string;
      excerpt: string | null;
      sourceFileName: string | null;
      sourcePageFrom: number | null;
      sourcePageTo: number | null;
      selectionLabel: string | null;
    }>;
  }>;
}>;
```

### 2) Review et insertion

Server Actions:
```ts
fetchGeneratedOuvrageDraft(input: {
  versionId: string;
  draftId: string;
}): Promise<{
  draftId: string;
  versionId: string;
  projectId: string;
  preferredLotId: string | null;
  status: "pending" | "partially_applied" | "applied" | "discarded";
  candidates: Array<{
    candidateId: string;
    suggestedLotId: string | null;
    lotLabel: string | null;
    designation: string;
    unit: string | null;
    quantity: number | null;
    confidence: number;
    status: "certain" | "plausible" | "question";
    resolutionStatus: "pending" | "inserted" | "rejected";
    reasoning: string | null;
    sources: Array<{
      sourceFragmentId: string;
      sourceDocumentId: string | null;
      type: "text" | "cctp" | "history" | "library";
      label: string;
      excerpt: string | null;
      sourceFileName: string | null;
      sourcePageFrom: number | null;
      sourcePageTo: number | null;
      selectionLabel: string | null;
    }>;
  }>;
}>;

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
}): Promise<{
  ok: true;
  insertedCount: number;
  draftStatus: "pending" | "partially_applied" | "applied" | "discarded";
}>;

rejectGeneratedOuvrageDraft(input: {
  draftId: string;
  candidateId: string;
  reason?: string;
}): Promise<{
  ok: true;
  draftStatus: "pending" | "partially_applied" | "applied" | "discarded";
}>;
```

## Decisions de contrat alignees sur l'implementation

- La revue reste server-side et persiste un draft explicite avant toute insertion.
- Chaque source expose un `sourceFragmentId` stable pour garder la provenance apres edition.
- Les propositions `question` restent dans le draft EST-381 et ne creent rien automatiquement ailleurs.
- `lotId = null` a l'insertion signifie insertion a la racine du devis, sans creation implicite de lot.
- L'unite proposee est conservee dans le draft, l'application et la provenance enrichie meme si le modele `estimate_items` ne porte pas encore une colonne `unit`.

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
