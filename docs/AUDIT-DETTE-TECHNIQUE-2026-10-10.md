# Audit de dette technique — 2026-10-10

> État du dépôt à `main @ d9b44271` (2026-10-09), hors travail non commité sur le chargement de la page
> affaire. Ce document est le **delta** de [`AUDIT-DETTE-TECHNIQUE-2026-08-19.md`](AUDIT-DETTE-TECHNIQUE-2026-08-19.md) :
> même formule de score, même grille d'effort. Il ne ré-audite pas ce que l'audit d'août a établi et qui
> est payé (§7). Instantané daté : ses chiffres se périment, le code fait foi.

## Chiffres clés

| Indicateur | Valeur |
|---|---|
| Quality Gate sur `main` | **rouge depuis le 2026-08-20** — dernier succès `113d61ea`, 92 échecs depuis |
| Matrice RLS / pgTAP | **rouge depuis le 2026-09-05** — 91 échecs |
| Playwright critique / nightly | **jamais vert** — 65 et 51 échecs, 0 succès |
| Sauvegarde Supabase | **0 succès sur 159 runs** — aucun dump n'a jamais été produit |
| Reprise durable (outbox email, baux, cleanup) | **0 succès sur 200 runs** |
| Pushes directs sur `main` depuis le 2026-09-10 | 39 commits, 0 PR fusionnée ; Vercel déploie HEAD |
| Postes de dette | 28, dont 7 à score ≥ 36 ; 1 bug produisant des documents client faux |
| Effort phases P0 → P1 | ≈ 7 j·h + ½ j d'actions d'administration |

Commandes : `gh run list --workflow <fichier>.yml --status success --limit 1` (vide = jamais) et
`gh run list --workflow <fichier>.yml --limit 200 --json conclusion`.

## 1. Synthèse

L'audit d'août concluait : « les garde-fous existent mais ne gardent rien ». Sept semaines plus tard,
le constat s'est aggravé. **Chaque filet a été construit — et aucun n'est armé.** Le workflow de
sauvegarde existe et n'a jamais sauvegardé ; le draineur de l'outbox email existe et n'a jamais tourné ;
le rapporteur d'erreurs est câblé et n'a pas de destination visible ; les suites E2E existent et n'ont
jamais été vertes en CI ; la matrice RLS est rouge depuis cinq semaines, le Quality Gate depuis sept.

La cause n'est pas technique. Le ruleset de `main` ne bloque que la suppression de branche ; aucun check
n'est requis ; 39 commits ont été poussés directement depuis le 10 septembre et Vercel les a tous
déployés. Un gate rouge que rien n'oblige à regarder devient du bruit, et le bruit s'accumule. **Tant
qu'un push rouge peut atteindre la production, chaque poste de ce document se re-dégradera.**

Trois faits nouveaux pèsent plus que le reste :

- **Aucune sauvegarde hors plateforme n'a jamais existé**, alors que la décision du 2026-08-19 fait
  tourner CI et E2E (avec la clé service-role) contre l'unique projet Supabase, celui de production.
- **Un bug écrit une unité fausse dans les documents client** depuis le 2026-09-04 : associer un article
  du catalogue remplace l'unité de la ligne par sa désignation, qui part dans le DPGF, le bon de commande
  et le PDF.
