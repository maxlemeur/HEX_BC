# V3 - Addendum Takeoff / Mètres / Plans

Version: 2026-03-06

## Objectif

Ce document met à jour les stories V3 existantes qui doivent évoluer pour coller à une expérience plus moderne, plus explicable et plus simple à adopter.

Il ne remplace pas les stories V3-001 à V3-014.  
Il **amende** les stories existantes suivantes :

- V3-005
- V3-007
- V3-009
- V3-010
- V3-012
- V3-013
- V3-014

## Changement de philosophie UX

### Avant
- module takeoff visible surtout comme un outil spécialisé
- revue séparée du contexte affaire
- logique Junior / Senior
- auto-trigger pensé comme une commodité

### Après
- le mètre est une **preuve métier** dans le cockpit affaire
- la review devient une **revue par exception**
- la logique devient **Assisté / Production / Validation**
- l'IA **propose** et **explique**, elle ne décide pas à la place du chiffreur

---

## V3-005 - Plans & Mètres Card -> "Plans, preuves & exceptions"

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story mise à jour

> En tant qu'utilisateur de l'affaire, je veux voir dans le hub un résumé immédiatement exploitable des plans, des mètres, de leur couverture et des écarts majeurs, afin de savoir en quelques secondes si l'affaire est prête à être revue ou si elle nécessite une action.

### Critères d'acceptation mis à jour

- [ ] La card affiche toujours `planSetCount`, `planFileCount`, `latestJob`, mais ajoute :
  - `coveragePercent` = pourcentage de lignes DPGF couvertes par au moins un item de mètre ou une preuve liée
  - `exceptionCount` = nombre d'écarts significatifs ou items non liés
  - `openQuestionsCount` = nombre d'hypothèses / ambiguïtés non résolues
- [ ] Un résumé en langage métier est visible en haut :
  - exemple : "72 % des postes couverts - 5 écarts majeurs - 2 questions ouvertes"
- [ ] Les CTA deviennent :
  - `Voir les plans`
  - `Voir les exceptions`
  - `Lancer une analyse`
- [ ] Quand aucun plan n'existe, la card ne montre pas seulement un empty state upload ; elle propose aussi :
  - un texte pédagogique
  - un bouton `Ajouter les plans`
  - un lien `Continuer sans plans`
- [ ] Quand le dernier job a échoué, la card explique la cause fonctionnelle si connue :
  - fichier invalide
  - extraction incomplète
  - confiance trop faible
- [ ] Les statuts sont exprimés en langage métier :
  - `Analyse en cours`
  - `Analyse terminée`
  - `Analyse à vérifier`
  - `Analyse échouée`
- [ ] Un clic sur `Voir les exceptions` ouvre directement la file de revue par exception du job le plus récent
- [ ] La card reste lisible sur mobile sans tableau

### Pourquoi ce changement

- **Marie** doit comprendre en un écran si elle peut avancer sans ouvrir la page review complète.
- **Laurent** veut savoir tout de suite où se trouvent les trous et les écarts.
- **Nadia** a besoin d'un cockpit quasi auto-suffisant pour valider 80 % de ses cas.

---

## V3-007 - Page Takeoff Jobs -> "Activity Center Mètres"

**Priorité:** P1  
**Effort:** L  
**Couches:** `[Back] [Front]`

### User Story mise à jour

> En tant que chiffreur ou validatrice, je veux suivre toutes les analyses de plans d'une affaire dans un centre d'activité unique, afin de comprendre l'état des jobs, leur qualité, leur couverture et leur utilité réelle pour le devis.

### Critères d'acceptation mis à jour

- [ ] La page conserve la vue cross-versions mais ajoute des colonnes / badges :
  - couverture DPGF
  - niveau de confiance global
  - nombre d'exceptions
  - nombre d'items appliqués
- [ ] La page dispose de trois tabs :
  - `Jobs`
  - `Exceptions`
  - `Historique d'application`
- [ ] Le filtre par version reste, mais un filtre par lot ou set de plans est ajouté
- [ ] Chaque job affiche :
  - version cible
  - lot / plan set
  - niveau
  - statut
  - nombre d'items
  - couverture
  - exceptions
  - date
- [ ] Un job terminé mais jamais appliqué est clairement identifiable
- [ ] Un job réutilisé via carry-over affiche sa provenance
- [ ] Un job n'est jamais présenté comme "utile" si sa couverture est faible ou sa confiance insuffisante
- [ ] Les compteurs du header distinguent :
  - jobs techniques
  - jobs exploitables
  - jobs avec exceptions bloquantes

