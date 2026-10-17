# Moteur v3 : jumeau SQL et référentiel d'unités (sous-lot 2.4, piste B)

Statut : **tests d'exigence écrits rouges d'abord**, puis implémentation (migration M3). Branche
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

À compléter après implémentation (signatures exactes et appel `psql`).

## Interprétations

À compléter au fil de l'implémentation.

## Résultats

À compléter : rouge (journal), puis vert.
