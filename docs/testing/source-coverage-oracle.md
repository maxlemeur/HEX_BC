# DOS-CAL-01 — Oracle technique de couverture calorifuge

Établi le 11 octobre 2026 **avant implémentation et avant exécution** à partir
du [contrat produit](../product/source-coverage-contract.md). Ce document
définit les résultats attendus ; il ne constate aucun scénario passé.
Le fichier était absent à l'inspection initiale. Aucun PDF, seed, schéma ou
code applicatif n'est créé par cette préparation.

Les prescriptions, quantités, prix et heures ci-dessous sont **synthétiques**.
Les 5 heures de pose sont une entrée de test, pas un rendement professionnel,
une norme ou une estimation validée. La confirmation de citation simulée par
un compte de test prouvera un parcours humain possible ; elle ne sera jamais
présentée comme une validation du corpus par un chiffreur. Les objectifs de
temps gagné, d'omissions et de fausses alertes du goal restent à mesurer sur
un corpus métier distinct.

## Contrats réels à réutiliser

| État à établir | Point d'entrée vérifié dans le checkout | Limite à conserver dans la preuve |
| --- | --- | --- |
| Affaire, version, sections et lignes | `POST /api/estimates`, `POST /api/estimates/{versionId}/items`, modification canonique des lignes ; [server.ts](../../src/lib/estimates/server.ts), fonctions `createEstimateItem` et `getEstimateVersionDetails`. | Les nouvelles versions utilisent le moteur 2. Ne pas forcer le moteur 1 pour simplifier cet oracle. Conserver la session de verrou de brouillon entre requêtes. |
| PDF intake A et B | `POST /api/affaires/{projectId}/intake/files`, `createAffaireIntakeUpload`, puis `reclassifyAffaireDocument` dans [intake-server.ts](../../src/lib/affaires/intake-server.ts) et ses [actions](../../src/app/dashboard/affaires/_actions/intake.ts). | Upload/classification/principal ne valent pas référence de revue ni citation vérifiée. L'upload peut déclencher un traitement : isoler le profil de test et contrôler les sorties réseau. |
| Ouvrage réellement appliqué | Actions [generated-ouvrages.ts](../../src/app/dashboard/affaires/_actions/generated-ouvrages.ts) : `fetchGeneratedOuvrageSubdetailDraft`, `updateGeneratedOuvrageSubdetailDraft`, `insertGeneratedOuvrages` ; implémentation [métier](../../src/lib/estimates/generated-ouvrages.ts). | Le sous-détail doit être `reviewed`, le candidat `pending`, la quantité et les valeurs acceptées doivent correspondre à la revue. Les actions contrôlent le verrou du devis. |
| Preuve de composant appliqué | `estimate_generated_ouvrage_applications`, `estimate_generated_ouvrage_work_snapshots.components`, puis `enrichEstimateItemsWithGeneratedOuvrageProvenance` dans [generated-ouvrage-provenance.ts](../../src/lib/estimates/generated-ouvrage-provenance.ts). | Le `componentId` est dans le JSON du snapshot ; ce n'est pas l'identité de la ligne mutable `estimate_assembly_items`. Conserver `application_id`, `snapshot_id`, `componentId`, parent courant et faits revus. |
| Hypothèse et pièce manquante | `createAffaireRegisterEntryAction`, `updateAffaireRegisterEntryStatusAction`, actions de suivi/revalidation dans [register.ts](../../src/app/dashboard/affaires/_actions/register.ts), fonctions de [register-server.ts](../../src/lib/affaires/register-server.ts). | Types actuels `assumption` et `missing_piece` ; périmètres `project`, `lot`, `line`, `exception`. Aucun `scopeId` n'est implicitement une zone ou un réseau. La création et son événement sont encore deux appels ; les modifications de statut utilisent leur mutation atomique existante. |
| Calcul et exports | [estimate-calculations.ts](../../src/lib/estimate-calculations.ts), [export-stream.ts](../../src/lib/estimates/export-stream.ts), [dpgf-export.ts](../../src/lib/estimates/dpgf-export.ts), `GET /api/estimates/{versionId}/export?format=xlsx&mode=standard` ou `mode=dpgf`. | L'export DPGF de travail contient déjà coefficients et heures. Il ne constitue pas une DPGF commerciale indépendante. Aucun motif de revue, extrait de CCTP ou sous-détail nouveau ne doit y être ajouté. |

