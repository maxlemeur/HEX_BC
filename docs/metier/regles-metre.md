# Règles fixes du métré (L5)

Le modèle propose, des règles fixes décident, l'utilisateur ne tranche que ce qui
échoue (TI-664, étape 6 du pipeline de TI-658).

Chaque règle est pure et déterministe. Elle rend « passe » ou « échoue », avec un
code stable, une raison lisible et sa version. Une règle qui n'a rien à lire sur
une ligne ne rend rien pour elle.

Le code est dans [`src/lib/takeoff/rules/`](../../src/lib/takeoff/rules/). Le banc
la mesure avec `npm run takeoff:bench -- --pipeline vector`
([`vector-rules.ts`](../../src/lib/takeoff/bench/vector-rules.ts)).

## Entrées

Les entrées d'une ligne sont écrites par le worker, jamais par l'utilisateur.

- **Ligne vectorielle** (TI-662) : réseau, matériau, DN, axes en mètres et polygone
  de pièce, lus dans sa géométrie ; échelle, cotes et surfaces imprimées lues dans
  la page.
- **Ligne du modèle** (niveaux B et C) : réseau, matériau et DN lus dans sa
  désignation par le lecteur déterministe du banc
  ([`item-keys.ts`](../../src/lib/takeoff/bench/item-keys.ts)).
  - Le DN passe par l'analyse de `price-reuse-matching.ts` et la table des diamètres de L0.
  - Un triplet incomplet le reste : pas de réseau, deux réseaux ou deux DN.
  - Une taille absente des séries est gardée telle qu'imprimée (« DN 23 », « Ø 23 », « 3/4" »), pour que la règle l'échoue.
  - Une épaisseur (« ép. 20 mm », « épaisseur 19 mm ») n'est jamais un DN.
  - Une ligne de réseau en m² est une surface de calorifuge, jamais un tuyau.
- **Quantité proposée** : la quantité du modèle ou de la lecture, avant toute
  correction.

L'utilisateur modifie la quantité et l'exclusion. Les règles les lisent telles
qu'elles sont maintenant.

## Règles et codes

| Règle | Échoue | Passe | V lève l'échec |
|---|---|---|---|
| `dn_network` | `DN_NETWORK_NETWORK_MISSING`, `DN_NETWORK_MATERIAL_MISSING`, `DN_NETWORK_DN_MISSING`, `DN_NETWORK_MATERIAL_NOT_ALLOWED`, `DN_NETWORK_DN_NOT_IN_SERIES` | `DN_NETWORK_COMPATIBLE` | oui |
| `zone_overlap` | `ZONE_OVERLAP_DUPLICATE`, `ZONE_OVERLAP_UNREGISTERED` | `ZONE_OVERLAP_NONE`, `ZONE_OVERLAP_RESOLVED` | oui |
| `scale_dimension` | `SCALE_DIMENSION_MISMATCH` | `SCALE_DIMENSION_CONSISTENT` | oui |
| `area_printed` | `AREA_PRINTED_MISMATCH` | `AREA_PRINTED_CONSISTENT` | oui |
| `room_overlap` | `ROOM_OVERLAP` | `ROOM_OVERLAP_NONE` | oui |
| `closed_box` | `CLOSED_BOX_LABEL`, `CLOSED_BOX_SHAPE` | `CLOSED_BOX_NONE` | oui |
| `non_observable` | `NON_OBSERVABLE_TO_ENTER` | `NON_OBSERVABLE_ENTERED` | **non** : la quantité se saisit |

### DN compatible avec le réseau

Elle porte sur les lignes de longueur, sauf le calorifuge et le cordon chauffant,
qui n'ont pas de série propre.

Un triplet réseau × matériau × DN absent de la table échoue :

- réseau ou matériau non lu ;
- DN non lu, ou deux DN ;
- matériau non admis pour le réseau ;
- DN absent de la série du matériau.

La table ([`network-diameters.ts`](../../src/lib/takeoff/rules/network-diameters.ts), version 1) :

