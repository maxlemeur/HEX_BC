# EST-E11 — Imports/Exports et documents

> Milestone: M3 | Priorite: P1 | Statut: A faire

## Objectif

Completer le pipeline documentaire avec la generation PDF cote serveur, la verification
d'integrite par hash, et un export DPGF aller-retour. Cette epic permet au chiffreur de
produire des documents professionnels directement depuis l'application et de garantir
leur authenticite.

## Ce qui existe deja

Les sprints BC-007, BC-008 et BC-009 ont mis en place le flux d'import et le catalogue :

- **Flux d'import DPGF** : `src/app/dashboard/imports/page.tsx` (page upload),
  `src/lib/imports/server.ts` (logique serveur), `src/lib/imports/parser.ts` (parseur
  CSV/XLSX avec worker + fallback serveur) — tables `dpgf_imports` (statut du job),
  `dpgf_rows_raw` (lignes brutes), `dpgf_rows_mapped` (lignes apres mapping)
- **Mapping wizard** : `src/app/dashboard/mappings/page.tsx`,
  `src/components/mappings/MappingWizard.tsx`, `src/lib/mappings/server.ts` — mapping
  colonnes avec memoire et templates (`mapping_templates`, `mapping_memory`)
- **Catalogue** : `src/app/dashboard/catalogue/page.tsx`, `src/lib/catalogue/server.ts` —
  pricebook fournisseurs (`supplier_pricebook`), indices materiaux (`material_indices`),
  liens catalogue
- **Export client** : `src/lib/export.ts` — fonctions `exportToCSV()` et
  `exportToExcelWithSheets()` pour export cote navigateur
- **Page impression** : `src/app/dashboard/estimates/[versionId]/print/page.tsx` —
  mise en page optimisee pour l'impression navigateur (CSS @media print)
- **Pricing** : `src/app/dashboard/prices/page.tsx`, `src/app/dashboard/indices/page.tsx` —
  gestion des prix et indices

---

## EST-201 — Generation PDF serveur

**Priorite:** P0 | **Effort:** L | **Milestone:** M2

### User Story

> En tant que chiffreur, je veux generer un PDF professionnel cote serveur, afin d'avoir
> un document de qualite telechargeable et envoyable par email.

### Criteres d'acceptation

