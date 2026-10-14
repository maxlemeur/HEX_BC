# Transport borné de référence PDF — contrat préalable

Ce contrat est écrit avant le module et ses tests spécialisés. Le parcours
primaire reste [la recette de référence conservée](source-coverage-reference.md).
Aucune route, migration ou opération Storage réelle n'est ajoutée par ce lot.

## Frontière proposée

`createSourceReferenceStorage({ context, authorization, signal? })` est serveur
Node uniquement. `context` est le contexte utilisateur/tenant canonique.
L'autorisation possède les UUID acteur, tenant, affaire, version et copie, et
un objectif `prepare`, `read` ou `confirm`. Elle ne contient aucune URL.

La factory relit réellement `readSourceReferenceReview({versionId,copyId})` et
compare affaire/version/copie. Read/confirm exigent une copie verified et
n'exposent que `readCopy()`. Prepare exige un rôle admin/engineer et le résultat
strict de la réservation RPC déjà effectuée par l'orchestrateur, avec les
identités upload/document ; il expose aussi `readSource()` et
`uploadCopy(inspectedPdf)`. Un objet d'autorisation isolé ne donne donc pas
accès au service. Le résultat de réservation doit provenir du serveur, jamais
du JSON envoyé par un navigateur. Le transport ne réserve ni n'atteste rien.

Le chemin privé est exactement `tenant/project/version/copy/reference.pdf`.
Le chemin source est exactement `tenant/project/upload/document/safeFilename`.
Les buckets sont constants. Chaque segment est contrôlé puis encodé une seule
fois ; slash inverse, `%`, query/fragment, segment vide ou `.`/`..` sont refusés.
La base provient exclusivement de NEXT_PUBLIC_SUPABASE_URL : HTTP(S), sans
credentials/query/fragment. Redirections interdites ; aucune URL signée.

La lecture source emploie le jeton getSession revérifié par getUser(token),
lié à context.userId, et la clé publique configurée. Jamais de fallback service.
La copie privée emploie le secret serveur après la lecture métier réussie.
Les clients existants, dont le singleton service, ne sont pas modifiés.
Le fetch direct reproduit les endpoints installés `/storage/v1/object/{bucket}/{path}`
et évite le `.json()` non borné du SDK sur les erreurs HTTP.

ReadCopy rend null uniquement pour une absence d'objet explicitement codée
NoSuchKey, avec statut404, ou le couple legacy HTTP400/statusCode404. NoSuchBucket,
403, panne et réponse illisible restent des erreurs, jamais une permission de
créer. Ce null est réservé à une copie pending : si le GET métier la déclare
verified, l'absence est SOURCE_UNAVAILABLE et readSource/uploadCopy sont refusés,
y compris pour prepare. Aucune reconstitution de son identité n'est permise.
ReadSource traduit une absence en erreur. Upload est POST, upsert:false,
application/pdf, sans PUT/retry automatique ; seul un conflit explicite
ResourceAlreadyExists/KeyAlreadyExists/legacy Duplicate rend `conflict`.
L'orchestrateur relira ensuite l'objet gagnant avant attestation.

Succès PDF : lecture stream, 1..52 428 800 octets effectivement reçus ; vérifier
le cumul avant de retenir chaque chunk. Erreurs et réponse d'upload : maximum
65 536 octets. Dépassement, abandon et erreur arrêtent la lecture et annulent
le fetch. Aucun Blob/Response.arrayBuffer non borné ni confiance dans
Content-Length. Le buffer final est un ArrayBuffer exclusivement possédé de
taille exacte, transférable au worker ; aucune copie de confort conservée.
Cela ne promet pas une limite RSS globale ou celle des buffers réseau internes.

Budget absolu à partir de la factory : 60 s prepare, 30 s read/confirm, jusqu'à
EOF inclus ; signal appelant lié à chaque fetch. Le navigateur ne choisit
aucune limite. Les lectures Auth et métier existantes n'acceptent pas ce signal :
elles sont attendues sous le même budget, leur réponse tardive ne peut autoriser
un transfert, mais leur requête interne ne peut pas être annulée ici sans
modifier ces clients. Les erreurs exposées ont un code/message fixes, sans
cause brute, token, locator, URL ni texte du serveur Storage.

