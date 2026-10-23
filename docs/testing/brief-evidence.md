# DOS-01 — Sources du brief : contrat et recette

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


## Défaillances définies avant modification

| Défaillance observable | Scénario et oracle |
| --- | --- |
| Une affirmation IA sans source hérite du document d'une autre affirmation | Réponse avec `sourceDocumentIds: []` et fallback sourcé : garder le texte, zéro lien documentaire pour cette entrée. |
| Un identifiant inventé devient indirectement une source valide de remplacement | Réponse avec ID hors inventaire : supprimer cet ID, sans lui substituer un document connu. Un mélange conserve seulement les IDs connus et uniques. |
| Le fallback associe arbitrairement une pièce à un manque | Dossier sans client ni lot détecté : client/périmètre à confirmer et pièces manquantes sans source de substitution ; inventaire des pièces reçues toujours relié au bon document. |
| Une entrée sans preuve paraît certaine, ou un lien de fichier passe pour une citation | Dans le brief réel, entrée sans lien marquée « Inférence / sans preuve directe » ; entrée avec lien marquée « Document associé » et « Passage non vérifié ». Le lien ouvre le document, sans promettre une page ou un passage inexistant. |
| Une correction conserve les sources de l'ancien texte | Modifier une entrée sourcée, enregistrer, recharger : texte corrigé conservé, ancien lien absent et mention sans preuve directe. Réordonner une entrée inchangée conserve son propre lien. |
| Une confirmation humaine transforme l'incertitude en preuve | Confirmer puis recharger : même niveau de preuve et mêmes liens. « Confirmé » ne veut pas dire « citation vérifiée ». |

## Exception d'isolation

Les réponses adverses ou incomplètes du fournisseur IA (liste vide, ID inventé,
liste mixte, texte absent) ne sont pas reproductibles de façon garantie en
appelant un modèle vivant. Les régressions de normalisation sont donc écrites
avant le correctif dans `src/lib/affaires/intake-server.test.ts`. Elles vérifient
une défaillance d'intégrité de l'attribution, pas la formulation du prompt.
L'édition et le retrait de sources disposent déjà d'une régression serveur
dans ce fichier. Les tests de composant existants sont conservés et leur
attente de libellé est mise à jour ; aucune nouvelle isolation de copie UI.

La recette principale reste le parcours navigateur avec données persistées
dans un environnement isolé : préparer une affaire ARMY, deux entrées de
périmètre dont une sans lien et une associée à un document réel ; lire leurs
niveaux de preuve, ouvrir le lien documentaire, modifier l'entrée sourcée,
enregistrer, recharger et confirmer. Vérifier les textes et liens exacts après
chaque étape. Ne pas considérer une collection de tests comme une exécution.

## Contrat de cette tranche

Le modèle existant conserve le texte du brief et les liens séparément. Zéro
lien reste zéro lien lors de la projection et de la persistance ; l'interface
en dérive l'avertissement. Aucune migration ni valeur de confiance inventée.
Un ID valide établit seulement l'association à un document du dossier, pas
la véracité de l'affirmation. Les liens des anciens briefs restent consultables
avec cette même réserve ; ils ne sont pas rétroactivement certifiés.

Le brief actuel ne stocke ni citation exacte ni page/version documentaire
approuvée. Cette tranche ne prétend pas les créer. L'extraction et la validation
des passages, la référence documentaire et la propagation des révisions
relèvent des lots suivants. Les pièces reçues sont un inventaire, pas une
affirmation technique ; leur liste ne reçoit pas l'étiquette « inférence ».

## Preuves à conserver

Pour chaque exécution : commande, révision et changements locaux, environnement
isolé, identifiants de fixture sans secrets, résultats attendus/réels, chemins
des rapports et empreintes. Aucun appel IA vivant ni écriture partagée n'est
nécessaire à la régression de normalisation. La preuve d'édition persistant
après rechargement nécessite la recette navigateur et ne se déduit pas de
Vitest.

## Résultats locaux — 11 octobre 2026

- Avant correctif, `npm test -- --project=node src/lib/affaires/intake-server.test.ts`
  reproduit **3 échecs / 7 succès** : substitution d'ID absent, substitution
  d'ID inventé et maintien d'un ID de fallback hors inventaire. Un premier
  essai sandbox a échoué avant chargement des tests (`EPERM` de renommage du
  cache Vitest) ; l'exécution identique hors sandbox a produit ces échecs métier.
- Après correctif, la même commande passe **10/10**. Les cas existants de
  réattribution après édition et de sauvegarde sans changement restent verts.
