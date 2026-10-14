# DOS-CAL-01 — Contrat de la revue humaine de couverture

Cadrage du 11 octobre 2026, avant implémentation. Il précise la
[priorité recommandée](next-priority-source-coverage-review.md), issue de
[DOS-02, DOS-03 et DOS-05](backlog-chiffrage-2026-10-11.md). Les observations
ci-dessous portent sur les sources du checkout courant ; elles ne constituent
ni une nouvelle recette exécutée ni une modification de la base. Les termes
métier sont définis dans [CONTEXT.md](../../CONTEXT.md).

## Résultat recherché et limite de la tranche

Pour une version de devis et un CCTP explicitement retenus, le chiffreur peut
dire **quelle exigence de calorifuge concerne quelle zone ou quel réseau,
où sa prestation est traitée et sur quelle preuve repose sa décision**.
La réponse reste consultable après rechargement et devient « à revérifier »
quand les éléments examinés changent.

Le premier parcours est entièrement humain, sur un CCTP PDF texte et un devis
pilote à deux zones. Il accepte plusieurs liens par exigence et plusieurs
exigences par ligne. Il sait montrer une inclusion dans un sous-détail
d'ouvrage appliqué, sans créer une nouvelle ligne ni modifier un montant.
Il ne déclare pas le CCTP analysé exhaustivement. L'extraction automatique,
l'OCR, l'arbitrage de toutes les contradictions du dossier, le moteur CVC
paramétrique et la ventilation financière indépendante de la DPGF restent
des tranches distinctes.

## Faits établis dans l'existant

| Source actuelle | Conséquence pour le contrat |
| --- | --- |
| [register.ts:3, 12, 226](../../src/lib/affaires/register.ts) définit hypothèses/pièces manquantes, leurs statuts et un seul `scopeId` par entrée. | Une hypothèse validée ne devient pas une exigence couverte. Les relations multiples de couverture manquent à ce modèle. |
| [register-server.ts:929](../../src/lib/affaires/register-server.ts) utilise une RPC atomique pour modifier l'entrée et ajouter son événement ; [durcissement ingestion:323, 474, 483](../../supabase/migrations/20260713134332_harden_ingestion_audit_boundaries.sql) réserve cette RPC au service et conserve l'état avant/après. | Réutiliser ce principe de journal atomique. Ne pas présenter le registre actuel comme une suite d'écritures non atomique. Sa signature n'offre pas de révision attendue de décision de couverture. |
| [intake-server.ts:495](../../src/lib/affaires/intake-server.ts) choisit le principal explicite, sinon le plus ancien. Le changement de principal à `:3227` démote puis promeut par écritures séparées. | Ce choix de navigation n'est pas une référence de revue confirmée. La mutation en plusieurs appels demande une qualification de panne/concurrence si elle est utilisée pour un arbitrage. |
| [priorités documentaires:40, 44](../../supabase/migrations/20260312113000_est435_document_priority.sql) impose déjà un seul principal CCTP et un seul principal DPGF par projet. | Ne pas inventer un défaut autorisant deux principaux dans ces catégories : le risque restant concerne une transition incomplète ou un succès ambigu. |
| [intake:21](../../supabase/migrations/20260306210000_est371_affaire_intake.sql) conserve identité, chemin, taille et métadonnées du document ; les policies Storage `:478` et `:515` autorisent remplacement/suppression dans leur périmètre. | Ni un UUID de document ni un chemin de stockage ne suffisent à garantir les octets examinés. Aucune identité dédiée de révision de contenu CCTP n'a été retrouvée dans les sources inspectées. |
| [preuves de lignes:5](../../supabase/migrations/20260306213000_est391_line_evidence_graph.sql) contient empreinte, localisation, invalidation et remplacement, mais exige un job de métré et une ligne. | Réutiliser les preuves existantes quand applicables ; ne pas fabriquer un job ou une ligne pour représenter une exigence encore non rapprochée. |
| [sous-détails:99](../../supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql) conserve les composants appliqués. [generated-ouvrages.ts:2333, 3920](../../src/lib/estimates/generated-ouvrages.ts) garde leur identité et leur instantané. [Provenance:372](../../src/lib/estimates/generated-ouvrage-provenance.ts) expose le lien vers cet instantané. | L'inclusion vise le composant effectivement appliqué, identifié dans son instantané, et sa ligne courante ; pas le modèle de bibliothèque modifiable ni une ressemblance de désignation. |
| [durcissement des workflows:492](../../supabase/migrations/20260713140444_harden_estimate_workflow_write_boundaries.sql) retire UPDATE/DELETE authentifiés des instantanés appliqués. Leurs parents et lignes conservent des FK CASCADE dans [sous-détails:104-109](../../supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql). | Ils sont déjà protégés des modifications directes ordinaires, mais leur disparition en cascade ne doit pas effacer l'historique d'une décision de couverture. |
| La lecture d'un instantané dépend du draft visible, [sous-détails:503](../../supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql). La lecture du draft passe par version/projet et rôles du tenant, [ouvrages:310](../../supabase/migrations/20260307110000_est381_generated_ouvrages.sql). | La lecture n'est pas réservée au créateur ; la contrainte de créateur concerne notamment les écritures. Contrôler chaque parent et chaque source, sans élargissement implicite par un client privilégié. |
| [révision du devis:106](../../supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql) incrémente la révision lors des changements significatifs de lignes. | Bon témoin de concurrence, trop large comme unique règle d'invalidation technique : un prix ou une autre zone peut changer sans altérer cette couverture. |
| [write-access.ts:7](../../src/lib/estimates/write-access.ts) exige admin/engineer pour écrire un workflow de devis ; [register-server.ts:783](../../src/lib/affaires/register-server.ts) distingue actuellement lecteur et propriétaire/admin. | Le nouveau parcours doit contrôler le rôle d'écriture explicitement, y compris pour un propriétaire devenu lecteur. Les droits anciens du registre ne doivent pas être copiés aveuglément. |

