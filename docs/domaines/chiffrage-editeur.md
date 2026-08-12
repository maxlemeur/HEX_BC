# Chiffrage & éditeur de devis

> **Source : moteur, création et contrats relus au 2026-08-12 ; autres sections
> issues de la photographie du 2026-07-29.** En cas de divergence, le code et
> les migrations font foi et ce document doit être corrigé.

**Hors périmètre, documents dédiés :** formules de calcul (PU, déboursé sec, marge, remise, TVA, arrondis) → [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md) ; statuts, transitions, immutabilité, sceau → [`../metier/cycle-de-vie.md`](../metier/cycle-de-vie.md).

> ⚠️ **`supabase/schema.sql` est un snapshot partiel et périmé** (40 tables déclarées contre ~99 créées par les migrations) — `supabase/README.md:10-17`. Il ne contient ni `estimate_versions.max_section_depth` ni `estimate_assembly_members` (vérifié : `grep -n "max_section_depth\|estimate_assembly_members" supabase/schema.sql` → 0 résultat). **La vérité du schéma est `supabase/migrations/`** ; le type généré `src/types/database.ts` reflète la base réelle (`max_section_depth` `:1025`, `calc_engine_version` `:1035`).

---

## 1. Structure d'un devis

### 1.1 Tables

| Table | Rôle | Référence |
|---|---|---|
| `estimate_projects` | Affaire porteuse, `estimate_reference` | `supabase/migrations/20260719132414_estimate_reference_numbering.sql:20-33` |
| `estimate_versions` | En-tête de version (paramètres + totaux) | `supabase/schema.sql:353-376` |
| `estimate_items` | Sections **et** lignes, arbre par `parent_id` | `supabase/schema.sql:517-577` |
| `estimate_categories` | Catégories utilisateur, `unique (user_id, name)` | `supabase/schema.sql:448-458` |
| `estimate_version_events` | Journal d'événements de version | `supabase/schema.sql:5019-5039` |
| `estimate_version_changelogs` | Cache de changelog par paire de versions | `supabase/migrations/20260222164500_est224_estimate_version_changelog_cache.sql:3-19` |

`estimate_items.item_type` vaut `section` ou `line` (`src/lib/estimates/schemas.ts:174`). Un `CHECK` XOR impose que **toute colonne chiffrée soit `NULL` sur une section et non-`NULL` sur une ligne** (`supabase/schema.sql:539-576`). Deux index uniques partiels garantissent l'unicité de `position` : `(version_id, position) where parent_id is null` et `(parent_id, position) where parent_id is not null` (`supabase/schema.sql:588-593`). `parent_id` est `deferrable initially deferred` (`:521`).

Colonnes ajoutées après le snapshot : `h_mo_majoration` (`028_est_032_h_mo_majoration_and_estimate_item_functions.sql`), les 6 colonnes de MO éclatée `h_mo_atelier, k_mo_atelier, labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id` (`029_est_031_labor_split_atelier_chantier.sql`), `aid` (`20260223113000_est033_aid_column.sql`), `supply_type_id`, `selected_supplier_price_id`, et la provenance `source_provider` (défaut `'manual'`), `source_job_id`, `source_file_name`, `source_page` (`supabase/migrations/20260224174000_tkf014_estimate_items_source_tracking.sql:3-7`). `estimate_versions.exclusions` : texte client `<= 5000` caractères, gelé hors `draft` par trigger (`supabase/migrations/20260715235315_add_estimate_exclusions.sql:1-33`).

### 1.2 Hiérarchie et profondeur

| Constante | Valeur | Référence |
|---|---|---|
| `MIN_SECTION_DEPTH` / `MAX_SECTION_DEPTH` | `1` / `4` | `src/lib/estimates/hierarchy.ts:3-4` |
| `DEFAULT_MAX_SECTION_DEPTH` | `3` | `src/lib/estimates/hierarchy.ts:5` |
| `LEGACY_EXISTING_ESTIMATE_MAX_SECTION_DEPTH` | `2` | `src/lib/estimates/hierarchy.ts:6` |
| Libellés de niveau | `Lot`, `Chapitre`, `Sous-chapitre`, `Ouvrage` | `src/lib/estimates/hierarchy.ts:8-13` |

La profondeur est stockée par version : `estimate_versions.max_section_depth`, défaut `3`, `check between 1 and 4` (`supabase/migrations/20260304212000_est125_hierarchy_depth_compat_fix.sql:68,77-78`). Le trigger `estimate_items_hierarchy_depth_guard` refuse une section au-delà du maximum (« Profondeur de section depassee (max %) », `:211-213`), une ligne sans section parente (`:219`) et une ligne rattachée trop profond (`:223-226`). En absence de valeur il retombe **silencieusement** sur `3` (`coalesce(ev.max_section_depth, 3)`, `:174`). Les parcours d'arbre côté client sont bornés par un garde-fou de **2000 itérations** contre les cycles (`src/lib/estimates/hierarchy.ts:100,138`).

### 1.3 Numérotation, AID, référence

`computeEstimateItemNumbering` (`src/lib/estimates/numbering.ts:19-89`) : racines sur **2 chiffres avec zéro de tête** (`:52,68`), descendants sans padding, segments joints par `.` (`:45`), tri `position` puis `id.localeCompare` (`:8-17`). Les orphelins puis les items pris dans un cycle sont **remontés au niveau racine** et numérotés à la suite (`:61-63,72-86`) — jamais d'item sans numéro.

`estimate_items.aid` : normalisé majuscules + trim, `null` si vide (`src/lib/estimates/schemas.ts:31-37`), max **64** caractères (`:71`), format par défaut `^[A-Z]{2,4}\.[A-Z]{2,4}\.\d{2,4}$` (`:12-13`) surchargeable par le feature flag tenant `ESTIMATE_ITEM_AID_REGEX` (`:14`, résolu `src/lib/estimates/server.ts:1852`). Une regex invalide retombe **silencieusement** sur le défaut (`try/catch`, `:45-51`) ; le flag `g` est retiré (`:47`). Saisie par le menu contextuel de ligne (`.../EstimateEditorTableLineContextMenu.tsx:63-70`) ou le bouton `+ AID` d'une section (`.../SectionRow.tsx:312`).

Référence d'affaire : format `^HEX_D[0-9]{5}[A-Z]{2}$` (`supabase/migrations/20260719132414_estimate_reference_numbering.sql:26-33`), compteur dans `private.estimate_reference_counters`, clé `(tenant_id, reference_year)`, `last_value between 1 and 999` (`:5-13`), schéma `private` révoqué de `public, anon, authenticated` (`:3`). Assignation par trigger `BEFORE INSERT` `security definer` (`:157-161`). **Au-delà de 999 affaires par tenant et par an, la création échoue** (`'Estimate reference sequence exhausted for year %'`, `:145-148`). Initiales dérivées de `profiles.full_name` désaccentué, repli `XX` (`:118-124`). Affichage : `formatEstimateReference` suffixe `_V<n>` dès la version 2 (`src/lib/estimates/reference.ts:13-15`) ; nom de fichier PDF assaini puis `devis.pdf` en dernier recours (`:18-42`).

### 1.4 Mode de structure

