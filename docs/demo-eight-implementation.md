# Démonstration — réalisation TI-576 à TI-583

État au 7 octobre : catalogue, sélection fournisseur, navigation sans Ctrl+S et
défilement disposent de recettes connectées positives, sur les candidats
identifiés plus bas. La migration MO est appliquée après accord humain. La
recette finale de paramètres/colonnes passe ses six scénarios sur le candidat
compilé `hNyhZ87A5BGcW7eH8H2KM`, tout comme le cas fournisseur renforcé.
Le correctif AID est appliqué après accord humain et sa recette HTTP/menu,
navigation sans Ctrl+S et réouverture passe sur ce candidat.
Le rejeu final de duplication passe séparément sur sources stables.
Les résultats historiques et les preuves partielles ne sont pas une campagne
globale entièrement passée. Aucun commit, push ou déploiement de code.

Travail local sur `main`, le 2 octobre 2026. Révision de départ :
`b3b319493304530a6f19533bd1e592cd5ef53fbe`. Le dépôt contenait déjà des
modifications et fichiers non suivis. Le snapshot initial et les preuves de ce
lot se trouvent dans `.codex-tmp/demo-eight-20261002-01a07773/`.

## Coordination et périmètre

Trois tâches séparées ont travaillé sur des fichiers réservés, puis l’orchestrateur
a raccordé les parties communes et demandé une revue indépendante :

- `01a0fd53-6730-76a1-9af4-932fc1363eb7` : marges et veille IA, puis revue.
- `01a0fd53-f9e3-7110-b58c-6a704f705d60` : colonnes et affichage fournisseur.
- `01a0fd54-6748-7cb3-a0fd-c90536acdb56` : catalogue, offres et défilement.

La tâche de refonte des tests `01a0fd57-fd41-7c70-9c2d-08a5f1bd168e` est un
travail concurrent signalé par l’utilisateur. Ses suppressions et changements
d’instructions, de dépendances et de couverture sont préservés. `outputs/` et
`design-qa.md` restent hors périmètre. Aucun commit, push, PR, déploiement
applicatif ou import partagé n’est effectué par ce lot. Les migrations
distantes ont ensuite été appliquées sur autorisation explicite, comme consigné
ci-dessous.

## Résultat fonctionnel

| Ticket | Comportement préparé |
| --- | --- |
| TI-576 | Le choix cascade disparaît. La marge par seuil est expliquée avec sa base, son coefficient unique et son effet de seuil. Le barème existant est accessible aux administrateurs depuis le paramétrage. Les remises historiques restent en lecture seule et leurs montants sont préservés. |
| TI-577 | Visibilité, ordre dans les groupes de calcul et largeur des colonnes sont personnels, avec réinitialisation. Les préférences sont enregistrées par compte sur le navigateur courant ; elles ne sont pas synchronisées entre appareils. L’affichage ne modifie ni les données ni le PDF. |
| TI-578 | Référence interne libre, suggestion provisoire adoptable et attribution `ART-…` à la création si vide. L’attribution se fait en base sous verrou de tenant ; références historiques et références archivées participent à l’unicité. Aucune renumérotation des articles existants. |
| TI-579 | Liste compacte et entrée unique « Voir / modifier l’offre ». Édition ciblée, identité fournisseur/SKU/URL, tarif et transport regroupés. L’offre retenue apparaît dans le devis ; son coût enregistré reste indépendant des nouveaux tarifs. Comparaison par quantité, unité, devise et validité, avec offres non applicables explicitement désactivées. |
| TI-580 | Un clic de navigation attend les écritures de lignes, les mutations et les paramètres, puis reprend la destination. Une erreur conserve les saisies. Retour/Suivant rejouent la traversée historique sur les navigateurs disposant des indices Navigation API. |
| TI-581 | Les modales partagent un verrou compté de défilement et d’inertie ; le dernier dialogue fermé restaure l’état initial. Le retour aux produits conserve le défilement. |
| TI-582 | L’assistant de devis complet V0 IA est en veille : liens, menu, ouvertures automatiques et chargements UI de résumé masqués. Les validations historiques restent actives. Recherche catalogue, règles déterministes et autres usages IA restent distincts. |
| TI-583 | Dix métiers argumentés comme hypothèses commerciales, pilote plomberie de douze articles originaux, sans prix ni fournisseur inventé. Prévisualisation dans l’application : douze lignes valides, aucune rejetée ; import non soumis. Validation métier et responsables nominatifs restent externes à ce travail. |

Voir [les marges et la veille](chiffrage-marge-ti576-ia-ti582.md) et
[le catalogue pilote](catalogues-metiers-ti583.md).

## Intégration et revue

