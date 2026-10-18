# Créateurs prêts pour le moteur 3 (sous-lot 2.10a)

Statut : **phase rouge** (18/10/2026). Défaillances écrites avant les parcours, parcours écrits avant le code ;
aucune ligne de production n'est modifiée à ce stade. Branche `lot2/2.10a-createurs-v3`, base `origin/main`
`5cfd4a94` (2.8 fusionné ; #45 / 2.7 non fusionné, M5 non réhorodatée). Source : plan vers 2.10 (§1.2 N1, N3 ;
§3 « 2.10a » ; décisions du 18/10/2026 D-d, D-f, D-g, D-h), inventaire des écarts v3 (A1 à A4, A16), cahier de
la bascule (§2), conception du lot 2 §14 « 2.10 », P-12, P-14, P-19, D3, D16.

Règle du sous-lot : **sous une politique absente** (aujourd'hui moteur 2), rien ne change pour l'utilisateur.
Un créateur envoie alors l'attente 2 (ou aucune, ce qui vaut 2, D3) et obtient la même v2 qu'aujourd'hui.
Aucune version existante n'est modifiée ; aucune ligne de politique n'est écrite hors des fixtures ; aucune
migration n'est prévue. `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` ne changent
pas.

## 1. Défaillances observables (état de `5cfd4a94`)

Lecture du code ; chaque ligne est exposée par un parcours du §3, sauf mention contraire au §4.

| # | Défaillance (sous une politique 3) | Où | Parcours |
|---|---|---|---|
| F1 | L'assistant crée « Nouveau (vide) » sans attente de moteur : `409 CONTEXT_CHANGED`, « Rechargez la page avant de créer la version », en boucle (recharger ne change rien) ; rien n'est écrit | `client.ts:4141-4180` (aucun `expected_calc_engine_version`), `submitEstimateCreation.ts:62-90` ; `calc-policy-server.ts:96-103` (attente absente = 2) | V3C01 |
| F2 | « Créer directement » dans l'assistant : même `409 CONTEXT_CHANGED` | `submitEstimateCreation.ts:94-102` | V3C03 |
| F3 | L'étape de prix ne connaît pas la politique : elle propose « Marge fixe », « Marge par tranche » et « Marge (%) », aucun coefficient de vente ; une marge > 0 ou « par tranche » envoyée à une v3 donnerait `400 ESTIMATE_V3_VERSION_SETTINGS_INVALID` | `PricingStep.tsx:94-150` ; `submitEstimateCreation.ts:73-81` ; `v3-persistence.ts:133-158` | V3C02 |
| F4 | « Depuis un modèle » est refusé avant toute attente (`EstimateEngineUnavailableError`), puis la route le réemballe en `500 ESTIMATE_TEMPLATE_INSTANTIATE_FAILED` « Impossible d'instancier le template. » : la cause nommée est perdue | `canonical-v2-creation.ts:834-835` ; `templates-server.ts:372-397` ; `submitEstimateCreation.ts:28-40` | V3C04, V3C05 |
| F5 | Un modèle v2 qui porte une marge ≠ 1, des tranches, un coefficient global, une remise en cascade ou un arrondi au plus proche ou supérieur n'a aucune règle d'entrée en v3 : ces réglages seraient soit refusés (`assertEstimateV3VersionShape`), soit perdus sans le dire (D-h) | `canonical-v2-creation.ts:1004-1019` (réglages du modèle passés tels quels) ; `v3-persistence.ts:133-158` | V3C04 |
| F6 | Les lignes d'un modèle v2 entreraient en v3 sans la règle P-12 (h/u = h / Q au demi supérieur à 4 décimales) ni le rapport `converted_lines` que l'insertion M6 rend déjà ; un modèle converti différemment de son insertion dans une v3 vierge donnerait d'autres montants | `canonical-v2-creation.ts:834` (pas de branche `template`) ; `template-v3-hours.ts` (utilisé à l'insertion seulement, `assemblies-server.ts:974`) | V3C04 |
| F7 | Un modèle enregistré depuis une v3 (M6 copie ses coefficients et ses h/u) ne peut pas être instancié : ses coefficients ne sont lus par aucun chemin | `canonical-v2-creation.ts:834` ; `instantiateCanonicalEstimateV2FromTemplate` (`:969-1025`) | V3C05 |
| F8 | Mode « DPGF source à importer » de l'assistant, **choisi par défaut** dès que l'affaire a un DPGF lié : lignes normalisées pour la v2 (`entry: "direct"`, sans `engine: 3`), puis `409 ESTIMATE_ENGINE_UNAVAILABLE` « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action. » | `useEstimateCreationResources.ts:96-104` ; `server.ts:4677-4741` ; `canonical-v2-creation.ts:834-835` | V3C06 |
| F9 | Création d'une affaire depuis l'accueil (« Créer l'affaire », `initializeAffaireDraft`) : la version vierge part sans attente, donc `CONTEXT_CHANGED` ; l'affaire n'est pas créée | `AffaireOnboardingClient.tsx:42` ; `quick-create-affaire.ts:107-131` (`createProjectWithBlankEstimate`) | V3C07 |
| F10 | Création rapide d'une affaire depuis un import sûr : import sans `engine: 3`, refus, puis message générique « Impossible de créer l'affaire depuis l'import. » (cause nommée perdue) ; sans import ou avec un import peu sûr, `CONTEXT_CHANGED` | `quick-create-affaire.ts:363-392`, `:107-131` | §4 (aucun écran ne l'atteint) |
| F11 | `startAffaireManualEstimate` : création vierge sans attente, `CONTEXT_CHANGED` | `quick-create-affaire.ts:236-262` | §4 (aucun écran ne l'atteint) |
| F12 | Métré sur une v3 : la proposition d'analyse du hub (« Lancer une première analyse », affaire neuve), « Analyser les plans » et l'envoi d'un fichier de métré sont acceptés, l'analyse tourne, puis l'application est refusée (`TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`) : l'utilisateur fait tout le travail avant le refus (N3, D-f) | `TakeoffLaunchPrompt.tsx:304` (aussi dans `PlansStep.tsx:390`) ; `LaunchMetreDialog.tsx:728` ; `takeoff/server.ts:7649-7677` (`createTakeoffJobFromPlanSet`, aucun contrôle de moteur), `createTakeoffJobFromFormData` (`:7346`) ; refus à l'application seulement, `:6893` | V3C08 |
| F13 | Structure IA sur une v3 : « Proposer une structure avec l'IA » est actif et ouvre l'assistant (aussi par `?openStructureDraft=1`, suggestion du hub) ; le refus n'arrive qu'à la génération (2.8 IO08) (N3, D-g) | `EstimateEditorCommandBar.tsx:381-396` ; `edit/page.tsx:42-62` ; `cockpit/suggestions.ts:385` | V3C09 |
| F14 | Évolution de la marge du hub : toute v3 est retirée de la série sans le dire ; avec une seule v1/v2 restante le graphique disparaît (D-d) | `affaires/server.ts:2161-2167` ; `MarginAnalysisWidget.tsx:353` | V3C10 |
| F15 | Garde : sous une politique absente, un créateur change de moteur ou de valeurs (marge 15 %, tranches, arrondi, réglages et heures d'un modèle v2, lignes d'un DPGF lié), ou une politique est écrite par la création | tous les créateurs ci-dessus | V3C11, V3C12 |
| F16 | Garde : une attente supprimée côté serveur pour faire passer un parcours (interdit, D3) : une création sans attente sous politique 3 doit rester refusée en `CONTEXT_CHANGED` | `calc-policy-server.ts:96-103` | V3P01 (2.5, inchangé) |

Constats de lecture qui changent le périmètre du plan :

- **`QuickCreateAffaireDialog` n'est monté par aucune page** depuis `774ffa25` (EST-446, 11/03/2026, création
  d'affaire déplacée vers l'accueil) ; la carte d'impact le classe dans `runtime-unused-modules`.
  `startAffaireManualEstimate` n'a aucun appelant hors de ses tests. F10 et F11 ne sont donc atteints par aucun
  utilisateur aujourd'hui ; leur code partage `createProjectWithBlankEstimate` avec l'accueil (F9, couvert).
