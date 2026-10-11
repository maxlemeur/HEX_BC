# Contrôle RLS obligatoire sur les PR

## Défaillances à vérifier avant modification

- Une PR hors périmètre SQL doit produire le contrôle `rls-matrix`, sans lancer
  la pile Supabase. Un filtre `pull_request.paths` empêcherait ce résultat.
- Une migration ajoutée, modifiée, supprimée ou renommée hors de `supabase/`
  doit déclencher les tests. Le calcul porte sur le diff depuis la base commune
  de la PR, sans limite de fichiers ni dépendance au dernier commit seulement.
- Un changement du runner, de ses dépendances ou de sa configuration doit aussi
  déclencher les tests. Les passages manuels et nocturnes restent complets.
- Une référence Git invalide ou un échec de détection doit faire échouer le job,
  jamais être interprété comme une PR sans changement de base.
- Un échec d'installation, du garde des migrations ou de `db:ci:local` doit
  rester bloquant. Aucun `continue-on-error` ni contrôle synthétique vert.

## Validation adaptée à la CI

Un parcours navigateur ne peut pas reproduire la sélection des fichiers par
GitHub Actions. Avant la modification, une probe locale est préparée sous
`.e2e/rls-required-check/verify.cjs` : elle parse le YAML puis exécute son vrai
script Bash dans des dépôts Git jetables. Elle couvre les fichiers hors périmètre,
les migrations, suppressions/renommages, dépendances, noms avec espaces, grands
diffs, déclenchements manuels/nocturnes et références invalides. Ses rapports
horodatés conservent commande, SHA source, empreinte du workflow et résultats.

Cette preuve ne remplace ni une exécution Actions sur le futur commit publié,
ni le replay du runtime natif PostgreSQL/Supabase. Aucun secret distant, ruleset
ou historique Git du dépôt de travail n'est modifié par la probe.

## Panneau article

Le test préexistant non commité dans
`e2e/army/critical/estimate-integrity.e2e.ts` doit être conservé intact et exécuté
avec `npm run e2e:army:critical -- --grep "associating a catalogue article"`.
Il crée uniquement un nouveau brouillon ARMY, lit un article existant, associe
l'article depuis le panneau, puis vérifie unité enregistrée, rechargement et
export DPGF. Un arrêt anticipé laisse les assertions suivantes non vérifiées.
Les traces authentifiées restent désactivées.

## Résultats du 10 octobre 2026

Base : `b505072645874122bd20eb186a334ce01660e060`, Windows, Node 24.19.0.
Le seul changement applicatif préexistant est le test article non commité ; son
SHA-256 reste `8818dbdcd1f8e50253429784613b0bb0e05ae9bf0e040e8f45b092936e87ddf1`.

### Workflow

Le job garde son nom `rls-matrix` et tourne sur chaque PR vers `main`. Un diff
Git complet depuis la base commune sélectionne les étapes de validation native.
Les filtres incluent les migrations, tests et helpers Supabase, ainsi que le
lockfile, les configurations npm/Node, Vitest et TypeScript. Les exécutions
manuelles et nocturnes lancent toujours la matrice complète.

- Probe avant modification : deux contrôles rouges, filtre au niveau du workflow
  et absence de sélection interne, rapport `2026-10-10T21-00-25-803Z/report.json`.
- Après modification : **16/16 contrôles verts**, dont 14 scénarios Bash exécutés
  sur des historiques Git réels. Rapport et script exact exécuté dans
  `.e2e/rls-required-check/2026-10-10T21-01-22-529Z/`.
- Actionlint 1.7.12 : aucun diagnostic sur le workflow. Archive Windows obtenue
  de la publication officielle et vérifiée avec son fichier de sommes SHA-256.
  Shellcheck indisponible ; le Bash est vérifié par la probe exécutée.
- `npx vitest run --project=node src/test/ci-guardrails.test.ts` : **6/6 verts**.
- `npm run typecheck`, `git diff --check` et `npm run verify:production` : verts.
  Le dernier inclut OpenAPI, build Webpack, cinq budgets et smoke HTTP réel.
- Les premiers essais Bash/Vitest/build ont rencontré les restrictions du
  sandbox Windows ; les validations ci-dessus proviennent des relances hors
  sandbox. Aucun contournement de contrôle n'a été ajouté.

