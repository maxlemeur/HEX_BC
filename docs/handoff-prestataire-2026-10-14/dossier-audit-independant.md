# Dossier de passation pour un audit indépendant du logiciel de chiffrage

MergeOne / Miaouffrage — Chiffrage BTP avec une profondeur initiale CVC et plomberie

Émetteur : équipe produit du projet. Destinataire : prestataire chargé de l’audit. Date : 14 octobre 2026. Version : 1.

Nous sollicitons un avis indépendant sur notre logiciel de chiffrage, sur la cohérence de ses règles de gestion et sur sa capacité à soutenir le travail réel d’un chiffreur. Nous souhaitons savoir ce qui fonctionne, ce qui est fragile ou incomplet, quelles décisions métier manquent et quel chemin raisonnable permettrait de livrer une application utilisable.

Le dossier donne accès à notre vision, à nos documents, à une copie datée des sources et à nos observations antérieures. Il ne constitue pas un audit final ni une certification. Le développement se poursuit dans un autre espace de travail ; les résultats cités restent attachés à leur date et à leur version. Aucun parcours de l’application n’a été rejoué pour produire cette passation.

## 1 Mandat et indépendance de l’auditeur

L’auditeur dispose de la liberté nécessaire pour choisir sa méthode, ses entretiens, ses scénarios, ses outils, son échantillonnage et l’ordre de ses investigations. Il peut élargir son analyse lorsqu’un sujet pertinent apparaît et signaler les limites liées aux accès, au temps ou aux données disponibles.

Il peut contester nos documents, nos critères, nos hypothèses, notre backlog, nos choix techniques et nos précédentes conclusions. Il peut conclure qu’un problème annoncé est corrigé, mal formulé ou non confirmé, qu’un contrôle annoncé ne suffit pas, ou qu’un risque que nous n’avons pas identifié est plus important. Il n’est pas chargé de confirmer notre analyse ni de justifier les travaux déjà réalisés.

Nos priorités historiques et les scénarios de nos tests sont des informations. Ils n’imposent ni sa grille d’audit, ni son classement des risques, ni sa solution. Les instructions AGENTS.md décrivent notre manière interne de travailler ; elles ne constituent pas la méthode obligatoire du prestataire. Les autorisations de modification ou d’accès à des environnements restent, en revanche, distinctes de la liberté d’analyse.

Pour réduire les effets d’ancrage, le dossier distingue la vision souhaitée, les matériaux métier, les sources techniques, les observations de l’équipe et les résultats des essais. L’auditeur choisit quand consulter nos diagnostics détaillés. Tous ces éléments lui restent accessibles. Il est invité à conserver explicitement les désaccords et les contradictions qu’il trouve.

La mission attendue est un diagnostic et une proposition argumentée de suite. Une réécriture, une migration, un déploiement ou une autre intervention opérationnelle relève d’un périmètre convenu séparément. Aucun résultat favorable ni aucune technologie particulière ne sont présupposés.

## 2 Ce que nous souhaitons pour le produit

Notre ambition est de couvrir le travail depuis le dossier reçu jusqu’au retour d’expérience chantier. Un chiffreur doit pouvoir comprendre ce qu’il a prévu, ce qui reste incertain, pourquoi le prix obtenu est celui affiché et ce que chaque changement affecte. Le logiciel doit conserver une vraie interface de travail : dossier, grille de chiffrage, sous-détails, comparaisons et décisions. Une conversation avec une IA ne doit pas devenir nécessaire pour une opération simple.

La profondeur métier initiale est le CVC et la plomberie. Les autres métiers peuvent bénéficier des fonctions génériques ; leur qualification complète n’est pas acquise. Nous ne cherchons pas à reconstruire un ERP ou une comptabilité. La pertinence de cette frontière et l’adéquation aux utilisateurs sont ouvertes à l’analyse.