`resolveEstimateStructureModeSummary` classe une version en `not_started | imported | manual | hybrid | needs_update` (`src/lib/estimates/structure-mode.ts:1-6`, calcul `:106-119`) selon `source_provider` : `dpgf` = importé (`:41-43`) ; `null`, `manual`, `ai_structure`, `version_zero_draft`, `generated_ouvrage` = manuel (`:45-53`) ; **tout autre provider bascule la version en `needs_update`**. L'import DPGF lié n'est proposé que si `mode === "manual"` et la source est `completed` avec au moins une ligne mappée (`:55-63,121-122`).

---

## 2. L'éditeur type tableur

Route `src/app/dashboard/estimates/[versionId]/edit/page.tsx` → `EstimateEditorPage`. Quatre paramètres d'URL pilotent l'ouverture : `focusItemId`, `openVersionZero`, `openStructureDraft`, `openSettings` (`margin|discount|tax|rounding|general`) — `edit/page.tsx:15-52`.

### 2.1 Colonnes

Ordre effectif (`resolveEstimateEditorGridStyle`, `src/components/estimates/EstimateEditorTable.tsx:710-783`) : Désignation, Qté, U, PR FO *(toujours présentes, `:715-716`)*, `Type FO`, `K FO`, **h MO (fixe)**, `Majoration MO`, `Type MO`, `K MO`, P.U. et Prix total *(fixes)*, `Déboursé sec`, `Marge €`, `Marque %`, Actions. En mode MO éclatée (flag `EST_031_LABOR_SPLIT`, `src/lib/estimates/calc-context.ts:26`) les 9 colonnes atelier/chantier sont **forcées visibles** et aucune colonne optionnelle n'est disponible (`:742-757`). Largeur tablette plancher `900px` (`:782`).

Visibilité (`src/hooks/useColumnVisibility.ts`) : 8 clés `supply_type, k_fo, h_mo_majoration, labor_role, k_mo, ds, marge, marque` (`:5-16`). Presets `essential = []`, `standard = supply_type, k_fo, labor_role, k_mo`, `full` = les 7 sauf `h_mo_majoration`, `custom` (`:20-39`) ; **`h_mo_majoration` n'est dans aucun preset**, accessible seulement en « Personnalisé » (`:23-28`). Défaut `essential` (`:128,137`). Persistance `localStorage` sur 3 clés `est-col-vis`, `est-col-custom`, `est-col-override` (`:72-74`), toutes lectures/écritures `try/catch`-avalées. Les colonnes cachées sont retirées de la navigation clavier mais la table de correspondance ne couvre que 5 clés (`EstimateEditorTable.tsx:1695-1701`) : `ds`, `marge`, `marque` sont en lecture seule et non navigables. Sur mobile `MOBILE_ESSENTIAL_COLUMNS` est **vide** (`:786`). Infobulles centralisées : `COLUMN_HEADER_TOOLTIPS` (`src/components/estimates/components/ColumnHeaderHelp.tsx:5-30`).

### 2.2 Navigation clavier

Résolveur pur `resolveSpreadsheetKeyCommand` (`src/hooks/useSpreadsheetNavigation.ts:160-216`) :

| Touche | Contexte | Effet | Référence |
|---|---|---|---|
| `Escape` | éditeur | restaure la valeur d'avant édition, blur | `:169-171`, handler `:627-631` |
| `Ctrl/Cmd+Z` | éditeur | annule **la cellule seule**, pas la pile d'historique | `:173-178`, `:633-642` |
| `F2` | cellule | ouvre l'éditeur, sélectionne tout | `:180-182` |
| tout caractère imprimable | cellule | remplace la valeur et ouvre l'éditeur | `:184-190`, `:155-158` |
| `Tab` / `Shift+Tab` | les deux | cellule suivante / précédente | `:193-195` |
| `←` / `→` | cellule | précédente / suivante | `:196-197` |
| `↓` ou `Entrée` / `↑` | `Entrée` aussi depuis l'éditeur | ligne suivante / précédente | `:198-199`, `:207-209` |

Le déplacement **boucle** (modulo sur la liste plate, `:361-364,372-390`). Les flèches sont ignorées dans un éditeur (`:207-209`). **Pas de `Home`/`End`/`PageUp`/`PageDown`, pas de sélection de plage `Shift+flèche`** (vérifié : `grep -rn "PageUp\|PageDown" src/hooks/useSpreadsheetNavigation.ts` → 0 résultat ; `shiftKey` n'apparaît que pour `Tab` et le veto d'undo).

Raccourcis de page (`src/components/estimates/hooks/useEstimateKeyboardShortcuts.ts`, un seul listener `window` `:228`) : `Ctrl/Cmd+A` sélectionner toutes les lignes visibles `:111-128` ; `Escape` désélectionner `:130-141` ; `Delete` supprimer la sélection, auto-répétition ignorée `:143-155` ; `Ctrl/Cmd+C` copier `:157-173` ; `Ctrl/Cmd+Z` undo `:175-192` ; `Ctrl/Cmd+Shift+Z` **ou** `Ctrl/Cmd+Y` redo `:194-211` ; `Ctrl/Cmd+Shift+A` sélecteur d'ouvrages `:213-225`. Ailleurs : `Ctrl/Cmd+S` force le flush (`src/hooks/useAutoSave.ts:39-42`), `Ctrl/Cmd+K` palette de commandes (`src/hooks/useCommandPalette.ts:325-333`). ⚠️ Le panneau d'aide intégré (`KEYBOARD_SHORTCUTS`, `src/components/estimates/components/EstimateEditorToolbar.tsx:1245-1259`) **omet `F2` et la saisie directe par frappe**.

### 2.3 Presse-papier

Format **TSV** (`\t` colonnes, `\n` lignes) — `src/lib/estimates/clipboard.ts:863-873`. 9 champs cibles `designation, quantity, unit, unit_price_ht, supply_type, k_fo, h_mo, k_mo, h_mo_majoration` (`:1-11`, ordre de copie `:63-65`).

- **Coller** passe par l'événement DOM `paste` — aucun `Ctrl+V` intercepté — restreint à la carte du tableau et hors champ texte (`src/components/estimates/hooks/useEstimateClipboard.ts:320-344`).
- `parseTsvMatrix` (`clipboard.ts:455-503`) : BOM retiré, `\r\n`/`\r` normalisés (`:456-458`), **la ligne 0 est toujours traitée comme un en-tête** (`:495`), lignes complétées/tronquées à la largeur maximale (`:496`), en-têtes vides renommés `column_N` (`:237`), doublons suffixés (`:188-197`), guillemets `"` avec échappement `""` (`:207-215`), cellules trimmées (`:218`).
- **Les valeurs multi-lignes ne survivent pas au collage** : la découpe se fait sur `\n` brut avant l'analyse des guillemets (`:468`). À la copie, `\t\r\n` deviennent une espace (`:434-436`).
- Mapping glouton par score décroissant (`:568-637`) : alias mono-caractère exact **220**, exact **200+len**, préfixe **170+len**, sous-chaîne **140+len**, tous les mots de l'alias **110+n**, tous les mots de l'en-tête **90+n** (`:250-282`) ; bonus **+50** en-tête canonique BDC (`:597`), **+45** OPTIMA (`:604`). Détection de format : seuils `bdc >= 10`, `optima >= 6 && bdc < 10`, `bdc >= 6 && optima <= 4`, `optima >= 4`, sinon `generic` (`:549-565`).
- Nombres : séparateur décimal = le dernier présent (`:696-705`) ; **en domaine `money`, exactement 3 chiffres finaux avec une partie gauche non nulle ⇒ séparateur de milliers** (`:320-322`). Seul `unit_price_ht` est en domaine `money` (`:783-786`). Jetons nuls : `na, n a, null, none, vide` (`:156`).
- `h_mo_majoration` est divisée par **100** si l'en-tête mentionne `%`/`pourcent`/`percent`/`pct` **ou si la valeur dépasse 10** (`:401-419`) — heuristique silencieuse.
- **Aucune limite de taille au collage côté client** : l'option `limit` existe (`:50-52`) mais aucun appelant ne la passe (vérifié : `grep -rn "buildClipboardPreviewRows" src | grep -v test` → 3 occurrences, toutes à 2 arguments). Seul plafond effectif : le découpage serveur en lots de **100** (`src/hooks/useEstimateEditorPasteController.ts:22`).
- Copie : `navigator.clipboard.writeText` avec repli `document.execCommand("copy")` (`useEstimateClipboard.ts:299-316`).

