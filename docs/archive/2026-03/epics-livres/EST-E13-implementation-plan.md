# EST-E13 — Plan d'implementation Lifecycle Client

> Date: 2026-03-05
> Concerne: EST-241 (email), EST-242 (portail), EST-243 (signature), EST-244 (relance), EST-245 (negociation)
> Epic: [EST-E13](./EST-E13-lifecycle-client.md)
> Milestone: M4

---

## Audit de l'existant

| Brique | Etat | Fichier(s) cle(s) |
|--------|------|--------------------|
| Transitions de statut | Implemente | `src/lib/estimates/server.ts` — `patchEstimateStatus()` |
| Schema statut | Implemente | `src/lib/estimates/schemas.ts` — `patchEstimateStatusSchema` |
| Guard immutabilite DB | Trigger actif | `025_est046_seal_and_events.sql` — `guard_estimate_versions_readonly()` |
| Validation transitions DB | Trigger actif | `025_est046_seal_and_events.sql` — `validate_estimate_version_transition()` |
| Evenements version | Table + insert | `estimate_version_events` — types: sent, accepted, archived, rejected, seal_verified |
| Audit trail | Trigger actif | `010_estimate_audit_trail_s4.sql` — `log_estimate_audit()` |
| PDF + Seal hash | Genere au draft->sent | `patchEstimateStatus()` genere PDF et seal |
| URL portail | Helper existant | `src/app/dashboard/estimates/[versionId]/print/page.tsx` — `resolveEstimatePortalUrl()` |
| Print page | Implementee | `src/app/dashboard/estimates/[versionId]/print/` — `EstimateDocument`, `SealIntegrityBadge` |
| Storage bucket `devis` | Prive, 10 MB | `003_create_devis_storage.sql` — PDF + images |
| Composants UI | Custom (pas shadcn) | `src/components/ui/` — Modal, Button, Input, Select, Badge, Toast, etc. |
| Email | **Rien** | — |
| Portail client | **Rien** | — |
| Signature | **Rien** | — |

### Transitions de statut actuelles

```
draft    -> [sent]
sent     -> [accepted, archived]
accepted -> [archived]
archived -> []
```

Le type `rejected` existe dans `estimate_version_events.event_type` mais n'est pas encore une transition valide dans `patchEstimateStatus()`. Il faudra l'ajouter pour le refus via portail.

### Env vars portail

`NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` est deja referencee dans la print page. Le helper `resolveEstimatePortalUrl(versionId)` construit l'URL `/estimates/{versionId}`.

---

## Decisions techniques

| Decision | Options evaluees | Choix | Justification |
|----------|-----------------|-------|---------------|
| Provider email | Resend vs SendGrid | **Resend** | API simple, support natif React Email, meilleur DX, tarif startup |
| Templates email | React Email vs HTML brut | **React Email** | Composable, testable, coherent avec le stack React |
| Token portail | UUID v4 vs JWT signe | **UUID v4** | Stocke en DB, revocable, pas de secret cote client |
| Acces portail DB | Supabase anonymous vs service role | **Service role** cote serveur | Token portail = seul facteur d'auth, pas besoin de session Supabase |
| Signature canvas | Custom HTML5 Canvas vs `react-signature-canvas` | **Custom** | Besoin simple, evite une dependance |
| Cron relances | Vercel Cron vs Supabase Edge Function | **Vercel Cron** | Coherent avec le deploiement Next.js existant |
| Stockage signature | Bucket `devis` existant vs nouveau bucket | **Bucket `devis`** sous-dossier `signatures/` | Evite la creation d'un bucket supplementaire, mime types images deja autorises |

### Dependances npm a ajouter

```
resend                  # Provider email
@react-email/components # Templates email
```

### Variables d'environnement a ajouter

```env
# Email
RESEND_API_KEY=                          # Cle API Resend
EMAIL_FROM="Devis <devis@example.com>"   # Adresse expediteur

# Portail
NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL=    # Deja reference dans print page

# Cron
CRON_SECRET=                             # Secret pour proteger les endpoints cron

# Relances
ESTIMATE_REMINDER_DELAY_DAYS=7           # Delai avant premiere relance
ESTIMATE_MAX_REMINDERS=3                 # Nombre max de relances
```

---

## Schema de la base de donnees

### Nouvelle table : `portal_tokens`