### Pourquoi ce changement

- **Marie** ne doit pas ouvrir un job techniquement "terminé" mais fonctionnellement inutilisable.
- **Laurent** gagne une vraie vue d'exploitation, pas seulement une vue batch.
- **Nadia** peut suivre l'état réel des analyses sans entrer dans le détail ligne à ligne.

---

## V3-009 - Action rapide "Lancer un mètre" -> "Commande contextuelle"

**Priorité:** P1  
**Effort:** S  
**Couches:** `[Front]`

### User Story mise à jour

> En tant que chiffreur, je veux lancer une analyse de plans depuis le hub affaire avec un minimum de configuration, afin d'aller vite sans perdre le contexte.

### Critères d'acceptation mis à jour

- [ ] Le bouton principal devient `Analyser les plans`
- [ ] Le produit choisit par défaut la meilleure version cible :
  - dernière version draft
  - sinon proposition de création de brouillon
- [ ] Le produit pré-sélectionne le plan set le plus probable
- [ ] Le produit propose le niveau d'analyse recommandé avec explication simple :
  - `Rapide`
  - `Standard`
  - `Détaillé`
- [ ] Le niveau technique interne A/B/C n'est jamais montré en premier niveau à Marie
- [ ] L'action existe aussi dans une command bar globale du hub affaire
- [ ] Après lancement, l'utilisateur peut :
  - rester dans le hub
  - aller au centre d'activité mètres
- [ ] Un toast de confirmation précise :
  - version cible
  - nombre de fichiers concernés
  - prochaine action recommandée

### Pourquoi ce changement

- **Marie** comprend mieux une promesse de résultat qu'un niveau technique.
- **Laurent** veut un lancement rapide mais garde la possibilité d'affiner.
- **Nadia** n'utilise pas ce bouton, mais bénéficie d'un flux plus propre côté équipe.

---

## V3-010 - Comparaison DPGF vs Takeoff -> "Comparaison preuve-centrique"

**Priorité:** P0  
**Effort:** L  
**Couches:** `[Back] [Front] [AI]`

### User Story mise à jour

> En tant que chiffreur senior ou conductrice de travaux, je veux comparer chaque ligne DPGF avec les quantités mesurées et les preuves associées, afin de détecter vite les oublis, écarts et hypothèses fragiles.

### Critères d'acceptation mis à jour

- [ ] La vue conserve le face-à-face DPGF / takeoff mais ajoute un panneau preuve :
  - source plan
  - page ou zone source
  - item takeoff
  - éventuelle formule ou carnet de mètres lié
- [ ] Chaque ligne possède :
  - un score de matching
  - un score de confiance
  - un statut de revue
- [ ] Les états incluent :
  - `Match fiable`
  - `À confirmer`
  - `Écart significatif`
  - `Non lié`
  - `Forcé manuellement`
- [ ] L'utilisateur peut lier manuellement une ligne DPGF à :
  - un item takeoff
  - plusieurs items takeoff
  - une hypothèse manuelle
- [ ] Le résumé haut de page montre :
  - matches fiables
  - matches à confirmer
  - écarts significatifs
  - lignes DPGF sans preuve
  - items takeoff non utilisés
- [ ] Une décision de revue peut être enregistrée avec raison :
  - `on garde le DPGF`
  - `on garde le mètre`
  - `on corrige manuellement`
  - `hors périmètre`
- [ ] Les décisions manuelles sont persistées et rejouées dans la prochaine V2 si possible
- [ ] Une vue `Exceptions seulement` existe pour Nadia
- [ ] Une vue `Tout` existe pour Laurent
- [ ] Les lignes rouges doivent être filtrables et exportables

### Pourquoi ce changement

- **Marie** n'a pas besoin de toute cette vue, mais profite indirectement d'un meilleur moteur.
- **Laurent** a enfin le bon outil de fiabilisation du chiffrage.
- **Nadia** valide par exception sans fabriquer son Excel maison.

---

## V3-012 - UX Junior/Senior -> "Assisté / Production / Validation"

**Priorité:** P0  
**Effort:** M  
**Couches:** `[Front]`

### User Story mise à jour

> En tant qu'utilisateur du mètre, je veux une interface adaptée à mon niveau de décision, afin de traiter la review sans surcharge cognitive inutile.

### Critères d'acceptation mis à jour

- [ ] Le duo `simplified / expert` est conservé techniquement si besoin, mais l'UX expose trois modes :
  - `Assisté`
  - `Production`
  - `Validation`
