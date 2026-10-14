# Lecture complète d'une grande DPGF — recette locale du 14 octobre 2026

La première tranche qualifie l'import CSV canonique, les prix et la provenance de chaque ligne, la lecture complète et le rechargement. Le complément du 14 octobre plus bas qualifie aussi un parcours local de 1004 lignes jusqu'au PDF, au snapshot V2, à l'approbation, au sceau et au portail. Les exports XLSX, les achats et la recette complète de l'application restent hors de ces preuves.

## Problèmes reproduits et correction

Le premier import de 1004 lignes conservait 1004 lignes brutes et mappées, mais créait seulement 1000 lignes commerciales. Le GET masquait encore un élément : 1000 items/999 lignes retournés. Les montants stockés étaient 1987500/397500/2385000 centimes au lieu de 1995450/399090/2394540. La lecture native de ce RED est conservée dans `.e2e/offer-emission/large-import-diagnostic-native-20261014-02/`.

La lecture des lignes mappées, le GET version, la gating, le résumé d'approbation et `listEstimateItems` utilisent maintenant des pages de 500 avec ordre stable, nombre exact contrôlé et refus d'un résultat partiel. Le GET version et la liste vérifient l'identité, le tenant, le projet, le statut, `updated_at` et `content_revision` après enrichissement, sans adopter un nouveau token. Les accès, le contrat d'import et l'enrichissement de provenance restent inchangés.

Un second RED en production a montré le résumé d'approbation avançant `updated_at` pendant la lecture, provoquant VERSION_CONFLICT. La timeline du run `2026-10-14T03-20-08-771Z-84fab489-292a-4bfe-994d-06464cfa1db8` lie le GET initial, le PATCH des trois champs d'approbation, le nouveau timestamp et le HTTP409. La migration `20261014033048_estimate_approval_projection_clock.sql` conserve le résumé mémorisé utilisé par Direction et les listes. Seule une projection service_role modifiant exclusivement `approval_status`, `approval_summary`, `approval_evaluated_at`, avec timestamp entrant inchangé, conserve l'ancien timestamp. Toutes les autres mises à jour gardent now(). La fonction globale de timestamp et les autres triggers sont conservés ; la nouvelle fonction est invoker et n'expose aucun EXECUTE direct aux rôles applicatifs.

SQL : baseline9/14, candidat14/14 en rollback, répétition annulée, application sur la seule base locale33485, relecture indépendante et installé14/14. Les images complètes des données et droits existants sont conservées. Les clones de table testent uniquement le prédicat du timestamp et une future colonne, pas l'ensemble des gardes métier. Aucune concurrence entre deux connexions n'est qualifiée.

## Résultats exacts

Build de production local `1MYrkLow_6U7LUtFPsVqb`, manifest `9ad2f06f…`, Node24.19.0, main `ce5874f5…`, app3176/API45585. Les sources restent figées pendant les trois runs ; retries0, traces authentifiées désactivées, aucune livraison externe.

| Cas | Lignes | Items avec section | HT / TVA / TTC en centimes | Résultat |
| --- | ---: | ---: | --- | --- |
| NRPI999 | 999 | 1000 | 1984710 / 396942 / 2381652 | PASS import et reload |
| NRPI1004 | 1004 | 1005 | 1995450 / 399090 / 2394540 | PASS import et reload |
| NRPI2004 | 2004 | 2005 | 3982950 / 796590 / 4779540 | PASS import et reload |

Chaque ligne est comparée à l'oracle CSV indépendant : titre, unité, quantité, prix, taxes, totaux, parent, position et identifiants de mapping/provenance. Toutes les requêtes de lignes de la version possédée sont paginées ; la frontière1000 comprend une page finale vide. Chaque campagne exécute deux tests sélectionnés (login et cas), avec cinq variantes filtrées identifiées explicitement. La V1 conserve exactement son contenu, son timestamp, sa révision, son projet et ses items ; seuls les trois champs d'approbation dérivés sont exclus de cette comparaison. Le témoin de compatibilité `initialUnchanged` ne signifie donc pas une égalité de l'image brute entière.

