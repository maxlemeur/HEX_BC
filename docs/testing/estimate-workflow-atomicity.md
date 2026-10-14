# CORE-08 — compenser les workflows sans écraser une autre écriture

Plan préalable, 2026-10-12. Lecture du code uniquement ; aucun scénario ci-dessous exécuté, aucune migration ni source produit modifiée pour ce plan. La qualification du POST unitaire ne qualifie pas le batch ni l'application d'ouvrages.

## Constat et réemploi

- `src/lib/estimates/batch.ts:262-292` ne capture aucun état avant un `create` ; son inverse appelle `deleteEstimateItem`. Les inverses sont des commits séparés, et `rollbackBatchActions` journalise puis absorbe leurs erreurs (`:341`). Le batch renvoie ensuite `committed:false`, même si la restauration a échoué (`:531`).
- `src/lib/estimates/server.ts`, `deleteEstimateItem`, supprime puis relit le jeton ; il ne restaure ni le pied ni les allocations des autres lignes. CORE-08 étend précisément les effets de `create` à ces valeurs.
- `generated-ouvrages.ts:2950-3003` supprime les nouveaux items et assemblages puis restaure certains candidats. L'application crée aussi applications, snapshots, projection du draft et états des sous-détails (`:4167-4295`). La section de repli créée n'est pas dans `createdEstimateItemIds` ; le draft et les sous-détails ne sont pas dans `candidateReverts`.
- `claim_estimate_batch_revision` (`20260722134411_fix_estimate_batch_conflict_sqlstate.sql:4`) vérifie un jeton et le fait avancer. Le verrou de sa transaction est relâché à sa réponse : ce n'est pas un bail transactionnel couvrant les opérations suivantes.
- `bulk_update_estimate_items` est réutilisable pour appliquer les colonnes financières et le pied dans une transaction existante. Il ne crée ni ne supprime les items. Aucun RPC générique de batch/compensation n'a été trouvé dans les migrations. `apply_estimate_structure_draft` ne traite que sa structure ; `apply_takeoff_job_atomic` a des contrats de preuve et de mapping propres au métré ; ne pas les détourner.

## Plus petit correctif sûr si les boucles actuelles sont conservées

Ajouter une **primitive transactionnelle d'inverse** ; ne pas enchaîner un DELETE HTTP et un bulk HTTP. Le périmètre de cette primitive doit contenir toutes les écritures à annuler. Une restauration des seuls totaux ne permet pas d'annoncer que tout le workflow est annulé.

