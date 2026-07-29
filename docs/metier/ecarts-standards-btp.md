# Écarts face aux standards du chiffrage BTP

> **Source : le code au 2026-07-29 (`6cacda36`).**
> Ce document remplace l'ancien corpus d'épics et de tickets, dont les statuts déclarés étaient faux
> dans 22 cas sur 26. Il applique un contrat différent : **toute affirmation d'existence porte une
> référence `fichier:ligne`, et toute affirmation d'absence porte la commande qui la prouve.**
>
> Une absence se périme comme une présence : si un grep ci-dessous retourne désormais un résultat,
> c'est ce document qu'il faut corriger, pas le code.

---

## Comment lire ce document

Trois régimes distincts, à ne pas confondre :

| Régime | Ce que ça veut dire |
|---|---|
| 🔴 **Défaut actif** | Le code fait quelque chose de **faux**. Ce n'est pas un manque, c'est une erreur en production. |
| ⬛ **Absent** | La fonctionnalité n'existe pas. Prouvé par un grep à zéro résultat, daté. |
| ⚠️ **Présent mais contre-intuitif** | Existe, fonctionne, mais se comporte autrement qu'attendu. |

Aucune priorité, aucune date cible, aucun assignataire : ce document dit **ce qui est**, pas ce qu'on
compte faire. La priorisation appartient à un tracker, pas au dépôt — c'est précisément ce que
l'ancien backlog en Markdown n'a pas su tenir.

---

## 1. 🔴 Défauts actifs

Huit comportements produisent des résultats incorrects aujourd'hui, classés du plus grave au moins
grave. Le premier détruit des données.

### 1.1 Un reclassement de document supprime définitivement des fichiers de plans

C'est le seul défaut de cet audit qui provoque une **perte de données irréversible**.

La synchronisation intake → plans traite la liste de documents qu'elle reçoit comme **la vérité
complète** du projet : tout fichier de plan déjà synchronisé dont le document d'origine n'est pas
dans cette liste est considéré périmé, puis supprimé.

```ts
// src/lib/affaires/intake-plan-sync.ts:388-397
const desiredDocumentIds = new Set(eligibleDocuments.map((d) => d.id));
const staleFiles = syncedPlanFiles.filter((file) => {
  const intakeDocumentId = toIntakeDocumentId(file);
  return intakeDocumentId !== null && !desiredDocumentIds.has(intakeDocumentId);
});
await deleteSyncedPlanFiles({ supabase: input.supabase, files: staleFiles });
```

La suppression touche bien le stockage, pas seulement la base :

```ts
// src/lib/affaires/intake-plan-sync.ts:247-250
const storagePaths = input.files.map((file) => file.file_path);
await input.supabase.storage.from(PLAN_FILES_BUCKET).remove(storagePaths);
```

**Or la liste reçue n'est jamais celle du projet : elle est scopée à un seul upload.** Sur le chemin
de reclassement d'un document, les documents sont rechargés avec
`.eq("upload_id", document.upload_id)` (`src/lib/affaires/intake-server.ts:3208-3211`), puis passés
tels quels à la synchronisation (`:2112`).

**Conséquence** : reclasser un document appartenant à l'upload B fait passer pour périmés tous les
plans synchronisés depuis l'upload A, et les efface du bucket `plan-files`.

Aggravant — **l'échec est avalé** : l'appel est enveloppé dans un `try/catch` qui se contente d'un
`console.error` (`src/lib/affaires/intake-server.ts:2114-2120`). Ni l'utilisateur ni l'appelant ne
sont informés.

> **Confiance : élevée sur la lecture du code, non reproduit contre une instance réelle.** À
> confirmer par un scénario à deux uploads avant correction — mais la conjonction « liste partielle
> traitée comme exhaustive » + « suppression Storage » + « erreur silencieuse » ne laisse guère de
> place au doute.

### 1.2 L'unité de mesure n'est pas un champ de la ligne de devis

`estimate_items` porte `quantity`, `unit_price_ht_cents`, `k_fo`, `h_mo`, mais **aucune colonne
`unit`**.

> Vérifié : `awk '/create table .*estimate_items/,/^\);/' supabase/schema.sql | grep -cE '^\s+unit '`
> → **0**. Et aucune migration n'en ajoute :
> `grep -rn "alter table.*estimate_items.*add column" supabase/migrations/*.sql | grep -i unit` → 0.

