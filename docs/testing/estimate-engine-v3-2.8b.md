# Copies vers une v3 (sous-lot 2.8b)

Statut : **vert** (18/10/2026). Branche `lot2/2.8b-copies-into-v3`, empilée sur `lot2/2.10a-createurs-v3`
(`216ac4d0`, outil commun de normalisation des imports dans `src/lib/affaires/`). Source : plan vers 2.10 (§3
« 2.8b », décisions D-b et D-e du 18/10/2026), inventaire des écarts v3 (A5 à A8). Aucune migration ;
`src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` inchangés.

## 1. Défaillances observables (écrites avant le code)

| # | Défaillance | Parcours |
|---|---|---|
| C1 | « Importer le DPGF source » sur un brouillon v3 : insertion directe, refusée par le garde SQL (400 générique) | IO10 |
| C2 | Une fois ouvert, DPGF normalisé en v2 (unité dans `description`, statut chiffré) ou aux coefficients de la politique au lieu de ceux du brouillon ; provenance perdue | IO10 |
| C3 | Dupliquer une section d'une v3, sur place ou vers une autre v3 : 409 `ESTIMATE_ENGINE_UNAVAILABLE` | IO11 |
| C4 | Copie qui perd `unit_code`, le statut ou les h/u, multiplie les heures par Q deux fois | IO07, IO11 |
| C5 | Section v1/v2 entrée dans une v3 sans la règle P-12 ni rapport ; section v3 entrée dans une v1/v2 (D-e) | IO07 |
| C6 | Conversion ligne ↔ section proposée sur une v3, puis message générique (D-b) | IO12 |
| C7 | Copie v1/v2 → v1/v2 dont les montants changent | IO11 (garde) |
| C8 | Copie de plus de 1 000 éléments écrite en partie, ou en plusieurs lots | IO13 |

## 2. Rouges conservés

- `0a8da704` (IO07 réécrit, IO10, IO11, IO12), boucle Army `2026-10-18T13-00-21-058Z-dev-loop`, itération 1,
  4 échecs pour la bonne raison : IO07 et IO11 en 409 `ESTIMATE_ENGINE_UNAVAILABLE`, IO10 en 400 `BAD_REQUEST`,
  IO12 en 400 `BAD_REQUEST` avec les menus actifs et sans motif.
- IO13, ajouté en phase verte : itération 2 de `2026-10-18T14-41-57-323Z-dev-loop`, rouge sur le code de copie
  sans lecture paginée. La copie de 1 001 éléments répond 201 et écrit une partie de la section : la lecture
  PostgREST s'arrête à `max_rows = 1000`. C'est la défaillance C8, trouvée par ce parcours.
- Correction d'un défaut du parcours rouge : IO10 lisait `createdSectionId`, alors que l'API rend
  `created_section_id` (snake_case, comme toutes ses routes).

## 3. Correction

- **Écriture.** Une copie vers une v3 passe par l'écrivain de lot v3. `v3-section-copy.ts` construit les
  opérations, puis `executeEstimateBatch` / `commit_estimate_batch` les écrit en un seul lot, avec le jeton lu
  au départ et le verrou de la page. Les identités créées sont passées par `createdIds`, déjà acceptées par la
  préparation. Au-delà de 1 000 opérations ou de 1 Mio : refus 413 `ESTIMATE_V3_COPY_TOO_LARGE` avant toute
  écriture, qui renvoie vers l'import de l'affaire. Une opération refusée par l'écrivain est rendue avec son
  code et l'élément nommé (rôle MO d'un autre propriétaire, unité inconnue, profondeur, position).
- **Lecture complète.** Vers une v3, les lignes de la source et de la cible (`readAllEstimateItems`) et les lignes
  du DPGF lié sont lues par pages. Les lectures v1/v2 sont inchangées (§5).
