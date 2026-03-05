# Analyse complete HEX_BC — Fonctionnalites manquantes vs logiciels de chiffrage BTP

> Document consolide — 2026-03-05
> Sources : analyse comparative codebase, plan d'epics, index tickets

---

# PARTIE 1 — Analyse des fonctionnalites manquantes

## Contexte

HEX_BC est un logiciel de chiffrage BTP web (Next.js 16 + Supabase) avec un editeur performant, des templates/assemblages, du versioning, de l'import DPGF, du takeoff IA, et un bon socle technique (multi-tenant, audit, quality gating). L'objectif est d'identifier les fonctionnalites metier importantes absentes par rapport aux logiciels references du marche (DeviSOC, Batigest, Batiprix, ProDevis, Onaya, EBP Batiment).

---

## Fonctionnalites deja couvertes (resume)

Editeur virtualise 3000+ lignes | Copier-coller Excel | Auto-save | Hierarchie sections/lignes avec sous-totaux | Numerotation auto | Templates + assemblages reutilisables | Suggestions IA depuis catalogue | Quality gating a l'envoi | Outlier detection | PDF serveur | DPGF round-trip | Versioning avec diff visuel + timeline + changelog | Variantes/scenarios | Rules engine marge/remise | Takeoff IA (Gemini) | Supplier pricebook | Multi-tenant RBAC | Audit trail | Material indices | Currency rates | Labor roles | Margin tiers | Analytics KPIs

## Fonctionnalites planifiees (tickets existants, non livrees)

Navigation clavier (EST-101) | Inline editing rapide (EST-102) | Multi-selection bulk (EST-103) | Undo/redo (EST-106) | Hierarchie N niveaux (EST-122/125) | Envoi email (EST-241) | Portail client (EST-242) | Signature (EST-243) | Suivi auto (EST-244) | Negociation (EST-245) | Split MO atelier/chantier (EST-031) | Double remise cascade (EST-025) | Multi-devises (EST-027) | Import depuis autre devis (EST-184)

---

## FONCTIONNALITES MANQUANTES (aucun ticket existant)

### CRITIQUES - Bloquants pour la credibilite BTP professionnelle

| Ref | Feature | Description | Pourquoi | Concurrents |
|-----|---------|-------------|----------|-------------|
| **H1** | Structure de prix DS/FC/FG/B&A | Decomposition : Debourses Secs + Frais Chantier + Frais Generaux + Benefice & Aleas = PV HT. Actuellement un seul `margin_multiplier`. | Methode standard de formation des prix BTP. Un coefficient unique est insuffisant pour les entreprises structurees. | DeviSOC, Batiprix, Onaya, ProDevis, EBP |
| **A1** | Ouvrages composes (sous-detail de prix) | Fiche prix decomposant un PU en composants elementaires (materiaux, MO, materiel, sous-traitance) avec quantites et coefficients de perte. Les `estimate_assemblies` actuels ne produisent pas un sous-detail au sens BTP. | Fondement du chiffrage BTP serieux. Justification des PU aupres du MOE. Base de la revision de prix. | Batiprix (coeur), DeviSOC, Batigest, ProDevis, Onaya |
| **B2** | Formules dans les quantites | Saisie de formules (`12.5 * 3.2 - 2*(1.2*2.1)`) dans le champ quantite. Variables locales, references croisees. Actuellement `quantity` = simple numeric. | Fonctionnalite de base de TOUT logiciel de chiffrage. Son absence est un frein majeur a l'adoption. | DeviSOC, Batigest, ProDevis, Onaya, EBP, Quick Devis - TOUS |
| **B1** | Carnet de metres integre | Feuilles de metres structurees (L x l x h, deductions, par piece/zone/etage) alimentant automatiquement les quantites du devis. Tracabilite du calcul. | MOE exigent le detail des metres. Le takeoff IA ne remplace pas la justification detaillee. Obligatoire marches publics. | DeviSOC, Metres, Onaya, Quick Devis, EBP |
| **D1** | Situations de travaux | Transformation devis accepte en suivi d'execution : situations mensuelles avec % avancement par poste, calcul montant a facturer, generation attachement + decompte. | Prolongement NATUREL du devis. Obligatoire marches publics. Un logiciel BTP sans situations = "demi-produit". | DeviSOC, Batigest, Onaya, EBP, ProDevis - TOUS |
| **E1** | Gestion des avenants | Modifications formalisees post-acceptation : ajout postes, modification quantites. Numerotation, workflow acceptation, integration dans les situations. Distinct des "variantes" actuelles. | Incontournable marches publics. Les TS (travaux supplementaires) sont la norme BTP. | DeviSOC, Batigest, Onaya, EBP, ProDevis |
| **K1** | Multi-TVA (taux reduits renovation) | Application automatique 20%/10%/5.5% selon nature travaux. Recapitulatif multi-TVA dans le PDF. Le schema le supporte (tax_rate_bp par ligne) mais pas de logique metier ni de recap. | Obligation legale. Un meme devis renovation a souvent 2-3 taux differents. | TOUS les logiciels BTP francais |

### IMPORTANTES - Necessaires pour la completude fonctionnelle

| Ref | Feature | Description | Concurrents |
|-----|---------|-------------|-------------|
| **A3** | Rendements et coefficients de perte | Coeff perte materiaux (+10% platre, +15% carrelage) + rendements MO (m2/jour). Lie a A1 (ouvrages composes). | Batiprix, DeviSOC, ProDevis, Onaya |
| **A2** | Connexion bases de prix (Batiprix/UNTEC) | Import ouvrages depuis bases reference, comparaison prix marche, alertes ecart. | Batiprix (natif), DeviSOC, Batigest, Onaya, EBP |
| **C1** | Gestion des lots (allotissement) | Lots techniques (GO, Charpente, Plomberie...), recapitulatif par lot, extraction lot pour sous-traitant, consolidation TCE. | DeviSOC, Batigest, Onaya, ProDevis |
| **C2** | Sous-traitance dans le devis | Flag "en propre" vs "sous-traite" par ligne, prix sous-traitant distinct, coeff marge sous-traitance, generation consultations. | DeviSOC, Batigest, Onaya, EBP |
| **D2** | DGD (Decompte General Definitif) | Consolidation situations + avenants + retenues + penalites = solde final. Obligatoire marches publics. | DeviSOC, Batigest, Onaya, EBP |
| **G1** | Export comptable (FEC) | Export Sage/Cegid/EBP Compta, mapping plan comptable BTP (411, 4181, 701, 4457). | Batigest (Sage), EBP (natif), Onaya, DeviSOC |
| **G2** | Retenue de garantie | 5% TTC, retenue sur chaque situation, caution substitution, liberation a 1 an. Obligatoire marches publics. | DeviSOC, Batigest, Onaya, EBP |
| **J1** | Recapitulatif detaille + page de garde | Page de garde : recap par lot, decomposition FO/MO/ST, graphiques, CGV, mentions legales (assurance decennale, SIRET, RCS). | TOUS |
| **J3** | Revision de prix (formules parametriques) | Formules index BTP (BT01, TP...) appliquees aux situations. `material_indices` existe deja, manque la formule et le calcul. | DeviSOC, Onaya, Batigest, EBP |
| **K3** | Mentions legales obligatoires | Assurance decennale, garantie parfait achevement, conditions paiement, penalites retard, droit retractation, mention RGE. | TOUS les logiciels BTP francais |
| **L1** | Conditions generales/particulieres | Bibliotheque de clauses types rattachables au devis. Clauses conditionnelles. | DeviSOC, Batigest, ProDevis, Onaya |
| **I1** | Collaboration temps reel | Multi-chiffreurs simultanes sur un devis (a la Google Docs). Differenciateur SaaS vs desktop. | Peu de concurrents l'ont = opportunite |
| **F1** | Consultation fournisseurs automatisee | Extraction materiaux du devis, envoi consultations email, grille comparaison retours. | Batigest, Onaya, DeviSOC (partiel) |
| **J2** | Analyse rentabilite chantier | Previsionnel (devis) vs realise (situations + depenses). Ecarts de marge par poste. | Batigest, Onaya, EBP, DeviSOC |

### NICE-TO-HAVE - Valeur ajoutee, non bloquant

| Ref | Feature | Description |
|-----|---------|-------------|
| **I2** | Application mobile terrain | PWA/native pour metres sur chantier, photos, GPS, scan plans |
| **K2** | Attestation CERFA TVA | Generation auto du formulaire 1301-SD pour TVA reduite |
| **L2** | Planning previsionnel | Gantt simplifie depuis la structure du devis (lots = taches) |
| **L3** | GED chantier | PV reception, CR chantier, photos, OPR rattaches a l'affaire |

---

## Ordonnancement recommande

### Vague 1 - Pre-requis structurants (refonte du moteur de prix)
1. **H1** Structure de prix DS/FC/FG/B&A (refonte `margin_multiplier` -> decomposition multi-couches)
2. **B2** Formules dans les quantites (enrichir `quantity` avec `quantity_formula`)
3. **K1** Multi-TVA + recapitulatif PDF

### Vague 2 - Coeur metier chiffrage
4. **A1** Ouvrages composes (evolution des `estimate_assemblies` -> sous-detail de prix)
5. **B1** Carnet de metres integre (complementaire au takeoff IA)
6. **A2** Connexion Batiprix/UNTEC