1. **Capturer l'entrée avant toute écriture.** Lire le jeton, les paramètres financiers, les dépendances brutes de calcul et les items de la version ; relire le jeton après la pagination. Si les deux jetons diffèrent, recommencer explicitement ou refuser sans écrire. Conserver tous les montants des anciennes lignes V2, pas seulement les items ciblés : l'ajout d'une ligne redistribue la remise. Conserver les entrées métier nécessaires à l'inverse des opérations effectivement acceptées. Pour les ouvrages : draft/candidats/sous-détails visés avec leurs versions ou états exacts, identité de la section éventuellement créée et des assemblages créés. Les champs financiers ne suffisent pas à restaurer des cascades applicatives.
2. **Chaîner les tokens de ses propres commits.** Chaque opération reçoit le dernier token retourné par l'opération précédente. Chaque primitive qui participe doit comparer ce token sous le verrou SQL, puis retourner le token de son commit. Un précontrôle TS puis une mutation non conditionnée n'est pas un CAS. La valeur `resolveLatestBatchVersionToken` peut informer l'interface ; elle ne peut jamais autoriser un rollback. Les lectures faites après l'erreur n'établissent pas l'origine du dernier changement.
3. **Un seul appel de compensation.** Entrées minimales : `versionId`, `expectedUpdatedAt` = dernier commit réellement reçu, session du verrou, inverse explicitement borné et états attendus des objets visés ; snapshot financier d'entrée et contexte brut associé. Identité acteur/tenant déduite de la session, jamais choisie par le client. Réemployer le garde de calcul CORE-08 et le bulk canonique, sans nouvelle formule SQL. L'API publique ne reçoit pas une image libre de toutes les tables.
4. **Verrouiller puis vérifier avant toute écriture.** Version, projet, session active, droits actuels, statut draft, CAS ; items et autres objets à restaurer selon un ordre stable. Comparer les identités/états post-opération attendus, les paramètres financiers et les dépendances brutes avant de rétablir les anciens montants. Un changement de tarif/palier/flag interdit de rejouer aveuglément l'ancien pied. Les assemblages et drafts ont leurs propres états : le token de version seul ne protège pas une modification de bibliothèque ou de revue faite entre deux commits.
5. **Appliquer l'inverse et les montants ensemble.** Retirer seulement les créations identifiées de ce workflow, restaurer seulement ses modifications attestées, puis appliquer l'image financière d'entrée aux items conservés et au pied dans la même transaction. Vérifier l'ensemble exact des IDs avant/après. Toute erreur tardive annule la compensation entière. Ne pas rétablir `updated_at`, `content_revision`, les révisions techniques, les journaux append-only ni la fraîcheur d'un snapshot publié : leurs valeurs doivent rester monotones. Une décision de couverture invalidée par une modification puis un retour à la valeur initiale ne redevient pas valide.
6. **Distinguer trois résultats.** `rolled_back` seulement après retour transactionnel vérifié ; `rollback_conflict` si un tiers, le statut ou le contexte a changé ; `outcome_unknown` si l'issue d'un commit n'est pas connue. Dans les deux derniers cas, aucune nouvelle suppression opportuniste, aucun upsert aveugle, aucune annonce « tout a été annulé ». Conserver les références permettant la reprise et exposer une erreur publique intelligible ; ne pas avaler l'échec comme aujourd'hui dans le batch.

Une réponse perdue de `create` pose un problème supplémentaire : le code appelant ne connaît actuellement ni son item ID ni son token, puisque les IDs sont enregistrés après le retour. Préallouer les identités dans un plan serveur permet une lecture de rapprochement, mais ne donne pas le droit de reprendre le dernier token trouvé. Pour une reprise automatique exacte après résultat inconnu, un reçu durable `operationKey + acteur + version + empreinte de requête` est nécessaire, ou il faut déplacer le workflow dans une transaction unique. Une liste d'IDs en mémoire n'est pas un journal de reprise.

### Frontière à ne pas masquer

L'inverse d'un batch mixte n'est pas seulement « retirer les créations ». Un DELETE peut déjà avoir supprimé par cascade une application d'ouvrage ou un snapshot ; le sérialiseur actuel de restauration ne conserve même pas tous les champs de provenance/produit. Pour garantir le batch entier, deux choix existent : capturer et restaurer exactement toutes ses dépendances sous gardes, ou calculer le plan final puis exécuter les opérations et le pied dans une **seule RPC de batch**. La seconde voie évite un système de snapshots de restauration de plus en plus large et constitue la recommandation pour les batchs mixtes. Le contrat public reste le même ; aucun retour silencieux à l'ancien `create`.

Pour les ouvrages, une RPC dédiée de finalisation peut écrire section de repli, assemblages/composants, items/projection financière, applications/snapshots et états du draft dans une transaction. La préparation/calcul/revue reste en TS. Réemployer la primitive financière et les règles SQL existantes ; ne pas recréer un moteur financier. L'unicité du candidat appliqué fournit déjà une identité métier, mais un reçu strict reste nécessaire pour distinguer replay exact et demande différente. Cette voie est préférable à une compensation durable quand toutes ces tables doivent former une seule décision produit.

