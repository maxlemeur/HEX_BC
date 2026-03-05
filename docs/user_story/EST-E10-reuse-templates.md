# EST-E10 — Reutilisation — templates et assemblages

> Milestone: M1 | Priorite: P1 | Statut: A faire

## Objectif

Permettre la reutilisation du contenu de chiffrage a travers des modeles de devis (templates
complets) et des assemblages (groupes de lignes pre-configures). Ces mecanismes reduisent
drastiquement le temps de creation d'un nouveau devis en capitalisant sur le travail deja
realise par l'equipe.

## Ce qui existe deja

- **`src/lib/estimates/server.ts`** : fonction `duplicateEstimateVersion()` qui appelle le
  RPC `duplicate_estimate_version()` pour copier en profondeur une version avec tous ses items
  — sert de base technique mais n'est pas un systeme de templates
- **`src/components/estimates/DuplicateEstimateButton.tsx`** : bouton declenchant la
  duplication d'une version existante
- **Fonction DB `duplicate_estimate_version()`** : copie atomique (version + items) avec
  increment du numero de version
- **Structure sections/lignes** : les items de devis supportent une hierarchie
  section > ligne via `parent_id` et `position` dans `estimate_items`
- **`src/lib/estimates/server.ts`** : fonctions `createEstimate()`, `createEstimateItem()`,
  `bulkUpdateEstimateItems()` reutilisables pour la creation depuis template/assemblage

---

## EST-181 — Templates de devis

**Priorite:** P1 | **Effort:** L | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux sauvegarder un devis comme modele reutilisable, afin de
> creer rapidement de nouveaux devis similaires.

### Criteres d'acceptation

- [ ] Une action "Sauvegarder comme modele" est disponible sur toute version de devis
      (menu contextuel ou bouton dans la toolbar)
- [ ] Le modele herite des sections, lignes, coefficients et parametres de la version source
      mais pas des informations client, dates ou references specifiques au projet
- [ ] Une page bibliotheque de modeles `/dashboard/estimates/templates` liste tous les
      templates du tenant avec nom, description, date de creation, nombre de lignes
- [ ] La creation d'un nouveau devis propose l'option "Depuis un modele" avec selection
      dans la bibliotheque
- [ ] Les modeles sont scopes au tenant courant (RLS policy)
- [ ] Un modele peut etre renomme, duplique ou supprime depuis la bibliotheque
- [ ] La creation depuis modele genere une version v1 avec toutes les lignes du template
      et le statut `draft`
- [ ] Les modeles sont independants de la version source : modifier le devis original
      n'affecte pas le modele
