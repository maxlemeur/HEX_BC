# Reprise des brouillons d’ouvrages — recette préalable

Scénarios définis avant implémentation dans
`.e2e/source-coverage/generated-resume-plan.md`, oracle chiffré dans
[source-coverage-oracle.md](source-coverage-oracle.md). Aucun scénario réussi
n’est déclaré par ce document initial.

La première baseline GR01 doit conserver le dialogue existant et échouer
précisément sur l’absence de « Reprendre un brouillon ». Le parcours complet
ferme puis recharge le devis avant reprise, valide réellement le sous-détail
et insère un parent unique : 10m, 4000c unitaire, 5h, KFO0,5/KMO1,
40000/8000/48000c. La graine n’insère aucune application, snapshot ou parent.

| Cas | Échec observable imposé |
| --- | --- |
| GR01 | Brouillon perdu après fermeture/reload, génération relancée, faux succès d’insertion, coût/provenance incorrects. |
| GR02 | Pagination20+1 tronquée, doublons sur date égale, témoin autre auteur/version/statut présent, curseur invalide accepté. |
| GR03 | Une vraie action rejouée avec draftId hors portée divulgue le brouillon ou écrit ; HTTP200 Flight seul ne prouve rien. |
| GR04 | Un candidat appliqué réellement une première fois redevient sélectionnable ou est dupliqué lors de la reprise partielle. |
| GR05 | Liste/reprise503 ou illisible présentée comme vide ; page2 échouée efface page1 ; réessai ne récupère pas les données réelles. |
| GR06 | Réponse différée affichée après fermeture ou sur une autre version ; dialogue rouvert automatiquement. |
| GR07 | Brouillon devenu non reprenable accepté après une liste périmée, droit/version/projet non revérifiés. |
| GR08 | Parent accepté avec unité m mais description/unité ou cellule DPGF vide après insertion/reload. Aucune réparation manuelle avant preuve. |

Les GR02..08 sont préparés avant code ; leur écriture détaillée et exécution
suivent la première reproduction bloquante. GR08 exige sa propre reproduction
après activation de la reprise, avant tout correctif d’unité.

Fixture : nouvel acteur et tenant locaux, unique rôle actif RMO4000c/h ;
versions sœurs moteur2/max_section_depth1 avec exactement SA/SB. Le sous-détail
est pending_review ; ses composants sont manual (valeur réelle de leur enum),
sans perte ni rendement : 10m×800c +10m×1200c +5h×4000c. Les témoins de liste
applied/discarded n’ont aucune application prétendument exécutée.

Le seed privilégié est limité à la préparation de ces nouvelles données.
Connexion et assertions utilisent le compte ordinaire et les actions réelles.
Pas de Gemini, d’envoi, de rôle existant modifié ni de backend distant.
Les traces authentifiées restent désactivées et les valeurs de credentials
sont conservées uniquement dans le profil ignoré local.env de la campagne.

Le runner doit archiver les vrais IDs d’actions (depuis le build sans sa clé
de chiffrement), leur résultat utilisateur et les snapshots API. Les cookies
et en-têtes d’authentification ne sont jamais capturés. La preuve de refus
Gemini côté serveur est distincte de l’allowlist navigateur.

## Baseline exécutée avant le code de reprise

Le run `.e2e/product-foundation/runs/2026-10-11T20-26-26-582Z` sur le build
Windows `0G0T7qNlzYNMAcMgOI_EW`, servi sous WSL Ubuntu-24.04, conserve une
connexion ordinaire réussie et **GR01 RED** : dans le dialogue « Générer des
ouvrages », `getByText("Reprendre un brouillon")` ne trouve aucun élément.
La surface réelle, la lecture API initiale et les identités de la fixture
`generated/baseline-01` sont archivées ; les sources sont stables et aucun
modèle n’est utilisé. Il ne s’agit pas encore d’une recette de reprise réussie.

Le premier essai `20-23-58-080Z` échouait avant cette assertion, car le helper
appelait une API sans avoir ouvert de page (`APP_NOT_OPEN`). Il est conservé
comme erreur de harness. L’inspection ordinaire
`generated/baseline-01/inspections/2026-10-11T20-26-15-081Z-after-setup-failure.json`
confirme zéro application, snapshot et parent sur chacune des sept versions
du propriétaire avant réutilisation de cette fixture intacte.

