# CORE-07 : recette des composants écartés

GC10 `2026-10-13T10-33-49-949Z` s'arrête sur un prérequis du harnais :
après la saisie canonique équivalente 1.0004 → 1, la revue reste valide,
l'insertion est activée et la sauvegarde redondante porte « Sous-détail déjà
validé », désactivée. Le harnais cherchait à tort une validation activée.
La correction inclut ce libellé dans le contrôle stable, exige la sauvegarde
redondante désactivée avant la saisie invalide, puis sauvegarde et insertion
désactivées pendant l'erreur. Le retour à une valeur valide exige toujours
une revalidation humaine réelle après invalidation. Les montants, états,
sources, jetons et l'absence d'écritures restent stricts ; GC02–GC04 ne sont
pas éprouvés dans cette archive refusée.

GC11 `2026-10-13T10-43-40-977Z` atteint ensuite l'application et la
réutilisation, puis s'arrête sur beforeunload : son ancien Control+s après
réutilisation déclenche une réconciliation déjà inutile avant reload. Comme
pour NI, la recette suivante exige désormais le pied exact dès le POST,
le statut visible À jour/Sauvegardé et une lecture égale à l'immédiat avant
reload, sans Control+s ni poll correcteur. Le garde produit est conservé,
aucun dialogue de sortie n'est accepté automatiquement. Le reader exige le
nouveau témoin reuse-ready ; les cas non atteints restent sans preuve.

Contrat écrit avant le harnais et la correction produit. Le scénario explicite
`generated-components` utilise quatre devis neufs GC01–GC04 et un cinquième
devis vide pour la bibliothèque. Le seed prépare uniquement des propositions
`suggested`, un sous-détail `pending_review` et une grille vide avec un lot.
Aucun rejet, revue validée, application, snapshot, ouvrage de bibliothèque ou
ligne chiffrée ne peut être préparé. Le compte existant, le tenant actif et le
premier rôle actif du compte à 4 000 centimes/h sont des préconditions ; aucune
réparation, migration, provisioning Auth, modèle ou email.

