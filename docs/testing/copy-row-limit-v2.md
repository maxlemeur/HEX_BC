# Copies v1/v2 au-delà de la limite de lignes de l'API

Défaut antérieur au lot 2, relevé pendant le sous-lot 2.8b (branche `lot2/2.8b-copies-into-v3`, PR #59).
PostgREST renvoie au plus 1 000 lignes par requête (`supabase/config.toml`, `[api] max_rows = 1000`).
Plusieurs lectures de `src/lib/estimates/server.ts` ne sont pas paginées : sur une version v1/v2,
elles tronquent la copie en silence et l'API répond 201. Le 2.8b ne pagine ces lectures que vers une
v3 (`readAllItemsForV3Copy`, `paginate: true`) ; son parcours IO13 y montre la troncature. Ce
document couvre les chemins v1/v2. Entre-temps, `33c7031b` a corrigé sur `main` la lecture des lignes
DPGF mappées (`readAllRows`, P1 · 01 de `docs/audits/postgrest-1000-rows-2026-10-18.md`) ; cet audit
écarte explicitement les copies de sections v1/v2, que couvre ce document.

## Ce que tronque la lecture

Les lectures des lignes d'une version sont triées par position puis `created_at`, toutes sections
confondues : la limite coupe les positions hautes de **chaque** section dès que la version dépasse
1 000 éléments, pas seulement une section de plus de 1 000 lignes. Exemple retenu par le parcours :
99 sections de 12 lignes (1 287 éléments) ; les 1 000 premiers éléments lus s'arrêtent exactement à la
position 10, donc les sections 11 à 99 et les lignes 11 et 12 des sections 1 à 10 manquent. Les copies
restent petites (13 éléments) : chaque élément inséré déclenche les effets par élément (voir Limites
et Exécutions, run 3).

## Défaillances observables (écrites avant le code)

| Id | Chemin | Lecture tronquée | Défaillance sur `main` `6260621c` (RL4 et RL5 corrigés depuis par `33c7031b`) |
| --- | --- | --- | --- |
| RL1 | Dupliquer sur place la première section (`POST /api/estimates/{v}/sections/{s}/duplicate`) | `duplicateSectionInternal`, lignes de la version source | 10 lignes copiées sur 12, 201 |
| RL2 | Liste des sections de la boîte d'import (`GET /api/estimates/{v}/sections`), puis import de la première dans une autre v2 (`POST …/import-sections`, `append`) | `listEstimateImportSections` ; `importSectionsFromVersion`, lignes source | 10 sections proposées sur 99, à 10 lignes chacune, puis 10 lignes importées, 201 |
| RL3 | Fusion (`merge`) d'une section dans la première section de la grande version (même titre) | `importSectionsFromVersion`, lignes cibles | Positions 11 et 12 allouées alors qu'elles existent : refus par `estimate_items_child_position_unique`, 409 |
| RL4 | DPGF lié de 1 001 lignes mappées (995 lignes vides, puis 6 lignes chiffrées) importé dans un brouillon v2 (`POST …/import-linked-dpgf`) | `loadMappedRowsForImport` (`dpgf_rows_mapped`) | 5 lignes importées sur 6, 201 |
| RL5 | v2 créée depuis un DPGF lié de 1 001 lignes chiffrées (`POST /api/estimates`, `linked_dpgf_source`) | `loadMappedRowsForImport` | 1 000 lignes, 201 |

Les montants v1/v2 ne changent pas : la copie reprend les colonnes de la ligne source et le recalcul
des totaux (`recalculateEstimateVersionTotals`) lisait déjà toutes les lignes par pages.
`src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` ne sont pas modifiés.

## Parcours

`e2e/army/local/estimate-copy-row-limit.e2e.ts` (RL01 à RL05), sur la pile locale possédée : un
brouillon v2 neutre (marge fixe ×1, TVA 20 %, sans remise ni arrondi) par affaire, contenu volumineux
inséré en SQL. La ligne g d'une section (ou la ligne g d'un DPGF) vaut 1 u à 5·g centimes, sans
heures : 5·g HT, g de TVA, 6·g TTC. Une section de 12 lignes fait 390 HT, 78 de TVA, 468 TTC ; la
grande version 38 610 HT. Chaque copie est comparée à SQL : nombre de lignes, positions, empreinte
md5 du contenu des lignes (position, titre, quantité, prix, totaux), totaux enregistrés de la version et
sommes des totaux de lignes ; RL1 et RL2 comparent aussi les totaux relus par l'éditeur. La durée de
chaque amorçage SQL et de chaque requête est enregistrée, sans assertion.

Exécution (clone Linux sous WSL, pile native possédée) :

