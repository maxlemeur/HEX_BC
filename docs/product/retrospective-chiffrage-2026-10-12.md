# Rétrospective de l'environnement de travail — 12 octobre 2026

Analyse de la session en cours avec le skill `retro`, après lecture des sources,
scripts, workflows CI et archives locales. Elle porte sur l'environnement de
réalisation ; elle ne constitue pas la recette de l'application complète.
Les propositions ci-dessous ne modifient ni les règles du dépôt ni sa CI.

L'utilisateur a ensuite demandé leur mise en œuvre. La réparation de l'index
est terminée, avec reçu sous
`.e2e/git-index-recovery/authorized-20261012/receipt.json` : sauvegarde exacte
des 235 642 octets nuls, reconstruction depuis HEAD, 2 154 fichiers et statuts
identiques avant/après, zéro chemin stagé. Le staging antérieur à la corruption
reste irrécupérable depuis ces octets ; la sauvegarde est conservée. Les
améliorations de recette ci-dessous gardent leur statut propre de réalisation.

La mise en œuvre livre aussi une recette locale dans `scripts/tester-army/`
pour les ouvrages générés : build avec les budgets existants, qualification
native et pgTAP, seed de témoins neufs, profil explicite, collecte, exécution
TesterArmy et lecteur indépendant. Le cycle réel passe ses sept résultats ;
la compatibilité batch en passe six sur le même build, avec deux exports relus.
Les lecteurs qualifient les archives sans changer les sources ou les faits
métier. La [procédure](../testing/local-recipe-reproducibility.md) conserve les
chemins, empreintes et préconditions. Cette intégration ne termine pas encore
le parcours CCTP depuis une copie propre ni le logiciel complet.

| Priorité | Constat vérifié | Amélioration proposée et résultat attendu |
| --- | --- | --- |
| P1 | Le vrai parcours CCTP a échoué alors que les tests PDF isolés, le build et les traces de dépendances passaient. Webpack avait transformé le chargement en `undefined.resolve`. Le premier correctif compilait encore une variable non définie. | Rendre ce parcours TesterArmy sur build de production reproductible depuis le dépôt et l'intégrer au contrôle des changements concernés. La vérification doit réellement préparer puis lire un PDF et comparer ses octets. Un contrôle statique du nom de fonction ou de la présence du fichier ne remplace pas cette preuve. |
| P1 | Le parcours de référence documentaire dépend encore de scripts sous `/.e2e/`, ignoré par Git. La campagne de couverture dispose désormais de son seed, profil et lecteur dans `scripts/tester-army/`, mais son protocole appelle encore le build `.e2e/product-foundation/build.cjs` et les helpers natifs ignorés. | Achever l'intégration des parties stables en réutilisant le lanceur et le runtime natif existants. Garder résultats et secrets ignorés. Critère : une copie propre du dépôt prépare un nouveau témoin local, exécute le scénario et vérifie son archive avec une commande documentée. |
| P1 avant publication | L'index Git original contient des zéros ; le travail a été comparé à HEAD avec un index alternatif. Cela préserve les fichiers mais ne récupère pas l'état de staging antérieur. | Préparer une récupération explicite de l'index avec sauvegarde, inventaire et contrôle des fichiers avant/après. Faire décider cette réparation avant toute publication ; ne pas remplacer automatiquement l'index pendant une recette. |
| P2 | Le démarrage d'une pile native complète a révélé un test transactionnel resté sur une API d'achat révoquée et une fixture sans unité, malgré les validations ciblées précédentes. | Exécuter la suite pgTAP complète dès la première installation d'un ensemble de migrations liées. Le contrôle existe déjà dans `db:ci:local` et `e2e-rls-matrix.yml` : le lancer plus tôt, sans inventer une nouvelle règle. La fixture a été corrigée en conservant les assertions de provenance, refus d'accès et rollback tardif ; les 1 232 assertions passent. |
| P2 | Le plan de référence documentaire séparait cinq lots et plaçait l'interface en dernier. Le problème de packaging n'est devenu visible qu'au parcours applicatif. | Pour la prochaine tranche, livrer d'abord un petit parcours complet : citation du CCTP, lien vers une ligne, décision motivée, rechargement et changement à revérifier. Étendre ensuite la matrice métier et technique autour de cette chaîne utilisable. Maintenir les contrôles d'accès et de conservation dès le premier parcours. |
| P2 | Plusieurs campagnes ont échoué sur le harnais avant d'atteindre les décisions : scope de déconnexion global du lecteur, libellé mobile utilisé sur desktop, signe `+` oublié, puis textarea confondu avec le résultat enregistré. | Parcourir une première fois le chemin nominal complet dans l'interface réelle avant de multiplier les cas. Réutiliser les sélecteurs des parcours existants et attendre la fin observable de l'enregistrement avant sa lecture indépendante. Regrouper les corrections confirmées par la revue ; conserver les résultats rouges et les assertions métier exactes. Lint et typecheck existent mais ne détectent pas ces erreurs de séquence. |
| P2 | Les passages Windows/WSL ont nécessité des profils, chemins, runtimes et ports particuliers. Plusieurs lecteurs de qualification répètent les contrôles de source, build et confidentialité. | Réutiliser les primitives Supabase natives existantes pour un précontrôle commun et un lecteur d'archive partagé. Il doit afficher les versions, ports, identités de build et seuls contrôles en échec ; les détails restent dans l'archive. Aucune modification automatique des ports système. |