Le runtime natif RLS complet n'a pas été relancé localement. Il reste à publier
le changement puis à observer les deux branches du workflow sur GitHub : PR
hors périmètre avec étapes lourdes ignorées, PR concernée avec matrice exécutée.
Le ruleset distant n'est pas modifié. Les contrôles à exiger après validation
sont `quality-gate` et `rls-matrix`.

### Panneau article : blocage avant le parcours métier

La commande ciblée a sélectionné connexion et association article. La connexion
échoue, et le test article est ignoré par dépendance : **aucune preuve métier**.
L'écran réel affiche « Email ou mot de passe incorrect ». Une vérification
directe séparée retourne Auth health `200`, authentification `400`, code
`invalid_credentials`. Aucun jeton n'est extrait ni conservé. Il faut actualiser
les identifiants du compte ARMY dédié dans `.env.local`, puis rejouer la commande.
Aucun compte, rôle, secret, catalogue ou brouillon n'a été modifié.

L'archive est
`.e2e/army/critical/runs/2026-10-10T21-01-20-316Z/` : manifeste, rapport, écran
textuel et log. Leurs empreintes ont été relues et vérifiées ;
`source.changedDuringRun=false`. Empreinte du manifeste :
`e0ca6094044f1d3d2b2dc30187da918f262a3b7574d52e5f51218532aec882cf`.
Le diagnostic sans secret est `.e2e/rls-required-check/auth-diagnostic.json`.

La lecture du code révèle que `handleAssociateArticle` affecte actuellement
`designation` à `description`, alors que la cellule Unité lit `description`.
Ce constat source est distinct d'une reproduction dans le panneau. Association,
remplacement, montants, rechargement et export restent à vérifier dans une
session authentifiée ; aucun correctif applicatif n'est appliqué dans ce lot.

## Reprise entièrement locale du 11 octobre 2026

L'utilisateur autorise une pile native isolée dans WSL. La configuration
`.env.local` existante pointe toujours vers le Supabase hébergé et reste intacte.
Le profil ignoré `.e2e/local-article/local.env` contient uniquement les clés et
identifiants de la nouvelle pile. Le schéma local est initialisé par les
migrations canoniques, avec inventaire appliqué vérifié, sans modification SQL.

Avant correction de la configuration du runner, la connexion UI locale passe,
mais la création du devis renvoie `500 / ESTIMATE_CANONICAL_V2_PERSIST_FAILED` :
la RPC est refusée (`42501`). Le SDK ne transmet au serveur que l'environnement
explicitement déclaré. La configuration E2E transmettait URL et clé publique
locales, mais omettait la clé serveur ; Next la rechargeait depuis `.env.local`.
Le scénario existant reproduit ce mélange d'environnements avant modification.
La correction doit transmettre la clé serveur configurée au processus Next des
campagnes authentifiées, sans la rendre publique, modifier les rôles, les grants
ou les assertions du test. Le passage de la création à `201` est la preuve attendue.

Le diagnostic complémentaire local doit observer association puis remplacement
sans s'arrêter au premier écart d'unité, et conserver les lectures avant son
assertion finale. Avec quantité 2,5, marge nulle et TVA 20 %, l'article cuivre
en `m` à 1 234 centimes doit donner 3 085 / 617 / 3 702 centimes ; l'article acier
en `u` à 2 500 centimes doit donner 6 250 / 1 250 / 7 500 centimes. L'unité doit
rester correcte dans l'API, le contrôle rechargé et la colonne Unité du DPGF.
Une désignation recopiée dans ces trois surfaces est un échec, même lorsque
les quantités et montants sont corrects. Cette probe reste sous `.e2e/local-article`
et n'ajoute pas de dépendance au catalogue local dans la suite partagée.

### Environnement local prêt

- WSL `Ubuntu-24.04`, utilisateur ordinaire, CLI 2.120.0, Node 24.19.0.
- Pile native `miaouffrage-article-c0d0d69356`, API `http://127.0.0.1:59827`.
- Répertoire Linux isolé :
  `/home/tanuki/.local/share/miaouffrage-article-qa/run-dcfb206a1136`.
- Inventaire des migrations appliquées identique à celui du dépôt ; aucune
  migration, permission SQL ou donnée distante modifiée. La RPC de création
  conserve EXECUTE pour `service_role`, refusé à `authenticated`.