### Vague 3 - Cycle de vie chantier
7. **D1** Situations de travaux (nouveau module)
8. **E1** Avenants (extension du versioning existant)
9. **C1/C2** Lots + sous-traitance

### Vague 4 - Completude et pilotage
10. **J3** Revision de prix (s'appuie sur `material_indices`)
11. **G1** Export comptable
12. **J2** Analyse rentabilite previsionnel vs realise

---

## Plan de creation des epics et tickets

### Conventions de nommage
- Epics: EST-E15 a EST-E20 (suite de EST-E14)
- Tickets: EST-301+ (nouveau range pour eviter collision avec EST-265)
- Milestones: M5 (Structure de prix + Metres) et M6 (Cycle de vie chantier)

### Nouveaux milestones

| Milestone | Theme | Epics | Objectif |
|-----------|-------|-------|----------|
| **M5** | Structure de prix BTP + Metres | EST-E15, EST-E16, EST-E17, EST-E20 | Moteur de prix professionnel BTP, ouvrages composes, carnet de metres, conformite PDF |
| **M6** | Cycle de vie chantier | EST-E18, EST-E19 | Situations de travaux, avenants, lots, sous-traitance |

### Fichiers EPICS a creer (6 fichiers)

#### 1. `docs/user_story/EST-E15-structure-prix-btp.md`
**EST-E15 — Structure de prix BTP (DS/FC/FG/B&A)**
> Milestone: M5 | Priorite: P0

Objectif: Remplacer le coefficient de marge unique (`margin_multiplier`) par la decomposition standard BTP : Debourses Secs -> Frais de Chantier -> Frais Generaux -> Benefice & Aleas = Prix de Vente HT. Integrer les coefficients de rendement et de perte.

Tickets:
- **EST-301** — Decomposition DS/FC/FG/B&A dans le moteur de calcul (P0, L)
- **EST-302** — Coefficients de rendement et pertes materiaux (P1, M)

#### 2. `docs/user_story/EST-E16-ouvrages-bibliotheque.md`
**EST-E16 — Ouvrages composes & bibliotheque de prix**
> Milestone: M5 | Priorite: P0

Objectif: Transformer les assemblages existants en ouvrages composes au sens BTP (sous-detail de prix avec decomposition materiaux/MO/materiel/ST). Connecter aux bases de prix reference (Batiprix).

Tickets:
- **EST-311** — Ouvrages composes avec sous-detail de prix (P0, L)
- **EST-312** — Connexion bases de prix Batiprix/UNTEC (P1, L)

#### 3. `docs/user_story/EST-E17-metres-formules.md`
**EST-E17 — Metres & formules de calcul**
> Milestone: M5 | Priorite: P0

Objectif: Ajouter les formules de calcul dans les quantites et un carnet de metres integre pour justifier et tracer les calculs de quantites.

Tickets:
- **EST-321** — Formules dans les quantites (P0, L)
- **EST-322** — Carnet de metres integre (P0, L)

#### 4. `docs/user_story/EST-E18-situations-avenants.md`
**EST-E18 — Situations de travaux & avenants**
> Milestone: M6 | Priorite: P0

Objectif: Transformer un devis accepte en suivi d'execution avec situations mensuelles, avenants numerotes, retenue de garantie et DGD.

Tickets:
- **EST-331** — Situations de travaux (facturation a l'avancement) (P0, XL)
- **EST-332** — Gestion des avenants / travaux supplementaires (P0, L)
- **EST-333** — Retenue de garantie et cautions (P1, M)
- **EST-334** — Decompte General Definitif (DGD) (P1, L)

#### 5. `docs/user_story/EST-E19-lots-sous-traitance.md`
**EST-E19 — Lots, sous-traitance & consultation fournisseurs**
> Milestone: M6 | Priorite: P1

Objectif: Structurer les devis par lots techniques (allotissement), gerer la sous-traitance dans le chiffrage, et automatiser les consultations fournisseurs.

Tickets:
- **EST-341** — Gestion des lots techniques (allotissement) (P0, L)
- **EST-342** — Sous-traitance dans le devis (P1, M)
- **EST-343** — Consultation fournisseurs automatisee (P2, L)

#### 6. `docs/user_story/EST-E20-conformite-pdf-pro.md`
**EST-E20 — Conformite reglementaire & PDF professionnel**
> Milestone: M5 | Priorite: P1

Objectif: Multi-TVA avec taux reduits, mentions legales obligatoires, page de garde professionnelle, conditions generales.

Tickets:
- **EST-351** — Multi-TVA (20%/10%/5.5%) avec recapitulatif (P0, M)
- **EST-352** — Mentions legales obligatoires sur devis (P1, S)
- **EST-353** — Page de garde et recapitulatif detaille (P1, M)
- **EST-354** — Conditions generales et particulieres (P2, M)

### Themes supplementaires (Nice-to-have, pas de ticket immediat)

Ces features sont notees dans l'analyse mais ne necessitent pas de ticket maintenant :
- Application mobile terrain (I2)
- Attestation CERFA TVA (K2) — sous-ticket de EST-351
- Planning previsionnel lie au devis (L2)
- GED chantier (L3)
- Export comptable FEC (G1) — a creer quand D1 sera livre
- Revision de prix formules parametriques (J3) — a creer quand D1 sera livre
- Analyse rentabilite previsionnel vs realise (J2) — a creer quand D1 sera livre
- Collaboration temps reel (I1) — tech spike a planifier

---
---

# PARTIE 2 — Roadmap mise a jour (README.md)

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

---

## Index des epics

| Code      | Nom                                | Milestone | Priorite |
| --------- | ---------------------------------- | --------- | -------- |
| EST-E01   | Foundations & DX                   | M0        | P0       |
| EST-E02   | DB Engine (calculs, contraintes)   | M0        | P0       |
| EST-E03   | Security & Immutability            | M0        | P0       |
| EST-E04   | API (Route Handlers + Zod)         | M0        | P1       |
| EST-E05   | UI Base (ecrans)                   | M1        | P1       |
| EST-E06   | Turbo Editor (tableur + bulk)      | M1        | P0       |
| EST-E07   | Structure (chapitres/lignes)       | M1        | P1       |
| EST-E08   | Qualite (anomalies) + gating       | M2        | P1       |
| EST-E09   | Aide a la saisie (suggestions)     | M2        | P1       |
| EST-E10   | Reuse: templates, assemblages      | M2        | P1       |
| EST-E11   | Imports/Exports + documents        | M3        | P1       |
| EST-E12   | Versioning: diff, changelog        | M3        | P1       |
| EST-E13   | Lifecycle client: send/portal      | M4        | P1       |
| EST-E14   | Observabilite, tests, performance  | M4        | P1       |
| EST-E15   | Structure de prix BTP (DS/FC/FG/B&A) | M5     | P0       |
| EST-E16   | Ouvrages composes & bibliotheque de prix | M5  | P0       |
| EST-E17   | Metres & formules de calcul        | M5        | P0       |
| EST-E18   | Situations de travaux & avenants   | M6        | P0       |
| EST-E19   | Lots, sous-traitance & consultations | M6      | P1       |
| EST-E20   | Conformite reglementaire & PDF pro | M5        | P1       |

---

## Conventions

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
| EST-364 | Remises multi-niveaux (devis/section/ligne)| EST-E15| M5     | P1       | M      |

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
- ~~Analyse rentabilite previsionnel vs realise~~ -> **EST-361** (ticket cree)
- Collaboration temps reel (multi-chiffreurs a la Google Docs) — tech spike a planifier

---
---

# PARTIE 3 — Index complet des tickets (86 tickets)

## Couverture

- Tickets total: **86**
- Tickets presents dans le sequencing v2: **35**
- Tickets hors sequencing v2 (backlog): **30**
- Tickets M5/M6 (nouvelles stories): **21**

## Tickets

| Ticket | Titre | Sequencing v2 | Phase/Vague | Equipe | Effort | Milestone | Epic source |
|--------|-------|---------------|-------------|--------|--------|-----------|-------------|
| EST-006 | Feature flags runtime | Oui | 0/0.1 | A | M | M0 | EST-E01 |
| EST-007 | Design system tokens & component kit | Non | - | Backlog | M | M0 | EST-E01 |
| EST-025 | Double discount (remise en cascade) | Non | - | Backlog | M | M0 | EST-E02 |
| EST-026 | Rounding invariant enforcement | Oui | 0/0.3 | B | S | M0 | EST-E02 |
| EST-027 | Multi-currency support | Non | - | Backlog | L | M3 | EST-E02 |
| EST-028 | Marge par tranches de valeur projet | Oui | 0/0.1 | B | M | M0 | EST-E02 |
| EST-029 | Classification Type FO (type de fourniture) | Oui | 0/0.3 | C | S | M0 | EST-E02 |
| EST-030 | Comparaison multi-fournisseurs par article | Oui | 3/3.2 | A | L | M2 | EST-E09 |
| EST-031 | Split MO Atelier / Chantier | Oui | 0/0.2 | A | M | M0 | EST-E02 |
| EST-032 | Coefficient de majoration temps de pose | Oui | 0/0.3 | C | S | M0 | EST-E02 |
| EST-033 | Identifiant structure AID | Non | - | Backlog | S | M1 | EST-E07 |
| EST-034 | Import format OPTIMA | Oui | 4/4.1 | B | M | M2 | EST-E11 |
| EST-035 | Import CSV Price Book | Oui | 3/3.1 | B | M | M2 | EST-E11 |
| EST-036 | Events append-only (estimate_version_events) | Oui | 5/5.1 | C | S | M3 | EST-E03 |
| EST-037 | Rules engine : garde-fous marge/remise + approbations | Oui | 6/6.1 | A | L | M4 | EST-E08 |
| EST-044 | Optimistic concurrency control | Oui | 0/0.1 | C | M | M0 | EST-E03 |
| EST-045 | Draft lock (pessimistic) | Oui | 0/0.2 | C | M | M0 | EST-E03 |
| EST-046 | Immutability seal on sent versions | Oui | 0/0.2 | B | S | M0 | EST-E03 |
| EST-064 | Streaming export endpoint | Non | - | Backlog | M | M0 | EST-E04 |
| EST-065 | OpenAPI/Swagger documentation | Non | - | Backlog | M | M0 | EST-E04 |
| EST-066 | Batch operations API | Non | - | Backlog | L | M0 | EST-E04 |
| EST-081 | Liste devis amelioree | Non | - | Backlog | M | M1 | EST-E05 |
| EST-082 | Creation guidee (wizard) | Non | - | Backlog | M | M1 | EST-E05 |
| EST-083 | Dashboard recapitulatif | Non | - | Backlog | M | M1 | EST-E05 |
| EST-084 | Mode impression ameliore | Non | - | Backlog | M | M1 | EST-E05 |
| EST-101 | Navigation clavier tableur | Oui | 1/1.1 | A | L | M1 | EST-E06 |
| EST-102 | Edition inline rapide | Oui | 1/1.2 | A | M | M1 | EST-E06 |
| EST-103 | Multi-selection et actions groupees | Oui | 1/1.2 | B | L | M1 | EST-E06 |
| EST-104 | Copier/Coller depuis Excel | Oui | 1/1.3 | A | L | M1 | EST-E06 |
| EST-105 | Auto-save debounce | Oui | 1/1.1 | B | M | M1 | EST-E06 |
| EST-106 | Undo/Redo global | Oui | 1/1.2 | C | L | M1 | EST-E06 |
| EST-121 | Sous-totaux par section | Oui | 0/0.3 | A | M | M0 | EST-E07 |
| EST-122 | Sections imbriquees (2 niveaux) | Non | - | Backlog | L | M1 | EST-E07 |
| EST-123 | Conversion section / ligne | Non | - | Backlog | S | M1 | EST-E07 |
| EST-124 | Numerotation automatique | Non | - | Backlog | S | M1 | EST-E07 |
| EST-141 | Gating envoi (sent) | Oui | 4/4.1 | A | M | M2 | EST-E08 |
| EST-142 | Checklist completude | Oui | 4/4.2 | A | M | M2 | EST-E08 |
| EST-143 | Detection d'outliers | Oui | 3/3.2 | B | M | M2 | EST-E08 |
| EST-144 | Historique des anomalies | Non | - | Backlog | S | M2 | EST-E08 |
| EST-161 | Scoring et classement des suggestions | Oui | 2/2.1 | C | M | M1 | EST-E09 |
| EST-162 | Application en masse des suggestions | Oui | 2/2.2 | C | M | M1 | EST-E09 |
| EST-163 | Apprentissage des corrections | Non | - | Backlog | L | M2 | EST-E09 |
| EST-164 | Suggestions depuis le catalogue | Oui | 3/3.1 | A | M | M2 | EST-E09 |
| EST-181 | Templates de devis | Oui | 2/2.1 | A | L | M1 | EST-E10 |
| EST-182 | Assemblages reutilisables | Oui | 2/2.1 | B | L | M1 | EST-E10 |
| EST-183 | Duplication partielle (section) | Non | - | Backlog | M | M1 | EST-E10 |
| EST-184 | Import depuis un autre devis | Non | - | Backlog | M | M1 | EST-E10 |
| EST-201 | Generation PDF serveur | Oui | 3/3.1 | C | L | M2 | EST-E11 |
| EST-202 | Export DPGF aller-retour | Non | - | Backlog | M | M3 | EST-E11 |
| EST-203 | Hash d'integrite document | Non | - | Backlog | S | M3 | EST-E11 |
| EST-204 | Import multi-format | Non | - | Backlog | L | M3 | EST-E11 |
| EST-221 | Diff visuel entre versions | Oui | 5/5.1 | A | L | M3 | EST-E12 |
| EST-222 | Timeline des versions | Oui | 5/5.1 | B | M | M3 | EST-E12 |
| EST-223 | Scenarios alternatifs | Oui | 5/5.2 | A | M | M3 | EST-E12 |
| EST-224 | Changelog automatique | Oui | 5/5.2 | B | M | M3 | EST-E12 |
| EST-241 | Envoi par email | Non | - | Backlog | L | M4 | EST-E13 |
| EST-242 | Portail client | Non | - | Backlog | L | M4 | EST-E13 |
| EST-243 | Acceptation et signature | Non | - | Backlog | M | M4 | EST-E13 |
| EST-244 | Relance automatique | Non | - | Backlog | M | M4 | EST-E13 |
| EST-245 | Negociation (contre-proposition) | Non | - | Backlog | L | M4 | EST-E13 |
| EST-261 | Tests RLS end-to-end | Non | - | Backlog | L | M4 | EST-E14 |
| EST-262 | Tests E2E parcours critique | Non | - | Backlog | L | M4 | EST-E14 |
| EST-263 | Metriques et monitoring | Non | - | Backlog | M | M4 | EST-E14 |
| EST-264 | Optimisation performance editeur | Oui | 1/1.1 | C | L | M1 | EST-E14 |
| EST-265 | Tests de charge API | Non | - | Backlog | M | M4 | EST-E14 |
| EST-301 | Decomposition DS/FC/FG/B&A | Non | M5/V1 | Backlog | L | M5 | EST-E15 |
| EST-302 | Coefficients rendement et pertes | Non | M5/V1 | Backlog | M | M5 | EST-E15 |
| EST-311 | Ouvrages composes (sous-detail prix) | Non | M5/V2 | Backlog | L | M5 | EST-E16 |
| EST-312 | Connexion Batiprix/UNTEC | Non | M5/V2 | Backlog | L | M5 | EST-E16 |
| EST-321 | Formules dans les quantites | Non | M5/V1 | Backlog | L | M5 | EST-E17 |
| EST-322 | Carnet de metres integre | Non | M5/V2 | Backlog | L | M5 | EST-E17 |
| EST-331 | Situations de travaux | Non | M6/V3 | Backlog | XL | M6 | EST-E18 |
| EST-332 | Avenants / travaux supplementaires | Non | M6/V3 | Backlog | L | M6 | EST-E18 |
| EST-333 | Retenue de garantie et cautions | Non | M6/V3 | Backlog | M | M6 | EST-E18 |
| EST-334 | Decompte General Definitif (DGD) | Non | M6/V4 | Backlog | L | M6 | EST-E18 |
| EST-341 | Lots techniques (allotissement) | Non | M6/V3 | Backlog | L | M6 | EST-E19 |
| EST-342 | Sous-traitance dans le devis | Non | M6/V3 | Backlog | M | M6 | EST-E19 |
| EST-343 | Consultation fournisseurs automatisee | Non | M6/V4 | Backlog | L | M6 | EST-E19 |
| EST-351 | Multi-TVA (20%/10%/5.5%) + recap | Non | M5/V1 | Backlog | M | M5 | EST-E20 |
| EST-352 | Mentions legales obligatoires | Non | M5/V1 | Backlog | S | M5 | EST-E20 |
| EST-353 | Page de garde et recapitulatif | Non | M5/V2 | Backlog | M | M5 | EST-E20 |
| EST-354 | Conditions generales et particulieres | Non | M5/V2 | Backlog | M | M5 | EST-E20 |
| EST-361 | Suivi budgetaire projet (prev. vs realise) | Non | M6/V4 | Backlog | L | M6 | EST-E18 |
| EST-362 | Referentiel normes BTP (DTU, RE2020...) | Non | M5/V2 | Backlog | M | M5 | EST-E20 |
| EST-363 | Ouvrages favoris et acces rapide | Non | M5/V2 | Backlog | S | M5 | EST-E16 |
| EST-364 | Remises multi-niveaux (devis/section/ligne) | Non | M5/V1 | Backlog | M | M5 | EST-E15 |


---
---

# PARTIE 4 — Contenu detaille de chaque ticket (86 tickets)


---

# EST-006 — Feature flags runtime

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.1 / Equipe A / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E01](../EST-E01-foundations-dx.md)
- Section: `EST-006` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.1 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-007 — Design system tokens & component kit

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E01](../EST-E01-foundations-dx.md)
- Section: `EST-007` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [x] Gate qualite defini lors de la planification

