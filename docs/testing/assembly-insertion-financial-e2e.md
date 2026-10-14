# Insertion de bibliothèque : pied financier immédiat

L'archive AT01 `2026-10-13T09-37-50-635Z` échoue avant insertion : le harnais
ajoute une ligne sous un lot optimiste `tmp:` avant sa confirmation. La ligne
est refusée avant sa RPC et disparaît ; la lecture ordinaire finale ne contient
que le lot, avec un pied nul. Ce défaut de création rapide est distinct du
finaliseur de bibliothèque. AT02 reste sans preuve.

Avant correctif, le scénario retient la vraie première requête POST items par
une barrière transparente, observe le lot affiché mais son ajout enfant
désactivé et aucune ligne créée, puis libère la requête. Il exige la réponse
201 et l'ID réel du lot avant le vrai ajout de ligne, puis la réponse 201 et
la parenté exacte avant saisie. Aucune réponse métier n'est fabriquée.
Les commandes d'ajout ligne et chapitre doivent aussi refuser un parent
temporaire avant toute création optimiste. Les actions desktop/mobile ne
deviennent disponibles qu'après confirmation. La saisie du titre du lot et
ses patches déjà mis en attente restent possibles. Ce contrat précède les
gardes produit ; le rouge existant prouve la disparition, sans qualifier une
barrière de transport ou l'insertion financière.

La campagne suivante `2026-10-13T09-55-07-857Z` passe AT01 et la création
contrôlée. AT02 confirme API/RLS/réponse 2925/585/3510 après insertion, mais
l'UI affiche 3050 HT : settings/savedSettings gardent l'ancien équivalent de
200 cents de la remise persistée de 1000 bp. La remise simple actuellement
stockée est proportionnelle ; son équivalent après insertion est 325 cents.
Le correctif resynchronise uniquement cet équivalent à partir du moteur et
du taux persisté, sans écriture réseau, sans changer l'oracle et sans écraser
des paramètres locaux non enregistrés ou une sauvegarde en cours. AT02 exige
avant reload le montant 3,25 dans le vrai paramétrage, puis les mêmes totaux
et allocations après reload/exports. Aucun montant fixe en euros persistant
n'est qualifié par ce contrat : un mode montant fixe explicite reste un écart
produit à réaliser, distinct de la correction de synchronisation.
La relecture structurelle lit version/items ensemble, refuse une réponse
d'une autre portée ou un jeton plus ancien, et applique le header canonique.
La baseline de remise utilise les taux/paliers relus et le même contexte MO.
Les champs live restent courants ; seul leur équivalent de remise encore
identique à l'ancienne baseline peut être resynchronisé. Les autres éditions
restent non enregistrées, et une remise explicitement changée reste visible.
Deux courses de transport sont définies avant code : fermer le picker pendant
la relecture retenue puis modifier le titre ou la remise ; libérer conserve
la saisie et Annuler les paramètres retrouve la baseline de 3,25. Leur présence
ici ne constitue aucune exécution concurrente.

La campagne `2026-10-13T10-11-33-864Z` passe Auth/AT01/AT02 et huit exports,
mais son reader est refusé : sa recherche par suffixe confond le témoin
`AT01-applied-reload` avec la capture `GC01-numeric-AT01-applied-reload`.
Les deux fichiers sont réels et distincts. Le reader suivant exige le nom
exact `fixturePrefix + label`, tel que produit par recordEvidence, et conserve
un résultat unique. Le reçu refusé et l'archive restent intacts ; cette
correction ne modifie ni le produit ni les oracles financiers.

Défaillances définies avant les nouveaux parcours, à partir du plan et des11cas
`.e2e/product-audit/assembly-totals-20261013-01/`. Le rouge NIall-01 conserve
une ligne1250/250/1500 et une version0/0/0 après POST200 ; NI02/NI03 ne sont pas
éprouvés dans cette archive. Son oracle immédiat reste inchangé.

Sélection préparée `assembly-totals`, dans la chaîne existante
`generated-components` : Auth + deux parcours distincts. Chaque campagne crée
de nouvelles fixtures GC01–04 ; AT01 et AT02 utilisent GC01 et GC02 séparément,
créent la bibliothèque par vraie revue/application UI puis une cible wizard
neuve. Aucun prix final, footer, rejet, application ou bibliothèque n'est semé.