## Diagnostics intermédiaires conservés

Sur le build de reprise `aPFElvmd5CV1sQln_EwX9`, l’essai `20-32-32-032Z`
s’arrête avant serveur/tests avec `EPIPE` : WSL avait interprété le caractère
`|` du filtre comme opérateur shell. Les filtres simples sont ensuite passés
sans métacaractère. L’inspection ordinaire `intermediate-01/inspections/2026-10-11T20-34-07-025Z-after-pipe-setup-failure.json`
confirme l’absence de toute application ou ligne créée par cet essai.

Le run `20-34-09-248Z` réussit la connexion mais rencontre un verrou détenu
« par vous dans un autre onglet ou appareil », avant la reprise. Deux
`app.open` consécutifs sur la même URL produisaient deux navigations normales,
alors que le client ne restaure l’identité de verrou qu’au vrai rechargement.
Le helper navigue désormais seulement si l’URL diffère et utilise
`browser.reload()` pour la persistance. Le teardown appelle le DELETE normal
du verrou, avec l’identité réellement stockée par l’éditeur, seulement pour
la version courante appartenant à cette campagne ; aucun déverrouillage forcé.
Ces diagnostics ne sont pas transformés en défauts ou réussites métier.

Les runs `20-40-21-834Z` (GR01) et `20-43-27-380Z` (GR08), sur le même
build et des versions sœurs neuves, ont ensuite atteint la reprise et la
revue réelle à 40000c. Tous deux échouent à l’insertion : l’action serveur
ne transmet pas l’identité de session au contrôle canonique du verrou.
Le refus « Cette version est déjà verrouillée dans une autre page d’édition. »
est présent dans le journal serveur, y compris pour GR08 sans rechargement
préalable. Les inspections ordinaires après chaque essai confirment zéro
application, snapshot et parent. GR08 n’a donc encore prouvé aucun défaut
d’unité ; sa reproduction reste requise après la correction du verrou.

## Contrôle de session défini avant correction

Le même scénario de reprise doit éprouver les refus suivants avant tout
succès d’insertion. Les requêtes utilisent la session ordinaire et l’action
réellement exposée par le build ; aucune injection d’en-tête ne contourne
le comportement du produit.

| Identité ou état du verrou | Oracle observable |
| --- | --- |
| Identité absente | Refus explicite, aucun parent, section de secours, ouvrage canonique, application ou snapshot créé. |
| UUID de session erroné | Même refus et zéro effet, sans remplacer le verrou courant. |
| Verrou possédé par une autre page du même utilisateur | La propriété utilisateur seule ne suffit pas ; refus sans effet. |
| Verrou expiré ou libéré | Refus sans effet ; la prochaine acquisition ordinaire doit être requise. |
| Identité réelle de l’éditeur et verrou courant | La revue puis l’insertion UI réussissent avec les coûts et relations GR01 ; identité jamais journalisée. |
| Lot accepté absent du devis, si le parcours est praticable | Les refus précédents ne créent même pas la section de secours ; seule l’insertion autorisée peut la créer. |

Les cas expiré/libéré utilisent en priorité une libération ordinaire de la
fixture puis le rejeu de la demande devenue périmée. Une véritable expiration
temporelle n’est qualifiée que si elle est effectivement observée ; le cas
libéré n’est pas présenté comme cette preuve. Les IDs et compteurs avant/après
proviennent des lectures ordinaires, distinctes de la réponse HTTP/Flight.
Une absence d’effet ne se déduit jamais du seul message d’erreur.

## GR09 — fidélité des projections de coûts, défini avant correction

La réponse de l’insertion devient une enveloppe lisible `{ok,data}` ou
`{ok:false,error:{code,message}}`. Les refus de session sont donc désormais
attendus sous HTTP200 : identité absente `VALIDATION_ERROR`, erronée ou
autre page `CONFLICT`, verrou libéré `LOCK_REQUIRED`. Les contrôles zéro
effet restent identiques ; une réponse HTTP200 seule ne vaut pas réussite.

