# Préparation enregistrée du métré

La préparation définit les entrées d'une analyse avant son lancement. Elle est
enregistrée par affaire et contrôlée côté serveur. Un brouillon peut être
incomplet ; une proposition de l'IA ne vaut jamais confirmation métier.

Le contrat partagé et ses règles sont dans
[`preparation.ts`](../../src/lib/takeoff/preparation.ts). Les actions de lecture,
d'enregistrement et de confirmation passent par
[`preparation-server.ts`](../../src/lib/takeoff/preparation-server.ts), avec les
droits du tenant actif et de l'affaire.

## Parcours pris en charge

Le lancement propose quatre étapes dans
[`TakeoffPreparationPanel`](../../src/components/takeoff/TakeoffPreparationPanel.tsx) :

1. **Mes documents** : sélectionner les pièces actives, leur révision et les pages
   retenues. Les pièces non actives restent dans le dossier.
2. **Ce que je veux mesurer** : choisir l'objectif et préciser les lots, réseaux,
   niveaux, zones, inclusions et exclusions. Confirmer ce périmètre.
3. **Points à préciser** : renseigner l'unité et les conventions nécessaires,
   répondre aux inconnues ou enregistrer une réserve admissible et attribuée.
4. **Vérifier et lancer** : relire le résultat attendu, les sources, le périmètre,
   les conventions, les réserves et la destination, puis confirmer.

Les réponses sont enregistrées au fil de la saisie et restent modifiables. Une
modification du brouillon invalide sa confirmation de lancement. Une autre
fenêtre ayant enregistré une nouvelle révision provoque un conflit explicite :
elle ne doit pas être écrasée silencieusement.

À la réouverture, le parcours retrouve les réponses et affiche la première étape
comportant un point à préciser. Les sources peuvent être ouvertes dans un aperçu
ou un onglet sur leur fichier exact et, pour un PDF, sur la page concernée. Le
serveur vérifie les droits avant de fournir un lien temporaire ; un fichier en
cours de téléversement utilise son aperçu local.

Le lancement réutilise la préparation confirmée. Il conserve les contrôles de la
version de devis, du jeu de plans ou du fichier téléversé. L'analyse et la revue
des quantités restent distinctes de leur application au devis, qui conserve son
aperçu d'impact et sa confirmation.

## Contenu de la fiche

| Partie | Données conservées |
| --- | --- |
| Objectif | Comptage, longueur, surface, lecture de quantités documentaires, comparaison DPGF, préparation d'achat ou estimation avec hypothèses ; confirmation explicite |
| Périmètre | Lots, réseaux, niveaux, zones, inclusions, exclusions ; confirmation explicite |
| Sources | Identifiant de document, nom, rôle, révision connue ou inconnue, identité du fichier, pages, sélection active et confirmation |
| Conventions | Unité, base documentaire/cotes/calibration, calibration de page et conventions d'achat si nécessaires ; confirmation explicite |
| Inconnues | Question, effet bloquant ou réserve, source/page éventuelle, réponse, responsable et décision |
| Destination | Analyse seule ou revue en vue du devis, version concernée, responsable de revue éventuel et confirmation |
| Profil | Identifiant, nom et version du profil réutilisé, lorsqu'il existe |
| Assistance acceptée | Contexte tenant/affaire/révision, empreintes, fournisseur/modèle, version de consigne, consommation connue et identifiants des propositions acceptées |

Un champ inconnu reste `null`. Il ne devient pas zéro. Les listes vides restent
vides ; le périmètre doit contenir au moins une inclusion, un lot, un réseau, un
niveau ou une zone explicitement renseignés. Pour demander l'ensemble du dossier,
l'utilisateur doit l'indiquer dans son périmètre.

## Conditions selon l'objectif

Les mêmes règles s'appliquent au récapitulatif et à la confirmation serveur par
`evaluateTakeoffPreparation`.

| Objectif | Conditions particulières |
| --- | --- |
| Comptage | Au moins un plan actif et confirmé, une unité de comptage ; aucun DPGF ni calibration imposés |
| Longueur | Plan actif, unité de longueur, cotes fiables ou calibration complète de la page retenue |
| Surface | Plan actif, unité de surface, cotes fiables ou calibration complète de la page retenue |
| Quantités documentaires | Source active et unité explicite ; aucune échelle géométrique imposée |
| Comparaison DPGF | Plan et DPGF actifs ; l'absence de bordereau reste bloquante |
| Préparation d'achat | Déductions, pourcentage de pertes, arrondi et conditionnement explicités ; le relevé brut reste distinct de la conversion en achat |
| Estimation | Périmètre, source, unité et conventions confirmés ; les hypothèses restent identifiables dans la préparation |

