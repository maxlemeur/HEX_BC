# Goal de la suite du chiffrage

Passation demandée par l'utilisateur le 12 octobre 2026. La mission complète
reste ouverte. Ce document actualise son exécution ; les recettes locales et
la rétrospective ne constituent pas l'achèvement de l'application.

## Objectif

Réaliser entièrement MergeOne/Miaouffrage comme un logiciel professionnel de
chiffrage BTP, avec une profondeur métier CVC/plomberie, du dossier reçu au
retour d'expérience chantier. Livrer un parcours cohérent : documents et
révisions de référence explicites ; exigences sourcées reliées aux prestations,
zones, réseaux et lignes ; imports CSV/XLS/XLSX/PDF et métrés contrôlables ;
grille performante et calculs déterministes ; ouvrages paramétriques ; coûts
internes reliés à une DPGF commerciale indépendante ; prix traçables et offres
fournisseurs comparables ; consultations préparées ; propositions IA
contextuelles, bornées et révisables ; conséquences des changements et
variantes ; approbations et offres émises immuables ; budgets, besoins et achats
chantier ; distinction vendu/prévu/engagé/consommé ; apprentissage contextualisé
validé par un responsable.

Adapter librement la solution et l'ordre de réalisation aux preuves et à la
valeur métier. L'audit et le backlog du 11 octobre sont un point de départ,
pas une limite. Respecter l'expiration maximale des tarifs après six mois
calendaires, l'exclusion des offres fournisseur à zéro du prix de référence
avec clarification, et le contrôle humain des engagements.

Définir les défaillances avant implémentation et qualifier les parcours par
TesterArmy avec assertions exactes sur valeurs, persistance, droits, sources
et exports. Créer et exécuter les parcours TesterArmy des fonctions critiques
et importantes ; distinguer leur préparation de leur qualification métier.
Éprouver concurrence, récupération, confidentialité, performance,
sauvegarde/restauration et exploitation. Sur un corpus validé par un chiffreur,
mesurer aucune omission critique connue manquée, au plus 20 % de fausses
alertes et au moins 25 % de réduction médiane du temps humain à qualité égale.
Ces objectifs restent à mesurer. Préparer les activations distantes jusqu'à un
résultat concret vérifiable, puis obtenir l'autorisation de publication ou
d'application requise par AGENTS.md. Ne déclarer le goal atteint qu'après
recette métier complète, qualification de l'exploitation et mise en service
autorisée.

## Prochain chantier métier : composants d'ouvrage

Constat de départ du 12 octobre : les composants ont les statuts
`suggested`, `manual`, `rejected` ; l'interface ne propose pas encore
« Écarter/Rétablir ». La suppression physique n'est pas une décision de revue.
Les calculs UI/serveur et la projection/commit SQL incluent actuellement tous
les composants. Un filtre TypeScript seul serait incomplet.

1. Définir puis exécuter le RED dans le vrai dialogue, sans préinsérer de rejet.
2. Ajouter une décision réversible qui conserve la proposition et son état
   d'origine. Les calculs retenus, heures, provenance appliquée, bibliothèque
   et snapshots doivent suivre la même sélection par ID.
3. Préparer une nouvelle migration ciblée pour les contrats SQL de projection,
   validation de revue et commit. Respecter les autorisations d'application.
4. Vérifier sauvegarde, rechargement, application, lectures ordinaires, exports
   standard/DPGF et réutilisation de la bibliothèque dans un deuxième devis.

Témoin proposé : quantité 1, marge 1, TVA 20 %, RMO 4 000 centimes/h ; matériel
4 000 et MO 1 h, plus matériel 8 000 et MO 2 h. Valeurs attendues, en centimes :

| Composition | HT | TVA | TTC | Heures |
| --- | ---: | ---: | ---: | ---: |
| Quatre composants retenus | 24 000 | 4 800 | 28 800 | 3 |
| Deux derniers écartés | 8 000 | 1 600 | 9 600 | 1 |
| Matériel 8 000 rétabli | 16 000 | 3 200 | 19 200 | 1 |

Conserver les propositions écartées dans la revue et son historique ; seuls les
composants retenus alimentent la composition appliquée. Rétablir restaure l'état
d'origine, sans réactivation implicite par édition/duplication/scission. Une MO
retenue à coût nul conserve ses heures ; un composant retenu à zéro conserve
son identité et sa provenance. Une composition entièrement écartée ne peut
être appliquée comme un ouvrage validé. Une intention antérieure devient
périmée après changement de composition. Ces décisions de product owner sont
distinctes de la règle des offres fournisseur à zéro.

## Autres travaux ouverts

- CORE-06 : qualifier les ordres de concurrence/replies perdues du bail par un
  transport transparent réel. NAV01/NAV05 n'ont pas reproduit l'anomalie et ne
  prouvent pas les courses retardées. Aucun correctif produit n'en est déduit.
- Verticale CCTP référence A/B : rendre ses helpers historiques autonomes et
  qualifier cette campagne séparément de `source-coverage`.
- Réévaluer les écarts produit et les priorités à partir de la vision, de
  l'audit, du code actuel et de la recette ; compléter ensuite les fonctions
  restantes du goal et les preuves d'exploitation.

## Cadre de reprise

Même dépôt `C:/Users/maxim/Projects/miaouffrage`, racine, `main`, sans nouveau
worktree ni branche. L'état de travail existant est conservé ; les fichiers
modifiés/non suivis ne peuvent être attribués globalement à cette tranche.
Pas de commit, push, PR, déploiement, migration distante/partagée ou message
externe sans l'autorisation correspondante. Ne lire ni afficher les secrets.

Lire les instructions applicables, l'état Git et les documents ciblés avant
d'éditer. Réutiliser les recettes versionnées et les preuves exactes nommées ;
ne sélectionner aucun « dernier run ». Une ancienne archive ne qualifie pas
des sources nouvelles. Une étape interrompue/ambiguë garde son reçu et ses
identités ; pas de retry, réparation ou nettoyage automatique.

## Preuves acquises avant la nouvelle rétro

La campagne `recipe-cctp-retro-20261012-02` passe 12/12 dans l'archive
`.e2e/army/coverage/runs/2026-10-12T20-39-03-661Z` ; le lecteur indépendant
réussit 28 397 contrôles, 26 XLSX et la confidentialité des 722 fichiers.
La compatibilité `recipe-go-retro-20261012-09` passe 7/7 dans
`.e2e/army/coverage/runs/2026-10-12T20-53-42-299Z` ; son lecteur réussit
24 986 contrôles et la confidentialité des 508 fichiers. Les SHA exacts et
leurs qualifications sont dans la
[rétro de recette](retrospective-recette-chiffrage-2026-10-12.md).