Les tables voisines en ont une : `products` (`supabase/schema.sql:241`),
`estimate_assembly_items` (`:902`), `supplier_pricebook` (`:4293`). La ligne de devis, non.

**Conséquence directe** — **cinq surfaces de sortie** alimentent la colonne « Unité » avec la
**description**, vérifiées une par une :

| Sortie | Référence |
|---|---|
| Export DPGF | `src/lib/estimates/dpgf-export.ts:340` — `unite: item.description?.trim() ?? ""` |
| Export BDC | `src/lib/estimates/bdc-export.ts:489` — idem |
| Export standard (streaming) | `src/lib/estimates/export-stream.ts:202` — idem |
| Export CSV de l'éditeur | `src/lib/estimates/editor-export.ts:376` — `unit: item.description?.trim() ?? ""` |
| Colonne « unité » du PDF | `src/lib/estimates/pdf-generator.tsx:1307` — `{item.description?.trim() \|\| "-"}` sous `width: widths.unit` |

Ce n'est donc pas un défaut d'un seul exportateur : c'est la conséquence systématique de l'absence
de champ.

**Pourquoi c'est le défaut le plus grave.** Il n'existe pas de DPGF conforme sans unité : c'est une
colonne obligatoire de la pièce contractuelle. Un `m²` chiffré comme `ml` change le prix d'un ordre
de grandeur, et l'erreur est invisible à la relecture puisque la colonne *paraît* remplie.

### 1.3 Le sous-détail de prix est détruit à l'insertion dans un devis

Le sous-détail BTP **existe** au niveau de la bibliothèque d'ouvrages —
`supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql:17-27` :

| Champ | Valeurs |
|---|---|
| `cost_type` | `material`, `labor`, `equipment`, `subcontract` |
| `unit_cost_ht_cents` | coût unitaire du composant |
| `loss_coeff_bp` | coefficient de perte, `0..100000` |
| `yield_value` / `yield_unit` | rendement |

Agrégats exposés : `material_cost_cents`, `labor_cost_cents`, `equipment_cost_cents`,
`subcontract_cost_cents`, `calculated_ds_cents`, `pose_only_cents`, `supplied_installed_cents`
(`src/lib/estimates/assembly-library.ts:135-141`).

**Mais la matérialisation d'un ouvrage dans un devis l'aplatit en lignes ordinaires**
(`supabase/migrations/20260722132425_nested_estimate_assemblies.sql:561-591`) : ces colonnes
n'existent pas sur `estimate_items` et sont perdues ; un composant `labor` est inséré à
`unit_price_ht_cents = 0`.

Le sous-détail n'est donc **jamais opposable au maître d'œuvre**. Il n'existe que dans la
bibliothèque, c'est-à-dire nulle part où il compte.

### 1.4 La même règle de marge rend deux verdicts opposés selon le point d'entrée

```ts
// src/lib/estimates/rules-engine.ts:883-895
const marginBp = toFiniteNumber(version.margin_bp, NaN);
if (Number.isFinite(marginBp) && marginBp >= 0) return marginBp;
// sinon : dérivation depuis margin_multiplier
```

`margin_bp` est déclaré **optionnel** dans le type d'entrée du moteur
(`RulesEngineVersion.margin_bp?: number | null`, `rules-engine.ts:401-408`). Ce qui est évalué dépend
donc entièrement de ce que l'appelant a pris la peine de sélectionner — et les deux appelants ne
sélectionnent pas la même chose.

| Point d'entrée | `margin_bp` sélectionné ? | Valeur évaluée |
|---|---|---|
| **Gating d'envoi** — `getEstimateSendGating` (`server.ts:8315`) tire sa version de `getVersionAccessOrThrow` (`:4104-4106`) | **Non** (ni `margin_bp`, ni `discount_bp`) | `undefined` → `NaN` → **repli sur `margin_multiplier`** |
| **Évaluation d'approbation** — `rules-engine.ts:3771` sélectionne explicitement `margin_bp` et `discount_bp` | **Oui** | `margin_bp` tel quel, soit **0** |

`margin_bp` est `integer not null default 0` (`supabase/schema.sql:368`) et n'est écrit qu'à la
création par l'assistant (`src/components/estimates/estimate-creation-wizard/PricingStep.tsx:173`,
défaut `"0"`) ; le panneau de réglages ne modifie que `margin_multiplier`. La colonne vaut donc 0 sur
la quasi-totalité du parc.

**Deux conséquences distinctes :**

