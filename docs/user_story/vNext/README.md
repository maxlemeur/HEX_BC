# User Stories vNext — TIMAX

## Contexte

La vNext doit transformer un ensemble de briques deja fortes en un parcours affaire unique,
lisible et actionnable pour un chiffreur BTP.

Flux principal de reference:

`affaire -> intake documentaire -> brief -> import DPGF tabulaire -> mapping -> creation de version -> sync plans -> takeoff IA -> review/apply -> suggestions de prix -> finish line`

Branches adjacentes:
- `version-zero`
- `generated-ouvrages`

Legacy:
- `takeoff estimate-first`

Le dossier `vNext` est la version a fournir aux equipes de dev pour executer la suite,
avec une orchestration optimisee pour **2 equipes** travaillant sur **2 epics en parallele**.

Documents de reference de ce dossier:
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- [SEQUENCING_2_TEAMS.md](./SEQUENCING_2_TEAMS.md)
- [TIMAX-vNext-backlog-structure.md](./TIMAX-vNext-backlog-structure.md)
- [TIMAX-vNext-decisions-risques.md](./TIMAX-vNext-decisions-risques.md)

## Principes directeurs

- experience utilisateur `affaire-first`
- gestion par exceptions
- realite du metier de chiffrage
- automatisations assistives et explicables
- aucune nouvelle filiere parallele si une brique canonique existe deja

## Index des epics

| Code | Nom | Priorite | Stories | Equipe recommandee | Fichier |
|------|-----|----------|---------|--------------------|---------|
| VNEXT-E01 | Dossier affaire pilote et exceptions | P0 | US-1.1 a 1.3 | Equipe A | [VNEXT-E01-dossier-affaire-exceptions.md](./VNEXT-E01-dossier-affaire-exceptions.md) |
| VNEXT-E02 | Structuration du devis depuis DPGF | P0 | US-2.1 a 2.4 | Equipe B | [VNEXT-E02-structuration-devis-dpgf.md](./VNEXT-E02-structuration-devis-dpgf.md) |
| VNEXT-E03 | Metre IA, preuves et apply controle | P0 | US-3.1 a 3.3 | Equipe A | [VNEXT-E03-metre-preuves-apply.md](./VNEXT-E03-metre-preuves-apply.md) |
| VNEXT-E04 | Pricing fournisseur integre | P0-P1 | US-4.1 a 4.4 | Equipe B | [VNEXT-E04-pricing-fournisseur-integre.md](./VNEXT-E04-pricing-fournisseur-integre.md) |
| VNEXT-E05 | Finish line devis + commandes | P1 | US-5.1 a 5.3 | Equipe A | [VNEXT-E05-finish-line-devis-commandes.md](./VNEXT-E05-finish-line-devis-commandes.md) |
| VNEXT-E06 | Continuite, reprise et clarte des flux | P0-P1 | US-6.1 a 6.3 | Equipe B | [VNEXT-E06-continuite-reprise-flux.md](./VNEXT-E06-continuite-reprise-flux.md) |

## Strategie 2 equipes

Le plan optimise n'est pas:
- une equipe front d'un cote et back de l'autre;
- ni un decoupage "tout le hub" vs "tout le reste".

Le plan retenu est:
- **Equipe A**: orchestration affaire, experience utilisateur, takeoff affaire-first, finish line
- **Equipe B**: pipeline DPGF, pricing, continuites de version, contrats techniques centraux

Cette repartition limite les collisions sur les fichiers les plus sensibles:
- Equipe A possede la coque affaire et les surfaces visibles
- Equipe B possede les pipelines internes et la logique de selection/pricing

## Ordre de lancement recommande

### Vague 1
- Equipe A: `VNEXT-E01`
- Equipe B: `VNEXT-E02`

### Vague 1bis
- Equipe B: `VNEXT-E06 / US-6.1`

### Vague 2
- Equipe A: `VNEXT-E03`
- Equipe B: `VNEXT-E04`

### Vague 3
- Equipe A: `VNEXT-E05`
- Equipe B: `VNEXT-E06 / US-6.2 + US-6.3`

## Prompts equipes

- [TEAM-A-AGENT-PROMPT.md](./TEAM-A-AGENT-PROMPT.md)
- [TEAM-B-AGENT-PROMPT.md](./TEAM-B-AGENT-PROMPT.md)
