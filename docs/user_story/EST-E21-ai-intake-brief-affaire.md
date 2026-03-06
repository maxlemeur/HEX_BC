# EST-E21 - Intake IA & Brief Affaire

Milestone: M7  
Priorité: P0  
Statut: Proposé

## Objectif

Transformer l'ouverture d'une affaire en flux unique : dossier entrant -> classement -> résumé -> questions ouvertes -> plan d'action.  
Cette epic doit faire disparaître la page blanche et la perte de temps liée au tri manuel des pièces.

## Dépendances

- V3 affaire-centrique
- import unifié déjà en place
- stockage affaire / plans / documents

---

## EST-371 - Ingestion dossier multi-documents et classement IA

**Priorité:** P0  
**Effort:** L  
**Couches:** `[Back] [AI] [Front] [Storage]`

### User Story

> En tant que chiffreur, je veux déposer un dossier brut composé de DPGF, plans, CCTP, BPU, emails et pièces annexes, afin que le système classe les documents et prépare l'affaire automatiquement.

### Critères d'acceptation

- [ ] L'utilisateur peut déposer plusieurs fichiers en une fois
- [ ] Le système classe les documents dans des catégories métier :
  - DPGF
  - plans
  - CCTP
  - BPU / DQE
  - annexes
  - emails / courriers
- [ ] Le système extrait les métadonnées de base :
  - nom affaire
  - client / MOA si identifiable
  - date limite
  - lots détectés
  - variantes mentionnées
- [ ] Chaque classement affiche un score de confiance
- [ ] L'utilisateur peut corriger le classement avant validation finale
- [ ] Les documents non reconnus sont conservés dans `Pièces à classer`
- [ ] Les erreurs ou ambiguïtés sont visibles sans bloquer tout le flux
- [ ] Le classement final alimente le cockpit affaire sans re-saisie manuelle

### Pourquoi cette story

- **Marie** gagne un démarrage guidé et rassurant.
- **Laurent** économise un vrai temps d'ouverture de dossier.
- **Nadia** voit immédiatement si l'affaire est documentée correctement.

---

## EST-372 - Brief affaire généré automatiquement

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Back] [AI] [Front]`

### User Story

> En tant que chiffreur ou validatrice, je veux obtenir un brief affaire structuré après ingestion, afin de partager une compréhension commune du périmètre avant le chiffrage.

### Critères d'acceptation

- [ ] Le brief affiche :
  - objet du projet
  - périmètre détecté
  - lots concernés
  - pièces reçues
  - hypothèses initiales
  - points de vigilance
  - éléments manquants
- [ ] Le brief est éditable humainement
- [ ] Chaque bloc du brief peut renvoyer à sa source documentaire
- [ ] Le brief possède un statut :
  - `à confirmer`
  - `confirmé`
- [ ] Tant que le brief n'est pas confirmé, certaines suggestions IA critiques sont marquées comme provisoires
- [ ] Le brief est visible dans le hub affaire

### Pourquoi cette story

- **Marie** n'attaque pas un devis sans boussole.
- **Laurent** peut cadrer son équipe très vite.
- **Nadia** valide plus facilement l'interprétation de l'affaire.

---

## EST-373 - Registre d'hypothèses et pièces manquantes

**Priorité:** P0  
**Effort:** M  
**Couches:** `[DB] [Back] [Front]`

### User Story

> En tant qu'équipe chiffrage, je veux un registre des hypothèses et des pièces manquantes lié à l'affaire, afin de ne pas masquer les zones grises sous un faux sentiment de précision.

### Critères d'acceptation

- [ ] Une hypothèse peut être créée par l'IA ou manuellement
- [ ] Chaque hypothèse contient :
  - texte
  - source éventuelle
  - criticité
  - statut
  - auteur
- [ ] Les statuts existent :
  - `ouverte`
  - `validée`
  - `rejetée`
  - `à clarifier avec client`
- [ ] Les pièces manquantes détectées apparaissent dans la même vue
- [ ] Les hypothèses critiques non résolues remontent dans les gates d'envoi / validation
- [ ] Une hypothèse peut être liée à :
  - affaire
  - lot
  - ligne
  - exception

### Pourquoi cette story

- **Marie** ne cache pas l'incertitude par manque d'expérience.
- **Laurent** garde la maîtrise des arbitrages documentaires.
- **Nadia** voit immédiatement les zones qui méritent un coup d'oeil.

---

## EST-374 - Command bar contextuelle du cockpit affaire

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Front] [Back] [AI]`

### User Story

> En tant qu'utilisateur du cockpit affaire, je veux une barre de commande contextuelle qui propose les actions les plus utiles selon l'état du dossier, afin d'accéder vite aux bonnes fonctions sans chercher dans les menus.

### Critères d'acceptation

- [ ] Une command bar est accessible par raccourci clavier et bouton visible
- [ ] Les actions proposées dépendent du contexte :
  - analyser les plans
  - générer la structure du devis
  - voir les exceptions
  - lister les hypothèses ouvertes
  - préparer la validation
- [ ] Les actions sont formulées en langage métier
- [ ] Les actions à fort impact affichent un aperçu avant exécution
- [ ] Les actions lancées sont historisées
- [ ] Les suggestions peuvent être masquées ou épinglées par l'utilisateur

### Pourquoi cette story

- **Marie** n'a plus à chercher "dans quel écran ça se passe".
- **Laurent** gagne un vrai fast path.
- **Nadia** utilise quelques actions ciblées sans se former à tout le produit.
