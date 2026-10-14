# Préparation des achats : recette avant implémentation

Plan enregistré le 11 octobre 2026 pour SITE-01A. Les scénarios sont définis
avant le changement du contrat et de l'écriture produit. Ils complètent
[le cadrage métier](../product/purchase-preparation-next-slice.md) et ne
remplacent pas la recette existante d'applicabilité fournisseur.

## Défaillances à exposer

| Cas | Oracle observable |
| --- | --- |
| Aperçu A = 2 × 1 200, puis quantité passée à 3 par l'API du devis | L'ancien aperçu est refusé avec 409 ; aucun brouillon A ou B n'est créé. Le devis reste dans son nouvel état, sans retour silencieux à 2. |
| Même aperçu, puis coût négocié passé à 1 300 | Même refus sans brouillon ; le devis conserve 1 300 et le catalogue ne remplace pas ce coût. |
| Besoins déjà liés à des commandes envoyées, confirmées, reçues ou annulées | Les lignes ne redeviennent pas transférables ; une demande directe ne crée aucune commande supplémentaire. Le rattachement et son statut restent visibles. L'annulation ne déclenche aucune reprise automatique. |
| Préparation revue A = 2 × 1 200 et B = 3 × 777, TVA 20 % | Deux brouillons : A = 2 400 / 480 / 2 880 ; B = 2 331 / 466 / 2 797 ; total = 4 731 / 946 / 5 677 centimes HT / TVA / TTC. Prix catalogue 1 800 et 999 ignorés pour le coût négocié. |
| Double validation de la même intention ou réponse initiale perdue | Mêmes identifiants relus, deux commandes au total ; aucune duplication. La même clé avec une demande différente est refusée. |
| Deux intentions concurrentes sur les mêmes lignes | Un succès, un conflit explicite ; aucun transfert double. Des appels simultanés ne prouvent pas toutes les intercalations SQL. |
| Revue dans le panneau | Toutes les lignes et montants sont visibles ; confirmation humaine requise. Changer sélection, chantier, date ou note révoque la confirmation. |
| Échec après validation du panneau | Conserver l'intention et la demande revue ; une reprise retrouve son reçu. Recharger la page peut lire le reçu mais ne crée jamais automatiquement des commandes. |
| Préparation devenue obsolète dans le panneau | Le conflit impose un rechargement et une nouvelle revue avant création. |

La panne du deuxième fournisseur, les courses entre contrôle et insertion,
les permissions multi-tenant et le verrouillage nécessitent une recette SQL
native distincte. L'E2E ne prétendra pas établir ces invariants par un verdict
d'agent ou deux `fetch` simplement lancés ensemble.

## Environnement et fixtures

Le seed préparé dans `.e2e/purchase-preparation/seed.cjs` accepte un nom de
campagne neuf. Il refuse une campagne existante et tout backend autre que
l'origine HTTP `127.0.0.1` inscrite dans la fixture locale. Il utilise le compte
et le tenant locaux existants, sans changer leurs permissions. Son exécution
est séparée de la recette ; aucun client administrateur n'est présent dans le
test navigateur.

Chaque scénario possède une affaire, une version, deux fournisseurs, deux
articles, deux offres, un chantier et deux lignes nouvellement créés et
préfixés `ARMY-PURCHASE`. Les scénarios de statuts possèdent deux commandes
historiques locales. Le seed initial avant migration les créait directement
dans leur statut témoin. Le seed après migration connecte le compte local
existant par mot de passe, vérifie son identifiant puis crée chaque commande
et ses lignes au statut brouillon sous ses droits ordinaires. Il applique
ensuite au seul nouvel identifiant un UPDATE de statut isolé et relit le statut
obtenu ; cette séquence respecte la RLS qui interdit d'insérer des lignes dans
une commande non brouillon. Aucune session ni aucun jeton n'est enregistré dans
le reçu. Aucun envoi, transition de statut dans le navigateur ou engagement
externe n'est exécuté. Cette fixture prouve la préparation devant un état
persisté ; elle ne qualifie pas le mécanisme métier d'envoi ou de réception.