- **A5.** Lignes normalisées par `normalizeMappedRowsForEstimateCreation` avec `engine: 3` et les coefficients du
  brouillon : unité du référentiel, statut à 0 €. Les paramètres du classeur imposent l'aperçu de l'affaire, refus
  nommé existant. La provenance est gardée : `source_provider = dpgf`, `source_file_name`, `source_page`.
- **A6, A7.**
  - v3 → v3 : saisies v3 copiées ; `source_job_id` gardé seulement dans la même version.
  - v1/v2 → v3 : `templateLineHoursPerUnitForV3` (P-12, miroir de M6), unité par le référentiel sur
    `description`, rapport `converted_lines`. Q = 0 avec des heures : refus qui nomme la ligne.
  - v3 → v1/v2 : 409 `ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL`, avant toute écriture (D-e).
- **A8.** `PATCH /items` qui change `item_type` sur une v3 : 409 `ESTIMATE_V3_ITEM_CONVERSION_UNAVAILABLE`.
  Dans l'éditeur v3, les trois entrées « Convertir » sont désactivées avec ce motif : le menu de ligne, le menu
  contextuel de ligne et le menu de section.
- OpenAPI : descriptions des quatre routes, `openapi.json` régénéré.

## 4. Preuves

| Contrôle | Résultat |
|---|---|
| Boucle Army, itération 3, `^(IO(0[0-9]\|1[0-3]) \|V3E13 \|OPTIMA )` | 16/16 verts (IO01, IO03 à IO13, V3E13, 3 OPTIMA v2) ; IO13 avec sa limite : itération 4 |
| IO10 (interface) | « 4 lignes importées » ; tube 15 000, collier 1 500, PM et HL à 0 ; PU 1 500 / 500 à 1,25 ; total 16 500 (API = SQL) ; provenance lignes 1 à 4 |
| IO07 | v2 → v3 : tube 0,5 h/u, collier 0,0003 h/u (1 h → 0,9 h listé), tube 37,00 € × 10 ; v3 → v3 identique ; v3 → v2 refusé deux fois, rien d'écrit |
| IO11 (sur place par l'interface, vers une v3 par l'API) | sous-arbre identique, 5 éléments, total doublé (API = SQL) ; garde v2 → v2 : mêmes montants, aucun rapport |
| IO12 | 409 nommé deux fois ; menus `aria-disabled` avec le motif ; rien d'écrit |
| IO13 | 1 001 éléments : 413 `ESTIMATE_V3_COPY_TOO_LARGE`, message vers l'affaire, rien d'écrit ; à la limite (1 section + 999 lignes = 1 000 opérations) : 201, 999 lignes à 1,30 €, total 129 870 (API = SQL) |
| Run qualifiant et `verify:pr` | voir la description de la PR |

## 5. Limites

- Les lectures v1/v2 non paginées restent telles quelles (comportement v1/v2 identique). Une copie v1/v2 → v1/v2
  ou un DPGF lié importé dans une v2 tronquent en silence au-delà de 1 000 lignes. Ce défaut existait avant ce
  lot et sort de son périmètre.
- La copie vers une autre version et l'import de sections sont prouvés par l'API. Leurs dialogues appellent les
  mêmes routes, mais aucun parcours ne les pilote.
- Ne sont pas couverts par un parcours : rôle MO d'un autre propriétaire, profondeur dépassée, jeton périmé et
  cible verrouillée par un autre utilisateur. Ces refus nommés viennent de la préparation du lot et du verrou,
  déjà prouvés au 2.5.
- La conversion ligne ↔ section par l'écrivain de lot reste à faire (D-b).
- Le reçu de l'écrivain de lot est borné à 2 Mio (`ESTIMATE_BATCH_MAX_RECEIPT_BYTES`, contrat du 2.5). IO13 passe
  à 1 000 opérations avec des libellés de 55 caractères. Avec des libellés beaucoup plus longs, une copie à la
  limite pourrait dépasser ce reçu après l'écriture : l'issue serait alors rendue « inconnue » et la page
  rechargerait.