Les conditions des seules offres comparées sont lues avec une borne de tenant.
Les noms/références des seuls prix déjà retenus sont chargés en une lecture
groupée à l’ouverture du devis. Ces informations sont de lecture ; elles ne
remplacent jamais le coût stocké sur la ligne. Un identifiant de prix protège
contre l’affichage d’un ancien fournisseur après changement d’offre.

La revue a identifié puis fait corriger : sortie avant la fin d’une sauvegarde
de paramètres, saisie modifiable pendant cette sauvegarde, duplication de
l’historique navigateur, lien V0 historique trompeur, permissions SQL de fiche
fournisseur non canoniques et allocation ignorant les espaces des anciennes
références. Les rapports détaillés de revue et d’exécution sont conservés dans
le dossier de preuves. Les nouvelles migrations ont d’abord été exécutées sur
une base isolée jetable, puis activées sur le projet après autorisation.

## Migrations et activation

- `20261002155954_product_internal_reference_auto.sql` : suggestion et allocation.
- `20261002160807_supplier_offer_atomic_edit.sql` : modification atomique d’offre.

La modification d’offre utilise un RPC definer étroit avec identité authentifiée,
tenant actif, appartenance et rôle vérifiés. Les droits généraux des tables
restent inchangés. Le verrou de fiche commune respecte l’ordre existant ; le
prix est relu sous verrou et une association divergente annule l’opération.
Le transport conserve le contrôle administrateur déjà présent en base.

Les types RPC, le manifeste et OpenAPI sont raccordés. L’historique et le schéma
de la cible ont été vérifiés avant l’application ciblée des deux migrations.
La génération de référence et la nouvelle sauvegarde atomique sont désormais
installées sur cette base. Aucun `db push` global n’a été exécuté.

### Demande d’activation du 2 octobre 2026

L’utilisateur a autorisé l’application des deux migrations après réception du
bilan. La cible est `ijropnynpwjbllievrip`, concordante entre l’URL Supabase de
l’application et le serveur MCP de `.mcp.json`. Les empreintes SQL restent
celles validées dans le manifeste.

Le premier essai a été bloqué avant modification : les credentials OAuth du
serveur `supabase_miaouffrage` demandaient une nouvelle authentification. Le
connecteur global et la CLI Supabase étaient sur un autre compte. L’utilisateur
a ensuite demandé de lancer la connexion ; `codex mcp login` avec le binaire de
l’application (0.159.0-alpha.12.1) a réussi. Le serveur dédié a permis de lire
l’historique, le schéma, les helpers de tenant, les déclencheurs et les droits.
Les dépendances étaient présentes et les trois nouvelles fonctions absentes.

| Fichier local appliqué sans modification | Version enregistrée par Supabase |
| --- | --- |
| `20261002155954_product_internal_reference_auto.sql` | `20261002174113` — `product_internal_reference_auto` |
| `20261002160807_supplier_offer_atomic_edit.sql` | `20261002174118` — `supplier_offer_atomic_edit` |

Les deux appels `apply_migration` ont retourné `success: true`. Contrôles après
application : trois fonctions présentes, déclencheur d’allocation actif, RLS
toujours active sur les trois tables, RPC refusés à `anon`, appels sans identité
refusés et absence de droit UPDATE général sur les métadonnées fournisseurs.
La suggestion `ART-000001` apparaît aussi dans le formulaire produit local
authentifié. Le formulaire a été annulé sans création d’article ni changement
d’offre réelle. Les écritures métier positives ont été vérifiées en base isolée
avant activation, sans nouveau rejeu sur la base partagée. La concurrence
multisession n’a pas été prouvée.

Le contrôle automatique a refusé la tentative d’aligner les numéros de versions
dans l’historique distant : cette modification dépasse l’autorisation
d’application et pourrait perturber le suivi Supabase. Elle n’a pas été
exécutée. L’historique Supabase est conservé, ainsi que les noms et contenus des
fichiers locaux. Avant toute future application par CLI, tenir compte de cette
correspondance de versions ; ne pas réexécuter ces SQL déjà appliqués ni réparer
l’historique sans autorisation distincte.

Preuves : `migration-activation-evidence.json`, `migration-activation-status.json`
et `reference-apres-migration.png` dans le dossier du lot. Les empreintes SHA-256
des deux fichiers appliqués correspondent aux fichiers validés localement.

## Preuves disponibles et limites

- Navigation : quatre scénarios Chromium avec le vrai guard et un serveur de
  sauvegarde local, couvrant clic, requête lente, échec/reprise et historique
  Retour/Suivant sans entrée supplémentaire. Rapport HTML dans
  `e2e/.codex-tmp/demo-eight-20261002-01a07773/e2e-report/`, traces dans le dossier
  de preuves `e2e-results/`. Le défaut d’historique a échoué avant correction.
