# Reprise du lot 2 — passage sur Mac (16/10/2026)

Note de passation pour continuer le lot 2 sur une autre machine. Elle complète la
[conception validée](conception-lot2-moteur-v3.md) : la conception dit quoi faire, cette note dit où
l'on en est et comment reprendre. La mémoire de session de l'agent est restée sur le PC Windows :
tout ce qui sert à la reprise est ici.

## Où en est-on

| Élément | État | Où |
|---|---|---|
| Conception du lot 2 et arbitrages du porteur | Validés le 16/10, commités | `a75e4ca3`, [conception](conception-lot2-moteur-v3.md), registre `decision_porteur` |
| Lot 1 (sécurité) | Abandonné pour l'instant, archivé en patch | `3591f43e`, [lot1/](../lot1/LISEZ-MOI.md) |
| Build Next : limite mémoire sur toutes les plateformes | Poussé, CI verte | `f8229144`…`de54931d`, `scripts/next-build.mjs` |
| Sous-lot 2.3 — saisie et import | **Terminé, fusionné sur `main`** | `de54931d..3dbcff35`, [preuves](../../testing/estimate-input-import-2.3.md) |
| Sous-lot 2.0 — ligne de base et harnais de preuve | Presque terminé, **non fusionné** | branche `lot2/2.0-ligne-de-base` (`b26f5648`) |
| Sous-lots 2.1, 2.2, 2.4 à 2.10 | Non commencés | conception §14 |

### Sous-lot 2.0 : ce qui est prouvé, ce qui reste

Prouvé sur la pile Supabase native possédée (WSL, 16/10). Le message du commit `b26f5648` sous-estime
l'avancement : la campagne `calc-v3` a bien tourné (voir `docs/testing/tester-army-calc-v3.md` sur la
branche).

- Corpus figé : 300 devis v1 et 300 devis v2 (graine `20261016`), épinglés sur les moteurs actuels ;
  `src/lib/estimates/engine-frozen-corpus.test.ts` vert. Fixture de 2,7 Mo.
- Test de montée de version sur base peuplée : 0 différence en mode normal, la ligne altérée est
  détectée en contrôle négatif ; deux fois.
- Empreintes documentaires : `before.json` enregistré, reproduit à l'identique sur une seconde pile.
- Campagne `npm run e2e:army:calc-v3` : 6 phases, 33/33 (journeys 11, components 5, numeric 4,
  resume 5, access 2, emission 6), pgTAP 13 fichiers / 1 253 assertions PASS, matrice RLS passée,
  6 min 02 s. Valeurs de base consignées dans `docs/testing/tester-army-calc-v3.md`.
- Rouges à la base `98408ef0`, antérieurs au lot 2, documentés sans modifier leurs assertions :
  OF03 (sélecteur « P.U. HT » contre « PU HT » imprimé), GR01 (`operationKey` / `expectedUpdatedAt`
  exigés depuis `28ccc857`), GR03 (champ `status` ajouté à l'erreur), GR05 (course sur
  `waitForResponse`).

Reste à faire pour fusionner 2.0 :
1. régression finale : `npm run e2e:army:local` complet et comparaison Vitest test par test avec la
   référence (`npm test`) ;
2. `docs/testing/estimate-engine-v3-2.0.md` (ou compléter `tester-army-calc-v3.md`) : modes de
   défaillance couverts, commandes, valeurs de base, limites ;
3. une relecture, puis PR `lot2/2.0-ligne-de-base` → `main`, fusion quand la CI est verte.

### Sous-lot 2.3 : livré

21 commits, tests d'exigence et parcours écrits rouges d'abord (les commits intermédiaires sont donc
rouges volontairement ; `HEAD` est propre). Suite critique complète 68/68 (674 s), import OPTIMA dans
une v2 à marge 1,30 : 7 133 330 c HT (71 333,30 €, oracle de la conception), 3 320 tests Vitest verts,
aucune différence sur les fichiers moteur, aucune migration ; le corpus figé du 2.0 passe sur ce code.
Écarts restants, documentés dans `docs/testing/estimate-input-import-2.3.md` :
- les imports directs (DPGF liée, assistant) d'heures de ligne sans paramètres de classeur restent à
  0 €/h sans rôle, comme avant 2.3 ; la création rapide n'a pas de parcours (dialogue non monté) ;
- les refus de précision en grille et au collage affichent le message générique `NUMERIC_INPUT_ERROR` ;
- réimporter un export remet K FO, K MO et le rôle à zéro (ce ne sont pas des cibles de
  correspondance) ;
- le collage garde « Prix unitaire HT » comme PR FO (contrat des développeurs, parcours `numeric-entry`
  et `estimate-batch-client`), alors que l'import le traite en colonne de contrôle.

## Reprendre sur le Mac

Prérequis : macOS 14 ou plus récent sur puce Apple (M1 à M4), Node 24 (≥ 24.8, `.nvmrc`), pas de
WSL ni de Docker : le runtime natif de Supabase tourne directement (`src/test/local-supabase-ci.ts`).
Sur un Mac Intel, le runtime natif n'est pas pris en charge.

```bash
git fetch origin
git switch main && git pull --ff-only
npm ci
npm run db:ci:local
```

Attendu : 13 fichiers pgTAP, 1 253 assertions, PASS, matrice RLS passée. Puis, pour finir 2.0 :