Les tests passent par la connexion UI ordinaire puis les APIs de l'application.
Le garde-fou réseau conserve l'interdiction des envois, approbations, mutations
de statut et communications externes. Il autorise seulement la lecture du
sélecteur de chantiers local en plus des APIs et de l'authentification.
Les traces authentifiées restent désactivées. Chaque campagne garde son
reçu de fixtures ; chaque scénario archive aperçu, demande, réponse, commandes
relues et devis avant/après dans les artefacts métier du runner.

## Première reproduction avant correction

Archive `.e2e/product-foundation/runs/2026-10-11T08-30-28-332Z` : connexion
ordinaire réussie, puis trois scénarios métier exécutés et en échec attendu.
Les sources sont restées stables pendant l'exécution. La quantité 2 → 3 et
le coût 1 200 → 1 300 ont chacun conduit à un HTTP 201 après le POST de la
préparation antérieure ; des commandes ont été créées sans nouvelle revue.
Les lignes déjà envoyées ont également produit deux nouveaux brouillons.
Les assertions du scénario portent sur HTTP, relecture des commandes et
conservation du devis ; elles ne se limitent pas à l'absence d'un nouveau champ.

Après archivage du contreexemple envoyé, seuls les deux nouveaux brouillons
créés par ce scénario ont été supprimés via l'API normale. La relecture des
commandes et lignes historiques est exactement égale à celle d'avant.
Ce nettoyage ciblé évite de laisser les doublons de la reproduction empêcher
la validation ultérieure de la migration ; il ne change pas le verdict rouge.

Le POST de reproduction inclut déjà la future structure `idempotency_key`,
`reviewed_lines` et `delivery_site_updated_at`. L'ancien schéma les ignore.
En absence d'empreinte dans l'ancien GET, le scénario envoie une sentinelle
explicite de 64 zéros, sans prétendre que l'ancien aperçu est signé. Les
recettes positives nouvelles exigent une véritable empreinte hexadécimale
distincte de cette sentinelle.

## Extensions écrites avant le nouveau code

Cas supplémentaire défini avant correction : un UUID PostgreSQL reste le même
identifiant lorsqu'il est écrit en majuscules, alors qu'une jointure JSON par
texte peut ne plus comparer la ligne revue et son empreinte. La régression SQL
doit refuser une empreinte obsolète même avec ces identifiants en majuscules.
Côté API, le scénario valide rejoue la même intention avec version, clé,
lignes, fournisseurs et chantiers en majuscules, empreintes inchangées : HTTP
200, `replayed:true`, identifiants de commandes inchangés. Le GET de reçu avec
version et clé en majuscules retrouve ce même reçu. Cette parité UUID ne
dispense jamais du contrôle d'empreinte ; sa reproduction native est distincte
de l'exécution navigateur à venir.

Le fichier TesterArmy ajoute les témoins `confirmed`, `received`, `canceled`,
un succès complet suivi du reçu et du replay, le conflit de clé réutilisée,
les deux appels concurrents pour une même intention, puis deux intentions
concurrentes pour les mêmes lignes. HTTP attendu : création 201, replay 200,
clé divergente 409 `ORDER_DRAFT_IDEMPOTENCY_CONFLICT`, besoin déjà transféré
409 `ORDER_DRAFT_ALREADY_EXISTS` et ancienne revue 409
`ORDER_DRAFT_PREPARATION_STALE`.

La recette UI exige la confirmation de revue, la révoque après modification
de note, puis interrompt uniquement le transport du premier POST après
réception de sa vraie réponse HTTP 201. Les commandes sont relues par API
avant reprise. Le panneau doit vérifier le reçu et récupérer les mêmes
identifiants sans deuxième POST ; une navigation fraîche relit encore le
reçu sans POST. Le test garde la liste observée des méthodes et chemins.
Le stockage local ne contient que `versionId` et `idempotencyKey`.

La première lecture du reçu reçoit volontairement un HTTP 200 dont le JSON
est tronqué, après observation de la vraie lecture réseau. Cette réponse ne
doit jamais être interprétée comme `{ok:true,data:null}` : message explicite,
création désactivée, bouton de vérification encore disponible et un seul POST
observé. Une deuxième lecture réelle retrouve le reçu. Cette perturbation
reste confinée au transport du navigateur de test.

