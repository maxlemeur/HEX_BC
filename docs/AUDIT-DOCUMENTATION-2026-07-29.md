# Audit complet de la documentation — 2026-07-29

> Périmètre : les 287 fichiers `.md` versionnés (40 851 lignes) + artefacts non suivis.
> Méthode : 6 agents en parallèle, chaque affirmation documentaire confrontée au code réel
> (`src/`, `supabase/migrations/`, `git log`). Aucun fichier n'a été modifié ni supprimé.

---

## 0. Synthèse en dix lignes

La documentation décrit **un autre logiciel que celui qui est en production**. Le `README.md` et le
`CLAUDE.md` présentent un « générateur de commandes » à 4 tables (`customers`, `products`, `orders`,
`order_items`) — trois de ces quatre tables n'existent plus, et le produit réel est un logiciel de
chiffrage BTP de ~99 tables, 122 route handlers et 187 migrations.

Sur 287 documents, **6 sont fiables**. Le reste est soit un instantané de mars 2026 jamais relu, soit
un artefact de coordination d'agent périmé par nature. **22 documents affichent un statut faux**, et
tous dans le même sens : « À faire » sur du travail livré depuis des mois. C'est le mode de défaillance
le plus coûteux — il fait re-développer l'existant.

Enfin, l'audit a mis au jour **quatre défauts métier que la documentation ne mentionne nulle part**,
dont l'absence de champ « unité » sur les lignes de devis et une divergence `margin_bp` /
`margin_multiplier` qui fausse toutes les approbations.

---

## 1. Ce qui doit être traité aujourd'hui, avant toute réorganisation

### 1.1 🔴 Identifiant de test en clair dans un dépôt public

[README.md:38-41](../README.md) contient :

```
## Test user (E2E)
Email: e2e.hex@example.com
Password: E2eTest-2026!
```

- Le dépôt `maxlemeur/HEX_BC` est **PUBLIC** sur GitHub (`"visibility": "PUBLIC"`).
- Introduit par le commit `6414ac6d` du **2026-02-02** → **près de 6 mois d'exposition**.
- [docs/test-logins.md:3](test-logins.md) énonce pourtant la règle inverse : « Les identifiants de test
  partages ne doivent pas etre commits ». Le fichier prévu pour ça est propre ; la fuite est ailleurs.

**Actions, dans l'ordre :** (1) faire tourner le mot de passe côté Supabase — action utilisateur ;
(2) retirer le bloc du README ; (3) purger l'historique (`git filter-repo` / BFG) ou passer le dépôt
en privé, le retrait seul ne suffisant pas.

### 1.2 🔴 `CLAUDE.md` est faux et injecté d'office dans chaque session d'agent

Il porte la mention « ces instructions OVERRIDE any default behavior » et décrit :

| Affirmation de `CLAUDE.md` | Réalité vérifiée |
|---|---|
| « Four tables : `customers`, `products`, `orders`, `order_items` » | 3 des 4 sont droppées sans recréation ([schema.sql:20-22](../supabase/schema.sql)) ; ~99 tables réelles |
| « Order status enum : `draft, sent, accepted, **canceled**` » | Aucun `order_status`. Les enums réels sont `purchase_order_status` et `estimate_status` (`draft/sent/accepted/**archived**`) — `canceled` n'a jamais existé |
| « `dashboard/layout.tsx` checks auth via `createSupabaseServerClient()` » | Le fichier ne contient ni l'un ni l'autre : il appelle `getUserContext()` ([src/lib/auth/server.ts](../src/lib/auth/server.ts)), et `middleware.ts` n'est pas mentionné |
| « `dashboard/` → `customers/`, `products/`, `orders/` » | 25 segments réels : `affaires`, `estimates`, `takeoff`, `approvals`, `direction`… `customers/` n'existe pas |
| 3 commandes (`dev`, `build`, `lint`) | 27 scripts npm, dont `test`, `typecheck`, `validate-openapi` — et `build` exécute d'abord `validate-openapi` |

Chaque session d'agent démarre donc sur un modèle mental erroné. Aggravant : `AGENTS.md` prend soin de
discréditer le `README.md`, mais **ne dit rien de `CLAUDE.md`**, pourtant bien plus faux.

