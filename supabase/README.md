# Supabase (base de données)

## 1) Créer le projet Supabase

- Créez un projet Supabase (cloud) ou utilisez Supabase local via le CLI.
- Activez l'authentification Email/Password dans **Authentication**.

## 2) Initialiser le schéma

> ⚠️ **N'exécutez pas `supabase/schema.sql`.** Ce n'est plus un dump : fichier-commentaire
> uniquement, sans instruction destructive. L'ancien dump a été retiré parce qu'il détruisait
> notamment les tables tenant / membership. L'historique Git le conserve.
>
> **La source de vérité du schéma, c'est `supabase/migrations/`.** Le nombre de fichiers et le
> nom du dernier fichier ne sont pas un contrat figé.

Sur une base **neuve**, appliquez les migrations dans l'ordre :

```bash
supabase link --project-ref <ref>
supabase db push
```

La preuve locale canonique est une commande unique :

```bash
npm run db:ci:local
```

Elle utilise la CLI Supabase `2.121.0` épinglée dans le projet et son **runtime
natif** : chaque service tourne comme un processus local, **sans Docker**. Ce runtime
est supporté sous Linux (glibc 2.35 ou plus) et sous macOS 14+ sur Apple silicon,
jamais en root ; sous Windows, lancez la commande dans WSL (Ubuntu 22.04 ou plus)
depuis un clone Linux du dépôt, dont le `node_modules` contient le binaire Linux de
la CLI. Le premier lancement télécharge les archives des services
(`supabase/slim-services`) dans `~/.supabase/cache`.

La commande crée une pile à ports uniques dans une copie isolée de `supabase/`, où
elle active `[experimental] stack = true` (jamais dans le `config.toml` du dépôt),
rejoue les migrations sans seed, compare l'inventaire appliqué, exécute pgTAP puis
la matrice RLS avec trois utilisateurs Auth locaux. Dans son bloc de cleanup, elle
arrête la pile, la détruit avec ses données (`stack destroy`) et supprime son workdir
isolé ; un échec de ce cleanup fait échouer la commande. Elle refuse les variables
et commandes qui pourraient cibler un projet distant.

La sauvegarde planifiée (`supabase-backup.yml`) utilise `pg_dump` et `pg_dumpall`
dans une image PostgreSQL fixée par digest sur le runner GitHub. L'exercice local
de restauration utilise les outils PostgreSQL du runtime natif existant ; aucun
poste de développement n'a besoin de Docker.

Les quatre versions date-only historiques (`20260222`, `20260304`, `20260305`,
`20260306`) sont, depuis la CLI 2.119, enregistrées dans l'historique local comme
toutes les autres ; la CLI les liste dans l'ordre des versions (`20260222` avant
`20260222001500`), le garde compare donc les inventaires comme des ensembles. Leurs
effets SQL sont couverts directement par pgTAP ; ne les renommez et ne les rejouez
jamais sous un nouvel identifiant sans preuve catalogue préalable.

L'historique **distant** de la production, lui, ne contient pas ces quatre versions :
un `supabase db push` les verrait en attente. La CLI refuse d'insérer des migrations
antérieures à la dernière version distante sans `--include-all` ; n'utilisez jamais
ce drapeau sur la production, et appliquez les nouvelles migrations par le runbook
MCP ci-dessous.

## 3) Ajouter une migration

1. Inspecter le schéma courant, l'historique, les RLS et l'autorisation serveur affectée.
2. Créer un fichier **horodaté en UTC** : `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case>.sql`.
   Ne jamais réécrire une migration déjà appliquée.
3. Ajouter son hash immuable avec `npm run supabase:manifest:add`.
4. Écrire du SQL **idempotent** (`if exists`, `create or replace`, `drop policy if exists`) et
   **non destructif** (pas de `drop table` en production).
