# Profil TesterArmy calc-v3 sur la pile possédée (lot 2, sous-lot 2.0)

Ce profil rejoue, sur la pile Supabase native jetable de `scripts/run-tester-army-ci.ts`,
les parcours de base du lot 2 listés au §14 (2.0) de
[la conception du moteur v3](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md) :
`estimate-totals-order`, `estimate-batch-atomic`, `estimate-create-atomic`, `commercial-rounding`,
l'émission d'offre, `dpgf-import` et `generated-ouvrage-*`. Il ne change aucun code applicatif.
Les sous-lots suivants y ajouteront leurs parcours v3.

## Contrat défini avant implémentation

Défaillances à exposer, et refus correspondants :

1. **Mauvaise cible.** Une campagne qui viserait la pile longue des recettes (API 45585, base
   33485), un Supabase hébergé ou une origine hors boucle locale doit échouer avant tout parcours.
   Le profil `e2e/army/local/calc-v3.config.ts` refuse ces ports pour l'API, l'application, le
   collecteur et une éventuelle route PostgreSQL ; il exige le marqueur posé par le lanceur possédé
   (`E2E_CALC_V3_OWNED_STACK=1`), une même origine pour l'API, l'origine de couverture et l'hôte
   autorisé, le mode serveur de la phase et l'absence de marqueur d'hébergement.
