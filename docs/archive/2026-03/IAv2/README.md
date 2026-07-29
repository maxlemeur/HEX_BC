# IAv2 — Takeoff IA, fiabilisation et passage a l'echelle

## Objectif

Transformer le socle IA actuel en un produit robuste pour un chiffreur BTP:
- cout maitrise par dossier
- parcours `plan -> pre-chiffrage exploitable`
- observabilite reelle
- reprise sur incident
- evaluation metier sur corpus reel

La V1 a prouve que les briques existent.
La V2 doit prouver que le systeme est exploitable en production, pilotable et rentable.

---

## Review appliquee de l'implementation actuelle

### Fondations deja en place sur `main`

- la persistence durable du provider batch et des etats `provider_batch_*` est en place
- la reconciliation batch est decouplee du cycle applicatif synchrone
- le budget d'escalade Level B projette deja le cout total avant rerun premium
- l'instrumentation des corrections humaines et des decisions DPGF alimente deja l'audit et les stats pilote

Ces points ne sont plus des gaps de baseline IAv2. Le cadrage ci-dessous porte uniquement sur le travail restant.

### Finding 1 — Medium

Le parcours `B/C` est ouvert, mais encore incomplet du point de vue metier.

Pourquoi:
- l'upload `B/C` est mono-fichier
- le lancement "plan set" depuis le prompt reste force sur `B`
- aucun vrai workflow guide ne couvre encore `dossier multi-plans -> analyse -> review -> reprise`

Impact:
- le code sait faire plus que le produit n'oriente
- un chiffreur peut se retrouver sans savoir quel niveau choisir selon son dossier

Code:
- `src/components/takeoff/TakeoffUploadForm.tsx`
- `src/components/affaires/LaunchMetreDialog.tsx`
- `src/components/takeoff/TakeoffLaunchPrompt.tsx`

Conclusion:
- il faut maintenant traiter le produit comme un workflow complet, pas comme un simple lanceur de jobs.

### Finding 2 — Medium

La reprise operateur existe dans le modele technique, mais reste encore partielle dans le parcours produit.

Pourquoi:
- les etats batch et la reconciliation sont persistants, mais les parcours de relance, abandon et remediation ne sont pas encore tous visibles de bout en bout
- le hub et les CTA de reprise doivent encore converger vers un contrat metier unique pour eviter les zones grises support

Impact:
- un incident provider peut encore demander une lecture technique du job plutot qu'une remediation evidente cote produit
- la promesse "batch durable" est reelle cote moteur, mais pas encore entierement transformee en parcours operateur robuste

Code:
- `src/lib/takeoff/activity-center.ts`
- `src/lib/takeoff/server.ts`

Conclusion:
- la suite IAv2 doit finir le passage de la durabilite technique vers une remediation operateur lisible et actionnable.

---

## Edge Cases a traiter en IAv2

| Sujet | Risque actuel | Reponse attendue en V2 |
|---|---|---|
| Batch Gemini long | fondation durable deja en place, reprise operateur encore a finaliser | monitoring, CTA de reprise et remediation visibles metier |
| Dossier multi-plans | mono-fichier `B/C` peu pratique | lancement plan set natif et merge traceable |
| Jobs bloques | reprise metier encore partielle malgre les etats batch persistants | ecran de reprise, relance, abandon, reconciliation |
| Output C trop brut | gain metier limite | pre-chiffrage structure par lots/familles/postes |
| Absence de benchmark reel | impossible de prouver le ROI | corpus, scoring, corrections humaines, pilot tenant |

---

## Epics IAv2

| Code | Nom | Priorite | Effort | Fichier |
|---|---|---|---|---|
| IAV2-E01 | Batch durable & reprise | P0 | L | [IAV2-E01-batch-durable-reprise.md](./IAV2-E01-batch-durable-reprise.md) |
| IAV2-E02 | Routage cout / confiance / complexite | P0 | L | [IAV2-E02-routing-budget-confiance.md](./IAV2-E02-routing-budget-confiance.md) |
| IAV2-E03 | Evaluation metier & pilote tenant | P0 | M | [IAV2-E03-evaluation-pilote-metier.md](./IAV2-E03-evaluation-pilote-metier.md) |
| IAV2-E04 | Niveau C pre-chiffrage exploitable | P1 | L | [IAV2-E04-niveau-c-pre-chiffrage-exploitable.md](./IAV2-E04-niveau-c-pre-chiffrage-exploitable.md) |
| IAV2-E05 | UX lancement, monitoring, remediation | P1 | M | [IAV2-E05-ux-lancement-monitoring-remediation.md](./IAV2-E05-ux-lancement-monitoring-remediation.md) |

---

## Sequencement recommande

### Lot 1

- IAV2-E01
- IAV2-E02
- IAV2-E03

Objectif:
- rendre la plateforme pilotable
- activer un pilote reel sans aveuglement cout/etat

### Lot 2

- IAV2-E04
- IAV2-E05

Objectif:
- convertir le moteur en vrai gain metier pour le chiffreur

---

## Definition of Done IAv2

Une story IA n'est pas consideree terminee si elle n'apporte pas les 4 preuves suivantes:
- preuve technique: tests et observabilite
- preuve produit: parcours clair pour le chiffreur
- preuve metier: benchmark ou pilote reel
- preuve economique: cout et correction humaine mesures

Sans ces 4 preuves, on a une feature IA demonstrable, mais pas une capacite produit industrialisee.
