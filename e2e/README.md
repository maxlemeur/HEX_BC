# E2E TesterArmy

TesterArmy (`e2e` 0.21.2 et `@e2e-dev/web` 0.15.2) exécute les parcours navigateur.
Les assertions exactes déterminent le résultat ; la navigation par agent reste
facultative. Voir [le guide Army](../docs/testing/tester-army.md),
[la CI native](../docs/testing/tester-army-ci.md) et
[la correspondance Playwright](../docs/testing/army-migration.md) et
[le port des scénarios PowerShell](../docs/testing/legacy-to-army-migration-2026-10-19.md).

## Profils

- `npm run e2e` : smoke anonyme desktop/mobile, sans modèle.
- `npm run e2e:army:critical` : contrôles métier prioritaires.
- `npm run e2e:army:full` : parcours de production, spécialistes et métré.
- `npm run e2e:army:development` : trois scénarios du simulateur de hub.
- `npm run e2e:army:polish` : audit optionnel des routes explicitement sélectionnées,
  aux quatre largeurs historiques ; voir [ses limites](../docs/testing/tester-army-polish.md).
- `npm run e2e:army:ci -- full` : SQL, RLS, build, production puis
  développement sur une pile Supabase native éphémère (Linux/macOS ; Windows via WSL).

La CI crée son compte ARMY, refuse les secrets et fichiers env ambiants et détruit
sa pile locale. Pour une campagne manuelle, lire les prérequis du profil avant
exécution : backend loopback explicitement autorisé, compte dédié et nouvelles
fixtures ARMY. Les prérequis worker locaux gardent leurs clés côté Node ; les
actions de l'application utilisent la connexion utilisateur normale.

Les manifestes et archives `.e2e/army/` conservent commande, sources, build,
identités, assertions et empreintes. Échec, skip et setup incomplet restent des
preuves manquantes. Les archives de CI sont contrôlées avant publication.

## Sélection locale et preuves

Pour une itération sur les parcours affectés, utiliser une seule pile locale :

```bash
npm run e2e:army:local -- --grep 'LEP01|LEGCLIP01'
```

Pour une qualification bornée depuis une pile propre :

```bash
npm run e2e:army:ci -- full --grep 'LEGCUR0[12]|LEGASM01'
```

Un filtre prouve uniquement les scénarios effectivement sélectionnés. Le profil
`full` comprend aussi les parcours connectés et le métré ; l'émission PDF et les
contrats v3 ont leurs profils spécialisés documentés dans
[le guide calc-v3](../docs/testing/tester-army-calc-v3.md).

Les anciens scripts navigateur PowerShell, leur wrapper et les régressions qui
validaient uniquement ces scripts ont été retirés après qualification exécutée
de leurs remplacements. La matrice liée ci-dessus conserve la correspondance
et les limites de preuve ; les rapports datés restent historiques.
Les contrôles de types, calcul, parser, SQL/RLS et de concurrence restent des
spécialistes ; ils ne sont pas remplacés par un verdict visuel.

## Environnement

Le runner local provisionne les comptes, les cookies et les clés loopback de sa
pile éphémère. Il refuse les secrets distants ambiants. Pour un backend manuel
explicitement autorisé, suivre [le guide critical](../docs/testing/tester-army-critical.md)
et les [rôles des comptes de test](../docs/test-logins.md). Les identifiants et
sessions ne sont jamais committés.

Le smoke anonyme lance son propre serveur ; `E2E_ARMY_BASE_URL` choisit son
origine locale (par défaut `http://localhost:3107`). Fournir les variables
publiques du backend autorisé avant son démarrage ; lire le guide Army pour
les options du pilote. Les variables internes `RLS_E2E_*`
ne doivent pas être configurées avec des secrets distants.

## RLS matrix (EST-261 partial)

- `src/lib/estimates/rls.e2e.test.ts` validates a CRUD matrix (`SELECT/INSERT/UPDATE/DELETE`)
  by role (`admin/engineer/viewer`) on:
  - `estimate_versions`
  - `estimate_items`
  - `estimate_categories`
  - `labor_roles`
  - `estimate_suggestion_rules`
  - `audit_logs`
- Le premier des deux tests Vitest couvre aussi les mutations d'un propriétaire
  rétrogradé viewer, le DELETE gouverné d'`estimate_projects`, la RPC de suppression
  avec cascade réelle des journaux append-only, ainsi que les frontières
  `takeoff_jobs`/`takeoff_items` (rôles, statuts, worker/provider, retry/reconcile,
  source, plan-set, draft-lock et apply atomique).
- Il vérifie aussi la frontière tenant actif avec la requête PostgREST réelle
  `tenant_memberships -> tenants!inner`, masque tenant et membership suspendus,
  puis refuse atomiquement la décision d'un token portail sans modifier le token
  ni la version.
- Le même test vérifie le basculement atomique d'un tenant par défaut suspendu et
  les refus d'une cible inactive, étrangère ou bloquée par un défaut non-admin.
- Le second test couvre l'isolation cross-tenant (un non-membre doit être refusé).
- `portal_tokens` is probed and reported when absent from the current schema snapshot.
- La commande canonique est `npm run db:ci:local` : elle crée une pile loopback
  éphémère en runtime natif Supabase, sans Docker, et trois comptes Auth jetables.
  Prérequis : Linux (glibc 2.35+) ou macOS 14+ sur Apple silicon, compte non root ;
  sous Windows, depuis WSL et un clone Linux du dépôt (voir `supabase/README.md`).
  La suite refuse une URL distante ou une exécution hors de ce runner local.
- Run partiel : `npm run db:ci:local -- --files a.test.sql,b.test.sql` ne lance
  que ces fichiers de `supabase/tests/database` (noms nus ou préfixés par ce
  dossier ; tout autre chemin est refusé avant la pile) ; la matrice RLS tourne
  encore, sauf `--skip-rls`. Le journal le déclare partiel : ce n'est jamais la
  preuve complète `db:ci:local`.
- Ctrl+C (SIGINT) ou SIGTERM pendant un run détruit la pile (`stop` puis
  `stack destroy --yes`), retire le répertoire isolé et libère le créneau.
- Le nombre de places natives simultanées est borné : runs `db:ci:local`,
  runner Army, `engine-v3` parity et upgrade-check, plus toute pile native
  qu'aucun run gardé ne possède et tout build `node scripts/next-build.mjs`.
  Au-delà, le run est refusé (`NativeStackLimitError`, qui nomme les
  détenteurs) ; `NATIVE_STACK_WAIT_SECONDS=<n>` attend `n` secondes. La limite
  et son réglage sont définis dans la section « Capacité locale » de
  [`tester-army-local-development.md`](../docs/testing/tester-army-local-development.md#capacité-locale-et-redémarrages-wsl-18102026).
  Détails :
  [`local-native-stack-tooling.md`](../docs/testing/local-native-stack-tooling.md).
- Fail-closed CI workflow: `.github/workflows/e2e-rls-matrix.yml`. It blocks merges
  only when repository branch protection requires this check.
