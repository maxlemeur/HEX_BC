# Périmètre de livraison TI-576 à TI-583

État de préparation au 9 octobre 2026. Ce dossier propose les contenus à relire ;
il ne constitue pas une liste de fichiers à indexer intégralement. Le dépôt sur
`main`, révision `b3b319493304530a6f19533bd1e592cd5ef53fbe`, contient des travaux
préexistants et concurrents. Aucun code applicatif, harness, index Git, serveur,
compte ou base n'a été modifié par cet audit.

Le suivi fonctionnel et les validations détaillées restent dans
[demo-eight-implementation.md](demo-eight-implementation.md). Le root possède
la sécurisation du build décrite dans [demo-eight-delivery.md](demo-eight-delivery.md).
Les preuves connectées du 7 octobre portent sur les candidats indiqués plus
bas ; elles ne qualifient pas automatiquement un nouveau contenu de commit.

Le 9 octobre, le candidat final `FiIxxif8eGavkGaAtLxRW` passe le build canonique,
ses cinq budgets inchangés, le smoke de production et les dix cas connectés
sélectionnés. Cinquante fixtures ARMY sont conservées ; trente sources surveillées
et le BUILD_ID sont stables, sans erreur de page métier. La suite conservée passe
434 fichiers / 2 701 tests, avec un fichier et deux tests ignorés. Ces preuves
qualifient ce checkout/candidat ; elles ne prouvent pas encore l'autonomie d'une
extraction de hunks par rapport à HEAD.

Index de preuve final :
`.codex-tmp/demo-eight-delivery-20261009/delivery-evidence-index.json`.
Captures disponibles : `visual-review-bareme/marge-bareme-detail-final.png`,
`visual-review/tableau-colonnes-final.png`, et `comparaison-alpha-beta.png` du
run connecté de ce candidat. Le root fournit le trajet CSV/DPGF sur son runtime
séparé ; aucune validation de toute la campagne ARMY n'en est déduite.

## Méthode et manifeste local

Trois états sont comparés : `HEAD`, les copies initiales de
`.codex-tmp/demo-eight-20261002-01a07773/files`, puis les fichiers actuels.
Les 70 copies correspondent toutes à `initial-hashes.json`. Un changement
postérieur à ce snapshot n'est pas, à lui seul, une preuve d'auteur ou de ticket.
Les rapports `catalogue-report.md`, `columns-report.md`, `margins-report.md` et
les journaux de revue complètent l'attribution.

Le dossier `.codex-tmp/demo-eight-delivery-20261009/` conserve :

- `catalogue-delivery-attribution.json` : chemin, SHA-256 actuel/HEAD/backup,
  attribution, hunks retenus ou exclus, dépendances nouvelles et dérive constatée.
- `catalogue-delivery-paths.tsv` : vue compacte des décisions par chemin.
- `catalogue-path-diffs/` : diffs HEAD et snapshot, avec numéros et empreintes de
  hunks ; le patch initial est conservé lorsqu'il existe.
- `catalogue-delivery-summary.json` et `catalogue-initial-status.log` : contexte
  de la mesure. Les scripts locaux permettent de refaire l'inventaire en lecture seule.

Le premier relevé comprend 168 chemins, dont 44 identiques au backup initial
et 26 avec un delta préexistant puis un delta ultérieur. Le manifeste conserve
les incertitudes : `review-attribution`, suites de tests mixtes et contributions
de livraison encore en cours. Les différences CRLF/LF sont neutralisées pour
la comparaison logique, tandis que les empreintes portent sur les octets réels.
Tous les champs `includeWholeFile` restent faux : la sélection exacte appartient
à la préparation du root, après résolution des dépendances et nouvelle mesure.

## Contenu fonctionnel proposé

