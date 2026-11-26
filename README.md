# MergeOne — chiffrage BTP

MergeOne (dépôt historique `HEX_BC`) accompagne une affaire, du dépôt des pièces
DPGF/plans/CCTP au devis, à sa validation et aux commandes fournisseurs.
Le code utilise Next.js App Router, React, TypeScript, Supabase et Tailwind ;
[package.json](package.json) et le lockfile fixent les versions.

## Démarrer

1. Utiliser le Node indiqué dans [`.nvmrc`](.nvmrc) : `26.12.1`.
2. Installer les dépendances avec `npm ci`.
3. Lancer `npm run supabase:local -- start`. La commande démarre ou reprend la
   pile native, applique les migrations et écrit `.env.supabase.local`. Le chemin
   du fichier privé contenant les identifiants du compte de développement est
   affiché au démarrage et par `npm run supabase:local -- status`.
4. Lancer `npm run start`, ouvrir `http://localhost:3000/login` et se connecter
   avec ce compte. Une configuration Supabase locale existante
   peut aussi venir des variables du shell ou d’un fichier Next habituel.
   Le lanceur refuse une URL distante dans ce mode.

Pour une pile jetable et des comptes de recette, suivre [le guide TesterArmy](docs/testing/tester-army-local-development.md).
`GET /api/health` renvoie `200` et `db: "up"` si la base répond.

`npm run start` démarre le serveur de développement sur la boucle locale et
sélectionne Supabase selon le port.

| Ports | Base | Raccourci |
| --- | --- | --- |
| 3000 à 3009 | Supabase local | `npm run start:local` sur 3001 |
| 4200 à 4209 | Supabase de production avec les droits du compte connecté | `npm run start:prod` sur 4200 |

`npm run start` utilise le port 3000 par défaut. Pour choisir un autre port, par
exemple si le port est occupé, utiliser `npm run start -- --port 3002`. L’option
`--port` (ou `-p`) prend le dessus sur la variable `PORT`.
Pour servir un build Next.js existant, utiliser `npm run start:build`.

- `npm run dev:prod -- --port 4200` cible aussi la production avec les droits du compte connecté.
  Renseigner l’URL HTTPS et la clé publique ensemble dans `.env.local` ou, à
  défaut, dans `.env`.
  Le forfait ChatGPT local et les opérations qui exigent la clé de service
  Supabase, dont le lancement et la lecture d’un métré, sont indisponibles.
- `npm run dev:prod:full -- --port 4200` exige les trois valeurs de production dans le fichier
  ignoré `.env.supabase.production.local` au côté de `.env.supabase.local`.
  Y renseigner `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et
  `SUPABASE_SERVICE_ROLE_KEY`. Les opérations serveur qui utilisent ce rôle
  peuvent écrire sur la production. Le métré et la lecture des plans avec le
  forfait ChatGPT local sont disponibles. L’envoi d’e-mails suit
  `EMAIL_DELIVERY_MODE` comme dans les autres modes.

Dans `.env.local` et `.env`, garder seulement l’URL et la clé publique pour
Supabase en production. Next charge ces fichiers lors d’un lancement direct.
Déplacer toute clé de service de production déjà présente dans le fichier
dédié au mode complet, que seul le lanceur lit.

Les lanceurs qui ciblent Supabase de production écoutent uniquement sur la boucle
locale. Pour changer de cible, arrêter le serveur et relancer la commande
correspondante. Le lanceur distingue les cibles dans le cache Turbopack et
arrête le serveur s’il détecte une boucle de rendu.

Les secrets restent dans le coffre d’équipe ou dans les fichiers locaux
ignorés. Pour les autres variables, voir [`.env.example`](.env.example).
Si le port est occupé, `npm run dev -- -p 3001` choisit un autre port.
Un seul serveur de développement peut détenir `.next/dev/lock` par checkout.
Ne pas ajouter `--webpack` à cette commande : à la première visite d'une page, le
compilateur par défaut (Turbopack) compile l'éditeur de devis et ses routes API en
7 s au lieu de 20 s, avec deux fois moins de mémoire.

## Vérifier une modification

| Besoin | Commande |
|---|---|
| Types / lint | `npm run typecheck` / `npm run lint` |
| Boucle rapide pendant une itération | `npm run verify:fast` |
| Qualité avant livraison de code | `npm run verify:pr` |
| Parcours affecté sur pile locale jetable | `npm run e2e:army:local -- --grep '<pattern>'` |
| Migrations et RLS locales | `npm run db:ci:local` |
| Préparer une publication (ne déploie rien) | `npm run check:release` |

Une modification documentaire nécessite une vérification des références et du diff.
Les prérequis, suites, fixtures et preuves sont dans [le guide de tests](e2e/README.md).
Les commandes complètes restent dans [package.json](package.json).

## Repères

- [Documentation](docs/README.md) : règles de calcul, cycle du devis, parcours,
  sécurité et exploitation.
- [AGENTS.md](AGENTS.md) : contrat de contribution, limites d'autorisation et
  vérifications attendues.
- [API OpenAPI](openapi.json) : contrat généré depuis
  [`src/lib/openapi`](src/lib/openapi/), consultable sur `/api/docs` en développement et en preview Vercel.
  En production, cette interface nécessite `ENABLE_OPENAPI_DOCS=1`.
- [CHANGELOG.md](CHANGELOG.md) : versions gérées par Release Please.

Le push ne déploie pas l'application : [vercel.json](vercel.json) désactive les
déploiements Git. Après fusion, appliquer les migrations relues selon le guide de la base partagée. Le déploiement demande l’accord du propriétaire.
