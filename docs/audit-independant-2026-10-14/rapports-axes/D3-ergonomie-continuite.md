# D3 — Ergonomie et continuité des parcours

Audit indépendant, axe D3. Rédigé le 14 octobre 2026.

## 0. Cadre, méthode et limites

**Référence.** Le rapport porte sur la copie figée `handoff-audit-independant/annexes/repository`, notée R. Tous les chemins cités sont relatifs à R et donnent un numéro de ligne.

**Méthode.** Lecture du code uniquement : aucune modification, aucune exécution de l'application, aucun accès réseau. Les documents de l'équipe sont traités comme des affirmations à vérifier.

**Provenance des constats.**
- *Lecture directe par l'auditeur D3* : grille, saisie, presse-papiers, annulation, autosave, tampon local, verrou, conflits, menus d'insertion et d'export (constats D3-01 à D3-22).
- *Analyses parallèles en lecture seule* commandées par l'auditeur D3 (parcours, explication du prix et alertes, volume, vocabulaire, accessibilité), intégrées sans relecture ligne à ligne de chaque citation. Ces constats sont marqués **†**. Leur statut est celui établi par l'analyse ; ceux qui recoupent la lecture directe ont été confrontés à elle.
- *Confirmations d'exécution* transmises par l'auditeur principal (pile locale). Elles sont marquées « **confirmé à l'exécution** » et ne sont pas redémontrées ici :
  1. visibilité limitée au propriétaire : le chiffreur voit 0 affaire, la direction reçoit une 404 sur le devis ;
  2. verrou « Verrouillé par vous » sans reprise possible pendant 120 s, avec perte de saisie ;
  3. bandeau « anomalies bloquantes » affiché sur un devis vide ;
  4. format OPTIMA mal reconnu au collage et à l'import.

**Statuts.**

| Statut | Signification |
|---|---|
| Confirmé | lu sans ambiguïté, ou observé à l'exécution |
| Infirmé | affirmation contredite par le code |
| Probable | forte présomption tirée du code, non exécutée |
| À vérifier | hypothèse plausible |
| Non audité | non examiné |

**Limites.** Le rendu visuel, les contrastes, les temps de réponse et le comportement réel du navigateur ne sont pas audités (section 5). Remarque hors axe : une analyse parallèle signale un fichier `.env.local` à la racine de R. Il n'a pas été ouvert. Or le LISEZ-MOI de la passation affirme qu'aucun `.env` n'est fourni : vérifier qu'aucun secret ne figure dans l'annexe.

## 1. Synthèse

**Points forts.**
- L'éditeur est un vrai tableur : saisie directe, navigation clavier, sélection multiple, collage avec aperçu, virtualisation, autosave avec tampon local, verrou par onglet, détection de conflit.
- L'offre émise est figée et le PDF correspond à la version scellée.
- Les assistants IA sont facultatifs et ont presque tous un équivalent manuel. Il n'existe aucune interface conversationnelle.

**Ce qui fait défaut.** La confiance quotidienne et la continuité du parcours.

