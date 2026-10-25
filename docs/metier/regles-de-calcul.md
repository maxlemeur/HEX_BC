# Règles de calcul

Contrat relu sur le code le 24 octobre 2026. Le moteur est épinglé sur chaque
version de devis. Toute modification doit préserver les résultats des versions
historiques et les montants déjà émis. Les migrations ordonnées définissent le
schéma ; `supabase/schema.sql` est seulement un pointeur.

## Choisir le bon moteur

| Version | Contrat |
| --- | --- |
| Moteur 1 | Calcul historique, conservé pour les devis existants. |
| Moteur 2 | Calcul réconcilié entre lignes et pied, avec snapshot contractuel. Reste utilisé si l'entreprise a explicitement une politique 2. |
| Moteur 3 | Défaut des nouvelles versions. Prix unitaire calculé avant multiplication par la quantité, heures par unité, coefficients FO/MO, unités et statuts de ligne explicites. |

Sans politique d'entreprise, la création utilise le moteur 3, les coefficients
FO = 1,30 et MO = 1,20 et les taux autorisés 20 %, 10 %, 5,5 % et 2,1 %.
La transaction de création relit cette politique ; une attente client différente
échoue avec `409 CONTEXT_CHANGED`. La duplication conserve le moteur de la source.
Changer une politique ne convertit donc aucun devis existant.

Le moteur des nouvelles versions reste réglé par l'équipe produit
(`set_tenant_calc_policy`, service_role). Un administrateur de l'entreprise règle,
depuis Administration › Calcul des devis, les coefficients FO et MO par défaut et
les taux de TVA autorisés (`set_tenant_calc_defaults`), avec un motif journalisé ;
le moteur en vigueur est réécrit tel quel, et le premier enregistrement crée une
politique explicite au moteur 3. Les coefficients valent pour les prochains devis.
Les taux sont relus à chaque gel d'un devis v3, brouillons en cours compris : un
taux retiré bloque le gel des lignes qui l'utilisent
(`ESTIMATE_V3_TAX_RATE_NOT_ALLOWED`).

Sources : [politique](../../src/lib/estimates/calc-policy-server.ts),
[réglages administrateur](../../supabase/migrations/20261025115010_tenant_calc_defaults_admin.sql),
[création canonique](../../src/lib/estimates/canonical-v2-creation.ts),
[bascule SQL](../../supabase/migrations/20261018183629_estimate_engine_v3_default.sql).
Le nom historique `canonical-v2-creation` ne limite pas la façade au moteur 2.

Utiliser [computeVersionBreakdown](../../src/lib/estimates/engine/compute.ts)
pour l'aiguillage et
[requireEstimateEngineVersion](../../src/lib/estimates/engine/capabilities.ts)
aux frontières contractuelles. Une colonne moteur absente ou inconnue doit y
échouer ; une v3 ne doit jamais être interprétée comme une v1. Après création de
données v3, ne pas revenir à une application incapable de les lire et de les figer.

## Unités de données

- Les montants sont des entiers de centimes ; les taux sont en points de base
  (`2000 = 20 %`). La saisie monétaire passe par [money.ts](../../src/lib/money.ts).
- Les devis portent une devise. Une conversion d'unité d'achat ne constitue pas
  une conversion monétaire ; ne pas mélanger des prix de devises différentes.
- Les nœuds sont des `section` ou des `line`. Les noms « Lot », « Chapitre » et
  « Ouvrage » sont des libellés de profondeur ; les ouvrages réutilisables sont
  des objets distincts. Voir [hierarchy.ts](../../src/lib/estimates/hierarchy.ts).
- En v3, `unit_code`, `pricing_status` et `h_mo*_per_unit` sont explicites.
  Les heures totales `h_mo*` sont dérivées de la quantité, à trois décimales.
  En v1/v2, l'unité est historiquement portée par `description` et `h_mo*`
  représente les heures de la ligne : ne pas appliquer les formules v3 à ces données.

## Moteur 3

Le calcul utilise des décimaux exacts et un arrondi au centime au demi supérieur,
aux étapes ci-dessous. `arrondi` ne signifie pas un plafond systématique.
Le dépassement de `2 147 483 647` centimes lève
`ESTIMATE_AMOUNT_OVERFLOW` : aucun écrêtage silencieux en v3.

Pour une ligne `priced`, avec `Q` la quantité, `P` le prix d'achat FO en centimes,
`h` les heures par unité et `t` le taux horaire :

```text
FO_unitaire = P × provision_FO × k_fo
MO_unitaire = h_mo_majoration × h × t × k_mo
PU_vente = arrondi(FO_unitaire × coefficient_FO + MO_unitaire × coefficient_MO)
brut_ligne = arrondi(Q × PU_vente)
déboursé_ligne = arrondi(Q × (FO_unitaire + MO_unitaire))
```

