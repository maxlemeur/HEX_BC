# Moteur v3 pur, jumeau SQL et référentiel d'unités (sous-lot 2.4)

Statut : **implémenté, intégré et prouvé en local** (17/10/2026). Branche `lot2/2.4-moteur-v3-pur`, partie de
`e30560f4` (`main` + 2.1). Deux pistes, puis une intégration :

| Piste | Commits | Contenu |
|---|---|---|
| A, moteur TS | `de2c86db` (`test`, rouge), `e175f9eb` (`feat`) | `src/lib/estimates/engine-v3/*`, branche v3 de la façade `engine/compute.ts` |
| B, jumeau SQL et unités | `bccdd971` (`test`, rouge), `b2c3eb09` (`feat`), `384e8cb1` (`docs`) ; fusion `c16e8703` | M3, `src/lib/units/*`, `scripts/units/generate-units-sql.ts`, deux suites pgTAP, `src/types/database.ts` |
| Intégration | `63727954` (`test`, rouge), `a0f26a90` (`fix`), `c0b450e7` et `36b3fa8b` (`feat`), `a0f5cac9` et ce document (`docs`) | règles communes I-01 à I-06, `scripts/engine-v3/parity.ts`, `optima-lot-check.ts`, `performance.ts` |

Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, §2, D1,
D4 à D9, D12, D13, D18, §4, §5, §6.1 (M3), §6.2, §6.5, §7, §8.1, §10.1 et §14 « 2.4 » ; décisions P-01 à P-19
(validées le 16/10/2026). Là où ce document résume la conception, la conception fait foi.

Code **inerte** : aucun écran, aucun écrivain, aucune RPC n'appelle le moteur v3, et aucune v3 ne peut être
créée. Les fonctions de M3 ne lisent aucune ligne de devis. `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` restent à zéro ligne de diff ; aucune table ni ligne existante ne change.

## Périmètre

| Fichier | Rôle |
|---|---|
| `src/lib/estimates/engine-v3/*` | Moteur v3 pur (BigInt), adaptateur JSON canonique, projection §6.5, lecteur figé |
| `src/lib/estimates/engine/compute.ts` | Façade : `{ calcEngineVersion: 3, v3 }` → `EstimateV3Breakdown` ; 1 et 2 inchangés |
| `supabase/migrations/20261017134443_estimate_engine_v3_functions_and_units.sql` | M3 : enum de statut, référentiel d'unités, jumeau SQL pur |
| `supabase/tests/database/estimate-engine-v3-functions.test.sql` | Jumeau SQL : oracle, scénarios, cas d'exigence, répartition, erreurs, intégration |
| `supabase/tests/database/measurement-units.test.sql` | Référentiel : schéma, RLS, 40 vecteurs, parité avec `units.json` |
| `src/lib/units/units.json`, `normalize.ts`, `normalize.test.ts` | Source unique du référentiel ; jeton et normaliseur TS |
| `scripts/units/generate-units-sql.ts` (`npm run units:sql`) | Génère les blocs de M3 et de la suite pgTAP ; `--check` échoue en cas de dérive |
| `scripts/engine-v3/parity.ts`, `parity-cases.ts`, `owned-native-stack.ts` (`npm run engine:v3:parity`) | Parité TS/SQL sur une pile native jetable possédée (WSL) |
| `scripts/engine-v3/optima-lot-check.ts` (`npm run engine:v3:optima-lot-check`) | Lots OPTIMA complets (§5.4), local, hors CI |
| `scripts/engine-v3/performance.ts` (`npm run engine:v3:performance`) | Mesure de performance (§14 « 2.4 »), échantillons bruts archivés |
| `src/types/database.ts` (CRLF) | Deux tables publiques et l'enum de statut (D18) |

## Contrat de calcul (défini avant l'implémentation)

Conception §4 et D13, en décimal exact (BigInt en TS, `numeric` en SQL ; jamais de flottant sur un montant) :

| Étape | Règle |
|---|---|
| Ligne `priced` | FO_u = P × k_fo ; MO_u = maj × h × t × k_mo, ou maj × (h_at × t_at × k_at + h_ch × t_ch × k_ch) avec la ventilation ; PU = ⌈FO_u × c_FO + MO_u × c_MO⌋ (un seul arrondi) ; B = ⌈Q × PU⌋ ; FO/MO bruts = répartition exacte de B selon (FO_u × c_FO, MO_u × c_MO) ; atelier/chantier bruts = répartition de la MO brute (sans ventilation : tout en chantier, I-01) ; D = ⌈Q × (FO_u + MO_u)⌋ ; h_mo* = arrondi(Q × h/u, 3) |
| Ligne non chiffrée | `included`, `for_memory`, `not_priced`, `out_of_scope`, `not_applicable` : 0 partout, PU nul, saisies conservées, avertissement TS `ESTIMATE_V3_LINE_NOT_PRICED` |
| Pied | G = Σ B ; R = min(M, G) ou min(⌈G × bp / 10 000⌋, G) ; A = (G − R) mod s en mode `down` ; N = G − R − A ; réduction de ligne = répartition de R + A selon les B ; nets FO/MO et atelier/chantier par répartition |
| TVA | par taux r : base_r = Σ nets, T_r = ⌈base_r × r / 10 000⌋ (0 en autoliquidation) ; TVA de ligne = répartition de T_r selon les nets du groupe |
| Totaux | `total_ttc = N + Σ T_r`, `rounding_adjustment = 0`, coefficient réalisé = N / Σ D à 6 décimales (« 1.000000 » si N = Σ D = 0, nul si seul Σ D = 0) |
| Erreurs | `ESTIMATE_V3_INPUT_INVALID` (SQLSTATE 22023) ; `ESTIMATE_AMOUNT_OVERFLOW` (22003) au-delà de 2 147 483 647 c, jamais d'écrêtage |
| Répartition | plus grand reste en entiers ; ex aequo par clé croissante (uuid en minuscules = ordre `uuid` PostgreSQL ; `fo` < `mo`, `atelier` < `chantier`) ; W = 0 : parts égales, reste par clé |