### 1.3 🟠 `supabase/README.md` prescrit une procédure destructive

Il demande d'exécuter `supabase/schema.sql` dans le SQL Editor. Or ce fichier s'ouvre sur ~40
`drop table if exists … cascade` visant `estimate_items`, `estimate_versions`, `tenants`,
`purchase_orders`, `audit_logs`… **Appliqué sur un projet peuplé, il détruit la base**, sans le moindre
avertissement. La procédure contredit `AGENTS.md` et `context.md`, pour lesquels les migrations font foi.

### 1.4 🟠 Artefacts non ignorés par git

`design-qa.md`, `option-3-*.png` et `.codex-security-work/` ne sont couverts par **aucune** règle
`.gitignore` (qui ne contient que `docs/test-logins.local.md` et `docs/*.local.md`), alors qu'`AGENTS.md`
interdit explicitement de committer le premier. Risque de commit accidentel permanent.

---

## 2. Mesures objectives de l'état documentaire

| Indicateur | Valeur |
|---|---|
| Fichiers `.md` versionnés | **287** (40 851 lignes) |
| Dont `docs/user_story/` | 247 (86 %) |
| Docs figés en février–mars 2026 | ~230, alors que le code court jusqu'au 2026-07-27 |
| **Liens internes cassés** | **197**, concentrés sur 10 fichiers |
| Chemins de code cités dans la doc | 502, dont **95 n'existent plus (19 %)** |
| Docs portant un champ « Statut » | 26 sur 287 (9 %) — et **22 sont faux** |
| Docs référencés depuis le code | 5 |

**Écarts de volumétrie annoncés vs réels** (README de `docs/user_story/` et `EST-E01`) :

| Mesure | Doc annonce | Réel |
|---|---|---|
| Migrations Supabase | 21 | **187** |
| Route handlers API | 12 | **122** (166 handlers HTTP) |
| `src/lib/estimates/server.ts` | ~1 600 lignes | **10 305** |

### 2.1 Pollution par chemins d'une autre machine

`docs/to-refacto/PLAN.md` (16 liens), `docs/PROMISE_VNEXT_IMPLEMENTATION_PLAN.md` (34 liens),
`e2e/README.md`, et 4 fichiers de `v3/`/`v4/` pointent vers
`/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/…`. Tous morts par construction.

### 2.2 Corruption par search-replace non relu

Le commit `65da8470` (2026-07-15) a appliqué un remplacement global `assemblage(s) → ouvrage(s)` sur
toute la doc, sans relecture. Séquelles toujours présentes :