La matrice suivante possède de nouvelles versions ARMY, des composants
préparés mais toujours `pending_review`, puis une revue UI réelle. Les
deux projections, parent et bibliothèque, doivent préserver séparément
coût et heures ; aucun coût déplacé entre fourniture et main-d’œuvre.

| Cas | Oracle avant/après insertion |
| --- | --- |
| Base | Trois composants existants, DS40000c, H5 ; bibliothèque40000, parent40000/8000/48000. |
| Perte fourniture exacte | Seul composant10×800c avec500bp donne8400c, parent1, H0. |
| Rendement MO exact | Seul composant4m×4000c, parent10m, rendement0,5h/m : DS16000c/H5. Canonique conserve quantité4, unitém, coûtunitaire4000, h_mo5 et k_mo0,800. |
| Perte canonique non représentable | 10×800c avec1bp donne8001c ; parent1. Refus `EST383_COST_PROJECTION_INEXACT` avant toute création. |
| Parent non représentable | 1h×3333c, parent1, rôle4000c/h : un coefficient0,833 donnerait3332c. Refus explicite, jamais approximation silencieuse. |
| Lot mixte | Premier candidat exact, second non représentable : refus de tout le lot, zéro section de secours, parent, ouvrage canonique, application et snapshot. |

Les refus conservent les candidats disponibles et le sous-détail revu ;
la lecture RLS ordinaire compare les IDs avant/après. Le succès de base
reste aussi couvert par GR01 ; GR09 vérifie la bibliothèque et les cas
de perte/rendement qui manquaient à la première recette.

Le préflight refuse aussi un résumé de coût revu incohérent avec ses composants,
une quantité ou une durée non représentable dans le stockage courant, et un
déplacement de coût entre FO et MO. Aucun résumé périmé ne doit être copié dans
un nouvel instantané. La qualification exécutée doit distinguer les fautes
effectivement injectées de ces contrôles supplémentaires relus dans le code.

Les lectures post-parcours passent par `inspect-generated.cjs` avec la
connexion ordinaire du nouvel acteur. `verify-generated-state.cjs` vérifie
ensuite le fichier explicitement fourni : vraies relations application /
snapshot / parent / candidat / ouvrage canonique, composants, mapping et
trace des heures. Aucun de ces lecteurs ne crée une application ou un snapshot.

## Verrou de session : défaut reproduit et correction prévue

GR01 puis GR08 sur le build `aPFElvmd5CV1sQln_EwX9` arrivent à la revue réelle
du sous-détail de 40000c mais échouent à l'insertion : « Cette version est déjà
verrouillée dans une autre page d'édition. » GR08 ne recharge pas la page avant
l'insertion, ce qui exclut le rechargement comme cause unique. Les inspections
ordinaires après ces essais confirment zéro application, snapshot et ligne.
L'unité et l'export restent non qualifiés à ce stade.

Avant cette correction, les défaillances à couvrir sont :

- Une session absente, malformée ou appartenant à une autre page du même
  utilisateur est acceptée par l'action : rejouer la véritable action avec ces
  variantes, attendre son résultat métier et vérifier zéro effet persistant.
- Un verrou absent, expiré ou détenu par un autre utilisateur permet une
  insertion : vérifier le refus contre l'état réel de la fixture locale, sans
  déduire une session valide depuis la base ni forcer un déverrouillage.
- La session correcte atteint la ligne mais pas la création de la section
  « À classer » : exercer aussi l'insertion sans lot explicite.
- Le correctif modifie le contrôle des mutations HTTP existantes : conserver
  leurs régressions de verrou et leur résolution par en-tête.

Le correctif transmettra l'identifiant déjà détenu par l'éditeur dans l'action,
puis à la garde canonique et aux deux créations possibles. La garde comparera
toujours utilisateur, tenant, version, expiration et session en base. Une
valeur explicite invalide ne doit jamais retomber sur l'en-tête HTTP. Cette
correction ne rend pas l'ensemble transactionnel et ne qualifie pas les autres
actions d'ouvrages, dont la garde historique vérifie seulement l'utilisateur.

