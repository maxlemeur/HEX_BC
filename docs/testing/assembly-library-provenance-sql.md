# CORE-07 : provenance des ouvrages réutilisés

Contrat et régression écrits avant le nouveau SQL. Le défaut est observé dans
la recette `recipe-components-core07-full-20261013-06` : les deux composants
de GC01 et de GC02 sont réutilisés avec `source_provider=manual` et `{}` alors
que leurs items de bibliothèque portent les identités et citations originales.
L'observation conservée est
`.e2e/core07/provenance-reuse-red/682606cf-47d4-4476-9652-b227545cccdf/observation.json`,
SHA `12bd337f06bdb1b0ea0538b1a7d5a8376bd094c334181305b6e4f81b873c8aea`.
Le précédent verdict financier reste une preuve financière datée.

## Contrat accepté avant implémentation

Chaque nouvelle ligne matérialisée depuis une bibliothèque porte
`source_provider=assembly_library` et exactement cette enveloppe JSON :

```json
{
  "kind": "assembly_library",
  "library_origin": {
    "assembly_id": "identité de l'ouvrage contenant l'item",
    "assembly_item_id": "identité de l'item de bibliothèque",
    "source_metadata": "copie JSON originale, sans transformation"
  }
}
```

`source_metadata` dans l'enveloppe est une valeur JSON, pas nécessairement un
objet : `{}`, `null` JSON et les anciennes valeurs scalaires/tableaux restent
fidèlement copiés. Une bibliothèque manuelle n'acquiert pas de citation inventée.
Une bibliothèque importée conserve ses clés, types, tableaux et ordre.
Un composant généré conserve notamment `component_id` et ses citations exactes.
Une ancienne bibliothèque générée sans `component_id` ne reçoit aucun ID inventé.
Ces données décrivent l'origine copiée, pas la validité actuelle d'une preuve.

Les UUID de l'enveloppe sont dérivés des lignes lues sous RLS ; aucun champ
fourni par le caller ne remplace l'identité. En composition imbriquée,
`assembly_id` désigne la feuille contenant réellement l'item. Le préfixe
`library_origin` protège cette identité du caller takeoff existant, qui ajoute
un autre `assembly_id` racine dans les métadonnées extérieures.

Le nouveau devis ne reçoit ni application générée, ni snapshot généré, ni
lien de couverture CCTP automatique. Les anciennes sources, IDs de projet,
fragment, application et snapshot restent à l'intérieur de la copie opaque.
Les champs directs `source_job_id`, fichier, page et date d'extraction restent
leurs valeurs normales de matérialisation ; ils ne sont pas déduits des anciennes
sources. Le copier-coller ne présente pas un ancien document comme preuve directe
du nouveau devis. Une modification ou suppression ultérieure de la bibliothèque
ne réécrit pas cette copie dans les lignes existantes.

La migration nouvelle remplace seulement le corps de
`public.materialize_estimate_assembly_tree(uuid,uuid,uuid,integer,numeric,integer)`.
Elle conserve signature, SECURITY INVOKER, `search_path=''`, ACL, RLS,
authentification, contrôle du devis draft, tenant, parent section, profondeur,
ordre, quantités, heures, rôles et coefficients. Les sections restent structurelles.
La mutation du caller takeoff conserve son provider direct et son enveloppe actuelle.
Les migrations et données historiques ne sont pas réécrites.

## Défaillances observables et preuves

| Défaillance | Résultat attendu | Preuve |
| --- | --- | --- |
| Perte des identités/citations générées | IDs exacts et JSON original identique à la bibliothèque | E2E insertion, réponse, GET, reload, RLS et oracle SQL |
| Attribution IA/CCTP directe fabriquée | Enveloppe bibliothèque ; aucune application, snapshot ou couverture créé | SQL, car l'absence dans les tables internes n'est pas visible dans l'écran |
| IDs racine substitués à la feuille nested | Identités de chaque feuille, même après fusion des métadonnées du caller | SQL nested ; recette takeoff conservée séparément |
| Métadonnées manuelles/importées/legacy altérées | Copie JSONb exacte, y compris null/scalaires/ordre des tableaux | SQL : cas opaques impossibles à produire avec le formulaire courant |
| Copie devenue un lien mutable | La ligne conserve son origine après édition/suppression bibliothèque | SQL transactionnel ; bibliothèque mutable en UI |
| Régression du calcul lors de l'ajout de champs | Paramètres quantité/heures/coefficient/role inchangés | E2E montants existants et SQL nested paramètres exacts |
| Caller sans accès lit/insère la provenance étrangère | Refus sans mutation, mêmes frontières RLS et ACL | SQL anonyme/viewer/tenant/version/parent ; requêtes forgées hors UI |
| Une erreur tardive laisse une copie partielle | Devis, bibliothèque et provenance inchangés | SQL avec vrai trigger tardif ; panne non provoquable de façon fiable par le navigateur |