## Modèle minimal durable

Quatre ensembles suffisent. Ce sont des responsabilités métier, pas une
prescription d'une table par ligne du tableau. La prestation reste décrite
par l'exigence et les ressources existantes : cette tranche ne crée pas un
second catalogue de prestations.

| Ensemble | Identité et contenu conservés | Invariant |
| --- | --- | --- |
| Revue et référence | Tenant, affaire, version de devis ; révision de revue ; référence active ; versions successives du CCTP retenu avec identité du document d'origine, empreinte des octets, exemplaire conservé, auteur, date et motif. | Une référence active par revue, choisie explicitement. Une référence passée reste inchangée. |
| Exigence | Identité stable, révision, prescription reformulée, prestation attendue, périmètre et citations sources. Une citation conserve référence de contenu, page PDF, passage, auteur et état de vérification. | Elle existe avant tout rapprochement. Le fichier seul, le nom de famille et un score IA ne constituent pas une preuve localisée vérifiée. |
| Relations de couverture | Ensemble de liens d'une exigence vers des lignes courantes de cette version ; cible directe ou composant d'un ouvrage appliqué, périmètre attribué et justification. Liens distincts vers les entrées canoniques du registre utiles à la décision. | Plusieurs-à-plusieurs sans duplication de prix, quantité ou heure ; un même lien ne se compte pas deux fois. Une inclusion doit aboutir à une ressource réelle, jamais à une boucle d'exigences se déclarant mutuellement incluses. |
| Décisions | Suite immuable d'arbitrages : traitement, motif, auteur/date, révision d'exigence et de référence, liens effectivement revus, faits techniques examinés, références au registre et décision précédente. | Une seule décision courante par exigence. Le passé est lisible même si la cible a disparu ; il n'est jamais réécrit pour ressembler au présent. |

### Référence de revue et contenu conservé

Le « document principal » de l'intake reste une suggestion et un repère du
dossier. Il ne remplace pas le choix explicite pour une version de devis.
L'interface affiche « référence de cette revue » et signale si le principal
du dossier diffère. Modifier ce principal ou déposer B ne remplace pas A
dans une revue existante. La revue initiale exige un choix, même si une seule
pièce est proposée.

La première tranche retient un seul CCTP principal de revue. Un additif
contradictoire peut être consigné comme question ouverte dans le registre,
mais ne se superpose pas silencieusement au CCTP retenu. Une référence
composite avec précédence de clauses appartient à la suite de DOS-02.