### 2.4 Autosave, tampon, verrou, conflits

| Constante | Valeur | Référence |
|---|---|---|
| Débounce autosave | `2000` ms | `src/hooks/useAutoSave.ts:5` ; `src/hooks/useEstimateEditorSyncController.ts:53` |
| Flush immédiat | `100` modifications empilées | `useEstimateEditorSyncController.ts:54` |
| Retries automatiques | `3`, backoff `2000/4000/8000` ms, plafond `30000` ms | `useAutoSave.ts:6-8,55-63` |
| Statut `saved` → `idle` | `3000` ms | `useAutoSave.ts:344-350` |
| TTL du bail de page | **2 minutes** | `src/lib/estimates/locks.ts` |
| Heartbeat du bail | **30 secondes** | `src/hooks/useDraftLock.ts` |
| Nouvelle tentative en lecture seule | **5 secondes** + immédiate au focus/retour visible | `src/hooks/useDraftLock.ts` |

Le tampon est une `Map<itemId, payload>` fusionnée champ à champ, dernier écrit gagnant (`src/lib/estimates/bulk-buffer.ts:12-22`), persistée à chaque saisie dans `localStorage` sous `estimate:edit:autosave-buffer:{versionId}` et rechargée au montage (`src/lib/estimates/editor-drafts.ts:7`, `useEstimateEditorSyncController.ts:288-312,710`). ⚠️ Le compteur de flush immédiat compte les **empilements**, pas les items distincts : 100 frappes sur une seule cellule déclenchent un envoi (`:712`). Le flush envoie **un** `POST /batch` d'opérations `update` (`:559-577`) puis, si des totaux ont changé, un second appel `/items/bulk` avec un tableau d'updates vide (`:590-600`). Le jeton de concurrence est l'`updated_at` de la version, transmis en `If-Match` (`src/lib/estimates/client.ts:4219,4494`) et rechaîné après chaque appel.

**Bail de page.** Un seul couple `(utilisateur, page)` détient le verrou d'une version. Chaque page génère un UUID distinct transmis dans `x-estimate-draft-lock-session-id` ; un second onglet ou appareil du même utilisateur reste donc en lecture seule et ne peut ni renouveler, ni libérer, ni utiliser le bail de la première page. Le serveur vérifie ce couple avant toute écriture métier. L'expiration est calculée côté serveur, les verrous expirés sont nettoyés via `cleanup_expired_draft_locks`, puis la page en attente retente automatiquement l'acquisition toutes les 5 secondes et au retour au premier plan. Le **forçage reste réservé au rôle tenant `admin`**. La page propriétaire libère aussi le bail au démontage et sur `beforeunload`, en `keepalive`.

**Conflit de version.** Détecté sur `409` + code `VERSION_CONFLICT` (`useEstimateEditorSyncController.ts:174-180`) : l'éditeur écrit un brouillon de conflit dans `sessionStorage` (`estimate:edit:conflict-draft:{versionId}`, `editor-drafts.ts:6`), vide le tampon et verrouille l'édition (`:476-477`). Une erreur `LOCK_REQUIRED` déclenche une ré-acquisition unique puis un unique rejeu (`:182-184,433-445`).

### 2.5 Undo/redo, virtualisation

Pile limitée à **50** entrées (`src/hooks/useEstimateEditorHistoryController.ts:7`, `src/hooks/useUndoRedo.ts:5`) ; au débordement les plus anciennes sont jetées (`useUndoRedo.ts:91-98`). **Six opérations seulement sont annulables** : `bulk-majoration`, `bulk-delete-lines`, `bulk-move-lines`, `bulk-set-category`, `bulk-set-labor-role` (`src/hooks/useEstimateEditorBulkController.ts:197,268,417,476,544`) et `paste-insert` (`src/hooks/useEstimateEditorPasteController.ts:348`). ⚠️ **Chaque autosave réussi appelle `clearHistory()`** (`useEstimateEditorSyncController.ts:614`) : une opération en masse devient non annulable ~2 s après la saisie suivante. Les éditions de cellule ne sont jamais empilées.

Virtualisation TanStack Virtual (`src/hooks/useVirtualList.ts:4-8`) : hauteur de ligne estimée **56**, overscan **8** (`:10-11`), conteneur **640 px** (`src/components/estimates/hooks/useEstimateDndVirtualization.ts:44`). Modes `off | on | auto` (`src/lib/estimate-editor-virtualization.ts:10`), `auto` s'active à **120 lignes** (`:3`). Drag & drop : activation pointeur `8 px`, tactile `delay 200 ms / tolerance 8` (`useEstimateDndVirtualization.ts:188-189`).

Six variables d'environnement surchargent cette configuration au build, lues en un point unique (`src/hooks/useEstimateEditorState.impl.tsx:157-162`) : `NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ENABLED` (activation), `_MODE` (`off | on | auto`), `_AUTO_THRESHOLD` (défaut **120**), `_ROW_ESTIMATE` (défaut **56**), `_OVERSCAN` (défaut **8**), `_CONTAINER_HEIGHT` (défaut **640 px**). Deux feature flags tenant existent en parallèle : `ESTIMATE_EDITOR_VIRTUALIZATION_MODE` et `ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD` (`src/lib/estimate-editor-virtualization.ts:5,7`).

---

## 3. Écriture serveur : `/batch` vs `/items/bulk`

**`/batch`** (`src/lib/estimates/batch.ts:449-558`) accepte `create | update | delete | reorder` (`src/lib/estimates/schemas.ts:637-663`). Plafond **100 opérations**, surchargeable par `ESTIMATE_BATCH_MAX_OPERATIONS`, dépassement → `BATCH_LIMIT_EXCEEDED` (`:18-19,459-468`). Jeton de concurrence **obligatoire** (`:470-473`) ; `dry_run` renvoie tous les résultats en `ok` sans rien écrire (`:485-498`). La revendication passe par le RPC `claim_estimate_batch_revision`, qui exige statut `draft`, rôle `admin|engineer` et **un verrou de brouillon vivant détenu par l'appelant** ; sinon `SQLSTATE PT409` / `ESTIMATE_BATCH_REVISION_CONFLICT` (`supabase/migrations/20260722134411_fix_estimate_batch_conflict_sqlstate.sql:4-49`). ⚠️ **`/batch` n'est pas transactionnel** : les opérations sont séquentielles et, à la première erreur, un rollback compensatoire est rejoué **en code applicatif** depuis des snapshots pris avant chaque opération (`batch.ts:510-545`) ; un échec de rollback est simplement journalisé (`:347`).

