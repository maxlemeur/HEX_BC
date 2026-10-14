# Avancement du logiciel de chiffrage au 14 octobre 2026

La remise fixe et ses principales frontières SQL sont corrigées et qualifiées sur la base locale. L'application complète reste à qualifier : les parcours de l'interface sur ces nouvelles sources, les exports réels et le suivi chantier ne sont pas clos. Le commit demandé sauvegarde l'ensemble du travail présent ; il ne constitue pas une version prête à mettre en service.

## Tranche terminée

Le montant demandé est conservé en centimes, distinct du montant réellement appliqué lorsque la remise dépasse le devis. Une remise explicite de zéro reste distincte du mode historique en pourcentage. Les corrections couvrent les calculs décimaux FO/MO et marge, le plafonnement des montants, les copies et modèles, le contexte V2, les sceaux et les seuils de gouvernance. Les lecteurs V1 utilisent les montants stockés des offres émises.

La migration locale des remises et de l'intégrité des modèles a passé **94 contrôles sur 94**, d'abord sous rollback, puis après application sur le schéma installé. Ils couvrent sauvegarde, gel V2, droits et parents des modèles, calculs et deux recalculs de métré. L'application a conservé les données des 155 tables observées, les droits, les 17 interfaces existantes et l'ancien historique des migrations. Les nouvelles colonnes restent NULL pour les anciennes versions. La conservation des octets Storage et des séquences n'entre pas dans ce contrôle.

La saisie réelle de 1,01 €, le rechargement, la copie, les aperçus et les exports doivent encore passer leurs recettes TesterArmy sur les nouvelles sources. Le raccord entre calcul JS et recalcul SQL du coefficient d'un brouillon historique NULL reste à reproduire puis à traiter. Les anciens documents et leurs sceaux ne doivent pas être recalculés depuis les tarifs du jour.

## État des sept lots

| Lot | Capacités présentes ou corrigées | Travail restant pour la recette candidate |
| --- | --- | --- |
| Calcul et saisie | Remise fixe, calculs décimaux, plafonds, compatibilité et contrats SQL installés | Interface, copies et modèles, aperçus et exports réels, coefficient des brouillons historiques et concurrence |
| Dossier et CCTP | Références versionnées, exigences, citations, décisions et import canonique | Dossier A/B complet ; lecture des passages non examinés explicite ; corrections et sources conservées après révision |
| Prestations et prix | Ouvrages relus, composants écartés, provenance de bibliothèque, référence fournisseur | Parcours complet ; offres à zéro, expiration à six mois calendaires et comparabilité contrôlées jusque dans les écritures serveur |
| Offre commerciale | Contrat client figé, validations, émission et portail | Requalification actuelle avec montants exacts, PDF réel, acceptation/refus et absence d'informations internes dans la sortie client |
| Suivi chantier | Préparation d'achats, commandes, quantités décimales et historique des corrections | Budget initial approuvé, besoins et allocations, engagements, réceptions partielles, consommations et heures réelles |
| Retour d'expérience | Corrections de suggestions et modération existantes | Adoption humaine préalable, contexte chantier, preuve et historique durable des décisions ; le seuil de corrections seul ne suffit pas |
| Livraison | Sources, migrations, essais et audits sauvegardés ; preuves locales conservées | Contrôles globaux verts, trois dossiers de recette, reprises et courses, sauvegarde/restauration isolée, dossier d'activation et de repli |

Le répertoire des sites de livraison et le statut global « received » ne constituent pas un budget chantier ni des quantités réceptionnées. Les dossiers courant, DPGF de 2 004 lignes et révision A/B restent les sorties prévues du [goal candidat](goal-chiffrage-candidate-2026-10-14.md). Aucun des sept lots n'est déclaré entièrement clos par cette tranche.

## Contrôles du dépôt

| Contrôle | Résultat du checkpoint |
| --- | --- |
| SQL candidat et installé | 94/94 PASS chacun ; application locale et conservation vérifiées |
| TypeScript et OpenAPI | PASS |
| Historique des migrations | Validation PASS ; contrôle existant 4/4 PASS après ajout des entrées manquantes |
| Suite Vitest globale initiale | 2 903 PASS, 84 FAIL, deux tests en attente sur 2 989 ; aucun verdict global vert après le contrôle ciblé d'histoire |
| Lint global | Huit erreurs de require CommonJS et un warning dans les scripts de reproduction d'audit |
| Architecture | Contrôleur de synchronisation : 1 333 lignes non vides, plafond 1 200 |
| Compilation et performance | Build complet PASS après retrait demandé du plafond de bundle de l'éditeur ; quatre autres budgets inchangés et PASS ; 35/35 tests existants du contrôleur PASS |
| Interface et exports de cette tranche | Recettes préparées, pas encore exécutées sur ces sources |
| Vérification des espaces de l'index | Espaces et fins de fichiers conservés dans des résultats bruts d'audit et quelques fichiers antérieurs ; aucune réécriture de ces preuves pour rendre le contrôle vert |