La CI possède déjà lint, types, OpenAPI, tests Node/jsdom, budgets et smoke de
production. Le build de `quality-gate.yml` est exécuté sur main et en nocturne,
pas sur PR ; le smoke vérifie accueil, connexion, redirection et ressource
statique. Le smoke TesterArmy CI est anonyme. L'écart est donc le parcours métier
compilé et son lancement reproductible, pas l'absence générale de garde-fous.

Deux corrections de preuve sont déjà faites : le compteur OpenAPI figé a été
retiré en conservant la comparaison des opérations réelles ; les compteurs de
requêtes avant/après rechargement sont archivés depuis deux mesures réelles.
Une première archive répétait la valeur initiale, alors que l'assertion du
scénario mesurait correctement le résultat. Les échecs précédents sont conservés.

La recette de couverture a ensuite exposé un autre manque de diagnostic : un
poll de sauvegarde échouait sur un booléen sans archiver les montants lus.
Le helper conserve désormais chaque observation utile. Le rejeu montre
explicitement le passage de 400 € HT stockés à 710 € HT après Ctrl+S et
rechargement. Le runner utilise son option existante `--max-failures 1` :
les douze tests restent sélectionnés, mais une première erreur arrête la
campagne avec les autres résultats marqués non exécutés. Le contrôle de
qualification exige toujours douze réussites, sans exclusion.

La campagne finale a effectivement passé les douze résultats. La relecture
indépendante de l'archive a trouvé une collision entre `s0.json` et
`exports-s0.json` dans le lecteur de qualification ; le nom complet incluant
le préfixe de fixture remplace la recherche par suffixe. Une copie relue a
qualifié l'archive avec 3 022 contrôles réussis avant promotion du correctif
dans l'outil durable. Les preuves et les assertions métier sont restées
inchangées. La sortie très rapide après reload demeure une anomalie de bail
à isoler ; attendre une page éditable dans le parcours principal ne la répare
pas. Les résultats et limites sont détaillés dans la
[recette de couverture](../testing/source-coverage-e2e.md).

L'inspection des fichiers compilés a évité un nouveau lancement voué à l'échec.
Le diagnostic Webpack minimal, lui, passait aussi avant correction : il n'a pas
reproduit la configuration Next et ne doit pas être présenté comme preuve de
non-régression. Le résultat applicatif et ses limites restent dans la
[recette CCTP](../testing/source-reference-vertical.md).

Sources principales : [CI](../../.github/workflows/quality-gate.yml),
[smoke de production](../../src/test/production-build-smoke.ts),
[lanceur TesterArmy](../../scripts/run-tester-army.mjs),
[scénario CCTP](../../e2e/army/local/source-reference.e2e.ts),
[plan initial](../testing/source-coverage-reference.md),
`.e2e/git-index-recovery/receipt.json`, les campagnes CCTP et
`.e2e/source-coverage/backend-staged/packaged-worker-first-fix-rejected.json`.

Aucun gain de temps chiffré n'est établi. Aucune instruction globale, mémoire,
règle de revue ou autorisation de publication n'a été ajoutée par cette analyse.

La tranche suivante (création et totaux atomiques) applique cette leçon : une
baseline sur le build existant archive chaque réponse `201` et sa première
relecture, avant toute assertion et sans ouvrir l'éditeur. Elle a révélé trois
défauts distincts : pied resté à zéro, activation implicite de la ventilation MO
malgré le réglage désactivé, et calcul avant coercition décimale PostgreSQL.
Deux erreurs de préparation du scénario (statut `201` du verrou, parent de
ligne obligatoire) ont été corrigées sans modifier les oracles financiers.

