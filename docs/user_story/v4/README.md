# User Stories v4 — VNext IA, preuve et boucle client

Version: 2026-03-06

## Objectif

La V4 prolonge la V3 sur deux axes complémentaires :

1. **Durcir et enrichir la V3 "Mètres & Plans"** avec un addendum orienté preuve, exceptions et validation.
2. **Ouvrir le cycle VNext** avec les epics `EST-E21` à `EST-E25` pour passer d'un outil de saisie à une plateforme de chiffrage assisté, explicable et collaborative.

## Périmètre couvert

### Addendum V3

- [V3-UPDATE-TAKEOFF.md](../v3/V3-UPDATE-TAKEOFF.md)
- [V3-E04-role-direction-permissions.md](../v3/V3-E04-role-direction-permissions.md)
- [V3-E05-workflow-approbation-affaire.md](../v3/V3-E05-workflow-approbation-affaire.md)
- [V3-E06-dashboard-direction-risque.md](../v3/V3-E06-dashboard-direction-risque.md)
- [V3-E07-portail-client-lite.md](../v3/V3-E07-portail-client-lite.md)

### Nouvelles epics VNext

- [EST-E21-ai-intake-brief-affaire.md](../EST-E21-ai-intake-brief-affaire.md)
- [EST-E22-draft-assiste-ouvrages.md](../EST-E22-draft-assiste-ouvrages.md)
- [EST-E23-preuve-prix-risque.md](../EST-E23-preuve-prix-risque.md)
- [EST-E24-collaboration-revue-exception.md](../EST-E24-collaboration-revue-exception.md)
- [EST-E25-revision-engine-boucle-client.md](../EST-E25-revision-engine-boucle-client.md)

## Milestones

| Milestone | Thème | Epics |
| --------- | ----- | ----- |
| **M7** | IA native, preuves, revue, collaboration | V3-E04, V3-E05, V3-E06, EST-E21, EST-E22, EST-E23, EST-E24 |
| **M8** | Portail client lite, V2/V3 assistées, boucle client | V3-E07, EST-E25 |

## Ordre recommandé

### Vague 1 — Rendre la V3 vendable et pilotable

- addendum V3-005, V3-007, V3-009, V3-010, V3-012, V3-013, V3-014
- V3-E04 et V3-E05
- EST-E21

### Vague 2 — Supprimer la page blanche et fiabiliser le devis

- EST-E22
- EST-E23
- V3-E06

### Vague 3 — Fermer la boucle collaboration -> client -> révision

- EST-E24
- V3-E07
- EST-E25

## Plan d'implémentation

Le plan détaillé 3 équipes (`2 fullstack + 1 frontend`) est documenté dans :

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

Les contrats d'implementation frontend associes a l'equipe C sont egalement regroupes dans ce dossier.

Pour tester l'UI et les parcours critiques pendant l'implementation, les equipes peuvent aussi utiliser le skill [`agent-browser`](../../../.agents/skills/agent-browser/SKILL.md).

Les prompts generiques par equipe sont disponibles dans :

- [TEAM-A-AGENT-PROMPT.md](./TEAM-A-AGENT-PROMPT.md)
- [TEAM-B-AGENT-PROMPT.md](./TEAM-B-AGENT-PROMPT.md)
- [TEAM-C-AGENT-PROMPT.md](./TEAM-C-AGENT-PROMPT.md)

Il reprend le format des autres versions avec :

- répartition des stories par équipe
- vagues M7/M8
- dépendances et chemins critiques
- gates qualité par phase

## Fixtures de test

Un faux plan BTP (PDF 2 pages) est disponible pour tester les fonctionnalités métré / plans :

```
docs/test-fixtures/fake-plan-lot-archi.pdf
```

- **Page 1** : Plan RDC coté d'un T3 (séjour, cuisine, 2 chambres, SDB, WC, terrasse)
- **Page 2** : Tableau récapitulatif avec 24 postes (surfaces m², linéaires ml, comptages u)
- Regénérable via `python3 scripts/generate-fake-plan.py` (nécessite `reportlab`)

**Utilisation** : importer ce PDF dans une affaire via la page Plans, puis lancer un métré.

## Personas de référence

| Persona | Besoin principal |
| ------- | ---------------- |
| **Marie** | démarrer vite, avec un parcours guidé et visible |
| **Laurent** | arbitrer rapidement avec des preuves et des explications fiables |
| **Nadia** | valider par exception sans devoir entrer dans l'éditeur complet |
