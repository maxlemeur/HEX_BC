# Préparer la livraison TI-576 à TI-583

## Périmètre et échecs observables, 9 octobre 2026

Travail sur main, sans indexation, commit, push ou déploiement autorisé à ce
stade. Le dépôt contient des changements concurrents ; leur attribution est
préparée séparément dans demo-eight-delivery-scope.md. Les migrations déjà
appliquées ne sont pas rejouées.

Le build normal reproduit l'arrêt du worker PostCSS Turbopack, code de sortie
zéro avant connexion, avec Node 24.19 et sans NODE_OPTIONS/NODE_BINARY. Le log
initial est conservé dans .codex-tmp/demo-eight-delivery-20261009/build-baseline.log.
Le bundler Webpack est pris en charge par la CLI Next installée et les builds
précédents passent. Une voie de build production explicite Webpack peut donc
fiabiliser le pipeline sans prétendre réparer le worker Turbopack. Les étapes
de validation OpenAPI et de budgets restent obligatoires.

Le manifeste Webpack capturé hNy contient des affectations compactes et des
chemins encodés ; le lecteur doit les lire et continuer à refuser les mesures
vides, corrompues ou incomplètes. Ce format et ce contrôle CI ne sont pas
observables par les E2E métier ; le chat tests prépare une régression du parseur
avant sa correction, puis confronte les résultats aux véritables chunks.

Le bundle review dépasse les plafonds : 1 461 205 octets bruts / 405 921 gzip,
limites 1 400 000 / 400 000. Les plafonds ne changent pas. La page importe le
composant entier TakeoffReviewTable seulement pour hasBlockingAnomaly ; la
règle de désignation vide/quantité non positive appartient aux guards métier.
Déplacer cette fonction inchangée dans guards puis importer la règle depuis
la page doit supprimer cette dépendance UI du graphe initial. Échecs à éviter :
calcul de blocage différent, désactivation perdue du bouton Appliquer, changement
du chemin expert ou dépendance toujours incluse. Les assertions existantes de
TakeoffReviewPage couvrent ces comportements ; la mesure des chunks compilés
et le garde de budgets fournissent l'oracle de chargement réel. Aucun nouveau
test isolé de cette fonction triviale n'est justifié.

Après les corrections : build complet, garde de budgets, lint des fichiers
modifiés, types, tests conservés pertinents et recette browser du lot sur le
candidat servi, avec nouvelles fixtures ARMY et preuves répétables. Le panneau
takeoff ne sera pas déclaré testé sur Supabase si son accès ou ses fixtures ne
sont pas disponibles ; aucun flag partagé ne sera activé pour obtenir une preuve.

## Décisions et preuves

Le déplacement de la petite règle ne réduit que cinq octets bruts et augmente
le gzip de 25 octets. Cette hypothèse n'atteint pas le budget ; ses trois hunks
app sont retirés et les fichiers retrouvent exactement leurs empreintes de
départ. Le build/rapport de cette expérience reste conservé.

L'entrée AffaireHub représente 372 903 octets dans le manifeste review. Son
parcours UnifiedImportFlow est importé statiquement alors qu'il est rendu
uniquement après l'action Importer la DPGF. Le chargement dynamique à ce même
point d'action doit retirer le parcours d'import de l'entrée initiale tout en
conservant props et callbacks. Échecs observables avant cette correction :
bundle toujours au-dessus du plafond ; import qui ne s'ouvre pas ; fichier,
mapping, confirmation ou navigation dégradés ; perte des lignes/valeurs/provenance.
Les scénarios ARMY CSV DPGF et opaque CSV DPGF exercent cette UI jusqu'au GET
persistant et seront rejoués après gel sur le serveur séparé 3107, avec trois
lignes nouvelles par fixture et aucune modification de flag ou de données
existantes. Ce sont les tests primaires de ce changement ; aucun nouveau test
isolé de forwarding de props n'est justifié.

Les captures précédentes sont préservées ; aucun échec antérieur n'est
reclassé comme une réussite. Les mesures compilées finales et les limites de
recette seront ajoutées ici.

