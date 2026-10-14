# DOS-CAL-01 — Accès, concurrence et interfaces du premier parcours

Plan du 11 octobre 2026, **avant code et avant exécution**. Il complète le
[contrat produit](../product/source-coverage-contract.md) et
[l'oracle calorifuge](source-coverage-oracle.md). Les noms de tables, RPC et
routes proposés ci-dessous n'existaient pas lors de cette rédaction. Aucune
mutation n'est réalisée par ce document. La migration locale et les huit
courses natives sont désormais qualifiées séparément ; voir les preuves
datées dans le [journal de progression](../product/progress-chiffrage-2026-10-11.md).
Les routes HTTP, octets conservés et interface restent à qualifier.

Le premier incrément livre un parcours complet : choisir un CCTP, préparer
une copie privée vérifiée, consulter cette copie, puis la confirmer comme
référence d'une version de devis. Déposer B ou préparer sa copie ne remplace
pas A. Exigences, citations et décisions viennent ensuite, sur cette même
référence conservée. Les cas de concurrence correspondants sont définis ici
pour préparer leurs régressions avant leur implémentation.

## 1. Frontières actuelles à conserver et à qualifier

Les constats proviennent des fichiers suivants, pas d'une inspection nouvelle
de la base installée. Avant le candidat SQL, comparer ces définitions avec les
policies, ACL et corps de fonctions de la pile locale réellement utilisée.

| Ressource | Lecture actuelle | Écriture actuelle et conséquence |
| --- | --- | --- |
| Tenant et acteur serveur | [tenant-context.ts:60, 88](../../src/lib/auth/tenant-context.ts) exige un utilisateur et une membership réelle d'un tenant actif ; défaut d'abord, sinon plus ancienne membership. | Les helpers SQL [tenant actif:4, 20, 46](../../supabase/migrations/20260713135334_harden_active_tenant_and_profile_rls.sql) excluent les tenants suspendus, mais `is_tenant_member` et `has_tenant_role` admettent aussi l'admin global. Le nouveau parcours exige une membership réelle du tenant courant ; ne pas assimiler ce raccourci historique à cette exigence. |
| Affaire/version | [multitenant:1384, 1403](../../supabase/migrations/013_multitenant_core_s5.sql) : propriétaire ou admin, sous membership ; [directeur:250, 265](../../supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql) ajoute sa lecture. | Les policies générales `FOR ALL` ne sont pas, seules, le contrat des nouvelles mutations. Relire version/affaire, rôle, statut brouillon et archivage au commit. Ne pas permettre de déplacer une revue vers un autre parent. |
| Lignes du devis | [directeur:226](../../supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql) : propriétaire/admin/director avec parents cohérents. | [viewer readonly:7, 33, 80](../../supabase/migrations/20260304161000_ux2_017_rls_viewer_readonly.sql) exige draft et admin/engineer avec propriétaire/admin. [Révision de contenu:106](../../supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql) verrouille ensuite la version lors du changement de ligne. Cet ordre existant impose une précaution contre les deadlocks. |
| Documents intake et événements | [brief:97, 301, 311, 321](../../supabase/migrations/20260306224500_est372_affaire_brief.sql) : tenant courant et propriétaire/admin/director. [intake-server.ts:1094](../../src/lib/affaires/intake-server.ts) refuse aussi l'affaire archivée. | [intake:123, 329, 339, 352](../../supabase/migrations/20260306210000_est371_affaire_intake.sql) permet au propriétaire/admin d'insérer/modifier/supprimer le document ; le rôle d'engineer n'est pas explicitement exigé pour le propriétaire par ce helper historique. Les événements sont désormais append-only, [durcissement ingestion:295](../../supabase/migrations/20260713134332_harden_ingestion_audit_boundaries.sql). |
| Octets intake | [brief:331](../../supabase/migrations/20260306224500_est372_affaire_brief.sql) : chemin tenant/projet/upload/document exact, document `uploaded`, propriétaire/admin/director. | [intake:456, 478, 515](../../supabase/migrations/20260306210000_est371_affaire_intake.sql) : INSERT/UPDATE/DELETE dans le périmètre propriétaire/admin. Le fichier d'origine reste donc modifiable. Copier son chemin ou sa seule identité ne fige pas son contenu. |
| Registre et journal | [registre:283, 329](../../supabase/migrations/20260307000500_est373_affaire_register.sql) : tenant courant et lecture de l'affaire. [register-server.ts:762](../../src/lib/affaires/register-server.ts) : propriétaire/admin/director lecteurs, propriétaire/admin éditeurs, affaire non archivée. | INSERT reste gouverné par `:292` ; UPDATE/DELETE authentifiés retirés par [durcissement ingestion:502](../../supabase/migrations/20260713134332_harden_ingestion_audit_boundaries.sql). La RPC `:323` est service-only, verrouille l'entrée `:396` et journalise avant/après. La création et son événement sont encore distincts côté serveur ; ce plan ne prétend pas les rendre atomiques. |
| Ouvrage appliqué | [snapshots:503](../../supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql) dépend de la visibilité du draft ; [drafts:310](../../supabase/migrations/20260307110000_est381_generated_ouvrages.sql) passe par version/projet et rôles. La lecture n'est pas réservée au créateur. | L'insertion exige notamment le créateur du draft. UPDATE/DELETE authentifiés des snapshots retirés par [durcissement workflows:492](../../supabase/migrations/20260713140444_harden_estimate_workflow_write_boundaries.sql). Des FK CASCADE `snapshots:104-109` restent actives : conserver les faits revus dans le futur journal de décision. |
| Composant appliqué | [generated-ouvrages.ts:2333, 3920](../../src/lib/estimates/generated-ouvrages.ts) conserve `componentId` dans le JSON du snapshot ; [provenance:372](../../src/lib/estimates/generated-ouvrage-provenance.ts) relie application/snapshot/parent. | Un composant de bibliothèque mutable n'est pas ce composant appliqué. Le futur lien vérifie snapshot + identité du composant + parent/version courants. |

Les différences historiques de droits sont des cas de baseline à mesurer.
Ce lot ajoute une frontière stricte à la revue ; il ne durcit pas en bloc
l'intake, le registre ou les anciennes policies de gestion de projet.

## 2. Comptes, ressources et attentes

Créer ultérieurement de nouvelles fixtures `ARMY-COVERAGE-{runId}`. Reprendre
les alias P/V, A/B, L1 et C-ISO de l'oracle, sans utiliser une fixture achats.
Ajouter P2/V2 dans le même tenant T1 et PX/VX dans T2. U possède P ; N possède
P2. A et B ont le même nom, trois pages et des octets différents. Une source
non `uploaded`, une source d'autre affaire, une copie pending et une copie
verified complètent les témoins. Les UUID réels restent dans le manifeste.

| Acteur | Lire revue, historique et copie confirmée de P/V | Préparer/activer dans P/V brouillon | Accéder directement au nouveau bucket |
| --- | --- | --- | --- |
| U, engineer propriétaire, T1 courant actif | Oui. | Oui. | Non ; consultation via route authentifiée. |
| N, engineer non propriétaire, T1 courant | Non. | Non, même avec les UUID exacts. | Non. |
| Admin de T1 avec membership réelle | Oui. | Oui, y compris pour P d'un autre propriétaire. | Non. |
| Director de T1 | Oui. | Non, même s'il devient propriétaire de P. | Non. |
| Viewer propriétaire de P | Oui. | Non. Ce refus est plus strict que certains anciens helpers d'intake. | Non. |
| Viewer non propriétaire | Non. | Non. | Non. |
| U membre de T1 et T2, T2 devenu courant | Non pour P/T1 dans ce parcours ; oui seulement après retour explicite à T1. | Non pour P/T1. | Non. |
| Ancien membre supprimé de T1, ou tenant T1 suspendu | Non. | Non. | Non. |
| Utilisateur de T2 seulement, ou anonyme | Non, sans existence/nom de P divulgués. | Non. | Non. |
| Profil admin global sans membership T1 réelle | Non pour les nouvelles opérations, même si un ancien helper accepte ce profil. | Non. | Non. |
| Service technique du serveur | Pas un acteur de revue humaine. | Atteste la copie et transporte la confirmation explicite de U ; SQL réautorise l'acteur réel. Le service ne choisit ni auteur ni référence de sa propre initiative. | Écriture/lecture du seul chemin réservé par le serveur ; jamais de chemin fourni librement par le navigateur. |

Pour chaque acteur, tester séparément : page UI, GET/POST applicatif, RPC
directe et accès Storage. Un bouton caché n'est pas une preuve d'autorisation.
Une écriture privilégiée de fixture n'est jamais le résultat positif d'un
scénario utilisateur. Aucun mot de passe, cookie ou JWT dans les artefacts.

| Ressource ciblée par une requête autorisée sur P/V | Résultat exigé |
| --- | --- |
| Document A de P/T1, PDF `uploaded` classé CCTP | Réservation autorisée ; source téléchargée avec les droits réels de U. |
| Document de P2/T1 ou PX/T2, upload non terminé, mauvais type | Refus avant copie et avant activation ; pas de ticket utilisable pour un autre périmètre. |
| Copie pending de P/V | Statut consultable ; contenu et activation indisponibles. |
| Copie verified de P/V, original renommé/remplacé/supprimé | Contenu conservé inchangé, identité et nom capturés visibles ; aucun repli sur l'original. |
| Copie de P/V2, de P2 ou de PX injectée dans la confirmation | Refus de périmètre, même si U peut lire séparément les deux ressources. |
| Version envoyée/acceptée | Lecture conservée selon droits ; préparation et nouvelle activation refusées. |
| Affaire archivée | Refus du nouveau parcours comme l'accès intake actuel ; aucun nouveau droit de consultation générale des archives créé ici. |
| Registre de P mais portée d'une autre version/ligne incompatible | Futur lien refusé ; pas de copie locale de l'hypothèse pour contourner le refus. |
| Snapshot de L1, mais composant absent/rejeté ou parent dans V2 | Future inclusion refusée. La lecture du snapshot seul ne prouve pas sa pertinence. |
| Donnée devenue inaccessible au lecteur, sans modification de son contenu | Ouverture refusée ; la décision globale ne devient pas périmée du seul fait de ce lecteur. |

Sur les ressources existantes, enregistrer aussi le résultat direct réel de
la policy ancienne. Exemple : un viewer propriétaire peut être autorisé à
modifier l'intake par l'ancien helper tout en étant refusé pour la nouvelle
référence. Ce résultat ne doit être ni caché ni transformé en droit nouveau.

## 3. Courses et fautes à écrire avant le SQL correspondant

Pour les courses natives, deux connexions transactionnelles indépendantes et
un observateur sont requis. Conserver ordre des étapes, PID, attente observée
(`pg_blocking_pids`/verrou), codes de sortie et état après les deux commits.
Pour un refus NOWAIT, conserver la contention constatée et le refus immédiat.
Une suite de deux appels terminés n'est pas une preuve de concurrence.

| ID | Entrelacement à provoquer | Oracle exact |
| --- | --- | --- |
| REF-01 | Deux confirmations B/C depuis la même révision r | Une activation et un événement seulement à r+1 ; seconde intention en conflit, jamais deux références courantes. |
| REF-02 | Même préparation simultanée ; deux tentatives d'upload | Même copy_id pour le même acteur/contenu de requête ; création Storage sans upsert ; un objet conservé, vérifié avant activation. Aucun remplacement par le retry. |
| REF-03 | Confirmation commise mais réponse perdue ; au moins 20 activations suivantes sortent son événement de la première page, puis sa copie physique/métadonnée Storage est supprimée dans la fixture de faute ; rejouer la clé, puis la même clé avec autre copy_id/motif/révision | Lookup ciblé retrouve le reçu canonique exact hors pagination. Demande identique → 200/replayed, reçu initial et état courant, sans lecture obligatoire des octets ni activation/événement supplémentaire. L'ancienne référence n'est pas réactivée ; contenu différent → conflit, même si la source manque. Une nouvelle clé ne peut activer cette copie indisponible. |
| REF-04 | Source remplacée pendant préparation, puis après vérification | La copie consultée et activée est exactement celle dont le SHA est confirmé. Aucun mélange hash A/octets B ; après conservation, remplacement de l'original sans effet. |
| REF-05 | Panne download, worker, upload, lecture de contrôle ou attestation | A reste active, révision et journal inchangés. Ticket récupérable, aucune copie pending confirmable. Reprise par la même intention. |
| REF-06 | Upload réussi, processus perdu avant attestation ; attestation réussie, réponse perdue avant confirmation | Reprise inspecte l'objet réservé et vérifie réellement ses octets ; n'écrase pas l'objet. Copie verified seule n'active rien ; confirmation rejouée n'ajoute pas d'événement. |
| REF-07 | Rôle dégradé, membership supprimée, tenant suspendu, projet archivé ou version envoyée entre aperçu et confirmation | Si le changement gagne avant le contrôle verrouillé, refus sans activation. Si la confirmation gagne, son auteur/droit étaient valides à ce point ; le changement suivant bloque la prochaine mutation. |
| REF-08 | Tenant courant basculé avant la requête/avant son contrôle d'accès ; identités de tenant/acteur forgées | Tenant issu de la sélection effective des memberships, pas du payload. Refus pour l'ancien tenant au point de contrôle ; aucune réattribution de ticket ou journal. |
| REF-09 | Déplacement version→autre projet/tenant ou document→autre affaire pendant réservation/confirmation | Refus ou conflit, jamais activation d'une source dans le mauvais périmètre. Copie et historique déjà créés gardent leur périmètre, sans rebinding. |
| REF-10 | Accès direct au bucket, à une copie d'autrui, appel authentifié à l'attestation ou à la confirmation, tentative de changer hash/pages/état | Refus ACL pour anon/authenticated sur les deux RPC réservées au service. Aucune confirmation contournant le contrôle des octets du serveur. Le service avec actor_id d'un lecteur/hors tenant est également refusé par SQL, sans activation. |
| REF-11 | Copie verified physiquement absente avant confirmation ; métadonnée Storage supprimée avant commit ; panne après activation | Octets absents : route serveur refuse avant RPC. Métadonnée absente/remplacée : SQL refuse même via son appel de service autorisé. Après activation : « source indisponible », aucun fallback intake ni faux effacement de l'événement historique. Une suppression administrative des octets hors DB demeure une limite séparée. |
| COV-01 | Quantité/composition de L1 changée après lecture, avant commit de la future décision E1 | Modification gagnante → conflit ; décision gagnante → mutation suivante invalide E1. Après les deux commits, jamais ancien fait marqué à jour. Les autres exigences sans dépendance restent inchangées. |
| COV-02 | A active puis B confirmée ; revalidation avec citation vérifiée sous A | Refus. Citation B/C3 revue puis décision E4 : succès ciblé, avec historique A conservé ; états exacts de SC-04. |
| COV-03 | H1 change au moment d'une décision E7/E8 ; suppression L1/draft cascade le snapshot | Conflit ou invalidation ciblée, jamais couverture à jour sur une donnée disparue. Ancienne décision conserve faits et auteur. |
| COV-04 | Deux décisions même révision ; auteur ou liens forgés ; mutation directe hors parcours | Une décision courante gagnante, auteur réel ; rollback total sur faute. Les voies directes invalident correctement ou refusent, sans élargir les RLS. |

REF-01 à REF-11 qualifient le premier incrément. COV-01 à COV-04 sont écrits
avant le code de la tranche exigences/décisions ; ils ne bloquent pas la
livraison utile du seul parcours de référence. Les 19 cas du contrat et les
valeurs financières de l'oracle restent la recette de l'ensemble DOS-CAL-01.

## 4. Modèle de verrouillage proposé

Transactions DB courtes ; **aucun appel Storage, parsing PDF ou attente
utilisateur sous verrou DB**. Pas de verrou advisory censé protéger des
écritures existantes qui ne l'utilisent pas. L'ordre proposé est à qualifier
sur les triggers réels avant d'être arrêté dans la migration.

1. Après un précontrôle d'accès sans divulgation, dans réservation/confirmation,
   verrouiller la version, puis sa revue
   (créée paresseusement à révision 0 si absente). La version sérialise cette
   initialisation et ses changements de statut. Appliquer un délai de verrou
   borné et transformer son dépassement en conflit relisible.
2. Verrouiller pour lecture partagée le projet, le tenant actif et les lignes
   de membership de l'acteur nécessaires à l'autorisation, dans un ordre
   déterministe. Utiliser NOWAIT sur ces dépendances pour ne pas inverser
   l'ordre d'une suppression/administration déjà engagée. Relire rôle,
   appartenance, tenant courant, archivage et parents **après** acquisition ;
   ne pas réutiliser uniquement un contexte serveur lu avant l'attente.
3. Résoudre d'abord une confirmation déjà commise par sa clé et comparer sa
   demande canonique, après contrôle des droits. Son replay n'a besoin ni
   d'une copie encore disponible ni de la révision attendue encore courante.
   Pour une nouvelle activation, verrouiller ticket/copie, comparer la
   révision attendue et contrôler le statut brouillon. La réservation
   verrouille aussi le document d'origine. L'activation dépend de la copie
   immuable, pas des octets actuels de l'original. Pour cette seule nouvelle
   activation, verrouiller la ligne
   `storage.objects` attendue en `FOR SHARE NOWAIT` et vérifier identité
   d'objet, bucket, clé et taille contre la copie attestée. Une métadonnée
   absente ou remplacée refuse la nouvelle activation ; ne jamais la recréer
   en SQL pour satisfaire un replay.
   L'attestation seule verrouille le ticket et sa métadonnée Storage ; elle
   ne prend pas ensuite un verrou de version dans l'ordre inverse.
4. Ajouter activation, événement/reçu et nouvelle révision dans la même
   transaction. Aucun UPDATE/DELETE direct autorisé sur les faits immuables.
   Les révisions sont entières sûres 0..9007199254740991 ; overflow refusé.
5. Pour les futures décisions, après version/revue/exigence, lire les cibles
   et les entrées de registre par identités triées avec `FOR SHARE NOWAIT`,
   puis reconstruire les faits canoniques. L'UPDATE direct d'une ligne prend
   déjà sa ligne avant le trigger de révision parent : attendre cette ligne
   tout en tenant la version créerait un ordre inverse. NOWAIT doit donc
   produire un conflit, pas une attente circulaire. Le registre dispose
   également d'un verrou d'entrée pris par sa RPC de mutation.
6. Les mutations pertinentes postérieures invalident les seules décisions
   liées ; un garde ou une révision de dépendance doit couvrir aussi le DML
   direct autorisé. La relecture de validité contrôle les mêmes dépendances.
   Une file asynchrone d'invalidation ne constitue pas la seule autorité.

L'autorisation a un point de contrôle transactionnel : un changement déjà
commis avant ce contrôle doit être visible ; un changement concurrent qui
arrive après peut être ordonné après l'action autorisée. Ne pas promettre
qu'un changement de préférence de tenant rétroactivement annule une requête
déjà autorisée. Qualifier en particulier les relectures après attente, sans
s'appuyer sur un snapshot ou un helper STABLE calculé avant celle-ci.

Le premier incrément n'a pas besoin de verrouiller toutes les lignes du devis
ni tous les documents du projet. Les déplacements de parents d'une revue
existante doivent être refusés par la frontière de données ; la suppression
autorisée de l'affaire entière conserve son comportement défini. Aucune garde
générale des anciens modules n'est ajoutée sous prétexte de cette tranche.

La confirmation est **service-only**, pas une RPC directement utilisable par
le navigateur. Son argument d'acteur vient exclusivement de la session
vérifiée par le serveur. Comme `auth.uid()` est celui du contexte technique,
SQL résout explicitement les memberships de cet acteur, selon le même ordre
de tenant courant que le serveur, et les reverrouille/revalide. Un argument
`actor_id` n'accorde aucun droit par lui-même ; un service authentifié avec
un acteur devenu viewer ou hors tenant est refusé. Seul ce chemin serveur
combine preuve récente des octets et confirmation métier.

## 5. Tables minimales proposées pour la référence conservée

Implantation recommandée dans un schéma privé, sans DML Data API pour anon ou
authenticated. RPC publiques étroites avec ACL explicites et contrôle métier
complet ; un SECURITY DEFINER éventuel se justifie par cet accès privé, avec
`search_path` fermé. Il ne sert pas à ignorer les droits des sources.

| Ensemble proposé | Champs/contraintes minimaux | Mutabilité |
| --- | --- | --- |
| `private.estimate_source_reviews` | Identité, tenant/projet/version, version unique, révision 0 initiale, copie active nullable. Tenant/projet/version cohérents et non réattribuables. | Révision et copie active uniquement par confirmation atomique ; aucune écriture client directe. |
| `private.estimate_source_reference_copies` | `copy_id`, revue/version, acteur, clé de préparation et requête canonique ; document source et métadonnées capturées ; chemin réservé ; état `pending`/`verified` ; identité `storage.objects` attestée, SHA-256, taille réelle, pages et date de vérification quand verified. Unicité de la clé par revue et de l'objet réservé. | Ticket créé une fois ; attestation pending→verified par service seulement. Identité, objet et faits vérifiés immuables ; attestation identique rejouable, différente refusée. La référence à la métadonnée Storage ne cascade pas une suppression vers l'historique. |
| `private.estimate_source_reference_events` | Activation/reçu immuable : clé de confirmation, demande canonique, révision avant/après, ancienne/nouvelle copie, SHA revu, motif, acteur/date et nom lisible capturé. Unicité révision de revue et clé de confirmation. | INSERT atomique avec activation, jamais réécriture du passé. Reçu rejouable ; les états actuels sont relus séparément. |

La ligne copie est aussi l'intention durable de préparation : pas de quatrième
table de job générique pour ce parcours. Une copie pending issue d'une panne
reste récupérable par sa clé. Une copie verified non activée reste candidate ;
elle n'incrémente pas la révision et n'invalide aucune décision.
Les suppressions de document d'origine détachent le lien sans effacer la copie
ni ses métadonnées capturées. Les règles de purge de l'affaire entière sont
explicites ; aucun nettoyage automatique d'objet verified n'est introduit.

Bucket proposé : `estimate-source-references`, privé, sans policies de
lecture/écriture pour anon/authenticated. Objet neuf sous une clé calculée
par le serveur à partir de tenant/projet/version/copy_id, jamais un chemin
libre envoyé par le navigateur. L'application n'écrase et ne supprime aucun
objet verified. La consultation passe par une route authentifiée qui contrôle
la copie avant de la lire ; aucun lien signé durable ni URL publique exposé.

## 6. Signatures minimales proposées

Arguments UUID typés et normalisés avant comparaison de demande idempotente,
JSON de retour validé strictement côté serveur ; aucun `actor_id`, tenant,
hash de contenu ou nombre de pages du navigateur ne devient une attestation.
Les descriptions suivantes font autorité pour répartir les
travaux ; elles ne sont pas des signatures déjà installées.

| RPC proposée | Appelant et responsabilité | Retour utile |
| --- | --- | --- |
| `get_estimate_source_review(p_version_id uuid, p_copy_id uuid default null, p_before_revision bigint default null, p_limit integer default 20, p_confirmation_key uuid default null) returns jsonb` | Authenticated ; contrôle de lecture tenant/projet/version ; état courant et page d'historique, plus copie demandée si elle appartient à cette revue. Lookup de confirmation par `(revue, clé)` séparé de la pagination, borné à zéro ou un reçu grâce à l'unicité ; aucune lecture Storage requise. Limite historique 1..100, curseur explicite. Aucun état créé par GET. | `{version_id, project_id, revision, active_reference, selected_copy, history, next_before_revision, confirmation_receipt}`. Le reçu nullable contient demande canonique exacte et activation immuable, même hors de la page d'historique ; l'état courant reste distinct. Révision 0/référence null si revue absente ; accès interdit ne devient pas un reçu null. |
| `reserve_estimate_source_reference_copy(p_version_id uuid, p_document_id uuid, p_expected_review_revision bigint, p_preparation_key uuid) returns jsonb` | Authenticated ; rôle d'écriture, draft, source CCTP/PDF/uploaded de la même affaire ; réserve l'identité/objet avec état pending. Même clé et même demande → même ticket ; autre demande → conflit. | `{copy_id, version_id, review_revision, state, replayed, source_locator, destination_locator}`. Locators fournis au serveur pour copier ; retirés de la réponse applicative destinée à l'UI. Aucun droit Storage direct ne découle de leur connaissance. |
| `complete_estimate_source_reference_copy(p_copy_id uuid, p_sha256 text, p_byte_size bigint, p_page_count integer) returns jsonb` | Service technique uniquement ; atteste des octets relus et vérifiés par le serveur. Vérifie ticket, état, bornes et métadonnée Storage exacte ; capture son identité. Copie déjà verified identique → replay, valeurs différentes → refus. ACL PUBLIC/anon/authenticated révoquées. Ne change jamais la référence active. | `{copy_id, state:'verified', sha256, byte_size, page_count, verified_at, replayed}`. |
| `confirm_estimate_source_reference(p_actor_user_id uuid, p_version_id uuid, p_copy_id uuid, p_expected_review_revision bigint, p_idempotency_key uuid, p_reviewed_sha256 text, p_reason text) returns jsonb` | Service-only, ACL PUBLIC/anon/authenticated révoquées ; SQL réautorise l'acteur réel et résout le même replay canonique avant les préconditions d'une nouvelle activation. Sans reçu existant : preuve récente des octets obtenue par le serveur, copie verified/périmètre/statut/révision et métadonnée Storage contrôlés sous verrou ; SHA revu égal au SHA conservé. Activation et journal atomiques. | `{activation:{id,copy_id,revision}, current_revision, current_copy_id, replayed}`. Replay retourne l'activation initiale et l'état courant, sans réactiver une ancienne copie. |

Une référence déjà active n'est pas reconfirmée sous une nouvelle clé pour
faire avancer artificiellement la révision : refus `REFERENCE_UNCHANGED`.
Revenir explicitement de B vers une copie A conservée reste un nouvel
arbitrage motivé, avec nouvelle révision. Un replay strict est résolu avant
les contrôles de statut brouillon, de révision attendue et de disponibilité
physique, après droits et comparaison de demande. Le POST conserve son
autorisation admin ou engineer propriétaire ; une perte de ce droit ne se
contourne pas par replay. Le GET ciblé conserve les droits de lecture de la
matrice, y compris la lecture historique des versions non brouillon.

`confirmation_receipt` porte la demande canonique enregistrée (acteur réel,
version, copy_id, clé, révision attendue initiale, SHA revu et motif) et le
reçu d'activation exact. UUID et SHA sont normalisés ; le motif est comparé
après le même trim, sans réinterprétation du texte. Le serveur compare ces
valeurs typées, pas deux sérialisations JSON possiblement différentes.
L'état courant provient de la lecture actuelle, pas du reçu historique.
Le lookup ne dépend ni d'un `selected_copy` encore consultable ni du contenu
de `history` : le serveur le demande par confirmationKey seul dans la revue.

Une demande identique déjà commise retourne 200/replayed même si sa source
est désormais indisponible. Ce retour confirme l'enregistrement passé,
jamais la disponibilité présente du PDF. L'interface peut afficher ensemble
« confirmation déjà enregistrée » et « source indisponible ». Même clé avec
un contenu différent reçoit `IDEMPOTENCY_CONFLICT` avant toute tentative de
lecture du fichier. Une nouvelle intention reste refusée si sa copie manque.

Les DTO de référence/copie contiennent seulement identité, état, nom source
capturé, empreinte, taille, pages et dates utiles. Le serveur sait retrouver
la clé canonique d'une copie depuis les identités autorisées par GET ; il ne
prend jamais la clé d'objet depuis l'URL utilisateur. GET/lecture de contenu
peuvent donc servir l'historique après disparition de l'original intake.

### Frontière HTTP et traitement Storage

| Route proposée | Travail du serveur |
| --- | --- |
| `GET /api/estimates/{versionId}/source-review` | RPC de lecture ; paramètres optionnels copyId/cursor/confirmationKey validés ; lookup de reçu explicite indépendant de la page d'historique ; projection publique stricte, `no-store`. |
| `POST /api/estimates/{versionId}/source-review/copies` | Corps `{documentId, expectedRevision, preparationKey}`. Réserver, télécharger avec le client utilisateur ordinaire, vérifier le PDF dans un worker borné, écrire l'objet privé sans upsert, le relire et comparer SHA/taille/pages, puis attester avec le client de service. Réponse : copie vérifiée à consulter, jamais référence automatiquement activée. |
| `GET /api/estimates/{versionId}/source-review/copies/{copyId}/content` | Authentifier et lire la copie autorisée ; exiger verified ; lire l'objet exact via le serveur, contrôler son identité/empreinte avant de le présenter. Retour PDF privé, `no-store`, nom sûr. Copie absente/altérée → source indisponible, jamais fallback intake. |
| `POST /api/estimates/{versionId}/source-review/reference` | Corps `{copyId, expectedRevision, idempotencyKey, reviewedSha256, reason}`. Authentifier/réautoriser U, appeler le GET métier avec confirmationKey et comparer la demande canonique : reçu identique → replay immédiat, différent → conflit. Sans reçu : relire la copie autorisée, vérifier actuellement ses octets/SHA/taille, puis appeler confirm service-only avec U réel. La RPC recontrôle le replay sous verrou pour une confirmation concurrente. Aucun acteur du corps accepté. |

Un lookup null ne prouve pas qu'une demande concurrente ne va pas terminer.
Si la lecture des octets échoue après ce lookup, refaire une fois le lookup
ciblé avant de conclure à l'indisponibilité : reçu devenu présent et identique
→ replay, contenu différent → conflit, sinon refus sans nouvelle activation.
La vérification du reçu elle-même en échec reste une indisponibilité, jamais
une preuve d'absence autorisant à changer de clé ou à créer un doublon.

La limite recommandée du premier parcours reprend les 50 MiB de
[intake.ts:4](../../src/lib/affaires/intake.ts) et borne le PDF à 200 pages,
comme [l'extracteur actuel:34](../../src/lib/imports/tabular-pdf-extraction.ts).
Accepter seulement un PDF valide non chiffré dans cette tranche ; MIME et
extension ne suffisent pas. Le nombre de pages provient du parseur exécuté
dans un worker terminable, pas d'une valeur du navigateur ou de métadonnées
intake. Reprendre le délai de 15 secondes de l'extracteur actuel et terminer
réellement le worker à son dépassement. Proposer un plafond de heap V8 de
256 MiB pour ce worker, à qualifier avant le code, sans le présenter comme
un plafond RSS du processus entier ; l'entrée est bornée à 50 MiB et transférée
sans clone inutile. Timeout ou dépassement mémoire refuse la préparation,
sans activation ni chute du serveur. Un simple `Promise.race` sur le thread
serveur ne suffit pas. Ce parcours compte les pages sans prétendre extraire
toutes les exigences ni mesurer l'exhaustivité de l'analyse.

La préparation en reprise inspecte d'abord l'objet réservé s'il existe. Elle
ne le remplace pas par une nouvelle lecture de l'original. Elle vérifie ses
octets avant attestation ; une incohérence rend cette intention inutilisable
et demande une nouvelle préparation explicite. La clé et les métadonnées de
préparation sont conservées avant le POST afin de retrouver le même ticket
après perte de réponse. Le stockage local ne contient aucun PDF ni secret.

Il n'existe pas de transaction atomique entre Storage et la base : un upload
peut laisser un objet pending sans activation. La confirmation publie
uniquement un ticket vérifié ; l'immutabilité des copies ordinaires empêche
leur remplacement entre vérification et commit. `verified` décrit une
attestation passée, pas une disponibilité actuelle : la route relit les
octets et SQL verrouille/contrôle leur métadonnée. Ce verrou de métadonnée ne
verrouille pas physiquement le stockage d'objets. Une panne de stockage ou
une suppression privilégiée hors application après ce contrôle peut rendre
la source indisponible : l'interface le dit, et l'événement historique ne
prétend pas annuler rétroactivement l'opération. Ne pas annoncer une garantie
contre la destruction administrative des octets.

### Erreurs et partage du travail

Proposer un préfixe unique `SOURCE_REVIEW_` pour les codes publics :
`STALE`, `BUSY`, `IDEMPOTENCY_CONFLICT`, `COPY_NOT_VERIFIED`,
`REFERENCE_UNCHANGED` → 409 ; `SOURCE_UNAVAILABLE` → 409 si absence établie,
503 si lecture temporairement impossible ; PDF invalide/hors limites → 422 ;
input invalide → 400 ; absence non divulguée → 404 ; droit refusé → 403.
Authentification absente → 401. Seules les erreurs attendues sont exposées,
jamais le texte SQL ou la clé Storage. Nouvelle opération réussie → 201,
replay → 200. Aucune erreur n'autorise à afficher une référence active fictive.

| Lot de travail après accord sur ce plan | Livraison et preuve attendues |
| --- | --- |
| Migration/RLS | Tables privées, 4 RPC, ACL, invariants de parents et idempotence ; fixture native écrite d'abord, puis REF-01/03/07/08/09/10 et rollback indépendant. Aucun apply persistant sans accord du root sur le candidat et la pile locale. |
| Serveur/Storage | 4 routes, vérification PDF/copie bornée, projection sûre, erreurs et reprise ; contrats OpenAPI ; fautes REF-02/04/05/06/11 avec traces sans secrets. |
| Interface/E2E | Aucune référence initiale → préparer A → consulter → confirmer → reload ; B préparée laisse A active → B confirmée remplace A avec historique ; erreurs et rôles de la matrice. TesterArmy ordinaire, hashes réels et trois pages de l'oracle. |
| Tranche suivante | Exigence/citation/périmètre, liens et décisions sur copy_id immuable ; régressions COV-01 à COV-04 écrites avant leur code. Aucun nouveau modèle d'hypothèse. |

Chaque artefact futur conserve commande, source/build, pile exacte, acteurs
et alias→UUID, attentes/résultats, objets et empreintes, événements/révisions
avant/après. La preuve SQL, la preuve Storage et la preuve navigateur restent
distinctes. Une fonction absente avant implémentation est une capacité
manquante, pas une course reproduite ; un setup échoué n'est pas un PASS.

## Complément HTTP après les preuves natives

Préparation du 12 octobre 2026, avant ces parcours HTTP. Les 34 cas natifs
et les huit courses qualifient les règles SQL et leur concurrence ; ils ne
prouvent pas la chaîne cookie de login → acteur transmis par Next → RPC,
ni la lecture physique du PDF sous chaque identité. La campagne métier à
onze parcours ne remplace pas cette matrice d'accès. Le présent complément
ne vaut ni exécution ni autorisation de modifier une ancienne fixture.

### Parcours complémentaires et assertions

Dans ce tableau, `R` désigne `/api/estimates/{versionId}/source-review`,
`Q` désigne `R/requirements`, et « reçu exact » signifie même acteur,
version, clé, corps canonique et événement, avec `replayed:true`.

| Parcours | Actions réelles et attentes HTTP | Conservation à constater |
| --- | --- | --- |
| HTTP-01 — Session et acteur | Login UI de l'engineer propriétaire ; créer une exigence, vérifier sa citation puis décider par les vraies routes. Chaque nouvelle mutation répond 201, avec acteur du reçu et de l'historique égal au compte connecté. Requête autrement valide sans session : GET et POST → 401 `UNAUTHORIZED`. Ajouter `actorId` ou `tenantId` au corps public → 400 `SOURCE_COVERAGE_INVALID_INPUT`. Engineer non-propriétaire du même tenant : GET, aperçu et mutation → 404 `SOURCE_COVERAGE_ACCESS_DENIED`. | Pour chaque refus, aucun événement, changement de révision, citation, lien ou décision. Les lectures ne créent pas une revue vide. Les réponses d'erreur ne contiennent ni locators ni détails SQL. |
| HTTP-02 — Lecteurs, écrivains et PDF | Admin membre : lecture et mutation autorisées sur le dossier de l'engineer. Un compte lecteur neuf passe d'engineer non-propriétaire à director, puis viewer, par `POST /api/tenants/memberships` avec `action:set-role`, depuis l'admin de fixture. Director : GET/aperçu et `R/copies/{copyId}/content` → 200 sur le dossier d'autrui ; mutation et replay d'écriture → 403 `SOURCE_COVERAGE_WRITE_FORBIDDEN`. Viewer : mêmes lectures 200 sur son propre dossier, écritures 403 ; dossier d'autrui → 404. Demander sur une version un copyId appartenant à une autre version accessible → 404 `SOURCE_REVIEW_ACCESS_DENIED`. Chaque PDF autorisé a le SHA, la taille et les octets attendus. | Aucun changement métier lors des lectures/refus. Les seuls changements de rôle attendus ciblent le nouveau lecteur ; l'admin de fixture reste admin. La perte du droit d'écriture interdit aussi le replay, sans effacer la décision passée. Le contrôle PDF porte sur la route applicative authentifiée, pas sur un droit Storage direct inventé. |
| HTTP-03 — Tenant actif | Nouvel admin réellement membre de T1 et T2. Depuis T1, obtenir un reçu ; basculer vers T2 par `POST /api/tenants/memberships` avec `{action:"set-default",membership_id:<adhésion T2>}`. Les deux adhésions sont admin, condition imposée par la RPC existante. Sous T2, GET Q, aperçu et replay connu de T1 → 404 `SOURCE_COVERAGE_ACCESS_DENIED` ; PDF T1 → 404 `SOURCE_REVIEW_ACCESS_DENIED`. Revenir explicitement à T1 : lecture 200 et replay exact 200, sans nouvelle mutation. | Identités d'acteur et tenant actif relevées après chaque bascule ; mêmes événements/révisions et octets de T1 avant/après. Seul le choix par défaut des deux nouvelles adhésions change. Aucun faux switch par header, JWT ou contexte mocké. |
| HTTP-04 — Version non brouillon | Sur une sœur dédiée, créer par les routes ordinaires les reçus à rejouer. Acquérir le vrai verrou puis `PATCH /api/estimates/{id}/status` avec corps exact `{status:"sent"}`, `If-Match` courant et session de verrou réelle. Exiger 200 puis statut `sent` relu. GET Q/aperçu/PDF restent 200. Nouvelle mutation dimension ou exigence → 409 `SOURCE_COVERAGE_STALE` ; nouvelle vérification de citation ou décision → 403 `SOURCE_COVERAGE_WRITE_FORBIDDEN`. Les quatre types de reçu déjà acquis restent rejouables en 200 par leur écrivain toujours autorisé. | Après la transition canonique, figer une nouvelle base de comparaison : chaque refus/replay conserve les événements, révisions et décisions, ainsi que les lignes, heures, montants et snapshot scellé. Le replay ne remet pas la version en brouillon. Un échec du verrou, du gating ou de la génération PDF laisse ce sous-cas non qualifié ; aucun UPDATE SQL de statut ni `force:true` pour le faire passer. |
| HTTP-05 — Copie physiquement supprimée | Sur une fixture distincte, préparer/confirmer une copie et obtenir un reçu de citation et de décision par les routes ordinaires. Puis supprimer **uniquement son objet privé neuf** par une faute administrative locale explicitement autorisée et bornée. Prouver l'absence par une vraie lecture Storage, pas seulement par suppression de `storage.objects` ni interception navigateur. `R/copies/{copyId}/content` → 409 `SOURCE_REVIEW_SOURCE_UNAVAILABLE` ; nouvelle citation/décision avec révisions courantes et nouvelle clé → 409 `SOURCE_COVERAGE_SOURCE_UNAVAILABLE`. Les reçus exacts antérieurs restent 200, sans lecture obligatoire des octets ; même clé/autre contenu → 409 `SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT`. | L'original intake reste présent et identique : aucun fallback ne doit le servir. L'événement historique et la référence active ne sont pas supprimés par un échec de lecture. Seuls l'objet fauté et sa métadonnée peuvent disparaître ; chaque POST refusé/rejoué laisse la base métier inchangée. Un échec de transport Storage est une indisponibilité 503, pas une preuve de suppression ni un PASS pour l'absence physique. |

Les réponses applicatives, y compris les erreurs, portent
`Cache-Control: private, no-store`. Pour les PDF 200, comparer octets,
`Content-Length` et `X-Source-Reference-Sha256`, sans confondre succès HTTP
avec attestation de lecture humaine. Les assertions 403/409 ci-dessus
reflètent les chemins actuels distincts de mutation ; ne pas les remplacer
par une assertion vague « statut non 200 ».

### Fixtures, login et preuves

Le minimum est deux tenants et trois comptes **neufs** : un engineer
propriétaire, un admin des deux tenants, et le lecteur évolutif propriétaire
d'un second dossier. Prévoir des versions séparées pour l'identité, les
rôles, la transition `sent` et la faute Storage ; conserver un dossier témoin
sans mutation. Provisionner les comptes sur la seule pile locale autorisée
avec confirmation Auth administrative sans invitation ni email. Les rôles
et adhésions de comptes historiques restent inchangés.

Chaque identité utilisée par l'application passe ensuite par `/login`,
avec ses propres identifiants conservés dans l'env ignoré. Les appels HTTP
utilisent les cookies issus de ce login ordinaire ; aucun JWT, cookie de
session ou acteur serveur n'est injecté. Le service de provisioning ne
sert pas aux appels applicatifs de recette. Référence, exigences, citations
et décisions sont créées par les vraies routes, sans seed d'état final.
Le lecteur crée son reçu sur son propre dossier lorsqu'il est encore
engineer ; rejouer ce reçu après rétrogradation teste ainsi une vraie
intention antérieure du même acteur, et non celle d'un autre compte.

Conserver les commandes, profils/SHA, source/build et origine locale exacte,
alias des comptes/tenants/versions, statuts/codes, reçus, événements et
révisions avant/après. Les empreintes des lignes, heures, montants et du
dossier témoin permettent d'isoler l'effet attendu de chaque opération.
Pour la faute Storage, archiver le contrôle d'octets avant et le constat
d'absence après, sans secret. Le reçu de replay constate un enregistrement
passé ; il ne rétablit ni la disponibilité du PDF ni les droits révoqués.

### Réemploi du runner et exception de statut bornée

Ajouter les scénarios dans
`e2e/army/local/source-coverage-access.e2e.ts`, en réutilisant
`apiRequest`, `recordEvidence`, le login et les gardes du runner actuel.
Un champ de profil explicite `scenarioSet: "business" | "access"` suffit
pour sélectionner les fichiers et les titres attendus du qualificateur ;
le mode `business` conserve ses onze parcours et son setup de login.
Le mode `access` dispose de sa liste complète attendue, sans filtre caché,
skip assimilé à un succès ni revendication de qualification métier globale.
Réutiliser profils épinglés, build, garde réseau, archives et scan des
secrets ; ajouter les identifiants nommés des seuls nouveaux comptes.
Aucun runner, serveur ou mécanisme d'authentification supplémentaire.

`restrictCriticalBrowser` bloque actuellement toute mutation `/status`.
L'exception à préparer concerne **seulement** `scenarioSet:access`, l'origine
applicative autorisée, la méthode PATCH, le chemin exact de la sœur `sent`
identifiée dans la fixture épinglée, aucun query parameter et le JSON strict
`{status:"sent"}`. Vérifier cette requête avant `route.continue()` et
conserver sa réponse réelle ; le serveur garde ses contrôles de verrou et
de concurrence. Ne pas autoriser `/status` globalement, une autre version,
un autre statut ou un corps contenant `force`.

Cette route de statut appelle freeze/scellement/génération PDF ; elle
n'appelle pas `sendEstimateEmail`. `/send`, `/email-dispatch`, invitations,
portail et fournisseurs d'email restent bloqués. La garde réseau serveur
reste limitée aux deux origines locales autorisées. Cette exception de
recette n'autorise aucun email et n'est pas encore implémentée par le
présent document. Aucun de ces parcours n'est déclaré qualifié avant son
archive terminale et sa relecture indépendante.
