# Lot 2 — Conception retenue : moteur de calcul v3 (arbitrages de calcul de l'audit)

**Statut** : conception **validée par le porteur le 16/10/2026** : les points de décision P-01 à P-19 (§12) et les
14 arbitrages du rapport d'audit (§6 du rapport) sont retenus tels que proposés. **Rien n'est implémenté.** La
sécurité est hors périmètre pour l'instant (décision du porteur du 16/10/2026 : développement, données fictives).
Conception issue de la synthèse des trois propositions (« données d'abord », « v3 minimal », « recette d'abord »)
et des deux avis du jury.
**Révision de base** : `98408ef0` (`origin/main` au 16/10/2026, après le lot des développeurs
`d484c5a1..98408ef0`) ; dernière migration publiée : `20261015190000_scope_takeoff_recalculation_safeupdate.sql`.
**Date** : rédigée le 14/10/2026 en lecture seule de `main` au commit `28ccc857`, plus le lot 1 présent mais non
commité (dernière migration de l'arbre d'alors : `20261014172511_restrict_tenant_membership_writes.sql`, non
suivie) ; mise à jour le 16/10/2026, références recalées sur `98408ef0`.
**Lot 1** : le travail du lot 1 auquel renvoyait la première version (forçage d'envoi, adhésions, migration
`20261014172511`, ligne de base pgTAP à 14 suites) n'a pas été publié. Il est archivé sous forme de patch dans
`docs/audit-independant-2026-10-14/lot1/` et absent de l'arbre suivi (des restes non suivis peuvent subsister
dans la copie de travail : voir 2.0) ; le lot 2 n'en dépend plus (R9). Ce patch contient aussi la migration RLS
des adhésions (S-09), appelée « étape 0 du lot 2 » le 14/10 : elle est sans rapport avec le sous-lot 2.0 de
cette conception, qui n'a pas commencé. Ce « lot 1 » de l'audit est distinct du « Lot 1 » des développeurs
(`docs/testing/tech-debt-lot1.md`), qui désigne leur propre lot de dette technique.
**Base de conception** : « données d'abord » (gagnante du premier jury, bien notée par le second sur la sûreté
contractuelle). On y greffe les idées retenues par les jurys et on comble les huit manques critiques relevés.
**Vérification** : chaque fait marqué `fichier:ligne` a été relu dans l'arbre vivant le 14/10, puis recalé sur
`98408ef0` le 16/10 (§1). Les valeurs d'oracle des 7 lignes ont été recalculées
(`docs/audit-independant-2026-10-14/reproductions/lot2/dd-oracle-v3.cjs` sur `D4-extraits.json` : Σ 6 905 456 c,
rejoué le 16/10).

Sources : `AGENTS.md`, `CLAUDE.md` ; audit `docs/audit-independant-2026-10-14/` (rapport §6, `annexe-technique.md`
§3.2, `rapports-axes/D1-regles-calculs.md`, `D4-materiaux-metier.md`, `D3-ergonomie-continuite.md`,
`reproductions/d4/D4-extraits.json`, `reproductions/*.audit.test.ts`).

---

## 0. En une page

### 0.1 Principes

