# Règles fixes du métré (L5)

Le modèle propose, les règles expliquent les anomalies et l'utilisateur contrôle
les valeurs clés (TI-664 et cadrage TI-681 confirmé les 8 et 9 novembre 2026).

Le métré se suit depuis son affaire, y compris pour une analyse créée sur une ancienne version du devis. Depuis sa revue, l’envoi au tableau de chiffrage exige toujours l’aperçu d’impact et une confirmation humaine.

## Liste des postes de l’affaire

Un **poste** est une prestation demandée à l’affaire. La liste des postes est un
fait enregistré de l’affaire, en révisions immuables
(`supabase/migrations/20261121230719_takeoff_item_lists.sql`). La page **Métrés**
la montre en entier tant que l’affaire n’a pas de devis, puis sur une ligne avec un
lien « Voir la liste des postes ». Tous les lecteurs de l’affaire la lisent, avec son
historique et ses sources. L’opérateur du métré de l’affaire la complète :
administrateur de l’entreprise ou ingénieur propriétaire de l’affaire, la règle de
qui peut lancer une analyse.

**Sources.** Le serveur résout les sources sous la règle de lecture de l’affaire. Il
lit tout import lié à l’affaire, quel que soit son auteur. Chaque lecteur voit donc
la même liste, même si sa session ne voit pas l’import. La DPGF du dossier donne la
liste lorsque son import est terminé, que ses colonnes sont validées et que ses lignes
sont attestées. Sans DPGF, la liste vient du gabarit publié par l’entreprise, à
défaut de la version livrée avec l’application. Une DPGF à préparer ou plusieurs
DPGF renvoient au dossier. Le prix n’intervient jamais : la quantité de la DPGF reste
une référence documentaire. Aucun texte libre de l’import n’est montré ni enregistré
dans la liste : les notes d’une ligne n’y laissent qu’une empreinte, qui distingue deux
lignes sans rien révéler à un lecteur qui ne voit pas l’import. L’empreinte est calculée
avec une clé propre à l’affaire, dérivée d’une clé de l’entreprise que seul le serveur
lit : essayer des notes probables ne permet pas de la retrouver, et deux affaires ne se
comparent pas. Le serveur seul s’en sert ; elle n’est jamais envoyée au navigateur.

**Choix de structure.** La confirmation d’un import enregistre ses choix : une ligne
devenue section et son niveau, gardée comme ligne, ou ignorée. Elle enregistre aussi
les lignes que l’import a écartées, avec leur raison : un total et les options qui le
suivent, les paramètres du classeur, une ligne ignorée. La liste ne fait jamais un
poste de ces lignes. La confirmation porte sur les lignes qu’elle consomme, entières,
telles que la base les garde : toutes les lignes de l’import, rejetées comprises, dans
l’ordre où le serveur les lit, chacune avec sa ligne brute, sauf les quatre clés que
seule la liaison au catalogue écrit. La base seule en calcule l’empreinte, sur le texte
enregistré (un nombre tel qu’il a été écrit : 1,50 n’est pas 1,5). Quand la confirmation
garde la dernière correspondance de l’import, l’aperçu lit cette correspondance et
l’empreinte d’une seule lecture, montre la structure de cette correspondance, et le
formulaire renvoie les deux. Quand elle écrit la correspondance du membre, ce sont les
lignes qu’elle vient d’écrire et aucune autre, avec l’empreinte que la base en donne
aussitôt après : ce que le membre a vu découle des lignes brutes et de la correspondance
choisie. La base la recalcule sous
le verrou de l’import, dans la lecture même qui vérifie les lignes, et l’enregistre comme
preuve. Des lignes écrites par la correspondance d’un autre onglet, encore en cours
d’écriture, ou une valeur modifiée la refusent ; le formulaire affiche alors « Le mappage
a changé dans un autre onglet : rechargez-le et vérifiez-le avant de confirmer. » Les
lignes enregistrées par une version antérieure de l’application, à plat dans leur
charge, restent acceptées. Les choix s’enregistrent dans la transaction du devis créé.
Sans devis, ils s’enregistrent juste après la correspondance, qui s’écrit en plusieurs
requêtes et ne peut pas partager leur transaction : la confirmation ne réussit pas sans
eux, le formulaire le dit, et confirmer de nouveau les enregistre. Si une ligne de
l’import change ensuite (une nouvelle correspondance, ses colonnes modifiées, une valeur
réécrite), la preuve ne correspond plus ; lier l’import au catalogue ne la change pas. Si un devis est créé
depuis l’import après la confirmation sans enregistrer de choix (une version antérieure
de l’application), les choix ne sont plus établis. Chaque création retient elle-même,
avant de rendre la main, le devis qu’elle vient d’écrire (jamais un devis existant) et
les imports de son affaire dont viennent ses lignes (jamais un autre identifiant) :
supprimer plus tard la section importée, ou copier une section dans le devis créé, même
aussitôt, ne change rien. Une copie d’un devis (« Nouvelle version », variante, copie d’une
préparation de métré) n’est pas une création : elle ne change rien aux choix. Dans
ces deux cas, la liste lit les titres tels quels et le dit. Une ligne vide, illisible
ou un en-tête répété ne devient jamais un poste, quel que soit le choix.

**Emplacement d’origine.** Pour un CSV, la position est le rang de l’enregistrement
importé (« Enregistrement importé N »), jamais une ligne physique du fichier. Pour un
classeur importé depuis l’enregistrement de la ligne où commence son tableau, la liste
donne la ligne de la feuille, telle qu’Excel la numérote, puis la ligne du tableau
(« Ligne 5 de la feuille (ligne du tableau 3) »). Un classeur importé avant donne la
ligne du tableau seule (« Ligne du tableau 3 »), comptée depuis le début de la plage
lue. La revue de la structure de l’import nomme les lignes de la même façon, et la
ligne d’en-tête se saisit en ligne du tableau. Pour un PDF, c’est la page.

**Identité.** Un poste reçoit un identifiant à sa première apparition, dérivé de son
origine : ligne brute de la DPGF, ligne du gabarit ou ajout à la main. Il le garde
d’une révision à l’autre, y compris après une nouvelle correspondance. Un poste retiré
puis revenu retrouve le sien. Deux lignes homonymes restent deux postes. Une nouvelle
origine reprend un poste existant seulement par un rapprochement confirmé par un
opérateur ; le poste garde alors ses deux origines. La base de données refuse toute
autre réutilisation, et l’identifiant d’un poste d’une autre affaire.

**Révisions.** Quand le dossier ou le gabarit change, la page propose une révision :
postes ajoutés, retirés, modifiés et rapprochements possibles. Tous les changements
s’ouvrent avant d’accepter. Un poste modifié nomme chaque fait qui change, avec sa
valeur avant et après : l’unité dans laquelle chaque côté se mesure (la sienne, sinon
celle lue sur la ligne DPGF, même non reconnue, sinon « à préciser »), base de
mesure, chaque discriminant, référence quantitative, section (deux sections de même
titre distinguées par leur ligne dans la DPGF, deux familles du gabarit par leur
version), référence de la ligne DPGF ; un
changement des notes de la ligne est signalé, avec les autres, sans leur texte, un
changement de place aussi. Un rapprochement montre, des deux côtés, ce qui distingue
deux homonymes : la section et l’origine (ligne, page, référence, version du
gabarit). Aucun rapprochement n’est coché d’avance. Rien n’est appliqué sans
« Accepter la révision proposée ». Le serveur recalcule la proposition et refuse
celle qui a changé depuis l’affichage. Une révision garde les choix de structure qu’elle a
appliqués et les lignes écartées avec leur raison, par leur position seule. La liste
les montre pour la révision enregistrée et pour chaque révision de l’historique, depuis
la révision elle-même : elle dit encore pourquoi une ligne n’est pas un poste quand
l’import ou sa correspondance a disparu. Les postes ajoutés à la main restent à leur place. La première liste d’une
affaire s’enregistre par « Enregistrer la liste proposée », par le premier ajout, ou
par la première demande d’analyse qui la scelle.

**Ajout d’un poste.** « Ajouter un poste » est possible à toute date : avant, pendant
ou après une analyse, et après un premier envoi. L’opérateur donne une désignation,
une unité ou « à préciser », une base de mesure, des discriminants (réseau, matière,
diamètre) et une section. Il ne saisit ni quantité ni prix. L’auteur et la date sont
ceux du serveur. Un double clic ne crée qu’un poste, et une acceptation qu’une
révision, que l’affaire ait déjà une liste ou non : le second clic rend le reçu du
premier. Le même geste rejoué rend
son reçu ; un autre contenu sous la même clé (une autre section, une autre sélection de
rapprochements) est refusé. Quand la réponse du serveur n’arrive pas, l’ajout et
l’acceptation d’une révision le disent, rendent le bouton et gardent ce qui a été
saisi ou coché ; le clic suivant renvoie le même geste, qui n’est jamais enregistré
deux fois.

**Gabarit.** L’administrateur corrige le gabarit de plomberie dans **Administration
› Gabarit de postes**. Il enregistre un brouillon et voit les ajouts, retraits et
modifications par rapport à la version publiée. Abandonner le brouillon ramène
l’éditeur à la version publiée, sans recharger la page. Il publie ensuite une version
numérotée. Chaque poste du gabarit garde son identifiant d’une version à l’autre. Un
poste nouveau ne reprend jamais l’identifiant d’un poste que le gabarit a eu, même
retiré : la base le refuse à la publication, et une affaire se voit proposer un
rapprochement au lieu de le subir. Un onglet périmé ne publie, n’abandonne ni
n’écrase le brouillon d’un autre administrateur : chaque enregistrement du brouillon
lui donne un jeton jamais réutilisé. Rejouer une publication ne rend son reçu que pour
le brouillon qu’elle a publié. La nouvelle version vaut pour les affaires sans
liste. Une affaire qui a déjà une liste se voit proposer l’écart. Une publication ne
modifie aucun devis, aucune analyse et aucune demande déjà scellée.

**Demande d’analyse.** Une demande scelle la liste à son admission derrière
l’activation du second ordre de mesure : la révision enregistrée, son numéro,
l’empreinte calculée par la base et son nombre de postes. Tant que l’activation
n’est pas posée, une demande scelle l’extraction libre, comme avant. Une fois
activée, une DPGF à préparer suspend l’admission avec un motif. Le Mac du mandat
réessaie alors seul.

Une ligne de devis créée depuis un import garde dans sa provenance l’import et la
ligne mappée. La ligne mappée nomme la ligne brute dont elle vient ; quand une
nouvelle correspondance la supprime, la base garde ce lien. La ligne de devis et ses
copies retrouvent donc leur ligne brute par une jointure prouvée, sans rien ajouter à
leurs métadonnées.

Lire la liste, la compléter ou publier le gabarit ne lance aucune analyse et ne crée
aucun devis.

### Tableau des postes

