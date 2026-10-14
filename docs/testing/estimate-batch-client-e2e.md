# Batch client : scénarios définis avant correction

12 octobre 2026. Complément aux contrats [workflow atomique](estimate-workflow-atomicity.md)
et `.e2e/estimate-create-atomic/workflow-candidate/batch-client-plan.md`.
La baseline WFC01 existe : le premier GET après `committed:false` garde A2/B2
et le pied7/0/7 au lieu d'A2/B3 et5/0/5. La matrice ci-dessous précède le code ;
les résultats exécutés et leurs limites sont conservés à la fin du document.

Revue avant qualification : BC01 retient la vraie réponse q3 déjà commise,
puis saisit q4 pendant l'envoi avant de perdre la réponse. Après reload et
reprise, le serveur reste à q3 et la saisie q4 doit rester non sauvegardée ;
le CtrlS suivant l'enregistre sans la retaper. BC02 ajoute un GET de reçu
HTTP200 JSON malformé via « Vérifier le résultat » : erreur de lecture
visible, aucune annonce d'absence et aucun POST, intention conservée.
La revue a aussi relevé une garde de génération/busy lors d'un changement de
route, corrigée côté produit ; cette frontière de route n'est pas présentée
comme exécutée par ces quatre cas.

## Préconditions et frontières

Réemployer le runner et le profil `batch-atomic`, l'acteur ARMY CORE-08 et la
pile locale explicitement identifiée par son profil. Chaque test crée un
nouveau projet V2 via l'API ordinaire ; aucune ligne finale n'est semée.
Marge1, coefficient1, TVA20%, sans remise/arrondi sauf WFC01. Attendre le
verrou réellement acquis par l'éditeur (champ quantité activé), puis saisir
et utiliser le vrai CtrlS. Aucune invocation de fonction client interne.

| Cas | Geste et faute | Oracle obligatoire |
| --- | --- | --- |
| BC01 sauvegarde et reprise | Ligne q2/PU1000ct ; saisir q3 puis CtrlS. Laisser la vraie réponse batch terminer, archiver son JSON sûr puis la perdre. Reload réel ; attendre et compter les requêtes. Cliquer « Reprendre cette opération ». | Avant3000/600/3600 persistés, l'UI ne dit pas Sauvegardé après perte. Aucun POST automatique au reload ; la reprise garde exactement clé, If-Match et corps originaux. Même reçu et IDs, aucune double création, état courant relu. Zéro second bulk du pied après le batch. Une nouvelle saisie q4/CtrlS donne4000/800/4800. Un replay HTTP ancien exact garde cet état récent ; même clé/corps modifié donne409 et ne change rien. |
| BC02 réponse réussie illisible | Sur une sœur, même vraie sauvegarde ; remplacer uniquement la réponse terminée par JSON malformé. | État « résultat à vérifier », pas succès fabriqué ; reload sans POST, reprise explicite exacte, pied3000/600/3600, aucun doublon. La panne concerne le transport client, pas une réponse native malformée émise par le serveur. |
| BC03 suppression/Annuler ventilée | Activer le flag de ventilation sur le tenant de fixture par API normale. Créer une ligne q2/PU1000ct, atelier1h×4000×1,25, chantier2h×4000×0,75, majoration1,1, deux rôles réels (le rôle actif peut être identique). Menu de ligne Supprimer, confirmer, puis « Annuler la dernière action ». | Le vrai POST client recrée les six champs de ventilation et la majoration. Nouveau UUID autorisé ; hiérarchie, désignation, q/prix, rôles, champs et valeurs financières antérieures doivent persister après reload. Le corps émis est capturé, pas remplacé par un fetch écrit par le test. Un second témoin sans majoration explicite conserve le défaut1. |
| BC04 collage partiel | Faire passer 101 lignes TSV par l'événement de collage du DOM et le vrai dialogue d'aperçu. Premier chunk de100 réel ; altérer uniquement le parent du second chunk vers un UUID inexistant avant son envoi au vrai serveur. | Premier chunk commis, second refus réel explicite.100 lignes à q1/PU100ct restent, total10000/2000/12000 ; compteur/message des lignes conservées ; zéro DELETE de compensation, aucun succès de101lignes. Reload et API confirment les mêmes IDs. La faute est une demande altérée contrôlée, pas une panne serveur spontanée. |

