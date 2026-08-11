# Cycle de vie, immutabilité et validation

> **Statut : à jour au 2026-07-29**, établi par lecture du code et des migrations.
> Chaque règle est ancrée sur un `fichier:ligne`.

---

## 1. Statuts d'un devis

`estimate_status = ('draft', 'sent', 'accepted', 'archived')` — `supabase/schema.sql:70`

> ⚠️ Il n'existe **aucun statut `canceled`**. Deux documents historiques l'ont affirmé ; c'était faux.

### Transitions autorisées

```
draft ──────► sent ──────► accepted ──────► archived
                │                              ▲
                └──────────────────────────────┘
```

`src/lib/estimates/server.ts:628-635`, contrôlées côté serveur (`:1945-1956`) **et** par le trigger DB
`validate_estimate_version_transition` (`025_est046_seal_and_events.sql`).

**Il n'existe aucun retour en arrière.** Pas de `sent → draft`. Un devis envoyé par erreur ne peut pas
être « remis en brouillon » : il faut créer une nouvelle version.

### Statut d'affaire

🔴 **Il n'y en a pas.** `estimate_projects` ne porte qu'un booléen `is_archived`
(`schema.sql:334-344`). Le type `AffaireStatus` est un simple alias de `estimate_status`
(`src/lib/affaires/schemas.ts:30`) — c'est le statut du **devis** qui est affiché comme statut
d'affaire.

Conséquence métier : ni prospect / à chiffrer / remis / gagné / perdu, ni date de remise, ni motif de
perte, donc **aucun taux de transformation mesurable**. Voir
[ecarts-standards-btp.md](ecarts-standards-btp.md).

---

## 2. Immutabilité — trois couches

### Couche 1 — Trigger base de données

`guard_estimate_versions_readonly`
(`supabase/migrations/20260727020000_estimate_version_integrity.sql:9-53`)

Hors statut `draft`, toute modification de l'une des **24 colonnes contractuelles** lève
`Estimate version is read-only`.

> Règle peu intuitive et rarement documentée : **un `UPDATE` qui ne change pas le statut est refusé
> d'office** hors brouillon (`:16-18`). Il ne suffit donc pas de « ne rien modifier de sensible ».

### Couche 2 — Garde applicatif

`assertDraftStatus` → `forbidden(..., "READ_ONLY")` — `src/lib/estimates/locks.ts:103-110`,
appelé sur une vingtaine de sites d'écriture.

### Couche 3 — Verrou de brouillon (pessimiste)

`src/lib/estimates/locks.ts`

| Propriété | Valeur |
|---|---|
| TTL | **2 minutes** |
| Titulaires simultanés | 1 couple `(utilisateur, page)` par version |
| Conflit | HTTP **409** (`:302-304`) |
| Forçage | **admin uniquement** (`:473-494`) |
| Nettoyage | RPC `cleanup_expired_draft_locks` |
| Renouvellement / reprise | heartbeat 30 s ; nouvelle tentative 5 s + focus |

Une écriture sans bail correspondant à l'utilisateur **et** à l'UUID de la page (`x-estimate-draft-lock-session-id`) est refusée. Deux onglets du même compte sont donc traités comme deux éditeurs concurrents. Le module takeoff sonde également la possession du verrou avant d'appliquer un job.

---

## 3. Scellement

Au passage **`draft → sent` uniquement** (`server.ts:8417-8428`) :

1. Génération PDF forcée.
2. Calcul du hash d'un **payload canonique** : items triés par `position` puis `id`, payload en
   version 2 (`:1958-2090`).
3. Écriture de `seal_hash`, **immuable** hors cette transition.

Vérification : `verifyEstimateSeal` / route `GET /api/estimates/[versionId]/verify`.

> **Précédent à connaître** : un commit a déjà **invalidé les sceaux de tout le parc** en modifiant le
> payload canonique, avant d'être réparé. Toute évolution du payload doit être additive et
> conditionnelle — le traitement de `contractor_role` en donne le modèle : le champ n'entre dans le
> payload **que s'il diffère de sa valeur par défaut** (`server.ts:2066-2068`).

---

## 4. Rôles et autorisations

`tenant_role = ('admin', 'engineer', 'viewer', 'director')`

| Action | Rôles autorisés |
|---|---|
| Écriture sur un devis en brouillon | `admin`, `engineer` (`write-access.ts:7-9`) |
| Approbation | `admin`, `director` (`rules-engine.ts:911-913`) |
| CRUD des règles, forçage d'envoi, forçage de verrou, override takeoff, taux de change | `admin` seul |
| Lecture | tous les membres du tenant |

