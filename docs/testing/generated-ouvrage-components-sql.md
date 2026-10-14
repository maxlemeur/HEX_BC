# CORE-07 : décisions de composants et application atomique

Ce contrat est écrit avant la migration CORE-07. La recette navigateur reste
la preuve principale : décision Écarter/Rétablir dans le vrai dialogue, sans
rejet préinséré ; montants et heures exacts, sauvegarde/rechargement,
application, exports standard/DPGF et réutilisation dans un deuxième devis.
La fixture SQL couvre les frontières que ces gestes ne permettent pas de
forcer : demande forgée, omission d'identité, défaut interne tardif, origine
historique inconnue et publication atomique de la bibliothèque/provenance.

## Défaillances et résultats attendus

| Défaillance | Observation SQL attendue | Complément E2E |
| --- | --- | --- |
| La sauvegarde perd le statut à restaurer | Première exclusion depuis `manual`/`suggested` conserve `metadata.rejected_from_status` ; édition avant exclusion transforme l'origine en `manual` | Action explicite, badge et reload |
| Une proposition persistée disparaît | Omission/substitution d'un ID persisté refusée ; revue et sources intactes | Le bouton de décision conserve la proposition |
| La restauration choisit arbitrairement une origine | `restore:true` rend l'origine connue ; édition dans la même demande donne `manual`, marqueur absent refusé | Rétablir et éditer sans sauvegarde intermédiaire imposée |
| Une ancienne exclusion sans origine est réactivée implicitement | Sauvegarde vers `manual` refusée sans `restoreAsManual:true` ; accord explicite accepté, usage de ce marqueur hors de ce cas refusé | Libellé et décision spécifique, sans inventer l'histoire |
| Le commit applique des rejetés ou oublie un retenu | Ensemble de projections exactement égal aux IDs `suggested`/`manual`, y compris prix nul ; injection/doublon/ID étranger/omission refusés | Coûts, heures, provenance et exports identiques |
| Tout écarté devient un ouvrage validé | Application refusée, aucun item/bibliothèque/snapshot/receipt ajouté | Explication et action d'application indisponible |
| Le choix tout écarté ne peut pas être conservé sans validation | Quatre propositions et leurs origines/sources sont sauvegardées avec `status=pending_review` (`markReviewed:false` côté application) ; la sauvegarde `reviewed` et le commit sont refusés sans mutation | « Enregistrer les décisions », puis reload des quatre propositions |
| Une ancienne intention survit à la décision | Token antérieur refusé après exclusion puis restitution, même si coût final identique | Résolution/relecture de l'intention sans second effet |
| Une MO gratuite perd ses heures | Composant, trace, ligne et bibliothèque conservent les heures, coût zéro et identité | Sauvegarde, application et réutilisation ordinaires |
| La bibliothèque multiplie deux fois la quantité MO ou perd le zéro | MO quantité 2, heures totales 2, taux 4 000 : bibliothèque 8 000 centimes et 2 h ; quantité zéro reste finie et conserve l'identité | Deuxième devis, heures et coûts canoniques exacts |
| La bibliothèque générée stocke une MO sans rôle ou au mauvais taux | Rôle préféré actif du propriétaire, coefficient projeté à son taux, coût/heures exacts ; rôle absent/inactif refusé pour MO avec heures | Garde d'assemblage conservé ; second devis exact |
| Les citations sont utilisées comme identité d'un composant de bibliothèque | `estimate_assembly_items.source_metadata` contient `kind=generated_ouvrage` et `component_id` dérivé du composant SQL validé ; deux composants partageant le même fragment gardent leurs IDs distincts et leurs citations | Identité exacte retenue lors de la réutilisation, sans backfill historique |
| Un défaut tardif laisse une demi-revue | Faute atteinte exactement une fois et rollback complet, y compris sources et décision | Erreur explicite, ancienne revue encore disponible |

Le DTO `rejectedFromStatus` expose `suggested`, `manual` ou `null`. L'origine
est dérivée des anciennes lignes par SQL, après le contrôle du token ; elle
n'est pas un champ d'entrée faisant autorité. `restore:true` indique une
restitution explicite connue. `restoreAsManual` est une
confirmation exceptionnelle pour un rejet historique dont l'origine est
inconnue. Un ancien rejeté modifié sans marqueur de restitution est refusé.
Rétablir puis écarter de nouveau sans édition conserve l'origine ; modifier
puis écarter conserve `manual`. Une absence de métadonnée historique n'autorise aucun backfill
arbitraire. Les rejets nouveaux conservent leur origine à la première décision.
Un composant neuf sans ancienne ligne, créé par la sauvegarde humaine avec
`status=rejected`, reçoit une origine `manual` dérivée de ce chemin de création,
sans marqueur de restitution. Ce cas ne requalifie jamais un rejet historique
identifié dont l'origine manque. La génération initiale conserve `suggested`.

