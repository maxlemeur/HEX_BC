# Développer et tester avec Army sur une base locale jetable

Le développement interactif et les tests réutilisent le bootstrap natif de la
CI : migrations du checkout, contrôles SQL/RLS, nouveau compte et tenant ARMY,
puis destruction de la pile possédée. Aucun accès au Supabase partagé n'est
nécessaire. Les modes `critical` et `full` gardent leur sélection par défaut.

## Utilisation

Sous Windows, utiliser un checkout Linux dédié sous WSL, avec Node 24. Ne pas
copier les `.env` du checkout Windows ni des identifiants du backend partagé.
Les fichiers `.env` et variables Supabase/DB héritées sont refusés.

À la première installation, depuis ce checkout :

```sh
npm ci
npx @e2e-dev/web install chromium --with-deps
```

Le runtime Supabase natif télécharge ses services et réutilise son cache local.
Docker et une authentification CLI distante ne sont pas nécessaires.

```sh
# Développement interactif avec rechargement à chaud
npm run dev:army -- --app-port 3118

# Création et duplication, avec assertions exactes et setup de connexion
npm run e2e:army:local -- --grep 'creation persists final French|duplication preserves hierarchy' --app-port 3118

# Campagnes complètes de production et de développement
npm run e2e:army:ci -- full --app-port 3118
```

La session dev affiche l'URL et le chemin d'un fichier privé contenant la
connexion du compte neuf. Le répertoire est en `0700`, le fichier en `0600`,
hors du dépôt et des preuves. Ils disparaissent à l'arrêt. Les appels fournisseur
et workers restent bloqués par le garde réseau local existant.

Ctrl+C arrête le groupe de processus Next possédé, retire les identifiants et
détruit la base temporaire. Les données de cette session ne sont pas conservées.
Après une modification des migrations, relancer la commande pour recréer la
base ; les migrations ne sont pas appliquées à chaud.

Les preuves expurgées restent sous `.e2e/army/ci/` : commande, sources, migrations,
environnement, identités de fixtures, résultats, logs et empreintes. Le mode dev
enregistre les sources avant/après et produit `stopped`, avec `e2e: not-run`.
Une session interactive ne qualifie pas une campagne métier. Les sources
doivent rester figées pendant `critical` et `full`.

## Contrat défini avant implémentation

Les scénarios et échecs attendus ont précédé le code :

1. Refuser les options inconnues ou répétées, les valeurs vides ou invalides,
   un port occupé ou interdit au navigateur et une cible Supabase héritée, avant
   toute étape SQL/application. Réserver le futur port Next pendant l'allocation
   des services Supabase pour éviter une collision interne.
2. Réserver `--grep` à `critical`. Conserver SQL/RLS/build, le setup de connexion
   UI exact et au moins un scénario métier authentifié sur chaque cible ; aucun
   skip, succès après retry SDK ou filtre sans résultat ne vaut une réussite.
3. En dev, vérifier une connexion réelle au tableau de bord, une lecture API 200
   et une modification visible par HMR sans rechargement complet de la page.
4. Ne conserver ni mot de passe, ni jeton, ni adresse du compte dans les preuves.
   Aucune clé service-role ni URL PostgreSQL dans le fichier privé de connexion.
5. Vérifier l'arrêt des processus possédés, les ports IPv4/IPv6 libérés, la
   suppression de la pile et des identifiants après Ctrl+C comme après erreur.
   Un crash, timeout ou nettoyage forcé reste un échec.

## Validation exécutée

Les rejeux utilisent un checkout Linux isolé de `40ffb876` avec uniquement les
changements de ce lot. Les travaux concurrents du checkout Windows sont
préservés et ne sont pas qualifiés par ces résultats.

