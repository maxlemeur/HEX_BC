# Développement et tests sur une pile locale

Les commandes autonomes utilisent une pile native Supabase temporaire et
possédée par leur invocation. Elles refusent les `.env` du checkout et les
variables DB/Supabase héritées. Utiliser le runtime de `.nvmrc`, `npm ci` et
installer Chromium avec `npx @e2e-dev/web install chromium --with-deps`.
macOS et Linux sont utilisables ; sous Windows, préférer un checkout WSL avec
ses propres dépendances. Docker et un login Supabase distant sont inutiles.

Avant les tests, le contrôle `check:installed-dependencies` vérifie Node et les
versions des paquets installés par rapport au manifeste et au lockfile. Il
refuse une installation manquante ou décalée avant de lancer les parcours ;
les manifestes TesterArmy conservent les versions réellement résolues du SDK,
du moteur web et du pilote Playwright. Ce contrôle compare les versions, il ne
vérifie pas l'intégrité de chaque fichier installé. En cas d'écart, utiliser le
Node prévu et `npm ci` dans un checkout isolé ; ne pas remplacer les dépendances
d'un serveur en cours d'utilisation.

Depuis TesterArmy 0.22, un agent utilisant la vision peut recevoir des captures
même après la saisie d'un secret. Les champs sécurisés sont masqués, mais une
valeur affichée en clair peut apparaître : réserver les parcours avec modèle à
des données et comptes de test autorisés.

## Exécuter et développer

```sh
# Session interactive : compte neuf, rechargement à chaud
npm run dev:army -- --app-port 3118

# Qualification des parcours affectés
npm run e2e:army:local -- --grep 'creation persists final French' --app-port 3118

# Sélection exacte de fichiers, à la place de --grep
npm run e2e:army:local -- --files 'e2e/army/critical/estimate-integrity.e2e.ts' --app-port 3118

# Suite full : production puis phase développement
npm run e2e:army:ci -- full --app-port 3118
```

La session interactive affiche l'URL et le chemin privé de ses identifiants
(répertoire `0700`, fichier `0600`, hors des preuves). Ctrl+C arrête Next,
retire les identifiants et détruit la base. Modifier les migrations demande de
redémarrer la session. Son manifeste indique `e2e: not-run` : utiliser
`e2e:army:local` avec des sources figées pour qualifier un changement.

`--grep` reçoit un motif JavaScript dans l'argument suivant, entouré
d'apostrophes ; `--files` reçoit des chemins distincts séparés par des virgules.
Ils s'excluent. Le mode `full` accepte aussi ces filtres et
`--phase development`. Un filtre ne correspondant à aucun parcours métier
échoue avant le démarrage de la pile. Une qualification ne tolère ni skip,
ni succès après retry, ni modification des sources pendant l'exécution.