Les heures ne sont pas un critère de coût : `dsCents=0` ne signifie ni rejet
ni absence de MO. L'exclusion dépend uniquement du statut et de l'identité.
Les propositions et leurs sources restent dans la revue/token ; seules les
retenues alimentent mapping, trace MO, bibliothèque et snapshot appliqués.
La source d'un fragment peut être partagée entre plusieurs composants : elle
ne remplace jamais l'identité de la proposition. La provenance de chaque item
de bibliothèque conserve donc `component_id` issu du résultat SQL contrôlé,
jamais d'un champ ajouté arbitrairement par le caller. Aucun ancien item de
bibliothèque n'est réécrit pour fabriquer cette provenance.
Le contrat canonique actuel stocke des heures totales : la MO est calculée
par `h_mo * taux * k_mo`, sans multiplier de nouveau par la quantité. Le
materialize SQL multiplie quantité et heures chacune par le multiplicateur
d'ouvrage. Ne pas transformer arbitrairement `h_mo` en heures unitaires.

## Prérequis et conservation

Lecture locale préalable du 12 octobre 2026 : configuration native
`.e2e/retro-runtime/config/recipe-go-20261012-03/native-config.json`, SHA
`1be0fbd0e439ea6cac061d7fe5c66ea608ed9dab5c5e9d1376a7dd6bc5bfbcf0` ; pile
API `45585`, PostgreSQL `33485`, système `7695571534776503175`, version `17.11`.
Reçu `.e2e/core07-sql/precode-read-20261012-01/receipt.json`, SHA
`fc795e8859a43579404bc5f9ab1f7d70821e813faab230bc3bc52b5dc96921a4`.
CLI et identité vérifiés en lecture seule. À cet instant, aucun composant de
revue rejeté ; 47 items MO de bibliothèques générées, tous sans rôle ; aucune
MO gratuite avec heures. Ces compteurs locaux ne décrivent pas la production.
Les identités de lignes et les paramètres sensibles ne sont pas conservés.

La nouvelle fixture `src/test/fixtures/estimate-generated-components-regression.sql`
utilise un préfixe synthétique neuf `cfc70000`, un DO obligatoirement avorté,
des sous-transactions de cas et un terminal `P9001`. Elle ne crée aucun état
persistant, ne modifie pas les anciennes fixtures et n'installe aucune
migration. Les comptes synthétiques SQL servent exclusivement à qualifier
les RPC/RLS ; ils ne sont pas des comptes de recette navigateur.

Avant/après chaque exécution, comparer indépendamment catalogue, droits,
historique et multiensembles des lignes `public`/`private`, `auth.users` et
métadonnées Storage. Les autres tables Auth, les séquences et les métadonnées
opérationnelles du moteur ne sont pas qualifiées par cette comparaison.
Ne pas confondre un abort volontaire avec une erreur de préparation ; exiger
le marqueur, la liste de cas exacte, les résultats et la conservation.

Préserver les RPC/signatures existantes, EXECUTE réservé à `authenticated`,
helpers privés non exécutables par les rôles API, `search_path=''`, RLS,
triggers, bail, acteur/tenant/projet et ordre des verrous. Les fonctions
definer conservent les contrôles applicatifs ; aucune permission n'est élargie.
Receipts, snapshots et applications historiques restent intacts. Les nouvelles
déclarations remplacent les corps par signature dans une migration nouvelle,
sans réécrire la migration atomique précédente.

Le lecteur natif actuel attend les corps de l'ancienne migration unique.
Avant la recette future, qualifier les dernières déclarations par signature
des migrations ordonnées, avec mêmes exigences d'égalité et d'ACL ; conserver
les anciennes preuves datées. La migration CORE-07 ne doit pas être installée
sur une base partagée/distante sans autorisation propre. L'accord historique
pour `32959` ne couvre pas une nouvelle application.

## Couverture distincte à réaliser

Le DO est séquentiel : il ne prouve aucune course. Un entrelacement réel
sauvegarde-exclusion/commit, puis restitution/ancien commit, nécessite deux
connexions, attente observée par `pg_blocking_pids` et observateur indépendant.
Le résultat doit être un commit cohérent ou un refus métier sans effet ; aucun
mélange de compositions. La recette browser garde ses assertions ordinaires.

