# Lecture vectorielle des plans (métré L3)

La lecture vectorielle mesure les réseaux et les surfaces de pièces à partir des
tracés et du texte du PDF, sans modèle. Elle est déterministe : la même page donne
toujours les mêmes groupes, la même échelle et les mêmes longueurs.

Le code est dans [`src/lib/takeoff/vectors/`](../../src/lib/takeoff/vectors/).
Le banc la mesure avec `npm run takeoff:bench -- --pipeline vector`
([`vector-run.ts`](../../src/lib/takeoff/bench/vector-run.ts)). Seule l'étape
Decisions, facultative, appelle un modèle (voir le classement).

Les seuils ci-dessous sont des valeurs de départ. Max peut les changer : chacun
est une constante nommée et versionnée dans le code.

## Étapes

1. **Extraction** ([`extraction.ts`](../../src/lib/takeoff/vectors/extraction.ts)).
   - pdfjs lit la page dans un processus séparé. Ce processus est tué après 15 s :
     la page échoue alors explicitement et rien n'est mesuré.
   - On garde :
     - les tracés peints en trait, avec leur couleur, leur épaisseur, leur tiret et
       leur calque ;
     - les textes, avec leur position.
   - Les surfaces seulement remplies et les tracés de détourage ne sont pas mesurés.
   - Seule la page visible (sa CropBox) est lue. Ce que le dessin porte au-delà n'est pas
     imprimé : un trait qui passe le bord est coupé au bord, un trait ou un texte tout
     entier au-delà (un cartouche rogné) n'est pas lu.
   - Une erreur de contenu (opérateur invalide, objet manquant) ou une coordonnée hors
     plage d'un trait imprimé, même au-delà du bord, fait échouer la page : pdfjs ne
     rend jamais une page lue en partie.
   - Un détourage (W n, ou le cadre BBox d'une forme) coupe les tracés qui le suivent :
     seul ce qu'il montre est mesuré. Un détourage rectangulaire est exact ; une autre
     forme est prise par son rectangle englobant.
   - La part raster d'une page est l'union des images qui la couvrent, dans leur
     détourage : deux images superposées ne comptent qu'une fois. Une image sur un
     calque masqué par la configuration par défaut (OFF), par exemple un ancien scan
     gardé sous le plan, n'est pas imprimée : elle ne compte pas.
   - Un trait entièrement transparent (opacité de trait `/CA 0` d'un ExtGState) n'est
     pas imprimé : il n'est pas lu, mais son tracé détoure encore ce qui le suit (`W S`).
     Un trait à demi transparent reste lu. Une image peinte à opacité nulle (`/ca 0`)
     ne compte pas dans la part raster.
   - Un groupe de transparence (forme `/Group /S /Transparency`) est lu comme pdfjs
     l'imprime : son cadre BBox le détoure ; peint à opacité 1 sans isolement, il garde
     l'opacité en cours ; sinon son contenu repart à l'opacité 1 et le groupe est peint
     à l'opacité de remplissage extérieure (rien n'est imprimé à `/ca 0`). La forme d'un
     masque de transparence (`/SMask`) n'est jamais imprimée : elle n'est pas lue.
2. **Groupes** ([`page-model.ts`](../../src/lib/takeoff/vectors/page-model.ts)).
   - Un groupe est un calque quand la page en a, sinon une couleur avec son
     épaisseur et son tiret.
   - Couleur quasi blanche : luminosité ≥ 0,75 et saturation < 0,25, ou luminosité
     ≥ 0,93.
   - Couleur grise : saturation < 0,1.
   - Un groupe quasi blanc ou gris n'est jamais classé réseau par mot-clé.
   - Un trait quasi blanc n'est jamais mesuré, même dans un calque réseau.
   - Un calque masqué par la configuration par défaut du PDF (OFF) n'est pas lu : ni
     cote, ni légende, ni ligne de rappel, ni mesure, ni contour de pièce. Un tracé
     masqué par un niveau englobant (un calque ON dans un calque OFF, un OCMD d'un
     calque OFF) n'est pas imprimé : il n'est pas lu non plus.
3. **Échelle** ([`scale.ts`](../../src/lib/takeoff/vectors/scale.ts)), page par page.
   - On lit l'échelle du cartouche (« Échelle 1/50 »).
   - Une valeur séparée de son libellé (« Échelle » puis « 1/50 », « Format » puis « A3 »)
     est prise juste après lui sur sa ligne ou juste en dessous, dans le repère du texte :
     une page tournée (/Rotate 90, 180 ou 270) se lit comme dessinée.
   - On la contrôle par une cote : un nombre au-dessus d'une ligne dont les deux
     extrémités sont barrées.
     - L'unité est le mètre si le nombre a des décimales, le millimètre sinon.
     - La cote est incohérente au-delà de max(2 %, une demi-unité d'arrondi).
   - Statut de la page :
     - **vérifiée** : au moins une cote cohérente, aucune incohérente ;
     - **format** : aucune cote, et le format du cartouche est celui de la page ;
     - **calibrée** : la page a une calibration (`conventions.calibration` de la
       préparation confirmée, qui nomme ce plan et cette page : son fichier du jeu de
       plans, ou `upload:<SHA-256>` des octets lus pour un PDF téléversé directement ;
       au banc, `truth/groups/<id>.json`) ;
     - **non vérifiée** : pas d'échelle, échelle ambiguë, cote incohérente, ou aucune
       cote alors que le format diffère. La raison est donnée.
   - Une page non vérifiée ne donne ni longueur ni surface. Les comptages restent
     possibles.
4. **Classement** ([`classify.ts`](../../src/lib/takeoff/vectors/classify.ts),
   [`vocabulary.ts`](../../src/lib/takeoff/vectors/vocabulary.ts),
   [`legend.ts`](../../src/lib/takeoff/vectors/legend.ts)). Mots-clés d'abord :
   - **calque** : son nom est découpé sur « _ », les espaces, « - » et « / ». Les codes
     génériques (EF, ECS, EU, EV, EP, VP, CHW…) donnent le réseau. S, A, D ou R donnent
     le départ ou le retour. TEXTE, COTE, MUR et CLOISON donnent les autres classes.
     MENUISERIE, PORTE ou FENÊTRE ne donnent pas de classe : ces calques ferment seulement
     les pièces remplies entre les murs (étape 6) ;
   - **légende** : un code seul, éventuellement avec son sens (« CHW-S », « EG-R »), avec
     les tracés dessinés sur sa ligne avant le texte suivant de cette ligne (échantillon
     de 25 hauteurs de texte au plus), donne la couleur du réseau. Chaque partie du code
     est un code réseau ou un sens : « EU - PVC » est un libellé, pas une légende.
     - La légende se lit dans le sens de la feuille. Elle est lue le long des deux axes
       de la page, et l'axe qui donne le plus d'entrées est retenu (à égalité, celui de
       la plupart des textes). Une page tournée (/Rotate 90, 180 ou 270), ou dessinée
       tournée, se lit comme dessinée, et des libellés verticaux plus nombreux ne
       tournent pas une feuille droite. Un code écrit en travers de ce sens, le long
       d'un tuyau, est une étiquette du plan, pas une légende.
     - Les teintes de cette couleur (mêlée de blanc à 10 – 85 %) et ses ombres (de noir
       à 10 – 60 %) suivent.
     - Une couleur partagée par EU et EU/EV donne EUV. Une couleur partagée par deux
       réseaux distincts reste « à revoir » ; les libellés la tranchent tronçon par
       tronçon. Tous les libellés rattachés comptent : deux réseaux nommés sur des
       tronçons raccordés la laissent « à revoir » ;
   - **libellés** : une couleur sans légende prend le réseau de ses libellés. Il faut au
     moins 2 libellés, d'accord à 80 %, dont la ligne de rappel finit sur elle.
     - Un tuyau est dessiné en bande, son contour dans une couleur et son fond dans une
       teinte de celle-ci, et une ligne de rappel peut finir sur le tuyau voisin. Une
       couleur dont les libellés sont d'accord à moins de 80 % prend quand même le réseau
       que nomme plus de la moitié d'entre eux (elle en a donc 3 au moins) si :
       - une couleur de sa famille (une teinte ou une ombre d'elle, ou la couleur dont
         elle est une teinte ou une ombre) a ce réseau par ses propres libellés, dont
         5 au moins le nomment ;
       - aucune couleur de la famille n'a un autre réseau par ses propres libellés : un
         même contour borderait alors des tuyaux de deux réseaux, il reste « à revoir » ;
       - les libellés de la couleur et de toute sa famille, comptés ensemble, sont
         d'accord à 80 % sur ce réseau.
     - Une autre épaisseur de la même couleur n'est pas une teinte. Une couleur qui n'a
       qu'un libellé, ou aucun, n'est jamais classée par sa famille. Les couleurs quasi
       blanches, grises ou sombres ne reçoivent aucun libellé.

   Vient ensuite **Decisions**, pour les groupes restés sans classe
   ([`group-decisions.ts`](../../src/lib/takeoff/vectors/group-decisions.ts),
   [`group-decisions-server.ts`](../../src/lib/takeoff/vectors/group-decisions-server.ts)) :
   - Candidats : les groupes d'une page non raster sans classe ni candidats de légende
     (une couleur partagée se tranche par les libellés), ni masqués (calque OFF), ni
     quasi blancs, d'au moins 0,1 % de la longueur visible de la page (hors quasi-blancs
     et calques masqués). Les plus longs d'abord.
   - Ne sont jamais envoyés les groupes qui ne peuvent pas être un réseau (TI-704,
     [`candidate-filter.ts`](../../src/lib/takeoff/vectors/candidate-filter.ts)). Ils restent
     « à revoir », comptés avec leur raison :
     - gris : toutes leurs couleurs grises ou quasi blanches (fond, cadres, tableaux,
       motifs de calorifuge le long des tuyaux) ;
     - motif : un trait en motif (hachure), sans couleur à comparer à une légende ;
     - calque de cadre ou de cartouche, ou d'architecture (mobilier, calepinage,
       menuiseries), par les mots de son nom ;
     - échantillon de légende : tous ses traits visibles dans le cadre de la légende, ou
       le groupe entier en bande courte et fine à côté d'un texte qui n'est pas un libellé
       de tuyau (25 hauteurs de ce texte de long au plus, 1,5 d'épaisseur, à une hauteur
       au plus) ;
     - couleur de gaine d'air : un groupe de couleur (jamais un calque) dont chaque couleur
       est celle d'une ligne de légende aéraulique (« AN », « AS », « AR », « AEX »… seuls,
       en capitales, lus comme la légende des réseaux, au moins deux codes sur la page)
       ou une teinte de celle-ci (mêlée de blanc), et aucune liée à un réseau classé sur
       la page : sa couleur, sa teinte ou son ombre, ou la couleur dont il est la teinte
       (le contour d'un tuyau en bande dont le remplissage est classé). Une ombre d'une
       couleur d'air est gardée : le rouge foncé d'un tuyau de chauffage est une ombre du
       rouge d'une gaine d'extraction.
     - Un groupe gris n'est donc plus demandé comme mur : un « mur » ou une « cloison »
       de Decisions à 0,8 ou plus ferme les pièces (voir Surfaces). Aucune des 89
       réponses sur des groupes gris des runs du 5/11 ne l'était.
     - Sur les 8 plans de développement : 61 candidats au lieu de 171, les 36 réseaux
       gardés (mesure du 12/11/2026, banc par mots-clés avec la vérité des groupes).
   - Limites par page du document : 10 appels groupés de 36 groupes, soit 360 groupes au
     plus ; au-delà, les groupes restent « à revoir » et leur nombre est compté. Dans le
     métré, ces limites valent pour le document entier et le traitement (voir « Decisions
     dans le métré »).
   - N = 36 : une planche de 6 × 6 vignettes de 384 px reste lisible pour environ 0,27 Mo
     en base64 (essai du 3/11/2026).
   - Une question à choix par groupe, nommée par un alias (« groupe_01 »… dans l'ordre de
     la planche) : un identifiant de groupe peut dépasser les 160 caractères d'un nom de
     question. Les choix sont les codes réseau, avec leur libellé, puis mur, cloison,
     fond, cotation, texte et autre. Un groupe gris n'est jamais envoyé ; s'il l'était,
     aucun réseau ne lui serait proposé.
   - Contexte JSON : des statistiques seulement (couleurs, épaisseur, tiret, longueurs
     en pt et en m si l'échelle est mesurable, part de la page, tracés, segments,
     fermés, rectangle englobant en fractions de page, nom du calque si la page en a,
     les 3 libellés les plus proches), l'échelle et les codes de la légende. Il reste
     sous 256 Kio : on retire d'abord les libellés, puis les noms de calque, jamais les
     alias.
   - Images : 1. un extrait de la page autour de la légende (rendu pdfjs, 1 600 px au
     plus), ou la page entière sans légende. Les cadres de légende à moins de 48 pt les
     uns des autres forment une légende ; on garde celle qui en a le plus, jamais l'union
     avec un code isolé loin d'elle ; 2. la planche des groupes, dessinée depuis
     la géométrie extraite : le groupe épaissi dans une version foncée de sa couleur, les
     autres tracés imprimés en gris très clair, chaque vignette titrée par son alias.
     Les points sont plafonnés par vignette.
   - Appel dédié : un groupe dont la réponse manque, est refusée, invalide ou sous 0,5
     est redemandé seul, avec son propre rendu de 1 200 px (50 appels dédiés par page au
     plus, par document dans le métré). Sa réponse remplace celle du lot.
   - Le plafond de jetons est consulté avant chaque appel. Un refus, le premier appel en
     échec ou indisponible, ou une erreur avant l'envoi arrêtent les appels, sans
     nouvel essai : les groupes restants restent « à revoir ».
   - Sans module de dessin, ou si une image ne peut pas être dessinée, aucun appel n'est
     fait pour la page : ses groupes restent « à revoir », la raison est gardée.
   - Une réponse ne s'applique qu'à un groupe encore sans classe. Elle ne fait jamais un
     réseau d'un groupe quasi blanc, gris ou masqué.
   - Une réponse à 0,8 ou plus est classée et mesurée. En dessous, c'est une proposition
     affichée avec sa confiance : elle n'est ni mesurée, ni comptée dans le badge.

   Les correspondances de l'utilisateur (au banc, celles de `truth/groups`) passent
   enfin devant toute autre classe.

   Le badge « Détection X % » vaut la longueur classée divisée par la longueur des
   tracés de la page hors quasi-blancs.
5. **Mesure** ([`measure.ts`](../../src/lib/takeoff/vectors/measure.ts)).
   - Un tuyau est dessiné en bande : deux contours et des teintes. La mesure prend son
     axe :
     - traits parallèles (à 0,5° près) qui se chevauchent le long du tuyau, regroupés
       tant qu'ils sont à moins de 2,5 pt l'un de l'autre, dans une bande de 7 pt au
       plus : un trait parallèle ailleurs sur la feuille ne coupe jamais une bande ;
     - intervalles fusionnés au-delà des trous de 1 pt au plus ;
     - un trait en double ne compte qu'une fois ;
     - un tuyau dont les traits tombent dans un réseau parent et un de ses membres
       (ses contours lus comme un départ par ses libellés, sa teinte comme son parent
       par la légende) ne compte qu'une fois, au membre. La partie d'un tronçon du
       parent qui longe un tronçon du membre, parallèle (à 3° près), est retirée du
       parent quand son axe, aux deux bouts de leur recouvrement, reste à moins de la
       demi-largeur de la bande du membre ou de 1 pt de son axe (la plus grande des
       deux). Le reste du tronçon, au-delà de 1 pt, reste au parent. Deux tuyaux tracés
       chacun d'un seul trait à 1,5 pt l'un de l'autre restent deux tuyaux.
       Limite : un libellé qui ne nomme que le parent (« HW … DN 35 ») posé sur un tel
       tuyau ne s'y rattache plus, puisqu'un libellé du parent ne va jamais sur un
       tronçon du membre. Le tuyau reste alors « à revoir », ou ce libellé va au plus
       proche autre tronçon du parent à sa portée.
   - Les embouts et les manchons posés en travers d'une bande de leur réseau ne comptent
     pas. Le tuyau court d'un autre réseau qui la croise compte.
   - Ne sont pas mesurés : les échantillons de la légende et les cadres de détail. Un
     cadre de détail est un rectangle sombre fermé, ses quatre coins tracés, d'au moins
     70 pt de côté, qui n'est pas lui-même un tracé de réseau, et qui contient des réseaux
     mais presque pas de fond de plan (ses propres bords ne comptent pas). Un mur ouvert
     en U n'est pas un cadre.
   - Les morceaux d'un libellé sur une même ligne de base (pdfjs le coupe aux
     changements de police) sont réunis, même légèrement inclinés : un texte éloigné de
     cette ligne n'arrête jamais la recherche de la suite. Un libellé à cheval sur deux
     directions voisines, ou de part et d'autre de ±π (page tournée), est réuni quel que
     soit l'ordre de lecture. La ligne suivante d'un libellé incliné (« DN 40 » aligné à
     droite sous son réseau) lui est rattachée de même.
   - Le DN, le matériau et le calorifuge viennent du libellé :
     - par sa ligne de rappel, dont l'extrémité tombe à moins de 8 pt de l'axe. Elle part
       du libellé : un mur qui passe sous le libellé sans s'y arrêter n'en est pas une ;
     - sinon par sa position : le tuyau parallèle le plus proche.
   - La taille garde la notation que le libellé imprime (TI-683, D7) : « Ø 110 » et
     « DN 110 » sont deux tailles. Un diamètre extérieur garde sa décimale (« Ø 42,4 »),
     et « ⌀ » ou « ∅ » se lisent comme « Ø ». La notation suit la taille quand elle est propagée,
     sépare les totaux (« DN 100 » et « Ø 100 » d'un même réseau ne s'additionnent pas)
     et s'écrit dans la désignation de la ligne et de son calorifuge. Un tronçon dont
     deux libellés ne diffèrent que par la notation est coupé entre eux comme pour deux DN.
   - Un tronçon dont deux libellés diffèrent (DN, matériau ou calorifuge, à une
     réduction) est coupé entre eux : à la fin de trait la plus proche du milieu des
     deux libellés, ou à ce milieu si aucun trait ne finit entre eux. Un tuyau exporté
     en nombreux morceaux est donc coupé lui aussi.
   - Des libellés à moins de 7 pt l'un de l'autre le long du tuyau (l'un au-dessus et
     l'autre en dessous par exemple) sont au même endroit : le tronçon n'est jamais
     coupé entre eux. S'ils diffèrent, le morceau qui les porte garde un DN vide
     (« à revoir ») et aucun DN ne lui est donné ; un DN propagé le traverse vers les
     tronçons suivants. Le tronçon reste coupé entre cet endroit et un libellé clair
     plus loin, qui garde sa section.
   - Ces valeurs passent aux tronçons raccordés, du plus proche au plus loin (en
     nombre de raccords) :
     - du même réseau ;
     - d'un réseau parent à un de ses membres et inversement : EU/EV avec EU ou EV,
       CHW, HW, GLY, HRC et CW avec leur départ ou leur retour (les familles du score) ;
     - jamais entre deux membres (EU et EV, un départ et un retour sont deux tuyaux),
       même par un tronçon de leur parent, ni vers un autre réseau.
   - Un DN porte le réseau que son libellé nomme : « EU - PVC DN 40 » sur un tronçon
     EU/EV passe aux tronçons EU, jamais aux EV. Des libellés d'accord sur un tronçon
     qui nomment plusieurs réseaux d'une famille (« EU » et « EU/EV », ou « EU » et
     « EV ») portent leur parent, quel que soit leur ordre de lecture. De deux libellés
     aussi proches d'un tronçon, celui de son propre réseau l'emporte.
   - Chaque réseau porté fait son propre chemin : un tronçon qu'un DN d'un autre réseau
     a atteint le premier, ou qui porte son propre libellé, garde son DN, mais laisse
     passer celui-ci vers les tronçons qu'il peut atteindre (le DN d'un EU/EV jusqu'à un
     EV, au-delà d'un tronçon EU/EV qu'un DN EU plus proche a atteint ou que libelle
     « EU »).
   - Un tronçon qui n'est rattaché à aucun libellé garde un DN vide (« à revoir »).
   - Les recherches de voisinage (libellés, raccords, embouts) trouvent tout tracé, même
     un long tuyau en diagonale d'une feuille A0.
   - Longueur réelle = longueur sur la feuille (mm) × dénominateur de l'échelle.