Les scénarios TesterArmy [generated-review.e2e.ts](../../e2e/army/takeoff/generated-review.e2e.ts)
reprennent les parcours de rejet, revue/application et provenance des anciens
spécialistes. Leurs [prérequis locaux](generated-review-prerequisites.md) restent
des propositions non revues ; les décisions passent par l'interface réelle.
Le [suivi de migration](army-migration.md) distingue les recettes des preuves
exécutées. Ces scénarios ne constituent pas un oracle calorifuge à valeurs fixes
déjà exécuté, ni une qualification du fournisseur de génération.
Le seed local ignoré `.e2e/product-foundation/seed-brief.cjs` montre les
identités upload/document et le stockage privé ; son fichier texte associé
à un brief ne prouve ni PDF ni passage vérifié. Le futur seed doit être neuf,
porter son propre reçu et ne jamais réutiliser cette fixture consommée.

## Identités et préconditions de campagne

Chaque campagne possède un préfixe `ARMY-COVERAGE-{runId}`, de nouveaux UUID
et un manifeste qui relie les alias ci-dessous aux identités réelles.
Les opérations destructives ou concurrentes utilisent des campagnes sœurs,
pas une remise à zéro silencieuse de la campagne principale.

- `P`, `V` : une affaire non archivée, sa version de travail brouillon,
  `calc_engine_version=2`, EUR, marge fixe 1, coefficient global 1,
  remise 0, TVA 2 000 points de base, arrondi commercial `none`, pas
  d'autoliquidation. Aucun snapshot financier figé courant dans ce profil.
  Fixer explicitement `version.max_section_depth=1` dans le payload de
  `POST /api/estimates`, puis relire cette valeur. Le schéma de création
  [schemas.ts](../../src/lib/estimates/schemas.ts) accepte les entiers de
  1 à 4, bornes définies dans [hierarchy.ts](../../src/lib/estimates/hierarchy.ts) ;
  le défaut actuel est 3 et ne convient pas à cet arbre de fixture.
  Créer SA et SB à la racine, puis placer les quatre lignes directement
  sous ces deux sections. S0 exige exactement ces deux sections, sans
  section intermédiaire ajoutée par le placement d'ouvrage.
- `ZA/RA` : **zone A — chaufferie / réseau CH-A** ; `ZB/RB` :
  **zone B — étage / réseau ECS-B**. Ce sont les identités de périmètre
  proposées pour la nouvelle capacité. Aucune identité canonique de
  zone/réseau n'a été retrouvée dans les modules affaires/devis inspectés.
  Les sections `SA` et `SB` servent au rangement, sans créer ce périmètre.
- `RMO` : rôle de fixture actif « ARMY pose », tarif 4 000 centimes/heure.
  Toutes les lignes utilisent ce rôle, avec majoration 1 et sans payload
  atelier/chantier. L'application d'ouvrage choisit actuellement le premier
  rôle actif du propriétaire par `position` : vérifier l'identité réellement
  choisie. Provisionner un nouvel utilisateur et un nouveau tenant de
  fixture dans le runtime isolé, avec leurs propres rôles ; RMO est son
  unique rôle actif au moment de l'application. Aucun rôle existant d'un
  autre utilisateur ou tenant n'est modifié.
- Login ordinaire et tenant actif, hôtes locaux exacts autorisés, traces
  authentifiées désactivées. Garder les mots de passe, clés et jetons hors
  manifestes et journaux. Le provisionnement local de fixtures est distinct
  des actions E2E ; aucune écriture privilégiée ne valide un droit utilisateur.

