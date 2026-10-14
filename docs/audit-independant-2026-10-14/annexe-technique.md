# Annexe technique — Audit indépendant MergeOne / Miaouffrage (TIMAX)

Audit du 14 octobre 2026. Destinataire : équipe technique. Complète le rapport `rapport-audit-independant.docx`.

Auditeur : Claude (modèle Opus 5.5, Anthropic), agent IA, à la demande du porteur. L'audit a été conduit dans
Claude Code sur le poste de développement, en lecture seule sur le dépôt vivant, avec une copie isolée de l'archive
et une pile Supabase locale jetable. Les conclusions sont celles d'un auditeur outillé, non d'un expert-comptable
ni d'un juriste : les points fiscaux et légaux sont signalés « à valider ».

## Sommaire

1. Référence auditée et méthode
2. Résultats outillés
3. Constats (sécurité et exploitation, calculs et règles, usage et continuité, qualité et processus)
4. Affirmations antérieures : confirmées, infirmées, non vérifiables
5. Référentiel des règles (synthèse)
6. Delta du dépôt vivant (non audité)
7. Non audité
8. Reproduire les résultats
9. Index des pièces

---

## 1. Référence auditée et méthode

| Élément | Valeur |
|---|---|
| Archive | `docs/handoff-prestataire-2026-10-14/handoff-audit-independant-2026-10-14.zip`, SHA-256 `21b2a341acdf0e791d9ae53bd7a85f2d244b244977fbd525877c70368832ac6d` (vérifié) |
| Base Git | `ce5874f5` (11/10/2026 02:18) **plus** le travail non commité capturé le 14/10 à 13 h 19 |
| Écart avec le dépôt vivant au moment de l'audit | 36 fichiers modifiés depuis la capture, dont `src/lib/estimate-calculations.ts`. La migration `20261014114943_estimate_fixed_discount_and_template_parent_integrity.sql` (correctif « remise fixe ») est **absente** de l'archive : 244 migrations dans l'archive, 245 dans le dépôt. |
| Fichiers suivis absents de l'archive, repris du dépôt vivant pour exécuter | `supabase/config.toml` (inchangé depuis le 11/08), `supabase/tests/database/*.sql`, `config/architecture-budgets.json`, `public/`, `components.json`, `vitest.critical.config.ts`, `next-env.d.ts` (version standard). Voir `reproductions/resultats/snapshot-additions.txt`. |

