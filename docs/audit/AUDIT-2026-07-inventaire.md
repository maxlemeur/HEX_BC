# Audit produit du 2026-07-23 — inventaire versionné

> **Pourquoi ce fichier existe.** L'audit (27 bugs vérifiés + 73 constats UX/UI par
> persona) ne vivait que dans un artefact externe. Tant qu'il n'était pas dans le
> dépôt, « finir l'audit UX/UI » n'était pas mesurable et une perte d'accès
> aurait effacé le travail. Rapatrié le 2026-07-25.
>
> Source : `https://claude.ai/code/artifact/91124126-27a6-4450-ac6d-b9b7745b0403`
>
> Source canonique reproductible : `docs/audit/AUDIT-2026-07-source.normalized.json`.
> Il s'agit d'une normalisation fidèle du ledger publié, **pas de l'HTML brut**
> de l'artefact externe, qui n'est pas disponible dans le dépôt.
>
> **Statut du rapprochement.** Les **27 bugs** et **24 des 73 constats UX/UI**
> ont été rapprochés du code AU HEAD : la référence de l'audit a été rouverte,
> et le statut dit si le défaut est encore là, ou quel commit l'a corrigé.
> Les 49 autres portent un statut qui dit exactement ce qu'il vaut — non
> rouverts, aucun correctif livré ne les vise. Ce n'est pas une preuve qu'ils
> soient ouverts, seulement que personne n'a vérifié. Voir §3.

Généré depuis l'artefact : **27 bugs**, **73 constats UX/UI**.

---

## 1. Bugs vérifiés

