# Tests isolés du 2.7

Sous-lot 2.7 (document client, contrat client 2, charge de calcul 6, émission v3). Section destinée à être
fondue dans `estimate-engine-v3-2.7.md` à l'implémentation. Rouge écrit **avant tout code de production** le
17/10/2026, branche `lot2/2.7-document-emission-v3`, base `c14b243d` (pointe de 2.5). Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), F1 à F3, D7, D8, D14,
D15, §4, §5, §8.1, §8.2, §14 « 2.7 ». Là où ce document **choisit** (signalé « Choix »), il fixe le contrat que
le rouge exige ; ailleurs, la conception fait foi.

## Justification de l'isolation

Le parcours `engine-v3-emission.e2e.ts` prouve l'émission de bout en bout sur S2 et S5 (texte du PDF, sceau,
portail, exports). Il ne peut pas :

- fabriquer une copie commerciale v3 altérée d'un centime, d'une clé ou d'un type : l'application n'écrit que
  des copies cohérentes, seul le parseur strict les refuse avant le sceau ;
- énumérer chaque champ de la charge 6 : un champ oublié rend un devis émis modifiable sans que son sceau change ;
- rejouer 3 600 charges historiques (600 devis du corpus figé × charges 1 à 4) pour prouver qu'aucun octet ne
  bouge, ce dont dépend la vérification des documents déjà émis ;
- prouver que le tableau de TVA imprimé vient du contexte figé et non d'un recalcul, ni qu'un gel incohérent
  est refusé au lieu d'être imprimé.

## Fichiers

| Fichier | Cible (absente ou incomplète à `c14b243d`) |
|---|---|
| `src/lib/estimates/offer-contract-v2.test.ts` | `offer-contract-v2.ts` (nouveau), `parseOfferDocumentProof` (`offer-contract.ts`) |
| `src/lib/estimates/estimate-seal.v3.test.ts` | `estimate-seal.ts` (charge 6), `offer-contract-v2.ts` (sceau d'offre au marqueur 5) |
| `src/lib/estimates/prepare-estimate-document-data.v3.test.ts` | branche v3 de `prepareEstimateDocumentData` |

Les modules absents sont chargés par une variable (`import(/* @vite-ignore */ MODULE)`) et leurs types sont
recopiés dans le test : le build de production, qui vérifie aussi les tests, reste vert, et chaque cas échoue
seul (`beforeEach`, jamais « ignoré ») sur le contrat absent. L'implémentation remplace les copies de types par
les imports réels.

## Défaillances visées

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

## Contrat attendu

### `src/lib/estimates/offer-contract-v2.ts` (nouveau)

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

### `src/lib/estimates/offer-contract.ts`

`parseOfferDocumentProof` accepte `clientContractVersion: 2` avec une copie analysée par
`parseClientContract2Snapshot`, mêmes ancres et mêmes règles qu'au marqueur 1 (publication non `legacy`,
chemin canonique, version, entreprise, affaire, révision, auteur = `issuer.userId`, envoi ⇔ `publishedDispatchId`,
`fo_mo_and_total` ⇔ parts FO/MO). Contrat 1 sous marqueur 2 et contrat 2 sous marqueur 1 : refusés.
`parseClientContractSnapshot` et `computeOfferSealHash` (contrat 1) ne changent pas.

### `src/lib/estimates/estimate-seal.ts`

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

### `prepareEstimateDocumentData` (branche v3)

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

### Tests existants à réaligner à l'implémentation

Ils figent le refus de 2.1, que 2.7 lève volontairement : `estimate-seal.test.ts` (« refuses to seal a v3 until
the v3 seal payload exists » : sans option, une v3 donne désormais la charge 6 ; le refus en charge 4 reste),
`pdf-generator.test.ts:1035-1040` et `send-estimate.test.ts:269-273` (`ESTIMATE_ENGINE_UNAVAILABLE` sur une v3).

## Valeurs figées (`c14b243d`)

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

## Preuve rouge (17/10/2026)

Windows, worktree `miaouffrage-l2-27`, base `c14b243d`, seuls changements locaux : les trois tests et ce document.

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
`offer-contract-v2.ts`, la charge 6 et la branche v3 du préparateur, et les trois tests de 2.1 ci-dessus réalignés.
