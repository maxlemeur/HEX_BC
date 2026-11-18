# Labo métré (TI-661)

Le labo compare des configurations de lecture de plans sur de vrais plans, avec
des verdicts humains et des stats. C'est un outil local d'administrateur :
`/dashboard/admin/takeoff/lab` (essai), `/vectors`, `/verdicts` et `/stats`. Il n'écrit rien
dans la base ; ses essais et verdicts sont des fichiers.

## Accès

La page et chaque route `/api/admin/takeoff/lab/*` vérifient côté serveur :
MergeOne local lancé par `npm run dev:chatgpt` (écoute `127.0.0.1` par défaut)
et un hôte de boucle locale au port du serveur, ou un hôte listé dans
`MERGEONE_DEV_HOSTS` (`assertLocalChatGptHost`), un utilisateur connecté
(`getUserContext()`) et `tenant_role === "admin"`. Les routes répondent 403
sinon ; la page affiche le refus, elle n'autorise rien par redirection.

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
  extraction ChatGPT (prompt et schéma du niveau C), les questions `choice`
  « Lot technique du plan » et « Tri de page », et « Classe de calque », lancée
  depuis l'écran Vecteurs. « Tri de page » reprend les dix types du
  [tri en préparation](../metier/preparation-metre.md#tri-des-pages).
  L’essai enregistre le type et sa confiance, avec la distribution des
  probabilités affichée pour Decisions comme pour les autres choix. Chaque
  tâche a une entrée dans ce registre. Un nouvel écran ajoute sa route sous
  `lab/` et une entrée à `LAB_VIEWS` de
  `TakeoffLabShell.tsx`.
- Une à quatre configurations : modèle ChatGPT × effort, envoyés par le
  paramètre `override` de `callLocalChatGptStructured` après contrôle par
  `listLocalChatGptModels` (le profil doit déjà avoir un modèle ; le labo ne
  l'écrit jamais), ou Decisions (`gpt-6-luna`, sans effort), qui reçoit l'image
  de la page ou de la zone rendue par le navigateur.
- Ou la **clé API OpenAI** du membre (fournisseur « Clé API OpenAI », extraction
  seulement) : voir [Clé API OpenAI](#clé-api-openai).
- Les configurations passent l'une après l'autre. Une erreur de schéma est une
  réponse : texte brut, erreur, jetons et un élément à juger. Une limite du
  forfait, une limite de débit, un refus d'accès ou un échec Decisions arrêtent
  l'essai sans relance ; un timeout n'échoue que sa configuration.

## Clé API OpenAI

Une configuration peut utiliser la clé API OpenAI enregistrée dans « Mon profil »
([Clé API OpenAI](chatgpt-local.md#clé-api-openai)), sans que ChatGPT soit connecté.
Elle est facturée sur le compte OpenAI du membre ; le choix est explicite pour
chaque configuration, jamais un repli.

- Modèles : ceux que la clé a listés à son enregistrement parmi les modèles
  qualifiés et tarifés ; efforts du modèle, nommés en français. Dessiner le labo
  n'ouvre ni le Trousseau ni OpenAI. Le prompt et le schéma sont ceux du niveau C
  (mode JSON et schéma dans le message développeur, puis validation Zod et métier).
- Le lancement envoie la version de la clé affichée : une clé remplacée dans un
  autre onglet depuis est refusée avant l'ouverture du Trousseau (« Rechargez la
  page »). Utilisateur et entreprise viennent de la session.
- Plafond : **1,00 $ US par essai**, partagé à parts égales entre ses
  configurations « clé ». Avant toute génération, OpenAI compte la requête exacte
  de chacune (`POST /v1/responses/input_tokens`, qui transmet le document, ce que
  le lancement accepte) ; l'entrée comptée est chiffrée à son pire tarif
  (écriture en cache, contexte long) et la sortie autorisée est ce qui reste de la
  part, au plus 32 000 jetons (64 000 pour `xhigh` et `max`), raisonnement
  compris. Moins de 8 000 jetons possibles, un comptage indisponible ou un modèle
  sans tarif connu refusent l'essai entier avant la première génération. La
  borne (entrée comptée + sortie autorisée) ne dépasse donc jamais la part.
- Si l'usage annoncé coûte malgré tout plus que le plafond, l'essai l'écrit en
  français (« Dépassement du plafond … ») et s'arrête : les configurations
  suivantes ne partent pas.
- Résultat : quantités et page source, modèle effectivement utilisé,
  consommation annoncée (jetons en cache, écrits et de raisonnement comptés une
  fois), entrée comptée, sortie autorisée et coût estimé en **$ US** avec le
  barème daté (`billing` de la configuration, en nano-dollars). L'essai garde
  l'entreprise de son auteur (`author.tenant_id`) et le fournisseur de l'API
  (`api_provider`) dans l'identité de la configuration.
  « moins de 0,01 $ US » si le coût arrondi est nul. Une réponse rejetée par le
  schéma garde son usage et son coût. Une réponse perdue après l'envoi reste
  « consommation à confirmer » et n'est jamais renvoyée.
- Un refus de la clé, une limite de dépense ou de débit, une réponse perdue
  arrêtent l'essai ; un modèle refusé, une demande rejetée ou une sortie tronquée
  n'échouent que leur configuration. Le message est le message fixe du code
  (`error_code`), jamais le texte du fournisseur.

## Vecteurs (TI-662)

- Document et page, puis les calques et couleurs de la page lus par mots-clés
  (`GET /api/admin/takeoff/lab/vectors/<documentId>?page=n[&run=<runId>]`) : par
  groupe, la classe, sa confiance et sa source, la devinette des mots-clés, la
  longueur et les segments ; au centre le plan et les groupes cochés, les badges
  « Échelle » et « Détection », les longueurs mesurées par réseau.
- Tout masquer, Tout afficher, Choix du modèle (les groupes classés par
  Decisions), Mots-clés (ceux que les mots-clés classent), Copier la sélection (le
  JSON `truth/groups` des groupes cochés) ; Alt-clic sur une case isole un groupe.
- « Classer avec Decisions » passe par `POST /runs` avec la tâche
  `classe-de-calque` : une seule configuration Decisions, une page entière, sans
  image du navigateur ni zone, le prompt fixé. Les images sont rendues par le
  serveur ; les appels s'arrêtent au premier échec ou au reste du plafond. La page
  est relue avec les réponses (`&run=`). Règles :
  [lecture vectorielle](../metier/lecture-vectorielle.md), section « Labo ».

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
`e2e.config.ts`) lance le serveur local comme les parcours ChatGPT local, avec la
fixture `chatgpt-provider-fixture.mjs` et Decisions en fixture : aucun appel réel.
Son dataset fictif et sa sortie vide sont sous
`.e2e/army/critical/artifacts/<id>/`.

LAB05 prouve la clé API avec un administrateur sans forfait ChatGPT : saisie
dans « Mon profil », recharge, état masqué, test du modèle, extraction du plan
fictif (12,5 m et quatre vannes, page 1, entrée comptée, coût en $ US), refus
d'une page périmée, réponse du fournisseur qui renvoie la clé (masquée partout),
retrait, refus des routes hors hôte local, d'une autre origine ou sans session.
La fixture `api-key-provider-fixture.mjs`, préchargée après celle du forfait,
refuse de s'installer hors d'un serveur Army de développement ; elle répond au
catalogue de l'API, au comptage et à Responses, et remplace le Trousseau, absent
sous Linux, par un magasin en mémoire du serveur du parcours. Ce magasin n'est
pris en compte que si la version n'est pas de production, que l'intégration
locale est active (`isLocalChatGptEnabled` : tout serveur de développement, CI
compris, ou un opt-in explicite hors CI) et que `E2E_ARMY=1`, et seulement s'il a
été installé par du code chargé au démarrage du processus : aucun réglage seul ne
l'active, il n'écrit rien sur disque. Il décode exactement ce que MergeOne écrit :
il prouve le câblage, pas le vrai Trousseau. La clé fictive est le secret
`lab-api-key` du runner (`e2e.config.ts`, dérivé du mot de passe aléatoire de la
campagne) : saisie par son handle, elle est masquée des rapports du runner. La
fixture n'en reçoit que le SHA-256 ; le parcours vérifie son absence des fichiers
de la campagne, des fichiers de résultat du parcours déjà écrits, du journal de
transport et de toute la sortie du serveur.

L'écran Vecteurs est prouvé par VEC01 de `chatgpt-local-decisions.e2e.ts` : un plan fictif
à calques (`lab-vector-plan-fixture.ts`) dans un dataset fictif sous les artefacts
du run, la fixture Decisions qui répond EU à 0,8 pour chaque groupe. Il retient
aussi la réponse Decisions pendant un changement de document : l'essai enregistré
ne s'applique pas à la nouvelle sélection. LAB03 vérifie aussi les refus de sa
route. Les arrêts que le navigateur ne peut pas provoquer (rendu dédié ou appel
dédié en échec après des réponses payées, course de deux essais sur le plafond,
appels sans usage) sont vérifiés par `src/lib/takeoff/lab/vectors.test.ts` et
`src/lib/takeoff/lab/runs.test.ts` ; un essai de l'historique (« Afficher ») qui
répond après un changement de document, par `LabVectorsScreen.test.tsx`.

```sh
npm run e2e:army:local -- --grep 'LAB0|VEC01'
```
