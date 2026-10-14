# Sortie rapide de l'éditeur — contrat de recette avant correctif

Le cas CORE-06 reste ouvert. Preuve initiale : campagne
`.e2e/army/coverage/runs/2026-10-12T01-25-19-645Z`, SC06, écran final
« autre onglet » et champ quantité désactivé. Le rapport enregistre la fin
du reload à 01:30:12.978 UTC, le départ vers les exigences à 01:30:13.078,
puis le retour à 01:30:13.285. Il ne conserve pas l'ordre SQL des requêtes
de verrou ; cette chronologie ne démontre pas à elle seule leur cause.

## Frontières à éprouver

`useDraftLock` libère sur cleanup et beforeunload, puis compense une
acquisition tardive si le document reste actif. Les tests retenus couvrent
le démontage React ; ils ne détruisent pas réellement le document navigateur.
`getEstimateDraftLockSessionId` restaure l'identité depuis sessionStorage
seulement sur reload ; une navigation complète crée une nouvelle identité.

Une libération exécutée avant une acquisition en vol peut donc laisser une
ancienne identité propriétaire après destruction du document. C'est une
hypothèse à reproduire, pas un diagnostic confirmé. Réutiliser sans condition
sessionStorage pourrait aussi confondre deux onglets clonés ; cette solution
ne doit pas être adoptée sans vérification de cette frontière.

| Défaillance observable | Scénario et résultat exigé |
| --- | --- |
| Sortie avant disponibilité puis retour bloque le même onglet | Affaire neuve dédiée, lecture financière initiale, reload puis vraie navigation vers une page de l'affaire et retour immédiat. Capturer les requêtes/réponses ordinaires de verrou et leurs heures sans archiver les identités de session. Le champ doit redevenir éditable sans reprise forcée, avec montants et lignes inchangés. |
| Réponse d'acquisition tardive recrée un bail abandonné | Varier les départs avant/après départ réel de POST et avant/après réponse. Une faute de transport éventuelle doit préciser ce qui a réellement atteint le serveur. Lire le bail par API ordinaire après départ ; conserver tout échec avant tentative suivante. Un seul timeout ne prouve pas que le POST a été commis. |
| Libération tardive retire le bail du retour | Retour pendant une libération encore en vol ; attendre sa fin puis écrire une quantité par UI et relire sa valeur persistée et les totaux. Pas de modification SQL de réparation ou de force-unlock. |
| Correction assimile un deuxième onglet au premier | Deux documents ordinaires, y compris ouverture avec stockage de session cloné. Le deuxième reste en lecture seule tant que le premier détient le bail ; son identité de page est distincte. Le premier peut sauvegarder, sans perte ni écrasement. |
| Retour après réponse réseau incertaine masque un conflit réel | Perdre une vraie réponse, puis revenir. L'interface doit distinguer acquisition inconnue, absence confirmée et autre propriétaire ; aucune autorisation d'écrire déduite du timeout. |

La campagne doit garder les scénarios métier existants qui attendent un champ
éditable. Elle ajoute ces cas séparément, avec fixtures neuves, build de
production stable, TesterArmy sans modèle, lectures ordinaires et traces
authentifiées désactivées. Une exploration de départs répétés doit archiver
chaque départ et retour ; elle ne vaut pas matrice exhaustive de concurrence.
Les cas non atteints ou arrêtés avant acquisition sont de la preuve manquante.

Avant correction, exécuter au moins la sortie rapide et les deux documents
sur le produit actuel. Tout contrôle isolé supplémentaire exige d'abord le
défaut concret que ces observations ne peuvent pas reproduire. Un correctif
de session doit conserver les refus serveur, la séparation des documents et
la limite d'édition du rôle ; le temps d'expiration ne peut pas masquer le
résultat immédiat attendu.

## Harnais initial NAV01 et NAV05 — défini avant son implémentation

La sélection `navigation-lease` prépare deux cas TesterArmy, chacun créant
une affaire ARMY neuve par les API ordinaires du profil `batch-atomic`.
L'authentification existante, les contrôles de tenant et le build restent
ceux du profil local. Elle ne comporte ni modèle, ni trace authentifiée,
ni reprise forcée. Le bail utilisé pour créer la fixture est libéré
normalement avant l'ouverture de l'éditeur ; aucun bail d'un cas échoué
n'est réparé ou supprimé pour poursuivre.

