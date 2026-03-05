# User Stories V1 — Module Chiffrage

## Contexte

Les sprints **BC-001** a **BC-011** constituent le socle technique du module de chiffrage.
Ils couvrent : le schema de base de donnees (tables, RLS, triggers), le moteur de calcul
(`estimate-calculations.ts`), la couche API REST (12 route handlers), l'editeur de devis
avec drag-and-drop, le flux d'import DPGF, le catalogue fournisseur, la gestion multi-tenant
(tenants, roles, memberships) et 21 migrations incrementales.

La **V1** demarre sur ces fondations et vise a livrer un module de chiffrage complet,
fiable et performant. Ce document sert d'index pour les 14 epics qui structurent
la roadmap V1.

---

## Glossaire des roles

| Role       | Code interne | Description                                                    |
| ---------- | ------------ | -------------------------------------------------------------- |
| Chiffreur  | `engineer`   | Cree et edite les devis, gere les lignes, categories, MO/FO   |
| Admin      | `admin`      | Gere les tenants, les utilisateurs, les feature flags, la conf |
| Client     | `viewer`     | Consulte les devis envoyes via le portail client (lecture seule)|

---

## Roadmap — Milestones

| Milestone | Theme                        | Epics                                    | Objectif                                         |
| --------- | ---------------------------- | ---------------------------------------- | ------------------------------------------------ |
| **M0**    | Fondations                   | EST-E01, EST-E02, EST-E03, EST-E04       | Stabiliser le socle : DX, moteur, securite, API. Inclut marge par tranches (EST-028), sous-totaux FO/MO (EST-121), seal hash (EST-046) |
| **M1**    | Turbo Editor + Templates + Suggestions v1 | EST-E05, EST-E06, EST-E07, EST-E09*, EST-E10* | UI base, turbo editor, structure. Perf editeur 3000 lignes (EST-264). **Templates (EST-181/182) et suggestions v1 (EST-161/162) promus de M2 a M1** |
| **M2**    | Price Book + Send "lite" + Qualite | EST-E08, EST-E09, EST-E10, EST-E11*      | Gating qualite (EST-141), multi-fournisseurs (EST-030), import OPTIMA (EST-034). **PDF serveur (EST-201 promu de M3), CSV import price book (EST-035 new)** |
| **M3**    | Documents + Versioning       | EST-E11, EST-E12                         | Export DPGF/BDC 31 col, diff, changelog. Multi-devises reporte ici (EST-027) |
| **M4**    | Lifecycle + Rules + Observabilite | EST-E03*, EST-E08*, EST-E13, EST-E14 | Portail client, envoi email, tests. **Events append-only (EST-036 new), rules engine (EST-037 new)**, import Batigest/Onaya (EST-204) |
| **M5**    | Structure de prix BTP + Metres   | EST-E15, EST-E16, EST-E17, EST-E20   | Moteur de prix professionnel BTP (DS/FC/FG/B&A), ouvrages composes, carnet de metres, formules quantites, conformite PDF multi-TVA |
| **M6**    | Cycle de vie chantier            | EST-E18, EST-E19                     | Situations de travaux, avenants, retenue de garantie, DGD, lots techniques, sous-traitance |

> \* Epics marques avec `*` : seules certaines stories de l'epic sont dans ce milestone (promotions MVP). Voir le detail par epic.

---

## Plan de sequencement (3 equipes)

Le plan de sequencement detaille pour 3 equipes de developpement est disponible dans :
**[SEQUENCING-3-TEAMS.md](./SEQUENCING-3-TEAMS.md)**

Il contient :
- L'affectation des tickets aux 3 equipes (A, B, C) par vague
- Les dependances et le graphe critique
- Les tags couche par ticket (`[DB]`, `[Back]`, `[Front]`)
- La timeline estimee (~24 semaines MVP core, ~30 semaines complet)

---

## Index execution par ticket (EST-xxx)

Pour le suivi quotidien dev/PM, les tickets explicites sont maintenant disponibles ici :
**[tickets/README.md](./tickets/README.md)**

Convention :
- Les fichiers `EST-E..` restent la source macro (epics, vision, scope complet).
- Les fichiers `tickets/EST-xxx.md` sont la vue execution (owner, dependances, done, liens PR).

---

