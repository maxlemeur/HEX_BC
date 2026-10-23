# Déploiement des corrections de performance — 19 octobre 2026

## Candidat et qualification

Publication applicative explicitement demandée par le propriétaire. Source :
`44a969d33ba1bed617f342850e93b956d85f400c`, `main`, version `0.5.1`.
La CI de ce SHA a réussi : qualité, Army critical, smoke anonyme et Release
Please. Run critical :
<https://github.com/maxlemeur/HEX_BC/actions/runs/39319974453>.

`npm run check:release`, Node `24.19.0`, réussit sur ce candidat : audit,
architecture, OpenAPI, types, lint, 3 284 tests Node, 820 jsdom, 12 contrôles de
frontières, build Webpack de production, budgets et smoke HTTP. Les trois tests
Node déjà ignorés restent visibles. Preuve :
`.e2e/army/deploy-performance-20261019/release-check.json` et `check-release.log`.
Le checkout était propre au lancement. Des changements concurrents de maintenance,
documentation et code applicatif sont apparus ensuite ; ils sont conservés sans
intégration à cette publication et ne sont pas qualifiés par ces résultats.
La preuve concerne le commit figé ci-dessus, pas le checkout modifié ensuite.

## Prérequis de base de données

Lecture seule du projet Supabase `ijropnynpwjbllievrip` : les optimisations de
copie et de réordonnancement déjà requises sont présentes sous leurs timestamps
distants. `commit_estimate_batch` a conservé son contrat M6b : même signature,
contrôles, reçus et résultat ; MD5 du corps
`7bc2f6c5702364b39fa6582cb363591c`, `SECURITY DEFINER`, `search_path` vide.

La migration `20261019123000_estimate_batch_set_based_creates.sql` n'est pas
appliquée. La relecture indépendante du diff confirme que son chemin INSERT
ensembliste est facultatif pour ce candidat : le client conserve les dix mêmes
paramètres RPC et la boucle historique reste compatible. Aucune migration,
politique de tenant, permission ou configuration distante n'est modifiée ici.
L'accélération SQL apportée par cette migration n'est donc pas active ni qualifiée
en production. Receipts : `preflight-db-history.json`, `preflight-db-batch.json`.

## Publication

Déploiement manuel Vercel du SHA exact, environnement Production, projet `hex-bc` :
`dpl_5crA4nq9rfHrygh37T9p7b8sQYr6`.

- Tableau Vercel : <https://vercel.com/maximes-projects-1598be5f/hex-bc/5crA4nq9rfHrygh37T9p7b8sQYr6>.
- Build : <https://hex-1dl7l1z5m-maximes-projects-1598be5f.vercel.app>.
- Alias attendu : <https://hex-bc.vercel.app>.
- Ancienne production : `dpl_91hiCztR8VZ675sR4n1ASKgtGhrj`, source
  `708ae88da6c4ae4be70891f1cdefb46534901289`, version `0.5.0`.

État **READY**, environnement **Production**, source `main` / `44a969d`, alias
`hex-bc.vercel.app` affiché sur ce déploiement. Build terminé le 19/10/2026 à
**21:53:27 UTC**, durée **4 min 15 s**. Le dashboard authentifié confirme aussi
`v0.5.1 · 44a969d` dans l'application réellement servie.

`GET /api/health` sur l'alias : **200**, `ok=true`, `version=0.5.1`, `db=up`.
Page `/login` : **200**, ses **26 assets JS/CSS** répondent **200** avec un contenu
non vide. L'URL immuable du build est protégée par Vercel (302 vers `/sso-api`) ;
aucune protection n'est modifiée.

La première sonde HTTP a échoué sur son décodage inconditionnel de cette page
d'authentification Vercel. Son correctif conserve la protection. La sonde suivante
conserve un échec de harnais : elle attendait à tort une redirection directe de
`/dashboard/estimates` vers `/login`. Le contrat `next.config.ts` impose d'abord
`/dashboard/affaires`. La correction ciblée exécute uniquement les deux GET de
cette chaîne : **307 → affaires → 307 → login**. Les autres contrôles déjà réussis
ne sont pas rejoués. Les résultats initiaux restent en échec, sans réétiquetage.
Receipts : `public-http-initial-failure.json`, `public-http.json`,
`public-http-initial-route-failure.json`, `legacy-route.json`.

## Parcours après publication

TesterArmy `e2e 0.21.2`, `@e2e-dev/web 0.15.2`, Chromium 1 440 × 900,
un worker, zéro retry, sans modèle ni serveur local. Configuration séparée sous
`.e2e/army/deploy-performance-20261019/qa/` ; les protections locales qui refusent
un backend distant sont conservées. Traces, vidéo et cache désactivés ; logs et
rapports assainis pour les identifiants et tokens.

