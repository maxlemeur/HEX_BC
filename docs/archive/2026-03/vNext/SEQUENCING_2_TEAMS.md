# vNext — Sequencing 2 equipes

## Ce qui peut partir ensemble

### Vague 1

- Equipe A: `VNEXT-E01`
- Equipe B: `VNEXT-E02`

Ces deux epics peuvent partir ensemble si:
- Equipe A possede le shell affaire et la timeline
- Equipe B possede import/mapping/materialisation

### Vague 1bis

- Equipe B: `VNEXT-E06 / US-6.1`

Peut partir avant la fin de Vague 1 car il partage les memes contrats que `VNEXT-E02`.

### Vague 2

- Equipe A: `VNEXT-E03`
- Equipe B: `VNEXT-E04`

Peut partir en parallele apres stabilisation de la Vague 1.

### Vague 3

- Equipe A: `VNEXT-E05`
- Equipe B: `VNEXT-E06 / US-6.2 + US-6.3`

Peut partir apres Vague 2, mais le merge final de `VNEXT-E05` doit attendre le gel du contrat
de statuts/reprise porte par `VNEXT-E06`.

## Dependances par epic

| Epic | Dependances |
|------|-------------|
| VNEXT-E01 | socle affaire existant |
| VNEXT-E02 | imports, mappings, RPC SQL existants |
| VNEXT-E03 | VNEXT-E01, intake-plan-sync, takeoff existant |
| VNEXT-E04 | VNEXT-E01, pricebook/supplier comparison existants |
| VNEXT-E05 | VNEXT-E04, exports, email, orders |
| VNEXT-E06 | VNEXT-E02 pour US-6.1, puis VNEXT-E03/VNEXT-E04 pour US-6.2 |

## Lecture simple par equipe

### Equipe A

- commence par rendre le dossier pilotable
- enchaine sur le metre affaire-first
- termine par la finish line

### Equipe B

- commence par la structuration DPGF et la creation de version
- traite tout de suite la visibilite du carry-over
- enchaine sur le pricing et la reprise cross-flux

## Fichiers a posseder

### Equipe A

- `src/app/dashboard/affaires/**`
- `src/components/affaires/**`
- surfaces affaire visibles pour takeoff et finish line
- integration affaire -> exports / orders

### Equipe B

- `src/lib/imports/**`
- `src/lib/mappings/**`
- `src/lib/affaires/import-flow*.ts`
- `src/lib/takeoff/**`
- `src/lib/catalogue/**`
- extensions pricing de `src/lib/estimates/server.ts`

## Points de collision probables

| Fichier / zone | Risque | Regle |
|----------------|--------|-------|
| `AffaireHub.tsx` | fort | Equipe A seule edite |
| `page.tsx` affaire | fort | Equipe A seule edite |
| `src/lib/affaires/server.ts` | moyen | contrats definis par Equipe B, integration par Equipe A |
| `src/lib/affaires/intake-server.ts` | moyen | ownership Equipe A sauf contrat cross-flux explicite |
| `src/lib/takeoff/server.ts` | fort | Equipe B seule edite |
| `src/lib/estimates/server.ts` | fort | Equipe B seule edite pour pricing |
| `review/apply takeoff` affaire | moyen | shell A, moteur B |
| `CockpitCommandBar.tsx` | moyen | Equipe A seule edite |

## Resultat attendu a la fin

- un parcours affaire unique et lisible
- une structure devis robuste depuis DPGF
- un metre relisible avec apply controle
- un pricing fournisseur par couverture et exceptions
- une finish line devis + commandes
- une meilleure continuite entre versions et reprises