1. **Un moteur 3, réservé aux nouvelles versions.** Les moteurs 1 et 2 ne changent pas de montant. Aucune
   reprise de données. `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent à
   **zéro ligne de diff** (vérifié par `git diff --stat` à chaque sous-lot).
2. **Fermé par défaut, avant toute création.** Le premier sous-lot technique (2.1) admet la valeur 3 en base
   et ferme toutes les portes dans la même migration : gouvernance v2 héritée, écrivains non adaptés refusés,
   émission refusée, lecture en v1 impossible. À ce stade, aucune version 3 ne peut être créée par
   l'application.
3. **Les données disent ce qu'elles contiennent.** Les heures par unité ont leurs propres colonnes.
   `h_mo` reste un total d'heures de ligne, dérivé en v3. Les lignes stockées restent **nettes** :
   Σ lignes = HT. Les valeurs brutes publiées sont figées à part.
4. **Lecteur avant écrivain.** Le code qui sait lire (ou refuser proprement) une v3 est déployé avant que
   la base puisse en créer une. Le vrai verrou d'activation est une politique d'entreprise typée en base.
5. **Double calcul au moment contractuel.** Au gel et à la publication, PostgreSQL recalcule le devis v3
   complet et refuse tout écart d'un centime. Aux sauvegardes, il contrôle chaque ligne et les identités
   de totaux.
6. **Une seule règle d'arrondi en v3** : demi supérieur sur valeur décimale exacte (BigInt en TS, `numeric`
   en SQL), répartition entière exacte. TVA pure. L'arrondi commercial est une remise HT.
7. **Documents émis immuables.** Le marqueur de sceau 5 garde son sens. La v3 reçoit une charge de calcul 6
   et un contrat client 2. Les charges 1 à 4, le contrat 1 et leurs validateurs ne changent pas.

### 0.2 Décisions par arbitrage

| Arbitrage | Décision retenue | Sous-lot |
|---|---|---|
| A1 heures par unité | Colonnes `h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit`. En v3, `h_mo*` = arrondi(Q × h/u, 3), dérivé par déclencheur. Toute écriture de `h_mo` sans h/u sur une v3 est refusée. | 2.4, 2.5, 2.8 |
| A2 coefficients FO/MO | `sale_coefficient_fo` et `sale_coefficient_mo` par version. Défauts fixés par la politique d'entreprise (1,30 / 1,20). En v3, marge fixe à 1 et coefficient global à 1 (CHECK). Les paliers deviennent une simple indication. | 2.4, 2.5, 2.6 |
| A3 remise | Une seule intention, montant **ou** pourcentage (CHECK). Aucun taux dérivé. Montant appliqué et assiette exposés. Ligne « Remise commerciale » sur le document. | 2.4 à 2.7 |
| A4 arrondis | PU arrondi au centime, puis brut = arrondi(Q × PU). L'arrondi commercial est une remise HT (`commercial_rounding_cents`, mode « inférieur »). `rounding_adjustment_cents = 0` en v3. | 2.4, 2.5, 2.7 |
| A5 TVA | Taux obligatoire sur chaque ligne v3. Le taux de version devient le taux par défaut, avec une option « appliquer à toutes les lignes ». TVA calculée par taux sur la base HT nette. Récapitulatif par taux. | 2.4 à 2.7 |
| A6 unités | Référentiel `measurement_units` avec alias. Normaliseur unique alimenté par une source unique, en TS et en SQL. `estimate_items.unit_code` réservé à la v3. Statuts séparés. « ML » = mètre linéaire. Conversion d'achat portée par l'offre. | 2.2, 2.4, 2.5, 2.9 |
| A7 offre à 0 € | `supplier_pricebook.zero_price_kind ∈ {included, free}` et un prédicat unique en TS et en SQL, appliqué sur six chemins et pour tous les moteurs (règle d'entrée). | 2.2 |
| A8 saisie (Q07, C-11 ; hors numérotation du rapport) | Un parseur par grandeur, bâti sur la grammaire unique déjà livrée par `d484c5a1` (`parseDecimalInput`, `src/lib/numeric-input/parsers.ts`), qui refuse les formats ambigus. La convention de majoration actuelle de la grille (100 = neutre) devient l'unique convention. Le profil OPTIMA est déclaré, « Prix Unitaire » sert de colonne de contrôle et l'import se vérifie lui-même. | 2.3, 2.8 |

Correspondance avec le rapport (§6) : A1 à A7 reprennent les arbitrages 1 à 7. A8 n'est pas un arbitrage
numéroté du rapport : il couvre la saisie (registre Q07, constat C-11). L'arbitrage 8 du rapport (validité des
offres fournisseurs) et les arbitrages 9, 10 et 14 sont hors du lot 2 (§13) ; l'arbitrage 13 (hors V1) s'y
traduit par le refus du métré sur une v3 (P-19) ; les arbitrages 11 (positionnement) et 12 (périmètre V1)
cadrent le lot sans sous-lot dédié.

### 0.3 Ordre de livraison

**2.0** ligne de base et harnais → **2.1** socle fermé par défaut → (**2.2** offre à 0 € et **2.3** saisie,
en parallèle, indépendants du moteur) → **2.4** moteur pur et jumeau SQL → **2.5** persistance derrière
la politique → **2.6** éditeur → **2.7** document et émission → **2.8** chemins d'entrée v3 →
(**2.9** unité d'achat, retenu le 16/10/2026, non bloquant pour 2.10) → **2.10** pilote puis bascule.

Tant que la politique d'entreprise reste au moteur 2, aucun sous-lot de 2.1 à 2.9 ne change un montant v1/v2.
Tout chemin v3 non encore livré refuse avec une erreur nommée.

**Statut au 18/10/2026.** 2.10 est découpé en 2.10a (créateurs prêts pour le moteur 3) et 2.10b (pilote puis
bascule, M8). 2.10b fusionne **en dernier**, après 2.7, 2.6b, 2.7b, 2.8b et 2.10a ; sa M8 est réhorodatée à la
fusion. Décisions D-a à D-k, approbation de M8 par le porteur (18/10/2026) et pilote A :
`docs/testing/estimate-engine-v3-2.10.md`.

---

## 1. Faits vérifiés dans le code (ils corrigent les trois propositions)

| # | Fait | Référence | Conséquence |
|---|---|---|---|
| F1 | `seal_payload_version = 5` est déjà le **marqueur du sceau lié à l'offre** : CHECK 1..5, écrit à l'émission, exigé avec le contrat client 1. | `20261013130248_estimate_offer_client_contract.sql:35-36`, `:770`, `:814`, `:822`, `:856-857` ; `src/lib/estimates/server.ts:5666` | On garde le marqueur 5. La v3 reçoit une **charge de calcul 6** sous ce marqueur. Il n'y a pas de « payload 5 » pour la v3. |
| F2 | Le hash de calcul du sceau d'offre est construit avec `payloadVersion: 4` codé en dur. Les candidats historiques testent `=== 2`. | `src/lib/estimates/offer-document.ts:110`, `:114`, `:122` | `offer-document.ts` doit choisir la charge selon le moteur (4 ou 6) et le contrat (1 ou 2). |
| F3 | Le contrat client 1 refuse déjà `calcEngineVersion ∉ {1,2}` et toute clé hors liste, en SQL et en TS. La fonction `estimate_offer_client_items_match` ne contrôle montants et fraîcheur que si le moteur vaut 2. | `20261013130248…sql:184-191`, `:296`, `:384`, `:395` ; `src/lib/estimates/offer-contract.ts:384` | Une v3 n'est fermée à l'émission que **par accident**, au passage à `ready` (`guard_estimate_offer_document`, `:519`). M1 ajoute une fermeture explicite et nommée. Le contrat 2 est nécessaire. |
| F4 | `resolveCalcEngineVersion` ramène toute valeur inconnue à 1. Le test `:23` fige « 3 → 1 ». La colonne est `not null default 1`. | `src/lib/estimates/calc-engine-version.ts:28-37` ; `calc-engine-version.test.ts:23` ; `20260724090000_estimate_calc_engine_version.sql:22` | Un champ absent ne peut venir que d'une liste `select` incomplète. Les chemins contractuels doivent exiger la présence du champ, comme le fait déjà `offer-document.ts:69`. |
| F5 | Le déclencheur d'insertion refuse un moteur hors {1,2}. Il ne reconnaît que les contrats `canonical_v2`, `duplicate_source` et `legacy_v1`. Seules la création canonique et la duplication posent un contrat. | `20260812032857_govern_estimate_calc_engine_v2.sql:2392`, `:2405`, `:2418-2431` ; `20261014114943…sql:481-484`, `:839`, `:897`, `:1106` | Toutes les créations applicatives passent par `persist_estimate_creation_atomic`. C'est là que se décide le moteur. |
| F6 | Comparaisons SQL au moteur 2 dans les définitions vivantes. | `20260812032857…sql:346`, `:366`, `:382` (`target_engine_version = 2`), `:551`, `:578`, `:614`, `:642`, `:1037`, `:1943` (`current_calc_engine_version = 2`), `:2212`, `:2225`, `:2248`, `:2311` ; `20261014114943…sql:186`, `:216`, `:219`, `:232`, `:258`, `:263`, `:2308` ; `20261015190000…sql:147`, `:357`, `:438` (`coalesce(…, 1) = 2`, dans `recalculate_takeoff_estimate_version`, redéfinie par `a25b5c40`) ; `20261012020700…sql:226`, `:236` ; `20261012030743…sql:347`, `:350` ; `20261012215942…sql:338`, `:341` ; `20261013074536…sql:142` ; `20261013130248…sql:384`, `:395` ; `20261013162417…sql:111` ; `list_approval_queue` `20260812032857…sql:4211` | Voir §7 : chaque site est traité soit par héritage `in (2,3)`, soit par une branche v3, soit par un refus. |
| F7 | 49 comparaisons TS du moteur à un littéral hors du moteur historique (58 avec `estimate-calculations.ts`), dont une dizaine sur le **champ brut** `*.calc_engine_version`, invisibles au typage. | Liste exhaustive en annexe A (relevé du 14/10 ; totaux 49 et 58 inchangés à `98408ef0`), dont `send-estimate.ts:311`, `approval-v2-snapshot.ts:27`, `fixed-discount-evidence-server.ts:75`, `:95`, `effective-discount.ts:97`, `:109`, `direction/server.ts:942`, `offer-document.ts:122`, `useEstimateEditorSyncController.ts:733`, `useEstimateEditorState.impl.tsx:541`, `:1349` | Il faut une règle ESLint sur les champs bruts, et pas seulement sur les prédicats. |
| F8 | Assertions pgTAP qui deviennent rouges : `:656` affirme que le CHECK **refuse le moteur 3** ; `:852` et `:871` cherchent le texte `version.calc_engine_version = 2`. `:1086` cherche `version.calc_engine_version = 1` dans `list_approval_queue`, et ce texte doit être conservé. | `supabase/tests/database/estimate-calc-engine-governance.test.sql:656`, `:852`, `:871`, `:1086` | Réécriture délibérée en 2.1, avec des assertions de comportement. |
| F9 | La ligne de base pgTAP du 14/10 (**14 suites, 1 268 assertions, PASS**) incluait le lot 1, archivé depuis. À `98408ef0`, le dépôt compte **13 suites**, dont cinq modifiées par `a25b5c40` ; les développeurs y relèvent 1 253 assertions SQL (`docs/testing/tester-army-ci.md:219`, `:244` ; ces campagnes ne valent que pour SQL et RLS, leur résultat E2E agrégé est rouge). | `supabase/tests/database/` ; `npm run db:ci:local` (`src/test/local-supabase-ci.ts:715-727`, rapport `Files=…, Tests=…`) | La référence du 14/10 n'est plus valide : 2.0 remesure avec `npm run db:ci:local` sur un checkout propre de `98408ef0`, et cette mesure devient la référence de non-régression. |
| F10 | `feature_flags` est modifiable par tout administrateur d'entreprise (insertion, mise à jour, suppression). | `20260224120000_rls_select_policy_dedup.sql:52-72` | Le moteur ne se choisit pas par un drapeau générique : on crée une politique typée. |
| F11 | Budgets en lignes non vides : `estimate-calculations.ts` 1 762 / 1 900 ; `useEstimateEditorState.impl.tsx` 2 889 / 3 100 ; `estimates/server.ts` 6 401 / 7 100 ; `EstimateEditorTable.tsx` **2 560 / 2 600** ; `pdf-generator.tsx` 2 145 / 2 300 ; `schemas.ts` 1 639 / 1 800 ; `openapi/registry.ts` 5 141 / 5 300 ; `mappings/server.ts` 1 537 / 1 700 ; nouveau module ≤ 1 200. | `config/architecture-budgets.json` | Tout le code v3 va dans de nouveaux modules. La grille v3 vit dans un composant séparé, car il ne reste que 40 lignes de marge. |
| F12 | La sauvegarde réécrit `discount_bp = Math.round(remise / assiette × 10 000)` à côté du montant fixe et l'envoie. | `src/hooks/useEstimateEditorState.impl.tsx:1452-1460`, `:1483` | Sans effet sur le montant v2, car le montant fixe prime. La v3 ne dérive jamais un taux. |
| F13 | Le gel v2 reconstruit l'assiette de la remise fixe en supposant que la MO correspond à la durée de la ligne. | `20261014114943…sql:2584-2590` | Faux pour des heures par unité. La v3 a son propre gel ; la fonction v2 n'est pas touchée. |
| F14 | `guard_estimate_versions_readonly` compare la ligne entière après envoi. `guard_estimate_version_workflow_columns` incrémente `content_revision` sur une **liste explicite** de colonnes. | `20261013130248…sql:1045-1057` ; `20261014114943…sql:362-401` | Les nouvelles colonnes de version sont figées après envoi sans rien faire, mais elles **doivent** être ajoutées à la liste de révision. |
| F15 | Ouvrages de bibliothèque : quantité = `default_quantity × multiplicateur`, `h_mo = h_mo × multiplicateur`. | `20261013002038_assembly_library_component_provenance.sql:125`, `:133` | En v3 : h/u = `h_mo / default_quantity`, refusé si ce quotient n'est pas représentable. |
| F16 | Majoration : la grille utilise « 100 = neutre » (`shared.ts:254-263`). Le collage divise par 100 si l'en-tête porte `%` ou si la valeur dépasse 10, sinon il garde la valeur brute : « 10 » donne ×10 (`clipboard.ts:333-351`). L'import prend la valeur brute et, depuis `d484c5a1`, refuse la ligne si elle est illisible (`import-flow.ts:390-398`). L'export multiplie par 100 (`editor-export.ts:400-404`). | idem | Une seule convention, celle de la grille, pour ne pas surprendre les utilisateurs v2. |
| F17 | L'heuristique d'en-tête teste l'unité (`includes("unit")`) **avant** le prix : « Prix Unitaire », « PR Fourniture unitaire » et « Tps pose unitaire » deviennent l'unité. | `src/lib/mappings/server.ts:836-842` contre `:858-864` | À corriger dans 2.3, pour tous les moteurs. |
| F18 | Offre à 0 € : aucun contrôle de prix dans l'éligibilité. « ML » y est lu comme millilitre. Le meilleur prix trie sans exclure 0. Le popover écrit la désignation dans `description`, qui porte l'unité. | `src/lib/estimates/supplier-offer-eligibility.ts:4-10`, `:12-30` ; `server.ts:1054-1059` ; `useCatalogueSuggestions.ts:166-176` | Traité en 2.2. |
| F19 | L'analyse de marge d'affaire suppose `calcEngineVersion: 2` pour toutes les versions. | `src/lib/affaires/server.ts:2250-2269` | Une v3 y serait calculée en v2 : il faut un aiguillage par moteur. |
| F20 | La règle `min_margin` utilise `resolveEffectiveMarginBp(version) ?? 0`. Une marge indéterminée devient donc une violation. `list_approval_queue` rend `null` si le contexte n'a pas de multiplicateur. | `src/lib/estimates/rules-engine.ts:1173` ; `20260812032857…sql:4211-4230` | La v3 doit fournir une preuve de marque ou l'état « indisponible », jamais 0. |
| F21 | Le profil E2E d'émission n'autorise les conditions bac à sable que sur `127.0.0.1:45585`, la pile partagée des développeurs, interdite ici ; la politique serveur exige la même origine hors mode développement. La pile éphémère de `npm run e2e:army:local` (build de production, ports libres tirés au hasard) ne peut donc pas les activer ; seul `npm run dev:army` (`next dev`) les accepte, sans campagne E2E. La fiche « Associer ou remplacer l'article » s'ouvre sous TesterArmy 0.21.0 (scénario critique d'`estimate-integrity`) ; aucun parcours Army ne traverse le popover de suggestion de l'éditeur. | `e2e/army/local/offer-emission.config.ts:25` ; `src/lib/estimates/pdf-terms-server.ts:4`, `:21-34` ; `src/test/local-supabase-ci.ts:170-198`, `:220-237` ; `e2e/army/critical/estimate-integrity.e2e.ts:435-461` | Il faut un profil E2E d'émission dédié à la pile éphémère, à créer en 2.0 (§10.4). Le popover reçoit son E2E en 2.2 (`supplier-offer-zero-price.e2e.ts`), écrit rouge d'abord (§10.4). |

---

## 2. Invariants de non-régression et preuves

| # | Invariant | Preuve exécutable |
|---|---|---|
| I1 | Aucun montant v1/v2 ne change. | (a) `estimate-calculations.ts` et `estimate-v2-snapshot.ts` : `git diff --stat` vide. (b) **Corpus figé** de 300 devis v1 et 300 devis v2, généré en 2.0 sur l'arbre actuel, **avant toute modification**. Il contient les sorties de `computeEstimateBreakdown`, `buildEstimateV2SnapshotProjection` et `computeReadOnlyTotals`, qui doivent rester identiques octet pour octet à chaque sous-lot. (c) Les goldens `src/lib/estimate-calculations.golden/*` (dans leur état de `98408ef0` : `d484c5a1` a aligné `margin-tiers.test.ts` sur `isCapped: true`), la réconciliation et les tests de caractérisation de l'audit restent verts sans modification. |
| I2 | Les montants enregistrés ne bougent pas pendant la montée de version. | **Test de montée de version sur base peuplée** (§10.2). On applique les migrations jusqu'à la dernière publiée avant le lot 2 (`20261015190000` à `98408ef0`), on insère des v1/v2 envoyées et brouillons, on applique les migrations du lot 2, puis on compare `to_jsonb` des versions, lignes, documents, envois et sceaux. Ce test est indispensable, car `npm run db:ci:local` reconstruit la base depuis zéro (`supabase db reset`, `src/test/local-supabase-ci.ts:695`) et ne prouve rien sur des lignes existantes. Le dépôt n'a aucun équivalent : 2.0 le crée. |
| I3 | Les documents émis restent immuables et vérifiables. | Empreintes SHA-256 de `prepareEstimateDocumentData`, de l'export analysé et des hash de sceau (charges 1 à 4 et offre 5), sur un corpus v1/v2 de la pile locale, avant et après chaque sous-lot. Les suites pgTAP `estimate-email-outbox` et `portal-security-definer`, dans leur état de `98408ef0` (réécrites par `a25b5c40`), restent vertes sans modification. |
| I4 | Le moteur d'une version est immuable ; la duplication le conserve. | Code `ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE` inchangé (`20261014114943…sql:301-305`) ; pgTAP 2.1 et 2.5. |
| I5 | Toute projection TS d'une v3 est validée par le SQL. | Recalcul complet au gel et à la publication ; contrôles par ligne et identités aux sauvegardes (D12). |
| I6 | RLS sur toute nouvelle table ; aucun droit pour `anon`. | `security-invariants.test.sql` et assertions dédiées ; `npm run db:ci:local` (WSL, clone Linux). |
| I7 | Budgets d'architecture respectés. | `npm run check:architecture` ; code v3 dans de nouveaux modules. |
| I8 | Fins de ligne préservées (CRLF et LF mêlés : `src/types/database.ts` et `src/lib/money.ts` en CRLF). | `git diff --stat`, `git diff --check`, `git ls-files --eol` sur les fichiers touchés. |
| I9 | Le chemin DPGF reste `dpgf_rows_raw` → correspondances → `confirmUnifiedImportFlow`, avec `sourceDocumentId` et `_timax_provenance`. | E2E `dpgf-import` rejoué ; scénarios d'import de 2.3 et 2.8. |

---

## 3. Décisions (avec les alternatives écartées)

### D1 — Un moteur 3 distinct, deux types et un résolveur strict

- `CalcEngineVersion = 1 | 2` (`calc-engine-version.ts:12`) est **conservé** pour le moteur historique. Comme
  `estimate-calculations.ts` ne change pas, le compilateur refuse qu'on lui passe une v3.
- Nouveau type `EstimateEngineVersion = 1 | 2 | 3` et nouvelle fonction `requireEstimateEngineVersion(row)`,
  stricte. Elle exige `Object.hasOwn(row, "calc_engine_version")` et une valeur entière dans {1,2,3}. Sinon,
  elle lève `ESTIMATE_CALC_ENGINE_MISSING` ou `ESTIMATE_CALC_ENGINE_UNSUPPORTED`. Elle est employée sur
  **tous** les chemins contractuels : gel, sceau, publication, envoi, document, export, réglages, lots,
  création de ligne et règles.
- `resolveCalcEngineVersion` garde son comportement pour `null`, champ absent, 0, NaN et la troncature
  (tests `:6`, `:18`, `:26`, `:30` inchangés, le champ absent n'ayant pas de test dédié ; aucun effet v1/v2).
  Pour **3**, elle lève `EstimateEngineUnavailableError`, au lieu de renvoyer 1. Pour 4 et au-delà, elle lève
  `ESTIMATE_CALC_ENGINE_UNSUPPORTED`. Tout site non converti échoue donc fermé, au lieu de lire une v3 comme
  une v1. Le test `:23` est réécrit dans ce sens.
- Prédicats de capacité (`src/lib/estimates/engine/capabilities.ts`) : `engineFreezesSnapshot(v)` (2 ou 3),
  `usesPerUnitLabor`, `usesSaleCoefficients`, `usesPerRateTax`, `usesClientContractV2` (3). Façade
  `computeVersionBreakdown(input)` : moteurs 1 et 2 → `computeEstimateBreakdown`, sans changement ;
  moteur 3 → module v3.

*Écartés.*
- Colonne séparée `pricing_rules_version` avec moteur 2 : deux axes de contrat, et tout lecteur `=== 2`
  appliquerait les formules v2 à une ligne v3.
- Faire évoluer la v2 en place : interdit.
- Garder le repli tolérant : c'est le scénario de corruption silencieuse le plus probable (onglet resté sur
  un ancien bundle, retour arrière applicatif).

### D2 — Fermé par défaut, en échec fermé structurel (M1, sous-lot 2.1)

- Le CHECK passe à `calc_engine_version in (1,2,3)`. `enforce_estimate_calc_engine_on_insert` accepte 3,
  mais **aucun** contrat d'insertion ne produit 3 avant M4. Seule une fixture insérée par `postgres` peut
  créer une v3 en 2.1.
- Les garanties v2 sont héritées par la v3 grâce à `private.calc_engine_freezes_snapshot(smallint)` :
  colonnes figées, propriétaire des rôles, invalidation du gel, revue, fraîcheur à la publication.
- **Contrat d'écrivain v3.** Deux nouveaux déclencheurs, l'un sur `estimate_items`, l'autre sur
  `estimate_versions`. Ils refusent toute insertion, et toute mise à jour d'une colonne de calcul, sur une
  version de moteur 3, sauf si la transaction porte `miaouffrage.estimate_v3_writer = <id de version>`.
  Seuls les RPC v3 adaptés posent ce contrat (`set_config(…, true)`, valeur précédente restaurée en fin de
  fonction). C'est le même modèle de confiance que `miaouffrage.estimate_version_insert_contract` et
  `miaouffrage.estimate_settings_atomic` (`20261014114943…sql:830-841` et `:905-909` pour le premier, `:253-254`
  et `:283` pour le second, relu par `guard_estimate_version_workflow_columns` en `:384-393`). Erreur : `0A000
  ESTIMATE_V3_WRITER_NOT_SUPPORTED`. Restent libres : les colonnes neutres (`position`, `parent_id`,
  `title`, `aid`, `updated_at`), la remise à NULL des colonnes figées par l'invalidation existante, et les
  suppressions.
  - Effet : métré, ouvrages, modèles, brouillons IA, mise à jour groupée, version zéro et tout écrivain
    oublié échouent fermés **sans qu'il faille redéfinir** ces fonctions de 300 à 1 000 lignes.
- Émission fermée de façon explicite et nommée :
  - `require_fresh_v2_snapshot_for_publication` lève `ESTIMATE_V3_EMISSION_NOT_READY` pour une v3 ;
  - un déclencheur sur `estimate_documents` refuse tout document d'une v3 ;
  - `estimate_offer_client_items_match` renvoie `false` pour un moteur hors {1,2} (défense en profondeur).
- **Ordre de déploiement.** Le TS de 2.1 doit être en production avant qu'une politique d'entreprise passe
  à 3 (sous-lot 2.10). Une fois une v3 créée, aucun retour arrière applicatif en deçà de 2.1 : le code
  antérieur lirait la v3 comme une v1.

*Écarté.* Remplacer `= 2` par `>= 2` sans test de comportement, ou redéfinir chaque RPC pour y ajouter un
refus. Le premier ne prouve pas la protection ; le second fait copier de très gros corps de fonction
(risque R15).

### D3 — Activation par une politique d'entreprise typée

- Table `public.tenant_calc_policies`, décrite au §6.3. Une ligne absente vaut moteur 2 jusqu'à la bascule.
  La table contient le moteur des nouvelles versions, les coefficients de vente par défaut, les taux de TVA
  autorisés, le motif, l'auteur et la date. Un journal `tenant_calc_policy_events` l'accompagne.
- Écriture uniquement par `public.set_tenant_calc_policy` (`security definer`), **exécutable par
  `service_role` seulement pendant le lot 2** (activation par l'équipe, P-13). Motif obligatoire. Le passage
  à 3 est refusé sans coefficients par défaut.
- `persist_estimate_creation_atomic` lit la politique avec `FOR SHARE`. Le client transmet le moteur qu'il
  **attend** pour ses projections : tout écart lève `CONTEXT_CHANGED`. Un client sans attente est traité
  comme attendant 2 ; un ancien bundle échoue donc fermé chez une entreprise en v3.

*Écartés.*
- `feature_flags` : non typé, modifiable par tout administrateur (F10), sans précondition ni trace.
- Choix du moteur par le client : un onglet ancien ou un appel direct à l'API déciderait du contrat.

### D4 — A1 : des colonnes explicites pour les heures par unité

- `estimate_items` et `estimate_template_items` reçoivent `h_mo_per_unit`, `h_mo_atelier_per_unit` et
  `h_mo_chantier_per_unit`, en `numeric(12,4) ≥ 0`, nulles par défaut.
- Sur une ligne v3, un déclencheur calcule `h_mo* = round(quantity × h/u, 3)`. Les 45 fichiers qui lisent
  `h_mo` comme un total d'heures de ligne (qualité, nature, exports, couverture) gardent un sens juste.
- Échec fermé sur une v3 :
  - à l'insertion, `h_mo > 0` sans `h_mo_per_unit` est refusé (`ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`) ;
  - en mise à jour, modifier `h_mo` sans toucher h/u ni la quantité est refusé ;
  - aucune division silencieuse.
- Sur une v1/v2, les colonnes par unité doivent rester nulles (`ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`).
- Le moteur v3 ne lit **que** les colonnes par unité.

*Écartés.*
- Réinterpréter `h_mo` selon le moteur : toute copie non convertie d'une source v1/v2 (modèle, ouvrage,
  import de sections, `src/lib/estimates/server.ts:2241`) multiplierait la MO par Q en silence.
- `h_mo` nul en v3 : il faudrait réécrire tous les lecteurs du total.

### D5 — A2 : deux coefficients de vente ; paliers à titre indicatif ; marque nette

- `estimate_versions` et `estimate_templates` reçoivent `sale_coefficient_fo` et `sale_coefficient_mo` en
  `numeric(8,4)`, dans ]0 ; 10]. Sur `estimate_versions`, valeurs non nulles **si et seulement si** le moteur
  vaut 3 ; `estimate_templates` n'a pas de colonne de moteur : les coefficients y restent nullables et sont
  copiés depuis une v3 (§6.2).
- Les défauts viennent de la politique d'entreprise ; la duplication conserve ceux de la source.
- En v3, un CHECK impose `margin_mode='fixed'`, `margin_multiplier=1` et `global_coefficient=1`. Le
  coefficient global était appliqué sans être affiché en mode simple (D1 R08).
- Le barème **de l'entreprise** (`margin_tiers`) est affiché comme repère : « votre barème suggère ×k pour
  ce déboursé ». Il n'entre jamais dans le calcul. Le barème codé en dur (`margin-tiers.ts:9-13`) n'est
  jamais montré en v3.
- `k_fo` et `k_mo` restent des coefficients **de coût** (K Acc, difficulté).
- Marque v3. Le contexte figé porte `cost_subtotal_cents` et `realized_sale_coefficient`, ce dernier
  servant à l'affichage. Il **ne réutilise pas** `effective_margin_multiplier`, que l'éditeur affiche comme
  multiplicateur (`useEstimateEditorState.impl.tsx:2808-2817`).
  - `resolveEffectiveMarginBp` (v3) = (HT net − déboursé) / HT net, à partir d'un gel frais.
  - `list_approval_queue` reçoit une branche v3 explicite et garde le texte `= 1` asserté en
    `estimate-calc-engine-governance.test.sql:1086`.
  - La règle `min_margin` reçoit une preuve vivante calculée côté serveur pour la révision courante, comme
    `fixedDiscountEvidence` aujourd'hui. Sans preuve, l'état est « indisponible », **jamais 0** (F20).

*Écartés.*
- `margin_multiplier` comme coefficient FO (marque affichée fausse).
- Mapping B de D4 (`k_fo`/`k_mo` = coefficients de vente) : la marque affichée tombe à 0 %.
- Mapping C (`k_mo` = 0,923) : jusqu'à 1,12 € d'écart par ligne.
- Coefficients par ligne (P-02).
- Barème progressif appliqué.

### D6 — A3 : une intention de remise exacte

- Déjà fait par l'équipe : `discount_amount_cents` et sa contrainte (`20261014114943…sql:5-26`), la preuve
  `fixed_discount` au gel, la primauté du montant en lecture.
- **Ce qui reste** : le taux réécrit à côté du montant (F12), la saisie en pourcentage (le panneau n'accepte
  qu'un montant), la ligne distincte sur le document, l'affichage « demandé / appliqué » et une assiette
  juste en heures par unité (F13).
- Décision v3 :
  - intention en montant : `discount_amount_cents`, et `discount_bp = 0` ;
  - intention en pourcentage : `discount_bp` exact (0 à 10 000), et `discount_amount_cents` nul ;
  - CHECK `not (discount_amount_cents is not null and discount_bp <> 0)`, mode simple, aucun palier ;
  - montant appliqué : `min(M, G)` ou `min(arrondi½↑(G × bp / 10 000), G)`, exposé dans
    `discount_applied_cents` ;
  - la sauvegarde v3 ne dérive **jamais** une intention de l'autre ;
  - répartition par ligne exacte au plus grand reste, seulement pour obtenir les nets, la base de TVA par
    taux et les parts FO/MO.
- En v2, la réécriture du taux est laissée telle quelle : elle n'a aucun effet sur les montants (P-04).

*Écartés.*
- Colonne `discount_kind`, redondante avec l'exclusivité contrainte.
- Aide « Arrondir le TTC » qui écrirait un montant de remise : elle écraserait une intention en pourcentage
  et rouvrirait EUHIST.

### D7 — A4 : PU au centime, brut = Q × PU, arrondi commercial traité en remise

- Le PU publié v3 est arrondi au centime. Le brut de ligne vaut B = arrondi½↑(Q × PU), exact si Q est entier.
- Les colonnes historiques **gardent leur sens** : `line_total_ht_cents`, `line_tax_cents`,
  `line_total_ttc_cents` et `snapshot_fo/mo*` sont **nettes**, et Σ lignes = `total_ht_cents`. Restent
  ainsi valides les contrôles existants (réglages `20261014114943…sql:208-225`, gel, contrat 1, CHECK
  `024_rounding_invariants.sql:39-44`) et les consommateurs (direction, achats, analyses, exports).
- Nouvelles colonnes figées : `snapshot_gross_ht_cents` et `snapshot_gross_fo_ht_cents` (la MO brute s'en
  déduit). `snapshot_pu_ht_cents` et `pu_ht_cents` portent le PU publié : net en v2, brut en v3. C'est dans
  les deux cas le PU imprimé.
- Arrondi commercial en v3 : `rounding_mode ∈ {none, down}`. L'écart A = (G − R) mod pas va dans
  `commercial_rounding_cents ≥ 0` et réduit la base de TVA.
- `rounding_adjustment_cents = 0` (CHECK) : `total_tax_cents` est une TVA pure et `total_ttc = total_ht +
  total_tax`.
- Un dépassement de 2 147 483 647 c lève `ESTIMATE_AMOUNT_OVERFLOW`. Plus aucun écrêtage (D1-03) : en v2,
  le total reste plafonné à `MAX_CENTS` et n'est que signalé à l'éditeur par `isCapped`
  (`estimate-calculations.ts:465-469`, `useEstimateEditorState.impl.tsx:2748` ; golden
  `estimate-calculations.golden/margin-tiers.test.ts:125-159`, réaligné par `d484c5a1`).

*Écartés.*
- Brut stocké dans `line_total_ht_cents` : casse Σ lignes = HT pour 46 consommateurs TS et 49 migrations
  (dont `20261015190000`), et oblige à remplacer une contrainte existante.
- PT = arrondi(Q × PU non arrondi), comme les offres OPTIMA : le client ne peut pas recalculer.
- TTC rond par une remise calculée : cible parfois inatteignable avec plusieurs taux. Proposé en option
  (P-06), non livré par le lot 2 (§13).
- Ajustement hors TVA après le TTC : montant dû ≠ HT + TVA (D1-12).

### D8 — A5 : TVA par taux sur la base nette

- `tax_rate_bp` est obligatoire sur toute ligne v3 ; le déclencheur reprend le taux de version si
  l'écrivain l'omet. `estimate_versions.tax_rate_bp` devient le « taux par défaut des nouvelles lignes ».
- La RPC de réglages accepte `apply_tax_rate_to_lines` : réglages et taux des lignes changent dans la
  **même** transaction.
- Calcul :
  - base_r = Σ des nets de ligne au taux r ;
  - T_r = arrondi½↑(base_r × r / 10 000) ;
  - TVA de ligne = part exacte de T_r au plus grand reste à l'intérieur du groupe.
- Récapitulatif figé dans le contexte (`tax_breakdown`) et dans le contrat client 2, puis imprimé.
- Taux autorisés : liste de la politique (proposition 20 / 10 / 5,5 / 2,1 %), contrôlée au gel. À faire
  valider par l'expert-comptable (P-07) avant tout usage client réel ; le porteur a validé la proposition
  pour le développement le 16/10/2026.
- Autoliquidation : T_r = 0 et mention légale, comme aujourd'hui.

*Écartés.*
- TVA par ligne puis somme, comme en v2 (`estimate-calculations.ts:1365-1372`) : S5 donne 2 c d'écart, et
  une remise de 2 € ne réduit pas toujours la TVA (A-06).
- Taux unique propagé de force.

### D9 — A6 : unités et statuts

- Tables globales `public.measurement_units` (code, libellé, symbole, dimension, ordre, actif) et
  `public.measurement_unit_aliases` (jeton normalisé vers une unité **ou** un statut, exactement l'un des
  deux). RLS : lecture par `authenticated`, aucune écriture applicative, rien pour `anon`.
- **Source unique** : `src/lib/units/units.json`. Un script génère le bloc `VALUES` de la migration ; le TS
  lit le JSON. Le test de parité compare la table au JSON sur la pile native éphémère de `npm run db:ci:local`
  (suite pgTAP dont le script génère aussi l'attendu ; côté Vitest, ce runner n'exécute que `rls.e2e.test.ts`).
- Normaliseur `private.normalize_unit(text)` en SQL et `normalizeUnit()` en TS, avec le même algorithme de
  jeton :
  1. NFKD ;
  2. suppression des diacritiques ;
  3. `²` → 2 et `³` → 3 ;
  4. minuscules ;
  5. suppression des espaces, points et tirets.
- « ML », « ml », « mL », « m.l. » et « mètre linéaire » donnent `ml`. Le millilitre n'est pas dans le
  référentiel (P-08).
- `estimate_items.unit_code` (clé étrangère) est réservé à la v3. En v1/v2, l'unité reste dans
  `description`, sans reprise. L'unité est obligatoire au gel d'une ligne v3 chiffrée ; un brouillon peut
  rester incomplet.
- Enum `estimate_line_pricing_status` : `priced`, `included`, `for_memory`, `not_priced`, `out_of_scope`,
  `not_applicable`. Défaut `priced` ; seul `priced` est admis sur v1/v2 et sur les sections.
  - En v3, une ligne non chiffrée contribue 0 partout. Ses saisies sont conservées et ignorées, avec un
    avertissement. Le document imprime le libellé du statut.
  - Correspondances d'import : HL → `out_of_scope` ; PM → `for_memory` ; NC → `not_priced` ; inc, incl, CP
    → `included` ; SO → `not_applicable` (P-09).
- Normaliseurs privés existants, qui divergent : `normalizeUnit` (`src/lib/takeoff/benchmark.ts:83`,
  `src/lib/takeoff/dpgf-compare.ts:147`), `normalizeTakeoffUnit` (`src/lib/takeoff/processor.ts:321`),
  `normalizedUnit` (`src/lib/estimates/supplier-offer-eligibility.ts:4`). 2.2 et 2.4 disent lesquels le
  normaliseur partagé remplace et lesquels restent propres au métré ; le nom exporté évite la collision.
- Conversion vers l'unité d'achat portée par l'offre : sous-lot 2.9 (P-18, retenu le 16/10/2026, non bloquant
  pour 2.10).

*Écartés.* Enum PostgreSQL d'unités (pas d'alias, une migration par ajout) ; normaliseur TS seul ; reprise
de l'unité de toutes les lignes existantes.

### D10 — A7 : offre à 0 € exclue partout, sauf marquage explicite

- `supplier_pricebook.zero_price_kind text null check (zero_price_kind in ('included','free'))`, avec
  `zero_price_kind is null or unit_price_cents = 0`.
- Prédicat unique : `private.supplier_offer_price_eligible(unit_price_cents, zero_price_kind)` en SQL et
  `isSupplierOfferPriceEligible` en TS, soit `unit_price_cents > 0 or zero_price_kind is not null`.
- Appliqué aux six chemins :
  1. éligibilité ;
  2. meilleur prix ;
  3. présélection ;
  4. popover de suggestion ;
  5. fiche article ;
  6. catalogue SQL et préparation d'achat.
- Le prix de référence exclut déjà 0 € (`20261011030647…sql:65`) et continue d'exclure aussi les offres
  marquées.
- Règle d'entrée valable pour tous les moteurs. Aucune ligne déjà liée n'est modifiée.

*Écarté.* CHECK `unit_price_cents > 0` : il échouerait sur l'existant et interdirait la gratuité.

### D11 — A8 : saisie, convention de majoration, format OPTIMA

- Module `src/lib/numeric-input/parsers.ts`, **déjà créé** par les développeurs (d484c5a1) : grammaire unique
  `parseDecimalInput(input, { maxFractionDigits?, currency? })` (un `number` ou `null`), `formatDecimalInput`,
  `NUMERIC_INPUT_ERROR`, contrat `entry-contract.test.ts`. Le sous-lot 2.3 y ajoute, au-dessus de
  `parseDecimalInput`, les parseurs par grandeur : `parseAmountCents`, `parseQuantity` (3 décimales),
  `parseHoursPerUnit` (4 décimales), `parseRateBp` (2 décimales de %), `parseCoefficient` (4 décimales),
  `parseMajorationPercent`.
- Règles de grammaire (en place depuis d484c5a1 dans les réglages, la grille, l'import et le collage) :
  - espaces normal, insécable et fine, et apostrophe = séparateurs de milliers ; plusieurs points
    sans virgule aussi (« 1.234.567 ») ;
  - une virgule seule est toujours décimale (« 1,234 » : 1,234 en quantité, refusé en montant) ;
  - « 1.250 » (point suivi d'exactement trois chiffres) est **refusé comme ambigu**, avec le message
    `NUMERIC_INPUT_ERROR` (au collage : « Nombre invalide pour <champ>. ») ;
  - si point et virgule apparaissent ensemble, le dernier est décimal et les groupes sont vérifiés ;
  - une saisie invalide ne devient **jamais 0** ;
  - à l'import, une cellule numérique native ne passe pas par la grammaire ;
  - `parseDecimalInput` renvoie un `number` et refuse les décimales en trop (`maxFractionDigits`) au lieu
    d'arrondir : les parseurs par grandeur v3 passent au décimal exact (D13) depuis la chaîne validée, jamais
    par multiplication flottante ;
  - conséquence pour OPTIMA (2.3, 2.8) : un h/u écrit en texte avec un point seul et trois décimales
    (« 0.125 ») est refusé ; le profil transmet des nombres natifs ou une virgule décimale ;
  - durcir cette grammaire (par exemple refuser « 1,234.56 ») changerait les saisies v1/v2 : hors lot.
- **Majoration** : une seule convention humaine, celle de la grille et de l'export de l'éditeur
  (`shared.ts:260-263`, `editor-export.ts:404`, `:438`) ; la copie de la grille émet encore le coefficient brut
  sous « Majoration MO » (`useEstimateClipboard.ts:57`, `:290-291`).
  - « Majoration MO (%) », avec 100 = neutre, stockée en coefficient.
  - Collage et import : une colonne en « % » est divisée par 100 ; une colonne déclarée « coefficient » est
    prise brute ; une colonne sans unité déclarée doit être choisie explicitement ; un coefficient hors
    [0 ; 10] est refusé.
  - Profil OPTIMA, majoration additive : coefficient = 1 + N2.
  - La convention « +x %, 0 = neutre » n'est pas retenue (P-11, proposition validée le 16/10/2026) : elle
    exigerait une signature et un E2E de transition, car un utilisateur v2 qui saisirait « 100 » obtiendrait ×2.
- **En-têtes** :
  - les motifs de prix sont testés **avant** le motif d'unité, avec une correspondance par mots entiers ;
  - alias « Uté » → unité ; « Tps pose unitaire » → `labor_hours_per_unit` ;
  - « Tps pose unitaire majoré », « Tps pose total », « Prix Unitaire » et « Prix Total » → colonnes de
    **contrôle** ;
  - « Coeff FO », « Coeff MO » et « Taux horaire » → paramètres ;
  - « Qté Atelier » et « Qté Chantier » → reconnues et signalées non prises en charge ;
  - « Prix unitaire » ou « PU » d'un DPGF générique → cible proposée « prix de contrôle », pas le PR FO,
    sauf choix explicite « prix d'achat / prix de vente ».
- **Import auto-vérifiant** (v3) : après l'aperçu, le PU recalculé est comparé ligne à ligne à « Prix
  Unitaire » ; tout écart supérieur à 0,5 c est listé avant confirmation.
- Aides de colonnes selon le moteur : en v1/v2, « h MO : heures totales de la ligne » ; en v3, « h MO / u »
  et la formule complète. L'aide actuelle (`ColumnHeaderHelp.tsx:11-14`, ainsi que `:18` et `:21` pour
  l'atelier et le chantier) annonce « par unité » et une formule de PU fausse.

### D12 — Validation croisée TS/SQL proportionnée

- `private.estimate_v3_compute(version_id)` : recalcul complet, répartitions et TVA par taux comprises.
  Appelé au **gel** (`freeze_estimate_v3_snapshot`) et à la **publication** (gel document). Égalité exacte
  sur chaque colonne ; sinon `ESTIMATE_V3_PROJECTION_MISMATCH`.
- Aux **sauvegardes** (création, lot, ligne, réglages), `private.estimate_v3_assert_draft(version_id)`
  vérifie :
  - par ligne : `pu_ht_cents` = PU recalculé depuis les entrées, les coefficients et les taux verrouillés ;
    0 ≤ net ≤ arrondi½↑(Q × PU) ;
  - les identités de version : `gross_ht_cents` = Σ bruts chiffrés, `discount_applied_cents` = f(intention,
    G), `commercial_rounding_cents` = f(mode, pas, G − R), `total_ht_cents` = G − R − A, Σ nets = `total_ht_cents` ;
  - par taux : Σ `line_tax_cents` = arrondi½↑(base_r × r) ;
  - `rounding_adjustment_cents` = 0.
  L'algorithme de répartition n'est contrôlé exactement qu'au gel.

*Écartés.* Un SQL seul fait foi (l'aperçu de l'éditeur divergerait sans signal) ; recalcul complet à chaque
écriture (coût sur le chemin chaud, sans gain contractuel) ; contrôles de sommes v2 seuls (ils ne voient pas
une erreur compensée).

### D13 — Arithmétique

- Décimal exact : BigInt en TS, `numeric` en SQL. Arrondi demi supérieur pour des valeurs positives, ce qui
  correspond à `round(numeric)` en PostgreSQL et à `ROUND` dans Excel.
- Répartition au plus grand reste en entiers exacts : part_i = ⌊A·w_i / W⌋, reste A·w_i mod W.
  - Ex aequo départagés par `id` croissant, identique en TS et en SQL. L'ordre `uuid` de PostgreSQL est
    l'ordre lexical de l'hexadécimal en minuscules. Le départage ne dépend donc pas de l'ordre d'affichage.
  - Si W = 0, répartition égale.
- Ce sont de **nouvelles** fonctions : `allocateProRata` (`src/lib/estimate-allocation.ts:5-51`) reste celle
  de la v2. La v3 n'utilise pas `bankersRound`.

### D14 — Sceau et contrat client

- Marqueur `seal_payload_version = 5` inchangé (F1). Nouvelle **charge de calcul 6** (`estimate-seal.ts`) :
  charge 4, plus coefficients de vente, intention et montants de remise et d'arrondi, `gross_ht_cents`,
  `tax_breakdown`, et par ligne `unit_code`, `pricing_status`, `h_mo*_per_unit`, `snapshot_gross_*`,
  `tax_rate_bp`. `CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION` reste 4 pour la v2.
- **Contrat client 2** (`ClientContract2`, `schemaVersion: 2`), réservé à la v3. Les blocs `project`,
  `issuer` et `company` sont identiques à ceux du contrat 1 et réutilisent leurs validateurs ; la mise en
  page reste hors contrat (`layoutOptions` de la preuve, `estimate_offer_layout_valid`).
  - Ligne : `{kind, id, parentId, position, depth, title, quantity, unitCode, unitLabel, pricingStatus,
    taxRateBp, unitSaleHtCents|null, saleHtCents (brut), [foSaleHtCents, moSaleHtCents]}`. Section : somme
    brute.
  - `totals` : `{grossHtCents, commercialDiscountCents, discountIntent:{kind, rateBp?},
    commercialRoundingCents, netHtCents, taxByRate:[{rateBp, baseHtCents, taxCents}], taxCents,
    payableTtcCents, reverseCharge}`.
  - Invariants : Σ lignes = brut ; net = brut − remise − arrondi ; Σ `taxByRate` = TVA ; pour chaque taux,
    TVA = arrondi½↑(base × taux) ; TTC = net + TVA.
- Règle d'appariement : v3 ⇔ contrat 2 ; v1/v2 ⇔ contrat 1 ou historique.
  - `offer-document.ts:99-133` : branche contrat 2 avec la charge 6.
  - `server.ts:5666-5669` : le marqueur 5 continue de passer par `loadVerifiedOfferDocument`.
  - `server.ts:5721-5724` : les candidats historiques se limitent à la v1/v2.

*Écarté.* Étendre `schemaVersion: 1` : `estimate_offer_client_valid` et le parseur strict rejettent toute
clé en trop et tout moteur hors {1,2}. Il faudrait modifier les validateurs de documents déjà émis.

### D15 — Gel et documents v3 par de nouvelles RPC

`public.freeze_estimate_v3_snapshot` (M4) et `public.freeze_estimate_v3_document_snapshot` (M5) reprennent
la signature de leurs jumelles v2. `freeze_estimate_v2_snapshot_without_explicit_rounding`
(`20261014114943…sql:2174-2933`, environ 760 lignes), `freeze_estimate_v2_snapshot` et
`freeze_estimate_v2_document_snapshot` restent **textuellement intactes**.

### D16 — Chemins d'entrée : convertir explicitement ou refuser

- **Métré** : refusé en v3 (`TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`), car l'arbitrage 13 le place hors V1. Le
  contrat d'écrivain le refuse déjà en SQL ; un message nommé est ajouté côté TS
  (`src/lib/takeoff/server.ts`).
- **Ouvrages de bibliothèque** (2.8) : h/u = `h_mo / default_quantity`. Refus si la quantité par défaut est
  nulle ou si le quotient ne tient pas en 4 décimales.
- **Ouvrages générés** (2.8) : la ligne porte le rendement par unité.
- **Modèles et sections d'une v1/v2 insérés dans une v3** (2.8) : conversion h/u = h / Q, avec un rapport
  des lignes où Q × h/u ≠ h. Si Q = 0 et h > 0, l'insertion est refusée et la ligne nommée (P-12).
- **Import DPGF et collage vers une v3** (2.8) : h/u direct. L'import lit aujourd'hui `labor_hours ?? h_mo`
  comme un total d'heures de ligne (`src/lib/affaires/import-flow.ts:389`, `:397`) : la v3 le mappe
  explicitement vers `h_mo_per_unit`, sinon le déclencheur D4 refuse la ligne
  (`ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`). Depuis `d484c5a1`, `k_fo`, `h_mo`, majoration et `k_mo`
  illisibles sont déjà refusés (`invalid_row_payload`, `import-flow.ts:388-395`) : la vérification v3 prolonge
  cette voie, sans contrôle parallèle.
- **Structure IA, version zéro, mise à jour groupée directe** : refusées en v3 pendant le lot 2, avec un
  message nommé, sauf besoin du pilote (P-14, validée le 16/10/2026).

### D17 — Ni reprise, ni conversion

Aucune `UPDATE` sur `estimate_versions` ni sur `estimate_items`. Toutes les colonnes ajoutées sont nulles ou
ont un défaut constant (métadonnées seules, sans réécriture). Pas de conversion v2 → v3 : la duplication
d'une v2 reste une v2 (P-15).

### D18 — Types de base

`src/types/database.ts` (CRLF) est mis à jour à la main à chaque migration et vérifié par des assertions pgTAP
`has_column` / `col_type_is` sur les colonnes ajoutées. La génération automatique des types reste une
amélioration hors lot : aucun script npm ne la fournit et la liste blanche du harnais local
(`assertLocalOnlySupabaseArgs`, `src/test/supabase-cli.ts:103-192`) n'autorise pas `supabase gen types`.

---

## 4. Contrat de calcul v3

Notations :
- Q = quantité (3 décimales) ; P = PR FO en centimes ; `k_fo`, `k_mo`, `maj` (coefficient de majoration) ;
  h = heures par unité ; t = taux horaire du rôle du propriétaire, en centimes ;
- c_FO et c_MO = coefficients de vente ;
- ⌈x⌋ = arrondi au centime, demi supérieur, en décimal exact.

Seules les lignes `priced` entrent dans les sommes.

1. FO_u = P × k_fo.
2. MO_u = maj × h × t × k_mo. Avec la ventilation atelier/chantier (même déclenchement qu'en v2,
   `isLaborSplitEnabled && hasActiveLaborSplitPayload`, `src/lib/estimate-calculations.ts:265-266`) :
   MO_u = maj × (h_at × t_at × k_at + h_ch × t_ch × k_ch).
3. **PU** = ⌈FO_u × c_FO + MO_u × c_MO⌋, avec un seul arrondi.
4. **Brut** B = ⌈Q × PU⌋.
   - FO/MO bruts : répartition exacte de B selon les poids (FO_u × c_FO, MO_u × c_MO).
   - Atelier/chantier : répartition de la MO brute.
5. **Déboursé** D = ⌈Q × (FO_u + MO_u)⌋. Il sert à la marque et n'est jamais facturé.
6. G = Σ B.
7. **Remise** : R = min(M, G) pour un montant, ou min(⌈G × bp / 10 000⌋, G) pour un taux.
8. **Arrondi commercial** (mode `down`, pas s) : A = (G − R) mod s ; sinon 0.
9. **HT net** N = G − R − A.
   - Réduction de ligne = répartition exacte de R + A selon les B.
   - Net de ligne = B − réduction.
   - FO/MO nets = répartition du net selon (FO brut, MO brut) ; idem pour atelier/chantier.
10. **TVA** : pour chaque taux r, base_r = Σ nets et T_r = ⌈base_r × r / 10 000⌋ (0 en autoliquidation).
    TVA de ligne = répartition exacte de T_r selon les nets du groupe.
11. **Pied** :
    - `total_ht = N` ; `total_tax = Σ T_r` ; `total_ttc = N + Σ T_r` ; `rounding_adjustment = 0` ;
    - `gross_ht = G` ; `discount_applied = R` ; `commercial_rounding = A` ;
    - `cost_subtotal = Σ D` ;
    - coefficient réalisé = ⌈N / Σ D⌋ à 6 décimales, pour l'affichage. Si Σ D = 0 : 1 si N = 0, sinon
      indéterminé.
12. Toute grandeur supérieure à 2 147 483 647 lève `ESTIMATE_AMOUNT_OVERFLOW`.

Invariants vérifiés (TS au calcul, SQL au gel) :
- Σ nets = HT, et 0 ≤ net ≤ brut ;
- brut = ⌈Q × PU⌋, avec un PU indépendant de Q ;
- pour chaque taux, Σ TVA de ligne = ⌈base × r⌋ ;
- TTC = HT + TVA ;
- monotonie : augmenter un coût d'entrée n'abaisse jamais le PU ni le HT ;
- une ligne non chiffrée contribue 0.

---

## 5. Oracle, scénarios et tolérances

### 5.1 Lignes-oracle (D4 §2.4)

Taux 40 €/h, `k_fo = k_mo = maj = 1`, PR FO au centime, c_FO = 1,30 et c_MO = 1,20. Valeurs recalculées.

| Id | Q / U | PR FO (c) | h/u | **PU v3** | PU de l'offre | **Total v3** | Total de l'offre | Écart | Déboursé |
|---|---|---|---|---|---|---|---|---|---|
| O1 | 20 ml | 5 466 | 1,991 | **16 663** | 166,63 | **333 260** | 333 252 | +8 | 268 600 |
| O2 | 3 u | 9 563 | 1,75 | **20 832** | 208,32 | **62 496** | 62 496 | 0 | 49 689 |
| O3 | 21 m2 | 5 850 | 0 | **7 605** | 76,05 | **159 705** | 159 705 | 0 | 122 850 |
| O4 | 1 139 ml | 302 | 0,2 | **1 353** | 13,53 | **1 541 067** | 1 540 611 | +456 | 1 255 178 |
| O5 | 1 u | 2 000 | 6 | **31 400** | 314,00 | **31 400** | 31 400 | 0 | 26 000 |
| O6 | 282 ml | 9 186 | 0,998 | **16 732** | 167,32 | **4 718 424** | 4 718 480 | −56 | 3 716 196 |
| O7 | 8 ml | 883 | 1,30 | **7 388** | 73,88 | **59 104** | 59 103 | +1 | 48 664 |
| Σ | | | | | | **6 905 456** | 6 905 047 | +409 | 5 487 177 |

- Avec 1,3 / 1,3, les PU valent 17 459, 21 532, 7 605, 1 433, 33 800, 17 131 et 7 908 c : ce sont les PU
  affichés par le classeur.
- Le PU de l'offre est reproduit sur **7 lignes sur 7**. L'écart de total vient uniquement de la règle A4
  (Q × PU affiché) et a été accepté par le porteur le 16/10/2026 (P-03).
- O2 : la saisie est fixée à 9 563 c avec `k_fo = 1`. Un PR exact de 95,625 € donnerait 208,31 € (P-10).

### 5.2 Scénarios chiffrés (TVA 20 % sauf mention)

| Scénario | HT brut | Remise | Arrondi | HT net | TVA | TTC |
|---|---|---|---|---|---|---|
| S1 sans remise | 6 905 456 | 0 | 0 | 6 905 456 | 1 381 091 | 8 286 547 |
| S2 remise 1,01 € (EU01 transposé) | 6 905 456 | 101 | 0 | 6 905 355 | 1 381 071 | 8 286 426 |
| S3 remise 10 % | 6 905 456 | 690 546 | 0 | 6 214 910 | 1 242 982 | 7 457 892 |
| S4 = S2, arrondi HT au pas de 100 € inférieur | 6 905 456 | 101 | 5 355 | 6 900 000 | 1 380 000 | 8 280 000 |
| S5 = S2, O1–O3 à 10 % et O4–O7 à 20 % | 6 905 456 | 101 | 0 | 6 905 355 | 55 545 + 1 269 980 = 1 325 525 | 8 230 880 |

S5 : les 101 c sont répartis `[5, 1, 2, 23, 0, 69, 1]`. Les bases valent 555 453 c à 10 % et 6 349 902 c à 20 %.
Une TVA calculée ligne à ligne donnerait 1 325 527 c : c'est l'écart que supprime A5.

### 5.3 Cas d'exigence

| Cas | Entrée | Attendu v3 |
|---|---|---|
| T-HMO | Q 10, PR 1 000 c, 0,5 h/u, 4 500 c/h, coefficients 1 | PU 3 250, total 32 500, MO 22 500 (v2 : 12 250) |
| T-HMO-Q | même ligne, Q de 10 à 20 | 65 000 : la MO suit la quantité |
| T-Q0 | même ligne, Q 0 | total 0, PU 3 250 affiché, MO 0 |
| T-PU | Q 3, PR 1 001 c, c_FO 1,6 | PU 1 602, total 4 806 |
| T-HALF3 | Q 1,005, PU 100 c | 101 |
| A-05 | PR 999 c × 7, c_FO 1,6 | PU 1 598, total 11 186 |
| EU01 | brut 1 995 450 c, montant 101 | appliqué 101 ; HT 1 995 349 ; TVA 399 070 ; TTC 2 394 419 ; `discount_bp` 0 |
| EU01-b | même brut, montant 99 | appliqué 99 ; HT 1 995 351 ; TVA 399 070 ; TTC 2 394 421 |
| EUHIST | PR 200 c, 10 %, c_FO de 1 à 2 | brut 400, remise 40, HT 360, TVA 72, TTC 432 ; `discount_bp` reste 1 000 |
| CAP | remise demandée 500 € sur une assiette de 400 € | appliquée 400 € ; « demandé / appliqué » |
| A-06 | 1 004 lignes, remise de 200 c | ΔTVA = 40 c exactement |
| T-TVA1 | 10 000 c à 20 % + 10 000 c à 5,5 % | TVA 2 550, récapitulatif sur 2 lignes |
| T-TVA-ARR | 3 lignes de 33 c à 20 % | TVA 20 c (v2 : 21 c) |
| T-TAXSNAP | 76 063 c, arrondi au pas de 1 € inférieur | arrondi 63 ; HT 76 000 ; TVA 15 200 ; TTC 91 200 ; ajustement 0 |
| R1-ARR | net avant arrondi 1 234 567 c, pas de 100 c | A = 67 ; HT 1 234 500 ; TVA 246 900 ; TTC 1 481 400 |
| T-CAP | PR 2 000 000 000 c, c_FO 1,6 | `ESTIMATE_AMOUNT_OVERFLOW`, sans écrêtage |
| T-MONO | déboursé 9 999 999 c puis 10 000 000 c, c 1,6 | HT 15 999 998 puis 16 000 000, sans palier |
| T-MARG | c 1,25 / 1,25, remise 20 % | marque nette 0 % ; une règle « marge minimum 15 % » est violée |
| T-STAT | ligne « hors lot » chiffrable à 500 € | 0 € au total ; libellé « Hors lot » |
| T-Z | offre à 0 € non marquée | inéligible partout ; marquée « inclus », elle est éligible et libellée |

### 5.4 Lots OPTIMA complets (critère d'acceptation du moteur pur, sous-lot 2.4, puis de l'import, sous-lot 2.8)

| Lot (classeur `[préfixe] - DPGF …xlsx`) | 1,3 / 1,3 | 1,30 / 1,20 | Déboursé | Coefficient réalisé |
|---|---|---|---|---|
| Hydraulique (785 lignes chiffrées) | PU identique sur **785/785** ; PT identique sur 392/785 ; écart max 7,94 € ; Σ **1 644 207,61 €** (classeur 1 644 173,89 €) | **1 572 320,99 €** (offre 1 572 275,75 €) | 1 264 749,07 € | **1,243188** |
| Plomberie (656 lignes chiffrées) | **656/656** ; PT 310/656 ; écart max 2,03 € ; Σ **1 027 655,61 €** (1 027 637,33 €) | **981 887,92 €** (offre 981 875,83 €) | 790 490,05 € | **1,242126** |

Lignes à statut du lot hydraulique : 61 HL, 9 inc, 7 NC, 1 PM, 1 CP. Du lot plomberie : 74 HL, 4 NC, 3 SO, 1 PM.

### 5.5 Tolérances

| Comparaison | Tolérance |
|---|---|
| Moteur v3 contre attendus §5.1 à §5.3 | 0 c |
| PU v3 contre PU des offres et des classeurs | 0 c (7/7, 785/785, 656/656) |
| Total v3 contre total des offres | ≤ Q × 0,5 c par ligne ; écart par lot publié. Les écarts du §5.1 et du §5.4 sont acceptés (P-03, 16/10/2026) ; tout autre lot ou écart reste à faire accepter |
| TS contre SQL (moteur v3) | 0 écart sur 10 000 lignes et 300 devis tirés au hasard |
| v1/v2 avant contre après | 0 octet sur le corpus figé, les empreintes documentaires et la montée de version |
| Import OPTIMA vers v2 (2.3) contre classeur 1,3 / 1,3 | 0 c sur les 7 lignes |

### 5.6 Données du client

Les classeurs OPTIMA sont déjà suivis dans `docs/prd_file/`. On n'ajoute **aucune** nouvelle donnée client au
dépôt (constat S-01 : dépôt public).
- La fixture des 7 lignes ne garde que les nombres de `D4-extraits.json`, sans désignation.
- La reproduction des lots complets est un script local (`scripts/engine-v3/optima-lot-check.ts`, avec le
  chemin du classeur en argument). Il archive son rapport hors du dépôt et ne tourne pas en CI.

---

## 6. Schéma

Migrations nouvelles, horodatées après la dernière migration publiée (`20261015190000` à `98408ef0`, contrôle
`npm run supabase:migrations:git-guard` ; `20261014172511`, issue du lot 1 non publié, est archivée dans
`docs/audit-independant-2026-10-14/lot1/`) ; aucune migration existante réécrite.
- Avant chaque migration : un bloc `do $preflight$` vérifie les hypothèses sur les données (modèle :
  `20261014114943…sql:2937-2957`).
- Pour chaque fonction redéfinie : partir de `pg_get_functiondef` sur la pile locale reconstruite par le
  harnais du §10.2 (préparé en 2.0 : `npm run db:ci:local` et `npm run dev:army` détruisent leur pile à
  l'arrêt), puis conserver
  le diff « base → correctif », limité aux lignes attendues.
- Mettre à jour le manifeste (`npm run supabase:manifest:add`) et lancer `supabase:validate`.
- `safeupdate` est actif sur les sessions PostgREST : c'est la cause de `20261015190000` (`a25b5c40`,
  `docs/testing/takeoff-apply-safeupdate.md`). Tout `UPDATE` ou `DELETE` des déclencheurs et RPC v3, y compris
  sur une table temporaire, porte une clause `WHERE`. pgTAP ne peut pas charger safeupdate (rôle natif) : la
  preuve passe par les parcours E2E.

### 6.1 Tableau des migrations

| # | Fichier proposé | Sous-lot | Contenu |
|---|---|---|---|
| M1 | `…_estimate_calc_engine_v3_fail_closed.sql` | 2.1 | CHECK `(1,2,3)` ; `enforce_estimate_calc_engine_on_insert` accepte 3, sans nouveau contrat ; `private.calc_engine_freezes_snapshot` ; gouvernance héritée (§7) ; déclencheurs de contrat d'écrivain sur les lignes et les versions ; déclencheur de refus des documents v3 ; `estimate_offer_client_items_match` fermé hors {1,2} ; refus nommé à la publication. |
| M2 | `…_supplier_offer_zero_price_policy.sql` | 2.2 | `zero_price_kind` ; `private.supplier_offer_price_eligible` ; `catalogue_products_page`, `catalogue_products_summary` et `create_estimate_purchase_order_drafts` filtrés ; « ml » sans tenir compte de la casse dans la préparation d'achat (`20261011091744…sql:607-608`). |
| M3 | `…_estimate_engine_v3_functions_and_units.sql` | 2.4 | `measurement_units` et alias (RLS, données initiales générées depuis `units.json`) ; `private.unit_token` et `private.normalize_unit` ; fonctions pures `private.estimate_round_half_up`, `private.estimate_allocate_exact(bigint, numeric[], uuid[])`, `private.estimate_v3_line(...)`, `private.estimate_v3_compute_items(jsonb, jsonb)` (calcul sur des données passées en paramètre), révoquées pour tous sauf le propriétaire. |
| M4 | `…_estimate_engine_v3_persistence.sql` | 2.5 | Politique et journal ; enum de statut ; colonnes et CHECK (§6.2) ; déclencheurs complétés ; contrat `canonical_v3` ; création, lot, ligne, réglages et duplication v3 ; `private.estimate_v3_compute(uuid)` et `private.estimate_v3_assert_draft(uuid)` ; `freeze_estimate_v3_snapshot` ; branche v3 de `list_approval_queue` ; colonnes de révision. |
| M5 | `…_estimate_offer_client_contract_v2.sql` | 2.7 | Paire de contrat admettant 2 ; `estimate_offer_client_valid_v2`, `estimate_offer_client_items_match_v2` ; branches par contrat dans les fonctions d'offre (§7) ; `freeze_estimate_v3_document_snapshot` ; retrait des refus d'émission v3 de M1. |
| M6 | `…_estimate_engine_v3_entry_paths.sql` | 2.8 | Colonnes v3 des modèles ; `create_estimate_template_from_version`, `duplicate_estimate_template` et `insert_estimate_template_into_version` en v3 ; `materialize_estimate_assembly_tree` et `commit_generated_ouvrages` / `private.generated_ouvrage_insert_line` en v3, avec pose du contrat d'écrivain. |
| M7 | `…_supplier_offer_purchase_unit.sql` | 2.9 | `supplier_pricebook.estimate_unit_code`, `estimate_units_per_purchase_unit numeric(14,6) > 0`, `purchase_rounding in ('none','ceil')` ; préparation d'achat avec conversion. |
| M8 | `…_estimate_engine_v3_default.sql` | 2.10 | Politique absente = moteur 3 (bascule). |

### 6.2 Colonnes et contraintes (M4)

`estimate_versions` :

| Colonne | Type | v1/v2 | v3 |
|---|---|---|---|
| `sale_coefficient_fo`, `sale_coefficient_mo` | numeric(8,4) null | NULL | requis, dans ]0 ; 10] |
| `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents` | integer null | NULL | requis, ≥ 0 |

```sql
alter table public.estimate_versions add constraint estimate_versions_engine_v3_shape_check check (
  case when calc_engine_version = 3 then
    sale_coefficient_fo > 0 and sale_coefficient_fo <= 10
    and sale_coefficient_mo > 0 and sale_coefficient_mo <= 10
    and margin_mode = 'fixed' and margin_multiplier = 1 and global_coefficient = 1
    and discount_mode = 'simple' and cardinality(discount_steps) = 0
    and discount_bp between 0 and 10000
    and not (discount_amount_cents is not null and discount_bp <> 0)
    and rounding_mode in ('none','down') and rounding_adjustment_cents = 0
    and gross_ht_cents >= 0 and discount_applied_cents >= 0 and commercial_rounding_cents >= 0
    and total_ht_cents = gross_ht_cents - discount_applied_cents - commercial_rounding_cents
  else
    sale_coefficient_fo is null and sale_coefficient_mo is null and gross_ht_cents is null
    and discount_applied_cents is null and commercial_rounding_cents is null
  end) not valid;
alter table public.estimate_versions validate constraint estimate_versions_engine_v3_shape_check;
```

`total_ttc = total_ht + total_tax` est déjà imposé (`024_rounding_invariants.sql`).

`estimate_items` (et `estimate_template_items` pour les quatre premières colonnes) :

| Colonne | Type | v1/v2 | v3 |
|---|---|---|---|
| `unit_code` | text null, FK `measurement_units(code)` | NULL (garde) | requis au gel d'une ligne chiffrée |
| `pricing_status` | `estimate_line_pricing_status` not null default `'priced'` | `priced` (garde) | libre sur une ligne |
| `h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit` | numeric(12,4) null, ≥ 0 | NULL (garde) | primitives de calcul |
| `snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents` | integer null (lignes seulement) | NULL | figés au gel, tous deux ou aucun ; 0 ≤ FO ≤ brut |

CHECK supplémentaire : `item_type = 'line' or (unit_code is null and pricing_status = 'priced' and h_mo_per_unit is null)`.

`estimate_templates` : `sale_coefficient_fo` et `sale_coefficient_mo`, nullables, copiés depuis une v3.

### 6.3 Politique d'entreprise (M4)

```sql
create table public.tenant_calc_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  new_estimate_calc_engine smallint not null default 2 check (new_estimate_calc_engine in (2, 3)),
  default_sale_coefficient_fo numeric(8,4) check (default_sale_coefficient_fo > 0 and default_sale_coefficient_fo <= 10),
  default_sale_coefficient_mo numeric(8,4) check (default_sale_coefficient_mo > 0 and default_sale_coefficient_mo <= 10),
  allowed_tax_rates_bp integer[] not null default '{2000,1000,550,210}',
  change_reason text not null check (char_length(change_reason) between 5 and 500),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint tenant_calc_policies_v3_requires_defaults check (new_estimate_calc_engine = 2
    or (default_sale_coefficient_fo is not null and default_sale_coefficient_mo is not null))
);
-- RLS : select pour les membres de l'entreprise ; aucune écriture pour authenticated ni anon.
-- Écriture : public.set_tenant_calc_policy (security definer), exécutable par service_role en lot 2,
-- avec écriture dans tenant_calc_policy_events (avant/après, motif, auteur).
```

### 6.4 Déclencheurs

1. **`guard_estimate_item_engine_columns`** (M1 inerte, complété en M4), avant insertion et mise à jour sur
   `estimate_items`, `security invoker`, `search_path=''`. Il lit le moteur de la version parente.
   - v1/v2 : colonnes v3 nulles et statut `priced`, sinon `ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`.
   - v3 :
     - contrat d'écrivain exigé pour toute insertion et pour toute colonne de calcul modifiée
       (`ESTIMATE_V3_WRITER_NOT_SUPPORTED`) ;
     - `tax_rate_bp` reçoit par défaut le taux de version ;
     - `h_mo*` est dérivé de Q × h/u ;
     - les refus A1 de D4 s'appliquent.
2. **`guard_estimate_version_engine_v3_writer`** (M1), avant mise à jour sur `estimate_versions`. Pour une v3,
   la modification d'une colonne de calcul exige le contrat d'écrivain : marges, remise, coefficients, TVA,
   arrondi, totaux, `contractor_role`, l'écriture d'une valeur non nulle dans `calc_snapshot_*`, puis les
   colonnes de M4. Restent libres : la remise à NULL de `calc_snapshot_*` par l'invalidation
   (`invalidate_estimate_v2_snapshot_context`, `20260812032857…sql:2207-2254`), `content_revision`,
   `updated_at`, le statut, l'approbation et les colonnes de sceau, qui ont leurs propres gardes.
3. **`guard_estimate_document_engine_v3`** (M1, remplacé en M5) : un document d'une v3 est refusé
   (`ESTIMATE_V3_EMISSION_NOT_READY`). Après M5, il exige le contrat 2.
4. **`guard_estimate_version_workflow_columns`** (redéfini en M4) : les cinq colonnes de version v3 entrent
   dans la liste qui incrémente `content_revision` (`20261014114943…sql:362-401`). Sans cela, un gel
   périmé paraîtrait frais (R4).
5. **`guard_estimate_v2_snapshot_columns`** (redéfini en M1 puis en M4) :
   - `target_engine_version = 2` devient `private.calc_engine_freezes_snapshot(target_engine_version)` aux
     lignes `:346`, `:366` et `:382` ;
   - en M4, les colonnes `snapshot_gross_*`, `unit_code`, `pricing_status` et `h_mo*_per_unit` rejoignent
     les colonnes gérées et effacées à l'édition (`:479-506`).
6. **`bump_estimate_content_revision_from_item`** est générique (`20260713132620…sql:106`, comparaison
   `to_jsonb`) et couvre les nouvelles colonnes de ligne sans changement.

### 6.5 Contexte figé v3 (`calc_snapshot_context`)

Exemple EU01 (ligne de fourniture de 1 995 450 c, coefficients 1, remise de 1,01 €) :

```json
{
  "engine": 3,
  "labor_split_enabled": false,
  "labor_roles": [],
  "sale_coefficients": {"fo": 1, "mo": 1},
  "discount": {"kind": "amount", "requested_cents": 101, "rate_bp": null, "base_cents": 1995450, "applied_cents": 101},
  "commercial_rounding": {"mode": "none", "step_cents": 1, "applied_cents": 0},
  "cost_subtotal_cents": 1995450,
  "realized_sale_coefficient": 0.999949,
  "tax_breakdown": [{"rate_bp": 2000, "base_cents": 1995349, "tax_cents": 399070}]
}
```

Le contexte v3 ne contient ni `margin_tiers` ni `effective_margin_multiplier`. La clé `discount` remplace
`fixed_discount`, lue par `effective-discount.ts:108-112` et étendue à la v3.

### 6.6 Reprise de données

Aucune. Les modèles existants n'ont pas d'heures par unité : leur base est donc le total, sans ambiguïté.
Les offres à 0 € existantes deviennent inéligibles jusqu'à ce qu'elles soient qualifiées. La liste en est
fournie à l'administrateur par une requête de lecture.

---

## 7. Changements SQL, fonction par fonction (définition vivante)

| Fonction (définition vivante) | Lignes | Traitement | Migration |
|---|---|---|---|
| CHECK `estimate_versions_calc_engine_version_check` | `20260812032857…sql:24-28` | `in (1,2,3)` | M1 |
| `enforce_estimate_calc_engine_on_insert` | `20260812032857…sql:2392-2431` | accepte 3 ; `canonical_v3` → 3 seulement en M4 | M1, M4 |
| `guard_estimate_v2_snapshot_columns` | `…:346`, `:366`, `:382`, `:479-506` | prédicat d'héritage ; colonnes v3 | M1, M4 |
| `guard_estimate_project_v2_owner_change` | `…:551`, `:578` | prédicat d'héritage | M1 |
| `guard_labor_role_v2_owner_change` | `…:614`, `:642` | prédicat d'héritage | M1 |
| `open_estimate_review_cycle` | `…:1037` | prédicat d'héritage | M1 |
| `capture_estimate_review_content_revision` | `…:1943` | prédicat d'héritage | M1 |
| `invalidate_estimate_v2_snapshot_context` | `…:2212`, `:2225`, `:2248` | prédicat d'héritage | M1 |
| `require_fresh_v2_snapshot_for_publication` | `…:2311` | prédicat d'héritage, plus `ESTIMATE_V3_EMISSION_NOT_READY` (retiré en M5) | M1, M5 |
| `estimate_offer_client_items_match` | `20261013130248…sql:372-396` | `false` si moteur hors {1,2} ; branche v1/v2 inchangée | M1 |
| `list_approval_queue` | `20260812032857…sql:4211` | branche v3 : marque = (HT − `cost_subtotal_cents`) / HT si le gel est frais, sinon NULL ; texte `= 1` conservé | M4 |
| `persist_estimate_creation_atomic` | `20261014114943…sql:408`, `:475-484`, `:839`, `:897`, liste blanche `:457-480` | politique `FOR SHARE` ; moteur attendu ; `canonical_v3` ; colonnes v3 ; contrat d'écrivain ; `estimate_v3_assert_draft` | M4 |
| `save_estimate_settings_atomic` | `20261014114943…sql:28-293` (`:186`, `:216-221`, `:232`, `:258-263`) | branche v3 : coefficients, intention de remise, arrondi, `apply_tax_rate_to_lines`, projections de taux, contrôle des rôles du propriétaire, assertion de brouillon | M4 |
| `commit_estimate_batch` et `private.canonical_estimate_batch_operations` | `20261012030743…sql:99`, `:347`, `:350` | `line_keys` + `unit_code`, `pricing_status`, `h_mo*_per_unit` ; branche v3 ; contrat d'écrivain (il couvre `bulk_update_estimate_items` appelée à l'intérieur) | M4 |
| `atomic_create_estimate_item` | `20261012020700…sql:97`, `:226`, `:236` | branche v3, contrat d'écrivain | M4 |
| `duplicate_estimate_version_without_product_id` | `20261014114943…sql:1026`, colonnes `:1132-1165` | copie des colonnes v3 ; contrat d'écrivain | M4 |
| `freeze_estimate_v3_snapshot` (nouvelle) | — | recalcul complet, égalité stricte, unité requise, taux autorisés, écriture des colonnes figées et du contexte | M4 |
| Fonctions d'offre : paire de contrat (`:33-34`), `estimate_offer_document_valid` (`:271`), `guard_estimate_offer_document` (`:483`), `reserve_estimate_email_dispatch` (`:536`), `publish_estimate_pdf_generation` (`:639`, ancrage `:661-673`), `prepare_estimate_email_dispatch` (`:721`), `transition_estimate_version_status` (`:787`), `claim_portal_estimate_decision` (`:835`), `assert_estimate_offer_dispatch_proof` (`:893`), `guard_estimate_offer_seal` (`:924`) | `20261013130248…sql` | branche contrat 2, à l'identique pour le contrat 1 ; règle v3 ⇔ contrat 2 | M5 |
| `freeze_estimate_v3_document_snapshot` (nouvelle) | modèle `20261013162417…sql:7` | session de document v3 | M5 |
| `create_estimate_template_from_version`, `duplicate_estimate_template` | `20261014114943…sql:1374`, `:1530` | colonnes v3 | M6 |
| `insert_estimate_template_into_version` | `20260304180000…sql:4` | conversion h/u ou refus (D16) ; contrat d'écrivain | M6 |
| `materialize_estimate_assembly_tree` | `20261013002038…sql:5`, `:125`, `:133` | v3 : h/u = `h_mo / default_quantity` ; unité normalisée | M6 |
| `commit_generated_ouvrages`, `private.generated_ouvrage_insert_line`, `finalize_estimate_assembly_calculation` | `20261012215942…sql:176`, `:338`, `:341` ; `20261012043643…sql:316` ; `20261013074536…sql:142` | branche v3 ; contrat d'écrivain | M6 |
| `recalculate_takeoff_estimate_version`, `apply_takeoff_job_atomic` | `20261015190000…sql:5` (`:147`, `:357`, `:438`, redéfinition de `a25b5c40` à formules inchangées) ; `20260813201300…sql:1081` | **inchangées** : le contrat d'écrivain les refuse en v3 | — |
| `freeze_estimate_v2_snapshot_without_explicit_rounding`, `freeze_estimate_v2_snapshot`, `freeze_estimate_v2_document_snapshot` | `20261014114943…sql:2174` ; `20260812223050…sql:95` ; `20261013162417…sql:7` | **inchangées** (refus v3 existant : `20261014114943…sql:2308`, hérité par `freeze_estimate_v2_snapshot` via `20260812223050…sql:195` ; `20261013162417…sql:111`) | — |
| `catalogue_products_page`, `catalogue_products_summary`, `create_estimate_purchase_order_drafts` | `20260906145000…sql:436` ; `20260712201900…sql:239-245` ; `20261011091744…sql:469`, `:607-608` | prédicat de prix, « ml » | M2 |

**Garde structurelle pgTAP** (2.1). Toute fonction des schémas `public` et `private` dont `prosrc` correspond
à `engine_version\y[^;]{0,40}?(=|<>|!=|is (not )?distinct from)\s*[0-9]` (`\y` et non `\b`, qui désigne un
retour arrière dans les expressions régulières PostgreSQL) doit figurer dans une liste blanche
revue, avec un motif. Cette expression couvre `target_engine_version = 2`, `current_calc_engine_version = 2`
et `coalesce(…, 1) = 2`. Toute nouvelle comparaison exige donc une revue explicite.

---

## 8. Changements TypeScript, fichier par fichier

### 8.1 Nouveaux modules (≤ 1 200 lignes non vides chacun)

| Fichier | Rôle | Sous-lot |
|---|---|---|
| `src/lib/estimates/engine/capabilities.ts` | `EstimateEngineVersion`, `requireEstimateEngineVersion`, prédicats, `EstimateEngineUnavailableError`, `assertNever` | 2.1 |
| `src/lib/estimates/engine/compute.ts` | Façade `computeVersionBreakdown` ; la branche v3 lève une erreur jusqu'à 2.4 | 2.1, 2.4 |
| `src/lib/estimates/engine-v3/decimal.ts`, `allocate.ts`, `line.ts`, `breakdown.ts`, `tax.ts`, `discount.ts`, `projection.ts`, `stored.ts`, `index.ts` | Moteur pur, projection des colonnes et du contexte, relecture d'une v3 figée | 2.4 |
| `src/lib/estimates/engine-v3/oracle.fixtures.ts` | O1–O7 (nombres seuls), S1–S5, cas du §5.3 | 2.4 |
| `src/lib/units/units.json`, `normalize.ts`, `scripts/units/generate-units-sql.ts` | Référentiel et normaliseur | 2.4 |
| `src/lib/estimates/supplier-offer-price.ts` | `isSupplierOfferPriceEligible` | 2.2 |
| `src/lib/mappings/optima-profile.ts` | Profil OPTIMA et colonnes de contrôle | 2.3, 2.8 |
| `src/lib/estimates/calc-policy-server.ts` | Lecture de la politique, `resolveNewEstimateEngine` | 2.5 |
| `src/lib/estimates/v3-snapshot-server.ts` | Gel v3 | 2.5 |
| `src/lib/estimates/v3-margin-evidence-server.ts` | Preuve de marque v3 pour les règles et la Direction | 2.5 |
| `src/hooks/useEstimateV3Settings.ts`, `src/components/estimates/v3/EstimateV3SettingsSection.tsx`, `src/components/estimates/v3/V3LineCells.tsx`, `src/components/estimates/v3/TaxRatePropagationDialog.tsx` | Éditeur v3, hors des fichiers saturés | 2.6 |
| `src/lib/estimates/offer-contract-v2.ts` | Construction et analyse stricte de `ClientContract2` | 2.7 |
| `src/components/estimate-document/EstimateDocumentTotalsV3.tsx`, `src/lib/estimates/pdf-v3-totals.tsx` | Pied v3 : remise, arrondi, récapitulatif de TVA | 2.7 |
| `scripts/engine-v3/frozen-corpus.ts`, `scripts/engine-v3/document-fingerprints.ts`, `scripts/engine-v3/parity.ts`, `scripts/engine-v3/optima-lot-check.ts` | Preuves (§10) | 2.0, 2.4 |
| `e2e/army/local/engine-v3-*.e2e.ts`, ajoutés par 2.0 aux listes `critical` locale et `full` de `e2e.config.ts` (comme `tech-debt-lock-boundaries.e2e.ts`) ; `e2e/army/local/calc-v3.config.ts`, profil d'émission sur la pile possédée (§10.4) | Scénarios E2E sur la pile Supabase native jetable du dépôt : `npm run e2e:army:local` (`scripts/run-tester-army-ci.ts critical`, filtrable par `--grep`) et `npm run e2e:army:ci -- full` ; sous Windows, dans WSL depuis un clone Linux | 2.0 et suivants |

### 8.2 Fichiers existants modifiés

| Fichier:lignes | Changement | Sous-lot |
|---|---|---|
| `src/lib/estimates/calc-engine-version.ts:28-37`, `:45-90` | `resolveCalcEngineVersion` : 3 lève, 4 et plus lèvent, le reste ne change pas ; `hasFreshEstimateV2Snapshot` et `shouldPreserveStoredEstimateV2Snapshot` passent par `engineFreezesSnapshot` (résultat identique pour 1 et 2). `NEW_ESTIMATE_CALC_ENGINE_VERSION` reste 2 jusqu'en 2.10 (2.10b : 3, typé `EstimateEngineVersion`, moteur d'une politique absente ; la préparation v2 garde sa constante 2). | 2.1 |
| `calc-engine-version.test.ts:23` | « 3 → lève `EstimateEngineUnavailableError` » ; ajout de 4 → erreur | 2.1 |
| Les 49 sites de l'annexe A (hors moteur historique) | Prédicat ou aiguillage exhaustif ; branche v3 = `EstimateEngineUnavailableError` jusqu'au sous-lot qui l'implémente | 2.1, puis 2.5 à 2.8 |
| `eslint.config.mjs:107-126` | Sélecteur `no-restricted-syntax`, à ajouter aux deux blocs (celui de `src/app/api/**` remplace les options de celui de `src/**`), sur toute `BinaryExpression` `===`, `!==`, `==` ou `!=` entre un littéral 1, 2 ou 3 et `calcEngineVersion`, `engine`, `*.calc_engine_version`, `*.calcEngineVersion` ou `resolveCalcEngineVersion(…)`. Exemptés : `calc-engine-version.ts`, `engine/**`, `engine-v3/**`, `estimate-calculations.ts`, `estimate-v2-snapshot.ts`. | 2.1 |
| `src/lib/estimates/version-totals.ts:161-291`, `:293-443` | v3 : aucun barème, coefficients, contexte v3, façade | 2.5 |
| `src/lib/estimates/settings-atomic.ts:47-73` | aiguillage à 3 branches ; projections v3 ; `apply_tax_rate_to_lines` | 2.5 |
| `batch-preparation.ts:299`, `atomic-item-creation.ts:100`, `assembly-calculation.ts:52` | v3 : projections, h/u, `unit_code`, statut (ouvrages en 2.8) | 2.5, 2.8 |
| `canonical-v2-creation.ts:160-176`, `:520`, `:612` | moteur venant de la politique ; moteur attendu transmis ; coefficients par défaut ; colonnes v3 | 2.5 |
| `v2-snapshot-server.ts:77`, `server.ts:5467`, `:5558`, `send-estimate.ts:311`, `approval-v2-snapshot.ts:27` | gel selon le moteur (v3 → `v3-snapshot-server.ts`) | 2.5 |
| `effective-margin.ts:55-85`, `effective-discount.ts:86-113`, `fixed-discount-evidence-server.ts:75`, `:95`, `rules-engine.ts:1169-1199`, `direction/server.ts:942` | marque nette et remise exacte en v3 ; état « indisponible » au lieu de 0 | 2.5 |
| `src/lib/affaires/server.ts:2250-2269` | analyse de marge par moteur (v3 → façade) | 2.5 |
| `estimates/schemas.ts`, `src/lib/openapi/*`, `openapi.json` | champs v3 ; régénération et validation | 2.5, 2.7 |
| Listes `select` littérales : `server.ts:1808`, `:2700`, `:3611`, `:5971`, `calc-context.ts:41`, `v2-snapshot-server.ts:59`, `assembly-calculation.ts:27`, `atomic-item-creation.ts:32`, `server-context.ts:129`, `pdf-generator.tsx:114-116`, `[versionId]/page.tsx:152`, `direction/server.ts:498`, `:533` | ajout des colonnes v3 (coefficients, montants de version ; lignes : `unit_code`, `pricing_status`, `h_mo*_per_unit`, `snapshot_gross_*`) | 2.5 |
| `useEstimateEditorCalculation.ts:264`, `useEstimateEditorState.impl.tsx:541`, `:749`, `:1252`, `:1349`, `:1452-1493`, `:1825`, `:2808-2817`, `useEstimateEditorSyncController.ts:733` (fichier au plafond de 1 200 lignes non vides depuis l'extraction de `useEstimateEditorAutoSave.ts`) | branches v3 déléguées à `useEstimateV3Settings` ; la v3 n'envoie jamais de `discount_bp` dérivé ; v1/v2 inchangés | 2.6 |
| `EstimateSettingsPanel.tsx:324-335`, `:371-377`, `:404-435`, `:504` | v3 : coefficients sans repli à 0, repère de barème, remise en € ou en %, « demandé / appliqué », « TVA par défaut » et dialogue | 2.6 |
| `ColumnHeaderHelp.tsx:5-30`, `EstimateColumnsHelpPanel.tsx:285-292` | aides selon le moteur (v1/v2 : « heures totales de la ligne ») | 2.3, 2.6 |
| `EstimateEditorTable.tsx:1380`, `:1570-1577`, `:1789` | v3 : cellules déléguées à `V3LineCells` ; éligibilité de prix | 2.2, 2.6 |
| `useCatalogueSuggestions.ts:166-176` | prédicat de prix ; l'unité n'est plus remplacée par la désignation | 2.2 |
| `supplier-offer-eligibility.ts:4-30`, `server.ts:1054-1069`, `:1499-1523`, `:1579-1593`, `purchase-order-drafts.ts:278-282` | prédicat de prix ; « ML » = « ml » (puis normaliseur en 2.4) | 2.2 |
| `src/lib/numeric-input/parsers.ts` (créé par `d484c5a1` : `parseDecimalInput`, `formatDecimalInput`, `NUMERIC_INPUT_ERROR`, grammaire unique « D11 ») | étendu en 2.3 : parseurs par grandeur, en options ou enveloppes de `parseDecimalInput` (module existant, non recréé) | 2.3 |
| `money.ts:53-55`, `:94`, `NumberInput.tsx:17-27`, `editor-values.ts:28-39`, `clipboard.ts:61-171`, `:333-351`, `:437-498`, `:574-579`, `affaires/import-flow.ts:126-128`, `:165-173`, `:379-431`, `estimate-editor-row/shared.ts:254-263`, `EstimateEditorCommandBar.tsx:839-874`, `mappings/server.ts:780-892`, `mappings/schemas.ts` | parseurs par grandeur sur `parseDecimalInput` (grammaire unique déjà branchée dans ces fichiers par `d484c5a1`) ; convention de majoration ; heuristique d'en-têtes ; profil OPTIMA | 2.3 |
| `prepare-estimate-document-data.ts:148-260`, `:452-547`, `EstimateDocument.tsx:350-505`, `EstimateDocumentTableRows.tsx:104-214`, `pdf-generator.tsx:1465`, `:1619-1761`, `[versionId]/page.tsx:179`, `:285`, `print/page.tsx:176`, `:241` | v3 : lignes brutes, unité, statut, pied v3 | 2.7 |
| `estimate-seal.ts:10-13`, `:125-286`, `offer-document.ts:99-133`, `offer-contract.ts:330`, `server.ts:5666-5727` | charge 6 ; contrat 2 ; vérification | 2.7 |
| `export-stream.ts:420-485`, `dpgf-export.ts:344`, `:358-360`, `editor-export.ts:382`, `:398-438`, `bdc-export.ts` | v3 : unité, h/u, PU et PT bruts, remise, TVA par taux ; base des heures dans l'en-tête | 2.7 |
| `affaires/import-flow.ts:342-426`, `clipboard.ts`, `server.ts:2218-2264`, `generated-ouvrages.ts:1674-1728`, `generated-ouvrage-labor-hours.ts:11-40`, `assemblies-server.ts`, `templates-server.ts`, `src/lib/takeoff/server.ts:3419`, `:3839` | chemins d'entrée v3 ; refus nommé du métré | 2.8 |
| `docs/metier/regles-de-calcul.md`, `cycle-de-vie.md`, `glossaire.md`, `CONTEXT.md:10-18`, `AGENTS.md` (invariants de calcul) | section moteur 3, sur décision du porteur | 2.10 |

---

## 9. Garde-fous contre une égalité résiduelle au moteur 2

1. **Types** : `CalcEngineVersion` (1|2) pour le moteur historique, `EstimateEngineVersion` (1|2|3) partout
   ailleurs. Un aiguillage `switch` exhaustif avec `assertNever` impose de traiter le 3.
2. **Résolveurs** : `resolveCalcEngineVersion(3)` lève une erreur ; `requireEstimateEngineVersion` exige la
   présence du champ sur les chemins contractuels (F4).
3. **ESLint** (`--max-warnings=0`) : comparaisons de littéraux interdites, champs bruts compris (§8.2).
4. **pgTAP** : liste blanche revue des fonctions qui comparent un `*engine_version` à un littéral (§7).
5. **Contrat d'écrivain** : tout écrivain SQL non adapté échoue fermé sur une v3 (D2).

---

## 10. Validation et preuves

### 10.1 Commandes par sous-lot

- `npx eslint <fichiers>`, `npm run typecheck`, `npm test -- <fichiers>` (projets `node` et `jsdom`),
  `npm run check:architecture`.
- `npm run generate-openapi && npm run validate-openapi` si une route ou un schéma change.
- `npm run supabase:validate` et `npm run supabase:manifest:add`.
- `git diff --check`, `git diff --stat` et `git ls-files --eol` sur les fichiers touchés ; `git diff --stat`
  vide sur `estimate-calculations.ts` et `estimate-v2-snapshot.ts`.
- SQL et RLS : `npm run db:ci:local`, une exécution à la fois, dans WSL depuis un clone Linux propre (le
  runtime natif refuse Windows : `src/test/local-supabase-ci.ts:51-56`). La commande crée un projet jetable
  dans le répertoire temporaire, sur des ports libres alloués à chaque exécution, lance `db reset`, vérifie
  l'inventaire des migrations, exécute **toutes** les suites de `supabase/tests/database` (aucune sélection),
  puis la matrice RLS, et détruit la pile (`:686-767`). Journal : sa sortie, conservée par sous-lot (via
  `npm run e2e:army:local` : `database.log` sous `.e2e/army/ci/<horodatage>-<suite>/`). La pile longue des
  recettes locales (API 45585, base 33485) n'est jamais touchée : seule la pile possédée est détruite.
- Rejouer à chaque sous-lot : corpus figé, empreintes documentaires et, à partir de 2.1, test de montée de
  version.

### 10.2 Test de montée de version sur base peuplée (préparé en 2.0, exécuté à chaque migration)

- Pilote : sans équivalent dans le dépôt (`db:ci:local` repart toujours de zéro avec toutes les migrations).
  2.0 crée `scripts/engine-v3/upgrade-check.ts <libellé>` sur le modèle de `runLocalSupabaseCi`
  (`src/test/local-supabase-ci.ts:652`) : projet isolé jetable, ports libres, runtime natif, destruction en
  `finally`, lancé dans WSL comme `db:ci:local`.
- Fichiers SQL versionnés : `supabase/tests/upgrade/lot2-fixture.sql` et `lot2-compare.sql`. Ils sont hors
  de `supabase/tests/database`, donc hors de pgTAP.

Étapes :
1. Copier les migrations **jusqu'à la dernière migration publiée avant le lot 2** (à `98408ef0` :
   `20261015190000_scope_takeoff_recalculation_safeupdate.sql` ; `20261014172511` relève du lot 1 archivé et
   n'est pas dans l'arbre suivi, mais peut subsister en fichier non suivi dans la copie de travail Windows, voir
   2.0 : copier depuis un checkout propre) et lancer `db reset`.
2. Charger la fixture en tant que `postgres` :
   - une v1 envoyée et scellée ;
   - une v2 envoyée avec contrat client 1, sceau 5, document et envoi ;
   - une v2 brouillon à remise fixe ;
   - une v2 brouillon à paliers ;
   - une v1 brouillon ;
   - une offre à 0 € ;
   - un modèle.
   `session_replication_role = replica` est utilisé uniquement pour l'historique synthétique, et la
   fixture le dit.
3. Enregistrer `to_jsonb` de chaque ligne (versions, lignes, documents, envois, jetons de portail, offres,
   modèles), ainsi que le résultat de `estimate_offer_document_valid` et des contrôles SQL existants.
4. Copier les migrations du lot 2 et lancer `supabase migration up --local` (à vérifier sur le runtime
   natif ; repli : `psql -f` de chaque migration dans l'ordre, à consigner). `migration up` n'est pas dans la
   liste blanche du harnais (`assertLocalOnlySupabaseArgs`, `src/test/supabase-cli.ts:103-190`) : 2.0 l'y
   ajoute, limitée au répertoire isolé, ou retient le repli avec le `psql` natif résolu par le harnais.
5. Comparer : lignes identiques, nouvelles colonnes retirées de la comparaison ; nouvelles colonnes à leur
   valeur neutre ; résultats de validité identiques.
6. **Contrôle négatif** : une mise à jour d'une ligne, appliquée hors migration, doit faire échouer la
   comparaison. Cela prouve la sensibilité du harnais.

### 10.3 Corpus figé et empreintes (2.0)

- `scripts/engine-v3/frozen-corpus.ts` : graine fixe, 300 devis v1 et 300 devis v2 (remises historiques et
  fixes, cascade, autoliquidation, multi-taux, ventilation atelier/chantier, quantités décimales). Sorties
  dans `src/test/fixtures/engine-frozen-corpus.json`. Test `src/lib/estimates/engine-frozen-corpus.test.ts`.
- `scripts/engine-v3/document-fingerprints.ts` : sur une pile locale jetable (crochet `runApplication` de
  `runLocalSupabaseCi`, qui reçoit l'URL PostgreSQL locale et `psql` ; origine en boucle locale, aucun secret
  affiché), SHA-256 de `prepareEstimateDocumentData`
  (`src/components/estimate-document/prepare-estimate-document-data.ts:431`), de l'export analysé et des hash
  de sceau du corpus v1/v2. Sorties `before.json` et `after.json` comparées.

### 10.4 Infrastructure E2E (TesterArmy 0.21.0, sur la pile locale du dépôt)

Dans tout le document, « pile locale » désigne la pile Supabase native jetable du dépôt (`63ecf893`) :
`npm run e2e:army:local` (sélection critique), `npm run e2e:army:ci -- full` et `npm run dev:army`
(développement interactif), pilotés par `scripts/run-tester-army-ci.ts` et `src/test/local-supabase-ci.ts`,
lancés dans WSL depuis un clone Linux propre, une exécution à la fois. Elle remplace la pile d'audit 573xx et
les scripts du dossier temporaire de l'auditeur. Version TesterArmy : `e2e` 0.21.0 / `@e2e-dev/web` 0.15.0.

- Nouveau profil `e2e/army/local/calc-v3.config.ts`, sur le modèle de `offer-emission.config.ts`. Il exige
  des origines explicites en boucle locale, celles de la pile jetable possédée (ports alloués à chaque
  exécution) ; il refuse l'API 45585 et la base 33485 de la pile longue des recettes locales
  (`scripts/tester-army/run-offer-local.mjs:89`). Il active le collecteur d'e-mails sentinelle et les
  conditions bac à sable uniquement pour cette origine. `offer-emission.config.ts` n'est pas modifié.
  À `98408ef0`, ces conditions ne s'ouvrent en build de production que pour la suite `offer` sur
  `127.0.0.1:45585` (`canUseDevelopmentEstimateTerms`, `src/lib/estimates/pdf-terms-server.ts:4`, `:21-34`),
  et en mode développement sans condition d'origine (`:23`). En 2.0, le profil sert donc l'application en
  mode développement (`next dev`, comme le mode `dev` du profil d'offre), sans changement de code applicatif.
  L'extension de ce garde à la pile possédée en build de production change un comportement : elle est livrée
  en 2.7, avec son test de garde-fou (activation pour la pile possédée et le profil `calc-v3` seulement,
  jamais avec un marqueur d'hébergement ; cas `offer` sur 45585 inchangé). `run-tester-army-ci.ts`
  n'accepte que `critical|full|dev` (`:14-16`) : 2.0 lui ajoute une suite qui lance ce profil sur sa pile.
- Application construite et servie par `scripts/run-tester-army-ci.ts` depuis un clone Linux propre (build
  `scripts/tester-army/build-local.mjs`, origine `http://localhost:<--app-port>`, 3107 par défaut) ;
  environnement généré en mémoire (`createLocalCiEnvironment`, `src/test/supabase-cli.ts:209`), fichiers
  `.env`/`.env.local` refusés (`run-tester-army-ci.ts:299-301`), valeurs jamais affichées. `npm run dev:army`
  sert la même pile en développement interactif.
- Données : entreprise de recette créée à chaque exécution par `run-tester-army-ci.ts:109-147` (compte neuf,
  entreprise personnelle administrée, taux MO de 4 000 c, article `ARMY-CU22-ML`), affaires
  `ARMY-L2-<sous-lot>-<run>`, politique d'entreprise posée par `set_tenant_calc_policy` (service local), à
  ajouter à ce provisionnement dès que M4 la crée (2.5).
- Chaque exécution archive sous `.e2e/army/ci/<horodatage>-<suite>/` (manifeste de `run-tester-army-ci.ts` :
  commande, révision et empreinte des changements locaux, migrations, environnement sans secret, identités
  des fixtures, journaux, empreintes, contrôle de confidentialité) et sous `runs/<horodatage>/` du wrapper ;
  les scénarios y ajoutent valeurs attendues et obtenues (`recordEvidence`, `e2e/army/critical/fixtures.ts:104`).
  Un test ignoré ou une préparation en échec est une preuve manquante.
- **TesterArmy `e2e` 0.21.0 / `@e2e-dev/web` 0.15.0 (Playwright 1.64.0 embarqué), publié dans `d484c5a1`** :
  les preuves SDK sont sous `<output>/results/<test>/[rerun-<n>/]attempt-<n>/` (téléchargements, captures)
  avec une page `trace.md` par résultat (en critique, résultats anonymes seulement : traces authentifiées
  désactivées) ; le wrapper vide `<output>/artifacts` avant chaque exécution et archive `results/` et
  `artifacts/` dans `runs/<horodatage>/`. Les observateurs de requêtes
  utilisent `route.fallback()` (garde-fou `src/test/ci-guardrails.test.ts:113-140`) ; seul le garde de campagne
  « **/* » décide `continue()`, et tout nouveau garde (profil `calc-v3`) doit être déclaré dans
  `ARMY_ROUTE_GUARD_CONTINUES` (`:127`). Les téléchargements se résolvent depuis
  `waitForDownload().absolutePath` avec `resolveDownload` / `sdkResultsRoot` (`e2e/army/critical/fixtures.ts:125`,
  `e2e/army/local/sdk-results.ts:13`).