Ces extensions ont ensuite été exécutées sur le nouveau contrat ; les preuves
et limites de cette recette figurent ci-dessous.

## Exception d'isolation : lecture incohérente pendant un GET

Défaillance définie avant modification du backend : les lectures de lignes et
comparaisons peuvent exposer l'ancien état, puis la RPC de revue peut lire un
nouveau montant, une autre quantité/TVA/unité, une désignation, un fournisseur,
une référence ou une sélection différents. Attacher l'empreinte du second état
aux valeurs affichées du premier permettrait de valider une décision jamais
relue. Une ligne disparue de la revue pose le même problème.

La régression isolée force séparément ces neuf changements et la disparition
entre les deux lectures d'un même appel GET. Elle exige un conflit 409
`ORDER_DRAFT_PREPARATION_STALE`, jamais un groupe incohérent doté d'une empreinte
récente. TesterArmy couvre le changement entre GET et POST, mais ne peut pas
ordonner ces deux lectures internes sans crochet de temporisation produit.
Cette isolation demeure donc justifiée en complément de l'E2E et de la preuve
SQL, sans prétendre remplacer leurs garanties.

Les douze cas existants de relecture d'éligibilité et un témoin de conservation
du coût négocié restent couverts. Les anciennes simulations d'INSERT séquentiel
et de rollback compensatoire sont retirées avec ce mécanisme, au profit des
assertions transactionnelles SQL et E2E réelles prévues ci-dessus. Le test de
route historique du parseur de date `TBD` conserve son oracle et reçoit les
nouveaux champs obligatoires ; aucun nouveau test de simple forwarding n'est
ajouté.

Première exécution isolée avant code backend :
`.e2e/purchase-preparation/atomic-review-red-vitest.json` : 25 tests exécutés,
14 réussis et 11 échecs attendus. Les dix cas de lecture incohérente renvoient
encore un aperçu au lieu du conflit ; le onzième échec est le schéma historique
qui retire les nouveaux champs du scénario `TBD`. Le reçu
`review-isolation-red-evidence.json` conserve commande, hashes et copies des
tests. Lint ciblé et typecheck passent à ce stade.

## Recette native et navigateur du candidat final

La suite isolée passe ensuite 25/25 ; les tests conservés du panneau et des
schémas passent 65/65. La [recette SQL](purchase-preparation-sql.md) réussit
39/39 cas sur le schéma installé, avec contrôle indépendant de l'annulation.

Le navigateur utilise Node 24.19.0, Chromium desktop, le build de production
local `2RwpHJFSrkdTzzAC_F6v8`, l'application `http://localhost:3117` et la pile
native `http://127.0.0.1:59827`. Connexion UI ordinaire, traces authentifiées
désactivées, fixtures ARMY neuves, aucun appel de modèle ni envoi fournisseur.

| Archive dans `.e2e/product-foundation/runs/` | Résultat exécuté |
| --- | --- |
| `2026-10-11T08-30-28-332Z` | Ancienne implémentation : connexion réussie et trois échecs métier attendus (quantité, coût, ligne envoyée). |
| `2026-10-11T08-54-16-513Z` | 11/12 réussis. Le test UI s'arrête avant POST : recherche du titre seul alors que le nom accessible contient titre et référence. |
| `2026-10-11T08-57-05-526Z` | **12/12 réussis**, zéro ignoré/flaky, sources stables, nouvelle campagne après correction du sélecteur de test. |

Les douze résultats incluent la connexion, les sept refus d'éligibilité et leur
témoin valide dans un parcours, puis dix scénarios de préparation. Les deux
fournisseurs produisent 47,31 € HT, 9,46 € TVA et 56,77 € TTC. Les achats relus
ne modifient pas le devis. Le reçu retrouve les mêmes commandes après retry,
y compris avec UUID majuscules. La perte de réponse après persistance, le GET
de reçu malformé, la reprise et le rechargement conservent **un seul POST**.
Les anciennes commandes envoyées, confirmées, reçues et annulées restent
identifiées et protégées contre un nouveau transfert.

