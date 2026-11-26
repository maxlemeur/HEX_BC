# Base de données et exploitation

Le schéma de référence est l'historique ordonné de [migrations/](migrations/),
contrôlé par [migrations.manifest.json](migrations.manifest.json).
`schema.sql` est un pointeur documentaire, pas un dump à exécuter.
Les commandes ci-dessous partent de la racine du dépôt avec le Node de `.nvmrc`
et les dépendances installées par `npm ci`.

## Vérifier localement

```bash
npm run supabase:validate
npm run db:ci:local
```

Le [runner local](../src/test/local-supabase-ci.ts) utilise la CLI épinglée dans
`package.json` et son runtime natif, sans Docker. Il prépare une copie isolée de
`supabase/`, active `experimental.stack` dans cette copie et choisit des ports
propres. Il rejoue les migrations, contrôle leur inventaire et les types générés,
puis exécute pgTAP et la matrice RLS sur des comptes jetables.
Il refuse une configuration distante ; il arrête et détruit sa pile et son
répertoire de travail en fin d'exécution, y compris en échec.

Les prérequis vérifiés par le runner sont macOS 14+ sur Apple silicon ou Linux
avec glibc 2.35+, sous un compte non root. Sous Windows, utiliser un environnement
Linux compatible (par exemple WSL) avec ses propres dépendances. Le premier
lancement télécharge les services dans le cache Supabase de l'utilisateur.
Pour une pile de développement persistante, lancer `npm run supabase:local -- start`.
Elle est partagée entre les checkouts de l'utilisateur. Ajouter
`--checkout <chemin>` à `start` pour écrire aussi le fichier ignoré
`.env.supabase.local` dans un autre checkout. `status` affiche l'état et le
chemin des identifiants privés, `stop` arrête les services en gardant les
données et `destroy --yes` efface cette pile après confirmation explicite.
Les données et le compte de développement sont des fichiers uniques à
conserver sous `~/.supabase/`, indépendamment des builds régénérables.
Pour une pile de recette jetable, utiliser
[la boucle de développement](../docs/testing/tester-army-local-development.md).

## Ajouter une migration et régénérer les types

1. Lire les migrations et les contrôles serveur/RLS du domaine concerné.
2. Créer le fichier avec la CLI installée :

   ```bash
   npx supabase migration new nom_de_la_modification
   ```

3. Écrire le SQL et sa régression dans [tests/](tests/). Ne jamais réécrire une
   migration appliquée ni supprimer des données pour obtenir un contrôle vert.
4. Enregistrer le manifeste et vérifier le garde :

   ```bash
   npm run supabase:manifest:add
   npm run supabase:migrations:git-guard
   npm run supabase:types
   ```

5. Relire le diff du schéma et des types, lancer les parcours affectés puis
   `npm run verify:pr` sur le code final.

`supabase:types` possède sa pile jetable et exécute les contrôles SQL/RLS.
Il génère deux sorties identiques, nettoie la pile puis publie atomiquement
[`database.generated.ts`](../src/types/database.generated.ts).
Ne pas modifier ce fichier à la main. Les raffinements non introspectables
restent dans [`database.ts`](../src/types/database.ts).
`check:database-types`, inclus dans `verify:pr`, vérifie les empreintes ; les
campagnes natives comparent aussi les types à la base réellement migrée.
Une commande `db:ci:local` déjà exécutée sur les mêmes entrées n'est pas à dupliquer.

Si `main` contient une migration plus récente, réconcilier la branche puis
utiliser le restamp **uniquement pour une migration non appliquée** :

```bash
npm run supabase:migrations:restamp -- supabase/migrations/<fichier>.sql --dry-run
npm run supabase:migrations:restamp -- supabase/migrations/<fichier>.sql
```

Le [garde](../src/test/supabase-migration-restamp.ts) exige une base intégrée,
un fichier suivi et un manifeste cohérent. Il refuse les migrations de la base
et celles enregistrées comme appliquées dans `docs/testing/shared-supabase-*`.
Il réécrit les références et relance les contrôles ; relire son diff avant commit.
En cas de conflit du manifeste, conserver tous les hashes appliqués et compléter
les nouvelles entrées avec `supabase:manifest:add`.

## Appliquer sur une base partagée