- **Fiche article et popover** : à `98408ef0`, la fiche « Associer ou remplacer l'article » s'ouvre sous
  TesterArmy 0.21.0 dans le scénario critique `e2e/army/critical/estimate-integrity.e2e.ts:435-461`, compris
  dans la sélection de `npm run e2e:army:local` (`e2e.config.ts:89`). Le 14/10, elle avait été vue ouverte en
  0.20.0 sur la pile d'audit, avec le lot 1 : cette version n'a jamais été publiée dans le dépôt (`28ccc857` :
  `e2e` 0.15.2 ; `d484c5a1` : 0.21.0). Le scénario d'unité exige un article catalogue d'unité ≠ désignation ;
  `run-tester-army-ci.ts:142-146` le sème déjà (`ARMY-CU22-ML`, unité `ml`).
  `e2e/army/local/article-association.e2e.ts` n'a aucun profil versionné (il se lance par un script local non
  versionné, `docs/testing/rls-required-check.md:149-157`) : il ne compte pas comme preuve tant qu'il n'est
  pas branché. Aucun parcours Army ne traverse le popover de suggestion de l'éditeur : le scénario A7 qui le
  traverse (2.2) doit être écrit rouge d'abord.
- Base E2E de départ, à remesurer en 2.0 puis à rejouer en fin de chaque sous-lot : `npm run e2e:army:local`
  (sélection critique sur pile jetable possédée ; sur une base locale, `e2e.config.ts:14`, `:89` y ajoute
  `tech-debt-lock-boundaries`) et `npm run e2e:army:ci -- full` (production puis développement). La
  sélection critique est passée de 7 à 16 fichiers depuis `28ccc857`. L'archive 13/13 du 14/10
  (`.e2e/army/critical/runs/isolated-local-2026-10-14/`, 0.20.0, base `28ccc857` + lot 1) est locale à ce
  poste, non versionnée (`.gitignore:17`) et absente du patch archivé : elle reste historique.
  Référence des développeurs : 122/122 en production et 4/4 en développement sur la pile native locale, pour
  l'arbre publié par `a25b5c40` (message du commit ; candidat 15, `docs/testing/army-migration.md:249-251`).
  Les campagnes GitHub qui ont suivi sont rouges : critique 63/64 et complète 121/122 sur `a25b5c40`
  (`army-migration.md:257-266`), complète 121/122 sur `40ffb876` (`docs/testing/tester-army-dpgf-review.md:16-19`).
  `98408ef0` corrige le scénario DPGF en cause, rejoué seul (2/2, `tester-army-dpgf-review.md:80`), sans
  campagne complète documentée. SQL 1 253 assertions et RLS 2/2 (`docs/testing/tester-army-ci.md:244`). La
  base E2E à `98408ef0` reste donc inconnue jusqu'à la remesure de 2.0.

