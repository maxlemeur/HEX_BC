# Règle produit — Documents principaux et complémentaires dans l'intake affaire

## Décision
- Un dossier affaire peut contenir plusieurs documents `DPGF`.
- Un seul document `DPGF` au maximum peut être défini comme `principal`.
- Un dossier affaire peut contenir plusieurs documents `CCTP`.
- Un seul document `CCTP` au maximum peut être défini comme `principal`.

## Sémantique métier
- Le `DPGF principal` est la base prioritaire du chiffrage.
- Le `DPGF principal` est le document utilisé par défaut pour l'extraction structurée.
- Le `DPGF principal` est la référence affichée en premier dans le parcours devis.
- Les autres `DPGF` sont des `DPGF complémentaires`.

- Le `CCTP principal` est le référentiel technique prioritaire.
- Les autres `CCTP` sont des `CCTP complémentaires`.
- Un `CCTP complémentaire` reste une source additionnelle:
  - précisions locales,
  - modificatifs,
  - additifs,
  - notices lot spécifiques.
- Un `CCTP complémentaire` n'écrase jamais automatiquement le `CCTP principal`.
- Il doit pouvoir être signalé comme `complémentaire` ou `potentiellement contradictoire` si le contenu diverge.

## Pourquoi cette règle
- Un DCE réel peut contenir plusieurs pièces de type `DPGF` ou `CCTP`.
- L'utilisateur a besoin d'un document de référence clair.
- Les automatisations TIMAX ont besoin d'une source principale non ambiguë.
- On conserve la richesse documentaire sans casser le workflow.

## Règles de données
- Par affaire:
  - `0..n` documents `DPGF`
  - `0..1` `DPGF principal`
  - `0..n` documents `CCTP`
  - `0..1` `CCTP principal`
- Les autres catégories restent sans notion de principal bloquante.

## Règles d'automatisation
- Si un premier `DPGF` est détecté ou reclassé et qu'aucun principal n'existe, il devient `principal`.
- Si un autre `DPGF` est détecté alors qu'un `DPGF principal` existe déjà, il devient `complémentaire`.
- Même logique pour `CCTP`.
- Si l'utilisateur promeut un document complémentaire en principal, l'ancien principal est rétrogradé en complémentaire.
- Si plusieurs `DPGF` existent sans principal:
  - les automatismes de comparaison, d'analyse et de suggestion peuvent continuer,
  - les automatismes engageants restent limités tant que le principal n'est pas défini.
- Automatismes à limiter sans `DPGF principal`:
  - génération finale du devis structuré,
  - consolidation automatique définitive,
  - remplissage final des prix,
  - finish line / export de production basé sur une vérité documentaire unique.

## Cas des plans
- Les plans restent multiples par nature.
- TIMAX ne force pas de `plan principal` global.
- La notion de référence peut exister plus tard par contexte:
  - lot,
  - niveau,
  - type de lecture,
  - dernière révision.
- En l'état, plusieurs plans peuvent coexister sans bloquer le workflow.

## Comportement UX
- Afficher explicitement:
  - `DPGF principal`
  - `Autres DPGF (x)`
  - `CCTP principal`
  - `Autres CCTP (x)`
- Si plusieurs documents existent dans une catégorie sans principal défini, afficher une alerte non bloquante:
  - `Aucun DPGF principal défini`
  - `Aucun CCTP principal défini`
- Lors d'une reclassification review:
  - si aucun principal n'existe => la conséquence annonce `principal`
  - si un principal existe déjà => la conséquence annonce `complémentaire`
- Quand un `CCTP principal` existe déjà, une pièce ambiguë peut toujours être classée comme `CCTP`, mais la conséquence doit annoncer `CCTP complémentaire`.
- Quand plusieurs `DPGF` / `CCTP` existent sans principal, le hero doit donner plus de poids à la décision `choisir le principal` qu'aux autres manques secondaires.

## Contrat hero cockpit
- Le hero `Prochaine etape` doit pouvoir afficher dans une même lecture:
  - les documents validés pertinents,
  - une pièce à confirmer,
  - les pièces manquantes,
  - les alertes `sans principal` si la donnée est incohérente.
- Quand plusieurs pièces restent à confirmer, une seule pièce review est active dans le hero.
- Les autres pièces à confirmer sont résumées, sans dupliquer toute la surface opératoire du bas.
- Quand le volume devient important, le hero doit se compresser:
  - `Autres valides (n)`
  - `Autres pieces a confirmer (n)`
  - `Autres manquants (n)`
