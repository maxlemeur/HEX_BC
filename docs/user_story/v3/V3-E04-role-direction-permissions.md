# V3-E04 - Rôle Direction & Permissions

Track: Approbation / Direction  
Priorité: P0  
Statut: Proposé

## Objectif

Rendre le workflow d'approbation réellement exploitable par la direction et la conduite de travaux, sans transformer ces profils en opérateurs de l'éditeur.  
Cette epic met en place un modèle de décision centré sur la revue, le retour correction et l'approbation par exception.

## Personas concernés

- **Marie** : doit pouvoir préparer une version sans gérer la mécanique des seuils
- **Laurent** : doit savoir quand une version est publiable et qui doit valider
- **Nadia** : doit pouvoir valider ou renvoyer une affaire sans entrer dans la table complète

---

## V3-015 - Rôle `director` et seuils d'approbation affaire

**Priorité:** P0  
**Effort:** M  
**Couches:** `[DB] [Back] [Front]`

### User Story

> En tant que direction ou conductrice de travaux, je veux que le système sache quelles versions doivent passer par moi selon des seuils clairs, afin de concentrer mon temps sur les affaires réellement sensibles.

### Critères d'acceptation

- [ ] Un rôle `director` existe côté permissioning avec accès :
  - lecture complète des affaires concernées
  - validation / retour correction
  - commentaire et assignation
  - pas d'obligation d'édition détaillée
- [ ] Les règles d'approbation peuvent se baser sur :
  - montant HT
  - marge %
  - remise %
  - présence d'exceptions critiques
  - absence de preuve sur lignes à enjeu
  - taux de couverture DPGF
- [ ] Les seuils sont configurables par tenant
- [ ] Une version sait afficher son statut :
  - `Pas d'approbation requise`
  - `Approbation requise`
  - `En revue`
  - `Approuvée`
  - `Retour correction`
- [ ] La raison du déclenchement est lisible en langage métier
- [ ] Les règles déclenchées sont historisées pour audit
- [ ] Les règles peuvent être simulées avant soumission à validation

### Pourquoi cette story

- **Marie** n'a pas à deviner si son devis est "suffisamment bon".
- **Laurent** gagne une règle claire au lieu d'un arbitrage oral.
- **Nadia** voit tout de suite pourquoi elle est sollicitée.

### QA / comptes de test

- Les identifiants de test utiles pour ce parcours, y compris le compte `director`, sont centralisés dans [docs/test-logins.md](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/test-logins.md).

---

## V3-016 - Permissions "valider sans éditer" et "retour correction"

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que validatrice, je veux pouvoir approuver, refuser ou renvoyer une version avec commentaires sans devoir modifier moi-même les lignes du devis, afin de garder un workflow clair entre production et validation.

### Critères d'acceptation

- [ ] Depuis l'affaire ou la version, le profil validateur peut :
  - approuver
  - approuver sous réserve
  - renvoyer en correction
- [ ] Le validateur peut commenter :
  - l'affaire globale
  - un lot
  - une ligne
  - une exception
- [ ] Les commentaires peuvent être obligatoires sur les refus ou retours correction
- [ ] Le validateur n'a pas besoin d'accéder à tous les contrôles d'édition pour réaliser sa tâche
- [ ] Le producteur voit clairement les éléments à corriger
- [ ] Une resoumission garde l'historique précédent et ajoute un nouveau cycle de revue
- [ ] La permission d'édition fine peut rester limitée aux chiffreurs

### Pourquoi cette story

- **Marie** reçoit un retour exploitable, pas un simple "à revoir".
- **Laurent** garde la responsabilité de correction là où elle doit être.
- **Nadia** peut agir vite sans se transformer en opératrice de tableur.

---

## V3-017 - Journal de décision d'approbation

**Priorité:** P1  
**Effort:** S  
**Couches:** `[DB] [Back] [Front]`

### User Story

> En tant qu'équipe chiffrage, je veux conserver un journal clair des décisions d'approbation, afin de comprendre qui a validé quoi, quand et pour quelle raison.

### Critères d'acceptation

- [ ] Chaque décision crée un event d'approbation horodaté
- [ ] L'event contient :
  - type de décision
  - auteur
  - périmètre concerné
  - commentaire éventuel
  - règles déclenchées au moment de la décision
- [ ] L'historique est visible depuis :
  - le hub affaire
  - la version concernée
  - la file d'approbation
- [ ] Les events sont filtrables par auteur et statut
- [ ] Un export de l'historique de décision est possible pour audit interne

### Pourquoi cette story

- **Marie** comprend pourquoi une version a été renvoyée.
- **Laurent** peut arbitrer des divergences sans fouille archéologique.
- **Nadia** bénéficie d'une traçabilité utile en cas de litige ou d'escalade.
