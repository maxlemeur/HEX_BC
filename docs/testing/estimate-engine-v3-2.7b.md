# Lot 2, sous-lot 2.7b : exports CSV et BDC V1.1 d'une v3 (A9, A10, A11)

Décision D-a du 18/10/2026 (plan vers la bascule 2.10, M8 approuvée) : le CSV de l'éditeur et le BDC V1.1 d'une
v3 sont livrés avant M8. Branche `lot2/2.7b-exports-csv-bdc-v3`, empilée sur la PR #45 (sous-lot 2.7, base locale
`039ca113`, puis fusion de sa tête locale `58b1c93f` en `f1615b0f`) ; elle fusionne après elle. Aucune migration. Parcours : `e2e/army/local/engine-v3-exports.e2e.ts`
(V3X03 à V3X06) et V3E15 (`engine-v3-editor-actions.e2e.ts`).

## Défaillances observables (écrites avant le code)

- V3X-08 : « Exporter CSV » et « Exporter BDC V1.1 » fermés dans l'éditeur d'une v3 (menu compact et « Plus
  d'actions ») ; « Exporter le BDC » du hub reçoit 409 `ESTIMATE_ENGINE_UNAVAILABLE`.
- V3X-09 : CSV d'une v3 construit dans le navigateur (`editor-export.ts`) : totaux du client nuls, unité lue dans
  `description`, PU et total recalculés ou absents.
- V3X-10 : v3 lue par le moteur v1/v2 du BDC (`computeEstimateLineValues`) ou par le garde du gel v2 (D12).
- V3X-11 : unité tirée de `description` au lieu de `unit_code` ; heures par unité perdues.
- V3X-12 : ligne non chiffrée (incluse, hors lot, pour mémoire) exportée avec un prix, des heures ou un PU.
- V3X-13 : colonnes V1.1 déplacées ou renommées (feuilles en aval cassées).
- V3X-14 : remise comptée deux fois ou oubliée ; brouillon modifié depuis son gel présenté comme figé.
- V3X-15 : prix fournisseur d'une offre convertie (2.9, barre de 3 ml) non ramené à l'unité de la ligne.
- V3X-16 : régression v1/v2 du CSV de l'éditeur ou du BDC (garde V3X06, verte avant).

## Rouges

| Itération (boucle de développement, non qualifiante) | Source / build | Résultat |
|---|---|---|
| 2 | `a8b50144` / `g3efkLl_6ZsJylPvunjZ9` | 5 échecs sur 6 : V3E15 (CSV et BDC fermés), V3X03 (bouton CSV fermé), V3X04 (route 409 `ESTIMATE_ENGINE_UNAVAILABLE`), V3X05 (hub : 409 et « Ce devis utilise le moteur de calcul 3… »), V3X06 |
| 3 | `6b7bfc8b` / même build | V3X06 vert sur le code inchangé, les quatre rouges inchangés |

V3X06 échouait par un défaut du test : le BDC V1.1 écrit une cellule texte vide `""` (relue `""`, pas `null`) et
indente de deux espaces une ligne sous sa section. `6b7bfc8b` corrige les seules attentes (V3X06 épingle ces
valeurs actuelles ; V3X04 et V3X05 suivent la même convention). Preuves : `.e2e/army/ci/2026-10-18T14-36-25-985Z-dev-loop/iterations/00{2,3}-*`
du clone WSL `~/miaouffrage-l2-27b`.

## Correctif

- Route `GET /api/estimates/{id}/export` : `format=csv` (mode standard seulement) écrit par le serveur
  (`src/lib/estimates/v3-csv-export.ts`) depuis `loadEstimateV3ExportDocument`, après le contrôle d'accès de
  `getEstimateVersionDetails`. Une v1/v2 reçoit 409 `ESTIMATE_CSV_EXPORT_V3_ONLY` : son CSV reste construit par
  l'éditeur, sans changement.
- CSV v3 : même écriture que le CSV v1/v2 (SheetJS, « ; », BOM UTF-8). Colonnes : Chemin chapitre, Poste,
  Désignation, Unité (`unit_code`), Quantité, Statut, Prix unitaire HT (PR FO saisi), Type FO, Fournisseurs 1 à 3
  (prix ramené à l'unité de la ligne), K FO, h MO / unité, Majoration MO (%), Rôle MO, K MO, PU HT, Total HT
  (brut de ligne), TVA (%). Une ligne non chiffrée porte son libellé de statut au lieu du prix et du total, sans
  heures, majoration ni PU. Pied : « Moteur de calcul », « Montants » (gel ou aperçu non figé), puis le pied du
  document (brut, remise, arrondi, HT net, TVA par taux, TTC).
- BDC V1.1 (`bdc-export.ts`) : branche v3 placée avant `shouldPreserveStoredEstimateV2Snapshot` et
  `computeEstimateLineValues`, qui ne lisent plus jamais une v3. Les 31 colonnes V1.1 restent dans leur ordre ;
  trois colonnes v3 suivent « Ref interne » : Statut, h MO / unité, PU vente HT. Valeurs : PU FO et PR FO = PR FO
  saisi, K FO et K MO saisis, Total FO / MO / HT = bruts du document (MO = brut − FO), « h MO » et « Taux horaire
  MO » vides. Ligne non chiffrée : 0 € et son libellé, sans prix ni heures. Feuille « Resume » : moteur, source
  des montants, coefficients de vente et pied du document. Montants au format de la devise ; notes « Formule
  indicative » remplacées par la provenance du document.
- Éditeur : `useEstimateEditorExportController` envoie le CSV d'une v3 à la route (`exportEstimate(…, "csv")`) ;
  son drapeau suit alors celui du streaming, comme Excel et DPGF depuis #45. Le BDC suit le drapeau du streaming.
  Le hub passe par la même route, sans modification.
- OpenAPI : `format` accepte `csv`, réponse `text/csv` ; `openapi.json` régénéré.

## Preuves

| Commande | Source | Résultat | Artefact |
|---|---|---|---|
| `e2e:army:dev-loop -- run --grep 'V3X0[3-6]\|V3E15'` (itération 4, non qualifiante) | `6b7bfc8b` + correctif non commité, build `Z00dtkBG4m0geJYPj3bnb` | 6/6 | `iterations/004-2026-10-18T14-48-20-088Z/manifest.json` |
| `e2e:army:dev-loop -- run --grep 'V3X0\|V3E1\|BDC download'` (itération 5, non qualifiante) | idem, en-tête V1.1 factorisé, build `ES1OHA-V3J7rCddJEjdDS` | 14/14 (setup, V3X01 à V3X06, V3E10 à V3E15, « BDC download » d'`estimate-integrity`) | `iterations/005-2026-10-18T14-50-28-294Z/manifest.json` |
| `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep 'V3X0\|V3E1\|BDC download' --app-port 3181`, pile possédée neuve (qualifiant) | `f1615b0f`, arbre propre | 14/14, 0 échec, 0 reprise, 0 skip ; pgTAP et matrice RLS passés | `.e2e/army/ci/2026-10-18T14-52-58-682Z-critical` |
| `npm run verify:pr` (WSL, Node 24) | `f1615b0f`, arbre propre | exit 0 en 129 s : Vitest node 306 fichiers / 3 281 tests, jsdom 165 / 831, couverture critique 3 / 12 | `/tmp/l27b-verify.log` du clone WSL `~/miaouffrage-l2-27b` |
| `supabase:migrations:git-guard -- --mode pull_request` | `f1615b0f` | passé (2 changements, dont M5 de #45 ; aucune migration propre à 2.7b) | — |

## Limites

- Une v3 hors EUR garde les en-têtes V1.1 « EUR » (comme une v1/v2) ; les cellules portent le format de sa devise
  et les en-têtes v3 et CSV son code. Aucun parcours n'exporte une v3 en USD ou GBP.
- « PR FO HT EUR » d'une v3 est le PR FO saisi : FO_u = PR FO × K FO n'est pas recalculé (D12) ; avec K FO ≠ 1,
  une feuille en aval applique K FO elle-même.
- Ventilation atelier/chantier d'une v3 (rôles « Atelier : … / Chantier : … », h/u additionnées) : non couverte
  par un parcours.
- V3X06 compare les valeurs, pas les octets (identifiants et dates varient d'un run à l'autre).
- `engine:document-fingerprints check` n'a pas été relancé : `export-stream.ts` et `dpgf-export.ts` (XLSX v1/v2
  qu'il couvre) ne changent pas ; le BDC v1/v2 est couvert par V3X06 et « BDC download ». `purchase-decimals`
  (CSV des commandes, `ExportDropdown` inchangé) est en phase full et n'a pas été relancé.
- Comme Excel, le CSV d'une v3 passe par la route et son contrôle de rôle (admin, engineer).
- Seul l'aperçu d'un brouillon (« Aperçu du brouillon (non figé) ») est exercé ; le libellé « Gel du devis » vient
  du même `amountsSourceLabel` que l'export standard du 2.7.
