# PRICE-02 — Moyenne de référence et offre fournisseur nulle

## Défaillances définies avant le correctif

| Défaillance | Oracle observable |
| --- | --- |
| Une offre nulle masque la moyenne des offres comparables positives | Pour 10, 11 et 0 €/m à conditions identiques : afficher 10,50 €/m et deux fournisseurs retenus, avec l'offre nulle exclue. |
| Une validation de la moyenne efface l'anomalie non corrigée | Valider explicitement 10,50 €/m, attendre la relecture, puis recharger : référence validée et clarification du zéro toujours visibles. |
| Le zéro devient un nouveau prix de référence sans décision | Si seul zéro subsiste : aucune moyenne, validation de moyenne indisponible, ancienne référence conservée et signalée à actualiser. Le prix manuel justifié reste une décision distincte. |
| Le chiffreur ne peut identifier ou corriger l'offre exclue | Tableau : fournisseur, référence, montant nul, motif d'exclusion et lien vers les tarifs existants filtrés pour le produit/fournisseur. |
| Le texte contredit la date de fin inclusive | Expliquer la validité maximale de six mois et la fin incluse ; ne pas dire qu'une offre est exclue dès le jour exact des six mois. |

Les règles de calcul et de validation restent serveur. Le panneau affiche la
proposition reçue, conserve l'empreinte à valider, la validation humaine, son
journal et les protections existantes. Une alerte de zéro dépend de la
proposition rechargée, jamais de l'affichage du message de succès.

## Couverture

Les dix régressions de composant existantes sont maintenues. Avant le code,
le cas existant du zéro bloquant est adapté à la moyenne 1 050 centimes et à
la clarification persistante ; le cas existant sans offre comparable précise
le zéro seul et l'ancienne référence 1 400 centimes. Aucune nouvelle suite
d'isolation de rendu n'est ajoutée. Ces tests simulant SWR ne prouvent ni la
persistance, ni les droits serveur, ni les dates calculées par PostgreSQL.

La recette principale est le parcours TesterArmy local coordonné : connexion
ordinaire, article ARMY et offres 10/11/0, affichage exact, validation explicite,
relecture du prix et du journal, rechargement avec clarification persistante,
puis zéro seul sans remplacement automatique. Les références existantes des
devis doivent rester inchangées. Les contraintes, empreintes et bornes de dates
ont leur campagne SQL locale séparée.

Commande de maintenance :

```powershell
npm test -- --project=jsdom src/components/products/ProductReferencePricePanel.test.tsx
```

Avant exécution E2E, cette fiche ne revendique aucune preuve persistante.

## Résultats de maintenance — 11 octobre 2026

- Avant correctif, la commande ci-dessus échoue sur **2 tests / 10** : le
  panneau masque 10,50 € dès qu'un zéro reste à clarifier et remplace aussi
  « Aucune offre comparable » par l'alerte de prix nul. Les huit autres tests
  passent. Cette exécution RED précède la modification du composant.
- Après correctif, la même commande passe **10/10**. L'ancienne suite conserve
  ses protections : validation explicite avec empreinte, justification
  manuelle, lecteur sans action, indisponibilité après erreur et navigation
  pendant rafraîchissement. Le prix de référence et le journal restent traités
  par les actions existantes.
- ESLint sur le composant et son test, puis `git diff --check` sur ces deux
  fichiers : succès. Les tests sont exécutés hors sandbox, dont le cache Vite
  avait déjà produit des erreurs environnementales `EPERM` dans cette session.

## Sélecteurs pour le parcours navigateur

- Région : `Prix de référence` ; montant proposé : `10,50 € / m` (normaliser
  les espaces de devise), accompagné de `2 fournisseurs retenus`.
- Alerte : `Une offre à prix nul est exclue de la moyenne et reste à clarifier.`
  Elle reste présente après le succès de validation si la relecture garde
  `zero_price_requires_review=true`.
- Ligne du fournisseur nul : motif `Prix nul exclu · à clarifier`, lien
  `Examiner l’offre à corriger`, destination
  `/dashboard/prices?product_id=<produit>&supplier_id=<fournisseur>`.
  Cet écran existant permet d'examiner et de modifier le tarif ; ce lien
  n'effectue aucune écriture.
- Bouton explicite : `Valider la moyenne comme référence` ; message de
  succès : `Prix de référence validé. Les devis existants conservent leurs coûts.`
- Zéro seul : `Aucune offre comparable`, `Référence actuelle · à actualiser`,
  bouton de moyenne désactivé ; l'alerte reste visible.

La recette persistante et l'application de la migration sont centralisées par
la livraison coordinatrice. Aucun serveur, appel API ni SQL n'a été lancé pour
ce volet UI.
