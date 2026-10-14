# PRICE-02 — Régression SQL du prix de référence

## Échecs définis avant implémentation

- Une offre fournisseur à zéro annule toute moyenne positive alors qu'elle doit être exclue et rester à clarifier.
- Le dernier jour de validité à six mois est refusé par une comparaison `>=`, malgré la fin inclusive du contrat.
- Une offre exclusivement nulle devient une référence automatique ou efface la référence validée.
- La validation d'une moyenne positive fait disparaître le zéro de l'instantané ou son signal de clarification.
- La modification de fonction change ses droits, son mode invoker, son empreinte, le verrou de validation ou les politiques RLS.
- Les dates de fin manquantes, les fins de mois, un update partiel et une écriture groupée contournent le plafond de six mois.

## Stratégie et exception d'isolation

La recette navigateur définie dans [le cadrage PRICE-02](../product/price-reference-next-slice.md) reste la preuve du parcours réel. Le script `scripts/test-reference-price-sql.mjs` exécute les migrations réelles sur une fixture PostgreSQL jetable pour vérifier les contraintes, ACL et refus d'écriture directe qui peuvent contourner l'UI.

Les anniversaires calendaires précis ne sont pas reproductibles toute l'année avec un navigateur et l'horloge réelle. Dans une transaction locale annulée à la fin du cas, le script remplace uniquement les expressions `current_date` du corps chargé par une date de fixture fournie via un paramètre de session local. Tous les comparateurs, exclusions et calculs restent ceux de la fonction installée ; aucune horloge injectable n'est ajoutée au produit. La preuve indique explicitement cette adaptation. Le script vérifie aussi les définitions et privilèges avant/après la migration sans adaptation d'horloge.

PGlite crée une base en mémoire : aucune URL, clé, variable `.env.local` ni connexion réseau n'est utilisée. La fixture simplifie le schéma et l'identité authentifiée ; elle ne remplace ni la matrice RLS Supabase complète, ni une preuve de contention entre connexions PostgreSQL simultanées, ni les imports via l'API. Aucun déploiement ou application à la pile locale persistante n'est effectué par ce script.

## Oracles

1. Offres comparables 1 000, 1 100 et 0 centimes : moyenne 1 050, deux offres retenues, zéro exclu et signalé ; validation responsable traçable avec les trois offres conservées.
2. Seulement zéro : aucune moyenne, référence antérieure maintenue ; validation automatique refusée ; lecteur/ingénieur, autre tenant et anonyme ne peuvent valider.
3. Début 31/08/2026 : fin maximale 28/02/2027, dernier jour admissible, lendemain expiré. Cas bissextile 31/08/2023 → 29/02/2024 ; fin plus courte respectée.
4. INSERT sans fin et UPDATE avec fin explicitement nulle calculent le plafond ; plafond + un jour et update partiel incohérent refusés ; lot contenant une date invalide intégralement refusé.
5. Signature, owner, ACL, mode stable/invoker, configuration de recherche, fonction de validation, triggers et politiques restent identiques ; les scénarios existants de dispersion, empreinte périmée et devis inchangés restent valides.

Les nouveaux oracles doivent échouer sur les migrations antérieures, avant écriture du SQL correctif. Le script conserve séparément les rapports baseline et candidat sous `.e2e/reference-price/`.

## Résultat du 11 octobre 2026

La migration `supabase/migrations/20261011030647_reference_price_zero_and_inclusive_validity.sql` a été créée par `supabase migration new reference_price_zero_and_inclusive_validity`, après lecture de `migration new --help`. La CLI ne crée qu'un fichier vide ; son contenu SQL a été ajouté après exécution du rouge. Aucun fichier de migration antérieur n'est réécrit.

Le changement remplace uniquement `product_reference_price_proposal(uuid,numeric,text)` : il conserve les zéros exclus et signalés sans supprimer la moyenne positive ; la borne anniversaire devient strictement dépassée pour expirer. Une précondition refuse l'application si la fonction TI-537 n'existe pas, afin que `CREATE OR REPLACE` préserve les droits et le propriétaire de cette fonction. Le schéma JSON et l'algorithme d'empreinte ne changent pas.

| Preuve | Résultat |
| --- | --- |
| `2026-10-11T03-07-52.057Z-baseline/evidence.json` | Rouge avant SQL : 49 assertions réussies, puis écarts attendus `null != 1050`, `null != 1000` au dernier jour et `null != 1076` dans le scénario existant. Les cas tout-zéro/droits et contraintes de dates réussissent déjà. |
| `2026-10-11T03-08-56.265Z-candidate/evidence.json` | **96 assertions réussies**, quatre cas dédiés réussis, aucune assertion échouée. |

Les chemins du tableau sont relatifs à `.e2e/reference-price/`. Chaque archive contient la commande, le mode baseline/candidat, Node et chemin PGlite, la révision `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`, les changements locaux, les valeurs attendues/réelles, les sources exactes et leurs empreintes. Les SHA-256 des rapports et de toutes leurs sources archivées ont été recalculés sans écart :

- Rapport rouge : `2360c22181e22f65721638af3ad7c1bec5e35020a5c94962b3619ef09af8a0b4`.
- Rapport vert : `d8cd58e5ee01642658249a95b06d94c5db656998dfb5d2fcf7a8dfffa77d9851`.
- Migration : `d7de6f35036a7eb67439a90497b8341c20b969676db63cbdb7ca526f717963ea`.

La première baseline à `03:06:20.798Z` révélait aussi un défaut du harness : un refus SQL attendu laissait la transaction en état aborted. Les refus utilisent désormais un savepoint annulé ; la baseline définitive ci-dessus distingue les vraies divergences métier. Les essais précédents restent archivés.

## Rejouer sans installation ni base distante

Le module PGlite 0.3.14 déjà disponible est réutilisé. Depuis la racine :

```powershell
$env:PGLITE_MODULE = (Resolve-Path -LiteralPath '.codex-tmp/demo-eight-20261002-01a07773/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node scripts/test-reference-price-sql.mjs --baseline
node scripts/test-reference-price-sql.mjs
```

La commande baseline échoue volontairement sur les nouvelles attentes ; la commande sans option charge aussi la nouvelle migration. Chaque invocation utilise une base neuve en mémoire et une archive horodatée distincte.

Lint du script et `git diff --check` ciblé réussis. La revue indépendante du SQL, du script et des archives n'a trouvé aucun blocage et a revérifié les empreintes. La preuve couvre le refus réel de validation par ingénieur, lecteur, autre tenant et anonyme, le zéro manuel explicitement justifié, les snapshots, l'empreinte périmée et les coûts de devis conservés. La comparaison avant/après de définition, owner, ACL, signature, stabilité/invoker et search_path, ainsi que des triggers/politiques, ne présente aucun changement hors corps de proposition.

**Limites et suite :** pas d'application à la pile Supabase locale persistante ni distante par ce script. L'application locale coordonnée et la recette navigateur ont leurs propres preuves. Les imports/API complets, les politiques du schéma intégral et la contention de plusieurs connexions restent hors preuve PGlite. Cette sous-tranche ne termine pas l'ensemble de PRICE-02.