L'isolation multi-tenant est portée par les RLS (**664 policies**), avec `force row level security` sur
les tables sensibles. `src/proxy.ts` rafraîchit la session et redirige selon la présence d'un
utilisateur ; **les rôles et autorisations tenant restent portés par le serveur et le RLS**.

---

## 5. Gating d'envoi

`src/lib/estimates/gating.ts`

**19 drapeaux**, dont 11 **bloquants** par défaut et 8 avertissements. Bloquants notables :
`missing_price`, `missing_quantity`, `no_pdf_generated`, `rule_violation`, `total_exceeds_budget`.

La sévérité de chaque drapeau est **surchargeable par tenant** via feature flag (`:186-228`).

Le forçage d'envoi est **admin-only et journalisé** (`server.ts:8394-8415`).

Endpoint de consultation : `GET /api/estimates/[versionId]/gating`.

---

## 6. Règles et approbations

### Moteur de règles

`src/lib/estimates/rules-engine.ts` (4 923 lignes)

| Dimension | Valeurs |
|---|---|
| **Types** | `min_margin`, `max_discount`, `require_approval`, `dpgf_coverage_min`, `takeoff_evidence_coverage_min`, `critical_exceptions_max`, `missing_line_evidence_max` |
| **Actions** | `warn`, `block`, `require_approval` |
| **Portées** | `global`, `category`, `client` |

**Aucun seuil n'est codé en dur** : tout provient du `threshold_value` défini par le tenant
(`:1158-1271`).

> ⚠️ Le type `min_margin` est actuellement **faussé** : le moteur lit `margin_bp`, qui vaut `0` par
> défaut sur la quasi-totalité du parc. Voir
> [regles-de-calcul.md § 3.3](regles-de-calcul.md).

### Invalidation automatique

Une approbation n'est valide que si `approved_content_revision === currentContentRevision`
(`:1490-1544`).

> **Toute modification du devis invalide silencieusement les approbations antérieures.** Règle de
> gouvernance forte, et invisible pour l'utilisateur.

### Journal de décision

Append-only, états `approved`, `approved_with_reservations`, `changes_requested`
(`approval-decision-journal.ts:9-12`).

Revue multi-rôle : `estimate_review_cycles`, `estimate_review_comments`,
`estimate_review_correction_items`. File d'approbation via la RPC `list_approval_queue`.

---

## 7. Versions, variantes et duplication

| Opération | Mécanisme |
|---|---|
| **Duplication** | RPC `duplicate_estimate_version` — repart en `draft`, sceau non repris |
| **Variante** | `createEstimateVariant` / `promoteEstimateVariant` — chiffrage alternatif avant signature |
| **Diff** | `src/lib/estimates/diff.ts`, route `/diff` |
| **Changelog** | `estimate_version_changelogs`, cache par version |
| **Événements** | `estimate_version_events`, **append-only** (trigger `guard_estimate_version_events_append_only`) |

⚠️ Bug ouvert : la duplication de version fait perdre la fonction « Expliquer ce prix »
(`docs/backlog/bugs-est-e23/EST-433.md`).

---

## 8. Portail client

`src/app/portal/[token]/` — surface **publique**, accessible par token seul.

| Élément | Détail |
|---|---|
| Table | `portal_tokens` |
| Actions | `POST /api/portal/[token]/accept`, `POST /api/portal/[token]/reject` |
| Signature | `SignaturePad.tsx` |
| Concurrence | RPC `claim_portal_estimate_decision` |
| Expiration | Route `expired/` dédiée |

La lecture du devis passe par un **Server Component**, pas par une route API.

C'est une surface à haut risque : token public, effets de bord contractuels (acceptation),
déclenchement d'emails.

---

## 9. Application d'un métré au devis

`src/lib/takeoff/server.ts`

| Règle | Détail |
|---|---|
| Stratégies | `append`, `replace`, `merge` |
| Portées | `section`, `version` |
| **One-shot** | Le job passe en `applied` ; un ré-appel renvoie **409** (`:7546-7558`, `:7809-7821`) |
| Verrou | Exige la possession du verrou de brouillon (`:7053-7105`) |
| Garde de confiance | **Niveau C uniquement** ; blocage sous 0,5 |
| Forçage | Rôle **admin** + justification de **10 à 500 caractères** (`:7568-7641`) |
| État intermédiaire | `partial_apply` si les transformations de mapping échouent après insertion (`:7726-7801`) |

**L'application est irréversible** : il n'existe pas d'annulation.

---

## Voir aussi

- [regles-de-calcul.md](regles-de-calcul.md) — formules, arrondis, TVA, marge
- [glossaire.md](glossaire.md) — vocabulaire du chiffrage BTP
- [ecarts-standards-btp.md](ecarts-standards-btp.md) — ce qui manque face au métier
