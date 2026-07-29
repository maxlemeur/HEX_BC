# IAV2-E02 — Routage cout / confiance / complexite

> Priorite: P0 | Effort: L | Cible: faire un vrai moteur de decision IA

## Objectif

Passer d'un routage statique avec garde-fous simples a un routage qui respecte vraiment
un budget par dossier et un niveau de confiance attendu.

---

## IAV2-011 — Plafond budget global avant escalation

### User Story

> En tant qu'admin produit, je veux definir un plafond de cout reel par dossier,
> afin que l'escalade ne fasse jamais depasser le budget autorise.

### Criteres d'acceptation

- [ ] Le plafond est evalue sur le cout total projete du dossier, pas seulement sur le run primaire
- [ ] L'escalade peut etre refusee avec raison explicite `budget_blocked`
- [ ] Le detail de calcul est persiste dans `provider_meta` ou table dediee
- [ ] Les seuils sont configurables par tenant et surchargeables par environnement
- [ ] Tests couvrent:
  - budget respecte
  - budget depasse
  - dossier deja cher avant escalation

### Edge cases

- chunking multi-pages ou le cout explose au milieu du dossier
- Flash peu cher en entree mais Pro tres couteux en rerun complet

---

## IAV2-012 — Classifier le document et router avant inference

### User Story

> En tant que systeme, je veux identifier si le document ressemble a un tableur structure,
> un PDF tabulaire ou un plan complexe, afin de choisir le bon niveau et le bon modele avant traitement lourd.

### Criteres d'acceptation

- [ ] Classifieur leger `structured / tabular_pdf / complex_plan / unsupported`
- [ ] Recommandation de niveau exposee dans l'UI
- [ ] Possibilite d'override utilisateur tracee
- [ ] En cas d'incoherence forte entre choix utilisateur et document, warning explicite
- [ ] Tests couvrent les cas courants de chiffreur BTP

### Edge cases

- PDF contenant a la fois tableau et plan
- export scanner avec texte pauvre
- fichier mal nomme ou MIME trompeur

---

## IAV2-013 — Politique de confiance par niveau et type de sortie

### User Story

> En tant que chiffreur, je veux que l'application sache quand demander une relecture ou une escalation,
> afin d'eviter les faux positifs metier.

### Criteres d'acceptation

- [ ] Seuils distincts par niveau `A/B/C`
- [ ] Seuils distincts pour:
  - confidence globale
  - confidence item
  - absence de table
  - warnings bloquants
- [ ] L'UI explique pourquoi un job a ete escalade ou non
- [ ] Les corrections humaines sont capturees pour recalibrage futur

### Edge cases

- `confidence = null`
- sortie valide structurellement mais pauvre metierement
- lot entier extrait avec confidence moyenne mais items critiques faibles
