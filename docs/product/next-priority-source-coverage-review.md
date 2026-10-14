# Prochaine priorité : première revue humaine de couverture CCTP → chiffrage

Recommandation PO du 11 octobre 2026, après lecture de l'audit, du backlog,
du journal de progression et des sources actuelles. Inspection en lecture
seule ; aucun scénario supplémentaire exécuté pour cette recommandation.
Le journal de progression conserve encore SITE-01B comme prochaine priorité
au moment de cette lecture : les preuves SQL locales plus récentes sont dans
[sa qualification dédiée](../testing/purchase-decimals-sql.md). La recette
applicative de cette tranche reste suivie par sa campagne propre.

## Décision recommandée

**Après fermeture de la recette SITE-01B, réaliser une seule tranche verticale :
une revue humaine du calorifuge reliant les exigences d'un CCTP de référence
aux prestations et lignes effectivement chiffrées.** La référence documentaire
est explicitement figée pour cette revue. Les preuves, décisions et changements
à revérifier restent consultables après rechargement.

Cette tranche, nommée ici **DOS-CAL-01**, prend le minimum de DOS-02 nécessaire
à une référence reproductible et la première partie humaine de DOS-03/DOS-05.
Elle ne prétend terminer aucun de ces lots complets. Sa valeur est de permettre
au chiffreur de répondre : « Où ai-je traité cette obligation, pour quelle
zone et avec quelle preuve ? », y compris quand la DPGF ne contient pas une
ligne portant exactement son nom.

