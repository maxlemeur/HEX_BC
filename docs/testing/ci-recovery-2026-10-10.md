# Réparation des contrôles CI — 2026-10-10

## Échecs observables avant modification

- L'audit bloque des versions vulnérables effectivement présentes dans le
  lockfile. Mettre à jour les versions corrigées, supprimer la chaîne `braces`
  sans exception d'audit et conserver toutes les règles ESLint Next.
- Le contrôleur de synchronisation compte 1 249 lignes non vides pour un plafond
  de 1 200. Déplacer ses contrats de types dans son module existant, sans modifier
  l'autosave, les verrous, les conflits ou les exports publics.
- Le setup Playwright expire après 90 secondes ; son helper remplit le formulaire
  sans établir l'hydratation et attend trois fois une redirection en masquant les
  erreurs. Le smoke TesterArmy et la connexion ARMY vérifient déjà le toggle du
  mot de passe. La régression doit établir qu'un formulaire rendu avant ses
  handlers ne reçoit aucun secret, que la connexion réussie est conservée et
  qu'une erreur de credentials est remontée sans répétition inutile.

## Scénarios et exceptions d'isolation

La connexion réelle et les parcours métier restent validés par leurs runners
existants. Le checkout local n'a pas de mot de passe E2E : aucun accès ou compte
ne sera changé pour contourner ce manque. La CI conserve son compte et son
environnement autorisés. Le navigateur anonyme observe le formulaire réel et
les réponses publiques du service.

Une fixture navigateur ciblée du helper de connexion utilise uniquement des
valeurs synthétiques, des handlers volontairement tardifs et une API locale.
Elle couvre une course que la CI et l'E2E normale ne peuvent imposer de manière
reproductible. Elle ne prétend pas établir une authentification Supabase réelle.
Elle est écrite et exécutée avant de modifier le helper.

Les patterns de répertoires ESLint constituent une autre exception d'isolation :
ils sont évalués pendant le lint, sans parcours UI. Les régressions appellent
le véritable `getRootDirs` du plugin Next sur des répertoires jetables : un
répertoire littéral ne doit pas inclure ses descendants, les braces et tableaux
gardent leur sélection, et un pattern fortement imbriqué ne doit pas épuiser la
pile. `tinyglobby` seul n'est pas équivalent : son expansion de répertoire par
défaut, ses séparateurs finaux, plages de braces, parenthèses littérales et
globstars initiaux répétés doivent être adaptés au contrat observé. La revue
indépendante a reproduit ces trois derniers écarts contre Fast-glob 3.3.1 ;
les régressions ont échoué avant leur correction. Le paquet local conserve
les sélections ordinaires et refuse explicitement les motifs excessifs
(4 096 caractères, 64 niveaux imbriqués, 1 000 expansions).

Le contrôle d'architecture existant et les régressions du hook couvrent le
déplacement des types. Aucun test de getter ou de texte source n'est ajouté.

## Résultats

- Base : `8b07ea0c2a453b5cca42f6893c4453b5a663b83d`, Node 24.21.0,
  macOS arm64. Le checkout conserve le WIP utilisateur antérieur ; le commit
  exclut ce WIP, notamment le script d'association article dans `package.json`.
- `npm ci` dans un répertoire temporaire neuf : 819 paquets installés,
  0 vulnérabilité. `.npmrc` impose l'empaquetage des dépendances locales pour
  rendre leur résolution reproductible. Le code empaqueté a le même SHA-256
  que la source ; le vrai plugin Next retrouve les racines numériques/littérales.
- `npm run audit:dependencies` : 0 advisory bloquant, 0 exception active.
  `npm run audit:signatures` : 816 signatures et 220 attestations vérifiées.
  Les versions de Vitest/coverage sont alignées sur 4.1.11 ; le SDK MCP transitif
  de `e2e` est corrigé sans changer les versions des runners E2E.