---

## 11. Risques

| Id | Risque | Gravité | Parade |
|---|---|---|---|
| R1 | Une v3 traitée comme une v1 par un site oublié, TS ou SQL | Critique | D1, D2, §9 ; 2.1 livré avant toute création |
| R2 | Retour arrière applicatif sous 2.1 après création d'une v3 | Critique | Ordre de déploiement ; la politique est le verrou ; une v3 n'est créée qu'à partir de 2.10 |
| R3 | Divergence d'arrondi TS/SQL | Élevée | Décimal exact des deux côtés ; parité sur 10 000 tirages ; vecteurs partagés |
| R4 | Nouvelle colonne absente de la liste de `content_revision` : gel périmé jugé frais | Critique | Ajout explicite ; une assertion pgTAP par colonne |
| R5 | Champ v3 hors du sceau | Élevée | Charge 6 ; test « chaque champ v3 change l'empreinte » |
| R6 | Copie d'heures totales vers une v3 (×Q) | Critique | Colonnes par unité ; refus par déclencheur ; conversions explicites (D16) |
| R7 | Collision de numérotation du sceau | Élevée | Marqueur 5 inchangé, charge 6, contrat 2 (D14) |
| R8 | Redéfinition de grosses fonctions qui introduit une régression | Élevée | Contrat d'écrivain au lieu de refus copiés ; diff `pg_get_functiondef` limité ; les suites pgTAP de la référence mesurée en 2.0 |
| R9 | Lot 1 archivé, non publié (patch dans `docs/audit-independant-2026-10-14/lot1/`) ; une reprise toucherait les mêmes fichiers (`estimates/server.ts`, `useEstimateEditorState.impl.tsx`, `schemas.ts`, `client.ts`) | Faible | Plus de dépendance : le lot 2 part de `98408ef0`. Toute reprise du patch se réapplique sur l'état courant et réhorodate sa migration S-09 |
| R10 | Budgets saturés (`EstimateEditorTable.tsx` : 40 lignes de marge) | Moyenne | Nouveaux composants v3 |
| R11 | Écart de total avec les offres OPTIMA (+4,09 € sur les 7 lignes ; +45,24 € et +12,09 € sur les lots) | Faible, certaine | Effet voulu de A4 ; accepté par le porteur le 16/10 (P-03) |
| R12 | Validité fiscale de la TVA par taux et de l'arrondi en remise | Élevée | Avis de l'expert-comptable requis avant tout usage client réel (politique 3 pour l'entreprise du porteur, 2.10), pas avant le développement (P-06, P-07 ; décision du 16/10) |
| R13 | Données du client dans un dépôt public | Élevée | Aucune nouvelle donnée versionnée (§5.6) |
| R14 | Déploiement automatique de `main` (S-05) : code et migrations désynchronisés | Élevée | Chaque sous-lot est inerte sans politique ; une migration précède le code qui l'utilise ; échec fermé |
| R15 | Précision `numeric(12,4)` des heures dérivées (÷ `default_quantity`) | Moyenne | Refus si non représentable ; jamais d'arrondi silencieux |
| R16 | Changement de convention de majoration perçu par les utilisateurs v2 | Moyenne | Convention actuelle conservée ; « +x % » non retenu (P-11, validée le 16/10/2026) |
| R17 | Taux horaires attachés au propriétaire (U-01) | Moyenne | Hors lot (arbitrage 10) ; le pilote définit les rôles du propriétaire |

---

## 12. Points de décision

★ = la décision conditionne un test d'exigence et doit être prise avant le sous-lot indiqué.

**Décision du porteur (16/10/2026)** : P-01 à P-19 validés tels que proposés ci-dessous (colonne « Statut ») ;
aucun sous-lot n'est plus bloqué par une décision ★. L'avis de l'expert-comptable sur P-06 et P-07 reste requis
avant tout usage client réel, pas avant le développement. Les 14 arbitrages du rapport d'audit (§6 du rapport,
`docs/audit-independant-2026-10-14/rapport-audit-independant.pdf`) sont eux aussi validés tels que proposés par
l'auditeur (registre : colonne `decision_porteur` de `registre-audit.csv`).