JSON canonique partagé (parité) : entrée `{ params, items }` avec les huit clés de `params` et les colonnes de
ligne du §6.2 ; sortie `{ lines, totals }` (19 clés de ligne, 10 clés de totaux), entiers en nombres JSON,
`h_mo*` (3 décimales) et coefficient réalisé (6 décimales) en chaînes à échelle fixe, lignes dans l'ordre
d'entrée, sections omises.

## Défaillances observables et preuves

### Moteur TS (piste A)

| Id | Défaillance | Preuve |
|---|---|---|
| F-V3-01 | PU arrondi deux fois, calculé en flottant ou à partir du total : un centime d'écart sur un demi-centime | `oracle.test.ts` (O1–O7 aux deux jeux de coefficients) ; `requirements.test.ts` T-PU, A-05, T-HALF3 |
| F-V3-02 | Heures lues comme un total de ligne : la MO ne suit pas la quantité | T-HMO, T-HMO-Q, T-Q0 ; heures dérivées (O1 : 39,820 h) |
| F-V3-03 | Brut ≠ ⌈Q × PU⌋, ou PU qui dépend de Q | `properties.test.ts` (500 devis, recalcul BigInt indépendant, requantification) |
| F-V3-04 | Répartition inexacte, dépendante de l'ordre d'entrée, ex aequo non déterministes, unité donnée à un poids nul | `allocate.test.ts` (10 000 tirages, permutation, W = 0, départage) ; S5 `[5, 1, 2, 23, 0, 69, 1]` |
| F-V3-05 | Remise : intentions mélangées, taux dérivé d'un montant, remise non plafonnée | EU01, EU01-b, EUHIST (`discount_bp` reste 1 000), CAP, refus de l'intention double |
| F-V3-06 | Arrondi commercial hors base de TVA, ou ajustement après le TTC | S4, T-TAXSNAP, R1-ARR (`rounding_adjustment_cents = 0`) |
| F-V3-07 | TVA ligne à ligne au lieu de par taux sur la base nette | S5 (1 325 525 et non 1 325 527), T-TVA-ARR (20 c et non 21), A-06 (ΔTVA 40 c), T-TVA1, autoliquidation |
| F-V3-08 | Écrêtage silencieux d'un montant hors entier PostgreSQL | T-CAP (`ESTIMATE_AMOUNT_OVERFLOW`, 22003) |
| F-V3-09 | Palier ou non-monotonie | T-MONO ; propriété de monotonie |
| F-V3-10 | Ligne non chiffrée comptée dans un total | T-STAT ; propriété : retirer les lignes non chiffrées ne change aucun total |
| F-V3-11 | Marque nette fausse : 0 au lieu d'indéterminé, coefficient réalisé faux | T-MARG (marque 0 %, sous 15 %) ; coefficient « 1.000000 » / nul |
| F-V3-12 | Entrée invalide lue comme 0, tronquée ou arrondie (décimales en trop, NaN, infini, négatif, exposant, 0,1 + 0,2) | 18 refus nommés `ESTIMATE_V3_INPUT_INVALID` ; lecture par la chaîne la plus courte (`String(n)`) |
| F-V3-13 | Façade : v3 routée vers le moteur v2, résultat v3 converti en `EstimateBreakdown`, ou v1/v2 modifiés | `engine/compute.test.ts` |
| F-V3-14 | Forme JSON canonique divergente du jumeau SQL (clés, ordre, échelles, sections) | `requirements.test.ts`, adaptateur canonique ; parité TS/SQL |
| F-V3-15 | Relecture d'une v3 figée incohérente acceptée (Σ nets ≠ HT, ajustement non nul, atelier + chantier ≠ MO) | `requirements.test.ts`, lecteur figé (`ESTIMATE_V3_STORED_INCOHERENT`) |
| F-V3-16 | Projection : contexte §6.5 mal formé, intention de remise réécrite | EU01 (contexte exact du §6.5), EUHIST |

### Référentiel d'unités et normaliseur (piste B ; D9, P-08, P-09)

| # | Défaillance | Preuve |
|---|---|---|
| U1 | « ML », « mL », « Ml », « m.l. », « mètre linéaire » lus comme millilitre, ou refusés ; `m` distinct de `ml` (P-08 : `m` = `ml`) | vecteurs 1 à 11 (TS et SQL) |
| U2 | Un statut placé dans la colonne unité (HL, PM, NC, inc, incl, CP, SO) pris pour une unité, ou l'inverse | vecteurs 31 à 38 ; CHECK « exactement une cible » |
| U3 | Jeton TS ≠ jeton SQL (NFD, insécable, pleine chasse, exposants, casse, points, tirets) | mêmes 40 vecteurs dans les deux langages ; jeton SQL de chaque alias = jeton TS (bloc généré) |
| U4 | Dérive entre `units.json` et la base | `generate-units-sql.ts --check` ; test Vitest de parité des blocs ; pgTAP table = bloc attendu |
| U5 | Alias ambigu, jeton non canonique stocké, code d'unité qui n'est pas son propre jeton | refus du générateur ; clé primaire sur le jeton ; pgTAP `unit_token(token) = token` |
| U6 | `anon` lit le référentiel ; `authenticated` l'écrit ; RLS absente | pgTAP : privilèges, refus 42501, RLS active |
| U7 | Millilitre réintroduit sous une autre graphie | vecteur 39 ; refus du générateur |
| U8 | Types de base faux par rapport à `src/types/database.ts` | pgTAP `has_column` / `col_type_is` (D18) ; `tsc` |
| U9 | Entrée nulle ou vide résolue en unité par défaut | vecteur 40 et cas `null` |