## Index des epics

| Code      | Nom                                | Milestone | Priorite | Fichier                                                          |
| --------- | ---------------------------------- | --------- | -------- | ---------------------------------------------------------------- |
| EST-E01   | Foundations & DX                   | M0        | P0       | [EST-E01-foundations-dx.md](./EST-E01-foundations-dx.md)           |
| EST-E02   | DB Engine (calculs, contraintes)   | M0        | P0       | [EST-E02-db-engine.md](./EST-E02-db-engine.md)                   |
| EST-E03   | Security & Immutability            | M0        | P0       | [EST-E03-security-immutability.md](./EST-E03-security-immutability.md) |
| EST-E04   | API (Route Handlers + Zod)         | M0        | P1       | [EST-E04-api.md](./EST-E04-api.md)                               |
| EST-E05   | UI Base (ecrans)                   | M1        | P1       | [EST-E05-ui-base.md](./EST-E05-ui-base.md)                       |
| EST-E06   | Turbo Editor (tableur + bulk)      | M1        | P0       | [EST-E06-turbo-editor.md](./EST-E06-turbo-editor.md)             |
| EST-E07   | Structure (chapitres/lignes)       | M1        | P1       | [EST-E07-structure.md](./EST-E07-structure.md)                   |
| EST-E08   | Qualite (anomalies) + gating       | M2        | P1       | [EST-E08-quality-gating.md](./EST-E08-quality-gating.md)         |
| EST-E09   | Aide a la saisie (suggestions)     | M2        | P1       | [EST-E09-suggestions.md](./EST-E09-suggestions.md)               |
| EST-E10   | Reuse: templates, assemblages      | M2        | P1       | [EST-E10-reuse-templates.md](./EST-E10-reuse-templates.md)       |
| EST-E11   | Imports/Exports + documents        | M3        | P1       | [EST-E11-imports-exports.md](./EST-E11-imports-exports.md)       |
| EST-E12   | Versioning: diff, changelog        | M3        | P1       | [EST-E12-versioning.md](./EST-E12-versioning.md)                 |
| EST-E13   | Lifecycle client: send/portal      | M4        | P1       | [EST-E13-lifecycle-client.md](./EST-E13-lifecycle-client.md)     |
| EST-E14   | Observabilite, tests, performance  | M4        | P1       | [EST-E14-observability-tests.md](./EST-E14-observability-tests.md)|
| EST-E15   | Structure de prix BTP (DS/FC/FG/B&A) | M5     | P0       | [EST-E15-structure-prix-btp.md](./EST-E15-structure-prix-btp.md) |
| EST-E16   | Ouvrages composes & bibliotheque de prix | M5  | P0       | [EST-E16-ouvrages-bibliotheque.md](./EST-E16-ouvrages-bibliotheque.md) |
| EST-E17   | Metres & formules de calcul        | M5        | P0       | [EST-E17-metres-formules.md](./EST-E17-metres-formules.md)       |
| EST-E18   | Situations de travaux & avenants   | M6        | P0       | [EST-E18-situations-avenants.md](./EST-E18-situations-avenants.md) |
| EST-E19   | Lots, sous-traitance & consultations | M6      | P1       | [EST-E19-lots-sous-traitance.md](./EST-E19-lots-sous-traitance.md) |
| EST-E20   | Conformite reglementaire & PDF pro | M5        | P1       | [EST-E20-conformite-pdf-pro.md](./EST-E20-conformite-pdf-pro.md) |

---

## Conventions

### Format d'une story

Chaque epic est documente dans un fichier Markdown suivant cette structure :

```
# EST-Exx — [Nom Epic]
> Milestone: Mx | Priorite: Px | Statut: A faire

## Objectif
[2-3 phrases]

## Ce qui existe deja
[References au code existant avec chemins et noms de fonctions]

---

## EST-xxx — [Titre story]
**Priorite:** Px | **Effort:** S/M/L

### User Story
> En tant que [role], je veux [action], afin de [benefice].

### Criteres d'acceptation
- [ ] ...

### Notes techniques
- Fichiers a creer/modifier : `...`
- Reutiliser : `...`
- Dependances : EST-xxx
```

### Legendes

**Priorites :**