**Décision du coordinateur :** réaliser les finalisations transactionnelles uniques, d'abord batch puis ouvrages. Elles évitent un inverse complet des cascades et suppriment les compensations inter-commits. Les gardes de contexte/session/CAS et les reçus de résultat inconnu restent requis. La proposition d'inverse ci-dessus explique pourquoi un simple recalcul de réparation ne suffit pas ; elle n'est pas le choix d'implémentation retenu. Ne pas annoncer la qualification agrégée avant preuve de ces finalisations.

## Défaillances et oracles définis avant correctif

### WFC-01 — vrai échec tardif de batch, restitution des allocations V2

Nouveau tenant/projet/version V2, marge fixe 1, coefficient 1, remise 1667 bp, arrondi none. Deux lignes réellement créées par API, quantité 1/prix 3 ct : A TVA20 %, B TVA0 %, ordre A puis B. État initial attendu : A HT2/TVA0/TTC2, B HT3/TVA0/TTC3, pied **5/0/5 ct**. Archiver ce GET avant le batch.

Envoyer le batch normal : (1) créer C quantité1/prix3 ct/TVA0 % en position3 ; (2) mise à jour d'un UUID inexistant mais syntaxiquement valide. Avec des commits successifs, C produit transitoirement A2/B2/C3 et pied **7/0/7 ct** ; B prouve que l'effet de create dépasse C. L'échec de l'opération2 doit rendre au premier GET après la réponse A2/B3, C absent et pied5/0/5, provenance/produit/hiérarchie conservés. Pas d'éditeur, pas de CtrlS ni recalcul de réparation. Si une finalisation unique refuse avant tout commit, l'état initial identique est également le bon résultat ; l'archive doit indiquer qu'aucun commit intermédiaire n'a été observé, pas inventer une compensation.

Recharger ensuite l'éditeur et les deux vrais exports sans bulk de réparation ; comparer les valeurs et identités. Garder le contrôle du résultat `committed:false` et des opérations, mais ajouter une distinction explicite si la restauration est refusée/inconnue.

### WFC-02 — faute native tardive dans le vrai parcours d'application d'ouvrage

Réutiliser le parcours de reprise/revue/application réel sans Gemini, avec un nouveau draft de fixture et une version comportant déjà les deux lignes WFC-01. Deux candidats revus ; aucun état d'application final semé. Une faute locale contrôlée et éphémère sur la **seconde** insertion de work snapshot doit lever après le passage financier réel. Le harness installe la faute uniquement sur les UUIDs neufs, dans la pile jetable explicitement autorisée, puis retire sa définition et prouve la restauration du catalogue. Aucune route de test produit ni réponse financière mockée.

Après l'erreur affichée, lecture ordinaire : pied et allocations initiales exacts ; aucune nouvelle ligne, application, snapshot ou assemblage ; candidats et sous-détails redeviennent leur état de revue initial ; draft reprenable ; section de repli nouvelle absente, section préexistante conservée. Un second témoin lève après `updateDraftProjection` et avant la finalisation des sous-détails : il couvre les états que le rollback actuel ne restaure pas. La UI ne doit ni annoncer une insertion réussie ni conserver un état « appliqué » sans ligne.

Cette faute éphémère gardée, sur les seuls nouveaux UUIDs de notre pile jetable avec catalogue restauré et prouvé, relève des tests locaux déjà autorisés. Une autre base, une base partagée ou distante exigerait une autorisation distincte. Tant que le harness et ses gardes ne sont pas prêts, ce cas demeure non qualifié ; aucun skip ne devient un succès. Avec la finalisation unique retenue, la même faute prouve le rollback transactionnel complet.

### WFC-03 — écriture concurrente préservée

Deux sessions ordinaires du même compte de fixture ou un vrai transfert de verrou autorisé ; pas de JWT injecté. Pour les boucles, un verrou/barrière native sur l'insertion du snapshot retient A **après son create commis et avant l'erreur tardive**, sans retenir le verrou de version. B lit son token, modifie par API une ancienne ligne avec le vrai bail, puis le harness libère la faute de A. La compensation doit être refusée : quantité/titre/montants et nouveau token de B inchangés, aucun item supprimé opportunistement, erreur explicite de restauration incomplète. La lecture conserve l'état réellement commis, pas un « rollback réussi » fictif.