Ubuntu/WSL, Node 24, Army 0.21 : la connexion UI, la lecture API 200 et le HMR
passent **1/1**, sans skip ni retry. `performance.timeOrigin` reste identique.
Ctrl+C produit `stopped` / `e2e: not-run`, Next termine avec zéro et
`sourceChanged: true`. Le fichier HMR du clone jetable est ensuite restauré
octet pour octet. Permissions `0600`/`0700`, absence de processus possédés, ports
fermés et suppression de la pile et des identifiants sont vérifiées directement.
Le terminal Windows interrompu retourne 1 ; son code ne remplace pas ces constats
ni le manifeste terminal. Reçu :
`.codex-tmp/local-army-workflow-20261016/dev-qualified/receipt.json`.

Le port occupé et une origine Supabase héritée sont refusés avant toute étape.
ESLint ciblé, typecheck global et contrôle du diff passent. Les **63 contrôles**
des recettes et archives existantes passent, avec empreintes vérifiées :
`.codex-tmp/army-local-development-20261016/recipe-validation.json`.

Les résultats des nouveaux rejeux métier et des refus de sélection sont
archivés séparément du cycle interactif. Les anciennes campagnes complètes
critical/full/development ne qualifient pas ce nouveau lot de sources.

## Échecs rencontrés et conservés

- Le premier dev Linux passe SQL/RLS, puis `/login` répond 500 : le mode dev
  omettait `.e2e/army/tsconfig.json`. La préparation existante est maintenant
  commune au build, au wrapper Army et au dev. Le rejeu part d'un checkout neuf,
  sans configuration présemée. Timeout et nettoyage conservés dans
  `.codex-tmp/local-army-workflow-20261016/red-evidence/`.
- Le premier contrôle d'archive ne copiait pas cette nouvelle dépendance dans
  sa fixture. Sa copie a été ajoutée ; les douze assertions restent inchangées.
- Un filtre pouvait sélectionner uniquement deux tests anonymes et satisfaire
  le précédent seuil de deux résultats. La collection RED précède le correctif
  qui exige le setup exact réussi et un scénario métier authentifié. Reçus :
  `.codex-tmp/army-local-development-20261016/review-anonymous-filter-red.json`
  et `report-validator-compatibility.json`. La relecture des rapports historiques
  3/3, 122/122 et 4/4 confirme leur compatibilité, sans nouvelle qualification.
- Un adaptateur de manifeste ancien a interrompu un essai intermédiaire. Cet
  échec de préparation est conservé et ne compte pas comme preuve produit.
- Le premier positif sur l'allocateur final est interrompu par un redémarrage
  WSL pendant le build, après SQL/RLS. Le journal signale un arrêt non propre,
  sans cause attribuée. Aucun manifeste terminal n'a été écrit : cet essai ne
  prouve ni réussite métier ni nettoyage normal. Les traces et la récupération
  de sa seule pile possédée sont conservées séparément d'un éventuel rejeu.
  Reçu : `.codex-tmp/local-army-workflow-20261016/critical-allocator-interrupted/receipt.json`.
  La récupération exécute `stop` puis `stack destroy` sur son identité exacte,
  vérifie neuf ports fermés ainsi que le retrait du registre et du répertoire.
  Ce nettoyage après arrêt OS ne vaut pas exécution normale du `finally`.

### Collision de port du runtime natif