## Notes execution
- Decisions techniques:
  - Tailwind v4: ajout `src/styles/tokens.css` + import dans `src/app/globals.css` (tokens semantiques couleur/espacement/typo/radius/ombres).
  - Kit UI cree dans `src/components/ui`: `Button`, `Input`, `Select`, `SearchableSelect`, `Modal` (compound), `Toast` (provider + hook), `Badge`.
  - Migration ciblee uniquement sur 3 zones:
    - `src/components/SupplierCreateModal.tsx`
    - `src/components/estimates/SaveAsTemplateButton.tsx`
    - `src/components/memberships/MembershipsManager.tsx`
  - Respect composition patterns: composant explicite `SearchableSelect` distinct de `Select`; `Modal` en compound components.
- Accessibilite:
  - `role=\"dialog\"`, `aria-modal`, `role=\"combobox\"`/`listbox`, `aria-invalid`, `aria-describedby`, toasts `role=\"status|alert\"`.
- Validation:
  - `npm run lint`: OK
  - `npm run typecheck`: OK
  - `npm run test`: OK (403 tests)
  - E2E smoke non execute dans ce ticket.
- Risques / points d'attention:
  - Les tokens `--spacing-sm/md/lg` ont ete retires pour eviter un conflit Tailwind (`max-w-md` et classes existantes).
  - Migration globale des classes historiques (`btn`, `form-input`, `alert`) hors scope EST-007.