**Décisions du 18/10/2026 (sous-lot 2.10)** : la migration M8 (politique absente = moteur 3) est **approuvée par
le porteur** ; D-a à D-k sont prises par le coordinateur sous délégation explicite du porteur. Texte, portée et
suites : `docs/testing/estimate-engine-v3-2.10.md` §2. Cette approbation n'autorise ni l'application de M8 au
Supabase partagé ni un déploiement (autorisations distinctes, §10 du cahier 2.10).

| Id | Question | Proposition | Avant | Statut |
|---|---|---|---|---|
| P-01 ★ | Heures par unité en v3 ; conversion d'un modèle v1/v2 (h / Q) | Oui ; Q = 0 avec h > 0 → refus nommé | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-02 ★ | Coefficients de vente par défaut et leur emplacement | 1,30 / 1,20 dans la politique ; pas de coefficient par ligne | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-03 ★ | Total = Q × PU affiché ; écarts avec les offres OPTIMA | Accepter (+0,08 / +4,56 / −0,56 / +0,01 € ; lots §5.4) | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-04 | Taux dérivé réécrit en v2 | Laissé tel quel (sans effet sur les montants) | — | Validé le 16/10/2026 (proposition retenue) |
| P-05 ★ | Remise : montant ou % (2 décimales), plafonnée, « demandé / appliqué », ligne distincte | Oui | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-06 ★ | Arrondi commercial | Remise HT vers le bas ; option : TTC rond (à quelques centimes près avec plusieurs taux). **Expert-comptable** | 2.4 ; avis avant usage client réel (2.10) | Validé le 16/10/2026 : remise HT vers le bas retenue ; l'option TTC rond n'est pas livrée par le lot 2 (D7, CHECK `rounding_mode in ('none','down')` du §6.2, §13) ; avis de l'expert-comptable requis avant usage client réel (non bloquant pour le développement) |
| P-07 ★ | Arrondi et TVA par taux ; taux autorisés | Demi supérieur ; TVA par taux après remise ; 20 / 10 / 5,5 / 2,1 %. **Expert-comptable** | 2.4 ; avis avant usage client réel (2.10) | Validé le 16/10/2026 (proposition retenue) ; avis de l'expert-comptable requis avant usage client réel (non bloquant pour le développement) |
| P-08 ★ | Référentiel d'unités | `m` = `ml` ; pas de millilitre ; `ens` ≠ `fft` ; pouce sans conversion | 2.2 | Validé le 16/10/2026 (proposition retenue) |
| P-09 ★ | Statuts | HL, PM, NC, inclus (inc, CP), SO ; montant 0 ; libellé imprimé | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-10 | Précision du PR FO | Centime (95,625 → 95,63, comme les offres) | 2.4 | Validé le 16/10/2026 (proposition retenue) |
| P-11 | Convention de majoration | Actuelle : « Majoration MO (%) », 100 = neutre. « +x % » seulement avec signature et E2E de transition | 2.3 | Validé le 16/10/2026 (proposition retenue) |
| P-12 | Modèles et ouvrages v1/v2 insérés dans une v3 | Conversion avec rapport ; refus si ambigu | 2.8 | Validé le 16/10/2026 (proposition retenue) |
| P-13 | Qui active le moteur 3 | L'équipe (service) pendant le pilote, puis les administrateurs | 2.5 | Validé le 16/10/2026 (proposition retenue) : `service_role` seul pendant le lot 2 (D3) ; l'ouverture aux administrateurs vient après le pilote, hors lot 2 (§13) |
| P-14 | Structure IA et version zéro en v3 | Refusées pendant le lot 2, sauf besoin du pilote | 2.8 | Validé le 16/10/2026 (proposition retenue) |
| P-15 | Brouillons v2 existants | Restent v2 ; pas de conversion | — | Validé le 16/10/2026 (proposition retenue) |
| P-16 | Import OPTIMA vers une v1/v2 : heures par unité × Q, avec aperçu | Oui (corrige C-01 sans changer de montant stocké) | 2.3 | Validé le 16/10/2026 (proposition retenue) |
| P-17 | Qui marque une offre « inclus / gratuit » | Administrateur du catalogue | 2.2 | Validé le 16/10/2026 (proposition retenue) |
| P-18 | Unité d'achat et conditionnement dans le lot 2 | Option 2.9 | 2.9 | Validé le 16/10/2026 : 2.9 est planifié dans le lot 2, puisque l'arbitrage 6 validé comprend la conversion vers l'unité d'achat ; il ne conditionne pas 2.10 (lecture de l'auditeur, à confirmer par le porteur s'il préfère reporter 2.9 hors du lot 2) |
| P-19 | Métré sur une v3 | Refusé (arbitrage 13) | — | Validé le 16/10/2026 (proposition retenue) |

