# Axe D1 — Règles de gestion et fiabilité des calculs

Audit indépendant de MergeOne / Miaouffrage (chiffrage BTP, CVC et plomberie). Rapport rédigé le 14/10/2026.

## 0. Cadre, méthode et limites

**Référence auditée.** La copie figée du 14/10/2026 13:19, notée **R** :
`…/scratchpad/audit/snapshot/handoff-audit-independant/annexes/repository`. Tous les chemins sont relatifs à R, avec leur numéro de ligne.

**Méthode.**
- Lecture du code TypeScript (moteur, éditeur, serveur) et des migrations SQL.
- Lecture des documents de l'équipe, traités comme des **affirmations à vérifier**.
- Lecture des tests existants et des rapports d'échec EU01, EU02 et EUHIST joints au dossier.
- Recalcul arithmétique à la main (et par `node -e` sur des formules recopiées). Aucun import du code applicatif n'a été fait.
- Aucune exécution de l'application, des tests ou d'une base.
- Trois recherches ciblées ont été confiées à des assistants, puis recoupées par sondage : offres fournisseurs, unités et saisie, SQL et règles.

**Ce que le dépôt vivant apporte.** Il n'est utilisé qu'au §6, pour décrire les écarts, étiquetés « en cours, non audité ».

**Statuts utilisés.**

| Statut | Signification |
|---|---|
| **Confirmé** | Lu sans ambiguïté dans la copie ; la raison est donnée. |
| **Infirmé** | La copie contredit l'hypothèse ou l'affirmation. |
| **Probable** | Lecture plausible, mais qui dépend de l'exécution ou des données. |
| **À vérifier** | Indice sérieux sans démonstration suffisante. |
| **Non audité** | Hors portée de cette lecture. |

Chaque constat sépare trois choses : **Fait** (ce que dit le code), **Interprétation** (ce que l'auditeur en déduit) et **Proposition** (ce qu'il recommande).

**Limites.**
- Le dossier `supabase/tests/` est absent de la copie, alors que `docs/metier/regles-de-calcul.md:395` cite `supabase/tests/database/estimate-calc-engine-governance.test.sql`. Les contrats SQL testés n'ont donc pas pu être lus.
- L'oracle financier des recettes EU01, EU02 et EUHIST (`financial-oracle.v3.json`) n'est pas joint. Les paramètres d'entrée d'EUHIST sont donc **reconstitués** (D1-02).
- Aucun responsable métier ni expert-comptable n'est nommé comme validateur d'une règle, dans les documents comme dans le code. La colonne « validateur » du référentiel en tient compte.

---

## 1. Synthèse

### 1.1 Hypothèses du cadrage confrontées au code

| Hypothèse | Résultat | Statut |
|---|---|---|
| **P1 — EU01** : la remise en € est convertie en points de base entiers à la sauvegarde | Chemin exact localisé : `useEstimateEditorState.impl.tsx:1441-1447`, puis recalcul serveur depuis `discount_bp` (`version-totals.ts:363-379`), puis `computeInitialDiscountCents` (`estimate-calculations.ts:1525-1527`). 101 c devient 1 pb, puis 200 c ; 19 952,50 € au lieu de 19 953,49 €. | **Confirmé** |
| **EUHIST** : la remise historique change quand on modifie la marge | Mécanisme exact : au chargement, le pourcentage historique est figé en euros (`:733-749`). La marge change la base, mais pas ces euros. À la sauvegarde, un nouveau pourcentage est recalculé (`:1441-1447`). Les chiffres observés [380, 76, 456] sont reproduits exactement sur une base reconstituée (200 c, 10 %, marge ×2). | **Confirmé** (mécanisme) / **Probable** (paramètres de la recette) |
| **P3 — Unités** | `estimate_items` n'a pas de colonne `unit` : l'unité vit dans `description`. Aucune conversion. Aucun conditionnement. Plusieurs normaliseurs divergent : « ML » devient « millilitre » côté achats, « m² » devient « m » dans la comparaison DPGF/métré. | **Confirmé** (détail au constat D1-08) |
| **P4 — Paliers de marge** | Un multiplicateur unique est choisi sur le coût total, en marche d'escalier. Un coût de 99 999,99 € se vend 159 999,98 € ; un coût de 100 000 € se vend 145 000 €. Le barème est paramétrable par entreprise (table, interface administrateur). S'il n'est pas configuré : drapeau bloquant à l'envoi, et texte « Barème par défaut » dans le panneau. | **Confirmé** |
| **P5 — Deux sens de « marge »** | Le panneau et l'assistant de création raisonnent en `k−1` (taux de marge). Le moteur de règles v2, la Direction et la colonne « Marque % » raisonnent en `1−1/k` (taux de marque). En v1, `margin_bp` vient de l'assistant (`k−1`) et n'est plus mis à jour ensuite. Le radar de métré évalue les règles sans moteur, ce qui le fait retomber sur ce `margin_bp` v1. | **Confirmé** |
| **P6 — Offre à 0 €** | Exclue du prix de référence SQL. Peut devenir « meilleur prix », être présélectionnée et être appliquée à une ligne côté TypeScript et dans le catalogue SQL. | **Confirmé** |
| **P7 — Arrondis** | L'arrondi commercial est stocké dans `total_tax_cents` et, en v2, réparti dans le `line_tax_cents` des lignes. La remise simple issue des points de base est arrondie au demi supérieur en TS (`Math.round`). En SQL (`recalculate_takeoff_estimate_version`), elle l'est au demi pair (`takeoff_round_half_even`). Exemple : 12 345 c à 1 000 pb donnent 1 235 c en TS et 1 234 c en SQL. | **Confirmé** |
| **P8 — Situations, retenue, prorata, acomptes ; indices** | Fonctions absentes. L'indice matière est appliqué comme un pourcentage (`prix × indice / 100`), sans I0 ni partie fixe. | **Confirmé** (détail au constat D1-17) |

### 1.2 Constats majeurs

Ils sont classés par impact métier sur le montant d'une offre.

1. **D1-06 — La main-d'œuvre est sous-évaluée d'un facteur égal à la quantité.** Le moteur traite `h_mo` comme des heures totales de la ligne. L'aide de colonne dit « Heures de main d'œuvre par unité » et annonce « PU = (PR FO × K FO + h MO × K MO × prix horaire) × marge ». Les chemins de remplissage ne suivent pas tous la même convention :
   - les ouvrages multiplient bien les heures unitaires par la quantité à l'insertion ;
   - l'import DPGF recopie la colonne « h MO » sans multiplication ;
   - une modification ultérieure de la quantité ne réajuste pas les heures.

   Exemple : 10 m à 0,5 h/m et 45 €/h. Le chiffreur attend 225 € de MO ; le moteur calcule 22,50 €.
   Statut : **Confirmé** pour la contradiction entre l'interface et le moteur. **Probable** pour l'impact réel, qui dépend de la sémantique des DPGF importés.
2. **D1-01 et D1-02 — Une remise saisie n'est jamais conservée telle quelle.**
   - Saisie en € : elle est convertie en points de base entiers, ce qui fausse le montant (EU01). Une remise sous 0,5 pb disparaît totalement : 0,99 € sur 19 954,50 €, ou 49 € sur 1 M€.
   - Pourcentage historique : il est converti en euros figés, puis reconverti à la sauvegarde, et l'intention est perdue (EUHIST).
   - Le seul test qui couvre cette conversion la **fige** (5 000 c deviennent 442 pb, puis 5 002 c) en recopiant la formule au lieu d'appeler le code de production.
3. **D1-07 — En moteur v2, changer la « TVA unique » ne change la TVA d'aucune ligne existante.**
   - Fait : le taux de ligne est conservé à la sauvegarde (`20261014070453_estimate_settings_atomic.sql:232`). Le document affiche pourtant le taux de la version (`prepare-estimate-document-data.ts:438`). Aucune colonne de TVA n'est éditable par ligne, et aucune ventilation par taux n'apparaît sur le PDF.
   - Exemple : un devis de rénovation passé à 10 % reste calculé à 20 % sur toutes les lignes existantes, mais l'en-tête affiche « TVA 10 % ».
4. **D1-04 — Paliers de marge en marche d'escalier.**
   - Un euro de coût supplémentaire au passage de 100 000 € fait baisser le prix de vente de 14 999,98 €.
   - Il existe une « zone morte » de coût de 100 000 € à 110 344,83 €, où le prix reste inférieur à celui d'un coût de 99 999,99 €.
   - Le barème par défaut (×1,60 / ×1,45 / ×1,40) n'a aucune source métier. Il est codé en dur à deux endroits (TS et SQL).
5. **D1-05 — La règle `min_margin` ne voit ni la remise ni le coefficient global.** Un devis à ×1,25 avec 20 % de remise a une marque réelle nulle, mais passe une règle « marge minimum 15 % ».
6. **D1-09 — L'offre à 0 € peut devenir le prix d'une ligne.** Elle est exclue du prix de référence, mais rien ne l'écarte du « meilleur prix » ni des chemins d'application. Le garde-fou `missing_price`, bloquant à l'envoi, ne joue que si la nature de la ligne exige une fourniture.
7. **D1-03 — Écrêtage silencieux au plafond de stockage.** Une ligne seule qui dépasse 21 474 836,47 € est écrêtée sans signal (`isCapped = false`). Un test golden le fige explicitement.
8. **D1-10 — Le moteur v1 n'est pas seulement historique.** La duplication conserve le moteur source. Or en v1, la somme des sections diffère du pied (coefficient ignoré, prorata de remise biaisé, lignes racine), et la TVA de ligne est écrasée.

---

## 2. Référentiel des règles

Légende de la colonne « Nature proposée » :
- **OL** : obligation légale ou fiscale ;
- **CE** : choix commercial d'entreprise ;
- **PA** : paramètre (réglable) ;
- **CH** : convention historique (héritée du code) ;
- **HNS** : hypothèse non sourcée.

**Validateur.** Aucun document ne nomme de validateur métier. Seuls les éléments signalés comme « décision du porteur » dans `dossier-audit-independant.md` §3 en ont un.