| Parcours exact | Précondition UI | Oracle immédiatement après POST200 |
| --- | --- | --- |
| AT01 assembly insertion persists nonempty fixed footer before any save | Bibliothèque matériau12,50€ ; cible V2 ligne20€, q1, TVA20%, marge1, sans remise/arrondi. Sauvegarde du prérequis avant insertion seulement. | Ancienne ligne2000/400/2400 ; nouvelle1250/250/1500 ; pied3250/650/3900, mêmes ID/champs métier anciens. |
| AT02 assembly insertion persists V2 global discount allocation before any save | Même cible neuve indépendante ; Remise(EURHT)2€ sur la ligne20€, puis vraie sauvegarde du paramétrage ; vérifier `discount_bp=1000` et pied1800/360/2160 avant insertion. | Ancienne ligne1800/360/2160 ; nouvelle1125/225/1350 ; pied2925/585/3510 ; somme des allocations nettes V2 égale au pied. |

GET et lecture RLS ordinaire (lignes **et version**) suivent la réponse sans
Control+s, poll financier ou réparation. Vérifier le pied et les anciennes
allocations UI après le rechargement normal du contrôleur, puis vrai reload,
IDs/provenance bibliothèque exacts et absence d'un deuxième POST d'insertion.
Deux exports réels primaire et deux cible par cas : huit XLSX pour le GREEN,
avec cellules propres de chaque API et SHA. Aucun changement d'oracle NI/GC.

AT02 distingue le paramétrage du commit d'insertion : avant POST, exiger le
pied1800/360/2160 etdiscount_bp1000, ID/q1/prix brut2000/taxe2000 et concordance
API/RLS ; archiver l'allocation cache réellement observée de l'ancienne ligne.
La sauvegarde du seul paramétrage peut laisser sa ligne brute ; ne pas forcer
un Control+s correcteur ni exiger une allocation nette anticipée. Après POST,
les trois allocations nettes et le pied sont stricts, y compris UI/reload.

Le writer financier ne modifie ni description, quantité, prix brut, type,
affectation MO, provenance ni position. Les nouveaux items doivent pointer
exactement vers l'item de bibliothèque et sa provenance originale. La lecture
après succès doit aussi actualiser les allocations des anciens items.

## Frontières de preuve encore ouvertes

V1 neuf n'est pas sélectionnable par l'UI/schéma actuels : la création force
le moteur2. Le prérequis V1 vide de CA02 appartient à une autre chaîne et ne
sera pas réemployé implicitement. V1 reste contract/native jusqu'à un prérequis
neuf dédié relu. Les paliers, arrondis et reverse charge restent les cas du plan
financier/native ; ces deux parcours simples ne les qualifient pas.

Récupération partielle/inconnue : contrat public confirmé
`ESTIMATE_ASSEMBLY_INSERT_PERSISTED`, details `{versionId, insertedItemIds,
insertionState:"persisted", financialState:"not_committed"|"unknown",
retryInsertionAllowed:false}`. Une faute SQL réelle, bornée à la nouvelle
versionARMY, avec protocole/activation/retrait hashés, doit établir le rollback
du finaliseur après matérialisation. Une vraie perte de réponse du finaliseur
doit établir l'état unknown. Le client ferme le picker, affiche une erreur
persistante, relit sans history/undo de succès, bloque la duplication du même
ouvrage dans cette page et ne relance aucun POST d'insertion pendant récupération
ou reload. Aucun mock React, Response synthétique, ADTO injecté, abort avant
envoi présenté comme commit ni compensation destructive.

Tant que ces fautes et la barrière de transport ne sont pas prêtes, aucun
parcours recovery n'est enregistré ni qualifié : contrat préparé, exécution
manquante explicite. Les deux AT ne ferment pas ce besoin. Source/profile/build
doivent être régénérés après intégration, avec découverte exacte3résultats,
zéro model/retry/trace authentifiée et preuve de tous les huit exports.
