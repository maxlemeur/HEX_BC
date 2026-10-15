# Oracles de provenance du port

La revue avant correction relève deux pertes par rapport aux scénarios conservés :
un lot de repli sans `source_provider` ou une ligne sans `source_metadata.kind`
pouvaient passer ; un snapshot sans mode de correspondance, heures de main-d'œuvre
ou rôle métier pouvait aussi passer malgré les valeurs présentes sur la ligne.

Les recettes `GEN01 fallback` et `GEN01 provenance` rétablissent ces cinq assertions
sur les données réellement relues par l'API après insertion. Elles complètent les
montants exacts, le rejet sans insertion et la visibilité après rechargement aux
deux largeurs. Aucun test isolé n'est nécessaire : ces régressions sont directement
observables dans le parcours TesterArmy. La préparation des propositions reste
synthétique et locale ; cette campagne ne qualifie pas un fournisseur de génération.