| Cas préparé | Observation avant assertion | Critère |
| --- | --- | --- |
| NAV01 | Bail et état financier initiaux, vraie navigation après reload vers les exigences puis retour, requêtes de bail horodatées, état DOM et lectures RLS au retour et à toute erreur | Identité du document renouvelée, champ éditable en moins de dix secondes après retour, sans attendre le TTL de 120 secondes ; état métier entier inchangé avant édition ; quantité 3 sauvegardée par l'UI avec 3000/600/3600 centimes puis relue après reload. |
| NAV05 | Vrai `window.open("about:blank", nom)` de même origine, égalité du stockage copié constatée avant la navigation du second document, DOM réel du second éditeur, comparaisons de sessions en mémoire et bail RLS | Le clone initial existe ; le second document adopte une identité distincte, conserve cette identité à son reload et reste en lecture seule pendant que le premier conserve son bail et sauvegarde la quantité 3. |

Le SDK installé permet les routes sur tous les onglets mais les actions et
les locators restent sur l'onglet principal. NAV05 utilise uniquement
`browser.evaluate` pour ouvrir le document de même origine et lire son DOM
via la référence `Window` ; aucune API Playwright cachée, aucun clic ou
sauvegarde simulé dans le second document. Les actions d'édition sont de
vraies actions `screen` sur le premier. Popup bloquée, référence inaccessible,
stockage non copié, document non chargé ou élément quantité absent sont des
échecs de préparation ou de preuve, jamais des résultats positifs.

Les UUID de session et identifiants de bail restent dans les fermetures
mémoire des observateurs. L'archive ne reçoit que des alias locaux, des
comparaisons booléennes, les dates et les valeurs métier. Aucun en-tête
Cookie/Authorization, corps de réponse de verrou, JWT ou sessionStorage
entier n'est archivé. Les lectures du bail et des montants utilisent un
client connecté par mot de passe ordinaire avec RLS, jamais le service-role.
`/lock` ne possède pas de GET : le harnais ne l'invente pas.

NAV01 expose la sortie naturelle mais ne force pas un ordre de commit.
NAV05 couvre l'ouverture d'une popup qui hérite réellement du stockage,
puis son reload ; il ne qualifie pas la commande native « Dupliquer
l'onglet » du navigateur. Une réussite des deux cas ne clôt pas CORE-06.

## Ordres déterministes encore sans barrière exécutée

Les contrats NAV02, NAV03, NAV04a, NAV04b et NAV06 sont décrits dans le
support du harnais, sans test ignoré ni implémentation de transport factice.
Leur statut reste `contract-only` tant qu'une barrière réelle n'est pas
installée et que l'ordre requis n'est pas observé.

| Contrat | Barrière réelle nécessaire | Oracle après levée |
| --- | --- | --- |
| NAV02 | POST original entièrement reçu, retenu avant transmission ; départ et DELETE terminé ; POST ensuite transmis au serveur | Pas de bail abandonné qui bloque le retour ; acquisition et sauvegarde ordinaires possibles. |
| NAV03 | POST transmis, réponse serveur 201 et bail lu ; réponse retenue pendant départ, libération et retour | L'ancienne réponse ne rétablit ni ancien propriétaire ni droit d'écrire incorrect. |
| NAV04a | DELETE original retenu avant transmission ; navigation complète et acquisition du retour confirmée avant transmission de l'ancien DELETE | Bail du nouveau document conservé, quantité et totaux persistés exactement. |
| NAV04b | Même ordre avec reload et identité effectivement réutilisée | L'ancienne libération ne retire pas le bail nouvellement acquis au reload. |
| NAV06 | POST original réussi et bail lu, vraie réponse ensuite perdue | Un timeout ne donne jamais le droit d'écrire ; absence, conflit et acquisition confirmée restent distincts. |

La future interface exige les heures de réception/transmission/réponse,
le statut serveur réel, le résultat de la lecture ordinaire et les phases
effectivement atteintes. Retenir un simple `route.continue()` ne prouve pas
le commit. Le SDK n'offre pas `route.fetch` ; une barrière locale transparente
devra préserver la requête d'origine, se limiter au loopback et aux fixtures
du cas, ne jamais enregistrer ses credentials et laisser les octets du
produit inchangés. Une phase non atteinte restera de la preuve manquante.

