# Progression vers le logiciel de chiffrage complet

Le goal complet reste **inachevé**. L'[audit](../audit/vision-produit-2026-10-11.md) et le [plan produit](backlog-chiffrage-2026-10-11.md) restent le point de départ évolutif. Ce journal distingue les tranches vérifiées des lots encore ouverts ; il ne vaut pas validation de l'application entière.

**Dernière qualification locale, 12 octobre :** la recette autonome
`source-coverage` passe **12/12**, puis la compatibilité `generated-recovery`
**7/7**, sur le même build `yD3yKrjccL8pHYXHZho5a`. Leurs lecteurs réussissent
28 397 et 24 986 contrôles, sans filtre, retry, skip, modèle ou trace authentifiée.
La pile native passe 34 cas CCTP, 100 générés et 1 241 assertions pgTAP ; les
176 prérequis CCTP, le compteur +11 et les 22 PDF ordinaires sont conservés et
relus aux deux commits. Les preuves et limites sont dans la
[nouvelle rétro](retrospective-recette-chiffrage-2026-10-12.md).

Après ces recettes, la nouvelle rétro retire les dépendances historiques de
deux harnais et ajoute `check:army-recipes` ainsi qu'un index d'accès aux reçus.
Cette modification d'outillage est postérieure au build qualifié ; les archives
restent datées. Le [goal actualisé](goal-chiffrage-suite-2026-10-12.md) prépare
la passation vers GPT-6.1 Sol Ultra. CORE-07, CORE-06 et la verticale A/B
restent ouverts ; les derniers helpers de la verticale A/B ne sont pas couverts
par la recette autonome de couverture.

**Première livraison locale de rétro, 12 octobre :** l'index Git
canonique est réparé, avec sauvegarde et conservation des 2 154 fichiers
contrôlés, sans staging. Les outils de build, qualification native, préparation
de témoins, profil, exécution et lecture sont maintenant dans
`scripts/tester-army/`, pour la voie autonome `generated-recovery`.
Les préconditions de pile déjà installée et de compte existant restent explicites.
La [recette reproductible](../testing/local-recipe-reproducibility.md) donne les
commandes, preuves et limites ; elle ne couvre pas encore tous les helpers CCTP.

La tranche ouvrages/batch utilise le build local `1d0jBvzf6x29IoHQUi4Ey`, qui
passe OpenAPI, Webpack et les cinq budgets
existants (éditeur : 499 976 / 500 000 octets gzip). La récupération des ouvrages
passe **7/7** résultats dans `2026-10-12T18-29-57-281Z`, puis la compatibilité
batch **6/6** dans `2026-10-12T18-46-32-879Z`, avec deux exports XLSX relus.
Les deux campagnes ont des sources et un build stables, sans filtre, skip,
retry, modèle ni trace authentifiée. Leurs lecteurs indépendants réussissent
respectivement 24 529 et 3 126 contrôles. La qualification native du cycle 08
réussit séparément ses 100 cas séquentiels et les 1 241 assertions pgTAP.

La recette a aussi reproduit puis corrigé un vrai défaut d'interface : après
récupération vérifiée d'un ouvrage, le faux statut « En attente » persistait.
Le drapeau est maintenant réévalué à partir du buffer réel ; les saisies et
l'intention restent protégées jusqu'au rechargement réussi. Les preuves
détaillées sont dans les [parcours ouvrages](../testing/generated-ouvrage-recovery-e2e.md)
et [batch](../testing/estimate-batch-client-e2e.md).
Le `read-stage` du cycle 08 reste en échec : deux sentinelles de providers
locaux inutilisés avaient produit un faux positif de confidentialité.
La relecture indépendante qualifie l'archive avec le lecteur strict inchangé,
après retrait de ces seules variables vérifiées dans son environnement.

L'archivage des démarrages sans rapport frais est maintenant corrigé et relu :
neuf cas de harnais passent après reproductions RED, avec vrais processus,
rapport absent ou obsolète, sorties bornées, expurgation et confinement.
La [preuve détaillée](../testing/tester-army-setup-archive.md) distingue cette
régression d'outillage des parcours métier.

Un nouveau build `fX0DQh4bn_NqX4V5kfllb` passe les mêmes contrôles et budgets,
sources stables. La campagne de navigation `2026-10-12T19-30-14-423Z` passe
**3/3** : connexion ordinaire, reload/départ/retour rapide et deuxième document
avec sessionStorage réellement cloné. Les deux parcours sauvegardent par UI
3000/600/3600 centimes et relisent la persistance ; le deuxième document reste
en lecture seule. Aucun correctif produit de verrou n'a été appliqué : cette
sortie naturelle n'a pas reproduit le défaut historique. La lecture indépendante
réussit 17 985 contrôles ; les ordres réseau déterministes restent à qualifier selon le
[contrat CORE-06](../testing/editor-navigation-lease.md).

Restent notamment CORE-06, la sémantique des composants rejetés et l'intégration
des derniers helpers CCTP.
Les deux setups batch échoués n'ont pas de manifeste daté complet : leur reçu
diagnostique postérieur ne reconstitue pas cette preuve manquante.
Ces résultats sont locaux et non publiés ; le goal de l'application complète
reste actif.

**Revue CCTP qualifiée — 12 octobre 2026 :** la revue CCTP dispose maintenant de
onze parcours métier et d'une connexion UI réussis sur un même build de
production local, avec 26 téléchargements XLSX vérifiés et une qualification
d'archive indépendante. Les huit courses natives et les 1 232 assertions
pgTAP sont des preuves complémentaires distinctes. Restent notamment la
matrice d'accès HTTP, la disparition physique des copies, la sortie rapide
pendant le chargement de l'éditeur et la finalisation des ouvrages de CORE-08.
La [rétrospective demandée](retrospective-chiffrage-2026-10-12.md) est disponible.

Après accord explicite de l'utilisateur, la migration de couverture CCTP
`20261011233527_estimate_source_coverage.sql` est aussi installée sur l'ancienne
base locale `32959`, dont les services ont été restaurés sans reset. Reçu
`.e2e/source-coverage/coverage-native/native-installations/apply-a8946fc039e54093/application.json`,
SHA `7ff1dd3c06b303e3ca1f6af0b41cf9489e1177e88ab6738604b46b8b84da62c9` :
72 artefacts vérifiés, données des 114 tables et droits antérieurs identiques
après relecture indépendante, cinq nouvelles tables vides et sept RPC exactes.
Cette installation locale SQL est distincte des recettes exécutées sur la pile
jetable `33485/45585` ; elle ne qualifie pas son interface ou les octets Storage.

**Dernier résultat — CORE-08 :** la baseline HTTP `2026-10-12T02-15-56-429Z`
a reproduit les totaux non persistés, le flag MO ignoré en V1 et les montants
calculés avant coercition décimale. Le correctif local réemploie le moteur
TypeScript et le bulk SQL dans une création transactionnelle. Les 45 cas SQL
séquentiels passent avec rollback et conservation contrôlés ; la migration
`20261012020700_atomic_create_estimate_item.sql` est installée seulement sur
la pile jetable `33485`, jamais sur `32959` ou une base distante. Le build
`VvHbNXoMA0g2N-2OfwSpb` passe OpenAPI et les cinq budgets, sources stables
(archive `.e2e/product-foundation/builds/2026-10-12T02-25-17-349Z`).
La course de normalisation du tenant a été reproduite puis corrigée par une
migration additionnelle, sans réécrire la première. Les neuf courses réelles
et les 1 232 assertions pgTAP passent. La recette du nouveau build a réussi ses
quatre résultats (connexion et trois parcours), sans skip, avec deux vrais
exports. Archive `.e2e/army/coverage/runs/2026-10-12T02-37-27-533Z` ; qualification
indépendante `2026-10-12T02-37-27-533Z-0b43a4e9`, 2 592 contrôles réussis. Le
lecteur corrigé reconnaît et relit les octets XLSX même sans extension ; sa
promotion après qualification conserve les archives et leur contexte original.
La revue a aussi identifié les compensations batch/ouvrages à remplacer par
des finalisations transactionnelles. Le batch est qualifié ci-dessous ;
la finalisation des ouvrages reste ouverte.
La campagne CCTP09 a ensuite passé ses douze résultats sur ce build, avec
26 téléchargements et 3 158 contrôles d'archive réussis :
`.e2e/army/coverage/runs/2026-10-12T02-44-52-792Z` et qualification
`2026-10-12T02-44-52-792Z-3ae92fa7`. Contrats,
preuves et suites prévues : [création](../testing/estimate-create-atomic.md),
[workflows](../testing/estimate-workflow-atomicity.md).
Le tableau fournisseur du panneau achats a été extrait sans changer ses
données ni ses interactions. Le contrôle architectural passe avec le plafond
inchangé, les quatre tests existants du panneau et le nouveau build passent.
Le parcours achats doit encore valider cette extraction dans l'interface.

