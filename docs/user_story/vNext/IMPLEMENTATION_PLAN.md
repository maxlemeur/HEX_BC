# Plan d'implementation vNext — 2 equipes

## Hypotheses

- Le socle affaire-first actuel est deja sur `main`.
- Les briques suivantes existent deja et doivent etre reutilisees:
  - intake + brief + register
  - import tabulaire DPGF + mapping + RPC SQL
  - plan sync + takeoff + review/apply
  - suggestions de prix + supplier comparison
  - export PDF / email / BDC
  - module `purchase_orders`
- La vNext doit privilegier la convergence des flux et l'experience utilisateur,
  pas la creation de nouvelles filieres.

## Equipes

| Equipe | Profil | Scope principal | Ownership prefere |
|--------|--------|-----------------|-------------------|
| A | Fullstack UX workflow | affaire, exceptions, takeoff affaire-first, finish line | `src/app/dashboard/affaires/**`, `src/components/affaires/**`, surfaces affaire visibles |
| B | Fullstack moteur / data | import DPGF, pricing, carry-over, contrats | `src/lib/imports/**`, `src/lib/mappings/**`, `src/lib/takeoff/**`, pricing catalogue/estimate |

## Regle d'or d'orchestration

Les deux equipes peuvent avancer en parallele uniquement si:
- la coque affaire reste possedee par l'Equipe A;
- les contrats techniques transverses restent possedes par l'Equipe B;
- les integrations se font par handoff de contrats, pas par editions concurrentes des memes fichiers.

## Fichiers a haut risque de collision

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/lib/affaires/server.ts`
- `src/lib/affaires/intake-server.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/estimates/server.ts`
- `src/components/cockpit/CockpitCommandBar.tsx`

Strategie:
- Equipe A modifie la composition, la navigation et les surfaces affaire.
- Equipe B expose des fetchers, actions ou contrats consommes par Equipe A.
- Toute edition d'un de ces fichiers doit etre precedee d'un contrat stabilise.

Regle pratique:
- aucun dev ne part "sur l'epic" sans story assignee
- pour chaque story touchant un hotspot, un mini handoff doit exister avant implementation:
  - objectif de la story
  - fichiers possedes
  - contrats exposes
  - fichiers interdits a l'autre equipe

## Chemin critique

```text
VNEXT-E01 + VNEXT-E02
        -> VNEXT-E03 + VNEXT-E04
        -> VNEXT-E05