Les six fixtures et deux attentes des tests de domaine existants ont été
adaptées avant le code : `session-contract-before-local.log` conserve huit
réussites et deux échecs sur la transmission encore absente. Aucun nouveau test
unitaire n'a été ajouté. Le premier essai sandbox, bloqué avant tout test par
EPERM dans le cache, est conservé séparément.

## Fixtures nominales avant la garde de coût

Les tests isolés existants utilisaient un sous-détail de 4650c dont les
coefficients n'étaient pas représentables en base. Le diagnostic natif
`reference-native/rollup-readonly-diagnostic.md` établit un résultat stocké de
4689c, soit +39c. Ce cas historique reste conservé dans les preuves ; les
refus de précision deviennent des assertions primaires de GR09.

Avant d'implémenter cette garde, les fixtures nominales des dix tests de
domaine ont été rendues représentables : 81000c de fourniture et 81000c de
MO, 54h et quantité parent120 ; le cas de quantité manuelle conserve ses 36h
et 54000c de MO, distincts du rendement. Leurs attentes de rollback, revue
périmée, classement et trace des heures restent en place. Les résumés sont
cohérents avec les composants. `cost-fixtures-before.log` conserve **10/10**
avant le code de projection. Aucun test unitaire supplémentaire n'est ajouté.

## Sauvegarde des totaux — diagnostic et correction du parcours de recette

Le run complet `2026-10-11T21-19-27-132Z` conserve six succès et quatre échecs.
Les parcours GR01/04/08 avaient bien créé leurs lignes, unités, applications,
instantanés et coûts de bibliothèque ; le header de version était encore à
zéro. Le helper de rechargement acceptait cependant l'avertissement de
modifications non sauvegardées. L'action structurelle programme séparément la
sauvegarde des totaux, avec une cadence automatique d'une minute. Ce run ne
démontrait donc pas un échec de cette sauvegarde normale. L'autre échec, GR09,
capturait une réponse GET/RSC au lieu de la réponse POST de l'action : le
nouvel observateur filtre méthode, chemin et véritable identité d'action,
sans modifier la requête ou le retour reçu par l'interface.

La sonde `2026-10-11T21-28-57-826Z`, fixture neuve `generated/autosave-01`, passe
deux épreuves sélectionnées (connexion et GR01), avec huit exclusions explicites.
Sur le même build `ZJ3H586wCVCjxOVUQ10zH`, sans changement produit :

- À 21:30:47 UTC, statut « En attente » et header 0/0/0.
- À 21:31:48 UTC, statut « Sauvegardé », vrai POST `/items/bulk` réussi et
  header 40000/8000/48000 centimes, sans raccourci ni requête de réparation.
- Le vrai rechargement change `performance.timeOrigin`, ne rencontre aucun
  avertissement `beforeunload` et conserve les valeurs attendues.

La campagne complète suivante garde GR01 en sauvegarde automatique réelle.
Les autres scénarios peuvent enregistrer via le raccourci normal de l'éditeur,
puis exigent statut confirmé et lecture API exacte avant le rechargement.
Un avertissement inattendu est refusé et fait échouer le test. Les assertions
financières restent identiques. La sonde ne vaut pas qualification des dix
épreuves ; aucune ancienne archive n'est réécrite en succès.

La fermeture forcée avant sauvegarde constitue un parcours de récupération
distinct, encore non qualifié : le besoin de sauvegarder seulement les totaux
est actuellement volatil, alors que les lignes sont déjà persistées. Voir
CORE-06 ; les montants des listes et fiches affaires doivent être inclus dans
cette future preuve, sans modifier les versions déjà figées.

## Enregistrement immédiat — nouveau défaut observé avant correction

La campagne `2026-10-11T21-32-56-750Z` expose dans GR04 un défaut distinct de
l'abandon précoce : le raccourci normal déclenche bien un POST `/items/bulk`
réussi, l'interface affiche « Sauvegardé » puis « À jour », mais les totaux
persistés restent 0/0/0 pendant les trente secondes observées. Les lignes
insérées valent 40000c HT. Cette sauvegarde confirmée incohérente doit être
corrigée ; remplacer le raccourci ou attendre la minute suivante ne constitue
pas une réparation.

