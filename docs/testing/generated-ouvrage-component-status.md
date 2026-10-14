# Composants écartés — contrat avant recette et correction

Le statut `rejected` existe dans le sous-détail proposé. La lecture du code
montre que le résumé serveur, le total de l'éditeur et la projection avant
application parcourent actuellement tous les composants. L'éditeur affiche
aussi « Suggéré » pour tout statut autre que `manual`. Ces faits de source ne
constituent pas encore une reproduction dans l'application ; CORE-07 reste
ouvert et aucun correctif n'est revendiqué.

Un composant écarté doit rester consultable dans la revue et sa provenance,
mais ne doit contribuer ni au coût retenu, ni aux heures, ni à la bibliothèque
ou à la ligne appliquée. Un composant retenu à coût nul reste un cas distinct.
La réactivation explicite doit revenir dans le calcul ; une composition sans
composant retenu doit demander une nouvelle décision plutôt que produire un
ouvrage présenté comme validé.

| Défaillance à reproduire avant correction | Oracle du parcours réel |
| --- | --- |
| Un composant écarté est présenté comme suggéré et compté | Témoin ARMY neuf avec deux propositions, ouverture du vrai sous-détail puis décision explicite d'écarter par UI ; libellés distincts et somme des seuls composants retenus. Si l'action manque, conserver cette capacité absente sans préinsérer la décision. |
| La revue et l'application utilisent des compositions différentes | Revue par UI, sauvegarde, reload puis application ordinaire ; même coût et mêmes heures dans la revue, la ligne persistée, le pied du devis et les cellules standard/DPGF exportées |
| Le composant écarté revient lors de la réutilisation | Relire la bibliothèque créée et l'utiliser dans un second devis neuf ; seuls les composants retenus participent au chiffrage, sans perdre la trace de la proposition écartée dans la première revue |
| Un retour tardif applique une revue antérieure à l'exclusion | Conserver la vraie intention antérieure, modifier explicitement la composition puis reprendre ; refus de revue périmée, aucune ligne ajoutée et état financier inchangé |
| Un reload ou une reprise perd la décision | Lectures ordinaires API/RLS après sauvegarde et après reprise ; statuts, composition, coût, heures et provenance exacts, aucune réactivation implicite |
| La composition entièrement écartée est finalisée | Action explicite depuis l'interface ; motif observable, absence de nouvelle ligne/bibliothèque/application et conservation du brouillon |

Exécuter les témoins avant de modifier le produit, avec un build de production,
TesterArmy sans modèle ni traces authentifiées et des assertions chiffrées.
Conserver les observations avant assertion et chaque échec. Les fixtures
préparent des propositions, jamais une décision finale, un coût attendu déjà
appliqué ou un résultat d'export. La future correction devra suivre le même
contrat atomique d'application et conserver les refus de tenant, rôle et revue
périmée. Ce contrat ne déclenche aucune migration ou écriture en base.

Sources inspectées : `src/lib/estimates/generated-ouvrages.ts`
(`buildGeneratedOuvrageSubdetailSummary` et projection avant application),
`src/components/estimates/GeneratedOuvrageSubdetailEditor.tsx` (somme et badges),
`src/lib/estimates/generated-ouvrage-review.ts` (statuts admis).