La couverture aura besoin de ses nouvelles identités de revue, références,
exigences, liens et décisions. Le seed ne doit pas insérer des décisions
finales à la place du parcours testé. Ne pas inventer aujourd'hui des noms
de routes ou de RPC qui n'existent pas encore.

## Deux PDF de référence et leurs citations

Préparer ultérieurement deux PDF texte de **trois pages physiques**, sous le
même nom de fichier `ARMY-CCTP-calorifuge.pdf`, avec contenus et SHA-256
différents. Page 1 : titre et mention « corpus synthétique de qualification ».
Page physique 2 porte le folio imprimé `CVC-10`, page physique 3 le folio
`CVC-11`. Les pages stockées par le métier sont 1-based ; une API PDF 0-based
doit être convertie explicitement. La page 4 et la page 0 sont invalides.

| Clause | Page physique / folio | Texte exact à écrire dans A |
| --- | --- | --- |
| C1 | 2 / CVC-10 | « Pour cet exercice, les réseaux CH-A en zone A et ECS-B en zone B reçoivent un calorifuge de 30 mm. » |
| C2 | 2 / CVC-10 | « En zone A, les parties droites et leurs deux raccords reçoivent une protection extérieure. » |
| C3 | 2 / CVC-10 | « En zone A, les deux raccords sont traités avec une finition démontable. » |
| C4 | 3 / CVC-11 | « Le diagnostic amiante de la zone A est exclu du présent lot dans cet exercice. » |
| C5 | 3 / CVC-11 | « Le traçage électrique du réseau ECS-B relève du lot Électricité. » |
| C6 | 3 / CVC-11 | « Les traversées de la zone B seront précisées par le détail D-B encore attendu. » |
| C7 | 3 / CVC-11 | « Les accès de pose en zone B restent à confirmer avant fixation du traitement des traversées. » |

Dans B, remplacer **C1 uniquement** par : « Pour cet exercice, le réseau
CH-A en zone A reçoit un calorifuge de 40 mm ; le réseau ECS-B en zone B
reste à 30 mm. » Les autres clauses et pages restent identiques. B est
identifié « révision B » sur la page 1. L'épaisseur n'est pas une exigence
normative ; son changement sert à révéler une référence ou citation périmée.

Le reçu ultérieur conservera chemins locaux, taille, nombre de pages,
empreinte des octets et texte par page. Il ne contiendra aucun hash fictif.
Après choix de A, ouvrir **la copie conservée par la revue**, vérifier son
hash et le passage attendu, puis utiliser le contrôle de confirmation de
citation. L'auteur enregistré est le compte de test. L'extrait saisi seul
ne prouve rien. L'ouverture de l'original intake ne satisfait pas ce parcours.

Un test frère remplace les octets de l'original intake par ceux de B en
gardant son identité et son nom : l'ouverture de la référence A doit encore
retourner les octets A. La suppression de la copie conservée produit un état
« source indisponible » et interdit la confirmation ; aucun repli vers B.

## Chiffrage de référence indépendant de la couverture

Toutes les heures sont **totales pour la ligne**, pas multipliées à nouveau
par sa quantité. Tous les composants ont `status=manual`, perte 0 et
`yieldValue=yieldUnit=null`. Les montants suivants sont en centimes.

### Ouvrage appliqué L1, sous SA

Parent « ARMY Réseau CH-A avec calorifuge », quantité 10 m.

| Composant du sous-détail | Type | Quantité / unité | Coût unitaire | Déboursé |
| --- | --- | --- | ---: | ---: |
| C-ISO « ARMY calorifuge 30 mm CH-A » | material | 10 m | 800 | 8 000 |
| C-TUBE « ARMY canalisation CH-A » | material | 10 m | 1 200 | 12 000 |
| C-POSE « ARMY pose réseau CH-A » | labor | 5 h | 4 000 | 20 000 |
| **Total de l'ouvrage appliqué** | | | | **40 000** |