La campagne ordinaire provisionne une politique de calcul 2 pour ses fixtures
historiques. `--tenant-calc-engine 3` ou `--tenant-calc-engine absent` permet un
contrôle explicite de la création actuelle (moteur 3 en l'absence de politique).
Cela ne remplace pas la [campagne calc-v3](tester-army-calc-v3.md).

`E2E_ARMY_WORKERS` accepte 1 à 4 et vaut 1 par défaut. Plus d'un worker est
réservé aux parcours critical sur la pile éphémère possédée. La CI critical
utilise 2 ; les autres valeurs ne sont pas une garantie de fiabilité. Les
comptes et fixtures partagés interdisent de généraliser ce parallélisme.

## Boucle d'itération réutilisable

```sh
npm run e2e:army:dev-loop -- start --app-port 3118 --ttl-minutes 60
npm run e2e:army:dev-loop -- run --grep 'creation persists final French'
npm run e2e:army:dev-loop -- status
npm run e2e:army:dev-loop -- stop
```

`start` conserve une pile, ses contrôles SQL/RLS initiaux, ses fixtures et son
build. Chaque `run` choisit exactement un `--grep` ou `--files` critical, refait
l'authentification et les assertions. Les modifications applicatives imposent
une reconstruction ; les modifications des seuls parcours réutilisent le build.
Une migration, configuration de pile ou module du superviseur modifié exige
l'arrêt puis un nouveau `start`. Deux itérations simultanées sont refusées.
Le TTL d'inactivité vaut 60 minutes, réglable entre 5 et 720.

Les résultats restent marqués `qualification: false` et distinguent les preuves
réutilisées de la nouvelle exécution. Arrêter la boucle, puis lancer
`e2e:army:local` sur le code final. L'état de boucle bloque les campagnes
qualifiantes du même checkout jusqu'à sa fermeture effective.

## Arrêt et reprise

Commencer par `npm run e2e:army:dev-loop -- status`, puis `stop` depuis le
checkout propriétaire. Ne pas effacer son `state.json` pour contourner un
échec de nettoyage. `stop` vérifie l'identité du superviseur, le projet natif,
le registre et les ports avant de retirer l'état.

Après SIGKILL ou panne, un processus Next enfant peut survivre. Si l'état
conserve `journeysStartedAt` et `cleanup-failed`, identifier le processus qui
écoute sur le port applicatif, confirmer son répertoire et son appartenance à
cette boucle, arrêter ce seul processus, puis relancer `stop`. Le runner ne
termine pas un serveur sans rapport occupant le même port.

Un état copié dans un autre checkout est `foreign-checkout` : agir depuis le
checkout d'origine, puis retirer seulement la copie vérifiée. Si le checkout a
été déplacé et que le chemin enregistré n'existe plus :

1. Inspecter la ligne de commande et le répertoire du PID enregistré. Arrêter
   seulement le superviseur identifié ; attendre sa fin.
2. Rapprocher `stack.rootDirectory`, `stack.projectId`, `stack.ports` de
   `~/.supabase/stacks/*/state.json`. Comparer les chemins réels (`/var` peut
   désigner `/private/var` sur macOS). Une identité ambiguë impose de conserver
   l'état et de diagnostiquer avant destruction.
3. Pour la seule pile identifiée, vérifier le `project_id` du `config.toml`.
   Si son répertoire temporaire a disparu mais que le registre prouve l'identité,
   recréer à ce chemin un `supabase/config.toml` minimal avec ce `project_id`,
   `[experimental]` et `stack = true`. Vérifier l'aide de la CLI installée, puis
   exécuter `npx supabase stop --workdir <répertoire>` et
   `npx supabase stack destroy --yes --workdir <répertoire>`.
4. Confirmer la disparition de l'entrée du registre et la fermeture des ports
   de la pile ; retirer uniquement son répertoire temporaire, sa socket et son
   état. Conserver le diagnostic d'un nettoyage incomplet.

## Capacité locale et builds

[`native-stack-guard.ts`](../../src/test/native-stack-guard.ts) limite à
3 places par utilisateur les piles et builds natifs. Les fichiers de réservation
vivent dans `~/.supabase/native-runs/`. Le diagnostic nomme leurs détenteurs et
les piles/builds orphelins détectés. Attendre leur fin ou utiliser
`NATIVE_STACK_WAIT_SECONDS=<secondes>`. `NATIVE_STACK_MAX_RUNS` accepte 1 à 32,
mais augmenter la limite n'améliore pas la capacité de la machine.

Le garde libère les réservations des processus morts ; SIGKILL ne peut pas
détruire automatiquement leur pile. Ne jamais supprimer un verrou d'un autre
processus actif. Les builds locaux ordinaires prennent une place ; les builds
CI/Vercel n'en prennent pas, et un build Army réutilise celle de son runner.

[`next-build-env.mjs`](../../scripts/next-build-env.mjs) applique un plancher de
4096 Mio de heap V8 au build, en conservant les autres `NODE_OPTIONS` et une
limite supérieure existante. Une erreur mémoire demande un diagnostic de la
charge et du processus, pas des relances simultanées. Le tsconfig de build
Army exclut les tests Vitest ; le typage racine de `verify:pr` les contrôle.

## Preuves et contrôles SQL ciblés

Les manifestes de campagne restent dans `.e2e/army/ci/`, les sorties du runner
dans `.e2e/army/`. Référencer ces preuves depuis `outputs/` sans créer de copies
complètes. Les secrets temporaires ne font jamais partie des artefacts publiés.

```sh
npm run db:ci:local -- --files estimate-large-v3-scale.test.sql
```

`--files` accepte des fichiers SQL existants directement sous
`supabase/tests/database/`, séparés par des virgules ; la matrice RLS reste
exécutée. `--skip-rls` est un diagnostic partiel explicite et ne remplace pas
la validation complète demandée pour une modification SQL. Les contraintes de
performance sont dans les [budgets SQL](large-estimate-statement-budget.md).
