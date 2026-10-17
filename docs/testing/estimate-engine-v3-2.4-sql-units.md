# Moteur v3 : jumeau SQL et référentiel d'unités (sous-lot 2.4, piste B)

Statut : **implémenté et prouvé** : tests d'exigence écrits rouges d'abord (`bccdd971`), puis implémentation
et migration M3 (`b2c3eb09`). Branche
`lot2/2.4-sql-units`, partie de `origin/lot2/2.1-socle-ferme` (`e30560f4` = `main` + 2.1). Document de piste :
l'agent d'intégration le fusionne dans le document principal du sous-lot 2.4.
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, §2, D1,
D4 à D9, D12, D13, D18, §4 (contrat de calcul), §5 (oracle, scénarios, tolérances), §6.1 (M3), §6.2, §6.5,
§7, §8.1, §10.1, §14 « 2.4 » ; décisions P-01 à P-19 (validées le 16/10/2026).

Code **inerte** : aucun écran, aucun écrivain, aucune RPC ne crée de v3. Les fonctions de M3 ne lisent aucune
ligne de devis : elles calculent sur des paramètres. `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` restent à zéro ligne de diff ; aucune ligne ni colonne existante ne change.

## Périmètre de la piste B

| Fichier | Rôle |
|---|---|
| `src/lib/units/units.json` | Source unique du référentiel : unités, alias, statuts (D9) |
| `src/lib/units/normalize.ts` | Jeton et normaliseur TS (`measurementUnitToken`, `normalizeMeasurementUnit`) |
| `src/lib/units/normalize.test.ts` | 40 vecteurs, parité des blocs générés |
| `scripts/units/generate-units-sql.ts` | Génère le bloc `VALUES` de M3 et le bloc attendu de la suite pgTAP ; `--check` échoue en cas de dérive |
| `supabase/migrations/20261017134443_estimate_engine_v3_functions_and_units.sql` | M3 |
| `supabase/tests/database/estimate-engine-v3-functions.test.sql` | Jumeau SQL du moteur : oracle, scénarios, cas d'exigence, répartition, erreurs |
| `supabase/tests/database/measurement-units.test.sql` | Référentiel : schéma, RLS, 40 vecteurs, parité avec `units.json` |
| `src/types/database.ts` (CRLF) | Deux tables publiques et l'enum de statut (D18) |

## Défaillances observables visées

### Référentiel d'unités et normaliseur (D9, P-08, P-09)

| # | Défaillance | Preuve |
|---|---|---|
| U1 | « ML », « mL », « Ml », « m.l. », « mètre linéaire » lus comme millilitre, ou refusés ; `m` distinct de `ml` (P-08 : `m` = `ml`) | vecteurs 1 à 11 (TS et SQL) |
| U2 | Un statut placé dans la colonne unité (HL, PM, NC, inc, incl, CP, SO) pris pour une unité, ou une unité pour un statut | vecteurs 31 à 38 ; CHECK « exactement une cible » |
| U3 | Jeton TS ≠ jeton SQL : accents décomposés (NFD), espace insécable, pleine chasse, exposants, casse, points et tirets. L'import TS (2.8) et le gel SQL (2.5) ne verraient pas la même unité | mêmes 40 vecteurs dans les deux langages ; jeton SQL de chaque alias brut = jeton calculé en TS (bloc généré) |
| U4 | Dérive entre `units.json` et la base : alias ajouté au JSON mais non migré, bloc de migration édité à la main | `generate-units-sql.ts --check` ; test Vitest de parité des blocs ; pgTAP table = bloc attendu généré |
| U5 | Alias ambigu : un jeton vers deux cibles, un jeton non canonique stocké, un code d'unité qui n'est pas son propre jeton | refus du générateur ; clé primaire sur le jeton ; pgTAP `unit_token(token) = token` |
| U6 | `anon` lit le référentiel ; `authenticated` l'écrit ; RLS absente | pgTAP : privilèges, refus 42501 pour `anon` en lecture et pour `authenticated` en écriture, RLS active |
| U7 | Millilitre réintroduit sous une autre graphie | vecteur 39 (« millilitre » → aucune unité) ; refus du générateur |
| U8 | Types de base faux : colonne absente ou de mauvais type par rapport à `src/types/database.ts` | pgTAP `has_column` / `col_type_is` (D18) ; `tsc` |
| U9 | Entrée nulle ou vide résolue en unité par défaut (« u ») au lieu d'aucune | vecteur 40 et cas `null` |