- `docs/to-refacto/REF-007-affaire-hub.md:26` — « Le hub garde **l'ouvrage de page**. »
- `docs/to-refacto/REF-015-takeoff-review-page.md:27` — « La page reste le point **d'ouvrage**. »
- `docs/user_story/EST-E10-reuse-templates.md:115` — « Macro-ouvrages (**ouvrages d'ouvrages** composes) »

C'est la **seule modification** qu'ont subie `v1/`, `v2/`, `v3/` et `to-refacto/` depuis mars : un
renommage automatique, jamais une mise à jour de contenu.

### 2.3 Cinq noms pour un seul produit

`projet_bc` (package.json) · « Générateur de commandes » (README) · `HEX_BC` (dépôt GitHub) ·
« TIMAX » (docs vNext) · `miaouffrage` (dossier local). Aucun document ne fait le lien.

---

## 3. Le mensonge de statut, mode de défaillance dominant

**22 documents sur les 26 qui déclarent un statut sont faux**, tous dans le sens « À faire » alors que
le travail est en production. Un seul épic déclare son état correctement : `EST-E22`.

### 3.1 Épics `EST-E*` — livrés mais affichés « À faire »

| Épic | Déclaré | Réel | Preuve |
|---|---|---|---|
| E02 DB Engine | À faire | **Livré 7/7** | `20260222200000_est025_*`, `024_rounding_invariants.sql`, `023_margin_tiers.sql` |
| E03 Security & Immutability | À faire | **Livré 4/4** | `025_est046_seal_and_events.sql`, `027_draft_locks.sql`, `computeEstimateSealHash` |
| E04 API | À faire | **Livré 3/3** | `src/lib/openapi/`, `export-stream.ts`, `/api/estimates/[versionId]/batch` |
| E06 Turbo Editor | À faire | **Livré** | EST-101→106 tous en git log, `clipboard.ts`, `useSpreadsheetNavigation.ts` |
| E07 Structure | À faire | **Livré 5/5** | `20260304203000_est125_multi_level_hierarchy.sql` |
| E08 Qualité & gating | À faire | **Livré 5/5** | `rules-engine.ts`, routes `/gating`, `/outliers` |
| E09 Suggestions | À faire | **Livré** | `20260222220000_est163_suggestion_learning.sql` |
| E10 Templates & ouvrages | À faire | **Livré 4/4** | `20260222033000_est182_estimate_assemblies.sql` |
| E12 Versioning | À faire | **Livré 4/4** | `diff.ts`, `EstimateDiffView.tsx`, `est223_variants.sql` |
| E21 Intake IA & Brief | Proposé | **Livré 4/4** | `est371`→`est374` + est449→452 |
| E23 Preuve & Risk Radar | Proposé | **Livré 4/4** | `est391`→`est394` |

### 3.2 Vagues produit — 5 dossiers sur 6 mentent

Chronologie réelle reconstituée : **v1 → v2 → v3 → v4 → IAv2 → vNext** (IAv2 est *antérieure* à vNext,
contrairement à ce que l'ordre alphabétique suggère). Puis un trou de 3 mois, puis la reprise de juillet.

| Vague | Implémentation réelle | Statuts déclarés |
|---|---|---|
| **v1** Takeoff | LIVRÉE (B/C partiels, assumés) | ✅ **exacts et datés** — seule doc de vague fiable |
| **v2** UX TIMAX | LIVRÉE (25/27 stories) | ❌ les 6 épics disent « À faire » |
| **v3** Métrés + Direction | PARTIELLE (21/26 ; **E07 portail client jamais démarré**) | ❌ 6/7 faux |
| **v4** IA/preuve/client | PARTIELLE (M7 livrée ; **M8 = EST-401→414 abandonnée**) | ❌ |
| **IAv2** | PARTIELLE (**E04 niveau C jamais démarrée**) | — aucun |
| **vNext** | LIVRÉE (57 commits en 2 jours) | ❌ les 6 épics disent « À faire » |

**La vague réellement active (juillet, 138 commits) n'a aucun dossier** : elle vit en vrac à la racine
de `docs/user_story/` (`EST-E15`, `EST-E26`, `EST-E27`, `AUDIT-2026-07`).

### 3.3 `docs/to-refacto/` — plan exécuté à 81 %, documentation à 0 %

Les 16 refactos ont été exécutés le 2026-03-11. **Aucune fiche `REF-*.md` n'a été mise à jour : les 16
affichent encore « Statut: A faire ».** Vérification par comptage de lignes :

| Ticket | Cible | Doc annonce | Aujourd'hui | Verdict |
|---|---|---:|---:|---|
| REF-001 | `EstimateEditorRow.tsx` | 2371 | **679** | ✅ fait |
| REF-003 | `PricesManager.tsx` | 1031 | **437** | ✅ fait |
| REF-005 | `EstimateApprovalActions.tsx` | 1514 | **110** | ✅ fait |
| REF-013 | `PriceBookCsvImport.tsx` | 1010 | **74** | ✅ fait |
| REF-002 | `EstimateEditorTable.tsx` | 2900 | **2468** | ⚠️ partiel (DoD −40 % non tenue : −15 %) |
| **REF-007** | `AffaireHub.tsx` | 1770 | **2128** | ❌ **non fait — le fichier a grossi de +20 %** |
| **REF-015** | `TakeoffReviewPage.tsx` | 1528 | **1600** | ❌ non fait |

Bilan : 13 faits, 1 partiel, 2 non faits. **Le plan n'est pas périmé — il est simplement non tenu à
jour.** Seules 3 fiches sur 16 ont encore une valeur.

---

## 4. Doublons et collisions de nommage

| Type | Détail |
|---|---|
| **Doublon quasi-parfait** | `context.md` (715 l.) + `context-full.md` (1 156 l.) = 1 871 lignes pour un contenu unique, même commit, aucune indication de priorité |
| **Doublon fonctionnel** | `docs/PROMISE_VNEXT_IMPLEMENTATION_PLAN.md` (565 l., anglais) et `docs/PROMESSE-PRODUIT-VNEXT-ANALYSE-PLAN.md` (728 l., français) : même objet déclaré, même commit d'origine, rien ne signale qu'ils traitent du même sujet |
| **Doublon divergent** ⚠️ | `docs/v4/V3-UPDATE-TAKEOFF.md` (354 l.) vs `docs/user_story/v3/V3-UPDATE-TAKEOFF.md` (338 l.) : 260 premières lignes identiques, puis divergence sur V3-012/013/014 (priorité **P2 vs P1**) et une section « Règles transverses » présente dans une seule. Même commit, aucun marqueur d'autorité |
| **Triplon binaire** | `docs/v4/btp_vnext_docs.zip` contient 11 `.md` dont **7 strictement identiques** à des fichiers déjà versionnés |
| **Doublon englobant** | `ANALYSE-COMPLETE-CHIFFRAGE-BTP.md` (3 522 l.) recopie le README (avec M0→M6 et 20 épics, contre M0→M8 et 25) et inline 86 fiches de tickets là où `tickets/README.md` en indexe 115. Seule sa PARTIE 1 (analyse concurrentielle) a une valeur propre. **152 des 197 liens cassés du dépôt sont dans ce seul fichier** |
| **Doublon englobant** | `V3-METRES-COMPLET.md` (1 721 l.) recopie `docs/user_story/v3/` (toujours présent), avec 4 liens internes morts |
| **Collision de nommage** | 6 fichiers `IMPLEMENTATION_PLAN.md`. Le piège : celui de `v4/` s'intitule « **VNext** » alors que le dossier `vNext/` contient un plan « vNext » totalement différent |
| **Collision de nommage** | `SEQUENCING-3-TEAMS.md` (tirets) et `IAv2/SEQUENCING_3_TEAMS.md` (underscores) désignent deux plans sans rapport |
| **Collision de numéros** ⚠️ | `bug/EST-433/434/435` et `tickets/EST-433/434/435` sont **six tickets différents** portant trois numéros. Ce ne sont pas des copies : rien à dédupliquer, un registre à réparer |

---

## 5. Le dossier `tickets/` — 71 % d'archive

- **119 tickets** `EST-NNN.md` + 3 dans `tickets/bug/` + 3 dans `bug/` + 3 READMEs = 130 fichiers.
- **~85 sur 119 (71 %) sont livrés et mergés.**
- **24 tickets déclarés « À faire » sont en réalité livrés** — dont la totalité des blocs
  `EST-371→374` (cockpit/intake IA) et `EST-421→429` (IAv2), chacun avec son commit `feat` dédié.
- **8 tickets livrés n'ont aucun fichier** : `EST-118, 436, 440, 446, 449, 450, 451, 452`. Preuves :
  `src/lib/est449-…test.ts` → `est452-affaire-register-events-follow-up.test.ts`, commits
  `774ffa25 feat(EST-446)`, `6b907289 fix(EST-451)`.
- Dernier commit du dossier : **2026-03-10/14**. Sept tickets ont été livrés depuis sans jamais y entrer :
  **le processus est mort, pas ralenti** — le dossier n'enregistre plus que son propre abandon.

**Les 35 tickets encore ouverts** — c'est la seule partie qui décrit l'avenir :

- **Bloc métier BTP (le plus précieux)** : `EST-301, 302, 311, 312, 321, 322, 331, 332, 333, 334, 341,
  342, 343, 351, 352, 353, 354, 361, 362, 363, 364`
- **Collaboration / boucle client** : `EST-401, 402, 403, 404, 411, 412, 413, 414`
- **Divers** : `EST-244, 245, 263, 265, 431, 432, 434`
- **Bugs encore en production** (à traiter en priorité, indépendamment du reste) : `bug/EST-433, 434,
  435` — perte de « Expliquer ce prix » après duplication de version, incohérence delta global/ligne.

---

## 6. Règles métier — le cœur du sujet

### 6.1 Ce que le moteur fait réellement

**Formule de ligne** ([src/lib/estimate-calculations.ts:185-248](../src/lib/estimate-calculations.ts)) :

```
coûtMO        = h_mo_majoration × h_mo × taux_horaire_rôle × k_mo      (split OFF)
costLineCents = Math.round(quantity × unit_price_ht_cents × k_fo + coûtMO)
saleLineCents = Math.round(costLineCents × marginMultiplier)
puHtCents     = bankersRound(saleLineCents / quantity)
```

**Ordre canonique du pied (moteur v2, `computeEstimateBreakdown`)** :
coût ligne → Σ → résolution du palier de marge → vente brute → Σ → **× coefficient global**
(`bankersRound`, arrondi unique) → remise sur base post-coefficient → **allocation descendante
`allocateProRata`** → TVA par ligne → arrondi TTC.

`allocateProRata` garantit `Σ parts === montant` **au centime** (méthode du plus grand reste, départage
déterministe). Testé sur 10 000 tirages, plus un test *property-based* sur 300 devis.

**Points forts objectifs** : garde-fou d'overflow int32 avec drapeau `isCapped` ; scellement SHA-256 sur
`draft → sent` avec payload canonique trié ; triple couche d'immutabilité (trigger DB, garde applicatif,
verrou pessimiste TTL 30 min) ; **autoliquidation TVA sous-traitance traitée avec un soin exemplaire**,
jusqu'au piège du sceau (`contractor_role` n'entre dans le payload que s'il diffère de `'principal'`,
pour ne pas invalider les sceaux du parc existant).