- Offre : deux scénarios navigateur avec le vrai formulaire, UserContext et
  Modal, sauvegarde vers un serveur local. Admin : prix, SKU et transport en une
  écriture ; ingénieur : transport inchangé. Rapport HTML dans
  `e2e/.codex-tmp/demo-eight-20261002-01a07773/catalogue-local-report/`, traces dans
  le dossier de preuves `catalogue-local-results/`. Les scénarios ont échoué
  sur le transport manquant avant sa mise en place.
- SQL isolé : 19 assertions référence et 25 assertions offre, avec droits de
  table canoniques, refus de tenant/rôle, références archivées, rollback et
  accusé de réception des métadonnées. Cela ne prouve pas la concurrence entre
  sessions PostgreSQL ni toutes les politiques du schéma complet. Docker est
  indisponible sur cet hôte.
- Interface locale authentifiée : colonne K FO déplacée, Marque visible après
  rechargement et total maintenu à 2 850 €. Colonne Fournisseur affichée et
  retrouvée après rechargement, identité sans doublon dans la désignation.
  Comparaison ouverte avec deux offres et sélection actuelle explicite.
  Offre retenue « confo pro » retrouvée à réouverture ; coût ligne maintenu à
  1 750 €. Les préférences modifiées pour la recette ont été restaurées.
  Formulaire d’une seule offre
  ouvert sans sauvegarde. Retour au produit puis fermeture : overflow libéré,
  scrollTop observé de 60 à 780. Captures PNG dans le dossier de preuves.
- Pilote plomberie : CSV chargé dans la prévisualisation réelle sur le serveur
  compilé, séparateur reconnu, douze lignes valides, zéro rejet. Annulation
  avant import ; aucune création d’article dans la base partagée.
- Les E2E complets du catalogue ont échoué pendant l’authentification avant les
  parcours ; ces tentatives ne sont pas des succès produit. Les fixtures locales
  et la recette manuelle apportent des preuves distinctes.
- Les versions anciennes de navigateurs sans Navigation API utilisent le
  repli de garde historique. L’absence de perte de saisie est conservée ; la
  fidélité de Suivant n’a pas été vérifiée sur ces versions.

Les commandes, la révision, les changements locaux, les fixtures et les
résultats attendus/réels sont joints aux rapports E2E, sans credentials.

## Contrôles finaux du 2 octobre 2026

| Contrôle | Résultat | Preuve dans le dossier du lot |
| --- | --- | --- |
| `npm test` | 437 fichiers passent, un ignoré ; 2 677 tests passent, deux ignorés (19:02) | `full-vitest-final.log` |
| Tests existants de ligne/table après correction du libellé fournisseur | 41 tests passent (19:18) | `row-final-tests.log` |
| `npm run typecheck` | Passe | `typecheck-final.log` ; également exécuté par le build final |
| `npm run build` | Passe, tous les budgets de taille respectés | `build-final.log` |
| Lint des sources, en excluant les seuls artefacts générés | Passe, zéro avertissement | `lint-source-final.log` |
| Lint de `LineRow.tsx` après la dernière correction | Passe | Commande ciblée sans diagnostic |
| `npm run validate-openapi` | Passe, 132 chemins / 179 opérations | Contrôle exécuté après régénération |
| `git diff --check` | Passe | `diff-check-final.log` |

Commande lint reproductible :
`npm run lint -- --ignore-pattern ".codex-tmp/**" --ignore-pattern "e2e/.codex-tmp/**" --ignore-pattern ".e2e/**"`.
Le lint brut parcourt les rapports HTML, traces et bundles Next générés ; son
échec ne doit pas être assimilé à une erreur des sources. Ces artefacts ont été
conservés. La refonte concurrente des tests continue : les nombres de la suite
complète décrivent l’exécution horodatée, pas un état figé de ce travail externe.

La recette visuelle a aussi fait corriger un libellé tronqué : dans la colonne
Fournisseur, le nom apparaît avant la référence ; le titre accessible conserve
la mention « Offre retenue ». La capture finale et le panneau de comparaison
permettent de vérifier l’identité retenue sans modifier le devis.

## Coordination et complément de recette du 2 octobre 2026

La tâche « Prune low-signal tests » porte les imports, l'intégrité des devis,
l'autosave et les exports ; la tâche catalogue porte les références et offres.
L'orchestrateur porte les paramètres et les colonnes. Les exécutions sont
isolées par contextes navigateur et fixtures neuves du tenant ARMY ; les données
Hydro Express ne sont pas modifiées par ce complément.

