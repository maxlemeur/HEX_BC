# CORE-01 — arrondi commercial au palier inférieur

## Défaillances et scénarios définis avant l'implémentation

| Défaillance observable | Scénario et oracle indépendant |
| --- | --- |
| Le wizard ou le paramétrage choisit l'arrondi au plus proche et augmente le montant | Nouvelle version EUR, marge 1, TVA 20 %, une ligne de 760,63 € HT : TVA 152,13 €, TTC calculé 912,76 €. Pas de 1 € : `down`, TTC à payer 912,00 €, ajustement −0,76 €. |
| Le choix affiché ne correspond pas au réglage sauvegardé | Modifier le pas, enregistrer, relire l'API puis recharger : mode et pas inchangés. |
| Le pas n'est pas appliqué, ou l'arrondi est cumulatif | Même 912,76 € : pas 10 € → 910 €, pas 50 € → 900 €, pas 100 € → 900 €. Désactiver → 912,76 €. Le HT et la TVA comptable affichée restent 760,63 € et 152,13 €. |
| Un montant exact perd un palier | Une ligne de 760,83 € HT : TVA 152,17 €, TTC 913,00 €. Pas 1 € → 913,00 €. |
| L'export ou l'impression confond la TVA et l'ajustement commercial | XLSX et impression : HT 760,63 €, TVA 152,13 €, TTC calculé 912,76 €, ajustement −0,76 €, montant à payer 912 €. DPGF : HT/quantité/unité inchangés ; ce format ne porte pas le pied commercial TTC. |
| Un ancien réglage est affiché « Aucun » ou converti sans choix explicite | Nouveaux brouillons ARMY préparés avec anciens modes `nearest` et `up`, ainsi qu'un pas `down` atypique de 2,50 €. Libellé historique explicite ; modifier seulement le titre puis enregistrer conserve mode, pas et totaux. |

Le moteur, ses arrondis comptables et les snapshots historiques ne sont pas
modifiés. Le plancher existant qui interdit un TTC inférieur au HT, et le
court-circuit de l'arrondi en autoliquidation, restent applicables. Il ne faut
donc pas présenter l'option comme une réduction garantie pour tout régime.
Le contrat de stockage historique `total_tax_cents` inclut l'ajustement
commercial ; il n'est pas l'oracle de TVA comptable. Les sorties XLSX et
d'impression sont contrôlées séparément sur leur TVA et leur ajustement.

## Périmètre de preuve

Le scénario TesterArmy `commercial rounding` utilise le login normal et crée
seulement ses propres brouillons ARMY. Les réglages passent par les vraies
interfaces ; les lectures API et les cellules des fichiers téléchargés servent
d'oracles. Les fixtures et JSON conservent les montants, versions et réglages ;
les classeurs sont conservés avec SHA-256. Le manifeste du wrapper conserve la
commande, la révision, les modifications locales et l'environnement.
Un runner isolé peut indiquer son répertoire de téléchargements par
`E2E_ARMY_ARTIFACT_ROOT` ; le défaut est `.e2e/army/critical/artifacts`.

```powershell
npm run e2e:army:critical -- --grep "commercial rounding"
```

Aucune fixture de catalogue, aucun modèle et aucun abonnement agent ne sont
nécessaires. L'environnement connecté et le compte doivent être autorisés par
le responsable de l'exécution. Les traces authentifiées restent désactivées.

Les campagnes critiques interdisent l'envoi et les mutations de statut. Ces
scénarios ne créent donc pas d'offre émise. Leur non-réécriture est à qualifier
séparément sur une fixture locale émise ; les tests existants de snapshots et
de calcul restent une preuve spécialisée, pas une exécution E2E de cet état.

La recette locale finale du 11 octobre 2026 est réussie ; ses preuves et ses
limites sont consignées ci-dessous. Les échecs intermédiaires restent conservés.

## Diagnostic de la première recette locale

L'archive `.e2e/product-foundation/runs/2026-10-11T02-52-53-541Z/`
montre un succès du parcours historique et un échec du premier oracle de pied
sur la création. La préparation par `createLineViaApi` avait inséré directement
la ligne à 760,63 € sans action de sauvegarde de l'éditeur. Cette API calcule
les montants de la ligne, puis renvoie le jeton de version ; elle ne recalcule
pas le pied sauvegardé. Celui-ci était encore à zéro, alors que l'interface
capturée affichait correctement 760,63 € HT, 152,13 € de TVA, 912,76 € calculés
et 912,00 € à payer.

Le scénario prépare désormais une ligne neutre, effectue la saisie dans la
grille puis une sauvegarde explicite par Ctrl/Cmd+S avant de vérifier le pied
persisté. L'oracle et son délai sont inchangés ; ce correctif de fixture ne
transforme pas l'exécution échouée en succès. Un replay était nécessaire.

