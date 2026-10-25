# Déploiement de main en production — 25 octobre 2026

**Production Vercel : `main@7255d1d260fe4bed5f0aca99322ab1f4595f3c12`, état READY.**
Déploiement effectué à la demande explicite du porteur, puis défaut de tri optionnel
trouvé et corrigé pendant la vérification. Source Git exacte sur le projet `hex-bc`,
sans modifications locales. Sources fixes pendant chaque campagne ; les travaux
locaux préexistants sont préservés.

## Identité et prérequis

- Production : https://hex-bc.vercel.app ; version `0.5.1`, commit `7255d1d2`.
- Déploiement final : `dpl_G9KHEXiP77x8tSYgwe4ayXwYzgq4`, état `READY` à
  **14:06:31 UTC** ; création à 14:02:31 UTC. Alias public assigné sans erreur.
- URL immuable : https://hex-ndik74olc-maximes-projects-1598be5f.vercel.app.
- Qualité, tests, build, smoke et **cinq shards critiques GitHub : succès** avant
  le déploiement final. Agrégats army-critical et army-takeoff : succès ; les
  shards takeoff sont ignorés par leur sélection d'impact, pas présentés comme exécutés.
  [Quality Gate](https://github.com/maxlemeur/HEX_BC/actions/runs/40199327212),
  [TesterArmy Critical](https://github.com/maxlemeur/HEX_BC/actions/runs/40199327239),
  [smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/40199327170).
- Premier déploiement : `c9e849350a54520e5f5f646efe94e1b90748efc9`,
  `dpl_4JECVYTGDS2Ubg2vjjD7zMSnMttg`, READY à 13:09:50 UTC. Les campagnes
  1 à 4 qualifient ce build. Le déploiement intermédiaire `a993b19c`,
  `dpl_2d4ixwkHGVHEJPoGZg99QsbTDG7r`, READY à 13:51:45 UTC, corrige le GET
  des modèles et porte la cinquième campagne.
- Les quatre migrations requises du 25 octobre sont présentes sur
  `bon_de_commande` (`ijropnynpwjbllievrip`) avec les empreintes exactes :
  `template_from_version_checked_once` et les trois migrations du lot 3.3.
  Aucune fonction `public` exécutable par `anon` au préflight.
  Voir le [reçu du partagé](shared-supabase-lot-3-3-2026-10-25.md).
- Deux lots ont rejoint main pendant la livraison : noms de fichiers des plans
  M1a (#108) et réglages administrateur 3.2 (#101). Ils sont inclus dans le build
  final. La migration `20261025115010_tenant_calc_defaults_admin` était déjà
  appliquée sur le partagé : version distante `20261025135027`, SHA-256 exact
  `af97469c23f3dcacf54f1802f04f9c36860e4c1e3fec6be0c3b2e2a071f91977` ;
  fonction attendue présente. Aucune réapplication de cette migration.
- Retour applicatif possible vers `dpl_E5dSnFVnU5Ros9ZZBRMnRjJHJy1k`
  (`d8715edcdc137f1c2d80990badc9d8581a2c079a`), compatible avec les versions v3.
  Aucun retour arrière ni changement de schéma supplémentaire effectué.

## Qualification hébergée

TesterArmy `e2e@0.21.3`, `@e2e-dev/web@0.15.3`, Playwright `1.64.1`, Node
`26.12.1`, Chromium desktop 1440 × 1000. Un worker, aucun retry. Checkout détaché
du commit déployé, sans `.env` ambiant. Recette de production distincte : les
protections loopback de la recette locale restent inchangées.

Compte et organisation fictifs isolés, un seul membre. Aucune écriture dans les
affaires existantes : toutes les versions modifiées portent le préfixe
`ARMY-PROD-20261025-09e4f75e05`. Les envois d'e-mail, approbations, invitations
et créations de jetons de portail sont bloqués dans cette campagne.

| Parcours | Résultat observé |
| --- | --- |
| Accès anonyme | Login accessible ; API des devis : HTTP 401 |
| Inscription et authentification | Inscription réelle réussie au premier passage ; connexion par mot de passe rejouée avec le même compte |
| Création d'affaire et devis | Wizard réel, moteur 3 enregistré |
| Modification et persistance | Quantité 2 → 3 ; après rechargement : HT 39 390 c, TVA 7 878 c, TTC 47 268 c |
| Import DPGF CSV | Mapping réel, deux lignes, quantités 2 et 0, provenance DPGF ; HT 2 626 c, TVA 525 c, TTC 3 151 c |
| Export CSV | Vrai téléchargement ; contenu parsé, quantités, prix, montants de lignes et pieds HT/TTC exacts |
| Modèle de devis | Sauvegarde et insertion par les API authentifiées ; ligne et HT 26 260 c persistés, lecture dans l'éditeur |
| PDF | Génération HTTP 202 ; vrai téléchargement HTTP 200, signature PDF, 40 170 octets et SHA-256 identiques au document enregistré |
| Ouvrage | Insertion authentifiée, quantité 2, source assembly_library, HT 26 260 c, lecture dans l'éditeur |
| Listes et déconnexion | Affaires, commandes, fournisseurs, modèles et ouvrages accessibles ; déconnexion réelle, puis API des devis HTTP 401 |
| Réglages administrateur | FO=12 refusé dans l'interface ; 1,35 / 1,25 persistés, proposés par l'assistant et hérités par une création sans coefficients ; ancien devis inchangé ; valeurs initiales restaurées |

Première exécution `01a17332-03fd-72ab-9213-0ada193f5a21` : 2 succès, 1 échec,
4 ignorés. La préparation API gardait son verrou avant ouverture de l'éditeur.
Les deux affaires de cette exécution ont été supprimées, réponse 200 vérifiée.
La recette libère désormais son verrou avant de passer à l'interface.

Deuxième exécution `01a17337-c86f-7ac7-bfdc-076dda36d556` : **5 succès, 1 échec,
1 ignoré**, sans retry. L'observation PDF renvoyait des champs `undefined`,
refusés par le sérialiseur JSON du runner ; la reprise utilise des champs nullable.
Pendant ce contrôle, Supabase est également passé à `UPGRADING` : la lecture SQL
de gestion était indisponible et Vercel a enregistré une connexion amont interrompue
sur la route PDF à 13:23:57 UTC. Le nettoyage a conservé son reçu d'échec HTTP 401.
Ces échecs ne sont pas présentés comme des succès.

Supabase est revenu `ACTIVE_HEALTHY` à 13:31:12 UTC, en PostgreSQL `17.11.0.003`
(avant : `17.6.1.063`). Le PDF correspond toujours à la révision 8 du devis,
sans erreur enregistrée. Les fonctions public exécutables par anon restent à zéro.

Troisième exécution `01a17342-4b1c-7217-bf54-281d3ace5086` : **3 succès, 1 échec**.
Connexion, téléchargement PDF et insertion d'ouvrage passent. La sonde de liste
a révélé un défaut existant de GET /api/estimates/templates sans query order :
HTTP 400, alors que le contrat rend ce tri optionnel. L'interface utilise un tri
explicite et n'est pas bloquée. Correction minimale : transmettre undefined au
schéma lorsque order est absent, afin d'activer son défaut recent ; les valeurs
invalides restent refusées. Cette correction est relue indépendamment.

Quatrième exécution `01a17343-f699-7f59-a187-1fccc65788c6` : **5/5 succès**, sans
retry. Création/modification, import/export et modèle sont rejoués après la mise
à niveau PostgreSQL, puis les listes avec les paramètres réels de l'interface et
la déconnexion. Pour le seul correctif a993b19c, les chemins
création/calcul/import/export/PDF/insertion d'ouvrage et de modèle n'ont pas changé :
leurs résultats ont été réutilisés lors du cinquième passage. Les rejeux sur
7255d1d2 sont décrits plus bas.

Correctif publié sur main : `a993b19c488989909fa440d3223b4ebb2feceb00`.
Seule une ligne de la route templates change. `origin/main` a été intégré en
avance rapide avant le commit : ses deux nouveaux fichiers étaient des reçus
documentaires, sans autre changement applicatif. OpenAPI documente déjà order
comme optionnel ; son contrat ne nécessite pas de changement.

`npm run verify:pr` réussit sur le correctif a993b19c dans le checkout isolé,
avec le même fichier de route
(SHA-256 `4bc1703f696fbd42f7228ff5a191aecc54b0faca0429de8638634f52c64a3a31`).
Node : 3 547 succès, 3 tests ignorés ; jsdom : 843 succès ; couverture critique :
12 succès. Audits, hygiène, types DB, architecture, OpenAPI, TypeScript, lint et
protections Army passent. Journal : `outputs/production-20261025/verify-pr.log`.

Cinquième exécution `01a17356-1ecd-77a7-b499-5b5097ca523f`, sur le **build intermédiaire
a993b19c : 3/3 succès**, aucun retry, échec ni test ignoré. Le badge de version
affiche `0.5.1 · a993b19`. Connexion réelle, cinq listes principales, API anonyme
refusée et déconnexion passent. Un modèle fictif est créé depuis le brouillon de
test, retrouvé avec son ID et son nom dans le GET sans order (**HTTP 200**), puis
supprimé (**HTTP 200**). Un tri explicite invalide reste refusé (**HTTP 400**).
Le contrôle SQL final confirme zéro modèle et zéro ouvrage résiduel.

Commande, après préparation du checkout a993b19c avec Node 26.12.1, les deux
fichiers de recette et le compte fictif privé :

```sh
PRODUCTION_RELEASE_COMMIT=a993b19c488989909fa440d3223b4ebb2feceb00 npx e2e run --config e2e.production.config.ts --grep 'P00|P07' --max-failures 1
```

Après ce passage, Supabase est `ACTIVE_HEALTHY` en 17.11.0.003. La requête Vercel
bornée à ce déploiement depuis 13:51:45 UTC ne retourne aucun groupe de log
error/fatal. Ce contrôle couvre la fenêtre de qualification, pas une disponibilité
historique ou un test de charge. L'erreur amont de maintenance de l'ancien build
reste conservée dans les preuves.

Sur le nouveau main 7255d1d2, la sixième exécution
`01a17362-9a3e-7e5f-9619-2db9966b1307` compte **2 succès, 1 échec, 6 ignorés**.
La création par l'assistant réussit, puis une préparation API reçoit HTTP 400.
Les journaux PostgreSQL de 14:07:17 à 14:07:33 UTC montrent quatre annulations
`57014` (statement_timeout) : catégories, nettoyage des verrous, lecture des verrous,
suppression. Le classement générique de cette erreur explique le 400 ; ce n'est
pas une preuve de payload invalide. L'upsert des catégories intervient avant la
lecture de politique ; ces chemins SQL n'ont pas changé avec les deux nouveaux lots.

Le bloqueur ou la saturation de cette fenêtre n'a pas été capturé : les échantillons
ultérieurs n'attribuent pas sa cause. Les seuils de délai SQL et les contrôles
de protection sont inchangés. La préparation de recette quitte désormais l'ancien éditeur avant
ses appels API et enregistre le statut, la durée HTTP et l'erreur. Diagnostic :
`outputs/production-20261025/timeout-diagnostic.json`.

Septième exécution isolée `01a1736a-d768-7245-96cb-2fdddcc68781` : **2/2 succès**.
La création API reçoit 201 en 1 698 ms HTTP, puis modification et persistance passent.
Le nettoyage récupère aussi l'affaire du sixième passage, trois suppressions vérifiées.
Cette durée HTTP n'est pas une mesure SQL ni une qualification de performance.

Huitième exécution `01a1736c-9f61-744d-a7da-37e284f1579b` : **7/7 succès**, sans
retry, échec ni test ignoré. Connexion, import/export CSV, modèle, téléchargement PDF,
ouvrage, réglages administrateur, listes et déconnexion passent sur 7255d1d2.
Les neuf contrôles prévus sont ainsi couverts sur ce même build par les campagnes
6 à 8 ; cela ne transforme pas le sixième passage échoué en succès.

Commande du dernier passage, même environnement épinglé et recette conservée :

```sh
PRODUCTION_RELEASE_COMMIT=7255d1d260fe4bed5f0aca99322ab1f4595f3c12 npx e2e run --config e2e.production.config.ts --grep 'P03|P04|P05|P06|P08|P07' --max-failures 1
```

Les nouveaux réglages sont relus après navigation et dans le devis créé. Le devis
PDF existant reste au moteur 3, coefficients 1,30 / 1,20, HT 26 260 c, TVA 5 252 c,
TTC 31 512 c, révision 8. L'interface puis SQL confirment la restauration des valeurs
initiales du tenant fictif : 1,30 / 1,20 et TVA [2000, 1000, 550, 210] bp, moteur 3.
Sa première politique explicite et ses deux événements de journal restent conservés.

Après ces passages, Supabase est ACTIVE_HEALTHY et les fonctions public exécutables
par anon restent à zéro. La requête de logs error/fatal du déploiement final depuis
14:15:44 UTC ne retourne aucun groupe. L'épisode 57014 antérieur reste conservé et
sa cause précise demeure indéterminée.

## Données et preuves

Dix-huit affaires temporaires ont été supprimées par les API normales, avec réponses
et identifiants vérifiés. Aucun modèle ni ouvrage de test ne subsiste.
Conservation diagnostique explicite : **quatre affaires fictives** (trois imports,
un PDF), sept versions brouillon, trois imports, un PDF de 40 170 octets, avec leur
compte et leur organisation à un membre. L'import CSV utilise le parseur navigateur :
`storage_path` est NULL, aucun binaire d'import n'a été téléversé. Le PDF de test
reste lié à son brouillon ; aucun objet Storage n'est supprimé directement en SQL.
L'inventaire est borné au compte et au préfixe de cette campagne ; aucune affaire
préexistante n'a été modifiée. Détail local :
`outputs/production-20261025/fixture-inventory-latest-main.json`.

Preuves locales dans `outputs/production-20261025/` : identité du déploiement,
recettes et rapports natifs avec téléchargements. Les fichiers privés de connexion
et sessions ne font pas partie des preuves livrées. Le seul compte fictif est
conservé localement hors preuves dans `.private/production-20261025-account.json`,
ignoré par Git, mode 0600 ; les sessions temporaires sont supprimées.
Voir le [reçu machine final](production-main-2026-10-25.json).
Le checkout temporaire et son runtime Node sont retirés après vérification
d'inactivité et conservation des éléments uniques. Reçu de récupération local :
`outputs/production-20261025/workspace-recovery.md`. Les fichiers `.env` et les
travaux préexistants du checkout canonique sont préservés.

Limites : cette campagne ne qualifie pas l'envoi d'e-mails, le portail client,
les décisions d'approbation, les travailleurs IA, ni une commande fournisseur
réelle. L'affichage du nom original d'un plan M1a est couvert par la CI du commit ;
l'upload d'un plan renommé n'a pas été rejoué sur le partagé. Les suites locales du
lot 3.3 et le verify:pr a993b19c restent des preuves distinctes ; la CI complète
du nouveau main, build et cinq shards critiques compris, est verte.
