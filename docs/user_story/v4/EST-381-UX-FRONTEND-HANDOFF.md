# EST-381 UX / Frontend Handoff

## Objectif

Livrer le parcours de revue des ouvrages generes pour `EST-381` sans insertion silencieuse dans le devis.

Le backend est pret. Le front doit maintenant offrir:
- un point d'entree clair depuis l'editeur devis / affaire
- une generation explicite
- une revue lisible des candidats
- une edition avant insertion
- un rejet unitaire
- une insertion explicite des seuls candidats choisis

## Documents source a lire

- Ticket: [EST-381.md](../tickets/EST-381.md)
- Epic: [EST-E22-draft-assiste-ouvrages.md](../EST-E22-draft-assiste-ouvrages.md)
- Contrat backend: [EST-381-FS-A-HANDOFF.md](./EST-381-FS-A-HANDOFF.md)

## Perimetre frontend

Le front doit couvrir:
- saisie d'un texte libre, d'un extrait CCTP ou d'une note interne
- lancement de `generateOuvragesFromText`
- rechargement d'un draft via `fetchGeneratedOuvrageDraft`
- revue candidat par candidat
- edition locale avant insertion
- rejet d'un candidat via `rejectGeneratedOuvrageDraft`
- insertion des candidats retenus via `insertGeneratedOuvrages`

Le front ne doit pas:
- inserer automatiquement apres generation
- masquer la provenance
- fusionner les statuts `question` et `certain`
- masquer le fallback metier applique si `lotId = null`

## Parcours UX recommande

### 1. Point d'entree

Ajouter un CTA secondaire dans l'editeur devis, proche des actions de creation de ligne:
- label recommande: `Generer des ouvrages`

Le CTA ouvre un panneau, drawer ou side sheet dedie.

### 2. Etape de saisie

Le panneau commence par une zone de saisie avec:
- un select `Source`
  - `Texte libre`
  - `Extrait CCTP`
  - `Note interne`
- un textarea `Description ou extrait`
- un select optionnel `Inserer dans le lot`
- si le flux vient d'un document:
  - `sourceDocumentId`
  - `sourceFileName`
  - `sourcePageFrom`
  - `sourcePageTo`
  - `selectionLabel`

CTA primaire:
- `Generer des propositions`

Pendant l'appel:
- desactiver le formulaire
- afficher un etat `aria-live="polite"` du type `Generation des ouvrages en cours`

### 3. Etape de revue

Une fois le draft charge:
- colonne gauche: source principale + fragments exploites
- colonne droite: liste des candidats

Chaque candidat doit afficher:
- badge de confiance
- designation
- unite
- quantite
- lot suggere
- raisonnement court si present
- provenance resumee

Actions par candidat:
- `Selectionner`
- `Modifier`
- `Rejeter`

CTA principal de l'ecran:
- `Inserer les ouvrages selectionnes`

CTA secondaire:
- `Fermer`

### 4. Edition

L'edition peut etre inline ou dans un sous-panneau.

Champs editables:
- `designation`
- `unit`
- `quantity`
- `lotId`

Champs non editables:
- niveau de confiance
- statut IA
- provenance brute

L'edition ne doit jamais effacer la provenance affichee.

### 5. Rejet

Le rejet est candidat par candidat.

UX recommandee:
- clic `Rejeter`
- confirmation legere optionnelle si necessaire
- champ `Motif` optionnel

Apres rejet:
- le candidat passe en etat `Rejete`
- il ne doit plus etre selectionnable pour insertion

Si tous les candidats sont rejetes:
- afficher un etat final du draft `Brouillon entierement ecarte`

### 6. Insertion

Au clic sur `Inserer les ouvrages selectionnes`:
- ne transmettre que les candidats retenus
- utiliser les valeurs editees
- montrer un etat de progression bloquant leger

Apres succes:
- feedback court:
  - `1 ouvrage insere`
  - `3 ouvrages inseres`
- recharger le devis
- recharger le draft si le panneau reste ouvert

Si insertion partielle:
- conserver le panneau ouvert
- marquer les candidats inseres
- laisser les autres en attente

## Structure de composants recommandee

L'agent frontend peut adapter les noms, mais cette decomposition est propre:

- `GeneratedOuvrageDrawer`
  - shell du panneau
  - gere l'etat d'etape
- `GeneratedOuvrageSourceForm`
  - sourceKind
  - sourceText
  - lot cible optionnel
  - submit generation
- `GeneratedOuvrageDraftReview`
  - recupere et affiche le draft
- `GeneratedOuvrageCandidateCard`
  - resume d'un candidat
  - badges
  - provenance compacte
  - actions
- `GeneratedOuvrageCandidateEditor`
  - edition locale d'un candidat
- `GeneratedOuvrageSourcePanel`
  - liste des fragments sources
  - preview excerpt + metadata
- `GeneratedOuvrageFooterBar`
  - resume de selection
  - CTA insertion

## Etat frontend recommande

### Etat global

Conserver un state explicite:
- `idle`
- `generating`
- `review`
- `inserting`
- `error`

### Etat draft

Stocker:
- `draftId`
- `versionId`
- `projectId`
- `status`
- `preferredLotId`
- `candidates`
- `summary`

### Etat local par candidat

