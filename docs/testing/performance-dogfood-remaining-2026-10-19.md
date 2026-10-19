# Suite du dogfooding performance — 19 octobre 2026

Les trois chantiers restants du [premier rapport](performance-dogfood-2026-10-19.md) sont corrigés localement. Le principal défaut supplémentaire est un gel de plusieurs secondes à chaque édition d'un gros brouillon. Les quatre premières corrections sont conservées et leur défilement desktop/mobile est reconfirmé.

## Priorités et avant/après

| Priorité finale | Défaut et volume réel | Avant | Après |
| --- | --- | --- | --- |
| P1 | Édition du brouillon OPTIMA complet, 2 031 items, 80 règles | Saisie → affichage : médiane **3 398,5 ms** ; sauvegarde explicite : **7 050,8 ms** | **140,3 ms** et **778,2 ms** ; ordre/scores des suggestions, quantités et montants exacts conservés |
| P1 | Travail bloquant pendant ces éditions | Plus longue tâche : **1 768 ms** ; blocage cumulé médian : **6 471 ms** par édition/sauvegarde | **83 ms** maximum ; **42 ms** de blocage cumulé médian. Des tâches >50 ms subsistent |
| P1 | Commandes : inventaire tronqué et export bloqué | **1 000/1 005** commandes retournées ; export **HTTP 431**, URL contenant 1 000 IDs | Page de **50** commandes, toutes les **1 005** accessibles ; CSV avec **1 005 références et lignes métier exactes**, montants compris |
| P2 | Charge initiale et lectures périodiques des commandes | Réponse liste + référentiels : **705 534 octets** ; polling toutes les 30 s dans le code | Page : **25 885 octets** ; référentiels complets séparés : **186 258 octets**, chargés une fois. Ensemble : **212 143 octets**, soit environ **70 %** de moins. **0** lecture supplémentaire pendant **31 001,85 ms** observées |
| P2 | Dépendances série de l'affaire et du registre | Clic → titre peint médian **364,7 ms**, 5 transitions | **379,6 ms** : pas de gain de temps local démontré. Lectures indépendantes parallélisées, contexte autorisé réutilisé ; aucun cache ajouté |

Les sept recherches du brouillon étaient déjà fluides : **29,0 → 28,5 ms** de médiane, sans longue tâche. Aucun gain de recherche n'est revendiqué. La confirmation finale retrouve **150,8 ms** pour la saisie, **792,6 ms** pour la sauvegarde et **28,2 ms** pour la recherche ; ces séries restent séparées du comparatif initial.

Les mesures de l'affaire confirment que Next dédupliquait déjà les lectures identiques : synthèse GATE **1 → 1** et contrôle d'accès registre **1 → 1** par transition. Le nombre total de lectures terminées dans la fenêtre reste proche de 78–89. Les requêtes par lots portant sur des IDs différents ne sont pas des doublons. Il n'y a aucune preuve de baisse des allers-retours réseau dans cette campagne.

## Échecs définis avant implémentation

| Domaine | Échec à prévenir | Parcours et oracle |
| --- | --- | --- |
| Suggestions et projections | Normalisation/distances et objets de toutes les lignes reconstruits à chaque frappe ; cache périmé | Import réel OPTIMA, sept éditions/sauvegardes, sept recherches, scores/ordre exacts, reload et toutes les valeurs numériques conservées |
| Affaire | Marge qui retarde l'approbation ; accès répétés ; données périmées entre requêtes | Affaire locale de 1 000 lignes, cinq transitions, sonde serveur, montants exacts, registre modifié puis restauré, refus anonyme |
| Commandes | Inventaire et compte des devis tronqués, DOM sans borne, filtre limité à la page, export partiel | 1 005 commandes, 3 012 métadonnées de devis, 1 001 fournisseurs et 1 001 chantiers ; page 21, tri/recherche/filtres globaux, CSV exact et fenêtre d'inactivité |
| Marge v3 | L'optimisation perd l'avis moteur 3 quand aucune analyse n'est calculable | Historique v2 chiffré, version courante v3 vierge, mode Expert, avis V2 exact, 0 centime, historique conservé et contexte anonyme séparé |

Le [plan affaire](dogfood-affaire-remaining-failures.md) détaille notamment la dépendance d'écriture de la projection d'approbation. L'isolation `suggestion-scoring-cache.test.ts` a été écrite et exécutée rouge avant l'implémentation : le navigateur ne permet pas d'attendre les seuils de récence de 8/31 jours. Les deux nouvelles régressions deviennent vertes avec les 12 tests Node existants de scoring/bulk.