À la confirmation de référence, conserver une version de contenu privée,
identifiée par une empreinte calculée côté serveur sur les mêmes octets que
ceux conservés. Le contrat recommandé est une copie immuable réservée à la
revue, avec accès dérivé de l'affaire ; la simple réutilisation du chemin
intake actuel ne satisfait pas ce contrat. Ne pas publier une référence tant
que cette copie n'est pas vérifiée. Une panne de copie laisse la référence
précédente active. La copie et l'arbitrage demandent une reprise idempotente,
sans prétendre disposer d'une transaction unique entre Storage et la base.

Un fichier remplacé dans l'intake ne change donc pas une référence conservée.
S'il est impossible de consulter le contenu conservé, montrer « source
indisponible » et suspendre la confirmation ; ne jamais ouvrir les octets
nouveaux sous la preuve ancienne. L'historique garde son extrait et son
identité. Aucune règle de conservation légale nouvelle n'est supposée.

### Périmètre, citation et inclusion

Le périmètre associe une zone et un réseau identifiés dans cette affaire.
Les identités restent stables lorsque seul leur libellé est corrigé. Un champ
absent signifie « non précisé », pas « toutes les zones ». Le périmètre
« ensemble de l'affaire » est un choix explicite. Aucun moteur de géométrie
ou de topologie de réseau n'est requis. Le périmètre est déclaré par le
chiffreur ; un titre de section DPGF ou une proximité de nom ne l'établit pas.

Si la même clause concerne A et B avec des traitements différents, créer
deux exigences de périmètres distincts pouvant citer le même passage. Une
décision pour A ne se propage pas à B. Une ligne globale peut couvrir les deux
uniquement par deux liens explicitement justifiés. Les quantités du devis ne
sont pas réparties automatiquement par ces liens.

Pour le PDF pilote, distinguer le numéro de page physique, obligatoire et
borné par le document, du folio imprimé éventuellement indiqué. Une citation
saisie commence « à vérifier ». Le chiffreur consulte la version conservée
et confirme le passage ; l'auteur et la date qualifient cette vérification
humaine, sans la présenter comme une vérification automatique du texte.

« Inclus ailleurs » vise une ligne identifiée et soit son composant appliqué,
soit un contenu de prestation explicitement documenté. Pour le cas calorifuge
dans un ouvrage, la preuve attendue est l'identité du composant dans
l'instantané appliqué, sa désignation, son unité, sa quantité et le périmètre
retenu, avec la ligne parent actuelle. Un mot « calorifuge » dans le titre
d'un modèle de bibliothèque ne suffit pas. Une suggestion rejetée ne couvre
rien. Le snapshot d'origine décrit ce qui a été appliqué ; il ne certifie pas
que toute modification ultérieure du parent conserve cette composition.

## Traitement et validité : deux dimensions distinctes

| Traitement | Conditions pour enregistrer une décision à jour |
| --- | --- |
| Non arbitré | Exigence conservée sans traitement décidé. Aucun lien manquant ne produit une accusation automatique d'omission. |
| Chiffré | Au moins une ligne courante traite explicitement la prestation dans le périmètre ; le chiffreur confirme son contenu et la prise en compte dans le chiffrage. |
| Inclus ailleurs | Cible courante et justification explicites ; contenu ou composant justifiant l'inclusion effectivement revu. |
| Exclu | Motif explicite et prescription source vérifiée. Cette décision interne ne vaut ni accord client ni modification de l'offre déjà émise. |
| Autre lot | Lot destinataire nommé explicitement et justification sourcée ; aucune ligne fictive de ce devis n'est nécessaire. |
| Provisoire | Motif, incertitude et lien vers une hypothèse ou pièce manquante du registre existant. Ce traitement ne devient pas « chiffré » parce que l'hypothèse est validée. |

Tout traitement décidé, hors « non arbitré », nécessite une citation source
vérifiée. Une prescription seulement supposée demeure une hypothèse du
registre. Des liens couvrant une partie de la prestation peuvent être
conservés, mais ne rendent pas l'exigence entière « chiffrée » : elle reste
non arbitrée jusqu'au traitement explicite du reste ou à sa division en
exigences de périmètres distincts.

