# Passage des suites historiques à TesterArmy

Inventaire du 15 octobre 2026, avant écriture des ports. Une équivalence ci-dessous
désigne des assertions à rapprocher ; elle ne permet pas de supprimer un fichier
historique avant exécution du remplacement avec preuve archivée. Les spécialistes
montés dans un navigateur gardent leur frontière : composant réel, transport
simulé, aucune qualification SQL/RLS implicite.

| Spec dans `e2e/estimates` | Assertion distinctive / destination |
| --- | --- |
| `full-lifecycle` | Création, édition et sorties : `critical/estimate-integrity`; émission réelle à rattacher au profil `local/offer-emission`. |
| `duplicate` | Identités et hiérarchie indépendantes : `critical/estimate-integrity`. |
| `import-dpgf` | CSV, mapping et import canonique : `critical/dpgf-import`. |
| `dashboard-ux` | Accessibilité, mobile et focus : port séparé du titulaire architecture. |
| `plan-center` | Upload, liste et suppression de plans : port architecture. |
| `hub-launch-metre` | Lancement et activité depuis un plan : port architecture. |
| `team-a-hub-prod` | Parcours manuel sans DPGF : port architecture. |
| `column-preferences` | Ordre, largeur, compte, navigation et invariance financière : `personal-columns.e2e.ts`. |
| `autosave-navigation.local` | Latence, refus, reprise en un clic, Back/Forward sans entrée supplémentaire : `navigation-specialist.e2e.ts`. `local/editor-navigation-lease` couvre d'autres frontières, pas ces quatre assertions. |
| `catalogue-offer.local` | Un seul enregistrement prix/référence/transport et transport interdit à l'ingénieur : `catalogue-specialist.e2e.ts`. |
| `catalogue-demo` | Suggestion/référence manuelle/attribution, offre unique, fermeture et défilement : `catalogue-ui.e2e.ts`. |
| `demo-eight-catalogue.connected` | Persistance et allocations concurrentes, autre offre inchangée, coût conservé et incompatibilités : les trois parcours sont dans `catalogue-connected.e2e.ts`; exécution à qualifier. |
| `demo-eight-parameters.connected` | Droits tenant, coefficient figé et V0 inactif dans `settings-contracts.e2e.ts`; barème au seuil/main-d'œuvre, historique et AID dans `settings-connected.e2e.ts`; exécution à qualifier. |
| `ui-polish.local` | FIFO/durée/hover/F6, fraîcheur fournisseur et contraste FO/MO : `ui-polish.e2e.ts`, mêmes composants et axe-core dans le navigateur, sans adaptateur Playwright. |
| `generated-ouvrages` | Rejet total et chapitre de repli : rapprocher des parcours `local/generated-ouvrage-*`, exécution de ces assertions encore à rattacher. |
| `generated-ouvrages-subdetail` | Revue avant insertion et provenance desktop/mobile : même rapprochement, viewport mobile à conserver. |
| `affaire-pilotage-panel` | Exception, finish line et sorties/commandes : commandes partiellement couvertes par `local/purchase-*`; cockpit et finish line restent. |
| `affaire-recovery-flow` | Statuts acquis conservés et reprise de l'étape manquante : reste à porter. |
| `cockpit-command-bar` | Preview identique inline/Ctrl+K et navigation intake/brief : reste à porter. |
| `hub-plans-card` | Absence de plans, héros de lancement et version carry-over : reste à rapprocher/porter. |
| `hub-takeoff-auto-propose` | Masquage temporaire/persistant, CTA manuel, sélection version : reste à porter. |
| `import-flow-carry-over` | Confirmation explicite et jobs sources liés à nouvelle version : reste à porter. |
| `takeoff-dpgf-review` | Revue, application contrôlée, export, multi-lien, provenance, prix validé humainement : reste à porter. |
| `takeoff-epics-matrix` | Health, création/listage, provenance, plan CRUD, plafond offset, delta : reste à porter. |
| `takeoff-guard` | Refus 422, vérification, niveau A, justification admin et exclusions : reste à porter. |
| `team-a-hub-dev-scenarios` | Réserves/clarification/revalidation synthétiques : profil développement explicite nécessaire ; aucun skip silencieux en production. |
| `team-b-user-stories` | Statistiques mapping, PDF tabulaire, XLSX hiérarchique, fournisseurs et reprise : CSV déjà couvert, autres assertions à porter/rapprocher. |

