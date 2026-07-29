# EST-E09 — Aide a la saisie (suggestions)

> Milestone: M2 | Priorite: P1 | Statut: A faire

## Objectif

Enrichir le systeme de suggestions existant avec un scoring intelligent, une application en masse
et un apprentissage automatique base sur les corrections de l'utilisateur. L'objectif est de
reduire significativement le temps de saisie des chiffreurs en proposant les bons coefficients
et prix des les premieres lignes du devis.

## Ce qui existe deja

- **Table `estimate_suggestion_rules`** : match_type `keyword`, colonnes `match_value`, `unit`,
  `category_id`, `k_fo`, `k_mo`, `labor_role_id` — correspondance par mot-cle pour pre-remplir
  les champs lors de la creation d'un item
- **`src/components/estimates/EstimateSuggestionRulesManager.tsx`** : interface CRUD pour gerer
  les regles de suggestion (nom, mot-cle, unite, categorie, coefficients fourniture/main-d'oeuvre,
  role de main-d'oeuvre)
- **`src/components/estimates/EstimateEditorTable.tsx`** : table editeur avec drag-and-drop et
  drapeaux qualite — les suggestions sont consommees lors de la creation de lignes
- **`src/lib/estimates/server.ts`** : fonctions `createSuggestionRule()`, `updateSuggestionRule()`
- **`src/lib/estimates/schemas.ts`** : schemas Zod `createSuggestionRuleSchema`,
  `updateSuggestionRuleSchema`
- **Tables catalogue** : `supplier_pricebook`, `material_indices` — prix fournisseurs et indices
  materiaux disponibles pour enrichir les suggestions

---

## EST-161 — Scoring et classement des suggestions

**Priorite:** P1 | **Effort:** M | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux que les suggestions soient classees par pertinence
> (frequence d'utilisation, proximite du mot-cle), afin de choisir plus vite la bonne.

### Criteres d'acceptation

- [ ] Chaque suggestion recoit un score composite base sur la qualite de correspondance
      du mot-cle (exacte > partielle > fuzzy) et la frequence d'utilisation
- [ ] Les 5 meilleures suggestions sont affichees dans un dropdown sous la ligne en
      cours d'edition, triees par score decroissant
- [ ] Le score est mis a jour a chaque acceptation ou rejet d'une suggestion :
      acceptation incremente `usage_count`, rejet ne penalise pas
- [ ] La correspondance fuzzy est supportee (tolerance aux fautes de frappe, accents,
      pluriels) avec un score proportionnel a la distance de Levenshtein
- [ ] La colonne `usage_count` (integer, defaut 0) et `last_used_at` (timestamptz, nullable)
      sont ajoutees a la table `estimate_suggestion_rules` via migration
- [ ] Les suggestions avec `usage_count` = 0 apparaissent en fin de liste a score egal
- [ ] Tests unitaires pour la fonction de scoring (cas exact, partiel, fuzzy, frequence)

### Notes techniques

- Fichiers a creer :
  - `src/lib/estimates/suggestion-scoring.ts` — fonctions `scoreSuggestion()`,
    `rankSuggestions()`, `fuzzyMatch()`
  - Migration `supabase/migrations/0xx_suggestion_scoring.sql` — ajout colonnes
    `usage_count`, `last_used_at` sur `estimate_suggestion_rules`
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — integration du dropdown de
    suggestions triees, gestion acceptation/rejet
  - `src/lib/estimates/server.ts` — endpoint ou logique de mise a jour du compteur
- Reutiliser :
  - `src/lib/estimates/schemas.ts` — etendre les schemas existants
  - `src/lib/estimates/errors.ts` — gestion d'erreurs normalisee
- Dependances : aucune

---

## EST-162 — Application en masse des suggestions

**Priorite:** P1 | **Effort:** M | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux appliquer les suggestions a toutes les lignes sans
> coefficients en un clic, afin de pre-remplir rapidement un nouveau devis.

### Criteres d'acceptation

- [ ] Un bouton "Appliquer les suggestions" est visible dans la toolbar de l'editeur
      lorsque des lignes sans coefficients existent
- [ ] Au clic, une dialog de previsualisation s'ouvre listant toutes les lignes concernees
      avec les valeurs actuelles et les valeurs proposees cote a cote
- [ ] Seules les lignes dont les champs cibles (k_fo, k_mo, unit, category_id) sont vides
      et qui correspondent a au moins une regle sont incluses
- [ ] L'utilisateur peut decocher individuellement des lignes avant de confirmer
- [ ] Un indicateur de progression s'affiche pour les devis volumineux (> 50 lignes traitees)
- [ ] Une action "Annuler les suggestions" (undo) est disponible immediatement apres
      application, permettant de revenir a l'etat precedent
- [ ] Le bulk update utilise `bulkUpdateEstimateItems()` existant pour persister les changements
- [ ] Les compteurs `usage_count` des regles appliquees sont incrementes

### Notes techniques

- Fichiers a creer :
  - `src/lib/estimates/bulk-suggest.ts` — fonctions `findSuggestibleLines()`,
    `computeBulkSuggestions()`, `applyBulkSuggestions()`
  - `src/components/estimates/BulkSuggestDialog.tsx` — dialog de previsualisation
    avec tableau comparatif, checkboxes, barre de progression
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — ajout du bouton dans
    la toolbar, integration de la dialog
- Reutiliser :
  - `src/lib/estimates/suggestion-scoring.ts` — scoring pour choisir la meilleure
    suggestion par ligne (EST-161)
  - `src/lib/estimates/server.ts` — `bulkUpdateEstimateItems()` pour la persistence
  - `src/lib/estimates/client.ts` — wrapper client du bulk update
- Dependances : EST-161

---

## EST-163 — Apprentissage des corrections

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que le systeme apprenne de mes corrections manuelles
> pour ameliorer les suggestions futures, afin de reduire le travail repetitif.

### Criteres d'acceptation

- [ ] Lorsqu'un utilisateur modifie manuellement un champ qui avait ete pre-rempli par
      une suggestion, la correction est enregistree dans la table `suggestion_corrections`
- [ ] La table `suggestion_corrections` stocke : `rule_id`, `field_name`, `original_value`,
      `corrected_value`, `item_title`, `user_id`, `tenant_id`, `created_at`
- [ ] Apres N corrections identiques (seuil configurable, defaut 3), le systeme propose
      la valeur corrigee en priorite dans les suggestions futures
- [ ] L'apprentissage est configurable par tenant (opt-in) via un parametre dans
      les settings tenant
- [ ] Un admin peut consulter les corrections accumulees et valider/rejeter les
      apprentissages proposes
- [ ] L'historique des corrections est purgeable (retention configurable, defaut 12 mois)
- [ ] Les corrections ne modifient jamais les regles originales — elles creent des
      surcharges de scoring dans le moteur de suggestion

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_suggestion_corrections.sql` — table
    `suggestion_corrections` avec index sur `(rule_id, field_name, corrected_value)`
    et RLS policy scope tenant
  - `src/lib/estimates/suggestion-learning.ts` — fonctions `trackCorrection()`,
    `getLearnings()`, `applyLearningBoost()`, `purgeLearnings()`
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — detection des modifications
    post-suggestion, appel `trackCorrection()` en arriere-plan
  - `src/lib/estimates/suggestion-scoring.ts` — integration du boost d'apprentissage
    dans le calcul de score
- Reutiliser :
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()` pour les requetes DB
  - Fonctions DB `current_tenant_id()` pour le scope tenant
- Dependances : EST-161

---

## EST-164 — Suggestions depuis le catalogue

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux que les prix du catalogue soient proposes automatiquement
> lors de la saisie d'un article reference, afin d'utiliser les prix a jour.

### Criteres d'acceptation

- [ ] Lors de la saisie du titre d'un item dans l'editeur, une recherche autocomplete
      interroge la table `supplier_pricebook` en temps reel (debounce 300ms)
- [ ] Les resultats affichent : nom du fournisseur, designation, prix unitaire HT,
      unite, date de derniere mise a jour
- [ ] Un clic sur un resultat applique le prix unitaire et l'unite a la ligne en cours
- [ ] Les prix dont la date de mise a jour depasse 90 jours sont signales visuellement
      (badge "prix ancien") pour alerter le chiffreur
- [ ] La recherche est scope au tenant courant et supporte la correspondance partielle
      sur la designation
- [ ] Les indices materiaux (`material_indices`) sont pris en compte pour ajuster le
      prix si un indice de revision est disponible
- [ ] Maximum 10 resultats affiches, tries par pertinence puis par date decroissante
- [ ] Retourner jusqu'a 3 alternatives fournisseur par article : meilleur prix, prix le plus recent, fournisseur prefere du tenant
- [ ] Le dropdown de suggestions affiche les fournisseurs en format comparatif compact : nom fournisseur | prix | date | ref
- [ ] L'utilisateur peut selectionner une alternative specifique, qui est alors liee a la ligne via `selected_supplier_price_id`
- [ ] Seuil "prix stale" uniformise a 90 jours (remplace "6 mois"), configurable par feature flag `STALE_PRICE_DAYS` (defaut 90)
- [ ] Badge "stale" affiche sur la page catalogue `/dashboard/prices` (colonne "Anciennete")
- [ ] Filtre "Prix anciens seulement" sur la page catalogue pour identifier les articles a mettre a jour

### Notes techniques

- Fichiers a creer :
  - `src/app/api/estimates/[versionId]/suggest-prices/route.ts` — endpoint GET avec
    query param `q` pour la recherche, retourne les prix correspondants du pricebook
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — ajout du composant
    autocomplete prix dans la colonne titre/designation, integration du fetch
    vers l'endpoint suggest-prices
- Reutiliser :
  - `src/lib/catalogue/server.ts` — logique existante d'acces au catalogue
  - `src/lib/estimates/errors.ts` — `badRequest()`, `toErrorResponse()`
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
  - Tables `supplier_pricebook`, `material_indices` existantes
- Dependances : aucune (s'appuie sur les tables catalogue existantes BC-009)

---

## EST-030 — Comparaison multi-fournisseurs par article

**Priorite:** P1 | **Effort:** L | **Milestone:** M2

### User Story

> En tant que chiffreur, je veux comparer jusqu'a 3 prix fournisseurs pour un article, afin de choisir la meilleure offre.

> **Origine PRD:** `MM_BDC_V1.1.csv` — 3 colonnes fournisseur par article avec nom, prix, reference et URL.

### Criteres d'acceptation

- [ ] Lors du match catalogue (EST-164), afficher jusqu'a 3 alternatives fournisseur avec : nom, prix unitaire, reference fournisseur, URL catalogue, date de derniere mise a jour
- [ ] Nouvelle colonne `selected_supplier_price_id` (FK nullable) sur `estimate_items` : reference au prix fournisseur choisi
- [ ] Panneau de comparaison accessible depuis le menu contextuel de la ligne (clic droit → "Comparer fournisseurs")
- [ ] Le panneau affiche les 3 alternatives en colonnes avec mise en evidence du meilleur prix
- [ ] Lien cliquable vers l'URL catalogue du fournisseur (ouverture dans un nouvel onglet)
- [ ] Badge visuel sur la ligne si le fournisseur le moins cher n'est pas celui selectionne
- [ ] Les prix fournisseurs dont la date depasse 90 jours sont signales visuellement (badge "prix ancien"), seuil configurable via feature flag `STALE_PRICE_DAYS`
- [ ] L'export BDC (EST-202) inclut les 3 colonnes fournisseur pour chaque article

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/SupplierComparisonPanel.tsx` — panneau de comparaison avec colonnes fournisseur, mise en evidence du meilleur prix, liens URL
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — menu contextuel "Comparer fournisseurs", badge visuel, integration du panneau
  - `src/lib/estimates/schemas.ts` — ajouter `selected_supplier_price_id` aux schemas
  - `supabase/migrations/0xx_supplier_selection.sql` — FK `selected_supplier_price_id` sur `estimate_items`
- Reutiliser :
  - `src/lib/catalogue/server.ts` — acces au pricebook fournisseur existant
  - `src/app/api/estimates/[versionId]/suggest-prices/route.ts` — endpoint de suggestions catalogue (EST-164)
- Dependances : EST-164 (suggestions catalogue)