La fixture indépendante
`src/test/fixtures/estimate-assembly-provenance-regression.sql` utilise le
préfixe neuf `cfca0000`, un DO avorté obligatoirement par `P9001` et des
sous-transactions pour les cas. Elle ne réutilise ni modifie les fixtures
39/100/34 déjà qualifiées. Le marqueur, les cas exacts et leur résultat doivent
être relus ; une erreur de préparation ne vaut pas RED ou GREEN métier.
Avant/après, comparer indépendamment catalogue, droits, historique et lignes
public/private/auth.users/Storage. Les séquences, autres tables Auth et compteurs
opérationnels du moteur sont exclus de la conservation annoncée.

La recette E2E reste la preuve principale du parcours réel. Cette fixture couvre
les erreurs internes, JSON legacy et autorisations que ce parcours ne sait pas
forcer. Elle ne prouve aucune course concurrente, déploiement ou environnement
distant. La nouvelle migration nécessite un nouvel accord avant application sur
la base locale partagée ; l'accord de `20261012215942` ne couvre pas cette tranche.

## Précode exécuté

Le contrôle final précode `assembly-provenance-precode-20261013-05` exécute
les 19 cas de la fixture SHA
`6a1d6449acfc903e0be339264c7b1b6671ccee3ccb532769d2b312f2552ef32e`
contre les corps installés, sans DDL candidat. Neuf cas échouent exactement sur
l'absence de l'origine bibliothèque ; dix passent, dont les autorisations,
les gardes et la panne tardive réellement atteinte une fois. Le terminal est
`P9001`, exit 3. La conservation indépendante des données/catalogue/droits et
l'égalité des corps/ACL avant/après sont vérifiées. Reçu
`.e2e/core07-sql/assembly-provenance-precode-20261013-05/results/receipt.json`,
SHA `0ad6d4deaf86535de199b10527f7fa583be806baf4e3138ec8f1c3a6e64e3cbf`.

Les archives 01–03 gardent leurs erreurs de préparation ; elles ne sont pas
des preuves RED métier. L'archive 04 conserve séparément huit défauts métier
reproduits et quatre erreurs d'oracle corrigées avant produit : un tenant
non-default reste actif, le double membre reçoit le refus tenant mismatch,
le statut sent est préparé à INSERT plutôt que par UPDATE hors workflow, et
le trigger de panne accède à sa propre séquence par des helpers definer
temporaires. Les 19 cas finaux restent distincts des 39/100/34 antérieurs.

## Qualification de la candidate

Migration neuve créée via le CLI épinglé :
`20261013002038_assembly_library_component_provenance.sql`, SHA
`4e2829a06ce3ebddf7fb4628fdc8f24902bf9dbb359de0ad3a96776eb5e53a86`.
La migration `20261012215942` déjà installée reste inchangée.

Les 19 cas passent avec le corps candidat uniquement dans une transaction
avortée. Signature, OID, corps source exact, propriétaire, configuration,
langue, volatilité et ACL sont vérifiés ; le RPC d'insertion reste inchangé.
Conservation indépendante après rollback confirmée. Reçu
`.e2e/core07-sql/assembly-provenance-candidate-20261013-01/results/receipt.json`,
SHA `cbe522163d69791dae58624e828ece2338f51d1fda197a53ff83218a3f56a801`.

Les 39/100/34 régressions conservées passent dans trois autres transactions
avortées, avec trois conservations indépendantes, les 21 fonctions générées
et 42 fonctions CCTP exactes. Le corps matérialisation et ses droits sont
qualifiés séparément dans chaque transaction. Reçu
`.e2e/core07-sql/assembly-provenance-retained-20261013-02/results/receipt.json`,
SHA `d01e0e8d52a2d5df5c3d4345de13452c302ae0bb8f26a23b8aaa848734dd39b4`.
La préparation retained-01 échoue sur une ancienne baseline unique avant
fixture ; son archive reste distincte. Ces 173 cas ne remplacent pas les 19.

Les droits installés de matérialisation et du RPC incluent `authenticated`
et `service_role`, sans `anon` ni PUBLIC. La candidate conserve exactement
cette préimage par CREATE OR REPLACE et n'ajoute aucun grant service.
L'oracle des 21 fonctions générées reste inchangé. Le contrôle séparé de
matérialisation compare le corps/settings à la source candidate et l'ACL à
la préimage locale vérifiée ; il ne déduit pas cette ACL de l'ancien fichier.

## Protocole d'application locale préparé, non exécuté

