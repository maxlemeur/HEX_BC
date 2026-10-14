# Catalogue : suites de l'audit d'intégrité

Relevé du 11 octobre 2026 sur `main`, base source
`ce5874f54f8202297b74e4ed238e5c48e49d2f1b` avec changements locaux des tranches
en cours. Ces points complètent [PRICE-02/PRICE-03 et FND-04](backlog-chiffrage-2026-10-11.md).
Ils ne sont pas des incidents observés sur la base partagée. Les statuts
ci-dessous distinguent les hypothèses et les corrections qualifiées localement.
L'inspection a porté sur les sources et migrations citées, pas sur les données
ou le schéma partagé. CAT-F01 a ensuite été reproduit sur la base native
strictement locale, avec annulation intégrale décrite ci-dessous. Les autres
scénarios restent à exécuter.

Le traitement de l'offre nulle dans la moyenne et la borne inclusive des six
mois font l'objet de la tranche PRICE-02 en cours ; ils ne sont pas dupliqués
ici. Les prix des anciens devis et les références humaines validées doivent
rester inchangés pendant les suites ci-dessous.

## CAT-F01 — Contrôler la provenance du chemin d'update historique

**Priorité : P1. Statut : correction réalisée et qualifiée en SQL natif,
HTTP et import CSV sur la base locale isolée ; activation partagée non réalisée.**

`POST /api/prices`, `action: "update"`, accepte `source_import_id` et
`source_mapped_row_id` et les transmet à un UPDATE direct
(`src/lib/catalogue/schemas.ts:282`, `:283`, `:339` ;
`src/lib/catalogue/server.ts:1620`, `:1621`). Les RPC de création et de bulk
vérifient le tenant de l'import et de sa ligne, ainsi que l'appartenance de la
ligne à l'import lorsqu'ils sont tous deux fournis
(`supabase/migrations/20260714181702_add_supplier_catalog_price_rpcs.sql:46` ;
`20260714181641_add_supplier_catalog_items.sql:324`). Le chemin d'update lu
ne contient pas ces vérifications. Les clés étrangères initiales portent les
IDs seuls (`014_catalogue_pricebook_indices_s4.sql:18`). `update-offer`
exclut déjà ces champs du schéma (`schemas.ts:395`).

**Défaut reproduit localement :** un éditeur peut associer son offre à un import
inaccessible ou à une ligne d'un autre import. Une FK valide ne prouve pas
l'autorisation ni la cohérence métier. Ce constat ne démontre pas un accès
aux contenus d'un autre tenant ni une exploitation en production.

**Scénarios avant code :** dans une base isolée, préparer deux tenants et
leurs comptes dédiés, une offre ARMY du tenant A, deux imports A1/A2 avec leurs
lignes et un import B1 appartenant à B. Connexion ordinaire en A puis :

1. `action: "update"` sur l'offre A avec `source_import_id=B1` : refus et offre,
   historique et référence inchangés.
2. Import A1 + ligne A2 : refus sans mutation ; A1 + sa propre ligne : succès
   avec provenance relue dans le même tenant.
3. Changement partiel d'un seul identifiant : cohérence vérifiée contre
   l'autre identifiant déjà enregistré ; effacement explicitement permis ou
   refusé selon le contrat choisi, jamais une association incohérente.
4. Reproduire les écritures directes par Data API avec la session ordinaire
   lorsque les privilèges les autorisent : l'invariant ne doit pas dépendre
   exclusivement d'un écran ou d'un handler.

Conserver réponses HTTP, état avant/après et identités sans jetons. Si un
trigger plus récent empêche déjà le scénario, documenter cette preuve et
clore le risque sans ajouter un second mécanisme inutile. Aucun changement
de rôle réel ou test inter-tenant sur données métier partagées.

**Reproduction exécutée le 11 octobre 2026 à 03:21 UTC.** Après inspection
des contraintes, politiques RLS et sept triggers de `supplier_pricebook`
installés, le probe a ciblé exclusivement `http://127.0.0.1:59827`, stack
`/home/tanuki/.local/share/miaouffrage-article-qa/run-dcfb206a1136`. L'acteur
fixture `144a008d-1b55-4f10-a60d-fb5c3eee4e2e` a exécuté les UPDATE sous le
rôle SQL effectif `authenticated`, avec claims simulés : admin du tenant
`35b48ad7-774a-4b31-9356-64387f3c2520`, **pas administrateur global**.
L'offre ARMY existante était `7e5e9d84-e85b-4ee6-9dff-7c3e4d66e76d`.