1. **`min_margin` est incohérent** : le gating juge sur la marge réelle dérivée du multiplicateur,
   l'approbation juge sur 0 bp. Un devis peut passer le gating et être bloqué à l'approbation, ou
   l'inverse, sans qu'aucune donnée n'ait changé.
2. **`max_discount` ne se déclenche jamais dans le gating**, `discount_bp` n'y étant pas non plus
   sélectionné.

Les tableaux de bord direction (`src/lib/direction/server.ts:990`) et la file d'approbation
(`src/lib/approvals/server.ts:174`) lisent `margin_bp` et affichent donc la valeur à 0.

C'est le défaut qui **corrompt des décisions métier en continu**, et le plus insidieux des cinq : il
ne produit pas une erreur franche mais deux vérités concurrentes.

### 1.5 Le bucket `dpgf-imports` n'accepte pas `application/pdf`

Le bucket est créé avec une liste blanche de types MIME qui **n'inclut pas le PDF**
(`supabase/migrations/011_dpgf_import_tables_s3.sql:121-127`) :

```sql
array['text/csv', 'application/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream']
```

Aucune migration ultérieure ne l'élargit : la seule autre à toucher `dpgf-imports`
(`20260713134332_harden_ingestion_audit_boundaries.sql`) ne modifie que des policies.

Or le chemin d'import multipart **téléverse avant d'aiguiller sur le PDF** :

```ts
// src/lib/imports/server.ts:1107  → détection
const isPdf = isPdfImportFile(fileEntry);
// src/lib/imports/server.ts:1121-1125  → upload, AVANT la branche PDF (:1151)
await supabase.storage.from(DPGF_IMPORTS_BUCKET)
  .upload(storagePath, fileEntry, { contentType: getUploadContentType(fileEntry), … });
```

`getUploadContentType` (`:647-650`) renvoie `file.type` tel quel — soit `application/pdf` pour un
fichier déposé depuis un navigateur. L'upload est donc rejeté par Storage et remonte en
« Impossible de televerser le fichier. » (`:1128`).

> **Confiance : élevée, mais non exécuté contre une instance Supabase réelle.** Le cas échappe au
> filtre si le client n'envoie aucun `Content-Type` : `getUploadContentType` renvoie alors
> `undefined` et Storage retombe sur `application/octet-stream`, qui est autorisé. C'est
> probablement pourquoi le défaut a pu passer les tests, qui construisent des `File` synthétiques.
> À confirmer par un dépôt de PDF réel avant correction.

### 1.6 Le portail client est complet et inatteignable

Toute la surface existe : page publique `src/app/portal/[token]/page.tsx`, routes
`POST /api/portal/[token]/accept` et `/reject`, pavé de signature
`src/components/portal/SignaturePad.tsx`, page d'expiration, table `portal_tokens`, RLS et RPC
anti-concurrence `claim_portal_estimate_decision`.

**Mais aucun token n'est jamais créé, et aucun lien n'y mène.**

> Vérifié côté application : les cinq usages hors tests de `portal_tokens` sont des **lectures** —
> `src/app/api/portal/[token]/accept/route.ts:92`, `:201`, `reject/route.ts:43`,
> `src/app/portal/[token]/page.tsx:55`, `:69`. Aucun `.insert(`.
>
> Vérifié côté base : `grep -rn "insert into public.portal_tokens\|insert into portal_tokens"
> supabase/migrations/ supabase/schema.sql` → **0**. Aucun RPC, aucun trigger ne les émet.
>
> Vérifié côté email : `resolvePortalUrl` (`src/lib/email/send-estimate.ts:58-72`) construit
> `<base>/estimates/<versionId>` si `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` est défini, sinon
> `/dashboard/estimates/<versionId>/print`. **Jamais `/portal/<token>`.**

Conséquence : le client qui reçoit un devis par email est envoyé soit vers une URL applicative, soit
vers une page `/dashboard/…` qui exige une authentification qu'il n'a pas. Le parcours
d'acceptation et de signature en ligne n'est pas atteignable en production.

### 1.7 La checklist de correction est structurellement vide depuis juillet 2026

`estimate_review_correction_items` est alimentée par la fonction `decide_estimate_review_cycle`,
définie en mars 2026 (`supabase/migrations/20260307183000_v3_020_correction_checklist.sql:640`).

Cette fonction a été **redéfinie** en juillet par
`supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql`. Or
`create or replace function` remplace le corps entier, et la nouvelle version ne mentionne plus la
table du tout.