Défaillances et critères définis avant le correctif :

- Enregistrer immédiatement après insertion/fermeture pendant le rechargement
  de l'éditeur ne doit pas accepter un total client antérieur aux lignes
  persistées. GR04 garde ce déclenchement immédiat et les totaux exacts après
  sauvegarde puis vrai rechargement.
- Le serveur doit utiliser le moteur canonique de la version brouillon,
  toutes ses lignes (lecture paginée), ses remises, marges, TVA et arrondi.
  La révision attendue et le verrou courant restent requis ; une révision
  concurrente ne doit pas être écrasée.
- L'ordre de répartition des centimes doit être celui de la publication,
  position puis identifiant, y compris à travers les pages de lecture. Témoin
  distinct : deux lignes à 3c HT, A position1 avec TVA20% et B position2 sans
  TVA, identifiants inversés, remise de 1c (1667bp sur 6c). Le résultat attendu
  est 5c HT, 0c TVA, 5c TTC ; trier B avant A attribue le centime à la mauvaise
  ligne et produit 1c de TVA. Vérifier la sauvegarde UI et sa lecture persistée.
  Une mutation groupée inversant les positions doit ensuite calculer l'état
  proposé B puis A, soit 5/1/6c, plutôt que conserver l'ordre avant mutation.
- Le client doit recevoir et conserver les totaux effectivement écrits, pas
  réappliquer sa proposition périmée après une réponse réussie. Une réponse
  contenant des totaux invalides ne devient pas un statut « Sauvegardé ».
- Les parcours GR01, GR08 et les six cas GR09 conservent leurs valeurs,
  unités, heures, absence de doublons et refus avant création. Les offres
  figées et le moteur historique ne sont pas recalculés par ce correctif.

La régression primaire est ce parcours réel ; aucun test unitaire ajouté
après implémentation. Les suites existantes du calcul, de la sauvegarde,
du client et du contrat HTTP restent à exécuter selon les fichiers touchés.

## Export remisé — défaut reproduit avant correction

Le témoin distinct d'ordre `2026-10-11T21-48-59-396Z` atteint une sauvegarde
UI puis une lecture API et un rechargement conformes à 5/0/5c. Le fichier
Excel réellement téléchargé contient pourtant 6/1/7c et « Remise 0.00 € ».
Son SHA256 est `2a009ac4a377c8d89d5bb47b3a7f200044670dada58d1f87eed4b3f3c0d32ffb`.
La campagne conserve connexion réussie et scénario échoué ; la mutation
inversant les positions n'est pas encore atteinte. Les mauvais libellés du
test sont corrigés séparément, sans changer les valeurs attendues.

Défaillance : après sauvegarde V2, les lignes stockent déjà leurs montants
nets. Reconstituer la remise par différence entre ces lignes et le total net
de version donne zéro, puis l'export recalcule à tort le brut sans remise.
Le brouillon V2 doit calculer sa remise depuis les coûts, réglages et taux
canoniques, dans le même ordre position/ID que la sauvegarde. Le témoin doit
retrouver 5/0/5c dans Excel puis 5/1/6c après inversion. Les snapshots V2 frais
ou finalisés continuent à rejouer leurs valeurs figées ; le chemin historique
V1 reste inchangé. Les régressions d'export existantes sont conservées.

### Preuves conservées de sauvegarde

- La sonde `2026-10-11T21-28-57-826Z` passe ses **2 résultats sélectionnés**
  (authentification et GR01), avec huit exclusions. La vraie sauvegarde
  automatique passe d'« En attente » à « Sauvegardé » après environ une minute,
  avec POST réussi et API `40000/8000/48000`, puis rechargement sans abandon.
  Elle ne qualifie pas les huit parcours exclus.
- Le full10 `2026-10-11T21-32-56-750Z` reste **7 PASS / 3 FAIL**, sans dérive
  des sources. GR04, GR08 et le premier cas GR09 échouent après Ctrl+S malgré
  POST200/ok et statut de succès ; l'API reste `0/0/0`. Les cinq cas suivants
  de la matrice GR09 ne sont pas exécutés. Aucun de ces échecs n'est remplacé
  par le succès de la sonde automatique.