Une fois la migration relue et fusionnée dans `main`, l’appliquer sans demander
de feu vert supplémentaire pour la migration. Si son SQL effectue une
[opération soumise à accord](../AGENTS.md#actions-requiring-the-owners-go),
vérifier que cet accord couvre l’opération avant l’exécution. Vérifier le projet
cible sans afficher ses secrets et comparer son historique aux fichiers de
`main`. Appliquer les migrations manquantes dans l’ordre, avec leur SQL exact.
Contrôler ensuite l’historique, les objets ciblés et les advisors de sécurité,
puis publier le reçu.
La [préparation du lot 3.3](../docs/testing/lot-3-3-shared-consolidation-2026-10-25.md)
conserve sa qualification locale ; le [reçu d'application](../docs/testing/shared-supabase-lot-3-3-2026-10-25.md)
rapporte les contrôles réellement exécutés sur le partagé.

Les quatre versions historiques `20260222`, `20260304`, `20260305`, `20260306`
peuvent manquer dans les historiques distants anciens alors que leurs effets
existent. Le runner local compare les versions comme des ensembles. Ne pas
les renommer ou les rejouer, ni utiliser `db push --include-all` pour forcer un
rattrapage partagé : vérifier le catalogue et l'historique effectifs, puis
appliquer les nouvelles migrations explicitement (par exemple via MCP).
Pour une base entièrement neuve et autorisée, `supabase db push` est possible
après vérification de sa cible liée et du plan de migrations.

Le [réglage Vercel](../vercel.json) désactive les déploiements Git. Avant une
publication autorisée, appliquer ses migrations requises ; avec des données
moteur 3, ne pas revenir à une application antérieure à leur prise en charge.

## Données de test

Les parcours gardent les affaires qu'ils créent ; sur une pile possédée elles
disparaissent avec elle. Sur le partagé, qui sert aussi la production, le
[workflow de purge](../.github/workflows/purge-test-data.yml) appelle chaque lundi
à 03:40 UTC `GET /api/internal/test-data/purge` via
[`purge-test-data.mjs`](../scripts/purge-test-data.mjs), avec `CRON_SECRET`.
La route exécute `public.purge_test_tenant_drafts` (service role uniquement) par
lots de 25 pendant au plus 240 secondes ; chaque appel SQL s'arrête après
4 secondes, sous le délai de 8 secondes des requêtes API. Un passage interrompu
par son budget est repris la semaine suivante.

- Seuls les tenants de `private.test_data_tenants` sont visés : leurs affaires
  dont toutes les versions sont des brouillons non modifiés depuis la rétention
  du tenant (7 jours par défaut) sont supprimées, archivées comprises, avec leurs
  journaux d'intake. La suppression produit refuse, elle, une affaire archivée.
- Une affaire de `private.test_data_retained_projects` est conservée, par exemple
  la fixture du [benchmark affaire](../docs/testing/tester-army-performance.md).
  Ces deux listes ne s'écrivent ni par l'API ni par l'application : migration
  relue ou SQL du propriétaire.
- Les objets Storage restent, comme pour la suppression produit ; leurs chemins
  commencent par l'identifiant du tenant.
- Un déclenchement manuel liste par défaut (`dry_run`) sans supprimer. Le job
  échoue si une suppression échoue et n'affiche que des compteurs. Une affaire en
  échec est reprise à chaque passage : chercher sa cause (avertissement
  `purge_test_tenant_drafts failed` des logs Postgres), ou la lister parmi les
  affaires conservées.
- La planification ne tourne que si la variable GitHub `TEST_DATA_PURGE_ENABLED`
  vaut `true`. La poser après l'application de la migration, le déploiement de la
  route et la relecture d'un déclenchement manuel à blanc.

## Sauvegarde et restauration

Le [workflow de sauvegarde](../.github/workflows/supabase-backup.yml) est
planifié à 02:25 UTC et peut être déclenché manuellement. Il produit un dump
custom unique de `public`, `private`, `auth`, `storage` et un inventaire des rôles
sans mots de passe. L'archive CMS chiffrée est retenue 30 jours ; les dumps en
clair sont supprimés. **Les binaires Storage ne sont pas dans ce dump.**

Configuration du workflow :

- `SUPABASE_DB_URL` : connexion Postgres percent-encoded, directe ou pooler en
  mode session. Le rôle de sauvegarde doit lire les données nécessaires, y compris
  celles protégées par RLS ; ne pas utiliser ses identifiants dans l'application.
- Le workflow impose `sslmode=verify-full` avec le [certificat CA](../.github/supabase-ca.crt)
  et utilise une image PostgreSQL fixée par digest. Le certificat public de
  chiffrement est [backup-recipient.pem](../.github/backup-recipient.pem).
- La clé privée reste hors GitHub. Conserver chaque ancienne paire certificat/clé
  tant que les sauvegardes chiffrées avec elle existent.
- `BACKUP_ALERT_WEBHOOK` est facultatif ; l'absence de webhook ne désactive pas
  l'échec du job. Vérifier le résultat du workflow, pas seulement sa planification.

Déchiffrer et inspecter **hors du dépôt, dans un répertoire privé** :

```bash
umask 077
timestamp=AAAAMMJJThhmmssZ
cert_path=/chemin/vers/le-certificat-correspondant.pem
key_path=/chemin/hors-github/la-cle-privee-correspondante.pem
openssl cms -decrypt -binary -inform DER -in "supabase-backup-${timestamp}.tar.gz.cms" \
  -recip "$cert_path" -inkey "$key_path" -out "supabase-backup-${timestamp}.tar.gz"
tar -xzf "supabase-backup-${timestamp}.tar.gz"
pg_restore --list "$timestamp/database.dump"
```

`roles.sql` est un inventaire à relire, jamais un script à appliquer aveuglément.
La restauration demande une cible compatible avec les rôles, extensions et
objets Supabase, et un compte d'administration distinct. `pg_restore --exit-on-error`
doit arrêter à la première erreur ; `--no-owner` et `--no-privileges` n'effacent
pas les dépendances des policies et fonctions. Une restauration distante demande
une autorisation spécifique. Nettoyer les dumps en clair après usage.

`npm run verify:backup-restore` vérifie SQL/RLS, chiffre un dump réel de sa pile
jetable, le restaure dans une seconde base et compare les empreintes des données,
les compteurs privés et un refus RLS. Les reçus et logs sont sous
`outputs/backup-restore/` ; les dumps, clés de fixture et bases sont nettoyés.
Ce contrôle ne qualifie ni le transport Docker/TLS de production, ni une
restauration hébergée, ni les fichiers Storage.

## Reprise des tâches et emails

Le [planificateur](../.github/workflows/recover-durable-fallback.yml) appelle
`GET /api/internal/workflows/recover` toutes les cinq minutes via
[`check-durable-recovery.mjs`](../scripts/check-durable-recovery.mjs).
Il lit `HEX_APP_URL` (ou `APP_URL`) et `CRON_SECRET` ; ne jamais journaliser le
secret, le corps brut ou les erreurs fournisseur contenant des données métier.

La suppression d'une affaire inscrit les objets de ses demandes de matériel
dans `procurement_storage_cleanup_outbox` dans la même transaction. La reprise
planifiée retire leurs photos et pièces jointes du bucket privé
`material-requests` via l'API Storage. Les opérations sur les bons continuent
de réclamer les objets du bucket `devis` à part. La reprise réserve un lot à
chaque bucket pour éviter qu'une rafale de photos retarde les documents des bons.
Appliquer la migration TI-695
avant de déployer le worker qui réclame les deux buckets.

Pour les métrés du forfait ChatGPT local, la reprise clôt une analyse dont le bail a
expiré (résultat inconnu). Une fois les avis de fin activés, elle ne clôt une analyse qui
attend son Mac que selon la règle d’attente de
[`chatgpt-local.md`](../docs/testing/chatgpt-local.md) : Mac actif, inoccupé et
capable de la prendre pendant le délai de prise en charge, ou plafond d’attente dépassé. Les deux durées se règlent dans
`private.takeoff_completion_activation` (`pickup_grace`, 15 min ; `wait_ceiling`, 24 h).
Avant l’activation, elle répond comme avant ces avis.

Le script vérifie le contenu de la réponse, au-delà de HTTP 200 :

- Échecs individuels : avertissement, reprise partielle à examiner ; leur
  caractère temporaire n'est pas établi par le seul compteur.
- Budget épuisé, drain indisponible, réponse invalide ou `emailOutbox.blocked > 0` :
  job en échec. Les emails dont l'auteur n'est plus habilité sont comptés sans
  être envoyés ni réattribués ; le claim revalide les droits.
- Requête bornée à 280 secondes et 256 Kio, redirections refusées ; le workflow
  ne modifie pas les droits pour débloquer une file.

En incident, examiner les compteurs et la file concernée avec un accès autorisé,
contrôler tenant actif, auteur, bail et résultat fournisseur avant toute reprise
manuelle. Ne pas libérer un envoi ambigu au risque de l'envoyer deux fois.
Les régressions du contrôle HTTP sont dans
[`durable-recovery-command.test.ts`](../src/test/durable-recovery-command.test.ts).
