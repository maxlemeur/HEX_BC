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

Le **K FO unique** (TI-534) intègre les pertes, le transport et l’ajustement de
volume ; l’utilisateur peut y intégrer d’autres éléments prévus pour son
chiffrage. Les nouvelles lignes v3 portent `fo_provision = 1` : aucun second
coefficient visible ne double ces frais. Les bases entreprise initiales, paramétrables par type de fourniture, sont 1,13 pour les
tubes (10 % de pertes + 3 % de transport), 1,02 pour les autres familles et
les lignes sans type. Les pertes des tubes ne se reportent pas aux raccords,
supports ou calorifuges. La préférence du propriétaire de l’affaire remplace
la base entreprise ; une saisie manuelle sur la ligne est prioritaire, même
si elle vaut 1. La provenance est persistée dans `k_fo_manual`.

**POSE SEULE** (`line_nature = 'pose_only'`, TI-539/TI-541) : le K FO
initial automatique vaut **1**, sans pertes ni transport, y compris avec une
petite fourniture de supportage. Ce défaut neutre prime sur la base de famille
et la préférence utilisateur ; un choix manuel sur la ligne reste prioritaire.
Le nom reste **K FO**. La transition vers/depuis POSE SEULE et l’actualisation
des lignes automatiques doivent respecter cette règle.

Exemples de fourniture validés par Maxime le 11/11/2026, avant marge et
arrondis au centime : tube fonte Ø100 **142,43 × 1,13 = 160,95 €** ;
robinet DN 25 **58,43 × 1,02 = 59,60 €** ; pose seule WC
**175,50 × 1 = 175,50 €**. Le 1,13 est une base configurée, pas un
coefficient imposé au calcul quand le réglage du type de fourniture change.

Le volume est intégré dans ce coefficient : 1,13 × 0,90 = 1,017 et
1,13 × 0,95 = 1,0735. K FO conserve jusqu’à six décimales. Les pertes portent
sur la quantité arrondie : 100,40 m → 101 m → 111,10 m avec 10 % de pertes.
Cette dernière quantité reste interne ; la quantité facturée ne reçoit pas
les pertes. K FO ajuste uniquement la fourniture, avant marge.

« Actualiser les K FO automatiques » applique les bases courantes aux lignes
automatiques du brouillon. Les coefficients manuels restent conservés.
Les anciennes lignes dont la provenance est inconnue sont conservées par
prudence, y compris un coefficient neutre ; elles ne sont pas sélectionnées
par cette actualisation. Leur ancien produit K FO × provision reste affiché
comme un seul coefficient. La saisie explicite d’un nouveau K FO le remplace.
Les devis émis/scellés, leurs snapshots et leurs moteurs restent inchangés.

Les réglages se trouvent dans le profil : base entreprise administrateur et
préférence personnelle. Pour une affaire partagée, la préférence utilisée
est celle du propriétaire, quel que soit le collaborateur qui la modifie.
Le prix choisi conserve sa provenance et son traitement du transport
(`fo_price_origin`) : une mise à jour du catalogue ne remplace pas ce snapshot.
Un prix dont le transport est inclus ne le recompte pas ; ce cas reste
secondaire. Une copie de section conserve le snapshot de transport et son
absence connue ; la duplication d’une version conserve ses valeurs exactes.

Un **kit métier** est un ensemble d’articles et de quantités prédéfinies.
Chaque composant conserve son calcul et sa famille, mais sa décomposition
reste masquée dans le chiffrage et les documents client. Le total du kit
reste visible. Les assemblages insérés portent `source_metadata.kit_metier`.
Les exports de données internes conservent les composants.

Les projections TypeScript et le déclencheur SQL appliquent le même contrat
([fo-provision.ts](../../src/lib/estimates/fo-provision.ts)). Les exports de
données et CSV affichent un seul K FO, y compris pour les anciennes lignes.
Le contrôle D11 d’import compare les colonnes du classeur avant application
des paramètres courants ; il vérifie l’interprétation du fichier.

**Coût chantier** (TI-541) : une offre négociée pour un chantier se saisit sur la
ligne du devis, depuis son menu « … », avec sa source : fournisseur, référence de
l'offre, date, pièce éventuelle, et transport inclus ou non. Elle remplace la
base de la ligne pour ce devis seulement. C'est une troisième provenance
(`fo_price_origin.kind = "site"`), à côté de l'offre fournisseur et du prix de
référence du catalogue. Rien n'est écrit dans le catalogue : ni article, ni
offre, ni prix de référence, et la moyenne des offres ne la voit pas. L'article
de la ligne reste lié ; l'offre du catalogue retenue est retirée. La source reste
lisible après réouverture, copie de version et émission ; elle n'est jamais
imprimée sur le devis du client. Un transport inclus dans l'offre donne 1,010 aux
tubes, calorifuges et isolants, comme pour une offre du catalogue. Retaper le
coût à la main efface la source, puisqu'elle ne prouve plus la valeur. Choisir
ensuite un article ou une offre du catalogue la remplace. Détacher l'article, ou
le supprimer du catalogue, ne retire ni la source ni sa provision : la preuve du
coût est l'offre, pas le catalogue. La présélection des fournisseurs ne propose
rien sur une ligne à coût chantier. La copie d'une section vers un autre devis
emporte le coût et sa source ; la reprise de prix copie le prix sans sa source.
**POSE SEULE** (TI-539, TI-541) : une ligne POSE SEULE ne prend ni pertes ni
transport. Sa provision FO vaut 1,000 tant qu'elle garde cette nature, quel que
soit son type de fourniture, y compris sur la petite fourniture nécessaire à la
pose (supportage) qu'elle peut porter, saisie à la main ou en coût chantier. La
provision se redérive du type quand la ligne quitte POSE SEULE. Exemple : pose
d'un appareil à 150,00 €, 10 ens, coefficients à 1 : 150,00 × 1 = 150,00 €
l'unité, soit 1 500,00 € (et non 151,50 € l'unité avec 1,010). Source : réponse
de Maxime du 11 novembre 2026.

Le même menu écrit le **détail du coût de fourniture** de la ligne, facteur par
facteur : base et provenance, × provision FO, × K FO, = coût FO unitaire, puis
× coefficient de vente FO. Les produits sont ceux du moteur, sans arrondi
intermédiaire ; seul l'affichage est arrondi au centime
([fo-cost-detail.ts](../../src/lib/estimates/fo-cost-detail.ts)). K FO garde son
nom (décision M534-04 de TI-534) : c'est le coefficient manuel de la ligne sur
le seul coût de fourniture, avant marge. Exemple : référence 10,00 €, K FO 0,90,
provision 1,01 donne 9,09 € ; provision 1,03 donne 9,27 €. Le modifier ne change
ni la main-d'œuvre, ni la provision, ni le catalogue.

Si la ventilation atelier/chantier est activée et renseignée, la MO unitaire
additionne les deux couples heures/taux/coefficient avant la majoration. Une
ligne non `priced` (`included`, `for_memory`, `not_priced`, `out_of_scope`,
`not_applicable`) contribue zéro aux montants et ne possède pas de PU calculé.
Cela ne la rend pas automatiquement prête à l'émission : le gel applique ses
propres contrôles de complétude, d'unité et de taux, et une ligne `not_priced`
bloque l'envoi tant qu'elle n'est pas classée (TI-682, voir
[cycle de vie](cycle-de-vie.md#émission-et-pdf-contractuel)). Une ligne classée
après avoir été `not_priced` porte un motif interne (`status_reason`) avant
l'envoi ; ce motif ne change aucun montant et n'entre pas dans le sceau.

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
