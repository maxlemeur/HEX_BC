# Audit du chiffrage par rapport à la vision produit

Audit du 11 octobre 2026, révision `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`, branche `main`, arbre propre au début de l'inspection. Vision de référence : texte fourni par l'utilisateur, puis arbitrages de cette conversation. Le nom MergeOne est celui de la vision ; le projet Linear existant s'appelle Miaouffrage.

Le logiciel dispose déjà d'un moteur de chiffrage, d'un éditeur, d'imports, de métrés, d'une gestion des prix, de validations et de sorties client. L'écart principal est la continuité entre les exigences du dossier, les prestations réellement couvertes, les ressources chiffrées et les décisions prises. La réalisation doit compléter ces liens et leurs garanties, sans reconstruire les fonctions existantes.

Le [backlog de réalisation](../product/backlog-chiffrage-2026-10-11.md) traduit les écarts en résultats vérifiables. C'est une proposition évolutive : le PO doit réordonner, fusionner ou remplacer les lots lorsque la recette et les besoins réels le justifient. Le backlog Linear historique ne constitue ni la définition du produit ni une preuve de livraison.

## Périmètre et niveau de preuve

L'inspection couvre le code local, les contrats de données, les migrations pertinentes, les tests existants, des artefacts locaux et les contrôles GitHub de la révision auditée. Le projet Linear `P-TI-9` a été lu, sans modification. Aucun nouveau test métier, parcours utilisateur authentifié, changement de permissions, envoi ou écriture sur la base partagée n'a été effectué pendant cet audit.

- **Présent** : une implémentation identifiable existe ; cela ne signifie pas que tous ses usages sont qualifiés.
- **Partiel** : une partie du parcours ou de ses garanties existe, avec un écart précis.
- **En veille** : disponibilité volontairement désactivée.
- **Non retrouvé** : aucune implémentation complète identifiée dans le périmètre de recherche indiqué ; ni preuve d'absence dans les outils externes, ni inspection du schéma distant.
- **Risque statique** : chemin suspect dans le code, à reproduire avant de le qualifier de défaut observé.

Les références `fichier:ligne` ci-dessous portent sur la révision auditée et se périment avec le code. Les résultats CI sont des exécutions antérieures consultées pendant l'audit, pas des tests relancés pour celui-ci.

## Matrice des capacités