- Non-objectifs explicites:
  - Pas de migration full-app vers le kit UI.
  - Storybook non implemente (optionnel non retenu).

---

# EST-025 — Double discount (remise en cascade)

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-025` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-034

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-026 — Rounding invariant enforcement

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: S
> Sequencing principal: Phase 0 / Vague 0.3 / Equipe B / Effort S
> Gate qualite: Gate P0
> Statut: Fait (scope EST-026 implemente et valide localement)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-026` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.3 / Equipe B / Effort S

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [x] Criteres du Gate P0 valides

## Notes execution
- Migration `supabase/migrations/024_rounding_invariants.sql` applique les contraintes EST-026:
  - `estimate_versions_total_ttc_gte_total_ht_check`
  - `estimate_versions_total_tax_nonnegative_check`
  - `estimate_versions_totals_consistent_check`
  - `estimate_items_line_total_ttc_gte_ht_check`
- `src/lib/estimates/server.ts` ajoute la validation pre-ecriture dans `patchEstimateVersion()`:
  - controle des invariants via `assertEstimateTotalsInvariantForPatch()`
  - rejet explicite `badRequest()` en cas de violation
  - audit `audit_logs` avec action `invariant_violation`
- Tests unitaires couverts dans `src/lib/estimates/server.test.ts`:
  - scenario nominal (OK)
  - scenario incoherent (rejet)
  - scenario `null` (accepte)
  - scenario log `invariant_violation`
- Validation locale executee:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
- Point restant hors scope local: E2E smoke non execute dans cette passe (`powershell`/`pwsh` absent sur l'environnement courant).

---

# EST-027 — Multi-currency support

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-027` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-006

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-028 — Marge par tranches de valeur projet

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.1 / Equipe B / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-028` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.1 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-029 — Classification Type FO (type de fourniture)

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: S
> Sequencing principal: Phase 0 / Vague 0.3 / Equipe C / Effort S+S
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-029` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.3 / Equipe C / Effort S+S

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-030 — Comparaison multi-fournisseurs par article

> Type: Ticket execution
> Milestone: M2
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 3 / Vague 3.2 / Equipe A / Effort L
> Gate qualite: Gate P3
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E09](../EST-E09-suggestions.md)
- Section: `EST-030` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-164

## Occurrences dans le sequencing
- Phase 3 / Vague 3.2 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P3 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-031 — Split MO Atelier / Chantier

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.2 / Equipe A / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-031` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-006

## Occurrences dans le sequencing
- Phase 0 / Vague 0.2 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-032 — Coefficient de majoration temps de pose

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: S
> Sequencing principal: Phase 0 / Vague 0.3 / Equipe C / Effort S+S
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E02](../EST-E02-db-engine.md)
- Section: `EST-032` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.3 / Equipe C / Effort S+S

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-033 — Identifiant structure AID

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: S
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (scope EST-033 implemente et valide localement)

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Section: `EST-033` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-164

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-033 EST-037 EST-123 EST-124` (`6ccc9bd`).
- AID ajoute sur le modele/lignes, validation format, persistance API, filtres UI et export/print.
- Couverture tests et verification locale executees sur le lot E07/E08 (typecheck + suites ciblees).

---

# EST-034 — Import format OPTIMA

> Type: Ticket execution
> Milestone: M2
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 4 / Vague 4.1 / Equipe B / Effort M
> Gate qualite: Gate P4
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-034` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-032
- EST-204

## Occurrences dans le sequencing
- Phase 4 / Vague 4.1 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P4 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-035 — Import CSV Price Book

> Type: Ticket execution
> Milestone: M2
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 3 / Vague 3.1 / Equipe B / Effort M
> Gate qualite: Gate P3
> Statut: Done

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-035` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 3 / Vague 3.1 / Equipe B / Effort M

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [x] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P3 valides

## Notes execution
- **Amendement resolution par noms metier** : l'import CSV ne demande plus d'UUID. L'utilisateur fournit des noms de fournisseurs et references/designations produit. Le systeme resout automatiquement vers les UUID via lookups case-insensitive.
- Fichiers modifies : `src/lib/catalogue/csv-import.ts`, `src/components/catalogue/PriceBookCsvImport.tsx`, `src/components/catalogue/PricesManager.tsx`
- 15 tests unitaires (tous verts) couvrant : resolution exacte, case-insensitive, fallback designation, fournisseur/produit inconnu/ambigu/vide, preview avec noms resolus
- Build et lint OK (aucune regression)

---

# EST-036 — Events append-only (estimate_version_events)

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: S
> Sequencing principal: Phase 5 / Vague 5.1 / Equipe C / Effort S
> Gate qualite: Gate P5
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E03](../EST-E03-security-immutability.md)
- Section: `EST-036` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-046

## Occurrences dans le sequencing
- Phase 5 / Vague 5.1 / Equipe C / Effort S

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P5 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-037 — Rules engine : garde-fous marge/remise + approbations

> Type: Ticket execution
> Milestone: M4
> Priorite: P2
> Effort: L
> Sequencing principal: Phase 6 / Vague 6.1 / Equipe A / Effort L
> Gate qualite: Gate P6
> Statut: Fait (scope EST-037 implemente et valide localement)

## Source canonique
- Epic: [EST-E08](../EST-E08-quality-gating.md)
- Section: `EST-037` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-028
- EST-141

## Occurrences dans le sequencing
- Phase 6 / Vague 6.1 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P6 valides

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-033 EST-037 EST-123 EST-124` (`6ccc9bd`).
- Rules engine marge/remise + workflow d'approbation integres (DB + API + UI admin + gating d'envoi).
- Verification locale executee sur le lot: typecheck + tests cibles.

---

# EST-044 — Optimistic concurrency control

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.1 / Equipe C / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E03](../EST-E03-security-immutability.md)
- Section: `EST-044` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.1 / Equipe C / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-045 — Draft lock (pessimistic)

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.2 / Equipe C / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E03](../EST-E03-security-immutability.md)
- Section: `EST-045` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-044

## Occurrences dans le sequencing
- Phase 0 / Vague 0.2 / Equipe C / Effort M

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P0 valides

## Notes execution
- API lock dediee ajoutee: `POST/PATCH/DELETE /api/estimates/[versionId]/lock` avec support `?force=1` (admin).
- Migration `supabase/migrations/027_draft_locks.sql` ajoutee et appliquee via MCP Supabase.
- Enforcement serveur ajoute sur les ecritures draft: `server.ts` exige un lock actif detenu par l'utilisateur avant mutation (`409 LOCK_REQUIRED` si aucun lock, `409` si lock tiers).
- Hook front `useDraftLock` integre a `edit/page.tsx` avec heartbeat 5 min, release unload/unmount, mode lecture seule si lock tiers, force unlock admin.
- Correctif review React: apres force unlock, la page recharge la version pour eviter l'edition sur etat stale.
- Tests passes:
  - `src/lib/estimates/locks.test.ts`
  - `src/app/api/estimates/[versionId]/lock/route.test.ts`
  - `src/lib/estimates/client.test.ts`
  - `src/lib/estimates/server.test.ts`
  - `src/lib/estimates/server.seal.test.ts`
- Validation locale executee: `npm run typecheck`, `npm run lint`, `npm test` (vert).

---

# EST-046 — Immutability seal on sent versions

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: S
> Sequencing principal: Phase 0 / Vague 0.2 / Equipe B / Effort S
> Gate qualite: Gate P0
> Statut: Fait (scope noyau EST-046 + table event `sent` compatible EST-036)

## Source canonique
- Epic: [EST-E03](../EST-E03-security-immutability.md)
- Section: `EST-046` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.2 / Equipe B / Effort S

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [x] Criteres du Gate P0 valides

## Notes execution
- Migration `025_est046_seal_and_events.sql`: ajout `estimate_versions.seal_hash`, table append-only `estimate_version_events`, trigger DB de transitions de statut, invariants de scellement, RLS minimale, trigger audit.
- Endpoint `GET /api/estimates/[versionId]/verify`: contrat `{ valid, computed_hash, stored_hash }`.
- Endpoint `PATCH /api/estimates/[versionId]/status`: header `If-Match` obligatoire (`400` si absent, `409` en cas de token obsolete).
- Scellement `draft -> sent`: hash SHA-256 hex lowercase d'un payload canonique (version + lignes triees) + insertion event `sent` avec `metadata.seal_hash`.
- UI: badge d'integrite sur detail et print (`Scelle`, `Integrite compromise`, `Non scelle`, `Verification indisponible`).