6. **Surfaces** ([`surfaces.ts`](../../src/lib/takeoff/vectors/surfaces.ts)).
   - La mesure est l'aire du plus petit polygone fermé autour de la surface imprimée
     d'une pièce, × échelle².
   - La géométrie reste la mesure indépendante. Une surface imprimée explicitement
     en sol net peut relever la quantité chiffrée à la valeur supérieure, sous les
     [contrôles de base et d'écart par ligne](quantites-reference-metre.md). Elle
     ne constitue jamais un repli lorsque la mesure manque : une pièce
     sans polygone fermé ni remplissage valable entre les murs (ci-dessous) n'a pas
     d'aire mesurée. Elle est comptée au rapport.
   - Un polygone est fermé par son tracé (h, s, re) ou revient à son premier point, à
     moins de 0,5 pt, sans fermeture explicite. Un contour laissé ouvert (une porte, un
     côté manquant) ne délimite aucune pièce.
   - Une pièce par contour : un polygone qui contient aussi le libellé d'une autre pièce
     (l'enveloppe d'un bâtiment, le cadre de la feuille) n'est pas le contour de la pièce.
   - Un contour sur un calque masqué n'est pas imprimé : il ne délimite aucune pièce.
   - Une pièce sans polygone fermé est remplie entre les murs
     ([`fill.ts`](../../src/lib/takeoff/vectors/fill.ts)) : beaucoup de plans dessinent
     les murs en traits séparés, sans contour fermé autour des pièces.
     - Barrières : les traits des groupes classés mur ou cloison (toute source que la
       lecture retient), et ceux des calques de menuiseries ou d'ouvertures (MENUISERIE,
       PORTE, DOOR, FENÊTRE, WINDOW, au singulier ou au pluriel) : leurs portes et
       fenêtres ferment les baies des murs. Un tel calque le reste quelle que soit la
       classe que Decisions lui propose (sauf mur ou cloison à 0,8 ou plus). Jamais un calque masqué ni un trait quasi
       blanc. Une page sans groupe mur ou cloison n'est pas remplie (une page lue par
       couleurs n'en a que par correspondance, ou par Decisions à 0,8 ou plus).
     - Portes : un arc de 60 à 120°, de 0,50 à 1,60 m de rayon, dont les points sont à
       égale distance d'un centre (la paumelle), seul autour de ce centre (deux copies
       d'un même arc tracé deux fois n'en font qu'un : mêmes bouts et même milieu ; les
       deux moitiés d'un cercle sont deux arcs), avec un trait qui finit à la
       paumelle (le vantail, un tableau de mur : à moins de 1 pt, ou 5 % du rayon), est
       le battant d'une porte. Il ne fait pas barrière ; ses deux rayons, oui : le
       vantail et la ligne d'ouverture, de la paumelle à l'autre bout de l'arc, le long
       du mur. Le quart de disque du battant reste ainsi à la pièce où la porte s'ouvre.
       Une porte tracée d'un seul trait (paumelle, bout du vantail, arc, autre bout :
       une polyligne exportée) se lit de même. Un arc sans rien à son centre (un angle
       de mur arrondi) reste une barrière. Un cercle d'au plus 1 m de rayon (poteau,
       appareil, aire de rotation) ne fait pas barrière.
     - Grille de cellules de 3,5 cm sur le terrain (au plus 8,4 millions par page, soit
       une feuille A0 à 1 pt ; au-delà de 10 cm par cellule, la page n'est pas remplie).
       Chaque pièce se remplit depuis le centre de sa surface imprimée, ou la cellule libre
       la plus proche à moins de deux hauteurs de texte.
     - Sont de la pièce : les formes fermées intérieures (mobilier, appareils dessinés
       sur un calque de murs) jusqu'à 4 m² chacune, sauf si elles portent la surface
       d'une autre pièce, et les poches fermées derrière une menuiserie qui la borde
       (le battant d'une fenêtre dessiné vers l'intérieur), jusqu'à 4 m² chacune. Une
       poche est prise entière : si une partie atteint la surface imprimée d'une autre
       pièce, le bord de la grille ou 4 m², ce n'en est pas une (jamais ce qui reste de
       la pièce voisine derrière une cloison vitrée). Une poche que bordent les
       menuiseries de deux pièces (une niche entre elles), ou posée sur le sol d'une
       autre pièce, n'est à aucune des deux.
     - Aire : les cellules, plus une demi-cellule le long de chaque bord entre la pièce et
       un trait (un trait passe n'importe où dans ses cellules).
     - Rejetés, comptés au rapport avec leur raison, jamais mesurés : un remplissage qui
       sort des murs (bord de la grille), qui contient la surface imprimée d'une autre pièce
       (une pièce par contour), qui couvre 90 % de la largeur ou de la hauteur de la feuille
       (le long du cadre), ou dont l'aire dépasse 1,5 fois la surface imprimée ou en est
       sous les deux tiers.
     - La surface imprimée ne remplace pas une mesure absente. Son éventuel emploi
       pour relever la quantité chiffrée conserve la géométrie et la référence
       séparément, sous le contrat de TI-680 décrit ci-dessus.
     - Le contour du remplissage (au plus 2 000 points, en coordonnées de page) est la
       géométrie de la pièce, comme un polygone ; l'item dit « remplissage entre murs ».
       Il fait le tour de la pièce et de ses poches (reliées par les cellules de
       menuiserie entre elles), une demi-cellule plus loin, sur les traits, comme l'aire
       les compte : il entoure l'aire mesurée. Il n'a pas de trou : une forme fermée de
       plus de 4 m² laissée hors de l'aire (une gaine) reste à l'intérieur du contour.
   - Le nom de pièce imprimé au-dessus de sa surface se lit dans le repère du texte : une
     page tournée (/Rotate 90) se lit comme dessinée.
   - Dans le métré, chaque pièce mesurée donne un item en m² (l'aire du polygone) et sa
     géométrie : le polygone en mètres depuis le coin haut gauche de la page. Un polygone
     de plus de 2 000 points garde son aire sans son contour, jamais une forme coupée.
7. **Page raster.** Quand des images couvrent au moins 90 % de la page, ses vecteurs
   ne mesurent pas ses réseaux. La lecture niveau C reste la source.
8. **Géométrie enregistrée.** Un item de réseau ou de calorifuge porte tous ses axes.
   Au-delà de 4 000 axes, la longueur devient plusieurs items de même désignation, de
   4 000 axes au plus chacun ; leurs quantités s'additionnent à la longueur mesurée.
   Les items d'un métré restent dans ce que sa revue lit (5 000 géométries, 200 000
   axes ou côtés de polygone) : une page qui dépasserait garde sa lecture sans ses items,
   et la raison est journalisée. Une page garde au plus les 300 pièces de sa lecture.

## Decisions dans le métré

Le worker lit les plans d'un métré de niveau C avec `MERGEONE_TAKEOFF_VECTORS=1`. Il
classe en plus les groupes restés sans classe par Decisions avec
`MERGEONE_TAKEOFF_DECISIONS=1`, à condition que Decisions soit configuré
(`MERGEONE_OPENAI_DECISIONS=1` et sa clé, `getTakeoffDecisionsCapability()`). Les appels
sont faits pour l'utilisateur du métré, sur son tenant
([`worker-server.ts`](../../src/lib/takeoff/vectors/worker-server.ts)).

- Chaque page est lue par mots-clés, ses groupes sont classés, puis la page est relue
  avec les réponses.
- Plafonds par défaut, modifiables par Thanh :
  - 10 appels groupés et 50 appels dédiés au plus par document et par traitement, sur
    l'ensemble de ses pages (`TAKEOFF_VECTOR_DECISIONS_LIMITS`). Au-delà, les groupes
    restent « à revoir » et la page le dit (arrêt « call_limit »). Deux cas : les groupes
    jamais demandés, comptés dans `left_out`, et ceux dont la réponse faible n'est pas
    redemandée seule, comptés dans `dedicated_left_out` ;
  - un plafond de jetons par traitement, consulté avant chaque appel
    (`TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS`, 400 000 au départ, à recaler sur la passe
    réelle).
- Plusieurs cas arrêtent Decisions pour le reste du traitement, sans nouvel essai :
  - le premier appel en échec ou indisponible ;
  - une erreur avant l'envoi ;
  - le plafond de jetons ;
  - un serveur sans module de dessin.

  Les pages suivantes gardent leur lecture par mots-clés, leurs groupes « à revoir », et
  disent pourquoi. Une page dont les images n'ont pas pu être dessinées n'arrête que
  cette page.
- Une erreur de Decisions ne fait jamais échouer la page ni le métré. Seul le contrôle
  du métré avant chaque appel l'arrête, comme pour tout appel de fournisseur : le bail
  de traitement, le tenant actif.
- La page enregistrée garde la classe, la source et la confiance de chaque groupe. Sur
  ses 400 groupes, les groupes classés passent avant les plus longs, pour que les groupes
  de chaque item mesuré restent lisibles.
- Elle garde aussi le nombre de groupes à revoir, compté sur toute la page : les groupes
  visibles (ni masqués, ni quasi blancs), sans candidats de légende, d'au moins 0,1 % de
  la longueur visible, sans classe ou proposés par Decisions sous 0,8.
- Elle garde enfin un résumé Decisions facultatif : appels groupés, dédiés et en échec,
  réponses, jetons, latence et arrêt. Ni contexte ni image.
- Les lectures d'avant restent valides, sans migration. Une lecture enregistrée avec ces
  champs ne se relit plus avec le code d'avant : pas de retour arrière après le
  déploiement.
- Un item ne nomme parmi ses groupes que ceux qu'il mesure, jamais une proposition sous
  0,8.
- La revue du métré montre la source de chaque réseau : mots-clés, légende, libellés, ou
  « Decisions 80 % » à la plus faible confiance de ses groupes. La source est lue sur les
  groupes que l'item nomme, 64 au plus, ceux de Decisions d'abord. La revue montre aussi
  ce qu'a fait Decisions sur la page, la raison d'un arrêt et le nombre de groupes à
  revoir.
- Sans ces options, aucun appel n'est fait : les groupes sans mot-clé restent « à
  revoir ».

## Decisions au banc

Sans option, le banc vectoriel ne lit que les mots-clés et n'appelle aucun modèle.
Avec `--max-decisions-tokens <n>`, il classe les groupes restants par Decisions, sous ce
plafond de jetons pour tout le run :

- il faut `TAKEOFF_BENCH_CHATGPT_OWNER` (le tenant des appels), et, injectés seuls,
  `MERGEONE_OPENAI_DECISIONS=1` et `OPENAI_DECISIONS_API_KEY`. La clé n'est jamais
  enregistrée ;
- chaque page est lue par mots-clés, classée, puis relue avec les réponses ;
- si Decisions est indisponible, aucune page n'est lue. Un appel en échec ou un refus du
  plafond arrête le run : il est incomplet, les pages suivantes ne sont pas lues, et le
  script sort avec le code 2 ;
- le rapport donne, par document, les appels groupés et dédiés, les jetons, les
  latences p50 / p95 des appels et des rendus, le plafond et l'arrêt ; `report.json`
  garde la réponse de chaque groupe (alias, groupe, classe, confiance, statut, appel).

Avec ou sans Decisions, `report.json` garde pour chaque page les candidats de la lecture
par mots-clés : les groupes envoyés, et ceux écartés avec leur raison.

Le score au devis ne juge pas la classe des groupes : sur les plans de développement,
même une classe parfaite de chaque candidat ne gagne aucune clé. `--group-truth <dossier>`
(TI-704) note donc chaque groupe contre une vérité privée, hors du jeu
([`group-score.ts`](../../src/lib/takeoff/bench/group-score.ts)) :

- le dossier contient des fichiers `<id du document>.json` au schéma de `truth/groups`,
  vérifiés comme eux. Il est refusé dans le jeu : là, le banc le lirait comme les
  correspondances de l'utilisateur et l'empreinte du jeu changerait. Il n'est jamais
  appliqué ; le rapport garde l'empreinte de ses fichiers, jamais leur contenu ;
- par document et au total : réseaux trouvés avec la classe exacte et au niveau parent
  (HW pour HW-S), réseaux proposés sous 0,8, réseaux répondus « autre », non-réseaux pris
  pour un réseau, groupes laissés « à revoir » (sans classe, ou réponse Decisions sous
  0,8), candidats retenus et écartés (un réseau écarté est perdu pour Decisions),
  précision des réseaux classés. Un groupe d'une page en échec, ou d'un document qu'une
  passe n'a pas atteint, est « non lu » ;
- par tranche de confiance des réponses Decisions : propositions de réseau, exactes, au
  niveau parent, sur des non-réseaux, et précision ;
- le coût du run sur toutes ses pages : appels, jetons et latence par page.

## Labo : écran Vecteurs et « classe de calque »

Le labo métré (`/dashboard/admin/takeoff/lab/vectors`, [guide](../testing/takeoff-lab.md))
montre la lecture d'une page d'un document du labo, sans rien écrire dans la base ni dans
le dataset :

- la page est extraite et lue par mots-clés, comme au banc. Chaque groupe de tracés (un
  calque, sinon une couleur) a sa classe, sa source (mots-clés, légende, libellés,
  Decisions…), sa confiance, la devinette des mots-clés seuls, sa longueur et ses
  segments. Le plan montre les groupes cochés ; Alt-clic sur une case n'affiche que ce
  groupe. Au plus 20 000 segments par page sont dessinés, les plus longs groupes d'abord ;
  un groupe coupé le dit ;
- « Classer avec Decisions » lance la tâche « classe de calque » : un appel
  `classifyVectorGroups` sur la page, sous le plafond `TAKEOFF_LAB_DECISIONS_MAX_TOKENS`
  demandé avant chaque appel. Les images sont rendues par le serveur. Le premier appel en
  échec arrête l'essai, sans relance. L'essai enregistre la somme des jetons, chaque
  réponse normalisée et un élément par groupe interrogé, jugé dans les verdicts comme toute
  réponse ;
- la page est relue avec les réponses de cet essai : un réseau Decisions n'est mesuré qu'à
  0,8 ou plus ;
- la version du prompt est `takeoff-vector-groups-v1+<sha256>` du modèle des questions
  (instructions et choix, alias « groupe_NN ») : deux documents gardent la même version ;
- « Copier la sélection » donne le JSON `truth/groups` des groupes cochés (`{ page, group,
  class }`) : une personne écrit la vérité hors du labo.

## Score au banc

Le banc note les items vectoriels avec le scoreur du niveau C (TI-660).

Depuis la version 3 du score, un item EU ou EV compte sur une clé EUV, et un départ ou
un retour sur sa clé confondue (CHW, HW, GLY, HRC, CW). Cela ne vaut que si le
périmètre chiffre le parent et jamais le membre, dans ce matériau. Un item qui hésite
entre deux membres d'un même parent se lit comme ce parent. RECS ne compte jamais
sur ECS.

Depuis la version 4, un tel item garde les contrôles de ses autres attributs : un DN
inconnu ou deux DN le laissent illisible, comme tout item.

La comparaison avec la baseline niveau C ne totalise que les périmètres notés par les
deux runs à chaque passe. Une page raster que la baseline n'a pas lue fait échouer la
page : son périmètre n'est pas noté. La baseline a lu une page quand un de ses appels
réussis la couvre et qu'aucun appel en échec ne la couvre. Une baseline lancée sur une
partie des pages (`--pages`, `--pages-from`) doit en plus compter la page parmi ses
pages lues : lues dans un même appel, les pages 1 et 3 ne disent rien de la page 2. Un
rapport de tri dont les pages gardées ne montent pas strictement (désordre, doublon, page
au-delà du document) est refusé : un appel n'est rendu que par sa première et sa dernière
page.

Un item de la baseline appartient à sa page (`source_page`). Sans elle (le champ est
facultatif), il appartient à la page que ses appels ont lue (`item_chunks`), parmi les
pages lues : il n'est jamais recopié sur chaque page raster. Si ses appels ont lu
plusieurs pages, on ne sait pas de laquelle il vient : ces pages ne sont pas lues,
plutôt que de lui en donner une.

**Tranches vecteur et raster** (TI-678, décision Q8 du 5 nov.). Elles sont ajoutées
après lecture des résultats de la réserve v1 et le rapport le dit. Le chiffre global,
calculé comme avant, reste le chiffre de tête.

- Un plan est dans la tranche de ses pages dans le run vectoriel : « vecteur » si aucune
  n'est raster, « raster » si toutes le sont. Un plan aux pages mêlées, ou dont les
  passes ne s'accordent pas, n'est dans aucune tranche et le rapport le nomme. Un plan
  dont une page a échoué n'est pas noté : il est déjà hors des totaux.
- Par tranche, longueurs et surfaces à part, sur les mêmes plans que les totaux :
  - la **couverture**, part des clés notées qui ont été lues, dans ou hors tolérance ;
  - l'**erreur médiane des clés lues**, sans les clés manquées ; rien si aucune n'est lue ;
  - les clés dans la tolérance.
- Par tranche encore, un seul chiffre pour tous les types de clés : les **erreurs
  silencieuses**, clés à haute confiance en erreur, quand le run a classé ses lignes.
- **Abstention.** Une page raster est confiée à un humain. Sur la tranche raster, la
  lecture vectorielle ne lit donc rien : ses clés sont comptées, jamais réussies. Les
  lignes que le run y recopie de la baseline sont la lecture de la baseline, montrée à
  côté.
- **Intervalle par plan.** Le rapport donne le plan le plus bas et le plus haut de la
  tranche, chaque plan étant la médiane de ses passes. Une tranche d'un seul plan n'a
  pas d'intervalle.
- Le critère des longueurs (part strictement plus haute, erreur strictement plus basse,
  une clé manquée comptant 100 %) est aussi calculé sur la tranche vecteur. Il n'a pas
  de verdict sur une abstention.

**Longueurs jugées à la mesure au trait** (TI-662, décision du 11 nov.). Un devis peut
compter plus de tuyau que le plan n'en trace : chutes vers les appareils, majorations,
arrondi de chaque tronçon. Une lecture qui suit le dessin reste alors en dessous du
devis, même quand elle lit juste. Le jugement est ajouté après lecture des résultats de
la réserve v1, et le rapport le dit. Les chiffres jugés au devis ne changent pas.

- **La mesure.** Une personne mesure le plan à la main, le long de l'axe du tuyau
  dessiné, en plan seulement, sans chute, sans majoration et sans arrondi. La consigne
  est de mesurer sans regarder les quantités du devis ni la lecture ; le banc ne peut
  pas le vérifier. Les clés à mesurer viennent de la vérité, donc du devis : la mesure
  dit combien le plan trace de chaque ligne du devis, pas ce que le plan trace en plus.
- **Le fichier.** `truth/measured/<id>.json` du jeu privé porte une ligne par longueur
  notée du plan (zone, niveau, réseau, matériau, diamètre), avec sa longueur en mètres.
  Une ligne que la personne n'a pas pu suivre sur le plan reste sans longueur (`null`),
  jamais à 0 : sa clé reste jugée au devis.
- **Le contrôle.** `takeoff:bench:check` construit les clés comme le score. Il refuse :
  - une mesure qui ne porte pas le nom de son plan, ou d'un plan sans binaire, que le
    banc ne lit jamais ;
  - une ligne qui n'est pas une longueur notée du plan : faute de frappe, comptage,
    calorifuge au m², ligne hors score (non observable, observable en partie, ambiguë) ;
  - une mesure qui oublie une longueur notée du plan : le jugement porterait sinon sur
    les clés que quelqu'un a choisi de mesurer ;
  - la mesure d'un plan dont la vérité couvre plusieurs plans (voir plus bas).
- **Le jugement.** La longueur lue par chaque run est comparée à la mesure au lieu du
  devis, à 10 % de la mesure. Une clé manquée compte 100 %. Seules les clés mesurées
  sont comptées, des deux côtés, et le rapport les rapporte aux longueurs notées des
  plans jugés. Le critère des longueurs y est calculé comme ailleurs.
- **Plans jugés.** Seuls les plans de la tranche vecteur, notés par les deux runs à
  chaque passe. Sur un plan raster ou mixte, le run vectoriel porte les lignes de la
  baseline : les juger compterait la lecture de la baseline comme celle des vecteurs.
  Un plan mesuré qui n'est pas jugé est nommé dans le rapport, avec sa raison : vérité
  de plusieurs plans, plan non noté par les deux runs à chaque passe ou non lancé, plan
  raster ou mixte, aucune longueur mesurée.
- **Vérité de plusieurs plans.** Une mesure est celle d'un plan, et se juge sur la
  vérité de ce plan seul. Une vérité de niveau ou de lot a des clés qu'un plan ne trace
  qu'en partie, ou pas du tout : elle reste jugée au devis.
- **Écart du devis.** Le rapport donne la médiane de (devis − mesure) / mesure sur les
  clés mesurées : c'est ce que le jugement au devis demande à une lecture au-delà du
  dessin. Il est négatif quand le devis compte moins que le dessin.
- **Trace.** `report.json` garde, par plan jugé et par clé, le devis, la mesure et la
  lecture de chaque run à chaque passe, ainsi que les longueurs notées restées sans
  mesure. `report.md` n'imprime que des parts et des écarts, jamais une quantité.

## Règles fixes (L5)

Les règles fixes qui lisent cette lecture (DN × réseau, doublons Z1/Z2 et recalage,
aires, pièces, quantités à saisir) sont décrites dans [regles-metre.md](regles-metre.md).
