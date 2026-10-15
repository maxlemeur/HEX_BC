# Prérequis locaux de la revue GEN

## Échec réel et frontière définie avant correction

Les trois scénarios GEN01 du candidat 6 échouent pendant la préparation de `estimate_generated_ouvrage_drafts`, avec SQLSTATE 40001. Le garde `private.guard_generated_ouvrage_write` est volontairement INVOKER : un client service-role sans `auth.uid()` ne peut pas se substituer au créateur. Les sous-détails refusent aussi les écritures directes de ce rôle. Ce résultat n'est pas un défaut d'autorisation produit à contourner.

Les campagnes locales d'ouvrages composés préparent déjà leurs propositions avec `componentsRecords` et une transaction PostgreSQL exécutée par le propriétaire de la base native (`seed-generated-components.py`). GEN01 reprend ce contrat pour les sept tables de propositions uniquement. Aucun résultat d'application, snapshot final, reçu, décision humaine ou modification de privilège ne doit être préparé.

Avant SQL, le compte ordinaire vérifie par RLS la version créée par le parcours, son projet ARMY et son tenant. Le transport doit être explicitement local : URL HTTP loopback Supabase autorisée et URL PostgreSQL loopback, base et utilisateur postgres, chemin absolu psql fourni par le runtime local. Le mot de passe passe seulement dans l'environnement du sous-processus ; les arguments, preuves et sorties publiques ne contiennent aucune URL PostgreSQL ni secret.

Dans une transaction unique, la préparation vérifie encore le propriétaire SQL, l'identité du compte/projet/version/tenant, verrouille la version, refuse toute identité déjà présente, insère seulement les propositions exactes et relit leurs champs. Le devis et ses lignes doivent rester identiques. Une erreur annule la transaction ; aucun retry ni upsert ne dissimule une issue ambiguë. Une relecture distincte par le compte ordinaire vérifie ensuite les mêmes propositions via RLS.

## Recettes et preuve

Les trois scénarios navigateur existants restent la preuve primaire : rejet total sans modification du devis, validation humaine puis insertion dans « À classer », et sous-détail avec provenance, DS, prix cible, heures/rôle/mapping et affichage desktop/mobile. Le port ne change aucun de ces oracles. Les propositions sont pending/pending_review ; leurs composants manuels synthétiques ne sont pas des sous-détails déjà validés.

Aucun test isolé supplémentaire n'est ajouté : l'échec réel est celui de la préparation E2E et les scénarios exercent directement sa consommation. La recette existante de conservation SQL constitue la référence du mécanisme ; la nouvelle préparation doit être exécutée par le prochain candidat et ne se déduit pas d'une collecte ou d'un typage réussi.

Variables consommées par les fixtures Node : `E2E_ARMY_LOCAL_DB_URL`, `E2E_ARMY_LOCAL_PSQL`, et, pour un parent Windows ciblant son runtime WSL, `E2E_ARMY_LOCAL_PSQL_WSL_DISTRIBUTION`. Le bootstrap CI fournit ses propres coordonnées éphémères, jamais des variables PostgreSQL ambiantes. Elles restent absentes du build, du serveur Next, du JavaScript de page et des preuves expurgées. Le SDK peut transmettre l'environnement du worker au processus Chromium ; l'environnement système de ce processus n'est donc pas une frontière d'isolation garantie.

## Candidate 9 : attendre le ruban avant la reprise

Plan écrit avant modification du helper. Les trois préparations SQL et leurs
relectures RLS passent sur Linux candidate 9. Après le rechargement, la recette
échoue en cherchant le bouton « Insérer » ; les captures montrent ensuite
l'onglet « Chiffrage » sélectionné et l'onglet « Insérer » disponible. Le helper
teste `tab.isVisible()` immédiatement après reload : quand le ruban n'est pas
encore rendu, il saute le clic d'onglet puis attend un bouton situé dans le
panneau caché. Attendre plus longtemps ce bouton ne peut pas ouvrir son onglet.

La reprise attendra le tableau et le ruban, puis sélectionnera explicitement
l'onglet « Insérer » avant son menu. Elle vérifiera l'onglet sélectionné et la
commande activée. Les trois recettes gardent exactement la revue, le rejet,
l'insertion, les métadonnées financières et la provenance après reload/mobile.
Aucune proposition n'est validée en fixture et aucun appel fournisseur ajouté.
L'échec est directement observable dans le navigateur : aucun test isolé ajouté.