La revue/application réelle doit produire exactement : 3 composants,
`summary.dsCents=40000`, prix cible indicatif 40000, mapping
`legacy_labor_allocated`, `unitPriceHtCents=4000`, `hMo=5`, `kFo=0.5`,
`kMo=1`, `nonLaborDsCents=20000`, `laborDsCents=20000`, `totalDsCents=40000`.
La trace de C-POSE porte `derivedHours=5`, `hoursSource=quantity`.
L'inclusion E1 ci-dessous désigne **C-ISO dans le snapshot appliqué**.

Attention préalable visible dans le code : `insertGeneratedOuvrages`
transmet l'unité dans le payload appliqué, mais son appel à
`createEstimateItem` ne transmet pas `description`, champ exporté comme
unité. Vérifier le résultat réel. S'il manque `m`, conserver ce constat et
compléter l'unité par l'éditeur normal **avant** l'état S0. Ne pas maquiller
le seed comme une preuve de conservation automatique de l'unité.
Cette saisie rend la fixture de couverture utilisable, mais **ne résout pas
le défaut produit probable**. Avant tout correctif, écrire puis exécuter une
reproduction UI/API : saisir `m` dans la revue d'ouvrage, appliquer, lire
la ligne et son unité après rechargement, puis contrôler la cellule Unité
du vrai export DPGF. Conserver les valeurs acceptées, le payload appliqué
et la ligne obtenue. Le défaut reste ouvert jusqu'à reproduction et
correction vérifiée par ce parcours ; la préparation manuelle de S0 ne
compte jamais comme preuve de résolution.

### Les quatre lignes au point S0

Nature `supply_and_labor`, rôle RMO, K MO et majoration 1 pour toutes.

| Ligne / section | Désignation | Q / unité | Prix FO brut unitaire | K FO | Heures | FO après K | MO | HT | TVA | TTC | PU commercial HT |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L1 / SA | ARMY Réseau CH-A avec calorifuge | 10 m | 4 000 | 0,5 | 5 | 20 000 | 20 000 | 40 000 | 8 000 | 48 000 | 4 000 |
| L2 / SA | ARMY Protection parties droites CH-A | 4 m | 1 000 | 1 | 1 | 4 000 | 4 000 | 8 000 | 1 600 | 9 600 | 2 000 |
| L3 / SA | ARMY Protection démontable des raccords CH-A | 2 u | 1 500 | 1 | 0,5 | 3 000 | 2 000 | 5 000 | 1 000 | 6 000 | 2 500 |
| L4 / SB | ARMY Canalisation ECS-B sans calorifuge | 6 m | 2 000 | 1 | 1,5 | 12 000 | 6 000 | 18 000 | 3 600 | 21 600 | 3 000 |
| **Total** | | | | | **8** | **39 000** | **32 000** | **71 000** | **14 200** | **85 200** | |

Il existe exactement **2 sections et 4 lignes**, SA contient L1/L2/L3,
SB contient L4. Ne jamais ajouter une ligne de calorifuge B pour faire
disparaître son exigence non arbitrée. Aucune quantité financière n'est
affectée automatiquement à une zone par une relation de couverture.

## Registre canonique et huit exigences

Créer depuis le registre deux entrées, initialement `open`, `warning`,
`origin_kind=manual`, actives, rattachées à P/V et au lot SB (`scopeType=lot`,
`scopeId=SB`). Ce lot doit être explicitement déclaré compatible avec ZB/RB
par la nouvelle revue ; le titre du lot ne suffit pas.

- H1, `assumption` : « ARMY hypothèse : accès de pose disponibles en zone B ; à confirmer. »
- M1, `missing_piece` : « ARMY pièce manquante : détail D-B des traversées en zone B. »

Les alias H1/M1 vivent dans le manifeste, pas dans une nouvelle copie
modifiable de leur texte au sein de la couverture. L'historique de décision
conserve seulement l'état réellement consulté du registre.