La page **Métrés** montre sous l’avancement des plans un tableau des postes : une
ligne par poste de la révision enregistrée, avec son unité, son état, la quantité
observée, la quantité retenue ou saisie à part, la référence et l’écart DPGF, la
couverture (plans lus sur plans demandés), ses motifs et sa décision. Les postes qui
attendent une décision viennent d’abord, puis l’ordre de la liste. La portée est
l’affaire, ou un plan choisi dans le filtre « Plan » ; les filtres État, Famille,
Localisation et Décision s’ajoutent, et l’adresse de la page les garde avec le poste
en vue. Une adresse choisit une vue, jamais un geste, un payeur ni un droit.

**États.** « À mesurer » : aucun plan n’a été interrogé sur ce poste, par exemple un
poste ajouté après le lancement. « En lecture », « Lecture incomplète » et « Échec de
lecture » décrivent un travail sans verdict : la quantité observée reste partielle et
aucune absence n’est certifiée sur l’affaire tant qu’un plan reste à lire. Un plan encore
en attente ou en lecture garde le poste « En lecture » ; sinon il est en « Échec de
lecture » quand aucun plan n’a répondu, en « Lecture incomplète » quand d’autres ont
répondu, quelle que soit la cause de l’arrêt. La base et la lecture contre la liste
appliquent la même règle. Quand tous
les plans demandés ont répondu, une réponse incertaine rend le poste « Incertain » ;
sinon une quantité mesurée le rend « Mesuré » ; sinon il est « Non trouvé », sans
quantité (jamais 0). Les quantités de deux plans s’additionnent dans une même unité,
jamais deux unités entre elles ; la valeur candidate d’une réponse incertaine n’est
jamais une mesure. L’écart à la DPGF est jugé sur un total complet, à vérifier au-delà
de 1 %.

**Lecture.** La base pagine, filtre, ordonne et compte le tableau
(`supabase/migrations/20261122100758_takeoff_item_review_decisions.sql`) : l’état de
chaque poste est celui des réponses enregistrées, sa décision celle de ses réponses. La
localisation d’un plan est celle qu’un opérateur a enregistrée (bâtiment, niveau) ; un
plan localisé seulement par la lecture de son cartouche n’apparaît pas dans ce filtre.

**Gestes.** Un lecteur voit le tableau ; l’opérateur du métré coche des postes, sur
plusieurs pages ou tous les résultats d’un filtre, que le serveur fige avec leurs
révisions (1 000 postes au plus par geste, jamais tronqués). La sélection, les valeurs
en cours de saisie et le poste en vue restent quand un plan répond et après un
rechargement de l’onglet. Chaque geste dit sa portée et combien de postes il touche
avant confirmation. La base le décide dans la session du membre, auteur de la
décision : elle compare chaque réponse (toujours la lecture en cours du poste sur ce
plan), la révision de sa décision et celle de la saisie ; si un poste a changé depuis la
sélection, elle n’applique rien et le nomme. Un geste attend l’enregistrement en cours
d’une ligne dans la revue ciblée, puis juge la ligne telle qu’elle est enregistrée ; deux
gestes sur une même affaire passent l’un après l’autre. La même commande renvoyée
(double clic, réponse perdue) rend la même réponse ; une autre sous la même clé est
refusée. Chaque
effet est journalisé, poste par poste et ligne par ligne.

- **Accepter les mesurés sans anomalie** : seulement les postes mesurés à couverture
  complète, sans hypothèse, contrôle en échec ou à recalculer, confiance faible, preuve
  localisée manquante, remarque de la lecture, unité différente ou écart DPGF. Un poste
  incertain ne devient pas mesuré. Les lignes positives du poste sont vérifiées au nom du
  membre, avec les contrôles d’une vérification, que la base refait ; rien n’est envoyé
  au devis.
- **Écarter la sélection** : un motif choisi une fois (hors périmètre, doublon, erreur
  de lecture, autre avec une note), écrit sur chaque lecture concernée, y compris sans
  quantité. Les lignes positives sont exclues avec ce motif, leur vérification retirée,
  leurs règles à recalculer. Un poste qu’aucun plan n’a lu n’a rien à écarter. Une
  réintégration rend à chaque ligne ce qu’elle était (une hypothèse reste exclue comme
  elle est arrivée) et garde la trace. Une ligne d’une analyse déjà envoyée n’est pas
  modifiée.
- **Demander à l’IA de mesurer de nouveau** : un aperçu nomme le membre qui confirme,
  qui paie sur son propre forfait ChatGPT, le réglage de Mon profil, les plans et les
  postes ; un effort ponctuel peut être choisi sans changer le profil. Un seul poste
  suffit, et un poste jamais mesuré l’est sur les plans lus de l’affaire. Pendant une
  analyse de l’affaire, la sélection reste prête. La confirmation de l’aperçu est le
  consentement ; l’admission de la demande vient avec une prochaine évolution, d’ici là
  rien n’est lancé.
- **Saisie complémentaire** : dans les cellules des postes non trouvés ou incertains,
  une valeur et une unité par poste, puis une seule catégorie pour la sélection, avec
  la note obligatoire d’une hypothèse. Le résultat de la lecture reste consultable ; une
  hypothèse saisie ne compte qu’une fois incluse, poste par poste. Aucun forçage.

Le détail d’un poste montre chaque plan, ses pages cherchées et illisibles, ses sources,
ses motifs, la décision et son auteur, et mène à la revue ciblée existante pour la
preuve et la correction.

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
  Des longueurs identiques réunies en une ligne gardent la page principale et la
  position de la mesure qui vient en premier dans ce que le chiffreur voit : sa page
  (une mesure sans page en dernier), sa position dans la section, puis sa ligne de
  métré ; jamais un identifiant tiré à chaque application (suivi de l'envoi, migration
  [`…_takeoff_send_grouped_lines_and_parts.sql`](../../supabase/migrations/20261121085058_takeoff_send_grouped_lines_and_parts.sql)).
  La ligne nomme cette ligne de métré (`takeoff_length_rounding.representative_item_id`) :
  sur le moteur 2, où une ligne n'en nomme aucune, c'est ce que l'envoi compare.

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
  signalé, et n'est appliqué que par une décision (section suivante).

## Une page n'entre qu'une fois au devis — TI-682 (lot D)

Règle de métier : une page de plan entre une fois au devis ; une nouvelle mesure
remplace l'ancienne. Une révision du plan (même « Référence du plan ») est la même
page. Avant ce lot, rien ne comparait deux métrés d'une même page : relancer un plan
et l'appliquer avec « Ajouter » doublait ses quantités sans un mot.

**Prévenir (PR 1), puis remplacer (PR 2).** La définition de « même page » et la
lecture du devis ci-dessous servent aux deux : l'avertissement des revues, et la
décision et le refus à l'application.

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
  - dans l'écran « Envoyer au tableau de chiffrage », avant la confirmation : la
    décision « Pages déjà au devis » (section suivante) ;
  - une fois le métré appliqué, seules restent signalées les pages où ses propres
    lignes sont encore au devis : là, la page y est deux fois, sauf si le chiffreur a
    gardé les deux mesures (le bandeau dit alors ce choix et son motif). Ses lignes sans page
    sont sur la page signalée, par la même règle. Appliqué depuis la revue, le
    bandeau relit le devis ; il le relit aussi quand la revue complète enregistre la
    page source corrigée d'une ligne. L'exclusion d'une ligne ne demande pas de
    relecture : le bandeau filtre les pages sur les lignes affichées.
- **Provenance périmée.** Une clé d'arrondi, de ligne DPGF ou de remplacement écrite
  par un autre métré que le dernier de la ligne (une fusion ultérieure l'a gardée) ne
  compte pas.
- **Lecture.** `GET /api/takeoff/jobs/{jobId}/page-contributions?version_id=` (la
  version revue ; 404 si elle est illisible ou si le métré n'en fait pas partie), et
  `POST /api/takeoff/page-contributions` avant un lancement. Lecture seule, sous la
  session de l'utilisateur : le tenant actif, la lecture de la version et de ses
  métrés, et la RLS des lignes du devis, des lignes de métré et des métrés la bornent. La définition est écrite une
  fois en TypeScript
  ([`page-contributions.ts`](../../src/lib/takeoff/page-contributions.ts)), sur la table
  de cas de [`page-contributions.test.ts`](../../src/lib/takeoff/page-contributions.test.ts).
  Sa jumelle SQL (`private.takeoff_pages_already_in_estimate` et ses fonctions) lit les
  mêmes cas : [`page-contributions.vectors.json`](../../src/lib/takeoff/page-contributions.vectors.json),
  joués par Vitest et par `takeoff-page-contributions-twin.test.sql`.
- **Ce qui ne relève pas d'une règle fixe** : c'est une décision par page, prise à
  l'application, pas une erreur de quantité d'une ligne ; les règles fixes ne lisent
  ni le devis ni une version copiée.

**Remplacer ou garder les deux (PR 2).** À l'envoi au tableau de chiffrage, pour chaque
page déjà au devis, le chiffreur choisit ; la base refuse une page appliquée une
seconde fois sans décision.

- **Remplacer la mesure précédente** (recommandé, présélectionné). Ligne à ligne : la
  ligne de devis garde son identifiant, sa place, son titre (le libellé du chiffreur),
  son prix, sa catégorie, ses réglages de main-d'œuvre et de fourniture, son statut et
  ses colonnes du lot C. Sa quantité perd la part de la page (ses lignes de métré
  sources sur la page) et reçoit la nouvelle mesure ; une longueur est arrondie une
  fois au mètre, comme `finalize_takeoff_lengths`. Une ligne qui couvrait aussi
  d'autres pages garde leur part. Sa provenance devient le nouveau métré (clé
  `takeoff_page_replacement` : quantité précédente, part retirée, part ajoutée,
  sources). Le marqueur de provision suit le nouveau métré : le dernier métré gagne.
- **Appariement proposé** ([`page-replacement.ts`](../../src/lib/takeoff/page-replacement.ts)),
  entre une ligne du nouveau métré et une ligne de métré source de la page, dans
  l'ordre : même désignation et même unité que la ligne source (pas le titre du devis,
  que le chiffreur a pu renommer) ; même réseau (nature, réseau, matériau, DN) pour
  une ligne vectorielle ; même unité et désignation proche (indice de Jaccard des mots
  ≥ 0,5), la meilleure. Chaque source sert une fois ; plusieurs lignes nouvelles
  peuvent remplacer les sources d'une longueur regroupée. Jamais deux unités, jamais
  une ligne DPGF (son rapprochement la remplace déjà), jamais d'un document à un autre :
  une ligne qui ne connaît que le nom de son plan n'est pas appariée sur une page où
  deux plans identifiés de ce nom se rencontrent (la limite de groupement de la
  PR 1). Une longueur regroupée sur deux plans (le regroupement ne lit pas le
  document) se remplace sur chacun, chaque nouvelle ligne remplaçant la part de son
  propre document (revue Codex de 251a98a1). Le chiffreur corrige chaque paire ; la liste ne propose que ce que la base
  accepte. Mesuré sur les sorties du banc (trois relances, sans appel au modèle) :
  70,4 % des lignes vision et 98,6 % des lignes vectorielles sont appariées.
