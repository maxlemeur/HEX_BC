# Lectures au-delà de la limite de lignes de l'API (variantes, ordre, déplacement, hiérarchie, sources d'import)

PostgREST renvoie au plus 1 000 lignes par requête (`supabase/config.toml`, `[api] max_rows = 1000`). Le
correctif des copies de sections v1/v2 ([copy-row-limit-v2.md](copy-row-limit-v2.md), #70) laissait hors
périmètre d'autres lectures de `src/lib/estimates/server.ts`. Pendant ce travail, 33c7031b (lectures complètes
`readAllRows`, [postgrest-completeness-2026-10-18.md](postgrest-completeness-2026-10-18.md)) a corrigé quatre d'entre elles
(constats P2 · 18 et P2 · 44 de l'[audit](../audits/postgrest-1000-rows-2026-10-18.md)), sans parcours sur ces
chemins ; l'audit écartait la liste des devis sources (`server.ts:3487`) avec la copie de sections. Ce lot
corrige cette dernière lecture et ajoute le parcours des cinq défaillances.

## Défaillances observables (écrites avant le code, rouges sur `main` 36c5158c)

| Id | Chemin | Lecture tronquée | Défaillance sur `main` 36c5158c | Correctif |
| --- | --- | --- | --- | --- |
| LR1 | Comparatif des variantes de la fiche de version (`/dashboard/estimates/{id}`), v2 de 600 lignes et sa variante de 500 | `listEstimateVersionVariants` : `version_id` de toutes les lignes des variantes, en une lecture | 600 et 400 lignes affichées | 33c7031b |
| LR2 | Réordonner une section de 1 001 lignes (`POST /api/estimates/{v}/items/reorder`) | `reorderEstimateItems` : frères du parent, en une lecture non triée | Liste complète refusée (409, `expected_ids` de 1 000) ; une liste privée de la dernière ligne passe le contrôle et la RPC réordonne 1 000 lignes en laissant la 1 001e à sa place (200) | 33c7031b |
| LR3 | Déplacer la dernière ligne (position 1 001) d'une section de 1 001 lignes vers une autre section (`POST …/items/move`) | `moveEstimateItem` : frères source par position, en une lecture | 409 `item_not_in_source_parent` | 33c7031b |
| LR4 | Créer une ligne sous une section écrite juste après 1 001 sections (`POST …/items`) | `loadHierarchyItems` : éléments de la version, en une lecture non triée | 400 « Une ligne doit être ajoutée sous une section. » | 33c7031b |
| LR5 | Versions proposées par la boîte d'import (`GET /api/estimates/import-sources`) | `listEstimateImportSources` : versions du tenant, en une lecture | Les 1 000 versions modifiées le plus récemment seulement, la plus ancienne absente (1 000 sur 1 030 dans la boucle de développement) | ce lot |

Une lecture non triée suit l'ordre physique des lignes : LR4 n'est rouge que si la section cible est rangée
au-delà des 1 000 premières lignes de la version. Le parcours enregistre ce rang (`physicalRank`) sans
l'asserter ; il valait 1 001 sur `main` 36c5158c comme dans les runs GitHub. La même lecture sert la modification d'un élément et
l'insertion d'ouvrage (`resolveSectionLevelFromParent`).

Les montants ne changent pas : aucune formule n'est touchée, et chaque scénario compare les totaux enregistrés et
les sommes des lignes en SQL.

## Parcours

`e2e/army/local/estimate-row-limit-reads.e2e.ts` (LR01 à LR05), sur la pile locale possédée : un brouillon v2
neutre (marge fixe ×1, TVA 20 %, sans remise ni arrondi) par affaire, contenu volumineux écrit en SQL. La ligne g
d'une section vaut 1 u à 5·g centimes : 5·g HT, g de TVA, 6·g TTC.

- LR01 lit le tableau du comparatif tel que l'utilisateur le voit (libellé et nombre de lignes de chaque version).
- LR02 et LR03 envoient une liste privée d'un frère (celle d'un client qui n'a pas vu la dernière ligne) : le
  contrôle doit la refuser (409) en nommant tous les frères, avant toute écriture, et SQL montre l'ordre inchangé.
  Voir Limites pour le chemin complet (200).
- LR04 écrit 1 001 sections vides puis la section cible : la lecture de la hiérarchie compte tous les éléments,
  alors qu'une nouvelle ligne v2 reprojette toutes les lignes de la version (Limites).
- LR05 inscrit son propre propriétaire (`signUpDedicatedOwner`), donc son propre tenant : la liste couvre le
  tenant, que partagent les deux workers de la campagne. Il écrit 1 001 brouillons v2 vides à côté du brouillon
  courant, modifiés en 2001 à une minute d'écart, et compare la liste de l'API à l'ordre SQL : 1 001 versions,
  identifiants dans le même ordre, la plus ancienne en dernier. En cas d'écart, la preuve enregistre le premier
  rang différent et jusqu'à 20 versions manquantes ou en trop.

Les écritures SQL des sections et des lignes passent par transactions de 250 lignes au plus : chaque ligne écrite
déclenche les effets par ligne, dont le coût croît avec les lignes écrites dans la même transaction, et chaque
appel de `querySql` est borné à 30 s.

```bash
npm run e2e:army:local -- --grep 'LR0' --app-port 3184
```

Le parcours n'a pas encore de durée mesurée dans `scripts/tester-army/army-shards.json` : il compte
`defaultSeconds` jusqu'à sa première mesure en CI.

## Correctif

`listEstimateImportSources` lit par `readAllRows` (`src/lib/supabase/read-all.ts`, 33c7031b) : pages de 500
dans l'ordre des identifiants seulement, nombre exact vérifié. Une version modifiée entre deux pages garde ainsi
sa place ; un tri par `updated_at` la déplacerait d'une page à l'autre et ferait échouer la lecture. La liste est
ensuite triée en mémoire comme le faisait PostgreSQL : `updated_at` décroissant (microsecondes gardées, comme
`isOlderEstimateVersionToken`), `version_number` décroissant, puis identifiant. Filtres de tenant, d'affaire non
archivée et de propriétaire inchangés.

## Mesures

Pile possédée du clone WSL (`~/miaouffrage-rowlimit2`), machine au repos, psql en `postgres`, chaque exécution
annulée : `public.reorder_estimate_items` inversant une section v2 de 1 001 lignes (2 002 mises à jour).

| Déclencheurs d'`estimate_items` | Durée de la RPC |
| --- | --- |
| tous | 2 030 ms |
| sans `bump_estimate_content_revision_from_item` | 414 ms |
| sans `estimate_items_audit_trigger` | 1 750 ms |
| sans aucun déclencheur utilisateur | 41 ms |

## Exécutions

Les créneaux natifs locaux étant réservés au lot 2 (demande du porteur, 18/10/2026), les exécutions finales
passent par GitHub (AGENTS.md) : branche `wip/row-limit-reads`, supprimée ensuite,
`gh workflow run e2e-army-full.yml --ref wip/row-limit-reads -f grep='LR0'` (filtrées, non qualifiantes,
`run-tester-army-ci.ts full --shard 1/1 --grep LR0`, 1 worker, pile native possédée du coureur).

| # | Source | Exécution | Résultat | Preuves |
| --- | --- | --- | --- | --- |
| 1 | `main` 36c5158c + parcours de première forme, sans correctif | boucle de développement, clone WSL, itération 3 | Rouge, 4/4 (LR01 à LR04) : 600/400 ; 409 `expected_ids` de 1 000 ; 409 `item_not_in_source_parent` ; 400. LR05 rouge à l'itération 1 (1 000 sur 1 005) | `.codex-tmp/row-limit-reads/devloop/` |
| 1b | idem + premier correctif de ce lot (lecteurs paginés propres, abandonnés ensuite pour `readAllRows`) | idem, itération 4 | LR01 à LR04 verts, chemin complet compris : réordonnancement de 1 001 lignes 200 en 3 057 ms, déplacement 200 en 3 690 ms, création dans une v2 de 1 001 lignes 201 en 3 803 ms ; LR05 en échec sur une précondition du parcours (versions archivées d'un run antérieur sur la même pile), corrigée ensuite | idem |
| 2 | `main` 36c5158c + parcours de forme intermédiaire (LR02 à LR04 actuels, LR05 sur le tenant partagé), sans correctif | idem, itération 6 | Rouge, 5/5 : LR01 600/400 ; LR02 200, 1 000 lignes réordonnées ; LR03 `item_not_in_source_parent` ; LR04 400, section au rang physique 1 001 ; LR05 1 000 sur 1 030 | idem |
| 3 | `main` f1a5a74b + parcours final, sans correctif (f6592caa) | GitHub, run [39151345173](https://github.com/maxlemeur/HEX_BC/actions/runs/39151345173) | **Rouge, attendu** : 5 réussis sur 6 (setup compris), LR01 à LR04 verts grâce à 33c7031b ; LR05 rouge, 1 000 versions proposées sur 1 001, la plus ancienne absente (premier écart au rang 1 000) | `.codex-tmp/row-limit-reads/gh-red-39151345173/` |
| 4 | idem + correctif (e0d8a8a0) | GitHub, run [39151463800](https://github.com/maxlemeur/HEX_BC/actions/runs/39151463800) | **Vert, 6/6** : LR01 600 et 500 ; LR02 409, 1 001 frères nommés, ordre inchangé ; LR03 409 sans `reason`, 1 000 frères source nommés, rien déplacé ; LR04 201, ligne en position 1, 5 / 1 / 6 enregistrés, relus et sommés ; LR05 1 001 versions dans l'ordre SQL, la plus ancienne en dernier | `.codex-tmp/row-limit-reads/gh-green-39151463800/` |

Après la fusion de #70 et l'union des listes de `e2e.config.ts` et de la carte d'impact (3e36a1f9), sur un clone
WSL propre : `npm run e2e:army:local -- --grep 'LR0' --app-port 3184`, pgTAP et matrice RLS réussis, **6/6 verts**
(`filtered-critical`, 1 worker), mêmes valeurs exactes que le run 4 ; liste des sources 446 ms, création 321 ms.
Preuves : `.codex-tmp/row-limit-reads/local-merged/` (dossier CI `2026-10-18T20-16-09-139Z-critical`).

Durées en CI (run 4) : amorçages SQL de 897 à 1 046 ms par scénario (lots de 250 lignes), 136 ms pour les
1 001 versions ; requêtes : refus du réordonnancement 134 ms, refus du déplacement 161 ms, création 240 ms, liste
des sources 229 ms, fiche de version 603 ms. Un run en double sur f6592caa (39151387679), lancé par erreur, a été
annulé.

`npm run verify:pr` sur le code de e0d8a8a0 (clone WSL, mêmes empreintes de fichiers ; la tête finale n'ajoute que
ce document) : succès en 111 s (node 307 fichiers / 3 289 tests, 1 fichier et 2 tests ignorés ; jsdom 165 / 831 ;
couverture des frontières critiques 3 / 12). Revue indépendante en lecture seule : serveur correct ; LR05 passé sur
un propriétaire dédié avec 1 001 versions, amorçages par lots de 250 lignes et liens vers un document hors de
`main` retirés à sa suite.

## Limites

- **Chemin complet du réordonnancement et du déplacement de plus de 1 000 frères.** Une liste complète passe le
  contrôle corrigé et la RPC réussit (200, positions exactes en SQL) : itération 4 de la boucle de
  développement, sur le premier correctif de ce lot (lecteur paginé propre, remplacé ensuite par `readAllRows`),
  réordonnancement de 1 001 lignes en 3 057 ms et déplacement hors d'une section de 1 001 lignes en 3 690 ms
  (requêtes complètes). La RPC seule prend 2 030 ms, dont environ 1 600 ms pour la mise à jour de la révision de
  contenu de la version à chaque ligne réécrite (Mesures). Au facteur de charge CI de 12 à 19
  ([large-estimate-statement-budget.md](large-estimate-statement-budget.md)), elle dépasse le
  `statement_timeout` de 8 s : ce chemin n'est donc pas un parcours CI, LR02 et LR03 prouvent la lecture complète
  par le refus d'une liste incomplète. Le coût existe déjà sur `main` pour un parent de 999 frères : ce sont les
  effets par ligne, que la création atomique rejoue en bloc depuis M6b mais pas le réordonnancement ni le
  déplacement ; non corrigé ici.
- **Création d'une ligne dans une v2 de 1 001 lignes** : 3 803 ms par requête (itération 4), parce que la
  création reprojette toutes les lignes de la version et les réécrit, chacune avec ses effets par ligne.
  Antérieur, non corrigé ; LR04 l'évite avec des sections vides.
- **Lecture modifiée pendant les pages.** `readAllRows` refuse un nombre qui change, un identifiant lu deux fois
  ou une page tronquée (erreur 500, aucune écriture). Pour la liste des sources, la modification d'une version ne
  la fait plus échouer ; une version créée ou supprimée, une affaire archivée ou désarchivée, ou un changement de
  propriétaire pendant la lecture, si. Aucun parcours ne reproduit cette course.
- **Relevé par la revue, sur `main` (33c7031b), hors périmètre** : `listLatestEstimates` pagine sur `version_number`,
  `updated_at` puis id ; une version modifiée entre deux pages (au-delà de 500 versions) peut changer de page,
  être lue deux fois et faire répondre 500 à la liste des devis. Le tri en mémoire après des pages par id, retenu
  ici pour les sources, l'éviterait.
- Les autres lectures plafonnées relevées par l'audit (P3, dont `listEstimateProjectDraftVersions` et la lecture
  des versions de la famille dans `listEstimateVersionVariants`, P3 · 70) restent hors périmètre.
