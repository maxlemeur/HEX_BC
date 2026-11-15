# Transcription des pièces : reçu de la migration sur la base partagée

La migration de la table des transcriptions automatiques a été appliquée le 15 novembre 2026 sur la base Supabase
partagée, qui sert aussi la production, avec l'accord explicite du propriétaire. Elle a été appliquée après la fusion
de sa PR. Aucune donnée n'a été écrite et aucun déploiement n'a été fait.

## Source et identité

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261115213853_intake_document_transcriptions.sql](../../supabase/migrations/20261115213853_intake_document_transcriptions.sql) | [#353](https://github.com/maxlemeur/HEX_BC/pull/353) (`50993775`, 22:35:24 UTC) | `20261115223706` | 5 513 | 1 |

La ligne d'historique porte le nom du fichier sans extension. Ces trois SHA-256 sont égaux à
`eb1b0c1ceee7ac0ae0a6f909c83ed924dc512217b9bfa2d8403add8bbcd8ca84` :

- celui du fichier sur `main` ;
- celui du [manifeste](../../supabase/migrations.manifest.json) ;
- celui du SQL enregistré (`sha256(statements[1])`).

Le fichier est en LF, sans tabulation, et se termine par un saut de ligne.

Avant l'application, l'historique comptait **407 lignes**, sans aucune ligne `%intake_document_transcriptions`. Ni la
table ni la contrainte `affaire_intake_documents_id_tenant_key` n'existaient. Ces 407 lignes gardent ensuite le même
SHA-256 :

- formule : `sha256(string_agg(version||name||array_to_string(statements, E'\n'), E'\n' order by version))` ;
- valeur : `8a37267e2f68e79acd5d4f1a3e6c5834d230ff71db9a12fbec90397c17d5debb`.

L'historique compte désormais **408 lignes**, et seule la ligne de cette migration s'est ajoutée.

## Effet sur le catalogue

**Pièces du dossier.** `public.affaire_intake_documents` porte la contrainte unique
`affaire_intake_documents_id_tenant_key (id, tenant_id)`. Elle est toujours satisfaite, puisque `id` est déjà la clé
primaire.

**Table des transcriptions.** `public.affaire_intake_document_transcriptions` existe et ne contient aucune ligne. Elle
porte :

- ses 13 contraintes, dont la clé étrangère `(document_id, tenant_id)` vers la pièce, en `on delete cascade` ;
- le déclencheur `touch_affaire_intake_document_transcription`.

**RLS.** Elle est activée et forcée, avec une seule politique, « Piece readers read its transcription », en lecture
pour `authenticated`.

**Droits de table :**

- `SELECT` pour `authenticated`, rien pour `anon` ;
- pour `service_role`, `SELECT`, `INSERT`, `UPDATE` et `DELETE`. Il reçoit en plus `REFERENCES`, `TRIGGER` et
  `TRUNCATE` par les privilèges par défaut du schéma, comme les autres tables : c'est une réserve d'ACL, sans SQL
  ajouté.

Un membre ne peut donc jamais écrire une transcription.

**Fonction du déclencheur.** `private.touch_affaire_intake_document_transcription()` est en INVOKER, avec un
`search_path` vide. `authenticated` ne peut pas l'exécuter.

## Advisor de sécurité

L'advisor de sécurité a été relevé juste avant et juste après l'application. Il montre les mêmes catégories et les
mêmes nombres, sans aucun niveau ERROR :

- `rls_enabled_no_policy` (INFO, 26) ;
- `authenticated_security_definer_function_executable` (WARN, 81) ;
- `auth_leaked_password_protection` (WARN, 1).

Aucune alerte ne cite la nouvelle table.

## Qualification et limites

La qualification est celle de la PR #353, sur des piles locales possédées : le fichier
[intake-document-transcriptions.test.sql](../../supabase/tests/database/intake-document-transcriptions.test.sql)
(20/20), toute la suite pgTAP et la matrice RLS. Rien n'a été rejoué pour ce reçu.

Ce reçu ne prouve que l'application et l'état du schéma. Il ne qualifie aucun parcours en production. La migration
est purement additive : le code déployé ne lit ni n'écrit cette table, et continue de fonctionner sans changement. La
transcription n'écrit que là où la connexion ChatGPT locale est activée, ce qui n'est pas le cas en production.