La première séparation retire 51 300 octets bruts et 13 313 gzip : le gzip
respecte son plafond, mais il reste 9 905 octets bruts de dépassement. Le même
hub importe aussi LaunchMetreDialog, dont le wrapper retourne déjà null tant
que open est false. Charger ce module seulement à showLaunchMetreDialog
préserve donc le montage/démontage de son contenu et ses props. Risques à
vérifier : options de plans qui ne chargent pas à l'ouverture, annulation qui
ne ferme plus le dialogue, changement de permissions ou lancement inattendu.
Aucun job d'analyse ne sera créé pour cette optimisation. La recette humaine
inclut ouverture/annulation lorsqu'un projet avec plans est disponible ; cette
preuve restera distinguée du parcours DPGF exécuté et des tests conservés.

La séparation de LaunchMetreDialog déplace des chunks partagés mais augmente
la mesure review à 1 417 784 / 395 030. Elle est retirée ; le hub conserve
seulement l'import DPGF différé. La prochaine frontière est TakeoffApplyWizard,
importé directement dans la page review et monté même fermé. Le charger et
le monter à applyWizardOpen préserve les props et la confirmation existantes.
Échecs à éviter avant code : dialogue d'application introuvable après clic,
perte des blocages DPGF/confiance, options/réinitialisation cassées, réseau
d'application appelé sans confirmation, ou budget encore dépassé. Les tests
retenus de la page couvrent l'ouverture autorisée et les refus DPGF ; les
montants/écritures métier du wizard ne changent pas. L'ouverture d'un wizard
sur job distant non disponible reste une limite de recette à noter, sans
création d'un job modèle pour satisfaire ce contrôle.

Le premier `verify:production` compile mais échoue ensuite : le runner ajoute
`-- --webpack` à `npm run build`, donc l'argument atteint la commande npm de
budgets située à la fin du script composite. Le script build choisit désormais
explicitement Webpack ; le runner doit appeler ce script sans argument ajouté.
Échecs observables : garde de budgets non exécuté, serveur non démarré, probes
HTTP ou nettoyage non terminés. La recette production réelle est l'oracle ;
l'assertion existante de commande est mise à jour avant le raccord, sans ajouter
de test isolé de forwarding. Le rejeu initial isolé est bloqué avant toute
assertion par un EPERM du cache Vitest dans le sandbox ; ce n'est pas un rouge
comportemental. L'échec réel de raccord reste dans production-smoke.log.

`vercel.json` contient le même appel avec argument final redondant. Son seul
raccord est `buildCommand: npm run build` ; aucun déploiement ni paramètre
d'environnement n'est modifié. Cette commande reprend exactement la compilation,
OpenAPI et les budgets de la recette locale. Le contrôle réel du script build
sert aussi d'oracle à ce raccord de configuration, sans test de texte statique.

## Résultat du candidat du 9 octobre

Le candidat `FiIxxif8eGavkGaAtLxRW` est compilé par `npm run build` avec
l'environnement habituel puis servi par `npm run start` sur localhost:3000.
Le formulaire de connexion POST et l'asset propre à ce BUILD_ID répondent 200.
Les trente sources surveillées, le BUILD_ID et le HTML de connexion restent
identiques avant/après recette et après les captures complémentaires. Cette
clôture porte sur les sources surveillées, pas sur tout le checkout concurrent.

| Contrôle exécuté | Résultat | Preuve locale |
| --- | --- | --- |
| Build canonique, OpenAPI, types, cinq budgets | Passe, exit 0 | `build-connected-candidate.log` |
| Démarrage production avec auth stub local, probes HTTP, nettoyage | Passe, exit 0 ; environnement distinct de la recette connectée | `production-smoke-fixed.log` |
| Suite conservée après les derniers raccords | 434 fichiers / 2701 tests passent ; un fichier et deux tests ignorés | `tests-candidate-unsandboxed.log` |
| Lint des fichiers touchés, typecheck, diff check ciblé | Passent | `lint-candidate.log`, `typecheck-candidate.log`, `diff-check-candidate.log` |
| Dix parcours connectés du lot, candidat compilé 3000 | 10/10, 142,16 s, zéro ignoré/flaky ; 50 identités de fixtures conservées | `delivery-evidence-index.json`, run `2026-10-09-delivery-FiIxxif8-01a07773` |
| CSV DPGF métier et opaque via le Hub, runtime séparé 3107 | Connexion + deux cas : 3/3 ; sept autres exclus ; sources stables | Archive ARMY `2026-10-09T08-57-01-768Z`, `final-csv-verification.json` |
| Wizard métré à froid, accès serveur inchangé | Preuve positive absente : version lisible mais page « introuvable », aucun GET takeoff intercepté ni écriture | `wizard-access-check/business-manifest.json`, capture `review-probe-incomplete.png` |

