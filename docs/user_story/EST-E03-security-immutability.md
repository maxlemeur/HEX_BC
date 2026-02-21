# EST-E03 — Security & Immutability

> Milestone: M0 | Priorite: P0 | Statut: A faire

## Objectif

Garantir l'integrite des donnees de chiffrage par le controle de concurrence optimiste,
le verrouillage pessimiste des brouillons et le scellement cryptographique des versions
envoyees. Cette epic protege contre la perte de donnees en edition simultanee et
fournit une preuve d'integrite pour les versions contractuelles.

## Ce qui existe deja

Les sprints BC-001 et BC-002 ont mis en place les mecanismes de securite suivants :

- **RLS policies scoped user + tenant** : migration
  `004_harden_estimate_devis_rls_s1.sql`, toutes les tables `estimate_*`
  sont protegees par RLS avec filtre `tenant_id` via `current_tenant_id()`
- **Trigger d'immutabilite** : `guard_estimate_versions_readonly()` dans le schema SQL
  bloque toute mise a jour (`UPDATE`) sur les versions dont le statut n'est pas `draft`
- **Transitions de statut** : `patchEstimateStatus()` dans
  `src/lib/estimates/server.ts` enforce les transitions valides :
  `draft` -> `sent` -> `accepted` -> `archived` (pas de retour arriere)
- **Erreurs normalisees** : `src/lib/estimates/errors.ts` —
  `forbidden()` pour les violations RLS, `mapSupabaseError()` pour traduire
  les erreurs Supabase en codes applicatifs, code `READ_ONLY` pour les
  tentatives d'ecriture sur versions non-draft
- **Role checks** : toutes les routes API (`src/app/api/estimates/...`)
  verifient le role du membre (`admin`, `engineer`, `viewer`) via
  `has_tenant_role()` avant d'autoriser les operations
- **Audit trail** : table `audit_logs`, trigger `log_estimate_audit()`,
  fonction `snapshot_estimate_item_bulk_updates()` pour la tracabilite
  des modifications

---

## EST-044 — Optimistic concurrency control

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux etre averti si un autre utilisateur a modifie
> le devis pendant que je travaillais, afin d'eviter d'ecraser ses modifications
> et de perdre du travail.

### Criteres d'acceptation

- [ ] Le champ `updated_at` de `estimate_versions` est utilise comme jeton
      de concurrence (concurrency token)
- [ ] Le client envoie l'en-tete `If-Match: <updated_at_iso>` (ou champ dans
      le body) lors de chaque `PATCH` sur `/api/estimates/[versionId]`
- [ ] Le serveur (`patchEstimateVersion()` dans `server.ts`) compare la valeur
      recue avec `updated_at` en base :
  - Si identique : mise a jour effectuee normalement
  - Si different : retour `409 Conflict` via `conflict()` avec message
    "Version modifiee par un autre utilisateur"
- [ ] Meme logique appliquee a `bulkUpdateEstimateItems()` : le `updated_at`
      de la version parente est verifie avant le bulk update
- [ ] Cote client (`src/lib/estimates/client.ts`), gestion du code 409 :
  - Affichage d'une notification/toast "Ce devis a ete modifie par un
    autre utilisateur"
  - Bouton "Recharger" qui rafraichit les donnees depuis le serveur
  - Les modifications locales non sauvegardees sont preservees dans
    un state temporaire pour permettre une fusion manuelle
- [ ] Page d'edition (`edit/page.tsx`) : indicateur visuel quand un conflit
      est detecte, desactivation du bouton "Enregistrer" jusqu'au rechargement
- [ ] Tests unitaires : scenario sans conflit (OK), scenario avec conflit (409),
      scenario avec `updated_at` manquant (400 Bad Request)

### Notes techniques

- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — `patchEstimateVersion()` et
    `bulkUpdateEstimateItems()` : ajouter verification `updated_at`,
    utiliser `conflict()` de `errors.ts`
  - `src/lib/estimates/client.ts` — gestion du code 409 dans les
    wrappers `patchEstimateVersion()` et `bulkUpdateEstimateItems()`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — UI de
    detection de conflit, toast, bouton recharger
  - `src/app/api/estimates/[versionId]/route.ts` — propagation du
    header `If-Match` au serveur
  - `src/app/api/estimates/[versionId]/items/bulk/route.ts` — idem
- Reutiliser :
  - `src/lib/estimates/errors.ts` — `conflict()` (code `CONFLICT`, HTTP 409)
  - `src/lib/estimates/schemas.ts` — ajouter `updated_at` optionnel
    dans `patchEstimateVersionSchema`
- Dependances : aucune

---

## EST-045 — Draft lock (pessimistic)

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux verrouiller un brouillon pendant mon edition,
> afin qu'un collegue ne puisse pas modifier simultanement le meme devis
> et creer des conflits.

### Criteres d'acceptation

- [ ] Nouvelle table `draft_locks` :
  - `version_id` (FK vers `estimate_versions`, unique)
  - `user_id` (FK vers `auth.users`)
  - `locked_at` (timestamptz, defaut `now()`)
  - `expires_at` (timestamptz, defaut `now() + interval '30 minutes'`)
  - `tenant_id` (FK vers `tenants`)