Commande du GREEN, avec l'index de comparaison séparé documenté dans le
[journal](../product/progress-chiffrage-2026-10-11.md) :

```powershell
$env:GIT_INDEX_FILE = Join-Path (Get-Location) '.e2e/git-index-recovery/head.index'
$env:GIT_OPTIONAL_LOCKS = '0'
$env:E2E_PURCHASE_PREPARATION_FIXTURE_PATH = '.e2e/purchase-preparation/green-02/fixture.json'
$env:E2E_PURCHASE_DRAFT_FIXTURE_PATH = '.e2e/purchase-preparation/green-02/eligibility-fixture.json'
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs preparation orders --production
```

Une nouvelle recette nécessite une **nouvelle campagne** créée par `seed.cjs` :
les transferts persistés sont volontairement conservés et ne sont pas effacés
pour réutiliser les mêmes sources. Le seed n'utilise la clé locale privilégiée
que pour ses nouvelles données de référence ; ses commandes et lignes passent
par la connexion ordinaire du compte existant, sans modifier ses permissions.

Qualification reproductible :
`.e2e/purchase-preparation/qualifications/2026-10-11T08-57-05-526Z-4e40cc6e/qualification.json`.
Elle vérifie chaque artefact, le build, la migration installée, le résultat SQL
explicitement fourni et l'absence de secrets/JWT dans les textes retenus.
L'ancien manifeste nul `2026-10-11T03-32-46-410Z` reste inexploitable ; le
vérificateur global continue de le signaler. Aucun échec historique n'est
transformé en succès. Les intercalations avec verrous observés relèvent de la
preuve native concurrente distincte ; ces appels HTTP simultanés seuls ne les
établissent pas. Aucune mise en service partagée ni publication effectuée.

## Concurrence native à trois connexions

Archive : `.e2e/purchase-preparation/native-races-2026-10-11T08-58-50-718168Z/`.
Trois cas exécutés et réussis sur une campagne ARMY séparée :

- Même clé : B attend A, puis retrouve ses identifiants et montants exacts ;
  deux commandes, deux lignes, un reçu et deux réservations au total.
- Clés différentes : B attend A puis reçoit `ORDER_DRAFT_ALREADY_EXISTS` ;
  aucun reçu ni doublon pour la demande refusée.
- Offre modifiée : A change un minimum et garde sa transaction ouverte ;
  B attend le verrou produit puis refuse l'ancienne revue après commit de A.
  Aucune commande, ligne, réservation ou reçu pour cette création refusée.

Dans chaque cas, une connexion tierce observe `pg_blocking_pids` avec le PID
exact de A, pendant que B attend sur `transactionid`. Les snapshots avant/après
vérifient les totaux et sources. Les fixtures restent conservées ; aucune donnée
non ARMY n'est modifiée par ce harness. Les identités et rôles SQL simulés ne
remplacent pas la connexion ordinaire de la recette navigateur précédente.

Le manifeste et ses 60 artefacts ont été revérifiés indépendamment : SHA256
`d7e02fd6211aa9a3f3435a422cb43494d4fcd07d552cd303e23ceeb1d088413e`.
Le reçu `native-races-2026-10-11T08-58-50-718168Z-verification.json` rapporte
61 textes sans valeur des secrets configurés ni JWT. Script reproductible :
`.e2e/purchase-preparation/verify-concurrency.cjs`.

Ces trois intercalations ne sont ni une campagne de charge ni toute la matrice
de concurrence et de rôles. Le verrou de politique actuellement exclusif au
tenant sérialise aussi les créations indépendantes : un éventuel passage à un
verrou partagé doit être mesuré et préserver le blocage des changements de
politique, avec une nouvelle migration après cette activation locale.

## Régression après synchronisation de la préparation achats

La campagne `.e2e/product-foundation/runs/2026-10-11T10-37-49-236Z` conserve
**11/12 réussites et un échec**, sur le build `0G0T7qNlzYNMAcMgOI_EW`.
L’échec se situe après perte de la réponse réelle et lecture d’un reçu JSON
illisible : les commandes et montants persistés sont déjà vérifiés, mais le
test attendait encore un bouton « Créer 2 brouillons » désactivé.