La prochaine tranche achats [SITE-01C proposée](purchase-quantities-remainders-next-notes.md)
reste pertinente, mais sa priorité baisse maintenant que la préparation et
les quantités ont un socle fiable localement. Acheter correctement ce qui est
déjà chiffré ne détecte pas une prestation oubliée avant remise de l'offre.
La continuité exigences → prestations → ressources est l'écart central de la
vision, explicitement identifié dans [l'audit](../audit/vision-produit-2026-10-11.md).

## Comparaison avec les autres pistes

| Piste | Existant et écart actuellement établis | Décision pour la prochaine tranche |
| --- | --- | --- |
| Dossier et couverture technique | Le registre gère `assumption` et `missing_piece`, des statuts de décision et un seul périmètre `scopeId`. Ce n'est pas une relation entre une exigence et plusieurs lignes qui la couvrent. Voir [modèle du registre](../../src/lib/affaires/register.ts). | Priorité : rendre cette relation utilisable par un humain sur un cas CVC borné. |
| Référence documentaire | Un CCTP/DPGF principal existe ; faute de principal explicite, le code choisit le plus ancien. Le changement de principal utilise plusieurs écritures successives. Voir `pickPrimaryDocumentForKind` et `setAffaireDocumentAsPrimary` dans [intake-server](../../src/lib/affaires/intake-server.ts). | Dépendance réelle de la revue : choix explicite et décision atomique/versionnée. La course est un risque de source à reproduire, pas un incident déjà démontré ici. |
| Imports PDF et métrés | L'import PDF tabulaire et le contrat canonique existent. Le PDF dispose déjà d'un worker Node terminable : `createPdfJsWorker` et `runPdfJsWorkerWithDeadline` dans [l'extracteur](../../src/lib/imports/tabular-pdf-extraction.ts). Les métrés possèdent preuves localisées et gardes d'application. La recette actuelle n'établit pas pour autant tous les formats ni tous les plans clients. | Réutiliser le chemin connu pour le dossier pilote ; conserver CORE-04 et DOS-04 ouverts. Ne pas reconstruire un extracteur ni conditionner la première revue humaine à un OCR général. |
| Ouvrages CVC | Assemblages, revue de sous-détail et snapshots faits/hypothèses/inférences existent. L'application crée une copie canonique d'ouvrage et des lignes ; une instance paramétrique durable par réseau/zone reste un chantier plus large. Voir [ouvrages](../../src/lib/estimates/generated-ouvrages.ts) et [provenance](../../src/lib/estimates/generated-ouvrage-provenance.ts). | Un sous-détail existant peut servir de preuve d'inclusion du calorifuge. Aucun rendement d'entreprise ni moteur paramétrique nouveau n'est nécessaire au premier rapprochement humain. |
| Coûts internes et DPGF client | L'export DPGF parcourt l'arbre des lignes existantes ; la correspondance générale entre organisation interne et structure commerciale reste incomplète. Voir [export DPGF](../../src/lib/estimates/dpgf-export.ts). | Relier une exigence à la ressource ou au sous-détail qui la traite et à ses lignes courantes, sans imposer une nouvelle ligne commerciale. La ventilation financière indépendante relève toujours d'EST-02. |
| Achats partiels et reliquats | Ils exigent un vrai besoin validé, des allocations et une libération explicite. Le transfert initial ne suffit pas à calculer un reliquat certain après correction. | Différer SITE-01C ; ne pas inventer un reliquat à partir de commandes courantes ou du seul statut « reçue ». |

Le compteur de fin d'affaire signalé par la recette — quatre lignes dites
commandables pour trois préparables et une déjà transférée — a une portée plus
petite. La lecture de [finish-line-server](../../src/lib/affaires/finish-line-server.ts)
confirme que ses compteurs dérivent des lignes de fourniture et de la couverture
fournisseur, sans lecture du registre de transfert dans ce calcul. Son contrat
de libellé/compteur doit être corrigé et vérifié de façon ciblée. Il ne justifie
pas de transformer cette correction en implémentation complète des reliquats.
L'observation navigateur est celle de la recette en cours, pas une nouvelle
exécution de cette inspection.

## Dépendances réelles et limites du lot

1. **Une référence contrôlée pour la revue.** Réutiliser dépôt, documents,
   événements et accès Storage existants. Identifier explicitement le CCTP
   retenu et la version de devis examinée, avec identité du contenu ou preuve
   d'immutabilité équivalente. Déposer une autre pièce ne change pas ce choix.
   Le lot n'exige pas encore une généalogie complète de tous les plans/emails.
2. **Un modèle de couverture distinct d'une hypothèse validée.** Conserver une
   exigence, son passage, sa zone/réseau, ses liens multiples et une décision
   de couverture. Réutiliser le journal et les composants utiles du registre,
   sans renommer simplement `validated` en « chiffré ». Une validation
   d'hypothèse et une couverture technique portent des sens différents.
3. **Un petit oracle explicite avant code.** Préparer un CCTP texte local et
   un devis pilote avec calorifuge dédié, inclus dans un ouvrage, exclu, autre
   lot, provisoire et non rapproché ; deux zones empêchent une inclusion trop
   large. Les attentes techniques doivent être relues par un chiffreur avant
   de revendiquer une validation métier. Des fixtures techniques déterministes
   peuvent être préparées et utilisées immédiatement.
4. **Droits et invalidation ciblés.** Identités tenant/affaire/version/lignes
   vérifiées au serveur, accès à la pièce contrôlé, révision de décision
   vérifiée à l'écriture. Changement de référence ou de ligne liée rend la
   décision concernée à revérifier ; il ne remplace pas silencieusement son
   historique.

Il n'est pas nécessaire d'attendre extraction IA exhaustive, OCR scanné,
correspondance financière EST-02, paramétrage CVC EST-01 ou achats partiels.
L'absence de ces fonctions limite ce que le lot peut déclarer, mais n'empêche
pas le travail manuel utile. La qualification complète des imports et les
conditions d'exploitation FND-02/FND-03 demeurent des exigences distinctes de
mise en service ; cette recommandation ne les déclare pas résolues.

## Cinq critères de fin observables

1. **Référence explicite et stable.** Pour CCTP A puis CCTP B, le dépôt de B ne
   change pas la revue liée à A. La sélection explicite de B conserve auteur,
   date, motif et ancienne référence, puis marque les décisions concernées à
   revérifier. Deux choix concurrents ne produisent pas deux références actives
   ni un succès ambigu ; le choix perdu reçoit un conflit explicite.
2. **Preuve consultable et tous les états représentés.** Le chiffreur saisit
   les exigences du petit oracle, avec document, page/passage et zone/réseau.
   Après rechargement, il retrouve chiffré, inclus ailleurs, exclu, autre lot,
   provisoire et non arbitré. Inclusion, exclusion et autre lot ont une
   justification. Un rapprochement absent s'affiche comme incertitude, sans
   alerte affirmant automatiquement une omission. Une association de fichier
   seule ne s'affiche pas comme passage vérifié.
3. **Couverture réelle, indépendante du nom commercial.** Une exigence peut
   pointer vers deux lignes et être retrouvée depuis chacune. Le calorifuge
   inclus dans le sous-détail d'un ouvrage est accessible avec la ressource et
   le périmètre justifiant l'inclusion. Une inclusion de zone A ne couvre pas
   zone B. Aucun doublon de ligne DPGF, coût, heure ou quantité n'est créé par
   la décision de couverture ; montants et exports du devis restent identiques.
4. **Décision qui vieillit correctement.** Modifier ou supprimer une ligne
   liée invalide sa couverture concernée, tout en conservant l'ancienne preuve
   et l'auteur. Une autre zone inchangée conserve sa décision. Une sauvegarde
   depuis une révision périmée est refusée. La revue continue de fonctionner
   sans appel à un modèle, y compris après rechargement.
5. **Parcours et confidentialité démontrés.** Une recette TesterArmy ordinaire
   couvre création des liens, décisions, retour à la preuve, modification et
   rechargement avec assertions exactes. URL/API/pièce d'un autre tenant sont
   refusées ; le document client ne révèle ni coûts internes ni notes de revue.
   Les cas de concurrence et d'intégrité impossibles à exposer correctement
   par l'UI ont leurs régressions natives écrites avant l'implémentation.

Une fois ces critères satisfaits, le prochain arbitrage peut comparer le gain
de cette revue au besoin d'extraction automatisée ou d'achats partiels. Il sera
alors fondé sur le travail réellement accompli et les incertitudes restantes,
plutôt que sur la facilité de prolonger le module déjà ouvert.