### 6.2 Le modèle n'est pas celui du métier

Le BTP français attend une chaîne **DS → FC → FG → coût de revient → B&A → PV**. Le code applique un
**multiplicateur unique** (`margin_multiplier`). Recherche exhaustive : **zéro occurrence** de
`frais_generaux`, `frais_chantier`, `aleas`, `coefficient_vente`, `coût de revient`.

C'est une **dette assumée et ticketée** (`EST-E15`), pas un angle mort. Mais la doc se contredit sur la
cible : `EST-E15:42` prescrit des `coeff_*_bp` en basis points, `EST-E15-DECISIONS:178-180` prescrit des
`coeff_*` en `numeric`. À trancher avant d'écrire quoi que ce soit.

### 6.3 🔴 Quatre défauts que la documentation ne mentionne **nulle part**

Ce sont les découvertes les plus importantes de l'audit — absentes y compris de l'analyse
concurrentielle de 3 522 lignes censée lister les manques.

**(a) Il n'existe aucune colonne `unit` sur `estimate_items`.**
Vérifié : la table porte `quantity`, `unit_price_ht_cents`, `k_fo`, `h_mo`… mais **pas d'unité de
mesure**. `products`, `estimate_assembly_items` et `supplier_pricebook` en ont une ; la ligne de devis,
non. Conséquence directe — l'export DPGF remplit la colonne « Unite » avec la **description** :

