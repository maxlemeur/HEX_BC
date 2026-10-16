# Budget mémoire du build Army local

## Échec observé et contrat avant correction

Deux campagnes Linux ont passé SQL/RLS puis ont été interrompues pendant le
build, avant tout parcours navigateur : une pendant la compilation Webpack,
l'autre pendant la vérification TypeScript. Elles n'ont pas produit de manifeste
terminal. Le changement de boot WSL et la récupération séparée de leurs seules
piles possédées restent des preuves d'interruption, jamais un succès E2E.

Le journal Windows Resource-Exhaustion-Detector 2004 à `00:28:46Z` signale une
insuffisance de mémoire virtuelle : `vmmemWSL` environ 8,29 Go et deux processus
LM Studio environ 7,6 Go chacun. Le retrait réseau WSL suit dix secondes après.
La RAM physique libre mesurée ultérieurement ne représente pas la marge de
mémoire engagée Windows au moment de l'incident. Le lien temporel rend nécessaire
la vérification du budget de commit/pagefile ; il ne constitue pas une mesure de
RSS de chaque worker Next ni une preuve d'OOM déclenché par le noyau Linux.

Avant correction, l'invocation Army impose `--max-old-space-size=8192`. Cette limite
concerne la partie old-space du heap V8 de chaque processus, pas la mémoire
totale de la VM ([contrat Node 24](https://nodejs.org/download/release/v24.20.0/docs/api/cli.html#--max-old-space-sizesize-in-mib)).
Dans Next 16.4 installé, les compilateurs Webpack travaillent
séquentiellement dans un worker distinct, puis TypeScript utilise un worker
distinct. Ces workers héritent de la limite. Les workers de collecte/prérendu
retirent cette limite et utilisent leurs propres réglages V8. Le build réussi
précédent utilisait 31 workers à ce stade ultérieur ; cela n'explique pas les
deux interruptions survenues avant cette phase.

Les options du [guide Next installé](../../node_modules/next/dist/docs/01-app/02-guides/memory-usage.md)
passent généralement par `next.config`. Le profil mémoire de débogage modifie
le fonctionnement des workers et peut écrire des snapshots sensibles ; il n'est
pas utilisé pour contourner la panne. Le correctif de l'invocation de build ne
modifie aucune configuration Next de l'utilisateur, aucune limite WSL globale et
n'arrête aucun processus utilisateur. La réparation hôte autorisée séparément
possède ses propres sauvegardes, reçus et contrôles d'application effective.

## Correction et preuve attendues

La lecture de trois événements 2004 confirme une charge de commit de
65 827 930 112, 65 828 667 392 et 65 854 636 032 octets pour une limite de
66 094 223 360 octets, soit environ 99,6 %. L'hôte n'avait aucun pagefile Windows
et sa gestion automatique était désactivée, alors que la mémoire physique
utilisée était de 41 à 43 Go. La limite de commit de l'hôte est donc la cause
identifiée ; les changements de configuration hôte sont traités séparément.

Avant modification, le plafond retenu pour le build Army est **4096 Mio** au lieu
de 8192. C'est une réduction complémentaire de la pression potentielle par
processus, sans garantie de RSS total. Le changement est limité à l'invocation Node ;
OpenAPI, TypeScript, build complet et budgets de performance restent obligatoires.
Le tableau commun des commandes demeure la référence des validateurs de recettes.
Le budget effectif et la commande doivent rester vérifiables dans le manifeste.

Défaillances à exclure :

1. Réutiliser le plafond de 8 Gio malgré une marge de commit insuffisante.
2. Désactiver TypeScript, réduire les routes compilées, relancer automatiquement
   un build échoué ou réutiliser un ancien build pour obtenir une campagne verte.
3. Présenter un plafond de heap comme une borne de RSS agrégée, ou attribuer les
   interruptions aux 31 workers jamais atteints.
4. Perdre le contrôle de la révision, de la pile possédée ou du nettoyage, ou
   intégrer au correctif de build un changement hôte non autorisé ou non vérifié.
   La réparation hôte distincte doit être expliquée et vérifiée ; elle ne remplace
   pas les assertions de la campagne.

La régression primaire est le vrai build qui a interrompu WSL, suivi sur les
sources corrigées de la même chaîne SQL/RLS/build et du parcours Critical
création/duplication avec connexion ordinaire et valeurs exactes. Les observations
hôte et Linux doivent indiquer le budget, les processus et la marge de mémoire
pendant cette qualification. Une erreur V8 au plafond réduit reste un échec
conservé ; toute correction ultérieure exige son propre constat, sans retry caché.

Les refus de sélection vide et de deux tests anonymes seuls restent requis.
Aucun nouveau test unitaire de simple transmission d'option n'est prévu : il ne
reproduirait ni la pression de commit ni la véritable compilation. Les campagnes
interrompues restent conservées à côté du futur rejeu, avec leurs limites.

## Contrôles après modification

Le tableau `buildCommands` dans `scripts/tester-army/local-recipe-common.mjs`
utilise désormais `--max-old-space-size=4096`. Les autres arguments et étapes
restent identiques. `build-local.mjs` conserve les arguments réellement exécutés
dans `manifest.steps` ; les trois validateurs de build importent ce même tableau.

`npm run check:army-recipes` passe **63/63 avant et après** la modification.
Les journaux sont conservés dans
`.codex-tmp/army-local-development-20261016/build-resources-recipes-before.log`
et `build-resources-recipes-after.log`. Le lint du fichier modifié et
`git diff --check` passent également. Le snapshot préalable du contrat et du
module commun reste dans `build-resources-before/`, à côté de ces journaux.

Ces contrôles confirment les contrats de recettes, pas le comportement sous
pression mémoire. Au gel des sources, aucun build réel à 4096 Mio n'était encore
qualifié. Le rejeu est conservé séparément des interruptions précédentes.

## Rejeu réel sous les ressources corrigées

Le nouveau positif passe **3/3** (connexion, création et duplication), sans
skip, flaky ni interruption. SQL compte 1253 assertions réussies et la matrice
RLS deux tests réussis. OpenAPI, compilation complète avec TypeScript et budgets
de performance terminent à zéro ; le manifeste du build conserve l'argument
réel `--max-old-space-size=4096`.

La VM expose environ 12 Go de RAM, huit processeurs et 8 Go de swap. Son boot ID
reste identique avant/après et le swap demeure inutilisé. Sources et build
restent inchangés ; ports IPv4/IPv6 fermés et pile retirée. Reçu :
`.codex-tmp/local-army-workflow-20261016/critical-positive-resources/receipt.json`,
58 empreintes revérifiées et zéro détection de secret.

Le fichier d'échange Windows est configuré en gestion automatique, mais n'est
pas encore actif pendant ce rejeu : l'utilisateur a choisi de redémarrer le PC
lui-même après les tests. Ce résultat qualifie les limites WSL et l'invocation
corrigée, sans prétendre vérifier cette activation future. La mesure de commit
hôte et les refus de sélection sont consolidés séparément.

Les deux refus sont ensuite rejoués : aucune correspondance donne `NO_TESTS`
(SDK 2, CI 1) ; deux tests anonymes réussis donnent également CI 1, faute de setup
et de scénario métier authentifié. SQL/RLS/build passent avant chacun de ces
refus. Les rapports restent échoués, sans skip masqué ; boot inchangé et
nettoyage vérifié. Reçus `critical-no-match-resources/receipt.json` et
`critical-anonymous-only-resources/receipt.json` sous
`.codex-tmp/local-army-workflow-20261016/` (neuf et vingt empreintes revérifiées).

Le cycle dev final passe également 1/1 avec connexion, HMR sans reload et arrêt
propre ; son manifeste reste `stopped` / `e2e: not-run`. Le boot reste identique
sur les quatre cycles. La mesure hôte couvre 409 échantillons : pic de commit
environ 86,5 %, marge minimale d'environ 8,34 Gio et aucun nouvel événement 2004.
Reçu dev : `dev-qualified-resources/receipt.json` (seize empreintes revérifiées).
Synthèse hôte : `.codex-tmp/wsl-reliability-20261016/host-monitor-summary.json`.
Le moniteur est arrêté ; l'activation du pagefile après le redémarrage choisi
par l'utilisateur est vérifiée séparément ci-dessous.

## Activation vérifiée après redémarrage

Le redémarrage utilisateur du 16 octobre 2026 active `C:\pagefile.sys` en
gestion automatique, avec 28 Gio alloués. La limite de commit effective passe
de `66094223360` à `96158994432` octets (environ 61,6 à 89,6 Gio). Dix contrôles
en lecture seule passent : nouveau démarrage Windows, fichier actif, limite
augmentée, empreinte WSL inchangée, mémoire/CPU/swap attendus et absence
d'événement 2004 depuis ce démarrage, avec requête de journaux réussie.

Le reçu `.codex-tmp/wsl-reliability-20261016/post-restart-20261016/verification.json`
lève l'attente d'activation. Il ne change pas la date des validations Army
antérieures. Les preuves initiales restent inchangées et l'état précédent de
ce document est conservé dans le même dossier. Le premier reçu préparatoire
invalide est conservé et exclu explicitement de la qualification.

## Limite transmise par `NODE_OPTIONS`

Le 16 octobre 2026, un build Army sous WSL (environ 12 Go) a de nouveau échoué
pendant la vérification TypeScript, avant tout parcours, alors que
`buildCommands` passait `--max-old-space-size=4096` en argument `node`. Avec la
même limite dans `NODE_OPTIONS`, le build termine en 78 s.

Cause confirmée le même jour : Next 16.4 vérifie TypeScript par la CLI `tsc`
(`experimental.useTypeScriptCli`, actif par défaut), lancée avec `process.env`
mais sans les arguments `node` du parent : seul `NODE_OPTIONS` lui transmet la
limite. Le constat initial ci-dessus reste exact pour les workers de
compilation Webpack, qui reçoivent l'argument ; il ne l'est plus pour
TypeScript, qui ne passe pas par un worker dans ce mode. Contrôle WSL : argument
seul → `tsc` sans `NODE_OPTIONS`, arrêt vers 2035 Mo de heap ; via le lanceur →
`tsc` à 4096, pic RSS 3,0 Go.

Depuis, `scripts/next-build.mjs` impose un plancher de 4096 Mio à tous les
builds : `npm run build` (local, Vercel, `verify:production`) l'exécute et
`build-local.mjs` utilise la fonction `withNextBuildHeap()` de
`scripts/next-build-env.mjs`. Une limite héritée plus basse est relevée, une
plus haute conservée. `buildCommands` reste inchangé pour les validateurs ; le
manifeste ajoute `nodeOptions`. Règles et usage :
[développement Army local](tester-army-local-development.md#build-de-production-et-limite-de-heap).
