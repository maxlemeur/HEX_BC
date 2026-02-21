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
| **M0**    | Fondations                   | EST-E01, EST-E02, EST-E03, EST-E04       | Stabiliser le socle : DX, moteur, securite, API. Inclut marge par tranches (EST-028) et sous-totaux FO/MO (EST-121) |
| **M1**    | Editeur + Performance        | EST-E05, EST-E06, EST-E07                | UI base, turbo editor, structure. Perf editeur 3000 lignes (EST-264 promu). Split MO atelier/chantier (EST-031) |
| **M2**    | Qualite + Intelligence       | EST-E08, EST-E09, EST-E10                | Gating qualite, suggestions, multi-fournisseurs (EST-030), import OPTIMA (EST-034) |
| **M3**    | Documents + Versioning       | EST-E11, EST-E12                         | Import/export PDF/DPGF/BDC 31 col, diff, changelog. Multi-devises reporte ici (EST-027) |
| **M4**    | Lifecycle + Observabilite    | EST-E13, EST-E14                         | Portail client, envoi email, tests, import Batigest/Onaya (EST-204 reporte) |

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
| **Securite & immutabilite**| RLS user+tenant, `guard_estimate_versions_readonly()`, transitions de statut, role checks                   | Concurrence optimiste (409), draft lock pessimiste, seal hash SHA-256                                |
| **Editeur**                | Table DnD (dnd-kit), sections/lignes, categories, roles MO, suggestion rules, quality flags                 | Editeur avance, AID (EST-033), Type FO (EST-029), multi-fournisseurs (EST-030), perf 3000 lignes (EST-264) |
| **Import DPGF**            | Tables dpgf_imports/rows_raw/rows_mapped, mapping templates, mapping memory                                 | Import OPTIMA (EST-034), import Batigest/Onaya (EST-204), auto-detection formats, preview amelioree  |
| **Qualite**                | `computeEstimateQualityFlagsForItem()`, `countEstimateQualityFlags()`, 4 flags de base                     | Gating financier (EST-141 enrichi), scoring global, notifications, seuils configurables              |
| **Catalogue**              | Tables supplier_pricebook, material_indices, dpgf_catalogue_links, bulk RPC                                 | Comparaison 3 fournisseurs (EST-030), recherche full-text, historique prix, alerte variation          |
| **Export**                 | Print view (`print/page.tsx`)                                                                                | PDF serveur, Export DPGF + BDC 31 col (EST-202), streaming 3000+ lignes, templates personnalisables  |
| **Versioning**             | `duplicateEstimateVersion()`, DuplicateEstimateButton, version_number                                       | Comparaison diff entre versions, timeline, restauration                                              |
| **Multi-tenant**           | tenants, tenant_memberships, `current_tenant_id()`, `has_tenant_role()`, role checks                        | Feature flags par tenant, onboarding tenant, quotas                                                  |
| **Audit**                  | `audit_logs` table, `log_estimate_audit()` trigger, `snapshot_estimate_item_bulk_updates()`                 | Dashboard audit, recherche/filtrage, retention policy, export audit                                  |
| **DX & outillage**         | Vitest, ESLint, TypeScript strict, Tailwind CSS 4                                                           | Feature flags runtime, design system tokens, Storybook (optionnel), CI/CD enrichi                    |
