# Analyse PRD — Enseignements pour les User Stories V1

## Contexte

Les documents dans `docs/prd_file/` sont des exemples reels du metier (devis vierge, BDC fournisseur,
catalogue produits, DPGF client, chiffrages OPTIMA). Leur analyse a revele des concepts metier absents
ou sous-specifies dans les user stories V1. Ce document synthetise les enseignements et trace le lien
vers les stories creees ou enrichies.

---

## Documents analyses

| Document | Chemin | Description |
| -------- | ------ | ----------- |
| Devis vierge V1 | `docs/prd_file/devis_vierge_v1.xlsx` | Template de devis avec tranches de marge commerciale |
| Explication BDC V1.1 | `docs/prd_file/explication BDC V1.1.docx` | Specification du Bon de Commande a 31 colonnes |
| MM_BDC_V1.1 | `docs/prd_file/MM_BDC_V1.1.csv` | Exemple reel de BDC avec 3 fournisseurs par article |
| DPGF COLT PAR2 LOT4 | `docs/prd_file/HEX-DPGF-COLT-PAR2-LOT4.xlsx` | DPGF client avec separation MO atelier/chantier |
| OPTIMA Hydraulique | `docs/prd_file/OPTIMA Hydraulique.xlsx` | Chiffrage reel — 2948 lignes avec coefficients et majorations |
| OPTIMA Plomberie | `docs/prd_file/OPTIMA Plomberie.xlsx` | Chiffrage reel — 1398 lignes avec coefficients et majorations |
| MM_appro | `docs/prd_file/MM_appro.xlsm` | Fichier approvisionnement avec identifiant AID structure |

---

## Concepts reveles et impact

### 1. Marge par tranches de valeur projet

**Source :** `devis_vierge_v1.xlsx`

Le template de devis reel utilise un systeme de marge par tranches et non un coefficient fixe :
- Projet < 100k EUR → coefficient 1.6
- Projet < 1M EUR → coefficient 1.45
- Projet > 1M EUR → coefficient 1.4

**Impact :** Le champ `margin_multiplier` unique actuel est insuffisant. Le moteur de calcul
doit supporter un mode "tranches" avec determination automatique du coefficient.

**Stories impactees :**
- **EST-028** (nouvelle) — Marge par tranches de valeur projet
- **EST-082** (enrichie) — Selection marge fixe/tranches dans le wizard de creation
- **EST-025** (enrichie) — Coefficient global complementaire

### 2. Structure BDC a 31 colonnes

**Source :** `explication BDC V1.1.docx`, `MM_BDC_V1.1.csv`

Le BDC reel comporte 31 colonnes organisees en sections :
- **Identification** : position, AID, designation, unite, quantite
- **Fourniture (FO)** : type FO, prix unitaire, prix reference, coefficient FO
- **Main d'oeuvre (MO)** : heures MO, coefficient MO, taux horaire
- **Totaux** : total FO, total MO, total HT
- **3 Fournisseurs** : nom, prix, reference, URL (x3)
- **Reference** interne

**Impact :** L'export actuel ne couvre pas ce format. Un mode d'export BDC dedie est necessaire
avec en-tetes colores et formules Excel.

**Stories impactees :**
- **EST-202** (enrichie) — Mode export BDC 31 colonnes
- **EST-104** (enrichie) — Auto-detection format BDC au copier-coller
- **EST-029** (nouvelle) — Classification Type FO

### 3. Alternatives multi-fournisseurs

**Source :** `MM_BDC_V1.1.csv`

Chaque article du BDC inclut jusqu'a 3 alternatives fournisseurs avec nom, prix, reference
et URL catalogue. Cela permet une comparaison systematique pour choisir la meilleure offre.

**Impact :** La comparaison fournisseur est absente du module actuel. Il faut ajouter un
mecanisme de selection et de comparaison des prix.

**Stories impactees :**
- **EST-030** (nouvelle) — Comparaison multi-fournisseurs par article
- **EST-164** (enrichie) — Suggestions catalogue avec alternatives fournisseur

### 4. Separation MO Atelier / Chantier

**Source :** `HEX-DPGF-COLT-PAR2-LOT4.xlsx`