```sql
CREATE TABLE portal_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  version_id    UUID NOT NULL REFERENCES estimate_versions(id),
  token         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email         TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  accepted_at   TIMESTAMPTZ,
  accepted_ip   INET,
  signature_url TEXT,
  reject_reason TEXT
);

CREATE INDEX idx_portal_tokens_token ON portal_tokens(token);
CREATE INDEX idx_portal_tokens_version ON portal_tokens(version_id);
```

**RLS :**
- Authentifie (role `authenticated`) : CRUD sur ses propres tenants
- Anonyme (role `anon`) : SELECT WHERE `token = :param AND expires_at > now() AND status = 'pending'`
  - Alternative preferee : pas de RLS anon, utiliser service role cote serveur

### Nouvelle table : `estimate_emails`

```sql
CREATE TABLE estimate_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  version_id    UUID NOT NULL REFERENCES estimate_versions(id),
  recipient     TEXT NOT NULL,
  cc            TEXT[],
  subject       TEXT NOT NULL,
  body          TEXT,
  type          TEXT NOT NULL DEFAULT 'initial'
                CHECK (type IN ('initial', 'reminder_1', 'reminder_2', 'reminder_3', 'acceptance_confirmation')),
  status        TEXT NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'failed', 'delivered', 'bounced')),
  provider_id   TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_estimate_emails_version ON estimate_emails(version_id);
CREATE INDEX idx_estimate_emails_type ON estimate_emails(version_id, type);
```

### Nouvelle table : `estimate_negotiations`

```sql
CREATE TABLE estimate_negotiations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  version_id        UUID NOT NULL REFERENCES estimate_versions(id),
  author_type       TEXT NOT NULL CHECK (author_type IN ('client', 'engineer')),
  author_name       TEXT,
  message           TEXT NOT NULL,
  line_adjustments  JSONB,
  portal_token_id   UUID REFERENCES portal_tokens(id)
);

CREATE INDEX idx_estimate_negotiations_version ON estimate_negotiations(version_id);
```

### Modification : `estimate_version_events`

Aucune modification de schema necessaire. Les types `rejected` et `accepted` existent deja. Ajouter le type `reminder_sent` si non present dans le CHECK constraint.

---

## Architecture des phases

```
Phase 0 — Migration DB (fondations)
  |
  +-- Phase 1 — EST-241 (envoi email)
  |     |
  |     +-- Phase 2 — EST-242 (portail client)
  |     |     |
  |     |     +-- Phase 3 — EST-243 (acceptation + signature)
  |     |     |
  |     |     +-- Phase 5 — EST-245 (negociation)  [parallelisable avec Phase 3]
  |     |
  |     +-- Phase 4 — EST-244 (relance auto)  [parallelisable avec Phase 2]
```

---

## Phase 0 — Migration DB (fondations)

**Effort : S | Pre-requis de toutes les phases**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `supabase/migrations/XXX_est_e13_portal_email_tables.sql` | Tables `portal_tokens`, `estimate_emails`, `estimate_negotiations` + index + RLS |

### Contenu de la migration

1. Creer table `portal_tokens` (cf. schema ci-dessus)
2. Creer table `estimate_emails` (cf. schema ci-dessus)
3. Creer table `estimate_negotiations` (cf. schema ci-dessus)
4. Policies RLS tenant-scoped pour les 3 tables (SELECT/INSERT/UPDATE pour authenticated)
5. Mettre a jour les types TypeScript apres migration (`src/types/database.ts`)

### Tests

- Verification via `npm run build` que les types sont coherents
- Test d'insertion/lecture via Supabase dashboard

---

## Phase 1 — EST-241 : Envoi par email

**Priorite : P0 | Effort : L | Depend de : Phase 0**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `src/lib/email/provider.ts` | Interface `EmailProvider` + factory Resend selon env var |
| `src/lib/email/send-estimate.ts` | Logique metier : composer email, attacher PDF, inserer lien portail |
| `src/lib/email/templates/estimate.tsx` | Template React Email pour l'envoi initial du devis |
| `src/app/api/estimates/[versionId]/send/route.ts` | Route handler POST pour l'envoi |
| `src/components/estimates/SendEstimateModal.tsx` | Modale de composition (to, cc, subject, message) |

### Fichiers a modifier

