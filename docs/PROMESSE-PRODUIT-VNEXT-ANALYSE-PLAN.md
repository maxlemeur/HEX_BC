# Analyse codebase et plan vNext

## Objet

Verifier si le retour LLM recu correspond bien a la codebase actuelle, puis en tirer un document de cadrage pour une nouvelle version alignee sur:

- la promesse produit
- la realite du code
- l'experience utilisateur cible

Ce document est base sur une lecture directe du code. Il distingue:

- ce que la codebase prouve reellement
- ce que le retour LLM a correctement identifie
- ce qu'il sous-estime ou classe a tort comme absent
- ce qui manque encore pour tenir la promesse marketing de bout en bout

---

## 1. Verdict global sur le retour LLM

### Conclusion courte

Le retour LLM est **globalement juste sur le flux principal**, mais **trop pessimiste sur plusieurs briques deja presentes** dans la codebase.

Il est:

- **correct** sur le fait que le flux principal prouve par le code est `affaire-first`
- **correct** sur le fait que `intake`, `import DPGF`, `takeoff`, `V0` et `generated-ouvrages` sont des sous-systemes distincts
- **correct** sur le fait que la promesse marketing "tout boucle automatiquement avant midi" n'est pas encore soutenue par le code

Il est en revanche **incomplet ou incorrect** sur plusieurs points:

1. il classe trop vite comme absents des blocs qui existent deja:
   - export PDF devis
   - envoi du devis par email
   - export BDC
   - module de bons de commande
   - import de pricebook fournisseur
   - comparaison fournisseurs ligne par ligne

2. il sous-estime la maturite de la couche `catalogue / supplier_pricebook`

3. il ne distingue pas assez:
   - **absence d'automatisation complete**
   - vs **presence de briques reelles mais encore non orchestrees de bout en bout**

### Verdict detaille

- **Flux affaire-first**: correct
- **Import DPGF PDF**: correct de le dire absent
- **Grilles fournisseurs**: le retour est trop dur, c'est **partiel**, pas absent
- **Analyse plans / takeoff**: correct, avec nuance sur le niveau de preuve selon A/B/C
- **V0 / generated-ouvrages**: correct
- **Export PDF / envoi client**: incorrect de les traiter comme absents
- **Bons de commande**: incorrect de les traiter comme absents, mais correct de dire que l'automatisation bout-en-bout manque
- **Arbitrage fournisseur automatique global**: correct de dire que ce n'est pas encore un moteur complet
- **Stock**: correct de le dire absent

---

## 2. Ce que la codebase prouve reellement

## 2.1 Le flux principal actuel

Le flux principal actuel est bien:

`affaire -> intake -> brief -> import DPGF -> plan sync -> takeoff -> review/apply -> pricing assisté`

Preuves principales:

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/lib/affaires/intake-server.ts`
- `src/lib/imports/server.ts`
- `src/lib/mappings/server.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/lib/affaires/intake-plan-sync.ts`
- `src/lib/takeoff/plans.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `src/lib/takeoff/price-suggestions.ts`

### Ce que cela veut dire produit

TIMAX sait deja:

- absorber un dossier heterogene dans une affaire
- classifier les pieces
- generer un brief
- importer un DPGF tabulaire
- le mapper vers le devis
- synchroniser des plans
- lancer un takeoff IA
- appliquer des quantites au devis
- assister le pricing

---

## 2.2 Intake affaire: present et solide

Preuves:

- `src/lib/affaires/intake.ts`
- `src/lib/affaires/intake-server.ts`
- `src/app/api/affaires/[projectId]/intake/files/route.ts`
- `src/components/affaires/IntakeWorkspace.tsx`
- `src/components/affaires/BriefDraftCard.tsx`

Ce qui existe:

- upload multi-fichiers
- support PDF / images / txt / csv / eml / xls / xlsx / doc / docx
- classification metier `dpgf / plans / cctp / bpu_dqe / annexes / emails / a_classer`
- reclassification manuelle
- generation d'un brief structure
- confirmation du brief
- synchronisation aval

Verdict sur le retour LLM:

- **correct**

---

## 2.3 Import DPGF: present mais tabulaire

Preuves:

- `src/lib/imports/parser.ts`
- `src/lib/imports/server.ts`
- `src/app/api/imports/route.ts`
- `src/lib/mappings/server.ts`
- `src/app/api/mappings/route.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/app/dashboard/affaires/_actions/import-flow.ts`
- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`
- `supabase/migrations/20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`

Ce qui existe:

- import `json / csv / xlsx`
- parsing robuste du tabulaire
- mapping de colonnes vers semantique estimate
- normalisation de lignes calculees
- creation d'affaire + V1 depuis import
- creation de nouvelle version depuis import

Ce qui **n'est pas prouve**:

- extraction DPGF depuis **PDF**
- pipeline OCR / table extraction PDF vers `dpgf_rows_raw`

Verdict sur le retour LLM:

- **correct** d'avoir dit que le DPGF PDF n'est pas prouve

Correction importante:

- il faut parler de **DPGF tabulaire** comme capability existante forte
- et de **DPGF PDF** comme capability cible manquante

---

## 2.4 Takeoff: present et credible

Preuves:

- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `src/app/dashboard/affaires/_actions/takeoff.ts`
- `src/app/dashboard/affaires/[projectId]/takeoff/[jobId]/review/page.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`
- `supabase/functions/process_takeoff_job/index.ts`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`

Ce qui existe:

- lancement depuis `plan_set`
- pipeline async
- niveaux A/B/C
- niveau B avec tables
- niveau C avec `confidence`, `source_page`, `evidence`
- review humaine
- apply dans le devis

Verdict sur le retour LLM:

- **correct**, avec bonne intuition sur la force de cette brique

Nuance:

- l'expression marketing "metre sur plans et documents" est plus large que ce que le code prouve
- le code prouve surtout un flux fort sur `plan_sets / plan_files` PDF

---

## 2.5 V0 et generated-ouvrages: le retour est juste

Preuves:

- `src/lib/estimates/version-zero-drafts.ts`
- `src/app/api/estimates/[versionId]/version-zero-drafts/route.ts`
- `src/lib/estimates/structure-drafts.ts`
- `src/lib/estimates/generated-ouvrages.ts`
- `src/app/dashboard/affaires/_actions/generated-ouvrages.ts`

Ce qui existe:

- V0 de structure / lots / lignes depuis brief
- generated-ouvrages depuis extraits documentaires

Limite reelle:

- `version-zero-drafts.ts` materialise avec `unit_price_ht_cents: 0`

Verdict sur le retour LLM:

- **correct**

---

## 2.6 Catalogue, tarifs fournisseurs, pricebook: le retour sous-estime l'existant

Preuves fortes:

- `src/components/catalogue/PriceBookCsvImport.tsx`
- `src/lib/catalogue/csv-import.ts`
- `src/lib/catalogue/server.ts`
- `src/app/api/prices/route.ts`
- `src/app/dashboard/catalogue/page.tsx`
- `src/components/catalogue/PricesManager.tsx`
- `supabase/migrations/014_catalogue_pricebook_indices_s4.sql`
- `supabase/migrations/015_catalogue_helpers_s4.sql`
- `supabase/migrations/20260222001500_est164_catalogue_suggestions.sql`

Ce que la codebase prouve:

- il existe un vrai module `catalogue`
- il existe une table `supplier_pricebook`
- il existe un import CSV de pricebook fournisseur
- il existe des operations bulk create / bulk atomic create
- il existe une resolution de correspondance fournisseur / produit
- il existe des indices materiaux
- il existe une liaison entre lignes mappees et catalogue (`link-mapped-rows`)