| Exigence | Périmètre | Citation A | Traitement décidé | Liens revus / justification |
| --- | --- | --- | --- | --- |
| E1 calorifuge CH-A | ZA/RA | C1 | Inclus ailleurs | L1 + snapshot + C-ISO, quantité 10 m, contenu revu. |
| E2 calorifuge ECS-B | ZB/RB | C1 | Non arbitré | Aucun lien : L4 ne contient pas le calorifuge. Pas de diagnostic automatique d'omission. |
| E3 protection complète CH-A | ZA/RA | C2 | Chiffré | L2 **et** L3 ; L2 seul serait une couverture partielle, insuffisante. |
| E4 finition démontable des deux raccords | ZA/RA | C3 | Chiffré | L3 ; même coût déjà utilisé par E3, sans duplication. |
| E5 diagnostic amiante | ZA/RA | C4 | Exclu | Motif « Hors du lot dans le corpus, clause C4 » ; aucun accord client prétendu. |
| E6 traçage électrique | ZB/RB | C5 | Autre lot | Destination nommée « Électricité », justification C5 ; aucune ligne fictive. |
| E7 traitement des traversées | ZB/RB | C6 | Provisoire | H1 **et** M1 ; incertitude « Détail et accès à confirmer ». |
| E8 conditions d'accès de pose | ZB/RB | C7 | Provisoire | H1 ; incertitude « Disponibilité des accès à confirmer ». |

Avant décisions : 8 non arbitrées/non revues. Après parcours S1 : traitements
`non_arbitré=1, chiffré=2, inclus_ailleurs=1, exclu=1, autre_lot=1, provisoire=2` ;
validités `non_revue=1, à_jour=7, à_revérifier=0`. E2 reste non revue,
même si sa citation C1 a été consultée. Les deux décisions provisoires sont
à jour **avec incertitude ouverte** ; les compter comme couvertes serait faux.
Ne calculer aucun pourcentage d'exhaustivité du CCTP.

Les relations attendues sont E1→L1/C-ISO, E3→L2/L3, E4→L3,
E7→H1/M1, E8→H1. Un lien répété vers L3 n'ajoute ni coût ni couverture.
La même clause C1 a deux exigences, avec deux périmètres et deux traitements.
Cela éprouve plusieurs exigences pour une cible et plusieurs cibles pour
une exigence, sans transformer la revue en moteur de quantités.

Précision avant implémentation de la couverture, le 12 octobre : la complétude
est une déclaration humaine explicite, initialement `partial`. Dans SC-02,
L2 seul est enregistré comme rapprochement partiel ; la tentative de décision
« chiffré » avec cette complétude est refusée. Après ajout de L3, le chiffreur
doit encore déclarer et motiver que toute la prestation est traitée. L'ajout
d'un lien ne le fait pas automatiquement. Le scénario ne prétend pas que le
logiciel peut déduire la suffisance technique de L2/L3 à partir des désignations,
ni détecter une fausse déclaration humaine sans analyse du contenu.

## Montants et exports avant/après

Comparer S0 (chiffrage prêt sans décision), S1 (sept décisions), dépôt B
sans sélection, puis sélection B sans modification financière : partout
**71000/14200/85200 centimes et 8 h**, mêmes 2 sections/4 lignes, mêmes
quantités et mêmes identités. Les seules écritures de revue ne créent ni
ligne, ni ouvrage, ni commande, ni événement d'envoi du devis.

Télécharger et parser les deux vrais XLSX à S0 et S1, puis après B. Ne pas
comparer seulement le nom ou le hash ZIP ; les métadonnées peuvent varier.

- **Standard**, onglet `Devis` : pour L1/L2/L3/L4, tuples numériques
  `(quantité, PU HT EUR, total HT EUR, TVA EUR, total TTC EUR)` égaux à
  `(10,40,400,80,480)`, `(4,20,80,16,96)`, `(2,25,50,10,60)`,
  `(6,30,180,36,216)`. Onglet `Resume` : Total HT 710, Total TVA 142,
  Total TTC 852. Unités `m/m/u/m`.
