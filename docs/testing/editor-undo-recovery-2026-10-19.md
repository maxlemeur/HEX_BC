# Annulation de suppression : restauration complète et reprise de l'ordre

## Contrat avant implémentation

Demande propriétaire : restaurer la ligne et sa place avant de considérer
l'annulation terminée, afficher un état honnête, permettre une vérification
contextuelle et une reprise sans doublon, conserver le contexte de la grille.
Le lot part de `origin/main` `f0fbe51fac1e2e23c463ffbdb180f21b5bd6a2d0`
sur `codex/editor-undo-recovery`, après fusion des PR 83 et 86. Le checkout
principal et ses modifications ne sont pas utilisés pour les validations.

Défaut observé dans le reçu CI de la PR 83, candidat `ec3cb48e`, merge
`85909d7e5e352cbc2781d2b9fbbd5ec51c18359d`, run
`01a153a2-2a83-7cab-8883-7f9519ad1d40` : V3E05 passe ses assertions de ligne
et de montants mais journalise « Impossible de restaurer l'ordre exact après
annulation de suppression. » avec le refus d'une liste de réordonnancement
obsolète. Cela ne démontre pas à lui seul un ordre final incorrect.

Le contrôleur met les éléments recréés dans React, puis son helper relit un
`itemsRef` mis à jour par un effet ultérieur. Le filtrage peut exclure les
nouveaux UUID acquittés, alors que le serveur exige tous les frères. Le garde
serveur doit être conservé. Les deux consommateurs sont les annulations de
suppression simple et de suppression de lignes en lot. Les autres contrats
des écrivains v1/v2/v3, calculs et autorisations restent inchangés.

## Défaillances et scénarios observables

- **Nominal V3E05** : la requête réelle contient tous les frères, dont les
  nouveaux UUID ; elle est acquittée. Après annulation et rechargement, les
  mêmes lignes, parents, positions et montants sont présents, avec seulement
  les UUID recréés remplacés. L'ordre DOM correspond à l'ordre attendu.
  Aucune erreur console inattendue, aucun saut du ruban et aucun dialogue natif.
- **Échec de remise en ordre après recréation** : conserver les UUID déjà
  acquittés. Afficher « Ligne restaurée, position à vérifier. » ou son pluriel,
  sans ajouter un bloc au-dessus de la grille. Ne pas avancer l'historique
  comme une annulation complètement réussie ; bloquer Rétablir et les nouvelles
  modifications pendant la reprise structurelle. La consultation et la
  navigation restent possibles.
- **Reprise volontaire** : « Réessayer la remise en ordre » reprend les seuls
  ordres restants, sans nouveaux POST de création. Une nouvelle panne reste
  visible. Une reprise réussie confirme l'ordre exact et ne crée aucun doublon.
  Aucun retry automatique, assouplissement d'assertion ou délai supplémentaire.
- **Vérification contextuelle** : « Vérifier la position » amène à l'élément
  restauré sans recharger ni modifier les données. L'état en cours est
  « Annulation… », puis « Suppression annulée. » après confirmation complète.
- **Envoi et sauvegarde différée** : le devis ne peut pas être envoyé pendant
  une annulation ou une reprise incomplète, même avec une confirmation antérieure.
  L'acquittement d'une sauvegarde ne confirme pas l'ordre : il doit conserver
  le message et les UUID nécessaires à la reprise. Les nouvelles saisies sont
  suspendues pendant l'opération ; une sauvegarde déjà engagée reste suivie.
- **Ligne masquée** : la vérification ouvre ses sections parentes et retire
  seulement les filtres qui empêchent de la voir avant le défilement et le focus.
- **Couverture partagée** : la suppression en lot utilise la même logique de
  phase et les mêmes protections. Les parcours existants de bulk, v1/v2 et de
  clavier qui consomment l'historique sont sélectionnés selon les changements.

La recréation d'un sous-arbre est actuellement une suite de créations : ce lot
ne la qualifie pas de transaction atomique. Une panne de création et un
résultat réseau ambigu doivent garder les protections de récupération
existantes et ne pas autoriser une recréation aveugle d'éléments acquittés.
Les conflits externes et pertes de verrou restent explicites.

