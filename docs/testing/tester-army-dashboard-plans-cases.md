# Portage dashboard, plans et hub vers TesterArmy

Défaillances et oracles définis le 15 octobre 2026 avant écriture des scénarios.
Les six anciens fichiers Playwright restent présents jusqu'à preuve exécutée
équivalente, décision prise par l'orchestrateur de la migration.

| Source historique | Cas Army | Défaillance qui doit faire échouer |
| --- | --- | --- |
| `dashboard-ux.spec.ts` | UX01–UX28 | Une des sept routes perd son titre/main, déborde horizontalement de plus d'un pixel ou comporte une violation Axe serious/critical sur l'une des quatre tailles historiques. |
| `dashboard-ux.spec.ts` | UX29 | Le menu mobile ne rend pas le contenu inerte/modal ou ne restitue pas le focus après Échap. |
| `plan-center.spec.ts` | PLAN01 | Le jeu neuf manque au fil d'Ariane/à la liste, le vrai PDF n'est pas conservé après relecture, ou la suppression du fichier/jeu ne rétablit pas l'état vide. |
| `hub-launch-metre.spec.ts` | HUB01 | Le hub perd le plan conservé/la version cible, ne persiste pas exactement une demande Standard pour ce PDF, ou dirige vers un mauvais centre d'activité. |
| `team-a-hub-prod.spec.ts` | HUB02 | L'affaire vide impose un DPGF ou ne permet plus l'ouverture du devis en mode manuel. |
| `hub-plans-card.spec.ts` | HUB03–HUB05 | Le hub affiche des plans inexistants, perd l'identité du jeu/de la cible, ou ouvre les exceptions du report sur la mauvaise version. |
| `hub-takeoff-auto-propose.spec.ts` | HUB06–HUB10 | Le report temporaire/permanent masque aussi l'action manuelle, la demande n'est pas conservée, la provenance dossier disparaît ou le choix d'une version source devient impossible. |

Les tailles exactes sont 320×568, 390×844, 768×1024 et 1440×900,
appliquées avec `browser.setViewport`. Axe s'exécute dans le document via
`browser.evaluate`, après la fin des animations finies ; aucune règle Axe ni
couleur n'est neutralisée. Le parcours de focus utilise le vrai clavier.

PLAN01/HUB01 exigent Supabase local explicitement autorisé, le module de métré
actif et le compte ARMY existant. La garde réseau centrale n'autorise les PUT
signés que pour les jeux nouvellement créés dans une affaire de ce test.
Les demandes créées par HUB01/HUB08 sont réelles et limitées à la nouvelle
version ; leur annulation est vérifiée en `finally`. Ces deux cas exigent
`E2E_ARMY_BLOCK_WORKERS=1` : la garde serveur bloque `/functions/v1/` avant
remise à Edge, ainsi que les fournisseurs externes. Ces cas prouvent le dépôt
et la demande, pas l'extraction IA. Le report d'exceptions HUB05 reprend le
résultat terminé synthétique de la fixture historique. Cet état worker est
préparé par `localTakeoffWorkerClient` côté Node uniquement : origine HTTP locale
explicitement autorisée, nouvelle version enregistrée dans le test, projet
préfixé par l'identité du test et tenant ARMY vérifiés avec le compte ordinaire
avant accès au client local privilégié. Les actions et lectures assertées
restent celles de l'utilisateur authentifié. Aucune politique RLS n'est changée.

Les traces authentifiées restent désactivées. Les identités des affaires,
versions, jeux/fichiers et jobs ainsi que les mesures/violations sont conservées
avec `recordEvidence`. Aucune URL signée, session ou clé n'est jointe. Les
réponses API relues fournissent les oracles de persistance, et aucun prérequis
manquant n'est transformé en skip.

Résultat d'exécution à renseigner par la campagne coordonnée ; découverte ou
typecheck ne constituent pas la preuve de ces parcours.

## Écarts explicites par rapport aux anciens scripts