| Fichier | Modification |
|---------|-------------|
| `src/lib/estimates/server.ts` | Ajouter `createPortalToken(versionId, email, tenantId)` et `getEstimatePdfUrl(versionId)` |
| `src/lib/estimates/schemas.ts` | Ajouter `sendEstimateSchema` (to, cc, subject, message) |
| `src/types/database.ts` | Regenerer avec les nouvelles tables |

### Flux detaille

```
1. Utilisateur clique "Envoyer" sur un devis draft/sent
2. Modale SendEstimateModal s'ouvre
   - Champs : to (email), cc (multi-email optionnel), subject (pre-rempli), message (textarea)
   - Subject par defaut : "Devis {title} - {project_name}"
3. Soumission → POST /api/estimates/:versionId/send
4. Route handler :
   a. Auth + verification ownership via tenant_id
   b. Validation Zod du body (sendEstimateSchema)
   c. Si statut = draft : appeler patchEstimateStatus() pour draft → sent (genere PDF + seal)
   d. Creer portal_token (UUID, expires_at = now + 30j)
   e. Recuperer URL du PDF depuis storage bucket
   f. Construire l'email via template React Email (inclut lien portail)
   g. Envoyer via Resend (PDF en piece jointe)
   h. Inserer dans estimate_emails (type: 'initial')
   i. Retourner 200 avec confirmation
5. Toast de succes cote client
```

### Criteres d'acceptation (rappel EST-241)

- [x] Modale de composition d'email (to, cc, subject, message)
- [x] PDF du devis en piece jointe
- [x] Lien portail dans le corps de l'email
- [x] Envoi via Resend
- [x] Historique dans `estimate_emails`
- [x] Statut passe a `sent` apres envoi
- [x] Gestion des erreurs avec message a l'utilisateur

### Tests

- [ ] UT `send-estimate.ts` : composition de l'email, gestion erreurs provider
- [ ] UT `SendEstimateModal` : validation du formulaire, etats loading/error/success
- [ ] UT route handler : auth, validation, transitions de statut
- [ ] Integration : envoi reel via Resend en mode test

---

## Phase 2 — EST-242 : Portail client