Ce que cela change dans l'analyse:

- dire que les grilles fournisseurs sont "absentes" est **faux**
- la bonne qualification est:
  - **existant** pour un socle catalogue / pricebook
  - **partiel** pour la promesse "quatre grilles Excel droppees dans le meme flux"

Limites reelles:

- l'UI d'import actuelle s'appelle `PriceBookCsvImport`
- elle est clairement centree sur le CSV
- l'integration directe dans le flux affaire `drop all files` n'est pas prouvee
- le traitement d'Excel fournisseurs n'est pas prouve comme parcours produit principal

Verdict corrige:

- **tarifs negocies / pricebook**: `existant`
- **import de grilles fournisseurs Excel dans le meme parcours affaire**: `partiel`

---

## 2.7 Comparaison fournisseurs ligne par ligne: present mais assistee, pas full auto

Preuves:

- `src/lib/estimates/server.ts` (`suggestEstimateCataloguePrices`, `getEstimateSupplierComparisons`)
- `src/components/estimates/hooks/useEstimateSupplierComparison.ts`
- `src/components/estimates/SupplierComparisonPanel.tsx`
- `src/app/api/estimates/[versionId]/supplier-comparisons/route.ts`
- `src/components/estimates/EstimateEditorTable.tsx`

Ce qui existe:

- recherche de suggestions catalogue
- alternatives par produit
- `best_price`
- `most_recent`
- `preferred_supplier`
- comparaison ligne par ligne
- badge de mismatch quand le fournisseur selectionne n'est pas le meilleur prix
- selection manuelle d'une alternative fournisseur dans l'editeur

Ce que cela **ne prouve pas**:

- auto-application globale a toutes les lignes
- arbitrage achat complet a l'echelle du devis sans validation humaine
- gestion de stock

Verdict sur le retour LLM:

- **partiellement incorrect**

Correction:

- il ne faut pas dire "aucune logique explicite"
- il faut dire:
  - **comparaison fournisseur par ligne existante**
  - **meilleur prix calcule**
  - **selection encore assistee / manuelle**
  - **pas de moteur full auto multi-fournisseurs global**

---

## 2.8 Export PDF devis et envoi client: le retour LLM est faux ici

Preuves:

- `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- `src/components/EstimateDocument.tsx`
- `src/lib/estimates/pdf-generator.tsx`
- `src/app/api/estimates/[versionId]/pdf/route.ts`
- `src/lib/email/send-estimate.ts`
- `src/components/estimates/SendEstimateModal.tsx`

Ce qui existe:

- print view du devis
- generation de PDF serveur
- stockage `estimate-documents`
- statut de generation PDF
- envoi email du devis avec PDF joint via Resend

Verdict sur le retour LLM:

- **incorrect** quand il le classe implicitement comme absent

Correction:

- `devis PDF part au client` est **deja partiellement/existante**
- ce qui manque encore, c'est surtout l'orchestration automatique dans le grand scenario "avant midi"

---

## 2.9 Export BDC et bons de commande: le retour LLM est trop pessimiste

Preuves:

- `src/app/api/estimates/[versionId]/export/route.ts`
- `src/lib/estimates/bdc-export.ts`
- `src/app/api/purchase-orders/route.ts`
- `src/app/api/purchase-orders/[id]/route.ts`
- `src/app/api/purchase-orders/[id]/zip/route.ts`
- `src/app/api/purchase-orders/[id]/devis/route.ts`
- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/orders/new/page.tsx`
- `src/app/dashboard/orders/[id]/edit/page.tsx`
- `src/components/DevisManager.tsx`
- `src/components/DevisUploader.tsx`
- `src/components/DevisList.tsx`

Ce qui existe:

- module de bons de commande
- creation et edition de bons de commande
- pieces jointes devis fournisseurs sur une commande
- export ZIP de commande
- export BDC XLSX depuis un devis

