# EST-E24 - Collaboration & Revue par Exception

Milestone: M7  
Priorité: P1  
Statut: Proposé

## Objectif

Exploiter le caractère SaaS du produit pour faire travailler plusieurs rôles sur la même affaire sans chaos.  
Cette epic évite le ping-pong mail + téléphone + PDF annoté.

## Dépendances

- V3-E04 à V3-E06
- état de draft lock / concurrence déjà existant
- events et audit existants

---

## EST-401 - Présence, lecture partagée et commentaires temps réel

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Front] [Back] [Realtime]`

### User Story

> En tant qu'équipe chiffrage, je veux voir qui travaille sur l'affaire et commenter un lot, une ligne ou une exception en temps réel, afin de réduire les allers-retours hors outil.

### Critères d'acceptation

- [ ] La présence des utilisateurs connectés sur l'affaire est visible
- [ ] Un commentaire peut être créé sur :
  - affaire
  - lot
  - ligne
  - preuve
  - exception
- [ ] Les commentaires sont temps réel ou quasi temps réel
- [ ] Un commentaire peut mentionner un membre de l'équipe
- [ ] Les commentaires ont des statuts :
  - ouvert
  - résolu
  - re-ouvert
- [ ] Une vue `Mes mentions` existe

### Pourquoi cette story

- **Marie** peut demander de l'aide sans quitter le produit.
- **Laurent** arbitre en contexte.
- **Nadia** centralise les retours de validation.

---

## EST-402 - File de revue par exception assignable

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que responsable, je veux assigner les exceptions à la bonne personne, afin que chaque anomalie ait un propriétaire clair.

### Critères d'acceptation

- [ ] Toute exception peut être assignée à un membre
- [ ] Un propriétaire et une échéance facultative peuvent être définis
- [ ] Les vues `Mes exceptions` et `Exceptions de l'équipe` existent
- [ ] Un changement de statut est historisé
- [ ] Une exception résolue peut nécessiter une validation finale avant clôture
- [ ] Les exceptions non assignées sont visibles dans une file dédiée

### Pourquoi cette story

- **Marie** sait ce qu'elle doit reprendre.
- **Laurent** distribue le travail clairement.
- **Nadia** évite les zones orphelines.

---

## EST-403 - Revue multi-rôle et checklists par profil

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story

> En tant que produit, je veux adapter la checklist de revue selon le rôle, afin que chacun traite les bons points de contrôle sans bruit inutile.

### Critères d'acceptation

- [ ] Une checklist différente peut être affichée pour :
  - chiffreur junior
  - chiffreur senior
  - conductrice / direction
- [ ] Les points de contrôle peuvent viser :
  - complétude
  - prix
  - preuves
  - risque
  - conformité
- [ ] Un point peut être marqué :
  - conforme
  - à revoir
  - non applicable
- [ ] Le pourcentage de revue est visible dans l'affaire
- [ ] Les points non conformes alimentent la file d'exceptions

### Pourquoi cette story

- **Marie** reçoit un cadre clair.
- **Laurent** travaille avec une checklist experte.
- **Nadia** n'est pas noyée par des points de détail inutiles.

---

## EST-404 - Journal des corrections et apprentissage de l'équipe

**Priorité:** P1  
**Effort:** M  
**Couches:** `[DB] [Back] [AI]`

### User Story

> En tant qu'organisation, je veux conserver les corrections et décisions de revue pour améliorer le produit et capitaliser le savoir-faire de l'équipe.

### Critères d'acceptation

- [ ] Toute correction significative peut être catégorisée :
  - erreur IA
  - erreur source
  - hypothèse métier
  - arbitrage commercial
- [ ] Les corrections avec raison peuvent alimenter un dataset interne d'amélioration
- [ ] Un écran de synthèse montre les corrections fréquentes
- [ ] L'usage analytique respecte le cloisonnement tenant
- [ ] Une correction peut être exclue du dataset si sensible

### Pourquoi cette story

- **Marie** profite d'un outil qui apprend des erreurs passées.
- **Laurent** capitalise enfin son savoir-faire.
- **Nadia** voit les récurrences qui fragilisent l'équipe.
