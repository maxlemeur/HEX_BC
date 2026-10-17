# Moteur v3 pur, jumeau SQL et référentiel d'unités (sous-lot 2.4)

Statut : **implémenté, intégré et prouvé en local** (17/10/2026). Branche `lot2/2.4-moteur-v3-pur`, partie de
`e30560f4` (`main` + 2.1). Deux pistes, une intégration, puis la reprise de la revue :

| Piste | Commits | Contenu |
|---|---|---|
| A, moteur TS | `de2c86db` (`test`, rouge), `e175f9eb` (`feat`) | `src/lib/estimates/engine-v3/*`, branche v3 de la façade `engine/compute.ts` |
| B, jumeau SQL et unités | `bccdd971` (`test`, rouge), `b2c3eb09` (`feat`), `384e8cb1` (`docs`) ; fusion `c16e8703` | M3, `src/lib/units/*`, `scripts/units/generate-units-sql.ts`, deux suites pgTAP, `src/types/database.ts` |
| Intégration | `63727954` (`test`, rouge), `a0f26a90` (`fix`), `c0b450e7` et `36b3fa8b` (`feat`), `a0f5cac9` et `b1eae40d` (`docs`) | règles communes I-01 à I-06, `scripts/engine-v3/parity.ts`, `optima-lot-check.ts`, `performance.ts` |
| Revue | `888ae6ff` (`test`, rouge), `24f1e906` (`fix`), ce document (`docs`) | constats R-01 à R-08 : chemin canonique strict, autoliquidation figée, contrôles OPTIMA, traçabilité des rapports, vecteurs d'unités, campagne `calc-v3`, D9, contrainte de 2.5 |

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
| I-04 | h/u nul : TS rendait des heures nulles, SQL « 0.000 » | **Heures de ligne nulles si la colonne par unité est nulle** : dérivation naturelle `round(Q × h/u, 3)` du déclencheur de 2.5, colonnes par unité nulles par défaut (D4) ; ligne non chiffrée : « 0.000 » si h/u est renseigné, nul sinon (contrainte pour le déclencheur de 2.5 : interprétation 31) ; h/u nul vaut 0 dans la MO | SQL (M3) | pgTAP I-04 ; attendus T-HMO, T-STAT et F5 révisés (heures nulles là où h/u est nul) |
| I-05 | Pas d'arrondi 0 en mode `none` : TS refusait, SQL acceptait | **Pas ≥ 1 c dans tout mode** : la colonne porte `CHECK (rounding_step_cents >= 1)` (`001_add_job_title_to_profiles.sql:244`) | SQL (M3) | pgTAP (25ᵉ entrée invalide) ; TS I-05 |
| I-06 | Heures dérivées au-delà de `numeric(12,3)` : TS levait le dépassement, SQL non | **`ESTIMATE_AMOUNT_OVERFLOW` (22003)**, jamais d'écrêtage, même à coût nul | SQL (M3) | pgTAP I-06 ; TS I-06 |

