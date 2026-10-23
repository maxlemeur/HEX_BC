# Régression SQL du contrat d’offre — préparation avant migration

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


Écrit le 13 octobre 2026 avant la migration offre. La fixture est **préparée, non exécutée**. Elle ne crée aucune preuve d’émission, aucun PDF ni envoi fournisseur. Les contrats proposés sont ceux de `.e2e/offer-emission/sql-preparation-20261013-01/proposed-contract.md` et `.e2e/offer-emission/contract-preparation-20261013-01/schema-contract.md`.

## Défaillances à empêcher, définies avant le SQL

| Frontière | Défaillance observable | Assertion spécialiste et limite E2E |
| --- | --- | --- |
| S1 | Une réservation laisse une version `sending`, un dispatch ou un lien sans événement après un échec tardif. | P9001 forcé **après** la capacité et l’identité, **avant** l’événement `reserved`; état complet identique après refus. Le navigateur ne peut pas provoquer cette instruction précise. Rejeu séquentiel identique et conflit d’enveloppe sont distincts d’une concurrence réelle. |
| S2 | Un rôle public appelle un ancien overload, écrit une capacité, la dissocie ou la transforme en historique. | Vérifier tous les overloads et appels réels sous `anon`/`authenticated`; INSERT/UPDATE/DELETE réels; contrôles `service_role` sur null, downgrade, relink, tenant, version, token, destinataire, création et expiration. Lire sous RLS ne doit pas être supprimé pour empêcher l’écriture. |
| S2 acteur | Le propriétaire sert d’émetteur au lieu de l’admin qui émet; membre révoqué, rôle viewer ou autre tenant émet. | Admin tenant non global distinct du propriétaire, champs de profil normalisés capturés à la réservation puis figés; refus sans mutation après retrait/downgrade de membership ou désactivation tenant. |
| S3 | Le rejeu publication accepte le même SHA mais une identité, un layout, des CGV, un auteur, une date ou une taille différents. | Publication réelle sous claim, preuve complète construite depuis la ligne publiée, rejeu exact puis mutations isolées. Un claim remplacé refuse avant modification. Les SHA synthétiques comparent des métadonnées SQL, ils ne prouvent pas les octets PDF. |
| S3 forme | Une copie client inclut des coûts privés ou accepte des ancres/centimes/arbre incohérents. | Snapshot client1 complet, contre-exemples avec champs supplémentaires, centimes fractionnaires, doublons et cycle; aucune validation fondée sur un simple hash fourni. Les cas combinatoires du parser restent dans sa régression précode séparée. |
| S4 | Passage manuel `draft→sent` sans document1/proof1/seal5 ou avec une preuve différente. | RPC de transition réelle, refus sans seal/statut/événement, succès avec document puis aucun dispatch/capacité. Ce succès SQL n’est pas la recette de l’interface manuelle. |
| S5 | Un nouveau lien de renvoi décide un parent déjà `sent` alors que son propre dispatch n’a pas abouti. | POUR CHACUN de `preparing/queued/processing/unknown/failed`, accepter ET refuser doivent échouer avec état intégral identique. POUR CHACUN de `sent/delivered/bounced`, vérifier dispatch propre, provider_id, sent_at et document puis décisions positives séparées. |
| Preuve fournisseur | `sent_at` ou `provider_id` sont remplacés après succès, ou le statut réussi régresse. | Écritures directes refusées, completion rejouée conserve la date d’origine, webhook `sent→delivered/bounced` conserve la preuve. Ce n’est pas une livraison fournisseur réelle. |
| S6 rollback | Acceptation ou refus laisse statut/token/frères/événement/audit partiels. | Deux failpoints distincts pour CHAQUE décision: BEFORE version_event et AFTER audit INSERT. Le second vérifie une vraie ligne audit déjà présente. Exact P9001 + compte de hit non transactionnel + état intégral identique. |

## Exécution future autorisée et conservation

`src/test/fixtures/estimate-offer-contract-regression.sql` commence par `BEGIN`, utilise seulement des acteurs et données synthétiques `ARMY` sous préfixe UUID `efca0700`, des rôles PostgreSQL existants et des claims transactionnels sans jeton signé. Pas d’Auth API ni seed persistant. Aucun trigger existant n’est désactivé ou remplacé. Les fonctions/trigger de failpoint sont temporaires ou ajoutés dans la transaction, puis disparaissent par le P9001 terminal.

Avant d’exécuter, le runner doit prouver une base native locale isolée/qualifiée, absence de toute autre fenêtre DB, connexion `postgres`, aucun identifiant fixture existant, signatures **futures** et colonnes exactes disponibles. Si la migration n’existe pas, la fixture sort avec `missing-precondition`, sans présenter des cas comme RED produit. Ne pas lancer ce fichier sur Supabase hébergé ni avec un secret distant. L’autorisation de migration locale donnée au root reste la seule autorité d’application.

