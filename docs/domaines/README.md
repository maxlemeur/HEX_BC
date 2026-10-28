# Parcours et repères du code

MergeOne organise le chiffrage d'une affaire, de ses pièces d'entrée à l'offre
client et à la préparation des achats. Cette carte est relue sur le code le
23 octobre 2026 ; elle ne prouve pas l'activation des fonctions en production.
Les contrats transverses sont les [calculs](../metier/regles-de-calcul.md), le
[cycle de vie](../metier/cycle-de-vie.md) et la
[sécurité](securite-multi-tenant.md).

## Affaire, pièces et import

L'affaire regroupe versions de devis, pièces déposées et registre de questions,
hypothèses ou documents manquants. L'intake classe les pièces et prépare leur
exploitation ; le registre conserve les décisions humaines et les points à
résoudre avant émission. Voir [affaires](../../src/lib/affaires/), notamment
`intake-server.ts`, `register-server.ts` et `finish-line-server.ts`.

Le parcours DPGF est `dpgf_rows_raw → mappings → confirmUnifiedImportFlow`.
Il accepte CSV, classeurs Excel et PDF tabulaires via leurs parseurs dédiés.
Les données brutes et la provenance restent disponibles ; la confirmation
normalise la structure et les valeurs avant la création atomique. En v3, les
unités, heures par unité, statuts et coefficients doivent suivre le contrat du
moteur. Ne pas assimiler les heures de ligne importées à des heures par unité.