- [ ] RLS sur `draft_locks` : lecture pour tous les membres du tenant,
      ecriture/suppression pour le proprietaire du lock ou les admins
- [ ] Acquisition du lock : a l'ouverture de la page d'edition, tentative
      d'`INSERT` dans `draft_locks`. Si le lock existe et n'est pas expire,
      retourner `conflict()` avec le nom de l'utilisateur qui detient le lock
- [ ] Liberation du lock : `DELETE` dans `draft_locks` au depart de la page
      (beforeunload event), a la sauvegarde, ou par timeout
- [ ] Renouvellement automatique : heartbeat toutes les 5 minutes pour
      etendre `expires_at` tant que l'utilisateur est actif
- [ ] Nettoyage des locks expires : job ou verification a l'acquisition
      (supprimer les locks ou `expires_at < now()`)
- [ ] UI dans `edit/page.tsx` :
  - Indicateur "Verrouille par [prenom nom]" si un autre utilisateur
    detient le lock
  - Mode lecture seule si le lock est detenu par un autre
  - Bouton "Forcer le deverrouillage" visible uniquement pour les admins
- [ ] Tests unitaires : acquisition OK, acquisition en conflit, expiration,
      liberation, renouvellement

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/025_draft_locks.sql` (ou numero suivant)
  - `src/lib/estimates/locks.ts` — fonctions `acquireLock()`,
    `releaseLock()`, `renewLock()`, `getLockInfo()`,
    `forceReleaseLock()` (admin only)
  - `src/app/api/estimates/[versionId]/lock/route.ts` — POST (acquire),
    DELETE (release), PATCH (renew)
  - `src/hooks/useDraftLock.ts` — hook client avec heartbeat et
    cleanup sur unmount
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — integration
    du hook `useDraftLock`, affichage lock status, mode lecture seule
  - `src/lib/estimates/client.ts` — wrappers pour les endpoints lock
- Reutiliser :
  - `src/lib/estimates/errors.ts` — `conflict()`, `forbidden()`
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
  - `profiles` table pour afficher le nom du detenteur du lock
- Dependances : EST-044 (le lock pessimiste complete le controle optimiste)

---

## EST-046 — Immutability seal on sent versions

**Priorite:** P2 | **Effort:** S

### User Story

> En tant qu'admin, je veux que les versions envoyees soient scellees avec un hash
> d'integrite, afin de prouver qu'aucune modification n'a eu lieu apres l'envoi
> au client et de garantir la valeur contractuelle du devis.

### Criteres d'acceptation

- [ ] Nouvelle colonne `seal_hash` (text, nullable) sur `estimate_versions`
- [ ] Au passage du statut `draft` -> `sent` (dans `patchEstimateStatus()`),
      calcul du hash SHA-256 sur un payload canonique comprenant :
  - Tous les items (id, position, type, title, quantity, unit_price_ht_cents,
    tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht/tax/ttc_cents)
  - Les totaux de la version (total_ht/tax/ttc_cents, margin_multiplier,
    discount_bp, tax_rate_bp, rounding_mode, rounding_step_cents)
  - Le `version_number` et la `date_devis`
- [ ] Le hash est stocke dans `seal_hash` et ne peut plus etre modifie
      (protege par `guard_estimate_versions_readonly()`)
- [ ] Endpoint de verification GET `/api/estimates/[versionId]/verify` :
  - Recalcule le hash depuis les donnees actuelles
  - Compare avec `seal_hash`
  - Retourne `{ valid: true/false, computed_hash, stored_hash }`
- [ ] UI : badge "Scelle" (vert) ou "Integrite compromise" (rouge)
      affiche sur la page de detail et la page d'impression
- [ ] Log dans `audit_logs` a chaque scellement : action `'seal'`,
      `new_data` contient le hash
- [ ] Tests unitaires : scellement au send, verification OK,
      detection de tampering (modification directe en DB)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/026_seal_hash.sql` (ou numero suivant) —
    `ALTER TABLE estimate_versions ADD COLUMN seal_hash text`
  - `src/lib/estimates/seal.ts` — fonctions `computeSealHash(version, items)`,
    `verifySealHash(versionId)`, type `SealPayload`
  - `src/app/api/estimates/[versionId]/verify/route.ts` — GET verification
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — `patchEstimateStatus()` : appeler
    `computeSealHash()` lors de la transition `draft` -> `sent`,
    stocker dans `seal_hash`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — badge seal status
  - `src/app/dashboard/estimates/[versionId]/print/page.tsx` — badge seal status
- Reutiliser :
  - `src/lib/estimates/server.ts` — `listEstimateItems()` pour recuperer
    les items au moment du scellement
  - `src/lib/estimates/errors.ts` — `badRequest()`, `notFound()`
  - Trigger existant `guard_estimate_versions_readonly()` protege
    naturellement le hash apres scellement
  - Trigger `log_estimate_audit()` pour la trace d'audit
- Dependances : aucune