## Corrections applicatives

- Éditeur : mots-clés préparés par snapshot de règles, cache borné à 4 096 titres et limites indépendantes, invalidation par règles/apprentissage et expiration aux seuils exacts de récence. La borne de distance élimine uniquement des comparaisons mathématiquement incapables d'améliorer le score. Le filtre d'éligibilité bulk reste avant le top 5.
- Calcul : partage des lignes dont les champs dérivés sont identiques, réutilisation du total déjà calculé uniquement quand les paramètres courants et sauvegardés sont le même objet. Aucun moteur, arrondi ou montant contractuel n'est modifié.
- Affaire : marge indépendante du chargement principal ; approbation après succès de ce chargement, puis relecture fraîche de la version et checks de sortie. Le registre partage son contexte déjà autorisé et parallélise page, focus, synthèse et événements. La carte reçoit toujours l'avis v3 complet.
- Commandes : pagination 50/100, tri et filtres serveur, ordre stable avec ID, comptes des devis sans téléchargement de leurs IDs, référentiels complets séparés et retrait du polling. Le rafraîchissement manuel et celui de la liste au focus/reconnexion restent disponibles.
- Export : sélection complète issue des filtres, URL courte, snapshots transactionnels en lots de 100 commandes, contrôle des révisions et de la sélection finale. Le plafond de 10 000 lignes produit une erreur explicite plutôt qu'un fichier partiel. `view=list` conserve un inventaire complet pour les consommateurs existants ; OpenAPI est synchronisé.

Le compte PostgREST historique `purchase_order_devis(count)` est vérifié sur le backend local **avec agrégats désactivés** : compte 3 et compte 0 exacts. `count()` échoue bien avec PGRST123. Aucune nouvelle configuration distante ni migration n'est requise. La preuve et les références primaires sont dans `orders/count-compatibility.json`.

## Identité et limites des preuves

- Checkout `main`, HEAD **e4258aab5a971b1c43b163b19dd89ba738497cbf**, modifications locales conservées. Aucun commit, push, PR, déploiement ni changement distant.
- Avant : build **G0B0uoZFd19oXZ3rP9pCQ**, comprenant les quatre corrections de la première campagne. Après : **Y9UcY-O_VU2G4U2-lUTZ3**. Les manifests de build et de chaque exécution retenue attestent des sources/builds inchangés pendant leur exécution.
- Node **24.19.0**, macOS arm64, e2e **0.21.2**, moteur web **0.15.2**, un worker, aucune requête modèle. La compilation de production isolée et ses budgets passent.
- Brouillon réel : projet `3e11fa86-2b97-444a-99e2-7a39512bf217`, version `1c8c009d-ce4b-46c0-8b5f-90ac1e8e1367`. Totaux HT/TVA/TTC en centimes : **164 420 761 / 32 884 152 / 197 304 913**, conservés après chaque sauvegarde et reload. Le SHA-256 du classeur source est conservé dans le receipt.
- Backend natif jetable propre à cette invocation, compte et tenant locaux dédiés. Seules ses fixtures sont créées ou modifiées ; politique temporaire refermée à 2. La visite d'une affaire peut écrire sa propre projection d'approbation et ses événements. Le test de marge passe ce profil jetable en mode Expert ; sa confirmation fonctionnelle reste séparée des séries temporelles comparables précédentes.
- Viewports navigateur desktop et mobile pour la grille ; autres nouveaux parcours sur desktop. CPU/réseau locaux, sans ralentissement artificiel : aucune qualification de téléphone physique, de Web Vitals terrain ou de budget SQL WSL.
- La mesure d'édition termine après deux frames ; la sauvegarde mesurée est **Ctrl+S explicite**. La cadence automatique produit de 60 s reste intacte. Les tâches comptées couvrent l'intervalle édition/sauvegarde, pas seulement l'input.
- La sonde serveur conserve méthode, chemin, filtres d'identité et colonnes, statut et temps jusqu'aux en-têtes. Aucun corps, en-tête d'authentification ni texte de recherche. La journalisation synchrone ajoute un petit coût commun aux deux candidats.
- Les devis joints sont des métadonnées de fixture : aucun téléchargement Storage de ces PDF n'est qualifié. La concurrence pendant l'export est contrôlée par le code et les spécialistes existants ; ce parcours ne provoque pas de mutation concurrente.