Sources : [imports](../../src/lib/imports/),
[mappings](../../src/lib/mappings/server.ts),
[confirmation](../../src/app/dashboard/affaires/_actions/import-flow.ts),
[normalisation](../../src/lib/affaires/import-flow.ts),
[coefficients d'import](../../src/lib/affaires/import-engine-server.ts).

## Chiffrage et bibliothèque

L'éditeur manipule une arborescence de sections/lignes, leurs prix et quantités,
les réglages de version et les sources du chiffrage. La sauvegarde, les
conflits et l'historique sont coordonnés par les
[contrôleurs éditeur](../../src/hooks/) (`useEstimateEditor*`). Les délais
d'autosauvegarde sont définis dans
[useEstimateEditorSyncController.types.ts](../../src/hooks/useEstimateEditorSyncController.types.ts) ;
ils ne constituent pas une garantie de persistance avant confirmation serveur.

La saisie d'une cellule est sauvegardée par `editor-line-save.ts`, via le lot
atomique commun aux moteurs historiques et au moteur 3. Le contrat de réponse
`batch-contracts.ts` est partagé par le serveur, le client et OpenAPI : une
réponse incohérente conserve l'intention de sauvegarde pour vérification, sans
rejeu automatique. `editor-save-session.ts` possède l'état de la requête en
cours ; un changement de compte ou de version invalide sa capacité à modifier
l'éditeur. Les nouvelles saisies restent dans le tampon pendant cette requête.

La lecture d'un devis utilise le contrat commun
[editor-read-contracts.ts](../../src/lib/estimates/editor-read-contracts.ts), validé
par le serveur et le navigateur et repris par OpenAPI. Le
[contrôleur de lecture](../../src/hooks/useEstimateEditorReadController.ts) possède
le cycle des requêtes ; il écarte les réponses d'un ancien compte, tenant ou
devis, ainsi que les révisions plus anciennes que celle déjà confirmée.
[editor-read-snapshot.ts](../../src/lib/estimates/editor-read-snapshot.ts) prépare
les lignes et réglages sans effectuer d'écriture. Les correctifs historiques
éventuels sont mis en file uniquement après acceptation de cette lecture.
[editor-settings-state.ts](../../src/lib/estimates/editor-settings-state.ts)
conserve les champs modifiés localement lors de la fusion avec les réglages relus.

Pour les opérations de lignes, `server.ts` garde les exports publics et délègue
aux modules `item-create-server.ts`, `item-update-server.ts` et
`item-structure-server.ts`. Leurs plans purs portent les défauts, conversions,
calculs historiques et règles de hiérarchie ; `item-write-context.ts` rassemble
les lectures et contrôles partagés. Les orchestrateurs gardent l'ordre des
autorisations, verrous, contrôles de révision et écritures atomiques. Aucun module
d'opération ne doit réimporter la façade `server.ts`.

Templates, ouvrages de bibliothèque et ouvrages générés alimentent le devis
par des opérations de copie/application encadrées. Une modification de la
bibliothèque ne modifie pas rétroactivement une offre émise. Les capacités des
chemins d'entrée dépendent du moteur : consulter
[engine/capabilities.ts](../../src/lib/estimates/engine/capabilities.ts) et les
écrivains concernés dans [estimates](../../src/lib/estimates/).

La génération d'un **devis complet V0 par IA est désactivée** par
[isEstimateAiDraftEnabled](../../src/lib/estimates/ai-draft-availability.ts).
La [génération ponctuelle d'ouvrages](../../src/lib/estimates/generated-ouvrages.ts)
est un parcours distinct ; la présence de code V0 ne signifie pas que le produit
l'expose.

## Sources techniques et métré

Une référence CCTP est une copie immuable explicitement choisie. La couverture
relie des exigences et leurs citations vérifiées à des lignes de devis, des
composants appliqués ou des entrées du registre, avec un périmètre zone/réseau.
Plusieurs exigences peuvent partager une cible et inversement.

Une décision humaine conserve son motif, ses faits et son historique. Son
traitement (`priced`, `included`, `excluded`…) et sa validité (`unreviewed`,
`current`, `needs_review`) sont distincts. Un changement des dépendances
techniques exige une nouvelle vérification ; un prix seul ne prouve pas la
couverture. `partial`/`complete` qualifie l'exigence examinée, pas un pourcentage
d'exhaustivité du dossier.

Sources : [référence](../../src/lib/estimates/source-reference-orchestration.ts),
[contrat de couverture](../../src/lib/estimates/source-coverage-contracts.ts),
[serveur de couverture](../../src/lib/estimates/source-coverage-server.ts).

Le métré (`takeoff`) extrait des quantités de plans, puis les soumet à revue et
application contrôlée. Son activation dépend du tenant et des paramètres
d'environnement ; les niveaux A/B/C sont des modes d'extraction, pas une
garantie de justesse. Une cible v3 reçoit le métré comme une v2 : à
l'application, l'unité de chaque item passe par le référentiel des unités (une
unité inconnue refuse l'application, items nommés) et les montants sont ceux du
moteur 3 (migration `20261025134000_takeoff_apply_engine_v3`). Voir
[feature-flags.ts](../../src/lib/takeoff/feature-flags.ts),
[server.ts](../../src/lib/takeoff/server.ts) et
[processor.ts](../../src/lib/takeoff/processor.ts).

La création d'un métré depuis un upload ou un jeu de plans est orchestrée par
[job-creation-server.ts](../../src/lib/takeoff/job-creation-server.ts).
[job-creation-input.ts](../../src/lib/takeoff/job-creation-input.ts) prépare les
entrées et identités déterministes ;
[job-creation-repository.ts](../../src/lib/takeoff/job-creation-repository.ts)
porte les accès, le stockage et les compensations. Le rejeu conserve l'identité
du job et ne répète pas ses effets. Une erreur métier transitoire conserve son
indicateur `retryable` ; cet indicateur ne déclenche aucune relance automatique.

## Catalogue et achats

Le catalogue porte produits, fournisseurs et offres tarifaires avec leur
provenance. Le prix de référence produit peut provenir du dernier achat validé
(commande confirmée ou reçue), avec repli manuel ; une offre tarifaire reste
distincte du prix négocié sur un devis. Voir [catalogue](../../src/lib/catalogue/)
et la [règle de synchronisation](../../supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql).

La préparation d'achats depuis un devis exige une revue des lignes et de leur
empreinte avant création. Elle utilise une clé d'idempotence et un reçu durable :
après une issue réseau incertaine, relire le reçu avant de retenter. Le registre
des transferts protège contre une seconde commande des mêmes lignes, y compris
après annulation ou suppression de la commande cible.
Voir [purchase-order-drafts.ts](../../src/lib/estimates/purchase-order-drafts.ts).

Les quantités de commande sont positives et acceptent au plus trois décimales
effectives. L'identité des lignes et l'unité connue sont conservées ; les mises
à jour utilisent une révision attendue et renvoient un conflit `409` si elle a
changé. Voir [quantities.ts](../../src/lib/purchase-orders/quantities.ts) et
[write.ts](../../src/lib/purchase-orders/write.ts).

Une offre peut définir **explicitement** une conversion entre unité du devis
et unité d'achat, son facteur et un arrondi de conditionnement. La quantité
achetée et le prix associé sont alors calculés ensemble. Ce n'est pas une
conversion libre implicite entre libellés d'unités.
Voir [supplier-offer-purchase-unit.ts](../../src/lib/estimates/supplier-offer-purchase-unit.ts).

## Sorties et vocabulaire

PDF, impression, exports et portail doivent suivre le moteur et les montants
figés de la version. L'email initial et ses reprises utilisent une outbox ;
voir le [cycle de vie](../metier/cycle-de-vie.md). Les exports DPGF sont dans
[dpgf-export.ts](../../src/lib/estimates/dpgf-export.ts) et les adaptateurs v3
dans [v3-export.ts](../../src/lib/estimates/v3-export.ts).

| Terme | Sens dans le produit |
| --- | --- |
| Affaire | Dossier regroupant pièces, registre et versions de devis. |
| DPGF | Décomposition du prix global et forfaitaire, importée puis chiffrée. |
| CCTP | Cahier des clauses techniques particulières servant de référence technique. |
| FO / MO | Fournitures / main-d'œuvre. |
| Déboursé | Coût direct calculé avant coefficients de vente ; voir les règles du moteur. |
| Snapshot / sceau | Données de calcul figées / empreinte d'intégrité de l'offre. |
| Variante | Alternative de chiffrage ; ne vaut pas avenant contractuel. |