- [ ] Un endpoint API genere le PDF a partir de la version de devis specifiee
- [ ] Template PDF dedie en `@react-pdf/renderer` (primitives `<Document>/<Page>/<View>/<Text>`), aligne visuellement sur la page print mais code distinct (le HTML/Tailwind de `print/page.tsx` n'est PAS reutilisable par `@react-pdf/renderer`)
- [ ] Le document inclut : logo du tenant, en-tete avec references projet/client,
      pied de page avec mentions legales, pagination automatique
- [ ] La generation s'effectue en arriere-plan pour ne pas bloquer l'interface utilisateur
- [ ] Le PDF genere est stocke dans Supabase Storage (bucket `estimate-documents`)
      avec un chemin structure `{tenant_id}/{estimate_id}/{version_id}.pdf`
- [ ] Un lien de telechargement est retourne a l'utilisateur une fois la generation terminee
- [ ] Le PDF est genere via `@react-pdf/renderer` (fonctionne en Node/Edge sans Chrome binary)
- [ ] Les montants sont formates en EUR avec les regles de `formatEUR()` existantes
- [ ] Le PDF est accessible uniquement aux membres du tenant (verification RLS)
- [ ] RLS Storage policy : lecture membres du tenant uniquement
- [ ] Au passage `draft→sent`, PDF genere automatiquement si aucun n'existe
- [ ] Endpoint GET `/api/estimates/[versionId]/pdf` retourne redirect vers URL signee (duree 1h)
- [ ] Alternative documentee : migration vers `puppeteer` + `@sparticuz/chromium` post-MVP si fidelite pixel-perfect requise

### Notes techniques

- Fichiers a creer :
  - `src/app/api/estimates/[versionId]/pdf/route.ts` — endpoint POST declenchant
    la generation, GET pour recuperer le statut/lien
  - `src/lib/estimates/pdf-generator.ts` — logique de generation : composition `@react-pdf/renderer`, rendu binaire PDF, upload Supabase Storage, retour URL signee
- Fichiers a modifier : aucun (template PDF dedie, pas de reutilisation du HTML print)
- Reutiliser :
  - `src/lib/money.ts` — `formatEUR()` pour le formatage des montants
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour les totaux
  - `src/lib/estimates/server.ts` — `getEstimateVersionDetails()` pour charger les donnees
  - `src/lib/estimates/errors.ts` — gestion d'erreurs API
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()` pour l'acces storage
- Dependances : aucune

---

## EST-202 — Export DPGF aller-retour

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux exporter un devis au format DPGF (Excel structure)
> compatible avec le flux d'import, afin de partager et reimporter facilement.

### Criteres d'acceptation

- [ ] Un bouton "Exporter DPGF" genere un fichier XLSX respectant la structure
      de colonnes attendue par le parseur d'import (`src/lib/imports/parser.ts`)
- [ ] Le fichier exporte est reimportable via le flux d'import existant et recree
      un devis equivalent (round-trip)
- [ ] La hierarchie sections/lignes est preservee dans l'export via une colonne
      "type" (section/ligne) et l'indentation des designations
- [ ] Un onglet "Metadata" dans le classeur contient les informations du projet
      (reference, client, date, version, auteur)
- [ ] Les colonnes exportees incluent au minimum : designation, unite, quantite,
      prix unitaire HT, coefficients k_fo/k_mo, role MO, categorie
- [ ] Le format numerique des cellules Excel est correct (pas de texte pour les nombres)
- [ ] Le fichier est telecharge directement par le navigateur (pas de stockage serveur)
- [ ] Mode export optionnel "BDC V1.1" avec les 31 colonnes du spec : IDENTIFICATION (position, AID, designation, unite, qte) + FO (type FO, PU, PR, K FO) + MO (h MO, K MO, taux horaire) + TOTAUX (total FO, total MO, total HT) + 3 FOURNISSEURS (nom, prix, ref, URL) + REF interne
- [ ] En-tetes colores par section dans le fichier Excel : bleu pour identification, vert pour FO, jaune pour MO, rouge pour totaux, violet pour fournisseurs
- [ ] Formules Excel en commentaires de cellule pour les colonnes calculees (total FO, total MO, total HT)
- [ ] L'export BDC inclut les donnees multi-fournisseurs (EST-030) si disponibles

### Notes techniques

- Fichiers a creer :
  - `src/lib/estimates/dpgf-export.ts` — fonctions `buildDpgfWorkbook()`,
    `exportEstimateToDpgf()` gerant la construction du classeur XLSX avec
    onglet donnees + onglet metadata
  - `src/lib/estimates/bdc-export.ts` — fonctions `buildBdcWorkbook()`, `exportEstimateToBdc()` avec les 31 colonnes, en-tetes colores et formules
- Fichiers a modifier :
  - `src/lib/export.ts` — ajouter ou etendre `exportToExcelWithSheets()` si necessaire
    pour supporter le format DPGF specifique
  - Endpoint existant ou nouvelle route pour declencher l'export
- Reutiliser :
  - `src/lib/export.ts` — `exportToExcelWithSheets()` comme base pour la generation XLSX
  - `src/lib/imports/parser.ts` — reference pour la structure de colonnes attendue
    (garantir la compatibilite aller-retour)
  - `src/lib/estimates/server.ts` — `getEstimateVersionDetails()` pour charger les donnees
  - `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()` pour les valeurs calculees
- Dependances : EST-030 (multi-fournisseurs pour les colonnes BDC)

---

## EST-203 — Hash d'integrite document

**Priorite:** P2 | **Effort:** S

### User Story

> En tant qu'admin, je veux un hash SHA-256 sur chaque document genere, afin de prouver
> l'authenticite du document.

### Criteres d'acceptation

- [ ] Un hash SHA-256 est calcule sur le contenu binaire du PDF au moment de la generation
- [ ] Le hash est stocke dans une table `estimate_documents` avec les colonnes :
      `id`, `version_id`, `tenant_id`, `file_path`, `sha256_hash`, `file_size_bytes`,
      `generated_by`, `generated_at`
- [ ] Un endpoint de verification accepte un fichier uploade et compare son hash
      avec celui stocke en base, retournant un statut valide/invalide
- [ ] Le hash est affiche dans le pied de page du PDF genere (8 premiers caracteres)
- [ ] La table `estimate_documents` est protegee par RLS (lecture membres du tenant,
      ecriture systeme uniquement)
- [ ] L'historique des documents generes est consultable par l'admin du tenant

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_estimate_documents.sql` — table
    `estimate_documents` avec index sur `sha256_hash` et RLS policies
  - `src/app/api/estimates/documents/verify/route.ts` — endpoint POST acceptant
    un fichier et retournant le statut de verification
- Fichiers a modifier :
  - `src/lib/estimates/pdf-generator.ts` — ajout du calcul SHA-256 apres generation,
    insertion dans `estimate_documents`, inclusion du hash dans le footer PDF
- Reutiliser :
  - `src/lib/estimates/errors.ts` — gestion d'erreurs API
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()` pour les requetes DB
  - API Web Crypto (`crypto.subtle.digest('SHA-256', ...)`) pour le calcul du hash
- Dependances : EST-201

---

## EST-035 — Import CSV Price Book

**Priorite:** P1 | **Effort:** M | **Milestone:** M2

### User Story

> En tant qu'admin, je veux importer des prix fournisseurs depuis un fichier CSV, afin de mettre a jour massivement le price book sans manipulation technique.

### Criteres d'acceptation

- [ ] File input CSV sur la page `/dashboard/prices` avec preview Zod (10 premieres lignes)
- [ ] Etape de mapping colonnes si headers non standards (dialog multi-etapes)
- [ ] Appel `bulkCreateSupplierPrices()` RPC existant pour la persistence
- [ ] Lignes rejetees affichees en resume avec numero de ligne et raison du rejet
- [ ] Indicateur de progression pour fichiers > 500 lignes
- [ ] Validation Zod sur chaque ligne : `supplier_id`, `product_id` (ou `catalogue_item_id`) et prix (numerique positif) requis ; devise optionnelle (defaut `EUR`)
- [ ] Support des formats de prix francais (virgule decimale) et internationaux (point decimal)

### Notes techniques

- Fichiers a creer :
  - `src/components/catalogue/PriceBookCsvImport.tsx` — composant d'import avec preview, mapping, progression
  - `src/lib/catalogue/csv-import.ts` — parsing CSV, validation Zod, transformation en format bulk
- Fichiers a modifier :
  - `src/app/dashboard/prices/page.tsx` — ajout du bouton "Importer CSV" et integration du composant
- Reutiliser :
  - `bulkCreateSupplierPrices()` de `src/lib/catalogue/server.ts` pour la persistence en masse
  - `parseEuroToCents()` de `src/lib/money.ts` pour la conversion des montants
  - Helpers d'erreur de `src/lib/catalogue/server.ts` (`badRequest()`, `toErrorResponse()`)
- Dependances : aucune

---

## EST-204 — Import multi-format

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que chiffreur, je veux importer des devis depuis d'autres formats (Batigest,
> Onaya), afin de recuperer des chiffrages existants.

### Criteres d'acceptation

- [ ] Une architecture de plugins parseur permet d'ajouter de nouveaux formats sans
      modifier le flux d'import principal
- [ ] Au minimum 2 parseurs specifiques sont implementes : Batigest (.dbf/.csv) et
      Onaya (.xlsx structure specifique)
- [ ] Le format du fichier est auto-detecte a l'upload (par extension et/ou analyse
      du contenu des premieres lignes)
- [ ] Chaque parseur mappe les donnees vers la structure DPGF standard
      (`dpgf_rows_raw`) pour reutiliser le flux de mapping existant
- [ ] Un rapport d'erreur par format est genere listant les lignes non parsables
      avec la raison de l'echec
- [ ] L'utilisateur peut choisir manuellement le format si l'auto-detection echoue
- [ ] Les parseurs sont testables independamment via des tests unitaires avec
      des fichiers d'exemple

### Notes techniques

- Fichiers a creer :
  - `src/lib/imports/parsers/batigest.ts` — parseur Batigest avec detection du format
    (.dbf postes + .csv details ou export CSV unifie), mapping vers structure DPGF
  - `src/lib/imports/parsers/onaya.ts` — parseur Onaya avec detection du format XLSX
    specifique (structure onglets + colonnes), mapping vers structure DPGF
  - `src/lib/imports/parsers/index.ts` — registre de parseurs, fonction
    `detectFormat()`, interface `FormatParser`
- Fichiers a modifier :
  - `src/lib/imports/parser.ts` — integration du registre de parseurs, appel
    `detectFormat()` avant le parsing, fallback sur le parseur generique DPGF
  - `src/lib/imports/server.ts` — propagation du format detecte dans le job d'import
  - `src/app/dashboard/imports/page.tsx` — selecteur de format optionnel dans
    l'interface d'upload
- Reutiliser :
  - `src/lib/imports/parser.ts` — parseur DPGF existant comme reference et fallback
  - `src/lib/imports/server.ts` — flux d'import existant (les parseurs alimentent
    `dpgf_rows_raw`, le reste du pipeline est inchange)
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
- Dependances : aucune

---

## EST-034 — Import format OPTIMA

**Priorite:** P1 | **Effort:** M | **Milestone:** M2

### User Story

> En tant que chiffreur, je veux importer des chiffrages au format OPTIMA, afin de recuperer les devis existants avec tous les coefficients et temps de pose.

> **Origine PRD:** fichiers `OPTIMA Hydraulique` et `OPTIMA Plomberie` — 2948 lignes hydraulique, 1398 lignes plomberie avec coefficients FO/MO, temps de pose et majoration.

### Criteres d'acceptation

- [ ] Parser plugin dans l'architecture EST-204 (interface `FormatParser`)
- [ ] Auto-detection du format OPTIMA par analyse des headers : N., Designation, Unite, Qte, PU, PR Fourniture, Tps pose, Coeff FO, Coeff MO, Majoration MO, Taux horaire
- [ ] Mapping des colonnes OPTIMA vers les champs internes :
  - Coeff FO → `k_fo`
  - Coeff MO → `k_mo`
  - Tps pose → `h_mo`
  - Majoration MO → `h_mo_majoration` (EST-032)
  - Coefficient global (1.30) → `global_coefficient` sur `estimate_versions` (EST-025)
  - PU → `unit_price_cents`
  - PR Fourniture → prix de reference fournisseur
- [ ] Support des lignes de section OPTIMA (lignes sans prix mais avec titre en gras)
- [ ] Rapport d'import detaille : nombre de lignes importees, sections detectees, lignes ignorees avec raison
- [ ] Teste avec donnees reelles : import complet des 2948 lignes hydraulique en < 10s
- [ ] Teste avec donnees reelles : import complet des 1398 lignes plomberie sans perte de donnees
- [ ] Les lignes avec "Temps majore" sont correctement mappees vers `h_mo_majoration`

### Notes techniques

- Fichiers a creer :
  - `src/lib/imports/parsers/optima.ts` — parseur OPTIMA avec detection du format, mapping des colonnes, gestion des sections et lignes
- Fichiers a modifier :
  - `src/lib/imports/parsers/index.ts` — enregistrer le parseur OPTIMA dans le registre de parseurs
  - `src/lib/imports/parser.ts` — integration du parseur OPTIMA dans le flux d'auto-detection
- Reutiliser :
  - `src/lib/imports/parsers/index.ts` — interface `FormatParser` et fonction `detectFormat()` (EST-204)
  - `src/lib/imports/parser.ts` — parseur generique DPGF comme reference
  - `src/lib/imports/server.ts` — flux d'import existant (le parseur alimente `dpgf_rows_raw`)
- Dependances : EST-204 (architecture parsers), EST-032 (temps majore h_mo_majoration)
