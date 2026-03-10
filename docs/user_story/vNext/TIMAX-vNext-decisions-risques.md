# TIMAX vNext — Décisions produit, réduction de risque et réponses aux questions ouvertes

> Source unique utilisée : documents de contexte fournis.
>
> Règles appliquées :
> - aucune capability non présente dans le contexte n’est présentée comme existante ;
> - toute décision de vNext est marquée **[inference]** ;
> - objectif explicite : **réduire au minimum les risques produit et techniques sans ralentir le chiffreur**.

---

## 1. Thèse de réduction de risque [inference]

La meilleure façon d’accélérer le chiffreur **sans créer de dette produit dangereuse** est de pousser TIMAX vers une logique :

1. **un seul flux principal visible** ;
2. **des automations qui convergent vers les briques déjà prouvées** ;
3. **des validations humaines courtes, ciblées et uniquement sur les exceptions** ;
4. **une finish line lisible en deux états** plutôt qu’une promesse “tout automatique” ;
5. **aucune nouvelle filière parallèle** pour le DPGF PDF, le pricing fournisseur ou les commandes.

Autrement dit : on réduit le risque en faisant **moins de magie**, mais **plus de convergence, plus de couverture et plus de traçabilité**.

---

## 2. Décisions produit à prendre maintenant [inference]

## D-1 — Le flux principal devient la seule narration par défaut
- **Décision**
  - la vNext guide l’utilisateur d’abord vers le flux principal :
    `affaire -> intake -> brief -> DPGF -> plans/takeoff -> pricing -> finish line`
- **Pourquoi cela réduit le risque**
  - évite de mélanger `version-zero`, `generated-ouvrages` et le legacy au cœur du parcours.
- **Impact**
  - les branches adjacentes restent disponibles comme aides ;
  - le legacy devient un fallback explicite, jamais la voie par défaut.

## D-2 — Toute nouvelle entrée doit converger vers un pipeline canonique existant
- **Décision**
  - DPGF PDF doit converger vers l’import DPGF canonique ;
  - grilles fournisseurs doivent converger vers le pipeline pricebook existant.
- **Pourquoi cela réduit le risque**
  - empêche la multiplication des règles métier, états et bugs.
- **Impact**
  - pas de “petit moteur PDF à part” ;
  - pas de “petit import Excel à part”.

## D-3 — Le produit est piloté par exceptions, pas par revue exhaustive
- **Décision**
  - les vues par défaut montrent d’abord :
    - ambiguïtés documentaires,
    - mapping incomplet,
    - items takeoff fragiles,
    - trous de couverture prix,
    - prérequis manquants pour sortir.
- **Pourquoi cela réduit le risque**
  - accélère l’utilisateur tout en gardant le contrôle sur les points sensibles.
- **Impact**
  - les cas simples sont pré-remplis ou considérés comme acquis ;
  - l’effort humain se concentre sur les cas risqués.

## D-4 — Toute automation sensible reste “assistive under confirmation”
- **Décision**
  - pas d’arbitrage full-auto irréversible sur les quantités, les prix ou les commandes.
- **Pourquoi cela réduit le risque**
  - évite les erreurs silencieuses en contexte high-stakes.
- **Impact**
  - takeoff = review/apply ;
  - pricing = présélection bulk avec confirmation ;
  - commandes = brouillons, pas génération finale automatique.

## D-5 — La finish line doit être séparée en deux états métier
- **Décision**
  - `ready to send` ≠ `ready to order`.
- **Pourquoi cela réduit le risque**
  - le devis peut être sorti avant que toute la chaîne achats soit complètement prête.
- **Impact**
  - l’utilisateur sait exactement ce qui bloque encore.

## D-6 — Le produit ne promet pas ce que la preuve ne soutient pas
- **Décision**
  - la vNext ne promet ni stock temps réel, ni full-auto fournisseur, ni “avant midi” sans revue humaine.
- **Pourquoi cela réduit le risque**
  - protège la confiance utilisateur et la crédibilité commerciale.
- **Impact**
  - la promesse devient “accélération forte et traçable”, pas “automatisation totale”.

---

## 3. Réponses recommandées aux questions ouvertes

## Q-1 — Quel seuil de qualité pour un DPGF PDF ?
### Réponse recommandée [inference]
Mettre un **gating produit explicite** en 3 états :

- **Accepté avec validation légère**
  - quand TIMAX détecte un document `tabular_pdf` et que les tableaux sont cohérents.
- **Accepté avec validation renforcée**
  - quand des ambiguïtés restent, mais que l’utilisateur peut les lever rapidement.
- **À reprendre manuellement**
  - quand la structure tabulaire est trop dégradée pour converger proprement vers le pipeline canonique.