Statuts : **Confirmé** (exécuté, ou lu sans ambiguïté avec la raison) · **Infirmé** · **Probable** (lecture
plausible dépendant des données ou de l'exécution) · **À vérifier** · **Non audité**.
Gravité : **Critique** · **Élevée** · **Moyenne** · **Faible**.

Méthode, dans l'ordre :
1. Lecture du dossier de mission, de la vision et des documents métier ; cartographie des affirmations.
2. Analyses parallèles par axe sur la copie figée (règles et calculs, sécurité, ergonomie et continuité,
   matériaux métier, qualité et exploitation). Rapports détaillés dans `rapports-axes/`.
3. Contrôles outillés sur une copie isolée : `tsc`, ESLint, Vitest, validation OpenAPI, budgets d'architecture.
4. 24 tests de caractérisation écrits par l'auditeur contre les fonctions pures du moteur (`reproductions/`).
5. Pile Supabase locale isolée (CLI 2.120.0, runtime natif, WSL Ubuntu-24.04, projet
   `audit-independant-20261014`, ports 563xx), migrations de l'archive appliquées depuis une base vide, pgTAP.
6. Application de l'archive servie en local (`next dev` 16.4, 127.0.0.1:3210), sans clé Gemini, Resend ni
   Vercel ; deux entreprises de test ; 16 scénarios rejoués par l'interface et l'API (`rapports-axes/C-parcours.md`).
7. Contrôles GitHub en lecture seule (`gh run list`, rulesets, visibilité du dépôt).

---

## 2. Résultats outillés (copie de l'archive)

| Contrôle | Résultat | Lecture |
|---|---|---|
| `tsc --noEmit` | 6 erreurs, toutes dans des `e2e.*.config.ts` non suivis qui importent `.e2e/…` (dossier ignoré par Git) ; **0 erreur dans `src/`** | L'arbre transmis ne compile pas hors du poste de l'équipe |
| ESLint `--max-warnings=0` | 0 erreur, 0 avertissement | Point solide |
| Vitest, projet node | **2 159 tests : 2 071 réussis, 86 en échec**, 2 ignorés | 3 fichiers échouent faute de fichiers absents de l'archive ; **11 fichiers échouent par décalage entre code et tests** (portail accept/reject, PDF, sceau, `server.ts`, approbation, zip de commande). 4 de ces fichiers de test sont eux-mêmes modifiés dans l'arbre non commité. |
| Vitest, projet jsdom | 821/821 réussis | Point solide |
| Validation OpenAPI | Valide et synchronisée ; 144 routes, 192 opérations (186 documentées) | Point solide |
| Budgets d'architecture | **Échec** : `src/hooks/useEstimateEditorSyncController.ts` 1 333 lignes > plafond 1 200 | Le Quality Gate échouerait sur l'état transmis |
| `supabase db reset` (pile isolée) | 242 migrations SQL appliquées sans erreur depuis une base vide | Point solide : le schéma se reconstruit |
| pgTAP (13 suites versionnées) | 1 142 assertions exécutées. **4 suites en échec** : `estimate-calc-engine-governance` (tests 78-81 : `OFFER_NEW_EMISSION_CONTRACT_REQUIRED`), `estimate-email-outbox` (`OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED`), `portal-security-definer` et `security-invariants` (fonction `claim_portal_estimate_decision(uuid,text,inet,text)` introuvable) | Les migrations non commitées cassent des tests SQL versionnés. La CI verte du 14/10 porte sur `ce5874f5`, pas sur l'état transmis. |
| CI GitHub (14/10) | Quality Gate et matrice RLS **verts** sur `ce5874f5` ; Playwright critique vert le 11/10 ; **sauvegarde, reprise durable et Playwright nocturne : aucun succès, jamais** | Voir S-03, S-07 |

---

## 3. Constats

Chaque constat renvoie à sa preuve. Les identifiants entre crochets renvoient aux rapports par axe
(`D1-xx` règles et calculs, `D2` sécurité, `D3-xx` ergonomie, `D4-xx` matériaux métier, `D5-xx` exploitation,
`P-xx` parcours rejoués) ou aux tests de caractérisation (`A-xx`, `B-xx`, `I-xx`).

### 3.1 Sécurité et exploitation

| ID | Constat | Statut | Gravité | Preuve | Conséquence | Recommandation |
|---|---|---|---|---|---|---|
| S-01 | **Le dépôt GitHub `maxlemeur/HEX_BC` est public.** Lecture anonyme du code, des migrations et politiques RLS, du registre des failles, de l'historique, des artefacts CI. | Confirmé | Critique | `gh repo view` → `visibility=PUBLIC` ; `curl` anonyme HTTP 200 sur `raw.githubusercontent.com` [D5-01] | Carte complète des surfaces d'attaque publiée ; tout secret versionné est compromis | Passer le dépôt en privé aujourd'hui ; considérer tout contenu versionné comme divulgué |
| S-02 | **Identifiants en clair dans des fichiers versionnés publics** : (a) deux mots de passe de comptes (admin « compte principal » et director) dans `docs/test-logins.md` au commit `43a0686a` du 06/03/2026 ; (b) `docs/prd_file/Feuille de calcul sans titre.xlsx` (commit `433a9d4c`, toujours présent) contient deux chaînes ressemblant à des mots de passe sous les libellés « Supabase » et « Logiciel », deux e-mails et l'URL d'un déploiement. Valeurs non reproduites, validité non testée. | Confirmé (présence et accès anonyme) ; rotation **à vérifier** | Critique | `git show 43a0686a` (longueurs seules) ; `git ls-files` ; `curl` HTTP 200 sur le fichier .xlsx [D4-20, D5-02] | Prise de contrôle possible d'un compte de production ou du projet Supabase | Changer ces mots de passe immédiatement, révoquer les sessions, examiner les journaux Auth depuis février ; retirer le fichier ; activer le *secret scanning* |
| S-03 | **Aucune sauvegarde n'a jamais été produite.** Workflow en échec quotidien (`Missing secret: SUPABASE_DB_URL`), alerte vide, plan Supabase Free sans PITR (affirmation de l'équipe), Storage hors du dump. Ajouter le secret tel quel publierait le dump (schéma `auth` compris) en artefact d'un dépôt public. | Confirmé | Critique | `gh run list --workflow supabase-backup.yml --status success` → jamais [D5-04] | Toute perte de données serait définitive (devis scellés, preuves, approbations) | Supabase Pro + PITR ou dump chiffré hors GitHub, Storage compris ; exercice de restauration daté |
| S-04 | **La production sert de base de test** : la CI E2E reçoit la clé service-role de production et y crée affaires et devis, jusqu'aux statuts irréversibles `sent`/`accepted`, à chaque push et chaque nuit ; TesterArmy conserve ses brouillons ARMY dans la base partagée. | Confirmé (configuration) ; volume écrit **non audité** | Critique | `.github/workflows/e2e-playwright-critical.yml:61-66` ; `e2e/estimates/full-lifecycle.spec.ts:40-85` [D5-03] | Données de production polluées (numérotation, statistiques) ; une erreur de test agit sans RLS sur la production | Projet de recette distinct ou pile éphémère ; retirer la clé de production de GitHub ; purger les données de test après sauvegarde |
| S-05 | **Déploiement non contrôlé** : chaque push sur `main` est déployé en production par Vercel sans attendre la CI ; ruleset limité à la suppression ; dernière PR fusionnée le 19/08 ; `AGENTS.md` impose de travailler sur `main` ; 53 des 82 commits depuis le 19/08 co-écrits par un agent IA ; version figée à 0.4.2. | Confirmé | Élevée | `gh api …/rulesets` → `["deletion"]` ; déploiements Vercel [D5-06] | Un commit non relu atteint immédiatement les utilisateurs ; impossible de savoir quelle révision tourne | PR obligatoire, checks requis, revue humaine, promotion conditionnée, SHA dans `/api/health`, procédure de retour arrière |
| S-06 | **Migrations appliquées à la main par un agent (MCP `apply_migration`/`execute_sql`)**, numéros distants divergents, 20 migrations non suivies, types de base écrits à la main ; `.claude/settings.local.json` versionné pré-autorise ces outils sur le Supabase hébergé. | Confirmé (procédé) ; état réel de la production **non audité** | Élevée | `supabase/README.md:57-84` ; `git ls-files .claude` [D5-07, D5-17] | Schéma de production inconnu ; reconstruction non garantie | Inventaire et réconciliation de l'historique ; migrations par pipeline ; retirer ces droits aux agents |
| S-07 | **Reprise durable inerte** : seul déclencheur du rejeu de l'outbox e-mail, des dispatches de métré, des dépôts de pièces et du nettoyage Storage ; jamais réussie (`CRON_SECRET` absent). Observabilité sans destination, aucune sonde, aucune alerte. | Confirmé | Élevée | `gh run list --workflow recover-durable-fallback.yml --status success` → jamais [D5-05, D5-08] | Devis réputés envoyés dont l'e-mail reste en file ; incidents invisibles | Planificateur fiable, secrets, alertes ; collecte d'erreurs ; tableau des éléments bloqués |
| S-08 | **Annuaire inter-entreprises** : tout administrateur d'entreprise — donc tout compte auto-inscrit — obtient nom et e-mail des utilisateurs de toutes les entreprises (recherche ≥ 2 caractères, 20 résultats). | **Confirmé à l'exécution** | Élevée (si l'inscription est ouverte en production, ce que la page publique « S'inscrire » laisse supposer) | `GET /api/memberships?search=audit` en admin B → 4 utilisateurs de A [P-12] ; `src/lib/memberships/server.ts:169-200` (client service-role) | Fuite de données personnelles (RGPD) ; contredit la clôture R001-003 du registre de sécurité | Restreindre la recherche aux invitations par e-mail exact ou aux membres existants ; fermer l'inscription libre (voir arbitrage 11) |
| S-09 | **Rattachement d'un utilisateur d'une autre entreprise sans consentement** : bloqué (409), mais par effet de bord — le comptage passe sous RLS (0 visible), l'insertion tente `is_default=true` et heurte l'index unique. | Confirmé à l'exécution | Moyenne | [P-13] ; `src/lib/memberships/server.ts:296-310` | Protection non intentionnelle, fragile au moindre changement | Invitation avec acceptation explicite par l'invité |
| S-10 | **Identité légale de HYDRO EXPRESS codée en dur** (raison sociale, siège, SIRET, n° TVA, adresse, téléphones, préfixe de numérotation `HEX_`) sur le PDF de **toute** entreprise. | Confirmé à l'exécution | Élevée (juridique) | PDF généré pour « Audit Entreprise A » [P-06] ; `src/lib/company-info.ts` | Un devis d'une autre entreprise est émis sous l'identité légale de HYDRO EXPRESS | Identité, mentions et numérotation par entreprise ; ou outil mono-entreprise assumé (arbitrage 11) |
| S-11 | **Un administrateur peut forcer l'envoi sans l'approbation exigée** : version passée `sent` et scellée, marge 0 %, `approval_status = not_required` alors que la règle exigeait une approbation au-delà de 5 000 € HT. | Confirmé à l'exécution | Moyenne | `PATCH /status {force:true}` → 200 [P-09] ; contrôle d'approbation seulement applicatif | L'approbation n'est pas une garantie ; aucune justification exigée | Forçage réservé à une seconde personne (direction), justification obligatoire, trace visible |
| S-12 | Points solides vérifiés : isolation des devis entre entreprises sur l'API (404) [P-11] ; écriture impossible sans bail d'édition de page [P-04] ; versions envoyées immuables, retour `sent → draft` refusé [P-10] ; RLS active sur toutes les tables ; PDF client sans coût ni marge [P-06] ; contrat portail en liste blanche (code). | Confirmé | — | — | — | Conserver ; les couvrir par des tests exécutés en CI |
| S-13 | Autres risques relevés par lecture : jetons de portail en clair lisibles par propriétaires et admins ; aucune limitation de débit ; aucun en-tête de sécurité (portail intégrable dans un cadre) ; drapeau JWT `is_admin_user()` contournant l'isolation ; artefacts Playwright publics avec captures de production. | Probable / Confirmé (configuration) | Moyenne | [D2 §3, §4, §6] ; [D5-10, D5-16] | Défense en profondeur insuffisante | Hachage des jetons, limitation de débit sur portail et envoi, en-têtes `frame-ancestors`/`Referrer-Policy`/`nosniff`, inventaire du drapeau admin |

