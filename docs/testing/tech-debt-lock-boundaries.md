# Frontière de session des écritures secondaires de devis

Contrat défini le 15 octobre 2026 avant correction. Le lot réutilise le
contrôle existant `server-context.assertDraftLockOwnedByCurrentUser` dans
les structures proposées, la revue V0, l'apprentissage et les outliers.
Il conserve les contrôles existants de tenant, propriétaire et brouillon,
ainsi que le refus des projets archivés dans les structures et V0.
Aucun schéma, privilège ou politique RLS n'est modifié.

## Défaillances et preuve E2E attendue

| Défaillance | Scénario observable |
| --- | --- |
| Le détenteur utilisateur suffit sans identité de page | Acquérir un bail réel, envoyer une mutation HTTP sans en-tête de session : 409, aucun changement métier. |
| Une autre page du même utilisateur peut écrire | Même mutation avec une autre identité UUID : 409, aucun changement métier. |
| La correction bloque aussi le propriétaire courant | Avec l'identité du bail acquis : 200 (201 pour l'application de structure), résultat relu par API/RLS. |
| Un refus modifie les données ou les montants | Comparer avant/après les lignes, montants, révision et objets propres au parcours. |

`e2e/army/local/tech-debt-lock-boundaries.e2e.ts` utilise le login UI
ordinaire, une affaire ARMY neuve et les routes réelles. Les fixtures V0 et
structure sont préparées par un client connecté ordinaire soumis à RLS,
sur Supabase local uniquement, sans modèle. Une règle d'apprentissage neuve
appartient au compte de recette. Dans un tenant local dont le nom commence
par ARMY, le flag `EST_163_SUGGESTION_LEARNING` est créé temporairement
seulement si son absence est vérifiée, puis sa seule ligne est supprimée
en `finally`. Un flag existant est préservé ; s'il est désactivé, la
préparation échoue sans prétendre couvrir l'écriture avec le chemin no-op.

La création du devis et de ses lignes se fait depuis la liste, par les
API réelles, avant de monter l'éditeur : aucun heartbeat d'éditeur ne
concurrence le bail de la fixture. Le bail courant est renouvelé avant
chaque mutation testée, avec vérification du statut 201 et de la session
courante. Les snapshots métier excluent le bail.

Les identités de bail et les réponses de verrou ne sont jamais archivées.
Les preuves conservent les identités de fixtures, mode de session
(`missing`, `different`, `current`), code HTTP, code d'erreur, état métier
et valeurs attendues. Le wrapper conserve commande, source et changements,
environnement, rapport et empreintes. Les fixtures sont retenues.

## Frontière SQL inspectée

Les RPC `apply_estimate_structure_draft` et
`materialize_estimate_version_zero_draft` sont des fonctions invoker
contrôlant tenant et état des données ; leur signature ne porte pas
l'identité de page. Les écritures de revue V0, corrections et outliers
passent par les politiques RLS ordinaires. Ces protections ne remplacent
pas le contrôle de bail de la route applicative. Ce lot ne qualifie pas
une exclusion transactionnelle contre une reprise concurrente du bail,
ni une interdiction de toute écriture directe par Data API.

## Isolation et vérification

Aucune nouvelle régression isolée n'est nécessaire : les erreurs de
session sont reproductibles par HTTP réel. Les suites isolées existantes
des modules touchés ont été rejouées pour préserver leurs exceptions
spécialistes et signaler séparément les éventuels échecs préexistants.
Le harnais V0 existant a été adapté avant le code pour accepter la lecture
du nom d'un détenteur étranger, sans autoriser les lectures métier suivantes.

## Résultats exécutés le 15 octobre 2026

Les deux archives ci-dessous conservent la commande résolue, la révision
`28ccc857287b3493927cfc5c634a53464025d838`, le diff local et ses empreintes,
l'environnement, les identités de fixtures et les preuves JSON détaillées.
Dans les deux cas, `source.changedDuringRun` vaut `false`.

| Exécution | Résultat LOCK01 | Archive |
| --- | --- | --- |
| Avant correction, runtime de développement local | Rouge : sept requêtes sur huit acceptées, dont la requête sans session dans chacun des quatre parcours. | [Manifeste rouge](../../.e2e/army/critical/runs/2026-10-15T06-13-20-332Z/manifest.json) |
| Après correction, build production local | Vert en 9,53 s : huit refus 409 `CONFLICT`, aucun changement métier ; quatre succès 200/201, valeurs relues après rechargement. | [Manifeste production](../../.e2e/army/critical/runs/2026-10-15T06-27-36-211Z/manifest.json), [rapport](../../.e2e/army/critical/runs/2026-10-15T06-27-36-211Z/report.json) |

Dans le rouge, la première requête structure a déjà appliqué le brouillon.
La seconde reçoit donc `ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING` : elle ne
prouve pas une seconde écriture ni un refus de session. Le vert vérifie
bien les deux refus `CONFLICT` sur une structure encore intacte.

Les fichiers `artifacts/business/*-lock-boundary-refusals.json` des archives
contiennent la matrice des huit requêtes. Les fichiers `*-current.json`
portent les quatre succès et leurs états persistés ;
`*-lock-boundary-flag-restored.json` confirme la suppression de la seule
ligne de flag créée pour chaque run. Les données ARMY restent disponibles.
Le run production a l'identité `01a13e3e-abe9-729c-9507-07b673f48307`.
Sa campagne parente contient un échec indépendant de l'oracle numérique ;
le statut passé ici est celui de LOCK01, pas celui de toute la campagne.
Ce cas numérique a ensuite réussi, après ajustement de son attente et
sans changement produit, dans l'[archive filtrée](../../.e2e/army/critical/runs/2026-10-15T06-32-13-486Z/manifest.json).

Les quatre suites isolées existantes des modules verrouillage passent
34/34 avant et après correction. Lint des fichiers touchés et
`git diff --check` ciblé passent. La validation ciblée du lot complet passe
131/131 : [rapport Vitest](../../.codex-tmp/debt-lot1-20261015/scoped-tests.json).
Les échecs initiaux de setup (flag absent puis concurrence du heartbeat)
ne constituent aucune preuve des quatre contrôles de session.