| # | Règle | Implémentation TS | Implémentation SQL | Nature proposée | Source citée dans la documentation | Validateur | Remarque de cohérence |
|---|---|---|---|---|---|---|---|
| R01 | **Coût de ligne (déboursé sec)** = `Math.round(q × PU_FO × k_fo + coûtMO)` | `src/lib/estimate-calculations.ts:242-244` | Pas de recalcul SQL indépendant. Les RPC vérifient les projections calculées en TS (`20261014070453_estimate_settings_atomic.sql:160-190`). Les ouvrages générés recalculent `round(q × coût × (1+perte))` (`20261012215942_generated_ouvrage_component_decisions.sql:162`). | CH, avec la sémantique de `h_mo` en HNS | `docs/metier/regles-de-calcul.md:56-70` (description tirée du code) | aucun | Arrondi demi-supérieur sur un flottant (exemple : q = 1,005 × 100 c donne 100 c en JS et 101 c en `numeric`). Le dépôt vivant le corrige (§6). |
| R02 | **Main-d'œuvre** = `majoration × h_mo × taux_rôle × k_mo` (heures **totales** de la ligne) ; ventilation atelier/chantier si drapeau + charge utile | `estimate-calculations.ts:230-236` | Le gel v2 exige un rôle si `h_mo > 0` (`20260812032857_govern_estimate_calc_engine_v2.sql:3422-3461`) | HNS (heures totales ou unitaires ?) | `regles-de-calcul.md:61-64` | aucun | **Contradiction avec l'interface**, qui dit « par unité » (`src/components/estimates/components/ColumnHeaderHelp.tsx:11`, `:14`, `:18`, `:21`) → D1-06. Même formule en SQL dans le métré (`20260813201300_atomic_takeoff_apply_mapping.sql:739-740`). |
| R03 | **Taux horaire** = `labor_roles.hourly_rate_cents`, rôle propre au **propriétaire du projet** (pas à l'entreprise) | `src/lib/estimates/version-totals.ts:175-213` ; repli à 0 en v1 (`estimate-calculations.ts:1231-1243`) | `20260305150000_create_labor_roles.sql:7-13` (`user_id`, unicité tenant+user+nom, `>= 0`) ; gel v2 `role.user_id = project_owner_id` (`20260812032857…sql:3345-3347`) | PA | `regles-de-calcul.md:359-366` | aucun | Deux chiffreurs d'une même entreprise peuvent appliquer des taux différents pour le « même » rôle. Un taux à 0 €/h est accepté sans alerte : aucun drapeau qualité (`src/lib/estimate-quality.ts:171-188`). |
| R04 | **Coefficients `k_fo` / `k_mo` / majoration** (défaut 1, ≥ 0, sans borne haute) | `estimate-calculations.ts:200-201`, `:221-225` | `numeric(12,3)` ; majoration `numeric(12,4)`, défaut 1 (`028_est_032_h_mo_majoration_and_estimate_item_functions.sql:4`) | PA par ligne | `regles-de-calcul.md:72-78` | aucun | Cinq conventions pour la majoration → D1-15 : saisie en grille en % ; collage « > 10 ⇒ ÷ 100 » ; import brut ; export éditeur en % ; export DPGF en coefficient. L'aide dit « Non utilisée pour le moment », alors qu'elle est appliquée. |
| R05 | **Marge fixe** : `vente = Math.round(coût × k)`, k borné [0 ; 100] | `estimate-calculations.ts:246-248`, `:118-120` | Bornes 0..100 (`20261014070453…sql:84-86`) | CE | `regles-de-calcul.md:92-95` | aucun | k = 0 est accepté : un champ vidé donne `emptyValue={0}` (`EstimateSettingsPanel.tsx:325`) et un devis à 0 € sans alerte. k < 1 (vente à perte) est accepté sans alerte. |
| R06 | **Marge par paliers** : un seul multiplicateur, celui du dernier palier dont le seuil est ≤ au coût total, appliqué à tout le devis | `src/lib/estimates/margin-tiers.ts:42-62` ; résolution `estimate-calculations.ts:381-400` | Table `margin_tiers` par entreprise (`023_margin_tiers.sql`) ; défaut recopié en dur dans le gel (`20260812032857…sql:3370-3376`) | CE (barème), PA ; défaut = HNS | `regles-de-calcul.md:96-110` | aucun | Marche d'escalier non progressive → D1-04. Le premier palier s'applique aussi **sous** son seuil (`margin-tiers.ts:54-58`). |
| R07 | **Barème non configuré** → défaut ×1,60 / 1,45 / 1,40 | `margin-tiers.ts:9-13`, `:46` ; `version-totals.ts:237-240` | `20260812032857…sql:3370-3376` | HNS | `regles-de-calcul.md:100-110` dit « non signalé » | aucun | **Infirmé** sur le « non signalé » : texte du panneau (`EstimateSettingsPanel.tsx:371-373`) et drapeau bloquant `margin_not_configured` (`src/lib/estimates/gating.ts:142`, `:513-515`). |
| R08 | **Coefficient global** : appliqué après la marge et avant la remise, `bankersRound` sur l'agrégat | `estimate-calculations.ts:419-421` ; v2 redescend par `allocateProRata` (`:1297`) | Persisté (`20261014070453…sql:242`) | CH | `regles-de-calcul.md:164-165` | aucun | Visible et non modifiable dans le panneau uniquement en mode cascade (`EstimateSettingsPanel.tsx:425-437`). En mode simple, il s'applique sans être affiché (**Probable**, s'il est hérité ≠ 1, `src/lib/estimates/canonical-v2-creation.ts:510`). Non couvert par `max_discount`. |
| R09 | **Remise simple** : saisie en €, persistée en **points de base entiers**, reconvertie en € au chargement et au recalcul serveur | Saisie `EstimateSettingsPanel.tsx:415-420` ; conversion `src/hooks/useEstimateEditorState.impl.tsx:1441-1447` ; reconversion `estimate-calculations.ts:1525-1527`, `version-totals.ts:363-379` | `discount_bp integer >= 0`, sans borne haute (`030_est_118_bulk_update_version_token_guard.sql:286`) | CE | `regles-de-calcul.md:169` (« un montant en centimes, ou `discount_bp` ») | aucun | **Ni centimes ni pourcentage fidèles** → D1-01 et D1-02. |
| R10 | **Remise cascade** : pas successifs en bp, `bankersRound` à chaque pas | `estimate-calculations.ts:264-309` | `discount_steps integer[]` | CH (lecture seule) | `regles-de-calcul.md:170-171` | aucun | Panneau en lecture seule (« Remises historiques conservées », `EstimateSettingsPanel.tsx:425-437`). Un pas de 10 % ne donne pas le même résultat que la remise simple de 10 % (D1-11). |
| R11 | **Remise fixe** (`discount_amount_cents`) | Absente de la copie | Absente de la copie | — | — | — | Présente dans le dépôt vivant (§6) : **en cours, non audité**. |
| R12 | **Ventilation de la remise** | v1 : prorata `Math.round` par section (`estimate-calculations.ts:671-680`) ; v2 : plus grand reste ligne à ligne (`src/lib/estimate-allocation.ts:5-51`, `estimate-calculations.ts:1297-1299`) | — | CH | `regles-de-calcul.md:233-236`, `:324-327` | aucun | v2 exact au centime ; v1 non (D1-10). |
| R13 | **TVA** : arrondie par ligne en `Math.round` ; v1 au taux de version, v2 au taux de ligne | `src/lib/money.ts:113-115` ; v1 `estimate-calculations.ts:1632-1635` ; v2 `:1318-1325` | Taux de ligne conservé en v2 (`20261014070453…sql:232`) | OL (taux) ; CH (arrondi par ligne) | `regles-de-calcul.md:177-191` | aucun expert-comptable nommé | Libellé « TVA unique » (`EstimateSettingsPanel.tsx:488`) ; aucune édition par ligne ; PDF à taux unique → D1-07. |
| R14 | **Autoliquidation** (sous-traitance, art. 283-2 nonies CGI) : TVA nulle en un point unique, arrondi TTC court-circuité | `estimate-calculations.ts:376-379`, `:478-480`, `:1227`, `:1371` | `contractor_role` (`20260726090000_estimate_contractor_role.sql`) | OL | `regles-de-calcul.md:193-215` | aucun | Cohérent, choix explicite de l'utilisateur. Cas de franchise en base non traité, et assumé. |
| R15 | **Arrondis intermédiaires** : coût et vente de ligne `Math.round` ; PU `bankersRound` ; coefficient `bankersRound` ; cascade `bankersRound` ; simple `Math.round` ; TVA `Math.round` ; prorata v1 `Math.round` ; v2 plus grand reste | Voir R01, R05, R08, R09, R10, R13 | `recalculate_takeoff_estimate_version` (`20260813201300_atomic_takeoff_apply_mapping.sql:606-1076`) : ligne et TVA `floor(x+0.5)` (`:744`, `:823`, `:838`) ; remise simple et cascade au demi pair (`:906-936`, fonction `:442-458`) ; coefficient au demi pair (`:883`) | CH | `regles-de-calcul.md:30-44` | aucun | Hétérogénéité reconnue, et les goldens la figent volontairement (`regles-de-calcul.md:43-44`). **Divergence TS/SQL** sur la remise simple en pb (D1-12). |
| R16 | **Arrondi commercial du TTC** : `none`, `nearest`, `up`, `down` ; plancher TTC ≥ HT ; écart stocké dans `total_tax_cents` | `estimate-calculations.ts:177-184`, `:478-483` ; persistance `useEstimateEditorState.impl.tsx:1479` ; options `src/components/estimates/rounding-options.ts:13-40` | Enum `estimate_rounding_mode` | CE ; la qualification fiscale de l'ajustement est à valider (OL) | `docs/testing/commercial-rounding.md:63-66` (reconnaît que `total_tax_cents` inclut l'ajustement) ; backlog CORE-01 | aucun | Seul l'arrondi « inférieur » est proposé pour un nouveau choix ; `nearest` et `up` sont conservés pour l'historique → contradiction 11 (§3.1). |
| R17 | **Unité de ligne** : portée par `estimate_items.description` | Écrite par l'éditeur (`src/components/estimates/EstimateEditorTable.tsx:1377-1380`) et l'import (`import-flow.ts:483`) ; lue par l'export DPGF (`src/lib/estimates/dpgf-export.ts:344`), le PDF (`src/components/estimate-document/EstimateDocumentTableRows.tsx:156`) et les achats (`src/lib/estimates/purchase-order-drafts.ts:278`) | Pas de colonne `unit` (`001_add_job_title_to_profiles.sql:362-377`) ; le métré écrit l'unité dans `description` (`20260225133000_tkf013_takeoff_apply_rpc.sql:220`, `:245`) | HNS | `docs/metier/ecarts-standards-btp.md:82-110` | aucun | Normaliseurs divergents → D1-08. |
| R18 | **Quantités décimales** | Import arrondi au millième (`import-flow.ts:403`) ; lot serveur au demi supérieur à 3 décimales (`src/lib/estimates/stored-item-numeric.ts:51-71`) ; moteur en flottant | Devis `quantity numeric(12,3)` (`001_add_job_title_to_profiles.sql:373`) ; achats `numeric`, `quantity = trunc(quantity,3)` (`20261011091744_purchase_decimal_quantities_and_stable_edits.sql:7-12`) | PA | `backlog…:161`, `:186` | aucun | Les achats **refusent** plus de 3 décimales (`src/lib/purchase-orders/quantities.ts:5-18`) ; le devis les **arrondit**. Les montants d'achat sont calculés en BigInt (`src/lib/order-calculations.ts:45`), ceux du devis en flottant. |
| R19 | **Validité d'une offre fournisseur : 6 mois calendaires** ; bornes incluses ; fin de mois ramenée au dernier jour | `src/lib/catalogue/price-validity.ts:6-25` | `20260906110121_supplier_price_validity_six_months.sql:18`, `:30`, `:35` | CE (décision du porteur) | `dossier-audit-independant.md` §3 | **porteur** | TS et SQL cohérents. Écart possible d'un jour selon le fuseau, entre date locale (`supplier-offer-eligibility.ts:25-26`) et UTC ou `current_date`. |
| R20 | **Offre à 0 €** : exclue du prix de référence | Non exclue du meilleur prix (`src/lib/estimates/server.ts:1051-1056`) | Exclue de la référence (`20261011030647_reference_price_zero_and_inclusive_validity.sql:65`) ; non exclue de `catalogue_products_page` (`20260906145000_supplier_reference_price_proposals.sql:436`) | CE (décision du porteur) | `dossier-audit-independant.md` §3 | **porteur** | Règle appliquée sur un seul des chemins → D1-09. |
| R21 | **Prix de référence** : moyenne arithmétique arrondie des dernières offres éligibles par fournisseur ; alerte de dispersion > 15 % ; validation humaine par un administrateur | `src/lib/catalogue/reference-price-server.ts` | `20261011030647…sql:55-95`, `:111` ; validation `20260906145000…sql:286-319` | CE | `docs/product/price-reference-next-slice.md` | administrateur (rôle) | Moyenne et non médiane : une offre aberrante tire la référence. Le seuil de 15 % n'a pas de source. |
| R22 | **Prix périmé** : 90 jours depuis `updated_at` (drapeau `STALE_PRICE_DAYS`) | `src/lib/catalogue/stale-prices.ts:1-2`, `:32-40` | `20261011083209_transactional_estimate_purchase_preparation.sql:113-118` | PA | — | aucun | Le contrôle avant envoi regarde l'âge (`gating.ts:460-500`), pas `valid_to`. Une offre expirée encore « récente » passe. |
| R23 | **Seuil d'approbation** : `require_approval` déclenché si `total_ht_cents >= seuil` ; défaut 5 000 € HT par entreprise | `src/lib/estimates/rules-engine.ts:1119-1126`, `:1177-1186` | Initialisation à 500 000 c (`20260812223050_separate_commercial_rounding_and_harden_approval.sql:269-275`, `:303-309`) | CE / PA | `docs/domaines/validation-approbations.md:44` (« valeur > seuil ») | aucun | **Inclusif** dans le code, **strict** dans la documentation ; comparateur affiché « <= » incohérent → D1-14. |
| R24 | **`min_margin` / `max_discount`** | `rules-engine.ts:1154-1175` ; marge effective `src/lib/estimates/effective-margin.ts:32-34` (`1−1/k`) | — | CE | `validation-approbations.md:42-43` | aucun | La marge effective ignore remise et coefficient (D1-05) ; deux sémantiques selon v1 ou v2 (D1-13). |
| R25 | **Seuils d'alerte Direction et métré** : marque ≤ 1 200 pb ; remise ≥ 800 pb ; HT ≥ 25 000 € ; priorité +10 dès 10 000 € ; radar de métré « marge » < 1 000 pb | `src/lib/direction/alerts.ts:45-47`, `:216-220` ; `src/lib/direction/server.ts:322-324` ; `src/lib/takeoff/server.ts:3816-3822` | — | HNS (codés en dur) | `validation-approbations.md:327-340` | aucun | Non paramétrables. Le radar de métré compare `margin_bp` brut (v1) → D1-13, D1-14. |
| R26 | **Pertes (`loss_coeff_bp`)** | Ouvrages générés : appliquées au déboursé (`src/components/estimates/GeneratedOuvrageSubdetailEditor.tsx:153-160`, `src/lib/estimates/generated-ouvrages.ts:1802`) | Ouvrages générés vérifiés (`20261012215942…sql:162`) ; bibliothèque d'ouvrages : « compatibility only » (`20260714134334_use_assembly_cost_coefficients.sql:2`) | PA ; valeurs = HNS | `regles-de-calcul.md:257-275` (« détruit à l'insertion ») | aucun | Deux sémantiques selon le chemin → D1-16. |
| R27 | **Rendements (`yield_value`)** | Stockés seulement (`src/lib/estimates/assemblies-server.ts:312`, `:454`) | Stockés seulement (`20261012215942…sql:14`) | HNS | `regles-de-calcul.md:265` | aucun | Aucun usage dans un calcul (grep `yield_value` sur `src/lib` : uniquement stockage et transport). |
| R28 | **Provisions par famille** (1,01 / 1,03 — CORE-02) | Absentes (grep `provision`, `1.03`, `10300` sans résultat de calcul) | — | CE (souhait) | `backlog-chiffrage-2026-10-11.md` CORE-02 | — | Non implémenté. |
| R29 | **Plafond de stockage** 2 147 483 647 c : écrêtage côté devis, erreur côté commandes | Devis : `estimate-calculations.ts:29`, `:162-175`, `:424`. Commandes : `RangeError` (`src/lib/order-calculations.ts:5-10`) | `integer` | CH (technique) | `regles-de-calcul.md:16-18` | aucun | Signal partiel, affiché seulement dans l'éditeur → D1-03. |
| R30 | **Indice matière** : `Math.round(prix × indice / 100)` | `server.ts:958-962` | `014_catalogue_pricebook_indices_s4.sql:82` | HNS | — | aucun | Ce n'est pas une révision BT/TP → D1-17. |
| R31 | **PU affiché** = `bankersRound(vente / q)` ; total ligne ≠ PU × q | `estimate-calculations.ts:250-251`, `:1352` | — | CH | `glossaire.md:57-58` | aucun | L'aide dit « Prix total HT = PU × Qté » (`ColumnHeaderHelp.tsx:15`) → D1-11. Si q = 0 avec des heures, PU = 0 alors que le total est positif. |
| R32 | **Saisie numérique** : cinq parseurs | `src/lib/money.ts:51-70` ; `src/components/ui-legacy/NumberInput.tsx:16-25` ; `src/lib/estimates/editor-values.ts:46-79` ; `src/lib/estimates/clipboard.ts:649-730` ; `src/lib/affaires/import-flow.ts:125-188` | — | CH | — | aucun | « 1.250 » vaut 1 250 € dans la cellule PU, mais 1,25 € à l'import → D1-19. |

