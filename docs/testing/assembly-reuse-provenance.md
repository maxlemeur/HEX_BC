# Provenance lors de la réutilisation d'un ouvrage

Contrat arrêté avant la nouvelle migration avec le responsable SQL et le
coordinateur, le 13 octobre 2026. Aucune nouvelle fixture ou campagne n'est
créée par ce document.

Full06 passe les cinq résultats et six XLSX sous son ancien contrat financier.
Son archive `2026-10-12T23-55-18-571Z` (SHA manifeste
`a629851c4a90597005bfdd13fdc321e135738f9a88f7b328b7e9add4661ed8cd`)
et sa qualification à 3 469 contrôles restent intactes. Une observation
complémentaire relit ses deux devis de réutilisation : les quatre lignes portent
`source_provider: manual` et `source_metadata: {}`. L'ancien lecteur n'assertait
pas cette provenance ; sa réussite ne la qualifie pas.

La source immédiate d'une ligne réutilisée est la bibliothèque. Le contrat est :

```json
{
  "source_provider": "assembly_library",
  "source_metadata": {
    "kind": "assembly_library",
    "library_origin": {
      "assembly_id": "identifiant de l'ouvrage feuille",
      "assembly_item_id": "identifiant de son item",
      "source_metadata": "copie JSON exacte de la provenance originale de l'item"
    }
  }
}
```

Les valeurs d'exemple désignent des UUID et une valeur JSON, sans prescrire
une chaîne pour la dernière propriété. Une valeur legacy, y compris `{}` ou
JSON null, doit être copiée exactement. Le namespace `library_origin` protège
l'origine feuille : le caller takeoff peut écrire un autre `assembly_id` de
racine à plat. Aucun fait, niveau de confiance, application/snapshot IA ou lien
CCTP direct ne peut être inventé à plat depuis cette copie.

| Défaillance | Assertion ajoutée aux GC01 et GC02 existants |
| --- | --- |
| L'origine devient manuelle ou disparaît dans un sérialiseur | Réponse réelle d'insertion, GET immédiat, sauvegarde/reload et RLS ordinaire retrouvent le wrapper exact et le provider bibliothèque. |
| Deux lignes sont associées à un mauvais item | Associer uniquement par `library_origin.assembly_item_id`, imposer les deux IDs distincts de la bibliothèque liée au snapshot et comparer la copie JSON entière. Des fragments identiques ne sont pas une identité. |
| La source appartient à un composant écarté ou les coûts/heures sont attribués au mauvais item | IDs retenus [0,1] pour GC01, [1,2] pour GC02 ; type/coût/heures et citation de chaque item restent associés à sa ligne. La MO0€ conserve son heure et son identité. Les oracles financiers existants restent identiques. |
| La copie est présentée comme une application IA/CCTP directe | Le wrapper représente la bibliothèque ; aucune clé directe application_id/snapshot_id/draft_id ou facts/confidence aplatie dans cette insertion ordinaire. |
| L'origine est cachée ou la confiance historique est présentée comme actuelle | Après réutilisation, ouvrir le vrai menu de chaque ligne puis le badge « Bibliothèque » (`aria-label` : Afficher la provenance de la bibliothèque). Vérité accessible Bibliothèque d'ouvrages / Qté à confirmer / Confiance non mesurée ; tooltip sans pourcentage historique. Le niveau faible reste interne au besoin de revue, sans transformer un score null en mesure affichée. Popover Origine : bibliothèque d'ouvrages, message de contrôle du devis actuel et lien /dashboard/estimates/assemblies ; aucun UUID, attribution IA/snapshot directe ou mutation API/RLS. L'API n'expose pas un score de vérité : le score null est observé par son effet UI non transposé, pas par un champ inventé. |

`source_provider` est actuellement du texte libre, pas un enum fermé.
Le client conserve les lignes de l'API et le serveur ne normalise que leurs
champs financiers. L'OpenAPI des items utilise `passthrough` sans documenter
ces champs explicitement : le writer produit devra décrire ce contrat et
régénérer/valider son artifact. Cette tranche de harnais ne modifie ni produit,
finance, temps, SQL ou politique de skips et ne lance pas de DB/navigateur.

Observation complémentaire hashée :
`.e2e/core07/provenance-reuse-red/682606cf-47d4-4476-9652-b227545cccdf/observation.json`,
SHA `12bd337f06bdb1b0ea0538b1a7d5a8376bd094c334181305b6e4f81b873c8aea`.
La branche nested/takeoff et les valeurs JSON legacy relèvent de la qualification
SQL ; ces deux parcours navigateur sont limités à la bibliothèque directe
créée par leur vraie revue.

Revue du 13 octobre : une MO payante stocke son coût unitaire dans la
bibliothèque, mais sa ligne matérialisée conserve un PU matière nul ; son coût
est porté par heures, taux du rôle et coefficient MO. L'oracle de provenance
doit conserver ce contrat. Avant correction du lecteur, ajouter les vecteurs
MO payante avec PU matière nul (accepté) et coût MO copié en PU matière
(refusé). La MO gratuite seule ne détecte pas cette erreur d'oracle.
