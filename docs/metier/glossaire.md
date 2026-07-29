# Glossaire du chiffrage BTP

> Vocabulaire métier, et pour chaque terme : **ce que le produit en fait aujourd'hui**.
> Statut au 2026-07-29. Les termes marqués 🚫 n'ont **aucune** implémentation.

---

## Chiffrage et structure de prix

**Déboursé sec (DS)**
Coût direct d'un ouvrage : fournitures + main-d'œuvre + matériel, hors frais généraux et hors marge.
C'est la base de tout le chiffrage BTP.
→ *Calculé* (`costLineCents`, `estimate-calculations.ts:229-231`) mais **jamais persisté** ;
ré-exposé en lecture par `line-margin.ts`.

**Frais de chantier (FC)** 🚫
Coûts indirects propres au chantier : installation, base vie, grue, gardiennage, nettoyage.
→ Aucune implémentation. Zéro occurrence dans le code.

**Frais généraux (FG)** 🚫
Charges de structure de l'entreprise réparties sur les affaires : siège, direction, commercial.
→ Aucune implémentation.

**Coût de revient (CR)** 🚫
`DS + FC + FG`. Le seuil en dessous duquel l'entreprise perd de l'argent.
→ **Le niveau n'existe pas** dans le modèle.

**Bénéfice et aléas (B&A)** 🚫
Marge commerciale + provision pour risques.
→ Aucune implémentation en tant que concept distinct.

**Coefficient de vente**
Multiplicateur appliqué au déboursé sec pour obtenir le prix de vente. Dans le métier, il agrège
FC, FG et B&A.
→ Existe sous le nom **`margin_multiplier`**, en un seul étage : `vente = coût × margin_multiplier`.
La chaîne DS → FC → FG → CR → B&A → PV **n'est pas modélisée**. Voir
[ecarts-standards-btp.md](ecarts-standards-btp.md).

**Marge vs Marque** ⚠️
Deux notions distinctes, et les confondre est l'erreur la plus coûteuse du métier :

|  | Formule | Sur un coefficient 1,35 |
|---|---|---|
| **Taux de marge** | `(vente − coût) / coût` | 35 % |
| **Taux de marque** | `(vente − coût) / vente` | 25,9 % |

→ Le produit affiche le **taux de marque** (`line-margin.ts:40`, `:93`). Choix explicite et commenté.

**Sous-détail de prix**
Décomposition d'un prix unitaire par nature de coût (matériaux, main-d'œuvre, matériel,
sous-traitance), avec coefficients de perte et rendements. Pièce exigible en marché public.
→ **Existe en bibliothèque d'ouvrages** (`cost_type`, `loss_coeff_bp`, `yield_value`) mais
🔴 **détruit à l'insertion dans un devis** — donc jamais opposable au maître d'œuvre.

**Prix unitaire (PU)**
Prix de vente HT d'une unité d'ouvrage.
→ `pu_ht_cents`, dérivé : `bankersRound(saleLineCents / quantity)`.

---

## Pièces et documents

**DPGF** — *Décomposition du Prix Global et Forfaitaire*
Le tableau de chiffrage lui-même : lots, ouvrages, quantités, unités, prix unitaires, totaux. Fourni
vide par le maître d'œuvre, retourné rempli par l'entreprise.
→ Pipeline canonique : `dpgf_rows_raw` → mappings → `confirmUnifiedImportFlow`. Import CSV/XLSX
**et PDF tabulaire** (`src/lib/imports/tabular-pdf.ts`). Export : `dpgf-export.ts`.

**BPU** — *Bordereau de Prix Unitaires* 🚫
Liste de prix unitaires sans quantités, pour les marchés à bons de commande.
→ Pas de type de document distinct.

**DQE** — *Détail Quantitatif Estimatif*
BPU + quantités estimatives.
→ Reconnu comme genre de pièce à l'intake (`document_kind` inclut `bpu_dqe`), sans traitement propre.

**CCTP** — *Cahier des Clauses Techniques Particulières*
Descriptif technique des ouvrages, qui fait foi contractuellement.
→ Reconnu à l'intake (`document_kind = 'cctp'`), non exploité au chiffrage.

**Mémoire technique** 🚫
Dossier décrivant les moyens, méthodes et références de l'entreprise. Souvent 40 à 60 % de la note
en marché public.
→ Aucune implémentation.

**DC1 / DC2** 🚫
Formulaires de candidature aux marchés publics.
→ Aucune implémentation.

---

## Structure d'un devis

**Lot**
Ensemble de travaux d'un même corps d'état (gros œuvre, CVC, électricité…). Unité d'allotissement
d'un marché.
→ ⚠️ **Pas de type en base.** Le mot n'est qu'un **libellé cosmétique** du niveau 1 de hiérarchie
(`hierarchy.ts:8-13`). Aucun `lot_code`, aucun `trade`, aucun récapitulatif TCE, aucune extraction
de lot.

**Ouvrage**
Prestation élémentaire chiffrable avec son sous-détail (ex. « cloison 98/48 BA13, 1 face »).
→ Deux sens dans le produit : le **libellé** du niveau 4 de hiérarchie, et les **assemblages
réutilisables** (`estimate_assemblies`) qui portent le vrai sous-détail.
⚠️ Un search-replace de juillet 2026 a remplacé « assemblage » par « ouvrage » dans la doc
historique, produisant des tournures absurdes. Dans le code, c'est `assembly`.

