# DOS-CAL-01 : recette des exigences et décisions

## Requalification après CORE-08 — 12 octobre 2026, 02:44 UTC

La campagne neuve `coverage-existing-09` passe **12/12**, sans filtre, skip,
flaky ni appel modèle, avec 26 téléchargements réels. Archive exacte :
`.e2e/army/coverage/runs/2026-10-12T02-44-52-792Z` ; manifeste SHA
`5281173e556258225e590e014de201543d2a4f7f3584a44dc86c72ba802bc013`.
Le build Windows `VvHbNXoMA0g2N-2OfwSpb` et les sources restent stables
pendant l'exécution Windows, sur la seule pile locale autorisée API45585.

Le lecteur canonique qualifie cette archive avec **3158 contrôles, zéro
échec** : `.e2e/army/coverage/qualifications/2026-10-12T02-44-52-792Z-3ae92fa7/qualification.json`,
SHA `5e7120b5e8aeb9384cd78659b0b92023518b506a378d8ce3bc136c20d9111384`.
Les trois créations après L1 sont relues immédiatement après leur HTTP201 :
48000/9600/57600, 53000/10600/63600, puis 71000/14200/85200 centimes.
Leur ouverture et leurs deux reloads n'envoient aucun bulk de réparation ;
la fenêtre observée de trois secondes reste sauvegardée, sans CtrlS.
L'application initiale de L1 conserve son parcours de sauvegarde existant.
Les huit exigences, sept décisions, invalidations ciblées, décisions
obsolètes et reprise après réponse perdue gardent leurs oracles précédents.

La qualification reste limitée aux onze parcours métier sélectionnés et à
l'authentification ordinaire. Elle ne prouve pas l'exhaustivité d'un CCTP,
la matrice complète des rôles, les courses natives, la suppression physique
d'une source ou les pixels/PDF imprimés. L'éditeur est attendu prêt avant
navigation : la sortie rapide ayant laissé un bail au run07 reste un défaut
CORE-06 distinct, non corrigé par cette campagne. Les anciennes archives,
dont le S0 historique à 40000 avant sauvegarde, restent inchangées.

Préparation du 12 octobre 2026, avant implémentation des exigences. Ce fichier
complète l'[oracle](source-coverage-oracle.md), le
[contrat](../product/source-coverage-contract.md) et le
[plan de droits](source-coverage-access-plan.md). Aucun nouveau scénario
n'est encore exécuté. Les noms des routes et DTO attendent leur accord.

## Préconditions et parcours

Une nouvelle campagne ARMY possède son acteur, tenant et unique rôle actif de
pose à 4 000 centimes/heure. Le seed peut préparer deux PDF synthétiques et un
brouillon d'ouvrage avec ses composants pendants. Il ne crée ni application,
ni snapshot, ni décision de couverture. L1 résulte de la reprise, revue et
application réelles dans l'éditeur. L2/L3/L4 et les deux sections suivent les
opérations canoniques du devis. H1/M1 sont créées par le registre existant,
portée `lot`, version V et section SB, puis relues par leur identité.

S0 exige exactement deux sections, quatre lignes, 71 000/14 200/85 200
centimes et huit heures, après sauvegarde confirmée puis vrai reload. Les
exports standard et DPGF sont téléchargés et parsés selon l'oracle. Le
composant C-ISO doit appartenir au snapshot et à l'application réellement
produits pour le parent L1 courant, avec unité m et quantité 10.

Les identités de zone/réseau sont déclarées explicitement. Le contexte de
section DPGF est un choix distinct, nécessaire à la compatibilité du registre ;
ni un titre ni la proximité visuelle ne créent cette relation.

## Scénarios à matérialiser avant le produit