> Vérifié : `grep -c 'estimate_review_correction_items'` → **46** occurrences dans la migration de
> mars, **0** dans celle de juillet.

Conséquences : la checklist de correction ne se remplit plus, le verrou de resoumission qui en
dépendait ne se déclenche plus, et le champ `rulesTriggered` du journal de décision est vide pour
toute décision passant par un cycle de revue.

### 1.8 La TVA est arrondie au demi-supérieur

`bankersRound` (demi-au-pair) est utilisé pour le PU, le coefficient global, les paliers de remise
cascade et l'allocation — avec un commentaire invoquant la doctrine DGFiP pour éviter le biais
haussier. Mais `computeTaxCents` utilise `Math.round` (`src/lib/money.ts:109`).

Le seul montant réellement opposable au fisc est donc le seul à subir le biais que la règle
prétendait éviter. Voir [regles-de-calcul.md § 1.1](regles-de-calcul.md).

---

## 2. ⬛ Absent du produit

Chaque ligne porte la preuve de son absence, exécutée le 2026-07-29 sur `src/` et
`supabase/migrations/`.

### 2.1 Structure de prix

| Standard BTP | Preuve d'absence |
|---|---|
| **Décomposition DS / FC / FG / B&A** et niveau « coût de revient » | `grep -rIl 'coeff_fc\|coeff_fg\|coeff_ba\|frais_generaux\|frais_chantier'` → **0** |
| **Remises multi-niveaux** (section, ligne) | Aucun `discount_bp` sur `estimate_items` ; la remise est une grandeur de version |
| **Coefficients de perte / rendement sur lignes de devis** | `loss_coeff_bp` existe (19 fichiers) mais **uniquement** sur `estimate_assembly_items` — voir § 1.2 |

Le modèle réel est à **un seul étage** : `vente = coût × margin_multiplier`. Le BTP français attend
`DS → FC → FG → CR → B&A → PV`. Voir [regles-de-calcul.md § 2](regles-de-calcul.md).

### 2.2 Métré

| Standard | Preuve d'absence |
|---|---|
| **Formules dans les quantités** | `grep -rIl 'quantity_formula\|formula-parser'` → **0**. Aucun parseur, aucune dépendance de calcul symbolique |
| **Carnet de métrés** (`n × L × l × h`, par zone, déductions signées) | `grep -rIl 'measurement_sheet'` → **0**. Aucune table, aucun champ de dimension |

Le type d'évidence `"formula"` du takeoff n'est pas un calcul : c'est une étiquette pour une
**agrégation par somme** (`src/lib/takeoff/evidence.ts:378-411`).

### 2.3 Exécution et facturation

C'est le bloc le plus lourd : le produit sait chiffrer, mais s'arrête à la signature.