## Preuves

Campagne locale sur macOS arm64, Node 24.19.0, e2e 0.21.2,
`@e2e-dev/web` 0.15.2 et Vitest 5.0.5. Stack native possédée
`miaouffrage-ci-84314-d290121f`, application de production servie sur
`http://localhost:3128`. Les migrations, pgTAP, plafonds SQL et la matrice RLS
comportementale ont passé une fois au démarrage. Aucun backend partagé utilisé.
Chaque itération réutilise cette stack et enregistre sa portée comme
`iteration`, pas comme qualification complète.

Commande de préparation :

```sh
E2E_ARMY_WORKERS=2 npm run e2e:army:dev-loop -- start --app-port 3128 --ttl-minutes 90
```

Chaque ligne ci-dessous correspond à `E2E_ARMY_WORKERS=2 npm run
e2e:army:dev-loop -- run --grep '<sélection>'`. Racine des reçus :
`.e2e/army/ci/2026-10-19T14-59-36-794Z-dev-loop/iterations/`.
Chaque répertoire conserve `manifest.json`, `critical/report.json`, les
requêtes, les identités de fixtures ARMY, les valeurs attendues/observées et
les preuves métier. Les sélections, durées et résumés sont ceux du runner.

| Itération | Sélection | Résultat et preuve principale | Durée totale |
| --- | --- | --- | --- |
| `001-2026-10-19T15-02-04-038Z` | `^V3E05 ` | Rouge : V3E05 envoie 2 frères sur 3 ; serveur 409 CONFLICT. | 11 s |
| `002-2026-10-19T15-05-06-208Z` | `^V3E20 ` | Rouge : après recréation réelle et reorder 503, reprise absente. | 26.5 s |
| `003-2026-10-19T15-11-24-261Z` | `^(V3E05\|V3E20\|V3E21) ` | Vert intermédiaire 5/5, avant renforcement de la revue. | 56 s |
| `004-2026-10-19T15-16-08-132Z` | `^V3E20 ` | Rouge : Envoyer reste actif pendant la reprise. | 46.4 s |
| `005-2026-10-19T15-21-08-430Z` | `^V3E22 ` | Rouge : champs actifs pendant undo ; batch 200 efface la reprise, observée avant ACK. | 47 s |
| `006-2026-10-19T15-22-34-753Z` | `^(V3E05\|V3E06\|V3E20\|V3E21\|V3E22\|LEP01\|LEP05) \|^bulk move persists ` | Vert 10/10 : nominal, simple/lot, sauvegarde différée, clavier et déplacements. | 165.1 s |
| `007-2026-10-19T15-27-58-338Z` | `^V3E05 \|^V3E20 a failed reorder\|^V3E21 \|^LEP01 \|^LEP05 ` | Vert final 6/6 après extraction : V3E05, V3E20/21, LEP01/05 et préparation auth. Recherche masquante retirée, focus réel, aucun reload. | 162.1 s |

Les sélections initiales par `^V3E20 ` incluent un cas homonyme déjà existant
d'OPTIMA ; ce cas est compté honnêtement, puis exclu de la sélection finale
précise. Les parcours V3E06, V3E22 et bulk-move gardent leur preuve fraîche de
006 ; ils n'ont pas été rejoués en 007 après l'extraction du repli/révélation.
Les moteurs, écrivains et sauvegardes n'ont pas changé entre ces deux reçus.
Aucun skip, flaky ou retry dans ces itérations Army.

Identité de chaque build et de ses entrées (révision commune
`f0fbe51fac1e2e23c463ffbdb180f21b5bd6a2d0` avec modifications locales) :