| ID | Capacité attendue | Existant vérifié | Écart produit et conséquence |
| --- | --- | --- | --- |
| A01 | Dossier structuré | Intake DPGF, plans, CCTP, BPU, annexes et emails ; classifications ambiguës et erreurs explicites. `src/lib/affaires/intake.ts:36`, `src/lib/affaires/intake-server.ts:124` | Métadonnées et brief ne constituent pas un relevé exhaustif des exigences techniques. La couverture de l'analyse doit être visible. |
| A02 | Référence documentaire décidée | Choix d'un CCTP ou d'une DPGF principal. `src/lib/affaires/intake-server.ts:3230` | Modèle de révision documentaire applicable et gestion des contradictions incomplets. Sans principal, le chemin examiné choisit le plus ancien (`:495`). Déposer une nouvelle pièce ne doit pas changer implicitement la référence. |
| A03 | Exigence → prestation → lignes | Registre avec portée projet, lot, ligne ou exception, document source et décisions. `src/lib/affaires/register.ts:3`, `:226` | Pas de couverture technique complète retrouvée : plusieurs lignes par exigence, inclusion ailleurs, exclusion, autre lot, provisoire et non arbitré doivent être représentés explicitement. |
| A04 | Preuve vérifiable et incertitude | Takeoff avec page, preuve et remplacement ; ouvrages distinguant faits, hypothèses et inférences. `src/lib/takeoff/evidence.ts:295`, `:512` ; `src/lib/estimates/generated-ouvrage-provenance.ts:319` | Sources du brief limitées à document/bloc (`intake-server.ts:148`). Son prompt demande une pièce « proche » en l'absence de source directe (`:1466`) : risque de fausse attribution. |
| A05 | Calculs métier reproductibles | Calculs FO/MO, marge, remises, TVA, arrondis, allocation, snapshots v1/v2. `src/lib/estimate-calculations.ts:243`, `:1215`, `:1418` ; `src/lib/estimate-v2-snapshot.ts:186` | Conserver les moteurs historiques. Les règles commerciales non abouties et les cas d'import/arrondi/MO non qualifiés sont les écarts utiles, pas l'absence d'un moteur. |
| A06 | Travail direct dans une grille | Saisie, collage, opérations groupées, historique, sauvegarde et variantes. `src/components/estimates/components/estimate-editor-row/LineRow.tsx:887` ; `src/hooks/useEstimateEditorItemsController.ts:833` | Qualifier un grand devis réellement éditable, la navigation et la reprise. L'historique est effacé après un batch sauvegardé (`src/hooks/useEstimateEditorSyncController.ts:767`). Le benchmark synthétique en lecture seule ne couvre pas cet usage. |
| A07 | Import et provenance | CSV/XLS/XLSX/PDF tabulaire vers le contrat canonique. `src/app/dashboard/affaires/_actions/import-flow.ts:187`, `:345` ; `src/lib/estimates/canonical-v2-creation.ts:559` | Les scénarios Army DPGF lus portent sur CSV. La preuve doit couvrir les formats réellement promis, les unités, les hiérarchies, les ambiguïtés et les exports. Un PDF scanné n'est pas automatiquement couvert par l'extraction tabulaire. |
| A08 | Ouvrages paramétriques | Assemblages imbriqués, génération ponctuelle, sous-détail revu. `supabase/migrations/20260722132425_nested_estimate_assemblies.sql:456`, `:561` ; `src/lib/estimates/generated-ouvrages.ts:3652` | Insertion par copie de sections/lignes. Instance durable, paramètres, règles de ressources et propagation par réseau/zone non retrouvés. |
| A09 | Coût interne et offre commerciale | Calcul interne et document commercial distincts, mais hiérarchie de lignes partagée. `src/components/EstimateDocument.tsx:241`, `:415` ; `src/lib/estimates/dpgf-export.ts:344` | Pas de correspondance complète retrouvée entre une organisation interne par ressources/zones et une DPGF client indépendante. |
| A10 | Identité des prix | Offres datées, fournisseur, référence, unité, minimum, devise, source ; référence proposée/validée avec empreinte. `src/lib/catalogue/reference-price-server.ts:20`, `:40`, `:54` | Typologie et preuve homogènes à compléter entre prix fournisseur, référence, achat historique et estimation provisoire ; conserver le coût retenu dans chaque version. |
| A11 | Comparaison sur périmètres égaux | Sélection/revue d'offres et contrôles unité, devise, minimum, dates, activité. `src/lib/estimates/supplier-offer-eligibility.ts:9` ; `supplier-preselection.ts:27`, `:76` | Le contrat de comparaison ne porte pas l'ensemble transport, conditionnement, accessoires et prestations incluses. Le prix de référence traite déjà transport inclus/exclu (`reference-price-schemas.ts:3`) : les contrats doivent converger. |
| A12 | Propositions révisables | Structure appliquée par sélection ; ouvrages protégés contre double application et sous-détail périmé. `src/lib/estimates/structure-drafts.ts:2821` ; `generated-ouvrages.ts:3571`, `:3652` | Réutiliser ces mécanismes pour un contrat partagé : source, périmètre, avant/après, hypothèses, révision attendue, acceptation partielle et refus. |
| A13 | Révisions et scénarios | Diff de devis et de métrés, variantes, réouverture du registre. `src/lib/estimates/diff.ts:74`, `:798` ; `src/lib/takeoff/diff.ts:41` ; `src/lib/affaires/register-server.ts:2341` | Relier le changement documentaire aux dépendances métier puis à une proposition de coût/heures. Comparer aussi atelier, pose, transport et faisabilité, pas seulement HT/TTC. |
| A14 | Missions IA contextuelles | Dialogues d'ouvrages et contrôles de brouillon/verrou ; benchmark de métrés. `src/components/estimates/editor/EstimateEditorPage.tsx:269` ; `generated-ouvrages.ts:3530` ; `src/lib/takeoff/benchmark.ts:11` | Mission transversale avec droits, budget, arrêt, résultat vérifiable et résistance aux instructions contenues dans les documents à qualifier. Génération complète V0 en veille (`ai-draft-availability.ts:1`). |
| A15 | Consultation fournisseurs | Catalogue d'offres, pièces jointes et commandes | Workflow complet de demande versionnée, réponses rapprochées et questions sourcées non retrouvé. Une comparaison de tarifs catalogue ne remplit pas cette mission. |
| A16 | Passage en achats | Brouillons groupés par fournisseur, chantier et liens vers version/ligne/prix. `src/lib/estimates/purchase-order-drafts.ts:310`, `:397`, `:604`, `:645` | Quantités décimales refusées (`:150`). Applicabilité non revalidée avec le même contrat que la comparaison ; création séquentielle avec compensation (`:566`, `:667`). À qualifier sous concurrence et panne. |
| A17 | Prévu, vendu, engagé, consommé | Coûts/heures atelier/chantier, commandes et statut de réception. `src/lib/estimate-calculations.ts:819`, `:828` ; `src/components/PurchaseOrderStatusUpdater.tsx:11`, `:52` | Budget chantier figé, réceptions partielles/consommations, heures réelles et causes d'écart non retrouvés comme parcours complet. |
| A18 | Apprentissage validé | Corrections de suggestions avec seuils/revue. `src/lib/estimates/suggestion-learning.ts:40`, `:754` | Ce mécanisme ne remplace pas un retour chantier contextualisé par méthode, accès et cause. Aucun changement global automatique à introduire. |
| A19 | Engagement maîtrisé | Gating, approbation liée à la révision, snapshots, outbox et rapprochement. `src/lib/estimates/gating.ts:44`, `:133` ; `rules-engine.ts:1438`, `:1468` ; `src/lib/email/estimate-email-outbox.ts:666` | Étendre ces garanties aux nouvelles propositions et achats ; éprouver confidentialité et accès inter-tenant dans le parcours réel. Un état d'envoi inconnu doit avoir un traitement opérable. |
| A20 | Exploitation et mesure | Workflows de sauvegarde/reprise ; contrôles CI ; métriques takeoff. `src/lib/workflows/durable-recovery.ts:288` ; `src/lib/takeoff/pilot-metrics.ts:6` | Sauvegarde et reprise échouées lors des dernières exécutions consultées. Le gain humain de la revue complète et les omissions résiduelles ne sont pas établis. |