- L'inspection ordinaire `generated/complete-02/inspections/2026-10-11T21-41-30-204Z-after-immediate-save-failure.json`
  et le reçu dérivé `immediate-save-counterexample.json` conservent les vraies
  relations et les valeurs nulles des totaux. Le reçu porte le SHA-256
  `dc1e24744b94e6dad57e7cca6a4edebcc2f5de40e058f114213b85afe7ef6a8c`.
  L'ancien observateur n'enregistrait ni payload ni heure précise du POST :
  ces données sont déclarées absentes, jamais reconstituées. Les campagnes
  suivantes observent seulement les trois champs numériques de totaux et
  les heures de requête/réponse, sans corps brut, token ou session.

Le témoin d'ordre est un scope séparé `totals-order`, avec
`E2E_TOTALS_ORDER_FIXTURE_PATH` obligatoire et un seed neuf
`.e2e/source-coverage/seed-totals-order.cjs`. A commence à 2c dans le seed ;
l'UI la modifie à 3c puis enregistre immédiatement. L'API et le vrai fichier
Excel doivent donner `5/0/5c`. Une seconde étape, explicitement HTTP ordinaire,
inverse les positions des deux mêmes IDs en envoyant les anciens totaux ;
la réponse, la lecture après reload et un second Excel doivent donner
`5/1/6c`. Aucun total attendu n'est inséré par le seed. `order-01` est conservé
comme préparation échouée SQL23514 (champs de montants de ligne requis omis) ;
`order-02` est la nouvelle fixture corrigée, sans réutilisation des identités.

La faute de réponse `totals:null` reste définie mais non exécutée à ce stade.
Le parcours d'ordre ne prouve pas encore le refus UI de cette réponse altérée.

Le diagnostic GR04 `2026-10-11T21-46-42-128Z` est **2/2 sélectionnés PASS**,
huit exclus, sources stables, build `2vSsBnSz_Yr2wkIPwl17Z`. Il observe un POST
envoyant réellement `0/0/0`, une réponse canonique `40000/8000/48000`, puis un
second POST envoyant ces anciens totaux et recevant `80000/16000/96000`.
Les lectures après sauvegarde et rechargement concordent ; aucune attente
supplémentaire n'a remplacé le déclenchement immédiat de Ctrl+S.

Le diagnostic d'ordre `2026-10-11T21-48-59-396Z` reste **1/2 PASS**, sans dérive.
Sauvegarde UI, API et reload donnent bien `5/0/5c`, mais le vrai Excel donne
`6/1/7c` et indique une remise de `0.00 €`. Son SHA-256 est
`2a009ac4a377c8d89d5bb47b3a7f200044670dada58d1f87eed4b3f3c0d32ffb` ; les cellules
complètes sont conservées sous `totals-order/order-02/exact-export-cells.json`.
Le test comportait aussi deux libellés réservés aux arrondis commerciaux :
cette erreur d'oracle est corrigée vers « Total TTC », mais les valeurs
financières restent inchangées. L'inversion HTTP des positions n'a pas encore
été atteinte. Le témoin neuf `order-03` est préparé pour la prochaine recette.

La recette `2026-10-11T21-55-45-276Z` sur `order-03` confirme ensuite le vrai
Excel `5/0/5c` (SHA-256 `0714c09f87481fe60464127eac75103ad44246534e85f2e4406e1ecfcf59070a`),
mais reste **1/2 PASS** : l'inversion HTTP envoyait une position0, refusée
par le schéma existant `positiveIntegerSchema`. Ce sous-cas demeure manquant.
La fixture neuve `order-04` emploie A1/B2 puis A2/B1 ; seuls les indices sont
translatés, l'ordre et l'oracle financier sont identiques. Le corps complet
a été confronté au schéma de la route avant rejouer, et sa réponse sûre
(statut, code, totaux) est désormais conservée avant toute assertion.