2. **Preuve vide.** Un code retour nul ne suffit pas. Chaque phase exige son setup de connexion
   exact et au moins un parcours métier, tous réussis, sans skip, retry, interruption ni appel de
   modèle ; sans `--grep`, le nombre de résultats réussis par fichier doit égaler la sélection
   attendue (`scripts/tester-army/calc-v3-phases.ts`), ce qui détecte une désélection silencieuse
   (par exemple un parcours défini sous condition d'une variable absente).
3. **Fixture fausse ou partielle.** Les prérequis sont semés par phase, avec des identités neuves,
   en une transaction PostgreSQL exécutée par le propriétaire natif, avec relecture par ligne ; un
   échec annule tout, sans retry. Aucune application, aucun instantané, aucune ligne parente ni
   décision humaine n'est semé. Les propositions d'ouvrages générés ne passent pas par REST : le
   garde INVOKER `private.guard_generated_ouvrage_write` le refuse
   ([prérequis GEN](generated-review-prerequisites.md)). Les fichiers de fixture ne contiennent
   que des identités ; les connexions passent par l'environnement du processus de parcours.
4. **Émission non prouvée.** Le courriel ne peut partir que vers le collecteur sentinelle
   (`scripts/tester-army/offer-collector.mjs`, clé sentinelle, destinataires `.invalid`) et le
   serveur charge le garde réseau d'offre. La campagne exige au moins un PDF reçu ; chaque pièce
   jointe doit correspondre à son reçu (SHA-256, taille) et son texte est relu par
   `scripts/tester-army/pdf-text.ts`, qui refuse un fichier non PDF, tronqué ou sans texte et
   extrait dans un thread terminable (PDF.js sans worker n'est pas préemptible, voir `AGENTS.md`).
   Sans `--grep`, chaque PDF reçu doit contenir le contenu métier de la sélection
   (`collectedPdfMustContain`, `scripts/tester-army/calc-v3-phases.ts`) : `ARMY-OFFER-`, l'en-tête
   « Désignation Qté Unité PU HT Total HT », la ligne 1 u à 20,00 € et le pied 20,00 € / 4,00 € /
   24,00 €. Un PDF lisible mais faux fait échouer la phase.
5. **Sources ou build modifiés pendant la campagne.** Les sources (`buildSourceEvidence` et
   `e2e/army/**`) sont comparées avant et après ; l'identité du build de production est comparée
   avant et après chaque phase de production. La phase d'émission, servie par `next dev`, passe en
   dernier car elle réécrit `.e2e/army/next`.
6. **Fuite dans les preuves.** Les textes copiés (rapport, résultats, journaux, preuves métier,
   texte des PDF) sont expurgés : identifiants, clés, mots de passe des comptes neufs, jetons et
   URL de portail, DSN. Les répertoires `sessions` et `private` ne sont jamais copiés ; le contrôle
   de confidentialité du lanceur s'applique ensuite à toute l'archive.
7. **Garde de route contourné.** Le profil n'ajoute aucun garde de route : il réutilise
   `restrictCriticalBrowser` et `restrictOfferBrowser`, déjà déclarés dans
   `ARMY_ROUTE_GUARD_CONTINUES` (`src/test/ci-guardrails.test.ts`).

## Phases

Chaque phase est une invocation TesterArmy distincte de `e2e.calc-v3.config.ts` (cible
`chromium-desktop`, un worker, aucun retry, traces désactivées), avec ses propres fixtures.

| Phase | Serveur | Parcours (résultats attendus, setup compris) | Fixture semée |
|---|---|---|---|
| `journeys` | build possédé, `next start` | setup critique, `commercial-rounding` (2), `dpgf-import` (3), `estimate-totals-order` (1), `estimate-create-atomic` (3), `estimate-batch-atomic` (1) : 11 | témoin d'ordre (remise 1 667 pb, B avant A par UUID, A à 2 c) ; deux brouillons V1 vides pour la création atomique |
| `components` | idem | setup, `generated-ouvrage-components` GC01–GC04 : 5 | plan `componentsRecords` (sélection `full`) |
| `numeric` | idem | setup, `generated-ouvrage-numeric-entry` NI01–NI03 : 4 | plan `componentsRecords` (sélection `numeric-all`) |
| `resume` | idem | setup, `generated-ouvrage-resume` GR02, GR04, GR06, GR08 : 5 (GR01, GR03, GR05, GR07, GR09 rouges à la base, hors sélection) | propriétaire dédié (RMO 4 000 c unique), autre auteur, tenant étranger, 13 scénarios dont 21 brouillons paginés et la matrice de coûts |
| `access` | idem | setup, `generated-ouvrage-access` GR07 : 2 | propriétaire et observateur administrateurs dédiés ; le parcours archive et rétrograde ce seul propriétaire |
| `offers` | build possédé, `next start` | setup, `supplier-offer-zero-price` OZ01–OZ04 : 5 (sous-lot 2.2, [estimate-engine-v3-2.2.md](estimate-engine-v3-2.2.md) ; OZ04 : [version-totals-after-preselection.md](version-totals-after-preselection.md)) | propriétaire dédié en mode Expert, trois fournisseurs, trois articles et quatre offres en « ml » (dont trois à 0 €), un brouillon par parcours (v2 pour OZ01–OZ03, v1 historique pour OZ04), un chantier |
| `emission` | `next dev` | setup d'offre, `offer-emission` OF00, OF01, OF02, OF04, OF0L : 6 (OF03 rouge à la base, hors sélection) | aucune : les parcours créent leurs devis `ARMY-OFFER-` par l'interface |

Une phase sans `--grep` applique sa sélection par défaut (`defaultGrep`) et exige exactement ces
nombres. Les parcours rouges sur la base non modifiée sont nommés dans `knownRedAtBase`
(`scripts/tester-army/calc-v3-phases.ts`), recopié dans chaque `phase.json` : ils ne sont pas
désélectionnés en silence, ils se rejouent par `--phase <phase> --grep <motif>` et leur cause est
consignée plus bas.

Les phases `journeys`, `components`, `numeric` et `emission` utilisent le compte neuf du lanceur
(tenant personnel, taux MO 4 000 c, article `ARMY-CU22-ML`) ; `offers` utilise son propre compte, en mode
Expert, où la présélection fournisseurs est visible. Les fixtures `resume` et `access`
reprennent la forme des graines qualifiées non versionnées (`.e2e/source-coverage/seed-generated.cjs`,
`.e2e/source-coverage/access-staged/seed-generated-access.cjs`, 11/10/2026) ; elles sont
réexécutées sur le schéma courant par cette campagne, pas encore qualifiées.

Le mode `next dev` de l'émission découle de `canUseDevelopmentEstimateTerms`
(`src/lib/estimates/pdf-terms-server.ts`) : les conditions bac à sable n'y dépendent d'aucune origine.
L'extension de ce garde au build de production de la pile possédée change un comportement : elle
relève du sous-lot 2.7. `offer-emission.config.ts` reste inchangé.

## Préconditions des parcours semés

`estimate-totals-order`, `generated-ouvrage-resume` et `generated-ouvrage-access` exigeaient
l'origine fixe `http://127.0.0.1:59827` de l'ancienne pile d'audit, que la pile possédée ne peut pas
reprendre (ports tirés hors de la plage éphémère à chaque exécution). Ce littéral est remplacé par
`isolatedLocalBackend()` (`e2e/army/local/isolated-backend.ts`) : il accepte toujours 59827, et la pile
possédée seulement si le lanceur calc-v3 l'a marquée et que l'origine de couverture désigne la même
API en boucle locale, hors 45585 et 33485. Les assertions métier de ces parcours sont inchangées.

Deux autres préconditions de harnais ont été corrigées lors de la première exécution (16/10/2026),
sans toucher une assertion :

- GR08 exigeait que la racine des téléchargements du SDK soit sous `.e2e/product-foundation/runs`
  (recette d'audit). Elle est maintenant donnée par `isolatedRunsRoot()` : `.e2e/army/calc-v3/runs`
  seulement quand `isolatedLocalBackend()` accepte la pile possédée, sinon la racine d'audit.
- OF03 lisait la charge RSC du portail par `fetch(location.href, { headers: { RSC: "1" }, redirect: "error" })`.
  Next 16.4 valide les en-têtes RSC (`experimental.validateRSCRequestHeaders`, actif par défaut) :
  sans en-tête d'état du routeur, la clé de cache attendue est un `_rsc` nu, et une requête qui ne la
  porte pas reçoit un 307 vers la même URL, que `redirect: "error"` transforme en « Failed to fetch ».
  La requête porte désormais `?_rsc` ; les redirections restent refusées. Ce défaut existait à
  `98408ef0` dans tous les modes, production comprise.

## Exécution (WSL, une exécution native à la fois)

Le runtime natif refuse Windows : la campagne tourne dans WSL Ubuntu-24.04, depuis le clone Linux
miroir du worktree, après synchronisation.

```sh
# Git Bash (Windows) : refléter le worktree dans le clone Linux
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-24.04 --exec bash /mnt/c/Users/maxim/Projects/miaouffrage-lot2/.e2e/lot2-2.0/sync-to-wsl.sh

# WSL, dans ~/miaouffrage-lot2 (Node 24 via nvm)
npm run e2e:army:calc-v3                                        # toutes les phases
npm run e2e:army:calc-v3 -- --phase emission                    # une phase
npm run e2e:army:calc-v3 -- --phase emission --grep '^OF00\s'   # une phase filtrée
```

Sur macOS (puce Apple, macOS 14 ou plus récent), le runtime natif tourne directement : lancer les
mêmes commandes depuis une copie propre, sans `.env.local` à la racine, que le lanceur refuse
(clone ou `git worktree add --detach`). Régression finale du 16/10/2026 sur macOS : voir
[estimate-engine-v3-2.0.md](estimate-engine-v3-2.0.md).

`--grep` n'est accepté qu'avec `--phase` ; une phase filtrée ne prouve que ses résultats
sélectionnés et la manifeste l'indique (`filtered`). Les cas PDFL, EF et NF de l'offre restent
disponibles par `--grep` sur la phase `emission`.

D'autres sessions lancent aussi des piles natives dans la même VM WSL, sans partager de verrou. Une
exécution concurrente change les temps de réponse : avant d'interpréter un rouge, vérifier qu'aucune
autre pile, build ou navigateur ne tournait (les exécutions de la ligne de base ci-dessous ont
échantillonné ces processus toutes les 20 s ; aucun chevauchement pour les exécutions retenues).

## CI nocturne (`e2e-army-calc-v3.yml`)

Demande du 18/10/2026 : la campagne tourne aussi en CI, chaque nuit à 04:45 UTC et à la demande
(Actions → TesterArmy calc-v3 → Run workflow, ou `gh workflow run e2e-army-calc-v3.yml --ref
<branche> -f phase=<choix>`), dès que ce workflow est sur `main` : GitHub ne planifie et ne déclenche
que les workflows de la branche par défaut, puis exécute la version du fichier de la branche
demandée. Inutile ensuite de la relancer en local pour une branche poussée : la déclencher sur la
branche et lire l'artefact `army-calc-v3-evidence` (un répertoire `.e2e/army/ci/<horodatage>-calc-v3/`
par invocation, mêmes preuves qu'en local). Une PR vers `main` qui modifie
`.github/workflows/e2e-army-calc-v3.yml` lance d'elle-même la sélection `nightly` : c'est ainsi que
le workflow est prouvé avant sa fusion, et que la PR de 2.7 prouve l'émission en production. Aucune
autre PR ne le lance.

| Entrée `phase` | Exécution |
|---|---|
| `nightly` (défaut, la planification et une PR qui modifie le workflow) | `journeys`, `components`, `numeric`, `resume`, `access`, `offers` : une invocation `--phase` et une pile possédée par phase, dans un seul job ; une phase rouge n'arrête pas les suivantes |
| `all` | `npm run e2e:army:calc-v3` à l'identique : toutes les phases sur une pile, émission comprise, en dernier |
| une phase | `--phase <phase>`, `emission` comprise |

**Émission exclue de la nuit.** Elle est servie par `next dev` (section « Phases » ci-dessus), où OF00
échoue 7/7 depuis la PR #34 (le rechargement à chaud remonte l'éditeur ; 6/6 en production avec un
garde local). La lancer chaque nuit ne produirait qu'un rouge connu. Le sous-lot 2.7
(`lot2/2.7-document-emission-v3`) étend `canUseDevelopmentEstimateTerms` au profil de production
possédé et passe l'émission en `serverMode: "production"`. Réactivation, dans la même PR que 2.7 :
ajouter `emission` à `CALC_V3_NIGHTLY_PHASES` dans `.github/workflows/e2e-army-calc-v3.yml`, rien
d'autre. Le garde `src/test/ci-guardrails.test.ts` impose que cette liste soit exactement les phases
de production de `scripts/tester-army/calc-v3-phases.ts` et n'interdit l'émission que tant qu'elle
n'est pas servie en production : il échoue tant que l'émission basculée n'y est pas ajoutée, et cet
ajout suffit à le remettre au vert.

La nuit ne fixe ni `--grep` ni instantané de base : chaque phase applique sa sélection par défaut et
ses nombres attendus, sur une base issue d'un `db reset` complet. Les rouges à la base (`knownRedAtBase`)
restent hors sélection et se rejouent en local par `--phase <phase> --grep <motif>`.

## Preuves

- `.e2e/army/ci/<horodatage>-calc-v3/` : manifeste du lanceur (commande, révision et empreinte des
  changements, migrations, SQL/RLS, contrôle de confidentialité, empreintes de tous les fichiers),
  `database.log`, `build.log`, `calc-v3.json` (phases, sources avant/après), `fixtures/<phase>/*.json`
  et, par phase, `<phase>/phase.json` (commande, noms des variables, identités, attendu et obtenu par
  fichier, identité du build, reçu du garde réseau), `runner.log`, `sdk/` (rapport, résultats,
  journal applicatif), `business/` (preuves métier de la phase) ; pour l'émission, `offer-public/`,
  `collector/` (reçus publics) et `pdf-text/` (texte expurgé de chaque PDF reçu).
- Sorties SDK brutes : `.e2e/army/calc-v3/runs/<horodatage>/<phase>/` et, pour l'émission,
  `.e2e/army/offer/runs/<horodatage>-calc-v3-<uuid>/` (charge utile et PDF privés du collecteur).

## Ligne de base du 16/10/2026

Campagne complète `npm run e2e:army:calc-v3`, WSL Ubuntu-24.04, Node 24.19.0, Supabase CLI 2.120.0,
TesterArmy `e2e` 0.21.0, clone miroir `~/miaouffrage-lot2-e2e` à `10da1caf` (sources applicatives
identiques à `98408ef0`) plus les fichiers 2.0 non commités (`diffSha256` `de15b404…3a2d`). Archive
`.e2e/army/ci/2026-10-16T16-37-49-812Z-calc-v3/` : code retour 0, pgTAP 13 fichiers / 1 253 assertions
PASS, matrice RLS passée, inventaire des 244 migrations conforme, un build possédé inchangé pendant
chaque phase de production, sources inchangées pendant la campagne, contrôle de confidentialité passé
(556 fichiers), 6 min 02 s. Aucun processus d'une autre session n'a chevauché l'exécution.

| Phase | Résultat | Valeurs de base (centimes HT / TVA / TTC sauf mention) |
|---|---|---|
| `journeys` | 11/11 | `commercial-rounding` : ligne 76 063 HT, TTC 91 276 sans arrondi ; inférieur au pas 100 → 91 200 (−76), 1 000 → 91 000 (−276), 5 000 et 10 000 → 90 000 (−1 276) ; multiple exact 76 083 HT → 91 300 ; historiques bas 250 → 91 250 (−26), plus proche 100 → 91 300 (+24), haut 1 000 → 92 000 (+724) ; XLSX 760,63 / 152,13 / 912,76, arrondi −0,76, à payer 912. `dpgf-import` : deux CSV 9 625 / 1 925 / 11 550 ; DPGF03 essai à blanc sans écriture. `estimate-totals-order` : enregistré 5 / 0 / 5 (brut 6, remise 1 667 pb), export 0,05 / 0 / 0,05. `estimate-batch-atomic` WFC01 : 5 / 0 / 5 avant, après le lot refusé, au rechargement et aux exports. `estimate-create-atomic` : CA01 40 000 / 8 000 / 48 000 → 48 000 / 9 600 / 57 600 → 53 000 / 10 600 / 63 600 → 71 000 / 14 200 / 85 200 ; CA02 v2 et v1 2 000 / 400 / 2 400, v1 MO séparée 8 000 / 1 600 / 9 600 puis 14 000 / 2 800 / 16 800 ; CA03 100 100 / 20 020 / 120 120, 200 200 / 40 040 / 240 240, 600 240 / 120 048 / 720 288 |
| `components` | 5/5 | GC01 et GC02 8 000 / 1 600 / 9 600 (application, rechargement, exports, réemploi) ; GC03 et GC04 refusent sans écriture |
| `numeric` | 4/4 | NI01 1 250 / 250 / 1 500 ; NI02 5 000 / 1 000 / 6 000 ; NI03 A 10 500 / 2 100 / 12 600, B 10 250 / 2 050 / 12 300 |
| `resume` | 5/5 | GR02 21 brouillons en 20 + 1 ; GR04 40 000 / 8 000 / 48 000 puis 80 000 / 16 000 / 96 000 ; GR06 aucune insertion ; GR08 unité « m » identique API, interface et DPGF, quantité 10, 40 €, 40 000 / 8 000 / 48 000 |
| `access` | 2/2 | GR07 accès : liste et reprise refusées après archivage puis rétrogradation, 0 ligne |
| `emission` | 6/6 | OF00, OF01, OF02, OF04 : 2 000 / 400 / 2 400 ; OF04 accepté puis archivé sans changement ; OF0L : aucun envoi sous bail d'une autre page. Quatre PDF reçus par le collecteur (OF00, OF01, OF02 et son renvoi au même SHA-256), 2 pages, 4 534 caractères, en-tête « Désignation Qté Unité PU HT Total HT », pied 20,00 € / 4,00 € / 24,00 € relu par `pdf-text.ts` |

Les valeurs par preuve métier sont extraites dans `.e2e/lot2-2.0/run-e2e/baseline-values-full-3.json`
(copie de travail du worktree, non versionnée).

## Rouges à la base (`98408ef0`)

Ces parcours échouent sur la base non modifiée pour une raison antérieure au lot 2, sans lien avec
le harnais. Leurs assertions ne sont pas modifiées ; ils sont hors sélection par défaut et se
rejouent tels quels.

| Parcours | Rejouer | Échec observé | Cause |
|---|---|---|---|
| OF03 | `--phase emission --grep '^OF03\s'` | `expect(witness.unitSale20).toBe(true)` : faux ; `hasUnitSaleHeader` serait faux aussi | Les deux sélecteurs d'en-tête attendent `/P\.U\.\s*HT\|Prix unitaire/i` ; le portail et le PDF impriment « PU HT » (`src/components/estimate-document/CommercialEstimateDocument.tsx:65`). Le reste du témoin est conforme : ligne 1 u à 20,00 €, total 20,00 €, CGV « Projet de CGV - Travaux B2B » version 3, RSC 200 `text/x-component`, aucune clé privée dans HTML, RSC et DOM, API interne 401 `UNAUTHORIZED`. Diagnostic sur le clone seul, sélecteurs élargis à « PU HT » : OF03 passe (2/2 avec son setup). Seul exécuté auparavant (13/10), il s'arrêtait sur l'absence de CGV |
| GR01 | `--phase resume --grep '^GR01\s'` | refus « wrong » : `VALIDATION_ERROR` au lieu de `CONFLICT` | Le corps forgé d'`insertGeneratedOuvrages` n'a ni `operationKey` ni `expectedUpdatedAt`, exigés par `generatedOuvrageInsertInputSchema` depuis `28ccc857` : Zod refuse avant le contrôle de session (« La demande d'insertion est invalide. ») |
| GR03 | `--phase resume --grep '^GR03\s'` | `toEqual` exact échoue sur `{ ok: false, error: { status: 404, code: "NOT_FOUND", … } }` | `generatedOuvrageFailure` ajoute `status` à l'erreur (`src/app/dashboard/affaires/_actions/generated-ouvrages.ts`) ; code et message attendus sont identiques |
| GR05 | `--phase resume --grep '^GR05\s'` | intermittent : `changedRecords` 0 au lieu de 1 (1 succès, 3 échecs en 4 exécutions) | Course du parcours : `waitForResponse` armé après le mode `list-invalid` capture l'événement tardif de la réponse que le parcours a lui-même fournie. Diagnostic sur le clone seul : réponse capturée 200 `text/x-component`, corps `invalid-flight-response` |
| GR07 | `--phase resume --grep '^GR07\s'` | `refused.result.ok` vrai | Le rejet forgé n'envoie que `draftId` et `candidateId` ; `generatedOuvrageRejectInputSchema` exige aussi `versionId` et `draftLockSessionId` (`28ccc857`). Le parcours ne vérifie que le statut HTTP 200 de l'action : le brouillon n'est pas rejeté et la relecture réussit (déduit du code, le corps de la réponse de rejet n'est pas enregistré) |
| GR09 | `--phase resume --grep '^GR09\s'` | scénario `cost_yield` : `[h_mo, k_mo, labor_role_id]` vaut `[5, 0.8, <rôle RMO 4 000>]` au lieu de `[5, 0.8, null]` | `commit_generated_ouvrages` écrit le rôle préféré sur chaque composant MO de l'ouvrage canonique (`supabase/migrations/20261012215942_generated_ouvrage_component_decisions.sql`, insertion de `estimate_assembly_items`). `cost_base` (40 000 / 8 000 / 48 000) et `cost_loss` (8 400 / 1 680 / 10 080) passent avant ; `cost_canonical_inexact`, `cost_parent_inexact` et `cost_batch` ne sont pas atteints |

## GR06 en CI

**Observé.** Run 39089316912 (sélection `nightly` de la PR #42), deux tentatives : la phase `resume`
échoue sur GR06 seul, ligne 569 (`const flight = await response.text()`), avec
`waitForResponse: response body could not be read: net::ERR_ABORTED`. GR02, GR04 et GR08 passent ;
les cinq `skipped` du rapport sont les rouges à la base, hors sélection.

**Hypothèse écartée par les preuves.** L'attente `browser.waitForResponse(<URL de l'éditeur>)` ne
filtre que l'URL (motif chaîne compilé en expression ancrée sur l'URL complète par le SDK) : toute
requête vers l'éditeur pouvait répondre. Mais dans les deux tentatives, la réponse capturée est bien
celle de la reprise retenue puis relâchée :

- le registre d'actions de GR06 (`generated-action-ledger-*`) ne contient qu'un
  `listResumableGeneratedOuvrageDrafts` et un `fetchResumableGeneratedOuvrageDraft` ;
- le journal réseau du serveur (`server-network.jsonl`) ne montre, après le relâchement, que les
  lectures de la reprise : tentative 1, attente armée à 02:30:40.165, lectures 40.174–40.355,
  correspondance à 40.396 (231 ms) ; tentative 2, 03:01:16.403, 16.412–16.558, 202 ms. Une requête
  RSC (rafraîchissement, préchargement) porte `?_rsc=` et ne peut pas correspondre au motif exact ;
  aucune n'a atteint le serveur dans cette fenêtre.

Les en-têtes de la vraie réponse sont donc arrivés, puis Chromium a signalé le chargement de cette
même requête annulé (`Network.loadingFailed`, `net::ERR_ABORTED`, relu par `request.failure()` dans
`readResponseBody` du SDK), moins de 90 ms après les en-têtes. Sous Chromium, Playwright ne pose ce
texte d'échec que sur un `loadingFailed` du vrai chargement réseau : rien ne prouve qu'il ne s'agisse
que de la copie DevTools du corps, et aucun artefact CI ne montre que la page a reçu le corps. La
question reste ouverte. L'application n'annule rien : `handleResume`
(`src/components/estimates/GeneratedOuvrageDialog.tsx`) appelle l'action sans signal,
`fetchServerAction` de Next 16.4 n'utilise aucun `AbortController`, le client Flight
(`react-server-dom-webpack`) lit le flux jusqu'au bout sans jamais l'annuler ; la fermeture du dialogue
fait seulement ignorer le résultat. L'annulation n'a pas été reproduite (clone WSL, 18/10) : trois
exécutions de diagnostic (dont `taskset` sur 2 CPU avec 3 boucles actives, et la liste retenue 500 ms
pour reproduire le clic CI qui attendait 343 ms la liste) ont toutes reçu en page un 200
`text/x-component` dont le corps complet contient le brouillon, et la copie DevTools était lisible ;
deux expériences Playwright 1.64 autonomes (Échap pendant la retenue, document chargé ou en cours de
chargement ; GC forcé entre en-têtes et fin du corps) n'annulent rien. La cause de l'annulation sur le
runner reste donc inconnue.

**Correctif (parcours seul, assertions inchangées sur le fond).** Comme GR09 (insertion) et GO01
([reprise après réponse perdue](generated-ouvrage-recovery-e2e.md)), GR06 observe dans la page le
`fetch` de l'application pour la seule action exacte : POST vers le chemin de l'éditeur portant
l'identifiant `next-action` de `fetchResumableGeneratedOuvrageDraft` lu dans le manifeste du build.
Requête et réponse sont transmises inchangées ; le corps est lu jusqu'au bout sur un clone, dont seuls
la longueur et la présence du brouillon sont gardées. Le parcours exige une seule requête retenue par
la route et une seule livraison en page, au même corps que la requête retenue, statut 200,
`text/x-component`, corps lu en entier contenant l'identifiant du brouillon, sans erreur ; puis,
inchangés, le dialogue fermé après la livraison, aucune carte candidate, l'autre version, aucune
insertion et la reprise réelle ensuite. Une requête annulée fait rejeter le `fetch` ou la lecture du
clone : l'erreur est enregistrée et le parcours échoue. Ni retry ni pause : les attentes sont des
sondages d'un état observé (30 s, comme l'ancienne attente). La preuve `late-resume-delivery`
(horodatages, statut, longueur, erreur) est écrite avant les assertions, pour qu'un rouge en CI nomme
la cause vue par la page. GR05, rouge à la base et hors sélection, garde son attente par URL.
Si le runner annule vraiment la requête, ce correctif ne rendra pas GR06 vert : la lecture du clone sera
annulée elle aussi, et `late-resume-delivery` montrera l'erreur vue par la page. C'est alors un défaut du
navigateur ou de l'application à traiter comme tel, pas un parcours à assouplir.

**Preuve (clone WSL `~/miaouffrage-ci-proofs`, 18/10/2026).** Révision `9467ba95` plus ce seul fichier
(`diffSha256` `8bf160c9…1902`, fichier `db538d65…9120`), Node 24.19.0, port applicatif 3147, aucune
autre exécution native possédée au départ ; `npm run e2e:army:calc-v3 -- --phase resume` :

| Archive `.e2e/army/ci/` | Charge | Résultat | GR06 | Livraison observée |
|---|---|---|---|---|
| `2026-10-18T03-51-30-402Z-calc-v3` | aucune | 5/5 | 3,96 s | 200, `text/x-component`, 1 209 caractères, brouillon présent |
| `2026-10-18T03-53-05-632Z-calc-v3` | `taskset -c 0-3`, 4 boucles actives sur ces CPU | 5/5 | 7,55 s | idem |
| `2026-10-18T03-55-32-228Z-calc-v3` | `taskset -c 0-1`, 3 boucles actives sur ces CPU | 5/5 | 9,21 s | idem |

GR06 durait 4,27 s et 3,90 s sur le runner. Contre-épreuve (clone seul, non commitée) : la requête
retenue est avortée au lieu d'être relâchée (`--grep '^GR06\s'`, archive
`2026-10-18T03-59-07-185Z-calc-v3`) ; GR06 échoue sur `expected "TypeError: Failed to fetch" to be
null`. Windows : `npm run typecheck`, `npx eslint e2e/army/local/generated-ouvrage-resume.e2e.ts
--max-warnings=0` et `npx vitest run --project=node src/test/ci-guardrails.test.ts` (18/18) passent.

**Sur le runner.** Run 39096480257 (PR #42, tête `964775bc`, sélection `nightly`, 18/10 04:15–04:43 UTC) :
les six phases passent, dont `resume` (GR02, GR04, GR06, GR08). Cette tête précède la fusion de
`origin/main` `488382d5` (éditeur v3 de 2.6, PR #44) : seul le run calc-v3 de la PR sur la tête fusionnée
poussée vaut pour l'arbre fusionné. Si le runner annulait réellement la requête, et pas seulement la copie
DevTools, GR06 serait rouge avec l'erreur vue par la page dans `late-resume-delivery` : ce serait alors un
constat sur le navigateur ou l'application, plus une course du parcours.

## Limites

- La CI nocturne ne lance pas l'émission tant que le sous-lot 2.7 ne l'a pas passée en production
  (section « CI nocturne ») ; seul un déclenchement manuel (`all` ou `emission`) la lance.
- L'émission en `next dev` ne qualifie pas le build de production ; la sonde
  `check-offer-network-guard.mjs` de la recette d'offre n'est pas rejouée, seul le reçu
  `guard-installed` du serveur est exigé. Le garde refuse trois requêtes sortantes du serveur de
  développement (polices Google), sans effet sur les parcours.
- La sélection d'émission par défaut se limite à OF00–OF02, OF04 et OF0L.
- Les rouges à la base restent à corriger par le porteur (parcours ou contrat) : tant qu'ils le
  sont, la phase `resume` ne prouve que GR02, GR04, GR06 et GR08, et l'émission ne prouve pas la
  confidentialité du portail (OF03).
- La ligne de base repose sur une seule campagne complète verte et sur une machine ; GR05 montre que
  des courses du parcours peuvent dépendre de la charge.
- Les preuves métier des parcours critiques sont écrites par `recordEvidence` sous
  `.e2e/army/critical/artifacts/business` ; la campagne copie celles que chaque phase a créées ou
  modifiées, sans vider ce répertoire.
