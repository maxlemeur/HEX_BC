# EST-E15 — Décisions d'implémentation : structure de prix BTP

> Complète `EST-E15-structure-prix-btp.md`, qui pose l'objectif (remplacer le
> coefficient de marge unique par DS/FC/FG/B&A) mais laisse ouvertes les
> questions qui bloquent l'exécution. **Ce document tranche.**
>
> Écrit le 2026-07-24. EST-E15 est classé **P0** et **« À faire »** depuis
> l'origine, avec cette phrase dans son propre objectif : *« constitue un
> pré-requis pour la crédibilité professionnelle du logiciel »*.

---

## 0. Le constat qui justifie la priorité

Aujourd'hui, dans l'éditeur, le chiffreur voit un **prix de vente en lecture
seule** et un total. Il ne voit **jamais** son coût ni sa marge ligne à ligne.
Il ne peut donc pas arbitrer : c'est un formateur de devis, pas un outil de
chiffrage.

**Le déboursé sec existe déjà et n'est pas affiché.**
`computeEstimateLineValues` (`src/lib/estimate-calculations.ts`) calcule :

```
costLineCents = round(quantité × PU_fourniture × k_fo + coût MO)
coût MO       = h_mo_majoration × h_mo × taux_horaire × k_mo
                (ou la ventilation atelier/chantier si EST-031 est actif)
```

C'est exactement le **déboursé sec** au sens BTP : fournitures affectées d'un
coefficient de perte (`k_fo`) + main-d'œuvre affectée d'un coefficient de
rendement (`k_mo`). Il est calculé à chaque mutation, indépendant de la marge,
et **jeté** : seuls `pu_ht_cents` et `line_total_ht_cents` sont conservés.

Conséquence directe : **l'incrément 1 ci-dessous ne demande aucune migration,
aucun changement de modèle de prix.** Il rend visible ce qui est déjà calculé.

---

## 1. Décisions

### D1 — Vocabulaire et formules : on nomme, on ne devine pas

La chaîne standard BTP est en quatre étages ; l'application n'en a que deux
(DS, puis PV via un multiplicateur unique). Le niveau **CR n'existe pas**.

```
DS   Déboursé sec        = fournitures + main-d'œuvre (direct)      ← existe
FC   Frais de chantier   = installation, encadrement, engins        ← absent
FG   Frais généraux      = structure, siège                         ← absent
CR   Coût de revient     = DS × (1+FC) × (1+FG)                     ← absent
B&A  Bénéfice & aléas                                               ← absent
PV   Prix de vente HT    = CR × (1+B&A)                             ← via margin_multiplier
```

**Décision : afficher « Marque % », jamais « Marge % » seul.** Les deux
coexistent dans le métier et ne valent pas la même chose :

| Notion | Formule | Sur un DS de 100 € vendu 135 € |
|---|---|---|
| Coefficient de vente | PV / DS | **1,35** — c'est ce que le chiffreur saisit |
| Taux de marge | (PV − DS) / DS | **35 %** |
| Taux de marque | (PV − DS) / PV | **25,9 %** — c'est ce que lit la direction |

Afficher « marge : 35 % » à côté d'un total de vente est la confusion la plus
coûteuse du métier. On affiche donc **Marge €** (non ambigu) et **Marque %**
(explicitement nommée), en gardant le coefficient visible puisque c'est
l'entrée.

### D2 — FC, FG et B&A restent des grandeurs de VERSION

Pas de FC/FG par ligne en v1. Un frais de chantier par ligne n'a pas de sens
métier à ce stade (il se répartit), et cela ferait exploser une grille déjà
dense. **Trois coefficients au niveau `estimate_versions`**, comme
`margin_multiplier` aujourd'hui. Le raffinement par lot est un épic ultérieur.

### D3 — La bascule réutilise le mécanisme de T6, elle n'en invente pas un autre

C'est le point le plus important de ce document.

Introduire DS/FC/FG/B&A **change rétroactivement le prix de vente** de tout
devis existant si on ne s'en protège pas — exactement le problème que T6 a déjà
résolu. La colonne `estimate_versions.calc_engine_version` et le résolveur
fail-safe `resolveCalcEngineVersion` existent, sont testés, et **aucune version
n'est encore en v2**.

**Décision : EST-E15 est le moteur `3`.**

- `1` = comportement historique figé ;
- `2` = totaux réconciliés (T6), même modèle de prix ;
- `3` = réconciliés **+** structure DS/FC/FG/B&A.

`margin_multiplier` reste la source de vérité en v1/v2 et n'est jamais réécrit.
En v3, `PV = DS × (1+FC) × (1+FG) × (1+B&A)`. Une version bascule en v3 sur
opt-in explicite, jamais rétroactivement, **jamais sur une version scellée**.

Corollaire : **ne pas lancer EST-E15 avant que la phase F de T6 ait branché la
bascule.** Aujourd'hui la colonne n'est lue nulle part — chaque surface épingle
une constante (`grep "CALC_ENGINE_VERSION: CalcEngineVersion"`). Tant que ce
n'est pas fait, EST-E15 n'a pas d'interrupteur sur lequel se poser.

### D4 — Migration : convertir, ne pas réinterpréter

Pour une version qui bascule en v3, il faut des valeurs de départ pour FC/FG/B&A
alors qu'on ne connaît qu'un `margin_multiplier` global.

**Décision : ne pas répartir arbitrairement.** On initialise `FC = 0`, `FG = 0`,
et `B&A = margin_multiplier − 1`. Le prix de vente est donc **identique au
centime** au moment de la bascule, et le chiffreur ventile ensuite lui-même. Une
répartition « intelligente » (par exemple 5 % / 8 % / le reste) produirait des
chiffres inventés que personne ne pourrait justifier devant un maître d'œuvre —
ce qui est précisément ce que l'épic cherche à corriger.