Le replay `.e2e/product-foundation/runs/2026-10-11T02-57-32-665Z/`
passe la création, la sauvegarde, les différents pas et le pied XLSX standard,
puis échoue sur le repérage de la ligne DPGF. La lecture du classeur téléchargé
confirme pourtant une ligne à quantité 1, unité `u` et prix HT 760,63 €. Sa
désignation comporte les six espaces d'indentation des trois niveaux de
sections, prévus par l'export. Le sélecteur de ligne du test normalise
désormais ces espaces avec `trim()`, comme le scénario d'intégrité existant.
Les oracles de quantité, unité et prix sont conservés. À ce stade,
l'impression et la borne exacte 913 € n'étaient pas encore qualifiées.

## Recette locale finale — 11 octobre 2026

Commande exécutée :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs rounding --production
```

Archive : `.e2e/product-foundation/runs/2026-10-11T02-59-19-091Z/`.
Le rapport et le manifeste concordent : **3 résultats sélectionnés, exécutés
et réussis sur 3**, dont le login ordinaire et les deux scénarios d'arrondi ;
aucun échec, flaky ou saut. Aucun appel modèle, deux classeurs téléchargés.
Exécution sur Chromium desktop, Node 24.19.0, serveur de production local
`http://localhost:3117`, Supabase isolé `http://127.0.0.1:59827`, traces désactivées.

La source enregistrée est `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`
avec le diff local archivé ; `source.changedDuringRun` vaut `false`.
Le build `5OPtggZhYWtSC_z3MGQXs` est celui préparé dans
`.e2e/product-foundation/builds/2026-10-11T02-51-16-198Z/`.
Les trois empreintes de build du manifeste correspondent encore aux fichiers
vérifiés. Les **30 artefacts archivés** ont été relus et leurs SHA-256 vérifiés,
sans divergence.

Le premier scénario observe 912,76 € → 912,00 € au pas de 1 €, 910 € au pas
de 10 €, 900 € aux pas de 50 € et 100 €, puis 912,76 € après désactivation.
Les paramètres et totaux persistent après sauvegarde et rechargement. Le cas
exact 913,00 € reste à 913,00 €, avec ajustement nul. La version créée porte
l'identifiant `834ceabe-031c-4a19-821a-8e3f3b2c7e22` ; les autres identités sont
dans les JSON de fixtures.

La relecture indépendante des deux classeurs téléchargés confirme le pied
standard **760,63 / 152,13 / 912,76 / −0,76 / 912,00 €** et la ligne DPGF
**1 / u / 760,63 €**. L'artefact DOM d'impression contient le même pied.
Le second scénario conserve `nearest`, `up` et le pas `down` atypique de
2,50 € après modification et sauvegarde du titre, avec contrôle du nouveau
titre par API et après rechargement.

| Preuve dans l'archive | SHA-256 vérifié |
| --- | --- |
| `manifest.json` | `05384847b2fede6267692ca554cc02304aa1dbcea8d7174c6bfa1027c22eab0c` |
| `report.json` | `6079986f4fbf9a4b490f1129eb4cc1e71b8989bc72127512cbb7fda3c9217fb9` |
| Téléchargement `001-devis-ARMY-1791687565070-d0a170ae-v1.xlsx` | `6bc4a6cbafc1118b74ed3b0fbf4e428cdbcdd630892f9b53d43e5306991fac69` |
| Téléchargement `002-devis-ARMY-1791687565070-d0a170ae-v1-dpgf.xlsx` | `495333fb22b3f5742586a4dac4aa24a88b3b84093a06e367b5efc3c37c5ba4ed` |
| `business-evidence/business/ARMY-1791687565070-d0a170ae-rounding-print.json` | `5ea5cca233e261680e1e0502449327adb9db0539ccb9c297f0adefdb15c7ef0f` |
| `business-evidence/business/ARMY-1791687565070-d0a170ae-rounding-exact-multiple.json` | `e6cfc7649f4ad291bfe46e2f4ed3204711d29192a49e97adf7cf43676c299bd9` |

Les chemins complets des téléchargements et les empreintes des autres preuves
figurent dans `manifest.json`. La commande, la configuration du runner et les
sources du scénario sont également archivées pour répéter cette recette.

**Limites :** l'impression est contrôlée dans le DOM, sans génération ni
inspection d'un PDF. Les deux scénarios portent sur des brouillons ARMY ; ils
ne qualifient pas une offre déjà émise ou ses snapshots. Cette campagne ne
prouve ni l'affichage mobile, ni les devises USD/GBP, ni l'autoliquidation,
ni une exécution sur Supabase partagé ou un déploiement public.