- **La version zéro n'a aucune entrée d'interface** sur aucun moteur : `isEstimateAiDraftEnabled()` rend `false`
  (TI-582, `ai-draft-availability.ts:2-4`). Son refus nommé avant tout travail sur une v3 est déjà prouvé par
  l'API (2.8 IO08, vert).
- L'étape de prix ne propose déjà, pour un nouveau choix, que « Aucun » et les paliers inférieurs
  (`rounding-options.ts`) : l'arrondi n'est pas une défaillance, il reste asserté par V3C02.

## 2. Contrat attendu (ce que le vert rend observable)

Chaque création sous politique 3 relue en SQL par le propriétaire natif de la pile : `calc_engine_version = 3`,
coefficients, réglages de version, nombre de versions de l'affaire +1, et politique de l'entreprise inchangée
(moteur, coefficients, nombre d'événements).

1. **Attente partout (N1).** La page de l'assistant lit `readTenantCalcPolicy` côté serveur et transmet le
   moteur et les coefficients par défaut. Toute requête de création de l'assistant porte
   `version.expected_calc_engine_version` (vierge, « Créer directement », DPGF lié) ou
   `expected_calc_engine_version` (modèle) égal au moteur de la politique. L'accueil déclare le moteur de la
   politique qu'il lit, comme `import-flow.ts:582`. Sous une politique absente, l'attente vaut 2.
2. **Étape de prix v3 (A4).** Sous moteur 3 : « Coefficient de vente FO » et « Coefficient de vente MO »
   (champs saisissables, initialisés à la politique : « 1,30 », « 1,20 ») ; ni « Marge fixe », ni « Marge par
   tranche », ni « Marge (%) » ; « Arrondi » limité à « Aucun » et aux paliers inférieurs. La requête porte
   `sale_coefficient_fo`, `sale_coefficient_mo`, `rounding_mode` et `rounding_step_cents`, et **aucune** des
   clés `margin_mode`, `margin_bp`, `margin_multiplier`, `global_coefficient`, `discount_steps`.
3. **Modèle vers v3 (A1, D-h).** Instanciation dans la transaction de création :
   - lignes converties par la règle P-12 de l'insertion M6 (`template-v3-hours.ts`, étendue à l'atelier et au
     chantier), unité = `unit_code` du modèle, sinon référentiel sur `description` ; mêmes refus nommés que M6 ;
     lignes et totaux **identiques** à l'insertion du même modèle dans une v3 vierge (oracle M6) ;
   - coefficients : ceux du modèle v3, sinon ceux de la politique ;
   - réglages v2 non représentables **non repris** et listés ; réglages v3 de la version neutres (marge fixe 1,
     coefficient global 1, remise simple, arrondi « aucun » ou inférieur) ;
   - réponse `201` de `POST /api/estimates/templates/{id}/instantiate` : `converted_lines`
     (`[{ title, template_hours, converted_hours }]`, même forme que l'insertion) et `dropped_settings`
     (`[{ setting, label }]`) ; clés attendues par réglage : `margin_multiplier` (marge ≠ 1),
     `margin_mode` (tranches), `global_coefficient`, `discount_mode` (remise en cascade), `rounding_mode`
     (au plus proche ou supérieur) ;
   - à l'écran, après la création, un avertissement titré « Modèle converti au moteur de calcul 3 » qui
     contient « Réglages du modèle non repris : » suivi des libellés (« Marge 15 % », « Coefficient global
     1,02 », « Arrondi au palier supérieur de 10,00 € », « Marge par tranche », « Remise en cascade 10 % puis
     5 % ») et « Lignes converties : » suivi de « <titre> : 1 h → 0,9 h ».
4. **DPGF lié (A3) et création rapide depuis un import (A2).** `resolveImportSaleCoefficients` et
   `v3LineContext` passent de l'action d'application vers `src/lib/affaires/` et sont réutilisés : unités du
   référentiel (`m` → `ml`), PR FO, PU et totaux du moteur 3, provenance de l'import gardée. Les replis
   existants restent quand un aperçu est requis (`IMPORT_PREVIEW_REQUIRED_MESSAGE`, aucune ligne à 0 €/h). La
   création rapide garde la cause nommée au lieu du message générique.
5. **Métré (N3, D-f).** Sur une cible v3, la proposition d'analyse du hub (région « Proposition d'analyse
   automatique ») et la boîte « Analyser les plans » affichent chacune « Le métré ne s'applique pas à un devis
   en moteur de calcul 3. » et leur « Analyser maintenant » est désactivé ; `POST
   /api/takeoff/jobs` répond `409 TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` avant tout dépôt ; aucune tâche
   n'est écrite.
