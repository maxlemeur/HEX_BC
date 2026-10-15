# Passage complet du runner à TesterArmy

La bascule demandée le 15 octobre 2026 porte sur les commandes, les workflows
et la couverture utile des anciennes suites. Le moteur navigateur interne de
TesterArmy utilise toujours Playwright ; cela ne constitue pas un second runner.

Défaillances définies avant les ports : totaux ou données perdus après édition,
duplication, import ou rechargement ; faux succès de reprise ; autorisation
contournée ; préférences personnelles qui modifient le devis ; contraste ou
débordement mobile ; focus perdu ; PDF absent après upload ; demande de métré
non persistée ; provenance perdue ; application de mesures non vérifiées ;
exclusion non respectée ; comparaison de révisions incorrecte. Les contrôles
restent déterministes et les fixtures sont nouvelles, identifiées et locales.

La CI métier doit construire l'application et exécuter Army contre sa propre
pile Supabase native éphémère. Aucun secret de production, migration distante,
envoi réel ou appel fournisseur n'est requis. Les limites de durée, erreurs de
setup et scénarios non exécutés restent des preuves manquantes, jamais des passes.

Référence rouge conservée : l'ancienne CI Playwright `38718513048` a terminé
avec 31 réussites et 6 échecs (création/duplication HTTP 500 sur backend partagé).
Le journal est dans `.codex-tmp/publication-debt-20261015/playwright-before-migration.log`.
La migration du runner n'efface pas ce résultat et ne qualifie pas ce backend.

## Correspondance des parcours

Les chemins de destination ci-dessous sont relatifs à `e2e/army/`. Les assertions
distinctives des spécialistes restent détaillées dans `extended/README.md`.

| Ancienne suite `e2e/estimates/*.spec.ts` | Remplacement Army |
| --- | --- |
| `full-lifecycle`, `duplicate` | `critical/estimate-integrity.e2e.ts` et profils locaux d'émission |
| `import-dpgf` | `critical/dpgf-import.e2e.ts` |
| `dashboard-ux` | `critical/dashboard-ux.e2e.ts`, UX01–29 |
| `plan-center`, `hub-launch-metre`, `team-a-hub-prod` | fichiers de même nom dans `critical/` (`team-a-hub`) |
| `hub-plans-card`, `hub-takeoff-auto-propose` | fichiers de même nom dans `critical/` |
| `column-preferences` | `extended/personal-columns.e2e.ts` |
| `autosave-navigation.local` | `extended/navigation-specialist.e2e.ts` |
| `catalogue-offer.local`, `catalogue-demo` | `extended/catalogue-specialist.e2e.ts`, `catalogue-ui.e2e.ts` |
| `demo-eight-catalogue.connected` | `extended/catalogue-connected.e2e.ts` |
| `demo-eight-parameters.connected` | `extended/settings-contracts.e2e.ts`, `settings-connected.e2e.ts` |
| `ui-polish.local` | `extended/ui-polish.e2e.ts` |
| `generated-ouvrages`, `generated-ouvrages-subdetail` | `takeoff/generated-review.e2e.ts`, GEN01 |
| `affaire-pilotage-panel`, `affaire-recovery-flow`, `cockpit-command-bar` | fichiers de même nom dans `takeoff/` |
| `import-flow-carry-over`, `takeoff-dpgf-review`, `team-b-user-stories` | fichiers de même nom dans `takeoff/` |
| `takeoff-guard`, `takeoff-epics-matrix` | `takeoff/contracts.e2e.ts`, TKF01–04 ; plans et lancement dans `critical/` |
| `team-a-hub-dev-scenarios` | `development/team-a-hub.e2e.ts`, phase développement séparée |

Les deux spécialistes `e2e/deslop` et `e2e/deslop-ui` correspondent à
`critical/deslop-components.e2e.ts` (DES01–05). Leurs composants React et leurs
réponses simulées restent les mêmes ; cette preuve ne vaut pas un accès SQL/RLS.
Les fixtures TypeScript/React/PDF/CSV existantes restent partagées.