« Chiffré » et « inclus ailleurs » n'autorisent pas un simple conteneur de
section, une ligne supprimée, une suggestion non appliquée ou une ligne d'une
autre version. Les données obligatoires de la composition doivent être
présentes. Un montant nul ne suffit ni à prouver ni à réfuter la couverture :
le cas main-d'œuvre seule conserve son sens. Les règles de prix fournisseur
et de préparation d'achat restent indépendantes.

La validité vaut **non revue**, **à jour** ou **à revérifier**. « À jour »
signifie que les éléments réellement examinés correspondent encore à ceux de
la décision, pas que tout le dossier est couvert. Une décision provisoire
peut être à jour tout en laissant une incertitude ouverte. Le traitement
précédent demeure visible lorsqu'une décision passe à revérifier.

Une lecture en cours ou en échec s'affiche comme vérification en cours ou
indisponible. Elle ne remplace pas la dernière décision, ne vaut pas zéro
exigence et ne permet pas d'affirmer « à jour ». Une panne transitoire de
lecture n'est pas, à elle seule, un événement métier d'invalidation.

Les compteurs portent sur les exigences identifiées dans cette revue :
traitements, provisoires, non arbitrées et décisions à revérifier. Ils ne
produisent pas un pourcentage d'exhaustivité du CCTP, une conformité certifiée,
un compteur d'achats ou une autorisation automatique d'envoi du devis.
Archiver une exigence demande un motif et conserve son historique ; elle sort
des comptes actifs sans se transformer en exclusion technique.

## Transitions et autorité d'écriture

| Action | Transition attendue et résultat atomique |
| --- | --- |
| Retenir la première référence | Après copie vérifiée et contrôle des droits, créer la revue de référence et son événement. Le clic perdu puis rejoué retrouve le même résultat. |
| Remplacer A par B | Vérifier la révision de revue attendue, conserver A et ajouter B. Les décisions attachées à A deviennent à revérifier ; aucune citation de A n'est rebaptisée citation de B. |
| Ajouter une exigence | Créer prescription, périmètre et citations à vérifier. État initial non arbitré/non revue. |
| Modifier prescription, citation, périmètre ou liens | Incrémenter la révision concernée ; la dernière décision reste historique et devient à revérifier. Ne pas écraser son ancien ensemble de liens. |
| Décider ou revérifier | Relire les dépendances, comparer la révision attendue et enregistrer ensemble décision, faits revus et événement. Une panne n'enregistre pas seulement le badge ou seulement l'historique. |
| Réouvrir ou refuser une proposition | Ajouter un arbitrage motivé, sans effacer le précédent. Le refus d'une suggestion n'efface pas l'exigence à traiter. |
| Passer le devis hors brouillon | Conserver la lecture historique ; refuser les nouvelles décisions de travail dans cette tranche. Une nouvelle étude passe par une version de travail. |

Une sauvegarde depuis un écran périmé reçoit un conflit explicite et un état à
relire. Elle ne réapplique pas silencieusement son ancienne décision. La
répétition de la même intention retrouve le même résultat ; la réutilisation
de son identité avec un contenu différent est refusée. Une révision n'est
jamais fournie librement comme nouvelle valeur par le client.

Au commit, le contrôle porte sur les dépendances courantes effectivement
verrouillées : référence active, citation vérifiée pour cette référence,
prescription, périmètre, cibles et entrées du registre liées. Une quantité ou
une composition modifiée depuis l'aperçu provoque un conflit ; elle ne peut
pas être confirmée à partir de l'ancien fait. Après le choix de B, une citation
vérifiée seulement sous A reste historique et ne permet pas de revérifier
l'exigence sous B. Il faut examiner et confirmer un passage de B. Aucune
réassociation ni revalidation implicite de A ne satisfait ce contrôle.

La révision globale du devis sert à repérer une modification concurrente au
moment de décider. La validité après décision se calcule sur les dépendances
techniques effectivement liées. Elle ne repose pas sur la seule révision
globale ni sur un événement asynchrone qui pourrait manquer. Tous les chemins
d'écriture, y compris import, duplication et Data API autorisée, doivent
produire la même invalidation observable ou être refusés à cette frontière.

