# Préparation enregistrée du métré

La préparation définit les entrées d'une analyse avant son lancement. Elle est
enregistrée par affaire et contrôlée côté serveur. Un brouillon peut être
incomplet ; une proposition de l'IA ne vaut jamais confirmation métier.

Le contrat partagé et ses règles sont dans
[`preparation.ts`](../../src/lib/takeoff/preparation.ts). Les actions de lecture,
d'enregistrement et de confirmation passent par
[`preparation-server.ts`](../../src/lib/takeoff/preparation-server.ts), avec les
droits du tenant actif et de l'affaire.

## Parcours pris en charge

« Métrés » rouvre les métrés de la dernière affaire consultée. Si elle est archivée, inaccessible ou inconnue, choisissez une affaire dans la liste. Sur la page de l’affaire, la zone **Métré de l’affaire** donne l’état du métré et l’accès à ses options (voir [La zone du métré sur l’affaire](#la-zone-du-métré-sur-laffaire)). Les jeux créés sur une ancienne version restent accessibles dans les plans de l’affaire. Un favori de version qui désigne une affaire archivée ou inaccessible affiche « Page introuvable ».

Le lancement présente une analyse **Détaillée** avec le forfait ChatGPT du
membre qui la demande, et le modèle et l’effort de son profil. Sur un jeu de
plans sans versions concurrentes, le récapitulatif affiche **Tout mesurer**, les
pages retenues, le périmètre (bâtiments compris), l’unité **par ouvrage** et
l’état d’enregistrement. Le membre peut confirmer le lancement directement. Le
message de réussite compte les fichiers de plan réellement mesurés : une version
écartée ou une copie identique n’y figure pas.

Un lien de lancement qui nomme un jeu de plans (qui a des fichiers) ou une
version les présélectionne à l’ouverture de la fenêtre, et de nouveau s’il en
nomme d’autres. Le jeu ou la
version que le membre choisit ensuite reste choisi tant qu’il est proposé, avec
des fichiers pour un jeu. Sinon la sélection revient au jeu du lien, au jeu par
défaut de l’affaire ou au premier jeu qui a des fichiers, et à la version du
lien ou à la première version proposée.

Dans la fenêtre de préparation, le bouton **Options du métré** ouvre quatre étapes dans
[`TakeoffPreparationPanel`](../../src/components/takeoff/TakeoffPreparationPanel.tsx).

1. **Mes documents** permet de choisir les pièces et les pages, d’ouvrir leur
   aperçu et de traiter les versions concurrentes. Le tri proposé par Decisions
   reste une action facultative.
2. **Ce que je veux mesurer** permet de préciser les bâtiments, lots, réseaux,
   niveaux, zones, inclusions et exclusions, ou de choisir un objectif spécialisé.
3. **Points à préciser** permet de compléter les conventions d’un objectif
   spécialisé, de répondre aux inconnues et d’accepter les réserves admissibles.
4. **Vérifier et lancer** réunit le périmètre, les sources, les conventions,
   les réserves et, tant que le démarrage automatique est inactif, la version de
   devis utilisée par le lancement manuel. Une fois actif, l’analyse n’a pas de
   version : celle qui reçoit ses quantités se choisit à leur envoi.

Les choix sont enregistrés avec un contrôle de révision. Une pièce ajoutée au
dossier (plan du jeu choisi, CCTP ou DPGF) après l’ouverture, ou reclassée (une
pièce jointe devenue CCTP, par exemple), n’est jamais enregistrée comme écartée :
l’enregistrement, la confirmation et l’admission sont refusés tant que la
préparation n’a pas été rechargée, et le rechargement lui applique le défaut de
son rôle actuel et la signale comme modifiée. Une pièce qui n’est plus dans le
dossier est affichée comme telle et peut être retirée de la préparation, qui
peut ensuite être confirmée et lancée.

Les anciennes préparations sont adaptées au lancement détaillé avec une mention
visible qui invite à vérifier les sources et le périmètre. Leurs sources et
leurs pages sont gardées ; un fichier téléversé pour un ancien lancement, absent
du dossier, reste affiché avec ses pages et bloque le lancement jusqu’à ce que
le membre le retire ou l’ajoute au jeu de plans. Un périmètre enregistré est
gardé tel quel, sa confirmation comprise. Un périmètre qui ne nomme rien reçoit
l’inclusion par défaut, et sa confirmation est alors retirée. Les jobs et
instantanés déjà créés gardent leurs valeurs historiques.

Le clic de lancement fige le modèle, l’effort éventuellement automatique,
l’identifiant opaque du profil et le Mac autorisé dans l’instantané attesté. La
confirmation compare cette sélection à celle que le récapitulatif affichait : si
le compte, le modèle ou l’effort a changé entre-temps, rien n’est confirmé, la
nouvelle sélection s’affiche et un nouveau clic est demandé.
L’admission vérifie que le même membre utilise toujours cette sélection. Le
traitement et les groupes vectoriels facultatifs la vérifient avant leurs appels.
Un changement de compte ou de réglage demande une nouvelle analyse. Seul le
membre qui a lancé une analyse peut la faire démarrer, avec son forfait : la
soumettre à nouveau, ou rejouer un lancement dont l’analyse attend encore ; toute
autre personne est invitée à préparer une nouvelle analyse. Les reprises
techniques du worker gardent la sélection figée. Les anciens jobs sans sélection
figée conservent leur comportement d’exécution historique.

## Démarrage automatique et demandes de métré

Le démarrage automatique est inactif tant que le propriétaire n’a pas posé sa
date d’activation (`private.takeoff_launch_activation`), après le déploiement de
la page d’affaire qui montre son état et la date des avis de fin d’analyse. Avant
cette date, rien de ce qui suit n’écrit.

Une **demande** est une exécution sur un manifeste scellé ; un **job** est
l’analyse d’une unité de ce manifeste. Le lot 2 scelle une seule unité groupée
qui contient les plans retenus ; le lot 3, une unité par plan (voir « Une
analyse par plan » ci-dessous). Les règles sont dans
[`launch-request.ts`](../../src/lib/takeoff/launch-request.ts) et
[`launch-request-server.ts`](../../src/lib/takeoff/launch-request-server.ts) ;
la base en garantit l’unicité et l’admission (migration
`20261121170448_takeoff_launch_requests.sql`).

- **Une seule fois par affaire.** La confirmation du brief réserve la demande
  automatique de l’affaire, dans la transaction qui confirme le brief : celle du
  serveur (qui écrit aussi l’événement du brief et le mandat), ou toute autre
  confirmation, qui la réserve sans mandat, en attente d’un geste. L’activation
  demande les deux dates (démarrage automatique et avis de fin d’analyse) : avec
  une seule, rien de nouveau n’est écrit. Le module du métré coupé, rien n’est
  réservé, évalué, admis ni payé (la base en décide, avec le réglage par défaut
  du serveur). Seuls le propriétaire de l’affaire et un administrateur ou un
  directeur confirment le brief (comme la règle du brief publiée) ; un brief sans
  pièce déposée, ou rattaché au dépôt d’une autre affaire, se confirme, son
  événement restant dans sa propre affaire. La même confirmation renvoyée après
  une réponse perdue retrouve sa demande. L’analyse démarre quand le dossier est « Dossier
  confirmé » (même règle que le titre du parcours : pièces présentes, aucune à
  revoir ni en classement, brief confirmé), que le classement finisse avant ou
  après la confirmation. Il n’y a qu’une demande automatique, pour toute la vie
  de l’affaire : deux confirmations, un
  dossier qui sort puis revient à « confirmé », un plan ajouté ensuite ou un
  échec ne la réarment jamais. Un dossier confirmé avant l’activation n’est pas
  armé : il garde son dernier métré et les options.
- **Qui paie.** Le membre enregistré comme ayant confirmé le brief, s’il peut
  lancer un métré sur l’affaire (administrateur, ou ingénieur propriétaire de
  l’affaire). Il en est averti dans la confirmation : « Une fois les plans prêts,
  le métré utilisera votre forfait ChatGPT et les réglages de Mon profil. » La
  fenêtre « Confirmer ce brief ? » lit cette mention à son ouverture, pour ce
  membre et le brief tel qu’il est alors (la même règle pour tout appelant :
  seulement un brief à confirmer, un membre qui peut payer, l’activation en
  place), et non sur la page affichée avant l’arrivée du brief. L’analyse d’un
  lot de pièces classe les pièces, écrit le brief, puis enregistre la fin du
  lot (le statut final de son dépôt) : la lecture du dossier lit les lots en
  cours avant le brief, et les relectures de la page continuent tant qu’un lot
  de l’affaire est en cours, en plus de leurs conditions habituelles. Un membre
  resté sur l’affaire pendant l’analyse voit donc le brief arriver, le confirme
  et voit la mention. Pendant la lecture,
  la fenêtre l’indique et « Oui, confirmer » attend. Si la lecture échoue, elle
  dit qu’elle n’a pas pu vérifier le forfait, propose « Réessayer » et laisse
  confirmer sans démarrer d’analyse. Le mandat n’est payable que si la
  confirmation porte cette mention telle que cette fenêtre l’a montrée (ce membre,
  ce forfait et ces réglages, cette activation) ; une fenêtre ouverte avant
  l’activation, montrée sans la mention ou dont la lecture a échoué confirme le
  brief et n’engage personne (« Métré non démarré — la confirmation du dossier
  n’a engagé aucun forfait ChatGPT »). Le mandat porte sur cette demande, cette
  affaire, ce membre, la sélection de son profil, la connexion ChatGPT en cours et
  le Mac du geste ; une déconnexion ou une reconnexion le retire (« partage
  révoqué ») quel que soit l’état du dossier, jusqu’au geste du payeur. Un lecteur qui confirme ne paie pas : « Métré non
  démarré — prise en charge par un métreur requise » ; un opérateur peut alors
  la prendre en charge sur son propre forfait par un geste explicite, et reçoit
  sa fin.
- **Démarrage.** Le Mac du mandat évalue la demande sans session : le dossier,
  chaque plan du dossier avec sa copie de travail de la génération courante, le
  droit du payeur, son forfait et sa sélection sur ce Mac. Il scelle alors la
  préparation déduite du dossier (avec les options enregistrées, sans écrire sur
  le brouillon des membres), les empreintes des octets lus et le manifeste, puis
  admet la demande : son job et les deux traces de création sont écrits dans la
  même transaction. Le scellement est celui de la confirmation d’un membre
  (voir « Sources et instantané de lancement ») : une pièce de référence que
  l’analyse ne lirait pas est laissée de côté et nommée, avec son motif, dans la
  couverture du manifeste, et l’analyse se fait sans elle ; elle ne consomme
  jamais le seul démarrage automatique de l’affaire. Lire une page ne dépense
  rien : seules les transitions du dossier et les gestes le font.
- **Ce qui empêche de démarrer** est un état visible, avec son motif, jamais un
  job présenté comme lancé ni un changement de mode de paiement : dossier non
  confirmé ou sans plan exploitable ; plan sans copie de travail ou que l’analyse
  ne pourrait pas ouvrir (la pièce est nommée) ; choix d’indice à faire ;
  forfait non connecté, partage révoqué ou
  connexion expirée, modèle absent, sélection changée depuis la confirmation,
  adresse non autorisée ou application hébergée ; payeur qui n’a plus le droit
  de lancer. Ces blocages du mandat ne se lèvent que par le geste « Reprendre avec
  mon forfait » du payeur, ou « Prendre en charge » d’un autre opérateur. Le geste
  porte la révision du mandat et l’action que l’affaire lui proposait : si l’une
  a changé entre-temps (un autre geste, une nouvelle confirmation), il est refusé.
  Le rejeu d’une confirmation renvoie la demande telle qu’elle est. Les
  causes passagères (limite d’admission, lecture d’une pièce, autre analyse en
  cours sur l’affaire) sont réessayées par le Mac.
- **Une seule analyse à la fois par affaire.** Une relance pendant
  l’exécution renvoie l’analyse en cours. Une analyse lancée hors de toute demande
  (avant l’activation) que quelque chose fera encore avancer compte comme en
  cours : en attente ou en lecture (sa reprise la clôt, un membre peut l’annuler),
  ou échouée avec une nouvelle tentative que la reprise locale fera ou clora (ce
  Mac, sans lot, moins de trois tentatives, dans le délai d’attente maximal). Une
  relance reçoit alors cette analyse, sans demande, et un démarrage automatique
  attend sa fin (« autre analyse en cours », réessayé par le Mac). Un échec ancien
  que rien ne relancera (l’ancien fournisseur, un lot, trois tentatives passées ou
  le délai dépassé) ne bloque rien. La zone du métré lit cette même règle dans la
  base (`public.takeoff_running_analysis_outside_request`). Une nouvelle tentative
  qui a attendu plus que le délai maximal n’est plus jamais lancée, seulement
  close par sa reprise : le Mac ne la sélectionne plus (le délai lu dans la base,
  `public.takeoff_local_retry_floor`) et la base refuse de la relancer
  (`TAKEOFF_JOB_RETRY_EXPIRED`).
- **Une relance et le démarrage automatique.** Tant que le démarrage automatique
  de l’affaire peut encore commencer sans nouveau changement du dossier (son
  payeur peut encore payer et son Mac l’évalue ou a du travail en attente, ou le
  membre qui relance peut le prendre en charge ou le reprendre), la base refuse la
  relance : il se prend en charge depuis la zone du métré. Sinon (il attend un
  changement du dossier, ou personne ne peut le faire démarrer), une relance admise
  le met de côté pour de bon (un état final), après avoir compté, comme
  l’admission automatique, un changement du dossier validé entre-temps : s’il permet
  au démarrage de commencer, la relance est refusée. Ni une nouvelle confirmation ni
  une prise en charge ne le réarment ; une nouvelle analyse est une relance, et
  l’affaire montre la relance, jamais le démarrage mis de côté. Le job d’une
  demande en cours ne peut pas être supprimé.
- **Une fois le démarrage automatique actif, toute nouvelle analyse est une
  demande.** La base refuse un nouveau job hors demande, par la fonction
  d’admission des lancements sur une version ou sans version comme par une
  écriture directe (`TAKEOFF_JOB_REQUEST_REQUIRED`, dit comme le refus d’un
  lancement sur une version) ; le rejeu d’un lancement fait avant retrouve son
  job. Une analyse lancée hors demande ne repart (resoumission d’un membre,
  nouvelle tentative de son Mac) que sous le verrou de lancement de l’affaire et
  tant qu’aucune demande de l’affaire ne tourne (`TAKEOFF_LAUNCH_REQUEST_RUNNING`,
  « Une analyse de l’affaire est en cours »). Avant l’activation, rien ne change
  (migration `20261121193413_takeoff_launch_exclusion_and_send_requests.sql`).
- **Une demande qui attend son Mac** (évaluation à faire, dossier modifié depuis,
  cause passagère à réessayer) depuis plus de quinze minutes peut être reprise
  par son payeur ou prise en charge par un autre opérateur. Trois vérifications
  du dossier qui échouent de suite la bloquent avec ce motif jusqu’à un geste.
- **Budget.** La demande scelle à son admission le budget par job de la lecture
  détaillée de l’entreprise (jetons et coût). Chaque appel payant de ses jobs
  (lecture détaillée et groupes vectoriels, réponse illisible comprise) est
  inscrit par le worker, sous le bail de la tentative, juste après la réponse, dans
  un registre que lui seul écrit ; une inscription impossible arrête l’analyse.
  Avant chaque appel payant de tout job, la base vérifie le module, que son
  créateur peut toujours lancer sur l’affaire et, pour une demande, qu’il reste du
  budget ; chaque tentative de lecture n’a que ce qui reste. Un dépassement du
  budget de la lecture ou de la demande la ferme avec ce motif (« Métré arrêté — le
  budget de cette analyse est épuisé »). Le lot 3 scelle un budget par plan.
- **Fin.** La fin enregistrée du job ferme la demande et publie un seul avis et
  un seul courriel à son payeur ; les jobs d’une demande ne publient pas d’avis
  propre. Un job jamais pris en charge est clos par la reprise des métrés en attente, et la
  demande avec lui.
- **Dossier modifié depuis l’analyse.** Un plan ajouté, remplacé ou retiré après
  l’admission est signalé sur l’affaire ; rien n’est relancé sans un geste.
- **Relancer** crée une nouvelle demande manuelle, un nouveau job et un lien vers
  l’analyse qu’elle remplace (aucune pour la première analyse d’une affaire, dont
  l’intention est alors « initial »), sur le forfait du membre qui clique,
  qui en reçoit la fin. Son reçu (la clé, la commande : membre, intention,
  analyse remplacée, jeu de plans et révision de la préparation, et sa réponse)
  est tenu à part des demandes et répondu avant toute autre vérification : un
  double clic ou un rejeu reçoit la même réponse, même si la préparation a changé
  depuis ; une relance refusée parce qu’une autre analyse tournait reste refusée,
  avec l’analyse qu’elle a trouvée, sans job payant ; la même clé pour une autre
  commande est refusée. Tant que sa réponse n’est pas arrivée (réponse perdue,
  erreur du serveur), le navigateur garde cette commande, une par membre et par
  affaire, même après un rechargement et pour tous ses onglets : le clic suivant
  du membre sur l’affaire la renvoie telle quelle (sa clé, l’analyse qu’elle
  remplaçait, son jeu de plans, sa révision) avant toute nouvelle commande, même si
  son analyse a fini entre-temps, et en montre la réponse ; seul un clic après
  cette réponse est une nouvelle commande. Une clé répondue dans un onglet n’est
  plus jamais renvoyée. Une relance qui croise une autre opération de l’affaire
  dans la base (annulée sans rien enregistrer) répond « Réessayez dans un instant »
  et garde sa clé ; elle prend l’analyse qu’elle remplace avant le verrou de
  l’affaire, comme la nouvelle tentative du Mac. La base refuse aussi une première analyse (« initial »)
  sur une affaire qui en a déjà une. Le module du métré désactivé refuse la
  relance, la prise en charge et la reprise.
- **Avant chaque appel payant**, le worker vérifie que le payeur peut toujours
  lancer un métré sur l’affaire. Un membre rétrogradé après avoir mis une analyse
  en file, ou qui n’est plus propriétaire de l’affaire, ne dépense plus rien :
  l’analyse échoue avec ce motif.

## La zone du métré sur l’affaire

La zone **Métré de l’affaire** est la seule place du métré sur la page de
l’affaire, dans la vue d’ensemble et dans « Chiffrage », y compris sans version
de devis. Le modèle est dans
[`affaire-takeoff-zone.ts`](../../src/lib/takeoff/affaire-takeoff-zone.ts), la
lecture dans
[`affaire-takeoff-zone-server.ts`](../../src/lib/takeoff/affaire-takeoff-zone-server.ts).
Lire la zone ne dépense rien et n’écrit rien ; elle se relit seule tant qu’une
demande s’évalue, tourne ou attend une cause passagère.

- **Ce qu’elle montre.** La dernière demande de l’affaire (jamais un démarrage
  mis de côté) : son état et son motif, les pièces qu’il nomme, la couverture
  scellée (plans retenus, pièces non lues et pourquoi), « Dossier modifié depuis
  l’analyse » avec les plans ajoutés, remplacés ou retirés du jeu que la demande a
  analysé, et la dernière fin d’analyse de l’affaire, le même événement que la
  notification des membres. Un plan ou une pièce n’est nommé qu’au membre qui peut
  lire sa copie ou sa pièce du dossier (le propriétaire de l’affaire et les
  administrateurs les lisent toutes) ; les autres lisent « Plan N » ou « Pièce N »,
  sans l’identifiant de sa source, et une analyse sans le nom du plan qu’elle a lu.
  La zone n’affiche que ce que le serveur a lu pour le membre de la page, dans son
  tenant actif : une session changée sans rechargement ne montre jamais la zone
  d’un autre membre.
  Sans demande, elle montre la dernière analyse de l’affaire, quelle que soit sa
  version, puis l’état du dossier. Une demande réservée est distinguée d’une
  analyse prise par le Mac (« En attente du Mac », « En cours »).
- **Les revues.** Chaque analyse de la demande dont le résultat se lit a son
  lien de revue ; sinon la dernière analyse lisible de l’affaire reste
  accessible (« Revoir l’analyse précédente ») : l’échec d’une relance ne cache
  jamais une revue antérieure. « Ouvrir le métré » mène à l’historique des
  analyses.
- **Le geste.** Le membre qui peut payer voit le geste que la base lui permet :
  « Reprendre avec mon forfait » (le payeur) ou « Prendre en charge avec mon
  forfait » (un autre opérateur), avec « Mon profil » quand la connexion ChatGPT
  est en cause ; loin du Mac connecté, il est invité à y ouvrir MergeOne. Un
  directeur voit l’état et son motif, sans geste ni options.
- **Les options du métré** (dès qu’il y a des plans, pour un administrateur ou
  un ingénieur qui peut écrire l’affaire, la règle de la préparation). Tant que le
  démarrage automatique est inactif, elles lancent comme avant : sur le brouillon
  courant ou sur un nouveau brouillon d’une version choisie, sans demande (la base
  n’écrit aucune demande avant l’activation). Une fois actif, elles ne créent
  jamais de job sans demande, et le serveur refuse tout nouveau lancement sur une
  version (le rejeu d’un lancement fait avant retrouve son job) : leur lancement
  est une demande manuelle, sans
  version, sur le forfait du membre qui clique (la première analyse de l’affaire,
  ou une relance qui nomme l’analyse de la demande affichée). Elles enregistrent
  seulement, sans rien lancer, tant que la demande automatique peut encore
  démarrer (la règle de la base pour le membre qui lit,
  `public.takeoff_launch_request_can_start` ; sinon elles lancent, et le démarrage
  est mis de côté), qu’une analyse tourne (y compris une analyse lancée hors demande avant
  l’activation) ou qu’une affaire sans analyse attend la
  confirmation de son dossier : le démarrage reprend alors les options
  enregistrées. Après l’admission, une
  option ne change jamais le job en cours.
- **Les accès.** Le menu « Plus » (« État du métré »), le cockpit et sa
  hiérarchie, l’exception du pilotage et la carte « Plans, preuves & exceptions »
  mènent à la zone et ne lancent rien. L’étape Plans de l’import lance, tant que
  le démarrage automatique est inactif, sur le brouillon que l’import vient de
  créer et le jeu qui a reçu les fichiers, comme avant ; une fois actif, elle mène
  à la zone ; l’ancre `#metre`
  y conduit et `metreOptions=1` ouvre ses options. Une fois le démarrage
  automatique actif, les liens de lancement de la page des métrés
  (`launch=1`, anciens favoris de version) ouvrent ces options, et cette page ne
  lance plus rien elle-même. La fin d’une demande ouvre la zone depuis les
  notifications. Il n’y a plus de proposition masquable ni de rappel à 24 h.

## Suivi d’une demande dans le centre d’activité

La page Métrés de l’affaire (`/dashboard/affaires/{affaire}/takeoff`) montre la
dernière exécution de l’affaire au-dessus de la liste des analyses : son origine
(démarrage automatique ou relance), son état et son motif, puis ses plans dans
l’ordre que son manifeste a enregistré. Une demande du lot 2 n’a qu’une unité
groupée : elle reste une seule « analyse groupée de N plans », avec les pages de
chaque plan, jamais N analyses ni N lectures réussies. Avec une analyse par plan,
chaque plan est dans un seul état (en attente, en lecture, lu, en échec, arrêté,
non démarré) et l’en-tête le résume : « 1 plan lu sur 3 · 1 en lecture · 1 en
attente ». La règle des états, la couverture et sa formulation sont celles du
répartiteur ([`launch-request-coverage.ts`](../../src/lib/takeoff/launch-request-coverage.ts)
et sa fonction SQL `private.takeoff_unit_state`) ; en attendant que son lecteur
des unités soit livré, le serveur dérive les unités du manifeste scellé et des
jobs selon cette même règle. Aucune avancée n’est estimée en pourcentage de
pages ou de temps.

- **Revue anticipée.** Dès qu’un plan est lu, « Revoir [plan] » ouvre ses revues
  (complète et ciblée), avec leur propre pagination et leurs preuves, pendant que
  les autres plans sont lus. Un plan lu sans ligne retenue reste consultable et le
  dit ; rien n’est alors à envoyer. La revue d’un plan nomme les autres plans de
  sa demande, ceux qui manquent encore, et mène au plan précédent ou suivant lu.
- **Ce que chacun voit.** Les lecteurs de l’affaire voient les états, les motifs
  et ouvrent les revues qu’ils peuvent lire. Le nom et les pages d’un plan (et
  d’une pièce du dossier) ne sont montrés qu’au membre qui peut lire sa source,
  selon les règles des plans et des pièces évaluées pour lui (le propriétaire de
  l’affaire et un administrateur lisent tous ses plans) ; les autres lisent
  « Plan N », sans l’identifiant de sa source. Seul le membre qu’une décision y
  autorise voit une action : pour une analyse arrêtée, la politique de reprise
  ([`operator-state.ts`](../../src/lib/takeoff/operator-state.ts), la même que le
  détail et la commande) ; pour une demande qui n’a pas démarré, le geste que la
  base lui permet (`public.takeoff_launch_request_action` : « Prendre en charge »
  ou « Reprendre avec mon forfait », ou ouvrir MergeOne sur le Mac connecté). Le
  serveur relit tout au moment du geste.
- **Bâtiment et niveau.** Chaque plan ouvre le même formulaire que le centre des
  plans (section « Bâtiment et niveau d’un plan »).
- **Ce que la demande n’a pas lu.** Les plans écartés à son scellement (autre
  indice retenu, copie identique, format non lu, lu par une analyse précédente)
  sont nommés, dans le suivi comme dans la zone de l’affaire ; une fois ses plans
  lus, les plans ajoutés, remplacés ou retirés du dossier depuis sont signalés,
  sans rien relancer.
- **Historique et liens.** Les demandes précédentes sont listées repliées, cinq
  par page. Un lien vers une demande (`?request=`) ouvre cette demande ; un lien
  vers une analyse (`?job=`, celui de l’avis de fin d’analyse) ouvre aussi la
  demande dont elle fait partie. La page suit alors aussi la dernière exécution
  de l’affaire et ses analyses lancées sans demande ; « Voir la dernière analyse
  de l’affaire » y revient.
- **Mise à jour.** La page lit une projection légère
  (`GET /api/takeoff/activity-center/requests`, [`request-activity-server.ts`](../../src/lib/takeoff/request-activity-server.ts))
  dont le nombre de lectures ne dépend ni du nombre de plans ni du nombre
  d’échecs, sans octet de PDF. C’est la seule lecture répétée de la page : toutes
  les 5 secondes pendant la lecture d’un plan (ou juste après la fin du
  précédent, ou d’une analyse sans demande mise en file à l’instant), toutes les
  30 secondes dans tout autre état qui peut encore bouger (le Mac, une nouvelle
  tentative ou la clôture attendue, une demande pas encore démarrée), plus du
  tout quand tout est clos. Une lecture qui échoue (réseau, serveur, délai
  dépassé, y compris la lecture du module ou de la session) est retentée
  30 secondes plus tard, la page indiquant entre-temps le dernier état connu ;
  seul un refus d’accès arrête les lectures et retire tout ce qui était affiché
  (la demande, le résumé et la liste), quelle que soit la lecture refusée. L’écart du dossier n’est recalculé que si le dossier a
  bougé depuis la lecture précédente, et le geste avant admission n’est relu
  qu’au rythme lent. Un
  onglet masqué ou hors ligne la suspend ; le retour sur l’onglet, la reconnexion
  et chaque geste la relisent aussitôt. La liste des analyses, l’historique des
  demandes et les fins d’analyse ne sont relus que lorsqu’elle signale une
  transition (jamais au renouvellement du bail d’une lecture), ou après un geste
  fait dans la liste. Le cache de cette projection est propre au membre et à son
  entreprise ; un autre membre repart d’une page vide. Une analyse que la liste
  montre en cours et que la projection ne voit plus en cours fait relire les
  deux. Une arrivée en arrière-plan ne déplace ni le
  focus, ni la sélection, ni une saisie en cours.
- **Étape suivante.** Quand la dernière exécution est une demande, plus récente
  que la dernière analyse lancée sans demande, l’étape suivante suit ses plans,
  jamais le dernier job créé : un plan en échec ou en attente ne cache pas la
  revue d’un autre.

## Contenu de la fiche

| Partie | Données conservées |
| --- | --- |
| Objectif | Tout mesurer, comptage, longueur, surface, lecture de quantités documentaires, comparaison DPGF, préparation d'achat ou estimation avec hypothèses ; confirmation explicite |
| Périmètre | Lots, réseaux, niveaux, zones, inclusions, exclusions ; confirmation explicite |
| Sources | Identifiant de document, nom, rôle, révision connue ou inconnue, identité du fichier, pages, sélection active et confirmation |
| Conventions | Unité, base documentaire/cotes/calibration, calibration de page et conventions d'achat si nécessaires ; confirmation explicite |
| Inconnues | Question, effet bloquant ou réserve, source/page éventuelle, réponse, responsable et décision |
| Destination | Analyse seule ou revue en vue du devis, version concernée, responsable de revue éventuel et confirmation |
| Profil | Identifiant, nom et version du profil réutilisé, lorsqu'il existe |
| Traitement | Niveau C et forfait ChatGPT ; sélection du profil figée sans jeton ni clé |
| Provenance | Préparation déduite du dossier, version de la règle de défaut et mention de conversion si nécessaire |
| Assistance acceptée | Contexte tenant/affaire/révision, empreintes, fournisseur/modèle, version de consigne, consommation connue et identifiants des propositions acceptées |
| Tri des pages | Par plan (`sources[].page_triage`) : version du fichier, nombre de pages, empreinte des questions, modèle, version de consigne, consommation du tri, acceptation ; par page : empreinte de la demande, type, niveau, zone, confiance, proposition (écarter, garder, à vérifier), raison et statut (proposée, à vérifier, corrigée) |

Un champ inconnu reste `null`. Il ne devient pas zéro. Les listes vides restent
vides ; le périmètre doit contenir au moins une inclusion, un lot, un réseau, un
niveau ou une zone. Le périmètre déduit couvre par défaut tous les ouvrages et
toutes les pages des plans retenus, avec le brief comme contexte.

## Conditions selon l'objectif

Les mêmes règles s'appliquent au récapitulatif et à la confirmation serveur par
`evaluateTakeoffPreparation`.

| Objectif | Conditions particulières |
| --- | --- |
| Tout mesurer | Plans actifs, unité adaptée à chaque ouvrage, base documentaire et aucune convention d’achat par défaut |
| Comptage | Au moins un plan actif, une unité de comptage ; aucun DPGF ni calibration imposés |
| Longueur | Plan actif, unité de longueur, cotes fiables ou calibration complète de la page retenue |
| Surface | Plan actif, unité de surface, cotes fiables ou calibration complète de la page retenue |
| Quantités documentaires | Source active et unité explicite ; aucune échelle géométrique imposée |
| Comparaison DPGF | Plan et DPGF actifs ; l'absence de bordereau reste bloquante |
| Préparation d'achat | Déductions, pourcentage de pertes, arrondi et conditionnement explicités ; le relevé brut reste distinct de la conversion en achat |
| Estimation | Périmètre, source, unité et conventions confirmés ; les hypothèses restent identifiables dans la préparation |

Avec **Tout mesurer**, une quantité que le modèle n’a pas pu mesurer apparaît
dans « Quantités à vérifier » sans créer de ligne chiffrée. Elle porte son
fichier et sa page quand le modèle donne une page de son fragment, sinon la
mention « page indéterminée ». Une réponse sans ligne mesurée n’est acceptée que
si au moins une de ces quantités porte une page de son fragment et une
observation, lues sur la forme « Page N : observation » de la réponse du modèle ;
sinon toute la réponse est refusée, comme avant.

La présence d'un objectif dans le contrat ne fournit pas à elle seule ses pièces
de référence : la préparation ne peut pas déclarer un plan comme DPGF pour lever
un blocage. Le serveur vérifie le rôle et l'identité des sources disponibles.

Une calibration relie une page à une longueur de référence positive, son unité et
une portée mesurée positive, avec son unité explicite `measured_span_unit` :
`pdf_points` pour une distance en points PDF (1/72 de pouce), ou `paper_mm` pour
des millimètres sur la page PDF d'origine à l'échelle physique de 100 %. Des pixels
d'écran dépendant d'un zoom ou d'un aperçu redimensionné ne constituent pas cette
référence.

Une calibration partiellement renseignée peut être enregistrée dans le brouillon,
mais bloque le lancement géométrique. L'unité manquante reste `null` dans les
anciens brouillons ; elle bloque une mesure calibrée sans bloquer un comptage
indépendant. La calibration concerne la page d'origine identifiée, dont la copie
dans le PDF d'analyse conserve la géométrie. Sa portée ne s'étend pas
automatiquement aux autres pages ni aux autres plans : retenir sa page ou
utiliser des cotes fiables pour l'ensemble du périmètre.

Pour les achats, `waste_percent: null` est inconnu et bloque. La valeur `0` est
une absence de perte explicitement renseignée. L'application n'invente pas les
conventions de déduction, d'arrondi ou de conditionnement.

## Inconnues et états

- **À compléter** (`incomplete`) : au moins un prérequis manque ou une décision
  n'est pas confirmée. La liste des blocages indique les points à corriger.
- **Prêt avec réserves** (`ready_with_reservations`) : tous les prérequis sont
  satisfaits et des réserves admissibles ont une réponse et un responsable.
- **Prêt à analyser** (`ready`) : tous les prérequis sont satisfaits pour les
  entrées sélectionnées. Ce statut ne valide pas les futures quantités.

Une inconnue ouverte bloque. Une réponse confirmée ou une exclusion exige une
réponse enregistrée et un responsable. Une inconnue bloquante ne peut pas être
contournée en acceptant une réserve : fournir sa réponse ou acter l'exclusion de
la partie concernée du périmètre.

Un plan isolé sans indice peut être analysé. Quand deux fichiers distincts
pourraient être des versions du même plan, la préparation demande quel fichier
retenir ou si les plans sont distincts. Le nom normalisé et le texte lisible du
cartouche servent à la comparaison ; un numéro de plan suivi d’une seule lettre
(« P-101_A », « P-101_B ») suffit à poser la question. Un indice lu dans le
cartouche est une lettre suivie d’au plus deux chiffres, ou un nombre d’au plus
trois chiffres, après « Indice », « Révision » ou « Rév ». L’indice retenu est
celui des métadonnées ou du nom du fichier, sinon celui que la préparation a
enregistré pour ce fichier (un indice saisi), sinon celui du cartouche. Un
cartouche qui en indique un autre est un écart à trancher dans « Mes documents »
(garder l’indice retenu ou prendre celui du cartouche) avant le lancement ; il
n’est jamais appliqué en silence. Le choix du membre devient l’indice enregistré
pour ce fichier : les confirmations suivantes le gardent tant que le fichier et
son cartouche ne changent pas. L’identité déduite d’un cartouche nomme chacune
de ses parties (bâtiment, niveau, discipline) : un bâtiment « 1 » et un niveau
« 1 » restent deux plans. Les indices
connus et les aperçus sont affichés. Le choix est lié aux empreintes des deux
fichiers : à l’admission, la version écartée est relue et doit être inchangée,
comme une copie identique mise de côté, et la version retenue l’est par le
traitement avant tout appel. Seul le jeu de plans lancé compte : ce qu’un autre
jeu de l’affaire avait mis de côté y reste pour un retour et ne bloque pas le
lancement. Revenir à ce jeu remet ses fichiers dans la sélection : une copie
identique est de nouveau mise de côté et relue, et après une confirmation sur un
autre jeu, le choix entre deux versions est demandé de nouveau. Des choix qui
écarteraient toutes les versions d’un plan sont refusés : retenir une version
rouvre les choix qui l’écartaient. Un scan sans texte lisible reste utilisable et
son indice peut rester inconnu.

Les valeurs déduites démarquent la portée et les conventions de départ. Une
réserve reste une décision humaine attribuée.

## Sources et instantané de lancement

Les références comprennent `document_id`, `plan_set_id`, `file_path`,
`source_version`, `source_updated_at`, `page_count`, la révision, les pages et
`content_hash`. Une liste de pages vide signifie toutes les pages ; une liste
explicite ne peut pas contenir de doublons ni dépasser le document connu.

Le serveur reconstitue les identités autorisées depuis l'affaire, puis compare
les références reçues. Une source modifiée ou disparue demande une nouvelle
confirmation. Les changements ne remplacent pas silencieusement la version
confirmée.

Les copies de contenu identique sont regroupées dans la lecture et toutes
leurs identités sont conservées dans l’instantané. Les pièces DPGF et CCTP
disponibles complètent le contexte dans les limites de format et de volume.
La préparation signale une pièce retenue que le serveur ne peut pas lire.

Le scellement des sources est le même pour la confirmation d’un membre et pour
le démarrage automatique
([`sealPreparationSources`](../../src/lib/takeoff/preparation-server.ts)). Avant
tout téléchargement, il vérifie, depuis les lignes du dossier, le format et la
taille enregistrée des pièces de référence, et que le fichier stocké est celui
que le dossier a enregistré pour cette pièce dans cette affaire (sa clé nomme
l’entreprise, l’affaire, le dépôt et la pièce) : le serveur et le traitement
lisent avec leur propre accès, que la règle de stockage des membres ne borne
pas, et une pièce dont la clé ne correspond pas n’est jamais lue (elle est
nommée). Le fichier stocké doit ensuite avoir la taille enregistrée (un plan, au
plus la taille d’un plan). Il lit chaque pièce de référence comme le traitement
la lira
([`readPreparationReference`](../../src/lib/takeoff/preparation-reference-loader.ts)),
dans les mêmes limites : 20 pièces, 20 Mo de fichiers, 200 pages retenues et 20
Mo joints ; une pièce n’y compte qu’une fois lue et gardée. Une pièce que le
traitement refuserait (un PDF abîmé ou protégé, un classeur invalide, des pages
retenues au-delà des limites) est montrée au membre avant sa confirmation, qui
n’a pas lieu ; le démarrage automatique la laisse de côté et la nomme. Chaque
plan est ouvert comme le traitement l’ouvre
([`openPreparedPlan`](../../src/lib/takeoff/preparation-source-loader.ts)) : un
plan invalide ou protégé, ou des pages retenues que le fichier n’a pas, arrêtent
la confirmation comme le démarrage automatique, en nommant le plan ; une version
que les choix d’indices écartent n’est jamais ouverte par le traitement et
n’arrête rien. Les plans lus, une fois les choix d’indices appliqués, doivent
tenir ensemble dans le budget de plans du traitement (nombre, taille et pages
réelles, au niveau de l’analyse) : une copie de travail du dossier n’enregistre
pas son nombre de pages, il est compté sur le fichier. Sinon la confirmation et
le démarrage automatique s’arrêtent en nommant les plans. Le cartouche d’un plan
du dossier donne son indice ; une page que le rendu ne peut pas dessiner laisse
cet indice non lu (le dossier ou le nom du fichier le donnent alors), sans
écarter le plan : le traitement lit le plan sans son cartouche.

L'instantané contient la préparation complète, sa révision enregistrée, l'auteur,
la date et l'état de préparation calculé. Les références et les valeurs copiées
ne sont plus liées en mémoire au brouillon. Le serveur confirme également le
SHA-256 des octets des plans, y compris pour les anciens imports sans empreinte
fiable. Pour une préparation déduite du dossier, il marque comme attestée chaque
pièce dont il a lu les octets : la revue ne sert la localisation et le PDF
d’origine d’un plan que pour une pièce attestée, qu’un membre ou le démarrage
automatique l’ait scellée. Les pièces d’une autre préparation restent attestées
par le membre, une à une, comme sa préparation l’exige. Le traitement
doit vérifier ce contenu avant de l'utiliser.

Les sources, pages et conventions sont des contraintes d'entrée. Les lots,
réseaux, niveaux et exclusions exprimés en texte guident l'analyse ; ils ne
constituent pas à eux seuls une preuve automatique que chaque quantité extraite
respecte ce périmètre. La revue des résultats reste nécessaire.

## Profils réutilisables

L'étape de périmètre permet d'enregistrer un cadrage comme profil nommé et de
reprendre les profils du tenant. `createTakeoffPreparationProfile` produit leur
contenu versionné ; `applyTakeoffPreparationProfile` le réutilise comme
proposition. Le profil reprend l'objectif, les lots/réseaux, les
inclusions/exclusions et les conventions.

Il ne reprend ni les documents de l'affaire, ni ses niveaux/zones, ni une
calibration, ni ses inconnues et décisions, ni la destination. L'application d'un
profil rouvre la confirmation de l'objectif, du périmètre et des conventions. Les
profils sont enregistrés côté serveur sous les droits du tenant ; aucun profil
métier n'est présumé validé par défaut.

## Assistance IA

L'assistance produit des propositions structurées et des questions reliées aux
sources disponibles. Accepter une proposition complète le brouillon ; les champs
confirmés ne sont pas remplacés automatiquement. L'assistance ne fournit ni
quantité mesurée, ni échelle ou règle d'achat inventées.

Le contexte disponible est celui de l'affaire, des références et du brief fournis
au service. Une suggestion tirée d'un nom de fichier reste une suggestion : elle
ne prouve pas la présence d'un ouvrage sur une page.

Le service relit le résumé, le périmètre et les lots du brief de l'affaire pour
éviter leur ressaisie. Leur reprise fournit des propositions et ne remplace pas
les décisions déjà confirmées dans la préparation. Les questions peuvent être
ordonnées par Decisions sur une réponse explicite ; aucun point obligatoire ne
disparaît parce qu'il est moins prioritaire.

L'acceptation conserve une trace bornée dans le brouillon, puis dans son
instantané : fournisseur, modèle, version de consigne, date, tenant, affaire,
révision, empreintes de contexte, consommation connue et identifiants des
propositions acceptées. Cette trace ne contient ni identifiant de connexion, ni
jeton d'accès, ni copie du contenu des pièces. Elle n'accorde aucun droit et ne
confirme aucun champ métier. Les propositions non acceptées restent une aide à
la saisie.

L'ordre proposé des questions et la prochaine action utile ne modifient pas les
règles de lancement. La connexion rédactionnelle et Decisions ont des capacités
et une consommation distinctes. Une indisponibilité conserve la préparation et
le parcours manuel. La configuration et les limites de la connexion locale sont
décrites dans [ChatGPT local](../testing/chatgpt-local.md).
La configuration distincte de Decisions est décrite dans
[Decisions](../testing/decisions.md).

## Tri des pages

Le tri n'envoie au niveau C que les pages utiles, sans écarter de plan utile :
Decisions propose, l'utilisateur accepte ou corrige. Il est demandé explicitement
par « Proposer le tri des pages », jamais à l'ouverture ni au rechargement.
L'action enregistre d'abord le brouillon, puis traite un plan actif à la fois avec
la révision attendue ; un brouillon modifié pendant le tri provoque un conflit
explicite. Le bouton est désactivé, avec sa raison, hors du niveau Détaillé, sans
plan actif du dossier, ou quand Decisions n'est pas activé pour le métré
(`MERGEONE_TAKEOFF_DECISIONS=1`, voir [Decisions](../testing/decisions.md)).
La sélection manuelle des pages reste toujours disponible et le métré lançable.

Le serveur lit chaque page du plan confirmé (texte et vignette) et pose trois
questions : le type (plan de réseau, d'architecture, de toiture, de masse, coupe,
schéma, façade, détail, pièce écrite, autre ; un réseau dessiné sur une toiture
ou une masse est un plan de réseau), le niveau et la zone. Les choix de niveau et
de zone viennent du texte de la page et du périmètre (`RDC`, `R+n`, `R-n`, `SSn`,
`Zn`, normalisés), plus `inconnu` ; sans candidat, la question n'est pas posée.

Pour le niveau, le serveur lit aussi le coin inférieur droit de la page affichée
(les derniers 20 % de sa largeur et de sa hauteur, après recadrage et rotation).
L’extrait de cette zone est limité à 2 000 caractères et envoyé séparément du
texte principal, toujours limité à 12 000. Les niveaux lus dans cette zone sont
proposés en priorité. Ailleurs sur la page, le cartouche peut fournir un
candidat via le texte principal. La vignette aide à choisir parmi les niveaux
déjà proposés.

Un niveau imprimé hors de ce vocabulaire (`L00`, `L01`, `GANTRY` sur un data
center) se déclare dans les niveaux du périmètre. Il est gardé tel qu'écrit, sans
équivalence (`L00` n'est pas le RDC), sur 16 caractères au plus : majuscules,
chiffres, espace et `. _ / + -`. Un mot du périmètre avec une minuscule
(« Tous ») n'est pas un niveau. Il n'est proposé que sur une page qui l'imprime
à l'identique (même casse, sans lettre ni chiffre accolé) et vient après les
niveaux connus, jamais classé parmi eux. Deux pages ne partagent un tel niveau
que si le libellé est le même. Sans tri, la lecture vectorielle le lit dans le
nom du fichier quand un seul libellé déclaré y figure. Donner un niveau ajoute
des contrôles (doublons entre plans d'un même niveau) et n'en retire aucun.

Une page n'est proposée à l'écart que si le type répondu est une coupe, une
façade, un plan de toiture, un plan de masse ou une pièce écrite, avec une
confiance d'au moins 0,8, une réponse complète et une vignette lisible. Sinon elle
reste retenue « À vérifier » (confiance faible, refus, réponse partielle, échec,
vignette absente ou blanche, plafond de jetons ou durée atteints). Une vignette à
laquelle manque une image du PDF garde les textes et les tracés qui l’entourent.
Une image de plus de 8 mégapixels est omise avant décodage. Un scan constitué
uniquement de cette image donne une vignette blanche. Qu’elle soit blanche ou
qu’elle contienne encore du texte ou des tracés, une vignette à laquelle il
manque une image laisse la page retenue « À vérifier ».

La proposition s'affiche à part. Seule « Accepter le tri » écrit `pages` et
`active` : les pages retenues, toutes les pages par la liste vide, ou la pièce
désactivée quand toutes ses pages sont écartées (jamais `pages: []` pour aucune
page). L'acceptation rouvre la confirmation de la pièce et du lancement. Retenir
ou retirer une page ensuite est une correction marquée « Corrigée », que ni un
nouveau tri ni une nouvelle acceptation n'écrasent. Changer de niveau garde la
sélection. Les pages inchangées (fichier, questions, modèle, vignette) ne sont pas
redemandées ; une nouvelle version du fichier efface le tri sans toucher la
sélection. Le worker de niveau C est inchangé : il ne copie que les pages
confirmées.

Un plan de plus de 60 pages n'est pas trié automatiquement : un message invite à
sélectionner ses pages à la main. Un PDF dont le nombre de pages lu diffère de
celui du dossier est refusé avant tout appel.

Le schéma strict ajoute `page_triage` à chaque source, `null` compris, quel que
soit `MERGEONE_TAKEOFF_DECISIONS`. Dès qu'une préparation est enregistrée ou
confirmée avec cette version, son brouillon et son instantané (worker compris)
ne peuvent plus être relus par une version antérieure : ne pas revenir en
dessous de cette version après le déploiement.

## Bâtiment et niveau d’un plan

Chaque plan de l’affaire porte, pour une version précise, deux valeurs : son
bâtiment et son niveau. Elles se lisent et se corrigent à un seul endroit, le
bouton « Bâtiment et niveau » de la ligne du plan (page Plans) ; la revue d’un
métré montre la localisation des plans qu’il a lus et renvoie à ce même
formulaire.

Une version est la pièce du dossier dont le plan est la copie de travail (ou le
fichier lui-même quand il a été déposé hors du dossier), à l’empreinte SHA-256
des octets que le serveur relit. Une nouvelle copie des mêmes octets (un
reclassement de la pièce en crée une) garde sa correction sans rien demander ;
d’autres octets sont une autre version. Aucune valeur n’est rattachée à un plan
« en général » ni montrée sur les octets d’une autre version.

Sans correction, chaque champ est proposé d’après ce que montrent ces octets :
le cartouche (coin inférieur droit) des douze premières pages, puis le nom
d’origine du fichier s’il est univoque. Seul le nom sous lequel le plan a été
déposé compte : le nom de stockage, nettoyé, n’est jamais une lecture. Le brief
et le périmètre ne sont qu’une aide à la saisie : un bâtiment commun à cinq
plans ne prouve la localisation d’aucun. Chaque valeur indique sa source et ses
pages et reste « à vérifier ». Un cartouche lu qui ne l’indique pas et un nom
muet donnent « À préciser » ; plusieurs valeurs lues donnent « Plusieurs
niveaux » (ou « Plusieurs bâtiments ») avec chaque page ; un nom qui contredit
le cartouche reste affiché comme « Autre lecture ». Un cartouche qui n’a pas été
lu (pages sans aucun texte, comme un plan scanné, PDF illisible, octets qui ne
sont plus ceux du plan, limite de lecture d’une revue) est dit « Cartouche non
lu » : le nom du fichier n’est alors jamais proposé à sa place, ses valeurs
restent seulement affichées à côté. RDC, R+n, R-n et SSn gardent leur écriture ; un libellé libre comme
`L00` est conservé tel qu’écrit, sans équivalence inventée. Le tri des pages par
IA n’est jamais déclenché pour remplir ces champs.

Un opérateur de l’affaire (administrateur, ou ingénieur propriétaire de
l’affaire) choisit pour chaque champ : suivre la lecture du plan (toujours à
vérifier), saisir une valeur, ou « À préciser ». « À préciser » écarte la
lecture : la valeur est inconnue partout (plans, revue, relance), et ce que le
plan montre reste affiché à côté. Un champ que l’opérateur ne touche pas reste
sur la lecture du plan : corriger le niveau ne confirme pas le bâtiment.
Confirmer une valeur lue est un geste sur ce champ : « Valeur saisie », qui
reprend ce que le plan montre. Une valeur est « confirmée » quand elle reprend la
proposition, « corrigée » sinon. Chaque champ garde son choix, son auteur, sa
date et la génération où il a été fait ; un champ que l’enregistrement ne change
pas garde les siens. Le choix se retrouve dans les plans, la revue et toute
relance de la même version. Deux onglets qui enregistrent la même version : le
second reçoit un conflit et voit la valeur enregistrée.

Les corrections enregistrées et leur historique se lisent comme l’affaire : un
directeur qui lit l’affaire les lit, nom du document et empreinte compris. Ce
qui demande que le plan soit visible, c’est la lecture de ses octets (le
cartouche) dans les écrans. Il ne modifie rien.

Pour de nouveaux octets du même plan, la correction précédente est présentée
préremplie avec sa provenance (l’auteur et la date de chaque champ), à vérifier,
quand elle fixe au moins une valeur ; « Valider pour cette version » la reporte
sur la nouvelle version. Il en va de même pour la pièce que la préparation a
retenue à la place d’une autre, d’après ses choix d’indices valides entre les
plans qu’elle peut retenir (un plan que le membre a écarté n’en donne aucun),
depuis la pièce écartée ; deux pièces qui ont seulement le même nom ne sont
jamais rapprochées. Le report garde la correction d’origine, la génération à
laquelle elle a été proposée et les champs repris ; quand plus aucun champ n’est
repris, l’origine disparaît aussi. Tous les champs repris le sont d’une même
origine : reprendre un champ d’une autre correction pendant que l’autre champ
est encore repris est refusé ; il faut d’abord saisir cet autre champ. Si la
correction d’origine a changé entre-temps, l’enregistrement est refusé et le
formulaire repart de sa valeur actuelle ; rien de ce que l’opérateur n’a pas
saisi n’est enregistré comme saisi. Quand une autre proposition arrive pendant
que le formulaire est ouvert (une relecture en arrière-plan, un enregistrement
refusé), seuls les champs qu’elle concerne repartent d’elle : la saisie de
l’opérateur dans l’autre champ est conservée, et le formulaire dit que la
proposition a changé. La
revue d’une analyse dont le plan a changé depuis montre la correction de la
version qu’elle a lue, sans en proposer d’autre.

Quand le dossier remplace la copie d’un plan pendant qu’elle est ouverte (un
reclassement de la pièce en crée une autre), la lecture ou l’enregistrement est
refusé avec la même réponse, quelle que soit l’étape où le remplacement est
constaté (fichier disparu, octets disparus, commande qui refuse la copie) : le
plan a été remplacé, voici sa copie actuelle, ou il n’en a plus. Seule une copie
dont la source, telle que la base la résout, est la même pièce est proposée. Le
formulaire affiche alors cette copie, avec ce qui s’y applique. Le dossier
enregistre une nouvelle copie avant d’en déposer le fichier : une copie actuelle
dont le fichier n’est pas encore là est « en cours de préparation », à réessayer
dans un instant, jamais introuvable. La revue d’une analyse qui avait lu l’ancienne copie le dit
aussi et ouvre la copie actuelle ; la correction de la pièce s’y applique tant
que les octets sont les mêmes.

La correction est une donnée à côté du plan : elle ne modifie ni le fichier (ni
sa date, qui entre dans la version d’une analyse en cours), ni la préparation,
ni les lectures du worker, ni un devis. Les pages gardent leur propre
localisation dans la revue. À ce stade la localisation est descriptive : ni la
revue des lignes, ni les contrôles d’envoi ne l’utilisent encore.

## Une analyse par plan (lot 3)

Une analyse par plan est inactive tant que le propriétaire n’a pas posé sa date
d’activation (`private.takeoff_plan_dispatch_activation`), après les deux dates du
démarrage automatique et une fois le Mac autorisé passé à cette version. Avant,
quelles que soient les activations du lot 2, une demande scelle son unité groupée
comme ci-dessus et tout le travail groupé ou autonome garde ses écritures, ses
comptes, ses codes publics et ses issues : ses appels sont vérifiés comme avant,
sans réservation ; la demande groupée se clôt par les instructions du lot 2 ; la
reprise hébergée suit les siennes pour tout job qui n’est pas un plan d’une
analyse par plan ; une analyse groupée ne s’arrête pas plan par plan. Retirer
l’activation n’arrête que les nouvelles admissions : les plans déjà admis restent
lus un à la fois, sous le créneau du Mac, et tant qu’un de ces plans est à l’œuvre
sur un Mac (ou que son créneau reste tenu par un bail non expiré, même celui d’une
lecture arrêtée dont l’appel peut encore courir), tout autre job de ce Mac ne
démarre, ne renouvelle son bail et ne paie que sous ce créneau. Tant que l’envoi partiel n’est pas livré,
l’activer ferme l’envoi de toute nouvelle analyse, même d’un dossier d’un seul
plan (voir le dernier point). La base en décide (migration
`20261121231238_takeoff_plan_dispatcher.sql`) ; le serveur suit
[`launch-request.ts`](../../src/lib/takeoff/launch-request.ts),
[`launch-call-ledger.ts`](../../src/lib/takeoff/launch-call-ledger.ts) et
[`local-dispatcher.ts`](../../src/lib/takeoff/local-dispatcher.ts).

- **Une demande, un job par plan.** Le même scellement (préparation, empreintes,
  manifeste) est admis comme une unité par plan retenu, chacune avec son job,
  dans la transaction qui scelle la demande. Un plan sans empreinte est refusé au
  scellement, comme son travailleur le refuserait. L’ordre de métré scellé est
  celui des deux formats (lot 4) : l’extraction libre, ou, une fois le second ordre
  activé, la liste des postes de l’affaire dans sa dernière révision, qu’une
  commande par plan scelle comme une analyse groupée. Un PDF de plusieurs feuilles ou
  niveaux reste une unité. Chaque job atteste la projection de son unité : son
  plan, ses pages d’origine retenues (les pages 2 et 7 restent 2 et 7 dans le
  résultat ; le travailleur les lit dans l’ordre du manifeste, croissant, quel que
  soit l’ordre où sa source les listait), les références communes (DPGF, CCTP), et
  un renvoi à sa demande ;
  le PDF n’est pas recopié et la préparation commune n’est pas réécrite. Une
  référence n’est jamais une unité. Un dossier d’un seul plan donne un seul job.
- **Un ordre enregistré.** Les plans sont rangés une fois, au scellement, par
  nom affiché (sans casse, accents ni espaces répétés, « Plan 2 » avant
  « Plan 10 »), puis par identifiant de la copie ; cet ordre est lu avant la
  première lecture et ne change plus, même si un plan est renommé.
- **Un plan à la fois sur le Mac.** Le Mac autorisé tient un créneau : le job
  qu’il lit, détenu par le jeton du bail de ce job, avec une génération qui
  augmente à chaque prise. Le créneau est pris avec le job, sous le verrou du
  Mac, dans la même transaction ; renouvelé avec le bail ; rendu par la fin du
  job avec le même jeton, ou par le travailleur quand sa tentative finit. La
  ligne du créneau est le seul point de sérialisation : une prise attend un
  renouvellement en cours et décide sur sa dernière version, et un renouvellement
  dont le Mac a été repris est refusé. Un plan ne démarre ni ne renouvelle son
  bail que sous son créneau, quel que soit le processus qui le prend (la prise
  directe d’un travailleur d’une version précédente est refusée) ; une nouvelle
  tentative d’un plan qui a attendu plus que le délai maximal ne démarre jamais,
  seule sa reprise la clôt. Depuis l’activation, et tant qu’un plan est à l’œuvre
  sur le Mac, tout autre job de ce Mac ne démarre que sous le créneau, et le
  renouvellement d’un job dont le Mac est tenu par un autre est refusé comme un
  bail perdu. Un arrêt par un
  membre ne libère pas le Mac : l’appel de la lecture arrêtée peut encore courir,
  jusqu’à ce que son travailleur finisse ou que son bail expire. Un second
  processus, un autre onglet, une reprise ou une relance du même Mac ne démarre
  pas un second plan : il attend son tour. Le
  Mac sert la demande admise la plus ancienne, ses unités dans l’ordre
  enregistré ; un plan qui attend une nouvelle tentative technique ne retient
  pas les autres. Un job encore lu sans créneau (pris avant l’activation) retient
  aussi le Mac. Un bail expiré libère le créneau ; la reprise des métrés en
  attente clôt la tentative abandonnée comme « résultat inconnu ».
- **Les limites d’admission** comptent une demande de plusieurs plans comme une
  seule analyse (première unité inscrite et première prise en charge) ; ses
  nouvelles tentatives comptent chacune. Une demande sans plan multiple, ou un
  job sans demande, est compté comme avant. Le Mac et la reprise hébergée
  jugent le tour d’un plan par la même règle que l’admission de sa prise en
  charge.
- **Un budget par plan.** L’enveloppe de la demande reste celle d’une analyse
  groupée (le budget par job de l’entreprise) ; elle n’est pas multipliée par le
  nombre de plans. Chaque unité en scelle sa part, au prorata des pages qu’elle
  lit (un plan dont le nombre de pages n’est pas connu au scellement pèse la
  moyenne des autres), arrondie au-dessus pour qu’une enveloppe positive ne
  laisse aucune unité sans rien ; les soixante pages de lecture vectorielle du
  dossier sont réparties de même, dans l’ordre enregistré. Un plan entier dont le
  nombre de pages n’est pas enregistré pèse les pages comptées sur ses octets au
  scellement (ou à la commande). La part d’un plan est un seuil d’arrêt pour
  démarrer un nouvel appel, jamais empruntée aux autres plans : ce qu’un plan lu
  n’a pas dépensé ne passe pas aux suivants, et un appel commencé sous le seuil
  peut coûter plus que la part, le registre l’imputant une fois à son total réel.
- **Chaque appel payant est réservé avant d’être envoyé**, identifiant en main,
  sous le verrou du job puis de la demande : il faut un solde positif de l’unité
  et de la demande, ce qui est réservé ou inconnu compris ; un appel n’est pas
  plafonné au solde (le forfait n’a pas de limite de sortie). Il réserve sa
  borne (le plus gros appel observé de sa branche dans la demande, sinon une
  estimation de départ de 30 000 jetons, à mesurer avant l’activation) et est
  réglé une seule fois avec le total d’usage de sa réponse : `total_tokens`
  entier, positif, pas inférieur à chacune des parties données (`input_tokens`,
  `output_tokens`), ni à leur somme quand les deux le sont. Un appel qui finit
  sans tel total (pas de réponse, une réponse sans usage ou d’usage incomplet), ou
  encore réservé quand sa tentative finit ou que son bail a pris fin (avant toute
  reprise), reste retenu comme « consommation indéterminée » : rien n’est
  recrédité, et **plus aucun appel payant de la demande n’est fait** ; sa
  tentative n’est pas reprise d’elle-même, ses plans pas encore commencés sont
  clos avec ce motif, que le membre lit sur chaque plan, et le nombre d’appels de
  consommation indéterminée s’affiche dans le suivi. Un membre peut relancer les
  plans à lire. Une nouvelle tentative ne repart jamais de zéro. Si la
  consommation indéterminée d’un appel ne peut pas être inscrite, la tentative
  s’arrête là, sans autre appel payant.
  Une question des groupes vectoriels attend la fin d’une autre question de sa
  tentative quand seules elles retiennent le solde. Une question refusée (le
  registre la refuse, le mandat ou la connexion ChatGPT est retiré, le bail perdu,
  la consommation non enregistrée) arrête le plan, comme avant ; une question dont la réponse est
  inutilisable mais dont l’usage est connu laisse ses groupes aux règles.
- **Un plan qui échoue échoue seul** (PDF corrompu, source modifiée après
  l’admission), avec son motif ; les autres continuent si le mandat et le budget
  le permettent. Une source modifiée est enregistrée en échec définitif tant que
  le travailleur tient son bail : le plan suivant démarre aussitôt. Quand l’enveloppe de la demande est épuisée avant le tour d’un
  plan, ce plan est clos sans avoir démarré, avec ce motif.
- **Arrêter le reste** : un opérateur qui peut lancer sur l’affaire arrête les
  plans pas encore lus de la demande en cours ; une lecture en cours ne peut plus
  rien écrire ni dépenser ; les plans lus restent. Un arrêt d’une demande déjà
  finie répond aussitôt, sans rien verrouiller ; un arrêt ne fait jamais attendre
  une relance qui nomme un de ses jobs. Une analyse groupée ne
  s’arrête pas ainsi : elle s’annule comme un job.
- **Couverture.** Chaque unité est dans un seul état : en attente, en lecture,
  lue, en échec, arrêtée, non démarrée (ses jobs le disent ; une ligne de
  résultat ne fait jamais un succès). « 1 plan lu sur 3 · 1 en lecture · 1 en
  attente ». Le centre d’activité lit cet état, les plans dans leur ordre et la
  consommation de la demande (`readTakeoffLaunchRequestUnits`).
- **Fin.** La fin du dernier plan ferme la demande et publie un seul avis et un
  seul courriel à son demandeur, qui pointe vers son suivi : réussie si tous les
  plans sont lus, partielle si certains le sont (« 2 plans lus sur 3 » ;
  « 1 plan disponible, 2 arrêtés à votre demande » après un arrêt, un plan en
  échec ou non démarré avant l’arrêt nommé à part), en échec si
  aucun ne l’est et qu’un plan a échoué ou n’a pas démarré, annulée si tout a été
  arrêté avant toute lecture (sans courriel). Un plan seul ne publie rien. Une
  demande dont toutes les unités ont fini sans être fermée est fermée par la
  reprise hébergée, à partir de ce qui est enregistré, sans appel.
- **Relancer un plan** lit seulement les plans demandés : par défaut le plan de
  l’analyse qu’elle remplace (ou les plans d’une analyse groupée, dans une demande
  ou lancée hors de toute demande), chacun à sa copie de travail actuelle, selon la
  décision du lecteur des localisations de plan (génération et source de la pièce du
  dossier, suppression de la copie) : un plan que le dossier a remplacé depuis (une
  nouvelle génération de sa pièce est une nouvelle copie, sous un nouvel
  identifiant, et l’ancienne copie peut rester dans le jeu jusqu’à son nettoyage) se
  relit à sa copie actuelle, retrouvée par la pièce du dossier que la base a notée
  pour chaque copie et garde après sa suppression. Une copie déposée dans le jeu est
  son propre plan, quelles que soient ses métadonnées, y compris dans les analyses
  scellées avant cette règle. Quand un plan de l’analyse n’a pas de copie actuelle
  (sorti des plans de l’affaire, copie manquante ou illisible pour l’instant, ou
  ancienne génération encore dans le jeu sans copie qui la remplace), il n’est
  jamais lu ; l’analyse ne se relance pas telle quelle et rien n’est enregistré :
  un autre de ses plans absent de la préparation confirmée est
  d’abord à confirmer ; sinon la fenêtre dit lequel et pourquoi, en le nommant, et
  propose de choisir parmi ses autres plans ceux à relire (aucun coché d’avance),
  par une commande qui les nomme ; un lancement de l’affaire envoyé depuis un autre
  onglet et resté sans réponse, d’un autre contenu, n’est jamais envoyé à la place
  des plans cochés : la fenêtre le dit, et le membre le renvoie ou le met de côté
  d’abord ; sans autre plan, la commande est refusée en le disant (un plan sorti
  des plans de l’affaire ne revient pas, une copie manquante peut revenir) ; un plan
  ajouté au dossier après l’analyse se lit par une commande qui le nomme et
  nomme l’analyse qu’elle complète : une commande sans analyse nommée est la
  première analyse de l’affaire, refusée quand l’affaire en a déjà une (la base
  décide de l’ordre de ses refus : un démarrage automatique qui peut encore
  commencer passe avant). La première analyse lancée depuis la zone de l’affaire,
  sans nommer de plan, lit tous les plans que sa préparation retient, chacun en
  son unité ; la base vérifie que ce sont ceux de la préparation confirmée de la
  révision nommée (une commande qui nomme ses plans n’en lit que parmi eux). Un plan dont le nombre de pages n’est pas enregistré et dont les
  octets ne se lisent pas refuse la commande, nommé, comme le scellement
  automatique. Les
  limites du jeu de plans s’appliquent à l’ensemble des plans demandés, avant
  leurs unités. Les plans qu’une analyse antérieure de l’affaire a réellement lus
  et que la commande ne nomme pas sont notés comme non demandés, avec la
  génération lue : pour chaque plan (sa pièce du dossier, quelle que soit sa
  copie), sa dernière lecture réussie, quelle que soit la demande qui l’a faite ;
  une relecture en échec, arrêtée ou non démarrée, ou une analyse plus récente qui
  ne l’a pas lu, laisse la lecture précédente. Seul un plan encore dans le jeu de
  plans (sa copie, ou une copie de sa pièce) est ainsi noté : un plan qui en est
  sorti n’est pas écarté par cette commande, et son retrait n’est pas signalé de
  nouveau ; une révision que le membre a écartée dans la préparation confirmée
  reste notée comme écartée. Toutes les demandes analysées de l’affaire sont lues,
  avec leurs unités, en une lecture (une de plus par millier de demandes), l’état
  de chaque unité dérivé de son job par la règle de la base.
  L’affaire ne les montre pas comme ajoutés depuis, mais signale encore leur
  remplacement ou leur retrait ; un plan jamais lu reste signalé comme ajouté, et
  un plan que la commande relit n’est pas noté à son ancienne copie. Les copies
  écartées du jeu de plans sont notées comme telles.
  Son identité nomme ses plans (celle d’une première analyse de tous les plans
  est celle du lot 2) ; le rejeu de la même clé ne dépense rien de plus et est
  répondu avant toute lecture de la préparation, sous l’identité du reçu, quelle
  que soit l’activation au moment du rejeu, et avant toute lecture du jeu de plans :
  il est cherché sous les copies que l’analyse remplacée avait lues, puis, si une
  autre identité tient la clé, sous chaque identité que la même relance a pu avoir
  depuis l’analyse (une par copie que les remplacements de ses plans ont donnée
  depuis, la plus récente d’abord, dans l’ordre d’enregistrement de la base) ;
  une autre sélection de plans sous la même clé est une autre commande, refusée.
- **L’envoi au tableau de chiffrage** d’une analyse par plan se fait plan par plan,
  pendant que les autres plans de la demande sont lus (lot 3, migration C : voir
  « Envoyer un plan pendant que les autres sont lus » dans
  [regles-metre.md](regles-metre.md)). La base ne la rattache à une version que par
  l’envoi qui a vérifié son contexte. Une analyse groupée s’envoie comme avant.

## Base de données et validation

La migration
[`20261029002420_takeoff_preparations.sql`](../../supabase/migrations/20261029002420_takeoff_preparations.sql)
est requise avant d'utiliser le nouveau parcours dans un environnement. Elle
stocke les brouillons et confirmations par tenant et affaire et relie les
nouveaux traitements à leur instantané confirmé. Une base non mise à jour renvoie
une indisponibilité explicite. Les anciens traitements restent des historiques.

La migration partagée et le déploiement sont deux actions séparées, soumises à
autorisation explicite. Un commit ou un push ne les exécute pas.

La migration
[`20261121040445_takeoff_plan_locations.sql`](../../supabase/migrations/20261121040445_takeoff_plan_locations.sql)
porte la localisation des plans : une ligne par version (source et empreinte),
sa génération, le choix, la valeur, l’auteur et la génération de chaque champ,
la correction d’où vient un report et l’historique de chaque changement, et la
source de chaque fichier de plan, notée à sa création, pour qu’une analyse dont
la copie de travail a été remplacée retrouve la correction des octets qu’elle a
lus. Elle se lit comme l’affaire. Une correction s’écrit en deux temps : le
serveur relit les octets du plan, puis atteste, avec son rôle de service, la
version (source et empreinte) et la correction précédente qu’il propose ; la
session du membre ne peut pas attester. Une nouvelle attestation retire celles
du même membre sur la même affaire qui ne peuvent plus servir (utilisées ou
expirées). La commande `set_takeoff_plan_location` consomme une seule fois une
attestation faite pour ce membre, de moins de quinze minutes à l’horloge au
moment où elle est consommée. Elle vérifie les droits du membre sur l’affaire au
départ, de nouveau une fois l’affaire verrouillée (un archivage peut s’être
terminé pendant l’attente) et une dernière fois juste avant d’écrire (une
réaffectation ou un changement de rôle peut s’être terminé pendant une autre
attente) ; un changement terminé pendant l’écriture elle-même n’est pas vu. Elle
vérifie aussi que la copie est toujours celle de sa pièce et que la correction
reprise n’a pas changé, puis compare la génération que l’écran a vue. Une
nouvelle attestation retire les attestations usées du même membre dans un ordre
fixe, en passant celles qu’une autre attestation est en train de retirer : deux
onglets ne s’attendent jamais l’un l’autre.
Elle ne modifie aucun objet existant ; créer un fichier de plan note en plus sa
source, sans jamais être refusé pour cela.

Un lancement depuis une version existante crée une copie ordinaire du devis,
sans la transformer en variante. Un reçu enregistré par le serveur relie cette
copie à sa source, à l'affaire et à la révision confirmée de la préparation.
La reprise retrouve l'analyse existante ou la copie déjà munie de son reçu et
conserve ses décisions. Un échec de création de l'analyse ou de sa mise en
traitement conserve tous les brouillons et analyses, afin de protéger toute
édition concurrente. Une interruption avant l'enregistrement du reçu ou des
lancements simultanés peuvent laisser un brouillon supplémentaire sans analyse.
Ce brouillon reste disponible pour examen ; il n'est pas supprimé automatiquement.

Les règles métier sont couvertes par
[`preparation.test.ts`](../../src/lib/takeoff/preparation.test.ts) : comptage sans
DPGF, calibration, unité, achat avec perte inconnue ou nulle, révision inconnue,
conflit de révision, réserves, destination, copie de l'instantané et réemploi des
profils. La validation de livraison doit compléter ces tests par les parcours
du navigateur et les contrôles SQL/RLS sur une base locale possédée ; aucun appel
IA simulé ne prouve un appel réel au forfait ou à Decisions.