```ts
// src/lib/estimates/dpgf-export.ts:340
unite: item.description?.trim() ?? "",
```

Une désignation saisie librement corrompt donc l'unité exportée. **Il n'existe pas de DPGF conforme sans
unité** : c'est le défaut métier le plus grave du produit.

**(b) Le sous-détail de prix est détruit à l'insertion dans le devis.**
`estimate_assembly_items` porte `cost_type ∈ (material, labor, equipment, subcontract)`, `loss_coeff_bp`,
`yield_value` — soit exactement le sous-détail BTP attendu, **livré depuis mars 2026**. Mais la
matérialisation d'un ouvrage dans un devis
([20260722132425_nested_estimate_assemblies.sql:561-591](../supabase/migrations/20260722132425_nested_estimate_assemblies.sql))
l'aplatit en lignes ordinaires : ces colonnes n'existent pas sur `estimate_items`, tout est perdu.
Le sous-détail n'est donc **jamais opposable au maître d'œuvre**. Aggravant : `EST-E16:11` et
`ANALYSE:33` affirment que cette fonctionnalité *n'existe pas* — on risque de la réimplémenter.

**(c) `margin_bp` et `margin_multiplier` divergent, et le moteur de règles lit la mauvaise valeur.**

```ts
// src/lib/estimates/rules-engine.ts:883-895
const marginBp = toFiniteNumber(version.margin_bp, NaN);
if (Number.isFinite(marginBp) && marginBp >= 0) return marginBp;  // ← toujours vrai
```