- `npm test -- --project=jsdom src/components/affaires/BriefDraftCard.test.tsx` :
  **7/7** tests conservés passent. Ce résultat ne prouve pas la persistance DB.
- ESLint sur les quatre fichiers source/test touchés et
  `e2e/army/local/brief-evidence.e2e.ts`, puis `git diff --check` : succès.
  Typecheck et build sont centralisés par la livraison coordinatrice.

Le parcours `e2e/army/local/brief-evidence.e2e.ts` est écrit, hors campagne
partagée par défaut. Il exige `E2E_BRIEF_EVIDENCE_PROJECT_ID` et
`E2E_BRIEF_EVIDENCE_DOCUMENT_ID`, un backend Supabase loopback et une session
`army` obtenue par connexion ordinaire. Il ne crée pas lui-même la fixture.
Le brief préseedé est confirmé, contient `ARMY calorifuge sans justificatif`
sans lien et `ARMY supportage associé au document` avec un lien vers
`ARMY-CCTP-reference.txt`. Le test ouvre le lien, remplace la seconde entrée
par `ARMY supportage corrigé sans justificatif`, recharge, confirme et recharge
encore. Il vérifie à chaque étape les liens et l'incertitude ; il conserve un
résultat JSON avec les IDs de fixture, sans secret.

## Recette persistante vérifiée — production locale

Le scénario brief a **réussi** sur Chromium desktop le 11 octobre 2026 à
02:53:46 UTC (04:53:46 à Paris), en 3 434 ms. Les 29 étapes du scénario sont
passées : association documentaire et absence de preuve visibles, navigation
vers la pièce du dossier, modification, sauvegarde, premier rechargement,
reconfirmation puis second rechargement. Le reçu final retrouve exactement
`ARMY supportage corrigé sans justificatif`, zéro lien documentaire sur cette
entrée, l'avertissement sur les deux entrées et le brief confirmé.

Commande de la campagne coordinatrice :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs rounding brief orders --production
```

Archive : `.e2e/product-foundation/runs/2026-10-11T02-52-53-541Z/`.
Le `manifest.json` fixe la révision
`ce5874f54f8202297b74e4ed238e5c48e49d2f1b` avec changements locaux conservés
dans `source.diff` et `source-status.txt`, et `source.changedDuringRun=false`.
Build de production **local** `5OPtggZhYWtSC_z3MGQXs`, justificatif de build
`.e2e/product-foundation/builds/2026-10-11T02-51-16-198Z` ; Node 24.19.0,
application `http://localhost:3117`, Supabase isolé
`http://127.0.0.1:59827`, connexion UI ordinaire et traces authentifiées coupées.

Le run global reste **en échec** : cinq résultats exécutés, trois passés
(connexion, arrondis historiques, brief), deux échoués (autre scénario
d'arrondi et préparation des achats), zéro ignoré. La réussite du brief ne
requalifie ni cette campagne complète ni les autres fonctionnalités.

Les SHA-256 du rapport et du reçu brief ont été recalculés lors de cette
mise à jour et correspondent au manifeste :

| Artefact dans l'archive | SHA-256 |
| --- | --- |
| `report.json` | `4cedf1db2b0c2fefe19043eb5619026651f8ba6b99cc439a6fd49c040d83e7e0` |
| `business-evidence/business/ARMY-brief-1791687229589-brief-evidence.json` | `2bc033d811527a57ba8f8d8c0baba99d03051664010049e8838e5870b2b036a3` |

Fixture conservée : affaire `dd70588e-2f4d-4ad8-9b28-a6bc4226b6c1`, brief
`aeaac9f1-9a00-4d37-9236-4af4b6854dc1`, document
`0908d97d-3e9f-4f1d-92cb-e852047246cd`. Le manifeste de préparation rapporte
un vrai fichier TXT dans le Storage local, empreinte
`dc181cf903a531534241e7716078c0603247a739ee4502a7cdd3a88d7bc7c2cc`.
Le scénario vérifie son association et la navigation vers sa fiche ; il ne
lit ni ne certifie un passage de ce fichier. « Passage non vérifié » demeure
donc le contrat exact.

Cette fixture est désormais **éditée et reconfirmée**, avec l'ancien lien de
la seconde entrée retiré. Rejouer le scénario initial exige une **nouvelle
fixture** avec le contrat de départ ci-dessus et ses deux IDs transmis au
runner ; ne pas réinitialiser silencieusement la preuve conservée. La recette
ne couvre pas l'extraction IA vivante, les citations/pages, le versionnement
documentaire, les pannes entre écritures ou la concurrence, ni un déploiement
partagé. Les limites d'isolation documentées plus haut restent applicables.
