# SITE-01B — Recette des quantités et de la provenance d’achat

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


Scénarios définis avant implémentation, le 11 octobre 2026. Le cadrage est
[purchase-decimal-quantities-next-slice.md](https://github.com/maxlemeur/HEX_BC/blob/9ee18ca8187d1e4f76e8b196be90d85e2fa1334b/docs/product/purchase-decimal-quantities-next-slice.md).

## Défaillances observables à reproduire

1. Sauvegarder uniquement la note d’un brouillon référencé peut remplacer l’ID
   de ligne et effacer sa référence, son produit et ses liens au devis/tarif.
2. Le formulaire tronque `12.5` et ramène `0.125` à un ; une saisie vide ou zéro
   ne doit pas devenir un. Une ligne invalide ne doit pas être omise d’un POST.
3. La préparation et la création manuelle refusent actuellement les quantités
   décimales. Chaque frontière doit conserver trois décimales au maximum.
4. Le HT doit être arrondi par ligne avant la TVA : les oracles en centimes
   sont `12.5 × 123 → 1538/308/1846`, `0.125 × 777 → 97/19/116`,
   `0.001 × 500 → 1/0/1`. Ensemble : `1636/327/1963`. Le POST manuel ajoute
   `0.145 × 100 → 15/3/18`, témoin contre l’arrondi flottant naïf qui donne
   14 centimes HT ; total manuel à quatre lignes : `1651/330/1981`.
5. Une sauvegarde concurrente doit être refusée par `expectedRevision` ; les
   IDs stables distinguent une correction d’une nouvelle ligne. La quantité
   ou le prix d’une ligne sourcée peut être corrigé avec audit, sans modifier
   son reçu initial, son origine ou son unité. Une nouvelle ligne exige une
   unité ; une unité historique absente peut rester absente sans invention.
6. La reprise SITE-01A après réponse perdue, puis GET illisible et rechargement,
   conserve le même reçu et ne crée aucun transfert supplémentaire.

## Recette primaire et limites du baseline

`e2e/army/local/purchase-decimals.e2e.ts` utilise TesterArmy, une connexion UI
ordinaire et les API applicatives. Les seules lectures directes Supabase
autorisées sont les quatre projections utilisées par le formulaire réel.
Le backend doit être exactement `http://127.0.0.1:59827`, traces désactivées,
sans envoi, changement de statut, rôle ou secret. Le seed local est une
préparation distincte, avec garde d’hôte stricte et uniquement de nouveaux
objets ARMY ; les lignes historiques d’achat sont insérées par l’utilisateur
ordinaire existant.

Le baseline possède cinq parcours : note seule via le formulaire réel,
quantités via le formulaire réel, préparation décimale puis création/rejeu,
POST manuel décimal et POST mixte valide/zéro. Les assertions exactes portent
sur les valeurs persistées ; le verdict d’un agent de navigation ne suffit pas.
Les preuves sont écrites avant les assertions de régression pour conserver
les résultats fautifs.

Au baseline, `GET /api/orders?view=items` ne projette que l’ID, la référence,
la quantité, le coût et le HT. La perte d’ID/référence est donc directement
observable. Le seed archive les champs de provenance initiaux ; une lecture
native complémentaire doit établir leur état après la sauvegarde. Les tests
post-correction exigent la projection complète, sans confondre son absence
avec une preuve de perte d’un champ. Aucun JWT n’est extrait du navigateur.

## Extensions définies avant modification du produit

- Saisie française `12,5`, `0,125`, puis point, relecture après sauvegarde ;
  zéro, négatif, vide, texte, quatre décimales et dépassement refusés sans
  modifier la valeur saisie ni créer une commande partielle.
- Préparation UI avec revue explicite, puis création décimale ; perte de la
  réponse réelle après persistance, GET de reçu malformé, reprise et reload
  sans POST supplémentaire. Devis source inchangé, fingerprints réels.
- Correction quantité/prix d’une ligne sourcée : IDs, origine, référence,
  produit et unité stables ; journal avant/après et révision incrémentée,
  reçu initial inchangé. Deux éditeurs sur la même révision : conflit du second.
- Consultation, impression HTML, export CSV et XLSX depuis l’UI, ZIP avec
  HTML : les trois quantités, unités, prix et totaux doivent correspondre au
  stockage. CSV réimportable ; cellules quantité XLSX numériques. Conserver
  les fichiers téléchargés et leurs hashes. Une page d’impression ne prouve
  pas la création d’un PDF.
- Conserver les preuves SITE-01A sur atomicité, droits, reprise et concurrence ;
  courses natives décimales et refus RPC dans la recette SQL dédiée. Le trajet
  import DPGF jusqu’à l’achat reste à qualifier séparément, pas implicite ici.

Les cinq scénarios sont maintenant enrichis : la note seule est suivie d’une
correction sourcée `2 × 1200 → 12,5 × 123`, d’une lecture d’historique dans
l’API et l’interface, puis d’un vrai conflit de révision produit par deux PUT
ordinaires intercalés. La seconde réponse 409 est transmise au formulaire réel,
qui doit bloquer la sauvegarde jusqu’au bouton « Recharger la commande ».
Ce scénario ne prétend pas remplacer les courses natives avec observateur.
Les saisies couvrent virgule et point, six valeurs invalides UI et neuf formes
invalides de quantité JSON. La préparation est créée depuis la revue UI ; sa
première réponse réelle est perdue après persistance, le premier GET de reçu
est illisible, puis reprise et reload ne doivent ajouter aucun POST. Le rejeu
API explicite supplémentaire est compté séparément. Le POST manuel fournit
l’achat témoin des téléchargements CSV/XLSX/ZIP et de la page d’impression.

## Baseline exécutée

Archive : `.e2e/product-foundation/runs/2026-10-11T09-16-38-025Z`, build
`2RwpHJFSrkdTzzAC_F6v8`, connexion ordinaire réussie puis **5 scénarios RED**.
Le formulaire a perdu ID/référence après modification de note, transformé
`12.5` en `12` et `0.125`/`0.001` en `1`. La préparation a renvoyé zéro ligne
éligible, le POST décimal HTTP400 et le POST mixte valide/zéro HTTP200 avec
une ligne omise. Les preuves métier enregistrent requêtes, réponses et états.
Le manifeste signale `source.changedDuringRun:true` : ce baseline n’est pas
une qualification de sources stables ; l’identité du build exécuté et le
diff des entrées doivent être rapprochés par le coordinateur. Les snapshots
originaux des cinq scénarios sont conservés dans cette archive, avant les
extensions ci-dessus. Cette archive établit les contre-exemples avant correction.

## Première campagne après correction — échec conservé

L’archive `.e2e/product-foundation/runs/2026-10-11T09-55-14-575Z` exécute
le build `WYlX0LYCgmE8VfIC3XwJS`, sources stables : **3/10 PASS**
(connexion, conservation et correction sourcée avec historique/conflit,
requêtes JSON invalides sans omission de ligne). Elle reste une campagne
échouée ; ses artefacts ne sont ni remplacés ni promus en réussite.

La lecture des écrans et fichiers distingue deux causes :

- Des erreurs de recette : chemin de téléchargement relatif à la tentative
  interprété comme relatif au dépôt ; sélecteur `status` ambigu entre chargement
  et compteur filtré ; texte d’alerte présent sur le parent et son enfant ;
  bouton recherché « Créer 1 brouillon » alors que l’interface propose
  « Créer le brouillon ». Le CSV réellement téléchargé conserve les quatre
  quantités et leurs centimes attendus, mais la suite des vérifications des
  exports n’a pas pu s’exécuter dans cette campagne.
- Une incohérence d’ergonomie : le bouton de sauvegarde restait actif avec une
  quantité invalide ou une unité historique non confirmée. Les erreurs étaient
  déjà affichées et le handler de soumission refusait ces données ; cette
  campagne n’établit aucune écriture corrompue par ce bouton. La correction
  produit désactive le bouton et rapproche le diagnostic de la première ligne
  invalide de l’action.

La recette corrigée relie chaque téléchargement au seul nouveau fichier créé
par cet appel dans le dossier exact de la campagne, puis enregistre chemin et
SHA. Aucun fichier d’une ancienne tentative n’est choisi. Les autres corrections
utilisent les rôles et noms accessibles observés. Les assertions de quantités,
centimes, identités, reprise et nombre de lignes restent inchangées.

La campagne suivante utilise `green-02` et la réserve historique `legacy-02`.
`green-01` et `legacy-01` sont consommés. Le résultat de cette nouvelle campagne
doit être vérifié avant toute qualification.

### Deuxième campagne : 5/10, puis diagnostic ciblé

L’archive `.e2e/product-foundation/runs/2026-10-11T10-06-07-380Z` exécute
le build `iQC_IGfiEMhX3ElSsUCpf`. Les cinq réussites incluent maintenant la
saisie et le refus des quantités invalides ainsi que la confirmation auditée
d’une unité historique. Les cinq échecs se produisent sur des sélecteurs :
« Préparation déjà enregistrée » est un texte, pas un titre HTML ; le texte
des régions `status` et `alert` apparaît dans le snapshot mais ne constitue
pas leur nom accessible DOM. Ces observations ne justifient aucun changement
du produit.

Après lecture du guide installé TesterArmy, les sélecteurs utilisent le rôle
sans nom puis `filter({ hasText })` ; l’alerte exige aussi `toHaveText` avec son
texte entier. Le reçu utilise `getByText` exact. Aucun premier élément arbitraire
n’est choisi. Les assertions de contenu, montants et absence d’écriture restent
identiques. `green-02` et `legacy-02` sont consommés.

Le diagnostic suivant a sélectionné la connexion et ces cinq parcours sur une
fixture neuve `selectors-01` ; les quatre parcours exclus ne constituent aucune
preuve supplémentaire. `legacy-03` reste non exécutée pour la future campagne
complète. Le wrapper archive le filtre et la commande exacte. Une campagne
filtrée, même réussie, est refusée par le lecteur de qualification complète.

Le diagnostic `.e2e/product-foundation/runs/2026-10-11T10-10-04-373Z`
conserve **6 sélectionnés, 5 réussis, 1 échec et 4 exclus**, avec sept vrais
téléchargements. Les exports de 1 200 lignes et leur cohérence concurrente,
la reprise de préparation et le refus des vues tronquées réussissent. L’unique
échec survient sur la désignation d’impression, dont le texte exact sélectionne
à la fois la cellule et son span. La recette utilise désormais la cellule
nommée ; les trois montants du récapitulatif restent des spans distincts avec
leurs assertions exactes. Une exécution ciblée connexion/création manuelle
doit confirmer ce dernier parcours avant la campagne complète.

Cette confirmation est archivée dans
`.e2e/product-foundation/runs/2026-10-11T10-11-47-250Z` : **2/2 sélectionnés
réussis, 8 exclus**, trois téléchargements et sources stables. Les quatre
quantités, centimes, unités et totaux sont vérifiés jusqu’à l’impression HTML.
Ce résultat ciblé ne qualifie toujours pas les dix parcours ensemble.

## Exécution et conservation

### Compléments définis avant correction de l’export

- Deux commandes ARMY distinctes de **600 lignes chacune** sont exportées
  ensemble depuis l’UI : **1 200 lignes** de données dans CSV et Articles XLSX,
  identités et sommes exactes. Une limite technique doit refuser explicitement
  l’export entier, jamais livrer silencieusement 1 000 lignes. Le scénario de
  réussite attendu pour ce volume reste un fichier complet de 1 200 lignes.
- Après chargement de la liste, une modification ordinaire change une ligne
  et le total d’une des deux commandes avant le téléchargement. L’export
  doit relire ensemble ses en-têtes et ses lignes : chaque total d’en-tête
  égale la somme des lignes exportées. L’ancienne liste sert uniquement à
  sélectionner les IDs ; elle ne fournit pas les montants du fichier.
- Une fixture ARMY créée **avant migration** porte une unité réellement NULL.
  Après migration, modification de note conserve NULL et l’identité. Changer
  quantité/prix exige une confirmation d’unité visible ; confirmer `m` conserve
  les sources, persiste quantité/unité/prix-unit, crée un audit avant NULL/après
  `m`, sans altérer le besoin source. Aucun ancien objet non ARMY n’est modifié.

Ces compléments sont écrits dans le fichier E2E : **8 scénarios métier**, soit
**9 tests avec la connexion**. Le seed principal ajoute les deux commandes de
600 lignes seulement après présence de la colonne d’unité, et vérifie leurs
comptes/totaux réels. Les fixtures `legacy-01`, `legacy-02`, `legacy-03` ont
été créées avant migration, avec `unitColumnPresent:false` dans leurs reçus.
Elles servent chacune une seule fois : confirmer l’unité consomme le témoin
historique. Les réserves ne sont pas des passes exécutées.

### Lecture de document dépassant la limite relationnelle — avant helper

Une commande ARMY dédiée contient **1 001 lignes**, insérées par le compte
ordinaire via le Data API local, quantités `1.001 m`, prix `1` centime, HT/TTC
de ligne `1`, TVA `0`. Elle porte une référence hors du filtre des deux commandes
de 600 lignes. Le seed vérifie le compte exact avec HEAD et les totaux `1001/0/1001`.

Le neuvième scénario métier exige que l’édition, le détail et l’impression
affichent « Lecture incomplète. Consultez l’export complet depuis la liste des
commandes. » au lieu d’un document tronqué ; aucun formulaire de sauvegarde ni
lien PDF n’est disponible. Le ZIP répond **409** avec le même diagnostic.
La projection JSON complète renvoie les 1 001 IDs avant/après : aucune ligne
disparue, aucun PUT. Avec la connexion, la campagne sélectionne **10 tests**.
Les exports JSON/CSV/XLSX complets des 1 200 lignes de deux commandes restent
qualifiés séparément ; ce refus concerne les vues relationnelles plafonnées.

Le garde prévu compte les lignes après la lecture jointe, puis relit la
révision **séquentiellement**. Une révision modifiée exige un rechargement ;
une troncature à révision inchangée indique l’export complet, car recharger ne
supprime pas la limite. Une course entre ces lectures demande la preuve native
ou d’isolation dédiée du coordinateur, pas une réussite déduite de ce scénario.

Créer une campagne neuve à chaque exécution (`green-01` seulement si ce dossier
n’existe pas encore). Exécuter sur le build correspondant aux sources contrôlées :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/purchase-decimals/seed.cjs green-01
$env:GIT_INDEX_FILE = 'C:/Users/maxim/Projects/miaouffrage/.e2e/git-index-recovery/head.index'
$env:GIT_OPTIONAL_LOCKS = '0'
$env:E2E_PURCHASE_DECIMALS_FIXTURE_PATH = '.e2e/purchase-decimals/green-01/fixture.json'
$env:E2E_PURCHASE_DECIMALS_LEGACY_FIXTURE_PATH = '.e2e/purchase-decimals/legacy-01/fixture.json'
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs decimals --production
```

Le wrapper appartient au coordinateur ; il enregistre commande, révision,
modifications locales, identité du build, environnement, sélection réelle,
rapport et preuves métier. Une campagne consommée ne sert jamais de fixture
neuve. Un setup échoué ou scénario non exécuté constitue une absence de preuve.

Le seed `baseline-01` est consommé : il contient trois lignes sources décimales
et deux brouillons entiers témoins désormais modifiés par les contre-exemples.
Le passage après correction exige une autre campagne.

## Qualification des preuves

Le lecteur local `.e2e/purchase-decimals/qualify.cjs` exige un dossier de campagne
terminal exact et un résultat SQL installé exact ; il ne choisit jamais le
dernier résultat vert et ne relance aucun test. Son plan détaillé est conservé
dans `.e2e/purchase-decimals/qualification-plan.md`. Il contrôle dix titres
exécutés et réussis, sources et build stables, fixtures, artefacts JSON et SHA,
sept téléchargements réels et leurs données, reçu d’application locale et
52 cas SQL. Les textes et archives sont scannés sans conserver de secret.
Les quatre courses natives sont une preuve distincte, incluse seulement par
un argument explicite. Chaque qualification écrit un dossier unique avec son
reçu et son SHA, sans écraser les échecs précédents.

```powershell
node --env-file=.e2e/local-article/local.env .e2e/purchase-decimals/qualify.cjs $runDirectory --native-green $nativeResult --native-races $nativeRacesDirectory
```

Le périmètre est local : impression HTML, pas génération de PDF ; refus des
vues tronquées à 1 001 lignes, pas édition complète au-delà du plafond. Aucun
déploiement, envoi fournisseur ou achèvement du goal global n’est déduit de ce
reçu.

### Campagne complète qualifiée

La campagne `.e2e/product-foundation/runs/2026-10-11T10-12-06-762Z`, fixtures
`green-03` et `legacy-03`, a exécuté **10/10 tests réussis**, sans filtre, skip
ou flaky, sur le build `iQC_IGfiEMhX3ElSsUCpf`. Les sources sont stables et les
sept téléchargements sont conservés. La qualification locale est enregistrée
dans `.e2e/purchase-decimals/qualifications/2026-10-11T10-12-06-762Z-62049f9b/qualification.json`,
SHA-256 `71f27dfee33ff2d9d69025c9bc876a0d28eb5ee721b79206b0344abcb3b61988`.

Le lecteur vérifie **93 artefacts E2E**, les lignes des sept fichiers réellement
téléchargés, les 52 noms de cas SQL installés et les quatre courses natives
explicitement fournies. Ces courses couvrent modification, insertion et
suppression après changement de statut, puis deux éditeurs sur l’ancienne
révision, avec observation du PID exact du bloqueur ; leurs 74 artefacts sont
contrôlés séparément. Le scan de qualification parcourt 97 fichiers texte,
68 entrées internes ZIP/XLSX et valide 59 JSON ; aucune valeur confidentielle
configurée ou JWT n’est détecté. La preuve des courses dispose aussi de son
scan distinct.

Le résultat installé des 52 cas est
`.e2e/purchase-decimals/2026-10-11T09-48-47-635877Z-regression-green.json`.
Son `cliExitCode:1` est le contrat explicite du rollback forcé par exception
`P9001`, avec `allPassed:true` et `rolledBack:true`. Le lecteur exige cette
description exacte, les 52 identités et le bloc SQL haché qui provoque le
rollback ; un code CLI 1 quelconque n’est pas accepté. Le premier passage du
lecteur avait supposé à tort un code 0 : son échec reste conservé dans le
dossier de qualification suffixé `bc0d25d9`, sans modifier le résultat SQL.

L’ancien manifeste global `2026-10-11T03-32-46-410Z`, composé d’octets nuls,
reste signalé comme illisible et hors de cette campagne. Aucun artefact ancien
n’a été réparé ni utilisé pour remplacer un résultat manquant. La réserve
`legacy-03` est désormais consommée. Les limites de périmètre ci-dessus restent
applicables, notamment l’impression HTML et l’absence de publication.