Le même build `yD3yKrjccL8pHYXHZho5a`, SHA de manifeste
`755e6604ba811509c6704245294c97b810233a93a57cabfd445e88e4d089cb8d`, est
qualifié par OpenAPI, Webpack et les budgets, entrées stables. La recette
native CCTP-02 réussit 34 cas CCTP, 100 générés et 1 241 assertions pgTAP ;
les préparations natives conservent données, catalogue et droits. Les 176
prérequis CCTP, le compteur +11 et les 22 PDF sont relus après les deux commits.

Pour reprendre la pile jetable sans la réparer ou la réinitialiser : config
native `.e2e/retro-runtime/config/recipe-go-20261012-03/native-config.json`,
API `127.0.0.1:45585`, PostgreSQL `127.0.0.1:33485`, WSL `Ubuntu-24.04`.
Les préconditions de runtime, système PostgreSQL et compte doivent être
revérifiées. Le backend privé est chargé depuis
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/coverage-preparation/backend.env`
et le login depuis `.e2e/army/coverage/fixtures/create-atomic-green-01/local.env`.
Ne jamais afficher leur contenu. Les origines historiques 32959 et 59827
relèvent d'autres campagnes ; ne pas mélanger leurs reçus.

La campagne CCTP-01 échouée avant SQL reste intacte. Le contrôle de rôle RMO
et l'import TypeScript Node 24 sont corrigés et revus. L'avertissement
`MODULE_TYPELESS_PACKAGE_JSON` est connu ; changer globalement le type du
package n'est pas nécessaire à cette correction.

Les améliorations de harnais/commande de la nouvelle rétro viennent après ces
recettes. Les archives prouvent le build nommé à leur date, et devront être
renouvelées pour les modifications produit de CORE-07. Elles ne qualifient
aucun composant écarté, ordre de concurrence, modèle actif, rôle complet ou
PDF d'impression. Le prochain chat GPT-6.1 Sol Ultra doit créer son goal avec
l'objectif complet ci-dessus, sans budget artificiel, puis réaliser CORE-07
et poursuivre les écarts jusqu'à la mise en service autorisée.

Les deux harnais CCTP passent désormais 11/11 et 9/9 dans une copie sans
archives historiques. `npm run check:army-recipes` passe 60/60 dans le runtime
local autorisé, avec six reçus enfants hashés et reçu agrégé
`.e2e/retro-runtime/retro-guards-20261012/green.json`. Les échecs RED et sandbox
sont conservés. Cette commande qualifie uniquement les gardes hors réseau ;
le contrôle de portabilité Windows/Linux conserve une entrée plan/SHA explicite.
La nouvelle rétro et la [navigation des reçus](../testing/local-recipe-reproducibility.md)
sont les points d'entrée pour reprendre sans rescanner tous les anciens runs.

## Avancement de CORE-07 au 13 octobre

Le nouveau chat a créé son goal avec l'objectif complet ; il reste actif.
Le RED navigateur est réellement observé : connexion réussie, quatre
propositions suggérées, puis absence du bouton « Écarter » dans GC01.
L'archive exacte est `.e2e/army/coverage/runs/2026-10-12T21-51-25-322Z` ;
sa qualification indépendante contient 2 805 contrôles sans échec et porte
uniquement sur cette absence observée. Le build de ce RED ne qualifie pas
les modifications produit ultérieures.

L'interface et le serveur des décisions sont implémentés. La migration
`20261012215942_generated_ouvrage_component_decisions.sql` a été appliquée
une fois sur la seule base locale `33485`, après accord explicite et revue.
Les 39 cas composants, 100 cas atomiques et 34 cas CCTP passent avec conservation
des données et droits. La recette full06 passe Auth + GC01–GC04 (5/5), six XLSX
et 3 469 contrôles du lecteur dans l'archive
`.e2e/army/coverage/runs/2026-10-12T23-55-18-571Z`, sur le build
`-WO3pkd61L1XqWDOMVq2y`. Cette preuve financière et de décisions reste datée.

La revue a découvert une lacune de cette recette : la réutilisation conserve
coûts et heures mais perd l'origine, devenue `manual` / `{}`. La nouvelle
migration `20261013002038_assembly_library_component_provenance.sql` a été
appliquée une fois sur la base locale `33485`, après autorisation et revue.
Les 19 cas installés passent avec rollback et conservation. La recette UI09
sur le build `65BqWQvGwjzIRiZVk4MCK` passe 5/5 dans l'archive
`.e2e/army/coverage/runs/2026-10-13T06-12-54-063Z` : 3 615 contrôles du
lecteur, six XLSX et une relecture indépendante conforme. Elle vérifie les
copies de provenance exactes après réutilisation, leur affichage dans la vraie
interface, les décisions et les heures de MO retenue à coût nul.

La qualification concurrence03 passe les trois courses SQL et le contrôle
global de conservation ; ses 63 artefacts sont relus. Reçu exact :
`.e2e/core07-sql/concurrency-preparation-20261013-01/runs/qualification-20261013-03/receipt.json`,
SHA `a6e421b403b742383236806f48f9e8571209a4727de48cef8dbbd06afc624d83`.
Les blocages PostgreSQL sont réellement observés : une revue modifiée refuse
l'ancienne application, une application réussie refuse l'ancienne sauvegarde.
L'admission HTTP est réelle, puis les claims SQL sont simulés avec un bail
partagé. Cette preuve reste distincte de deux onglets UI indépendants. Les
anciens reçus refusés restent conservés et ne sont pas requalifiés.

L'utilisateur a autorisé les prochaines migrations nécessaires au goal dans
le périmètre de la base locale de test actuelle, après qualification et revue.
Cet accord persiste ; les publications et applications distantes suivent
leurs autorisations propres.

Les parcours préparés vérifient décision réversible, sauvegarde/reload,
composition et bibliothèque retenues par identité, heures de MO à coût nul,
exports standard/DPGF, réutilisation, tout écarté et intention périmée.
Ils ajoutent le refus de fusion sans invalidation et le maintien de l'origine
pour un contenu équivalent. Leur présence dans le dépôt ne constitue pas
une preuve d'exécution réussie. Voir les contrats
[E2E des composants](../testing/generated-ouvrage-components-e2e.md) et
[SQL des composants](../testing/generated-ouvrage-components-sql.md).
La [matrice des parcours critiques](recette-flows-critiques-2026-10-13.md)
identifie les preuves datées et les parcours importants encore à créer.
Après fermeture de CORE-07, traiter en priorité les saisies quotidiennes du
sous-détail : prix en euros explicites, virgule conservée pendant la frappe et
pertes en pourcentage. Les trois RED NI sont maintenant exécutés et qualifiés :
`12,` devient `12`, `1,` devient `1`, et les pertes annoncent encore `bp` après
frappe réelle. Archives exactes : `2026-10-13T06-31-36-615Z`,
`2026-10-13T06-37-44-564Z` et `2026-10-13T06-44-11-692Z` sous
`.e2e/army/coverage/runs/`. Ils ne prouvent que les phases atteintes ; le
correctif et les parcours de persistance/application/exports restent à qualifier.
Puis poursuivre
CORE-06, référence CCTP A/B, finalisation et les autres parcours du goal.

## Tranche ouvrages et calculs qualifiée sur un build commun

Le build `qr3YmHSeJagCWR0yRcnzZ` est conservé sous
`.e2e/army/recipes/builds/2026-10-13T10-47-05-619Z-c9d5df2d/manifest.json`,
SHA `1e3ac9080b204093b7d76a3fe06202868b53bf1aa0cafe540f9427e1639a8d9f`.
OpenAPI, compilation et budgets existants passent, sources inchangées pendant
les trois recettes. Elles utilisent connexion ordinaire, fixtures ARMY neuves,
zéro skip/retry/modèle/trace authentifiée :

| Recette | Archive exacte sous `.e2e/army/coverage/runs/` | Résultat et reader |
| --- | --- | --- |
| Composants GC12 | `2026-10-13T10-50-51-008Z` | Auth + GC01–04 : 5/5, six XLSX, 3 702 contrôles, qualification `7030e1ae-49ff-4ec1-ac0e-79a6f27a5921` |
| Pied financier AT05 | `2026-10-13T10-55-14-930Z` | Auth + AT01/02 : 3/3, huit XLSX, 3 382 contrôles, qualification `d10ad474-9947-480e-a857-8d0e7fbaf6f3` |
| Saisies NI06 | `2026-10-13T11-02-52-336Z` | Auth + NI01–03 : 4/4, seize XLSX, 4 584 contrôles, qualification `face2d50-fef6-4383-ae06-f4ec104f0583` |

La revue conserve les propositions écartées et leur origine, tandis que
composition appliquée, heures, bibliothèque et snapshots utilisent les seuls
composants retenus. Prix en euros, virgules de frappe, pertes en %, invalides
bloquants et MO retenue à coût nul sont vérifiés jusqu'aux exports/réutilisation.
NI02 confirme parent 2 sauvegardé et repris, 0,5 h à coût nul et PU 25 €.
Les UUID des jointures source peuvent être recréés à la sauvegarde ; les IDs
composants/fragments et la provenance sémantique restent conservés.

Trois défauts réels supplémentaires ont été corrigés : pied de version nul
après insertion de bibliothèque ; reprise perdant la quantité parent validée ;
ajout de ligne sous un lot temporaire puis perte de sa saisie. AT05 retient le
vrai POST parent, vérifie l'ajout enfant indisponible pendant la création, puis
les deux réponses 201 et IDs réels. Il vérifie ensuite pied/lignes/paramètres
avant et après reload, API/RLS et exports, sans écriture financière corrective.
La projection UI de remise est resynchronisée avec son taux persisté, sans
écraser une remise explicitement modifiée ni les autres champs locaux.

La migration `20261013074536_finalize_estimate_assembly_calculation.sql` a été
appliquée une seule fois sur la base locale 33485 après qualification et revue.
Les 46 cas installés passent avec rollback et conservation indépendante des
données, catalogue, historique et droits. La matérialisation et sa finalisation
restent deux transactions : récupération d'un échec partiel/inconnu et
idempotence d'insertion ne sont pas déclarées terminées. Aucun remote ou
publication n'est couvert par ces preuves.

Les archives ratées restent intactes, y compris les erreurs de harnais
(conversion de zéro français, sauvegarde redondante, recherche de preuve par
suffixe) ; leurs cas non atteints ne sont pas comptés. Quatre anciens tests
unitaires serveur restent incompatibles avec le verrou de session et le refus
de rôle MO invalide : aucune réussite globale Vitest n'est annoncée. Les tests
existants ciblés et les contrôles de types/lint pertinents passent ; aucun test
unitaire nouveau n'a été écrit après le code.

Le goal intégral reste non atteint. Les courses de paramètres pendant transport,
les propositions initialement incomplètes, les variantes chapitre/mobile,
les rôles complets, les corpus métier et l'exploitation restent à qualifier.
La remise simple actuelle stocke un taux ; une remise véritablement fixe en
euros exige un mode explicite, et n'est pas prouvée par AT05.

La prochaine priorité métier est OF01/OF02, puis OF03 : vrai lien client,
copie commerciale figée avec le PDF et export client sans coûts/marges internes.
Le précode `.e2e/product-audit/offer-emission-precode-20261013-01/` définit
les deux RED, RPC/RLS et compatibilité par PDF historique vérifié, sans
exécution ni mutation. Puis poursuivre CORE-06, CCTP A/B autonome, achats,
chantier et retour d'expérience. L'autorisation des prochaines migrations
locales nécessaires persiste ; les activations externes restent séparées.

## Émission d’offre — progrès et écarts reproduits le 13 octobre

Le parcours d’émission depuis la fiche avait deux défauts : absence de bail
de brouillon après fermeture de l’éditeur, puis PDF envoyé comme Buffer JSON
refusé par le transport. Le formulaire utilise maintenant son bail de page,
sans takeover, et le PDF est encodé en base64. La recette locale OF00 reçoit
exactement le document publié : 47 315 octets, 20/4/24 EUR, statut sent.
Auth + émission passent ; la revue indépendante vérifie 2 230 artefacts.
L’archive `2026-10-13T12-12-01-392Z-8bbf30fc…` reste une preuve locale en
Webpack dev, avec collecteur HTTP, sans livraison Internet ni qualification
de production. OF0L protège le bail concurrent avant annulation ; reprise
après état sending, autre utilisateur et autre tenant restent distincts.

Deux RED métier sont désormais exécutés avant la correction commune :

- OF01 : le lien réellement reçu, ouvert sans cookies, mène à `/login` ;
  le DOM final contient « Connexion ».
- OF02 : après édition réelle de l’affaire, le renvoi conserve le PDF
  original mais reprend le nom courant dans le HTML et le texte.

Le module pur `offer-contract.ts` valide Client1/Proof1 et le sceau v5 :
159 régressions passent, dont 38 vecteurs historiques v1–v4 inchangés.
Les tests et vecteurs ont précédé le module. Sa revue statique est favorable ;
son intégration à la publication, au transport et au portail reste à qualifier.
La matrice SQL a été étendue à 107 cas avant correction. Après un setup
invalide conservé, un vrai RED a confirmé le déclencheur erroné. Le candidat
corrigé passe 107/107 avec P9001 terminal et conservation indépendante des
données, historique, droits et fonctions. La revue corrigée est favorable.
La migration `20261013130248_estimate_offer_client_contract.sql` est appliquée
une seule fois sur la base locale 33485. La répétition P9001, la comparaison
avant/après commit et le lecteur indépendant vérifient les anciennes colonnes,
timestamps, historique, fonctions, OID et droits. Le premier protocole demandait
un verrou interdit sur l’historique interne Auth ; il est conservé comme échec.
Les verrous corrigés respectent les droits existants, sans grant ajouté.
Auth/Storage restent comparés intégralement, sans garantie de gel de leur DML.
Reçus locaux : application `053255d8…`, lecture indépendante `151f3032…`.

Une vraie offre locale antérieure et son ancien sceau ont été conservés pour
la compatibilité. Ses CGV sont des CGV de développement non revues : aucune
approbation juridique de production n’est déduite. La convention retenue pour
les nouveaux liens est la fin du dernier jour de validité, en Europe/Paris ;
un renvoi conserve les dates originales. Les droits, la copie figée, les
décisions liées à leur propre émission et la conservation seront qualifiés
avant application locale, puis par de nouvelles recettes navigateur.

Le raccordement PDF/email/portail est écrit et reste à vérifier dans
l’interface après application locale. La capture reprend les ventes nettes
et le pied existants sans nouveau moteur ni seconde remise. 165 régressions
passent : 159 contrats/sceaux, deux intégrations avec le vrai calculateur et
quatre rendus HTML/PDF réels avec identité figée. Le lecteur PDF initial a
échoué sur un chemin Windows ; cet échec est conservé, le chemin est corrigé.
Les 20 régressions existantes de livraison/reprise passent. Le vérificateur
historique passe ses sept cas sélectionnés ; douze autres cas ont été filtrés.

OF03 (confidentialité) et OF04 (émission manuelle, accepté, archivé) sont
préparés avant leurs changements, sans exécution revendiquée. Le bail de
l’action manuelle attend son RED réel. La concurrence à deux sessions,
les décisions client HTTP, la reprise après erreur et l’impression interne
figée restent à qualifier. La copie nouvelle n’affiche pas encore une remise
distincte ; cette évolution demandera un contrat et une recette dédiés.

La priorité demeure OF01/OF02, OF03/OF04, puis les autres parcours du goal.
Ces résultats ne terminent pas l’application entière.

2026-10-13 préparation PDF v2 : nouvelle migration additive20261013162417_estimate_v2_document_snapshot_session.sql, SHA f3e7d6b35d41aeaa0b58f0aac5e55fd24aae46f322a516e362bb7e50953f3d31. Les40cas financiers/session/permissions/P9001 passent sur candidat local, receipt f703a99642dd7b664b03ffbd0a59028d1917039b06f226546bdd132e96257af1. Revue indépendante396342834aa57c14b4e254f1739bfb28bee7ec0747e1412b0620fae556e1ef0f. Application UNE fois sur45585/33485 après répétition annulée1ffd632e69ef6672429085d8a4940f1756c4dfff261e59d4287e18a042333184 : receipt ca0262075dcb273229825bf0fca20f326936dbec433dc9a0d2fb161ea61d669e. Lecture indépendante713b1acbaa48f618bc52f49d41ef723a38640c05fd5b5dc96567e6ec065423ff conserve toutescolonnesactuelles/OID/corps/droits/historique antérieur ; seule fonctionneuve+ligneoriginale. La base distante n'est pas modifiée. Recette PDF/portail/éditeur et concurrence restent à qualifier ; ceci ne complète pas l'application.

Point de reprise du 13 octobre, 18 h 29 UTC : l'autorisation de poursuivre les
migrations locales nécessaires reste valable sur la pile 45585/33485. Elle ne
vaut pas autorisation de publication ou de modification de la base distante.
La migration documentaire est aussi vérifiée après installation : 40/40 cas,
annulation P9001 et conservation des données, fonctions, droits et historique
(`b12369b5…`). Les migrations déjà appliquées restent immuables.

La recette navigateur du 13 octobre à 17 h 35 a passé les six parcours PDF
sélectionnés : acquisition du bail, refus d'un autre bail, renouvellement,
impression sans mutation, fermeture sans perdre le bail de l'éditeur et
sauvegarde après génération avec relecture à 40 € HT / 48 € TTC. Cette preuve
est locale et datée. La coupure de lecture après génération échoue encore dans
la recette de 18 h 16 : l'éditeur reste affiché, mais la récupération attendue
n'apparaît pas dans le dialogue. Les 2 242 artefacts sont conservés et les
sources sont identiques avant/après. Les parcours de récupération, de gestion
MO pendant cette panne, puis d'émission/renvoi/décision client restent à
qualifier. Aucun achèvement global ni qualification de production n'en découle.

Point de reprise du 13 octobre, après les recettes de 19 h 48 à 20 h 09 UTC :
la récupération après PDF est désormais vérifiée sur une compilation locale
de production. PDFL7 conserve la quantité et le titre en attente pendant deux
coupures de lecture, interdit la sauvegarde, puis permet la relecture et la
sauvegarde : 40 € HT / 8 € TVA / 48 € TTC sont conservés après rechargement.
PDFL8 interdit les écritures du gestionnaire MO pendant cette panne, puis
vérifie leur reprise et la persistance à 20 € HT / 4 € TVA / 24 € TTC. PDFL6
vérifie aussi la sauvegarde ordinaire après PDF. Les lecteurs indépendants
contrôlent les artefacts, les sources et les compilations capturées ; les
reçus sont respectivement `f50e3265…`, `f17ba063…` et `fe69cbed…`. Ces preuves
portent sur leurs sources capturées, antérieures au correctif suivant.

Le vrai parcours OF04 a ensuite révélé un token de concurrence absent de la
projection serveur et l'absence de bail de page sur « Marquer envoyé ».
Les correctifs applicatifs sont écrits et relus ; leur recette reste à passer.
La préparation SQL ajoute une fonction dédiée sans remplacer l'ancienne :
elle contrôle le token exact, la session du bail et son expiration réelle
avant de déléguer le contrôle documentaire et la transition atomique.
Le premier candidat passe 43/45 cas avec annulation et conservation complète.
Les deux échecs viennent d'un setup qui tente de modifier le moteur protégé
(`ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE`), confirmé par le diagnostic natif.
La correction des fixtures précède la nouvelle qualification. Aucune nouvelle
migration d'émission manuelle n'est encore appliquée à ce point.

Après correction du setup v2, le candidat passe 45/45 cas (`ac44eacf…`).
La migration additive `20261013210744_estimate_manual_emission_session.sql`
est ensuite appliquée une seule fois sur la base locale 33485 après une
répétition annulée (`21dc3029…`) et des revues indépendantes. L'application
(`77daddd0…`) et la lecture indépendante (`1de3349b…`) conservent toutes les
colonnes courantes, anciens corps, OID et droits ; seuls une fonction et sa
ligne d'historique sont ajoutés. La recette après installation passe aussi
45/45 sans DDL (`177a030c…`). Les fixtures et limites sont décrites dans
`docs/testing/manual-emission-session-sql.md`. La recette OF04 dans
l'interface et sa vérification documentaire restent à exécuter.

Recettes exécutées le 13 octobre entre 21 h 36 et 21 h 43 UTC, puis qualifiées
par lectures indépendantes : OF04 passe envoyé → accepté → archivé, avec
20 € HT / 4 € TVA / 24 € TTC conservés après rechargement. Le PDF réellement
stocké et le vrai calcul du sceau v4 → v5 correspondent à la copie Doc1 ;
aucun email, lien client, approbation ou cycle de revue n'est créé pour ce
parcours manuel (`62e3775c…`). OF01 vérifie aussi les trois champs du dialogue
après annulation/réouverture, l'envoi au collecteur local et l'ouverture
anonyme de sa propre offre. La lecture native relie demande2, capacité2,
Doc1, PDF collecté et sceau réel (`f30a4832…`).

OF02 conserve le PDF et l'identité copiée après renommage du projet et deux
envois au collecteur local (`c528c868…`). La publication Doc1 reste liée au
premier envoi ; chaque demande possède sa propre capacité, encore en attente
avant toute décision client. Cette recette ne crée pas de nouveau brouillon
et ne prouve pas l'expiration des liens frères. Ces cas restent à exercer.
Les archives retenues contrôlent respectivement 2 255, 2 256 et 2 261 artefacts,
leurs sources capturées, leur compilation et leurs résultats sélectionnés.
Ils ne prouvent ni une livraison Internet ni l'acceptation globale du produit.

Le dialogue email est maintenant chargé à sa première ouverture et conserve
ensuite son formulaire et ses références de reprise. Les deux boutons
d'ouverture suivent ce comportement. Le bundle éditeur est mesuré à
498 262 octets gzip sur la compilation locale, sous le budget inchangé de
500 000 octets. Le dépassement initial et les variantes non qualifiées sont
conservés ; aucune performance terrain n'est déduite de cette mesure.

OF03 s'arrête avant envoi : aucun modèle de CGV validé n'est configuré dans
la base locale et la compilation de production refuse le fallback DEV.
L'option de sandbox explicite reste à implémenter/qualifier, en conservant
l'indication de brouillon et sans inventer de validation juridique.

La revue de l'email identifie aussi un écart P1 avant réservation d'un nouveau
brouillon : gel et réservation SQL contrôlent l'utilisateur du bail, sans sa
session exacte ni l'heure réelle après attente. Le dialogue n'envoie pas le
token initial de concurrence. La correction doit conserver ce token jusqu'au
premier gel, chaîner uniquement le timestamp retourné par son propre gel et
revalider le bail sous verrou avant réservation. Les rejouages terminaux et
reprises déjà réservées doivent rester inchangés. La matrice de 58 cas est
préparée avant DDL ; aucune nouvelle migration email n'est encore appliquée.

La suite applique localement la migration email additive après répétition
annulée et revue : application `54e55989…`, lecture indépendante `30950fa9…`,
recette installée 58/58 `b94c81fd…`, qualification des archives `8ca84040…`.
Les anciennes données, fonctions/procédures et leurs droits sont conservés.
Le raccordement applicatif transmet le token original et la session exacte,
avec contrôle SQL avant réservation. Le dialogue capture sa version à
l'ouverture et conserve le formulaire après annulation. Les 24 scénarios
existants, lint, typecheck et OpenAPI passent ; la nouvelle compilation et
les recettes EF/OF restent à qualifier. Les trois RED réels antérieurs sont
conservés. Le protocole et ses limites sont dans
`docs/testing/email-reservation-session-sql.md`.

La compilation locale `yqMYAtgnkodnPu-Z2hGnU` passe EF01/EF02/EF03 dans
l'interface. Leur qualification native et des archives confirme un envoi
nominal (PDF collecté et sceau réel, `f85394db…`) puis deux refus sans demande
email, capacité client ou sceau d'offre (`7eb358ab…`, `7e29de34…`). Les
montants restent 20 € HT / 4 € TVA / 24 € TTC. Le document préparé avant les
refus reste une publication manuelle sans dispatch ; sa préimage complète
n'était pas archivée, donc sa conservation octet par octet n'est pas revendiquée.
Deux erreurs du lecteur de preuve sont corrigées et leurs échecs conservés :
champ `profiles.tenant_id` inexistant et confusion entre le purpose du gel
financier et celui de la publication PDF. Aucun correctif de base n'est requis.

La revue repère un autre écart applicatif : une clé d'envoi déjà liée à une
autre version du tenant est masquée par le filtre de version, ce qui peut
provoquer un gel financier avant son refus. EF04 ajoute deux vrais brouillons,
avec une image V2 réellement à figer sur le second, pour exposer cet effet.
EF05 vérifie le code précis après transmission d'une mauvaise session valide ;
cette session est déjà refusée, aucun contournement de droit n'est établi.
Les scénarios sont écrits et relus avant cette deuxième correction ; leur RED
réel reste à exécuter sur un nouveau build. La course entre deux connexions
reste distincte et non qualifiée.

EF04 révèle d'abord un autre défaut réel : la page lit la version pendant
qu'une projection d'approbation peut l'écrire. Le token affiché est alors
périmé dès la première ouverture. La lecture de version attend maintenant
cette projection, sans ajouter de reload au scénario (`4999c276…`, revue).
Sur le build `bCCpAgAuvSxwcLYx02XxU`, EF04 confirme ensuite le token original
correct et expose l'effet visé : le second brouillon est modifié par le gel,
puis refusé avec `ESTIMATE_GATING_BLOCKED`. Il n'atteint pas la réservation.
Le correctif recherche donc la clé au niveau du tenant et refuse sa version
différente avant tout gel. EF05 reproduit séparément le code générique du
précontrôle V2 ; seul ce conflit de session devient `LOCK_REQUIRED`.
Les 24 scénarios existants et les vérifications statiques passent. La recette
GREEN de ces deux corrections reste à exécuter ; aucun nouveau test unitaire
ou assouplissement d'oracle n'est ajouté. L'ordre de lecture de la page Affaire
et les courses entre connexions restent des vérifications distinctes à faire.

La compilation `jhlsvGW0l33sFawdFf-oZ` passe les huit parcours sélectionnés
EF01–EF05 et OF01/OF02/OF04, sur sources figées. Un premier EF01 réussit
l'envoi mais échoue au nettoyage du dialogue ; ce run reste non qualifié.
Sa répétition avec une nouvelle fixture, mêmes sources et mêmes assertions,
passe. Les deux nouveaux cas sont ensuite qualifiés en base et dans les
archives : EF04 conserve la première enveloppe, son PDF et son sceau ; le
second brouillon ne reçoit aucun gel, document, demande email ou capacité
(`fed00e4c…`). EF05 conserve son document manuel préparé et refuse la mauvaise
session sans demande email, capacité ou Seal5 (`bc6509ff…`). Ces preuves
locales vérifient respectivement 2 258 et 2 255 artefacts. Elles ne qualifient
pas la concurrence entre connexions ni une livraison Internet.

L'audit de la première émission repère un ordre à traiter : le flag
`no_pdf_generated` est bloquant par défaut, tandis que la génération email
intervient après ce contrôle. Le détail permet pourtant d'ouvrir le dialogue.
Le parcours Affaire guide déjà vers la préparation du PDF. La liste complète
des flags du RED n'était pas archivée ; cette cause est une inférence à
qualifier dans un vrai premier envoi sans PDF. Préserver les règles de qualité
et le contrôle humain plutôt que désactiver globalement le blocage. L'ordre
de lecture Affaire, les UUID d'API en majuscules et l'atomicité du gel/réservation
restent à éprouver. Les seuils du corpus métier et l'exploitation restent
non mesurés ; le goal global demeure actif.

La première émission sans PDF est qualifiée dans un nouveau scénario NF02.
Le RED du build OnSNDnmWsk3rITljbZb4k observe réellement le seul flag bloquant
no_pdf_generated, le 404/PDF_NOT_READY et l'absence de préparation dans le
modal (75ac18d6…). L'interface affiche maintenant les motifs de contrôle et
réutilise la préparation PDF : choix, annulation, téléchargement, fermeture,
rafraîchissement puis réouverture humaine avec email conservé. Le token ouvert
n'est jamais remplacé par un GET ; le POST reste soumis aux règles serveur.
Sur bZ1V9CuIIwNsZKn__dWNY, NF02 et les huit régressions EF01–EF05/OF01/OF02/OF04
passent sur sources figées. Lint, typecheck et 14 tests UI existants passent.
Un premier Vitest échoue avant assertions sur un renommage de cache sandbox ;
la répétition exacte hors sandbox passe, sans changement de test.

La lecture native NF02 (8351ca1c…) et son admission (66747770…) vérifient
2 259 artefacts : une request2 sent, une capacité2 pending, Doc1/email lié à
la demande, Client1 et builder4→Seal5 réels, montants 2000/400/2400. Le PDF
préparé et le final sont qualifiés séparément : leurs SHA diffèrent, aucune
égalité des bytes ou lecture indépendante des anciens bytes de preview n'est
revendiquée. Cela ne prouve ni le texte/rendu PDF, ni réception Internet, ni
concurrence entre connexions, ni les critères globaux de corpus/exploitation.
Les proofs sont datés de ce build ; toute correction ultérieure garde sa
qualification distincte.

Une revue produit relève un P2 de coordination : l'action de préparation PDF
reste accessible pendant le POST/send. Aucun bypass de CAS/droit établi ;
une recette NF04 doit observer le POST normal en attente puis le bouton PDF
avant correction. La suite immédiate bloque cette préparation parallèle et
vérifie à nouveau le nominal. NF03 Affaire reste une coupe prospective séparée,
avec vrai prérequis approval_evaluated_at NULL sans reset/reload/prefetch bloqué.
L'API PDF conserve sa limite de concurrence client déjà documentée ; aucune
migration ou politique de gating n'est changée par cette intégration.

Le P2 de coordination est maintenant fermé après RED réel NF04 : POST/send
normal retenu 2,1 secondes, Envoyer désactivé mais PDF encore actif, puis
émission normale200 conservée (manifest451bf6c6…). Le correctif limite le
fieldset PDF pendant isSubmitting et refuse aussi son préflight ; aucune
règle serveur/CAS/session/idempotence n'est changée. La revue 5b228e68… est
favorable. Le même NF04 passe sur fZAQf0tAxoC6bs0FGULnI avec action PDF disabled,
zéro nouvelle génération et émission normale unique. Ses 2 257 artefacts
sont vérifiés, sans déduire des comptes natifs pour cette fixture.

Sur ce même build final, NF02 repasse puis est requalifié par lecture native
34b70d08… et admission 5471da7f… : 2 259 artefacts/31JSON/814JSONL, un envoi,
un document final cohérent et un sceau réel, même oracle20/4/24. Les limites
preview/final et corpus global restent explicites. Le suivi détaillé final
est .e2e/offer-emission/nf04-submit-precode-20261014-01/closure.json
(af137406…). Lint/typecheck/14tests UI/build/budgets/diffcheck passent ; les
11 protégés et le callback manuel sont inchangés. Toutes les fenêtres de
recette sont fermées, la pile native conservée. Aucun changement distant ou
publication. Les docs sont appendées après qualification ; ces builds restent
datés, sans promesse de closure globale actuelle après ce changement documentaire.

Suite : exécuter le précode NF03 de première ouverture Affaire et traiter
l'ordre de projection si le RED le confirme ; reprendre ensuite les écarts
CCTP CORE-06, CGV sandbox explicites, decisions portail, grande DPGF, concurrence
transactionnelle et qualifications globales. Le goal complet demeure actif.

## 14 octobre 2026 — première ouverture Affaire qualifiée (NF03)

Le RED réel NF03 a confirmé un conflit à la première ouverture Affaire : la
projection d'approbation avançait `updated_at`, mais l'envoi utilisait encore
la version mémorisée avant cette projection (409 VERSION_CONFLICT). Les
prérequis NULL étaient mesurés avant et après le PDF ; aucun reset, reload ou
remplacement du token n'a fabriqué le cas. La correction porte sur deux sources :
la page Affaire attend la projection, relit la version complète hors du cache
de requête avec contrôle d'identité, puis charge le premier finishLine. Les
autorisations, contrats PDF/email, SQL et onze fichiers protégés sont conservés.

Sur le build `5T1T-WP3tKE8VNyd-JyvF` (manifest `df51d0e3…`), NF03, PDFL1,
OF02 et NF02 passent avec sources figées. NF03 transmet réellement le nouveau
token sans injection ni reload : POST200 et un envoi. Lint, typecheck et les
55 tests serveur existants passent ; aucun test unitaire ajouté. La revue
indépendante `f883087a…` ne relève pas de bloqueur.

La lecture native `4ff7cbf4…` et l'admission `7a468c87…` qualifient NF03 :
2 261 artefacts, 33 JSON et 836 lignes JSONL ; une demande email sent, une
capacité client pending, Doc1/email, Client1 et builder4→Seal5 cohérents,
montants 2000/400/2400. Les métadonnées du PDF préparé et les octets du PDF
final restent des preuves distinctes ; leurs empreintes diffèrent. Ni le rendu
PDF, ni réception Internet, ni concurrence entre connexions ne sont qualifiés
par cette coupe. Closure :
`.e2e/offer-emission/nf03-affaire-root-precode-20261014-01/closure.json`
(SHA `436b6bb3…`). Toutes les fenêtres de recette sont fermées ; keeper natif
conservé, aucun changement distant ou publication. Cette mise à jour du suivi
est postérieure à la qualification : le build reste daté.

La suite prioritaire est CORE-06/CCTP : porter la référence A/B hors de son
ancienne pile59827 et préparer un dossier réellement importé par le contrat
DPGF canonique, puis vérifier les corrections de zones/réseaux et leur
invalidation ciblée. Les douze cas coverage du 12 octobre ne constituent pas
cette preuve d'import ni une analyse exhaustive du CCTP. Les baux retardés
NAV02–04/06, la continuité décision→correction chiffrée, le suivi des passages
non lus et la grande DPGF1004 restent à qualifier. Le goal est actif et demeure
inachevé ; les critères métier, corpus et exploitation restent à mesurer.

### Grande DPGF : import et lecture complets, 14 octobre 2026

La priorité a été avancée après preuve d'une perte silencieuse : un import1004
créait1000 lignes, puis le GET en masquait encore une. Les lecteurs du mapping,
du GET version, de la gating, de l'approbation et de la liste des lignes sont
désormais paginés et contrôlés. Le fence de version reste strict. Un RED réel
a ensuite lié le conflit409 à une projection d'approbation modifiant le timestamp
pendant la lecture. La nouvelle migration de timestamp conserve cette projection
pour le pilotage, sans invalider le contenu inchangé. Elle est appliquée à la
seule base locale33485 autorisée ; baseline9/14, candidat/installé14/14,
répétition et relecture indépendante avec conservation des données/droits.

Sur le build `1MYrkLow_6U7LUtFPsVqb`, NRPI999/1004/2004 passent avec chaque
prix et provenance, toutes les pages, les totaux et le reload. La V1 conserve
son contenu et timestamp, hors seulement trois champs d'approbation dérivés.
La lecture native1004 constate raw/mapped1004, items1005/lignes1004 et sommes
1995450/399090/2394540, sans différence ni mutation pendant la lecture.
L'admission des trois archives est `44bba27a…` ; la clôture liée `96de38ba…`.
Voir [la recette et ses limites](../testing/complete-estimate-item-read.md).

Cette preuve porte sur import/lecture/reload, pas PDF, snapshot V2, offre,
scellement, achats ou concurrence entre connexions. Les lectures financières
restantes plafonnées doivent être traitées avant de qualifier le grand dossier
jusqu'à l'offre émise ; ne jamais déclarer un devis tronqué conforme parce que
ses totaux affichés paraissent corrects. Cette tranche précède la reprise
CORE06/CCTP A/B sur la pile actuelle avec DPGF réellement importée. La suite
garde les baux retardés, les corrections chiffrées et les passages CCTP non lus,
puis la recette métier/corpus/exploitation. Le goal reste actif et inachevé.
Les anciens résultats d'émission restent datés et ne sont pas requalifiés par
ces trois imports. Le suivi est écrit après la qualification ; un nouveau
build admis sera nécessaire avant la prochaine recette.

### Grande offre : approbation, PDF et copie immuable — 14 octobre 2026

NRPG1004 est qualifié localement sur `u6sOKDiKfkzf4AKkiSB4q` : import canonique de 1004 lignes/1005 items, prix et provenance conservés, PDF de 37 pages, approbation UI liée nativement à la révision 2011, émission puis renvoi du même PDF, identité d'origine conservée après changement du projet et portail anonyme rechargé. Totaux1995450/399090/2394540 centimes ; calcul cryptographique sur toutes les lignes, SHA des171826 octets `6799e235…885d`. Deux scénarios sélectionnés passent ; cinq frères sont filtrés. Les quatre lecteurs émission/sceau sont paginés et contrôlent la version initiale sans adopter une nouvelle intention.

Les vrais PDF ont révélé et permis de corriger les séparateurs de milliers, le chevauchement d'en-tête et les noms longs. Texte exact et rendu échantillonné1/19/36/37 passent. Les CGV restent explicitement un brouillon de sandbox non revu juridiquement, activable seulement sur le profil local borné ; aucune qualification juridique/Internet/production commerciale. L'admin de test réalise une décision explicite via UI selon les droits actuels ; ce cas ne prouve pas une séparation de deux acteurs. Source, approbation, document, sceau et octets sont liés par la clôture `nrpg1004-root-closure-final-20261014-01/closure.json` (`7f69a4fc…760`) et [la recette détaillée](../testing/complete-estimate-item-read.md).

Ordre suivant guidé par le risque : **RCL1004/2004**, sauvegarde réelle des réglages puis principal→sous-traitant→principal, pour exposer le recalcul encore plafonné et comparer toutes les lignes/TVA/footer/provenances. L'audit statique signale un pied fourni au RPC sans rapprochement complet ; une corruption réelle n'est pas encore constatée. Ensuite **OPR1004/2004**, pages propriétaire et impression avec toutes les cellules, pas seulement le footer. Précode prospectif dans `owner-print-read-audit-20261014-01/audit.md`, 20 sources pinées, sans exécution. Puis CORE06/CCTP A/B sur la pile actuelle avec DPGF réellement importée, baux retardés, corrections chiffrées et passages non lus, puis corpus/exploitation/acceptation métier. Les migrations locales nécessaires, préparées/revues/testées sur 45585/33485, sont autorisées par la nouvelle instruction utilisateur ; aucune application supplémentaire n'a été nécessaire ici. La publication et les mutations distantes restent soumises à leur autorisation propre. **Le goal reste actif et inachevé.**

## Grandes DPGF : réglages, consultation et impression — 14 octobre

**RCL1004/2004 et OPR1004/2004 acquis localement après RED réel.** Une sauvegarde de validité réussie tronquait les totaux à1000lignes malgré1005items ; les pages owner/print affichaient999lignes et un pied réduit. Le recalcul et les deux pages réutilisent maintenant le lecteur complet authentifié avec fence de version initiale. Les pages exigent d'abord version accessible et tenant actif identique. Les tokens originaux et calculs restent conservés.

Quatre parcours métier TesterArmy passent : réglages/cycle TVA/reloads sur1004et2004lignes, puis owner/owner-reload/print/print-reload avec toutes les cinq cellules de chaque ligne, section, ordre et pieds exacts. RCL principal =1995450/399090/2394540 et3982950/796590/4779540 centimes ; sous-traitance TVA0 puis retour exact. Lectures natives RCL1004/2004 valident aussi tous les liens raw/mapped/source, prix, taxes, IDs et tokens. Archives indépendantes : `recalc-archive-review-20261014-01` et `owner-print-archive-review-20261014-01`. Builds datés `trnzT7-SiTcOHkm0RbFH9` et `A5KrWV9g3QCYKwBQbDCfB`, deux cas sélectionnés par run dont le login, un sibling filtré, traces/retries0/collector0/sources stables. Lint/typecheck/build/diff-check et cinq tests serveur existants passent ; aucune assertion unitaire nouvelle. Détail : [lecture complète](../testing/complete-estimate-item-read.md). OPR reste une preuve HTML, sans nouvelle qualification PDF ou native d'impression.

**Priorité suivante : sauvegarde atomique des réglages.** La baseline SQL12cas confirme désormais5défaillances, pas seulement un risque statique : ancienne session admise après vraie reprise par le même acteur, pieds incomplets acceptés et marge2 enregistrée sans projections cohérentes des lignes. Les fixtures et mutations sont annulées ; RPC/ACL/identités conservés. Le takeover est séquentiel, aucune course deuxconnexions acquise. Précode `recalc-sql-audit-20261014-01/baseline-03/receipt.json` (`b6f3b92a…`), contrat de travail `settings-atomic-contract-20261014-01/contract.md` (`f875ecfa…`).

Ordre de réalisation : écrire les oracles E2E financiers V1/V2 et adapter les régressions SQL au contrat explicite avant code ; remplacer le RPC par une transaction unique réglages/toutes projections/pied/arrondi avec session, timestamp/révision et dépendances brutes ; supprimer la seconde écriture bulk du hook, mettre à jour contrat HTTP/OpenAPI ; qualifier rollback, reprise de bail, concurrence deuxconnexions, transport et reload ; appliquer la nouvelle migration préparée/revue/testée sur la seule pile locale autorisée. Ensuite poursuivre CORE06/CCTP A/B avec vraie DPGF, sources/corrections/passages non lus, duplication/import complets et les autres parcours métier, puis corpus/exploitation/acceptation/mise en service autorisée. Le backlog initial demeure un repère, pas une limite.

Aucune nouvelle migration nécessaire pour la tranche de lecture terminée. L'autorisation persistante couvre les prochaines migrations locales nécessaires sur45585/33485 ; aucune publication ou mutation distante supplémentaire. Tous les handles de cette tranche sont fermés, keeper intact. Le suivi est écrit après les runs : fresh build requis pour la prochaine recette. **Goal actif, application entière non encore qualifiée.**

## Réglages atomiques et récupération — 14 octobre 2026

La tranche est qualifiée localement sur `qcTohC12RReBayj2t7ZHG` : sept parcours métier TesterArmy (sept logins supplémentaires), 70 cas SQL installés et 15 courses réelles entre deux connexions. Une transaction sauvegarde les réglages, toutes les projections et les quatre montants du pied avec la session et l'intention initiales. Le hook adopte la réponse complète et n'émet plus le second bulk. Après un accusé confirmé puis une lecture indisponible, la récupération conserve une nouvelle quantité ou un titre local et n'émet pas à nouveau une mutation déjà acquittée. La sous-traitance neutralise l'arrondi TVA tout en conservant le réglage historique.

Migration locale `20261014070453_estimate_settings_atomic.sql` appliquée uniquement à 33485 avec conservation des données et droits vérifiée. Synthèse indépendante : `settings-red-archive-review-20261014-01/seven-final-green-summary.json`, SHA `2d752d8c0f887fb33e3bdf5ffdfa04f0db041c21fb5f11c67d554dde3ef4a4cb`. Courses : `settings-atomic-sql-20261014-01/concurrency-closeout.json`, SHA `1f7e94414158502af3d5d70c0048ad8ecf1604da3ecf1349690dc81317187ec3`. Voir [la qualification et ses limites](../testing/estimate-settings-atomic-2026-10-14.md).

La remise exacte en euros reste un défaut connu : saisir 1,01 € devient encore une réduction de 2,00 € dans le cas reproduit. Elle précède désormais la reprise CCTP A/B et la livraison métier. Les anciens tests aux contrats dépassés, la recette V1 de ces réglages et les qualifications corpus/exploitation restent ouverts. La rétro traite les trois copies auxiliaires manquantes et le contrôle de santé trop tardif ; les archives historiques conservent leur réserve. [Le goal candidat](goal-chiffrage-candidate-2026-10-14.md) propose une fin observable : une application complète qualifiée localement et un dossier permettant la recette métier. Il ne remplace pas encore le goal actif de ce chat et ne déclare pas l'application terminée.
