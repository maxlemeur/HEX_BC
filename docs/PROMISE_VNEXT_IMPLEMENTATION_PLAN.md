# Retour codebase vs promesse produit

## Objet

Ce document a deux buts:

1. verifier si le retour LLM recu correspond bien a la codebase reelle
2. produire une base de plan d'implementation pour une nouvelle version centree sur:
   - la promesse produit
   - l'experience utilisateur
   - la reutilisation maximale des briques deja presentes

Le point de reference retenu est le flux principal prouve dans le code:

`affaire -> intake -> brief -> import DPGF -> plans -> takeoff -> apply -> price suggestions`

## 1. Verdict global

Le retour LLM est **globalement bon sur l'architecture generale**, mais **il sous-estime plusieurs capacites existantes** et **surclasse certains "absent" qui devraient etre "partiel"**.

### Ce que le retour a bien compris

- le flux principal actuel est bien `affaire-first`
- `intake`, `import DPGF`, `takeoff`, `version-zero`, `generated-ouvrages` sont bien des sous-systemes distincts
- `version-zero` n'est pas un moteur de pricing complet
- le takeoff est un pipeline asynchrone avec revue/apply
- la promesse "avant midi, sans erreur, tout automatique" depasse la realite actuelle du code

### Ce que le retour sous-estime ou classe mal

1. **DPGF PDF**
   - Le retour dit `absent`.
   - Verdict codebase: **partiel**.
   - Pourquoi: il n'existe pas de pipeline prouve `DPGF PDF -> dpgf_rows_raw -> mapping -> version`, mais il existe un traitement PDF tabulaire cote takeoff.

2. **Import de grilles tarifaires fournisseurs**
   - Le retour dit `absent`.
   - Verdict codebase: **partiel a existant selon le scope**.
   - Pourquoi: un vrai sous-systeme `catalogue / supplier_pricebook` existe, avec import CSV, resolution d'entites, suggestions, comparaison et persistence. En revanche, l'import Excel brut des grilles fournisseurs n'est pas prouve tel quel.

3. **Arbitrage fournisseurs ligne par ligne**
   - Le retour dit `absent`.
   - Verdict codebase: **partiel**.
   - Pourquoi: il existe un "best price" par ligne et un panneau de comparaison fournisseur, mais la selection reste utilisateur et non un arbitrage automatique ferme de bout en bout.

4. **Export devis PDF**
   - Le retour dit `absent`.
   - Verdict codebase: **existant**.
   - Pourquoi: generation PDF, print page, statut PDF, envoi email avec PDF existent reellement.

5. **Bons de commande fournisseurs**
   - Le retour dit `absent`.
   - Verdict codebase: **partiel**.
   - Pourquoi: il existe un sous-systeme `purchase_orders` complet avec creation, edition, impression, zip et documents fournisseurs attaches. Ce qui manque, c'est la generation automatique de ces bons de commande depuis le devis finalise.

## 2. Audit detaille du retour LLM

### 2.1 DPGF PDF

Le retour LLM concluait que l'extraction DPGF PDF etait absente.

### Ce que montre vraiment le code

- [src/lib/takeoff/document-classifier.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/takeoff/document-classifier.ts)
  - classe les documents en `structured`, `tabular_pdf`, `complex_plan`, `unsupported`
  - les indices `dpgf`, `bpu`, `dqe`, `bordereau`, `quantitatif`, `estimatif`, `decomposition` pointent explicitement vers `tabular_pdf`
- [src/components/takeoff/TakeoffUploadForm.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/takeoff/TakeoffUploadForm.tsx)
  - niveau B = "Extraction de tableaux PDF"
  - niveau C = "Pre-estimation sur plans PDF"
  - accepte explicitement les PDF
- [src/app/api/takeoff/jobs/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/takeoff/jobs/route.ts)
  - cree un job takeoff depuis un upload direct
- [src/lib/takeoff/server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/takeoff/server.ts)
  - `createTakeoffJobFromFormData(...)` gere les PDF
- [src/lib/takeoff/processor.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/takeoff/processor.ts)
  - support `pdf_vision` et `pdf_vision_chunked`

### Conclusion

Le codebase **sait lire des PDF tabulaires** et en extraire des tableaux/quantites via le takeoff.  
En revanche, il n'y a **pas de preuve** qu'un DPGF PDF alimente aujourd'hui le pipeline canonique `dpgf_imports -> mappings -> create_estimate_version_from_import_lines`.