## Écarts à traiter en premier

1. **Ne pas attribuer une preuve absente.** La règle de source « proche » doit devenir une inférence explicitement non justifiée. C'est un défaut de contrat de confiance, même si l'affirmation se révèle plausible.
2. **Sécuriser la continuité jusqu'à l'achat.** La couverture est calculée avant l'enrichissement des conditions d'offre (`src/lib/estimates/server.ts:5391`, `:5408`) ; le brouillon d'achat vérifie la couverture et la sélection (`purchase-order-drafts.ts:350`) sans appeler le même contrôle d'éligibilité. Reproduire avec offre devenue expirée/inactive/incompatible avant toute correction. Ne pas présenter ce risque statique comme un incident observé.
3. **Rendre l'exploitation récupérable.** Une offre perdue, un envoi incertain ou une absence de sauvegarde annule la valeur des fonctions intelligentes. Les travaux locaux peuvent avancer ; l'activation distante reste une décision explicite de livraison.
4. **Prouver le parcours courant avant d'élargir.** Imports, calculs, sauvegarde et sorties doivent garder les mêmes valeurs. Les critères ne peuvent pas se limiter à un écran affiché ou un fichier téléchargé.
5. **Construire la couverture métier.** Une hypothèse validée n'est pas une prestation couverte. Le modèle doit relier exigences, réseaux/zones, prestations, ressources, lignes commerciales et décisions avec leurs versions.

## Preuves de validation disponibles

État GitHub lu le 11 octobre 2026 sur `ce5874f5` :