### Jumeau SQL du moteur (§4, D7, D8, D13)

| # | Défaillance | Preuve |
|---|---|---|
| F1 | Arrondi faux au demi-centime : arrondi bancaire (`bankersRound` de la v2), demi inférieur, flottant | `estimate_round_half_up` : 0,5 → 1, 2,5 → 3 ; T-HALF3 (Q 1,005 × 100 c → 101) |
| F2 | Double arrondi : FO et MO arrondis séparément avant le PU | O1 à O7 (16 663 … 7 388 c ; 17 459 … 7 908 c à 1,3 / 1,3) ; T-PU ; A-05 |
| F3 | Brut ≠ ⌈Q × PU⌋ : total calculé sur le PU non arrondi (règle des offres OPTIMA) | totaux O1 à O7, Σ 6 905 456 c ; T-HMO, T-HMO-Q, T-Q0 |
| F4 | MO par unité non multipliée par Q (v2 : 12 250 au lieu de 32 500) ; majoration ignorée | T-HMO, T-HMO-Q ; cas de majoration 1,1 |
| F5 | Ventilation atelier/chantier déclenchée sans charge active, ou ignorée avec charge | cas de ventilation (actif / drapeau de version faux) |
| F6 | Répartition inexacte : Σ parts ≠ montant ; part dépendant de l'ordre d'entrée ; ex aequo départagés par l'ordre d'affichage ; W = 0 qui divise par zéro | `estimate_allocate_exact` : S5 `[5, 1, 2, 23, 0, 69, 1]`, permutation, W = 0, ex aequo par clé, 1 000 tirages ; réduction d'un centime sur deux lignes égales |
| F7 | Remise : deux intentions acceptées ensemble ; remise au-delà du brut (net négatif) ; taux arrondi par division imprécise | S2, S3, EU01, EU01-b, EUHIST, CAP ; refus 22023 |
| F8 | Arrondi commercial appliqué après la TVA, ou hors de la base de TVA | S4, T-TAXSNAP, R1-ARR ; `rounding_adjustment_cents = 0` |
| F9 | TVA ligne à ligne (S5 : 1 325 527 au lieu de 1 325 525 ; T-TVA-ARR : 21 au lieu de 20) ; Σ TVA de ligne ≠ T_r ; autoliquidation qui taxe | S1, S5, T-TVA1, T-TVA-ARR, A-06 (ΔTVA 40 c sur 1 004 lignes) ; autoliquidation ; invariants |
| F10 | Ligne non chiffrée qui contribue ; section qui porte un montant ou apparaît dans les lignes | T-STAT ; les cinq statuts ; section parente |
| F11 | Dépassement écrêté au lieu d'être levé ; TTC ou déboursé au-delà de 2 147 483 647 non détectés | T-CAP, Σ brut, TTC, déboursé : 22003 `ESTIMATE_AMOUNT_OVERFLOW` |
| F12 | Entrée invalide acceptée en silence : négatif, trop de décimales pour l'échelle de la colonne, chaîne au lieu d'un nombre, coefficient 0 ou > 10, mode d'arrondi v2, deux intentions, statut ou type inconnu, identifiant dupliqué, clé de paramètre absente | 22023 `ESTIMATE_V3_INPUT_INVALID` (24 cas) |
| F13 | Division `numeric` imprécise : coefficient réalisé, remise en points de base, TVA | coefficients réalisés exacts (S1 1,258472 ; EU01 0,999949 ; T-MARG 1,000000) ; division entière exacte dans les fonctions |
| F14 | Monotonie rompue : un coût d'entrée plus élevé abaisse le HT | T-MONO (15 999 998 puis 16 000 000) |
| F15 | Fonctions exécutables par `public`, `anon`, `authenticated` ou `service_role` ; `search_path` non figé ; comparaison du moteur à un littéral (garde F-SQL-14 de 2.1) | pgTAP privilèges et `proconfig` ; suite 2.1 inchangée et verte |
| F16 | Montants v1/v2 modifiés | `git diff --stat` vide sur les deux fichiers moteur ; aucune table existante modifiée ; suites existantes vertes |

