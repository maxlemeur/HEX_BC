# Acquittement de sauvegarde avant rechargement

Défaillance observée avant correction : le run GitHub Critical `38805538063`,
commit `a25b5c40`, termine à 63/64. Le cas de création atteint les valeurs
persistées exactes `20004 / 4000 / 24004`, sans conflit de lecture, puis
`browser.reload()` expire après 89 751 ms. Le candidat local 15 exécutait ce
même rechargement en 152 ms. Les preuves publiées sont conservées dans
`.codex-tmp/army-ci-migration-20261015/published-critical-evidence/`.

Le helper attendait les valeurs API et le titre de la page, pas l'acquittement
visible de l'éditeur. Une lecture peut voir les écritures avant la résolution
du client qui sauvegarde. Le journal montre aussi du chargement serveur après
le début du reload ; aucun dialogue n'est capturé. Une course entre acquittement
et navigation est possible, mais la cause exacte du blocage n'est pas établie.

Le scénario existant doit conserver la saisie réelle, la cadence automatique,
les valeurs API, le véritable rechargement et les contrôles/montants relus.
Après l'oracle API, il exige aussi le statut DOM exact `Sauvegardé` ou `À jour`,
comme les parcours locaux de verrou/navigation. Les preuves retiennent le
statut avant et après cette attente ; un état en cours, bloqué ou erroné ne peut
pas satisfaire cette précondition.

Pour ce seul rechargement de création, un observateur natif refuse tout dialogue
par `dismiss`, puis échoue. Il conserve seulement le nombre de dialogues et la
longueur des messages, jamais leur contenu. Le diagnostic avant/après conserve
le chemin local, l'état du document et le nombre de navigations, sans données
de session. Le timeout et le comportement `load` du SDK restent inchangés :
aucun retry, acceptation de dialogue ou rechargement de remplacement.

Le RED E2E publié est la régression primaire. Aucun test isolé n'est ajouté :
le prochain rejeu du même parcours doit qualifier cette préparation renforcée
et conserver un éventuel nouvel échec sans le déclarer résolu par construction.
