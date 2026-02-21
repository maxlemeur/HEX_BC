# EST-E13 — Lifecycle client

> Milestone: M4 | Priorite: P1 | Statut: A faire

## Objectif

Construire le parcours client complet : envoi de devis par email, mise a disposition d'un portail client securise pour consultation et validation, et gestion du flux d'acceptation/refus avec signature electronique. Ce module permet de boucler le cycle de vie du devis de l'envoi a la commande validee.

## Ce qui existe deja

- Transitions de statut (draft -> sent -> accepted -> archived) implementees dans `patchEstimateStatus()` (`src/lib/estimates/server.ts`)
- Validation Zod du statut via `patchEstimateStatusSchema` (`src/lib/estimates/schemas.ts`)
- Page d'impression pour vue PDF-like (`src/app/dashboard/estimates/[versionId]/print/`)
- Fonction DB `guard_estimate_versions_readonly()` pour l'immutabilite des versions acceptees
- Piste d'audit via `log_estimate_audit()` et table `audit_logs`
- Aucun envoi d'email n'est encore implemente

---

## EST-241 — Envoi par email

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux envoyer un devis au client par email avec un lien vers le portail, afin de partager le document de maniere professionnelle.

### Criteres d'acceptation

- [ ] Modale de composition d'email avec champs : destinataire (to), copie (cc), objet (subject), message personnalise
- [ ] Piece jointe PDF du devis generee automatiquement
- [ ] Lien vers le portail client inclus dans le corps de l'email
- [ ] Envoi effectif via Resend ou SendGrid (configurable par variable d'environnement)
- [ ] Historique des envois enregistre en base (table `estimate_emails`)
- [ ] Template d'email personnalisable par tenant
- [ ] Le statut du devis passe a `sent` apres envoi reussi
- [ ] Gestion des erreurs d'envoi avec message explicite a l'utilisateur

### Notes techniques

- Fichiers a creer :
  - `src/app/api/estimates/[versionId]/send/route.ts` — Route handler POST pour l'envoi
  - `src/lib/email/send-estimate.ts` — Logique d'envoi (abstraction Resend/SendGrid)
  - `src/lib/email/templates/estimate.tsx` — Template React Email pour le devis
  - Migration pour la table `estimate_emails` (version_id, recipient, cc, subject, body, sent_at, status, provider_id)
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — Integrer l'envoi dans le flux de statut
- Reutiliser : `patchEstimateStatus()` pour la transition draft -> sent, `createSupabaseServerClient()` pour l'acces DB
- Dependances : EST-201 (generation PDF)

---

## EST-242 — Portail client

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que client, je veux acceder a un portail securise pour consulter le devis, poser des questions et accepter/refuser, afin de participer au processus sans avoir de compte complet.

### Criteres d'acceptation

- [ ] URL publique avec token unique : `/portal/[token]`
- [ ] Vue lecture seule du devis (reutiliser le layout d'impression existant)
- [ ] Fil de commentaires pour poser des questions au chiffreur
- [ ] Boutons accepter / refuser clairement visibles
- [ ] Pad de signature optionnel pour l'acceptation
- [ ] Token a duree de vie configurable (expire apres N jours, defaut 30)
- [ ] Page d'erreur explicite si le token est expire ou invalide
- [ ] Aucune authentification Supabase requise pour le client (acces anonyme via token)

### Notes techniques

- Fichiers a creer :
  - `src/app/portal/[token]/page.tsx` — Page principale du portail client
  - `src/app/api/portal/[token]/route.ts` — Route API pour recuperer les donnees du devis via token
  - Migration pour la table `portal_tokens` (id, version_id, token UUID, email, expires_at, status: pending/accepted/rejected, created_at)
  - `src/lib/portal/server.ts` — Logique serveur : validation du token, recuperation du devis, gestion des commentaires
- Reutiliser : Layout d'impression existant pour la vue du devis, composants UI existants (Tailwind)
- Dependances : EST-241 (le lien portail est envoye dans l'email)

---

## EST-243 — Acceptation et signature

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que client, je veux accepter le devis et signer electroniquement, afin de valider ma commande de maniere legale.

### Criteres d'acceptation

- [ ] Bouton "Accepter le devis" declenche la transition de statut sent -> accepted
- [ ] Canvas de signature optionnel (signature dessinee a la souris ou au doigt)
- [ ] Image de la signature stockee dans Supabase Storage (bucket prive)
- [ ] Horodatage de l'acceptation enregistre (timestamp + IP)
- [ ] Email de confirmation envoye aux deux parties (client + chiffreur)
- [ ] La version acceptee devient immutable (protegee par `guard_estimate_versions_readonly()`)
- [ ] Le token du portail passe au statut `accepted` et n'est plus utilisable pour modifier
- [ ] Trace d'audit enregistree via `log_estimate_audit()`

### Notes techniques

- Fichiers a creer :
  - `src/components/portal/SignaturePad.tsx` — Composant canvas de signature (HTML5 Canvas)
- Fichiers a modifier :
  - `src/app/portal/[token]/page.tsx` — Ajouter le flux d'acceptation et le pad de signature
  - `src/lib/estimates/server.ts` — Enrichir `patchEstimateStatus()` pour stocker la signature et l'horodatage
  - `src/lib/portal/server.ts` — Logique d'acceptation cote serveur
- Reutiliser : `patchEstimateStatus()` pour la transition sent -> accepted, Supabase Storage pour la signature, `log_estimate_audit()` pour la trace
- Dependances : EST-242 (portail client)

---

## EST-244 — Relance automatique

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux programmer une relance automatique si le client n'a pas repondu apres N jours, afin de ne pas oublier de suivre les devis en attente.

### Criteres d'acceptation

- [ ] Delai configurable par tenant (defaut : 7 jours)
- [ ] Template d'email specifique pour les relances
- [ ] Maximum 3 relances par devis
- [ ] Statut de relance visible dans la liste des devis (relance 1/3, 2/3, 3/3)
- [ ] Execution via cron job (Vercel Cron) ou Supabase Edge Function
- [ ] Possibilite de desactiver la relance par devis (opt-out)
- [ ] Chaque relance est tracee dans la table `estimate_emails` avec le type `reminder`
- [ ] Aucune relance envoyee si le devis est deja accepte ou refuse

### Notes techniques

- Fichiers a creer :
  - `src/app/api/cron/estimate-reminders/route.ts` — Endpoint cron pour le traitement des relances
  - `src/lib/email/templates/reminder.tsx` — Template React Email pour la relance
- Fichiers a modifier :
  - Table `estimate_emails` — Ajouter colonne `type` : 'initial' | 'reminder_1' | 'reminder_2' | 'reminder_3'
  - `src/lib/estimates/server.ts` — Ajouter la logique de detection des devis a relancer
- Reutiliser : `src/lib/email/send-estimate.ts` pour l'envoi, `createSupabaseServerClient()` pour les requetes DB
- Dependances : EST-241 (envoi par email)

---

## EST-245 — Negociation (contre-proposition)

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que client, je veux proposer une contre-offre ou demander des modifications, afin de negocier avant d'accepter.

### Criteres d'acceptation

- [ ] Bouton "Demander une modification" sur le portail client
- [ ] Commentaire libre + ajustements optionnels ligne par ligne
- [ ] Notification envoyee au chiffreur a chaque demande de modification
- [ ] Le chiffreur peut creer une nouvelle version a partir du feedback client
- [ ] Fil de negociation visible par les deux parties (client et chiffreur)
- [ ] Historique complet des echanges conserve meme apres creation d'une nouvelle version
- [ ] Le statut du devis reste `sent` pendant la negociation

### Notes techniques

- Fichiers a creer :
  - `src/components/portal/NegotiationThread.tsx` — Composant fil de discussion / negociation
  - Migration pour la table `estimate_negotiations` (id, version_id, author_type: 'client'|'engineer', message, line_adjustments JSONB, created_at)
- Fichiers a modifier :
  - `src/app/portal/[token]/page.tsx` — Integrer le fil de negociation
  - `src/lib/estimates/server.ts` — Ajouter la logique de creation de version a partir du feedback
  - `src/lib/portal/server.ts` — CRUD des messages de negociation
- Reutiliser : `duplicate_estimate_version()` pour creer une nouvelle version a partir du feedback, composants UI existants
- Dependances : EST-242 (portail client)
