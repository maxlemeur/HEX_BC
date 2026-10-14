# Paramétrage atomique du devis — qualification locale du 14 octobre 2026

Cette tranche qualifie sept parcours métier locaux, pas l'application complète. Le build final `qcTohC12RReBayj2t7ZHG` est épinglé par [son manifeste](C:/Users/maxim/Projects/miaouffrage/.e2e/army/recipes/builds/2026-10-14T09-22-47-566Z-886dcfb3/manifest.json), SHA-256 `710d80bfcbe133413be92bb6c578b3725d023746a98153f99ced3c66e62db10f`. API `http://127.0.0.1:45585`, PostgreSQL `127.0.0.1:33485`, compte local ordinaire ; aucune activation distante.

## Problème et correction

La sauvegarde pouvait modifier le paramétrage et le pied du devis, puis envoyer un second bulk pour les lignes. Un échec intermédiaire pouvait laisser ces données incohérentes. La file de mutations perdait aussi la révision acquittée. Après un batch réellement committé, une confirmation GET perdue pouvait remettre la quantité envoyée dans le tampon, puis répéter le batch ou émettre un bulk vide. La récupération depuis le dialogue pouvait perdre un titre local. Enfin, un ancien arrondi supérieur était réappliqué en autoliquidation.

Tous les PATCH du devis, y compris un titre seul, passent désormais par `save_estimate_settings_atomic` : paramétrage, projection de toutes les lignes et quatre montants du pied sont écrits dans la même transaction. Elle contrôle le timestamp et la révision d'origine, le bail de la page, l'acteur/tenant et les dépendances du calcul. Le client reprend `{version, items}` sans second bulk. Les snapshots de publication ne sont pas artificiellement rafraîchis.

La récupération relit réellement le devis avant de débloquer l'éditeur. Elle retire seulement le travail déjà acquitté, conserve une intention locale différente et permet la vérification dans le dialogue. Une sauvegarde forcée sans modification ne crée plus de mutation. En autoliquidation V2, HT et TTC restent égaux, taxe et ajustement sont nuls, même si le réglage historique `up/5000` est conservé.

## Sept parcours finaux

**14 PASS = 7 logins + 7 parcours métier**, chacun exécuté une fois, sans retry ni trace authentifiée. Les sources restent identiques avant/après chaque run ; les deux familles de recettes ont des listes d'entrées E2E différentes mais partagent le même build applicatif.

| Parcours | Assertions exécutées | Archive finale |
| --- | --- | --- |
| SAT1004 | 1 004 lignes ; six étapes marge, remise représentable de 10 %, arrondi inférieur, cycle principal/sous-traitant et restauration ; un PATCH et zéro bulk par étape ; toutes les cellules, sources et reloads | [09:29:30](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-29-30-395Z-e4f3824a-2965-4f4e-acd6-5d5ed280702c/public/manifest.json) |
| SAT2004 | Même parcours sur 2 004 lignes ; pagination de 500 complète, sources et montants exacts | [09:30:28](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-30-28-886Z-b8623b11-7c01-40f8-965c-a4e81362a71c/public/manifest.json) |
| SATEDIT | Quantité réelle 1,25 → 2,5 acquittée ; marge ×2 sans reload intermédiaire ; PATCH avec le couple timestamp/révision acquitté ; pied `3994000/798800/4792800/0` cents | [09:32:14](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-32-14-635Z-cd0f21aa-3d41-4cac-9037-ccf17cd0e841/public/manifest.json) |
| SATACK | Un batch original 200/committé, premier GET de confirmation volontairement perdu, récupération réelle ; quantité 2,5 ; aucun replay ni bulk vide après sauvegarde forcée ; clock/révision/items stables au reload | [09:27:36](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-27-36-844Z-3e0334dc-5a85-4c96-9a07-f7b2fe4b7587/public/manifest.json) |
| SATDRAW | Titre saisi pendant la rétention de l'ACK original, conservé après récupération dans le dialogue ; ancien titre serveur jusqu'au PATCH humain ; exactement batch + PATCH ; pied `1997000/399400/2396400/0` cents et reload | [09:26:22](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-26-22-483Z-e94e0e52-06a2-4b61-94ba-5c7e5d16fd8a/public/manifest.json) |
| SATNEXT | Nouvelle quantité 3,75 saisie pendant l'ACK de 2,5 ; intention conservée lors de la récupération ; deux batches distincts, une fois chacun ; pied `1998550/399710/2398260/0` cents ; reload | [09:27:02](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-27-02-435Z-89383703-edd0-483c-82cd-76111b68cd99/public/manifest.json) |
| SATUP | Préparation authentifiée de l'ancien `up/5000`, puis changement de régime dans la vraie UI ; réglage conservé, HT=TTC=`1995450`, taxe=ajustement=0 ; toutes les lignes et sources conservées au reload | [09:28:08](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/2026-10-14T09-28-08-974Z-5b6a4fe0-33f1-4d50-aa16-a4f4b3e283b1/public/manifest.json) |