Donc:

- `DPGF PDF -> extraction utile`: `partiel`
- `DPGF PDF -> import DPGF canonique complet`: `absent`

### 2.2 Import de grilles tarifaires fournisseurs

Le retour LLM concluait que cette partie etait absente.

### Ce que montre vraiment le code

- [src/components/catalogue/PriceBookCsvImport.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/catalogue/PriceBookCsvImport.tsx)
  - wizard d'import de `pricebook`
  - mapping de colonnes `supplier_name`, `product_reference`, `product_designation`, `unit_price`, `currency`
  - resolution des inconnus et creation d'entites manquantes
- [src/lib/catalogue/csv-import.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/catalogue/csv-import.ts)
  - validation et normalisation des rows de pricebook
  - support d'un profil `mm_bdc`
- [src/lib/catalogue/server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/catalogue/server.ts)
  - `resolvePriceImportSuggestions(...)`
  - `createMissingPriceImportEntities(...)`
  - `linkMappedRowsToCatalogue(...)`
  - appel RPC `bulk_create_supplier_prices`
- [src/app/api/catalogue/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/catalogue/route.ts)
  - boundary HTTP du sous-systeme catalogue
- [supabase/migrations/014_catalogue_pricebook_indices_s4.sql](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/supabase/migrations/014_catalogue_pricebook_indices_s4.sql)
  - cree `supplier_pricebook`
- [supabase/migrations/015_catalogue_helpers_s4.sql](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/supabase/migrations/015_catalogue_helpers_s4.sql)
  - cree `bulk_create_supplier_prices`

### Conclusion

Le codebase a **une vraie brique catalogue/fournisseurs/prix**, mais elle est aujourd'hui:

- centree `CSV` pour l'import de grilles
- pas demontree comme un parseur Excel natif "deposez vos 4 grilles Excel et c'est boucle"
- pas encore orchestree dans le flux affaire-first principal

Donc:

- `import/normalisation de grilles tarifaires fournisseurs`: `partiel`
- `import Excel natif plug-and-play dans le flux promesse`: `partiel a absent selon le niveau d'exigence`

### 2.3 Arbitrage multi-fournisseurs

Le retour LLM concluait que cette capacite etait absente.

### Ce que montre vraiment le code

- [src/lib/estimates/server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/estimates/server.ts)
  - `suggestEstimateCataloguePrices(...)`
  - `getEstimateSupplierComparisons(...)`
  - calcule un `best_supplier_price_id`
  - calcule aussi `most_recent` et `preferred_supplier`
- [src/app/api/estimates/[versionId]/supplier-comparisons/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/estimates/[versionId]/supplier-comparisons/route.ts)
  - expose les comparaisons par ligne
- [src/components/estimates/SupplierComparisonPanel.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/estimates/SupplierComparisonPanel.tsx)
  - affiche jusqu'a 3 alternatives
  - badge `Meilleur prix`
- [src/components/estimates/hooks/useEstimateSupplierComparison.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/estimates/hooks/useEstimateSupplierComparison.ts)
  - selectionne une alternative et persiste `selected_supplier_price_id`

### Conclusion

Le codebase implemente **une vraie comparaison multi-fournisseurs par article**.

Mais:

- le "meilleur prix" reste une suggestion
- la selection finale est declenchee par l'utilisateur
- il n'y a pas de boucle fermee prouvee "TIMAX arbitre automatiquement ligne par ligne sans validation"

Donc:

- `comparaison multi-fournisseurs par article`: `existant`
- `arbitrage automatique ligne par ligne sans intervention`: `partiel`

### 2.4 Stock-aware pricing

Le retour LLM concluait que cette capacite etait absente.

### Verification code

Les recherches dans:

- `src/lib`
- `src/app`
- `src/components`
- `supabase/migrations`

ne montrent pas de sous-systeme credible de:

- stock fournisseur
- disponibilite magasin
- reservation stock
- arbitrage par disponibilite

### Conclusion

Verdict confirme:

- `stock-aware pricing`: `absent`

### 2.5 Export devis PDF

Le retour LLM concluait que cette capacite etait absente.

### Ce que montre vraiment le code

- [src/lib/estimates/pdf-generator.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/estimates/pdf-generator.tsx)
  - generation binaire PDF
  - upload storage
  - hash
  - signed URL