Ce que cela **ne prouve pas**:

- creation automatique de commandes fournisseurs a partir du devis finalise
- arbitrage auto puis generation instantanee des commandes

Verdict corrige:

- `bons de commande` comme module: **existant**
- `bons de commande prets automatiquement depuis le chiffrage`: **absent/partiel**

---

## 2.10 Stock: le retour LLM est juste

Nous n'avons pas trouve de vraie logique `stock` ou inventaire utilisable dans le moteur de choix fournisseur.

Verdict:

- **correct** de dire que "la robinetterie en stock" n'est pas prouvee

---

## 3. Matrice de capacites mise a jour

| Capability promisee | Etat reel | Verdict |
| --- | --- | --- |
| Dossier heterogene dans une affaire | Intake + brief + register + hub | `existant` |
| Classification des pieces | `document_kind` + reclassification | `existant` |
| Import DPGF tabulaire | import + mapping + RPC | `existant` |
| Import DPGF PDF | aucun pipeline prouve | `absent` |
| Grilles fournisseurs / pricebook | catalogue + import CSV + supplier_pricebook | `existant` |
| Grilles fournisseurs Excel dans le meme parcours | non prouve comme experience unifiee | `partiel` |
| Lignes de devis normalisees | import-flow + computeEstimateLineValues | `existant` |
| Assemblages techniques reconnus automatiquement | seulement indices indirects / structure-drafts | `partiel faible` |
| Analyse plans PDF | takeoff robuste | `existant` |
| Confidence / evidence / page source | surtout niveau C | `partiel fort` |
| V0 depuis brief | version-zero | `existant` |
| Ouvrages depuis extraits documentaires | generated-ouvrages | `existant` |
| Suggestions de prix explicables | takeoff price suggestions | `existant` |
| Comparaison fournisseurs ligne par ligne | supplier comparison panel + best price | `existant` |
| Arbitrage automatique global sans humain | pas prouve | `absent` |
| Stock-aware pricing | pas prouve | `absent` |
| Print / PDF devis | print page + pdf generator | `existant` |
| Envoi devis client | send-estimate + modal | `existant` |
| Module bons de commande | orders + APIs + zip + devis attaches | `existant` |
| Auto-generation commandes depuis devis final | pas prouve | `absent` |
| "Boucle avant midi" full auto | pas soutenu par le code | `absent` |

---

## 4. Relecture critique de la promesse produit

### Ce que le produit peut promettre honnetement aujourd'hui

TIMAX peut deja promettre de facon credible:

- centraliser un dossier de chiffrage dans une affaire
- classifier et resumer les pieces
- importer un DPGF tabulaire et generer une version de devis
- faire du takeoff sur plans PDF avec revue et preuves
- assister le pricing par suggestions et comparaison fournisseurs
- produire un PDF devis et l'envoyer
- exporter un BDC et exploiter un module de bons de commande

### Ce qu'il ne faut pas promettre tel quel aujourd'hui

- "deposez un DPGF PDF et TIMAX le convertit integralement sans preparation"
- "TIMAX arbitre automatiquement fournisseur par fournisseur sur tout le devis"
- "TIMAX sort automatiquement les commandes fournisseurs finales sans intervention"
- "tout est boucle avant midi sans workflow de revue"

### La bonne formulation de transition

Le bon narratif aujourd'hui est:

> TIMAX compresse fortement le temps de preparation, de structuration, de metrage et de pre-pricing. La plateforme centralise le dossier, cree une base de devis exploitable depuis un DPGF tabulaire, applique des quantites depuis les plans PDF, compare des alternatives fournisseurs et produit les documents de sortie. La boucle totalement autonome de bout en bout reste a construire.

---

## 5. Implications UX pour la nouvelle version

Le probleme principal n'est pas seulement le manque de briques.

Le vrai probleme UX est que l'utilisateur n'experimente **pas encore** un seul parcours coherent correspondant a la promesse.