Les libellés sont ceux du code courant : « Me rappeler plus tard », « Ne pas
proposer pour cette affaire », « Analyser maintenant », « Jeu de plans à
analyser » et « Détaillé ». L'ancien test de report temporaire attendait un
retour au rechargement. Le hook `useTakeoffAutoProposeDismissed` conserve
désormais un report de 24 heures dans localStorage, par affaire, profil,
contexte et jeu/version. HUB06 vérifie donc la persistance après rechargement
et borne exactement son échéance entre les instants entourant le clic plus
24 heures. Il ne prétend pas avoir attendu l'expiration. Cette divergence
historique est documentée ; le produit n'est pas changé pour l'annuler.

Les anciens seeds de plans créaient uniquement des lignes de métadonnées avec
un chemin de fichier fictif. Les nouveaux cas utilisent le vrai dépôt du PDF
de fixture via le centre de plans. Les cas de provenance appliquent ensuite
les mêmes marqueurs synthétiques `affaire-intake` aux seuls objets créés par
le scénario, via RLS. Cela reste une fixture d'interface et non une preuve de
classification automatique du dossier.

La première vérification statique ne relève aucune erreur TypeScript dans ces
ports ; les erreurs restantes à cet instant concernent les autres ports en
cours. ESLint ciblé passe. Les quarante scénarios restent à exécuter.

## Spécialistes deslop conservés

Avant port, les cinq défaillances historiques sont conservées : perte du nom
client canonique ou du filtre/rétablissement ; devise mal normalisée ou repli EUR
absent ; sauvegarde d'une ligne vide ou perte de quantité/coût exact ; décision
acceptée/rejetée non transmise à l'application ; acceptation globale oubliant la
ligne exclue ou supprimant le marquage à revoir. Les mêmes fixtures React restent
utilisées via `mountComponentFixture`, sans second serveur ni transport réel.
Les appels simulés, identités et erreurs navigateur sont archivés. Cette frontière
spécialiste ne prouve ni SSR/routage Next, ni autorisation, ni persistance SQL.
Les anciens fichiers restent présents avant exécution des cas DES01–DES05.

## Première exécution de production et corrections du port

Candidate 2, arbre `78b7feae5081854c74b8934ef8a293e510fca1df`, build
`q-b_ND6PhrpFdNQIySnp4`, run `01a140ac-ff4e-7fba-b058-4f1b3e2267b2` :
46 tests exécutés (45 cas et connexion), 38 réussites, 8 échecs, aucun skip
sélectionné. Les 28 audits Axe/débordement, PLAN01, HUB01–04 et DES01–04 passent.
Les sources sont restées stables et les 132 artefacts ont été rehashés sans
écart. L'archive est conservée dans la copie candidate 2 sous
`.e2e/army/critical/runs/2026-10-15T17-47-21-041Z`.

Les corrections préparées dans le dépôt principal, sans modifier cette preuve :

- UX29 : le port avait ajouté une égalité exacte à l'ancien nom partiel. Le nom
  accessible réel est « Ouvrir le menu principal » ; les assertions inert/modal
  et restitution du focus restent les mêmes.
- DES05 : le toast « 2 items acceptés » est désormais vérifié immédiatement
  après le clic, avant les autres assertions inchangées. Son expiration pendant
  les étapes suivantes du SDK ne constitue pas une perte de la décision.
- HUB05 : le refus 42501 protège correctement les états worker. La préparation
  synthétique passe par le helper local gardé décrit ci-dessus. Les deux ports
  DPGF-review/carry-over réutilisent cette même frontière pour leurs prérequis.
- HUB06–10 : le hub courant masque volontairement son panneau latéral pour une
  affaire vide. Une ligne créée par l'API prépare désormais la base de travail,
  comme HUB01 ; les assertions de plan, provenance et version sont conservées.
  Après lancement, HUB08 vérifie le CTA courant « Suivre l'analyse », le statut
  en attente et leur persistance au reload. Le CTA manuel reste vérifié avant
  lancement et après les masquages HUB06/07 ; le contrat actuel interdit une
  nouvelle analyse tant qu'un job existe.

Ces corrections de port restent à rejouer ; le rouge initial est conservé.

