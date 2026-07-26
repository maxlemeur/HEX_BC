# EST-E27 — Régime de TVA : entreprise principale ou sous-traitance

> Décision produit du 2026-07-25 : **l'utilisateur doit pouvoir choisir** entre
> intervenir en entreprise principale ou en sous-traitance. Le marché visé
> inclut des marchés publics et structurés.
>
> Ce document décide le modèle et le comportement. Il est exécutable en l'état.
> **Il n'a volontairement pas été implémenté** — voir §6.

---

## 1. Pourquoi ce n'est pas une option de confort

En sous-traitance de travaux immobiliers, la TVA est **autoliquidée** : le
sous-traitant facture **hors taxe**, et c'est le preneur (l'entreprise
principale) qui déclare la TVA. Le document doit porter la mention légale
correspondante.

Un devis de sous-traitance émis avec de la TVA, ou sans la mention, n'est pas
conforme. C'est la seule fonctionnalité de cette feuille de route dont l'absence
produit un document **juridiquement invalide** plutôt que simplement imparfait.
Elle passe donc devant la marge par ligne dans l'ordre de priorité.

Aujourd'hui, rien dans le code ne porte cette notion : zéro occurrence de
`autoliquidation` dans `src/` comme dans `docs/`. Le modèle CGV
(`src/lib/estimates/pdf-terms.ts`) affirme même l'inverse — *« les prix sont
exprimés hors taxes et la TVA est facturée au taux applicable »* — ce qui est
faux en sous-traitance et devra être conditionné.

## 2. Décisions

### D1 — Le régime est porté par la VERSION, pas par le tenant

Une même entreprise est principale sur un marché et sous-traitante sur le
suivant. Un réglage global serait faux la moitié du temps. Le régime est donc un
attribut de la version de devis, repris par défaut de l'affaire.

### D2 — Le logiciel propose, il ne déduit pas

Le régime est un **choix explicite** de l'utilisateur, jamais une inférence à
partir du client ou du type de travaux. Les conditions d'application comportent
des nuances (nature des travaux, qualité du preneur, territorialité) que
l'application n'a pas les moyens de trancher — et se tromper engage l'émetteur.
On offre le choix, on affiche clairement le régime retenu, on ne devine pas.

### D3 — Modéliser le RÔLE, pas la conséquence fiscale

```sql
alter table public.estimate_versions
  add column if not exists contractor_role text not null default 'principal';
-- check (contractor_role in ('principal', 'subcontractor'))
```

`contractor_role` décrit le fait métier ; le traitement de TVA en découle. Un
champ nommé `vat_reverse_charge` figerait la conséquence et vieillirait mal si
la règle fiscale évolue. Le défaut `'principal'` préserve le comportement
actuel de toutes les versions existantes.

### D4 — Effet moteur : taux effectif à zéro, sans casser le contrat

En autoliquidation, **toutes** les lignes sont à taux zéro, y compris celles qui
portent un `tax_rate_bp` propre (multi-taux 10 % / 5,5 %). Le total TTC égale le
total HT.

Implémentation : un paramètre **optionnel** `vatReverseCharge?: boolean` sur
l'entrée du moteur, appliqué là où le taux effectif est résolu — donc sans
rendre le contrat obligatoire ni casser les appelants, contrairement à ce qui a
été fait pour `marginTiers` en phase B.

⚠️ Deux pièges vérifiés dans le code :
- l'arrondi TTC (`roundingMode` / `roundingStepCents`) ne doit pas s'appliquer
  deux fois quand TTC = HT ;
- `computeTaxCents` est appelé par ligne **et** au pied : les deux chemins
  doivent voir le même régime, sinon on reproduit exactement la divergence que
  T6 vient de corriger.

### D5 — Le document porte la mention, et retire la TVA

- La ligne « TVA » disparaît du récapitulatif et du pied
  (`EstimateDocument.tsx`, deux emplacements) ;
- une mention explicite apparaît à sa place, avec le renvoi légal ;
- la clause TVA des CGV (`pdf-terms.ts`) devient conditionnelle ;
- le régime est visible **dans l'éditeur**, pas seulement sur le document : le
  chiffreur doit savoir sous quel régime il chiffre.

### D6 — Le sceau : inclusion CONDITIONNELLE, obligatoirement

`contractor_role` entre dans le périmètre scellé — c'est une donnée
contractuelle. Mais il ne doit être ajouté au payload canonique **que
lorsqu'il vaut autre chose que `'principal'`**.

C'est la leçon directe de `b74a0c8`, corrigé le 24/07 : y ajouter une clé
présente sur toutes les lignes a invalidé le sceau de **tout** le parc, bloqué
le renvoi par email, et sans réparation possible puisque `seal_hash` est
immuable hors transition draft → sent. Le test de non-régression doit utiliser
l'état réel en base (`contractor_role = 'principal'` partout après migration),
pas une fixture où la clé est absente.

## 3. Ce que ça implique ailleurs

- **Exports** : DPGF et BDC affichent des colonnes TVA — à conditionner.
- **Portail client** : le client (ici, l'entreprise principale) doit voir le
  régime et la mention avant d'accepter.
- **Analyse de marge affaires** : inchangée. Elle raisonne en HT, l'autoliquidation
  ne la concerne pas.

## 4. Ordre d'exécution

1. Migration + types + choix explicite dans l'éditeur et le wizard (D1, D3).
2. Moteur (D4) + tests des deux chemins de TVA.
3. Document, CGV conditionnelles, mention (D5).
4. Sceau conditionnel + test sur l'état réel (D6).
5. Exports (§3).

Les étapes 1 à 4 forment un tout : livrer 1 et 2 sans 3 produirait un devis à
TVA zéro **sans** la mention légale — donc un document non conforme qui a l'air
correct. C'est pire que ne rien faire. **Ne pas fractionner.**

## 5. La suite fiscale, une fois ce socle posé

Les trois autres mécanismes attendus sur marchés structurés, à traiter ensuite :
**retenue de garantie**, **compte prorata**, et **révision de prix par indices
BT** — ce dernier supposant de figer l'indice de référence à la signature, donc
une décision de modèle à prendre avant de coder, pas après.

## 6. Pourquoi ce document n'est pas accompagné de code

Le sujet est fiscal : une erreur ne produit pas un bug, elle produit un document
non conforme émis à un client. Je suis sûr du principe (facturation HT +
mention en sous-traitance de travaux immobiliers) et du modèle ci-dessus, mais
pas assez des conditions d'application pour les figer seul dans un moteur.

**Demande explicite avant d'implémenter** : faire confirmer par votre comptable
ou conseil (a) le libellé exact de la mention à porter sur le devis, et (b) le
périmètre des travaux concernés. Ces deux réponses rendent le §4 exécutable
d'un bloc, sans autre décision à prendre.
