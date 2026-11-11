# Règles fixes du métré (L5)

Le modèle propose, les règles expliquent les anomalies et l'utilisateur contrôle
les valeurs clés (TI-664 et cadrage TI-681 confirmé les 8 et 9 novembre 2026).

## Contrat actuel de contrôle ciblé — TI-681

Les avertissements de quantité, y compris une confiance faible, recommandent un
contrôle sans imposer l'acquittement de chaque tronçon. Les descriptions datées
ci-dessous d'un blocage sur simple faible confiance ou doute de quantité sont
remplacées par ce contrat. Les protections de droits, de tenant, de brouillon,
de concurrence, de provenance localisée, de résultats périmés et les restrictions
techniques de matériaux restent en vigueur.

- Prioriser les postes dès **1 000 € HT ou 1 % du montant HT de leur lot**, au
  premier seuil atteint, à égalité comprise. Un montant inconnu reste inconnu.
  Une anomalie est signalée même sous ce seuil. Les montants viennent du moteur
  épinglé ; le prix d'achat FO en v3 n'est pas un prix de vente.
  L'impact estimé valorise l'écart absolu au prix net par unité de la ligne.
  Les lectures alternatives sont dédupliquées par groupe ; entre leur écart et
  l'écart DPGF, retenir le plus grand sans additionner deux fois un même doute.
- Présenter une confiance **élevée, moyenne ou faible**, avec ses raisons, sans
  transformer le score du modèle en pourcentage de fiabilité mesurée.
- Une mesure vectorielle exploitable est prioritaire sur une lecture alternative
  comparable du même document, page, étage/zone, unité et identité. Conserver les
  deux lectures, montrer leur écart et appliquer une seule source de quantité.
- Comparer les éléments repérés au périmètre attendu des bâtiments, étages,
  zones et réseaux. Un nom de fichier couvrant plusieurs étages ne prouve pas
  que tous ont été analysés ; une liste d'alertes vide ne prouve pas la complétude.
- Conserver les mesures brutes. Pour les longueurs vendues, **cumuler par ligne
  de devis puis arrondir une seule fois au mètre supérieur** : 2,2 + 2,2 → 5 m ;
  2,2 + 1,3 → 4 m ; 12,14 → 13 m. Préserver les quantités protectrices DPGF.

Le temps de métré/quantitatif, contrôle et corrections compris, a un objectif de
division par quatre minimum. La référence de valorisation est 60 € HT/h.
**L'essai chronométré est reporté par Maxime** ; les tests fonctionnels ne
démontrent aucun gain de temps humain. Les cibles statistiques de risque et de
couverture antérieures restent provisoires.

Chaque règle est pure et déterministe. Elle rend « passe » ou « échoue », avec un
code stable, une raison lisible et sa version. Une règle qui n'a rien à lire sur
une ligne ne rend rien pour elle.

Le code est dans [`src/lib/takeoff/rules/`](../../src/lib/takeoff/rules/). Le banc
la mesure avec `npm run takeoff:bench -- --pipeline vector`
([`vector-rules.ts`](../../src/lib/takeoff/bench/vector-rules.ts)).

## Présélection et lecture unique par page — TI-682 (lot B)

Deux garanties, décidées le 6 novembre 2026 (D11, D12).

**Une hypothèse n'est jamais présélectionnée.**

- Une quantité est une hypothèse quand rien ne l'atteste :
  - son auteur l'a saisie comme telle (catégorie « Hypothèse ») ;
  - ou personne ne l'a attestée, et le métré a été demandé comme une estimation
    (`metadata.quantity_nature = estimated`), ou un plan ne peut pas la montrer
    (`metadata.rule_inputs.non_observable`).
- Une quantité attestée sur autre chose (relevé, autre plan, DPGF, confirmation
  écrite, calcul) n'est plus une hypothèse.
- Cette définition existe une fois en SQL (`public.takeoff_item_hypothesis_cause`)
  et une fois en TypeScript ([`hypothesis.ts`](../../src/lib/takeoff/hypothesis.ts)).
  Les deux lisent les mêmes cas, écrits dans
  [`takeoff-hypothesis-preselection.test.sql`](../../supabase/tests/database/takeoff-hypothesis-preselection.test.sql).
- À la création, une hypothèse que personne n'a attestée arrive **exclue, avec son
  motif**. Le worker l'écrit ainsi, et un déclencheur à l'insertion le garantit pour
  tout autre écrivain. Une ligne ordinaire garde sa présélection.
- Elle reste dans la revue ciblée, marquée « Hypothèse », tant que personne ne l'a
  tranchée (la revue complète y renvoie). Seule exception : une hypothèse que la
  sélection apparie à une mesure vectorielle devient la lecture alternative écartée,
  comme toute autre ligne appariée. Sinon :
  - saisir sa quantité avec ce qui la fonde l'inclut ;
  - « Inclure » (touche I) inclut une quantité estimée ; incluse sans saisie, elle
    entre au devis comme hypothèse, marquée à l'application (voir « Provision
    interne », TI-682 lot C) ;
  - l'exclure avec un motif la retire de la liste.

  « Accepter » (V) ne l'inclut jamais.
- Un métré demandé comme une estimation arrive donc sans aucune ligne du modèle
  présélectionnée : chaque quantité s'inclut par un choix. Les mesures vectorielles
  exploitables suivent leur règle habituelle.
- La sélection des sources de TI-681 lit toujours une hypothèse comme la lecture
  alternative qu'elle est : elle l'apparie à une mesure vectorielle comparable,
  comme avant, et appliquer les deux reste refusé.
- Sans les règles fixes (`MERGEONE_TAKEOFF_RULES`), le signal « non observable »
  n'existe pas : seule l'estimation est lue.

**Jamais la lecture vectorielle et la lecture du plan d'une même page ensemble.**

- La sélection de TI-681 apparie une mesure vectorielle et la ligne du modèle de
  même identité : appliquer les deux est refusé (inchangé).
- Une mesure vectorielle que la sélection n'a pas appariée reste exclue. Incluse à la
  main, elle est refusée à l'application tant qu'une ligne du modèle de la même page
  est incluse, sauf si l'unité de cette ligne prouve qu'elle compte autre chose :
  - un comptage (« u ») ne double jamais une mesure : il reste à côté ;
  - une longueur reste à côté d'une pièce mesurée, une surface à côté d'un tronçon
    mesuré ; jamais à côté d'un calorifuge mesuré, que le modèle lit en mètres ou en
    mètres carrés ;
  - rien d'autre n'est une preuve : un forfait ou un ensemble, une masse, une unité
    inconnue du référentiel, une unité absente.
- Faute de preuve, les deux lignes sont aussi sur la même page : une page, un fichier
  ou un document source qui manque sur l'une des deux.
- Les lignes que la sélection a retenues continuent de passer, y compris à côté
  d'une ligne de la page qu'elle n'a pas appariée avec sa mesure.
- Le refus est un 422 qui nomme la page. Il se lève dans la revue : exclure l'une
  des deux lectures, ou corriger l'unité d'un comptage mal écrit. Une ligne seulement
  ignorée dans le plan d'application compte encore comme incluse.
- La protection vaut par métré : deux métrés de la même page appliqués au même
  devis ne sont pas comparés par ce refus. Elle lit la page que chaque ligne porte,
  que le relecteur peut corriger. Depuis le lot D, un second métré de la page est
  signalé (section suivante), sans encore être refusé.

## Une page n'entre qu'une fois au devis — TI-682 (lot D)

Règle de métier : une page de plan entre une fois au devis ; une nouvelle mesure
remplace l'ancienne. Une révision du plan (même « Référence du plan ») est la même
page. Avant ce lot, rien ne comparait deux métrés d'une même page : relancer un plan
et l'appliquer avec « Ajouter » doublait ses quantités sans un mot.

**Première étape : prévenir (PR 1).** Rien n'est encore refusé ni remplacé ; rien de
ce qu'une application écrit ne change.

- **Même page.** Deux lignes de métré lisent la même page quand elles lisent le même
  document et la même page, ou que la page manque sur l'une des deux (faute de
  preuve, c'est la même page). Même document, si l'une de ces conditions est vraie :
  - même fichier de la bibliothèque de plans ;
  - même empreinte du contenu, notée par la préparation (deux dépôts du même PDF) ;
  - même « Référence du plan », non vide (une révision remplace la précédente) ;
  - ou, quand l'une des deux n'a ni fichier de la bibliothèque ni empreinte, même nom
    de fichier (minuscules, blancs réduits).

  Deux fichiers de même nom, chacun identifié, sans référence commune, restent deux
  documents. L'avertissement donne une ligne par document et par page : deux fichiers
  de même nom y sont deux lignes, chacune avec ses propres lignes de métré ; deux
  révisions d'une même référence n'en sont qu'une.
- **Ce qui est déjà au devis** se lit dans les lignes du devis, remontées jusqu'aux
  lignes de métré figées dont elles viennent :
  - moteur 3 : la ligne de métré de la ligne, toutes celles d'une longueur regroupée
    puis arrondie, toutes celles d'une ligne DPGF alimentée ; le fichier et la page
    d'une ligne DPGF sont ceux du DPGF et ne comptent pas ;
  - moteurs 1 et 2 : le métré, le fichier et la page de la ligne.

  Une ligne supprimée ne compte plus ; une version copiée garde sa provenance, donc
  ses pages. Une ligne collée ou saisie à la main n'a pas de provenance : elle n'est
  pas vue. Le devis lu est celui de la version revue : un métré repris dans une
  version copiée se compare aux lignes de la copie (celles qu'on y a ajoutées ou
  retirées), non à la version où il a été lancé.
- **Lignes non comparées.** Une ligne du nouveau métré sans plan ni page (métré à
  plusieurs fichiers sans préparation, page hors du jeu) n'est comparée à rien : elle
  est comptée et affichée comme telle.
- **Où l'avertissement apparaît**, en français et sans décision à prendre :
  - au lancement, à l'étape « Vérifier et lancer » de la préparation : les pages des
    plans choisis que la version cible porte déjà ; le lancement reste possible.
    L'empreinte d'un plan de la bibliothèque n'est calculée qu'à la confirmation :
    au lancement, ce plan se compare par son identifiant, sa référence ou son nom ;
    les revues, qui lisent l'empreinte du métré, le comparent aussi par elle ;
  - en tête de la revue ciblée et de la revue complète : par page, le métré antérieur
    (sa date et son fichier, avec « Ouvrir le métré ») et le nombre de lignes qu'il a
    apportées au devis. Une page dont toutes les lignes sont exclues n'est plus
    signalée. Un doublon entre zones dont la ligne partenaire est une ligne que le
    métré antérieur a lue sur cette page compare deux lectures de la même page : le
    bandeau dit de ne pas retirer la ligne pour le régler. Le métré antérieur seul ne
    suffit pas (il a pu lire aussi une autre zone) ; faute de pouvoir placer la ligne
    partenaire sur la page (ligne de devis sans ligne source, moteurs 1 et 2), il ne
    dit rien ;
  - dans l'assistant d'application, à la confirmation : la notice « Pages déjà au
    devis » (pages, métré antérieur, nombre de lignes). Les lignes que le plan
    d'application ignore ou range dans un ouvrage n'y comptent pas, et le texte dit ce
    que la stratégie choisie fait de la mesure précédente (« Fusionner » ne remplace
    que les lignes de même désignation et unité, « Remplacer » ne vide que la section
    cible) ;
  - une fois le métré appliqué, seules restent signalées les pages où ses propres
    lignes sont encore au devis : là, la page y est deux fois. Ses lignes sans page
    sont sur la page signalée, par la même règle. Appliqué depuis la revue, le
    bandeau relit le devis ; il le relit aussi quand la revue complète enregistre la
    page source corrigée d'une ligne. L'exclusion d'une ligne ne demande pas de
    relecture : le bandeau filtre les pages sur les lignes affichées.