Les six cas qui auraient dû être refusés ont tous affecté une offre et créé
une entrée d'historique dans leur sous-transaction : import inter-tenant,
ligne seule inter-tenant, paire inter-tenant, paire A1/ligne A2, changement
partiel d'import, changement partiel de ligne. L'import et la ligne du tenant
B étaient invisibles à cet acteur. Les quatre témoins ont été acceptés :
paire cohérente, ligne seule du même tenant, import seul du même tenant et
effacement des deux identifiants. Le produit et son journal de validation
sont restés inchangés dans les dix cas.

Chaque sous-cas a vérifié sa propre annulation. Le CLI refusant un fichier
SQL à plusieurs instructions préparées, le probe utilise un unique `DO`
terminé volontairement par l'exception `P9001`, ce qui annule la transaction
implicite entière. La première tentative de préflight refusée est conservée.
Une connexion distincte après le probe a confirmé **zéro tenant, import,
ligne, feature flag ou règle nouvellement persisté**, l'offre et le produit
strictement identiques à l'état initial, les sept historiques préexistants
inchangés en nombre et aucune validation supplémentaire. Aucune appartenance
ni aucun rôle réel n'a été modifié.

Preuves locales dans `.e2e/catalogue-provenance/` :

- `2026-10-11T03-16-12-569939Z-inspect.json` : schéma, RLS, triggers et fixture.
- `2026-10-11T03-21-53-298872Z-reproduce.json` : attentes, résultats et états
  avant/après des dix cas ; SHA256
  `6bd3a9491a64467933c4e6ef22aac27b1653e221fcd6f58d8608deb33aa6f27c`.
- `2026-10-11T03-22-31-330169Z-verify.json` : contrôle indépendant de rollback ;
  SHA256 `e73fe43eee6a5667cc289028d4fbc316a95b58e409eb3fbd590f4846cd5f41b1`.
- `checked-summary.json`, son SHA256 et les manifests : commandes exactes,
  révision, changements locaux, cibles, sources et hachages revérifiés par
  `node .e2e/catalogue-provenance/check-proof.mjs`.

Cette preuve utilise une authentification SQL simulée. Elle ne démontre ni
un parcours HTTP/API exploité ni la lecture du contenu d'un autre tenant.
Aucune donnée partagée ou distante n'a été interrogée ou modifiée.

**Correction locale vérifiée ensuite.** La migration
`20261011080708_supplier_price_provenance_integrity.sql` ajoute quatre FK
composites validées et trois clés uniques parentes. Elle couvre aussi le
déplacement ultérieur d'une ligne ou le changement de tenant d'un import.
Un trigger sous droits de l'appelant contrôle la visibilité et les valeurs
finales après résolution du tenant ; les effacements et cascades restent
permis. Le préflight arrête une base incohérente sans réparer ses données.
Les huit tables métier contrôlées, leurs droits, RLS et fonctions antérieures
sont inchangés à l'application locale.

Les 40 cas SQL passent, ainsi que les six refus HTTP, les cinq mutations
légitimes et les deux parcours d'import CSV DPGF. Les références approuvées
restent inchangées. Trois conflits entre connexions passent aussi, avec
blocage observé et reprise après rollback. Détails, RED/GREEN et limites dans [la recette SQL](../testing/catalogue-provenance-sql.md)
et [la recette HTTP](../testing/catalogue-provenance-e2e.md). L'ancien constat
SQL ci-dessus n'est pas une preuve HTTP ; cette preuve complémentaire provient
de la campagne du `2026-10-11T08-12-11-132Z` avec connexion ordinaire.

La Data API directe avec session HTTP, l'ensemble de la matrice de rôles,
XLS/XLSX/PDF et les données partagées ne sont pas qualifiés par cette campagne.

## CAT-F02 — Conserver la provenance dans la projection de référence

**Priorité proposée : P2. Statut : perte de projection établie par lecture ;
parcours réel à qualifier.**

La RPC de proposition retourne `source_import_id`, `source_mapped_row_id` et
`notes` (`20260906145000_supplier_reference_price_proposals.sql:157`).
`referenceOfferSchema` ne déclare pas ces propriétés
(`src/lib/catalogue/reference-price-schemas.ts:37`) ; le `.parse(data)` du
serveur (`reference-price-server.ts:29`) les retire avant la réponse API.
La proposition conserve l'identité fournisseur et les dates, mais ne transmet
pas ces éléments de provenance au client. Aucun lien documentaire perdu n'a
été observé dans une recette exécutée pour ce relevé.