Le contrat installé est `continue(): Promise<void>` sans argument ; son
implémentation appelle `route.fallback()` sans options. Une redirection par
`route.continue({ url: ... })` n'est donc pas une capacité disponible. Le
relai devra être configuré explicitement au niveau du serveur possédé et
préserver le transport de l'application, sans emprunter `route.fetch`.

Statut historique avant le premier run : les deux journeys étaient seulement
préparés ; aucune exécution authentifiée ni qualification CORE-06 n'était
alors revendiquée. Le résultat de la première baseline est consigné ci-dessous.

## Lacunes de preuve relevées avant la correction du harnais

La revue ciblée du premier harnais a relevé trois défauts de qualification,
sans observation d'un nouveau défaut produit. Ils sont consignés avant
leur correction :

1. NAV01 ne lisait que pathname et timeOrigin sur la page intermédiaire.
   Un `notFound()` Next servi avec HTTP 200 aurait donc pu être pris pour
   la vraie page des exigences. Le harnais doit conserver son h1 réel et
   affirmer « Exigences du CCTP » seulement après le retour, sans attendre
   cette assertion pendant le détour rapide.
2. Les dix secondes après retour n'encadraient pas le cycle entier.
   Un reload ou un détour lent pouvait attendre l'expiration du bail et
   masquer CORE-06. Les heures réelles doivent donc établir un cycle
   reload/départ/retour puis édition inférieur ou égal à vingt secondes,
   ainsi qu'un retour éditable au moins vingt secondes avant expiresAt
   du premier bail. L'oracle des dix secondes après retour reste exigé.
   Dates, durées, expiration initiale et marge sont archivées avant les
   assertions ; une date invalide ne peut pas devenir une preuve positive.
3. Les attentes de changement de timeOrigin du popup ne conservaient pas
   leurs échantillons en cas d'échec, et le terminal ne lisait que le
   document principal. Chaque attente de reload doit conserver ses
   observations en finally ; le checkpoint terminal doit aussi conserver
   le DOM et les comparaisons non secrètes du popup, y compris l'absence
   ou l'inaccessibilité de sa référence.

## Première baseline exécutée — 12 octobre 2026

La campagne `.e2e/army/coverage/runs/2026-10-12T19-30-14-423Z` a découvert,
sélectionné et exécuté les trois résultats attendus : authentification,
NAV01 et NAV05. Le rapport conserve **3 passed, 0 failed, 0 flaky,
0 skipped**. Le manifeste SHA-256 est
`27b6569a90fc75bde7420ecd0c9ce7ab8261e1920af0cff5f094e9990ad3bea0` ;
le build est `fX0DQh4bn_NqX4V5kfllb`.

NAV01 a observé un cycle de **871 ms**, un retour éditable après **397 ms**
et une marge de **118847 ms** avant l'expiration initiale du bail. NAV05 a
observé un vrai document avec stockage initial cloné, une identité distincte,
son maintien en lecture seule et la sauvegarde du premier document avec
**3000/600/3600 centimes**. Cette baseline n'a reproduit aucune anomalie
naturelle ; aucun correctif produit n'en découle.

La lecture indépendante hors réseau est terminée : **17 985 contrôles, zéro
échec**, reçu exclusif
`.e2e/estimate-navigation-lease/qualifications/74980c7d-c413-49bd-8fbe-6a683514fa0d/receipt.json`,
SHA-256 `131d87aa745fc361d3bf81f8c283f0d43a48887564141115c8aa5a3eb8e75c8f`.
Elle compare les empreintes de la chaîne, les sources et le build datés, les
mesures de document et d'expiration, les valeurs API/RLS/DOM et la séparation
des identités. Les requêtes interceptées conservent `responseObserved:false` ;
elles ne démontrent donc pas leur ordre de commit. Une première lecture a
échoué dans son propre parseur en traitant une preuve SQL/texte comme JSON ;
son reçu FAILED est conservé et référencé, sans promotion.

Ce résultat ne qualifie ni les ordres de concurrence sans barrière, ni la commande native
« Dupliquer l'onglet ». **CORE-06 reste ouvert.**

## Contrat avant code — relai HTTP réel pour la prochaine tranche CORE-06