- **Provenance périmée.** Une clé d'arrondi ou de ligne DPGF écrite par un autre métré
  que le dernier de la ligne (une fusion ultérieure l'a gardée) ne compte pas.
- **Lecture.** `GET /api/takeoff/jobs/{jobId}/page-contributions?version_id=` (la
  version revue ; 404 si elle est illisible ou si le métré n'en fait pas partie), et
  `POST /api/takeoff/page-contributions` avant un lancement. Lecture seule, sous la
  session de l'utilisateur : le tenant actif, la lecture de la version et de ses
  métrés, et la RLS des lignes du devis, des lignes de métré et des métrés la bornent. La définition est écrite une
  fois en TypeScript
  ([`page-contributions.ts`](../../src/lib/takeoff/page-contributions.ts)), sur la table
  de cas de [`page-contributions.test.ts`](../../src/lib/takeoff/page-contributions.test.ts),
  que la jumelle SQL de l'étape suivante lira.
- **Ce qui ne relève pas d'une règle fixe** : c'est une décision par page, prise à
  l'application, pas une erreur de quantité d'une ligne ; les règles fixes ne lisent
  ni le devis ni une version copiée.
- **Étape suivante (PR 2)** : remplacer la mesure antérieure ligne à ligne, ou garder
  les deux avec un motif, et le refus en base d'une page appliquée deux fois sans
  décision.

## Entrées

Les entrées d'une ligne sont écrites par le worker, jamais par l'utilisateur.

- **Ligne vectorielle** (TI-662) : réseau, matériau, taille, axes en mètres et polygone
  de pièce, lus dans sa géométrie ; échelle, cotes et surfaces imprimées lues dans
  la page.
  - La taille garde la notation que son libellé imprime (TI-683, D7) : « Ø 110 » reste
    « Ø 110 » et « DN 100 » reste « DN 100 », sur la désignation de la ligne, celle de son
    calorifuge et dans ses entrées (version 2). Deux sections d'un même réseau libellées
    « DN 100 » et « Ø 100 » sont deux tailles, jamais additionnées.
  - Une taille écrite avant ce changement (entrées en version 1, toujours « DN n ») ou
    dont la notation n'est pas connue reste lue des deux façons, comme nominale puis
    comme diamètre extérieur.
- **Ligne du modèle** (niveaux B et C) : réseau, matériau et DN lus dans sa
  désignation par le lecteur déterministe du banc
  ([`item-keys.ts`](../../src/lib/takeoff/bench/item-keys.ts)).
  - Le DN passe par l'analyse de `price-reuse-matching.ts` et la table des diamètres de L0.
  - Un triplet incomplet le reste : pas de réseau, deux réseaux ou deux DN.
  - Toutes les tailles imprimées comptent, quelle que soit celle que garde le lecteur (il lit « DN 22 » et saute « Ø 23 » à côté).
  - Une taille absente des séries est gardée telle qu'imprimée (« DN 23 », « Ø 23 », « 3/4" »), pour que la règle l'échoue, même à côté d'une taille connue (« DN 22 / Ø 23 »).
  - Deux tailles connues différentes, quelles que soient leurs notations (« DN 22 / Ø 28 »), sont deux DN. Une même taille écrite de deux façons (« DN 20 / Ø 22 » d'un tube cuivre) en est une.
  - Quand la taille gardée désigne plusieurs tubes, celle qui n'en désigne qu'un la remplace (TI-683) : « EF inox DN 100 / Ø 108 » est le tube à sertir Ø 108, là où « DN 100 » seul est aussi le tube soudé Ø 114,3.
  - Ces tailles se lisent dans la série que la règle DN retient pour le réseau et le matériau lus (D18c, voir « Série retenue ») ; sans réseau lu, dans les séries du matériau. « EU inox DN 100 / Ø 110 » est une seule taille NF EN 1124 ; dans « EU inox DN 100 / Ø 108 », le Ø 108 que cette série n'a pas est gardé tel qu'imprimé, comme « Ø 23 » à côté de « DN 22 » ; « EU inox DN 100 / Ø 125 » porte deux DN.
  - Une épaisseur (« ép. 20 mm », « épaisseur 19 mm », « ép. 2,20 mm ») n'est jamais un DN, et aucune taille ne commence à l'intérieur d'un nombre (« 20 mm » de « 2,20 mm »).
  - « 1"1/4 » et « 1 1/4" » sont une même taille.
  - Les tailles se lisent après les guillemets d'un texte cité, retirés comme le fait le lecteur : le guillemet fermant de « "EF cuivre 20/22" » termine le texte, ce n'est pas le pouce d'un 22" (TI-677). Un pouce à l'intérieur du texte cité reste un pouce (« "EF acier noir 3/4" fileté" »), et aucun pouce ne commence après une barre (le 22 de « 20/22" »). Comme le lecteur, un nombre entier qui ferme un texte cité n'est pas un pouce (« "EF acier galvanisé 2" DN 32 » se lit DN 32).
  - Une quantité non observable se lit aussi dans un texte cité (« "Soudures acier DN 50" » est à saisir).
  - Une ligne de réseau en m² est une surface de calorifuge, jamais un tuyau.
- **Quantité proposée** : la quantité du modèle ou de la lecture, avant toute
  correction.

L'utilisateur modifie la quantité et l'exclusion. Les règles les lisent telles
qu'elles sont maintenant.

## Règles et codes

| Règle | Échoue | Passe | V lève l'échec |
|---|---|---|---|
| `dn_network` | `DN_NETWORK_NETWORK_MISSING`, `DN_NETWORK_MATERIAL_MISSING`, `DN_NETWORK_DN_MISSING`, `DN_NETWORK_MATERIAL_NOT_ALLOWED`, `DN_NETWORK_DN_NOT_IN_SERIES`, `DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION`, `DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION`, `DN_NETWORK_MATERIAL_BLOCKED` | `DN_NETWORK_COMPATIBLE` | oui, avec un motif codé et la référence du système ; **jamais** `DN_NETWORK_MATERIAL_BLOCKED` |
| `zone_overlap` | `ZONE_OVERLAP_DUPLICATE`, `ZONE_OVERLAP_UNREGISTERED` | `ZONE_OVERLAP_NONE`, `ZONE_OVERLAP_RESOLVED` | oui |
| `scale_dimension` | `SCALE_DIMENSION_MISMATCH` | `SCALE_DIMENSION_CONSISTENT` | oui, avec un motif codé et ce qui a été vérifié |
| `area_printed` | `AREA_PRINTED_MISMATCH` | `AREA_PRINTED_CONSISTENT` | oui, avec un motif codé, la base de la surface écrite et une note |
| `room_overlap` | `ROOM_OVERLAP` | `ROOM_OVERLAP_NONE` | oui |
| `closed_box` | `CLOSED_BOX_LABEL`, `CLOSED_BOX_SHAPE` | `CLOSED_BOX_NONE` | oui |
| `non_observable` | `NON_OBSERVABLE_TO_ENTER` | `NON_OBSERVABLE_ENTERED` | **non** : la quantité se saisit |

### DN compatible avec le réseau

Elle porte sur les lignes de longueur, sauf le calorifuge et le cordon chauffant,
qui n'ont pas de série propre.

Chaque couple réseau × matériau a l'un de trois états (TI-685) : **admis**,
**à justifier** ou **bloqué**. Un matériau absent des trois n'est pas admis : la
règle ne présume jamais qu'un matériau est admis parce que son diamètre existe.

Les contrôles se lisent dans cet ordre ; le premier qui échoue décide :

| Le triplet | Code | V |
|---|---|---|
| réseau non lu (aucun ou deux) | `DN_NETWORK_NETWORK_MISSING` | avec justification |
| matériau non lu | `DN_NETWORK_MATERIAL_MISSING` | avec justification |
| matériau bloqué pour le réseau (multicouche en gaz), quel que soit le DN | `DN_NETWORK_MATERIAL_BLOCKED` (`acceptable: false`) | **non** |
| matériau ni admis ni à justifier pour le réseau | `DN_NETWORK_MATERIAL_NOT_ALLOWED`, avec les matériaux admis | avec justification |
| PE en gaz, quel que soit le DN | `DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION` | avec un motif de pose du PE gaz |
| DN non lu, ou deux DN, ou une taille qui désigne plusieurs tubes sur un couple admis (TI-683) | `DN_NETWORK_DN_MISSING`, avec les tubes possibles | avec justification |
| DN absent de la série retenue | `DN_NETWORK_DN_NOT_IN_SERIES`, avec sa norme | avec justification |
| couple à justifier, DN de la série | `DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION`, la raison donne la condition | avec justification |
| couple admis, DN de la série | passe : `DN_NETWORK_COMPATIBLE` | — |

- **Condition affichée** (D18b) : sur un couple à justifier, un DN non lu ou hors série
  échoue en `DN_NETWORK_DN_MISSING` ou `DN_NETWORK_DN_NOT_IN_SERIES`, et sa raison
  rappelle aussi la condition du couple : le relecteur voit ce que le matériau demande
  à côté du DN à corriger. Codes et acceptabilité sont inchangés, et la raison n'entre
  pas dans la clé de l'échec. Le PE gaz garde son propre code et son exigence de pose
  avec un diamètre non lu (« système à préciser ») ou hors série (« système à justifier »).
- **Pas de DN minimal par réseau** : un réseau restreint les matériaux, jamais les
  tailles. Pas de seuil WC global : le contrat d'entrée ne rattache pas un tronçon à un WC.
- **Taille imprimée et DN dérivé** (TI-683, décisions Q7 et D7) : la clé d'une taille est
  le matériau, le diamètre extérieur, l'épaisseur et le texte imprimé ; le DN nominal en
  est dérivé. La règle ne réécrit jamais la taille : elle la résout dans la série retenue
  (`resolveNetworkSize`).
  - **Un seul tube** : le résultat porte ce tube dans `details.size` (texte imprimé,
    diamètre extérieur, DN nominal, épaisseur et son origine, imprimée « 22x1,2 » ou
    usuelle de la série), et la raison le dit : « DN 20 en cuivre (Ø extérieur 22 mm,
    DN nominal 20) compatible avec le réseau EF ».
  - **Plusieurs tubes** : un « DN n » qui nomme à la fois un tube par son diamètre
    extérieur et un autre par son DN nominal ne choisit pas. « DN 15 » en cuivre est le
    Ø 15 (DN nominal 12) ou le Ø 18 (DN nominal 15) ; « DN 100 » en inox sous pression est
    le Ø 108 à sertir ou le Ø 114,3 soudé. La ligne échoue en `DN_NETWORK_DN_MISSING`,
    la raison nomme les tubes et demande le diamètre extérieur, et `details.size_candidates`
    les porte. Le code est celui d'un DN non lu : l'échec reste un avertissement de
    quantité que V lève, côté TypeScript comme côté SQL, sans nouvelle migration.
  - Tailles concernées aujourd'hui, lues dans la table : cuivre « DN 10 », « DN 12 »,
    « DN 15 » et « DN 32 » ; multicouche « DN 20 », « DN 32 », « DN 40 » et « DN 50 »
    (le Ø 20 ou le Ø 26 dont le DN nominal est 20) ; inox sous pression « DN 15 »,
    « DN 20 », « DN 25 », « DN 32 », « DN 40 », « DN 50 » et « DN 100 », que la série
    à sertir et la série soudée portent avec deux diamètres extérieurs (DN 65, DN 80,
    DN 125 et DN 150 y partagent le même diamètre : un seul tube) ; en condensats,
    ceux que porte aussi la série NF EN 1124. Sur un réseau d'évacuation, l'inox n'a
    qu'une série et son « DN 100 » est le tube de 110 mm.
  - Sur un couple à justifier (cuivre en condensats, multicouche en eau glycolée), la
    taille est lue et chacun de ses tubes est dans la série : la ligne garde l'échec
    `DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION`, qui bloque jusqu'à sa justification,
    et sa raison nomme aussi les tubes.
  - « Ø n » ne désigne jamais qu'un diamètre extérieur : celui du tube qui a exactement
    ce diamètre, avant celui qu'un arrondi atteindrait (« Ø 42 » en inox est le tube à
    sertir, jamais le tube soudé Ø 42,4 ; « Ø 114 » reste le Ø 114,3, seul à s'en
    approcher). Ce choix est fait dans la sélection commune, pour la règle, les doublons
    et l'identité DPGF. « Cuivre 20/22 » reste « 20/22 » et ne devient pas « DN 22 ».
  - Limite connue : deux tailles hors de la série de leur usage écrites de deux façons
    (« EU PEHD Ø 20 » et « EU PEHD DN 20 ») ne sont plus rapprochées par leur diamètre
    mais par leur texte, donc tenues pour différentes. Les deux lignes échouent déjà à
    la règle DN.
  - L'épaisseur est portée par le résultat de la règle. Elle n'entre pas encore dans
    l'identité des doublons ni dans celle des quantités DPGF, qui comparent famille et
    diamètre extérieur.
- **Raccords** (D7) : une longueur de tuyau ne contient aucun raccord. Ils sont comptés
  à part ou portés par un prix au mètre explicitement composé, jamais par un ratio
  universel appliqué aux longueurs. Aucune règle du métré n'ajoute de raccords.

La table ([`network-diameters.ts`](../../src/lib/takeoff/rules/network-diameters.ts), version 4 ;
états de TI-685, séries par réseau de TI-684, D18a et D18b, tailles par usage de TI-683) :

- **Matériaux par réseau** (un réseau de départ ou de retour, CHW-S, HW-R…, suit son
  réseau parent) :

  | Réseaux | Admis | À justifier (condition affichée) | Bloqué |
  |---|---|---|---|
  | EF, EFA | cuivre, inox, multicouche, PER, PP, PVC pression | acier galvanisé (certification NF, analyse d'eau, absence de cuivre en amont) ; PEHD (gamme eau potable et pose intérieure) | — |
  | ECS, RECS | cuivre, inox, multicouche, PER, PP | — | — |
  | EU, EV, EU/EV, EP, VP | PVC, fonte SMU, PP, PEHD | inox, série NF EN 1124 (gamme et série, table provisoire) | — |
  | EUG | fonte SMU, PP, PEHD | PVC (système PVC-C ou haute température) ; inox, série NF EN 1124 | — |
  | COND | PVC, PVC pression, PP, PEHD, inox (séries sous pression et NF EN 1124 réunies, D18a) | cuivre (condensats de climatisation) | — |
  | CS, SPK | acier galvanisé, acier | — | — |
  | RIA | acier galvanisé, acier | PEHD (système pour RIA, matériaux admis à vérifier) | — |
  | GAZ | cuivre, acier | PE (pose enterrée à l'extérieur hors emprise du bâtiment, ou remontée en façade jusqu'au raccord métal/plastique) | multicouche |
  | CHW, CW | acier, inox, cuivre, multicouche, PP, PEHD | — | — |
  | HW | acier, inox, cuivre, multicouche, PP, PER | — | — |
  | HRC | acier, inox, cuivre, multicouche, PP | — | — |
  | GLY | acier, inox, cuivre, PP, PEHD (sans zinc) | multicouche (gamme antigel et pourcentage de glycol) | — |

  - Toutes les nuances d'un matériau (inox 304L et 316L) et tous les réseaux d'une même
    famille suivent la même décision. « Acier » couvre l'acier noir et l'acier sans
    finition précisée ; l'acier galvanisé n'est admis que là où il est nommé.
- **Séries** : celles des normes produit de la table des diamètres de L0
  ([`diameters.ts`](../../src/lib/takeoff/bench/diameters.ts), version 3 ; ajouts de
  TI-664 : cuivre 6 et 8 mm, fonte DN 80, PER 40 à 63, PP 16).
  - Cuivre NF EN 1057, inox à sertir NF EN 10312 série 2, inox soudé NF EN ISO 1127.
  - PVC NF EN 1329-1 et 1452, fonte SMU NF EN 877. Le PVC d'évacuation et le PVC pression partagent une famille de L0 : leurs diamètres sont séparés ici.
  - Acier NF EN 10255 et 10220, multicouche ISO 21003, PER ISO 15875, PE NF EN 12201, PP NF EN 1451 et ISO 15874.
  - **PE et PP par usage** (TI-683, D7), comme le PVC : chacun partage une famille de L0
    entre pression et évacuation, et ses diamètres sont séparés ici (`USAGE_SERIES`).
    PE sous pression NF EN 12201, de Ø 20 à Ø 315 ; PE d'évacuation NF EN 1519, de Ø 32
    à Ø 315, sans Ø 20, Ø 25 ni Ø 140. PP sous pression NF EN ISO 15874, de Ø 16 à
    Ø 160 ; PP d'évacuation NF EN 1451, de Ø 32 à Ø 160, sans Ø 16, Ø 20 ni Ø 25. Aucun
    diamètre n'est ajouté à la famille de L0.
  - **Inox d'évacuation, série NF EN 1124 provisoire** (TI-685) : de Ø 40 (DN 40) à
    Ø 315 (DN 300). « DN 100 » et « Ø 110 » y sont le même tube ; Ø 108 et Ø 114,3
    n'en sont pas. Elle ne s'ajoute jamais aux clés ni aux recherches génériques des
    séries sous pression ([essais et sources](../testing/takeoff-network-materials.md)).
    Sur un réseau d'évacuation, l'inox reste à justifier : aucune admission automatique
    n'y vient de cette table. Seule exception, les condensats (D18a), où l'inox est
    admis et où les tailles de cette série le sont avec celles des séries sous pression.
- **Série retenue**, selon le réseau et le matériau (`diameterFamiliesFor`) :
  - inox sur un réseau d'évacuation (EU, EV, EU/EV, EUG, EP, VP) : la seule série
    NF EN 1124 provisoire, jamais une série sous pression (TI-684) ;
  - inox en condensats (D18a) : les séries sous pression (à sertir et soudé) et la série
    NF EN 1124 ensemble, une ligne de condensats pouvant être relevée ou gravitaire.
    Ø 22, Ø 40 et Ø 50 y sont admis. Aucune taille absente des tables n'est ajoutée :
    Ø 32, qu'aucune ne porte, reste hors série tant qu'aucune source ne le donne ;
  - PE et PP (TI-683) : les diamètres d'évacuation sur un réseau d'évacuation, les
    diamètres sous pression sur tout autre réseau, les deux en condensats (relevés ou
    gravitaires, comme l'inox) et sur une ligne sans réseau lu. Un « EU PEHD Ø 20 » est
    hors série ; un « EF PEHD Ø 20 » ne l'est pas ;
  - PVC : les diamètres de son code matériau (évacuation ou pression), quel que soit le
    réseau ;
  - tout autre couple, ou une ligne sans réseau lu : les séries du matériau, sans la
    série NF EN 1124.
  - Une seule sélection partout (D18c, TI-684) : la règle DN, la détection des doublons
    entre zones, l'identité des quantités comparées au DPGF et la lecture des tailles
    dans la désignation (voir « Entrées ») lisent la même série retenue, diamètres par
    usage du PVC, du PE et du PP compris depuis la version 4. Un inox
    d'évacuation « DN 100 » et « Ø 110 » y est un seul tube, qui ne rejoint jamais un
    « Ø 108 » ; hors évacuation, l'inox garde ses séries sous pression (Ø 108 est le
    DN 100 à sertir).

**Version 3 de la table** (TI-684, D18a, D18b ; décision D18g) : la raison D18b ne change
aucune clé, mais la version fait partie de chaque clé d'échec (« règle|code|version|partenaire »,
voir « Décisions ») : le passage de la version 2 à la version 3 change toutes les clés
`dn_network`.

- Au prochain recalcul de la version, toute ligne vérifiée d'un job terminé non appliqué
  qui porte un échec `dn_network` est rouverte, quel qu'en soit le code : couples déjà
  justifiés, PE gaz et inox d'évacuation compris, pas seulement les lignes vérifiées sans
  voir la condition. Sa justification technique est à refaire.
- Un override administrateur enregistré avec des clés de la version 2 (multicouche gaz
  par exemple) ne correspond plus à l'application : il est à refaire.
- Les jobs appliqués restent figés avec leurs résultats ; le recalcul ne les réécrit pas.
- Aucune migration ne périme les jobs terminés (D18h), contrairement au passage en
  version 2 : leurs résultats restent ceux calculés avant ce changement (ancien motif du
  multicouche gaz, DN sans condition, doublons d'inox d'évacuation lus dans les séries
  sous pression, vérifications acquises en version 2) jusqu'au prochain recalcul de leur
  version. Ce recalcul suit une modification de ligne, un traitement, une relance
  manuelle ou une application ; celui de l'application ne bloque pas s'il échoue.

**Version 4 de la table** (TI-683) : une taille qui désigne plusieurs tubes échoue là où
elle passait, le PE et le PP se lisent dans les diamètres de leur usage, et les diamètres
du PVC restreignent toutes les lectures (règle, doublons, identité DPGF, lecteur de
désignation), plus seulement la règle. Comme pour la version 3, toutes les clés
`dn_network` changent : les lignes vérifiées qui portent un échec `dn_network` sont
rouvertes au prochain recalcul, un override enregistré avec des clés de la version 3 est
à refaire, les jobs appliqués restent figés et aucune migration ne périme les jobs
terminés. Les entrées déjà écrites (version 1) ne sont pas réécrites : leur taille
vectorielle reste lue des deux façons.

**Acceptation technique** ([`verification.ts`](../../src/lib/takeoff/rules/verification.ts),
migrations `20261107123425_takeoff_network_material_decisions.sql`,
`20261110094500_takeoff_acceptance_reasons.sql` et
`20261110094502_takeoff_acceptance_outline_reason.sql`) : V ne lève un échec `dn_network`
acceptable, quel que soit son code, qu'avec un motif codé et la référence du système
(gamme, fabricant, certificat, conditions d'emploi). Depuis TI-686 (D9), un échec
d'échelle ou de surface imprimée demande aussi son motif codé (voir leurs sections).

- **Motifs** : `system_documented` (système et conditions d'emploi documentés) ; pour le
  PE gaz, seulement `gas_pe_buried_outside` (enterré à l'extérieur, hors emprise du
  bâtiment) ou `gas_pe_facade_transition` (remontée en façade jusqu'au raccord
  métal/plastique). Un motif de PE gaz est refusé sur une conduite qui n'est pas du PE
  en gaz (`TAKEOFF_RULE_GAS_PE_REASON_NOT_APPLICABLE`).
- **Texte** : de 10 à 500 caractères, comptés en points de code une fois retirés les
  blancs ASCII de ses deux bouts (espace, tabulations, retours à la ligne). Même règle
  pour la référence du système et les notes d'échelle et de surface, côté TS
  (`noteText`) et SQL.
- **Forme** : la justification garde la forme plate du réseau (`reason_code`,
  `system_reference`) et ajoute une clé par autre règle (`scale_dimension`,
  `area_printed`). Écrite avec V, elle porte exactement les motifs des échecs de la ligne :
  le serveur retire les autres avant d'écrire. Une mise à jour qui garde V sans la
  réécrire ne la modifie jamais : les motifs exigés doivent y être valides, et le motif
  d'une règle qui n'échoue plus y reste jusqu'à ce que son vérificateur la réécrive.
- La revue ciblée ouvre ce dialogue, une section par échec qui demande un motif ; les
  gestes de validation de la revue complète y conduisent, une fois les modifications en
  cours enregistrées. L'API et le trigger `validate_takeoff_rule_acceptance` refusent
  aussi une écriture directe sans justification valide
  (`TAKEOFF_RULE_JUSTIFICATION_REQUIRED`, `TAKEOFF_RULE_GAS_PE_REASON_REQUIRED`,
  `TAKEOFF_RULE_GAS_PE_REASON_NOT_APPLICABLE`, `TAKEOFF_RULE_AREA_QUANTITY_BELOW_PRINTED`).
- La justification est enregistrée avec la vérification (`verification_justification`)
  et journalisée. Rouvrir la ligne ou modifier son contenu l'efface.
- Un matériau bloqué ne s'accepte jamais (`TAKEOFF_RULE_NOT_ACCEPTABLE`) : corriger la
  ligne ; sinon, seul un administrateur peut forcer l'application, avec un motif codé et
  une justification écrite (voir « Override admin »). La ligne forcée entre alors au devis
  comme provision interne (TI-686, D10). La réserve dans l'offre (TI-682) et la variante
  restent à construire.

**Cas tranchés par TI-685** (l'ancienne liste « à trancher ») :

- à justifier : PVC en eaux grasses, acier galvanisé et PEHD en EF/EFA, cuivre en
  condensats, PEHD en RIA, multicouche en eau glycolée, inox d'évacuation ;
- bloqué : multicouche en gaz ;
- admis : inox en condensats (séries sous pression et NF EN 1124 réunies, D18a) ;
  inchangés : cuivre en eau glycolée, PER en bouclage ECS ;
- pas de DN minimal des EV.

**Reste ouvert** (`AMBIGUOUS_NETWORK_MATERIALS`, preuve ouverte, jamais une permission) :
la série NF EN 1124, dont le second fabricant et DN 90 → Ø 82 restent à recouper. Les
hypothèses non vérifiées (gaz en ERP, cuivre enterré, systèmes RIA, PE d'évacuation
EN 1519) ne sont pas généralisées. Le Ø 56 du PE d'évacuation, courant dans les gammes
des fabricants et absent de la famille de L0, reste hors série tant qu'aucune source
n'est enregistrée (TI-683, à trancher par le métier).

### Aucun tronçon compté à la fois dans Z1 et Z2

**Ensemble comparé** : les lignes de longueur et de calorifuge vectorielles de toutes
les pages d'un même niveau, sur tous les jobs de la version, appliqués compris.

- Deux lignes d'une même page ne sont jamais comparées.
- Deux niveaux non plus.
- Une page sans niveau (ni tri L4, ni nom de fichier) n'est comparée à aucune autre.

**Recalage**
([`registration.ts`](../../src/lib/takeoff/rules/registration.ts), version 1) :

- **Repère commun** : la première page du niveau dans l'ordre des jobs.
- **Méthode** :
  - Les textes imprimés une seule fois sur deux pages proposent des translations : leurs décalages, regroupés à 10 cm près.
  - Les traits du bâtiment décident. Ce sont les traits gris ou quasi blancs du fond d'architecture (jamais un trait quasi noir de couleur : cadres et cartouches), ou ceux d'un calque classé mur, cloison ou fond, quelle que soit leur couleur.
  - Une translation n'est candidate que si au moins 2 de ses textes sont sur le bâtiment : dans le cadre des traits qu'elle fait coïncider, à 1 m près.
  - Elle est retenue si au moins 20 traits tombent sur ceux de l'autre page, extrémités à 5 cm près. Chaque trait de la page de référence ne compte qu'une fois : des traits superposés ne fabriquent ni le soutien ni la dominance d'une translation.
  - Elle doit aussi réunir deux fois plus de traits que la suivante.
  - Elle est ensuite affinée sur ces extrémités. Son erreur résiduelle (RMS) doit rester sous 2 cm.
- **Pourquoi jamais le cartouche** : il est au même endroit des deux feuilles, loin du dessin. Il propose la translation nulle, que les traits du bâtiment refusent dès que le dessin a bougé ; et ses textes, hors du bâtiment, ne la rendent jamais candidate seuls, même quand deux ailes identiques sont tracées au même endroit de la feuille.
- **Composantes** : les pages d'un niveau sont recalées deux à deux. Les pages reliées forment une composante, dans le repère de sa première page. Deux pages de deux composantes n'ont pas de repère commun.
- **Pages sans réseau** (TI-677) : quand deux pages à lignes restent dans des composantes séparées, les pages du niveau sans ligne de réseau (une page d'ensemble qui relie deux zones ; au plus 8, dans l'ordre des pages) proposent une translation entre elles, composée à travers elles. Elle n'est retenue que si les traits du bâtiment des deux pages elles-mêmes tombent l'un sur l'autre (20 traits, extrémités à 5 cm, résidu sous 2 cm après affinage) : la translation affinée sert alors à comparer ces deux pages. Une page d'ensemble légèrement hors d'échelle ne transmet donc jamais son erreur (deux sauts de 1,7 cm chacun décalaient une zone lointaine de plus de 5 cm), et les pages déjà reliées gardent leur propre repère.
- **Comparaison de deux pages** : par leur propre recalage quand elles en ont un, jamais par un chemin qui passe par une troisième page. Trois recalages exacts chacun peuvent ne pas se refermer (une page dessinée 2,5 cm à côté sur une partie du bâtiment) : le chemin dépendrait alors de la première page et pourrait écarter un doublon. Deux pages sans recalage direct se comparent dans le repère de leur composante (limite connue : un cycle qui ne se referme pas peut encore les décaler).
- **Translations seulement** : une vue tournée ou à une autre échelle n'est pas recalée.
- **Résultat** : la translation de chaque page est écrite dans `transform` de sa géométrie (TI-662), comme `[1, 0, 0, 1, dx, dy]`.

**Doublon**
([`zone-overlap.ts`](../../src/lib/takeoff/rules/zone-overlap.ts), version 2) :

- Même réseau, même genre (tuyau ou calorifuge) et même DN, lu par la série que la règle DN retient pour ce réseau et ce matériau (D18c, TI-684) : « DN 100 » et « Ø 110 » d'une même fonte, ou d'un même inox d'évacuation, sont le même tuyau ; l'inox d'un réseau d'évacuation se lit par la seule série NF EN 1124 et son « DN 100 » ne rejoint jamais un « Ø 108 ». L'identité des quantités DPGF lit les tailles de la même façon, sur le réseau que nomme la désignation.
- Un matériau sans série (calorifuge, matériau absent) compare la taille imprimée : « DN 15 » et « DN 20 » d'un calorifuge sont deux tronçons.
- Axes parallèles à 2° près, à moins de **D = 5 cm** l'un de l'autre, sur une longueur commune d'au moins **L = 30 cm**, et de plus d'une bande du dessin à l'échelle la plus grossière des deux pages (49 cm au 1/200).
- La longueur commune est l'union des tronçons couverts, la plus petite des deux directions, arrondie au millimètre (un demi-millimètre vers le haut).
- La distance D est comprise : une copie à 5 cm pile est un doublon. Deux tronçons bout à bout ne se recouvrent sur rien, quel que soit le bruit des calculs ; aucun résultat ne dépend de la page prise pour repère.
- Le minimum vaut pour chaque tronçon continu. Deux morceaux couverts se continuent quand leurs extrémités se touchent à D près (un coude), ou dans le prolongement l'un de l'autre (parallèles, à D de son axe) à moins du minimum : les tirets d'un réseau en pointillés (20 cm, espacés de 5 cm sur B R+4) font un seul tronçon. Quatre contacts de 10 cm en limite de zone, ou trois tuyaux parallèles qui la touchent chacun, ne font pas un doublon.
- La détection ne dépend pas du règlement : une paire, sa longueur commune et son minimum sont les mêmes qu'elle soit isolée ou dans un groupe (voir Résolution).

**Copies lues autrement** (TI-684, décision D14 du 6 nov. 2026 ; version 2 de la règle) :

- Deux lignes de même genre (tuyau ou calorifuge) dessinées au même endroit sur deux pages d'un niveau forment aussi une paire quand leur réseau, leur matériau ou leur DN se contredisent. Avant la version 2, elles n'étaient jamais comparées : le tronçon comptait deux fois sans alerte.
- La règle ne sait pas trancher : soit un même tronçon lu différemment sur l'une des pages (il est compté deux fois et une lecture est fausse), soit deux tuyaux distincts dessinés l'un sur l'autre. Elle échoue les deux lignes en `ZONE_OVERLAP_DUPLICATE` et la raison le dit.
- Le partenaire porte `differs` : ce que les deux lectures ont de différent parmi `network`, `material` et `dn` (« lu autrement (réseau, diamètre) » dans la raison et la revue ciblée). Le diamètre n'est nommé que si les deux tailles imprimées ne désignent aucune taille commune (« DN 100 » et « Ø 110 » en fonte sont une même taille, sur deux réseaux aussi). Un DN non lu contredit un DN lu ; un matériau non lu, ou la nuance non précisée d'un matériau (« inox » à côté d'« inox 316L »), ne contredit rien. Absent quand les deux lignes sont un même tronçon.
- Mêmes seuils que le doublon : D = 5 cm, 2°, L = 30 cm ou la bande du dessin, par tronçon continu.
- **Deux tuyaux côte à côte ne sont pas des copies.** Chaque ligne est d'abord réduite à ce qu'aucune ligne de même lecture ne dessine sur l'autre page ; seuls ces restes sont comparés. Eau froide et eau chaude à 4 cm l'une de l'autre, dessinées sur Z1 et sur Z2, restent deux paires isolées, chacune réglée par sa réduction, et non un groupe de quatre lignes. Une copie exclue explique encore son tronçon : l'exclusion règle une quantité, le tracé reste sur la page. À côté d'une copie, un reste d'au plus D n'en est pas un : deux plans recalés à 1 ou 2 cm près laissent un tel éclat au bout de chaque tiret, et ces éclats mis bout à bout feraient du tuyau voisin une copie lue autrement. Un axe qu'aucune copie ne dessine est gardé entier, même court (les cordes d'un tracé courbe).
- Le règlement est celui de toute paire ou de tout groupe : réduction de la longueur commune, exclusion de la ligne mal lue, ou « Accepter » (V) sur chaque ligne quand ce sont deux tuyaux. Comme tout avertissement de quantité, il ne bloque pas l'application (TI-681).
- Jamais comparés : un tuyau et son calorifuge, deux lignes d'une même page, deux niveaux, deux pages sans repère commun (« zones non recalées » ne vaut que pour deux lignes qui pourraient être un même tronçon).
- Chaque ligne d'une page est mesurée contre toutes celles de l'autre en un seul passage : le coût suit le nombre d'axes des pages, pas le nombre de paires de lectures.

**Résolution**

- Deux lignes partenaires forment une paire ; les lignes incluses reliées par des paires forment un groupe. Le résultat ne dépend jamais de l'ordre des pages ni de celui des lignes.
- Une réduction (longueur mesurée − quantité) dit combien une ligne a retiré, jamais où.
- **Paire isolée** (un groupe de deux lignes) : réglée quand les réductions des deux lignes, chacune au plus la longueur commune, la retirent, à 1 cm près par ligne réduite (les quantités sont arrondies au centimètre).
  - Chaque paire garde son propre minimum : un partenaire au 1/200 ne relève pas celui d'une paire au 1/50.
  - **Ligne figée** (job appliqué) : jamais appelée à changer. Non réduite, elle laisse la correction à la ligne du job courant, et la raison le dit ; réduite avant d'être appliquée, sa réduction compte. Deux lignes figées se jugent de même : un reste entre elles reste visible.
  - Exclure une ligne entièrement en double règle aussi la paire.
- **Groupe de trois lignes ou plus** : aucune correction ne le règle. Chaque ligne reste en `ZONE_OVERLAP_DUPLICATE` jusqu'à ce qu'elle soit exclue (entièrement en double) ou acceptée (V).
  - La raison donne, pour chaque ligne partenaire, la longueur commune ; puis la longueur de la ligne que d'autres lignes dessinent (`overlap_m`) et le nombre de lignes du groupe (`group_size`).
  - Exclure une ligne entièrement en double peut ramener le groupe à une paire, qui se règle alors par sa réduction. Un plan d'ensemble au-dessus de deux zones qui se touchent, exclu, les laisse sans doublon.
- **Pourquoi** (décision du 4 nov. 2026, après quatre tours Codex et deux revues adverses) : c'est un écart voulu à la résolution par défaut du ticket (« corriger une ligne en retirant cette longueur ») pour les groupes. Régler un groupe par ses réductions exige de savoir où chacune a retiré sa longueur.
  - Chaque modèle essayé a laissé passer un double compte : somme par groupe (une réduction réglait un tronçon que sa ligne ne dessine pas), flot sur des tronçons communs, payeurs d'une couverture minimale (une ligne figée supposée payer ce qu'elle n'a jamais retiré ; des lignes qui sortent d'un tronçon commun, 1,5 m compté deux fois et réglé).
  - Le parcours d'acceptation du ticket porte sur une paire Z1/Z2 de deux jobs d'une version, qui se règle toujours par correction. Trois zones en enfilade, ou un plan d'ensemble au-dessus de deux zones, forment un groupe : il faut exclure ou accepter. L'erreur tombe du côté d'un blocage, jamais d'un double compte.
- Une ligne exclue ne bloque jamais. Elle est montrée telle qu'elle serait si elle revenait, avec ses partenaires et leurs groupes.
- « Accepter » (V) lève l'échec de la ligne vérifiée seulement. Un recalcul qui lui apporte un échec qu'elle n'avait pas (un nouveau partenaire, une autre règle, un autre code, une autre version) lui retire sa vérification : voir « Décisions ».
- **Limites connues** :
  - deux tuyaux réellement superposés en plan sur deux pages (une feuille par réseau, par exemple) échouent comme des copies lues autrement : c'est à l'utilisateur de les accepter (V) ;
  - deux copies lues autrement sur deux pages sans repère commun ne sont pas signalées ;
  - une copie mal lue qui prend exactement la lecture d'un tuyau voisin (à moins de 5 cm, dessiné sur les deux pages) passe pour ce voisin : elle n'est pas signalée ;
  - une ligne dont le réseau n'est pas lu n'est comparée à aucune autre : sa copie n'est pas signalée ;
  - la règle du plan agrandi (D14 : le détail fait foi dans son périmètre, le plan d'ensemble contrôle la couverture) n'est pas appliquée : un détail et son plan d'ensemble se règlent comme tout doublon ;
  - une sous-comptabilisation (un tronçon retiré de ses deux copies) n'est pas signalée ;
  - dans une paire, la réduction n'est pas localisée : une ligne réduite pour une autre raison règle aussi sa paire ;
  - un groupe ne se règle que par exclusion ou V, même quand une correction était juste.

**Zones non recalées** : deux lignes qui pourraient être un même tronçon, sur deux
pages sans repère commun, échouent toutes deux en `ZONE_OVERLAP_UNREGISTERED`.

**Valeurs de départ** (mesurées le 3 nov. 2026 sur B R+4 Z1/Z2, hors réserve, figées
avant la réserve) :

- **Recalage** : translation de 42,43 m × 6,57 m, résidu 2,4 mm, 335 traits contre 0 pour la translation suivante.
- **Doublons** : 325 m d'axes en double à moins de 0,5 cm, 11 m entre 0,5 et 2 cm, aucun entre 2 et 5 cm.
  - Les premiers tuyaux distincts d'un même réseau sont à 8,6 cm. D = 5 cm tombe dans ce creux.
  - Le plus petit doublon mesuré fait 42 cm. Deux tronçons bout à bout à la limite de zone se recouvrent au plus d'une bande (7 pt : 12 cm au 1/50, 25 cm au 1/100). D'où L = 30 cm.

### Échelle du cartouche cohérente avec les cotes

Elle reprend le résultat par page de TI-662 (`scale.ts`, tolérance de cote
`COTE_RELATIVE_TOLERANCE`), sans second seuil.

- Une ligne en ml ou en m² échoue sur une page dont une cote contredit l'échelle (`dimension_mismatch`).
- La page d'une ligne du modèle est celle de son propre document (`metadata.source_document` : fichier du jeu de plans ou téléversement du job) et de son numéro, jamais celle d'un autre fichier de même nom. Une ligne sans document, ou deux pages encore confondues, prend la page dont l'échelle est contredite s'il y en a une (sens sûr).
- Les comptages ne sont pas concernés.

**Acceptation (TI-686, D9, règle en version 2).** V exige un motif codé et ce qui a été
vérifié, de 10 à 500 caractères (clé `scale_dimension` de la justification). Calibrer la
page règle l'échec pour toutes ses lignes, sans motif. Motifs, provisoires jusqu'à
l'accord du métier :

| Code | Motif |
|---|---|
| `scale_confirmed_by_other_dimensions` | Échelle confirmée par d'autres cotes concordantes de la page |
| `dimension_not_to_scale` | Cote contradictoire hors échelle (tronçon interrompu, mention non à l'échelle) |
| `quantity_from_dimensions` | Quantité établie d'après les cotes, sans mesure graphique |
| `scale_confirmed_by_issuer` | Échelle confirmée par l'émetteur du plan |

La version 2 entre dans la clé d'échec : au prochain recalcul, une ligne vérifiée sans
motif est rouverte. La clé reste sans partenaire : une page recalibrée mais toujours
contredite garde son motif.

### Aire du polygone cohérente avec la surface imprimée

Le contrat validé le 8 novembre 2026 est décrit dans
[Quantités de référence et métré](quantites-reference-metre.md). La règle
`area_printed` est en version 3 (TI-686, D9) ; les règles géométriques de chevauchement et de
boîte conservent leur version et leurs seuils.

- Comparer la mesure originelle (géométrie, sinon mesure conservée du worker),
  jamais la quantité chiffrée corrigée.
- Vérifier la base de l'étiquette, celle de la prestation et l'échelle. Le sol
  net par défaut de la prestation ne prouve pas la base d'une étiquette sans
  précision ; SHAB et contour net restent des bases différentes.
- Cumuler les écarts absolus des contributions rattachées à la même ligne de
  devis ; demander une revue lorsqu'ils dépassent strictement 1 % de sa
  référence. Un rattachement ambigu ne permet pas de grouper les quantités.
- Conserver une identité du contexte comparé dans les clés d'échec : changer
  une contribution ou son rattachement rouvre une acceptation antérieure.
- Garder dans le résultat la base attendue par la ligne de prix
  (`details.expected_basis` : `net_floor` ou `shab`, absente quand elle est inconnue),
  y compris à la dernière borne de stockage. Cette base fait déjà partie du contexte
  comparé (`quantity_context_key`, donc de la clé d'échec) : la recopier dans le résultat
  ne change aucune clé.

**Acceptation (TI-686, D9).** V exige un motif codé, la base reconnue à la surface écrite
et une note de 10 à 500 caractères (clé `area_printed` de la justification). Motifs et
bases, provisoires jusqu'à l'accord du métier :

| Code | Motif |
|---|---|
| `printed_area_basis_identified` | Base de la surface écrite identifiée (légende, cartouche, tableau des surfaces) |
| `measured_outline_retained` | Contour mesuré retenu : la surface écrite ne couvre pas le même périmètre |
| `confirmed_by_other_document` | Base et surface confirmées par un autre document (CCTP, DPGF, notice) |
| `deviation_explained` | Écart expliqué (gaines, trémies, arrondi de l'étiquette) |

Bases de la surface écrite (`retained_basis`) : `net_floor` (sol net), `shab` (SHAB),
`other` (autre base, à préciser dans la note).

- **Même base que la ligne de prix** (D17) : les deux surfaces se comparent et la plus
  élevée est retenue. V exige une quantité au moins égale à la surface écrite, au
  millième près (`TAKEOFF_RULE_AREA_QUANTITY_BELOW_PRINTED`). La quantité se relève
  avant V, dans un enregistrement à part (« Retenir … m² » dans le dialogue) : une
  quantité modifiée dans la même requête rend les règles à recalculer et V serait
  refusé.
- **Même base, motif « contour mesuré retenu »** (D21) : la surface écrite ne couvre
  pas le même périmètre que le contour mesuré, donc rien n'est comparé. La quantité
  reste celle de la ligne ; le dialogue ne propose pas de retenir la surface écrite.
  Ce n'est pas toujours la mesure : une pièce vectorielle dont l'étiquette dit « sol
  net » est enregistrée à la création au maximum du contour et de la surface écrite.
  Les trois autres motifs gardent la règle D17 sur la même base.
- **Autre base, ou base de la ligne inconnue** : rien n'est comparé, la quantité reste
  celle de la ligne ; la surface écrite reste visible dans le contrôle.
- La base déclarée (`retained_basis`) n'entre ni dans la clé d'échec ni dans le contexte
  comparé. La version 3 rouvre, au prochain recalcul, toute ligne vérifiée sans motif ni
  base.

La proposition historique `max(2 %, 0,1 m²)` reposait sur seulement deux
polygones de pièce fermés du banc (D RDC, hors réserve), dont un juste à −0,1 % et
une boîte à −69,8 %. Elle est remplacée pour ce contrôle quantitatif ; elle ne
constitue plus le seuil applicable.

### Pièces sans chevauchement

L'aire commune de deux pièces d'une même page est échantillonnée sur une grille de
5 cm, plus fine quand le recouvrement est étroit (un vingtième de son petit côté). Elle
échoue au-delà de max(2 % de la plus petite pièce ; 0,1 m²).

Deux pièces qui partagent un mur se touchent sans aire commune. Valeur provisoire,
comme l'aire.

**Pièce à trous** (TI-677) : le sol d'une pièce remplie (L3c) laisse de côté ce qu'il
entoure (une autre pièce, un noyau). Son contour extérieur vient avec ces trous
(`holes_m` de sa géométrie, au plus 16 de 200 points), et l'aire commune ne compte que
le sol de chaque pièce : un hall de 10 × 10 m autour d'un bureau de 2 × 2 m n'est plus
lu en chevauchement. Une pièce dessinée sur le sol du hall, hors du trou, échoue
toujours. Changement minimal dans le périmètre de TI-662 (`vectors/fill.ts`,
`surfaces.ts`, `persistence.ts`) : le contour lui-même ne change pas.

### Baignoires, placards et gaines en boîtes fermées

Échoue :

- un libellé de baignoire, placard, gaine, gaine technique ou GT ;
- ou un contour à 4 coins de moins de la moitié de la surface imprimée : une boîte dessinée autour du libellé, pas la pièce.

Une surface proposée par le modèle, sans libellé ni contour, n'est pas lue.

### Quantités non observables

Un plan ne montre ni soudure, ni piquage, ni support, ni tronçon vertical (chute,
colonne montante, descente), ni transport, ni pose seule, ni prestation (essais,
mise en service, DOE…).

- **La tête de la désignation décide** : son texte avant « y compris », « avec », « compris », une virgule, un point-virgule, une parenthèse ou un « + », après « fourniture et pose de ». Elle doit s'ouvrir sur le mot. « Tube cuivre … y compris supports » reste un tube, « Robinet d'essai » un robinet.
- **Un organe dessiné reste observable**, quel que soit le mot qui le suit : « Vanne avec support », « Pompe … y compris mise en service ».
- **« Vertical » ne porte que sur les longueurs.**
- Une telle ligne échoue tant que l'utilisateur n'a pas saisi sa quantité : une saisie attestée avec sa catégorie, même égale à la quantité du modèle (1 ens de mise en service).
- **Catégorie de saisie (TI-686, D12).** La saisie dit sur quoi repose la quantité, parmi six catégories (liste provisoire, en attente de l'accord du métier) :

  | Code | Libellé |
  |---|---|
  | `site_survey` | Relevé chantier |
  | `other_drawing` | Autre plan ou coupe |
  | `dpgf_cctp` | DPGF ou CCTP |
  | `written_confirmation` | Confirmation écrite |
  | `documented_calculation` | Calcul documenté |
  | `hypothesis` | Hypothèse |

  - « Ce qui fonde la quantité » est une note : obligatoire pour une hypothèse, de 10 à 500 caractères (ce qui est supposé, ce qui reste à confirmer) ; facultative, 500 caractères au plus, pour les cinq autres. Elle se mesure comme les notes d'acceptation : en caractères, sans les blancs ASCII des deux bouts.
  - **Une modification nue de la quantité ne règle plus l'échec** : la règle reste en version 1. Une ligne modifiée sans catégorie échoue de nouveau, avec sa propre clé, et V ne l'a jamais acceptée.
  - Le serveur lit la catégorie, pas l'auteur : une saisie survit à la suppression de son auteur. Une saisie attestée avant D12, sans catégorie, repasse « à saisir » au prochain recalcul. Aucune donnée n'est réécrite.
  - Une quantité saisie en « Hypothèse » entre au devis comme hypothèse : une provision interne à confirmer, que le client voit comme une ligne chiffrée ordinaire (voir « Override admin », provision interne).
- La vérifier ne la règle jamais : `acceptable: false`. Une ligne qui porte aussi un échec acceptable ne s'accepte pas non plus tant que sa quantité reste à saisir : la base refuse V (`TAKEOFF_RULE_NOT_ACCEPTABLE`), et la revue ciblée ne le propose pas.

## Blocage et branchement (L5b)

Une ligne incluse est bloquée par ses règles quand l'une de ces conditions est vraie :

- ses résultats sont à recalculer (« stale ») ;
- une règle échoue et la ligne n'est pas vérifiée ;
- une règle échoue sans être acceptable.

C'est le prédicat de [`blocking.ts`](../../src/lib/takeoff/rules/blocking.ts). Le trigger
SQL l'applique par `takeoff_item_rule_blocked`, `checkApplyGuard` par `blockingRules` :
les deux bloquent les mêmes lignes (option A, migration
`20261103213336_takeoff_quantity_rules.sql`).

**Stockage**, sur `takeoff_items`, écrit par le worker ou le serveur avec le service,
jamais par un client :

- `rule_results` : un résultat par règle qui lit la ligne ;
- `rules_evaluated_at` : quand les règles ont tourné ;
- `rules_stale` : la ligne a changé depuis.

Ces colonnes sont hors de la liste blanche de `enforce_authenticated_takeoff_item_fields`.
L'écrivain `write_takeoff_rule_results`, réservé au service :

- n'écrit jamais une ligne modifiée depuis sa lecture, ni une ligne d'un job appliqué ;
- n'écrit rien si la version a changé depuis que le calcul l'a lue (`takeoff_rule_version_stamp`, sous un verrou par version) : un calcul plus ancien n'écrase jamais un plus récent ;
- laisse de côté, sans l'attendre, un job qu'une application tient ;
- déplace `updated_at` lorsqu'une ligne acquiert un nouvel échec, même si elle attend déjà une vérification.

Les résultats sont bornés avant écriture (raison de 1 000 caractères, 50 partenaires, puis 64 Kio de texte jsonb, voir
« Bornes, seuil et sérialisation ») : toute lecture les accepte et la colonne les stocke.

Lorsqu'un résultat masque des partenaires, le serveur conserve leurs clés complètes dans
`takeoff_internal.rule_failure_proofs` et une empreinte de l'ensemble dans le résultat affiché.
Un ajout ou un remplacement rouvre la vérification, y compris au-delà du dernier partenaire visible.
Un retrait seul conserve la vérification et invalide la dérogation accordée à l'ancien ensemble.
Un simple changement d'ordre conserve les deux décisions. Un ancien calcul tronqué sans preuve
rend la ligne périmée jusqu'à un recalcul complet.
Pendant une sauvegarde, l'écran peut recevoir de nouveaux résultats avant d'avoir envoyé le clic
de vérification. Il rejoue ce clic si les empreintes sont identiques ou si toutes les nouvelles
clés sont déjà visibles dans la révision précédente. Sinon, il demande une nouvelle vérification.

**Niveaux** : les raisons des règles s'appliquent à toute ligne qui porte des entrées de
règles, en B comme en C ; les raisons existantes (confiance faible, preuve, page)
restent en C. Le garde TS et le trigger tournent donc sur tous les niveaux.

- Les items mesurés par L3 sont créés dans le job de niveau C qui a lu le plan.
- Les lignes que le plan de mapping exclut (`skip`, ouvrage) ne comptent pas, des deux côtés.
- **Règles croisées et exclusions du plan** (TI-677, migration `20261104224500_takeoff_rule_cross_exclusions.sql`) :
  un doublon (`ZONE_OVERLAP_DUPLICATE`) ou une pièce recouverte (`ROOM_OVERLAP`) qui nomme
  tous ses partenaires (leur nombre est stocké : `partner_count`, `overlap_count`) ne
  bloque plus quand ils sont tous laissés de côté. C'est le cas d'un partenaire que le plan
  saute ou replie dans un ouvrage (l'ouvrage est inséré à la quantité 1, jamais depuis la
  ligne) : la RPC l'exclut avant que le trigger compte. Même test dans `blocking.ts`
  (`leftOutByPartners`) et en SQL (`takeoff_rule_failure_left_out`) ; la route lit les
  partenaires des autres jobs tels que la base les tient. Continuent de bloquer : un
  partenaire inclus ou inconnu, une liste coupée, des zones non recalées, des résultats
  calculés avant cette version (sans compte).

**Refus** : 422 `TAKEOFF_APPLY_GUARD_FAILED`.

- Chaque ligne bloquée porte ses raisons ; pour les règles, `rule_codes` et `rule_reasons`, dans le même ordre.
- Un refus du trigger porte `guard: "database"`.

**Override admin : gardé.**

- C'est la seule voie pour appliquer une ligne bloquée (depuis TI-681 : preuve localisée ou page manquante en
  niveau C, résultats à recalculer, matériau bloqué ou autre échec d'une règle bloquante) : seul un administrateur du
  tenant peut forcer l'application, ligne par ligne, avec un motif codé et une justification écrite de 10 à 500
  caractères, journalisés dans `audit_logs` et jamais imprimés pour le client.
- **Motif codé par ligne** (TI-686, D10 et H7, migration `20261110094504_takeoff_apply_force_reasons.sql`). Listes
  provisoires jusqu'à l'accord de Max :

  | Code | Motif | Vaut pour |
  |---|---|---|
  | `rule_false_positive` | Faux positif de règle | une ligne dont une règle en échec la bloque, résultats lisibles et à jour ; `false_positive_rules` nomme la ou les règles fautives parmi elles, sans doublon |
  | `additional_evidence` | Preuve complémentaire | toute ligne |
  | `engineer_or_client_confirmation` | Confirmation BET ou client | toute ligne |
  | `controlled_correction` | Correction contrôlée | toute ligne |
  | `duplicate_resolved` | Doublon résolu | un échec bloquant `zone_overlap` ou `room_overlap`, résultats lisibles et à jour |
  | `priced_hypothesis` | Hypothèse chiffrée | toute ligne |

  - Les échecs qui comptent sont ceux qui bloquent la ligne, au sens de TI-681 (`takeoff_item_rule_blocked`,
    `checkApplyGuard`) : un avertissement de quantité (échelle, surface écrite, doublon entre zones, pièces qui se
    chevauchent, DN manquant…) ne bloque jamais, donc ne se déclare pas en faux positif. Aujourd'hui, seuls les échecs
    de matériau de `dn_network` (interdit, à justifier, PE gaz, bloqué) peuvent bloquer : « Doublon résolu » ne vaut
    que pour un chevauchement sous un code que cette version ne connaît pas (écrit par une autre version des règles),
    qui garde sa protection et bloque.
  - Des résultats illisibles (lus comme vides et à recalculer par la route) ou à recalculer n'admettent que les quatre
    motifs inconditionnels.
  - La requête d'application porte `override: true`, `forced_justifications` (chaque texte une fois) et
    `forced_items: [{ item_id, reason_code, false_positive_rules?, justification_index }]`, sans plafond de lignes.
    Une ligne bloquée sans entrée, ou dont le motif ne vaut pas pour elle, refuse le forçage (422 `VALIDATION_ERROR`,
    `guard: "override_reasons"`, `missing_item_ids`, `invalid_items`) ; les entrées des lignes non bloquées sont
    écartées. L'ancien `override_justification` est refusé (422).
  - L'audit `takeoff.apply.override` porte les mêmes champs, lignes triées par identifiant et justifications
    dédoublonnées, sans justification de premier niveau ni `rule_codes` (les `rule_results` des jobs appliqués sont
    figés). Le trigger vérifie chaque entrée (`private.takeoff_apply_forced_item_valid`) et refuse l'ancien format,
    sans fenêtre de transition (H10).
  - Dans l'assistant, le panneau « Forcer l'application » donne, par ligne bloquée, le motif, la règle fautive et la
    justification ; « Appliquer à la sélection » recopie un motif et un texte, et « Forcer l'application (N lignes) »
    n'est actif que lorsque toutes les lignes sont complètes. Un ingénieur ne voit pas ce panneau.
- **Provision interne** (TI-686, D10 et D12, migration `20261110094503_takeoff_apply_provisions.sql`). Toute ligne
  forcée entre au devis comme provision interne, quelle que soit la protection qui la bloquait encore (H8) : preuve
  localisée ou page manquante en niveau C, résultats à recalculer, échec d'une règle bloquante comme un matériau
  bloqué. Une confiance faible ne bloque plus depuis TI-681 : elle ne force rien et ne fait pas de provision. Une
  quantité saisie avec la catégorie « Hypothèse » y entre aussi, sans forçage, comme hypothèse. Depuis TI-682 lot C
  (migration `…_takeoff_hypothesis_provision_marker.sql`), toute hypothèse au sens de
  `public.takeoff_item_hypothesis_cause` y entre de même : une quantité estimée ou qu'un plan ne montre pas, que son
  relecteur a incluse sans la saisir (touche I de la revue ciblée, inclusion de la revue complète).
  - L'application écrit `source_metadata.takeoff_provision` sur la ligne du devis, dans sa propre transaction et par
    ses deux variantes (sans DPGF et avec l'autorisation DPGF) : `{ version: 1, job_id, sources: [{ takeoff_item_id,
    forced, forced_reason, entry_category, hypothesis_cause }] }`. Les sources sont les lignes de métré forcées (celles
    de l'audit consommé pour ce job, avec leur motif codé dans `forced_reason` depuis la migration
    `20261110094504_takeoff_apply_force_reasons.sql`) ou qui sont des hypothèses ; une ligne DPGF rapprochée ne nomme
    que celles-là. `hypothesis_cause` dit pourquoi une source est une hypothèse (`entered_hypothesis` saisie comme
    telle, `estimated`, `non_observable`), ou vaut `null` ; le marqueur reste en version 1 et un marqueur écrit avant,
    sans cette clé, se lit comme avant. Les estimations déjà appliquées ne sont pas reprises. Une ligne de
    longueur dont les tronçons sont regroupés et arrondis une seule fois (TI-681) nomme les sources provisionnées de
    tous ses tronçons. Les lignes d'un ouvrage créé depuis une hypothèse gardent le marqueur.
  - Le marqueur décrit des faits : la dernière application l'emporte (il est retiré d'une ligne fusionnée sans source
    provisionnée), il suit les copies et survit à une modification manuelle. Ce n'est pas une garde : seul le devis
    interne l'affiche, « Provision interne » ou « Hypothèse » (vérité de ligne, explication de ligne). Une source dont
    `hypothesis_cause` n'est pas nul se lit « Hypothèse », et le détail dit pourquoi : quantité saisie sur hypothèse,
    quantité estimée sans mesure sur un plan, ou quantité qu'un plan ne montre pas, comptées sans saisie.
  - Les exports CSV internes le portent (TI-682, lot C ; H12 levé pour le CSV) : le CSV d'une v3, écrit par le serveur,
    et le CSV d'une v1/v2, écrit par l'éditeur, ont une dernière colonne « Provision métré », après toutes les autres
    (ventilation atelier/chantier comprise). Elle vaut « Provision interne » pour une source forcée, « Hypothèse » pour
    une source qui est une hypothèse (saisie, estimée, non observable) ou forcée en « Hypothèse chiffrée », et reste
    vide sans marqueur ; un marqueur illisible s'y lit « Provision interne », jamais vide. La lecture des lignes par
    l'éditeur garde le marqueur d'une
    ligne issue d'une structure IA ou d'un ouvrage généré, que leur provenance réécrit.
  - Le détail interne d'une ligne forcée donne son motif codé et nomme ce qu'un forçage lève (preuve localisée ou
    page source manquante, règles à recalculer, règle bloquante en échec) : depuis TI-681, une ligne forcée n'est pas
    une quantité non vérifiée en soi, et le marqueur ne dit pas laquelle de ces protections la bloquait. Une ligne
    forcée en « Hypothèse chiffrée » s'affiche comme hypothèse, forcée et non saisie. Quand une source est elle-même
    une hypothèse (TI-682 lot C), le détail dit d'abord pourquoi, dans cet ordre : quantité saisie sur hypothèse,
    estimée, puis qu'un plan ne montre pas ; une ligne aussi forcée s'affiche alors comme cette hypothèse, sans son
    motif de forçage.
  - Le client voit une ligne chiffrée ordinaire : son montant est la provision. Aucune sortie client ou fournisseur
    (copie commerciale, PDF, portail, classeurs standard, DPGF et BDC) ne porte le marqueur ni la colonne « Provision
    métré » : ces classeurs peuvent partir chez un client ou un fournisseur. Les tests de garde le vérifient
    (`takeoff-provision-exports.test.ts`, `dpgf-export.test.ts`, TKF02).
  - Le choix explicite d'une réserve dans l'offre (TI-682) sera rangé hors du marqueur, sous la clé réservée
    `offer_treatment`, que rien n'écrit ni ne lit encore ; le traitement par défaut reste la provision interne.
- **Faux positifs déclarés au forçage** (TI-686, D10 et H19, migration
  `20261110094505_takeoff_override_consumptions_admin_read.sql`). Le suivi des métrés des administrateurs publie, par
  règle, sur les jobs appliqués de la période (section « Forçages par règle ») :
  - « Lignes en échec appliquées » (N) : les lignes non exclues où la règle échoue, y compris celles dont V a
    accepté l'échec, sauf un échec laissé de côté (partenaires tous exclus parmi les lignes du job ; un partenaire
    d'un autre job compte comme présent) ;
  - « Forcées » : celles d'un audit de forçage consommé dont l'échec de cette règle bloquait la ligne au sens de
    TI-681. Un avertissement de quantité ne bloque jamais : l'échelle, la surface écrite, les chevauchements, les
    boîtes fermées et les quantités à saisir n'ont ni ligne forcée ni faux positif, et le N de `dn_network` compte
    aussi ses avertissements (réseau, matériau ou DN manquant, DN hors série) ;
  - « Faux positifs déclarés au forçage » (n) : celles forcées en `rule_false_positive` qui nomment la règle. Un
    échec accepté par V n'y entre jamais (H19), même s'il était un faux positif : seul n l'écarte, pas N ;
  - le taux observé n/N, sans taux quand N = 0, avec la mention « Taux observé sur l'effectif affiché : un
    indicateur, pas une borne de fiabilité. ». Une règle dont tous les échecs sont des avertissements de quantité
    n'a pas de taux mais « Sans objet » (`canBlock` faux), plutôt qu'un 0 % qui la ferait passer pour fiable ; un
    code qu'une autre version des règles a écrit garde sa protection et peut bloquer : la règle a alors son taux si
    une ligne a été forcée sur cet échec dans la période. Le texte de la section dit ce que comptent n et N.
  - Les lignes d'un job appliqué sont figées, leurs `rule_results` aussi : le calcul
    ([`stats-forcing.ts`](../../src/lib/takeoff/stats-forcing.ts)) les relit tels qu'ils ont été appliqués, et un audit
    non consommé ne compte pas. La route lit les consommations avec le client de l'administrateur : la politique
    « Admins can view override consumptions » donne aux administrateurs du tenant la lecture seule de
    `takeoff_apply_override_consumptions` (H11) ; un ingénieur n'en lit aucune, et aucune écriture n'est ouverte.
- La réserve dans l'offre (TI-682) et la variante restent à construire.
- L'audit `takeoff.apply.override` doit nommer toutes les lignes bloquées, anciennes et nouvelles raisons.
- Le trigger refuse un audit qui en oublie une.
- Il consomme l'audit une seule fois.
- Il est lié à l'état de chaque ligne levée (TI-677 PR D, voir « Décisions »).

**Décisions** (TI-677 PR D, migration `20261105020000_takeoff_rule_decisions.sql`, décisions
validées par Thanh le 5 nov. 2026) :

- **Clés des échecs** : une par règle en échec, code, version et partenaire,
  « règle|code|version|partenaire ». Le TS ([`failure-keys.ts`](../../src/lib/takeoff/rules/failure-keys.ts))
  et le SQL (`takeoff_rule_failure_keys`) les lisent de la même façon dans le JSON stocké ;
  vitest et pgTAP partagent la même table de cas.
- **Vérification rouverte** : l'écrivain retire la vérification d'une ligne dont les nouveaux
  résultats portent une clé qu'elle n'avait pas. Un échec qu'un partenaire apporte après le V ne
  passe plus pour réglé sans que personne ne l'ait vu. Un échec ou un partenaire qui disparaît se
  ferme seul. `updated_at` bouge : une revue qui avait lu la ligne la relit avant de l'enregistrer.
  Le système l'inscrit au journal dans la même transaction, avec l'auteur de la vérification
  retirée (`before_data`). Le prédicat de blocage ne change pas.
- **Journal** : les décisions d'un utilisateur (vérification, exclusion et motif, quantité et
  saisie, désignation, unité, page, preuve) sont écrites par trigger dans la transaction de
  l'enregistrement, au nom de la session et à l'heure du serveur. Un enregistrement ne réussit
  plus sans sa trace. Les changements propres à une application restent journalisés par la route
  (`takeoff.mapping.applied`).
- **Motif d'exclusion** : exigé par la base pour un client connecté (exclure, ou garder exclue
  une ligne en changeant son motif) et par l'API (le motif d'une ligne exclue ne s'efface pas).
  Les lignes exclues avant gardent leur état.
- **Override lié à l'état** : l'audit enregistre, pour chaque ligne levée, sa quantité, son unité,
  son `updated_at`, les clés de ses échecs et sa péremption
  ([`apply-override-state.ts`](../../src/lib/takeoff/apply-override-state.ts)). Une ligne qui change
  ensuite demande un nouvel override, comme un audit qui n'enregistre aucun état. Une ligne que
  l'application renomme elle-même (règle de mapping) garde l'override si aucune décision n'a été
  journalisée sur elle depuis.

**Recalcul** (`recompute-server.ts`), pour toute la version :

- quand un job s'achève (worker) ;
- après chaque correction ou exclusion (PATCH des lignes) ;
- avant chaque application.

TI-677 : une tentative interrompue, ou dont des écritures ont été sautées après
une modification concurrente, est reprise une fois depuis une nouvelle lecture.
Après ces deux tentatives au plus, les lignes encore périmées restent bloquées.
Les deux revues affichent « Règles à recalculer » et l'action « Recalculer les
règles » au niveau du job. Cette action exige le même tenant, un rôle opérateur
et un job terminé ; elle ne modifie aucune quantité. Le chargement de son résultat
n'écrase jamais une sauvegarde commencée depuis son lancement.

Une version sans entrées de règles passe par une seule sonde d'existence, sans
charger ses lignes ni sa géométrie. Cette sonde ne dépend pas du drapeau du worker :
des entrées déjà écrites continuent de protéger la version quand il est éteint.
L'application périme les règles des autres jobs terminés de la version : le calcul
suivant tient compte des lignes sautées ou repliées dans un ouvrage.

Le PATCH renvoie les états de règles seulement si la lecture est complète, à
100 lignes et 256 Kio au plus. Sinon, `rule_states_refresh_required` exige une
relecture paginée ; la revue conserve les saisies en cours et marque les anciennes
règles comme périmées jusqu'à cette relecture. Aucun préfixe incomplet ne passe
pour l'état de tout le job.

Les actions guidées « Retirer » (réduction ou exclusion complète, clic comme E)
transmettent le `rules_evaluated_at` affiché. La base le compare sous le verrou
de version et refuse aussi une ligne périmée. Une décision sur un partenaire
rend donc l'ancienne proposition inutilisable, même si `updated_at` de cette ligne
n'a pas bougé. Le dialogue d'exclusion conserve le calcul vu à son ouverture.

Un client qui modifie la quantité, son attestation de saisie (son auteur ou sa catégorie),
l'unité, l'exclusion ou la page (lue par la règle d'échelle) d'une ligne évaluée périme ses résultats
(trigger) : la ligne bloque jusqu'au recalcul serveur. Une désignation modifiée ne
change pas les entrées des règles, lues une fois par le worker.

Les règles d'une ligne lisent les autres lignes de sa version (un tronçon dessiné sur
deux plans de zone, deux pièces d'une page). Quand une ligne devient périmée (une
modification client) ou arrive périmée (les nouvelles lignes du worker), les lignes
évaluées des jobs non appliqués de la version le deviennent aussi (trigger
`stale_takeoff_rule_peers`). Si le recalcul serveur échoue ou est sauté, l'état stocké
les bloque, dans le trigger comme dans `checkApplyGuard` : jamais un ancien « passe »
appliqué. Seul ce drapeau bouge, `updated_at` reste le jeton de la revue.

Chaque invalidation date la ligne (`rules_stale_at`), même déjà périmée, et même une
ligne qui attend sa première évaluation (écrite périmée par le worker).

Un job qui passe à « terminé » rejoint les lignes que lisent les règles de sa
version : à ce passage, les lignes de ses jobs non appliqués sont rendues périmées à
nouveau (trigger `stale_takeoff_rule_lines_on_completion`). Un calcul lancé entre
l'écriture de ses lignes et ce passage ne lisait que les jobs terminés, et a pu lever
l'invalidation de leur insertion : jamais un « passe » qui ignore le nouveau job. L'écrivain
n'écrit une ligne que telle que le calcul l'a lue, `updated_at` et `rules_stale_at`
compris : un calcul qui l'a lue avant l'édition d'un partenaire, même validée après
son contrôle de l'empreinte de version, ne lève jamais cette invalidation.

**Saisie d'une quantité à saisir** : `quantity_entered_by`, `quantity_entered_at`,
`quantity_entry_category` et `quantity_entry_note` (TI-686 D12, migration
`20261110094501_takeoff_quantity_entry_category.sql`).

- Ils sont attestés par leur auteur, comme `is_verified` : une attestation porte sa catégorie, sinon la base la
  refuse (`TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID`).
- La catégorie et la note ne changent qu'avec une nouvelle attestation (`quantity_entered_at`), jamais seules.
- Tous sont effacés quand la quantité change sans nouvelle attestation.
- La base vérifie la liste des catégories et la note (contraintes `check`) ; le journal porte la catégorie et la
  note, comme les autres champs de la revue.
- Le PATCH les pose avec `quantity_entry: { category, note? }` : le serveur écrit l'auteur et l'heure. Une
  hypothèse sans note de 10 caractères est refusée avec « Une hypothèse doit dire ce qui est supposé (10 à 500
  caractères). ». L'ancien `quantity_entered: true` est refusé avec la requête (422 `VALIDATION_ERROR`).

**Activation** : le worker n'écrit les entrées de règles (et les ancres de recalage des
pages vectorielles) qu'avec `MERGEONE_TAKEOFF_RULES=1`.

- Sans elles, aucune règle ne lit la ligne : rien ne change pour un job sans entrées.
- Le recalcul tourne dès qu'une version a des lignes qui en portent.

### Bornes, seuil et sérialisation (TI-677, prérequis de l'activation)

Migration `20261104215000_takeoff_rule_bounds_and_serialization.sql`.

- **Taille mesurée comme la base la mesure** : les contraintes portent sur
  `octet_length(valeur::text)` du jsonb (`, ` et `: `, nombres en notation décimale,
  caractères en UTF-8). [`jsonb-size.ts`](../../src/lib/takeoff/rules/jsonb-size.ts) mesure
  la même chose avant l'écriture ; pgTAP vérifie les mêmes tailles. Un NUL ou un
  demi-surrogate ne se stocke pas.
- **Résultats ≤ 64 Kio** : `boundRuleResults` essaie des bornes de plus en plus
  courtes (désignations des partenaires, raison, partenaires gardés par longueur
  commune décroissante, pièces recouvertes), puis, en dernier recours, une raison
  courte et les seuls nombres des détails : des résultats valides tiennent toujours.
  Code, statut, « acceptable », longueur comptée deux fois, taille du groupe et aire
  recouverte ne changent jamais. L'écrivain SQL n'écrit pas une ligne hors bornes
  (elle garde son état) au lieu d'échouer tout son lot.
- **Ancres ≤ 256 Kio** : `pageAnchors` écarte les textes non stockables, puis les
  textes les plus courts (toutes les lignes de bâtiment sont gardées) ; le worker
  borne encore avant l'insertion de la page. Une page trop chargée n'écarte plus la
  lecture vectorielle du job. Le banc lit les mêmes ancres.
- **Seuil de confiance basse** : une seule lecture, `parseLowConfidenceThreshold`
  (garde TS, moniteur, revue) et `takeoff_low_confidence_threshold` (trigger). Espaces
  rognés comme `trim()` de JS, décimal d'au plus 100 caractères (exposant de 3
  chiffres au plus, ni hexadécimal ni « Infinity »), entre 0 et 1, sinon 0,5 ; puis
  arrondi au 1e-4 supérieur, la précision des confiances stockées : les mêmes lignes
  bloquent qu'avec la valeur exacte, et l'audit d'un override porte la valeur que le
  trigger compare.
- **Enregistrements d'une version sérialisés** : la revue enregistre une ligne par
  `update_takeoff_item_for_review`, qui prend le verrou de la version (celui de
  l'écrivain) avant celui de la ligne. L'invalidation des voisines, l'insertion du
  worker et la complétion d'un job prennent ce verrou avant de verrouiller des
  lignes (quand les règles en lisent), et l'application d'un job aussi, avant la
  ligne de son job. Deux enregistrements d'une même version s'attendent au lieu de
  s'interbloquer ; l'écrivain, le worker et l'application aussi. Un enregistrement
  pendant l'application d'un autre job de la version attend sa fin, au lieu d'échouer
  sur les lignes du job appliqué (`TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE`).

## Revue ciblée (L5c)

L'utilisateur ne tranche que ce qui échoue : la revue ciblée d'un métré ne montre que
les lignes que le garde d'application rejette (`blocked_items`) ou trouve incertaines
(`medium_items`), avec le même seuil et le même niveau que l'application
([`targeted-review.ts`](../../src/lib/takeoff/targeted-review.ts)). Comme la revue complète,
elle lit toutes les lignes retenues : une ligne que le plan de mapping sautera reste listée
(sens sûr ; l'assistant et le serveur la laissent de côté).

- **Écran** : `/dashboard/affaires/<affaire>/takeoff/<job>/review/targeted?versionId=…`,
  en mise en page outil (TI-658). À gauche les lignes, le filtre « Règle en échec » et
  l'application ; au centre le plan et sa lecture vectorielle, la ligne en évidence ; à
  droite ses raisons et ses décisions. La revue complète y renvoie (« Revue ciblée · N
  lignes »), comme le panneau des lignes bloquées de l'assistant d'application.
- **Décisions**, enregistrées aussitôt sur la ligne, une à la fois (la suivante attend la
  réponse de la précédente, qui porte l'état relu de ses partenaires), raccourcis affichés sur
  les boutons :
  - **Exclure** (E) : motif obligatoire ;
  - **Corriger** : saisie directe (un chiffre) ou F2, puis Entrée ; Échap annule. Aucune
    nouvelle lettre ;
  - La revue complète enregistre les champs modifiés. Exclure ou réintégrer une ligne
    vérifiée retire la vérification ; seul un geste explicite peut la redonner. Une
    cellule quittée sans changement conserve la vérification et son auteur.
  - **Unité** : cliquer sur l’unité de la ligne, la corriger puis enregistrer. La quantité
    est conservée et une quantité à saisir attend toujours sa confirmation ;
  - **Accepter** (V) : lève une confiance faible ou moyenne et toute règle acceptable ;
    jamais une quantité à saisir (ni une ligne qui en porte une à côté d'un échec
    acceptable), un matériau bloqué ni des règles à recalculer. Un échec
    `dn_network`, d'échelle ou de surface imprimée demande un motif codé (« Acceptation
    technique ») : V ouvre un dialogue avec une section par échec. En niveau C, seulement
    une ligne qui a sa preuve et sa page, comme la base l'exige ;
  - **Saisir** une quantité non observable : Entrée (après F2 ou une saisie directe) ou la
    réduction guidée ouvre « Justifier la quantité saisie » : « Justification » (les six
    catégories) et « Ce qui fonde la quantité », obligatoire pour une hypothèse. « Enregistrer
    la quantité » (ou Entrée) atteste la quantité tapée, même égale à celle du modèle, avec
    sa catégorie, et règle `NON_OBSERVABLE_TO_ENTER` ; Échap annule sans rien enregistrer.
    Le panneau de la ligne affiche ensuite « Saisie : <catégorie> — <note> ». Dans la revue
    complète, modifier la quantité d'une ligne encore à saisir renvoie vers la revue ciblée
    (« Une quantité à saisir se justifie dans la revue ciblée. »), sans rien enregistrer ; celle
    d'une ligne déjà saisie, que la revue ciblée ne liste plus, retire la saisie : la ligne
    redevient à saisir.
- **Doublon Z1/Z2** : la raison donne la longueur comptée deux fois et la ligne de l'autre
  zone (lien vers sa revue ciblée).
  - Paire : « Retirer 1,00 m » ramène la ligne à sa quantité moins cette longueur ; une
    ligne entièrement en double se retire (exclusion, motif proposé).
  - Groupe de trois lignes ou plus : aucune correction n'est proposée. « Retirer la ligne »
    n'est offert que pour une ligne que les autres dessinent entièrement (à 1 cm près, sur
    la longueur mesurée) ; sinon la ligne s'accepte (V) une fois vérifiée.
- **Règles à recalculer** (un recalcul sauté ou en échec) : la raison reste affichée, mais
  rien n'est proposé (ni réduction, ni « Retirer la ligne », ni V) : elle peut ne plus tenir
  (longueur déjà retirée, partenaire déjà exclu). Entrée sur la quantité, même inchangée,
  relance le calcul.
- **Relecture** : la réponse du PATCH porte l'état des règles de toutes les lignes du job
  que les règles lisent (`rule_states`), lu après le recalcul, même en échec ; celles des
  autres jobs de la version se relisent dans leur propre revue. La revue et la revue ciblée
  l'appliquent aux lignes qu'elles ne sont pas en train de modifier, et seulement depuis la
  réponse la plus récente : une ligne partenaire réglée ou devenue « à recalculer » le montre
  sans rechargement.
- **Limite connue** : deux sessions qui tranchent une même paire en même temps (deux onglets,
  deux utilisateurs) peuvent retirer deux fois la longueur commune ; c'est la
  sous-comptabilisation déjà signalée plus haut, que les règles ne détectent pas.
- **Assistant d'application** : le garde y laisse de côté les lignes que l'aperçu à jour
  saute (`skip`) ou replie dans un ouvrage (`apply_assembly`), comme le serveur ; sans
  aperçu à jour, il garde toutes les lignes retenues (sens sûr). Le panneau des lignes
  bloquées nomme chaque règle en échec et sa raison.
- **Revue complète** (vue avancée) : le filtre « Avec anomalies » et le compteur
  « Anomalies » suivent une seule définition (D13, D18f, `detectAnomalies`). Une ligne
  y figure pour l'une de ces raisons :
  - le garde de la revue ciblée la bloque, au seuil du tenant et au niveau du job
    (`reviewBlockReasons` : confiance faible ou absente non vérifiée en niveau C, preuve
    ou page manquante, règle en échec, règles à recalculer) ;
  - sa confiance est sous le seuil du tenant, à tous les niveaux, vérifiée ou non ;
  - elle n'a pas de preuve ;
  - sa quantité est nulle ou sa désignation vide.

  C'est une réunion : le filtre montre plus de lignes que le garde n'en bloque, jamais
  moins. Les écrans qui ne lisent ni le garde ni le seuil du tenant (fiche de ligne, vue
  des tableaux, panneau de preuve, revue de validation) appliquent le reste de la
  définition au seuil par défaut (0,5).
- **Revue de validation** (`ValidationReviewPanel`) : elle n'affiche pas les règles, la
  revue ciblée le fait. Son filtre « Confiance à confirmer » (anciennement « Hypothèses
  ouvertes », D18f) retient, comme avant, les lignes non vérifiées qui ont une preuve et
  une confiance sous 0,8 ou aucune. Chaque ligne porte au plus un badge de confiance :
  « Confiance faible » sous le seuil bas, sinon « Confiance inconnue » sans confiance,
  sinon « Confiance moyenne », le score à côté ; une ligne qui n'est pas signalée sur sa
  confiance garde son score pour badge.

## Banc

Chaque passe du pipeline vectoriel rend, par plan, les lignes rejetées, incertaines
et à haute confiance, avant puis après les règles :

- **Rejetée** : dans `blocked_items` ; après les règles, aussi une ligne bloquée par une règle en échec.
- **Incertaine** : dans `medium_items`.
- **Haute confiance** : ni l'une ni l'autre, avec une confiance ≥ 0,8.

Elle rend aussi, par rôle, les clés à haute confiance et celles en erreur :

- **Clé à haute confiance** : toutes ses lignes le sont.
- **Erreur** : clé hors tolérance, ou inventée (tout groupe de faux positifs ; chaque ligne illisible compte comme sa propre clé).

Avec `--baseline`, la lecture niveau C de la baseline est re-notée avec les règles
lues dans les désignations.

Les règles tournent par lot : les plans d'un même lot sont ceux d'une version. Zone et
niveau viennent du manifest.

### Passe vision ciblée (L5c)

`--vision-review rejected` (pipeline vectoriel, `TAKEOFF_BENCH_CHATGPT_OWNER`) : après les
règles de chaque passe, le profil ChatGPT local revoit les lignes rejetées, et elles seules
([`vision-review.ts`](../../src/lib/takeoff/bench/vision-review.ts)).

- **Lignes revues** : les lignes vectorielles que seule la règle DN × réseau rejette
  (réseau, matériau ou taille non lus, taille hors série), sur un extrait du plan autour de
  leurs tronçons. Ne sont pas envoyées : une ligne rejetée aussi pour une raison
  géométrique (doublon, aire, chevauchement, échelle), qu'aucune correction ne lèverait ;
  une ligne sans géométrie (ligne niveau C d'une page raster) ; un total dont les tronçons
  s'étalent sur plus de 900 pt (32 cm de papier) : son extrait serait presque toute la
  feuille, ses libellés illisibles, et une réponse réécrirait tous ses tronçons (« trop
  étalées »).
- Au plus 12 lignes par page (les autres sont comptées « laissées de côté »), 6 par appel,
  une image par ligne ; un extrait que pdfjs ne dessine pas n'est pas envoyé, et compté.
  Seules les réponses des lignes envoyées dans l'appel sont lues.
- **Réponse** : « corrige » remplace réseau, matériau et taille (codes du banc ; jamais un
  matériau d'enveloppe, calorifuge ou cordon chauffant, qui sortirait le tube de la règle
  DN), réécrit la désignation et plafonne la confiance à 0,7 : une lecture du modèle reste
  incertaine, jamais à haute confiance. Le calorifuge du même total suit la correction.
  Une correction qui répète la lecture, « confirme » et « illisible » ne changent rien.
- **État séparé** : les lignes corrigées et leurs règles recalculées forment « après
  vision », notées à part de « après règles ».
- **Rapport** : jetons (entrée, sortie, raisonnement, y compris ceux d'une réponse hors
  schéma), latence des appels et rendu des extraits p50 / p95, durée par page (vecteurs +
  vision). La comparaison avec la baseline L1 (`--baseline`) ne porte que sur les mêmes
  pages des deux côtés : celles que L1 a lues seules, hors pages raster (leurs lignes
  viennent de L1) ; les pages écartées sont comptées. Par passe et par rôle, les clés à
  haute confiance en erreur après règles puis après vision ; toute hausse est signalée.
- Le profil est lu une fois avant la première page (le jeton peut être renouvelé, rien
  d'autre n'est écrit) et jamais modifié. Un compte, un modèle ou un jeton absent arrête le
  run avant sa première page ; le premier arrêt du fournisseur (« Limite du forfait
  ChatGPT », limite de débit, autorisation, profil changé) l'arrête là où il en est. Dans
  les deux cas, rapport partiel et code de sortie 2. L5 n'appelle pas Decisions.
- La taille répondue garde sa notation (TI-683, prompt `takeoff-vision-review-v2`) :
  « Ø 110 » reste « Ø 110 » sur la désignation et dans les entrées de la ligne corrigée.
  Un nombre seul, sans notation, est écrit « DN n » et lu des deux façons.