## Changements qui imposent une nouvelle revue

| Changement | Effet sur la couverture |
| --- | --- |
| Nouveau document secondaire, changement de principal intake | Référence de revue inchangée ; signaler le nouveau contexte sans réécrire les décisions. |
| Choix explicite d'une autre référence de revue | Décisions de l'ancienne référence à revérifier. Réassociation humaine des passages, même si le nouveau fichier a le même nom. |
| Remplacement du contenu intake après conservation de la référence | La copie de référence reste identique ; aucune invalidation sur la seule identité intake. Si la copie conservée est altérée ou manquante, confirmation interdite et preuve indisponible explicite. |
| Prescription, passage, vérification de preuve ou périmètre changés | Décisions de cette exigence à revérifier. Changer le texte puis le remettre ne rétablit pas automatiquement un arbitrage ancien. |
| Désignation technique, nature de ligne, unité, quantité, article ou appartenance au périmètre d'une cible changés | Décisions liées à cette cible à revérifier ; conserver les faits précédemment revus. |
| Disparition établie d'un composant appliqué, application remplacée, quantité ou composition du parent changée | Inclusions qui en dépendent à revérifier. La présence d'un ancien snapshot ne suffit pas à confirmer le parent actuel. Une panne de lecture n'établit pas une disparition. |
| Cible supprimée ou déplacée hors de sa version/affaire | Lien courant non utilisable ; historique et faits examinés conservés. Un déplacement ne doit jamais réattribuer silencieusement l'historique à un autre tenant ou projet. |
| Hypothèse/pièce manquante liée modifiée, rejetée, rouverte ou désactivée | Décisions qui en dépendent à revérifier. La résolution du registre ouvre une nouvelle revue, pas une validation automatique de couverture. |
| Prix, marge ou ordre d'affichage seuls ; autre zone sans dépendance commune | Pas d'invalidation technique globale. Si le changement fait disparaître une donnée obligatoire du chiffrage, l'étiquette « chiffré » est à revérifier. |
| Libellé d'une zone corrigé sans changer son identité ou son étendue | Historique du libellé conservé ; pas de propagation aux autres exigences. Une modification d'étendue impose en revanche une revue. |
| Refus d'accès propre à l'utilisateur courant | Masquer l'ouverture ou les détails interdits, sans déclarer à tort la décision globalement périmée. Distinguer accès refusé, donnée supprimée et panne de lecture. |

Une dépendance supprimée reste décrite par les faits de la dernière décision
et un état de disparition explicite, sans FK de cible qui détruirait cette
trace. Cette garantie concerne la suppression de ligne, de pièce, de draft
ou d'application au sein de l'affaire. Elle ne bloque pas les suppressions
autorisées de l'affaire entière et n'introduit pas une conservation illimitée
hors de son périmètre d'accès. Le déplacement des parents d'une revue vers
un autre tenant/affaire doit être refusé, pas utilisé comme transfert de droits.

La duplication d'un devis crée de nouvelles identités de lignes. Elle peut
proposer des rapprochements à partir d'une correspondance explicite ancien →
nouveau, mais ne copie aucune décision comme déjà valide. À défaut de cette
correspondance vérifiée, la nouvelle version commence sans couverture revue.

## Intégrations et droits

Le registre garde l'autorité sur les hypothèses et pièces manquantes. Une
exigence peut citer plusieurs entrées existantes ; une entrée peut justifier
plusieurs décisions. Une exigence non rapprochée ne crée pas automatiquement
une nouvelle hypothèse. Si une vraie hypothèse manque, la créer dans le
registre par son parcours canonique puis la relier. Les métadonnées de
couverture ne deviennent pas une seconde version modifiable de cette entrée.
L'historique de décision conserve seulement l'état du registre effectivement
examiné. Le journal actuel, lié à une entrée parente, ne doit pas accueillir
une fausse entrée « hypothèse » pour servir de journal de couverture.