Candidate 4 confirme ensuite un second prérequis périmé commun à HUB06–10 :
le panneau des plans et la proposition sont visibles, mais l'assertion du
bouton manuel dans ce panneau échoue avant toute interaction du cas. Le hub
masque explicitement cette copie du CTA lorsque `analyze_plans` domine
(`shouldHideAffaireHubTakeoffLaunchAction`). L'action manuelle reste disponible
dans « Plus » → « Analyser les plans », parcours déjà exécuté par HUB01.
Le port conserve donc la disponibilité manuelle avant et après les masquages
et le rechargement en ouvrant ce menu, en vérifiant son action, puis en le
refermant par Échap. Les cas de provenance et de version ouvrent le même
dialogue par cette action. Aucune règle du produit n'est modifiée.
Le retour de lancement HUB08 conserve son texte exact, vérifié immédiatement
dans le composant toast réel : son ancien rôle `status` ne correspond pas au
toast Base UI courant, écart également exposé par DES05 dans candidate 4.

## Candidate 6 : report de 24 heures et statut du lancement

Plan de correction écrit avant modification du produit. Le run Windows
`01a140de-6013-7002-9f7b-4feff4ca8b43` reproduit deux défaillances distinctes :

- HUB06 écrit un report avec une expiration de 24 heures et le bon jeu/version,
  puis la proposition réapparaît au rechargement. `AffaireHub` appelle
  `clearTemporaryDismissal` dans un effet exécuté à chaque montage : le report
  persistant est supprimé. Le hook sait déjà invalider un report expiré ou
  appartenant à un autre jeu/version/mise à jour des plans. La correction prévue
  retire ce reset de montage et conserve cette portée, le masquage permanent
  et l'action manuelle. La recette existante garde toutes ses assertions et
  vérifie aussi que le même payload de report subsiste après rechargement.
- HUB08 affiche le lien de suivi et le badge « En file », libellé canonique de
  l'état visible `queued`. Le port exigeait encore « Analyse en attente » ou
  « Analyse en cours ». L'oracle utilisera « En file » exactement, avant et
  après rechargement ; le job API `pending`, son niveau B, son fichier, le toast,
  le lien de suivi et l'annulation finale restent vérifiés.

Les écrans d'échec sont conservés dans le candidat 6 sous
`.e2e/army/critical/results/hub-takeoff-auto-propose-hub06-a-temporary-prompt-1d2c5bc7ddd7e4b8/attempt-1/screen-at-failure.txt`
et
`.e2e/army/critical/results/hub-takeoff-auto-propose-hub08-launching-from-the-prompt-adf6d5660e90fff8/attempt-1/screen-at-failure.txt`.
Les sources avant correction sont copiées dans
`.codex-tmp/army-migration-20261015/hub-snooze-before/`.

Aucun nouveau test isolé : HUB06 reproduit directement le défaut au vrai
rechargement de la page. Les tests existants du hook couvrent séparément
l'expiration et la portée. Le replay de HUB06–10 est nécessaire avant de
conclure ; les réussites de HUB07/09/10 sur candidate 6 ne qualifient pas la
correction à venir.

## Candidate 6 : sorties et achats du panneau de pilotage

Les trois échecs US-5.1/5.2/5.3 du même run sont des contrats de port périmés,
distingués du défaut de report ci-dessus. Les écrans restent dans les dossiers
`affaire-pilotage-panel-us-1-3-pilotage-affaire-centre-29e5d3d207333b57`
(finish line), `affaire-pilotage-panel-us-1-3-pilotage-affaire-centre-b975d467703a3f61`
(sorties) et `affaire-pilotage-panel-us-1-3-pilotage-affaire-centre-2e62589d07aab9d6`
(fixture commandes) sous les résultats du candidat 6.

- Le panneau distingue « Prêt à envoyer » et « Préparation des achats ». Les
  deux blocages PDF/prix manquant sont visibles, avec exactement zéro ligne
  préparable, zéro transférée et une ligne à corriger. Le port conserve ces
  contrôles et suit les destinations actuelles : reprise du devis, blocages
  achats dans `#finish-line-orders` et fournisseurs dans `/prices`.
