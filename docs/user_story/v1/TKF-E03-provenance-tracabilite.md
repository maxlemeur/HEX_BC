# TKF-E03 — Provenance & Tracabilite

> Phase: 1 (MVP) | Priorite: P1 | Statut: Termine (fichier fini)

## Objectif

Assurer la tracabilite complete des items issus du takeoff : chaque ligne du devis generee
par l'IA porte des metadonnees de provenance (provider, job_id, fichier source, page), les
actions sont auditees, et un badge visuel dans l'editeur indique l'origine IA des lignes.

## Ce qui existe deja

- **Audit logs** : table `audit_logs`, trigger `log_estimate_audit()`,
  `snapshot_estimate_item_bulk_updates()` — pattern d'audit existant.
- **Table estimate_items** : `src/lib/estimates/server.ts` — `createEstimateItem()`,
  `updateEstimateItem()`.
- **Editeur devis** : `src/components/estimates/EstimateEditorTable.tsx` — composant
  table existant ou integrer le badge.
- **Schema DB** : `supabase/schema.sql` — structure des tables estimate_items.

---

## TKF-014 — Meta source sur estimate_items (provider, job_id, source_file, source_page)

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux que chaque ligne de devis generee par le takeoff conserve
> les informations de sa source (outil, job, fichier, page), afin de pouvoir toujours
> retracer l'origine d'une donnee.

### Criteres d'acceptation

- [ ] Migration additive cree les colonnes:
  - `source_provider` (text, nullable)
  - `source_job_id` (uuid, nullable FK `takeoff_jobs`)
  - `source_file_name` (text, nullable)
  - `source_page` (int, nullable)
- [ ] Backward compatibility garantie:
  - aucune rupture sur donnees existantes
  - valeur par defaut `source_provider='manual'` pour creations manuelles
- [ ] `createEstimateItem()` et batch APIs acceptent les champs source optionnels
- [ ] Apply takeoff renseigne automatiquement les champs source pour chaque ligne
- [ ] Index pour tracabilite:
  - `estimate_items(source_job_id)`
  - `estimate_items(tenant_id, source_job_id)`
- [ ] Tests verifies:
  - insertion manuelle => `source_provider='manual'`
  - insertion via takeoff => source completee
  - lecture cross-tenant interdite

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/xxx_takeoff_provenance.sql`
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — `createEstimateItem()` pour accepter les champs source
  - `src/lib/estimates/schemas.ts` — schema de creation item pour les champs optionnels
- Reutiliser :
  - Pattern migration additive existant
- Dependances : TKF-001

---

## TKF-015 — Audit logs takeoff actions

**Priorite:** P1 | **Effort:** M

### User Story

> En tant qu'admin, je veux que toutes les actions takeoff (creation job, traitement,
> review, apply) soient tracees dans les audit logs, afin de disposer d'un historique
> complet pour conformite et debugging.

### Criteres d'acceptation

- [ ] Catalogue d'evenements audites implemente:
  - `takeoff.job.created|processing|completed|failed|retried|canceled`
  - `takeoff.item.excluded|modified`
  - `takeoff.apply.started|completed|failed`
- [ ] Helper unique `src/lib/takeoff/audit.ts` utilise par API/processor/UI backend
- [ ] Chaque audit log contient au minimum:
  - `user_id`, `tenant_id`, `job_id`, `action`, `metadata`, `created_at`
- [ ] `metadata` normalisee par action (schema stable pour QA)
- [ ] Ecritures d'audit resilientes:
  - un echec audit ne doit pas masquer une erreur metier critique
  - log d'erreur technique produit si audit echec
- [ ] Tests integration valident presence d'audit pour create/retry/cancel/review/apply

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/audit.ts` (helpers d'audit takeoff)
- Reutiliser :
  - Table `audit_logs` existante et trigger `log_estimate_audit()`
  - `src/lib/estimates/server.ts` — pattern d'audit existant
- Dependances : TKF-001

---

## TKF-016 — Badge "IA" + popover provenance dans l'editeur devis

**Priorite:** P1 | **Effort:** S

### User Story

> En tant que chiffreur, je veux voir clairement quelles lignes du devis proviennent
> de l'extraction IA, avec un badge et des details de provenance au survol, afin de
> distinguer les donnees generees automatiquement de la saisie manuelle.

### Criteres d'acceptation

- [ ] Badge `IA` visible uniquement si `source_provider='takeoff_gemini'`
- [ ] Popover (hover + clic) affiche:
  - `source_file_name`
  - `source_page` (si disponible)
  - date extraction
  - niveau A/B/C
  - lien vers job source (si accessible)
- [ ] Fallback robuste:
  - metadata partielle => champs manquants remplaces par `Non disponible`
  - job supprime/inaccessible => lien desactive sans erreur UI
- [ ] Accessibilite:
  - `role="tooltip"` ou popover equivalent
  - focus clavier + fermeture `Esc`
  - texte lisible lecteur d'ecran
- [ ] Tests composant couvrent rendu badge, popover, et cas metadata manquante

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffSourceBadge.tsx`
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — integration du badge
    dans la colonne designation
- Reutiliser :
  - Meta source ajoutees par TKF-014
- Dependances : TKF-013, TKF-014, TKF-015 (items appliques au devis)
