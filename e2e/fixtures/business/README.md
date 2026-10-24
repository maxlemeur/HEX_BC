# Corpus métier fictif public

Ce corpus remplace les documents métier privés dans les parcours par défaut. Les
désignations, références, fournisseurs, quantités, prix et heures sont inventés.
Il conserve les formats et les volumes utiles, sans prétendre rejouer les anciens
résultats sur les documents réels.

## Défaillances à empêcher, définies avant l'implémentation

- Un clone neuf ne trouve pas ses documents, ou utilise implicitement un corpus privé.
- Une fixture dite fictive recopie un nom, une valeur commerciale ou une métadonnée d'origine.
- L'export XLSX perd les valeurs calculées en cache, les en-têtes OPTIMA, les sections
  en gras, les sous-totaux intermédiaires ou la provenance des lignes.
- Le parcours est artificiellement réduit : l'hydraulique doit créer 2 031 éléments
  (2 030 entrées et la section d'import), avec 785 lignes chiffrées, 130 sections et
  79 statuts dont 46 sans quantité. La plomberie garde 656 lignes chiffrées,
  231 sections et 82 statuts dont 24 sans quantité.
- Le CSV change d'encodage ou de périmètre : Windows-1252, 539 lignes,
  127 candidates avec un prix fournisseur et 412 sans prix.
- Un oracle est recalculé par le générateur ou par le moteur qu'il doit contrôler.
- Une ancienne fixture de performance est réutilisée après changement de corpus.

Les parcours concernés sont IO01/IO02, IO03, V3E20, LEGCAT02 et la préparation
`editorDraftFixture`. Leurs assertions de persistance, contrôles de prix, statuts
et provenance restent actives. Sélection :
`npm run e2e:army:local -- --grep 'IO01|IO03|V3E20|LEGCAT02'`.

Exception d'isolation : `verify.ts` lit les véritables octets XLSX/CSV par les
parseurs de l'application, avant le navigateur. Il détecte une perte des caches
de formules ou des styles à l'export, un changement d'encodage et une donnée
non fictive avant tout téléversement. L'E2E constate leur effet, mais ne localise
pas cette frontière auteur/export/parseur ; ce contrôle n'en remplace aucun.
Le rouge initial lit les fichiers réels et exige le contrat fictif : il doit
échouer sans imprimer leurs cellules. Le vert lit les nouveaux fichiers publics.

## Oracles indépendants

Pour la ligne chiffrée d'indice `i`, à partir de zéro : `Q = 1 + i mod 5`,
`PR FO = (211 + 37 × (i mod 17))` centimes, `h/u = (1 + i mod 5) / 8`,
taux horaire 4 000 centimes. Ces règles sont inventées et ne lisent aucun fichier
privé. Les coefficients du classeur restent 1,30 / 1,30 pour exercer le profil
OPTIMA existant ; le second passage garde 1,30 / 1,20 et le coût 1 / 1.

Les attentes suivantes ont été calculées séparément, en rationnels entiers :
`Σ Q × demi_supérieur((13 × PR_FO + 13 × MO) / 10)`, puis coefficient MO 12/10,
puis `Σ Q × (PR_FO + MO)`. `MO = 500 × (1 + i mod 5)` centimes.
Elles sont des littéraux dans `corpus.ts` et `verify.ts`, jamais une sortie du
générateur ni un nouvel attendu construit par le moteur de production.

| Lot | HT classeur (c) | HT offre (c) | Coût (c) | Coefficient réalisé |
| --- | ---: | ---: | ---: | --- |
| Hydraulique fictive | 7 161 553 | 6 729 803 | 5 508 747 | 1.221658 |
| Plomberie fictive | 5 974 745 | 5 614 445 | 4 595 840 | 1.221636 |

TI-534 : une ligne v3 créée reçoit la provision FO de son type, 1,01 sans type ; les
lignes importées n'ont pas de type FO. Le chiffrage créé par IO01 et IO03 vaut donc la même
somme avec `PR_FO × 101/100` : `Σ Q × demi_supérieur((1313 × PR_FO + 1300 × MO) / 1000)`,
puis 1 200 pour le coefficient MO, puis `Σ Q × demi_supérieur((1010 × PR_FO + 1000 × MO) / 1000)`.
Ce sont les littéraux de `corpus.ts`. L'aperçu de l'import et `verify.ts` restent à la
provision 1 : ils contrôlent la lecture du classeur, pas le chiffrage créé.

| Lot (chiffrage créé, provision 1,01) | HT classeur (c) | HT offre (c) | Coût (c) | Coefficient réalisé |
| --- | ---: | ---: | ---: | --- |
| Hydraulique fictive | 7 176 891 | 6 745 141 | 5 520 631 | 1.221806 |
| Plomberie fictive | 5 987 528 | 5 627 228 | 4 605 747 | 1.221784 |

Chaque PU créé vaut le contrôle « Prix Unitaire » plus 1 % de la part FO de vente, à 1 c
près (deux arrondis au demi-centime). Les oracles du corpus privé datent d'avant TI-534 :
une campagne privée doit d'abord les rejouer avec les originaux.

La comparaison des contrôles du classeur avec chaque PU conserve notamment les
demi-centimes. Les prix sont fictifs aussi ; renommer les libellés des anciens
documents n'aurait pas satisfait ce contrat.

## Génération et vérification

`generate.mjs` utilise exclusivement `@oai/artifact-tool` pour écrire les XLSX,
avec le runtime documentaire fourni par Codex. Il ne lit aucun original.
`ARTIFACT_TOOL_NODE_MODULES` désigne le répertoire de paquets de ce runtime
(un lien `node_modules` dans un dossier temporaire convient). Aucun paquet
supplémentaire du dépôt n'est nécessaire pour exécuter les parcours : leurs
fixtures finales sont versionnées.

```sh
ARTIFACT_TOOL_NODE_MODULES=/path/to/runtime/node_modules /path/to/runtime/node generate.mjs
node --import tsx e2e/fixtures/business/verify.ts
```

Lancer le générateur depuis la racine du dépôt :
`.../node e2e/fixtures/business/generate.mjs`. Les données et formules générées
sont déterministes ; les identifiants internes du conteneur XLSX peuvent varier.
Les empreintes exactes des fichiers livrés restent épinglées pour les parcours.
Après une régénération intentionnelle, contrôler le résultat et actualiser ces
empreintes, sans recalculer les oracles numériques.

Le contrôle initial de l'export a reproduit une incompatibilité : l'exporteur
écrit les éléments SpreadsheetML avec le préfixe XML `x:`, alors que le lecteur
SAX d'ExcelJS installé attend leurs noms sans préfixe. Le parseur de valeurs
réussissait mais sa lecture des styles échouait, donnant zéro section au lieu
de 130. Le générateur normalise uniquement cette notation d'espace de noms
dans le conteneur exporté. Les cellules, formules, caches et styles restent
écrits par Artifact Tool ; le contrôle les relit avec les parseurs de l'application.

## Corpus privé explicite

Le défaut est `E2E_BUSINESS_CORPUS=public`. Le choix `private` exige
`E2E_BUSINESS_PRIVATE_ROOT`, racine contenant les anciens chemins `docs/prd_file`.
Un fichier absent, une sélection inconnue ou une racine non fournie fait échouer
le parcours ; aucun téléchargement, remplacement silencieux ou skip n'existe.
Les assertions utilisent les anciens oracles pour ce choix explicite et les
oracles fictifs pour le défaut. Les rapports identifient le corpus effectivement
utilisé. Les originaux conservés sous `.private/` restent locaux.

Le runner natif `e2e:army:local` transmet ces deux variables explicitement au
processus Node des parcours et à leur collecte, après son filtrage de
l'environnement. Elles ne sont pas transmises au backend, au build ni à
l'application navigateur. La sélection est aussi inscrite dans son manifeste.
Exemple de campagne privée, depuis une copie QA sans fichier `.env` :

```sh
E2E_BUSINESS_CORPUS=private E2E_BUSINESS_PRIVATE_ROOT=/absolute/private/originals npm run e2e:army:local -- --grep 'IO01|IO03|V3E20|LEGCAT02'
```

Les gardes du runner exigent toujours son backend éphémère possédé. Le wrapper
Army direct conserve également ces variables ; il vérifie l'hôte backend
autorisé avant toute exécution authentifiée. Le choix du corpus n'autorise
aucune nouvelle cible ni aucune publication des documents privés.