La capture montre que l’état indisponible masque désormais le formulaire de
création et conserve « Vérifier et reprendre la préparation » actif. Cette
évolution prévue par la recette readiness rend l’ancien sélecteur obsolète.
L’assertion exige maintenant l’absence de toute action « Créer » dans le panneau
et la reprise active. Les vérifications d’un seul POST, de reçu identique, de
montants, de rechargement et de conservation des sources restent inchangées.
La campagne échouée est conservée ; cette correction de harness ne constitue
pas à elle seule une nouvelle réussite exécutée.

## Requalification complète après reprise Windows/WSL

Le run `.e2e/product-foundation/runs/2026-10-11T10-40-07-979Z` a été interrompu
sans rapport terminal ; il reste une preuve incomplète. Après reprise, Windows
réservait la plage TCP contenant le backend local 59827. Le backend existant a
été retrouvé sain et de même identité dans Ubuntu-24.04 ; aucun port, rôle,
secret, schéma ou réglage réseau global n’a été modifié pour contourner ce blocage.

La campagne neuve `readiness-regression-wsl-01` a ensuite exécuté
`orders preparation --production` sous Node 24.19.0 dans WSL. Son archive exacte
`.e2e/product-foundation/runs/2026-10-11T20-10-32-141Z` réussit **12/12 résultats**,
sans filtre, skip, flaky ni modèle, avec sources stables. Elle couvre la connexion,
l’éligibilité et les dix scénarios de préparation, dont reprise après réponse
perdue, reçu illisible, absence de second POST et rechargement sans recréation.
Les assertions de montants, de provenance et de conflits restent inchangées.

Le build demeure `0G0T7qNlzYNMAcMgOI_EW`, compilé sous Windows. Le manifeste
déclare distinctement `buildOriginPlatform=win32` et `executionPlatform=linux`.
Le wrapper résout en lecture seule son chemin Windows avec le préfixe exact du
dépôt, puis vérifie le reçu original, le journal et les SHA des sources/build.
Le CLI Next utilise sa résolution TypeScript native de Node uniquement dans
la configuration temporaire du runner. Aucun module natif applicatif ajouté.

Le smoke explicite `.e2e/purchase-readiness/runtime-wsl/runs/2026-10-11T20-09-21-345Z`
a réussi 2/2 avant le seed : connexion ordinaire, lecture API 200 et processus
navigateur réellement observé. Le SDK résout Playwright 1.63.0 et son Chromium
imbriqué **1243 / 153.0.8010.12**, confirmé par user-agent et `/proc/*/exe`.
Le premier smoke `20-07-59-988Z`, arrêté avant exécution pour configuration
non déterministe, reste archivé comme échec du harness.

Qualification :
`.e2e/purchase-preparation/qualifications/2026-10-11T20-10-32-141Z-da68a6f3/qualification.json`.
SHA-256 : `f8f4b8a57b94bc85e5ab81fe44e132c063f8d8c5f9274f6df1051b4d1eb7de78`.
Les 62 artefacts du run, les artefacts du smoke, les sources et le build ont été
vérifiés ; aucune valeur confidentielle configurée ni JWT détecté dans les
textes retenus. Le lecteur exige les douze titres exacts et l’absence de filtre.

Commande depuis la racine sous WSL, avec le Node 24.19.0 isolé :

```sh
node --env-file=.e2e/local-article/local.env .e2e/purchase-preparation/qualify.cjs .e2e/product-foundation/runs/2026-10-11T20-10-32-141Z --runtime-smoke .e2e/purchase-readiness/runtime-wsl/runs/2026-10-11T20-09-21-345Z
```

Les commandes de setup, smoke, seed et exécution sont conservées dans
`.e2e/purchase-readiness/runtime-wsl/README.md` et ses reçus. Les nouvelles
fixtures restent conservées et ne doivent pas être réutilisées pour créer
d’autres commandes. Cette réussite locale n’est ni un build Linux recompilé,
ni une qualification de performance Linux, ni une publication. Les preuves
SQL/concurrence précédentes restent distinctes ; aucune nouvelle exécution
native n’est revendiquée pour cette régression de l’interface readiness.