**Batch qualifié sur les parcours sélectionnés :** WFC01 a reproduit un vrai résultat trompeur
sur le build ci-dessus : `committed:false`, nouvelle ligne C absente, mais
ligne B à 2 ct au lieu de 3 et pied à 7 ct au lieu de 5. Archive
`.e2e/army/coverage/runs/2026-10-12T03-01-23-175Z`. Une finalisation SQL unique,
un reçu, la conservation de l'intention côté client et la reprise explicite
sont implémentés et relus. Les 88 cas natifs passent avec rollback indépendant.
La migration est installée sur la seule pile jetable 33485 ; sa vérification
finale a été réconciliée en lecture après une erreur de syntaxe du helper,
sans seconde application. Les preuves de concurrence et pgTAP du nouveau
schéma restent séparées de ce résultat séquentiel.
Les cinq courses sélectionnées passent ensuite : même clé et même demande,
même clé et demande différente, deux clés avec le même jeton, puis changement
de politique AID dans les deux ordres. Données antérieures, schéma et droits
sont conservés. Le nouveau pgTAP passe ses 13 fichiers et 1 234 assertions,
avec conservation après rollback ; les deux assertions supplémentaires
proviennent des nouvelles fonctions publiques protégées. Voir les
[preuves natives et leurs limites](../testing/estimate-batch-atomic-native.md).

Le build `MdP3QBbnhpGf_EkWetS3p` passe les cinq budgets, avec un éditeur à
499 895 / 500 000 octets gzip. Le run
`.e2e/army/coverage/runs/2026-10-12T03-52-42-188Z` passe les six résultats
(connexion, WFC01, BC01–04), sans skip/flaky/modèle, avec deux vrais exports.
La qualification `2026-10-12T03-52-42-188Z-e5f0a2e1` vérifie 2 640 contrôles.
La campagne précédente à 5/6 reste conservée : elle a exposé le message de
collage partiel effacé et le faux état de totaux non sauvegardés. Le correctif
conserve maintenant l'annonce des 100 lignes et leur état à jour, sans écriture
de réparation pendant la fenêtre observée. Les scénarios vérifient aussi la
reprise exacte après réponse perdue ou illisible, les saisies suivantes
conservées et l'annulation d'une suppression avec ventilation de main-d'œuvre.
Voir [parcours et limites](../testing/estimate-batch-client-e2e.md).
Après qualification, seuls les deux fichiers de tests concernés ont été
allégés des anciennes attentes ; les 122 tests retenus passent. Les 1 540
autres fichiers source contrôlés restent identiques à ceux du build qualifié.
Lint, types, contrôle architectural et vérification du diff passent.
La finalisation transactionnelle des ouvrages reste à réaliser ; cette
qualification n'établit pas l'achèvement de CORE-08 ni de l'application.

**Ouvrages — de la reproduction à la qualification locale :** WFC02 a exécuté ses
deux témoins sur le build `MlizsbOA6KSD_dCPpImFv` :
`.e2e/army/coverage/runs/2026-10-12T04-26-32-534Z`, manifeste
`686cb44f695b8738b4e934ecb224a99ecd4efa8c4fb0f941d3f48e7c08904d18`.
Connexion réussie puis deux échecs métier, sans skip ni modèle, sources stables.
La faute native de finalisation a été atteinte une fois dans chaque témoin.
Avec une section existante, les lignes A/B passent de 2/3 à 2/2 ct et le pied
reste à 7 ct au lieu de 5 ; avec le repli, A/B restent à 2/3 mais le pied reste
aussi à 7 ct et la section créée est orpheline. Dans les deux cas, le candidat
redevient pending alors que le brouillon reste applied. Les premières lectures
précèdent toute réparation. Les six objets QA ont ensuite été retirés avec
catalogue restauré et données des échecs conservées, sur la seule pile 33485.

La correction englobe désormais aussi l'enregistrement de la revue et le rejet
d'un candidat : ces écritures ne doivent pas reprendre après une application
concurrente. Le client conserve l'intention d'ouvrage et ses jetons humains pour
la récupération globale. Une modification locale des composants invalide la
revue et un formulaire périmé doit être rechargé explicitement. Les 27 tests UI
retenus et les 105 régressions existantes du client passent après ces premières
modifications ; ce n'est pas encore une qualification du nouveau workflow.
Les [scénarios de reprise](../testing/generated-ouvrage-commit-recovery.md) et
les cas natifs sont définis avant leurs correctifs respectifs. La revue a étendu
les 70 cas initiaux aux coûts de chaque composant, aux sources inter-brouillons,
à la clôture des demandes abandonnées et à l'archivage après génération. Les
deux premières exécutions SQL restent en échec, avec rollback vérifié : elles
ont exposé des erreurs de syntaxe puis de noms PL/pgSQL. Elles ne qualifient
pas la migration. Le harnais exige désormais un refus métier et la preuve
d'atteinte de chaque faute tardive.

Le build intermédiaire `xX_60Y_-_Qr6pcwB9sRz0` passe OpenAPI et les cinq budgets
(éditeur : 499 973 / 500 000 octets gzip), sources stables. Depuis, les heures
issues d'un rendement utilisent un produit décimal exact : 1,005 × 0,1 donne
0,101 h côté serveur comme en SQL. Les 43 régressions domaine/nombres/provenance
et les 27 tests UI retenus passent ; types et lint passent. La génération porte
aussi le bail exact de la page et sa clôture utilise une RPC dédiée. Migration,
parcours réels et courses restent à vérifier.

La passe native suivante réussit ses **100 cas**, avec rollback contrôlé et
12 empreintes d'artefacts relues par le parent. Elle n'installe encore rien :
[reçu et limites](../testing/generated-ouvrage-atomic-native.md). Le build
`Hrd7MSO17SjtyRO3fmttW` passe ensuite OpenAPI et les cinq budgets, sources
stables, avec le même éditeur à 499 973 octets gzip. Archive :
`.e2e/product-foundation/builds/2026-10-12T05-11-22-094Z`.
La migration est ensuite installée une fois sur la pile jetable 33485, avec
conservation vérifiée. Le pgTAP du nouveau schéma passe ses 13 fichiers et
1 241 assertions ; ses 26 artefacts et snapshots avant/après sont relus.
Le transport `generated-qualified` porte cette nouvelle preuve. Aucun parcours
navigateur ni course supplémentaire n'est déduit de ce résultat.

Les **onze courses réelles** sont ensuite vérifiées avec blocage observé entre
deux connexions et lecture indépendante. Le manifeste initial reste en échec
pour un inventaire incomplet des paramètres des tenants de test ; sa
réconciliation en lecture seule confirme les onze cas et la conservation,
sans les rejouer. Voir le même document de preuves natives.

WFC02 corrigé passe ses **trois résultats** (connexion et deux pannes tardives)
sur le build final, sources stables, sans skip ni modèle :
`.e2e/army/coverage/runs/2026-10-12T05-36-06-223Z`, manifeste
`e129bd5c561899f851ffa0c6f07fd01531782a0dfd7d09270858297660482b84`.
Les premiers GET conservent les allocations 2/3 ct et le pied 5 ct, les
objets de revue et tous les objets de workflow, sans lot de repli orphelin.
Chaque faute est atteinte une fois ; les six objets QA sont retirés avec
conservation vérifiée. À ce stade, la reprise après réponse perdue et la
compatibilité du batch restaient à exécuter ; leurs résultats ultérieurs sont
dans la dernière livraison locale en tête de ce journal.

## Première tranche vérifiée le 11 octobre 2026

| Besoin | Comportement obtenu | Preuve exécutée | Travail restant dans le lot |
| --- | --- | --- | --- |
| CORE-01 — Arrondi commercial | Les nouveaux choix utilisent le palier inférieur. Les anciens modes et pas atypiques sont affichés explicitement et conservés lors d'une autre modification. | Création, saisie réelle, sauvegarde, rechargement, pas 1/10/50/100 €, désactivation, borne exacte 913 €, XLSX, DPGF et impression. Deux parcours métier passés. | PDF téléchargé et non-réécriture d'une offre émise à qualifier séparément. |
| DOS-01 — Confiance dans le brief | Une source absente ou inventée n'est plus remplacée par le document d'une autre affirmation. Association documentaire et passage vérifié sont distingués. | Brief réel local avec fichier associé, édition, retrait de l'ancien lien, rechargement et reconfirmation : un parcours passé. Régressions adverses IA isolées écrites avant code. | Citations/pages, versions documentaires, extraction réelle, atomicité des écritures et concurrence. |
| SITE-01 — Applicabilité avant achat | Aperçu et création relisent les conditions courantes et le fournisseur. Une offre inapplicable bloque la création avec un motif ; le coût négocié du devis est conservé. | Minimum, unité, devise de l'offre, expiration, début futur, offre archivée et fournisseur archivé : refus exacts, aucune commande et devis inchangé. Cas valide : une commande de 2 × 12 € HT, TVA 4,80 €, TTC 28,80 €. Un parcours passé. | Contrôle et insertion atomiques, empreinte de proposition, concurrence, idempotence, quantités décimales et transaction multi-fournisseurs. Le refus d'un devis hors EUR est couvert en isolation, pas par ce parcours navigateur. |

Les quatre parcours métier ont réussi sur le **même build de production local** `5OPtggZhYWtSC_z3MGQXs`, issu de `ce5874f54f8202297b74e4ed238e5c48e49d2f1b` avec les modifications locales archivées. Chaque exécution qualifiante a conservé des sources stables. Node 24.19.0, Chromium desktop, connexion UI ordinaire, application localhost et Supabase natif isolé sur loopback ; traces authentifiées désactivées. Aucun appel de modèle pendant ces recettes.

