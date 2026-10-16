# Revue DPGF : liaison multiple et changement de filtre

## Défaillances et observations définies avant correction

Le scénario Army `supports exceptions export and manual multi-linking` doit
conserver toutes ses assertions d'export, de liaison manuelle et d'agrégation.
Il utilise seulement une affaire ARMY neuve sur le backend local jetable.

| Défaillance | Observation attendue |
| --- | --- |
| Le test clique une ligne de l'ancienne vue pendant le passage d'« Exceptions seulement » à « Tout ». | Attendre l'URL de la nouvelle vue et la ligne Moquette, absente des exceptions, avant de sélectionner Cloison. |
| Un toast de succès masque la perte d'un des deux liens ou une somme incorrecte. | Relire la comparaison par l'API : identités exactes des deux items, quantités 4 et 6, total 10, mode manuel et preuve de formule. |
| L'agrégation n'existe que dans l'état courant du navigateur. | Recharger la page, sélectionner Cloison puis vérifier à nouveau les preuves affichées et les données persistées. |
| Une correction contourne le défaut au lieu de l'exposer. | Garder l'assertion « Agrégation », sans délai fixe, retry de scénario, skip, mock de réponse ou augmentation de timeout. |

La preuve CI initiale est le
[run Full 38872310859](https://github.com/maxlemeur/HEX_BC/actions/runs/38872310859),
révision `40ffb876` : production **121/122**, développement **4/4**, campagne
globale en échec. Les archives originales sont conservées sous
`.codex-tmp/army-dev-publication-20261016/preexisting-full-ci/`.

Le rapport montre `Mode: manual` juste avant une navigation qui retire
`dpgfView`, puis le panneau final affiche Faux plafond en mode automatique.
La ligne Cloison affiche pourtant les deux items, un métré de 10 m² et six
preuves. Le clic « Tout » lance un rechargement de comparaison ; son indicateur
de chargement démonte la vue, dont la sélection revient ensuite à la première
ligne. Une ligne déjà visible avant cette navigation ne prouve donc pas que
la nouvelle vue est prête.

La reproduction et les rejeux ciblés sont distincts du Full complet. Chaque
preuve conserve sa commande, sa révision et son diff, ses fixtures, son rapport,
ses empreintes et le résultat du nettoyage. Une sélection filtrée ou une
préparation échouée ne qualifie pas la campagne Full.

## Contrôle CI du bootstrap

Le [Quality Gate 38880873549](https://github.com/maxlemeur/HEX_BC/actions/runs/38880873549)
sur `63ecf893` échoue sur un contrôle textuel qui impose `runApplication` en
première propriété. La réservation du port applicatif précède désormais ce
callback. Les tests lifecycle vérifient son attente et le nettoyage après son
rejet, mais injectent eux-mêmes ce callback : ils ne vérifient pas son
raccordement dans le script CI. Le retirer pourrait empêcher les parcours sans
faire échouer ce script.

Ce contrôle existant doit donc conserver sa protection, en examinant l'appel
TypeScript plutôt que l'ordre du texte : un seul appel attendu, réellement
attendu avec `await`, et le callback `runApplication` présent dans son objet
d'options. Appel supprimé, attente supprimée ou callback absent restent des
échecs. Aucun nouveau test unitaire miroir n'est ajouté.

## Résultats locaux du 16 octobre 2026

Le témoin isolé sur `63ecf893` passe **2/2** (connexion et scénario historique).
Le défaut dépend de la chronologie de la campagne et n'est pas reproduit par
ce témoin ; le rouge CI original reste la preuve de l'échec. Le reçu est
`.codex-tmp/army-dpgf-review-20261016/baseline-original-pass/receipt.json`.
Une erreur du post-traitement, qui cherchait le rapport sous `critical` au lieu
de `full`, est conservée séparément et n'est pas un échec de l'application.

Le garde ciblé passe **1/1** sur le candidat isolé et sur le checkout courant.
Trois mutations privées du runner (callback, attente ou appel supprimé)
échouent chacune sur l'assertion attendue. Les tests lifecycle passent **15/15**.
Une tentative sandbox arrêtée avant collection (`EPERM`, zéro test exécuté)
est conservée et exclue de ces résultats. Commandes, fixtures et empreintes :
`.codex-tmp/army-dpgf-review-20261016/guard-validation-native/guard-review-proof.json`.

Ces contrôles ciblés ne constituent pas une qualification Full. La validation
complète doit exécuter production et développement en CI sur le commit publié.

Le premier rejeu du scénario renforcé échoue **1 réussi / 1 échoué**, après
SQL/RLS/build réussis. Les liens, quantités et assertions UI passent ; le nouvel
oracle de preuve confondait la clé calculée par le comparateur pur avec la
réponse enrichie à partir des preuves persistées. Le contrat réel
`mapActiveLineEvidenceRowsToProofs` renvoie l'UUID stocké et la source
`Aggregation manuelle`. Le scénario exige désormais une seule formule correcte
et le même UUID avant/après rechargement. Aucun code produit n'est changé pour
satisfaire cette attente. L'échec reste sous
`.codex-tmp/army-dpgf-review-20261016/candidate-first-failed/`.

Le rejeu corrigé passe **2/2**, sans échec, skip ni retry, après les **1253**
assertions SQL, les **deux** tests RLS et le build complet. Les deux IDs liés,
les quantités 4 et 6, leur somme 10 et l'identité persistante de la formule sont
vérifiés avant/après rechargement. Preuves sous
`.codex-tmp/army-dpgf-review-20261016/candidate-v2/`. Le même adaptateur local
figé lance le wrapper canonique Full filtré ; ses seuls écarts avec le bootstrap
CI sont les imports, l'identification du périmètre et la sélection de cette
phase. Aucun de ces deux tests ne remplace le Full complet en CI.