Les scénarios GEN01 préparent les propositions avec le constructeur déjà utilisé
par les campagnes locales d'ouvrages composés. Rejet, revue humaine, validation,
insertion et provenance utilisent l'interface et le serveur réels. Cette campagne
ne qualifie pas la disponibilité ni la qualité d'un fournisseur de génération.

Les anciennes graines de métré terminé ne sont plus admissibles par un compte
utilisateur depuis la migration de protection des champs worker. Les nouvelles
graines vérifient d'abord par RLS le devis créé dans le parcours, son préfixe et son
tenant ARMY. Seule la préparation des états worker utilise ensuite une clé locale
gardée côté Node, sur HTTP loopback explicitement autorisé ; les actions et les
assertions de l'application conservent la session utilisateur. Aucun privilège
SQL, règle RLS ou endpoint de production n'est assoupli.

## Rejeux conservés pendant la migration

Le premier diagnostic en développement a révélé des compilations de page plus
longues que le délai d'une opération navigateur. Il reste archivé sous
`.codex-tmp/army-full-operational-interrupted/diagnostic.json` et ne compte pas
comme une campagne réussie.

Le candidat figé 2 (`78b7feae5081854c74b8934ef8a293e510fca1df`) a été construit
en production (`q-b_ND6PhrpFdNQIySnp4`). Le filtre `^(UX|PLAN|HUB|DES)` a exécuté
46 résultats, authentification incluse : 38 réussites et 8 échecs, sans skip.
Les 28 audits Axe/débordement sont verts. Les échecs exposent un libellé exact
incorrect dans le port, une attente de toast trop tardive, un ancien prérequis
worker interdit par RLS et un sélecteur de section obsolète commun à cinq cas.
L'archive conserve 132 artefacts avec leurs empreintes ; la source est restée
stable pendant le rejeu. Chemin :
`.codex-tmp/army-migration-20261015/candidate-2/.e2e/army/critical/runs/2026-10-15T17-47-21-041Z`.

La revue indépendante a trouvé une lacune de preuve : le garde serveur refusait
bien les workers, mais son journal restait hors de l'archive critique/CI. Le
journal doit être propre à l'exécution puis copié dans les artefacts métier avant
expurgation, empreintes et archivage. Le rejeu suivant doit conserver aussi les
événements `guard-installed` et les refus, sans reprendre un journal antérieur.

Le profil développement a exécuté les trois scénarios historiques et la connexion
sur le candidat 5 (`3b2bd4798f67d0b21a71a29b5eb68482387ca5c6`). Le premier run
conserve deux erreurs de compilation froide Next sous Windows (JSON tronqué,
manifeste client absent) et deux réussites. Un second run, sources inchangées,
termine à **4/4** sans skip, interruption ni appel modèle. Ce rejeu ne transforme
pas le premier run en succès. Archive verte :
`.codex-tmp/army-migration-20261015/candidate-5/.e2e/army/critical/runs/2026-10-15T18-15-37-197Z`
; SHA du manifeste `7a860d6f5f1e7a2848f3b11c2c46eb7eac3bc420984c89a27467974b927d403b`.
Les sept artefacts, le rapport et le manifeste sont vérifiés ; le journal serveur
fait partie des artefacts conservés.

## Régressions produit exposées avant correction

- TKF05 : un upload CSV réel avec clé d'idempotence retourne HTTP400
  `StorageApiError/AccessDenied`. Le serveur tente un upsert avant d'insérer le
  job, alors que les politiques SELECT/UPDATE exigent ce job et son chemin.
  Le correctif doit conserver une écriture immutable propre à chaque tentative,
  l'arbitrage de la clé du job, le refus d'un payload différent et le nettoyage
  du seul fichier perdant. Une course exacte entre stockage et INSERT demande
  aussi les régressions spécialisées existantes, définies avant la correction.