## Justification des tests isolés

Le moteur v3 est **inerte** en 2.4 : aucun écran, aucune RPC, aucun écrivain ne l'appelle, et aucune v3 ne peut
être créée. Aucun parcours E2E ne peut donc l'atteindre (la conception le note : « aucun parcours nouveau,
moteur dormant »). Les défaillances visées sont précisément celles que la politique de tests admet en
isolation :

- **arithmétique au demi-centime et répartition exacte** (F1 à F9, F13, F14) : un écart d'un centime sur un
  montant contractuel, invisible dans une interface qui n'existe pas encore ; le jumeau SQL sera la référence
  du gel (D12), il doit être juste avant que 2.5 le branche ;
- **parité TS/SQL** (U3, U4) : le même jeton doit sortir des deux langages ; seule une comparaison directe des
  sorties le prouve ;
- **intégrité SQL** (U2, U5, U6, U8, F11, F12, F15) : contraintes, RLS d'une table qu'aucun écran ne lit
  encore, privilèges des fonctions, refus nommés ;
- **cas limites d'analyse** (U1, U7, U9) : graphies d'unités issues des DPGF et des classeurs OPTIMA.

Les suites pgTAP s'exécutent sur la pile native jetable de `npm run db:ci:local` (WSL, clone Linux), avec
toutes les autres suites et la matrice RLS.

## Contrat SQL livré