Le relai n'est pas implémenté ni exécuté. NAV02, NAV03, NAV04a, NAV04b et
NAV06 restent `contract-only`. Cette préparation ne modifie ni le runtime
de la baseline ci-dessus, ni le produit, ni la base. La prochaine tranche
doit coordonner les fichiers communs avec la reproductibilité CCTP avant
toute implémentation.

### Origine publique et écoute privée

Déplacer simplement `next start` sur un port privé et préserver `Host` ne
suffit pas : le Next installé reconstruit `initURL` avec son hostname et
port déclarés (`next-server.js`, `attachRequestMeta`). `src/proxy.ts` utilise
cette URL pour ses redirections ; les Server Actions comparent également
`Origin` à `x-forwarded-host` ou `Host`. Aucune option `trustHostHeader`,
aucune variable privée Next ni extension `allowedOrigins` ne doit masquer
une dérive d'origine.

La disposition proposée utilise l'API officielle du
[serveur programmatique installé](../../node_modules/next/dist/docs/01-app/02-guides/custom-server.md) :

1. Le navigateur conserve l'origine publique exacte du profil.
2. Un processus relai écoute cette origine et transmet uniquement vers une
   adresse loopback privée fixée dans sa configuration explicite.
3. Le processus Next initialise `next({ dev: false, dir,
   hostname: "localhost", port: publicPort })`, appelle `prepare()` et
   `getRequestHandler()`, puis son serveur Node écoute physiquement sur
   `127.0.0.1:privatePort`. Le hostname et le port déclarés restent ceux du
   navigateur ; l'API installée transmet ces valeurs aux handlers sans
   imposer cette adresse d'écoute physique.
4. Next conserve le build de production, `E2E_ARMY=1`, les variables et
   les autorisations du profil. Le relai transmet les corps inchangés et
   les en-têtes de bout en bout, dont chaque `Set-Cookie` séparément.
   Assets et réponses RSC restent diffusés normalement ; seules les petites
   requêtes/réponses `/lock` ciblées peuvent être retenues.

Cette disposition doit être qualifiée comme **harnais avec serveur
programmatique**. Elle ne transforme pas automatiquement une preuve sous
ce relai en preuve du lancement direct `next start`. La baseline directe
est conservée séparément. Aucun octet d'URL ou de réponse ne doit être
réécrit pour faire passer les contrôles d'origine.

### Garde réseau, contrôle et confidentialité

`coverage-network-guard.mjs` autorise seulement les origines backend et
publique du profil. Chargée sur le relai, elle bloquerait son HTTP vers le
nouveau port privé. Elle doit rester chargée sur le processus Next ; le
relai doit être un processus séparé, limité par construction à sa cible
loopback fixe. Aucun URL de destination issu d'une requête ne peut être
accepté ; le port privé ne doit pas être ajouté silencieusement à la garde
du produit.

Un canal de contrôle loopback distinct peut armer, observer et lever les
barrières. Il est réservé au processus de test et protégé par un nonce
éphémère qui reste en mémoire ou dans une configuration secrète ignorée,
jamais dans les arguments, URL ou preuves. Le navigateur n'utilise pas ce
canal. Chaque fixture est enregistrée seulement après une lecture ordinaire
confirmant son propriétaire, tenant et préfixe ARMY de cette campagne.
Le relai ne possède pas de client service-role et ne lit ou répare pas la DB.

Les preuves du relai ne contiennent que le cas, les alias locaux S1/S2 et
B1/B2, méthode, phases, dates, tailles, statuts serveur et comparaisons
booléennes. Aucun Cookie, Authorization, corps de réponse de verrou,
credential, nonce ou UUID n'y est sérialisé. Les UUID de fixture nécessaires
au routage et les sessions nécessaires aux comparaisons restent dans le
registre mémoire ; les identités métier de la recette générale restent
dans son manifeste habituel.

### Contrat d'une barrière

Une barrière cible une seule fixture enregistrée, une méthode et une phase.
Elle doit distinguer réception entière de la requête, transmission,
réponse serveur entièrement reçue, lecture ordinaire confirmant le bail,
livraison, perte volontaire de réponse et déconnexion du navigateur.
Les dates de ces événements et les phases réellement atteintes sont
retenues même lorsqu'une assertion ou le transport échoue.

- Avant transmission, elle conserve la vraie requête reçue. NAV02 exige
  que cette requête entièrement reçue puisse ensuite atteindre Next même
  si le navigateur a fermé sa connexion ; une requête interrompue avant
  réception complète reste une phase non atteinte.
