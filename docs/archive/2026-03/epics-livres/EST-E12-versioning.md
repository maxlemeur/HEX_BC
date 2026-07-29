# EST-E12 — Versioning — diff et changelog

> Milestone: M3 | Priorite: P1 | Statut: A faire

## Objectif

Permettre la comparaison visuelle entre versions, la navigation dans l'historique via une
timeline, la creation de scenarios alternatifs et la generation automatique de changelogs.
Cette epic donne au chiffreur une vision complete de l'evolution de ses devis et facilite
la presentation d'options au client.

## Ce qui existe deja

- **Fonction DB `duplicate_estimate_version()`** : copie atomique en profondeur d'une version
  avec tous ses items, increment automatique du `version_number`
- **`src/components/estimates/DuplicateEstimateButton.tsx`** : composant bouton declenchant
  la duplication via `duplicateEstimateVersion()` du client
- **`src/lib/estimates/server.ts`** : fonction `duplicateEstimateVersion()` appelant le RPC
  Supabase, utilisee pour creer de nouvelles versions
- **Table `estimate_versions`** : colonnes `version_number`, `status` (draft/sent/accepted/
  canceled), `total_ht_cents`, `total_tax_cents`, `total_ttc_cents`, `created_at`, `updated_at`
- **Table `audit_logs`** : trace toutes les modifications avec `action`, `table_name`,
  `record_id`, `old_data`, `new_data`, `user_id`, `created_at` — source de donnees pour
  le changelog automatique
- **`src/lib/estimate-calculations.ts`** : fonctions `computeEstimateLineValues()`,
  `computeEstimateTotals()` — calculs reutilisables pour les comparaisons de totaux

---

## EST-221 — Diff visuel entre versions

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux comparer visuellement deux versions d'un devis (ajouts,
> suppressions, modifications), afin de comprendre ce qui a change.

### Criteres d'acceptation

- [ ] Une page de comparaison permet de selectionner deux versions du meme projet
      de devis a comparer
- [ ] L'affichage propose un mode cote-a-cote (side-by-side) et un mode en ligne
      (inline) avec bascule possible
- [ ] Les changements sont codes par couleur : vert pour les lignes ajoutees,
      rouge pour les lignes supprimees, jaune pour les lignes modifiees
- [ ] Pour les lignes modifiees, les champs ayant change sont mis en evidence avec
      l'ancienne valeur barree et la nouvelle valeur a cote (ex: "150,00 -> 175,00")
- [ ] Un resume en haut de page affiche l'impact total : nombre d'ajouts/suppressions/
      modifications, variation du total HT, variation du total TTC
- [ ] La correspondance entre lignes des deux versions s'effectue par titre + section
      (pas par identifiant, car la duplication cree de nouveaux IDs)
- [ ] Les sections ajoutees ou supprimees en bloc sont clairement identifiees
- [ ] La page est accessible via l'URL `/dashboard/estimates/{versionId}/diff?compare={otherId}`

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/diff/page.tsx` — page de comparaison
    avec selecteur de versions et bascule de mode d'affichage
  - `src/lib/estimates/diff.ts` — moteur de diff : fonctions `diffVersions()`,
    `matchLines()`, `categorizeChanges()` retournant une structure de diff typee
    (ajouts, suppressions, modifications avec ancienne/nouvelle valeur)
  - `src/components/estimates/EstimateDiffView.tsx` — composant de rendu du diff
    supportant les modes side-by-side et inline, avec code couleur et resume
- Fichiers a modifier : aucun (page standalone)
- Reutiliser :
  - `src/lib/estimates/server.ts` — `getEstimateVersionDetails()` pour charger les
    donnees des deux versions a comparer
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour les totaux
    de chaque version dans le resume
  - `src/lib/money.ts` — `formatEUR()` pour l'affichage des ecarts de montants
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
- Dependances : aucune

---

## EST-222 — Timeline des versions

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux voir une timeline chronologique de toutes les versions
> d'un projet, afin de naviguer dans l'historique.

### Criteres d'acceptation

- [ ] Un composant timeline affiche toutes les versions d'un projet de devis sur un axe
      chronologique vertical
- [ ] Chaque noeud de la timeline affiche : numero de version (v1, v2...), date de creation,
      statut (badge colore), total TTC formate, auteur (nom de l'utilisateur)
- [ ] La version courante (celle en cours de consultation) est visuellement distinguee
      (bordure, fond, icone)
- [ ] Un clic sur un noeud navigue vers la page detail de cette version
- [ ] Les versions au statut `canceled` sont affichees en grise avec une indication visuelle
- [ ] La timeline est responsive et s'adapte aux ecrans mobiles (mode compact)
- [ ] Le chargement est performant meme avec de nombreuses versions (pagination si > 20)

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/EstimateTimeline.tsx` — composant timeline vertical
    avec noeuds cliquables, badges statut, formatage montants, mise en evidence
    de la version courante