Toutes les fonctions sont dans `private`, `immutable` (sauf `normalize_unit`, `stable` : elle lit la table
d'alias), `security invoker`, `search_path = ''`, et révoquées pour `public`, `anon`, `authenticated` et
`service_role` : seul le propriétaire (`postgres`) les exécute. Aucune ne compare un moteur à un littéral
(garde F-SQL-14 de 2.1 inchangée).

| Signature | Rôle |
|---|---|
| `private.unit_token(p_raw text) returns text` (strict) | Jeton D9 |
| `private.normalize_unit(p_raw text, out unit_code text, out pricing_status public.estimate_line_pricing_status) returns record` | Unité active ou statut ; deux `null` si inconnu, vide ou nul |
| `private.estimate_round_half_up(p_value numeric) returns bigint` (strict) | ⌈x⌋ = ⌊x + ½⌋, x ≥ 0 |
| `private.estimate_round_half_up(p_value numeric, p_scale integer) returns numeric` (strict) | Demi supérieur à `p_scale` décimales (0 à 12), échelle fixe |
| `private.estimate_allocate_exact(p_amount bigint, p_weights numeric[]) returns bigint[]` | Plus grand reste, ex aequo par position (fo puis mo, atelier puis chantier) |
| `private.estimate_allocate_exact(p_amount bigint, p_weights numeric[], p_keys uuid[]) returns bigint[]` | Plus grand reste, ex aequo par uuid croissant ; résultat dans l'ordre d'entrée |
| `private.estimate_v3_line(p_item jsonb, p_params jsonb) returns jsonb` | Ligne brute (§4, étapes 1 à 5) : `id`, `pricing_status`, `tax_rate_bp`, `pu_ht_cents`, `gross_ht_cents`, `gross_fo_ht_cents`, `gross_mo_ht_cents`, `gross_mo_atelier_ht_cents`, `gross_mo_chantier_ht_cents`, `cost_ht_cents`, `h_mo`, `h_mo_atelier`, `h_mo_chantier` |
| `private.estimate_v3_compute_items(p_items jsonb, p_params jsonb) returns jsonb` | Devis complet (§4) : `{lines, totals}` du contrat canonique |

Aides internes (mêmes propriétés) : `private.estimate_v3_input_number(jsonb, text, integer, numeric, numeric,
boolean)`, `private.estimate_v3_amount(numeric, text)`, `private.estimate_v3_read_params(jsonb)`,
`private.estimate_v3_read_item(jsonb)`, `private.estimate_v3_line_values(private.estimate_v3_item_input,
private.estimate_v3_params_input)` ; types composites `private.estimate_v3_params_input`,
`private.estimate_v3_item_input`, `private.estimate_v3_line_gross`.

Erreurs : message = code exact, détail en `DETAIL`. `ESTIMATE_V3_INPUT_INVALID` (SQLSTATE 22023) et
`ESTIMATE_AMOUNT_OVERFLOW` (22003, tout montant publié > 2 147 483 647 c : PU, brut, parts, déboursé, TVA, TTC,
totaux ; jamais écrêté).

Appel en `psql`, en `postgres`, sur une pile possédée (celle de `npm run dev:army`, ou une pile native jetable ;
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

Sortie (O1 seule) : `pu_ht_cents` 16 663, `gross_ht_cents` 333 260, `cost_ht_cents` 268 600, `h_mo` `"39.820"`,
TVA 66 652, `total_ttc_cents` 399 912, `realized_sale_coefficient` `"1.240730"`. Une ligne se calcule aussi par
`select private.estimate_v3_line(<item>::jsonb, <params>::jsonb);`. Les entiers sortent en nombres JSON ;
`h_mo*` (3 décimales) et `realized_sale_coefficient` (6 décimales) en chaînes à échelle fixe ; les lignes dans
l'ordre d'entrée.

## Interprétations

Chaque point est un choix de la piste B là où la conception ou le contrat partagé laissent une marge ; la piste A
(moteur TS) et l'intégration doivent s'y aligner, ou le signaler.

1. **Enum de statut en M3, non en M4** (écart à §6.1) : `measurement_unit_aliases.pricing_status` en a besoin.
   M4 ne le créera donc pas et ajoutera seulement les colonnes.
2. **Déclenchement de la ventilation** (même règle qu'en v2, `estimate-calculations.ts:142-166`) : le JSON
   canonique ne porte pas les identifiants de rôle ; « rôle atelier/chantier affecté » est lu comme
   `labor_rate_atelier_cents` / `labor_rate_chantier_cents` non nul. Charge active si h/u atelier > 0, taux
   atelier présent, h/u chantier > 0, taux chantier présent, `k_mo_atelier ≠ 1` ou `k_mo_chantier ≠ 1`, et
   `labor_split_enabled` vrai.
3. **Sans ventilation, toute la MO est « chantier »** (convention v2, `estimate-calculations.ts:872-877`) :
   atelier 0, chantier = MO. Avec ventilation, l'atelier/chantier brut est réparti selon (MO_at_u, MO_ch_u),
   ce qui revient au même que selon (MO_at_u × c_MO, MO_ch_u × c_MO).
4. **Ligne non chiffrée** : `pu_ht_cents` nul, tous les montants à 0, heures `"0.000"` (« contribue 0
   partout »), réduction et TVA nulles, hors des groupes de TVA ; ses entrées sont tout de même validées. Le
   contrat de sortie n'a pas de champ d'avertissement : l'avertissement reste côté TS.
5. **Sections** : seuls `id`, `item_type` et `parent_id` sont validés ; elles n'apparaissent pas dans `lines`.
   `parent_id` n'est pas rapproché d'une section de l'entrée.
6. **Heures de ligne** : `round(Q × h/u, 3)` colonne par colonne (`h_mo` ← `h_mo_per_unit`, `h_mo_atelier` ←
   `h_mo_atelier_per_unit`, `h_mo_chantier` ← `h_mo_chantier_per_unit`), que la ventilation soit active ou
   non ; une valeur nulle vaut 0. Les heures ne sont pas bornées par le moteur (la colonne `numeric(12,3)`
   refusera en M4).
7. **Récapitulatif de TVA** : un groupe par taux porté par au moins une ligne chiffrée, même de base nulle
   (CAP : base 0, TVA 0) ; trié par taux croissant ; vide si aucune ligne chiffrée. Autoliquidation : groupes
   conservés, TVA 0.
8. **Valeurs nulles ou absentes d'une ligne** : défauts neutres de la v2 (quantité 0, PR 0, `k_*` 1,
   majoration 1, h/u 0, taux horaires 0). Sont exigés : `id` (uuid canonique, casse indifférente, rendu en
   minuscules), `item_type`, et sur une ligne `pricing_status` et `tax_rate_bp` (0 à 10 000). Les huit clés de
   `params` sont exigées ; seule `discount_amount_cents` peut valoir `null`.
9. **Nombres** : nombres JSON seulement (une chaîne est refusée) ; les zéros de queue ne comptent pas
   (`min_scale`) ; échelles et bornes des colonnes : quantité et `k_*` `numeric(12,3)` (< 10⁹), h/u et
   majoration `numeric(12,4)` (< 10⁸), coefficients de vente `numeric(8,4)` dans ]0 ; 10], montants et taux
   horaires `integer` (≤ 2 147 483 647), points de base 0 à 10 000. **Négatif refusé** : D13 ne définit le
   demi supérieur que pour x ≥ 0 (point ouvert : aucune ligne de rabais négative n'existe en v3).
10. **Ordre des erreurs** : toutes les entrées sont validées avant tout calcul ; une entrée invalide l'emporte
    donc sur un dépassement.
11. **Remise** : `discount_amount_cents` non nul (y compris 0) = intention en montant ; sinon taux
    (`discount_bp` 0 = aucune remise). Arrondi `none` : le pas est ignoré (tout entier ≥ 0 admis) ; `down`
    exige un pas ≥ 1.
12. **Réductions** réparties sur toutes les lignes, les non chiffrées ayant un poids nul (même résultat que
    sur les seules chiffrées, puisque R + A ≤ G).
13. **Coefficient réalisé** : ⌈N × 10⁶ / Σ D⌋ par division entière exacte ; `"1.000000"` si Σ D = 0 et N = 0,
    `null` si Σ D = 0 et N > 0 ; devis vide : `"1.000000"`.
14. **Unité** : `unit_code` n'est ni validé contre le référentiel ni utilisé par le calcul (fonction pure sur
    paramètres) ; l'unité requise au gel relève de M4.