- Après réponse, elle conserve les vrais statut, en-têtes et octets reçus
  de Next. Un simple timeout, une continuation SDK ou des headers reçus
  sans corps complet ne constituent pas une réponse réussie.
- Pour la perte volontaire, elle ferme le transport après le vrai succès
  serveur ; aucune réponse synthétique et aucun POST de remplacement.
- Une levée est idempotente et ne retransmet jamais la même requête. Les
  autres échanges sont observés : un deuxième DELETE ou POST peut empêcher
  de revendiquer l'ordre isolé si ses effets ne sont pas établis.
- Échec ou arrêt du runner ne lève pas automatiquement une requête encore
  retenue. Les états et fixtures restent inspectables ; aucun nettoyage de
  bail, force-unlock ou réparation ne permet de continuer un cas échoué.

### RED du harnais à écrire avant son implémentation

Une petite recette d'intégration HTTP locale doit employer un upstream réel
et des sentinelles synthétiques sans compte, token ou UUID. Elle précède le
code du relai et conserve command, révision, environnement, attentes,
résultats et chemins de preuve. Les observations de corps exacts et
d'en-têtes Cookie multiples justifient cette intégration spécialisée :
les seuls montants UI ne détectent pas toutes ces corruptions de transport.

| Défaillance du harnais | Assertion RED à préparer |
| --- | --- |
| Entrée du relai absente | Échec de préparation explicite avec artefact neuf ; aucune ancienne preuve empruntée et aucun verdict produit. |
| Corps ou origine altérés | Upstream recevant les mêmes octets, Host et Origin publics ; aucune réécriture ni destination contrôlée par la requête. |
| `Set-Cookie` multiples fusionnés ou perdus | Tous les headers synthétiques restent distincts et leur sémantique est préservée côté navigateur. |
| Transmission trop tôt ou double levée | Zéro requête upstream avant levée, exactement une après deux demandes de levée. |
| Réponse prétendue sans vrai upstream | Statut et corps réellement reçus upstream ; zéro octet livré au navigateur avant levée. |
| Déconnexion empêchant le POST tardif | Requête entière reçue puis client fermé ; transmission tardive ensuite observée une seule fois. |
| Gate appliquée à un autre échange | Autre fixture, méthode ou chemin transmis normalement ; compteurs de gate inchangés. |
| Arrêt appliquant une requête retenue | Artefact d'échec conservé ; aucune transmission automatique lors de l'arrêt, ports et processus possédés arrêtés. |
| Preuves contenant des secrets | Aucune sentinelle confidentielle, forme UUID, header ou corps de verrou dans les logs et artefacts exportés. |

### Qualification Next requise avant la matrice de concurrence

Avec le relai actif mais **aucune barrière armée**, la recette doit d'abord
prouver l'identité du build et de ses entrées, puis exécuter :

1. Login UI ordinaire, accès protégé et retour final sur l'origine publique.
   Les redirections login/dashboard et chiffrages/affaires doivent garder
   leurs destinations exactes sans fuite vers le port privé.
2. Chargement et hydratation réels de l'éditeur, assets et navigation RSC,
   avec h1 attendus ; un HTTP 200 contenant `notFound()` ne passe pas.
3. Une Server Action réelle de lecture sur la fixture, avec ses données
   attendues ; aucun contournement du contrôle Origin/Host.
4. Acquisition, renouvellement et libération ordinaires du bail, mêmes
   refus d'accès et lectures RLS. Une sauvegarde UI puis reload doit
   conserver exactement lignes, quantité et montants.
5. NAV01/NAV05 sans faute injectée, sans modèle ni trace authentifiée,
   avec le même contrat de séparation des documents et d'expiration.
6. Arrêt possédé de Next et du relai, libération des ports et conservation
   de toutes les preuves, y compris les phases non atteintes.

La matrice NAV02–04/06 ne peut commencer qu'après cette transparence
exécutée et relue. L'alternative conservatrice garde le lancement direct
et limite la preuve aux fautes réalisables dans un document vivant,
notamment une vraie réponse ensuite perdue ; elle laisse les ordres qui
exigent le relai ouverts. À ce stade, ni le relai, ni ses RED, ni cette
qualification de transparence ne sont implémentés ou exécutés.