Nouvelle priorité P1 de revue : avant de remplacer une primitive d'écriture,
inspecter ses appelants et leurs compensations. Ici, ajouter les totaux à
l'effet d'une création rend insuffisantes les anciennes annulations batch et
ouvrages, qui suppriment seulement les nouvelles lignes. La revue indépendante
l'a identifié avant qualification du correctif. La recette doit provoquer une
erreur après la création puis vérifier la restauration des lignes, allocations
et totaux, y compris face à une écriture concurrente. Ce contrôle relève du
jugement sur les effets transactionnels ; une nouvelle règle de style ou un
test de présence de code n'en apporterait pas la preuve.

La revue SQL a également exposé l'importance de l'ordre réel des triggers :
un tenant nul était normalisé après la prise du verrou, permettant un déplacement
de rôle dans une destination non protégée. Deux connexions ont reproduit le
défaut avant une migration additionnelle, puis le même cas a confirmé le refus.
Cette régression native doit rester dans la recette durable du module ; les
45 cas séquentiels passaient déjà et ne prouvaient pas cette concurrence.
Les [preuves SQL](../testing/estimate-create-atomic-native.md) distinguent aussi
les conflits immédiats des vrais blocages observés entre processus.

Le défaut de compensation a ensuite été reproduit par WFC01 sur le vrai serveur :
le batch répondait `committed:false`, mais le pied restait à 7 ct au lieu de 5
et une ancienne ligne à 2 ct au lieu de 3. Le retrait de la nouvelle ligne
n'établissait donc pas un rollback. L'archive précède la correction et conserve
le premier GET fautif, sans ouverture de l'éditeur ni réparation automatique.
La création individuelle qualifiée a également été rejouée dans les douze
parcours CCTP : les totaux y sont désormais exacts dès chaque création.

La revue du nouveau client a trouvé deux erreurs avant recette : une réponse
GET illisible pouvait être confondue avec un reçu absent, et une vérification
en vol pouvait laisser la nouvelle page occupée après changement de devis.
Le transport exige maintenant une enveloppe JSON valide et l'état d'attente
est réinitialisé à la frontière de page/compte. Le cas de lecture illisible
fait partie du parcours réel préparé ; cette préparation n'est pas encore une
preuve exécutée à cette étape. Continuer à distinguer les refus confirmés des
résultats inconnus, y compris dans les fixtures et les messages de l'interface.

La campagne batch a ensuite montré une différence entre conservation des
données et information de l'utilisateur : les 100 lignes et leurs totaux étaient
exacts, mais le rechargement effaçait le message de collage partiel et affichait
une fausse attente de sauvegarde. BC04 vérifie désormais le message, l'état à
jour et une fenêtre sans écriture de réparation, en plus des valeurs persistées.
Les six résultats et leurs 2 640 contrôles d'archive passent après correction.
Action P1 déjà appliquée : conserver ces assertions d'interface dans le parcours
métier, sans les remplacer par un simple GET correct.

Action P2 proposée pour le laboratoire natif : réutiliser dans la répétition
avec rollback les requêtes exactes de vérification après installation. Une
parenthèse superflue d'un SELECT de métadonnées n'a été détectée qu'après le
commit local. La reprise a relu l'état et confirmé la conservation sans
réappliquer la migration ; cette distinction doit rester automatisée lors de
l'intégration des helpers au dépôt. Le défaut concernait le script de preuve,
pas une migration appliquée deux fois.

Action P2 d'organisation : après une revue close, ne relancer une revue que
sur un nouveau diff ou un défaut concret. La session a nécessité plusieurs
gels de sources et passages de relais entre SQL, build et navigateur. Un seul
propriétaire de chaque fenêtre de base et une revue ciblée du changement
réduisent les reprises inutiles ; aucun gain de durée n'est encore mesuré.
Un temps mort concret a aussi été identifié : un message adressé à un agent
déjà terminé ne relance pas son travail. Le statut des agents a permis de le
voir ; la revue a repris avec l'outil de relance existant. Vérifier qu'une
délégation attendue est effectivement active évite cette attente silencieuse,
sans ajouter une nouvelle règle globale.