- **Séries** : celles des normes produit de la table des diamètres de L0, version 2 (ajouts de TI-664 : cuivre 6 et 8 mm, fonte DN 80, PER 40 à 63, PP 16).
  - Le PVC d'évacuation (NF EN 1329-1) et le PVC pression (NF EN 1452) partagent une famille de L0 : leurs diamètres sont séparés ici.
  - Cuivre NF EN 1057, inox à sertir NF EN 10312, inox soudé ISO 1127.
  - PVC NF EN 1329-1 et 1452, fonte SMU NF EN 877.
  - Acier NF EN 10255 et 10220, multicouche ISO 21003, PER ISO 15875, PE NF EN 12201, PP NF EN 1451.
- **Matériaux admis par réseau** :

  | Réseaux | Matériaux admis |
  |---|---|
  | EF, EFA | tous les matériaux d'eau potable, plus le PVC pression, l'acier galvanisé et le PEHD |
  | ECS, RECS | cuivre, inox, multicouche, PER, PP |
  | EU, EV, EU/EV, EUG, EP, VP | PVC, fonte SMU, PP, PEHD, inox (NF EN 1124) |
  | COND | PVC, PVC pression, PP, PEHD |
  | CS, RIA, SPK | acier galvanisé, acier |
  | GAZ | cuivre, acier, PEHD |
  | CHW, CW, HRC, HW (départs et retours) | acier, inox, cuivre, multicouche, PP ; plus le PEHD pour CHW et CW, et le PER pour HW |
  | GLY | acier, inox, cuivre, PP, PEHD (sans zinc) |

- **Pas de DN minimal par réseau** : un réseau restreint les matériaux, jamais les tailles.
- **Ligne vectorielle** : sa taille est un nombre, imprimé « DN n » ou « Ø n » sur le plan ; elle est lue des deux façons.

**Cas à trancher par Max** (`AMBIGUOUS_NETWORK_MATERIALS`, inchangés tant qu'il ne
décide pas) :

- PVC pour les eaux grasses ;
- inox d'évacuation (NF EN 1124) pour les eaux grasses, lu par les séries de l'inox soudé et à sertir ;
- cuivre pour l'eau glycolée ;
- PEHD pour l'eau froide à l'intérieur ;
- acier galvanisé pour l'eau froide ;
- PER pour le bouclage ECS ;
- cuivre pour les condensats ;
- multicouche pour le gaz et pour l'eau glycolée ;
- PEHD pour les RIA ;
- DN minimal des EV (WC de 80 à 100).

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
  - Elle est retenue si au moins 20 traits tombent sur ceux de l'autre page, extrémités à 5 cm près.
  - Elle doit aussi réunir deux fois plus de traits que la suivante.
  - Elle est ensuite affinée sur ces extrémités. Son erreur résiduelle (RMS) doit rester sous 2 cm.
- **Pourquoi jamais le cartouche** : il est au même endroit des deux feuilles, loin du dessin. Il propose la translation nulle, que les traits du bâtiment refusent dès que le dessin a bougé ; et ses textes, hors du bâtiment, ne la rendent jamais candidate seuls, même quand deux ailes identiques sont tracées au même endroit de la feuille.
- **Composantes** : les pages d'un niveau sont recalées deux à deux. Les pages reliées forment une composante, dans le repère de sa première page. Deux pages de deux composantes n'ont pas de repère commun.
- **Comparaison de deux pages** : par leur propre recalage quand elles en ont un, jamais par un chemin qui passe par une troisième page. Trois recalages exacts chacun peuvent ne pas se refermer (une page dessinée 2,5 cm à côté sur une partie du bâtiment) : le chemin dépendrait alors de la première page et pourrait écarter un doublon. Deux pages sans recalage direct se comparent dans le repère de leur composante (limite connue : un cycle qui ne se referme pas peut encore les décaler).
- **Translations seulement** : une vue tournée ou à une autre échelle n'est pas recalée.
- **Résultat** : la translation de chaque page est écrite dans `transform` de sa géométrie (TI-662), comme `[1, 0, 0, 1, dx, dy]`.