- Compte et tenant ARMY locaux, deux articles synthétiques. Identités dans
  `.e2e/local-article/fixture.json`. Clés et mot de passe uniquement dans les
  fichiers ignorés de ce profil. `.env.local` reste inchangé et distant : lancer
  les tests avec le profil explicite ci-dessous pour utiliser la pile locale.
- La pile et ses brouillons restent disponibles. Le runner arrête ses propres
  processus Next et Chromium après chaque passage. Docker n'est pas utilisé.

Rejouer le test préexistant d'association :

```powershell
node --env-file=.e2e/local-article/local.env scripts/run-tester-army.mjs critical --grep "associating a catalogue article"
```

Rejouer la régression locale complète, conservée dans
`e2e/army/local/article-association.e2e.ts`. Elle exige un premier clic réussi,
sans reprise au clavier, remplace une unité saisie manuellement, attend les
totaux et l'état « À jour », puis vérifie les rechargements et les vrais
classeurs téléchargés :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/local-article/run-diagnostic.cjs
```

La configuration temporaire à la racine est créée puis supprimée par ce lanceur.
Pour reprendre la pile après son arrêt, exécuter dans Ubuntu WSL :

```bash
cd /home/tanuki/.local/share/miaouffrage-article-qa/run-dcfb206a1136
./node_modules/.bin/supabase start --runtime native
```

`./node_modules/.bin/supabase stop` arrête cette pile sans détruire ses données.
`start-stack.py` refuse de réinitialiser une pile déjà prête ; son reset local
est réservé à la création initiale.

### État avant correctif : défaut d'unité reproduit

Le passage final exécute la connexion ordinaire puis toute la séquence. La
connexion passe ; le test métier échoue sur son assertion finale d'unité,
après vérification des deux produits, montants et exports. Le code applicatif
reste inchangé.

| Opération | Unité attendue | API, contrôle rechargé et DPGF observés | Quantité | Prix HT | HT / TVA / TTC |
| --- | --- | --- | --- | --- | --- |
| Association cuivre | `m` | `ARMY Article cuivre local` | 2,5 | 12,34 EUR | 30,85 / 6,17 / 37,02 EUR |
| Remplacement acier | `u` | `ARMY Article acier local` | 2,5 | 25,00 EUR | 62,50 / 12,50 / 75,00 EUR |

Les assertions de quantité, prix, identité produit, titre et montants passent.
Le défaut est bien l'affectation de `designation` à `description` dans
`handleAssociateArticle` ; `description` alimente la cellule et l'export Unité.

Autre constat reproductible dans ce parcours automatisé : après rechargement,
le premier clic sur l'action ferme le menu sans panneau visible. Réouvrir le
menu et activer l'action au clavier permet d'atteindre la recherche. Cette
anomalie d'ouverture est conservée dans les observations ; le diagnostic ne
la transforme pas en réussite du parcours à la souris.

Archive UTC du passage final :
`.e2e/local-article/runs/2026-10-10T23-05-11-934Z/`.
Elle contient manifeste, rapport, écran textuel final, observations et deux
DPGF. Les cinq empreintes d'artefacts ont été vérifiées ; les fichiers source
surveillés restent identiques pendant le passage. SHA-256 du manifeste :
`e8a7b8c1fc9f23fe47de8f5ef56d21f3e0e97bf1c2dbaabe1bb926acc39e1a7d`.
La synthèse vérifiable est `.e2e/local-article/final-verification.json`.
Les traces authentifiées sont désactivées et les artefacts ne contiennent ni
le mot de passe local ni la clé serveur locale.

Les tentatives précédentes ont rencontré des erreurs de découverte de tests et
de navigation/sauvegarde ; elles ne prouvent pas le parcours complet. Le résultat complet
ci-dessus provient uniquement du dernier passage, sans agrégation de réussites
partielles. Lint du fichier `e2e.config.ts`, typecheck et `git diff --check` passent.
Le test préexistant, le workflow RLS adapté précédemment et `.env.local` gardent
leurs empreintes. Aucun commit, push ou changement du ruleset n'est effectué.

### Correctif du panneau — 11 octobre 2026

Les défauts observables sont couverts par le parcours local avant toute
qualification du correctif : une seule activation au clic doit ouvrir la
recherche ; la désignation reste dans le titre, l'unité du catalogue doit
remplacer l'unité saisie, persister et survivre au rechargement ainsi qu'à
l'export DPGF, pour une association puis un remplacement.

Le relevé d'événements du passage
`.e2e/local-article/runs/2026-10-11T00-01-37-223Z/` confirme que l'action reçoit
le clic et demande l'ouverture, puis que l'état est perdu pendant le premier
chargement du composant différé. Aucun événement de fermeture du panneau
n'est émis. La configuration `loading` de `next/dynamic` installe une frontière
Suspense locale : l'éditeur reste monté pendant le chargement du panneau.
Le branchement menu/dialogue reste conforme au
[contrat Base UI](https://base-ui.com/react/components/dialog#open-from-a-menu).

`handleAssociateArticle` utilise maintenant l'unité du catalogue, conserve
l'unité courante si le catalogue n'en fournit pas, et retire le brouillon
d'unité local pour que la ligne associée devienne la source affichée.
La correction est limitée à `EstimateEditorTable.tsx` : aucun schéma,
composant générique de menu ou permission n'est modifié.

Le diagnostic de développement du
`.e2e/local-article/runs/2026-10-11T00-03-06-049Z/` passe (connexion + parcours).
Les premiers clics, les unités `m` et `u`, la quantité 2,5, les prix 12,34 et
25,00 EUR, les totaux et les deux exports ont été vérifiés. La validation finale
du fichier de régression conservé et du build de production est consignée ci-dessous.

Validation finale en production locale :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/local-article/build-local.cjs
node --env-file=.e2e/local-article/local.env .e2e/local-article/run-diagnostic.cjs --production
```