Aujourd'hui, la valeur est dispersee entre:

- intake
- import DPGF
- catalogue / pricebook
- plans / takeoff
- review / apply
- export / orders

### La nouvelle version doit viser une UX unifiee

L'utilisateur doit percevoir un seul parcours:

1. je depose mon dossier
2. TIMAX me dit ce qu'il reconnait
3. TIMAX construit mon devis de depart
4. TIMAX complete les quantites
5. TIMAX propose les meilleurs prix
6. je revele seulement les exceptions et points a arbitrer
7. je sors le devis et les commandes

### Principe UX directeur

**Une seule affaire, un seul timeline de preparation, plusieurs moteurs en tache de fond.**

Cela implique:

- une entree unique
- un statut global de progression
- une notion explicite d'exceptions a traiter
- des suggestions consolidees par ligne
- une sortie lisible `ready to send / ready to order`

---

## 6. Plan d'implementation vNext centre promesse + UX

## Phase 1 - Unifier l'experience sans casser l'existant

### Objectif produit

Transformer le hub affaire en vrai poste de pilotage du scenario:

`depot -> structuration -> metrage -> pricing -> sortie`

### Travail UX

- creer une **zone de depot unique** sur l'affaire
- router automatiquement chaque fichier vers:
  - intake generique
  - import DPGF
  - plan sync
  - import catalogue/pricebook
- afficher une timeline unique:
  - pieces classees
  - DPGF parse
  - plans synchronises
  - takeoff en cours
  - devis structure
  - prix compares
  - export pret

### Travail technique

Reutiliser:

- `src/lib/affaires/intake-server.ts`
- `src/lib/imports/server.ts`
- `src/lib/mappings/server.ts`
- `src/lib/catalogue/csv-import.ts`
- `src/lib/affaires/intake-plan-sync.ts`
- `src/app/dashboard/affaires/_actions/takeoff.ts`

Livrables:

- orchestrateur de depot unifie
- vue de statut par brique
- ecran d'exceptions a resoudre

## Phase 2 - Fermer le trou DPGF PDF

### Objectif produit

Faire coller la promesse "le client m'envoie un DPGF PDF" a la realite du produit.

### Travail technique

Ajouter un pipeline:

- `DPGF PDF -> extraction tabulaire -> dpgf_rows_raw -> mapping existant -> import-flow existant`

Important:

- ne pas creer une nouvelle filiere estimate
- reutiliser le pipeline tabulaire actuel comme point de convergence

### Impact UX

- l'utilisateur depose un PDF
- TIMAX propose "tableaux detectes / a verifier"
- l'utilisateur corrige uniquement les ambiguites
- le reste de l'experience reste le meme

## Phase 3 - Integrer vraiment le pricebook dans le parcours affaire

### Objectif produit

Passer de "module catalogue existe" a "les tarifs negocies alimentent reellement le chiffrage".

### Travail technique

- brancher le pricebook import au parcours affaire
- accepter CSV maintenant, puis Excel ensuite
- relier automatiquement DPGF / produits / supplier_pricebook quand le matching est evident
- conserver une file de resolution pour les cas ambigus

Reutiliser:

- `src/components/catalogue/PriceBookCsvImport.tsx`
- `src/lib/catalogue/csv-import.ts`
- `src/lib/catalogue/server.ts`
- `src/app/api/prices/route.ts`
- `src/lib/estimates/server.ts` (`suggestEstimateCataloguePrices`, `getEstimateSupplierComparisons`)

### Impact UX

- l'utilisateur voit que ses grilles fournisseurs sont "prises en compte"
- chaque ligne de devis peut afficher:
  - meilleur prix detecte
  - fournisseur prefere
  - prix ancien / a revoir
  - ambiguite reference / unite / produit

## Phase 4 - Passer de la comparaison a la pre-selection assistee

### Objectif produit