- [src/app/dashboard/estimates/[versionId]/print/page.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/dashboard/estimates/[versionId]/print/page.tsx)
  - page print
- [src/components/PrintButton.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/PrintButton.tsx)
  - bouton `Imprimer / PDF`
- [src/app/api/estimates/[versionId]/send/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/estimates/[versionId]/send/route.ts)
  - envoi du devis par email
- [src/lib/email/send-estimate.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/email/send-estimate.ts)
  - s'appuie sur le PDF du devis

### Conclusion

Verdict corrige:

- `estimate PDF export`: `existant`

### 2.6 Bons de commande fournisseurs

Le retour LLM concluait que cette capacite etait absente.

### Ce que montre vraiment le code

- [src/app/api/purchase-orders/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/purchase-orders/route.ts)
  - creation de bons de commande
- [src/app/dashboard/orders/new/page.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/dashboard/orders/new/page.tsx)
  - UI de creation de commande
- [src/app/dashboard/orders/[id]/page.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/dashboard/orders/[id]/page.tsx)
  - page detail d'une commande
- [src/app/dashboard/orders/[id]/print/page.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/dashboard/orders/[id]/print/page.tsx)
  - version impression / PDF
- [src/app/api/purchase-orders/[id]/zip/route.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/app/api/purchase-orders/[id]/zip/route.ts)
  - zip d'une commande avec ses documents
- [src/components/PurchaseOrderDocument.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/PurchaseOrderDocument.tsx)
  - document de bon de commande
- [src/components/DevisManager.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/DevisManager.tsx)
  - gestion des devis fournisseurs attaches a la commande
- [src/components/DevisUploader.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/DevisUploader.tsx)
  - upload de devis fournisseurs PDF/images/Excel

### Conclusion

Le sous-systeme "bons de commande fournisseur" existe reellement.

En revanche, le code ne prouve pas aujourd'hui:

- une generation automatique de bons de commande depuis le devis final
- un decoupage automatique par fournisseur a partir des `selected_supplier_price_id`

Donc:

- `purchase order subsystem`: `existant`
- `purchase orders automatically ready from estimate`: `partiel`

## 3. Mapping corrige de la promesse produit

| Promesse | Niveau reel dans la codebase | Verdict |
| --- | --- | --- |
| Drop de dossier heterogene dans une affaire | Intake multi-format + brief + registre | `existant` |
| DPGF tabulaire -> lignes de devis | Imports + mapping + RPC SQL | `existant` |
| DPGF PDF -> lignes de devis | takeoff PDF tabulaire oui, import DPGF canonique non | `partiel` |
| Plans PDF -> quantites + confiance + evidence | takeoff B/C + review/apply | `existant` |
| V0 depuis brief | version-zero drafts | `existant` |
| Ouvrages depuis extraits documentaires | generated-ouvrages | `existant` |
| Grilles fournisseurs -> base de prix | catalogue/pricebook CSV | `partiel` |
| Comparaison multi-fournisseurs par article | supplier comparison panel + best price | `existant` |
| Arbitrage automatique ferme sans intervention | suggestion + selection manuelle | `partiel` |
| Pricing par stock | pas de sous-systeme de stock | `absent` |
| Export devis PDF | pdf-generator + print + send | `existant` |
| Bons de commande fournisseur | purchase_orders + print + zip + devis attaches | `existant` |
| Bons de commande auto-prets depuis le devis | pas de pont direct prouve depuis estimate | `partiel` |

## 4. Ce que la promesse produit peut honnêtement dire aujourd'hui

### Promesse credible aujourd'hui

TIMAX est deja credible comme:

- plateforme `affaire-first` pour centraliser un dossier heterogene
- outil d'import DPGF **tabulaire** avec mapping et creation de devis
- moteur de takeoff sur plans PDF avec revue, confiance, evidence et application dans le devis
- systeme de comparaison multi-fournisseurs avec suggestions de prix et selection par ligne
- outil d'export devis PDF et d'export BDC
- socle de gestion de bons de commande fournisseur

### Ce que la promesse actuelle sur-vend si elle n'est pas nuancee

- `DPGF PDF de 3000 lignes -> devis auto` comme si c'etait deja le pipeline principal
- `4 grilles tarifaires Excel -> meilleur prix automatique` comme si le flux etait deja natif et orchestre de bout en bout
- `bons de commande fournisseurs prets` comme si le devis final alimentait deja automatiquement les commandes
- `zero erreur` et `avant midi` sans boucle de revue humaine ni incertitude