Le runner neuf `scripts/tester-army/apply-assembly-provenance-local.py`, SHA
`a2f79a6b36f347c2cbb7437375b0e00aba624d809651471f15f1ac88734852a1`,
a validé et préparé hors ligne le plan
`.e2e/core07-sql/assembly-provenance-application-plan-20261013-03/plan.json`,
SHA `079a7bb90fe92433e1199ab6b479b4a988c4bcb314dfe842be9b00acd92b304c`.
SQL d'application préparé SHA
`3ae9f55d17d9342c9b15e221cee80e46ac1f3a65f434db6f28fef7fb318f2fe1`.
La validation hors ligne n'a aucun accès DB. Elle vérifie tous les artefacts
et sources exécutables des reçus 19 et 173 et leurs liens à la préimage.

Le plan02 et le runner avant correction restent archivés. La revue a relevé
un défaut du harnais : `assembly_definitions` copiait le corps brut avec ses
sauts de ligne, alors que le SQL comparait `btrim(actual.prosrc)` au corps
attendu. Le SQL original SHA `f0f4b8d…` a réellement été exécuté sous rollback
avant correction : refus `P0001/CORE07_INSTALL_BODY_ACL_MISMATCH`, puis terminal
obligatoire P9001, aucun ajout d'historique, conservation indépendante confirmée.
Reçu `.e2e/core07-sql/assembly-apply-body-precode-20261013-01/results/receipt.json`,
SHA `c241b73ec362a97f3068a3087e008accac1074508c06ad00e4a2a7435e146f2e`.

La seule correction du runner normalise le corps attendu avec `.strip()`.
Le SQL corrigé intégral du plan03 a ensuite réellement passé toutes ses
assertions et créé le texte exact de l'historique transitoire, avec les
fonctions/settings/OID/ACL exacts du GREEN19. Le probe annule obligatoirement
la transaction par P9001/exit3 ; la conservation indépendante catalogue,
historique, données et droits est confirmée. Reçu distinct
`.e2e/core07-sql/assembly-apply-body-green-20261013-01/results/receipt.json`,
SHA `91c7ff2750fe908be85060f1b7dcea36735cc9b5994d13b492bc57b0bda3ae23`.
Cette qualification du SQL d'application ne vaut pas application persistante.

Cible exclusive : WSL Ubuntu-24.04, `127.0.0.1:33485/postgres`, API `45585`,
system identifier `7695571534776503175`, serveur `170011`. Config locale SHA
`1be0fbd0e439ea6cac061d7fe5c66ea608ed9dab5c5e9d1376a7dd6bc5bfbcf0`.
Le runtime est physique, non lié à une base distante, avec seed désactivé.

Après nouvel accord humain pour cette migration et cette seule cible, le
runner exige une référence explicite d'accord et un répertoire reçu neuf :

```powershell
wsl.exe -d Ubuntu-24.04 -- python3 -B /mnt/c/Users/maxim/Projects/miaouffrage/scripts/tester-army/apply-assembly-provenance-local.py --execute --migration-sha 4e2829a06ce3ebddf7fb4628fdc8f24902bf9dbb359de0ad3a96776eb5e53a86 --approval-reference user-assembly-provenance-local33485-20261013 --output .e2e/core07-sql/assembly-provenance-local-application-20261013-01
```

La référence désigne l'accord futur effectif ; la présence de cette commande
ne vaut pas accord. Le runner refuse une migration déjà présente, une préimage
corps/ACL/OID différente, une autre migration en attente, une source ou copie
de migration divergente, ou des qualifications non vérifiées. La transaction
unique installe le seul corps matérialisation, vérifie corps/settings/droits,
et écrit l'historique avec le texte exact de cette migration avant COMMIT.
Après COMMIT, il compare toutes les données existantes et les droits, limite
le diff catalogue au seul corps attendu et l'historique au seul ajout, vérifie
le texte historique et les fonctions installées, copie seulement le fichier
neuf puis demande le rechargement du schéma PostgREST. Aucun backfill, reset,
ancien apply, autre migration, remote ou retry automatique. Une ambiguïté ou
un échec après COMMIT requiert une réconciliation indépendante, jamais un reapply.

Le runner postinstallation est déjà préparé et figé :
`.e2e/core07-sql/assembly-provenance-installed-20261013-02/run.py`, SHA
`1da150aa942290c766600a9451901d6a518be211203af92b0d86e96beb91d550`.
Il exige `--application-receipt-sha` avec le SHA du reçu effectif vérifié.
Il vérifie la chaîne application/source/19/173, corps/signature/OID/settings/ACL
installés et historique source avant/après, exécute uniquement la fixture
19 avec P9001, puis contrôle conservation indépendante. Il n'installe aucune
DDL candidate et n'écrit aucun historique. Il ne sera exécuté qu'après accord
et application vérifiée. La campagne native 21/39/100/pgTAP et la nouvelle
recette E2E resteront des qualifications séparées de ce reçu installé19.
