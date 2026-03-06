# EST-E25 - Revision Engine & Boucle Client

Milestone: M8  
Priorité: P1  
Statut: Proposé

## Objectif

Absorber les V2 / V3 client, les objections et les retours terrain sans repartir de zéro.  
Cette epic transforme le versioning en moteur d'analyse de changement utile au business.

## Dépendances

- EST-E21 à EST-E24
- versioning existant
- portail client lite

---

## EST-411 - Lecture des retours client et détection des changements

**Priorité:** P1  
**Effort:** L  
**Couches:** `[AI] [Back] [Front]`

### User Story

> En tant que chiffreur, je veux que le système lise les mails, pièces modifiées ou commentaires client et me résume ce qui a changé, afin de préparer une V2 sans repartir d'un écran vide.

### Critères d'acceptation

- [ ] Le système peut ingérer :
  - email copié / transféré
  - nouveau DPGF
  - pièce jointe modifiée
  - commentaires portail
- [ ] Une synthèse de changement est produite avec :
  - éléments ajoutés
  - éléments supprimés
  - éléments ambigus
  - questions ouvertes
- [ ] Les changements sont reliés aux lots et lignes probables
- [ ] L'utilisateur peut confirmer ou corriger la synthèse avant génération de V2
- [ ] Les changements non mappés restent visibles comme tâches ouvertes

### Pourquoi cette story

- **Marie** n'est plus perdue dans un mail client flou.
- **Laurent** gagne un temps énorme en révision.
- **Nadia** voit rapidement l'ampleur réelle d'une demande de V2.

---

## EST-412 - Analyse d'impact quantités / prix / marge

**Priorité:** P1  
**Effort:** L  
**Couches:** `[Back] [Front] [AI]`

### User Story

> En tant que chiffreur ou validatrice, je veux savoir quelles lignes, quantités, preuves et marges sont impactées par une modification de version, afin de concentrer la révision sur le bon périmètre.

### Critères d'acceptation

- [ ] Une modification client produit une analyse d'impact :
  - lignes touchées
  - lots touchés
  - preuves invalidées
  - marge delta
  - montant delta
- [ ] L'impact est classé :
  - mineur
  - significatif
  - critique
- [ ] Une action `Créer V2 à partir de l'impact` existe
- [ ] Les zones non impactées peuvent être conservées via carry-over
- [ ] Le système distingue ce qui est sûr de ce qui est supposé

### Pourquoi cette story

- **Marie** sait où commencer.
- **Laurent** révise vite et bien.
- **Nadia** voit immédiatement si la V2 change vraiment le risque business.

---

## EST-413 - Réponse assistée et contre-proposition structurée

**Priorité:** P2  
**Effort:** M  
**Couches:** `[AI] [Back] [Front]`

### User Story

> En tant que chargé d'affaires ou chiffreur, je veux préparer une réponse argumentée à un retour client, afin de gagner du temps sans produire un texte déconnecté du devis réel.

### Critères d'acceptation

- [ ] Le système peut générer un brouillon de réponse basé sur :
  - changements demandés
  - impacts calculés
  - hypothèses
  - points acceptés / refusés
- [ ] Le brouillon reste éditable avant envoi
- [ ] Chaque paragraphe généré peut renvoyer à sa base factuelle
- [ ] Une option `proposer variante` existe si une solution alternative est pertinente
- [ ] Le texte généré n'est jamais envoyé automatiquement

### Pourquoi cette story

- **Marie** gagne un support de formulation.
- **Laurent** répond plus vite aux objections.
- **Nadia** obtient une note de position claire.

---

## EST-414 - Questions client -> tâches -> décisions

**Priorité:** P2  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant qu'équipe, je veux convertir un retour client en tâche, hypothèse ou demande de version, afin que la boucle commerciale reste traçable et exploitable.

### Critères d'acceptation

- [ ] Depuis un commentaire client, l'utilisateur peut créer :
  - une tâche
  - une hypothèse
  - une exception
  - une V2
- [ ] Le lien entre retour client et objet créé est conservé
- [ ] Les statuts de traitement sont visibles côté interne
- [ ] Une décision finale peut être attachée au retour :
  - accepté
  - refusé
  - intégré en V2
  - hors périmètre
- [ ] L'affaire garde une chronologie des échanges importants

### Pourquoi cette story

- **Marie** ne laisse pas un retour important se perdre.
- **Laurent** garde une boucle client propre.
- **Nadia** suit l'historique de décision sans fouille dans les emails.
