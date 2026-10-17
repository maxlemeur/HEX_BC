# Application de M7 au Supabase partagé — 18/10/2026

**M7 appliquée et vérifiée, sans donnée applicative insérée, sans politique de calcul et sans déploiement.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source immuable : `main` à `78ca0855350e18a86eed25f4b15183349f47bf39`, après fusion de la PR #34.

| Source exacte | Version distante générée | Méthode |
|---|---|---|
| `20261017172127_supplier_offer_purchase_unit.sql` | `20261017230116` | `apply_migration` |

Le fichier exact de **49 046 octets**, avec sa transaction BEGIN/COMMIT, a été transmis sans modification. SHA-256 : `1d4b5060edfcb2e273894c2a706f70192d1cdb40d618e9350e524b33ce0f284c`, conforme à celui fourni par le porteur ; blob Git source/local : `c9a3510ba6e9560bc1f70a16dbe9ba71d42e6f53`. L'horodatage distant est en UTC : application le 18/10/2026 à 01:01:16, Europe/Paris. Aucun `supabase db push`.

## Préconditions en lecture seule

Avant toute écriture distante, puis juste avant application : M7 absente (les trois colonnes de conversion absentes), fonctions M3 `private.normalize_unit(text)` et `private.unit_token(text)` présentes, colonne M4 `estimate_items.unit_code` présente. L'historique et le catalogue ne montraient aucune application antérieure de M7.

Les six fonctions recopiées ont été comparées au canonique de `main` **avant M7**, obtenu en reconstruisant les mêmes sources sans ce seul fichier. Corps `prosrc` (MD5 après normalisation LF), `proconfig` exact, type de retour, volatilité, SECURITY DEFINER, STRICT, parallélisme et ACL : **6/6 identiques**, sans écart. Elles étaient encore inchangées au dernier contrôle préalable.

| Fonction | Dernière source canonique avant M7 |
|---|---|
| `private.purchase_unit_token` | M2, `20261017093407_supplier_offer_zero_price_policy.sql` |
| `private.estimate_purchase_review_lines` | `20261011083209_transactional_estimate_purchase_preparation.sql` |
| `private.normalize_purchase_order_item` | `20261011091744_purchase_decimal_quantities_and_stable_edits.sql` |
| `public.create_estimate_purchase_order_drafts` | M2 |
| `public.update_supplier_offer` | M2 |
| `public.catalogue_products_page` | **M2, définition restaurée lors du rattrapage** |

Aucune précondition n'a échoué ; aucune correction de données ou de fonction n'a été effectuée en dehors de M7. La revue indépendante du fichier exact n'a relevé aucun blocage : 25 instructions de transaction/préflight/DDL/droits/commentaires, sans DML au niveau supérieur.

## Répétition et SQL/RLS locaux

Sources du SHA ci-dessus, WSL Ubuntu 24.04, Node 24.14.0, CLI Supabase 2.120.0 et PostgreSQL 17.11, dans des piles natives temporaires possédées :

1. Reconstruction canonique complète et capture des oracles.
2. Reconstruction sans M7 ; reproduction **locale uniquement** du nom historique `estimate_items_pu_ht_check`. Comparaison des six fonctions préalables et des **35 tables du périmètre** au partagé : zéro différence.
3. Application du fichier exact M7, comparaison au canonique, puis suites pgTAP existantes.

Résultat : **20 fichiers pgTAP, 1 854 assertions réussies**. Les deux piles de répétition ont été arrêtées, détruites et leurs répertoires retirés. La chaîne canonique `npm run db:ci:local` a ensuite terminé avec le code **0** : **1 854 assertions PASS et matrice RLS comportementale PASS** ; son cleanup isolé fait partie de la commande.

Les assertions existantes couvrent notamment conversion des quantités/prix, arrondis, minima de commande, dépassements, prix négociés, meilleur prix catalogue et unité portée par une ligne v3. Les fixtures n'ont été chargées que dans les piles locales temporaires.

## Contrôles après application sur le partagé