Cette contention exige des PIDs/locks réels et des instants archivés. Un test SQL séparé doit tenir A au seuil de compensation puis faire commettre B avant le CAS ; zéro effet du refus. Si l'agrégat est devenu une seule transaction, B doit attendre ou recevoir un conflit et ne peut jamais lire les effets non commis de A ; documenter cette garantie différente.

### WFC-04 — réponse finale perdue, puis reprise

Dans le navigateur, laisser le vrai serveur terminer l'application, puis perdre uniquement sa réponse finale. Après reload, ne pas envoyer automatiquement une nouvelle opération. Reprendre explicitement avec la même intention/clé si un reçu existe ; obtenir les mêmes identités et aucun doublon. Un replay ne doit pas déclencher une compensation d'un commit réussi. Un corps différent avec la même clé est refusé. Sans reçu durable, l'interface conserve un état « résultat à vérifier » et ne prétend pas pouvoir restaurer automatiquement à partir de sa mémoire de page.

### WFC-05 — frontières natives non reproductibles par le seul écran

Avant implémentation de la primitive retenue : refus acteur/tenant/version/session, lease expiré, CAS périmé, contexte absent→false/palier/rôle modifié, objet d'ouvrage modifié hors token de version, liste d'IDs étrangère/dupliquée, faute après la première suppression mais avant bulk, faute après restauration d'un item mais avant footer. Chaque refus conserve strictement items, montants, objets métier et autres affaires. Les journaux/révisions monotones ne sont pas restaurés artificiellement. Une faute transport après COMMIT doit conduire au rapprochement/reçu, jamais à un second inverse aveugle.

## Fichiers et ordre de réalisation proposés

1. Fixer le choix de frontière et ajouter les cas ci-dessus au scénario TesterArmy durable existant de création/ouvrages ; définir la fixture native de faute et de courses avant SQL. Aucun nouveau runner.
2. Nouvelle migration pour la primitive retenue + types Database ; serveur dédié léger à côté d'`atomic-item-creation.ts` pour calculer le plan et appeler la RPC. Réutiliser `version-totals.ts`/`bulk_update_estimate_items`, droits/bail/CAS/contexte de CORE-08. Pas de modification d'une migration déjà appliquée.
3. `batch.ts` : supprimer les inverses non gardés si la RPC unique est retenue ; sinon snapshot complet et chaîne CAS réelle, appel unique de compensation, erreur non absorbée. Actualiser le contrat client/route/OpenAPI si une distinction d'état publique est ajoutée.
4. `generated-ouvrages.ts` : finalisation transactionnelle ou inverse atomique comprenant aussi états de revue/section de repli ; retour tardif/perdu clairement réconciliable. Ne pas faire dépendre l'intégrité financière de l'autosave de l'éditeur.
5. Preuves natives transactionnelles/courses puis WFC-01/02 réels et WFC-03/04 selon le mécanisme retenu. Rejouer CA01–03 et les parcours reprise/ouvrages après intégration ; qualifier chaque périmètre séparément. Aucun résultat préparé dans ce plan ne vaut exécution.

## Baseline WFC01 exécutée — 12 octobre 2026, 03:01 UTC

Archive `.e2e/army/coverage/runs/2026-10-12T03-01-23-175Z`, manifeste SHA
`d1cb686a81ecbfe1fcd8eb4864ac7be0e410acc78b7813061d30b7e7937ea3e7`.
Deux résultats sélectionnés/exécutés : auth PASS, WFC01 RED, zéro skip/flaky
ou modèle. Build `VvHbNXoMA0g2N-2OfwSpb`, sources stables, Windows,
seule pile API45585. Un nouveau projet a été créé par la session ordinaire
du propriétaire CORE-08, sans réutiliser un devis consommé.