| Parcours | État et résultat observables |
| --- | --- |
| SC-01/02, référence et huit exigences | Retenir A, consulter sa copie SHA vérifiée, créer E1–E8 et leurs citations. Initial : huit non arbitrées/non revues. Après sept décisions : 1 non arbitrée, 2 chiffrées, 1 incluse ailleurs, 1 exclue, 1 autre lot, 2 provisoires ; validité 1 non revue/7 à jour/0 à revérifier. E2 n'est jamais une omission certifiée. |
| SC-02, complétude humaine | L2 est lié partiellement à E3 ; conserver ce lien n'autorise pas une décision Chiffré. Ajouter L3 ne change pas la complétude automatiquement. Un geste humain explicite déclare ensuite la prestation entièrement traitée avec son motif. Le test n'attribue pas au logiciel une compréhension sémantique automatique de C2. |
| SC-03/07, cibles et preuves | Refuser page 0/4, passage vide/non vérifié, section à la place d'une ligne, autre version/affaire, modèle seul, candidat non appliqué, composant absent/rejeté et registre incompatible. Refuser Exclu sans motif, Autre lot sans destination et Provisoire sans registre lié. Aucun échec ne remplace la décision précédente. |
| SC-04, référence B | Dépôt/principal/préparation B gardent A et S1. Confirmation B rend les sept décisions à revérifier, en conservant les traitements et citations A. Une citation A ne revalide pas sous B. Vérifier B/C3 et revérifier E4 seulement : 1 à jour/6 à revérifier/1 non revue. Aucun coût ou calorifuge ne s'adapte automatiquement. |
| SC-05, registre canonique | H1 open→validated invalide seulement E7/E8, qui restent provisoires. Leur revue puis H1→open les invalide à nouveau. Une modification de M1 n'affecte que E7. Relire les événements du registre et de décision, sans copie modifiable de H1/M1. |
| SC-06, mutations ciblées | Sœurs indépendantes de S1 : L2 quantité5→E3 seule ; L1 quantité12 ou heures6→E1 ; suppression L1→E1 avec faits historiques conservés. L4 quantité7, prix seul, marge seule et ordre seul ne périment pas les sept décisions. Les montants exacts restent ceux du tableau de l'oracle. Le retour à l'ancienne quantité ne restaure pas une décision à jour. |
| SC-08, reprise | Ignorer une vraie réponse après commit, recharger sans POST automatique, reprendre la même clé/corps : même décision/événement, aucun doublon. Même clé/autre contenu : conflit. Faute avant commit : aucun événement nouveau. Les deux points de panne sont qualifiés séparément. |
| SC-09, panne et droits | Réponse 503 ou JSON incohérent : indisponible, aucune confirmation, jamais zéro exigence ni À jour inventé ; retrouver les mêmes décisions sur le vrai serveur. Refus de lecture propre à un compte : aucun changement global de validité. La matrice des droits et les courses natives restent des preuves distinctes. |
| SC-10, conservation | Archivage motivé E5 : sept exigences actives, aucune exclusion active, historique E5 conservé. Duplication : nouvelles identités, aucune décision héritée à jour ni cible ancienne acceptée. |

Chaque scénario destructif établit S1 par les opérations métier sur sa sœur.
Aucun seed SQL de couverture finale, reset silencieux, génération IA ni
modification d'un compte historique. Les sources/build restent gelés pendant
chaque run ; les résultats sélectionnés/exclus ne sont pas confondus.

## Défaillances du runner définies avant son adaptation

- Sans profil explicite, refuser avant tout serveur, navigateur ou appel DB.
- Une origine distante, un backend différent du profil ou de la fixture, un
  chemin échappant au dépôt, une fixture non ARMY/non prête ou un build dont
  les sources ont changé doivent arrêter la préparation.
- La collecte seule ne démarre ni serveur ni navigateur et ne qualifie pas
  le métier. La campagne exige production, login ordinaire, traces off et
  zéro modèle ; aucune déduction à partir d'un simple résultat de collecte.
- Archiver profil sans secret, identités de fixture, commandes, révision,
  hashes des sources/build et résultats attendus/réels. Nettoyer secrets,
  JWT et identités de session avant le calcul des hashes des artefacts.
- Un rapport absent/ancien, un scénario sélectionné non exécuté ou une source
  modifiée ne peut produire une qualification complète. Ne jamais choisir
  automatiquement une ancienne archive verte.

L'adaptation est limitée au runner versionné `scripts/run-tester-army.mjs`,
à sa sélection dans `e2e.config.ts` et aux aides spécifiques sous
`scripts/tester-army/`. Les résultats et profils contenant les chemins locaux
restent sous `.e2e/`. Les anciens modes et archives restent conservés. Le
profil fixe l'origine autorisée de la campagne ; aucun port de cette machine
n'est figé dans les scripts durables.

## Préparation vérifiée, sans exécution métier

Les fichiers `e2e/army/local/source-coverage.e2e.ts` et
`source-coverage-support.ts` portent actuellement **onze parcours métier**,
plus le login ordinaire. La collecte complète découvre ces douze entrées
sur chromium-desktop. Elle n'en exécute aucune.

