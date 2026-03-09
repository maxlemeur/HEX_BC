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

### Finding 1 — High

Le mode Batch actuel n'est pas encore un vrai mode batch production.

Pourquoi:
- le code cree un batch Gemini puis le poll dans le meme appel applicatif
- ce poll est borne par le `timeoutMs` courant du processor
- il n'y a pas de persistence du `batchJobName` ni d'etat batch en base

Impact:
- risque de faux `timeout`
- aucune reprise propre apres redemarrage worker
- pas de reconciliation differree
- impossible d'exploiter vraiment la promesse cout/async du Batch API

Code:
- `src/lib/takeoff/gemini-client.ts`
- `src/lib/takeoff/processor.ts`

Conclusion:
- le Batch a ete bien introduit techniquement comme transport,
- mais pas encore comme architecture asynchrone durable.

### Finding 2 — High

Le plafond de cout d'escalade n'est pas un vrai plafond global.

Pourquoi:
- l'escalade regarde le cout deja consomme par le run primaire
- elle ne projette pas le cout total probable apres re-run sur modele premium

Impact:
- un dossier peut depasser le budget defini tout en respectant formellement la condition actuelle
- la promesse "budget-aware" reste partielle

Code:
- `src/lib/takeoff/processor.ts`

Conclusion:
- il faut un vrai moteur de budget `before-run`, pas un simple garde-fou `after primary run`.

### Finding 3 — Medium

Le niveau B continue meme si le nombre de pages PDF ne peut pas etre lu.

Pourquoi:
- l'erreur de lecture page count est loggee en warning
- le traitement degrade ensuite vers un chunk unique minimal

Impact:
- sous-analyse possible sur PDF mal forme
- comportement difficile a expliquer au chiffreur
- risque de faux sentiment de succes

Code:
- `src/lib/takeoff/processor.ts`

Conclusion:
- sur les documents critiques, il vaut mieux un echec explicite qu'un succes degrade silencieux.

### Finding 4 — Medium

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

---

## Edge Cases a traiter en IAv2

| Sujet | Risque actuel | Reponse attendue en V2 |
|---|---|---|
| Batch Gemini long | timeout local avant fin reelle du batch | batch durable avec polling/reconciliation decouples |
| Budget escalation | plafond non cumulatif | projection cout total avant escalation |
| PDF mal forme | succes degrade silencieux possible | echec explicite ou parcours de remediation |
| MIME vide / scanner | upload rejete alors que le fichier est valide | fallback par extension + verification serveur |
| Dossier multi-plans | mono-fichier `B/C` peu pratique | lancement plan set natif et merge traceable |
| Jobs bloques | pas de batch state persiste | ecran de reprise, relance, abandon, reconciliation |
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
