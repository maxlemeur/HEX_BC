# VNext BTP SaaS - README backlog produit

Version: 2026-03-06

## Objectif

Ce dossier prolonge les documents existants autour de deux axes :

1. **Mettre à jour la V3 "Mètres & Plans"** pour la rendre plus simple, plus affaire-centrique et plus IA-native.
2. **Créer les prochaines epics** après `EST-E20` afin de transformer le produit en plateforme de chiffrage BTP moderne, explicable et collaborative.

## Documents sources pris en compte

- `V3-METRES-COMPLET.md`
- `ANALYSE-COMPLETE-CHIFFRAGE-BTP.md`

## Ce que ce pack ajoute

### 1. Addendum V3
Le fichier `V3-UPDATE-TAKEOFF.md` ne remplace pas toute la V3.  
Il **réécrit uniquement les stories qui doivent changer** à la lumière de la vision produit proposée :

- passage d'une logique **Junior / Senior** à une logique **Assisté / Production / Validation**
- intégration plus forte des **preuves**, des **hypothèses** et des **exceptions**
- amélioration de l'onboarding dossier -> plans -> extraction -> review
- wording plus métier et moins technique
- ajout d'un comportement plus fiable pour les parcours V2 / V3 / carry-over

### 2. Track V3 Approbation / Direction enfin détaillé
Les placeholders `V3-E04` à `V3-E07` deviennent des epics exploitables :

- `V3-E04` - Rôle Direction & Permissions
- `V3-E05` - Workflow Approbation Affaire
- `V3-E06` - Dashboard Direction & Risque
- `V3-E07` - Portail Client Lite & Boucle Questions

### 3. Nouvelles epics roadmap après EST-E20
Les epics `EST-E21` à `EST-E25` ouvrent une nouvelle phase produit :

- `EST-E21` - Intake IA & Brief Affaire
- `EST-E22` - Draft Assisté & Ouvrages Générés
- `EST-E23` - Preuve, Prix Expliqués & Risk Radar
- `EST-E24` - Collaboration & Revue par Exception
- `EST-E25` - Revision Engine & Boucle Client

## Personas de référence

### Marie - Chiffreuse junior
- Veut aller vite sans se perdre
- A besoin d'un parcours guidé, visible, rassurant
- Ne doit jamais être confrontée d'entrée à des stratégies complexes

### Laurent - Chiffreur senior
- Veut aller vite, avec contrôle fin
- A besoin d'une comparaison fiable DPGF / mètres / prix
- Doit pouvoir corriger, forcer, expliquer et rejouer

### Nadia - Conductrice de travaux / validatrice
- Veut valider par exception
- A besoin d'une vue synthétique des risques, trous documentaires et écarts significatifs
- Ne veut pas ouvrir 15 écrans pour confirmer qu'une affaire peut partir

## Principes de rédaction utilisés

1. **Aucune écriture silencieuse par l'IA**
2. **Toute suggestion importante doit afficher sa preuve**
3. **Toute décision de validation doit être traçable**
4. **Le mode mobile sert surtout à capter, annoter, valider, pas à refaire tout l'éditeur**
5. **Les critères d'acceptation sont pensés pour grooming, découpage et recette**
6. **Chaque story indique pourquoi elle existe pour Marie, Laurent et Nadia**

## Proposition de milestones VNext

| Milestone | Thème | Epics |
|---|---|---|
| M7 | IA native, explicabilité, revue | EST-E21, EST-E22, EST-E23, EST-E24 |
| M8 | Révision, boucle client, extension exécution | EST-E25 + extension M6 |

## Ordre recommandé

### Vague 1 - Rendre V3 vendable et visible
- V3-005, V3-010, V3-012, V3-013, V3-014 mis à jour
- V3-E04, V3-E05
- EST-E21

### Vague 2 - Supprimer la page blanche du chiffreur
- EST-E22
- EST-E23 (minimum viable)
- V3-E06

### Vague 3 - Transformer la validation en revue par exception
- EST-E24
- V3-E07
- EST-E25

## Fichiers inclus

- `V3-UPDATE-TAKEOFF.md`
- `V3-E04-role-direction-permissions.md`
- `V3-E05-workflow-approbation-affaire.md`
- `V3-E06-dashboard-direction-risque.md`
- `V3-E07-portail-client-lite.md`
- `EST-E21-ai-intake-brief-affaire.md`
- `EST-E22-draft-assiste-ouvrages.md`
- `EST-E23-preuve-prix-risque.md`
- `EST-E24-collaboration-revue-exception.md`
- `EST-E25-revision-engine-boucle-client.md`

## Note de cadrage

Le but n'est pas de recréer un ERP chantier complet dès maintenant.  
Le but est de faire gagner du temps sur les 4 moments qui font la différence :

1. **ouvrir un dossier**
2. **sortir un premier devis crédible**
3. **détecter les risques avant l'envoi**
4. **absorber une V2 ou une question client sans repartir de zéro**