**`/items/bulk`** passe par le RPC `bulk_update_estimate_items` (dernière définition : `supabase/migrations/20260223113000_est033_aid_column.sql:161-393`). ⚠️ **Ce chemin ne persiste pas les 6 colonnes de MO éclatée** : ni la table temporaire de snapshot (`:220-238`), ni le `UPDATE ... SET` (`:332-353`), ni l'aide `snapshot_estimate_item_bulk_updates` (`:18-43`) ne les mentionnent (vérifié : `grep -c "h_mo_atelier" supabase/migrations/20260223113000_est033_aid_column.sql` → `0`). Toute valeur atelier/chantier envoyée par ce chemin est **silencieusement ignorée** ; l'éditeur n'y envoie que des tableaux vides (totaux seuls), l'appelant à risque est `src/lib/takeoff/server.ts:7440`. Le RPC verrouille la version et lève `STALE_BULK_UPDATE_ITEMS` sur désynchronisation (`:198-215,293-303,357-370`) ; `version_patch` n'accepte que `total_ht_cents`, `total_tax_cents`, `total_ttc_cents` (`:190-192`).

**Déplacement** : RPC `move_estimate_item` (version courante `supabase/migrations/20260304212000_est125_hierarchy_depth_compat_fix.sql:239-…`), qui verrouille source et cible et lève `stale write detected` si l'ordre fourni ne correspond plus à la base. Les charges `reorder`/`move` exigent des identifiants uniques et non chevauchants (`src/lib/estimates/schemas.ts:557-592,620-635`).

**Rôles d'écriture** : `canWriteEstimateWorkflows` = `admin` ou `engineer` (`src/lib/estimates/write-access.ts:7-9`), erreur `ESTIMATE_WRITE_ROLE_REQUIRED` (403, `:16-20`). **Moteur de calcul** : `calc_engine_version` gouverne désormais l'éditeur et les exports. Toute nouvelle version créée par l'application reçoit le moteur 2 ; une version existante ou une valeur invalide conserve le repli historique en moteur 1. Le brouillon v2 est calculé en direct ; après approbation ou envoi, les surfaces relisent son snapshot figé (`src/lib/estimates/calc-engine-version.ts`, `src/hooks/useEstimateEditorCalculation.ts`, `src/lib/estimate-v2-snapshot.ts`).

---

## 4. Templates et assemblages (ouvrages réutilisables)

### 4.1 Assemblages

`estimate_assemblies` (`supabase/migrations/20260222033000_est182_estimate_assemblies.sql:3-12`, `unique (tenant_id, name)` `:11`), `estimate_assembly_items` (`:14-27`, `unique (assembly_id, position)` `:39-40`), `estimate_assembly_members` pour l'imbrication (`supabase/migrations/20260722132425_nested_estimate_assemblies.sql:4-18`) : enfant en `on delete restrict` (`:11-12`), `unique (parent, child)`, `unique (parent, position)`, `check (parent <> child)` (`:15-17`).

**Profondeur d'imbrication : littéral `2`**, contrôlé à l'écriture (`ancestor_depth + 1 + descendant_depth > 2`, `:118-120`) et à la matérialisation (`:483-485`). Détection de cycle par CTE récursive avec tableau de chemin (`:67-84`). Aucune constante TypeScript n'existe (vérifié : `grep -rn "MAX_ASSEMBLY\|MAX_DEPTH\|MAX_NEST" src/` → 0 résultat). Codes exposés : `ESTIMATE_ASSEMBLY_CYCLE` (409), `ESTIMATE_ASSEMBLY_DEPTH_EXCEEDED` (400), `ESTIMATE_ASSEMBLY_SELF_REFERENCE` (400) — `src/lib/estimates/server.ts:3740-3764`. Limites : **50 lignes** et **20 sous-ouvrages** par ouvrage, en zod (`src/lib/estimates/schemas.ts:1432,1473`) **et** en SQL (`20260722132425…:357-361`). `cost_type ∈ {material, labor, equipment, subcontract}` (`supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql:18-19`). Écriture réservée à `admin|engineer` par RLS (`supabase/migrations/20260727030000_harden_estimate_assembly_member_write_roles.sql:19-56`).

**Insertion dans un devis** (`POST /api/estimates/assemblies/{id}/insert`, réponse **200**) : `insertAssemblyIntoVersion` (`src/lib/estimates/server.ts:6263-6507`) exige `draft` + verrou possédé, refuse un ouvrage vide, et **refuse l'insertion si une ligne `cost_type='labor'` n'a pas de `labor_role_id`** (`ESTIMATE_ASSEMBLY_LABOR_ROLE_REQUIRED`, `:6226-6261`). Le RPC `materialize_estimate_assembly_tree` crée une **section** portant le nom de l'ouvrage puis les lignes : `quantity` et `h_mo` sont **multipliés** par le multiplicateur hérité (`20260722132425…:576,584`), `tax_rate_bp` reprend celui de la version (défaut `2000`, `:581`), et `pu_ht_cents` ainsi que les trois totaux de ligne sont écrits à **0** (`:587-591`), recalculés puis réécrits côté TypeScript après l'appel (`server.ts:6407-6502`). **Ne sont pas repris** : `category_id`, `selected_supplier_price_id`, les colonnes atelier/chantier, `loss_coeff_bp`, `yield_value`, `source_metadata`. Le rollup de bibliothèque agrège `ds_cents` et `avg_time_hours` en remontant les membres (`20260722132425…:175-229`).

⚠️ **Code mort avéré** : les RPC de bibliothèque à l'échelle (`estimate_assemblies_page`, `set_estimate_assembly_favorite`, `record_estimate_assembly_use`, migration `20260718033950_scale_estimate_assembly_library.sql`) et leur wrapper `src/lib/estimates/assembly-library.ts` n'ont **aucun appelant applicatif** — les pages utilisent le `GET /api/estimates/assemblies` classique (`src/app/dashboard/estimates/assemblies/page.tsx:49-53`) ; vérifié : `grep -rn "estimate_assemblies_page\|record_estimate_assembly_use" src/ e2e/` → uniquement `assembly-library.ts` et ses tests. Il n'existe **pas** d'endpoint de duplication d'assemblage : la duplication est un lire-puis-recréer côté client qui **perd le `reference_code`** (`src/lib/estimates/client.ts:5606-5639`).

### 4.2 Templates

`estimate_templates` (`supabase/schema.sql:6328-6347`) porte un instantané complet des paramètres de prix ; `unique (tenant_id, created_by, name)` (`:6346`) — donc **par créateur**, contrairement aux assemblages. RLS : membre du tenant **et** (créateur **ou** `admin`) (`supabase/migrations/030_est_118_bulk_update_version_token_guard.sql:538-555`) — **`engineer` n'est pas privilégié ici.**

| Endpoint | Effet | Statut |
|---|---|---|
| `POST .../templates/{id}/insert` | insère les items du template **dans une version brouillon existante** | 200 |
| `POST .../templates/{id}/duplicate` | clone le **template** (défaut `« <nom> (copie) »`) | 201 |
| `POST .../templates/{id}/instantiate` | crée **projet et/ou version** depuis le template | 201 |