| Itération | Build | Run e2e | SHA-256 du diff suivi |
| --- | --- | --- | --- |
| 001 | `hYcR_idznf9vYjrljwqse` | `01a154af-1bdc-7247-99f2-1bafe3e07ca6` | `a5b0656ca2752a0c9233564d408a24160ac857bb80981b9ed70fc03556b15d15` |
| 002 | `hYcR_idznf9vYjrljwqse` | `01a154b1-e3ad-7114-8f65-3c6dc8355bca` | `416ed01012ed191f2e7c4538b11407db606e9d81ae747d592d1183c19a301b5c` |
| 003 | `-B7FyfTtnvsQB6BqA3S2b` | `01a154b8-127f-700e-b2f1-adfc54c6057d` | `92b54fa854accb5a571f65aa59b824125d0e7029152ab49bcd2b779e24aed24f` |
| 004 | `qzLRqvurgQGC1_FKeQJzg` | `01a154bc-50e6-74c1-9193-13e412034876` | `0f9a377c3fdcd200986ff583919314d3da4d4dac5e89fb1188196f5cc411b83a` |
| 005 | `Kl49eocFq9JCUE5weGhUt` | `01a154c0-e854-7b03-9209-702ac106dd44` | `c8905afee3db00fca1b018e24359dce81301d9c73c085ec3f0eb83072c42360e` |
| 006 | `jqalRzQ3i2GUdAi2fXRz6` | `01a154c2-35f6-7763-90b7-352f41b70101` | `3179f1201d6b2dfc64f33a22b11e187247325d3817b1b8b20d6e0309af36bd51` |
| 007 | `b_Iq57cgipF1ZwiOSA4F7` | `01a154c7-3389-702f-b16a-12a9abcd6284` | `0c4fee205e98a77424faf04ec40190d857d0d77396cbb91decbb2bb8fa539949` |

Les nouveaux modules sont également couverts par le manifeste des entrées du
build. Empreinte finale `appSourceSha256` :
`dd44023e64a2274238f739b8ea63c116e6ce5c0651227731bdda50d211c2b229`.

`npm run verify:pr` passe sur les sources finales : audit dépendances/signatures,
architecture, OpenAPI, TypeScript, lint, 3 282 tests Node, 820 jsdom et 12 tests
de frontières avec leur seuil de couverture. Reçu :
`.e2e/army/editor-undo-recovery-quality/2026-10-19/verify-pr.log`.
Trois tests Node restent ignorés hors environnement requis : deux de la matrice
RLS exécutée séparément par la stack native, et le garde CI demandant Bash 4+
(le Bash macOS de cette invocation est plus ancien ; la CI le force).
Les avertissements Vite sur le futur chargeur natif et un avertissement de
listeners de processus restent visibles ; aucune suppression ajoutée.

Un premier `verify:pr` a refusé Table à 2 636 lignes non vides pour un plafond
2 600. La gestion existante du repli et la révélation ont été extraites dans
`useEstimateSectionVisibility` ; le contrôle d'architecture passe sans changement
de seuil. Le double du test Bulk a été aligné sur la consommation des parents
acquittés et sur le callback de progression : les oracles d'UUID, suppression,
undo et redo sont conservés. Aucun nouveau test isolé après implémentation.

Revue indépendante : trois constats corrigés (envoi, clearHistory sur ACK,
ligne masquée), relecture ciblée sans défaut important restant, puis contrôle
limité de l'extraction et du filtre sans défaut. Les constats initiaux ont des
reçus rouges 004/005 ; la revue reste distincte de l'exécution.

Limites : les créations d'un sous-arbre restent séquentielles ; une création
incertaine impose de recharger et ne rejoue aucun POST aveuglément. Les pannes
503 sont injectées uniquement sur le transport de remise en ordre ; les
recréations, sauvegardes et reprises 200 passent par le vrai serveur local.
Les captures SDK après authentification sont refusées pour cette session
ayant utilisé un secret ; pas de contournement. La preuve UI est constituée
des assertions DOM, focus, positions, URL et persistance des parcours.
La CI de PR assure la qualification plus large. Aucune migration, aucun
changement OpenAPI, aucune application distante ni déploiement dans ce lot.
Les preuves historiques de PR 83 ne qualifient pas ce correctif.