Le lanceur de build transmet explicitement le profil local aux sous-processus.
Une première invocation via `node --run build` avait embarqué l'hôte distant ;
le garde du navigateur a bloqué l'authentification avant l'envoi, et aucun test
métier n'a été exécuté sur ce bundle. Le build final
`XpAokCq0QmDx4ttMue4XR` ne contient plus cet hôte dans les chunks client. La clé
serveur locale est absente des 383 fichiers JavaScript client vérifiés.

| Scénario | Premier clic | Unité persistée / rechargée / DPGF | Quantité | Prix HT | HT / TVA / TTC |
| --- | --- | --- | --- | --- | --- |
| Association cuivre après saisie `lot` | Réussi | `m` / `m` / `m` | 2,5 | 12,34 EUR | 30,85 / 6,17 / 37,02 EUR |
| Remplacement acier après saisie `lot` | Réussi | `u` / `u` / `u` | 2,5 | 25,00 EUR | 62,50 / 12,50 / 75,00 EUR |

Connexion et parcours passent : **2 tests exécutés, 2 réussis, 0 ignoré**, sur
Chromium desktop, sans modèle ni trace authentifiée. Archive :
`.e2e/local-article/runs/2026-10-11T00-10-17-352Z/`.
Ses 17 artefacts sont vérifiés par empreinte et ses trois JSON sont valides.
Sources et build restent identiques pendant le passage. Les sources du test,
de sa configuration et du lanceur, le diff local, le rapport, les identités
des fixtures et les deux classeurs sont archivés sans identifiants secrets.
SHA-256 du manifeste :
`6cb09ba7c0c147bdb7d4fc04075e8d7b963e3e23f8b394571e1c3fb90b6155b5`.
Vérification : `.e2e/local-article/fix-verification.json`.

Le test préexistant `associating a catalogue article` est également rejoué
inchangé sur ce même build : **2 sélectionnés/exécutés/réussis** (connexion
incluse), neuf autres scénarios exclus par le filtre. Archive :
`.e2e/army/critical/runs/2026-10-11T00-12-45-140Z/`.
SHA-256 du manifeste :
`366d3abaa8ebc72ab8aee14fcd95d5811c258ceabaf3b46850b226d7e3cc955a`.
Cela ne qualifie pas toute la suite critical, ni le mobile, ni la CI distante.

Lint ciblé, typecheck, validation OpenAPI, build Webpack et les cinq budgets de
taille passent. Webpack a reconstruit son cache après des avertissements de
désérialisation ; aucune erreur de compilation ne subsiste. Les empreintes de
`.env.local`, du test préexistant et du workflow RLS sont préservées. Aucune
migration, écriture Supabase distante, publication ou modification du ruleset.
