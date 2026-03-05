# EST-E18 — Situations de travaux & avenants

> Milestone: M6 | Priorite: P0 | Statut: A faire

## Objectif

Transformer un devis accepte en suivi d'execution avec situations mensuelles (facturation a l'avancement), avenants numerotes (travaux supplementaires), retenue de garantie et Decompte General Definitif (DGD). Ce module est le prolongement naturel du devis et est obligatoire pour les marches publics. Un logiciel BTP sans situations est considere comme un "demi-produit" par les professionnels.

## Ce qui existe deja

- **Versioning** : `estimate_versions` avec `status` enum (draft, sent, accepted, canceled) et `duplicateEstimateVersion()`.
- **Moteur de calcul** : `src/lib/estimate-calculations.ts` — totaux par ligne et globaux.
- **Events append-only** : `EST-036` (planifie M4) — `estimate_version_events` pour le suivi des changements.
- **PDF serveur** : `EST-201` — generation PDF cote serveur.

---

## EST-331 — Situations de travaux (facturation a l'avancement)

**Priorite:** P0 | **Effort:** XL | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux creer des situations de travaux mensuelles a partir d'un devis accepte, avec un pourcentage d'avancement par poste, afin de facturer au fur et a mesure de l'execution et de produire les attachements reglementaires.

### Criteres d'acceptation

- [ ] Nouveau module "Situations" accessible depuis un devis au statut `accepted`
- [ ] Table `work_situations` : situation_number, estimate_version_id, period_start, period_end, status (draft/validated/invoiced)
- [ ] Table `work_situation_items` : situation_id, estimate_item_id, cumulative_pct (% avancement cumule), cumulative_qty, previous_pct, current_pct
- [ ] Calcul automatique : montant cumule = PV HT x cumulative_pct, montant du mois = cumule - cumule precedent
- [ ] Saisie par pourcentage (0-100%) ou par quantite realisee
- [ ] La situation N reprend automatiquement les cumuls de la situation N-1
- [ ] Validation d'une situation : verrouillage (immutable), passage au statut `validated`
- [ ] Generation PDF de la situation : attachement detaille par poste + decompte mensuel avec totaux
- [ ] Recapitulatif global : tableau de toutes les situations avec montants cumules et reste a facturer
- [ ] Le total cumule ne peut pas depasser le montant du marche (sauf avenants, cf. EST-332)
- [ ] Integration avec la retenue de garantie (EST-333) : deduction automatique de 5% TTC
- [ ] Les situations tiennent compte des avenants valides (EST-332) : les postes ajoutes/modifies par avenant apparaissent dans la situation

### Notes techniques

- Fichiers a creer : `src/lib/situations/`, `src/components/situations/`, `src/app/dashboard/estimates/[versionId]/situations/`
- Migration DB : tables `work_situations`, `work_situation_items`, index sur `estimate_version_id`
- Reutiliser : `computeEstimateLineValues()` pour les montants de reference, `formatEUR()`, pattern PDF de EST-201
- Dependances : aucune (mais enrichi par EST-332, EST-333, EST-334)

---

## EST-332 — Gestion des avenants / travaux supplementaires

**Priorite:** P0 | **Effort:** L | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux creer des avenants formalises sur un devis accepte (ajout de postes, modification de quantites, prix nouveaux), avec un workflow d'acceptation, afin de gerer les travaux supplementaires conformement aux regles des marches publics.

### Criteres d'acceptation

- [ ] Table `estimate_amendments` : amendment_number, estimate_version_id, title, description, status (draft/submitted/accepted/rejected)
- [ ] Table `estimate_amendment_items` : amendment_id, estimate_item_id (nullable pour nouveaux postes), action (add/modify/remove), new_quantity, new_unit_price_cents, justification
- [ ] Numerotation automatique des avenants : Avenant n1, n2, etc.
- [ ] Workflow d'acceptation : draft -> submitted -> accepted/rejected (distinct du workflow devis)
- [ ] Un avenant accepte modifie le montant du marche : nouveau total = marche initial + somme avenants acceptes
- [ ] Les postes ajoutes par avenant sont identifies visuellement dans le devis (badge "Avenant n X")
- [ ] Les situations de travaux (EST-331) integrent automatiquement les postes des avenants acceptes
- [ ] Vue consolidee : montant initial + detail par avenant + total revise
- [ ] Generation PDF de l'avenant : detail des modifications, justification, montant de l'avenant, nouveau total marche
- [ ] Distinct des "variantes/scenarios" existants (EST-223) qui sont des alternatives pre-acceptation

### Notes techniques

- Fichiers a creer : `src/lib/amendments/`, `src/components/amendments/`
- Migration DB : tables `estimate_amendments`, `estimate_amendment_items`
- Reutiliser : pattern versioning existant, workflow de statut de `estimate_versions`
- Dependances : EST-331 (integration dans les situations)

