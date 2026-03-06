# V3-E06 - Dashboard Direction & Risque

Track: Approbation / Direction  
Priorité: P1  
Statut: Proposé

## Objectif

Donner à la direction et à la conduite de travaux une vue portefeuille des affaires à risque, afin d'éviter que la validation repose uniquement sur la lecture de PDF ou de messages dispersés.

---

## V3-021 - Dashboard portefeuille marge / risque / complétude

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que direction, je veux un tableau de bord de portefeuille qui me montre les affaires à enjeu, afin de prioriser mes arbitrages et éviter les départs risqués.

### Critères d'acceptation

- [ ] Un dashboard affiche les affaires actives avec :
  - montant
  - marge prévisionnelle
  - score de risque
  - couverture DPGF
  - nombre d'hypothèses ouvertes
  - statut d'approbation
- [ ] Des filtres existent par :
  - agence / tenant / équipe
  - chiffreur
  - lot
  - horizon d'envoi
- [ ] Les cartes utilisent un code couleur cohérent
- [ ] Un clic ouvre directement le cockpit affaire
- [ ] Les indicateurs sont calculés à la dernière version active ou en revue
- [ ] Un mode `Exceptions seulement` existe pour les profils direction

### Pourquoi cette story

- **Marie** n'utilise pas ce dashboard directement mais profite d'une meilleure priorisation de son travail.
- **Laurent** obtient plus vite des arbitrages sur ses affaires critiques.
- **Nadia** pilote son portefeuille sans feuille Excel parallèle.

---

## V3-022 - File priorisée "à envoyer cette semaine"

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que responsable, je veux voir quelles affaires sont proches de l'envoi mais encore fragiles, afin d'agir avant qu'un risque ne parte chez le client.

### Critères d'acceptation

- [ ] Une vue dédiée agrège les affaires dont la date cible est proche
- [ ] La file met en avant :
  - affaires envoyables
  - affaires prêtes mais non validées
  - affaires bloquées
  - affaires à risque élevé
- [ ] La logique de priorité combine :
  - date
  - score de risque
  - valeur
  - statut de revue
- [ ] Un bouton `Assigner` permet de renvoyer une affaire à un chiffreur précis
- [ ] Une affaire peut être marquée `revue terminée` sans changer son statut d'envoi

### Pourquoi cette story

- **Marie** sait plus vite sur quoi se concentrer.
- **Laurent** reçoit des arbitrages ciblés.
- **Nadia** pilote le flux réel d'envoi.

---

## V3-023 - Alertes synthétiques d'affaire à risque

**Priorité:** P2  
**Effort:** S  
**Couches:** `[Back] [Front]`

### User Story

> En tant que validatrice, je veux des alertes synthétiques lorsque certaines conditions se cumulent, afin de repérer les affaires qui semblent correctes en surface mais fragiles en profondeur.

### Critères d'acceptation

- [ ] Des alertes synthétiques existent pour des combinaisons de signaux :
  - faible marge + écarts élevés
  - montant élevé + preuves manquantes
  - remise forte + validation non faite
  - dossier incomplet + échéance proche
- [ ] Les alertes sont visibles :
  - dans le dashboard
  - dans le hub affaire
  - dans la file d'approbation
- [ ] Chaque alerte affiche les raisons qui la composent
- [ ] Les alertes peuvent être marquées :
  - `assumée`
  - `à traiter`
  - `fausse alerte`
- [ ] Le statut d'alerte est historisé

### Pourquoi cette story

- **Marie** évite d'envoyer un dossier fragile sans le voir.
- **Laurent** comprend les signaux qui inquiètent sa direction.
- **Nadia** gagne une couche de supervision à très forte valeur.