La présence d'un objectif dans le contrat ne fournit pas à elle seule ses pièces
de référence : la préparation ne peut pas déclarer un plan comme DPGF pour lever
un blocage. Le serveur vérifie le rôle et l'identité des sources disponibles.

Une calibration relie une page à une longueur de référence positive, son unité et
une portée mesurée positive, avec son unité explicite `measured_span_unit` :
`pdf_points` pour une distance en points PDF (1/72 de pouce), ou `paper_mm` pour
des millimètres sur la page PDF d'origine à l'échelle physique de 100 %. Des pixels
d'écran dépendant d'un zoom ou d'un aperçu redimensionné ne constituent pas cette
référence.

Une calibration partiellement renseignée peut être enregistrée dans le brouillon,
mais bloque le lancement géométrique. L'unité manquante reste `null` dans les
anciens brouillons ; elle bloque une mesure calibrée sans bloquer un comptage
indépendant. La calibration concerne la page d'origine identifiée, dont la copie
dans le PDF d'analyse conserve la géométrie. Sa portée ne s'étend pas
automatiquement aux autres pages ni aux autres plans : retenir sa page ou
utiliser des cotes fiables pour l'ensemble du périmètre.

Pour les achats, `waste_percent: null` est inconnu et bloque. La valeur `0` est
une absence de perte explicitement renseignée. L'application n'invente pas les
conventions de déduction, d'arrondi ou de conditionnement.

## Inconnues et états

- **À compléter** (`incomplete`) : au moins un prérequis manque ou une décision
  n'est pas confirmée. La liste des blocages indique les points à corriger.
- **Prêt avec réserves** (`ready_with_reservations`) : tous les prérequis sont
  satisfaits et des réserves admissibles ont une réponse et un responsable.
- **Prêt à analyser** (`ready`) : tous les prérequis sont satisfaits pour les
  entrées sélectionnées. Ce statut ne valide pas les futures quantités.

Une inconnue ouverte bloque. Une réponse confirmée ou une exclusion exige une
réponse enregistrée et un responsable. Une inconnue bloquante ne peut pas être
contournée en acceptant une réserve : fournir sa réponse ou acter l'exclusion de
la partie concernée du périmètre.

Une révision inconnue exige soit son renseignement, soit une réserve identifiée
par `source_revision:<document_id>`, acceptée, motivée et attribuée. Lorsqu'une
révision devient connue ou que sa source est désactivée, cette question de
révision ne bloque plus et son historique reste conservé. Deux versions actives
du même document logique ne sont pas cumulées.

## Sources et instantané de lancement

Les références comprennent `document_id`, `plan_set_id`, `file_path`,
`source_version`, `source_updated_at`, `page_count`, la révision, les pages et
`content_hash`. Une liste de pages vide signifie toutes les pages ; une liste
explicite ne peut pas contenir de doublons ni dépasser le document connu.

Le serveur reconstitue les identités autorisées depuis l'affaire, puis compare
les références reçues. Une source modifiée ou disparue demande une nouvelle
confirmation. Les changements ne remplacent pas silencieusement la version
confirmée.

Le champ de référence logique du plan permet de désigner explicitement les
fichiers représentant différentes révisions du même plan, même lorsque leurs
noms diffèrent. La version applicable doit alors être retenue au lieu de cumuler
ces fichiers.

L'instantané contient la préparation complète, sa révision enregistrée, l'auteur,
la date et l'état de préparation calculé. Les références et les valeurs copiées
ne sont plus liées en mémoire au brouillon. Le serveur confirme également le
SHA-256 des octets des plans, y compris pour les anciens imports sans empreinte
fiable. Le traitement doit vérifier ce contenu avant de l'utiliser.

Les sources, pages et conventions sont des contraintes d'entrée. Les lots,
réseaux, niveaux et exclusions exprimés en texte guident l'analyse ; ils ne
constituent pas à eux seuls une preuve automatique que chaque quantité extraite
respecte ce périmètre. La revue des résultats reste nécessaire.