### 3.2 Calculs et règles de gestion

| ID | Constat | Statut | Gravité | Preuve | Conséquence | Recommandation |
|---|---|---|---|---|---|---|
| C-01 | **Heures de MO : « par unité » dans l'aide et dans tous les matériaux du porteur, « totales de ligne » dans le moteur.** Le moteur ne multiplie pas `h_mo` par la quantité ; l'import DPGF recopie la valeur ; les ouvrages, eux, multiplient. | Confirmé (test B-01 : 10 m × 0,5 h/m × 45 €/h → 22,50 € de MO au lieu de 225 €) | Critique | `estimate-calculations.ts:230-244` ; `ColumnHeaderHelp.tsx:11-21` ; `import-flow.ts:450-453` [D1-06, D4-01] | Avec les temps du porteur saisis par unité : prix de vente sous-évalué de 30 à 75 % sur les lignes-oracle du projet A | Arbitrage 1 ; aligner moteur, aide, import, collage, ouvrages, tests |
| C-02 | **Remise saisie en € convertie en points de base entiers** (EU01) : toute saisie de 1,00 à 2,99 € devient 2,00 € sur 19 954,50 € ; 0,50 € disparaît ; erreur jusqu'à ±50 € sur 1 M€. | Confirmé (tests A-01 ; interface : `discount_bp = 1`, HT 19 952,50 € après rechargement [P-05]) | Élevée | `useEstimateEditorState.impl.tsx:1441-1447` ; `version-totals.ts:363-379` ; `estimate-calculations.ts:1525-1527` [D1-01] | Montant contractuel différent de la saisie, visible seulement après rechargement | Arbitrage 3 (correctif en cours dans le dépôt vivant, non audité, §6) |
| C-03 | **Remise historique en % transformée en montant fixe par un changement de marge** (EUHIST) : 10 % devient 5 % en base ; pied [380, 76, 456] au lieu de [360, 72, 432]. | Confirmé (test A-02) | Élevée | `useEstimateEditorState.impl.tsx:733-749`, `:1441-1447` [D1-02] | Le taux négocié diminue en silence quand la marge augmente | Conserver la nature de l'intention (montant ou %) |
| C-04 | **Coefficient de vente unique** alors que les offres réellement remises du porteur appliquent 1,30 à la fourniture et 1,20 à la MO (ajustement exact à 0,6 centime près sur 1 441 lignes). | Confirmé | Élevée | `repro/d4/fitcoef.js` [D4-02] | Impossible de reproduire l'offre réelle sans fausser la marque affichée (0 %) ou sans écart jusqu'à 1,12 €/ligne | Arbitrage 2 |
| C-05 | **Paliers de marge en marche d'escalier** sur le coût total : 99 999,99 € de coût → 159 999,98 € ; 100 000 € → 145 000 € ; prix inférieur jusqu'à environ 110 350 € de coût. Barème par défaut (1,60/1,45/1,40) sans source, différent de la grille du porteur (5 tranches), elle-même non appliquée dans ses offres (coefficient réel 1,243). | Confirmé (tests A-03) | Élevée | `margin-tiers.ts:9-13`, `:42-62` ; `devis_vierge_v1.xlsx Renseignement!D8` [D1-04, D4-03, D4-04] | Ajouter un poste peut baisser l'offre ; paramétrer les « cibles » aurait majoré l'offre hydraulique réelle de 12,6 % | Arbitrage 2 |
| C-06 | **TVA en moteur v2** : changer la « TVA unique » ne modifie aucune ligne existante (le PDF affiche pourtant le nouveau taux) ; aucun taux de ligne éditable ; PDF à taux unique sans ventilation ; sur des montants ronds, une remise répartie en centimes ne réduit pas la TVA (+0,40 € dans la configuration EU01). | Confirmé (tests B-02, A-06) | Élevée (fiscal, à valider) | `…settings_atomic.sql:232` ; `prepare-estimate-document-data.ts:438` [D1-07] | Devis passé à 10 % calculé à 20 % ; TVA ≠ taux × HT | Arbitrage 5 ; validation par l'expert-comptable |
| C-07 | **Arrondi commercial stocké comme de la TVA** (`total_tax_cents`, et réparti dans la TVA de chaque ligne en v2) ; remise simple arrondie au demi supérieur en TS, au demi pair en SQL (métré) : 1 c d'écart. | Confirmé | Moyenne | `estimate-v2-snapshot.ts:368-384` ; `20260813201300…sql:922-936` [D1-12] | Tout consommateur lisant `total_tax_cents` comme une TVA se trompe | TVA comptable pure et ajustement séparé ; une seule bibliothèque d'arrondi |
| C-08 | **PU × quantité ≠ total de ligne**, visible sur le PDF (120 ml × 18,40 € = 2 207,78 €) car la remise v2 est fondue dans les lignes et le PU est arrondi séparément ; la remise n'apparaît pas comme telle sur le document. | Confirmé (test A-05, PDF [P-06]) | Moyenne | `estimate-calculations.ts:250-251` [D1-11] | Le client recalcule et trouve un autre montant ; la remise accordée n'est pas lisible | Arbitrage 4 |
| C-09 | **Unités** : pas de colonne d'unité (portée par `description`) ; « ML » lu comme millilitre aux achats (offre refusée, test B-04) ; « m² » devient « m » dans la comparaison DPGF/métré ; import BDC → unité « u » ; aucun conditionnement ni conversion. La suggestion catalogue de ligne écrit encore la désignation dans le champ unité. | Confirmé | Élevée | `useCatalogueSuggestions.ts:172-176` ; `supplier-offer-eligibility.ts:4-20` ; `csv-import.ts:957` [D1-08, D4-06, D4-07] | Unités fausses sur DPGF, PDF et bons de commande ; comparaison de prix fausse | Arbitrage 6 |
| C-10 | **Offre fournisseur à 0 €** : exclue du prix de référence (SQL) mais éligible au « meilleur prix », présélectionnable et applicable à une ligne. | Confirmé (test B-04) | Moyenne | `supplier-offer-eligibility.ts:12-30` ; `estimates/server.ts:1051-1056` [D1-09] | Fourniture à 0 € possible dans un brouillon ; politique du porteur appliquée sur un seul chemin | Arbitrage 7 |
| C-11 | **Saisie numérique** : cinq parseurs ; « 1.250 » vaut 1 250 € en saisie de prix et 1,25 à l'import ; « 1 000 » vaut 1 dans les champs remise et marge ; une quantité invalide devient 0. **Majoration MO** : cinq conventions ; « 100 » importé multiplie la MO par 100 ; « 8 » au clavier donne ×0,08. | Confirmé (tests A-07, B-01, B-05) | Élevée | `money.ts:51-70` ; `NumberInput.tsx:16-25` ; `import-flow.ts:125-188`, `:454-457` [D1-15, D1-19] | Erreurs d'un facteur 100 à 1 000 sans alerte | Un parseur par grandeur, refus des formats ambigus ; une seule convention de majoration |
| C-12 | **Règles de contrôle** : `min_margin` ignore remise et coefficient global (×1,25 avec 20 % de remise = marque nulle, règle satisfaite) ; deux sens de « marge » (panneau k−1, règles 1−1/k ; k = 1,6 affiché 60 %, évalué 37,5 %) ; seuil d'approbation inclusif (5 000,00 € pile exige une approbation, la documentation dit « > ») ; seuils Direction codés en dur. | Confirmé (tests A-04, B-03) | Moyenne | `effective-margin.ts:32-34` ; `rules-engine.ts:1119-1126` [D1-05, D1-13, D1-14] | Contrôles qui laissent passer ou bloquent à tort | Arbitrages 9 et vocabulaire unique |
| C-13 | Écrêtage silencieux d'une ligne au-delà de 21 474 836,47 € ; moteur v1 perpétué par duplication (sections ≠ pied) ; pertes et rendements aux sémantiques variables ; indice matière appliqué comme pourcentage. | Confirmé | Faible à moyenne | [D1-03, D1-10, D1-16, D1-17] | Cas rares mais montants contractuels | Erreur au lieu d'écrêtage ; migration v1 → v2 à la duplication |
| C-14 | Points solides : moteur v2 réconcilié au centime (Σ lignes = Σ sections = pied, test par propriétés sur 300 devis) ; allocation au plus grand reste testée sur 10 000 tirages ; autoliquidation cohérente ; validité 6 mois et exclusion du 0 € cohérentes entre TS et SQL pour le prix de référence ; le moteur reproduit au centime les 7 lignes-oracle du classeur OPTIMA du porteur (coefficient unique, heures totales saisies). | Confirmé | — | [D1 §5, D4 §2.4] | — | Conserver ; transformer les « DIVERGENCE » des goldens en exigences ou règles acceptées |