Ces résultats proviennent de campagnes successives : le succès d'un scénario ne transforme pas une campagne contenant un autre échec en succès.

| Archive locale sous `.e2e/product-foundation/runs/` | Résultat exact |
| --- | --- |
| `2026-10-11T02-46-12-246Z` | Tentative développement interrompue après épuisement du heap du compilateur ; aucun rapport terminal exploitable et sources modifiées pendant l'essai. Aucune qualification métier. |
| `2026-10-11T02-52-53-541Z` | 5 exécutés, 3 passés, 2 échoués. Brief et arrondis historiques passés. Échecs de préparation : pied non sauvegardé par la fixture et garde réseau du parcours achats. |
| `2026-10-11T02-57-32-665Z` | 4 exécutés, 3 passés, 1 échoué. Achats et arrondis historiques passés. Le lecteur de DPGF du test ne reconnaissait pas l'indentation de la désignation ; les valeurs du fichier étaient correctes. |
| `2026-10-11T02-59-19-091Z` | 3 exécutés, 3 passés, aucun ignoré : connexion et les deux parcours arrondis complets après correction des fixtures/du lecteur de test. |

Le détail des scénarios, commandes et limites est conservé dans [arrondis](../testing/commercial-rounding.md), [brief](../testing/brief-evidence.md) et [achats](../testing/purchase-draft-eligibility.md). Les fixtures brief et achat ont été modifiées par leurs parcours réussis ; préparer de nouvelles fixtures pour rejouer leur état initial, sans effacer les preuves existantes.

## Vérifications communes

- Build Webpack de production local, types, OpenAPI, architecture et cinq budgets de taille : succès. Le budget gzip de l'éditeur reste proche de sa limite (495 602 / 500 000 octets) ; aucune limite relevée.
- Lint des fichiers touchés, régressions conservées pertinentes et `git diff --check` : succès. Relectures indépendantes des trois correctifs.
- Vérification des archives : 99 empreintes d'artefacts correspondent, les JSON archivés sont lisibles, aucun des secrets configurés ni JWT détecté dans les artefacts texte vérifiés. Le code applicatif courant correspond encore au build. Reçu : `.e2e/product-foundation/artifact-integrity.json` ; script reproductible : `.e2e/product-foundation/verify-artifacts.cjs`.
- Les preuves ne qualifient pas un déploiement partagé, une nouvelle campagne RLS complète, l'exploitation ou le pilote humain. Les fixtures techniques ne constituent pas le corpus validé par un chiffreur de FND-01.

Aucune migration ajoutée pour cette tranche. Contrat OpenAPI enrichi pour le motif d'offre inapplicable. Changements conservés localement sur `main`, sans commit, push, PR, déploiement ou mutation de service partagé.

## Deuxième tranche vérifiée — référence fournisseur

PRICE-02 applique désormais la décision utilisateur sur les offres à zéro : 10 €, 11 € et 0 € donnent une moyenne proposée de 10,50 €, deux offres retenues et le zéro exclu avec clarification visible. La validation humaine conserve l'anomalie et son instantané ; un lien permet d'examiner l'offre concernée. Une offre dont la date de fin tombe le jour anniversaire des six mois reste applicable ce jour inclus, comme dans les autres contrôles.

La nouvelle migration `20261011030647_reference_price_zero_and_inclusive_validity.sql` et son manifeste ont été ajoutés ; aucune migration précédente réécrite. Régressions exécutées avant code puis corrigées : SQL isolé 96 assertions réussies, panneau 10 tests existants réussis. Les 19 tests conservés des dates, du serveur et de l'API passent aussi. Relecture indépendante, lint, types, historique des migrations, OpenAPI, build et budgets réussis.

Recette native locale et navigateur : archive `.e2e/product-foundation/runs/2026-10-11T03-12-39-371Z/`, **3/3 résultats exécutés réussis**, dont connexion ordinaire et deux parcours métier, aucun ignoré. Build `OiZfxTcX7ZyRQ0fbNISSs`, sources stables. La recette vérifie validation explicite, proposition périmée refusée, responsable exact, coût négocié du devis inchangé à 777 centimes, référence conservée quand seules les offres nulles restent, périodes enregistrées 31/08/2026 → 28/02/2027 et 31/08/2027 → 29/02/2028, updates partiels et refus d'un lot invalide sans insertion partielle. L'import testé est l'API de création en lot, pas un dépôt de CSV/XLSX dans l'interface.

La migration a été appliquée **uniquement à la pile Supabase native locale isolée**, avec contrôle préalable des migrations en attente et vérification après application du corps, des droits et des fonctions inchangées. Le reçu `.e2e/reference-price/native-application.json` fait foi. La relecture `.e2e/reference-price/native-journal-audit.json` retrouve une seule validation, son auteur exact, les trois offres de 0/1 000/1 100 centimes, leur exclusion, la référence de 1 050 centimes et le coût du devis de 777 centimes. Le schéma n'a pas changé pendant la recette. Les fonctions/RLS ne sont pas qualifiées en concurrence multi-connexion par cette lecture.

Voir [recette native et navigateur](../testing/reference-price-e2e.md), [régression SQL](../testing/reference-price-sql.md), [panneau](../testing/reference-price-ui.md) et [cadrage/critères restants](price-reference-next-slice.md). PRICE-02 complet reste ouvert : provenance documentaire et autres canaux d'import sont à qualifier. Aucun changement partagé ni publication.

## Troisième tranche — intégrité de provenance catalogue

Corriger l'intégrité de la provenance catalogue avant de l'exposer davantage. La reproduction sur le schéma natif local a confirmé six écritures invalides acceptées : import ou ligne d'un autre tenant, paire inter-tenant, paire import/ligne incohérente dans le même tenant et changements partiels incohérents. Le rôle SQL était `authenticated`, administrateur de son tenant, sans privilège global ; l'import et la ligne étrangers étaient invisibles à ce rôle. Chaque écriture a modifié l'offre et créé un historique dans sa sous-transaction. Quatre témoins valides restent permis, dont la ligne seule du même tenant.

Les transactions ont été annulées : la lecture indépendante retrouve offre, produit, nombre d'historiques et validations identiques ; aucun tenant, import ou ligne de fixture supplémentaire ne subsiste. Preuves sous `.e2e/catalogue-provenance/`, reproduction `2026-10-11T03-21-53-298872Z-reproduce.json`, vérification `2026-10-11T03-22-31-330169Z-verify.json` et contre-vérification `root-verification.json`. Il s'agit d'une reproduction SQL avec rôle/identité simulés dans une base locale réelle, sans preuve d'exploitation HTTP ou distante ni accès au contenu étranger.

Le [suivi catalogue](catalogue-integrity-followups.md) conserve les scénarios avant correction. La migration `20261011080708_supplier_price_provenance_integrity.sql` protège désormais les liens offre/import/ligne/tenant avec quatre FK validées, trois clés uniques et un contrôle de visibilité sous droits de l'appelant. Les mouvements de parents sont aussi contrôlés ; les liens partiels et effacements restent permis. Relecture indépendante et application uniquement à la base native locale. Les données des huit tables vérifiées, droits, RLS et fonctions métier antérieures sont conservés.

La reproduction HTTP confirme les six défauts avant correction. Après correction, **40/40 cas SQL** passent et **5/5 résultats TesterArmy** passent : connexion, deux parcours de provenance et deux imports CSV DPGF, avec valeurs et provenance exactes. Archives `2026-10-11T08-12-10-615698Z-regression-green.json` sous `.e2e/catalogue-provenance/` et `.e2e/product-foundation/runs/2026-10-11T08-12-11-132Z/`. Build applicatif identique `OiZfxTcX7ZyRQ0fbNISSs`, sources stables, zéro appel de modèle. Le prix humain de référence à 777 centimes reste inchangé. Typecheck, lint ciblé, manifeste des migrations, OpenAPI et contrôle des espaces réussis. Voir [SQL](../testing/catalogue-provenance-sql.md) et [HTTP](../testing/catalogue-provenance-e2e.md) pour les limites et la concurrence.

**Trois conflits natifs concurrentiels passent aussi**, avec attente réellement observée par une troisième connexion. Après commit de la première opération, la seconde écriture devenue incohérente est refusée ; après rollback, l'opération en attente réussit avec une seule entrée d'historique. Archive `.e2e/catalogue-provenance/concurrency-2026-10-11T08-16-33-665322Z/`. La synthèse `qualification.json` et ses contrôles SHA256 réunissent ces preuves. Deux erreurs de préparation du harness sont conservées comme échecs, séparément. La matrice complète de rôles, les autres formats et l'activation partagée restent hors de cette recette.

## Incident local de preuve constaté à la reprise

L'index `.git/index` et une ancienne configuration temporaire de recette sont remplis de zéros. Les 2 010 fichiers suivis ou non ignorés inspectés ne révèlent aucun fichier produit dans cet état. L'index initial est copié comme preuve et conservé ; un index séparé construit depuis HEAD permet les comparaisons sans modifier le staging du dépôt. Reçu : `.e2e/git-index-recovery/receipt.json`. La dernière capture avant corruption ne contenait aucun fichier staged ; l'état courant de staging reste irrécupérable à partir de cet index.