| Code | Signification                                                              |
| ---- | -------------------------------------------------------------------------- |
| P0   | Bloquant — doit etre livre dans le milestone courant                       |
| P1   | Important — necessaire pour la completude du milestone                     |
| P2   | Souhaitable — peut etre decale au milestone suivant sans impact critique   |

**Effort :**

| Code | Signification                                                      |
| ---- | ------------------------------------------------------------------ |
| S    | Small — 1 a 2 jours dev, changements localises                    |
| M    | Medium — 3 a 5 jours dev, touche plusieurs fichiers/couches       |
| L    | Large — 5+ jours dev, architecture nouvelle ou refactoring majeur  |

---

## Delta : existant (BC-xxx) vs. restant (V1)

Ce tableau synthetise les fonctionnalites deja livrees par les sprints BC et ce qui reste
a construire dans la roadmap V1.

| Domaine                    | Deja fait (BC-xxx)                                                                                          | Reste a faire (V1)                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Schema & migrations**    | 21 migrations (001-021), tables estimate_*, tenants, audit_logs, dpgf_*, catalogue                          | Feature flags, draft_locks, discount cascade, seal_hash, margin_tiers, supply_types, labor split, AID column |
| **Moteur de calcul**       | `computeEstimateLineValues()`, `computeEstimateTotals()`, overflow guards, banker's rounding                | Marge par tranches (EST-028), remise cascade + coeff global (EST-025), split MO atelier/chantier (EST-031), majoration temps (EST-032), invariants DB |
| **API REST**               | 12 route handlers, Zod validation, erreurs normalisees, bulk update/reorder RPCs                            | Streaming export, batch operations, OpenAPI doc, concurrence optimiste                               |
| **Securite & immutabilite**| RLS user+tenant, `guard_estimate_versions_readonly()`, transitions de statut, role checks                   | Concurrence optimiste (409), draft lock pessimiste, seal hash SHA-256, **events append-only (EST-036)** |
| **Editeur**                | Table DnD (dnd-kit), sections/lignes, categories, roles MO, suggestion rules, quality flags                 | Editeur avance, AID (EST-033), Type FO (EST-029), multi-fournisseurs (EST-030), perf 3000 lignes (EST-264) |
| **Import DPGF**            | Tables dpgf_imports/rows_raw/rows_mapped, mapping templates, mapping memory                                 | Import OPTIMA (EST-034), import Batigest/Onaya (EST-204), auto-detection formats, preview amelioree  |
| **Qualite**                | `computeEstimateQualityFlagsForItem()`, `countEstimateQualityFlags()`, 4 flags de base                     | Gating financier (EST-141 enrichi), scoring global, notifications, seuils configurables, **rules engine marge/remise (EST-037)** |
| **Catalogue**              | Tables supplier_pricebook, material_indices, dpgf_catalogue_links, bulk RPC                                 | Comparaison 3 fournisseurs (EST-030), recherche full-text, historique prix, alerte variation, **CSV import price book (EST-035)** |
| **Export**                 | Print view (`print/page.tsx`)                                                                                | PDF serveur, Export DPGF + BDC 31 col (EST-202), streaming 3000+ lignes, templates personnalisables  |
| **Versioning**             | `duplicateEstimateVersion()`, DuplicateEstimateButton, version_number                                       | Comparaison diff entre versions, timeline, restauration                                              |
| **Multi-tenant**           | tenants, tenant_memberships, `current_tenant_id()`, `has_tenant_role()`, role checks                        | Feature flags par tenant, onboarding tenant, quotas                                                  |
| **Audit**                  | `audit_logs` table, `log_estimate_audit()` trigger, `snapshot_estimate_item_bulk_updates()`                 | Dashboard audit, recherche/filtrage, retention policy, export audit                                  |
| **DX & outillage**         | Vitest, ESLint, TypeScript strict, Tailwind CSS 4                                                           | Feature flags runtime, design system tokens, Storybook (optionnel), CI/CD enrichi                    |

---

## Nouvelles stories (integration MVP "Game Changer")

| Code    | Nom                                    | Epic   | Milestone | Priorite | Effort |
| ------- | -------------------------------------- | ------ | --------- | -------- | ------ |
| EST-035 | Import CSV Price Book                  | EST-E11| M2        | P1       | M      |
| EST-036 | Events append-only                     | EST-E03| M4        | P2       | S      |
| EST-037 | Rules engine marge/remise + approbations| EST-E08| M4        | P2       | L      |

