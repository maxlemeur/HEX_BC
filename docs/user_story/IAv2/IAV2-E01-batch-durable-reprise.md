# IAV2-E01 — Batch durable & reprise

> Priorite: P0 | Effort: L | Cible: rendre le Batch exploitable en production

## Objectif

Sortir d'un "Batch transporte en synchrone" vers un vrai traitement asynchrone durable,
reprenable et observable.

---

## IAV2-001 — Persister l'etat provider batch

### User Story

> En tant qu'operateur produit, je veux retrouver en base l'identite et l'etat du batch Gemini,
> afin de reprendre un job apres crash worker, timeout local ou incident provider.

### Criteres d'acceptation

- [ ] `takeoff_jobs` stocke:
  - `processing_strategy`
  - `provider_batch_id`
  - `provider_batch_state`
  - `provider_batch_updated_at`
- [ ] Les jobs `batch` sont distinguables des jobs `sync`
- [ ] Les transitions d'etat provider sont historisees de facon exploitable
- [ ] Les pages job detail / activity center peuvent afficher au minimum la strategie et l'etat courant
- [ ] Tests DB/API couvrent create, update, reprise et non-regression

### Edge cases

- batch cree mais `name` absent
- batch cree mais job applicatif non mis a jour
- etat provider inconnu / nouveau code etat

---

## IAV2-002 — Decoupler create batch et poll/reconcile

### User Story

> En tant que systeme, je veux creer un batch puis le reconcilier dans un worker separe,
> afin de ne pas bloquer le processor principal sur un SLA batch potentiellement long.

### Criteres d'acceptation

- [ ] Le processor ne poll plus le Batch API jusqu'a completion dans le meme cycle
- [ ] Un worker de reconciliation traite les jobs `batch_submitted`
- [ ] Un job peut etre repris sans re-soumettre inutilement au provider
- [ ] `timeoutMs` applicatif ne signifie plus "echec batch definitif"
- [ ] `failed`, `expired`, `cancelled` et `succeeded` sont mappes explicitement
- [ ] Retry et dead-letter strategy documentes
- [ ] Tests integration couvrent:
  - soumission batch
  - completion differee
  - timeout local sans perte de batch
  - reprise apres restart

### Edge cases

- batch termine pendant la fenetre entre soumission et persistence
- double polling concurrent
- batch `succeeded` mais reponse inline invalide

---

## IAV2-003 — Ecran de reprise et remediation operateur

### User Story

> En tant que chiffreur ou support interne, je veux voir si un job est "en attente provider",
> "bloque", "a relancer" ou "orphan", afin de savoir quoi faire sans lecture des logs.

### Criteres d'acceptation

- [ ] Etats UI explicites:
  - `submitted_to_provider`
  - `awaiting_provider_result`
  - `provider_failed`
  - `orphan_to_reconcile`
- [ ] Actions selon role:
  - relancer reconcile
  - annuler job
  - resoumettre
- [ ] Audit trail pour chaque action operateur
- [ ] Pas de doublon de traitement si un operateur clique plusieurs fois

### Edge cases

- job applique a tort alors que provider encore en cours
- provider termine mais activity center stale
- relance manuelle sur job deja terminal