`margin_bp` est `not null default 0` ([schema.sql:368](../supabase/schema.sql)). `0` satisfait donc
toujours la condition : **le repli sur `margin_multiplier` est inatteignable**. Or `margin_bp` n'est
écrit qu'à la création via l'assistant, tandis que le panneau de réglages ne modifie que
`margin_multiplier`. **Conséquence : une règle `min_margin` voit une marge de 0 bp sur la quasi-totalité
du parc et se déclenche systématiquement** ; les tableaux de bord direction et la file d'approbation
affichent la même valeur fausse.

**(d) Arrondis hétérogènes, dont la TVA.**
Deux méthodes coexistent sans règle explicite : `bankersRound` (demi-au-pair) sur le PU, le coefficient
global, les paliers de remise cascade et l'allocation ; `Math.round` (demi-au-supérieur) sur le coût de
ligne, la vente de ligne, les remises de section et **la TVA** (`money.ts:109`). Le commentaire de
`bankersRound` invoque la DGFiP pour éviter le biais haussier — mais la TVA, seul montant réellement
opposable au fisc, y échappe. `EST-E26` le reconnaît : « 11 `Math.round` subsistent ».

### 6.4 État réel de la réconciliation des totaux (T6 / EST-E26)

⚠️ **La spec `EST-E26` est elle-même dépassée par le code** — et c'est le document le plus dangereux du
dépôt, puisque les trois autres docs T6 la désignent comme référence.

Elle affirme que « la colonne `calc_engine_version` n'est lue nulle part » et classe la phase E « à
faire ». **Vérifié au HEAD, c'est faux** : `resolveCalcEngineVersion(version)` est lu sur six surfaces —
`[versionId]/page.tsx:461`, `print/page.tsx:361`, `portal/[token]/page.tsx:288`,
`export-stream.ts:394`, `calc-context.ts:269`, `pdf-generator.tsx:1814`. Le gate de
`computeReadOnlyTotals` est également **livré** (signature `estimate-calculations.ts:1809-1822`,
branchement v2 à `:1847`).

Ce qui reste vrai :
- **Seul l'éditeur épingle encore la constante** `EDITOR_CALC_ENGINE_VERSION = 1`
  (`useEstimateVisibility.ts:189`, `useEstimateEditorState.impl.tsx:1127`) — dernier verrou avant bascule.
- `EXPORT_CALC_ENGINE_VERSION` est devenue une **constante morte** (zéro usage).
- Tant que l'éditeur est en v1, `invariants.matchesFooter` est structurellement `false` en production, et
  le **multi-taux de TVA par ligne reste inopérant** : le taux de version écrase le taux de ligne
  (`estimate-calculations.ts:1772`).

### 6.5 Contradictions métier entre documents

| Sujet | Contradiction |
|---|---|
| **TVA** | `EST-E20/EST-351` exige un récapitulatif TVA **par taux** + mention art. 279-0 bis. `EST-E27` (livré) impose un document **sans aucune ligne de TVA** + mention « Autoliquidation ». **Aucun des deux ne cite l'autre** → implémenter EST-351 tel quel casse la conformité E27 |
| **Structure de prix** | `EST-E15` est P0/M5 ; `EST-E15-DECISIONS` dit « ne pas lancer EST-E15 avant que la phase F de T6 ait branché la bascule ». L'épic et sa décision se contredisent sur l'ordonnancement |
| **Totaux** | `EST-E02` décrit `computeEstimateTotals` comme le chemin canonique ; `EST-E26` documente que **c'est précisément ce chemin qui divergeait** et introduit `computeEstimateBreakdown` comme fonction d'autorité. Un dev qui lit E02 modifiera la mauvaise fonction |
| **Statut de devis** | `CLAUDE.md:55` et `EST-E18:11` annoncent `canceled`. Le code dit `archived`. `canceled` n'a jamais existé |
| **Profondeur** | `ANALYSE:1832` dit défaut 3, `:1765` dit 2. Le code porte les deux : `DEFAULT = 3`, `LEGACY_EXISTING = 2` |

### 6.6 Lacunes vs standards du chiffrage BTP