### Jumeau SQL (piste B ; §4, D7, D8, D13)

| # | Défaillance | Preuve |
|---|---|---|
| F1 | Arrondi faux au demi-centime (bancaire, demi inférieur, flottant) | `estimate_round_half_up` : 0,5 → 1, 2,5 → 3 ; T-HALF3 |
| F2 | Double arrondi : FO et MO arrondis séparément | O1 à O7 aux deux jeux de coefficients ; T-PU ; A-05 |
| F3 | Brut ≠ ⌈Q × PU⌋ | totaux O1 à O7, Σ 6 905 456 c ; T-HMO, T-HMO-Q, T-Q0 |
| F4 | MO par unité non multipliée par Q ; majoration ignorée | T-HMO, T-HMO-Q ; cas de majoration 1,1 |
| F5 | Ventilation déclenchée sans charge active, ou ignorée avec charge | cas de ventilation (actif / drapeau de version faux) |
| F6 | Répartition inexacte, dépendante de l'ordre, ex aequo par affichage, W = 0 | `estimate_allocate_exact` : S5, permutation, W = 0, ex aequo par clé, 1 000 tirages |
| F7 | Remise : deux intentions, remise au-delà du brut, taux mal arrondi | S2, S3, EU01, EU01-b, EUHIST, CAP ; refus 22023 |
| F8 | Arrondi commercial après la TVA ou hors base | S4, T-TAXSNAP, R1-ARR |
| F9 | TVA ligne à ligne ; Σ TVA de ligne ≠ T_r ; autoliquidation qui taxe | S1, S5, T-TVA1, T-TVA-ARR, A-06 ; autoliquidation ; invariants |
| F10 | Ligne non chiffrée qui contribue ; section qui porte un montant | T-STAT ; les cinq statuts ; section parente |
| F11 | Dépassement écrêté au lieu d'être levé | T-CAP, Σ brut, TTC, déboursé, heures dérivées : 22003 |
| F12 | Entrée invalide acceptée en silence | 25 cas `ESTIMATE_V3_INPUT_INVALID` (22023) |
| F13 | Division `numeric` imprécise | coefficients réalisés exacts (S1 1,258472 ; EU01 0,999949 ; T-MARG 1,000000) |
| F14 | Monotonie rompue | T-MONO |
| F15 | Fonctions exécutables par `public`, `anon`, `authenticated` ou `service_role` ; `search_path` non figé ; comparaison du moteur à un littéral | pgTAP privilèges et `proconfig` ; garde F-SQL-14 de 2.1 inchangée et verte |
| F16 | Montants v1/v2 modifiés | diff vide sur les deux fichiers moteur ; suites existantes, corpus figé, empreintes et montée de version identiques |

### Intégration (règles où les deux pistes divergeaient)

La comparaison du code des deux pistes, avant tout harnais, a relevé six divergences. Chacune est tranchée par une
règle unique, écrite rouge d'abord dans les deux langages (`63727954`), puis appliquée (`a0f26a90`).

| Id | Divergence | Règle retenue (et pourquoi) | Côté corrigé | Preuve |
|---|---|---|---|---|
| I-01 | Sans ventilation : TS rendait atelier = chantier = 0, SQL chantier = MO | **Toute la MO est « chantier »**, en brut et en net ; atelier + chantier = MO sur chaque ligne. Conception §4 (« atelier/chantier : répartition de la MO brute », sans condition) et convention v2 (`estimate-calculations.ts:875-877`, `:769`, `estimate-v2-snapshot.ts:242-245`). Le lecteur figé refuse désormais atelier + chantier ≠ MO net | TS (`line.ts`, `breakdown.ts`, `stored.ts`) | `requirements.test.ts` I-01 (2 tests) ; l'attendu du test TS « ignores the split payload when the version flag is off » passe de 0 à 3 000 c en chantier ; invariant moteur ajouté |
| I-02 | Sections : TS ne les validait pas, SQL valide id, parent et unicité des identifiants sur tous les éléments | **Validation SQL** : uuid, `parent_id` nul ou uuid, identifiants uniques sections comprises | TS (`input.ts`) | I-02 ; cas limites de la parité |
| I-03 | `params` : TS acceptait l'absence de `discount_amount_cents`, SQL exige les huit clés | **Les huit clés exigées** (contrat canonique) | TS (`input.ts`) | I-03 ; cas limites de la parité |
| I-04 | h/u nul : TS rendait des heures nulles, SQL « 0.000 » | **Heures de ligne nulles si la colonne par unité est nulle** : dérivation naturelle `round(Q × h/u, 3)` du déclencheur de 2.5, colonnes par unité nulles par défaut (D4) ; ligne non chiffrée : « 0.000 » si h/u est renseigné, nul sinon ; h/u nul vaut 0 dans la MO | SQL (M3) | pgTAP I-04 ; attendus T-HMO, T-STAT et F5 révisés (heures nulles là où h/u est nul) |
| I-05 | Pas d'arrondi 0 en mode `none` : TS refusait, SQL acceptait | **Pas ≥ 1 c dans tout mode** : la colonne porte `CHECK (rounding_step_cents >= 1)` (`001_add_job_title_to_profiles.sql:244`) | SQL (M3) | pgTAP (25ᵉ entrée invalide) ; TS I-05 |
| I-06 | Heures dérivées au-delà de `numeric(12,3)` : TS levait le dépassement, SQL non | **`ESTIMATE_AMOUNT_OVERFLOW` (22003)**, jamais d'écrêtage, même à coût nul | SQL (M3) | pgTAP I-06 ; TS I-06 |

