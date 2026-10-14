# DOS-CAL-01 — Contrat préalable de la référence conservée

Préparé le 11 octobre 2026, **avant code HTTP, Storage et interface**. Ce
document rend exécutable le premier parcours du [plan d'accès](source-coverage-access-plan.md)
et du [contrat produit](../product/source-coverage-contract.md). Il ne remplace
ni leur matrice de droits ni l'[oracle calorifuge](source-coverage-oracle.md).
Les quatre routes ci-dessous sont proposées, pas livrées. Aucun code produit,
OpenAPI, PDF, seed, bucket ou migration n'est créé par cette préparation.

État du 12 octobre : migration locale et huit courses natives qualifiées,
worker PDF intégré et 17 tests spécialisés passés. Les routes et octets
Storage restent en cours ; le [journal de progression](../product/progress-chiffrage-2026-10-11.md)
porte les reçus et limites actuels. Les paragraphes de préparation ci-dessous
conservent leur contexte initial ; ils ne remplacent pas ces preuves datées.

Le résultat attendu est précis : consulter une copie privée vérifiée d'un
CCTP, puis choisir explicitement cette copie comme référence d'une version
de devis. Préparer B laisse A active. Ni le fichier principal de l'intake,
ni une copie vérifiée, ni l'ouverture du lecteur ne confirme une référence.
Exigences, citations, périmètres et décisions de couverture restent la
tranche suivante ; aucun prix, quantité, heure ou export n'est modifié ici.

## 1. Preuve acquise et limites

Dernières archives natives effectivement relues dans
`.e2e/source-coverage/reference-native/` :

| Artefact | Résultat vérifié |
| --- | --- |
| `2026-10-11T20-48-08-560265Z-candidate.json` | 44 cas, 44 `passed:true`, `allPassed:true`. Exécution dans un seul DO avec rollback terminal P9001 ; le code CLI 1 correspond à cette annulation attendue, pas à un lancement ordinaire réussi. |
| `2026-10-11T20-48-30-617250Z-verify.json` | Contrôle indépendant : zéro acteur, tenant, projet, objet synthétique, table, RPC et helper du candidat. |
| `candidate-body.sql` | SHA-256 `5005b5978604b52ddc8f31fb85b961f56c9da041b239910cb87ea1bc7392a659`. |
| Résultat 20:48:08 | SHA-256 `5cc82443beb7a666ebfbb3cb54ada48685700a7e7097a5b6c10a7162c3bd4c4f`. |
| Vérification 20:48:30 | SHA-256 `6ff245560d02f3be99b3d9bea38f7807633ac4dc96828ac75dfe543e1a683fbd`. |
| Assertions après adaptation du setup Storage | SHA-256 `b01add460606727524996e3dd88241298facdb08230ad192301f4337a0b8ce6b`. Le premier RED de capacités absentes avait précédé le candidat ; les adaptations de setup sont décrites dans le README natif. |

Le manifeste voisin archive la commande `supabase db query --local`, la
pile loopback `http://127.0.0.1:59827`, la révision source
`ce5874f54f8202297b74e4ed238e5c48e49d2f1b` et les changements locaux. Cette
preuve qualifie des assertions SQL séquentielles, les rôles DB et des
métadonnées Storage synthétiques. Elle porte explicitement
`physicalStorageProof:false` et `concurrencyExecuted:false`. Aucun octet
PDF, login navigateur, worker, route HTTP ou concurrence entre connexions
n'est qualifié. Le candidat a été annulé : les routes futures ne peuvent
pas supposer ses RPC installées. Le bucket devra être provisionné par
l'API Storage, privé et sans policy client permissive, séparément.

## 2. Autorité, sessions et identités

Utiliser la session ordinaire du navigateur et le tenant actif réel. Le
serveur ne prend jamais un acteur, tenant, projet, chemin ou bucket depuis
le corps utilisateur. Chaque requête réautorise ses identités ; une ancienne
réponse GET, un UUID connu ou une clé d'idempotence n'accorde aucun droit.

Lecture : propriétaire, admin ou director avec membership réelle du tenant
courant actif. Un viewer propriétaire peut lire. Écriture : admin, ou
engineer propriétaire. Aucun raccourci d'admin global sans membership.
Affaire archivée : refus. Version non brouillon : lecture historique
autorisée ; nouvelle préparation/activation refusée. Un replay strict reste
possible avec les droits d'écriture actuels, avant le contrôle de statut.
Un acteur rétrogradé peut encore lire selon ses droits ; il ne rejoue plus
une confirmation par POST. Voir la matrice complète du plan d'accès.

La référence utilise sa propre révision de revue, indépendante de
`estimate_versions.updated_at`, de `content_revision` et du verrou de page
de l'éditeur. Le candidat SQL n'exige pas `draftLockSessionId` : ne pas
inventer ce prérequis dans les routes. Deux onglets autorisés peuvent préparer
des copies ; `expectedRevision` et la transaction de confirmation arbitrent
leurs décisions. Cela ne qualifie pas les autres mutations de l'éditeur.

UUID normalisés en minuscules, SHA-256 hexadécimal minuscule, révisions entières
sûres 0..9007199254740991. Motif trim, 1..1000 caractères. La préparation et
la confirmation ont **deux clés UUID distinctes**, créées avant leur premier
POST. Une même clé conserve exactement son acteur, sa cible et son contenu.
Changer de clé après un timeout n'est pas une stratégie de reprise.

## 3. Routes et DTO publics exacts proposés

Toutes les réponses JSON utilisent `{ok:true,data:T}` ou
`{ok:false,error:{code,message}}`, sans `details` SQL ni locator. Les DTO
sont projetés explicitement et validés à l'entrée/sortie. Les paramètres
inconnus sont refusés, les nombres non finis/fractionnaires ou hors limites
aussi. Corps JSON borné à 8 KiB avant parsing. Les réponses, y compris
erreurs, portent `Cache-Control: private, no-store` ; aucune revalidation
conditionnelle ne dispense d'authentifier et de contrôler les octets.
Les POST authentifiés par cookie vérifient aussi l'origine autorisée et
refusent les corps non JSON ; les protections des Server Actions ne sont
pas supposées s'appliquer automatiquement à ces Route Handlers. Aucun CORS
permissif avec credentials n'est ajouté.

```ts
type Copy = {
  copyId: string;
  fileName: string;
  createdAt: string;
} & (
  | { state: "pending"; sha256: null; byteSize: null; pageCount: null; verifiedAt: null }
  | { state: "verified"; sha256: string; byteSize: number; pageCount: number; verifiedAt: string }
);
type Activation = { id: string; copyId: string; revision: number };
type ReferenceResult = {
  activation: Activation;
  currentRevision: number;
  currentCopyId: string | null;
  replayed: boolean;
};
type ConfirmationRequest = {
  copyId: string;
  expectedRevision: number;
  idempotencyKey: string;
  reviewedSha256: string;
  reason: string;
};
type Review = {
  versionId: string;
  projectId: string;
  revision: number;
  activeReference: Copy | null;
  selectedCopy: Copy | null;
  history: Array<{
    id: string; copyId: string; previousCopyId: string | null; revision: number;
    reason: string; actorId: string; actorName: string | null; occurredAt: string;
  }>;
  nextBeforeRevision: number | null;
  confirmationReceipt: {
    canonicalRequest: ConfirmationRequest & { actorId: string; versionId: string };
    activation: Activation;
  } | null;
};
```

La copie active est nécessairement `verified`. `pageCount` est entier
1..200, `byteSize` entier 1..52428800. Les dates sont des timestamps ISO
valides sans perte de leur identité temporelle. Un GET de revue absent
renvoie révision 0, références nulles, historique vide et reçu null ; il
n'insère aucune ligne. Une erreur de lecture ne devient jamais cet état.
L'historique SQL expose l'identité de copie, pas son nom capturé : pour
consulter cette copie, utiliser `copyId`, sans inventer un champ non fourni.

| Route | Entrée | Succès public |
| --- | --- | --- |
| `GET /api/estimates/{versionId}/source-review` | Query facultative `copyId:UUID`, `cursor:entier 1..MAX_SAFE_INTEGER`, `limit:entier 1..100` (défaut 20), `confirmationKey:UUID`. `cursor` est une révision exclusive, pas un offset. | 200, `Review`. `confirmationReceipt` est recherché séparément de la page et de `selectedCopy`. |
| `POST /api/estimates/{versionId}/source-review/copies` | `{documentId:UUID, expectedRevision:entier, preparationKey:UUID}`. Aucun PDF dans ce corps. | 201 si nouvelle intention, 200 si reprise : `{versionId,reviewRevision,copy:CopyVerified,replayed}`. `reviewRevision` est la lecture autorisée en fin de préparation, pas un verrou ni une révision automatiquement acceptée par l'humain. |
| `GET /api/estimates/{versionId}/source-review/copies/{copyId}/content` | Identités de route seulement. | 200, octets PDF intégralement vérifiés avant émission ; MIME `application/pdf`, `nosniff`, nom sûr dans `Content-Disposition:inline`, longueur exacte, `X-Source-Reference-Sha256` correspondant à ces octets. Aucun JSON de succès ni URL Storage. Première tranche : réponse complète, `Accept-Ranges:none`, pas de 206/304 non vérifié. |
| `POST /api/estimates/{versionId}/source-review/reference` | `ConfirmationRequest`, sans `actorId`. | 201 nouvelle activation, 200 replay : `ReferenceResult`. L'activation reçue et l'état courant restent distincts. |

`CopyVerified` désigne la branche `state:"verified"` de `Copy`. `replayed`
sur la préparation décrit la réutilisation de l'intention réservée, même si
ce retry termine une attestation auparavant interrompue. Une préparation
échouée n'est pas un faux succès pending : le client reprend le même corps.

Correspondance des RPC du candidat, sans nouvelle capacité privilégiée :

| Travail | RPC / frontière |
| --- | --- |
| Lecture | `get_estimate_source_review(versionId,copyId,cursor,limit,confirmationKey)`, client utilisateur. Projection snake_case → camelCase des seuls champs ci-dessus. |
| Réservation | `reserve_estimate_source_reference_copy(versionId,documentId,expectedRevision,preparationKey)`, client utilisateur. `source_locator` et `destination_locator` restent exclusivement dans le serveur applicatif ; le navigateur authentifié peut appeler cette RPC directement mais n'obtient aucun droit sur le bucket privé. |
| Attestation technique | `complete_estimate_source_reference_copy(copyId,sha256,byteSize,pageCount)`, service serveur seulement, arguments calculés sur les octets relus. |
| Confirmation | `confirm_estimate_source_reference(actorSession,versionId,copyId,expectedRevision,idempotencyKey,reviewedSha256,reason)`, service serveur seulement. L'acteur provient de la session réellement vérifiée. |

## 4. Préparation, octets et consultation

1. Réautoriser l'écriture ; réserver par la vraie RPC. Contrôler strictement
   les locators reçus : bucket source attendu, chemin intake des identités
   autorisées, destination exacte dérivée des UUID tenant/projet/version/copie.
   Aucun URL libre, redirection externe ou chemin utilisateur à télécharger.
2. Chercher d'abord l'objet réservé. S'il existe, reprendre **cet objet**,
   jamais le remplacer depuis l'original. Une panne de lecture ne prouve
   pas son absence. Une incohérence refuse l'intention, sans upsert.
3. S'il est réellement absent et le ticket pending, lire la source avec le
   client utilisateur. Compter les octets effectivement lus, avec abandon
   du flux au dépassement ; ne pas se fier au MIME ou à `Content-Length`.
   Valider un vrai PDF non chiffré. Calculer SHA-256, taille et pages sur les
   mêmes octets, puis upload service sur l'objet neuf avec `upsert:false`.
4. Relire l'objet privé et vérifier le triplet SHA/taille/pages contre les
   octets uploadés avant attestation. En cas de conflit d'upload concurrent,
   relire et vérifier l'objet gagnant réservé, sans l'écraser ni affirmer
   que les octets temporaires du perdant sont ceux de la copie.
5. Attester seulement après succès. Relire via GET métier la copie autorisée
   pour projeter la réponse. Aucune activation, événement de confirmation ou
   modification de prix à cette étape. Une perte de droits pendant le travail
   peut laisser une copie technique ; elle n'autorise ni sa réponse au mauvais
   lecteur ni une confirmation ultérieure.

PDF : limite de 50 MiB et 200 pages ; parser dans un worker terminable, avec
délai de 15 s et `maxOldGenerationSizeMb:256` (ancienne génération V8).
Ce dernier n'est pas un plafond de heap total, de RSS, de buffers externes
ni une limite globale pour plusieurs requêtes. Réutiliser les
principes du [worker existant](../../src/lib/imports/tabular-pdf-extraction.ts),
sans lancer d'extraction de clauses, OCR ou modèle pour compter les pages.
Transférer l'`ArrayBuffer` au worker puis retransférer les mêmes octets en
retour avec le résultat borné ; calculer le hash et uploader ces octets
récupérés. Vérifier le hash avant/après dans la recette. Ne pas garder deux
clones de 50 MiB par confort, ni reconstruire le PDF avec un serializer.
`inspectTakeoffPdfBytes` dans
[pdf-validation.ts](../../src/lib/takeoff/pdf-validation.ts) appelle `pdf-lib`
sans worker : le réutiliser directement sur le thread serveur ne satisfait
pas ce contrat. Une primitive commune est possible si son contrat reste
cohérent ; aucune refonte de l'extraction tabulaire n'est requise.
Le dépassement doit terminer le worker et libérer ses ressources ; un
`Promise.race` sur un parseur CPU exécuté dans le thread serveur ne suffit pas.
Prévoir un budget absolu proposé de 60 s pour la préparation, 30 s pour
consultation/confirmation, avec abort des transferts ; qualifier leur
compatibilité avec l'hébergement avant de déclarer une preuve déployée.
Les tests enregistrent le worker terminé, pas seulement le timeout HTTP.

Le service ne lance pas plusieurs parsers simultanés pour une même requête.
La capacité globale en requêtes, mémoire et stockage reste une qualification
distincte : ces bornes par requête ne prouvent pas une résistance à la charge.
La copie verified absente ne doit jamais être recréée sous la même identité,
même si l'original semble identique ; préparer explicitement une nouvelle copie.

La consultation authentifie et demande `selectedCopy` à la RPC, exige verified,
puis lit le chemin canonique privé et vérifie les octets contre SHA/taille/pages.
Elle ne retombe jamais sur l'intake. Nom de fichier échappé dans le DOM et
assaini pour les en-têtes ; aucun contenu PDF/interprétation de nom n'est une
instruction applicative. Le lecteur ne recharge pas de ressource externe au
nom du serveur. Aucun jeton service ni lien signé durable au navigateur.

**Limite exacte du candidat** : son DTO public ne retourne pas
`storage_object_id`. Le serveur HTTP peut contrôler chemin canonique et faits
des octets ; il ne peut pas comparer lui-même cet identifiant à l'attestation
via ce GET. La confirmation SQL compare déjà l'identité Storage capturée sous
verrou. Ne pas prétendre qu'un contrôle HTTP d'ID a eu lieu, ni contourner les
ACL privées pour l'obtenir. Si ce contrôle devient requis aussi pour la
consultation, prévoir une capacité serveur dédiée et ses tests avant son code.

## 5. Confirmation et reprise exacte

L'interface affiche nom capturé, pages, empreinte et référence actuelle ; elle
ouvre la copie conservée. Elle exige une confirmation explicite et un motif.
La réponse de lecture seule ne prouve pas qu'une personne a compris le PDF.
`reviewedSha256` désigne la copie montrée ; il n'est pas une attestation du
navigateur. SQL compare cette valeur à celle calculée par le serveur.

Après authentification et contrôle du rôle d'écriture, la route normalise le
corps puis appelle le GET par `confirmationKey` **avant toute lecture de PDF**.
Comparer tous les champs canoniques typés, y compris acteur réel et version :

- Reçu présent, demande différente : conflit d'idempotence immédiat.
- Reçu présent, demande identique : rappeler la RPC de confirmation sans
  lire Storage, pour conserver sa réautorisation SQL verrouillée et obtenir
  l'activation initiale avec l'état courant. Aucun événement supplémentaire.
- Reçu absent : lire la copie autorisée, vérifier actuellement ses octets,
  puis confirmer par RPC service-only. SQL vérifie de nouveau droits, replay,
  statut, révision, copie et identité Storage avant activation atomique.
- Si les octets deviennent indisponibles après un lookup absent, refaire
  exactement une fois le lookup ciblé : un reçu concurrent identique permet
  le replay sans octets ; un reçu différent impose conflit ; absence confirmée
  impose indisponibilité. Lookup en panne reste une erreur, jamais une absence.

La révision initiale attendue et la clé sont conservées lors du retry. Ne pas
remplacer `expectedRevision` par la révision courante pour faire réussir une
ancienne intention. Après un vrai conflit, présenter le nouvel état et
demander un nouvel arbitrage explicite avec une nouvelle clé. Une même copie
active confirmée sous une nouvelle clé est refusée (`REFERENCE_UNCHANGED`).
Revenir de B à une copie A encore disponible est un nouvel arbitrage motivé.

La préparation et la confirmation ne sont pas une transaction DB+Storage.
Le verrou SQL protège les métadonnées, pas les octets d'un stockage externe.
Une suppression administrative après activation peut rendre la source
indisponible ; l'événement historique reste exact et ne disparaît pas.

## 6. Erreurs publiques et reprise de session

| Situation | HTTP / code public proposé | Effet attendu |
| --- | --- | --- |
| Session absente | 401 `UNAUTHORIZED` | Aucun appel service ni octet divulgué. |
| Identité absente/inaccessible ; SQL `SOURCE_REVIEW_ACCESS_DENIED` | 404 `SOURCE_REVIEW_ACCESS_DENIED` | Message générique sans confirmer l'existence de la ressource. Une ancienne lecture ordinaire peut aussi produire 404. |
| Rôle lecteur sur une mutation d'une ressource visible | 403 `SOURCE_REVIEW_WRITE_FORBIDDEN` | Pas de réservation ni replay POST ; lecture selon droits maintenue. |
| Query/JSON invalide | 400 `SOURCE_REVIEW_INVALID_INPUT` ; corps trop grand 413 | Aucun effet. Refuser notamment actor/tenant/path/hash d'attestation/pages forgés. |
| Source non CCTP/PDF/uploaded ou PDF invalide/chiffré/hors limites | 422 `SOURCE_REVIEW_INVALID_SOURCE` ou `SOURCE_REVIEW_PDF_LIMIT_EXCEEDED` | A inchangée ; aucun ticket pending activable. |
| Révision/statut changé, contention, copie pending, même référence, clé réutilisée différemment | 409 `SOURCE_REVIEW_STALE`, `SOURCE_REVIEW_BUSY`, `SOURCE_REVIEW_COPY_NOT_VERIFIED`, `SOURCE_REVIEW_REFERENCE_UNCHANGED`, `SOURCE_REVIEW_IDEMPOTENCY_CONFLICT` | Reprise lisible ; aucun fallback ni activation implicite. |
| Copie absente ou faits différents, absence établie | 409 `SOURCE_REVIEW_SOURCE_UNAVAILABLE` | Afficher « Source indisponible » ; ne pas effacer le reçu historique. |
| Timeout transfert, panne Storage/DB/worker ou attestation temporairement impossible | 503 `SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE` | Conserver la même intention et proposer Réessayer. |
| Révision maximale atteinte | 409 `SOURCE_REVIEW_REVISION_OVERFLOW` | Refus sans débordement ni révision réinitialisée. |
| Bug inattendu / DTO RPC incohérent | 500 `INTERNAL_ERROR` | Message générique, log serveur expurgé ; aucune réponse vide de substitution. |

Mapper seulement les messages SQL connus ; ne pas renvoyer le message DB,
`hint`, SQLSTATE, clé Storage ou trace. Une faute injectée ne doit pas apparaître
comme un nouveau code métier arbitraire. Le document décrit la cible HTTP ;
les codes SQL du candidat restent ceux du plan natif.

Avant POST, mémoriser l'intention dans `sessionStorage` sous une clé incluant
utilisateur, tenant et version. Conserver IDs, corps exact et état de reprise,
jamais PDF, cookies, credentials ou URL signée. Un rechargement du même onglet
reprend la même clé. Le changement de compte/tenant/version ne réutilise pas
cet état ; les réponses tardives de l'ancien contexte sont ignorées.

**Frontière de récupération de cette tranche** : le candidat ne fournit pas
de liste des préparations inactives par utilisateur, ni de lookup par clé de
préparation dans GET. Si l'onglet et son stockage de session sont perdus, une
copie inactive peut ne plus être retrouvable dans l'interface ; seules
référence active et histoire restent accessibles. Ne pas annoncer de reprise
inter-appareils ou de récupération exhaustive. Une future liste bornée des
intentions exigera son contrat de droits et ses tests ; pas d'endpoint de test
privilégié pour la simuler. Une panne de sessionStorage doit être signalée
avant mutation comme reprise après reload indisponible, sans fausse garantie.

## 7. Échecs observables à écrire avant chaque implémentation

TesterArmy avec login ordinaire et assertions HTTP/octets est prioritaire.
Les injections de faute passent par le harness local contrôlé ; aucune route
de panne ou autorisation spéciale dans le produit. Les objets PDF existent
réellement via Storage API ; les métadonnées SQL synthétiques ne les remplacent
pas. Les sondes de privilèges et courses natives restent distinctes.

| ID | Parcours / faute | Assertions obligatoires |
| --- | --- | --- |
| SR-01 | GET version neuve, pagination limite 1/20/100, curseur frontière et invalide | État initial exact, zéro revue créée ; ordre décroissant sans doublon ; paramètres hors bornes refusés ; erreurs DB distinctes du vide. |
| SR-02 | Chaque acteur de la matrice contre GET, préparation, contenu, confirmation et accès Storage direct | Statuts attendus, aucun nom/locator/octet hors droits ; anon/authenticated refusés pour attestation et confirmation RPC directes ; service avec acteur lecteur refusé. |
| SR-03 | Préparer A puis GET avant confirmation | Copie verified réelle, SHA/taille/3 pages égaux au fichier de fixture ; révision 0, active null, zéro événement ; objet privé sans upsert. |
| SR-04 | Consulter A, confirmer, perdre réponse puis rejouer | Révision 1, un événement, acteur de session ; même ID d'activation au retry ; 201 puis 200 ; aucune seconde activation. |
| SR-05 | Déposer/préparer B de même nom, consulter puis confirmer B | A reste active pendant préparation ; contenu A/B distingué par SHA réel et clause C1 ; B devient active seulement après confirmation, révision 2, historique A lisible. |
| SR-06 | Remplacer/renommer/supprimer l'original après conservation | Contenu conservé et nom capturé de A inchangés ; aucun fallback vers B ; relire et comparer les octets téléchargés, pas seulement metadata. |
| SR-07 | Fautes download, parsing, upload, readback, attestation ; crash après upload | Référence/révision/journal inchangés ; même clé retrouve même copie ; reprise lit l'objet existant ; conflit de preuve refusé sans overwrite. Chaque point de faute porte sa preuve, pas un échec générique unique. |
| SR-08 | 0 page/invalide/chiffré, 200/201 pages, octets à la limite et au-delà, taille déclarée trompeuse, worker bloqué/échec | Bornes effectives ; worker réellement terminé ; octets retransférés de même taille/hash ; serveur répond encore ; aucune attestation/activation sur échec. Heap n'est pas présenté comme RSS. |
| SR-09 | Copie pending, bytes absents avec metadata présente, bytes altérés à taille égale, metadata remplacée/supprimée | Consultation et nouvelle activation refusées ; SHA détecte même taille ; SQL détecte identité metadata changée. Post-activation : histoire conservée, UI source indisponible. |
| SR-10 | Ancien reçu sorti de la page après au moins 20 activations ; copie ensuite indisponible | Lookup par clé retrouve le reçu sans `selectedCopy` ; replay identique sans téléchargement ; autre contenu conflit ; nouvelle clé indisponible refusée. |
| SR-11 | Lookup absent puis confirmation concurrente pendant panne de lecture PDF | Second lookup unique : replay exact s'il a gagné ; aucune double activation ; échec lookup ne déclenche pas une nouvelle intention. |
| SR-12 | Révision/droits/tenant/statut/archive changés après aperçu | Nouvelle confirmation refusée selon contrôle réel ; aucune réattribution d'acteur ; preuve séparée du résultat dans l'UI et de la course native entre connexions. |
| SR-13 | Deux préparations simultanées même clé ; deux confirmations même révision | Une identité de copie sans overwrite ; une activation gagnante et un conflit ; observer barrières/attentes réelles. Deux appels séquentiels ne suffisent pas. |
| SR-14 | Reload après réservation, vérification puis confirmation ; réponse tardive après fermeture/changement de version | Même intention et IDs ; aucun nouvel auteur ni nouvel état sous l'autre version ; absence de récupération cross-session explicitement annoncée. |
| SR-15 | Filename hostile, champs supplémentaires, path/actor falsifiés, origine étrangère, DTO RPC invalide | Aucun en-tête injecté, HTML exécuté, POST accepté hors origine autorisée, requête externe, secret/locator divulgué ou faux succès. |
| SR-16 | Suppression autorisée de toute l'affaire avec copies pending et verified | Revue/données suivent le contrat SQL ; objets privés résiduels inventoriés dans la fixture, jamais annoncés purgés automatiquement. |

Fixtures A/B : mêmes noms, trois pages réelles et clauses de l'oracle,
marquées « corpus synthétique de qualification ». Manifestes avec hashes
calculés, tailles et texte par page ; aucun hash inventé. C1 change de 30 à
40 mm en zone A dans B. Le parsing compte les pages ; l'E2E vérifie le passage
attendu dans la copie affichée. Cela ne prouve ni extraction exhaustive, ni
pertinence métier, ni validation du corpus par un chiffreur.

Une isolation supplémentaire n'est pas décidée ici. Si le harness ne peut
prouver terminaison worker ou une frontière de privilège, écrire d'abord
l'échec concret et la raison de l'écart E2E, puis la régression avant son code.
Conserver les tests existants justifiés ; aucun test de forwarding ou de
texte statique ajouté pour compter des assertions.

## 8. Parcours humain et états affichés

Utiliser un parcours dédié à la version ou un panneau chargé à la demande.
Ne pas importer le parseur PDF ni un lecteur lourd dans la grille. Le budget
éditeur communiqué pour la build courante est de 496272/500000 octets gzip,
une mesure locale à relire lors de l'intégration, pas une constante produit.
Les chemins Storage, identifiants techniques et locators restent hors du
parcours visible ; nom, état, pages, dates et motif portent l'interaction.
L'empreinte peut être consultable dans les détails de la copie.

- Initial : « Aucune référence confirmée ». Choisir explicitement un CCTP,
  même seul ; « Préparer une copie » n'est pas « Confirmer la référence ».
- Pending/réponse perdue : montrer préparation en cours ou interrompue,
  proposer « Reprendre la préparation » avec la même intention. Le reste
  de l'affaire reste utilisable ; ne pas montrer une vérification réussie.
- Verified : « Copie prête à consulter », nom capturé, pages, SHA et date.
  « Consulter la copie » ouvre le contenu conservé. L'interface active la
  confirmation après consultation réussie et confirmation explicite du lecteur ;
  elle ne certifie pas sa compréhension. Motif requis, bouton sans ambiguïté.
- Active A + candidate B : afficher les deux rôles visuels, sans remplacer
  A pendant le chargement. Un changement de révision impose une nouvelle
  lecture de l'état avant une nouvelle décision, jamais un retry réécrit.
- Historique : auteur/date/motif et copie consultable selon droits ; reçu
  rejoué identifié comme ancien enregistrement avec état courant distinct.
- Panne : erreur explicite avec Réessayer, données déjà reçues conservées,
  absence d'affirmation « aucune référence » sur erreur ; consultation perdue
  affiche « Source indisponible ». Un replay historique peut rester réussi
  alors que le PDF est actuellement indisponible.
- Fermeture/retour/reload : aucune activation implicite. Les contrôles au
  clavier, états occupés, labels, focus du lecteur et erreurs accessibles
  sont vérifiés dans l'interface réelle.

Le clic de recette simule une interaction humaine ; il ne vaut pas validation
métier du document par un professionnel. Les contrôles côté serveur restent
obligatoires même si le bouton est désactivé ou si l'UI exige la consultation.

## 9. Objets résiduels, ordre et preuve de sortie

La suppression d'une version/affaire annule ses données DB selon le candidat,
mais ne supprime aucun objet Storage. Un upload interrompu peut laisser un
objet attaché à un ticket pending ; une suppression DB peut laisser un objet
sans ticket. Les deux états sont inventoriés séparément. Aucun TTL, purge
automatique, nettoyage global ou réutilisation d'objet n'est introduit ici.
Ne pas supprimer un objet verified pour libérer une clé. La future purge
exigera droits, références croisées, conservation et course avec préparation ;
elle reste une dette explicite, pas une fonction implicitement terminée.

Ordre de réalisation après la fin du gel courant :

1. Figer les scénarios/fixtures HTTP ci-dessus, puis exécuter leur baseline
   sur les capacités absentes. Terminer séparément les courses natives ;
   relire la migration issue du candidat avant installation locale autorisée.
2. Lecture GET métier et DTO stricts, OpenAPI, erreurs et pagination. Ce lot
   ne crée rien et ne simule pas une référence active.
3. Vérification PDF terminable, préparation privée et lecture du contenu ;
   exécuter octets, fautes et reprise avant d'exposer la confirmation.
4. Confirmation et replay avec preuves SQL/Storage/HTTP séparées ; relecture
   substantielle des droits et du transport de l'acteur réel.
5. Interface complète A→préparation B→consultation→confirmation→reload,
   dégradations et clavier. Qualifier uniquement les scénarios exécutés.

À chaque campagne : commande, révision et hashes des sources/build, pile et
hôtes autorisés, acteurs/ressources neufs, attentes/résultats, requêtes expurgées,
fichiers téléchargés et hashes, révisions/événements avant-après, preuve de
worker/rollback selon le cas. Aucun credential, cookie, JWT ou clé service
dans les artefacts ; traces authentifiées désactivées. Préserver les objets
de la campagne et leur inventaire jusqu'à une suppression autorisée et bornée.

Une campagne échouée avant l'assertion est une preuve manquante. Un GREEN SQL
ne devient pas un GREEN HTTP/Storage ; un GREEN local ne devient pas une
preuve d'hébergement ou de production. La frontière sessions/objets résiduels
doit figurer dans le compte rendu de livraison de ce premier incrément.
