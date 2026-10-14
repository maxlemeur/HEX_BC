# Dossier pour un audit indépendant

Ce dossier a été préparé le 14 octobre 2026 à la demande du porteur de MergeOne / Miaouffrage.

Le prestataire choisit sa méthode, son ordre de lecture, ses outils, ses conclusions et ses priorités. Les diagnostics, critères et solutions de l’équipe sont contestables. Le registre CSV est facultatif et ne contient aucune conclusion ni priorité préremplie.

Le document Word et sa version Markdown expliquent le mandat, le produit souhaité, les préoccupations datées, les limites des essais et les accès à organiser. Les annexes conservent leurs contenus d’origine : elles ne constituent pas un référentiel unifié ni une certification.

## Contenu

- dossier-audit-independant.docx et dossier-audit-independant.md : document de mission.
- inventaire-documents.csv et manifeste.json : identité des fichiers transmis et limites de capture.
- registre-audit.csv : questions modifiables et colonnes de restitution vides.
- index-preuves.csv : rapports sélectionnés joints et références complémentaires.
- annexes/vision : texte initial du porteur.
- annexes/repository/docs/metier et docs/domaines : références décrivant les règles et parcours.
- annexes/repository/docs/prd_file et la bible hydraulique : exemples métier non anonymisés, copiés sans exécuter les macros.
- annexes/repository/docs/product et docs/audit : propositions, progression et observations de l’équipe.
- annexes/repository/docs/testing et annexes/preuves : portée déclarée des essais et rapports sélectionnés.
- annexes/repository/src, supabase, scripts, e2e et configurations : copie des sources pour inspection et préparation d’un environnement isolé.

## Limites de transmission

Aucun fichier .env, profil privé, secret d’accès, base de données, build, node_modules, historique Git ou trace authentifiée n’est fourni. Les empreintes ne prouvent pas qu’une migration a été appliquée, ni que les sources copiées ont été exécutées. Les rapports historiques n’établissent pas le comportement d’un nouveau build. Les archives complètes de recette sont à extraire selon les besoins, avec suppression des éléments privés.

Les noms de clients, projets, fournisseurs et les informations commerciales des exemples d’origine peuvent rester présents. La création locale de ce dossier ne vaut pas autorisation de les publier ou de les communiquer sans vérifier les droits. Aucune transmission externe n’a été effectuée.

Le code et les documents proviennent d’un espace de travail en cours de développement. Chaque fichier est vérifié lors de sa copie ; manifeste.json indique les évolutions éventuellement constatées en fin de collecte. Cette capture n’est pas présentée comme un commit publié ou une version déployable.

Les accès applicatifs, le corpus représentatif, les entretiens et les preuves privées nécessaires doivent être organisés séparément. Le prestataire peut demander d’autres matériaux, relever les manques et remettre en cause le périmètre proposé.

Une vérification avant commit a retiré le fichier de session navigateur `e2e/.auth/playwright-user.json` de la copie de transmission. L'archive originale reste conservée dans les artefacts privés. Le manifeste, l'inventaire et les empreintes de la copie ont été mis à jour ; aucune transmission externe n'a eu lieu.
