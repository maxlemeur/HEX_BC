# Sous-lot 2.7 — document client, contrat client 2, charge de calcul 6, émission v3

Rouge écrit **avant M5 et avant tout code de production de 2.7**, le 17/10/2026, branche
`lot2/2.7-document-emission-v3`, base `c14b243d` (pointe de 2.5, PR #33). Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), F1 à F3, D2, D7,
D8, D14, D15, §4, §5 (S2, S5), §6.1 (M5), §7 (fonctions d'offre), §8.1, §8.2, §10.4, §14 « 2.7 ».
Ce document couvre la suite SQL et le parcours ; les tests isolés TypeScript (parseur strict du contrat 2,
charge 6, préparateur du document) sont décrits dans
[estimate-engine-v3-2.7-vitest.md](estimate-engine-v3-2.7-vitest.md), dont ce document reprend le contrat
(mêmes clés, mêmes invariants). Là où ce document **choisit** (signalé « Choix »), il fixe ce que le rouge
exige ; ailleurs, la conception fait foi.

## 1. Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/tests/database/estimate-offer-contract-v2.test.sql` | pgTAP, F27-01 à F27-19 (§4) |
| `e2e/army/local/engine-v3-emission.e2e.ts`, `engine-v3-emission-support.ts` | Parcours V3E01 (calc-v3) et V3E02 (critique locale), §3 |
| `scripts/tester-army/calc-v3-phases.ts` | Nouvelle phase `emission-v3` (next dev, collecteur sentinelle) |
| `scripts/tester-army/calc-v3-fixtures.ts` | Fixture de la phase : propriétaire dédié en politique 3, témoin v2 brouillon |
| `scripts/tester-army/calc-v3-campaign.ts`, `e2e/army/local/calc-v3.config.ts` | Collecteur, garde réseau d'offre et lecture des PDF reçus pilotés par `sentinelCollector` (et non plus par le nom `emission`) |
| `scripts/tester-army/army-impact-map.json` | Parcours inscrit (la liste critique locale de `e2e.config.ts` prend `engine-v3-*.e2e.ts`), groupe `print` |

## 2. Défaillances observables et preuves

| Défaillance | Preuve |
|---|---|
| v3 émise avec le contrat 1 | pgTAP F27-08 (validateur), F27-11 (publication) ; Vitest F27-V10, F27-V12 |
| v2 (ou v1) émise avec le contrat 2 | pgTAP F27-16 (témoin, vert avant M5) et F27-08 ; Vitest F27-V10, F27-V12 |
| Contrat 2 altéré d'1 c accepté : ligne, remise, base ou TVA d'un taux | pgTAP F27-03 à F27-05 (validateur), F27-10, F27-12 (publication), F27-13 (appariement) ; Vitest F27-V05 à F27-V08 |
| Contrat 2 altéré d'une clé, d'une unité ou d'un statut accepté | pgTAP F27-06, F27-07, F27-10, F27-13 ; Vitest F27-V02 à F27-V04 |
| Publication sans gel document v3 frais | pgTAP F27-14 (jamais figé ; passage à `sending`), F27-15 (gel périmé par le taux d'un rôle cité) |
| Deux générations d'un même devis figé, ou deux envois d'une même version scellée, au texte différent | V3E02 (deux générations, même texte), V3E01 (renvoi : même SHA-256 et même texte) ; Vitest F27-S04 |
| Empreintes v1/v2 qui changent | Vitest F27-S06, F27-S07 (charges 1 à 4 sur le corpus figé) ; V3E01 témoin v2 (V3E-08) ; `scripts/engine-v3/document-fingerprints.ts` et la montée de version (§10.2, §10.3), à rejouer à l'implémentation |
| Charge 6 sans un champ v3 | Vitest F27-S02, F27-S03 |
| PDF : PT ≠ ⌈Q × PU⌋ | V3E01 et V3E02 (7 lignes, §3.3) ; pgTAP F27-03 ; Vitest F27-V06, F27-D01 |
| PDF : Σ lignes ≠ brut | V3E01, V3E02 (7 lignes brutes et brut 69 054,56 €) ; pgTAP F27-03, F27-04 ; Vitest F27-V05, F27-D03 |
| TVA d'un taux ≠ ⌈base × taux⌋ | V3E01, V3E02 (« TVA r % », base et montant) ; pgTAP F27-05, F27-12 ; Vitest F27-V08, F27-D04 |
| Portail, impression ou exports avec d'autres montants | V3E01 (impression, portail, XLSX, DPGF), V3E02 (impression, XLSX, DPGF) |
| Sceau d'une v3 sans marqueur 5, contrat 2 ou charge 6, ou vérification négative | V3E01 (`/verify`, §6.2) ; pgTAP F27-19 ; Vitest F27-S08 |
| Acceptation au portail d'une v3 qui échoue ou change son sceau | V3E01 |
| Conditions de développement hors du profil calc-v3 possédé | **Non couvert par ce rouge** : le test de garde-fou de l'extension de `canUseDevelopmentEstimateTerms` (`src/lib/estimates/pdf-terms-server.test.ts` : refus avec un marqueur d'hébergement ou hors profil `calc-v3`, cas `offer` sur 45585 inchangé) s'écrit rouge avec l'extension (conception §14 2.7). V3E01 tourne en next dev et V3E02 sans CGV (`includeTerms: false`) : aucun des deux n'en dépend |

## 3. Parcours `engine-v3-emission.e2e.ts`

### 3.1 Principe

Le devis v3 est créé et réglé par l'API de 2.5 (`POST /api/estimates` avec `expected_calc_engine_version: 3`,
section par `POST …/items`, 7 lignes par `POST …/batch`, remise par `PATCH …`), jamais par la grille de 2.6.
L'émission passe par les routes que l'interface appelle, sous le bail de la page : `POST …/pdf?force=1`,
`GET …/pdf?format=json`, `POST …/send` (`Idempotency-Key`, `If-Match`), `GET …/verify`,
`GET …/export?format=xlsx[&mode=dpgf]`. Seuls l'impression (`/dashboard/estimates/<id>/print`) et le portail
(lien collecté, acceptation) passent par l'écran. Le rouge porte donc sur l'émission fermée et le contrat 2
absent, pas sur des écrans de 2.6. Chaque étape enregistre attendu et obtenu avant d'asserter.

Chaque scénario n'est défini que dans sa campagne : V3E01 si `E2E_ARMY_SUITE=calc-v3` et
`E2E_CALC_V3_PHASE=emission-v3` (la phase exige exactement 1 résultat de ce fichier, setup compris à part) ;
V3E02 si `E2E_ARMY_SUITE=critical` (le fichier entre dans la sélection critique locale et complète par
`engine-v3-*.e2e.ts`).

### 3.2 Valeurs attendues (§5.1, §5.2)

| | O1 | O4 | Brut | Remise | HT net | TVA par taux | TTC |
|---|---|---|---|---|---|---|---|
| S2 | 20 ml, 166,63 €, 3 332,60 € | 1 139 ml, 13,53 €, 15 410,67 € | 69 054,56 € | −1,01 € | 69 053,55 € | 20 % : 69 053,55 € / 13 810,71 € | 82 864,26 € |
| S5 | idem | idem | idem | idem | idem | 10 % : 5 554,53 € / 555,45 € ; 20 % : 63 499,02 € / 12 699,80 € | 82 308,80 € |

Les 7 lignes (O1 à O7) sont vérifiées, pas seulement O1 et O4. Les constantes sont recontrôlées au
chargement du module (PT = ⌈Q × PU⌋, Σ bases = net, TVA = ⌈base × taux⌋, TTC = net + TVA).

### 3.3 Contrat de texte (Choix)

Le texte (PDF extrait par `scripts/tester-army/pdf-text.ts`, impression, portail) est comparé après
normalisation des seuls espaces (fines, insécables, retours → une espace). Il doit contenir :

- par ligne, « Q unité … PU € … PT € » dans cet ordre, la quantité groupée (« 1 139 »), le symbole du
  référentiel (« ml », « u », « m² »), au plus 40 caractères sans « € » entre deux valeurs (une colonne
  intercalée, comme un taux, est tolérée ; un autre montant ne l'est pas) ;
- le brut « 69 054,56 € » ; « Remise commerciale » suivi de « −1,01 € » (signe moins U+2212 ou trait
  d'union) ; « Total HT net 69 053,55 € » ;
- pour chaque taux, « TVA r % » suivi, à moins de 60 caractères, de sa base et de son montant (dans un ordre
  ou l'autre) ;
- « TTC » suivi du montant TTC.

Exports XLSX et DPGF : pour chaque ligne-oracle, une ligne de classeur qui porte le titre de la ligne, son PU
et son PT bruts en euros ; une ligne qui porte « Remise commerciale » et ±1,01.

### 3.4 V3E01 — phase calc-v3 `emission-v3`

Fixture (`emissionV3Fixtures`) : propriétaire neuf, entreprise personnelle en politique 3 (1,30 / 1,20,
taux 20 / 10 / 5,5 / 2,1 %) posée par `set_tenant_calc_policy` en `service_role`, un seul rôle actif à
4 000 c, et un brouillon **v2** témoin (1 u à 20,00 € HT, TVA 20 %, sans instantané) inséré par le
propriétaire natif. Login de la phase : ce propriétaire.

1. Témoin v2 : PDF, envoi, reçu du collecteur = document stocké, « 1 u 20,00 € 20,00 € », `sent`,
   marqueur 5, 2 000 / 400 / 2 400, vérification positive (comportement existant, vert avant 2.7).
2. S2 : création v3 et réglage (vert sur 2.5), **puis génération du PDF : premier rouge attendu**.
3. Envoi S2, reçu = document, texte du PDF joint (§3.3), `sent`, marqueur 5, totaux S2 ;
   `/verify` : `valid`, `stored_hash = computed_hash = seal_hash`, `seal_payload_version: 5`,
   `client_contract_version: 2`, `calc_payload_version: 6` ; impression ; XLSX et DPGF.
4. S5 (nouvelle affaire) : idem, puis renvoi : nouveau reçu, nouveau lien, même SHA-256 et même texte.
5. Portail du renvoi (admission exacte de `resend-portal-fixtures.ts`) : texte S5 (§3.3), acceptation
   (« Accepter le devis », réponse 200 `accepted`), reconnexion : `accepted`, même sceau, marqueur 5.
6. Régression : témoin v2 `/verify` `valid` avec `client_contract_version: 1`, `calc_payload_version: 4`,
   même `stored_hash`, PDF stocké au même SHA-256 que la pièce jointe.

### 3.5 V3E02 — campagne critique locale (build de production, sans courriel)

Propriétaire dédié (`useDedicatedV3Owner`, comme V3P01) et politique 3 par la route SQL possédée ; rôle
« Tuyauteur » 40 €/h par l'API ; S2 réglé ; PDF manuel deux fois : même texte (§3.3) ; impression, XLSX,
DPGF ; passage en S5 sur le même brouillon (O1–O3 à 10 % par un lot) ; PDF, impression, exports S5. Le PDF
stocké est lu par ce processus sur l'URL signée de la pile possédée (le garde critique refuse l'origine
Storage au navigateur), après contrôle de l'origine et du SHA-256 ; l'URL n'est jamais enregistrée.

## 4. Suite pgTAP `estimate-offer-contract-v2.test.sql`

Fixture (postgres, dans la transaction) : propriétaire engineer et administrateur d'une entreprise, projet,
rôles « Tuyauteur » et « Tuyauteur bis » à 4 000 c, témoins v1 et v2 sans ligne, politique 3, puis S2, S5 et
une version de fraîcheur créées par `persist_estimate_creation_atomic`. Les nets, la ventilation FO/MO et la
TVA par ligne sont ceux du §4 (S5 : 10 % `[33 325, 6 250, 15 970]`, 20 % `[308 209, 6 280, 943 671, 11 820]`).
La première assertion contrôle la fixture contre le §5.2 ; un gel d'approbation de M4, annulé, prouve que
le moteur SQL calcule exactement S2 et S5. L'identité d'offre est capturée par version (suffixe `_V<n>` de
la référence).

Une modification refusée ne prouve rien si la publication refuse tout contrat 2 : les sondes d'altération
renvoient « exacte | altérée » (`pg_temp.c2_pair`) et attendent `ok | <refus nommé>`, refus nommé =
`22023 ESTIMATE_PDF_PUBLICATION_INVALID` (contrat invalide en soi) ou `23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH`
(contrat cohérent mais différent du devis figé).

| Id | Exigence |
|---|---|
| F27-01 | `estimate_offer_client_valid_v2(jsonb, jsonb)`, `estimate_offer_client_items_match_v2(jsonb, estimate_versions)`, `freeze_estimate_v3_document_snapshot(uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb)` existent, exécutables par `service_role` seul |
| F27-02 | S2 et S5 exacts valides |
| F27-03 | 1 c sur une ligne (Σ ≠ brut), une section, deux lignes à somme constante (PT ≠ ⌈Q × PU⌋), un PU : invalides |
| F27-04 | remise, net ou brut +1 c : invalides |
| F27-05 | S5 : base d'un taux +1 c (Σ bases ≠ net), TVA d'un taux +1 c, Σ TVA ≠ TVA, TTC ≠ net + TVA : invalides |
| F27-06 | clé en trop (ligne, pied, racine) ou absente : invalide |
| F27-07 | statut inconnu, ligne non chiffrée portant un montant, unité vide, intention de remise inconnue : invalides |
| F27-08 | moteur 2, schéma 1 ou forme du contrat 1 : invalides |
| F27-09 | gel document v3 exact sous le bail exact de la page ; frais, contexte v3 et TVA par taux ; une v3 réclame la génération (refus M1 levé) |
| F27-10 | publication S2 exacte ; refusées : 1 c entre deux lignes, remise 1,02 € cohérente, unité, statut, taux d'une ligne, clé ajoutée |
| F27-11 | v3 avec le contrat 1, ou contrat 2 qui annonce le moteur 2 : refusés |
| F27-12 | S5 figé et publié ; 1 c de base déplacé entre taux (Σ et TVA inchangées par l'arrondi), TVA du 10 % +1 c : refusés |
| F27-13 | appariement exact : vrai pour S2 figé ; faux pour 1 c entre lignes, unité, statut, base entre taux, v3 jamais figée |
| F27-14 | publication d'une v3 jamais figée refusée ; passage à `sending` : `40001 ESTIMATE_V2_SNAPSHOT_STALE` (gouvernance héritée) au lieu de `ESTIMATE_V3_EMISSION_NOT_READY` |
| F27-15 | gel document puis publication acceptée ; gel périmé par le taux d'un rôle cité : refusée |
| F27-16 | témoins v1 et v2 : jamais de contrat 2, même s'il annonce le moteur 3 (vert avant M5) |
| F27-17 | témoin v1 : contrat 1 publié, document prêt et valide (vert avant M5) |
| F27-18 | S2 publié sous contrat 2 : prêt, `client_contract_version = 2`, net 6 905 355, document d'offre valide |
| F27-19 | émission manuelle de S2 (`transition_estimate_draft_to_sent`, marqueur 5) : `sent`, sceau, montants S2, gel frais, document valide ; contrat 2 non réécrivable (`42501 OFFER_DOCUMENT_IMMUTABLE`) |

### Justification de l'isolation

Le parcours ne peut produire que des contrats cohérents : l'application construit le contrat à partir du gel.
Il ne peut ni forger un contrat altéré d'un centime, d'une clé, d'une unité ou d'un statut, ni appeler
`publish_estimate_pdf_generation` (réservée à `service_role`) avec un contrat qui ne vient pas du rendu, ni
présenter un contrat 1 à une v3 ou un contrat 2 à une v2. Or c'est la base qui doit refuser ces cas, même
si le TypeScript se trompe (D12, I5) : seule une suite SQL le prouve. Les refus sont nommés et la version
exacte doit passer dans la même sonde, pour qu'un refus général ne passe pas pour une preuve.

## 5. Contrat supposé

### 5.1 M5 (`…_estimate_offer_client_contract_v2.sql`)

- `estimate_documents_client_contract_pair_check` admet `(2, copie non nulle)`. Appariement : v3 ⇔ contrat 2 ;
  v1/v2 ⇔ contrat 1 ou historique.
- `public.estimate_offer_client_valid_v2(value jsonb, layout jsonb) returns boolean`, immuable,
  `security invoker`, `service_role` seul. Forme et invariants de `ClientContract2` (doc Vitest) : clés
  exactes ; `schemaVersion: 2` ; bloc `version` du contrat 1 avec `calcEngineVersion: 3` ; ligne
  `{kind, id, parentId, position, depth, title, quantity, unitCode, unitLabel, pricingStatus, taxRateBp,
  unitSaleHtCents, saleHtCents}` (+ parts FO/MO en `fo_mo_and_total`), section
  `{kind, id, parentId, position, depth, number, title, saleHtCents}` ; pied `{grossHtCents,
  commercialDiscountCents, discountIntent, commercialRoundingCents, netHtCents, taxByRate, taxCents,
  payableTtcCents, reverseCharge}` ; ligne `priced` : PT = ⌈Q × PU⌋ ; non chiffrée : PU nul, brut 0 ;
  Σ lignes = brut ; section = Σ ; net = brut − remise − arrondi ; `taxByRate` croissant, taux = taux des
  lignes chiffrées, **Σ bases = net**, TVA d'un taux = ⌈base × taux⌋ ; Σ = TVA ; TTC = net + TVA.
- `public.estimate_offer_client_items_match_v2(snapshot jsonb, version estimate_versions) returns boolean` :
  lignes ⇔ lignes stockées (`id`, `kind`, `parentId`, `position`, titre comme au contrat 1, `quantity`,
  `unitCode = unit_code`, `unitLabel` = symbole de `measurement_units` (Choix, aligné sur le préparateur),
  `pricingStatus`, `taxRateBp`, `unitSaleHtCents = snapshot_pu_ht_cents`, `saleHtCents =
  snapshot_gross_ht_cents`) ; pied ⇔ version (`gross_ht_cents`, `discount_applied_cents`,
  `commercial_rounding_cents`, totaux) et contexte figé (intention, `tax_breakdown`) ; gel frais
  (`calc_snapshot_content_revision = content_revision`, contexte moteur 3).
- `publish_estimate_pdf_generation` : signature inchangée (11 arguments), aiguillage sur `schemaVersion` ;
  contrat invalide → `22023 ESTIMATE_PDF_PUBLICATION_INVALID` ; contrat valide mais différent du devis figé, ou
  gel périmé → `23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH` ; écrit `client_contract_version = 2`.
  `begin_estimate_pdf_generation` inchangée : une v3 brouillon réclame la génération, figée ou non.
- `public.freeze_estimate_v3_document_snapshot(...)` : jumelle de `freeze_estimate_v2_document_snapshot`
  (D15) autour de `freeze_estimate_v3_snapshot('send')`, bail exact de la page, `service_role` seul.
- Retrait des refus de M1 : `guard_estimate_document_engine_v3` (remplacé par l'appariement) ;
  `require_fresh_v2_snapshot_for_publication` traite la v3 par la gouvernance héritée
  (`40001 ESTIMATE_V2_SNAPSHOT_STALE`, ou un nom `ESTIMATE_V3_…_STALE` accepté par F27-14/F27-15).
- Branches contrat 2, à l'identique pour le contrat 1 : `estimate_offer_document_valid`,
  `guard_estimate_offer_document`, `guard_estimate_offer_seal` (marqueur 5 avec le contrat de son moteur),
  `transition_estimate_version_status` et `transition_estimate_draft_to_sent` (émission manuelle d'une v3),
  `reserve_estimate_email_dispatch`, `prepare_estimate_email_dispatch`, `claim_portal_estimate_decision`,
  `assert_estimate_offer_dispatch_proof`. `estimate_offer_client_items_match` (contrat 1) reste faux hors {1,2}.
- Suites à réaligner volontairement à l'implémentation (elles figent le refus de M1) :
  `estimate-calc-engine-v3-guards.test.sql` F-SQL-08 et F-SQL-09 (`ESTIMATE_V3_EMISSION_NOT_READY`), liste
  blanche F-SQL-14 pour toute nouvelle comparaison de moteur. `estimate-email-outbox` et
  `portal-security-definer` restent inchangées et vertes.

### 5.2 Application (observé par le parcours)

- `POST …/pdf` et `POST …/send` acceptent une v3 (fin de `ESTIMATE_ENGINE_UNAVAILABLE` sur ces routes).
- **Choix** : `GET /api/estimates/<id>/verify` renvoie aussi, pour un sceau au marqueur 5,
  `seal_payload_version` (5), `client_contract_version` (1 ou 2) et `calc_payload_version` (4 ou 6) : c'est le
  seul observable du contrat et de la charge pour un parcours (schéma, OpenAPI et `openapi.json` à mettre à jour).
- Document, impression et portail impriment le texte du §3.3 ; exports XLSX et DPGF selon le §3.3.
- Portail : parcours d'acceptation inchangé.

## 6. Preuve rouge

### 6.1 pgTAP (17/10/2026)

WSL Ubuntu-24.04, Node 24.14.0, clone `~/miaouffrage-lot2-27` à `f1ee53bc` sans changement local (garde de
concurrence : 0 exécution native active au départ).

```sh
npm run db:ci:local
```

Sortie 1 en 22 s : `Files=20, Tests=1887`, `Result: FAIL`. Seule la nouvelle suite échoue :
`estimate-offer-contract-v2.test.sql (Tests: 50 Failed: 38) Failed tests: 9-41, 46-50`. Les 19 autres suites
passent, dont `estimate-email-outbox` et `portal-security-definer`. Journal :
`~/miaouffrage-lot2-27/.e2e/lot2-2.7/db-ci-red-final.log`.

Motifs, relus par une seconde exécution identique où seul le runner du clone gardait la fin complète de la
sortie de `pg_prove` (troncature à 6 000 caractères relevée à 400 000, modification locale annulée aussitôt ;
`db-ci-red-final-diagnostics.log`) :

| Assertions | Obtenu |
|---|---|
| 9 à 19 (F27-01 à F27-08) | `42883 function public.estimate_offer_client_valid_v2(jsonb, jsonb) does not exist` ; fonctions absentes |
| 20, 32, 39 (gels documentaires) | `42883 function public.freeze_estimate_v3_document_snapshot(...) does not exist` |
| 22 (réclamation v3) | `0A000 ESTIMATE_V3_EMISSION_NOT_READY` (garde des documents de M1) |
| 23, 33, 40, 46 (publications exactes) et 24 à 31, 34, 35 (paires) | `22023 ESTIMATE_PDF_PUBLICATION_INVALID` des deux côtés : le validateur du contrat 1 refuse le schéma 2 |
| 36 (appariement) | `42883 function public.estimate_offer_client_items_match_v2(...) does not exist` |
| 37, 41 (fraîcheur) | `22023 ESTIMATE_PDF_PUBLICATION_INVALID` au lieu d'un refus de fraîcheur nommé |
| 38 (passage à `sending`) | `0A000 ESTIMATE_V3_EMISSION_NOT_READY` au lieu de `40001 ESTIMATE_V2_SNAPSHOT_STALE` |
| 47 à 50 (S2 émis) | document absent ; `23514 OFFER_DOCUMENT_PROOF_MISMATCH` à l'émission |

Vertes : 1 à 8 (fixture contrôlée contre §5.2, versions v3 créées par M4, gel d'approbation de M4 exact sur
S2 et S5, identité capturée), 42 à 45 (témoins v1/v2 : réclamation, aucun contrat 2, contrat 1 publié et
valide).

Deux défauts de fixture, non de M5, ont été corrigés avant cette preuve (`f1ee53bc`) : un produit d'entiers
au-delà d'int4 dans le contrôle de l'oracle, et l'identité d'offre capturée pour S2 et réutilisée pour les
autres versions (référence suffixée `_V<n>`), que le témoin v1 refusait (`OFFER_CLIENT_IDENTITY_MISMATCH`).

### 6.2 Parcours V3E01 (phase calc-v3 `emission-v3`)

La campagne passe d'abord pgTAP et la matrice RLS : la suite SQL rouge (§6.1) l'arrêterait. Le parcours est
donc exécuté sur l'arbre du parcours **sans** cette suite : clone à `9d499562` (journey et harnais) plus le
seul correctif du parcours `8811831c`, repris en `3116ad6c` (branche locale du clone `e2e-red-l27` ;
`git diff 8811831c -- e2e scripts` vide), aucun changement local.

```sh
npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3127
```

Sortie 1 en 64 s (17/10/2026 21:07–21:08 UTC, 0 autre exécution native au départ) : pgTAP `Files=19, Tests=1837` PASS,
matrice RLS passée, phase `emission-v3` en échec, `Tests 1 failed | 1 passed (2)` (setup d'offre passé),
aucun modèle appelé, garde réseau d'offre installé (`collectorCalls: 3`). Preuves :
`~/miaouffrage-lot2-27/.e2e/army/ci/2026-10-17T21-07-48-109Z-calc-v3/` (`emission-v3/phase.json`,
`runner.log`, `offer-public/business/`, `pdf-text/`), journal `.e2e/lot2-2.7/e2e-calc-v3-emission-v3-red-2.log`.

| Étape | Résultat |
|---|---|
| Témoin v2 (préparation) | vert : PDF, envoi au collecteur, pièce jointe = document stocké (`d2f6f86a…0305`, 1 page), « 1 u 20,00 € 20,00 € », `[2, "sent", 5, 2000, 400, 2400]`, `/verify` 200 `valid` |
| S2 créé et réglé par l'API de 2.5 | vert : moteur 3, brut 6 905 456, remise appliquée 101, `[6905355, 1381071, 8286426]`, 7 lignes `[unité, Q, PU, taux]` exactes |
| Génération du PDF de S2 | **rouge** : `ASSERTION_FAILED: expected {"status":409,"code":"ESTIMATE_ENGINE_UNAVAILABLE"} to equal {"status":202,"code":null}` (`v3e01-s2-pdf-start.json` : « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action. ») |

Le rouge porte sur l'émission v3 fermée (garde TS de 2.1 sur `POST …/pdf`, avant le refus SQL
`ESTIMATE_V3_EMISSION_NOT_READY` de M1), après une préparation entièrement verte : ni écran de 2.6, ni
fixture, ni harnais.

Une première exécution (`2026-10-17T21-04-57-960Z-calc-v3`, `9d499562`) s'était arrêtée sur le témoin v2 :
l'envoi d'un brouillon refait le PDF d'envoi (`preparePdfForDispatch`, `force`), donc la pièce jointe ne peut
pas égaler le PDF manuel généré juste avant. Le parcours compare désormais la pièce jointe au document stocké
après l'envoi, comme OF00 (`8811831c`). Une tentative antérieure avait échoué avant tout parcours (port 3107
occupé par une autre session) ; les exécutions retenues utilisent `--app-port 3127`.

### 6.3 Parcours V3E02 (campagne critique locale, build de production)

Même clone et même arbre (`3116ad6c`, `diffSha256` vide), 0 autre exécution native au départ :

```sh
npm run e2e:army:local -- --grep '^V3E02\s' --app-port 3227
```

Sortie 1 en 122 s (17/10/2026 21:09–21:11 UTC) : pgTAP `Files=19, Tests=1837` PASS, matrice RLS passée,
build possédé, `Tests 1 failed | 1 passed (2)` (setup critique passé). Preuves :
`~/miaouffrage-lot2-27/.e2e/army/ci/2026-10-17T21-09-32-423Z-critical/` (manifeste `filtered-critical`,
`journeys-critical.log`), preuves métier `v3e02-*` sous `.e2e/army/critical/artifacts/business/`.

| Étape | Résultat |
|---|---|
| Propriétaire dédié, politique 3, rôle « Tuyauteur » 40 €/h, S2 créé et réglé | vert : moteur 3, brut 6 905 456, remise 101, `[6905355, 1381071, 8286426]`, 7 lignes exactes |
| Génération du PDF de S2 | **rouge** : `ASSERTION_FAILED: expected {"status":409,"code":"ESTIMATE_ENGINE_UNAVAILABLE"} to equal {"status":202,"code":null}` |

### 6.4 Contrôles locaux

Windows, worktree `miaouffrage-l2-27` : `node scripts/typecheck.mjs` sortie 0 ; `npx eslint --max-warnings=0`
sur les fichiers du parcours et du harnais sortie 0 ;
`npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts` : 2 fichiers,
23 tests passés (carte d'impact égale à la sélection critique, aucun nouveau `route.continue()`).

## 7. Limites

- La régression « v2 émise avant M5 » est rejouée dans la même exécution (témoin émis avant les v3, puis
  revérifié) : l'antériorité réelle à la migration relève de la montée de version et des empreintes
  documentaires (§10.2, §10.3), à rejouer à l'implémentation.
- V3E01 est servi en next dev (comme la phase `emission`) ; V3E02 qualifie le build de production sans
  courriel. Le passage de la phase `emission-v3` au build possédé dépend de l'extension du garde des
  conditions, non couverte ici (§2).
- La campagne complète `npm run e2e:army:calc-v3` est rouge tant que 2.7 n'est pas implémenté (phase
  `emission-v3`), comme la campagne critique locale (V3E02).
- La phase `emission-v3` ne pose aucun motif commun à tous les PDF reçus (`collectedPdfMustContain`) : le
  témoin v2 et les v3 diffèrent par conception ; V3E01 asserte le contenu de chaque PDF qu'il envoie, et la
  campagne exige toujours au moins un PDF reçu.
- Le texte est comparé à espaces près, et le signe de la remise peut être U+2212 ou un trait d'union.

## 8. Implémentation SQL (M5)

Migration `supabase/migrations/20261017213500_estimate_offer_client_contract_v2.sql` (commit `af708134`),
horodatée après `20261017162000` (M4) et après `20261017172127` (M7, PR #34) : si une migration plus récente
arrive sur `main`, `npm run supabase:migrations:restamp` puis `npm run supabase:manifest:add`. Aucune colonne
ajoutée, aucune ligne réécrite (D17) : `upgrade_check.declared_new_columns()` reste inchangée. Le contrat
supposé du §5.1 est tenu sans écart ; les assertions de `estimate-offer-contract-v2.test.sql` ne sont pas
modifiées.

### 8.1 Interface pour la piste TypeScript

| Objet | Signature | Droits |
|---|---|---|
| `public.estimate_offer_engine_client_contract` | `(p_calc_engine_version smallint) → smallint`, immuable : 3 → 2, 1 et 2 → 1, sinon NULL | `service_role` |
| `public.estimate_offer_client_valid_v2` | `(value jsonb, layout jsonb) → boolean`, immuable, faux sur toute erreur | `service_role` |
| `public.estimate_offer_client_items_match_v2` | `(snapshot jsonb, version public.estimate_versions) → boolean`, stable, faux sur toute erreur | `service_role` |
| `public.freeze_estimate_v3_document_snapshot` | `(p_version_id uuid, p_tenant_id uuid, p_expected_updated_at timestamptz, p_expected_content_revision bigint, p_actor_user_id uuid, p_draft_lock_session_id uuid, p_calculation_context jsonb, p_item_snapshots jsonb, p_version_totals jsonb) → public.estimate_versions` | `service_role` |

Signatures inchangées : `begin_estimate_pdf_generation` (5), `publish_estimate_pdf_generation` (11 ; aiguillage
sur `p_client_contract_snapshot.schemaVersion`), `reserve_estimate_email_dispatch[_with_session]`,
`prepare_estimate_email_dispatch` (12, `p_seal_payload_version = 5`), `transition_estimate_version_status`,
`transition_estimate_draft_to_sent`, `claim_estimate_email_dispatch`, `complete_estimate_email_dispatch`,
`claim_portal_estimate_decision`, `estimate_offer_document_proof` (porte `clientContractVersion: 2`).

**Contrat 2 tel que SQL l'apparie** (clés exactes, D14 et doc Vitest) :

- `version` : bloc du contrat 1 (`id`, `tenantId`, `projectId`, `number`, `contentRevision`,
  `calcEngineVersion: 3`, `dateDevis`, `validiteJours`, `currency`, `contractorRole`, `taxRateBp`), égal à la
  ligne verrouillée par la publication ; `project`, `issuer`, `company` : identité capturée
  (`capture_estimate_offer_identity`), `issuer.userId` = acteur ; `exclusions` = `estimate_versions.exclusions`.
- `rows` : **toutes** les lignes de la version (sections, lignes chiffrées ou non). Section
  `{kind, id, parentId, position, depth, number, title, saleHtCents}` ; ligne `{kind, id, parentId, position,
  depth, title, quantity, unitCode, unitLabel, pricingStatus, taxRateBp, unitSaleHtCents, saleHtCents}` ;
  `foSaleHtCents` et `moSaleHtCents` sur chaque ligne et section si et seulement si
  `layout.priceMode = fo_mo_and_total`. Correspondance : titre = titre rogné ou « Sans titre » (contrat 1),
  `quantity` = `quantity`, `unitCode` = `unit_code`, `unitLabel` = `measurement_units.symbol` (« m² » pour
  `m2`), `pricingStatus` = `pricing_status`, `taxRateBp` = `tax_rate_bp`, `unitSaleHtCents` =
  `snapshot_pu_ht_cents` (`null` hors `priced`), `saleHtCents` = `snapshot_gross_ht_cents`, `foSaleHtCents` =
  `snapshot_gross_fo_ht_cents`, `moSaleHtCents` = brut − FO brut ; section = Σ des lignes descendantes.
- `totals` : `grossHtCents` = `gross_ht_cents`, `commercialDiscountCents` = `discount_applied_cents`,
  `discountIntent` = `{kind}` de `calc_snapshot_context.discount.kind` (plus `rateBp` = `rate_bp` pour `rate`),
  `commercialRoundingCents` = `commercial_rounding_cents`, `netHtCents` = `total_ht_cents`, `taxByRate` =
  `calc_snapshot_context.tax_breakdown` renommé (`rate_bp` → `rateBp`, `base_cents` → `baseHtCents`,
  `tax_cents` → `taxCents`), même ordre (taux croissants), `taxCents` = `total_tax_cents`, `payableTtcCents` =
  `total_ttc_cents`, `reverseCharge` = (`contractor_role = 'subcontractor'`).

**Session de document v3** (jumelle de la v2, D15) :

1. bail de la page posé (`draft_locks`, utilisateur **et** `session_id`) ;
2. `freeze_estimate_v3_document_snapshot(…)` avec la projection du gel v3 (contexte §6.5, onze clés par ligne,
   pied à sept clés, comme `freeze_estimate_v3_snapshot`) : bail exact vérifié, puis
   `freeze_estimate_v3_snapshot(…, 'send', …)` recalcule tout par `private.estimate_v3_compute` et refuse
   1 c d'écart ; rejoué à l'identique, il ne réécrit rien ;
3. `begin_estimate_pdf_generation(version, tenant, acteur, 'manual' | 'workflow', null)` **après** le gel
   (la réclamation retient la révision de contenu) ;
4. rendu et dépôt du PDF, puis `publish_estimate_pdf_generation(…, p_client_contract_snapshot => contrat 2)` :
   document `ready`, `client_contract_version = 2` ;
5. émission manuelle : `transition_estimate_draft_to_sent(…, 'sent', sceau, …, 5::smallint,
   estimate_offer_document_proof(document, version), session)`.

Envoi par courriel d'un brouillon v3 : gel v3 frais **avant** la réservation (le passage à `sending` l'exige),
puis `reserve_estimate_email_dispatch_with_session` → `begin_estimate_pdf_generation(…, 'email', envoi)` →
publication (contrat 2, identité de l'envoi) → `prepare_estimate_email_dispatch(…, 5)` → `claim` →
`complete`. Renvoi d'une v3 envoyée : réservation (identité relue sur le contrat 2), préparation avec le même
sceau et le même document. Portail : `claim_portal_estimate_decision` inchangé (marqueur 5 et contrat de son
moteur).

**Codes d'erreur** (nouveaux ou nouvellement atteints par une v3) :

| Code | Fonction | Cas |
|---|---|---|
| `22023 ESTIMATE_PDF_PUBLICATION_INVALID` | `publish_estimate_pdf_generation` | contrat 1 ou 2 invalide en soi (clé, type, invariant, moteur ≠ 3 dans un contrat 2, contrat 1 d'une v3) |
| `23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH` | `publish_estimate_pdf_generation` | contrat d'un autre moteur, bloc version, exclusions, émetteur ; contrat 2 qui ne correspond pas au devis figé (ligne, unité, symbole, statut, taux, PU, brut, parts, pied, intention, TVA par taux) ou gel v3 absent ou périmé |
| `23514 OFFER_CLIENT_CONTRACT_ENGINE_MISMATCH` | déclencheur `aa_guard_estimate_document_engine_v3` | ligne de document, de tout statut, portant le contrat d'un autre moteur |
| `23514 OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED` | `guard_estimate_offer_document` | document `ready` sans le contrat de son moteur |
| `40001 ESTIMATE_V2_SNAPSHOT_STALE`, `23514 ESTIMATE_V2_SNAPSHOT_INVALID` | `require_fresh_v2_snapshot_for_publication` | v3 qui passe à `sending`/`sent` sans gel frais, ou gel incomplet (bruts figés absents, Σ bruts ≠ brut de version) |
| `22023 ESTIMATE_V3_DOCUMENT_SNAPSHOT_INPUT_INVALID`, `42501 ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE`, `42501 ESTIMATE_EMAIL_DISPATCH_FORBIDDEN`, `40001 ESTIMATE_DRAFT_LOCK_REQUIRED`, `40001 ESTIMATE_VERSION_CONFLICT`, `42501 ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT` | `freeze_estimate_v3_document_snapshot` | entrée nulle ; version absente ; affaire archivée ou acteur refusé ; bail d'une autre session ou expiré ; jeton ou révision ; statut ou moteur |
| codes de `freeze_estimate_v3_snapshot` (M4) | idem, en délégation | `23503 ESTIMATE_LABOR_ROLE_OWNER_MISMATCH`, `23502 ESTIMATE_V3_LABOR_ROLE_REQUIRED`, `22023 ESTIMATE_V3_UNIT_REQUIRED`, `22023 ESTIMATE_V3_TAX_RATE_NOT_ALLOWED`, `22023 ESTIMATE_V3_SNAPSHOT_INVALID`, `40001 ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT`, `22023 ESTIMATE_V3_PROJECTION_MISMATCH` |

Les autres refus d'offre gardent leurs noms et s'appliquent au contrat 2 comme au contrat 1
(`OFFER_CLIENT_IDENTITY_MISMATCH`, `ESTIMATE_PDF_GENERATION_SUPERSEDED`, `OFFER_DOCUMENT_PROOF_MISMATCH`,
`OFFER_SEAL_PAYLOAD_VERSION_REQUIRED`, `OFFER_MANUAL_EMISSION_CONTRACT_REQUIRED`,
`OFFER_NEW_EMISSION_CONTRACT_REQUIRED`, `OFFER_DOCUMENT_IMMUTABLE`, `OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED`).
SQL ne lève plus `ESTIMATE_V3_EMISSION_NOT_READY` ; le garde TS de 2.1 (`ESTIMATE_ENGINE_UNAVAILABLE` sur
`POST …/pdf` et `POST …/send`) relève de la piste TypeScript.

### 8.2 Fonctions redéfinies

Chaque fonction part de sa définition vivante, sans redéfinition postérieure : `20261013130248` pour les
fonctions d'offre, `20261017113844` (M1) pour `require_fresh_v2_snapshot_for_publication` et
`guard_estimate_document_engine_v3`. Toutes restent `security invoker`, `search_path` vide, mêmes droits
(réaffirmés) ; aucun `UPDATE`/`DELETE` nouveau (ceux qui existent gardent leur `WHERE`). Pour une v1/v2 la règle
d'appariement vaut 1 : chaque condition du contrat 1 est inchangée (`= 1` devient `in (1, 2)` sur une valeur
appariée au moteur, `is distinct from 1` devient « contrat du moteur »).

| Fonction | Changement |
|---|---|
| CHECK `estimate_documents_client_contract_pair_check` | `(2, copie non nulle)` admis (`not valid` puis `validate`) ; préliminaire : définition revue exacte, aucun document de v3 |
| `estimate_offer_document_valid` | contrat attendu = contrat du moteur ; validateur selon le contrat ; aucun document historique sans contrat pour une v3 |
| `guard_estimate_document_engine_v3` | refus M1 remplacé par l'appariement (`OFFER_CLIENT_CONTRACT_ENGINE_MISMATCH`) |
| `guard_estimate_offer_document` | `ready` exige le contrat du moteur ; immuabilité et réclamation pour les contrats 1 et 2 |
| `publish_estimate_pdf_generation` | validateur selon `schemaVersion` ; contrat présenté = contrat du moteur ; ancres du contrat 1 inchangées ou `estimate_offer_client_items_match_v2` ; écrit le contrat présenté |
| `reserve_estimate_email_dispatch`, `prepare_estimate_email_dispatch`, `transition_estimate_version_status`, `claim_portal_estimate_decision`, `assert_estimate_offer_dispatch_proof` | branche du contrat 1 étendue au contrat 2 (identité relue sur la copie, marqueur 5) |
| `guard_estimate_offer_seal` | marqueur 5 avec le contrat de son moteur |
| `require_fresh_v2_snapshot_for_publication` | refus M1 retiré ; v3 sous la gouvernance v2 (`in (2, 3)`) ; ligne non chiffrée sans PU figé admise (seulement possible en v3) ; v3 : bruts figés présents et Σ bruts = `gross_ht_cents` |

Inchangés : `estimate_offer_client_valid`, `estimate_offer_client_items_match` (faux hors {1, 2} depuis M1),
`begin_estimate_pdf_generation`, `freeze_estimate_v2_document_snapshot`, `freeze_estimate_v3_snapshot`.

### 8.3 Suites réalignées (`estimate-calc-engine-v3-guards.test.sql`)

Elles figeaient le refus général de M1, que M5 lève volontairement (§5.1) ; elles portent désormais le
comportement nommé qui le remplace, rouge sans M5 et vert avec :

| Assertion | Avant (M1) | Après (M5) |
|---|---|---|
| F-SQL-09, réclamation d'un document de v3 | `0A000 ESTIMATE_V3_EMISSION_NOT_READY` | `ok` (ligne `processing` sans contrat) |
| F-SQL-09, ligne de document de v3 | `failed` sans contrat refusée | `failed` portant le contrat 1 : `23514 OFFER_CLIENT_CONTRACT_ENGINE_MISMATCH` |
| F-SQL-08, v3 jamais figée vers `sending` / `sent` | `0A000 ESTIMATE_V3_EMISSION_NOT_READY` | `40001 ESTIMATE_V2_SNAPSHOT_STALE` |
| F-SQL-08, v3 au gel frais mais lignes non figées vers `sending` | `0A000 ESTIMATE_V3_EMISSION_NOT_READY` | `23514 ESTIMATE_V2_SNAPSHOT_INVALID` |
| F-SQL-14, liste blanche | — | ajout de `estimate_offer_engine_client_contract`, `estimate_offer_document_valid`, `publish_estimate_pdf_generation`, `estimate_offer_client_items_match_v2`, `freeze_estimate_v3_document_snapshot` ; motif de `require_fresh_v2_snapshot_for_publication` mis à jour ; `guard_estimate_document_engine_v3` retirée (plus de comparaison littérale ; le diagnostic des entrées sans comparaison rend « aucune ») |

### 8.4 Preuves

Retenues : WSL Ubuntu-24.04, Node 24.19.0, clone `~/miaouffrage-lot2-27` amené à `af708134` (`git fetch` du
dépôt Windows puis `reset --hard`), **aucun changement local**, garde de concurrence (au plus une autre
exécution native active au départ). Journaux : `~/miaouffrage-lot2-27/.e2e/lot2-2.7/m5-*.log`.

| Commande | Résultat (17/10/2026, UTC) |
|---|---|
| `npm run db:ci:local` | sortie 0 en 28 s (21:56–21:57) : `Files=20, Tests=1887`, `Result: PASS`, matrice RLS passée. Les 20 suites sont vertes, dont `estimate-offer-contract-v2` (ses 50 assertions : même total qu'au rouge du §6.1, 38 échecs alors), `estimate-email-outbox` et `portal-security-definer` sans modification |
| `npm run db:upgrade-check -- lot2-2-7` | sortie 0 en 19 s : 5 migrations postérieures appliquées sur la base peuplée (dont M5), **0 différence** (lignes, colonnes, `estimate_offer_document_valid` strict et historique, preuve, validateur et appariement du contrat 1 des documents émis), contrôle négatif détecté. Preuves : `.e2e/engine-v3/upgrade-check/2026-10-17T21-58-59-088Z-lot2-2-7/` |
| `npm run db:upgrade-check -- lot2-2-7 --negative-control` | sortie 1 en 19 s, échec exigé au verdict : exactement 1 différence, `estimate_items b2000000-…-000000000112 pu_ht_cents 1481 → 1482`. Preuves : `…/2026-10-17T21-59-19-110Z-lot2-2-7-negative-control/` |

Windows, worktree `miaouffrage-l2-27` : `npm run supabase:manifest:add` (249 entrées), `npm run
supabase:validate` (« 249 files, 249 unique versions »), `npm run supabase:migrations:git-guard` (passé),
`git diff --cached --check` (sortie 0). `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` : aucun diff (piste sans TypeScript).

Itération (clone privé `~/miaouffrage-l27-m5`, mêmes fichiers, journaux `~/l27-m5-logs/`) :

- `db:ci:local` vert dès la deuxième exécution (la première échouait à l'application de M5 : un `case … then`
  non parenthésé dans une condition PL/pgSQL `if`, corrigé avant tout commit) ; upgrade-check et contrôle
  négatif identiques à ceux retenus ;
- rouge des suites réalignées : sans M5, `estimate-calc-engine-v3-guards` échoue en 1 (F-SQL-14 : la garde de
  M1 compare encore un moteur à 3) et 25 à 29 (F-SQL-08/09 réalignées), `estimate-offer-contract-v2` en 9 à 41
  et 46 à 50, comme au §6.1 (`guards-red-without-m5.log`). Cette exécution a démarré alors que deux piles
  natives d'autres sessions tournaient (trois exécutions simultanées, au-delà de la garde de deux) : elle a
  abouti sans incident, les suivantes ont toutes attendu la garde ;
- sonde non versionnée (supprimée après usage) : la suite `estimate-offer-contract-v2` suivie d'un parcours
  SQL de S5 par les RPC de l'application, réservation (`reserve_estimate_email_dispatch_with_session`) →
  réclamation `email` → publication du contrat 2 → `prepare(…, 5)` → `claim` → `complete` → renvoi (même
  sceau, même document) → acceptation au portail par la capacité du renvoi. 60 assertions, toutes les étapes
  `ok` ; état final `accepted`, marqueur 5, sceau inchangé, document de contrat 2 valide, deux envois `sent`
  (les deux échecs relevés portaient sur l'écriture `t` d'un booléen dans la sonde elle-même).

### 8.5 Limites

- Le parcours `engine-v3-emission.e2e.ts` (les deux journées) dépend de la piste TypeScript (contrat 2,
  charge 6, routes) : il n'est pas rejoué par cette piste. Le chemin courriel, renvoi et portail d'une v3 n'a
  été prouvé en SQL que par la sonde non versionnée du §8.4 ; le parcours en reste la preuve retenue.
- `safeupdate` ne se charge pas sous pgTAP (rôle natif) : M5 n'ajoute aucun `UPDATE` ni `DELETE`, ceux des
  fonctions redéfinies gardent leur `WHERE` ; la preuve sous PostgREST passe par le parcours.
- Le Supabase partagé n'est pas touché ; M5 n'y est pas appliquée.
- Le renommage des identifiants du parcours (collision avec l'éditeur 2.6) relève des fichiers du parcours et
  de la phase, hors de cette piste : cette section ne les cite pas.