La lecture native NRPI1004 constate 1004 raw, 1004 mapped, un mapping, 1005 items/1004 lignes, aucun lien raw manquant, indices0–1003 et sommes des lignes égales aux trois montants de l'oracle. Son marqueur `businessQualified:false` reste inchangé : c'est une lecture diagnostique stable, liée au parcours UI réussi, pas une preuve PDF, cryptographique ou concurrente. Il n'y a pas de lecture native NRPI999/2004 dans cette tranche.

Lint ciblé, typecheck, OpenAPI généré/validé, manifest de migrations et build passent. Le test de provenance existant passe avant/après l'adaptation de sa seule fabrique (1 sélectionné,43 filtrés) ; aucune assertion unitaire nouvelle. Quatre anciens tests d'insertion d'assemblage échouaient déjà avec LOCK_REQUIRED et ne constituent pas un succès global.

## Reproduction et preuves

Les manifests conservent la commande, révision, changements locaux, profils masqués, identités de fixtures, sources copiées, résultats et artefacts. Reprendre la recette stage08 avec un nouveau build admis et les profils locaux explicites existants ; ne jamais afficher leur contenu ni réutiliser les identités des campagnes comme seed.

- NRPI1004 : `.e2e/army/offer/runs/2026-10-14T03-55-18-160Z-fdea6184-89f5-4b0b-9258-80ddb24e3335/public/manifest.json` (`22027052…`).
- NRPI999 : `.e2e/army/offer/runs/2026-10-14T03-56-06-757Z-a4ecc385-0aab-411f-bb5a-3e574babee3c/public/manifest.json` (`2fcddce8…`).
- NRPI2004 : `.e2e/army/offer/runs/2026-10-14T03-57-28-344Z-c1382517-aae8-4d36-9a63-bcaba367f490/public/manifest.json` (`4de8e291…`).
- Admission archives : `.e2e/offer-emission/nrpi-archive-qualified-20261014-02/receipt.json` (`44bba27a…`) ; 2309 artefacts et56 fichiers JSON/JSONL par campagne. Fichiers privés exclus ; trois outils de build sont liés aux fichiers physiques par SHA, hors copies du runner ; dist mutable non requalifié par cette admission.
- Native1004 : `.e2e/offer-emission/nrpi1004-native-20261014-01/receipt.json` (`41aeec46…`).
- Installation/relecture/SQL installé : dossiers `.e2e/offer-emission/nrpi-approval-clock-application-execute-20261014-01`, `nrpi-approval-clock-application-independent-20261014-01`, `nrpi-approval-clock-sql-runs/installed-20261014-01` (`9fbb8f20…`, `65c5a390…`, `fc088992…`).
- Clôture liée : `.e2e/offer-emission/nrpi-root-closure-20261014-01/closure.json` (`96de38ba…`). Revues indépendantes listItems `8d18991b…`, stage08 `6901345e…`, migration/opérateurs `34961f8d…`, admission archives `769c7e80…`.

Tous les RED et les erreurs de préparation restent conservés. Toutes les fenêtres app/SQL sont fermées et le keeper natif reste en place. Pas de commit, publication ou mutation distante. Cette documentation est postérieure aux runs : les preuves de build et de source restent datées.

## Grande offre jusqu'au PDF et au portail — 14 octobre 2026

Quatre lecteurs supplémentaires utilisent maintenant la lecture complète par pages de 500 éléments : génération/configuration PDF, gel V2, source de vérification du sceau et copie d'offre vérifiée. Une relecture compare les six champs de version initiaux après lecture/calcul/enrichissement (après téléchargement pour l'offre). Les CAS et sessions originaux, les gardes SQL, Doc1/Client1/Seal5 et le stockage immuable restent inchangés. Corriger seulement PDF+V2 aurait laissé un calcul de sceau partiel ; les quatre coupes sont qualifiées ensemble.

