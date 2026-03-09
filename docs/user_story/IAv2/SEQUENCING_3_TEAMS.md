# IAv2 — Sequencing 3 equipes

## Themes

### Theme A — Batch durable & reprise

- EST-424
- EST-427

### Theme B — Routage cout / confiance / robustesse input

- EST-425
- EST-428

### Theme C — Instrumentation metier & UX operateur

- EST-426
- EST-429

Les fondations transverses `EST-421`, `EST-422` et `EST-423` sont deja presentes sur `main`.
Le sequencing ci-dessous couvre donc le travail restant a lancer a partir de cet etat de branche.

---

## Ce qui peut partir en meme temps

### Vague 9.2

- Equipe A: EST-424
- Equipe B: EST-425
- Equipe C: EST-426

Premiere vague restante a lancer sur `main`.
Ces 3 tickets peuvent partir ensemble, avec les fondations deja en place et les dependances ci-dessous.

### Vague 9.3

- Equipe A: EST-427
- Equipe B: EST-428
- Equipe C: EST-429

Peut partir en parallele apres la Vague 9.2.

---

## Dependances

| Ticket | Dependances |
|---|---|
| EST-424 | EST-421 |
| EST-425 | EST-422 |
| EST-426 | EST-421, EST-423 |
| EST-427 | EST-424, EST-426 |
| EST-428 | EST-425 |
| EST-429 | EST-423, EST-426 |

---

## Lecture simple par equipe

### Equipe A

- S'appuie sur la persistance batch deja en place
- Commence par le worker de reconciliation
- Termine sur les actions de reprise operateur

### Equipe B

- S'appuie sur le moteur budget/escalade deja en place
- Commence par le classifieur document/niveau
- Termine sur la robustesse PDF terrain

### Equipe C

- S'appuie sur l'instrumentation des corrections humaines deja en place
- Commence par le monitoring hub et les statuts lisibles
- Termine sur le tableau de bord pilote et les criteres go/no-go

---

## Contraintes de coordination

- EST-421 constitue deja le contrat de persistence batch sur lequel s'appuient EST-424 et EST-426.
- EST-422 constitue deja le contrat budget/escalade sur lequel s'appuie EST-425.
- EST-423 constitue deja le contrat d'evenements de correction sur lequel s'appuient EST-426 et EST-429.
- EST-426 doit definir le contrat d'etats jobs visible dans le hub avant EST-427 et EST-429.

---

## Resultat attendu a la fin de cette sequence

- le Batch est exploitable sans bricolage
- le routage IA devient defendable en cout et confiance
- l'equipe produit peut piloter un vrai tenant pilote avec des KPI concrets

Le niveau C "pre-chiffrage exploitable" reste ensuite le lot suivant, une fois cette base stabilisee.
