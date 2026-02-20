# Backlog Chiffrage Comparatif (`HEX_BC` vs `hex`)

Date: 2026-02-20  
Owner: Equipe produit + equipe technique

## Objectif
Converger `HEX_BC` vers un niveau fonctionnel et technique comparable au projet `hex` sur le domaine chiffrage, sans casser les parcours devis deja en production (`/dashboard/estimates`).

## Hypotheses
- Base de travail: `HEX_BC` reste l'application cible.
- Priorite 1: fiabilite (RLS, API serveur, tests, migrations).
- Priorite 2: valeur metier manquante (import DPGF, mapping, catalogue/prix/indices).

## Legende
- Priorite: `P0` critique, `P1` haute, `P2` moyenne.
- Effort: `S` (1-2 j), `M` (3-6 j), `L` (7-12 j), `XL` (>12 j).
- Statut initial: `TODO`.

## Roadmap Sprints

| Sprint | Focus | Stories |
|---|---|---|
| S1 | Socle securite + architecture serveur | BC-001, BC-002, BC-003, BC-004 |
| S2 | Robustesse calcul + perf + observabilite | BC-005, BC-006, BC-010 |
| S3 | Import DPGF de bout en bout | BC-007 |
| S4 | Mapping + catalogue/pricebook | BC-008, BC-009 |
| S5 (optionnel) | Multi-tenant complet | BC-011 |

---

## Backlog Detaille

### BC-001 - Durcir RLS chiffrage/devis
- Priorite: `P0`
- Effort: `M`
- Type: Technique
- Statut: `DONE` (2026-02-20)
- Description:
  - Remplacer les policies permissives (`using (true)`) sur les tables critiques par des policies scopees utilisateur/projet/version.
- Fichiers cibles:
  - `supabase/migrations/004_estimate_rls_hardening.sql` (nouveau)
  - `supabase/schema.sql` (alignement documentaire, sans drop massif)
- Taches:
  - Definir policies select/insert/update/delete sur `estimate_projects`, `estimate_versions`, `estimate_items`, `estimate_categories`, `labor_roles`, `estimate_suggestion_rules`.
  - Verifier que les transitions de statut non `draft` restent non editables en DB.
  - Ajouter tests SQL de non-regression RLS (scripts e2e SQL).
- Criteres d'acceptation:
  - Un utilisateur A ne lit pas/modifie jamais les chiffrages utilisateur B.
  - Les updates d'une version `sent/accepted/archived` sont bloquees sauf transition de statut autorisee.

### BC-002 - Introduire une couche API serveur pour le chiffrage
- Priorite: `P0`
- Effort: `L`
- Type: Technique
- Statut: `DONE` (2026-02-20)
- Description:
  - Eviter les ecritures directes Supabase depuis l'UI chiffrage; centraliser validation et regles dans des endpoints serveur.
