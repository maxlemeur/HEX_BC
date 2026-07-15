# TKF-E07 — Mapping Rules & Revisions (optionnel)

> Phase: 4 | Priorite: P2 | Statut: Largement implemente au 2026-03-07

## Objectif

Enrichir le pipeline takeoff avec des regles de mapping configurables (conversion de
designations, enrichissement automatique, ouvrages) et un systeme de revision delta
permettant de comparer deux extractions sur le meme document pour detecter les differences.

## Etat codebase au 2026-03-07

Cette epic est bien representee dans le code:
- CRUD de regles de mapping
- manager admin
- preview de conversion avant apply
- moteur de mapping
- comparaison entre jobs/revisions

Le principal decalage n'est pas technique mais produit:
- cette epic suppose un pipeline takeoff largement exploitable
- or les niveaux `B/C` ne sont pas encore vraiment exposes comme parcours de lancement standard
- il faut donc eviter que le statut `termine` laisse entendre que la promesse complete
  `plan -> chiffrage exploitable` est deja pleinement livree

## Ce qui existe deja

- **Pipeline takeoff avance** : TKF-E01 a TKF-E06 — socle, niveau A livre, B/C largement codes,
  async, provenance.
- **Apply Wizard** : `src/components/takeoff/TakeoffApplyWizard.tsx` — apply multi-etapes.
- **Ouvrages** : `src/lib/estimates/server.ts` — `insertAssemblyIntoVersion()`.
- **Templates** : pattern templates/ouvrages dans le module estimates (EST-E10).
- **Batch operations** : `src/lib/estimates/batch.ts`.

---

## TKF-029 — Table takeoff_mapping_rules + API CRUD

**Priorite:** P2 | **Effort:** L

### User Story

> En tant qu'admin, je veux definir des regles de mapping (correspondance de designations,
> prix par defaut, ouvrages automatiques), afin d'enrichir automatiquement les items
> extraits lors de l'application au devis.

### Criteres d'acceptation

- [ ] Migration idempotente cree `takeoff_mapping_rules` avec:
  - `tenant_id`, `name`, `match_pattern`, `match_type`, `action`, `action_params`,
    `priority`, `is_active`, `created_by`, timestamps
- [ ] RLS activee et testee (`SELECT/INSERT/UPDATE/DELETE`) scopee par tenant
- [ ] Validation forte:
  - `match_type` enum (`exact|contains|regex`)
  - `action` enum (`rename|set_price|set_category|apply_assembly|skip`)
  - `action_params` valide via schema discriminant par action
- [ ] API CRUD implementee:
  - `GET /api/takeoff/mapping-rules`
  - `POST /api/takeoff/mapping-rules`
  - `PATCH /api/takeoff/mapping-rules/[ruleId]`
  - `DELETE /api/takeoff/mapping-rules/[ruleId]`
- [ ] Index `takeoff_mapping_rules(tenant_id, is_active, priority)` present
- [ ] Endpoints documentes OpenAPI + tests integration CRUD/403/404/422

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/xxx_takeoff_mapping_rules.sql`
  - `src/app/api/takeoff/mapping-rules/route.ts`
  - `src/app/api/takeoff/mapping-rules/[ruleId]/route.ts`
- Reutiliser :
  - `src/lib/estimates/schemas.ts` — patterns validation Zod
  - `src/lib/estimates/errors.ts` — gestion erreurs
  - Pattern CRUD des routes API estimates existantes
- Dependances : TKF-001

---

## TKF-030 — UI Mapping Rules Manager (admin)

**Priorite:** P2 | **Effort:** M

### User Story

> En tant qu'admin, je veux une interface pour creer, modifier et organiser les regles
> de mapping du tenant, afin de configurer l'enrichissement automatique des extractions.

### Criteres d'acceptation

- [ ] UI manager accessible uniquement aux roles admin autorises
- [ ] Liste des regles avec colonnes clefs + etat actif/inactif
- [ ] Form creation/edition valide:
  - pattern/type/action/params/priority
  - contraintes dynamiques par action
- [ ] Reordonnancement priorite:
  - drag/drop ou edition numerique
  - persistance atomique de l'ordre
- [ ] Action `apply_assembly` propose selecteur d'ouvrages valides
- [ ] Preview regle disponible (test sur designation)
- [ ] Suppression avec confirmation + feedback succes/erreur
- [ ] Tests UI couvrent droits admin, CRUD, reorder, preview

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/MappingRulesManager.tsx`
  - `src/components/takeoff/MappingRuleEditor.tsx`
