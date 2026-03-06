# V3-E07 FS-A -> UX Frontend Handoff (Backend Contract Cible)

## Scope FS-A

FS-A porte le backend et les contrats de donnees pour :

- `V3-024` publication securisee d'une version client
- `V3-025` questions client contextualisees

Le parcours de publication et le portail client doivent etre delegues a une equipe UX.

## Backend contract cible

### 1) Publication d'une version

Server Action:
```ts
publishEstimateVersion(input: {
  versionId: string;
  expiresAt?: string | null;
  passwordProtected: boolean;
  password?: string | null;
  allowedEmail?: string | null;
  message?: string | null;
}): Promise<{
  publicationId: string;
  portalUrl: string;
  status: "published";
  expiresAt: string | null;
}>;
```

Server fetcher:
```ts
fetchEstimatePublications(versionId: string): Promise<Array<{
  publicationId: string;
  status: "published" | "revoked" | "expired";
  portalUrl: string;
  createdAt: string;
  expiresAt: string | null;
  allowedEmail: string | null;
  openCount: number;
}>>;
```

### 2) Lecture portail client

Public fetcher:
```ts
fetchClientPortalView(token: string): Promise<{
  publication: {
    publicationId: string;
    versionId: string;
    versionNumber: number;
    projectName: string;
    status: "published" | "revoked" | "expired";
  };
  summary: string | null;
  pdfUrl: string | null;
  threads: Array<{
    threadId: string;
    scope: "version" | "lot" | "line";
    scopeLabel: string;
    status: "new" | "in_progress" | "answered" | "closed";
    lastMessageAt: string;
    messages: Array<{
      messageId: string;
      authorSide: "client" | "internal";
      body: string;
      createdAt: string;
    }>;
  }>;
}>;
```

### 3) Questions et reponses

Mutations:
```ts
createClientPortalQuestion(input: {
  token: string;
  scope: "version" | "lot" | "line";
  scopeRef: string;
  body: string;
}): Promise<{ threadId: string; status: "new" }>;

replyToClientPortalThread(input: {
  threadId: string;
  body: string;
  publishToClient: boolean;
}): Promise<{ ok: true; status: "answered" | "in_progress" }>;

revokeEstimatePublication(input: {
  publicationId: string;
}): Promise<{ ok: true; status: "revoked" }>;
```

## UX frontend scope (delegue a equipe UX)

- Construire la modale de publication avec parametres de securite comprehensibles.
- Construire le portail client lecture + threads de questions.
- Clarifier les etats `publie`, `expire`, `revoque`, `repondu`.
- Rendre la contextualisation lot/ligne evidente pour le client comme pour l'interne.

## Points UX a respecter

- Le client ne doit jamais douter de la version qu'il consulte.
- Les options de securite doivent etre expliquees en langage non technique.
- Les questions doivent pouvoir etre creees sans ambiguite de perimetre.
- Les actions de revocation et republication doivent etre distinctes.

## Scenarios de validation partages

1. Publication simple avec lien actif.
2. Publication protegee par mot de passe.
3. Question client sur une ligne precise.
4. Revocation puis consultation d'un lien invalide.