## 5. Ligne directrice VNext

La bonne strategie n'est pas de creer un nouveau moteur parallele.

La bonne strategie est de **fermer les trous entre des briques deja fortes**:

1. intake affaire
2. import DPGF
3. plan sync / takeoff
4. supplier pricebook / supplier comparison
5. PDF / BDC / purchase orders

En d'autres termes:

- moins de branches paralleles
- plus d'orchestration UX autour du hub affaire
- plus de continuites de donnees entre les sous-systemes

## 6. Plan d'implementation VNext centre promesse produit + UX

### Phase 1 - Rendre la promesse actuelle credible dans l'UX

#### Objectif produit

Faire en sorte que l'utilisateur vive un parcours unique:

`Je depose mes fichiers -> TIMAX les route -> je vois l'etat d'avancement -> je complete/revois -> j'obtiens un devis structuré et metrage`

#### Travaux

1. **Unified intake orchestration**
   - unifier dans le hub affaire la lecture des pieces `dpgf`, `plans`, `cctp`, `bpu_dqe`, `annexes`, `emails`
   - afficher pour chaque piece son destin:
     - `brief`
     - `import DPGF`
     - `plan set`
     - `hors flux principal`
   - reutiliser:
     - [src/lib/affaires/intake-server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/affaires/intake-server.ts)
     - [src/components/affaires/IntakeWorkspace.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/affaires/IntakeWorkspace.tsx)
     - [src/components/affaires/AffaireHub.tsx](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/components/affaires/AffaireHub.tsx)

2. **Clarifier les branches dans l'UI**
   - faire apparaitre dans l'interface:
     - `DPGF tabulaire`
     - `PDF tabulaire`
     - `plan PDF`
     - `V0 depuis brief`
     - `generated ouvrages`
   - ne plus laisser croire qu'il s'agit d'un unique moteur invisible

3. **Vue de pipeline unique**
   - etapes visibles:
     - `pieces recues`
     - `brief genere`
     - `DPGF importe`
     - `plans synchronises`
     - `takeoff termine`
     - `pricing a confirmer`
     - `sorties prêtes`

#### Resultat UX attendu

Avant meme d'ajouter des moteurs, l'experience devient coherent avec la promesse "on absorbe votre chaos documentaire dans un seul workflow".

### Phase 2 - Fermer le trou DPGF PDF

#### Objectif produit

Transformer la phrase marketing "DPGF PDF 3000 lignes" en capacite reelle.

#### Travaux

1. **Ajouter un pipeline `DPGF PDF -> rows_raw`**
   - reutiliser la logique de detection `tabular_pdf`
   - reutiliser l'infra takeoff PDF
   - produire en sortie des lignes compatibles avec:
     - `dpgf_rows_raw`
     - `mappings`
     - `import-flow`

2. **Eviter un troisieme pipeline**
   - ne pas faire un import DPGF PDF totalement a part
   - l'objectif est de se brancher sur:
     - [src/lib/imports/server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/imports/server.ts)
     - [src/lib/mappings/server.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/mappings/server.ts)
     - [src/lib/affaires/import-flow.ts](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/src/lib/affaires/import-flow.ts)

3. **UX**
   - depuis le drop initial, si le fichier est un PDF tabulaire:
     - TIMAX l'envoie vers "extraction DPGF PDF"
     - puis le fait arriver dans le wizard de mapping existant

#### Resultat UX attendu

Le message "deposez votre DPGF PDF" devient vrai sans casser l'architecture.

### Phase 3 - Brancher vraiment les grilles fournisseurs au chiffrage

#### Objectif produit

Passer de "on a un catalogue" a "vos grilles fournisseurs nourrissent le chiffrage de cette affaire".

#### Travaux

1. **Accepter au minimum CSV et XLSX pour le pricebook**
   - aujourd'hui le pricebook import visible est CSV
   - ajouter un parseur XLSX si besoin
   - normaliser ensuite vers le pipeline catalogue existant

2. **Relier le pricebook a l'affaire/version**
   - aujourd'hui la brique catalogue existe, mais elle est percue comme annexe
   - relier visuellement le chargement de grilles au hub affaire ou a l'editeur estimate

