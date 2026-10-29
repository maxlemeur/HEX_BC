# Tester MergeOne

TesterArmy est le runner des parcours navigateur. Les contrôles SQL/RLS,
calculs, parseurs, courses et reprises restent dans leurs suites spécialisées.
Les commandes et versions de référence sont dans [package.json](../package.json),
[.nvmrc](../.nvmrc) et [e2e.config.ts](../e2e.config.ts).

## Choisir le contrôle

| Modification | Commande / preuve attendue |
| --- | --- |
| Documentation seule | Cohérence du contenu, liens et `git diff --check` |
| Code applicatif | `npm run verify:pr` sur le code final ; parcours affectés ci-dessous |
| Parcours utilisateur | `npm run e2e:army:local -- --grep '<motif>'` |
| SQL, RLS ou migration | `npm run db:ci:local`, puis parcours affectés ; voir [Supabase](../supabase/README.md) |
| Publication préparée | `npm run check:release` ; cela ne déploie rien |
| Régression de performance | [Mesures navigateur](../docs/testing/tester-army-performance.md) et [budgets SQL](../docs/testing/large-estimate-statement-budget.md) |

`verify:pr` exécute les audits de dépendances/signatures, l'hygiène du dépôt,
les types de base, l'architecture, OpenAPI, le typage, le lint, les gardes Army,
Vitest node/jsdom et la couverture critique. Les protections GitHub et leur
sélection sont décrites dans le [guide CI](../docs/testing/tester-army-ci.md).

## Démarrer un parcours local

Utiliser le Node de `.nvmrc`, un checkout sans `.env` ni variables Supabase/DB
héritées, avec ses dépendances installées dans sa racine. Si le checkout de
travail utilise un backend partagé, préparer un worktree de vérification isolé
sous `~/Projects/.workspaces/mergeone/` ; ne pas déplacer ses secrets.

```sh
npm ci
npx @e2e-dev/web install chromium --with-deps
npm run e2e:army:local -- --grep 'creation persists final French' --app-port 3118
```

Le runner possède sa pile native temporaire, applique les migrations et les
contrôles SQL/RLS, crée le compte et le tenant ARMY, construit l'application,
exécute la sélection et détruit la pile. Docker et un compte distant ne sont
pas nécessaires. Les données de cette pile disparaissent à la fin.
[Développement interactif et reprise](../docs/testing/tester-army-local-development.md).

```sh
# Inventaire uniquement : aucun navigateur ni résultat métier
npm run e2e:army:critical:list
npm run e2e:army:full:list

# Campagnes autonomes, sur leur propre pile locale
npm run e2e:army:ci -- full --app-port 3118
npm run e2e:army:calc-v3
```

Les commandes directes `e2e:army:critical` et `e2e:army:full` n'amorcent pas la
pile. Elles demandent un environnement explicitement préparé, un compte E2E et
`E2E_ALLOWED_SUPABASE_HOST`. Préférer les commandes autonomes ci-dessus pour
une vérification locale. Un environnement partagé requiert son propre périmètre
autorisé de fixtures et d'écritures : sur un hôte distant, les modes qui créent
des affaires (critical, full, development, polish, coverage, performance-affaire)
sont refusés sans `E2E_ARMY_SHARED_WRITE_HOST=<hôte>` posé dans le shell pour ce
lancement, et n'utilisent que le compte E2E désigné (voir `AGENTS.md`). La valeur
lue dans un `.env` est ignorée ; ne pas l'exporter dans un profil de shell ni la
passer par `node --env-file`, qui la rendraient permanente.

Pour un essai partagé autorisé, le compte « ARMY TesterArmy QA » dispose d'un
fichier d'accès dans le dossier privé **MergeOne** du Drive du propriétaire.
Sur chaque poste, le récupérer dans `.private/shared-qa-credentials.json` avec
des permissions réservées à l'utilisateur ; ce chemin est ignoré par Git. Les
secrets GitHub `E2E_LOGIN_EMAIL` et `E2E_LOGIN_PASSWORD` servent aux automatisations
et ne sont pas lisibles pour restaurer un poste. Ne jamais recopier le mot de
passe dans le dépôt ou les preuves. Les campagnes ordinaires continuent à utiliser
leur compte local éphémère.

## Organisation et écriture des parcours

- `army/critical/` : parcours métier et accès ; `army/extended/` : compléments
  métier et composants montés en navigateur.
- `army/takeoff/` : plans, imports et métré ; `army/local/` : recettes dédiées,
  [calcul v3](../docs/testing/tester-army-calc-v3.md), émission et reprises.
- `army/performance/` : mesures ; `fixtures/business/` et
  `fixtures/source-coverage/` : corpus publics fictifs et oracles.

Les assertions exactes portent sur les montants, la persistance, les droits et
les téléchargements. Les mocks de composants n'établissent pas une preuve
SQL/RLS. Un nouveau parcours doit rejoindre une sélection de `e2e.config.ts` ou
le registre explicite de `scripts/tester-army/journey-preflight.mjs` ; son simple
ajout au dossier ne garantit pas son exécution.

Les API installées sont documentées dans
`node_modules/e2e/skills/e2e/references/` et `node_modules/e2e/docs/reference/`.
Pour les interceptions, un observateur ou mock appelle `route.fallback()` afin
de conserver les gardes précédents ; `route.continue()` est réservé à la
décision finale des gardes autorisés par `src/test/ci-guardrails.test.ts`.

`npm run e2e` lance seulement le smoke anonyme desktop/mobile, sans compte ni
modèle. Depuis un checkout sans `.env`, fournir explicitement les valeurs
synthétiques utilisées par [la CI smoke](../.github/workflows/e2e-army-smoke.yml) :

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=army-anonymous-smoke-no-auth npm run e2e
```

Ces valeurs permettent le rendu anonyme ; elles ne donnent aucun accès backend.
Le mobile est un viewport de navigateur. `npm run e2e:army:agent` est optionnel, utilise
le login distinct `npx e2e login openai` et des objectifs bornés suivis
d'assertions exactes ; il ne remplace pas les parcours déterministes.

## Lire une preuve

Conserver la commande, la révision et les empreintes des entrées, le build,
l'environnement, les fixtures, la sélection, les résultats et la première
cause d'échec. Les sorties natives restent sous `.e2e/army/` : `manifest.json`,
`report.json`, `results/`, artefacts métier et archive `runs/<date>/`. Les
campagnes autonomes ajoutent leur manifeste dans `.e2e/army/ci/<campagne>/`.
Référencer ces sorties depuis `outputs/` sans recopier les médias.

Les traces actuelles sont des pages `trace.md`, pas des ZIP Playwright. Les
traces authentifiées sont désactivées ; le rapport contient encore des logs
navigateur et URL, que le wrapper expurge avant archivage. Ne jamais publier
les credentials, cookies, sessions, jetons de portail ou payloads privés.

Une collecte, une étape ignorée, un setup en échec ou une source modifiée
pendant la campagne ne prouvent pas le parcours. La boucle de développement
marque ses résultats `qualification: false`. Les anciens rapports retirés de
la documentation courante restent dans l'historique Git ; leurs résultats ne
sont pas des exécutions de la version actuelle.
