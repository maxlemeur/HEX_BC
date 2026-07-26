# Handoff — vérification visuelle du 26/07

> **Pourquoi ce document.** Seize commits ont été livrés les 25 et 26/07, tous
> couverts par des tests (3217 verts, `tsc` et `eslint` à zéro). Mais deux
> chantiers touchent le **rendu** : la grille de l'éditeur et le document remis
> au client. Les tests vérifient les nombres et la structure, pas l'allure.
>
> Ce document liste **ce qu'il faut regarder, dans quel ordre, et ce qui doit
> apparaître**. Les cas sont classés par gravité de ce qu'une erreur produirait.

```bash
npm run dev
```

---

## A. Bloquant — le document en sous-traitance (EST-E27)

Un devis de sous-traitance non conforme est **juridiquement invalide**. C'est le
seul point de cette liste où une erreur de rendu a une conséquence légale.

**Mise en place.** La migration n'est pas appliquée :

```bash
supabase migration up
```

Puis sur un devis **brouillon** : onglet Paramètres → **Régime de TVA** →
« Sous-traitance — TVA autoliquidée ». Enregistrer.

### A1 — Panneau de paramètres
- [ ] Le sélecteur « Régime de TVA » apparaît **au-dessus** de « TVA unique ».
- [ ] Le texte d'aide sous le sélecteur change avec le choix.
- [ ] Après enregistrement **et rechargement de la page**, le choix est
      conservé. ⚠️ C'est le test le plus important de la liste : le schéma de
      validation aurait pu supprimer le champ en silence.

### A2 — Éditeur
- [ ] Le pied de l'éditeur n'affiche plus de TVA, et le TTC égale le HT.
- [ ] Si la version a un arrondi TTC (Paramètres → Arrondi), **le total ne
      bouge pas** : pas d'écart de quelques centimes réapparaissant en TVA.

### A3 — Document écran et impression
`/dashboard/estimates/<id>` puis `/print`.
- [ ] Le récapitulatif affiche « TVA : Autoliquidation » au lieu d'un taux.
- [ ] Le pied ne porte **aucune ligne TVA**.
- [ ] La mention complète apparaît juste avant le total :
      **« Autoliquidation — TVA due par le preneur (article 283, 2 nonies du
      CGI) »**
- [ ] La dernière ligne s'intitule **« Total HT »**, pas « Total TTC ».

### A4 — PDF et portail client
- [ ] Régénérer le PDF : mêmes quatre points qu'en A3.
- [ ] Ouvrir le lien portail : idem. Le client doit voir la mention **avant**
      d'accepter.
- [ ] Page CGV du PDF, clause 2 : elle mentionne l'autoliquidation et son
      fondement, et ne se contente plus d'affirmer que la TVA est facturée.

### A5 — Export XLSX
- [ ] Feuille « Devis » : **ni colonne TVA, ni colonne Total TTC**.
- [ ] Feuille de résumé : une ligne **« Régime de TVA »** portant la mention,
      affichée comme du texte et **non formatée en euros**.

### A6 — Non-régression du régime normal
Sur un **autre** devis laissé en « Entreprise principale » :
- [ ] TVA, Total TTC et arrondi se comportent exactement comme avant.

---

## B. Important — la marge par ligne (EST-E15 incrément 1)

C'est le manque produit n°1 comblé. Aucun risque légal, mais une grille dense
mal rendue est inutilisable.

**Mise en place.** Éditeur → sélecteur de colonnes → preset **« Complet »**
(les trois colonnes sont volontairement absentes d'« Essentiel » et
« Standard »).

### B1 — Mode normal
- [ ] Trois colonnes après « Prix total » et avant les actions :
      **Déboursé sec**, **Marge €**, **Marque %**.
- [ ] En-têtes et cellules **alignés**, sans décalage d'une colonne.
- [ ] Une ligne avec fourniture et main-d'œuvre affiche un déboursé sec
      cohérent avec ce que vous attendez.
- [ ] Sur une ligne vendue **sous** son déboursé sec, marge et marque
      apparaissent en rouge.
- [ ] La bulle d'aide de « Marque % » distingue bien marque et marge.

### B2 — Mode MO éclatée ⚠️
C'est ici que le risque est le plus élevé : ce mode utilisait une mise en page
CSS figée que j'ai remplacée par la construction dynamique. Les seize pistes ont
été reprises à l'identique et les largeurs minimales retombent au pixel
(1436 px et 1308 px), mais **je n'ai pas pu le voir**.

- [ ] Activer `EST_031_LABOR_SPLIT` pour le tenant.
- [ ] La grille n'est **pas décalée** : chaque en-tête est au-dessus de sa
      colonne, sur toute la largeur.
- [ ] Les trois colonnes de marge apparaissent aussi dans ce mode.
- [ ] Basculer entre « Essentiel » et « Complet » : l'alignement tient.

### B3 — Tablette
- [ ] Réduire la fenêtre entre 768 et 1024 px : la grille reste lisible et le
      tableau défile horizontalement sans casser la colonne Désignation figée.

---

## C. À surveiller au passage

- [ ] **MO éclatée** — la saisie atelier/chantier est de nouveau persistée
      (elle était perdue en silence). Saisir des heures atelier, enregistrer,
      recharger : la valeur tient.
- [ ] **Collage depuis Excel** — coller une colonne de quantités « 1 234,56 » :
      la quantité vaut 1234,56 et non 1. Coller « 2,500 » en tonnes : 2,5.
- [ ] **Coefficient global** — le poser en mode cascade, repasser en « Simple »,
      enregistrer, recharger : le coefficient est conservé et le total ne chute
      pas.
- [ ] **Devise fournisseur** — dans la comparaison, un prix en devise étrangère
      est marqué « Devise différente » et son bouton est désactivé.

---

## D. Si quelque chose cloche

Les points A et B ont chacun leurs tests. Si le rendu ne correspond pas alors
que la suite est verte, c'est que le test vérifie autre chose que ce que vous
regardez — dites-le moi plutôt que d'ajuster le CSS : c'est le test qu'il faut
corriger en premier.

Fichiers concernés, dans l'ordre de probabilité :

| Symptôme | Où regarder |
|---|---|
| Colonnes décalées | `resolveEstimateEditorGridStyle` (`EstimateEditorTable.tsx`) |
| Colonne de marge absente | `useColumnVisibility.ts` (presets), `LineRow.tsx` |
| Mention TVA absente | `document-copy.ts`, `EstimateDocument.tsx` |
| Régime perdu au rechargement | `patchEstimateVersionSchema` (`schemas.ts`) |
| TVA résiduelle en autoliquidation | `computeEstimateTotals` (`estimate-calculations.ts`) |

---

## E. Ce qui reste ouvert, et n'est pas à vérifier ce soir

- **Sous-traitant en franchise en base** : cas non tranché, aucune source
  officielle trouvée. À confirmer avant d'ouvrir le régime à un tenant en
  franchise.
- **Bascule `calc_engine_version`** : le gate est câblé et lit la colonne, mais
  aucune version n'est en moteur 2. C'est la phase F de T6.
- **72 constats UX/UI** non rapprochés dans
  `AUDIT-2026-07-inventaire.md` — le prochain jalon.