```

`VNEXT-E06 / US-6.1` doit etre traite avant la fin de la Vague 1, car il touche le meme moment produit
que la materialisation de nouvelle version depuis import.

---

## Vague 1 — Rendre le parcours affaire credible

### Equipe A — VNEXT-E01

Objectif:
- faire de l'affaire la surface unique de pilotage
- exposer depot, brief, registre, timeline et file d'exceptions

Stories:
- US-1.1
- US-1.2
- US-1.3

Impact utilisateur:
- l'utilisateur comprend ou en est son dossier;
- il corrige les ambiguïtés sans naviguer a l'aveugle;
- il peut reprendre le travail depuis l'affaire.

### Equipe B — VNEXT-E02

Objectif:
- consolider la structuration devis autour du pipeline canonique DPGF
- preparer la convergence PDF sans casser le tabulaire

Stories:
- US-2.1
- US-2.3
- demarrage technique de US-2.2

Impact utilisateur:
- le DPGF tabulaire reste une entree solide;
- la creation affaire/V1 ou nouvelle version est propre;
- le futur DPGF PDF converge vers le meme pipeline.

### Vague 1bis — Equipe B piggyback VNEXT-E06 / US-6.1

Objectif:
- rendre visible le carry-over au moment ou de nouvelles versions sont creees

Pourquoi maintenant:
- meme zone de code que la materialisation de version;
- attendre la fin du programme augmenterait le risque de dette UX et de perte invisible.

### Gate Vague 1

- une affaire peut servir de cockpit reel de chiffrage
- le tabulaire reste robuste
- la creation de version est explicite et traçable
- les exceptions majeures remontent dans l'affaire

---

## Vague 2 — Couvrir quantites et prix

### Equipe A — VNEXT-E03

Objectif:
- faire du takeoff un flux affaire-first relisible
- imposer la revue par preuves et l'apply controle

Stories:
- US-3.1
- US-3.2
- US-3.3

Pourquoi en parallele de VNEXT-E04:
- faible overlap de fichiers avec le pricing
- forte valeur metier immediate

### Equipe B — VNEXT-E04

Objectif:
- integrer le pricing fournisseur dans le parcours affaire
- faire travailler l'utilisateur par couverture et exceptions

Stories:
- US-4.1
- US-4.3
- preparation de US-4.4

Pourquoi en parallele de VNEXT-E03:
- takeoff et pricing sont deux branches metier distinctes apres creation de version
- elles convergent au niveau affaire sans partager le meme coeur de code

### Gate Vague 2

- les plans confirms deviennent metrables sans reupload
- les quantites peuvent etre appliquees avec preview d'impact
- le pricing se traite par exceptions et couverture
- la comparaison fournisseur devient exploitable a l'echelle du devis

---

## Vague 3 — Finish line et durcissement des flux

### Equipe A — VNEXT-E05

Objectif:
- exposer une finish line lisible depuis l'affaire
- permettre devis PDF, email, BDC et brouillons de commandes

Stories:
- US-5.1
- US-5.2
- US-5.3

### Equipe B — VNEXT-E06

Objectif:
- finaliser la continuite du chiffrage
- rendre explicite la reprise et la hierarchie principal / adjacent / legacy

Stories:
- US-6.2
- US-6.3
- finalisation de US-2.2
- finalisation de US-4.4

Pourquoi ce couplage:
- E05 utilise des briques deja presentes de sortie;
- E06 stabilise la narration produit et la reprise avant generalisation.
- le merge final de E05 ne doit pas partir tant que les statuts et contrats de reprise portes par E06 ne sont pas geles.

### Gate Vague 3

- la finish line est visible et actionnable
- le legacy n'est plus la voie par defaut
- la reprise apres interruption ou echec partiel est lisible
- les brouillons de commandes peuvent etre prepares sans ressaisie

---

## Sequence globale recommandee

| Vague | Equipe A | Equipe B | Notes |
|------|----------|----------|-------|
| 1 | VNEXT-E01 | VNEXT-E02 | premier couple de valeur metier |
| 1bis | support integration E02 | VNEXT-E06 / US-6.1 | piggyback obligatoire |
| 2 | VNEXT-E03 | VNEXT-E04 | quantites et prix en parallele |
| 3 | VNEXT-E05 | VNEXT-E06 reste + finalisation E02/E04 | finish line + robustesse |

## Risques de collision

### Risque 1
- sujet: `AffaireHub` et page affaire
- mitigation: Equipe A seule modifie la composition UI; Equipe B livre des fetchers/actions

### Risque 2
- sujet: `src/lib/estimates/server.ts`
- mitigation: Equipe B possede les extensions pricing; Equipe A consomme via API/fetchers deja exposes

### Risque 3
- sujet: surfaces takeoff dans l'affaire
- mitigation: Equipe A possede launch/review shell; Equipe B ne touche que les contrats et moteurs takeoff

### Risque 4
- sujet: `src/lib/takeoff/server.ts`
- mitigation: ownership exclusif Equipe B pendant les vagues takeoff / reprise; Equipe A consomme les actions/fetchers exposes

### Risque 5
- sujet: cockpit / commandes globales affaire
- mitigation: Equipe A seule edite les surfaces cockpit; Equipe B ne touche que les donnees requises

## Definition of done commune

- aucune nouvelle filiere parallele pour DPGF PDF ou pricing fournisseur
- toute automation sensible reste sous confirmation humaine
- la trace de provenance reste visible pour quantites et prix quand applicable
- au moins un parcours critique Playwright par vague
- aucun blocage UX majeur sur reprise, erreur partielle ou attente async
- toute story implementee doit etre relue contre son contrat source dans `TIMAX-vNext-backlog-structure.md`