### Pourquoi c’est la meilleure réponse
- protège le pipeline canonique ;
- évite la sur-promesse “PDF magique” ;
- garde un vrai gain de temps sur les PDF exploitables.

### Règle de sécurité
Aucun DPGF PDF ne doit créer directement une version de devis sans passer par une validation de tableaux puis par le mapping canonique.

---

## Q-2 — Comment définir `ready to send` ?
### Réponse recommandée [inference]
`ready to send` doit vouloir dire :

- une version de devis existe ;
- la structure est matérialisée ;
- les quantités utiles ont été appliquées ou explicitement laissées hors scope ;
- les exceptions bloquantes restantes sont connues ;
- le PDF devis est générable ;
- l’utilisateur peut envoyer sans revenir sur une étape cachée.

### Ce que `ready to send` ne doit pas exiger
- que les commandes fournisseurs soient prêtes ;
- qu’il n’existe plus aucune hypothèse ou vigilance ;
- qu’il n’y ait plus aucune suggestion pricing à revoir si elles ne sont pas bloquantes.

### Pourquoi c’est la meilleure réponse
- permet une sortie devis rapide ;
- évite de coupler inutilement le devis aux achats.

---

## Q-3 — Comment définir `ready to order` ?
### Réponse recommandée [inference]
`ready to order` doit vouloir dire :

- les lignes commandables ont un fournisseur retenu ;
- les quantités nécessaires à commander sont figées pour cette étape ;
- les regroupements par fournisseur sont possibles ;
- les lignes non commandables ou ambiguës sont isolées ;
- le module commandes peut créer des brouillons exploitables.

### Ce que `ready to order` ne doit pas promettre
- création finale automatique de toutes les commandes ;
- validation achat sans revue ;
- disponibilité stock.

### Pourquoi c’est la meilleure réponse
- conserve une finish line réaliste ;
- relie enfin le devis aux achats sans sur-promesse.

---

## Q-4 — CSV d’abord ou Excel fournisseur tout de suite ?
### Réponse recommandée [inference]
**CSV d’abord dans le parcours affaire, Excel ensuite.**

### Pourquoi c’est la meilleure réponse
- le CSV fournisseur est déjà la brique la plus proche du prouvé ;
- cela réduit fortement le risque de pipeline doublé ;
- cela permet de sécuriser :
  1. l’entrée affaire,
  2. la couverture pricing,
  3. la présélection bulk,
  avant d’ouvrir le front Excel.

### Décision pratique
- Release 1 / 2 : CSV dans l’affaire
- Release 3 : convergence Excel vers le même pipeline

---

## Q-5 — Comment traiter les plans annotés à la main ?
### Réponse recommandée [inference]
Les plans annotés à la main doivent être **acceptés comme entrée documentaire**, mais **traités comme cas à risque** tant que leur robustesse n’est pas prouvée.

### Règle produit
- l’utilisateur peut les déposer et les classer comme plans ;
- le takeoff peut être lancé si le document reste exploitable ;
- les quantités issues de zones fragiles doivent remonter comme items à revoir en priorité ;
- aucune promesse spécifique “lecture fiable du manuscrit” ne doit être faite.

### Pourquoi c’est la meilleure réponse
- on n’exclut pas un cas métier réel ;
- on n’en fait pas une capacité surestimée.

---

## Q-6 — Comment exposer les niveaux A/B/C du takeoff ?
### Réponse recommandée [inference]
Ne pas exposer A/B/C comme jargon par défaut. Exposer des **intentions métier** :

- **Rapide**
- **Standard**
- **Audit / preuve renforcée**

Et garder le mapping interne A/B/C côté système.

### Pourquoi c’est la meilleure réponse
- le chiffreur comprend l’intention ;
- on évite une discussion trop technique ;
- on garde la possibilité d’afficher le niveau réel en détail avancé.

### Règle de sécurité
Le mode “Audit / preuve renforcée” doit être le seul à promettre explicitement evidence/page/confiance fortes.

---

## Q-7 — Jusqu’où aller sur la présélection bulk pricing ?
### Réponse recommandée [inference]
Adopter un mode **pré-cocher / suggérer / expliquer / confirmer**.

### Séquence recommandée
1. TIMAX pré-sélectionne les cas simples.
2. TIMAX isole les cas ambigus, stale, sans prix, ou en divergence.
3. L’utilisateur confirme le bulk simple.
4. L’utilisateur arbitre les exceptions.

### Pourquoi c’est la meilleure réponse
- accélère fortement le chiffreur ;
- réduit le risque d’erreur massive ;
- reste aligné avec une logique high-stakes.