Le collage utilise un `ClipboardEvent` avec `DataTransfer` sur la grille,
pas un appel direct au contrôleur, ni une simulation du résultat financier.
Cette entrée DOM synthétique ne prouve pas l'intégration du presse-papier du
système d'exploitation. Le SDK installé ne permet pas de modifier le corps
via `route.continue` ; l'intercepteur de transport utilise le vrai `fetch`
original, avec la seule faute explicitement décrite. Il n'inspecte ni cookies
ni en-têtes d'authentification/bail. Le CAS métier If-Match et l'operation_key
ne sont pas des secrets de session ; seuls ces champs et les corps métier
sont archivés. La réponse perdue est injectée après lecture complète de la
vraie réponse, et les mesures précèdent les assertions UI.

## Résultats et limites à conserver

Auth + WFC01 + BC01–04 donnent six résultats attendus, sans filtre ni skip.
Le profil, la collecte et le lecteur doivent nommer ces résultats exactement.
La baseline WFC01 à deux résultats reste liée à ses propres entrées gelées.
Les montants, champs, identités, requêtes, état après reload et artefacts
téléchargés sont des preuves distinctes des libellés de statut.

Les changements d'acteur/tenant, stockage inaccessible, remise en queue
concurrente et perte de bail réclament des scénarios supplémentaires ; ils
ne sont pas qualifiés par ces quatre parcours. Aucun rollback natif, course
concurrente, undo global ou collage entier atomique n'est déduit. Les
preuves natives restent détenues par leur campagne indépendante.

Le scénario est écrit dans `e2e/army/local/estimate-batch-client.e2e.ts` et
la collecte statique du 12 octobre sélectionne les six titres attendus.
Le lecteur `scripts/tester-army/qualify-estimate-batch.mjs <run-exact>` est
préparé avant exécution : archive exacte complète, identités/profil/build,
entrées source actuelles, SHA, six résultats sans exclusions, corps/reçus,
oracles et relecture des deux XLSX WFC01, puis scan de confidentialité.
Il conserve un nouveau reçu non écrasable sous
`.e2e/army/coverage/batch-qualifications/`. Aucun succès métier n'est inféré
de sa syntaxe ou de la seule collecte.

## Première campagne complète, 12 octobre à 03:45 UTC

Archive `runs/2026-10-12T03-45-11-247Z`, build
`iRGDmEz1b31klNh0n4nKe` : six cas sélectionnés et exécutés, **5 PASS / 1 FAIL**,
zéro skip, flaky ou appel modèle, deux exports réels ; sources et build stables.
Auth, WFC01 et BC01–03 passent. Ce résultat n'est pas une qualification globale.

BC04 atteint les deux réponses réelles : 100 créations commises, puis le refus
`BAD_REQUEST` du parent absent pour la 101e. Le premier GET conserve exactement
100 lignes et le pied à 10 000 / 2 000 / 12 000 ct, sans DELETE. L'échec porte sur l'annonce
du collage partiel : la capture ne contient pas le compteur attendu. Elle
affiche au contraire « Les totaux n'ont pas pu être sauvegardés » et le statut
« En attente ». Le reload final du parcours n'est pas atteint.

La lecture du code de ce build explique deux frontières distinctes : le reload
global efface `actionError` via `clearConflictState`, après l'annonce partielle ;
l'observateur structurel marque aussi les totaux en attente alors que le batch
les a déjà finalisés. Aucun montant attendu n'est abaissé et le message générique
ne remplace pas l'oracle du nombre de lignes conservées.

Avant le correctif suivant, BC04 exige également le champ éditable et le statut
« Sauvegardé »/« À jour », l'absence d'alerte de totaux non synchronisés, puis
une fenêtre observée de trois secondes sans nouvelle écriture/bulk/DELETE.
Le message des 100 lignes doit rester visible, les données identiques, puis le
vrai reload et les mêmes assertions financières terminent le parcours. Cette
fenêtre ne constitue pas une promesse temporelle universelle d'absence d'autosave.

## Qualification des six parcours, 12 octobre à 03:52 UTC

L'archive `.e2e/army/coverage/runs/2026-10-12T03-52-42-188Z` termine **6/6 PASS**,
sans filtre, skip, flaky ni appel modèle. Le build Windows
`MdP3QBbnhpGf_EkWetS3p` et les sources sont restés stables. Les deux exports
WFC01 ont été téléchargés puis leurs octets relus avec ExcelJS. BC04 conserve
l'annonce des 100 lignes et un état à jour pendant la fenêtre observée, sans
bulk de réparation ni DELETE ; reload, identités et pied à 10 000 / 2 000 / 12 000 ct passent.