| Contrôle | Résultat |
|---|---|
| `supplier_pricebook.estimate_unit_code` | `text`, nullable, sans défaut, NULL sur les **184 offres** |
| `supplier_pricebook.estimate_units_per_purchase_unit` | `numeric(14,6)`, nullable, sans défaut, NULL sur les 184 offres |
| `supplier_pricebook.purchase_rounding` | `text`, nullable, sans défaut, NULL sur les 184 offres |
| `supplier_pricebook_purchase_unit_check` | Présente, canonique et validée |
| `supplier_pricebook_converted_price_check` | Présente, canonique et validée |
| Clé étrangère et index de l'unité | Conformes au canonique ; FK validée, référence `measurement_units(code)` avec RESTRICT |
| Fonctions M7 | **9/9 conformes** aux corps sources et aux métadonnées/ACL du canonique, `search_path` compris |
| Fonctions préexistantes hors M7 | **399/399 inchangées**, corps, configurations et droits compris ; aucune suppression |
| M1 et M4 | **29 fonctions issues de M1/M4 inchangées**, notamment les gardes d'écriture, d'émission/publication et le gel v3 |
| Tables du périmètre | **34/35 intégralement identiques** au canonique ; 35/35 en neutralisant uniquement le nom historique de contrainte de PU |
| Politiques de calcul / journal / versions moteur 3 | **0 / 0 / 0**, comme avant |

Les neuf fonctions M7 comprennent les six remplacements contrôlés au préalable et trois nouveaux helpers privés : `purchase_quantity`, `purchase_unit_price_cents`, `purchase_conversion_factor`. Les contrôles de corps sont faits directement contre le texte exact de M7 ; les configurations et droits sont comparés à l'oracle PostgreSQL reconstruit depuis ces sources. Aucune fonction métier n'a été appelée sur le partagé pour fabriquer une offre convertie ou une commande de test.

## Empreintes des données d'origine

Les **122 tables préexistantes de `public` et `private`**, soit **39 683 lignes** au total, gardent leurs nombres de lignes et leurs empreintes : **122/122 identiques**. Les tables vides, les historiques et les journaux applicatifs sont inclus.

Méthode : MD5 par ligne sérialisée en JSONB, concaténation ordonnée de ces empreintes puis MD5 de l'ensemble, avec contrôle séparé du nombre de lignes. Seules les **trois colonnes nouvellement ajoutées à `supplier_pricebook`** sont retirées du JSONB pour comparer les colonnes d'origine. Aucune colonne ou ligne préexistante n'est exclue. Les schémas techniques `auth`, `storage` et `supabase_migrations` ne font pas partie de cette empreinte applicative.

Aucune donnée applicative, fixture ou politique de calcul n'a été insérée sur le partagé. Une seule nouvelle ligne technique d'historique enregistre M7.

## Écarts historiques préservés et incident d'appel

Le nom `estimate_items_pu_ht_check` reste différent du nom canonique `estimate_items_pu_ht_cents_check`, avec le même prédicat. Il n'a pas été renommé. Le relevé élargi des fonctions conserve aussi **cinq signatures présentes uniquement sur le partagé et deux signatures canoniques anciennes absentes du partagé**, hors M7 et hors des six préconditions ; leurs noms figurent dans le JSON. Aucune correction hors périmètre n'a été faite. Ce rapport établit la conformité des neuf fonctions M7 et l'absence de dérive des fonctions existantes hors M7, pas une équivalence globale de tous les schémas.

Le premier appel d'application a renvoyé `Invalid or expired requestState`. Les lectures suivantes montraient zéro colonne M7 et un historique inchangé. Le second appel du même fichier exact a réussi ; une seule application est enregistrée, sans doublon.

Les conseillers de sécurité restent inchangés : 17 INFO RLS sans politique, 18 WARN de fonctions SECURITY DEFINER accessibles à `anon`, 62 à `authenticated`, et 1 avertissement préexistant de protection des mots de passe divulgués. Voir [RLS sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) et [fonctions authentifiées](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Aucun droit supplémentaire n'a été accordé hors du fichier autorisé.

## Limites et preuves

Les contrôles distants portent sur le catalogue et les empreintes d'origine ; le comportement a été exécuté localement en pgTAP/RLS. Aucun parcours UI, création de commande, modification d'offre, conversion, PDF ou courriel de production n'est revendiqué. **Aucune autre migration, politique de calcul ou opération de déploiement n'a été exécutée.**

Revue finale indépendante en lecture seule des deux rapports et des preuves brutes : **aucun constat actionnable** ; les 31 empreintes/tailles, les comparaisons et les limites ont été revérifiées, sans secret détecté.

- [Rapport structuré](./shared-supabase-m7-2026-10-18.json) : six préconditions, neuf fonctions M7, 399 comparaisons de fonctions hors M7, 122 empreintes avant/après et diagnostics détaillés.
- [Source immuable de M7](https://github.com/maxlemeur/HEX_BC/blob/78ca0855350e18a86eed25f4b15183349f47bf39/supabase/migrations/20261017172127_supplier_offer_purchase_unit.sql).
- Harnais, requêtes et snapshots détaillés locaux : `.e2e/shared-supabase-m7-20261018/` ; **31 SHA-256 et tailles** de preuves sont conservés dans le JSON.