Ne plus seulement comparer ligne par ligne, mais proposer un pre-arbitrage global.

### Travail technique

- calculer un `best_supplier_price_id` a l'echelle du devis entier
- proposer un mode "preselection automatique"
- journaliser les lignes qui divergent du meilleur prix pour revue
- introduire un rapport de couverture pricing:
  - lignes couvertes
  - lignes ambiguës
  - lignes sans prix
  - lignes avec prix stale

### Important

La premiere iteration doit rester **assistive**, pas full auto.

Le moteur doit:

- proposer
- preselectionner
- expliquer
- laisser l'humain arbitrer les exceptions

## Phase 5 - Sortie operationnelle "pret a envoyer / pret a commander"

### Objectif produit

Transformer des briques existantes en vrai "finish line" du parcours.

### Travail technique

- consolider le PDF devis comme sortie officielle
- brancher l'envoi email dans le workflow final
- utiliser l'export BDC et le module orders comme base d'une generation de commandes
- construire un wizard:
  - regrouper par fournisseur
  - generer brouillons de commandes
  - attacher les devis fournisseurs existants si disponibles

### Important

La codebase a deja:

- PDF devis
- send estimate
- BDC export
- purchase orders

Le manque n'est pas l'absence totale de briques, mais leur **orchestration produit**.

## Phase 6 - Promesse cible defendable

### Promesse vNext recommandee

> Deposez le dossier du client dans une affaire TIMAX. La plateforme classe les pieces, construit une base de devis depuis votre DPGF, complete les quantites depuis les plans, compare les tarifs fournisseurs ligne par ligne et vous concentre sur les exceptions. En quelques heures, vous passez du dossier brut a un devis pret a envoyer et a des commandes fournisseurs pretes a finaliser.

Cette promesse est:

- ambitieuse
- alignee avec le code existant
- extensible vers le "avant midi"
- beaucoup plus defendable que la promesse full auto actuelle

---

## 7. Backlog d'implementation recommande

### Epic 1 - Intake unifie

- routeur de depot par type de fichier
- timeline globale du dossier
- etat de progression multi-briques

### Epic 2 - DPGF PDF

- extraction tableaux PDF
- revue des tableaux detectes
- alimentation de `dpgf_rows_raw`

### Epic 3 - Pricebook integre

- import pricebook dans le parcours affaire
- mapping fournisseur / produit
- resolution d'ambiguites

### Epic 4 - Pricing coverage

- comparaison fournisseur par ligne a l'echelle du devis
- preselection automatique assistive
- explication et flags de qualite

### Epic 5 - Finish line

- statut `ready to send`
- statut `ready to order`
- generation assistee de commandes fournisseurs

### Epic 6 - Excellence operationnelle

- fiabiliser le carry-over takeoff
- unifier les flux legacy
- simplifier la surface utilisateur autour d'un seul parcours

---

## 8. Reponse finale a la question "le retour correspond-il a notre codebase ?"

### Oui, sur le fond

Le retour correspond bien a l'architecture generale et a la critique principale:

- TIMAX n'est pas encore un moteur full auto "tout boucle avant midi"
- la force actuelle est un socle affaire-first compose de plusieurs moteurs complementaires

### Non, sur plusieurs details importants

Le retour est trop pessimiste sur l'existant deja livre:

- export PDF devis
- envoi devis par email
- catalogue / supplier_pricebook
- import CSV de pricebook
- comparaison fournisseurs ligne par ligne
- export BDC
- module de bons de commande

### La bonne synthese

Le retour LLM est **utilisable comme base de vision**, mais il doit etre **corrige** avant de devenir une base de plan.

La vraie lecture codebase est:

> le produit a deja la plupart des briques structurelles necessaires pour porter la promesse, mais elles sont encore dispersees, partielles ou non orchestrees dans une seule experience utilisateur continue.

C'est ce constat qui doit guider la nouvelle version.
