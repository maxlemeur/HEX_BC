# IAv2 — Implementation Plan

## Sequence recommandee

### Sprint / Lot A — rendre la plateforme pilotable

1. IAV2-001 — persistance batch provider
2. IAV2-002 — create/poll/reconcile decouples
3. IAV2-011 — vrai plafond budget global
4. IAV2-013 — politique de confiance observable
5. IAV2-021 — corpus de reference minimal

Resultat attendu:
- on sait ce que fait le systeme
- on sait ce qu'il coute
- on sait reprendre un incident

### Sprint / Lot B — lancer un pilote reel

1. IAV2-022 — instrumentation des corrections humaines
2. IAV2-023 — pilote tenants
3. IAV2-041 — assistant choix niveau/document
4. IAV2-043 — monitoring et reprise hub

Resultat attendu:
- des utilisateurs reels peuvent travailler avec l'outil
- le produit obtient un retour terrain exploitable

### Sprint / Lot C — convertir le moteur en gain metier

1. IAV2-031 — structure par lots/familles/postes
2. IAV2-032 — questions ouvertes et hypotheses
3. IAV2-033 — preview d'injection orientee gain de temps
4. IAV2-042 — robustesse PDF terrain

Resultat attendu:
- le niveau C devient defendable comme vrai accelerateur de chiffrage

---

## Gates de passage

On ne passe pas du lot A au lot B si:
- le batch n'est pas reprenable
- le cout par dossier n'est pas mesurable
- les etats jobs ne sont pas comprehensibles

On ne passe pas du lot B au lot C si:
- le pilote ne prouve pas un gain de temps reel
- le taux de correction humaine reste trop eleve
- les chiffreurs ne comprennent pas quel niveau lancer