La sélection couvre le nominal à huit exigences, la référence B, le registre,
quatre mutations (quantités L2/L1/L4 et prix L2), la réponse perdue d'une
décision, les lectures 503/JSON incohérent, le renouvellement de complétude
après modification technique et le refus d'un ancien aperçu. Le scénario
503 part d'un vrai aperçu déjà acquitté et confirmable ; il exige ensuite
une confirmation absente ou désactivée. Les fautes sont injectées lors du
bouton d'actualisation, sans prétendre intercepter la lecture serveur SSR.

Les contre-exemples complets de cibles, pages et rôles, les mutations heures,
marge et ordre, la suppression, l'archivage et la duplication restent définis
dans le plan mais ne sont pas couverts par cette sélection initiale. Aucun
résultat du lecteur de qualification ne doit leur attribuer une preuve.

Contrôle CLI réel conservé dans
`.e2e/source-coverage/infrastructure-checks/2026-10-11T23-46-00-281Z-b0981b92` :
quatre refus attendus exit3 (profil absent, origine distante, chemin hors
dépôt, mauvais SHA de build) et collecte sans credentials exit0, **5/5**.
Le reçu a pour SHA-256
`f2b604540a7cc3d5cc1f188e8b7c19bc6703a8ca13c8ca9e30807a3cf31c65d1`.
Les commandes, diagnostics, manifestes et douze noms collectés sont retenus.
La collecte porte explicitement `fixture:null` et
`fixtureStage:not-verified-discovery-only`. Aucun provisionnement, serveur,
navigateur, authentification ou accès à la base n'a été exécuté par ces checks.
Le lint ciblé et le typecheck passent ; ils ne qualifient pas le produit.

Le seed durable `scripts/tester-army/seed-source-coverage.mjs` a été préparé
avant son exécution décrite ci-dessous. Son profil exige les empreintes du reçu de pile, de
l'application SQL locale et d'une fixture sentinelle connue, avec l'origine
exacte fournie explicitement. Il ne touche aucun rôle historique. Il garde
les états ambigus et ne rejoue aucune mutation automatiquement.
Les corpus A/B sont versionnés sous `e2e/fixtures/source-coverage`, avec les
mêmes octets que la recette précédente. Un reçu de préconditions ne
remplace ni la preuve de l'application réelle du sous-détail, ni la création
des huit exigences par l'interface, ni la lecture native des tables privées.

L'ajout ou la modification d'une citation remet la complétude à partielle.
SC04 exige donc un nouveau geste « Prestation entièrement traitée » et un
motif, après vérification de B/C3, avant la nouvelle décision chiffrée de E4.

## Mode de pile neuve : défaillances définies avant adaptation

Le profil peut demander explicitement `fresh-stack` pour une nouvelle pile
native complète. Ce mode ne fabrique pas de sentinelle métier et ne prend
jamais la pile historique comme cible de secours. Avant toute mutation :

- Un reçu absent, non vérifié, expiré ou déjà consommé doit être refusé.
- L'origine, le project_id de pile, son répertoire, son identité PostgreSQL
  et ses ports doivent correspondre aux reçus épinglés ; recopier l'identité
  de la pile exclue ou réutiliser un de ses ports doit être refusé.
- Les SHA de toutes les migrations et du candidat couverture doivent
  correspondre aux fichiers actuels et à l'historique installé attesté.
- L'inventaire natif avant fixtures doit être explicitement vide, y compris
  Auth, Storage, références et couverture privées. Une lecture REST vide
  ne prouve pas ces derniers états et ne les remplace jamais.
- Des métadonnées contenant credentials, JWT ou URL de connexion avec mot
  de passe doivent être refusées ; les secrets restent dans l'env ignoré.
- Une issue ambiguë conserve le reçu et consomme son créneau ; aucune
  nouvelle identité, compensation ou reprise automatique n'est permise.

Après provisionnement, `ready` prouvera les nouvelles préconditions et les
lectures ordinaires explicitement exécutées. Il ne revendiquera ni la
préservation d'une base historique non inspectée, ni une nouvelle lecture
REST des tables privées. Le mode de sentinelle existante reste inchangé.
Les essais de refus du nouveau mode restent à exécuter séparément ; le
premier provisionnement autorisé est décrit ci-dessous.