Le parcours NRPG1004 final passe sur le build de production local `u6sOKDiKfkzf4AKkiSB4q` : **2 cas sélectionnés PASS** (connexion normale et parcours métier),159 étapes, 5 autres cas filtrés, aucune trace ni retry, sources stables. L'import conserve 1004 raw/mapped/lignes et 1005 items ; totaux1995450/399090/2394540 centimes. La règle existante exige une approbation au-delà de 500000 centimes : le test soumet puis approuve explicitement dans l'Affaire avec l'admin existant, sans modifier règle/rôle ou forcer l'envoi. Le natif lie un cycle, une approbation et la révision 2011 aux témoins UI et aux 1004 snapshots complets. Ce cas ne qualifie pas une séparation de deux acteurs.

Deux HTTP200 d'émission/renvoi donnent des identifiants de reçus distincts et **les mêmes 171826 octets PDF**, SHA `6799e2358ca5427c56a4b1b46d6b876c61d76228d008ec5b007ec676d613885d`. Le nom du projet courant change ensuite sans modifier l'identité capturée, les items, le sceau ou les octets renvoyés. Le portail anonyme affiche 1004 références dans l'ordre avec les montants exacts, avant/après reload. Le lecteur natif vérifie Doc1, sources et droits conservés ; le lecteur crypto recalcule Seal5 sur toutes les lignes et contrôle les vrais octets. Le texte PDF vérifie toutes les références ordonnées, les cellules aux bornes et les trois montants, sur 37 pages.

Deux défauts de présentation trouvés sur les vrais PDF sont corrigés : séparateurs de milliers U+202F restitués comme slashs par Helvetica, puis chevauchement Devis/référence et débordement des noms longs. Les espaces sont normalisés dans les textes PDF seulement ; lineHeight et césure locale des champs d'identité préservent HTML, textes sources et contrat. Rendu PNG contrôlé des pages1/19/36/37, dont page1 à résolution originale ; ce contrôle échantillonné n'est pas une inspection visuelle des 37 pages.

Les CGV sont un brouillon de développement v3, `isDraft:true`, `legalReviewedAt:null`, notice visible. La policy serveur les refuse en production par défaut et sur Vercel ; leur opt-in exige le profil de recette production locale exact 45585 et des origines loopback. Modèle réellement validé du tenant toujours prioritaire. Cette recette n'apporte pas une validation juridique ni une qualification d'émission Internet. Les 43 tests frontière préécrits et 170 régressions existantes des contrats passent ; lint/typecheck/build passent. Les deux usines de tests maintenues avant code n'ont ajouté aucun cas/assertion ; leur baseline de 49 tests comptait 33 PASS/16 FAIL anciens. Aucun succès global Vitest n'est revendiqué.

Preuves finales liées dans `.e2e/offer-emission/nrpg1004-root-closure-final-20261014-01/closure.json`, SHA `7f69a4fc17188ed384f5232fbe3bbf4714bd3ba66257bbb2628bd12fd14ed760` :

- UI : `.e2e/army/offer/runs/2026-10-14T05-18-54-442Z-a9be62c4-84c8-4aa0-9bb0-f1baa9ead95c/public/manifest.json` ; admission archive indépendante `nrpg1004-archive-review-final-20261014-01/receipt.json` (`5238b7a6…`), 2352 artefacts et 2307 sources copiées, bytes/SHA/inventaire/JSON/JSONL vérifiés.
- Build : `.e2e/army/recipes/builds/2026-10-14T05-16-26-976Z-23960212/manifest.json` (`93d15548…`).
- Natif : `.e2e/offer-emission/nrpg1004-native-final-20261014-01/receipt.json` (`ae3ff271…`) ; crypto voisin (`5aa61fc8…`). Lecteur ORIGINAL stage10 `7fbac420…`/précode `12eaf5a7…` utilisé sur le témoin11 lié ; copie11 exclue car son précode dérivé ne satisfait pas le pin d'entrée.
- Texte : `.e2e/army/offer/runs/nrpg1004-pdf-text-final-20261014-01/public/receipt.json` (`be7647b9…`) ; visuel : `.e2e/offer-emission/nrpg1004-visual-final-20261014-01/visual-review.json`, images privées et empreintes dans `render.json`.

