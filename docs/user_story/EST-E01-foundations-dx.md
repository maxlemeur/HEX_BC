# EST-E01 — Foundations & DX

> Milestone: M0 | Priorite: P0 | Statut: A faire

## Objectif

Stabiliser les fondations techniques du module de chiffrage : configuration, outillage DX,
feature flags par tenant et design system. Cette epic garantit que les developpements V1
s'appuient sur un socle fiable, coherent et maintenable.

## Ce qui existe deja

Les sprints BC-001, BC-002, BC-003, BC-004 et BC-011 ont pose les bases suivantes :

- **RLS policies scoped user + tenant** : migration `004_harden_estimate_devis_rls_s1.sql`,
  fonctions DB `current_tenant_id()`, `is_tenant_member()`, `has_tenant_role()`
- **Couche serveur API** : `src/lib/estimates/server.ts` (~1600 lignes), fonctions
  `listLatestEstimates()`, `createEstimate()`, `getEstimateVersionDetails()`,
  `patchEstimateVersion()`, `patchEstimateStatus()`, `createEstimateItem()`,
  `updateEstimateItem()`, `bulkUpdateEstimateItems()`, `deleteEstimateItem()`,
  `reorderEstimateItems()`, `createEstimateCategory()`, `createLaborRole()`,
  `updateLaborRole()`, `createSuggestionRule()`, `updateSuggestionRule()`
- **Client API wrappers** : `src/lib/estimates/client.ts` (~850 lignes), miroir des
  fonctions serveur via `fetch`
- **Schemas Zod** : `src/lib/estimates/schemas.ts` — `createEstimateSchema`,
  `patchEstimateVersionSchema`, `patchEstimateStatusSchema`,
  `createEstimateItemSchema`, `updateEstimateItemSchema`,
  `bulkUpdateEstimateItemsSchema`, `deleteEstimateItemSchema`,
  `reorderEstimateItemsSchema`, `createEstimateCategorySchema`,
  `createLaborRoleSchema`, `updateLaborRoleSchema`,
  `createSuggestionRuleSchema`, `updateSuggestionRuleSchema`
- **Erreurs normalisees** : `src/lib/estimates/errors.ts` — `ApiError`, `ok()`,
  `badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`,
  `internalError()`, `mapSupabaseError()`, `toErrorResponse()`
- **Migrations incrementales** : 21 migrations (001-021) dans `supabase/migrations/`
- **Tests unitaires moteur** : `estimate-calculations.test.ts` via Vitest
- **Multi-tenant core** : tables `tenants`, `tenant_memberships`, role checks
  (admin/engineer/viewer) dans toutes les routes API

---

## EST-006 — Feature flags runtime

**Priorite:** P1 | **Effort:** M

### User Story

> En tant qu'admin, je veux activer ou desactiver des fonctionnalites par tenant via des
> feature flags, afin de deployer progressivement les nouvelles fonctions V1 sans risque.

### Criteres d'acceptation

- [ ] Table `feature_flags` creee avec colonnes `tenant_id`, `flag_key`, `enabled`,
      `created_at`, `updated_at`
- [ ] RLS policy sur `feature_flags` : lecture pour tous les membres du tenant,
      ecriture reservee aux admins
- [ ] Helper serveur `isFeatureEnabled(tenantId: string, key: string): Promise<boolean>`
      avec valeur par defaut `false` si le flag n'existe pas
- [ ] Cache cote client avec revalidation (SWR ou React Query) pour eviter
      les appels repetitifs
- [ ] Route API GET `/api/feature-flags?tenant_id=xxx` retourne la liste des flags actifs
- [ ] Route API PATCH `/api/feature-flags` pour toggle un flag (admin uniquement)
- [ ] Page admin `/dashboard/admin/flags` avec tableau des flags, toggle switch,
      recherche par cle
- [ ] Les flags sont consultes dans les composants existants via un hook
      `useFeatureFlag(key)` qui renvoie `boolean`
- [ ] Tests unitaires pour le helper serveur (flag actif, inactif, inexistant)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/022_feature_flags.sql`
  - `src/lib/feature-flags.ts` (helper serveur + types)
  - `src/hooks/useFeatureFlag.ts` (hook client)
  - `src/app/api/feature-flags/route.ts` (GET + PATCH)
  - `src/app/dashboard/admin/flags/page.tsx`
- Reutiliser :
  - `src/lib/estimates/errors.ts` — `forbidden()`, `badRequest()`, `toErrorResponse()`
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
  - `src/lib/supabase/client.ts` — `createSupabaseBrowserClient()`
  - Fonctions DB `has_tenant_role()` pour le controle d'acces admin
- Dependances : aucune

---

## EST-007 — Design system tokens & component kit

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux une interface coherente et rapide avec des composants
> standardises, afin de travailler efficacement dans l'editeur de devis.

### Criteres d'acceptation

- [ ] Fichier de tokens CSS definissant les variables de design :
      couleurs primaires/secondaires/neutres, espacements (4/8/12/16/24/32/48px),
      typographie (tailles, poids, line-height), rayons de bordure, ombres
- [ ] Extension de la config Tailwind CSS 4 pour mapper les tokens vers des
      classes utilitaires (`bg-primary`, `text-muted`, `space-y-md`, etc.)
- [ ] Composants de base implementes en React avec TypeScript strict :
  - `Button` — variantes primary/secondary/ghost/danger, tailles sm/md/lg,
    loading state, icone optionnelle
  - `Input` — label, erreur, helper text, prefixe/suffixe
  - `Select` — options, placeholder, erreur, searchable optionnel
  - `Modal` — titre, body, footer, fermeture ESC/click outside,
    accessibilite (focus trap, aria)
  - `Toast` — variantes success/error/warning/info, auto-dismiss configurable
  - `Badge` — variantes couleur, tailles sm/md
- [ ] Tous les composants acceptent `className` pour extension Tailwind
- [ ] Accessibilite : roles ARIA, navigation clavier, contraste AA minimum
- [ ] (Optionnel) Configuration Storybook pour documentation interactive

### Notes techniques

- Fichiers a creer :
  - `src/styles/tokens.css` (variables CSS custom properties)
  - `src/components/ui/Button.tsx`
  - `src/components/ui/Input.tsx`
  - `src/components/ui/Select.tsx`
  - `src/components/ui/Modal.tsx`
  - `src/components/ui/Toast.tsx`
  - `src/components/ui/Badge.tsx`
  - `src/components/ui/index.ts` (barrel export)
- Fichiers a modifier :
  - `tailwind.config.ts` ou equivalent Tailwind CSS 4 pour integrer les tokens
- Reutiliser :
  - Composants existants dans `src/components/estimates/` comme reference
    de style et patterns (ex: `EstimateEditorTable.tsx` pour les patterns d'interaction)
- Dependances : aucune