Exception de bootstrap vérifiée dans les migrations, avant le code du mode :
`013_multitenant_core_s5.sql` crée un tenant `hydro-express`, sans créateur,
même dans une pile neuve. Le reçu doit donc attester exactement ce tenant
de base et zéro acteur/tenant d'acteur ; le seed ne doit ni le supprimer,
ni inventer `tenants:0`. La fraîcheur du reçu est bornée à quinze minutes
au démarrage et juste avant la première mutation. Un claim local exclusif
par identité de pile empêche deux seeds d'utiliser le même état initial.

## Première préparation réelle, avant les parcours UI

Le seed `coverage-fresh-01` se termine **exit0 à 00:38:51 UTC le 12 octobre
2026** sur la nouvelle pile native `miaouffrage-coverage-729799711d9c404b`.
L'ancienne pile n'a pas été contactée. Onze sœurs sont prêtes, chacune avec
SA/SB, une proposition pending_review et deux PDF intake. Les 22 fichiers
sont relus byte-for-byte sous le nouvel acteur ordinaire. Les onze lectures
initiales constatent zéro ligne finale/application/snapshot/entrée du registre.

- Fixture : `.e2e/army/coverage/fixtures/coverage-fresh-01/fixture.json`, SHA
  `7fde469ed2559b5b3fe3eb225606c97322fd8d3834c4455dc6906460ddfeade3`.
- Provisionnement : `provisioning.json` voisin, SHA
  `a00bd79e07796d1c3faec208998d55208a331043eb90d675cfc5b68d7a817d44`.
- Contrôle des onze empreintes initiales et scan de quatorze fichiers texte :
  `disposable-native/runs/729799711d9c404b/coverage-preparation/fixture-integrity.json`
  sous `.e2e/source-coverage/`, SHA
  `6447f304cbae6b7b3c6acc64366853dc32e8bb141639f318c669e820da1fe582`.

Le profil run réel a passé le contrôle hors réseau du build Windows
`51WJ18kp0EVXbXrlkKkQg` pour cette nouvelle origine et du runtime Linux.
Cela n'établit ni un parcours UI, ni S0/S1, ni une relecture privée après
provisionnement. Les courses natives puis les douze résultats UI restent
à exécuter. Aucun secret configuré ni JWT n'est trouvé dans les reçus scannés.

## Contrat du correctif de sauvegarde V2 — avant implémentation

Le scénario déjà rouge ajoute trois lignes par POST public après une première
ligne sauvegardée, recharge, puis utilise Ctrl+S sans tampon de modification.
Les lignes totalisent 71000 HT tandis que l'en-tête reste à40000 ; « À jour »
et un Ctrl+S sans effet constituent la défaillance observée.

Le correctif retenu est borné à la sauvegarde explicite d'un brouillon V2 :
Ctrl+S ou « Sauvegarder maintenant » doit appeler la réconciliation bulk
canonique existante, paginée et protégée par CAS, même sans modification locale.
Les totaux réellement retournés deviennent la référence affichée. Après
rechargement complet, un écart entre projection et totaux stockés interdit le
badge « À jour » ou « Sauvegardé » ; sa détection seule ne doit programmer
aucune écriture automatique supplémentaire. Les versions non brouillon,
lecteurs, verrous détenus ailleurs et conflits gardent leurs refus existants.
La revue a aussi fermé la nouvelle entrée de réconciliation sans tampon tant
qu'un brouillon récupérable attend un choix : un conflit ne doit pas écraser
ce brouillon par la projection actuellement affichée. Les modifications
explicitement restaurées conservent leur sauvegarde habituelle.

La recette exige toujours les valeurs persistées71000/14200/85200, puis leur
conservation après nouveau rechargement, sans retoucher artificiellement une
ligne ni injecter des montants par un PATCH de test. Les trois POST201 seuls
ne constituent pas une garantie atomique ligne+en-tête dans cette tranche :
cette limite API demeure explicite. Aucun nouveau test unitaire n'est ajouté
après le code ; le scénario réel rouge et les suites retenues sont réutilisés.

## Première recette interrompue : divergence des totaux avant S0

Archive exacte : `.e2e/army/coverage/runs/2026-10-12T00-41-39-336Z`,
SDK `01a12d90-529b-7a74-aff2-c092e4dbd38c`, build
`51WJ18kp0EVXbXrlkKkQg`. Le login passe ; SC01 et SC04 échouent à la
préparation S0, SC05 est interrompu, huit cas restent non exécutés. Le
SIGINT vise uniquement le wrapper possédé et laisse le SDK terminer son
nettoyage et conserver son rapport (`interrupted`, exit130). Cela ne
qualifie aucun traitement CCTP.

