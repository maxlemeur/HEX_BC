# Application du métré avec safeupdate

La campagne Army de production candidate 6 atteint la RPC d'application après
vérification du métré et acquisition du verrou, puis reçoit SQLSTATE `21000`,
`UPDATE requires a WHERE clause` (TKF01, TKF02 et TKF06). Le recalcul moteur 2
met à jour la table temporaire de répartition sans prédicat. La définition
actuelle provient de la migration publiée du 14 octobre sur la remise fixe.

Échecs observables à couvrir avant correction :

- application refusée sous safeupdate malgré un métré valide et un verrou détenu ;
- prix, quantité et totaux partiellement persistés si la transaction échoue ;
- remise fixe perdue lors du remplacement de la fonction de recalcul ;
- protection safeupdate ou limites tenant/version affaiblies par la correction.

Les parcours Army existants TKF01/TKF02/TKF06 restent la preuve HTTP et UI.
La suite pgTAP existante `takeoff-atomic-apply.test.sql` est renforcée avant
correction : fixture append moteur 2 avec
remise fixe de 101 centimes, contrôle du prix de 2500 centimes pour quantité 2,
du total net de 4899 centimes et du statut appliqué. Les assertions de rollback
et de refus de remplacement racine restent exécutées. Cette isolation vérifie
les centimes et la transaction réelle sans mock. Le premier essai de chargement
explicite de safeupdate dans pgTAP est refusé par le rôle postgres natif
(`access to library "safeupdate" is not allowed`) : il s'agit d'une limite de
configuration, pas du RED produit. La protection propre à la session PostgREST
reste à prouver par le rejeu des parcours Army ; aucun privilège n'est ajouté
pour contourner cette limite.

La correction doit être une nouvelle migration, sans désactiver safeupdate,
sans réécrire de migration publiée et sans appliquer de migration distante.
Le manifeste de migrations du checkout étant déjà modifié par l'utilisateur,
la projection de publication part de HEAD et ajoute seulement notre migration.
Le fichier de travail conserve les entrées de l'utilisateur et reçoit cette
même nouvelle entrée pour éviter une suppression apparente après publication.

Référence : [pg-safeupdate, documentation officielle](https://github.com/eradman/pg-safeupdate).

Résultats locaux du 15 octobre : baseline avant migration et rejeu après migration
passent chacun 13 fichiers pgTAP / 1253 assertions et la matrice RLS 2/2. Les
logs sont `.codex-tmp/army-ci-migration-20261015/safeupdate-baseline.log` et
`safeupdate-green.log`. La migration `20261015190000_scope_takeoff_recalculation_safeupdate.sql`
ne change que le prédicat de l'UPDATE temporaire : la ligne correspondante doit
appartenir à la version et au tenant déjà verrouillés. La fonction conserve
signature, search_path, calculs, ACL et propriétaire. La revue indépendante
confirme ce delta unique. Ces résultats SQL ne remplacent pas le rejeu Army
de l'application sous la protection PostgREST.

Le contrôle HTTP local réel est ensuite passé avec le rôle authenticator
chargeant `supautils, safeupdate` : RPC 200, quantité 2, prix 2500, remise fixe
101 et HT net 4899 centimes relus via RLS. Le remplacement racine reste refusé
(HTTP 400 / SQLSTATE 22023). Reçu sans secret :
`.codex-tmp/army-ci-migration-20261015/safeupdate-http-proof.json`.

La campagne Army Linux candidate 9 qualifie aussi le chemin applicatif : TKF01,
les trois variantes TKF02 et TKF06 passent sur la projection immuable
`6b315285c401140723c6c2f563ab5bde8d21aead`. Le rapport est conservé dans
`.codex-tmp/army-ci-migration-20261015/candidate-9-evidence/full/report.json`.
Le reste de cette campagne demeure partiellement rouge ; ces réussites ne
valent pas qualification globale.

Le contrôle HTTP local complémentaire confirme `safeupdate` dans les modules
préchargés du rôle PostgREST, puis l'application RPC200 : quantité 2, prix
unitaire 2500, remise fixe 101 et total net 4899 centimes. Le remplacement racine
interdit reste rejeté (400 / 22023). La pile est détruite après la preuve
`safeupdate-http-proof.json` ; aucun backend partagé n'est modifié.