M3 n'est pas publiée : elle a été modifiée à l'intégration et son empreinte du manifeste mise à jour à la main
(`a0f26a90` pour le code, `a0f5cac9` pour le commentaire d'en-tête qui pointe vers ce document).

## Pourquoi ces tests sont en isolation

`AGENTS.md` exige un E2E d'abord et n'admet l'isolation que pour une défaillance qu'un E2E ne peut pas
reproduire. Ici, aucun E2E ne le peut : en 2.4 le moteur v3 et son jumeau SQL sont **inertes** (aucune
version 3 ne peut être créée, aucun écran, aucune RPC, aucun écrivain ne les appelle ; conception §14 « 2.4 » :
« aucun parcours nouveau, moteur dormant »). Les défaillances visées sont précisément les exceptions admises :

- **montants au demi-centime près**, tolérance 0 c (§5.5) : un centime d'écart sur une ligne d'un devis de
  69 000 € ne se voit pas à l'écran et ne s'établit que par un attendu exact (F-V3-01 à 11, F1 à F14) ;
- **10 000 tirages** de répartition, **500 devis** aléatoires (TS) et la **parité TS/SQL** sur 10 000 lignes et
  300 devis : erreurs d'intégrité (Σ, ordre, départage, divergence de deux implémentations) qui n'apparaissent
  que sur des volumes impossibles à parcourir en E2E ;
- **intégrité SQL** : contraintes, RLS d'une table qu'aucun écran ne lit encore, privilèges des fonctions,
  refus nommés (U2, U5, U6, U8, F11, F12, F15) ;
- **cas limites d'analyse** des entrées (décimales en trop, valeurs non finies, exposants) et des graphies
  d'unités issues des DPGF et des classeurs OPTIMA (U1, U7, U9, F-V3-12).

Les parcours E2E v3 arrivent avec les écrivains (2.5) et l'éditeur (2.6). Les suites pgTAP s'exécutent sur la
pile native jetable de `npm run db:ci:local` (WSL, clone Linux), avec toutes les autres suites et la matrice RLS.

## API et contrat SQL livrés

API publique TS (`@/lib/estimates/engine-v3`) :

| Export | Signature |
|---|---|
| `computeEstimateV3Breakdown` | `(input: EstimateV3Input) => EstimateV3Breakdown` |
| `computeEstimateV3Canonical` | `(input: unknown) => EstimateV3CanonicalOutput` (objet ou texte JSON) |
| `projectEstimateV3Snapshot` | `(breakdown, { laborRoles? }) => { items, version, context }` (colonnes figées et contexte §6.5) |
| `readStoredEstimateV3` | `({ version, items }) => StoredEstimateV3View` (aucun recalcul) |
| `computeEstimateV3NetMarginBp` | `({ total_ht_cents, cost_subtotal_cents }) => number \| null` |
| `allocateExact` | `(amount: bigint, entries: { key: string; weight: bigint }[]) => bigint[]` |
| `EstimateV3Error` | `code` ∈ `ESTIMATE_V3_INPUT_INVALID` (22023), `ESTIMATE_AMOUNT_OVERFLOW` (22003), `ESTIMATE_V3_STORED_INCOHERENT` ; `sqlstate`, `field` |
| Façade | `computeVersionBreakdown({ calcEngineVersion: 3, v3 })` → `EstimateV3Breakdown` ; `{ calcEngineVersion: 1 \| 2, … }` → `EstimateBreakdown` inchangé ; un appel v3 de forme v1/v2 lève toujours `EstimateEngineUnavailableError` |

Référentiel TS (`src/lib/units/normalize.ts`) : `measurementUnitToken`, `normalizeMeasurementUnit`,
`MEASUREMENT_UNITS`, `ESTIMATE_LINE_PRICING_STATUSES`, `ESTIMATE_LINE_PRICING_STATUS_LABELS`,
`buildUnitsReferential` (noms choisis pour ne pas heurter les `normalizeUnit` privés du métré).

Fonctions SQL (M3) : toutes dans `private`, `security invoker`, `search_path = ''`, révoquées pour `public`,
`anon`, `authenticated` et `service_role` (seul `postgres` les exécute), immuables sauf `normalize_unit`
(`stable`, elle lit la table d'alias) ; aucune ne compare un moteur à un littéral.

| Signature | Rôle |
|---|---|
| `private.unit_token(p_raw text) returns text` (strict) | Jeton D9 |
| `private.normalize_unit(p_raw text, out unit_code text, out pricing_status public.estimate_line_pricing_status)` | Unité active ou statut ; deux `null` si inconnu, vide ou nul |
| `private.estimate_round_half_up(numeric) returns bigint` ; `(numeric, integer) returns numeric` (strictes) | ⌈x⌋ = ⌊x + ½⌋, x ≥ 0 ; demi supérieur à 0 à 12 décimales, échelle fixe |
| `private.estimate_allocate_exact(bigint, numeric[])` ; `(bigint, numeric[], uuid[])` | Plus grand reste ; ex aequo par position, ou par uuid croissant (résultat dans l'ordre d'entrée) |
| `private.estimate_v3_line(p_item jsonb, p_params jsonb) returns jsonb` | Ligne brute (§4, étapes 1 à 5) |
| `private.estimate_v3_compute_items(p_items jsonb, p_params jsonb) returns jsonb` | Devis complet (§4) : `{ lines, totals }` du contrat canonique |

Aides internes (mêmes propriétés) : `estimate_v3_input_number`, `estimate_v3_amount`, `estimate_v3_read_params`,
`estimate_v3_read_item`, `estimate_v3_line_values` ; types composites `estimate_v3_params_input`,
`estimate_v3_item_input`, `estimate_v3_line_gross`. Erreurs : message = code exact, détail en `DETAIL`.

Appel en `psql`, en `postgres`, sur une pile possédée (celle de `npm run dev:army` ou une pile native jetable ;
`DB_URL` vient de `supabase status --env --workdir <projet>`, jamais de la pile partagée 45585/33485) :

```bash
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -At -c "select jsonb_pretty(private.estimate_v3_compute_items(
  '[{\"id\": \"00000000-0000-4000-8000-000000000001\", \"item_type\": \"line\", \"parent_id\": null,
     \"quantity\": 20, \"unit_price_ht_cents\": 5466, \"k_fo\": 1, \"h_mo_per_unit\": 1.991,
     \"h_mo_atelier_per_unit\": null, \"h_mo_chantier_per_unit\": null, \"h_mo_majoration\": 1,
     \"k_mo\": 1, \"k_mo_atelier\": null, \"k_mo_chantier\": null, \"labor_rate_cents\": 4000,
     \"labor_rate_atelier_cents\": null, \"labor_rate_chantier_cents\": null,
     \"pricing_status\": \"priced\", \"tax_rate_bp\": 2000, \"unit_code\": \"ml\"}]'::jsonb,
  '{\"sale_coefficient_fo\": 1.30, \"sale_coefficient_mo\": 1.20, \"discount_amount_cents\": null,
    \"discount_bp\": 0, \"rounding_mode\": \"none\", \"rounding_step_cents\": 1,
    \"reverse_charge\": false, \"labor_split_enabled\": false}'::jsonb))"
```

Sortie attendue (O1 seule) : `pu_ht_cents` 16 663, `gross_ht_cents` 333 260, `cost_ht_cents` 268 600, `h_mo`
`"39.820"`, `h_mo_atelier` et `h_mo_chantier` nuls (I-04), chantier brut = MO brute (I-01), TVA 66 652,
TTC 399 912, coefficient réalisé `"1.240730"`.

## Interprétations

Chaque point est un choix là où la conception ou le contrat partagé laissaient une marge. Les règles I-01 à
I-06 ci-dessus en font partie ; elles remplacent les choix contraires des pistes.

### Calcul et entrées (TS et SQL)

1. **Négatifs refusés** (`ESTIMATE_V3_INPUT_INVALID`) : D13 ne définit le demi supérieur que pour x ≥ 0.
   Point ouvert : ristournes ou lignes de moins-value négatives (hors lot 2).
2. **Valeurs nulles ou absentes d'une ligne** : quantité, PR, heures par unité et taux horaires nuls valent 0
   dans le calcul ; `k_fo`, `k_mo`, `k_mo_atelier`, `k_mo_chantier` et `h_mo_majoration` nuls valent 1 (comme
   la v2). Sont exigés : `id`, `item_type`, et sur une ligne `pricing_status` et `tax_rate_bp` (0 à 10 000).
3. **Déclenchement de la ventilation** (`hasActiveLaborSplitPayload` transposé) : `labor_split_enabled` et une
   charge active : h_at/u > 0, h_ch/u > 0, taux atelier ou chantier non nul (le JSON canonique ne porte pas les
   identifiants de rôle : la présence d'un rôle devient celle de son taux), `k_mo_atelier` ou `k_mo_chantier`
   ≠ 1. Avec ventilation, l'atelier/chantier brut est réparti selon (maj × MO_at_u, maj × MO_ch_u), au même
   résultat que × c_MO.
4. **Ligne non chiffrée** : n'est pas calculée (ni PU ni contrôle de dépassement sur ses saisies, qui sont
   pourtant validées) ; tous ses montants valent 0, elle n'entre dans aucun groupe de TVA ; avertissement TS
   seulement (le contrat canonique n'a pas de champ d'avertissement).
5. **Échelles d'entrée** (schéma vivant) : quantité, `k_fo`, `k_mo*` `numeric(12,3)` ; `h_mo_majoration` et
   heures par unité `numeric(12,4)` ; coefficients de vente `numeric(8,4)` dans ]0 ; 10] ; centimes, taux
   horaires, `tax_rate_bp` et `discount_bp` (0 à 10 000), pas d'arrondi (≥ 1, I-05) entiers ≤ 2 147 483 647.
   Les zéros de queue ne comptent pas.