L'assertion attend pendant 45 secondes à la fois un état de sauvegarde
confirmé et les totaux API `71000/14200/85200`. Le rapport conserve seulement
le booléen final `false`, pas les valeurs de chaque lecture. Le screen
montre toutefois quatre lignes et 710 € HT avec « À jour ». Une lecture
ordinaire PostgREST indépendante **après l'arrêt** constate, sur les trois
versions touchées, quatre lignes HT `40000/18000/8000/5000` et une entête
persistée `40000/8000/48000`. Son reçu est
`disposable-native/runs/729799711d9c404b/coverage-preparation/s0-after-interruption.json`
sous `.e2e/source-coverage/`, SHA
`3360fd5df3fc0652dd31892283bd3057e5de2266cdea34383ffb99e63a796785`.
Cette lecture ultérieure ne se fait pas passer pour la valeur archivée du poll.

La précondition applique réellement L1 puis ajoute L2/L3/L4 par les POST
publics, recharge et utilise Ctrl+S sans changement local supplémentaire.
Ce scénario rouge et son oracle financier restent conservés pendant la
revue du contrat CRUD. Aucun PATCH artificiel des totaux ni contournement
UI n'est ajouté pour effacer la divergence.

Amélioration de preuve proposée, avant modification du helper : conserver
dans un `finally` les transitions observées par le poll (état de sauvegarde,
trois totaux, updated_at), leur heure et l'oracle attendu. Limiter cette
preuve aux valeurs métier, sans session de verrou ni corps Auth ; distinguer
première/dernière lecture même si le test échoue ou est interrompu. Cette
proposition est définie ici avant son implémentation, détaillée ci-dessous.

Pour un prochain seed autorisé, le mode existing-stack sur cette **nouvelle**
pile peut prendre la version nominale réellement observée comme sentinelle
d'identité. Le brouillon de profil conserve ses totaux 40000/8000/48000 et
ne la présente jamais comme vide ou réussie. Onze nouveaux dossiers seront
créés sans réécrire les trois déjà touchés ; aucun nouveau seed n'est lancé
par cette préparation.

## Diagnostic de la sauvegarde explicite

Défaillances définies avant l'adaptation du helper : un timeout booléen ne
permet pas de distinguer un badge incohérent d'une entête encore périmée ;
un helper qui ne conserve que son résultat final perd cette distinction.
Chaque lecture du poll doit donc conserver son heure, le texte du badge,
les trois totaux réellement lus et `updated_at`, avec l'oracle inchangé.
La preuve doit être écrite au fil des lectures puis dans un `finally`, y
compris en cas d'échec, sans corps HTTP brut ni session de verrou.

Le même S0 conserve les trois POST publics et le reload, sans édition
supplémentaire pour rendre artificiellement le formulaire modifié. Après
chargement du tableau, une fenêtre explicite de trois secondes observe
l'état de sauvegarde et compte les vrais POST vers `items/bulk`. Durant
cette fenêtre, aucun bulk spontané n'est attendu et le badge ne doit pas
annoncer « À jour »/« Sauvegardé » lorsque l'entête reste à 40000 et les
lignes valent 71000. La fenêtre ne prétend pas prouver une absence infinie
d'autosave. Ctrl+S doit ensuite émettre un bulk réel, puis les totaux relus
doivent devenir exactement 71000/14200/85200 avant le reload de persistance.
Cela qualifie la sauvegarde explicite V2 ; les POST201 individuels ne sont
pas qualifiés comme atomiques avec le recalcul de l'entête.

L'adaptation du helper est écrite ; lint ciblé et typecheck global passent.
Chaque poll est conservé, pas seulement les transitions, ainsi que la
première lecture après reload avant l'assertion du badge. Aucun nouveau
parcours n'a encore exécuté ces assertions sur le correctif produit.

## Deuxième préparation, sur la pile désormais existante

