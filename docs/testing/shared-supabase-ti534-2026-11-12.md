# TI-534 K FO unique : reçu d'application sur le Supabase partagé

Le 12 novembre 2026, la migration [`20261112093830_unified_kfo.sql`](../../supabase/migrations/20261112093830_unified_kfo.sql)
de la [PR #239](https://github.com/maxlemeur/HEX_BC/pull/239), intégrée dans
`main` au commit `a3cad6373ee21674ebaf8cd957f726c518da21dc` (10:14:41 UTC), a
été appliquée sur **bon_de_commande**, base partagée qui sert aussi la
production. La production a ensuite été déployée depuis ce même commit.

Le propriétaire a autorisé explicitement cette migration et ce déploiement.
Aucune autre migration et aucune écriture de données métier n'ont été faites
pendant cette opération. Toutes les heures sont en UTC. La référence technique
du projet et les identifiants de déploiement sont omis.

Ce reçu est **rétrospectif**. Il est rédigé après coup, à partir des preuves de
la session d'application et d'une relecture de l'historique distant. La
migration n'a pas été rejouée. Le [reçu structuré](./shared-supabase-ti534-2026-11-12.json)
reprend les mêmes valeurs.

## Source et méthode

- Fichier : **36 848 octets**, SHA-256
  `9c10463cb84ebe509918cf6b7178945c81766d2d417ea9c512fc106ee5423065`. Cette
  empreinte est identique au [manifeste](../../supabase/migrations.manifest.json)
  et au fichier de `main`, inchangé depuis `a3cad637`.
- SQL extrait directement de Git, au commit fusionné.
- Procédure : [appliquer sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée).
  Les preuves conservées ne consignent pas l'outil d'application. L'historique
  montre une seule entrée ajoutée, au nom du fichier et en une seule
  instruction : c'est la trace d'un appel `apply_migration` nommé d'après le
  fichier, et non d'un `db push`.
- Reçu précédent : [rattrapage de main du 12 novembre](./shared-supabase-main-catchup-2026-11-12.md).
  Ses six migrations, prérequis de celle-ci, étaient présentes.

## Historique

- Avant l'application, l'historique comptait **386 lignes**. La plus récente
  était `20261112100256 20261112025548_takeoff_page_decisions`, et la migration
  visée était absente.
- Après l'application : une seule entrée ajoutée, la version distante
  `20261112111510`, nommée `20261112093830_unified_kfo`. La version distante
  donne l'heure d'application (11:15:10), distincte de l'horodatage du fichier.
- SQL enregistré : **1 instruction, 36 848 octets**, SHA-256 `9c10463c…5423065`,
  identique au fichier, saut de ligne final inclus.
- Relecture du 12 novembre à 19:45 avec `list_migrations` (lecture seule,
  conservée dans `outputs/ti534-picker-target-price` du clone canonique) :
  l'entrée figure une seule fois, juste après `20261112100256`. Les quatre
  migrations appliquées depuis la suivent : `20261112121147`
  ([reçu TI-690](./shared-supabase-ti690-delivery3-2026-11-12.md)),
  `20261112191034`, `20261112191126` et `20261112191209`. Le reçu TI-690
  contient aussi l'empreinte de l'historique à 387 lignes, cette entrée comprise.

## Contrôles sur la base partagée

Ces contrôles ont été faits par relecture, après l'application.

- **K FO** : `estimate_items.k_fo` est en `numeric(15,6)` ; la colonne
  `k_fo_manual` existe.
- **Préférences** : `estimate_fo_preferences` a RLS active et quatre politiques.
  `anon` ne la lit pas, et la table était vide lors du contrôle.
- **Déclencheur** : le corps installé de `private.derive_estimate_item_fo_provision`
  correspond exactement au corps qualifié, SHA-256
  `f389f0f727416b8fd1811157a0f58f37dd4e2372f55d0655473eb83f6bee6865`. La
  fonction est en SECURITY DEFINER avec `search_path=""`, et `anon` ne peut pas
  l'exécuter. Elle conserve l'origine `site` (TI-541), le K FO unique et la
  règle POSE SEULE.
- **Bases** : le type Tube vaut 1,13. Des sondes SQL en lecture seule retrouvent
  les exemples des [règles de calcul](../metier/regles-de-calcul.md) : 160,95 €
  pour le tube et 59,60 € avec la base 1,02, avant marge.
- **Avis de sécurité** : les comptes sont identiques avant et après. Il y a 24 INFO
  « RLS activée sans politique », 73 WARN « SECURITY DEFINER exécutable par
  authenticated » et 1 WARN sur la protection des mots de passe compromis.

Les cas de persistance, de saisie manuelle et de copie ont été qualifiés sur une
base possédée et dans la CI de la PR #239, pas sur la base partagée. Aucun compte
ni tenant n'a été créé, et aucun parcours d'écriture métier n'a été lancé en
production.

## Publication

La production a été déployée depuis `a3cad637`. Le build Vercel a cloné ce
commit exact, sans fichier local, et l'état READY ainsi que l'alias de
production ont été vérifiés. `check:release` passe sur cette source. Il a
utilisé localement le correctif de fixture de test de la
[PR #265](https://github.com/maxlemeur/HEX_BC/pull/265), qui ne touche pas le
code exécuté. La surveillance HTTP a duré 900 s, de 11:22:47 à 11:37:47, avec
32 requêtes en 200 et `db: up`. La relecture finale de l'alias et des journaux,
à 11:38:22, n'a relevé aucun groupe error/fatal.

## Limites et récupération

- Les préflights d'objets et les comptes de lignes métier pris avant
  l'application ne sont pas conservés dans les preuves. Seul l'historique
  d'avant (386 lignes) l'est. La relecture actuelle ne les remplace pas.
- TI-534 reste ouvert pour la recette authentifiée du responsable métier
  ([recette TI-534](./ti-534-unified-kfo.md)), l'origine du kit à 0 € vu en
  recette et la décision sur les lignes des brouillons antérieurs à la
  migration, que l'actualisation des K FO automatiques ne reprend pas. Ce reçu
  ne les couvre pas.
- Aucun retour arrière n'a été exécuté. Annuler ce reçu dans Git ne change pas
  la base. Un retour applicatif doit rester compatible avec les K FO à six
  décimales et les kits écrits depuis : préférer un correctif compatible.

Les preuves brutes sont dans `outputs/ti534-production-20261112` du clone
canonique, hors Git ; la relecture de 19:45 dans `outputs/ti534-picker-target-price`.
