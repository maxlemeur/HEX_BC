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

Le [document de l'éditeur](../../src/lib/estimates/editor-document-state.ts)
possède la référence serveur, les intentions locales et les opérations
optimistes. [useEstimateEditorDocument](../../src/hooks/useEstimateEditorDocument.ts)
expose le même instantané au rendu et aux contrôleurs ; leurs références ne sont
pas un second stockage. Les accusés de sauvegarde ne retirent que les intentions
envoyées, et un rollback ne remplace pas une saisie plus récente. Les opérations
et callbacks portent l'identité acteur/tenant/devis et la génération de visite.
La synchronisation possède le réseau et sa cadence ; textes de saisie,
dialogues, sélection et surbrillance restent des états visuels locaux.

Les [brouillons persistés](../../src/lib/estimates/editor-document-drafts.ts)
vérifient cette identité avant restauration. Les anciens brouillons sans auteur
restent dans le stockage mais ne sont plus restaurés automatiquement : leur
propriétaire ne peut pas être établi. Cette situation est signalée dans l'éditeur.

Pour les opérations de lignes, `server.ts` garde les exports publics et délègue
aux modules `item-create-server.ts`, `item-update-server.ts` et
`item-structure-server.ts`. Leurs plans purs portent les défauts, conversions,
calculs historiques et règles de hiérarchie ; `item-write-context.ts` rassemble
les lectures et contrôles partagés. Les orchestrateurs gardent l'ordre des
autorisations, verrous, contrôles de révision et écritures atomiques. Aucun module
d'opération ne doit réimporter la façade `server.ts`.

Les opérations de version suivent cette organisation :
[création et variantes](../../src/lib/estimates/version-creation-server.ts),
[réglages](../../src/lib/estimates/version-settings-server.ts),
[cycle de vie](../../src/lib/estimates/version-lifecycle-server.ts) et
[sceaux](../../src/lib/estimates/version-seal-server.ts) délèguent leurs règles
pures aux plans correspondants. Les contrôles de totaux sont distincts de leur
journal d'audit. La façade conserve les exports publics ; elle ne possède plus
l'orchestration de ces opérations. Le retour d'un bulk vide conserve son rôle
de contrôle d'accès, de verrou et de révision avant toute résolution du moteur.

La copie de sections et l'import DPGF suivent la même séparation : plans purs
(`section-copy-plan.ts`, `linked-dpgf-plan.ts`), lectures paginées, puis
orchestration dans `section-copy-server.ts` et `linked-dpgf-import-server.ts`.
Le recalcul partagé est dans `version-recalculation-server.ts`. Les contrats
[sections](../../src/lib/estimates/section-copy-contracts.ts) et
[DPGF](../../src/lib/estimates/linked-dpgf-contracts.ts) sont validés avant la
confirmation côté client et documentés dans OpenAPI. Une réponse incohérente
après écriture bloque une seconde mutation jusqu'à une relecture explicite ;
elle ne déclenche pas de nouvelle écriture automatique.

Les [contrats de mutation](../../src/lib/estimates/write-response-contracts.ts)
décrivent aussi les lignes et versions persistées, sans la jointure projet
réservée à la lecture de l'éditeur. Ils valident les réglages, les opérations
de lignes, les statuts, les nouvelles versions, les événements et les sceaux
avant acquittement. Le compteur d'un bulk peut inclure toutes les lignes
recalculées ; il n'est pas remplacé par la taille de la requête. Un sceau
invalide reste un résultat de vérification, y compris si son empreinte stockée
est corrompue.

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

Les suggestions de prix utilisent
[price-suggestion-preparation.ts](../../src/lib/takeoff/price-suggestion-preparation.ts)
pour les conversions, empreintes et règles de sélection,
[price-suggestion-repository.ts](../../src/lib/takeoff/price-suggestion-repository.ts)
pour les accès aux données, et
[price-suggestion-server.ts](../../src/lib/takeoff/price-suggestion-server.ts)
pour l'orchestration. Le [contrat partagé](../../src/lib/takeoff/price-suggestion-contracts.ts)
vérifie notamment la ligne, le job, la version et l'état de revue. Une suggestion
relue à l'identique est réutilisée ; son renouvellement reste explicite. Un reçu
incohérent après mutation exige une relecture, sans compensation aveugle.

La [comparaison DPGF](../../src/lib/takeoff/dpgf-comparison-server.ts) partage un
[contexte autorisé](../../src/lib/takeoff/dpgf-comparison-context-server.ts)
limité à la requête. Les lectures paginées ne réacquièrent pas leurs sources à
chaque page. Seules les preuves des lignes de la page sont synchronisées ; le
résumé du dossier ne produit aucune preuve. Le
[panneau de preuves](../../src/lib/takeoff/line-evidence-server.ts) filtre sa
sélection avant de résoudre le fichier source. Empreintes et plans de
remplacement sont purs, avec une horloge fournie ; le repository garde les IO.
Les contrats communs de comparaison et de preuves préservent la provenance
reportée, les curseurs opaques et l'historique. La réponse de comparaison est
validée après son enrichissement par les risques.

Le [radar](../../src/lib/takeoff/risk-radar-server.ts) sépare la projection pure,
les accès et la synchronisation. Une alerte conserve sa décision humaine lors
d'une actualisation ou réactivation ; un signal disparu devient inactif.
Les [liens et décisions DPGF](../../src/lib/takeoff/dpgf-review-server.ts)
préservent la provenance héritée et actualisent seulement les preuves concernées.
L'[application](../../src/lib/takeoff/apply-server.ts) prépare son plan après les
contrôles d'accès, de verrou et de révision, puis utilise une seule RPC atomique.
Une autorisation temporaire est révoquée en cas d'échec ; aucun repli n'écrit des
lignes séparément. Le [batch d'items](../../src/lib/takeoff/item-patch-server.ts)
garde ses résultats partiels ordonnés et vérifie la révision à la lecture puis
dans l'écriture conditionnelle. La [comparaison de jobs](../../src/lib/takeoff/job-compare-server.ts)
contrôle leur version et leur document avant de charger les lignes.

Les modules `*-response-contracts.ts` fournissent les schémas communs aux routes,
au client et à OpenAPI. Ils vérifient les identités, discriminants, compteurs,
pages et confirmations partielles. Les réponses de création et de reprise sont
validées après l'ajout du résultat de déclenchement du worker. Un reçu invalide
après écriture reste une erreur serveur et ne déclenche pas de relance automatique.

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

L'[orchestrateur d'envoi](../../src/lib/email/send-estimate.ts) utilise des
décisions pures de reprise, une préparation de document et un repository de
dispatch distincts de la livraison fournisseur. Les confirmations RPC respectent
les variantes historiques nullable et vérifient l'opération attendue. Une
confirmation indécidable interrompt les effets suivants, y compris les
compensations. Les baux, le PDF figé et la clé fournisseur restent ceux de l'outbox.

Le [reçu HTTP d'envoi](../../src/lib/email/send-estimate-contract.ts) confirme la
version et la demande avant l'affichage du succès. En cas de réponse ambiguë,
le client conserve le contenu et la clé pour une reprise manuelle du même envoi.
Une réponse tardive d'une autre ouverture ne ferme pas le dialogue courant.
Les réglages restaurés mais non enregistrés doivent être résolus avant émission ;
le journal d'activité utilise le lecteur d'événements partagé et annulable.

| Terme | Sens dans le produit |
| --- | --- |
| Affaire | Dossier regroupant pièces, registre et versions de devis. |
| DPGF | Décomposition du prix global et forfaitaire, importée puis chiffrée. |
| CCTP | Cahier des clauses techniques particulières servant de référence technique. |
| FO / MO | Fournitures / main-d'œuvre. |
| Déboursé | Coût direct calculé avant coefficients de vente ; voir les règles du moteur. |
| Snapshot / sceau | Données de calcul figées / empreinte d'intégrité de l'offre. |
| Variante | Alternative de chiffrage ; ne vaut pas avenant contractuel. |