| ID | Gravité | Domaine | Emplacement | Constat | Statut |
|---|---|---|---|---|---|
| B01 | critique | Moteur de calcul (prix, marges, TVA, ma… | `src/lib/estimate-calculations.ts:143` | capCents() tronque silencieusement toute valeur à 21 474 836,47 € (int32) — devis > ~21,5 M€ HT sous-évalués | partiel (`6cba58d`) — l'écrêtage est signalé au TOTAL, pas au niveau LIGNE |
| B02 | critique | Assemblages / ouvrages / gabarits | `supabase/migrations/20260722132425_nested_estimate_assemblies.sql:578` | L'insertion d'un ouvrage perd tout le coût de main-d'œuvre des lignes 'labor' sans rôle (ou à rôle invalide) → ligne à 0 € | livré (`91b9906`) |
| B03 | critique | Prix / catalogue / tarifs / fournisseur… | `src/lib/estimates/server.ts:1651` | La préselection fournisseur injecte un prix en devise étrangère tel quel dans unit_price_ht_cents (EUR) sans conversion | livré (`5d21030` préselection + `7977a53` sélection manuelle) |
| B04 | critique | Versions, création, paramètres, diff/ch… | `src/lib/estimates/client.ts:3827` | Nouvelle version d'une affaire : la marge héritée est écrasée à 1.0 (0% de marge) | livré (`12550bc`) |
| B05 | haut | Éditeur de devis (tableur) | `src/components/estimates/components/estimate-editor-row/shared.ts:268` | Vider une cellule K FO ou K MO enregistre 0 (au lieu du défaut 1), annulant le coût FO/MO de la ligne | livré (`1a58046`) |
| B06 | haut | Moteur de calcul (prix, marges, TVA, ma… | `src/lib/estimates/export-stream.ts:229` | Export XLSX: la colonne "Total HT" des lignes ne se reconcilie jamais avec le "Total HT" du resume (remise + coefficient global ignores) | traité (lot correctif 2026-07-27) — lignes et Résumé XLSX réconciliés sans bascule forcée du moteur |
| B07 | haut | Moteur de calcul (prix, marges, TVA, ma… | `src/lib/estimate-calculations.ts:881` | Les totaux de section ignorent le coefficient global: les sections ne se somment pas au total et la remise proportionnelle est sur-allouee | corrigé en moteur v2 (`8092b29`, `966db09`) mais **le gate n'est pas basculé** |
| B08 | haut | Exports (DPGF, BDC, PDF) | `src/lib/estimates/pdf-generator.tsx:1753` | Le PDF force isLaborSplitEnabled:false : colonnes MO HT à 0 et FO HT gonflé, divergence avec l'aperçu écran/portail | livré (`ee5b242`) |
| B09 | haut | Assemblages / ouvrages / gabarits | `supabase/migrations/20260722132425_nested_estimate_assemblies.sql:590` | Lignes d'ouvrage insérées persistées et affichées avec montant HT et PU = 0 (aucune renormalisation après matérialisation) | livré (`26332ba`) |
| B10 | haut | Métré / takeoff (plans, extraction, réc… | `src/lib/takeoff/server.ts:7744` | Application takeoff non atomique : les transformations de mapping (prix/renommage/catégorie/ouvrages) après le RPC ne sont pas rollbackées et bloquen… | partiel (`b12b277`) — l'application partielle est signalée, sans rollback |
| B11 | haut | Workflow: validation, verrouillage, sce… | `src/lib/estimates/server.ts:1950` | Le scellement (seal) n'inclut PAS les colonnes main-d'oeuvre atelier/chantier : intégrité falsement garantie | livré (`b74a0c8`, corrigé ensuite par `b27b290` qui invalidait tous les sceaux) |
| B12 | haut | Prix / catalogue / tarifs / fournisseur… | `src/lib/estimates/server.ts:1168` | Le classement 'meilleur prix' compare des montants de devises différentes sans conversion | à traiter — T3(a), classement encore multi-devises |
| B13 | haut | Prix / catalogue / tarifs / fournisseur… | `src/app/api/purchase-orders/route.ts:120` | Les bons de commande manuels arrondissent la quantité à l'entier (Math.round), au lieu de la rejeter comme le fait la génération de brouillon | livré (`1d7ae68`) |
| B14 | haut | Versions, création, paramètres, diff/ch… | `src/components/estimates/EstimateDiffView.tsx:263` | Le diff affiche 'Aucun changement' alors que le Total HT/TTC diffère (remise/coefficient/arrondi globaux) | livré (`c211dbb`) |
| B15 | moyen | Éditeur de devis (tableur) | `src/components/estimates/components/estimate-editor-row/LineRow.tsx:625` | La cellule Quantité est un input type=number : la virgule décimale (pavé numérique FR) est bloquée/perdue | livré (`ec13f18`) |
| B16 | moyen | Moteur de calcul (prix, marges, TVA, ma… | `src/lib/estimates/pdf-generator.tsx:1708` | Les totaux globaux (pages serveur + PDF) sont calcules sans passer isLaborSplitEnabled, contredisant le detail par section/ligne | livré (`ee5b242`) |
| B17 | moyen | Exports (DPGF, BDC, PDF) | `src/lib/estimates/export-stream.ts:229` | Export XLSX standard: le 'Total HT' par ligne ignore le coefficient global et la remise -> ne somme pas au Total HT du Résumé | traité (lot correctif 2026-07-27) — coefficient, remise et arrondi TTC répartis sur les lignes exportées |
| B18 | moyen | Métré / takeoff (plans, extraction, réc… | `src/lib/takeoff/dpgf-compare.ts:809` | Le rapprochement automatique DPGF glouton attribue le meilleur item de métré à la première ligne DPGF traitée, privant une ligne ultérieure mieux app… | livré (`e905d6d`) |
| B19 | moyen | Métré / takeoff (plans, extraction, réc… | `src/lib/takeoff/server.ts:6606` | La reprise manuelle du reconcile ne réinitialise pas le compteur de tentatives : un job batch en timeout ne peut pas être relancé et re-échoue immédi… | livré (`6c5b5cc`) |
| B20 | moyen | Workflow: validation, verrouillage, sce… | `src/lib/estimates/server.ts:7780` | patchEstimateStatus ne vérifie pas le rôle d'écriture : transition de statut via RPC service-role contourne la RLS admin/engineer | livré (`a4d87c5`, étendu par `6b3521f` à patchEstimateVersion et duplicate) |
| B21 | moyen | Versions, création, paramètres, diff/ch… | `src/components/estimates/estimate-creation-wizard/submitEstimateCreation.ts:76` | Nouvelle version : TVA et devise héritées écrasées par les défauts de l'assistant (20% / EUR) | à traiter — T1b |
| B22 | moyen | Versions, création, paramètres, diff/ch… | `src/components/estimates/estimate-creation-wizard/submitEstimateCreation.ts:28` | Création depuis un template : marge/TVA/devise/arrondi saisis à l'étape Paramètres sont ignorés | à traiter — T1b, sous-partie template |
| B23 | bas | Exports (DPGF, BDC, PDF) | `src/lib/estimates/export-stream.ts:165` | Export XLSX Résumé: 'Remise' faux (souvent 0) quand global_coefficient != 1 | livré (`3c529ee`) |
| B24 | bas | Prix / catalogue / tarifs / fournisseur… | `src/components/estimates/SupplierComparisonPanel.tsx:166` | Le panneau de comparaison affiche tous les prix avec le symbole € puis recolle le code devise | livré (`30a8b85`) |
| B25 | haut | Éditeur de devis (tableur) | `src/lib/estimates/clipboard.ts:307` | Collage : un nombre à 3 décimales (virgule ou point) est interprété comme séparateur de milliers → valeur ×1000 | livré (`976f23f`) |
| B26 | haut | Éditeur de devis (tableur) | `src/lib/money.ts:63` | Cellule Prix unitaire : saisir "2.500" (point + 3 décimales) donne 2 500 € au lieu de 2,50 € | écarté — vérifié CORRECT : un montant a deux décimales, « 2.500 » y vaut bien 2500 (cf. T16) |
| B27 | bas | Moteur de calcul (prix, marges, TVA, ma… | `src/lib/estimate-calculations.ts:216` | PU HT arrondi par ligne: PU x Quantite ne redonne pas le Total HT de la ligne (ecart au centime dans l'ecran/PDF/XLSX) | à traiter — absorbé par le breakdown T6 (`puNetHtCents`) |

### Détail des bugs

#### B01 — capCents() tronque silencieusement toute valeur à 21 474 836,47 € (int32) — devis > ~21,5 M€ HT sous-évalués

- **Gravité** : critique · **Thème** : donnees · **Vérification** : ✓ Confirmé 2/2 · vérifié manuellement
- **Domaine** : Moteur de calcul (prix, marges, TVA, main d’œuvre)
- **Emplacement** : `src/lib/estimate-calculations.ts:143`
- capCents fait return Math.min(value, MAX_CENTS) avec MAX_CENTS = 2_147_483_647 (max PostgreSQL int4). Le dépassement est écrêté **sans erreur ni avertissement** — un test verrouille même ce comportement (estimate-calculations.test.ts:501 « caps computed cents at MAX_CENTS »). Le même plafond existe dans le takeoff (apply-impact.ts:99). Aucun garde-fou UI ne prévient l'utilisateur que le montant affiché n'est plus le vrai total.

#### B02 — L'insertion d'un ouvrage perd tout le coût de main-d'œuvre des lignes 'labor' sans rôle (ou à rôle invalide) → ligne à 0 €

- **Gravité** : critique · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Assemblages / ouvrages / gabarits
- **Emplacement** : `supabase/migrations/20260722132425_nested_estimate_assemblies.sql:578`
- Dans materialize_estimate_assembly_tree, une ligne d'ouvrage est matérialisée avec unit_price_ht_cents = case when assembly_item.cost_type = 'labor' then 0 else coalesce(assembly_item.unit_cost_ht_cents, 0) end (l.577-580) et labor_role_id = assembly_item.labor_role_id (l.588). Or le coût MO d'une ligne de devis n'est calculé QUE via le rôle de main-d'œuvre : dans computeEstimateLineValues (src/lib/estimate-calculations.ts:172, 200-202) moCostCents = hMoMajoration * hMo * hourlyRateLegacy * kMo, où hourlyRateLegacy provient exclusivement de labor_role_hourly_rate_cents (dérivé de labor_role_id). La table estimate_items n'a AUCUNE colonne de taux horaire par ligne (src/types/database.ts:2509-2548). Pour un composant labor SANS rôle, le rollup d'ouvrage (même migration, l.196-204) utilise pourtant item.unit_cost_ht_cents comme taux horaire (when item.cost_type = 'labor' then item.unit_cost_ht_cents), et l'éditeur d'ouvrage l'autorise explicitement (src/components/estimates/AssemblyEditorDialog.tsx:177-179 : laborRoles.find(...)?.hourly_rate_cents ?? (item.costType === 'labor' ? unitCostCents : 0)). Ce taux n'est jamais reporté sur la ligne matérialisée : unit_price_ht_cents = 0 et labor_role_id = null ⇒ coût MO = 0. Le module 'ouvrages générés' contourne d'ailleurs le problème en réintégrant la MO dans le prix unitaire (src/lib/estimates/generated-ouvrages.ts:1790-1852), preuve que la limite est connue — mais la voie assemblage ne le fait pas. Aggravant : insertAssemblyIntoVersion (src/lib/estimates/server.ts:5939-5962) met en plus labor_role_id = null si le rôle n'appartient pas au propriétaire de la version, ce qui déclenche le même effet pour des lignes labor pourtant liées à un rôle.

#### B03 — La préselection fournisseur injecte un prix en devise étrangère tel quel dans unit_price_ht_cents (EUR) sans conversion

- **Gravité** : critique · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Prix / catalogue / tarifs / fournisseurs / achats
- **Emplacement** : `src/lib/estimates/server.ts:1651`
- Dans buildEstimateSupplierPreselectionReview, le patch appliqué à la ligne de devis est: const patch = { unit_price_ht_cents: proposedAlternative.adjusted_unit_price_cents, selected_supplier_price_id: ... }. adjusted_unit_price_cents n'est ajusté que par l'indice matière (server.ts:1078-1080 Math.round((row.unit_price_cents * materialIndex.index_value) / 100)), jamais par le taux de change. Le champ currency du prix fournisseur (EUR/USD/GBP, cf. supplier_pricebook + import CSV) est purement et simplement ignoré. La table currency_rates existe mais n'est utilisée nulle part dans src/lib/estimates/server.ts (aucune occurrence de currency_rates/from_currency/convert).

#### B04 — Nouvelle version d'une affaire : la marge héritée est écrasée à 1.0 (0% de marge)

- **Gravité** : critique · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Versions, création, paramètres, diff/changelog
- **Emplacement** : `src/lib/estimates/client.ts:3827`
- createEstimate construit toujours le payload avec margin_multiplier: input.marginMultiplier ?? 1 (client.ts:3827). Côté serveur, createEstimate n'utilise la marge héritée de la dernière version du projet que si le champ est absent : margin_multiplier: input.version?.margin_multiplier ?? latestProjectVersionDefaults?.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER (server.ts:6856). Comme le client envoie TOUJOURS la valeur (1 par défaut), le fallback d'héritage est mort pour la marge. De plus, l'assistant ne précharge jamais les paramètres de l'affaire existante (useEstimateCreationDraft/useEstimateCreationResources partent de initialWizardData() avec marginBp='0'), et submitEstimateCreation met marginMultiplier: marginBpNum > 0 ? ... : undefined (submitEstimateCreation.ts:75) → undefined quand la marge est laissée à 0%, donc le client transmet 1. Le bouton 'Créer directement' (quickCreateEstimateCreation) n'envoie même aucune marge, mais createEstimate force quand même 1.

#### B05 — Vider une cellule K FO ou K MO enregistre 0 (au lieu du défaut 1), annulant le coût FO/MO de la ligne

- **Gravité** : haut · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Éditeur de devis (tableur)
- **Emplacement** : `src/components/estimates/components/estimate-editor-row/shared.ts:268`
- parseNumberInput renvoie 0 pour une chaîne vide :export function parseNumberInput(value: string) { const normalized = value.replace(",", "."); const parsed = Number.parseFloat(normalized); return Number.isFinite(parsed) ? parsed : 0; // "" -> 0 }DecimalDraftInput (DecimalDraftInput.tsx l.61-66) commit parseNumberInput(nextValue) au blur. Pour K FO (LineRow.tsx l.789) et K MO (StandardMoCells.tsx l.255), le placeholder affiche pourtant "1.00", suggérant que vide = 1. Comme computeEstimateLineValues fait Math.max(toSafeNumber(item.k_fo,1),0) sur la valeur 0 (non-null), le coefficient reste 0.

#### B06 — Export XLSX: la colonne "Total HT" des lignes ne se reconcilie jamais avec le "Total HT" du resume (remise + coefficient global ignores)

- **Gravité** : haut · **Thème** : export · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Moteur de calcul (prix, marges, TVA, main d’œuvre)
- **Emplacement** : `src/lib/estimates/export-stream.ts:229`
- Dans buildLineRows, chaque ligne exporte total_ht: toEuroAmount(lineValues.saleLineCents) (ligne 229) qui est le montant de vente BRUT ligne a ligne, avant remise et avant coefficient global. La feuille "Resume" affiche ["Total HT", toEuroAmount(input.payload.totals.saleTotalCents)] (ligne 357), or saleTotalCents provient de computeReadOnlyTotals et vaut version.total_ht_cents, c.-a-d. le total NET (apres remise, apres coefficient global). La feuille "Devis" ne contient aucune ligne de remise ni de coefficient. La somme de la colonne "Total HT" des lignes ne peut donc pas egaler le "Total HT" du resume des qu'une remise existe ou que global_coefficient != 1.

#### B07 — Les totaux de section ignorent le coefficient global: les sections ne se somment pas au total et la remise proportionnelle est sur-allouee

- **Gravité** : haut · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Moteur de calcul (prix, marges, TVA, main d’œuvre)
- **Emplacement** : `src/lib/estimate-calculations.ts:881`
- computeAllSectionTotals (et son type ComputeAllSectionTotalsInput) n'accepte ni n'applique globalCoefficient. Le sous-total vendeur d'une section est estimateSaleSubtotalCents = allLines.reduce(... + split.saleLineCents ...) (ligne 881), soit la somme des ventes AVANT coefficient. Or le total de l'estimation applique le coefficient: saleSubtotalCents = bankersRound(saleSubtotalBeforeCoefficientCents * safeGlobalCoefficient) (lignes 364-370). De plus, dans convertSectionSubtotalToTotals (lignes 588-597) la remise de section = round(safeDiscount * htSubtotal / estimateSaleSubtotalCents), mais safeDiscount est une fraction du sous-total APRES coefficient tandis que le denominateur estimateSaleSubtotalCents est AVANT coefficient: le ratio de remise applique aux sections est donc multiplie par le facteur coefficient.

#### B08 — Le PDF force isLaborSplitEnabled:false : colonnes MO HT à 0 et FO HT gonflé, divergence avec l'aperçu écran/portail

- **Gravité** : haut · **Thème** : export · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Exports (DPGF, BDC, PDF)
- **Emplacement** : `src/lib/estimates/pdf-generator.tsx:1753`
- Dans generateEstimatePdfNow, prepareEstimateDocumentData est appelé avec isLaborSplitEnabled: false codé en dur (ligne 1753), alors que la page d'aperçu/impression et le portail rendent le MÊME composant via EstimateDocument en passant le vrai flag: isLaborSplitEnabled={isLaborSplitEnabled} (print/page.tsx:353, portal/page.tsx:231). Ces deux chemins partagent computeEstimateLineSaleSplit: const shouldUseLaborSplit = isLaborSplitEnabled && hasActiveLaborSplitPayload(item) puis moChantierCostRaw = shouldUseLaborSplit ? ... : hMoMajoration * hMo * legacyHourlyRate * kMo. En mode de prix fo_mo_and_total, le PDF affiche donc les colonnes FO HT / MO HT et les sous-totaux de section FO/MO calculés comme si aucune MO éclatée n'existait.

#### B09 — Lignes d'ouvrage insérées persistées et affichées avec montant HT et PU = 0 (aucune renormalisation après matérialisation)

- **Gravité** : haut · **Thème** : etat · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Assemblages / ouvrages / gabarits
- **Emplacement** : `supabase/migrations/20260722132425_nested_estimate_assemblies.sql:590`
- materialize_estimate_assembly_tree insère chaque ligne avec pu_ht_cents = 0 (l.587), line_total_ht_cents = 0 (l.590), line_tax_cents = 0 (l.591), line_total_ttc_cents = 0 (l.592). insertAssemblyIntoVersion (src/lib/estimates/server.ts:5964-5984) relit puis renvoie ces items TELS QUELS (aucun normalizeDraftItems, aucun recalcul). Côté client, insertAssemblyIntoVersion (src/lib/estimates/client.ts:5636-5661) ne fait que parser, puis le contrôleur useEstimateEditorStructureController.ts:276-277 fait setItems([...insertedItems]) suivi de setTotalsOutOfSync(false) — donc sans normaliser. Or la cellule montant lit la valeur stockée : lineTotal={item.line_total_ht_cents ?? 0} (src/components/estimates/components/EstimateEditorRow.tsx:640) rendue en formatCurrency(lineTotal, ...) (src/components/estimates/components/estimate-editor-row/LineRow.tsx:892), et le PU affiché est item.pu_ht_cents (LineRow.tsx:872). Les totaux de section, eux, sont recalculés à la volée (computeAllSectionTotals), d'où une incohérence visible entre le sous-total de section (correct) et le montant de chaque ligne (0). De plus les valeurs 0 restent en base : pour une version passée en 'sent', computeReadOnlyTotals additionne item.line_total_ht_cents stockés (src/lib/estimate-calculations.ts:1210-1213), soit 0 pour ces lignes tant qu'aucune édition/sauvegarde n'a renormalisé.

#### B10 — Application takeoff non atomique : les transformations de mapping (prix/renommage/catégorie/ouvrages) après le RPC ne sont pas rollbackées et bloquent toute reprise

- **Gravité** : haut · **Thème** : etat · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Métré / takeoff (plans, extraction, réconciliation)
- **Emplacement** : `src/lib/takeoff/server.ts:7744`
- Dans applyTakeoffJob, le RPC apply_takeoff_job (qui insère les lignes de devis ET passe le job en statut 'applied') s'exécute dans un try dont le catch ne fait QUE rollbackTakeoffItemPreApplyPatches (lignes 7667-7699). Les étapes de mapping money-facing s'exécutent APRÈS, hors de ce try : applyEstimateLineUpdatesFromMapping (7744, écrit unit_price_ht_cents / title / category_id) et applyAssemblyInsertionsFromMapping (7753, insère les ouvrages). Si l'une lève (ex. getEstimateVersionUpdatedAt -> bulkUpdateEstimateItems échoue sur un conflit de concurrence, ou insertAssemblyIntoVersion échoue en milieu de boucle 7453-7467), l'exception part dans le catch externe (7810) qui se contente de logguer 'takeoff.apply.failed' et de relancer : aucun rollback des lignes déjà insérées par le RPC, et le job est DÉJÀ 'applied'. Le garde d'entrée (7541 : if (jobRow.status !== "completed") -> 409 CONFLICT) empêche alors tout ré-appel.

#### B11 — Le scellement (seal) n'inclut PAS les colonnes main-d'oeuvre atelier/chantier : intégrité falsement garantie

- **Gravité** : haut · **Thème** : securite · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Workflow: validation, verrouillage, scellement, portail
- **Emplacement** : `src/lib/estimates/server.ts:1950`
- buildCanonicalEstimateSealPayload construit chaque ligne canonique en lisant explicitement les champs de découpe main-d'oeuvre (server.ts:1881-1886) : h_mo_atelier: item.h_mo_atelier, k_mo_atelier: item.k_mo_atelier, labor_role_atelier_id: item.labor_role_atelier_id, h_mo_chantier: item.h_mo_chantier, k_mo_chantier: item.k_mo_chantier, labor_role_chantier_id: item.labor_role_chantier_id. Mais loadEstimateSealSource (server.ts:1949-1951) ne SELECT que : "id, position, item_type, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, supply_type_id, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents" — les 6 colonnes atelier/chantier sont absentes. À l'exécution item.h_mo_atelier === undefined, et JSON.stringify (computeEstimateSealHash, server.ts:1919-1920) supprime purement et simplement toute clé de valeur undefined. Le sceau ne couvre donc jamais la composition main-d'oeuvre atelier/chantier, alors que le type EstimateSealCanonicalItem prétend le faire.

#### B12 — Le classement 'meilleur prix' compare des montants de devises différentes sans conversion

- **Gravité** : haut · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Prix / catalogue / tarifs / fournisseurs / achats
- **Emplacement** : `src/lib/estimates/server.ts:1168`
- buildSuggestedCatalogueAlternatives trie les candidats pour désigner le 'best_price' uniquement sur adjusted_unit_price_cents: const bestPrice = [...productCandidates].sort((left, right) => { if (left.adjusted_unit_price_cents !== right.adjusted_unit_price_cents) return left.adjusted_unit_price_cents - right.adjusted_unit_price_cents; ... })[0]. Le champ currency (présent sur chaque candidat, server.ts:1113) n'entre pas dans la comparaison. Aucune normalisation vers une devise pivot n'est faite.

#### B13 — Les bons de commande manuels arrondissent la quantité à l'entier (Math.round), au lieu de la rejeter comme le fait la génération de brouillon

- **Gravité** : haut · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Prix / catalogue / tarifs / fournisseurs / achats
- **Emplacement** : `src/app/api/purchase-orders/route.ts:120`
- La création (route.ts:120 quantity: Math.round(item.quantity) et l'insert ligne 185) et la mise à jour (src/app/api/purchase-orders/[id]/route.ts:333 et 352) arrondissent silencieusement la quantité. Le filtre en amont accepte pourtant toute quantité > 0 réelle (route.ts:106). Le pipeline de brouillon, lui, traite explicitement une quantité non entière comme une anomalie (non_integer_quantity, src/lib/estimates/purchase-order-drafts.ts:147-148, 360 Number.isInteger(quantity)): les deux chemins divergent sur la même règle métier. La colonne DB est quantity integer NOT NULL CHECK (quantity > 0) (migration 001_add_job_title_to_profiles.sql:192).

#### B14 — Le diff affiche 'Aucun changement' alors que le Total HT/TTC diffère (remise/coefficient/arrondi globaux)

- **Gravité** : haut · **Thème** : export · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Versions, création, paramètres, diff/changelog
- **Emplacement** : `src/components/estimates/EstimateDiffView.tsx:263`
- EstimateDiffView fait un early-return if (diff.entries.length === 0) return 'Aucun changement detecte entre les versions selectionnees.' (EstimateDiffView.tsx:263), ce qui masque totalement le bloc 'Resume des changements' incluant Delta HT / Delta TTC. Or diff.entries n'est peuplé que par les changements au niveau des lignes/sections (buildEstimateDiff), tandis que diff.summary.deltaHtCents = current.total_ht_cents - previous.total_ht_cents (diff.ts:802). Les paramètres globaux (remise, global_coefficient, arrondi) modifient le total de version — total_ht_cents = totalsResult.saleTotalCents post-remise/post-coefficient (server.ts:2963) — mais PAS les champs par ligne : line_total_ht_cents = saleLineCents, pré-remise et pré-coefficient (estimate-calculations.ts:1168). Résultat : deux versions aux lignes identiques mais à remise différente produisent diff.entries=[] avec un summary.deltaHtCents non nul.

#### B15 — La cellule Quantité est un input type=number : la virgule décimale (pavé numérique FR) est bloquée/perdue

- **Gravité** : moyen · **Thème** : i18n · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Éditeur de devis (tableur)
- **Emplacement** : `src/components/estimates/components/estimate-editor-row/LineRow.tsx:625`
- La cellule Quantité utilise type="number" :type="number" step="0.001" ... onCommit={(value) => onPatchItem(item.id, { quantity: parseNumberInput(value) }, { persist: true })}Alors que la cellule Prix unitaire, pour gérer la virgule FR, utilise volontairement type="text" inputMode="decimal" (l.693-694). Dans un input number, la valeur DOM est toujours à base point ; la virgule saisie au pavé numérique est refusée par le navigateur, et une valeur invalide fait renvoyer .value === "" → parseNumberInput("") = 0.

#### B16 — Les totaux globaux (pages serveur + PDF) sont calcules sans passer isLaborSplitEnabled, contredisant le detail par section/ligne

- **Gravité** : moyen · **Thème** : calcul · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Moteur de calcul (prix, marges, TVA, main d’œuvre)
- **Emplacement** : `src/lib/estimates/pdf-generator.tsx:1708`
- computeEstimateTotals est appele sans la cle isLaborSplitEnabled (pdf-generator.tsx ligne 1708-1719; idem src/app/dashboard/estimates/[versionId]/page.tsx:244, .../print/page.tsx:192, src/app/portal/[token]/page.tsx:154). Dans computeEstimateLineValues, shouldUseLaborSplit = isLaborSplitEnabled ?? hasSplitPayload (ligne 197): absent -> auto-detection par ligne. En parallele, prepareEstimateDocumentData({... isLaborSplitEnabled: false}) (pdf-generator.tsx ligne 1753) force le modele legacy pour les sections/lignes, et les composants recoivent isLaborSplitEnabled={isLaborSplitEnabled} (flag de feature). Quand la feature est desactivee mais qu'une ligne porte encore un payload atelier/chantier, le total global utilise le cout MO en mode split alors que le detail utilise le mode legacy.

#### B17 — Export XLSX standard: le 'Total HT' par ligne ignore le coefficient global et la remise -> ne somme pas au Total HT du Résumé

- **Gravité** : moyen · **Thème** : export · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Exports (DPGF, BDC, PDF)
- **Emplacement** : `src/lib/estimates/export-stream.ts:229`
- buildLineRows calcule chaque ligne via computeEstimateLineValues et exporte total_ht: toEuroAmount(lineValues.saleLineCents) (ligne 229) — c'est un total AVANT coefficient global et AVANT remise. Le Résumé exporte ['Total HT', toEuroAmount(input.payload.totals.saleTotalCents)] (ligne 357) où saleTotalCents = version.total_ht_cents stocké (APRÈS coefficient global et remise, cf computeReadOnlyTotals: saleSubtotalAfterCoefficientCents = bankersRound(saleSubtotal * global_coefficient)). Aucune ligne de sous-total/remise/coefficient n'apparaît dans la feuille 'Devis'.

#### B18 — Le rapprochement automatique DPGF glouton attribue le meilleur item de métré à la première ligne DPGF traitée, privant une ligne ultérieure mieux appariée

- **Gravité** : moyen · **Thème** : donnees · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Métré / takeoff (plans, extraction, réconciliation)
- **Emplacement** : `src/lib/takeoff/dpgf-compare.ts:809`
- buildTakeoffDpgfComparison itère les lignes DPGF dans l'ordre du tableau (771) et, pour chacune, findBestAutoMatch (517) choisit le meilleur item de métré non encore utilisé au-dessus du seuil, puis l'ajoute à usedTakeoffIds (817). Le choix est purement glouton et ordonné : la première ligne DPGF qui dépasse le seuil consomme définitivement l'item, même si une ligne DPGF plus tardive aurait un score bien supérieur avec ce même item.

#### B19 — La reprise manuelle du reconcile ne réinitialise pas le compteur de tentatives : un job batch en timeout ne peut pas être relancé et re-échoue immédiatement

- **Gravité** : moyen · **Thème** : etat · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Métré / takeoff (plans, extraction, réconciliation)
- **Emplacement** : `src/lib/takeoff/server.ts:6606`
- reconcileTakeoffJobNow repasse un job 'failed' en 'processing' (6611-6617) mais conserve provider_reconcile_attempt_count: existingJob.provider_reconcile_attempt_count ?? 0 (6606) sans le remettre à 0. Or un job qui a échoué en AI_TIMEOUT l'a fait précisément parce que ce compteur a dépassé TAKEOFF_BATCH_RECONCILE_MAX_ATTEMPTS (async-worker.ts:621-646). operator-state expose canReconcile=true pour ce cas (errorCode AI_TIMEOUT / orphan_to_reconcile, operator-state.ts:137,176-181), donc le bouton 'Relancer le reconcile' est proposé. Au prochain passage du worker, (lease.attemptCount ?? 0) > MAX_ATTEMPTS est de nouveau vrai -> markBatchReconcileTimeoutAsFailed -> le job re-échoue aussitôt.

#### B20 — patchEstimateStatus ne vérifie pas le rôle d'écriture : transition de statut via RPC service-role contourne la RLS admin/engineer

- **Gravité** : moyen · **Thème** : securite · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Workflow: validation, verrouillage, scellement, portail
- **Emplacement** : `src/lib/estimates/server.ts:7780`
- patchEstimateStatus (server.ts:7780-7900) n'appelle JAMAIS assertCanWriteEstimateWorkflows. Ses seules barrières sont getVersionAccessOrThrow (server.ts:3779-3788 : canAccessOwnerResource = propriétaire OU admin) + jeton de concurrence + (pour draft) verrou. L'écriture effective passe par transitionEstimateVersionStatusAtomically (server.ts:2047-2070) qui utilise getServiceRoleSupabaseClient() — donc la RLS estimate_versions est CONTOURNÉE. Or tout le reste de la surface d'écriture est limité à admin/engineer par RLS (cf. workflow-write-security-regressions.test.ts:24-31,82-95 et write-access.ts:7 role === 'admin' || role === 'engineer'). Les rôles 'director' et 'viewer' ne sont pas des writers. Le chemin d'envoi email (send-estimate.ts:125) applique bien assertCanWriteEstimateWorkflows, mais l'endpoint PATCH /status ne l'applique pas.

#### B21 — Nouvelle version : TVA et devise héritées écrasées par les défauts de l'assistant (20% / EUR)

- **Gravité** : moyen · **Thème** : etat · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Versions, création, paramètres, diff/changelog
- **Emplacement** : `src/components/estimates/estimate-creation-wizard/submitEstimateCreation.ts:76`
- Pour une affaire existante, l'assistant ne recharge jamais les réglages de la dernière version : initialWizardData() fixe taxRateBp='2000' et currency='EUR' (shared.ts:105-109). submitEstimateCreation envoie systématiquement taxRateBp: Number(data.taxRateBp) (submitEstimateCreation.ts:76) et currency: data.currency || undefined (ligne 82). Côté serveur ces champs sont présents, donc l'héritage latestProjectVersionDefaults?.tax_rate_bp / ?.currency (server.ts:6881-6884, 6834) n'est jamais utilisé via l'assistant complet. Seul 'Créer directement' (quickCreate) omet ces champs et hérite correctement — d'où une incohérence de comportement entre les deux boutons de création.

#### B22 — Création depuis un template : marge/TVA/devise/arrondi saisis à l'étape Paramètres sont ignorés

- **Gravité** : moyen · **Thème** : etat · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Versions, création, paramètres, diff/changelog
- **Emplacement** : `src/components/estimates/estimate-creation-wizard/submitEstimateCreation.ts:28`
- Quand creationMode='template', submitEstimateCreation appelle instantiateEstimateFromTemplate en ne transmettant que versionTitle, dateDevis, validiteJours et projectNotes (submitEstimateCreation.ts:28-40). Les champs marginMode, marginBp, taxRateBp, roundingMode, roundingStepCents et currency que l'utilisateur a pourtant saisis et validés à l'étape 2 (PricingStep) sont silencieusement abandonnés. instantiateEstimateFromTemplate n'accepte d'ailleurs aucun de ces paramètres (client.ts:5362-5367).

#### B23 — Export XLSX Résumé: 'Remise' faux (souvent 0) quand global_coefficient != 1

- **Gravité** : bas · **Thème** : export · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Exports (DPGF, BDC, PDF)
- **Emplacement** : `src/lib/estimates/export-stream.ts:165`
- resolveStoredDiscountCents calcule la remise comme Math.max(lineSubtotalCents - storedHt, 0) (lignes 160-168) où lineSubtotalCents = somme des line_total_ht_cents et storedHt = version.total_ht_cents. Mais total_ht_cents = round(lineSubtotal * global_coefficient) - remise. La formule ignore le coefficient: remise_calculée = remise_réelle - lineSubtotal*(coefficient-1). Cette valeur alimente le Résumé: Remise ${toEuroAmount(totals.discountCents)} (ligne 362). (À comparer à computeStoredDiscountCents qui, lui, applique bien le coefficient.)

#### B24 — Le panneau de comparaison affiche tous les prix avec le symbole € puis recolle le code devise

- **Gravité** : bas · **Thème** : i18n · **Vérification** : ✓ Confirmé 2/2
- **Domaine** : Prix / catalogue / tarifs / fournisseurs / achats
- **Emplacement** : `src/components/estimates/SupplierComparisonPanel.tsx:166`
- Le prix est rendu par formatEUR(alternative.adjusted_unit_price_cents) suivi de {alternative.currency ? ${alternative.currency} : ''}. formatEUR force toujours un formatage en euros (money.ts:100-102 -> formatCurrency(..., 'EUR')). Un prix en USD/GBP est donc affiché avec le symbole € puis suffixé de son code devise, et même un prix EUR affiche un doublon '€EUR'.

#### B25 — Collage : un nombre à 3 décimales (virgule ou point) est interprété comme séparateur de milliers → valeur ×1000

- **Gravité** : haut · **Thème** : donnees · **Vérification** : ≈ Plausible 1/2
- **Domaine** : Éditeur de devis (tableur)
- **Emplacement** : `src/lib/estimates/clipboard.ts:307`
- normalizeSingleSeparatorNumber traite tout groupe de 3 chiffres après un séparateur unique comme un séparateur de milliers dès que la partie gauche n'est pas "0" :if (right.length === 3 && left !== "0") { return `${left}${right}`; // "2,500" -> "2500" }De même pour le point (ligne 329-330). parseClipboardNumber renvoie donc 2500 pour "2,500". Cette valeur alimente pasteRows (useEstimateEditorPasteController.ts l.131-135) sans autre garde.

#### B26 — Cellule Prix unitaire : saisir "2.500" (point + 3 décimales) donne 2 500 € au lieu de 2,50 €

- **Gravité** : haut · **Thème** : calcul · **Vérification** : ≈ Plausible 1/2
- **Domaine** : Éditeur de devis (tableur)
- **Emplacement** : `src/lib/money.ts:63`
- parseEuroInputToNumber (utilisé par parseCurrencyToCents, appelé au commit de la cellule prix dans LineRow.tsx l.715-724) traite un point suivi de 3 chiffres comme séparateur de milliers :} else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(stripped)) { normalized = stripped.replace(/\./g, ""); // "2.500" -> "2500" }Inversement, une virgule à 3 décimales ("1,234") ne matche pas /^-?\d+(?:\.\d{1,2})?$/ et renvoie null, donc l'édition est silencieusement ignorée (le prix reste inchangé).

#### B27 — PU HT arrondi par ligne: PU x Quantite ne redonne pas le Total HT de la ligne (ecart au centime dans l'ecran/PDF/XLSX)

- **Gravité** : bas · **Thème** : calcul · **Vérification** : ≈ Plausible 1/2
- **Domaine** : Moteur de calcul (prix, marges, TVA, main d’œuvre)
- **Emplacement** : `src/lib/estimate-calculations.ts:216`
- puHtCents = quantity > 0 ? bankersRound(saleLineCents / quantity) : 0 (lignes 216-217). Le PU est arrondi independamment du total de ligne saleLineCents. L'export XLSX affiche les deux cote a cote (pu_ht et total_ht, export-stream.ts lignes 228-229), tout comme le PDF. Le produit PU x Quantite ne redonne donc pas total_ht.

---

## 2. Constats UX/UI par persona

### Chiffreur / Économiste de la construction — 14 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX01 | Bloquant | Grille d'édition — ligne de devis | La grille n'affiche jamais le sous-détail de prix attendu par un chiffreur : la cellule P.U. montre item.pu_ht_cents (prix de VENTE après marge, en lecture seu… | livré (`c0ceefe`) — colonnes Deboursé sec / Marge € / Marque % |
| UX02 | Majeur | Totaux — pied de tableau | grandTotals ne somme que les enfants racine de type 'section' : rootItems.forEach((item) => { if (item.item_type !== 'section') return; ... }). Toute ligne sit… | à traiter (vérifié) — `grandTotals` filtre encore `item_type !== "section"`, les lignes racine restent hors du pied |
| UX03 | Majeur | Saisie clavier — création de ligne | Entrée et Tab déplacent la sélection mais ne créent jamais de nouvelle ligne en fin de tableau (resolveSpreadsheetKeyCommand mappe Enter→'down', Tab→'next'). A… | à traiter (vérifié) — aucun raccourci de création de ligne dans `useEstimateKeyboardShortcuts` |
| UX04 | Majeur | Navigation tableur — bouclage Tab/Entrée | resolveSpreadsheetNextCellId utilise mod() : depuis la dernière cellule, Tab reboucle sur la toute première cellule de la grille (et Shift+Tab depuis la premiè… | à traiter (vérifié) — `mod()` toujours présent dans `useSpreadsheetNavigation`, la navigation boucle |
| UX05 | Majeur | Sélection multiple — touche Suppr | Lorsque des lignes sont sélectionnées, appuyer sur Suppr déclenche onBulkDeleteSelection() directement, sans confirmation. Un chiffreur qui a sélectionné des l… | livré (`3d5aaab`) — `confirmAndBulkDeleteSelection` confirme avant suppression |
| UX06 | Majeur | Saisie numérique — valeurs vidées | parseNumberInput renvoie 0 pour toute entrée invalide ou vide, et DecimalDraftInput commit cette valeur au blur. Vider K FO/K MO pour les retaper puis cliquer … | livré (`1a58046`) — un champ vidé retombe sur 1 (neutre) et non sur 0 |
| UX07 | Majeur | Layout grille — colonnes de totaux | Avec le sous-détail complet (surtout labor split : ~14 colonnes) la grille dépasse largement la largeur d'un écran portable et défile horizontalement. Les colo… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX08 | Majeur | Sélection de ligne — accessibilité clavier | La case à cocher de sélection de ligne est un input type=checkbox avec readOnly, un handler onClick qui preventDefault, et aucun onChange/onKeyDown. Un checkbo… | livré (`9259f03`) — la case porte `onKeyDown` et `onClick`, opérable au clavier |
| UX09 | Mineur | Cohérence — dialogues natifs | Les conversions ligne↔section et leurs erreurs utilisent window.confirm/window.alert natifs, alors que le reste de l'app dispose d'un système de toasts (useToa… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX10 | Mineur | Libellés FR — accents | Accentuation incohérente sur de nombreux libellés visibles : « Créer un lot » écrit « Creer un lot », « filtre qualite actif », « selectionnees en sections », … | **traité** (`6935dba`, `6865076`, `0e28d25`) — éditeur, messages d'erreur et centre de métrés ; garde `src/lib/i18n/fr-accents.test.ts` |
| UX11 | Mineur | En-tête grille — ambiguïté PR.FO vs P.U. | La ligne expose deux notions de « prix unitaire » côte à côte : PR. FO (prix de revient fourniture, saisi) et P.U. (prix unitaire de vente, calculé, lecture se… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX12 | Mineur | Menu d'actions ligne — disclosure natif | Le menu « … » de chaque ligne (Comparer / Convertir / Supprimer) est un <details>/<summary> sans aria-haspopup, sans fermeture au clic extérieur ni à Échap, et… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX13 | Mineur | Insertion ouvrage/template — ancrage | L'insertion d'ouvrage/template se fait « après la cellule active » (insertionAnchorItemId = activeCell.rowId). Si aucune cellule n'est active (ex. juste après … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX14 | Polish | Barre de sélection groupée — dépassement de … | La barre d'actions groupées est rendue dans le flux et un simple spacer <div className="h-16"> est ajouté en bas « pour que le contenu ne soit pas masqué ». Ce… | à traiter — non rouvert, aucun correctif livré ne le vise |

### Métreur — 15 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX15 | Bloquant | Revue d'extraction / EvidencePanel | Aucun visualiseur de plan n'existe dans tout le domaine takeoff (grep iframe\|react-pdf\|pdfjs\|PdfViewer\|canvas dans src/components/takeoff = aucun résultat)… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX16 | Majeur | TakeoffReviewTable — édition quantité | Le commit de la cellule Quantité rejette silencieusement toute valeur ≤ 0 : onCommit ne propage que si Number.isFinite(num) && num > 0. Si le métreur saisit 0,… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX17 | Majeur | TakeoffReviewPage — sauvegarde automatique | Aucun indicateur de sauvegarde persistant ni garde de navigation. Le feedback se limite à un toast transitoire de 2 s (« Sauvegarde automatique ») et à un spin… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX18 | Majeur | TakeoffReviewPage — chargement des items | Toutes les lignes sont chargées via une boucle de pagination séquentielle (200/page) et l'écran reste bloqué sur un skeleton (loading) tant que TOUTES les page… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX19 | Majeur | EvidencePanel — navigation prev/next | La navigation flèche gauche/droite dans le panneau d'évidence parcourt la liste items COMPLÈTE et dans l'ordre brut (handleEvidenceNavigate utilise l'index dan… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX20 | Majeur | TakeoffReviewPage — titre h1 (contexte hors … | Le titre affiche littéralement « Revue d&apos;extraction » : dans le ternaire, la chaîne est un littéral JavaScript passé dans une accolade JSX, or React ne dé… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX21 | Majeur | TakeoffReviewTable — colonne Alertes / confi… | L'information d'anomalie repose sur un triangle d'avertissement dont le détail (quelles anomalies) n'est disponible que via l'attribut title (tooltip) — non ac… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX22 | Mineur | Vocabulaire — Evidence vs Preuve | Le même concept de traçabilité est nommé de deux façons selon l'écran : « Evidence » (anglicisme) dans EvidencePanel et la table, « preuve » dans ValidationRev… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX23 | Mineur | Copy FR — accents/diacritiques | Défaut d'accents systématique dans l'UI destinée à des professionnels francophones du BTP : « Sauvegarde automatique », « verifier/Verifies », « controle », « … | **traité** (`6935dba`) — les exemples cités sont corrigés ; TakeoffReviewPage/Table sous garde |
| UX24 | Mineur | TakeoffReviewTable — barre de filtres | La barre de filtres aligne 8+ selects (inclusion, vérif, catégorie, page, table, anomalie, confiance, tri + sens) en un wrap horizontal sans regroupement, sans… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX25 | Mineur | TakeoffReviewPage — chargement des candidats… | À chaque ouverture de la revue, un effet pagine TOUS les jobs takeoff de la version (boucle jusqu'à 100/page) uniquement pour trouver ceux du même fichier sour… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX26 | Mineur | ConfidenceHeader — niveaux A/B | L'entête de confiance globale (jauge + distribution) n'est rendu que pour les extractions Level C. Les métrés Level A (métrage structuré) et Level B (tableaux … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX27 | Mineur | Route affaire review — paramètre versionId m… | La page de revue affaire fait notFound() si le search param versionId est absent. Un métreur qui arrive via un lien partagé ou un favori sans ce paramètre tomb… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX28 | Mineur | EvidencePanel — piège de focus du tiroir | Le tiroir d'évidence est marqué role=dialog / aria-modal=true et reçoit le focus à l'ouverture, mais il n'y a pas de piège de focus réel : Tab peut sortir du t… | livré (`12d77a8`) — piège de focus et restauration sur EvidencePanel |
| UX29 | Mineur | Plans — double expérience (affaire vs estima… | Deux parcours plans coexistent : /affaires/[id]/plans (ProjectPlanCenter, actuel) et /estimates/[versionId]/plans (PlanCenter, marqué déprécié via TakeoffDepre… | à traiter — non rouvert, aucun correctif livré ne le vise |

### Chargé d'affaires / Conducteur de travaux — 11 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX30 | Majeur | Liste affaires / Hub / Dashboard — colonnes … | Le persona doit piloter des échéances et des relances, mais AUCUNE échéance/date de validité ni date d'envoi n'est surfacée. Partout la seule date affichée est… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX31 | Majeur | AffairesDenseTable — ligne cliquable | Toute la ligne du tableau dense navigue via onClick sur le <tr> (router.push(primaryHref)) sans role, tabIndex ni gestionnaire clavier ; la cellule 'Nom affair… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX32 | Majeur | Pilotage portefeuille — vue d'ensemble des é… | Le persona attend une 'vue d'ensemble des affaires… échéances, timeline'. Les surfaces existantes couvrent l'agrégat (analytics : KPI + tendance) et le détail … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX33 | Mineur | estimates/dashboard vs analytics — composant… | EstimateDashboard.tsx (référencé comme surface du parcours : taux d'acceptation, CA par statut, courbe créés/acceptés en SVG polyline) n'est importé nulle part… | à traiter (vérifié) — `EstimateDashboard` n'est importé nulle part, toujours mort |
| UX34 | Mineur | Chaîne affaires / hub / analytics — accentua… | Incohérence d'accentuation systématique sur des libellés visibles, qui décrédibilise un outil de chiffrage pro face à Batigest/Onaya. Exemples : 'Favori non en… | **traité** (`ce532c0`) — panneau de flux, intake, brouillons de commandes et suggestions cockpit sous garde |
| UX35 | Mineur | AffaireHubPage — chargement de la page la pl… | Le hub d'affaire (page la plus visitée par ce persona) charge côté serveur en vagues séquentielles bloquantes : ~6 fetches en vague 1, puis ~8 fetches dépendan… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX36 | Mineur | Dashboard accueil — sur-récupération | L'accueil récupère 20 affaires (fetchAffairePageData({ size: 20 })) puis n'en affiche que 5 (slice(0,5)) dans 'Affaires récentes'. La donnée superflue (jointur… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX37 | Mineur | Dashboard accueil — KPI 'Affaires actives' | 'Affaires actives' = totalCount - archived, ce qui inclut les affaires 'Acceptées' (gagnées) dans les 'actives'. Pour un conducteur de travaux, une affaire acc… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX38 | Mineur | ChiffreurDashboard — TrendChart | Le graphe de tendance (barres CSS créés vs acceptés) n'a ni axe Y ni valeurs affichées ; les chiffres exacts ne sont accessibles qu'au survol (title) — inexplo… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX39 | Mineur | AffairesDenseTable — actions par ligne | Jusqu'à 5 actions icône par ligne (favori, hub, voir/éditer, supprimer) reposant uniquement sur des title au survol (non découvrables au tactile), avec l'icône… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX40 | Mineur | EstimateEventsTimeline — lisibilité des méta… | La colonne 'Métadonnées' concatène brutalement les paires clé/valeur ('cle: valeur \| cle: valeur') en normalisant juste les underscores, et fait un JSON.strin… | à traiter — non rouvert, aucun correctif livré ne le vise |

### Directeur / Direction (validation & marges) — 10 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX41 | Bloquant | Page détail devis — bascule de statut | Le bouton « Marquer envoyé » (rendu sur la fiche devis pour tout utilisateur pouvant éditer) appelle PATCH /status avec force: true codé en dur ET un If-Match:… | livré (`e10b045`) — plus de `force:true` codé en dur dans « Marquer envoyé » |
| UX42 | Majeur | Cockpit direction / File d'approbation — vis… | Le scellement (intégrité cryptographique) est central pour ce persona, mais SealIntegrityBadge n'est monté que sur la fiche devis et l'impression. Ni les carte… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX43 | Majeur | Gating pré-envoi — forçage | Le bouton « Forcer l'envoi » (visible quand canForce et blocants présents) déclenche onForceConfirm en un seul clic, sans champ de motif ni seconde confirmatio… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX44 | Majeur | File d'approbation — tri | L'inversion du sens de tri est morte : ApprovalQueuePage passe onDirectionToggle={() => {}} (no-op) au SortControl, et sortState.direction est systématiquement… | à traiter (vérifié) — `onDirectionToggle={() => {}}` toujours no-op dans ApprovalQueuePage |
| UX45 | Majeur | File d'approbation — état de revue (donnée p… | Une valeur d'énumération manifestement issue d'un nom de développeur, « review_laurent », est figée dans une contrainte CHECK de migration, dans le type Review… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX46 | Mineur | File hebdo — réassignation responsable | Le message de confirmation après réassignation est cassé : Affaire reassign ee a ${label} — espace parasite au milieu du mot et accents manquants (devrait être… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX47 | Mineur | Paramètres — Tranches de marge | MarginTiersManager sauvegarde seuil/multiplicateur au blur sans aucune confirmation de succès par ligne, le sens du « multiplicateur » n'est jamais explicité (… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX48 | Mineur | File d'approbation — feedback de tri/filtre | Le changement de tri ou du filtre « Exceptions seulement » fait un router.push vers un composant serveur qui refait la requête, mais l'écran ne fournit aucun é… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX49 | Polish | Cockpit direction — KPI aria-live | Le bloc des 3 KPI (Portefeuille / À surveiller / Validation) est enveloppé dans aria-live=polite + aria-atomic=true : à chaque changement de filtre, les trois … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX50 | Polish | Gating pré-envoi — sections vides | La modale de vérification affiche toujours les deux sections « Bloquants » et « Avertissements » avec leur paragraphe explicatif, même à zéro élément (« Aucun … | à traiter — non rouvert, aucun correctif livré ne le vise |

### Acheteur / Responsable achats — 13 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX51 | Majeur | Prix fournisseurs (/dashboard/prices) | Le filtre de fraîcheur est câblé sur une mauvaise clé d'URL et ne filtre donc rien. La config déclare la clé '_freshnessLevel' (PRICES_FILTERS), mais l'état lu… | livré (`8a685cf`) — la clé `_freshnessLevel` a disparu, le filtre fonctionne |
| UX52 | Majeur | Libellés FR (parcours achats complet) | Suppression systématique des accents dans de nombreux libellés d'action et de confirmation, sur un outil BTP français destiné aux achats. Exemples: message de … | **traité** (`157fe00`, complété le 2026-07-27) — comparateur fournisseurs, import CSV price book, catalogue et mapping sous garde |
| UX53 | Majeur | Comparaison fournisseurs (SupplierComparison… | Le panneau est un role='dialog' aria-modal='true' mais n'implémente ni fermeture au clavier (aucune gestion de la touche Échap), ni piège de focus, ni focus in… | livré (`ce09a53`) — fermeture par Échap et focus initial |
| UX54 | Majeur | Comparaison fournisseurs (SupplierComparison… | Le panneau liste les alternatives avec prix et badges mais n'affiche aucun écart chiffré vs la sélection actuelle: ni économie en euros, ni % d'écart, ni total… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX55 | Majeur | Comparaison fournisseurs — multi-devises | Le prix est affiché en formatEUR(adjusted_unit_price_cents) puis on concatène la devise brute de l'offre ( ${alternative.currency}), ce qui produit des rendus … | livré (`30a8b85` affichage par devise + `7977a53` sélection manuelle bloquée) |
| UX56 | Mineur | Fournisseurs (/dashboard/suppliers) | Le tableau fournisseurs n'expose que Nom/Contact/Ville/Email/Téléphone, alors que l'acheteur maintient et consulte régulièrement les conditions de paiement, le… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX57 | Mineur | Fournisseurs — suppression | La suppression fournisseur utilise window.confirm natif (style navigateur), incohérent avec la ConfirmModal soignée utilisée sur les BDC. De plus, l'erreur éve… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX58 | Mineur | Architecture d'information (Référentiel / Ta… | Le référentiel achats est éclaté entre deux hubs qui se recouvrent: le hub Référentiel liste Fournisseurs/Chantiers/Produits/Kits métiers, le hub Tarifs liste … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX59 | Mineur | Prix fournisseurs — stats | Les cartes de synthèse affichent Total, À jour, Anciens (>90j) et Fournisseurs couverts, mais omettent le bucket 'Vieillissant (30-90j)' qui existe pourtant co… | à traiter (vérifié) — `aging` n'existe que dans les options de filtre, pas dans les stats |
| UX60 | Mineur | Présélection fournisseurs — exceptions | La section 'Exceptions à arbitrer' décrit clairement la raison et les options visibles, mais n'offre aucune action pour résoudre l'exception (pas de lien vers … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX61 | Mineur | Application en masse des suggestions (BulkSu… | Le tableau Actuel/Proposé montre les changements (ex: PU) mais pas la provenance ni la fraîcheur de la valeur proposée (fournisseur, date du prix, source). En … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX62 | Polish | Comparaison fournisseurs — fraîcheur | Le panneau de comparaison n'affiche que la date ('Date: JJ/MM/AAAA') et un badge binaire 'Prix ancien', sans l'âge en jours ni le seuil, alors que la table des… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX63 | Polish | Finish line commandes — date de livraison | La date de livraison prévue mélange une valeur sentinelle 'TBD' (chaîne) dans un champ de type date via une case 'À déterminer'. Ce couplage chaîne/date est fr… | à traiter — non rouvert, aucun correctif livré ne le vise |

### Client / Maître d'ouvrage — 10 constats

| ID | Gravité | Surface | Observation | Statut |
|---|---|---|---|---|
| UX64 | Bloquant | Acceptation / CGV | La modale d'acceptation fait cocher « J'accepte ce devis et ses conditions » (AcceptEstimateModal.tsx:131) comme condition obligatoire de validation, mais le p… | **traité** (lot correctif 2026-07-27) — le snapshot CGV/exclusions validé est affiché et contrôlé fail-closed à l'acceptation |
| UX65 | Majeur | Copie du document | Aucun moyen depuis le portail de télécharger ou d'imprimer une copie du devis. page.tsx ne rend aucun bouton de téléchargement et EstimatePdfDownloadButton n'e… | **traité** (lot correctif 2026-07-27) — l'action d'impression reste disponible avant et après décision |
| UX66 | Majeur | Textes portail (FR) | Accents français absents sur toute la surface visible du client, ce qui fait amateur sur un document contractuel. Ex. « Ce devis a ete accepte. Merci pour votr… | livré (`5503cd7`) — accents rétablis sur le portail et le document client |
| UX67 | Majeur | Pages d'erreur / impasse | Les pages « Devis expiré » et « Lien invalide » demandent de « contacter votre interlocuteur » mais n'affichent aucun contact (nom, email, téléphone). Le clien… | à traiter (vérifié) — pages `expired` / `not-found` sans coordonnées émetteur |
| UX68 | Majeur | Cohérence document email vs portail | Le portail ignore la mise en page choisie par le chiffreur : page.tsx ne passe pas layout, donc EstimateDocument retombe sur DEFAULT_ESTIMATE_PDF_LAYOUT (prese… | **traité** (lot correctif 2026-07-27) — layout stocké et émetteur du document sont transmis au portail, avec fallback legacy |
| UX69 | Majeur | Signature | Le pad de signature n'est utilisable qu'à la souris/au tactile : les handlers sont mousedown/mousemove/touch (SignaturePad.tsx:142-148), sans alternative clavi… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX70 | Mineur | Signature | Le ResizeObserver efface silencieusement les traits à chaque redimensionnement du conteneur (SignaturePad.tsx:55-64), ce qui inclut la rotation d'écran mobile … | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX71 | Mineur | Acceptation / signature | Si l'upload de la signature échoue, l'acceptation aboutit quand même et la signature est silencieusement abandonnée (accept/route.ts:162-173, commentaire « don… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX72 | Mineur | En-tête / validité | Deux notions de validité coexistent et peuvent diverger : le PortalHeader affiche « Valide jusqu'au {expiresAt} » (expiration du token portail, PortalHeader.ts… | à traiter — non rouvert, aucun correctif livré ne le vise |
| UX73 | Polish | États post-décision / impression | Redondance d'indicateurs de statut : pour accepté/refusé/expiré, PortalHeader affiche déjà un badge de statut (PortalHeader.tsx:66-71) ET PortalActions affiche… | à traiter — non rouvert, aucun correctif livré ne le vise |

---

## 3. Ce qui reste à rapprocher

Bilan du rapprochement UX au 2026-07-27 :

| Statut | Nombre |
|---|---|
| livré ou traité, avec sa preuve | 17 |
| à traiter — **vérifié** encore ouvert dans le code | 7 |
| non rouvert | 49 |

### Campagne d'accents FR (UX10, UX23, UX34, UX52) — close sur les surfaces principales

Les quatre constats visaient le même défaut sur quatre parcours. Sur 552
libellés suspects au départ, 252 sont corrigés ; les 300 restants sont
concentrés hors des écrans visés : `lib/openapi/registry.ts` (39, descriptions
de doc API jamais affichées), `lib/takeoff/server.ts` (36),
`lib/estimates/generated-ouvrages.ts` (16).

Le gain est verrouillé par `src/lib/i18n/fr-accents.test.ts`, qui liste les
fichiers réellement relus et échoue si l'un régresse. **La liste s'étend
fichier par fichier, jamais en bloc** : une substitution automatique mot à mot
a été essayée puis abandonnée — sur 1170 chaînes elle francisait des noms de
tests anglais (« source details » → « source détails ») et laissait des
phrases à moitié corrigées (« déjà verrouillee »). Le garde a trouvé 21
fautes que la relecture manuelle avait manquées ; c'est lui qui fait
converger la campagne.

Le 2026-07-27, la garde a été étendue à `CatalogueManager`,
`MappingRuleEditor` et `TakeoffTableView` après correction des libellés encore
non accentués découverts par la revue des commits.

Deux pièges à connaître avant de reprendre le chantier :

- Les tokens courts sont préfixes d'autres mots (« Termine » de « Terminer »,
  « Reference » de « References »). Ils se remplacent guillemets compris.
- Un en-tête de colonne dans une fixture de test (« Designation » dans un
  collage Excel simulé) est de la **donnée**, pas un libellé. L'accentuer
  affaiblit le test. La distinction ne se mécanise pas.

Les 49 restants sont en majorité des améliorations de conception (visualiseur
de plan, dates de pilotage, écarts chiffrés, architecture d'information)
qu'aucun commit de la plage livrée ne vise. Les rouvrir un à un reste à faire,
mais le risque d'en trouver un déjà corrigé est faible.

Pour retrouver les correctifs livrés :

```bash
git log --oneline e6d4ed2^..HEAD
```

Marquer chaque ligne `livré (<sha>)`, `partiel (<sha>) — <ce qui reste>`,
`à traiter` ou `écarté — <raison>`. Un constat laissé ouvert sans raison
explicite est un constat perdu.