Avant batch : A2/B3, pied5/0/5 centimes. La requête inclut une
`operation_key` UUID. Le serveur répond HTTP200, `ok:true`,
`committed:false`, deuxième opération `update/NOT_FOUND` ; le premier GET
qui suit conserve C absent, mais **B2 et pied7/0/7**, au lieu de B3 et5/0/5.
La preuve entière est conservée avant l'assertion. Le bail propre est libéré
par DELETE normal. Aucun éditeur, sauvegarde, reload ou export n'a été atteint
après l'échec, et aucun commit intermédiaire n'a été observé directement.

Les dix artefacts hachés concordent ; 88 fichiers texte ont été scannés
sans secret configuré/JWT détecté. Reçu de conservation distinct :
`.e2e/estimate-create-atomic/workflow-baseline/baseline-01-inspection.json`.
Il constate un RED réel et ne transforme pas cette baseline en qualification.
Les gestes de sauvegarde/reprise/collage/Annuler sont définis séparément dans
[estimate-batch-client-e2e.md](estimate-batch-client-e2e.md), avant leur correction.

## Prochaine tranche : finalisation d'ouvrage

La revue du 12 octobre réduit WFC-02 à un candidat et une section existante.
Depuis A2/B3 et un pied5/0/5 ct, appliquer un ouvrage de fourniture à3 ct ;
provoquer une faute native ciblée au passage du sous-détail à `applied`, après
`updateDraftProjection`. Au premier GET, sans ouvrir l'éditeur ni sauvegarder,
exiger A2/B3/pied5, aucune création/application/snapshot/assemblage, candidat
en attente et draft encore reprenable. Le code actuel laisse probablement B2,
un pied7 et un draft appliqué : cette conclusion vient de la lecture du code,
pas d'une exécution. Un second témoin indépendant couvrira la section de repli,
absente de la liste des éléments supprimés par la compensation actuelle.

La transaction dédiée doit englober section de repli, assemblages/composants,
items et projection financière, applications/snapshots, candidats, draft et
sous-détails. Un batch d'items suivi de commits de métadonnées serait insuffisant.
Revalider sous verrou les états revus, qui peuvent changer sans modifier le
jeton financier, ainsi que les droits, le bail et le contexte de calcul.
La préparation pure reste en TypeScript ; un reçu lié à l'acteur, la version
et l'intention permettra de reprendre une réponse perdue. Aucun correctif
d'ouvrage ni scénario WFC-02 n'est encore exécuté pour cette tranche.

### Recette WFC02 préparée avant le correctif

`estimate-generated-atomic.e2e.ts` sélectionne deux sœurs indépendantes,
`existing` et `fallback`, plus l'authentification ordinaire. Le profil
`generated-atomic` réemploie le runner coverage, sans filtre, avec arrêt après
deux échecs afin d'observer les deux cas de baseline. Le propriétaire CORE-08
est réutilisé ; seul le seed préalable crée deux nouveaux projets/V2/sectionsS
et les propositions pending. Aucun item financier, assemblage, application ou
snapshot final n'est préinséré. Le sous-détail contient une fourniture q1/PU3ct.

Le test crée A/B par API ordinaire avec remise1667bp, vérifie A2/B3/pied5/0/5,
libère normalement son bail de préparation, puis ouvre l'éditeur et reprend
le brouillon. La revue et l'application passent par leurs vrais boutons UI.
Le premier témoin transmet S, le second `lotId:null` pour provoquer la création
du lot de repli ; S doit rester présent dans les deux cas. La TVA de version
est0 et A porte explicitement20%, afin que l'ouvrage3ct garde le même oracle
transitoire7/0/7 que WFC01. Aucun CtrlS ou recalcul artificiel n'est envoyé.