Les cibles CCTP lisent les composants appliqués depuis le snapshot. Le filtrage
des nouveaux snapshots exclut donc les propositions rejetées. Les anciens
snapshots peuvent déjà contenir `status=rejected` : le garde de lecture doit
les déclarer incompatibles et la validité des décisions suit les facts et
fingerprints. Un ancien composant sans statut reste compatible. Aucun snapshot
historique n'est réécrit et aucun statut absent n'est inventé.

## Preuves d'exécution

La fixture sera exécutée contre les anciens corps pour un RED avant code.
Les reçus et les limites seront ajoutés après observation réelle ; un test
préparé ou une préparation échouée ne vaut aucune passe produit.

Premier RED conservé :
`.e2e/core07-sql/precode-red-20261012-01/results/receipt.json`, SHA
`7535f6a1346f741c365d672ccce10e077bf3ee607114dce920c050ddafc1f037`.
31 cas, 8 passes et 23 échecs contre les anciens corps ; P9001 et conservation
indépendante vérifiés. La relecture a trouvé un vecteur doublon mal parenthésé
qui devenait NULL et déclenchait la valeur par défaut du helper. Ce cas du
premier reçu ne démontre donc pas une régression produit ; le reçu reste
intact. Le vecteur est corrigé avant code, avec une assertion de taille réelle,
et les deux cas quantité MO ont été ajoutés avant la prochaine exécution.

Second RED relu :
`.e2e/core07-sql/precode-red-20261012-02/results/receipt.json`, SHA
`a8fcf37d7df97c4f067f35e43f5bc98e6e4c1b9ec7472129b90ff774fc80b690`.
Fixture exécutée SHA
`bd922435ebaf5241937ad602b8278ec7457b2c4494d652a06bba3ad53b50c67d`.
33 cas exacts, 9 passes et 24 échecs contre les anciens corps. Le doublon
corrigé passe ; les deux cas quantité MO exposent l'absence de rôle de la
bibliothèque. Les autres échecs exposent les contrats absents de décision,
sélection retenue, restauration explicite et cible CCTP rejetée. Aucun échec
structurel SQL n'a été relevé. P9001 et rollback vérifiés ; les snapshots
catalogue/droits/historique/données sont identiques octet pour octet et les
empreintes des huit artefacts sont relues. Ces passes restent des cas de
refus/conservation de l'ancien produit, pas une recette CORE-07 réussie.
Le contrat conservé dans cette archive est sa version d'entrée, avant l'ajout
de ce compte rendu. Aucun artefact de la première exécution n'est remplacé.

Après clôture des 33 cas, deux vecteurs supplémentaires sont écrits avant la
migration : les quatre propositions initiales sont toutes retenues, puis la
demande de revue les écarte. `pending_review` doit conserver les quatre
origines/sources et refuser l'application ; `reviewed` doit refuser la
demande sans aucun effet. Ce complément n'est pas couvert par le reçu à 33 cas.

Troisième RED relu :
`.e2e/core07-sql/precode-red-20261012-03/results/receipt.json`, SHA
`5919beb7e2fdcefaaef36357167423dcf86811007546accefcc11779e3e0b74e`.
Fixture exécutée SHA
`80f52e1c13e19edb5d1944c07b006ec0ad3938afd4834b956d18763c1d356448`.
35 cas exacts, 9 passes et 26 échecs contre les anciens corps, aucun échec
structurel SQL. Les deux nouveaux échecs confirment la perte des origines
lors de la sauvegarde `pending_review` et l'acceptation indue de `reviewed`
pour quatre composants tous écartés. P9001/rollback et conservation indépendante
du catalogue, des droits, de l'historique et des données vérifiés ; les huit
artefacts sont relus. Les trois archives restent distinctes et intactes.
Aucune migration n'a été appliquée et aucune passe produit CORE-07 n'est
déduite de ces neuf refus/conservations existants. L'application et les courses
réelles nécessitent leurs qualifications propres après implémentation.

La préimage des 35 cas et de leur contrat est conservée sous
`.e2e/core07-sql/before-component-identity-20261012/`. Un 36e vecteur est ajouté
avant la migration pour la provenance d'item de bibliothèque : deux composants
partagent le même fragment mais doivent porter chacun leur propre identité
SQL validée dans `source_metadata`. Son nouveau RED sera archivé séparément.