- Une version brouillon affiche volontairement « Préparer le PDF », même
  lorsqu'un PDF a déjà été produit ; « Télécharger le PDF » correspond aux
  versions figées. La recette conserve le prérequis PDF réellement prêt, les
  trois actions de sortie dans le même panneau, l'ouverture du formulaire
  d'email, son objet exact et son annulation sans envoi.
- `products.tax_rate_bp` a été supprimé par la migration
  `20260819230500_drop_product_tax_rate.sql`. La fixture cesse d'écrire cette
  colonne ; la TVA de la ligne de devis reste à 2 000 points de base. La
  création d'un brouillon fournisseur conserve la ligne sans offre visible
  et suit la confirmation humaine actuelle : sélection du chantier, relecture
  explicite des lignes/montants/livraison, puis création. Aucun verrou ni
  garde métier n'est contourné.

Le fichier avant adaptation est conservé dans
`.codex-tmp/army-migration-20261015/pilotage-candidate6-before/`.
Aucune modification produit n'est requise pour ces trois ports. Leur prochain
replay doit confirmer les assertions et la création réelle du brouillon.

## Candidates 6 et 7 : PDF, Team B, prix et prérequis achats

Plan écrit avant ces corrections ; sources préservées dans
`.codex-tmp/army-migration-20261015/team-b-dpgf-pdf-candidate6-before/`.

- US22 n'atteint pas la revue PDF sur candidate 6 : la route répond HTTP 500,
  et le journal serveur indique que `(a ?? (intermediate value).createRequire)`
  n'est pas une fonction. Le bundle transforme aussi l'import dynamique de
  `node:module`. Node 24 fournit directement `process.getBuiltinModule` ; la
  résolution utilisera cette API native, conservant le chemin filesystem,
  le worker terminable, son transfert de données et tous ses budgets.
  L'oracle « Validation renforcée », l'approbation explicite et l'arrivée dans
  le mapping restent inchangés. Aucun test isolé supplémentaire : le vrai
  build de production est la frontière qui a échoué, et US22 doit être rejoué.
- US44 écrit encore la colonne produit supprimée `tax_rate_bp`. Seule cette
  écriture disparaît ; la TVA de la ligne est conservée. Après la présélection
  et sa vérification API, la création passe par le panneau achats actuel :
  chantier, date, confirmation humaine, puis réponse HTTP et identités des
  lignes réellement transférées. La présence du bon fournisseur et de la
  désignation dans l'éditeur de commande reste vérifiée.
- Sur Linux candidate 6, US21/US22 s'arrêtent plus tôt : le sélecteur DOM brut
  de l'input trouve deux nœuds, mais l'écran n'expose qu'un contrôle d'import.
  Les deux recettes sélectionneront le contrôle affiché par son libellé exact
  « Fichier DPGF à importer » et en vérifieront l'unicité avant le vrai upload.
  Aucun `first()` ne choisira arbitrairement entre deux contrôles affichés.
- US62 affiche « Reprise en attente » et conserve les deux versions dans
  l'historique. Le port vérifie la V2 en attente, la V1 terminée et les trois
  compteurs, au lieu d'exiger l'ancien titre « Statuts précédents conserves ».
- La suggestion de prix expose désormais le montant dans le nom accessible du
  bouton « Prix cible 29,50 € ». Le port conserve toutes les assertions de
  sources, note obligatoire, choix humain, montant exact et persistance.
- Candidate 7 confirme que le lien interne de blocages a l'attribut brut
  `#finish-line-orders`. Son autre échec achats n'est pas un titre périmé : la
  fixture compare une ligne `ml` avec un tarif fournisseur `u` et le produit
  refuse justement cette différence. Le tarif préparé utilisera `ml` ; les
  contrôles « Brouillons proposés », création et ligne sans prix restent.

