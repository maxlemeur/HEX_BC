# Copies vers une v3 (sous-lot 2.8b)

Statut : **vert** (18/10/2026). Branche `lot2/2.8b-copies-into-v3`, empilée sur `lot2/2.10a-createurs-v3`
(`216ac4d0`, outil commun de normalisation des imports dans `src/lib/affaires/`). Source : plan vers 2.10 (§3
« 2.8b », décisions D-b et D-e du 18/10/2026), inventaire des écarts v3 (A5 à A8). Une migration depuis la revue
(`20261018180306`, §6) ; `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` inchangés.

## 1. Défaillances observables (écrites avant le code)

| # | Défaillance | Parcours |
|---|---|---|
| C1 | « Importer le DPGF source » sur un brouillon v3 : insertion directe, refusée par le garde SQL (400 générique) | IO10 |
| C2 | Une fois ouvert, DPGF normalisé en v2 (unité dans `description`, statut chiffré) ou aux coefficients de la politique au lieu de ceux du brouillon ; provenance perdue | IO10 |
| C3 | Dupliquer une section d'une v3, sur place ou vers une autre v3 : 409 `ESTIMATE_ENGINE_UNAVAILABLE` | IO11 |
| C4 | Copie qui perd `unit_code`, le statut ou les h/u, multiplie les heures par Q deux fois | IO07, IO11 |
| C5 | Section v1/v2 entrée dans une v3 sans la règle P-12 ni rapport ; section v3 entrée dans une v1/v2 (D-e) | IO07 |
| C6 | Conversion ligne ↔ section proposée sur une v3, puis message générique (D-b) | IO12 |
| C7 | Copie v1/v2 → v1/v2 dont les montants changent | IO11 (garde) |
| C8 | Copie au-delà de la limite écrite en partie, en plusieurs lots, ou hors du délai de 8 s (1 000 opérations, §7) | IO13 |
| C9 | Élément hors des bornes de l'écrivain (titre de plus de 500 caractères) : 400 générique « Payload invalide. » (revue) | IO13 |
| C10 | Conversion P-12 d'une copie v1/v2 → v3 rendue par l'API mais jamais montrée (revue) | IO07 |
| C11 | `source_metadata` des éléments copiés perdue (`_timax_provenance`, `sourceDocumentId`, import) (revue) | IO10, IO11 |
| C12 | Motif de la conversion désactivée invisible : l'entrée désactivée du menu ne reçoit pas le survol (revue) | IO12 |
| C13 | v3 créée depuis le DPGF lié : source lue sans pages, 1 000 premières lignes gardées en silence (revue Codex, code du 2.10a) | IO14 |
| C14 | Ligne du DPGF lié importée dans une v3 avec le numéro de ligne du classeur pour page source (seconde revue Codex, G1) | IO10 |
| C15 | Provenance forgée d'une autre entreprise écrite par un appel direct de `commit_estimate_batch` (G2) | pgTAP (appel direct) |
| C16 | Source de plus de 500 éléments modifiée entre deux pages de lecture : copie mêlant deux états (G3) | aucun parcours (course) |
| C17 | Reçu de l'écrivain au-delà de 2 Mio : 400 générique, ou copie de 1 000 lignes refusée à tort par une estimation (§7) | IO13 |
| C18 | Lot de créations seules appelé directement : section ou ligne rangée sous des ancêtres stockés au-delà de `max_section_depth` (revue interne, §8) | pgTAP (appel direct) |
| C19 | Copie sous 1 Mio en JSON compact mais au-delà en texte jsonb mesuré par la base : 400 générique au lieu du 413 nommé (revue interne, §8) | IO13 |

## 2. Rouges conservés

- `0a8da704` (IO07 réécrit, IO10, IO11, IO12), boucle Army `2026-10-18T13-00-21-058Z-dev-loop`, itération 1,
  4 échecs pour la bonne raison : IO07 et IO11 en 409 `ESTIMATE_ENGINE_UNAVAILABLE`, IO10 en 400 `BAD_REQUEST`,
  IO12 en 400 `BAD_REQUEST` avec les menus actifs et sans motif.