**Ligne**
Poste chiffré : désignation, quantité, unité, PU, total.
→ `estimate_items` avec `item_type = 'line'`. 🔴 **Sans colonne `unit`.**

**Section**
Nœud de regroupement (lot, chapitre, sous-chapitre).
→ `item_type = 'section'`, tous champs de prix à `null`, profondeur max 4.

---

## Métré

**Métré**
Mesure des quantités d'ouvrages à partir des plans.
→ Module `takeoff`, assisté par Gemini. **Désactivé par défaut** : le flag tenant
`TAKEOFF_MODULE_ENABLED` vaut `false`.

**Niveaux A / B / C** ⚠️
→ Dans le produit, ce sont des **profondeurs d'extraction** (A « Rapide », B « Standard »,
C « Détaillé »), **pas** des niveaux de fiabilité. Mais ils sont convertis en score de confiance
(**A → 0,92 / B → 0,68 / C → 0,42**, `line-truth.ts:327-333`), ce qui les fait *lire* comme un
niveau de fiabilité. Ambiguïté à connaître.

**Carnet de métrés** 🚫
Feuille de calcul détaillant chaque quantité : `n × L × l × h`, par local ou par zone, avec
déductions signées (ouvertures, trémies). Pièce justificative de référence.
→ Aucune table, aucun champ de dimension.

**Formule de quantité** 🚫
Expression calculée dans une cellule de quantité, avec variables et références croisées.
→ Aucun parseur. Le type d'évidence `"formula"` du takeoff désigne uniquement une **agrégation par
somme** (`evidence.ts:378-411`).

**Provenance / évidence**
Traçabilité d'une quantité jusqu'à sa source (document, page, zone).
→ Implémenté : `source_provider`, `source_job_id`, `source_file_name`, `source_page` sur
`estimate_items` ; `confidence`, `evidence`, `is_verified` côté takeoff. Les *bounding boxes* ne sont
jamais écrites, seulement lues opportunément.

---

## Exécution et facturation

**Situation de travaux** 🚫
Facture périodique à l'avancement : cumul, mois, reste à faire, avec retenues.
→ Aucune implémentation. Backlog `EST-E18`.

**Avenant** 🚫
Modification contractuelle du marché, numérotée, qui ajuste montant ou délai.
→ Aucune implémentation. À ne pas confondre avec les **variantes** de devis
(`estimate_variants`), qui sont un outil de chiffrage avant signature.

**Retenue de garantie** 🚫
5 % retenus sur chaque situation, libérés un an après réception, ou remplacés par une caution
bancaire de substitution.
→ Aucune implémentation.

**DGD** — *Décompte Général Définitif* 🚫
Solde final du marché, qui clôt les comptes.
→ Aucune implémentation.

**Révision / actualisation de prix** 🚫
Ajustement du prix par indices (BT01, BT50…) entre l'offre et l'exécution.
→ La table `material_indices` existe, mais aucun moteur de révision.

**Compte prorata** 🚫
Dépenses communes de chantier réparties entre les lots.
→ Aucune implémentation.

---

## Fiscalité

**Autoliquidation de TVA** ✅
En sous-traitance BTP, le sous-traitant facture **hors taxes** et c'est le donneur d'ordre qui
déclare la TVA (art. 283-2 nonies du CGI). La facture doit porter la mention « Autoliquidation » et
**aucune ligne de TVA**.
→ **Implémenté intégralement** : `contractor_role ∈ ('principal','subcontractor')`, taux résolu à
zéro en un point unique, arrondi TTC court-circuité, mention au document, CGV conditionnées, et le
champ n'entre dans le sceau que s'il diffère du défaut. Voir
[regles-de-calcul.md § 5.1](regles-de-calcul.md).

**Taux réduits BTP** 🚫
5,5 % (rénovation énergétique) et 10 % (travaux d'amélioration sur logement de plus de 2 ans),
contre 20 % en taux normal.
→ Aucun preset : champ pourcentage libre. Et le **multi-taux est inopérant** (le taux de version
écrase le taux de ligne).

**CERFA 1301-SD** 🚫
Attestation du client justifiant l'application d'un taux réduit.
→ Aucune implémentation.

---

## Cycle commercial

**Affaire**
Le dossier client, de la consultation à la remise d'offre.
→ `estimate_projects`. 🔴 **Sans cycle de vie** : un simple booléen `is_archived`. Ni prospect / à
chiffrer / remis / gagné / perdu, ni date de remise, ni motif de perte — donc **aucun taux de
transformation mesurable**.

**Version de devis**
État figé d'un chiffrage. Une affaire en porte plusieurs.
→ `estimate_versions`, statuts `draft → sent → accepted | archived`. Voir
[cycle-de-vie.md](cycle-de-vie.md).

**Variante**
Chiffrage alternatif proposé en parallèle de l'offre de base.
→ Implémenté (`estimate_variants`, `promoteEstimateVariant`).

**Option / PSE** — *Prestation Supplémentaire Éventuelle* 🚫
Poste chiffré séparément, que le maître d'ouvrage retient ou non.
→ Aucun statut de ligne dédié.

---

## Rôles

| Rôle (`tenant_role`) | Périmètre |
|---|---|
| `admin` | Accès complet, forçage d'envoi et de verrou, gestion des règles et des taux |
| `engineer` | Chiffreur : écriture sur les devis en brouillon |
| `director` | Validation, revue de direction, portefeuille de risque — lecture seule sur les devis |
| `viewer` | Lecture seule |
