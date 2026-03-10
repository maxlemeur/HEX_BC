# V3-E07 - Portail Client Lite & Boucle Questions

Track: Approbation / Direction  
Priorité: P1  
Statut: Proposé

## Objectif

Fermer la boucle entre l'affaire interne et l'échange client sans construire tout de suite un portail monolithique.  
Cette epic vise un portail léger, traçable, orienté questions, partage de version et retours.

---

## V3-024 - Publication sécurisée d'une version client

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que chiffreur ou direction, je veux publier une version validée sur un lien sécurisé, afin de partager proprement une version sans échanges de pièces jointes dispersées.

### Critères d'acceptation

- Une version validée peut être publiée via un lien sécurisé
- Le partage peut être limité par :
  - durée
  - mot de passe
  - accès nominatif si email connu
- Le portail affiche :
  - version
  - date
  - PDF
  - résumé
  - messages éventuels
- Le lien peut être révoqué
- Toute ouverture du lien est tracée
- Une nouvelle version publiée n'écrase pas l'historique des précédentes

### Pourquoi cette story

- **Marie** arrête les envois artisanaux.
- **Laurent** garde une version propre et traçable.
- **Nadia** sait exactement ce que le client a vu.

---

## V3-025 - Questions client contextualisées

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que client ou chargé d'affaires, je veux poser une question sur une version partagée et la rattacher à un lot ou un poste, afin d'éviter les échanges flous par email.

### Critères d'acceptation

- Depuis le portail, une question peut être créée :
  - au niveau version
  - au niveau lot
  - au niveau ligne
- La question arrive côté interne comme une tâche ou un point à traiter
- Les statuts existent :
  - `nouveau`
  - `en cours`
  - `répondu`
  - `clos`
- La réponse interne peut être rédigée et publiée au client depuis le même thread
- Chaque question reste rattachée à la version concernée
- Une question client peut être convertie en hypothèse, correction ou demande de V2

### Pourquoi cette story

- **Marie** reçoit un retour contextualisé.
- **Laurent** ne perd pas le fil des objections.
- **Nadia** suit les échanges sans forward de mails.

---

## V3-026 - Acceptation simple ou demande de nouvelle version

**Priorité:** P2  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que client ou chargé d'affaires, je veux pouvoir accepter une version, demander une modification ou signaler un désaccord majeur, afin de faire avancer le cycle commercial plus proprement.

### Critères d'acceptation

- Le portail permet au client de choisir :
  - `J'accepte cette version`
  - `Je demande une modification`
  - `Je souhaite échanger`
- Une acceptation génère un event daté côté affaire
- Une demande de modification ouvre automatiquement un cycle interne :
  - tâche
  - commentaire
  - invitation à créer V2
- L'acceptation ne contourne pas les règles internes déjà requises
- L'état de publication côté interne reflète la réponse client

### Pourquoi cette story

- **Marie** voit plus vite où en est son affaire.
- **Laurent** déclenche une V2 sur une demande propre.
- **Nadia** suit le passage revue interne -> retour client -> décision.