| Lot | Contenu attribué | Raccords à conserver ensemble |
| --- | --- | --- |
| TI-576 | Retirer le choix cascade, expliquer un coefficient unique choisi selon le coût total HT, rendre le barème paramétrable ; conserver les remises historiques en lecture seule | `EstimateSettingsPanel`, `MarginTiersManager`, `MarginTiersExplanation`, wizard, drawer, calcul/state et projection globale du serveur |
| TI-577 | Visibilité, ordre dans les groupes et largeur des colonnes par compte, reset ; K FO, Marque et Fournisseur | Hooks de préférences, contexte et contrôles d'ordre, grille/en-têtes/lignes/pied et navigation clavier |
| TI-578 | Référence interne libre, suggestion adoptable, allocation définitive si vide ; conflits explicites | `ProductReferenceSuggestion`, formulaire et retour de création, endpoint suggestion, `product-writes`, types, OpenAPI et migration d'allocation |
| TI-579 | Liste compacte, édition d'une seule offre avec SKU/URL/prix/transport, source retenue claire et conditions d'applicabilité | Formulaire/liste, `update-offer`, RPC atomique, comparaison/DTO/parseur, données du fournisseur retenu, hooks de sélection et de proposition |
| TI-580 | Attendre les écritures avant de reprendre la destination ; conserver les saisies en cas d'échec | Guard, sync/state, sauvegarde des paramètres, bail/CAS et flush de navigation existants |
| TI-581 | Libérer le défilement/inertie seulement après fermeture de la dernière modale | Verrou compté du `Modal` ; trajet Retour au produit préexistant conservé |
| TI-582 | Masquer les entrées V0 et leurs chargements automatiques, y compris l'ancien lien | Disponibilité IA, contrôleur/dialogue, toolbar, hub, modèle de parcours, cockpit et lecture serveur ; autres outils IA conservés |
| TI-583 | Préparation de dix métiers et pilote plomberie de douze articles sans prix inventé | Document et CSV, prévisualisation ; validation métier et import partagé différés |

Le correctif du fil d'Ariane appartient à l'intégration du tableau : un espace
permanent d'une ligne empêche son déplacement entre mousedown et mouseup.
La régression existante précédait ce correctif ; le clic simple et son focus
restent stricts, sans interaction de secours.

## Fichiers mixtes à traiter par contenu

Les numéros ci-dessous se réfèrent aux diffs **snapshot → actuel** de l'inventaire,
pas aux numéros de hunks HEAD. Ils sont valides seulement pour les empreintes du
manifeste ; un changement de source impose de refaire cette correspondance.

| Fichier | Partie du lot démontrée | Partie à conserver hors attribution automatique |
| --- | --- | --- |
| `src/lib/estimates/server.ts` | Hunks 1/8 : veille IA ; 2/13–18 : projection tiered de tout le devis ; 3–7/9–12 : conditions et source fournisseur | Modifications de projet/client déjà présentes au départ ; aucun droit sur tout le diff HEAD |
| `src/components/estimates/EstimateEditorTable.tsx` | Hunk 2 : conditions perdues par le parseur ; 12/17/18/21 : fournisseur ; reste du delta snapshot : ordre, colonnes, contexte et spans | Sélection de type/article et autres adaptations de lignes déjà présentes |
| `src/hooks/useEstimateEditorState.impl.tsx` | 1/2/8–12 : rôle admin/coefficient/palier ; 3–7 : sauvegarde de paramètres et attente navigation | Normalisation et intégration de types préexistantes |
| `src/components/estimates/editor/EstimateEditorDrawer.tsx` | Coefficient figé, barème accessible et lecture seule pendant sauvegarde ; hunk 3 mélange TI-576 et TI-580 | Confirmation de fermeture préexistante ; ne pas découper le hunk 3 aveuglément |
| `src/components/estimates/components/EstimateEditorRow.tsx`, `LineRow.tsx`, `StandardMoCells.tsx`, `LaborSplitCells.tsx` | Ordre des cellules et affichage fournisseur du delta snapshot | Types d'article et fonctionnement MO/split antérieurs ; aucun patch spéculatif du pointeur à réintroduire |
| `src/components/catalogue/PricesManager.tsx` | Sept hunks : action unique, lookup ciblée, un seul formulaire d'offre | Prix de référence et autres intégrations préexistantes ; aucune suppression séparée de `PriceFormModal` revendiquée |
| `src/components/catalogue/prices-manager/SupplierOfferFormModal.tsx` | Treize hunks : référence proposée, metadata/tarif/transport atomiques et affichage | Formulaire et logique antérieurs déjà présents dans le snapshot |
| `src/app/dashboard/products/ProductFormModal.tsx` | Deux hunks de suggestion de référence | Retrait/prix de référence issus du travail antérieur |
| `src/app/dashboard/products/page.tsx` | Hunks 1/2 : acquittement de création avec référence | Hunk 3 : texte de politique du prix de référence, frontière TI-537 à attribuer séparément |
| `src/lib/catalogue/server.ts`, `product-writes.ts`, `schemas.ts` | Enrichissement transport borné aux IDs visibles, RPC d'offre, suggestion/conflits et schéma `update-offer` | Validité et validation du prix de référence préexistantes |
| `src/types/database.ts` | Un hunk ajoute les deux fonctions `suggest_product_reference`/`update_supplier_offer` | Autres types/RPC préexistants ; les deux fonctions sont à séparer à l'intérieur du hunk si deux commits distincts |
| `src/lib/estimates/client.ts` | Hunk HEAD 2 : type `selected_supplier_details` | HEAD 1/3/4/5 : factorisation de devise ; HEAD 6 : compatibilité `project_client_name`, hors lot |
| `src/lib/openapi/registry.ts`, `openapi.json` | Source fournisseur, conditions, quantité/unité et GET de suggestion | Routes/schémas du prix de référence préexistants ; artefact à régénérer sur le contenu préparé exact |
| `supabase/migrations.manifest.json` | Les cinq migrations nommées ci-dessous | Entrées déjà présentes ; ne pas indexer tout le hunk comme cinq nouveaux tickets |
| `src/components/affaires/AffaireHub.tsx` | Import/disponibilité et garde V0 de TI-582 | Données client préexistantes ; chargement dynamique de l'import ajouté le 9 octobre par le root, à isoler via son `.before` |
| Suites `.test.ts(x)` | Régressions historiques comme preuves, sans sélection de suite mixte | Attribution finale : vingt suites exclues ; `catalogue/server.test.ts` et `estimates/server.coverage.test.ts` restent hors patch |

