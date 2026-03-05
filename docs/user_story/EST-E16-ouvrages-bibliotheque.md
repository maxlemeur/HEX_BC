# EST-E16 — Ouvrages composes & bibliotheque de prix

> Milestone: M5 | Priorite: P0 | Statut: A faire

## Objectif

Transformer les assemblages existants (`estimate_assemblies`) en ouvrages composes au sens BTP : sous-detail de prix decomposant un prix unitaire en composants elementaires (materiaux, main d'oeuvre, materiel, sous-traitance) avec quantites, unites et coefficients de perte. Connecter aux bases de prix reference (Batiprix, UNTEC) pour l'import d'ouvrages et la comparaison des prix marche.

## Ce qui existe deja

- **Assemblages** : table `estimate_assemblies` + `estimate_assembly_items` — permet de regrouper des lignes reutilisables. Mais ne produit pas un sous-detail au sens BTP (pas de decomposition par nature de cout, pas de coefficient de perte).
- **Catalogue fournisseur** : tables `supplier_pricebook`, `material_indices` — prix unitaires par fournisseur et indices materiaux.
- **Suggestions IA** : `EST-E09` — scoring et application de suggestions depuis le catalogue.

---

## EST-311 — Ouvrages composes avec sous-detail de prix

**Priorite:** P0 | **Effort:** L | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux creer des ouvrages composes decomposant un prix unitaire en materiaux, main d'oeuvre, materiel et sous-traitance, afin de justifier mes prix unitaires aupres du maitre d'oeuvre et de disposer d'une base de revision de prix.

### Criteres d'acceptation

- [ ] Evolution du schema `estimate_assemblies` : chaque composant a un `cost_type` (materiau, mo, materiel, sous_traitance)
- [ ] Chaque composant d'ouvrage a : designation, unite, quantite, prix unitaire, coefficient de perte, total
- [ ] Le prix unitaire de l'ouvrage = somme des couts composants (= Debourse Sec unitaire)
- [ ] Vue sous-detail accessible depuis une ligne du devis : panneau lateral ou modal depliable
- [ ] Le sous-detail est imprimable dans le PDF (optionnel par ligne, activable globalement)
- [ ] Les ouvrages composes sont reutilisables : bibliotheque au niveau tenant
- [ ] L'insertion d'un ouvrage dans un devis cree les composants et calcule le DS automatiquement
- [ ] Modification d'un composant dans un devis ne modifie pas l'ouvrage source (copie a l'insertion)
- [ ] Le sous-detail est compatible avec la decomposition DS/FC/FG/B&A (EST-301) : le DS de la ligne = somme des composants

### Notes techniques

- Fichiers a modifier : `estimate_assemblies` et `estimate_assembly_items` (evolution schema), `src/components/estimates/EstimateEditorRow.tsx` (panneau sous-detail)
- Migration DB : ajouter `cost_type` enum, `loss_coeff_bp`, `unit` sur `estimate_assembly_items`
- Reutiliser : pattern assemblages existant, `computeEstimateLineValues()` pour le calcul du DS
- Dependances : EST-301 (integration DS), EST-302 (coefficients de perte)

---

## EST-312 — Connexion bases de prix Batiprix/UNTEC

**Priorite:** P1 | **Effort:** L | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux importer des ouvrages depuis les bases de prix reference (Batiprix, UNTEC) et comparer mes prix avec les prix du marche, afin de m'assurer de la competitivite et de la coherence de mes prix.

### Criteres d'acceptation

- [ ] Integration API Batiprix (ou import fichier si API indisponible) : recherche par code ouvrage, par mot-cle, par lot
- [ ] Import d'un ouvrage Batiprix comme ouvrage compose (EST-311) avec decomposition materiaux/MO/materiel
- [ ] Comparaison prix : alerte visuelle quand le DS d'une ligne s'ecarte de plus de X% du prix Batiprix equivalent
- [ ] Mise a jour periodique des prix de reference (import trimestriel ou annuel selon l'abonnement)
- [ ] Support des nomenclatures UNTEC (codes et familles d'ouvrages)
- [ ] Les ouvrages importes sont stockes dans la bibliotheque tenant et modifiables localement
- [ ] Log d'import : tracabilite de la source et de la date d'import pour chaque ouvrage

### Notes techniques

- Fichiers a creer : `src/lib/batiprix/` (client API ou parseur fichier), `src/components/catalogue/BatiprixSearch.tsx`
- Migration DB : table `reference_prices` (source, code, designation, unit_price_cents, last_updated)
- Reutiliser : `supplier_pricebook` comme modele de stockage, `material_indices` pour les comparaisons
- Dependances : EST-311 (ouvrages composes pour recevoir les imports)
