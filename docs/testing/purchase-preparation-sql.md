# SITE-01A — Préparation d'achat transactionnelle

## Défaillances définies avant implémentation

La préparation courante peut écrire un premier fournisseur avant l'échec du
second ; la compensation ne constitue pas une transaction. La même sélection
peut être validée deux fois, rejouée après perte de réponse ou recréée lorsque
la commande quitte le statut brouillon. Une modification de coût, quantité,
TVA, offre, fournisseur ou chantier après la revue doit invalider cette revue.
Les montants négociés du devis doivent rester la source du brouillon.

Les parcours TesterArmy doivent vérifier la lecture, la création complète,
les valeurs exactes, la reprise d'une intention et le conflit après modification.
La couverture SQL complète ces parcours pour les écritures directes, le refus
de rôle/projet/tenant, l'injection d'une erreur du second fournisseur et les
collisions à deux connexions. Ces défaillances ne sont pas prouvées par un
mock de client ni par une simple comparaison de texte source.

## Contrat arrêté avant la migration

- `get_estimate_purchase_order_review(version, item_ids)` renvoie les lignes
  relues avec une empreinte sémantique par ligne calculée côté base.
- `create_estimate_purchase_order_drafts(version, key, reviewed_lines, groups)`
  valide la sélection exacte, verrouille les données puis compare les empreintes
  et `delivery_site_updated_at`. Une transaction contient tous les brouillons,
  leurs lignes, les réservations et le reçu.
- `get_estimate_purchase_order_receipt(version, key)` retrouve le résultat
  original, ses identifiants et ses statuts actuels, avant toute nouvelle revue.
- `get_estimate_purchase_order_transfers(version)` expose les rattachements
  minimaux autorisés par le projet, y compris annulés ou supprimés.

Le reçu et la réservation d'une ligne survivent à la suppression du brouillon.
Tous les statuts, dont `canceled`, empêchent une recréation automatique. La
reprise explicite, les achats partiels et les quantités décimales sont des
contrats ultérieurs ; aucune quantité n'est arrondie pour franchir cette limite.
Les références, quantités et montants historiques sont immuables dans le reçu.
Le statut courant ne transforme pas ce reçu en proposition actuelle.

Les relations privées n'acceptent aucun DML des rôles API. Les fonctions
publiques étroites vérifient l'acteur, le tenant actif, le rôle et le propriétaire
du projet ou administrateur du tenant. Un reçu est lisible par son acteur ou
l'administrateur. La projection des rattachements ne donne pas accès au détail
d'une commande d'un autre propriétaire. Le privilège élevé est nécessaire pour
empêcher les doublons malgré les RLS historiques de commandes par propriétaire.

## Assertions SQL préalables

Le template `src/test/fixtures/purchase-preparation-regression.sql` construit
uniquement des données ARMY dans une transaction locale annulée. Il vérifie :

1. Deux fournisseurs : HT/TVA/TTC exacts 2400/480/2880 et 2331/466/2797,
   quantités 2 et 3, coûts négociés 1200 et 777, source inchangée.
2. Rejeu de clé identique ; refus de clé réutilisée avec une autre demande.
3. Refus après modification des valeurs et conditions relues ; zéro écriture.
4. Refus d'une quantité fractionnaire et d'une devise non EUR.
5. Erreur forcée au second fournisseur : zéro commande, ligne, réservation, reçu.
6. Conservation des réservations pour chaque statut et après suppression.
7. Refus des écritures concurrentes ou directes portant sur un besoin réservé.
8. Refus anonyme, rôle lecteur/directeur, projet inaccessible, tenant inactif,
   chantier étranger et accès direct aux tables privées.

Une exception terminale `P9001` annule le probe entier. Les claims SQL simulés
ne remplacent pas l'authentification ordinaire E2E. Les séquences PostgreSQL
peuvent consommer des numéros malgré rollback ; aucun numéro consécutif n'est
promis. Les scénarios concurrents exigent une recette distincte à connexions
réelles et une observation des verrous avant de prétendre les avoir qualifiés.

## Preuve et limites

Inspection native initiale :
`.e2e/purchase-preparation/2026-10-11T08-26-10-855971Z-inspect.json`, SHA256
`f0b8a4b29f86b23c92d14534423d13d7f5f3dd9e38ce8fdbdcc269450cbea307`.
Elle confirme notamment `delivery_sites.updated_at`, les RLS de commandes par
propriétaire et les triggers de verrouillage produit des offres/fournisseurs.
Le RED initial du contrat RPC absent est archivé dans
`.e2e/purchase-preparation/2026-10-11T08-31-18-681382Z-regression-red.json`
(30 erreurs `42883`). Il ne prouve pas les défauts HTTP historiques, reproduits
séparément par la recette applicative avant modification.

