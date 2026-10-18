# Sous-lot 2.7 — document client, contrat client 2, charge de calcul 6, émission v3

Rouge écrit **avant M5 et avant tout code de production de 2.7**, le 17/10/2026, branche
`lot2/2.7-document-emission-v3`, base `c14b243d` (pointe de 2.5, PR #33). Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), F1 à F3, D2, D7,
D8, D14, D15, §4, §5 (S2, S5), §6.1 (M5), §7 (fonctions d'offre), §8.1, §8.2, §10.4, §14 « 2.7 ».
Ce document couvre la suite SQL, le parcours, les deux pistes d'implémentation (§8, §9), l'intégration (§10)
et les tests isolés TypeScript (parseur strict du contrat 2, charge 6, préparateur du document, §11 : ancien
`estimate-engine-v3-2.7-vitest.md`, fondu ici le 18/10/2026 avec ses mesures). Là où ce document **choisit**
(signalé « Choix »), il fixe ce que le rouge exige ; ailleurs, la conception fait foi.

**Identifiants renommés le 18/10/2026** : V3E01 et V3E02 deviennent V3M01 et V3M02, et les défaillances V3E-01
à V3E-08 deviennent V3M-01 à V3M-08 (préfixe d'affaire `ARMY-V3M-calc-v3-`, preuves `v3m01-*`, `v3m02-*`) :
`engine-v3-editor.e2e.ts` (sous-lot 2.6) utilise déjà V3E01 à V3E03. Le renommage couvre le parcours, la phase
`emission-v3`, sa fixture, la carte d'impact et ce document ; les preuves rouges du §6 gardent les noms, les
commandes et les chemins tels qu'exécutés (`--grep '^V3E02\s'`, `v3e02-*`).

## 1. Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/tests/database/estimate-offer-contract-v2.test.sql` | pgTAP, F27-01 à F27-19 (§4) |
| `e2e/army/local/engine-v3-emission.e2e.ts`, `engine-v3-emission-support.ts` | Parcours V3M01, V3M03, V3M04, V3M05 et V3M06 (calc-v3) et V3M02 (critique locale), §3, §12 et §13 |
| `e2e/army/local/engine-v3-editor-actions.e2e.ts` (fichier de 2.6) | V3E11 réécrit et V3E15 (critique locale) à la fusion du 2.6, §13 |
| `e2e/army/local/engine-v3-exports.e2e.ts` | Parcours V3X01 (réimport du DPGF v3) et V3X02 (devise des montants), critique locale, §13.8 et §13.9 |
| `src/lib/estimates/v3-export.ts` | Exports XLSX standard et DPGF d'une v3 : libellé de statut des lignes non chiffrées, devise de la version (§13.8) |
| `src/lib/imports/optima-profile.ts` | Profil d'import déclaré `dpgf_export_v3` du DPGF v3 (§13.9) |
| `src/app/dashboard/estimates/[versionId]/print/EstimateV3PrintPage.tsx` | Impression d'une v3 : identité et CGV de la copie émise vérifiée hors brouillon (§13.8, §13.9) |
| `scripts/tester-army/calc-v3-phases.ts` | Nouvelle phase `emission-v3` (collecteur sentinelle ; next dev au rouge, build de production possédé depuis l'intégration, §10.4) |
| `scripts/tester-army/calc-v3-fixtures.ts` | Fixture de la phase : propriétaire dédié en politique 3, témoin v2 brouillon, second administrateur du tenant (V3M06, §13.8) |
| `scripts/tester-army/calc-v3-campaign.ts`, `e2e/army/local/calc-v3.config.ts` | Collecteur, garde réseau d'offre et lecture des PDF reçus pilotés par `sentinelCollector` (et non plus par le nom `emission`) |
| `scripts/tester-army/army-impact-map.json` | Parcours inscrits (la liste critique locale de `e2e.config.ts` prend `engine-v3-*.e2e.ts`) : `engine-v3-emission.e2e.ts` au groupe `print`, `engine-v3-exports.e2e.ts` au groupe `affaire-hub` (§13.8) |

## 2. Défaillances observables et preuves

| Défaillance | Preuve |
|---|---|
| v3 émise avec le contrat 1 | pgTAP F27-08 (validateur), F27-11 (publication) ; Vitest F27-V10, F27-V12 |
| v2 (ou v1) émise avec le contrat 2 | pgTAP F27-16 (témoin, vert avant M5) et F27-08 ; Vitest F27-V10, F27-V12 |
| Contrat 2 altéré d'1 c accepté : ligne, remise, base ou TVA d'un taux | pgTAP F27-03 à F27-05 (validateur), F27-10, F27-12 (publication), F27-13 (appariement) ; Vitest F27-V05 à F27-V08 |
| Contrat 2 altéré d'une clé, d'une unité ou d'un statut accepté | pgTAP F27-06, F27-07, F27-10, F27-13 ; Vitest F27-V02 à F27-V04 |
| Publication sans gel document v3 frais | pgTAP F27-14 (jamais figé ; passage à `sending`), F27-15 (gel périmé par le taux d'un rôle cité) |
| Deux générations d'un même devis figé, ou deux envois d'une même version scellée, au texte différent | V3M02 (deux générations, même texte), V3M01 (renvoi : même SHA-256 et même texte) ; Vitest F27-S04 |
| Empreintes v1/v2 qui changent | Vitest F27-S06, F27-S07 (charges 1 à 4 sur le corpus figé) ; V3M01 témoin v2 (V3M-08) ; `scripts/engine-v3/document-fingerprints.ts` et la montée de version (§10.2, §10.3 de la conception), rejoués à l'intégration (§10.5) |
| Charge 6 sans un champ v3 | Vitest F27-S02, F27-S03 |
| PDF : PT ≠ ⌈Q × PU⌋ | V3M01 et V3M02 (7 lignes, §3.3) ; pgTAP F27-03 ; Vitest F27-V06, F27-D01 |
| PDF : Σ lignes ≠ brut | V3M01, V3M02 (7 lignes brutes et brut 69 054,56 €) ; pgTAP F27-03, F27-04 ; Vitest F27-V05, F27-D03 |
| TVA d'un taux ≠ ⌈base × taux⌋ | V3M01, V3M02 (« TVA r % », base et montant) ; pgTAP F27-05, F27-12 ; Vitest F27-V08, F27-D04 |
| Portail, impression ou exports avec d'autres montants | V3M01 (impression, portail, XLSX, DPGF), V3M02 (impression, XLSX, DPGF) |
| Sceau d'une v3 sans marqueur 5, contrat 2 ou charge 6, ou vérification négative | V3M01 (`/verify`, §6.2) ; pgTAP F27-19 ; Vitest F27-S08 |
| Acceptation au portail d'une v3 qui échoue ou change son sceau | V3M01 |
| Conditions de développement hors du profil calc-v3 possédé | `src/lib/estimates/pdf-terms-server.test.ts`, écrit rouge avec l'extension (`7154c1ce`, puis vert, §9) : refus avec un marqueur d'hébergement, hors profil `calc-v3` ou sur la pile des développeurs, cas `offer` sur 45585 inchangé. V3M02 tourne sans CGV (`includeTerms: false`) ; V3M01, servi en next dev jusqu'à l'intégration, en dépend depuis le passage des phases d'émission au build possédé (§10.4) |
| Conditions de développement servies par un build calc-v3 hors de la pile possédée (sans marqueur du lanceur ni répertoire de campagne) | `pdf-terms-server.test.ts`, cas ajoutés à la revue, rouges puis verts (§12) |
| Aperçu d'impression ou export XLSX standard/DPGF d'un brouillon v3 qui ne peut pas être figé : page d'erreur ou 500 anonyme | V3FC02, étendu à la revue (§12) |
| Résumé d'approbation d'une version émise illisible (écriture refusée par `guard_estimate_versions_readonly`) | V3M01, V3M-09 (revue, rouge sans `e4fc30cf`, §12) |
| v3 au-dessus du seuil d'approbation non émissible une fois approuvée, ou approbation perdue au gel du document | V3M03 (revue, §12) |
| Envoi, avec un fournisseur, d'une v3 non figeable : réussi, refus anonyme, ou document, reçu, statut ou version modifiés | V3M04 (revue, §12) |
| En-tête « TVA : » vide d'un contrat 2 sans ligne chiffrée | V3M02, scénario ajouté à la revue (rouge sans `3a8e576a`, §12) |
| Impression d'une v3 émise avec le profil du lecteur ou l'affaire modifiée après l'émission ; pied du portail du contrat 2 sans l'emphase du pied v3 | V3M06, V3M-15 et V3M-16 (§13.8) |
| Impression d'une v3 émise avec d'autres CGV que sa copie scellée (ajoutées par la case ou la politique courante, retirées par la mise en page) | V3M05 et V3M06, V3M-17 (§13.9) |
| Classeurs v3 en USD ou GBP au format « € » ; ligne non chiffrée recréée facturable au réimport du DPGF | V3X02 ; V3X01, V3X-01 et V3X-02 (§13.8) |
| Ligne chiffrée avec main-d'oeuvre réimportée avec ses heures comptées deux fois (PT / Q lu en prix de fourniture, h/u en heures de ligne) | V3X01, V3X-07 (§13.9) |

## 3. Parcours `engine-v3-emission.e2e.ts`

### 3.1 Principe

Le devis v3 est créé et réglé par l'API de 2.5 (`POST /api/estimates` avec `expected_calc_engine_version: 3`,
section par `POST …/items`, 7 lignes par `POST …/batch`, remise par `PATCH …`), jamais par la grille de 2.6.
L'émission passe par les routes que l'interface appelle, sous le bail de la page : `POST …/pdf?force=1`,
`GET …/pdf?format=json`, `POST …/send` (`Idempotency-Key`, `If-Match`), `GET …/verify`,
`GET …/export?format=xlsx[&mode=dpgf]`. Seuls l'impression (`/dashboard/estimates/<id>/print`) et le portail
(lien collecté, acceptation) passent par l'écran. Le rouge porte donc sur l'émission fermée et le contrat 2
absent, pas sur des écrans de 2.6. Chaque étape enregistre attendu et obtenu avant d'asserter.

Chaque scénario n'est défini que dans sa campagne : V3M01 si `E2E_ARMY_SUITE=calc-v3` et
`E2E_CALC_V3_PHASE=emission-v3` (la phase exige exactement 1 résultat de ce fichier, setup compris à part) ;
V3M02 si `E2E_ARMY_SUITE=critical` (le fichier entre dans la sélection critique locale et complète par
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

### 3.4 V3M01 — phase calc-v3 `emission-v3`

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

### 3.5 V3M02 — campagne critique locale (build de production, sans courriel)

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
  documentaires (§10.2, §10.3 de la conception), rejouées à l'intégration (§10.5).
- À l'écriture des tests, V3M01 était servi en next dev (comme la phase `emission`). Limite levée à
  l'intégration (`2299b4a4`, §10.4) : les phases `emission` et `emission-v3` servent le build de production
  possédé (`next start`) avec les conditions bac à sable du profil calc-v3 possédé ; V3M02 qualifie ce build
  sans courriel.
- La campagne complète `npm run e2e:army:calc-v3` est rouge tant que 2.7 n'est pas implémenté (phase
  `emission-v3`), comme la campagne critique locale (V3M02).
- La phase `emission-v3` ne pose aucun motif commun à tous les PDF reçus (`collectedPdfMustContain`) : le
  témoin v2 et les v3 diffèrent par conception ; V3M01 asserte le contenu de chaque PDF qu'il envoie, et la
  campagne exige toujours au moins un PDF reçu.
- Le texte est comparé à espaces près, et le signe de la remise peut être U+2212 ou un trait d'union.

## 8. Implémentation SQL (M5)

Migration `supabase/migrations/20261018102840_estimate_offer_client_contract_v2.sql`. Écrite au commit
`af708134` sous l'horodatage `20261017213500`, après `20261017162000` (M4) et `20261017172127` (M7, PR #34), elle
est réhorodatée par `npm run supabase:migrations:restamp` à la fusion de `main` du 18/10/2026, après M6 et M6b de
la PR #40, contenu inchangé (sha256 `d0a799c0…c84f`, §13.10). Aucune colonne
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

## 9. Implémentation TypeScript

Commits `7154c1ce` (garde des conditions, rouge d'abord), `71d04e03` (implémentation), `f2b70f87` (renommage
V3M), `3a8e576a` (en-tête d'un contrat 2 sans ligne chiffrée), `ff084a1f` et `dad77e83` (sondes, §9.3),
`e4fc30cf` (résumé d'approbation d'une version émise, §9.4). Tests isolés et contrôles : §11.7 (« Vert »).

### 9.1 Chemins ouverts à la v3

| Chemin | Comportement |
|---|---|
| `POST …/pdf` (`markEstimatePdfProcessing`) | moteur lu strictement ; une v3 fige son document (`freeze_estimate_v3_document_snapshot`, bail exact) puis réclame la génération |
| génération (`generateEstimatePdfNow`) | `prepareEstimateV3DocumentData` relit le gel (aucun recalcul, gel incohérent refusé), `buildClientContract2` construit la copie (analysée strictement), même document commercial (`pdf-v3-totals.tsx` pour le pied), publication du contrat 2 |
| `POST …/send` (`sendEstimateEmail`) | gel de document v3 avant la réservation, puis PDF d'envoi, relecture vérifiée (contrat 2, charge 6), `prepare_estimate_email_dispatch(…, 5)` ; renvoi d'une v3 envoyée : même sceau, même document |
| émission manuelle (`patchEstimateStatus`) | gel de document v3, PDF, relecture, `transition_estimate_draft_to_sent(…, 5, preuve)` ; une émission exige un contrat (1 ou 2), jamais une copie historique |
| `GET …/verify` | marqueur 5 : `seal_payload_version: 5`, `client_contract_version` (1 ou 2), `calc_payload_version` (4 ou 6) ; v3 sans marqueur 5 : `valid: false`, aucun candidat historique (empreinte de charge 6 pour diagnostic) |
| impression (`print/page.tsx` → `EstimateV3PrintPage.tsx`) | vue séparée : `loadEstimateV3DocumentSource` (gel si émise ou à jour, sinon aperçu du moteur pur appliqué en mémoire), `EstimateDocument` en mode v3 (unité, brut, statut, `EstimateDocumentTotalsV3`) ; un aperçu impossible (rôle de MO manquant) est dit |
| portail | `CommercialEstimateDocument` rend le contrat 2 (HT net, taux du récapitulatif) ; acceptation inchangée |
| exports `standard` et `dpgf` | `v3-export.ts` : unité, statut, taux, h/u (en-têtes « h MO / unité »), PU et PT bruts, « Remise commerciale », arrondi, HT net, TVA par taux, TTC ; accès contrôlé d'abord par `getEstimateVersionDetails` |

Conservés fermés (refus nommé `ESTIMATE_ENGINE_UNAVAILABLE`, résiduel ; écart consigné dans la conception, P-20, décision du porteur requise, §12) : l'export `bdc` (coûts d'achat :
relève de l'unité d'achat de 2.9) et l'export de l'éditeur (`editor-export.ts`, côté client, atteignable par
l'éditeur v3 de 2.6) ; la fiche du devis (`[versionId]/page.tsx`) garde le bandeau de 2.1, que 2.6 remplace par
sa vue de lecture v3 : le document émis s'ouvre par l'impression, le PDF et le portail.

### 9.2 Interface appelée côté SQL (M5, §8.1)

- `freeze_estimate_v3_document_snapshot(p_version_id, p_tenant_id, p_expected_updated_at,
  p_expected_content_revision, p_actor_user_id, p_draft_lock_session_id, p_calculation_context,
  p_item_snapshots, p_version_totals)` par le client `service_role`, avec la projection du gel v3
  (`projection.context`, `toEstimateV3ItemSnapshots`, `toEstimateV3FrozenTotals`, calcul commun avec
  `freeze_estimate_v3_snapshot`). Refus rendus : `ESTIMATE_DRAFT_LOCK_REQUIRED` → 409 `LOCK_REQUIRED` ;
  `ESTIMATE_V3_LABOR_ROLE_REQUIRED`, `ESTIMATE_V3_UNIT_REQUIRED`, `ESTIMATE_V3_TAX_RATE_NOT_ALLOWED`,
  `ESTIMATE_V3_PROJECTION_MISMATCH` → 400 nommés ; `ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT` → 409
  `CONTEXT_CHANGED` ; autre 40001 → 409 `VERSION_CONFLICT` ; le reste par `mapSupabaseError`.
- `begin_estimate_pdf_generation` puis `publish_estimate_pdf_generation(…, p_client_contract_snapshot =>
  ClientContract2)` (signatures inchangées).
- `transition_estimate_draft_to_sent` / `transition_estimate_version_status`, `reserve_estimate_email_dispatch`,
  `prepare_estimate_email_dispatch` et `claim_portal_estimate_decision` avec `p_seal_payload_version = 5`, le
  sceau `computeOfferSealHashV2` (charge 6 hachée) et la preuve `clientContractVersion: 2` relue sur
  `estimate_documents`.
- Correspondance du contrat 2 (§8.1) : PU = `snapshot_pu_ht_cents` (le préparateur refuse un PU figé ≠ PU
  publié), brut et FO brut figés, MO brute = brut − FO, symbole du référentiel, intention lue sur le contexte.

### 9.3 Sondes corrigées (justification)

Le rouge s'arrêtait à la génération du PDF (§6.2) ; une fois l'émission ouverte, l'envoi de S2 de V3M01 a été
refusé (`400 ESTIMATE_GATING_BLOCKED`, `.e2e/army/ci/2026-10-17T22-39-06-638Z-calc-v3/`) par deux contrôles
antérieurs à 2.7, hors de son contrat, que le rouge n'atteignait pas (`ff084a1f`, aucune assertion modifiée) :

- `rule_violation` : toute nouvelle entreprise reçoit la règle globale d'approbation du produit à 5 000 € HT
  (`seed_default_estimate_approval_rule`, `20260812223050`) ; S2 et S5 valent 69 053,55 € HT. La fixture
  `emission-v3` désactive cette règle de son entreprise dédiée seulement, avec relecture (une ligne, seuil
  500 000 c) ; l'approbation a ses propres parcours.
- `line_nature_mismatch` : la règle de nature de ligne (bloquante à l'envoi, tous moteurs) compte un rôle de MO
  comme de la main-d'oeuvre ; la ligne-oracle O3 (« fourniture seule », 0 h/u) n'en porte plus. Aucun montant
  n'en dépend (MO = 0).

Une troisième sonde, de synchronisation (`dad77e83`) : sous `next dev`, V3M01 cliquait « Accepter le devis » dès
le texte du portail lu, avant l'hydratation de ses actions (îlot client) ; la fenêtre ne s'ouvrait pas. Le clic
est répété jusqu'à la fenêtre, comme pour la bascule du mot de passe de la même journée ; assertions inchangées.

### 9.4 Preuves E2E (WSL, clone `~/miaouffrage-lot2-27`, aucun changement local)

| Commande | Arbre | Résultat |
|---|---|---|
| `npm run e2e:army:local -- --grep '^V3M02\s' --app-port 3227` | `f2b70f87` | sortie 0 en 2 min 08 s (17/10/2026 22:34 UTC) : pgTAP et matrice RLS passés, build possédé, `Tests 2 passed (2)` (setup critique et V3M02) ; preuves `.e2e/army/ci/2026-10-17T22-34-41-594Z-critical/`, preuves métier `v3m02-*` (S2 puis S5 : PDF, deux générations au même texte, impression, XLSX, DPGF, toutes vraies) |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3127` | `3a8e576a` | sortie 1 (22:39 UTC) : envoi de S2 refusé `400 ESTIMATE_GATING_BLOCKED` (règle d'approbation par défaut, nature de ligne d'O3) ; sondes corrigées `ff084a1f` (§9.3). `.e2e/army/ci/2026-10-17T22-39-06-638Z-calc-v3/` |
| idem | `ff084a1f` | sortie 1 (22:46 UTC) : S2 et S5 émis, scellés (marqueur 5, contrat 2, charge 6), imprimés et exportés ; la fiche du devis émis tentait de réécrire le résumé d'approbation (« Estimate version is read-only » ; la requête de l'overlay de `next dev` est bloquée par le garde d'offre). Défaut d'application, corrigé par `e4fc30cf` (`rules-engine.ts` : une version émise n'est plus réécrite, son résumé est calculé pour l'affichage). Sous `next start`, sans overlay, ce parcours ne le détectait plus : la régression est assertée depuis la revue (V3M-09, rouge sans `e4fc30cf`, §12). `…/2026-10-17T22-46-15-379Z-calc-v3/` |
| idem | `e4fc30cf` | sortie 1 (22:53 UTC) : renvoi au même document et texte du portail exacts ; clic d'acceptation avant l'hydratation, sonde corrigée `dad77e83` (§9.3). `…/2026-10-17T22-53-37-829Z-calc-v3/` |
| idem | `dad77e83` | **sortie 0** en 1 min 31 s (22:57 UTC) : pgTAP (`Files=20`) et RLS passés, `Tests 2 passed (2)` (setup d'offre et V3M01), garde réseau d'offre installé (`collectorCalls: 15`), 4 PDF reçus (témoin v2, S2, S5, renvoi de S5 au même SHA-256) ; `/verify` de S2 et S5 : `valid`, marqueur 5, contrat 2, charge 6 ; acceptation au portail, même sceau ; témoin v2 revérifié (contrat 1, charge 4, même PDF). `…/2026-10-17T22-57-50-321Z-calc-v3/` |
| `npm run e2e:army:local -- --grep '^V3M02\s' --app-port 3227` | `dad77e83` | **sortie 0** en 1 min 35 s (23:00 UTC) : `Tests 2 passed (2)`. `.e2e/army/ci/2026-10-17T23-00-06-764Z-critical/` |
| `npm run e2e:army:calc-v3 -- --phase emission --app-port 3127` (régression v2) | `dad77e83` | sortie 0 en 3 min 31 s (23:02 UTC) : setup et OF00, OF01, OF02, OF04, OF0L, 6 réussis (OF03 rouge à la base, hors sélection). `…/2026-10-17T23-02-01-793Z-calc-v3/` |
| `npm run engine:document-fingerprints -- check` | `dad77e83` | sortie 0 en 60 s (23:06 UTC) : 14 familles v1/v2 identiques, agrégat `2b9715519d99…391b78e4` égal à la référence de 2.0 (avertissements : Node 24.14.0 et ICU 78.2 au lieu de la référence). `.e2e/engine-v3/document-fingerprints/2026-10-17T23-06-33-916Z-check/` |

Chaque exécution native a attendu la garde de concurrence (au plus une autre exécution native active au départ).
Non rejoués par cette piste : la campagne complète `npm run e2e:army:calc-v3` (toutes phases),
`npm run e2e:army:ci -- full` et `db:upgrade-check` (aucune migration dans cette piste ; voir §8.4). Le
Supabase partagé n'est pas touché.

### 9.5 Limites

- La fiche du devis (`[versionId]/page.tsx`) d'une v3 garde le bandeau de 2.1 ; 2.6 apporte la vue de lecture v3.
  À la fusion de 2.6, l'impression d'une v3 doit rester celle de 2.7 (`EstimateV3PrintPage`, document client) :
  le résumé de brouillon de 2.6 (`EstimateV3DraftSummary`) n'imprime ni les lignes brutes ni le pied qu'exige
  V3M02.
- Exports `bdc` et de l'éditeur fermés à la v3 (§9.1).
- La phase `emission-v3` reste en `next dev` ; l'extension du garde des conditions permet son passage au build
  possédé (évolution du harnais, non faite ici ; faite à l'intégration, §10.4).

## 10. Intégration (18/10/2026)

Intégration des deux pistes (SQL `af708134`, `f8cc1dc8` ; TypeScript `7154c1ce` à `e7dcbdf4`) sur
`lot2/2.7-document-emission-v3`, sans rebase ni poussée. Commits d'intégration : `8a2c4b9e` (fusion de
`main`), `1d43528b` (V3FC02, §10.3), `f342398f` (fusion de `main`, PR #38), `2299b4a4` (phases d'émission en
build de production, §10.4), `e9855ed1` (commentaires pointant vers ce document), puis ce document (documentation seule).

### 10.1 Interfaces rapprochées

Aucun écart entre l'interface publiée par la piste SQL (§8.1) et celle appelée par la piste TypeScript (§9.2) ;
la preuve exécutée est V3M01 et V3M02 (une copie construite par le TypeScript que le validateur ou
l'appariement SQL refuserait ferait échouer la publication en `22023` ou `23514`).

| Interface | Rapprochement |
|---|---|
| `freeze_estimate_v3_document_snapshot` | neuf arguments de mêmes noms et types (`p_expected_content_revision` `bigint` ↔ `number`, `p_draft_lock_session_id` `uuid` ↔ `string`) ; retour `estimate_versions` ; entrée de `src/types/database.ts` (CRLF conservé) identique à la signature SQL. Les aides `estimate_offer_engine_client_contract`, `estimate_offer_client_valid_v2` et `estimate_offer_client_items_match_v2` ne sont pas appelées par le TypeScript et restent hors des types, comme leurs jumelles du contrat 1 |
| Forme du contrat 2 | mêmes clés exactes des deux côtés (`estimate_offer_client_valid_v2` / `parseContract2`) : 8 à la racine, 11 dans `version`, 8 par section et 13 par ligne (plus `foSaleHtCents`/`moSaleHtCents` si et seulement si `fo_mo_and_total`), 9 dans `totals`, 3 par taux ; profondeur ≤ 3 pour une section, ≤ 4 pour une ligne ; `buildClientContract2` suit la correspondance de colonnes du §8.1 |
| Invariants | ⌈Q × PU⌋ en décimal exact (`round(numeric)` en SQL, `bigint` en TypeScript) ; remise au taux min(⌈G × bp⌋, G) ; TVA d'un taux ⌈base × taux⌋ (0 en autoliquidation) ; taux du récapitulatif = taux distincts des lignes chiffrées, ce que produit le moteur (`computeTaxByRate` crée un groupe par taux chiffré, même à base nulle : une ligne chiffrée à 0 € ne casse pas l'appariement) |
| Codes d'erreur | `ESTIMATE_DRAFT_LOCK_REQUIRED` → 409 `LOCK_REQUIRED` ; `ESTIMATE_V3_LABOR_ROLE_REQUIRED`, `_UNIT_REQUIRED`, `_TAX_RATE_NOT_ALLOWED`, `_PROJECTION_MISMATCH` → 400 nommés ; `ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT` → 409 `CONTEXT_CHANGED` ; autre `40001`/`40P01` ou `ESTIMATE_VERSION_CONFLICT` → 409 `VERSION_CONFLICT` ; `ESTIMATE_V3_DOCUMENT_SNAPSHOT_INPUT_INVALID`, `ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE`, `ESTIMATE_EMAIL_DISPATCH_FORBIDDEN` et `ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT` par `mapSupabaseError` |
| Marqueurs | marqueur de sceau 5 pour les deux contrats ; preuve `clientContractVersion: 2` ⇔ copie `schemaVersion: 2` ⇔ moteur 3 ; charge 4 ⇔ contrat 1, charge 6 ⇔ contrat 2 |

### 10.2 Fusion de `main`

- `8a2c4b9e` : `origin/main` à `78ca0855` (PR #34 = 2.9 avec M7 `20261017172127`, #36, #37). Un seul conflit,
  `supabase/migrations.manifest.json` : les deux entrées gardées dans l'ordre des horodatages. M5
  (alors `20261017213500`) reste après M7 : **aucun réhorodatage** à cette fusion (réhorodaté au §13.10). M7 et M5 redéfinissent des objets disjoints
  (M7 : `supplier_pricebook`, `private.purchase_*`, `create_estimate_purchase_order_drafts`,
  `update_supplier_offer`, `catalogue_products_page` ; M5 : fonctions d'offre, §8.2). Les autres fichiers
  communs (`server.ts`, `registry.ts`, `openapi.json`, `database.ts`, `calc-v3-phases.ts`,
  `calc-v3-fixtures.ts`, `tester-army-calc-v3.md`) fusionnent sans conflit.
- `f342398f` : `origin/main` à `91068850` (PR #38, documentation seule : relevé de M7 sur le Supabase partagé).
- `npm run supabase:validate` : « 250 files, 250 unique versions » ; `npm run supabase:migrations:git-guard` :
  passé (« 2 scoped changes »). Avant le commit de fusion, le garde comptait M7 comme nouvelle migration
  (base de fusion antérieure) : artefact d'une fusion non validée, disparu au commit.

### 10.3 V3FC02 réaligné (défaut d'intégration)

La campagne critique locale sur la tête fusionnée (`8a2c4b9e`, `--grep "V3M02|V3P01|V3FC"`) a échoué sur
V3FC02 seul (`.e2e/army/ci/2026-10-17T23-29-55-461Z-critical`, `Tests 1 failed | 4 passed (5)`) :
`expected {"status":409,"ok":false,"code":"LOCK_REQUIRED",…} to equal {"status":409,"ok":false,"code":"ESTIMATE_ENGINE_UNAVAILABLE",…}`.
V3FC02 (2.1, E2E-03) figeait le refus général de l'émission v3 que le contrat 2.7 lève (§5.2) ; la piste
TypeScript n'avait rejoué que `^V3M02\s`. La sonde teste donc une exigence révolue, comme F-SQL-08/09 (§8.3) et
les tests Vitest du §11.4 : elle est réalignée (`1d43528b`), V3FC01 et l'en-tête du fichier restant intacts
(2.6 réécrit V3FC01).

E2E-03 porte désormais sur une v3 que le moteur 3 ne peut pas figer : la ligne chiffrée de la fixture n'a pas
d'unité (D9) et ses montants stockés sont périmés (0). Sous le bail de la page (`POST …/lock` 201, pour qu'un
refus ne soit pas un artefact de verrou), la publication est refusée par son nom avant toute réclamation
(400 `ESTIMATE_V3_UNIT_REQUIRED`, « Une unité est requise sur chaque ligne chiffrée avant le gel. ») ; l'envoi,
porté par la même session de bail, est refusé dans la campagne critique par la configuration sans fournisseur
(500 `INTERNAL_ERROR`, « Configuration email manquante: RESEND_API_KEY. », `run-tester-army-ci.ts` laisse la clé
vide) avant toute relecture, gel ou réservation ; aucun document, envoi ni changement d'état dans les deux cas.
Valeurs attendues déduites du code avant l'exécution (`prepareEstimateV3FreezeArguments`, `getRequiredEnvVar`).
L'envoi d'une v3 figée reste prouvé par V3M01 (collecteur), le refus SQL d'une v3 non figée par F-SQL-08 et
F27-14.

Vert : `.e2e/army/ci/2026-10-17T23-36-09-342Z-critical` (`1d43528b`), `Tests 5 passed (5)` ; preuve métier
`ARMY-1792280251709-a5cb4b7c-engine-v3-emission.json` : bail 201, publication et envoi exactement comme
attendus, état `{documents: 0, emails: 0, status: "draft", totals: [0, 0, 0]}` inchangé.

### 10.4 Phases d'émission en build de production

Sur la tête fusionnée avec le 2.9, la phase `emission` servie par `next dev` échouait sur OF00
(`.e2e/army/ci/2026-10-17T23-41-19-095Z-calc-v3`, `5 passed | 1 failed`) : « Générer et télécharger » jamais
activé, le `PATCH …/lock` du dialogue PDF répondant 409 (journal applicatif). C'est l'artefact de
rechargement à chaud relevé par le 2.9 ([estimate-engine-v3-2.9.md](estimate-engine-v3-2.9.md),
« OF00 en mode développement » : 7 échecs sur 7 en développement, 6/6 en build de production), dont la
décision partagée confie au 2.7 le passage des phases d'émission en build de production ; la même phase était
verte à `dad77e83`, avant la fusion du 2.9 (§9.4). L'extension de `canUseDevelopmentEstimateTerms` au profil
calc-v3 possédé (`7154c1ce`, `71d04e03`) existe pour cela.

`2299b4a4` : `emission` et `emission-v3` servent `next start` sur le build possédé, avec
`E2E_OFFER_SERVER_MODE=production` et `E2E_OFFER_SANDBOX_TERMS=1` pour l'application et le processus des
parcours (`calc-v3-phases.ts`, `calc-v3.config.ts`, `calc-v3-campaign.ts`) ; collecteur, garde réseau d'offre,
fixtures et parcours inchangés. La limite « V3M01 en next dev » des §7 et §9.5 est levée.

### 10.5 Preuves retenues

WSL Ubuntu-24.04, Node 24.19.0 (`nvm use`), clone `~/miaouffrage-lot2-27` amené à chaque arbre par
`git fetch` du dépôt Windows puis `reset --hard`, **aucun changement local** ; chaque exécution native a
attendu la garde de concurrence (moins de deux exécutions natives actives au départ ; journaux
`~/miaouffrage-lot2-27/.e2e/lot2-2.7/int-*.log`, avec révision, commande, garde et durée).

| Commande | Arbre | Résultat (UTC) |
|---|---|---|
| `npm run db:ci:local` | `8a2c4b9e` | sortie 0 en 27 s (17/10 23:28) : `Files=21, Tests=1904`, `Result: PASS`, matrice RLS passée ; `estimate-offer-contract-v2` ok (50 assertions, `no_plan`, aucune modifiée), `estimate-calc-engine-v3-guards`, `estimate-email-outbox`, `portal-security-definer` et `supplier-offer-purchase-unit` (M7) ok. `supabase/` est identique à `e9855ed1` (diff vide) ; chaque campagne ci-dessous rejoue pgTAP et la matrice RLS à `e9855ed1` (`Files=21, Tests=1904`, PASS) |
| `npm run e2e:army:local -- --grep "V3M02\|V3P01\|V3FC" --app-port 3227` | `8a2c4b9e` | sortie 1 (rouge du §10.3) : V3FC02 en échec, V3FC01, V3M02 et V3P01 verts. `.e2e/army/ci/2026-10-17T23-29-55-461Z-critical` |
| idem | `1d43528b` | sortie 0 en 97 s : `Tests 5 passed (5)`. `…/2026-10-17T23-36-09-342Z-critical` |
| idem | `e9855ed1` | **sortie 0** en 112 s (23:52) : build possédé, `Test Files 4 passed (4)`, `Tests 5 passed (5)` (setup critique, V3M02, V3FC01, V3FC02, V3P01). `…/2026-10-17T23-52-16-513Z-critical` |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3127` | `1d43528b` (`next dev`) | sortie 0 en 97 s : V3M01 vert sur la tête fusionnée. `…/2026-10-17T23-39-41-160Z-calc-v3` |
| `npm run e2e:army:calc-v3 -- --phase emission --app-port 3127` | `1d43528b` (`next dev`) | sortie 1 en 194 s (rouge du §10.4) : OF00 en échec, OF01, OF02, OF04, OF0L verts. `…/2026-10-17T23-41-19-095Z-calc-v3` |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3127` | `e9855ed1` (production) | **sortie 0** en 101 s (23:54) : `Tests 2 passed (2)` (setup d'offre, V3M01), build inchangé pendant la phase, garde réseau d'offre installé (`collectorCalls: 11`), 4 PDF reçus (témoin v2, S2, S5, renvoi de S5 au même SHA-256 `3fb811b4…`). `/verify` de S2 et S5 : `valid`, `stored_hash = computed_hash`, `seal_payload_version: 5`, `client_contract_version: 2`, `calc_payload_version: 6`. Texte du PDF et impression : 7 lignes, brut, remise, net, TVA par taux (S2 : 20 % ; S5 : 10 % et 20 %), TTC ; XLSX et DPGF : 7 lignes et remise. Renvoi : reçu et portail distincts, même PDF, même texte. Portail : 200 `accepted`. Témoin v2 : `valid`, contrat 1, charge 4, document stocké au SHA-256 de sa pièce jointe (`6488f9cc…`). `…/2026-10-17T23-54-10-064Z-calc-v3` |
| `npm run e2e:army:calc-v3 -- --phase emission --app-port 3127` | `e9855ed1` (production) | **sortie 0** en 126 s (23:55) : setup, OF00, OF01, OF02, OF04, OF0L, 6/6 (OF03 rouge à la base, hors sélection) ; 4 PDF reçus de 2 pages et 4 534 caractères, motifs communs vérifiés. `…/2026-10-17T23-55-51-607Z-calc-v3` |
| `npm run e2e:army:calc-v3 -- --app-port 3127` (campagne complète) | `e9855ed1` | **sortie 0** en 12 min 14 s (23:57–00:10) : pgTAP et RLS passés ; toutes les phases en build de production : journeys 11/11, components 5/5, numeric 4/4, resume 5/5 (GR02, GR04, GR06, GR08 ; GR01, GR03, GR05, GR07, GR09 rouges à la base, hors sélection), access 2/2, offers 10/10, emission 6/6, emission-v3 2/2. `…/2026-10-17T23-57-58-418Z-calc-v3` |
| `npm run engine:document-fingerprints -- check` | `e9855ed1` | sortie 0 en 46 s (18/10 00:10) : 14 familles v1/v2, agrégat `2b9715519d99…391b78e4` égal à la référence, aucune différence, aucun avertissement d'environnement (Node 24.19.0, ICU 78.3). `.e2e/engine-v3/document-fingerprints/2026-10-18T00-10-14-119Z-check` |
| `npm run db:upgrade-check -- lot2-2-7` | `e9855ed1` | sortie 0 en 20 s : 244 migrations de base, 6 postérieures appliquées sur la base peuplée (M2, M1, M3, M4, M7, M5), **0 différence**. `.e2e/engine-v3/upgrade-check/2026-10-18T00-11-00-533Z-lot2-2-7` |
| `npm run db:upgrade-check -- lot2-2-7 --negative-control` | `e9855ed1` | sortie 1 en 19 s, échec exigé : exactement 1 différence, `estimate_items b2000000-…-000000000112 pu_ht_cents 1481 → 1482`. `…/2026-10-18T00-11-22-121Z-lot2-2-7-negative-control` |
| `npm run engine:v3:parity` | `e9855ed1` | sortie 0 en 25 s : 10 357 cas (graine 20261017), **0 différence** entre le moteur TypeScript et `private.estimate_v3_compute`. `.e2e/engine-v3/parity/2026-10-18T00-11-42-336Z-seed-20261017` |

Les exécutions à `1d43528b` des empreintes, de la montée de version (et de son contrôle négatif) et de la
parité, toutes vertes, ne sont pas retenues : l'arbre a changé depuis. Deux exécutions ont été interrompues par
l'intégrateur et ne prouvent rien : `emission-v3` à `1d43528b` (au stade pgTAP, pour détacher la chaîne du délai
de l'outil ; sa pile orpheline `b977f6a8…` a été arrêtée puis détruite par `supabase stop` et
`supabase stack destroy` sur son seul répertoire de travail) et la campagne complète à `1d43528b` (après le
diagnostic d'OF00, nettoyée par le lanceur).

Windows, worktree `miaouffrage-l2-27` :

| Commande | Arbre | Résultat |
|---|---|---|
| `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` | `8a2c4b9e` | « 250 files, 250 unique versions » ; passé |
| `npx vitest run <24 fichiers>` : tests des modules touchés (portail, document, envoi, exports, sceau, contrats 1 et 2, PDF, publication, conditions, moteur de règles, serveur), `army-impact-map`, `ci-guardrails`, `engine-frozen-corpus` | `8a2c4b9e` | `Test Files 24 passed (24)`, `Tests 773 passed (773)` |
| `npx vitest run --project=node` des trois fichiers 2.7 ; `pdf-terms-server.test.ts` | `1d43528b` | 291 / 291 (177 + 104 + 10), aucun ignoré ; 81 / 81 |
| `npx eslint --max-warnings=0 <45 fichiers TS/TSX touchés depuis origin/main>` ; `node scripts/typecheck.mjs` | `8a2c4b9e` | sortie 0 ; sortie 0 (relancés sur les fichiers de chaque commit d'intégration) |
| `npm run verify:pr` | `e9855ed1` | `audit:dependencies` passé (0 avis bloquant) ; `audit:signatures` en échec d'environnement : le cache npm partagé du poste référence des contenus absents (`ENOENT` sous `npm-cache/_cacache`, deux fois) ; passé avec un cache isolé (`npm audit signatures --cache <dossier temporaire>` : 593 signatures et 158 attestations vérifiées) |
| suite de `check:quality` relancée telle quelle : `check:architecture`, `validate-openapi`, `typecheck`, `lint`, `test:ci:node`, `test:ci:jsdom`, `test:critical-coverage` | `e9855ed1` | sortie 0 en 116 s : 1 135 modules, 0 cycle ; « spec valide et synchronisée » (144 routes, 192 opérations) ; Node `299 passed / 1 skipped` fichiers, `3136 passed / 3 skipped` tests ; jsdom 164 / 823 ; couverture critique 3 / 12 |
| `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | final | vide |
| `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` | final | sortie 0 |

Les trois tests Vitest du 2.7 et la suite pgTAP `estimate-offer-contract-v2.test.sql` sont inchangés depuis leur
rouge, hors une ligne de commentaire par fichier Vitest pointant vers le §11 (`e9855ed1`) ; les parcours V3M01 et
V3M02 n'ont reçu que le renommage V3M et la sonde d'hydratation du §9.3, sans aucune ligne `expect` modifiée.

### 10.6 Limites et suites

- **Revue indépendante non faite.** AGENTS.md exige une revue en lecture seule, par un relecteur indépendant, d'un
  changement de cette taille (migration, contrat, sceau, émission, harnais) ; l'intégrateur n'a pas d'agent
  relecteur. Le rapprochement du §10.1 et les changements des §10.3 et §10.4 ne sont relus que par leur auteur :
  à faire avant la PR, sur ce diff stable. Faite ensuite par deux relecteurs : constats et corrections au §12.
- **Fusion du 2.6** (`lot2/2.6-editeur-v3` à `ae9b375d`, essai `git merge-tree`) : conflits dans
  `scripts/tester-army/army-impact-map.json`, `src/app/dashboard/estimates/[versionId]/print/page.tsx` et
  `supabase/migrations.manifest.json` ; `engine-v3-fail-closed.e2e.ts` fusionne sans conflit (2.6 réécrit V3FC01,
  le 2.7 V3FC02). L'impression d'une v3 émise doit rester `EstimateV3PrintPage` (§9.5). La migration du 2.6
  `20261017205000_estimate_engine_v3_line_repricing.sql` (déclencheur `ac_provision_estimate_item_v3_repriced_pu`,
  objets disjoints de M5) est antérieure à M5 : si le 2.7 arrive le premier sur `main`, le 2.6 la réhorodate
  (`supabase:migrations:restamp`). Après la fusion : `db:ci:local`, V3M01, V3M02, V3FC et la campagne complète.
- `audit:signatures` dépend d'un cache npm local réparable par son propriétaire (`npm cache verify`) ; le cache
  partagé n'a pas été modifié.
- Restent fermés à la v3 par leur nom (§9.1) : l'export `bdc` et l'export de l'éditeur ; la fiche d'une v3 garde
  le bandeau de 2.1 jusqu'au 2.6.
- Le Supabase partagé n'est pas touché ; M5 n'y est pas appliquée (opération distante à autoriser à part).
  Rien n'est poussé, aucune PR n'est ouverte.

## 11. Tests isolés TypeScript (Vitest)

Ancien `estimate-engine-v3-2.7-vitest.md`, fondu ici à l'intégration (18/10/2026) sans changer son contenu : rouge
écrit **avant tout code de production** le 17/10/2026, base `c14b243d` (pointe de 2.5) ; sources de la
conception : F1 à F3, D7, D8, D14, D15, §4, §5, §8.1, §8.2, §14 « 2.7 ». Là où il **choisit** (« Choix »), il fixe
le contrat que le rouge exige ; ailleurs, la conception fait foi. Les commentaires des tests et des modules
renvoient à cette section (§11.4 pour les tests réalignés).

### 11.1 Justification de l'isolation

Le parcours `engine-v3-emission.e2e.ts` prouve l'émission de bout en bout sur S2 et S5 (texte du PDF, sceau,
portail, exports). Il ne peut pas :

- fabriquer une copie commerciale v3 altérée d'un centime, d'une clé ou d'un type : l'application n'écrit que
  des copies cohérentes, seul le parseur strict les refuse avant le sceau ;
- énumérer chaque champ de la charge 6 : un champ oublié rend un devis émis modifiable sans que son sceau change ;
- rejouer 3 600 charges historiques (600 devis du corpus figé × charges 1 à 4) pour prouver qu'aucun octet ne
  bouge, ce dont dépend la vérification des documents déjà émis ;
- prouver que le tableau de TVA imprimé vient du contexte figé et non d'un recalcul, ni qu'un gel incohérent
  est refusé au lieu d'être imprimé.

### 11.2 Fichiers

| Fichier | Cible (absente ou incomplète à `c14b243d`) |
|---|---|
| `src/lib/estimates/offer-contract-v2.test.ts` | `offer-contract-v2.ts` (nouveau), `parseOfferDocumentProof` (`offer-contract.ts`) |
| `src/lib/estimates/estimate-seal.v3.test.ts` | `estimate-seal.ts` (charge 6), `offer-contract-v2.ts` (sceau d'offre au marqueur 5) |
| `src/lib/estimates/prepare-estimate-document-data.v3.test.ts` | branche v3 de `prepareEstimateDocumentData` |

Les modules absents sont chargés par une variable (`import(/* @vite-ignore */ MODULE)`) et leurs types sont
recopiés dans le test : le build de production, qui vérifie aussi les tests, reste vert, et chaque cas échoue
seul (`beforeEach`, jamais « ignoré ») sur le contrat absent. L'implémentation remplace les copies de types par
les imports réels.

### 11.3 Défaillances visées

| Id | Défaillance | Cas |
|---|---|---|
| F27-V01 | Copie valide refusée, réparée ou mutée | S1 à S5, autoliquidation, parts FO/MO, T-HALF3, ½↑ de TVA, Q = 0, CAP, remise de 100 % : rendu égal, copie neuve, entrée intacte |
| F27-V02 | Clé absente tolérée | 36 chemins, `rateBp` d'un taux de remise, part MO sans part FO |
| F27-V03 | Clé en trop tolérée (contrat 1, donnée privée, champ inventé) | 25 chemins (`totals.saleHtCents`, `rows.n.unit`, `h_mo_per_unit`, `costSubtotalCents`, `discountIntent.requestedCents`…) |
| F27-V04 | Type ou domaine faux accepté | 55 valeurs (dont moteur ≠ 3, quantité à 4 décimales, unité hors format, statut inconnu) et 4 taux de remise (0, 10 001, 1,5, chaîne) |
| F27-V05 | Σ lignes ≠ brut, sous-total de section faux, FO + MO ≠ brut, dépassement int32 | chaque altération d'1 c isolée par l'oracle du test (le reste du pied réaligné) |
| F27-V06 | PT ≠ ⌈Q × PU⌋ (A4), y compris T-HALF3 calculé en flottant (100 c au lieu de 101) ; ligne non chiffrée avec un montant ou un PU ; ligne chiffrée sans PU ni unité | |
| F27-V07 | net ≠ brut − remise − arrondi ; remise contraire à l'intention (aucune, taux ⌈G × bp⌋, montant ≤ G) | |
| F27-V08 | TVA : Σ par taux ≠ TVA, ⌈base × taux⌋ faux (troncature, arrondi au pair), TTC ≠ net + TVA, Σ bases ≠ net, base d'un taux > brut chiffré du taux, taux ≠ taux des lignes chiffrées (manquant, en trop, doublé, non trié, taux d'une ligne non chiffrée), TVA en autoliquidation, indicateur contraire au rôle | |
| F27-V09 | Arbre et JSON : doublon, orphelin, parent ligne, profondeur, cycle, tableau creux, accesseur, prototype hérité, entrée hostile dont la valeur serait recopiée dans le message | |
| F27-V10 | Appariement : le parseur 2 accepte un contrat 1, ou le parseur 1 un contrat 2 | |
| F27-V11 | Preuve au marqueur de contrat 2 refusée | `clientContractVersion: 2` |
| F27-V12 | Appariement croisé ou ancre fausse accepté au marqueur 2 | contrat 1 sous marqueur 2, contrat 2 sous marqueur 1, copie altérée, version, révision, auteur, mode de prix, `legacy` |
| F27-S01 | Une v3 n'est pas scellée en charge 6, ou la v2 change de charge par défaut | |
| F27-S02 | Clé de la charge 6 absente ou en trop | 31 clés de version, 39 clés de ligne (sections comprises) |
| F27-S03 | Un champ v3 (ou de charge 4) ne change pas l'empreinte | 44 mutations de version (contexte figé compris), 39 de ligne, 3 de section |
| F27-S04 | Empreinte instable (ordre des lignes, ordre des clés, horodatages, `seal_hash`) | |
| F27-S05 | v3 scellée par une charge 1 à 5 ou inconnue ; v1/v2 scellée par la charge 6 | |
| F27-S06 | Un octet change dans les charges 1 à 4 | 7 variantes × 600 devis du corpus figé, empreintes relevées sur `c14b243d` |
| F27-S07 | L'enveloppe du marqueur 5 du contrat 1 change, ou accepte un contrat 2 | empreinte relevée sur `c14b243d` |
| F27-S08 | Enveloppe v3 fausse : autre marqueur, calcul hors charge 6, copie non liée | enveloppe exacte, chaîne charge 6 → sceau, liaison titre/unité/PDF, refus croisés |
| F27-D01 | PT imprimé ≠ ⌈Q × PU⌋, PU ou parts FO/MO lus ailleurs que sur le brut figé | 7 lignes chiffrées ; O1 166,63 € / 3 332,60 € ; O4 13,53 € / 15 410,67 € |
| F27-D02 | Unité non issue du référentiel (« m² » pour `m2`) ; ligne non chiffrée avec PU ou montant | |
| F27-D03 | Σ sous-totaux de premier niveau + lignes racine ≠ brut ; sections en net | A 5 554,61 € ; B 62 908,91 € ; O7 591,04 € ; Σ 69 054,56 € |
| F27-D04 | Pied S2/S5 faux ; récapitulatif ≠ contexte figé | S2 : remise 1,01 €, net 69 053,55 €, TVA 13 810,71 € ; S5 : 555,45 € + 12 699,80 €, TTC 82 308,80 € |
| F27-D05 | Intention de remise ou arrondi mal lus ; autoliquidation avec TVA | S1, S3, S4, sous-traitance |
| F27-D06 | Gel incohérent imprimé ou recalculé | TVA du contexte +1 c ; PU +1 c ; contexte absent ; brut de ligne +1 c, Σ cohérente |

### 11.4 Contrat attendu

#### `src/lib/estimates/offer-contract-v2.ts` (nouveau)

```ts
export type CommercialRow2 =
  | { kind: "section"; id; parentId; position; depth; number; title; saleHtCents; foSaleHtCents?; moSaleHtCents? }
  | { kind: "line"; id; parentId; position; depth; title; quantity; unitCode: string | null; unitLabel: string | null;
      pricingStatus: EstimateV3PricingStatus; taxRateBp; unitSaleHtCents: number | null; saleHtCents;
      foSaleHtCents?; moSaleHtCents? };
export type ClientContract2 = {
  schemaVersion: 2;
  version: ClientContract1["version"] & { calcEngineVersion: 3 };
  project: ClientContract1["project"]; issuer: ClientContract1["issuer"]; company: ClientContract1["company"];
  rows: CommercialRow2[];
  totals: { grossHtCents; commercialDiscountCents; discountIntent: { kind: "none" | "amount" } | { kind: "rate"; rateBp };
    commercialRoundingCents; netHtCents; taxByRate: Array<{ rateBp; baseHtCents; taxCents }>; taxCents;
    payableTtcCents; reverseCharge: boolean };
  exclusions: string | null;
};
export function parseClientContract2Snapshot(value: unknown): ClientContract2;   // OFFER_CLIENT_CONTRACT_INVALID
export function computeOfferSealHashV2(input: { calculationHash: string; snapshot: unknown; documentProof: unknown },
  options?: OfferProofParseOptions): string;                                       // OFFER_SEAL_INPUT_INVALID
```

Erreurs : `OfferContractError` de `offer-contract.ts` (même classe, mêmes codes, message sans valeur d'entrée).
Blocs `project`, `issuer`, `company` et validateurs de `version` : ceux du contrat 1 (D14).

Invariants (tous refusés au centime) : Σ bruts des lignes = `grossHtCents` (aucune exception de moteur) ;
section = Σ de ses lignes descendantes (brut, FO, MO) ; FO + MO = brut sur chaque ligne, parts uniformes ;
ligne `priced` : `unitCode` et `unitLabel` non nuls, `unitSaleHtCents` entier, `saleHtCents` = ⌈Q × PU⌋ en
décimal exact ; ligne non chiffrée : PU nul, brut, FO et MO à 0 ; `unitCode` nul ⇔ `unitLabel` nul ;
net = brut − remise − arrondi ≥ 0 ; `none` ⇒ remise 0, `rate` ⇒ remise = min(⌈G × bp / 10 000⌋, G) avec
bp ∈ [1 ; 10 000], `amount` ⇒ 0 ≤ remise ≤ G ; `taxByRate` strictement croissant, taux = taux distincts des
lignes `priced`, Σ bases = net, base d'un taux ≤ Σ bruts des lignes chiffrées de ce taux, TVA du taux =
⌈base × taux / 10 000⌋ (0 en autoliquidation) ; `taxCents` = Σ ; TTC = net + TVA ; `reverseCharge` ⇔
`contractorRole = "subcontractor"`.

**Choix** : clés de premier niveau identiques au contrat 1 (`rows`, `exclusions`) ; `quantity` nombre de 0 à
999 999 999,999 avec au plus 3 décimales (`numeric(12,3)`) ; `unitCode` au format du référentiel
(`^[a-z][a-z0-9]*$`, 16 caractères au plus), sans consultation du référentiel vivant ; `unitLabel` texte libre
(le préparateur y met le symbole) ; aucune clé `requestedCents` ni `rateBp` hors intention `rate`.

`computeOfferSealHashV2` : SHA-256 du JSON canonique (clés triées) de
`{ meta: { payloadVersion: 5, versionId, tenantId, projectId, contentRevision, calcEngineVersion: 3 },
calculation: { payloadVersion: 6, sha256 }, clientContract, document: { sha256Hash, layoutOptions, termsSnapshot } }`,
copie égale à celle de la preuve, preuve au marqueur 2.

#### `src/lib/estimates/offer-contract.ts`

`parseOfferDocumentProof` accepte `clientContractVersion: 2` avec une copie analysée par
`parseClientContract2Snapshot`, mêmes ancres et mêmes règles qu'au marqueur 1 (publication non `legacy`,
chemin canonique, version, entreprise, affaire, révision, auteur = `issuer.userId`, envoi ⇔ `publishedDispatchId`,
`fo_mo_and_total` ⇔ parts FO/MO). Contrat 1 sous marqueur 2 et contrat 2 sous marqueur 1 : refusés.
`parseClientContractSnapshot` et `computeOfferSealHash` (contrat 1) ne changent pas.

#### `src/lib/estimates/estimate-seal.ts`

- `export const ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION = 6` ; `CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION` reste 4.
- v3 sans option ou avec `payloadVersion: 6` → charge 6 ; v3 avec 1 à 4 → `ESTIMATE_ENGINE_UNAVAILABLE` (2.1,
  conservé) ; v3 avec 5 ou une valeur inconnue, et v1/v2 avec 6 → erreur de code
  `ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED`.
- Charge 6 = clés de la charge 4, `discount_amount_cents` et `contractor_role` **toujours présents**, plus
  `sale_coefficient_fo`, `sale_coefficient_mo`, `gross_ht_cents`, `discount_applied_cents`,
  `commercial_rounding_cents`, `tax_breakdown` (= `calc_snapshot_context.tax_breakdown`, **choix**) ; lignes et
  sections : clés de la charge 4 plus `unit_code`, `pricing_status`, `h_mo_per_unit`, `h_mo_atelier_per_unit`,
  `h_mo_chantier_per_unit`, `snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents` (nulles sur une section).
- Charges 1 à 4 : octet pour octet (empreintes figées du test).

#### `prepareEstimateDocumentData` (branche v3)

Entrée `{ calcEngineVersion: 3, items, version, currency, validiteJours, portalUrl?, maxVisibleSectionLevel?,
layout? }`, où `version` porte les colonnes de `StoredEstimateV3Version` (brut, remise et arrondi appliqués,
totaux, rôle d'entreprise, `calc_snapshot_context`) et l'intention (`discount_bp`, `discount_amount_cents`).
Aucun `breakdown` : le document relit le gel (`readStoredEstimateV3`) et refuse toute incohérence par
`EstimateV3Error` `ESTIMATE_V3_STORED_INCOHERENT`, y compris PT ≠ ⌈Q × PU⌋ sur une ligne chiffrée. Sortie :
`EstimateDocumentPreparedData` (lignes et sections **en brut** : `lineUnitPriceHtById` = PU publié,
`lineSplitsById` = brut et parts FO/MO brutes, `sectionTotalsById` = Σ bruts ; `taxEnabled` = hors
autoliquidation) plus `v3: { linesById: Record<id, { unitCode, unitLabel, pricingStatus, taxRateBp,
unitSaleHtCents, saleHtCents, foSaleHtCents, moSaleHtCents }>, totals: { grossHtCents, discount: { kind, rateBp,
appliedCents }, commercialRoundingCents, netHtCents, taxByRate, taxCents, payableTtcCents, reverseCharge } }`.
`unitLabel` = symbole de `MEASUREMENT_UNITS` ; intention lue sur `calc_snapshot_context.discount` ;
`taxByRate` = `calc_snapshot_context.tax_breakdown`, renommé, jamais recalculé.

#### Tests existants à réaligner à l'implémentation

Ils figent le refus de 2.1, que 2.7 lève volontairement : `estimate-seal.test.ts` (« refuses to seal a v3 until
the v3 seal payload exists » : sans option, une v3 donne désormais la charge 6 ; le refus en charge 4 reste),
`pdf-generator.test.ts:1035-1040` et `send-estimate.test.ts:269-273` (`ESTIMATE_ENGINE_UNAVAILABLE` sur une v3).

### 11.5 Valeurs figées (`c14b243d`)

| Variante | SHA-256 des 600 lignes `<cas>:<sha de la charge>` |
|---|---|
| charge 1 sans moteur | `82c18e5dfcdf71a1d01320973a649c8e94a74036109084b4edae0e6f9ed624b3` |
| charge 1 sans moteur ni ventilation | `3fd2804dc41b3be8e9d5f344494938421dc74ff057cfed89f52275ec0f590695` |
| charge 1 avec moteur | `ccb1056c3719bf849f3495d3e37cad674d48ceff52912061b969558c9f7e0495` |
| charge 2 | `6c2384d83daa5230d9280b72f9062225ed18d0c54a99d4848ffeb1c35cab1d16` |
| charge 3 | `bd8339b1da8a0ab96acc23de05f4079aafacf977739b8b91c5e71f511835491e` |
| charge 4 | `60d36fb8eceb95983050fef5e4de62fcea7857d7b84c9c00e7bc1414224c037b` |
| par défaut (v1 → 2, v2 → 4) | `d8a3de5c8c998e4d773e8e3065f2833ce5f89df07940da10d710f7ae91bbfa88` |
| marqueur 5, contrat 1 du test | `2b4ae8ab17ef9cd78af29293e61bff0875109d2751998365b03980e23c8a107e` |

Chaque variante produit 600 charges distinctes (harnais non dégénéré). Ces cas sont verts par construction :
ils ne doivent jamais être régénérés pour absorber un changement.

### 11.6 Preuve rouge (17/10/2026)

Windows, worktree `miaouffrage-l2-27`, base `c14b243d`, seuls changements locaux : les trois tests et l'ancien `estimate-engine-v3-2.7-vitest.md`.

```bash
npx vitest run --project=node src/lib/estimates/offer-contract-v2.test.ts \
  src/lib/estimates/estimate-seal.v3.test.ts src/lib/estimates/prepare-estimate-document-data.v3.test.ts
```

Sortie 1 : `Test Files 3 failed (3)`, `Tests 279 failed | 12 passed (291)`, aucun cas ignoré.

| Fichier | Résultat | Motif |
|---|---|---|
| `offer-contract-v2.test.ts` | 176 rouges / 177 | 175 : `MISSING_PRECONDITION: src/lib/estimates/offer-contract-v2.ts absent` ; F27-V11 : `OfferContractError: Invalid offer contract at documentProof.clientContractVersion.` (marqueur 2 refusé) |
| `estimate-seal.v3.test.ts` | 93 rouges / 104 | F27-S01 : `expected undefined to be 6` (constante absente) ; F27-S02 à S04 et S08 (chaîne) : `EstimateEngineUnavailableError` levée par `resolveCalcEngineVersion` dans `buildCanonicalEstimateSealPayload` ; F27-S05 (5, 7) : `ESTIMATE_ENGINE_UNAVAILABLE` au lieu de `ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED` ; F27-S05 (v1/v2 en charge 6) : `expected undefined to match object { code: "ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED" }` (charge construite en silence) ; F27-S08 : `MISSING_PRECONDITION` |
| `prepare-estimate-document-data.v3.test.ts` | 10 rouges / 10 | `TypeError: Cannot read properties of undefined (reading 'totals')` (`prepare-estimate-document-data.ts:461`, aucune branche v3 : le préparateur lit le `breakdown` v1/v2) ; F27-D06 : même erreur au lieu d'`EstimateV3Error` |

Verts (gardes, vrais avant et après 2.7) : F27-S05 (v3 en charges 1 à 4), F27-S06 (8 cas), F27-S07 (2 cas),
F27-V12. `npm run typecheck` : sortie 0 ; `npx eslint --max-warnings=0` sur les trois tests : sortie 0. Voisins
inchangés et verts : `ci-guardrails`, `army-impact-map`, `estimate-seal`, `offer-contract`,
`engine-frozen-corpus` (5 fichiers, 187 tests).

Au vert attendu : les trois fichiers entièrement verts sans modifier les attendus ni les empreintes, après
`offer-contract-v2.ts`, la charge 6 et la branche v3 du préparateur, et les trois tests de 2.1 du §11.4 réalignés.

### 11.7 Vert (18/10/2026, piste TypeScript)

Windows, worktree `miaouffrage-l2-27`, base `f8cc1dc8` (M5 et sa documentation, piste SQL) ; implémentation
`71d04e03`, renommage des parcours `f2b70f87`. Les trois fichiers sont inchangés : aucun attendu, aucune
empreinte ni aucune copie de type n'a été modifié (les modules sont toujours chargés par une variable).

```bash
npx vitest run --project=node src/lib/estimates/offer-contract-v2.test.ts \
  src/lib/estimates/estimate-seal.v3.test.ts src/lib/estimates/prepare-estimate-document-data.v3.test.ts
```

Sortie 0 : `Test Files 3 passed (3)`, `Tests 291 passed (291)` (177 + 104 + 10), aucun cas ignoré ; F27-S06 et
F27-S07 rendent les empreintes figées sur `c14b243d`.

#### Modules

| Module | Rôle |
|---|---|
| `offer-contract-core.ts` (nouveau) | primitives strictes déplacées telles quelles d'`offer-contract.ts` (`object`, `text`, `cents`, `uuid`, `date`, `instant`, adresse, mise en page, conditions, `run`, `canonicalJson`, `OfferContractError`), communes aux deux contrats sans cycle d'exécution |
| `offer-contract-v2-parser.ts` (nouveau) | analyse stricte de `ClientContract2` (clés exactes, domaines, arbre, PT = ⌈Q × PU⌋ en décimal exact, pied, TVA par taux) ; module bas, lu par `offer-contract.ts` |
| `offer-contract-v2.ts` (nouveau) | interface publique : types, `parseClientContract2Snapshot`, `buildClientContract2` (copie construite depuis le document relu), `computeOfferSealHashV2` (marqueur 5, charge 6) |
| `offer-contract.ts` | primitives importées du cœur ; la preuve accepte le marqueur 2 avec le contrat 2 seulement (et inversement), mêmes ancres ; la présentation aiguille sur `schemaVersion` ; `parseClientContractSnapshot` et `computeOfferSealHash` inchangés |
| `estimate-seal.ts` | `ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION = 6`, constructeur séparé de la charge 6 (ordre des clés fixe, JSON imbriqué trié) ; `ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED` (v3 hors 6, v1/v2 hors 1 à 4) ; charges 1 à 4 inchangées |
| `prepare-estimate-document-data.ts` | `prepareEstimateV3DocumentData` (entrée typée) ; `prepareEstimateDocumentData` aiguille une entrée v3 à l'exécution, sa signature v1/v2 reste celle des goldens |

#### Tests réalignés (refus de 2.1 levé volontairement)

| Test | Avant | Après |
|---|---|---|
| `estimate-seal.test.ts` | v3 sans option : `ESTIMATE_ENGINE_UNAVAILABLE` | v3 sans option : charge 6 ; charge 4 toujours refusée par son nom |
| `pdf-generator.test.ts` (F-TS-04) | v3 refusée avant réclamation, gel, rendu, dépôt | moteur hors domaine (4) refusé (`ESTIMATE_CALC_ENGINE_UNSUPPORTED`) avant tout effet ; la v3 est émise (V3M01, V3M02) |
| `send-estimate.test.ts` (F-TS-05) | v3 refusée avant configuration et réservation | moteur hors domaine (4) refusé avant tout effet ; la v3 s'envoie (V3M01) |
| `server.seal.test.ts` (deux `toEqual`) | `{ valid, computed_hash, stored_hash }` | plus `seal_payload_version`, `client_contract_version`, `calc_payload_version` (« Choix » du §5.2) |

#### Garde des conditions bac à sable (`pdf-terms-server.test.ts`)

Défaillance que le parcours ne peut pas produire (un marqueur d'hébergement, ou une pile sur 45585 interdite à
la campagne) : écrit rouge avant l'extension (`7154c1ce` : `Tests 1 failed | 80 passed (81)`, le cas d'admission),
vert après (`Tests 81 passed (81)`). Le profil admis est le build de production de la pile possédée calc-v3
(`E2E_ARMY_SUITE=calc-v3`, `E2E_OFFER_SERVER_MODE=production`, `E2E_OFFER_SANDBOX_TERMS=1`, garde serveur
d'offre, backend `http://127.0.0.1:<port>` hors 45585/33485 égal à `E2E_OFFER_BACKEND_ORIGIN`, application en
boucle locale sur un autre port) ; tout marqueur d'hébergement, tout autre profil, la pile des développeurs et
un environnement de test sont refusés ; le cas `offer` sur 45585 est inchangé. La phase `emission-v3` reste
servie en `next dev` : son passage au build possédé est une évolution du harnais, hors de ce sous-lot.

#### Contrôles (Windows, arbre final `dad77e83`, aucun changement local hors documentation)

| Commande | Résultat |
|---|---|
| `npx vitest run --project=node` | `Test Files 298 passed / 1 skipped`, `Tests 3111 passed / 3 skipped` (dont `engine-frozen-corpus`, seal, offre, PDF, document, exports, goldens) ; 2 exécutions sur 7 ont signalé un « Worker exited unexpectedly » de Vitest sans aucun test en échec (poste chargé par les piles natives d'autres sessions), puis 3 exécutions consécutives au rapporteur JSON sans erreur (299 fichiers, 0 suite en échec) |
| `npx vitest run --project=jsdom` | `Test Files 162 passed`, `Tests 821 passed` |
| `npm run test:critical-coverage` | `3 passed`, `12 passed` |
| `node scripts/typecheck.mjs` | sortie 0 |
| `npx eslint --max-warnings=0 <fichiers touchés>` | sortie 0 |
| `npm run validate-openapi` | « spec valide et synchronisée » (144 routes, 192 opérations) |
| `npm run check:architecture` | passé (1 133 modules, 0 cycle) ; `pdf-generator.tsx` 2 220 / 2 300 lignes non vides |
| `git diff --stat -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | vide |

### 11.8 Mesures à l'intégration

Sur la tête fusionnée, sans modification des attendus, des empreintes ni des copies de type des trois fichiers :
291 tests sur 291 (`1d43528b`), puis la suite Node complète de `check:quality` à `e9855ed1` (299 fichiers,
3 136 tests, 3 ignorés hors 2.7) ; `pdf-terms-server.test.ts` 81 sur 81 ; empreintes figées F27-S06 et F27-S07
égales à celles de `c14b243d`. Détail au §10.5.

## 12. Revue 2.7 (18/10/2026) : corrections et qualification complète

Deux revues indépendantes en lecture seule ont relu le diff intégré (`94fcc5dd`). Chaque constat a été revérifié
dans le code avant correction ; chaque défaut de comportement a reçu son test rouge d'abord. `main` (`89627add`,
correctif d'import CSV fournisseur, aucun fichier du 2.7) a été fusionné avant les corrections (`4e99e5ef`) ;
M5 reste après toute migration de `main`, sans réhorodatage à cette fusion. Aucune assertion d'un test d'exigence n'est
modifiée ; V3FC02 (réaligné au §10.3) est étendu.

Commits : `4e99e5ef` (fusion), `f563cc1c` (tests rouges), `3f390d8e` (garde des conditions), `329a46c2` (sonde
V3FC02), `5e750c37` (aperçu d'une v3 sans unité), `fdddc458` (commentaires), `5f0fecd3` (brouillon de V3M03),
puis ce document et la conception (documentation seule).

### 12.1 Constats et suites

| Constat (revue) | Vérification | Suite |
|---|---|---|
| Aperçu d'impression et exports XLSX/DPGF d'un brouillon v3 dont une ligne chiffrée n'a pas d'unité : `ESTIMATE_V3_STORED_INCOHERENT` levé au rendu (majeur) | confirmé | V3FC02 étendu, rouge (`…/2026-10-18T01-21-08-114Z-critical` : impression sur la limite d'erreur « Ce chiffrage n’a pas pu être chargé », exports `500 INTERNAL_ERROR`) ; `5e750c37` : `loadEstimateV3DocumentSource` applique le refus nommé du gel, `400 ESTIMATE_V3_UNIT_REQUIRED` ; l'impression l'affiche, les exports le rendent |
| Garde des conditions bac à sable étendu sans preuve de pile possédée (mineur) | confirmé : tout backend `127.0.0.1` hors 45585/33485 admis, 54321 compris | 13 cas ajoutés à `pdf-terms-server.test.ts`, rouges (13 en échec sur 94), puis `3f390d8e` : marqueur `E2E_CALC_V3_OWNED_STACK=1` transmis à l'application par `calc-v3.config.ts` et répertoire `<racine>/.e2e/army/offer/runs/<horodatage>-calc-v3-<uuid>` exigés ; 94/94. Cas `offer` sur 45585 inchangé |
| Exports de l'éditeur et BDC fermés à la v3 sans décision consignée (mineur) | confirmé | écart consigné dans la conception (§8.2, §14 « 2.7 », point **P-20**) : éditeur avec 2.6 (seul chemin qui l'atteint), BDC avant 2.10 ; **décision du porteur requise**. Refus nommé `ESTIMATE_ENGINE_UNAVAILABLE` d'ici là |
| Moitié « envoi » de V3FC02 sans lien avec le moteur 3 (deux revues) | confirmé : `getRequiredEnvVar("RESEND_API_KEY")` refuse avant toute étape du moteur | V3FC02 la décrit comme un contrôle de configuration ; V3M04 (nouveau, phase `emission-v3`, collecteur) prouve le refus nommé avec un fournisseur : `400 ESTIMATE_V3_UNIT_REQUIRED`, ni document (`404 PDF_NOT_READY`), ni reçu, ni changement de statut, de `updated_at` ou de révision |
| Commentaires et message obsolètes (deux revues) | confirmé | `fdddc458` (et en-tête des V3M dans `f563cc1c`) ; §7 et §9.4 de ce document corrigés |
| Aucune qualification complète sur l'arbre 2.7 (majeur) | confirmé (sélecteur d'impact : `full`) | §12.3 : `e2e:army:local` non filtré et `e2e:army:ci -- full` verts sur l'arbre final |
| `e4fc30cf` sans régression exécutée depuis `next start` (majeur) | confirmé : sans overlay, V3M01 ne lisait rien d'assertable | V3M-09 : V3M01 relit `GET …/approval` de S2 et S5 émis (`200`, `not_required`) ; rouge sans `e4fc30cf` (`…/2026-10-18T01-22-22-198Z-calc-v3` : `403 READ_ONLY`), vert ensuite. La fiche d'une v3 garde le bandeau de 2.1 jusqu'au 2.6 : la route est celle que lisent la fiche et l'affaire |
| `3a8e576a` sans test rouge (mineur) | confirmé | V3M02 ajoute une v3 sans ligne chiffrée (une ligne « included ») : en-tête « Validité : 30 jours — TVA : 20 % » ; rouge sans `3a8e576a` (`…/2026-10-18T01-17-41-514Z-critical` : « TVA : » vide), vert ensuite |
| Chemin approbation → émission d'une v3 non prouvé (mineur) | confirmé : aucun parcours n'approuvait puis n'émettait une v3 | V3M03 (nouveau) : affaire de la fixture à règle propre (5 000 € HT, portée « client ») et brouillon v3 vide semé ; S2 rempli par l'API, approbation requise, soumission (`201`), décision « approved » (`200`) ; gel du document, PDF et envoi : `approved` et la révision survivent, sceau marqueur 5, contrat 2, charge 6, texte du PDF au §5. Vert au premier passage (`…/2026-10-18T01-26-43-060Z-calc-v3`). Le commentaire de la fixture est corrigé |

Sondes corrigées, sans assertion modifiée : la sonde d'impression de V3FC02 attendait la limite d'erreur du
tableau de bord au lieu de celle des chiffrages (`329a46c2`) ; V3M03 ne pouvait pas créer sa v3 dans l'affaire
de la fixture, le garde de navigateur des offres n'admettant une nouvelle version que dans une nouvelle affaire
(`5f0fecd3` : brouillon semé par la fixture, comme pour la phase `offers`).

### 12.2 Preuves rouges (WSL, clone `~/miaouffrage-lot2-27`)

| Commande | Arbre | Résultat |
|---|---|---|
| `npm run e2e:army:local -- --grep "V3FC02\|V3M02" --app-port 3227` | `f563cc1c` + `3a8e576a` défait localement (1 fichier) | sortie 1 : V3M02 rouge (`versionRate: false`, extrait « Validité : 30 jours — TVA : CLIENT… ») ; V3FC02 rouge sur la sonde du §12.1. `.e2e/army/ci/2026-10-18T01-17-41-514Z-critical` |
| `npm run e2e:army:local -- --grep "V3FC02" --app-port 3227` | `329a46c2`, aucun changement local | sortie 1 : V3FC02 rouge, publication `400 ESTIMATE_V3_UNIT_REQUIRED`, impression sur la limite d'erreur, exports standard et DPGF `500 INTERNAL_ERROR` ; état inchangé (brouillon, 0 document, 0 envoi). `…/2026-10-18T01-21-08-114Z-critical` |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3127` | `329a46c2` + `e4fc30cf` défait localement (1 fichier) | sortie 1 : V3M01 rouge (`GET …/approval` de S2 émis : `403 READ_ONLY`), V3M04 vert, V3M03 non démarré (§12.1). `…/2026-10-18T01-22-22-198Z-calc-v3` |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --grep "^V3M03\s" --app-port 3127` | `5f0fecd3`, aucun changement local | sortie 0 : V3M03 vert. `…/2026-10-18T01-26-43-060Z-calc-v3` |
| `npx vitest run --project=node src/lib/estimates/pdf-terms-server.test.ts` (Windows) | `4e99e5ef` + cas ajoutés | 13 en échec, 81 réussis (94) |

### 12.3 Qualification de l'arbre final (`5f0fecd3`, aucun changement local)

WSL, Node 24.19.0, chaque exécution native après la garde de concurrence (au plus une autre exécution native
active au départ). Journaux : `~/miaouffrage-lot2-27/.e2e/lot2-2.7/fin-g-*.log`.

| Commande | Résultat |
|---|---|
| `npm run e2e:army:local -- --app-port 3227` (sélection critique locale non filtrée) | **sortie 0** en 429 s : pgTAP et matrice RLS passés, build possédé, 83/83 (V3FC01, V3FC02, V3M02, V3P01 compris). `.e2e/army/ci/2026-10-18T01-29-01-625Z-critical` (`manifest.json` `63e9c830…`) |
| `npm run e2e:army:calc-v3 -- --app-port 3127` (campagne complète) | **sortie 0** en 761 s, toutes phases en build de production : journeys 11, components 5, numeric 4, resume 5, access 2, offers 10, emission 6 (4 PDF reçus), emission-v3 4 (V3M01, V3M03, V3M04 ; 5 PDF reçus) ; sources inchangées. `…/2026-10-18T01-36-11-598Z-calc-v3` (`manifest.json` `9ec0cbc4…`) |
| `npm run e2e:army:ci -- full --app-port 3243` | **sortie 0** en 840 s : pgTAP et RLS passés, phase `full` 144/144, phase `development` 4/4. `…/2026-10-18T01-49-54-281Z-full` (`manifest.json` `d7803842…`) |
| `npm run engine:document-fingerprints -- check` | **sortie 0** en 48 s : familles v1/v2 identiques, agrégat `2b9715519d99…391b78e4` égal à la référence, aucune différence ni avertissement d'environnement. `.e2e/engine-v3/document-fingerprints/2026-10-18T02-15-41-713Z-check` |
| `npm run db:upgrade-check -- lot2-2-7` | **sortie 0** en 19 s : base ramenée aux 244 migrations de référence, 6 migrations postérieures appliquées (dont M7 et M5), 0 différence ; contrôle négatif détecté |
| `npm run db:upgrade-check -- lot2-2-7 --negative-control` | sortie 1 en 20 s, comme exigé : exactement 1 différence (`pu_ht_cents 1481 -> 1482`) |
| `npm run engine:v3:parity` | **sortie 0** en 28 s : 10 357 cas (graine 20261017), 0 différence TS/SQL. `.e2e/engine-v3/parity/2026-10-18T02-17-13-909Z-seed-20261017` |
| `npm run db:ci:local` | **sortie 0** en 29 s : `Files=21, Tests=1904`, `Result: PASS` (dont `estimate-offer-contract-v2`, 50 assertions inchangées), matrice RLS passée |

Valeurs de V3M01 (phase `emission-v3` de la campagne complète) : S2 et S5 envoyés, `/verify` `valid`, marqueur 5,
contrat 2, charge 6 ; texte des PDF reçus (S2 `cb7a02f1…`, S5 `55f655b0…`, une page chacun) : les 7 lignes
« Q unité PU PT » (O1 20 ml 166,63 / 3 332,60 ; O4 1 139 ml 13,53 / 15 410,67…), brut 69 054,56, « Remise
commerciale −1,01 € », « Total HT net 69 053,55 », TVA par taux (S2 : 20 % 69 053,55 / 13 810,71 ; S5 : 10 %
5 554,53 / 555,45 et 20 % 63 499,02 / 12 699,80), TTC 82 864,26 puis 82 308,80, tous vrais ; impression, XLSX et
DPGF identiques ; renvoi de S5 au même PDF et au même texte ; acceptation au portail `200 accepted`, même sceau ;
résumé d'approbation des versions émises `200 not_required`. Témoin v2 : envoyé avant les v3 (contrat 1,
charge 4, marqueur 5, `[2000, 400, 2400]`), revérifié après elles, même SHA-256 de PDF `75036194…4c25`.
V3M02 (campagne critique) : S2 puis S5 sur le même brouillon, deux générations au même texte, impression, XLSX
et DPGF aux mêmes valeurs ; v3 sans ligne chiffrée : « Validité : 30 jours — TVA : 20 % ».

Windows (`miaouffrage-l2-27`, `5f0fecd3`, changements locaux : documentation seule) :

- `npm run verify:pr` : `audit:dependencies` passé ; `audit:signatures` en échec sur le cache npm partagé corrompu
  (ENOENT, comme au §10.5), passé avec un cache privé (`npm audit signatures --cache <scratchpad>` : 593
  signatures, 158 attestations) ; le reste de `check:quality`, relancé tel quel : sortie 0 en 73 s
  (`check:architecture` 1 135 modules, 0 cycle ; OpenAPI valide et synchronisée, 144 routes, 192 opérations ;
  `typecheck` ; `lint` ; Node 299 fichiers passés / 1 ignoré, 3 149 tests passés / 3 ignorés ; jsdom 164 / 823 ;
  couverture critique 3 / 12).
- Vitest ciblé (fichiers touchés, voisins colocalisés, `army-impact-map`, `ci-guardrails`,
  `engine-frozen-corpus`, budgets, garde de migration) : 28 fichiers, 813 tests passés.
- `npm run supabase:validate` : 250 fichiers, 250 versions uniques ; `npm run supabase:migrations:git-guard --
  --mode pull_request --base 89627add…` : passé (2 changements cadrés, manifeste et M5).
- `git diff origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` : vide ;
  `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` : sortie 0.

### 12.4 Limites

État de la revue, avant la fusion du 2.6 ; l'état fusionné est au §13.

- **P-20 à arbitrer** : exports de l'éditeur et BDC d'une v3 restés fermés (refus nommé) ; la conception les
  propose pour 2.6 et avant 2.10. Sans décision, le 2.7 n'est pas conforme à son périmètre initial sur ce point.
  Depuis la fusion, l'éditeur d'une v3 ouvre Excel et DPGF ; seuls son export CSV et le BDC restent fermés (§13.2).
- Historique : la fiche d'une v3 (`[versionId]/page.tsx`) gardait le bandeau de 2.1, et V3M-09 prouvait la route
  qu'elle et l'affaire lisent, pas le panneau d'approbation. Depuis la fusion, la fiche d'une v3 est la vue de lecture
  du 2.6, avec PDF, sceau et actions de statut (§13.2).
- Historique : la fusion du 2.6 restait à faire (§10.6) et exigeait de rejouer `db:ci:local`, V3M01 à V3M04, V3FC et
  la campagne complète. Elle est faite le 18/10/2026 et rejouée aux §13.4 et §13.6.
- Le Supabase partagé n'est pas touché ; M5 n'y est pas appliquée.

## 13. Fusion du 2.6 (PR #44) et de la boucle Army (PR #43), 18/10/2026

`git merge --no-ff origin/main` (`488382d5` : 2.6 fusionné en `da462ac4`, boucle `e2e:army:dev-loop` de la PR #43)
sur `9ee5e240`, sans rebase ni poussée : fusion `2af3cb29`. Commits suivants : `8e33598b` et `ac19ec55` (rouges),
`7418afcb` (correction), `803b5ba9` (sonde), puis ce document (documentation seule). Revue de cette fusion,
rattrapage de `main` (`78533fe5`) et exports Excel et DPGF de l'éditeur v3 : §13.6.

### 13.1 Conflits et résolution

| Fichier | Résolution (intention des deux côtés) |
|---|---|
| `supabase/migrations.manifest.json` | les deux entrées ; `20261017205000_estimate_engine_v3_line_repricing.sql` (2.6) précède M5 (alors `20261017213500`), sans réhorodatage puisque 2.6 est arrivé le premier sur `main` |
| `scripts/tester-army/army-impact-map.json` | union : `engine-v3-editor-actions`, `engine-v3-editor` et `engine-v3-emission` dans la liste locale ; `engine-v3-editor` et `engine-v3-emission` dans le groupe `print` ; la note de la règle `estimate-print` nomme V3E01 et V3M02 |
| `print/page.tsx` | moteur inconnu : bandeau de 2.1 ; toute v3, brouillon ou émise : `EstimateV3PrintPage` (gel stocké ou aperçu du moteur pur, refus nommé d'un aperçu impossible, V3FC02). Le résumé de brouillon de 2.6 n'est plus servi par l'impression : 2.6 le donnait pour provisoire (« son document client arrive en 2.7 ») et il n'imprime ni les lignes brutes ni le pied qu'exige V3M02 (§9.5) ; il reste la vue de la fiche. Ses colonnes de sélection supplémentaires sont retirées avec lui. V3E01 (titre « Devis », aucun bandeau) passe sur le document v3 |

Fusionnés sans conflit et relus : `engine-v3-fail-closed.e2e.ts` (V3FC01 de 2.6, V3FC02 de 2.7), `scripts/run-tester-army-ci.ts`,
`src/lib/estimates/server.ts`.

### 13.2 Décisions de 2.6 rouvertes par 2.7

2.6 fermait sur une v3, « jusqu'en 2.7 », ce que 2.7 ouvre ; fusionnés, ces écrans restaient fermés ou faux.
Défaillances observables, écrites avant le code (`e2e/army/local/engine-v3-emission.e2e.ts`, V3M-12 à V3M-14) :

| Défaillance | Preuve |
|---|---|
| Fiche d'un brouillon v3 : « Préparer le PDF » désactivé, raison de 2.6 nommant le PDF (F26-30) | V3E11 réécrit (critique) : PDF actif, seul le modèle fermé, nouvelle raison, l'ancienne absente ; V3M05 |
| PDF préparé par la fenêtre de la fiche autre que le document client v3 (« 1 u 13,00 € 13,00 € », TVA 20 % 13,00 / 2,60, TTC 15,60) | V3M05 |
| Éditeur d'une v3 sans « Envoyer » (émission manuelle), ou émission qui ne scelle pas (marqueur 5, contrat 2, charge 6) | V3M05 |
| Fiche d'une v3 émise : « Non scellé » codé en dur, ni PDF original ni actions de statut ; acceptation par la fiche qui change le sceau | V3M05 |
| Carte de lecture v3 disant le document client et l'émission « pas encore disponibles », titre « Brouillon » d'une v3 émise | V3M05 |
| Éditeur d'une v3 : « Exporter Excel » et « Exporter DPGF » désactivés (même drapeau que le CSV, qui exige les totaux du client, nuls sur une v3), alors que leurs routes sont celles que 2.7 ouvre et que V3M02 prouve ; relevé par la revue (§13.6) | V3E15 (critique) : Excel et DPGF actifs, CSV et BDC fermés, dans le menu compact « Exporter » et dans « Plus d'actions » ; « Excel (.xlsx) » → `200` sur `…/export?format=xlsx`, en-tête v3 exact, « Moteur de calcul » 3 ; « Exporter DPGF » → `200` sur `…&mode=dpgf`, colonnes v3 |

V3M05 tourne dans la phase calc-v3 `emission-v3` (le garde de la campagne critique refuse toute écriture `…/status`) ;
la phase attend 4 résultats du fichier. Correction `7418afcb` : `EstimateDetailActionsMenu` (prop `closedEngineV3Template`)
ne ferme plus que le modèle (2.8) ; la fiche v3 rend `EstimateStatusActions` et le sceau vérifié, lus par deux
fonctions désormais partagées avec la fiche v1/v2 (`loadEmailDispatchProblem`, `resolveSealIntegrity`, sans
changement de comportement) ; la carte de lecture titre « Devis émis au moteur de calcul 3 » une v3 émise ;
l'éditeur offre « Envoyer » sur une v3. `7418afcb` laissait fermés les quatre exports de l'éditeur d'une v3 ; la revue
l'a relevé et `0bf43c02` ouvre Excel et DPGF (§13.6). Restent fermés sur une v3 : l'export CSV de l'éditeur
(`editor-export.ts`, construit par le client) et le BDC (P-20, décision du porteur requise), et l'enregistrement comme
modèle (2.8). Sonde `803b5ba9` : le premier vert lisait « Marquer accepté » absent
alors que la page l'affichait à l'échec (îlot client) ; attente bornée sans assertion, aucun attendu changé.

### 13.3 Preuves rouges et itérations (WSL, clone `~/miaouffrage-lot2-27`, aucun changement local)

| Commande | Arbre | Résultat |
|---|---|---|
| `npm run e2e:army:local -- --grep "^V3E11\s" --app-port 3227` | `8e33598b` | sortie 1 : V3E11 rouge, `pdf {present: true, enabled: false}`, `reason: false`, `pdfNamedClosed: true`. `.e2e/army/ci/2026-10-18T04-43-38-866Z-critical` |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --grep "^V3M05\s" --app-port 3127` | `ac19ec55` | sortie 1 : « Préparer le PDF » désactivé, raison absente, carte « pas encore disponibles » (relevés), « Envoyer » absent de l'éditeur (relevé), arrêt sur `toBeEnabled`. `…/2026-10-18T04-48-14-350Z-calc-v3` |
| idem | `7418afcb` | sortie 1 : PDF de la fiche (`202`, texte v3 exact, brouillon), émission par l'éditeur (`200`, `sent`, marqueur 5, `/verify` contrat 2 et charge 6), fiche émise (sceau `valid`, « Télécharger le PDF », modèle fermé, carte « Devis émis ») ; « Marquer accepté » relu absent (sonde, §13.2). `…/2026-10-18T04-54-18-806Z-calc-v3` |
| idem | `803b5ba9` | sortie 0 : acceptation par la fiche `200`, `accepted`, même sceau, `/verify` valide. `…/2026-10-18T04-58-09-862Z-calc-v3` |

### 13.4 Qualification de l'arbre fusionné (`803b5ba9`, aucun changement local)

WSL, Node 24.19.0, `NODE_OPTIONS=--max-old-space-size=4096`, exécutions natives en série, chacune après la garde de
concurrence (moins de quatre piles natives actives au départ). Journaux : `~/miaouffrage-lot2-27/.e2e/lot2-2.7/merge-qual-*.log`.

| Commande | Résultat |
|---|---|
| `npm run db:ci:local` | **sortie 0** en 28 s : `Files=21, Tests=1904`, `Result: PASS`, matrice RLS passée |
| `npm run e2e:army:local -- --grep "V3M\|V3FC\|V3E\|V3P01" --app-port 3227` | **sortie 0** en 407 s : 18/18 (setup, V3E01 à V3E13, V3M02, V3FC01, V3FC02, V3P01). `.e2e/army/ci/2026-10-18T05-01-14-796Z-critical` (`manifest.json` `837c0803…`) |
| `npm run e2e:army:calc-v3 -- --app-port 3127` (campagne complète) | **sortie 0** en 754 s, toutes phases en build de production : journeys 11, components 5, numeric 4, resume 5, access 2, offers 10, emission 6 (4 PDF reçus), emission-v3 5 (V3M01, V3M03, V3M04, V3M05 ; 5 PDF reçus). `…/2026-10-18T05-08-01-386Z-calc-v3` (`manifest.json` `43a3d298…`) |
| `npm run engine:document-fingerprints -- check` | **sortie 0** en 44 s : 14 familles v1/v2 identiques. `.e2e/engine-v3/document-fingerprints/2026-10-18T05-20-35-248Z-check` |
| `npm run db:upgrade-check -- lot2-2-7` | **sortie 0** en 20 s : 244 migrations de référence, 7 postérieures appliquées (dont `20261017205000` de 2.6 puis M5), 0 différence, contrôle négatif détecté |
| `npm run db:upgrade-check -- lot2-2-7 --negative-control` | sortie 1 en 20 s, comme exigé : exactement 1 différence (`pu_ht_cents 1481 -> 1482`) |
| `npm run e2e:army:local -- --app-port 3227` (sélection critique locale non filtrée, en plus : contrôle de régression général) | **sortie 0** en 733 s : 96/96 (28 fichiers). `…/2026-10-18T05-21-59-346Z-critical` (`manifest.json` `63fcd009…`) |

La fiche d'un devis v1/v2, qui partage désormais `loadEmailDispatchProblem` et `resolveSealIntegrity` avec la fiche
v3, est prouvée par la phase calc-v3 `emission` de la campagne complète ci-dessus : OF00 à OF0L
(`offer-emission.e2e.ts`) y lisent le sceau `valid` et « Envoyer par email » sur la fiche v1/v2 (6/6,
`…/2026-10-18T05-08-01-386Z-calc-v3`). La campagne critique non filtrée n'ouvre aucune fiche v1/v2 : elle reste un
contrôle de régression général, pas la preuve de ce partage (correction de la revue, §13.6).

Windows (`miaouffrage-l2-27`) : `npm run typecheck` sortie 0 ; `npx eslint --max-warnings=0` des fichiers touchés depuis la
fusion et de l'impression résolue : sortie 0 ; `npx vitest run` complet (avant la sonde `803b5ba9`, qui ne touche qu'un
parcours) : 465 fichiers passés / 1 ignoré, 3 992 tests passés / 11 ignorés ; `army-impact-map`, `ci-guardrails`,
`army-dev-loop`, `local-supabase-ci` sur l'arbre final : 63 passés / 8 ignorés (cas Linux) ; `npm run check:architecture` :
1 144 modules, 0 cycle ; `npm run supabase:validate` : 251 fichiers, 251 versions uniques ;
`npm run supabase:migrations:git-guard -- --mode pull_request --base 488382d5…` : passé (2 changements cadrés, M5 et le
manifeste). En mode local, la garde compare à `@{upstream}` (la pointe 2.7 d'avant la fusion) et refuse la migration de 2.6,
plus ancienne que M5 : attendu, la PR se juge contre `main`. `git diff origin/main...HEAD -- src/lib/estimate-calculations.ts
src/lib/estimate-v2-snapshot.ts` : vide ; `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` : sortie 0.

### 13.5 Limites

- Relecture indépendante (lecture seule) faite sur `058dc448` : un défaut majeur et trois mineurs, traités au §13.6.
  Relecture de suivi sur `d2ba4762` : les quatre traitements tiennent ; un mineur nouveau (motif faux de non-reprise),
  traité au §13.7.
- V3M05 n'est atteint que par la campagne calc-v3 (`emission-v3`) : la sélection d'impact des PR, critique, ne le
  choisit pas ; V3E11 (critique) tient l'état du menu de la fiche d'un brouillon, V3E15 (critique) celui des exports de
  l'éditeur.
- P-20 ne ferme plus, sur une v3, que l'export CSV de l'éditeur (`editor-export.ts`) et le BDC ; Excel et DPGF sont
  ouverts dans l'éditeur (§13.6). L'envoi par courriel depuis la fiche d'une v3 passe par la route `POST …/send` que
  V3M01 prouve, sans parcours d'écran de la fenêtre d'envoi.
- Cette fusion ne touche pas le Supabase partagé ; M5 n'y est pas appliquée (la migration de 2.6 y a été appliquée après la PR #44, PR #46, hors de cette branche). Rien n'est poussé.
- Historique : `origin/main` avait avancé pendant cette qualification (`78533fe5` : PR #46, rapport d'application de la
  migration de 2.6 au partagé ; PR #47, `scripts/tester-army/dev-loop-state.ts`, chemins résolus de la boucle). Il est
  fusionné en `088014df` et la qualification rejouée au §13.6.

### 13.6 Revue de la fusion, rattrapage de `main` et exports de l'éditeur v3 (18/10/2026)

Fusion `088014df` : `git fetch origin && git merge --no-ff origin/main` (`78533fe5` : PR #46, rapport d'application de
la migration de 2.6 au Supabase partagé et une ligne de `estimate-engine-v3-2.6.md` ; PR #47,
`scripts/tester-army/dev-loop-state.ts` en chemins résolus, `src/test/army-dev-loop.test.ts`, étape de reprise de
`tester-army-local-development.md`), sans conflit, sans rebase ni poussée.

Relecture indépendante en lecture seule sur `058dc448` :

| Constat | Traitement |
|---|---|
| Majeur : la fusion laissait fermés, sur une v3, « Exporter Excel » et « Exporter DPGF » de l'éditeur, seul écran qui offre les exports v3 que 2.7 ouvre et que V3M02 prouve ; deux verrous : `isExportDisabled \|\| isV3` et le drapeau unique du contrôleur, qui exige des totaux du client, nuls sur une v3 | décision du coordinateur par délégation du porteur, conforme à P-20 (qui ne ferme que `editor-export.ts` et le BDC, §9.1) : rouge V3E15 `b9968ec9`, correction `0bf43c02` |
| Mineur : le §13.4 attribuait la preuve de la fiche v1/v2 remaniée à la campagne critique non filtrée, qui n'ouvre aucune fiche v1/v2 | §13.4 crédite la phase calc-v3 `emission` (OF00 à OF0L) |
| Mineur : descriptions courantes d'avant la fusion (inventaire du §1 sans V3M05, §12.4, ligne V3E11 du document 2.6, commentaire de la phase `emission-v3`) | corrigées : §1, §12.4 (rendu historique), [2.6](estimate-engine-v3-2.6.md) (ligne V3E11 et ligne « Émission »), `calc-v3-phases.ts` |
| Mineur : branche en retard sur `origin/main` (`78533fe5`, dont `dev-loop-state.ts`, importé par le runner) | fusion `088014df` ; qualification rejouée ci-dessous |

Correction `0bf43c02` :

- `useEstimateEditorExportController` expose `isStreamingDisabled` (`isExporting || !version` : Excel, DPGF et BDC
  passent par `GET /api/estimates/{id}/export` et n'ont pas besoin des totaux du client) et `isCsvDisabled`
  (inchangé : `isExporting || !version || !settings || !totals`).
- `useEstimateEditorState.impl.tsx` passe Excel et DPGF = `isStreamingDisabled`, CSV = `isCsvDisabled || isV3`,
  BDC = `isStreamingDisabled || isV3`.
- `EstimateEditorToolbar` reçoit un état par entrée (`isExcelExportDisabled`, `isCsvExportDisabled`,
  `isDpgfExportDisabled`, `isBdcExportDisabled`) ; `ExportDropdown` reçoit `excelDisabled` et `csvDisabled` et ne
  désactive son bouton que si `disabled` est vrai ou si les deux entrées sont fermées (la page des bons de commande, qui
  ne passe que `disabled`, est inchangée).
- v1/v2 inchangés par construction : la barre d'outils n'est rendue qu'à l'état `ready`, qui exige `version` et
  `settings` ; sur une v1/v2, `totals` n'y est jamais nul (`computeDraftBreakdown`, `computeReadOnlyTotals`), donc
  `isStreamingDisabled` et `isCsvDisabled` valent l'ancien drapeau unique, et « Exporter » est désactivé exactement
  quand il l'était.
- Les tests Vitest existants du contrôleur et de la barre suivent le renommage, sans test isolé ajouté ; la lecture
  XLSX d'`engine-v3-emission-support.ts` est extraite en `readWorkbookRows`, que V3E15 réutilise.

V3E15 (`engine-v3-editor-actions.e2e.ts`, campagne critique, bureau 1 280 px) : brouillon v3 d'une ligne X (2 u à
100,00 € → PU 130,00 €, PT 260,00 €) ouvert dans l'éditeur. Les états sont lus dans le menu compact « Exporter »
(« Excel (.xlsx) », « Fichier CSV (.csv) ») et dans « Plus d'actions » (« Exporter DPGF », « Exporter BDC V1.1 », et
« Exporter Excel » et « Exporter CSV » du menu mobile, masqués à cette largeur, lus dans le DOM). « Excel (.xlsx) »
puis « Exporter DPGF » sont téléchargés, chacun avec la réponse de sa route, et relus par ExcelJS.

| Commande (WSL, `~/miaouffrage-lot2-27`, aucun changement local) | Arbre | Résultat |
|---|---|---|
| `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "^V3E15\s" --app-port 3161` | `b9968ec9` | rouge attendu : « TesterArmy CI failed », `manifest.json` `status: failed` (`f92117c0…`), étape `journeys-critical` `exitCode` 1, `critical/report.json` `run.exitCode` 1, 1 des 2 parcours en échec (le `exit=0` final de `v3e15-red.log` est celui de l'enveloppe de la commande, pas celui du runner). Attendu `{compact: true, compactExcel: true, compactCsv: false, menuExcel: true, menuCsv: false, dpgf: true, bdc: false}`, obtenu `{compact: false, compactExcel: null, compactCsv: null, menuExcel: false, menuCsv: false, dpgf: false, bdc: false}`. `.e2e/army/ci/2026-10-18T06-15-33-222Z-critical` |
| idem | `0bf43c02` | **sortie 0** : états attendus ; Excel `200` sur `…/export?format=xlsx`, en-tête `Poste, Désignation, Unité, Quantité, Statut, TVA (%), PU HT, Total HT`, « Moteur de calcul » 3, ligne X 130 / 260 ; DPGF `200` sur `…&mode=dpgf`, colonnes « Statut », « h MO / unité », « PU vente HT EUR », « Total HT brut EUR », ligne X 130 / 260. `.e2e/army/ci/2026-10-18T06-19-41-201Z-critical` (`manifest.json` `c8d705e7…`) |

Qualification de la tête `4187b524` (code, journeys et documentation corrigés ; la tête finale n'y ajoute que ce
relevé). WSL, Node 24.19.0, `E2E_ARMY_WORKERS=2`, `NODE_OPTIONS=--max-old-space-size=4096`, aucun changement local
(`diffSha256` vide), exécutions en série après la garde de concurrence ; journaux
`~/miaouffrage-lot2-27/.e2e/lot2-2.7/final-*.log`. `origin/main` relu ensuite : toujours `78533fe5`, déjà fusionné.

| Commande | Résultat |
|---|---|
| `npm run e2e:army:local -- --grep "V3M\|V3FC\|V3E\|V3P01" --app-port 3161` | **sortie 0** en 294 s : 19/19 (setup, V3E01 à V3E13, V3E15, V3M02, V3FC01, V3FC02, V3P01), V3E01 compris. `.e2e/army/ci/2026-10-18T06-25-39-174Z-critical` (`manifest.json` `15aab4e8…`) |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3162` | **sortie 0** en 99 s, build de production possédé : 5/5 (setup, V3M01, V3M03, V3M04, V3M05), 5 PDF reçus par le collecteur. `…/2026-10-18T06-30-59-251Z-calc-v3` (`manifest.json` `94bb6d98…`) |
| `npm run e2e:army:local -- --grep "downloaded XLSX and DPGF cells\|commercial rounding uses lower steps" --app-port 3161` (en plus : exports de l'éditeur v1/v2 après le partage du drapeau) | **sortie 0** en 80 s : 3/3 (setup ; XLSX, DPGF et BDC téléchargés depuis l'éditeur v1/v2, cellules égales au devis persisté ; arrondi commercial au XLSX et au DPGF). `…/2026-10-18T06-33-20-513Z-critical` (`manifest.json` `39e29ec4…`) |
| `npx vitest run src/test/army-dev-loop.test.ts` (WSL, en plus : les cas ignorés sous Windows, dont ceux de la PR #47) | **sortie 0** : 25/25 |

Windows (`miaouffrage-l2-27`, même tête) : `npm run typecheck` sortie 0 ; `npx eslint --max-warnings=0` des fichiers
touchés (`ExportDropdown.tsx`, `EstimateEditorToolbar.tsx` et son test, `useEstimateEditorExportController.ts` et son
test, `useEstimateEditorState.impl.tsx`, `engine-v3-editor-actions.e2e.ts`, `engine-v3-emission-support.ts`,
`calc-v3-phases.ts`) : sortie 0 ; `npx vitest run` des deux tests touchés et de `army-dev-loop`, `ci-guardrails`,
`army-impact-map` : 5 fichiers, 47 passés / 10 ignorés (cas Linux d'`army-dev-loop`, joués dans WSL ci-dessus) ;
`git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` : sortie 0 ; `git diff origin/main...HEAD --
src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` : vide.

Non rejoués après `803b5ba9` (§13.4), sans entrée touchée : `db:ci:local` (aucune migration ni test SQL ; ses pgTAP et
matrice RLS repassent en tête de chaque run ci-dessus), empreintes de documents, `db:upgrade-check`. La campagne critique
non filtrée et les phases calc-v3 autres que `emission-v3` avaient, elles, des entrées changées (contrôles d'export de
l'éditeur de `0bf43c02`, `dev-loop-state.ts` du runner apporté par `088014df`) : la relecture de suivi l'a relevé et
elles sont rejouées au §13.7.

Reste : la PR #40 (2.8), ouverte, entre en conflit avec cette branche dans `engine-v3-editor-actions.e2e.ts`
(constantes de V3E11 contre le retrait de `PASTE_REFUSAL`) et dans `supabase/migrations.manifest.json`. Ces conflits
existaient déjà à `058dc448` ; V3E15 et l'éditeur fusionnent sans conflit (essai `git merge-tree` contre `f00da33b`).
Conflits avec les PR #41 et #42 : §13.7.

### 13.7 Relecture de suivi et reprise des campagnes invalidées (18/10/2026)

Relecture indépendante en lecture seule sur `d2ba4762` (`origin/main` relu : `78533fe5`). Les quatre traitements du
§13.6 tiennent. Les rouge et vert de V3E15 sont authentiques : un seul des deux verrous laissé en place ferme au moins
une des sept entrées lues. Les cinq manifestes cités sont relus à l'identique. Sur une v1/v2, les états de la barre
sont inchangés par construction.

| Constat | Traitement |
|---|---|
| Mineur : le §13.6 disait la campagne critique non filtrée et les phases calc-v3 autres que `emission-v3` non rejouées « faute d'entrée touchée ». C'est faux : `0bf43c02` change les contrôles d'export de l'éditeur que cliquent `journeys` (`estimate-totals-order`, `estimate-create-atomic`, `estimate-batch-atomic`), `components`, `numeric` et `resume` (bouton DPGF), et `088014df` apporte `dev-loop-state.ts`, importé par le runner et listé `full` dans la carte d'impact | les deux campagnes sont rejouées ci-dessous sur l'arbre de code final. Le motif du §13.6 est corrigé. `db:ci:local`, les empreintes et `db:upgrade-check` restent sans entrée changée depuis `803b5ba9` : leurs graphes d'import (esbuild, `document-fingerprints.ts`, `document-fingerprints-worker.ts`, `upgrade-check.ts`, `run-local-supabase-ci.ts` et la matrice `rls.e2e.test.ts` qu'il lance) ne contiennent aucun des fichiers modifiés depuis, et aucune migration ni aucun test SQL n'a changé |
| Polissage : `v3e15-red.log` finit par `exit=0` alors que le run a échoué | le relevé rouge du §13.6 cite l'étape `journeys-critical` `exitCode` 1 du manifeste et `critical/report.json` `run.exitCode` 1 |
| Polissage : inventaire du document 2.6 (ligne `useEstimateEditorState.impl.tsx`, « exports désactivés ») | renvoi « depuis la fusion du 2.7 » ajouté ([2.6](estimate-engine-v3-2.6.md)) |
| Polissage : description de la PR (« V3E13 relève de la PR #40 ») et conflits avec #42 absents | description corrigée. Conflits relevés ci-dessous |

Reprise sur `d2ba4762`. Son arbre de code et ses parcours sont ceux de `4187b524` (§13.6). La tête suivante n'ajoute que
ce relevé et les documents. Exécutions WSL (`~/miaouffrage-lot2-27`, Node 24.19.0, `E2E_ARMY_WORKERS=2`,
`NODE_OPTIONS=--max-old-space-size=4096`), sans changement local (`diffSha256` vide), en série après la garde de
concurrence. Journaux `~/miaouffrage-lot2-27/.e2e/lot2-2.7/followup-*.log` (tête, état local, commande, code de sortie
et durée).

| Commande | Résultat |
|---|---|
| `npm run e2e:army:local -- --app-port 3161` (sélection critique locale non filtrée) | **sortie 0** en 454 s : 97/97 (96 du §13.4 + V3E15). `.e2e/army/ci/2026-10-18T06-52-31-823Z-critical` (`manifest.json` `17480a29…`) |
| `npm run e2e:army:calc-v3 -- --app-port 3162` (campagne complète) | **sortie 0** en 731 s, toutes phases en build de production, sources inchangées pendant le run : journeys 11, components 5, numeric 4, resume 5, access 2, offers 10, emission 6 (4 PDF reçus), emission-v3 5 (V3M01, V3M03, V3M04, V3M05 ; 5 PDF reçus). `…/2026-10-18T07-00-06-836Z-calc-v3` (`manifest.json` `5e07b0af…`) |

Conflits avec les PR ouvertes, par essai `git merge-tree` de leurs têtes poussées contre cette branche puis contre
`origin/main` :

- **#40** (`f00da33b`) : `engine-v3-editor-actions.e2e.ts` et `supabase/migrations.manifest.json` (§13.6). #40
  fusionne sans conflit dans `main`, donc ces conflits sont propres à cette branche.
- **#42** (`964775bc`) : `docs/testing/tester-army-calc-v3.md` est propre à cette branche ;
  `scripts/run-tester-army-ci.ts` et `scripts/tester-army/army-impact-map.json` entrent déjà en conflit avec `main`.
- **#41** (`32cfcc69`) : `useEstimateEditorBulkController.ts` et `useEstimateEditorSuggestionsController.ts` entrent déjà en
  conflit avec `main` ; cette branche n'en ajoute aucun.

La PR fusionnée en second résout ses conflits et rejoue ce qu'ils invalident. Ce traitement n'a pas de troisième
relecture.

### 13.8 Revue Codex de 3d78d662 (18/10/2026)

Quatre constats de Codex sur `3d78d662`, traités selon les décisions du coordinateur en deux voies indépendantes :
voie A (impression et pied du portail), voie B (exports XLSX). Chaque voie a travaillé sur sa branche locale et son
clone WSL (`tmp/l2-27-codex-a`, `~/miaouffrage-l27-codex-a` ; `tmp/l2-27-codex-b`, `~/miaouffrage-l27-codex-b`). Ses
commits ont ensuite été reportés sur la branche de la PR par `cherry-pick`, voie A puis voie B. Aucune migration,
aucun test SQL, ni `src/lib/estimate-calculations.ts` ni `src/lib/estimate-v2-snapshot.ts` ne changent.

Les runs ci-dessous citent la tête de voie qu'ils ont exécutée, inscrite dans leur manifeste. Les branches `tmp/` sont
supprimées depuis le report, mais chaque commit reporté garde le correctif de sa tête de voie : même `git patch-id`
pour neuf des dix commits ; seul le relevé de la voie B diffère, par la résolution du conflit de ce document. Hors documentation, l'arbre reporté moins la voie B est exactement le diff de la voie A
(même `patch-id`, `8a1bed60559a`).

| Voie | Tête de voie (runs) | Commit de la PR | Objet |
|---|---|---|---|
| A | `ec3a8e26` | `a630d19b` | V3M06 rouge (identité) |
| A | `0ca15e51` | `427e714e` | impression depuis la copie au contrat 2 |
| A | `63b07056` | `fd5099c5` | V3M06 rouge (pied du portail) |
| A | `22825bbb` | `88ebd56e` | emphase du pied du contrat 2 |
| A | `d8186244` | `b8246319` | avis nommé d'une copie que l'analyseur strict refuse |
| A | `3f5d4e1a` | `7a118a24` | relevé de la voie A |
| B | `38570e42` | `bfa0b7a1` | V3X01 et V3X02 rouges |
| B | `5b0bd907` | `f8c12cde` | format et en-têtes de montant dans la devise de la version |
| B | `5d3f6c65` | `48c39cef` | lignes non chiffrées non facturables au réimport |
| B | `4204efc3` | `8dd28c91` | relevé de la voie B (conflit de ce document résolu en gardant les deux relevés) |

#### Voie A : impression d'une v3 émise et pied du portail

| Constat | Traitement |
|---|---|
| P2 (commentaire 4306173923, `print/page.tsx:195`) : l'impression d'une v3 envoyée, acceptée ou archivée passe au document le profil du lecteur et l'affaire vivante. Un autre administrateur du tenant y figure sous « Émis par » et les changements de l'affaire après l'émission s'impriment, alors que le badge vérifie l'identité de la copie au contrat 2 | hors brouillon, `EstimateV3PrintPage` relit la copie émise par `loadVerifiedOfferDocument`, le lecteur vérifié du portail et de `verifyEstimateSeal`. Elle imprime depuis le contrat 2 l'émetteur, l'entreprise, le client, l'affaire, la référence (déjà suffixée de la version), la date, la validité et les limites de prestation. Une copie qui ne se vérifie pas (`ApiError`, ou `OfferContractError` de l'analyseur strict) n'est pas imprimée : un avis la nomme. Le brouillon garde l'aperçu vivant. `EstimateDocument`, l'en-tête et le pied d'entreprise reçoivent en option l'entreprise et la référence figées ; leurs appelants v1/v2 n'en passent aucune. Lignes et montants restent ceux du gel stocké couvert par la charge 6 : son pied est égal au contrat par `contract2MatchesVersion`, ses lignes le sont en SQL à la publication |
| P2 (commentaire 4306173926, `CommercialEstimateDocument.tsx:190`) : au contrat 2 avec remise ou arrondi, le pied HTML du portail met en bandeau sa première ligne, « Total HT brut », et laisse « Total HT net » et le TTC en lignes ordinaires | le pied du contrat 2 suit l'emphase de `buildEstimateV3FooterRows` : `net` en bandeau, `payable` en gras, `detail` sinon, portée par `data-emphasis`. Le contrat 1 est inchangé (première ligne en bandeau, aucun attribut). L'impression (`EstimateDocumentTotalsV3`) et le PDF (`PdfEstimateTotalsV3`) la suivaient déjà |

Défaillances écrites avant le code : V3M-15 et V3M-16 (en-tête de `engine-v3-emission.e2e.ts`). Parcours V3M06 (phase
`emission-v3`) : un S2 (remise de 1,01 €) émis par le propriétaire dédié est imprimé trois fois. D'abord à l'émission,
puis après la modification de l'affaire par sa fiche (nom, client, référence, adresse, comme OF02), enfin par un second
administrateur du tenant. La fixture `calc-v3-emission-v3-3` crée cet administrateur, qui bascule son tenant actif par
la RPC ordinaire comme l'observateur de `access` ; le profil calc-v3 le connecte sous l'identifiant `viewer`. Attendu à
chaque lecture : « Émis par » du propriétaire et son adresse, client « Client à renseigner », chantier au nom d'émission
sans adresse, bloc « Devis » relevé à l'émission, sceau `valid`. V3M06 relit ensuite le pied de l'impression et celui
du portail collecté. La phase attend 6 résultats.

| Commande (WSL, `~/miaouffrage-l27-codex-a`, aucun changement local) | Arbre | Résultat |
|---|---|---|
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --grep "^V3M06\s" --app-port 3163` | `ec3a8e26` | rouge attendu (V3M-15), sortie 1. `atEmission` conforme ; `afterChange` client `["ARMY client modifié V3M06", "Référence projet : ARMY-REF-V3M06"]` et chantier renommé ; `asViewer` émetteur `["ARMY calc-v3 v3m-viewer", "<adresse du lecteur>"]` ; sceau `valid` aux trois lectures. `.e2e/army/ci/2026-10-18T07-54-12-029Z-calc-v3` (`manifest.json` `dc3e34f4…`) |
| idem | `0ca15e51` | **sortie 0** : 2/2 (setup, V3M06). `…/2026-10-18T08-02-34-087Z-calc-v3` (`a0b971fc…`) |
| idem | `63b07056` | rouge attendu (V3M-16), identité verte. Impression : « Total HT net » en bandeau, TTC en gras. Portail : « Total HT brut » en bandeau et en gras, « Total HT net » et « Total TTC » ordinaires, aucun `data-emphasis`. `…/2026-10-18T08-05-32-301Z-calc-v3` (`7fd81388…`) |
| idem | `22825bbb` | **sortie 0** : 2/2. `…/2026-10-18T08-08-32-722Z-calc-v3` (`8d147ae9…`) |

Qualification de la tête de code `d8186244` (`22825bbb` plus l'avis nommé d'une `OfferContractError` ; la tête
suivante n'ajoute que ces relevés). Node 24.19.0, `E2E_ARMY_WORKERS=2`, `NODE_OPTIONS=--max-old-space-size=4096`, après la
garde de concurrence (au plus quatre runs natifs possédés) ; journaux `~/l27-codex-a-logs/*.log` (tête, état local,
commande, code de sortie, durée murale).

| Commande | Résultat |
|---|---|
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --app-port 3163` | **sortie 0** en 192 s : 6/6 (setup, V3M01, V3M03, V3M04, V3M05, V3M06), 6 PDF reçus. `…/2026-10-18T08-13-25-064Z-calc-v3` (`f86a311f…`) |
| `npm run e2e:army:calc-v3 -- --phase emission --app-port 3163` (contrat 1, `offer-emission.e2e.ts`) | **sortie 0** en 180 s : 6/6 (setup, OF00, OF01, OF02, OF04, OF0L), 4 PDF reçus. `…/2026-10-18T08-16-38-213Z-calc-v3` (`ae094486…`) |
| `npm run e2e:army:local -- --files` du groupe `print` de la carte d'impact et de `engine-v3-fail-closed`, `purchase-decimals` (en plus : impression v1/v2, brouillon v3, bon de commande) | sortie 1 en 416 s : 14/15. `commercial-rounding` 2, `estimate-integrity` 5, V3M02, V3FC01, V3FC02 et V3E02 à V3E04 verts. V3E01 rouge dans l'éditeur, avant toute impression : la sauvegarde observée n'a pas O2 complet avant l'échéance (HT 37 296 c au lieu de 62 496). Ni la grille ni la sauvegarde ne sont touchées ; d'autres runs natifs tournaient en même temps. `…/2026-10-18T08-21-06-273Z-critical` (`a01b6180…`) |
| `npm run e2e:army:local -- --grep "^V3E01\s" --app-port 3163` (reprise de V3E01, même tête) | **sortie 0** en 191 s : 2/2. `…/2026-10-18T08-29-34-810Z-critical` (`2c0b536c…`) |

`npm run typecheck`, `npx eslint --max-warnings=0` des huit fichiers touchés et `npx vitest run` de
`EstimateDocument.test.ts`, `PurchaseOrderDocument.test.ts`, `offer-commercial-render.test.tsx` et
`estimate-calculations.golden/subcontractor.test.ts` (31 passés) : sortie 0. `git -c core.whitespace=cr-at-eol diff
--check 3d78d662...HEAD` : sortie 0. `git diff 3d78d662` des deux moteurs historiques, de `supabase/migrations/` et de
`supabase/migrations.manifest.json` : vide.

Limites :

- Une version v1/v2 émise s'imprime toujours avec le profil du lecteur et l'affaire vivante (branche historique de
  `print/page.tsx`) : même classe de défaut, laissée telle quelle car le contrat 1 doit rester identique. Elle relève
  d'une décision séparée.
- Hors brouillon, l'impression d'une v3 relit et hache désormais deux fois le PDF stocké : une fois pour le badge
  (`verifyEstimateSeal`), une fois pour la copie.
- Une v3 en `sending`, pas encore scellée, affiche l'avis au lieu d'une identité vivante.
- L'avis d'une copie invérifiable n'a pas de parcours : il faudrait altérer la copie stockée. Aucun repli vivant n'existe
  dans `issuedCopyOf`.
- Comme V3M05, V3M06 n'est atteint que par la phase calc-v3 `emission-v3`, pas par la sélection d'impact des PR.

#### Voie B : exports XLSX d'une v3

Exports XLSX v3 (`src/lib/estimates/v3-export.ts`), deux constats de la revue Codex de `3d78d662`, traités selon la
décision du coordinateur. Parcours `e2e/army/local/engine-v3-exports.e2e.ts` (campagne critique locale, nouveau fichier
inscrit dans la carte d'impact), défaillances V3X-01 à V3X-06 écrites en tête du fichier avant le code.

| Constat | Traitement |
|---|---|
| P2 (`v3-export.ts:56`) : une v3 en USD ou GBP, devises acceptées par les schémas du devis et du contrat, reçoit le format « € » sur chaque montant de ses classeurs standard et DPGF, dont les en-têtes de montant disent « EUR » | `5b0bd907` : format et en-têtes suivent `version.currency` (repli EUR, comme le pied) : EUR `#,##0.00 "€"` inchangé, USD `"$"#,##0.00`, GBP `"£"#,##0.00` (symbole et place de `formatCurrency`) ; « Prix unitaire HT », « PU vente HT » et « Total HT brut » suivis du code de la devise. Rouge puis vert : V3X02 |
| P1 (`v3-export.ts:254`) : sur une ligne non chiffrée, le statut n'est écrit que dans « Statut », sans cible d'import ; le PR FO, les heures et la majoration restent, et le réimport recrée une ligne facturable | `5d3f6c65` : une ligne non chiffrée n'écrit plus aucun nombre dans une colonne que l'import lit comme prix, déboursé ou main-d'oeuvre. DPGF : « Prix unitaire HT » et « Total HT brut » portent le libellé du statut du document (« Inclus », « Pour mémoire », « Hors lot »…), « PU vente HT » reste vide (le document imprime « - »), « h MO / unité », ses jumeaux atelier et chantier et « Majoration MO (%) » sont vides. Standard : « Total HT » porte le libellé au lieu de 0, « PU HT » reste vide. Quantité, unité, « Statut », TVA, Type FO, K, rôles et catégorie restent ; lignes chiffrées inchangées ; chemin d'import inchangé (décision : la PR #40 travaille sur les imports). Rouge puis vert : V3X01 |

Colonnes lues par l'import (`MAPPING_TARGET_FIELDS`, profil `dpgf_export` d'`optima-profile.ts`, heuristique de
`mappings/server.ts`). Le DPGF v3 ne porte pas « h MO » (il écrit « h MO / unité ») : la signature du profil
`dpgf_export` (« AID », « Prix unitaire HT EUR », « h MO », « Rôle MO ») ne le reconnaît pas. Correspondance proposée
sur un tenant neuf, relevée par V3X01 : Désignation, Quantité, Unité, Type FO, Catégorie ; « h MO / unité » →
`labor_hours` (heures de ligne) ; « Majoration MO (%) » → `h_mo_majoration_percent` ; « PU vente HT EUR » →
`control_unit_price` (contrôle) ; « Total HT brut EUR » → `total_ht`, d'où PU = PT / Q. « Prix unitaire HT EUR » reste
sans cible : `control_unit_price` va au PU de vente. Le profil, une mémoire de correspondance ou un choix de
l'utilisateur le lisent en `unit_price_ht`. Statut, TVA, K FO, K MO, AID, Type et rôles n'ont aucune cible.

Inspection demandée : oui, le DPGF v3 écrit des déboursés et des saisies de main-d'oeuvre, pour chaque ligne :
« Prix unitaire HT » = PR FO, Type FO, K FO, h/u, K MO, majoration, rôles, catégorie et jumeaux atelier et chantier. Ce
sont les « saisies réimportables » qu'écrit aussi le DPGF v1/v2 (`dpgf-export.ts`). Hors du constat, ces colonnes ne
sont pas reconçues pour les lignes chiffrées : rapporté au coordinateur. Constat préexistant, non corrigé (chemin
d'import inchangé) : réimportée avec la correspondance proposée, une ligne chiffrée reprend PT / Q comme prix de
fourniture et ses heures par unité comme heures de ligne. V3X01 le neutralise par deux lignes chiffrées « fourniture
seule ». Ce constat est corrigé à la revue de `8dd28c91` (§13.9) par un profil d'import déclaré du DPGF v3.

V3X01 : brouillon v3 (propriétaire dédié, politique 3 le temps de la création, puis 2) de P1 (2 u, PR 10,00 € → PU
13,00, PT 26,00), P2 (3 ml, PR 5,00 € → 6,50 / 19,50) et de trois lignes non chiffrées avec déboursé et heures au rôle
« Tuyauteur » 40 €/h : N1 incluse (3 u, 50,00 €, 2 h/u), N2 hors lot (4 ml, 25,00 €, 0,5 h/u), N3 pour mémoire (1 u,
99,00 €, 1 h/u). Totaux v3 45,50 / 9,10 / 54,60 €. Les deux exports passent par la route de l'interface et sont relus
par ExcelJS, cellule par en-tête. Le DPGF est importé par « Importer la DPGF » dans une nouvelle affaire v2, avec la
correspondance proposée inchangée et le rôle que l'aperçu demande pour les heures importées (« Sans rôle, ces heures
sont valorisées à 0 €/h »). Le devis créé est relu. V3X02 : brouillon v3 d'une ligne X (2 ml, 15,00 € + 1 h/u →
67,50 / 135,00 €), remise 10 % ; exports en EUR, puis après passage des réglages en USD, puis en GBP. Pour chaque
devise : en-tête exact du DPGF et format de chaque cellule numérique de montant (Devis 8, Resume 5, Données 3,
Metadata 5), aucun autre format dans le classeur.

| Commande (WSL, `~/miaouffrage-l27-codex-b`, Node 24.19.0, `E2E_ARMY_WORKERS=2`, `NODE_OPTIONS=--max-old-space-size=4096`, aucun changement local sauf mention) | Tête | Résultat |
|---|---|---|
| `npm run e2e:army:dev-loop -- run --grep "^V3X0[12] "` (boucle `--app-port 3164`, itérations 1 à 4, mise au point du parcours avant le rouge retenu) | `d6fc1bf9`, puis `de9a00c3` | échecs du parcours en cours d'écriture, sans valeur de preuve : 1 (`9afd2bf8…`) `toBeEnabled` de l'étape d'import ; 2 (`1438f918…`) attente de 60 s de l'avancée de l'aperçu ; 3 (`79a89cfc…`, changement local `diffSha256` `6a4c7cc1…`) et 4 (`2deff713…`, changement local `ce53ff40…`) comparaison finale de V3X01. `.e2e/army/ci/2026-10-18T08-01-51-982Z-dev-loop/iterations/001` à `004` |
| `npm run e2e:army:local -- --grep "^V3X0[12] " --app-port 3174` (pendant la boucle) | `de9a00c3` | refus de préparation, aucune étape : une boucle d'itération ouverte partage la sortie `.e2e/army`. `.e2e/army/ci/2026-10-18T08-12-56-717Z-critical` (`manifest.json` `c426e039…`) |
| `npm run e2e:army:dev-loop -- run --grep "^V3X0[12] "` (boucle `--app-port 3164`, itération 5, build `alDdP-KMCHHXygC_SPM4P` de `3d78d662`) | `38570e42` | rouge attendu : manifeste `failed` (`0e30deaf…`), `journeys-critical` exitCode 1, V3X01 et V3X02 en échec. V3X01 : devis importé 185,50 / 37,10 / 222,60 € au lieu de 45,50 / 9,10 / 54,60 ; N1, N2, N3 reviennent à PU 0 avec 2 h, 0,5 h et 1 h au rôle, soit 80,00, 20,00 et 40,00 € ; cellules DPGF de N1 : « Prix unitaire HT EUR » 50, « h MO / unité » 2, « Majoration MO (%) » 100, « Total HT brut EUR » 0 ; standard « Total HT » 0 ; aperçu « 5 lignes prêtes », aucune refusée. V3X02 : en USD et en GBP, chaque montant `#,##0.00 "€"` et en-têtes « … EUR » ; EUR conforme. Fixtures `ARMY-1792311615878-19555dbb`, `ARMY-1792311627028-cd71d0c7`. `.e2e/army/ci/2026-10-18T08-01-51-982Z-dev-loop/iterations/005-2026-10-18T08-19-57-346Z` |
| idem, itération 6 (reconstruite) | `5b0bd907` | V3X02 vert, V3X01 encore rouge (attendu) ; manifeste `4fb0632f…` |
| idem, itération 7 (reconstruite) | `5d3f6c65` | 3/3 (setup, V3X01, V3X02) ; manifeste `b22ef450…` |
| `npm run e2e:army:local -- --grep "dpgf\|DPGF\|import\|^V3M02 \|^V3FC02 \|commercial rounding uses lower steps" --app-port 3164` (boucle arrêtée, pile possédée neuve : pgTAP, matrice RLS, build de production) | `5d3f6c65` | **sortie 0** en 126 s : 17/17 : setup ; access-boundaries ; CSV DPGF (en-têtes métier et opaques), DPGF03 ; trois imports OPTIMA ; HUB02 ; « downloaded XLSX and DPGF cells… » et association catalogue (estimate-integrity) ; arrondi commercial (exports v1/v2) ; V3E15 ; V3M02 ; V3FC02 ; V3X01 (aperçu « 2 lignes prêtes · 3 refusées », devis importé P1 et P2 seuls, 45,50 / 9,10 / 54,60 €) ; V3X02. Fixtures `ARMY-1792312643112-8af165ff`, `ARMY-1792312649345-a052b418`. `.e2e/army/ci/2026-10-18T08-35-31-681Z-critical` (`manifest.json` `1ac60faa…`) |
| `npm run typecheck` ; `npx eslint --max-warnings=0 src/lib/estimates/v3-export.ts e2e/army/local/engine-v3-exports.e2e.ts` ; `npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts` ; `git diff --check 3d78d662...HEAD` | `5d3f6c65` | sortie 0 ; 23/23 ; `git diff 3d78d662...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts supabase/` vide |

Journaux : `~/l27-codex-b-logs/*.log` (tête, état local, commande, sortie, durée). Identité EUR octet pour octet : un
document v3 factice (section, ligne chiffrée avec MO et remise 10 % ; puis la même avec une ligne incluse) est écrit
par les écrivains standard et DPGF de `3d78d662`, de `5b0bd907` et de `5d3f6c65`, avec le même `WorkbookWriter` en flux d'ExcelJS que
`createWorkbookWriterFactory`. Les parties des classeurs EUR sont comparées une à une, `docProps/core.xml` (horodatage)
exclu. Sans ligne non chiffrée, elles sont identiques aux trois têtes. Avec la ligne incluse, seule
`xl/worksheets/sheet1.xml` de chaque classeur change à `5d3f6c65`, ce qui est le changement voulu ; en USD,
`styles.xml` et `sharedStrings.xml` changent dès `5b0bd907`. Ce différentiel reste hors dépôt (script local, pas de test
isolé).

Limites :

- Le statut n'est pas réimporté : le contrat d'import n'a pas de cible de statut. Une ligne non chiffrée n'est pas
  recréée à 0 €. Quand une colonne de prix est lue (`total_ht` dans la correspondance proposée, `unit_price_ht` pour le
  profil ou une mémoire), le libellé n'est pas un nombre et l'import la refuse sous sa raison générique « prix invalide
  (deux décimales au plus) », qui ne nomme pas le statut. Une correspondance qui ne lit aucune colonne de prix
  l'importerait à 0 € sans heure. Seule la correspondance proposée est rejouée ; les autres sont couvertes par
  l'assertion des cellules exportées, pas par un réimport.
- Rouge et vert intermédiaires dans la boucle d'itération (`e2e:army:dev-loop`, qui ne qualifie pas) ; la
  qualification est le run `e2e:army:local` de `5d3f6c65`.
- Ajouter le parcours à la carte d'impact (`army-impact-map.json`, glob `full`) fait sélectionner la suite complète par
  la CI de la PR.

### 13.9 Revue de 8dd28c91 : CGV de la copie émise, réimport d'une ligne chiffrée avec MO, fusion de `main` (18/10/2026)

Relecture indépendante en lecture seule de la tête intégrée `8dd28c91` (arbre `ab908f44`, aucun changement local). Les
quatre traitements du §13.8 tiennent, sauf les CGV de l'impression. Quatre constats, traités sur la branche de la PR
(worktree `miaouffrage-l2-27`, clone WSL `~/miaouffrage-lot2-27`), sans nouvelle relecture. Aucune migration, aucun test
SQL, ni `supabase/migrations.manifest.json`, ni les deux moteurs historiques, ni `dpgf-export.ts`, ni le chemin
d'import, de correspondance et d'affaire (`src/lib/affaires/`, `src/lib/mappings/`), ni `print/page.tsx`,
`offer-document.ts` ou `pdf-generator.tsx` ne changent (`git diff 8dd28c91` vide sur ces chemins).

| Constat | Traitement |
|---|---|
| Majeur : le plan de fusion de `main` date de `5cfd4a94`. `origin/main` est à `3af6804c` (PR #42) : un quatrième fichier entre en conflit (`docs/testing/tester-army-calc-v3.md`), et une garde de #42 échoue sur l'arbre fusionné. `ci-guardrails.test.ts:684` exige que les options de phase d'`e2e-army-calc-v3.yml` soient `["nightly", "all", ...CALC_V3_PHASES]`, et `:703` que `CALC_V3_NIGHTLY_PHASES` liste chaque phase servie en production ; cette branche ajoute `emission-v3` et sert `emission` en production, absents des deux | fusion **non faite** : elle reste suspendue à la décision d'ordre de M5 face à M6 et M6b de #40 (garde `supabase-migration-git-guard.ts:196`), et elle réécrit `supabase/migrations.manifest.json`, hors du périmètre de ce traitement. La recette de résolution est fixée ci-dessous et prouvée sur un arbre jetable ; l'inventaire des conflits est celui de `3af6804c` |
| Majeur, préexistant : réimporté par « Importer la DPGF » avec la correspondance proposée, un DPGF v3 rend plus chère une ligne chiffrée avec main-d'oeuvre. « Total HT brut » est lu en `total_ht` (PU = PT / Q, MO comprise, pris pour le PR FO) et « h MO / unité » en heures de ligne, que le rôle choisi valorise une seconde fois | `a2423777` : profil d'import déclaré `dpgf_export_v3` (`src/lib/imports/optima-profile.ts`). Il est reconnu par « AID », « Statut », « h MO / unité » et « Rôle MO », jamais réunis dans le DPGF v1/v2, l'export de l'éditeur ou un classeur OPTIMA. Il lit les saisies : « Prix unitaire HT » (PR FO) en `unit_price_ht`, « h MO / unité » en `labor_hours_per_unit`, « Majoration MO (%) », Type FO et catégorie. « PU vente HT » et « Total HT brut » deviennent des contrôles (`control_unit_price`, `control_total_price`), pour EUR, USD et GBP. Statut, TVA, K, rôles, AID, Type et heures atelier ou chantier n'ont pas de cible, comme au profil v1/v2. Choix : l'option 1 de la revue. L'export reste inchangé, et ces saisies sont celles qu'un import v3 de #40 recalcule au moteur 3 aux coefficients de la cible, avec le contrôle D11 au centime : le retour exact des montants v3 se prouve après la fusion (limites). L'option 2 (en-têtes réécrits pour que l'heuristique tombe juste) aurait plié les classeurs à l'heuristique au lieu de déclarer leur sens |
| Mineur, préexistant : les CGV d'une v3 émise imprimée ne viennent pas de la copie vérifiée. La page relit sans vérification la ligne du document, se replie sur le modèle vivant, et laisse la politique courante ou la mise en page demandée forcer `includeTerms` | `91299adf` : hors brouillon, `EstimateV3PrintPage` imprime l'instantané des CGV de la copie vérifiée (`proof.termsSnapshot`, couvert par le sceau), joint si et seulement si la mise en page scellée (`proof.layoutOptions`) les joint, comme le portail. Ni le modèle vivant, ni la politique, ni la case « Joindre les CGV » ne les ajoutent ou ne les retirent. Le brouillon garde l'aperçu demandé ; la branche v1/v2 de `print/page.tsx` est inchangée |
| Mineur : relevé (deux « 13.8 », « à reporter », SHA de voie seuls, §1 incomplet) et description de PR vide | §13.8 fondu en une section, avec la table des têtes de voie et des commits de la PR et les runs en échec de la voie B rendus visibles ; §1 et §2 complétés ; description de PR écrite |

Défaillances écrites avant le code : V3M-17 (en-tête d'`engine-v3-emission.e2e.ts`) et V3X-07 (en-tête
d'`engine-v3-exports.e2e.ts`). V3X-04 est reformulée : le réimport d'une ligne chiffrée doit reprendre exactement ses
saisies, et non plus PU = PT / Q. Parcours :

- **V3M05** : la fenêtre de la fiche propose les CGV de politique « default » du profil calc-v3 (« Projet de CGV -
  Travaux B2B », version 3), que la copie scelle à l'émission. L'impression ouverte sans mise en page (`terms` absent,
  CGV non demandées) doit les garder, comme le PDF stocké.
- **V3M06** : la copie est scellée sans CGV (PDF préparé par l'API sous la mise en page par défaut). L'impression qui
  demande « Joindre les CGV » (`terms=1`) ne doit en ajouter aucune, comme le PDF collecté et le portail.
- **V3X01** gagne P3, la ligne X de V3X02 (2 ml, PR 15,00 €, 1 h/u au rôle « Tuyauteur » 40 €/h → PU 67,50, PT
  135,00 €). Totaux v3 180,50 / 36,10 / 216,60 €. Attendus : correspondance proposée sur les saisies et les contrôles,
  aucune colonne lue en heures de ligne ou en `total_ht`, aperçu « 3 lignes prêtes · 3 refusées », contrôle « Prix
  unitaire de vente » sur 3 lignes avec 3 écarts. Le devis v2 importé (marge 1, K 1) porte P1 20,00, P2 15,00 et P3
  30,00 + 2 h × 40,00 = 110,00 €, soit 145,00 / 29,00 / 174,00 €.

| Commande (WSL, `~/miaouffrage-lot2-27`, Node 24.19.0, `E2E_ARMY_WORKERS=2`, `NODE_OPTIONS=--max-old-space-size=4096`, aucun changement local) | Tête | Résultat |
|---|---|---|
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --grep "^V3M0[56]\s" --app-port 3161` | `484e654f` | rouge, sortie 1. V3M05 : PDF scellé avec CGV (titre et mention), impression sans CGV. V3M06 : PDF et portail sans CGV, impression avec la mention de version des CGV ; son titre n'est pas lu, car l'en-tête de page de l'impression le met en capitales. `.e2e/army/ci/2026-10-18T09-31-31-669Z-calc-v3` (`manifest.json` `f1c1d118…`) ; lecture corrigée en `16dfd6d0` |
| idem | `16dfd6d0` | rouge attendu (V3M-17), sortie 1 : V3M05 `printed` `{ title: false, review: false }` pour `sealed` vrai ; V3M06 `printed` `{ title: true, review: true }` pour `sealed` et `portal` faux. `…/2026-10-18T09-36-01-168Z-calc-v3` (`ebd059d1…`) |
| `npm run e2e:army:local -- --grep "^V3X01 " --app-port 3161` | `16dfd6d0` | rouge (V3X-07), sortie 1. Correspondance proposée : « Prix unitaire HT EUR » sans cible, « h MO / unité » → `labor_hours`, « Total HT brut EUR » → `total_ht`. P3 importée à PU 67,50 € avec 1 h au rôle, soit 175,00 € ; devis 220,50 / 44,10 / 264,60 €. Le contrôle de l'aperçu n'est pas lu : le motif ne laissait qu'un caractère autour du libellé entre guillemets. `.e2e/army/ci/2026-10-18T09-38-18-560Z-critical` (`8d46a15c…`) ; lecture corrigée en `84f9fc8e` |
| idem | `84f9fc8e` | rouge attendu, sortie 1 : même correspondance et mêmes montants, contrôle sur 3 lignes avec 1 écart (P3). `…/2026-10-18T09-45-10-829Z-critical` (`4b09974e…`) |
| `npm run e2e:army:calc-v3 -- --phase emission-v3 --grep "^V3M0[56]\s" --app-port 3161` | `a2423777` | **sortie 0** : 3/3 (setup, V3M05, V3M06). V3M05 : impression et PDF avec les CGV ; V3M06 (`terms=1`) : impression, PDF et portail sans CGV. `…/2026-10-18T09-47-49-331Z-calc-v3` (`1314e5ba…`) |
| `npm run e2e:army:local -- --grep "^V3X01 " --app-port 3161` | `a2423777` | **sortie 0** : 2/2. Correspondance du profil ; aperçu « 3 lignes prêtes · 3 refusées », heures « h/u × Q » (2 h sur P3), contrôle sur 3 lignes avec 3 écarts ; devis importé 145,00 / 29,00 / 174,00 €, P3 à PR 15,00 € et 2 h au rôle. `…/2026-10-18T09-50-19-139Z-critical` (`d1cbd009…`) |

Qualification de la tête de code `a2423777`, la tête suivante n'ajoutant que ce relevé, en série après la garde de
concurrence ; journaux `~/l27-r2-logs/*.log` (tête, état local, commande, sortie, durée murale) :

| Commande | Résultat |
|---|---|
| `npm run e2e:army:local -- --app-port 3161` (sélection critique locale non filtrée) | **sortie 0** en 511 s : 99/99 (les 97 du §13.7 plus V3X01 et V3X02, dont les imports DPGF v1/v2, OPTIMA et CSV, l'impression v1/v2, V3M02, V3FC01, V3FC02 et V3E01 à V3E13 et V3E15). `.e2e/army/ci/2026-10-18T09-52-49-036Z-critical` (`manifest.json` `0fc75aac…`) |
| `npm run e2e:army:calc-v3 -- --app-port 3161` (campagne complète) | **sortie 0** en 807 s, toutes phases en build de production, sources inchangées pendant le run : journeys 11, components 5, numeric 4, resume 5, access 2, offers 10, emission 6 (contrat 1, OF00 à OF0L, 4 PDF reçus), emission-v3 6 (V3M01, V3M03, V3M04, V3M05, V3M06, 6 PDF reçus). `…/2026-10-18T10-01-21-373Z-calc-v3` (`fc7120a2…`) |

Windows, même tête, aucun changement local hors ce relevé : `npm run typecheck`, `npx eslint --max-warnings=0` des
quatre fichiers touchés et `npx vitest run` de `army-impact-map`, `ci-guardrails`, `dpgf-export`, `mappings/server`,
`mappings/schemas`, `imports/server`, `affaires/import-flow`, `_actions/import-flow`, `EstimateDocument` et
`offer-commercial-render` (10 fichiers, 189 passés) : sortie 0. `git -c core.whitespace=cr-at-eol diff --check
8dd28c91...HEAD` : sortie 0.

**Recette de la fusion de `main` (`3af6804c`)**, à appliquer une fois l'ordre de M5 décidé.
`git merge-tree --write-tree --name-only HEAD origin/main` liste quatre conflits :

- `supabase/migrations.manifest.json` : l'entrée de M5 face à celles de M6 (`20261017225906`) et M6b
  (`20261018013249`). C'est la décision d'ordre en attente, hors de cette recette.
- `scripts/tester-army/army-impact-map.json` : union. `engine-v3-exports.e2e.ts` (cette branche) et
  `engine-v3-import-optima.e2e.ts` (#40) vont dans `affaire-hub`. `engine-v3-emission.e2e.ts` reste au groupe `print`,
  à côté des nouveaux groupes de #42 (`takeoff-hub`, `takeoff-affaire-takeoff`, `takeoff-wizard`).
- `e2e/army/local/engine-v3-editor-actions.e2e.ts` : garder `DETAIL_TEMPLATE_REASON` et `DETAIL_ACTIONS_REASON_2_6`
  (lus par V3E11). Retirer `PASTE_REFUSAL`, que #40 n'emploie plus, et le `DETAIL_ACTIONS_REASON` de `main`, qui n'est
  plus lu.
- `docs/testing/tester-army-calc-v3.md` : garder la section « CI nocturne » de #42 à côté de la ligne V3M06. Réécrire sa
  limite « La CI nocturne ne lance pas l'émission tant que le sous-lot 2.7… » : l'émission tourne désormais chaque
  nuit. Garder le texte de cette branche sur la sonde du garde réseau.

À la même fusion, dans `.github/workflows/e2e-army-calc-v3.yml` : ajouter `emission-v3` aux options de `phase`,
ajouter `emission emission-v3` à `CALC_V3_NIGHTLY_PHASES`, et réécrire le commentaire d'en-tête qui exclut l'émission.
Preuve sur un arbre jetable (worktree détaché de `16dfd6d0` dans le répertoire de la session, fusion de `3af6804c` sans
commit, conflits résolus comme ci-dessus, manifeste des migrations laissé hors de l'essai ; worktree supprimé ensuite) :
`npx vitest run --project=node src/test/ci-guardrails.test.ts src/test/army-impact-map.test.ts`. Avant l'édition du
workflow : sortie 1, `ci-guardrails.test.ts:684` reçoit les options sans `emission-v3`. Après : sortie 0, 33/33. Le
diff exact est gardé avec les journaux de la session. Modifier ce workflow fait jouer à la PR sa sélection `nightly`
calc-v3, qui couvre alors V3M05 et V3M06 en CI : ce run entre dans la qualification d'après fusion. Celle-ci rejoue
tout, car #40 change l'éditeur, les chemins d'entrée et le flux d'import dont dépend V3X01 : campagne critique locale
non filtrée, campagne calc-v3 complète, `db:ci:local` et `db:upgrade-check` (M5 après M6 et M6b ou non, selon la
décision).

Limites :

- Vers une cible v2, seule cible d'import sur cette branche (les imports v3 relèvent de 2.8, #40), le réimport reprend
  les saisies et la v2 les recalcule sans coefficients de vente : 145,00 € au lieu des 180,50 € de la v3. L'aperçu
  signale l'écart de PU de chaque ligne chiffrée. Le retour exact des montants v3 suppose une cible v3 aux mêmes
  coefficients. Après la fusion de #40, V3X01 doit l'ajouter : même DPGF réimporté dans une v3, montants exacts,
  contrôle D11 au centime.
- Les heures atelier et chantier, K FO et K MO ne sont pas réimportés, comme au profil v1/v2.
- Un modèle ou une mémoire de correspondance qui contredit le profil n'est pas appliqué d'office : c'est la règle de 2.3,
  inchangée.
- La case « Joindre les CGV » de la fenêtre de mise en page reste proposée sur l'impression d'une v3 émise, sans effet.
- Le retrait des CGV scellées est prouvé avec les CGV bac à sable. Le cas « modèle supprimé » ne se reproduit pas dans le
  profil calc-v3, où le modèle bac à sable remplace une ligne absente ; une copie émise ne lit plus aucun modèle.
- Les limites du §13.8 restent : impression v1/v2 émise avec le profil du lecteur, PDF relu et haché deux fois, avis
  d'une v3 en `sending`, avis d'une copie invérifiable sans parcours, V3M05 et V3M06 hors de la sélection d'impact des
  PR (jusqu'à l'édition du workflow à la fusion).
- Aucune relecture indépendante de ce traitement.
