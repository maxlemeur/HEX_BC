# MVP "Game Changer" — Analyse d'integration

> Ce document synthetise le mapping entre les 10 features du plan MVP et les user stories V1,
> les decisions d'implementation cles, et le sprint-by-sprint checklist.
> Ref: `MVP_game_changer_estimates_plan.md`

---

## 1. Mapping 10 features MVP → stories existantes

| # | Feature MVP | Sprint | Score | Stories | Couverture | Action |
|---|---|---|---|---|---|---|
| 5 | Turbo Editor | S1 | 19 | EST-101..106, EST-264 | EXCELLENT | Enrichir EST-101 (benchmark index, schema bulk, endpoint atomique) |
| 1 | Templates + Assemblies | S2 | 21 | EST-181..184 | EXCELLENT | Promouvoir M2→M1. Enrichir EST-181 (picker), EST-182 (drawer) |
| 6 | Suggestions v1 | S2 | 17 | EST-161..164 | EXCELLENT | Promouvoir EST-161/162 M2→M1. Enrichir EST-164 (stale 90j) |
| 2 | Price Book vivant | S3 | 15 | EST-164, EST-030 | PARTIEL | Creer EST-035 (CSV import). Enrichir EST-164 (stale badge 90j) |
| 9 | Send "lite" | S4 | 10 | EST-201, EST-141, EST-046 | BON | Promouvoir EST-201 M3→M2. Enrichir EST-141 (orchestration send) |
| 8 | Diff versions | S5 opt | 14 | EST-221..224 | EXCELLENT | Aucun changement (M3 = Sprint 5) |
| 10 | Tamper-evident | S6 opt | 8 | EST-046, EST-203 | BON | Creer EST-036 (events append-only). Enrichir EST-046 |
| 7 | Rules engine | Post-MVP | 12 | EST-141 (flags) | PARTIEL | Creer EST-037 (regles + approbations). M4 |
| 3 | Takeoff | Hors MVP | 12 | Aucune | ABSENT | Aucune action — hors scope |
| 4 | Guided Selling | Differe | 17 | Aucune | ABSENT | Aucune action — EST-082 (wizard) = precurseur |

---

## 2. Decisions d'implementation

### Recalc DB (`estimate_recalc_version()`) — NON, garder le recalc en JS

`computeEstimateLineValues()` et `computeEstimateTotals()` dans `estimate-calculations.ts` sont corrects, testes, avec banker's rounding et overflow guards. Dupliquer en PL/pgSQL = risque de divergence. Le pattern cible est : JS precompute → bulk DB avec totaux pre-calcules (necessite l'extension de `updateEstimateItemSchema`, voir Bloquant 2 dans EST-101).

### Index composite editeur — BENCHMARK D'ABORD

4 index pertinents existent deja sur `estimate_items`. Decision : `EXPLAIN ANALYZE` avec 3000 lignes avant de creer quoi que ce soit. Voir critere dans EST-101.

### Bibliotheque PDF — `@react-pdf/renderer` avec template dedie

`@react-pdf/renderer` utilise ses propres primitives et ne peut PAS reutiliser le HTML/Tailwind de `print/page.tsx`. Template PDF dedie, aligne visuellement. Alternative post-MVP : `puppeteer` + `@sparticuz/chromium` pour rendu pixel-perfect.

### Send "lite" = EST-201 + EST-141 uniquement

Sprint 4 se limite a : PDF generation → Storage → Gating → `draft→sent` + seal → Download link. PAS d'email (EST-241, M4), PAS de portail (EST-242, M4), PAS de signature (EST-243, M4).

### Seuil "prix stale" — 90 jours

Uniformise a 90 jours (MVP) au lieu de 6 mois (PRD). Configurable par feature flag `STALE_PRICE_DAYS`.

---

## 3. Pre-requis bloquants et problemes majeurs

### BLOQUANT 1 : Machine a etats non verrouillee
`patchEstimateStatus()` fait un UPDATE direct sans valider l'ordre des transitions. **Resolu dans** EST-046 (criteres machine a etats ajoutes).

