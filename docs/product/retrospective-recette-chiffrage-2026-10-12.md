# Rétro de la recette et améliorations de reprise

Rétro demandée après la tranche locale du 12 octobre 2026, suivant le skill
`C:/Users/thann/.codex/skills/retro/SKILL.md`. Elle porte sur l'environnement de
travail de cette session ; la réalisation complète du logiciel reste ouverte.

## Résultat de la tranche

Les sources figées ont produit le build `yD3yKrjccL8pHYXHZho5a`, manifeste
`.e2e/army/recipes/builds/2026-10-12T20-35-54-361Z-2f755a16/manifest.json`, SHA
`755e6604ba811509c6704245294c97b810233a93a57cabfd445e88e4d089cb8d`.
OpenAPI, Webpack et les budgets existants passent, sans changement d'entrées
pendant la compilation.

| Recette réellement exécutée | Archive exacte | Lecture indépendante |
| --- | --- | --- |
| CCTP : 12/12, 26 exports XLSX | `2026-10-12T20-39-03-661Z` | 28 397 contrôles, aucun échec ; qualification SHA `838b75b11314ac01c113c51bad80a8317a3fe9fdab806586e9577d7f43d93057` |
| Ouvrages : 7/7 | `2026-10-12T20-53-42-299Z` | 24 986 contrôles, aucun échec ; qualification SHA `5a37ab906da31bf19d09eb231cc460ae8bad37dd3d9126e469dc74706e046019` |

Les archives complètes sont sous `.e2e/army/coverage/runs/`. Les deux parcours
sont sans filtre, retry, skip, modèle ou trace authentifiée. La revue séparée
confirme les SHA, la complétude des 722 fichiers CCTP et 508 fichiers ouvrages,
les valeurs et les limites. Les recettes natives ont exécuté 100 cas générés,
34 cas CCTP et 1 241 assertions pgTAP, avec rollback et conservation contrôlés.
Le seed CCTP a conservé les données/droits antérieurs et vérifié les 176 ajouts,
11 références supplémentaires, 22 documents et leurs 22 PDF relus par session
ordinaire. Aucun bootstrap Auth, réparation de rôle ou nouvelle migration.

Ces parcours sélectionnés ne qualifient pas toute l'application, la concurrence,
la matrice complète de rôles, les modèles actifs ou les PDF d'impression.
CORE-06 reste ouvert. Toute modification d'outillage postérieure appartient à
une autre révision de travail ; ces archives restent des preuves datées.

## Constats, par priorité

### P1 : dépendances historiques des contrôles hors réseau

La recette CCTP est versionnée, mais deux harnais de ses gardes lisent encore
obligatoirement des fichiers ignorés : GO03 pour `check-cctp-recipe.mjs`, et
l'archive du 12 octobre à 02:44 pour `check-cctp-reader.mjs`. Une copie des
sources sans ces fichiers ne peut donc pas vérifier les gardes.

Action autorisée : produire les entrées négatives et les vecteurs de parser
dans chaque exécution, avec un statut explicitement non qualifiable. Préserver
les 11 cas de contrat, les 9 cas de lecteur, les vrais XLSX et les refus de
retry/filter/identités/cellules/XML/secrets. Le test de confidentialité doit
atteindre précisément le refus de SHA d'artefact et empêcher la divulgation
du nom malveillant ; une erreur de préparation antérieure ne suffit pas.

Validation avant correction : lancer les mêmes points d'entrée dans une copie
confinée sans archives `.e2e`, conserver le RED et ses sorties. Après correction,
exiger 11/11 et 9/9 dans cette même copie. Aucun accès SQL, HTTP ou navigateur.
Aucun vecteur synthétique ne peut devenir une preuve native ou métier.

### P2 : commande commune et navigation vers les preuves

Les six harnais de refus existent, mais aucune commande commune ne les relie
dans `package.json`. Les recherches larges dans les JSON et archives ont aussi
produit des sorties inutiles. La CI possède déjà lint et typecheck ; le constat
est ce raccordement local manquant, pas l'absence d'une garde globale.

Action autorisée après autonomie des harnais : ajouter `check:army-recipes`
pour les six commandes existantes, avec arrêt au premier échec et reçus
individuels. Vérifier le refus réel de la commande absente avant ajout, puis
l'exécution des 60 assertions. Garder la portabilité Windows/Linux à part :
elle exige un plan et une empreinte exacts, jamais une recherche du dernier run.
Ajouter un index court aux documents existants pour lire directement le reçu
d'étape, son log et la qualification nommée.

## Défauts déjà traités pendant la tranche

Le contrôle RMO omettait le rôle effectif sélectionné par le produit. Le défaut
est trouvé en revue avant insertion : RED 0/12 puis GREEN 12/12 pour les vecteurs
JS/Python d'admission. Le SQL et la relecture ordinaire vérifient ensuite le
premier rôle actif du propriétaire, ordonné par position et ID, à 4 000 cents.
Les reçus sont sous `.e2e/retro-runtime/cctp-rmo-checks/` ; ils ne remplacent pas
la preuve native ou les parcours réellement exécutés ci-dessus.

La campagne `recipe-cctp-retro-20261012-01` a échoué avant insertion : le
validateur Node Linux chargeait l'esbuild installé pour Windows. Son log et ses
reçus restent conservés. L'import TypeScript natif de Node 24 corrige ce seul
chargement ; le même plan donne 176 lignes identiques Windows/Linux et refuse
un chemin altéré. RED 1/3 puis GREEN 3/3 conservés dans
`.e2e/retro-runtime/cctp-plan-portability-checks/`. La campagne 01 n'a pas été
relancée ; la nouvelle campagne 02 a ensuite passé la recette réelle.

## État des améliorations de cette rétro

Les deux améliorations sont implémentées après les recettes closes.

- P1 : même copie sans archives, RED par absence des anciennes entrées puis
  GREEN 11/11 et 9/9. Reçus sous
  `.e2e/retro-runtime/cctp-selfcontained-20261012-01/` ; GREEN SHA
  `13b6e7ed630acd2e08f593b8a34ed3b8254289a8dcd127516b415a34e6d5ade1`.
  Le gel des deux fichiers, préimages et diffs est `freeze-receipt.json`, SHA
  `141d7d802aa64af59cac487d3ce7072e1d9103930c055ea7ac9a13c05da6eff4`.
  La revue indépendante confirme le refus exact de SHA et l'absence de
  divulgation. Dépendances installées réutilisées, sans preuve de machine neuve.
- P2 : `npm run check:army-recipes` exécute les six harnais, **60/60** assertions,
  code zéro. Reçu agrégé et six SHA enfants vérifiés :
  `.e2e/retro-runtime/retro-guards-20261012/green.json`, SHA
  `26c134f91ff9842206ee1810eadfb397d882f7d787961dac6674ea09c95a2f04`.
  Le refus npm de commande absente est conservé dans `red.json`.
  Le premier essai sous sandbox garde ses trois échecs de liens de répertoire
  dans `green.log` ; la même commande hors sandbox réussit dans
  `green-local.log`. Aucune protection n'est supprimée pour passer le contrôle.

Le lint des deux harnais et le contrôle du diff package passent. L'index court
est dans la [recette reproductible](../testing/local-recipe-reproducibility.md).
Ces contrôles locaux ne sont pas ajoutés à la CI dans cette tranche ; la CI
conserve ses gardes lint/typecheck existantes.
Le [goal de reprise](goal-chiffrage-suite-2026-10-12.md) conserve la mission
complète et prépare CORE-07 comme prochaine tranche métier.
