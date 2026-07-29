# Analyse Persona V3 — Takeoff / Metre

> 3 personas, 3 parcours, 14 stories analysees sous l'angle utilisateur.

---

## Persona 1 — Marie, Chiffreuse Junior

### Profil

| | |
|---|---|
| **Role** | Chiffreuse depuis 8 mois, sortie d'ecole |
| **Mode UI** | `simplified` (par defaut) |
| **Contexte** | PME batiment, 15 salaries. Marie traite 3-4 affaires par mois. |
| **Outil avant TIMAX** | Excel + plans papier + surligneur |
| **Rapport au digital** | A l'aise smartphone, moins avec les outils metier complexes |

### Objectifs

- Repondre aux appels d'offres sans oublier de postes
- Avoir confiance dans les quantites avant de soumettre
- Ne pas se tromper de fichier entre V1 et V2

### Frustrations actuelles (avant V3)

- Le module takeoff est cache dans `/dashboard/takeoff` — Marie ne sait pas qu'il existe
- La page review affiche une table dense avec 3 onglets, des filtres, des strategies de merge
  qu'elle ne comprend pas
- Pas de lien entre le DPGF qu'elle a importe et les quantites extraites par l'IA
- Elle uploade ses plans dans une version, puis quand elle cree V2, ses plans "disparaissent"