| Défaillance | Parcours et oracle exact |
| --- | --- |
| L'action de revue manque ou supprime la proposition | GC01 ouvre le vrai dialogue, reprend le brouillon puis ouvre son sous-détail. Archiver les quatre articles, boutons, statuts et sommes avant d'exiger « Écarter ». Le RED échoue sur son absence ; un setup échoué ne constitue pas cette reproduction. |
| Écarté reste dans les sommes ou revient implicitement | Quatre composants : matériel 4 000, MO 1 h à 4 000, matériel 8 000, MO 2 h à 4 000. Quantité parent 1, marge 1, TVA 20 %. DS 24 000, 3 h ; écarter les deux derniers donne DS 8 000, 1 h ; rétablir le matériel donne DS 16 000, 1 h et restaure `suggested`. Réécarter donne DS 8 000. Sauvegarder, recharger et relire par API/RLS. |
| Application, snapshot ou bibliothèque contiennent les écartés | GC01 applique par UI : 8 000/1 600/9 600 centimes et 1 h. Les quatre propositions restent dans la revue, deux `rejected`. Snapshot/composition et bibliothèque contiennent uniquement les deux IDs retenus. |
| Les exports ou la réutilisation réintroduisent l'exclusion | Deux XLSX réellement téléchargés et relus (standard/DPGF), cellules financières exactes. Dans le cinquième devis vide, choisir l'ouvrage créé par le vrai sélecteur puis l'insérer ; deux composants retenus, sommes 8 000/1 600/9 600, 1 h après sauvegarde/reload. Télécharger aussi ses deux XLSX et vérifier chaque cellule depuis le mapping API propre de chaque ligne, sans imposer la décomposition de la ligne primaire. |
| Une MO retenue à coût nul perd ses heures/identité, ou la projection est remappée par index | GC02 écarte le matériel4 000 (index0) et MO2 (index3), change le coût MO1 à zéro par UI puis garde la sélection non contiguë [1,2]. Sommes 8 000/1 600/9 600, 1 h. Composition et bibliothèque contiennent MO0€ et matériel8 000, dans cet ordre, avec chaque `componentId`, coût, type, heures et citation associés. La bibliothèque conserve `source_metadata.component_id` issu du composant revu. Créer un nouveau devis par le wizard, réutiliser réellement l'ouvrage puis télécharger ses deux XLSX et vérifier son mapping API propre ; une impossibilité observable reste un défaut, jamais un skip. |
| Tout écarté est présenté comme un ouvrage validé | GC03 écarte les quatre puis « Enregistrer les décisions » sauvegarde sans validation (`markReviewed:false`). Reload retrouve les quatre rejets et le sous-détail `pending_review` ; application refusée, grille0/0/0, aucune application/snapshot/bibliothèque. |
| Une ancienne intention applique une autre composition | GC04 capture une vraie revue/intention courante, modifie et enregistre la composition puis envoie l'ancien corps avec son token par action réelle. Refus `GENERATED_OUVRAGE_REVIEW_CHANGED`, aucun résultat final, état financier inchangé. |
| Une fusion incompatible invalide une revue sans changer de composant | Dans GC01 après sauvegarde/reload, sélectionner le candidat puis cliquer « Fusionner » sur MO1 précédée d'un matériel. Lire réellement le token avant/après et les objets API/RLS : même token, mêmes objets/sommes, aucune sauvegarde, insertion toujours disponible. |
| Une saisie équivalente à la précision stockée affiche un coût différent de celui appliqué | Dans GC01 sur la revue validée, saisir `1.0004` comme quantité du matériel à 4 000 centimes. La quantité canonique reste 1 : DS composant 4 000 et DS total 8 000, badge Suggéré, insertion disponible, même token et aucun appel de sauvegarde. Le témoin est défini après le constat de revue et avant correction du calcul UI. |
| Un demi-décimal est arrondi autrement qu'en SQL | Continuer GC01 avec quantité `1.0005` : quantité canonique `1.001`, DS composant 4 004 et total 8 004, statut manuel. Revenir à 1 conserve Suggéré et DS total 8 000. Le même canonique à trois décimales doit précéder le calcul des heures : un rendement `1.0004 h/u` pour quantité parent 10 vaut 10 h, pas 10.004. Ce second exemple est un cas de revue, sans prétendre à une fixture navigateur exécutée. |
| Le garde de précision transforme une saisie hors stockage en crash ou en zéro | Sur la revue encore validée, saisir quantité `1e9` : conserver le raw `1000000000`, `aria-invalid` et une erreur liée au champ, dernier canonique q1/DS4000 et total8000 inchangés. Save et Apply sont bloqués, mêmes objets/token/ledger, aucune écriture. Corriger explicitement par la saisie précédente rend Save admissible ; Apply reste bloqué jusqu'à une revalidation humaine réelle. L'équivalence1.0004 conserve Apply uniquement avant toute saisie invalide. |
| Une opération composée déborde malgré des composants admissibles | Deux matériaux compatibles de quantité `600000000`, coût zéro, dépassent ensemble la précision stockée. La fusion est refusée avec message ; composants locaux, token et données persistées restent intacts. Préparer une copie temporaire par l'interface, puis supprimer seulement cette copie non persistée et remettre les saisies initiales. |
| Le rendement est admissible mais ses heures calculées débordent | MO d'unité `u`, quantité parent2, rendement `600000000 h/u` : conserver le raw600m, erreur liée/aria-invalid, Save/Apply bloqués et dernière composition canonique DS8000/MO1h. Seul le champ ciblé et sa validité changent dans le formulaire ; comparer exactement les autres champs, titres/badges, objets API/RLS/token/ledger. La correction explicite du rendement puis des unités et parent1 précède toute revalidation. Si le parent augmente après un rendement admissible, le rendu doit signaler les heures hors limite sans crash ; cette branche reste non éprouvée ici à cause du démontage du formulaire. |
| Le total des heures dépasse le stockage malgré des heures admissibles par composant | Dupliquer temporairement une MO de `600000000 h`, coût zéro : total `1200000000 h`, alerte et validation indisponible, aucun crash ni sauvegarde. Supprimer seulement la copie non persistée et remettre les valeurs initiales. La garde du rendu contrôle le total aussi, avant sa représentation comme heures enregistrables. |
| Un contenu équivalent devient manuel après rétablissement | Dans GC01 rétablir le matériel8 000 écarté ; ajouter une ligne vide à Faits, saisir80,01€ (8001cents) puis80€ (8000cents). Avant sauvegarde le badge doit être Suggéré et le DS16000 ; sauvegarde/reload conserve l'origine exacte suggested. Aucune nouvelle fixture ni isolation ; ces assertions précèdent le correctif ciblé UI du13octobre. |