5. Ajouter une régression structurelle ou comportementale ciblée.
6. Lancer `npm run supabase:migrations:git-guard`, puis `npm run db:ci:local`.
7. N'appliquer sur un projet partagé ou distant **que sur autorisation explicite de l'utilisateur**.

Si `main` a reçu une migration plus récente pendant la vie de la PR, le garde refuse la
vôtre. Juste avant la fusion, donnez-lui son horodatage final :

```bash
git fetch origin
git merge origin/main
npm run supabase:migrations:restamp -- supabase/migrations/<fichier>.sql --dry-run
npm run supabase:migrations:restamp -- supabase/migrations/<fichier>.sql
```

Si la fusion s'arrête sur `supabase/migrations.manifest.json` (les deux côtés y ajoutent
des entrées) : `git checkout --theirs supabase/migrations.manifest.json`, puis
`npm run supabase:manifest:add`, qui réinscrit les migrations de la branche sans changer
un hash déployé, et terminez la fusion.

L'outil refuse tant que la base (`--base`, `origin/main` par défaut) n'est pas fusionnée
dans la branche : sinon les fichiers qu'elle a ajoutés depuis le fork ne seraient ni
cherchés ni vérifiés. Il refuse un fichier présent sur la base, non suivi, absent ou
périmé dans le manifeste, ou qu'un rapport `docs/testing/shared-supabase-*` enregistre
comme appliqué au partagé : nom de fichier, nom MCP `<horodatage>_<slug>` ou ligne
`schema_migrations` (version égale à l'horodatage, puis nom égal au slug). Un horodatage
seul, comme dans une liste de migrations restant à appliquer, n'enregistre rien. Il
refuse aussi quand une autre migration ajoutée par la branche, non nommée, resterait
antérieure ou égale à la plus récente de la base : nommez-la aussi. Il prend un
horodatage UTC postérieur à la plus récente de la base, dans la tolérance du garde
(`--at` le fixe), garde l'ordre de plusieurs fichiers, fait le `git mv`, renomme la clé
du manifeste et réécrit puis liste les références à l'ancien nom ou horodatage dans les
fichiers suivis. Le hash ne change que pour une migration de la branche qui cite un
ancien horodatage, le sien ou celui d'une autre. Il lance enfin le garde Git
(`pull_request` contre la base) et la validation du manifeste, et sort en erreur si l'un
échoue. Relisez la prose réécrite avant de committer.

### Runbook d'application via MCP

Quand l'application distante est autorisée :

1. `mcp__supabase__get_advisors({ type: "security" })` — état avant migration.
2. `mcp__supabase__apply_migration` avec le nom du fichier et son contenu SQL exact, **dans l'ordre
   chronologique des migrations non encore appliquées**.
3. `mcp__supabase__get_advisors({ type: "security" })` — état après migration.
4. Contrôler les objets ciblés si nécessaire : `pg_policies` pour les tables concernées,
   `pg_proc.proconfig` pour le `search_path` des fonctions.

## 4) Variables d'environnement Next.js

Copiez `.env.example` en `.env.local` et renseignez :

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 5) Sauvegarde automatique (GitHub Actions)

Le workflow [`supabase-backup.yml`](../.github/workflows/supabase-backup.yml) exécute :

- un dump planifié chaque jour (`02:25 UTC`), également lançable manuellement
- un instantané PostgreSQL unique (`database.dump`, format custom) et un inventaire des rôles sans mots de passe (`roles.sql`), chiffrés dans un artefact `.tar.gz.cms` conservé 30 jours

Secrets requis dans GitHub :

- `SUPABASE_DB_URL` : URL Postgres **percent-encoded** (si le mot de passe contient des caractères spéciaux).