Le lot Army archivé `2026-10-02T18-08-41-701Z` compte neuf succès sur dix tests
(dont la préparation de connexion), sans test ignoré : huit scénarios métier
passent et la duplication échoue avec SQLSTATE `42P01`. Il décrit son candidat
horodaté, avant les corrections suivantes.

### Correction supplémentaire de duplication, autorisée et appliquée

La migration `20261002175735_fix_estimate_duplication_parameter_qualification.sql`
répare uniquement dix qualifications de paramètres restées sous l'ancien nom
de fonction après renommage. La définition déployée est conservée, ainsi que
la façade produit, les contrôles tenant, le propriétaire et les ACL. Revue
indépendante sans bloquant ; quarante assertions PostgreSQL isolées avec les
définitions déployées, trente-sept avec les migrations canoniques. Ce ne sont
pas des preuves RLS complète ou multisession.

L'utilisateur a ensuite autorisé explicitement l'application et le rejeu sur
les seules fixtures ARMY. `apply_migration` a retourné `success: true` sur
`ijropnynpwjbllievrip`. L'historique a enregistré la version `20261002182830`,
nom `fix_estimate_duplication_parameter_qualification`. Le fichier local
conserve son nom et son empreinte `71bddc67af9c06aa6fe04b5620dd40bb6d4f32422df3db5d82ef8de86ba3898c`.
Contrôle après application : zéro qualification périmée, SECURITY DEFINER et
search_path conservés, aucun droit d'exécution anon/authenticated sur la fonction
interne. Aucun DML métier ni réparation de l'historique distant.

Preuve : `duplication-activation-evidence.json` dans le dossier du lot ; le
rejeu connecté est confié à la tâche de tests. La réussite DDL seule ne clôt
pas la régression de duplication.

### Défauts de marge issus de la revue indépendante

Deux écarts UI ont été confirmés par lecture : la capacité d'édition du barème
utilise le rôle global alors que le serveur exige un administrateur de tenant ;
l'explication d'un snapshot v2 peut traiter son coût technique zéro comme un
coût historique et afficher le coefficient du barème courant. Les scénarios
ont été définis avant correction dans `docs/demo-eight-recette-parametres.md`.

Les premiers essais des nouvelles recettes se sont arrêtés avant mutations :
build login ancien, buffer du relevé Git insuffisant, hydratation prématurée,
puis accès réseau du navigateur/serveur. Ces erreurs de préparation ne sont ni
des régressions métier prouvées ni des succès de recette. Les rapports JSON
font foi ; les premiers manifestes ayant indiqué « passed » pendant un échec
de préparation sont explicitement invalidés. Les snapshots automatiques de
connexion ont été expurgés, et la page de connexion est désormais fermée avant
de propager une erreur afin d'empêcher l'enregistrement des valeurs de saisie.

Le contrat TI-582 reste le masquage des points d'entrée V0 et l'absence d'appels
automatiques. Les mutations directes API restent soumises aux autorisations
existantes ; ce lot ne déclare pas toute génération V0 côté API impossible.

## Reprise coordonnée des 6 et 7 octobre 2026

Le chat catalogue `01a0fd54-6748-7cb3-a0fd-c90536acdb56` a été vérifié à la
demande de l'utilisateur. Il conserve ses trois scénarios connectés et son
diagnostic du premier clic fournisseur. La tâche « Prune low-signal tests »
prépare la correction SQL suivante et garde le rejeu final de duplication ;
la tâche marge assure sa revue indépendante. Les serveurs 3000 et 3107 sont
arrêtés durant la préparation SQL.

### Cohérence du palier de marge et des entrées MO

La recette connectée a reproduit une ligne enregistrée à ×1,50 avec un pied
calculé à ×1,10. Le calcul UI utilise désormais le coût complet après saisie ;
le serveur projette les montants de toutes les lignes V2 tiered existantes et
les trois totaux du pied dans une seule RPC groupée, avec le token de version
et les contrôles de bail/rôle/tenant existants. Les lignes non éditées ne
reçoivent que leurs champs monétaires. La création/conversion initiale reste
une frontière séparée et n'est pas présentée comme une transaction unique
d'insertion et de recalcul global.

Ce passage par la RPC a révélé que son cœur déployé ignore les six champs
atelier/chantier. La nouvelle migration
`20261006210154_restore_bulk_estimate_labor_split.sql`, SHA256
`db4d586abf4ffb37ade5abcb7ea2a5721ac638a20734fd57741fee62efdc7220`, est prête
mais n'est pas appliquée à distance. Elle ajoute ces six affectations dans
l'UPDATE atomique existant et conserve signatures, OID, propriétaire, ACL,
SECURITY INVOKER, search_path, wrappers, CAS et contraintes. Aucun flag ni calcul
SQL nouveau ; clés absentes conservées, null explicite traité selon les colonnes.

