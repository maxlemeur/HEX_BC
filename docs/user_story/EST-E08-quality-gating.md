# EST-E08 — Qualite (anomalies) + gating

> Milestone: M2 | Priorite: P1 | Statut: A faire

## Objectif

Etendre le systeme de drapeaux qualite existant en un mecanisme de gating qui empeche l'envoi de devis incomplets, avec detection d'outliers statistiques et une checklist de completude. L'objectif est de garantir qu'aucun devis incomplet ou incoherent ne soit envoye au client.

## Ce qui existe deja

- **Drapeaux qualite (BC-010)** : `src/lib/estimate-quality.ts` — 4 drapeaux implementes : `missing_price`, `missing_quantity`, `missing_labor_time`, `missing_labor_role`.
- **Fonctions existantes** : `computeEstimateQualityFlagsForItem()` (drapeaux par item), `computeEstimateQualityFlagsByItemId()` (drapeaux indexes par ID), `countEstimateQualityFlags()` (comptage total).
- **Filtre qualite** : `src/components/estimates/EstimateEditorTable.tsx` — filtre integre pour afficher uniquement les lignes avec anomalies.
- **Gestion de statut** : `patchEstimateStatus()` dans `src/lib/estimates/server.ts` — transition de statut (draft → sent → accepted → archived), protegee par `guard_estimate_versions_readonly()`.
- **Page edition** : `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — composant client avec bouton d'envoi.

---

## EST-141 — Gating envoi (sent)

**Priorite:** P0 | **Effort:** M

### User Story

> En tant qu'admin, je veux bloquer le passage en statut "envoye" si des anomalies critiques sont presentes, afin de ne jamais envoyer un devis incomplet au client.

### Criteres d'acceptation

- [ ] Avant le changement de statut vers "sent", toutes les lignes sont validees contre les drapeaux qualite
- [ ] Les drapeaux sont classes en deux niveaux : bloquants (erreurs) et avertissements (warnings)
- [ ] Drapeaux bloquants par defaut : `missing_price`, `missing_quantity`
- [ ] Drapeaux avertissements par defaut : `missing_labor_time`, `missing_labor_role`
- [ ] La configuration des niveaux (bloquant/avertissement) est modifiable par l'admin
- [ ] Une modale recapitulative s'affiche avant l'envoi listant toutes les anomalies trouvees
- [ ] Si des erreurs bloquantes existent, le bouton "Envoyer" est desactive avec message explicatif
- [ ] Option "Forcer l'envoi" disponible uniquement pour le role admin, avec journalisation de l'action
- [ ] Les avertissements n'empechent pas l'envoi mais sont affiches dans la modale
- [ ] Flag bloquant `margin_not_configured` : marge par tranche selectionnee (EST-028) mais aucun jeu de tranches assigne au projet
- [ ] Flag warning `supplier_price_outdated` : au moins un prix fournisseur lie a une ligne a une date de mise a jour > 90 jours (configurable via feature flag `STALE_PRICE_DAYS`, defaut 90)
- [ ] Flag warning `labor_split_incomplete` : split atelier/chantier actif (EST-031) mais une seule des deux MO est renseignee sur au moins une ligne
- [ ] Flag bloquant `total_exceeds_budget` : total HT du devis depasse le plafond budgetaire du projet (si un plafond est configure dans les metadonnees projet)
- [ ] Flag bloquant `no_pdf_generated` : aucun PDF genere pour cette version (table `estimate_documents` vide)
- [ ] Bouton "Envoyer" declenche en sequence : 1) gating (flags bloquants), 2) generation PDF (EST-201), 3) upload Storage, 4) transition `draft→sent` + seal hash (EST-046), 5) ecriture event (EST-036)
- [ ] Spinner multi-etapes avec labels : "Verification...", "Generation PDF...", "Scellement..."

### Notes techniques

- Fichiers a modifier : `src/lib/estimates/server.ts` (modifier `patchEstimateStatus()` pour integrer la validation pre-envoi)
- Fichiers a creer : `src/lib/estimates/gating.ts` (logique de gating : classification des drapeaux, evaluation bloquant/warning)
- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/edit/page.tsx` (flux du bouton d'envoi avec modale de confirmation)
- Reutiliser : `computeEstimateQualityFlagsByItemId()` et `countEstimateQualityFlags()` de `src/lib/estimate-quality.ts`
- Fichiers a modifier : `src/lib/estimate-quality.ts` — ajouter les 4 nouveaux drapeaux dans `computeEstimateQualityFlagsForItem()` et les types associes
- Dependances : EST-028 (marge tranches), EST-031 (split MO)

---

## EST-142 — Checklist completude

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux une checklist de completude affichee en sidebar, afin de voir en un coup d'oeil ce qu'il reste a faire avant envoi.

### Criteres d'acceptation

- [ ] Panneau lateral (sidebar) affichant une checklist des criteres de completude
- [ ] Criteres verifies : tous les prix renseignes, toutes les quantites renseignees, tous les roles main-d'oeuvre assignes, marge definie, dates de validite renseignees
- [ ] Barre de progression indiquant le pourcentage de completude global
- [ ] Chaque critere non rempli est cliquable et scrolle vers la premiere anomalie correspondante dans le tableau
- [ ] La checklist se met a jour en temps reel a chaque modification dans l'editeur
- [ ] Code couleur : vert (complet), orange (avertissement), rouge (bloquant)
- [ ] La checklist est repliable pour ne pas encombrer l'espace de travail

### Notes techniques

- Fichiers a creer : `src/components/estimates/EstimateChecklist.tsx`
- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/edit/page.tsx` (integration du panneau lateral)
- Reutiliser : `computeEstimateQualityFlagsByItemId()` de `src/lib/estimate-quality.ts`, la logique de gating de `src/lib/estimates/gating.ts` (EST-141) pour la classification des criteres
- Dependances : EST-141

---

## EST-143 — Detection d'outliers

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux etre alerte si un prix unitaire ou une quantite est anormalement eleve ou bas par rapport aux autres lignes, afin de detecter les erreurs de saisie.

### Criteres d'acceptation

- [ ] Detection statistique des outliers par methode IQR (ecart interquartile) ou Z-score, configurable
- [ ] Nouveaux drapeaux qualite : `price_outlier` et `quantity_outlier`
- [ ] Les seuils de detection sont configurables (ex: facteur IQR = 1.5 par defaut)
- [ ] Indicateur visuel orange (avertissement) sur les cellules concernees, distinct des erreurs rouges
- [ ] Possibilite de marquer un outlier comme "accepte" (dismiss) par ligne, avec persistance
- [ ] L'analyse est effectuee par categorie si des categories existent (comparer les prix au sein d'une meme categorie)
- [ ] Les outliers dismisses ne sont pas comptabilises dans les drapeaux qualite actifs

### Notes techniques

- Fichiers a modifier : `src/lib/estimate-quality.ts` (ajout des drapeaux `price_outlier` et `quantity_outlier` dans le systeme existant)
- Fichiers a creer : `src/lib/estimates/outlier-detection.ts` (algorithmes IQR/Z-score, configuration des seuils)
- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx` (affichage des indicateurs outlier, bouton dismiss)
- Reutiliser : `computeEstimateQualityFlagsForItem()` de `src/lib/estimate-quality.ts` a etendre, les types `EstimateLineLike` de `src/lib/estimate-calculations.ts`
- Dependances : aucune

---

## EST-144 — Historique des anomalies

**Priorite:** P2 | **Effort:** S

### User Story

> En tant qu'admin, je veux consulter l'historique des anomalies resolues et non resolues, afin de suivre la qualite des devis dans le temps.

### Criteres d'acceptation

- [ ] Les changements de drapeaux qualite (apparition et resolution) sont journalises dans la table `audit_logs`
- [ ] Vue dashboard dediee affichant les tendances d'anomalies : nombre d'anomalies ouvertes/resolues par periode
- [ ] Filtres par type d'anomalie, par devis, par chiffreur et par periode
- [ ] Export du rapport d'anomalies au format CSV
- [ ] Graphique de tendance montrant l'evolution du nombre d'anomalies sur les derniers mois
- [ ] Temps moyen de resolution des anomalies affiche par type

### Notes techniques

- Fichiers a modifier : trigger d'audit existant (ajouter le suivi des changements de drapeaux qualite dans `audit_logs`)
- Fichiers a creer : `src/app/dashboard/estimates/quality/page.tsx` (page dashboard qualite)
- Reutiliser : `exportToCSV()` de `src/lib/export.ts` pour l'export, `createSupabaseServerClient()` de `src/lib/supabase/server.ts` pour les requetes agregees
- Dependances : EST-141

---

## EST-037 — Rules engine : garde-fous marge/remise + approbations

**Priorite:** P2 | **Effort:** L | **Milestone:** M4

### User Story

> En tant qu'admin, je veux configurer des regles metier (marge minimum par categorie, remise maximum, approbation requise au-dela d'un seuil), afin qu'aucun devis ne sorte avec des marges non protegees.