Les fichiers suivis sans copie initiale individuelle sont signalés dans le
manifeste. L'absence d'un delta dans `initial-tracked.patch` et la mention d'un
fichier dans un journal aident la revue ; elles ne prouvent pas l'appartenance de
tous les changements ultérieurs.

L'attribution finale du chat tests est dans
`test-integrity-attribution-20261009T091247Z.json`, SHA-256
`006f55c2b526c793fad60f624793e4ce58f8b5c25ea920c737b446a39f1c18ab`.
Les trois runners sont entièrement nouveaux et leurs hashes concordent : MO et
AID sont proposés comme compagnons TI-576 séparés ; duplication reste un lot
transversal. Les vingt suites mixtes sont exclues (six pruning seul, neuf
protégées/concurrentes, cinq créations concurrentes hors baseline). Cette
attribution n'accorde ni fichier entier, ni staging, ni application SQL.

## Dépendances et contributions de livraison

Le commit du lot ne doit pas absorber implicitement le travail TI-537.
`price-validity.ts` est absent de HEAD mais présent dans le backup : les schémas,
le serveur et le formulaire d'offre actuels l'importent. `ProductReferencePricePanel`
et les modules `reference-price-*`, eux aussi préexistants et non suivis, sont
importés par les écrans actuels et le registre OpenAPI. Leur présence dans le
checkout testé n'en fait pas des créations de ces huit tickets. Il faut soit
livrer les prérequis nécessaires séparément avec attribution explicite, soit
préparer une extraction qui compile réellement sans les absorber. Le manifeste
liste ces imports vers des fichiers absents de HEAD.

Les autres prérequis à trancher concernent les types/lignes MO déjà modifiés,
les métadonnées fournisseur et les trois migrations antérieures consignées dans
le snapshot. Ne pas appliquer de SQL pour résoudre le contenu d'un commit.

Contributions nouvelles de la phase du 9 octobre :

- Root : seulement `scripts.build` de `package.json` passe à `next build --webpack`
  en gardant OpenAPI et budgets. Les dépendances et le lock restent hors de ce hunk.
- Root : raccord de `src/test/production-build-smoke.ts` au script composite,
  sans lui transmettre un second `--webpack` après l'étape de build. Ce hunk est
  distinct des autres changements de harness/test déjà présents.
- Root : même raccord pour le seul `buildCommand` de `vercel.json`, désormais
  `npm run build`. Cette modification de configuration n'est pas un déploiement.
