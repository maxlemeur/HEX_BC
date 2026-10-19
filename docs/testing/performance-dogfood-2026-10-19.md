# Dogfooding performance — 19 octobre 2026

Quatre défauts ont été reproduits puis corrigés : fin du gros devis inaccessible sur desktop, trop de lignes montées sur mobile, navigation serveur inutile pour les filtres produits, animations tardives des commandes. Les gains démontrés portent sur ces comportements ; le chargement général ne s’améliore pas partout.

## Priorités et résultats avant/après

| Priorité | Défaut et cause | Avant | Après / correction |
| --- | --- | --- | --- |
| P1 | Dernières lignes desktop inaccessibles : le conteneur flex comprime le spacer de virtualisation | Sur 1 000 lignes, hauteur scrollable 1 120 puis 1 400 px ; ligne 1 000 non montée après scroll en bas | `flexShrink: 0` dans `EstimateEditorBody.tsx` ; hauteur en bas 55 030 px ; ligne 1 000 montée, visible et atteignable dans les 3 répétitions |
| P2 | La liste compacte mobile monte toutes les lignes, y compris hors écran | 1 000 lignes montées ; DOM médian 8 357 éléments ; tâches de chargement de 63–78 ms | Virtualisation par le hook existant `useVirtualList`, dès 50 lignes ; 15 lignes montées, DOM médian 505 (−94 %) ; aucune tâche >50 ms au chargement des 3 échantillons |
| P2 | Chaque recherche produits attend une navigation RSC avant sa lecture API | 7 recherches : 7 RSC + 7 API ; résultat vérifié médian 449,8 ms | `window.history.replaceState/pushState`, synchronisés avec les hooks Next ; 0 RSC + 7 API ; médiane 411,2 ms (−8,6 %) ; résultat exact et Retour conservés |
| P3 | Fondus déclenchés tardivement sur la liste commandes | 120 animations ; délai maximal 3 570 ms | Suppression de l’animation par ligne dans `OrdersTable.tsx` ; 0 animation, délai 0 ms ; 120 commandes et actions préservées |

Le défaut desktop est un blocage fonctionnel, même si les frames mesurées restent fluides. Les lignes commandes étaient visibles pendant leur délai : leur animation tardive n’était pas un blocage des données.

La correction mobile conserve l’intégralité de la hiérarchie, les sections repliables, le basculement liste/table et le ciblage d’une ligne hors écran. Le parcours vérifie le compteur « 1 000 lignes », l’accès à la dernière ligne et son ouverture en lecture seule, avant et après un aller-retour de mode et un repli/dépli de section.

## Ce qui est mesuré, et ce qui reste limité

- Grille : 3 échantillons mobile avant et après ; desktop avant interrompu au premier échantillon par le vrai blocage, puis 3 échantillons complets après. Aucun comparatif de médianes desktop n’utilise ce seul échantillon avant.
- Mobile : LCP médian **104 → 140 ms**, donc aucun gain universel de chargement. Frames p95 proches de 16,8 ms avant/après, aucune frame >50 ms sur ces courts scrolls. Le gain confirmé est la réduction du DOM et des tâches de chargement.
- Desktop après : une tâche de chargement de 67 ms subsiste au premier échantillon, puis aucune aux deux suivants. Cette campagne ne démontre pas l’absence générale de blocage du thread.
- Catalogue : sept préfixes distincts de la même vraie désignation locale ; les 300 ms de debounce restent inclus dans le temps vérifié. Celui-ci inclut le transport et les assertions du runner ; ce n’est ni INP ni un timestamp du compositeur. Les compteurs RSC/API concernent les ressources terminées après chaque saisie.
- Commandes : 120 lignes synthétiques injectées uniquement au GET ; montants HT extrêmes exacts 12 345 et 12 464 centimes, contenu et menu d’actions vérifiés. Aucun export, changement de statut ou effacement exécuté ; aucune mutation locale tentée.
- Grille : données injectées au GET de l’éditeur, statut navigateur en lecture seule ; mutations bloquées. Cela ne qualifie ni autosave, ni édition connectée, ni calcul financier sur 1 000 lignes, ni budget SQL.
- Le signal externe `scrollToItemId` mobile est recâblé et relu, sans parcours dédié exécuté pour ce signal. La preuve de dernière ligne porte sur le défilement réel et son ouverture.
- CPU/réseau natifs du Mac, Chromium 156.0.8078.4 ; viewports 1 280×800 et 390×844, catalogue/commandes 1 440×900. Aucune preuve de téléphone physique, de réseau lent ou de percentiles terrain.