```bash
git switch lot2/2.0-ligne-de-base
npm ci
npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts src/test/upgrade-check.test.ts src/test/ci-guardrails.test.ts
npm run db:upgrade-check -- lot2-2-0
npm run db:upgrade-check -- lot2-2-0-neg --negative-control
npm run engine:document-fingerprints -- check
npm run e2e:army:calc-v3
npm run e2e:army:local
```

`db:upgrade-check` doit finir à 0 différence ; avec `--negative-control`, il doit échouer en nommant
la ligne modifiée. `engine:document-fingerprints -- check` doit annoncer des empreintes identiques
(une autre version de Node ou d'ICU est signalée en avertissement). Pendant le développement, ne
lancer que les parcours concernés :

```bash
npm run e2e:army:local -- --grep "<motif>"
npm run e2e:army:calc-v3 -- --phase emission --grep '^OF00\s'
```

## Suite du lot 2

Méthode (accordée par le porteur le 16/10) : une branche et une PR par sous-lot vers `main`, la CI
GitHub (Quality Gate, TesterArmy Critical, matrice RLS) valide sur Linux, fusion quand elle est verte.
Pour chaque sous-lot : modes de défaillance, tests d'exigence et parcours TesterArmy écrits rouges
d'abord (AGENTS.md), parcours ciblés pendant le travail, suite complète à la validation.

1. Finir et fusionner 2.0 (ci-dessus).
2. Recaler 2.3 s'il n'est pas déjà fusionné ; le test du corpus figé arrive avec 2.0.
3. 2.2 (offre à 0 €, « ML » = mètre linéaire) et 2.1 (socle fermé par défaut). **Ils ajoutent une
   migration** : pousser sur `main` déploie sur Vercel, donc décider avec le porteur qui applique la
   migration sur la base Supabase partagée (runbook `supabase/README.md` §3) et à quel moment, avant
   de fusionner. Ne jamais appliquer une migration distante sans son accord.
4. 2.4 (moteur v3 pur et jumeau SQL), puis 2.5 à 2.8, 2.9 (unité d'achat), 2.10 (pilote).

## Points ouverts

- **Collision de verrou d'édition** : avec `E2E_ARMY_WORKERS=3`, deux exécutions sur deux ont échoué
  sur une vraie collision de verrou entre sessions simultanées (bug applicatif, pas du bruit). La
  valeur par défaut reste 1. Une fois corrigé, 3 parcours en parallèle font gagner environ 35 %
  (634 s → 410 s pour la suite critique).
- **Paquet de passation des développeurs** `docs/handoff-army-dev-2026-10-16*`, non suivi à la racine
  de la copie Windows : il fait échouer `npm run typecheck` en local (72 erreurs). À sortir du dépôt.
- **Parcours rouges à la base** (OF03, GR01, GR03, GR05) : à réaligner sur le code.
- Deux tâches lancées en parallèle le 16/10, dans des worktrees `.claude/worktrees/*` de la copie
  Windows : la course 40001 à la création de devis (commit local `36bb9a68`, non poussé) et les saisies
  perdues après une action groupée (encore ouverte). Vérifier leur état et recaler les branches du
  lot 2 dessus.
- **Disque C: du PC Windows plein à 97–99 %** : WSL a planté pendant le 2.3. Supprimer les worktrees
  et clones WSL devenus inutiles (environ 1 Go chacun) avant de reprendre sur le PC.
- Désignations attendues pour Q01, Q04, Q08 et Q09 du registre ; avis de l'expert-comptable sur
  P-06 et P-07 avant tout usage client réel.

## Rétro du 16/10

Ce qui a ralenti :
- **WSL bridé** : la machine a 62 Go et 32 cœurs, mais `.wslconfig` limitait WSL à 12 Go et 8 cœurs.
  Conséquences : une seule pile Supabase native à la fois, donc les chantiers parallèles faisaient la
  queue, et la vérification TypeScript de `next build` plantait faute de mémoire.
- **Ce plantage**, diagnostiqué en profondeur avant d'être corrigé (une vingtaine de minutes et deux
  exécutions perdues).
- **Des workflows trop lourds** : une mise en place par chantier (copie de 1,2 Go de `node_modules`,
  nouveau clone WSL), deux relecteurs systématiques, plusieurs suites E2E complètes par sous-lot.
- **Des commandes refusées** (suppression de fichiers) à contourner autrement.

Ce qui a marché :
- tests et parcours rouges d'abord, preuves archivées, relectures contradictoires : aucune régression
  introduite, et plusieurs défauts réels trouvés (limite mémoire, collision de verrou, parcours
  périmés) ;
- les worktrees ont évité toute collision avec le travail des développeurs ;
- le correctif mémoire, rendu pérenne et protégé par un garde-fou CI, sert à toute l'équipe.

Ce qu'on change :
- sur Mac, Supabase natif sans WSL ; sur PC, relever `.wslconfig` (32 Go, 24 cœurs) ;
- parcours ciblés (`--grep`) pendant le travail, une seule suite complète à la validation ;
- les suites complètes passent par la CI GitHub sur la PR, en parallèle du travail local ;
- workflows allégés : environnement réutilisé, un seul relecteur, pas de relecture pour la
  documentation seule ;
- corriger la collision de verrou pour passer à 3 parcours en parallèle.