**Absent du code, mais correctement identifié par la doc** (dette assumée) : décomposition DS/FC/FG/B&A ·
sous-détail opposable · carnet de métrés (n × L × l × h) · formules dans les quantités · **situations de
travaux** · **avenants** · **retenue de garantie 5 %** · **DGD** · révision de prix par indices BT ·
allotissement / récap TCE · sous-traitance par ligne · taux réduits 5,5/10 % et CERFA 1301-SD · compte
prorata.

**Absent du code ET de toute la documentation** (angles morts à porter en tête du futur document) :

1. L'**unité de mesure** n'est pas un champ (cf. 6.3a).
2. **Aucun cycle de vie d'affaire** : `estimate_projects` n'a qu'un booléen `is_archived`. Ni prospect /
   à chiffrer / remis / gagné / perdu, ni date de remise, ni motif de perte. **Un logiciel de chiffrage
   sans taux de transformation ne se pilote pas.**
3. Aucune **mémoire technique** ni pièce de candidature (DC1/DC2, attestations, assurances).
4. Aucune notion de **délai / planning / phasage** — les heures de MO existent, le calendrier non.
5. Aucun **acompte / échéancier** structuré (clause CGV textuelle seulement).
6. **Aucune conversion de devise** alors que 3 devises sont acceptées à la saisie : `currency-rates.ts`
   est un CRUD pur, sans fonction `convert`.
7. Aucun statut d'**option / variante / PSE**, pourtant standard en marché public.

---

## 7. Plan de remise à plat

### 7.1 Architecture cible

Principe : **une seule source de vérité par sujet, et rien qui décrive un état sans être régénérable ou
daté.**

```
README.md                    ← réécrit : ce qu'est le produit, démarrage, pointeurs. Sans secret.
AGENTS.md                    ← conservé : contrat agents (le seul doc fiable aujourd'hui)
CLAUDE.md                    ← réduit à un pointeur vers AGENTS.md + docs/architecture.md

docs/
  README.md                  ← index unique et court : quoi lire, dans quel ordre
  metier/
    regles-de-calcul.md      ← 🆕 PIÈCE MAÎTRESSE : formules, arrondis, TVA, marge, remises
    glossaire.md             ← 🆕 DS, DPGF, BPU, lot, ouvrage, situation, autoliquidation…
    cycle-de-vie.md          ← 🆕 statuts, transitions, immutabilité, scellement, approbations
    ecarts-standards-btp.md  ← 🆕 ce qui manque vs le métier (§6.6), assumé et daté
  architecture.md            ← 🆕 domaines, modules, API, schéma DB (généré si possible)
  operations/
    base-de-donnees.md       ← remplace supabase/README.md, procédure non destructive
    tests.md                 ← remplace e2e/README.md, matrice régénérée
    securite.md              ← registre de remédiation
  backlog/
    ouvert.md                ← les 35 tickets vivants + IAV2-E04 + REF-002/007/015
  archive/                   ← tout le reste, avec un README d'avertissement en entrée
```

### 7.2 Ce qui doit être supprimé

| Chemin | Motif |
|---|---|
| `docs/v4/` (2 `.md` + `btp_vnext_docs.zip`) | Doublon divergent + doublon fonctionnel + triplon binaire |
| `docs/user_story/V3-METRES-COMPLET.md` | 1 721 l. doublonnant `v3/`, toujours présent |
| `docs/PROMISE_VNEXT_IMPLEMENTATION_PLAN.md` | Doublon, périmé à J+1 de son commit, 34 liens morts |
| `context-full.md` | Doublon de `context.md` |
| `docs/user_story/PROMPT-UX-standards-chiffrage.md` | Prompt « à coller tel quel » commandant 4 tâches déjà faites |
| 24 artefacts `*-HANDOFF.md` / `*-FE-CONTRACT.md` / `TEAM-*-AGENT-PROMPT.md` / `*-QA-PLAN.md` | Éphémères par nature ; 5 d'entre eux spécifient un backend jamais écrit |
| `design-qa.md`, `option-3-*.png` | Non suivis, clos, interdits de commit par `AGENTS.md` → + `.gitignore` |

### 7.3 Ce qui doit être archivé (et non supprimé)