La réponse de l'action est lue sans archiver son Flight brut ni le bail. Le
premier GET et une observation RLS indépendante sont archivés avant assertions :
items et montants complets, draft, candidat, sous-détail/composants, applications,
snapshots, assemblages et composants de bibliothèque. Tous les objets reviennent
aux valeurs relues après la revue humaine ; seuls created_at/updated_at ne sont
pas comparés comme états métier. Le message d'erreur doit rester visible, sans
badge Inséré. Le compteur natif de faute et la restauration de son catalogue
sont des reçus distincts indispensables pour établir la vraie erreur tardive.

Le plan immuable `wfc02-baseline-01/plan.json` porte les UUIDs et la preuve de
pile batch-qualified. Le seed a été relu avant son autorisation locale ; son
exécution ne qualifie aucun parcours. Aucun qualificateur complet supplémentaire
n'est nécessaire pour conserver la baseline RED et ses observations exactes.

### Baseline WFC02 exécutée — 12 octobre, 04:26 UTC

Archive `.e2e/army/coverage/runs/2026-10-12T04-26-32-534Z`, manifeste SHA256
`686cb44f695b8738b4e934ecb224a99ecd4efa8c4fb0f941d3f48e7c08904d18`.
Build `MlizsbOA6KSD_dCPpImFv`, sources stables : auth PASS et les deux WFC02 RED,
trois résultats sélectionnés/exécutés, zéro skip/flaky/modèle. Chaque action
réelle répond HTTP200, `ok:false`, code `BAD_REQUEST`, erreur de finalisation
du statut appliqué du sous-détail. Les premières lectures sont conservées
avant l'assertion financière, sans CtrlS, reload ni bulk de réparation.

| Témoin | Avant | Premier GET après refus | Autres objets observés |
| --- | --- | --- | --- |
| Section existante | A2/B3, pied5/0/5 | **A2/B2, pied7/0/7** ; S conservée | Draft `applied`, candidat `pending`, sous-détail `reviewed` ; zéro application/snapshot/assemblage/composant de bibliothèque |
| Section de repli | A2/B3, pied5/0/5 ; seuleS présente | **A2/B3, pied7/0/7** et section **À classer orpheline** | Même divergence du draft `applied` ; candidat `pending`, sous-détail `reviewed` et zéro objet d'application/bibliothèque |

Le second témoin conserve bien B3 : il ne faut pas lui attribuer le B2 du
premier. Les deux écarts sont observés, pas déduits du code. Le test s'arrête
sur les montants ; les comparaisons suivantes restent non exécutées, mais
leurs données complètes ont été archivées avant ce point. La preuve des
compteurs de faute et du retrait des seuls objets QA est conservée séparément
par le helper natif. Les données métier de ces deux échecs ne sont pas réparées.

L’observation native ultérieure confirme **un déclenchement tardif par témoin** :
`native/observations/1399deea00094161/receipt.json`, SHA256
`1d637c3885eac35a839c11c01b50de4961772924e67d6291d2f2e257ca6be277`.
Le retrait des six seuls objets QA est vérifié par `native/removal/receipt.json`,
SHA256 `d1d99e033a32487ba3c4e078adf08768024a69a22c9da3866b1121d8fd2617b6`.
Ces chemins sont relatifs à `.e2e/estimate-generated-atomic/`. Le catalogue
initial est restauré ; les états métier rouges restent intacts. Ces reçus
complètent, sans la réécrire, l’inspection de conservation de la baseline.

Pour le prochain build atomique, la recette transmet aussi clé idempotente,
jeton financier et jeton de revue64hex. Les assertions de données sont
inchangées. La faute native conserve exactement SQLSTATE `PWF02` et message
`WFC02_SUBDETAIL_APPLY_FAULT` ; le produit ne connaît pas ce code QA. Son
transport attendu devient donc `GENERATED_OUVRAGE_OUTCOME_UNKNOWN`/503,
dialogue fermé et récupération globale « Résultat à vérifier ». Le premier
GET doit néanmoins prouver le rollback complet. Cette adaptation explicite
du protocole ne réécrit pas le BAD_REQUEST observé dans la baseline ; les
deux futures sœurs seront neuves et leur hit/removal seront de nouveaux reçus.
