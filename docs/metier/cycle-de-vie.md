# Cycle de vie, immutabilité et validation

> **Statut : cycle d'envoi et effets externes relus au 2026-08-12.** Les autres
> sections restent la photographie du 2026-07-29. Chaque règle est ancrée sur
> le code ou la migration qui fait foi.

---

## 1. Statuts d'un devis

`estimate_status = ('draft', 'sending', 'sent', 'accepted', 'archived')`. La
valeur transactionnelle `sending` est ajoutée par
`supabase/migrations/20260811231754_estimate_email_sending_status.sql` ;
`supabase/schema.sql` n'est pas l'inventaire courant des migrations.

> ⚠️ Il n'existe **aucun statut `canceled`**. Deux documents historiques l'ont affirmé ; c'était faux.

### Transitions autorisées

```text
draft ──► sending ──► sent ──► accepted ──► archived
  ▲          │           └────────────────────► archived
  └──────────┘
   échec certain, sans effet fournisseur
```

Le trigger `validate_estimate_version_transition` autorise aussi la transition
historique directe `draft → sent`, mais le parcours d'email initial passe par
`sending` (`supabase/migrations/20260811231759_transactional_estimate_email_outbox.sql`).
Ce statut réserve et fige le devis pendant la préparation de l'enveloppe, du
sceau et du PDF.

Le seul retour vers `draft` est **interne** : `sending → draft` libère une
réservation dont l'échec est certain et sans effet fournisseur (préparation
incomplète ou rejet explicite), puis efface le sceau provisoire. En cas d'issue
ambiguë, c'est le **dispatch email** qui passe à `unknown` ; la version n'est pas
libérée. Il n'existe toujours aucun `sent → draft` : un devis déjà transmis doit
être remplacé par une nouvelle version s'il est erroné.

### Statut d'affaire

🔴 **Il n'y en a pas.** `estimate_projects` ne porte qu'un booléen `is_archived`
(`schema.sql:334-344`). Le type `AffaireStatus` est un simple alias de `estimate_status`
(`src/lib/affaires/schemas.ts:30`) — c'est le statut du **devis** qui est affiché comme statut
d'affaire.

`sending` reste volontairement absent des filtres publics d'affaires : il est
compté séparément par `sending_count`, puis normalisé avec les autres compteurs
(`src/lib/affaires/status-counts.ts`, migration
`20260812012308_add_affaires_sending_counter.sql`), mais ne constitue pas une
étape métier sélectionnable par l'utilisateur.

Conséquence métier : ni prospect / à chiffrer / remis / gagné / perdu, ni date de remise, ni motif de
perte, donc **aucun taux de transformation mesurable**. Voir
[ecarts-standards-btp.md](ecarts-standards-btp.md).

---

## 2. Immutabilité — trois couches

### Couche 1 — Trigger base de données

`guard_estimate_versions_readonly`, redéfini par
`supabase/migrations/20260811231759_transactional_estimate_email_outbox.sql`,
gèle le contenu dès que la version quitte `draft`. En `sending`, seuls la pose
unique du `seal_hash`, puis le changement de statut, sont admis ; les autres
colonnes restent en lecture seule. En `sent`, `accepted` ou `archived`, le sceau
est immuable et un `UPDATE` sans transition est refusé.

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

Dans le parcours d'email transactionnel :

1. La réservation passe `draft → sending` sans sceau.
2. Le PDF contractuel et les corps HTML/texte sont préparés, puis le hash d'un
   **payload canonique** est calculé : items triés par `position` puis `id`,
   payload en version 2.
3. `prepare_estimate_email_dispatch` pose le `seal_hash` une seule fois pendant
   `sending` et fige le chemin et l'empreinte SHA-256 du PDF ainsi que la charge
   utile fournisseur.
4. `complete_estimate_email_dispatch` ne passe `sending → sent` qu'après
   réception de l'identifiant Resend ; le sceau doit rester identique.

Le PDF n'est plus remplacé en place. Chaque nouvelle publication est un objet
immuable `tenant/projet/version/<sha256>.pdf`, créé avec `upsert: false`. Les
RPC de début et de publication lient les métadonnées à un token, à la révision,
au statut et, pendant `sending`, au dispatch `preparing`. Un worker supplanté ne
peut donc ni republier son PDF ni faire passer l'enveloppe à `queued`. En
`sent`, `accepted` ou `archived`, aucune nouvelle génération contractuelle
n'est autorisée ; un renvoi réutilise la dernière publication prête. Les anciens
objets `tenant/projet/version.pdf` restent lisibles sans être réécrits
(`supabase/migrations/20260812011616_estimate_pdf_publication_fencing.sql`,
[`../domaines/sorties-documents.md`](../domaines/sorties-documents.md) §2.1).

Sources : `src/lib/email/send-estimate.ts`,
`src/lib/email/estimate-email-outbox.ts` et
`supabase/migrations/20260811231759_transactional_estimate_email_outbox.sql`.

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

### Réservation, outbox et résultat fournisseur

L'envoi initial exige un en-tête HTTP `Idempotency-Key` au format UUID
(`src/app/api/estimates/[versionId]/send/route.ts`). La clé identifie la demande
du navigateur ; la base lui associe une clé fournisseur stable
`estimate-email/<dispatch-id>` et une seule enveloppe initiale active par
version.

La chaîne est découpée en étapes persistées :

1. `reserve_estimate_email_dispatch` verrouille la version, vérifie le tenant
   actif, l'acteur, le verrou de brouillon et la révision, puis crée une ligne
   `estimate_emails` en `preparing` et passe le devis en `sending`.
2. `prepare_estimate_email_dispatch` fige destinataires, sujet, corps HTML/texte,
   chemin et SHA-256 du PDF, sceau et hash exact de la charge fournisseur ; le
   dispatch devient `queued`.
3. `claim_estimate_email_dispatch` prend un bail de 120 secondes et passe le
   dispatch en `processing`. Resend reçoit toujours la même clé d'idempotence.
4. `complete_estimate_email_dispatch` enregistre l'identifiant fournisseur et
   termine atomiquement le dispatch et la version en `sent`.

Les erreurs transitoires reconnues sont rejouées dans la requête courante après
1 puis 2 secondes. Si elles persistent, le dispatch redevient `queued` avec une
échéance ; **aucun cron email autonome ne consomme encore cette échéance**. Une
nouvelle soumission de la même enveloppe reprend donc la ligne existante. Un
payload ou un acteur différent provoque un conflit au lieu de remplacer
l'enveloppe figée.

Un rejet certain termine la ligne en `failed` et remet `sending → draft`, sceau
provisoire effacé. Si la charge fournisseur avait déjà été figée, ce dispatch ne
peut jamais être régénéré sous la même clé de requête : la nouvelle tentative
doit employer une nouvelle `Idempotency-Key`, donc une nouvelle clé fournisseur.
Une ligne échouée avant le gel peut seule reprendre la même demande, après
revalidation du verrou et de la révision.

Le statut de dispatch `unknown` signifie que le produit ne peut plus conclure
si Resend a accepté l'effet. Il est posé pour une réponse ambiguë, une perte de
preuve après tentative, ou au-delà de la coupure de sécurité de **23 heures**
depuis la première tentative. Aucun rejeu automatique n'est alors permis : un
rapprochement fournisseur est requis. C'est une livraison au moins une fois
bornée par l'idempotence du fournisseur, pas une garantie « exactement une
fois » illimitée.

Cette outbox couvre seulement l'email initial de devis. La confirmation
d'acceptation et la demande de revue d'approbation restent des notifications en
meilleur effort : leur échec est journalisé sans annuler la décision métier.

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