---

# EST-064 — Streaming export endpoint

> Type: Ticket execution
> Milestone: M0
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E04](../EST-E04-api.md)
- Section: `EST-064` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-065 — OpenAPI/Swagger documentation

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E04](../EST-E04-api.md)
- Section: `EST-065` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-066 — Batch operations API

> Type: Ticket execution
> Milestone: M0
> Priorite: P2
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E04](../EST-E04-api.md)
- Section: `EST-066` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-081 — Liste devis amelioree

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E05](../EST-E05-ui-base.md)
- Section: `EST-081` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-082 — Creation guidee (wizard)

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E05](../EST-E05-ui-base.md)
- Section: `EST-082` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-083 — Dashboard recapitulatif

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E05](../EST-E05-ui-base.md)
- Section: `EST-083` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-084 — Mode impression ameliore

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E05](../EST-E05-ui-base.md)
- Section: `EST-084` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-101 — Navigation clavier tableur

> Type: Ticket execution
> Milestone: M1
> Priorite: P0
> Effort: L
> Sequencing principal: Phase 1 / Vague 1.1 / Equipe A / Effort L
> Gate qualite: Gate P1
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-101` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 1 / Vague 1.1 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-102 — Edition inline rapide

> Type: Ticket execution
> Milestone: M1
> Priorite: P0
> Effort: M
> Sequencing principal: Phase 1 / Vague 1.2 / Equipe A / Effort M
> Gate qualite: Gate P1
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-102` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-101

## Occurrences dans le sequencing
- Phase 1 / Vague 1.2 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-103 — Multi-selection et actions groupees

> Type: Ticket execution
> Milestone: M1
> Priorite: P0
> Effort: L
> Sequencing principal: Phase 1 / Vague 1.2 / Equipe B / Effort L
> Gate qualite: Gate P1
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-103` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-101

## Occurrences dans le sequencing
- Phase 1 / Vague 1.2 / Equipe B / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-104 — Copier/Coller depuis Excel

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 1 / Vague 1.3 / Equipe A / Effort L
> Gate qualite: Gate P1
> Statut: Fait (scope EST-104 implemente et valide localement)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-104` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-103

## Occurrences dans le sequencing
- Phase 1 / Vague 1.3 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-104 EST-105 EST-264` (`b16b7d2`).
- Collage Excel optimise en batch/chunks dans l'editeur pour gros volumes, avec conservation undo/reorder.
- Couverture E2E dediee disponible via `e2e/hex/est-104-clipboard.ps1`.

---

# EST-105 — Auto-save debounce

> Type: Ticket execution
> Milestone: M1
> Priorite: P0
> Effort: M
> Sequencing principal: Phase 1 / Vague 1.1 / Equipe B / Effort M
> Gate qualite: Gate P1
> Statut: Fait (scope EST-105 implemente et valide localement)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-105` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-044

## Occurrences dans le sequencing
- Phase 1 / Vague 1.1 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-104 EST-105 EST-264` (`b16b7d2`), puis couverture E2E completee.
- Auto-save debounce + guard navigation interne relies a l'etat `hasPendingChanges/isSaving`.
- Test E2E dedie ajoute: `e2e/hex/est-105-autosave.ps1` et integre dans la suite `editor`.

---

# EST-106 — Undo/Redo global

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 1 / Vague 1.2 / Equipe C / Effort L
> Gate qualite: Gate P1
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E06](../EST-E06-turbo-editor.md)
- Section: `EST-106` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-105

## Occurrences dans le sequencing
- Phase 1 / Vague 1.2 / Equipe C / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-121 — Sous-totaux par section

> Type: Ticket execution
> Milestone: M0
> Priorite: P0
> Effort: M
> Sequencing principal: Phase 0 / Vague 0.3 / Equipe A / Effort M
> Gate qualite: Gate P0
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Section: `EST-121` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 0 / Vague 0.3 / Equipe A / Effort M

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [x] CI verte (lint, typecheck, UT, E2E smoke)
- [x] Criteres du Gate P0 valides

## Notes execution
- `computeSectionTotals()` ajoute dans `src/lib/estimate-calculations.ts` avec retour `{ foTotalCents, moTotalCents, totalHtCents, totalTtcCents }`.
- Calcul section: prise en compte des lignes descendantes (sections imbriquees), de la marge, de la remise globale (allocation proportionnelle) et de la TVA.
- Sous-totaux FO/MO/HT/TTC affiches inline dans l'editeur et dans la vue impression.

## Checklist QA (review)
- [ ] Ouvrir un devis avec au moins 2 sections et verifier l'affichage inline FO/MO/HT/TTC sur chaque section dans l'editeur.
- [ ] Modifier une ligne enfant (quantite, prix FO, h MO, role MO, coefficients) et verifier la mise a jour immediate des sous-totaux section.
- [ ] Ajouter/supprimer/deplacer une ligne entre sections et verifier la coherence des sous-totaux des sections impactees.
- [ ] Verifier qu'une section vide affiche `0,00 EUR` pour FO, MO, HT, TTC (editeur + impression).
- [ ] Appliquer une remise globale et verifier que les sous-totaux section HT/TTC sont ajustes proportionnellement.
- [ ] Verifier la vue impression (`/print`) : presence des recap section FO/MO/HT/TTC avec les memes valeurs que l'editeur.
- [ ] Verifier qu'un devis avec sous-sections remonte bien les montants dans la section parente.
- [ ] Verification non-regression: `npm run lint`, `npm run typecheck`, `npm run test`.

---

# EST-122 — Sections imbriquees (2 niveaux)

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Section: `EST-122` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-121

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-123 — Conversion section / ligne

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: S
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (scope EST-123 implemente et valide localement)

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Section: `EST-123` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-033 EST-037 EST-123 EST-124` (`6ccc9bd`).
- Conversion section/ligne disponible dans les actions serveur et l'editeur.
- Verification locale executee sur le lot E07/E08 (typecheck + tests cibles).

---

# EST-124 — Numerotation automatique

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: S
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (scope EST-124 implemente et valide localement)

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Section: `EST-124` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-122

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Implementation livree dans `feat(estimates): finalize EST-033 EST-037 EST-123 EST-124` (`6ccc9bd`).
- Numerotation automatique hierarchique integree dans l'editeur et la vue document/print.
- Verification locale executee sur le lot E07/E08 (typecheck + tests cibles).

---

# EST-125 — Hierarchie multi-niveaux BTP (sections N niveaux)

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Statut: A faire

## Source canonique
- Epic: [EST-E07](../EST-E07-structure.md)
- Etend: EST-122 (Sections imbriquees 2 niveaux)

## Dependencies
- EST-122 (sections imbriquees 2 niveaux)
- EST-121 (sous-totaux par section)
- EST-124 (numerotation automatique)

## Vocabulaire

L'application utilise deux types d'elements (`item_type` dans `estimate_items`) :

- **Section** (`item_type = 'section'`) — noeud de regroupement a n'importe quel niveau. Pas de saisie de prix, affiche uniquement un titre et des sous-totaux agreges. Le vocabulaire metier (Lot, Chapitre, Sous-chapitre, Ouvrage...) varie selon les entreprises et n'est pas fige : l'utilisateur peut nommer chaque niveau comme il le souhaite.
- **Ligne** (`item_type = 'line'`) — element chiffrable, pouvant exister a n'importe quel niveau de la hierarchie (directement sous une section de n'importe quelle profondeur). C'est ici qu'on saisit les cellules editables : designation, quantite, unite, prix unitaire, TVA, etc. Une section peut donc contenir a la fois des sous-sections et des lignes (noeud mixte).

```
Section "Gros oeuvre"                    ← titre + sous-total (pas de prix)
  Ligne "Installation de chantier"       ← ligne directe sous un lot (noeud mixte)
  Section "Fondations"                   ← titre + sous-total (pas de prix)
    Ligne "Etudes de sol"                ← ligne directe sous un chapitre (noeud mixte)
    Section "Semelles filantes"          ← titre + sous-total (pas de prix)
      Ligne "Beton C25/30"              ← quantite, PU, TVA, total (editable)
      Ligne "Acier HA"                  ← quantite, PU, TVA, total (editable)
    Section "Longrines"
      Ligne "Coffrage"                  ← quantite, PU, TVA, total (editable)
  Section "Elevations"
    Section "Murs porteurs"
Section "Plomberie"
  Section "Distribution"
```

> **Note :** une section peut contenir a la fois des sous-sections et des lignes directes (noeud mixte). Les branches de l'arbre n'ont pas necessairement la meme profondeur.

## Contexte metier

En chiffrage BTP, les devis suivent une structure hierarchique de type DPGF (Decomposition du Prix Global et Forfaitaire). Le nombre de niveaux de sections varie selon la complexite du projet :

| Complexite | Niveaux de sections | Exemple de labels utilises |
|------------|---------------------|----------------------------|
| Petit projet (renovation, maison) | 1-2 | Section > Ligne (lignes possibles a tout niveau) |
| Projet moyen (batiment) | 2-3 | Section > Section > Ligne (noeuds mixtes possibles) |
| Grand projet / marche public | 3-4 | Section > Section > Section > Section > Ligne (profondeur variable par branche) |