Les captures sources sont celles de US22 (`5211b2ecdc244c45`), US62
(`6c0cc0563fe95a46`), suggestion (`5f166bb93f3af6b4`) du candidat 6 et achats
(`2e62589d07aab9d6`) du run archivé candidate 7
`2026-10-15T18-55-17-814Z`. Aucun de ces changements ne vaut preuve de replay.

## Candidate 9 : validité des offres et contraste des commandes

Défaillances et corrections définies avant modification ; snapshot dans
`.codex-tmp/army-migration-20261015/orders-contrast-pilotage-candidate9-before/`.

Le run pilotage `01a140f6-7a07-776a-8e48-91716a22641b`, archivé à
`2026-10-15T19-07-36-752Z`, affiche désormais « Offre expirée » pour Tube cuivre.
L'unité est cohérente, mais la fixture utilise encore le 1er mars 2026. Le
contrat `20260906110121_supplier_price_validity_six_months.sql` borne l'offre à
six mois : elle a expiré au 1er septembre. Les nouvelles offres de pilotage et
US44 utiliseront la date du run, comme celles du catalogue Army. Les refus
produit, « Brouillons proposés », confirmation et résultats restent inchangés.

Le profil polish candidate 9, archivé à `2026-10-15T19-08-03-912Z`, a exécuté
les quatre viewports de `/dashboard/orders/new`. Axe détecte deux violations
`color-contrast` serious à 768 px sur les boutons « Ajouter un fournisseur »
et « Ajouter un chantier » de `PurchaseOrderDocument`. Le JSON de résultats
est conservé dans `artifacts/business/ARMY-1792091297835-607975e7-polish-orders-new-polish-results.json`.
Ces deux actions utilisent `text-brand-orange`. Elles adopteront le token
interactif `text-primary`, qui s'adapte au thème, en conservant taille, poids,
soulignement, états désactivés et actions. Aucun autre élément du document ni
exclusion Axe ne change. Aucun test isolé supplémentaire : la recette Axe
réelle reproduit déjà le défaut et devra repasser sur les quatre viewports.

## Candidate 9 Linux : navigation de présélection et historique des reprises

Plan écrit avant les deux corrections de ports. US44 s'arrête sur « Outils »,
absent du ruban actuel. La présélection existe dans « Affichage & contrôle »,
menu « Afficher », sous le libellé « Présélectionner les fournisseurs (N) ».
La recette ouvrira cette navigation visible, puis gardera toutes les assertions
de propositions, exceptions, choix humain, transfert et commande finale.

US62 affiche déjà les deux entrées V2/en attente et V1/terminée sur sa capture.
Le port confondait le texte de lecture du snapshot avec le nom accessible du
`listitem`. Il vérifiera la version et le statut comme enfants de la même
entrée, avec exactement une entrée par version. Les trois compteurs et le
titre de reprise restent inchangés. Aucun changement produit ni isolation.

## Candidate 12 : prérequis expert pour US44

Plan écrit avant correction. Le ruban et le menu « Afficher » s'ouvrent, mais
le compte CI est en mode Simplifié : la commande de présélection fournisseurs
est réservée au mode Expert. Le parcours doit activer ce mode par le vrai
commutateur du menu de navigation, puis vérifier sa persistance dans le profil
par lecture RLS. Il conservera le mode initial et le restaurera par le même
contrôle dans un `finally`, avec relecture persistée et preuve de restauration.
Un profil déjà Expert ne sera pas modifié. Aucun appel direct de modification
du profil, injection de stockage ou assouplissement du garde produit.

Toutes les assertions de présélection, propositions, exceptions, sélection
humaine, transfert exact de la ligne et fournisseur/désignation de la commande
restent requises. La preuve rouge est la capture US44 de
`candidate-12-evidence/full` (`d90d5e77e8b66488`) ; le snapshot avant correction
est `gen-teamb-candidate12-before`. Le replay E2E reste requis.

Le bouton de navigation est masqué au-dessus de 960 px. La bascule utilise
donc `browser.setViewport` à 900 px pour ouvrir le vrai tiroir et restaure
ensuite la taille initiale ; aucune visibilité DOM n'est forcée. Le parcours
achats conserve son viewport initial. Le contrôle du profil après chaque
bascule distingue sa mise à jour optimiste de la persistance serveur.