Les 15 échecs des mocks PDF sont identiques avant/après la dernière correction des lecteurs V1. Le golden qui exige un plafond silencieux reste conservé jusqu'à une preuve E2E équivalente. Les autres échecs nécessitent leur propre qualification ; leur présence n'est pas attribuée globalement à des mocks obsolètes.

Les douze configurations générées qui importent des recettes privées sous `.e2e` restent locales, avec leurs dépendances. Les caches Python et les environnements privés sont exclus du commit. Les configurations publiques d'offre et de portail conservent leurs sources dans `e2e/army/local`. Les audits et le dossier de transmission déjà présents sont sauvegardés sans nouvelle transmission externe.

Le porteur a demandé le retrait de la règle de taille du bundle de l'éditeur après son dépassement de 165 octets. Seule l'entrée `estimate-editor` est retirée de `config/performance-budgets.json` ; les quatre autres budgets, leur contrôleur et la commande de build restent actifs. L'échec initial est conservé, puis le build complet passe sur cette configuration. Ce résultat ne mesure pas les performances en utilisation réelle.

La vérification avant commit a repéré un profil de session navigateur dans l'archive de transmission. Cette seule entrée est retirée de la copie destinée au commit ; les trois métadonnées de transmission sont actualisées, les autres membres source sont conservés et l'original reste privé. L'empreinte de l'archive assainie est `945c4ac1dc7814e77c9d90fd08ef3c83337ace4ab278eee27112be250223e6e3`.

## Priorités proposées pour la prochaine décision

1. Fermer une version de chiffrage fiable : saisir, modifier, recharger, copier, générer et relire les sorties avec les mêmes valeurs exactes ; traiter les échecs globaux nécessaires à cette livraison sans assouplir les contrôles.
2. Qualifier le dossier courant « Résidence Atlas » puis sa révision A/B : import, CCTP, ouvrage relu, réemploi et sélection fournisseur explicite. Les passages non lus et les offres exclues restent visibles.
3. Partir d'une offre acceptée pour livrer un budget initial interne approuvé et ses besoins. Introduire ensuite réceptions, consommations et retours validés en distinguant vendu, prévu, engagé et consommé.

Ces priorités alimentent le point d'avancement demandé. Le goal actuel reste une vision candidate ouverte ; ses objectifs ne sont pas remplacés automatiquement par cette proposition.

## Preuves locales conservées

Les reçus complets et les paquets de recette sont conservés dans `.e2e`, avec les commandes, sources et résultats. Ils restent privés et ne sont pas joints au commit. Leurs identités permettent de vérifier ce checkpoint dans l'espace de travail actuel.

| Preuve | Chemin local et SHA256 |
| --- | --- |
| Candidat SQL 94 | `.e2e/offer-emission/euro-sql-precode-20261014-01/candidate-01/receipt.json` — `bb400659cfb9ce915ff875f9b69fccafb00f02cb71fdebba4dcca08b754c7d89` |
| Application locale | `.e2e/offer-emission/euro-application-20261014-01/application-01/receipt.json` — `9486e45bde50a235c42f5f381b326940005b3363d5ae93972786bf7d8bd78141` |
| SQL installé 94 | `.e2e/offer-emission/euro-sql-precode-20261014-01/installed-01/receipt.json` — `159f7ca1b333d0142bfe394b715c9dd3cde6956ac6d4b6b7a2fe04f9e8e3d4c5` |
| Build initial avec plafond éditeur | `.e2e/army/recipes/builds/2026-10-14T14-12-01-387Z-95a45226/manifest.json` — `e189eecba7c412c623076aeab3893281139bfa5b76b14a0177a9bc330e41161a` |
| Build final après retrait demandé | `.e2e/army/recipes/builds/2026-10-14T14-23-55-474Z-b963b615/manifest.json` — `a20bb0e550d6ebe6d9c25ea923c9477cfcb7766099ad36190fd49d5dac9e8526` |

Le [suivi détaillé](goal-candidate-progress-2026-10-14.md) conserve la chronologie des défauts, réparations et vérifications. Aucune qualification distante, acceptation métier réelle ou mise en service n'est revendiquée par ce checkpoint.