Utiliser une connexion directe ou le pooler en mode session (`5432`). Le rôle dédié `mergeone_backup_reader` possède `pg_read_all_data` et `BYPASSRLS`, sans appartenance à `postgres` ni privilèges d'administration. Il peut lire toutes les données, y compris Auth ; son secret est réservé au workflow de sauvegarde. Son défaut `default_transaction_read_only=on` prévient les écritures accidentelles, mais n'interdit pas les opérations que les privilèges `PUBLIC` autorisent. Ce rôle dans le projet existant ne crée ni abonnement ni instance supplémentaire. Les commandes `pg_dump` et `pg_dumpall` utilisent une image officielle PostgreSQL fixée par digest ; la commande Supabase CLI qui tente `SET ROLE postgres` ne convient pas à ce rôle.

La connexion impose `sslmode=verify-full` avec [le certificat CA Supabase](../.github/supabase-ca.crt), téléchargé depuis [l'hébergement officiel](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). Empreinte SHA-256 : `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. La vérification du certificat et du nom d'hôte précède l'authentification ; le simple mode `require` ne suffit pas à identifier le serveur.

Le certificat public de chiffrement est versionné dans [`.github/backup-recipient.pem`](../.github/backup-recipient.pem). Conserver sa clé privée de restauration hors de GitHub ; sans certificat valide, le workflow échoue avant le dump. Lors d'une rotation, conserver ensemble chaque ancienne clé privée et son certificat public tant que les archives chiffrées avec cette paire existent. La restauration d'une archive exige la paire qui a servi à son chiffrement, et non le certificat courant après rotation.

Inspection après déchiffrement (en dehors du dépôt, dans un répertoire privé) :

```bash
timestamp=AAAAMMJJThhmmssZ
cert_path=/chemin/vers/le-certificat-correspondant.pem
key_path=/chemin/hors-github/la-cle-privee-correspondante.pem
umask 077
openssl cms -decrypt -binary -inform DER -in "supabase-backup-${timestamp}.tar.gz.cms" \
  -recip "$cert_path" -inkey "$key_path" -out "supabase-backup-${timestamp}.tar.gz"
tar -xzf "supabase-backup-${timestamp}.tar.gz"
pg_restore --list "$timestamp/database.dump"
```

`roles.sql` est un inventaire à relire, pas un script à exécuter tel quel sur un Supabase géré : il inclut des rôles système et les attributs du rôle de sauvegarde. Pour une restauration, préparer une cible isolée compatible avec les rôles, extensions et objets Supabase référencés par le dump, puis employer un compte d'administration distinct du rôle de sauvegarde. `pg_restore --exit-on-error` doit arrêter la restauration à la première erreur. Les options `--no-owner` et `--no-privileges` ne retirent pas les dépendances des politiques RLS, fonctions ou extensions : une base PostgreSQL vide n'est pas une cible suffisante pour ce dump. Toute restauration distante exige sa propre autorisation.

Notes :

- Le dump SQL couvre les schémas `public`, `private`, `auth`, `storage`.
- Les binaires de Storage (fichiers objets) ne sont pas dans le dump SQL ; seul le metadata SQL est dumpé.

### Exercice local de restauration

`npm run verify:backup-restore` exécute les contrôles SQL/RLS de `db:ci:local`,
puis le pipeline de dump et chiffrement du workflow sur cette pile migrée
jetable. Il restaure le véritable dump custom dans une seconde base de ce
même cluster, avec les rôles et extensions compatibles. Il compare les
empreintes des données de toutes les tables et séquences des quatre schémas,
vérifie un compteur privé réel et le refus RLS d'une ligne restaurée. Les
bases, les dumps en clair et la clé de fixture sont supprimés après réussite
comme après échec. Le reçu sans secret est référencé dans
[`operations-recovery-lot1.md`](../docs/testing/operations-recovery-lot1.md).

L'adaptateur local remplace Docker et le transport TLS par les binaires natifs
contre la seule pile possédée par le runner. Cette preuve ne qualifie donc ni
une restauration hébergée, ni la connexion TLS de production, ni les octets des
documents Storage. Les contrôles de TLS, rôle de lecture et certificat du
workflow de production restent actifs.