Les preuves de métré et la provenance des ouvrages restent des sources
réutilisables. Le modèle de preuve par ligne existant exige une ligne et un
job de métré : les citations d'exigences sans ligne ont leur place dans la
revue documentaire. Réutiliser les formats et l'ouverture de preuve utiles,
sans cloner leur contenu comme une nouvelle autorité modifiable.
Le chemin import `dpgf_rows_raw` → mappings → `confirmUnifiedImportFlow`,
`sourceDocumentId` et `_timax_provenance` reste conservé. L'import PDF dispose
déjà d'un [worker terminable, extracteur:811-857](../../src/lib/imports/tabular-pdf-extraction.ts).
La couverture ne déclenche pas une réimportation ni une extraction IA.

Les liens n'écrivent ni dans le calcul financier ni dans la DPGF. L'export
[dpgf-export.ts:291, 342](../../src/lib/estimates/dpgf-export.ts) continue de
présenter l'arbre existant. Notes internes, coûts de sous-détail et motifs de
revue ne sont pas ajoutés aux documents client de cette tranche.

L'autorisation proposée pour les nouvelles opérations est :

- Lecture : membre réel du tenant actif, affaire et version accessibles,
  propriétaire ou admin/director conformément au parcours devis ; un
  propriétaire devenu lecteur conserve la lecture, pas l'écriture.
- Écriture : admin du tenant ou engineer propriétaire de l'affaire, version
  brouillon et affaire non archivée. Director/viewer ne décide pas dans ce
  parcours, même s'il est propriétaire.
- Chaque document, entrée du registre, ligne et snapshot lié appartient au
  tenant et à l'affaire attendus ; les cibles de chiffrage appartiennent à la
  version examinée. La portée du registre doit être compatible avec le
  périmètre décidé, pas seulement avec le tenant.
- Une lecture ou une écriture par RPC/URL directe applique ces règles à son
  tour. Ni les identités de parent ni l'auteur ne sont crus sur parole. Les
  changements de rôle et d'état sont revérifiés à l'écriture.
- La consultation d'une source respecte ses droits actuels. Un droit de lire
  un badge de couverture n'accorde pas implicitement accès à une pièce ou à
  un coût interne caché. Les copies de référence n'ont pas d'URL publique.

Ces règles n'élargissent pas les RLS existantes et ne prétendent pas corriger
tous les anciens parcours du registre. Le contrôle actuel de tenant actif
est dans [tenant-context.ts:60](../../src/lib/auth/tenant-context.ts), la
lecture des lignes par propriétaire/admin/director dans
[RLS directeur:226](../../supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql).
Les divergences d'accès entre sources doivent être affichées, pas contournées.

## Échecs observables à écrire avant le code

La recette primaire est TesterArmy avec des comptes ordinaires et de nouvelles
fixtures ARMY. Les cas natifs ci-dessous complètent les scénarios UI pour
des courses ou des écritures directes que celle-ci ne peut pas établir.
Aucun de ces nouveaux scénarios n'est encore déclaré exécuté ici.