```bash
npm run e2e:army:local -- --grep 'RL0' --app-port 3173
```

Le parcours n'a pas encore de durée mesurée dans `scripts/tester-army/army-shards.json` (moyennes
de runs CI) : il compte `defaultSeconds` jusqu'à sa première mesure en CI.

## Correctif

Les lectures réutilisent les lecteurs complets existants, sans nouvelle abstraction :

- `readAllEstimateItems` (`src/lib/estimates/read-all-items-server.ts`, celui du recalcul et de la
  lecture de l'éditeur) pour la liste `listEstimateImportSections` et, par `readAllItemsForCopy`, pour
  les lignes source de `duplicateSectionInternal` et les lignes source et cible de
  `importSectionsFromVersion` : pages de 500, nombre exact vérifié à chaque page. `readAllItemsForCopy`
  (ex-`readAllItemsForV3Copy` du 2.8b, désormais pour tous les moteurs) relit ensuite la version
  (`assertEstimateVersionUnchanged`) : une modification entre deux pages, même à nombre égal, est
  refusée en 409 `VERSION_CONFLICT` avant toute écriture (revue Codex de la PR #70, P2) ;
- `dpgf_rows_mapped` : le run 7 a été qualifié avec `fetchMappedRowsForImport`
  (`src/lib/affaires/import-flow-server.ts`) à la place de `loadMappedRowsForImport`. À la fusion de
  `main`, cette branche reprend le lecteur de `33c7031b` (`loadMappedRowsForImport` sur `readAllRows`,
  erreurs SQL rendues par `mapSupabaseError`) ; RL4 et RL5 restent les parcours de ce lecteur pour ses
  deux appelants (import dans un brouillon, création depuis le DPGF lié).

L'ordre de lecture passe de (position, created_at) à (position, id). Les index uniques
`estimate_items_root_position_unique` et `estimate_items_child_position_unique` interdisent deux
frères à la même position : l'arbre copié, ses positions et l'ordre des lignes fusionnées ne changent
pas.

Fusion de `main` après le 2.8b (PR #59, `8f7183ab`) : le conflit de `server.ts` se résout en lisant
toutes les lignes pour tous les moteurs ; seules ces trois lectures diffèrent de `main`.

Régression isolée `src/lib/estimates/server.copy-source.test.ts` (exception à la règle E2E d'abord) :
un parcours ne peut pas placer une modification entre deux requêtes de pages d'un même appel d'API.
Ses doubles le font pour trois cas (source d'une duplication, source puis cible d'un import, chacune
de 601 éléments modifiée après sa première page) : rouge sur `2b49f493` (la copie passe ses lectures et
insère), vert avec l'épinglage (409 `VERSION_CONFLICT`, aucune insertion).

## Exécutions

| # | Source | Commande | Résultat | Preuves (clone WSL `~/miaouffrage-rowlimit`) |
| --- | --- | --- | --- | --- |
| 1 | `main` `6260621c` + parcours de première forme (sections de 1 001 lignes), sans correctif | `npm run e2e:army:local -- --grep 'RL0' --app-port 3173` | Rouge, 4/4 échecs. Troncature visible : liste à 999 lignes (2 497 500 HT au lieu de 2 507 505), fusion refusée en 409 (`23505` sur `estimate_items_child_position_unique`), v2 créée depuis le DPGF à 1 000 lignes en 589 ms. Mais duplication, import de sections et import du DPGF dans un brouillon répondent 400 après ~8,2 s : `57014 canceling statement due to statement timeout` sur l'insertion d'environ 1 000 lignes | `.e2e/army/ci/2026-10-18T15-52-38-878Z-critical` ; `.e2e/army/critical/artifacts/business/ARMY-1792338903785-44d4852e-*`, `ARMY-1792338914834-6116a7a5-*`, `ARMY-1792338925513-455a4f42-*`, `ARMY-1792338927398-e96bee2c-*` |
| 2 | `main` `6260621c` + parcours repris, grande version de 25 sections de 44 lignes (`sha256` `b93e33d6…`), sans correctif | idem | Rouge, 5/5 échecs, chacun pour la raison attendue : RL1 201 avec 39 lignes sur 44 (127 650 HT au lieu de 128 700) ; RL2 sections proposées à 39 lignes (3 900 HT), 39 lignes importées, 201 ; RL3 409 `CONFLICT` (`23505`) ; RL4 201 avec 5 lignes sur 6, 995 ignorées (24 950 HT au lieu de 29 955) ; RL5 201 avec 1 000 lignes sur 1 001 (2 502 500 HT) | `.e2e/army/ci/2026-10-18T16-10-37-274Z-critical` ; `ARMY-1792339941551-8a456bec-*`, `ARMY-1792339946205-0a3564c4-*`, `ARMY-1792339948382-21e47add-*`, `ARMY-1792339950196-25f3493a-*`, `ARMY-1792339951001-117505f4-*` |
| 3 | idem + correctif (`server.ts` `sha256` `c5200b9d…`) | idem | Vert, 5/5 en 11,97 s, valeurs exactes (RL1 44 lignes, 128 700 HT ; RL3 lignes aux positions 45 et 46). Durées : import de 44 lignes dans une v2 vide 554 ms, fusion de 2 lignes dans la grande version 768 ms, duplication de 44 lignes dans la grande version 2 541 ms, soit ~40 ms par élément inséré dans une version de 1 125 éléments. Trop près des 8 s sous la charge CI : taille ramenée à 99 × 12 (copies de 13 éléments), runs 4 et 5 | `.e2e/army/ci/2026-10-18T16-13-32-295Z-critical` ; `ARMY-1792340100814-53ed629a-*` à `ARMY-1792340111731-585c3c99-*` |
| 4 | `main` `6260621c` + parcours final, grande version de 99 sections de 12 lignes (`sha256` `c3d31d8d…`), sans correctif | idem | Rouge, 5/5 échecs, chacun pour la raison attendue : RL1 201 avec 10 lignes sur 12 (38 885 HT au lieu de 39 000) ; RL2 10 sections proposées sur 99, à 10 lignes (275 HT), 10 lignes importées, 201 ; RL3 409 `CONFLICT` (`23505`) ; RL4 201 avec 5 lignes sur 6 ; RL5 201 avec 1 000 lignes sur 1 001 | `.e2e/army/ci/2026-10-18T16-16-34-620Z-critical` ; `ARMY-1792340269650-359cf2f5-*`, `ARMY-1792340273531-9e8021b7-*`, `ARMY-1792340275790-b14101d1-*`, `ARMY-1792340277743-e55994ed-*`, `ARMY-1792340278513-5e42fd25-*` |
| 5 | idem run 4 + correctif (`server.ts` `sha256` `c5200b9d…`) | idem | Vert, 5/5 en 11,89 s, valeurs exactes : RL1 12 lignes sur 12, empreinte égale à la source, 39 000 / 7 800 / 46 800 enregistrés, relus et sommés en SQL ; RL2 99 sections proposées à 12 lignes (390 HT), 12 lignes importées (390 / 78 / 468) ; RL3 lignes fusionnées aux positions 13 et 14, 38 625 HT ; RL4 6 lignes, 995 ignorées, 29 955 HT ; RL5 1 001 lignes, 2 507 505 HT. Durées : RL1 1 472 ms, RL2 400 ms (liste) et 489 ms (import), RL3 1 165 ms, RL4 335 ms, RL5 655 ms | `.e2e/army/ci/2026-10-18T16-18-26-898Z-critical` ; `ARMY-1792340387830-bba31318-*`, `ARMY-1792340392066-e5573ba5-*`, `ARMY-1792340394788-120405c0-*`, `ARMY-1792340397668-6c988c43-*`, `ARMY-1792340398574-4db83cc0-*` |
| 6 | `main` `6260621c` + parcours final, durées d'amorçage enregistrées (`sha256` `82cafe5b…`), sans correctif | idem | Rouge, 5/5 échecs, mêmes valeurs que le run 4. Amorçages : 1 135 à 1 196 ms par grande version, 44 à 45 ms par DPGF | `.e2e/army/ci/2026-10-18T16-26-43-731Z-critical` ; `ARMY-1792340902167-86908eef-*`, `ARMY-1792340907268-868cd16d-*`, `ARMY-1792340909790-0023d686-*`, `ARMY-1792340912029-7d813094-*`, `ARMY-1792340913006-4f2ac6d5-*` |
| 7 | idem run 6 + correctif (`server.ts` `sha256` `c5200b9d…`) | idem | **Vert, 5/5**, mêmes valeurs exactes que le run 5. Durées : RL1 amorçage 1 068 ms, duplication 1 489 ms ; RL2 1 398 / 509 (liste) / 552 ms (import) ; RL3 1 268 / 914 ms ; RL4 53 / 526 ms ; RL5 47 / 761 ms | `.e2e/army/ci/2026-10-18T16-29-04-657Z-critical` ; `ARMY-1792341052141-88f7bfc3-*`, `ARMY-1792341056532-e7c06f08-*`, `ARMY-1792341060180-413eefe9-*`, `ARMY-1792341063318-ee9e4656-*`, `ARMY-1792341064659-fb7e21c1-*` |

Les runs 6 (rouge) et 7 (vert) portent sur les sources finales avant la fusion de `main` et font foi ;
les runs 1 à 5 tracent la reprise du parcours. Après la fusion (`4d21582c`, 2.8b et `33c7031b`),
`npm run verify:pr` réussit sur cette tête (node 307 fichiers / 3 289 tests, 2 ignorés ; jsdom 165 / 831 ;
frontières 3 / 12) ; les parcours RL01 à RL05 et les copies v3 (IO10 à IO13) sur la tête fusionnée
relèvent de la CI de la PR, les exécutions natives locales étant suspendues. `npm run verify:pr` sur la source du run 7 (`6260621c` + correctif, clone WSL) :
succès (node 303 fichiers / 2 939 tests, 2 ignorés ; jsdom 165 / 831 ; couverture des frontières
critiques 3 / 12).

Le run 1 a montré que la forme demandée au départ (une section de 1 001 lignes copiée en entier) ne
peut pas passer, même paginée : l'insertion directe d'environ 1 000 lignes dans une v1/v2 dépasse le
`statement_timeout` de 8 s des rôles de l'API (voir Limites). Le parcours a donc été repris avant le
correctif sur une grande version à sections moyennes, qui isole la troncature des lectures, puis
réduit (run 3) pour garder chaque insertion loin du `statement_timeout`. Les preuves de chaque run
(journal, dossier CI, artefacts métier) sont aussi copiées dans `.codex-tmp/rowlimit/runs/runN/` (N = numéro
du run) du worktree de travail : copie locale ignorée par git, non durable. Le temps médian de chaque instruction SQL n'est pas mesuré : seules les durées des
requêtes HTTP le sont ; les lectures ajoutées sont les pages de `readAllEstimateItems`, déjà exécutées
par la lecture de l'éditeur et le recalcul sur les mêmes versions.

## Limites

- Copie de ~1 000 lignes dans une v1/v2 : `duplicateSectionInternal`, `importSectionsFromVersion` et
  l'import du DPGF lié dans un brouillon insèrent leurs lignes par un `insert` direct, dont chaque ligne
  déclenche les effets par ligne d'`estimate_items` (révision de contenu de la version, couverture des
  sources, audit, gardes). Environ 1 000 lignes dépassent le `statement_timeout` de 8 s : 400, rien
  d'écrit (run 1). La création atomique d'une version les rejoue déjà en bloc
  (`20261018013249_estimate_creation_set_based_item_effects.sql`), pas les copies. Le run 3 mesure
  ~40 ms par élément copié dans une version de 1 125 éléments insérée en SQL, contre ~12 ms dans une
  v2 vide : la taille de la version et l'historique de son amorçage (un relèvement de révision par
  élément inséré) ne sont pas séparés, la cause n'est pas établie. Défaut distinct, non corrigé ici ;
  le parcours garde des copies de 13 éléments au plus. L'insertion de RL1 (13 éléments dans 1 287) est
  estimée à 0,35-0,5 s en local d'après les durées du run 5, au-dessus du budget de 330 ms par
  instruction d'AGENTS.md ; c'est l'insertion existante, pas une lecture ajoutée, et le temps par
  instruction n'est pas mesuré.
- Le chemin v1 partage le code des lectures v2 (branche non v3) ; le parcours ne crée que des v2.
- Lignes DPGF mappées : `readAllRows` refuse une lecture dont le nombre change entre deux pages
  (erreur simple, donc 500 générique de l'API, sans nouvelle tentative) ; l'ancienne lecture
  unique importait en silence l'état partiel. Ce cas demande un remappage (`createMapping` supprime puis
  réinsère par lots de 500, sans transaction commune) validé entre deux pages : aucun parcours ne le
  reproduit, il n'est ni réessayé ni couvert ici. Le remappage non atomique est antérieur : une lecture
  entre deux lots, stable, importe toujours un ensemble partiel en 201.
- RL4 est synthétique : ses 995 lignes vides (refusées sans titre, puis ignorées) gardent l'insertion
  petite ; RL5 couvre le même lecteur sur 1 001 lignes chiffrées par la création, déjà ensembliste.
- Hors périmètre, relevées au passage (même limite de 1 000 lignes, non couvertes ici) : le nombre de
  lignes des variantes (`listEstimateVersionVariants`) et les frères lus par `reorderEstimateItems` et
  `moveEstimateItem` sont paginés sur `main` par `33c7031b` ; `listEstimateImportSources` (versions
  proposées par la boîte d'import, les 1 000 plus récentes seulement) n'y est pas corrigée.