## Exécutions et vérification

Preuves durables locales : `.e2e/army/dogfood-remaining-20261019/`. `comparison.json` contient les séries et identités ; `integrity.json` vérifie les hashes des rapports, médias métier et logs copiés. Les archives originales ne sont pas réécrites.

| Exécution | Résultat et utilisation |
| --- | --- |
| `17-07-18-880Z` | Affaire avant : **3/3**, même fixture et valeurs exactes |
| `17-07-39-004Z` | Commandes avant : **1/2**, défauts reproduits dont inventaire tronqué et HTTP 431 |
| `17-13-53-421Z` | Éditeur avant calibré : **2/2**, sept éditions et sept recherches |
| `17-18-11-330Z` | Premier après : **5/7**. Les parcours éditeur/affaire/catalogue passent et fournissent le comparatif ; deux erreurs de harnais ne sont pas des passes |
| `17-20-34-783Z` | Correction ciblée : **1/3**, assertions CSV exactes passées avant erreur de fenêtre SDK ; run global conservé en échec |
| `17-22-54-242Z` | **Confirmation complète 8/8**, export exact, inactivité, marge v3 et isolation anonyme |
| `17-24-27-275Z` | **Grille 4/4**, deux logins et deux viewports, dernière ligne accessible et source réelle inchangée |

Toutes les dates ci-dessus sont le 19 octobre 2026 UTC, préfixées `2026-10-19T` dans `runs/`. Aucun retry n'a été ajouté.

Les échecs de préparation sont conservés : chaînage de locator non disponible dans le SDK ; première sonde de sauvegarde qui attendait 30 s malgré la cadence produit de 60 s ; sonde intermédiaire incluant les 3 s du badge « Sauvegardé ». La référence calibrée emploie la même sonde que l'après. Les autres corrections concernent le chemin confiné du téléchargement (racine performance), la fenêtre d'inactivité de 31 s déplacée côté Node, les préconditions du hub Expert et la séparation des contextes anonymes pour éviter le passage par `/` lors de `clearState`. Aucun garde n'a été assoupli.

`npm run verify:pr` sur le code applicatif final passe : audit sans avis bloquant, budgets d'architecture, OpenAPI, types, lint, **3 284 tests Node**, **820 jsdom**, **12 tests de couverture des frontières**. Les **3 tests Node déjà ignorés** restent visibles. Les dernières corrections de harnais reçoivent séparément typecheck et lint. La revue indépendante a couvert les trois lots ; un P2 sur l'avis v3 a été corrigé puis revu et vérifié par le nouveau parcours.

## Commandes de reproduction

Le bootstrap conservé sous `bootstrap-source.mts` emploie `runLocalSupabaseCi`. Dans la copie de campagne, il réside en `.e2e/dogfood-remaining-session.mts`. Pour une nouvelle pile, utiliser un dossier de contrôle neuf, conserver les anciens receipts ailleurs et préparer le tenant local avec un nom préfixé **ARMY** avant les fixtures (la campagne l'a fait une fois explicitement). Ne jamais réutiliser la configuration d'une pile arrêtée, ni imprimer/copier son fichier privé.

```sh
# Depuis une copie isolée du candidat, Node 24 dans PATH.
node --import tsx .e2e/dogfood-remaining-session.mts
# Autre terminal, une fois la configuration privée prête :
node --env-file=/private/tmp/mergeone-dogfood-remaining-control/local.env scripts/tester-army/build-local.mjs --execute
node --env-file=/private/tmp/mergeone-dogfood-remaining-control/local.env scripts/run-tester-army.mjs performance --target chromium-desktop --grep 'remaining affaire performance|dogfood remaining|dogfood editor draft|dogfood directories'
node --env-file=/private/tmp/mergeone-dogfood-remaining-control/local.env scripts/run-tester-army.mjs performance-grid
npm run verify:pr
```

Les receipts ne sont réutilisables qu'avec leur pile et leurs identités exactes. Le manifest générique performance conserve une ancienne description « read-only » : les écritures réellement autorisées de ces nouveaux parcours sont précisément celles décrites ci-dessus et dans les sources de fixtures. L'arrêt du bootstrap détruit uniquement sa pile jetable et supprime sa configuration secrète ; son contrôle final est conservé dans `cleanup.json`.