- [ ] Selecteur "Depuis un template" visible a la creation d'un nouveau devis (wizard EST-082 ou page `new/`)
- [ ] Picker affiche les 10 templates les plus recents du tenant avec nom, nb lignes, date
- [ ] Creation depuis template < 3 secondes pour 100 lignes (via `duplicate_estimate_version()` backend)
- [ ] Route POST `/api/estimates/templates/[templateId]/instantiate` — clone atomique version + items

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_estimate_templates.sql` — table `estimate_templates`
    (`id`, `tenant_id`, `name`, `description`, `source_version_id`, `created_by`,
    `created_at`, `updated_at`) + table `estimate_template_items` (copie des items)
    avec RLS policies scope tenant
  - `src/app/dashboard/estimates/templates/page.tsx` — page bibliotheque des modeles
    avec liste, recherche, actions CRUD
  - `src/app/api/estimates/templates/route.ts` — GET (liste), POST (creer depuis version)
  - `src/app/api/estimates/templates/[templateId]/route.ts` — GET, PATCH, DELETE
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — nouvelle fonction `createEstimateFromTemplate()`,
    modifier `createEstimate()` pour accepter un parametre optionnel `template_id`
  - `src/lib/estimates/client.ts` — wrappers client pour les endpoints templates
  - `src/lib/estimates/schemas.ts` — schemas Zod pour la validation des templates
- Reutiliser :
  - `src/lib/estimates/server.ts` — `createEstimate()`, `createEstimateItem()` pour
    la creation depuis template
  - `src/lib/estimates/errors.ts` — gestion d'erreurs normalisee
  - Fonction DB `duplicate_estimate_version()` comme reference d'implementation
    pour la copie profonde
- Dependances : aucune

---

## EST-182 — Assemblages reutilisables

**Priorite:** P1 | **Effort:** L | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux creer des assemblages (groupes de lignes pre-configures,
> ex: "pose carrelage"), afin de les inserer en un clic dans n'importe quel devis.

### Criteres d'acceptation

**Assemblage de base :**
- [ ] Un assemblage est un groupe nomme de lignes avec des valeurs par defaut
      (designation, unite, coefficients k_fo/k_mo, role MO, quantite par defaut optionnelle)
- [ ] Une page bibliotheque d'assemblages `/dashboard/estimates/assemblies` permet le
      CRUD complet : creation, edition, duplication, suppression
- [ ] L'insertion d'un assemblage dans un devis en cours d'edition cree automatiquement
      une section portant le nom de l'assemblage et les lignes correspondantes
- [ ] Un composant picker (dialog) permet de rechercher et selectionner un assemblage
      depuis l'editeur de devis
- [ ] Les assemblages sont scopes au tenant courant (RLS policy)
- [ ] Un assemblage peut contenir entre 1 et 50 lignes
- [ ] L'insertion preserve la `position` des lignes tel que defini dans l'assemblage
- [ ] Les valeurs inserees sont modifiables apres insertion (pas de lien dynamique
      avec l'assemblage source)
- [ ] Drawer lateral "Assemblages" accessible depuis la toolbar editeur (bouton persistant)
- [ ] Recherche debounced (300ms) dans le drawer, filtre sur nom assemblage et designations lignes
- [ ] Insertion respecte la position courante (insert after focused row)
- [ ] Apres insertion, recalcul version declenche immediatement
- [ ] Route POST `/api/estimates/assemblies/[assemblyId]/insert?versionId=...` — insertion atomique, retourne items[] inseres

**Macro-ouvrages (assemblages d'ouvrages composes) :**
- [ ] Un assemblage peut contenir des references a des ouvrages composes (EST-311) en plus de lignes simples : chaque item a un champ optionnel `source_assembly_work_id` pointant vers un ouvrage de la bibliotheque
- [ ] Champ `reference_code` sur l'assemblage : code unique d'identification (ex: "MAC-CLOI-BA13-048")
- [ ] Champ `description` sur l'assemblage : descriptif detaille de la prestation couverte par le macro-ouvrage (texte long ou rich text)
- [ ] Prix global auto-calcule : somme des prix de tous les ouvrages et lignes composant l'assemblage (`total_ds_cents`, `total_fourni_pose_cents`)
- [ ] Temps d'execution global auto-calcule : somme des `avg_time_hours` de chaque ouvrage composant, affiche dans le drawer et la bibliotheque
- [ ] Lors de l'insertion d'un macro-ouvrage, chaque ouvrage reference est insere avec son sous-detail complet (composants materiaux/MO/materiel)
- [ ] Le code de chaque ouvrage composant est affiche dans le drawer (colonne "Ref.") pour faciliter la recherche et la comparaison
- [ ] Le drawer affiche le prix global et le temps total du macro-ouvrage avant insertion

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_estimate_assemblies.sql` — tables
    `estimate_assemblies` (`id`, `tenant_id`, `name`, `reference_code`, `description`,
    `created_by`, `created_at`, `updated_at`) et `estimate_assembly_items` (`id`,
    `assembly_id`, `title`, `unit`, `k_fo`, `k_mo`, `labor_role_id`,
    `default_quantity`, `source_assembly_work_id`, `position`) avec RLS policies
    scope tenant
  - `src/app/dashboard/estimates/assemblies/page.tsx` — page bibliotheque assemblages
  - `src/app/api/estimates/assemblies/route.ts` — GET (liste), POST (creer)
  - `src/app/api/estimates/assemblies/[assemblyId]/route.ts` — GET, PATCH, DELETE
  - `src/components/estimates/AssemblyPicker.tsx` — dialog de selection d'assemblage
    avec recherche et apercu des lignes
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — nouvelle fonction `insertAssemblyIntoVersion()`
    incluant l'expansion des ouvrages composes references
  - `src/lib/estimates/client.ts` — wrappers client pour les endpoints assemblages
  - `src/lib/estimates/schemas.ts` — schemas Zod pour assemblages et items
  - `src/components/estimates/EstimateEditorTable.tsx` — bouton d'insertion
    d'assemblage dans la toolbar