L'autorisation peut changer après la factory. L'orchestration devra refaire
la lecture métier avant d'émettre les octets/résultats après un travail long ;
la confirmation SQL recontrôle les droits au commit. Ce module ne prétend ni
transaction atomique Storage+DB, ni contrôle permanent des droits.

## Défaillances et recette primaire à exécuter après intégration

| Cas | Faute observable | Critère de réussite |
| --- | --- | --- |
| ST-01 | Copie altérée/tronquée ou upload sur mauvais chemin | Source/copie relues, hash/taille/pages identiques, aucun autre objet modifié. |
| ST-02 | Fichier de 50MiB+1 entièrement consommé ou accepté | Refus, transfert interrompu, aucune attestation/activation ; 50MiB exact demeure admissible. |
| ST-03 | Erreur JSON volumineuse accumulée en mémoire | Refus borné à64KiB ; aucun diagnostic privé dans la réponse. |
| ST-04 | Redirection suivie vers autre objet/hôte | Aucun accès à la cible et aucun secret envoyé ; refus sans copie. |
| ST-05 | Timeout/abort seulement aux headers | Flux interrompu après headers, aucun upload/attestation, nouvelle tentative relit la source. |
| ST-06 | 403 ou panne traitée comme absence | Aucun POST ; absence typée seule permet une création. |
| ST-07 | Conflit d'upload écrase l'objet existant | Upsert false ; objet gagnant relu, jamais PUT ni retry aveugle. |
| ST-08 | Source lue avec service ou capacité copie forgée | Session/tenant/GET métier réels ; refus avant Storage hors droits, aucune fuite entre acteurs. |

## Isolation nécessaire, écrite avant implémentation

Les E2E actuels de référence n'observent pas la fermeture du flux upstream,
les requêtes envoyées vers une cible de redirection, ni les en-têtes de la
connexion serveur→Storage. Une injection via proxy/preload local reste une
alternative future pour la recette intégrée. Pour ce module encore sans route,
un vrai serveur HTTP loopback permet de qualifier ces frontières précisément,
sans endpoint produit ni mock de reader/fetch/horloge.

Les tests Node séquentiels préalables couvrent : dépassement succès et JSON
avec flux volontairement maintenu ouvert, abort après headers, redirection
sans requête cible, source sans service fallback, rejet d'identité/session
avant réseau, capacité non confirmée par GET métier refusée, et POST conflit
sans upsert/PUT/retry. Ils attendent la fermeture observée côté serveur et
les comptes de requêtes, pas seulement une promesse rejetée. Taille émise et
délais de fixtures bornés ; teardown ferme les sockets détenues par le test.

Les tokens sont factices, getSession/getUser et GET métier sont simulés à
cette frontière. **Ces tests ne prouvent pas l'authentification Supabase,
RLS, une conservation physique native, le parcours HTTP applicatif ou la charge.**
Aucun résultat n'était déclaré dans le contrat préalable.

## Résultats du module isolé — 12 octobre 2026

Les dix cas ont été écrits avant le module, puis exécutés : **10/10 PASS**,
avec vrais flux HTTP loopback, sans changement du fichier de tests entre
le préalable et le résultat. Les sondes de dépassement et d'abandon attendent
la fermeture observée du côté serveur ; la redirection compte zéro accès cible.
Lint des deux fichiers et contrôle TypeScript global passent.

Le premier lancement avait échoué sur le cache Vitest du bac à sable, avant
toute assertion. Le lancement préalable hors bac à sable a ensuite constaté
l'import produit absent, toujours sans assertion : capacité manquante,
pas RED métier. Reçu préalable et empreintes dans
`.e2e/source-coverage/storage-staged/before-implementation.json` ; résultats
de terminal, commandes, identité des sources et limites dans `validation.json`.

Le GET métier est simulé uniquement dans ces tests de transport ; le module
l'appelle réellement avant de construire sa capacité et avant les opérations.
Il relit aussi l'état d'une copie absente avant de permettre le null pending.
Les erreurs, champs et pages d'un InspectedSourceReferencePdf sont contrôlés
à l'exécution pour les bornes, mais seul le worker valide réellement un PDF et
seule la relecture privée par l'orchestrateur permet l'attestation.

Les scénarios ST-01..ST-08 du parcours applicatif restent à exécuter après
intégration. Aucun résultat HTTP applicatif, Storage natif ou RLS n'est
revendiqué par les dix tests spécialistes.