---

## EST-333 — Retenue de garantie et cautions

**Priorite:** P1 | **Effort:** M | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux appliquer automatiquement la retenue de garantie de 5% TTC sur chaque situation de travaux, avec gestion de la caution bancaire de substitution et liberation a 1 an, afin de respecter les obligations legales des marches publics.

### Criteres d'acceptation

- [ ] Parametre `retention_guarantee_pct` au niveau du devis (defaut 5%, configurable)
- [ ] Deduction automatique de la retenue sur chaque situation : montant retenu = montant TTC x retention_pct
- [ ] Suivi du cumul des retenues : tableau recapitulatif des retenues par situation
- [ ] Caution de substitution : flag indiquant qu'une caution bancaire remplace la retenue (pas de deduction dans ce cas)
- [ ] Liberation de la retenue : date prevue (1 an apres reception), montant a liberer, statut (retenue/liberee)
- [ ] Integration dans le PDF de situation : ligne "Retenue de garantie" dans le decompte
- [ ] Integration dans le DGD (EST-334) : solde des retenues

### Notes techniques

- Fichiers a modifier : `src/lib/situations/` (calcul retenue), `src/components/situations/` (affichage)
- Migration DB : colonnes sur `work_situations` ou table dediee `retention_guarantees`
- Reutiliser : pattern calcul TTC existant
- Dependances : EST-331 (situations de travaux)

---

## EST-334 — Decompte General Definitif (DGD)

**Priorite:** P1 | **Effort:** L | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux generer le Decompte General Definitif (DGD) consolidant toutes les situations, avenants, retenues et penalites pour obtenir le solde final du marche, afin de cloturer formellement le chantier conformement aux marches publics.

### Criteres d'acceptation

- [ ] Generation du DGD depuis un marche dont toutes les situations sont validees et les travaux termines
- [ ] Consolidation : montant initial + avenants + total facture (situations) + retenues + penalites de retard + primes = solde
- [ ] Detail par poste : quantite marche, quantite realisee, ecart, montant
- [ ] Gestion des penalites de retard : montant journalier configurable, nombre de jours, total penalites
- [ ] Gestion des primes : montant si applicable
- [ ] Liberation des retenues de garantie dans le DGD
- [ ] Statut DGD : draft -> submitted -> accepted (workflow similaire aux avenants)
- [ ] Generation PDF du DGD : document formel avec toutes les consolidations
- [ ] Le DGD est le dernier document du cycle de vie du marche

### Notes techniques

- Fichiers a creer : `src/lib/dgd/`, `src/components/dgd/`
- Migration DB : table `final_settlements` (estimate_version_id, penalties_cents, bonuses_cents, status, etc.)
- Reutiliser : `work_situations` et `estimate_amendments` pour la consolidation, pattern PDF
- Dependances : EST-331 (situations), EST-332 (avenants), EST-333 (retenues)

---

## EST-361 — Suivi budgetaire projet (previsionnel vs realise)

**Priorite:** P1 | **Effort:** L | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux comparer le budget previsionnel (devis) avec le realise (situations + depenses) pour chaque projet, avec des ecarts de marge par poste, afin de maitriser la rentabilite a chaque etape du chantier.

### Criteres d'acceptation

- [ ] Dashboard rentabilite par projet : previsionnel (montants du devis accepte) vs realise (cumul des situations validees)
- [ ] Ecarts de marge par poste : montant prevu, montant facture, ecart en EUR et en %, alerte si ecart > seuil configurable
- [ ] Ecarts par lot (EST-341) : rentabilite consolidee par lot technique
- [ ] Indicateurs cles : marge brute previsionnelle, marge brute realisee, taux de realisation, reste a facturer
- [ ] Prise en compte des avenants (EST-332) : le previsionnel integre le marche revise (initial + avenants acceptes)
- [ ] Suivi des depenses : saisie ou import des depenses reelles (achats materiaux, MO, sous-traitance) pour comparaison avec le DS previsionnel
- [ ] Alertes depassement : notification quand les depenses reelles depassent le budget previsionnel par poste ou par lot
- [ ] Export du tableau de bord rentabilite en PDF ou Excel
- [ ] Vue consolidee multi-projets : rentabilite globale de l'entreprise sur une periode

### Notes techniques

- Fichiers a creer : `src/lib/budget/`, `src/components/budget/`, `src/app/dashboard/projects/[projectId]/budget/`
- Migration DB : table `project_expenses` (project_id, estimate_item_id, cost_type, amount_cents, date, description)
- Reutiliser : `computeEstimateLineValues()` pour les montants previsionnels, `work_situations` pour le realise facture
- Dependances : EST-331 (situations — source du realise), EST-301 (decomposition DS — source du previsionnel)