- `npm run check:architecture` : vert, 1 015 modules, aucun cycle autorisé.
  Le contrôleur passe de 1 249 à 1 154 lignes non vides pour un plafond de
  1 200. Son JavaScript transpilé est identique ; les 36 régressions du hook
  passent et figurent dans la suite globale.
- `npm test` : 432 fichiers verts, 2 703 assertions actives vertes,
  1 fichier / 2 assertions ignorés. Les 9 régressions du glob et 8 gardes
  d'audit passent aussi en exécution ciblée. Couverture critique : 12/12,
  exécutée pendant ce lot avec les mêmes versions Vitest/coverage.
- `npx playwright test --config e2e/auth/playwright.config.ts` : 2/2 verts,
  Chromium headless, valeurs synthétiques seulement. Ce contrôle est ajouté
  au workflow critique avant l'étape recevant ses secrets.
- `npm run e2e:army` : 2/2 smokes anonymes verts, hydratation réelle,
  `e2e` 0.15.2, `@e2e-dev/web` 0.11.1, Playwright 1.63.0 ; manifest et
  rapport sous `.e2e/army/`. Ces smokes ne prouvent pas une connexion Supabase.
- Lint global, typecheck, OpenAPI, `git diff --check` et
  `npm run verify:production` verts. Ce dernier construit avec Webpack,
  démarre un serveur local, vérifie pages/redirect/assets et arrête ses processus.
- La CI publiée et la connexion réelle sont à vérifier après le push sur
  le SHA du commit. Aucune migration Supabase n'est modifiée par ce lot ;
  les preuves pgTAP/RLS du précédent SHA ne sont pas une nouvelle exécution.

L'hydratation est établie par le toggle non secret avant de remplir le
formulaire. Le helper masque à nouveau le mot de passe, attend la redirection
ou l'erreur affichée et remonte un rejet sans le répéter. Les identifiants
sont retirés des messages d'erreur. L'authentification et la persistance métier
restent qualifiées par la suite critique existante sur le SHA poussé.

La suppression de `braces` vise une dépendance de lint, dont le consommateur
direct est le `getRootDirs` du plugin Next ; elle ne requalifie pas un chemin
d'attaque HTTP. Références amont :
[avis braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[contrat Fast-glob](https://github.com/mrmlnc/fast-glob/blob/3.3.1/src/utils/pattern.ts),
[expansion bornée](https://github.com/juliangruber/brace-expansion/blob/v5.0.12/src/index.ts),
[correctif Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

## Complément après la première CI publiée

Sur `c74696f4`, installation, audit, signatures, architecture, lint, typecheck,
OpenAPI, tests Node, couverture critique, build/smoke HTTP et TesterArmy sont
verts dans GitHub Actions. Deux limites ont été établies par cette exécution :

- Supabase Auth renvoie réellement `invalid_credentials` à la connexion CI.
  Les régressions synthétiques du helper passent 2/2 ; les 36 parcours métier
  restent non exécutés. Corriger le compte/secret nécessite une décision
  distincte de la correction du code ; aucun accès n'a été changé à ce stade.
- La suite jsdom expose une course de sa fixture `GeneratedOuvrageDialog` :
  attendre le début de l'API de validation ne garantit pas l'état visible
  « Revu ». Le clic sur le bouton encore désactivé ne déclenche donc pas la
  barrière de mutation. Une réponse volontairement retardée reproduit le même
  échec localement avant correction. Le helper attend désormais le badge
  « Revu » ; le test vérifie le bouton activé avant de cliquer et conserve
  le refus de la barrière et l'absence d'appel à l'API d'insertion.

Ce complément corrige la synchronisation de la fixture, sans changer le
comportement applicatif, désactiver une assertion ou augmenter les retries.
Validation : 8/8 tests ciblés, puis la suite jsdom entière sous les variables
factices de la CI (162 fichiers, 823 tests), lint ciblé et typecheck verts.
