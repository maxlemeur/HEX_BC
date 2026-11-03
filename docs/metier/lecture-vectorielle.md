# Lecture vectorielle des plans (métré L3)

La lecture vectorielle mesure les réseaux et les surfaces de pièces à partir des
tracés et du texte du PDF, sans modèle. Elle est déterministe : la même page donne
toujours les mêmes groupes, la même échelle et les mêmes longueurs.

Le code est dans [`src/lib/takeoff/vectors/`](../../src/lib/takeoff/vectors/).
Le banc la mesure avec `npm run takeoff:bench -- --pipeline vector`
([`vector-run.ts`](../../src/lib/takeoff/bench/vector-run.ts)).

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
     le départ ou le retour. TEXTE, COTE, MUR et CLOISON donnent les autres classes ;
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

   Viennent ensuite les correspondances de l'utilisateur (au banc, celles de
   `truth/groups`), puis Decisions pour les groupes restés sans classe (étape à venir).

   Le badge « Détection X % » vaut la longueur classée divisée par la longueur des
   tracés de la page hors quasi-blancs.
5. **Mesure** ([`measure.ts`](../../src/lib/takeoff/vectors/measure.ts)).
   - Un tuyau est dessiné en bande : deux contours et des teintes. La mesure prend son
     axe :
     - traits parallèles (à 0,5° près) qui se chevauchent le long du tuyau, regroupés
       tant qu'ils sont à moins de 2,5 pt l'un de l'autre, dans une bande de 7 pt au
       plus : un trait parallèle ailleurs sur la feuille ne coupe jamais une bande ;
     - intervalles fusionnés au-delà des trous de 1 pt au plus ;
     - un trait en double ne compte qu'une fois.
   - Les embouts et les manchons posés en travers d'une bande de leur réseau ne comptent
     pas. Le tuyau court d'un autre réseau qui la croise compte.
   - Ne sont pas mesurés : les échantillons de la légende et les cadres de détail. Un
     cadre de détail est un rectangle sombre fermé, ses quatre coins tracés, d'au moins
     70 pt de côté, qui n'est pas lui-même un tracé de réseau, et qui contient des réseaux
     mais presque pas de fond de plan (ses propres bords ne comptent pas). Un mur ouvert
     en U n'est pas un cadre.
   - Les morceaux d'un libellé sur une même ligne de base (pdfjs le coupe aux
     changements de police) sont réunis, même légèrement inclinés : un texte éloigné de
     cette ligne n'arrête jamais la recherche de la suite.
   - Le DN, le matériau et le calorifuge viennent du libellé :
     - par sa ligne de rappel, dont l'extrémité tombe à moins de 8 pt de l'axe. Elle part
       du libellé : un mur qui passe sous le libellé sans s'y arrêter n'en est pas une ;
     - sinon par sa position : le tuyau parallèle le plus proche.
   - Deux tronçons bout à bout dont les libellés diffèrent (DN, matériau ou calorifuge,
     à une réduction) sont coupés là où un de leurs traits finit, s'il y a exactement un
     tel endroit entre les deux libellés. Sinon le tronçon garde un DN vide
     (« à revoir ») et aucun DN ne lui est propagé.
   - Ces valeurs passent aux tronçons raccordés du même réseau, du plus proche au plus
     loin, jamais à un autre réseau. Un tronçon qui n'est rattaché à aucun libellé
     garde un DN vide (« à revoir »).
   - Les recherches de voisinage (libellés, raccords, embouts) trouvent tout tracé, même
     un long tuyau en diagonale d'une feuille A0.
   - Longueur réelle = longueur sur la feuille (mm) × dénominateur de l'échelle.
6. **Surfaces** ([`surfaces.ts`](../../src/lib/takeoff/vectors/surfaces.ts)).
   - La mesure est l'aire du plus petit polygone fermé autour de la surface imprimée
     d'une pièce, × échelle².
   - La surface imprimée sert de contrôle, jamais de repli : une pièce sans polygone
     fermé n'a pas d'aire mesurée. Elle est comptée au rapport.
   - Un polygone est fermé par son tracé (h, s, re) ou revient à son premier point, à
     moins de 0,5 pt, sans fermeture explicite. Un contour laissé ouvert (une porte, un
     côté manquant) ne délimite aucune pièce.
   - Une pièce par contour : un polygone qui contient aussi le libellé d'une autre pièce
     (l'enveloppe d'un bâtiment, le cadre de la feuille) n'est pas le contour de la pièce.
   - Un contour sur un calque masqué n'est pas imprimé : il ne délimite aucune pièce.
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