Le seed `coverage-existing-02` termine exit0 le 12 octobre 2026 à
00:54:15 UTC, avec onze nouveaux dossiers et un nouvel acteur sur la même
pile locale neuve. Le mode `existing-stack` conserve la version nominale
du premier run comme sentinelle réelle ; ses lectures projet/version avant
et après ont exactement les mêmes empreintes. Aucune affirmation d'état
vide de la pile n'est faite. Le seed ne réécrit aucune des trois versions
touchées ; la conservation mesurée ici porte sur la sentinelle nominale.

- Fixture : `.e2e/army/coverage/fixtures/coverage-existing-02/fixture.json`,
  SHA `fb46ef0ede11559280d502391502490e9d0388d0d98fcdae2556db2b20136ad1`.
- Provisionnement : `provisioning.json` voisin, SHA
  `9b97be5146c4f9072880f2c4ee3432bb7a056609ca1f26eff888ad78230378ff`.
- Vérification hors réseau des onze lectures initiales, des deux empreintes
  de sentinelle et scan sans secret/JWT de quatorze fichiers texte :
  `disposable-native/runs/729799711d9c404b/coverage-preparation/fixture-existing-02-integrity.json`
  sous `.e2e/source-coverage/`, SHA
  `93abbd1d80c64ba5fc12e6be7a938d7bb4b3a88bfc8c3ee323e05b5efca22a23`.

Les nouvelles sœurs ont zéro ligne finale/application/snapshot/registre
préinséré ; les 22 PDF ont été relus sous l'acteur ordinaire. Les états
privés de couverture ne sont pas relus par ce seed. Le lancement UI attend
le nouveau build et le créneau root ; le seed ne qualifie aucun scénario.

## Campagne 02 : sauvegarde prouvée, déconnexion du lecteur de recette

Archive `.e2e/army/coverage/runs/2026-10-12T01-01-29-337Z`, build
`cQIFaqMjaqekBmvB5tm44` : une authentification réussie, un scénario échoué,
dix ignorés par `--max-failures 1`, sources et build stables, zéro token
modèle. La fenêtre observée du 12 octobre à 01:03:58.047–01:04:01.672 UTC
montre « Totaux à synchroniser », une entête 40000/8000/48000 et zéro bulk.
Ctrl+S à 01:04:01.677 déclenche le bulk à 01:04:01.685 ; la lecture à
01:04:02.962 voit « Sauvegardé » et 71000/14200/85200. Après le vrai reload,
`s0.json` constate ces mêmes montants et huit heures. Cela prouve la
sauvegarde explicite V2 sur ce témoin, pas encore le parcours CCTP complet.

Le scénario échoue ensuite avant l'export, sur une navigation redirigée
vers `/login`. Défaillance de recette identifiée avant correction : les
deux lecteurs ordinaires terminaient par `signOut()` sans scope. Le SDK
installé documente et implémente alors le scope global, qui révoque aussi
la session du navigateur du même acteur. Le nettoyage doit se limiter à
`scope: "local"` et vérifier son éventuelle erreur sans archiver de secret.
Le prochain parcours devra poursuivre sa navigation authentifiée et ses
exports réels ; aucune assertion financière ne change pour ce correctif.

Les deux déconnexions sont désormais explicitement locales, avec contrôle
d'erreur générique ; lint/typecheck passent. Le seed autorisé
`coverage-existing-03` termine exit0 à 01:06:31 UTC, avec onze nouvelles
sœurs, sentinelle nominale inchangée et 22 PDF relus. Fixture :
`.e2e/army/coverage/fixtures/coverage-existing-03/fixture.json`, SHA
`559e8f599515d85a19ccc940defc512f40f3358ca019036ea7b36129aa18cc38` ;
`provisioning.json` voisin, SHA
`966f78f3c03674b02fcf605353db95766373099134359ff8ffb6dfaab6da1034`.
Le même build produit peut être conservé puisque seule la recette change.
La nouvelle fixture n'a pas encore exécuté le parcours navigateur.

## Campagne 03 : session conservée, chemin d'export desktop incorrect

Archive `.e2e/army/coverage/runs/2026-10-12T01-07-49-844Z` : une réussite,
un échec, dix cas ignorés. S0 et son reload passent ; après le nettoyage
local de l'observateur, le navigateur reste authentifié. L'export n'a pas
encore téléchargé de fichier : la recette cherche « Exporter Excel » dans
le menu général, alors que cette entrée est réservée au menu mobile et
porte le rôle menuitem. Sur le desktop réel, le chemin est « Exporter »
puis « Excel (.xlsx) », déjà exercé par la recette d'ordre des totaux.

