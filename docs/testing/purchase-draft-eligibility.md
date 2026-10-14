# Applicabilité des offres avant brouillon d'achat — SITE-01

## Échecs observables définis avant la correction

- Une offre déjà retenue peut rester `covered` dans la comparaison après modification de son unité, minimum, devise, activité ou fenêtre de validité. Elle ne doit pas entrer dans un brouillon d'achat.
- Un fournisseur archivé ou un tarif disparu/inaccessible ne doit pas être accepté à partir d'une ancienne alternative.
- Le devis peut être libellé dans une autre devise alors que les commandes actuelles sont en EUR : aucune reprise numérique sans conversion validée.
- Une erreur de lecture des conditions actuelles ne doit pas être interprétée comme une offre sans restriction.
- Une modification entre l'aperçu utilisateur et le POST doit rendre l'ancienne demande non préparable, avant toute écriture de commande. Les motifs doivent rester visibles dans le navigateur, sans disparition de la ligne au décodage de la réponse.
- Les gardes ne doivent ni modifier le coût négocié du devis ni imposer le nouveau prix catalogue. Un tarif applicable conserve la quantité, le coût et la provenance de la ligne.

## Parcours E2E à exécuter sur une base locale jetable

Créer un dossier ARMY, un devis EUR et une ligne de fourniture de 2 m à 1 200 centimes, un fournisseur actif, une offre EUR/m active (minimum 1, dates encadrant le jour courant) et un site de livraison. L'aperçu doit proposer 2 400 / 480 / 2 880 centimes HT / TVA / TTC.

Après cet aperçu, modifier successivement le tarif (minimum 3, unité kg, devise USD, offre expirée, future, archivée), puis le fournisseur (archivé). Relire l'aperçu et envoyer l'ancien groupe : motif exact visible, HTTP 409 `ORDER_DRAFT_PREPARATION_STALE`, aucune commande liée, contenu et coût du devis inchangés. Un devis USD est également bloqué tant que les achats restent exclusivement EUR.

Rétablir l'offre applicable, avec un prix catalogue différent du coût négocié : créer un seul brouillon et relire les quantités, coût de 1 200 centimes, totaux et liens de provenance. Les données sont exclusivement des fixtures locales ; aucun envoi fournisseur ni migration distante.

L'artefact E2E doit conserver commande, révision et changements locaux, environnement, identifiants des fixtures, résultats attendus/réels et chemins des preuves. Une préparation seule ne vaut pas exécution.

## Exception d'isolation avant implémentation

Le scénario de course dans une seule requête est distinct du scénario E2E « changement après aperçu » : le service de comparaison a lu une offre applicable, puis le tarif ou le fournisseur change avant la dernière vérification de préparation. Un navigateur ne peut pas ordonnancer de façon reproductible cette intercalation entre deux lectures serveur sans ajouter un point d'arrêt dans le code métier. La régression dans `purchase-order-drafts.test.ts` conserve donc un instantané de comparaison applicable et présente les nouvelles conditions lors de la lecture courante ; elle vérifie l'absence de commande, le motif et la conservation du devis. Une erreur de cette lecture est également injectée pour vérifier l'échec fermé. Ces tests ne prouvent ni RLS ni transaction PostgreSQL.

## Limites à conserver dans SITE-01

Cette tranche vérifie l'applicabilité dans l'aperçu et recalcule la préparation lors du POST. La fenêtre entre la dernière lecture et l'INSERT reste ouverte tant que le contrôle et l'écriture ne sont pas atomiques en base. Empreinte de proposition, concurrence, idempotence, quantités décimales et création multi-fournisseurs transactionnelle restent du travail SITE-01. Aucun de ces résultats ne permet de déclarer SITE-01 terminé.

## Vérification locale du 11 octobre 2026

- Avant code métier : 6 tests existants réussis, 12 régressions échouées sur l'acceptation de conditions devenues inapplicables. Artefact : `.e2e/purchase-draft-eligibility/red-vitest.json`.
- Après correction : 18/18 régressions du module, 26/26 tests existants client/API/éligibilité et 4/4 du panneau réussis, aucun ignoré. Artefacts voisins : `green-vitest.json`, `retained-node-vitest.json`, `retained-ui-vitest.json`.
- Commande principale : `npm test -- --project=node src/lib/estimates/purchase-order-drafts.test.ts --reporter=json --outputFile=.e2e/purchase-draft-eligibility/green-vitest.json`. La première tentative sandbox a échoué avant exécution sur un renommage de cache `EPERM` ; le même contrôle a été exécuté hors sandbox.
- Lint ciblé et `npm run typecheck` réussis ; contrat OpenAPI mis à jour et régénéré.
- Le parcours `e2e/army/local/purchase-draft-eligibility.e2e.ts` lit `.e2e/purchase-draft-eligibility/fixture.json`, exige le même origin Supabase HTTP 127.0.0.1 et des fixtures ARMY. Il utilise seulement les APIs applicatives ordinaires et un garde réseau propre à ce scénario local ; la seule lecture directe supplémentaire permise est l'endpoint exact du site de livraison. Les envois et autres actions engageantes restent interdits.

## Recette achats exécutée en build de production local

**Le scénario achats a réussi** dans l'archive `.e2e/product-foundation/runs/2026-10-11T02-57-32-665Z/`. Le run coordonné reste **en échec global : 3 résultats réussis, 1 échoué, aucun ignoré**, l'échec concernant le scénario d'arrondi commercial et son export DPGF. La réussite achats ne requalifie pas cet échec.