La vérification de toutes les archives retrouve aussi un manifeste nul pour l'essai `2026-10-11T03-32-46-410Z`. Cet essai est **inexploitable**, conservé et exclu des preuves métier. Le vérificateur global continue de sortir en échec pour le signaler. Les huit autres archives sont lisibles et leurs 294 empreintes contrôlées correspondent, dont les 66 artefacts du GREEN courant ; aucun secret configuré ou JWT détecté dans les textes vérifiés. Le code applicatif correspond toujours au build local. Reçu actualisé : `.e2e/product-foundation/artifact-integrity.json`.

## Quatrième tranche — préparation d'achats, recette locale réussie

[SITE-01A — préparation d'achats atomique et sans doublon](purchase-preparation-next-slice.md) dispose d'une recette locale réussie. Le [contrat](purchase-preparation-contract.md) impose une revue exacte, une intention idempotente, une transaction multi-fournisseurs et des rattachements durables. Les quantités décimales nécessitent ensuite une évolution cohérente des achats, pas seulement la levée d'un contrôle de formulaire.

La campagne `.e2e/product-foundation/runs/2026-10-11T08-30-28-332Z/` a exécuté la connexion et trois reproductions : ancienne quantité, ancien coût et lignes déjà envoyées. La connexion passe ; les trois assertions métier échouent comme attendu sur l'ancienne implémentation, qui accepte chaque POST avec 201. Les preuves conservent les valeurs créées, les sources inchangées par l'achat et la suppression vérifiée des seuls doublons ARMY produits par la reproduction. Cette campagne RED ne constitue pas une recette réussie.

Avant remplacement du serveur, dix incohérences entre lectures internes et le contrat de route ont été reproduits par les tests retenus : 14 passes, 11 échecs attendus. Après remplacement par les RPC, les 25 tests passent. Les 65 tests conservés du panneau et des schémas passent également. Lint ciblé, types et synchronisation OpenAPI réussissent. Les rapports `.e2e/purchase-preparation/atomic-review-green-vitest.json` et `retained-ui-schema-green.json` ne remplacent pas les essais natifs et navigateur encore en cours.

La revue indépendante a identifié des limites supplémentaires du candidat : référence catalogue explicitement nulle, déplacement de sources déjà transférées, suppression d'une version par FK et conservation du détail historique. Elles sont éprouvées et corrigées. Un contournement des empreintes par UUID majuscules a aussi été reproduit puis corrigé ; les UUID sont normalisés en base. Aucun résultat de candidat intermédiaire n'est promu en preuve de la migration finale.

La migration `20261011083209_transactional_estimate_purchase_preparation.sql` est installée uniquement sur la pile native isolée. Les **39/39 cas SQL** passent sur le schéma installé, puis une connexion distincte confirme l'annulation des fixtures. Quinze tables métier, droits, RLS et triggers antérieurs restent inchangés ; 21 rattachements historiques sont repris exactement. Le reçu privé conserve les valeurs et conditions relues ; aucun ancien reçu de validation n'a été inventé.

La campagne `.e2e/product-foundation/runs/2026-10-11T08-57-05-526Z/` réussit **12/12 résultats** (connexion et onze parcours métier), sans ignoré ni flaky, sur le build local `2RwpHJFSrkdTzzAC_F6v8`, sources stables. Elle vérifie les montants 47,31 € HT, 9,46 € TVA, 56,77 € TTC pour deux fournisseurs, les refus après modification, les quatre statuts historiques, les deux intentions concurrentes HTTP, la casse des UUID et la reprise après perte de réponse, reçu JSON illisible puis rechargement sans deuxième POST. Aucun envoi fournisseur. L'essai précédent `2026-10-11T08-54-16-513Z` reste **11/12**, son dernier test ayant échoué avant création sur un sélecteur exact de titre qui omettait la référence dans le nom accessible ; correction du test seulement et campagne neuve.

Qualification dédiée : `.e2e/purchase-preparation/qualifications/2026-10-11T08-57-05-526Z-4e40cc6e/qualification.json` (SHA256 `643ef8ca15e4d0ad42332cf9744281d336851541f759f8aa111d8bcb6e028c7a`). Elle vérifie archives, build, migration et résultat SQL explicitement sélectionné, sans secret configuré ni JWT détecté. Le vérificateur global garde son échec uniquement pour l'ancien manifeste nul ; les nouvelles archives passent leurs contrôles d'intégrité. La concurrence avec attente de verrou effectivement observée est qualifiée séparément, pas déduite des appels HTTP simultanés.

Les **trois courses natives** passent également : même intention retrouvée après attente, autre intention refusée sans doublon, offre modifiée entre revue et création refusée après commit sans écriture partielle. Une troisième connexion a constaté dans chaque cas le PID bloquant exact via `pg_blocking_pids`. Archive `.e2e/purchase-preparation/native-races-2026-10-11T08-58-50-718168Z/`, SHA du manifeste `d7e02fd6211aa9a3f3435a422cb43494d4fcd07d552cd303e23ceeb1d088413e`. Les 60 empreintes concordent ; 61 textes inspectés sans secret configuré ni JWT. Cette preuve à trois connexions ne qualifie pas toutes les intercalations ou la charge de plusieurs équipes.

Build, cinq budgets, types, lint, OpenAPI et manifeste de migrations passent. Voir [recette](../testing/purchase-preparation.md), [SQL](../testing/purchase-preparation-sql.md) et [interface](../testing/purchase-preparation-ui.md). Achats partiels, libération explicite après annulation, quantités décimales, tous rôles et mise en service partagée restent ouverts. Aucun commit, push, déploiement ou changement partagé.

Les autres lots et critères de sortie de l'application restent ouverts ; aucune fermeture automatique du backlog ni du goal à partir de ces tranches. Aucun commit, push, déploiement ou changement de base partagée n'a été effectué.

## Cadrage retenu avant la cinquième tranche

[SITE-01B — quantités décimales et unités d'achat](purchase-decimal-quantities-next-slice.md) : commencer par reproduire et fermer la perte de référence/provenance lors d'une simple édition de commande, puis aligner stockage, écritures atomiques, calculs, formulaires et exports sur les trois décimales du devis. L'unité historique doit provenir d'une preuve fiable ou rester explicitement à confirmer. Aucune conversion de conditionnement implicite. Ce cadrage précède les scénarios et le code ; il ne constitue pas une tranche livrée.

## Cinquième tranche — quantités, unités et corrections d'achat, recette locale réussie

Le [contrat SITE-01B](purchase-decimals-contract.md) est implémenté localement : quantités à trois décimales, calculs exacts en centimes, unités explicites, identités de lignes conservées, historique privé des corrections et refus d'une sauvegarde sur une ancienne révision. Les exports CSV/XLSX relisent ensemble l'en-tête et toutes les lignes ; une vue relationnelle tronquée refuse l'édition, l'impression ou le ZIP au lieu de produire un document incomplet.

La migration `20261011091744_purchase_decimal_quantities_and_stable_edits.sql` est installée uniquement sur la pile native isolée. Son SHA256 est `ef743a2dba4937ddb5afd3b4886dfd5920251cfb245280d220cfa3ab4eb1171d`. Après installation, **52/52 cas SQL** et les **39/39 régressions de préparation** passent ; une connexion indépendante confirme le rollback des fixtures. Les vingt unités historiquement prouvées sont reprises ; les quarante-six autres restent inconnues. Aucun ancien historique de correction n'est inventé. Voir [preuves SQL](../testing/purchase-decimals-sql.md).

Les **quatre courses natives** de `.e2e/purchase-decimals/native-races-2026-10-11T09-52-08-384180Z/` passent : UPDATE, INSERT et DELETE attendent un changement de statut puis sont refusés ; deux éditeurs en concurrence ne s'écrasent pas. Une troisième connexion a observé le PID bloquant. La qualification indépendante contrôle 74 empreintes et 76 fichiers texte sans secret configuré ni JWT détecté ; le mot « Three » resté dans la prose du manifeste est signalé, sans réécrire l'archive dont les quatre cas nommés passent.

La première recette après correction, `.e2e/product-foundation/runs/2026-10-11T09-55-14-575Z/`, reste **3/10**, sources stables sur le build `WYlX0LYCgmE8VfIC3XwJS`. Connexion, conservation des sources/historique/conflit et refus des créations invalides passent. Les autres scénarios ont exposé deux boutons actifs malgré une validation bloquante et des erreurs de chemin de téléchargement ou de sélecteur dans les tests. Les contrôles de sauvegarde étaient déjà présents : cet essai n'établit pas qu'une quantité invalide a été écrite. Corrections et nouvelle campagne requises avant qualification navigateur du lot.

Après correction des boutons et des sélecteurs, la campagne complète `.e2e/product-foundation/runs/2026-10-11T10-12-06-762Z/` passe **10/10**, sans filtre, ignoré ni flaky. Build `iQC_IGfiEMhX3ElSsUCpf`, sources stables, connexion ordinaire et backend natif loopback. Les sept téléchargements réels vérifient CSV, cellules numériques XLSX et HTML du ZIP, notamment **1 200 lignes** sans troncature et des montants cohérents après modification concurrente. L'aperçu imprimable, les unités historiques confirmées, les conflits d'édition et la reprise d'une préparation après perte de réponse sont vérifiés. Aucun appel de modèle pendant cette campagne.

Les essais intermédiaires restent distincts : `2026-10-11T10-06-07-380Z` **5/10** ; `2026-10-11T10-10-04-373Z` **5/6 sélectionnés**, quatre exclus ; `2026-10-11T10-11-47-250Z` **2/2 sélectionnés**, huit exclus. Ils ont servi à corriger les sélecteurs à partir des écrans observés. Seule la campagne complète ci-dessus qualifie ensemble les dix résultats.

Qualification dédiée : `.e2e/purchase-decimals/qualifications/2026-10-11T10-12-06-762Z-62049f9b/qualification.json`, SHA256 `71f27dfee33ff2d9d69025c9bc876a0d28eb5ee721b79206b0344abcb3b61988`. Elle vérifie les 93 artefacts de la campagne, les sept téléchargements, le build, les 52 cas installés explicitement sélectionnés et les quatre courses natives. Le premier essai du lecteur, qui attendait à tort un exit code nul du harness SQL à rollback volontaire P9001, est conservé en échec. Le contrat corrigé exige le rollback et chaque résultat attendu ; il n'accepte pas un échec SQL quelconque. Aucun secret configuré ni JWT détecté dans les 97 textes et 68 entrées ZIP/XLSX inspectés.

La préparation SITE-01A est également requalifiée sur ce même build et le nouveau schéma : `.e2e/product-foundation/runs/2026-10-11T10-12-52-941Z/`, **12/12**, sources stables, sans ignoré ni flaky. Conditions fournisseur, refus après modification, statuts historiques, deux intentions concurrentes et récupération restent conformes. Reçu E2E : `.e2e/purchase-preparation/qualifications/2026-10-11T10-12-52-941Z-e42f84e9/qualification.json`, SHA256 `c26ae159fc047588cad50fd8f1ed1cfc830a9e5ff4197ce5c9b61da59b439dc9`. Les 39 cas natifs après installation sont conservés séparément dans `.e2e/purchase-decimals/2026-10-11T09-49-10-856542Z-regression-green.json`.

Build, cinq budgets, lint ciblé, types et OpenAPI passent. Le vérificateur global confirme les 93 et 59 empreintes des deux campagnes finales et l'identité des sources avec le build ; son unique erreur reste l'ancien manifeste nul `2026-10-11T03-32-46-410Z`, conservé et exclu. Il sort donc toujours en échec global, tandis que les deux qualifications dédiées passent.

Un écart distinct de présentation reste ouvert : la couverture fournisseur est annoncée comme quantité de lignes commandables même lorsqu'une ligne est déjà transférée. Le cas observé **4 couvertes / 3 préparables / 1 transférée** et ses critères sont conservés dans [la note de couverture des achats](purchase-quantities-remainders-next-notes.md). Il ne permet pas de contourner le contrôle transactionnel contre les doublons.

Limites conservées : une commande de 1 001 lignes est exportable en entier par la projection JSON, mais ses vues relationnelles refusent explicitement une lecture tronquée ; la préparation manuelle par POST n'a pas encore de clé d'idempotence ; l'aperçu imprimable n'est pas un PDF généré et téléchargé ; la présence du HTML dans le ZIP ne prouve pas l'exhaustivité de toutes les pièces jointes. Achats partiels, réceptions quantitatives, corpus validé par un chiffreur et mise en service partagée restent ouverts. Aucun commit, push, envoi fournisseur, déploiement ou changement partagé.

## Sixième tranche — compteurs de préparation des achats

La carte et le panneau utilisent désormais la préparation canonique, avec les
mêmes comptes de lignes préparables, déjà transférées et à corriger. Un reçu
confirmé déclenche une relecture ; une lecture en cours, échouée ou incohérente
masque les anciennes propositions. La reprise conserve son reçu et ne lance
aucune nouvelle création automatiquement. Le [contrat préalable](purchase-readiness-contract.md)
conserve les défaillances définies avant code.

La campagne `.e2e/product-foundation/runs/2026-10-11T10-37-09-137Z/` passe
**4/4**, sans filtre, ignoré ni flaky, sur le build `0G0T7qNlzYNMAcMgOI_EW`.
Les sources sont stables. Carte et panneau concordent pour **3/1/0**, puis
**2/1/1** après passage réel sous le minimum fournisseur, puis **0/4/0** après
création et rechargement. Une seule création est observée ; les montants
**1 636/327/1 963 centimes HT/TVA/TTC** et les provenances restent exacts.
Deux interceptions navigateur, 503 et 200 incohérent, utilisent une autre
fixture encore préparables à 3/1/0 ; elles empêchent toute création puis
récupèrent les vrais comptes sans mutation. Elles ne prouvent pas une panne
interne au rendu serveur.

Qualification : `.e2e/purchase-readiness/qualifications/2026-10-11T10-37-09-137Z-aa306871/qualification.json`,
SHA256 `71a9c0d4bdd36cbb5cde7139123eec0a9f1720f7d240431cef070549ce730c6a`.
Les 64 artefacts et 14 preuves métier ont été contrôlés ; les 72 textes et
40 JSON inspectés ne contiennent aucun secret configuré ni JWT. La migration
décimale locale reste inchangée ; aucun nouveau résultat SQL n'est revendiqué.
Les 37 tests UI retenus, lint ciblé, types, build, OpenAPI et cinq budgets
passent. La revue indépendante des réponses tardives, changements de version
et callbacks n'a trouvé aucun défaut concret ; elle reste une revue statique.

La requalification des douze parcours SITE-01A a d'abord rencontré une
assertion de présentation obsolète. Le run `2026-10-11T10-37-49-236Z` conserve **11/12** : l'ancien test de
reprise attendait un bouton Créer désactivé après résultat inconnu, alors que
le nouveau contrat le masque. Le snapshot montre la reprise disponible. Cette
seule assertion E2E est adaptée ; les assertions monétaires et d'absence de
second POST restent exigées. Le run `2026-10-11T10-40-07-979Z` a ensuite été
interrompu sans rapport terminal et demeure non qualifié. Son manifeste n'est
pas réécrit ; le reçu d'interruption séparé conserve les observations.

La pile native locale a repris sans reset ni migration, avec identité API et
clés inchangées (`.e2e/local-article/resume-2026-10-11T19-57-49-020887Z/receipt.json`).
Windows réserve désormais les ports 59753–59852, dont le port API 59827 ;
WSL répond normalement sur ce même endpoint. La reprise de recette utilise
WSL sans modification réseau permanente. Les essais de
seed arrêtés avant leur première lecture d'identité et le relais refusé avec
EACCES ne sont pas des échecs métier. Aucune qualification complète ne leur
est attribuée.

La campagne finale `.e2e/product-foundation/runs/2026-10-11T20-10-32-141Z/`
passe **12/12**, sans filtre, ignoré ni flaky, avec sources stables et zéro
appel de modèle. Le même build Windows `0G0T7qNlzYNMAcMgOI_EW` est servi sous
Linux, Node 24.19.0, après un smoke de connexion ordinaire **2/2**. Cette
qualification ne vaut ni reconstruction Linux ni mesure de performance.
Quantités/coûts modifiés après aperçu, statuts historiques, concurrence entre
intentions et reprise après perte de réponse restent conformes ; la reprise
n'émet qu'un seul POST de création, y compris après reçu illisible et reload.

Reçu : `.e2e/purchase-preparation/qualifications/2026-10-11T20-10-32-141Z-da68a6f3/qualification.json`,
SHA256 `f8f4b8a57b94bc85e5ab81fe44e132c063f8d8c5f9274f6df1051b4d1eb7de78`.
Les 62 artefacts de la campagne et son smoke explicitement sélectionné sont
vérifiés ; aucun secret configuré ni JWT dans les 75 textes inspectés. Aucun
nouveau résultat SQL n'est revendiqué. La lecture native après reprise
confirme séparément les trois signatures comparables de création/remplacement
et les policies achats ; les deux autres helpers inspectés n'ont pas de témoin
dans le reçu choisi et ne sont pas déclarés inchangés par cette comparaison.

Les qualifications dédiées passent. Le vérificateur global conserve en échec
l'ancien manifeste nul et l'essai interrompu sans rapport/inventaire, sans
les transformer en preuves valides. Les programmes de recette sont arrêtés,
les configurations temporaires retirées après contrôle de contenu. Aucune
publication ni modification de la base partagée.

## Septième tranche — reprise des ouvrages qualifiée localement

Le chiffreur retrouve les brouillons reprenables de sa version, reprend une
revue interrompue et applique seulement les candidats restants. Pagination,
erreurs récupérables et réponses tardives sont traitées sans régénération IA.
Les vérifications contrôlent auteur, tenant, version, rôle et session réelle
du verrou. Le nom et l'unité acceptés sont conservés dans les lignes et la DPGF.

La recette a reproduit puis corrigé trois défauts de données : unité perdue,
nom proposé affiché à la place du nom accepté, et main-d'œuvre omise du coût
de bibliothèque. Un contrôle de tout le lot précède désormais l'insertion :
il conserve séparément coûts FO/MO et heures, ou refuse explicitement une
composition non représentable par les coefficients actuels, sans création.

Elle a également révélé une sauvegarde immédiate déclarée réussie avec des
totaux périmés et un export Excel perdant la remise. Les sauvegardes V2 avec
totaux proposés utilisent maintenant le calcul canonique sur les lignes
persistées et leurs modifications, triées par position puis ID ; le client
conserve les totaux réellement retournés. L'export V2 vivant recalcule la
remise depuis son assiette brute et le même contexte. Les chemins historiques
V1 et les snapshots conservés ne sont pas réécrits par cette correction.

**Preuve principale : 10/10 sans filtre, ignoré ni flaky**, campagne
`2026-10-11T22-00-41-793Z`, build `7EFvayztCREQ0rva9cT0d`, sources stables.
La sauvegarde automatique est réellement attendue ; les autres cas déclenchent
l'enregistrement immédiat. Une inspection authentifiée ordinaire vérifie
les relations, valeurs, snapshots, composants et ouvrages canoniques.
Les six compositions de GR09 et les quatre défauts de session prévus sont
exécutés. Le fichier DPGF est réellement téléchargé et analysé.

Reçu : `.e2e/source-coverage/qualifications/2026-10-11T22-00-41-793Z-b6b48235/qualification.json`,
SHA256 `4bf9c9ffaeda99c50097c8e3f964136280c694eb0550e7eb09bf94f7b1df1fc1`.
Les contrôles du reçu et les scans des 126 textes/89 JSON passent ; aucune
valeur de secret ou session n'y est conservée. Les archives d'échec et les
sondes partielles restent distinctes dans le [journal de recette](../testing/generated-ouvrage-resume.md).

**Témoin financier indépendant : 2/2**, campagne `2026-10-11T21-58-32-074Z`,
même build. Deux lignes de 3c, une remise de 1c et deux taux de TVA donnent
5/0/5c après saisie/sauvegarde UI, API et Excel. Une inversion des positions
par HTTP authentifié ordinaire donne 5/1/6c, confirmé après rechargement et
dans un second Excel. Les montants du pied ne sont pas assertés visuellement.
Reçu : `.e2e/source-coverage/qualifications/totals-order-2026-10-11T21-58-32-074Z-a1fcbfa5/qualification.json`,
SHA256 `ed042f7aec971fb6c44ed7dcf1de3e9102c56f17c85bdd3ff71a1f4bdc714551`.

Les suites existantes ciblées passent : 94 régressions serveur/synchronisation/
totaux, 40 client/file de mutations, sept export. Les corrections d'ouvrage
avaient passé séparément 41 régressions domaine/provenance/dialogue/contrôleur.
Lint ciblé, types, OpenAPI et les cinq budgets du build passent ; l'éditeur
atteint 496498/500000 octets. Le build Windows est servi sous Linux/Node24.19.0 :
cette preuve locale ne vaut ni reconstruction Linux ni performance déployée.

**Accès : 2/2**, campagne séparée `2026-10-11T22-10-45-175Z`, même build,
sources stables. L'UI établit les actions de lecture réelles, puis des appels
authentifiés archivent une nouvelle affaire et rétrogradent son nouvel auteur
en viewer. Liste et reprise renvoient respectivement CONFLICT puis FORBIDDEN ;
un second admin ordinaire confirme que les données métier sont inchangées.
Reçu : `.e2e/source-coverage/qualifications/access-2026-10-11T22-10-45-175Z-f12bc426/qualification.json`,
SHA256 `03f0d228b3827c7d229647be9ef2fd66fdef9ebd96917b2f70df08ef3d02ee65`.

**Restent ouverts :** version non brouillon, expiration naturelle du verrou
et réponse bulk `totals:null` non éprouvées ici. La fermeture forcée avant sauvegarde
reste à traiter. L'insertion complète d'un ouvrage n'est pas encore atomique.
CORE-07 demeure P0 pour prendre en charge les compositions légitimes aujourd'hui
refusées et qualifier leur réutilisation en bibliothèque. La réponse tardive
est éprouvée après fermeture du dialogue, avant navigation vers l'autre version.
Aucun de ces résultats ne clôt le goal complet ni ne constitue une publication.

## Préparation de la référence CCTP conservée

Le candidat SQL passe 44/44 assertions séquentielles dans une transaction
annulée, puis sept compteurs indépendants reviennent à zéro. Ce résultat
porte sur les droits et métadonnées, sans PDF physique ni concurrence réelle.
La restauration fidèle de deux clones avait échoué sur les
droits `supabase_admin` ; les clones vides ont été supprimés après vérification
nommée, sans contournement des ACL.

Après autorisation humaine explicite, la migration
`20261011221312_estimate_source_reference_review.sql` est installée dans la
seule pile locale API59827/DB32959. Son SHA256 est
`e6d520265b8debff8617702b4644b0a5b0fa20c0c2fe4ae525e7434e5c76949f`.
DDL et historique partagent un commit ; la relecture indépendante vérifie
les fonctions, ACL et conservation des 111 tables métier/Auth/Storage
préexistantes. Reçu `native-installations/apply-89bf4cae77a647a9/application.json`
sous `.e2e/source-coverage/reference-native/`, SHA256
`e6a4a9af27febc7a709508e123b00968e285910eeac29e79c950703ebe4fc582`.
Aucune application distante. Le bucket privé est ensuite créé via API, sans
upsert ; sa configuration 50MiB/PDF est relue. Le premier GET avait renvoyé
HTTP400 avec le code explicite NoSuchBucket et statusCode404 : le détecteur
d'absence est adapté à cette forme exacte, après reproduction, sans accepter
un 400 générique ni réécrire l'archive échouée. Reçu
`native-buckets/504c254e1bee4bd0/bucket-receipt.json`.

**Concurrence native : 8/8 PASS**, avec connexions A/B/observateur et preuve
pour chaque cas du PID bloquant attendu avant libération. Même clé/même copie
rejoue le reçu ; autre contenu ou révision périmée refuse une nouvelle décision.
Révocation, archivage et perte de métadonnée sont éprouvés avant/après commit.
Les droits et fonctions restent identiques. Manifest
`races/run-a152d08d412546d8/manifest.json` sous le dossier natif, SHA256
`3d59121aef1a674ffe43041a9c94dc7cde98b93d79ffd3f7851c7b7aafc5bb85`.
Les huit nouveaux acteurs et leurs données sont conservés, sans purge.
Cette preuve utilise des métadonnées Storage synthétiques : aucun octet PDF,
login HTTP, charge ou parcours utilisateur n'est qualifié par ces huit courses.

Le candidat de vérification PDF terminable passe 17 tests spécialisés avec
vrais Workers, dont boucle CPU interrompue, crash, protocole invalide et
transfert aller-retour des octets. Ces tests avaient été écrits avant le code.
Archive : `.e2e/source-coverage/pdf-staged/runs/worker-20261011T220658Z/manifest.json`,
SHA256 `161283f2c7e741497b383c76719a0b262b335404c2dec753b40e6f268e806838`.
Le module et les mêmes tests sont ensuite intégrés aux sources : 17/17,
lint et types passent. Archive `pdf-staged/runs/integrated-20261011T2215Z/manifest.json`
sous `.e2e/source-coverage/`, SHA256
`0a32f016e46b4300a67e80e4af1966b78faef2bfebd7fa20751c43ace9fe77b0`.
Aucune route HTTP, copie Storage, consultation PDF, limite de charge ou
packaging d'une route Next n'est encore qualifié. Voir le
[contrat du worker](../testing/source-reference-pdf.md).

Le transport Storage borné est intégré séparément : 10/10 tests spécialisés
préécrits passent avec un vrai serveur HTTP loopback. Ils observent la fermeture
des flux au dépassement de 50MiB ou de 64KiB pour les erreurs, l'abandon après
en-têtes, l'absence de requête vers une redirection et le POST sans upsert.
Lint et typecheck passent. Reçu `.e2e/source-coverage/storage-staged/validation.json`,
SHA256 `e7e384ccdc94cec93f7e41dbd2f757555eaa0bceea32c134057217d36f9147bb`.
Auth et GET métier sont simulés à cette frontière : ce résultat ne qualifie
pas RLS ni un transfert vers le Storage Supabase réel.

La route GET de revue est implémentée avec la session ordinaire, des paramètres
et réponses stricts, l'historique paginé et des erreurs sans détail SQL.
Le build `eBcR7wxDJlQno6EfBdO-r` passe avec sources stables, OpenAPI et les cinq
budgets dans `.e2e/product-foundation/builds/2026-10-11T22-35-35-972Z`.
La recette HTTP de lecture passe **2/2** (connexion et parcours, sans filtre,
skip, flaky ou modèle), run `2026-10-11T22-42-33-286Z` : 37 réponses exactes,
état initial, bornes/doublons, UUID absents, anonymat et no-store. Les lectures
API et SQL indépendantes constatent une version inchangée, dates/empreinte
complète incluses, avec zéro revue/copie/événement/objet de référence.
Qualification `.e2e/source-coverage/qualifications/read-2026-10-11T22-42-33-286Z-fd5bfff0/qualification.json`,
SHA256 `eaafa35f4c33d656074014002564e33a559ca46e8f6427c67e3c60d4dec447bb` ;
163 contrôles passent, 105 textes inspectés sans secret/token. Le premier
essai et ses erreurs de préparation sont conservés dans le
[détail de recette](../testing/source-reference-read.md). Ni écritures, octets
de copie, historique peuplé, matrice complète des rôles ou interface ne sont
qualifiés par ce GET initial.

Les suites OpenAPI passent 13/13 après retrait
du seul compteur statique obsolète 78 : les exclusions exactes et assertions
sémantiques sont conservées, et `validate-openapi` compare déjà chaque opération
aux routes réellement présentes. Aucun test d'isolation nouveau n'a été ajouté.

La [rétrospective d'environnement](retrospective-chiffrage-2026-10-12.md),
demandée avec le skill `retro`, présente les améliorations prioritaires et
leurs preuves. Elle ne change ni les instructions, ni la CI, ni les mémoires.

## Référence CCTP : parcours applicatif local qualifié

La page « Référence CCTP » est accessible depuis le détail d'un devis. Elle
permet de préparer une copie privée, consulter son PDF vérifié, confirmer
explicitement la référence avec un motif, puis retrouver les copies et
décisions antérieures. La préparation d'un autre document laisse la référence
actuelle en place jusqu'à sa confirmation. Une intention persistée dans
l'onglet peut être reprise explicitement après une réponse perdue.

La première campagne `2026-10-11T22-59-38-860Z` reste un échec **1/2** :
réservation A créée, aucun objet ni événement. Le fichier Next compilé
réécrivait la résolution du parseur PDF en `undefined.resolve`. Le premier
correctif compilait encore une variable `createRequire` non définie ; le
build `JUNxvUpzisSjzDrjNXaGw` a été rejeté avant toute nouvelle recette.
La correction finale utilise le chemin du parseur explicitement inclus dans
les trois traces de route. Le diagnostic Webpack minimal passait également
avant correction et ne reproduisait donc pas le défaut Next.

Le build final **`A2hNxdwHe1cZhuprKaBYp`** passe, avec sources stables,
OpenAPI et les cinq budgets, dans
`.e2e/product-foundation/builds/2026-10-11T23-14-00-208Z`.
Lint, types et les 17 tests PDF existants passent. Le chargement est ensuite
éprouvé dans l'application compilée : **2/2**, campagne
`2026-10-11T23-17-20-522Z`, sans filtre, skip, flaky ou modèle.

La recette reprend la réservation A du premier échec avec la même clé et
la même copie ; le harness restaure son contexte d'onglet depuis la demande
canonique relue en base. Cela ne prouve pas une récupération automatique
entre appareils. La préparation A répond 200/replayed ; B est réellement
créée en 201. Après une confirmation A effectivement enregistrée puis une
réponse ignorée côté client, le reload n'envoie aucun POST et la reprise
explicite retrouve la même décision. B reste active après rejeu de l'ancienne
confirmation A. Les trois consultations réelles sont comparées aux octets,
tailles et SHA-256 des PDF A/B de trois pages.

La relecture native constate une revue révision2, deux copies vérifiées,
deux événements et deux objets privés. Les champs du devis sont conservés
sur ce témoin **sans ligne et à totaux 0/0/0** ; cela ne qualifie pas encore
l'oracle calorifuge à 71 000/14 200/85 200 centimes. Le SDK a refusé la première
capture avec `POLICY_DENIED` ; aucune autre capture n'a été tentée, aucun
contournement et aucune revue des pixels ne sont revendiqués.

La [recette détaillée](../testing/source-reference-vertical.md) conserve le
reçu vérifié, les empreintes, les échecs précédents et les limites :
`.e2e/source-coverage/qualifications/vertical-2026-10-11T23-17-20-522Z-7e810705/qualification.json`,
SHA256 `315a724f3ce68129705f09e36f10238549aa103c854c6bc0506d096e2b7ba89a`.
Ses 177 contrôles passent ; 108 fichiers texte sont inspectés sans secret
ou token conservé. La matrice
complète des droits HTTP, les bornes PDF extrêmes, la modification de
l'original et les autres points de faute restent à qualifier. Aucun
déploiement, publication Git ou nouvelle migration distante n'a été réalisé.

## Prochaine priorité métier

Réaliser [DOS-CAL-01 — revue humaine de couverture CCTP → chiffrage](next-priority-source-coverage-review.md). Son [contrat préalable](source-coverage-contract.md) distingue référence de contenu conservée, exigences, relations multiples, décisions immuables et validité après changement. L'[oracle avant code](../testing/source-coverage-oracle.md) fixe huit exigences, six traitements et deux zones, avec 71 000/14 200/85 200 centimes et huit heures sans effet financier de la couverture. Le [plan d'accès](../testing/source-coverage-access-plan.md) définit les frontières RPC/Storage et les courses à qualifier. Ces documents ne constituent pas une implémentation ni une validation par un chiffreur.

La reprise d'un brouillon d'ouvrage et le parcours de référence CCTP conservée
disposent de qualifications locales distinctes. Réaliser maintenant une seule
chaîne utilisable : exigence et citation de la copie exacte, liens vers les
prestations effectivement chiffrées, décision motivée, rechargement et
invalidation ciblée après changement. Réutiliser le lecteur CCTP et le registre
existants ; une panne de lecture ne doit jamais prouver l'absence d'une cible.
Le calorifuge
est le premier cas de qualification ; le goal conserve toutes les familles
CVC/plomberie et le parcours chantier complet. Les achats partiels restent
requis, avec une priorité revue après sécurisation du socle achats.

## DOS-CAL-01 — chaîne de couverture en cours de qualification, 12 octobre

L'interface, les contrats stricts et les sept opérations HTTP sont implémentés
localement : exigences, zones/réseaux, citations de la copie conservée, liens
vers lignes/composants appliqués/registre, aperçu et décision motivée. Le
formulaire remet la complétude à confirmer après changement de prescription,
source, périmètre ou liens. Remplacer une citation A par B crée une nouvelle
identité et demande de revoir le passage. Les blocages de l'aperçu dépendent
du traitement choisi : une couverture partielle peut notamment être exclue
ou déclarée provisoire avec les justificatifs requis.

Le parcours conserve l'intention avant POST et permet sa reprise explicite.
Une lecture échouée invalide l'aperçu et son acquittement humain ; les anciennes
données restent identifiées comme dernière lecture. Le serveur réutilise la
vérification physique du PDF, compare les reçus canoniques et recontrôle les
droits avant l'appel privilégié. Ces propriétés sont codées et relues ; leur
qualification complète dans l'interface reste à exécuter.

La migration candidate `20261011233527_estimate_source_coverage.sql` prépare
les historiques immuables, les verrous et l'invalidation technique ciblée.
La fixture native de 34 cas a été écrite avant cette migration. Son exécution
prévue est intégralement annulée puis contrôlée depuis une connexion
indépendante ; elle ne prouvera ni les octets Storage ni les courses réelles.
La nouvelle migration n'est pas encore appliquée durablement.

Les vérifications locales TypeScript, lint ciblé et synchronisation OpenAPI
passent. Le runner versionné possède maintenant des modes couverture et
découverte, un profil local explicite et une archive des preuves. Cinq
contrôles CLI passent (profil absent, origine non locale, chemin extérieur,
empreinte de build incorrecte, découverte de 12 entrées sans identifiants),
avec reçu dans
`.e2e/source-coverage/infrastructure-checks/2026-10-11T23-46-00-281Z-b0981b92/receipt.json`
(SHA256 `f2b604540a7cc3d5cc1f188e8b7c19bc6703a8ca13c8ca9e30807a3cf31c65d1`).
Cela qualifie l'infrastructure CLI ; aucun des onze parcours métier de
couverture n'est encore qualifié.

La [qualification SQL native](../testing/source-coverage-native.md) passe
désormais **34/34**, avec annulation obligatoire et vérification indépendante
du catalogue, des données et des droits. La revue a notamment corrigé les
gardes de déplacement de parents avant référence et la portée des exceptions
du registre. L'exécution a reproduit puis corrigé une invalidation pendant la
suppression en cascade d'une version. Les essais échoués et leurs corrections
de préconditions sont conservés ; aucun contrôle métier n'a été abaissé.

Le candidat final et la fixture sont gelés aux empreintes documentées dans la
recette native. Le seed navigateur versionné a passé deux revues et ses
contrôles statiques, avec les PDF A/B de trois pages vérifiés. Il n'a créé
aucune donnée. L'application durable de cette nouvelle migration sur la pile
locale reste à autoriser après préparation de ses vérifications ; l'accord
précédent couvrait seulement la migration des références CCTP. Le build final
**`VkLflpDNxblqxb9gOp6aM`** passe après gel de la fixture et documentation du
refus d'une recherche de composants trop large, sources stables,
OpenAPI et cinq budgets, dans
`.e2e/product-foundation/builds/2026-10-12T00-09-44-939Z`.
Les six traces de dépendances des nouvelles routes conservent bien le
parseur PDF requis. Cette vérification de packaging ne remplace pas la
préparation, lecture et décision réellement exécutées dans le navigateur.

Le protocole d'application locale a passé une revue indépendante. Son
inspection en lecture seule réussit dans
`.e2e/source-coverage/coverage-native/native-installations/inspect-39524d417971483f/application.json`.
L'empreinte de l'état préalable est
`f6966777f6491fc8c57fbb28a6b66a6c94c3e4452322afbd319e3a3c10f3f10d`.
La demande d'accord pour la seule migration locale a été envoyée ; aucune
application persistante ni création des nouvelles fixtures navigateur n'a
encore eu lieu.

### Recette isolée complète — 12 octobre, deuxième passe

L'accord pour la pile historique `32959` reste en attente. Pour avancer sur
les validations indépendantes, une nouvelle pile native jetable a été créée
(`miaouffrage-coverage-729799711d9c404b`, API `45585`, PostgreSQL `33485`).
Ses migrations sont installées ; son identité native et son état vide avant
fixtures ont été contrôlés. La pile historique n'a pas été modifiée.

La suite pgTAP complète passe **13 fichiers / 1 232 assertions**. Elle a
révélé une fixture d'achat restée sur l'ancienne API révoquée ; sa correction
conserve les contrôles de provenance, droits et annulation transactionnelle.
L'échec initial et le rejeu sans reset sont conservés dans
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/requalification`.

Les **huit courses de couverture** passent sur cette nouvelle pile, avec
deux transactions et un observateur identifiant effectivement le PID
bloqueur : quantité avant/après décision, registre avant/après, deux clés
sur la même révision, même clé rejouée, révocation avant/après décision.
Les décisions témoins et toutes les lignes préexistantes inventoriées des
fixtures navigateur sont conservées, ainsi que le catalogue et les droits.
Archive : `.e2e/source-coverage/coverage-concurrency/runs/run-97d422a608e24de2` ;
SHA-256 du manifeste :
`8e9628fafbbc104903ffbbb9b6c189b9b9f1e86e1a047f98abbf98812614bcb2`.
Cette preuve SQL utilise des métadonnées PDF synthétiques ; elle ne qualifie
ni les octets Storage, ni l'authentification HTTP, ni le calculateur.

Le build **`51WJ18kp0EVXbXrlkKkQg`**, compilé pour la nouvelle API, passe
OpenAPI et les cinq budgets avec sources stables. Archive :
`.e2e/product-foundation/builds/2026-10-12T00-36-10-175Z`.
Onze dossiers indépendants et leurs PDF A/B réels sont préparés dans
`.e2e/army/coverage/fixtures/coverage-fresh-01` ; les lignes finales,
applications, exigences et décisions restent à créer par les parcours.
Leur recette navigateur n'est pas encore qualifiée à ce stade.

La première campagne navigateur a été interrompue après reproduction du
même échec de préparation : authentification réussie, deux timeouts sur S0,
un scénario interrompu et huit non exécutés. Archive conservée :
`.e2e/army/coverage/runs/2026-10-12T00-41-39-336Z`. Une lecture ordinaire
indépendante confirme quatre lignes totalisant 71 000 centimes HT, mais un
entête restant à 40 000 / 8 000 / 48 000 après trois créations par l'API,
rechargement et Ctrl+S. L'interface affichait pourtant 710 € HT et « À jour ».

Deux contrats sont distingués : la sauvegarde explicite après rechargement
doit réconcilier les totaux avec le calcul serveur canonique ; garantir les
totaux dès le HTTP 201 de création nécessite une transaction d'insertion
et projection commune. Aucun correctif de la première voie ne vaut preuve
d'atomicité de la seconde. L'oracle financier et le scénario rouge sont
conservés pendant la correction ; aucun montant attendu n'est abaissé.

Le correctif local permet la sauvegarde explicite V2 sans tampon de cellule,
réutilise le bulk canonique avec contrôle de version, et affiche « Totaux à
synchroniser » lorsque le calcul chargé diffère de l'entête. Ce seul écart
n'alimente pas l'autosave. La revue a fermé un risque d'écrasement d'un
brouillon de récupération en cas de conflit sur cette nouvelle voie forcée.
Lint, types et 51 tests existants passent. Build
`cQIFaqMjaqekBmvB5tm44` : OpenAPI et cinq budgets passent, sources stables,
éditeur à 497 299 / 500 000 octets gzip.

La campagne suivante, conservée dans
`.e2e/army/coverage/runs/2026-10-12T01-01-29-337Z`, vérifie réellement la
régression de sauvegarde : badge « Totaux à synchroniser », aucun bulk durant
la fenêtre observée d'environ trois secondes, POST bulk après Ctrl+S, puis
71 000 / 14 200 / 85 200 et 8 heures après rechargement. Elle s'arrête ensuite
avant les exports : le lecteur de contrôle se déconnecte avec le scope
Supabase global, ce qui invalide aussi la session navigateur. Résultat global
en échec : un login réussi, un scénario échoué, dix non exécutés. Ce résultat
partiel ne qualifie aucun des onze parcours CCTP complets.

La campagne Windows du 12 octobre à 01:19:34 UTC, conservée dans
`.e2e/army/coverage/runs/2026-10-12T01-19-34-253Z`, passe ensuite le
parcours nominal complet et le remplacement A → B : huit exigences réelles,
sept décisions initialement à jour, puis six à revoir et seulement E4
revalidée sous B ; E2 demeure non revue. Les deux exports XLSX sont
téléchargés et leurs cellules vérifiées, avec 710 € HT et huit heures
conservés. Les textes internes du corpus et du registre ne figurent pas
dans ces fichiers. Ce contrôle ne qualifie pas toutes les formes de
confidentialité ni un PDF d'offre imprimé.

Résultat global encore en échec : trois réussites avec le login, un échec
de sélecteur sur la transition du registre et huit cas non exécutés. Les
noms accessibles des boutons incluent leur description ; une revue
indépendante confirme ce défaut du harnais avant correction. Les archives
intermédiaires 03 à 05 conservent également les erreurs de navigation et de
synchronisation de la recette, sans les transformer en défauts produit.

Le défaut d'atomicité de création est maintenant priorisé dans
[CORE-08](backlog-chiffrage-2026-10-11.md#core-08--enregistrer-ensemble-les-lignes-et-les-totaux-persistés),
avec critères de panne et concurrence avant implémentation. La rétrospective
de cette session est tenue à jour dans
[le document demandé](retrospective-chiffrage-2026-10-12.md).

### Revue CCTP qualifiée localement — 12 octobre, 01:49 UTC

Campagne `.e2e/army/coverage/runs/2026-10-12T01-35-38-544Z` :
**12/12 réussites (connexion et onze parcours), aucun échec, ignoré ou flaky**.
Le build Windows `cQIFaqMjaqekBmvB5tm44` et les sources restent stables pendant
l'exécution ; backend natif local `45585`, zéro appel de modèle et traces
authentifiées désactivées. Les 26 téléchargements réels couvrent les sorties
standard et DPGF, avec cellules et montants vérifiés.

Les scénarios passent depuis la création réelle de l'ouvrage et du registre
jusqu'aux huit exigences et aux sept décisions, puis : référence A → B,
relecture ciblée sous B, validation/réouverture du registre, quantités et
prix, retour d'une quantité à sa valeur initiale sans effacer son besoin de
revue, réponse perdue après commit et replay du même reçu, lectures 503 ou
incohérentes, complétude à renouveler et aperçu périmé refusé sans événement.
La base nominale conserve **710 / 142 / 852 € et huit heures**.

Manifeste SHA-256 :
`cecb307dfd8f830149debbedb66eca3753cb1ea0a25286536b10556554c44807`.
Le lecteur indépendant relu vérifie **3 022 contrôles**, sans échec, dans
`.e2e/army/coverage/qualifications/2026-10-12T01-35-38-544Z-aa9a7470/qualification.json`
(SHA `c1b8f216cae6ce35fa726e4e9aadd8bd04aad7cb13e093d6a4efda74baf39377`).
Une collision du lecteur entre les fichiers `s0` et `exports-s0` a été
corrigée par sélection exacte, sans modifier la campagne ni ses artefacts.
Après qualification, ce même lecteur a été promu dans `scripts/tester-army/`
et son README actualisé. Le reçu
`.e2e/coverage-reader-reviewed/promotion.json` constate sur 105 entrées que
seuls ces deux fichiers ont changé ; le code applicatif, les parcours et le
build restent identiques. Les empreintes du manifeste, de la qualification
et de l'index original sont de nouveau vérifiées dans `preservation.json`.

La recette attend désormais un champ éditable après chaque reload. Le cas
de départ avant cette disponibilité, observé dans la campagne 07 avec un
bail restant, demeure **non corrigé et non qualifié** ; aucun déverrouillage
forcé n'a servi à obtenir ces réussites. Les exigences du corpus sont
synthétiques : ce résultat ne prouve ni l'exhaustivité d'un CCTP réel, ni une
validation professionnelle, ni la matrice complète des droits, ni les
copies physiquement supprimées, ni un PDF d'offre imprimé ou un déploiement.

Le complément HTTP session/acteur, rôles/PDF et tenant actif est préparé et
relu sous `.e2e/source-coverage/access-candidate/`, avec lint/types réussis,
mais n'est pas intégré ni exécuté. Il conserve des fixtures propres et des
logins UI réels. Les cas de version envoyée et de suppression physique ont
leurs préconditions séparées dans le [plan d'accès](../testing/source-coverage-access-plan.md).