| Contrôle | Résultat vérifié | Portée |
| --- | --- | --- |
| [Quality Gate](https://github.com/maxlemeur/HEX_BC/actions/runs/38098000037) | Succès ; étapes lint, types, OpenAPI, dépendances, architecture, tests et build Webpack exécutées | Qualification du dépôt selon ses contrôles actuels ; pas celle de la vision complète. |
| [E2E RLS Matrix](https://github.com/maxlemeur/HEX_BC/actions/runs/38098013576) | Succès ; étape de validation locale de la base exécutée, non ignorée | Garanties couvertes par la matrice courante ; ne prouve pas toute interaction UI inter-tenant. |
| [Playwright critique](https://github.com/maxlemeur/HEX_BC/actions/runs/38098000003) | Succès ; suite et contrôle de confidentialité du rapport exécutés | Suite critique existante, sans extrapolation aux futurs parcours. |
| [TesterArmy anonyme](https://github.com/maxlemeur/HEX_BC/actions/runs/38097999990) | Succès ; `npm run e2e` exécuté et preuves retenues | Navigation/accès public ; aucune preuve métier authentifiée. |
| [Sauvegarde](https://github.com/maxlemeur/HEX_BC/actions/runs/38038672998) | Échec le 10 octobre ; message effectif `Missing secret: SUPABASE_DB_URL` | Dernière exécution inspectée ; une sauvegarde plateforme éventuelle n'a pas été auditée. |
| [Reprise durable](https://github.com/maxlemeur/HEX_BC/actions/runs/38097134928) | Échec le 11 octobre ; message effectif `Missing secret: CRON_SECRET` | Le code de reprise existe. L'autre variable d'URL apparaît dans le script, mais son absence n'a pas été établie par cette exécution interrompue avant ce contrôle. |
| [Playwright nocturne](https://github.com/maxlemeur/HEX_BC/actions/runs/38043040593) | Dernière exécution consultée échouée, sur `61e63d4a` | Cause non diagnostiquée ici ; ne pas l'imputer au HEAD courant. |

Le ruleset GitHub `main-protection` numéro `21017323`, actif et consulté en lecture seule, contient seulement la règle `deletion`. Il n'impose pas les contrôles requis ni le passage par une PR. Les modifier n'est pas autorisé par cet audit.

Preuves locales consultées :

- `.e2e/local-article/fix-verification.json` et archive `runs/2026-10-11T00-10-17-352Z` : association/remplacement cuivre/acier avec unités persistées, rechargées et exportées ; montants exacts `3085/617/3702` puis `6250/1250/7500` centimes. Le reçu rapporte 17 artefacts vérifiés lors de cette exécution ; l'audit ne les a pas tous re-hachés.
- `.e2e/army/critical/runs/2026-10-11T00-12-45-140Z` : filtre association article, deux résultats sélectionnés dont connexion, autres scénarios exclus. Source `b5050726` avec changements locaux ; ce n'est pas un passage intégral du HEAD courant.
- `.e2e/demo-eight-connected/2026-10-09-delivery-FiIxxif8-01a07773/results.json` : dix scénarios rapportés passés, dont sélection fournisseur et persistance. Candidat historique avec changements locaux, pas preuve actuelle de toute la comparaison.

Les suites `generated-ouvrages-subdetail`, `takeoff-dpgf-review`, `takeoff-epics-matrix`, `import-flow-carry-over` et `affaire-recovery-flow` contiennent des scénarios pertinents à réutiliser. Leur lecture ne vaut pas nouvelle exécution. Le legacy `e2e/hex/est-030-supplier-comparison.ps1:95` écrit notamment `PASS (skipped...)` : cet état reste une preuve manquante.

## Réconciliation du backlog historique

[Projet Linear Miaouffrage](https://linear.app/ti-max/project/miaouffrage-34b0b440871a), lecture du 11 octobre 2026 : 17 tickets non archivés retournés, huit `Done`, huit `Backlog`, un `In Review`. Inventaire complet de la réponse, pas estimation de l'avancement du produit. Aucun statut modifié.

| Tickets | État observé | Disposition proposée |
| --- | --- | --- |
| TI-576 à TI-583 | `Done` ; marges, colonnes, références, sélection fournisseur, navigation, veille IA, catalogues | Préserver les acquis et réutiliser les preuves. Ne pas convertir la veille IA en obligation de réactivation globale. |
| TI-532 | `Backlog` ; moteur `down` présent, réglage UI `nearest` (`EstimateSettingsPanel.tsx:565`) | Écart réel à finir : arrondi commercial toujours inférieur, cohérent sur les sorties et sans réécriture des offres émises. |
| TI-534 | `Backlog` ; initialisation `k_fo: 1` observée (`useEstimateEditorItemsController.ts:437`) | Établir les familles et la composition des coefficients ; qualifier les défauts 1,01 et 1,03 sans double provision. |
| TI-541 | `Backlog` ; coût FO de ligne éditable | La saisie d'un prix ne prouve pas le contrat de coefficient de volume distinct et explicable. Compléter et vérifier sa composition avec TI-534. |
| TI-539 | `Backlog` ; natures de ligne et contrôles partiellement présents | Finir article incomplet, distinction manque/zéro et mention explicite POSE SEULE sur les sorties client. |
| TI-535 | `In Review` ; code de validité présent | Qualifier tous les chemins d'écriture et le déploiement autorisé de la contrainte. Ne pas affirmer que la base distante est conforme. |
| TI-536 | `Backlog` ; fiche commune et offres présentes | Compléter quantité de référence, identité par famille et preuves de non-fusion des cas ambigus. |
| TI-537 | `Backlog` ; moteur de proposition/validation présent | Réconcilier contrat, usages, retrait/historique et preuves avant de changer le statut ; ne pas recréer la fonction. |
| TI-538 | `Backlog` | Vérifier puis compléter chaque chemin d'import catalogue : aperçu, cellules vides, doublons, exclusions, historique et erreurs partielles. |
| TI-540 | `Backlog` ; garde responsable présente sur prix de référence | Recette rôle par rôle sur tous les chemins ; aucune attribution de droits à partir d'un nom ou d'un statut de ticket. |

Arbitrages explicites de l'utilisateur pendant cet audit :

1. Un tarif fournisseur expire obligatoirement après **six mois calendaires au maximum**, conformément à TI-535. Une alerte d'ancienneté ne remplace pas cette expiration.
2. Une offre fournisseur à **0 euro est exclue du calcul du prix de référence**, avec demande de clarification. Cela ne change pas le sens de POSE SEULE dans un devis.
3. Le PO doit utiliser son expertise pour atteindre la vision, et ne pas suivre rigidement le backlog existant. Les critères de résultat et les contraintes explicites restent applicables.

## Ce qui ne doit pas être refait

Les unités fonctionnent via le contrat historique `estimate_items.description` ; le dernier correctif protège l'association d'article. Ajouter une colonne `unit` ne constitue pas à lui seul une valeur produit. Undo/redo couvre déjà les modifications de cellules. Les assemblages imbriqués existent. L'insertion d'une main-d'œuvre sans rôle est refusée (`src/lib/estimates/assemblies-server.ts:581`). La marge par tranches est expliquée. Les snapshots, approbations liées aux révisions et journaux doivent être réutilisés.

Les anciennes phrases « CI rouge », « aucun succès RLS » et « unités absentes » ne décrivent plus fidèlement cette révision. Le [delta de dette technique](../AUDIT-DETTE-TECHNIQUE-2026-10-10.md) demeure un historique, avec certaines conclusions remplacées par les vérifications ci-dessus.

## Recherche des capacités non retrouvées

Inventaire par `rg --files src docs e2e supabase/migrations`, puis lectures des modèles et fonctions cités. Les recherches suivantes ont servi à cibler l'inspection ; un résultat vide ne prouve pas à lui seul l'absence d'une capacité sous un autre vocabulaire.

```powershell
rg -n -i 'exigence|requirement|coverage|calorifuge|supportage|document_revision|document_version|baseline' src supabase/migrations e2e
rg -n -i 'commercial.*mapping|commercial.*structure|assembly_instance|quantity_formula|parameter_values' src supabase/migrations
rg -n -i 'rfq|request_for_quote|consultation.*fournisseur|fournisseur.*consultation|initial_budget|actual_cost|actual_hours|timesheet' src/app src/lib src/components src/types/database.ts e2e
rg -n -i 'inter.?tenant|cross.?tenant|tenant B|tenant_b|otherTenant' e2e/army/critical e2e/estimates
```

Pour les exigences, la conclusion repose sur les champs réels du registre et du brief. Pour les ouvrages, elle repose sur la matérialisation section/lignes. Pour les achats et le chantier, elle repose sur les contrats de brouillon et de réception examinés. Aucun audit exhaustif d'outils tiers, de branches alternatives ou des données de production n'est revendiqué.

## Conclusion produit

La première démonstration utile doit partir d'un dossier CVC/plomberie et d'une DPGF existante, montrer une couverture technique sourcée, permettre un arbitrage puis produire une version cohérente. Le calorifuge est le premier cas de qualification ; il ne limite pas l'ambition finale aux seules exigences de calorifuge.

La suite reliera les ouvrages paramétriques, les périmètres fournisseurs, les changements documentaires et les conséquences chantier. L'achèvement sera jugé sur ces parcours exécutés, leurs valeurs persistées, leur confidentialité, leur récupération et leur utilité pour un chiffreur, conformément au backlog évolutif associé.