La sélection sans lot du cas fallback est également conservée avec le contrat
SDK documenté `selectOption({ value: "" })` : la chaîne seule désigne un libellé,
alors que la recette historique choisissait bien la valeur vide. Ce n'est pas
une nouvelle défaillance produit ni une réussite observée ; l'oracle final
« À classer » demeure requis.

Les captures `13f7f5a39dca7011`, `293e4db70fb14cdc` et `23ea3d52bbda360f`
sont conservées sous
`.codex-tmp/army-ci-migration-20261015/candidate-9-evidence/full/results/` ;
les sources avant correction sont copiées sous
`.codex-tmp/army-migration-20261015/gen-teamb-candidate9-before/`.

## Candidate 12 : base de main-d'œuvre exacte

Plan écrit avant correction de la fixture. Le rejet GEN01 passe ; fallback et
provenance valident réellement le sous-détail puis reçoivent
`EST383_COST_PROJECTION_INEXACT`. La capture conserve le dialogue et explique
qu'aucun ouvrage n'a été ajouté. Les composants revus restent 4 000 centimes
de fourniture et 4 000 centimes pour une heure de main-d'œuvre, soit un DS de
8 000 centimes. Le garde de projection exacte est correct et reste inchangé.

La recette utilisait n'importe quel rôle actif, alors que le serveur choisit
le premier rôle actif du propriétaire et du tenant, trié par position puis ID.
La création de devis prépare des rôles BTP à taux nul ; SET-C ajoute ses propres
rôles Atelier/Chantier à 3 000/5 000 centimes en fin de liste. Leur création API
utilise la position maximale + 1 et leurs assertions utilisent leurs propres
ID. Aucun de ces taux ni oracle ne doit être modifié.

Le bootstrap de la base CI éphémère créera un rôle dédié à 4 000 centimes,
position 0, uniquement pour le compte et tenant qu'il vient de créer. Il
vérifiera le rôle préféré avec le tri exact du serveur et conservera ID,
propriétaire, tenant, taux et position dans ses identités. GEN relira le même
prérequis via le client ordinaire avant toute proposition et l'enregistrera
dans sa preuve. Aucun rôle existant, notamment celui du compte Windows, ne
sera corrigé ou remplacé ; un prérequis incompatible échouera explicitement.
Les DS, heures, validation humaine et oracles d'insertion/provenance restent.

Le replay réel de GEN01 constitue la validation ; aucune isolation ajoutée.
Preuve rouge : `candidate-12-evidence/full`, archive
`2026-10-15T19-36-50-038Z`. Sources avant correction :
`.codex-tmp/army-migration-20261015/gen-teamb-candidate12-before/`.

## Candidate 13 : résumé de provenance enrichi et accès aux détails

Plan écrit avant correction du port. Le focus `01a14130-3763-78db-b0b2-533a9eabe167`
valide rejet et fallback ; provenance insère bien l'ouvrage puis échoue sur
`subdetail_summary.ds_cents`, absent. Le serveur enrichit les lignes depuis
le snapshot dont le type `GeneratedOuvrageSubdetailSummary` expose `dsCents`
et `indicativeTargetPriceCents`. L'artefact fallback du même focus contient
8 000 centimes pour chacun, une heure et le rôle CI attendu. Le parcours
historique acceptait déjà ces noms ; le port avait conservé seulement les
noms snake_case du résumé intermédiaire. Il lira le type enrichi actuel,
sans valeur par défaut ni réduction des seuils : DS exact 8 000, prix cible
au moins 8 000, heures positives et rôle/mapping présents.

La capture montre aussi que la provenance vit désormais dans « Détails de la
ligne ». Le parcours existant d'ouvrages composés ouvre ce menu par l'ID de la
ligne. GEN fera de même après chaque reload desktop/mobile et vérifiera le
même bouton « Afficher la provenance IA » dans ce menu unique. Aucune donnée
ni décision n'est préparée pour satisfaire ces assertions. Le résultat brut
de l'insertion sera conservé avant les assertions financières pour rendre un
prochain échec inspectable. Aucun changement produit ni test isolé requis.

Preuve : `candidate-13-evidence/focus`, archive `2026-10-15T20-10-41-047Z`.
Snapshot avant correction :
`.codex-tmp/army-migration-20261015/gen-us44-candidate13-before/`.

La revue indépendante confirme que le reload à 390 px rétablit la liste
compacte et masque la grille. Avant le même contrôle de provenance, la recette
ouvrira donc « Affichage », puis « Tableau complet — Contrôle détaillé » dans
« Options d’affichage », comme le parcours mobile existant. La grille et le
menu seront rendus par ces actions réelles, sans forçage CSS ni état injecté.