Les refus09 d'approbation, l'erreur10 de DTO de recette (rôle absent du reviewer public), le cleanup PDF.js corrigé sur le loading task et les PDF visuels RED restent conservés. Aucun accord futur ne transforme ces échecs en PASS. Aucun changement DB supplémentaire requis pour cette tranche ; keeper intact. Les cinq frères filtrés, NRPG999/2004, exports XLSX, deux connexions concurrentes, exploitation et recette complète restent hors preuve. Les pages propriétaire/impression et le recalcul des réglages gardent des lectures plafonnées : risque à traiter ensuite, avec RED observable, avant de qualifier ces parcours. Le goal reste actif. Documentation ajoutée après la qualification : nouveau build admis nécessaire pour la prochaine recette.

## Réglages, consultation et aperçu d'impression complets — 14 octobre 2026

Le plafond est désormais corrigé dans `recalculateEstimateVersionTotals` et dans les deux pages propriétaire/impression. Tous trois réutilisent le lecteur authentifié par pages de 500, puis comparent les six champs de la version initiale après calcul/enrichissement. Les pages attendent la version accessible et un tenant actif identique avant la lecture des items ; les projections print moderne et legacy contiennent aussi id/updated_at. Aucun calcul, contrat d'offre, garde SQL ou token original n'est remplacé. La branche historique de persistance du helper et les lectures source de duplication/import restent hors preuve d'atomicité.

RED réel RCL1004 : modifier seulement la validité30→31 sauvegardait avec HTTP200 un pied1987500/397500/2385000 au lieu de1995450/399090/2394540, malgré1005items présents. Le run `2026-10-14T05-45-23-074Z-b54616a2-5ece-400e-a9eb-2b3225bd6834` et sa copie source restent conservés. RED réel OPR1004 : propriétaire/reload et impression/reload affichaient999lignes/1000rows et1984710/396942/2381652 ; run corrigé avant produit `2026-10-14T06-03-39-422Z-31241ed6-5a40-42f2-b882-c63690f88ad5`. La première baseline OPR conserve le défaut owner mais manque la preuve print : Next gardait une ancienne région cachée dans le DOM. Le second précode observe uniquement la région réellement visible ; aucune assertion de ligne ou de montant n'a été réduite.

| Parcours exécuté | Lignes / items | HT / TVA / TTC principal, centimes | Résultat |
| --- | ---: | --- | --- |
| RCL1004 | 1004 / 1005 | 1995450 / 399090 / 2394540 | validité31, cycle TVA et trois reloads exacts |
| RCL2004 | 2004 / 2005 | 3982950 / 796590 / 4779540 | mêmes assertions sur toutes les lignes |
| OPR1004 | 1004 / 1005 | 1995450 / 399090 / 2394540 | quatre vues, toutes les cinq cellules de chaque ligne |
| OPR2004 | 2004 / 2005 | 3982950 / 796590 / 4779540 | mêmes matrices complètes et reloads |

RCL conserve toutes les identités, quantités, prix et provenances ; subcontractor impose TVA0/TTC=HT puis principal restaure chaque taxe. L'observateur conserve le PATCH original, son statut, l'If-Match initial et la seule présence d'un header de bail, sans modifier réponse/requête ni enregistrer sa valeur privée. Il attend la fin de sauvegarde avant GET/reload. La lecture native des deux fixtures contrôle également tous les liens raw→mapped→source, les IDs ordonnés, les montants et le token à la microseconde, avec snapshots de fixture stables. OPR contrôle exactement les huit matrices visibles, section, ordre et trois montants ; le GET final conserve projet, version commerciale et tous les items/sources. Seules les trois projections d'approbation dérivées sont explicitement exclues de la comparaison de version. OPR qualifie l'aperçu HTML, pas une impression native ou un nouveau PDF binaire.

