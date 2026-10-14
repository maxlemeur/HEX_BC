# Préparation achats — compteurs opérationnels

Plan de régression défini avant correction du 11 octobre 2026. La couverture
fournisseur ne suffit pas à établir qu’une ligne peut encore être préparée :
une ligne transférée reste couverte, mais ne doit plus être proposée à l’achat.
La préparation canonique applique également les conditions de l’offre retenue.

## Défaillances observables

- Avec quatre lignes fournisseur dont une déjà transférée, le hub annonce
  actuellement quatre lignes commandables alors que la préparation en admet
  trois. Carte de pilotage et panneau doivent afficher les mêmes comptes
  opérationnels : trois préparables, une transférée, aucune à corriger.
- Après création des trois restantes et rechargement, quatre lignes transférées
  ne constituent pas quatre nouveaux achats possibles. Les comptes doivent être
  zéro préparable, quatre transférées, zéro à corriger, avec accès aux commandes
  existantes et sans action de création.
- Une quantité positive mais inférieure au minimum de l’offre retenue ne doit
  pas rester annoncée comme prête. Une baisse réelle de la ligne `half` de
  `12.5` à `0.5`, avec minimum fournisseur `1`, doit donner deux préparables,
  une transférée et une à corriger. Le motif est celui de la préparation
  canonique : conditions fournisseur à revalider.
- Une panne de lecture ne vaut ni zéro ligne ni état prêt. Le panneau doit
  signaler l’indisponibilité, proposer une relecture et empêcher la création.
- Une réponse HTTP 200 dont les comptes ne concordent pas avec ses lignes ou
  leur somme ne vaut pas une préparation valide : elle doit également produire
  l’état indisponible, sans ancien compteur ni bouton de création.

## Scénarios et frontières

La recette `e2e/army/local/purchase-readiness.e2e.ts` utilise une nouvelle fixture
ARMY issue du seed décimal, un utilisateur existant connecté par l’UI et le
backend local exact `http://127.0.0.1:59827`. Le coordinateur fournit la fixture
par `E2E_PURCHASE_READINESS_FIXTURE_PATH`. Le reçu archive le minimum de commande
spécifique au scénario ; aucune donnée ARMY d’une campagne précédente n’est
réutilisée.

Les deux tests de panne utilisent une autre fixture neuve, donnée par
`E2E_PURCHASE_READINESS_FAILURE_FIXTURE_PATH`, avec précondition réelle de trois
lignes préparables, une transférée et zéro bloquée. Ils n’utilisent pas le devis
consommé par le trajet de création. Après reprise, les trois en-têtes de ligne
et l’unique transfert doivent être affichés avant la capture des compteurs.

Le premier trajet lit la préparation réelle et les deux surfaces du hub,
modifie la quantité via l’API ordinaire après acquisition du verrou du devis,
recharge le hub et vérifie le blocage. Il restaure ensuite la quantité initiale,
relit les trois lignes et les montants, confirme leur revue et crée un brouillon
via l’UI. Les montants attendus sont `1636/327/1963` centimes HT/TVA/TTC pour
`12.5 × 123`, `0.125 × 777`, `0.001 × 500`. Après rechargement, le trajet vérifie
les quatre transferts, les mêmes identités source et les montants persistés.
Les assertions de compteurs UI sont souples au baseline afin de conserver le
contre-exemple avant et après création ; les assertions API et monétaires
restent exactes et bloquantes.

Deux recettes de lecture provoquent respectivement un GET 503 et un GET 200
avec compte de lignes préparables augmenté artificiellement de un dans le
navigateur. Elles vérifient les deux surfaces et l’absence de POST, puis laissent
repasser le vrai GET pour constater la reprise. Cette interception **ne prouve
pas** le traitement d’une panne de lecture interne au rendu serveur ; cette
frontière exige une preuve distincte si elle est modifiée. Le callback entre
panneau et carte doit transmettre l’état courant sans réutiliser une vieille
prop serveur. Le premier trajet contrôle leur cohérence après création **avant
rechargement**, puis après le nouveau rendu serveur.

## Textes convenus avant implémentation

La carte se nomme « Préparation des achats ». Carte et panneau affichent la
même phrase exacte : « 3 lignes préparables · 1 ligne déjà transférée · 0 ligne
à corriger. », puis « 2 lignes préparables · 1 ligne déjà transférée · 1 ligne à
corriger. » avec badge « Partiellement prêt » lorsque le minimum bloque une
ligne. L’état initial porte le badge « Prêt ».

Après transfert complet : « 0 ligne préparable · 4 lignes déjà transférées ·
0 ligne à corriger. », badge « Déjà préparé », puis « Toutes les lignes
fournisseur ont déjà été transférées. Consultez les commandes existantes. ».
L’indisponibilité porte le badge « Indisponible » et la phrase « Préparation
indisponible. Rechargez pour vérifier les lignes. », sans comptes ni action de
création. Le bouton « Recharger la préparation » permet une lecture réelle.
Le scénario malformed ne remplace jamais cette exigence par un faux succès :
au baseline seulement, une navigation conserve la preuve de récupération si
l’action manque, après enregistrement de l’assertion échouée.

Trois scénarios métier et la connexion sont prévus, soit **4 tests**.

## Premier diagnostic conservé

L’archive `.e2e/product-foundation/runs/2026-10-11T10-24-03-044Z` conserve
la connexion réussie et trois scénarios échoués. `changedDuringRun:true` signale
une édition du harness demandée après le premier signal de gel : ce run reste
un diagnostic, pas une preuve de sources stables.