- Fichiers cibles:
  - `src/app/api/estimates/route.ts` (nouveau)
  - `src/app/api/estimates/[versionId]/route.ts` (nouveau)
  - `src/app/api/estimates/[versionId]/items/route.ts` (nouveau)
  - `src/app/api/estimates/[versionId]/status/route.ts` (nouveau)
  - `src/lib/estimates/server.ts` (nouveau)
  - `src/lib/estimates/schemas.ts` (nouveau)
  - `src/app/dashboard/estimates/page.tsx`
  - `src/app/dashboard/estimates/new/page.tsx`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx`
- Taches:
  - Creer DTO et validation d'entree (Zod conseille).
  - Deplacer logique de persistance (create/update/reorder/status/save settings) en serveur.
  - Faire consommer l'UI via `fetch('/api/estimates/...')` au lieu de `.from(...).update(...)` directement.
- Criteres d'acceptation:
  - Aucune mutation chiffrage n'est faite depuis le client directement vers Supabase.
  - Les erreurs de validation sont homogenes et exploitables dans l'UI.

### BC-003 - Passer a des migrations incrementales propres
- Priorite: `P0`
- Effort: `M`
- Type: Technique
- Statut: `DONE` (2026-02-20)
- Description:
  - Sortir de la logique destructive `drop table if exists ...` pour stabiliser les environnements.
- Fichiers cibles:
  - `supabase/migrations/` (nouveaux scripts numerotes)
  - `supabase/schema.sql` (garder comme snapshot optionnel)
  - `supabase/README.md`
- Taches:
  - Creer migration baseline idempotente sans destruction des donnees.
  - Documenter le flux "apply migrations" local/staging/prod.
  - Aligner les objets presentes dans `schema.sql` et ceux des migrations.
- Criteres d'acceptation:
  - Un environnement existant peut evoluer sans reset total.
  - La procedure d'upgrade est documentee et reproductible.

### BC-004 - Ajouter des tests unitaires du moteur de calcul
- Priorite: `P0`
- Effort: `S`
- Type: Technique
- Statut: `DONE` (2026-02-20)
- Description:
  - Verrouiller les regles de calcul FO/MO/PV/TVA/arrondi/remise.
- Fichiers cibles:
  - `package.json` (scripts test)
  - `src/lib/estimate-calculations.test.ts` (nouveau)
  - `src/lib/estimate-calculations.ts`
- Taches:
  - Installer et configurer `vitest`.
  - Ecrire tests de reference: cas nominaux, limites, arrondis, remise > sous-total.
- Criteres d'acceptation:
  - Suite tests executee en CI locale (`npm run test`).
  - Cas critiques de regression couverts.

### BC-005 - Bulk operations pour updates de lignes et reorder
- Priorite: `P1`
- Effort: `M`
- Type: Technique
- Statut: `TODO`
- Description:
  - Remplacer les `Promise.all` ligne par ligne par des RPC transactionnelles.
- Fichiers cibles:
  - `supabase/migrations/005_estimate_bulk_ops.sql` (nouveau)
  - `src/lib/estimates/server.ts`
  - `src/app/api/estimates/[versionId]/items/route.ts`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx`
- Taches:
  - Creer RPC `bulk_update_estimate_items`.
  - Creer RPC `reorder_estimate_items`.
  - Adapter l'API pour utiliser ces RPC.
- Criteres d'acceptation:
  - Save settings + reorder font un nombre minimal d'appels DB.
  - En cas d'erreur, rollback propre et message utilisateur coherent.

### BC-006 - Audit trail des changements chiffrage
- Priorite: `P1`
- Effort: `M`
- Type: Technique
- Statut: `TODO`
- Description:
  - Tracer les operations sensibles (devis, lignes, parametres, statuts).