Le plan et les commandes sont dans `docs/testing/tiered-bulk-mosplit.md`.
Baseline rouge : `.e2e/army/tiered-bulk-mosplit/runs/2026-10-06T21-00-49.903Z/`.
Derniers artefacts locaux stables : `2026-10-06T21-12-31.797Z-deployed/`
(145 contrôles) et `2026-10-06T21-12-31.797Z-canonical/` (138 contrôles), sous
le même dossier `runs/`. La revue indépendante conclut sans bloquant et a
reproduit le correctif : `final-bulk-split-review.md` dans le dossier du lot.
Ces preuves PGlite avec identité simulée ne prouvent ni Auth/PostgREST, ni baux
HTTP, ni toute la pile RLS ou la concurrence multisession.

Un probe AID distinct (44 contrôles) montre que son absence de prise en charge
dans le payload du RPC déployé précède cette correction ; les AID déjà stockés
sont conservés avant/après. Ce défaut préexistant reste séparé du correctif MO.

### Vérifications du candidat local

- TypeScript et lint des sources : passent le 6 octobre.
- Vitest : 434 fichiers et 2 668 tests passent ; un fichier et deux tests
  ignorés, sans les présenter comme couverts. Logs `coordinated-types-20261006.log`,
  `coordinated-lint-20261006.log`, `coordinated-vitest-20261006.log` dans le lot.
- Compilation Webpack : passe, build ID `C9JTgUVrDQVUHoyClfAEK`, y compris
  TypeScript. Log `coordinated-build-webpack-final-20261006.log`.
- Le build normal Turbopack échoue sur un sous-processus CSS avant compilation,
  même avec accès réseau et TEMP propre au lot. Diagnostics conservés ; ce
  résultat ne constitue pas une réussite du build normal.
- Le checker standard de performance ne reconnaît pas l'affectation minifiée
  du manifeste Webpack. Mesure indépendante en lecture seule dans
  `webpack-performance-20261006.json` : quatre budgets respectés, `takeoff-review`
  dépasse ses limites (1 461 205 octets bruts / 405 921 gzip, plafonds
  1 400 000 / 400 000). Aucune limite n'a été relevée pour obtenir un succès.

Restent le consentement ciblé à cette nouvelle migration, son contrôle après
application, les recettes connectées du candidat compilé et un rejeu de
duplication dont les sources restent stables. Le passage SQL seul ne clôt
aucun de ces parcours. Aucun commit, push, PR ou déploiement n'est effectué.

Le 7 octobre, les huit tickets Linear ont été actualisés avec leurs résultats et
leurs limites : TI-576 à TI-582 en cours, TI-583 en revue de sa préparation.
Aucun ticket n'a été clôturé comme entièrement validé. La nouvelle demande
d'application de la migration MO et de recette ARMY est soumise à l'utilisateur.
Le manifeste local correspond à son SHA256 ; son contrôle de cohérence passe.

### Activation MO autorisée le 7 octobre

L'utilisateur a répondu « autorisation accordé » à la demande ciblée. Les quatre
corps SQL déployés étaient encore identiques aux snapshots relus et la migration
locale conservait son empreinte. `apply_migration` a retourné `success: true` ;
l'historique distant enregistre `20261007055010`, nom
`restore_bulk_estimate_labor_split`. Seul le cœur a changé : six affectations et
jointure au payload présentes ; OID, propriétaire, ACL, mode invoker et config
conservés ; trois autres fonctions exactement inchangées. Aucun DML métier ou
alignement d'historique. Preuve : `mo-activation-evidence-20261007.json` dans le lot.

Le serveur compilé 3000, build `C9JTgUVrDQVUHoyClfAEK`, a été démarré par
l'orchestrateur. Le contrôle HTTP prouve le login POST et le manifeste statique
de ce build servis avec HTTP 200 (`compiled-runtime-health-20261007.json`).
Le lot paramètres/colonnes initial ne passe que deux scénarios sur six : droits
admin et veille V0. Quatre scénarios se sont arrêtés pendant l'installation de
fixture sur une cellule de quantité inactive ; cela ne prouve pas leur fonction
métier. La sélection du gridcell exact, déjà utilisée avec succès par le lot
catalogue, remplace la sélection du simple parent dans le helper de fixture.
Les premiers artefacts restent conservés et ne sont pas requalifiés.

### Catalogue qualifié et défaut AID à préserver