15. **Jeton** : la mise en minuscules ne touche que A-Z, sous la collation `"C"` en SQL et par `[A-Z]` en TS,
    pour que le résultat ne dépende pas de la collation de la base ; après NFKD et retrait des diacritiques,
    les lettres non ASCII restantes (Œ, Æ…) ne changent pas, dans les deux langages. Espaces retirés : espace,
    tabulation, saut de ligne, retour, saut de page, tabulation verticale (les espaces Unicode, dont
    l'insécable, deviennent des espaces par NFKD).
16. **Normaliseur** : `normalize_unit` rend `(unit_code, pricing_status)` et ignore une unité inactive. Les
    noms TS exportés sont `measurementUnitToken` et `normalizeMeasurementUnit` (D9 : éviter la collision avec
    les `normalizeUnit` privés du métré, qui restent propres au métré).
17. **Référentiel retenu** (fixtures DPGF/OPTIMA du dépôt, D4 §1.6, P-08, P-09) : `u`, `ens`, `fft`, `ml`
    (`m`, « mètre » = `ml`), `m2`, `m3`, `kg`, `t`, `l` (litre), `h`, `j`, `pouce` (symbole `"`, sans
    conversion). `ens` ≠ `fft`. Pas de millilitre. Les conditionnements de la bible (Bout., Pot, Rl., Bob.,
    Jeu, Kit, Pqt, Paire, Bte) relèvent de l'unité d'achat (2.9) ; « Lot » n'est pas mappé (ambigu entre `ens`
    et `fft`). Statuts : HL, « hors lot » → `out_of_scope` ; PM, « pour mémoire » → `for_memory` ; NC,
    « non chiffré » → `not_priced` ; inc, incl, CP, « inclus », « compris » → `included` ; SO, « sans objet » →
    `not_applicable`. Les libellés des six statuts sont dans `units.json` (impression en 2.7).
