# Corpus métier original conservé en privé

Les classeurs, PDF, CSV et documents métier d’origine sont conservés localement
sous `.private/repository-hygiene-20261019/originals/docs/prd_file/`.
Le manifeste privé conserve leur chemin, taille et SHA-256 ; les fichiers ne
sont pas anonymisés en place ni perdus.

Les clones du dépôt utilisent les
[fixtures publiques fictives](../../e2e/fixtures/business/README.md). Leur
contrat précise les volumes, les statuts, l’encodage et les montants attendus.
Ces fixtures ne sont pas une nouvelle preuve d’exécution des fichiers réels.
Les anciens résultats restent des instantanés datés de leurs propres entrées.

Pour une recette sur les originaux, utiliser explicitement le corpus privé
selon le guide des fixtures, dans un environnement local possédé. Aucun corpus
privé, profil d’authentification ou rapport contenant ses données ne doit être
ajouté à Git ni aux artefacts publics.