Le vocabulaire metier applique a chaque niveau (Lot, Chapitre, Sous-chapitre, Ouvrage, Phase, Tranche...) est libre et configurable par l'utilisateur via des labels de niveaux.

## User Story

> En tant que chiffreur BTP, je veux structurer mes devis avec une hierarchie de sections configurable jusqu'a 4 niveaux de profondeur, avec la possibilite d'ajouter des lignes a n'importe quel niveau et de nommer chaque niveau selon mon vocabulaire metier, afin de repondre aux exigences des DPGF et marches publics.

## Criteres d'acceptation

### Profondeur configurable
- [ ] Support de 1 a 4 niveaux de sections (configurable par devis, defaut : 3)
- [ ] Parametre `max_section_depth` stocke au niveau `estimate_versions` (int, defaut 3, min 1, max 4)
- [ ] Les lignes (`item_type = 'line'`) peuvent etre ajoutees sous n'importe quelle section, quel que soit son niveau de profondeur (noeuds mixtes autorises)
- [ ] Une section peut contenir a la fois des sous-sections et des lignes directes
- [ ] L'UI empeche la creation de sections au-dela de `max_section_depth`
- [ ] Migration ajoute la colonne `max_section_depth` sans casser l'existant (defaut 2 pour les devis existants)

### Labels de niveaux
- [ ] Labels fixes par niveau : Niveau 1 = "Lot", Niveau 2 = "Chapitre", Niveau 3 = "Sous-chapitre", Niveau 4 = "Ouvrage"
- [ ] Les labels sont affiches dans l'UI lors de la creation d'une section ("+ Ajouter un Lot", "+ Ajouter un Chapitre"...)
- [ ] Les labels sont definis en constante cote code (`DEFAULT_SECTION_LEVEL_LABELS`)

### Affichage et navigation
- [ ] Indentation visuelle proportionnelle au niveau de profondeur (padding incremental par niveau)
- [ ] Icones ou couleurs differenciees par niveau pour faciliter la lecture
- [ ] Chaque section est depliable/repliable independamment
- [ ] Bouton "Tout deplier / Tout replier" pour la navigation rapide
- [ ] Breadcrumb contextuel affichant le chemin complet lors de l'edition d'une ligne profonde (ex: "Gros oeuvre > Fondations > Semelles filantes")

### Drag-and-drop
- [ ] Le DnD permet de deplacer une section a n'importe quel niveau valide
- [ ] Le DnD d'une ligne permet de la placer dans n'importe quelle section (a tout niveau)
- [ ] Contrainte : une section avec enfants ne peut pas etre convertie en ligne
- [ ] Lors d'un drop dans un noeud mixte (section contenant des sous-sections et des lignes), l'element est place a la bonne position parmi les enfants directs
- [ ] Indicateur visuel de la zone de drop avec le niveau cible affiche
- [ ] La fonction `move_estimate_item()` gere les deplacements inter-niveaux avec recalcul des positions

### Sous-totaux cascades
- [ ] Chaque section affiche un sous-total agrege de tous ses descendants (sous-sections + lignes directes + lignes des sous-sections)
- [ ] Les sous-totaux remontent en cascade a chaque niveau de section
- [ ] Les lignes directes d'un noeud mixte sont incluses dans le sous-total de leur section parente
- [ ] Decomposition FO/MO a chaque niveau de sous-total
- [ ] Les sous-totaux sont recalcules automatiquement lors de toute modification a n'importe quel niveau

### Numerotation hierarchique
- [ ] Compteur unique sequentiel parmi tous les enfants directs d'un meme parent, quel que soit leur type (section ou ligne)
- [ ] Format par profondeur :
  - Racine (depth 0) : zero-padded 2 chiffres → `01`, `02`, `03`
  - Niveaux suivants (depth 1+) : sans padding → `1`, `2`, `3`
  - Separateur : point `.`
- [ ] Exemples de numerotation dans un arbre avec noeuds mixtes :
  ```
  01        Section "Gros oeuvre"
  01.1      Ligne "Installation de chantier"   (enfant direct du lot)
  01.2      Section "Fondations"
  01.2.1    Ligne "Etudes de sol"              (enfant direct du chapitre)
  01.2.2    Section "Semelles filantes"
  01.2.2.1  Ligne "Beton C25/30"
  01.2.2.2  Ligne "Acier HA"
  01.2.3    Section "Longrines"
  01.2.3.1  Ligne "Coffrage"
  01.3      Section "Elevations"
  02        Section "Plomberie"
  ```
- [ ] La differenciation section/ligne se fait visuellement (style, indentation, icone) et non par le format du numero
- [ ] La numerotation se met a jour automatiquement lors de tout reordonnancement
- [ ] Compatibilite avec le prefixe LOT de EST-124

### Impression et export
- [ ] La vue impression respecte la hierarchie avec indentation et sous-totaux a chaque niveau de section
- [ ] Les exports DPGF incluent tous les niveaux
- [ ] Option d'impression avec filtre par niveau (ex: imprimer uniquement les 2 premiers niveaux de sections sans le detail des lignes)

### Garde-fous
- [ ] Validation en base : la profondeur d'une section ne peut pas depasser `max_section_depth`
- [ ] Validation : une ligne peut etre ajoutee sous n'importe quelle section existante (pas de contrainte de profondeur pour les lignes)
- [ ] Message d'erreur explicite si l'utilisateur tente de creer une section au-dela de la profondeur maximale
- [ ] Les devis existants continuent de fonctionner sans modification

## Notes techniques

### Schema DB
- Ajouter `max_section_depth integer not null default 3` sur `estimate_versions`
- Adapter le CHECK constraint existant pour supporter N niveaux de sections
- Supprimer toute contrainte qui forcerait les lignes a n'exister qu'au dernier niveau (autoriser les noeuds mixtes)
- Modifier `reorder_estimate_items()` et `move_estimate_item()` pour gerer les deplacements multi-niveaux et les noeuds mixtes

### Fichiers a modifier
- `supabase/migrations/0xx_est125_multi_level_hierarchy.sql` — migration schema
- `src/components/estimates/EstimateEditorTable.tsx` — rendu arborescent N niveaux, indentation, DnD
- `src/lib/estimate-calculations.ts` — sous-totaux recursifs cascades
- `src/lib/estimates/numbering.ts` — numerotation N niveaux
- `src/lib/estimates/schemas.ts` — validation `max_section_depth`
- `src/lib/estimates/server.ts` — CRUD adapte pour la profondeur variable
- `src/app/dashboard/estimates/[versionId]/print/page.tsx` — impression multi-niveaux

### Performance
- Les calculs de sous-totaux doivent rester performants avec 4 niveaux de sections et 500+ lignes
- Privilegier le calcul cote client (JS) plutot que des requetes recursives cote serveur
- Indexer `parent_id` (deja fait) et `(version_id, parent_id, position)` pour les requetes de tri

### Reutiliser
- Structure `parent_id` existante dans `estimate_items`
- DnD dnd-kit de `EstimateEditorTable`
- `computeEstimateLineValues()` et `computeSectionTotals()` de EST-121
- Numerotation de EST-124

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Devis existants non impactes (retrocompatibilite)
- [ ] Tests unitaires sur le calcul recursif des sous-totaux (2, 3, 4 niveaux de sections, noeuds mixtes)
- [ ] Test unitaire : sous-total correct avec lignes directes + sous-sections dans un meme noeud
- [ ] Test E2E : creer un devis 3 niveaux de sections avec noeuds mixtes, reordonner, verifier les sous-totaux
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Performance validee : editeur fluide avec 4 niveaux de sections et 300+ lignes

---

# EST-141 — Gating envoi (sent)

> Type: Ticket execution
> Milestone: M2
> Priorite: P0
> Effort: M
> Sequencing principal: Phase 4 / Vague 4.1 / Equipe A / Effort M
> Gate qualite: Gate P4
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E08](../EST-E08-quality-gating.md)
- Section: `EST-141` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-028
- EST-031

## Occurrences dans le sequencing
- Phase 4 / Vague 4.1 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P4 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-142 — Checklist completude

> Type: Ticket execution
> Milestone: M2
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 4 / Vague 4.2 / Equipe A / Effort M
> Gate qualite: Gate P4
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E08](../EST-E08-quality-gating.md)
- Section: `EST-142` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-141

## Occurrences dans le sequencing
- Phase 4 / Vague 4.2 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P4 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-143 — Detection d'outliers

> Type: Ticket execution
> Milestone: M2
> Priorite: P2
> Effort: M
> Sequencing principal: Phase 3 / Vague 3.2 / Equipe B / Effort M
> Gate qualite: Gate P3
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E08](../EST-E08-quality-gating.md)
- Section: `EST-143` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 3 / Vague 3.2 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P3 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-144 — Historique des anomalies

> Type: Ticket execution
> Milestone: M2
> Priorite: P2
> Effort: S
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E08](../EST-E08-quality-gating.md)
- Section: `EST-144` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-141

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-161 — Scoring et classement des suggestions

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 2 / Vague 2.1 / Equipe C / Effort M
> Gate qualite: Gate P2
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E09](../EST-E09-suggestions.md)
- Section: `EST-161` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 2 / Vague 2.1 / Equipe C / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P2 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-162 — Application en masse des suggestions

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 2 / Vague 2.2 / Equipe C / Effort M
> Gate qualite: Gate P2
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E09](../EST-E09-suggestions.md)
- Section: `EST-162` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-161