- Fichiers a modifier :
  - Page detail de version (ex: `src/app/dashboard/estimates/[versionId]/page.tsx`
    ou layout) — integration du composant timeline dans la sidebar ou en haut de page
- Reutiliser :
  - `src/lib/estimates/server.ts` — requete listant les versions d'un projet
    (a creer si inexistante : `listEstimateVersions(estimateId)`)
  - `src/lib/money.ts` — `formatEUR()` pour les montants dans la timeline
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
- Dependances : aucune

---

## EST-223 — Scenarios alternatifs

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux creer des variantes (scenarios) a partir d'une version
> pour tester differentes hypotheses, afin de presenter des options au client.

### Criteres d'acceptation

- [ ] Une action "Creer une variante" est disponible sur toute version de devis, a cote
      du bouton de duplication existant
- [ ] La variante est creee via `duplicate_estimate_version()` avec un label
      supplementaire (A, B, C... attribue automatiquement par ordre de creation)
- [ ] Le champ `variant_label` (varchar, nullable) et `parent_version_id` (uuid FK, nullable)
      sont ajoutes a la table `estimate_versions` via migration
- [ ] La timeline (EST-222) affiche les variantes comme des branches laterales
      rattachees a leur version parente
- [ ] Un tableau de comparaison des variantes permet de voir cote a cote les totaux
      (HT, TVA, TTC) et le nombre de lignes de chaque variante d'une meme version parente
- [ ] Une variante peut etre "promue" en version principale : elle perd son label de
      variante et devient la version de reference
- [ ] Les variantes sont incluses dans le diff (EST-221) : on peut comparer une variante
      avec sa version parente ou avec une autre variante

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_estimate_variants.sql` — ajout colonnes
    `variant_label` (varchar(5), nullable), `parent_version_id` (uuid FK references
    `estimate_versions(id)`, nullable) sur `estimate_versions`, index sur
    `parent_version_id`
  - `src/components/estimates/VariantComparisonTable.tsx` — tableau comparatif
    des variantes avec colonnes dynamiques, totaux, nombre de lignes, action de promotion
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — nouvelle fonction `createVariant()` appelant
    `duplicate_estimate_version()` et positionnant `variant_label` + `parent_version_id`,
    nouvelle fonction `promoteVariant()` retirant le label et le parent
  - `src/lib/estimates/client.ts` — wrappers client pour les nouvelles fonctions
  - `src/lib/estimates/schemas.ts` — schemas Zod pour creation/promotion de variante
  - `src/components/estimates/EstimateTimeline.tsx` — rendu des branches variantes
  - `src/components/estimates/DuplicateEstimateButton.tsx` — ajout de l'option
    "Creer une variante" a cote de "Dupliquer"
- Reutiliser :
  - `src/lib/estimates/server.ts` — `duplicateEstimateVersion()` comme base de la creation
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour le tableau comparatif
  - `src/lib/money.ts` — `formatEUR()` pour les montants
- Dependances : EST-221

---

## EST-224 — Changelog automatique

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux un changelog automatique entre versions listant les
> modifications, afin de documenter l'evolution du devis.

### Criteres d'acceptation

- [ ] Le changelog est genere automatiquement a partir du diff entre deux versions
      consecutives (ou selectionnees)
- [ ] Les modifications sont regroupees par section avec un titre clair pour chaque groupe
- [ ] Chaque entree du changelog indique : type de changement (ajout/suppression/modification),
      designation de la ligne, champs modifies avec anciennes et nouvelles valeurs
- [ ] Les variations de montant sont calculees et affichees : delta par section et delta total
- [ ] Le changelog est exportable en annexe PDF (ajout d'une page supplementaire au
      document principal)
- [ ] Le changelog est stockable par paire de versions pour ne pas le recalculer a
      chaque consultation
- [ ] L'affichage du changelog est integre dans la page de diff (EST-221) sous forme
      d'onglet ou de section pliable
- [ ] Le format texte du changelog est lisible sans contexte technique (comprehensible
      par un client non technique)

### Notes techniques

- Fichiers a creer :
  - `src/lib/estimates/changelog.ts` — fonctions `generateChangelog()` (a partir du
    resultat de `diffVersions()`), `formatChangelogEntry()`,
    `groupChangelogBySection()`, `computeSectionDeltas()`
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/diff/page.tsx` — ajout de l'onglet
    ou section changelog dans la page de diff
  - `src/lib/estimates/pdf-generator.ts` — (si EST-201 realise) ajout d'une page
    annexe changelog au PDF genere
- Reutiliser :
  - `src/lib/estimates/diff.ts` — `diffVersions()` (EST-221) comme source de donnees
    pour la generation du changelog
  - `src/lib/money.ts` — `formatEUR()` pour les montants dans le changelog
  - `src/lib/estimate-calculations.ts` — calculs de totaux pour les deltas
  - Table `audit_logs` comme source complementaire pour les details fins des modifications
- Dependances : EST-221