Les réponses et surfaces conservées établissent les comptes canoniques
`3/1/0`, puis `2/1/1` après la modification réelle sous minimum, tandis que
le hub promet encore quatre lignes commandables. La réponse 200 aux comptes
incohérents conserve également le badge prêt et le bouton de création.
Deux interruptions ne constituent pas des défauts produit : le PATCH de
restauration a reçu 409 parce que le helper de recette avait renouvelé son
identifiant de verrou après navigation ; l’attente de réponse du cas 503 n’a
pas établi qu’une interception avait effectivement été servie.

La recette conserve désormais un identifiant de verrou explicite sur les trois
appels ordinaires et archive chaque réponse PATCH/GET avant assertion. Le
signal d’interception ne se résout qu’après la fin de `route.fulfill` ; la liste
des interceptions effectivement servies est jointe aux preuves. La fixture
`readiness-baseline-01` est consommée. Une nouvelle baseline stable est exigée
avant toute correction applicative.

## Baseline stable

L’archive `.e2e/product-foundation/runs/2026-10-11T10-27-53-776Z` conserve
**1 connexion réussie et 3 scénarios RED**, sources stables sur le build
`iQC_IGfiEMhX3ElSsUCpf`. Le trajet principal atteint la création réelle,
le contrôle des montants/provenances et le rechargement : les appels métier
réussissent, tandis que carte et panneau continuent à annoncer quatre lignes
commandables, y compris après leurs quatre transferts. Le minimum devenu
inapplicable est aussi visible dans la préparation réelle sans modifier cette
promesse du hub.

Les interceptions 503 et 200 incohérent ont été effectivement servies et leurs
observations conservées. Elles reproduisent le maintien du statut prêt. Dans
cette baseline, ces deux cas venaient après le transfert complet ; l’absence
de bouton seule y était donc peu probante. Avant correction des surfaces, la
recette a été renforcée par la fixture de panne distincte ci-dessus et par
l’attente des lignes revenues après récupération. Ces ajustements n’effacent
ni les résultats RED ni cette limite de la baseline.

## Qualification locale après correction

La campagne complète `.e2e/product-foundation/runs/2026-10-11T10-37-09-137Z`
réussit **4/4 tests**, sans filtre, skip ou flaky, sur le build
`0G0T7qNlzYNMAcMgOI_EW`. Les sources sont stables. Le trajet principal utilise
`readiness-green-01` ; les deux pannes utilisent la fixture distincte
`readiness-failure-01`, avec trois lignes réellement préparables au départ.
La campagne n’utilise aucun modèle et conserve les traces désactivées.

Les deux surfaces affichent `3/1/0`, puis `2/1/1` sous le minimum fournisseur,
et `0/4/0` après création, avant comme après rechargement. Une seule création
produit les trois lignes, avec `1636/327/1963` centimes et leur provenance
conservée ; le besoin source retrouve ses valeurs initiales. Les interceptions
503 et 200 incohérent sont effectivement servies. Elles font disparaître la
promesse de préparation et l’action de création ; leur reprise relit les
trois lignes et le transfert existant sans mutation.

Le lecteur `.e2e/purchase-readiness/qualify.cjs` vérifie **64 artefacts hachés**
et **14 preuves métier**, les deux identités de fixture, le build et les sources
courantes, puis l’application locale inchangée de la migration décimale.
Il valide 40 JSON et scanne 72 textes : aucune valeur confidentielle configurée
ni JWT détecté, aucune valeur secrète conservée.

```powershell
node --env-file=.e2e/local-article/local.env .e2e/purchase-readiness/qualify.cjs .e2e/product-foundation/runs/2026-10-11T10-37-09-137Z
```

Reçu : `.e2e/purchase-readiness/qualifications/2026-10-11T10-37-09-137Z-aa306871/qualification.json`.
SHA-256 : `71a9c0d4bdd36cbb5cde7139123eec0a9f1720f7d240431cef070549ce730c6a`.
Le plan du lecteur est `.e2e/purchase-readiness/qualification-plan.md` ; chaque
exécution écrit un dossier unique et n’écrase aucune campagne précédente.

Les pannes sont injectées **dans le navigateur**, pas dans une lecture interne
serveur ou SQL. Aucun nouveau résultat natif n’est requis ni revendiqué pour
cette tranche sans changement de schéma. L’ancien manifeste global illisible
de `03:32` reste signalé hors périmètre. Cette qualification locale n’est ni
un déploiement, ni une publication, ni l’achèvement du goal applicatif global.

Traces et modèles désactivés, aucun envoi fournisseur, changement de rôle ou
mutation hors de la nouvelle fixture. Le wrapper archive commande, sélection,
build, sources, identités de fixture, réponses API, observations UI et SHA.
Une réussite filtrée ou un setup échoué ne qualifie pas le parcours complet.

La régression complémentaire éligibilité/préparation après cette tranche a été
requalifiée sur le même build : **12/12**, sources stables, sans filtre ni skip,
dans `.e2e/product-foundation/runs/2026-10-11T20-10-32-141Z`. Elle utilise une
nouvelle campagne ARMY sous WSL, car Windows réservait le port du backend local.
La connexion ordinaire, le navigateur réellement lancé et la conservation du
build Windows ont été prouvés séparément. Le [compte rendu préparation](purchase-preparation.md#requalification-complète-après-reprise-windowswsl)
consigne cette reprise, son reçu de qualification et les limites de plateforme.
Il ne remplace pas la campagne readiness 4/4 ci-dessus et ne prétend pas fournir
un nouveau résultat SQL ou un build Linux recompilé.