3. **Rattachement automatique par ligne**
   - a partir d'un item estimate:
     - chercher les alternatives fournisseur
     - calculer `best_price`
     - proposer une selection par defaut

4. **Conserver l'explicabilite**
   - garder:
     - `best_price`
     - `most_recent`
     - `preferred_supplier`
   - exposer ces raisons dans l'UX

#### Resultat UX attendu

L'utilisateur voit ses grilles fournisseurs devenir directement actionnables sur les lignes du devis.

### Phase 4 - Passer de la comparaison a l'arbitrage assiste

#### Objectif produit

Rendre credible la phrase:

`Le moteur arbitre ligne par ligne`

#### Travaux

1. **Mode suggestion auto**
   - preselectionner `best_supplier_price_id`
   - montrer les exceptions seulement si:
     - prix stale
     - unite douteuse
     - pas de match fort

2. **Mode validation rapide**
   - `accepter toutes les recommandations`
   - `revoir uniquement les exceptions`

3. **Preparation future pour le stock**
   - modeliser des points d'extension pour:
     - disponibilite
     - MOQ
     - delai
   - sans promettre encore du vrai stock-aware pricing

#### Resultat UX attendu

Le systeme reste explicable, mais se rapproche d'un arbitrage quasi-automatique.

### Phase 5 - Boucler la sortie achats

#### Objectif produit

Transformer:

`les bons de commande fournisseurs sont prêts`

en realite produit.

#### Travaux

1. **Pont estimate -> purchase_orders**
   - a partir des lignes avec `selected_supplier_price_id`
   - grouper par fournisseur
   - creer des `purchase_orders` en brouillon
   - pre-remplir les lignes

2. **Conserver les exports existants**
   - devis PDF
   - export BDC XLSX
   - commande fournisseur print / zip

3. **UX**
   - bouton depuis l'editeur ou la revue finale:
     - `Generer les bons de commande`
   - ecran de validation:
     - regroupement par fournisseur
     - ajustements manuels

#### Resultat UX attendu

Le passage du chiffrage aux achats devient enfin fluide et raccord avec la promesse.

## 7. Parcours utilisateur cible VNext

### Scenario cible

1. L'utilisateur cree une affaire ou ouvre une affaire.
2. Il depose:
   - un DPGF PDF ou tabulaire
   - des grilles fournisseurs
   - des plans PDF
   - autres annexes
3. TIMAX route automatiquement chaque piece:
   - brief
   - import DPGF
   - plans / takeoff
   - catalogue fournisseur
4. Le systeme construit:
   - une base devis
   - une base de quantites
   - une base de prix
5. L'utilisateur revoit seulement:
   - les ambiguïtés
   - les ecarts
   - les exceptions prix
6. TIMAX genere:
   - devis PDF
   - export BDC
   - brouillons de commandes fournisseurs

### Principe UX

L'utilisateur ne doit plus percevoir:

- 5 modules techniques
- 3 branches IA
- 2 ou 3 pipelines qui ne se parlent pas

Il doit percevoir:

- **un seul workflow**
- avec etapes explicites
- et des exceptions visibles

## 8. Priorites recommandees

### P0

- unifier l'UX autour du hub affaire
- combler le trou `DPGF PDF`
- brancher les grilles fournisseurs au parcours affaire/devis
- rendre visible un mode "recommandations prix par ligne"

### P1

- preselection automatique du meilleur fournisseur
- generation de bons de commande a partir du devis
- experience "review by exception"

### P2

- stock-aware pricing
- arbitrage achat avance
- optimisation globale multi-contraintes

## 9. Resume executif

Le retour LLM etait bon sur la grande image, mais trop severe sur quatre points importants:

- le PDF DPGF n'est pas `absent`, il est `partiel`
- les grilles fournisseurs ne sont pas `absentes`, elles existent deja en `catalogue/pricebook`
- la comparaison multi-fournisseurs existe deja
- l'export devis PDF et les bons de commande existent deja comme sous-systemes

La vraie opportunite VNext n'est donc pas de "tout construire".

La vraie opportunite est de:

1. **stitcher** les briques existantes dans un workflow unique
2. fermer trois trous critiques:
   - DPGF PDF
   - branchage pricebook dans le chiffrage
   - generation des commandes depuis le devis
3. realigner la promesse produit sur une experience utilisateur fluide, progressive et credible
