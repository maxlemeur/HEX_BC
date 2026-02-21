# EST-E05 — UI Base (ecrans)

> Milestone: M1 | Priorite: P1 | Statut: A faire

## Objectif

Refondre et ameliorer les ecrans principaux du module devis (liste, creation, edition, impression) pour offrir une meilleure experience utilisateur et des performances accrues. L'objectif est de fournir une navigation fluide, des filtres avances et une mise en page professionnelle pour l'impression.

## Ce qui existe deja

Les ecrans fonctionnels sont en place dans `src/app/dashboard/estimates/` :
- **Page liste** : `src/app/dashboard/estimates/page.tsx` — affichage des devis avec filtres basiques.
- **Page edition** : `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — composant client utilisant `EstimateEditorTable`, `EstimateSettingsPanel`, `LaborRolesManager`, `EstimateSuggestionRulesManager`.
- **Page impression** : `src/app/dashboard/estimates/[versionId]/print/page.tsx` — vue impression existante.
- **Composants** : `src/components/estimates/EstimateEditorTable.tsx` (tableau DnD avec dnd-kit, arbre sections/lignes), `src/components/estimates/EstimateSettingsPanel.tsx` (panneau parametres : marge, remise, TVA, arrondi), `src/components/estimates/DuplicateEstimateButton.tsx` (duplication de version).
- **Logique serveur** : `src/lib/estimates/server.ts` (~1600 lignes) — CRUD complet, tenant-aware.
- **Logique client** : `src/lib/estimates/client.ts` (~850 lignes) — wrappers client.
- **Export** : `src/lib/export.ts` — `exportToCSV()`, `exportToExcelWithSheets()`.

---

## EST-081 — Liste devis amelioree

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux filtrer, trier et rechercher mes devis par statut, client, date et montant, afin de retrouver rapidement un chiffrage.

### Criteres d'acceptation

- [ ] Barre de recherche textuelle filtrant sur le nom du projet et le client
- [ ] Filtres par statut sous forme de chips cliquables (draft, sent, accepted, archived)
- [ ] Tri par date de modification, montant total et nom de projet (ascendant/descendant)
- [ ] Pagination avec 20 resultats par page et navigation premiere/derniere page
- [ ] Les filtres et parametres de tri sont persistes dans les query params de l'URL
- [ ] Affichage responsive : tableau complet sur desktop, cartes sur mobile
- [ ] Les compteurs par statut sont affiches a cote de chaque chip filtre

### Notes techniques

- Fichiers a modifier : `src/app/dashboard/estimates/page.tsx`
- Fichiers a creer : `src/components/estimates/EstimateListFilters.tsx`
- Reutiliser : les types et schemas existants dans `src/lib/estimates/schemas.ts`, les fonctions serveur de `src/lib/estimates/server.ts` pour le fetching avec filtres
- Dependances : aucune

---

## EST-082 — Creation guidee (wizard)

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux un assistant de creation en etapes (projet, parametres, import optionnel), afin de ne rien oublier lors de la creation d'un nouveau devis.

### Criteres d'acceptation

- [ ] Wizard en 3 etapes : informations projet (nom, client, reference) → parametres (marge, TVA, arrondi) → import optionnel (DPGF)
- [ ] Indicateur de progression affichant l'etape courante et les etapes validees
- [ ] Le brouillon est sauvegarde automatiquement a chaque etape validee
- [ ] Navigation retour possible entre les etapes sans perte de donnees
- [ ] Validation Zod a chaque etape avant de passer a la suivante
- [ ] Bouton "Creer directement" pour sauter le wizard si l'utilisateur est avance
- [ ] Etape 2 enrichie : selecteur "Marge fixe" / "Marge par tranche" avec presets tenant (EST-028)
- [ ] Etape 2 enrichie : selecteur "Famille de projet" mappant au champ Famille Achat des DPGF clients
- [ ] Si "Marge par tranche" est selectionnee, les tranches configurees pour le tenant sont affichees en lecture seule

### Notes techniques

- Fichiers a modifier : `src/app/dashboard/estimates/new/page.tsx`
- Fichiers a creer : `src/components/estimates/EstimateCreationWizard.tsx`
- Reutiliser : les schemas Zod de `src/lib/estimates/schemas.ts` pour la validation par etape, `createEstimateVersion()` de `src/lib/estimates/server.ts`
- Dependances : aucune

---

## EST-083 — Dashboard recapitulatif

**Priorite:** P2 | **Effort:** M

### User Story

> En tant qu'admin, je veux un tableau de bord avec KPI (nombre de devis, taux d'acceptation, CA en cours), afin de piloter l'activite commerciale.

### Criteres d'acceptation

- [ ] Cartes KPI : nombre total de devis, nombre par statut, taux d'acceptation (accepted / sent)
- [ ] Montants totaux : CA accepte, CA en cours (sent), CA brouillon
- [ ] Graphique de tendance sur les 6 derniers mois (nombre de devis crees et acceptes par mois)
- [ ] Filtre par tenant pour les admins multi-tenant
- [ ] Mise a jour en temps reel ou au rechargement de la page
- [ ] Affichage responsive avec reorganisation des cartes sur mobile

### Notes techniques

- Fichiers a creer : `src/app/dashboard/estimates/dashboard/page.tsx`, `src/components/estimates/EstimateDashboard.tsx`, `src/app/api/estimates/stats/route.ts`
- Reutiliser : `createSupabaseServerClient()` de `src/lib/supabase/server.ts` pour les requetes agregees, `formatEUR()` de `src/lib/money.ts` pour l'affichage des montants
- Dependances : aucune

---

## EST-084 — Mode impression ameliore

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux une mise en page professionnelle pour l'impression et le PDF avec en-tete client, recapitulatif, sections et pied de page, afin de presenter un document de qualite au client.

### Criteres d'acceptation

- [ ] CSS d'impression dedie avec gestion des sauts de page (page-break-before/after)
- [ ] En-tete : logo entreprise, coordonnees, reference du devis, date, coordonnees client
- [ ] Corps : sections avec sous-totaux, lignes detaillees, numerotation des postes
- [ ] Pied de page : recapitulatif total HT, remise, TVA, total TTC, conditions de reglement
- [ ] Numerotation des pages en bas de chaque page imprimee
- [ ] Option QR code avec lien vers la version en ligne du devis (configurable)
- [ ] Rendu identique entre la previsualisation navigateur et le PDF genere

### Notes techniques

- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- Fichiers a creer : `src/styles/print.css`
- Reutiliser : `computeEstimateTotals()` de `src/lib/estimate-calculations.ts` pour les sous-totaux et totaux, `formatEUR()` de `src/lib/money.ts`
- Dependances : aucune
