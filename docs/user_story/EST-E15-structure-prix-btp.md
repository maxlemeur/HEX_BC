# EST-E15 — Structure de prix BTP (DS/FC/FG/B&A)

> Milestone: M5 | Priorite: P0 | Statut: A faire

## Objectif

Remplacer le coefficient de marge unique (`margin_multiplier`) par la decomposition standard BTP : Debourses Secs (DS) + Frais de Chantier (FC) + Frais Generaux (FG) + Benefice & Aleas (B&A) = Prix de Vente HT. Integrer les coefficients de rendement et de perte materiaux. Cette decomposition est la methode standard de formation des prix dans le BTP et constitue un pre-requis pour la credibilite professionnelle du logiciel.

## Ce qui existe deja

- **Moteur de calcul** : `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()` applique un `margin_multiplier` unique pour calculer le PV HT. `computeEstimateTotals()` agrege les totaux.
- **Schema DB** : table `estimate_versions` avec colonne `margin_multiplier` (numeric). Table `margin_tiers` pour la marge par tranches de valeur projet (EST-028).
- **Rules engine** : `EST-037` — garde-fous marge/remise avec approbations (planifie M4).
- **Remise cascade** : `EST-025` — double remise en cascade (planifie, backlog).

---

## EST-301 — Decomposition DS/FC/FG/B&A dans le moteur de calcul

**Priorite:** P0 | **Effort:** L | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux decomposer la formation du prix de vente en Debourses Secs, Frais de Chantier, Frais Generaux et Benefice & Aleas, afin de justifier mes prix aupres du maitre d'oeuvre et de suivre la methode standard BTP.

### Criteres d'acceptation

- [ ] Nouveau modele de donnees : coefficients `coeff_fc` (frais chantier, %), `coeff_fg` (frais generaux, %), `coeff_ba` (benefice & aleas, %) au niveau `estimate_versions`
- [ ] Le Debourse Sec (DS) est calcule comme la somme des couts directs (materiaux + MO + materiel + sous-traitance) de chaque ligne
- [ ] Prix de Vente HT = DS x (1 + coeff_fc) x (1 + coeff_fg) x (1 + coeff_ba)
- [ ] Retrocompatibilite : si les nouveaux coefficients ne sont pas renseignes, le `margin_multiplier` existant continue de fonctionner
- [ ] Migration de donnees : convertir les `margin_multiplier` existants en coefficients equivalents (ou conserver les deux avec priorite au nouveau modele)
- [ ] L'editeur affiche les colonnes intermediaires : DS, PV HT (avec detail au survol : FC, FG, B&A)
- [ ] Les coefficients sont editables dans les parametres du devis (panneau lateral ou modal)
- [ ] Les sous-totaux par section (EST-121) integrent la decomposition DS/FC/FG/B&A
- [ ] Le recapitulatif PDF inclut la decomposition des prix par couche
- [ ] Les coefficients peuvent etre definis par defaut au niveau tenant (parametres entreprise)

### Notes techniques

- Fichiers a modifier : `src/lib/estimate-calculations.ts` (refonte `computeEstimateLineValues()`), `src/components/estimates/EstimateEditorTable.tsx`, `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- Migration DB : ajouter colonnes `coeff_fc_bp`, `coeff_fg_bp`, `coeff_ba_bp` (basis points) sur `estimate_versions`
- Reutiliser : pattern `margin_tiers` pour les valeurs par defaut, `formatEUR()` pour l'affichage
- Dependances : aucune (mais impacte EST-028 marge par tranches)

---

## EST-302 — Coefficients de rendement et pertes materiaux

**Priorite:** P1 | **Effort:** M | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux appliquer des coefficients de perte sur les materiaux (+10% platre, +15% carrelage) et des rendements MO (m2/jour), afin de calculer les quantites reelles necessaires et les couts de main d'oeuvre ajustes.

### Criteres d'acceptation

- [ ] Nouveau champ `loss_coeff_bp` (basis points, ex: 1000 = +10%) sur `estimate_items` pour les lignes materiaux
- [ ] Nouveau champ `productivity_rate` (unite/jour) sur les lignes MO, avec calcul automatique du nombre de jours
- [ ] Les coefficients de perte sont applicables par defaut depuis le catalogue fournisseur (`supplier_pricebook`)
- [ ] La quantite affichee distingue quantite nette (devis) et quantite brute (avec perte) : `qty_brute = qty_nette x (1 + loss_coeff)`
- [ ] Le DS prend en compte la quantite brute pour le calcul du cout materiaux
- [ ] Les rendements MO sont editables par ligne ou herites du role MO (`labor_roles`)
- [ ] Le recapitulatif PDF peut optionnellement afficher les quantites brutes

### Notes techniques

- Fichiers a modifier : `src/lib/estimate-calculations.ts`, `src/components/estimates/EstimateEditorRow.tsx`
- Migration DB : ajouter `loss_coeff_bp` et `productivity_rate` sur `estimate_items`
- Reutiliser : `labor_roles` existants, `supplier_pricebook` pour les valeurs par defaut
- Dependances : EST-301 (le DS utilise les quantites brutes)

---

## EST-364 — Remises multi-niveaux (chiffrage / section / ligne)

**Priorite:** P1 | **Effort:** M | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux appliquer des remises a differents niveaux (global sur le devis, par section/lot, par ligne/ouvrage) avec un systeme de cascade et de priorite, afin d'adapter finement mes conditions commerciales par poste ou par lot.

### Criteres d'acceptation

- [ ] Remise au niveau du devis (existant) : `discount_bp` sur `estimate_versions` — conserve tel quel
- [ ] Nouveau champ `discount_bp` sur `estimate_items` de type section : remise applicable a toutes les lignes enfants de la section
- [ ] Nouveau champ `discount_bp` sur `estimate_items` de type ligne : remise specifique a la ligne
- [ ] Regle de cascade : la remise effective = remise devis x remise section x remise ligne (multiplication des coefficients, pas addition)
- [ ] Affichage dans l'editeur : colonne "Remise %" editable a chaque niveau (devis, section, ligne)
- [ ] Tooltip/detail : au survol d'une ligne remisee, affichage de la decomposition (remise devis X% + section Y% + ligne Z% = effective W%)
- [ ] Les sous-totaux par section (EST-121) integrent la remise section dans leur calcul
- [ ] Le recapitulatif PDF affiche les remises appliquees par section et le total de remise globale
- [ ] Compatibilite avec le rules engine (EST-037) : les garde-fous s'appliquent sur la remise effective cumulee
- [ ] Retrocompatibilite : les devis sans remise section/ligne continuent de fonctionner (valeur par defaut = 0)

### Notes techniques

- Fichiers a modifier : `src/lib/estimate-calculations.ts` (cascade de remises dans `computeEstimateLineValues()`), `src/components/estimates/EstimateEditorRow.tsx` (colonne remise), `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- Migration DB : ajouter `discount_bp` (integer, default 0) sur `estimate_items`
- Reutiliser : `discount_bp` existant sur `estimate_versions`, pattern EST-025 (double remise cascade)
- Dependances : EST-025 (double remise cascade — enrichi), EST-301 (la remise s'applique apres formation du PV HT)