- Reutiliser :
  - `src/lib/estimates/server.ts` — `createEstimateItem()` pour l'insertion des lignes
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
  - Ouvrages composes EST-311 : expansion sous-detail lors de l'insertion
- Dependances : aucune (macro-ouvrages enrichis apres livraison EST-311)

---

## EST-183 — Duplication partielle (section)

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux dupliquer une section entiere (avec ses lignes) dans le
> meme devis ou vers un autre, afin de reutiliser du travail existant.

### Criteres d'acceptation

- [ ] Un menu contextuel sur chaque section de l'editeur propose l'option
      "Dupliquer la section"
- [ ] La duplication cree une copie de la section avec le suffixe " (copie)" dans le titre
- [ ] Toutes les lignes enfants sont copiees avec leurs valeurs (coefficients, quantites,
      prix, roles MO)
- [ ] L'option "Dupliquer vers un autre devis" ouvre un selecteur de version cible
      parmi les devis du meme tenant au statut `draft`
- [ ] La section dupliquee est inseree en fin de devis (derniere `position`)
- [ ] Les identifiants des items copies sont nouveaux (pas de collision avec l'existant)
- [ ] Les totaux de la version cible sont recalcules apres insertion

### Notes techniques

- Fichiers a creer : aucun (extension des fichiers existants)
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — nouvelle fonction `duplicateSection(sectionId,
    targetVersionId?)` gerant la copie en profondeur de la section et ses lignes
  - `src/components/estimates/EstimateEditorTable.tsx` — ajout de l'option
    "Dupliquer la section" dans le menu contextuel des sections, dialog de
    selection de version cible
  - `src/lib/estimates/client.ts` — wrapper client pour `duplicateSection`
  - `src/lib/estimates/schemas.ts` — schema Zod pour la requete de duplication
- Reutiliser :
  - `src/lib/estimates/server.ts` — `createEstimateItem()` pour la creation des copies
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour recalculer
    les totaux apres insertion
  - Fonction DB `duplicate_estimate_version()` comme pattern de reference
- Dependances : aucune

---

## EST-184 — Import depuis un autre devis

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux importer des sections/lignes depuis un autre devis existant,
> afin de consolider plusieurs chiffrages.

### Criteres d'acceptation

- [ ] Un bouton "Importer depuis..." est disponible dans la toolbar de l'editeur de devis
- [ ] Au clic, un selecteur affiche la liste des projets et versions accessibles au
      chiffreur (meme tenant, toutes versions)
- [ ] Apres selection d'une version source, un selecteur de sections permet de choisir
      les sections a importer (multi-selection possible)
- [ ] Un apercu avant import affiche les sections selectionnees avec leur nombre de lignes
      et les totaux
- [ ] En cas de conflit de titre (section existante avec le meme nom), l'utilisateur
      choisit entre "fusionner" (ajouter les lignes a la section existante) ou
      "ajouter" (creer une nouvelle section avec suffixe)
- [ ] L'import preserve les valeurs des lignes mais reinitialise les identifiants
- [ ] Les totaux de la version cible sont recalcules apres import
- [ ] Un resume post-import indique le nombre de sections et lignes importees

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/ImportFromEstimateDialog.tsx` — dialog multi-etapes :
    selection version source > selection sections > apercu > confirmation
  - `src/app/api/estimates/[versionId]/import-sections/route.ts` — endpoint POST
    recevant les sections a importer, la version source et le mode (merge/append)
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — nouvelle fonction `importSectionsFromVersion()`
    gerant la copie des sections/lignes et la resolution des conflits
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — integration du bouton
    et de la dialog d'import
  - `src/lib/estimates/client.ts` — wrapper client pour l'endpoint d'import
  - `src/lib/estimates/schemas.ts` — schema Zod pour la requete d'import
- Reutiliser :
  - `src/lib/estimates/server.ts` — `duplicateSection()` (EST-183) comme brique
    de base pour la copie de sections
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour le recalcul
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
- Dependances : EST-183