Le contrôle pgTAP a répété le problème des compteurs figés : le moteur de tests
passait, mais le wrapper exigeait encore 1 232 assertions. Les deux nouvelles
fonctions publiques ajoutent automatiquement deux vérifications de sécurité.
Le lecteur a été corrigé et relu : il contrôle la liste des fichiers, le résultat
et les plans validés par `pg_prove`, puis enregistre le nombre observé. Le reçu
initial en échec reste conservé ; la réconciliation de ses sorties confirme
1 234 assertions sans relancer la base. La sortie TAP individuelle n'était
pas archivée : aucune mesure directe des skips/TODO n'est inventée. C'est une
correction mécanique de l'outillage, pas une nouvelle instruction globale.

WFC02 a confirmé le même défaut de compensation dans les ouvrages, avec deux
formes distinctes : anciennes allocations erronées dans le premier témoin,
section de repli orpheline dans le second, et brouillon appliqué dans les deux.
Les séquences QA ciblées, dont les compteurs survivent au rollback, établissent
que la faute tardive a réellement été atteinte. Leur retrait vérifié conserve
les données fautives comme preuve. Cette méthode est réutilisable ; elle évite
de confondre une erreur de préparation du scénario avec le défaut recherché.

Action P1 pour la recette de revue humaine : comparer l'état local affiché à la
dernière revue enregistrée, puis vérifier que l'application est désactivée après
une modification. Le formulaire de composants savait afficher « Revalider »,
mais le parent conservait son autorisation d'insertion. La correction relie les
deux états ; son scénario métier reste à exécuter. C'est une frontière de
validation à examiner entre composants, pas une nouvelle règle de formatage.

Les tests existants ont aussi détecté une régression introduite dans le contexte
des dialogues : l'ajout de l'acteur et du tenant avait été oublié dans la voie
d'hydratation V0. Deux assertions sont devenues rouges, puis les 27 tests UI sont
repassés après correction. Aucun nouveau contrôle statique n'est nécessaire :
conserver et exécuter cette couverture est l'amélioration pertinente.

La revue SQL des ouvrages a trouvé deux frontières que le seul total ne protège
pas : redistribuer des coûts entre composants en gardant le même total, et relier
une source d'un autre brouillon. Les cas natifs ont été définis avant correction.
Elle a aussi révélé l'écart `1.005 × 0.1` entre l'arrondi binaire JavaScript et
l'arrondi décimal SQL. Un témoin rouge précède le correctif du produit décimal ;
le calcul de vente existant reste inchangé.

Action P1 de qualité de preuve : un refus de scénario natif doit être un refus
métier attendu, pas une erreur de compilation SQL. Le premier run n'atteignait
aucun cas ; le suivant a exposé des noms PL/pgSQL ambigus. Les deux archives
conservent l'échec et la preuve de rollback. Le lecteur et la fixture sont
renforcés pour rejeter ces faux positifs et attester l'atteinte des fautes
tardives. Cette correction appartient au harnais déterministe, pas à une
nouvelle consigne générale de prudence.

Action P2 pour les revues de protection SQL : suivre les écritures appelantes
jusqu'au bout du parcours. L'interdiction d'écrire directement les statuts
protégeait l'application, mais bloquait aussi deux helpers d'archivage encore
actifs après génération et dans sa voie d'échec. Une recherche limitée aux
DELETE ne les voyait pas. Le parcours de seconde génération et les cas de
clôture atomique sont ajoutés à la recette ; leur préparation seule ne vaut
pas réussite.

Action P1 de recette métier : comparer les relations et les valeurs de chaque
maillon, pas seulement leur nombre et le total final. La revue indépendante
de GO06 a trouvé que des fragments corrects pouvaient masquer l'absence de
liens candidat-source ; GO03/04 pouvaient conserver un ancien coût dans la
bibliothèque malgré un pied exact. Les assertions sont renforcées avant la
première campagne de reprise. Ce sont des lacunes du harnais identifiées par
lecture, pas des défauts produit observés. La bibliothèque préexistante doit
aussi être capturée explicitement : le générateur la charge même quand son
texte ne correspond pas au texte saisi.

Action P2 d'économie d'outillage : afficher le statut, le chemin du reçu et
ses seuls contrôles en échec. Les sorties complètes de reçus avec dizaines
d'artefacts et corps SQL ont été tronquées plusieurs fois pendant cette
session ; les fichiers archivés sont plus utiles pour une lecture ciblée.
La CI et ses contrôles existent déjà. L'amélioration porte sur la réutilisation
des lecteurs et leur sortie concise, sans multiplier les consignes globales.

