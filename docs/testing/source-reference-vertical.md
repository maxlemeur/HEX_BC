# Référence CCTP : préparation, consultation et confirmation

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


La recette `e2e/army/local/source-reference.e2e.ts` matérialise le
[contrat préalable](https://github.com/maxlemeur/HEX_BC/blob/9ee18ca8187d1e4f76e8b196be90d85e2fa1334b/docs/testing/source-coverage-reference.md). La lecture seule a sa
[qualification distincte](source-reference-read.md). Le plan détaillé de la
verticale et ses changements datés restent dans
`.e2e/source-coverage/http-staged/UI-CONTRACT.md`.

Un seul parcours UI avec login ordinaire porte aussi les contrôles HTTP et PDF.
Il utilise le témoin synthétique `reference-http-01`, sans modèle, email, rôle
modifié ni préparation de référence en SQL. Le wrapper `source-reference` ajoute
une observation native READ ONLY avant/après, limitée à cette version et ce tenant.

## Assertions

Le lien « Référence CCTP » ouvre la page dédiée. L’utilisateur doit choisir un
document, préparer sa copie, consulter les octets vérifiés, cocher sa confirmation
et donner un motif. Préparer B de même nom laisse A active. Confirmer B crée le
second événement ; rejouer ensuite A conserve B et renvoie l’activation initiale.
Le PDF A reste consultable depuis son événement historique. Les trois lectures
réelles sont comparées aux fichiers locaux par octets, SHA-256, taille et trois pages.

La confirmation A reçoit un vrai succès serveur puis le harness ignore sa réponse.
Le reload doit envoyer zéro POST ; la reprise explicite renvoie le même corps,
clé, révision attendue et événement. Cette faute est distincte d’un crash arbitraire
du worker ou du stockage. Les deux routes POST refusent JSON invalide, mauvais type,
champ ajouté et dépassement réel de 8 KiB UTF-8. Une sonde sans cookies prouve le
préfiltre Origin étranger ; elle ne prouve pas le CSRF d’un navigateur connecté.

Les quatre routes refusent les requêtes anonymes. Les erreurs sont bornées à
`{ok:false,error:{code,message}}` et toutes les réponses portent `private, no-store`.
L’historique est relu par pages exclusives sans doublons ; copie, auteur et motif
correspondent aux événements réellement persistés.

La comparaison complète de l’API devis commence après la navigation du détail,
qui peut synchroniser les métadonnées d’approbation. Le contrôle natif conserve
les dates/empreintes complètes et distingue cette navigation ; l’empreinte de
tous les autres champs, les finances et les lignes doivent rester identiques.
Le final attendu est une revue révision2, deux copies vérifiées, deux événements
et deux objets privés dont les identités correspondent aux attestations.

## Première exécution conservée

`.e2e/product-foundation/runs/2026-10-11T22-59-38-860Z`, build
`o1fPk1lm3BEoJjijG4vip`, sources stables : **1/2 passé**. Le login et les douze
préflights ont passé. La première préparation A a réservé une copie pending,
puis affiché une indisponibilité temporaire. Aucun PDF ni événement n’a été créé.
L’observation native conserve zéro finance, zéro ligne, une revue0 et une copie
pending. Le corps HTTP de cette préparation n’a pas été archivé avant l’attente
UI : le code HTTP exact n’est donc pas revendiqué par cette archive.

La lecture du chunk de production a identifié une résolution de bibliothèque
PDF compilée en `undefined.resolve` avant le worker. La correction du backend
est validée séparément ; elle n’efface pas cet échec E2E.

## Reprise explicitement autorisée

La réservation existante est conservée. L’inspecteur du prochain run relit les
champs canoniques acteur/version/document/révision/clé et exige leur correspondance
au reçu failed précédent, SHA-256
`87503ce0453907a3078161c284c7d69e80c11278c04c1c0c40aa5065a7e43b9c`.
Le harness restaure ce seul corps dans le stockage d’onglet de la portée exacte,
si cette clé était absente. Il n’écrit rien en base pour préparer la reprise.

Après reload, zéro POST automatique ; clic « Reprendre la préparation » attendu
200/replayed, même copie et même clé. B reste une nouvelle préparation201. Cette
restauration de contexte par le harness ne vaut pas reprise automatique entre
appareils. Le final reste deux copies et deux événements, sans remplacement de
l’intention échouée par une nouvelle clé.

Le lecteur `.e2e/source-coverage/http-staged/qualify-vertical.cjs` vérifiera le run
terminal exact, les hashes, la chaîne de reprise, les observations natives, les
PDF et les trois traces NFT incluant réellement `pdf-lib/dist/pdf-lib.min.js`.
Les captures nommées sont tentées par l’API du runner ; un refus `POLICY_DENIED`
est conservé et n’est pas contourné ni répété. Sans pixels, aucune revue visuelle
n’est revendiquée, même si les assertions UI et les octets passent.

Les droits complets, la modification de l’original, les autres points de faute,
les bornes PDF extrêmes et une validation professionnelle du CCTP restent hors
qualification de cette verticale.

## Résultat qualifié de la reprise

Le run `.e2e/product-foundation/runs/2026-10-11T23-17-20-522Z`, sur le build
`A2hNxdwHe1cZhuprKaBYp`, passe **2/2**, sans filtre, exclusion, flaky ni appel
modèle. Les sources sont restées stables. Le build Windows est servi par Node
24.19.0 sous Ubuntu-24.04 ; ce résultat ne qualifie pas un nouveau build de
production Linux ni ses performances.

Le contrôle READ ONLY passe de une revue0 et une copie A pending à une revue2,
deux copies vérifiées, deux événements et deux objets conservés. A reprend sa
réservation initiale avec un succès200 ; B est créée201. La réponse de confirmation
A est effectivement ignorée après le succès serveur, puis la reprise explicite
retourne le même événement. Les compteurs POST mesurés avant et après chaque
reload restent égaux. Le replay de A après confirmation B conserve B active.

Les trois consultations réelles A/B/A correspondent aux fichiers PDF de trois
pages, respectivement 4 352 et 4 370 octets, et à leurs SHA-256. Les trois traces
NFT contiennent le fichier réel `node_modules/pdf-lib/dist/pdf-lib.min.js` avec
la même empreinte. Les douze préflights restent des contrôles distincts de la
consultation et des confirmations réussies.

Le reçu final est
`.e2e/source-coverage/qualifications/vertical-2026-10-11T23-17-20-522Z-7e810705/qualification.json`,
SHA-256 `315a724f3ce68129705f09e36f10238549aa103c854c6bc0506d096e2b7ba89a` :
**177 contrôles réussis**, dont le scan de 108 fichiers texte/JSON sans secret
configuré ni JWT. Le manifeste du run porte le SHA-256
`9a64d60d85979d72bdcc163ca0e2a1e29e316a4971015434ae84041f592e62a3` et le rapport
`e531eee174b572d7c9997bcfef38143da48e5f25f0989387475ca25d1cefa8be`.
Le premier reçu `...-6500041d` est conservé ; le second ajoute explicitement la
limite du devis vide, sans rejouer le navigateur ni modifier les données.

Ce témoin ne contient **aucune ligne** et ses totaux sont **0/0/0**. Leur invariance
est vérifiée, mais l’oracle calorifuge 71 000/14 200/85 200 centimes reste à éprouver
sur un devis renseigné. La première capture a été refusée par le SDK avec
`POLICY_DENIED` ; les deux suivantes n’ont pas été tentées. Les états DOM et les
octets PDF sont conservés, sans revendication de revue des pixels.

Le build intermédiaire `JUNxvUpzisSjzDrjNXaGw` avait compilé, mais sa lecture
statique montrait encore `createRequire` sans liaison dans le chunk produit. Il
a été rejeté **avant toute reprise E2E**. Le diagnostic minimal qui avait passé
ne reproduisait pas ce défaut de packaging. Le build final ci-dessus utilise le
chemin absolu construit depuis `process.cwd()` ; sa qualification combine le
contenu effectivement empaqueté et les consultations PDF exécutées. Les échecs
précédents restent conservés et ne sont pas transformés en succès.
