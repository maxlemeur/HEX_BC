# Labo métré (TI-661)

Le labo compare des configurations de lecture de plans sur de vrais plans, avec
des verdicts humains et des stats. C'est un outil local d'administrateur :
`/dashboard/admin/takeoff/lab` (essai), `/verdicts` et `/stats`. Il n'écrit rien
dans la base ; ses essais et verdicts sont des fichiers.

## Accès

La page et chaque route `/api/admin/takeoff/lab/*` vérifient côté serveur :
MergeOne local lancé par `npm run dev:chatgpt` et ouvert sur `127.0.0.1`
(`assertLocalChatGptHost`), un utilisateur connecté (`getUserContext()`) et
`tenant_role === "admin"`. Les routes répondent 403 sinon ; la page affiche le
refus, elle n'autorise rien par redirection.

## Lancer le labo

```sh
python3 /Users/timax/Projects/infra-ops/storage-guard/storage_guard.py begin \
  --repo mergeone --run takeoff-lab-<AAAAMMJJ> --kind source --expected-bytes <n>
cd ~/Projects/mergeone
TAKEOFF_LAB_DATASET_DIR=~/Projects/mergeone/outputs/takeoff-bench-dataset \
TAKEOFF_LAB_OUTPUT_DIR=<run_path retourné> npm run dev:chatgpt
```

- `TAKEOFF_LAB_DATASET_DIR` : le dataset de L0 (TI-659), lu seulement.
- `TAKEOFF_LAB_OUTPUT_DIR` : le run storage-guard du labo, jamais le dataset ni un
  dossier qu'il contient. Il doit exister.
- Chemins absolus, côté serveur seulement. Absent ou relatif : « Dataset non
  configuré » ; les deux fixtures fictives du dépôt restent lisibles, Lancer et
  les verdicts sont désactivés.
- `TAKEOFF_LAB_BENCH_REPORTS_DIR` (facultatif) : dossier des runs
  `takeoff-bench-*` ; par défaut le parent de la sortie. Les rapports sont lus
  seulement (`report.json` pour la liste, `report.md` pour le détail).
- Decisions : `MERGEONE_OPENAI_DECISIONS=1` et `OPENAI_DECISIONS_API_KEY` injectée
  seule (voir TI-658, jamais `--env-file=.env.local`). Sans elle, le labo affiche
  `capability.message` et désactive Decisions ; ChatGPT reste utilisable.
- `TAKEOFF_LAB_DECISIONS_MAX_TOKENS` : plafond de `total_tokens` Decisions cumulés
  sur les essais de la sortie (défaut 2 000 000). Atteint, un essai Decisions est
  refusé. Les appels sans `usage` sont comptés à part.

## Dataset

Le labo lit `manifest.json` (les PDF `raw/<id>.pdf` dont la taille et le SHA-256
correspondent encore au manifest) et deux vérités :

- clés du banc (`truth/*.json`, TI-659), notées par le score du banc (TI-660) pour
  une portée faite de ce seul document : « Clés dans la tolérance n / m » ;
- lignes, pour un dataset fictif : `lab/truth/<id>.json`,
  `{ schema_version: 1, document, items: [{ designation, quantity, unit }] }`,
  notées par `evaluateTakeoffBenchmark` (précision, rappel, quantités). La
  désignation doit être complète : la similarité minimale est 0,8.

Un recadrage n'est jamais noté : la vérité porte sur le document entier.

## Essai

- Document, recadrage (une page, ou une zone tracée sur le plan : PDF d'une page
  avec CropBox), nom de campagne (par défaut document et date).
- Tâche, une par essai. Le registre est `src/lib/takeoff/lab/tasks.ts` : une
  extraction ChatGPT (prompt et schéma du niveau C) et une question `choice`
  générique (« Lot technique du plan »). Ajouter une tâche, c'est ajouter une
  entrée à ce registre ; un nouvel écran (TI-662) ajoute sa route sous `lab/` et
  une entrée à `LAB_VIEWS` de `TakeoffLabShell.tsx`.
- Une à quatre configurations : modèle ChatGPT × effort, envoyés par le
  paramètre `override` de `callLocalChatGptStructured` après contrôle par
  `listLocalChatGptModels` (le profil doit déjà avoir un modèle ; le labo ne
  l'écrit jamais), ou Decisions (`gpt-6-luna`, sans effort), qui reçoit l'image
  de la page ou de la zone rendue par le navigateur.
- Les configurations passent l'une après l'autre. Une erreur de schéma est une
  réponse : texte brut, erreur, jetons et un élément à juger. Une limite du
  forfait, une limite de débit, un refus d'accès ou un échec Decisions arrêtent
  l'essai sans relance ; un timeout n'échoue que sa configuration.

## Stockage

- Essais : `<sortie>/runs/lab-<runId>.json`, avec la campagne, la tâche, le
  document (SHA-256), le recadrage, le prompt et sa version, et par configuration
  le modèle, l'effort, le statut, la latence, les jetons, la réponse brute, le
  score et les éléments.
- Verdicts : `<sortie>/verdicts/<campagne>/<elementId>.json`, un par élément ;
  rejuger remplace, « Annuler » supprime le dernier verdict de l'auteur dans la
  campagne. `elementId = sha256(JSON.stringify([runId, configId, "item" | "question", index | nom]))`.
- Dossiers 0700, fichiers 0600 écrits atomiquement ; noms en `[a-z0-9-]`.
- Version du prompt : extraction, `takeoff-c-v1+<sha256 du texte envoyé>` ;
  question, `sha256` du JSON canonique des questions.

## Verdicts et stats

- Clavier : B (pas bon), G (bon), S (passer), Échap (annuler le dernier verdict).
  Ignoré pendant une saisie. « Passer » n'est pas enregistré : l'élément sort de
  « à parcourir » pour la session.
- Progression : « évalués = bons + pas bons ». % jugé bon = bons / (bons + pas
  bons), avec n, par configuration et version du prompt.
- Nuage validation humaine × jetons (ou latence), échelle log, frontière de
  Pareto et zone d'intérêt (moins coûteuse et mieux jugée que la médiane).

## Parcours E2E

`e2e/army/local/takeoff-lab.e2e.ts` (listes `full` et `critical` de
`e2e.config.ts`) lance le serveur local comme `chatgpt-local.e2e.ts`, avec la
fixture `chatgpt-provider-fixture.mjs` et Decisions en fixture : aucun appel réel.
Son dataset fictif et sa sortie vide sont sous
`.e2e/army/critical/artifacts/<id>/`.

```sh
npm run e2e:army:local -- --grep 'LAB0'
```