- Chat tests : lecteur du manifeste et couverture de `src/test/performance-budgets*`.
  Les plafonds de performance restent inchangés ; résultat final à fournir par ce chat.
- Root : chargement dynamique de `UnifiedImportFlow` dans `AffaireHub`, au même
  emplacement, avec props/callbacks conservés. L'essai concernant `LaunchMetreDialog`
  a été retiré. Baseline spécifique :
  `.codex-tmp/demo-eight-delivery-20261009/AffaireHub.tsx.before`. Rejeu CSV/DPGF
  complet et mesure du vrai build attendus ; aucune modification du contrat import.
- Root : chargement dynamique de `TakeoffApplyWizard` dans `TakeoffReviewPage`,
  rendu quand `applyWizardOpen`, props identiques et import de type préservé.
  Comparaison séparée à `TakeoffReviewPage.tsx.before` ; contrôles de budget et
  de comportement attendus avant gel.

L'essai d'extraction de `hasBlockingAnomaly` vers les guards a été abandonné après
une mesure sans gain utile. Ses trois hunks ont été retirés par le root ; cette
tentative ne doit pas apparaître dans le commit. La nouvelle contribution lazy
de `TakeoffReviewPage` est distincte ; `TakeoffReviewTable` et `guards` sont exclus.
La réparation native de Turbopack n'est pas revendiquée.

Restent hors sélection automatique : `AGENTS.md`, `.gitignore`, `package-lock.json`,
`next.config.ts`, auth/login/signup, suppressions/refonte de tests, deslop,
import/parser/DPGF hors de ces raccords, détails client/documents, `outputs/`,
`design-qa.md`, caches et sessions. Les preuves `.e2e`/`.codex-tmp` restent locales ;
seuls les scénarios et documents relus sont des candidats de code.

## Migrations déjà activées à conserver

| Fichier local | Objet | Historique distant consigné |
| --- | --- | --- |
| `20261002155954_product_internal_reference_auto.sql` | TI-578 | `20261002174113` |
| `20261002160807_supplier_offer_atomic_edit.sql` | TI-579 | `20261002174118` |
| `20261002175735_fix_estimate_duplication_parameter_qualification.sql` | Intégrité de duplication | `20261002182830` |
| `20261006210154_restore_bulk_estimate_labor_split.sql` | Entrées MO du bulk tiered | `20261007055010` |
| `20261007062228_restore_bulk_estimate_aid.sql` | AID conservé par le bulk | `20261007184209` |

La correspondance fichier/historique doit suivre les preuves d'activation, sans
renommer les fichiers, rejouer les migrations ou aligner l'historique. Cet audit
ne relit pas la base distante et ne transforme pas ces informations consignées
en vérification de son état actuel.

## Séparation de commits proposée

La sélection concrète est dans
`.codex-tmp/demo-eight-delivery-20261009/commit-plan.json` : lots, chemins,
numéros/empreintes des hunks retenus, empreinte du contenu projeté et exclusions.
Les patches `task-only-*.patch` sont préparés contre les copies du snapshot ou
contre HEAD lorsqu'aucun delta initial suivi n'existait. Ils **ne sont pas un
commit autonome HEAD validé** : leurs prérequis et les changements de livraison
du root restent à réunir. Aucun de ces patches n'a été appliqué à l'index.

Sélection concrète : **90 chemins / 307 hunks**, avec vérification en mémoire de
tous les contextes avant/après. Les deltas du root du 9 octobre restent dans
`delivery-oct09.patch` (9 chemins / 17 hunks), sans double compte du Hub ou des
sources surveillées ajoutées au helper.

| Patch local | Chemins | SHA-256 |
| --- | --- | --- |
| `task-only-catalogue.patch` | 16 | `59cdc56575ce78523e1f840f80610e3abc81d09dc4f772af699c86a559e094b3` |
| `task-only-chiffrage.patch` | 40 | `6bcf62d1beeb0adcb0f21f604207f3f46fe031d68d63fc54268267474cd75a73` |
| `task-only-preuves.patch` | 23 | `8f1d8a27a5951e3343371a92a66ea63c1c7ba015fb5305f886040d1f268a6354` |
| `task-only-integrite.patch` | 5 | `a5dfc4484151dabdca715cafeecf11bfc8fa40ec612769dc08bd580c1fffaf5c` |
| `task-only-metiers.patch` | 2 | `ea0dd39611223decd82a140c03a9547496d624e2ad8d36a86e7cdf845582f873` |
| `task-only-compagnons-integrite.patch` | 2 | `29ad59a194d1df9450e056615fa50fb8293141fbe22c6d239eab7b8238a5e903` |
| `task-only-transversal-duplication.patch` | 2 | `9d26967ea3548d6e27a13930d66edb225483c4417aa6112d63ba1f4b1d16d0cf` |

