# Conservation des préparations échouées

## Défaillances définies avant le correctif

Deux invocations réelles du 12 octobre 2026, à `18:42:02.427Z` et `18:43:01.129Z`, ont échoué avant tout test et toute authentification : installation Chromium refusée par DNS, puis serveur inaccessible depuis le sandbox. Le SDK n'a pas écrit de rapport frais. Le wrapper a écrit son manifeste transitoire, mais sa branche d'archivage exigeait `manifest.report` ; l'invocation suivante a remplacé ce manifeste. Les observations postérieures et les fichiers réellement conservés sont dans `.e2e/estimate-generated-atomic/batch-compatibility/retro-20261012-02/setup-observations.json`. Ce diagnostic ne remplace pas les manifestes perdus.

| Défaillance | Observation exigée dans le harnais |
| --- | --- |
| Rapport absent après un processus enfant réellement échoué | Manifeste daté d'échec conservé, code non nul, aucun rapport ni résultat fabriqué ; la deuxième invocation ne le remplace pas |
| Rapport et artifacts d'une invocation précédente, y compris un rapport de moins d'une seconde | Aucun de ces octets dans l'archive de préparation ; aucun résultat passé ni authentification déduit de l'ancien rapport ; comparaison des octets avant/après l'enfant, avant sanitizer |
| stdout, stderr ou log avec identifiants, password, bearer, JWT, paramètre ou champ token | Données expurgées dans les preuves retenues et erreurs de manifeste |
| Log cumulé avant l'invocation | Seulement l'ajout dont le préfixe initial a été vérifié pendant l'intervalle observé ; aucune ancienne ligne présentée comme nouvelle ni attribution exclusive des requêtes au processus |
| Log, réseau ou inputs absents, tronqués ou remplacés | Absence explicite ; le manifeste d'échec reste conservé sans inventer des fichiers |
| Archive datée déjà existante | Refus explicite sans remplacer un octet de l'archive existante |
| Source ou destination hors workspace, lien symbolique ou junction | Aucune lecture/copie/écriture hors du périmètre ; omission/refus explicite, sans suivre le lien |
| Exécution avec un rapport frais valide | Contrat actuel des archives réussies préservé : nom daté, rapport, artifacts et empreintes existants |

La régression isolée est nécessaire : le navigateur ne démarre justement pas et ne peut pas vérifier la conservation de son propre échec. `scripts/tester-army/check-setup-archive.mjs` copie le **vrai wrapper** dans un dépôt minimal jetable, lance de vrais processus Node et Git, et compare les octets présents avant/après. Seul le CLI enfant est un producteur déterministe de fichiers et de codes d'échec, sans navigateur, Supabase ou appel réseau. Il ne prouve aucun parcours métier. Les copies, commandes et sorties du harnais restent sous `.e2e/retro-runtime/setup-archive-checks/`.

La solution conserve les échecs sans rapport frais sous `runs/<date>-setup-failed/manifest.json`, avec `evidence_unavailable`. Elle retient uniquement les sorties propres à l'invocation, l'ajout vérifiable du log, le réseau nommé pour cette invocation et les inputs disponibles. Elle exclut les anciens `report.json` et `artifacts/`. Les chemins sont confinés et les destinations exclusives. L'absence de rapport signifie **résultats inconnus**, pas zéro tests exécutés : seule la sortie réelle du SDK peut établir qu'une préparation s'est arrêtée avant Auth. Les nouvelles preuves ne qualifient pas cet échec en réussite.

## Régression reproductible

```powershell
node scripts/tester-army/check-setup-archive.mjs
```

Le résultat RED doit être exécuté avant le correctif, puis le même harnais doit produire GREEN. Les reçus et empreintes distinguent les sources réellement utilisées. Aucun nettoyage automatique ne supprime les échecs ou les copies de harnais.

## Résultats du 12 octobre 2026

