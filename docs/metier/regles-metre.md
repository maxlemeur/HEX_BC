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
  - Un DN inconnu est gardé tel qu'imprimé, pour que la règle l'échoue.
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

- **Séries** : celles des normes produit de la table des diamètres de L0.
  - Cuivre NF EN 1057, inox à sertir NF EN 10312, inox soudé ISO 1127.
  - PVC NF EN 1329-1 et 1452, fonte SMU NF EN 877.
  - Acier NF EN 10255 et 10220, multicouche ISO 21003, PER ISO 15875, PE NF EN 12201, PP NF EN 1451.
- **Matériaux admis par réseau** :

  | Réseaux | Matériaux admis |
  |---|---|
  | EF, EFA | tous les matériaux d'eau potable, plus le PVC pression, l'acier galvanisé et le PEHD |
  | ECS, RECS | cuivre, inox, multicouche, PER, PP |
  | EU, EV, EU/EV, EUG, EP, VP | PVC, fonte SMU, PP, PEHD |
  | COND | PVC, PVC pression, PP, PEHD |
  | CS, RIA, SPK | acier galvanisé, acier |
  | GAZ | cuivre, acier, PEHD |
  | CHW, CW, HRC, HW (départs et retours) | acier, inox, cuivre, multicouche, PP ; plus le PEHD pour CHW et CW, et le PER pour HW |
  | GLY | acier, inox, PP, PEHD (sans zinc ni cuivre) |

- **Pas de DN minimal par réseau** : un réseau restreint les matériaux, jamais les tailles.

**Cas à trancher par Max** (`AMBIGUOUS_NETWORK_MATERIALS`, inchangés tant qu'il ne
décide pas) :

- PVC pour les eaux grasses ;
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
  - Les traits du bâtiment décident. Ce sont les traits gris ou quasi blancs du fond d'architecture, ou ceux d'un calque mur, cloison ou fond. Jamais un trait quasi noir : cadres et cartouches.
  - Une translation est retenue si au moins 20 traits tombent sur ceux de l'autre page, extrémités à 5 cm près.
  - Elle doit aussi réunir deux fois plus de traits que la suivante.
  - Elle est ensuite affinée sur ces extrémités. Son erreur résiduelle (RMS) doit rester sous 2 cm.
- **Pourquoi jamais le cartouche** : il est au même endroit des deux feuilles. Il propose la translation nulle, que les traits du bâtiment refusent dès que le dessin a bougé.
- **Translations seulement** : une vue tournée ou à une autre échelle n'est pas recalée.
- **Résultat** : la translation de chaque page est écrite dans `transform` de sa géométrie (TI-662), comme `[1, 0, 0, 1, dx, dy]`.

**Doublon**
([`zone-overlap.ts`](../../src/lib/takeoff/rules/zone-overlap.ts), version 1) :

- Même réseau, même DN et même genre (tuyau ou calorifuge).
- Axes parallèles à 2° près, à moins de **D = 5 cm** l'un de l'autre, sur une longueur commune d'au moins **L = 30 cm**.
- La longueur commune est l'union des tronçons couverts, la plus petite des deux directions.

**Résolution**

- Une paire est réglée quand une des deux lignes a été réduite de la longueur commune : quantité ≤ longueur mesurée − longueur commune, à 1 cm près.
- Une réduction ne paie qu'une paire.
- La ligne d'un job appliqué (figée) paie d'abord si sa réduction suffit. Sinon, la ligne du job courant doit être corrigée.
- Exclure une ligne entièrement en double règle aussi la paire.
- « Accepter » (V) lève l'échec de la ligne vérifiée seulement.

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
5 cm. Elle échoue au-delà de max(2 % de la plus petite pièce ; 0,1 m²).

Deux pièces qui partagent un mur se touchent sans aire commune. Valeur provisoire,
comme l'aire.

### Baignoires, placards et gaines en boîtes fermées

Échoue :

- un libellé de baignoire, placard, gaine, gaine technique ou GT ;
- ou un contour à 4 coins de moins de la moitié de la surface imprimée : une boîte dessinée autour du libellé, pas la pièce.

### Quantités non observables

Un plan ne montre ni soudure, ni piquage, ni support, ni tronçon vertical (chute,
colonne montante, descente), ni transport, ni pose seule, ni prestation (essais,
mise en service, DOE…).

- Une telle ligne échoue tant que sa quantité est celle du modèle.
- Elle passe dès que l'utilisateur en saisit une autre.
- La vérifier ne la règle jamais : `acceptable: false`.
- **Un organe dessiné reste observable** : « Vanne avec support » ou « Vanne de colonne montante » est une vanne.
- **« Vertical » ne porte que sur les longueurs.**

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

- **Rejetée** : dans `blocked_items`.
- **Incertaine** : dans `medium_items`.
- **Haute confiance** : ni l'une ni l'autre, avec une confiance ≥ 0,8.

Elle rend aussi, par rôle, les clés à haute confiance et celles en erreur :

- **Clé à haute confiance** : toutes ses lignes le sont.
- **Erreur** : clé hors tolérance, ou inventée (tout groupe de faux positifs).

Avec `--baseline`, la lecture niveau C de la baseline est re-notée avec les règles
lues dans les désignations.

Les règles tournent par lot : les plans d'un même lot sont ceux d'une version. Zone et
niveau viennent du manifest.