| Étape de travail envisagée | Besoin exprimé par l’équipe | Ce que l’auditeur peut examiner |
| --- | --- | --- |
| Recevoir et comprendre le dossier | Identifier les pièces, leur révision applicable, les prescriptions et les informations manquantes. | Les documents reçus permettent-ils une compréhension exploitable et vérifiable du périmètre ? |
| Construire le chiffrage | Importer les quantités, travailler dans une grille, détailler fournitures et main-d’œuvre, expliquer les calculs. | Le modèle et l’ergonomie correspondent-ils aux pratiques métier et aux cas complexes ? |
| Choisir les ressources et les prix | Conserver l’origine des prix et comparer les offres sur un périmètre et des conditions compréhensibles. | Une économie affichée est-elle réelle, ou vient-elle d’une différence d’unité, de contenu ou de conditions ? |
| Réviser et décider | Comprendre les conséquences d’un nouveau document, d’une quantité, d’un prix ou d’une variante. | Les impacts et les incertitudes sont-ils visibles sans réécrire l’historique ? |
| Produire et émettre l’offre | Obtenir des documents cohérents avec la version validée et protéger les données internes. | Les totaux, les termes commerciaux, les approbations et la confidentialité restent-ils cohérents ? |
| Préparer et suivre le chantier | Distinguer vendu, prévu, engagé et consommé ; préparer les besoins et les achats. | La continuité est-elle réelle et la séparation avec les outils existants pertinente ? |
| Tirer parti du retour chantier | Relier les écarts aux hypothèses et proposer des améliorations validées par un responsable. | L’apprentissage est-il utile, contextualisé et maîtrisé ? |

Les automatismes et l’IA doivent proposer des résultats explicables et révisables. Une information non établie doit rester identifiable comme telle. Les engagements commerciaux et les adaptations générales des références métier restent soumis à une décision humaine. L’auditeur peut évaluer le coût, la faisabilité et l’utilité de cette ambition, et recommander une version initiale plus resserrée.

L’ancien goal mentionne des ambitions de réduction du temps humain et des fausses alertes. Ces nombres sont des objectifs proposés par l’équipe, non des résultats mesurés ni une méthode imposée à l’auditeur. Le corpus, la mesure et même la pertinence de ces indicateurs doivent être discutés.

## 3 Origine et fiabilité des règles de gestion

Les règles ne sont pas actuellement rassemblées dans un référentiel unique validé par un responsable métier. Elles sont réparties entre des décisions du porteur de projet, des documents produits à partir du code, des exemples de chiffrage, le moteur de calcul et les contraintes de la base. C’est un sujet central de l’audit.

| Nature de source | Usage possible | Réserve à conserver |
| --- | --- | --- |
| Vision initiale et arbitrages du porteur | Comprendre le besoin et les décisions prises. | Un besoin exprimé ne prouve ni l’implémentation ni sa pertinence dans tous les cas. |
| Documents métier et par domaine | Identifier le vocabulaire, les formules et les parcours décrits. | Certaines sections sont des photographies de juillet ou août 2026 et peuvent être périmées. |
| Bible hydraulique et exemples OPTIMA, DPGF et achats | Examiner les pratiques et les documents utilisés comme références. | Les fichiers sont fournis tels quels ; toutes leurs formules et conventions n’ont pas été analysées ou approuvées. |
| Code, API et migrations | Comprendre le comportement programmé et ses protections. | Un comportement existant peut être un défaut ; le code ne définit pas à lui seul la bonne règle métier. |
| Scénarios et rapports de tests | Examiner ce qui a effectivement été vérifié. | Un résultat porte sur des sources et un environnement précis. Un test peut aussi figer une hypothèse erronée. |

Deux décisions explicites du porteur sont documentées : une offre fournisseur expire au plus tard six mois calendaires après le début de sa validité ; une offre à 0 € est exclue du calcul du prix de référence et appelle une clarification. Elles constituent la politique demandée à ce jour. L’auditeur peut en analyser les effets, les exceptions nécessaires et la cohérence avec les pratiques ; une modification de politique sera soumise au responsable métier.

Nous attendons notamment qu’il identifie les règles qui sont des obligations, des choix commerciaux d’entreprise, des paramètres, des conventions historiques ou de simples hypothèses. Les rendements de pose, provisions, pertes, coefficients, taux horaires et exceptions techniques doivent être rattachés à une source et à un responsable de validation. Aucune valeur absente ne doit être présentée comme une norme universelle du BTP.

