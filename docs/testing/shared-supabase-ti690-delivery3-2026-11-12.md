# TI-690 livraison 3 — reçu d’application sur le Supabase partagé

Le 12 novembre 2026, la migration `material_request_articles` de
[la PR #263](https://github.com/maxlemeur/HEX_BC/pull/263), intégrée dans
`main` au commit `ff0bcda2c25bc63a12a268464dca6f56aea9161f`, a été appliquée
sur le projet **bon_de_commande** (`ijropnynpwjbllievrip`), qui sert aussi la
production.

Le propriétaire a autorisé explicitement cette migration, une fois la PR
intégrée, et ses vérifications. Aucune autre migration, aucun déploiement et
aucune écriture de données métier n’ont été effectués.

## Source et méthode

- Fichier : [20261112101124_material_request_articles.sql](../../supabase/migrations/20261112101124_material_request_articles.sql).
- Taille : **16 062 octets**.
- SHA-256 : `d34f9d94fafb6ae05d6ca6ef9d37b6a9fe6014f9417bd5805bf6b9ac9377184c`,
  identique au manifeste de `main`.
- Procédure : [Appliquer sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée).
- Application : un seul appel MCP `apply_migration`, sous le nom
  `20261112101124_material_request_articles`, avec le contenu intégral du
  fichier, y compris sa dernière fin de ligne. Le fichier porte sa propre
  transaction (`begin;` … `commit;`) et un préflight qui refuse une base où
  `public.product_aliases` existerait déjà. Aucun `db push`.
- Reçu précédent : [rattrapage de main du 12 novembre](shared-supabase-main-catchup-2026-11-12.md).

## Préflight

- Historique : **387 lignes**, la plus récente
  `20261112111510 20261112093830_unified_kfo` ; la migration visée absente.
  Empreinte de l’historique (version, nom et SQL de chaque ligne, dans l’ordre) :
  `49aa9e87546ce21e50f664e5fef720933cab5e700e68c46449bbbcf10e6f89a1`.
- Fichiers de `main` absents de l’historique : cette migration et
  `20261112100501_estimate_line_provisional_quantity` (TI-682, #262), qui
  n’entre pas dans cette autorisation et n’a pas été appliquée.
- Objets : aucune des trois colonnes de `material_request_lines`, ni
  `products.created_from_material_request`, ni `public.product_aliases`.
  `public.current_tenant_id()`, `public.has_tenant_role(uuid, tenant_role[])` et
  `public.is_tenant_member(uuid)` présents.
- Corps de `private.enforce_material_request_line_write()` identique à celui de
  [20261112021509_material_request_line_cap.sql](../../supabase/migrations/20261112021509_material_request_line_cap.sql)
  (md5 `90725ccbd07bdc829a34aa4f237ca3e8`) : la redéfinition ne perd aucun
  correctif fait hors des fichiers.
- Données : 0 ligne de demande de matériel, 1 305 articles.

## Historique et identité SQL après application

- **388 lignes** : une seule entrée ajoutée,
  `20261112121147 20261112101124_material_request_articles`. La version distante
  est l’heure d’application, distincte de l’horodatage du fichier.
- SQL enregistré : **1 instruction, 16 062 octets**, SHA-256
  `d34f9d94fafb6ae05d6ca6ef9d37b6a9fe6014f9417bd5805bf6b9ac9377184c`, identique
  au fichier.
- Les 387 entrées précédentes sont inchangées : même empreinte
  `49aa9e87…f6e89a1` une fois la nouvelle entrée exclue.

## Contrôles sur la base partagée

- **Lignes de demande** : `product_id` uuid, `product_match` text,
  `pre_link_wording` jsonb, toutes nullables, sans défaut. Contraintes
  `material_request_lines_product_id_fkey` (ON DELETE SET NULL),
  `_product_match_check`, `_product_match_presence_check` et
  `_pre_link_wording_check` présentes ; index `material_request_lines_product_idx`.
- **Déclencheur des lignes** : corps identique au fichier (md5
  `e7c449df206e2cc818cbf60619ed15f0`), `search_path=""` conservé.
- **Articles** : `created_from_material_request` boolean, non nul, défaut
  `false`, aucun article marqué sur 1 305. Déclencheur
  `freeze_product_material_request_origin` actif.
- **Noms usuels** : `public.product_aliases` vide, RLS active et forcée ; les
  politiques « Tenant members read product aliases » (SELECT), « Catalogue
  editors add product aliases » (INSERT) et « Admins and authors delete product
  aliases » (DELETE) ; déclencheur `enforce_product_alias_write` actif.
  `authenticated` a SELECT, INSERT et DELETE, pas UPDATE ; `anon` n’a aucun droit.
- **Fonctions privées** : `private.freeze_product_material_request_origin()` et
  `private.enforce_product_alias_write()` en SECURITY INVOKER,
  `search_path=""`, sans EXECUTE pour `anon` ni `authenticated`.

**Réserve ACL :** `service_role` a sur `product_aliases`, en plus des SELECT,
INSERT, UPDATE et DELETE accordés par le fichier, REFERENCES, TRIGGER et
TRUNCATE, venus des privilèges par défaut du schéma, comme pour les autres
tables récentes. Aucun SQL hors périmètre n’a été ajouté pour les retirer.

## Avis de sécurité

| Avis | Avant | Après |
| --- | ---: | ---: |
| [RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 INFO | 24 INFO |
| [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 73 WARN | 73 WARN |
| [Protection des mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 WARN | 1 WARN |

Mêmes constats avant et après, hors heure d’observation : la migration n’ajoute
aucune fonction SECURITY DEFINER ni table sans politique. Les avertissements
préexistants restent ouverts.

## Compatibilité, preuve et reprise

L’application en production n’écrit aucune des nouvelles colonnes : le
déclencheur redéfini garde pour elle le comportement de `021509`, et le
déclencheur des articles ne refuse que le changement de la nouvelle colonne. Le
rattachement des lignes aux articles n’est utilisable qu’une fois `main`
déployé ; le déploiement reste une décision séparée du propriétaire.

La preuve couvre l’identité du SQL, l’historique, les objets, les droits et les
avis. Elle ne qualifie ni un déploiement ni un parcours métier authentifié sur le
partagé ; ceux-ci sont qualifiés par les parcours MR01, MR02 et CAT01 sur pile
possédée et par les contrôles de la PR #263. Ce reçu est documentaire : contrôles
locaux limités à la cohérence, aux liens et à `git diff --check`. Une annulation
de cette PR ne retire pas la migration appliquée ; toute correction distante
demanderait une nouvelle migration et sa propre autorisation.