Les deux cas références et édition/défilement passent sur C9 dans
`.e2e/demo-eight-connected/2026-10-07-catalogue-1791352322732-ef0dff0c/`.
Le cas devis révélait une perte des conditions dans
`toSupplierComparisonAlternative` : cinq propriétés fournies par l'API étaient
omises côté client. Le parser est corrigé sans nouveau SQL ou hook financier.
Le candidat recompilé `fR3hYfgtgRqyJS2Qp17Eq` passe le cas renforcé
`2026-10-07-catalogue-conditions-1791353505840-5e4c18ff` : premier clic, Beta
retenue, sortie sans Ctrl+S, réouverture, coût 1200/total 5400 conservés après
catalogue 1250, puis refus d'unité m, minimum 10 et expiration. Chaque condition
est relue dans la réponse de modification, le GET et la comparaison API avant
l'oracle UI. Le source-fence du cas atteste ses fichiers et le build inchangés.

Les quatre recettes root restent arrêtées pendant la préparation de leur ligne
manuelle, malgré parent/gridcell, POST de bail attendu et double-clic. Les
manifestes indiquent input enabled, aucun ancêtre inert, opacité 0 et focus MAIN.
Les captures restent conservées ; le chat catalogue prend le diagnostic
différentiel de ce helper. Aucun succès de marge/colonnes n'est déduit de ces
arrêts avant assertion métier.

Un scénario HTTP distinct, avec ligne ARMY à coût nul, a confirmé la perte de
saisie AID après la redirection du PATCH V2 tiered vers le bulk : demande valide
`ARMY.AID.1410`, réponse réussie, puis GET `aid: null`. Rapport
`2026-10-07-aid-valid-http-diagnostic-01a07773/results.json`. Le rouge n'atteint
pas l'assertion financière suivante et n'en prouve donc pas l'invariance. Les
essais antérieurs arrêtés sur focus ou format invalide sont de la préparation,
pas ce défaut. Plan `docs/testing/tiered-bulk-aid.md`, revue
`aid-tiered-seam-review-20261007.md` dans le dossier du lot. La correction doit
écrire AID et prix ensemble sans changer droits, bail, CAS ou les six champs MO.
Une nouvelle application distante demandera une autorisation ciblée.

### Rejeu après stabilisation du tableau, 7 octobre

La mesure passive des événements a isolé un défaut réel : l'apparition du
« Chemin actif » déplaçait le tableau de 25,39 pixels entre mousedown et mouseup.
Le clic d'une petite ligne manuelle finissait hors de sa cellule. Le bloc
réserve désormais une hauteur constante, avec texte tronqué et chemin complet
dans le titre. Le helper vérifie le premier clic simple, sans interaction de
secours. Les rouges précédents restent conservés.

Webpack compile le candidat `hNyhZ87A5BGcW7eH8H2KM`, TypeScript inclus. Le contrôle
HTTP du login POST et du manifeste statique passe, enregistré dans
`compiled-breadcrumb-runtime-health-20261007.json`. La recette
`.e2e/demo-eight-connected/2026-10-07-breadcrumb-parameters-01a07773/` passe
ses six scénarios en deux minutes : colonnes personnelles entre deux devis,
droits tenant admin, coefficient de snapshot synthétique, veille V0, seuil de
barème sur toutes les lignes et le pied, sauvegarde de paramètres historiques
synthétiques. Les empreintes des sources des six manifestes n'ont pas changé.
Cela ne prouve ni un second compte connecté, ni un document réellement figé.

Le complément MO du cas barème passe par PATCH ordinaire avec bail de page,
relecture et rechargement des six champs, puis refus 409 d'un token périmé.
`EST-031_LABOR_SPLIT` est désactivé sur le tenant ARMY : les valeurs sont
conservées mais le coût des postes séparés n'est pas activé, et aucune saisie
dans des colonnes atelier/chantier visibles n'est revendiquée.

La proposition AID est gelée au SHA256
`c76ca56503a60c0fa2393b84eceba7c262c0de1e568d0eee4b4de3e31ae2b6e4`.
La revue indépendante `final-bulk-aid-review.md` conclut sans bloquant et
reproduit 126 contrôles post-MO / 117 canoniques sur les entrées stables, dans
`tiered-bulk-aid/runs/2026-10-07T06-37-07.349Z-{deployed,canonical}/`.
Le manifeste local est complété et validé ; le précheck distant retrouve les
quatre fonctions post-MO exactement inchangées et aucun historique AID.
L'application attend une nouvelle réponse à la question ciblée, distincte de
l'autorisation MO. Aucun succès HTTP AID après correction n'est encore acquis.

La mesure Webpack indépendante du nouveau candidat est conservée dans
`webpack-performance-20261007.json` : les mêmes quatre budgets passent et
`takeoff-review` reste au-dessus de son budget avec 1 461 205 octets bruts /
405 921 gzip. Le build normal et le checker standard restent les limitations
décrites plus haut ; aucune source hors lot ou limite n'a été modifiée.