La **provision FO** (TI-534 : pertes, chutes, transport des tubes) est stockée
sur la ligne (`estimate_items.fo_provision`, 3 décimales, entre 1 et 2). Une ligne
v3 la reçoit à sa création depuis son type FO (`supply_types.default_fo_provision`) :
1,030 pour les types FO Tube, Calorifuge et Isolant (valeurs posées par la
migration), 1,010 pour tout autre type, pour un type créé ensuite et pour une
ligne sans type. Un changement de type FO la redérive ; aucune
autre écriture ne la touche, si bien que sauvegarde, réouverture, duplication et
copie ne la cumulent jamais. Modifier la valeur d'un type ne change aucune ligne
existante. Les lignes antérieures, les sections et les lignes v1/v2 gardent 1,000 :
aucun montant existant ne change. Le déclencheur
`private.derive_estimate_item_fo_provision` pose la valeur ; les projections
calculées avant l'écriture (lot, création atomique, création de devis, éditeur)
appliquent le même miroir ([fo-provision.ts](../../src/lib/estimates/fo-provision.ts)).
La provision fait partie de l'entrée canonique et du gel ; elle figure dans les
exports DPGF (« Données ») et CSV, avant K FO. Le contrôle D11 de l'import
compare le PU du classeur à la lecture de ses colonnes, avant provision : il
vérifie l'interprétation du fichier, pas le prix créé.

Si la ventilation atelier/chantier est activée et renseignée, la MO unitaire
additionne les deux couples heures/taux/coefficient avant la majoration. Une
ligne non `priced` (`included`, `for_memory`, `not_priced`, `out_of_scope`,
`not_applicable`) contribue zéro aux montants et ne possède pas de PU calculé.
Cela ne la rend pas automatiquement prête à l'émission : le gel applique ses
propres contrôles de complétude, d'unité et de taux.

Le pied suit cet ordre :

1. Somme des bruts de ligne.
2. Remise en **montant ou en taux**, intentions exclusives, plafonnée au brut.
3. Arrondi commercial facultatif `down` : réduction HT jusqu'au multiple du pas.
   Le mode `none` n'applique aucune réduction supplémentaire.
4. Répartition exacte de remise + arrondi sur les lignes, puis ventilation FO/MO
   et atelier/chantier. Le départage des restes est déterministe.
5. TVA arrondie **par groupe de taux** sur les bases nettes, puis répartie sur
   les lignes du groupe. TTC = HT net + TVA ; pas d'arrondi TTC supplémentaire.

Invariants : somme des nets = HT du pied ; somme des TVA de ligne = TVA du pied ;
FO + MO = net de ligne ; atelier + chantier = MO ; aucun net négatif ou supérieur
au brut. Une incohérence bloque le résultat.

Sources d'autorité : [line.ts](../../src/lib/estimates/engine-v3/line.ts),
[breakdown.ts](../../src/lib/estimates/engine-v3/breakdown.ts),
[discount.ts](../../src/lib/estimates/engine-v3/discount.ts),
[tax.ts](../../src/lib/estimates/engine-v3/tax.ts),
[jumeau SQL](../../supabase/migrations/20261017134443_estimate_engine_v3_functions_and_units.sql),
[provision FO](../../supabase/migrations/20261024142907_estimate_fo_provision.sql).

## Compatibilité des moteurs 1 et 2

Le moteur historique reste dans
[estimate-calculations.ts](../../src/lib/estimate-calculations.ts).
Son coût de ligne combine `Q × prix_FO × k_fo` et les heures **totales** de MO ;
la vente applique ensuite un multiplicateur de marge fixe ou choisi par paliers,
puis le coefficient global et la remise. Les modes de remise simple/cascade et
les arrondis historiques restent propres à ce contrat.

La v1 conserve son comportement de totalisation et de TVA au taux de version.
La v2 réalloue les ajustements aux lignes, applique leur taux de TVA avec repli
sur celui de la version, et impose `matchesFooter` avant persistance/gel.
Ces moteurs comportent encore des règles d'arrondi et de plafonnement distinctes
de la v3. Ne pas les « harmoniser » au passage d'une autre modification.

## Marge et TVA

Le **taux de marque** est `(vente − coût) / vente` ; le taux de marge est
`(vente − coût) / coût`. Ce ne sont pas des valeurs interchangeables.

[effective-margin.ts](../../src/lib/estimates/effective-margin.ts) gouverne les
règles d'approbation et le pilotage : v1 conserve son contrat historique ; v2
privilégie le multiplicateur réellement figé ; v3 utilise le HT net et le
déboursé total d'une preuve vivante liée à la version ou d'un snapshot frais.
Sans preuve v3 valide, ou pour un HT nul, la marque est indisponible (`null`),
jamais déduite arbitrairement d'un coefficient.

Le choix explicite `contractor_role = subcontractor` active l'autoliquidation :
TVA calculée à zéro et présentation contractuelle adaptée. Ne pas l'inférer du
client ou d'un taux saisi. Le moteur v3 conserve des bases par taux mais la
présentation masque la TVA en autoliquidation. Cette règle applicative ne couvre
pas à elle seule toutes les situations fiscales d'une entreprise.

## Snapshots et vérification

Les brouillons sont recalculables ; avant revue ou émission, les moteurs 2 et 3
figent le contexte et les montants sous contrôle de révision. Une modification
ultérieure invalide la fraîcheur du snapshot. Les documents émis relisent les
données figées, sans réappliquer les tarifs ou flags actuels.
Voir [cycle-de-vie.md](cycle-de-vie.md).

Pour une modification de calcul, sélectionner les cas concernés dans
[engine-v3](../../src/lib/estimates/engine-v3/), le
[corpus historique](../../src/lib/estimates/engine-frozen-corpus.test.ts), les
[tests SQL](../../supabase/tests/database/) et les
[parcours v3](../../e2e/army/local/). Leur présence ne vaut pas exécution.
Le [guide CI](../testing/tester-army-ci.md) décrit les commandes et protections.
