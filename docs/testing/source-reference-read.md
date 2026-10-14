# Lecture initiale de la revue documentaire

Recette locale préparée d’après le [contrat préalable](source-coverage-reference.md),
le 12 octobre 2026. Elle couvre une partie de SR01 et le refus anonyme de SR02.
Elle ne crée aucune copie et ne confirme aucune référence ; SR03 reste hors preuve.

Le scénario `e2e/army/local/source-reference-read.e2e.ts` utilise le propriétaire
de la fixture locale vérifiée `reference-http-01`, via le login UI ordinaire.
Les deux résultats attendus sont le setup d’authentification et un parcours GET.
Aucun verrou d’éditeur, POST métier, seed, modèle ni trace authentifiée n’est lancé.

## Échecs observables et assertions

- Une consultation crée implicitement une revue : deux observations SQL indépendantes,
  avant/après le runner, exigent zéro revue, copie, événement et objet de référence
  pour cette version. Le SQL ne lit que le tenant et la version de la fixture ;
  il s’exécute dans une transaction `READ ONLY`, puis `ROLLBACK`.
- La route confond document intake et référence : elle doit retourner exactement
  révision 0, référence active et copie sélectionnée nulles, historique vide,
  curseur suivant et reçu de confirmation nuls. Deux PDF intake existent pourtant.
- La pagination ou la normalisation casse l’état initial : limites 1, 20, 100,
  curseurs 1 et MAX_SAFE_INTEGER, version UUID majuscule et clé de confirmation
  sans reçu conservent la même réponse exacte.
- Une entrée non prévue traverse l’API : paramètres inconnus/dupliqués, nombres
  négatifs, nuls, décimaux, non numériques, trop grands ou UUID invalides exigent
  400 / `SOURCE_REVIEW_INVALID_INPUT`.
- Une ressource inaccessible divulgue des informations : UUID version absent et
  UUID copie aléatoire exigent 404 / `SOURCE_REVIEW_ACCESS_DENIED`, enveloppe et
  message exacts, sans champ supplémentaire. Une requête sans cookies exige
  401 / `UNAUTHORIZED`.
- Une réponse peut être mise en cache : tous les résultats, y compris les erreurs,
  exigent `Cache-Control: private, no-store` et un contenu JSON.
- Une lecture modifie les finances : l’API devis complète est égale avant/après ;
  le contrôle SQL compare aussi montants, statut, date, révision et empreintes
  complètes de la version/des lignes. Le devis de cette fixture reste vide à 0/0/0.

Chaque réponse réelle est archivée avant son assertion. Le wrapper conserve le
build, la plateforme, l’état source, les fixtures, le reçu de migration locale,
les observations SQL et leurs empreintes. Un échec du contrôle indépendant fait
échouer la commande même si le navigateur a réussi. Les secrets et tokens ne font
pas partie des preuves ; les credentials restent dans les profils ignorés.

## Commandes et état

La collecte `.e2e/source-coverage/http-staged/collect-read.cjs` utilise `e2e list`
dans Ubuntu-24.04 avec Node 24.19.0. Elle ne démarre ni application, ni navigateur,
ni connexion DB. Le premier essai a échoué `NO_TESTS` à cause du chemin des tests
relatif au fichier de configuration ; il est conservé dans
`read-collection-5a3af0d5-af41-4724-a5d6-9cc902b9d459`. Le deuxième a confirmé que
le SDK refuse les segments `..` dans un glob (`read-collection-a2102107-08f9-4d8f-b5a2-f38210232e7a`).
La configuration temporaire à la racine a ensuite collecté exactement les deux
résultats, sans exclusion : `read-collection-4612816c-9ef8-4ccf-86a0-6442be724834`.
Ces collectes ne prouvent aucun comportement métier.

Après build courant vérifié et autorisation du créneau, exécution WSL depuis le dépôt :

```text
env GIT_OPTIONAL_LOCKS=0 GIT_INDEX_FILE=/mnt/c/Users/maxim/Projects/miaouffrage/.e2e/git-index-recovery/head.index /home/tanuki/.nvm/versions/node/v24.19.0/bin/node --env-file=.e2e/local-article/local.env --env-file=.e2e/source-coverage/http/reference-http-01/local.env .e2e/product-foundation/run.cjs --production source-reference-read
```

Le backend reste `http://127.0.0.1:59827` ; le build Windows est servi dans le
runtime Linux déjà vérifié. Ce n’est pas une nouvelle qualification de production
Linux. Le scénario n’établit pas la matrice complète des rôles, l’historique peuplé,
une panne DB injectée, une interface de revue documentaire, les octets d’une copie,
ni les routes d’écriture. Le contrôle des objets est un comptage de métadonnées
Storage pour ce préfixe, pas une lecture physique du bucket.

Premier essai conservé : `.e2e/product-foundation/runs/2026-10-11T22-39-25-685Z`,
build `eBcR7wxDJlQno6EfBdO-r`, sources stables, auth passée et parcours arrêté avant
le premier GET source-review. L’ouverture de la fiche affaire déclenchait un GET
direct `delivery_sites` refusé par la garde historique du navigateur. Cette fiche
appelle aussi le synchroniseur d’approbation, susceptible d’écrire son résumé.
L’observation native a constaté `updated_at` passant de
`2026-10-11T22:26:00.366944+00:00` à `2026-10-11T22:40:53.459747+00:00`, avec une
empreinte de version différente ; les finances 0/0/0, la révision de contenu 1,
les lignes vides et les quatre compteurs privés/Storage à zéro sont conservés.
Cette piste de synchronisation est cohérente avec le code, mais l’archive ne
contient pas le delta détaillé des colonnes d’approbation. Elle ne prouve aucune
mutation par le nouveau GET, qui n’avait pas été appelé. Le refus avant/après est
conservé tel quel, sans retirer la date de l’oracle.

Seule la navigation du scénario est corrigée vers `/dashboard/estimates`, sans
modifier le produit ni la garde. Le témoin sans revue/copie/événement est réutilisé
avec une nouvelle observation initiale.

Reprise terminale qualifiée :
`.e2e/product-foundation/runs/2026-10-11T22-42-33-286Z`, même build
`eBcR7wxDJlQno6EfBdO-r`, **2/2 passés**, aucun filtre, échec, skip, flaky ou appel
modèle ; sources inchangées. Les 37 réponses comprennent neuf succès à état
initial exact, 25 refus 400, deux refus 404 et un refus anonyme 401. Toutes les
réponses satisfont les assertions JSON strictes et `private, no-store`.
L’API devis et les observations natives avant/après sont identiques, y compris
date et empreinte complète de version ; aucun objet de référence ni ligne privée
n’est créé. La fixture reste disponible pour la future recette d’écriture.

Lecteur exécuté sur ce seul run : `.e2e/source-coverage/http-staged/qualify-read.cjs`.
Le reçu vérifie résultats nommés, archive complète, sources/build courants,
migration locale, seed, SQL/observations et absence de credentials/JWT dans les
textes. Reçu :
`.e2e/source-coverage/qualifications/read-2026-10-11T22-42-33-286Z-fd5bfff0/qualification.json`,
SHA-256 `eaafa35f4c33d656074014002564e33a559ca46e8f6427c67e3c60d4dec447bb`.
Les limites de la tranche initiale restent celles énoncées ci-dessus ; ce succès
n’étend pas la preuve aux écritures, copies physiques, rôles complets ou à l’UI.