Le runner externe conserve, avant et après le P9001 terminal, un digest indépendant des données, catalogue (OID, corps, ACL effectives, owner, invoker, search_path), triggers, policies, contraintes, indexes et historique migrations. Aucune ligne/historique/OID/corps/ACL ne doit changer lors de la fixture. Il capture SQLSTATE terminal **P9001**, le JSON des cas, le SHA du fichier réellement envoyé et l’environnement. `allPassed=true` sans rollback et conservation indépendants est insuffisant.

Les images complètes restent internes à PostgreSQL. Le rapport contient seulement noms de cas, booléens et erreurs bornées; ni token, URL de capacité, lease réel, credential ni contenu d’utilisateur. Les identifiants synthétiques et SHA factices sont des comparateurs; les erreurs ne doivent pas exporter le SQL dynamique ou des corps sensibles.

La fixture utilise le moteur1 pour ses contrôles documentaires et transactionnels, sans inventer le contexte financier moteur2. Les montants et copies synthétiques ne qualifient ni justesse financière moteur1 ni freeze moteur2. Les recettes Army OF01/OF02, captures PDF/HTML, hash réellement recalculé en TypeScript et production restent nécessaires.

## Preuves expressément absentes

- **Historique positif:** préserver un vrai PDF/CGV/seal historique choisi avant migration et sa preuve indépendante, puis une recette dédiée. Cette fixture ne transforme pas un `sent` seedé ou un SHA factice en offre historique admissible.
- **Concurrence:** deux sessions réelles requises. Reservation: session A réserve et bloque avant commit observé; B même request doit attendre le verrou puis retourner même dispatch/capacité/URL/identité, B enveloppe différente refuse. Décision: A accepte sous verrou observé, B refuse après commit avec un seul événement et frères expirés. Completion vs décision: barrière `pg_blocking_pids`, timeout borné, aucun `40P01`, preuve fournisseur conservée. Deux appels successifs ne qualifient aucun de ces cas.
- **Reprise request1:** inventorier les vrais états historiques preparing/queued/processing/unknown/failed/success avant migration et rejouer les enveloppes originales. Aucun backfill d’identité ou de lien à partir de données vivantes; signatures inchangées ne prouvent pas la compatibilité.
- **Suppression/relink document et marqueurs:** les refus directs testés protègent les nouvelles publications; parser, portail, export et absence de fallback historique doivent aussi être vérifiés par HTTP sur la copie réelle.

Les futurs messages SQL d’intégrité peuvent évoluer; la fixture exige les classes précises `42501` (écriture interdite), `40001` (fencing/rejeu), `22023/23514` (preuve/snapshot invalides), `23505` (idempotence) et compare l’état complet. P9001 est réservé aux failpoints dont le hit doit être prouvé, jamais accepté comme un refus d’intégrité ordinaire.

## Delta précode 02 — identité de réservation figée

Le root a retenu avant DDL l’allowlist exacte de `offer_identity_snapshot`: `{ schemaVersion: 1, version: { id, tenantId, projectId, contentRevision }, project: ClientContract1.project, issuer: ClientContract1.issuer, company: ClientContract1.company }`. Toutes les clés sont requises, aucune propriété supplémentaire n’est admise, et les règles de chaînes/null sont celles de client1. La réservation positive compare l’objet intégral à cette image, avec les ancres réelles du dispatch/version/projet. Un renvoi par le propriétaire, après une première émission par l’admin, doit conserver l’émetteur original du document même si `created_by` devient le propriétaire. Le manifeste initial reste conservé; `revision02/manifest.json` enregistre ce delta avant migration.

## Delta précode 03 — bloqueurs trouvés à la revue, avant correction

La revue indépendante du candidat DDL `66c746e754b90eabbc21c3119f7efa837a79d0fc0ea90b59438869e4c6120395` a repéré un contrôle de document placé dans le trigger de `portal_tokens` et une confusion entre SQL NULL et JSON `null`. Ce sont des constats de source; leur reproduction PostgreSQL reste à exécuter par le root. Aucun correctif DDL n’est inclus dans cette préparation.