## Profils réutilisables

L'étape de périmètre permet d'enregistrer un cadrage comme profil nommé et de
reprendre les profils du tenant. `createTakeoffPreparationProfile` produit leur
contenu versionné ; `applyTakeoffPreparationProfile` le réutilise comme
proposition. Le profil reprend l'objectif, les lots/réseaux, les
inclusions/exclusions et les conventions.

Il ne reprend ni les documents de l'affaire, ni ses niveaux/zones, ni une
calibration, ni ses inconnues et décisions, ni la destination. L'application d'un
profil rouvre la confirmation de l'objectif, du périmètre et des conventions. Les
profils sont enregistrés côté serveur sous les droits du tenant ; aucun profil
métier n'est présumé validé par défaut.

## Assistance IA

L'assistance produit des propositions structurées et des questions reliées aux
sources disponibles. Accepter une proposition complète le brouillon ; les champs
confirmés ne sont pas remplacés automatiquement. L'assistance ne fournit ni
quantité mesurée, ni échelle ou règle d'achat inventées.

Le contexte disponible est celui de l'affaire, des références et du brief fournis
au service. Une suggestion tirée d'un nom de fichier reste une suggestion : elle
ne prouve pas la présence d'un ouvrage sur une page.

Le service relit le résumé, le périmètre et les lots du brief de l'affaire pour
éviter leur ressaisie. Leur reprise fournit des propositions et ne remplace pas
les décisions déjà confirmées dans la préparation. Les questions peuvent être
ordonnées par Decisions sur une réponse explicite ; aucun point obligatoire ne
disparaît parce qu'il est moins prioritaire.

L'acceptation conserve une trace bornée dans le brouillon, puis dans son
instantané : fournisseur, modèle, version de consigne, date, tenant, affaire,
révision, empreintes de contexte, consommation connue et identifiants des
propositions acceptées. Cette trace ne contient ni identifiant de connexion, ni
jeton d'accès, ni copie du contenu des pièces. Elle n'accorde aucun droit et ne
confirme aucun champ métier. Les propositions non acceptées restent une aide à
la saisie.

L'ordre proposé des questions et la prochaine action utile ne modifient pas les
règles de lancement. La connexion rédactionnelle et Decisions ont des capacités
et une consommation distinctes. Une indisponibilité conserve la préparation et
le parcours manuel. La configuration et les limites de la connexion locale sont
décrites dans [ChatGPT local](../testing/chatgpt-local.md).
La configuration distincte de Decisions est décrite dans
[Decisions](../testing/decisions.md).

## Base de données et validation

La migration
[`20261029002420_takeoff_preparations.sql`](../../supabase/migrations/20261029002420_takeoff_preparations.sql)
est requise avant d'utiliser le nouveau parcours dans un environnement. Elle
stocke les brouillons et confirmations par tenant et affaire et relie les
nouveaux traitements à leur instantané confirmé. Une base non mise à jour renvoie
une indisponibilité explicite. Les anciens traitements restent des historiques.

La migration partagée et le déploiement sont deux actions séparées, soumises à
autorisation explicite. Un commit ou un push ne les exécute pas.

Un lancement depuis une version existante crée une copie ordinaire du devis,
sans la transformer en variante. Un reçu enregistré par le serveur relie cette
copie à sa source, à l'affaire et à la révision confirmée de la préparation.
La reprise retrouve l'analyse existante ou la copie déjà munie de son reçu et
conserve ses décisions. Un échec de création de l'analyse ou de sa mise en
traitement conserve tous les brouillons et analyses, afin de protéger toute
édition concurrente. Une interruption avant l'enregistrement du reçu ou des
lancements simultanés peuvent laisser un brouillon supplémentaire sans analyse.
Ce brouillon reste disponible pour examen ; il n'est pas supprimé automatiquement.

Les règles métier sont couvertes par
[`preparation.test.ts`](../../src/lib/takeoff/preparation.test.ts) : comptage sans
DPGF, calibration, unité, achat avec perte inconnue ou nulle, révision inconnue,
conflit de révision, réserves, destination, copie de l'instantané et réemploi des
profils. La validation de livraison doit compléter ces tests par les parcours
du navigateur et les contrôles SQL/RLS sur une base locale possédée ; aucun appel
IA simulé ne prouve un appel réel au forfait ou à Decisions.