**Scénarios avant code :** créer une offre ARMY issue d'un import réel et
d'une ligne identifiée. Relire `GET /api/catalogue/reference-price`, ouvrir la
provenance depuis l'interface puis valider le prix ; vérifier l'origine et le
snapshot retenus après rechargement et changement ultérieur de l'offre.
Rejouer avec une offre manuelle sans import : afficher cette absence, sans
source de remplacement. Les notes libres et le lien d'import restent des
informations associées, pas des citations certifiées.

La projection ne devra exposer que les données autorisées au lecteur. Qualifier
CAT-F01 avant de traiter un identifiant de provenance stocké comme fiable.
Toute évolution du contrat API doit mettre à jour et valider OpenAPI.

## CAT-F03 — Définir le sens de `valid_from: null` lors d'une modification

**Priorité proposée : P2. Statut : divergence statique de contrat ; décision
et reproduction requises.**

Le schéma de modification accepte null et chaîne vide pour `valid_from`
(`src/lib/catalogue/schemas.ts:79`, `:351`). L'update historique transforme
null en champ omis et conserve le début enregistré (`server.ts:1615`).
L'update d'offre atomique transmet null au RPC, lequel l'affecte à la colonne
NOT NULL (`20261002160807_supplier_offer_atomic_edit.sql:62` ;
`014_catalogue_pricebook_indices_s4.sql:15`). Ces deux écritures ne portent
donc pas la même intention.

**Décision proposée :** en modification, un champ omis conserve sa valeur ;
effacer une date de début obligatoire produit une erreur explicite. Ne pas
rafraîchir une offre en la redatant silencieusement au jour courant.
Conserver le contrat déjà annoncé de `valid_to: null` : recalcul à six mois
du début enregistré, tandis que `valid_to` omis reste inchangé.

**Scénarios avant code :** même offre ARMY sur les actions `update` et
`update-offer` ; tester début omis, null, vide et nouveau début seul ; fin
omise, null, fin courte, borne exacte, borne + un jour et fin avant début.
Vérifier les dates relues, les motifs d'erreur et l'absence de mutation
partielle des références/URL fournisseur lorsque la validité échoue.
La création sans début conserve son contrat distinct de début au jour de
création. Les cas de fin de mois doivent utiliser un oracle calendaire.

## CAT-F04 — Rendre explicites les limites des imports de tarifs

**Priorité proposée : P1 pour préserver les dates, P2 pour harmoniser le
traitement du zéro. Statut : capacités actuelles identifiées ; parcours et
évolution à cadrer dans PRICE-03.**

L'import CSV générique ne mappe que fournisseur, produit, prix et devise
(`src/lib/catalogue/csv-import.ts:10`). Il produit `valid_from:null` et
`valid_to:null` (`:961`), ensuite complétés par la période par défaut au jour
d'import. Il ne préserve donc pas la validité d'une offre historique présente
dans un fichier. Le modèle XLSX conserve `date_prix` comme début mais calcule
systématiquement la fin à six mois (`product-price-template-server.ts:330`),
sans colonne de fin plus courte dans le contrat lu.

Les prix nuls sont rejetés par le CSV (`csv-import.ts:929`) et le modèle XLSX
(`product-price-template-server.ts:33`), alors que la création d'offre les
accepte. Ce rejet est explicite ; il ne faut pas le qualifier de suppression
silencieuse. L'arbitrage utilisateur impose l'exclusion du zéro du calcul de
référence avec clarification. Le choix d'importer cette offre avec réserve,
ou de la laisser en erreur actionnable, reste à rendre cohérent dans le
parcours d'import.

**Scénarios avant code :**

1. CSV/XLSX avec un tarif déjà expiré, un tarif valide à fin courte et un tarif
   sans dates : aperçu montrant dates retenues et hypothèses ; aucune
   prolongation silencieuse d'une offre expirée ou de validité plus courte.
2. Données comprenant 10 €/m, 11 €/m et 0 €/m : zéro visible comme erreur ou
   offre à clarifier selon le contrat adopté ; jamais inclus dans la moyenne
   et jamais perdu sans compte rendu. Les deux offres positives restent
   importables selon les règles d'exclusion de lignes.
3. Annulation de l'aperçu sans écriture ; rejet d'une borne excessive ;
   conservation de la référence déjà validée ; réimport sans duplication
   arbitraire ; historique et provenance de chaque ligne retenue vérifiables.

Un import PDF/XLSX réussi ailleurs ne qualifie pas ces contrats de dates et
de prix. Conserver fichiers de fixture, résultats d'aperçu, lignes rejetées,
réponses d'écriture et état persistant relu dans l'artefact E2E.
