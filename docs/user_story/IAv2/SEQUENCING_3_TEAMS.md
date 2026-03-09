# IAv2 — Sequencing 3 equipes

## Themes

### Theme A — Batch durable & reprise

- EST-421
- EST-424
- EST-427

### Theme B — Routage cout / confiance / robustesse input

- EST-422
- EST-425
- EST-428

### Theme C — Instrumentation metier & UX operateur

- EST-423
- EST-426
- EST-429

---

## Ce qui peut partir en meme temps

### Vague 9.1

- Equipe A: EST-421
- Equipe B: EST-422
- Equipe C: EST-423

Ces 3 tickets sont independants et peuvent partir ensemble.

### Vague 9.2

- Equipe A: EST-424
- Equipe B: EST-425
- Equipe C: EST-426

Peut partir en parallele apres la Vague 9.1, avec les dependances ci-dessous.

### Vague 9.3

- Equipe A: EST-427
- Equipe B: EST-428
- Equipe C: EST-429

Peut partir en parallele apres la Vague 9.2.

---

## Dependances

| Ticket | Dependances |
|---|---|
| EST-421 | aucune |
| EST-422 | aucune |
| EST-423 | aucune |
| EST-424 | EST-421 |
| EST-425 | EST-422 |
| EST-426 | EST-421, EST-423 |
| EST-427 | EST-424, EST-426 |
| EST-428 | EST-425 |
| EST-429 | EST-423, EST-426 |

---

## Lecture simple par equipe

### Equipe A

- Commence par la persistance batch
- Enchaine sur le worker de reconciliation
- Termine sur les actions de reprise operateur

### Equipe B

- Commence par le moteur budget/escalade
- Enchaine sur le classifieur document/niveau
- Termine sur la robustesse PDF terrain

### Equipe C

- Commence par l'instrumentation des corrections humaines
- Enchaine sur le monitoring hub et les statuts lisibles
- Termine sur le tableau de bord pilote et les criteres go/no-go

---

## Contraintes de coordination

- EST-421 doit stabiliser le contrat de persistence batch avant EST-424 et EST-426.
- EST-422 doit stabiliser les raisons de routage et de blocage budget avant EST-425.
- EST-423 doit definir les evenements de correction avant EST-426 et EST-429.
- EST-426 doit definir le contrat d'etats jobs visible dans le hub avant EST-427 et EST-429.

---

## Resultat attendu a la fin de cette sequence

- le Batch est exploitable sans bricolage
- le routage IA devient defendable en cout et confiance
- l'equipe produit peut piloter un vrai tenant pilote avec des KPI concrets

Le niveau C "pre-chiffrage exploitable" reste ensuite le lot suivant, une fois cette base stabilisee.