## Autres parcours exercés

Les pages passent **14/14 avant et 14/14 après**, y compris les deux connexions de setup et les premiers ouvertures/fermetures des trois dialogues produits. Chaque route/viewport a 3 visites ; les répétitions peuvent bénéficier des caches.

| Route | LCP médian avant desktop / mobile (ms) | Après desktop / mobile (ms) |
| --- | --- | --- |
| Connexion | 516 / 528 | 532 / 536 |
| Inscription | 28 / 28 | 28 / 28 |
| Affaires | 128 / 120 | 120 / 116 |
| Produits | 112 / 112 | 124 / 116 |
| Commandes | 120 / 116 | 112 / 116 |

Ces écarts courts ne démontrent pas une accélération générale. Aucune long task au chargement de ces pages à petit volume, avant comme après.

La navigation réelle par menus passe **2/2 avant et après** : huit transitions sur affaires, commandes, référentiel et produits. Médiane clic/titre : **347,3 → 347,0 ms**, essentiellement stable. Le temps « contenu vérifié » inclut les assertions, dont une assertion négative qui attend sa stabilité ; il ne représente pas à lui seul une attente utilisateur.

La fiche d’affaire de référence passe **3/3** : cinq transitions, rechargement, valeurs HT/TVA/TTC **5 000/1 000/6 000 centimes**, lignes exactes et refus anonyme après rendu authentifié. Clic/titre : 363,4–380,4 ms. Sa confirmation finale passe aussi **3/3** sur une nouvelle fixture de la seconde pile ; ses temps ne sont pas fusionnés avec le comparatif de la première pile.

## Environnement et identités

Le compte partagé configuré a échoué dans l’UI et directement auprès d’Auth (`invalid_credentials`, HTTP 400). Aucun compte partagé, accès ou secret n’a été modifié. Les parcours utiles ont tourné sur la **pile Supabase native jetable locale**, après pgTAP et matrice RLS du runner existant. Ils ne mesurent pas la latence du backend hébergé.

Copie isolée sur `main` : `/private/tmp/mergeone-dogfood-20261019`. Source de départ : `e4258aab5a971b1c43b163b19dd89ba738497cbf`, Node **24.19.0**, avec scénarios et corrections non commités. Le commit local préexistant est conservé ; aucun commit, push ou déploiement réalisé par ce lot.

| Candidat | BUILD_ID production | Identité de diff dans les manifests |
| --- | --- | --- |
| Avant | `OZ3zWTyPPGtgz6kdCDQ-_` | Directory : `ab13aea0…ab9881` ; grille : `282cbb4b…b0524a` |
| Après | `ZXwBZPyK-83H1wvdcalsY` | `aa51fce3e803afc81d21b5af94cc5fcf9dae7efaa2ed83b17dd975f69cbcc7ad` |
| Confirmation finale, seconde pile | `gariktENHIq15gPQ5ZAHG` | `f8f49ac4c1e25017e0b2d14c65ada09b4f9ecf14b679e8c19a61b6a56cbbae10` |

Les différences entre scénarios avant correspondent à l’ajout/correction du harnais ; le build applicatif avant est identique. Chaque manifest conserve SHA complet du diff, empreintes des entrées, commande, runtime et identité de build. `source.changedDuringRun` et `productionBuild.changedDuringRun` sont faux pour chaque campagne retenue. Les sources restent figées pendant chaque run.

