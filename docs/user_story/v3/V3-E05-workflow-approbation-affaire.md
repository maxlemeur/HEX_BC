# V3-E05 - Workflow Approbation Affaire

Track: Approbation / Direction  
Priorité: P0  
Statut: Implémenté

## Objectif

Créer un parcours complet de soumission, revue par exception, retour correction et resoumission, centré sur l'affaire et non sur des écrans administratifs dispersés.

## Dépendances

- V3-E04 - Rôle Direction & Permissions
- rules engine et infrastructure d'approbation déjà présents
- comptes de test centralisés dans [docs/test-logins.md](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/test-logins.md)

---

## V3-018 - Soumettre une version à validation depuis le hub affaire

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que chiffreur, je veux soumettre ma version à validation depuis le hub affaire avec un résumé clair des risques restants, afin de savoir ce que j'envoie à la direction.

### Critères d'acceptation

- [x] Un CTA `Soumettre à validation` existe depuis le hub et la vue version
- [x] Avant soumission, un panneau de synthèse affiche :
  - couverture
  - exceptions
  - hypothèses ouvertes
  - marge
  - règles déclenchées
- [x] Les blocages durs empêchent la soumission
- [x] Les alertes non bloquantes restent visibles mais ne bloquent pas
- [x] L'utilisateur peut ajouter un message de contexte à la validatrice
- [x] Une fois soumis, le statut passe à `En revue`
- [x] Une notification in-app et email interne peut être envoyée au validateur assigné

### Pourquoi cette story

- **Marie** voit ce qui manque avant d'appuyer sur le bouton.
- **Laurent** structure mieux sa relation avec la validation.
- **Nadia** reçoit un dossier déjà synthétisé.

---

## V3-019 - File de revue par exception

**Priorité:** P0  
**Effort:** L  
**Couches:** `[Back] [Front]`

### User Story

> En tant que validatrice, je veux une file de revue triée par exceptions et par risque, afin de traiter d'abord les affaires qui méritent vraiment mon attention.

### Critères d'acceptation

- [ ] Une page `Approbations` liste les affaires à revoir
- [ ] Chaque carte affiche :
  - affaire
  - version
  - montant
  - marge
  - score de risque
  - nombre d'exceptions
  - âge de la demande
- [ ] Les exceptions sont regroupées par catégories :
  - prix
  - quantités
  - TVA / conformité
  - preuves manquantes
  - documents manquants
- [ ] La file est triable par priorité, montant, marge ou ancienneté
- [ ] Un clic ouvre directement la vue `Validation` de l'affaire
- [ ] Les exceptions déjà commentées ou levées changent d'état visuel
- [ ] Le validateur peut marquer :
  - vu
  - à revoir par Laurent
  - bloquant
  - acceptable

### Pourquoi cette story

- **Marie** bénéficie d'un feedback plus structuré.
- **Laurent** comprend l'ordre de traitement attendu.
- **Nadia** ne perd plus du temps à chercher où se cache le vrai problème.

---

## V3-020 - Retour correction et resoumission guidée

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que chiffreur, je veux qu'un retour correction me revienne comme une to-do list claire, afin de corriger vite sans relire tout le devis.

### Critères d'acceptation

- [ ] Quand une validation est refusée ou renvoyée, la version affiche une checklist de correction
- [ ] Chaque item de correction pointe vers :
  - un lot
  - une ligne
  - une exception
  - une hypothèse
- [ ] Les items peuvent être marqués `corrigé` ou `à discuter`
- [ ] Une fois tous les items traités, le CTA `Resoumettre` devient disponible
- [ ] Le validateur voit ce qui a changé depuis le dernier cycle
- [ ] La resoumission crée une nouvelle entrée d'historique sans perdre les commentaires précédents

### Pourquoi cette story

- **Marie** a besoin d'un parcours de correction guidé.
- **Laurent** gagne du temps entre revue et rework.
- **Nadia** peut vérifier rapidement si le retour a été réellement traité.