- **DPGF de travail**, onglet `Données`, lignes identifiées par AID puis
  désignation : tuples `(Quantité, Unité, Prix unitaire HT EUR, K FO, h MO,
  K MO, Majoration MO)` égaux à `(10,m,40,0.5,5,1,1)`,
  `(4,m,10,1,1,1,1)`, `(2,u,15,1,0.5,1,1)`, `(6,m,20,1,1.5,1,1)`.
  La différence du prix unitaire entre les deux modes est le contrat actuel,
  pas une erreur à corriger dans DOS-CAL-01. Conserver les mêmes 6 lignes
  de données, l'ordre de l'arbre et les AID ; l'export DPGF ne fournit pas
  ces totaux financiers dans une nouvelle colonne à inventer.
- Rechercher dans les cellules, chaînes et fichiers XML des XLSX l'absence
  des textes H1/M1, motifs E5/E6, extraits C1–C7 et identités de décisions.
  Le sous-détail C-ISO ne devient pas une cinquième ligne. Les coûts/heures
  déjà exposés par la DPGF restent son comportement existant.
- L'aperçu d'impression doit montrer les mêmes valeurs commerciales.
  Un aperçu HTML réussi ne sera pas qualifié de PDF généré. Si le parcours
  génère réellement un PDF, conserver le fichier, ses pages et son texte.

### Mutations financières isolées depuis S1

Une nouvelle fixture sœur est requise par ligne de ce tableau. Les heures
restent fixes quand seule la quantité est modifiée ; ne pas inventer un
recalcul paramétrique encore absent.

| Mutation seule | HT / TVA / TTC attendus | Heures | Couverture attendue |
| --- | --- | ---: | --- |
| L2 quantité 4→5 | 72000 / 14400 / 86400 | 8 | E3 à revérifier ; E4 encore à jour. L2 vaut 9000 HT, PU commercial 1800. |
| L1 quantité 10→12 | 75000 / 15000 / 90000 | 8 | E1 à revérifier ; ancien C-ISO 10 m reste un fait historique, pas 12 m confirmés. L1 vaut 44000 HT, PU commercial 3667. |
| L1 heures 5→6 | 75000 / 15000 / 90000 | 9 | E1 à revérifier : contenu de pose du parent modifié. Snapshot ancien inchangé. |
| L4 quantité 6→7 | 73000 / 14600 / 87600 | 8 | Les sept décisions restent à jour ; E2 reste non arbitré/non revue. Pas de dépendance implicite par zone. |
| L2 prix brut 1000→1200, contenu inchangé | 71800 / 14360 / 86160 | 8 | Les sept décisions restent à jour. L2 vaut 8800 HT, PU commercial 2200. |
| Marge fixe 1→1,10 | 78100 / 15620 / 93720 | 8 | Les sept décisions restent à jour. HT par ligne : 44000/8800/5500/19800. |
| Réordonnancement seul L2/L3 | 71000 / 14200 / 85200 | 8 | Les sept décisions restent à jour ; seules les positions des deux lignes exportées changent. |
| Suppression L1 | 31000 / 6200 / 37200 | 3 | E1 à revérifier, cible disparue ; historique avec C-ISO 10 m, hash A et ancienne décision toujours lisible. |

Après changement puis retour de quantité à sa valeur S1, l'exigence touchée
reste à revérifier jusqu'à un nouvel acte de revue. La simple égalité finale
des valeurs ne ressuscite pas l'ancienne décision.

## Parcours E2E à écrire avant le code