| Standard | Preuve d'absence |
|---|---|
| **Situations de travaux** (facturation à l'avancement) | `grep -rIl 'situation_travaux\|progress_billing\|avancement_cents'` → **0** |
| **Avenants** formalisés et numérotés | `grep -rIl 'avenant'` → 1 fichier, et c'est `src/lib/estimates/pdf-terms.ts:37,43` — du **texte de CGV**, jamais un concept modélisé |
| **Retenue de garantie 5 %**, caution de substitution | `grep -rIl 'retenue_garantie\|retention_guarantee'` → **0** |
| **DGD** (décompte général définitif) | `grep -rIl 'decompte_general\|dgd_'` → **0** |
| **Pénalités de retard** | `grep -rIl 'penalite_retard\|penalty'` → **0**. Mentionnées en CGV, jamais calculées |
| **Révision / actualisation de prix** par indices BT | La table `material_indices` existe (`supabase/schema.sql:4333`), aucun moteur ne l'applique à un devis |
| **Compte prorata** | Aucune occurrence |
| **Acompte / échéancier structuré** | Clause CGV textuelle seulement (`pdf-terms.ts:39`) |

### 2.4 Marchés publics

| Standard | Preuve d'absence |
|---|---|
| **Allotissement** (`lot_code`, `trade`, récap TCE, extraction de lot) | `grep -rIl 'lot_code\|allotissement'` → **0**. Le « Lot » n'est qu'un **libellé cosmétique** du niveau 1 de hiérarchie (`src/lib/estimates/hierarchy.ts:8-13`) |
| **Sous-traitance par ligne** (en propre vs sous-traité, marge ST) | `grep -rIl 'execution_mode\|subcontractor_price'` → **0**. À ne pas confondre avec `contractor_role`, qui est un régime **fiscal** porté par la version |
| **Mémoire technique**, DC1 / DC2, attestations | Aucune occurrence |
| **Option / variante commerciale / PSE** au niveau de la ligne | Aucun statut de ligne dédié. Les variantes de devis sont un outil de chiffrage avant signature, pas une option contractuelle |

### 2.5 Fiscalité

| Standard | État |
|---|---|
| **Autoliquidation sous-traitance** | ✅ **Implémentée intégralement** — voir [regles-de-calcul.md § 5.1](regles-de-calcul.md) |
| **Taux réduits 5,5 % / 10 %** prédéfinis | Champ pourcentage libre (`src/components/estimates/EstimateSettingsPanel.tsx:677-682`) |
| **Récapitulatif TVA par taux** au document | Un seul taux affiché |
| **Multi-taux par ligne** | 🔴 La colonne `tax_rate_bp` existe sur `estimate_items` (`supabase/schema.sql:529`) mais est **écrasée** par le taux de version à chaque normalisation (`src/lib/estimate-calculations.ts:1772`). Honorée seulement par le moteur v2, inactif |
| **CERFA 1301-SD** | Aucune occurrence |
| Sous-traitant en **franchise en base** | Cas non traité |

> ⚠️ **Contradiction à arbitrer.** Un récapitulatif TVA par taux avec mention de l'art. 279-0 bis
> entre en conflit direct avec l'autoliquidation, qui impose un document **sans aucune ligne de TVA**
> (`src/components/EstimateDocument.tsx:382-386`, `:460-465`). Les deux règles doivent être
> conditionnées par `contractor_role`, sinon implémenter la première casse la conformité de la
> seconde.

### 2.6 Cycle commercial

| Standard | Preuve d'absence |
|---|---|
| **Cycle de vie d'affaire** | `estimate_projects` ne porte qu'`is_archived boolean not null default false` (`supabase/schema.sql:334-344`). Ni prospect / à chiffrer / remis / gagné / perdu, ni date de remise, ni motif de perte. `AffaireStatus` est un **alias** de `estimate_status` (`src/lib/affaires/schemas.ts:30`) : c'est le statut du devis qui est affiché comme statut d'affaire |
| **Conversion de devise** | `grep -rIl 'convertCents\|convertCurrency' src/` → 1 fichier, et c'est `src/lib/estimates/supplier-preselection.ts:7`, un **commentaire qui constate l'absence**. Trois devises sont acceptées à la saisie (`src/lib/money.ts:1`), aucune n'est convertible |
| **Délai / planning / phasage** | Les heures de main-d'œuvre sont saisies, rien ne les relie à une durée de chantier |
| **Pièces réglementaires de chantier** (décennale, PPSPS, assurances) | Aucune occurrence |

> **Sans cycle de vie d'affaire, il n'existe aucun taux de transformation mesurable.** C'est la
> lacune fonctionnelle la plus structurante après l'unité.

### 2.7 Observabilité et collaboration

| Standard | Preuve d'absence |
|---|---|
| **APM / traces** | `grep -rIl 'Sentry\|opentelemetry\|datadog'` → **0**, et aucune dépendance dans `package.json` |
| **Tests de charge** | `grep -rIl 'k6\|artillery'` → **0** |
| **Collaboration temps réel** (présence, commentaires live) | `grep -rIl 'supabase.channel\|realtime'` → **0** |
| **Relance automatique** d'un devis envoyé | Aucun cron ni table de relance |
| **Négociation / contre-proposition** structurée | La table `estimate_negotiations` existe en base mais n'est référencée que dans `src/types/database.ts` — **table morte** |

---

## 3. ⚠️ Présent, mais contre-intuitif

Ni défauts ni manques : des comportements réels que rien ne signalait. Ils sont détaillés dans
[regles-de-calcul.md](regles-de-calcul.md) et [cycle-de-vie.md](cycle-de-vie.md) ; rassemblés ici
pour qu'on puisse les parcourir d'un coup.

| Comportement | Référence | Pourquoi ça surprend |
|---|---|---|
| Écrêtage silencieux à **21 474 836,47 €** | `src/lib/estimate-calculations.ts:14`, `:149-151` | Un total **minoré** peut partir au client ; le drapeau `isCapped` existe (`:470`) mais rien n'oblige à le lire |
| Barème de marge par défaut **×1,6 / ×1,45 / ×1,4** | `src/lib/estimates/margin-tiers.ts:9-13`, repli `:46` | S'applique **sans avertissement** à tout tenant qui n'a pas défini de barème |
| Toute édition **invalide les approbations** antérieures | `src/lib/estimates/rules-engine.ts:1490-1544` | Gouvernance forte, invisible pour l'utilisateur |
| Hors brouillon, un `UPDATE` **sans changement de statut** est refusé | `supabase/migrations/20260727020000_estimate_version_integrity.sql:16-18` | Il ne suffit pas de « ne rien modifier de sensible » |
| L'application d'un métré est **one-shot** et irréversible | `src/lib/takeoff/server.ts:7546-7558`, `:7809-7821` | Ré-appel → 409. Un état `partial_apply` existe (`:7726-7801`) |
| Les niveaux A/B/C sont une **profondeur d'extraction**, pas une fiabilité | `src/lib/takeoff/types.ts:22` | Mais ils sont convertis en score de confiance **0,92 / 0,68 / 0,42** (`src/lib/estimates/line-truth.ts:327-333`), ce qui les fait *lire* comme une fiabilité |
| Le prix de référence produit est **synchronisé par trigger** depuis les commandes confirmées | `supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql` | Modifie des prix catalogue **sans action utilisateur** |
| Deux échelles de fraîcheur des prix coexistent | `src/lib/catalogue/stale-prices.ts:1` (90 j) et `:43-60` (30/90) | Le drapeau qualité n'utilise que la première |
| Le module métré est **désactivé par défaut** | `TAKEOFF_MODULE_ENABLED = false`, `src/lib/takeoff/constants.ts:1` | Toute description du produit qui le suppose actif est fausse par défaut |

---

## 4. Dette technique du moteur de calcul

| Point | Référence |
|---|---|
| **Deux moteurs complets** coexistent dans un fichier de 1 968 lignes | `src/lib/estimate-calculations.ts` |
| Seul l'**éditeur** épingle encore `EDITOR_CALC_ENGINE_VERSION = 1` | `src/lib/estimates/calc-engine-version.ts:28`, consommé par `src/components/estimates/hooks/useEstimateVisibility.ts:189` et `src/hooks/useEstimateEditorState.impl.tsx:1127` |
| `EXPORT_CALC_ENGINE_VERSION` est une **constante morte** | `calc-engine-version.ts:31` — zéro usage hors sa déclaration |
| `invariants.matchesFooter` est **structurellement `false`** en production | `estimate-calculations.ts:1583-1585` |
| Branche morte : `discountMode === "simple"` avec `discount_steps` non vide | `estimate-calculations.ts:485-491`, état rendu impossible par `supabase/schema.sql:7666` |

Détail complet et précautions de bascule : [regles-de-calcul.md § 8](regles-de-calcul.md).

---

## 5. Anomalies produit constatées

Trois défauts relevés lors d'une vérification visuelle du 2026-03-10, sans trace de correction
depuis. Contrairement au reste de ce document, ils **n'ont pas été re-vérifiés au 2026-07-29** : à
confirmer avant toute action.

| Constat | Sévérité déclarée à l'époque |
|---|---|
| Disparition de « Expliquer ce prix » après duplication de version | Majeure |
| Incohérence entre le résumé de delta global et le delta de ligne | Majeure |
| Impact marge insuffisamment explicite dans le panneau delta | Mineure |

L'inventaire UX/UI complet, daté et **régénérable**, vit dans
[`../audit/AUDIT-2026-07-inventaire.md`](../audit/AUDIT-2026-07-inventaire.md) — 27 bugs et
73 constats, avec un statut de rapprochement par item.

---

## 6. Dette de refactoring

Trois fichiers dépassent largement le seuil de lisibilité. Mesuré au 2026-07-29 (`wc -l`) :

| Fichier | Lignes |
|---|---:|
| `src/components/affaires/AffaireHub.tsx` | **2 128** |
| `src/components/estimates/EstimateEditorTable.tsx` | **2 468** |
| `src/components/takeoff/TakeoffReviewPage.tsx` | **1 600** |

À titre de comparaison, les composants découpés du même périmètre tiennent entre 74 et 679 lignes.

---

## Voir aussi

- [regles-de-calcul.md](regles-de-calcul.md) — formules, arrondis, TVA, marge, les deux moteurs
- [glossaire.md](glossaire.md) — vocabulaire du chiffrage BTP
- [cycle-de-vie.md](cycle-de-vie.md) — statuts, immutabilité, scellement, approbations
- [../domaines/](../domaines/) — référence fonctionnelle par domaine