Le cas fournisseur renforcé passe aussi sur ce même candidat :
`2026-10-07-catalogue-breadcrumb-1791355343539-af3d0ef9`, 70,8 secondes,
premier clic strict, offre Beta retenue à 1200, navigation sans Ctrl+S,
réouverture à total 5400, tarif catalogue 1250 sans réécriture, puis trois
conditions incompatibles attestées par API et UI. Les vingt fichiers surveillés,
BUILD_ID et login.html restent identiques, aucune erreur de page métier.
Index de douze artefacts SHA256
`06b32b3ec9f4330cd842f154838d70110ee1b3ad4591ae720f48da2383345bde`.
Les deux autres cas catalogue restent prouvés sur le candidat C9 précédent.

La suite conservée repasse après les corrections : 434 fichiers / 2 668 tests
passent, un fichier et deux tests ignorés, durée 79,61 secondes ; log
`final-breadcrumb-vitest-20261007.log`. Lint des sources modifiées passe dans
`final-breadcrumb-lint-20261007.log`. Les tickets TI-577 et TI-582 passent en
revue avec les limites de preuve explicites ; TI-576 reste en cours pour AID.
Le chat tests reçoit l'allocation d'une seule duplication finale sur 3107.
Les sources sont gelées et toute application AID sera différée jusqu'à la fin
de ce rejeu pour éviter de modifier la base pendant son exécution.

### Duplication finale qualifiée et AID en attente

`npm run e2e:army:critical -- --grep duplication` passe sur le runtime séparé
Next dev Webpack 3107 : deux résultats sélectionnés (connexion et duplication),
huit autres scénarios hors filtre, exit 0. Archive
`.e2e/army/critical/runs/2026-10-07T06-48-23-982Z/` ; avant/après du diff identiques,
`sourceChangedDuringRun=false` pendant 06:48:23.982Z–06:51:33.894Z. L'audit
`final-verification.json` contrôle 52 entrées et douze empreintes sans écart,
aucun secret détecté et aucune trace authentifiée. SHA256 du manifeste :
`f53837d82bee0673d28d3603336d89c3057aae2e0ffbec5a0dfc4c6e1a421743`.

Projet neuf `81a35bbf-ae57-4ecc-9458-e46819436b9b`, source
`0f7bfb09-bbfa-4ec7-9e9e-b154005e2811`, copie
`b07358ab-8035-440c-8839-1a47f129e676` : six items dans chaque version,
identifiants disjoints, trois sections imbriquées et positions conservées.
Les deux versions initiales ont 20 004 / 4 000 / 24 004 centimes HT/TVA/TTC ;
la copie modifiée et rechargée a 30 004 / 6 000 / 36 004, la source reste
identique aux champs capturés. Fournitures seules, provenance manuelle,
fichier synthétique et pages 1/2/3 conservés ; métadonnées vides, aucune preuve
de métadonnées arbitraires. Duplication HTTP 201, édition et réouverture UI.
Cela qualifie ce scénario sur 3107, pas une campagne entière ni le build hNy de
3000. Le serveur 3107 est arrêté, le serveur compilé 3000 reste disponible.

Après le signal de fin, seul le harness AID est complété avec une saisie dans
le menu contextuel et sa relecture après rechargement, en plus des transitions
HTTP création/remplacement/null. Cette extension postérieure ne change pas
la stabilité enregistrée pendant la duplication. Lint et TypeScript passent
(`aid-connected-menu-lint-20261007.log`, `final-types-20261007.log`). Aucune
modification supplémentaire applicative ou SQL et aucune application AID.
La recette AID attend toujours l'autorisation ciblée présentée à l'utilisateur.

### Activation et recette AID autorisées le 7 octobre

L'utilisateur a répondu « autorisation accordé » à la demande distincte AID.
Le précheck retrouve les quatre définitions et attributs identiques au snapshot
post-MO relu, aucun historique AID et les quatre empreintes gelées.
`apply_migration` retourne `success: true`, historique distant
`20261007184209`, nom `restore_bulk_estimate_aid`, fichier local
`20261007062228_restore_bulk_estimate_aid.sql`, SHA256
`c76ca56503a60c0fa2393b84eceba7c262c0de1e568d0eee4b4de3e31ae2b6e4`.
Le postcheck compare exactement le nouveau SET et prouve les trois autres
définitions, OID, propriétaire, ACL, mode invoker et config inchangés.
Preuve : `aid-activation-evidence-20261007.json` dans le dossier du lot.
Aucun DML métier, modification de flag ou alignement d'historique.