### Parcours V3 de Marie

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Marie ouvre son affaire "Ecole Jean Jaures"    │
                    │     → Hub affaire avec PlansMetresCard visible     │
                    │     (V3-005 : card resume plans + dernier job)     │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Import DPGF + Upload plans en meme temps       │
                    │     → Etape optionnelle "Ajouter vos plans" dans   │
                    │       le flux d'import (V3-013)                    │
                    │     → Drop 3 PDF, compteur "3 fichiers, 42 Mo"    │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Prompt auto-trigger                            │
                    │     → "Lancer l'extraction automatique ?" → Oui   │
                    │     (V3-014 : Level A auto, fire-and-forget)       │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Review simplifiee                              │
                    │     → Cartes une par une : description + quantite  │
                    │     → 2 boutons : Accepter / Rejeter              │
                    │     → Barre progression "12/18 items revus"       │
                    │     (V3-012 : vue junior, mode simplified)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Application automatique                        │
                    │     → Strategie fixe "append" (pas de choix)      │
                    │     → TakeoffApplyWizard (meme wizard, simplifie) │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  6. Nouvelle version V2                            │
                    │     → "Reprendre les metres de V1 ?" → Oui       │
                    │     → Les plans sont deja la (project-scope)      │
                    │     (V3-001/004 : plans project-scoped)           │
                    │     (V3-011 : carry-over takeoff jobs)            │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Marie

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-005 | **Fort** — decouvre le takeoff depuis son hub quotidien | Visibilite (elle ne savait pas que ca existait) |
| V3-012 | **Critique** — la review simplifiee est son interface principale | Confiance (elle comprend ce qu'elle valide) |
| V3-013 | **Fort** — upload plans dans le flux naturel d'import | Fluidite (pas de detour vers une autre page) |
| V3-014 | **Moyen** — extraction auto apres upload | Gain de temps (mais elle ne sait pas ce qu'est "Level A") |
| V3-001/004 | **Indirect** — plans partages entre versions | Plus de "mes plans ont disparu" |
| V3-011 | **Moyen** — carry-over metres entre versions | Pas besoin de tout refaire sur V2 |
| V3-009 | **Faible** — action rapide depuis le hub | Elle preferera le flux import integre (V3-013) |
| V3-010 | **Nul** — comparaison DPGF vs Takeoff | Reserve au mode expert, pas visible pour elle |

### Risques / Points d'attention

- **Le prompt auto-trigger (V3-014) doit etre pedagogique** — Marie ne sait pas ce qu'est
  un "Level A". Le wording doit etre "Voulez-vous que l'IA analyse vos plans automatiquement ?"
  et non "Lancer extraction Level A ?"
- **La review simplifiee (V3-012) doit afficher le contexte** — une carte avec juste
  "Cloisons 48/72 — 125 m2" ne suffit pas ; il faut montrer la page du PDF source pour
  que Marie puisse verifier visuellement
- **Le carry-over (V3-011) doit etre propose, pas impose** — Marie ne comprend pas
  ce que signifie "reprendre les metres" si on ne lui explique pas

---

## Persona 2 — Laurent, Chiffreur Senior

### Profil

| | |
|---|---|
| **Role** | Chiffreur depuis 12 ans, responsable chiffrage |
| **Mode UI** | `expert` |
| **Contexte** | ETI batiment, 120 salaries. Laurent traite 8-10 affaires simultanement. |
| **Outil avant TIMAX** | Logiciel metier legacy (Batigest/Onaya) + Excel avance |
| **Rapport au digital** | Power user, raccourcis clavier, veut aller vite |

### Objectifs

- Gagner du temps sur le chiffrage en automatisant les metres
- Comparer ses metres IA avec les quantites du DPGF client pour detecter les oublis
- Maitriser la qualite : pouvoir modifier, exclure, re-mesurer ligne par ligne
- Reutiliser ses metres quand le client demande une V2 avec variantes

### Frustrations actuelles (avant V3)

- Le takeoff est accessible mais deconnecte de l'affaire — il faut naviguer vers
  `/dashboard/takeoff`, retrouver la bonne version, lancer un job
- Pas de comparaison DPGF ↔ Takeoff : Laurent doit ouvrir le DPGF dans un onglet,
  la review takeoff dans un autre, et comparer a l'oeil
- Les plans sont version-scoped : quand il cree V2, il doit re-uploader les memes PDF
- L'action "Lancer un metre" n'est pas accessible depuis le hub

### Parcours V3 de Laurent

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Laurent ouvre l'affaire "Clinique Pasteur"     │
                    │     → Hub avec PlansMetresCard : "3 jeux, 12 PDF, │
                    │       dernier job: termine, 47 items"             │
                    │     (V3-005 : resume instantane)                  │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Gestion fine des plans                         │
                    │     → Clic "Voir les plans" → Page Plan Center    │
                    │     → 3 plan sets : Archi, Structure, CVC         │
                    │     → Upload nouveau PDF dans set "Structure"     │
                    │     (V3-006 : page dediee, CRUD plan sets)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Lancer un metre depuis le hub                  │
                    │     → Bouton "Lancer un metre" (QuickActionsCard) │
                    │     → TakeoffUploadForm pre-configure :           │
                    │       projectId auto, derniere version draft       │
                    │     → Choix Level B (tables structurees)          │
                    │     (V3-009 : action rapide)                      │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Suivi des jobs                                 │
                    │     → Redirect vers page Takeoff Jobs affaire     │
                    │     → Filtre "V3 uniquement" : 2 jobs en cours    │
                    │     → Compteurs : 5 total, 3 termines, 2 en cours │
                    │     (V3-007 : page jobs cross-versions)           │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Review complete (mode expert)                  │
                    │     → Table complete avec toutes les colonnes      │
                    │     → Inline edit : corriger une quantite          │
                    │     → Exclure avec raison : "doublon avec lot 3"  │
                    │     → Onglet "Comparaison DPGF" :                 │
                    │       cote-a-cote, delta %, codes couleur          │
                    │     (V3-012 : vue expert complete)                │
                    │     (V3-010 : comparaison DPGF vs Takeoff)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  6. Application avec strategie                     │
                    │     → Choix "merge" (fusionner avec existant)     │
                    │     → Override par item : "Cloisons" → forcer     │
                    │       la quantite DPGF au lieu du takeoff         │
                    │     → TakeoffApplyWizard complet                  │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  7. Nouvelle version V2 (variante sans lot CVC)   │
                    │     → "Reprendre metres de V1" → oui             │
                    │     → Plans deja partages (project-scope)         │
                    │     → Badge "(from V1)" sur les items repris      │
                    │     → Re-lance un metre Level B sur lot modifie   │
                    │     (V3-011 : carry-over + TakeoffSourceBadge)    │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Laurent

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-010 | **Critique** — comparaison DPGF vs Takeoff | Son besoin #1 : detecter oublis et ecarts |
| V3-006 | **Fort** — gestion plans dans l'affaire | Plus besoin de naviguer vers `/dashboard/takeoff` |
| V3-007 | **Fort** — suivi jobs cross-versions | Vue d'ensemble de tous ses metres par affaire |
| V3-009 | **Fort** — lancer metre en 1 clic | Gain de temps quotidien |
| V3-011 | **Fort** — carry-over metres entre versions | Ne pas refaire les metres quand le client revient |
| V3-001/004 | **Fort** — plans project-scoped | Plus de re-upload des memes PDF |
| V3-005 | **Moyen** — card resume dans le hub | Vue rapide, mais il ira vite vers la page complete |
| V3-012 | **Faible** — il est en mode expert, pas concerne par la vue simplifiee | Le toggle "Vue simplifiee" peut servir pour montrer a un client |
| V3-013 | **Faible** — upload dans import flow | Il prefere gerer ses plans sets manuellement (V3-006) |

### Risques / Points d'attention

- **La comparaison DPGF (V3-010) est le feature decisive** — si l'algorithme de matching
  est mediocre (descriptions DPGF != descriptions takeoff), Laurent perdra confiance et
  reviendra a sa methode manuelle. Le lien manuel (drag/select) est crucial.
- **Le carry-over (V3-011) doit preserver les exclusions et modifications** — si Laurent
  a exclu un item en V1 et le retrouve en V2 sans l'exclusion, c'est une regression
- **Le filtre par version (V3-007) doit etre rapide** — Laurent a potentiellement 20+ jobs
  sur une affaire complexe avec 5 versions
- **Le merge strategy dans l'apply wizard doit respecter les overrides** — s'il a force
  une quantite, une re-application ne doit pas l'ecraser

---

## Persona 3 — Nadia, Conductrice de travaux

### Profil

| | |
|---|---|
| **Role** | Conductrice de travaux, supervise 4 chiffreurs |
| **Mode UI** | `expert` (mais utilise peu les features avancees) |
| **Contexte** | ETI batiment, meme entreprise que Laurent. Responsable de la validation. |
| **Outil avant TIMAX** | Recoit les devis par email, annote en PDF, valide par telephone |
| **Rapport au digital** | Correcte, prefere les vues synthese aux interfaces denses |

### Objectifs

- Verifier que les quantites sont coherentes avant soumission
- Identifier les ecarts significatifs entre DPGF client et metres reels
- S'assurer que tous les lots ont ete metres (pas d'oubli)
- Avoir une vue d'ensemble sans entrer dans le detail de chaque ligne

### Frustrations actuelles (avant V3)

- Pas de vue "resume metre" — elle doit ouvrir chaque job takeoff individuellement
- Pas de comparaison DPGF ↔ Takeoff — elle demande a Laurent de lui faire un Excel
- Pas de visibilite sur l'etat d'avancement des metres depuis le hub affaire
- Elle ne sait pas quels plans ont ete uploades ni lesquels ont ete metres

### Parcours V3 de Nadia

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Nadia ouvre l'affaire "Clinique Pasteur"       │
                    │     → PlansMetresCard : "3 jeux, dernier job      │
                    │       termine, 47 items extraits"                 │
                    │     → Elle sait immediatement ou en est le metre  │
                    │     (V3-005 : resume dans le hub)                 │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Vue d'ensemble des jobs                        │
                    │     → Page Takeoff Jobs : tous les jobs du projet │
                    │     → Compteurs : 5 termines, 0 en cours,         │
                    │       1 echoue (lot CVC)                          │
                    │     → Filtre par version pour voir l'evolution    │
                    │     (V3-007 : suivi jobs)                         │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Comparaison DPGF vs Takeoff (le coeur)        │
                    │     → Onglet "Comparaison DPGF" dans la review    │
                    │     → Resume : 38 matches, 5 ecarts >20%,        │
                    │       4 absents du takeoff                        │
                    │     → Scan rapide des lignes rouges :             │
                    │       "Faux plafond: DPGF 800m2, Takeoff 520m2"  │
                    │     → Note mentale : demander a Laurent de        │
                    │       verifier le lot faux plafond                │
                    │     (V3-010 : vue comparaison)                    │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Verification plans                             │
                    │     → Page Plan Center : verifie que tous les     │
                    │       lots ont des plans uploades                 │
                    │     → Archi: 4 PDF ✓, Structure: 3 PDF ✓,        │
                    │       CVC: 0 PDF ✗ → "manque les plans CVC"      │
                    │     (V3-006 : page plans affaire)                 │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Validation inter-versions                      │
                    │     → Ouvre V2 : voit badge "(from V1)" sur les   │
                    │       items repris → sait que c'est du carry-over │
                    │     → Verifie que les nouvelles quantites du lot  │
                    │       modifie sont bien issues d'un job V2        │
                    │     (V3-011 : tracabilite carry-over)             │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Nadia

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-005 | **Critique** — resume metre dans le hub | Sa vue principale, pas besoin d'aller plus loin 80% du temps |
| V3-010 | **Critique** — comparaison DPGF vs Takeoff | Son outil de validation principal |
| V3-007 | **Fort** — vue d'ensemble jobs | Savoir quels lots sont metres, echoues, en cours |
| V3-006 | **Moyen** — page plans | Verification completude des plans uploades |
| V3-011 | **Moyen** — carry-over tracabilite | Comprendre l'historique des metres entre versions |
| V3-001/004 | **Indirect** — plans project-scoped | Plus de confusion "ou sont les plans de V1 ?" |
| V3-009 | **Faible** — lancer un metre | Elle ne lance pas de metre elle-meme |
| V3-012 | **Nul** — vue junior/senior | Elle n'est pas dans le parcours review/apply |
| V3-013/014 | **Nul** — import/auto-trigger | Elle ne fait pas l'import DPGF |

### Risques / Points d'attention

- **La card PlansMetresCard (V3-005) est son point d'entree principal** — elle doit
  afficher assez d'info pour qu'elle n'ait pas besoin de naviguer plus loin :
  nombre de jeux, nombre de fichiers, statut dernier job, nombre d'items extraits
- **La comparaison DPGF (V3-010) doit permettre un scan rapide** — Nadia ne va pas
  examiner 200 lignes ; elle a besoin du resume en haut (matches, ecarts, absents)
  et ne regarde que les lignes rouges
- **L'export CSV (V3-010, optionnel P2) serait tres utile** pour envoyer le rapport
  de comparaison par email au maitre d'oeuvre
- **Nadia est le persona qui justifie le plus V3-010** — sans la comparaison, elle
  continue a demander des Excel a Laurent

---

## Matrice d'impact croisee

| Story | Marie (Junior) | Laurent (Senior) | Nadia (Conductrice) |
|-------|:--------------:|:-----------------:|:-------------------:|
| V3-001 | indirect | **fort** | indirect |
| V3-002 | — | — | — |
| V3-003 | — | — | — |
| V3-004 | indirect | **fort** | indirect |
| V3-005 | **fort** | moyen | **critique** |
| V3-006 | faible | **fort** | moyen |
| V3-007 | faible | **fort** | **fort** |
| V3-008 | moyen | moyen | moyen |
| V3-009 | faible | **fort** | — |
| V3-010 | — | **critique** | **critique** |
| V3-011 | moyen | **fort** | moyen |
| V3-012 | **critique** | faible | — |
| V3-013 | **fort** | faible | — |
| V3-014 | moyen | — | — |

### Stories a plus forte valeur multi-persona

1. **V3-005 (PlansMetresCard)** — impacte les 3 personas, point d'entree universel
2. **V3-010 (Comparaison DPGF)** — critique pour Laurent ET Nadia (validation + detection ecarts)
3. **V3-012 (UX Junior/Senior)** — critique pour Marie (seul moyen d'utiliser le takeoff)
4. **V3-007 (Page Jobs)** — fort pour Laurent + Nadia (suivi et vue d'ensemble)

### Stories a faible portee (mais necessaires)

- **V3-001/002/003/004** — infrastructure invisible mais fondation de tout le reste
- **V3-008 (sidebar)** — qualite de vie, pas de valeur metier directe
- **V3-014 (auto-trigger)** — P2, convenance pour Marie uniquement

---

## Recommandations UX par persona

### Pour Marie (Junior)

1. **Le wording doit etre metier, pas technique** — "Analyser vos plans" plutot que
   "Lancer extraction Level A". "Quantites detectees" plutot que "Items takeoff".
2. **La review simplifiee (V3-012) doit montrer le contexte PDF** — un thumbnail ou
   lien vers la page source du plan pour chaque item
3. **Les actions doivent etre binaires** — pas de choix entre append/replace/merge.
   Le systeme choisit pour elle.
4. **L'onboarding doit mentionner le takeoff** — quand Marie voit la PlansMetresCard
   pour la premiere fois, un tooltip "Nouveau : analysez vos plans avec l'IA"
   guiderait son adoption

### Pour Laurent (Senior)

1. **La comparaison DPGF (V3-010) doit etre accessible en 2 clics max** — depuis le hub,
   clic sur la card → dernier job → onglet comparaison
2. **Le matching algorithmique doit exposer son score** — Laurent veut comprendre
   POURQUOI le systeme a matche "Cloisons platre" avec "Doublage platre"
3. **Les overrides doivent persister** — si Laurent force une quantite, un carry-over
   ou une re-application ne doit pas l'ecraser silencieusement
4. **Le raccourci clavier devrait exister** — dans la command palette (UX2-018),
   "Lancer un metre" devrait etre une action accessible via Ctrl+K

### Pour Nadia (Conductrice)

1. **La PlansMetresCard (V3-005) doit etre auto-suffisante** — resume complet sans
   navigation supplementaire pour 80% de ses consultations
2. **Le resume comparaison doit etre exportable** — CSV ou PDF pour transmission
   au client/maitre d'oeuvre (renforcer la priorite du CSV export dans V3-010)
3. **Les ecarts significatifs doivent remonter dans le hub** — un badge "5 ecarts >20%"
   sur la PlansMetresCard eviterait a Nadia d'ouvrir la page comparaison
4. **Une vue "couverture metres" serait ideale** — quel pourcentage des postes DPGF
   ont ete metres ? (non prevu en V3, candidat V4)

---

## Heatmap priorite par persona

```
                    Marie         Laurent        Nadia
                   (Junior)      (Senior)    (Conductrice)
                 ─────────── ─────────────── ───────────────
  P0 DB/Back     ░░░░░░░░░░  ███████████░░  ░░░░░░░░░░░░░
  (V3-001→004)   invisible    fondation       invisible

  P0 Hub/Pages   ██████████  ██████████░░░  ████████████░░
  (V3-005→006)   decouverte   productivite   vue d'ensemble

  P1 Workflow    ████████░░  ████████████░  ████████████░░
  (V3-007→012)   review       comparaison    validation
                  simplifiee   DPGF           inter-versions

  P2 Import      ██████░░░░  ░░░░░░░░░░░░  ░░░░░░░░░░░░░
  (V3-013→014)   fluidite     pas concerne   pas concerne
```

> `█` = forte valeur pour le persona | `░` = faible ou nulle