### Stories M5 — Structure de prix BTP + Metres

| Code    | Nom                                    | Epic   | Milestone | Priorite | Effort |
| ------- | -------------------------------------- | ------ | --------- | -------- | ------ |
| EST-301 | Decomposition DS/FC/FG/B&A             | EST-E15| M5        | P0       | L      |
| EST-302 | Coefficients rendement et pertes       | EST-E15| M5        | P1       | M      |
| EST-311 | Ouvrages composes (sous-detail prix)   | EST-E16| M5        | P0       | L      |
| EST-312 | Connexion Batiprix/UNTEC               | EST-E16| M5        | P1       | L      |
| EST-321 | Formules dans les quantites            | EST-E17| M5        | P0       | L      |
| EST-322 | Carnet de metres integre               | EST-E17| M5        | P0       | L      |
| EST-351 | Multi-TVA (20%/10%/5.5%) + recap       | EST-E20| M5        | P0       | M      |
| EST-352 | Mentions legales obligatoires          | EST-E20| M5        | P1       | S      |
| EST-353 | Page de garde et recapitulatif         | EST-E20| M5        | P1       | M      |
| EST-354 | Conditions generales et particulieres  | EST-E20| M5        | P2       | M      |
| EST-362 | Referentiel normes BTP (DTU, RE2020...)| EST-E20| M5        | P1       | M      |
| EST-363 | Ouvrages favoris et acces rapide       | EST-E16| M5        | P2       | S      |

### Stories M6 — Cycle de vie chantier

| Code    | Nom                                    | Epic   | Milestone | Priorite | Effort |
| ------- | -------------------------------------- | ------ | --------- | -------- | ------ |
| EST-331 | Situations de travaux                  | EST-E18| M6        | P0       | XL     |
| EST-332 | Avenants / travaux supplementaires     | EST-E18| M6        | P0       | L      |
| EST-333 | Retenue de garantie et cautions        | EST-E18| M6        | P1       | M      |
| EST-334 | Decompte General Definitif (DGD)       | EST-E18| M6        | P1       | L      |
| EST-341 | Lots techniques (allotissement)        | EST-E19| M6        | P0       | L      |
| EST-342 | Sous-traitance dans le devis           | EST-E19| M6        | P1       | M      |
| EST-343 | Consultation fournisseurs automatisee  | EST-E19| M6        | P2       | L      |
| EST-361 | Suivi budgetaire projet (prev. vs real.)| EST-E18| M6       | P1       | L      |

### Nice-to-have (non planifies)

Les themes suivants sont identifies mais ne necessitent pas de ticket immediat :
- Application mobile terrain (PWA/native pour metres sur chantier)
- Attestation CERFA TVA (generation auto formulaire 1301-SD) — sous-ticket de EST-351
- Planning previsionnel lie au devis (Gantt simplifie)
- GED chantier (PV reception, CR chantier, photos, OPR)
- Export comptable FEC (Sage/Cegid/EBP) — a creer quand D1 (EST-331) sera livre
- Revision de prix formules parametriques (index BTP) — a creer quand D1 sera livre
- ~~Analyse rentabilite previsionnel vs realise~~ → **EST-361** (ticket cree)
- Collaboration temps reel (multi-chiffreurs a la Google Docs) — tech spike a planifier

### Stories promues (changement de milestone)

| Code    | Nom                    | Avant      | Apres      | Raison                           |
| ------- | ---------------------- | ---------- | ---------- | -------------------------------- |
| EST-181 | Templates de devis     | M2 P1      | **M1 P1**  | Sprint 2 MVP = anti page blanche |
| EST-182 | Assemblages            | M2 P1      | **M1 P1**  | Sprint 2 MVP = assemblages reutilisables |
| EST-161 | Scoring suggestions    | M2 P1      | **M1 P1**  | Sprint 2 MVP = suggestions v1    |
| EST-162 | Bulk apply suggestions | M2 P1      | **M1 P1**  | Sprint 2 MVP = apply en masse    |
| EST-201 | PDF serveur            | M3 P0      | **M2 P0**  | Sprint 4 MVP = send "lite"       |