| Cas | Défaillance révélée | Assertions nécessaires |
| --- | --- | --- |
| SC-01 référence et passage | Document associé ou titre pris pour une preuve | Choix explicite A ; hash de copie A ; consultation page 2 ; citation initialement à vérifier ; page 0/4, extrait vide et confirmation sans source consultable refusés sans décision. Relecture après reload. |
| SC-02 six traitements | Généralisation entre zones ou double chiffrage | Établir exactement S1, ouvrir le composant C-ISO, E2 reste non arbitré ; E3 avec L2 seul ne peut devenir à jour/chiffré. Répéter un lien ne change pas l'ensemble. Totaux et exports S0/S1 exacts. |
| SC-03 contre-exemples d'inclusion | Nom de modèle ou suggestion devient couverture | Un modèle de bibliothèque nommé calorifuge, un candidat rejeté/non appliqué, une section SA, une ligne d'une autre version et un cycle entre exigences sont refusés comme preuve d'inclusion. C-ISO réellement appliqué réussit. |
| SC-04 A→B | Ancienne citation réutilisée sous nouvelle référence | Déposer B et changer le principal intake : A reste active et S1 inchangé. Préparer la copie B sans la confirmer ne change rien non plus. Choisir explicitement B : sept décisions à revérifier, E2 non revue, anciens traitements conservés. L'ancienne citation A seule ne peut revalider aucune décision. Vérifier B/C3 puis revérifier E4 seulement : 1 à jour, 6 à revérifier, 1 non revue ; aucune auto-adaptation de 30 à 40 mm pour E1. |
| SC-05 registre vivant | Valider une hypothèse marque l'exigence chiffrée | H1 `open→validated` rend E7/E8 à revérifier, sans changer leur traitement provisoire. Revérifier E7/E8, puis H1 `validated→open` les invalide à nouveau. M1 seul modifié touche E7, pas E8. Montants constants. |
| SC-06 invalidation ciblée | Toute révision invalide tout, ou aucun changement technique n'invalide | Exécuter le tableau des mutations sur fixtures sœurs ; assert identité des seules exigences affectées et valeurs financières exactes, après sauvegarde/reload/export. |
| SC-07 motifs et périmètre | Exclusion silencieuse, lot vide ou faux périmètre | Exclu sans motif, autre lot sans destination, provisoire sans H1/M1 compatibles, ligne d'autre affaire et zone absente supposée « toutes » refusés. Historique précédent conservé. |
| SC-08 reprise | Double décision, double événement ou faux succès partiel | Perdre la réponse après commit puis rejouer la même intention : même identité de décision/événement, cardinalité inchangée. Même identité avec autre contenu : conflit. Faute avant commit : aucun nouvel état ni événement. |
| SC-09 panne et droits | Échec de lecture remplacé par zéro exigence/à jour | 503 ou lecture mal formée : indisponible, aucune confirmation, dernière décision conservée. Utilisateur privé d'une source : détails interdits, pas d'invalidation globale. Reprise vers le vrai serveur puis données exactes. |
| SC-10 duplication et archivage | Anciennes identités recopiées comme décisions valides | Nouvelle version : aucune décision héritée à jour et aucune cible de V acceptée. Exigence E5 archivée avec motif : 7 exigences actives, exclusion active 0, historique E5 conservé ; autres valeurs identiques. |

SC-04 confirme la nouvelle citation de la clause C3 inchangée et sa décision
interne E4. Il ne prétend pas que le chiffrage 30 mm satisfait désormais
40 mm : E1 reste à revérifier, avec son ancienne inclusion visible dans
l'historique. Ce choix rend l'oracle déterministe sans demander au logiciel
d'inventer un arbitrage thermique ni de modifier l'ouvrage automatiquement.

## Compléments natifs justifiés avant implémentation

Ces cas dépassent ce qu'un clic séquentiel peut établir. Chaque course
utilise deux connexions réelles et un troisième observateur des verrous,
sans `sleep` présenté comme preuve de concurrence.

1. Deux décisions attendent la même révision : un commit gagne, l'autre
   reçoit un conflit ; un seul événement et des faits cohérents. Contrôler
   le replay idempotent après reconnexion et le rejet d'un payload différent.
2. L1 quantité 10→12 gagne contre la décision E1 depuis l'aperçu 10 : refus
   de décision périmée. Dans l'ordre inverse, la décision gagne puis la
   quantité rend E1 à revérifier. Après les deux commits, jamais « à jour »
   avec parent 12 et fait validé 10. Répéter avec modification de composition
   et avec remplacement/disparition de l'application.