---

## 3. Constats

### D1-01 — La remise saisie en euros est convertie en points de base entiers (EU01)

**Statut : Confirmé.** Le calcul est déterministe et tous les maillons ont été lus.

**Preuve.**
1. Saisie en euros : `discount_cents: Math.round(discountEuros * 100)` (`src/components/estimates/EstimateSettingsPanel.tsx:415-420`).
2. Sauvegarde : `Math.round((totalsSnapshot.discountCents / discountBase) * 10000)` (`src/hooks/useEstimateEditorState.impl.tsx:1441-1447`), puis `discount_bp: discountBp` (`:1470`).
3. Recalcul serveur : `persistAtomicEstimateSettings` recalcule depuis la version prospective (`src/lib/estimates/settings-atomic.ts:40-54`) via `calculateEstimateSnapshotForItems`. Celle-ci reconvertit `discount_bp` en centimes (`src/lib/estimates/version-totals.ts:363-379`), et c'est ce total qui est persisté. Les totaux envoyés par le client sont donc ignorés.
4. Rechargement : `Math.round((saleSubtotalAfterCoefficientCents * version.discount_bp) / 10000)` (`src/lib/estimate-calculations.ts:1525-1527`), appelé par `useEstimateEditorState.impl.tsx:733-749`.

**Mécanisme.** Sur une assiette de 1 995 450 c :
- 101 c donnent un ratio de 0,5062 pb, arrondi à **1 pb** ;
- 1 pb donne 199,545 c, arrondi à **200 c** ;
- HT = 1 995 250 c au lieu de 1 995 349 c.

Le pied observé par l'équipe, `[1995250, 399090, 2394340, 0]` (contrat `annexes/preuves/offer-emission/euro-root-contract-20261014-01/contract.md`), est exactement celui que donne le code.

**Impact métier** (recalculé).

| Saisie | Assiette | Points de base | Remise réellement appliquée |
|---|---|---|---|
| 1,01 € | 19 954,50 € | 1 | 2,00 € |
| 0,99 € | 19 954,50 € | 0 | **0 €** (remise supprimée) |
| 1,00 € | 19 954,50 € | 1 | 2,00 € |
| 49 € | 1 000 000 € | 0 | **0 €** |
| 150 € | 1 000 000 € | 1 (ratio flottant 1,4999999999999998) | 100 € |
| 250 € | 1 000 000 € | 3 | 300 € |

- L'erreur maximale vaut ± 0,5 pb de l'assiette, soit ± 50 € sur 1 M€ HT.
- Le montant affiché dans l'éditeur avant la sauvegarde (101 c) diffère du montant persisté et imprimé (200 c). Le chiffreur ne le voit qu'après rechargement.
- La règle `max_discount` évalue ce `discount_bp` arrondi (`src/lib/estimates/rules-engine.ts:1166-1174`).

**Proposition.**
- Persister l'intention exacte, montant ou pourcentage, sans conversion aller-retour.
- Calculer la remise appliquée = min(intention, assiette).
- Donner à `max_discount` le ratio exact appliqué / assiette.
- Ne jamais dériver une intention d'un arrondi.

Le dépôt vivant prend cette direction (§6), non audité.

### D1-02 — Une remise historique en pourcentage change quand la marge change (EUHIST)

**Statut : Confirmé** pour le mécanisme. **Probable** pour les paramètres de la recette : l'oracle n'est pas joint.

**Preuve.**
- Au chargement d'un brouillon, `discount_cents` est calculé une fois à partir du pourcentage stocké et de l'assiette du moment (`useEstimateEditorState.impl.tsx:733-749`, `estimate-calculations.ts:1525-1527`).
- En mode simple, seuls `discount_cents` et des paliers vides restent dans l'état (`:721-726`, `:760-762`).
- Le calcul vivant utilise ce montant en euros (`src/hooks/useEstimateEditorCalculation.ts:51`).
- Modifier la marge (`updateSettings`, `:1265-1270`) ne recalcule pas `discount_cents`.
- À la sauvegarde, un nouveau `discount_bp` est dérivé de ce montant et de la nouvelle assiette (`:1441-1447`).

**Mécanisme.** Sur une base reconstituée (une ligne de vente 200 c, remise historique de 1 000 pb, marge passée de ×1 à ×2) :

| Étape | Calcul | Résultat |
|---|---|---|
| Chargement | `round(200 × 1000 / 10000)` | 20 c |
| Après la marge ×2 | base 400 c, remise toujours 20 c | HT 380 ; TVA `round(80) − round(4)` = 76 ; TTC 456 |
| Sauvegarde | `round(20 / 400 × 10000)` | 500 pb |

- On obtient **exactement** le pied observé, `[380, 76, 456, 0]`.
- L'attendu métier `[360, 72, 432, 0]` correspond à 10 % de 400 c.
- L'intention historique de 10 % devient 5 % en base, sans action de l'utilisateur. Le panneau n'indique pas qu'il s'agissait d'un pourcentage.

**Impact métier.** Augmenter la marge d'un devis remisé en pourcentage diminue silencieusement le taux de remise accordé. Le commercial croit maintenir les 10 % négociés.

**Proposition.**
- Conserver la nature de l'intention (pourcentage ou montant) dans l'état de l'éditeur.
- Ne recalculer le montant qu'à l'affichage.
- Afficher « 10 % (= 40,00 €) ».

### D1-03 — Écrêtage au plafond de stockage : silencieux pour une ligne seule

**Statut : Confirmé**, et figé par un test.

**Preuve.**
- `capCents` écrête chaque ligne : `Math.min(value, MAX_CENTS)` (`estimate-calculations.ts:162-164`, utilisé `:243` et `:247`).
- `isCapped` n'est testé que sur l'agrégat (`:424`).
- Le golden l'assume : « isCapped vaut FALSE … Le devis annonce 21 474 836,47 EUR au lieu de 32 000 000,00 EUR, en silence » (`src/lib/estimate-calculations.golden/margin-tiers.test.ts:125-162`).
- `docs/metier/regles-de-calcul.md:18` affirme « …mais il est signalé ». **Infirmé pour une ligne seule.**

**Compléments.**
- `ttcLineCents = saleLineCents + taxLineCents` n'est pas plafonné (`:253`). Il peut dépasser l'`integer` de `line_total_ttc_cents`, ce qui provoquerait **probablement** une erreur en base.
- `isCapped` n'est affiché que dans l'éditeur (`useEstimateEditorState.impl.tsx:2731`, `src/components/estimates/editor/EstimateEditorAlerts.tsx:176-184`). Il n'apparaît ni dans le PDF, ni dans le portail, ni à l'envoi.
- Les bons de commande, eux, lèvent `RangeError("Le montant dépasse la capacité d'une commande.")` (`src/lib/order-calculations.ts:5-10`).

**Impact métier.** Un lot unique supérieur à 21,47 M€ est minoré sans alerte. Le cas est rare en CVC et plomberie, mais il touche le montant contractuel.

**Proposition.** Refuser (erreur) plutôt qu'écrêter, comme le font les bons de commande, et propager le signal de la ligne. Le dépôt vivant propage `isCapped` par ligne (§6).

### D1-04 — Paliers de marge : marche d'escalier, défaut non sourcé

**Statut : Confirmé.**