Préflight : une seule soumission de connexion du compte E2E existant reçoit
HTTP 400 et l'alerte « Email ou mot de passe incorrect. ». Aucun reset ni nouveau
compte. La session Chrome existante redirige également vers `/login`. Ce blocage
de configuration ne constitue pas un résultat métier vert. Preuve :
`qa/evidence/preflight-auth.json` et `qa/preflight-results/report.json`.

Après désignation du compte existant par le propriétaire, une session Chrome
ordinaire est ouverte et son profil est vérifié. Aucun mot de passe ni cookie
n'est extrait, aucun compte n'est réinitialisé ou créé. Les scénarios SDK
authentifiés préparés restent **non exécutés** ; les contrôles CUA ci-dessous sont
des observations et assertions de l'interface réelle, conservées séparément dans
`qa/authenticated-cua.json`. Ils se déroulent le 19/10 UTC / 19–20/10 à Paris.

| Parcours | Résultat observé après déploiement |
| --- | --- |
| Public TesterArmy | **2/2 réussis**, zéro retry : connexion → inscription → connexion et refus anonyme exact **401** sur `/api/estimates`, commandes paginées, référentiels et export. Run `01a15628-3c50-7ca4-bbb3-075a2e66deb6`. |
| Identité et affaires | Profil attendu, `v0.5.1 · 44a969d`, liste de 557 affaires avant la fixture ; recherche dédiée sans résultat et effacement. |
| Nouveau brouillon ARMY | Création, lot et ligne manuels, sauvegarde Ctrl+S, état « À jour », rechargement complet et mêmes valeurs exactes. Quantité 2, unité u, achat 100 €, coefficient FO 1,30, vente 130 €, **HT 260 €, TVA 52 €, TTC 312 €**. Moteur 3 affiché ; sans remise ni arrondi. |
| Hub et registre ARMY | HT 260 €, une ligne, V1 courante en brouillon ; registre vide (0 point, 0 événement), approbation non requise. PDF absent bloque normalement l'envoi. Aucune transition métier soumise. |
| Catalogue | 1 255 produits, 1 254 actifs, page de 25 ; recherche `Anti-vibratile` donnant 11 lignes cohérentes ; taille 50 puis retour navigateur restaurant 25, recherche et 11 lignes. Dialogue produit ouvert puis fermé sans saisie ni enregistrement. |
| Commandes | Inventaire réel de **9** commandes : **2 avec devis + 7 sans devis**, recherche sans résultat, effacement restaurant 9 lignes. Tailles 50 puis 100 vérifiées, 50 restauré. Aucune commande modifiée ni exportée. |
| Aperçu imprimable ARMY | Projet/client/ligne exacts, quantité 2/u, PU 130 €, HT brut/net 260 €, TVA 52 €, TTC 312 € ; version modifiable et non scellée. Aperçu HTML seulement : pas de PDF téléchargé ni d'impression. |

La fixture est conservée : `ARMY-PERF-PROD-20261019-2201`, projet
`27b8026c-4e92-49e3-b7c8-b7630651420a`, version
`872b4338-8ef1-41a2-a2ba-a44aefa666dd`. Elle contient une section et une ligne de
test seulement. Aucune donnée de dossier client n'est modifiée, aucun e-mail
n'est envoyé. La visite du hub peut écrire la projection d'approbation propre à
cette fixture, conformément au fonctionnement du produit.

Rapport public : `qa/postdeploy-public-results/report.json` ; refus exacts :
`qa/evidence/postdeploy-public-api.json`. Une reprise **visuelle ciblée 1/1** attend
la fin de l'animation avant capture et conserve son rapport distinct ; les API ne
sont pas rejouées. Capture : `qa/evidence/postdeploy-login.png`, reçue avec son
SHA-256 et l'identité de déploiement. Synthèse des parcours : `qa/report.md`.

Aucun défaut applicatif n'est observé sur les parcours exercés. Les gros volumes
(2 031 items, 1 005 commandes), l'import, l'export CSV/PDF réel, l'émission et
l'envoi ne sont pas rejoués en production. Cette campagne n'établit aucun nouveau
gain chiffré de latence ni Web Vitals de terrain.

Les gains locaux et leurs limites sont conservés dans
[le rapport de dogfooding historique](https://github.com/maxlemeur/HEX_BC/blob/cf4b6a08d23708acdb0d0d6f6c73325fbb7b6bb9/docs/testing/performance-dogfood-remaining-2026-10-19.md) : cette
publication ne transforme pas ces mesures en mesures de terrain.

Relecture indépendante finale : aucune incohérence ni surestimation relevée ;
identités, rapports, liens et SHA-256 de la capture concordent. Résumé canonique
local : `.e2e/army/deploy-performance-20261019/deployment.json` ; empreintes des
preuves sélectionnées : `integrity.json`. Aucun correctif applicatif supplémentaire
n'a été nécessaire après publication.
