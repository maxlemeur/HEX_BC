# CAT-F01 — Provenance des offres, recette HTTP locale

## Défaillances définies avant le scénario et le correctif

L'update historique `POST /api/prices`, `action: "update"`, doit vérifier la
provenance finale de l'offre, y compris lorsque un seul identifiant change.
Chaque ID non nul appartient au tenant de l'offre ; lorsque les deux existent,
la ligne appartient à l'import. Une référence humaine validée n'est pas
recalculée par une modification de provenance.

Fixture technique fournie par le coordinateur dans
`.e2e/catalogue-provenance/http-fixture.json` : `apiUrl`, `userId`, `tenantId`,
`otherTenantId`, imports `importA1`, `importA2`, `importB1`, lignes `rowA1`,
`rowA2`, `rowB1`. Les lignes correspondent respectivement aux trois imports ;
A est le tenant actif du compte ARMY, B un tenant local indépendant. Le fichier
ne contient aucun secret. Les scénarios refusent tout backend hors loopback
et tout écart avec l'origine enregistrée dans cette fixture.

| Cas | État initial / modification | Attendu |
| --- | --- | --- |
| Import étranger seul | Sans source → import B1 | HTTP 400, offre entière inchangée |
| Ligne étrangère seule | Sans source → ligne B1 | HTTP 400, offre entière inchangée |
| Paire étrangère | Sans source → import B1 + ligne B1 | HTTP 400, offre entière inchangée |
| Paire incohérente du même tenant | Sans source → import A1 + ligne A2 | HTTP 400, offre entière inchangée |
| Import partiel | Import A1 + ligne A1 → import A2 seulement | HTTP 400 ; ligne A1 conservée, aucune mutation |
| Ligne partielle | Import A1 + ligne A1 → ligne A2 seulement | HTTP 400 ; import A1 conservé, aucune mutation |
| Paire cohérente | Sans source → import A1 + ligne A1 | HTTP 200, deux IDs relus exactement |
| Omission des champs | Paire A1 conservée, seules les notes changent | HTTP 200, provenance identique |
| Import seul | Paire A1 → effacement explicite de la ligne | HTTP 200, import A1 conservé |
| Ligne seule | Import seul → import null + ligne A2 | HTTP 200, ligne A2 conservée |
| Effacement explicite | Ligne seule → deux IDs null | HTTP 200, deux champs null |

Chaque parcours crée un produit, un fournisseur et des offres ARMY par les
APIs de l'application, puis valide explicitement un prix manuel de référence
de 777 centimes avec justification. Une autre offre sert de témoin immuable.
Après chaque tentative, relire toutes les offres de ce produit et la référence
validée : prix, identifiant de validation, auteur, date et mise à jour du
produit inchangés ; seules les modifications autorisées de l'offre ciblée
peuvent apparaître. Les refus comparent le snapshot API complet avant/après.

Le parcours des six refus utilise des assertions souples après chaque réponse
afin de conserver les six contre-exemples lors de la première campagne RED.
Chaque cas utilise une nouvelle offre dédiée. Si la base non corrigée accepte
une provenance invalide, la réponse et le snapshot corrompu sont archivés
avant de restaurer les deux IDs de cette seule offre ARMY par l'API. La
restauration est relue et enregistrée séparément, sans effacer les preuves ni
l'historique. Elle permet ensuite la validation de la contrainte SQL locale.
Un seul refus manquant fait échouer le scénario. Les fixtures restent
identifiables et conservées ; aucun enregistrement n'est supprimé.

## Exécution et frontières

Fichier : `e2e/army/local/catalogue-provenance.e2e.ts`. Les deux titres
contiennent `local catalogue provenance`. Le coordinateur configure le runner
isolé et la session `army` obtenue par connexion normale. Les traces restent
désactivées ; aucun jeton n'est lu et aucun service-role, email ou changement de
statut n'est utilisé. La première exécution doit précéder l'application de la
migration de correction sur la base locale.

Les JSON `recordEvidence` conservent IDs, patch envoyé, réponse HTTP,
snapshots avant/après, attendu et observé. Le runner archive commande, révision,
modifications locales, configuration, environnement, rapport et empreintes.

Cette recette qualifie les APIs ordinaires de l'application. Elle ne démontre
ni l'accès direct Data API, ni l'intégralité de l'historique SQL des offres,
ni toutes les politiques RLS. Le champ `latest_validation` de l'API ne contient
pas l'instantané complet des offres de la validation. Ces frontières sont
vérifiées séparément par le probe SQL natif. L'UI actuelle n'expose pas les
liens d'import de la proposition (CAT-F02) : cette recette ne revendique pas
une navigation documentaire qui n'existe pas encore.

## Résultats exécutés le 11 octobre 2026

Sur le même build local de production `OiZfxTcX7ZyRQ0fbNISSs`, avec connexion
ordinaire et sources stables :

| Archive sous `.e2e/product-foundation/runs/` | Résultat |
| --- | --- |
| `2026-10-11T03-31-02-668Z` | Première tentative : les six défauts sont observés, mais le témoin compare à tort la réponse enrichie du POST à celle du GET. Deux parcours échouent ; cette tentative ne qualifie pas les témoins. |
| `2026-10-11T08-06-12-695Z` | RED après correction du témoin pour comparer deux lectures GET complètes : connexion et parcours légitime passent ; les six refus attendus renvoient 200 et modifient l'offre. Douze assertions échouent exactement sur ces deux conséquences. |
| `2026-10-11T08-12-11-132Z` | GREEN après migration locale : **5/5 exécutés passent**, aucun ignoré. Connexion, deux parcours de provenance et deux parcours CSV DPGF existants. Zéro appel de modèle. |

Le correctif local est la migration
`20261011080708_supplier_price_provenance_integrity.sql`, SHA256
`ee7bc1422e520177cf969147ee3e089496eff23b4aa428dab46e3e6a1b1bf6d8`.
Les six opérations invalides renvoient désormais 400 sans modifier le snapshot
des offres ni leur référence humaine à 777 centimes. Paire valide, omissions,
provenance partielle et effacement explicite restent acceptés et relus.

Les deux imports CSV passent par dépôt de fichier, mapping et confirmation
du contrat partagé. Ils préservent les trois lignes, quantité décimale,
quantité nulle, montants exacts et provenance canonique : total HT 9 625,
TVA 1 925 et TTC 11 550 centimes. Cette campagne ne qualifie pas XLS/XLSX/PDF.

Commande du GREEN, depuis la racine, avec les variables de recette locale
déjà préparées :

```powershell
$env:GIT_INDEX_FILE = Join-Path (Get-Location) '.e2e/git-index-recovery/head.index'
$env:GIT_OPTIONAL_LOCKS = '0'
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs provenance dpgf --production
```

La substitution d'index sert seulement à la preuve des sources : l'index Git
initial est devenu illisible, rempli de zéros, et reste conservé sans
réécriture. Le reçu `.e2e/git-index-recovery/receipt.json` documente la
comparaison des fichiers à HEAD et la limite sur l'état de staging. Aucun
fichier produit nul n'a été trouvé parmi les 2 010 fichiers inspectés.

Aucune application distante, publication ou qualification de production.
La protection des écritures natives et parents est vérifiée séparément dans
[la recette SQL](catalogue-provenance-sql.md).
