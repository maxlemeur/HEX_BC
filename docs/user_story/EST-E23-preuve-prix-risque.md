# EST-E23 - Preuve, Prix Expliqués & Risk Radar

Milestone: M7  
Priorité: P0  
Statut: Proposé

## Objectif

Rendre chaque ligne de devis explicable, traçable et pilotable.  
Cette epic crée le coeur du produit différenciant : non seulement suggérer, mais **prouver**, **expliquer** et **alerter**.

## Dépendances

- EST-E15 / E16 / E17
- V3 compare DPGF / mètres
- analytics et quality flags existants

---

## EST-391 - Evidence Graph par ligne

**Priorité:** P0  
**Effort:** L  
**Couches:** `[DB] [Back] [Front]`

### User Story

> En tant que chiffreur ou validatrice, je veux voir pour chaque ligne les preuves qui soutiennent sa quantité et son prix, afin de décider avec confiance et de justifier mes arbitrages.

### Critères d'acceptation

- [ ] Chaque ligne peut être liée à plusieurs preuves :
  - ligne DPGF
  - item takeoff
  - page de plan / zone
  - formule ou carnet de mètres
  - source de prix
  - commentaire humain
- [ ] Un panneau `Preuves` existe dans l'éditeur et dans la review
- [ ] Les preuves affichent :
  - type
  - source
  - date
  - auteur si humain
  - niveau de confiance si IA
- [ ] Une ligne sans preuve peut être filtrée
- [ ] Une preuve peut être invalidée ou remplacée sans perdre l'historique
- [ ] Les preuves principales remontent dans l'export PDF pro ou en annexe si besoin

### Pourquoi cette story

- **Marie** apprend par les preuves au lieu de travailler à l'aveugle.
- **Laurent** retrouve enfin un devis "auditable".
- **Nadia** arbitre plus vite sans demander un aller-retour oral.

---

## EST-392 - Suggestion de prix avec fourchette et sources

**Priorité:** P0  
**Effort:** L  
**Couches:** `[AI] [Back] [Front]`

### User Story

> En tant que chiffreur, je veux obtenir une suggestion de prix sous forme de fourchette expliquée par des sources, afin d'éviter les prix arbitraires et de mieux sécuriser ma marge.

### Critères d'acceptation

- [ ] Le système propose un prix recommandé sous forme de :
  - borne basse
  - borne centrale
  - borne haute
- [ ] Les sources prises en compte sont affichées :
  - historique interne
  - pricebook fournisseur
  - ouvrage proche
  - référentiel externe si disponible
- [ ] Les facteurs d'ajustement visibles peuvent inclure :
  - zone
  - lot
  - complexité
  - quantité
  - date / fraîcheur
- [ ] L'utilisateur peut choisir :
  - appliquer la borne centrale
  - appliquer une autre borne
  - garder son prix
- [ ] Une justification textuelle concise accompagne la suggestion
- [ ] Les prix extrêmes sont signalés comme outliers

### Pourquoi cette story

- **Marie** obtient un garde-fou.
- **Laurent** gagne en vitesse sans renoncer au jugement.
- **Nadia** comprend pourquoi la marge ou le PV proposé change.

---

## EST-393 - Radar d'incohérences et marge à risque

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Back] [Front] [AI]`

### User Story

> En tant que validatrice ou chiffreur senior, je veux que le système m'indique les zones du devis à risque, afin de concentrer mes efforts de contrôle là où l'erreur coûte cher.

### Critères d'acceptation

- [ ] Un score de risque existe au niveau :
  - affaire
  - lot
  - ligne
- [ ] Les causes du risque sont explicites :
  - preuve absente
  - écart DPGF / mètre
  - prix atypique
  - marge insuffisante
  - TVA incohérente
  - pièce manquante
- [ ] Les risques sont classés :
  - info
  - attention
  - critique
- [ ] Une vue `À traiter` regroupe les signaux les plus prioritaires
- [ ] Une action de revue peut faire passer un risque en `assumé`
- [ ] Le score est recalculé quand une donnée structurante change

### Pourquoi cette story

- **Marie** ne passe pas à côté d'un oubli important.
- **Laurent** va droit aux zones qui méritent son expertise.
- **Nadia** valide vite par exception.

---

## EST-394 - Explication des prix et des deltas de version

**Priorité:** P1  
**Effort:** M  
**Couches:** `[AI] [Back] [Front]`

### User Story

> En tant qu'utilisateur métier, je veux comprendre pourquoi une ligne coûte ce qu'elle coûte et pourquoi une V2 change la marge ou le montant, afin d'expliquer mes décisions à la direction ou au client.

### Critères d'acceptation

- [ ] Une action `Expliquer ce prix` existe sur chaque ligne
- [ ] Une action `Expliquer le delta` existe entre versions
- [ ] L'explication synthétise :
  - origine du prix
  - hypothèses retenues
  - changements depuis la version précédente
  - impact sur marge et montant
- [ ] L'explication mentionne les éléments certains et les éléments inférés
- [ ] Le texte généré n'écrit jamais dans le devis
- [ ] Une version courte et une version détaillée existent

### Pourquoi cette story

- **Marie** comprend mieux ce qu'elle a sous les yeux.
- **Laurent** gagne du temps en préparation de revue.
- **Nadia** obtient la note de synthèse qui lui manque souvent.