`insert` contrôle la profondeur de la version cible et reste une modification
d'un brouillon existant. `instantiate`, à l'inverse, est une création : il passe
par `instantiateCanonicalEstimateV2FromTemplate`, qui clone la hiérarchie dans
l'ordre parents-avant-enfants puis délègue à `persistCanonicalEstimateV2`.
Comme les créations vierges et DPGF, la persistance finale traverse uniquement
la RPC actor-scoped `persist_estimate_creation_atomic`. Les paramètres de prix
du template constituent le contexte initial de cette version v2.

---

## 5. Brouillons assistés par IA

Fournisseur unique : Google Gemini par REST (`src/lib/takeoff/gemini-client.ts:13-15`), clé `GEMINI_API_KEY` (`:1115`), modèle par défaut `gemini-3.1-pro-preview` (`:7`), timeout `60 000` ms (`:8`), `MAX_RETRIES = 3` (`:9`). **Aucun `maxOutputTokens` n'est fixé** (vérifié : `grep -rn "maxOutputTokens" src/lib/estimates/` → 0 résultat). Les trois flux **dégradent vers une heuristique déterministe** en cas d'erreur fournisseur (`structure-drafts.ts:2247-2281`, `version-zero-drafts.ts:1437-1447`, `generated-ouvrages.ts:1469-1488`).

| Flux | Modèle | `thinkingLevel` | Timeout | Retries |
|---|---|---|---|---|
| Structure | `gemini-3-pro-preview` (`structure-drafts.ts:335`) | `medium` | 60 000 (défaut) | **0** (`:2169`) |
| Version zéro | défaut `gemini-3.1-pro-preview` | `low` | **25 000** (`version-zero-drafts.ts:784`) | **0** (`:785`) |
| Ouvrages générés | `gemini-3-pro-preview` (`generated-ouvrages.ts:294`) | `medium` | 60 000 (défaut) | **3** (défaut) |

**Budget IA** — `estimate_ai_generation_budgets` (`supabase/migrations/20260713142735_harden_estimate_ai_generation_budgets.sql:3-21`) : clé `(tenant_id, version_id, operation)`, `operation ∈ {structure_draft, version_zero_draft}` (`:16-17`), bail **5 minutes**, fenêtre de rejeu **10 minutes** (`:154-155`), plafonds **4 fenêtres actives par tenant** et **2 par utilisateur** (`:118`). Dépassement → `(claimed=false, retry_after_seconds)`, jamais d'exception (`:126-133`), traduit en **409 `ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED`** (`src/lib/estimates/structure-drafts.ts:425-429`). L'acquisition exige `admin|engineer` et un verrou de brouillon vivant (`:84-96`). La libération n'efface pas `window_expires_at` (`:215-224`) : le refroidissement réel est le reste des 10 minutes. ⚠️ **Les ouvrages générés ne sont pas budgétés** (vérifié : `grep -rn "withEstimateAiGenerationLease" src/lib/estimates/generated-ouvrages.ts` → 0 résultat) et n'assertent pas le rôle d'écriture (`generated-ouvrages.ts:2966-2984`) : jusqu'à 4 appels Gemini par invocation sans réservation. Une génération version zéro consomme **deux** lignes de budget, appelant la génération de structure à l'intérieur de son propre bail (`version-zero-drafts.ts:1402`).

### 5.1 Brouillons de structure (EST-382)