- **Lignes que le nouveau métré n'a plus** : aucun choix par défaut, « Retirer du
  devis » ou « Garder », et deux boutons qui règlent toutes les lignes en un clic
  quand il y en a plusieurs. La confirmation attend un choix pour chacune. Une ligne
  qui porte aussi des pages que ce métré ne relit pas ne se retire pas : elles
  partiraient avec elle ; elle se garde. Une ligne dont toutes les pages sont relues
  par l'application se retire (revue Codex de 708c7fbf : lue page par page, elle ne se
  retirait jamais). Une ligne gardée avec une page « garder les deux » ne se retire
  pas non plus. L'écran dit pourquoi. Une ligne d'ouvrage tient sa quantité de
  l'ouvrage : elle se garde ou se retire, jamais une ligne du métré ne la remplace.
  Une section d'ouvrage n'est pas une ligne de la page.
- **Rien remplacé** : un « remplacement » qui garde toutes les lignes précédentes
  garde en fait les deux mesures ; il demande « Garder les deux » et son motif.
- **Quantité modifiée à la main** (elle diffère de ce que ses sources donnent) :
  « Prendre la nouvelle mesure » ou « Garder ma quantité » ; jamais écrasée sans ce
  choix. Une longueur appliquée avant TI-681 (sa mesure brute, jamais arrondie) n'est
  pas une quantité modifiée. Une ligne des moteurs 1 et 2 ne nomme pas ses sources :
  elle est remplacée entière, et comme une modification à la main ne peut pas s'y
  voir, le choix est toujours demandé.
- **Garder les deux**, avec un motif codé : autre zone de la même feuille, autre lot
  ou corps d'état, périmètre complémentaire (note de 10 à 500 caractères). Ouvert aux
  ingénieurs comme aux administrateurs. Refusé seulement quand la fusion,
  obligatoire avec un DPGF, envoie une nouvelle ligne sur une ligne précédente de
  la page.
- **Une ligne DPGF** (TI-682 D4) somme les mesures qu'elle garde, métré par métré :
  remplacer une page retire la part de cette page, que le nouveau métré alimente de
  nouveau la ligne ou non ; garder les deux garde les deux parts.
- **Une part DPGF dont la part par page est inconnue** (TI-716). Appliquée avant le
  cumul par un seul métré sur plusieurs pages, et dont les lignes figées ne redonnent
  plus le calcul, la mesure d'une ligne DPGF forme un bloc. Remplacer une seule de
  ses pages est refusé (`dpgf_part_unknown`) : une quantité que personne ne peut
  attribuer n'est jamais retirée. Aucune remise à zéro de la ligne n'est proposée :
  elle retirerait, sans le montrer, ce que les autres pages ont mesuré. L'écran d'envoi
  le dit avant l'envoi et le refus de la base le nomme : la ligne (désignation,
  unité, quantité), les pages que le bloc mêle, puis deux issues. Recommandée :
  relire aussi ces pages dans le métré (une relance qui les lit, ou « Remplacer »
  sur celles qu'il relit déjà) et les remplacer ensemble : le bloc sort entier.
  Sinon, garder les deux sur la page : elle compte alors deux fois, à corriger à la
  main (TKD05).
- **« Fusionner » sur une ligne DPGF** (TI-716). La fusion rattache une ligne du
  métré à la première ligne de même titre et de même unité de la section, hors du
  rapprochement. Sur une ligne DPGF que l'application alimente, une ligne que le
  rapprochement ne relie à aucune ligne DPGF est refusée : la somme de la ligne DPGF
  effacerait sa mesure. Sur une ligne DPGF dont l'application remplace une page
  sans l'alimenter, toute ligne est refusée, même reliée ailleurs (D4). Le refus
  (`TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT`, `merged_outside_reconciliation`)
  nomme les deux lignes ; relier la ligne dans le rapprochement, ou l'exclure à la
  revue. Une ligne qui alimente une ligne DPGF compte dans la somme de celle-ci
  ([`…_takeoff_dpgf_merge_refusals.sql`](../../supabase/migrations/20261113175750_takeoff_dpgf_merge_refusals.sql)).
  Sur une ligne DPGF que l'application n'alimente pas et dont elle ne remplace
  aucune page (TI-723), la fusion en faisait sans un mot une ligne de métré
  ordinaire : sa quantité du DPGF et sa composition, max(référence DPGF,
  Σ mesuré + Σ protecteur), étaient perdues. Elle est refusée de même, même reliée
  ailleurs, le détail disant que l'application ne compose pas la ligne
  (`composed`) et ce qu'elle tient (`dpgf_quantity`). L'issue est le rapprochement :
  reliée à cette ligne DPGF, la ligne l'alimente par sa composition, sa référence
  gardée. Une fusion ne devient jamais une part de la composition : ce serait
  changer ce que « Fusionner » veut dire. La règle tient en une phrase : une ligne
  DPGF ne reçoit une mesure que par le rapprochement ; « Fusionner » n'y envoie une
  ligne que si l'application l'alimente et que le rapprochement relie cette ligne à
  une ligne DPGF. La proposition des pages (`dpgf_merge_refusals`) nomme chaque
  ligne refusée avant l'envoi ; l'écran d'envoi le dit (« La fusion enverrait… »),
  n'offre pas la confirmation et ouvre le rapprochement (TKD06,
  [`…_takeoff_dpgf_merge_any_line.sql`](../../supabase/migrations/20261113202356_takeoff_dpgf_merge_any_line.sql)).
- **« Remplacer la section » sur des lignes DPGF** (TI-726). Ce remplacement vide la
  section cible, sous-sections comprises, avant d'écrire le métré. L'écran d'envoi ne
  le propose plus (depuis le 18 novembre 2026) ; envoyé directement à l'API par un métré qui
  n'alimente aucune ligne DPGF, il supprimait sans un mot les lignes DPGF de la
  section, leur quantité du DPGF et leur composition avec elles. Une ligne DPGF ne
  sort jamais du devis sans un geste qui la nomme : la base refuse ce remplacement dès
  que la section ou l'une de ses sous-sections tient une ligne DPGF, que le métré
  l'alimente ou non (`TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT`,
  `replace_deletes_dpgf_lines`). Le refus nomme la section et ses lignes DPGF
  (désignation, quantité, unité ; les 20 premières, et leur nombre). L'issue est
  « Fusionner » par le rapprochement : les lignes DPGF restent, une ligne du métré
  reliée à l'une d'elles l'alimente par sa composition. Une section qui ne tient
  aucune ligne DPGF se remplace toujours. « Ajouter » à côté d'une ligne DPGF
  alimentée reste refusé (« Fusionner » obligatoire). Le remplacement de la racine
  reste désactivé, et une décision de page ne remplace ni ne retire une ligne DPGF
  (TKD07,
  [`…_takeoff_dpgf_section_replace.sql`](../../supabase/migrations/20261113211347_takeoff_dpgf_section_replace.sql)).
- **Une ligne DPGF arrivée pendant l'application** (TI-728). Une version sans ligne
  DPGF s'applique sans autorisation DPGF ; une version qui en tient une est refusée
  (`TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED`) et passe par le rapprochement. Ce
  contrôle se lisait avant les verrous : une ligne DPGF copiée dans le brouillon à cet
  instant (« Importer la DPGF » liée, copie de section) y échappait, puis « Remplacer
  la section » la supprimait ou « Fusionner » la réécrivait en ligne de métré, sa
  quantité du DPGF perdue sans un mot. Il se lit maintenant sous le verrou de la ligne
  de la version, que toute écriture d'une ligne du devis tient jusqu'à sa validation
  (les copies le prennent avant d'insérer) : une
  copie validée avant est vue et l'application est refusée ; une copie qui arrive
  après attend la fin de l'application, puis se pose à côté de ses lignes. Le serveur
  dit que la validation DPGF n'est plus valable et la relance relit la version (pgTAP
  `takeoff-apply-dpgf-check-race`,
  [`…_takeoff_apply_dpgf_check_under_lock.sql`](../../supabase/migrations/20261113224854_takeoff_apply_dpgf_check_under_lock.sql)).
- **Stratégie** : l'écran ne la fait plus choisir. Une version qui tient une ligne DPGF
  (une *ligne* importée du DPGF : la section racine d'un import lié n'en est pas une)
  fusionne (« Fusionner » obligatoire, ses paires imposées) ; toute autre ajoute
  (« Ajouter »), et une page déjà au devis y met à jour chaque ligne précédente à sa
  place. L'écran suit ce que le serveur lit en calculant la proposition
  (`merge_required`) : si une ligne DPGF est apparue ou a disparu depuis la lecture des
  sections, l'aperçu et la proposition sont recalculés pour la nouvelle stratégie
  avant toute confirmation, et c'est elle qui est envoyée. L'aperçu, la proposition et
  l'envoi ont toujours la même stratégie.
- **Une décision, un seul endroit** (revue Codex de 708c7fbf). La base décide par ligne
  du devis, sur toutes les pages de l'application : une seule quantité choisie par
  ligne, un seul retrait, une seule paire par ligne du nouveau métré. L'écran fait de
  même ([`page-decisions.ts`](../../src/components/takeoff/takeoff-apply-wizard/page-decisions.ts)) :
  la décision d'une page appartient à la page ; la paire, à la ligne du nouveau métré ;
  la quantité choisie, le retrait et la part d'une page, à la ligne du devis. Ce que
  l'écran montre, ce qu'il attend encore et les décisions envoyées se lisent d'une
  même résolution de ce brouillon. La confirmation est rangée par ligne du devis :
  les pages remesurées d'abord (remplacer ou garder les deux), puis chaque ligne du
  devis une fois, avec ses pages, la quantité qu'elle gardera et ses choix, puis chaque
  ligne du nouveau métré une fois, avec la ligne qu'elle remplace.
- **Une ligne du nouveau métré sans page** se trouve sur chaque page où elle peut
  être ; elle n'est proposée qu'une fois et remplace la part de chacune de ces pages
  sur la ligne qu'elle remplace.
- **La part d'une page sans nouvelle ligne** : une ligne mise à jour par une page qui
  porte aussi une autre page remesurée, sans ligne nouvelle qui la remplace là,
  demande « retirer sa part » ou « la garder ».
- **Le contrat de l'écran avec la base** (TKD03,
  [`page-decisions-contract.e2e.ts`](../../e2e/army/takeoff/page-decisions-contract.e2e.ts)).
  Ses situations se déduisent de la base : chaque motif de refus que la migration peut
  lever est soit atteint, dans une situation, par une décision naïve que la base refuse
  pour ce motif précis, soit nommé avec la raison pour laquelle le contrat le laisse
  de côté ; un motif ajouté sans situation fait échouer le parcours. Dans chaque
  situation (une ligne sur une page et sur deux, sur deux plans, toutes ses pages ou
  une seule remesurées, une ligne nouvelle sans page ou écartée à la revue, une ligne
  disparue, une ligne d'ouvrage, une quantité modifiée à la main, une version DPGF,
  une ligne DPGF alimentée depuis la page), chaque état que l'écran laisse confirmer
  est appliqué par la vraie fonction de la base, au nom du chiffreur, puis annulé : il
  doit être accepté ; chaque choix que l'écran ne propose pas, forcé, doit être refusé.