3. Choix concurrents B/C : une seule référence courante. La copie Storage
   n'étant pas transactionnelle avec PostgreSQL, injecter séparément la
   panne avant copie, après copie et avant activation ; A reste active tant
   que la nouvelle copie n'est pas vérifiée. Une reprise ne duplique pas
   la référence ou son événement. Aucune URL publique créée.
4. Dégradation admin/engineer vers viewer, ou sortie du brouillon, entre
   aperçu et décision : refuser le commit ; auteur/tenant/version fournis
   frauduleusement n'ont aucune autorité. Utiliser seulement les comptes
   et transitions explicitement provisionnés dans le runtime isolé.
5. API directe, Data API et import autorisé modifient un fait technique :
   même invalidation ou refus. Déplacement d'un parent vers une autre
   affaire/tenant refusé. Les FK CASCADE du snapshot ne suppriment pas les
   faits conservés par la décision lorsque L1 ou le draft disparaît.

La matrice de droits doit couvrir admin, engineer propriétaire, engineer
non propriétaire, director, viewer propriétaire, utilisateur du tenant B,
membre sans tenant actif et anonyme, sur lecture/écriture, liens forgés,
URL de preuve et copie Storage. Attendre les règles du contrat produit,
pas celles plus permissives d'un ancien registre. La restriction d'export
existante aux rôles admin/engineer reste distincte de la lecture de revue.

## Préparation déterministe retenue

Le dialogue permet maintenant de retrouver un brouillon existant et d'en
reprendre réellement la revue. Ce parcours est qualifié séparément par les
dix scénarios de reprise de la campagne `2026-10-11T22-00-41-793Z` ; voir le
[journal de recette](generated-ouvrage-resume.md). Il remplace la proposition
initiale d'un adaptateur de fixture appelant les actions hors interface.

Le seed de couverture créera seulement les candidats et composants pendants
synthétiques, avec un nouvel utilisateur, tenant et rôle RMO dédié. La
recette devra les retrouver, les examiner et les appliquer dans l'interface
normale. Elle n'insérera directement ni application ni snapshot : les actions
réelles les produiront, puis des accès ordinaires vérifieront leurs identités,
coûts, heures et unités. Les deux garde-réseaux, serveur et navigateur,
empêcheront les appels de génération ; cette recette ne qualifie pas Gemini.

Le défaut d'unité a été reproduit puis corrigé dans la qualification de reprise,
avec vraie lecture API, cellule d'éditeur et fichier DPGF téléchargé. Cela ne
constitue pas encore la recette du présent oracle à 71000/14200/85200 centimes
et huit heures : son devis, ses PDF et ses futures décisions devront être
qualifiés ensemble. Aucune norme ou validation métier humaine n'est déduite
de ces fixtures techniques.

## Critères de qualification et traces attendues

Une campagne verte exige tous les cas sélectionnés réussis, aucun saut,
sources et build stables, compte ordinaire et hôtes vérifiés. Conserver :
commande, révision Git et empreinte des changements, versions du runtime,
manifeste des alias/UUID, hashes des PDF originaux et copies, textes par
page, application/snapshot/composant réellement lus, états S0/S1 et mutations,
historique des décisions, résultats natifs, deux exports parsés par état,
rapports TesterArmy et hashes de chaque fichier archivé. Ne pas inscrire
de cookies, URL signées complètes, secrets ou jetons dans ces artefacts.

Vérifier séparément les comptes de lignes, liens, décisions et événements,
les montants stockés/API/UI/exports et le maintien de l'historique. Une
assertion de badge ou un statut HTTP 200 seuls ne prouvent ni la cohérence
financière ni la provenance. Les courses/Storage/RLS non exécutés restent
des preuves manquantes. La validation métier humaine et la mise en service
du logiciel complet restent explicitement ouvertes.
