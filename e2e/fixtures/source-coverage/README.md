# Corpus CCTP synthétique A/B

Ces PDF de trois pages sont des données de recette, sans portée contractuelle
ni validation par un chiffreur. A contient C1 en 30 mm pour CH-A et ECS-B ; B
passe uniquement CH-A à 40 mm. C3 est inchangé pour éprouver la revérification
humaine d'une nouvelle copie sans inférer qu'un texte identique reste vérifié.

Le manifeste donne les SHA, octets, pages physiques, folios et passages. Les
octets proviennent du corpus local déjà utilisé pour la référence conservée ;
leur promotion ici ne constitue pas une nouvelle exécution du produit.
Le générateur a seulement été adapté aux chemins de ce dossier. Il refuse
d'écraser les PDF et le manifeste existants. Pour régénérer, copier ce script
dans un nouveau dossier vide avec les versions Python/reportlab/pypdf du
manifeste, puis comparer les octets avant de remplacer volontairement quoi
que ce soit. Aucun générateur n'est lancé par la préparation des fixtures.

Le seed vérifie les PDF avec pdf-lib avant toute connexion et relit leurs
octets réels depuis Storage après téléversement. Il ne confirme aucune copie
de référence et ne préinsère aucune exigence.