---

## 13. Hors périmètre

Sous-détail d'ouvrage (arbitrage 14 ; les heures par unité et le PU arrondi en sont les préalables) ; taux
horaires par entreprise (arbitrage 10) ; seuil et forçage d'approbation (arbitrage 9) ; validité des offres
fournisseurs (arbitrage 8 : plafond de 6 mois, date de fin propre à l'offre, alerte 30 jours avant
l'échéance) ; option « TTC rond » de P-06 ; activation du moteur 3 par les administrateurs d'entreprise
(P-13, après le pilote ; pendant le lot 2, `service_role` seul) ; pertes, rendements, indices ; doubles
quantités atelier/chantier, options et réserves des DPGF clients (seulement signalées) ; conversion v2 → v3 ;
métré v3.

---

## 14. Sous-lots ordonnés, prêts à être implémentés

Règle commune (AGENTS.md, Testing Policy) : avant le code, on écrit dans
`docs/testing/estimate-engine-v3-<sous-lot>.md` les défaillances observables et les scénarios E2E qui les
révèlent. Les tests d'exigence sont montrés **rouges** (journal conservé), puis verts. Les tests isolés ne
couvrent que ce qu'un E2E ne peut pas reproduire : demi-centimes, 10 000 tirages, parité TS/SQL, intégrité
SQL, cas limites des parseurs. Leur justification est écrite. Chaque sous-lot rejoue §10.1.
Travail sur `main` par petits commits (décision du porteur du 16/10/2026), dans un worktree si une tâche risque
une collision ; la revue humaine obligatoire (Q12) s'applique à chaque commit avant publication ; aucune
migration distante sans autorisation explicite.

### 2.0 — Ligne de base et harnais de preuve (aucun changement de comportement)

- **Base** : `98408ef0` (sous-lot recalé le 16/10/2026). Corpus figé, goldens (état `98408ef0`), ligne de base
  pgTAP et E2E se mesurent sur un checkout propre de ce commit, dans WSL depuis un clone Linux. La copie de
  travail Windows garde des restes non suivis du lot 1 (`supabase/migrations/20261014172511_…sql`,
  `supabase/tests/database/tenant-membership-boundaries.test.sql`, `src/lib/auth/self-signup*.ts`,
  `src/lib/estimates/force-send-policy*.ts`, `HomeLanding.tsx`, `LoginView.tsx`, `SignupForm.tsx`) qui faussent
  les contrôles d'inventaire (`npm run supabase:validate`, `db:ci:local` : 14 fichiers pgTAP au lieu de 13) ;
  les retirer de l'arbre (ils sont conservés dans le patch archivé) ou travailler depuis un clone ou un
  worktree propre.
- **Périmètre** :
  - `scripts/engine-v3/frozen-corpus.ts` et `src/test/fixtures/engine-frozen-corpus.json` ;
  - `src/lib/estimates/engine-frozen-corpus.test.ts` ;
  - `scripts/engine-v3/document-fingerprints.ts` ;
  - `supabase/tests/upgrade/lot2-fixture.sql` et `lot2-compare.sql` ;
  - `scripts/engine-v3/upgrade-check.ts`, à créer : le dépôt n'a pas d'équivalent (`npm run db:ci:local` applique
    toutes les migrations d'un coup) ; il reprend le socle de `src/test/local-supabase-ci.ts` (projet isolé, ports
    hors plage éphémère, `supabase start --runtime native`, `stack destroy` en `finally`) ;
  - branchement des parcours du lot 2 sur `npm run e2e:army:local` (`scripts/run-tester-army-ci.ts critical`),
    dont la sélection ne prend aujourd'hui que `e2e/army/critical/**` et `tech-debt-lock-boundaries.e2e.ts`
    (`e2e.config.ts:89`) ; ce lanceur n'a pas de collecteur d'e-mails (`RESEND_API_KEY` vide), d'où le
    profil d'émission ci-dessous ;
  - profil d'émission `e2e/army/local/calc-v3.config.ts` (§10.4), servi en mode développement (`next dev`) :
    `canUseDevelopmentEstimateTerms` y accepte déjà les conditions bac à sable
    (`src/lib/estimates/pdf-terms-server.ts:23`), donc aucun code applicatif ne change ; l'extension de ce
    garde au build de production de la pile possédée est livrée en 2.7 ;
  - suite dédiée dans `scripts/run-tester-army-ci.ts`, qui n'accepte aujourd'hui que `critical|full|dev`
    (`:14-16`), pour lancer ce profil sur la pile possédée ;
  - collecteur sentinelle `scripts/tester-army/offer-collector.mjs` branché sur cette suite, comme dans
    `e2e/army/local/offer-emission.config.ts:8`, `:22-23` ;
  - aide d'extraction du texte des PDF (`pdfjs-dist`, déjà en dépendance) sur la pièce jointe archivée par le
    collecteur ; `reproductions/outils/pdf-text.mjs` ne lit que la pile de l'audit ;
  - déclaration de tout garde de route du profil `calc-v3` dans `ARMY_ROUTE_GUARD_CONTINUES`
    (`src/test/ci-guardrails.test.ts:127`) ;
  - `docs/testing/estimate-engine-v3-2.0.md` (modes de défaillance du §1 et de §11, scénarios §5).
- **Tests d'exigence d'abord** :
  - test du corpus figé, vert par construction ;
  - contrôle négatif du harnais de montée de version, rouge sur une altération volontaire ;
  - empreintes `before.json` enregistrées.
- **Migration** : aucune.
- **E2E sur la pile locale** (pile jetable possédée par `scripts/run-tester-army-ci.ts` : `npm run e2e:army:local`,
  `npm run dev:army` en interactif) : rejouer et archiver `estimate-totals-order`,
  `estimate-batch-atomic`, `estimate-create-atomic`, `commercial-rounding`, l'émission d'offre, `dpgf-import`
  et `generated-ouvrage-*` ; consigner les valeurs de base. À `98408ef0`, seuls `commercial-rounding` et
  `dpgf-import` (`e2e/army/critical/`) entrent dans la sélection de ce lanceur ; les parcours de
  `e2e/army/local/` n'ont qu'un profil `coverage` (`e2e.config.ts:89`) ou aucun profil versionné
  (`estimate-totals-order`), et l'émission passe par `e2e.offer.config.ts` : 2.0 les branche sur la pile possédée.
- **Acceptation** :
  - corpus de 600 devis généré **avant toute modification** du code ;
  - pgTAP de base remesurée par `npm run db:ci:local` (référence à `98408ef0` : 13 fichiers, 1 253 assertions,
    PASS, relevés par les développeurs ; la quatorzième suite du relevé du 14/10,
    `tenant-membership-boundaries.test.sql`, appartient au lot 1 archivé) ;
  - montée de version : 0 différence sans migration nouvelle, et différence détectée par le contrôle
    négatif ;
  - aucun parcours sur 45585 ni 33485 (pile des développeurs) : la pile possédée alloue ses ports hors de la
    plage éphémère de l'hôte et hors des ports occupés (`src/test/local-supabase-ci.ts:170-196`) ; le profil
    `calc-v3.config.ts` les refuse explicitement (vérifié) ;
  - émission d'offre de base rejouée et archivée par la nouvelle suite, sur la pile possédée en mode
    développement : e-mail reçu par le collecteur sentinelle, texte du PDF joint relu par l'aide d'extraction ;
  - `src/test/ci-guardrails.test.ts` vert, garde du profil déclaré ;
  - aucun fichier applicatif modifié : seuls des tests, scripts, fixtures, profils E2E et documents.
- **Dépendances** : aucune. Le lot 1 n'est plus un préalable : non publié, il est archivé dans
  `docs/audit-independant-2026-10-14/lot1/` (décision du porteur du 16/10/2026 ; sécurité hors périmètre pour
  l'instant).

### 2.1 — Socle fermé par défaut (lecteur avant écrivain)

- **Périmètre** :
  - M1 ;
  - `calc-engine-version.ts` et son test ;
  - `src/lib/estimates/engine/capabilities.ts` et `engine/compute.ts` ;
  - les 49 sites de l'annexe A hors moteur historique (aiguillage, branche v3 = erreur nommée) ;
  - `eslint.config.mjs` ;
  - bandeau de lecture d'une v3 dans `[versionId]/page.tsx` et dans l'éditeur (`[versionId]/edit/page.tsx`,
    `EstimateEditorPage`) ;
  - `src/types/database.ts`.
- **Tests d'exigence d'abord** :
  - pgTAP `supabase/tests/database/estimate-calc-engine-v3-guards.test.sql` (au moins 35 assertions), avec
    une fixture v3 insérée par `postgres`. Rouge par étapes : avant M1, l'insertion échoue sur le CHECK ;
    avec le CHECK seul élargi (étape locale, non conservée), les assertions 3 à 9 échouent ; avec M1,
    tout passe. Assertions :
    1. moteur 4 refusé ;
    2. aucune RPC ne crée de v3 (`persist_estimate_creation_atomic` avec moteur 3 → refus ; contrat
       `canonical_v2` → 2) ;
    3. lignes d'une v3 envoyée immuables ;
    4. changement de propriétaire avec rôles incohérents refusé ;
    5. rôle MO utilisé par une v3 non modifiable ;
    6. changement de taux horaire invalidant le gel d'une v3 ;
    7. revue refusée sans gel frais ;
    8. passage à `sending` ou `sent` → `ESTIMATE_V3_EMISSION_NOT_READY` ;
    9. document d'une v3 → `ESTIMATE_V3_EMISSION_NOT_READY` ;
    10. écritures v3 par `commit_estimate_batch`, `atomic_create_estimate_item`,
        `bulk_update_estimate_items`, `save_estimate_settings_atomic`, `commit_generated_ouvrages`,
        `finalize_estimate_assembly_calculation`, insertion d'ouvrage, `recalculate_takeoff_estimate_version`,
        `apply_takeoff_job_atomic`, `insert_estimate_template_into_version`, structure IA, version zéro et
        mise à jour directe → `ESTIMATE_V3_WRITER_NOT_SUPPORTED`, rien d'écrit ;
    11. duplication d'une v3 refusée ;
    12. gels v2 refusés sur une v3 (inchangé) ;
    13. `list_approval_queue` → marge NULL ;
    14. garde `prosrc` sur liste blanche.
  - Réécriture délibérée de `estimate-calc-engine-governance.test.sql` :
    - `:656` devient « rejects calculation engine version 4 » ;
    - aux lignes `:852` et `:871`, la recherche du texte `version.calc_engine_version = 2` est remplacée par
      une assertion de comportement sur la v3 ; les autres contrôles structurels sont conservés ;
    - `:1086` reste inchangé.
  - Vitest, isolation justifiée par une frontière d'intégrité ouverte : `calc-engine-version.test.ts`
    (3 → erreur, 4 → erreur, champ absent → `requireEstimateEngineVersion` lève) ; publication, envoi,
    approbation, sceau et réglages d'une v3 → `EstimateEngineUnavailableError`.
- **Migration** : M1.
- **E2E sur la pile locale** (`engine-v3-fail-closed.e2e.ts`, fixture `ARMY-L2-V3-FIXTURE-<run>` insérée
  par SQL en `postgres` via le transport réservé aux parcours, `E2E_ARMY_LOCAL_DB_URL` / `E2E_ARMY_LOCAL_PSQL` :
  `scripts/run-tester-army-ci.ts:173-177`, modèle `e2e/army/takeoff/generated-prerequisites.ts`) :
  - ouverture de l'éditeur : bandeau « Ce devis utilise le moteur de calcul 3, pas encore disponible pour
    cette action », aucun total v1 affiché ;
  - tentative d'envoi : message nommé, statut inchangé en base ;
  - parcours v1/v2 de 2.0 : valeurs identiques à la base.
- **Acceptation** :
  - 0 site TS hors liste blanche (ESLint) ;
  - 0 fonction SQL hors liste blanche (pgTAP) ;
  - les suites de la référence mesurée en 2.0 et la nouvelle suite vertes, sans autre régression ;
  - corpus figé et empreintes identiques ; montée de version : 0 différence ;
  - `git diff --stat` vide sur les deux fichiers moteur.
- **Dépendances** : 2.0. Le lot 1, archivé et non publié, n'est plus un préalable (décision du porteur du
  16/10/2026).

### 2.2 — Offre à 0 € (A7) et « ML » = mètre linéaire (tous moteurs, règle d'entrée)

- **Périmètre** :
  - M2 ;
  - `supplier-offer-price.ts` ;
  - `supplier-offer-eligibility.ts:4-30` ;
  - `estimates/server.ts:1054-1069`, `:1499-1523`, `:1579-1593` ;
  - `useCatalogueSuggestions.ts:166-176` (prédicat ; l'unité n'est plus écrasée) ;
  - `EstimateEditorTable.tsx:1570-1577` ;
  - `purchase-order-drafts.ts:278-282` ;
  - case « Inclus / gratuit » sur la fiche d'offre ;
  - `src/types/database.ts`.
- **Tests d'exigence d'abord** :
  - pgTAP `supplier-offer-eligibility.test.sql`, rouge sur l'existant :
    - `catalogue_products_page` et `catalogue_products_summary` ne retiennent jamais une offre à 0 € non
      marquée comme prix minimal ;
    - `create_estimate_purchase_order_drafts` refuse une offre à 0 € non marquée et accepte « ML » contre
      « ml » ;
    - `zero_price_kind` est refusé si le prix > 0 ;
    - prix de référence inchangé.
  - Vitest : T-Z, T-UNIT2 (« ML » contre « ml »), `rules.audit.test.ts:98` et `:101` transposés en
    exigences.
- **Migration** : M2.
- **E2E sur la pile locale** (`supplier-offer-zero-price.e2e.ts`) :
  - article avec une offre à 0 € et une à 12,40 € : « meilleur prix » 12,40 € ; présélection 12,40 € ;
    popover : 12,40 € appliqué et unité de la ligne conservée (relue en base) ;
  - offre à 0 € marquée « Inclus » : applicable et libellée ;
  - brouillon de commande d'une ligne en « ML » avec une offre en « ml » : accepté.
  - La fiche article s'ouvre sous TesterArmy 0.21.0 à `98408ef0` (`estimate-integrity.e2e.ts:435-461`,
    sélection critique de `npm run e2e:army:local`) : ce scénario la traverse par le même chemin.
    `article-association.e2e.ts` ne compte pas comme preuve tant qu'il n'a pas de profil versionné (§10.4).
  - Popover de suggestion : aucun E2E à `98408ef0` ; ce scénario est le premier, écrit rouge d'abord.