**Priorite : P0 | Effort : L | Depend de : Phase 1**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `src/app/portal/[token]/page.tsx` | Page SSR publique — vue lecture seule du devis |
| `src/app/portal/[token]/layout.tsx` | Layout minimal (logo, pas de sidebar, pas d'auth Supabase) |
| `src/app/portal/[token]/not-found.tsx` | Page token invalide |
| `src/app/portal/[token]/expired/page.tsx` | Page token expire |
| `src/lib/portal/server.ts` | Logique serveur : validation token, recuperation devis, actions |
| `src/app/api/portal/[token]/route.ts` | GET : donnees du devis via token |
| `src/app/api/portal/[token]/accept/route.ts` | POST : acceptation (integre en Phase 3) |
| `src/app/api/portal/[token]/reject/route.ts` | POST : refus du devis |

### Fichiers a modifier

| Fichier | Modification |
|---------|-------------|
| `src/middleware.ts` (si existant) | Exclure `/portal/*` de la protection auth |
| `next.config.ts` | S'assurer que `/portal` n'est pas protege |

### Architecture du portail

```
/portal/[token]
  |
  +-- Layout public (pas d'auth Supabase)
  |     - Logo de l'entreprise
  |     - Pas de sidebar/navigation dashboard
  |     - Footer minimal
  |
  +-- Page principale
        - En-tete : nom du projet, reference du devis, date, validite
        - Corps : reutilisation de EstimateDocument (print layout)
        - Actions : boutons Accepter / Refuser
        - (Phase 5) : fil de negociation
```

### Logique serveur (`src/lib/portal/server.ts`)

```typescript
// Fonctions a implementer :
validatePortalToken(token: string)
  → Verifie existence + expires_at > now + status = 'pending'
  → Retourne { portal_token, version_id } ou erreur

getEstimateForPortal(versionId: string)
  → Utilise service role client (pas d'auth utilisateur)
  → Retourne les donnees du devis en lecture seule

rejectEstimate(token: string, reason?: string)
  → Met a jour portal_tokens.status = 'rejected'
  → Appelle patchEstimateStatus() sent → archived (ou un futur statut 'rejected')
  → Log evenement 'rejected' dans estimate_version_events
  → Envoie email de notification au chiffreur
```

### Points d'attention

- **Pas d'auth Supabase** pour le client : le token est le seul facteur d'acces
- Toutes les requetes DB cote portail utilisent le **service role** client
- Le layout ne doit pas importer de composants qui dependent de `useUser()` ou du contexte auth
- Reutiliser au maximum `EstimateDocument` de la print page

### Tests

- [ ] UT `server.ts` : validation token (valide, expire, invalide, deja accepte)
- [ ] UT page portail : rendu avec donnees mock
- [ ] UT route reject : transition de statut, notification
- [ ] E2E : parcours complet token → consultation → refus

---

## Phase 3 — EST-243 : Acceptation et signature

**Priorite : P1 | Effort : M | Depend de : Phase 2**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `src/components/portal/SignaturePad.tsx` | Canvas HTML5 pour signature manuscrite (souris + tactile) |

### Fichiers a modifier

| Fichier | Modification |
|---------|-------------|
| `src/app/portal/[token]/page.tsx` | Ajouter flux acceptation : confirmation → signature optionnelle → soumission |
| `src/app/api/portal/[token]/accept/route.ts` | Implementer : upload signature, transition sent → accepted |
| `src/lib/portal/server.ts` | Ajouter `acceptEstimate(token, signatureBase64?, ip)` |
| `src/lib/estimates/server.ts` | Enrichir `patchEstimateStatus()` pour metadata optionnel (signature_url, ip) |

### Composant SignaturePad

```
Specs :
- Canvas HTML5 responsive (min 300x150)
- Events souris (mousedown/move/up) + tactile (touchstart/move/end)
- Bouton "Effacer" pour recommencer
- Export en PNG base64 via canvas.toDataURL()
- Prop onSign(base64: string) pour remonter la signature
- Etat vide detectable (isEmpty)
```

### Flux d'acceptation

```
1. Client clique "Accepter le devis"
2. Modale de confirmation avec :
   - Resume du devis (montant TTC, reference)
   - SignaturePad (optionnel selon config tenant)
   - Checkbox "J'accepte les conditions"
3. Soumission → POST /api/portal/:token/accept
4. Route handler :
   a. Valider le token (pending + non expire)
   b. Si signature fournie : upload dans storage bucket devis/signatures/{version_id}.png
   c. Mettre a jour portal_tokens : status='accepted', accepted_at=now(), accepted_ip, signature_url
   d. Appeler patchEstimateStatus() pour sent → accepted avec metadata
   e. Log evenement 'accepted' dans estimate_version_events
   f. Envoyer email de confirmation au client ET au chiffreur
   g. Retourner 200
5. Page portail affiche confirmation : "Devis accepte, merci !"
```

### Immutabilite post-acceptation

La guard DB `guard_estimate_versions_readonly()` empeche deja toute modification d'une version acceptee (sauf transitions de statut). Le portal_token passe a `accepted` et ne permet plus aucune action.

### Tests

- [ ] UT `SignaturePad` : rendu, events souris/tactile, export base64, reset
- [ ] UT route accept : validation token, upload signature, transition statut
- [ ] UT `acceptEstimate()` : cas nominal, token expire, devis deja accepte
- [ ] E2E : parcours complet acceptation avec signature

---

## Phase 4 — EST-244 : Relance automatique

**Priorite : P2 | Effort : M | Depend de : Phase 1 (parallelisable avec Phase 2)**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `src/app/api/cron/estimate-reminders/route.ts` | Endpoint GET protege par CRON_SECRET |
| `src/lib/email/templates/reminder.tsx` | Template React Email pour relance |

### Fichiers a modifier

| Fichier | Modification |
|---------|-------------|
| `src/lib/email/send-estimate.ts` | Ajouter `sendReminder(versionId, reminderNumber)` |
| `vercel.json` (ou equivalent) | Configurer le cron schedule |

### Logique du cron

```
GET /api/cron/estimate-reminders
Header: Authorization: Bearer {CRON_SECRET}

1. Requete SQL :
   SELECT ev.*, pt.email, pt.token,
     (SELECT COUNT(*) FROM estimate_emails ee
      WHERE ee.version_id = ev.id AND ee.type LIKE 'reminder_%') as reminder_count
   FROM estimate_versions ev
   JOIN portal_tokens pt ON pt.version_id = ev.id AND pt.status = 'pending'
   WHERE ev.status = 'sent'
     AND ev.updated_at < now() - interval '{DELAY} days'
     AND NOT EXISTS (
       SELECT 1 FROM estimate_emails ee
       WHERE ee.version_id = ev.id
         AND ee.type LIKE 'reminder_%'
         AND ee.sent_at > now() - interval '{DELAY} days'
     )

2. Pour chaque devis a relancer (reminder_count < MAX_REMINDERS) :
   a. Determiner le type : 'reminder_1', 'reminder_2', 'reminder_3'
   b. Envoyer email via template reminder
   c. Inserer dans estimate_emails
   d. Log evenement 'reminder_sent' dans estimate_version_events

3. Retourner { processed: N, sent: M, skipped: K }
```

### Configuration Vercel Cron

```json
{
  "crons": [{
    "path": "/api/cron/estimate-reminders",
    "schedule": "0 9 * * 1-5"
  }]
}
```

Execution tous les jours ouvrables a 9h.

### Tests

- [ ] UT cron handler : filtre correct des devis, respect du max relances, protection CRON_SECRET
- [ ] UT template reminder : rendu correct
- [ ] Integration : simulation de relance sur devis de test

---

## Phase 5 — EST-245 : Negociation

**Priorite : P2 | Effort : L | Depend de : Phase 2 (parallelisable avec Phase 3)**

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `src/components/portal/NegotiationThread.tsx` | Fil de discussion : liste de messages + formulaire de saisie |
| `src/app/api/portal/[token]/messages/route.ts` | GET/POST messages cote client (via token) |
| `src/app/api/estimates/[versionId]/negotiations/route.ts` | GET/POST messages cote chiffreur (via auth) |

### Fichiers a modifier

| Fichier | Modification |
|---------|-------------|
| `src/app/portal/[token]/page.tsx` | Integrer `NegotiationThread` sous la vue du devis |
| `src/lib/portal/server.ts` | Ajouter CRUD messages de negociation |
| `src/lib/email/send-estimate.ts` | Ajouter notification email a chaque nouveau message |

### Composant NegotiationThread

```
Props :
- messages: NegotiationMessage[]
- currentAuthorType: 'client' | 'engineer'
- onSend: (message: string) => Promise<void>
- readOnly?: boolean (apres acceptation/refus)

Affichage :
- Messages chronologiques
- Bulles a gauche (client) / a droite (chiffreur) avec couleurs distinctes
- Nom de l'auteur + timestamp
- Formulaire de saisie en bas (textarea + bouton Envoyer)
- Etat desactive si readOnly
```

### Flux cote client (portail)

```
1. Le fil de negociation s'affiche sous le devis
2. Client tape un message → POST /api/portal/:token/messages
3. Route handler :
   a. Valider token (pending + non expire)
   b. Inserer dans estimate_negotiations (author_type: 'client')
   c. Envoyer notification email au chiffreur
   d. Retourner le message cree
4. Rafraichissement du fil
```

### Flux cote chiffreur (dashboard)

```
1. Le chiffreur voit un indicateur "nouveau message" sur le devis
2. Vue negociation dans la page du devis → GET /api/estimates/:versionId/negotiations
3. Chiffreur repond → POST /api/estimates/:versionId/negotiations
4. Route handler :
   a. Auth + verification ownership
   b. Inserer dans estimate_negotiations (author_type: 'engineer')
   c. Envoyer notification email au client
   d. Retourner le message cree
```

### Creation de nouvelle version a partir du feedback

Le chiffreur peut creer une nouvelle version integrant les retours client via `duplicate_estimate_version()` existant. Le lien entre la negociation et la nouvelle version est trace via `parent_version_id` sur `estimate_versions`.

### Tests

- [ ] UT `NegotiationThread` : rendu messages, envoi, mode readOnly
- [ ] UT routes messages : validation token, insertion, notification
- [ ] UT route chiffreur : auth, insertion, notification
- [ ] E2E : echange de messages client ↔ chiffreur

---

## Resume des fichiers

### Fichiers a creer (16)

| Phase | Fichier | Type |
|-------|---------|------|
| 0 | `supabase/migrations/XXX_est_e13_portal_email_tables.sql` | Migration |
| 1 | `src/lib/email/provider.ts` | Lib |
| 1 | `src/lib/email/send-estimate.ts` | Lib |
| 1 | `src/lib/email/templates/estimate.tsx` | Template |
| 1 | `src/app/api/estimates/[versionId]/send/route.ts` | API |
| 1 | `src/components/estimates/SendEstimateModal.tsx` | UI |
| 2 | `src/app/portal/[token]/page.tsx` | Page |
| 2 | `src/app/portal/[token]/layout.tsx` | Layout |
| 2 | `src/app/portal/[token]/not-found.tsx` | Page |
| 2 | `src/lib/portal/server.ts` | Lib |
| 2 | `src/app/api/portal/[token]/route.ts` | API |
| 2 | `src/app/api/portal/[token]/reject/route.ts` | API |
| 3 | `src/components/portal/SignaturePad.tsx` | UI |
| 3 | `src/app/api/portal/[token]/accept/route.ts` | API |
| 4 | `src/app/api/cron/estimate-reminders/route.ts` | API |
| 4 | `src/lib/email/templates/reminder.tsx` | Template |
| 5 | `src/components/portal/NegotiationThread.tsx` | UI |
| 5 | `src/app/api/portal/[token]/messages/route.ts` | API |
| 5 | `src/app/api/estimates/[versionId]/negotiations/route.ts` | API |

### Fichiers a modifier (5)

| Fichier | Phases |
|---------|--------|
| `src/lib/estimates/server.ts` | 1, 2, 3 |
| `src/lib/estimates/schemas.ts` | 1 |
| `src/types/database.ts` | 0 (regeneration) |
| `src/lib/portal/server.ts` | 2, 3, 5 |
| `src/lib/email/send-estimate.ts` | 1, 4, 5 |

---

## Repartition par equipe

Deux equipes travaillent en parallele sur chaque phase : **Fullstack** prepare les API, la DB et la logique serveur ; **Front** consomme les API et construit l'UI.

### Timeline parallele

```
Semaine    1       2       3       4       5       6       7       8       9
           |-------|-------|-------|-------|-------|-------|-------|-------|
Fullstack  [Phase 0][-- Phase 1 --][-- Phase 2 --][Ph.3 ][- Ph.4 -]
Front                [-- Phase 1 --][-- Phase 2 --][Ph.3 ][---- Ph.5 ----]
                     ^               ^                     ^
                     contrat API     contrat API            contrat API
                     email defini    portail defini         negociation defini
```

Phase 0 (DB) debloque tout. Ensuite le front demarre Phase 1 des que les contrats API sont definis (schemas Zod + route signatures), sans attendre que le backend soit termine (mock des reponses).

### Phase 0 — Migration DB (fondations)

| Equipe | Taches |
|--------|--------|
| **Fullstack** | Migration SQL (tables, index, RLS), regeneration `database.ts` |
| **Front** | — (aucune tache) |

### Phase 1 — EST-241 : Envoi par email

| Equipe | Taches |
|--------|--------|
| **Fullstack** | `provider.ts`, `send-estimate.ts`, route POST `/send`, `createPortalToken()`, `sendEstimateSchema` |
| **Front** | `SendEstimateModal.tsx`, template React Email `estimate.tsx`, integration bouton dans toolbar devis |

**Contrat API (a definir en amont) :**
```typescript
// POST /api/estimates/:versionId/send
// Request
{ to: string; cc?: string[]; subject: string; message: string }
// Response 200
{ email_id: string; portal_token: string; portal_url: string }
// Response 400/500
{ error: string }
```

### Phase 2 — EST-242 : Portail client

| Equipe | Taches |
|--------|--------|
| **Fullstack** | `portal/server.ts` (validateToken, getEstimateForPortal, rejectEstimate), routes API GET/POST, middleware exclusion auth |
| **Front** | Layout portail, page `[token]`, page expired/not-found, integration `EstimateDocument` en lecture seule, boutons accepter/refuser |

**Contrat API (a definir en amont) :**
```typescript
// GET /api/portal/:token
// Response 200
{ estimate: EstimateForPortal; token_status: 'pending'; expires_at: string }
// Response 404
{ error: 'invalid_token' | 'expired_token' }

// POST /api/portal/:token/reject
// Request
{ reason?: string }
// Response 200
{ status: 'rejected' }
```

### Phase 3 — EST-243 : Acceptation et signature

| Equipe | Taches |
|--------|--------|
| **Fullstack** | Route POST `/accept`, upload signature storage, transition sent->accepted, email confirmation, enrichir `patchEstimateStatus()` |
| **Front** | `SignaturePad.tsx`, flux acceptation UI (modale confirmation + signature + checkbox), page confirmation post-acceptation |

**Contrat API :**
```typescript
// POST /api/portal/:token/accept
// Request
{ signature_base64?: string; accepted_terms: true }
// Response 200
{ status: 'accepted'; accepted_at: string }
```

### Phase 4 — EST-244 : Relance automatique

| Equipe | Taches |
|--------|--------|
| **Fullstack** | Cron endpoint, logique detection devis a relancer, envoi batch, config Vercel Cron |
| **Front** | Template React Email `reminder.tsx`, indicateur relance dans la liste des devis (badge "Relance 1/3") |

### Phase 5 — EST-245 : Negociation

| Equipe | Taches |
|--------|--------|
| **Fullstack** | Routes API messages (portail + dashboard), CRUD `estimate_negotiations`, notifications email |
| **Front** | `NegotiationThread.tsx`, integration dans page portail, integration dans page devis dashboard, indicateur "nouveau message" |

**Contrat API :**
```typescript
// GET /api/portal/:token/messages
// Response 200
{ messages: NegotiationMessage[] }

// POST /api/portal/:token/messages
// Request
{ message: string }
// Response 201
{ id: string; created_at: string }

// GET /api/estimates/:versionId/negotiations (auth required)
// POST /api/estimates/:versionId/negotiations (auth required)
// Meme format que ci-dessus
```

### Synchronisation inter-equipes

| Point de sync | Quand | Livrable |
|---------------|-------|----------|
| Kickoff Phase 0 | Debut | Schema SQL + types TS generes |
| Contrat API Phase 1 | Avant debut front Phase 1 | Schemas Zod + signatures de route documentes |
| Contrat API Phase 2 | Avant debut front Phase 2 | Types `EstimateForPortal` + routes documentes |
| Contrat API Phase 3 | Avant debut front Phase 3 | Signature upload spec + route accept |
| Review integration | Fin de chaque phase | Demo du parcours complet (front + back branches mergees) |

---

## Estimation d'effort par phase

| Phase | Ticket | Effort | Complexite principale |
|-------|--------|--------|-----------------------|
| 0 | Fondations DB | S | Schema + RLS |
| 1 | EST-241 (email) | L | Integration Resend + flux statut + modale |
| 2 | EST-242 (portail) | L | Routes publiques sans auth + reutilisation print layout |
| 3 | EST-243 (signature) | M | Canvas signature + upload storage + confirmation |
| 4 | EST-244 (relance) | M | Cron + requete detection + limites |
| 5 | EST-245 (negociation) | L | Fil bidirectionnel + notifications |

---

## Risques identifies

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Deliverabilite email (SPF/DKIM/DMARC) | Emails en spam | Configurer domaine d'envoi dans Resend + DNS records |
| PDF trop lourd pour piece jointe | Envoi echoue (>10 MB) | Lien de telechargement en fallback, compression PDF |
| Token portail brute-force | Acces non autorise | UUID v4 (122 bits entropie), rate limiting sur les routes portail |
| Signature juridique valeur legale | Contestation possible | Horodatage + IP + document scelle = faisceau de preuves (pas signature qualifiee eIDAS) |
| Race condition acceptation | Double acceptation | Verifier status = 'pending' en transaction, contrainte UNIQUE sur (version_id, status='accepted') |
| Cron rate limiting Resend | Relances non envoyees | Batch processing avec retry, limiter a 100 emails/cron |

---

## Criteres de validation globaux

- [ ] Parcours complet : creation devis → envoi email → consultation portail → acceptation avec signature
- [ ] Parcours refus : consultation portail → refus avec raison
- [ ] Relance automatique : devis sent sans reponse pendant N jours → email relance
- [ ] Negociation : echange de messages client ↔ chiffreur → nouvelle version
- [ ] Token expire : page d'erreur explicite
- [ ] Immutabilite : version acceptee non modifiable
- [ ] Audit : toutes les actions tracees dans `estimate_version_events` et `audit_logs`
- [ ] Multi-tenant : isolation stricte par tenant_id sur toutes les tables