**Doublon**
([`zone-overlap.ts`](../../src/lib/takeoff/rules/zone-overlap.ts), version 1) :

- Même réseau, même genre (tuyau ou calorifuge) et même DN, lu par la série du matériau : « DN 100 » et « Ø 110 » d'une même fonte sont le même tuyau.
- Un matériau sans série (calorifuge, matériau absent) compare la taille imprimée : « DN 15 » et « DN 20 » d'un calorifuge sont deux tronçons.
- Axes parallèles à 2° près, à moins de **D = 5 cm** l'un de l'autre, sur une longueur commune d'au moins **L = 30 cm**, et de plus d'une bande du dessin à l'échelle la plus grossière des deux pages (49 cm au 1/200).
- La longueur commune est l'union des tronçons couverts, la plus petite des deux directions, arrondie au millimètre (un demi-millimètre vers le haut).
- La distance D est comprise : une copie à 5 cm pile est un doublon. Deux tronçons bout à bout ne se recouvrent sur rien, quel que soit le bruit des calculs ; aucun résultat ne dépend de la page prise pour repère.
- Le minimum vaut pour chaque tronçon continu. Deux morceaux couverts se continuent quand leurs extrémités se touchent à D près (un coude), ou dans le prolongement l'un de l'autre (parallèles, à D de son axe) à moins du minimum : les tirets d'un réseau en pointillés (20 cm, espacés de 5 cm sur B R+4) font un seul tronçon. Quatre contacts de 10 cm en limite de zone, ou trois tuyaux parallèles qui la touchent chacun, ne font pas un doublon.
- La détection ne dépend pas du règlement : une paire, sa longueur commune et son minimum sont les mêmes qu'elle soit isolée ou dans un groupe (voir Résolution).

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
- « Accepter » (V) lève l'échec de la ligne vérifiée seulement.
- **Limites connues** :
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
- Les comptages ne sont pas concernés.

### Aire du polygone cohérente avec la surface imprimée

L'écart doit rester sous max(2 % ; 0,1 m²), mesuré sur la quantité actuelle de la
ligne : une quantité corrigée à la surface imprimée règle l'échec.

**Valeur provisoire** : le banc ne donne que deux polygones de pièce fermés (D RDC,
hors réserve).

- L'un est lu juste, à −0,1 % de sa surface imprimée.
- L'autre est une boîte à −69,8 %.
- 2 % correspond à un contour décalé de 1,5 cm le long des murs d'une pièce de 10 m².
- 0,1 m² évite qu'un placard de 1 m² échoue sur un arrondi.

### Pièces sans chevauchement

L'aire commune de deux pièces d'une même page est échantillonnée sur une grille de
5 cm, plus fine quand le recouvrement est étroit (un vingtième de son petit côté). Elle
échoue au-delà de max(2 % de la plus petite pièce ; 0,1 m²).

Deux pièces qui partagent un mur se touchent sans aire commune. Valeur provisoire,
comme l'aire.

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
- Une telle ligne échoue tant que l'utilisateur n'a pas saisi sa quantité : une saisie attestée, même égale à la quantité du modèle (1 ens de mise en service), ou une quantité modifiée.
- Les quantités sont stockées au millième : la quantité du modèle, arrondie par la base (12,3456 u stocké 12,346), reste celle du modèle, jamais une saisie.
- La vérifier ne la règle jamais : `acceptable: false`.

## Blocage

Une ligne incluse est bloquée par ses règles quand l'une de ces conditions est vraie :

- ses résultats sont à recalculer (« stale ») ;
- une règle échoue et la ligne n'est pas vérifiée ;
- une règle échoue sans être acceptable.

C'est le prédicat de [`blocking.ts`](../../src/lib/takeoff/rules/blocking.ts). Le garde
d'application et le trigger SQL le partageront (TI-664, étape 2).

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