Le 36e RED est conservé dans
`.e2e/core07-sql/precode-red-20261012-04/results/receipt.json`, SHA
`082a69aa893462d301f068bf7df9aa19f40faada3bb842be3e173bb44cc68a90` :
36 cas, 9 passes et 27 échecs, rollback et conservation vérifiés. La décision
concernant un nouveau composant humain déjà écarté est arrivée pendant cette
exécution : un 37e vecteur est donc ajouté après clôture de l'archive, avant
la migration, pour son origine manuelle dérivée sans affecter les anciens IDs.

Dernier RED précode :
`.e2e/core07-sql/precode-red-20261012-05/results/receipt.json`, SHA
`3dc1747b68114258b5bda31b469534735116985329e52e8aca6e36edd31045b1` ;
fixture SHA `c3dc884874050aa810a701f9fb0af19d32d480c913b6bbe74447b5dec2d2c44b`.
37 cas, 9 passes et 28 échecs contre les anciens corps. Cette version précède
la préparation des nouveaux corps ; les cinq archives précédentes restent
distinctes. Aucune application persistante de migration n'en est déduite.

## Migration candidate et qualification rollback

Le CLI local épinglé, après lecture de son `migration new --help`, a créé
`20261012215942_generated_ouvrage_component_decisions.sql`. Le premier appel
CLI direct sans PATH Linux Node a échoué avant création ; l'environnement
assaini des primitives natives a ensuite été utilisé. L'ancienne migration
atomique conserve SHA
`a75634075eaf645de95f1ae8ff3bb2574f3ea18ed97ea30f580c498b49e2c3e5`.

Le candidat ne comporte aucun backfill ni changement de table ou de signature
RPC publique. Un helper privé canonise le contenu ; `persist` capture l'origine,
consomme les intentions explicites et conserve un historique de décision
acteur/date dérivé côté SQL dans les métadonnées. Les identités déjà présentes
sont obligatoires. Les lignes de texte vides sont ignorées dans la comparaison,
les objets JSON sont comparés par valeur, les tableaux et sources par ordre.
L'historique n'est pas tronqué : les métadonnées cumulées de la revue sont
bornées à 1 MiB et une sauvegarde dépassant ce format est refusée sans effet.

Le helper de projection conserve les seuls IDs `suggested`/`manual` et refuse
le vide. Le commit garde ses contrôles atomiques, dérive le rôle MO du rôle
préféré actif du propriétaire, vérifie son coefficient au taux réel et écrit
l'identité SQL de la proposition dans la provenance de bibliothèque. Un rôle
actif à taux zéro peut conserver une MO de coût zéro et ses heures ; un coût
positif non représentable demeure refusé. Le garde CCTP qualifie les anciens
snapshots rejetés comme incompatibles sans les réécrire.

Les déclarations natives sont désormais pliées par signature et ordre de
migration, et non par le nom d'une unique ancienne migration. Propriétés,
configuration entière, propriétaires, ACL et OID résolus restent vérifiés.
Le réglage CCTP `lock_timeout=2s` ne doit pas disparaître de l'oracle : une
régression du lecteur a été écrite avant ce correctif, RED 8/9 puis GREEN 9/9.
Les préimages des lecteurs sont sous `.e2e/core07-sql/native-before-20261013/`.
Les contrôles de déclarations sont hors DB ; ils ne prouvent aucune installation.

Avant tout usage de la migration sur la base de recette, exécuter une
qualification transactionnelle distincte : lecture d'identité, catalogue,
droits, historique et hashes des lignes ; `BEGIN`, corps candidats sans leurs
deux délimiteurs externes, lecture des corps/ACL/OID dans cette transaction,
suite SQL et exception obligatoire P9001 qui avorte aussi les DDL. Relire
indépendamment l'état depuis une nouvelle connexion après chaque suite.
Exécuter séparément les 37 cas CORE-07, les 100 cas atomiques conservés et
les 34 CCTP. Toute préparation échouée ou suite incomplète reste un échec,
pas une passe. Archiver les sources exactes et leurs empreintes.

Cette validation n'insère aucune entrée dans l'historique des migrations et
ne laisse aucun nouveau corps installé. L'application persistante sur `33485`
reste interdite sans accord propre, même après une qualification rollback.
Une fenêtre exclusive est requise pour la comparaison de conservation.

## Constats de revue avant qualification candidate