## Occurrences dans le sequencing
- Phase 2 / Vague 2.2 / Equipe C / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P2 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-163 — Apprentissage des corrections

> Type: Ticket execution
> Milestone: M2
> Priorite: P2
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E09](../EST-E09-suggestions.md)
- Section: `EST-163` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-161

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-164 — Suggestions depuis le catalogue

> Type: Ticket execution
> Milestone: M2
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 3 / Vague 3.1 / Equipe A / Effort M
> Gate qualite: Gate P3
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E09](../EST-E09-suggestions.md)
- Section: `EST-164` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 3 / Vague 3.1 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P3 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-181 — Templates de devis

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 2 / Vague 2.1 / Equipe A / Effort L
> Gate qualite: Gate P2
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E10](../EST-E10-reuse-templates.md)
- Section: `EST-181` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 2 / Vague 2.1 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P2 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-182 — Assemblages reutilisables

> Type: Ticket execution
> Milestone: M1
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 2 / Vague 2.1 / Equipe B / Effort L
> Gate qualite: Gate P2
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E10](../EST-E10-reuse-templates.md)
- Section: `EST-182` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 2 / Vague 2.1 / Equipe B / Effort L

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [x] Tests E2E ajoutes ou mis a jour si flux critique
- [x] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P2 valides

## Notes execution
- Date d'execution: 21 fevrier 2026.
- Migration ajoutee: `supabase/migrations/20260222033000_est182_estimate_assemblies.sql`.
- Nouvelles routes:
  - `GET|POST /api/estimates/assemblies`
  - `GET|PATCH|DELETE /api/estimates/assemblies/[assemblyId]`
  - `POST /api/estimates/assemblies/[assemblyId]/insert?versionId=...`
- UI:
  - Bibliotheque `/dashboard/estimates/assemblies`
  - Drawer Assemblages dans l'editeur devis avec insertion ancree sur la cellule active
- QA:
  - Tests schemas/client/server/routes ajoutes
  - Script E2E ajoute `e2e/hex/ti-182-assemblies.ps1`
  - Verifications executees le 22 fevrier 2026:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test`
    - `npm run e2e:run -- e2e/hex/ti-182-assemblies.ps1`
    - `npx -y react-doctor@latest . --verbose --diff` (score 97/100)

---

# EST-183 — Duplication partielle (section)

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E10](../EST-E10-reuse-templates.md)
- Section: `EST-183` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-184 — Import depuis un autre devis

> Type: Ticket execution
> Milestone: M1
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E10](../EST-E10-reuse-templates.md)
- Section: `EST-184` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-183

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-201 — Generation PDF serveur

> Type: Ticket execution
> Milestone: M2
> Priorite: P0
> Effort: L
> Sequencing principal: Phase 3 / Vague 3.1 / Equipe C / Effort L
> Gate qualite: Gate P3
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-201` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 3 / Vague 3.1 / Equipe C / Effort L
- Phase 3 / Vague 3.2 / Equipe C
- Phase 4 / Vague 4.1 / Equipe C

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P3 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-202 — Export DPGF aller-retour

> Type: Ticket execution
> Milestone: M3
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-202` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-030

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-203 — Hash d'integrite document

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: S
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-203` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-201

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-204 — Import multi-format

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E11](../EST-E11-imports-exports.md)
- Section: `EST-204` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-221 — Diff visuel entre versions

> Type: Ticket execution
> Milestone: M3
> Priorite: P1
> Effort: L
> Sequencing principal: Phase 5 / Vague 5.1 / Equipe A / Effort L
> Gate qualite: Gate P5
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E12](../EST-E12-versioning.md)
- Section: `EST-221` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 5 / Vague 5.1 / Equipe A / Effort L

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P5 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-222 — Timeline des versions

> Type: Ticket execution
> Milestone: M3
> Priorite: P1
> Effort: M
> Sequencing principal: Phase 5 / Vague 5.1 / Equipe B / Effort M
> Gate qualite: Gate P5
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E12](../EST-E12-versioning.md)
- Section: `EST-222` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 5 / Vague 5.1 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P5 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-223 — Scenarios alternatifs

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: M
> Sequencing principal: Phase 5 / Vague 5.2 / Equipe A / Effort M
> Gate qualite: Gate P5
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E12](../EST-E12-versioning.md)
- Section: `EST-223` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-221

## Occurrences dans le sequencing
- Phase 5 / Vague 5.2 / Equipe A / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P5 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-224 — Changelog automatique

> Type: Ticket execution
> Milestone: M3
> Priorite: P2
> Effort: M
> Sequencing principal: Phase 5 / Vague 5.2 / Equipe B / Effort M
> Gate qualite: Gate P5
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E12](../EST-E12-versioning.md)
- Section: `EST-224` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-221

## Occurrences dans le sequencing
- Phase 5 / Vague 5.2 / Equipe B / Effort M

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P5 valides

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-241 — Envoi par email

> Type: Ticket execution
> Milestone: M4
> Priorite: P0
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E13](../EST-E13-lifecycle-client.md)
- Section: `EST-241` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-201

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-242 — Portail client

> Type: Ticket execution
> Milestone: M4
> Priorite: P0
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E13](../EST-E13-lifecycle-client.md)
- Section: `EST-242` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-241

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-243 — Acceptation et signature

> Type: Ticket execution
> Milestone: M4
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E13](../EST-E13-lifecycle-client.md)
- Section: `EST-243` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-242

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-244 — Relance automatique

> Type: Ticket execution
> Milestone: M4
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E13](../EST-E13-lifecycle-client.md)
- Section: `EST-244` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-241

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-245 — Negociation (contre-proposition)

> Type: Ticket execution
> Milestone: M4
> Priorite: P2
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E13](../EST-E13-lifecycle-client.md)
- Section: `EST-245` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- EST-242

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-261 — Tests RLS end-to-end

> Type: Ticket execution
> Milestone: M4
> Priorite: P0
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E14](../EST-E14-observability-tests.md)
- Section: `EST-261` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-262 — Tests E2E parcours critique

> Type: Ticket execution
> Milestone: M4
> Priorite: P0
> Effort: L
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E14](../EST-E14-observability-tests.md)
- Section: `EST-262` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-263 — Metriques et monitoring

> Type: Ticket execution
> Milestone: M4
> Priorite: P1
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E14](../EST-E14-observability-tests.md)
- Section: `EST-263` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-264 — Optimisation performance editeur

> Type: Ticket execution
> Milestone: M1
> Priorite: P0
> Effort: L
> Sequencing principal: Phase 1 / Vague 1.1 / Equipe C / Effort M
> Gate qualite: Gate P1
> Statut: Fait (verifie dans la codebase)

## Source canonique
- Epic: [EST-E14](../EST-E14-observability-tests.md)
- Section: `EST-264` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Phase 1 / Vague 1.1 / Equipe C / Effort M

## Definition of done
- [x] Scope fonctionnel de la story implemente
- [x] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Criteres du Gate P1 valides

## Notes execution
- Virtualisation de la table editeur integree avec `@tanstack/react-virtual` et hook dedie `src/hooks/useVirtualList.ts`.
- `EstimateEditorTable` refactore pour supporter un rendu virtualise (avec fallback non virtualise) et memoisation des structures couteuses.
- `page.tsx` passe une configuration `virtualization` stable (feature flag + parametres).
- Documentation benchmark maintenue dans `docs/performance/EST-264.md`.
- Etat de validation actuel:
  - lint: OK
  - typecheck global: KO (ecarts inter-tickets hors seul scope EST-264)
  - tests globaux: KO (ecarts inter-tickets hors seul scope EST-264)

---

# EST-265 — Tests de charge API

> Type: Ticket execution
> Milestone: M4
> Priorite: P2
> Effort: M
> Sequencing principal: Non sequence (epic only)
> Gate qualite: Hors sequencing v2 (a planifier)
> Statut: A faire

## Source canonique
- Epic: [EST-E14](../EST-E14-observability-tests.md)
- Section: `EST-265` dans l'epic source
- Plan de sequencing: [SEQUENCING-3-TEAMS.md](../SEQUENCING-3-TEAMS.md)

## Dependencies
- Aucune

## Occurrences dans le sequencing
- Hors sequencing v2

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Gate qualite defini lors de la planification

## Notes execution
- Ajouter ici decisions techniques, risques et liens PR.

---

# EST-301 — Decomposition DS/FC/FG/B&A dans le moteur de calcul

> Type: Ticket execution
> Milestone: M5
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E15](../EST-E15-structure-prix-btp.md)
- Section: `EST-301` dans l'epic source

## Dependencies
- Aucune (mais impacte EST-028 marge par tranches)

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee et retrocompatible
- [ ] Documentation moteur de calcul mise a jour

---

# EST-302 — Coefficients de rendement et pertes materiaux

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E15](../EST-E15-structure-prix-btp.md)
- Section: `EST-302` dans l'epic source

## Dependencies
- EST-301 (le DS utilise les quantites brutes)

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee

---

# EST-311 — Ouvrages composes avec sous-detail de prix

> Type: Ticket execution
> Milestone: M5
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E16](../EST-E16-ouvrages-bibliotheque.md)
- Section: `EST-311` dans l'epic source