Fixture persistée locale unique : projet `ccb67237-d51f-4aea-abbf-ef0da36f00bd`, version `659a60cb-0b48-4ab6-8a81-eeca25cd734c`, nom `ARMY-1792427513150-7a9025a9 loading`. La grille part de ses **3 items**, total HT **5 000 centimes**, `updated_at=2026-10-19T16:31:54.634152+00:00`. Ces trois valeurs sont relues inchangées après chaque campagne grille. Les 1 000 lignes et 120 commandes sont exclusivement des réponses navigateur synthétiques.

## Preuves et échecs conservés

Racine de livraison des preuves : `.e2e/army/dogfood-20261019/runs/`. Chaque dossier contient `manifest.json`, `report.json`, métriques et logs ; les échecs gardent aussi leur capture textuelle. Les nombres incluent les setups sélectionnés, jamais les scénarios filtrés.

| Run UTC du 19/10/2026 | Parcours | Résultat réel |
| --- | --- | --- |
| `2026-10-19T16-31-50-022Z` | Affaire avant | 3/3 |
| `2026-10-19T16-32-13-202Z` | Pages/dialogues avant | 14/14 |
| `2026-10-19T16-33-37-141Z` | Navigation avant | 2/2 |
| `2026-10-19T16-34-30-881Z` | Directory, harnais initial | 1 setup passé, scénario bloqué `APP_NOT_OPEN` ; corrigé par `app.open()` initial |
| `2026-10-19T16-34-55-426Z` | Grille initiale | 2 setups passés, 2 échecs : vrai blocage desktop et recherche absente du mode compact mobile ; scénario adapté à l’interface mobile réelle |
| `2026-10-19T16-35-56-173Z` | Directory avant | 1 setup passé, scénario rouge : 7 RSC et 120 animations ; métriques intégrales écrites avant assertions |
| `2026-10-19T16-38-12-221Z` | Grille avant stabilisée | 2 setups passés, 2 scénarios rouges : desktop inaccessible ; mobile 3 répétitions complètes puis seuil DOM dépassé (1 000 >50) |
| `2026-10-19T16-40-28-929Z` | Directory après | 2/2 ; 7 recherches, historique et commandes |
| `2026-10-19T16-40-55-115Z` | Grille après | 4/4 ; 3 répétitions par viewport, dernière ligne et contrôles |
| `2026-10-19T16-41-29-854Z` | Pages/dialogues après | 14/14 |
| `2026-10-19T16-42-38-929Z` | Navigation après | 2/2 |
| `2026-10-19T16-48-23-676Z` | Affaire finale, seconde pile | 3/3 ; nouvelle fixture et refus anonyme |
| `2026-10-19T16-48-33-532Z` | Grille finale, seconde pile | 4/4 ; même parcours, marqueurs mobile/desktop distincts |
| `2026-10-19T16-48-55-238Z` | Directory final, seconde pile | 2/2 ; interception `fallback` et gardes conservées |

Les tentatives de compte partagé et les problèmes de bootstrap/harnais restent des échecs de préparation, jamais des passes ni des mesures applicatives. Aucun retry n’a été ajouté. Le run grille avant stabilisé conserve le vrai blocage desktop ; son scénario mobile n’est pas « passé » parce que ses mesures sont complètes.

**Qualité finale : `npm run verify:pr` passe, exit 0**, sur le code final : audit des dépendances/signatures, architecture, OpenAPI, types, lint, **3 282 tests Node**, **820 jsdom**, **12 de couverture critique**. Les 3 tests Node ignorés ne sont pas comptés comme passes. Identité et durée observée : `.e2e/army/dogfood-20261019/quality-result.json` ; log : `verify-pr-passed.log` dans cette même racine. Les builds isolés passent aussi leurs budgets de bundle existants.

Les échecs qualité restent conservés : retour `void` de `browser.evaluate` corrigé en `null` ; interception `route.continue()` corrigée en `route.fallback()` pour conserver les gardes SDK ; collision du nouveau marqueur mobile avec le sélecteur des lignes desktop corrigée en `data-estimate-mobile-item-id`. Ce dernier défaut a été reproduit puis les **17 tests d’intégration existants ont passé sans modification**. Aucun garde ni assertion métier n’a été affaibli. La revue indépendante a couvert le diff initial, les corrections mobiles, puis le blocage flex nouvellement reproduit et le renommage final ; aucun défaut restant identifié dans ce périmètre.

