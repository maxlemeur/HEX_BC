# Historique de prix DPGF avec quantité nulle

## Défaillance observée et contrat avant correction

La campagne candidate 4 a échoué, sous Linux et Windows, à l'ouverture des suggestions de prix DPGF avec « Données estimate_items invalides ». La lecture des 250 lignes récentes du tenant valide chaque ligne avant de sélectionner les historiques pertinents : une quantité égale à zéro, même sur une autre désignation, faisait donc échouer toutes les suggestions.

Le schéma de lecture partagé des lignes de devis exigeait une quantité strictement positive. Or `estimate_items` autorise une quantité absente ou supérieure ou égale à zéro, comme le schéma de saisie du devis. Ce contrat est distinct de celui des quantités extraites du métrage, qui restent strictement positives. Une ligne à zéro peut conserver un prix unitaire pertinent : elle ne doit être ni supprimée ni exclue arbitrairement de l'historique. Les valeurs négatives restent invalides.

Les calculs existants traitent déjà ce cas : le facteur de quantité d'une suggestion est absent pour zéro ; la comparaison DPGF calcule l'écart absolu et laisse le pourcentage absent lorsque la quantité DPGF est zéro.

## Recette E2E définie avant correction

Dans `e2e/army/takeoff/takeoff-dpgf-review.e2e.ts`, la recette de suggestion de prix crée désormais explicitement une quatrième ligne historique appartenant à sa version : « Poste historique hors lot », quantité 0, prix unitaire 1 000 centimes. Les trois historiques positifs et les assertions existantes sont conservés : au moins trois sources, note de justification obligatoire, prix appliqué et persistance après relecture.

Cette fixture a été écrite avant la correction produit. La campagne candidate 4 fournit la défaillance réelle avec des lignes zéro créées par les parcours précédents ; la fixture zéro explicite doit encore être rejouée dans le prochain candidat. Le résultat antérieur ne constitue pas une exécution de cette nouvelle fixture.

Aucun test isolé supplémentaire n'est ajouté : le scénario navigateur reproduit directement cette erreur de lecture des données et vérifie son effet métier. Les suites isolées existantes de comparaison et de suggestions sont conservées et rejouées pour détecter une régression adjacente ; elles ne remplacent pas la preuve E2E.

## Périmètre

La correction aligne uniquement `takeoffDpgfCompareEstimateItemRowSchema.quantity` sur le contrat non négatif des lignes de devis. Elle ne modifie ni les requêtes, ni les filtres de pertinence, ni les prix, ni les règles de quantité des résultats de métrage. Aucun changement de migration, de route ou de schéma public.

Le fichier serveur avant correction, incluant déjà la correction indépendante d'idempotence de l'upload, est conservé dans `.codex-tmp/army-migration-20261015/takeoff-price-zero-before/`.