- **La décision se prend à la confirmation**, sur l'écran de l'aperçu, que rien ne
  règle à la main : les lignes qui entrent au devis, donc celles qui peuvent remplacer,
  sont celles que la revue retient, moins celles que les règles de correspondance de
  l'administrateur laissent de côté ou remplacent par un ouvrage et, sur une version
  DPGF, celles que le rapprochement a classées hors périmètre. La proposition lit la
  version où l'application écrit (celle du métré).
- **Un choix vaut pour la révision de la ligne** : « Prendre la nouvelle mesure », un
  retrait ou la part d'une page choisis sur une ligne tombent si la ligne a été
  modifiée depuis (son `updated_at` a changé quand la proposition est relue, après un
  refus ou un changement de section) ; l'écran redemande le choix. Sinon un refus pour
  devis modifié, puis un second clic, écrasaient la seconde modification à la main.
- **En base**, sous le verrou de la version, dans la transaction de l'application
  ([`…_takeoff_page_decisions.sql`](../../supabase/migrations/20261112025548_takeoff_page_decisions.sql)) :
  les décisions, enregistrées dans la transaction même de l'application, sont relues
  après tout enregistrement de l'éditeur en cours (l'application verrouille la ligne
  de la version, comme l'éditeur, avant de les lire ; leur insertion l'attend aussi)
  contre le devis tel qu'il est (une ligne supprimée ou
  modifiée depuis la proposition, une décision d'une autre personne : 409, à relire),
  le remplacement s'applique, puis le filet `private.assert_takeoff_pages_once`
  vérifie que chaque contribution antérieure restante sur une page du métré est
  gardée par une décision, ligne source par ligne source. Sans décision :
  `TAKEOFF_PAGE_ALREADY_APPLIED`, 422 qui nomme la page. Les décisions
  (`takeoff_page_decisions`) sont gelées à l'application et rattachées aux métrés,
  non recopiées avec une version.
- **Ce qui reste possible** : une ligne collée ou recréée à la main (sans provenance) ;
  une section copiée dans la même version ; des lignes sans plan ni page ; un même plan
  déposé sous deux noms sans préparation ; un même dessin dans deux fichiers
  différents (rôle de Z1/Z2) ; « garder les deux » choisi à tort, mais motivé et
  tracé.

## Envoyer au tableau de chiffrage (18 novembre 2026)

Depuis la revue complète ou ciblée de l’affaire, « Envoyer au tableau de chiffrage »
ouvre l’écran où le métreur vérifie l’impact de son envoi. L'ancien assistant
en quatre étapes (cible, stratégie, aperçu avec ajustements,
confirmation) n'existe plus
([`TakeoffApplyWizard.tsx`](../../src/components/takeoff/TakeoffApplyWizard.tsx)).

- **Ordre de l'écran** : la destination (« Section cible », la première présélectionnée,
  et ce que la section reçoit) ; l'aperçu d'impact, calculé sans clic dès que les
  sections sont lues, puis à chaque changement de section (en cas d'échec,
  « Réessayer ») ; la liste des lignes envoyées, en lecture seule, avec la désignation
  (et la nouvelle quand une règle la renomme), la quantité, l'unité, le fichier et la
  page, et ce qu'une règle de correspondance a fait, en français, avec son nom ; puis,
  seulement quand ils ont quelque chose à montrer, la fusion sur une ligne DPGF, les
  pages déjà au devis, les lignes DPGF, les lignes bloquées (avec le forçage réservé
  aux administrateurs) et le contrôle non bloquant. « Annuler » et « Confirmer l'envoi ».
- **Rien n'est écrit avant la confirmation**, qui n'est active qu'une fois l'aperçu et
  la proposition des pages déjà au devis calculés pour la sélection affichée, et quand
  l'aperçu retient au moins une ligne (le forçage administrateur attend les mêmes
  conditions). Chaque sélection (une section, même reprise après une autre ; une
  stratégie corrigée par le serveur ; une relecture après un refus) est une nouvelle
  génération : une réponse calculée pour une génération précédente, ou pour un autre
  métré, n'est jamais montrée ni confirmée. Tout ce que l'écran a lu et chaque choix
  qui y est fait appartiennent à un métré d'une version : un autre métré ou une autre
  version (même en revenant au premier) repart d'un écran vide. Après un refus pour
  métré, devis ou décisions périmés (`atomic_mapping_stale`, `page_decision`,
  `page_already_applied`, `dpgf_quantities`, `dpgf_authorization` : une ligne DPGF
  apparue, ou une validation DPGF expirée), les sections sont relues, la section
  choisie gardée, puis les deux calculs. Une lecture qui échoue (sections, aperçu ou
  pages déjà au devis) propose « Réessayer » ; chaque aperçu recalculé est annoncé aux
  lecteurs d'écran.
- **Fusion sur une ligne ordinaire** (18 novembre 2026) : sur une version DPGF,
  l'envoi fusionne, et l'écrivain rapproche une ligne du métré d'une ligne de la
  section cible de même désignation et de même unité, puis remplace sa quantité et sa
  provenance. L'écran rejoue ce rapprochement
  ([`merge-overwrites.ts`](../../src/lib/takeoff/merge-overwrites.ts)) et refuse
  l'envoi tant qu'une ligne ordinaire placée directement sous la section serait
  écrasée, sauf quand la proposition des pages l'apparie par la fusion (une décision de
  page dit alors ce qu'elle devient). Il nomme chaque ligne avec sa quantité et celle
  qui la remplacerait, et demande une autre section ; la confirmation et le forçage
  administrateur attendent. Là où la locale de la base décide (majuscule ou espace
  hors ASCII), toutes les lignes de cette désignation comptent, jamais moins que
  l'écrivain ; l'écran ne connaissant pas le moteur de la version, le rapprochement de
  l'un ou l'autre écrivain compte. Depuis le lot 2 (M2), l'écrivain le refuse aussi sous
  le verrou de la version, pour toute entrée de l'application (la route et les deux
  surcharges de `apply_takeoff_job_guarded_atomic`) : une ligne de la section que la
  fusion a rapprochée n'est réécrite que si c'est une ligne DPGF (ses propres refus
  décident) ou une ligne antérieure d'une page que ce métré relit (sa décision de page
  décide). Sinon `TAKEOFF_APPLY_ORDINARY_LINE_CONFLICT` nomme la ligne, sa quantité et la
  ligne du métré, et rien n'est appliqué. Un forçage administrateur ne vaut jamais
  consentement à écraser une ligne ordinaire.
- **Lignes envoyées** : la liste ne montre que ce qui part (une ligne remplacée par un
  ouvrage part comme cet ouvrage) ; les lignes qu'une règle laisse de côté sont
  listées à part, avec la règle. Sur une version DPGF, l'aperçu ne calcule pas les
  lignes que le rapprochement a classées hors périmètre (il lit les règles de
  correspondance seules) : la liste s'appelle « Lignes retenues avant le rapprochement
  DPGF », et l'écran dit, à côté de son compte, qu'elles ne partent pas et que la liste
  ne les distingue pas. Les distinguer demanderait que le serveur les renvoie. Le
  compte « Écartées » lit l'aperçu à jour (lignes exclues à la revue, laissées de côté
  ou remplacées par un ouvrage), jamais un compte lu par la revue avant lui.
- **Règles de correspondance** : celles de l'administrateur s'appliquent comme le
  serveur les lit. L'écran n'envoie plus d'ajustement par ligne (`overrides`, avec
  identifiants et prix en centimes) ; l'API les accepte toujours.
- **Arrivée** : une fois envoyé depuis une revue, un message confirme les lignes créées,
  mises à jour et ignorées, et le navigateur ouvre l'éditeur du devis sur la première
  ligne créée, sinon la première ligne alimentée ou mise à jour, sinon sur le tableau
  seul (`/dashboard/estimates/<version>/edit?focusItemId=<ligne>`,
  [`apply-landing.ts`](../../src/lib/takeoff/apply-landing.ts)). Le verrou de brouillon
  pris pour l'envoi est rendu avant la navigation : il est lié à l'identité de la page,
  que l'éditeur ouvert dans le même document reprend, et une libération tardive
  effacerait le verrou de l'éditeur. Le verrou est rendu dans tous les cas ; la
  navigation n'a lieu que si la revue est encore affichée pour ce métré : quitter la
  revue pendant l'envoi (retour du navigateur) n'y ramène pas l'utilisateur depuis un
  autre écran, seul le message s'affiche. L'envoi en cours et son refus ne s'affichent
  que sur la revue de ce métré et de cette version. L'éditeur rouvert sans ligne puis
  sur la même ligne la met de nouveau en évidence. Les sorties du panneau des lignes bloquées
  sont désactivées pendant l'envoi, et deux clics dans la même image n'envoient qu'une
  fois.

## Envoyer un métré d'affaire sans devis préalable (lot 2, M2)

Un métré admis sur l'affaire sans version de devis (lot 2, M1) s'envoie aussi par
« Envoyer au tableau de chiffrage », depuis la revue complète ou ciblée. L'écran
([`TakeoffSendDialog.tsx`](../../src/components/takeoff/takeoff-send/TakeoffSendDialog.tsx))
commence par l'aperçu de la destination ; rien n'est écrit avant la confirmation : ni
devis, ni version, ni section, ni quantité.