- IO13, ajouté en phase verte : itération 2 de `2026-10-18T14-41-57-323Z-dev-loop`, rouge sur le code de copie
  sans lecture paginée. La copie de 1 001 éléments répond 201 et écrit une partie de la section : la lecture
  PostgREST s'arrête à `max_rows = 1000`. C'est la défaillance C8, trouvée par ce parcours.
- Correction d'un défaut du parcours rouge : IO10 lisait `createdSectionId`, alors que l'API rend
  `created_section_id` (snake_case, comme toutes ses routes).

## 3. Correction

- **Écriture.** Une copie vers une v3 passe par l'écrivain de lot v3. `v3-section-copy.ts` construit les
  opérations, puis `executeEstimateBatch` / `commit_estimate_batch` les écrit en un seul lot, avec le jeton lu
  au départ et le verrou de la page. Les identités créées sont passées par `createdIds`, déjà acceptées par la
  préparation. Au-delà de 1 000 opérations ou de 1 Mio (§7) : refus 413 `ESTIMATE_V3_COPY_TOO_LARGE` avant toute
  écriture, qui renvoie vers l'import de l'affaire ; reçu de l'écrivain au-delà de 2 Mio : même 413, refusé par la base
  dans la transaction, rien d'écrit. Une opération refusée par l'écrivain est rendue avec son
  code et l'élément nommé (rôle MO d'un autre propriétaire, unité inconnue, profondeur, position).
- **Lecture complète.** Vers une v3, les lignes de la source et de la cible (`readAllEstimateItems`) et les lignes
  du DPGF lié sont lues par pages ; depuis la lecture complète de `main` (`33c7031b`), le DPGF lié l'est pour toutes
  les politiques. La source d'une copie est relue après la dernière page (§7, G3).
- **A5.** Lignes normalisées par `normalizeMappedRowsForEstimateCreation` avec `engine: 3` et les coefficients du
  brouillon : unité du référentiel, statut à 0 €. Les paramètres du classeur imposent l'aperçu de l'affaire, refus
  nommé existant. La provenance est gardée : `source_provider = dpgf`, `source_file_name`, `source_page`.
- **A6, A7.**
  - v3 → v3 : saisies v3 copiées ; `source_job_id` gardé seulement dans la même version.
  - v1/v2 → v3 : `templateLineHoursPerUnitForV3` (P-12, miroir de M6), unité par le référentiel sur
    `description`, rapport `converted_lines`. Q = 0 avec des heures : refus qui nomme la ligne.
  - v3 → v1/v2 : 409 `ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL`, avant toute écriture (D-e).
- **A8.** `PATCH /items` qui change `item_type` sur une v3 : 409 `ESTIMATE_V3_ITEM_CONVERSION_UNAVAILABLE`.
  Dans l'éditeur v3, les trois entrées « Convertir » sont désactivées avec ce motif : le menu de ligne, le menu
  contextuel de ligne et le menu de section.
- OpenAPI : descriptions des quatre routes, `openapi.json` régénéré.

## 4. Preuves

| Contrôle | Résultat |
|---|---|
| Boucle Army, itération 3, `^(IO(0[0-9]\|1[0-3]) \|V3E13 \|OPTIMA )` | 16/16 verts (IO01, IO03 à IO13, V3E13, 3 OPTIMA v2) ; IO13 avec sa limite : itération 4 |
| IO10 (interface) | « 4 lignes importées » ; tube 15 000, collier 1 500, PM et HL à 0 ; PU 1 500 / 500 à 1,25 ; total 16 500 (API = SQL) ; provenance lignes 1 à 4 |
| IO07 | v2 → v3 : tube 0,5 h/u, collier 0,0003 h/u (1 h → 0,9 h listé), tube 37,00 € × 10 ; v3 → v3 identique ; v3 → v2 refusé deux fois, rien d'écrit |
| IO11 (sur place par l'interface, vers une v3 par l'API) | sous-arbre identique, 5 éléments, total doublé (API = SQL) ; garde v2 → v2 : mêmes montants, aucun rapport |
| IO12 | 409 nommé deux fois ; menus `aria-disabled` avec le motif ; rien d'écrit |
| IO13 (revue) | 101 opérations : 413 `ESTIMATE_V3_COPY_TOO_LARGE`, message vers l'affaire, rien d'écrit ; titre de 501 caractères : 400 `ESTIMATE_V3_COPY_ITEM_INVALID` qui nomme la ligne ; à la limite (1 section + 99 lignes = 100 opérations) : 201, 99 lignes à 1,30 €, total 12 870 (API = SQL) |
| Run qualifiant et `verify:pr` | voir la description de la PR |