La sélection `entry` contient exactement Auth+GC01 (deux résultats), la
sélection `full` Auth+GC01–GC04 (cinq). Ces sélections appartiennent au profil
explicite et à ses empreintes, sans grep ni skip. Le même GC01 complet est
utilisé : il échoue naturellement avant correction au premier bouton absent.
Les sources/SQL/configuration sont figées pendant build et recette. Chaque
étape exclusive conserve son reçu en cas d'interruption ; aucun retry ou
nettoyage automatique. Les scripts existants sont copiés avant modification
sous `.e2e/core07/preimages-e2e-20261012/`.

Le RED réel est acquis dans `2026-10-12T21-51-25-322Z` : Auth réussie puis
absence observée d'« Écarter » dans GC01. Le lecteur original qualifie 2 805
contrôles sans échec ; ses sources et archives sont conservées. L'adaptation
non contiguë de GC02 vient ensuite, avant correction produit, sans changer les
91 prérequis ni ajouter de scénario. `entry` réussie attend quatre téléchargements
et `full` six (deux primaires GC01, deux réutilisation GC01, deux réutilisation
GC02). Les préimages de cette adaptation sont sous
`.e2e/core07/preimages-noncontiguous-20261012/`.

Les gardes du plan sont exercés hors réseau avant implémentation : refus de
rejets/finalisations préparés, coût/heures/ordre altérés, UUID réemployés,
sélection inconnue, mauvais propriétaire/RMO ou chaîne native. Ces contrôles
d'admission précèdent toute insertion et ne prétendent pas prouver SQL,
connexion, comportement UI, RLS ou exports. Le lecteur indépendant refuse
sources/build mélangés, résultats filtrés/skippés/rejoués, faux RED de setup,
XLSX non lus et données sensibles dans les archives.

Le refus du rendement dérivé est préparé avec le parent2 fixé **avant** la
saisie locale, puis parent1 et champs initiaux sont rétablis sans sauvegarde.
Le vrai mode candidat démonte le formulaire (constat de code, pas reproduction
UI de la perte de saisie). L'alerte de rendu après mutation du parent n'est pas
éprouvée par ce parcours. La conservation d'un rendement local et cette garde
de rendu restent un flow futur distinct : aucun stockage de saisies locales,
parent inline ou déplacement d'état n'est ajouté ici. Les deux assertions
préparées sont le refus du handler avec parent2 fixé d'abord et la fusion hors
limite ; aucune composition temporaire n'est sauvegardée pour contourner le
démontage.

Après les trois RED NI qualifiés du13octobre, le parcours CORE-07 est adapté
avant correction produit : libellé prix exact `Coût unitaire HT (€)`, saisies
40/80,01/80 en euros pour4000/8001/8000cents ; `Pertes (%)` reste exercé par
NI03, sans inventer une saisie de pertes dans GC01–04. Les quantités et
rendements conservent leurs labels exacts. Le reader distingue les erreurs
de frappe (raw conservé, erreur liée, blocage) d'une fusion refusée sans
changement de saisie (composition locale identique et toast). Le retour à une
valeur valide n'annule jamais l'invalidation humaine : seule une vraie
revalidation autorise ensuite Apply. Les snapshots, sources, IDs, origines,
DS/heures, totaux et cellules exportées conservent leurs oracles.