- **Ce que l'aperçu montre.** L'aperçu est l'envoi lui-même, exécuté puis annulé dans la
  base (son essai à blanc) : il montre les lignes du devis telles que l'envoi les laisse —
  créées, modifiées (quantité avant et après) ou retirées par une décision de page, chacune
  dans sa section, avec l'unité et la quantité écrites (une longueur arrondie une fois au
  mètre, deux longueurs identiques réunies en une ligne) — à côté des mesures envoyées.
  L'unité est celle que la ligne garde : son code d'unité sur le moteur 3, le texte de sa
  description sur le moteur 2 (une unité libre, « sac », reste « sac »). La confirmation
  porte ce résultat ; si l'envoi écrirait autre chose, tout est refusé. Ce qui est comparé :
  pour chaque ligne créée, modifiée ou retirée, sa section, son titre, son unité (une ligne
  sans unité est nommée par son statut de prix, à part : une unité libre « status:lot » reste
  une unité), sa quantité (et celle d'avant), son prix unitaire et les lignes de métré qu'elle
  reçoit ; pour chaque ligne de métré, sa cible (nouvelle ligne ou ligne antérieure, laquelle,
  dans quelle section) ; les sections créées ; pour une version créée, ses réglages tels
  qu'elle est enregistrée, dont ceux que la création prend à la politique de calcul du tenant
  (les coefficients de vente du moteur 3) ; et la source de chaque ligne (son fichier, sa page et
  la ligne de métré qu'elle nomme), dont, pour une ligne qui réunit plusieurs longueurs, la mesure
  qui la représente : elle vient en premier par sa page, sa position puis sa ligne de métré, et
  une confirmation qui en a vu une autre est refusée. Ce qui ne l'est pas : les identifiants des
  lignes créées et leur position. Un aperçu ne laisse rien : sa
  commande déposée part dans la transaction qui lui répond, refus compris (empreinte
  différente, commande expirée ou demande déjà reçue aussi). Un refus de l'aperçu est une
  réponse : le code d'un des refus nommés de l'envoi, et pour un aperçu périmé ou une décision
  de page l'identifiant de sa raison, sans aucun texte de la base ; toute autre erreur
  interrompt l'appel et n'est écrite que dans le journal du serveur.
- **Destination** ([`send-plan.ts`](../../src/lib/takeoff/send-plan.ts)). Sans version :
  « Créer le premier brouillon et y envoyer N lignes », la section proposée
  « Métré — <jeu de plans> » créée avec lui. Un seul brouillon : il est proposé. Plusieurs
  brouillons : l'écran demande lequel. Seulement des versions émises : la copie de la plus
  récente est annoncée, créée à la confirmation, et l'original n'est jamais modifié. Un
  brouillon qui tient une ligne DPGF reste proposé mais bloqué, et l'aperçu le dit d'abord,
  sans rien lire d'autre de ce brouillon : son rapprochement exige le métré sur la version,
  ce que seul l'envoi fait (à faire dans un lot suivant). Un brouillon ouvert par un autre
  membre est nommé aussi : l'envoi y attend qu'il le libère ; un bail expiré ne compte plus,
  comme pour l'éditeur. L'aperçu ne fait jamais échouer l'enregistrement d'un éditeur : il
  prend les verrous de l'éditeur dans son ordre, refuse un brouillon qu'un autre membre
  édite avant de prendre quoi que ce soit dont ses enregistrements ont besoin, et n'attend
  que deux secondes un verrou tenu (« Le devis est en cours de modification : réessayez dans
  un instant. », avec « Réessayer »).
- **Ce qui part.** Les lignes que la revue retient, renommées ou classées par les règles
  de correspondance de l'administrateur. Une règle qui fixe un prix ou intègre un ouvrage
  est sans effet dans ce parcours et l'aperçu le dit : les prix ne sont jamais touchés, et
  la base refuse un plan qui le ferait (`TAKEOFF_SEND_PRICE_RULE_REFUSED`). Une règle
  modifiée après l'aperçu le rend caduc.
- **Plan A puis plan B.** Envoyé dans la section où une ligne d'un autre métré porte déjà la
  même désignation et la même unité, un comptage s'ajoute à cette ligne au lieu d'en créer
  une seconde (3 lavabos, puis 2 : une ligne de 5, son prix inchangé). Sur les deux moteurs :
  le moteur 3 complète la ligne comme son écrivain, le moteur 2 recalcule la version comme
  pour une ligne DPGF qui somme les métrés qu'elle garde ; une ligne du moteur 2 garde son
  unité dans sa description, et ne reçoit que la même unité écrite de même (« m » et « ml »
  restent deux lignes, comme l'aperçu les montre). Seulement sur une ligne alimentée par des métrés seuls, qui les
  nomme, dont la quantité est encore la somme de leurs lignes (une quantité saisie à la
  main n'est jamais modifiée par un envoi), sans longueur arrondie ni hypothèse d'un côté ou
  de l'autre, et quand la désignation ne nomme qu'une ligne de la section (deux homonymes
  restent deux lignes). La ligne nomme chaque envoi qui l'alimente (`takeoff_contributions` :
  ses lignes de métré, lues par la règle « une page entre une fois » comme les autres clés
  de provenance, par la base et par l'écran). Ses parts disent ses sources actives : A envoie 3,
  B ajoute 2, C remplace la page de B par 4, D ajoute 1 : les parts sont A et B, puis A et C,
  puis A, C et D, comme la quantité. Un remplacement de page retire la part du métré remplacé ;
  un ajout reprend les parts des sources actives de la ligne avant la sienne. Une ligne qu'un
  remplacement antérieur à ce suivi a laissée avec la part du métré remplacé n'est pas
  réécrite : son prochain ajout la corrige (sa quantité et ses sources actives étaient déjà
  justes ; seule la liste des parts, qu'aucun écran ne lit, le nommait). Chaque ligne qu'un envoi crée sur un
  brouillon du moteur 2 nomme ainsi ses lignes de métré. Une ligne plus ancienne du moteur 2,
  qui n'en nomme aucune, reste à part : deux lignes, et l'aperçu le montre.
- **Contrôles.** Les doublons et la couverture entre métrés, marqués « Comparaison au devis
  disponible à l'envoi » dans les revues, sont évalués pour la destination choisie, avec les
  métrés d'où viennent ses lignes : ceux du brouillon et ceux qu'une copie y a reportés
  (encore rattachés à la version où ils ont été appliqués) ; pour une copie à créer, ceux de
  la version copiée ; aucun pour un premier brouillon. Chacun n'est dit « vérifié » que s'il
  a été calculé pour une ligne de ce métré : une ligne qui porte des repères sans zone (un
  comptage de lavabos) n'évalue ni l'un ni l'autre, et l'aperçu dit, contrôle par contrôle,
  « non évalués » ou « non évaluée ». Une ligne qui en sort
  bloquée est montrée avant la confirmation, avec le forçage réservé aux administrateurs
  (motif codé et justification). Les pages déjà au devis demandent la même décision qu'à
  l'envoi d'un métré de version ; l'aperçu est recalculé avec ces décisions, et la
  confirmation porte celles-là.
- **Confirmation** ([`send-server.ts`](../../src/lib/takeoff/send-server.ts), migration
  [`…_takeoff_send_receipts.sql`](../../supabase/migrations/20261121050138_takeoff_send_receipts.sql)).
  Le serveur recalcule l'aperçu, essai à blanc compris, et refuse (409) s'il diffère de celui
  confirmé. Un premier brouillon est créé avec les réglages de son aperçu (coefficients,
  taux, arrondi, validité), ceux que la création prend à la politique du tenant compris : ils
  font partie de ce qui est confirmé, et un réglage changé entre-temps refuse la confirmation
  sans rien écrire. Sa date est celle de sa création,
  comme pour « Créer un devis » : une confirmation après minuit n'est pas refusée pour sa
  seule date. Il dépose ce qu'il a calculé (contrôles évalués pour la destination, plan de
  correspondance, parts, résultat que le membre a vu) par `public.stage_takeoff_send`,
  réservée au service ; une commande déposée ne change plus pour son identifiant (une
  autre soumission sous le même identifiant est refusée). La session de l'utilisateur
  n'envoie ensuite que l'identité de sa commande (identifiant, métré, empreinte) : un client
  qui appelle la base directement ne peut ni écrire ses propres contrôles ni contourner le
  forçage. Puis, dans une seule transaction, `public.send_takeoff_job` relit sous ses verrous
  l'état dont l'aperçu vient (les versions de l'affaire, le métré, ses repères et ses lignes,
  les règles de correspondance, le devis et les métrés d'où viennent ses lignes), crée le
  brouillon par la création canonique ou la copie par la duplication, rattache le métré par
  un permis à usage unique, écrit ses contrôles pour cette destination, applique les lignes
  par l'application gardée, ajoute les parts aux lignes antérieures, compare ce qu'il laisse
  au résultat confirmé et enregistre un reçu. Un écart refuse tout
  (`TAKEOFF_SEND_PREVIEW_STALE`) et l'écran recalcule l'aperçu. Une révision d'un repère ou
  d'une preuve rend l'aperçu caduc même si la quantité ne change pas. Les lignes d'audit de
  l'application (« takeoff.apply.completed », et une « takeoff.mapping.applied » par action
  d'une règle de correspondance appliquée à la ligne qui reste : une ligne écartée, ou une
  ligne que l'envoi crée ; pas une catégorie qu'une ligne appariée à une ligne antérieure ne
  reçoit pas, ni celle d'une ligne qu'un ajout fond dans une ligne antérieure) sont écrites
  par l'envoi, dans sa transaction, une fois (commande de format 2 ; le format 1 de
  l'application précédente les laisse à son serveur). Le format fait partie de l'identité
  d'une commande : la même confirmation déposée par un serveur de l'autre format est
  refusée (`TAKEOFF_SEND_REQUEST_CONFLICT`, le membre prévisualise à nouveau). Les catégories
  et les rôles MO par défaut d'un premier brouillon (ceux que donne « Créer un devis ») sont
  créés après l'envoi, pour le propriétaire de l'affaire au moment de l'envoi : une
  confirmation refusée n'écrit rien. L'envoi enregistre avec son reçu le format qui a tourné
  et ce propriétaire ; le serveur enregistre ensuite que ce qui suit l'engagement est fait.
- **Une fois.** Un métré n'est envoyé qu'une fois (`TAKEOFF_SEND_ALREADY_SENT`). Chaque
  confirmation porte un identifiant de commande gardé par l'écran : après un délai dépassé,
  la même commande rejouée renvoie son reçu, sans seconde version ni seconde application,
  même quand le premier essai s'engage pendant que le second recalcule son aperçu, et refait
  ce qui suit l'engagement tant qu'il n'est pas enregistré comme fait (catégories et rôles MO
  par défaut d'un premier brouillon, créés sur leur nom ; règles des autres métrés du
  brouillon ; pour une commande de format 1 dont le serveur ne l'a pas écrite, sa ligne
  d'audit) : un essai arrêté entre l'engagement et ces effets ne les laisse pas manquer, et
  une fois faits ils ne sont pas refaits. Les catégories et rôles par défaut sont enregistrés
  comme faits dès qu'ils le sont, à part : un rôle renommé depuis reste renommé, même si les
  règles restent à recalculer (seul un arrêt entre leur création et cet enregistrement les
  laisse à recréer). Les règles ne comptent comme faites que si leur recalcul a écrit chaque
  ligne lue ; sinon le rejeu suivant les recalcule. Seul un membre qui peut encore envoyer sur
  l'affaire les refait, d'après son rôle, le tenant et l'affaire tels que la base les tient au
  moment de les refaire ; un autre lecteur du reçu le reçoit, sans rien de plus ; le
  même identifiant qui confirme autre chose (empreinte, destination, section, décisions de
  pages, forçage) est refusé (`TAKEOFF_SEND_REQUEST_CONFLICT`), et un membre qui ne lit plus
  le métré (l'affaire passée à un autre ingénieur) n'en reçoit pas le reçu
  (`TAKEOFF_SEND_RECEIPT_NOT_READABLE`). Deux métrés de l'affaire qui ont prévisualisé un
  premier brouillon : le premier confirmé le crée, l'autre est renvoyé à l'aperçu sur ce
  brouillon. Un autre métré du même lancement (même jeu, même révision de préparation), lancé
  hors de toute demande, est refusé par son nom (`TAKEOFF_SEND_PREPARATION_ALREADY_SENT`) ;
  les métrés de deux demandes de lancement sur la même révision s'envoient chacun vers le
  même brouillon (migration `20261121193413_takeoff_launch_exclusion_and_send_requests.sql`).
- **Ordre des verrous**, le même pour toute destination et commun à l'import et à la
  création d'une version : la politique de calcul du tenant (partagée), la ligne de
  l'affaire, puis pour un brouillon existant son verrou de règles
  (`takeoff-rules:<version>`), le verrou de l'éditeur sur ce brouillon (la clé que prend
  l'acquisition de son bail, avant la ligne de la version) et la ligne de la version, puis
  le métré (ses verrous et sa ligne), les règles de correspondance du tenant (partagées) et
  enfin les lignes. Jamais l'inverse. Les versions de l'affaire sont comparées dès qu'elle est
  tenue, avant toute autre attente : un premier brouillon prévu avant qu'une version existe
  est refusé aussitôt, sans faire échouer l'enregistrement de cette version dans l'éditeur.
  La ligne de l'affaire est tenue en `FOR NO KEY UPDATE` :
  deux envois, et un envoi et la création d'une version (qui la tient en `FOR UPDATE`),
  s'attendent ; les versions de l'affaire ne sont comparées qu'une fois elle tenue, aucune
  version ne se crée après la comparaison ; les clés étrangères vers l'affaire (l'avis de fin
  d'une analyse, dont le worker tient le verrou de règles de la version ; le reçu de l'envoi)
  ne l'attendent pas. L'aperçu d'un brouillon existant ne crée aucune version et la tient en
  `FOR SHARE`, comme la lisent les enregistrements de l'éditeur. La ligne de la version est
  tenue en `FOR NO KEY UPDATE` : ni le bail de l'éditeur ni une nouvelle ligne ne l'attendent.
- **Reçu** (`takeoff_send_receipts`, format 1) : la destination, la section, chaque part
  (sa ligne de métré, sa cible réelle : nouvelle ligne ou ligne antérieure, sa quantité
  avant et la section où elle est, la page, l'empreinte du plan attesté, la source de la
  quantité : mesurée, saisie ou hypothèse et sa cause, la révision de sa preuve), le
  résultat confirmé, et à part les lignes réellement créées, modifiées et retirées, chacune
  avec sa section. Lisible par les lecteurs du métré, jamais écrit par un client ; il ne
  part qu'avec son métré, sa version ou son affaire. Les commandes dérivées d'un reçu
  (redistribuer, réviser une part) sont réservées aux lots suivants.
- **Lecteurs.** Avant l'envoi, le propriétaire de l'affaire, un administrateur et un
  directeur lisent le métré, ses lignes et les plans qu'il atteste. Après, le métré suit la
  règle de sa version (propriétaire, administrateur) et garde ses lecteurs d'avant : un
  directeur ne le perd pas par l'envoi. Ses repères restent dessinés sur les plans qu'il a
  attestés (la lecture vectorielle le signale par `attested_plans`), jamais sur le fichier
  actuel du centre de plans.
- **Mise en service.** La base refuse désormais à tout écrivain « Fusionner » sur une ligne
  ordinaire de la section. La v0.8.0 est la première version de l'application dont l'écran
  le refuse avant l'envoi ; la v0.7.0 le proposait encore, et un de ses utilisateurs
  recevrait « Conflit lors de l'application du job takeoff. » sans rien d'appliqué. La
  migration ne s'applique donc qu'après le déploiement d'une v0.8.0 ou ultérieure. Elle
  verrouille des tables existantes (les clés étrangères de ses nouvelles tables, la règle de
  lecture des métrés qu'elle remplace) : une transaction ouverte sur les métrés, les versions
  ou les affaires la fait attendre cinq secondes au plus puis s'arrêter (`55P03`) sans rien
  appliquer. Elle s'applique quand aucun worker de métré ne tourne et que personne n'édite
  de devis, et se relance si elle s'arrête.

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
| `zone_overlap` | `ZONE_OVERLAP_DUPLICATE`, `ZONE_OVERLAP_UNREGISTERED` | `ZONE_OVERLAP_NONE`, `ZONE_OVERLAP_RESOLVED`, `ZONE_OVERLAP_SAME_PAGE` | oui |
| `zone_coverage` | `ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN` | `ZONE_COVERAGE_COMPLETE`, `ZONE_COVERAGE_RESOLVED` | oui |
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
  ([`diameters.ts`](../../src/lib/takeoff/diameters.ts), version 3 ; ajouts de
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
- Deux lectures d'une même page de plan par deux métrés non plus (TI-682, lot D ; version 4 de la règle) : même page au sens de « Pages déjà au devis », par le fichier de la bibliothèque, l'empreinte ou la « Référence du plan », jamais par le seul nom de fichier ni quand les deux pages lisent deux zones. Une ligne dont les seules copies sont sur sa page relue passe en `ZONE_OVERLAP_SAME_PAGE` : c'est l'application qui remplace la mesure précédente ou garde les deux.
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
([`zone-overlap.ts`](../../src/lib/takeoff/rules/zone-overlap.ts), version 4) :

- Même réseau, même genre (tuyau ou calorifuge) et même DN, lu par la série que la règle DN retient pour ce réseau et ce matériau (D18c, TI-684) : « DN 100 » et « Ø 110 » d'une même fonte, ou d'un même inox d'évacuation, sont le même tuyau ; l'inox d'un réseau d'évacuation se lit par la seule série NF EN 1124 et son « DN 100 » ne rejoint jamais un « Ø 108 ». L'identité des quantités DPGF lit les tailles de la même façon, sur le réseau que nomme la désignation.
- Un matériau sans série (calorifuge, matériau absent) compare la taille imprimée : « DN 15 » et « DN 20 » d'un calorifuge sont deux tronçons.
- Axes parallèles à 2° près, à moins de **D = 5 cm** l'un de l'autre, sur une longueur commune d'au moins **L = 30 cm**, et de plus d'une bande du dessin à l'échelle la plus grossière des deux pages (49 cm au 1/200).
- La longueur commune est l'union des tronçons couverts, la plus petite des deux directions, arrondie au millimètre (un demi-millimètre vers le haut).
- La distance D est comprise : une copie à 5 cm pile est un doublon. Deux tronçons bout à bout ne se recouvrent sur rien, quel que soit le bruit des calculs ; aucun résultat ne dépend de la page prise pour repère.
- Le minimum vaut pour chaque tronçon continu. Deux morceaux couverts se continuent quand leurs extrémités se touchent à D près (un coude), ou dans le prolongement l'un de l'autre (parallèles, à D de son axe) à moins du minimum : les tirets d'un réseau en pointillés (20 cm, espacés de 5 cm sur un plan du banc) font un seul tronçon. Quatre contacts de 10 cm en limite de zone, ou trois tuyaux parallèles qui la touchent chacun, ne font pas un doublon.
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

**Plans agrandis** (TI-684, décision D14 du 6 nov. 2026 : « à indice cohérent, le détail agrandi fait foi dans son périmètre » ; version 3 de la règle) :

- Une page est le **plan agrandi** d'une autre quand son échelle est au moins 1,5 fois plus fine (1/50 à côté de 1/100 ou de 1/200), les deux échelles étant lues. Deux pages de même échelle, ou dont une échelle n'est pas lue, ne sont jamais un détail et son plan d'ensemble.
- Une ligne **cède** quand toutes les lignes incluses qui la dessinent aussi sont sur des plans agrandis de sa page. La correction lui revient :
  - elle échoue en `ZONE_OVERLAP_DUPLICATE` tant que sa propre réduction ne retire pas ce que les plans agrandis dessinent d'elle (l'union des tronçons couverts), à 1 cm près, ou qu'elle n'est pas exclue ;
  - elle n'entre dans aucun groupe : un plan d'ensemble au-dessus de deux zones se règle par sa réduction, et les deux zones gardent leur propre paire à leur limite ;
  - le partenaire porte `plan: "enlarged"`, et la raison dit que le plan agrandi fait foi.
- La ligne du plan agrandi échoue avec elle tant que la copie n'est pas retirée (un doublon détecté ne se règle jamais tout seul, et « Accepter » ne lève que la ligne vérifiée). Son partenaire porte `plan: "overview"` ; la raison dit que la longueur se retire de la ligne du plan d'ensemble, et la revue ciblée ne lui propose ni réduction ni retrait. Une ligne en échec ne nomme que ce qui reste ouvert : ses partenaires de même rang, et les lignes du plan d'ensemble qui n'ont pas encore retiré leur copie.
- **Deux lignes seules** (une ligne du plan d'ensemble dont l'unique copie est une ligne du plan agrandi sans autre copie) se règlent comme toute paire : la réduction de l'une ou de l'autre retire la longueur commune. Une ligne de détail réduite avant d'être appliquée compte donc toujours. Au-delà, seules les réductions de la ligne qui cède comptent : celles des plans agrandis peuvent régler leurs propres paires, et une réduction ne dit jamais où elle retire.
- Une copie lue autrement suit la même règle : la lecture du plan agrandi fait foi, et chaque ligne s'accepte (V) si ce sont deux tuyaux distincts.
- **Ne cède pas** :
  - une ligne d'un job appliqué (jamais appelée à changer) : la paire reste réglée par la ligne du job courant, comme avec toute ligne figée ;
  - une ligne qui a aussi une copie sur une page de sa propre échelle, ou sur une page plus grossière : elle se règle comme avant (paire ou groupe). Sur trois échelles (1/200, 1/100, 1/50), la ligne au 1/200 cède aux deux autres, qui gardent entre elles une paire ordinaire ;
  - une ligne en « zones non recalées » : son résultat ne porterait pas le doublon ;
  - une ligne d'une page relue (TI-682, lot D) dont l'autre lecture, incluse, ne cède pas (lecture d'un job appliqué) : les lignes restent un groupe, comme avant.
- **À indice cohérent** : la règle ne lit pas l'indice des plans (il est tenu par la préparation du métré, qui refuse déjà deux révisions d'un même document). Deux plans d'indices différents sont à trancher par l'utilisateur ; la raison rappelle la condition.

**Résolution**

- Deux lignes partenaires forment une paire ; les lignes incluses reliées par des paires forment un groupe. Le résultat ne dépend jamais de l'ordre des pages ni de celui des lignes.
- Une réduction (longueur mesurée − quantité) dit combien une ligne a retiré, jamais où.
- **Paire isolée** (un groupe de deux lignes) : réglée quand les réductions des deux lignes, chacune au plus la longueur commune, la retirent, à 1 cm près par ligne réduite (les quantités sont arrondies au centimètre).
  - Chaque paire garde son propre minimum : un partenaire au 1/200 ne relève pas celui d'une paire au 1/50.
  - **Ligne figée** (job appliqué) : jamais appelée à changer. Non réduite, elle laisse la correction à la ligne du job courant, et la raison le dit ; réduite avant d'être appliquée, sa réduction compte. Deux lignes figées se jugent de même : un reste entre elles reste visible.
  - Exclure une ligne entièrement en double règle aussi la paire.
- **Groupe de trois lignes ou plus** : aucune correction ne le règle. Chaque ligne reste en `ZONE_OVERLAP_DUPLICATE` jusqu'à ce qu'elle soit exclue (entièrement en double) ou acceptée (V).
  - La raison donne, pour chaque ligne partenaire, la longueur commune ; puis la longueur de la ligne que d'autres lignes dessinent (`overlap_m`) et le nombre de lignes du groupe (`group_size`).
  - Exclure une ligne entièrement en double peut ramener le groupe à une paire, qui se règle alors par sa réduction. Un plan de même échelle au-dessus de deux zones qui se touchent, exclu, les laisse sans doublon.
- **Pourquoi** (décision du 4 nov. 2026, après quatre tours Codex et deux revues adverses) : c'est un écart voulu à la résolution par défaut du ticket (« corriger une ligne en retirant cette longueur ») pour les groupes. Régler un groupe par ses réductions exige de savoir où chacune a retiré sa longueur.
  - Chaque modèle essayé a laissé passer un double compte : somme par groupe (une réduction réglait un tronçon que sa ligne ne dessine pas), flot sur des tronçons communs, payeurs d'une couverture minimale (une ligne figée supposée payer ce qu'elle n'a jamais retiré ; des lignes qui sortent d'un tronçon commun, 1,5 m compté deux fois et réglé).
  - Le parcours d'acceptation du ticket porte sur une paire Z1/Z2 de deux jobs d'une version, qui se règle toujours par correction. Trois zones en enfilade, ou un plan de même échelle au-dessus de deux zones, forment un groupe : il faut exclure ou accepter (un plan d'ensemble à une échelle plus grossière cède : voir « Plans agrandis »). L'erreur tombe du côté d'un blocage, jamais d'un double compte.
- Une ligne exclue ne bloque jamais. Elle est montrée telle qu'elle serait si elle revenait, avec ses partenaires et leurs groupes.
- Les lectures vectorielles écartées automatiquement à la création sont comparées entre elles et aux lignes retenues, avant toute inclusion. Un recouvrement les fait apparaître dans la revue ciblée comme « Longueur commune à comparer ». Elles restent exclues du devis ; « Inclure » permet de les retenir, puis de corriger le doublon compté. V et la réduction guidée restent indisponibles tant que la lecture n'est pas retenue. Une exclusion décidée et motivée par l'utilisateur retire la lecture de cette comparaison. Les résultats et quantités des lignes retenues ne sont pas modifiés par les lectures non retenues.
- « Accepter » (V) lève l'échec de la ligne vérifiée seulement. Un recalcul qui lui apporte un échec qu'elle n'avait pas (un nouveau partenaire, une autre règle, un autre code, une autre version) lui retire sa vérification : voir « Décisions ».
- **Limites connues** :
  - deux tuyaux réellement superposés en plan sur deux pages (une feuille par réseau, par exemple) échouent comme des copies lues autrement : c'est à l'utilisateur de les accepter (V) ;
  - deux copies lues autrement sur deux pages sans repère commun ne sont pas signalées ;
  - une copie mal lue qui prend exactement la lecture d'un tuyau voisin (à moins de 5 cm, dessiné sur les deux pages) passe pour ce voisin : elle n'est pas signalée ;
  - une ligne dont le réseau n'est pas lu n'est comparée à aucune autre : sa copie n'est pas signalée ;
  - plans agrandis : le contrôle de couverture de D14 est une règle à part (voir « Couverture des plans agrandis par le plan d'ensemble ») ; l'indice des plans n'est pas lu ; l'échelle sert telle qu'elle est lue, même non vérifiée ; la réduction d'une ligne qui cède à plusieurs lignes n'est pas localisée (réduite pour une autre raison, elle règle aussi ses copies) ; une ligne exclue dont le retour ôterait à une autre le droit de céder est montrée contre les lignes telles qu'elles sont ;
  - une sous-comptabilisation (un tronçon retiré de ses deux copies) n'est pas signalée ;
  - dans une paire, la réduction n'est pas localisée : une ligne réduite pour une autre raison règle aussi sa paire ;
  - un groupe ne se règle que par exclusion ou V, même quand une correction était juste.

**Zones non recalées** : deux lignes qui pourraient être un même tronçon, sur deux
pages sans repère commun, échouent toutes deux en `ZONE_OVERLAP_UNREGISTERED`.

**Valeurs de départ** (mesurées le 3 nov. 2026 sur un plan du banc à deux zones, hors réserve, figées
avant la réserve) :

- **Recalage** : translation de 42,43 m × 6,57 m, résidu 2,4 mm, 335 traits contre 0 pour la translation suivante.
- **Doublons** : 325 m d'axes en double à moins de 0,5 cm, 11 m entre 0,5 et 2 cm, aucun entre 2 et 5 cm.
  - Les premiers tuyaux distincts d'un même réseau sont à 8,6 cm. D = 5 cm tombe dans ce creux.
  - Le plus petit doublon mesuré fait 42 cm. Deux tronçons bout à bout à la limite de zone se recouvrent au plus d'une bande (7 pt : 12 cm au 1/50, 25 cm au 1/100). D'où L = 30 cm.

### Couverture des plans agrandis par le plan d'ensemble

Règle `zone_coverage` (TI-684, décision D14 du 6 nov. 2026 : « à indice cohérent, le détail
agrandi fait foi dans son périmètre, et le plan d'ensemble contrôle la couverture » ;
version 1, écrite 101 avec celle du recalage). Elle lit les mêmes lignes que
`zone_overlap` : les tuyaux et les calorifuges d'une lecture vectorielle, au réseau lu, par
niveau.

- **Ce qu'elle cherche** : un tronçon que le plan d'ensemble dessine dans le périmètre d'un plan agrandi et que celui-ci ne dessine pas. C'est soit un tronçon que la lecture du plan agrandi a manqué, soit un tracé du plan d'ensemble qui n'existe pas (ou plus) à l'échelle du détail, soit une copie dessinée trop loin de son double pour être un doublon. Avant cette règle, il comptait sans alerte.
- **Plan agrandi** : la définition de `zone_overlap` (échelle au moins 1,5 fois plus fine, les deux échelles lues), sur deux pages du niveau qui partagent un repère. Deux pages de même échelle, une échelle non lue ou deux pages sans repère commun ne donnent aucun résultat.
- **Périmètre** : pour un genre (tuyau ou calorifuge) et un réseau, le rectangle qui contient tout ce que le plan agrandi en dessine, lignes exclues comprises (une exclusion règle une quantité, le tracé reste sur la page).
  - Un plan agrandi qui ne montre qu'un réseau ne dit rien des autres : une ligne d'eau chaude n'est pas contrôlée par un détail qui ne dessine que de l'eau froide.
  - Une zone sans plan agrandi reste au plan d'ensemble : ce qui est hors de tout périmètre n'est pas lu.
  - Un tronçon appartient au périmètre quand son axe y est. Un tracé qui longe un bord (parallèle à 2° près) y est encore à D = 5 cm du bord : c'est la copie du tronçon qui dessine ce bord, recalée à 1 ou 2 cm près. Tout autre tracé qui sort du périmètre s'arrête au bord, au millimètre ; un tracé à moins de 2° d'un bord est lu jusqu'à 5 cm au-delà de ce bord.
- **Ce que le plan agrandi dessine d'une ligne** : ses copies sur ce plan, de même lecture ou lues autrement, exclues ou non, avec les seuils du doublon (D = 5 cm, 2°, minimum par tronçon continu à l'échelle la plus grossière).
- **Ligne exclue** : aucun résultat. Elle ne compte rien, et deux lignes exclues ne sont pas comparées : ce que le plan agrandi dessine d'elle ne serait pas entier. La règle la lit dès qu'elle est incluse.
- **Non dessiné** : ce qui reste de la ligne dans les périmètres.
  - Entre deux copies d'un même axe, un vide plus court que le minimum est tenu pour dessiné (les tirets d'un réseau en pointillés, 5 cm d'écart).
  - À côté d'une copie, un reste d'au plus D n'en est pas un (deux plans recalés à 1 ou 2 cm près).
  - Le reste compte par tronçon continu d'au moins le minimum du plan d'ensemble (30 cm, ou une bande du dessin : 49 cm au 1/200), comme pour un doublon : les tirets d'un tracé en pointillés du plan d'ensemble s'additionnent.
  - Une ligne dont moins que ce minimum entre dans un périmètre n'a aucun résultat.
- **Résultats** :
  - `ZONE_COVERAGE_COMPLETE` : tout ce que la ligne dessine dans les périmètres y est dessiné ;
  - `ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN` : il reste une longueur non dessinée. La raison nomme le ou les plans agrandis et la longueur ; `details.uncovered_m` porte ce qui reste à régler ;
  - `ZONE_COVERAGE_RESOLVED` : la réduction de la ligne a retiré cette longueur.
- **Règlement** (rien ne se règle tout seul) :
  - **réduction** de la ligne du plan d'ensemble, quand le tronçon n'existe pas. Une réduction ne dit jamais où elle retire : elle paie d'abord ce que les doublons de la ligne lui demandent, puis la couverture, à 1 cm près (2 cm quand la réduction d'une autre ligne a réglé une part du doublon, comme pour la paire). Une ligne de 15 m dont 6 m sont en double et 4 m non dessinés est réglée à 5 m ; à 9 m son doublon est réglé et la couverture échoue encore. Ce que les doublons demandent à la ligne :
    - ligne qui cède : ce que les plans agrandis dessinent d'elle, moins ce que son unique partenaire sans autre copie a déjà retiré ;
    - sa copie sur un plan d'ensemble qui lui cède : rien, sauf quand elles sont deux lignes seules (la paire se règle alors par l'une ou l'autre réduction : la ligne doit ce que le plan d'ensemble n'a pas retiré, et ce qu'elle a retiré pour la paire ne paie pas la couverture) ;
    - paire isolée de même rang : la longueur commune moins ce que l'autre ligne a retiré (une paire Z1/Z2 déjà réglée par Z2 ne demande rien à Z1) ;
    - groupe de trois lignes ou plus, qu'aucune réduction ne règle : tout ce que le groupe dessine de la ligne ;
    - « ce que l'autre ligne a retiré » est sa réduction au-delà de son propre tronçon non dessiné, qu'elle paie d'abord : deux lignes d'une paire ne comptent jamais chacune toute la réduction de l'autre. Une paire de 6 m dont chaque ligne a 4 m non dessinés demande 14 m retirés en tout ; à 10 m, les deux lignes échouent encore pour 4 m.
  - `details.owed_m` : ce que les doublons demandent encore à la réduction de la ligne (absent quand rien) ;
  - **« Accepter » (V)**, quand le tronçon existe et manque au plan agrandi : le plan d'ensemble est alors la seule source de ce tronçon ;
  - **exclusion** : une ligne exclue ne bloque jamais.
  - C'est un avertissement de quantité (TI-681) : il ne bloque pas l'application, et V ne demande pas de motif.
- **Ce qu'un V accepte** : les plans agrandis nommés et la longueur non dessinée, au millimètre (`details.quantity_context_key`, lue par `takeoff_rule_failure_keys`). Un autre plan agrandi ou une autre longueur non dessinée (plus longue ou plus courte) est un nouvel échec, qui retire la vérification ; les doublons de la ligne n'entrent pas dans cette identité.
- **Deux échecs sur une ligne** : `zone_overlap` et `zone_coverage` sont deux règles, donc deux résultats. Une ligne du plan d'ensemble peut porter un doublon et un tronçon non dessiné ; la revue ciblée demande de régler le doublon d'abord.
- **Revue ciblée** : la section « Couverture des plans agrandis » donne la longueur non dessinée encore comptée et propose « Retirer X m » quand aucun doublon ouvert ne demande encore de réduction à la ligne (`owed_m`) ; sinon elle renvoie au doublon. Un doublon ouvert qui se retire d'une autre ligne (la copie d'un plan d'ensemble qui cède) n'empêche pas la réduction. Quand rien ne resterait de la ligne, elle dit de l'exclure. V reste celui de la ligne : sur une ligne qui porte aussi un doublon, il accepte les deux échecs.
- **Limites connues** :
  - le périmètre est le rectangle de tous les traits lus du réseau : une zone en L couvre une partie du voisin, et un trait isolé (un échantillon de légende que la lecture aurait retenu) l'étend jusqu'à lui ; les tronçons du plan d'ensemble qui s'y trouvent sont signalés à tort (à accepter par V) ;
  - un plan agrandi qui ne dessine qu'un tronçon d'un réseau a un périmètre réduit à ce tronçon : une copie du plan d'ensemble dessinée à plus de 5 cm de lui n'est signalée ni comme doublon ni ici ;
  - une interruption du tracé du plan agrandi d'au moins le minimum (un appareil dessiné à l'échelle, 45 cm au 1/100) laisse cette longueur non dessinée : la ligne s'accepte par V ;
  - un plan agrandi dont la lecture n'a retenu aucune ligne d'un réseau n'a pas de périmètre pour lui : ce qu'il a entièrement manqué n'est pas signalé ;
  - une ligne dont le réseau n'est pas lu n'est pas contrôlée ;
  - la réduction n'est pas localisée : une ligne réduite pour une autre raison règle aussi sa couverture. La réduction d'une ligne partenaire paie d'abord son propre tronçon non dessiné, même accepté par V : la ligne doit alors plus qu'il ne faut à leur paire (elle s'accepte par V). Exclure la copie du plan agrandi libère la réduction que la ligne avait faite pour ce doublon : elle règle alors la couverture sans autre geste ;
  - l'indice des plans n'est pas lu ; l'échelle sert telle qu'elle est lue ;
  - la règle n'a pas été mesurée sur un plan réel : ses seuils sont ceux du doublon.
- **Base de données** : `takeoff_item_rule_blocked` tient ce code pour un avertissement de quantité depuis la migration `20261111233221_takeoff_zone_coverage_warning.sql`. Sans elle, le code est inconnu de la garde de la base, qui bloque l'application de la ligne tant qu'elle n'est pas vérifiée ou exclue, alors que l'application la tient pour un avertissement : la migration s'applique avant le déploiement du code.

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
  - Depuis la revue complète, l’administrateur peut ouvrir l’aperçu d’impact malgré les lignes à justifier.
    Dans le panneau de forçage, toutes les lignes bloquées sont cochées pour la saisie groupée. Le motif et la
    justification de chacune sont vides. « Appliquer à la sélection » recopie le motif et le texte saisis
    sur les lignes cochées. Après un aperçu à jour et une justification valable pour chaque ligne bloquée,
    le clic sur « Forcer l’application » envoie directement les lignes au chiffrage. Pour un ingénieur,
    ces mêmes blocages empêchent l’ouverture de l’écran d’envoi depuis la revue complète.
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
  - Le marqueur ne porte aucun choix. La réserve écrite dans l'offre (TI-682, lot C) est une colonne de la ligne,
    `estimate_items.offer_choice`, déclarée par un administrateur sur une ligne « Non chiffrée » (voir
    [cycle de vie](cycle-de-vie.md#émission-et-pdf-contractuel)) ; une ligne marquée reste une provision interne.
    Une ligne chiffrée dont le marqueur est une hypothèse peut, elle, être déclarée en quantité provisionnelle (même
    colonne, kind `provisional_quantity`) : la phrase des précisions le dit au client, la ligne et son montant ne
    changent pas. Le choix s'efface si le marqueur disparaît (`takeoff_mark_provisions` le retire quand une remesure
    n'apporte plus d'hypothèse) ; « Établie sur » part de la note saisie sur la ligne de métré (`quantity_entry_note`).
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

**Activation**. Le worker écrit par défaut les entrées de règles et les ancres
de recalage des pages vectorielles. La lecture vectorielle du niveau détaillé
est aussi activée par défaut. Pour `MERGEONE_TAKEOFF_RULES` et
`MERGEONE_TAKEOFF_VECTORS`, une variable absente ou à `1` active la
fonctionnalité, `0` la désactive et toute autre valeur provoque une erreur
identifiable. L’activation du module et celle des demandes facultatives de
classification des groupes gardent leurs réglages indépendants.

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
  (garde TS et revue) et `takeoff_low_confidence_threshold` (trigger). Espaces
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
(sens sûr ; l'écran d'envoi et le serveur la laissent de côté).

- **Écran** : `/dashboard/affaires/<affaire>/takeoff/<job>/review/targeted?versionId=…`,
  en mise en page outil (TI-658). À gauche les lignes, leurs filtres et l'application ;
  au centre le plan et sa lecture vectorielle, la ligne en évidence ; à droite ses raisons
  et ses décisions. La revue complète y renvoie (« Revue ciblée · N lignes »), comme le
  panneau des lignes bloquées de l'écran « Envoyer au tableau de chiffrage ».
- **Filtres** (TI-701, D13), lus sur les lignes de la revue ciblée
  ([`targeted-review-filters.ts`](../../src/lib/takeoff/targeted-review-filters.ts)) :
  - **vue**, un seul choix : « À revoir » (toutes), « Blocages » (les lignes que le garde
    d'application arrête, `reviewBlockReasons`), « Règle en échec », « Incertaines » ;
  - **Gros montants** : les lignes qui font ensemble 80 % du montant chiffré du métré, de la
    plus grosse à la plus petite (Pareto), sans seuil en euros. Le montant d'une ligne est
    sa quantité × le prix unitaire de la ligne de devis qui la porte, en centimes entiers
    (`quantityAmountCents`, arrondi à l'unité la plus proche, moitié vers l'extérieur).
    Des lignes de même montant entrent ensemble à la coupure : la liste ne dépend jamais
    de l'ordre de lecture. Une ligne non chiffrée, ou chiffrée à zéro, n'en fait jamais
    partie et ne compte pas dans le total. Ce montant classe les lignes ; ce n'est pas un
    total HT du devis : le prix unitaire est pris avant la remise commerciale au moteur 3,
    après elle au moteur 2, et plusieurs lignes du métré partagent une ligne de devis dont
    la quantité arrondit leur somme. Le filtre actif dit donc seulement la part couverte et
    ce qu'il en reste à revoir, sans montant en euros (« 2 lignes du métré, 95 % du montant
    estimé (quantité × prix unitaire), dont 2 à revoir ») ;
  - **Hypothèses** : les lignes dont la quantité est une hypothèse de TI-682
    (`takeoffHypothesisCause`), pas une confiance. Le filtre de confiance de la revue de
    validation garde son nom, « Confiance à confirmer » ;
  - **Non chiffré** : une ligne retenue qu'aucune ligne de devis ne porte (« sans
    rattachement chiffré » du contexte de revue) ou que porte seulement une ligne
    « Non chiffrée ». Une ligne « Inclus » ou « Pour mémoire » n'a pas de prix par choix :
    elle n'est ni non chiffrée ni un gros montant. Une ligne exclue n'est ni l'une ni l'autre.
    Portée par plusieurs lignes de devis, une ligne du métré prend la meilleure, quel que soit
    leur ordre : un prix unitaire non nul, sinon un prix écarté exprès, sinon un prix nul,
    sinon « Non chiffrée » ; un prix négatif (remise) compte comme un prix nul. Le moteur 2
    ne donne pas de prix unitaire à une ligne sans quantité ;
  - **Réseau ou lot**, **Niveau ou zone**, **Plan et indice** : des valeurs que les lignes
    portent, jamais un texte libre. Le réseau vient des entrées des règles, sinon le lot
    (section racine) de la ligne de devis qui porte la ligne ; le niveau et la zone de la
    page viennent du tri des pages, sinon de la localisation de la ligne
    (`takeoffItemLocation`) ; le plan est le fichier source, avec l'indice que lui donne la
    préparation quand il est connu. Une ligne porte au plus une valeur de chaque sorte :
    plusieurs valeurs d'une sorte élargissent la liste (OU), les sortes la restreignent (ET).

  Chaque choix affiche son compte, lu avec les filtres des autres sortes. Un filtre dont le
  métré n'a pas la donnée n'est pas proposé : « Gros montants » sans ligne chiffrée,
  « Non chiffré » sans contexte de revue lisible (version scellée, lecture en échec), une
  sorte qu'aucune ligne ne porte. Choisi avant (repris d'une adresse, ou quand la dernière
  ligne qui portait la sorte a été tranchée), il est ignoré et l'écran le dit. Les filtres
  qui lisent les montants ou les lots attendent le contexte de revue. Une
  valeur d'une sorte que les lignes portent reste un choix quand ses propres lignes sont
  parties (tranchées) : la liste dit alors qu'aucune ligne ne répond aux filtres.
  Les filtres et la ligne en évidence vivent dans l'adresse (`view`, `large`, `hypotheses`,
  `unpriced`, `network`, `location`, `plan`, `line`) : un rechargement ou un lien partagé
  montre les mêmes lignes. L'adresse est réécrite sur place, sous l'état d'historique du
  routeur (aucune navigation), la ligne en évidence une fois le focus posé. « Effacer les filtres » les retire tous. La ligne en cours de
  modification (quantité tapée, dialogue ouvert, décision en cours d'enregistrement) n'est
  jamais masquée : un filtre qui l'écarte la laisse à sa place, marquée « Hors filtres »,
  avec un avis ; une ligne ouverte exprès (son lien, un partenaire, un poste à contrôler)
  reste de même affichée tant qu'elle est en évidence. Ouvrir un partenaire ou un poste met
  fin à une saisie de quantité non enregistrée, comme un clic sur une autre ligne.
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
- **Couverture des plans agrandis** : la section donne la longueur encore comptée que le
  plan agrandi ne dessine pas. « Retirer 4,00 m » ramène la ligne à sa quantité moins cette
  longueur ; tant qu'un doublon ouvert demande encore une réduction à la ligne, elle n'est
  pas proposée et la section demande de régler d'abord le doublon. Quand rien ne resterait
  de la ligne, la section dit de l'exclure. V accepte la ligne quand le tronçon existe et
  manque au plan agrandi.
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
- **Écran d'envoi** : le garde y laisse de côté les lignes que l'aperçu à jour
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