## 5. Limites

- La copie v1/v2 → v1/v2 lit toujours ses lignes sans pages et tronque en silence au-delà de 1 000 lignes : ce
  défaut existait avant ce lot et sort de son périmètre. Le DPGF lié, lui, est lu en entier pour toutes les politiques
  depuis `33c7031b` (`main`). Le DPGF lié importé dans une v1/v2 existante prend encore le numéro de ligne du classeur
  pour page source (`server.ts`, chemin v1/v2 de l'import, `28ccc857`) : même défaut que G1, antérieur, hors périmètre.
- La copie vers une autre version est prouvée par l'API ; son avis de conversion (toast avant la redirection) n'est
  piloté par aucun parcours. L'import de sections est piloté par l'éditeur dans IO07.
- Une copie vers une v3 est bornée à 1 000 opérations et par le reçu de l'écrivain (2 Mio, sans la provenance) :
  1 000 lignes y tiennent avec des libellés d'environ 85 caractères au plus (§7). Au-delà, refus nommé : copier les
  sous-sections une à une, ou importer depuis l'affaire.
- Le DPGF lié importé dans une v2 ne garde pas non plus la `source_metadata` de ses lignes : comportement v1/v2
  inchangé, hors périmètre.
- Ne sont pas couverts par un parcours : rôle MO d'un autre propriétaire, profondeur dépassée, jeton périmé et
  cible verrouillée par un autre utilisateur. Ces refus nommés viennent de la préparation du lot et du verrou,
  déjà prouvés au 2.5.
- La conversion ligne ↔ section par l'écrivain de lot reste à faire (D-b).
- Reçu de l'écrivain borné à 2 Mio : la base refuse un reçu plus gros avant la fin de la transaction, rien n'est
  écrit, désormais par son nom (`ESTIMATE_BATCH_RECEIPT_TOO_LARGE`, 413 sur la route de lot) ; la copie le rend par
  son 413 nommé (§7). L'estimation du reçu avant écriture (§6) est retirée : elle refusait 1 000 lignes qui tiennent.

## 6. Revue (18/10/2026)

| Constat | Disposition |
|---|---|
| CI rouge, shard 3 | Parcours IO13 identifié (preuve `2026-10-18T15-07-22-063Z-critical` du run 39138950745) : copie de 1 000 opérations en 503 `BATCH_OUTCOME_UNKNOWN` après 9,7 s, délai de 8 s des rôles de l'API. Corrigé par les deux lignes suivantes |
| 1 000 opérations hors budget | Mesuré (L7, [budget](large-estimate-statement-budget.md#copy-into-a-v3-28b-l7)) : 10–15 s ; 100 opérations dans une v3 de 1 021 éléments : 4,1 s, la projection v3 réécrivait chaque ligne. La première version de la migration (alors `20261018160000`) ne réécrit que les montants qui changent (282 ms) ; limite ramenée à 100 opérations, taille des lots de l'éditeur. Écart au plan (1 000) : le délai de la CI l'imposait ; remplacé par la décision du propriétaire (§7, 1 000 opérations) |
| Rapport P-12 non montré | `converted_lines` lu par le client ; résumé de l'import de sections et avis de la copie vers une autre version |
| `source_metadata` perdue | `p_created_ids` porte la `source_metadata` de l'élément copié (côté serveur seulement, hors requête canonique et reçu rejoué) ; A5 : métadonnées de la ligne mappée et `import_id` |
| Reçu > 2 Mio « écrit puis inconnu » | Infirmé : la base refuse le reçu avant validation, rien n'est écrit (mesure : 1 000 opérations avec provenance → `ESTIMATE_BATCH_INVALID_INPUT`). Réel : un refus générique. Corrigé par l'estimation du reçu avant écriture (413 nommé) |
| Motif invisible (menu) | Motif écrit dans les trois entrées désactivées |
| Titre > 500 caractères | Bornes de l'écrivain vérifiées avant écriture : 400 `ESTIMATE_V3_COPY_ITEM_INVALID` qui nomme l'élément |
| Codex P1 : création v3 depuis le DPGF lié tronquée | Lecture par pages sous une politique 3 (option ajoutée par ce lot) ; v1/v2 inchangé |
| Codex P2 ×2 (`source_metadata`, `converted_lines`) | Mêmes constats que ci-dessus |

- **Rouges** : boucle `2026-10-18T15-36-53-287Z-dev-loop`, itération 1, 5 sur 5 pour la bonne raison (IO07 résumé
  sans conversion, IO10 et IO11 métadonnées vides, IO12 motif non visible, IO13 101 opérations en 201).
- **Verts** : boucle `2026-10-18T15-53-18-287Z-dev-loop`, itération 1, 5 sur 5 (avec la migration) ; pgTAP de la boucle :
  copie de 100 opérations dans la v3 de 1 021 éléments, 0 ligne réécrite.
- **IO14** : rouge à l'itération 1 de `2026-10-18T16-13-41-259Z-dev-loop` (1 000 lignes sur 1 001, total 1 300,00 €),
  vert à l'itération 2 (1 001 lignes, 1 301,30 €, API = SQL).
- **IO13 révisé** : 101 opérations → 413 ; titre de 501 caractères → 400 nommé ; à la limite (1 section + 99 lignes
  de 400 caractères) → 201, 99 lignes, total 12 870 (API = SQL).

## 7. Seconde revue Codex et décision du propriétaire (18/10/2026, soir)

**Décision du propriétaire (18 h 55)** : « on accepte jusqu'à 3,5 s pour 1 000 lignes ». Exception à la règle des
330 ms d'AGENTS.md pour cette seule instruction : une copie vers une v3 remonte à **1 000 opérations**, médiane locale
au plus 3,5 s pour 1 000 lignes, sous le délai de 8 s des rôles de l'API en CI (IO13), sans délai relevé ni reprise.

| Constat | Disposition |
|---|---|
| G1 (`v3-section-copy.ts:250`) : page source = numéro de ligne du classeur | Réel. `source_page: line.sourcePage`, comme le sérialiseur commun (`import-flow-server.ts:348`). Le chemin v1/v2 de l'import (`server.ts`, `28ccc857`) garde le défaut : antérieur, hors périmètre (§5) |
| G2 (migration, `commit_estimate_batch` ouverte à `authenticated`) : provenance forgée | Réel. La base refuse par son nom (`ESTIMATE_BATCH_SOURCE_METADATA_FOREIGN`, 400, rien d'écrit) une provenance qui désigne un import, un mapping, une ligne mappée ou un document source d'une autre entreprise que la version cible. Limite acceptée (propriétaire : sécurité dépriorisée sur cette base de développement) : un membre peut étiqueter ses propres lignes avec des références de sa propre entreprise ; une autre affaire de la même entreprise est admise, puisque l'import de sections copie depuis toute version de l'entreprise |
| G3 (`server.ts:4094`) : source de plus de 500 éléments lue en plusieurs pages sans revérifier son jeton | Réel. `readAllItemsForV3Copy` relit la version (`assertEstimateVersionUnchanged` : jeton et révision de contenu) après la dernière page, source comme cible ; changée : 409 `VERSION_CONFLICT`, rien n'est copié. Aucun parcours ne force une écriture entre deux pages : course non reproduite, assistant existant réutilisé |
| Limite de 100 opérations | Remontée à 1 000 (décision ci-dessus). La migration rejoue en une passe les effets par ligne d'un lot de créations seules (rejeu M6b), saute les recherches de position et de titre par défaut quand l'opération les nomme, accumule résultats et opérations canoniques dans des tableaux et ne renvoie plus dans le reçu la `source_metadata` reçue par `p_created_ids` |
| Reçu de l'écrivain au-delà de 2 Mio | L'estimation avant écriture (§6) refusait à tort 1 000 lignes qui tiennent (≈ 2,04 Mo réels) ; retirée. La base refuse désormais un reçu trop gros par son nom (`ESTIMATE_BATCH_RECEIPT_TOO_LARGE`, 413 sur la route de lot), la copie le rend par son 413 nommé ; rien n'est écrit dans les deux cas |
| `main` a bougé (`33c7031b`, lecture complète) | Fusionné (`25cd083b`) : conflits `server.ts` (lecture du DPGF lié : `readAllRows` de `main` pour toutes les politiques, l'option `paginate` du 2.8b retirée) et manifeste. `20261018170351` ne redéfinit pas `commit_estimate_batch` (seuls `20261012030743` et `20261017162000` le définissent sur `main`) : il ajoute `insert_estimate_template_with_receipt` et `insert_estimate_assembly_with_receipt`, que cette migration ne touche pas. Migration réhorodatée `20261018160000` → `20261018172303` (`supabase:migrations:restamp`, garde Git et manifeste passés), puis `20261018180306` (§8) |

Preuves (clone WSL `~/miaouffrage-l2-28b`, hôte partagé chargé, `E2E_ARMY_WORKERS=2`) :

- **Rouges pgTAP**, `25cd083b` (fusion, ancienne migration) :
  `node --import tsx scripts/run-local-supabase-ci.ts --files estimate-calc-engine-v3-guards.test.sql,estimate-large-v3-scale.test.sql --skip-rls`,
  2 + 2 échecs attendus : provenance étrangère écrite (`ok:true`, ×5) et renvoyée par le reçu ; 1 000 opérations avec
  provenance refusées (`22023 ESTIMATE_BATCH_INVALID_INPUT`, reçu > 2 Mio). Journal
  `~/l2-28b-evidence/pgtap-red-25cd083b-20261018T172109Z.log`.
- **Verts pgTAP et budget**, même commande avec `DB_CI_STATEMENT_BUDGET=enforce` et la nouvelle migration : 70/70 ;
  copie de 1 000 opérations avec provenance dans la v3 de 1 021 éléments, **médiane 730,2 ms** sur 7 (697,9–831,6),
  dans la v3 de 8 éléments 665,1 ms, 0 ligne réécrite, reçu 2 040 397 octets ; seul L2 (création, 388,8 ms contre
  330 ms) échoue sur cet hôte non calibré. Journal `~/l2-28b-evidence/pgtap-green-budget-25cd083b-20261018T172328Z.log`.
- **pgTAP complet et matrice RLS** : verts au démarrage de la boucle `.e2e/army/ci/2026-10-18T17-28-49-050Z-dev-loop`.
- **Rouges des parcours**, itération 1 de cette boucle (nouvelle migration, ancien code applicatif) : IO10 pages
  `[1, 2, 3, 4]` au lieu de `[null, 7, null, null]` ; IO13 à la limite (999 lignes) en 413 au lieu de 201.
- **Verts**, itération 2 : IO10 et IO13 (3/3 avec le setup). IO13 : 1 001 opérations → 413 ; titre de 501
  caractères → 400 nommé ; 999 lignes de 200 caractères → 413 nommé par la base, rien d'écrit ; à la limite (1 section
  + 999 lignes avec provenance) → 201, 999 lignes, provenance gardée sur les 999, total 129 870 (API = SQL), route
  entière en 1 121 ms.
- **Consommateurs de l'écrivain de lot**, itération 3 (`--files` : `large-row-completeness` du propriétaire,
  `engine-v3-import-optima`, `engine-v3-editor-actions`, `engine-v3-persistence`, `numeric-entry-v3`, `numeric-entry`,
  `engine-v3-creators`) : 44/44 verts en 343,5 s.

## 8. Revue interne avant l'envoi, fusion de `main` (18/10/2026, 20 h)

| Constat | Disposition |
|---|---|
| Profondeur d'un lot de créations seules (moyen, intégrité) | Réel. Le rejeu M6b auquel ce lot confie la profondeur ne remontait les parents que jusqu'au nombre d'éléments créés : suffisant pour une nouvelle version (tous les ancêtres dans la charge), pas sous des ancêtres stockés. Un appel direct rangeait une section au niveau 4, ou une ligne sous elle (`max_section_depth` 3). La migration redéfinit le rejeu avec la remontée bornée par `greatest(nombre créé, max_section_depth)` : chaque ancêtre jusqu'à `max_section_depth + 1` est vu ; la création M6b garde la même remontée. Refus : `22023 ESTIMATE_BATCH_INVALID_INPUT`, rien d'écrit. L'application n'y est pas exposée (la préparation du lot refuse avant l'appel) |
| Marge de taille de la copie (faible) | Réel. La copie mesurait ses opérations en JSON compact avec 4 Kio de marge ; la base mesure leur texte jsonb (`": "` et `", "`, environ 37 Ko de plus pour 1 000 lignes). Entre les deux : 400 générique. La copie mesure désormais comme la base (`jsonbTextBytes`), la marge de 4 Kio reste pour l'écriture des nombres : 413 `ESTIMATE_V3_COPY_TOO_LARGE` nommé, rien d'écrit |
| Documentation réhorodatée mécaniquement (faible) | Les lignes historiques (§6, budget L7) nomment la première version de la migration (alors `20261018160000`) et renvoient à la décision du §7 |
| `main` a bougé (#60, #62, #65) | Fusionné : conflits `engine-v3-import-optima.e2e.ts` (deux imports gardés) et manifeste. `20261018172935` (ordre du contrat client 2) ne touche ni l'écrivain de lot ni le rejeu ; migration réhorodatée `20261018172303` → `20261018180306` (`supabase:migrations:restamp --base origin/main`, garde Git et manifeste passés) |

Preuves (clone WSL `~/miaouffrage-l2-28b`, `E2E_ARMY_WORKERS=2`) :

- **Rouge pgTAP** (profondeur), `dc476df1` (ancienne migration) :
  `node --import tsx scripts/run-local-supabase-ci.ts --files estimate-calc-engine-v3-guards.test.sql --skip-rls`,
  test 50 en échec pour la bonne raison : section sous le niveau 3 et ligne sous un niveau 4 écrites (`ok:true 8` ×4).
  Journal `~/l2-28b-evidence/pgtap-red-depth-dc476df1-20261018T180733Z.log`.
- **pgTAP complet et matrice RLS** : verts au démarrage de la boucle `.e2e/army/ci/2026-10-18T18-09-17-723Z-dev-loop`
  (`6913164c`, migration corrigée), test 50 compris.
- **Rouge IO13** (taille jsonb), itération 1 (`6913164c`, ancien code de copie) : `[400, false,
  "ESTIMATE_BATCH_INVALID_INPUT"]`, sans renvoi vers l'affaire, rien d'écrit.
- **Verts**, itération 2 (`cc92f1e5`, `--files` `engine-v3-import-optima`, `large-row-completeness` du propriétaire,
  `engine-v3-editor-actions`, `engine-v3-creators`) : 45/45 en 360 s. IO13 : bande jsonb → 413 nommé, rien d'écrit ;
  à la limite → 201, 999 lignes avec provenance, total 129 870 (API = SQL), route entière 4 032 ms sous la charge de
  deux travailleurs (non affirmé) ; IO14 : 1 001 lignes, 130 130 (API = SQL).