- RED original exécuté **avant** modification : `6edb9417-28aa-4360-8829-e4f41eda0fa6/receipt.json`, SHA `e6e0240654517e70c713d138d99728a07eaff48535978ef7fa8071d6aaaa414f` : huit échecs, un succès du contrat de rapport frais.
- Relecture de la préimage conservée avec l'erreur synthétique explicitement porteuse du password et les empreintes des fichiers copiés : `1c4c2b46-d0f9-42cd-8d26-2de72f80b9aa/receipt.json`, SHA `511db915d98e2d2e0e460f54231c9865279d2d416c16f48a289aa23b47477c3b` : mêmes huit échecs. `--preimage` est une option du harnais, jamais du runner produit.
- Le contrôle des inputs imbriqués a exposé une omission du premier correctif : `66d12242-8e92-4c76-a36c-a5730c17cc82/receipt.json`, SHA `9e1cb60cf9a11319420b3d7cb5536559fe32f0a4074a3df849cc52c1285903f3` : huit succès, un échec. La création des parents confinés a été corrigée ensuite.
- GREEN intermédiaire : `9957309a-3d19-4f3b-95fa-959d8fb86cf0/receipt.json`, SHA `c69ba39e0d79746a34932a92b2d05b86cb4f5e0966b26c82f7bda83d79b10650` : neuf cas réussis, y compris les junctions Windows réelles.
- La revue indépendante a ensuite exposé la modification d'un ancien préfixe secret par le sanitizer **avant** la capture du delta : `37cdc464-7788-495d-ad0c-d622380f07e3/receipt.json`, SHA `fa4974bb621a01004221ceefefa8676ea320641e7f252e5e550299b99d64d0b5` : huit succès, un échec reproduit avant correction. La capture a été déplacée juste après la fermeture du processus enfant et avant tout sanitizer.
- La revue a aussi exposé un UUID de session dans un JSON imbriqué : `dd20cbfb-51b2-4e0e-8c74-9ad2c4acdbf6/receipt.json`, SHA `937c73e9a69ac2278014446c0d84a1c8693fe1b283ae252673ac7b8dd45cac5f` : huit succès, un échec reproduit avant correction. Le motif d'expurgation reconnaît maintenant les guillemets échappés.
- GREEN après revue privacy : `024e3d2f-c12f-4d35-b59d-aff85239c71b/receipt.json`, SHA `1caa9b443b378f20062309609a735ac0a2aa409c7166c262d8c95ded1c6cc80a` : neuf cas réussis. Le premier cas exerce aussi 11,7 Mo de stdout réel, son archive bornée à 8 MiB, la fin de ligne et l'expurgation du JSON imbriqué. Le wrapper cesse d'ajouter des chunks dès le plafond.
- L'auto-revue a enfin exposé un ancien rapport complet de moins d'une seconde accepté dans la tolérance de fraîcheur : `2427d895-6e57-42bc-bd30-f572d4cb82d1/receipt.json`, SHA `31ce13d15f25489bc1c23865df02e4b04206f1301c4f842e048ced9609bd05a2` : huit succès, un échec réel avant correction. Les empreintes brutes avant et après l'enfant sont désormais comparées **avant** sanitizer : un rapport inchangé ne devient jamais une nouvelle preuve.
- GREEN final : `9ad73193-fce2-4745-8c85-11c33be35c97/receipt.json`, SHA `58f794e0d7542d259bd55711808647b3cae524d4fed5c141a5afdb7c24e1f1d1` : **neuf cas réussis**, incluant le rapport récent, la grande sortie, l'erreur avec password et la session imbriquée. Tous ces chemins sont sous `.e2e/retro-runtime/setup-archive-checks/`.

ESLint des trois scripts, syntaxe Node et `git diff --check` du runner passent. Les junctions nécessitent l'exécution autorisée hors sandbox ; le premier RED en sandbox garde son `EPERM` comme limitation distincte.

Les sorties retenues sont bornées à 8 MiB au total ; une coupure est déclarée et la dernière ligne incomplète est omise. Un log remplacé, sans ajout ou non lisible est déclaré indisponible. Les inputs binaires contenant des octets NUL sont omis ; cette archive diagnostique n'est pas une nouvelle qualification de leurs preuves historiques. Un crash du wrapper avant l'archivage final ou une destination devenue inaccessible peut encore empêcher cette conservation : le wrapper conserve alors un refus explicite quand il peut écrire son manifeste transitoire. Il n'existe pas de mécanisme de restauration des deux anciens manifestes perdus.