- [ ] **Mode Assisté**
  - cartes une par une
  - contexte visuel de la preuve
  - action claire : accepter / rejeter / à revoir
  - langage métier
  - stratégie d'application simplifiée
- [ ] **Mode Production**
  - table experte
  - édition inline
  - comparaison DPGF
  - overrides
  - navigation clavier
- [ ] **Mode Validation**
  - résumé des exceptions
  - focus sur lignes rouges, trous de couverture, hypothèses ouvertes
  - pas d'édition détaillée nécessaire
- [ ] Le changement de mode ne casse pas l'état de revue déjà saisi
- [ ] Les décisions prises dans un mode sont visibles dans les autres
- [ ] Le mode affiché par défaut dépend :
  - du profil / rôle
  - du mode UI déjà choisi
  - du contexte d'entrée
- [ ] Une aide contextuelle explique "ce que je dois faire ici"

### Pourquoi ce changement

- **Marie** a besoin d'un tunnel clair.
- **Laurent** veut une table experte sans friction.
- **Nadia** a besoin d'une vue d'arbitrage, pas d'une vue d'édition.

---

## V3-013 - Plans dans le flow import -> "Intake dossier complet"

**Priorité:** P1  
**Effort:** M  
**Couches:** `[Front] [Back]`

### User Story mise à jour

> En tant que chiffreur, je veux déposer mon dossier affaire complet dès l'import, afin de démarrer le chiffrage depuis un seul flux naturel.

### Critères d'acceptation mis à jour

- [ ] L'étape ne s'appelle plus seulement `Plans (optionnel)` mais `Documents de l'affaire`
- [ ] L'utilisateur peut déposer :
  - DPGF
  - plans PDF
  - CCTP
  - BPU / DQE
  - pièces diverses
- [ ] Les plans sont identifiés comme plans, les autres documents comme contexte de dossier
- [ ] Le système crée :
  - un plan set par défaut pour les plans
  - une bibliothèque documentaire affaire pour les autres pièces
- [ ] L'étape reste optionnelle mais la valeur d'usage est expliquée
- [ ] Après import, l'utilisateur voit une synthèse :
  - X plans
  - Y autres pièces
  - prochaine action recommandée
- [ ] Le flux reste léger si l'utilisateur n'a qu'un DPGF

### Pourquoi ce changement

- **Marie** travaille à partir d'un paquet de documents, pas d'un fichier isolé.
- **Laurent** gagne du temps sur l'ouverture du dossier.
- **Nadia** profite d'une meilleure complétude documentaire en amont.

---

## V3-014 - Auto-trigger -> "Analyse proposée et pilotée"

**Priorité:** P2  
**Effort:** M  
**Couches:** `[Back] [Front]`

### User Story mise à jour

> En tant que chiffreur, je veux que le produit me propose intelligemment de lancer une analyse après upload, afin de gagner du temps sans perdre le contrôle.

### Critères d'acceptation mis à jour

- [ ] Après upload de plans, le produit propose :
  - `Analyser maintenant`
  - `Me rappeler plus tard`
  - `Ne pas proposer pour cette affaire`
- [ ] Le wording est toujours métier, jamais technique
- [ ] La proposition précise :
  - combien de fichiers seront analysés
  - quelle version sera utilisée
  - où retrouver les résultats
- [ ] Si l'utilisateur a déjà lancé un job très récent sur les mêmes fichiers, le système le détecte et n'ouvre pas une proposition inutile
- [ ] Si l'utilisateur choisit `Analyser maintenant`, les jobs sont créés en batch
- [ ] Si l'utilisateur choisit `Me rappeler plus tard`, un rappel discret revient dans le hub affaire
- [ ] La préférence mémorisée peut être différente selon :
  - poste utilisateur
  - affaire
  - contexte import / plan center
- [ ] Le système n'auto-applique jamais les résultats
- [ ] Le système n'ouvre pas la review automatiquement sans confirmation

### Pourquoi ce changement

- **Marie** gagne du temps sans être piégée par un comportement automatique opaque.
- **Laurent** évite les relances inutiles et garde le contrôle.
- **Nadia** profite d'une équipe plus cohérente dans son usage du module.

---

## Règles transverses à appliquer à toute la V3

- [ ] Toute suggestion IA affiche une preuve ou une source
- [ ] Toute décision manuelle importante peut être commentée
- [ ] Toute exception bloquante remonte au niveau affaire
- [ ] Toute vue critique existe en lecture confortable sur tablette
- [ ] Les termes techniques internes sont masqués au profit de mots métier