Un lancement a échoué sur le bind de l'inspecteur Functions à
`127.0.0.1:43899`. Le détenteur à cet instant n'a pas été observé. L'ancien
allocateur écoutait sur le port zéro puis fermait la socket avant le démarrage.
Le noyau choisissait ainsi dans la plage des connexions clientes automatiques
(`32768–60999` sur cet hôte). Une réutilisation dans cette fenêtre est plausible,
sans attribution certaine. Voir le
[contrat du noyau Linux](https://docs.kernel.org/networking/ip-sysctl.html#ip-local-port-range-2-integers).

Avant de corriger l'allocateur, les régressions ont défini : huit ports distincts
et réécoutables, exclusion des plages éphémères lues sur l'hôte et d'un port
réellement occupé, refus d'une plage invalide ou de candidats épuisés, échec
sans retry et nettoyage après collision au démarrage. L'isolation est justifiée
car un navigateur ne peut imposer le choix du noyau ni une collision dans cette
fenêtre. Les tests utilisent de vraies sockets, sans mock de `net`.

Le RED compte trois échecs sur treize ; le correctif passe **13/13**. Une tentative
sandbox bloquée avant Vitest (`EPERM`) n'est pas comptée comme RED métier.
Rapports : `.codex-tmp/army-local-development-20261016/port-allocation-red-complete.json`
et `port-allocation-green.json`.

L'allocateur lit les plages Linux ou Darwin sans changer de réglage global,
exclut les ports déjà attribués et commence à un candidat aléatoire. Chaque
candidat est réellement écouté puis libéré ; seul `EADDRINUSE` permet d'en essayer
un autre pendant la préparation. Un conflit ultérieur au démarrage reste un
échec conservé, sans relancer la campagne. macOS n'a pas été exécuté.

L'élargissement aux ports non éphémères a également exposé deux modes d'échec
avant leurs correctifs : le futur port Next, encore libre, pouvait être attribué
à Supabase ; les ports `6000`, `6667` et `10080`, valides pour une socket, restent
interdits au navigateur. La réservation du port applicatif est transmise à la
préparation de la pile. Les ports interdits supérieurs à 1023 sont exclus par
une liste commune à l'allocateur et au parser, fondée sur les
[restrictions Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc).
Les cas déterministes ont précédé chaque correction :
`port-application-reservation-red.json` et `port-browser-red.json` sous
`.codex-tmp/army-local-development-20261016/`.
Leur rejeu final passe **15/15** sans skip (`port-allocation-final-green.json`).
Les trois ports HTTP interdits sont aussi refusés par la vraie entrée CLI avant
création de manifeste ou démarrage, dans `port-browser-cli-green.json`.

### Cause des arrêts WSL et correction de l'environnement

Les journaux Windows ont ensuite établi la saturation de mémoire engagée :
trois événements `Resource-Exhaustion-Detector / 2004`, aux `00:20:51Z`,
`00:22:32Z` et `00:28:46Z`, montrent environ **99,6 %** de la limite de commit
atteinte. La RAM physique utilisée n'était que de 41 à 43 Go. Aucun fichier
d'échange Windows n'était actif et sa gestion automatique était désactivée.
Les événements et l'état initial sont conservés sous
`.codex-tmp/wsl-reliability-20261016/`. Voir le
[diagnostic Microsoft du commit](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-memory-leaks).

La gestion automatique du fichier d'échange Windows est réactivée et relue.
Avant le redémarrage Windows, la liste des fichiers actifs reste vide et la
limite effective n'a pas augmenté.
`pagefile-repair-result.json` distingue explicitement ces états ; aucun
redémarrage du PC n'a été lancé automatiquement.

Les deux distributions étant arrêtées, une nouvelle `.wslconfig` est créée
avec **12 Go de mémoire, 8 processeurs et 8 Go de swap**, sans écraser de fichier
préexistant. Ces paramètres sont globaux à toutes les distributions WSL2.
La lecture Linux confirme `MemTotal: 12249308 kB`, `nproc: 8` et un swap actif
de `8589934592` octets. Le reçu `wslconfig-applied.json` conserve l'identité du
fichier. Voir la [configuration Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

Le [budget du build Army](tester-army-build-resources.md) est également réduit
de 8192 à **4096 Mio de heap V8 par processus**, sans désactiver TypeScript,
OpenAPI ni les budgets de performance. Ce plafond n'est pas une borne de mémoire
totale. Les 63 contrôles de recettes passent avant et après le changement.
Les nouveaux rejeux doivent utiliser ce nouveau gel de sources ; les résultats
antérieurs restent distincts. La mémoire engagée Windows est mesurée pendant
ces essais, avec une marge initiale supérieure à 16 Gio.

Sur ce gel, la campagne ciblée termine **3/3** : connexion, création et
duplication, avec les assertions financières existantes et le rechargement.
SQL (1253 assertions), RLS (deux tests), compilation complète et budgets passent.
Sources et build restent figés ; le boot WSL ne change pas et le swap reste à
zéro. Reçu `critical-positive-resources/receipt.json` sous
`.codex-tmp/local-army-workflow-20261016/`, 58 empreintes revérifiées.

Les deux refus sont exécutés sur le même gel et restent des **échecs explicites**
de campagne : `critical-no-match-resources/receipt.json` conserve `NO_TESTS`
(SDK 2, CI 1), après SQL/RLS/build réussis ;
`critical-anonymous-only-resources/receipt.json` conserve deux tests anonymes
réussis, mais une CI à 1 car le setup exact et un scénario métier authentifié
manquent. Aucun de ces refus n'est présenté comme campagne métier réussie.
Neuf et vingt empreintes sont revérifiées, confidentialité validée, zéro skip,
ports libérés et piles supprimées. Les trois passages gardent le même boot ID.

L'utilisateur a choisi de redémarrer lui-même Windows après les tests. La
vérification du fichier d'échange actif (`Win32_PageFileUsage`) et d'une limite
de commit augmentée est consignée ci-dessous ; sa seule configuration
enregistrée ne constituait pas cette vérification.

Le dernier cycle dev passe aussi sous ces limites : SDK **1/1**, connexion UI,
HMR visible avec `performance.timeOrigin` inchangé, puis Ctrl+C. Le manifeste
termine `stopped` / `e2e: not-run`, Next sort à zéro, les ports IPv4/IPv6 sont
libérés, la pile et les identifiants privés sont supprimés et aucun processus
possédé ne reste. La source HMR du clone est restaurée exactement. Reçu :
`dev-qualified-resources/receipt.json`, seize empreintes revérifiées, zéro
détection de secret et même boot ID avant/après.

La mesure Windows couvre les quatre cycles, de `00:37:00Z` à `00:52:45Z` :
409 échantillons, pic de commit `57139560448` octets pour une limite de
`66094223360` (environ **86,5 %**), marge minimale `8954662912` octets,
aucun nouvel événement 2004. Le moniteur est arrêté après les essais.
Synthèse : `.codex-tmp/wsl-reliability-20261016/host-monitor-summary.json`.
Les deux interruptions restent archivées séparément. Ces résultats portent
sur les charges mesurées pendant les quatre cycles.

L'index `resources-replays-index.json` conserve les quatre reçus et 116 fichiers
sous `.codex-tmp/local-army-workflow-20261016/` ; leurs empreintes sont toutes
revérifiées. `final-cleanup-resources.json` confirme quatre piles retirées,
aucun registre ni processus possédé restant, 25 ports fermés et les identifiants
supprimés. Synthèse finale et références croisées :
`.codex-tmp/wsl-reliability-20261016/final-proof.json`.

### Vérification après le redémarrage utilisateur

Le 16 octobre 2026, dix contrôles en lecture seule passent après le nouveau
démarrage Windows (`08:03:21Z`). `C:\pagefile.sys` est actif en gestion
automatique, avec **28672 Mio (28 Gio)** alloués. La limite de commit effective
est passée de `66094223360` à `96158994432` octets, soit environ **61,6 à 89,6 Gio**.
Elle est utilisée à 20 % au moment du contrôle ; aucun événement 2004 n'est
présent depuis ce démarrage et la requête des journaux réussit.

La configuration WSL conserve son empreinte. La lecture Linux confirme à nouveau
`12249308 kB` de mémoire, huit processeurs et `8388608 kB` de swap, inutilisé.
L'attente d'activation du fichier d'échange est donc levée. Les campagnes Army
ci-dessus conservent leur date et leur portée antérieures au redémarrage.

Reçu : `.codex-tmp/wsl-reliability-20261016/post-restart-20261016/verification.json`.
Les anciennes preuves restent inchangées ; les deux documents dans leur état
précédent sont sauvegardés dans ce même dossier. Une première génération de
reçu a échoué sur une conversion de date PowerShell : son statut erroné est
explicitement invalidé et conservé dans `invalid-attempt-disposition.json`,
sans entrer dans les dix contrôles réussis du reçu corrigé.