Pour chaque candidat, garder:
- `selected: boolean`
- `isEditing: boolean`
- `editedDesignation`
- `editedUnit`
- `editedQuantity`
- `editedLotId`
- `resolutionStatus`

Ne jamais utiliser le statut de selection comme substitut du statut backend.

## Mapping des statuts visuels

### Statut IA

- `certain`
  - style positif sobre
  - libelle: `Certain`
- `plausible`
  - style attention neutre
  - libelle: `Plausible`
- `question`
  - style alerting
  - libelle: `A clarifier`

### Statut de resolution

- `pending`
  - libelle: `En attente`
- `inserted`
  - libelle: `Insere`
  - verrouiller edition et selection
- `rejected`
  - libelle: `Rejete`
  - masquer CTA insertion

### Statut draft

- `pending`
  - au moins un candidat encore actionnable
- `partially_applied`
  - au moins un candidat insere, au moins un autre encore pending
- `applied`
  - tous les candidats resolus et au moins un insere
- `discarded`
  - tous les candidats rejetes et aucune insertion

## Regles d'interface importantes

- Le CTA principal doit rester `Inserer les ouvrages selectionnes`.
- Ne jamais afficher `Generer et appliquer`.
- La provenance doit etre visible sans ouvrir un second ecran obligatoire.
- Les candidats `question` doivent etre facilement differenciables au premier scan.
- Le lot suggere est une aide, pas une contrainte.
- Si `lotId = null`, expliciter dans l'UI que l'insertion se fera dans la section `A classer`.

## Accessibilite

- Le drawer doit pieger le focus correctement.
- Le textarea doit avoir un label explicite, pas seulement un placeholder.
- Les badges de statut ne doivent pas reposer uniquement sur la couleur.
- Les changements de statut apres generation, insertion ou rejet doivent etre annonces via `aria-live`.
- Les actions `Modifier`, `Rejeter`, `Selectionner` doivent etre accessibles clavier sans sous-menu obligatoire.
- Les extraits sources longs doivent rester scrollables et lisibles au clavier.

## Contrats a consommer

### Generation

Server Action:
- [generated-ouvrages.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/dashboard/affaires/_actions/generated-ouvrages.ts)

Appel:

```ts
await generateOuvragesFromText({
  projectId,
  versionId,
  sourceKind,
  sourceText,
  preferredLotId,
  sourceDocumentId,
  sourceFileName,
  sourcePageFrom,
  sourcePageTo,
  selectionLabel,
});
```

### Reload draft

```ts
await fetchGeneratedOuvrageDraft({
  versionId,
  draftId,
});
```

### Insertion

```ts
await insertGeneratedOuvrages({
  versionId,
  draftId,
  acceptedCandidates: selectedCandidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    designation: candidate.editedDesignation,
    unit: candidate.editedUnit,
    quantity: candidate.editedQuantity,
    lotId: candidate.editedLotId,
  })),
});
```

### Rejet

```ts
await rejectGeneratedOuvrageDraft({
  draftId,
  candidateId,
  reason,
});
```

## Shape frontend conseille

```ts
type UiGeneratedOuvrageCandidate = {
  candidateId: string;
  selected: boolean;
  isEditing: boolean;
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
  editedDesignation: string;
  editedUnit: string | null;
  editedQuantity: number | null;
  editedLotId: string | null;
};
```

## Copie UX recommandee

### Empty state

- titre: `Generer des ouvrages a partir d'un texte`
- aide: `Collez une description, un extrait CCTP ou une note interne. Rien ne sera insere sans validation.`

### Etat review

- titre: `Verifier les propositions`
- aide: `Selectionnez, corrigez ou rejetez chaque ouvrage avant insertion dans le devis.`

### Etat draft discarded

- titre: `Toutes les propositions ont ete ecartees`
- aide: `Vous pouvez fermer ce panneau ou relancer une nouvelle generation.`

### Etat partial apply

- aide: `Certains ouvrages ont deja ete inseres. Les autres restent en attente de revue.`

## Cas de test frontend minimum

- Generation depuis texte libre simple.
- Generation depuis extrait CCTP avec metadata documentaire visible.
- Presence simultanee de candidats `certain`, `plausible`, `question`.
- Edition d'un candidat puis insertion.
- Rejet d'un candidat unique.
- Rejet complet d'un draft.
- Insertion partielle puis rechargement du draft.
- Insertion avec `lotId = null` vers la section explicite `A classer`.
- Affichage correct des candidats deja `inserted`.

## Risques / points d'attention

- Le modele `estimate_items` ne porte pas de colonne `unit`; l'unite reste donc visible dans le draft et la provenance enrichie, mais pas comme champ natif de ligne devis pour l'instant.
- Le front ne doit pas supposer qu'un draft est encore `pending` apres chaque action; toujours relire `draftStatus`.
- Le front doit tolerer un draft vide ou entierement rejete sans planter le panneau.
- Les extraits bruts peuvent etre longs; prevoir truncation visuelle + expansion locale.

## Recommandation d'implementation Next / React

- Charger la lecture du draft cote serveur quand le point d'entree est lie a un draft deja connu.
- Utiliser des Server Actions pour `generate`, `insert`, `reject`.
- Garder les editions candidat localement cote client jusqu'au submit d'insertion.
- Revalider le devis apres mutation, mais ne pas fermer automatiquement le panneau si le draft reste `partially_applied`.
