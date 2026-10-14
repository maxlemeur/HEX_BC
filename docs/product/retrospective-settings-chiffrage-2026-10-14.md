# Rétro des réglages et de la recette — 14 octobre 2026

La tranche de réglages est qualifiée localement : sept parcours métier sur `qcTohC12RReBayj2t7ZHG`, 70 cas SQL installés et 15 courses réelles. [Le détail](../testing/estimate-settings-atomic-2026-10-14.md) conserve les échecs, les preuves et les limites. Cette rétro porte sur l'environnement de travail et de validation de la session.

## Corrections appliquées

| Priorité | Défaut constaté | Correction et vérification |
| --- | --- | --- |
| P1 | Trois fichiers utilisés par le build n'avaient aucune copie dans les archives de recette. | Les trois runners réutilisent l'inventaire `buildSourceEvidence`. Chaque nouvelle archive contrôlée contient les 1 681 entrées présentes du build, avec SHA-256 identique. Les archives historiques restent inchangées et conservent leur réserve. |
| P1 | La santé Auth était vérifiée après la copie de toutes les sources. | Santé et garde existant précèdent copies, collecteur et SDK en mode exécution. Une réponse Auth 503 injectée uniquement dans le runner confirme l'échec avant ces opérations. Le build autonome et la collecte restent hors réseau. |
| P2 | Le processus échouait à 1 alors que le manifeste gardait un code null. | Le catch des trois runners enregistre 1, ou 130 après interruption. La seconde injection Auth confirme le code 1 dans le manifeste. |
| P2 | Deux brouillons d'oracle inutilisés ajoutaient 17 598 278 octets par recette financière. | Les packets copient leurs dépendances finales explicites et leur précode. Les brouillons restent sur disque et dans les anciennes archives ; aucune copie dans les nouvelles recettes. Aucun gain de temps n'est extrapolé de ces octets évités. |
| P2 | Un contrôle CCTP positif ne fournissait plus les OID requis par le garde actuel. | OID synthétiques déterministes et uniques dans la fixture, garde de production et assertions conservés. Le contrôle existant passe 11/11 ; la chaîne complète `check:army-recipes` passe 60/60 hors réseau. |

Les collisions de noms de témoins, le bail d'une ancienne page et la comparaison entre réponse RPC brute et GET enrichi avaient déjà été corrigés pendant cette tranche et éprouvés dans les parcours finaux. L'injection de transport retient seulement le premier ACK ; elle conserve les écritures suivantes et permet de vérifier les deux intentions distinctes 2,5 puis 3,75.

## Preuves de la rétro

Précode, préimages et reçus : `.e2e/offer-emission/settings-retro-20261014-01/`. `archive-before.json` constate les trois absences et les deux brouillons avant correction. `archive-main-after.json`, `archive-followup-after.json` et `archive-generic-after.json` vérifient toutes les entrées du nouveau build ; `auth-preflight-final.json` constate le refus précoce. `cctp-fixture-precode.json` et `cctp-fixture-maintenance-result.json` relient le contrôle rouge à sa correction sans modifier le garde.

Build final `sIZ7nOQ8chXqN9XTjCCTz`, manifeste `.e2e/army/recipes/builds/2026-10-14T09-56-11-802Z-edadf7fd/manifest.json`, SHA `11825811fce7e9dbca633a7f5a27a863f3af9e1d7e70a7b860e482e4a11522b8`. SATDRAW et SATEDIT sont rejoués sans retry ni trace : **deux parcours métier et deux logins passent**, sources stables et collecteur vide. OF00 est seulement collecté avec `--list`, sans preuve métier. Syntaxe, lint ciblé, compilation, OpenAPI, budgets et diff-check passent. Les premiers échecs sandbox Windows et le contrôle CCTP rouge sont conservés ; les mêmes vérifications ont été relancées sans affaiblissement.

La CI possède déjà lint/typecheck/tests et les artefacts E2E ; aucune nouvelle règle AGENTS ou chaîne CI n'a été ajoutée. Les contrôles de cette rétro restent distincts d'une CI exécutée.

## Suite et limite du goal

La remise fixe de 1,01 € reste un défaut connu à corriger avant livraison, puis viennent la qualification CCTP A/B et les parcours complets offre/chantier/retour d'expérience. Les anciens tests aux contrats dépassés ne sont pas déclarés verts. Corpus métier, performance terrain, exploitation et mise en service restent à qualifier.

[Le goal candidat](goal-chiffrage-candidate-2026-10-14.md) fixe un résultat atteignable : application complète qualifiée localement et dossier de recette permettant une décision métier. Le goal actuel reste actif et inachevé tant que son transfert n'est pas autorisé. Ce document est ajouté après les recettes ; les builds et résultats restent datés. Aucune publication ni mutation distante.