`e2e/auth/login-helper.spec.ts` contient cinq tests des helpers et du reporter
Playwright : hydratation tardive, refus sans relance, réponse API expurgée,
diagnostic expurgé et duplication incomplète. L'auth Army teste déjà une connexion
réelle après hydratation et les formulaires sans scripts. Les contrats de
confidentialité et d'erreurs doivent être réévalués sur les helpers Army ; exécuter
les anciens helpers sous un autre runner ne constituerait pas un port.

## Défaillances définies avant les ports

- Colonnes : largeur perdue au reload, ordre différent entre en-tête/corps/pied,
  préférence sans portée utilisateur, navigation qui réinitialise les choix,
  modification cachée des montants ou reset incomplet. Deux nouveaux devis ARMY,
  lecture API avant/après et assertions des contrôles constituent la preuve.
- Navigation : départ avant acquittement, saisie perdue après 503, second clic
  requis après attente, entrée d'historique ajoutée à Back/Forward. Le vrai hook
  monté dans le navigateur reçoit une réponse contrôlée ; le blocage exact et les
  deux sens d'historique ne sont pas reproductibles par les parcours actuels.
- Offre fournisseur : prix mal converti, référence perdue, deux écritures au lieu
  d'une, transport modifiable sans rôle. Le formulaire réel et son contexte sont
  montés, un transport local conserve les requêtes. Cela préserve la preuve
  spécialiste existante, sans prétendre exercer la base.
- Catalogue : suggestion qui écrase la saisie humaine, absence de référence
  attribuée, recherche inutile à la modification, verrou de scroll restant après
  fermeture. Les pages réelles tournent avec des réponses synthétiques explicites.
- Réglages : rôle tenant ignoré, coefficient figé remplacé par celui courant,
  ancien lien V0 déclenchant un chargement. Une variante de lecture ne doit jamais
  écrire le statut ni les montants simulés.
- Notifications et CSS : toast en attente expiré avant affichage, suppression de
  file erronée, hover ignoré, F6 inaccessible, seuil fournisseur figé à 90 jours,
  cascade CSS ou contraste FO/MO régressé. Les quatre parcours reprennent la
  fixture UI historique ; les attentes de 1 700/2 200 ms mesurent les contrats de
  durée, sans temporisation de navigation. Les audits utilisent axe-core réel.

Tous les ports utilisent les API `@e2e-dev/web`/`e2e`, `session: army`, le tag
`critical`, la fixture Army et ses artefacts. Aucun `skip` de prérequis ne transforme
une absence de preuve en succès. Le pilote coordonne exécution, source figée,
configuration, environnement local et archives ; aucun port n'est déclaré qualifié
par sa seule découverte ou compilation.

## Premier état de validation

16 cas portés dans six fichiers de scénarios, avec un helper de montage de
composants. Lint ciblé vert. Les deux premières tentatives de campagne ont échoué
pendant la collecte d'autres ports encore en cours (`Workbook`, puis syntaxe
`cockpit-command-bar`) ; elles n'ont exécuté aucun navigateur ni assertion.
Journaux `.codex-tmp/army-full-operational-first.log` et `...-second.log`.

## Complément connecté, défini avant son port

Les deux recettes `demo-eight-*.connected` gardent leurs écritures réelles sur le
runtime local : allocation automatique et concurrente des références, réouverture
de la référence manuelle, modification d'une seule offre, conservation de l'autre
offre et du prix de référence. La sélection fournisseur doit survivre à la
navigation sans sauvegarde manuelle ; un nouveau tarif catalogue ne doit pas
réécrire le coût retenu. Les incompatibilités unité/minimum/validité restent
bloquantes et ne modifient pas le devis.