Les fichiers de cette table sont sous `.codex-tmp/demo-eight-delivery-20261009/`
sauf les deux archives `.e2e` nommées. L'index conserve commande, révision sale,
empreintes, fixtures, résultats attendus/réels et preuves. Les tentatives
Vitest sandbox échouent sur EPERM avant les assertions ; seule la relance hors
sandbox est qualifiée. Aucun échec antérieur n'est effacé ou reclassé en réussite.

Le bundle takeoff-review final mesure **1 381 607 octets bruts / 385 547 gzip**,
contre 1 461 205 / 405 921 au départ : 79 598 / 20 374 octets retirés. Les limites
restent 1 400 000 / 400 000. Seuls UnifiedImportFlow et TakeoffApplyWizard sont
différés au point où leur UI est demandée ; LaunchMetreDialog et les guards ont
retrouvé leurs contributions antérieures. Le worker Turbopack n'est pas réparé.

Les deux CSV conservent trois lignes brutes/mappées/canoniques, les quantités
2,5 et zéro, les identités de provenance et les totaux 9625/1925/11550 centimes
après rechargement. Le scénario asserte V1 inchangée, mais son JSON conserve V1
avant et un booléen, pas V1 après pour comparaison indépendante. Ce run ne prouve
ni les imports PDF/XLS/XLSX, ni le worker, ni une campagne critique entière, ni
le parcours DPGF sur le runtime compilé 3000. Le serveur 3107 est arrêté.

La sonde du wizard ne modifie ni auth, ni feature flags, ni document/RSC. La
capture montre le refus serveur même avec un statut HTTP 200 streamé. Les GET
synthétiques n'ont pas été consommés ; focus/fermeture/reset à froid restent
à vérifier avec un accès déjà permis. Le rapport de revue distingue ce refus
de son origine précise ; aucun flag partagé ou job réel n'est créé pour le lever.

## Recette humaine et sélection préparée

Le dossier `recette-humaine.md` sous le répertoire local de livraison réunit les
six points à accepter et les captures stabilisées. La première capture remplie
conserve un GET avant/après identique. Les captures du détail de barème utilisent
un brouillon ARMY vide neuf ; elles n'ajoutent aucune ligne au catalogue ou au
barème. Les essais complémentaires bloqués par un bail encore détenu et par
un problème de transpilation du script de capture restent conservés séparément.

`delivery-oct09.patch` et `delivery-oct09-manifest.json` préparent les neuf sources
et dix-sept hunks de livraison (build/appelants, deux chargements différés,
lecteur/contrat de budgets, deux empreintes ajoutées au harness). Leur SHA256 est
`aee6049e26dbeb002e41718d5bda224d7a11abe3aeea5ff880b5989b850557d1`.
Les copies de départ observées et les reconstructions inversant uniquement les
raccords connus sont distinguées. Le patch suppose les prérequis présents dans
ces copies ; ce n'est pas un candidat HEAD seul validé ni une liste de fichiers
entiers à indexer.

Le découpage des huit tickets et de leurs prérequis est présenté dans
[demo-eight-delivery-scope.md](demo-eight-delivery-scope.md). La validation du
checkout actuel ne qualifie pas automatiquement une série de commits extraite.
L'attribution du prix de référence TI-537, des types MO antérieurs et des tests
mixtes doit être conservée explicitement dans la sélection finale. Aucun index,
commit, push, déploiement ou nouveau changement SQL distant n'est réalisé.
Les huit tickets Linear restent en revue et portent les résultats du 9 octobre.