### D5 — Saisie inverse du prix de vente : autorisée, mais tracée

Un chiffreur cale parfois un prix sur le marché puis regarde la marge obtenue.

**Décision : la saisie directe du PV est autorisée et rend la ligne
« dérogée ».** La ligne stocke le PV imposé, affiche la marque réellement
obtenue, et porte un marqueur visuel. Le total de la version distingue les
lignes dérogées. Sans ce marqueur, une ligne vendue à perte devient invisible
dans la masse — c'est la façon la plus courante de perdre de l'argent sur un
chantier.

### D6 — Contrat du breakdown : étendre au moment de l'implémentation

`EstimateLineBreakdown` (T6) devra exposer `dsCents`, `fcCents`, `fgCents`,
`baCents` par ligne. **Ne pas les ajouter maintenant** : des champs toujours à
zéro sont de la surface d'API morte, et ce dépôt en a déjà (`calc-context.ts` :
271 lignes sans importeur, protégées par 480 lignes de tests verts).

En revanche, **faire dériver les surfaces du breakdown (phase D de T6) n'est pas
du travail perdu** : c'est ce qui rendra EST-E15 applicable en un seul endroit
au lieu de six. L'ordre T6-D/E → EST-E15 est le bon.

---

## 2. Incréments

### Incrément 1 — Rendre la marge visible (aucun changement de modèle)

**C'est le seul incrément livrable immédiatement**, puisque le DS existe déjà.

Trois colonnes optionnelles dans l'éditeur, en lecture seule :
**Déboursé sec** · **Marge €** · **Marque %**.

Notes d'implémentation, vérifiées :

- `ColumnVisibilitySet`
  (`src/components/estimates/components/estimate-editor-row/shared.ts`) est un
  type union fermé — y ajouter `"ds" | "marge" | "marque"`.
- Les cellules se déclarent dans **quatre** endroits cohérents :
  `EstimateEditorTableChrome.tsx` (en-tête), `LineRow.tsx`, `SectionRow.tsx`
  (cellules vides d'alignement), `StandardMoCells.tsx`.
- **La grille a deux régimes**, et il faut traiter les deux :
  1. **Mode normal** — `resolveEstimateEditorGridStyle`
     (`src/components/estimates/EstimateEditorTable.tsx`) construit
     `grid-template-columns` et les largeurs minimales **dynamiquement** à
     partir de `visibleColumns`, via un helper `addOptionalColumn`. Ajouter une
     colonne optionnelle s'y fait proprement, en une ligne par colonne.
  2. **Mode split MO** — la fonction retourne `undefined` et laisse le CSS
     statique `.estimate-table--labor-split` s'appliquer (16 pistes en dur,
     desktop + tablette, dans `src/app/globals.css`). Cohérent, car dans ce mode
     les colonnes sont forcées visibles (`|| isLaborSplitEnabled` dans
     `LineRow`). Il faut donc **aussi** ajouter les 3 pistes aux deux chaînes CSS
     et relever `--estimate-desktop-min-width` / `--estimate-tablet-min-width`.

  Le risque n'est donc pas un désalignement — le mécanisme est sain — mais
  l'**oubli du second régime** : les colonnes apparaîtraient correctement en mode
  normal et casseraient la largeur du tableau dès qu'un tenant active EST-031.
  Tester les deux modes.
- La marge affichée ici est **brute** : `line_total_ht_cents` est la vente avant
  coefficient global et avant remise de version. Le libeller ainsi. La marge
  **nette** par ligne arrive avec `breakdown.lineById[].saleNetHtCents` (T6
  phase D), qui redescend coefficient et remise jusqu'à la ligne.

### Incrément 2 — Coefficients FC / FG / B&A (moteur 3)

Migration `estimate_versions` : `coeff_fc`, `coeff_fg`, `coeff_ba`
(`numeric`, défaut `0`), `add column if not exists`, sans réécriture de table —
même patron que `calc_engine_version`. Panneau de paramètres, et le moteur
applique la cascade en v3 uniquement (D3), avec initialisation par D4.

### Incrément 3 — Le document justifie le prix

C'est la finalité de l'épic : produire un **sous-détail de prix** exportable,
opposable au maître d'œuvre. Sans lui, la décomposition ne sert qu'en interne.

---

## 3. Ce qu'on ne fait pas, et pourquoi

- **Pas de FC/FG par ligne** (D2).
- **Pas de répartition automatique du `margin_multiplier`** (D4).
- **Pas de bascule rétroactive**, jamais sur une version scellée (D3).
- **Pas de champs de breakdown en avance de phase** (D6).

## 4. Question ouverte, à trancher côté produit

Quatre mécanismes standards du devis BTP français sont **absents du code**
(vérifié : zéro occurrence) :

1. **retenue de garantie** (typiquement 5 %) ;
2. **compte prorata** (frais de chantier partagés, souvent 1 à 2 % du lot) ;
3. **autoliquidation de TVA** — mention obligatoire en sous-traitance BTP ;
4. **révision / actualisation de prix** par indices BT — évoquée dans les docs,
   aucune trace dans le code.

Leur nécessité dépend du marché visé. Sur du privé/particulier, ils sont
secondaires. Mais l'application exporte du **DPGF** et porte un épic
sous-traitance, ce qui pointe vers des marchés structurés où ces quatre-là ne
sont pas optionnels — et où le point 3 est une obligation légale.

**C'est la question à trancher avant de séquencer la suite du produit :
quel marché ?** Elle a plus d'impact sur la feuille de route que l'ordre des
incréments ci-dessus.