Le scope indépendant d'ordre est ensuite **GREEN 2/2 sans filtre**, archive
`2026-10-11T21-58-32-074Z`, fixture `order-04`, build
`7EFvayztCREQ0rva9cT0d`, sources stables et deux téléchargements. La saisie et
la sauvegarde passent par l'UI ; les valeurs sont vérifiées via API avant/après
reload et dans Excel (pas par une assertion visuelle du pied de page).
Le second sous-cas HTTP obtient bien `5/1/6c` après fusion des positions.
La qualification en lecture seule est
`.e2e/source-coverage/qualifications/totals-order-2026-10-11T21-58-32-074Z-a1fcbfa5/qualification.json`,
SHA-256 `ed042f7aec971fb6c44ed7dcf1de3e9102c56f17c85bdd3ff71a1f4bdc714551`.
Tous les contrôles de résultats, source/build, inventaire/hashes, cellules
financières et secrets/JWT passent. Cette preuve locale conserve explicitement
la frontière build Windows/exécution Linux ; elle ne qualifie pas les dix
parcours d'ouvrages ni une publication.

### Campagne complète qualifiée

La campagne `2026-10-11T22-00-41-793Z` est **10/10 PASS**, sans filtre, skip,
flaky ni modèle, sur le build `7EFvayztCREQ0rva9cT0d` et la fixture neuve
`generated/complete-03`. Les sources restent stables. GR01 observe la vraie
sauvegarde automatique ; GR04/GR08 et les trois projections acceptées GR09
utilisent Ctrl+S immédiatement, avec réponse canonique, API et reload exacts.
Les six cas GR09 sont réellement exécutés : base, pertes, rendement et trois
refus sans création de parent/application/snapshot/ouvrage canonique. Après
chaque refus, l'éditeur sauvegarde automatiquement ses totaux inchangés à zéro
avant reload ; cette sauvegarde est distinguée de la requête d'insertion refusée.
Le DPGF téléchargé vérifie l'unité `m` de la vraie ligne par son AID.

L'inspection ordinaire postérieure au terminal est
`generated/complete-03/inspections/2026-10-11T22-08-39-825Z-after-full10-green.json`
(SHA-256 `ada369948cb6bb02577079ccb3f24720287990cf87ba9d9e0ec97afdc7424713`).
La vérification indépendante des relations et totaux, notamment deux applications
distinctes pour la reprise partielle, passe sans défaut.
Le reçu final est
`.e2e/source-coverage/qualifications/2026-10-11T22-00-41-793Z-b6b48235/qualification.json`,
SHA-256 `4bf9c9ffaeda99c50097c8e3f964136280c694eb0550e7eb09bf94f7b1df1fc1`.
Il valide les résultats nommés, hashes/inventaire, build, confidentialité,
relations persistées, scénarios financiers et le trafic serveur loopback.

Les limites restent explicites : build Windows exécuté sous Linux local,
aucune publication ni génération IA, expiration naturelle du verrou non testée,
réponse tardive livrée après fermeture mais avant navigation vers V2,
transition non-draft et panne `totals:null` non qualifiées. Le test distinct
d'accès archivage/rôle est intégré seulement après cette qualification et
dispose de son propre run ; il ne réécrit ni ce reçu ni les anciennes archives.

### Extension d’accès qualifiée séparément

Le run `2026-10-11T22-10-45-175Z` est **2/2 PASS** sans filtre, skip, flaky ni
modèle, sources stables et même build. Les deux nouveaux admins de `access-01`
sont les seuls acteurs mutés. L’archivage réel d’un projet provoque les refus
`CONFLICT` de liste/reprise ; l’auto-dégradation finale du propriétaire en
viewer provoque `FORBIDDEN`. Le second admin relit indépendamment le rôle et
l’état métier : deux sections, candidats pending, sous-détails pending_review,
zéro application, snapshot et ouvrage canonique avant/après les refus.

Qualification :
`.e2e/source-coverage/qualifications/access-2026-10-11T22-10-45-175Z-f12bc426/qualification.json`,
SHA-256 `03f0d228b3827c7d229647be9ef2fd66fdef9ebd96917b2f70df08ef3d02ee65`.
Les données et rôles historiques restent hors campagne. L’archive du projet
et le nouveau rôle viewer sont conservés comme preuve ; aucun reset. Le cas
READ_ONLY d’une version non-draft demeure explicitement non qualifié.