- Fichiers cibles:
  - `supabase/migrations/006_estimate_audit.sql` (nouveau)
  - `src/app/api/estimates/[versionId]/status/route.ts`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` (affichage erreurs)
- Taches:
  - Creer table `audit_logs` si absente.
  - Creer trigger `log_audit()` sur tables estimate.
  - Exposer endpoint lecture audit (admin).
- Criteres d'acceptation:
  - Toute mutation CRUD chiffrage laisse une trace (user, table, before/after, date).

### BC-007 - Flux Import DPGF complet
- Priorite: `P1`
- Effort: `L`
- Type: Fonctionnel
- Statut: `TODO`
- Description:
  - Ajouter upload, parsing (worker + fallback serveur), suivi statut import.
- Fichiers cibles:
  - `supabase/migrations/007_dpgf_import_tables.sql` (nouveau)
  - `supabase/functions/parse-dpgf/index.ts` (nouveau)
  - `src/app/dashboard/imports/page.tsx` (nouveau)
  - `src/components/imports/ImportWizard.tsx` (nouveau)
  - `src/hooks/useImportFlow.ts` (nouveau)
  - `src/hooks/useFileParser.ts` (nouveau)
  - `src/workers/csv-parser.worker.ts` (nouveau)
  - `src/workers/xlsx-parser.worker.ts` (nouveau)
- Taches:
  - Ajouter bucket storage et droits associes.
  - Creer tables `dpgf_imports`, `dpgf_rows_raw`, `dpgf_rows_mapped`.
  - Ajouter polling de statut import dans l'UI.
- Criteres d'acceptation:
  - Import CSV/XLSX visible dans la liste avec statut et nombre de lignes.
  - Gros fichiers basculent sur parse serveur sans casser le parcours.

### BC-008 - Wizard de mapping colonnes + suggestions + templates
- Priorite: `P1`
- Effort: `L`
- Type: Fonctionnel
- Statut: `TODO`
- Description:
  - Permettre mapping guide, suggestion memoire et sauvegarde templates fournisseur.
- Fichiers cibles:
  - `supabase/migrations/008_mapping_tables.sql` (nouveau)
  - `src/app/dashboard/mappings/page.tsx` (nouveau)
  - `src/components/mappings/MappingWizard.tsx` (nouveau)
  - `src/components/mappings/ColumnMapper.tsx` (nouveau)
  - `src/components/mappings/DataPreview.tsx` (nouveau)
  - `src/app/api/mappings/route.ts` (nouveau)
- Taches:
  - Ajouter tables `dpgf_mappings`, `mapping_memory`, `mapping_templates`.
  - Ajouter endpoints preview/suggestions/create/save-template/validate/duplicates.
  - Ajouter checks champs requis (`hex_code`, `designation`).
- Criteres d'acceptation:
  - Mapping sauvegarde version et reutilise suggestions au prochain import.
  - Validation et detection doublons retournent des resultats exploitables UI.

### BC-009 - Catalogue + pricebook + indices matiere
- Priorite: `P1`
- Effort: `L`
- Type: Fonctionnel
- Statut: `TODO`
- Description:
  - Integrer une base prix exploitable pour enrichir le chiffrage.
- Fichiers cibles:
  - `supabase/migrations/009_catalogue_pricebook.sql` (nouveau)
  - `supabase/migrations/010_catalogue_helpers.sql` (nouveau)
  - `src/app/dashboard/catalogue/page.tsx` (nouveau)
  - `src/app/dashboard/prices/page.tsx` (nouveau)
  - `src/app/dashboard/indices/page.tsx` (nouveau)
  - `src/app/api/catalogue/route.ts` (nouveau)
  - `src/app/api/prices/route.ts` (nouveau)
  - `src/app/api/indices/route.ts` (nouveau)
- Taches:
  - CRUD catalogue, prix fournisseur et indices.
  - RPC bulk create prices / bulk upsert indices.
  - Helper import->catalogue et liaison mapped rows.
- Criteres d'acceptation:
  - Les prix/indices sont consultables et modifiables via UI.
  - Operations bulk >100 lignes restent stables et tracees.

### BC-010 - Flags qualite de chiffrage dans l'editeur
- Priorite: `P2`
- Effort: `M`
- Type: Fonctionnel
- Statut: `TODO`
- Description:
  - Exposer les alertes de qualite sur les lignes (prix manquant/obsolete, temps manquant, etc.).
- Fichiers cibles:
  - `src/lib/estimate-quality.ts` (nouveau)
  - `src/components/estimates/EstimateEditorTable.tsx`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx`
- Taches:
  - Implementer calcul flags a partir des donnees prix/indices/temps.
  - Ajouter indicateurs visuels et filtre lignes en anomalie.
- Criteres d'acceptation:
  - Au moins 4 flags metier remontent en UI et dans export recap.

### BC-011 - Multi-tenant complet (option SaaS)
- Priorite: `P2`
- Effort: `XL`
- Type: Fonctionnel + Technique
- Statut: `TODO`
- Description:
  - Introduire isolation par tenant et roles (`admin/engineer/viewer`) sur l'ensemble du domaine.
- Fichiers cibles:
  - `supabase/migrations/011_multitenant_core.sql` (nouveau)
  - `middleware.ts`
  - `src/components/UserContext.tsx`
  - `src/app/api/**` (ajout tenant context)
- Taches:
  - Tables `tenants`, `tenant_memberships` et adaptation des FK.
  - Propagation `tenant_id` dans toutes les requetes serveur.
  - Ecrans admin membership.
- Criteres d'acceptation:
  - Un utilisateur ne voit que les donnees de son tenant.
  - Les autorisations rolees sont appliquees en API + DB.

---

## Definition of Done (globale)
- Lint + typecheck passent: `npm run lint`, `npm run typecheck`.
- Tests unitaires calcul passent: `npm run test`.
- Scenarios e2e chiffrage critiques valides (create/edit/duplicate/status/print/export).
- Chaque migration est reversible ou idempotente selon besoin.
- Aucun secret expose dans le repo.

## Risques principaux
- Couplage fort UI actuelle <-> Supabase client dans `src/app/dashboard/estimates/[versionId]/edit/page.tsx`.
- Derive schema vs migrations si `schema.sql` reste source de verite unique.
- Regressions perf lors de saves massifs sans RPC bulk.

## Ordre de lancement recommande
1. BC-001
2. BC-004
3. BC-002
4. BC-003
5. BC-005
6. BC-006
7. BC-007
8. BC-008
9. BC-009
10. BC-010
11. BC-011