### BLOQUANT 2 : Schema bulk n'accepte pas les champs calcules
`updateEstimateItemSchema` ne contient pas les champs calcules (`pu_ht_cents`, etc.). **Resolu dans** EST-101 (critere extension schema bulk ajoute).

### MAJEUR 3 : Totaux version non transactionnels
`setTimeout` deferred dans `page.tsx:834`. **Resolu dans** EST-101 (critere endpoint atomique ajoute).

### MAJEUR 4 : Index a benchmarker, pas a creer en aveugle
4 index existent deja. **Resolu dans** EST-101 (critere benchmark `EXPLAIN ANALYZE` ajoute).

### MAJEUR 5 : Derive vocabulaire `sort_order` vs `position`
**Corrige** dans EST-E10 : toutes les occurrences de `sort_order` remplacees par `position`.

### MAJEUR 6 : Strategie PDF — template dedie
**Corrige** dans EST-201 : retrait mention reutilisation HTML, ajout template `@react-pdf/renderer` dedie.

### Coherence : seuil stale 90j vs 6 mois
**Corrige** dans EST-164 et EST-141 : uniformise a 90 jours, configurable par feature flag.

---

## 4. Sprint-by-sprint checklist

### Sprint 1 — Turbo Editor (M1)
- [ ] EST-101 : Navigation clavier + benchmark index + schema bulk + endpoint atomique
- [ ] EST-102 : Edition inline rapide
- [ ] EST-103 : Multi-selection et actions groupees
- [ ] EST-104 : Copier/Coller depuis Excel
- [ ] EST-105 : Auto-save debounce
- [ ] EST-106 : Undo/Redo global
- [ ] EST-264 : Performance editeur 3000 lignes

### Sprint 2 — Templates + Suggestions v1 (M1)
- [ ] EST-181 : Templates de devis (promu M1) — picker creation, instantiate API
- [ ] EST-182 : Assemblages reutilisables (promu M1) — drawer editeur, insert API
- [ ] EST-161 : Scoring et classement suggestions (promu M1)
- [ ] EST-162 : Bulk apply suggestions (promu M1)

### Sprint 3 — Price Book (M2)
- [ ] EST-035 : Import CSV Price Book (NEW)
- [ ] EST-164 : Suggestions catalogue (stale 90j, badge, filtre)
- [ ] EST-030 : Comparaison multi-fournisseurs

### Sprint 4 — Send "lite" (M2)
- [ ] EST-201 : Generation PDF serveur (promu M2) — template `@react-pdf/renderer` dedie
- [ ] EST-141 : Gating envoi — orchestration send complete (PDF + Storage + seal)
- [ ] EST-046 : Seal hash + machine a etats (M0, pre-requis)

### Sprint 5 (optionnel) — Diff versions (M3)
- [ ] EST-221..224 : Diff entre versions

### Sprint 6 (optionnel) — Tamper-evident + Rules (M4)
- [ ] EST-036 : Events append-only (NEW)
- [ ] EST-037 : Rules engine marge/remise + approbations (NEW)

---

## 5. Scope revise des milestones

| Milestone | Theme | Sprints MVP | Stories cles |
|-----------|-------|-------------|-------------|
| **M0** | Fondations | Pre-MVP | EST-006, 007, 026, 028, 029, 031, 032, 044, 045, 046, 121 |
| **M1** | Turbo Editor + Templates + Suggestions v1 | Sprint 1 + 2 | EST-101..106, 264, 081..084, 122..124, 033, **181, 182**, **161, 162** |
| **M2** | Price Book + Send "lite" + Qualite | Sprint 3 + 4 | EST-141, 142, 143, 164, 030, **201**, **035 (new)**, 034 |
| **M3** | Documents + Diff | Sprint 5 opt | EST-202, 203, 204, 221..224, 025, 027 |
| **M4** | Lifecycle + Rules + Tamper-evident | Sprint 6 opt + post-MVP | EST-241..245, 261..265, **036 (new)**, **037 (new)** |