La revue indépendante a identifié trois défauts de préparation. La branche
Python CCTP utilisait un nom de variable supprimé lors de l'extraction. Un
vecteur exécute réellement `cctp_evidence` avec des réponses de catalogue
bornées en mémoire : succès complet et refus de privilège/ligne manquante/
doublon. RED 0/4 avec `NameError`, reçu
`.e2e/core07-sql/cctp-branch-checks/e033888e-4854-4fc6-8d94-95451bc6dd35/receipt.json` ;
puis correction de la liste de tables et GREEN 4/4, reçu
`.e2e/core07-sql/cctp-branch-checks/16c10671-3bf2-4fe1-87e8-17075793f936/receipt.json`.
Cette preuve hors DB ne qualifie aucun catalogue installé. Les préimages sont
sous `.e2e/core07-sql/review-before-fixes-20261013/`.

Le candidat comparait encore `componentId` à l'ancien UUID comme texte après
des gardes qui le castent en UUID. Un ID existant en majuscules pouvait être
traité comme neuf et réactiver un rejet sans restitution. Un vecteur avec
UUID équivalent non canonique est écrit avant la correction, et sera exécuté
sur le candidat vulnérable dans une transaction annulée. Le lookup doit
comparer des UUID typés, sans transformer un ID historique en création neuve.

L'historique indiquait aussi `action=reject` pour une simple édition de
suggestion devenue manuelle. Un deuxième vecteur vérifie avant correction
`action=edit`, les deux statuts et l'acteur serveur. La fixture comporte
désormais 39 cas, dont ces deux constats indépendants ; les 37 cas précédents
et leurs archives restent inchangés. Le verrou du rôle est déjà assuré par
le verrou partagé `estimate-calculation:<tenant>` et les triggers exclusifs
de mutation des rôles ; aucun verrou supplémentaire arbitraire n'est ajouté.

Le RED candidat vulnérable est conservé dans
`.e2e/core07-sql/candidate-vulnerable-red-20261013-01/results/receipt.json`, SHA
`128c8bc92e22bde41aa64e307074e046dcecf6d83aab9293c411cfe148e3c909`.
39 cas complets, 35 passes et quatre échecs, corps/ACL/configuration/OID
vérifiés dans la transaction candidate ; P9001 et conservation indépendante
après annulation. Deux échecs reproduisent les défauts de revue : restitution
sans marqueur via UUID équivalent non canonique et édition journalisée comme
rejet. Les deux autres sont des incohérences de fixture : les demandes
rétablir-puis-écarter déclaraient encore `reviewed` avec une composition vide,
que le candidat refuse correctement. Elles sont corrigées uniquement en
`pending_review` pour la qualification suivante, sans changer les assertions
d'origine/conservation et sans réécrire cette archive.

Après ce RED, le lookup est corrigé en UUID typés et l'historique en `edit`
pour l'édition. La correction du collecteur Python a sa preuve distincte
hors DB. Les nouveaux corps et la fixture seront gelés et relus avant le
GREEN complet ; aucune installation persistante n'est encore autorisée.

## Qualification candidate close et protocole d'accord

GREEN transactionnel, reçu
`.e2e/core07-sql/candidate-corrected-20261013-01/results/receipt.json`, SHA
`eb1252ff38905d06490f095bd89f2fecf8ab91812ca43c5c7cbb5c844132f547` :
39/39 CORE-07, 100/100 atomiques et 34/34 CCTP. Les 25 artefacts sont relus ;
corps, signatures/OID, propriétaires, sécurité, configurations et ACL sont
vérifiés dans chaque transaction candidate. Après chacune des trois exceptions
P9001, le snapshot indépendant est identique octet pour octet au témoin SHA
`c7a917d5a0ced741125795017f73eb7d0e024aea0ea01c1ed292190a33ae6b47`.
Cette preuve est séquentielle, sans installation, recette UI ou pgTAP complet.

Sources qualifiées : migration SHA
`7638482293bfe35b39a4defde39c9bd427c900dd715829ff61c8ed11d26573ef`,
fixture SHA `ff91bbb67ea4becb9b78db58be4187733b574fd0220083c40b715532f7df43ef`.
Le candidat ajoute uniquement le helper privé de contenu et remplace les
quatre corps prévus ; aucun backfill des 47 MO historiques et aucune table
nouvelle. La base de recette contient toujours les anciens corps à ce stade.

Le protocole exécutable est
`scripts/tester-army/apply-generated-components-local.py`. Son mode par défaut
exige `--validate-only` ou `--execute` explicitement ; l'exécution exige aussi
SHA fixe, référence d'accord humain et répertoire de reçu exclusif. La
préparation hors DB se trouve sous
`.e2e/core07-sql/application-preparation-20261013-01/` : SQL réel et `plan.json`.
Elle ne contient aucune autorisation et ne modifie pas la base.