Chaque patch est une proposition de revue sur sa base déclarée. La projection
ne constitue pas un build ou une qualification d'un arbre HEAD autonome.

Préparer d'abord les dépendances identifiées ; aucun commit ci-dessous n'est
autonome tant qu'il dépend de changements non inclus provenant du checkout sale.

1. **Livraison/build** : hunk Webpack, lecteur de manifeste et chargement différé
   du flux d'import. Revue spécifique des budgets et reprise des parcours import.
2. **Catalogue TI-578/TI-579/TI-581** : référence interne, offre atomique/liste,
   verrou de modales, leurs types/route/OpenAPI/SQL et preuves pertinentes.
3. **Chiffrage TI-576/TI-577/TI-579/TI-580/TI-582** : marges, colonnes, offre retenue,
   navigation, veille V0 et correctif du breadcrumb. Ces raccords partagent
   tableau/state/serveur ; les garder cohérents vaut mieux qu'un découpage par ticket
   qui laisse des props/types/calculs incomplets. Inclure les corrections d'intégrité
   MO/AID/duplication avec leurs preuves, ou les isoler en prérequis relus.
4. **TI-583** : document de métiers, pilote CSV et couverture conservée après
   avis du propriétaire des tests. Il s'agit d'une préparation, pas d'un import livré.
5. **Recettes et dossier de livraison** : harness connecté/local et documentation
   associés au contenu exact de la série ; les artefacts locaux ne sont pas commités.

Les suites mixtes peuvent rester dans un commit séparé du chat tests. Les types
et OpenAPI demandent une régénération/revue sur la série exacte. Une validation
faite avec des modules non inclus dans cette série ne prouve pas son autonomie.

## Preuves existantes à conserver séparées

| Preuve locale | Résultat et limite |
| --- | --- |
| `.e2e/demo-eight-connected/2026-10-07-catalogue-1791352322732-ef0dff0c/` | Candidat C9 : références/concurrence et édition/défilement passent ; troisième test rouge sur conditions, aucune campagne 3/3 revendiquée |
| `.e2e/demo-eight-connected/2026-10-07-catalogue-conditions-1791353505840-5e4c18ff/` | Candidat fR3 : seul cas fournisseur passé après correction des conditions |
| `.e2e/demo-eight-connected/2026-10-07-catalogue-breadcrumb-1791355343539-af3d0ef9/` | Candidat hNy : cas fournisseur 1/1 en 70,8 s ; premier clic, sortie sans Ctrl+S, coût indépendant, trois incompatibilités ; 20 sources/build surveillés stables |
| `.e2e/demo-eight-connected/2026-10-07-breadcrumb-parameters-01a07773/` | hNy : six paramètres/colonnes passent ; snapshots figés synthétiques, un compte connecté, split MO désactivé |
| `.e2e/demo-eight-connected/2026-10-07-aid-activated-batch-navigation-01a07773/` | hNy : 1/1, AID HTTP puis menu/navigation/rechargement ; fixture à coût zéro, cadence autosave de 60 s non prouvée |
| `.e2e/army/critical/runs/2026-10-07T06-48-23-982Z/` | Runtime distinct Webpack dev 3107 : connexion/duplication sélectionnées passent, sources stables ; huit cas hors filtre, pas une campagne entière |
| `.codex-tmp/demo-eight-20261002-01a07773/plomberie-previsualisation.png` | Douze articles reconnus, zéro rejet ; import annulé, aucun usage métier ou abonnement démontré |

Les traces authentifiées et exports de session restent désactivés. Les manifestes
conservent commande, révision sale, environnement, identités ARMY et attendu/réel.
Les preuves d'erreur précédentes restent rouges ou partielles. Pour la livraison,
le root doit qualifier le nouveau candidat compilé et ses limites, pas réutiliser
les seules réussites historiques comme résultat de cette préparation.

