# MergeOne — chiffrage BTP

MergeOne (dépôt historique `HEX_BC`) accompagne une affaire, du dépôt des pièces
DPGF/plans/CCTP au devis, à sa validation et aux commandes fournisseurs.
Le code utilise Next.js App Router, React, TypeScript, Supabase et Tailwind ;
[package.json](package.json) et le lockfile fixent les versions.

## Démarrer

1. Utiliser le Node indiqué dans [`.nvmrc`](.nvmrc) : `26.12.1`.
2. Installer les dépendances et préparer la configuration locale :

   ```bash
   npm ci
   cp .env.example .env.local
   ```

3. Renseigner `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   pour une base autorisée et migrée. Ces deux valeurs initialisent les clients ;
   elles ne suffisent pas aux opérations privilégiées, à l'IA ou à l'envoi d'emails.
   Les variables et leurs options sont décrites dans [`.env.example`](.env.example).
4. Lancer `npm run dev`, ouvrir `http://localhost:3000/login` et utiliser un compte
   disposant d'une adhésion au tenant visé. `GET /api/health` renvoie `200` et
   `db: "up"` si la base répond ; cela ne qualifie pas un parcours métier.

Pour préparer une base et les types, suivre [le guide Supabase](supabase/README.md).
Pour un développement avec une pile locale et des comptes jetables gérés par le
runner, suivre [le guide local](docs/testing/tester-army-local-development.md).
Ne pas remplacer une configuration partagée existante sans vérifier sa cible.
Les secrets et comptes de test restent dans le coffre d'équipe ou un fichier local
ignoré ; aucune clé `service_role` ne doit parvenir au navigateur.

Si le port est occupé, `npm run dev -- -p 3001` choisit un autre port.
Un seul serveur de développement peut détenir `.next/dev/lock` par checkout.

## Vérifier une modification

| Besoin | Commande |
|---|---|
| Types / lint | `npm run typecheck` / `npm run lint` |
| Qualité avant livraison de code | `npm run verify:pr` |
| Parcours affecté sur pile locale jetable | `npm run e2e:army:local -- --grep '<pattern>'` |
| Migrations et RLS locales | `npm run db:ci:local` |
| Préparer une publication autorisée | `npm run check:release` |

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
déploiements Git. Migration partagée et déploiement demandent chacun leur autorisation.