Les documents internes qui disent que « le code fait foi » décrivent la photographie de l’existant. Cette formulation ne limite pas le droit de l’auditeur à remettre en cause son comportement. Nous souhaitons précisément qu’il vérifie l’accord entre besoin, règle décrite, code, données et résultat observable.

## 4 Problèmes et préoccupations portés à connaissance

Les éléments ci-dessous viennent des documents et des preuves datées de l’équipe. Ils sont communiqués pour leur utilité, sans préjuger de leur classement par l’auditeur. Aucun statut ne signifie que le même résultat a été reproduit aujourd’hui sur l’environnement du prestataire. L’évolution en cours doit être prise en compte avant de qualifier un défaut comme encore actif.

### Remise saisie en euros et remise historique en pourcentage

Une recette locale EU01 du 14 octobre 2026, sur 1 004 lignes et le build sIZ7nOQ8chXqN9XTjCCTz, a observé une remise saisie à 1,01 € puis une réduction réelle de 2,00 € après sauvegarde. L’équipe relève une conversion du montant saisi en taux arrondi. Le total HT obtenu était 19 952,50 €, contre 19 953,49 € attendu dans ce scénario. Référence : contrat de remise avant produit et rapport EU01, joints au dossier.

Une autre recette EUHIST a observé un changement de remise historique lors d’une modification de marge sans nouvelle saisie de remise : 3,80 € HT au lieu de 3,60 € HT attendu. EU02 a constaté l’absence de stockage explicite du montant fixe ; ses étapes ultérieures de plafonnement et de remontée d’assiette n’ont pas été atteintes. Il ne faut donc pas les considérer comme vérifiées. Ces constats invitent à examiner la sémantique des remises, leur persistance, les copies et les conséquences sur les décisions commerciales ; la solution de l’équipe demeure une proposition auditable.

### Documents dispersés et contradictions possibles

La documentation métier, les audits historiques, le backlog et les documents de recette n’ont pas tous la même date ni le même périmètre. Certaines descriptions historiques ont déjà été corrigées. Un audit ancien ne suffit pas à déclarer une fonctionnalité absente ou un défaut actif. La validité des formules, des arrondis, du vocabulaire marge et marque, des unités et des états de devis mérite une vérification indépendante.

### Continuité entre les pièces du dossier et le chiffrage

L’audit produit du 11 octobre a identifié comme enjeu la relation entre exigence, prestation, zone ou réseau, ressource, ligne et décision. Des tranches locales de revue CCTP et de provenance ont ensuite été développées et testées. Le parcours complet sur plusieurs familles CVC et plomberie et sur des révisions documentaires reste à qualifier. L’auditeur doit pouvoir déterminer si notre modèle de couverture est adapté, trop complexe ou incomplet.

### Prix fournisseurs et comparaison des conditions

Des contrôles de validité et de provenance existent. Les documents de suivi signalent que la comparaison à périmètre égal, les unités, conditionnements, minimums, transport, accessoires et prestations incluses n’ont pas une qualification complète de bout en bout. Une comparaison de montants seule peut être trompeuse. Le besoin et le niveau de détail à retenir sont à examiner avec les utilisateurs.

### Fiabilité de la saisie et des engagements

La sauvegarde, les totaux, les copies, les conflits entre pages et les reprises après erreur ont fait l’objet de corrections et de campagnes locales. Des modes historiques, des courses et des contrats de tests restent non qualifiés par ces campagnes. L’accord entre l’éditeur, l’export, le PDF, la révision approuvée et l’offre effectivement émise doit être apprécié sur un périmètre explicite. Les envois testés via un collecteur local ne prouvent pas une livraison réelle au client.

### Chantier et retour d’expérience

La préparation d’achats a des preuves locales sur certains parcours. La chaîne complète budget, consultation, achats partiels, réception, consommation, heures réelles, analyse des écarts et apprentissage validé n’est pas déclarée terminée. L’auditeur peut recommander les frontières fonctionnelles, les interfaces avec les outils existants et l’ordre de réalisation qui lui semblent les plus utiles.

### Exploitation et sécurité

Les droits par rôle et par entreprise, le stockage de pièces, les liens de portail et les clients privilégiés sont des frontières à examiner. Un registre de remédiation sécurité est fourni comme historique. Ses constats et dispositions ne sont pas une preuve automatique de vulnérabilité actuelle ni de fermeture complète. La sauvegarde, la restauration, les reprises, les migrations et la mise en service doivent être qualifiées sur l’environnement effectivement retenu.

