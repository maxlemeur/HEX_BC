# Budgets SQL des grands devis

Les budgets portent sur les statements exécutés sur le même hôte natif
macOS ou Linux, médiane de 7 runs, avec charge et échantillons bruts conservés.
Ils n'incluent pas HTTP, PostgREST, sérialisation, affichage ni tous les coûts
de commit. Un dépassement demande de diagnostiquer et corriger l'écriture,
sans augmenter le timeout ni masquer l'échec par une relance.

| Opération | Volume | Budget local |
| --- | --- | --- |
| Import/création atomique et recalcul des paramètres | Workbook public réel, 2 031 items | 1 000 ms |
| Copie dans un devis moteur 3 | Jusqu'à 1 000 opérations | 875 ms |
| Écriture interactive, batch de saisie/collage/undo, reorder/move | Volume réellement pris en charge | 400 ms |

La cible de copie en CI/production est 3 500 ms. Le facteur de planification 4
relie cette cible aux 875 ms locaux ; ce n'est pas une borne statistique
mesurée. Le budget bulk ménage une marge par rapport au timeout API de 8 s,
mais une médiane locale ne prouve pas le temps de chaque requête distante.
Les anciens seuils 330 ms et 500 ms sur fixture synthétique sont retirés.

## Exécuter

Depuis un checkout isolé sans `.env` ni cible DB héritée :

```sh
# Contrats SQL, sondes diagnostiques, plafond de copie et matrice RLS
npm run db:ci:local

# Ajouter les budgets locaux, médianes de sept mesures
DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local
```

Le runner crée et détruit sa pile native. Le plafond de copie s'exécute quand
les contrôles DB tournent seuls, notamment dans E2E RLS Matrix. Il est
explicitement ignoré lorsqu'un travail tel qu'un build Army démarre en
parallèle. Les budgets locaux restent opt-in ; un run sans cette variable ne
prouve pas leur respect. Pour un contrôle filtré, voir le [guide local](tester-army-local-development.md).

## Sources et assertions

[`large-estimate-workbook.ts`](../../src/test/large-estimate-workbook.ts) vérifie
l'empreinte du workbook
[`optima-hydraulique-fictif.xlsx`](../../e2e/fixtures/business/optima-hydraulique-fictif.xlsx),
le passe au parser/normaliseur applicatif et génère la fixture dans la pile
possédée. Elle contient 131 sections (racine incluse), 1 900 lignes et 785
lignes à prix positif, avec statuts et provenance. À c_FO 1,3, c_MO 1,2 et
40 €/h, l'oracle HT est 67 298,03 €.

| Source | Contrôle |
| --- | --- |
| [Fixture SQL commune](../../supabase/tests/fixtures/large-v3-estimate.sql) | Création réelle et témoin de 8 items ; réglages c_FO 1,3 → 2 ; copies avec provenance ; statements annulés entre mesures |
| [Sonde exécutée par défaut](../../supabase/tests/database/estimate-large-v3-scale.test.sql) | Volume, statuts, HT, absence de révision par ligne à la création, audit, projection de toutes les lignes et 785 repricings ; copie 1 000 opérations sans réécriture des lignes existantes, refus atomique |
| [Budget local](../../supabase/tests/budget/estimate-large-v3-statement-budget.test.sql) | N = 7 : création/réglages ≤ 1 000 ms, copie 1 000 ≤ 875 ms, batch 100 ≤ 400 ms |
| [Plafond de copie](../../supabase/tests/ceiling/estimate-v3-copy-ceiling.test.sql) | N = 1 : copie dans le grand v3 ≤ 3 500 ms sur le job isolé |

Les autres sondes sous `supabase/tests/database/` et `supabase/tests/budget/`
couvrent notamment reorder/move. Une assertion déterministe sur le travail
réalisé protège contre une mesure artificiellement rapide : les réglages
recalculent de vrais prix, les copies ne réécrivent pas l'existant et un refus
n'écrit rien. Les diagnostics rapportent les versions, timeouts, empreintes,
volumes, tailles de reçu et durées.

## Limites et décision

Les sondes ne couvrent pas toutes les écritures interactives ni le coût total
des routes. IO01, IO02 et IO13 gardent leurs assertions navigateur sur import,
réglages et copie ; le [guide performance](tester-army-performance.md) sépare
leur observation du chronométrage SQL. Les charges, versions et fixtures
historiques différentes ne forment pas un avant/après comparable.

Conserver le premier échec, identifier l'hôte et sa charge, puis expliquer la
cause avant un nouveau run. Un test passé localement n'établit pas une
performance de production. Les anciens résultats et leurs preuves sont dans
l'historique Git ; ce guide ne présente aucun d'eux comme rejoué actuellement.