Le manifeste et le rapport identifient le scénario sélectionné `local purchase drafts recheck current supplier conditions without changing the estimate` comme `passed`. Ils conservent la révision `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`, les modifications locales, `source.changedDuringRun=false`, le build `5OPtggZhYWtSC_z3MGQXs`, Node 24.19.0, Chromium desktop, l'application `http://localhost:3117` et Supabase local `http://127.0.0.1:59827`. L'empreinte du fichier BUILD_ID a aussi été comparée au manifeste. L'authentification est passée par l'interface ordinaire ; traces authentifiées désactivées, aucun appel modèle.

Commande exécutée : `node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs rounding orders --production`, qui invoque `node node_modules/e2e/dist/cli/bin.js run --config .product-foundation-e2e.config.ts --target chromium-desktop`. Le wrapper et la configuration exacts sont archivés sous `run.cjs` et `config.ts`. Le fichier d'environnement contient uniquement la configuration locale de l'exécution ; son contenu n'est pas publié dans les preuves.

Les neuf observations achats archivées couvrent l'aperçu admissible, sept refus et la création finale relue :

- Minimum de 3 m pour une demande de 2 m, unité kg, devise USD, offre expirée, future, archivée et fournisseur archivé : motif exact visible, zéro groupe préparable, POST 409 `ORDER_DRAFT_PREPARATION_STALE`, aucune commande pour le fournisseur de fixture et devis inchangé.
- Après rétablissement : une seule commande en brouillon `efb15ab1-cf35-4156-95dc-2386c336731b`, liée à la version `ad9eaae8-2495-48d8-bb19-7be97ad8a918` et à la ligne `1c7ad0a5-224a-4862-86f8-35c1809e229d`. La relecture confirme quantité 2, coût négocié 1 200 centimes malgré le catalogue à 1 800, totaux 2 400 / 480 / 2 880 centimes. Aucun envoi de commande.

Les SHA-256 ont été recalculés et concordent avec le manifeste et le fichier de contrôle des observations :

| Fichier de l'archive | SHA-256 |
| --- | --- |
| `report.json` | `bc8f9ade2eda9b228b261198391fcaf6b03df828d9876a2db6a4c583c798b160` |
| `purchase-evidence/business-results.json` | `0d15194b2797f66d24c5b09c3835099ed6befe9c8fcc794339a0b46bb0f42cf4` |
| `purchase-evidence/business-results.sha256` | `859a423920ddcbc215d1b11d85aeeccac138d7764b7dac72b2466a2756e2191f` |

Empreinte du manifeste consulté : `dfa6867867310353b29667bcbeeaea86d71a3ef42e36a9ab56f469828802cf08`.

La première tentative `2026-10-11T02-52-53-541Z` s'était arrêtée sur le garde réseau du harness avant la création : c'est un échec de préparation conservé, pas un résultat métier. Le scénario local a ensuite reçu son garde unique sans modifier la campagne partagée.

**Replay : créer de nouvelles fixtures locales.** La fixture actuelle est désormais liée au brouillon final ; le scénario exige zéro commande fournisseur au départ. Ne pas supprimer la commande pour réutiliser artificiellement sa preuve. Le cas devis non-EUR, les conditions absentes et l'erreur de lecture restent couverts seulement en isolation. Les limites transactionnelles de SITE-01 décrites plus haut restent ouvertes ; cette recette ne qualifie ni un déploiement distant ni les décimales, l'idempotence ou les courses entre la dernière lecture et l'écriture.

## Adaptation au contrat transactionnel SITE-01A

Le scénario conserve les sept refus, leurs motifs UI, l'absence de commande,
la relecture du devis et le témoin final 2 × 1 200 malgré le catalogue à 1 800.
Il charge désormais une fixture complète explicitement désignée par
`E2E_PURCHASE_DRAFT_FIXTURE_PATH`, avec `deliverySiteUpdatedAt`. Les substitutions
indépendantes de version/projet sont supprimées pour ne pas mélanger des
identifiants issus de deux fixtures.

L'aperçu applicable fournit une vraie empreinte de revue. La même demande
contient `idempotency_key`, `reviewed_lines` et `delivery_site_updated_at` puis
est refusée après chaque changement de conditions. Après rétablissement, un
nouvel aperçu et une nouvelle clé sont nécessaires au succès : remettre les
valeurs métier initiales ne réutilise pas silencieusement l'ancienne revue.

Le seed local `.e2e/purchase-preparation/seed.cjs <campagne-neuve>` prépare
maintenant une onzième fixture, `eligibility`, avec un seul fournisseur et
une seule ligne. Il écrit le reçu complet `fixture.json` et le reçu spécialisé
`eligibility-fixture.json` sous le nouveau dossier de campagne. Rien dans le
seed ne supprime ou ne réutilise une ancienne commande. La recette conserve
ses observations dans un sous-dossier propre à chaque exécution ; le wrapper
peut ainsi les archiver sans écraser la preuve précédente.

Après migration et build local vérifiés, fournir les deux chemins de fixtures
au runner et sélectionner `preparation orders --production`. L'adaptation
est écrite ; sa réussite sur le nouveau contrat reste à constater dans une
nouvelle archive. Les résultats historiques ci-dessus ne sont pas réinterprétés.
