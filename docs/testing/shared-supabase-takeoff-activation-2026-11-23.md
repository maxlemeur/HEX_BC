# Activation du métré sur la base partagée · 23 novembre 2026

**Les quatre dates d’activation du métré sont posées**, entre 10:17:52 et 10:18:17 UTC, sur l’accord explicite du propriétaire donné le jour même pour ces quatre instructions. La production sert la version **0.9.0** (commit `d4ef760977cee5b8592aa5dffe92da0d7d4058a2`), déployée et vérifiée avant la première date. L’historique compte 442 migrations ; aucune migration ne fait partie de ce geste.

## Avant la première date

Lectures seules, à 10:17:48 UTC :

- `/api/health` : HTTP 200, version `0.9.0`, base disponible ;
- les quatre tables d’activation : 0 ligne chacune ;
- 0 analyse, 0 analyse ouverte, 0 demande de lancement ouverte ;
- la requête préalable de [#425](https://github.com/maxlemeur/HEX_BC/pull/425) : 0 ligne.

## Les quatre instructions

Chacune a été exécutée seule, puis relue avant la suivante. `on conflict (singleton) do nothing` : une seconde exécution ne crée pas de ligne et ne déplace pas une date.

| Ordre | Table | Ce qu’elle ouvre | `active_from` (UTC) | Relecture |
| --- | --- | --- | --- | --- |
| 1 | `private.takeoff_completion_activation` | les avis de fin d’analyse (grâce de prise en charge 15 min, plafond d’attente 24 h) | 10:17:52.585943 | 1 ligne, active, 15 min, 24 h |
| 2 | `private.takeoff_launch_activation` | le démarrage du métré par affaire | 10:18:01.287077 | 1 ligne, `takeoff_launch_active()` vrai |
| 3 | `private.takeoff_plan_dispatch_activation` | une analyse par plan | 10:18:08.964482 | 1 ligne, `takeoff_plan_dispatch_active()` vrai |
| 4 | `private.takeoff_item_list_order_activation` | la lecture et l’envoi par poste | 10:18:17.965838 | 1 ligne, les trois fonctions d’état vraies |

```sql
insert into private.takeoff_completion_activation (singleton,active_from,pickup_grace,wait_ceiling) values (true,statement_timestamp(),interval '15 minutes',interval '24 hours') on conflict (singleton) do nothing returning active_from,pickup_grace,wait_ceiling;
insert into private.takeoff_launch_activation (singleton,active_from) values (true,statement_timestamp()) on conflict (singleton) do nothing returning active_from;
insert into private.takeoff_plan_dispatch_activation (singleton,active_from) values (true,statement_timestamp()) on conflict (singleton) do nothing returning active_from;
insert into private.takeoff_item_list_order_activation (singleton,active_from) values (true,statement_timestamp()) on conflict (singleton) do nothing returning active_from;
```

Après la quatrième : toujours 0 analyse et 0 demande ; `/api/health` répond HTTP 200 en version `0.9.0`.

## Portée et réserves acceptées

Les quatre lignes sont uniques pour toute la base : les dates valent pour tous les tenants. Une analyse n’engage un forfait que pour un membre dont la connexion est sélectionnée sur un Mac autorisé ; la recette commence avec un seul membre pilote, supervisé.

Le propriétaire a accepté, pour cette recette, les conditions que les pull requests du métré laissaient ouvertes avant l’activation, et les traitera ensuite :

- la réservation initiale par appel et les délais de file d’une analyse par plan ne sont pas mesurés sur des plans réels ([#448](https://github.com/maxlemeur/HEX_BC/pull/448)) ;
- la sortie d’un appel n’est pas bornée chez le fournisseur, et une reprise après un arrêt peut payer deux fois une tranche ([#467](https://github.com/maxlemeur/HEX_BC/pull/467), [#473](https://github.com/maxlemeur/HEX_BC/pull/473)) ;
- les plafonds par demande et par jour restent ceux par défaut.

## Retrait

En sens inverse, une ligne à la fois, sur un accord explicite du propriétaire qui nomme l’instruction : `delete from <table> where singleton;`. Avant de retirer la troisième ligne, suivre la procédure de [#448](https://github.com/maxlemeur/HEX_BC/pull/448) (laisser finir l’analyse en cours sur le Mac, arrêter son serveur, constater l’absence de verrou sur les créneaux). Un retrait arrête les nouveaux gestes ; il ne rembourse pas un appel, ne rappelle pas un avis et n’annule pas une écriture dans un devis.