Le premier contrôle local trouve 3000 arrêté et bloque avant connexion ou
fixture ; `aid-runtime-health-20261007.json` conserve ce résultat. L'orchestrateur
redémarre le même candidat compilé hNy, sans rebuild, puis atteste HTTP 200 du
login POST et du manifeste dans `aid-runtime-health-restarted-20261007.json`.

La recette `.e2e/demo-eight-connected/2026-10-07-aid-activated-batch-navigation-01a07773/`
passe 1/1 en 17,4 secondes. Le PATCH normal crée, remplace puis efface AID.
Le menu contextuel saisit une nouvelle valeur, quitte via Mes affaires sans
Ctrl+S, puis revient au devis sous nouveau bail : POST `/batch` avec
`operations[].data.aid` exact, GET persistant et champ menu relu. Ligne et pied
restent inchangés sur cette fixture à coût zéro ; les montants positifs mixtes
restent une preuve PostgreSQL isolée distincte. Version
`fe88e1ca-4986-4743-8a0c-2c2e14f45a4d`, ligne
`85d79e3a-d9a7-418c-97f8-f1dfeafe48d7`, données ARMY conservées.
Sources sélectionnées et BUILD_ID stables ; index des preuves SHA256
`c1402bb1ef789d0e713599f60ba21b9cc922304d68a13fb4cf63c12483573a7c`.

Les deux essais antérieurs après application passent les transitions HTTP mais
échouent sur une mauvaise attente de transport du harness (`items` PATCH puis
`items/bulk` POST). Le flush réel commence par `/batch` POST ; le scénario est
corrigé pour attendre ce contrat et déclencher une navigation utilisateur.
Les rapports `2026-10-07-aid-activated-http-ui-01a07773` et
`2026-10-07-aid-activated-bulk-ui-01a07773` restent conservés comme preuves
partielles, sans passage UI revendiqué. Aucune correction app/hook ou autre
migration n'a été nécessaire. Le parcours final ferme cette attente AID et
permet de passer TI-576 en revue, avec les limites historiques/flag décrites.

La lecture finale Linear confirme TI-576 à TI-583 tous en `In Review`.

## Préparation de livraison — 9 octobre 2026

Le build canonique utilise explicitement Webpack ; son smoke local, OpenAPI,
types et cinq budgets inchangés passent. Le lecteur accepte le vrai manifeste
Webpack et conserve ses refus d'entrée invalide. UnifiedImportFlow et le wizard
d'application métré chargent à leur ouverture ; la mesure review passe à
1 381 607 octets bruts / 385 547 gzip. La panne native Turbopack reste distincte.

Sur le candidat compilé `FiIxxif8eGavkGaAtLxRW`, dix scénarios connectés du lot
passent, avec trente sources et build surveillés stables. Le rejeu CSV DPGF sur
3107 passe les deux variantes et la connexion (trois résultats sélectionnés,
sept autres exclus) ; sourceChangedDuringRun=false. La suite conservée finale
passe 434 fichiers / 2701 tests, avec un fichier et deux tests ignorés.

La sonde supplémentaire du wizard conserve un refus serveur « Page introuvable »
sur une version ARMY lisible : aucun GET takeoff synthétique consommé, aucun job
ou flag changé ; ouverture froide, focus et reset restent sans preuve positive.
Les limites de compte unique, snapshots synthétiques, split MO désactivé et
fixture AID à coût nul sont conservées.

Les résultats, captures, identités et empreintes sont rassemblés dans
[demo-eight-delivery.md](demo-eight-delivery.md). La recette humaine et les
patches bornés sont préparés selon [le périmètre](demo-eight-delivery-scope.md),
avec prérequis TI-537/types/tests séparés. Ce checkout testé n'est pas une série
de commits extraite autonome déjà validée. Les huit tickets ont reçu le bilan
du 9 octobre et restent en revue ; aucun staging, commit, push, déploiement ou
nouvelle migration distante effectué.
Lint du harness, TypeScript et `git diff --check` passent après son ajustement.
Les échecs du build normal Turbopack et du contrôle de performance restent
documentés ; aucun déploiement applicatif ou passage de campagne globale
n'est déduit de cette recette ciblée.

La relecture indépendante du trajet menu confirme aussi le contrat : Entrée
met à jour le tampon, la cadence automatique est de 60 secondes, la navigation
force POST `/batch` puis attend la sauvegarde avant de partir. Le parcours
ajusté cible ce contrat correctement. Le run de 17,4 secondes ne prouve pas la
cadence automatique, seulement le flush à la navigation ; aucun contournement
du bail, des conflits ou de la restauration de brouillon n'est introduit.