### Criteres d'acceptation

- [ ] Nouvelle table `estimate_rules` : `id` (uuid PK), `tenant_id` (FK), `rule_type` enum (`min_margin|max_discount|require_approval`), `scope_type` enum (`global|category|client`), `scope_id` (nullable, FK contextuelle), `threshold_value` (numeric), `action` enum (`warn|block|require_approval`), `is_active` (boolean, defaut true)
- [ ] Nouvelle table `estimate_approvals` : `id` (uuid PK), `version_id` (FK), `rule_id` (FK `estimate_rules`), `requested_by` (FK `auth.users`), `approved_by` (FK nullable), `status` enum (`pending|approved|rejected`), `decided_at` (timestamptz nullable)
- [ ] Moteur d'evaluation `evaluateRules(versionId)` appele dans le flux gating (EST-141) apres les drapeaux qualite
- [ ] Violations surfacees dans la modale gating comme nouveau type de flag `rule_violation` avec detail de la regle enfreinte
- [ ] Page admin `/dashboard/admin/rules` pour configurer les regles : creation, edition, activation/desactivation, suppression
- [ ] Endpoint POST `/api/estimates/[versionId]/approve` pour soumettre/approuver une demande d'approbation
- [ ] RLS : lecture pour tous les membres du tenant ; ecriture admin uniquement sur `estimate_rules` ; sur `estimate_approvals`, creation de demandes autorisee aux membres, mais decision (`approved`/`rejected`, `approved_by`, `decided_at`) reservee aux admins

### Notes techniques

- Fichiers a creer :
  - Migration `supabase/migrations/0xx_estimate_rules.sql` — tables `estimate_rules` et `estimate_approvals` avec RLS policies, index sur `tenant_id`
  - `src/lib/estimates/rules-engine.ts` — fonctions `evaluateRules()`, `checkMarginRule()`, `checkDiscountRule()`, `checkApprovalRule()`
  - `src/app/api/estimates/[versionId]/approve/route.ts` — POST endpoint pour gestion des approbations
  - `src/app/dashboard/admin/rules/page.tsx` — page admin de configuration des regles
- Fichiers a modifier :
  - `src/lib/estimates/gating.ts` — integrer `evaluateRules()` dans le flux de gating existant
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — afficher les violations de regles dans la modale gating
- Reutiliser :
  - `src/lib/estimates/gating.ts` — framework de gating existant (EST-141)
  - `src/lib/estimate-quality.ts` — pattern des drapeaux qualite pour les violations
  - `src/lib/estimates/errors.ts` — gestion d'erreurs
- Dependances : EST-141 (gating), EST-028 (marge tranches pour le calcul de marge par categorie)