**Preuve.**
- `resolveMarginMultiplier` choisit **un** palier selon le coût total (`src/lib/estimates/margin-tiers.ts:54-61`) et l'applique à toutes les lignes (`estimate-calculations.ts:395-409`).
- Valeurs par défaut : `margin-tiers.ts:9-13`.
- Copie SQL en dur : `supabase/migrations/20260812032857_govern_estimate_calc_engine_v2.sql:3370-3376`.

**Exemples chiffrés.**
- Coût 9 999 999 c, ×1,60 : vente `round(15 999 998,4)` = **159 999,98 €**.
- Coût 10 000 000 c, ×1,45 : vente **145 000,00 €**.
- Tout coût entre 100 000 € et 110 344,83 € (= 160 000 / 1,45) se vend moins cher qu'un coût de 99 999,99 €.

**Autres éléments.**
- Paramétrage : table `margin_tiers` par entreprise (`023_margin_tiers.sql`, contraintes 0 ≤ k ≤ 100). L'interface d'administration est `src/components/estimates/MarginTiersManager.tsx` (« paramétrable par un administrateur », `:140`).
- Modifier le barème réévalue en direct tous les brouillons à paliers de l'entreprise. Les versions figées ne bougent pas (`regles-de-calcul.md:150-154`).
- Sans barème : drapeau `margin_not_configured` **bloquant** par défaut (`src/lib/estimates/gating.ts:142`, `:513-515`). Il peut être rétrogradé par les drapeaux `ESTIMATE_GATING_*_FLAGS`. Le panneau affiche « Barème par défaut, faute de tranches définies » (`EstimateSettingsPanel.tsx:371-373`).
- Un barème dont le premier seuil est supérieur à 0 applique quand même son premier multiplicateur sous ce seuil (`margin-tiers.ts:54-58`).
- Le contrôle SQL au gel vérifie seulement que le multiplicateur appartient au barème, pas qu'il correspond au palier du coût (`20260812032857…sql:3394-3404`).

**Impact métier.** Incitation perverse : ajouter un poste fait baisser l'offre. Sur des devis de 90 à 115 k€ de coût, le prix est instable au gré d'une ligne.

