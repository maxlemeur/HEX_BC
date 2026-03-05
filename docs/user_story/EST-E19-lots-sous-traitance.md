# EST-E19 — Lots, sous-traitance & consultation fournisseurs

> Milestone: M6 | Priorite: P1 | Statut: A faire

## Objectif

Structurer les devis par lots techniques (allotissement : GO, Charpente, Plomberie, etc.), gerer la sous-traitance dans le chiffrage (distinction "en propre" vs "sous-traite" avec marges differenciees), et automatiser les consultations fournisseurs. L'allotissement est la norme des marches publics et la gestion de la sous-traitance est essentielle pour les entreprises generales et TCE.

## Ce qui existe deja

- **Structure hierarchique** : `estimate_items` avec `parent_id` et `item_type` (section/line) — les sections peuvent servir de base pour les lots.
- **Catalogue fournisseur** : `supplier_pricebook` — prix par fournisseur.
- **Envoi email** : `EST-241` (planifie M4) — envoi de devis par email, reutilisable pour les consultations.
- **Numerotation** : `EST-124` — numerotation automatique avec prefixe LOT optionnel.

---

## EST-341 — Gestion des lots techniques (allotissement)

**Priorite:** P0 | **Effort:** L | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux structurer mon devis en lots techniques (GO, Charpente, Plomberie, Electricite, etc.) avec un recapitulatif par lot et la possibilite d'extraire un lot pour un sous-traitant, afin de repondre aux exigences d'allotissement des marches publics et de piloter les couts par corps d'etat.

### Criteres d'acceptation

- [ ] Nouveau concept "Lot" : une section de niveau racine peut etre designee comme lot technique
- [ ] Chaque lot a un code (ex: LOT01), un libelle (ex: "Gros Oeuvre"), et un corps d'etat
- [ ] Bibliotheque de lots types par tenant (GO, Charpente, Couverture, Plomberie, Electricite, Peinture, etc.)
- [ ] Recapitulatif par lot : tableau synthetique avec montant HT, montant TTC par lot
- [ ] Recapitulatif TCE (Tous Corps d'Etat) : consolidation de tous les lots
- [ ] Extraction d'un lot : generation d'un sous-devis contenant uniquement les postes du lot (pour envoi au sous-traitant)
- [ ] Les sous-totaux (EST-121) sont calcules par lot automatiquement
- [ ] Le PDF inclut le recapitulatif par lot en page de synthese
- [ ] Les lots sont compatibles avec les situations de travaux (EST-331) : suivi d'avancement par lot

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx` (designation lot sur les sections racines), `src/lib/estimate-calculations.ts` (totaux par lot)
- Migration DB : colonne `lot_code` et `trade` (corps d'etat) sur `estimate_items` de type section, table `lot_templates`
- Reutiliser : structure hierarchique existante, `computeSectionTotals()` (EST-121)
- Dependances : EST-121 (sous-totaux par section)

---

## EST-342 — Sous-traitance dans le devis

**Priorite:** P1 | **Effort:** M | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux distinguer les lignes "en propre" des lignes "sous-traitees" dans mon devis, avec un prix sous-traitant distinct et un coefficient de marge specifique, afin de calculer ma marge reelle et de preparer les consultations sous-traitants.

### Criteres d'acceptation

- [ ] Nouveau champ `execution_mode` sur `estimate_items` : enum ('own', 'subcontracted', 'mixed')
- [ ] Pour les lignes sous-traitees : champ `subcontractor_price_cents` (prix du sous-traitant) distinct du PV client
- [ ] Coefficient de marge sous-traitance configurable (par defaut au niveau tenant, surchargeable par ligne)
- [ ] PV HT sous-traite = prix sous-traitant x (1 + coeff_marge_st)
- [ ] Affichage visuel : les lignes sous-traitees sont visuellement differenciees (icone, couleur de fond)
- [ ] Recapitulatif : decomposition "en propre" vs "sous-traite" dans les totaux du devis et par lot
- [ ] Le recapitulatif PDF inclut la repartition propre/sous-traite (optionnel, masquable pour le client)
- [ ] Compatibilite avec la decomposition DS/FC/FG/B&A (EST-301) : les frais generaux peuvent differer pour les lignes sous-traitees

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorRow.tsx`, `src/lib/estimate-calculations.ts`
- Migration DB : colonnes `execution_mode`, `subcontractor_price_cents`, `subcontractor_margin_bp` sur `estimate_items`
- Reutiliser : pattern marge existant, catalogue fournisseur pour les prix sous-traitants
- Dependances : EST-301 (integration dans la decomposition DS/FC/FG/B&A)

---

## EST-343 — Consultation fournisseurs automatisee

**Priorite:** P2 | **Effort:** L | **Milestone:** M6

### User Story

> En tant que chiffreur, je veux extraire automatiquement la liste des materiaux de mon devis et envoyer des consultations par email aux fournisseurs, puis comparer leurs retours dans une grille, afin de selectionner les meilleures offres et d'optimiser mes couts d'achat.

### Criteres d'acceptation

- [ ] Extraction automatique des materiaux du devis : liste des articles avec quantites, unites, designations
- [ ] Selection des fournisseurs a consulter depuis le carnet d'adresses (contacts fournisseurs)
- [ ] Generation d'un document de consultation (PDF ou Excel) avec la liste des articles a chiffrer
- [ ] Envoi par email de la consultation aux fournisseurs selectionnes (reutilisation EST-241)
- [ ] Grille de comparaison des retours : prix par article, par fournisseur, ecart en % avec le prix de reference
- [ ] Selection du "mieux-disant" : possibilite de selectionner le meilleur prix par article (pas forcement le meme fournisseur)
- [ ] Mise a jour du devis : application des prix retenus sur les lignes correspondantes
- [ ] Historique des consultations : tracabilite des consultations envoyees et des retours recus

### Notes techniques

- Fichiers a creer : `src/lib/consultations/`, `src/components/consultations/`
- Migration DB : tables `supplier_consultations`, `supplier_consultation_items`, `supplier_consultation_responses`
- Reutiliser : `supplier_pricebook` pour les prix de reference, EST-241 pour l'envoi email
- Dependances : EST-241 (envoi email)