### 3.3 Usage, ergonomie et continuité des parcours

| ID | Constat | Statut | Gravité | Preuve | Conséquence | Recommandation |
|---|---|---|---|---|---|---|
| U-01 | **Visibilité par propriétaire, pas par entreprise** : le chiffreur (engineer) de l'entreprise A voit « 0 affaires » et reçoit 404 sur les devis de l'admin ; le lecteur aussi ; la direction voit l'affaire au tableau de bord mais 404 sur le devis. Les taux horaires sont également rattachés à l'utilisateur. | Confirmé à l'exécution | Élevée | [P-14] ; `labor_roles.user_id` [D1 R03] | Pas de travail d'équipe, de relève ni de revue croisée ; rôles MO à recréer par chiffreur | Arbitrage 10 |
| U-02 | **Verrou d'édition sans reprise** : après reconnexion ou changement d'onglet, « Verrouillé par vous dans un autre onglet ou appareil » pendant 120 s, sans action pour reprendre la main ; une saisie faite pendant le verrou est perdue. | Confirmé à l'exécution | Moyenne | [P-02] ; `DRAFT_LOCK_TTL_SECONDS = 120` | Friction quotidienne et perte de saisie | Bouton « reprendre ici » pour le même utilisateur ; saisie bloquée explicitement pendant le verrou |
| U-03 | **Import du format du porteur mal reconnu** : au collage, l'en-tête OPTIMA est détecté comme « BDC » ; « Prix Unitaire » part en unité, les temps sont perdus ; à l'import, l'heuristique `includes("unit")` capte « Prix Unitaire » et « Tps pose unitaire » ; « Qté Atelier/Chantier » de la DPGF client non reconnues. La lecture des fichiers, elle, fonctionne (en-têtes et lignes corrects sur les 3 DPGF réelles). | Confirmé (heuristique, rejeu) ; effet final après correction manuelle **non audité** | Élevée | `src/lib/mappings/server.ts:839-841` ; test I-01 [D4-17, P-15] | Lignes importées sans MO ou avec PU erronés, sans alerte | Motif prix avant « unit » ; alias des en-têtes réels ; projet A comme recette d'import |
| U-04 | **Contrôles avant envoi peu lisibles** : bandeau « anomalies bloquantes » dès un devis vide, critère positif (« Toutes les lignes ont un prix FO valide ») affiché en rouge prioritaire ; messages techniques (« Configuration email manquante: RESEND_API_KEY »). | Confirmé à l'exécution | Faible | [P-01, P-07] | Bruit ; perte de confiance dans les alertes | Libellés orientés action ; aucun blocage sur un devis vide |
| U-05 | **Saisie, collage et annulation** : l'annulation d'une édition de cellule restaure très probablement la valeur déjà saisie (aucun effet visible) et la pile est vidée à chaque lot enregistré (≈ 60 s) ; au collage, « PU HT » est mappé sur le prix d'achat PR FO puis margé une seconde fois, l'aperçu montre le texte brut (« 1,875 » inséré à 1 875 €), une quantité absente devient 1 ; un prix à trois décimales est refusé sans message ; l'action groupée « Majoration MO (%) » avec « 10 » divise la MO par dix, dans une colonne masquée par défaut. | Confirmé (code) ; annulation sans effet **Probable** | Élevée | `useEstimateEditorItemsController.ts:806-857` ; `useEstimateEditorSyncController.ts:924` ; `clipboard.ts:79-90`, `:320-322` ; `EstimateEditorCommandBar.tsx:840-875` [D3-02, D3-04, D3-05, D3-06] | Erreurs de masse invisibles avant insertion ; perte de confiance dans l'annulation | Valeur d'avant édition comme état d'annulation ; aperçu des valeurs interprétées ; distinguer prix d'achat et prix de vente ; refus explicites |
| U-06 | **Sous-détail** : une ligne porte un seul couple FO/MO et ne peut pas avoir d'enfant ; un ouvrage inséré devient une section éclatée, sans quantité. Le porteur, lui, chiffre une ligne DPGF par un sous-détail d'articles « par unité de la ligne » multiplié par la quantité. | Confirmé (modèle) ; impact Probable | Élevée | `20260812032857…sql:2585-2592` ; `assemblies-server.ts:632-636` [D3-08] ; [D4 §2.1] | Lien ligne DPGF ↔ sous-détail perdu ; quantités recalculées à la main | Arbitrage 14 : ligne d'ouvrage avec sous-détail et quantité |
| U-07 | **Reprise après incident** : le tampon local n'est lié ni à l'utilisateur ni à une révision et réapplique des lignes complètes ; la restauration après conflit réapplique tout le brouillon sans comparaison ; le brouillon de conflit disparaît à la fermeture de l'onglet ; la valeur en cours de frappe n'est pas protégée. | Probable (code lu de bout en bout, non exécuté) | Élevée | `editor-drafts.ts:7-31` ; `useEstimateEditorSyncController.ts:385-437`, `:473-487`, `:1213-1244` [D3-13, D3-14, D3-16] | Écrasement silencieux de corrections plus récentes, contraire à « ne jamais réécrire l'historique » | Tampon lié à l'utilisateur et à la révision ; écran de fusion ligne par ligne |
| U-08 | **Comprendre le prix** : vue par défaut « Essentiel » masquant K FO, K MO, déboursé sec et marge ; formule d'aide incomplète ; jusqu'à 14 bandeaux simultanés ; autosave à 60 s (la documentation dit 2 s) ; navigation clavier sans Début/Fin ni plage, Entrée décrite à tort dans l'aide. | Confirmé (code) | Moyenne | `useColumnVisibility.ts:23-41` ; `EstimateEditorAlerts.tsx:79-259` ; `useEstimateEditorSyncController.types.ts:16-24` [D3-01, D3-10, D3-12, D3-18] | Le chiffreur ne voit pas ses coefficients ni sa marge ; bruit d'alerte | Vue par défaut orientée chiffreur ; centre d'alertes unique ; conventions Excel |
| U-09 | **Le devis n'est pas encore le point de départ du chantier** : préparation d'achats seule ; budget, engagé, consommé, heures réelles et apprentissage absents. | Confirmé (documents de l'équipe et code) | — (hors V1 recommandée) | `recette-flows-critiques-2026-10-13.md:21` | Vision non couverte au-delà de l'offre | Hors V1 ; échange simple avec l'outil d'achats existant |
| U-10 | Points solides : éditeur de type tableur (frappe directe, Tab, flèches, F2, sélection Maj+clic, Ctrl+A, copie TSV relue au recollage) ; statut de sauvegarde accessible, Ctrl+S, envoi à la sortie de l'onglet, garde de navigation ; confirmation avant suppression ; aides de colonnes pédagogiques (marge et marque) ; assistants IA facultatifs avec équivalents manuels ; exports Excel, DPGF, BDC et CSV. | Confirmé | — | [D3 §6, D3-21, D3-22] | — | Conserver |

### 3.4 Qualité du produit et processus

| ID | Constat | Statut | Gravité | Preuve | Conséquence | Recommandation |
|---|---|---|---|---|---|---|
| Q-01 | **L'état transmis n'est pas cohérent** : 86 tests unitaires en échec (11 fichiers par décalage code/tests), 4 suites pgTAP cassées par les migrations non commitées, budget d'architecture dépassé ; la CI verte porte sur `ce5874f5`. | Confirmé | Élevée | §2 | Le code décrit par les preuves « qualifié localement » ne passerait pas la CI | Recette sur un SHA publié uniquement |
| Q-02 | **Trois jours de travail non commités sur `main`** (≈ 367 entrées, +41 k/−23 k lignes, 20 migrations), après une corruption de l'index Git consignée par l'équipe. | Confirmé | Élevée | `git status` [D5-12] | Risque de perte ; aucune revue possible | Branche de sauvegarde immédiate, puis commits relus par PR |
| Q-03 | **Tests qui figent des valeurs fausses** : environ 25 « DIVERGENCE » dans les goldens ; un test recopie la formule de sauvegarde et fige EU01 (5 000 c → 442 pb → 5 002 c) ; aucune exigence métier testée sur h MO, monotonie des paliers, TVA v2, seuil, 0 €. 54 % des fichiers de test reposent sur des mocks ; parcours métier TesterArmy hors CI ; 164 suites supprimées le 09/10 dont des régressions de sécurité. | Confirmé | Moyenne | `estimate-calculations.golden/v1.test.ts:1179-1232` [D1 §5, D5-13] | Un test vert ne prouve pas qu'un montant est juste | Tests d'exigence issus de l'oracle ; parcours critiques en CI sur pile éphémère |
| Q-04 | **Complexité disproportionnée au stade du produit** : ≈ 310 000 lignes TypeScript, 136 000 lignes de tests, 72 000 lignes SQL (245 migrations), fichiers de 7 000 à 8 000 lignes, 144 routes API, 139 fichiers .md dont 82 non suivis, jargon d'agents (« army », « RED/GREEN », « bail », « oracle », « goal ») dans la documentation. | Confirmé | Élevée (coût de reprise) | `wc -l` ; [D5-11, D5-14] | Coût de maintenance et de reprise élevé ; documentation inaccessible au porteur | Recentrage V1 ; documentation de référence courte en français courant |
| Q-05 | **Matériaux du porteur non exploitables tels quels** : bible enregistrée sans recalcul (valeurs en cache contraires aux formules), 117 identifiants ne différant que par la casse (le kit serti tire les prix du soudé), K FO/K MO vides, temps BDC et bible divergents d'un facteur 2 à 7, 29,5 % des articles avec un prix. | Confirmé | Élevée (pour toute reprise de données) | [D4-10 à D4-15] | Importer ces bases propagerait des erreurs | Nettoyage et validation avant migration |

---

## 4. Affirmations antérieures

| Affirmation (source) | Verdict | Fondement |
|---|---|---|
| EU01 : 1,01 € devient 2,00 € par conversion en taux arrondi (dossier §4, contrat de remise) | **Confirmé** | Tests A-01 et rejeu interface P-05 |
| EU02 : le montant fixe n'est pas stocké | **Confirmé** (aucune colonne dans l'archive) | `discount_amount_cents` absent de l'archive |
| EUHIST : 3,80 € HT au lieu de 3,60 € | **Confirmé** (mécanisme) ; paramètres reconstitués | Test A-02 |
| Quality Gate « rouge depuis le 20/08 », matrice RLS « rouge » (audit de dette du 10/10) | **Infirmé au 14/10** pour `ce5874f5` ; mais l'état transmis les ferait échouer | `gh run list` ; §2 |
| « Aucune sauvegarde » (audit de dette du 10/10) | **Confirmé** | S-03 |
| Bug « unité remplacée par la désignation » (audit de dette du 10/10) | **Partiellement corrigé** : chemin « Associer l'article » corrigé par `ce5874f5`, chemin « suggestion catalogue » toujours fautif | C-09 |
| Registre de sécurité : 95/95 « fixed » ; R001-003 « recherches inter-entreprises côté serveur après contrôle admin » | **Infirmé en effet** pour R001-003 | S-08 |
| « Paliers par défaut non signalés » (`regles-de-calcul.md`) | **Infirmé** (texte du panneau, drapeau bloquant) | D1 R07 |
| Seuil d'approbation « inclus » (`CONTEXT.md`) vs « > seuil » (`validation-approbations.md`) | `CONTEXT.md` juste, document de domaine faux ; comparateur publié « <= » incohérent | Test B-03 |
| Remise simple stockée « en centimes ou en bp » (`regles-de-calcul.md`) | **Infirmé** : points de base uniquement | D1-01 |
| TVA multi-taux « inopérante » (glossaire) / « effective en v2 » | **Les deux incomplets** : calculée en v2, ni éditable ni ventilée, taux de version sans effet | C-06 |
| Annulation des cellules « jamais empilée » | **Périmé** : empilée, mais vidée à chaque lot enregistré | D1 §3.1 |
| « Autoliquidation implémentée intégralement » | **Confirmé** pour l'autoliquidation ; franchise en base non traitée (assumé) | D1 R14 |
| « Aucun jeton de portail n'est jamais créé » (`ecarts-standards-btp.md`) | **Non vérifiable à l'exécution** sans service e-mail ; jetons créés par le chemin d'envoi (code) | P-16 |
| « Le chiffrage qui prenait 3 jours se boucle en une matinée » (page d'accueil publique) | **Non étayé** ; le dossier lui-même déclare qu'aucun gain n'est mesuré | Page `/` de l'application |
| Sept parcours et 70 cas SQL « qualifiés localement » (campagne du 14/10) | **Non reproduits** tels quels ; preuves dans `.e2e/` non transmises ; nos rejeux concordent sur EU01 | D5-13 |
| Précision du métré « 100 % » | **Non audité** | Hors périmètre exécutable |

---

## 5. Référentiel des règles (synthèse)

Le référentiel complet (32 règles, implémentation TS et SQL, nature proposée, source, validateur) est dans
`rapports-axes/D1-regles-calculs.md` §2. Constat transversal : **aucune règle n'a de validateur métier nommé** ;
seules deux décisions du porteur sont documentées (validité 6 mois, offre à 0 €). Classement proposé :

| Nature | Règles |
|---|---|
| Obligation légale ou fiscale | Taux de TVA applicables ; autoliquidation sous-traitance (art. 283-2 nonies CGI) ; mentions obligatoires du devis (à faire valider par un juriste, dont l'assurance décennale) |
| Choix d'entreprise (à signer) | Coefficients de vente FO et MO ; barème de coefficients ; validité des offres fournisseurs ; politique du 0 € ; seuil d'approbation ; arrondi commercial ; visibilité des affaires |
| Paramètres | Taux horaires par catégorie ; seuils d'alerte ; délai de fraîcheur des prix |
| Conventions à décider | Heures unitaires ou totales ; méthode d'arrondi par grandeur ; unité du calorifuge ; définition du pouce de soudure |
| Hypothèses non sourcées (à retirer ou valider) | Barème par défaut 1,60/1,45/1,40 ; seuils Direction 12 %, 8 %, 25 k€ ; dispersion 15 % ; pertes et ratios de la bible |

---

## 6. Delta du dépôt vivant (en cours, non audité)

Constaté en lecture le 14/10 après la capture : colonne `discount_amount_cents` et RPC de réglages redéfinie
(migration `20261014114943`, « no backfill ») ; arithmétique décimale exacte pour le coût et la vente de ligne
(peut modifier des montants en cas limite) ; écrêtage signalé par ligne ; mention « remise historique ».
La sauvegarde **réécrit encore un `discount_bp` arrondi** à côté du montant fixe. Non touchés : C-01, C-04 à
C-06, C-09, C-10, C-12. Ce correctif doit être qualifié sur un SHA publié avant d'être considéré comme acquis.

---

## 7. Non audité

- Production : migrations appliquées, données, configuration Auth (inscription ouverte ?), variables Vercel,
  plans d'hébergement, journaux, déploiements Preview.
- Envoi réel des e-mails, portail client à l'exécution (pas de jeton sans service e-mail), signature.
- Fonctions IA (Gemini : classification de pièces, brief, métré, revue CCTP), worker de métré.
- Performance sous charge (objectif « 1 000 lignes, p95 ≤ 200 ms »), concurrence multi-utilisateurs réelle.
- Parcours rejoués non couverts : import complet par l'interface, collage dans la grille, ouvrages et
  sous-détails, approbation par la direction, bons de commande, deux onglets au-delà du verrou. La liste des
  40 vérifications d'interface restantes est dans `rapports-axes/D3-ergonomie-continuite.md` §5.
- Macros VBA des classeurs du porteur.
- Entretiens utilisateurs : remplacés, à la demande du porteur, par des arbitrages de l'auditeur (rapport §6).
- Validité actuelle des identifiants exposés (volontairement non testée).

---

## 8. Reproduire les résultats

1. Extraire l'archive dans un dossier neuf ; copier `node_modules` d'une installation existante ; ajouter les
   fichiers listés dans `reproductions/resultats/snapshot-additions.txt`.
2. Tests de caractérisation : copier `reproductions/*.audit.test.ts` dans `src/__audit__/` de la copie, puis
   `npx vitest run --project=node src/__audit__`. Les tests **passent quand l'écart existe** ; un test qui
   échoue signale que le constat n'est plus reproduit (correction ou changement de comportement).
3. Pile locale : `reproductions/outils/wsl/start-stack.sh` (WSL, CLI Supabase 2.120.0 déjà installée, ports
   563xx, projet distinct), `make-env.sh` (écrit un `.env.local` loopback sans clé externe), `pgtap.sh`.
4. Comptes de test : `reproductions/outils/seed-accounts.mjs <dossier>` ; connexion sans exposer les mots de
   passe : `login-relay.mjs` (cookie posé sur 127.0.0.1). Lectures : `sql-read.mjs`, `pdf-text.mjs`.
5. Nettoyage : `supabase stop` puis `supabase stack destroy --yes` avec `--workdir ~/audit-miaouffrage-20261014`.

---

## 9. Index des pièces

| Pièce | Contenu |
|---|---|
| `rapport-audit-independant.docx` | Rapport pour le porteur |
| `registre-audit.csv` | Registre de questions complété (format d'origine, séparateur `;`) |
| `rapports-axes/D1-regles-calculs.md` | Règles et calculs : 19 constats, référentiel de 32 règles, 37 cas de reproduction |
| `rapports-axes/D2-securite.md` | Sécurité applicative, portail, RLS, cycle de vie des offres ; registre de sécurité confronté au code |
| `rapports-axes/D3-ergonomie-continuite.md` | Grille, saisie, collage, annulation, sauvegarde, conflits, parcours, écart à la vision ; 34 constats, 40 vérifications d'interface restantes. Les éléments marqués † viennent d'analyses secondaires intégrées sans revérification par l'auditeur principal : à traiter comme « Probable ». Le « fichier .env.local » qu'il signale est la configuration loopback créée par l'auditeur dans sa copie de travail ; il n'est ni dans l'archive ni dans ce dossier. |
| `rapports-axes/D4-materiaux-metier.md` | Matériaux du porteur contre le modèle : 22 constats, 27 correspondances, 7 lignes-oracle |
| `rapports-axes/D5-qualite-exploitation.md` | Exploitation, CI, déploiement, documentation : 18 constats, 12 conditions |
| `rapports-axes/C-parcours.md` | 16 scénarios rejoués sur la pile locale |
| `reproductions/` | Tests de caractérisation, outils, résultats bruts, scripts D4 |