La revue a ensuite trouvé des erreurs dans le premier candidat. Le probe
`2026-10-11T08-46-34-986645Z-regression-green.json` conserve les refus attendus
manquants sur déplacement de ligne/version, les objets JSON de notes convertis
en texte, l'erreur de suppression de version et l'absence du snapshot détaillé.
Le suffixe du fichier désigne le mode du runner : **ce résultat était rouge**.
Les assertions précédaient les corrections correspondantes.

La régression `stale-uppercase-fingerprint` a aussi reproduit une revue périmée
acceptée quand les UUID relus étaient en majuscules : coût 1300 au lieu de 1200,
commande 2600/520/3120 centimes. Preuve avant correction :
`2026-10-11T08-50-35-948319Z-regression-green.json`, SHA256
`b8c8726e1add4097f1f5ccf8e6ec5d54f8d8872e54942fe88b4343b844624926`.
La RPC normalise désormais les UUID et compare leur identité typée.

Le candidat final réussit **39 cas sur 39** dans une transaction qui annule
aussi son DDL :
`.e2e/purchase-preparation/2026-10-11T08-51-20-335561Z-regression-green.json`,
SHA256 `2c794e76f6ce298bd28eafcef41574f4706f5d078dc1980df57731d98e1f1da4`.
Une connexion distincte a confirmé l'absence de ces objets, de toutes les
fixtures et de la migration dans l'historique :
`2026-10-11T08-52-12-788583Z-verify.json`, SHA256
`2e1449db5f2a94dda99128fe7a27f8df16fd56d175fb3bf50c14921059d04f5b`.

## Activation native locale vérifiée

La migration `20261011083209_transactional_estimate_purchase_preparation.sql`
a été appliquée uniquement à la pile isolée `http://127.0.0.1:59827`.
SHA256 : `3179ccf574886b895a3a7293113d3350f079ca1cd2e982ffbb20cd5b3576a95f`.
Le reçu `.e2e/purchase-preparation/native-application.json` est `verified`.
La même suite rejouée contre le schéma installé réussit également **39/39** :
`.e2e/purchase-preparation/2026-10-11T08-54-40-169292Z-regression-green.json`,
SHA256 `fb9a9b9bd8f6727c2bef2750db743ca277b70d4a5a6727208620387823334e13`.
Le contrôle indépendant après recette
`2026-10-11T08-55-38-300139Z-verify.json` confirme zéro fixture résiduelle,
le rôle initial restauré, les fonctions installées et l'historique de migration.

Les contrôles avant/après ont établi :

- Données de quinze tables métier, propriétaires, ACL et RLS inchangés.
- Vingt et un rattachements historiques recopiés exactement ; aucun reçu de
  revue antérieure inventé.
- Quatre RPC réservées à `authenticated`, huit fonctions privées inaccessibles
  aux rôles API, tables privées avec RLS et sans privilèges API.
- Corps de fonctions installés identiques au candidat ; triggers existants
  préservés, nouveau garde-fou de source compatible avec la suppression de
  version et son ancien `ON DELETE SET NULL`.

Le snapshot privé conserve coût négocié, TVA, unité, offre choisie et conditions
relues après suppression de commande. La RPC de revue ne l'expose pas. Les
rattachements survivent aux suppressions de ligne/version/commande ; une purge
explicite du tenant conserve son contrat de cascade. Les déplacements de source
déjà transférée sont refusés, sans interdire la suppression de cette source.

Les montants conservent la limite de stockage historique en centimes entiers.
Les droits sont simulés par rôle et claims SQL ; la recette E2E ordinaire reste
distincte. Les 39 cas prouvent notamment les refus lecteur/directeur en écriture,
le tenant inactif et l'identifiant de version inaccessible, pas une matrice
complète de tous les utilisateurs. La concurrence à connexions réelles et
l'interface ne sont pas qualifiées par cette suite séquentielle seule.

`npm run supabase:manifest:add` puis `npm run supabase:validate` ont réussi.
Le manifeste conserve les empreintes historiques et ajoute cette seule migration.
Il n'y a eu ni activation distante, ni commit, ni publication.

Documentation consultée : [fonctions Supabase](https://supabase.com/docs/guides/database/functions),
[verrous PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
