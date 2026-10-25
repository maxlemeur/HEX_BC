# Mesurer les performances navigateur

Comparer le même parcours, les mêmes données et le même environnement avant
et après. Identifier la révision, le build, le runtime, le navigateur, la charge
de l'hôte et l'état des caches. Pour une décision de performance, garder les
7 échantillons bruts et leur médiane ; ne pas assimiler une mesure SQL à une
durée HTTP ou à l'affichage d'une page. Les [budgets SQL](large-estimate-statement-budget.md)
complètent les mesures navigateur.

## Profils disponibles

| Commande | Ce qu'elle mesure |
| --- | --- |
| `npm run e2e:army:performance` | Pages login/signup, affaires, produits et commandes ; métriques de chargement, saisie et scroll, desktop et viewport mobile |
| `npm run e2e:army:performance:grid` | Grille de 1 000 lignes injectées côté navigateur, lectures contrôlées et écritures bloquées ; pas un benchmark de persistance |
| `npm run e2e:army:performance:navigation` | Navigation client desktop entre listes, sur build de production possédé |
| `npm run e2e:army:performance:navigation:live` | Même navigation sur serveur loopback existant, `localhost:3000` par défaut ; le runner ne le démarre ni ne l'arrête |
| `npm run e2e:army:performance:affaire` | Création/réutilisation de la seule fixture ARMY possédée : brouillon et deux lignes tarifées, cinq transitions et valeurs exactes |

`e2e/army/performance/` et [e2e.config.ts](../../e2e.config.ts) définissent les
sélections effectives. Les recettes `dogfood-*` et `editor-draft` demandent leurs
configurations et fixtures explicites ; leur présence dans le dossier ne les
fait pas exécuter par la commande générale.

## Préparation du profil de production

Ces commandes directes demandent un backend préparé, un compte dédié via
`E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD`, les variables publiques Supabase et
`E2E_ALLOWED_SUPABASE_HOST` exact. Elles ne créent pas une pile autonome.
Utiliser une pile locale possédée ; un backend partagé doit disposer d'un
périmètre de fixtures et d'écritures autorisé. Garder les secrets hors des
sources et des preuves.

```sh
npm run e2e:army:performance:list
E2E_ARMY=1 PERFORMANCE_BUILD_DIR=.e2e/army/next npm run build
npm run e2e:army:performance
```

Le wrapper possède le serveur de production sur `localhost:3107`, refuse un
serveur déjà présent et vérifie que le build ne change pas pendant la mesure.
`E2E_ARMY_BASE_URL` peut choisir un autre port loopback. Le mode `live` réutilise
un serveur existant et ne prouve ni son build ni un état froid contrôlé.

La navigation sur listes reste en lecture ; le profil affaire autorise les
projections d'approbation et événements d'audit de sa seule fixture. Une lecture
du hub n'est donc pas supposée sans effet en base. Le reçu conservé dans
`.e2e/army/performance/fixtures/affaire.json` lie la fixture à son backend ; ne
pas supprimer ce reçu pour créer silencieusement une nouvelle référence. Sur le
Supabase partagé, la purge hebdomadaire supprime cette affaire après la rétention
de son tenant de test, sauf si elle est listée dans
`private.test_data_retained_projects` ([Données de test](../../supabase/README.md#données-de-test)).

## Interprétation et preuves

Les métriques viennent des APIs navigateur (navigation, paints/LCP, long tasks,
CLS et frames), complétées par des assertions de route, contenu et saisie.
Un temps clic-vers-contenu observé par le runner inclut sa cadence de lecture ;
il n'est pas un timestamp exact de rendu. Les pages du profil général prennent
3 échantillons ; ce diagnostic court ne satisfait pas à lui seul le protocole
de comparaison à 7 mesures. Les caches peuvent être chauds lors des répétitions.

Le viewport mobile n'émule ni un appareil physique ni un réseau/CPU lent.
Un benchmark de grille injectée ne qualifie pas les écritures du vrai devis ;
les parcours métier restent nécessaires après une optimisation. Vérifier aussi
l'ouverture des dialogues, le focus et la persistance lorsqu'ils sont touchés.

Les archives exactes vivent sous `.e2e/army/performance/runs/<date>/`, avec
rapport, manifeste, logs et `artifacts/metrics/`. Référencer ces fichiers depuis
`outputs/` sans copier les médias. Conserver les erreurs et variations ; un
résultat local ne prouve pas les percentiles de production, et une diminution
de JavaScript ne suffit pas à conclure à une amélioration du chargement.