- Reutiliser :
  - `src/lib/takeoff/client.ts` — wrappers API mapping rules
  - Patterns UI existants (formulaires, listes, modals)
- Dependances : TKF-005, TKF-029

---

## TKF-031 — Apply avec mapping rules (conversion enrichie + ouvrages)

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que les regles de mapping s'appliquent automatiquement
> lors de l'application des items takeoff au devis, afin d'obtenir des lignes enrichies
> (designations normalisees, prix pre-remplis, ouvrages automatiques) sans saisie
> supplementaire.

### Criteres d'acceptation

- [ ] Moteur `mapping-engine` deterministe:
  - charge regles actives du tenant triees par priorite
  - applique la premiere regle qui match par item
  - conserve trace de la regle appliquee
- [ ] Actions supportees:
  - `rename`, `set_price`, `set_category`, `apply_assembly`, `skip`
- [ ] Endpoint `POST /api/takeoff/jobs/[jobId]/preview-conversion`:
  - renvoie transformations sans persistance
  - payload identique a celui utilise par apply final
- [ ] Apply wizard affiche preview avant/apres + override par item
- [ ] Items sans match restent inchanges
- [ ] Audit log inclut `rule_id`, `action`, `item_id`, `job_id`
- [ ] Tests integration valident determinisme, preview/apply coherence, et actions

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/mapping-engine.ts`
  - `src/app/api/takeoff/jobs/[jobId]/preview-conversion/route.ts`
- Fichiers a modifier :
  - `src/app/api/takeoff/jobs/[jobId]/apply/route.ts` — integration mapping
  - `src/components/takeoff/TakeoffApplyWizard.tsx` — etape preview conversion
- Reutiliser :
  - `src/lib/estimates/server.ts` — `insertAssemblyIntoVersion()` pour ouvrages
  - `src/lib/estimates/batch.ts` — operations bulk
- Dependances : TKF-013, TKF-029, TKF-030

---

## TKF-032 — Revision delta (comparaison 2 extractions, vue diff)

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que chiffreur, je veux comparer deux extractions successives du meme document
> pour voir ce qui a change (items ajoutes, supprimes, modifies), afin de suivre l'evolution
> des donnees entre revisions d'un plan.

### Criteres d'acceptation

- [ ] Endpoint `GET /api/takeoff/jobs/[jobId]/compare?with=[otherJobId]` retourne:
  - `added`, `removed`, `changed`, `unchanged`
  - resume compteurs par categorie
  - details `delta` par champ pour `changed`
- [ ] Algo matching documente/teste:
  - primaire fuzzy sur `designation`
  - secondaire sur `designation + source_page`
  - seuil configurable (defaut `0.8`)
- [ ] Endpoint secure tenant scope (les deux jobs doivent appartenir au meme tenant)
- [ ] `TakeoffDiffView` affiche:
  - code couleur et filtres
  - vue unifiee ou cote-a-cote
  - highlight champs modifies
- [ ] Support selection/cherry-pick des diffs a appliquer
- [ ] Tests unitaires couvrent matching, seuil, collisions et perf sur jeux volumineux

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/diff.ts` — algorithme de comparaison + matching
  - `src/app/api/takeoff/jobs/[jobId]/compare/route.ts`
  - `src/components/takeoff/TakeoffDiffView.tsx`
- Reutiliser :
  - Pattern diff existant dans le module estimates (EST-E12 versioning)
  - `src/lib/takeoff/server.ts` — requetes items par job
- Dependances : TKF-009, TKF-020, TKF-022 (au moins 2 jobs sur le meme document pour comparer)