| Cas | Défaillance à reproduire avant correction | Assertion et justification spécialiste |
| --- | --- | --- |
| `reserve-replay-identity` déjà existant | Une réservation normale échoue avec `42703` lorsque le trigger token tente de lire `client_contract_version`, champ absent de `portal_tokens`. | Ce positif existant exige une vraie capacité et son identité/URL, donc ne peut réussir après `42703`. Ne pas ajouter `42703` aux erreurs acceptées ni le convertir en prérequis manquant. |
| `publication-ready-without-client-contract` ajouté | Une écriture service fait passer un document réellement `processing` sous claim à `ready` avec marker/snapshot NULL; le contrôle manquant dans le bon trigger laisse publier un nouveau document historique artificiel. | Appel réel `begin_estimate_pdf_generation` manuel puis UPDATE avec chemin/hash/claim/layout/CGV valides et seules copie/marker absents. Exiger `23514/42501` et état complet identique. Ce chemin évite la réservation cassée et isole le défaut document. L’interface ne propose pas cette écriture directe. |
| `publication-included-terms-json-null` ajouté | `includeTerms=true` avec `p_terms_snapshot='null'::jsonb` est admis parce que `IS NULL` ne reconnaît que SQL NULL. | Appel réel de publication manuel avec claim/snapshot valides, layout incluant les CGV et JSON `null` explicite; exiger `22023/23514` et conservation intégrale. Le parser TS rejette déjà ce cas: seul ce probe teste un appel direct à la frontière SQL, sans imiter le parseur ni fabriquer une sortie PDF. |

La version105 exacte et sa documentation sont conservées dans `revision03/baseline105/`; les manifestes initiaux restent inchangés. La nouvelle version contient107 cas et ne qualifie toujours aucun PDF, envoi, hash cryptographique ou concurrence. L’inversion de verrouillage signalée entre préparation et décision doit être corrigée et qualifiée séparément avec deux sessions; ces deux nouveaux cas séquentiels ne peuvent pas prouver une absence de deadlock.

## Delta préparation 04 — hiérarchie de fixture, sans correction DDL

Le run root `.e2e/offer-emission/sql-runs/red-candidate-20261013-01` s’est arrêté pendant le setup avec `P0001`, « Une ligne doit etre rattachee a une section », dans `validate_estimate_item_hierarchy_depth`, ligne61. La conservation indépendante est confirmée, mais aucun des107 cas n’a été qualifié : ce setup échoué n’est pas107 RED produit.

La fixture d’origine comportait des lignes racines alors que la garde actuellement installée exige leur rattachement à une section. Cette révision crée de vraies sections racines dédiées et rattache chaque ligne à sa section dans la même version. Client1 reprend ces deux lignes commerciales (section puis article), leurs IDs, parents, positions, profondeurs et montants; le footer reste10000/2000/12000. La copie du schéma accepte théoriquement des lignes racines, mais cette préparation ne prétend pas exécuter leur création sous la garde actuelle.

La préparation107 précédente et sa documentation restent dans `revision04/baseline107/`. Le compte reste107; le candidat DDL `66c746…` demeure strictement inchangé. Nouveau run/artefact nécessaire; aucun SQL n’est lancé par cette correction de préparation.

## Révision05 — résultats RED exécutés par le root et correction

Le root a exécuté `red-candidate-20261013-02`:107 cas,10 passants et97 échoués, avec rollback et conservation indépendante. Parmi les échecs,94 portent `42703` à la création normale de capacité; `publication-ready-without-client-contract` échoue avec `P0001` parce que le refus attendu n’a pas lieu; `reserve-rollback` ne peut atteindre son failpoint; `catalog-all-overloads` s’arrête avec `55000`. `manual-success` passe.

**`publication-included-terms-json-null` passe déjà le refus attendu.** Une protection existante empêche sa publication malgré la lacune du helper. Ce cas n’est donc pas un RED JSONnull observé et la revue de source seule ne prouve pas un contournement exploitable. La correction harmonise néanmoins les gardes SQL NULL/JSON `null` pour qu’aucune nouvelle frontière ne dépende accidentellement de cette protection.

La fixture de catalogue déclare un record `p` puis réutilise `p` comme alias dans le SELECT qui doit initialiser ce record. Cette collision peut produire « record non assigné » (`55000`) avant le premier appel de rôle. Les neuf noms de fonctions inspectés sont des RPC ordinaires, pas des fonctions trigger. La correction de préparation renomme **seulement l’alias SQL** en `proc_row`; elle ne change aucun rôle, droit, appel réel, classe `42501` attendue ou verdict. Le prochain run doit confirmer cette cause; `55000` n’est pas ajouté aux résultats permis et aucune réussite de catalogue n’est encore déclarée.

Le contrôle Doc1 déplacé vers le vrai trigger document, la reconnaissance JSONnull et l’ordre `prepare dispatch→version→acteur/tenant→document` corrigent le candidat, sans changer de signature. L’absence de deadlock reste non prouvée et exige deux sessions réelles. Les sources RED antérieures sont conservées dans `revision05/baseline107-red02/`; aucun SQL n’est exécuté par cette révision. Le compte reste107.
