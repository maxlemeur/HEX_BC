# Copie commerciale : régressions pures avant implémentation

Les deux RED réels OF01/OF02 ont été exécutés avant le module : lien vers la
connexion et renvoi du nom courant avec PDF original. Les parcours navigateur
restent l’oracle d’émission, de portail, de PDF et de renvoi.

Le 13 octobre, les tests du nouveau module et les 38 vecteurs des anciens sceaux
ont été copiés dans le dépôt AVANT de créer `offer-contract.ts`. Les tests sont
issus de `.e2e/offer-emission/pure-precode-20261013-01` ; seul le chemin de fixture
a été changé. Les vecteurs sont conservés octet pour octet dans
`src/test/fixtures/offer-contract-legacy-vectors.json`.

Ces régressions répondent à des limites concrètes du navigateur : corruption des
JSON persistés, clés privées injectées, cycles et parents manquants, overflow des
centimes, confusion TVA/arrondi, précision des timestamps PostgreSQL, mise en page
ou CGV divergentes, et changements de sceau liés à l’ordre des objets ou des
lignes. Elles ne sont pas des tests de getters, de texte source ou de forwarding
mocké. Elles doivent refuser les contrats corrompus sans réparer les données.

Le module pur ne charge aucun compte, tenant, profil courant, base ou fournisseur.
Une option de CGV de développement ne peut provenir que du contexte serveur local
explicitement admis ; elle ne qualifie aucune approbation juridique ou production.
Les contrôles de droits, de publication et de marqueurs non rétrogradables restent
dans les RPC et les services, avec leurs recettes SQL/HTTP distinctes à réaliser.

Les 38 vecteurs v1–v4 sont des fixtures de sérialisation synthétiques exécutées
sur les builders actuels ; ils ne sont pas des PDFs historiques émis. Les nouveaux
cas restent préparés tant que le module n’existe pas et n’a pas été exécuté.