Le lecteur exécuté sur cette seule archive produit **2 640 contrôles / 0 échec**
et vérifie 157 fichiers texte sans secret configuré ni JWT. Reçu :
`.e2e/army/coverage/batch-qualifications/2026-10-12T03-52-42-188Z-e5f0a2e1/qualification.json`,
SHA256 `015a1622de023319b7ebb26593b1ca69234dbfae5443a04e284d162278808c15`.
Manifeste du run :
`004dd39cb287ae28e0ab4e13e7bba458a73840622d737386d7080806d17a6fe0`.

La chaîne archive séparément CORE-08 qualifié, l'installation batch réconciliée
en lecture après son commit, et le transport batch installé. L'ancien reçu
`requested` n'est pas réécrit ni présenté comme un succès ; sa copie et les
preuves avant/après sont conservées. Le transport archivé pour cette campagne porte
`pgTapPassed:false`. Ces six parcours ne qualifient donc pas une nouvelle suite
pgTAP, les courses natives, les changements de compte/rôle/tenant, le stockage
indisponible, le presse-papier système ou une production distante. CORE-06
reste distinct. Les éditions de documentation et le retrait de mocks obsolètes
après ce reçu ne modifient ni le run ni ses entrées archivées.

Après qualification, le retrait ciblé conserve **46 des 48 tests sync/paste**,
sans nouveau cas. Les deux cas supprimés exigeaient respectivement une panne
du second commit de pied désormais supprimé et 100 DELETE de compensation.
BC01/02 et BC04 les remplacent par les parcours réels ci-dessus. Le cas de
sauvegarde réussie conserve ses assertions sur navigation, buffers, historique
et stockage local ; seules ses attentes de forwarding, second bulk et ancien
token sont retirées. Les quatre listes statiques `Object.keys` sont retirées,
ainsi que le mock `reportError(null)` du nettoyage de conflit ; l'état
`conflict === null` et le comportement autosave restent vérifiés.

Les huit fichiers retenus passent **122/122**, avec lint ciblé et diff-check
sans erreur. Les 1 540 entrées source du build hors des deux fichiers de tests
modifiés ont les mêmes SHA ; l'index Git original est inchangé. Ledger détaillé :
`.e2e/estimate-create-atomic/retained-sync-paste-pruning/ledger.json`, SHA256
`7294f0e5fbe676abf8fb0cb687fd976188cc503c725b6a9e23475f6eeb232ba9`.

## Compatibilité avec la récupération des ouvrages, 12 octobre à 18:46 UTC

Après la réévaluation du buffer dans la branche ouvrages de
`useEstimateBatchRecovery`, les six résultats Auth/WFC01/BC01–04 sont rejoués
sur le build `1d0jBvzf6x29IoHQUi4Ey` et passent tous, avec deux exports XLSX
relus, sans filtre, skip, retry, flaky, modèle ou trace authentifiée.
Le profil neuf `batch-compatibility/retro-20261012-02/profile.json` conserve
la chaîne historique et remplace seulement le manifeste de build et son SHA.
Sources et build restent stables ; aucune nouvelle preuve pgTAP ou de course
n'est déduite de cette campagne.
L'invocation batch a utilisé l'ancien index de lecture alternatif. La
vérification canonique ultérieure confirme les mêmes entrées indexées, un
staging vide et exactement le même diff HEAD, sans modification de ces index.

Archive `.e2e/army/coverage/runs/2026-10-12T18-46-32-879Z`, manifeste SHA
`edf14aa43a122e414947087d461dee980e3910cd863b771438d001620e917919`.
Qualification indépendante :
`.e2e/army/coverage/batch-qualifications/2026-10-12T18-46-32-879Z-828405a5/qualification.json`,
SHA `6604a5e7b544980e49d3478189c15e3f71ee58382972aa0f1f2c8b348bbe6f2b`,
3 126 contrôles réussis et 196 fichiers texte examinés.

Deux invocations précédentes échouent avant tout résultat : cache Chromium
introuvable, puis accès sandbox à `/login` refusé malgré Next prêt. La vraie
campagne utilise hors sandbox le cache installé explicitement. Le runner ne
conserve pas de manifeste daté lorsqu'il manque un rapport frais : les sorties
de ces setups et leurs dossiers de profil subsistent, mais un diagnostic
postérieur ne remplace pas ces deux manifestes transitoires perdus. Ils ne
comptent donc pas comme résultats métier ni comme archives complètes.
Diagnostic explicite :
`.e2e/estimate-generated-atomic/batch-compatibility/retro-20261012-02/setup-observations.json`,
SHA `df1ba93807925d77f4aa672cb9bce643131faec47d0a32ecee810e38a1964fe8`.