| Cas préalable | Résultat exigé | Preuve adaptée |
| --- | --- | --- |
| A retenu, puis dépôt B ou changement du principal | A reste la référence de revue ; B est signalé sans couverture inventée. | UI + rechargement. |
| Deux choix concurrents B/C ; panne pendant conservation du contenu | Une seule transition gagnante ; conflit explicite pour l'autre ; aucune référence active sans contenu conservé. | UI de reprise + concurrence native et faute Storage contrôlée, séparément. |
| A revu, puis B explicitement retenu ; tentative de revalidation avec la citation vérifiée de A | Refus sans nouvelle décision à jour ; succès seulement après citation de B effectivement revue ; référence, citation et décision A restent historiques. | UI/API + contrôle natif de l'appartenance de la citation à la référence active. |
| Même nom, même document d'origine, octets remplacés | L'ancienne revue ouvre exactement son contenu conservé ; jamais les nouveaux octets sous l'ancienne citation. | Storage local + UI de la preuve. |
| Citation absente, page hors bornes, fichier seulement associé | Pas de passage prétendument vérifié ni de décision finale reposant sur cette pseudo-preuve. | UI/API. |
| Calorifuge A inclus, B non rapproché | A est inclus et B reste non arbitré ; aucune propagation par titre ou par proximité. | UI, assertions par exigence. |
| Une exigence couvre deux lignes ; une ligne couvre deux exigences | Liens réciproques persistés, comptes sans doublon, montants/heures/export inchangés. | UI + export déterministe. |
| Modèle de bibliothèque mentionnant calorifuge, composant appliqué absent/rejeté | Inclusion non confirmable par le seul modèle ; le composant réel est exigé pour ce cas. | UI + lecture des identités appliquées. |
| Modification du modèle après application, puis de la quantité du parent | Le modèle seul ne réécrit pas la preuve ; la quantité courante modifiée impose une revue ciblée. | UI + rechargement. |
| Suppression de ligne ou de draft entraîne la disparition du snapshot | Couverture courante à revérifier et ancienne décision encore lisible avec ses faits. | UI + native pour FK CASCADE. |
| Modification directe de cible, de parent ou de tenant par Data API | Même invalidation qu'en UI, ou refus ; aucun déplacement de l'historique vers un autre périmètre. | Régression native/RLS avant guards. |
| Hypothèse liée validée, puis rouverte/rejetée | Aucun passage automatique à « chiffré » ; décisions concernées à revérifier. | Registre et revue dans la même recette UI. |
| Marge/prix seuls, réordonnancement, autre zone modifiée | La couverture technique non affectée reste à jour ; les valeurs financières ne sont pas réécrites par la revue. | UI + valeurs exactes. |
| Deux chiffreurs décident depuis la même révision ; même requête rejouée | Un arbitrage gagne, l'autre reçoit un conflit ; replay sans double événement ; même identité/autre contenu refusée. | Deux connexions natives réelles + reprise UI. |
| Quantité ou composition de la cible modifiée entre aperçu et commit de décision | Si la modification a gagné, conflit de décision ; si la décision a gagné, la modification suivante la rend à revérifier. Aucun état à jour ne porte l'ancien fait après les deux commits. | Deux connexions natives et observateur indépendants, puis relecture UI. |
| Dégradation de rôle ou envoi du devis entre lecture et confirmation | Confirmation refusée ; aucune décision partielle ni historique fabriqué. | UI + course native. |
| Nouvelle version par duplication | Aucun UUID de cible ancien réemployé comme couverture confirmée ; rapprochements éventuellement proposés à revérifier. | Parcours version + UI. |
| Autre tenant, autre affaire, lecteur, source non accessible, panne de lecture | Écriture et ouverture interdites selon droits ; panne ≠ liste vide ; restriction de lecteur ≠ invalidation globale. | Matrice comptes/URL/API/Storage. |
| Exclu, autre lot, provisoire sans justification ou destination requise | Refus intelligible ; données précédentes conservées. | UI/API. |

## Cinq critères de fin

1. **Référence reproductible.** Choix A/B explicite, version de contenu
   conservée, auteur/date/motif, reprise après panne et conflit concurrent
   démontrés ; aucun changement implicite par dépôt.
2. **Oracle calorifuge utilisable.** Six traitements, deux zones, citations
   réellement consultables et vérification humaine identifiée ; non rapproché
   reste une incertitude. Le pilote métier humain est distingué de l'oracle
   technique déterministe tant qu'un chiffreur ne l'a pas validé.
3. **Relations réelles sans effet financier.** Liens multiples dans les deux
   sens, inclusion prouvée par un composant appliqué et son parent courant,
   aucun doublon DPGF/coût/heure/quantité ; export inchangé sur le même devis.
4. **Décisions durables et correctement périmées.** Auteur, preuves et faits
   revus conservés après suppression d'une cible ; invalidation ciblée,
   revalidation humaine et refus d'une écriture périmée démontrés.
5. **Droits et limites vérifiés.** Parcours entièrement utilisable sans modèle,
   RLS/Storage et concurrence qualifiés localement, aucun détail interne
   ajouté à l'offre client, aucune promesse d'exhaustivité documentaire.

L'ordre proposé est : oracle et régressions RED ; contrat de conservation de
référence et droits ; exigence/citation/périmètre ; liens et décision atomique ;
invalidation et historique ; recette complète. La conception SQL/API pourra
ensuite fixer les signatures et limites de volume à partir de ce contrat,
avant toute implémentation. Ce document ne vaut pas autorisation d'appliquer
une migration distante.