Les défaillances et assertions ont été écrites avant correction. SATNEXT était déjà PASS avant le pruning, avec le même SHA de test : c'est une protection de la nouvelle intention, pas un RED réinventé. Les RED métier, les erreurs de préparation et les résultats des anciens builds restent conservés séparément.

La [synthèse indépendante](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-red-archive-review-20261014-01/seven-final-green-summary.json), SHA-256 `2d752d8c0f887fb33e3bdf5ffdfa04f0db041c21fb5f11c67d554dde3ef4a4cb`, référence les rapports, témoins et audits ciblés. Ceux-ci vérifient 334 artifacts prioritaires ; ils ne prétendent pas avoir rehashé toutes les copies répétées du dépôt.

## SQL installé et concurrence

La [migration](C:/Users/maxim/Projects/miaouffrage/supabase/migrations/20261014070453_estimate_settings_atomic.sql) a été appliquée uniquement à la base locale, avec [contrôle de conservation](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-atomic-sql-20261014-01/application-02/receipt.json). Le [reçu installé](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-atomic-sql-20261014-01/installed-01/receipt.json) confirme **70/70 cas SQL séquentiels**, en rollback, catalogue et lignes contrôlées conservés. Cette preuve n'exécute pas le moteur TypeScript ni l'UI.

Le [closeout de concurrence](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-atomic-sql-20261014-01/concurrency-closeout.json) confirme **15/15 courses réelles**, neuf gardes acteur/calcul et six verrous inverses : 30 clients SQL observés, tous terminaux avec exit 0. Le catalogue et les lignes des onze tables contrôlées sont conservés. Le [reçu SQL](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-atomic-sql-20261014-01/concurrency-01/receipt.json) et le [reçu opérateur](C:/Users/maxim/Projects/miaouffrage/.e2e/army/offer/runs/settings-races-only-20261014-02/receipt.json) fixent commandes, sources et fixture SATEDIT `3221846a-e17a-47cc-a4f1-cf95fa67a25c`. Le bail a été obtenu par HTTP 201 ordinaire, sans force takeover, seed SQL, mutation Auth ou redémarrage natif. Les 70 cas n'ont pas été rejoués dans cette fenêtre de concurrence. Les courses sur absence de configuration et rôle MO référencé ne sont pas qualifiées.

## Reproduction et limites

Depuis la racine du checkout, avec Node 24 et les profils locaux privés explicites, préparer un **nouveau** build via `scripts/tester-army/build-local.mjs --execute`, puis renseigner son manifeste/SHA et `E2E_OFFER_SERVER_MODE=production`. Exécuter `run-v2.mjs --execute <cas>` dans le packet [financier](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-atomic-army-20261014-01/run-v2.mjs) ou [followup](C:/Users/maxim/Projects/miaouffrage/.e2e/offer-emission/settings-followup-army-20261014-01/run-v2.mjs). `--list` est une collecte, jamais une preuve métier. Les commandes exactes et résultats sont archivés dans chaque manifeste ; aucun secret ne doit être imprimé.

Pour les courses, reprendre la commande et les préconditions du reçu opérateur sur une nouvelle fixture UI admise, bail courant et fenêtre SQL exclusive ; ne pas rejouer aveuglément un ancien UUID/bail ni réparer la pile automatiquement. Cette documentation ajoutée après qualification ne fait pas rétroactivement partie des sources du build daté.

Réserves ouvertes : remise exacte **1,01 €** encore RED (arrondie à 2,00 € dans la preuve initiale) ; V1 et autres modes historiques non qualifiés par ces UI ; anciens contrats/mocks PATCH et échecs ouvrages datés à traiter séparément, aucune déclaration de Vitest global vert. Les copies de `postcss.config.mjs` et des deux fichiers `tools/next-eslint-root-glob` manquent dans ces archives, malgré leurs empreintes contrôlées à l'admission du build : limite datée conservée jusqu'aux nouvelles recettes corrigées.

Ces résultats ne qualifient ni publication de snapshots/offres, PDF/exports, concurrence générale, corpus métier, performance terrain, sauvegarde/restauration, exploitation ni mise en service. Le goal complet demeure non atteint.