La première campagne GO s'est arrêtée à la connexion : API locale refusant
la connexion, six scénarios non exécutés. Les deux piles WSL n'avaient plus
de processus ni de listener ; les données persistaient. La récupération de
la pile jetable exige son répertoire, ses ports et son identifiant PostgreSQL
avant `start`, puis compare les catalogues, droits et 120 tables métier au
dernier snapshot. Cette vérification passe, ainsi que le login ordinaire.
Les métadonnées de `auth.users` changent avec ce login et sont explicitement
exclues de la comparaison des valeurs, avec leur nombre conservé. Aucun reset
ni bootstrap n'a été demandé. Une première tentative de lanceur a reçu les
bibliothèques PostgreSQL via `LD_LIBRARY_PATH` et s'est arrêtée avant changement
du state ; l'environnement CLI corrigé est archivé séparément. L'adaptateur
suivi isole maintenant l'environnement du CLI de celui du client SQL et
vérifie la disponibilité réelle avant tout scénario métier.

Le cycle de recette a trouvé deux défauts de son orchestration : collision
des noms de reçus parent/enfant, puis refus d'un chemin relatif pourtant
confiné. Les correctifs gardent les créations exclusives et la vérification
stricte des chemins. Les cycles échoués restent conservés. Le navigateur a
ensuite exposé une lecture de réponse interrompue par reload et deux erreurs
de sélection du harnais ; leurs corrections capturent la vraie réponse et
utilisent les contrôles réels, sans remplacer les oracles métier.

Un vrai défaut produit a été distingué de ces problèmes de harnais : la reprise
d'un ouvrage laissait les totaux « En attente » malgré un buffer vide. La
réévaluation du buffer après résolution vérifiée supprime ce faux état ; GO01/02
et les six parcours batch le vérifient sur le même build. La deuxième
application partielle compare tous les champs métier de la première ligne et
sa date technique valide non décroissante, plutôt que de supposer que le
recalcul n'avance jamais `updated_at`.

Le lecteur strict a signalé deux sentinelles ambiantes de modèles locaux
inutilisés, présentes comme mot ordinaire dans un nom de fichier et un
commentaire. Leur classification indépendante puis leur retrait du seul
processus lecteur permettent une nouvelle qualification : 24 529 contrôles,
491 fichiers examinés, zéro échec. Aucun seuil de longueur ni exclusion
automatique de credentials n'est ajouté ; le `read-stage` initial reste failed.
La qualification batch vérifie séparément 3 126 contrôles et 196 fichiers texte.

Un reliquat d'outillage a été observé : quand le SDK échoue avant de
produire un rapport frais, le runner n'archive pas de manifeste daté et une
invocation suivante remplace le manifeste transitoire. Deux setups batch ont
montré ce cas (cache Chromium puis refus d'accès réseau du sandbox), avant une
vraie campagne 6/6 hors sandbox. Les sorties disponibles et un diagnostic
postérieur sont conservés, sans fabriquer les manifestes perdus. Le correctif
archive aussi ces échecs et distingue explicitement
rapport absent, rapport obsolète et rapport frais, sans promouvoir les setups
en passes. Les neuf cas du harnais passent après RED conservés ; la revue a
aussi fait corriger un delta de log pris après expurgation, un UUID dans un
JSON imbriqué et un ancien rapport de moins d'une seconde. Le grand stdout
est réellement exercé et borné. Voir la [preuve d'archivage](../testing/tester-army-setup-archive.md).
L'expurgation qualifiée porte sur les archives et erreurs de manifeste ; le
relais console brut préexistant ne reçoit pas cette qualification.

Une autre amélioration de diagnostic est exécutée sur un build neuf :
deux parcours de verrou gardent les dates, les observations DOM et les valeurs
API/RLS avant leurs assertions et en cas d'échec. La connexion et les deux
parcours passent dans `2026-10-12T19-30-14-423Z`, sans filtre, skip, modèle ou
trace authentifiée. La sortie rapide naturelle n'a pas reproduit CORE-06 ;
elle ne suffit donc pas à décider une correction de session. Le second
document hérite réellement du stockage puis adopte une identité distincte,
reste en lecture seule et observe la sauvegarde du premier. La lecture indépendante
réussit 17 985 contrôles d'archive et de valeurs. Les ordres
déterministes d'acquisition/libération restent ouverts, comme décrit dans le
[contrat de navigation](../testing/editor-navigation-lease.md).