## 5 Ce que les preuves locales établissent et leurs limites

La campagne de paramétrage du 14 octobre documente sept parcours métier et sept connexions réussis sur un build local, 70 cas SQL séquentiels sur une base locale et 15 courses avec de véritables clients SQL. Les nombres correspondent à des essais différents ; ils ne doivent pas être additionnés en un taux de couverture global.

Ces essais portent notamment sur la cohérence transactionnelle des réglages et des totaux, la conservation d’intentions locales après une confirmation perdue et un cas d’autoliquidation. Ils constituent des indices utiles d’amélioration. Ils ne qualifient pas à eux seuls tous les calculs historiques, les rôles, les documents commerciaux, la production ou la continuité chantier.

Une rétrospective ultérieure documente des améliorations du dossier de preuves : conservation des sources du build, contrôle préalable de santé et enregistrement du code de sortie du runner. Deux parcours métier ont été rejoués sur le nouveau build. Cela renforce la traçabilité des nouvelles campagnes, sans étendre rétroactivement la portée des anciennes preuves.

Les autres réussites citées dans les documents restent locales et datées. La passation ne confirme pas une CI globale verte, une recette métier sur un corpus professionnel validé, un gain de productivité mesuré ou une exploitation distante qualifiée. Un scénario seulement préparé, collecté ou interrompu demeure une preuve manquante. Le prestataire est libre d’évaluer la qualité des tests, de créer ses propres cas et de proposer d’autres outils.

Les rapports EU01, EU02 et EUHIST inclus sont des rapports d’échec historiques, joints avec leur contrat et leurs scénarios. Les archives intégrales de toutes les anciennes campagnes ne sont pas jointes : leurs volumes et certains éléments privés nécessitent une extraction ciblée. L’index des preuves indique les références disponibles et les limites de ce qui est effectivement transmis.

## 6 Documents et sources transmis

Le fichier inventaire-documents.csv décrit les pièces du dossier, leur chemin d’origine, leur copie, leur taille, leur empreinte SHA-256 et leur catégorie. Le manifeste JSON fixe la date de collecte, le commit de base, les changements locaux et les éventuelles évolutions pendant la copie. Le commit seul ne représente pas ce travail en cours.

| Ensemble du dossier | Contenu | Lecture possible |
| --- | --- | --- |
| 01 Vision et besoins | Texte initial du porteur, présent dossier et cadrages produit. | Comprendre l’ambition et séparer les souhaits des résultats existants. |
| 02 Références métier | Glossaire, règles de calcul, cycle de vie et documentation par domaine. | Confronter les règles décrites entre elles et au travail réel. |
| 03 Matériaux métier | Bible hydraulique, exemples OPTIMA, DPGF, devis et documents d’achat. | Examiner les conventions et exemples sans les traiter comme un référentiel validé. |
| 04 Travaux et observations de l’équipe | Audits historiques, backlog, progression, contrats et rétrospectives. | Comprendre les décisions et leurs limites, avec liberté de les contester. |
| 05 Essais et preuves | Documentation de recette, index des preuves et rapports sélectionnés de remise. | Distinguer scénario préparé, résultat exécuté et périmètre réellement couvert. |
| 06 Sources techniques | Copie de src, migrations, fonctions Supabase, scripts, scénarios E2E et configurations sélectionnées. | Examiner les implémentations et préparer une reproduction sur une copie isolée. |

Les documents historiques sont conservés tels quels, y compris leurs réserves, contradictions et priorités d’origine. La version Word reprend le présent dossier. Le registre de questions CSV proposé est laissé vierge de conclusion et de priorité ; l’auditeur peut le modifier ou utiliser son propre format.

Les exemples métier conservent les noms et informations présents dans les fichiers d’origine. Ils n’ont pas été anonymisés et leurs droits de communication restent à confirmer avant transmission externe. Les fichiers Excel à macros et les documents Office sont copiés sans exécution de leur contenu actif. Leur transmission locale ne signifie pas que leurs calculs ont été examinés.