- TKF01/02 : l'application vérifiée retourne HTTP409 « autre page d'édition ».
  Le client takeoff omet l'en-tête de session transmis aux appels de verrou.
  Le contrôle serveur `bulkUpdateEstimateItems` lit déjà cet en-tête dans le
  contexte Next ; la route conserve ce contexte. Le correctif reste donc limité
  au client et à ses deux callers UI, qui réutilisent l'identité de la page après
  acquisition ordinaire. Une autre identité doit rester
  refusée sans modifier le devis ; le bail propriétaire doit permettre l'appliquer
  avec les quantités exactes et sans réintégrer les lignes exclues. Aucun forçage,
  assouplissement RLS ou migration distante n'est admis pour faire passer le test.
  TKF06, défini avant le correctif client, confirme réellement le wizard, puis
  relit deux quantités (12,5 et 3), l'exclusion et les lignes initiales après reload.
  Le contrat détaillé reste dans `takeoff-apply-session.md` ; les tests API seuls
  ne qualifient pas le transport du client.

Les deux campagnes complètes du candidat 4 conservent leurs résultats rouges :
77/120 sous Windows et 80/120 sous Linux, sans skip. La pile Linux a aussi
validé 1 250 assertions SQL et les deux cas RLS. Ces résultats servent à corriger
les ports et le produit ; ils ne constituent pas une qualification complète.

Corrections de prérequis et d'entrée dans l'interface avant le rejeu suivant :

- Une affaire vide affiche son parcours initial et masque le panneau de reprise.
  Les deux reprises partent désormais d'une ligne réellement chiffrée, dupliquée
  avant de préparer les états acquis/en attente/échec. Les compteurs, historiques
  et liens restent tous contrôlés.
- Le clic à la coordonnée (20,20) du port Ctrl+K ouvrait le logo et quittait
  l'affaire. Le raccourci s'exécute maintenant dans son contexte. Les actions
  intake et brief sont recherchées dans cette palette contextuelle ; leur strip
  est volontairement masqué quand un parcours dominant est déjà présenté.
- Une lecture du devis pendant l'autosave peut rencontrer le contrôle serveur
  de cohérence `409 VERSION_CONFLICT`. Le poll conserve ce résultat comme attente
  nommée et l'archive ; tout autre échec reste immédiatement bloquant. La lecture
  finale et les valeurs financières exactes restent obligatoires.
- Le PDF tabulaire atteint une erreur de compilation production
  `createRequire is not defined` avant extraction. Le rejeu US-2.2 doit conserver
  un véritable PDF et vérifier la revue extraite ; un mock du résolveur ne couvre
  pas le défaut du bundle. Le worker terminable et ses budgets restent requis.

Le candidat 6 Windows a rejoué 45 résultats ciblés : 24 réussites, 21 échecs,
sans skip. TKF05 atteint désormais le stockage réel et passe. Les TKF applicatifs
atteignent ensuite le RPC et exposent `21000 UPDATE requires a WHERE clause` ;
aucune garde de base ne doit être désactivée pour contourner cet échec. Les
préconditions GEN rencontrent le trigger protégeant les sous-détails : une clé
service ne remplace pas la préparation locale par le propriétaire de la base.

Le port du carry-over conserve ses trois compteurs et liens, puis suit désormais
la confirmation affichée « Devis créé » → « Continuer » → plans optionnels ;
l'ancien banner « Import terminé » n'existe plus. Ctrl+K attend l'interactivité
du hub via ouverture/fermeture du menu Plus avant d'envoyer le raccourci. Le refus
d'authentification hydraté garde également un cas explicite : erreur visible,
une seule requête synthétique interceptée, aucun submit natif ni secret en URL.

