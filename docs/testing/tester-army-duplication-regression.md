# Duplication des devis : régression SQL isolée

## Défaillances et frontière E2E définies avant le correctif

L'E2E Tester Army a reproduit un POST `/api/estimates/<version>/duplicate` HTTP 400 sur un nouveau devis ARMY, avec SQLSTATE `42P01` et message `missing FROM-clause entry for table "duplicate_estimate_version"`. La migration du 25 août renomme la fonction canonique en `duplicate_estimate_version_without_product_id`, mais dix qualifications de ses paramètres conservent l'ancien nom. Le correctif doit porter uniquement sur ces qualifications, conserver la façade qui copie les produits et ne modifier aucune donnée existante.

Défaillances à rechercher avant d'écrire la migration :

1. La vraie fonction renommée continue d'échouer avec `42P01` avant le patch.
2. Le patch modifie un autre morceau du corps, la signature, le propriétaire, `SECURITY DEFINER`, `search_path` ou les ACL.
3. La copie perd un parent, réutilise un identifiant, change moteur/paramètres/montants, perd la provenance JSON ou l'association produit.
4. La façade devient appelable anonymement ou laisse copier une source d'un autre tenant ou d'un rôle non écrivain.
5. Une erreur pendant l'insertion des lignes laisse une version ou des lignes partielles.
6. Réappliquer la migration change de nouveau la définition ou les privilèges.
7. Une base sans fonction interne attendue accepte la migration ou laisse des mutations métier ; elle doit échouer explicitement avant toute écriture de données.

L'application de DDL distant n'est pas autorisée. Une exécution PostgreSQL isolée est nécessaire pour vérifier le correctif avant une éventuelle décision de migration. Elle complète l'E2E réellement échoué ; elle ne qualifie pas le Supabase distant après correction.

## Preuve reproductible

Le script `scripts/test-estimate-duplication-sql.mjs` charge les fonctions complètes depuis les migrations canoniques. Une capture facultative `DUPLICATION_FUNCTIONS_JSON` permet d'employer exactement les deux définitions déployées obtenues par un SELECT `pg_get_functiondef`, sans DDL/DML distant. La capture et la preuve JSON restent sous `.e2e/army/duplication-sql/` et sont ignorées par Git.

`PGLITE_MODULE` peut désigner le module PGlite déjà présent dans le cache de travail ; aucune installation ou modification de package n'est nécessaire. La preuve contient les empreintes des entrées, les assertions, les identités synthétiques, les montants copiés et les refus observés. La source de chaque définition et les dépendances simulées sont déclarées.

Depuis la racine, dans PowerShell :

```powershell
$env:PGLITE_MODULE = (Resolve-Path -LiteralPath '.codex-tmp/demo-eight-20261002-01a07773/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
$env:DUPLICATION_FUNCTIONS_JSON = '.e2e/army/duplication-sql/deployed-functions.json'
node scripts/test-estimate-duplication-sql.mjs --baseline-only
node scripts/test-estimate-duplication-sql.mjs
$env:DUPLICATION_FUNCTIONS_JSON = $null
node scripts/test-estimate-duplication-sql.mjs
```

Si le cache n'existe plus, désigner un module PGlite installé dans un autre environnement isolé. Sans capture déployée, le script relit les deux migrations canoniques et reproduit leur vrai renommage. Les sorties `evidence-deployed.json` et `evidence-canonical.json` distinguent ces deux preuves ; `baseline-evidence.json` montre l'échec exécuté avant l'écriture de la migration corrective.

Validation locale exécutée : **40 assertions** avec les définitions déployées capturées en lecture seule et **37 assertions** avec les migrations canoniques. Les deux preuves reproduisent `42P01` avant le patch puis passent la copie complète, les refus d'accès, la préservation des fonctions/ACL et l'idempotence. Deux contraintes simulées prouvent le rollback : échec tardif de ligne et échec du raccord produit après création de la hiérarchie, des liens et des décisions. Une fonction interne absente fait échouer la migration avec `42883` avant les données métier. Lint ciblé du script : aucune erreur ni avertissement.

La migration corrective est un fichier local proposé ; elle n'a pas été appliquée au Supabase partagé. La réussite PostgreSQL isolée ne transforme donc pas l'échec E2E distant de duplication en réussite.

## Limites à conserver

La fixture utilise PostgreSQL PGlite avec un seul backend. L'identité `auth.uid()` est simulée par un paramètre de session ; les tables, contraintes et données sont réduites aux dépendances de la vraie RPC. Elle vérifie les contrôles inscrits dans la fonction et les ACL, sans reproduire l'intégralité de RLS, des triggers métiers, de Supabase Auth/PostgREST ni la concurrence entre sessions. Les fonctions de duplication elles-mêmes ne sont pas minimisées.

Le correctif ne traite pas les omissions de `line_nature` et `rounding_adjustment_cents` dans la copie canonique. Une nature explicitement choisie peut être réinférée, et un arrondi non nul peut nécessiter une régression distincte. Les snapshots v2 publiés et le sceau ne sont pas recopiés dans le brouillon. Ces risques supplémentaires ne sont pas déclarés reproduits par les fixtures sans arrondi et fournitures seules.