## Recette humaine visuelle courte

Utiliser le candidat annoncé et un tenant/jeu de démonstration autorisé. Garder
les références des nouvelles fixtures ; aucune affaire réelle n'est nécessaire.

| Point | Geste humain | Résultat à observer |
| --- | --- | --- |
| Marges | Ouvrir les paramètres, lire l'explication, modifier un seuil de démonstration et faire franchir ce seuil dans les deux sens | Cascade absente des choix neufs ; coût/base et coefficient unique compréhensibles ; barème retrouvé, lignes et pied cohérents après retour/rechargement |
| Colonnes | Afficher K FO/Marque/Fournisseur, déplacer une colonne, changer une largeur ; recharger, ouvrir un autre devis du compte, puis réinitialiser | En-tête/lignes/pied alignés ; réglages personnels retrouvés sur ce navigateur ; montant et données inchangés |
| Références | Créer un article avec référence manuelle puis un avec champ vide ; regarder la suggestion avant création et la référence au retour | Champ libre conservé ; aide « auto si vide » lisible ; suggestion provisoire distincte de l'allocation finale ; référence retrouvée à réouverture |
| Offres | Ouvrir une offre ciblée, changer prix/SKU/URL/transport puis rouvrir ; dans le devis comparer deux fournisseurs et retenir l'autre | Informations compactes et distinctes ; autre offre/prix de référence inchangés ; fournisseur/coût retenus explicites ; motifs et bouton désactivé pour unité/minimum/validité incompatibles |
| Navigation et défilement | Modifier une quantité au premier clic simple, quitter sans Ctrl+S et revenir ; depuis les tarifs utiliser Retour au produit, fermer la modale, puis la roulette | Saisie/sauvegarde conservées, destination reprise ; tableau immobile pendant le clic ; toute la page défile à nouveau |
| IA et métiers | Regarder menu/hub et ancien lien `openVersionZero=1` ; prévisualiser le CSV plomberie sans le soumettre | V0 ne s'ouvre pas et n'est pas proposée ; chiffrage manuel disponible ; douze lignes reconnues, import réservé à une décision ultérieure |

Pour chaque point, le root fournira une capture métier du **candidat final**,
avec BUILD_ID et fixture dans son manifeste : barème/coefficient et pied,
colonnes personnalisées, référence finale, offre retenue/comparaison incompatible,
retour produit/défilement et menu V0 absent. Les captures du 7 octobre sont des
repères historiques, pas des captures de la livraison du 9 octobre. Ne pas joindre
de page de connexion, session ou trace authentifiée.

## Décisions et limites avant publication

- Décider la livraison séparée des prérequis nommés TI-537/validité, types/MO et
  auth/outillage, ou qualifier une extraction qui n'en dépend plus ; attribuer
  le texte du prix de référence à TI-537. Les suites mixtes restent exclues et
  l'attribution des trois runners est résolue.
- Rafraîchir les hashes après gel du root/tests, examiner les hunks sélectionnés,
  puis valider ce contenu précis : build/budgets, types, lint, tests conservés
  pertinents et parcours connectés réellement exécutés.
- Les préférences sont locales au navigateur et par compte : synchronisation
  inter-appareils non livrée. Deux comptes réels, non-admin connecté, document
  réellement figé et calcul MO split activé restent des limites de recette,
  distinctes des contrôles synthétiques/SQL existants.
- Le wizard takeoff différé n'a pas de preuve positive de chargement à froid et
  de focus sur ce candidat. La sonde s'est arrêtée sur une page introuvable,
  sans GET synthétique ; ce n'est pas un test du wizard. La recette humaine du
  root doit conserver cette limite ou qualifier le trajet sur un job autorisé,
  sans activer de flag partagé.
- La suppression/archivage du prix de référence relève du ticket TI-537 existant ;
  ne pas la présenter comme une nouvelle fonctionnalité des huit tickets.
- TI-583 attend un référent métier, la validation du contenu et des responsables
  de maintenance avant généralisation ; aucun classement de probabilité d'achat
  ni import partagé n'est établi.
- Présenter enfin le résultat concret à relire et les preuves au propriétaire
  avant toute décision de publication. Ce dossier n'accorde ni commit, ni push,
  ni déploiement, ni nouvelle migration.