- **Acceptation** :
  - 6 chemins sur 6 refusent une offre à 0 € non marquée (6 par E2E, fiche article comprise) ;
  - 0 refus « Unité différente du devis » entre ML, ml et m ;
  - corpus figé et empreintes identiques.
- **Dépendances** : 2.0. Indépendant de 2.1 ; les exécutions pgTAP restent séquentielles. Décisions P-08 et
  P-17 (validées le 16/10/2026).

### 2.3 — Saisie et import (A8, tous moteurs)

- **Périmètre** :
  - `src/lib/numeric-input/parsers.ts`, existant depuis `d484c5a1` (`parseDecimalInput`, grammaire unique,
    « 1.250 » refusé) : 2.3 l'étend sans le recréer ; ses appelants : `money.ts:53-55`, `:94`,
    `NumberInput.tsx:17-27`, `editor-values.ts:28-39`, `clipboard.ts:574-579`, `import-flow.ts:126-128`,
    `:165-173` ;
  - convention de majoration : `shared.ts:254-263`, `useEstimateSelection.ts:11-14` (copie utilisée par l'action
    groupée), `clipboard.ts:333-351`, `import-flow.ts:390`, `:398`, `editor-export.ts:400-404`,
    `EstimateEditorCommandBar.tsx:839-874` ;
  - en-têtes : `mappings/server.ts:780-892` (prix avant unité, mots entiers, alias), `mappings/schemas.ts`
    (cibles `labor_hours_per_unit`, colonnes de contrôle, paramètres) ;
  - `optima-profile.ts` ;
  - conversion « h/u × Q » vers v1/v2 avec aperçu (P-16) ;
  - aides selon le moteur (`ColumnHeaderHelp.tsx`, `EstimateColumnsHelpPanel.tsx:285-292`).
  - Chemin `dpgf_rows_raw` → correspondances → `confirmUnifiedImportFlow` conservé, avec
    `sourceDocumentId` et `_timax_provenance`.
- **Tests d'exigence d'abord** (Vitest, cas limites de parseur, rouges sur l'existant sauf les
  non-régressions signalées) :
  - table d'au moins 40 cas commune aux cinq points d'entrée, en étendant
    `src/lib/numeric-input/entry-contract.test.ts`. Déjà verts à `98408ef0`, donc simples non-régressions :
    « 1.250 » refusé ; « 1 000 » → 1 000 ; « 1 250,50 » → 125 050 c ; « 1,875 » refusé en montant, accepté en
    quantité. Restent rouges : « 12,5 % » → 1 250 pb (`parseDecimalInput` refuse « % ») ; vide → « non
    renseigné », jamais 0 (aujourd'hui 0 dans `parseNumberInput`, `editor-values.ts:28-31`, choix documenté
    dans `docs/testing/tech-debt-numeric-entry.md` : à concilier avec les développeurs) ;
  - majoration : « 100 » sous « (%) » → ×1 ; OPTIMA « 0 » → ×1 et « 0,15 » → ×1,15 ; « 10 » sans unité
    déclarée → choix exigé ; coefficient > 10 refusé ;
  - heuristique : les 15 en-têtes OPTIMA et les 16 du client B ; « Prix Unitaire », « PR Fourniture
    unitaire » et « Tps pose unitaire » ne donnent jamais l'unité ; « Uté » donne l'unité.
- **Migration** : aucune.
- **E2E sur la pile locale** :
  - `numeric-entry-v3.e2e.ts`, dans `e2e/army/critical/` à côté de `numeric-entry.e2e.ts` (livré par `d484c5a1` :
    « 1 234,56 », « 12abc » refusé en grille et en réglage, prix collé « 1,234 » exclu) ; le refus de « 1.250 »
    y est une non-régression, verte dès l'origine :
    - « 1.250 » saisi dans la cellule PR FO, dans un champ du panneau et par collage : même message de
      refus dans les trois cas (`NUMERIC_INPUT_ERROR` ; l'aperçu du collage, qui affiche aujourd'hui « Nombre
      invalide pour <champ>. », `clipboard.ts:637`, est aligné en 2.3), rien d'enregistré ;
    - « 1 000 » saisi dans un champ du panneau : 1 000 après rechargement ;
    - action groupée « Majoration MO » : le coefficient résultant est affiché avant l'application.
  - `import-optima-v2.e2e.ts` : import d'un classeur généré aux en-têtes OPTIMA réels, avec les 7 lignes
    (nombres seuls), dans une v2 à marge fixe 1,30 ; aperçu « h/u × Q ».
    - Heures de ligne stockées : 39,82 / 5,25 / 0 / 227,8 / 6 / 281,436 / 10,4.
    - Totaux : 3 491,80 / 645,96 / 1 597,05 / 16 317,31 / 338,00 / 48 310,55 / 632,63 ; **Σ 71 333,30 €**.
  - `dpgf-import` (CSV) et l'import XLSX de `takeoff/import-flow-carry-over.e2e.ts` : inchangés. XLS et PDF
    n'ont pas de parcours d'import Army à `98408ef0` : à ajouter avec des DPGF générées, l'heuristique
    d'en-têtes étant commune aux formats (AGENTS.md).
- **Acceptation** :
  - 0 divergence entre les cinq points d'entrée ;
  - 0 colonne de prix prise pour l'unité ;
  - 7/7 lignes au centime ;
  - 0 valeur ambiguë acceptée en silence ;
  - corpus figé et empreintes identiques.
- **Dépendances** : 2.0 ; décisions P-11 et P-16 (validées le 16/10/2026). Indépendant de 2.1 et 2.2.

### 2.4 — Moteur v3 pur, jumeau SQL et référentiel d'unités (code inerte)

- **Périmètre** :
  - `src/lib/estimates/engine-v3/*` et branchement de la façade ;
  - `src/lib/units/*` et `scripts/units/generate-units-sql.ts` ;
  - `scripts/engine-v3/parity.ts` et `optima-lot-check.ts` ;
  - M3 ;
  - `src/types/database.ts`.
  - Aucun écran et aucun écrivain ; aucune v3 ne peut être créée.
- **Tests d'exigence d'abord** (rouges : modules absents) :
  - Vitest `engine-v3/oracle.test.ts` (§5.1, S1–S5), `engine-v3/requirements.test.ts` (§5.3) ;
  - `engine-v3/properties.test.ts`, 500 devis aléatoires : invariants §4, monotonie, Σ exactes ;
  - `allocate.test.ts` : 10 000 tirages, Σ exacte, résultat stable quand on permute l'entrée ;
  - `units/normalize.test.ts` : 40 vecteurs ;
  - pgTAP `estimate-engine-v3-functions.test.sql` (mêmes vecteurs via `private.estimate_v3_line`,
    `private.estimate_allocate_exact` et `private.estimate_v3_compute_items`) ;
  - pgTAP `measurement-units.test.sql` : RLS (anon : 0 ligne ; écriture `authenticated` refusée 42501),
    40 vecteurs, parité avec `units.json`.