1. **Fiabilité de saisie.**
   - L'annulation d'une édition de cellule est très probablement sans effet, et l'historique est vidé à chaque autosave (cadence de 60 s).
   - Le texte « 2,500 » est lu de trois façons selon le champ et le canal.
   - Un prix à trois décimales est refusé sans message.
   - L'aperçu de collage montre le texte brut et non la valeur écrite.
   - Une colonne « PU HT » collée alimente le prix d'achat.
   - Le format OPTIMA est mal reconnu (confirmé à l'exécution).
   - La « Majoration MO », annoncée « non utilisée », est active dans le calcul. Son action groupée transforme « 10 » en coefficient 0,1.
2. **Reprise et collaboration.**
   - Le tampon local et la restauration après conflit peuvent écraser sans bruit des modifications plus récentes.
   - Verrou « par vous » pendant 120 s avec perte de saisie, et visibilité limitée au propriétaire (tous deux confirmés à l'exécution).
3. **« Pourquoi ce prix ».**
   - L'explication n'existe que pour les lignes issues du métré, d'un ouvrage IA ou de la bibliothèque, et ne décompose pas le prix.
   - Par défaut (mode simplifié, colonnes « Essentiel »), le chiffreur ne voit ni ses coefficients ni sa marge.
   - « Marge » désigne deux grandeurs selon l'écran.
   - Les infobulles contredisent la formule.
4. **Continuité du parcours.**
   - Créer une affaire ouvre un éditeur vide et laisse une V1 orpheline.
   - Le DPGF doit être déposé deux fois.
   - Le métré est désactivé par défaut.
   - La revue CCTP est isolée et sans effet sur l'envoi.
   - « Envoyer » n'envoie rien : seul l'envoi par email crée le lien portail.
   - Un refus client devient « archivé ».
   - Aucune notification ne parvient au chiffreur.
   - Les bons de commande ne requièrent pas un devis accepté et n'ont pas de lien retour.
   - Le volet chantier et retour d'expérience est absent.
5. **Charge d'alertes et vocabulaire.**
   - Jusqu'à environ 13 bandeaux cumulables ; alerte bloquante sur devis vide.
   - 20 drapeaux d'envoi (et non 19) ; avertissements non acquittables ; identifiants techniques affichés.
   - 16 tables de libellés de statut ; « sending » affiché brut ; affaire / projet / dossier employés indifféremment.

## 2. Constats

### A. Grille de chiffrage et saisie

#### D3-01 — Navigation clavier réelle mais incomplète ; l'aide se trompe sur Entrée

**Statut : Confirmé.**

**Preuves.**
- Commandes reconnues : Échap, Ctrl+Z en édition, F2, frappe directe, Tab, flèches et Entrée (`src/hooks/useSpreadsheetNavigation.ts:160-216`).
- Hors édition, Entrée descend d'une ligne au lieu d'éditer (`:198`).
- La navigation boucle de la dernière à la première ligne (`:361-364`, `:372-390`).
- Un simple clic ouvre l'édition (`:229-237`, `:749-759` ; `src/components/estimates/EditableCell.tsx:114-120`).
- Absents : Début/Fin, Page préc./suiv., Ctrl+flèche, plage de cellules au clavier.
- Suppr agit sur la sélection de lignes (`src/components/estimates/hooks/useEstimateKeyboardShortcuts.ts:143-155`) et ne vide pas la cellule.
- L'aide affiche « Entrée — Modifier la cellule » (`src/components/ui-legacy/KeyboardShortcutsModal.tsx:81`), omet F2 et ne mentionne pas le collage.
- Ctrl+Maj+A ouvre le sélecteur d'ouvrages (`useEstimateKeyboardShortcuts.ts:213-225`) ; possible collision avec la recherche d'onglets de Chrome, à vérifier.

**Impact.** Les réflexes Excel échouent. En fin de tableau, le saut silencieux vers le haut désoriente sur un devis de 1 000 lignes.

**Recommandation.**
- Aligner sur les conventions Excel : Entrée édite puis valide vers le bas, Maj+Entrée remonte, Suppr vide la cellule, Début/Fin et Ctrl+flèche fonctionnent, aucun bouclage.
- Corriger l'aide.

#### D3-02 — Annulation : édition de cellule empilée mais probablement sans effet ; pile vidée à chaque autosave

**Statut.** Pile vidée : Confirmé. Annulation sans effet : Probable. Affirmation de la documentation : Infirmée.

**Preuves.**
- La pile compte 50 entrées (`src/hooks/useEstimateEditorHistoryController.ts:7`) et 13 types d'opérations, dont `patch-item` (`src/hooks/useEstimateEditorItemsController.ts:344,562,702,845`) et les opérations groupées (`useEstimateEditorBulkController.ts:197,268,417,476,544`).
- Pourquoi l'annulation est probablement sans effet :
  - chaque frappe applique d'abord un patch local `persist: false` (`components/estimate-editor-row/LineRow.tsx:850-856`, `:918-929`) ;
  - `itemsRef` est resynchronisé après chaque rendu (`src/hooks/useEstimateEditorState.impl.tsx:628-630`) ;
  - à la validation, `previousItem` contient donc déjà la valeur saisie (`useEstimateEditorItemsController.ts:806-810`), et l'annulation remet cette même valeur (`:846-857`) ;
  - aucun test ne couvre l'annulation d'une cellule.
- `clearHistory()` est appelé après chaque lot validé (`src/hooks/useEstimateEditorSyncController.ts:924`, `:958`) et à la reprise (`:503`).
- Ctrl+Z est inactif dans un champ texte (`useEstimateKeyboardShortcuts.ts:181-188`).
- La documentation affirme « six opérations… éditions de cellule jamais empilées… ~2 s » (`docs/domaines/chiffrage-editeur.md:126`).

**Impact.** Ctrl+Z ne rétablit pas une quantité ou un prix erroné, et rien ne le signale. L'annulation reste possible environ une minute au plus.

**Recommandation.**
- Mémoriser la valeur avant édition au moment du focus (`editInitialValuesRef` existe déjà).
- Découpler l'historique de la sauvegarde.
- Ajouter un test de bout en bout « modifier puis Ctrl+Z ».

#### D3-03 — Collage depuis Excel : insertion seulement, en-tête obligatoire, cellules multi-lignes cassées

**Statut : Confirmé.**

**Preuves.**
- Le collage est ignoré si le focus est dans un champ texte (`src/components/estimates/hooks/useEstimateClipboard.ts:319-346`). Or un simple clic met la cellule en édition (D3-01).
- Il insère toujours de nouvelles lignes, jamais de valeurs dans des cellules existantes (`src/hooks/useEstimateEditorPasteController.ts:115-197`).
- La première ligne collée est toujours prise pour un en-tête (`src/lib/estimates/clipboard.ts:495-496`).
- Le texte est découpé sur `\n` avant le traitement des guillemets (`clipboard.ts:468`, `:199-228`).

**Impact.** Le geste le plus courant (coller un bloc sans en-tête, ou une colonne de quantités) ne fonctionne pas. Les désignations multi-lignes d'un DPGF sont éclatées.

**Recommandation.**
- Détecter l'en-tête, ou laisser l'utilisateur l'indiquer.
- Gérer les guillemets multi-lignes.
- Offrir un collage dans les cellules, distinct du collage en nouvelles lignes.

#### D3-04 — Collage : valeur interprétée non montrée, défauts silencieux, PU confondu avec PR FO, OPTIMA mal reconnu

**Statut.** Confirmé (code) ; OPTIMA confirmé à l'exécution.

**Preuves.**
- L'aperçu affiche `rawValues` (`useEstimateClipboard.ts:126-139`).
- Dans le domaine des montants, « 1,875 » devient 1 875 (`clipboard.ts:320-322`, `:781-786`).
- Quantité absente : 1. Prix absent : 0 (`useEstimateEditorPasteController.ts:135-145`).
- Un type de fourniture inconnu est ramené à `null` (`:190-192`).
- « pu ht », « pu », « prix ht » alimentent `unit_price_ht`, qui est le PR FO (`clipboard.ts:79-90`). Ce prix est ensuite multiplié par K FO puis par la marge (`useEstimateEditorPasteController.ts:136-171`).
- La détection par score (`clipboard.ts:505-566`) n'apparaît que sous forme de badge (`PastePreviewDialog.tsx:58-70`).

**Impact.** Des erreurs ×1 000 ou une double marge peuvent passer en masse. Des lignes sans quantité gonflent le total.

**Recommandation.**
- Afficher la valeur interprétée et signaler les cas ambigus.
- Laisser vide une quantité absente.
- Faire choisir explicitement entre prix d'achat et prix de vente.
- Constituer un corpus OPTIMA réel de test.

#### D3-05 — Saisie numérique française : comportements divergents et refus silencieux

**Statut : Confirmé.**

**Preuves.**
- Quantité : « 1 000,50 » est accepté ; une saisie invalide donne 0 (`src/lib/estimates/editor-values.ts:46-64`, `:76-79`).
- Prix : au-delà de deux décimales, la saisie est refusée sans message (`src/lib/money.ts:51-70` ; `LineRow.tsx:930-941`).
- « 2,500 » donne 2,5 en quantité saisie, est refusé en prix saisi, et devient 2 500 € en prix collé.
- En MO éclatée, les champs heures et coefficients sont des `type="number"` (`LaborSplitCells.tsx:126,177,239,282,344`), comme la majoration (`StandardMoCells.tsx:148`). Le commentaire de `LineRow.tsx:838-841` reconnaît pourtant que ce type rejette la virgule.

**Impact.** Des saisies disparaissent ou valent 0 sans explication.

**Recommandation.**
- Un analyseur unique par domaine, avec un message d'erreur sur place.
- Trois à quatre décimales pour les prix d'achat (le modèle en centimes est à rediscuter).
- `type="text"` partout.

#### D3-06 — Majoration MO : annoncée inutilisée, active dans le calcul, avec une action groupée piège

**Statut : Confirmé.** Impact élevé.

**Preuves.**
- L'aide indique « Non utilisée pour le moment : laisser à 100% » (`ColumnHeaderHelp.tsx:12`), et la colonne n'est présente dans aucun préréglage (`useColumnVisibility.ts:28-31`).
- Le moteur l'applique pourtant (`src/lib/estimate-calculations.ts:201,233-236,826-830`), alors que l'infobulle du PU l'omet (`ColumnHeaderHelp.tsx:14`).
- L'action groupée « Majoration MO (%) » vaut 100 par défaut et divise la saisie par 100 (`EstimateEditorCommandBar.tsx:840-875` ; `useEstimateSelection.ts:34,74-77` ; `estimate-editor-row/shared.ts:260-262`). Saisir « 10 » donne donc un coefficient de 0,1.

**Impact.** Une saisie naturelle divise la main-d'œuvre par dix, dans une colonne masquée.

**Recommandation.** Faire trancher par le métier. Si le champ est conservé : saisie en « +x % », 0 = neutre, colonne visible dès qu'elle n'est pas neutre, formule complète. Sinon : neutraliser le champ et retirer l'action.

#### D3-07 — Modifications groupées limitées

**Statut : Confirmé.**

**Preuves.**
- Actions disponibles : déplacer, majoration, catégorie, rôle MO, supprimer, copier (`EstimateEditorCommandBar.tsx:787-985`).
- Sélection : Maj+clic, Ctrl+clic, Ctrl+A (`src/hooks/useMultiSelect.ts:221-228`).
- Absents : action groupée sur quantité, prix, K, type FO, unité ou article ; rechercher-remplacer.
- Le titre « Supprimer définitivement » (`:977`) contredit l'annulation possible.

**Impact.** Actualiser des prix de x % ou recaler un K par lot se fait ligne par ligne.

**Recommandation.** Appliquer une formule à une colonne de la sélection, avec aperçu de l'impact sur le total.

#### D3-08 — Sous-détail et ouvrages : la ligne ne se décompose pas ; l'ouvrage devient une section sans quantité

**Statut.** Confirmé (modèle) ; impact Probable.

**Preuves.**
- Une ligne porte une seule fourniture et une seule MO (`src/lib/estimates/editor-items.ts:199-228`).
- Une ligne ne peut pas avoir d'enfant (`supabase/migrations/20260812032857_govern_estimate_calc_engine_v2.sql:2585-2592`).
- Un ouvrage inséré devient une section, sans paramètre de quantité (`useEstimateEditorStructureController.ts:254-335` ; `src/lib/estimates/assemblies-server.ts:632-636`).
- Une section n'a pas de quantité (`SectionRow.tsx:323-398`).
- Les variantes portent sur la version entière (`supabase/migrations/20260222170000_est223_variants.sql:5-14`).

**Impact.** Impossible de construire le PU composé d'une ligne de DPGF (« F&P radiateur, U, 12 ») et de le multiplier par la quantité du DPGF.

**Recommandation.** Décision de modèle à prendre avec un chiffreur : ligne d'ouvrage à sous-détail rattaché (PU composé × quantité).

#### D3-09 — Association d'article : le défaut historique est corrigé, mais le remplacement se fait sans aperçu

**Statut.** Correction Confirmée ; risques Probables.

**Preuves.**
- `description` reçoit désormais l'unité (`src/components/estimates/EstimateEditorTable.tsx:1561,1574`).
- La désignation et le prix sont remplacés (`:1573,1575`).
- L'unité n'est pas affichée dans la liste de choix (`EstimateArticleSheet.tsx:229-248`).
- L'association est immédiate, sans conversion de quantité.

**Impact.** La désignation du DPGF est perdue, et un changement d'unité peut passer inaperçu.

**Recommandation.**
- Aperçu avant/après.
- Option « conserver la désignation DPGF ».
- Alerte si l'unité change.

#### D3-10 — Par défaut, les éléments du prix sont masqués (mode simplifié et colonnes « Essentiel ») †

**Statut : Confirmé.**

**Preuves.**
- Le préréglage par défaut est `essential`, sans aucune colonne avancée (`src/hooks/useColumnVisibility.ts:23-24,83`).
- `DEFAULT_UI_MODE = "simplified"` (`src/lib/ui-mode.ts:5` ; `supabase/migrations/20260304143000_ux2_001_ui_mode.sql:11`) †.
- Le mode simplifié masque aussi : le groupe « Outils » de la navigation (bibliothèque d'ouvrages comprise), les puces TVA et remise, « Insérer un modèle », les contrôles avancés et le widget d'analyse de marge (`build-nav-groups.tsx:156` ; `EstimateSettingsSummaryBar.tsx:189` ; `EstimateEditorCommandBar.tsx:316,610,661` ; `AffaireHub.tsx:1165`) †.

**Impact.** Le chiffreur ne voit ni ses coefficients ni sa marge par ligne. Le code reconnaît lui-même ce besoin (`useColumnVisibility.ts:14-16`).

**Recommandation.**
- Mode par rôle.
- Afficher par défaut K FO, K MO, déboursé sec et marque.
- Signaler les paramètres masqués non neutres.

#### D3-11 — Grands devis : la virtualisation est présente, la performance annoncée n'est pas outillée †

**Statut.** Mécanisme Confirmé. Objectif « 1 000 lignes, p95 ≤ 200 ms » : non outillé (Confirmé) et non démontré (À vérifier).

**Preuves.**
- Virtualisation `auto` dès 50 éléments (`src/lib/estimate-editor-virtualization.ts:3,151-160`), contre 120 selon la documentation (`chiffrage-editeur.md:128`).
- Drapeaux nommés `EST_264_*` et non `ESTIMATE_EDITOR_VIRTUALIZATION_*` (`:5-8`).
- Conteneur de 640 px (`useEstimateDndVirtualization.ts:45`).
- Chaque frappe provoque un `setItems` et un recalcul complet (`LineRow.tsx:850-856` ; `src/hooks/useEstimateEditorCalculation.ts:186-275`), et le contexte de navigation change à chaque déplacement (`useSpreadsheetNavigation.ts:734-786`).
- L'objectif figure au backlog comme cible P1 (`docs/product/backlog-chiffrage-2026-10-11.md:123-127`) †.
- Le seul banc de mesure place les lignes en `sent`, donc en lecture seule. Il mesure le LCP et le défilement, sans seuil (`e2e/army/performance/editor-grid.e2e.ts:41,76-103` ; `docs/testing/tester-army-performance.md:42`) †.
- Seule barrière automatique : un budget de bundle (`config/performance-budgets.json`) †.

**Impact.** La latence de saisie sur un gros devis n'est ni mesurée ni garantie. La grille est plafonnée à 640 px.

**Recommandation.**
- Banc de saisie (INP) sur 1 000 et 3 000 lignes éditables, avec seuil bloquant.
- Recalcul incrémental.
- Hauteur adaptée au viewport.

### B. Sauvegarde, reprise et collaboration

#### D3-12 — Autosave à 60 s, et non à 2 s ; statut et sorties bien gérés

**Statut.** Confirmé ; documentation Infirmée.

**Preuves.**
- Cadence de 60 000 ms (`src/hooks/useEstimateEditorSyncController.types.ts:16-24`), alors que la documentation annonce 2 000 ms (`chiffrage-editeur.md:110`).
- Envoi immédiat dès 100 modifications (même fichier).
- Envoi forcé quand l'onglet est masqué ou à `pagehide` (`useEstimateEditorSyncController.ts:1047-1075`).
- Ctrl+S et garde `beforeunload` (`src/hooks/useAutoSave.ts:500-537`).
- Garde de navigation interne (`useEstimateEditorSyncController.ts:1142-1179`).
- Trois nouvelles tentatives (`useAutoSave.ts:5-8,295-313`).
- Statut affiché avec `role="status"` et `aria-live` (`EstimateEditorToolbar.tsx:653-658`).

**Impact.** Le statut reste « En attente » jusqu'à une minute, et la fenêtre d'annulation est réduite (D3-02).

**Recommandation.** Cadence de quelques secondes, ou découplage de l'historique ; mettre la documentation à jour.

#### D3-13 — Tampon local non lié à l'utilisateur ni à une révision : réapplication silencieuse possible

**Statut : Probable.**

**Preuves.**
- La clé du tampon ne contient que l'identifiant de version : ni utilisateur, ni tenant, ni expiration (`src/lib/estimates/editor-drafts.ts:7,29-31,176-200`).
- Le tampon est écrit à chaque validation (`useEstimateEditorSyncController.ts:1181-1194`) et réappliqué au montage (`:385-437`).
- Il transporte la ligne complète (`editor-items.ts:199-228`).
- La concurrence n'est contrôlée qu'au niveau de la version (`supabase/migrations/20261012030743_atomic_estimate_batch.sql:207`), avec un jeton relu au rechargement.
- Le message de récupération s'affiche en rouge et sans liste des lignes concernées (`:432-434` → `EstimateEditorAlerts.tsx:251-259`).

**Impact.** Des lignes corrigées entre-temps par un collègue peuvent être réécrites sans qu'il le voie.

**Recommandation.** Lier le tampon à l'utilisateur et à la révision de base. Présenter les différences avant tout envoi d'un tampon périmé.

#### D3-14 — Conflit de version : restauration intégrale sans comparaison ; brouillon perdu à la fermeture de l'onglet

**Statut.** Confirmé (code) ; impact Probable.

**Preuves.**
- Le brouillon est placé en `sessionStorage`, puis le tampon est vidé (`useEstimateEditorSyncController.ts:473-487`, `:563-583`).
- « Restaurer mes changements » réapplique toutes les lignes encore présentes (`useEstimateEditorState.impl.tsx:446-481` ; `useEstimateEditorSyncController.ts:1213-1244`).
- Aucune comparaison n'est proposée (`EstimateEditorAlerts.tsx:155-174`).

**Impact.** Le choix est aveugle : perdre son propre travail ou écraser celui de l'autre.

**Recommandation.** Fusion ligne par ligne ; conservation durable du brouillon.

#### D3-15 — Bail d'édition : 120 s confirmé, battement de 15 s, blocage « par vous » sans reprise

**Statut.** Confirmé. Blocage avec perte de saisie : confirmé à l'exécution. Documentation infirmée sur le battement.

**Preuves.**
- Bail de 120 s (`src/lib/estimates/locks.ts:46` ; `supabase/migrations/20260820194939_atomic_estimate_draft_lock_takeover.sql:85`).
- Battement de 15 s et nouvelle tentative toutes les 5 s (`src/hooks/useDraftLock.ts:21-22`), contre 30 s dans la documentation (`chiffrage-editeur.md:115`).
- Message « vous dans un autre onglet ou appareil » (`useDraftLock.ts:571-584`).
- Le forçage est réservé aux administrateurs (`EstimateEditorAlerts.tsx:98-123`).
- La grille est en lecture seule tant que l'état est « Connexion… » (`useEstimateEditorSyncController.ts:665-674`).
- Le défaut CORE-06 est ouvert (`docs/testing/editor-navigation-lease.md:1-10`).
- Coquilles dans le message de perte de verrou (`useDraftLock.ts:13-14`).

**Impact.** Le chiffreur peut être bloqué deux minutes par lui-même et perdre sa saisie, sans recours s'il n'est pas administrateur.

**Recommandation.** Permettre la reprise immédiate par le même utilisateur (« reprendre ici »). Ne jamais laisser saisir dans une grille en lecture seule.

#### D3-16 — La valeur en cours de frappe n'est pas protégée avant validation

**Statut : Probable.**

**Preuves.**
- Pendant la frappe, les mises à jour sont en `persist: false` (`LineRow.tsx:850-856`).
- Le tampon n'est alimenté qu'à la perte de focus (`EditableCell.tsx:141-155`).
- `beforeunload` ne tient compte que du tampon (`useAutoSave.ts:88-93`).

**Impact.** Un F5 ou une fermeture pendant la frappe fait perdre la cellule active.

**Recommandation.** Considérer la cellule en édition comme une modification en attente.

#### D3-17 — Messages d'erreur techniques, bruts ou silencieux †

**Statut.** Confirmé ; masquage Next.js en production : Probable.

**Preuves.**
- Messages techniques : « batch », « clé d'opération », « projection » (`src/lib/estimates/batch.ts:73-81`) ; « Le résultat d'une opération reste à vérifier » (`src/hooks/useEstimateBatchRecovery.ts:45`).
- Messages serveur transmis tels quels (`useEstimateEditorState.impl.tsx:227-233`).
- Messages Supabase bruts affichés : `sites/page.tsx:178`, `profile/page.tsx:102`, `PurchaseOrderStatusUpdater.tsx:62`, `ProductCsvImport.tsx:97`, et 16 cas `{ error: x.message }` sous `src/app/api` †.
- Probable : en production, Next.js masque les messages des server actions (`QuickCreateAffaireDialog.tsx:547,594`) †.
- Accents manquants dans une vingtaine de chaînes : `useEstimateEditorHistoryController.ts:106`, `useColumnVisibility.ts:71`, `LineRow.tsx:807`, `affaires/_actions/project.ts:26`, `src/lib/affaires/intake.ts:225`, etc. †

**Impact.** Messages incompréhensibles ou absents au moment où le chiffreur doit décider.

**Recommandation.** Catalogue de messages métier (quoi, pourquoi, que faire) ; aucun refus silencieux ; relecture orthographique.

#### D3-18 — Empilement de bandeaux ; alerte bloquante sur devis vide

**Statut.** Confirmé ; devis vide confirmé à l'exécution.

**Preuves.**
- 15 bandeaux conditionnels, dont environ 13 peuvent se cumuler (`components/estimates/editor/EstimateEditorAlerts.tsx:79-263`).
- Le texte « Des anomalies bloquantes sont détectées… » (`:92-96`) ne dit ni quelles anomalies ni où.
- Les toasts sont limités à 3 et durent 4 s (`src/components/feedback/toast-renderer.tsx:87`) †.

**Impact.** Du bruit dès l'ouverture, à l'opposé de l'objectif « réduire le contrôle ».

**Recommandation.** Un centre d'alertes hiérarchisé et lié aux lignes ; aucune alerte d'envoi avant la préparation de l'envoi.

### C. Pourquoi ce prix, propositions et contrôles †

#### D3-19 — L'explication du prix n'est accessible que sur une minorité de lignes et ne décompose pas le prix †

**Statut : Confirmé.**

**Preuves.**
- Bouton « Expliquer ce prix » uniquement dans `TakeoffSourceBadge` (`src/components/takeoff/TakeoffSourceBadge.tsx:618-629,918-927`).
- Ce badge n'apparaît que pour les sources `takeoff`, `generated_ouvrage` et `assembly_library` (`src/lib/takeoff/source-badge.ts:1-8`), à deux clics dans le menu « … » (`LineRow.tsx:588-596,796-818`).
- Les lignes manuelles et DPGF n'ont aucun accès, alors que l'API accepte toute ligne (`src/app/api/estimates/[versionId]/lines/[lineId]/explanation/route.ts`).
- Contenu : PU, montants, « Marge configurée » et origine. Ni FO, ni MO, ni K, ni coefficient global, ni remise, ni arrondi (`src/lib/estimates/explanations.ts:1326-1476`).
- « Marge configurée » lit `margin_bp`, qui vaut 0 par défaut en v2, au lieu du coefficient appliqué (`explanations.ts:1337-1341` ; `canonical-v2-creation.ts:162,165`).
- Le résumé est rédigé par un LLM sans contrôle de contradiction (`explanations.ts:1017-1080`).
- La « confiance » est un compteur : 0,35 + 0,12 par fait, ce qui donne « élevée » sans aucune preuve externe (`:368-385`).

**Impact.** Sur un devis ordinaire, le chiffreur n'a aucune explication. Ailleurs, l'explication peut afficher « marge 0 % » avec une confiance élevée alors que le moteur applique ×1,6. Cela contredit le principe « l'IA propose, le moteur calcule ».

**Recommandation.** Une explication déterministe sur chaque ligne, tirée du moteur (DS, coefficient effectif, part du coefficient global et de la remise, arrondi), accessible par action de ligne et par raccourci. Une confiance fondée sur les preuves.

#### D3-20 — Les infobulles contredisent la formule ; « Marge € » est annoncée brute mais affichée nette †

**Statut.** Confirmé ; nette en v2 : Probable.

**Preuves.**
- « Prix total HT = PU × Qté » (`ColumnHeaderHelp.tsx:15`). Or le code calcule `PU = bankersRound(vente/qté)` (`estimate-calculations.ts:243-251`) : 10,00 € pour 3 unités donne 3,33 € × 3 = 9,99 €.
- L'infobulle du PU omet la majoration, le coefficient global et la remise (`useEstimateEditorCalculation.ts:256-265`).
- Les arrondis ne sont jamais expliqués dans l'interface.
- « Marge € » est présentée comme brute (`ColumnHeaderHelp.tsx:26-27`) mais vaut `line_total_ht_cents − DS`, avec un total net en v2 (`src/lib/estimates/line-margin.ts:86-87`).

**Impact.** Le chiffreur ne peut pas reconstituer le prix affiché.

**Recommandation.** Corriger les infobulles et afficher l'écart d'arrondi par ligne.

#### D3-21 — « Marge » désigne deux grandeurs selon l'écran †

**Statut : Confirmé.**

**Preuves.**
- Paramétrage : « 1.20 = marge de 20 % » (`EstimateSettingsPanel.tsx:312,331-332`) ; assistant de création : « Marge 15 % » = 1,15 (`PricingStep.tsx:125-137`).
- Règles, Direction et approbations affichent `1 − 1/coef`, qui est un taux de marque (`src/lib/estimates/effective-margin.ts:32-34` ; `admin/rules/page.tsx:41` ; `RiskPortfolioDashboard.tsx:132` ; `ApprovalQueueCard.tsx:138`). Le même coefficient 1,20 apparaît donc comme 20 % à un endroit et 16,7 % à l'autre.
- L'exemple ×1,20 est codé en dur alors que le barème par défaut est ×1,6 (`MarginTiersExplanation.tsx:24` ; `margin-tiers.ts:10`).
- La colonne « Marque % » est correcte (`ColumnHeaderHelp.tsx:28-29`).

**Impact.** Le chiffreur et la direction ne parlent pas du même chiffre lors de l'approbation.

**Recommandation.** Imposer « taux de marge » ou « taux de marque » partout, avec la formule.

#### D3-22 — La « vérité de ligne » parle de la quantité, pas du prix ; une information non établie paraît « saisie » †

**Statut.** Confirmé ; effet visuel à vérifier.

**Preuves.**
- Les axes sont : source, statut de quantité, confiance (`src/lib/estimates/line-truth.ts:21-38,189-205`).
- Une ligne prise au catalogue reste « Saisie manuelle » (`useCatalogueSuggestions.ts:172-178`), et `null` est forcé à `manual` (`line-truth.ts:386`).
- Les confiances sont des constantes (`:358-369`).
- Les badges sont ambre ou rouges presque partout, avec un détail limité à un `title` non focalisable (`EstimateLineTruthBadges.tsx:28-48,96-113`).
- « Offre retenue » reste affiché même après modification manuelle du PR FO (`LineRow.tsx:346-355`).
- Quatre échelles de confiance coexistent (`explanations.ts:383` ; `line-truth.ts:76-84` ; `structure-drafts.ts:620-621` ; `generated-ouvrages.ts:1790-1791`).
- `useEstimateLineTruthVisibility` est du code mort.

**Impact.** Le chiffreur ne distingue pas ce qui est établi de ce qui reste incertain, ce qui va à l'encontre de la vision.

**Recommandation.**
- Ajouter un axe « source du prix » (fournisseur et date, référence, saisie, IA) avec la mention « non établi ».
- Une échelle de confiance unique.
- Ne colorer que ce qui demande une action.

#### D3-23 — Contrôles avant envoi : 20 drapeaux et non 19 ; avertissements non acquittables ; identifiants bruts affichés †

**Statut.** Confirmé ; affirmation « 19 » infirmée.

**Preuves.**
- 9 drapeaux qualité et 11 drapeaux de contrôle d'envoi, soit 12 bloquants et 8 avertissements (`src/lib/estimate-quality.ts:14-24` ; `src/lib/estimates/gating.ts:43-56,129-150`).
- `price_outlier` et `quantity_outlier` ne sont jamais émis côté serveur (`gating.ts:506-509`).
- Le dialogue d'envoi dit que les avertissements « doivent être assumés explicitement » (`EstimateSendGatingDialog.tsx:416`), mais il n'offre ni case à cocher ni acquittement.
- « Lignes impactées » affiche des UUID (`:253-261`), y compris l'identifiant de la version (`gating.ts:514-531`).
- La checklist (`src/lib/estimates/checklist.ts:121-127`) valide « Marge définie » avec un coefficient de 1.
- Documentation à corriger : `docs/metier/cycle-de-vie.md:169` et `docs/domaines/validation-approbations.md:123-155`.

**Impact.** Contrôle bruyant, non actionnable, et en partie trompeur : une vente à prix coûtant est jugée conforme.

**Recommandation.**
- Titres de lignes cliquables.
- Acquittement journalisé par révision.
- Une source de vérité unique pour la préparation de l'envoi.

#### D3-24 — Les propositions ne montrent pas leur impact sur le total ; le diff ignore les paramètres de version †

**Statut : Confirmé.**

**Preuves.**
- Suggestions de ligne : score brut, ni valeur avant, ni impact en euros (`EstimateSuggestionRow.tsx:60-118`).
- Application en masse : valeurs actuelle et proposée, sans impact en euros (`BulkSuggestDialog.tsx:103-158`). L'annulation globale est possible (`EstimateEditorAlerts.tsx:213-233`).
- Ouvrage IA : sources et confiance, mais un « prix cible » non calculé par le moteur (`GeneratedOuvrageSubdetailEditor.tsx:209-213`).
- Structure IA : aucun montant.
- Diff entre versions : les paramètres de version ne sont pas suivis (`src/lib/estimates/diff.ts:100-180`), et une hausse s'affiche en vert (`EstimateDiffView.tsx:305`).
- Le paramétrage n'offre pas de vue avant/après (`EstimateSettingsPanel.tsx`).

**Impact.** « Ce que chaque changement affecte » n'est pas visible avant la décision.

**Recommandation.** Pour chaque proposition et chaque changement de paramètre, afficher l'écart de PU et de total HT calculé par le moteur.

### D. Continuité des parcours †

#### D3-25 — Visibilité limitée au propriétaire : collaboration et validation rompues

**Statut.** Confirmé à l'exécution ; cause dans le code non auditée ici.

**Preuves.** Observation de l'auditeur principal : le chiffreur voit 0 affaire ; la direction reçoit une 404 sur le devis.

**Impact.** Le parcours « devis → validation direction » est interrompu, la reprise du travail d'un collègue est impossible, et la 404 masque un refus d'accès.

**Recommandation.**
- Règle de visibilité par équipe ou entreprise, validée par le métier.
- Message « accès refusé » explicite.
- Test multi-rôles.

#### D3-26 — De l'affaire au devis : éditeur vide, V1 orpheline, DPGF déposé deux fois, trois entrées d'import †

**Statut : Confirmé.**

**Preuves.**
- La création d'affaire crée une V1 vide et redirige vers l'éditeur (`src/app/dashboard/affaires/_actions/quick-create-affaire.ts:103,181-196`).
- La bannière d'onboarding n'est jamais déclenchée en production : `?created=1` n'est jamais produit (`AffaireHub.tsx:527-549`).
- L'import DPGF crée une nouvelle version « Import DPGF » (`affaires/_actions/import-flow.ts:343-367,420`). Point positif : client et réglages sont repris sans ressaisie (`canonical-v2-creation.ts:464-499`).
- Le DPGF déjà présent dans les pièces n'est pas proposé à l'import (`unified-import-flow/UploadStep.tsx:68-83,134-152`).
- Le parcours `/dashboard/imports` → mappings → catalogue se termine sans devis (`DpgfStepper.tsx:9-13` ; `ImportSuccessCta.tsx:36-41`).
- Le dialogue de création rapide est du code mort.
- Il n'existe aucun import depuis l'éditeur : le menu « Insérer » propose modèle, ouvrage, autre devis et assistants IA (`EstimateEditorCommandBar.tsx:316-404`).

**Impact.** La « première promesse » de la vision commence par une ressaisie et un résultat ambigu (deux versions).

**Recommandation.**
- Après création, arriver sur le hub.
- Importer dans la V1 si elle est vide.
- Proposer en un clic le DPGF déjà présent dans les pièces.
- Supprimer l'impasse.

#### D3-27 — Métré désactivé par défaut ; revue CCTP isolée et sans effet sur l'envoi †

**Statut : Confirmé.**

**Preuves.**
- `TAKEOFF_MODULE_ENABLED` est semé à `false` (`supabase/migrations/20260224153000_tkf005_takeoff_feature_flag.sql:3-16`). Effets : pas d'entrée de menu, 404 sur les pages métré et plans, section Plans masquée (`build-nav-groups.tsx:135-140` ; `affaires/[projectId]/plans/page.tsx:26-29`).
- Le hook client ignore les variables d'environnement serveur (`src/hooks/useTakeoffEnabled.ts:23-32`).
- Aucun métré manuel sur plan (Probable).
- Les pages « Référence CCTP » et « Exigences » ne sont accessibles que depuis la page devis en lecture seule (`estimates/[versionId]/page.tsx:369-373`), pas depuis l'éditeur.
- La couverture CCTP n'entre pas dans le contrôle avant envoi (`gating.ts` : aucune occurrence de `coverage`).

**Impact.** La comparaison DPGF / plans / CCTP, cœur de la première promesse, est inaccessible par défaut ou sans conséquence.

**Recommandation.**
- Décider du périmètre initial (activer ou retirer).
- Ouvrir la revue CCTP depuis l'éditeur et l'intégrer au contrôle d'envoi.

#### D3-28 — Validation : seuil semé, invalidation silencieuse, aucune notification au chiffreur †

**Statut.** Confirmé ; auto-approbation : Probable.

**Preuves.**
- Une règle « > 5 000 € HT » est semée pour chaque tenant (`supabase/migrations/20260812223050_...:256-320`). La documentation dit « aucun seuil codé en dur ».
- Approbateurs : admin et director (`src/lib/estimates/rules-engine.ts:3766-3771`).
- Une modification après approbation invalide l'approbation (`rules-engine.ts:1465-1469,1502-1517`) sans prévenir.
- Seul le relecteur reçoit un email (`:4364-4372`) ; aucun gabarit ne prévient le chiffreur de la décision.
- Rien ne compare `requested_by` à l'approbateur (Probable).
- Un administrateur peut forcer le passage en « Envoyé » (`src/lib/estimates/server.ts:5540-5622`).

**Impact.** Le chiffreur ne sait ni quand il est approuvé, ni qu'une retouche a annulé l'approbation.

**Recommandation.**
- Notifier les décisions.
- Avertir avant toute modification d'un devis approuvé.
- Interdire l'auto-approbation, sauf règle explicite.

#### D3-29 — Envoi : « Envoyer » n'envoie rien ; le refus devient « archivé » ; l'ancienne offre reste acceptable †

**Statut.** Confirmé ; ancienne offre : Probable.

**Preuves.**
- « Envoyer » dans l'éditeur scelle le devis et génère le PDF, sans email ni lien portail (`EstimateEditorToolbar.tsx:685-695` ; `src/lib/estimates/server.ts:5536-5606`).
- Le lien portail n'est créé que par l'envoi email (`supabase/migrations/20261013130248_estimate_offer_client_contract.sql:620-628`).
- L'adresse email du client n'est pas stockée : elle est ressaisie à chaque envoi (`src/types/database.ts:1046-1060`).
- Le PDF correspond bien à la version scellée (`src/lib/estimates/pdf-mutation-policy.ts:16-32` ; `send-estimate.ts:178-195`).
- Un refus au portail donne le statut `archived` (`20261013130248:877-883`) ; son motif n'apparaît que dans le tiroir Activité, et aucune notification interne n'est émise.
- La révision par duplication n'expire pas les liens de l'offre précédente (`:883`).

**Impact.** Ambiguïté sur ce qui a réellement été transmis. Refus indiscernables d'un archivage. Risque d'acceptation d'une offre périmée.

**Recommandation.**
- Renommer « Envoyer » en « Finaliser », ou le brancher sur l'email.
- Créer un statut « refusé ».
- Expirer l'offre précédente lors d'une révision.
- Notifier le chiffreur.

#### D3-30 — Bons de commande : aucune exigence d'acceptation, pas de lien retour vers le devis †

**Statut : Confirmé.**

**Preuves.**
- Préparation depuis le hub, avec regroupement par fournisseur sans ressaisie (`AffaireFinishLineActions.tsx:410-415` ; `src/lib/estimates/purchase-order-drafts.ts:408-440`).
- Aucun contrôle du statut du devis (`supabase/migrations/20261011083209_transactional_estimate_purchase_preparation.sql:71-90`).
- `source_estimate_version_id` n'est jamais affiché dans les commandes (`orders/[id]/page.tsx`).
- Le site de livraison n'est pas lié à l'affaire (`AffaireOrderDraftsPanel.tsx:229-238`).

**Impact.** On peut commander sur un brouillon ou un devis refusé. Depuis un bon de commande, il est impossible de remonter au devis.

**Recommandation.** Exiger un devis accepté (ou une dérogation tracée) et afficher le lien vers le devis et l'affaire.

#### D3-31 — Chantier et retour d'expérience : absents †

**Statut : Confirmé.**

**Preuves.**
- « Chantiers » ne désigne que des sites de livraison (`src/app/dashboard/sites/page.tsx:251-257`).
- Aucune donnée réelle : grep `actual_hours|actual_cost|received_quantity|REX` = 0 occurrence.
- Le refus valant « archivé », le taux de perte n'est pas mesurable.

**Impact.** La fin du parcours visé par la vision n'existe pas.

**Recommandation.** Décider de la frontière avec l'outil de chantier existant avant tout développement.

### E. Volume, vocabulaire et accessibilité †

#### D3-32 — Doublons et pages héritées ; pas d'entrée « Chiffrages » dans la navigation †

**Statut : Confirmé.**

**Preuves.**
- 61 `page.tsx`, dont 56 dans le dashboard.
- « Produits » et « Catalogue » portent sur la même table (`src/app/dashboard/referentiel/page.tsx:19-30` ; `src/lib/catalogue/server.ts:578`).
- Ancien parcours métré encore servi, avec bannière « Ancien parcours » (`TakeoffDeprecationBanner.tsx:36`).
- Deux écrans de gestion des membres : `tenants` et `memberships`.
- La liste `/dashboard/estimates` n'apparaît pas dans la navigation (`build-nav-groups.tsx:124-174`).
- Deux créations coexistent : « Nouveau chiffrage » et « Nouvelle affaire ».
- La palette n'est pas filtrée par rôle (`useCommandPalette.ts:70-85`).
- L'éditeur expose environ 27 dialogues.

**Impact.** Une quinzaine de pages redondantes, et le chiffreur ne sait pas quel écran fait foi.

**Recommandation.** Redirections réelles, fusion des écrans, point d'entrée de création unique.

#### D3-33 — Vocabulaire et statuts incohérents †

**Statut.** Confirmé ; affichage de « sending » : À vérifier.

**Preuves.**
- 16 tables locales de libellés de statut. Le genre varie : « Envoyée » dans l'éditeur (`EstimateEditorToolbar.tsx:33-37`), « Envoyé » sur la page détail (`estimates/[versionId]/page.tsx:81-83`).
- `sending` n'a pas de libellé : la valeur brute s'affiche à 7 endroits, et « Inconnu » dans `EstimateTimeline.tsx:40`.
- Le refus porte trois noms : « Refusé », « Rejeté », « Archivé ».
- « Affaire », « projet » et « dossier » sont mêlés (`estimates/page.tsx:62` ; `dashboard-shortcuts.ts:18`).
- La navigation dit « Tarifs », la page dit « Prix fournisseurs ».
- Anglicismes et jargon : « Mapping », « Preview », « Intake », « Snapshot ». Des saisies JSON sont exposées (`BulkJsonPanel.tsx:105`).

**Impact.** Charge cognitive et risque de malentendu entre les rôles.

**Recommandation.** Un module unique de libellés, un glossaire d'interface et une vérification automatique des libellés.

#### D3-34 — Accessibilité : grille partiellement balisée, focus non piégé dans deux panneaux, éditeur exclu des tests axe †

**Statut.** Confirmé (code) ; comportement réel à vérifier.

**Preuves.**
- Présents : `role="grid"`, `aria-rowcount`, cellules libellées (`EstimateEditorBody.tsx:73-76` ; `LineRow.tsx:889,986`).
- Absents : `aria-rowindex` et `columnheader`. L'en-tête est situé hors de la grille (`EstimateEditorTableChrome.tsx:358-375`), si bien que la position est perdue avec la virtualisation.
- Le tiroir « Paramétrage » est déclaré `role="dialog" aria-modal`, mais le focus n'y est pas géré (`EstimateEditorDrawer.tsx:207-225`).
- Même constat pour les dialogues de section (`EstimateEditorTableSectionDialogs.tsx:238,322`).
- Les tests axe excluent l'éditeur et le portail (`dashboard-ux.spec.ts:4-15` ; `e2e/polish/routes.ts:24,75`).
- Points positifs : statut d'enregistrement annoncé (`aria-live`) ; aucun bouton icône sans nom trouvé (`ui/icon-button.tsx:10,19`).

**Impact.** Lecteur d'écran et usage au clavier dégradés dans l'écran principal.

**Recommandation.** Ajouter `aria-rowindex` et des en-têtes de colonne ; piéger le focus dans le tiroir et les dialogues ; inclure l'éditeur dans axe.

## 3. Affirmations de l'équipe confrontées au code

| Affirmation (source) | Statut | Preuve |
|---|---|---|
| Autosave à 2 000 ms (`docs/domaines/chiffrage-editeur.md:110`) | **Infirmé** : 60 000 ms | `useEstimateEditorSyncController.types.ts:22-23` |
| Bail de 2 minutes (`chiffrage-editeur.md:114`) | **Confirmé** | `src/lib/estimates/locks.ts:46` |
| Battement de 30 s (`chiffrage-editeur.md:115`) | **Infirmé** : 15 s | `src/hooks/useDraftLock.ts:21` |
| 6 opérations annulables ; éditions de cellule jamais empilées ; historique vidé après ~2 s (`chiffrage-editeur.md:126`) | **Infirmé** : 13 types d'opérations, `patch-item` empilé, vidage environ toutes les 60 s | D3-02 |
| Virtualisation auto à 120 lignes ; drapeaux `ESTIMATE_EDITOR_VIRTUALIZATION_*` (`chiffrage-editeur.md:128,130`) | **Infirmé** : 50 lignes ; drapeaux `EST_264_*` | `estimate-editor-virtualization.ts:3,5-8` |
| Navigation qui boucle, sans Début/Fin ; l'aide omet F2 (§2.2) | **Confirmé**, et l'aide décrit mal Entrée | D3-01 |
| Première ligne collée = en-tête ; multi-ligne non supporté (§2.3) | **Confirmé** | `clipboard.ts:468,495` |
| « Majoration MO non utilisée » (aide de colonne) | **Infirmé** | `estimate-calculations.ts:233-236` |
| Défaut `handleAssociateArticle` (désignation écrite dans `description`) | **Infirmé comme défaut actif** : corrigé | `EstimateEditorTable.tsx:1561,1574` |
| « 19 drapeaux, 11 bloquants » (`docs/metier/cycle-de-vie.md:169` ; `docs/domaines/validation-approbations.md:123-149`) † | **Infirmé** : 20 drapeaux, dont 12 bloquants | `gating.ts:129-150` |
| « Aucun seuil codé en dur » (`cycle-de-vie.md` §6) † | **À nuancer** : règle de 5 000 € HT semée | D3-28 |
| Passage brouillon → envoyé « historique » (`cycle-de-vie.md` §1) † | **Infirmé** : c'est le bouton principal | D3-29 |
| « Aucun code n'insère `portal_tokens` » (`sorties-documents.md:307`) † | **Infirmé** | `20261013130248:628` |
| Bons de commande avec rollback compensatoire (`sorties-documents.md:369`) † | **Infirmé** : une seule transaction | `purchase-order-drafts.ts:540-548` |
| Métré désactivé par défaut (`metre-takeoff.md:11-19`) † | **Confirmé** | D3-27 |
| Objectif « 1 000 lignes, p95 ≤ 200 ms » (`backlog-chiffrage-2026-10-11.md:123-127`) † | **Cible, non outillée** | D3-11 |

## 4. Écart à la vision

| Besoin exprimé par la vision | État | Preuve |
|---|---|---|
| Grille performante (1 000 lignes) | **Partiel**, non démontré | D3-11 |
| Saisie au clavier | **Partiel** | D3-01 |
| Copier-coller depuis Excel | **Partiel** | D3-03, D3-04 (OPTIMA confirmé à l'exécution) |
| Saisie numérique française fiable | **Partiel** | D3-05 |
| Modifications groupées | **Partiel** (5 actions) | D3-07 |
| Annuler / rétablir fiable | **Partiel** | D3-02 |
| Sous-détails | **Partiel** : une FO et une MO par ligne | D3-08 |
| Ouvrages composés | **Partiel** : section sans quantité | D3-08 |
| Variantes | **Partiel** : version entière seulement | D3-08 |
| Filtres | **Partiel** : texte et qualité seulement | `EstimateEditorTable.tsx:664,939-978` |
| Bibliothèques | **Présent**, mais masqué en mode simplifié et dédoublé (produits / catalogue) | D3-10, D3-32 |
| Imports et exports propres | **Partiel** : exports Excel, DPGF, BDC et CSV présents (`useEstimateEditorExportController.ts:173-239`) ; imports multiples, impasse, OPTIMA mal reconnu | D3-26 |
| IA jamais nécessaire pour une opération simple | **Présent**, sauf le métré sur plan, sans équivalent manuel | D3-27 ; `EstimateEditorCommandBar.tsx:362-404` |
| Propositions révisables (ce qui change, pourquoi, source, impact, incertitude) | **Partiel** : sources et confiance parfois ; jamais d'impact en € ; aperçu de collage brut ; association sans aperçu | D3-04, D3-09, D3-24 |
| Comprendre pourquoi ce prix | **Partiel / faible** | D3-10, D3-19, D3-20, D3-21 |
| Voir ce que chaque changement affecte | **Absent** avant la décision ; diff partiel entre versions | D3-24 |
| Voir ce qui reste incertain | **Faible** : vérité de ligne centrée sur la quantité, information non établie présentée comme saisie | D3-22 |
| Offre émise figée | **Présent** : sceau, PDF fidèle, lecture seule | D3-29 ; `useEstimateEditorSyncController.ts:662-664` |
| Ne jamais réécrire l'historique | **Partiel** : écrasements silencieux possibles ; ancienne offre encore acceptable | D3-13, D3-14, D3-29 |
| Réduire le contrôle | **Contraire** : bandeaux, avertissements non acquittables, alerte sur devis vide | D3-18, D3-23 |
| Affaire → pièces → import → devis | **Partiel** : éditeur vide, V1 orpheline, double dépôt | D3-26 |
| Métré IA | **Désactivé** par défaut | D3-27 |
| Validation | **Partiel** : invalidation silencieuse, aucune notification, visibilité bloquante | D3-25, D3-28 |
| PDF, envoi, portail, acceptation | **Partiel** : « Envoyer » sans email ; refus = archivé | D3-29 |
| Bons de commande | **Partiel** : ni acceptation exigée, ni lien retour | D3-30 |
| Chantier et retour d'expérience | **Absent** | D3-31 |
| Première promesse : importer un dossier et un chiffrage existant, vérifier, corriger avec les sources | **Partiel / fragile** | D3-04, D3-26, D3-27 |

## 5. Vérifications à rejouer dans le navigateur

Ces quatre points ont déjà été confirmés à l'exécution. Ils sont à rejouer seulement après correction :
- visibilité limitée au propriétaire ;
- « Verrouillé par vous » pendant 120 s avec perte de saisie ;
- alerte bloquante sur devis vide ;
- OPTIMA mal reconnu.

### Grille et saisie

| N° | Étapes | Résultat attendu |
|---|---|---|
| V01 | Quantité 2 → 5, Tab, puis Ctrl+Z hors édition ; recommencer avec le bouton « Annuler » | Retour à 2. Si la valeur reste à 5 : D3-02 confirmé. |
| V02 | Changer une catégorie en masse, attendre le statut « Sauvegardé » (≈ 70 s), puis Ctrl+Z | Annulation possible. Bouton grisé : D3-02 confirmé. |
| V03 | Sur une cellule active non éditée, appuyer sur Entrée ; comparer avec l'aide « ? » | L'édition s'ouvre. Si le curseur descend : D3-01 confirmé. |
| V04 | Dernière ligne, flèche bas ; dernière cellule, Tab | Arrêt. Retour à la ligne 1 : D3-01 confirmé. |
| V05 | Coller 3 lignes Excel sans en-tête, cellule hors édition | 3 lignes. Si seulement 2 : D3-03 confirmé. |
| V06 | Coller une désignation contenant Alt+Entrée | 1 ligne. Si 2 : D3-03 confirmé. |
| V07 | Coller l'en-tête « Désignation / Qté / PR FO » avec la valeur « 1,875 » | Valeur interprétée affichée, ou alerte. 1 875 € insérés après un aperçu « 1,875 » : D3-04 confirmé. |
| V08 | Coller une ligne sans quantité, puis une colonne « PU HT » | Quantité vide signalée ; « PU HT » demandé comme prix de vente. Sinon : D3-04 confirmé. |
| V09 | Saisir « 0,125 » en PR FO et « abc » en Qté | Message d'erreur. Retour silencieux ou 0 : D3-05 confirmé. |
| V10 | En MO éclatée, saisir « 1,5 » au pavé numérique (Chrome, Firefox) | Valeur acceptée. |
| V11 | Majoration MO en masse = 10 sur 3 lignes, en colonnes « Essentiel » puis « Personnalisé » | MO +10 %. MO ÷10 : D3-06 confirmé. |
| V12 | Ligne en ml, associer un article vendu à la barre | Aperçu et alerte d'unité. |
| V13 | Compte ingénieur neuf : menu, mode d'interface, colonnes par défaut | DS et marge visibles. Sinon : D3-10 confirmé. |
| V14 | Devis éditable de 1 000 puis 3 000 lignes : INP d'une saisie à la ligne 900, hauteur de grille sur un écran de 1 440 px | ≤ 200 ms au p95 ; pleine hauteur. |
| V15 | Ctrl+Maj+A dans la grille, Chrome sous Windows | Sélecteur d'ouvrages, et non recherche d'onglets. |

### Sauvegarde et collaboration

| N° | Étapes | Résultat attendu |
|---|---|---|
| V16 | Navigateur A : modifier hors ligne puis fermer. Navigateur B (autre utilisateur) : modifier la même ligne. Rouvrir A, réseau rétabli, et attendre 70 s | Comparaison proposée. Écrasement silencieux : D3-13 confirmé. |
| V17 | Conflit 409 (verrou forcé par un administrateur) → Recharger → Restaurer ; puis fermer l'onglet avant de restaurer | Fusion ligne à ligne ; brouillon conservé. |
| V18 | Taper « 7 » sans quitter la cellule, puis F5 | Avertissement ou valeur conservée. |
| V19 | CORE-06 : quitter rapidement l'éditeur vers l'affaire, puis revenir | Grille éditable en moins de 10 s. |
| V20 | Compter les bandeaux en cumulant conflit, totaux non synchronisés et anomalies | Un centre d'alertes unique, qui désigne les lignes. |

### Prix, contrôles et propositions

| N° | Étapes | Résultat attendu |
|---|---|---|
| V21 | Ligne manuelle, ligne DPGF, ligne d'ouvrage : chercher « Expliquer ce prix » | Explication disponible partout, décomposée (DS, K, marge, remise, arrondi). |
| V22 | Version v2 avec coefficient 1,6 : ouvrir l'explication | Pas de « Marge configurée 0 % » ; confiance fondée sur des preuves. |
| V23 | Quantité 3, total visé 10,00 € | Écart d'arrondi expliqué ; infobulle « PU × Qté » corrigée. |
| V24 | Coefficient 1,20 : comparer paramétrage, file d'approbation et Direction | Même grandeur affichée partout. |
| V25 | Insérer un article catalogue avec offre, puis modifier le PR FO | Source du prix affichée ; « Offre retenue » retiré après modification. |
| V26 | Dialogue d'envoi : PDF absent, prix manquant, MO sans rôle | Titres de lignes au lieu d'UUID ; avertissements acquittables. |
| V27 | Appliquer une suggestion, puis une majoration en masse, puis changer le coefficient | Impact en € affiché avant validation. |
| V28 | Dupliquer une version, changer seulement la remise, comparer | Le diff nomme le paramètre et l'écart ; une hausse n'apparaît pas en vert. |

### Parcours

| N° | Étapes | Résultat attendu |
|---|---|---|
| V29 | Créer une affaire | Arrivée sur le hub, onboarding affiché, pas de V1 vide orpheline. |
| V30 | Déposer un DPGF dans les pièces, puis « Importer DPGF » | Le DPGF présent est proposé ; pas de V2 inutile. |
| V31 | Métré désactivé, puis activé via `/dashboard/admin/flags` | Comportement assumé (entrée de menu, pas de 404 depuis les approbations ou la Direction). |
| V32 | Devis > 5 000 € HT : soumettre, faire approuver par un director, modifier une quantité | Le chiffreur est notifié de la décision et averti avant de modifier. |
| V33 | Un administrateur soumet puis approuve son propre devis | Refusé, sauf règle explicite. |
| V34 | « Envoyer » dans l'éditeur, puis envoi par email | Libellés clairs ; email du client prérempli ; lien portail créé. |
| V35 | Portail : refuser avec un motif ; accepter une autre offre | Statut « Refusé » visible avec son motif ; chiffreur notifié. |
| V36 | Dupliquer un devis envoyé, puis ouvrir l'ancien lien portail | Ancienne offre expirée. |
| V37 | Préparer des bons de commande sur un brouillon ; ouvrir un bon | Refus ou dérogation tracée ; lien vers le devis et l'affaire. |
| V38 | Chercher un suivi de chantier ou un retour d'expérience | Absence assumée dans la navigation. |
| V39 | Rôles chiffreur, director, viewer sur la même affaire, après correction de la visibilité ; palette Ctrl+K en viewer | Accès conformes ; « accès refusé » explicite ; actions de palette filtrées. |
| V40 | Lecteur d'écran (NVDA) sur un devis virtualisé ; Tab ×20 dans « Paramétrage » ; axe sur l'éditeur et le portail | Ligne et colonne annoncées ; focus piégé puis restitué ; aucune violation majeure. |

## 6. Points satisfaisants

- Autosave robuste dans son principe : statut accessible, Ctrl+S, envoi à la sortie, garde de navigation (D3-12).
- Verrou par onglet, avec un message distinct « vous dans un autre onglet ».
- Confirmation avant suppression, avec décompte (`EstimateEditorTable.tsx:1457-1465`).
- Sélection de plage et copie TSV réutilisable au recollage (`useEstimateClipboard.ts:264-317`).
- Aide qui distingue marge et marque dans la grille (`ColumnHeaderHelp.tsx:24-29`).
- Assistants IA facultatifs, sans interface conversationnelle.
- Import DPGF sans ressaisie du client ni des réglages.
- Bons de commande regroupés par fournisseur, en une seule transaction.
- PDF fidèle à la version scellée ; version non brouillon en lecture seule.
- Défaut d'association d'article corrigé.

## 7. Priorités proposées pour l'axe D3

1. **Avant toute recette métier.**
   - D3-06 : majoration.
   - D3-04 et D3-05 : collage et saisie numérique.
   - D3-25 : visibilité.
   - D3-15 : blocage « par vous » avec perte de saisie.
   - D3-21 : sens de « marge ».
   - D3-29 : « Envoyer » qui n'envoie pas ; refus = archivé.
2. **Confiance dans l'outil.**
   - D3-02 : annulation.
   - D3-13 et D3-14 : écrasements silencieux.
   - D3-19, D3-20, D3-22 : explication du prix et source du prix.
   - D3-23 et D3-18 : contrôles et bruit.
3. **Continuité.**
   - D3-26 : affaire → import → devis.
   - D3-28 : notifications de validation.
   - D3-30 : bons de commande.
   - D3-27 : décision métré / CCTP.
4. **Productivité et qualité.** D3-01, D3-03, D3-07, D3-10, D3-11, D3-17, D3-32, D3-33, D3-34.
5. **Décisions de modèle avec un chiffreur et le porteur.**
   - D3-08 : ligne d'ouvrage avec sous-détail et quantité.
   - D3-31 : frontière chantier / retour d'expérience.
   - Périmètre initial : métré, CCTP.