La copie technique est fournie pour lecture. Elle n’embarque pas .git, node_modules, les builds, les variables d’environnement privées, les bases, les profils de test, les jetons de portail ni les traces authentifiées. Les références historiques à ces éléments n’en donnent pas les accès. Les sources incluses permettent une inspection large, mais ne constituent pas à elles seules un environnement opérationnel installé.

## 7 Conditions pratiques pour mener l’audit

Nous proposons que le prestataire réalise ses essais dans un environnement isolé, sur une copie identifiée des sources. Le développement courant ne doit pas être interrompu par cette mission. L’auditeur reste libre de préférer une autre organisation, à convenir avec le porteur de projet.

Les accès à organiser séparément sont les suivants : démonstration de l’application sur une version identifiée, compte de test adapté, données représentatives, entretiens avec un chiffreur et le responsable métier, et, si nécessaire, accès en lecture aux preuves détaillées ou aux paramètres de l’environnement. Leur disponibilité n’est pas présumée par ce document.

Pour apprécier l’exploitation, il faudra préciser quel environnement est audité, quelles migrations y sont réellement installées, quelles sauvegardes existent et qui peut autoriser une restauration d’essai. Les fichiers de migrations inclus décrivent les changements disponibles dans le dépôt ; ils ne prouvent pas leur application à une base donnée.

Une intervention qui modifierait des données partagées, les droits, un environnement distant, un envoi client ou un engagement fournisseur nécessite une autorisation opérationnelle propre. Cette condition protège l’environnement de travail ; elle ne restreint pas les sujets que l’auditeur peut analyser ou les conclusions qu’il peut formuler.

Le périmètre final, le temps disponible et les éventuelles exclusions sont à convenir avec le prestataire. Ce dossier ne fixe pas artificiellement de délai, de budget, de couverture garantie ni d’acceptation contractuelle. Toute limite rencontrée doit rester visible dans sa restitution.

## 8 Restitution souhaitée et décisions ouvertes

Nous souhaitons une restitution compréhensible par le porteur de projet, avec une annexe suffisamment précise pour l’équipe technique. Le format appartient à l’auditeur. Les éléments ci-dessous expriment ce qui nous aiderait à décider, sans lui imposer une structure de rapport.

- Son appréciation globale de l’adéquation aux besoins et de la maturité du produit, accompagnée de son périmètre et de ses limites.
- Les constats qu’il retient, y compris les points satisfaisants et les problèmes nouveaux, avec la source, le comportement observé et l’impact lorsque ces éléments sont disponibles.
- Les écarts entre documents, pratiques, code et résultats ; les hypothèses qui méritent une décision métier ; les affirmations antérieures confirmées, infirmées ou non vérifiables.
- Sa propre hiérarchisation des risques et des améliorations, avec les raisons et les dépendances. Aucune priorité de notre backlog ne lui est imposée.
- Un chemin de réalisation et de recette qu’il estime raisonnable, avec des alternatives lorsqu’elles changent le coût, la complexité ou la valeur. Les estimations éventuelles doivent préciser leurs hypothèses.
- Les conditions qui lui paraissent nécessaires pour accepter une version initiale et envisager la mise en service, ainsi que les travaux ou preuves qui manquent.

L’auditeur peut utiliser des états tels que confirmé, infirmé, à vérifier ou non audité, ou sa propre terminologie. Une conclusion « non vérifiable avec les éléments reçus » est recevable. Nous demandons seulement de pouvoir distinguer les faits établis, les interprétations, les propositions et les incertitudes.

Plusieurs questions restent ouvertes : quels utilisateurs et quels dossiers représentent vraiment la première version utile ; quelles règles et exceptions sont propres à notre entreprise ; quelles unités et quels rendements sont validés ; quel corpus peut servir à une recette indépendante ; quelles frontières retenir avec les achats, le chantier et l’ERP ; qui valide les références et l’apprentissage ; et quelles performances et obligations d’exploitation sont effectivement nécessaires.

Nous préférons un diagnostic qui remet en cause une hypothèse fragile à une validation de principe. La décision finale sur les besoins, le financement, le périmètre et la mise en service reviendra au porteur de projet, éclairé par l’avis indépendant du prestataire.