18. **« anon : 0 ligne »** est obtenu par refus (42501, aucun droit), conformément à I6 (« rien pour anon ») :
    anon ne voit aucune ligne. `service_role` garde ses droits de table (`security-invariants.test.sql`
    l'exige sur toute table publique) ; « aucune écriture applicative » = aucun droit d'écriture pour
    `authenticated`.
19. **Contrainte de jeton** : la table vérifie un jeton déjà normalisé par une expression régulière, sans
    appeler `private.unit_token` (une contrainte s'exécute sous le rôle qui écrit, et `service_role` n'a pas
    accès à `private`) ; la suite pgTAP vérifie que chaque jeton stocké est un point fixe de `unit_token`.
20. **Dérive du référentiel** : `npm run units:sql -- --check` (défaut) et le test Vitest de parité des blocs
    échouent dès que `units.json` diffère de M3 ou de l'attendu pgTAP. Après publication de M3, une évolution
    du référentiel exige une nouvelle migration et l'adaptation du générateur.

## Résultats

### Rouge (commit `bccdd971`, tests seuls)

- `npx vitest run --project=node src/lib/units` : échec, module absent
  (`Cannot find module '../../../scripts/units/generate-units-sql'`), aucun test exécuté.
- `npm run db:ci:local` (WSL, clone `~/miaouffrage-lot2-24` à `bccdd971`) : pile démarrée, base réinitialisée,
  inventaire des migrations conforme ; pgTAP `Files=17, Tests=1371, Result: FAIL`. Les 15 suites existantes
  passent ; les deux nouvelles échouent :

```text
estimate-engine-v3-functions.test.sql (Wstat: 768 (exited 3) Tests: 6 Failed: 6)
  ERROR:  function private.estimate_round_half_up(numeric) does not exist
measurement-units.test.sql (Wstat: 768 (exited 3) Tests: 37 Failed: 37)
  ERROR:  relation "public.measurement_units" does not exist
```

Après le rouge, deux retouches des tests, sans affaiblissement : `measurement-units.test.sql` accorde la
lecture de ses tables temporaires d'attendu à `authenticated` avant de changer de rôle (sans quoi la
comparaison échouait par droit, pas par donnée) ; `normalize.test.ts` gagne un test de dérive (un alias ajouté
au JSON sans migration doit être signalé).

### Vert (commit `b2c3eb09`)

| Commande | Résultat |
|---|---|
| `npx vitest run --project=node src/lib/units` | 88/88 (40 vecteurs × jeton et cible, null, codes, `ens` ≠ `fft`, parité et dérive des blocs, conflit, millilitre) |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p tsconfig.json --noEmit` | sortie 0 |
| `npx eslint src/lib/units/normalize.ts src/lib/units/normalize.test.ts scripts/units/generate-units-sql.ts --max-warnings=0` | sortie 0 |
| `npm run units:sql -- --check` | « Blocs d'unités alignés sur units.json (migration M3 et suite pgTAP) » |
| `npm run supabase:manifest:add` / `supabase:validate` / `supabase:migrations:git-guard` | 247 entrées ; 247 fichiers, 247 versions ; garde passée (2 changements) |
| `npm run check:architecture` | passé (1 102 modules) ; `normalize.ts` 216 lignes non vides, générateur 192 |
| `git -c core.whitespace=cr-at-eol diff --cached --check` ; `git ls-files --eol src/types/database.ts` | propre ; `i/crlf w/crlf` |
| `git diff --stat e30560f4 -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts src/lib/estimates/engine src/lib/estimates/engine-v3` | vide |
| `npm run db:ci:local` (WSL, clone à `b2c3eb09`) | `Files=17, Tests=1711, Result: PASS` ; « Behavioral RLS matrix passed. » ; sortie 0 |

Le décompte pgTAP : 1 328 assertions des 15 suites existantes (mesurées au rouge), + 10 lignes de
`security-invariants.test.sql` pour les deux nouvelles tables (RLS active, droits `service_role`), + 373 dans
les deux nouvelles suites (178 pour le référentiel, 195 pour le jumeau). La garde F-SQL-14 de 2.1 rapporte
« Entrées de la liste blanche sans comparaison littérale : aucune » et ne trouve aucune nouvelle comparaison.

Boucle de mise au point (hors preuve) : PostgreSQL 17.11 du paquet natif Supabase, lancé seul dans un
répertoire temporaire WSL, sans pile Supabase. Mutations vérifiées : TVA tronquée au lieu du demi supérieur →
2 échecs (EU01, T-TVA-ARR) ; ex aequo par clé décroissante → 3 échecs (W = 0, ex aequo, remise d'un centime).
Calcul de 10 000 lignes par `private.estimate_v3_compute_items` : environ 1,0 s.

### Hors de la piste B

- Parité TS/SQL sur 10 000 lignes et 300 devis (`scripts/engine-v3/parity.ts`), lots OPTIMA complets (§5.4) et
  mesures de performance du moteur TS : pistes A et intégration.
- Test de montée de version (`npm run db:upgrade-check`) non rejoué par la piste B : M3 n'ajoute que des objets
  nouveaux et ne réécrit aucune ligne.
- Les interprétations 2 à 13 doivent être confrontées au moteur TS de la piste A par le harnais de parité.
