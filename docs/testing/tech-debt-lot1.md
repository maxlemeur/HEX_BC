# Dette technique — lot 1, validation locale du 15 octobre 2026

Corrections locales sur `main`, à partir de `28ccc857`, sans commit, push,
migration partagée ni déploiement. L'arbre comportait 114 entrées modifiées ou
non suivies avant ce travail ; leurs contenus hors périmètre ont été préservés.

## Résultat

| Sujet | Correction et preuve |
| --- | --- |
| Saisie numérique | Grammaire commune stricte pour réglages, grille, collage et import ; texte invalide conservé sans écriture, formats natifs rééditables. Quantité `1 234,56`, prix `12,50`, HT exact, annulation, remise, collage et rechargement vérifiés. |
| Verrous divergents | Quatre copies remplacées par le contrôle commun utilisateur + session de page. Huit mutations sans session ou avec une autre session refusées `409 CONFLICT`, sans changement métier ; quatre mutations légitimes réussies, puis relecture. |
| Échecs de reprise | Le workflow inspecte le résultat métier du HTTP 200. Panne globale ou budget épuisé : échec ; échecs individuels : avertissement explicite. Le vrai processus est testé contre un serveur HTTP loopback, sans envoyer d'e-mail. |

Contrats, exceptions d'isolation et limites détaillées :
[saisie](tech-debt-numeric-entry.md), [verrous](tech-debt-lock-boundaries.md),
[reprise](tech-debt-recovery-detection.md).

## Vérifications exécutées

- **131/131 tests ciblés**, dans 13 fichiers, après les dernières corrections.
  Commande complète, journal et rapport JSON dans
  `.codex-tmp/debt-lot1-20261015/scoped-tests.log` et `scoped-tests.json`.
- **Typecheck, lint global et OpenAPI : succès.** Aucun contrat de route,
  schéma SQL, moteur de calcul ou dépendance modifié par ce lot.
- **Build production local et quatre budgets de taille : succès**, Node
  `24.19.0`, Next `16.4.0`, webpack. Build `REVXcBh9pG52j9xZ3OFz-` sous
  `.e2e/army/next`. Journaux `build-isolated.log` et `performance-budget.log`.
- **Diff ciblé : propre.** Les ajouts aux deux fichiers déjà modifiés
  `e2e.config.ts` et `scripts/run-tester-army.mjs` ont été comparés aux copies
  initiales ; les autres fichiers préexistants protégés gardent leurs empreintes.

La suite globale a exécuté 3095 tests : 3008 succès, 84 échecs, 3 ignorés.
L'attente UI devenue obsolète après passage au champ texte a été adaptée, puis
ses quatre tests rejoués avec succès. Les **83 autres échecs** ont été reproduits
dans une copie de l'état antérieur au lot : mêmes 13 fichiers, mêmes assertions
et mêmes premiers messages d'erreur. Le rejeu antérieur contient 83 échecs et
117 succès ; il ne représente pas une exécution globale avant lot.
Voir `.codex-tmp/debt-lot1-20261015/before-validation-comparison.md` et `.json`.
La suite globale n'est donc pas déclarée verte.

## Parcours réels et reproductibilité

TesterArmy, Chromium desktop, application `http://localhost:3117`, Supabase natif
local WSL `http://127.0.0.1:57321`. Login ordinaire, nouvelles fixtures ARMY,
écritures de préparation soumises à RLS, appels applicatifs réels. Les sorties
réseau du serveur de recette sont limitées aux origines locales. Traces
authentifiées désactivées ; aucun secret archivé dans les preuves.

Les cinq parcours métier ont réussi sur le même build, en deux exécutions :

1. `.e2e/army/critical/runs/2026-10-15T06-27-36-211Z` : login, deux imports DPGF
   (entêtes métier et opaques), saisie grille et verrous réussis. Le parcours
   réglages/collage a confirmé la remise, puis échoué sur un sélecteur du test
   visant le champ masqué de la cellule. Total de cette exécution : **5/6**.
2. `.e2e/army/critical/runs/2026-10-15T06-32-13-486Z` : sélecteur corrigé pour
   utiliser le titre visible, sans modification produit ni nouveau build ;
   login et parcours réglages/collage réussis, **2/2 sélectionnés**, 0 ignoré.

Les deux manifestes indiquent `source.changedDuringRun=false`. Les empreintes
des cinq fichiers d'identité du build sont inchangées. Les rapports, les
identités des fixtures et les valeurs attendues/observées restent dans chaque
archive. Les préparations échouées et les rouges avant correction sont conservés
séparément ; ils ne sont pas comptés comme des succès.

Pour rejouer avec le profil local privé existant :

```powershell
$env:E2E_ARMY_SERVER_MODE = 'production'
node --env-file=.e2e/tech-debt-lot1/local.env scripts/run-tester-army.mjs critical
```

Le profil sélectionne `tech-debt-lot1`. Un build de recette compatible doit déjà
exister ; ne pas réutiliser ce profil pour une base partagée. L'inventaire final
des fichiers et empreintes est conservé dans
`.e2e/tech-debt-lot1/final-manifest.json`.

## Limites

Pas de qualification mobile, de presse-papier système, de fournisseurs externes
ou du cron GitHub effectivement déployé. Les gardes de bail HTTP ne deviennent
pas une exclusion transactionnelle SQL. Les autres panneaux consommateurs du
parseur sont revus et couverts par les régressions ciblées, sans prétendre à un
parcours navigateur dédié pour chacun. Les fixtures locales sont conservées ;
le seul flag temporaire créé pour la recette des verrous a été supprimé.