- **La suppression de 164 suites d'isolation (`e0d64378`, 2026-10-09)** a appliqué la politique
  E2E-first d'`AGENTS.md`, mais a emporté sans remplaçant les gardes statiques que l'audit d'août avait
  explicitement conservées (frontière d'auth des routes, identifiants accentués) et 10 des 29 fichiers
  que le registre de sécurité cite comme preuve de clôture. L'E2E critique ne couvre que l'accès anonyme.

## 2. État des filets

| Filet | Preuve | Cause |
|---|---|---|
| Quality Gate | dernier succès 2026-08-20 | 16 paquets vulnérables (12 high : undici, brace-expansion, braces, browserslist, js-yaml, source-map-js, @modelcontextprotocol/sdk) ; `useEstimateEditorSyncController.ts` 1 249 lignes non vides > plafond 1 200. Jobs Tests et Build verts |
| Matrice RLS | dernier succès 2026-09-05 | `supabase/tests/database/transactional-workflows.test.sql:101` lit `products.tax_rate_bp`, colonne supprimée ; 16/205 assertions échouent dans `estimate-calc-engine-governance.test.sql` |
| Playwright critique / nightly | 0 succès | `auth.setup.ts` échoue (« Target page… closed ») ; les 36 / 87 tests ne démarrent pas |
| Sauvegarde | 0/159 | secret `SUPABASE_DB_URL` absent (`.github/workflows/supabase-backup.yml:40`) ; `BACKUP_ALERT_WEBHOOK` absent |
| Reprise durable | 0/200 | `CRON_SECRET` et `HEX_APP_URL`/`APP_URL` absents ; commentaire périmé `recover-durable-fallback.yml:14` (« the Vercel cron may fire »), alors que `vercel.json` n'a plus de cron |
| Suivi d'erreurs | — | `src/lib/observability/error-reporter.ts` lit `ERROR_REPORTING_DSN`/`SENTRY_DSN` et retombe sur `console.error` ; aucun DSN dans les secrets GitHub, environnement Vercel non lisible depuis le dépôt |
| Protection de `main` | ruleset `main-protection` | bloque la suppression seulement ; aucun check requis |

## 3. Priorisation

Score = (Impact + Risque) × (6 − Effort), chacun sur 1–5.
Effort : 1 ≈ ½ à 1 j · 2 ≈ 1–2 j · 3 ≈ 3–5 j · 4 ≈ 1–2 semaines · 5 > 2 semaines.
👤 = action d'administration hors dépôt (secrets, ruleset, plan Supabase).

| # | Poste | Catégorie | I | R | E | Score | Phase |
|--:|---|---|:-:|:-:|:-:|--:|:-:|
| 1 | CI au vert **et bloquante** (advisories, budget, checks requis 👤) | Infra/process | 5 | 5 | 1 | **50** | P0 |
| 2 | Sauvegardes jamais produites ; test de restauration 👤 | Infra | 4 | 5 | 1 | **45** | P0 |
| 3 | Reprise durable inerte → outbox email jamais drainée 👤 | Infra | 4 | 5 | 1 | **45** | P0 |
| 4 | Bug : associer un article écrase l'unité de la ligne | Bug/données | 4 | 5 | 1 | **45** | P0 |
| 5 | Gardes statiques supprimées → règles ESLint ; `server-only` ; comparaison à temps constant | Sécurité | 3 | 5 | 1 | **40** | P0 |
| 6 | Suivi d'erreurs sans destination 👤 | Infra | 4 | 4 | 1 | **40** | P0 |
| 7 | pgTAP rouge (colonne supprimée ; 16 échecs de gouvernance moteur) | Tests/base | 4 | 5 | 2 | **36** | P0 |
| 8 | `database.ts` écrit à la main ; 1 047 lignes `as never` | Types | 5 | 4 | 2 | **36** | P1 |
| 9 | Aucun scénario E2E inter-tenant | Sécurité/tests | 4 | 5 | 2 | **36** | P1 |
| 10 | Registre de sécurité : 10 preuves de clôture supprimées | Sécurité/docs | 3 | 4 | 1 | **35** | P1 |
| 11 | 7 + 5 copies privées des helpers d'accès version / verrou | Sécurité/code | 3 | 4 | 1 | **35** | P1 |
| 12 | Playwright jamais vert : réparer ou acter le remplacement | Tests | 4 | 4 | 2 | **32** | P1 |
| 13 | Outbox : lignes empoisonnées, dispatchs `unknown` sans écran | Infra/métier | 4 | 4 | 2 | **32** | P1 |
| 14 | `estimates/server.ts`, point chaud n° 1 | Architecture | 5 | 3 | 2 | **32** | P2 |
| 15 | Trois règles de fraîcheur des prix | Code/métier | 3 | 3 | 1 | **30** | P1 |
| 16 | Le rendu de la page affaire écrit en base | Architecture | 3 | 4 | 2 | **28** | P2 |
| 17 | Pas de colonne `unit` sur `estimate_items` | Données/métier | 5 | 4 | 3 | **27** | P2 |
| 18 | 31 références `schema.sql:<ligne>` mortes ; ancres de calcul périmées | Docs | 2 | 3 | 1 | **25** | P1 |
| 19 | Constantes et formateurs monétaires dupliqués | Code | 2 | 3 | 1 | **25** | P2 |
| 20 | Requêtes N+1 | Performance | 3 | 3 | 2 | **24** | P2 |
| 21 | Projet Supabase unique (prod) pour la CI et les E2E | Infra | 3 | 5 | 3 | **24** | risque |
| 22 | Ménage : code mort, fichiers égarés, exemptions périmées | Code | 2 | 2 | 1 | **20** | P1 |
| 23 | `xlsx` + `exceljs` dans le même worker ; `xlsx` hors `npm audit` | Dépendances | 2 | 3 | 2 | **20** | P2 |
| 24 | Erreurs HTTP : helpers encore dupliqués | Code | 3 | 2 | 2 | **20** | P3 |
| 25 | Écritures Supabase restantes depuis le navigateur | Architecture | 3 | 3 | 3 | **18** | P3 |
| 26 | Quatre piles E2E ; parcours couverts seulement en PowerShell | Tests | 4 | 4 | 4 | **16** | P3 |
| 27 | DTO client et OpenAPI sans source unique | Architecture | 3 | 2 | 4 | **10** | P3 |
| 28 | Hook éditeur et grille gelée qui grossit | Architecture | 5 | 4 | 5 | **9** | P3 |

## 4. P0 — armer les filets

### 1 · CI rouge et non bloquante — I 5 · R 5 · E 1 → 50

- Quality Gate : 16 paquets vulnérables remontés par `npm run audit:dependencies` sur le run
  du 2026-10-09 (`d9b44271`) ; la politique `config/dependency-audit-policy.json` n'a aucune exception,
  le gate fait donc son travail. Budget : `src/hooks/useEstimateEditorSyncController.ts` 1 249 lignes non
  vides, plafond par défaut 1 200 (`config/architecture-budgets.json`).
- Les budgets ont été relevés ailleurs depuis août (`useEstimateEditorState.impl.tsx` 2 743 → 3 100) ;
  `LineRow.tsx` est à 1 193/1 200, `EstimateEditorTable.tsx` à 2 550/2 600.
- Ruleset `main-protection` : suppression interdite, rien d'autre.

**Correctif.** Résoudre les advisories (mises à jour ciblées, `overrides` si transitif) ; extraire des
helpers purs du contrôleur de synchronisation plutôt que relever le plafond. 👤 Rendre requis Quality
Gate (statique + tests) et la matrice RLS, PR obligatoire sur `main`.

### 2 · Sauvegardes jamais produites — I 4 · R 5 · E 1 → 45

- `supabase-backup.yml` échoue sur `Missing secret: SUPABASE_DB_URL` depuis sa création
  (`gh run list --workflow supabase-backup.yml --status success` → vide).
- Le plan Supabase (sauvegardes quotidiennes, PITR) n'est pas vérifiable depuis le dépôt.
- Aggravant : CI et E2E écrivent dans ce même projet (poste 21).

**Correctif.** 👤 Poser `SUPABASE_DB_URL` et `BACKUP_ALERT_WEBHOOK` ; vérifier les sauvegardes natives
du plan ; **restaurer une fois** un dump dans une base jetable. Une sauvegarde jamais restaurée n'est
pas une sauvegarde.

### 3 · Reprise durable inerte — I 4 · R 5 · E 1 → 45

- `recover-durable-fallback.yml` (toutes les 5 min) : 0/200. Sans `CRON_SECRET` et `HEX_APP_URL`, ni
  les baux takeoff/intake, ni le cleanup Storage, ni le **drain de l'outbox email**
  (`src/lib/workflows/durable-recovery.ts`) n'ont jamais tourné en production.
- Conséquence métier : un envoi de devis interrompu entre `processing` et la réponse Resend n'est jamais
  rejoué ; le devis apparaît « envoyé » sans email parti.

**Correctif.** 👤 Poser les deux secrets ; mettre à jour le commentaire du workflow.

### 4 · L'association d'un article écrase l'unité — I 4 · R 5 · E 1 → 45

- `estimate_items` n'a pas de colonne `unit` : la cellule « Unité » de l'éditeur écrit dans
  `description` (`src/components/estimates/EstimateEditorTable.tsx:1372-1378`), et les sorties lisent
  `description` comme unité (`src/lib/estimates/dpgf-export.ts:344`, `bdc-export.ts:465,541`,
  `export-stream.ts:206`, `editor-export.ts:376`).
- `handleAssociateArticle` (`EstimateEditorTable.tsx:1555-1573`, commit `b09ac57a`, 2026-09-04) écrit
  `description: designation` : la désignation du produit remplace l'unité. Le type de suggestion porte
  pourtant l'unité (`src/lib/estimates/catalogue-suggestions.ts:41`).

**Correctif.** E2E d'abord (associer un article, relire l'unité persistée et l'export DPGF), puis
conserver l'unité. La cause racine est le poste 17.

### 5 · Gardes supprimées sans remplaçant — I 3 · R 5 · E 1 → 40

- `src/test/api-auth-boundary.test.ts` (interdiction de `auth.getUser(` sous `src/app/api`) et
  `src/lib/i18n/fr-accents.test.ts` sont supprimés par `e0d64378`. Ce sont des lectures de texte source,
  ce que la politique de tests proscrit — mais leur rôle de garde n'a pas été repris ailleurs :
  `rg "getUser" eslint.config.mjs scripts config` → vide.
- La passe d'accents du 2026-10-09 a déjà cassé une requête (colonne `référence` inexistante) et une
  graine, réparées par `fff2aa04` — la récidive n'est plus détectée.
- `src/lib/supabase/service-role.ts` n'importe pas `server-only` ; seule une convention empêche un import
  client (`rg -l "import \"server-only\"" src` → vide).
- Secret worker comparé par `!==` : `src/app/api/internal/takeoff/process-job/route.ts:35`.

**Correctif.** Règles ESLint `no-restricted-syntax` (le lint n'est pas un test et tourne déjà en CI) ;
`server-only` ; `crypto.timingSafeEqual`.

### 6 · Suivi d'erreurs sans destination — I 4 · R 4 · E 1 → 40

Le code est en place (`instrumentation.ts`, `global-error.tsx`, `takeoff/async-worker.ts`), mais faute de
DSN il écrit dans les logs Vercel éphémères. 82 `console.error` hors tests. 👤 Poser
`ERROR_REPORTING_DSN`, puis vérifier une remontée réelle — l'audit d'août a montré qu'une sonde testée
contre un `fetch` mocké ne dit rien du contrat réel.

### 7 · pgTAP rouge — I 4 · R 5 · E 2 → 36

Deux causes distinctes. `transactional-workflows.test.sql:101` est une dérive de test (colonne
supprimée). Les 16 échecs de `estimate-calc-engine-governance.test.sql` touchent l'invariant le plus
sensible du produit (gouvernance du moteur v2) : **établir d'abord s'il s'agit d'une dérive du test ou
d'une régression réelle** ; dans le second cas, la correction est une migration et suit la procédure
Supabase d'`AGENTS.md`.

## 5. P1 — coudre

### 8 · `database.ts` écrit à la main — I 5 · R 4 · E 2 → 36

Inchangé depuis août : 5 106 lignes, aucun `supabase gen types` (`rg "gen types" package.json scripts
.github` → vide), **1 047 lignes `as never`** dans `src/lib`. Exemple : la RPC
`insert_estimate_template_into_version` est appelée avec `as any`
(`src/lib/estimates/assemblies-server.ts:987`) faute de type. Correctif identique à août : générer depuis
`db:ci:local`, échouer sur dérive, retirer les casts module par module.

### 9 · Aucun scénario inter-tenant — I 4 · R 5 · E 2 → 36

`e2e/army/critical/access-boundaries.e2e.ts:17` vérifie l'accès **anonyme** ; aucun scénario ne vérifie
qu'un membre du tenant A ne lit ni le devis, ni le PDF portail, ni un objet Storage du tenant B. La
matrice RLS (`src/lib/estimates/rls.e2e.test.ts`, en `describe.runIf`) couvre la base mais saute
silencieusement hors `db:ci:local`.

### 10 · Registre de sécurité : preuves supprimées — I 3 · R 4 · E 1 → 35

[`security-remediation-91386191.md`](security-remediation-91386191.md) déclare 95/95 constats `fixed`.
`e0d64378` a supprimé 10 des 29 fichiers qu'il cite comme preuve : `signup-tenant-security-regressions`,
`auth-tenant-rls-security-regressions`, `workflow-security-regressions`,
`workflow-write-security-regressions`, `apply-storage-security-regressions`,
`portal-pdf-security-regressions`, `ingestion-security-regressions`, `ai-generation-budget-security`,
`api/imports/route.test`. `AGENTS.md` exige de tenir ce registre à jour : chaque disposition concernée
doit pointer une preuve encore exécutée (pgTAP, RLS, E2E) ou être marquée « preuve manquante ».

### 11 · Helpers d'accès dupliqués — I 3 · R 4 · E 1 → 35

La version canonique est `src/lib/estimates/server-context.ts:119` / `:222`. Copies privées de
`getVersionAccessOrThrow` : `outliers/route.ts:129`, `generated-ouvrages.ts:807`, `pdf-generator.tsx:711`,
`rules-engine.ts:3720`, `structure-drafts.ts:488`, `suggestion-learning.ts:337`,
`version-zero-drafts.ts:429` ; de `assertDraftLockOwnedByCurrentUser` : `outliers/route.ts:177`,
`generated-ouvrages.ts:845`, `structure-drafts.ts:554`, `suggestion-learning.ts:387`,
`version-zero-drafts.ts:493`. Un correctif d'autorisation appliqué à l'original ne protège pas les copies.

### 12 · Playwright jamais vert — I 4 · R 4 · E 2 → 32

`AGENTS.md` conserve Playwright tant que TesterArmy n'a pas d'équivalent exécuté. Mais une suite qui n'a
jamais tourné jusqu'au bout en CI ne prouve rien et ne peut servir d'étalon à son remplaçant. Réparer
`auth.setup.ts`, ou acter par écrit quelles specs sont remplacées et retirer les autres.

### 13 · Outbox : lignes empoisonnées — I 4 · R 4 · E 2 → 32

Ouvert depuis août (§11 de l'audit précédent) : un dispatch dont `created_by` n'est plus habilité ne
peut être ni rejoué ni clos ; `assert_estimate_email_dispatch_actor` n'a pas de branche « acteur
système ». Les dispatchs `unknown` n'ont pas d'écran. Sans objet tant que le poste 3 n'est pas réglé —
à traiter juste après.

### 15 · Trois règles de fraîcheur des prix — I 3 · R 3 · E 1 → 30

Seuil configurable par tenant (`src/lib/catalogue/stale-prices.ts:1`, 90 j par défaut) ; échelle figée
30/90 j (`stale-prices.ts:57-58`, libellés `src/app/dashboard/products/page.tsx:81-83`) qui ignore le
réglage du tenant ; échelle 30/180 j côté métré (`src/lib/takeoff/server.ts:2019-2020`). Un même prix
peut être « à jour » dans un écran et « ancien » dans un autre.

### 18 · Documentation : références mortes — I 2 · R 3 · E 1 → 25

31 références `schema.sql:<ligne>` dans `docs/domaines` et `docs/metier` pointent vers un fichier
réduit à 12 lignes de commentaire (`rg -o "schema\.sql:[0-9]+" docs/domaines docs/metier`). Les ancres
de [`regles-de-calcul.md`](metier/regles-de-calcul.md) ont dérivé (coût de ligne cité à `:229-231`,
aujourd'hui `src/lib/estimate-calculations.ts:243`). Remplacer par des références de migration.

### 22 · Ménage — I 2 · R 2 · E 1 → 20

Lot unique, sans comportement : 5 fonctions jamais appelées dans `src/lib/estimates/client.ts`
(`fetchEstimateVersionEvents`, `fetchAdminSuggestionLearningProposals`,
`reviewAdminSuggestionLearningProposal`, `purgeAdminSuggestionLearnings`, `fetchEstimateTemplate`) ;
4 fonctions de `src/lib/affaires/server.ts` vivantes par leurs seuls tests ; la branche
`estimate-calculations.ts:438-445` (remise simple avec paliers, interdite par la base et Zod) ;
`priceFreshnessLevel()` sans appelant hors test ; l'alias `components/EstimateEditorToolbar.tsx` ;
l'indirection `useEstimateEditorState.ts` → `.impl.tsx` ; `hub-dev-scenarios.ts` (1 365 lignes) importé
par une page de production ; deux `.md` dans `supabase/migrations/` ; un fichier vide nommé `**Il` et
`test_prix_import.csv` à la racine ; les scripts orphelins `generate-fake-plan.py`,
`test-supplier-offer-sql.mjs`, `test-product-reference-sql.mjs` ; les exemptions de budget devenues
inutiles (`EstimateEditorToolbar` 83/1 500, `orders/page` 345/1 500, `AffaireHub` 1 207/2 200).

## 6. P2 et P3 — au fil des features

- **14 · `estimates/server.ts`** (7 421 lignes ; 44 modifications depuis juillet, dont 24 par des
  commits `fix`) : référentiel, templates, assemblies et contexte ont été extraits en août. Restent la
  comparaison fournisseurs (17 fonctions) et le CRUD des items (`updateEstimateItem` ≈ 477 lignes).
  Règle : une feature qui touche un cluster l'extrait d'abord.
- **16 · Page affaire** : le rendu persiste la projection d'approbation et des événements d'audit
  (`src/app/dashboard/affaires/[projectId]/page.tsx:132`). Un GET qui écrit se rejoue à chaque prefetch.
  À traiter après le chantier de performance en cours sur cette page.
- **17 · Colonne `unit`** : migration, backfill depuis `description`, cinq sorties. Sans elle, aucun DPGF
  n'est conforme et le poste 4 peut renaître ailleurs.
- **19 · Constantes** : 15 formateurs `Intl` hors `src/lib/money.ts` ; littéraux `2000` (TVA) dans
  `orders/new`, `orders/[id]/edit`, `CatalogueManager`, `EstimateSettingsPanel` ; `"devis"` ×8 alors que
  `DEVIS_BUCKET` existe et n'est pas utilisé.
- **20 · N+1** : un select et un update par item (`src/lib/takeoff/server.ts:7786-7969`) ; fan-out de
  `suggestEstimateCataloguePrices` qui rejoue auth et accès par requête ; tailles de plans sommées en JS.
- **21 · Projet Supabase unique** : décision du 2026-08-19 (`.github/workflows/e2e-playwright-critical.yml:57`),
  **maintenue**. Risque signalé : sans le poste 2, une suite E2E fautive écrit en production sans filet.
- **23 · Tableurs** : `src/workers/xlsx-parser.worker.ts` charge `xlsx` et `exceljs` ; `xlsx` vient du
  tarball SheetJS, invisible à `npm audit` ; l'`import("xlsx")` dynamique de `importWizardFileScan.ts:49`
  échappe à la garde `xlsx-client-import`, qui ne suit que les imports statiques.
- **24 · Erreurs HTTP** : `src/lib/http/errors.ts` porte désormais la politique ; restent 5
  `mapSupabaseError`, 6 classes `*ApiError` et 53 routes hors estimates qui importent `estimates/errors`.
- **25 · Écritures navigateur** : `sites/page.tsx:170-225`, `profile/page.tsx:90`,
  `DeliverySiteCreateModal.tsx:110`, `SupplierCreateModal.tsx:124`, `ProductCsvImport.tsx:93`,
  `PurchaseOrderStatusUpdater.tsx:55`. La RLS protège (`Admins can insert suppliers`,
  `supabase/migrations/013_multitenant_core_s5.sql:1112`), mais sans Zod et avec le message Postgres brut.
- **26 · Piles E2E** : 34 `.ps1` hors CI, 27 specs Playwright + 7 configurations ad hoc, TesterArmy.
  Undo/redo, multisélection, presse-papiers, ouvrages et import de prix guidé ne sont couverts qu'en
  PowerShell : les porter vers TesterArmy avant tout retrait.
- **27 · DTO / OpenAPI** : 104 types écrits à la main dans `estimates/client.ts`, 207 `z.object` inline
  dans `openapi/registry.ts`.
- **28 · Éditeur** : `useEstimateEditorState.impl.tsx` 2 950 lignes ; `EstimateEditorTable.tsx`
  2 745 lignes, seul gros fichier qui a grossi depuis août (2 517), dans la zone gelée `ui-legacy`
  (`eslint.config.mjs`). Ne pas attaquer de front.

## 7. Dette produit — décisions métier, hors plan

Non scorées : elles exigent une décision avant tout code. Détail dans
[`metier/ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) et
[`metier/cycle-de-vie.md`](metier/cycle-de-vie.md).

- Sous-détail d'ouvrage (`cost_type`, `loss_coeff_bp`, `yield_value`) perdu à la matérialisation
  (`supabase/migrations/20260722132425_nested_estimate_assemblies.sql:561-591`).
- Pas de cycle de vie d'affaire (gagné/perdu, date de remise, motif) : `estimate_projects.is_archived`
  seulement.
- Trois devises acceptées (`src/lib/money.ts:1`), aucune conversion (`src/lib/currency-rates.ts`).
- TVA arrondie par `Math.round` (`src/lib/money.ts:109`) quand le reste du pied utilise
  `bankersRound` : changer l'arrondi change des montants contractuels, donc une nouvelle
  `calc_engine_version`.
- Aucun chemin de retrait du moteur v1 (18 branches de version dans 7 fichiers).

## 8. Payé depuis le 2026-08-19 — ne pas ré-auditer

`supabase/schema.sql` désarmé (12 lignes de commentaire) · documentation 287 → 43 fichiers, index
`docs/README.md` · `.env.example` complet (43 variables) · snapshots golden éclatés en 5 fichiers ·
tests des cinq modules critiques (`estimate-seal`, `pdf-publication`, `takeoff/evidence`,
`provider-batch`, `estimate-structure-draft`) · budgets de performance par page · contrôleurs feuilles
extraits et accesseur renommé `useEstimateEditorContext` · schémas takeoff extraits · `toErrorResponse`
délègue à `src/lib/http/errors.ts` · pages fournisseurs, produits et commandes derrière l'API ·
`estimates/server.ts` 8 815 → 6 605 lignes non vides, `AffaireHub.tsx` 2 128 → 1 300 · RLS active sur
toutes les tables créées en 2026, toutes les fonctions SECURITY DEFINER fixent `search_path` · bloc
d'identifiants retiré du README.

## 9. Plan de remédiation

Chaque phase tient dans ~20 % de la capacité d'une personne ; un lot = un commit dédié, validé à hauteur
de son risque.

| Phase | Quand | Postes | Sortie |
|---|---|---|---|
| **P0 — armer les filets** | cette semaine · ≈ 2 j + ½ j admin | 👤 1, 2, 3, 6 · dépôt 1, 4, 5, 7 | une sauvegarde restaurée, outbox drainée, erreurs visibles, `main` vert et non contournable |
| **P1 — coudre** | sprint suivant · ≈ 5 j | 8, 9, 10, 11, 12, 13, 15, 18, 22 | frontière tenant prouvée en E2E, types générés, registre de sécurité exact |
| **P2 — réduire le point chaud** | mois suivant · ≈ 10 j | 14, 16, 17, 19, 20, 23 | `estimates/server.ts` −1 500 lignes, DPGF avec une vraie unité |
| **P3 — qui touche extrait** | trimestre | 24 → 28 | aucune hausse de budget sans commit dédié ; nouvelle RPC = pgTAP + type généré |

**Actions d'administration (👤), hors dépôt** :

| Où | Quoi |
|---|---|
| GitHub → secrets du dépôt | `SUPABASE_DB_URL`, `BACKUP_ALERT_WEBHOOK`, `CRON_SECRET`, `HEX_APP_URL` (ou variable `APP_URL`) |
| GitHub → ruleset `main` | PR obligatoire ; checks requis : Quality Gate, E2E RLS Matrix ; pas de force-push |
| Vercel → variables | `ERROR_REPORTING_DSN` |
| Supabase → projet | vérifier sauvegardes quotidiennes / PITR ; restaurer un dump dans une base jetable |

## 10. Méthode et limites

Analyse statique à `d9b44271` et lecture des runs CI par `gh run list` / `gh run view --log-failed`.
Trois relevés parallèles (code et architecture ; tests, infrastructure et dépendances ; domaine, sécurité
et documentation), puis revérification directe de chaque constat à fort impact : comptes de runs,
`handleAssociateArticle`, policies RLS des fournisseurs, copies des helpers d'accès, tailles de fichiers,
références documentaires. Le churn couvre 2026-07-01 → 2026-10-09.

Bornes : l'environnement Vercel, le plan Supabase et la configuration d'environnements GitHub ne sont pas
lisibles depuis le dépôt ; la nature des 16 échecs pgTAP de gouvernance n'est pas établie ; les listes de
code mort reposent sur l'absence d'importeur ; aucune suite n'a été exécutée localement pour cet audit.

## 11. Suivi d'exécution (2026-10-10)

Base : `main @ aeae8a0a`, plus un arbre de travail non commité (dernière colonne). Le P0 « dépôt » a été
traité dans la journée, en partie par les commits `484a099d` → `aeae8a0a`, en partie dans cette
session. Le P0 « administration » reste entièrement ouvert.

| Poste | État | Preuve |
|---|---|---|
| 1 · CI | **Réglé côté dépôt, ouvert côté règles.** Quality Gate vert sur `aeae8a0a`. Audit à 0 advisory : vitest 4.1.11, `@modelcontextprotocol/sdk` forcé en 1.32.1 sous `e2e` 0.15.2 (`overrides`), `fast-glob` de `@next/eslint-plugin-next` remplacé par `tools/next-eslint-root-glob`, ce qui élimine la chaîne `braces` (`c74696f4`). Contrôleur de synchronisation sous son plafond (types déplacés, `c74696f4`). Reste : le ruleset `main-protection` n'impose toujours que l'interdiction de suppression 👤 | `gh run list --commit aeae8a0a` ; `npm audit` : 0 |
| 7 · pgTAP | **Réglé.** Matrice RLS verte depuis `61e63d4a`. Tests de duplication reciblés sur `duplicate_estimate_version_without_product_id` et fixture transactionnelle corrigée (`7e3c753c`). Les quatre anciennes RPC de création ne sont plus exécutables par `service_role` : `20261010010645_revoke_service_role_on_legacy_estimate_creators.sql` (`8b07ea0c`), **appliquée en production** sous la version distante `20261010011819`. `20261010010748_restore_service_role_catalogue_history_privileges.sql` n'est **pas** appliquée à distance | [`testing/legacy-estimate-creators-regression.md`](testing/legacy-estimate-creators-regression.md). Diagnostic initial mené sans Docker : runtime natif Supabase (CLI 2.120.0) dans Ubuntu-24.04 sous WSL2, sur une copie de `supabase/` |
| 12 · Playwright | **Critique vert pour la première fois** sur `aeae8a0a` (connexion CI réparée, rapports expurgés des identifiants). Nightly jamais vert | [`testing/ci-recovery-2026-10-10.md`](testing/ci-recovery-2026-10-10.md) |
| 2 · sauvegardes | **Ouvert et aggravé.** Le projet est en plan Free : ni sauvegarde plateforme ni PITR. Le workflow GitHub est donc la seule sauvegarde possible, et il n'a jamais réussi (`SUPABASE_DB_URL` absent) 👤 | `gh run list --workflow supabase-backup.yml --status success` → vide |
| 3 · reprise durable | **Ouvert.** 0 succès ; `CRON_SECRET`, `HEX_APP_URL` absents 👤 | `gh secret list` |
| 5 · gardes | **Fait, non commité.** Trois règles `no-restricted-syntax` dans `eslint.config.mjs` (`auth.getUser(` interdit sous `src/app/api/**` ; identifiants non ASCII en premier argument de `.from/.select/.eq/.order/.rpc…` ; client service-role interdit dans un module `"use client"`). `import "server-only"` dans `src/lib/supabase/service-role.ts` (paquet `server-only`, alias Vitest vers `empty.js`). `sharedSecretMatches` (`src/lib/http/shared-secret.ts`) pour le secret worker takeoff et `CRON_SECRET` | Chaque règle déclenchée par une sonde `eslint --stdin` ; une valeur accentuée en second argument de `.eq` n'est pas signalée |
| 4 · unité | **Non corrigé.** Le scénario E2E (dernier test de `e2e/army/critical/estimate-integrity.e2e.ts`, non commité) échoue avant l'assertion d'unité : sous TesterArmy, « Associer ou remplacer l'article » ne laisse pas le panneau ouvert depuis le menu de ligne ; `disablePointerDismissal` n'y change rien. Correctif d'unité en attente d'une vérification manuelle du panneau | Runs `.e2e/army/critical/runs/2026-10-09T23-07-59-657Z`, `…23-11-03-889Z`, `…23-33-35-766Z` ; brouillons ARMY `c96234a9-…`, `5737e582-…`, `ef9a3f24-…` conservés |
| Nouveau · glob Windows | **Corrigé, non commité.** `src/test/next-eslint-glob.test.ts` attendait des séparateurs natifs ; Next normalise `rootDir` en `/` avant le glob, comme `fast-glob` l'exigeait, donc 6 assertions échouaient sous Windows. Les attentes passent par `slashed()`, sans effet sous Linux | 9/9 sous Windows |

Écart à la décision du jour : la montée vers `e2e` 0.19.0 / `@e2e-dev/web` 0.14.0 faite dans cette session
a été abandonnée au profit de l'`override` du SDK MCP retenu dans `c74696f4`.

Validation de l'arbre fusionné (`aeae8a0a` + travail non commité) : `npm run lint`, `npm run typecheck`,
`npm run check:architecture` (1 016 modules, 0 cycle), `npm test` (432 fichiers verts, 1 ignoré : matrice RLS
hors `db:ci:local`), `npm run build` avec budgets de performance tenus — l'éditeur de devis reste à
495 573 / 500 000 octets gzip, soit moins de 1 % de marge.
