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
Pour démarrer l'application sur une pile possédée et la garder le temps du travail,
utiliser [la boucle de développement](../docs/testing/tester-army-local-development.md).

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

L'application distante exige une autorisation propre, distincte du commit et
du déploiement. Vérifier le projet cible sans afficher ses secrets, lire son
historique de migrations et comparer aux fichiers du checkout à publier.
Puis appliquer uniquement les migrations manquantes autorisées dans l'ordre,
avec leur SQL exact ; contrôler ensuite l'historique, les objets ciblés et les
advisors de sécurité. Une preuve locale ne prouve pas cette application.

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
