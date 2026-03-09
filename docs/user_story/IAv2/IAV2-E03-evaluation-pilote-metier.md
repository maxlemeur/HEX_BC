# IAV2-E03 — Evaluation metier & pilote tenant

> Priorite: P0 | Effort: M | Cible: prouver le ROI reel

## Objectif

Mesurer objectivement si le takeoff IA fait gagner du temps au chiffreur BTP,
et dans quelles conditions.

---

## IAV2-021 — Corpus de reference chiffre

### User Story

> En tant que product owner IA, je veux un corpus de dossiers annote manuellement,
> afin de comparer les sorties IA a une base de verite metier.

### Criteres d'acceptation

- [ ] Corpus reel anonymise constitue
- [ ] Repartition minimale:
  - metrage structure
  - PDF tabulaires
  - plans complets
- [ ] Chaque dossier dispose d'une sortie de reference exploitable
- [ ] Les metriques de comparaison sont definies:
  - recall postes
  - precision quantites
  - temps de correction humaine
  - taux d'items rejetes

### Edge cases

- dossiers incomplets
- reference humaine divergente entre deux chiffreurs
- lots non normalises entre projets

---

## IAV2-022 — Instrumenter la correction humaine

### User Story

> En tant qu'equipe produit, je veux mesurer ce que le chiffreur corrige apres passage IA,
> afin d'identifier ou l'IA cree de la valeur et ou elle en detruit.

### Criteres d'acceptation

- [ ] Capture des corrections:
  - suppression item
  - modification designation
  - modification quantite
  - changement unite
  - verification manuelle
- [ ] KPIs disponibles par niveau et par tenant pilote
- [ ] Distinction claire entre "sortie juste" et "sortie corrigee rapidement"

### Edge cases

- corrections massives en batch
- abandon du job sans apply
- apply partiel seulement

---

## IAV2-023 — Pilote controle sur tenants reels

### User Story

> En tant que responsable deploiement, je veux activer progressivement la V2 IA sur des tenants pilotes,
> afin de limiter le risque tout en obtenant des retours terrain.

### Criteres d'acceptation

- [ ] Activation par flags tenant
- [ ] Tableau de suivi hebdo:
  - volume dossiers
  - cout moyen
  - temps moyen
  - taux de correction
  - satisfaction utilisateur
- [ ] Kill switch documente
- [ ] Decision go/no-go apres periode pilote

### Edge cases

- gros tenant avec dossiers atypiques
- differents styles de plans PDF selon BE / MOE / archi
- ecart fort entre performance labo et terrain