M3 n'est pas publiée : elle a été modifiée à l'intégration et son empreinte du manifeste mise à jour à la main
(`a0f26a90` pour le code, `a0f5cac9` pour le commentaire d'en-tête qui pointe vers ce document).

### Revue (constats R-01 à R-08, tous revérifiés avant correction)

Deux revues indépendantes de `e30560f4..b1eae40d` n'ont trouvé aucune erreur d'arithmétique ni d'écart TS/SQL
(recalcul indépendant et 3 011 cas adverses : 0 écart). Chaque constat a été reproduit avant d'être traité ; les
défauts de comportement sont écrits rouges d'abord (`888ae6ff`), puis corrigés (`24f1e906`). M3 et les suites
pgTAP ne changent pas.

| Id | Constat (vérifié) | Décision | Preuve |
|---|---|---|---|
| R-01 | L'adaptateur canonique acceptait ce que le jumeau SQL refuse : `JSON.parse` arrondit un littéral plus précis qu'un double (`1.00000000000000000001` lu 1) et une chaîne décimale (`"1.30"`) passait | **Chemin canonique strict** : le texte est lu littéral par littéral à sa source (`JSON.parse` avec accès à la source, exposant développé en entier exact, « -0 » = 0 comme `numeric`) ; un champ numérique n'admet qu'un nombre JSON, objet ou texte ; l'éditeur (entrée typée, `computeEstimateV3Breakdown`) garde les chaînes décimales | `requirements.test.ts` (2 tests) ; parité : les deux côtés lisent le même texte, 9 cas limites en texte brut |
| R-02 | Le lecteur figé déduisait l'autoliquidation de « toute la TVA est nulle » : une v3 non autoliquidée à TVA nulle passait | **Autoliquidation lue sur `contractor_role` figé** de la version (`subcontractor`, convention v2 `useEstimateEditorCalculation.ts:77`) ; rôle inconnu refusé ; jamais déduite des montants (interprétation 29) | `requirements.test.ts` (2 tests) |
| R-03 | `controlCents` repassait par un double (`toFixed(12)`) : 17 459,995 donnait 1 745 999 c au lieu de 1 746 000 (ARRONDI d'Excel) | **Demi supérieur sur la chaîne exacte à 15 chiffres** (`decimalFromLiteral`), module pur `scripts/engine-v3/optima-control.ts` ; les lots §5.4 n'étaient pas touchés (mêmes nombres avant et après) | `src/test/engine-v3-optima-control.test.ts` (7 vecteurs) |
| R-04 | La campagne `calc-v3` (parcours de 2.0) n'était pas rejouée, et aucune CI ne la lance | **Rejouée** sur la pile possédée : 37/37 (détail aux résultats) | archive `army/ci/2026-10-17T15-08-33-064Z-calc-v3/` |
| R-05 | Les rapports OPTIMA et performance ne portaient ni révision, ni empreinte du diff local, ni commande, ni empreinte des classeurs ; un classeur sans lot du §5.4 était ignoré puis « conforme » | **Traçabilité** (`buildSourceEvidence`, commande, sha256 de chaque classeur) ; le contrôle OPTIMA échoue si un fichier ne nomme aucun lot ou si les deux lots ne sont pas contrôlés une fois chacun | un seul classeur : sortie 1, « lot PLOMBERIE contrôlé 0 fois » |
| R-06 | Les 40 vecteurs TS et pgTAP n'étaient comparés qu'à l'œil | **Comparaison automatique** : `normalize.test.ts` relit le bloc `insert into unit_vectors` de la suite pgTAP (littéraux SQL et `U&'…'` décodés) et l'égale à la liste TS | test « identiques octet pour octet » |
| R-07 | D9 demande de trancher aussi `normalizedUnit` des offres ; 2.4 ne parlait que du métré | **Tranché** (interprétation 30) ; commentaires de `supplier-offer-eligibility.ts` et `normalize.ts` mis à jour, sans changement de comportement | revue du diff |
| R-08 | Ligne non chiffrée : M3 et le TS rendent `h_mo` « 0.000 » ; le déclencheur de 2.5 dérivant `round(Q × h/u, 3)` sans condition de statut figerait une autre valeur | **Contrainte explicite pour 2.5** (interprétation 31) ; le moteur reste conforme à D9 « contribue 0 partout » | — |

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
- **cas limites d'analyse** des entrées (décimales en trop, valeurs non finies, exposants, littéraux JSON plus
  précis qu'un double, chaînes sur le chemin canonique : R-01) et des graphies d'unités issues des DPGF et des
  classeurs OPTIMA (U1, U7, U9, F-V3-12) ; lecture des cellules de contrôle OPTIMA à 15 chiffres sur des
  demi-centimes au-delà de 10 000 € qu'aucun classeur versionné ne contient (R-03) ;
- **cohérence d'une v3 figée** (R-02) : aucune v3 ne peut être figée avant 2.5, seul le lecteur pur l'établit.

Les parcours E2E v3 arrivent avec les écrivains (2.5) et l'éditeur (2.6). Les suites pgTAP s'exécutent sur la
pile native jetable de `npm run db:ci:local` (WSL, clone Linux), avec toutes les autres suites et la matrice RLS.

## API et contrat SQL livrés

API publique TS (`@/lib/estimates/engine-v3`) :

| Export | Signature |
|---|---|
| `computeEstimateV3Breakdown` | `(input: EstimateV3Input) => EstimateV3Breakdown` |
| `computeEstimateV3Canonical` | `(input: unknown) => EstimateV3CanonicalOutput` (objet ou texte JSON ; nombres JSON seulement, texte lu à la source de chaque littéral : R-01) |
| `projectEstimateV3Snapshot` | `(breakdown, { laborRoles? }) => { items, version, context }` (colonnes figées et contexte §6.5) |
| `readStoredEstimateV3` | `({ version, items }) => StoredEstimateV3View` (aucun recalcul ; autoliquidation lue sur `version.contractor_role` : R-02) |
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
6. **Nombres** (révisé par R-01) : le contrat canonique ne porte que des nombres JSON, des deux côtés.
   `computeEstimateV3Canonical` refuse une chaîne dans un champ numérique, que l'entrée soit un objet ou un
   texte ; un texte est lu littéral par littéral à sa source (accès à la source de `JSON.parse`, Node ≥ 21 ;
   sans lui, refus nommé plutôt qu'une lecture approchée), exposant développé en entier exact, zéros de tête et
   de queue ignorés (`min_scale`), « -0 » = 0 comme `numeric`. Un nombre JS d'un objet est lu par sa chaîne la
   plus courte (`String(n)`), exposant compris. Seule l'entrée typée de l'éditeur
   (`computeEstimateV3Breakdown`) accepte aussi une chaîne décimale exacte, sans signe ni exposant : elle est
   hors du contrat canonique et le SQL ne la voit jamais.
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
    (un devis d'une ligne), **et** 300 devis tirés au hasard (12 244 lignes), plus 57 cas limites nommés qui
    doivent être refusés ou calculés à l'identique (48, puis 9 en texte brut après R-01) ; les deux côtés
    lisent le même texte JSON canonique ; comparaison du JSON canonique complet, ou du même code et du même
    SQLSTATE.
26. **Harnais de parité** : `owned-native-stack.ts` reprend le modèle de `upgrade-check.ts` (projet isolé, ports
    libres hors plage éphémère et jamais 45585/33485/3107, runtime natif, `stop` puis `stack destroy` en
    `finally`) ; `upgrade-check.ts`, preuve de 2.0 rejouée à l'identique, n'est pas refactorisé (doublon
    assumé, à factoriser plus tard).
27. **Lots OPTIMA** : colonnes lues par le profil OPTIMA de 2.3 (`detectImportProfile`, paramètres de la ligne 2,
    majoration additive 1 + N) ; ligne chiffrée comme dans la reproduction (« Prix Unitaire » > 0 et Qté > 0,
    hors « Sous-total » / « Total ») ; ligne à statut = « Uté » normalisée en statut, entrée comme ligne non
    chiffrée avec ses nombres ; PR FO arrondi au centime par le demi supérieur (P-10) ; « Prix Unitaire » et
    « Prix Total » (cellules flottantes) lus à 15 chiffres significatifs (précision d'Excel), puis au centime
    par le demi supérieur appliqué à cette chaîne décimale exacte, sans repasser par un double (R-03) ; aucune
    entrée moteur n'est arrondie (une valeur hors échelle arrête le script). Le contrôle n'atteste le §5.4 que
    si chaque classeur nomme un lot (HYDRAULIQUE, PLOMBERIE) et si les deux lots sont contrôlés une fois (R-05).
28. **Performance** : « entrée comparable » = les mêmes lignes tirées au hasard (sections de 25 lignes, quantité
    à 3 décimales, PR, heures à un taux de rôle, remise fixe de 10 €, TVA 20 %), en heures par unité pour la v3
    et en heures de ligne Q × h/u pour la v2 (moteur 2, marge fixe 1,25) ; exécutions entrelacées après 20 tours
    de chauffe ; 200 échantillons par série.

### Revue (R-01 à R-08)

29. **Autoliquidation d'une v3 figée** (R-02) : le lecteur la lit sur la colonne figée
    `estimate_versions.contractor_role` (`text not null`, `CHECK in ('principal', 'subcontractor')`,
    `20260726090000…sql:30-39`), `subcontractor` = autoliquidation, comme le calcul v2 de l'éditeur
    (`useEstimateEditorCalculation.ts:77`). `StoredEstimateV3Version` gagne `contractor_role` ; un rôle absent ou
    inconnu est une incohérence. Écarté : un drapeau `reverse_charge` ajouté à `calc_snapshot_context`, qui
    aurait rompu l'exemple exact du §6.5 (test EU01) sans rien apporter, le rôle étant déjà figé sur la version
    et gardé par le déclencheur d'écrivain v3 (§6.4, point 2). Contrainte pour 2.5 : l'écrivain du gel v3 passe
    au moteur `reverse_charge = (contractor_role = 'subcontractor')`, et la relecture lit la même colonne.
30. **Normaliseur d'unités des offres** (R-07, D9) : `normalizedUnit` (`supplier-offer-eligibility.ts:7-10`) et
    son jumeau SQL `private.purchase_unit_token` (`20261017093407…sql:55-62`, règle « ml » = « m » de 2.2) **ne
    sont pas remplacés en 2.4**. Ils servent tous les moteurs (v1/v2 compris) : les remplacer par le normaliseur
    partagé rendrait compatibles des graphies aujourd'hui distinctes (« m.l. », « mètre linéaire », « Pce » = `u`,
    « forfait » = `fft`) et changerait l'éligibilité des offres et la garde de préparation des commandes, hors du
    code inerte de 2.4. Le remplacement, TS et SQL ensemble, revient au **sous-lot 2.9** (unité d'achat portée
    par l'offre, D9, P-18), qui compare `unit_code` d'une ligne v3 à l'unité de l'offre ; les normaliseurs du
    métré restent propres au métré.
31. **Heures d'une ligne non chiffrée** (R-08) : M3 et le TS rendent `h_mo` = « 0.000 » (nul si h/u est nul) sur
    une ligne non chiffrée, lecture de D9 « contribue 0 partout » (les 45 lecteurs de `h_mo` — qualité, nature,
    exports, couverture — ne doivent pas compter ses heures) ; ses saisies (Q, h/u) restent conservées. D4 et
    §6.4 décrivent le déclencheur de 2.5 par `round(quantity × h/u, 3)` sans condition de statut, et D12 exige
    l'égalité exacte colonne par colonne au gel. **Contrainte pour 2.5** : sur une ligne v3 non chiffrée, le
    déclencheur stocke `h_mo* = 0.000` (nul si la colonne par unité est nulle), de préférence en appelant la
    même fonction de M3 (`private.estimate_v3_line_values`), et un test de 2.5 couvre ce cas. Point ouvert pour
    le porteur de la conception : confirmer cette lecture de D9 ; l'autre lecture (`round(Q × h/u, 3)` aussi sur
    une ligne non chiffrée) exigerait de changer M3 avant sa publication.

### Revue Codex de la PR #31

32. **Coefficient réalisé figé** : la relecture d'une v3 figée vérifie désormais
    `calc_snapshot_context.realized_sale_coefficient` contre le HT et le déboursé figés (⌈HT / déboursé⌋ à
    6 décimales ; 1 si les deux sont nuls ; nul si seul le déboursé l'est, §4.11). Un coefficient faux (−1, 999,
    0, nul ou décalé d'1 millionième) lève `ESTIMATE_V3_STORED_INCOHERENT` au lieu d'être affiché. Test rouge
    puis vert dans `requirements.test.ts` (« refuses a frozen realized sale coefficient… »).
33. **Échantillons de la mesure de performance** : `--samples` refuse les zéros de tête (`05`, `0001`), qui
    passaient le contrôle de forme puis donnaient moins des 10 échantillons documentés. Vérifié à la ligne de
    commande : `05`, `0001`, `9` et `10000` sortent en erreur, `10` mesure.
34. **Index d'origine dans les erreurs de calcul** : une ligne normalisée garde son chemin `items[i]` de l'entrée
    d'origine, sections comprises ; un dépassement sur `items[1]` derrière une section n'est plus signalé sur
    `items[0]`. Test rouge puis vert (« names the original item index… »).
35. **`discount_amount_cents` à `undefined`** : la clé présente mais `undefined` est refusée comme une clé absente
    (`ESTIMATE_V3_INPUT_INVALID` sur `params.discount_amount_cents`), puisque le JSON transmis au jumeau SQL la
    perd. Test rouge puis vert.
36. **Types de base** : `measurement_unit_aliases` déclare sa relation `measurement_unit_aliases_unit_code_fkey`
    vers `measurement_units(code)`, comme la clé étrangère de M3, pour les jointures typées du client Supabase.

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

### Revue (`888ae6ff`, tests seuls, sur `b1eae40d`)

`npx vitest run --project=node src/lib/estimates/engine-v3/requirements.test.ts src/lib/units/normalize.test.ts src/test/engine-v3-optima-control.test.ts` :

```text
     × 17459.995 € gives 1746000 c
     × 12345.675 € gives 1234568 c
     × refuses decimal strings on the canonical path, text or object, like the SQL twin (JSON numbers only)
     × reads JSON number literals at their source, never through a double
     × refuses zeroed VAT without reverse charge, VAT under reverse charge and an unknown contractor role
AssertionError: expected 1745999 to be 1746000 // Object.is equality
AssertionError: expected undefined to match object { …(2) }
 Test Files  2 failed | 1 passed (3)
      Tests  5 failed | 153 passed (158)
```

Le test des 40 vecteurs relus dans la suite pgTAP (R-06) passe dès le rouge : c'est une garde, les deux listes
étaient identiques. Les tests canoniques existants dont la fixture écrit des décimaux en chaîne (`"1.30"`,
`"0.5"`) passent désormais par un texte JSON aux nombres exacts (`canonicalJson`) : mêmes attendus, entrée au
format du contrat. Les lecteurs figés des tests S5 et I-01 portent `contractor_role: "principal"` (colonne
désormais lue). Le premier jet de ce rouge figeait un drapeau `reverse_charge` dans le contexte ; il a été
remplacé avant toute publication par la lecture de `contractor_role` (interprétation 29) parce qu'il rompait le
test EU01 « contexte exactement l'exemple du §6.5 ». Après `24f1e906` : 158/158 sur ces trois fichiers.

## Résultats (17/10/2026)

Windows : Node 24.19.0, worktree `miaouffrage-l2-24`. WSL : Ubuntu 24.04, Node 24.14.0, clone
`~/miaouffrage-lot2-24` remis au commit indiqué (arbre propre), au plus une exécution native possédée à la fois,
sous le verrou partagé. Après la revue, M3, les suites pgTAP et tout le SQL sont inchangés
(`git diff b1eae40d -- supabase/` vide) : les preuves SQL de `a0f5cac9` et de la campagne à `b1eae40d` valent
pour la tête ; le moteur TS ayant changé (R-01, R-02), la parité, les lots OPTIMA et la performance sont rejoués
à `24f1e906`.

| Preuve | Commande | Résultat |
|---|---|---|
| Moteur TS, unités, corpus figé, règle de lint, contrôles OPTIMA (à `24f1e906`) | `npx vitest run --project=node src/lib/estimates/engine-v3 src/lib/estimates/engine src/lib/units src/lib/estimates/engine-frozen-corpus.test.ts src/test/engine-version-lint.test.ts src/test/engine-v3-optima-control.test.ts` | 10 fichiers, 220 tests verts (corpus figé v1/v2 compris : identique) |
| Parité TS/SQL (WSL, pile jetable possédée, à `24f1e906`) | `npm run engine:v3:parity` | **0 écart** sur 10 357 cas (détail ci-dessous) |
| Lots OPTIMA (Windows, local, hors CI, à `24f1e906`) | `npm run engine:v3:optima-lot-check -- "docs/prd_file/exemple chiffrage OPTIMA/BEING - DPGF HYDRAULIQUE.xlsx" "docs/prd_file/exemple chiffrage OPTIMA/BEING - DPGF PLOMBERIE.xlsx"` | « Lots OPTIMA conformes au §5.4 » (tableau ci-dessous) ; avec le seul classeur hydraulique : sortie 1, « lot PLOMBERIE contrôlé 0 fois » |
| Performance (Windows, à `24f1e906`) | `npm run engine:v3:performance` | 1 000 lignes : p95 5,12 ms (≤ 50) ; 3 000 lignes : v3/v2 = 0,458 en p50, 0,489 en p95 (≤ 2) |
| Parcours de 2.0 rejoués (WSL, pile possédée, à `b1eae40d`) | `npm run e2e:army:calc-v3` | **37/37** : journeys 11, components 5, numeric 4, resume 5, access 2, offers 4, emission 6 ; pgTAP `Files=17, Tests=1714, Result: PASS`, matrice RLS passée, 247 migrations, validation de l'application passée ; sources identiques avant et après ; 11 min 31 s ; archive `.e2e/army/ci/2026-10-17T15-08-33-064Z-calc-v3/` du clone |
| Montée de version (WSL, à `a0f5cac9`) | `npm run db:upgrade-check -- lot2-2-4` | 244 migrations de base, 3 ultérieures appliquées (dont M3) ; « comparison found 0 difference(s) » ; contre-épreuve détectée ; `passed` |
| Empreintes documentaires (WSL, à `a0f5cac9`) | `npm run engine:document-fingerprints -- check` | 14 familles v1/v2 ; « Document fingerprints identical » |
| SQL et RLS (WSL, à `a0f5cac9`) | `npm run db:ci:local` | pile jetable, base réinitialisée, inventaire conforme ; pgTAP `Files=17, Tests=1714, Result: PASS` (1 711 de la piste B + I-04, I-06 et la 25ᵉ entrée invalide) ; « Behavioral RLS matrix passed. » ; garde F-SQL-14 : « Entrées de la liste blanche sans comparaison littérale : aucune » |
| Types | `npm run typecheck` | sortie 0 |
| Lint | `npx eslint <fichiers .ts et .mjs touchés> --max-warnings=0` | sortie 0 |
| Architecture | `npm run check:architecture` | « Architecture budgets passed (1116 modules, 0 allowed runtime cycles) » |
| Migrations | `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` ; `npm run units:sql -- --check` | 247 fichiers, 247 versions ; garde passée (2 changements) ; blocs alignés |
| Fichiers moteur v1/v2 | `git diff --stat e30560f4 -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` (et contre `origin/main`) | vide |
| Espaces et fins de ligne | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; `git ls-files --eol src/types/database.ts src/lib/money.ts` | propre ; `i/crlf w/crlf` |

### Parité TS/SQL

`npm run engine:v3:parity` (graine 20261017) à `24f1e906` : 10 357 cas = 10 000 lignes seules, 300 devis
(12 244 lignes) et 57 cas limites ; les deux côtés lisent le même texte JSON canonique ; TS 429 ms, SQL
4 014 ms (`private.estimate_v3_compute_items`, en `postgres`) ; **0 écart** ; contre-épreuve détectée (un
centime ajouté au HT d'une sortie SQL) ; pile arrêtée, détruite, répertoire retiré. Cas limites : 15 calculés,
36 refusés `ESTIMATE_V3_INPUT_INVALID` (22023), 6 `ESTIMATE_AMOUNT_OVERFLOW` (22003), identiques des deux
côtés ; parmi les 9 cas en texte brut, littéraux plus précis qu'un double, chaînes décimales et littéral de
1e-30 refusés, exposants (`15e-1`, `1E2`), « -0 » et zéros de queue calculés à l'identique. Rapport :
`~/miaouffrage-lot2-24/.e2e/engine-v3/parity/2026-10-17T15-23-23-047Z-seed-20261017/report.json` (révision
`24f1e906`, diff local vide, empreinte des cas `d28f3bf0…`).

Passage précédent, avant la revue, à `a0f5cac9` : 10 348 cas = 10 000 lignes seules, 300 devis
(12 244 lignes) et 48 cas limites ; TS 884 ms, SQL 12 071 ms (psql 17.11) ; **0 écart** ; contre-épreuve
détectée ; mêmes résultats au premier passage à `c0b450e7`. Rapport :
`~/miaouffrage-lot2-24/.e2e/engine-v3/parity/2026-10-17T14-45-45-006Z-seed-20261017/report.json` (cas et sorties
SQL archivés en gzip à côté, empreinte des cas `3ef1f24b…`).

Cas limites de ce passage : 11 calculés, 31 refusés `ESTIMATE_V3_INPUT_INVALID` (22023), 6
`ESTIMATE_AMOUNT_OVERFLOW` (22003), identiques des deux côtés. Sur la boucle PostgreSQL de mise au point, une
sortie SQL altérée à la main donnait bien 1 écart sur 10 348.

Couverture du passage à `24f1e906` (les 10 300 cas tirés sont les mêmes aux deux passages, même graine) :
989 sections ; 18 985 lignes chiffrées (18 976 avant les 9 cas en texte brut) et 3 314 non chiffrées
(652 `included`, 692 `for_memory`, 611 `not_priced`, 692 `out_of_scope`, 667 `not_applicable`) ; 19 190
quantités à 3 décimales ; 14 008 heures par unité à 4 décimales ; 301 lignes dont le montant de vente unitaire
exact tombe sur un demi-centime ; 883 lignes ventilées ; 1 030 cas en autoliquidation ; 290 devis multi-taux ;
remise en montant (80) et en taux (92), dont 20 plafonnées au brut ; arrondi `down` sur 108 devis, appliqué
sur 89 ; 254 devis avec des bruts égaux (ex aequo de répartition) ; 387 identifiants en majuscules.

### Lots OPTIMA (§5.4, tolérance 0 c)

| Lot | PU v3 = « Prix Unitaire » | PT identiques ; écart max | Σ v3 à 1,3 / 1,3 (classeur) | Σ v3 à 1,30 / 1,20 | Déboursé | Coefficient réalisé | Lignes à statut | Contribution des non chiffrées |
|---|---|---|---|---|---|---|---|---|
| Hydraulique | **785/785** | 392/785 ; 7,94 € | **1 644 207,61 €** (1 644 173,89 €) | **1 572 320,99 €** | 1 264 749,07 € | **1,243188** | 61 HL, 9 inc, 7 NC, 1 PM, 1 CP | 0 c |
| Plomberie | **656/656** | 310/656 ; 2,03 € | **1 027 655,61 €** (1 027 637,33 €) | **981 887,92 €** | 790 490,05 € | **1,242126** | 74 HL, 4 NC, 3 SO, 1 PM | 0 c |

Tous les nombres du §5.4 sont reproduits sans retouche, avant comme après la revue (R-03 ne change aucun
nombre de ces deux lots). Le premier passage, à l'intégration, a échoué sur un seul point : la comparaison des
statuts dépendait de l'ordre des clés (défaut du script, corrigé par une égalité profonde) ; les nombres étaient
déjà identiques. Rapport à `24f1e906` : `.e2e/engine-v3/optima-lot-check/2026-10-17T15-24-11-981Z/report.json`
du worktree Windows (révision, diff local vide, commande, sha256 des deux classeurs `4a6eea77…` et `586c7d23…` ;
nombres et numéros de ligne seulement, aucune désignation).

### Performance (Windows, Node 24.19.0, 200 échantillons entrelacés, 20 tours de chauffe)

| Série (à `24f1e906`) | p50 | p95 |
|---|---|---|
| v3, 1 000 lignes | 3,79 ms | **5,12 ms** (≤ 50 ms) |
| v3, 3 000 lignes | 12,09 ms | 14,00 ms |
| v2 (`computeEstimateBreakdown`), 3 000 lignes | 26,38 ms | 28,65 ms |

Rapport v3/v2 à 3 000 lignes : **0,458** en p50, 0,489 en p95 (≤ 2). Échantillons bruts, révision et commande :
`.e2e/engine-v3/performance/2026-10-17T15-24-13-044Z/report.json` du worktree Windows. Mesure de l'intégration
(`a0f5cac9`, prise pendant qu'une pile native tournait dans WSL) : p95 8,26 ms à 1 000 lignes, rapport 0,385 en
p50 ; les critères tiennent aux deux mesures.

## Restes et points ouverts

- Suites complètes Vitest et E2E `critical` : CI GitHub de la PR (non lancées ici, à dessein). La campagne
  `calc-v3`, qu'aucune CI ne lance, est rejouée ici (37/37 à `b1eae40d`) ; les commits suivants ne touchent ni
  le SQL ni un chemin v1/v2 (moteur v3 inerte, scripts, tests, commentaires, ce document).
- Point ouvert : valeurs négatives (ristournes, moins-values) refusées faute de règle d'arrondi (D13).
- Point ouvert pour le porteur de la conception (R-08, interprétation 31) : heures « 0.000 » d'une ligne v3 non
  chiffrée ; contrainte à tenir par le déclencheur de 2.5 (branche `lot2/2.5-persistance-v3` en cours).
- Contrainte pour 2.5 (interprétation 29) : l'autoliquidation du gel v3 vient de `contractor_role`.
- Chemin canonique : il exige l'accès à la source de `JSON.parse` (Node ≥ 21, navigateurs récents) ; sans lui,
  refus nommé plutôt que lecture approchée.
- `owned-native-stack.ts` double une partie de `upgrade-check.ts` (preuve de 2.0 laissée intacte) : à factoriser
  dans un sous-lot ultérieur.
- M3 a été modifiée après les commits de la piste B (non publiée) ; une fois publiée, toute évolution, référentiel
  d'unités compris, exige une nouvelle migration.
- La performance est une mesure ponctuelle sur ce poste, pas un test de CI.
