# Lecture des preuves GO01–GO06

Défaillances définies avant implémentation le 12 octobre 2026. Ce lecteur
travaille sur une archive terminale explicitement nommée. Il ne lance aucun
serveur, navigateur, Auth ou SQL et ne modifie pas l'archive. La qualification
native et les courses restent celles des reçus liés par le profil.

| Défaillance du lecteur | Refus ou vérification attendue |
| --- | --- |
| Auth échoue puis six parcours sont skipped ; un résumé paraît réussi. | Sept titres exacts, une tentative réussie par résultat, compteurs 7/7 et aucun skip, retry, filtre ou modèle. |
| Résultat dupliqué, mauvais fichier ou cible, sous-ensemble choisi. | Titres, identifiants uniques, fichiers auth/journey et cible desktop vérifiés. |
| Un manifeste présente des hashes sans relire les octets. | Inventaire exhaustif, SHA de chaque artefact et sous-artefact du rapport, confinement et absence de symlink. |
| Sources/build changent après la campagne ou pendant son exécution. | SHA actuels, HEAD et diff, égalité avant/après, build réel et étapes réussies. Aucun choix du dernier run. |
| Un profil couvre une autre pile ou une preuve native historique est promue. | Relecture du profil archivé avec `loadCoverageProfile`, inventaire et SHA identiques à ceux archivés ; voies historique et nativeRecipe distinctes. |
| Le flag passed cache des faits métier incohérents. | Relecture indépendante des JSON business : centimes, identités, provenance, états, intention conservée et demandes exactes. |
| GO01/02 récupère une réponse réelle par une deuxième insertion. | Une chaîne d'application inchangée, même demande/clé, 3 s sans POST automatique, abandon positif de GO02, aucune écriture bulk. |
| GO03 écrase la revue courante ou GO04 réapplique la première sélection. | Réponses réelles REVIEW_CHANGED409 pour l'application et la sauvegarde obsolètes ; 1200/240/1440 puis sélection partielle 1500/300/1800 et totale 3500/700/4200 avec première chaîne inchangée. |
| GO05 réactive une intention abandonnée ou confond absence et clôture. | Refus réel perdu, retry identique refusé, tombstone au corps exact, ancien apply toujours abandonné, nouvelle clé à 1400/280/1680. |
| GO06 est un stub, un appel modèle ou invente des sources du catalogue. | Deux réponses de vraie génération locale, fallback sans modèle/coût/tokens, textes et sources exacts, contexte rattaché aux objets capturés, garde réseau et zéro engagement financier. |
| Secrets ou sessions dans les archives/erreurs de qualification. | Tous les octets archivés contrôlés contre les valeurs env password/secret/token/key/credential/authorization et emails E2E, avec leurs formes URI/JSON ; JWT et champs de bail/session refusés ; messages de refus ne reproduisent pas les valeurs. Une fuite inconnue ou visible seulement dans les pixels reste hors de cette preuve. |

Les fautes du lecteur (archive altérée, omission, symlink, mélange de campagne)
ne peuvent être exposées par un parcours produit : elles concernent sa lecture
hors réseau. Les commandes CLI sur archives réellement échouées valident un
refus, jamais un succès métier fabriqué. `--help` décrit seulement la commande.
Une qualification réussie demande une vraie campagne complète ; sans celle-ci,
le lecteur doit conserver un résultat failed et une sortie non nulle.

Commande : `node scripts/tester-army/qualify-generated-recovery.mjs <chemin-exact-du-run>`.
Le chemin doit désigner un enfant direct de `.e2e/army/coverage/runs/`. Le reçu
est créé dans un nouveau dossier de `generated-recovery-qualifications/`, avec
son propre SHA ; aucune archive existante n'est réécrite.

## Première qualification réelle

Le run `2026-10-12T18-29-57-281Z` passe ses sept résultats sur le build
`1d0jBvzf6x29IoHQUi4Ey`. Le `read-stage` du cycle 08 refuse son contrôle de
confidentialité : seules deux variables ambiantes, `LMSTUDIO_API_KEY` et
`OLLAMA_API_KEY`, correspondent à une sentinelle publique inerte présente
dans un chemin de script et un commentaire. Ces providers ne sont pas
consommés par cette campagne locale sans modèle. Une revue en lecture seule
contrôle les 491 fichiers et les trois occurrences ; aucun autre secret
configuré, JWT ou champ de bail n'est trouvé.

La relecture explicite retire uniquement ces deux sentinelles vérifiées de
l'environnement du processus lecteur. Toutes les autres valeurs, notamment
les credentials de la campagne, sont conservées. Le scanner strict reste
inchangé ; il n'a ni seuil de longueur ni exception automatique pour un provider.
Il ne faut pas supprimer une vraie clé pour faire passer ce contrôle.

Qualification indépendante :
`.e2e/army/coverage/generated-recovery-qualifications/2026-10-12T18-29-57-281Z-b530a66b/qualification.json`,
SHA `cabc614f63709c8c12fcde591fb16e83df87a0e1e1049cb945e6ae8ad0a02c85`,
24 529 contrôles, zéro échec, 491 fichiers examinés.
Le reçu d'invocation et de conservation est
`.e2e/army/coverage/reader-rechecks/2026-10-12T18-45-30-856Z-ade440e5/receipt.json`,
SHA `e651204a937ed7401ebb3fa978c2ae06c2633cb210d9dc5fd220d62c36821543`.
Les 1 663 sources, les 491 artefacts, les 292 fichiers du cycle 08 et l'ancien
reçu en échec restent identiques. Cette qualification ne transforme pas le
`read-stage` initial en étape réussie.