`docs/user_story/v2/`, `v3/`, `v4/`, `vNext/`, `IAv2/` (sauf `IAV2-E04`), les ~85 tickets livrés, les 18
épics `EST-E*` livrés, `MVP-ANALYSIS`, `PRD-ANALYSIS`, `SEQUENCING-3-TEAMS`, `MVP_game_changer_*`,
`backlog-chiffrage-comparatif`, `PRD_Metre_Assiste_Gemini3`, `context.md`, les 2 `prompt-*.md`.

Destination `docs/archive/2026-03/`, avec un README d'entrée : *instantané figé, statuts non fiables,
source de vérité = code + git*.

### 7.4 Ce qui doit être conservé tel quel

- [AGENTS.md](../AGENTS.md) — le seul document fiable du dépôt
- `docs/user_story/AUDIT-2026-07-inventaire.md` — ⚠️ **ne pas
  toucher à la main** : généré par [scripts/extract-audit-artifact.mjs](../scripts/extract-audit-artifact.mjs)
  depuis `AUDIT-2026-07-source.normalized.json`, avec un test vitest qui vérifie la régénération à
  l'octet près ([audit-artifact-generator.test.ts:22](../src/lib/audit-artifact-generator.test.ts))
- `docs/user_story/v1/` — seule vague dont les statuts sont exacts et datés
- `EST-E17`, `EST-E18`, `EST-E19`, `EST-E25` — « jamais commencé », et c'est **vrai**
- `EST-E22` — seul épic dont le statut déclaré est juste
- `docs/test-logins.md`, `docs/sofinther-automation.md`, `docs/security-remediation-91386191.md`

### 7.5 Séquence recommandée

1. **Sécurité** (aujourd'hui) : rotation du mot de passe E2E, retrait du bloc, décision sur l'historique.
2. **Stop the bleeding** : réécrire `CLAUDE.md` et `README.md`, corriger `supabase/README.md`, compléter
   `.gitignore`. Quatre fichiers, effet immédiat sur toute session d'agent.
3. **Archivage massif** : déplacer, ne pas supprimer d'abord. Le dépôt redevient lisible en un commit.
4. **Rédaction du socle métier** : `regles-de-calcul.md` + `glossaire.md` + `cycle-de-vie.md`, en
   décrivant **ce qui s'exécute (v1)** et en annexant v2 comme cible — sans quoi la doc décrirait un
   logiciel que personne n'utilise.
5. **Backlog** : sortir les 35 tickets ouverts vers un vrai tracker. Un fichier Markdown ne porte ni
   statut mouvant, ni assignataire, ni date — les 4 mois de dérive le démontrent.

### 7.6 Corrections de code identifiées en chemin (hors périmètre doc)

Ces points ne relèvent pas de la documentation mais ont été établis avec preuves pendant l'audit :

1. 🔴 `margin_bp` / `margin_multiplier` — approbations et tableaux direction faussés (§6.3c).
2. 🔴 Colonne `unit` absente de `estimate_items` ; export DPGF alimenté par `description` (§6.3a).
3. 🟠 Sous-détail détruit à la matérialisation d'un ouvrage (§6.3b).
4. 🟠 `EXPORT_CALC_ENGINE_VERSION` : constante morte à supprimer.
5. 🟠 REF-007 `AffaireHub.tsx` : 2 128 lignes, +20 % depuis le constat initial.
6. 🟡 Branche morte : `discountMode === "simple"` avec `discount_steps` non vide, état rendu impossible
   par la contrainte DB `schema.sql:7666`.
7. 🟡 Deux échelles de fraîcheur des prix concurrentes (seuil unique 90 j vs échelle 30/90).

---

## 8. Tableau de bord final

| Catégorie | Fichiers | Part |
|---|---:|---:|
| **À supprimer** | ~32 | 11 % |
| **À archiver** | ~200 | 70 % |
| **À réécrire** | ~8 | 3 % |
| **À mettre à jour** | ~12 | 4 % |
| **À conserver tel quel** | ~10 | 3 % |
| **À créer** | 8 | — |
| **Non classés** (tickets ouverts → tracker) | ~35 | 12 % |

**Cible : passer de 287 fichiers / 40 851 lignes à environ 20 documents vivants**, plus une archive
clairement identifiée comme telle.