Les DPGF clients separent systematiquement la main d'oeuvre atelier (prefabrication) de
la main d'oeuvre chantier (pose sur site), avec des quantites et taux horaires distincts.

**Impact :** Le modele actuel ne gere qu'un seul bloc MO par ligne. Un split
atelier/chantier conditionnel (via feature flag) est necessaire pour repondre aux DPGF clients.

**Stories impactees :**
- **EST-031** (nouvelle) — Split MO Atelier / Chantier
- **EST-141** (enrichie) — Flag warning `labor_split_incomplete`

### 5. Coefficient de majoration et echelle OPTIMA

**Source :** `OPTIMA Hydraulique`, `OPTIMA Plomberie`

Les fichiers OPTIMA reels revelent :
- Un **coefficient de majoration** du temps de pose par ligne (ex: conditions difficiles)
- Un **coefficient global** (1.30) applique a l'ensemble du devis
- Des coefficients FO et MO par ligne
- Une **echelle de 2948 lignes** pour un seul lot (hydraulique)

**Impact :**
- La majoration MO est absente du modele actuel
- Le coefficient global n'est pas supporte
- Les cibles de performance (500 lignes) sont insuffisantes face a l'echelle reelle

**Stories impactees :**
- **EST-032** (nouvelle) — Coefficient de majoration temps de pose
- **EST-025** (enrichie) — Coefficient global sur estimate_versions
- **EST-034** (nouvelle) — Import format OPTIMA
- **EST-264** (mise a jour) — Performance editeur 3000 lignes (promu M4 → M1)
- **EST-265** (mise a jour) — Tests de charge 3000+ lignes

### 6. Identifiant structure AID

**Source :** `MM_appro.xlsm`

Le fichier approvisionnement utilise un identifiant structure AID au format
`[Matiere].[Type].[DN]` (ex: CU.RAC.15 = Cuivre, Raccord, DN15) pour referencer
les articles de maniere unique et coherente avec le catalogue.

**Impact :** L'identifiant AID est absent du modele actuel. Il doit etre ajoute comme
colonne sur les lignes de devis avec validation pattern configurable.

**Stories impactees :**
- **EST-033** (nouvelle) — Identifiant structure AID

---

## Synthese des re-priorisations

Les documents PRD ont conduit a reviser les priorites de certaines stories :

### Promus
| Story | Avant | Apres | Raison |
| ----- | ----- | ----- | ------ |
| EST-028 (Marge tranches) | — | P1 M0 | Tout template reel utilise des tranches |
| EST-031 (Split atelier/chantier) | — | P1 M1 | Requis pour repondre aux DPGF clients |
| EST-264 (Perf editeur) | P0 M4 | P0 M1 | 3000 lignes = blocker immediat |
| EST-121 (Sous-totaux) | P0 M1 | P0 M0 | Navigation primaire dans les gros devis |
| EST-034 (Import OPTIMA) | — | P1 M2 | Format reellement utilise par l'equipe |

### Reportes
| Story | Avant | Apres | Raison |
| ----- | ----- | ----- | ------ |
| EST-027 (Multi-devises) | P2 M0 | P2 M3 | Tous les docs reels sont en EUR |
| EST-204 (Import Batigest/Onaya) | P2 M3 | P2 M4 | OPTIMA prioritaire (format reel) |
| EST-025 (Remise cascade) | P2 M0 | P2 M2 | Le coeff global est plus urgent |

---

## Cibles de performance revisees

| Critere | Ancien seuil | Nouveau seuil | Justification |
| ------- | ------------ | ------------- | ------------- |
| Render editeur | < 100ms / 500 lignes | **< 100ms / 1000 lignes** | OPTIMA Hydraulique = 2948 lignes |
| Chargement editeur | < 500ms / 1000 lignes | **< 500ms / 3000 lignes** | Echelle reelle des devis |
| Scroll editeur | — | **60fps / 3000 lignes** avec flags qualite | Nouveau critere |
| Export charge | 500+ lignes | **3000+ lignes** | Aligner sur l'echelle reelle |
| Export streaming | Timeout-safe 500+ lignes | **Timeout-safe 3000+ lignes** | Idem |