**Proposition.**
- Décision métier à prendre : barème progressif par tranches (comme l'impôt) ou lissage.
- Supprimer le barème par défaut, ou le faire valider et sourcer.
- Contrôler en SQL la cohérence du palier avec le coût.

### D1-05 — `min_margin` ignore la remise et le coefficient global

**Statut : Confirmé.**

**Preuve.**
- `min_margin` évalue `resolveEffectiveMarginBp(version)` (`src/lib/estimates/rules-engine.ts:1154-1163`).
- Ce résolveur ne lit que le coefficient de marge : `round((1 − 1/k) × 10 000)` (`src/lib/estimates/effective-margin.ts:32-34`, `:73-78`).
- Remise et coefficient global n'entrent pas dans le calcul.
- `max_discount` lit seulement `discount_bp` (`rules-engine.ts:1166-1174`). Aucun contrôle ne porte sur le coefficient global.

**Exemple.**
- k = 1,25 et remise de 20 % : vente nette = coût × 1,25 × 0,8 = coût, donc marque réelle de 0 %.
- `min_margin` voit 2 000 pb et laisse passer un seuil de 1 500 pb.
- Même résultat avec un coefficient global de 0,8 et sans remise : aucune règle ne réagit.

**Proposition.** Calculer la marge sur le net réel : (vente nette − déboursé) / vente nette, à partir du breakdown figé.

### D1-06 — Heures de main-d'œuvre : totales dans le moteur, « par unité » dans l'interface

**Statut : Confirmé** pour la contradiction. **Probable** pour l'impact, qui dépend des pratiques de saisie et des DPGF importés.

**Preuve.**
- Moteur : `hMoMajoration * hMo * hourlyRateLegacy * kMo`, **sans** quantité, alors que la fourniture vaut `quantity * unitPrice * kFo` (`src/lib/estimate-calculations.ts:232-236`, `:242-244`).
- Aide de colonne : « h MO » = « Heures de main d'œuvre par unité » (`src/components/estimates/components/ColumnHeaderHelp.tsx:11`).
- La formule du PU y est fausse : « PU = (PR FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge » (`:14`).
- « h MO atelier » et « h MO chantier » sont aussi annoncés « par unité » (`:18`, `:21`). L'exemple du panneau d'aide n'est juste que pour q = 1 (`src/components/estimates/components/EstimateColumnsHelpPanel.tsx:285-292`).
- Les chemins de remplissage ne sont pas homogènes :

| Chemin | Traitement des heures | Référence |
|---|---|---|
| Ouvrages de bibliothèque | Heures unitaires **× quantité** à l'insertion | `coalesce(assembly_item.h_mo,0) * p_quantity_multiplier` (`20261013002038_assembly_library_component_provenance.sql:133`) |
| Ouvrages générés | `quantité parent × rendement` en h/… | `src/lib/estimates/generated-ouvrage-labor-hours.ts:30-37` |
| Import DPGF | `labor_hours` **brut**, sans multiplication | `src/lib/affaires/import-flow.ts:450-453`, `:461-468`. Le mapping DPGF dédié associe la colonne « h MO » à `labor_hours` (`docs/domaines/imports-dpgf.md:292-293`). |
| Métré | `h_mo = 0` | `20260225133000_tkf013_takeoff_apply_rpc.sql:250` |

- Aucun code ne réajuste `h_mo` quand la quantité d'une ligne change (recherche des couples `h_mo` / `quantity` dans `src/hooks`, `src/components/estimates`, `src/lib/estimates` : seulement des valeurs par défaut).
- Les tests figent la sémantique « heures totales » : fixture A, ligne q = 3, `h_mo` = 2 (`src/lib/estimate-calculations.golden/fixtures.ts:129-140`).

**Exemple.** 10 m de tube, PR FO 10 €/m, 0,5 h/m selon l'aide, 45 €/h, marge ×1 :

| | Fourniture | Main-d'œuvre | Total ligne |
|---|---|---|---|
| Attendu par le chiffreur | 100 € | 225 € | 325 € |
| Calcul du moteur | 100 € | 22,50 € | 122,50 € (−62 %) |

À l'inverse, un chiffreur qui saisit des heures totales lit un PU qui ne correspond pas à l'aide.

Autre cas, **Probable** car déduit d'une absence de code : un ouvrage inséré à q = 10 (soit 5 h pour 0,5 h/u), dont la quantité passe ensuite à 20. La fourniture double, mais la MO reste à 5 h.

**Proposition.**
- Décision métier : heures unitaires (pratique du sous-détail BTP) ou totales.
- Aligner moteur, aide, import et ouvrages.
- Ajouter un test qui vérifie la cohérence entre la formule affichée et le calcul.

### D1-07 — TVA v2 : réglage « TVA unique » sans effet sur les lignes existantes, document à taux unique

**Statut : Confirmé.**

**Preuve.**
- Le moteur v2 applique `item.tax_rate_bp ?? taxRateBp` (`estimate-calculations.ts:1318-1325`).
- Les lignes ont toujours un taux non nul, car l'intégrité impose des champs de prix non nuls (`regles-de-calcul.md:230-231`).
- À la sauvegarde des réglages, le SQL conserve le taux des lignes en v2 : `tax_rate_bp=case when version_row.calc_engine_version=1 then projected.tax_rate_bp else i.tax_rate_bp end` (`supabase/migrations/20261014070453_estimate_settings_atomic.sql:232`). Le TS fait de même (`src/lib/estimates/settings-atomic.ts:43`).
- Les nouvelles lignes prennent le taux de la version (`src/hooks/useEstimateEditorItemsController.ts:443-448`, `:497`).
- Aucune colonne TVA n'est éditable dans la grille (recherche de « TVA » dans `src/components/estimates/editor/` et `EstimateEditorTable*.tsx` : aucun résultat).
- Le panneau dit « TVA unique » (`EstimateSettingsPanel.tsx:488`).
- Le document affiche `taxLabel` = taux de version (`src/components/estimate-document/prepare-estimate-document-data.ts:438`) et un seul total de TVA (`src/components/EstimateDocument.tsx:458-467`).
- Autre chemin : la modification du taux horaire d'un rôle réécrit localement `tax_rate_bp` au taux de version (`useEstimateEditorState.impl.tsx:1663-1673`). La priorité entre taux de ligne et taux de version n'est donc pas la même partout (**Probable** : persistance non vérifiée).

**Exemple.** Devis créé à 20 %, passé à 10 % (rénovation) : toutes les lignes restent à 20 %, alors que l'en-tête du PDF affiche « TVA 10 % ». Sur 50 000 € HT, l'écart est de 5 000 € de TVA.

**Impact.** Risque fiscal et commercial. L'exigence de ventilation de la TVA par taux sur les factures (art. 242 nonies A, annexe II CGI) est **à valider par un expert** pour un devis. Elle deviendra incontournable au moment de la facturation.

**Proposition.**
- Décider du modèle : taux par ligne éditable, ou taux unique propagé.
- Afficher un récapitulatif par taux sur le document.
- Tester le changement de taux de version en v2.

### D1-08 — Unités : portées par `description`, sans conversion ni conditionnement

**Statut : Confirmé.** Voir aussi le §3.1, contradiction 1.

**Preuve.**
- Pas de colonne `unit` sur `estimate_items` (`src/types/database.ts`, ligne `estimate_items` ; `ecarts-standards-btp.md:82-90`).
- Le mapping DPGF verse l'unité dans `description` : « L'unité alimente la description visible » (`docs/domaines/imports-dpgf.md:296-298`).
- Le popover de suggestion catalogue écrit la **désignation produit** dans `description` (`src/components/estimates/components/estimate-editor-row/useCatalogueSuggestions.ts:175`). Il peut donc écraser l'« unité ».
- Associer un article du catalogue remplace l'unité sans convertir la quantité (`EstimateEditorTable.tsx:1561`, `:1574`).
- Cinq normalisations divergentes :

| Normaliseur | Règle | Référence |
|---|---|---|
| Métré A | `UNIT_SYNONYMS` | `src/lib/takeoff/processor.ts:138-150`, `:321-344` ; `src/lib/takeoff/units.ts:1-9` |
| Métré B, comparaison DPGF | — | `src/lib/takeoff/dpgf-compare.ts:147-181` ; `src/lib/takeoff/diff.ts:90-98` |
| Achats (TS et SQL) | `ml` → `m`, `mL` → `millilitre` | `src/lib/estimates/supplier-offer-eligibility.ts:4-10` ; `20261011091744…sql:608-609` |
| Prix de référence | Égalité stricte `lower(btrim)` | `20261011030647_reference_price_zero_and_inclusive_validity.sql:61` |
| Import DPGF et catalogue | `trim` seulement | — |

Exemples (lecture du code, non exécutée) :

| Entrée | Métré A | Comparaison DPGF | Achats | Import DPGF |
|---|---|---|---|---|
| `ML` | `ml` | `ml` | **`millilitre`** | `ML` |
| `m²` | `m2` | **`m`** | `m²` | `m²` |
| `ens` | `forfait` | `ensemble` | `ens` | `ens` |

- Cause du cas `m²` : `diff.ts:95` remplace `²` par une espace avant que `dpgf-compare.ts:152` ne tente `²` → `2`. Une ligne DPGF en m² ne s'apparie donc plus à une ligne de métré en m2.
- Aucun conditionnement : recherche de `colisage`, `conditionnement`, `pack_size`, `order_multiple`, `moq`, `conversion_factor` sans résultat. `min_quantity` est un seuil, pas un multiple.

**Impact.**
- Une offre en « m » peut être comparée à une ligne en « ml » sur un chemin et rejetée sur l'autre.
- Un DPGF qui écrit « ML » (mètre linéaire, l'usage courant) est lu comme du millilitre à la préparation des achats, et la ligne est bloquée pour « Unité différente du devis ».
- Le tube vendu en barres de 4 m ou le calorifuge en rouleaux n'est pas modélisé : la comparaison des prix achat ne porte pas sur la quantité réellement achetée.

**Proposition.**
- Colonne d'unité typée, avec un référentiel d'unités et un normaliseur unique partagé TS/SQL.
- Conversions explicites et conditionnement côté offre.

### D1-09 — Offre fournisseur à 0 € : exclue de la référence, éligible au meilleur prix

**Statut : Confirmé.**

**Preuve.**
- La base accepte 0 : `check (unit_price_cents >= 0)` (`supabase/migrations/014_catalogue_pricebook_indices_s4.sql:13`).
- Prix de référence : `when sp.unit_price_cents = 0 then 'zero_price'` (`20261011030647…sql:65`).
- Meilleur prix TS : simple tri croissant (`src/lib/estimates/server.ts:1051-1056`).
- `supplierOfferIneligibility` ne contrôle pas le prix (`supplier-offer-eligibility.ts:12-30`).
- Le catalogue SQL retient `order by unit_price_cents asc … limit 1` sans exclure 0 (`20260906145000_supplier_reference_price_proposals.sql:436`).
- Application à une ligne : par présélection (`server.ts:1586-1589`), par le popover et par la fiche article, **sans contrôle d'éligibilité** (`useCatalogueSuggestions.ts:168-176` ; `src/components/estimates/EstimateEditorTable.tsx:1575`).

**Garde-fou partiel.** `missing_price`, bloquant à l'envoi (`gating.ts:133`), se déclenche si la ligne attend une fourniture et que `unit_price_ht_cents <= 0` (`src/lib/estimate-quality.ts:171-173`). Une ligne de nature « pose seule » ou mixte mal qualifiée y échappe. **Probable**, selon la nature de la ligne.

**Impact.** Un tarif à 0 € (gratuité, saisie incomplète, « sur demande ») peut fixer la fourniture à 0 € dans un devis brouillon, et polluer l'indicateur « meilleur prix ».

**Proposition.** Appliquer la politique du porteur (« 0 € exclu, à clarifier ») sur tous les chemins, via un prédicat unique d'éligibilité partagé TS/SQL.

### D1-10 — Moteur v1 : sections ≠ pied, TVA de ligne écrasée, et perpétué par duplication

**Statut : Confirmé.**

**Preuve.**
- Les sections v1 ignorent le coefficient global : le prorata utilise un numérateur post-coefficient et un dénominateur pré-coefficient. Figé : écart de 10 288 c (`src/lib/estimate-calculations.golden/v1.test.ts:399-441`).
- Prorata de remise en `Math.round` par section (`estimate-calculations.ts:671-680`).
- Les lignes racine gonflent le dénominateur, d'où une remise « perdue » (`v1.test.ts:743-800`).
- Taux de version imposé (`estimate-calculations.ts:1632-1635`, `v1.test.ts:877-880`).
- La duplication conserve le moteur : « duplication preserves its source » (`20260812032857…sql:307-308`).

**Exemple minimal.** Deux sections d'une ligne à 100 c, remise de 1 c : chaque section reçoit `round(0,5)` = 1 c, d'où Σ sections = 198 c pour un pied à 199 c.

**Impact.** Un document v1 montre des sous-totaux qui ne s'additionnent pas. Toute version dupliquée d'un devis v1 continue de produire ces écarts.

**Proposition.** Proposer une migration explicite v1 → v2 à la duplication, ou bloquer la duplication v1 en brouillon modifiable.

### D1-11 — Arrondis : PU × quantité ≠ total, demi-centimes et flottants

**Statut : Confirmé.**

**Preuve et exemples.**
- PU = `bankersRound(vente / q)` (`estimate-calculations.ts:250-251`). Exemple : q = 3, PU FO 1 001 c, k = 1,6 → vente 4 805 c, PU 1 602 c, PU × q = 4 806 c ≠ 4 805 c. L'aide affirme pourtant « Prix total HT = PU × Qté » (`ColumnHeaderHelp.tsx:14`).
- Même pourcentage, deux arrondis : remise simple de 1 000 pb sur 105 c → `Math.round(10,5)` = 11 c (`:1525-1527`) ; cascade d'un pas de 1 000 pb → `bankersRound(10,5)` = 10 c (`:285`).
- Flottants : q = 1,005 × 100 c donne `1.005*100 = 100.49999999999999`, donc 100 c, alors que le `numeric` exact donne 100,5, arrondi à 101 c (demi-supérieur) ou 100 c (demi-pair). Aucune règle documentée ne tranche.
- TVA demi-supérieur : 25 c à 2 % donnent 1 c (golden `commercial-rounding.test.ts:18-31`).

**Impact.**
- Écarts de quelques centimes visibles par le client (PU × Qté) et non reproductibles entre TS et SQL.
- Sur 1 004 lignes, la TVA par ligne (399 090 c) dépasse de 40 c les 20 % du HT (399 050 c) dans la recette EU01. C'est acceptable si la méthode est assumée et documentée.

**Proposition.**
- Contrat d'arrondi unique et écrit : arithmétique décimale, mode d'arrondi par grandeur.
- Afficher le PU avec la précision nécessaire, ou ajuster le total ligne à PU × q selon la convention choisie.

### D1-12 — Arrondi commercial stocké comme de la TVA ; divergences d'arrondi TS/SQL

**Statut : Confirmé.**

**Preuve — stockage.**
- Le payload de sauvegarde envoie `total_tax_cents: totalsSnapshot.adjustedTaxCents` (`useEstimateEditorState.impl.tsx:1479`), avec `adjustedTaxCents = roundedTtcCents − saleTotalCents` (`estimate-calculations.ts:483`).
- Le recalcul serveur fait de même (`settings-atomic.ts:49-53`), ainsi que `src/lib/estimates/editor-items.ts:194`.
- Contrat SQL : « consumers derive true VAT as total_tax_cents - rounding_adjustment_cents » (`20260812223050_separate_commercial_rounding_and_harden_approval.sql:2-4`).
- **En v2, l'ajustement est aussi réparti dans la TVA figée de chaque ligne** : `allocateProRata(breakdown.totals.adjustedTaxCents, effectiveTaxWeights)` puis `line_tax_cents: allocatedTax[index]` (`src/lib/estimate-v2-snapshot.ts:368-384`). Le `line_tax_cents` figé d'une ligne n'est donc plus « taux × net ».
- L'équipe le reconnaît : « `total_tax_cents` inclut l'ajustement commercial ; il n'est pas l'oracle de TVA comptable » (`docs/testing/commercial-rounding.md:63-66`).

**Preuve — consommateurs.**
- Ceux qui corrigent :
  - le PDF : `total_tax_cents − rounding_adjustment_cents` (`src/lib/estimates/pdf-generator.tsx:1687-1689`), puis `computedTotals.taxCents` (`:1739`) ;
  - le portail : contrôle `offer-document.ts:108` ;
  - l'export : `export-stream.ts:170-172`.
- Ceux qui affichent la valeur brute sous le libellé « TVA » :
  - le comparatif de variantes (`src/components/estimates/VariantComparisonTable.tsx:135`, `:184`) ;
  - l'éditeur en lecture seule d'une version v1 (`estimate-calculations.ts:1808-1821`, puis `EstimateSettingsPanel.tsx:602-605`).

**Preuve — divergence TS/SQL.**
- `recalculate_takeoff_estimate_version` (application d'un métré) recalcule les totaux en SQL. Il arrondit la remise simple issue de `discount_bp` au **demi pair** : `takeoff_round_half_even(scaled_ht::numeric * step_bp::numeric / 10000)` (`20260813201300_atomic_takeoff_apply_mapping.sql:922-936`, fonction `:442-458`).
- Le TS l'arrondit au **demi supérieur** (`estimate-calculations.ts:1525-1527`).
- Exemple : base 12 345 c à 1 000 pb, soit 1 234,5. Le TS retient 1 235 c, le SQL 1 234 c. Le même devis a donc 1 c d'écart de HT selon qu'il a été recalculé par le métré ou par l'éditeur.
- Quand toutes les TVA de ligne sont nulles, la répartition SQL se fait à parts égales (`:504-510`) ; la projection TS se replie sur les poids HT (`estimate-v2-snapshot.ts:363-367`).

**Interprétation.**
- Tout consommateur qui lit `total_tax_cents` ou le `line_tax_cents` v2 comme une TVA se trompe d'un montant égal à l'arrondi.
- Un « montant à payer » TTC inférieur à HT + TVA sans réduction du HT pose une question fiscale (base de TVA = contrepartie réellement due), **à valider par un expert-comptable**.

**Proposition.**
- Stocker une TVA comptable pure, par ligne et au total, et l'ajustement à part (`rounding_adjustment_cents` existe déjà).
- Faire calculer le métré par le moteur TS, ou partager une bibliothèque d'arrondi testée sur les deux.

### D1-13 — Deux sens de « marge » (P5)

**Statut : Confirmé.**

**Preuve.**

| Surface | Formule | Référence |
|---|---|---|
| Panneau de réglages | `(k−1) × 100 %`, « 1.20 = marge de 20 % » | `EstimateSettingsPanel.tsx:312`, `:331-333`, `:352` |
| Assistant de création | « Marge (%) » saisie p, `margin_multiplier = 1 + p/10000` et `margin_bp = p` | `src/components/estimates/estimate-creation-wizard/PricingStep.tsx:125-137` ; `submitEstimateCreation.ts:74-75` |
| Règles v2 et Direction | `1 − 1/k` (marque) | `effective-margin.ts:32-34` |
| Règles v1 | `margin_bp` stocké, issu de l'assistant (k−1) et **non mis à jour** par le panneau (absent du payload `useEstimateEditorState.impl.tsx:1462-1481`) | `effective-margin.ts:66-71` |
| Colonne « Marque % » | marge / vente | `src/lib/estimates/line-margin.ts:93` ; `ColumnHeaderHelp.tsx:25-26` |

**Exemple.** k = 1,25 :
- le panneau et l'assistant affichent « 25 % » ;
- la règle v2 évalue 2 000 pb (20 %) ;
- une règle v1 évalue 2 500 pb.

Un administrateur qui fixe « marge minimum 25 % » (2 500 pb) bloque en v2 un devis que le panneau présente à 30 % (k = 1,30, marque 23,08 %).

**Cas du radar de métré.**
- `src/lib/takeoff/server.ts:3794-3802` appelle `evaluateRules` sans `calc_engine_version`. Le résolveur retombe donc sur v1 et évalue le `margin_bp` stocké, même pour une version v2.
- Sans règle, il applique un seuil codé en dur : `margin_bp < 1000` (`:3816-3822`).

**Proposition.**
- Nommer distinctement « coefficient de vente », « taux de marge » et « taux de marque » partout.
- Unités explicites dans les règles.
- Supprimer `margin_bp` en lecture v1, ou le recalculer.

### D1-14 — Seuil d'approbation inclusif, seuils Direction codés en dur

**Statut : Confirmé** pour l'inclusivité.

**Preuve.**
- `checkApprovalRule` : `violated: actualValue >= threshold` (`rules-engine.ts:1119-1126`), alors que le comparateur publié est `"<="` (`:1182`).
- La documentation dit « valeur > seuil » (`docs/domaines/validation-approbations.md:44`).
- Défaut de 500 000 c, soit 5 000 € HT, créé par entreprise (`20260812223050_separate_commercial_rounding_and_harden_approval.sql:269-275`). Il est modifiable dans la table `estimate_rules`.

**Exemple.** Un devis à exactement 5 000,00 € HT exige une approbation (code), alors que la documentation dit le contraire.

Le message de violation parle de « au-dessus du seuil » (`rules-engine.ts:1263`).

**Seuils codés en dur** (sans paramétrage par entreprise, sans source métier) :

| Seuil | Valeur | Comparaison | Référence |
|---|---|---|---|
| Marque basse (Direction) | 1 200 pb | `<=` | `src/lib/direction/alerts.ts:46`, `:217` |
| Remise forte (Direction) | 800 pb | `>=` | `alerts.ts:47`, `:220` |
| Forte valeur | 2 500 000 c | `>=` | `alerts.ts:45`, `:218` ; `src/lib/direction/server.ts:322` |
| Priorité + 10 | 1 000 000 c | — | `server.ts:324` |
| Radar de métré | 1 000 pb | `<` | `src/lib/takeoff/server.ts:3816-3822` |
| Prix périmé | 90 jours (paramétrable par drapeau) | — | `src/lib/catalogue/stale-prices.ts:1-2` |
| Fraîcheur affichée au catalogue | 30 / 90 jours | — | `src/lib/catalogue/stale-prices.ts:57-58` |
| Dispersion de la référence | 15 % | — | `20261011030647…sql:111` |

**Proposition.**
- Décider (≥ ou >), aligner le code, le libellé du comparateur et la documentation, puis tester la borne.
- Rattacher chaque seuil Direction à une règle d'entreprise paramétrable.

### D1-15 — Majoration MO : cinq conventions incompatibles

**Statut : Confirmé** pour les conventions. **Probable** pour l'impact, qui dépend du mapping retenu à l'import.

**Preuve.**

| Chemin | Convention | Référence |
|---|---|---|
| Moteur | multiplicateur, 1 = neutre | `estimate-calculations.ts:201`, `:233-236` |
| Saisie en grille | toujours ÷ 100 (5 donne 0,05) | `parseMajorationPercentToCoefficient`, `src/components/estimates/components/estimate-editor-row/shared.ts:260-262` |
| Collage | `%` dans l'en-tête ou valeur > 10 ⇒ ÷ 100, sinon brut | `src/lib/estimates/clipboard.ts:401-419` |
| Import DPGF | valeur brute (« 100 » donne ×100) ; heuristique « majoration » + « mo » → `h_mo_majoration` | `import-flow.ts:454-457` ; `src/lib/mappings/server.ts:796-801` |
| Export éditeur | pourcentage, `h_mo_majoration × 100` | `src/lib/estimates/editor-export.ts:394-398` |
| Export DPGF | coefficient | `src/lib/estimates/dpgf-export.ts:358-360` |
| Aide | « Majoration MO (%) … Non utilisée pour le moment : laisser à 100 % », alors qu'elle est appliquée | `ColumnHeaderHelp.tsx:12` |

**Exemples.**
- Un fichier OPTIMA ou un export de l'éditeur ré-importé avec « 100 » multiplie la MO par 100.
- Un collage de « 15 » (pensé comme +15 %) donne 0,15, soit −85 % de MO.
- Un collage de « 8 » donne ×8, alors que la même valeur saisie au clavier donne ×0,08.

**Proposition.** Une seule unité (pourcentage ou coefficient), déclarée dans l'en-tête, avec un rejet des valeurs ambiguës.

### D1-16 — Pertes et rendements : sémantique dépendante du chemin

**Statut : Confirmé.**

**Preuve.**

| Chemin | Traitement des pertes | Référence |
|---|---|---|
| Ouvrages générés | Appliquées au déboursé : `q × coût × (1 + perte)` | `GeneratedOuvrageSubdetailEditor.tsx:153-160` ; `generated-ouvrages.ts:1802` ; SQL `20261012215942…sql:162` |
| Bibliothèque d'ouvrages | « loss_coeff_bp remains for compatibility only » | `20260714134334_use_assembly_cost_coefficients.sql:2` |
| Matérialisation dans un devis | Aplatit en lignes sans perte ni rendement | `20260722132425_nested_estimate_assemblies.sql:561-591`, cité par `regles-de-calcul.md:271-275` |

Les rendements ne sont jamais utilisés dans un calcul.

**Impact.** Un même composant (tube + 3 % de pertes) coûte 3 % de plus s'il vient d'un ouvrage généré que s'il vient de la bibliothèque. Un ouvrage généré enregistré en bibliothèque puis réinséré peut perdre ses pertes (**À vérifier** par exécution).

### D1-17 — Fonctions de facturation BTP absentes ; indice matière non conforme à une révision

**Statut : Confirmé.**

**Preuve.**
- Retenue de garantie et compte prorata sont notés 🚫 (`docs/metier/glossaire.md:177`, `:190`). Situations : `:168-169`. Révision : `:186-188`.
- Mots-clés cherchés dans `src` et dans les migrations, sans modélisation trouvée : `situation`, `deposit`, `holdback`, `BT01`, `price_revision`, `DGD`, `acompte`, `retenue de garantie`.
- Seul le texte des conditions générales en parle : « Aucun acompte n'est dû s'il n'est pas expressément prévu », pénalités au taux BCE + 10 points, indemnité de 40 € (`src/lib/estimates/pdf-terms.ts:39`).
- Indice : `Math.round((row.unit_price_cents * materialIndex.index_value) / 100)` (`src/lib/estimates/server.ts:958-962`). Il n'y a ni I0, ni partie fixe, ni date de référence.
- Aucun chemin d'interface ne renseigne `material_index_id`. Le seul chemin d'écriture TS n'envoie pas ce champ (`src/lib/catalogue/server.ts:1231-1237`).

**Impact.**
- Un indice BT réel (≈ 130) saisi tel quel majore le prix de 30 %.
- Une formule P = P0 × (a + b·I/I0) n'est pas représentable.

**Proposition.** Pour un chiffreur seul, l'absence de retenue, de prorata et de situations est acceptable. Pour la suite chantier (axe hors D1), il faut une décision explicite. L'indice est à retirer ou à remodéliser.

### D1-18 — Coefficient de marge nul ou inférieur à 1 accepté sans alerte

**Statut : Probable.** Le code est lu ; le comportement de la saisie n'a pas été exécuté.

**Preuve.**
- `emptyValue={0}` sur le champ marge (`EstimateSettingsPanel.tsx:325`), avec `onValueChange(emptyValue)` pour une saisie vide (`src/components/ui-legacy/NumberInput.tsx:72-73`).
- Le SQL accepte `margin_multiplier >= 0` (`20261014070453…sql:84-86`).
- Aucun drapeau qualité ne porte sur la marge (`src/lib/estimate-quality.ts:15-23`).

**Impact.** Un champ effacé par erreur produit un devis à 0 € HT, enregistrable. Il serait seulement bloqué par une règle `min_margin` si elle existe : `toPositiveMultiplier` renvoie `null`, évalué à 0 (`effective-margin.ts:13-20`, `rules-engine.ts:1158`).

### D1-19 — Cinq parseurs numériques aux règles différentes

**Statut : Confirmé** pour le code. **Probable** pour l'impact en saisie, car `<input type="number">` peut filtrer des caractères selon le navigateur.

**Preuve.**

| Parseur | Règle | Référence |
|---|---|---|
| Cellule PU | `parseEuroToCents` : « 1.250 » donne 1 250 € (le point est un séparateur de milliers) ; « 12,345 » est refusé (plus de deux décimales) | `src/lib/money.ts:51-70` |
| Champs du panneau | `parseLocalizedNumberInput` : `replace(",", ".")` puis `parseFloat`. « 1 000 » donne 1 ; « 1.234,56 » donne 1,234 | `src/components/ui-legacy/NumberInput.tsx:16-25` |
| Cellules Qté, K FO, h MO | `parseNumberInput` : une saisie invalide devient 0 | `src/lib/estimates/editor-values.ts:46-79` |
| Collage | `parseClipboardNumber` : en domaine « montant », « 1.000 » donne 1 000 et « 12,345 » donne 12 345 ; en domaine « quantité », 1 et 12,345 | `src/lib/estimates/clipboard.ts:649-730`, `:781-786` |
| Import DPGF | « 1.000 » donne 1 ; « 1.250 » donne 1,25 | `src/lib/affaires/import-flow.ts:125-188` |

**Impact.** Un PU « 1.250 » vaut 1 250 € s'il est saisi ou collé, et 1,25 € s'il est importé : un facteur 1 000. Une quantité invalide devient 0 sans erreur.

**Proposition.** Un parseur unique par grandeur (montant, quantité, taux), qui rejette explicitement les formats ambigus.

---

## 3.1 Contradictions documentaires tranchées par le code

| # | Contradiction | Verdict | Preuve |
|---|---|---|---|
| 1 | Unités : « défaut le plus grave » (`ecarts-standards-btp.md:108`) vs « fonctionnent via description » (`docs/audit/vision-produit-2026-10-11.md:103`) | **Les deux sont partiellement justes.** Le constat factuel d'`ecarts-standards-btp` (pas de colonne, description réutilisée) reste vrai dans la copie. « Fonctionnent » est exagéré : pas de conversion, normalisations divergentes, écrasement possible par le popover catalogue (D1-08). La gravité relative est un jugement, non tranché par le code. | D1-08 |
| 5 | Annulation des cellules : « jamais empilées » (`docs/domaines/chiffrage-editeur.md:126`) vs « Undo/redo couvre déjà les modifications de cellules » (`vision-produit…:103`) | **Doc B juste sur l'empilement, doc A périmé.** Les éditions de cellule poussent bien une commande `patch-item`. Mais la pile est vidée après chaque lot de lignes enregistré, ce qui confirme la réserve de A sur l'autosave. | Empilement : `src/hooks/useEstimateEditorItemsController.ts:844-850`. Vidage : `src/hooks/useEstimateEditorSyncController.ts:924` (`if (lineBatchCommitted) clearHistory();`), `:958` |
| 6 | TVA multi-taux « inopérante » (glossaire) vs « effective en v2 » (`regles-de-calcul.md:188-191`) | **Doc B juste pour le moteur, mais incomplet.** Le moteur v2 calcule bien par taux de ligne. En pratique, aucun taux de ligne n'est éditable, le réglage de version n'a plus d'effet sur les lignes existantes, et le document n'affiche qu'un taux (D1-07). | `estimate-calculations.ts:1318-1325` ; `…settings_atomic.sql:232` ; `prepare-estimate-document-data.ts:438` |
| 8 | Paliers par défaut « non signalés » (`regles-de-calcul.md:109-110`) | **Doc périmée.** Le défaut est signalé par un texte du panneau et par un drapeau bloquant à l'envoi. | `EstimateSettingsPanel.tsx:371-373` ; `gating.ts:72-76`, `:142`, `:513-515` |
| 9 | Seuil d'approbation « > seuil » et « aucun seuil codé en dur » (`validation-approbations.md:44`, `:64` ; `cycle-de-vie.md:240`) | **Doc fausse sur l'inégalité** : le code est inclusif (`>=`, D1-14), alors que le comparateur publié dit `<=`. « Aucun seuil codé en dur » est vrai pour le moteur de règles (table `estimate_rules`, défaut de 5 000 € créé par migration). C'est faux pour la Direction (1 200 pb, 800 pb, 25 k€) et pour le radar de métré (1 000 pb), que la même documentation liste d'ailleurs à `validation-approbations.md:327-332`. | `rules-engine.ts:1123`, `:1185` ; `20260812223050…sql:269-275` ; `direction/alerts.ts:45-47` ; `takeoff/server.ts:3816-3822` |
| 10 | Remise simple stockée « en centimes, ou `discount_bp` » (`regles-de-calcul.md:169`) | **Stockée en points de base uniquement** dans la copie. Les centimes ne sont qu'un état d'éditeur. La colonne de montant n'existe que dans le dépôt vivant. | `useEstimateEditorState.impl.tsx:1470` ; `version-totals.ts:363-379` |
| 11 | Modes d'arrondi `up`/`nearest` existent vs règle « arrondi inférieur uniquement » (backlog CORE-01) | **Les deux sont vrais à des niveaux différents.** L'interface ne propose que `down` pour un nouveau choix. Le moteur et l'enum conservent `nearest` et `up`, affichés comme « Réglage conservé ». La règle CORE-01 n'est donc pas une invariante du moteur : une version historique ou un appel d'API peut encore augmenter le TTC. Le SQL accepte `up`/`nearest` à la sauvegarde. | `rounding-options.ts:12-40` ; `estimate-calculations.ts:177-184` ; `…settings_atomic.sql:94` |
| 12 | Déboursé sec « jamais persisté » (`regles-de-calcul.md:83-86`, glossaire) vs instantanés FO/MO v2 | **Les deux sont périmés ou imprécis.** Les instantanés v2 figent des **ventes nettes** FO/MO (`snapshot_fo_ht_cents`, etc., `regles-de-calcul.md:345-348`), pas un déboursé. Le **coût** (déboursé sec) n'est toujours pas persisté par ligne. Le barème et le coefficient appliqués sont figés dans `calc_snapshot_context`. Le déboursé reste donc recalculé avec les taux horaires du moment, sauf contexte figé. | `estimate-v2-snapshot.ts:14-24` ; `version-totals.ts:41-46` |
| 13 | Statuts `sending → draft`, `canceled` vs `cancelled` | **`cycle-de-vie.md` est juste.** Le détail est donné ci-dessous. | Voir ci-dessous |

**Détail de la contradiction 13 (statuts).**
- `estimate_status` vaut `draft | sending | sent | accepted | archived` (`src/types/database.ts:5393` ; `20260811231754_estimate_email_sending_status.sql:7-8`).
- La transition `sending → draft` existe, avec effacement obligatoire du sceau (`20260811231759_transactional_estimate_email_outbox.sql:299-312`, `:334-337`). `draft → sent` direct reste permis.
- Il n'y a pas de statut `rejected` : un refus du client archive le devis (`20261013130248_estimate_offer_client_contract.sql:880`). Il n'y a pas de `canceled` pour un devis, ce qui confirme `cycle-de-vie.md:16`.
- `purchase_order_status` utilise `canceled` de façon homogène (`001_add_job_title_to_profiles.sql:15-20`, `database.ts:5391`).
- Les deux orthographes coexistent dans le **métré** : `takeoff_job_status 'canceled'` (`20260224123000_tkf001_takeoff_schema.sql:12-18`) et `takeoff_provider_batch_state 'cancelled'` (`20260309103000_est421_takeoff_provider_batch_persistence.sql:8-17`, `src/lib/takeoff/types.ts:48` contre `:920`, `:948`). C'est hors calcul, mais c'est un risque de comparaison de chaînes.

---

## 4. Cas de reproduction pour la phase de tests (Vitest, fonctions pures de la copie)

**Conventions.**
- Les fabriques reprennent celles des tests existants : `makeLine`, `makeSection` et `makeVersion` de `src/lib/estimate-calculations.golden/fixtures.ts:26-88`, ou `createItemRecord` et `createLine` de `src/lib/estimate-calculations.test.ts:23-84`.
- Valeurs par défaut utiles : `tax_rate_bp: 2000`, `k_fo: 1`, `h_mo: 0`, `k_mo: 1`, `labor_role_id: null` (sinon `role-mo` à 4 500 c/h dans `fixtures.ts`).
- Cartes de taux : `new Map()` vides, sauf mention.
- « Attendu métier » est la valeur que la logique métier demande. « Code (lecture) » est la valeur que le code de la copie produira selon l'auditeur. Un test « rouge » est attendu quand les deux diffèrent.

| ID | Fonction exportée (fichier) | Entrée minimale | Attendu métier | Code (lecture) |
|---|---|---|---|---|
| T-EU01a | `computeEstimateTotals` (`src/lib/estimate-calculations.ts`) | 1 ligne `{quantity:1, unit_price_ht_cents:1995450, k_fo:1, h_mo:0, k_mo:1, tax_rate_bp:2000}` ; `marginMultiplier:1, marginMode:"fixed", marginTiers:[], discountCents:101, taxRateBp:2000, roundingMode:"none", roundingStepCents:0, isLaborSplitEnabled:false` | `saleTotalCents` 1 995 349 | 1 995 349 (le moteur est juste avant la conversion) |
| T-EU01b | Formule de sauvegarde **non exportée** (`useEstimateEditorState.impl.tsx:1441-1447`) : la reproduire dans le test, ou tester le hook via `renderHook` | `Math.round(101 / 1995450 * 10000)` | intention conservée (101 c ou ratio exact) | **1** |
| T-EU01c | `computeInitialDiscountCents` | version `makeVersion({margin_multiplier:1, discount_bp:1, discount_mode:"simple", discount_steps:null, global_coefficient:1})`, items `[makeSection(), makeLine({quantity:1, unit_price_ht_cents:1995450, labor_role_id:null})]`, `new Map()`, `false`, `undefined`, `undefined`, `{calcEngineVersion:2, marginTiers:[]}` | 101 | **200** |
| T-EU01d | `computeInitialDiscountCents` | idem avec `discount_bp: Math.round(99/1995450*10000)` (= 0) | 99 | **0** (remise supprimée) |
| T-EUHIST | `computeInitialDiscountCents`, puis `computeEstimateTotals` | (1) version `{margin_multiplier:1, discount_bp:1000, …}`, ligne `unit_price_ht_cents:200` → `d` ; (2) `computeEstimateTotals({… marginMultiplier:2, discountCents:d …})` ; (3) `Math.round(d / totals.saleSubtotalCents * 10000)` | (1) 20 ; (2) `[HT, taxCents, ttc]` = `[360, 72, 432]` ; (3) 1 000 pb | (1) 20 ; (2) **`[380, 76, 456]`** ; (3) **500** |
| T-P4a | `computeEstimateTotals` | 1 ligne `unit_price_ht_cents: 9_999_999`, `marginMode:"tiered", marginTiers:[]` | décision métier (prix monotone en fonction du coût) | `appliedMarginMultiplier` 1,6 ; `saleSubtotalCents` 15 999 998 |
| T-P4b | idem | `unit_price_ht_cents: 10_000_000` | ≥ 15 999 998 si le prix doit être monotone | **1,45 ; 14 500 000** |
| T-P4c | `resolveMarginMultiplier` (`src/lib/estimates/margin-tiers.ts`) | `(0, [{threshold_cents:500000, multiplier:1.3, position:0}])` | indéfini, à décider (aucun palier ne couvre 0) | **1,3** |
| T-VENT1 | `computeAllSectionTotals` | items : `s1`, `s2` (sections), `l1` parent `s1`, `l2` parent `s2`, chaque ligne `unit_price_ht_cents:100` ; `marginMultiplier:1, discountCents:1, calcEngineVersion:1, marginMode:"fixed", marginTiers:[], globalCoefficient:1, discountMode:"simple", discountStepsBp:[], taxRateBp:2000, laborRateById:new Map(), isLaborSplitEnabled:false` | Σ `totalHtCents` = 199 | **198** (99 + 99) |
| T-VENT2 | idem avec `calcEngineVersion:2` | idem | 199 | 199 (99 + 100) |
| T-VENT3 | `allocateProRata` (`src/lib/estimate-allocation.ts`) | `(1, [100, 100])` | Σ = 1 | `[1, 0]` |
| T-TVA1 | `computeEstimateBreakdown` | `l1` 10 000 c à `tax_rate_bp:2000`, `l2` 10 000 c à `tax_rate_bp:550`, `taxRateBp:2000, calcEngineVersion:2` (autres paramètres neutres) | `totals.taxCents` 2 550 | 2 550 |
| T-TVA2 | idem avec `calcEngineVersion:1` | idem | 2 550 (multi-taux) | **4 000** |
| T-TVA3 | `computeEstimateBreakdown` | 1 ligne 10 000 c à `tax_rate_bp:2000`, `taxRateBp:1000` (« TVA unique » changée), `calcEngineVersion:2` | 1 000 si « TVA unique » | **2 000** |
| T-TVA4 | `prepareEstimateDocumentData` (`src/components/estimate-document/prepare-estimate-document-data.ts`) | lignes de T-TVA1, `taxRateBp:2000` | libellé multi-taux ou ventilation | `taxLabel` = « 20 % » |
| T-HALF1 | `computeTaxCents` (`src/lib/money.ts`) | `(25, 200)` | à décider : 0 (pair) ou 1 | 1 |
| T-HALF2 | `computeInitialDiscountCents` vs `computeCascadeDiscountCents` | base 105 c ; `discount_bp:1000` simple vs `computeCascadeDiscountCents(105,[1000])` | identiques | **11** vs **10** |
| T-HALF3 | `computeEstimateLineValues` | `{quantity:1.005, unit_price_ht_cents:100, k_fo:1, h_mo:0}`, `marginMultiplier:1` | 101 (décimal demi-supérieur, comme PostgreSQL `numeric`) ou 100 (demi-pair), selon le contrat | 100 (artefact flottant) |
| T-PU | `computeEstimateLineValues` | `{quantity:3, unit_price_ht_cents:1001}`, `marginMultiplier:1.6` | `puHtCents × 3 === saleLineCents`, ou écart documenté | `saleLineCents` 4 805 ; `puHtCents` 1 602 ; ×3 = **4 806** |
| T-CAP | `computeEstimateTotals` | 1 ligne `unit_price_ht_cents: 2_000_000_000`, `marginMultiplier:1.6` | `isCapped: true` ou erreur | **`isCapped: false`**, 2 147 483 647 |
| T-HMO | `computeEstimateLineValues` | `{quantity:10, unit_price_ht_cents:1000, h_mo:0.5, k_mo:1, labor_role_hourly_rate_cents:4500}`, `marginMultiplier:1` | 32 500 si heures/unité (aide) | **12 250** |
| T-MAJ | `normalizeMappedRowsForEstimateCreation` (`src/lib/affaires/import-flow.ts:277`), même forme que `import-flow.test.ts:21-35` | `[{id:"r1", payload:{row_index:1, mapped_row:{designation:"x", quantity:"1", unit_price_ht:"10", labor_hours:"1", h_mo_majoration:"100"}}}]`, contexte `{marginMultiplier:1, defaultTaxRateBp:2000, …}` | `h_mo_majoration` 1 (100 % = neutre, convention de l'export éditeur) | **100** |
| T-HMO-IMP | idem | `quantity:"10"`, `labor_hours:"0,5"` (« h MO par unité ») | `h_mo` 5 | **0,5** |
| T-PASTE | `buildClipboardPreviewRows` (`src/lib/estimates/clipboard.ts:732`), qui appelle `coerceMajorationToCoefficient` (non exportée, `:401-419`) | cellule « 15 » dans une colonne mappée `h_mo_majoration`, en-tête sans « % » | 1,15 ou rejet | **0,15** ; « 8 » donne **8** |
| T-MAJGRID | `parseMajorationPercentToCoefficient` (`src/components/estimates/components/estimate-editor-row/shared.ts:260`) | « 8 » | même résultat que le collage | **0,08** |
| T-TAXSNAP | `computeEstimateBreakdown`, puis `buildEstimateV2SnapshotProjection` (`src/lib/estimate-v2-snapshot.ts`) | 1 ligne 76 063 c à 2 000 pb, `marginMultiplier:1, roundingMode:"down", roundingStepCents:100, calcEngineVersion:2` | `line_tax_cents` 15 213 (TVA réelle), ajustement −76 à part | `line_tax_cents` **15 137** ; `total_tax_cents` 15 137 ; `rounding_adjustment_cents` −76 |
| T-PARSE1 | `parseEuroToCents` (`src/lib/money.ts:109`) | « 1.250 » | même résultat que l'import (à décider) | 125 000 c |
| T-PARSE2 | `parseLocalizedNumber` (`src/lib/affaires/import-flow.ts:172`) | « 1.250 » | même résultat que l'éditeur | **1,25** |
| T-PARSE3 | `parseLocalizedNumberInput` (`src/components/ui-legacy/NumberInput.tsx:16`) | « 1.234,56 » | 1 234,56 ou rejet | **1,234** |
| T-SQLHALF | Hors Vitest : SQL `recalculate_takeoff_estimate_version` contre `computeInitialDiscountCents` | base 12 345 c, `discount_bp` 1 000 | même valeur des deux côtés | TS **1 235** ; SQL **1 234** |
| T-APPR | `checkApprovalRule` (`src/lib/estimates/rules-engine.ts`) | `{actualValue:500000, threshold:500000}` | `violated:false` selon la documentation (strict) | **true** |
| T-MARG | `resolveEffectiveMarginBp` (`src/lib/estimates/effective-margin.ts`) | `{calc_engine_version:2, margin_mode:"fixed", margin_multiplier:1.25, content_revision:1, calc_snapshot_content_revision:null}` | 2 000 (marque) ; et marge nette avec 20 % de remise = 0 | 2 000, sans aucune prise en compte de la remise |
| T-MARGv1 | idem | `{calc_engine_version:1, margin_bp:2500, margin_multiplier:1.05}` | 476 (marque de 1,05) ou 500 (marge de 1,05) | **2 500** (valeur figée de l'assistant) |
| T-Z | `supplierOfferIneligibility` (`src/lib/estimates/supplier-offer-eligibility.ts`) | offre `{unit_price_cents:0, unit:"m", is_active:true, valid_from:"2026-10-01", valid_to:"2027-03-31"}`, input `{currency:"EUR", quantity:10, unit:"ml", today:"2026-10-14"}` | « Prix nul à clarifier » | `null` (éligible) |
| T-UNIT | idem | `unit:"ml"` côté offre, `unit:"m"` côté devis | même décision que le SQL de référence (`lower(btrim)` strict, rejet) | `null` (accepté, « ml » = « m ») |
| T-UNIT2 | idem | `unit:"ML"` côté devis (DPGF), `unit:"ml"` côté offre | éligible (mètre linéaire) | « Unité différente du devis » (« ML » lu comme millilitre) |
| T-UNIT3 | Normaliseur de `src/lib/takeoff/dpgf-compare.ts:147-181` | « m² » contre « m2 » | compatibles | « m » contre « m2 », donc incompatibles |
| T-IDX | Fonction interne de `server.ts:958-962` (non exportée) : reproduire la formule | prix 10 000 c, indice 130 | révision P0 × (a + b·I/I0) | 13 000 c (+30 %) |
| T-V1DUP | Hors fonction pure : SQL `duplicate_estimate_version` | source v1 | décision métier | v1 conservé |

**Remarques.**
- T-EU01b et T-EUHIST (étape 3) reproduisent du code **non exporté** du hook. Il faut soit extraire la conversion dans une fonction pure (recommandé), soit tester `useEstimateEditorState` avec `renderHook` et des clients simulés.
- Pour T-EU01 de bout en bout côté serveur, `calculateEstimateSnapshotForItems` (`version-totals.ts:335`) exige un client Supabase simulé : `labor_roles`, `margin_tiers`, `feature_flags`.

---

## 5. Évaluation des tests existants

**Ce qu'ils figent volontairement.** Oui, ils figent des valeurs reconnues fausses, et le disent.
- `docs/metier/regles-de-calcul.md:43-44` : « les goldens figent volontairement des valeurs fausses ».
- Le dossier `src/lib/estimate-calculations.golden/` contient environ 25 tests marqués « DIVERGENCE ». C'est de la caractérisation : le comportement actuel est photographié pour rendre visible tout changement.

**Points problématiques.**
1. **Tests tautologiques.** `v1.test.ts:1179-1232` recopie la formule de sauvegarde (`Math.round(discountCents / base × 10000)`) au lieu d'appeler le code de production. Il fige « 5 000 c → 442 pb → 5 002 c », c'est-à-dire **le défaut EU01 sous une autre forme**, sans pouvoir détecter sa correction ni sa régression. Son objet « payloadPersiste » est un littéral construit dans le test (`global_coefficient: 1`) qui ne correspond plus au code actuel, puisque `buildVersionDiscountPatch` persiste le coefficient (`src/lib/estimates/editor-items.ts:151-185`).
2. **Commentaires périmés.** « DIVERGENCE #1 : seul server.ts charge la table margin_tiers… les pages … n'envoient aucun barème » (`margin-tiers.test.ts:32-35`). Or les pages de détail, d'impression et le PDF chargent désormais le barème : `src/app/dashboard/estimates/[versionId]/page.tsx:276-287`, `…/print/page.tsx:232-243`, `src/lib/estimates/pdf-generator.tsx:1664-1703`. Le test reste vert parce qu'il appelle le moteur avec `[]`. Il ne décrit plus le produit.
3. **Défauts figés sans ticket ni date de résolution.** On les retrouve dans les goldens :
   - écrêtage silencieux (`margin-tiers.test.ts:125-162`) ;
   - TVA de ligne écrasée en v1 (`v1.test.ts:877`) ;
   - sections ≠ pied en v1 (`v1.test.ts:399-441`) ;
   - remise perdue sur les lignes racine (`:743`) ;
   - perte des pas 2..n en mode simple (`:641`).

   Un golden de caractérisation est légitime avant une refonte. Quatre mois après, il devient une **validation implicite**.
4. **Sémantique métier non testée.**
   - Aucun test ne vérifie qu'`h_mo` correspond à l'aide « par unité », ni la monotonie du prix en fonction du coût en mode paliers.
   - Aucun test sur le changement de taux de version en v2 (D1-07), sur l'inclusivité du seuil d'approbation, sur l'offre à 0 € dans le meilleur prix, ni sur l'aller-retour export/import de la majoration.
   - Les tests unitaires de remise (`estimate-calculations.test.ts:1454-1465`) valident la conversion pb → c sur un cas exact (500 pb sur 10 000 c), jamais l'aller-retour c → pb → c.
5. **Ce qui est solide.**
   - `allocateProRata` fait l'objet d'un test par propriétés sur 10 000 tirages (`estimate-calculations.test.ts:1580`).
   - Les invariants v2 « Σ lignes = Σ sections = pied » sont testés sur 300 devis aléatoires (`estimate-calculations.reconciliation.test.ts:205`).
   - Le rejeu du snapshot v2 est indépendant du contexte vivant (`golden/v2.test.ts`).
   - L'autoliquidation a 6 cas dédiés (`estimate-calculations.test.ts:1615-1700`).

   Ces tests vérifient des **invariants**, pas des valeurs métier.
6. **Absences.** Les tests SQL cités en référence (`supabase/tests/database/…`) ne sont pas dans la copie. L'oracle financier EU01, EU02 et EUHIST n'est pas joint.

**Recommandation.**
- Convertir chaque « DIVERGENCE » en l'une de deux catégories :
  - un test d'**exigence**, rouge tant que le défaut existe, avec une référence de décision ;
  - une **règle acceptée**, documentée dans un référentiel validé par un responsable nommé.
- Supprimer les tests qui recopient le code de production.

---

## 6. Dépôt vivant : écarts constatés (en cours, non audité)

La comparaison porte sur les fichiers de R et ceux de `C:\Users\maxim\Projects\miaouffrage`. Elle n'a été faite qu'en lecture. Aucune de ces modifications n'a été qualifiée.

- **Migration `20261014114943_estimate_fixed_discount_and_template_parent_integrity.sql`**, absente de R :
  - ajoute `discount_amount_cents integer null` sur `estimate_versions` et `estimate_templates`, avec `CHECK` (≥ 0, mode simple, aucun palier) ;
  - redéfinit `save_estimate_settings_atomic` ;
  - affiche « no backfill ».
- **`estimate-calculations.ts`** :
  - `computeInitialDiscountCents` renvoie `discount_amount_cents` s'il est défini ; `computeStoredDiscountCents` et `computeReadOnlyTotals` le plafonnent à l'assiette ;
  - le coût et la vente de ligne passent d'un `Math.round` flottant à une arithmétique décimale exacte (`BigInt`) au demi-supérieur, alignée sur PostgreSQL `numeric`. **Cela modifie des montants en cas limite (T-HALF3).** Sur des versions déjà envoyées, l'effet doit être neutralisé par les snapshots v2. Pour v1, le point est à vérifier ;
  - `isCapped` est propagé ligne par ligne, ce qui répond à D1-03.
- **Éditeur et panneau** :
  - la sauvegarde ne recalcule plus `discount_bp` si aucun montant fixe n'est saisi (`settingsSnapshot.discount_bp ?? versionSnapshot.discount_bp`), ce qui répond à EUHIST ;
  - mention « Remise historique de X % : elle suit le montant du devis » ;
  - une saisie fixe le montant (`discount_amount_cents`).
- **`version-totals.ts`** : valide la remise fixe et expose `fixed_discount {requested, base, applied}`.
- **`rules-engine.ts`** : modifié (81 lignes de différence), probablement pour `max_discount` sur une preuve exacte. Non lu en détail.

- **Autres fichiers modifiés pour la remise fixe**, non lus en détail : `prepare-estimate-document-data.ts` (nouveau chemin v1 figé), `gating.ts` (preuve de remise fixe), `direction/alerts.ts` (seuil de 800 pb évalué sur la remise fixe exacte).

**Constats non touchés par le delta.**
- Fichiers identiques à R : `margin-tiers.ts`, `effective-margin.ts`, `money.ts`, `estimate-allocation.ts`, `ColumnHeaderHelp.tsx`, `import-flow.ts`, `supplier-offer-eligibility.ts`, `clipboard.ts` et la migration `20261014070453`. Les constats D1-04, D1-05, D1-06, D1-08, D1-09, D1-13, D1-15 et D1-19 restent donc intacts dans le dépôt vivant.
- D1-07 : la nouvelle définition de `save_estimate_settings_atomic` conserve `tax_rate_bp=case when version_row.calc_engine_version=1 then projected.tax_rate_bp else i.tax_rate_bp end` (`20261014114943…sql:258`, dépôt vivant). La TVA v2 n'est pas traitée.
- D1-11 : la partie flottante du coût et de la vente de ligne est corrigée. Les autres écarts subsistent : PU × q, remise simple au demi supérieur contre cascade au demi pair, divergence SQL du métré.

---

## 7. Décisions métier à prendre

Ces décisions ne relèvent pas de l'auditeur.

1. Heures de MO : unitaires ou totales (D1-06).
2. Paliers de marge : marche, progressif ou lissé ; barème par défaut à conserver ou non (D1-04).
3. Vocabulaire et unité des règles de marge : marge ou marque, avant ou après remise (D1-05, D1-13).
4. Remise : intention en montant ou en pourcentage, et comportement quand l'assiette varie (D1-01, D1-02).
5. TVA : taux par ligne éditable, taux unique propagé, ventilation sur le document (D1-07) ; traitement fiscal de l'arrondi commercial (D1-12), à valider par un expert-comptable.
6. Contrat d'arrondi unique, grandeur par grandeur (D1-11, D1-12), et parseur numérique unique par grandeur (D1-19).
7. Seuil d'approbation inclusif ou strict, et valeur par défaut (D1-14).
8. Offre à 0 € : exclusion sur tous les chemins (D1-09).
9. Unités, conversions et conditionnement (D1-08) ; unité de la majoration MO (D1-15) ; pertes et rendements (D1-16) ; indices (D1-17).
10. Sort du moteur v1 à la duplication (D1-10).

Chaque règle retenue doit recevoir une source, un validateur nommé et un test d'exigence.