### Ce qu’il faut refuser
- auto-application silencieuse ;
- arbitrage global irréversible ;
- mélange des cas simples et risqués dans la même action.

---

## Q-8 — Comment gouverner `version-zero` et `generated-ouvrages` ?
### Réponse recommandée [inference]
Les exposer comme **Aides de structuration**, jamais comme cœur du flux principal.

### Règle produit
- visibles dans l’affaire ;
- explicitement taguées `adjacent` ;
- appelées quand le DPGF est incomplet ou quand le brief doit être transformé en structure ;
- jamais utilisées pour masquer l’absence d’un import DPGF propre.

### Pourquoi c’est la meilleure réponse
- préserve la clarté de la promesse ;
- évite que l’utilisateur confonde structure assistée et chiffrage final.

---

## Q-9 — Quand rendre visible le gap de carry-over takeoff ?
### Réponse recommandée [inference]
Le rendre visible **au moment de la création de version**, pas après.

### Pourquoi c’est la meilleure réponse
- évite les pertes “invisibles” ;
- permet au chiffreur d’anticiper s’il devra relancer, re-relier ou revalider.

### Règle UX
Le message doit répondre à 3 questions :
- qu’est-ce qui est repris ;
- qu’est-ce qui n’est pas repris ;
- que dois-je faire ensuite ?

---

## Q-10 — Quelle politique sur le legacy takeoff estimate-first ?
### Réponse recommandée [inference]
Le garder comme **fallback explicite**, pas comme voie normale.

### Pourquoi c’est la meilleure réponse
- protège la migration produit ;
- évite de casser l’existant trop tôt ;
- clarifie le parcours recommandé.

### Règle UX
- le flux principal doit toujours être mis en avant ;
- le legacy doit être étiqueté comme tel ;
- la bascule vers le legacy doit être volontaire.

---

## 4. Garde-fous anti-risque par domaine [inference]

## 4.1 Intake / import dossier
- ne jamais faire croire qu’un “drop all files” est déjà auto-orchestré de bout en bout ;
- montrer clairement ce qui a été classé, ce qui a été routé, ce qui attend une décision ;
- ne jamais bloquer tout le dossier à cause d’un seul fichier problématique.

## 4.2 DPGF
- le DPGF tabulaire reste la référence stable ;
- le DPGF PDF doit converger vers le pipeline canonique ;
- pas de matérialisation estimate sans validation de tableaux et mapping.

## 4.3 Takeoff
- le takeoff reste un flux review/apply ;
- les preuves doivent être visibles quand elles existent ;
- les items fragiles remontent en priorité ;
- les plans annotés restent traités comme risque, pas comme promesse.

## 4.4 Pricing fournisseur
- la couverture pricing doit être visible avant toute bulk action ;
- aucun bulk apply sans explication ni confirmation ;
- les cas stale / ambigus / sans prix doivent rester dans une file dédiée ;
- ne pas promettre stock-aware pricing.

## 4.5 Finish line
- séparer devis et commandes ;
- ne générer que des brouillons de commandes ;
- ne pas masquer les lignes non commandables.

## 4.6 Continuité / versions
- rendre le carry-over explicite ;
- permettre la reprise après attente ou erreur ;
- expliciter principal / adjacent / legacy.

---

## 5. Checklist de lancement vNext à risque minimum [inference]

### Go / No-Go produit
La release ne part pas si :
- l’utilisateur ne comprend pas où il en est dans l’affaire ;
- le DPGF PDF contourne le pipeline canonique ;
- la bulk sélection fournisseur n’explique pas ses choix ;
- le takeoff n’expose pas ses items fragiles en priorité ;
- la finish line ne distingue pas `ready to send` et `ready to order`.

### Indicateurs à suivre
- taux de dossiers menés sans sortie du flux principal ;
- part des exceptions réellement traitées vs volume total ;
- temps jusqu’à “devis envoyable” ;
- part de lignes couvertes en pricing ;
- part de lignes encore ambiguës avant finish line ;
- part de commandes brouillons créées sans retraitement hors TIMAX.

---

## 6. Réponse synthétique pour accélérer le chiffreur [inference]

La meilleure stratégie n’est pas d’ajouter plus d’automatisation invisible ; c’est de rendre TIMAX **plus convergent, plus lisible et plus piloté par exceptions**. Cela accélère le chiffreur parce qu’il ne repart pas de zéro, ne revoit pas tout, comprend immédiatement où arbitrer, et termine avec une sortie exploitable sans perdre la main sur la fiabilité. La vraie vNext doit donc sécuriser quatre choix : un seul flux principal, DPGF PDF qui rejoint le pipeline canonique, pricing fournisseur bulk mais confirmé, et finish line séparée entre devis envoyable et commandes préparables.