La capture constate également « Verrouillé par vous dans un autre onglet » :
`exportsAt` rouvre avec `app.open` l'éditeur déjà affiché, créant une nouvelle
identité de page. Le helper doit conserver l'éditeur quand le pathname est
déjà celui de la version ; les rechargements de persistance restent de vrais
reloads. Le chemin DPGF et toutes les assertions de cellules/montants restent
inchangés. Ces deux défauts de navigation sont consignés avant correction.

Campagne 04 sous Windows, archive
`.e2e/army/coverage/runs/2026-10-12T01-14-35-889Z` : S0, ses deux fichiers
XLSX réels et la confirmation de la référence A passent. Le scénario
s'arrête au registre : le bouton observé se nomme exactement
« + Ajouter un point », le test omettait le signe présent dans le nom
accessible. Une réussite, un échec, dix cas ignorés, sources stables.
Correction de sélecteur uniquement ; aucun défaut produit n'est déduit.

Campagne 05, archive `.e2e/army/coverage/runs/2026-10-12T01-16-49-277Z` :
le registre est atteint, mais le test lit les données alors que la seconde
création est encore en cours. `getByText(entry.text)` pouvait correspondre
au contenu du textarea ; le screen conserve justement ce formulaire et
son bouton désactivé, avec seulement H1 déjà persistée. Avant de lire le
registre, attendre la fermeture réelle du formulaire puis le texte dans
la liste persistée supprime ce faux point de synchronisation, sans changer
l'attente des deux entrées. Le run reste échoué, avec dix cas non exécutés.

Campagne 06, archive `.e2e/army/coverage/runs/2026-10-12T01-19-34-253Z` :
authentification, nominal complet et changement A→B réussissent. S1 porte
huit exigences, sept décisions à jour, une non revue ; après B et la seule
revalidation d'E4, les validités sont exactement 1/1/6
(non revue/à jour/à revérifier). Les exports réels passent. SC05 s'arrête
ensuite sur le nom du bouton de carte ; huit cas restent ignorés. La revue
indépendante et la DOM réelle confirment que le nom contient aussi sa
description. Le test utilisera les deux noms complets validate/reopen,
sans modifier les boutons de dialogue ni les assertions d'invalidation.
Sources et build sont restés stables ; aucune qualification globale.

## Campagne 07 : sortie rapide après reload et bail d'édition

Archive `.e2e/army/coverage/runs/2026-10-12T01-25-19-645Z` : quatre
réussites (auth, nominal, A→B et registre), un échec, sept cas ignorés.
La modification L2 de 4 à 5 passe, avec montants72000/14400/86400 et seule
E3 à revérifier. L'échec survient au retour pour remettre4 : l'éditeur
affiche « Verrouillé par vous dans un autre onglet » et désactive le champ.
Le reload finit à01:30:12.978 UTC, le départ suit à13.078 après une seule
lecture API, le retour à13.285. Aucune acquisition UI après le reload n'a
été attendue. Le reçu diagnostic lié au rapport est
`coverage-preparation/run07-lock-navigation-diagnostic.json`, sous le même
run natif729799711d9c404b, SHA
`9dd6dc142ad98464ebd17bdbb9ee5bcaf6f42fdfabebd0e2a8923c9ec6ccbc52`.
Les traces sûres ne contiennent aucune identité de session récupérable ;
les chemins upstream seuls ne prouvent ni méthode ni libération réussie.

Avant la prochaine recette, ajouter une frontière de readiness après
chaque reload éditeur : quantité L1 enabled, badge exact de sauvegarde et
montants API relus. Le reload qui expose volontairement les totaux périmés
attend plutôt le badge « Totaux à synchroniser » et l'entête40000. Aucune
libération manuelle, prise forcée ou valeur de session réinjectée n'est
permise. Un blocage malgré cette readiness doit arrêter la campagne pour
diagnostic produit. Cette adaptation ne classe pas la sortie rapide comme
simple erreur de test : le possible bail laissé après fermeture rapide
reste un défaut produit hérité à reproduire séparément (CORE-06).

## Qualification locale de la campagne 08

La campagne Windows se termine **12/12 PASS**, zéro échec, flaky ou skipped,
le 12 octobre 2026. Archive exacte :
`.e2e/army/coverage/runs/2026-10-12T01-35-38-544Z`, build Windows
`cQIFaqMjaqekBmvB5tm44` exécuté sous Windows. Les sources et fichiers du
build restent stables. Les onze parcours métier et le login ordinaire
consomment zéro token modèle ; 26 téléchargements réels sont archivés.