## Candidate 13 : libellés de livraison valides

Plan écrit avant correction produit. US44 atteint la présélection, sa
vérification API et le choix du chantier, puis le contrôle nommé exactement
« À déterminer » est introuvable. Le panneau imbrique le label de cette case
dans un autre label « Livraison cible » : ce balisage HTML invalide contribue
au nom accessible de la case et ne nomme pas explicitement la date. La
restauration du mode Simplifié est néanmoins confirmée dans la preuve RLS.

Le conteneur externe deviendra un `div`, et la date sera nommée explicitement
par `aria-label="Livraison cible"`, identique au titre visible. La case gardera son propre
label exact « À déterminer ». Aucun texte, style, valeur, événement ou garde
de confirmation humaine ne change. US44 conservera son sélecteur exact,
vérifiera la case décochée et la date saisie, puis relira date et chantier de
la commande créée via RLS. Le scénario Army rouge existe avant cette
correction ; aucun test isolé ajouté. Snapshot :
`gen-us44-candidate13-before`, preuve : `candidate-13-evidence/focus`.

## Candidate 14 : lectures de la commande créée

Plan écrit avant modification du garde. GEN01 est vert dans les trois modes.
US44 crée réellement le brouillon et relit sa date/son chantier via RLS, puis
échoue dans l'éditeur de commande : le garde navigateur refuse le GET
`purchase_orders` et le lookup `suppliers`. L'interface finale reste à exercer ;
la remplacer par la lecture API déjà réussie ne fournirait pas cette preuve.

La recette enregistrera uniquement l'ID renvoyé par sa création, après lecture
RLS du propriétaire, tenant et version source. La version/projet devront
appartenir au registre du run, au projet préfixé par celui-ci et au tenant
ARMY local vérifié. Le garde commun restera l'unique autorité de continuation.
Il autorisera ces seules projections/filtres, sans paramètre supplémentaire ou
dupliqué : GET de cette commande avec ses lignes, GET de sa révision, HEAD de
ses lignes pour le contrôle anti-troncature. Les deux listes actives fournisseur
et chantier conserveront exactement leurs colonnes, filtre et tri existants,
uniquement après cette vérification. Elles sont lues sous RLS par l'interface.
Aucune table arbitraire, mutation REST, origine distante ou commande étrangère.

L'isolation du parseur est justifiée : un parcours UI normal ne construit pas
de filtre `or`, paramètre dupliqué, projection additionnelle ou ID étranger ;
une requête volontairement bloquée interrompt la campagne navigateur entière.
Les régressions seront écrites avant le helper et vérifieront ces refus,
l'absence de registre et les méthodes d'écriture, ainsi que les lectures
exactes nécessaires. Elles complètent le replay UI US44, sans le remplacer.
Les identités de commande admises seront conservées dans la preuve du run.

Preuve rouge : `candidate-14-evidence/focus`. Snapshot préalable :
`.codex-tmp/army-migration-20261015/purchase-read-guard-candidate14-before/`.

Avant intégration, la revue du garde révèle que l'ancienne exception du hub
autorisait tout GET `delivery_sites`. Elle sera limitée au contrat exact du
panneau existant (même liste de champs avec `updated_at`, actif, tri par nom),
avec sa régression préalable. Elle ne pourra ainsi pas court-circuiter les
refus de paramètres ou colonnes ajoutés de l'éditeur de commande. Les profils
historiques performance/coverage gardent leur règle distincte, hors full.

Les rapports isolés sont conservés dans le snapshot : `red.json` décrit les
cinq admissions refusées par le squelette initial fermé, `red-hub.json` la
lecture légitime du hub encore refusée, puis `green.json` les 17 contrôles
réussis. Ces rouges de contrat ne sont pas présentés comme des vulnérabilités
produit ; l'échec UI réel reste le focus 14. Lint ciblé et typage passent.
Le replay US44 doit encore valider l'écran final avec les lectures réelles.