Les **22 résultats sélectionnés après correction** sur la première pile, puis les **9 confirmations finales** sur la seconde, sont verts, sans retry. La seconde confirmation porte sur le marquage mobile et le harnais `fallback` ; les pages/navigation inchangées conservent leur preuve de la première pile. Les deux piles ont été détruites et leurs configurations secrètes supprimées. Leurs temps restent séparés. Les captures de préparation sont conservées sous `.e2e/army/dogfood-20261019/preparation/`, dont un lancement écarté depuis le mauvais checkout/build.

## Rejouer

Dans la copie locale conservée, le bootstrap `.e2e/dogfood-session.mts` utilise le runner natif existant, prépare uniquement la pile jetable et écrit une configuration privée dans `/private/tmp/mergeone-dogfood-control/local.env`. Ce fichier ne doit jamais être imprimé, commité ou copié dans les preuves. Pour une nouvelle copie propre, préparer ce bootstrap et le candidat applicatif avant les commandes ; ne pas réutiliser une configuration de pile arrêtée.

```sh
# Depuis une copie propre sans ancien reçu affaire, avec Node 24.
# Retirer uniquement le marqueur d'arrêt du bootstrap précédent :
node -e 'require("node:fs").rmSync("/private/tmp/mergeone-dogfood-control/stop", {force: true})'
node --import tsx .e2e/dogfood-session.mts
# Dans un second terminal après disponibilité de la pile :
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/tester-army/build-local.mjs --execute
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/run-tester-army.mjs performance-affaire --target chromium-desktop
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/run-tester-army.mjs performance --target chromium-desktop --grep 'dogfood directories'
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/run-tester-army.mjs performance-grid
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/run-tester-army.mjs performance --grep 'production performance|product dialogs'
node --env-file=/private/tmp/mergeone-dogfood-control/local.env scripts/run-tester-army.mjs performance-navigation --target chromium-desktop
# Quand les parcours sont terminés, arrêter proprement ce bootstrap :
touch /private/tmp/mergeone-dogfood-control/stop
```

Une nouvelle pile produit de nouvelles identités : conserver ensemble ses mesures avant/après. Pendant chaque campagne, la fixture affaire reste dans cette pile ; sa visite peut mettre à jour sa propre projection d’approbation et ses événements d’audit. La grille contrôle son identité, ses valeurs et son horodatage après retrait des interceptions. L’arrêt du bootstrap libère sa pile jetable ; aucune donnée personnelle ou distante n’est nettoyée.

## Suivi des priorités restantes

| Priorité proposée | Signal source actuel | Prochaine preuve attendue |
| --- | --- | --- |
| P2 | Suggestions et projections reconstruites pour toutes les lignes pendant l’édition | Profil d’édition connectée au volume réel, assertions d’autosave et valeur exacte ; aucun gain revendiqué ici |
| P2 | Registre : lectures de l’affaire/synthèse répétées ; hub encore dépendant de l’analyse marge avant approbation et checks de sortie | Mesure par requête sur grosse affaire avant déduplication/parallélisation ; conserver fraîcheur et autorisations |
| P2 | Commandes : lecture sans pagination explicite, IDs des devis lus pour compter, actualisation toutes les 30 s | Inventaire réaliste, mesure backend/DOM, puis pagination et agrégation si le coût est confirmé |

Ces pistes sont issues du code, pas de lenteurs quantifiées dans cette campagne. Le faible volume de la pile locale ne permet pas de les classer devant les quatre défauts effectivement reproduits.

Ces trois pistes ont ensuite été mesurées et traitées à la demande « Corrige les tous » : voir le [rapport de suite avant/après](performance-dogfood-remaining-2026-10-19.md). Le gel réel du gros brouillon et la troncature/export des commandes y sont reclassés P1. Les premières mesures et leurs limites ci-dessus restent celles de la campagne initiale.
