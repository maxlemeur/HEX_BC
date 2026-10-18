# Créateurs prêts pour le moteur 3 (sous-lot 2.10a)

Statut : **vert** (18/10/2026). Défaillances écrites avant les parcours, parcours écrits avant le code, rouges
conservés (§5), correction (§6), preuves qualifiantes (§7), décisions et limites (§8), revue indépendante et
clôture de ses constats (§9), revue Codex de la PR #57 (§10). Branche
`lot2/2.10a-createurs-v3`, base `origin/main` `5cfd4a94` (2.8 fusionné), puis fusion de `origin/main` `d7e672b4`
(#45 / 2.7 non fusionné à cette date, M5 non réhorodatée). PR #57, fusionnée (`59b3b6bf`) ; son constat Codex
passe par la PR de suivi `fix/lot2-2.10a-a16-notice-without-section` (§10). Source : plan vers 2.10 (§1.2 N1, N3 ;
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
   `version.expected_calc_engine_version` (vierge, « Créer directement », DPGF lié) ou, au premier niveau,
   `expectedCalcEngineVersion` (modèle, corps camelCase du client, normalisé en `expected_calc_engine_version` par
   le schéma) égal au moteur de la politique. L'accueil déclare le moteur de la politique qu'il lit, comme
   `import-flow.ts:582`. Sous une politique absente, l'attente vaut 2.
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
   n'est écrite. Même refus pour la proposition de l'étape des plans après un import qui crée une v3, et pour
   les actions serveur du hub (`createTakeoffJobFromPlanSet`) ; « Créer un brouillon depuis V… » refuse une source
   v3 avant de la copier (revue, §9).
6. **Structure IA (N3, D-g).** Sur une v3, « Proposer une structure avec l'IA » est désactivé, avec pour
   description accessible « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette
   action. » ; `?openStructureDraft=1` n'ouvre pas l'assistant « Structure IA » ; le hub ne propose plus
   « Ouvrir la structure préliminaire » pour un brouillon v3.
7. **Évolution de la marge (A16, D-d).** Les points v1/v2 restent ; la section « Analyse de marge » affiche
   « Évolution de la marge indisponible pour le moteur de calcul 3 : V3. » (versions v3 nommées). Sans analyse
   calculable (version courante sans ligne ni section racine, comme une v3 vierge), la carte garde l'avis seul,
   hors du démarrage du hub où elle reste masquée pour tous les moteurs (§10).

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
| V3C14 | Hub (§10), affaire à DPGF lié, V1 v2 vierge puis V2 v3 vierge ; 3 puis 2 | V1 seule : aucune carte ; avec la V2 : carte avec l'avis « … : V2. » seul, ni indicateurs ni graphique | aucune carte avec la V2 |
| V3C11 | **Garde**, politique absente : assistant vierge à 15 % et palier inférieur 100 €, assistant « Marge par tranche », « Créer directement », accueil | v2 aux valeurs d'aujourd'hui (1,15 / 1 500 bp, `down` 10 000 ; `tiered` ; réglages hérités de la dernière version ; marge 1) ; attente absente ou 2 ; aucune politique écrite | vert avant |
| V3C12 | **Garde**, politique absente : assistant depuis T1, assistant avec DPGF lié | v2 avec les réglages de T1 et ses heures (5 h, 1 h) ; DPGF : description `m` / `u`, PU 12,50 / 65,00 €, HT 90,00 €, TVA 18,00 € | vert avant |

Correspondance avec le plan : V3S01a → V3C01, V3S03 → V3C02, V3S04 → V3C04 et V3C05, V3T01 → oracle de V3C04,
V3S05 → V3C06, V3S06 → §4, V3S07 → V3C07, V3S08 → V3C08 et V3C09, V3S09 → V3C11 et V3C12 (politique absente,
comme le demande la consigne du sous-lot ; une politique 2 explicite suit le même code, `policy.engine === 2`).
Après la revue : V3C08 appelle aussi l'action « Créer un brouillon depuis V… » sur la v3, et V3C13 prouve les
refus nommés et les heures atelier / chantier de la création depuis un modèle (§9). Après la revue Codex de la
PR #57 : V3C14 (§10).

Carte d'impact : le fichier rejoint `suite.journeys` et les groupes `wizard`, `affaires-list` et `affaire-hub`
(`src/test/army-impact-map.test.ts`).

## 4. Chemins sans parcours, isolation

- **F10, F11** (création rapide depuis un import, démarrage manuel) : aucun écran ne les atteint (§1). Aucun
  parcours d'interface ne peut les exposer ; un test isolé de ces actions serveur ne vérifierait que des
  simulations (`quick-create-affaire.test.ts` simule `persistCanonicalEstimateV2`). **Décision du vert** (§8) :
  corrigés avec l'outil commun du point 4 du §2, sans preuve d'interface ; leur retrait reste hors du sous-lot.
  Le partage de `createProjectWithBlankEstimate` avec l'accueil est prouvé par V3C07, celui de la
  normalisation d'import v3 avec la source DPGF liée par V3C06.
- **Version zéro** : aucune entrée d'interface (§1) ; refus d'API prouvé par IO08.
- **Isolation** : aucune au rouge. La parité TS/SQL de la conversion d'un modèle est prouvée par l'oracle M6
  de V3C04 (même pile, mêmes données).
- Repli « aperçu requis » d'un DPGF lié qui porte des h/u : `importRequiresPreview` reste évalué avant toute
  création, sur les lignes normalisées pour le moteur de la politique ; en v3 il couvre aussi une colonne
  d'heures par ligne (§6). Un parcours dédié demanderait un import avec rôle MO choisi à l'aperçu ; il n'est
  pas écrit (limite, §8).

## 5. Exécution rouge (18/10/2026, WSL Ubuntu 24.04, Node 24.19.0, Supabase CLI 2.120.0 natif)

Boucle d'itération sur une pile possédée et jetable (`miaouffrage-ci-373826-85124bb1`), **pas un run
qualifiant** : `npm run e2e:army:dev-loop -- start --app-port 3171 --ttl-minutes 180`, puis
`run --grep '^V3C(0[1-9]|1[0-2]) '`, puis `stop` (pile, registre et ports libérés). `E2E_ARMY_WORKERS=2`.
Migrations, pgTAP (1 886 assertions) et matrice RLS verts au démarrage. Build `DHL0UDEmXr-hw26Z-QmEF`
(empreinte applicative `89a59de2…`, sources de `5cfd4a94` : aucun code de production modifié), jamais
reconstruit pendant la boucle.

| Itération | Révision | Sélection | Résultat |
|---|---|---|---|
| 1 | `1d26c1c8` | V3C01 à V3C12 | 8 rouges métier ; V3C08 et V3C09 arrêtés dans leurs préalables (preuve manquante, pas un rouge) ; V3C11, V3C12 verts |
| 2 | `bb4772f3` | V3C08, V3C09 | 2 rouges métier, après correction des préalables (ci-dessous) |
| 3 | `bb4772f3`, diff vide | V3C01 à V3C12 | **10 rouges métier, 2 gardes vertes**, connexion verte ; parcours 67 s |

Correction entre 1 et 2 : une v3 sans ligne laisse le hub en « affaire neuve », qui montre la proposition
d'analyse au lieu de la section « Plans, preuves & exceptions » ; V3C08 lit désormais cette proposition
(troisième entrée du métré, F12), puis ajoute une ligne et ouvre « Analyser les plans ». V3C09 ouvre l'onglet
« Insérer » du ruban avant le panneau.

Rouges de l'itération 3 (attendu au §3) :

| Id | Observé |
|---|---|
| V3C01 | `409 CONTEXT_CHANGED`, aucune attente envoyée, aucune affaire écrite, politique inchangée |
| V3C02 | étape de prix v2 : « Marge fixe », « Marge par tranche », « Marge (%) » ; aucun champ de coefficient ; arrondi déjà limité à « Aucun » et aux paliers inférieurs |
| V3C03 | `409 CONTEXT_CHANGED`, aucune attente, l'affaire garde sa seule ancre v2 (identique en SQL) |
| V3C04 | T1 et T2 : `500 ESTIMATE_TEMPLATE_INSTANTIATE_FAILED`, aucune attente, aucune version ; l'oracle M6 (même T1 inséré dans une v3 vierge) rend bien `converted_lines` = collier 1 h → 0,9 h |
| V3C05 | `500 ESTIMATE_TEMPLATE_INSTANTIATE_FAILED`, aucune version ; la v3 source rend bien 32,00 € / 320,00 € pour le tube à 1,10 / 1,05 |
| V3C06 | « DPGF source à importer » choisi par défaut, `creation_mode=linked_dpgf_source`, puis `409 ESTIMATE_ENGINE_UNAVAILABLE`, aucune version |
| V3C07 | l'accueil affiche « Minified React error #441… » à la place d'une cause, aucune affaire écrite |
| V3C08 | proposition et « Analyser les plans » ciblent la v3, sans motif, « Analyser maintenant » actif ; l'API rend `201` et écrit une tâche `pending` (annulée par le parcours) |
| V3C09 | « Proposer une structure avec l'IA » actif, sans description ; `?openStructureDraft=1` ouvre « Structure IA » ; aucune entrée de version zéro (attendu) |
| V3C10 | graphique V1, V2 ; aucun avis pour la V3 |

Gardes vertes avant le code (politique absente, aucune ligne de politique écrite) :

- **V3C11** : assistant à 15 % et palier inférieur 100 € → v2 `fixed` 1,15 / 1 500 bp, `down` 10 000 ;
  « Marge par tranche » → v2 `tiered` (marge et pas d'arrondi hérités de V1) ; « Créer directement » → v2 aux
  réglages de V2 ; accueil → v2 `fixed` 1 / 0, `none` ; aucune attente envoyée (vaut 2).
- **V3C12** : modèle v2 sur une nouvelle affaire → v2 aux réglages de sa source (1,15, coefficient global
  1,02, `up` 1 000), lignes et totaux identiques, heures 5 h et 1 h gardées, aucun rapport ; DPGF lié → v2,
  description `m` / `u`, PU 12,50 / 65,00 €, HT 90,00 €, TVA 18,00 €, TTC 108,00 €.

Preuves (non versionnées) : `.e2e/army/ci/2026-10-18T09-31-47-425Z-dev-loop/iterations/003-2026-10-18T09-42-13-524Z/manifest.json`
et l'archive SDK `.e2e/army/critical/runs/2026-10-18T09-42-14-016Z/` du clone WSL `~/miaouffrage-l2-210a`,
copiées avec les trois itérations, les journaux et les enregistrements métier `ARMY-*-v3c*.json` dans
`.e2e/lot2-2.10a/red/` de la copie de travail (120 fichiers, `SHA256SUMS`). Le vert devra être prouvé par un
run qualifiant (`e2e:army:local`), pas par cette boucle.

## 6. Correction (vert)

Code : `661e257e`, puis fusion de `origin/main` `d7e672b4` (`3c9dd453`, sans conflit). Aucune migration, aucune
ligne de politique écrite hors des fixtures, aucune version existante modifiée. `src/lib/estimate-calculations.ts`
et `src/lib/estimate-v2-snapshot.ts` inchangés.

| Défaillance | Correction | Fichiers |
|---|---|---|
| F1, F2, F9, F11 (N1) | La page de l'assistant devient une enveloppe serveur : elle lit `readTenantCalcPolicy` pour l'entreprise active et transmet le moteur et les coefficients par défaut à `NewEstimatePage` (client). Toute création de l'assistant (vierge, « Créer directement », modèle, DPGF lié) envoie ce moteur comme attente, 2 compris. Les actions de l'accueil et de la création rapide déclarent le moteur de la politique qu'elles lisent (`readExpectedCreationEngine`). La RPC relit la politique sous verrou : une politique changée après le rendu donne `CONTEXT_CHANGED`, et recharger la page lit la nouvelle | `estimates/new/page.tsx`, `NewEstimatePage.tsx`, `EstimateCreationWizard.tsx`, `submitEstimateCreation.ts`, `client.ts`, `quick-create-affaire.ts` |
| F3 (A4) | Sous moteur 3, l'étape de prix remplace « Mode de marge » par « Coefficients de vente » (« Coefficient de vente FO » / « MO », texte saisi initialisé à la politique, `]0 ; 10]`, 4 décimales, mêmes bornes que l'éditeur v3). L'arrondi garde « Aucun » et les paliers inférieurs ; un mode v2 restauré d'un brouillon vaut « Aucun ». La requête porte `sale_coefficient_fo/mo`, `rounding_mode`, `rounding_step_cents` (palier inférieur seulement), jamais `margin_*`, `global_coefficient` ni `discount_steps` | `PricingStep.tsx`, `shared.ts`, `useEstimateCreationDraft.ts`, `submitEstimateCreation.ts` |
| F4 à F7 (A1, D-h) | `persistCanonicalEstimateV2` admet un modèle en moteur 3, dans la même transaction. Lignes : miroir de M6 (`toV3TemplateLine`) : Q absente 1, PR 0, K 1, heures par unité du modèle issu d'une v3, sinon h / Q au demi supérieur à 4 décimales atelier et chantier compris (`templateLineHoursPerUnitForV3`), unité du modèle, sinon référentiel sur `description` pour une ligne chiffrée (`normalizeMeasurementUnit`, identique à `private.normalize_unit`), TVA absente = celle de la version ; refus nommés de M6 (`ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY`, `ESTIMATE_TEMPLATE_LABOR_ROLE_REQUIRED`, partagés avec l'insertion). Réglages : `resolveTemplateV3VersionSettings` reprend devise, TVA, remise simple (montant prioritaire, comme en v2) et palier inférieur ; marge ≠ 1, marge par tranche, coefficient global ≠ 1, remise en cascade, arrondi au plus proche ou supérieur ne sont pas repris et sont listés avec leur libellé. Coefficients : ceux du modèle issu d'une v3, sinon ceux de la politique. Réponse `201` : `converted_lines` (même rapport que l'insertion) et `dropped_settings`, en v3 seulement ; la route garde la cause nommée au lieu du 500 ; l'assistant montre l'avertissement « Modèle converti au moteur de calcul 3 » (15 s) | `canonical-v2-creation.ts`, `template-v3-hours.ts`, `template-v3-settings.ts`, `estimate-template-helpers.ts`, `assemblies-server.ts`, `templates-server.ts`, `schemas.ts`, `NewEstimatePage.tsx` |
| F8, F10 (A2, A3) | `resolveImportSaleCoefficients` et `v3LineContext` passent dans `src/lib/affaires/import-engine-server.ts`, réutilisés par l'import de l'affaire, la source DPGF liée de l'assistant (coefficients saisis dans l'assistant, sinon la politique) et la création rapide depuis un import. Sous moteur 3, `importRequiresPreview` couvre aussi une colonne d'heures par ligne (`line_hours_require_hours_per_unit`) : sans aperçu, ces lignes seraient perdues ou leurs heures à 0 €/h. La création rapide garde la cause nommée dans son message | `import-engine-server.ts`, `_actions/import-flow.ts`, `lib/affaires/import-flow.ts`, `estimates/server.ts`, `quick-create-affaire.ts` |
| F12 (N3, D-f) | La création d'une tâche de métré refuse une cible v3 par `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` (même code et message que l'application) avant tout dépôt (`assertEstimateVersionAccessibleAsDraft`, API et actions du hub). La proposition d'analyse du hub, celle de l'étape des plans après un import v3 et la boîte « Analyser les plans » (cible courante ou copie d'une v3) affichent le motif et désactivent le lancement ; le moteur des versions vient du résumé du hub et de `fetchProjectVersionList` | `takeoff/server.ts`, `takeoff/engine-support.ts`, `TakeoffLaunchPrompt.tsx`, `LaunchMetreDialog.tsx`, `PlansStep.tsx`, `UnifiedImportFlow.tsx`, `AffaireHub.tsx`, `affaires/server.ts`, `launch-context.ts`, pages du hub et du métré |
| F13 (N3, D-g) | « Proposer une structure avec l'IA » est désactivé sur une v3, le motif `ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE` affiché sous le bouton et lié par `aria-describedby` ; `?openStructureDraft=1` n'ouvre rien ; le hub ne propose plus « Ouvrir la structure préliminaire » pour un brouillon v3. Version zéro : aucune entrée d'interface (TI-582), refus d'API inchangé (IO08) | `EstimateEditorCommandBar.tsx`, `EstimateEditorToolbar.tsx`, `EstimateEditorTable.tsx`, `useEstimateEditorState.impl.tsx`, `cockpit/suggestions.ts` |
| F14 (A16, D-d) | L'analyse de marge rend `versionEvolutionUnavailableV3` (numéros des v3) ; le hub affiche « Évolution de la marge indisponible pour le moteur de calcul 3 : V3. » sous le graphique, qui garde les points v1/v2 | `affaires/server.ts`, `MarginAnalysisWidget.tsx` |
| Constante v2 | La préparation v2 utilise `CANONICAL_V2_CALC_ENGINE_VERSION` (2), atteinte seulement quand la politique vaut 2 ; `NEW_ESTIMATE_CALC_ENGINE_VERSION` n'est plus lue par la création | `canonical-v2-creation.ts` |
| OpenAPI | `expected_calc_engine_version` de l'instanciation, `converted_lines` et `dropped_settings`, 400 et 409 de l'instanciation, 409 de `POST /api/takeoff/jobs`, création : retrait du refus `ESTIMATE_ENGINE_UNAVAILABLE` des modèles et imports | `registry.ts`, `openapi.json` |

Sous une politique absente : même v2 qu'avant (V3C11, V3C12). La seule différence observable dans la requête est
l'attente explicite 2, équivalente à son absence (D3). Les fins de ligne d'origine sont gardées, fichiers mixtes
compris (`git -c core.whitespace=cr-at-eol diff --check` propre).

Test isolé touché : `quick-create-affaire.test.ts` simule la politique absente (le stub refusait toute table non
prévue) et attend l'attente 2 dans les appels à `createEstimate`. Aucun test isolé ajouté.

## 7. Preuves vertes (18/10/2026, WSL Ubuntu 24.04, Node 24.19.0, Supabase CLI 2.120.0 natif, `E2E_ARMY_WORKERS=2`)

Runs qualifiants sur la tête de code `3c9dd453` (fusion de `origin/main` `d7e672b4` comprise), clone WSL propre
(`git diff HEAD` vide), chacun sur sa pile possédée et jetable, migrations, pgTAP et matrice RLS verts avant les
parcours, pile et ports libérés à la fin. Le commit suivant ne touche que cette fiche.

| Preuve | Commande | Résultat | Preuves (copie de travail, `.e2e/lot2-2.10a/green/`) |
|---|---|---|---|
| Parcours 2.10a et parcours de création | `npm run e2e:army:local -- --grep '^V3C(0[1-9]\|1[0-2]) \|[Ww]izard\|[Cc]réation\|[Cc]reation\|[Tt]emplate\|[Mm]odèle\|[Ii]mport\|[Oo]nboarding\|[Qq]uick\|^V3P01 \|^V3E0[1-4] \|^IO0' --app-port 3171` | **34/34** (`filtered-critical`) : V3C01 à V3C12 ; IO01, IO03 à IO09 ; V3E01 à V3E04, V3E11 (remise 0 %, palier, fiche v3) ; V3P01 ; GATE02 (créations concurrentes) ; « creation persists final French » (`estimate-integrity`) ; les trois parcours de `import-optima-v2` ; `commercial-rounding` ; accès anonyme et connexion ; 7 min 13 s de parcours | `local-grep/` (manifeste `2026-10-18T11-19-40-395Z-critical`, journaux, archive SDK, `ARMY-*-v3c*.json`, `SHA256SUMS`, 590 fichiers) |
| Suite critique, une fois | `npm run e2e:army:ci -- critical --app-port 3172` | **117/117**, 0 instable, 0 ignoré ; 7 min 50 s de parcours | `critical/` (manifeste `2026-10-18T11-29-46-751Z-critical`, 1 454 fichiers) |
| Qualité | `npm run verify:pr` (audit, architecture, `validate-openapi`, typecheck, lint, Vitest node 301 fichiers dont 1 ignoré, jsdom 165, couverture critique) | vert | `verify-pr-3c9dd453.log` (en-tête à une révision fausse, substitution du shell Windows : le clone WSL était à `3c9dd453`, propre) ; vert de nouveau sur `1242d339`, en-tête juste : `verify-pr-final.log` |
| OpenAPI | `npm run generate-openapi`, `npm run validate-openapi` | spec valide et synchronisée ; diff relu (instanciation, takeoff, création) | `openapi.json` |
| Diff | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts supabase/migrations` | propre ; vide | — |

Valeurs exactes relues en SQL et par l'API (attendus du §3, inchangés) : V3C01 v3 à 1,30 / 1,20, réglages neutres,
totaux 0 ; V3C02 requête `[1,25, 1,15, down, 10 000]` sans clé v2, v3 à 1,25 / 1,15 ; V3C04 T1 et T2 égales à
l'oracle M6, tube 3 700 / 37 000, `converted_lines` collier 1 h → 0,9 h, `dropped_settings` T1
`[margin_multiplier « Marge 15 % », global_coefficient « Coefficient global 1,02 », rounding_mode « Arrondi au
palier supérieur de 10,00 € »]`, T2 `[margin_mode, discount_mode]`, avertissement affiché ; V3C05 v3 à
1,10 / 1,05, lignes égales à la source (3 200 / 32 000), rapports vides ; V3C06 HT 11 700, TVA 2 340, TTC 14 040,
`ml` / `u` ; V3C07 v3 vierge à 1,30 / 1,20 ; V3C08 motif et lancement désactivé dans les deux entrées, API 409,
aucune tâche ; V3C09 bouton désactivé avec le motif, aucune ouverture ; V3C10 graphique V1, V2 et avis V3 ; gardes
V3C11 et V3C12 aux valeurs v2 d'avant le code, aucune politique écrite.

Itérations (boucle `e2e:army:dev-loop`, non qualifiantes, `devloop/`) sur `d83223b4` plus les changements non
commis, puis arrêt avant la fusion : 1. V3C01 à V3C12 **13/13** au premier essai ; 2. parcours de création
**29/30**, V3E01 rouge (« expected false to be true » dans `waitForAutoSave`, ligne O1 sans son rôle MO) ;
3. V3E01 seul **2/2**. Ce défaut de saisie de la grille, sans lien avec 2.10a, est celui que corrige #53
(`docs/testing/v3e01-labour-role-lost.md`), fusionné avant les runs qualifiants, où V3E01 est vert deux fois.

## 8. Décisions appliquées, limites

Décisions du 18/10/2026 (plan vers 2.10) appliquées :

- **D-d** (A16) : avis « indisponible pour le moteur 3 » qui nomme les v3, au lieu d'un retrait silencieux ; la
  série v3 tirée des gels frais reste pour plus tard.
- **D-f** (P-19, N3) : plus de métré sur une v3 ; le refus nommé de l'application est dit dès la création de la
  tâche et dans chaque entrée du hub. Une politique 2 explicite garde le métré (la cible est alors une v2).
- **D-g** (P-14, N3) : structure IA désactivée avec son motif, sans ouverture automatique ni suggestion du hub ;
  version zéro sans entrée d'interface, refus d'API inchangé.
- **D-h** (A1) : réglages v2 non représentables non repris et listés (`dropped_settings` et avertissement), comme
  `converted_lines`.

Décisions du vert :

- F10, F11 (`QuickCreateAffaireDialog`, `startAffaireManualEstimate`, sans écran) : corrigés avec l'outil
  partagé (attente déclarée, normalisation d'import v3, cause nommée) plutôt que retirés ; aucune preuve
  d'interface possible, aucun test isolé ajouté (il ne vérifierait que des simulations).
- Remise d'un modèle v2 : une remise fixe est reprise (elle prime en v2 sur le taux et les paliers), un taux
  simple aussi ; une remise en cascade n'est pas reprise et elle est listée.
- Les coefficients saisis dans l'assistant ne s'appliquent pas à « Depuis un modèle » (ceux du modèle v3, sinon
  de la politique), comme les réglages de prix v2 qui ne s'appliquaient pas non plus à un modèle.
- Une colonne d'heures par ligne d'un DPGF lié ou d'un import de création rapide demande l'aperçu de l'import
  de l'affaire en moteur 3 (`importRequiresPreview`), sans changement en v2 où ce motif n'existe pas.

Limites (non couvertes par ce sous-lot) :

- Repli « aperçu requis » d'un DPGF lié à h/u ou à heures par ligne : code relu, aucun parcours.
- `converted_lines` compare les heures MO totales seulement, comme l'insertion M6 (B7, P-12).
- Une nouvelle v3 reçoit, comme toute nouvelle version, le report des tâches de métré de la version
  précédente (`tryCarryOverTakeoffJobsToNewVersion`) : elles restent visibles et leur application est refusée
  (P-19).
- Modèle + « DPGF source à importer » : l'import dans la v3 créée passe par l'éditeur (A5, sous-lot 2.8b) et
  reste refusé, avec l'avertissement existant « Le chiffrage a été créé, mais le DPGF source n'a pas pu être
  importé ».
- Les erreurs d'une action serveur restent masquées en production (« Minified React error », vu au rouge de
  V3C07) ; l'accueil réussit désormais sous politique 3, mais une autre erreur n'y est pas plus lisible.
- Les parcours du métré (`e2e/army/takeoff/*`, hors `critical`) n'ont pas été rejoués localement : sous une
  politique absente, le contrôle ajouté ne refuse rien ; la sélection d'une pull request les lance (carte
  d'impact modifiée).
- Revue indépendante : faite, constats clos au §9.

## 9. Revue indépendante et clôture (18/10/2026)

Revue en lecture seule sur `1242d339` : trois constats mineurs, aucun bloquant ni majeur. Tous clos ; le
comportement d'abord en rouge. Commits : `f5ffcbf5` (parcours), `017172fa` (correction), `6b0f8d04` (capture).

| # | Constat | Clôture | Preuve |
|---|---|---|---|
| R1 | « Créer un brouillon depuis V… » (`launchTakeoffFromSourceVersionPlanSet`) copie sa source avant que la création de la tâche refuse la copie v3 | Plus grave que décrit : le retrait de la copie filtre sur `parent_version_id`, nul pour une copie simple, et ne supprime rien. Une source v3 laissait donc une copie v3 dans l'affaire. `assertTakeoffSourceVersionSupported` refuse la source v3 avant la copie (mêmes contrôles d'accès que la cible, statut libre, même `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`) ; le contrôle à la création de la tâche reste en filet | V3C08 étendu : l'action est appelée sur la v3 depuis la page du hub (identifiant lu dans le manifeste du build), hors du bouton désactivé. Rouge (code de `1242d339`, parcours de `f5ffcbf5`) : 500 masqué, **1 version ajoutée, 1 insertion au journal d'audit** (`audit_logs`). Vert sur `017172fa` : 0 et 0 |
| R2 | Aucun parcours ne prouve, sur le chemin de création, les refus nommés de M6 ni les heures atelier / chantier | V3C13 (nouveau, politique 3). Ligne Q 0 avec 2 h → `400 ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY`, ligne nommée, ni affaire ni version. Modèle du propriétaire instancié par un second administrateur de l'entreprise (un modèle n'est visible que de son auteur et des administrateurs) → `400 ESTIMATE_TEMPLATE_LABOR_ROLE_REQUIRED`, rien d'écrit. Ligne éclatée, EST_031 actif : 3 u, 1 h d'atelier (Tuyauteur, 40 €/h), 2 h de chantier (Soudeur, 50 €/h) → h/u 1 ; 0,3333 ; 0,6667, PU 69,00 €, 207,00 € ; lignes et totaux égaux à l'insertion M6 ; rapports vides | Vert dès le code de `1242d339` (itération 2) : le code était juste, la preuve manquait. Aucun changement de code |
| R3 | Corps de PR : rouges cités sur `d83223b4`, captures absentes | Rouges sur `bb4772f3` (même code ; `d83223b4` n'ajoute que cette fiche). Captures prises par les parcours (`captureScreen`) pendant le run qualifiant : étape de prix v3 (V3C02), avertissement de conversion T1 et T2 (V3C04), refus du métré dans la proposition et dans « Analyser les plans » (V3C08), structure IA désactivée avec son motif (V3C09), avis A16 (V3C10) | `.e2e/lot2-2.10a/review/screenshots/` |

Captures : le SDK refuse toute capture après la saisie d'un secret, y compris dans une session restaurée. V3C02,
V3C04, V3C08, V3C09 et V3C10 tournent donc sans la session de campagne ; leur propriétaire dédié remplaçait déjà
ses cookies. Ils ne déclenchent plus la connexion : une sélection faite d'eux seuls est refusée par le runner
(itération 5) ; y joindre V3C01. La sélection par fichier de la CI n'est pas touchée.

Test isolé touché : la simulation de `@/lib/takeoff/server` dans `takeoff.test.ts` gagne la nouvelle fonction.
Aucun test isolé ajouté.

Itérations (boucle, non qualifiantes, pile `miaouffrage-ci-27312-724d9c82` détruite ; `.e2e/lot2-2.10a/review/devloop/`) :

| It. | Révision (diff) | Sélection | Résultat |
|---|---|---|---|
| 1 | `1242d339` + parcours en cours | V3C02, V3C08, V3C13 | V3C08 rouge métier ; V3C13 rouge de parcours (réponse `projectId` / `versionId` ; modèle invisible pour un chiffreur, d'où un administrateur) |
| 2 | `1242d339` + parcours de `f5ffcbf5` | V3C08, V3C13 | **V3C08 rouge métier** (1 version, 1 insertion) ; V3C13 vert |
| 3 | `f5ffcbf5` + code de `017172fa` | V3C08, V3C13 | vert, après reconstruction |
| 4 | `017172fa`, diff vide | V3C01 à V3C13 | vert 14/14 (connexion comprise) |
| 5 | `017172fa` + capture V3C10 | V3C10 | refusé par le runner : aucune connexion sélectionnée |
| 6 | `017172fa` + capture V3C10 | V3C01, V3C10 | vert, avis capturé |

Runs qualifiants (tête de code `6b0f8d04`, clone WSL propre, pile possédée et jetable, migrations, pgTAP et
matrice RLS verts, `E2E_ARMY_WORKERS=2`) :

| Preuve | Commande | Résultat | Preuves (`.e2e/lot2-2.10a/review/`) |
|---|---|---|---|
| Suite critique, une fois | `npm run e2e:army:ci -- critical --app-port 3171` | **118/118** (117 + V3C13), 0 instable, 0 ignoré ; 8 min 36 s de parcours, 10 min 20 s au total | `critical/` (manifeste `2026-10-18T12-35-48-560Z-critical`, journal, `SHA256SUMS`, 1 467 fichiers) ; `screenshots/` (7 PNG, `SHA256SUMS`) |
| Qualité | `npm run verify:pr` (Vitest node 301 fichiers dont 1 ignoré, jsdom 165, couverture critique 3) | vert, arbre inchangé après le run | `verify-pr-6b0f8d04.log` |
| Diff | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; diff de `estimate-calculations.ts`, `estimate-v2-snapshot.ts`, `supabase/migrations` | propre ; vide | — |

La suite critique contient tous les parcours du run `e2e:army:local --grep` du §7 (V3C, IO, V3E, V3P01, GATE02,
création ; les 34 résultats y passent tous) : il n'est pas rejoué à part. OpenAPI : aucune route ni schéma
touché depuis `3c9dd453`, `validate-openapi` vert dans `verify:pr`.

Hors sous-lot, préexistant (tâche séparée proposée) : le même retrait sans effet laisse une copie v1/v2 dans
l'affaire quand un lancement depuis une source v1/v2 échoue après la copie ; `takeoff.test.ts`, simulé, assertait
ce filtre.

## 10. Revue Codex de la PR #57 (18/10/2026)

Revue de Codex sur `27c358d0` : un constat P2. La PR #57 a fusionné sans lui (`59b3b6bf`, tête `a662e313`) : un
P2 sans effet sur les montants ni sur l'intégrité part dans une PR de suivi depuis `main` (règle du propriétaire
du 18/10, AGENTS.md et `docs/testing/ci-retro-2026-10-18.md`). La branche `fix/lot2-2.10a-a16-notice-without-section`,
partie de `main` `59b3b6bf`, porte `50b01a43` (parcours) et `bd752795` (correction), repris par `cherry-pick -x`
des commits locaux `3a14a4d4` et `81d2e861` du correcteur, jamais poussés. Comportement d'abord en rouge.
**Corrigé hors du démarrage du hub, donc partiel** : résidu préexistant ci-dessous.

| # | Constat | Clôture | Preuve |
|---|---|---|---|
| C1 (P2, commentaire 4307430730) | Version courante sans section racine (v3 vierge) : `fetchAffaireHubMarginAnalysisWithContext` rend `null` avant l'avis A16 ; la carte « Analyse de marge » disparaît, l'avis avec elle | **Partiel** (hors démarrage du hub). Sans analyse calculable (aucune ligne, aucune section racine, entrée v3 illisible), l'analyse rend l'avis seul (`AffaireHubMarginV3Notice`) dès qu'une v3 est dans l'affaire ; sans v3, toujours `null` (v1/v2 inchangées). La carte affiche alors son titre et l'avis, ni indicateurs ni graphique. `fetchAffaireHubMarginAnalysis` garde son contrat (analyse ou `null`) | V3C14 |

**Résidu préexistant, non corrigé ici.** Le hub ne monte la carte qu'en mode Expert et hors de son démarrage
(`isAffaireFreshStartState` : un document, un DPGF lié ou une ligne dans la version courante) ; V3C14 lie donc un
DPGF. Une v3 vierge créée comme version courante d'une affaire sans document ni DPGF laisse le hub à son
démarrage : ni carte ni avis, même quand des versions v1/v2 antérieures sont chiffrées. C'est vrai pour tous les
moteurs (une v2 vierge masque aussi la carte), et aucun graphique n'est alors affiché, donc aucune v3 n'en est
retirée sans le dire. Afficher la carte au démarrage est une décision de produit, à suivre à part. Aucun test
isolé ajouté ni modifié.

Zone `e2e/army/local/engine-v3-*` : #45, #59 et #62 y sont ouvertes ; cette PR de suivi est celle que prévoit la
règle du propriétaire, et sa tête fusionne sans conflit avec `main` et avec chacune de leurs têtes.

| Preuve | Révision, commande | Résultat | Preuves |
|---|---|---|---|
| Rouge | `50b01a43` (`main` `59b3b6bf` + parcours), clone WSL propre (Node 24.19.0) ; `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep '^V3C(01\|14) ' --app-port 3171` | **V3C14 rouge métier** : `withV3` `null` (aucune carte) au lieu de l'avis « … : V2. » ; garde `v2Only` `null` ; versions `[[1,2],[2,3]]`, v3 sans élément ; base, pgTAP, RLS, connexion et V3C01 verts ; 145 s | `.e2e/lot2-2.10a/followup/red/` (`2026-10-18T16-20-39-775Z-critical`, `SHA256SUMS`) |
| Vert | `0ce1890f` (parcours et correction ; le commit suivant ne touche que ce document et sa capture), même clone ; `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep '^V3C' --app-port 3171` | **15/15** (connexion, V3C01 à V3C14), 94 s de parcours, 187 s au total ; V3C14 : V1 seule sans carte, puis carte avec l'avis seul | `.e2e/lot2-2.10a/followup/green/` (`2026-10-18T16-23-06-063Z-critical`, `SHA256SUMS`) ; capture `docs/testing/assets/lot2-2.10a/001-v3c14-margin-notice-blank-v3.png` (run `2026-10-18T16-24-32-170Z`) |
| Qualité | `0ce1890f`, même clone ; `npm run verify:pr` (relancé une fois sur la tête finale, résultat dans la PR de suivi) | vert, 159 s : Vitest node 303 fichiers et 1 ignoré (2 939 tests, 2 ignorés), jsdom 165 fichiers (831 tests), couverture critique 3 fichiers (12 tests) ; arbre inchangé après le run | `.e2e/lot2-2.10a/followup/verify/verify.log` |
| Diff | `git -c core.whitespace=cr-at-eol diff --check 59b3b6bf...HEAD` ; `git merge-tree --write-tree HEAD <tête>` | propre ; sans conflit avec `main` `36c5158c` (AGENTS.md seul depuis `59b3b6bf`, donc aucune fusion) et avec les têtes de #45 `5b740b2e`, #59 `22c4e807`, #62 `7eb6fe01` | — |
| Premières preuves (correcteur) | `27c358d0` + `3a14a4d4` (rouge), `81d2e861` (vert 15/15, `verify:pr`) | mêmes résultats, avant fusion de #57 | `.e2e/lot2-2.10a/codex-c1/` du worktree `miaouffrage-l2-210a` |

Les runs du suivi ont tourné sous le verrou natif de `main` (`NATIVE_STACK_WAIT_SECONDS`), une pile chacun.