Après accord propre pour la seule cible `127.0.0.1:33485/postgres`, système
`7695571534776503175`, API `45585`, le helper contrôle l'identité, le CLI/psql
épinglés et la configuration locale non liée ; il refuse toute migration
pendante autre que le candidat. Il conserve catalogue/droits/historique et
hashes des données avant action. Un seul `BEGIN` exécute les corps, leurs
assertions SQL de sécurité/configuration/ACL et l'entrée d'historique exacte,
puis `COMMIT`. Le corps et l'historique sont ainsi atomiques, sans dépendre
d'un second appel après un COMMIT de migration.

La relecture après action est indépendante : aucune ligne métier modifiée,
aucun droit/table/trigger/historique existant altéré ; seuls les quatre corps,
le helper privé et la nouvelle entrée d'historique sont admis. La source
stockée dans cette entrée doit correspondre exactement au fichier qualifié.
Les derniers corps/ACL sont contrôlés de nouveau ; la copie de migration dans
la pile est exclusive ou vérifiée identique, puis un reload de cache est
demandé. Ce reload ne prouve pas la disponibilité HTTP.

Le reçu enregistre un commit observé même si une étape ultérieure échoue.
Timeout ou résultat incertain déclenche une relecture sans réapplication ; le
répertoire initial n'est jamais réutilisé. Il faut ensuite qualifier la pile
installée avec les 39+100+34 cas et le pgTAP existant, construire l'application
et exécuter la recette TesterArmy. Aucun `--execute` n'est lancé avant accord.

Commande réservée à un accord déjà reçu, avec une nouvelle référence et un
nouveau répertoire :

```text
wsl -d Ubuntu-24.04 --exec python3 -B /mnt/c/Users/maxim/Projects/miaouffrage/scripts/tester-army/apply-generated-components-local.py --execute --migration-sha 7638482293bfe35b39a4defde39c9bd427c900dd715829ff61c8ed11d26573ef --approval-reference <accord-utilisateur-CORE07-33485> --output .e2e/core07-sql/local-application-20261013-01
```

## Application autorisée et qualification installée

Le 13 octobre 2026, l'utilisateur a répondu « Autoriser cette migration locale
uniquement » à la question portant sur ce fichier et `127.0.0.1:33485/postgres`.
Référence d'accord :
`user-core07-local33485-20261013-call_2af1f7702b8442e4a45c1e07aceac332`.
Le runner relu SHA
`94e3897a83ca243a1d3b1ab2ad0f84dd88844a2f15785ec9954d9c92928378f8`
a alors été exécuté une seule fois, sur la cible approuvée.

Application close `verified/commit-verified`, sortie 0 :
`.e2e/core07-sql/local-application-20261013-01/receipt.json`, SHA
`b80bd0ea0770e537f459c77390fc0050baae8f2c8d21af8bca4a7abd6e04b666`.
Corps et entrée d'historique exacte ont été commis atomiquement. Les hashes
de toutes les lignes métier et les droits existants sont conservés : les 47
MO historiques sans rôle ne sont pas modifiées. Le catalogue ne change que
pour les quatre corps prévus et le helper privé ; aucune table, colonne,
relation ou trigger modifié. La copie locale de la migration est vérifiée,
et le reload de cache est demandé. Aucune autre migration, base distante,
réinitialisation ou arrêt de pile n'est impliqué.

Qualification sur les corps **installés**, avec aucune réinstallation de DDL
candidat :
`.e2e/core07-sql/installed-qualification-20261013-01/results/receipt.json`, SHA
`c0a3e53dfe8bad72e100ce1c51a945fc65e19e4b2750773f2ddff442b8379a56`.
39/39 CORE-07, 100/100 atomiques et 34/34 CCTP, aucune erreur. Les corps,
ACL/configurations et OID sont relus depuis la base avant et après chaque
suite. Chaque fixture est annulée par P9001, avec conservation indépendante
du catalogue, des droits, de l'historique et des données. Les empreintes de
ces artefacts et du reçu d'application sont relues.

Cette qualification installée reste séquentielle. Elle n'exécute pas le
pgTAP complet, le navigateur, les courses réelles ou la production : leurs
preuves doivent être réalisées et conservées séparément. Les sources
exécutables restent figées après l'application ; seul ce compte rendu est
mis à jour.
