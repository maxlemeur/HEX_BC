# Plan de sequencement MVP — 3 equipes

> Date: 2026-02-21
> Version: 2.0

## Contexte

Ce document planifie l'ordre d'implementation des tickets MVP "Game Changer" pour 3 equipes de developpement avec :
- Les tags couche par ticket : `[DB]` (migration/schema), `[Back]` (server, API, calculs), `[Front]` (composants, pages, hooks)
- L'identification des tickets parallelisables vs sequentiels
- L'affectation optimale aux 3 equipes
- L'integration obligatoire des tests unitaires et E2E dans chaque phase

---

## Legende

- `→` = bloque (le ticket suivant ne peut demarrer qu'apres)
- `//` = parallelisable (les tickets d'une meme vague sont independants)
- Effort : **S** (~2j), **M** (~4j), **L** (~8j+)
- Tags couche : `[DB]` `[Back]` `[Front]` — un ticket peut toucher plusieurs couches
- Qualite : `[UT]` (tests unitaires), `[E2E]` (tests end-to-end), `Gate` (criteres de sortie de phase)

---

## Cadre qualite obligatoire (v2)

### Definition of Done (DoD) par ticket

- Le ticket n'est pas "Done" sans tests.
- Toute logique metier, calcul, parser, reducer ou machine a etats doit etre couverte par des `[UT]`.
- Tout ticket qui modifie un flux utilisateur critique doit ajouter ou mettre a jour au moins un test `[E2E]`.
- Aucune cloture de phase sans `Gate` qualite valide.

### Regles de CI

- PR : `lint` + `typecheck` + `[UT]` du scope impacte.
- Main (quotidien) : pack `[E2E]` smoke des flux critiques.
- Fin de phase : full `[UT]` + full `[E2E]` sur environnement de recette.

### Budget qualite

- Reserver **20% de capacite** par phase pour ecriture, maintenance et stabilisation des tests.
- Le buffer equipe B/C est prioritairement utilise pour QA automation et anti-regression.

---

## PHASE 0 — Fondations M0 (pre-requis MVP)

### Vague 0.1 — Socle critique (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-006 | Feature flags runtime | `[DB]` `[Back]` `[Front]` | M | — |
| **B** | EST-028 | Marge par tranches | `[DB]` `[Back]` `[Front]` | M | — |
| **C** | EST-044 | Concurrence optimiste (409) | `[Back]` `[Front]` | M | — |

### Vague 0.2 — Dependances directes (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-031 | Split MO atelier/chantier | `[DB]` `[Back]` `[Front]` | M | → EST-006 |
| **B** | EST-046 | Seal hash + machine a etats | `[DB]` `[Back]` `[Front]` | S | — |
| **C** | EST-045 | Draft lock pessimiste | `[DB]` `[Back]` `[Front]` | M | → EST-044 |

### Vague 0.3 — Petits tickets paralleles (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-121 | Sous-totaux par section | `[Back]` `[Front]` | M | — |
| **B** | EST-026 | Rounding invariant | `[DB]` `[Back]` | S | — |
| **C** | EST-032 + EST-029 | Labor markup + Type FO | `[DB]` `[Back]` `[Front]` | S+S | — |

#### Tests obligatoires phase 0

- `[UT]` :
  - Evaluation des feature flags (fallback, override, off/on).
  - Calcul marge/tranches + rounding invariant.
  - Gestion des transitions de machine a etats (seal) et verrou draft.
  - Contrat d'erreur 409 sur conflit concurrent.
- `[E2E]` :
  - Deux utilisateurs editent le meme devis -> conflit 409 gere proprement.
  - Flux "draft -> seal -> reprise" sans corruption.
  - Activation/desactivation de flag runtime sur un flux fonctionnel.
- `Gate P0` :
  - Aucun bug bloquant sur concurrence/calcul.
  - Pack E2E socle vert sur 3 runs consecutifs.

> **Duree estimee Phase 0 : 3 vagues ~6-7 semaines (inclut QA)**

---

## PHASE 1 — Sprint 1 : Turbo Editor (M1)

### Vague 1.1 — Demarrage editeur (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-101 | Nav clavier + schema bulk + endpoint atomique | `[DB]` `[Back]` `[Front]` | L | — |
| **B** | EST-105 | Auto-save debounce | `[Back]` `[Front]` | M | → EST-044 (M0) |
| **C** | EST-264 | Performance editeur 3000 lignes | `[Back]` `[Front]` | M | — |

### Vague 1.2 — Editeur avance (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-102 | Edition inline rapide | `[Front]` | M | → EST-101 |
| **B** | EST-103 | Multi-selection + actions groupees | `[Front]` | L | → EST-101 |
| **C** | EST-106 | Undo/Redo global | `[Front]` | L | → EST-105 |

### Vague 1.3 — Finition editeur

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-104 | Copier/Coller depuis Excel | `[Front]` | L | → EST-103 |
| **B** | — | (buffer / dette technique / support QA) | | | |
| **C** | — | (buffer / dette technique / support QA) | | | |

#### Tests obligatoires phase 1

- `[UT]` :
  - Reducers/commands de l'editeur (selection, bulk actions, undo/redo).
  - Debounce auto-save (timers, cancel, retries).
  - Parser copier/coller Excel (formats, erreurs, sanitization).
- `[E2E]` :
  - Navigation clavier complete sur une grille.
  - Multi-selection + action groupee + verification persistance.
  - Undo/redo avec rafraichissement page.
  - Copier/coller Excel (cas nominal + erreurs de format).
- `Gate P1` :
  - Chemin critique `EST-101 -> EST-103 -> EST-104` valide en E2E.
  - Perf editeur conforme cible (3000 lignes) sur scenarii critiques.

> **Duree estimee Phase 1 : 3 vagues ~7-8 semaines (inclut QA)**
> **Chemin critique** : EST-101 → EST-103 → EST-104

---

## PHASE 2 — Sprint 2 : Templates + Suggestions v1 (M1)

### Vague 2.1 — Briques independantes (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-181 | Templates de devis (picker, instantiate) | `[DB]` `[Back]` `[Front]` | L | — |
| **B** | EST-182 | Ouvrages reutilisables (drawer, insert) | `[DB]` `[Back]` `[Front]` | L | — |
| **C** | EST-161 | Scoring et classement suggestions | `[DB]` `[Back]` `[Front]` | M | — |

### Vague 2.2 — Suite logique

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | — | (fin EST-181 si L deborde) | | | |
| **B** | — | (fin EST-182 si L deborde) | | | |
| **C** | EST-162 | Bulk apply suggestions | `[Back]` `[Front]` | M | → EST-161 |

#### Tests obligatoires phase 2

- `[UT]` :
  - Instanciation template (mapping, valeurs par defaut, idempotence).
  - Scoring suggestions (determinisme, ponderation, tri).
  - Bulk apply (atomicite, rollback sur echec partiel).
- `[E2E]` :
  - Creation devis depuis template.
  - Insertion ouvrage reutilisable dans un devis existant.
  - Application en masse des suggestions sur lot de lignes.
- `Gate P2` :
  - Aucune perte de donnees sur create/apply.
  - Pack E2E templates/suggestions vert sur 3 runs.

> **Duree estimee Phase 2 : 2 vagues ~5-6 semaines (inclut QA)**
> **100% parallelisable** en vague 2.1 — aucune dependance croisee

---

## PHASE 3 — Sprint 3 : Price Book (M2)

### Vague 3.1 — 3 chantiers independants (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-164 | Suggestions catalogue (stale 90j, badge) | `[Back]` `[Front]` | M | — |
| **B** | EST-035 | Import CSV Price Book (**NEW**) | `[Back]` `[Front]` | M | — |
| **C** | EST-201 | PDF serveur `@react-pdf/renderer` | `[Back]` | L | — |

> EST-201 demarre en phase 3 pour absorber le risque d'effort L avant Sprint 4.

### Vague 3.2 — Dependances catalogue

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-030 | Comparaison multi-fournisseurs | `[DB]` `[Back]` `[Front]` | L | → EST-164 |
| **B** | EST-143 | Detection d'outliers | `[Back]` `[Front]` | M | — |
| **C** | EST-201 | (suite — ticket L, ~2 semaines) | `[Back]` | | |

#### Tests obligatoires phase 3

- `[UT]` :
  - Parser CSV (encodage, colonnes manquantes, valeurs invalides).
  - Regles comparaison multi-fournisseurs et outliers.
  - Generation PDF serveur (cas nominal + erreurs de rendu).
- `[E2E]` :
  - Import CSV -> suggestions catalogue -> comparaison fournisseur.
  - Generation PDF depuis devis representatif.
- `Gate P3` :
  - Pas d'ecart de calcul entre UI et export.
  - PDF genere sans regression sur jeux de donnees de reference.

> **Duree estimee Phase 3 : 2 vagues ~5-6 semaines (inclut QA)**
> **Chemin critique** : EST-164 → EST-030

---

## PHASE 4 — Sprint 4 : Send "lite" (M2)

### Vague 4.1 — Gating + integration (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-141 | Gating envoi + orchestration send | `[Back]` `[Front]` | M | → EST-028, EST-031 (M0) |
| **B** | EST-034 | Import OPTIMA | `[Back]` | M | — |
| **C** | EST-201 | (fin si pas termine + integration Storage) | `[Back]` | | |

### Vague 4.2 — Finitions

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-142 | Checklist completude | `[Front]` | M | → EST-141 |
| **B** | — | Integration Send "lite" end-to-end | | | → EST-141, EST-201, EST-046 |
| **C** | — | Tests / QA / buffer | | | |

#### Tests obligatoires phase 4

- `[UT]` :
  - Regles gating d'envoi et statut de completude.
  - Orchestration send (pre-conditions, erreurs, retries).
- `[E2E]` :
  - Flux complet "draft -> validation -> PDF -> send".
  - Cas negatif : blocage send quand checklist incomplete.
  - Cas negatif : conflit d'etat/seal invalide.
- `Gate P4` :
  - Flux Send "lite" vert sur 5 runs consecutifs.
  - Zero bug P0/P1 ouvert au jalon fin M2.

> **Duree estimee Phase 4 : 2 vagues ~4-5 semaines (inclut QA)**
> **Point d'integration critique** : EST-141 + EST-201 + EST-046

---

## PHASE 5 (optionnel) — Sprint 5 : Diff versions (M3)

### Vague 5.1 (// 3 equipes)

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-221 | Diff visuel entre versions | `[Back]` `[Front]` | L | — |
| **B** | EST-222 | Timeline des versions | `[Back]` `[Front]` | M | — |
| **C** | EST-036 | Events append-only (**NEW**) | `[DB]` `[Back]` `[Front]` | S | → EST-046 (M0) |

### Vague 5.2

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-223 | Scenarios alternatifs | `[DB]` `[Back]` `[Front]` | M | → EST-221 |
| **B** | EST-224 | Changelog automatique | `[Back]` `[Front]` | M | → EST-221 |
| **C** | — | buffer QA | | | |

#### Tests obligatoires phase 5

- `[UT]` :
  - Moteur de diff version, normalisation et filtrage des events.
- `[E2E]` :
  - Parcours timeline + comparatif visuel entre deux versions.
- `Gate P5` :
  - Integrite historique conservee (events append-only verifies).

> **Duree estimee Phase 5 : 2 vagues ~4-5 semaines (inclut QA)**

---

## PHASE 6 (optionnel) — Sprint 6 : Rules engine (M4)

### Vague 6.1

| Equipe | Ticket | Titre | Couches | Effort | Dep |
|--------|--------|-------|---------|--------|-----|
| **A** | EST-037 | Rules engine marge/remise (**NEW**) | `[DB]` `[Back]` `[Front]` | L | → EST-141, EST-028 |
| **B+C** | M4 lifecycle | EST-241..245 (portail, email...) | `[DB]` `[Back]` `[Front]` | L | — |

#### Tests obligatoires phase 6

- `[UT]` :
  - Evaluation de regles (priorite, conflits, bornes de marge/remise).
- `[E2E]` :
  - Scenario bout-en-bout avec regles appliquees puis envoi.
  - Verification lifecycle M4 (portail + email).
- `Gate P6` :
  - Rules engine deterministe et explicable (meme input -> meme output).

> **Duree estimee Phase 6 : 1 vague ~4-5 semaines (inclut QA)**

---

## Registre de risques (v2)

| Risque | Impact | Probabilite | Mitigation | Owner |
|-------|--------|-------------|------------|-------|
| Retard sur EST-101/103/104 | Decale Phase 1 complete | Haute | Gate intermediaire fin 1.2 + support B/C en QA+fix | Team A |
| Convergence EST-141 + EST-201 + EST-046 | Blocage integration Send | Haute | Dry-run E2E des S20 + branche integration dediee | Team A/B/C |
| Dette de tests accumulee | Regressions tardives | Moyenne | 20% capacite QA fixe par phase + CI gates | Tech lead |
| Instabilite E2E env | Faux positifs / retard release | Moyenne | Donnees seedees stables + retries limites + triage quotidien | Team C |

---

## Resume : graphe de dependances critiques

```
EST-006 ──→ EST-031 ──────────────────────→ EST-141 ──→ EST-142
                                               ↑          ↓
EST-028 ──────────────────────────────────────┘       EST-037
                                                         ↑
EST-044 ──→ EST-045                                      │
    ↓                                                    │
EST-105 ──→ EST-106                               EST-141 ←───┘
                                                     ↑
EST-101 ──→ EST-102                               EST-201
    ↓                                                ↑
EST-103 ──→ EST-104                               EST-046 ──→ EST-036

EST-161 ──→ EST-162          EST-164 ──→ EST-030
                             EST-221 ──→ EST-223 / EST-224
```

---

## Backlog qualite transversal (a creer en tickets dedies)

| ID | Type | Portee | Quand | Owner propose |
|----|------|--------|-------|---------------|
| QA-001 | `[UT]` | Harness tests calculs/totaux/marge | Phase 0 | Team B |
| QA-002 | `[E2E]` | Pack concurrence + draft lock + seal | Phase 0 | Team C |
| QA-003 | `[UT]` | Reducers/commands Turbo Editor | Phase 1 | Team A |
| QA-004 | `[E2E]` | Smoke pack editeur (keyboard, bulk, undo) | Phase 1 | Team C |
| QA-005 | `[UT]` | Templates/suggestions scoring | Phase 2 | Team B |
| QA-006 | `[E2E]` | Price Book + PDF regression pack | Phase 3 | Team C |
| QA-007 | `[E2E]` | Send "lite" full flow + cas negatifs | Phase 4 | Team B |

---

## Charge par equipe (estimation v2 avec QA)

### Equipe A — Chemin critique editeur + gating
| Phase | Tickets | Effort total |
|-------|---------|-------------|
| 0 | EST-006 + EST-031 + EST-121 + UT associes | ~12j |
| 1 | EST-101 + EST-102 + EST-104 + UT associes | ~24j |
| 2 | EST-181 + support tests integration | ~10j |
| 3 | EST-164 + EST-030 + fix issus E2E | ~14j |
| 4 | EST-141 + EST-142 + hardening send | ~10j |
| 5 | EST-221 + EST-223 | ~12j |
| 6 | EST-037 | ~8j |
| **Total** | | **~90j** |

### Equipe B — Moteur calcul + imports + automation QA
| Phase | Tickets | Effort total |
|-------|---------|-------------|
| 0 | EST-028 + EST-046 + EST-026 + QA-001 | ~10j |
| 1 | EST-105 + EST-103 + support bugfix | ~14j |
| 2 | EST-182 + QA-005 | ~10j |
| 3 | EST-035 + EST-143 + UT parser/outliers | ~10j |
| 4 | EST-034 + QA-007 + integration send | ~10j |
| 5 | EST-222 + EST-224 | ~8j |
| 6 | M4 lifecycle (partage avec C) | ~4j |
| **Total** | | **~66j** |

### Equipe C — Concurrence + perf + PDF + E2E owner
| Phase | Tickets | Effort total |
|-------|---------|-------------|
| 0 | EST-044 + EST-045 + EST-032+029 + QA-002 | ~14j |
| 1 | EST-264 + EST-106 + QA-004 | ~16j |
| 2 | EST-161 + EST-162 + run E2E templates | ~10j |
| 3 | EST-201 + QA-006 | ~12j |
| 4 | EST-201 fin + run non-reg send + QA | ~6j |
| 5 | EST-036 + buffer QA | ~4j |
| 6 | M4 lifecycle (partage avec B) | ~4j |
| **Total** | | **~66j** |

> L'equipe A reste sur le chemin critique. Les equipes B et C portent explicitement l'automatisation tests et la stabilisation inter-phases.

---

## Timeline estimee (v2 avec stream qualite)

| Semaine | Delivery principal | Stream qualite (UT/E2E) |
|---------|--------------------|--------------------------|
| S1-S2 | Phase 0 / vague 0.1 | QA-001 start + smoke E2E socle |
| S3-S4 | Phase 0 / vague 0.2 | QA-002 (concurrence/seal) |
| S5-S6 | Phase 0 / vague 0.3 | Gate P0 + stabilization |
| S7-S8 | Phase 1 / vague 1.1 | UT editor core + perf benchmarks |
| S9-S10 | Phase 1 / vague 1.2 | E2E keyboard/bulk/undo |
| S11-S12 | Phase 1 / vague 1.3 | Gate P1 + regression pass |
| S13-S14 | Phase 2 / vague 2.1 | UT templates/suggestions |
| S15-S16 | Phase 2 / vague 2.2 | E2E templates + Gate P2 |
| S17-S18 | Phase 3 / vague 3.1 | UT CSV/PDF + smoke import |
| S19-S20 | Phase 3 / vague 3.2 | E2E price book + Gate P3 |
| S21-S22 | Phase 4 / vague 4.1 | E2E send-lite pre-integration |
| S23-S24 | Phase 4 / vague 4.2 | Gate P4 + release candidate |
| S25-S26 | Phase 5 / vague 5.1 | E2E timeline/diff |
| S27-S28 | Phase 5 / vague 5.2 | Gate P5 |
| S29-S30 | Phase 6 / vague 6.1 | Gate P6 |

> **MVP core (Phases 0-4) : ~24 semaines + 2 a 3 semaines de marge QA = ~26-27 semaines**
> **MVP complet (Phases 0-6) : ~30 semaines + 3 a 4 semaines de marge QA = ~33-34 semaines**