6. **Structure IA (N3, D-g).** Sur une v3, « Proposer une structure avec l'IA » est désactivé, avec pour
   description accessible « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette
   action. » ; `?openStructureDraft=1` n'ouvre pas l'assistant « Structure IA ».
7. **Évolution de la marge (A16, D-d).** Les points v1/v2 restent ; la section « Analyse de marge » affiche
   « Évolution de la marge indisponible pour le moteur de calcul 3 : V3. » (versions v3 nommées).

## 3. Parcours rouges (`e2e/army/local/engine-v3-creators.e2e.ts`)

Suite locale `critical` sur la pile possédée (le motif `engine-v3-*.e2e.ts` de `e2e.config.ts` l'inclut).
Chaque parcours a son **propriétaire dédié** (aide `useDedicatedV3Owner` du 2.5) : la fenêtre de politique 3
(1,30 / 1,20, `set_tenant_calc_policy` en `service_role`, transport SQL possédé) ne touche aucun parcours
concurrent ; elle est refermée à 2 dans un `finally`, comme IO01 à IO09. Les gardes V3C11 et V3C12 tournent sous
une **politique absente** (aucune ligne écrite). Les valeurs attendues sont exactes ; les versions sont relues en
SQL (`calc_engine_version`, coefficients, réglages, totaux), les lignes par l'API.

| Id | Créateur, politique | Attendu (vert) | Rouge attendu |
|---|---|---|---|
| V3C01 | Assistant « Nouveau (vide) », réglages par défaut, nouvelle affaire ; 3 | 201 ; attente 3 envoyée ; une version : moteur 3, 1,30 / 1,20, marge fixe 1, coefficient global 1, arrondi aucun, totaux 0 ; éditeur ouvert ; politique inchangée | 409 `CONTEXT_CHANGED`, alerte « Rechargez la page… », aucune affaire |
| V3C02 | Étape de prix v3, nouvelle affaire ; 3 | champs FO/MO à « 1,30 » / « 1,20 », aucun contrôle de marge, arrondi aucun ou inférieur ; saisie 1,25 / 1,15 et « 100,00 € — palier inférieur » ; requête sans clé v2 ; v3 à 1,25 / 1,15, `down` 10 000 | étape v2 (contrôles de marge, aucun coefficient) |
| V3C03 | « Créer directement » sur une affaire à ancre v2 ; 3 | attente 3 ; V2 en moteur 3 à 1,30 / 1,20 ; ancre V1 identique (SQL) | 409 `CONTEXT_CHANGED`, une seule version |
| V3C04 | Assistant depuis deux modèles v2 (T1 : marge 15 %, coefficient global 1,02, arrondi supérieur 10 € ; T2 : tranches, remise en cascade 10 % puis 5 %) ; 3 | chaque v3 = oracle M6 (même modèle inséré dans une v3 vierge) en lignes et totaux ; tube 37,00 € / 370,00 € ; `converted_lines` = collier 1 h → 0,9 h ; `dropped_settings` T1 `[margin_multiplier, global_coefficient, rounding_mode]`, T2 `[margin_mode, discount_mode]` ; avertissement avec les libellés ; réglages v3 neutres | 500 `ESTIMATE_TEMPLATE_INSTANTIATE_FAILED` (ou 409), rien d'écrit |
| V3C05 | Assistant depuis un modèle enregistré d'une v3 à 1,10 / 1,05 ; 3 | v3 à 1,10 / 1,05 ; `unit_code` et h/u du modèle ; lignes et totaux = v3 source (tube 32,00 € / 320,00 €) ; aucune ligne convertie, aucun réglage retiré | 500 (ou 409), rien d'écrit |
| V3C06 | Assistant, DPGF lié choisi par défaut (CSV 2 lignes lié par le hub) ; 3 | v3 à 1,30 / 1,20 ; `ml` 2 × PR 12,50 → PU 16,25, 32,50 € ; `u` 1 × PR 65,00 → PU 84,50 € ; HT 117,00 €, TVA 23,40 €, TTC 140,40 € ; provenance de l'import | 409 `ESTIMATE_ENGINE_UNAVAILABLE`, rien d'écrit |
| V3C07 | Accueil « Créer l'affaire » ; 3 | affaire et une version v3 vierge à 1,30 / 1,20, éditeur ouvert | erreur à l'écran, aucune affaire |
| V3C08 | Métré sur une v3 (jeu de plans réel, `sample-plan.pdf`) ; 3 | motif nommé et « Analyser maintenant » désactivé dans la proposition d'analyse (v3 sans ligne) puis dans « Analyser les plans » (v3 avec une ligne) ; API 409 `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` ; aucune tâche | boutons actifs ; l'API crée une tâche (annulée par le parcours) |
| V3C09 | Structure IA sur une v3 (éditeur, Expert) ; 3 | bouton désactivé avec le motif ; `?openStructureDraft=1` n'ouvre rien ; aucune entrée de version zéro (TI-582, tous moteurs) | bouton actif, l'assistant s'ouvre |
| V3C10 | Hub, affaire V1 v2 (15 %), V2 v2 (10 %), V3 v3 ; 3 puis 2 | graphique V1, V2 ; avis « … indisponible pour le moteur de calcul 3 : V3. » | graphique V1, V2 sans avis |
| V3C11 | **Garde**, politique absente : assistant vierge à 15 % et palier inférieur 100 €, assistant « Marge par tranche », « Créer directement », accueil | v2 aux valeurs d'aujourd'hui (1,15 / 1 500 bp, `down` 10 000 ; `tiered` ; réglages hérités de la dernière version ; marge 1) ; attente absente ou 2 ; aucune politique écrite | vert avant |
| V3C12 | **Garde**, politique absente : assistant depuis T1, assistant avec DPGF lié | v2 avec les réglages de T1 et ses heures (5 h, 1 h) ; DPGF : description `m` / `u`, PU 12,50 / 65,00 €, HT 90,00 €, TVA 18,00 € | vert avant |

Correspondance avec le plan : V3S01a → V3C01, V3S03 → V3C02, V3S04 → V3C04 et V3C05, V3T01 → oracle de V3C04,
V3S05 → V3C06, V3S06 → §4, V3S07 → V3C07, V3S08 → V3C08 et V3C09, V3S09 → V3C11 et V3C12 (politique absente,
comme le demande la consigne du sous-lot ; une politique 2 explicite suit le même code, `policy.engine === 2`).

Carte d'impact : le fichier rejoint `suite.journeys` et les groupes `wizard`, `affaires-list` et `affaire-hub`
(`src/test/army-impact-map.test.ts`).

## 4. Chemins sans parcours, isolation

- **F10, F11** (création rapide depuis un import, démarrage manuel) : aucun écran ne les atteint (§1). Aucun
  parcours d'interface ne peut les exposer ; un test isolé de ces actions serveur ne vérifierait que des
  simulations (`quick-create-affaire.test.ts` simule `persistCanonicalEstimateV2`). **Décision à prendre** par
  le coordinateur : soit les retirer (code mort, hors de ce sous-lot), soit les corriger avec l'outil commun du
  point 4 du §2 sans preuve d'interface. Le partage de `createProjectWithBlankEstimate` avec l'accueil est
  prouvé par V3C07.
- **Version zéro** : aucune entrée d'interface (§1) ; refus d'API prouvé par IO08.
- **Isolation** : aucune au rouge. La parité TS/SQL de la conversion d'un modèle est prouvée par l'oracle M6
  de V3C04 (même pile, mêmes données).
- Repli « aperçu requis » d'un DPGF lié qui porte des h/u : code inchangé (`importRequiresPreview` avant toute
  normalisation) ; le vert doit le garder avant la branche v3. Un parcours dédié demanderait un import avec
  rôle MO choisi à l'aperçu ; il n'est pas écrit au rouge.

## 5. Exécution rouge

À compléter par l'exécution (commande, révision, manifeste, attendu et observé par parcours).
