# Provenance des lignes réutilisées depuis la bibliothèque

Défaillances définies le 13 octobre avant modification de l'interface. La
recette full06 conserve les finances et heures mais ses lignes réutilisées
portent `manual` / `{}`. La nouvelle matérialisation doit conserver un wrapper
`assembly_library` distinct de l'application d'un ouvrage IA. La provenance
d'un ancien composant ne valide pas les quantités ou le CCTP du devis actuel.

| Défaillance | Assertion TesterArmy GC01 et GC02 |
| --- | --- |
| La ligne copiée semble être une saisie manuelle ou une nouvelle application IA | API et RLS après insertion/reload portent provider/kind `assembly_library`, identité feuille et item de bibliothèque, copie exacte de la provenance originale. Pas de snapshot/application/CCTP direct ajouté à plat. |
| Le libellé reste « Source à confirmer » ou « IA » | Chaque ligne réutilisée montre « Bibliothèque » ; nom accessible du bouton : « Afficher la provenance de la bibliothèque ». Le libellé complet est « Bibliothèque d'ouvrages ». |
| L'ancien niveau de confiance ou des faits deviennent des preuves actuelles | Quantité à confirmer et confiance non mesurée ; la confiance originale reste dans la copie historique, sans aplatissement. Le panneau demande de vérifier la quantité et les exigences du devis actuel. |
| La provenance est stockée mais inaccessible au chiffreur | Cliquer le bouton ouvre « Origine : bibliothèque d'ouvrages », avec le message « La provenance d'origine est conservée. Vérifiez la quantité et les exigences du devis actuel. » et un lien vers la bibliothèque existante. Aucun UUID technique affiché. |
| L'adaptation du badge change les coûts ou l'intention | Après lecture/fermeture du panneau, mêmes identités, coûts, heures et sources ; les assertions standard/DPGF et de réutilisation existantes restent exactes. |

L'ouvrage d'origine est une référence historique réutilisée. La présentation
ne transforme pas ses anciennes citations, hypothèses ou mesures en une
conformité technique du nouveau dossier. La lecture raw API/RLS demeure la
preuve exacte d'identité ; les assertions UI portent sur le sens présenté au
chiffreur. Aucun nouveau test unitaire n'est ajouté après l'implémentation.

L'OpenAPI doit décrire les champs de provenance réellement renvoyés par les
items et l'insertion de bibliothèque. Défaillance documentaire : le contrat
actuel les conserve par `passthrough` mais ne décrit ni leur présence ni le
wrapper. Décrire le provider texte libre et la valeur JSON sans fermer les
providers ou altérer les anciennes métadonnées, puis régénérer et valider
`openapi.json`. Les assertions E2E ci-dessus qualifient le contrat réel.

Le build `2026-10-13T00-36-21-178Z-75550ac1` conserve une compilation réussie
mais refuse son budget : éditeur 500 248 octets gzip, limite 500 000. Avant
correction du chargement, conserver ce manifeste et ce résultat. Le détail de
provenance n'est monté que lors de l'ouverture du menu de ligne ; son code peut
être chargé à cet instant. Défaillances à vérifier : menu vide après ouverture,
badge inaccessible, panneau/fermeture incorrects ou nouvelle modification des
valeurs. Les assertions GC01/GC02 ci-dessus restent exactes. Le nouveau build
doit respecter le budget inchangé ; le menu et son panneau seront ouverts dans
la vraie recette. Cette mesure concerne les chunks du manifeste, pas des Web
Vitals terrain ni le coût de toutes les interactions après ouverture.

## Échec réel UI07 : surface responsive du badge

L'archive `.e2e/army/coverage/runs/2026-10-13T05-46-44-177Z/` est conservée
(manifestSHA `1f6fda5bc6ef8a1327959c7ed069ab3ee07c36ada94da021fad36231d6c885af`).
Auth passe ; GC01 passe la revue/reload/application, deux XLSX et les wrappers
de réutilisation API/RLS, puis échoue sur « Qté à confirmer » : un match,
texte SDK vide. « Bibliothèque d'ouvrages » avait passé juste avant ; la
confiance et le panneau suivants ne sont pas éprouvés. GC02–04 restent ignorés
par la limite d'échec, sans GREEN.

Défaillance du harnais identifiée avant son correctif : la largeur de la cellule
désignation peut masquer `.estimate-line-designation__support` par la règle
container max-width430px de `src/styles/estimate-frozen.css`. Le screen archivé
ne montre pas le badge inline, mais conserve « Details de la ligne ». Le vrai
menu `LineRow` contient les mêmes `lineStateNodes` dans son portail. Le SDK
installé lit `HTMLElement.innerText` pour `toContainText` et `textContent` ;
le nom accessible et `title` sont des champs séparés. Le libellé complet exact
est dans le vrai span `.sr-only`, et le titre contient les détails, pas
nécessairement les trois libellés. Le premier succès ponctuel ne prouve pas une
surface inline stable ; l'archive ne mesure pas l'instant précis du changement
de layout ni l'arbre AX du navigateur.

Correctif de parcours GC et NI : ouvrir le menu de cette ligne avant les
assertions, exiger un seul menu visible et un badge visible dans son état,
lire le `textContent` réel du span `.sr-only` avec absence d'ancêtre masqué,
et exiger exactement « Bibliothèque d'ouvrages — Qté à confirmer — Confiance non mesurée ».
Vérifier séparément le titre détaillé, puis le bouton au nom accessible exact
« Afficher la provenance de la bibliothèque » dans ce même menu et son panneau.
Les trois exigences, les finances, les exports et les comparaisons API/RLS
en lecture seule sont conservés. Aucune modification CSS/produit ou assertion
fondée sur un texte reconstruit. Diagnostic/préimages :
`.e2e/core07/ui07-truth-locator-diagnostic-20261013/`. Aucun rerun n'est qualifié
par cette correction de source ; une nouvelle campagne doit l'exécuter.

## Échec réel UI08 : casse du texte rendu

L'archive `.e2e/army/coverage/runs/2026-10-13T06-03-20-512Z/` est conservée
(manifestSHA `b99dc6cdde52ee458304bf3eb95358ff86fc5f8390023153b01bb5ae24fc871f`).
GC01 atteint le menu, son badge de vérité, le libellé complet et le titre ;
le bouton au nom accessible exact est visible. Son assertion textuelle échoue
sur le texte réel SDK
`BIBLIOTHÈQUE PROVENANCE DE BIBLIOTHÈQUE DISPONIBLE POUR CETTE LIGNE`.
La règle `.takeoff-source-badge__trigger` de `src/styles/legacy.css:1406`
applique `text-transform: uppercase` ; le SDK lit ce rendu via `innerText`.
Le panneau suivant et les autres parcours restent non éprouvés.

Défaillance du harnais définie avant correction : GC, NI et le qualifier
comparaient cette chaîne rendue en respectant la casse initiale du source.
Seule la comparaison du mot « bibliothèque » dans `badgeText` devient
insensible à la casse (`/bibliothèque/i`). Le texte observé est conservé
brut ; il n'est ni normalisé ni reconstruit. Le nom accessible exact, le
libellé réel `.sr-only` avec ses trois mentions exactes, le titre détaillé,
le panneau, le lien, les finances et les sources restent inchangés.
Préimages et erreur exacte : `.e2e/core07/ui08-badge-case-before-20261013/`.
Le changement du script de qualification exige une nouvelle chaîne de build
et une nouvelle campagne ; cette correction n'est pas une recette exécutée.