Le spécialiste visuel optionnel de `e2e/polish` est porté séparément dans
`army/polish`, en conservant le catalogue de routes et les quatre largeurs. Ses
limites de captures et de sélection restent dans `tester-army-polish.md` ; les
parcours obligatoires ne qualifient pas implicitement toutes ces routes.

AUTH01 exerce désormais le véritable écran de connexion avec une réponse Auth
synthétique refusée : erreur française, un POST Auth, zéro submit natif, URL sans
paramètre et formulaire réutilisable. Le SDK refuse la lecture des attributs du
champ sécurisé même vide ; le parcours conserve donc les contrôles de visibilité,
activation et du bouton de masquage, sans contourner cette protection. L'ancien
test de helper vérifiait `type=password` sur son propre HTML synthétique ; cette
assertion ne constituait pas une preuve sur le formulaire produit.

Le candidat Linux 9 (`6b315285c401140723c6c2f563ab5bde8d21aead`) exécute
les 122 résultats de production : 115 réussites, 7 échecs, aucun skip, retry ou
interruption. Les 1 253 assertions SQL, les deux cas RLS et les quatre résultats
de développement passent. Tous les TKF, les cinq cas de revue DPGF et le vrai
PDF US22 passent. Les préparations SQL GEN et leurs relectures RLS passent ;
l'interface manque ensuite le clic sur le ruban encore en chargement. Les autres
échecs sont AUTH01, le choix du chantier des achats, le menu fournisseurs US44
et l'association version/statut US62. L'archive complète reste rouge et conservée
dans `.codex-tmp/army-ci-migration-20261015/candidate-9-evidence/` ; son contrôle
des empreintes et de confidentialité est dans `candidate-9-proof.json`.

Le candidat Windows 11 (`37141f4c1d8e8c88b881532a2c6e13285ec3a5fb`)
qualifie séparément AUTH01 et les deux parcours achats : **4/4**, connexion
incluse. Le profil visuel sélectionné passe **6/6**, connexion incluse, pour
login, signup, profile, orders-new et portal-invalid sur les quatre largeurs
320/390/768/1440. Aucun autre écran du catalogue visuel n'est implicitement
qualifié. Les empreintes des archives sont respectivement
`cb6f06c96bc3e027af1998594121032d9f16a0b297e073c9883ceca36d17f9cb`
et `6a37eca7a31779a8bff7a834d4df3c64cd58ed335110fd0dcc47feb56384b894` ;
les sources et le build sont restés inchangés.

## Retrait de l'ancien runner

Le candidat 12 (`9eb58c553a886202f7da7e661618189373ca1fca`) retire l'ancien
runner dans sa projection de validation. Lint, typage, architecture, build,
recettes Army, couverture critique et 3 047 régressions passent. Les trois tests
ignorés sous Windows sont couverts séparément par les deux cas RLS natifs et
le garde Bash Linux (8/8). Le profil visuel sélectionné passe 6/6, soit cinq
routes aux quatre largeurs, sans changement de source ni de build.

La campagne native complète reste rouge : 119/122, aucun skip, retry réussi ou
interruption ; les quatre résultats de développement passent ensuite. Le rejet
GEN et US62 passent désormais. Les cas GEN fallback/provenance et US44 atteignent
de nouvelles assertions après la correction de navigation, puis échouent. Ils
doivent encore qualifier la revue humaine, l'insertion et la provenance, ainsi
que les choix explicites fournisseurs/chantier et leurs commandes persistées.
Les 50 fichiers du checkout principal restent présents tant que cette preuve
de remplacement n'est pas verte ; le retrait du candidat n'est pas un succès.