Chaque campagne exécute deux tests sélectionnés (connexion ordinaire et parcours), un sibling identifié filtré, traces/retries0, worker1, collector vide, sources avant/après identiques. Build RCL `trnzT7-SiTcOHkm0RbFH9`, build OPR `A5KrWV9g3QCYKwBQbDCfB`, Node24/main ce5874f5/app3176/API45585. Lint ciblé, typecheck, build et diff-check passent. Les cinq régressions serveur existantes passent avant/après la maintenance précode de leur seule factory et après produit ; aucune assertion unitaire nouvelle. Cela ne rend pas vert l'ensemble des anciens tests du dépôt.

Preuves et reproduction : les commandes/profils masqués, sources copiées, CSV/oracle, IDs, attentes/résultats et empreintes sont dans les manifests terminaux. Reprendre les paquets RCL/OPR avec un nouveau build admis et uniquement de nouvelles fixtures ARMY ; leurs copies exactes sont aussi archivées dans chaque `source-inputs`.

- RCL1004 : `.e2e/army/offer/runs/2026-10-14T05-48-51-142Z-6fba095d-b280-46e7-88bb-bd356c8abd6f/public/manifest.json` ; RCL2004 : `2026-10-14T05-49-57-975Z-7ceea400-ec18-45d7-a152-2d6a7cbceda7/public/manifest.json` sous le même dossier runs.
- Admission RCL : `.e2e/offer-emission/recalc-archive-review-20261014-01/receipt.json` (`fc939fd1…`),2299artefacts/2257sources par campagne. Natif : `recalc-sql-audit-20261014-01/native-rcl1004-01/receipt.json` (`ef364d23…`) et `native-rcl2004-01/receipt.json` (`1824e351…`).
- OPR1004 : `.e2e/army/offer/runs/2026-10-14T06-09-56-162Z-bb30f032-12dd-46b7-b259-650828c7878c/public/manifest.json` (`e097b462…`) ; OPR2004 : `2026-10-14T06-11-21-505Z-3f411278-5374-4364-b5ec-c8a951523c7b/public/manifest.json` (`431d105f…`) sous le même dossier runs. Admission `owner-print-archive-review-20261014-01/receipt.json`,2291artefacts/2257sources par campagne.
- Revues produit : `recalc-green-review-20261014-01/receipt.json`, `owner-print-review-20261014-01/delta-receipt.json` (`40e57180…`). Clôture liée : `.e2e/offer-emission/large-read-root-closure-20261014-01/closure.json`.

Une autre défaillance reste prioritaire : la baseline SQL spécialisée12cas produit7PASS/5RED dans l'ancien RPC. Une ancienne session est admise après reprise par une autre page du même utilisateur ; des pieds incomplets sont acceptés ; une marge2 peut modifier le pied sans modifier les HT des lignes. Tout est annulé par cas puis ROLLBACK, fixtures résiduelles0, RPC/OID/ACL et identités conservés. Ce takeover est séquentiel, aucune course à deux connexions n'est qualifiée. Précode `recalc-sql-audit-20261014-01/regression-v3.sql`, reçu baseline-03 `b6f3b92a…`. La correction de pagination ne ferme pas ces écarts. Le contrat proposé `settings-atomic-contract-20261014-01/contract.md` prévoit une transaction réglages/projections/pied, session exacte, CAS timestamp/révision, dépendances brutes, arrondi signé et suppression du second bulk du hook, en conservant les sémantiques V1/V2.

Aucune migration supplémentaire nécessaire pour les trois corrections de lecture. Les prochaines migrations locales nécessaires sont déjà autorisées ; préparer/relire/tester ce nouveau contrat avant application sur33485. Tous les handles app/build/SQL de cette tranche sont terminaux, keeper conservé. Le goal reste actif : sauvegarde atomique, corpus, exploitation et recette complète ne sont pas acquis. Cette documentation est ajoutée après qualification ; un nouveau build admis sera nécessaire pour la prochaine recette.
