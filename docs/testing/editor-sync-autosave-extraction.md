# Extraction de la présentation et du cycle de sauvegarde

Avant publication du 15 octobre 2026, la copie exacte du commit échoue au budget
d'architecture : `useEstimateEditorSyncController.ts` contient 1 333 lignes non
vides pour une limite de 1 200. La limite reste inchangée.

Défaillances à exclure avant l'extraction : préférence de sauvegarde perdue lors
du changement d'utilisateur ; mauvais état affiché hors ligne, en conflit ou
pendant une écriture ; absence de flush à la sortie de page ; raccourci réglages
qui déclenche la mauvaise sauvegarde ; écriture malgré un verrou ou une lecture
requise. L'extraction concerne la préférence, les événements navigateur et les
libellés. Les révisions, verrous, intentions et mutations restent dans le
contrôleur.

Validation prévue : tests existants du contrôleur, de `useAutoSave` et de sa
navigation, puis réglages, saisie/rechargement, concurrence et verrous dans la
campagne Army. Ces suites existaient avant l'extraction ; aucune assertion de
texte source ni aucun nouveau test unitaire miroir n'est ajouté.

Les vérifications finales et l'identité du commit sont conservées dans
`.codex-tmp/publication-debt-20261015/`.

Le contrôleur passe de 1 333 à 1 199 lignes non vides. Les 61 régressions
existantes de sauvegarde/navigation passent ; le budget est inchangé. La copie
isolée du futur commit a aussi exécuté 3 044 tests avec succès, puis les 68
contrôles de sauvegarde et de garde réseau après extraction/compatibilité SDK.

La recette d'impression a exposé un faux doublon dans sa lecture DOM : cinq
totaux visibles et cinq identiques sous un `DIV` caché. Le rouge complet et son
rejeu diagnostique sont conservés. La recette lit désormais les cinq totaux
visibles dans `.estimate-document`, sans déduplication des valeurs : deux séries
visibles restent un échec. Le relevé `rounding-print-scope` conserve aussi les
éléments cachés, leur appartenance au document et leur visibilité.

Le premier commit publié, `d484c5a1`, échoue ensuite au typage GitHub et au
build : le relevé diagnostique ajouté après les contrôles locaux renvoie deux
champs potentiellement `undefined`, interdits par le contrat JSON de
`browser.evaluate`. Cet échec est reproduit sur la copie exacte du commit avec
`npm run typecheck` (sortie 2). Les valeurs absentes deviennent une chaîne vide
pour le libellé et `null` pour les classes du parent ; les assertions des cinq
totaux restent inchangées. Les preuves avant/après et le rejeu métier sont
conservés dans `.codex-tmp/publication-debt-20261015/ci-*`.