Le complément paramètres conserve l'ajout des deux tranches, les refus de seuil
vide/dupliqué et de coefficient hors limite sans requête, la réouverture, le seuil
exact puis son franchissement, les six valeurs de main-d'œuvre et le conflit de
révision. La lecture du flag existant détermine l'oracle de calcul, sans l'activer.
Les remises historiques doivent survivre à un changement de titre ; AID doit
supporter création, remplacement, effacement et édition au menu puis navigation
et relecture, sans changer les montants. Ces assertions de persistance ne sont
pas remplacées par les fixtures synthétiques ci-dessus. Aucune nouvelle isolation
ni assertion métier assouplie n'est ajoutée.

Ce complément ajoute six cas, soit 22 cas pour ce sous-lot (hors ports des autres
contributeurs). Lint de `e2e/army/extended` et typage global passent après leur
écriture. Le premier navigateur de diagnostic reste sur sources mixtes ; il ne
qualifie pas une révision publiée.

Le diagnostic initial est conservé dans
`.codex-tmp/army-full-operational-interrupted/diagnostic.json` : auth et quatre cas
navigation réussis, huit échecs observés, quatre cas UI sans résultat final.
Interruption demandée après les opérations de pages en développement dépassant
leur délai (dont `/dashboard/estimates/new` en 108 s). Le `report.json` courant
était antérieur au run et est explicitement exclu de cette archive ; aucun succès
global n'en est déduit.

Deux corrections de fixture suivent ce diagnostic : le formulaire fournisseur
charge désormais la CSS réelle qui donne au modal son défilement, et les lookups
simulés du catalogue renvoient `suppliers/products`, le contrat actuel, au lieu de
l'ancien `items`. L'oracle zéro lookup pendant l'édition ciblée est conservé.
Le chemin de lecture du prix de référence est intercepté avec et sans suffixe.
Enfin CAT-C02 crée 24 articles ARMY supplémentaires, tous retenus dans les preuves,
pour retrouver la plage de défilement du tenant historique sur un tenant CI vide.
Le geste roue et les assertions de scroll/inert ne sont pas remplacés.

## Échecs de port observés sur candidate 4, avant correction

La campagne complète conserve huit échecs dans ces parcours : CAT-C02, CAT-C03,
CAT-S01 admin/engineer, CAT02, COL01, SET-C01 et SET-C03. Les captures et le journal
restent sous `.codex-tmp/army-migration-20261015/candidate-4/` et
`candidate-4-full.log` ; aucune modification n'est appliquée à ce candidat.

- Base UI expose aussi les notifications avec le rôle `dialog`. Le formulaire
  d'offre doit être identifié par son nom complet afin que le toast de succès ne
  bloque pas l'assertion de fermeture. La fixture conserve également son état
  `Offre enregistrée`, le nombre exact d'écritures et les restrictions de rôle.
- Le bouton fournisseur porte le nom accessible `Changer d’offre pour <ligne>`.
  Le port avait perdu le suffixe du sélecteur exact du scénario historique.
- `allTextContents` du SDK fournit ici le texte rendu en majuscules. Le scénario
  historique lit `textContent` : la lecture DOM conserve les mêmes libellés,
  l'ordre K FO/PR FO et tous les contrôles de largeur, de portée et de montant.
- À la réouverture, le même endpoint de verrou reçoit DELETE (200) puis POST
  (201). Une attente par URL seule peut prendre la libération pour l'acquisition.
  Le port doit observer uniquement le POST émis par l'éditeur, puis vérifier 201,
  `ok`, la propriété de la session et l'absence d'expiration. La projection exclut en-têtes,
  cookies, jetons et réponse brute ; elle n'acquiert aucun verrou elle-même.

Ces défauts sont déjà reproduits par la campagne E2E. Aucune régression isolée
supplémentaire n'est nécessaire ; un nouveau candidat doit rejouer les mêmes
parcours et toutes leurs assertions métier avant qualification.

Le candidat 6 traverse CAT-C02, CAT-S01 administrateur et CAT02. Deux erreurs de
port restent visibles dans son archive : CAT-C03 cherche le titre d'une ligne
dans son texte alors que ce titre est une valeur d'input ; la sélection doit
utiliser son contrôle de quantité nommé, sans modifier le devis. CAT-S01 ingénieur
attendait aussi `supplier_sku` inchangé dans un PATCH qui n'envoie que les champs
modifiés. L'ancien test exigeait le prix exact et l'absence de transport ; ces
contrôles sont conservés, avec l'absence explicite de modification de référence.