Le candidat 13 (`d62d7b0c6c28365ca1b4982a371c853aa14d6990`) lance d'abord
un profil ciblé : connexion, GEN rejet/fallback/provenance et US44, cinq résultats
attendus. Il termine à 3/5, sans skip ; le rejet et l'insertion « À classer »
passent. L'oracle de provenance utilise à tort les clés snake_case au lieu du
contrat `GeneratedOuvrageSubdetailSummary`. US44 atteint désormais la livraison
et révèle des labels HTML imbriqués dans le panneau de commandes. La suite
complète et le développement ne sont pas exécutés après ce focus rouge.
Les preuves expurgées, empreintes et nettoyage confirmé restent dans
`.codex-tmp/army-ci-migration-20261015/candidate-13-evidence/` et
`candidate-13-proof.json`. Les attentes financières restent inchangées ; le
contrôle de date doit conserver son nom accessible et sa valeur persistée.

Le candidat 14 (`30cdaec95f020ced04f3c77b980127c398f608b3`) termine le
profil ciblé à 4/5 : les trois parcours GEN passent, dont la provenance après
rechargement sur desktop et mobile. US44 crée sa commande et vérifie sous RLS
la date et le chantier persistés, puis le garde réseau du test refuse la lecture
du nouvel éditeur de commande. La campagne complète et le développement ne
sont pas exécutés. Les preuves restent dans
`.codex-tmp/army-ci-migration-20261015/candidate-14-evidence/` et
`candidate-14-proof.json`. Le correctif suivant doit autoriser uniquement les
lectures exactes de cette commande ARMY vérifiée et les listes nécessaires à
son affichage, avec des régressions de refus des identités et requêtes étrangères.

Le candidat de validation final retire les 50 fichiers inventoriés de l'ancien
runner (parcours, configurations et scanners devenus sans consommateurs), les
commandes `e2e:pw:*`, `@playwright/test` et `@axe-core/playwright`. Les fichiers
du checkout principal sont conservés jusqu'au passage des assertions de
remplacement sur ce candidat. Leurs empreintes sont vérifiées avant retrait.
`e2e/polish/routes.ts` et les fixtures React/PDF/CSV partagées restent utilisés.
`playwright` reste une dépendance du collecteur de prix Sofinther ; le moteur
interne d'Army conserve son propre `playwright-core`. Aucun des deux ne fournit
une seconde suite E2E. Les anciennes archives rouges restent conservées.

## Publication et campagnes GitHub du 15 octobre

Le candidat 15 (`90f9bde2aaa78da9a0f4c833c0fd240ccea90ebc`) passe le focus
5/5, le full 122/122 et le développement 4/4 sur la pile native locale, sans
skip/flaky/interruption ni divergence source/build. Les empreintes et la
confidentialité passent ; la pile possédée est absente après nettoyage. Les
50 fichiers de l'ancien runner sont alors retirés et le commit `a25b5c40`
est publié sur `main`, avec cet arbre exact. Les autres travaux locaux et les
trois suppressions initialement préparées sont préservés.

Quality Gate `38805537928`, smoke Army `38805537987` et Vercel passent sur ce
commit. Les deux campagnes métier GitHub restent rouges, et distinctes du local :

- Critical `38805538063` : 63/64, aucun skip/retry. Le rechargement du parcours de
  création expire ; les montants avant reload sont exacts, ceux après reload
  ne sont pas exécutés. SQL/RLS/build/source/privacy et empreintes passent.
- Full `38805560023` : 121/122 puis développement 4/4, aucun skip/retry. DPGF03
  refuse le sélecteur de fichier ambigu, qui résout deux éléments alors que la
  capture montre une seule zone visible. La création/relecture passe dans ce run.
  SQL/RLS/build/source/privacy et empreintes passent.

Les preuves expurgées sont conservées sous
`.codex-tmp/army-ci-migration-20261015/published-critical-evidence/` et
`github-full-38805560023/`. Ces résultats ne sont pas remplacés par le succès
local. La suite exige des préconditions UI explicites avant navigation et un
contrôle de fichier visible unique, avec les mêmes oracles financiers et
l'import catalogue à deux lignes. Aucun délai ou retry supplémentaire n'est
un correctif. La cause exacte du blocage de rechargement reste non établie ;
voir `army-reload-readiness.md`.