Le lecteur indépendant exécuté sur cette archive passe **3022/3022
contrôles**, dont les empreintes, les douze titres exacts, S0/S1, les liens
réels aux applications/snapshots et au registre, la reprise de la même
décision et les interceptions réellement réalisées. Il analyse 280 fichiers
texte sans conserver de valeur secrète configurée ni JWT.

- Reçu : `.e2e/army/coverage/qualifications/2026-10-12T01-35-38-544Z-aa9a7470/qualification.json`,
  SHA `c1b8f216cae6ce35fa726e4e9aadd8bd04aad7cb13e093d6a4efda74baf39377`.
- Lecteur exécuté : `.e2e/coverage-reader-reviewed/qualify-source-coverage.mjs`,
  SHA `0f95ee91f6d24d417f5f562295dd1c25c67217820196dd1fd820e8c45efbe80d`.
  Son code et `preparation.json` sont recopiés à côté du reçu ;
  `reader-retention.json`, SHA
  `7d6f59b872001a3ac3eac19a45de9c80ab27b47c49fac882e7a64b5e3cc08251`,
  vérifie ces copies. Le lecteur canonique gelé et le README n'ont pas été
  modifiés pendant la campagne ni sa qualification.

La copie du lecteur corrige seulement l'identification d'une preuve par
nom exact (`fixturePrefix-label.json`) : le suffixe `s0` seul correspondait
aussi à `exports-s0`. L'unicité reste exigée. Son seul autre ajout est la
limite CORE-06 ; les deux deltas ont été revus indépendamment avant exécution.
Pour reproduire la qualification, utiliser ce lecteur conservé, le chemin
exact du run, l'index alternatif et les env privés backend/fixture08.

Résultats métier : huit exigences explicitement créées, sept décisions
à jour et une non revue ; S0 et S1 restent à71000/14200/85200 centimes et
huit heures. Le changement A→B invalide les sept décisions, puis seule E4
est revalidée après nouvelle citation vérifiée. Les transitions du registre
et les modifications L1/L2 invalidant leurs exigences liées passent ; L4
et le prix ne provoquent pas d'invalidation injustifiée. Le retour L2 de5
à4 ne restaure pas automatiquement la validité. La reprise après réponse
perdue conserve le même événement ; une erreur503, une réponse incohérente,
une modification de complétude et un aperçu périmé sont traités comme prévu.

Cette qualification concerne le corpus synthétique et ces onze parcours,
pas la totalité de DOS-CAL-01 ni de l'application. Elle ne prouve pas une
validation professionnelle, l'exhaustivité du CCTP, une matrice complète de
rôles, une suppression physique de copie, une duplication/archivage ou les
mutations d'heures/marge/ordre. Les courses SQL ont leurs propres reçus et
ne sont pas déduites des tests UI. Aucune revue de pixels ni génération
de PDF d'impression n'est inférée des contrôles DOM et XLSX.

Le scénario attend explicitement que l'éditeur soit prêt après reload.
La sortie rapide laissant un bail observée au run07 reste **non corrigée
et non qualifiée (CORE-06)**. Les huit archives successives, y compris les
échecs et l'interruption initiale, sont conservées sans réécriture.
# Requalification préparée après CORE-08 — 12 octobre 2026

Après la qualification indépendante CORE-08 4/4 (`runs/2026-10-12T02-37-27-533Z`, voir [estimate-create-atomic.md](estimate-create-atomic.md)), le helper S0 exige les totaux `48000/9600/57600`, `53000/10600/63600`, puis `71000/14200/85200` immédiatement après les trois POST ordinaires. Il archive chaque observation avant assertion. La sauvegarde initiale après application réelle de L1 reste inchangée ; seul le CtrlS de réparation après les trois créations est retiré. Après chaque vrai reload, l’éditeur doit être prêt et indiquer « Sauvegardé » ou « À jour » ; la fenêtre observée de trois secondes conserve ces montants et zéro POST bulk. Le lecteur à douze résultats exige ces nouvelles preuves, en plus des oracles S0/S1 et des invalidations déjà conservés. Les archives antérieures gardent leurs attentes et leurs lecteurs historiques ; cette préparation ne vaut pas nouvelle qualification CCTP.