## Dependencies
- EST-301 (integration DS)
- EST-302 (coefficients de perte)

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Sous-detail imprimable dans le PDF

---

# EST-312 — Connexion bases de prix Batiprix/UNTEC

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: L
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E16](../EST-E16-ouvrages-bibliotheque.md)
- Section: `EST-312` dans l'epic source

## Dependencies
- EST-311 (ouvrages composes pour recevoir les imports)

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Integration API ou import fichier fonctionnel
- [ ] Log d'import avec tracabilite

---

# EST-321 — Formules dans les quantites

> Type: Ticket execution
> Milestone: M5
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E17](../EST-E17-metres-formules.md)
- Section: `EST-321` dans l'epic source

## Dependencies
- Aucune

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour (parseur de formules)
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Formules preservees dans l'export DPGF

---

# EST-322 — Carnet de metres integre

> Type: Ticket execution
> Milestone: M5
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E17](../EST-E17-metres-formules.md)
- Section: `EST-322` dans l'epic source

## Dependencies
- EST-321 (coexistence formules/carnet)

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Import carnet depuis Excel/CSV fonctionnel
- [ ] Carnet imprimable en annexe du devis

---

# EST-331 — Situations de travaux (facturation a l'avancement)

> Type: Ticket execution
> Milestone: M6
> Priorite: P0
> Effort: XL
> Sequencing principal: Backlog (M6 - Vague 3)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E18](../EST-E18-situations-avenants.md)
- Section: `EST-331` dans l'epic source

## Dependencies
- Aucune (mais enrichi par EST-332, EST-333, EST-334)

## Occurrences dans le sequencing
- M6 — Vague 3 (cycle de vie chantier)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour (flux critique)
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Generation PDF situation fonctionnelle
- [ ] Recapitulatif global des situations

---

# EST-332 — Gestion des avenants / travaux supplementaires

> Type: Ticket execution
> Milestone: M6
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M6 - Vague 3)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E18](../EST-E18-situations-avenants.md)
- Section: `EST-332` dans l'epic source

## Dependencies
- EST-331 (integration dans les situations)

## Occurrences dans le sequencing
- M6 — Vague 3 (cycle de vie chantier)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Generation PDF avenant fonctionnelle
- [ ] Workflow acceptation avenant operationnel

---

# EST-333 — Retenue de garantie et cautions

> Type: Ticket execution
> Milestone: M6
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M6 - Vague 3)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E18](../EST-E18-situations-avenants.md)
- Section: `EST-333` dans l'epic source

## Dependencies
- EST-331 (situations de travaux)

## Occurrences dans le sequencing
- M6 — Vague 3 (cycle de vie chantier)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Retenue integree dans le PDF de situation

---

# EST-334 — Decompte General Definitif (DGD)

> Type: Ticket execution
> Milestone: M6
> Priorite: P1
> Effort: L
> Sequencing principal: Backlog (M6 - Vague 4)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E18](../EST-E18-situations-avenants.md)
- Section: `EST-334` dans l'epic source

## Dependencies
- EST-331 (situations de travaux)
- EST-332 (avenants)
- EST-333 (retenue de garantie)

## Occurrences dans le sequencing
- M6 — Vague 4 (completude et pilotage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Generation PDF DGD fonctionnelle
- [ ] Consolidation situations + avenants + retenues correcte

---

# EST-341 — Gestion des lots techniques (allotissement)

> Type: Ticket execution
> Milestone: M6
> Priorite: P0
> Effort: L
> Sequencing principal: Backlog (M6 - Vague 3)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E19](../EST-E19-lots-sous-traitance.md)
- Section: `EST-341` dans l'epic source

## Dependencies
- EST-121 (sous-totaux par section)

## Occurrences dans le sequencing
- M6 — Vague 3 (cycle de vie chantier)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Recapitulatif par lot dans le PDF
- [ ] Extraction de lot fonctionnelle

---

# EST-342 — Sous-traitance dans le devis

> Type: Ticket execution
> Milestone: M6
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M6 - Vague 3)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E19](../EST-E19-lots-sous-traitance.md)
- Section: `EST-342` dans l'epic source

## Dependencies
- EST-301 (integration dans la decomposition DS/FC/FG/B&A)

## Occurrences dans le sequencing
- M6 — Vague 3 (cycle de vie chantier)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Recapitulatif propre/sous-traite dans les totaux

---

# EST-343 — Consultation fournisseurs automatisee

> Type: Ticket execution
> Milestone: M6
> Priorite: P2
> Effort: L
> Sequencing principal: Backlog (M6 - Vague 4)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E19](../EST-E19-lots-sous-traitance.md)
- Section: `EST-343` dans l'epic source

## Dependencies
- EST-241 (envoi email)

## Occurrences dans le sequencing
- M6 — Vague 4 (completude et pilotage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Envoi consultation email fonctionnel
- [ ] Grille de comparaison des retours

---

# EST-351 — Multi-TVA (20%/10%/5.5%) avec recapitulatif

> Type: Ticket execution
> Milestone: M5
> Priorite: P0
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E20](../EST-E20-conformite-pdf-pro.md)
- Section: `EST-351` dans l'epic source

## Dependencies
- Aucune

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Recapitulatif multi-TVA dans le PDF
- [ ] Mentions legales TVA renovation automatiques

---

# EST-352 — Mentions legales obligatoires sur devis

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: S
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E20](../EST-E20-conformite-pdf-pro.md)
- Section: `EST-352` dans l'epic source

## Dependencies
- Aucune

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Mentions visibles dans le PDF genere
- [ ] Alerte quality gating si mentions manquantes

---

# EST-353 — Page de garde et recapitulatif detaille

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E20](../EST-E20-conformite-pdf-pro.md)
- Section: `EST-353` dans l'epic source

## Dependencies
- EST-341 (lots pour le recapitulatif par lot)
- EST-351 (multi-TVA pour le recapitulatif)

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Page de garde PDF avec logo et coordonnees
- [ ] Recapitulatif par lot dans le PDF
- [ ] Sommaire automatique fonctionnel

---

# EST-354 — Conditions generales et particulieres

> Type: Ticket execution
> Milestone: M5
> Priorite: P2
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E20](../EST-E20-conformite-pdf-pro.md)
- Section: `EST-354` dans l'epic source

## Dependencies
- Aucune

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Bibliotheque de clauses fonctionnelle
- [ ] Clauses incluses dans le PDF en annexe

---

# EST-361 — Suivi budgetaire projet (previsionnel vs realise)

> Type: Ticket execution
> Milestone: M6
> Priorite: P1
> Effort: L
> Sequencing principal: Backlog (M6 - Vague 4)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E18](../EST-E18-situations-avenants.md)
- Section: `EST-361` dans l'epic source

## Dependencies
- EST-331 (situations de travaux — source du "realise")
- EST-301 (decomposition DS/FC/FG/B&A — source du "previsionnel")

## Occurrences dans le sequencing
- M6 — Vague 4 (completude et pilotage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Dashboard rentabilite par projet fonctionnel
- [ ] Ecarts de marge par poste calcules et affiches
- [ ] Alertes depassement budget operationnelles

---

# EST-362 — Referentiel normes BTP (DTU, RE2020, CCAG, CCTP, BPU)

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E20](../EST-E20-conformite-pdf-pro.md)
- Section: `EST-362` dans l'epic source

## Dependencies
- Aucune

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Recherche dans le referentiel fonctionnelle
- [ ] Rattachement de references normatives aux lignes du devis
- [ ] References affichees dans le PDF

---

# EST-363 — Ouvrages favoris et acces rapide

> Type: Ticket execution
> Milestone: M5
> Priorite: P2
> Effort: S
> Sequencing principal: Backlog (M5 - Vague 2)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E16](../EST-E16-ouvrages-bibliotheque.md)
- Section: `EST-363` dans l'epic source

## Dependencies
- EST-311 (ouvrages composes — prerequis bibliotheque)

## Occurrences dans le sequencing
- M5 — Vague 2 (coeur metier chiffrage)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Marquage favori fonctionnel
- [ ] Panneau d'acces rapide aux favoris dans l'editeur

---

# EST-364 — Remises multi-niveaux (chiffrage / section / ligne)

> Type: Ticket execution
> Milestone: M5
> Priorite: P1
> Effort: M
> Sequencing principal: Backlog (M5 - Vague 1)
> Gate qualite: -
> Statut: A faire

## Source canonique
- Epic: [EST-E15](../EST-E15-structure-prix-btp.md)
- Section: `EST-364` dans l'epic source

## Dependencies
- EST-025 (double remise cascade — enrichi par ce ticket)
- EST-301 (decomposition DS/FC/FG/B&A — la remise s'applique apres formation du PV HT)

## Occurrences dans le sequencing
- M5 — Vague 1 (pre-requis structurants)

## Definition of done
- [ ] Scope fonctionnel de la story implemente
- [ ] Tests unitaires ajoutes ou mis a jour
- [ ] Tests E2E ajoutes ou mis a jour si flux critique
- [ ] CI verte (lint, typecheck, UT, E2E smoke)
- [ ] Migration DB deployee
- [ ] Remises visibles a chaque niveau dans l'editeur
- [ ] Recapitulatif des remises dans le PDF

--- FIN DU DOCUMENT ---
