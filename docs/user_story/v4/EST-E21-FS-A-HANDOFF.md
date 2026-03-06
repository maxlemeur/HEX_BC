# EST-E21 FS-A -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-A

FS-A porte le backend et les contrats de donnees pour :

- `EST-371` ingestion dossier multi-documents
- `EST-372` brief affaire genere automatiquement

FS-A ne doit pas porter seul l'UX finale de triage, de correction manuelle et de validation du brief.

## Backend contract cible

### 1) Upload binaire

Route:
```http
POST /api/affaires/:projectId/intake/files
Content-Type: multipart/form-data
```

Response:
```ts
{
  uploadId: string;
  files: Array<{
    documentId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: "uploaded" | "rejected";
    rejectionReason: string | null;
  }>;
}
```

### 2) Workspace de triage

Server fetcher:
```ts
fetchAffaireIntakeWorkspace(projectId: string): Promise<{
  projectId: string;
  uploadId: string | null;
  documents: Array<{
    documentId: string;
    fileName: string;
    detectedCategory: "dpgf" | "plans" | "cctp" | "bpu_dqe" | "annexes" | "emails" | "a_classer";
    confidence: number;
    extractedMetadata: {
      projectName: string | null;
      clientName: string | null;
      deadlineAt: string | null;
      detectedLots: string[];
      detectedVariants: string[];
    };
    issues: string[];
  }>;
  missingPieces: Array<{
    code: string;
    label: string;
    severity: "info" | "warning" | "critical";
  }>;
  briefDraft: {
    status: "a_confirmer" | "confirme";
    summary: string;
    projectObject: string;
    scope: string[];
    lots: string[];
    receivedPieces: string[];
    vigilancePoints: string[];
    assumptions: string[];
    missingElements: string[];
    sources: Array<{
      blockKey:
        | "summary"
        | "project_object"
        | "scope"
        | "lots"
        | "received_pieces"
        | "assumptions"
        | "vigilance_points"
        | "missing_elements";
      entryIndex: number;
      sourceDocumentId: string;
      sourceFileName: string;
      rationale: string | null;
    }>;
    uploadId: string | null;
    lastGeneratedAt: string | null;
    confirmedAt: string | null;
  } | null;
}>;
```

### 3) Mutations cote serveur

Server Actions:
```ts
reclassifyAffaireDocument(input: {
  projectId: string;
  documentId: string;
  category: "dpgf" | "plans" | "cctp" | "bpu_dqe" | "annexes" | "emails" | "a_classer";
}): Promise<{ ok: true }>;

updateAffaireBrief(input: {
  projectId: string;
  summary: string;
  scope: string[];
  vigilancePoints: string[];
  assumptions: string[];
}): Promise<{ ok: true; status: "a_confirmer" | "confirme" }>;

confirmAffaireBrief(input: {
  projectId: string;
}): Promise<{ ok: true; status: "confirme" }>;
```

## UX frontend scope (delegue a equipe UX)

- Construire la dropzone multi-documents avec etats `upload`, `erreur`, `a classer`.
- Construire la vue de triage qui permet de corriger rapidement la categorie et d'expliquer les ambiguites.
- Construire l'editeur de brief avec une lecture immediate des sources et des points manquants.
- Rendre visible ce qui est certain vs detecte vs a confirmer.

## Points UX a respecter

- Toujours afficher un libelle textuel de confiance, pas seulement une couleur.
- Les documents `a classer` doivent etre traitables sans quitter l'ecran.
- Le brief doit etre lisible en moins de 30 secondes par Nadia.
- Les erreurs de parsing ou d'extraction doivent etre explicites et non bloquantes.

## Scenarios de validation partages

1. Upload d'un dossier mixte avec 6 types de documents.
2. Correction manuelle d'un document mal classe.
3. Brief genere, edite puis confirme.
4. Presence de pieces manquantes critiques sans blocage de tout l'intake.
