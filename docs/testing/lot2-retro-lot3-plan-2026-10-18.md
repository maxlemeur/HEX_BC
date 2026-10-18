# Lot 2 : rétrospective et proposition de lot 3 — 18/10/2026

Le lot 2 est fusionné et M8 est appliquée au Supabase partagé. La publication et
la vérification en ligne ont leur propre preuve : une CI verte et une migration
appliquée ne prouvent pas que Vercel sert ce code. Cette note ne vaut pas reçu de
déploiement.

L'étape d'exploitation 3.0 ci-dessous est réalisée : la release
[v0.5.0](https://github.com/maxlemeur/HEX_BC/releases/tag/v0.5.0) et Vercel portent
le commit `708ae88d`, création v3 et reprise durable vérifiées. Les détails et
limites sont dans le [reçu de publication](lot2-production-2026-10-18.md).
La CI post-fusion de ce commit est entièrement verte, dont les quatre shards
[TesterArmy Critical](https://github.com/maxlemeur/HEX_BC/actions/runs/39166083747).

## Constats vérifiés

- M8 impose le moteur 3 à la création sans politique explicite 2. Un ancien
  client est refusé avant écriture. La base et le client doivent donc être
  publiés dans une fenêtre coordonnée ; le rollback applicatif sous le code
  2.10 est exclu. Voir [application partagée](shared-supabase-2-8b-m8-2026-10-18.md).
- `main` à `13c697b5603ff12d25b8852d925496e102630b10` contient #70 (lectures
  complètes et épinglées des copies v1/v2), #68 (M8) et le lot 2. Ses contrôles
  [qualité](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352347),
  [métier](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352354) et
  [smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352375) ont réussi.
- Le cron ne lançait pas la reprise : son run
  [39156788921](https://github.com/maxlemeur/HEX_BC/actions/runs/39156788921)
  échouait en `invalid-configuration`, avec URL et secret absents. Après configuration
  autorisée et publication, sa deuxième tentative réussit : un job takeoff à issue
  inconnue récupéré, aucune erreur. Un nouveau déclenchement **schedule**,
  [39167352001](https://github.com/maxlemeur/HEX_BC/actions/runs/39167352001),
  réussit ensuite sur `708ae88d` à 23:20:08, heure de Paris : `Recovery healthy`,
  aucune erreur. Voir le [reçu de publication](lot2-production-2026-10-18.md).
- Les PR de dépendances vieillies ont accumulé des conflits. #17 est dépassée
  par Next / eslint-config-next 16.4.0 ; #19 par Vitest / coverage-v8 4.1.11.
  #17 et #19 sont fermées ; #16, #18, #20, #21 et #22 ont fusionné après actualisation,
  revue indépendante et contrôles verts. La qualification 0.5.0 porte sur leur état final.

## Mesurer le même travail

Le [run final de #59](https://github.com/maxlemeur/HEX_BC/actions/runs/39153968200)
conserve deux mesures distinctes :

| Mesure | Valeur | Périmètre et limite |
|---|---:|---|
| IO13, copie à la limite | 7 984 ms | Route HTTP complète, lectures et préparation comprises ; `elapsedMs` est rapporté, sans assertion de durée |
| Sonde SQL, 1 000 opérations dans la grande v3 | 1 787,7 ms | Une exécution pendant le démarrage pgTAP du shard 3, avant le serveur Next et les parcours |
| Même sonde locale WSL, grande v3 | médiane 730,2 ms sur 7 | Mesure historique du lot 2.8b, hôte chargé, pas le Mac de référence |
| Rapport arithmétique des deux sondes | environ 2,45× | Indication propre à ces sondes et à ces environnements ; pas une mesure de la contention pendant IO13 |

Sources : artefact `army-critical-shard-4-evidence`, fichier métier
`ARMY-1792348274002-0252de20-io-copy-at-limit.json` ; log du
[shard 3](https://github.com/maxlemeur/HEX_BC/actions/runs/39153968200/job/117753257247)
à 18:26:05 UTC ; [sondes et mesures locales](large-estimate-statement-budget.md#copy-into-a-v3-28b-l7).

Les 7,984 s ne mesurent donc pas une instruction SQL à 20 ms du timeout de 8 s.
La durée SQL réelle sous la charge de ce parcours reste à mesurer. Le facteur
historique 12–19× était lui aussi une estimation mêlant des bornes SQL et une
attente d'interface. Aucun de ces chiffres ne justifie seul de changer les budgets
d'AGENTS.md. Pour le prochain changement : mêmes données, même révision,
mêmes rôles, même concurrence, temps SQL et temps HTTP séparés, échantillons bruts
conservés. Aucun timeout relevé ni retry ajouté.

## Ordre proposé pour le lot 3

| Étape | Résultat attendu | Condition de sortie |
|---|---|---|
| 3.0 Exploitation | Client compatible avec M8 en ligne, création v3 vérifiée, reprise durable opérationnelle, version 0.5.0 liée au code publié | URL, commit, déploiement READY, preuve de création et compteurs de reprise ; release après les dépendances retenues |
| 3.1 Copies à grande échelle | Après fusion des sessions copies v1/v2 et réordonnancement, diagnostic puis optimisation du chemin de copie v3 | Rouge/vert IO13 ; 1 000 opérations atomiques, montants et provenance exacts après reload, refus sans écriture ; comparaison SQL/HTTP avant/après sur données identiques |
| 3.2 Entrées encore fermées | Décider puis livrer séparément les conversions ligne/section encore fermées en v3 et les autres entrées réellement requises | Contrat métier explicite ; refus nommé ou résultat persistant vérifié ; moteurs historiques conservés |
| 3.3 Consolidation | Nettoyage des droits superflus et de l'historique partagé, documentation et release reproductibles | Droits légitimes conservés, refus anonyme ; historique réconcilié sans rejouer les anciens corps SQL |

Une PR active à la fois sur l'écrivain et ses consommateurs ; pas de reprise du
travail non fusionné d'une autre session. La copie v1/v2 est maintenant la
[PR #72](https://github.com/maxlemeur/HEX_BC/pull/72), encore ouverte au relevé.
L'étape 3.1 attend ensuite la future PR de réordonnancement, sans numéro au
relevé. Le propriétaire identifie sa branche locale non poussée
`Thanh/silly-hypatia-83b585`, basée sur `13c697b5`, et sa migration non suivie
`20261018204500_estimate_item_order_set_based_effects.sql` (nom provisoire).
Ces informations de session sont fournies par le propriétaire ; cette note ne
qualifie pas son diff non commité.

#72 ajoute `copy_estimate_items_atomic` pour les copies v1/v2, sans remplacer
`commit_estimate_batch`. Le chevauchement fonctionnel décisif vient du
réordonnancement : il remplace `bump_estimate_content_revision_from_item` et
`log_estimate_audit`, déclenchés sur les écritures de lignes. L'optimisation v3
devra partir de leurs corps **après fusion**, ainsi que du dernier
`commit_estimate_batch` (actuellement `20261018180306`), pour traiter révision et
audit en lot sans écraser ces contrats. Ordre : #72, future PR de
réordonnancement depuis un `main` actualisé et migration restampée si nécessaire,
puis PR v3 depuis ce nouvel état.

Le dimensionnement se fait par scénario et dépendance, sans promesse calendaire
à partir d'un facteur CI unique. La
[rétrospective CI](ci-retro-2026-10-18.md) conserve les mesures de délai de
livraison et les règles de revue : une revue interne avant la poussée, une poussée
par tour, correction des parcours instables sans relance aveugle.

## Nettoyage partagé : disposition préparée, non appliquée

Les migrations `20260714120000` et `20260714134334` manquent par nom dans
l'historique, mais leurs fonctions ont des successeurs appliqués. Leurs corps
actuels correspondent aux migrations ultérieures ; les rejouer retirerait des
évolutions. `20260718014058` est vide. Il faut une réconciliation d'historique
seule, avec snapshot et comparaison catalogue, pas un `db push` ni `--include-all`.

`insert_estimate_template_into_version(uuid,uuid,uuid)` accorde encore EXECUTE
à PUBLIC et anon. Le corps actuel refuse `auth.uid() IS NULL` avant les lectures
et écritures ; aucune insertion anonyme n'est démontrée. Le correctif minimal est
de révoquer PUBLIC **et** anon, en gardant authenticated et service_role, dans une
nouvelle migration après les migrations en cours. Ajouter la preuve de droits
sur la fonction sous-jacente et le parcours d'insertion légitime ; le wrapper de
reçu a déjà ses propres restrictions. Ne pas réécrire M6.
