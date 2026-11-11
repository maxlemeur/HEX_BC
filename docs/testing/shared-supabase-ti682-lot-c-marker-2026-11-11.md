# TI-682 lot C — reçu d’application du marqueur sur le Supabase partagé

Le 11 novembre 2026, la migration `takeoff_hypothesis_provision_marker` de
[la PR #211](https://github.com/maxlemeur/HEX_BC/pull/211), intégrée dans
`main` au commit `dca48980f17b04efd2ecb790dc48920d61545edc`, a été appliquée
sur le projet **bon_de_commande**, qui sert aussi la production.

Thanh a autorisé explicitement cette migration exacte et ses vérifications par
son message du 11 novembre 2026. Aucune autre migration, aucun déploiement et
aucune écriture de données métier n’ont été effectués.

## Source et méthode

- Fichier : [20261111124022_takeoff_hypothesis_provision_marker.sql](../../supabase/migrations/20261111124022_takeoff_hypothesis_provision_marker.sql).
- Taille : **7 780 octets**.
- SHA-256 : `68f852010a64c62542ec95d64844cefad4bab1d9a637800da452ddb5e4923f3d`,
  identique au manifeste et à la valeur autorisée.
- Procédure : [Appliquer sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée).
- Application : un seul appel MCP `apply_migration`, sous le nom
  `takeoff_hypothesis_provision_marker`, avec le contenu intégral du fichier,
  y compris sa dernière fin de ligne. Aucun `db push`.
- Reçu précédent : [TI-682 lot B](shared-supabase-ti682-lot-b-2026-11-11.json).
- Détails structurés et requêtes de vérification :
  [reçu JSON](shared-supabase-ti682-lot-c-marker-2026-11-11.json).

## Historique et identité SQL

Le préflight a relu l’historique à **16:12:41 UTC** : **373 lignes**, la dernière
étant `20261111101306 takeoff_hypothesis_preselection`. La comparaison des
**320 fichiers** de migration du commit source, en conservant les représentations
historiques scindées documentées dans le reçu précédent, ne trouvait que la
migration autorisée manquante.

`public.takeoff_item_hypothesis_cause(jsonb, text)` existait déjà.
`private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[])` existait,
sans `hypothesis_cause` dans son corps.

Après application, l’historique relu à **16:14:59 UTC** contient **374 lignes** :
une seule entrée ajoutée, aucune entrée supprimée. La nouvelle entrée est
`20261111161439 takeoff_hypothesis_provision_marker`. Cette version distante
est attribuée par MCP ; le fichier conserve sa version dépôt `20261111124022`.

La vérification de **16:15:02 UTC** confirme que l’entrée contient un unique
statement de **7 780 octets**, avec le SHA-256 autorisé. La comparaison SQL
`statements[1] = <contenu intégral du fichier>` renvoie **true**.

## Fonction et droits

Le corps de `private.takeoff_mark_provisions` contient désormais
`hypothesis_cause`. Son SHA-256 est
`58daeef7217e408c2b4fd393c3ae3e441039352d558e805e129ebb6a985d67cf`,
identique au corps extrait du fichier source.

Le propriétaire `postgres`, `SECURITY DEFINER` et
`search_path=pg_catalog` sont conservés. L’exécution reste refusée à
`PUBLIC`, `anon`, `authenticated` et `service_role`.
Les corps et droits des deux surcharges observées de
`public.apply_takeoff_job_guarded_atomic`, de `public.apply_takeoff_job_atomic`
et de `public.takeoff_item_hypothesis_cause` sont inchangés.

Le SQL remplace la fonction, son commentaire et réaffirme les révocations
existantes. Son `UPDATE` se trouve dans le corps de la fonction : la migration
ne l’appelle pas. Aucun backfill ni appel fonctionnel écrivant des lignes métier
n’a été exécuté.

## Advisors de sécurité

Les constats ont été relevés avant et après application, puis comparés par nom,
niveau, détail et métadonnées, sans leur horodatage : **95 identités avant et
après, aucun ajout ni retrait**.

| Avis | Niveau | Avant | Après |
| --- | --- | ---: | ---: |
| [RLS sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | INFO | 24 | 24 |
| [Fonctions SECURITY DEFINER exécutables par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | WARN | 70 | 70 |
| [Protection contre les mots de passe compromis désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | WARN | 1 | 1 |

Ces avis préexistants restent ouverts ; leur correction ne fait pas partie de
cette autorisation.

## Portée des preuves

Les preuves portent sur l’application distante exacte et les catalogues.
Elles ne constituent pas un parcours métier authentifié ni une qualification de
release. Aucun test modifiant des données de production n’a été lancé.

La PR de ce reçu ne change que les deux documents Markdown et JSON. Les suites
applicatives et la campagne SQL locale ne sont donc pas relancées ; les contrôles
portent sur la cohérence des preuves, les liens, le JSON et `git diff --check`.
Le résumé local est conservé dans
`outputs/shared-supabase-ti682-lot-c-marker-20261111/verification-summary.json`,
hors Git, sans secrets ni données métier.

Aucun déploiement, changement de variable d’environnement, rollback ou autre
migration n’a été effectué. Revenir sur la PR documentaire ne retire pas la
migration appliquée ; une éventuelle modification distante ultérieure demande
une autorisation distincte.