`estimate_structure_drafts.status ∈ {pending, applied, discarded}`, `strategy ∈ {hybrid}` (`supabase/migrations/20260306190000_est382_structure_drafts.sql:11-14`). Nœuds : `hierarchy_level between 1 and 3` à l'origine (`:29`), **élargi à 1..4** par `20260306200000_est382_structure_draft_atomic_apply_fix.sql:6-8` ; `confidence` dans `[0,1]` (`:32`), `default_action ∈ {create, merge, skip}` (`:33-34`). Idempotence : `unique (draft_node_id)` sur les applications (`:53`) plus un `SELECT … FOR UPDATE` re-vérifiant `status = 'pending'` dans le RPC (`20260306200000…:55-64`) ; un second `apply` renvoie 409 `ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING` (`structure-drafts.ts:2831-2837`). Une génération **abandonne les brouillons `pending` antérieurs** du même trio (tenant, version, auteur) (`:2290-2298,2429`). Les items créés portent `source_provider = "ai_structure"` et `source_file_name = "Structure IA"` (`:332-333,3067-3069`). Plafonds zod : racines `min 1 / max 24`, enfants `max 20`, `facts|hypotheses|inferences` `max 6` de 240 caractères, `label` 160 (`:341-373`) ; `selected_root_node_ids` `min 1 / max 200`, `overrides` `max 500` (`schemas.ts:1178,1236`). Seuils : `>= 0.75` → `elevee`, `>= 0.55` → `moyenne`, sinon `faible` (`:659-661`) ; une provenance uniquement `assembly_library` plafonne la confiance à `0.49` et force `skip` (`:1108-1127`) — **si plus aucun nœud ne survit, la liste entière est vidée** (`:2224-2226`). Aucune route de suppression n'existe (l'arborescence `structure-drafts/` ne contient que `route.ts`, `[draftId]/route.ts`, `[draftId]/apply/route.ts`).

### 5.2 Version zéro (EST-384)

`status ∈ {ia_a_revoir, ready_for_version, materialized, discarded, superseded}` (`supabase/migrations/20260307201500_est384_version_zero_drafts.sql:12-13`), lots `∈ {generated, partial, missing}` (`:44-45`), lignes `review_status ∈ {pending, accepted, edited, rejected}` (`:76-77`). Le statut du brouillon est **recalculé à la lecture** : `pending === 0 ? ready_for_version : ia_a_revoir`, sauf statuts terminaux (`src/lib/estimates/version-zero-drafts.ts:1220-1235`). La génération exige une version **vide** (`EST384_VERSION_NOT_EMPTY`, `:577-582`) et un brief confirmé (`EST384_CONFIRMED_BRIEF_REQUIRED`, `:1384-1390`), et marque `superseded` les brouillons actifs antérieurs (`:1031-1046`). `materialize` refuse toute ligne `pending` (`EST384_PENDING_LINES`, `:1743-1749`), n'applique que `accepted|edited` (`:1754-1756`) et écrit des lignes à **prix nul** (`unit_price_ht_cents: 0`, `pu_ht_cents: 0`, `k_fo: 1`, `h_mo: 0`, `k_mo: 1` — `:1816,1856-1861`) avec `source_provider = "version_zero_draft"`. Idempotence par `unique (line_id)` et `unique (estimate_item_id)` (`:129-132`). **Aucun repli non atomique** : RPC manquant → 500 `EST384_MATERIALIZE_RPC_MISSING` (`:1912-1918`).

### 5.3 Ouvrages générés (EST-381 / EST-383)

Brouillon `status ∈ {pending, partially_applied, applied, discarded}` (`supabase/migrations/20260307110000_est381_generated_ouvrages.sql:14-15`) — **statut dérivé**, jamais posé directement (`generated-ouvrages.ts:1565-1578`). Candidats : `ai_status ∈ {certain, plausible, question}` (`:67-68`), `resolution_status ∈ {pending, inserted, rejected}` (`:69-70`), `unique (candidate_id)` sur les applications (`:100`). Le sous-détail est un **verrou d'insertion** : absent → `EST383_SUBDETAIL_REQUIRED`, non revu → `EST383_SUBDETAIL_NOT_REVIEWED` (`generated-ouvrages.ts:3665,3676`). Plafonds : texte source **12 000** caractères, **12** candidats, motif 320 caractères (`:298-302`). Le flux passe par des server actions, pas par des routes REST (`src/app/dashboard/affaires/_actions/generated-ouvrages.ts:39-73`).

---

## 6. Versions, variantes, diff, changelog, événements

**Duplication.** RPC `duplicate_estimate_version(source_version_id, as_variant)` ; la nouvelle version prend `max(version_number)+1`, le statut `draft`, ne reprend pas le sceau et **conserve `calc_engine_version` de la source**. La copie des items est **ordonnée par profondeur** (`order by hierarchy.depth asc, src.position asc, src.id asc`, `supabase/migrations/20260715210520_fix_duplicate_estimate_hierarchy_order.sql:217`) parce que le garde-fou de hiérarchie résout le parent dans la version cible à chaque insertion (`:1-4`). La migration du Lot 7 durcit aussi cette RPC en `security definer` actor-aware : appartenance au tenant actif et rôle propriétaire/admin sont revérifiés avant le verrouillage et la copie.

**Variantes.** `as_variant = true` renseigne `parent_version_id` et un `variant_label` alphabétique généré par `estimate_variant_label_from_index` (base 26, `supabase/migrations/20260222170000_est223_variants.sql:45-70`), avec boucle jusqu'au premier label libre. `POST /variants` crée une variante, `PATCH /variants` la **promeut** en remettant `parent_version_id` et `variant_label` à `null` (`src/lib/estimates/server.ts:7180-7220`) ; la version doit être `draft` et réellement une variante (`ESTIMATE_VARIANT_REQUIRED`, `:7188-7194`).

**Diff.** `buildEstimateDiff` (`src/lib/estimates/diff.ts:649`) aligne les fratries par programmation dynamique : coût d'insertion/suppression **12**, coût d'appariement = nombre de champs modifiés (`:52,492-541`). **2 champs** comparés sur une section, **21** sur une ligne (`:54-183`), typés `text | number | money | percent | reference` (`:18`). Changements `added | removed | modified` (`:17`), modes `inline | side-by-side` (`:185`).

**Changelog.** Cache `estimate_version_changelogs`, unique `(tenant_id, previous_version_id, current_version_id)`. `getOrBuildEstimateChangelog` renvoie `hit` **uniquement si les deux `updated_at` mémorisés correspondent exactement** (`src/lib/estimates/changelog.ts:481-492`), sinon recalcule et upsert en renvoyant `stale` (ligne présente) ou `miss` (`:527-531`). **Pas de TTL** : l'invalidation est purement basée sur `updated_at`. `GET /changelog?compare=<uuid>&format=pdf` rend le changelog en PDF (`src/app/api/estimates/[versionId]/changelog/route.ts:78-92`) ; comparer une version à elle-même est rejeté (`:45-47`), comme un couple hors du même tenant/projet (`:54-60`).

**Événements.** `estimate_version_events` est append-only. La dernière migration
autorise les événements métier historiques ainsi que
`approval_rules_evaluated`, `approval_status_changed`, `approval_submitted` et
`approval_decided`. `approval_submitted` est écrit dans la même transaction que
le cycle et ses approbations, pas par un second appel applicatif. Lecture :
`GET /events` (`src/app/api/estimates/[versionId]/events/route.ts:15-25`).
Vérification du sceau : `GET /verify` → voir
[`../metier/cycle-de-vie.md`](../metier/cycle-de-vie.md).

---

## 7. Qualité, anomalies, explications

### 7.1 Drapeaux qualité et checklist

8 drapeaux (`src/lib/estimate-quality.ts:9-18`, règles `:141-181`) : `missing_price` (`unit_price_ht_cents <= 0`), `missing_quantity`, `missing_labor_time`, `missing_labor_role` (`h_mo > 0` sans rôle), `supplier_price_outdated`, `labor_split_incomplete` (atelier XOR chantier), `price_outlier`, `quantity_outlier`. Péremption d'un prix fournisseur : **90 jours** par défaut, **3650** maximum, flag tenant `STALE_PRICE_DAYS` (`src/lib/catalogue/stale-prices.ts:1-2`, `src/lib/feature-flags.ts:321`).

Checklist, 5 critères (`src/lib/estimates/checklist.ts:9-15`, définitions `:67-102`) : `prices` **blocking**, `quantities` **blocking**, `labor_roles` warning, `margin_defined` **blocking**, `validity_dates` warning. Statut global `blocking > warning > complete` (`:220-221`). ⚠️ **La checklist est purement cliente et ne bloque rien côté serveur** (vérifié : `grep -rn "computeEstimateChecklist" src --include=*.ts --include=*.tsx | grep -v test` → uniquement `checklist.ts` et `useEstimateEditorQualityController.ts`).

### 7.2 Outliers

`detectEstimateOutliers` (`src/lib/estimates/outlier-detection.ts:182`) : méthodes `iqr` (défaut) et `zscore` (`:13,46`), seuils par défaut **1,5** et **3** (`:26-29`), surchargeables par `NEXT_PUBLIC_ESTIMATE_OUTLIER_*` (`:45-57`). Échantillon minimal : **4** pour l'IQR (`:114`), **3** pour le z-score (`:130`) ; la variance est **populationnelle** (divisée par `n`, `:133-137`). Seules les valeurs finies **strictement positives** entrent dans l'échantillon (`:67-71`). Regroupement par catégorie si `groupByCategory` et qu'au moins une catégorie existe, clés littérales `__uncategorized__` / `__all__` (`:154-161`). Deux drapeaux seulement : `price_outlier`, `quantity_outlier` (`:6-9`) ; **aucune notion de sévérité dans ce module** (vérifié : `grep -n "severity" src/lib/estimates/outlier-detection.ts` → 0 résultat). Rejets persistés dans `estimate_item_outlier_dismissals`, unique `(version_id, item_id, flag_key)` (`supabase/migrations/20260221224000_est143_outlier_dismiss.sql:3-14`) ; `POST /outliers` exige `draft` + verrou possédé (`src/app/api/estimates/[versionId]/outliers/route.ts:341-348`).

### 7.3 Vérité de ligne (« line truth »)

`resolveEstimateLineTruth` (`src/lib/estimates/line-truth.ts:359`), calculé côté serveur pour chaque item (`src/lib/estimates/server.ts:3512`), `null` sur une section (`:362-364`). Trois axes : **source** (8 valeurs) `manual | dpgf | plan | brief | cctp | assembly | mixed | unknown` (`:1-9`, mapping depuis `source_provider` `:182-251`) ; **statut de quantité** (6 valeurs) `imported_unverified | measured | assumed | provisional | to_confirm | missing` (`:11-17,254-301`) ; **confiance** `faible | moyenne | forte` (`:19`), seuils **`>= 0.75`** et **`>= 0.45`** (`:76-84`). Le score vient des métadonnées, sinon du niveau de métré (**A → 0,92 ; B → 0,68 ; sinon 0,42**, `:329`), sinon d'un repli par provider (dpgf `0,6` ; manual `0,55` ; generated_ouvrage `0,5` ; version_zero_draft `0,5` ; ai_structure `0,42` ; défaut `0,4` — `:338-349`).

`needsReview = qtyStatus !== "measured" || confidence === "faible" || source === "unknown"` (`:389-392`) — **toute ligne manuelle est donc marquée à revoir**, `assumed` n'étant pas `measured`. Badges : tonalités `neutral|warning|danger|success`, la pire des deux l'emporte (`.../EstimateLineTruthBadges.tsx:6-13,88-91`). Visibilité par indicateur (`source`, `quantity`, `confidence`) persistée sous `estimate-line-truth-visibility:v1` (`src/hooks/useEstimateLineTruthVisibility.ts:5-9,26`).

### 7.4 Gating d'envoi

19 clés (`src/lib/estimates/gating.ts:42-55`), 2 sévérités `blocking | warning` (`:59`), carte par défaut `:128-151`, `canSend = blockingFlags.length === 0` (`:798`). Surcharges par tenant via `ESTIMATE_GATING_BLOCKING_FLAGS` / `ESTIMATE_GATING_WARNING_FLAGS` (`:39-40`), `blocking` l'emporte (`:213-224`). ⚠️ **`price_outlier` et `quantity_outlier` ne peuvent jamais être émis par le gating d'envoi** : `computeEstimateQualityFlagsByItemId` y est appelé **sans** `outlierFlagsByItemId` (`:499-502`) alors qu'ils figurent dans la carte de sévérité (`:136-137`) — les outliers n'apparaissent que dans l'éditeur et l'historique d'anomalies. Application : sur `draft → sent`, `force: true` est **réservé aux admins** (`FORCE_SEND_FORBIDDEN`), tout drapeau bloquant non forcé donne `ESTIMATE_GATING_BLOCKED`, et les forçages enregistrent `forcedBlockingFlags` (`src/lib/estimates/server.ts:8386-8415`). Cinq catégories de readiness `documents | register | estimate_quality | pdf | approvals` (`src/lib/estimates/readiness.ts:1-7`) ; **toute clé non mappée retombe sur `estimate_quality`** (`:26-45`).

Historique d'anomalies (`src/lib/estimates/anomaly-history.ts`) : plafond **50 000** lignes d'audit (`:635`), tendance sur **12** mois (`:636`). ⚠️ Il duplique la carte de sévérité du gating (`:100-123`) et appelle `detectEstimateOutliers({ items })` **sans catégories ni config** (`:461`) : tout le devis forme alors un seul groupe.

### 7.5 Explications (EST-394)

Table `estimate_explanations` (`supabase/migrations/20260307143000_est394_estimate_explanations.sql:4-33`) : `explanation_kind ∈ {price, delta}` (`:15`), `confidence_label ∈ {low, medium, high}` (`:20`), `confidence_score` dans `[0,1]` (`:22`), `statements_json` doit contenir `facts`, `hypotheses`, `inferences` (`:174-179`). Cohérence de portée par `CHECK` : `price` ⇒ `line_id` non nul et `compare_version_id` nul ; `delta` ⇒ l'inverse avec `compare_version_id <> version_id` (`:203-215`). **Pas de TTL** : le cache est adressé par contenu (`snapshot_fingerprint = sha256(payload)`, `src/lib/estimates/explanations.ts:387-400`) et par index unique partiel sur les lignes non supersédées (`:217-225`) ; une empreinte différente crée une ligne et supersède l'ancienne (`explanations.ts:1109-1124`). ⚠️ **Les explications de delta n'appellent jamais le LLM** : toujours déterministes (`usedFallback: true`, `provider: "fallback"`, `:999-1013`), et une narration contredisant le diff est jetée au profit du repli (`:1038-1060`). Confiance : base `0,35` ; `+0,12 × min(faits,4)` ; `+0,05 × min(provenances,4)` ; `−0,04 × min(hypothèses,3)` ; `−0,05 × min(inférences,3)` ; `−0,08` si un risque est `high` ; borné `[0,2 ; 0,95]` ; libellés `>= 0,75` → `high`, `>= 0,5` → `medium` (`:368-385`). Plafonds : 6 énoncés par catégorie, 8 provenances, 3 « top drivers », résumé court 320 / détaillé 2400 caractères (`:140-146`).

---

## 8. Suggestions de prix et apprentissage

**Scoring** (`src/lib/estimates/suggestion-scoring.ts`) : `score = base + bonusFréquence + bonusRécence + learningBoost`, arrondi à 3 décimales (`:260-268`). Base : exact **100**, sous-chaîne ou token entier **72** (similarité `0,85`), flou **`46 + similarité × 20`** au-dessus du plancher `MIN_FUZZY_SIMILARITY = 0,65` (`:24-28,154-198`). Fréquence `min(15, log10(usage_count + 1) × 8)` (`:139-143`). Récence **`3`** si ≤ 7 jours, **`1,5`** si ≤ 30 jours, sinon `0` (`:145-152`). Limite par défaut **5** suggestions (`:282`), départages score → règles jamais utilisées reléguées → `usage_count` → `position` → nom (`:288-302`). Seul `match_type = "keyword"` est traité (`:223`) et accepté à la création (`schemas.ts:877-888`).

**Suggestions catalogue** (`/suggest-prices`) : formule distincte (`src/lib/estimates/server.ts:3563-3628`) — désignation exacte **+100**, préfixe **+80**, sous-chaîne **+60** ; référence produit **+50/+30** ; fournisseur **+35/+20** ; SKU **+25/+12** ; chaque détail technique **+28/+14**. `q` de **2** caractères minimum (`suggest-prices/route.ts:11`), limites de requête 40 produits / 40 fournisseurs / 400 lignes de pricebook (`server.ts:7759,7765,7818`), **10** suggestions retournées au maximum (`:7865`). Débounce de la popover **300 ms** (`.../estimate-editor-row/shared.ts:140`).

**Apprentissage** (`src/lib/estimates/suggestion-learning.ts`) : 6 champs suivis `description, category_id, k_fo, k_mo, labor_role_id, supply_type_id` (`:52-59`). Corrections dans `suggestion_corrections`, revues dans `suggestion_learning_reviews` (`status ∈ {approved, rejected}`, `supabase/migrations/20260222220000_est163_suggestion_learning.sql:95-115`). Seuil par défaut **3** occurrences, rétention **12** mois, maxima **100** et **120** (`:47-50`), flags `EST_163_SUGGESTION_LEARNING*` (`:43-46`) — désactivé par défaut en base (`migration:320-333`). Une proposition est active si approuvée, inactive si rejetée, sinon si `correction_count >= seuil` (`migration:242-246`). Boost par champ `min(4, log10(n+1) × 4) + (approuvé ? 2 : 0)` plafonné à **6** (`:261-265`), somme par règle plafonnée à **20** (`:270-274`). Maximum **50** corrections par requête (`schemas.ts:942`). ⚠️ Le retour `"reject"` sur une règle est **un no-op complet** (`server.ts:9013-9018`) ; seul `"accept"` incrémente `usage_count` (3 tentatives en CAS optimiste, `:9024,9076`).

**Suggestions en masse** (`src/lib/estimates/bulk-suggest.ts`) : 4 champs modifiables `description, k_fo, k_mo, category_id` (`:15`). Une ligne n'est éligible que si elle est **entièrement neutre** — `k_fo` et `k_mo` nuls ou **exactement 1**, description et catégorie vides (`:246-268`). Seule la **meilleure** règle par ligne est retenue (`:418`) et le patch est **recalculé au moment de l'application** pour ne jamais écraser un champ déjà rempli (`:488`). Barre de progression au-delà de **50** items (`src/hooks/useEstimateEditorSuggestionsController.ts:127`). Il n'existe **aucun endpoint serveur de bulk-suggest** (vérifié : `grep -rn "applyBulkSuggestions\|computeBulkSuggestions" src` → uniquement `bulk-suggest.ts` et le contrôleur) : l'application passe par `/items/bulk`.

---

## 9. Routes API du domaine

57 fichiers `route.ts` sous `src/app/api/estimates/` (vérifié : `find src/app/api/estimates -name route.ts | wc -l` → `57`).

| Route | Méthodes | Note |
|---|---|---|
| `/api/estimates` | GET, POST | POST 201 |
| `/api/estimates/stats`, `/import-sources` | GET | |
| `/api/estimates/{v}` | GET, PATCH | |
| `/api/estimates/{v}/items` | GET, POST, PATCH, DELETE | CRUD unitaire |
| `/api/estimates/{v}/items/bulk` | POST | ⚠️ perd la MO éclatée (§3) |
| `/api/estimates/{v}/items/move`, `/items/reorder` | POST | RPC verrouillants |
| `/api/estimates/{v}/batch` | POST | max 100 op., `If-Match`, `?dry_run=` |
| `/api/estimates/{v}/lock` | POST, PATCH, DELETE | acquérir / renouveler / libérer |
| `/api/estimates/{v}/sections`, `/sections/{s}/duplicate` | GET / POST | |
| `/api/estimates/{v}/import-sections`, `/import-linked-dpgf` | POST | `mode ∈ {merge, append}`, ≤ 100 sections |
| `/api/estimates/{v}/duplicate`, `/variants` | POST / POST+PATCH | PATCH = promotion de variante |
| `/api/estimates/{v}/changelog` | GET | `?compare=`, `?format=json\|pdf` |
| `/api/estimates/{v}/events`, `/verify` | GET | |
| `/api/estimates/{v}/status`, `/send` | PATCH / POST | gating appliqué au `send` |
| `/api/estimates/{v}/gating`, `/outliers` | GET / GET+POST | POST = rejet d'anomalie |
| `/api/estimates/{v}/lines/{l}/explanation`, `/delta-explanation` | GET | `runtime = "nodejs"` |
| `/api/estimates/{v}/suggest-prices` | GET | `q` ≥ 2 caractères |
| `/api/estimates/{v}/suggestion-rules`, `/{r}`, `/{r}/feedback` | POST / PATCH / POST | |
| `/api/estimates/{v}/suggestion-learning` | GET, POST | ≤ 50 corrections |
| `/api/estimates/{v}/structure-drafts`, `/{d}`, `/{d}/apply` | POST / GET / POST | pas de suppression |
| `/api/estimates/{v}/version-zero-drafts`, `/{d}`, `/{d}/lines/{l}`, `/{d}/materialize` | GET+POST / GET / PATCH / POST | |
| `/api/estimates/{v}/pdf`, `/pdf/layout`, `/export` | POST+GET / GET / GET | |
| `/api/estimates/{v}/approval`, `/approve`, `/approval-journal` | GET / POST / GET | |
| `/api/estimates/assemblies`, `/{a}`, `/{a}/insert` | GET+POST / GET+PATCH+DELETE / POST | insert → 200 |
| `/api/estimates/templates`, `/{t}`, `/{t}/insert`, `/{t}/duplicate`, `/{t}/instantiate` | voir §4.2 | |

Codes HTTP normalisés `400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503` (`src/lib/estimates/errors.ts:42`), avec mapping Supabase → HTTP (`42501` → 403, `PGRST116` → 404, `23505` → 409 — `:184-226`).

À l'échelle de toute l'application, `src/lib/openapi/route-coverage.ts`
inventorie les méthodes HTTP exportées par les fichiers `route.ts`. Le contrat
doit former une partition exacte : 165 opérations documentées et 5 exclusions
justifiées dans `route-exclusions.ts`, soit 170 opérations gouvernées. Le
validateur échoue sur une route nouvelle non documentée, une exclusion stale,
une duplication ou une opération présente dans les deux ensembles.

---

## 10. Pièges à connaître

1. **`/batch` n'est pas atomique** — rollback compensatoire applicatif, échec de rollback simplement journalisé (`src/lib/estimates/batch.ts:510-545,347`).
2. **`/items/bulk` perd silencieusement les colonnes atelier/chantier** (`supabase/migrations/20260223113000_est033_aid_column.sql:161-393`).
3. **Un autosave réussi vide la pile d'undo** (`useEstimateEditorSyncController.ts:614`).
4. **`price_outlier`/`quantity_outlier` sont déclarés dans le gating mais jamais calculés côté envoi** (`src/lib/estimates/gating.ts:499-502`).
5. **Le compteur de référence d'affaire plafonne à 999 par tenant et par an** ; au-delà l'insertion échoue (`20260719132414…:145-148`).
6. **Les créations non dupliquées ont une seule frontière de persistance** :
   `persistCanonicalEstimateV2` puis `persist_estimate_creation_atomic`. Ne pas
   réintroduire un `insert` direct ou une RPC d'import historique.
7. **Une regex AID invalide retombe sans bruit sur le format par défaut** (`src/lib/estimates/schemas.ts:45-51`).
8. **Aucun plafond de taille au collage côté client** : une feuille de plusieurs milliers de lignes est entièrement prévisualisée (`clipboard.ts:50-52`, sans appelant).
9. **La majoration MO collée est divisée par 100 si elle dépasse 10**, sans confirmation (`clipboard.ts:401-419`).
10. **Les ouvrages générés n'ont ni bail de budget IA ni assertion de rôle d'écriture**, avec 3 retries par défaut (`generated-ouvrages.ts:2966-2984,1447-1455`).
11. **La matérialisation version zéro écrit des lignes à prix nul** (`version-zero-drafts.ts:1856-1861`) ; l'insertion d'assemblage écrit aussi des totaux nuls, recalculés ensuite côté TypeScript (`server.ts:6407-6502`).
12. **Code mort avéré** : RPC de bibliothèque d'ouvrages à l'échelle et `src/lib/estimates/assembly-library.ts` sans appelant ; pas d'endpoint de duplication d'assemblage, et la duplication cliente perd `reference_code` (`client.ts:5606-5639`).
13. **La fonction d'écriture d'événements n'accepte que 5 des 8 `event_type` autorisés par la table** (`20260222153000…:75-80` vs `supabase/schema.sql:5025-5037`).
14. **Le panneau d'aide clavier est incomplet** : `F2` et la frappe directe n'y figurent pas (`EstimateEditorToolbar.tsx:1245-1259`).

> Les fichiers `useColumnVisibility.ts`, `ColumnHeaderHelp.tsx`, `EstimateLineTruthBadges.tsx`, `StandardMoCells.tsx` et `estimate-editor-row/shared.ts` comportaient des modifications non committées au moment de la lecture ; leurs numéros de ligne proviennent de l'arbre de travail.