6. **Nombres** : le contrat canonique ne porte que des nombres JSON. Le TS lit un nombre JS par sa chaîne la plus
   courte (`String(n)`, exposant refusé) et accepte aussi une chaîne décimale (saisie de l'éditeur) ; le SQL
   refuse une chaîne. Cette asymétrie est voulue et hors du contrat de parité.
7. **Ordre des erreurs** : toutes les entrées sont validées avant tout calcul ; une entrée invalide l'emporte
   sur un dépassement.
8. **Remise** : `discount_amount_cents` non nul (0 compris) = intention en montant ; avec un `discount_bp` non
   nul, refus (intention double) ; sinon taux (`discount_bp` 0 = aucune remise).
9. **Récapitulatif de TVA** : un groupe par taux porté par au moins une ligne chiffrée, même de base nulle ; par
   taux croissant ; vide sans ligne chiffrée. Autoliquidation : groupes conservés, TVA 0.
10. **Sorties** : seules les lignes figurent dans `lines`, dans l'ordre d'entrée ; identifiants rendus en
    minuscules. `parent_id` n'est pas rapproché d'une section de l'entrée.
11. **Coefficient réalisé** : ⌈N × 10⁶ / Σ D⌋ par division entière exacte ; « 1.000000 » si Σ D = 0 et N = 0
    (devis vide compris), nul si Σ D = 0 et N > 0. Le « 1.258472 » de S1 est dérivé des sommes de la
    conception, non donné par elle.
12. **Unité** : `unit_code` (nul ou texte) n'est ni validé contre le référentiel ni utilisé par le calcul ;
    l'unité requise au gel relève de M4.
13. **Avertissement `ESTIMATE_V3_LABOR_RATE_MISSING`** (TS) : une ligne chiffrée porte des heures sans taux ;
    le taux nul vaut 0, comme en v2.
14. **Invariants** revérifiés à la fin de chaque calcul TS (Σ nets = HT, 0 ≤ net ≤ brut, Σ TVA de ligne,
    FO + MO = net, atelier + chantier = MO, A < pas) ; une violation lève `ESTIMATE_V3_ENGINE_INVARIANT_BROKEN`
    (défaut du moteur, jamais un résultat).

### Façade, projection et marge (TS)

15. **Contexte §6.5** : nombres JSON comme dans l'exemple de la conception ; `labor_roles` est passé par
    l'appelant (2.5).
16. **Marque nette** : `computeEstimateV3NetMarginBp` = ⌈(N − Σ D) × 10 000 / N⌋, nulle si N = 0 ; la règle
    `min_margin` reste en 2.5. **T-MARG** : la conception ne fixe pas la ligne ; Q 4, PR 10 000 c, 0,5 h/u à
    4 000 c/h, c 1,25 / 1,25, remise 20 %.
17. **T-STAT** : le libellé « Hors lot » est dans `units.json` (impression en 2.7) ; 2.4 prouve la contribution
    nulle et l'avertissement.
18. **Façade** : un appel v3 de forme v1/v2 (sans `v3`) lève toujours `EstimateEngineUnavailableError` ; seuls le
    titre et le transtypage du test 2.1 changent, pas son assertion.

### Référentiel d'unités et M3 (SQL)

19. **Enum de statut en M3, non en M4** (écart à §6.1) : `measurement_unit_aliases.pricing_status` en a besoin.
    M4 ne le recréera pas.
20. **Jeton** : la mise en minuscules ne touche que A-Z (collation `"C"` en SQL, `[A-Z]` en TS) ; après NFKD et
    retrait des diacritiques, les lettres non ASCII restantes ne changent pas ; espaces retirés : espace,
    tabulation, saut de ligne, retour, saut de page, tabulation verticale.
21. **Référentiel retenu** : `u`, `ens`, `fft`, `ml` (`m`, « mètre » = `ml`), `m2`, `m3`, `kg`, `t`, `l`, `h`,
    `j`, `pouce` (sans conversion) ; `ens` ≠ `fft` ; pas de millilitre ; les conditionnements relèvent de 2.9 ;
    « Lot » n'est pas mappé. Statuts : HL, « hors lot » → `out_of_scope` ; PM → `for_memory` ; NC →
    `not_priced` ; inc, incl, CP, « inclus », « compris » → `included` ; SO → `not_applicable`.
22. **« anon : 0 ligne »** est obtenu par refus (42501, aucun droit), conformément à I6 ; `service_role` garde ses
    droits de table (`security-invariants.test.sql` l'exige).
23. **Contrainte de jeton** par expression régulière (une contrainte s'exécute sous le rôle qui écrit, sans accès
    à `private`) ; la suite pgTAP vérifie que chaque jeton stocké est un point fixe de `unit_token`.
24. **Dérive du référentiel** : `npm run units:sql -- --check` et le test Vitest de parité des blocs échouent dès
    que `units.json` diffère de M3 ou de l'attendu pgTAP. Après publication de M3, une évolution du référentiel
    exige une nouvelle migration.

### Preuves (intégration)

25. **« 10 000 lignes et 300 devis »** (§5.5, §14) : 10 000 lignes tirées au hasard, chacune chiffrée seule
    (un devis d'une ligne), **et** 300 devis tirés au hasard (12 244 lignes), plus 48 cas limites nommés qui
    doivent être refusés ou calculés à l'identique ; comparaison du JSON canonique complet, ou du même code et
    du même SQLSTATE.
26. **Harnais de parité** : `owned-native-stack.ts` reprend le modèle de `upgrade-check.ts` (projet isolé, ports
    libres hors plage éphémère et jamais 45585/33485/3107, runtime natif, `stop` puis `stack destroy` en
    `finally`) ; `upgrade-check.ts`, preuve de 2.0 rejouée à l'identique, n'est pas refactorisé (doublon
    assumé, à factoriser plus tard).
27. **Lots OPTIMA** : colonnes lues par le profil OPTIMA de 2.3 (`detectImportProfile`, paramètres de la ligne 2,
    majoration additive 1 + N) ; ligne chiffrée comme dans la reproduction (« Prix Unitaire » > 0 et Qté > 0,
    hors « Sous-total » / « Total ») ; ligne à statut = « Uté » normalisée en statut, entrée comme ligne non
    chiffrée avec ses nombres ; PR FO arrondi au centime par le demi supérieur (P-10) ; « Prix Unitaire » et
    « Prix Total » (cellules flottantes) lus à 15 chiffres significatifs (précision d'Excel), puis au centime
    par le demi supérieur ; aucune entrée moteur n'est arrondie (une valeur hors échelle arrête le script).
28. **Performance** : « entrée comparable » = les mêmes lignes tirées au hasard (sections de 25 lignes, quantité
    à 3 décimales, PR, heures à un taux de rôle, remise fixe de 10 €, TVA 20 %), en heures par unité pour la v3
    et en heures de ligne Q × h/u pour la v2 (moteur 2, marge fixe 1,25) ; exécutions entrelacées après 20 tours
    de chauffe ; 200 échantillons par série.

## Preuves rouges

### Piste A (moteur TS, `de2c86db`, sur `e30560f4` plus les seuls tests)

`npx vitest run --project=node src/lib/estimates/engine-v3 src/lib/estimates/engine` :

```text
 FAIL  |node| src/lib/estimates/engine/compute.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3' imported from …/engine/compute.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/allocate.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3/allocate' imported from …/engine-v3/allocate.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/oracle.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/properties.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/requirements.test.ts
 Test Files  5 failed | 2 passed (7)
      Tests  19 passed (19)
```

Les deux fichiers verts sont déjà livrés (`engine/capabilities.test.ts` de 2.1, `engine-frozen-corpus.test.ts`
de 2.0). Contre-épreuve de la piste A : une remise en taux tronquée au lieu du demi supérieur rend
`properties.test.ts` rouge.

### Piste B (jumeau SQL et unités, `bccdd971`, tests seuls)

- `npx vitest run --project=node src/lib/units` : échec, module absent
  (`Cannot find module '../../../scripts/units/generate-units-sql'`).
- `npm run db:ci:local` (WSL) : `Files=17, Tests=1371, Result: FAIL` ; les 15 suites existantes passent ;

```text
estimate-engine-v3-functions.test.sql (Wstat: 768 (exited 3) Tests: 6 Failed: 6)
  ERROR:  function private.estimate_round_half_up(numeric) does not exist
measurement-units.test.sql (Wstat: 768 (exited 3) Tests: 37 Failed: 37)
  ERROR:  relation "public.measurement_units" does not exist
```

Retouches après le rouge, sans affaiblissement : la suite d'unités accorde la lecture de ses tables temporaires
d'attendu à `authenticated` avant de changer de rôle ; `normalize.test.ts` gagne un test de dérive.
Contre-épreuves de la piste B : TVA tronquée → 2 échecs ; ex aequo par clé décroissante → 3 échecs.

### Intégration (`63727954`, tests seuls, sur la fusion `c16e8703`)

TS, `npx vitest run --project=node src/lib/estimates/engine-v3/requirements.test.ts` :

```text
     × ignores the split payload when the version flag is off
     × I-01 puts the whole MO on chantier without the labour split, gross and net (v2 convention)
     × I-01 refuses a frozen line whose atelier and chantier no longer carry its MO
     × I-02 validates sections like the SQL twin: uuid id, null or uuid parent, ids unique across items
     × I-03 requires the eight canonical parameter keys, discount_amount_cents included
AssertionError: expected +0 to be 3000 // Object.is equality
 Test Files  1 failed (1)
      Tests  5 failed | 54 passed (59)
```

I-04, I-05 et I-06 passent déjà en TS (règle TS retenue) : leur rouge est côté SQL. Suite
`estimate-engine-v3-functions.test.sql` exécutée par `psql` sur un PostgreSQL 17.11 du paquet natif lancé seul
dans WSL (boucle de mise au point : rôles `anon`, `authenticated`, `service_role` et schéma `private` créés, M3
seule appliquée) :

```text
not ok 111 - T-HMO PU 3 250, total 32 500, MO 22 500 (v2: 12 250), hours 5.000
not ok 129 - T-STAT an out-of-scope line priceable at 500 EUR contributes 0 everywhere, PU null
not ok 135 - F5 labour split: MO_u = 1 h x 40 EUR + 0.5 h x 50 EUR, PU 7 800 at c_MO 1.2, atelier 9 600 / chantier 6 000
not ok 171 - I-04 a null hours-per-unit column gives null line hours; a non-priced line with hours per unit gives 0.000
#         have: [["0.000", "0.000", "0.000"], ["0.000", "0.000", "0.000"]]
#         want: [[null, null, null], ["0.000", null, null]]
not ok 172 - I-06 derived line hours beyond numeric(12,3) overflow, even at no cost
#       caught: no exception
#       wanted: 22003
not ok 189 - F12 rounding none with a step of 0 is refused as ESTIMATE_V3_INPUT_INVALID
1..198
# Looks like you failed 6 tests of 198
```

Après `a0f26a90` : 59/59 en TS, 198/198 sur la même boucle SQL (la preuve d'autorité est `db:ci:local`
ci-dessous). Seule retouche des tests après le rouge : le test I-03 retire la clé sans variable inutilisée
(lint) ; son assertion est inchangée.

## Résultats (17/10/2026)

Windows : Node 24.19.0, worktree `miaouffrage-l2-24`. WSL : Ubuntu 24.04, Node 24.14.0, clone
`~/miaouffrage-lot2-24` remis à `a0f5cac9` (arbre propre ; le commit de ce document ne touche que lui), une
exécution native possédée à la fois, sous le verrou partagé.

| Preuve | Commande | Résultat |
|---|---|---|
| Moteur TS, unités, corpus figé, règle de lint | `npx vitest run --project=node src/lib/estimates/engine-v3 src/lib/estimates/engine src/lib/units src/lib/estimates/engine-frozen-corpus.test.ts src/test/engine-version-lint.test.ts` | 9 fichiers, 209 tests verts |
| Corpus figé v1/v2 | `npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts` | 2/2, identique |
| Parité TS/SQL (WSL, pile jetable possédée) | `npm run engine:v3:parity` | **0 écart** sur 10 348 cas (détail ci-dessous) |
| Lots OPTIMA (Windows, local, hors CI) | `npm run engine:v3:optima-lot-check -- "<docs/prd_file/exemple chiffrage OPTIMA>/BEING - DPGF HYDRAULIQUE.xlsx" "<…>/BEING - DPGF PLOMBERIE.xlsx"` | « Lots OPTIMA conformes au §5.4 » (tableau ci-dessous) |
| Performance (Windows) | `npm run engine:v3:performance` | 1 000 lignes : p95 8,26 ms (≤ 50) ; 3 000 lignes : v3/v2 = 0,385 en p50 (≤ 2) |
| Montée de version (WSL) | `npm run db:upgrade-check -- lot2-2-4` | 244 migrations de base, 3 ultérieures appliquées (dont M3) ; « comparison found 0 difference(s) » ; contre-épreuve détectée ; `passed` |
| Empreintes documentaires (WSL) | `npm run engine:document-fingerprints -- check` | 14 familles v1/v2 ; « Document fingerprints identical » |
| SQL et RLS (WSL) | `npm run db:ci:local` | pile jetable, base réinitialisée, inventaire conforme ; pgTAP `Files=17, Tests=1714, Result: PASS` (1 711 de la piste B + I-04, I-06 et la 25ᵉ entrée invalide) ; « Behavioral RLS matrix passed. » ; garde F-SQL-14 : « Entrées de la liste blanche sans comparaison littérale : aucune » |
| Types | `npm run typecheck` | sortie 0 |
| Lint | `npx eslint <les 29 fichiers .ts et .mjs touchés depuis e30560f4> --max-warnings=0` | sortie 0 |
| Architecture | `npm run check:architecture` | « Architecture budgets passed (1116 modules, 0 allowed runtime cycles) » |
| Migrations | `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` ; `npm run units:sql -- --check` | 247 fichiers, 247 versions ; garde passée (2 changements) ; blocs alignés |
| Fichiers moteur v1/v2 | `git diff --stat e30560f4 -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` (et contre `origin/main`) | vide |
| Espaces et fins de ligne | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; `git ls-files --eol src/types/database.ts` | propre ; `i/crlf w/crlf` |

### Parité TS/SQL

`npm run engine:v3:parity` (graine 20261017) à `a0f5cac9` : 10 348 cas = 10 000 lignes seules, 300 devis
(12 244 lignes) et 48 cas limites ; TS 884 ms, SQL 12 071 ms (`private.estimate_v3_compute_items`, en `postgres`,
psql 17.11) ; **0 écart** ; contre-épreuve détectée (un centime ajouté au HT d'une sortie SQL) ; pile arrêtée,
détruite, répertoire retiré. Mêmes résultats au premier passage à `c0b450e7`. Rapport :
`~/miaouffrage-lot2-24/.e2e/engine-v3/parity/2026-10-17T14-45-45-006Z-seed-20261017/report.json` (cas et sorties
SQL archivés en gzip à côté, empreinte des cas `3ef1f24b…`).

Couverture : 989 sections ; 18 976 lignes chiffrées et 3 314 non chiffrées (652 `included`, 692 `for_memory`,
611 `not_priced`, 692 `out_of_scope`, 667 `not_applicable`) ; 19 190 quantités à 3 décimales ; 14 008 heures
par unité à 4 décimales ; 301 lignes dont le montant de vente unitaire exact tombe sur un demi-centime ;
883 lignes ventilées ; 1 030 cas en autoliquidation ; 290 devis multi-taux ; remise en montant (80) et en
taux (92), dont 20 plafonnées au brut ; arrondi `down` sur 108 devis, appliqué sur 89 ; 254 devis avec des bruts
égaux (ex aequo de répartition) ; 387 identifiants en majuscules. Cas limites : 11 calculés, 31 refusés
`ESTIMATE_V3_INPUT_INVALID` (22023), 6 `ESTIMATE_AMOUNT_OVERFLOW` (22003), identiques des deux côtés. Sur la
boucle PostgreSQL de mise au point, une sortie SQL altérée à la main donnait bien 1 écart sur 10 348.

### Lots OPTIMA (§5.4, tolérance 0 c)

| Lot | PU v3 = « Prix Unitaire » | PT identiques ; écart max | Σ v3 à 1,3 / 1,3 (classeur) | Σ v3 à 1,30 / 1,20 | Déboursé | Coefficient réalisé | Lignes à statut | Contribution des non chiffrées |
|---|---|---|---|---|---|---|---|---|
| Hydraulique | **785/785** | 392/785 ; 7,94 € | **1 644 207,61 €** (1 644 173,89 €) | **1 572 320,99 €** | 1 264 749,07 € | **1,243188** | 61 HL, 9 inc, 7 NC, 1 PM, 1 CP | 0 c |
| Plomberie | **656/656** | 310/656 ; 2,03 € | **1 027 655,61 €** (1 027 637,33 €) | **981 887,92 €** | 790 490,05 € | **1,242126** | 74 HL, 4 NC, 3 SO, 1 PM | 0 c |

Tous les nombres du §5.4 sont reproduits sans retouche. Le premier passage a échoué sur un seul point : la
comparaison des statuts dépendait de l'ordre des clés (défaut du script, corrigé par une égalité profonde) ; les
nombres étaient déjà identiques. Rapport : `.e2e/engine-v3/optima-lot-check/2026-10-17T14-43-05-035Z/report.json`
du worktree Windows (nombres et numéros de ligne seulement, aucune désignation).

### Performance (Windows, Node 24.19.0, 200 échantillons entrelacés, 20 tours de chauffe)

| Série | p50 | p95 | max | moyenne |
|---|---|---|---|---|
| v3, 1 000 lignes | 6,72 ms | **8,26 ms** (≤ 50 ms) | 12,58 ms | 6,67 ms |
| v3, 3 000 lignes | 20,56 ms | 23,68 ms | 33,01 ms | 20,39 ms |
| v2 (`computeEstimateBreakdown`), 3 000 lignes | 53,47 ms | 58,75 ms | 62,57 ms | 52,65 ms |

Rapport v3/v2 à 3 000 lignes : **0,385** en p50, 0,403 en p95 (≤ 2). Mesure prise pendant qu'une pile native
tournait dans WSL : les valeurs absolues sont plus hautes que la mesure ponctuelle de la piste A (p95 4,3 ms à
1 000 lignes) ; les critères tiennent. Échantillons bruts :
`.e2e/engine-v3/performance/2026-10-17T14-41-48-573Z/report.json` du worktree Windows.

## Restes et points ouverts

- Suites complètes Vitest et E2E : CI GitHub de la PR (non lancées ici, à dessein).
- Point ouvert : valeurs négatives (ristournes, moins-values) refusées faute de règle d'arrondi (D13).
- Asymétrie voulue : chaînes décimales acceptées par le TS, refusées par le SQL (hors contrat canonique).
- `owned-native-stack.ts` double une partie de `upgrade-check.ts` (preuve de 2.0 laissée intacte) : à factoriser
  dans un sous-lot ultérieur.
- M3 a été modifiée après les commits de la piste B (non publiée) ; une fois publiée, toute évolution, référentiel
  d'unités compris, exige une nouvelle migration.
- La performance est une mesure ponctuelle sur ce poste, pas un test de CI.
