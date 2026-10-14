# SITE-01B — Contrat de quantité, unité et édition

Décisions PO du 11 octobre 2026, avant modification applicative. Le
[cadrage](purchase-decimal-quantities-next-slice.md) conserve les écarts et
scénarios initiaux. Ce contrat ne constitue pas une preuve de livraison.

## Quantités et montants

Quantité strictement positive de 0,001 à 2 147 483 647, avec trois décimales
effectives au maximum, cohérentes avec le devis. PostgreSQL utilisera `numeric`
sans typmod et un CHECK de précision/bornes : un typmod `(13,3)` arrondirait une
entrée directe avant que le trigger puisse la refuser. Aucune troncature,
valeur invalide remplacée par un ou ligne renseignée silencieusement omise.

L'interface conserve une chaîne pendant la saisie, accepte virgule ou point
comme séparateur décimal et affiche l'erreur sans modifier le texte. L'API
canonique reçoit un nombre. Les séparateurs de milliers, expressions et
formats ambigus sont refusés. Les calculs utilisent des entiers à échelle
fixe ou une arithmétique décimale exacte : HT de ligne arrondi au centime le
plus proche (demi-centime positif vers le haut), TVA arrondie sur ce HT,
TTC = HT + TVA. Totaux = somme des lignes arrondies. Les centimes restent
entiers et dans leur plage de stockage historique.

## Unité et origine

Chaque nouvelle ligne d'achat porte `unit` et `price_unit`. Une préparation
depuis devis conserve les unités réellement relues ; une ligne manuelle
déclare l'unité du besoin et du prix identiques. Aucun coefficient implicite.
Les champs de source et `price_unit` ne sont pas mutables depuis le payload.

Pour les commandes antérieures, seule une preuve prise lors de la préparation
peut renseigner l'unité automatiquement. Sinon elle reste nulle et apparaît
« unité à confirmer ». La sauvegarde d'une note n'exige pas d'inventer cette
unité. Corriger quantité ou prix exige sa confirmation explicite, historisée.
Une unité déjà connue sur une ligne sourcée reste figée ; une conversion de
conditionnement nécessite son propre workflow et sa source.

## Édition stable et concurrente

Les lignes existantes sont identifiées par leur `id` persistant, jamais par
égalité de désignation/prix. Produit, référence et unité omis sont conservés.
Les champs obligatoires de quantité, désignation, prix et TVA restent validés.
Une ligne nouvelle n'envoie pas d'identifiant existant. Doublons et identifiants
d'une autre commande sont refusés. Le remplacement complet de lignes ne perd
pas l'origine des lignes conservées.

Les corrections de quantité/prix sont possibles en brouillon : elles conservent
l'identité et la provenance, et produisent un événement privé append-only avec
avant/après, acteur et date. Le reçu initial et la quantité initialement
transférée restent immuables ; une réduction ou suppression ne libère pas
automatiquement le besoin. La trace doit être consultable par un utilisateur
autorisé, avec des libellés métier.

`purchase_orders.edit_revision` est un entier monotone de 0 à
9 007 199 254 740 991, exact en JSON. Il change lors d'une modification d'en-tête
ou de ligne, y compris les écritures directes autorisées. L'édition charge
en-tête et lignes dans une même lecture et conserve le jeton de cette lecture
pendant la saisie. Toute mutation exige `expectedRevision` ; un décalage produit
409, sans perte ni retry automatique. L'ancien overload RPC sans jeton n'offre
pas de contournement.

## Contrats de service

- `create_purchase_order_draft(p_header, p_items)` : transaction unique, retourne
  `{id,reference,edit_revision}`. Le POST HTTP conserve son succès historique
  200. Cette création manuelle n'est pas encore idempotente ; ne pas lui
  attribuer la reprise de SITE-01A.
- `replace_purchase_order_draft(p_order_id, p_header_patch, p_items,
  p_expected_revision)` : retourne `{id,edit_revision}` ; le PUT retourne
  `{success:true,id,editRevision}`. Un `p_items` nul ne remplace aucune ligne.
- `get_purchase_order_item_history(p_order_id)` : projection privée autorisée
  des événements. GET `/api/purchase-orders/{id}/history` retourne
  `{ok:true,data:{events:[...]}}`.

Les items JSON utilisent `id?`, `product_id?`, `reference?`, `designation`,
`quantity`, `unit?`, `unit_price_ht_cents`, `tax_rate_bp`. L'API HTTP garde les
alias camelCase habituels. Les erreurs de révision sont des conflits ; les
erreurs de quantité, montant, unité et structure sont des diagnostics de
validation. Aucun détail SQL brut n'est rendu au navigateur.

Préservation de l'atomicité, de l'idempotence et des réservations de SITE-01A.
Les quantités et unités doivent également survivre aux listes, relectures et
exports CSV/XLSX/HTML/impression. L'import suit le contrat DPGF existant.
La matrice complète d'import, les achats partiels, les réceptions quantitatives,
les reliquats, les conversions et l'activation partagée restent des exigences
du goal, sans être déclarés réalisés par une migration de quantité.


## Fermetures issues de la revue avant qualification

Une commande issue du devis conserve son fournisseur : changer ce fournisseur
sans revue des conditions détournerait l'origine de l'achat. Le contrôle utilise
également le registre privé lorsque les FK ou les lignes ont été supprimées.
Les nouveaux achats issus du devis conservent le produit de l'offre relue.
La casse `mL` ne doit pas être confondue avec l'alias catalogue `ml` du mètre
linéaire ; aucun volume n'est converti implicitement en longueur.

Les exports CSV/XLSX relisent en-tête et lignes dans un même snapshot. La
projection JSON sous les droits de l'appelant évite le plafond silencieux des
lectures tabulaires à 1 000 lignes. Au-delà de 10 000 lignes sélectionnées,
le téléchargement est refusé avec un message ; aucun fichier partiel n'est
produit. Un identifiant sélectionné devenu inaccessible fait également échouer
l'export. Les fichiers de pièces jointes du ZIP restent un sujet distinct de
la fidélité de son HTML de commande.

Les écritures directes doivent relire le statut après acquisition du verrou
parent, y compris DELETE. Une RLS ayant observé un brouillon avant une attente
ne suffit pas à permettre une modification après passage en statut envoyé.