- **Migration** : M3.
- **E2E sur la pile locale** : aucun parcours nouveau (moteur dormant). Parité TS/SQL exécutée sur la pile
  jetable, par le harnais de 2.0 (`npm run db:ci:local` n'exécute que pgTAP et la matrice RLS) :
  10 000 lignes et 300 devis, demi-centimes, quantités à 3 décimales, statuts, multi-taux,
  autoliquidation. Parcours de 2.0 rejoués.
- **Acceptation** :
  - PU = 16 663, 20 832, 7 605, 1 353, 31 400, 16 732, 7 388 c ; Σ 6 905 456 c ;
  - S1 à S5, EU01, EU01-b, EUHIST, A-05 (11 186), A-06 (ΔTVA 40 c), T-TVA-ARR (20 c), T-TAXSNAP, R1-ARR,
    T-CAP, T-MONO et T-MARG au centime ;
  - parité TS/SQL : 0 écart ; normaliseur : 40/40 ;
  - lots OPTIMA (§5.4) : 785/785 et 656/656 PU ; Σ 1 644 207,61 € et 1 027 655,61 € ;
    1 572 320,99 € et 981 887,92 € ; coefficients 1,243188 et 1,242126 ;
  - calcul de 1 000 lignes : p95 ≤ 50 ms sous Node ; 3 000 lignes ≤ 2 × le temps du moteur v2 ;
  - `git diff --stat` vide sur les fichiers moteur ; montée de version : 0 différence.
- **Dépendances** : 2.1 ; décisions P-01, P-02, P-03, P-05, P-06, P-07, P-08, P-09, P-10 (validées le
  16/10/2026 ; l'avis de l'expert-comptable sur P-06 et P-07 ne bloque pas 2.4).

### 2.5 — Persistance, gel et règles v3, derrière la politique

- **Périmètre** :
  - M4 ;
  - `calc-policy-server.ts`, `canonical-v2-creation.ts`, `version-totals.ts`, `settings-atomic.ts`,
    `batch-preparation.ts`, `atomic-item-creation.ts`, `v3-snapshot-server.ts`, `v2-snapshot-server.ts:77` ;
  - `server.ts` (publication, gel `:5467`, `:5558`, `:6537`, `:6596`) ;
  - `send-estimate.ts:311`, `approval-v2-snapshot.ts:27` ;
  - `effective-margin.ts`, `effective-discount.ts`, `fixed-discount-evidence-server.ts`,
    `v3-margin-evidence-server.ts`, `rules-engine.ts:1169-1199`, `direction/server.ts:942` ;
  - `affaires/server.ts:2250-2269` ;
  - listes `select` (§8.2) ;
  - schémas, OpenAPI, `src/types/database.ts`.
  - Émission toujours fermée.
- **Tests d'exigence d'abord** :
  - pgTAP `estimate-engine-v3-persistence.test.sql`, rouge avant M4 :
    - politique ↔ création (`CONTEXT_CHANGED`, politique absente → v2, passage à 3 sans coefficients
      refusé) ;
    - RLS de `tenant_calc_policies` (lecture par les membres, aucune écriture directe, autre entreprise
      invisible) ;
    - CHECK de forme v3 (paliers, coefficient global ≠ 1, mode `up`, montant et pourcentage ensemble) ;
    - **chaque** nouvelle colonne de version incrémente `content_revision` et périme le gel ;
    - h/u : dérivation et refus (D4) ;
    - projection altérée d'1 c refusée à la sauvegarde (PU, brut, identité) et au gel (part de remise,
      TVA d'un taux, FO/MO) ;
    - unité manquante au gel → refus ; taux non autorisé → refus ;
    - duplication v3 → v3, mêmes montants ;
    - `list_approval_queue` : marque v3 exacte ;
    - métré sur une v3 → refus nommé ;
    - **montée de version** : 0 différence sur la fixture v1/v2.
  - Vitest, isolation justifiée par l'intégrité des règles : `min_margin` sur un brouillon v3 sans preuve →
    « indisponible », jamais 0 ; T-MARG → violation.
- **Migration** : M4.
- **E2E sur la pile locale** (`engine-v3-persistence.e2e.ts`, entreprise de recette en politique 3, 1,30 /
  1,20, rôle « Tuyauteur » 40 €/h du propriétaire, par l'API de l'application puis lecture à l'écran) :
  - création de l'affaire `ARMY-L2-V3-<run>` ; écriture des 7 lignes par lot ; relecture :
    - PU et totaux du §5.1 ;
    - HT 6 905 456, TVA 1 381 091, TTC 8 286 547 (S1) ;
  - réglages :
    - S2 : HT 6 905 355, `discount_amount_cents` 101, `discount_bp` 0 ;
    - S3 : `discount_bp` 1 000, HT 6 214 910 ;
    - EUHIST ;
    - TVA 10 % « appliquer à toutes les lignes » → 7 lignes à 1 000 pb ;
  - gel d'approbation ; file d'approbation avec la marque nette ; duplication ;
  - politique remise à 2 : la création suivante est une v2 (valeurs de base de 2.0) ; la v3 garde ses
    montants.
- **Acceptation** :
  - égalité au centime de toutes les valeurs ci-dessus, en base et à la relecture ;
  - 0 régression sur les parcours de 2.0 et sur toutes les suites pgTAP (base et suites du lot) ;
  - corpus, empreintes et montée de version identiques ;
  - `db:ci:local` vert.
- **Dépendances** : 2.4 ; décision P-13 (validée le 16/10/2026).

### 2.6 — Éditeur et réglages v3 (A2, A3, A5, A6 côté saisie)

- **Périmètre** :
  - `useEstimateV3Settings.ts` ;
  - `src/components/estimates/v3/*` (réglages, cellules « U » du référentiel, « Statut », « h MO / u »,
    « TVA % », « h MO total » en lecture seule, dialogue de propagation) ;
  - branchements dans `useEstimateEditorState.impl.tsx` (`:541`, `:749`, `:1252`, `:1349`, `:1452-1493`,
    `:1825`, `:2808-2817`), `useEstimateEditorCalculation.ts:264`,
    `useEstimateEditorSyncController.ts:733`, `EstimateSettingsPanel.tsx`, `EstimateEditorTable.tsx`
    (délégation seulement), `ColumnHeaderHelp.tsx` ;
  - pages de détail et d'impression en brouillon (`[versionId]/page.tsx:179`, `:285`, `print/page.tsx:176`,
    `:241`).
- **Tests d'exigence d'abord** : E2E ci-dessous, rouges sur 2.5. Vitest seulement pour l'état d'éditeur : la
  sauvegarde v3 n'envoie jamais de `discount_bp` dérivé d'un montant.
- **Migration** : aucune.
- **E2E sur la pile locale** (`engine-v3-editor.e2e.ts` ; chaque relecture attend l'état sauvegardé,
  `waitForAutoSave`, `e2e/army/critical/fixtures.ts:291`, l'autosave étant différé de 60 s) :
  1. saisie des 7 lignes **par la grille** (désignation, unité, Q, PR FO, h/u) : PU 166,63 € sur O1 ; à
     1,3 / 1,3 → 174,59 € ;
  2. coefficient FO vidé : refus explicite, ancienne valeur conservée (à ajouter en v3 : `NumberInput` refuse
     déjà un texte invalide avec `NUMERIC_INPUT_ERROR`, mais un champ vidé sans `emptyValue` reprend sa valeur
     sans message) ;
  3. remise 1,01 € → appliquée 1,01 €, `discount_bp` 0 ; puis 10 % → 1 000 pb exacts ; coefficient FO
     doublé → toujours 10 % ;
  4. remise 500 € sur une assiette de 400 € → « demandé 500,00 € / appliqué 400,00 € » ;
  5. TVA 20 % → 10 % : dialogue. « Non » → récapitulatif 20 % conservé ; « Oui » → 7 lignes à 10 %. Sur le
     devis en S2, O1–O3 à 10 % et O4–O7 à 20 % → deux taux au pied (S5 : TVA 13 255,25 €) ;
  6. ligne de 500 € passée « Hors lot » → HT −500,00 € ; retour à « Chiffrée » → montant restauré ;
  7. « ML » saisi → « ml — mètre linéaire » ; la suggestion catalogue ne modifie pas l'unité ;
  8. Q d'une ligne avec heures doublée → MO et PT doublés (±1 c) ;
  9. pas de « Barème par défaut » affiché en v3 ; le repère du barème de l'entreprise est non appliqué ;
  10. arrondi au pas de 100 € inférieur → S4 (HT 69 000,00 €, TTC 82 800,00 €).
- **Acceptation** :
  - valeurs affichées = valeurs relues après rechargement = §5 ;
  - 0 champ qui retombe à 0 en silence ;
  - budgets respectés (`EstimateEditorTable.tsx` ≤ 2 600, `useEstimateEditorState.impl.tsx` ≤ 3 100,
    `useEstimateEditorSyncController.ts` ≤ 1 200, déjà au plafond : la branche v3 y est déléguée) ;
  - corpus et empreintes identiques.
- **Dépendances** : 2.5, 2.3.

### 2.7 — Document client, contrat client 2, charge de calcul 6, émission v3

- **Périmètre** :
  - M5 ;
  - `offer-contract-v2.ts`, `offer-document.ts:99-133`, `offer-contract.ts:330`, `estimate-seal.ts`,
    `server.ts:1808`, `:5666-5727` ;
  - `prepare-estimate-document-data.ts`, `EstimateDocument.tsx`, `EstimateDocumentTableRows.tsx`,
    `EstimateDocumentTotalsV3.tsx`, `pdf-generator.tsx`, `pdf-v3-totals.tsx` ;
  - portail ;
  - exports (`export-stream.ts`, `dpgf-export.ts`, `editor-export.ts`, `bdc-export.ts`) ;
  - extension de `canUseDevelopmentEstimateTerms` (`src/lib/estimates/pdf-terms-server.ts:21-34`) au build
    de production de la pile possédée, pour le profil `calc-v3` seulement, avec son test de garde-fou :
    refus avec un marqueur d'hébergement ou hors de ce profil ; cas `offer` sur 45585 inchangé (§10.4).
- **Tests d'exigence d'abord** :
  - pgTAP `estimate-offer-contract-v2.test.sql`, rouge avant M5 :
    - contrat 2 altéré d'1 c (ligne, remise, base ou TVA d'un taux), d'une clé, d'une unité ou d'un statut
      → refusé ;
    - v3 avec contrat 1 → refusé ; v2 avec contrat 2 → refusé ;
    - publication sans gel document v3 frais → refusée ;
    - contrat 1 et suites `estimate-email-outbox` et `portal-security-definer` inchangés (état `98408ef0`).
  - Vitest, isolation justifiée par l'intégrité du sceau et du parseur strict :
    - modifier n'importe quel champ v3 change l'empreinte de la charge 6 ;
    - les charges 1 à 4 restent identiques sur le corpus ;
    - parseur `ClientContract2` strict ;
    - `prepareEstimateDocumentData` v3 : PT = Q × PU, Σ sous-totaux = brut, tableau de TVA = contexte.
- **Migration** : M5.
- **E2E sur la pile locale** (`engine-v3-emission.e2e.ts`) : devis de 2.6 en S2 puis S5, envoi manuel
  (collecteur sentinelle `scripts/tester-army/offer-collector.mjs`, à brancher en 2.0 comme dans
  `e2e/army/local/offer-emission.config.ts`), texte extrait de la pièce jointe qu'il archive
  (`receipts/<empreinte>/private/attachment.pdf`) avec `pdfjs-dist`, déjà en dépendance ; cette aide est à
  écrire en 2.0, `reproductions/outils/pdf-text.mjs` ne lisant que la pile de l'audit
  (`secrets/local-stack.env`). Le texte doit contenir :
  - O1 « 166,63 » et « 3 332,60 » ; O4 « 1 139 », « ml », « 13,53 » et « 15 410,67 » ;
  - « Remise commerciale », « −1,01 € » et « Total HT net 69 053,55 » ;
  - S2 : « TVA 20 % » avec base 69 053,55 et montant 13 810,71 ;
  - S5 : 10 % (5 554,53 / 555,45) et 20 % (63 499,02 / 12 699,80) ; TTC 82 308,80.
  Ensuite :
  - sceau : marqueur 5, contrat 2, charge 6, vérification positive ;
  - impression et portail : mêmes montants ; acceptation au portail ;
  - export XLSX et DPGF : mêmes PU et PT, ligne de remise ;
  - régression : un devis v2 envoyé avant M5 se vérifie toujours, avec le même SHA-256 de PDF.
- **Acceptation** :
  - 100 % des lignes imprimées vérifient PT = arrondi(Q × PU) ;
  - Σ lignes = HT brut ; brut − remise − arrondi = HT net ; TVA = ⌈base × taux⌋ pour chaque taux ;
    TTC = net + TVA ;
  - deux générations d'une même version scellée produisent le même texte ;
  - 0 différence sur les empreintes v1/v2 ; montée de version : 0 différence.
- **Dépendances** : 2.5 ; 2.6 pour le parcours par l'interface.

### 2.8 — Chemins d'entrée v3 : import et collage OPTIMA, ouvrages, modèles

- **Périmètre** :
  - M6 ;
  - `import-flow.ts:342-426` (h/u direct, `unit_code`, `pricing_status`) ;
  - `optima-profile.ts` (ligne de paramètres L2:O2 proposée en coefficients, taux horaire comparé au rôle,
    import auto-vérifiant) ;
  - `clipboard.ts:437-498`, `detectClipboardFormat` (aperçu des valeurs interprétées) ;
  - `server.ts:2218-2264` (`buildImportedEstimateItemInsert`, import de sections) ;
  - `assemblies-server.ts`, `assembly-calculation.ts`, `generated-ouvrages.ts:1674-1728`,
    `generated-ouvrage-labor-hours.ts:11-40`, `templates-server.ts` ;
  - refus nommé du métré (`src/lib/takeoff/server.ts`).
- **Tests d'exigence d'abord** :
  - pgTAP, rouge avant M6 :
    - insertion d'ouvrage en v3 : h/u = `h_mo / default_quantity` ; quotient non représentable → refus ;
    - ouvrages générés v3 : rendement par unité ;
    - modèle v2 dans une v3 : conversion et rapport ; Q = 0 et h > 0 → refus ;
    - modèle issu d'une v3 : colonnes v3 copiées.
  - Vitest : réconciliation OPTIMA (écart supérieur à 0,5 c listé) ; ligne de paramètres détectée.
- **Migration** : M6.
- **E2E sur la pile locale** :
  - `engine-v3-import-optima.e2e.ts` : import du classeur hydraulique (copie locale, rien d'ajouté au dépôt)
    dans une v3.
    - Coefficients proposés 1,3 / 1,3 : PU = « Prix Unitaire » arrondi sur 785/785, Σ 1 644 207,61 €.
    - Puis 1,30 / 1,20 : Σ 1 572 320,99 €, coefficient réalisé 1,243188.
    - Statuts : 61 HL, 9 inc, 7 NC, 1 PM, 1 CP, à 0 €.
    - Même chose pour la plomberie : 656/656, puis 981 887,92 €.
  - Collage de l'en-tête OPTIMA et de la ligne O1 : aperçu « h/u 1,991 », « Prix Unitaire 174,59 :
    contrôle », PU 166,63 € à 1,30 / 1,20.
  - Ouvrage de bibliothèque inséré à Q = 10 puis à Q = 20 : MO doublée.
  - Modèle v2 inséré dans une v3 : MO identique à la tolérance documentée ; lignes converties listées.
  - Métré appliqué à une v3 : message nommé, aucune écriture.
- **Acceptation** :
  - chiffres ci-dessus ; 0 ligne OPTIMA dont l'unité vaut un prix ;
  - 0 chemin qui multiplie des heures par unité par Q ;
  - `sourceDocumentId` et `_timax_provenance` présents ;
  - corpus, empreintes et montée de version identiques.
- **Dépendances** : 2.5, 2.3, 2.6 ; décisions P-12 et P-14 (validées le 16/10/2026).

### 2.9 — Unité d'achat et conditionnement (P-18, retenu le 16/10/2026 ; non bloquant pour 2.10)

- **Périmètre** :
  - M7 ;
  - `supplier-offer-eligibility.ts` (normaliseur et conversion) ;
  - `purchase-order-drafts.ts` ;
  - `src/lib/catalogue/csv-import.ts:10-15`, `:956-957` (profil `mm_bdc`, qui n'a aucune cible d'unité et
    écrit aujourd'hui `unit: null` : 2.9 lui fait lire l'unité d'achat ; D4-16).
- **Tests d'exigence d'abord** : pgTAP de la préparation d'achat avec conversion ; Vitest T-UNIT3.
- **Migration** : M7.
- **E2E sur la pile locale** : 282 ml de fonte, offre « barre de 3 m » à 262,45 € avec arrondi entier → 94
  barres commandées, PR converti 87,48 €/ml ; 10 ml avec une barre de 3 m à 27,00 € → 4 barres.
- **Acceptation** : quantités et prix exacts ; aucune ligne d'un devis existant modifiée.
- **Dépendances** : 2.4.

### 2.10 — Pilote puis bascule

- **Statut (18/10/2026)** : découpé en 2.10a (créateurs prêts pour le moteur 3, PR #57) et 2.10b (pilote A,
  M8, défauts TS, documentation ; fusion en dernier). Pilote A, triage et preuves :
  `docs/testing/estimate-engine-v3-2.10.md`. Écart proposé au porteur (D-l) : l'entreprise de recette de la
  campagne est posée en politique 2 explicite, les parcours v3 tournent sur des propriétaires dédiés.
- **Périmètre** :
  - pilote : `set_tenant_calc_policy` à 3 pour l'entreprise de recette locale (recréée à chaque
    exécution par `scripts/run-tester-army-ci.ts`, dont la préparation pose alors la politique), campagne E2E
    complète (`npm run e2e:army:ci -- full`, commande de `e2e-army-full.yml`). Puis,
    **sur autorisation explicite**, migrations par la chaîne tracée et politique 3 pour l'entreprise du
    porteur ; trois dossiers réels chiffrés en parallèle d'OPTIMA ;
  - bascule : M8, `NEW_ESTIMATE_CALC_ENGINE_VERSION = 3` (`calc-engine-version.ts:17`) ;
  - documentation (`regles-de-calcul.md`, `cycle-de-vie.md`, `glossaire.md`, `CONTEXT.md`, invariants
    de calcul de `AGENTS.md`) ;
  - registre des règles : goldens v1/v2 classés « historiques acceptés ».
- **Tests d'exigence d'abord** : pgTAP « politique absente → v3 » après M8 ; E2E « duplication d'une v2 →
  v2 ».
- **Migration** : M8.
- **E2E sur la pile locale** : création vierge, depuis un modèle et depuis un import → `calc_engine_version = 3`
  (lecture SQL) ; duplication d'une v2 → v2 ; tous les scénarios de 2.0 à 2.8 verts.
- **Acceptation** :
  - 100 % des créations du parcours en v3 ;
  - 0 version existante modifiée (comptage par moteur et somme de contrôle des colonnes de montant avant et
    après) ;
  - procès-verbal de recette signé ; écarts avec OPTIMA tous expliqués par une règle validée (P-03, 16/10/2026).
- **Dépendances** : 2.1 à 2.8 (2.9, retenu, n'en est pas un préalable) ; désignation par le porteur des trois
  dossiers réels et de leurs résultats attendus (Q01), avant leur chiffrage ; avis de l'expert-comptable
  (P-06, P-07) avant la politique 3 de l'entreprise du porteur, c'est-à-dire avant tout usage client réel (le pilote local n'en dépend pas) ;
  arbitrages validés le 16/10/2026 ; phase 0 de l'audit (dépôt privé, sauvegarde restaurée, CI hors
  production, déploiement conditionné à la CI), préalable à l'usage réel même si la sécurité reste hors
  périmètre pendant le développement. La CI de test vise déjà une base en boucle locale à `98408ef0`
  (`e2e-army-*.yml`, `e2e-rls-matrix.yml`, `quality-gate.yml`).

---

## Annexe A — Comparaisons TS du moteur à un littéral (relevé du 14/10, revérifié le 16/10 à `98408ef0`, tests exclus)

| Fichier | Lignes |
|---|---|
| `src/app/dashboard/estimates/[versionId]/page.tsx` | 179, 285 |
| `src/app/dashboard/estimates/[versionId]/print/page.tsx` | 176, 241 |
| `src/components/estimate-document/prepare-estimate-document-data.ts` | 148, 208, 237, 452, 477, 521 |
| `src/hooks/useEstimateEditorCalculation.ts` | 264 |
| `src/hooks/useEstimateEditorState.impl.tsx` | 541, 749, 1252, 1349, 1825, 2816 |
| `src/hooks/useEstimateEditorSyncController.ts` | 733 |
| `src/lib/direction/server.ts` | 942 |
| `src/lib/email/send-estimate.ts` | 311 |
| `src/lib/estimates/approval-v2-snapshot.ts` | 27 |
| `src/lib/estimates/assembly-calculation.ts` | 52 |
| `src/lib/estimates/atomic-item-creation.ts` | 100 |
| `src/lib/estimates/batch-preparation.ts` | 299 |
| `src/lib/estimates/calc-engine-version.ts` | 59, 86 |
| `src/lib/estimates/effective-discount.ts` | 97, 109 |
| `src/lib/estimates/effective-margin.ts` | 66 |
| `src/lib/estimates/estimate-seal.ts` | 138 |
| `src/lib/estimates/export-stream.ts` | 426, 443 |
| `src/lib/estimates/fixed-discount-evidence-server.ts` | 75, 95 |
| `src/lib/estimates/offer-contract.ts` | 330 |
| `src/lib/estimates/offer-document.ts` | 122 |
| `src/lib/estimates/pdf-generator.tsx` | 1465, 1619, 1682, 1702 |
| `src/lib/estimates/server.ts` | 5467, 5558, 5722, 6537, 6596 |
| `src/lib/estimates/settings-atomic.ts` | 47 |
| `src/lib/estimates/v2-snapshot-server.ts` | 77 |
| `src/lib/estimates/version-totals.ts` | 212, 367 |
| `src/lib/estimate-calculations.ts` | 999, 1341, 1410, 1466, 1538, 1686, 1710, 1763, 1771 (moteur historique, type 1 \| 2, **non modifié**) |

À ces comparaisons s'ajoutent des sites qui **supposent** un moteur sans le comparer :
`src/lib/affaires/server.ts:2250-2269` (`calcEngineVersion: 2 as const`) et `src/lib/takeoff/server.ts:3419`,
`:3839` (moteur transmis aux règles).

## Annexe B — Reproduire les chiffres

- 7 lignes : `node docs/audit-independant-2026-10-14/reproductions/lot2/dd-oracle-v3.cjs docs/audit-independant-2026-10-14/reproductions/d4/D4-extraits.json`
  → Σ 6 905 456 c (vérifié le 14/10, rejoué le 16/10).
- Lots complets : `docs/audit-independant-2026-10-14/reproductions/lot2/optima-v3-check2.cjs` et `docs/audit-independant-2026-10-14/reproductions/lot2/optima-v3-offer.cjs` (bibliothèque `xlsx` du dépôt ;
  `docs/prd_file/exemple chiffrage OPTIMA/` et `node_modules/xlsx` y sont en chemins absolus de ce poste), avec
  les noms des classeurs en arguments ; rejoués le 16/10, mêmes résultats qu'au §5.4.
  Le sous-lot 2.4 les transforme en `scripts/engine-v3/optima-lot-check.ts`.
- S5 : répartition de 101 c au plus grand reste sur les bruts → `[5, 1, 2, 23, 0, 69, 1]` ; TVA par taux
  1 325 525 c contre 1 325 527 c ligne à ligne.
