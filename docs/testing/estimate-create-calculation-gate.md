# Création de devis sous le verrou de calcul du tenant

Contrat défini le 16 octobre 2026 avant correction, après la campagne Army
critique du même jour : avec `E2E_ARMY_WORKERS=3` sur la pile éphémère
possédée, deux suites sur deux ont échoué sur un `POST /api/estimates` en 400
(`e2e/army/critical/fixtures.ts:231`), le serveur journalisant
`40001 ESTIMATE_CREATE_CONTEXT_CHANGED` pendant que d'autres workers écrivaient
dans le même tenant. Deux utilisateurs d'une même entreprise pouvaient subir la
même course.

## Cause, confirmée par la régression rouge

- `createEstimate` (`src/lib/estimates/server.ts`) réécrivait à chaque création
  les neuf rôles MO par défaut du propriétaire du projet, par un upsert
  `ignoreDuplicates`.
- Le trigger BEFORE `aaa_guard_estimate_calculation_context` de `labor_roles`
  (`20261012020700`, redéfini par `20261012023009`) s'exécute pour chaque ligne
  proposée, y compris celles que `ON CONFLICT DO NOTHING` ignore ensuite. Il
  tente sans attendre le verrou exclusif `estimate-calculation:<tenant>`.
- Création de ligne, lot, réglages et finalisation d'ouvrage détiennent la
  forme partagée de ce verrou pendant leur transaction : la tentative exclusive
  échoue aussitôt en 40001. Symétriquement, la courte détention exclusive par la
  création peut faire échouer la sauvegarde d'un collègue.
- `mapSupabaseError` n'avait pas de règle 40001 : réponse 400 `BAD_REQUEST`,
  non réessayable, alors que le commentaire de la migration prévoit un nouvel
  essai de l'appelant depuis un contexte frais.

`persist_estimate_creation_atomic` ne prend aucun verrou consultatif : une
création dont les rôles par défaut existent n'a donc aucune raison de toucher ce
verrou.

## Défaillances et preuve E2E attendue

| Défaillance | Scénario observable |
| --- | --- |
| La création échoue pendant un calcul du tenant | GATE01 : une session psql possédée détient le verrou partagé exactement comme une sauvegarde ; pendant ce temps une vraie ligne (201), de vrais réglages (200) et une création doivent réussir. Le verrou est relu détenu après les trois réponses. |
| Course réelle, dans les deux sens | GATE02 : 8 créations de ligne et 8 sauvegardes de réglages séquentielles, en parallèle de 2 × 8 créations, dans le même tenant : 32 succès exigés, totaux et lignes relus. |
| Les rôles existants sont réécrits ou dupliqués | GATE01/02 : identités des neuf rôles par défaut identiques avant/après. |
| Un vrai conflit est un 400 non réessayable ou laisse des écritures partielles | GATE03 : un second propriétaire sans aucun rôle, verrou partagé détenu : `409 CONTEXT_CHANGED`, aucun rôle ni version écrit. |
| La correction ne crée plus les rôles manquants, ou les duplique | GATE03 : après libération, 201 et exactement les neuf rôles ; une création suivante (201) ne les change pas ; deux versions. |

`e2e/army/local/estimate-create-calculation-gate.e2e.ts` utilise le login UI
ordinaire, des affaires ARMY neuves et les routes réelles. Il est sélectionné
avec `tech-debt-lock-boundaries.e2e.ts` dans les listes `critical` locale,
`full` et `army-021` de `e2e.config.ts`, car il exige le transport SQL réservé
aux parcours (`E2E_ARMY_LOCAL_DB_URL` / `E2E_ARMY_LOCAL_PSQL`, exporté par
`e2e/army/takeoff/generated-prerequisites.ts`). Les aides sont dans
`e2e/army/local/calculation-gate-support.ts` :

- le détenteur ouvre une transaction psql nommée
  `army_gate_<scénario>_<aléa>`, prend
  `pg_advisory_xact_lock_shared(hashtextextended('estimate-calculation:<tenant>', 0))`,
  et n'est considéré prêt que lorsque `pg_locks` montre ce verrou exact
  accordé ; la libération exige `COMMIT`, une sortie nulle et zéro verrou
  restant. `idle_in_transaction_session_timeout` (30 s) borne un détenteur
  abandonné ;
- le second propriétaire (GATE03) est créé en `postgres` dans le tenant ARMY
  dont l'acteur est administrateur : une ligne `auth.users` qui ne se connecte
  jamais (le trigger d'inscription lui donne son propre espace personnel) et un
  projet ARMY qu'il possède. Il n'est pas membre du tenant ARMY ; supprimer des
  rôles du compte de recette aurait perturbé les workers parallèles.

Les preuves métier (`calculation-gate-01`, `-02`, `-03-fixture`, `-03`)
conservent tenant, identités, nom du détenteur, statuts, codes et détails
d'erreur publics, rôles avant/après et valeurs attendues ; elles sont écrites
avant les assertions pour qu'un rouge garde le résultat réel.

## Correction

- `ensureDefaultLaborRoles` lit les rôles par défaut du propriétaire et
  n'écrit que les manquants. Un refus du verrou est retenté une fois après
  150 ms depuis une relecture ; un refus résiduel remonte en
  `409 CONTEXT_CHANGED`. Comme avant, les rôles sont créés à la première
  création du propriétaire et un rôle par défaut supprimé ou renommé réapparaît
  à la création suivante ; seule l'écriture inutile disparaît.
- `mapSupabaseError` traduit précisément `40001` +
  `ESTIMATE_CREATE_CONTEXT_CHANGED` en 409 `CONTEXT_CHANGED` (« Un calcul de
  devis est en cours dans l'entreprise. Réessayez dans un instant. »). Les
  autres écritures gardées par ce trigger et passant par cette fonction (rôles
  MO, tranches de marge, flags, adhésions) répondent donc aussi 409 au lieu de
  400 ; les autres 40001 sont inchangés.
- OpenAPI : la description du 409 de `POST /api/estimates` est précisée.
- Aucune migration : le garde SQL et son contrat restent inchangés.

## Validation

Checkout Linux dédié sous WSL (`~/miaouffrage-calc-gate-20261016`, Node 24.19),
révision `de54931d` plus les seuls changements de ce lot ; une pile native
possédée par exécution, jamais en même temps que celle d'une autre session.
Commande : `npm run e2e:army:local -- [--grep 'GATE0'] --app-port 3131`, avec
`E2E_ARMY_WORKERS` pour les campagnes parallèles. Preuves copiées avec
empreintes (`SHA256SUMS`) sous `.codex-tmp/calc-gate-20261016/` du checkout
principal.

| Exécution | Sources | Résultat |
| --- | --- | --- |
| `red-gate`, 1 worker, `GATE0` | parcours seul, produit inchangé | Rouge 3/3 attendus. GATE01 : création `400 BAD_REQUEST {code: 40001}` pendant que la ligne (201) et les réglages (200) réussissent sous le même verrou. GATE02 : 5 créations sur 16 en 400, lignes et réglages 16/16. GATE03 : 400 au lieu de 409, aucune écriture partielle. |
| `green-gate`, 1 worker, `GATE0` | avec correction | Vert 3/3 : création 201 sous le verrou détenu, 32/32 écritures concurrentes, `409 CONTEXT_CHANGED` puis 201 et neuf rôles créés une fois. Empreintes de `server.ts`/`errors.ts` du manifeste de build égales aux sources. |
| `w2-full-1`, 2 workers | avec correction | Vert 67/67 (64 existants + 3 GATE), aucune reprise, parcours 346 s (634 s à 1 worker le matin). |
| `w2-full-2`, `w2-full-3`, 2 workers | avec correction | Rouges 66/67, chacun sur HUB02 seul (`team-a-hub.e2e.ts`) : `LOCATOR_AMBIGUOUS`, « Déposez vos pièces ici » trouvé deux fois 29 ms après l'ouverture du hub, une seule fois sur l'écran capturé ensuite. Les GATE ne chevauchent jamais HUB02 (même worker, juste après) ; le parcours concurrent est la duplication, dans les runs verts comme rouges. |

Sur toutes les exécutions corrigées, le journal applicatif ne contient qu'un
seul `40001 ESTIMATE_CREATE_CONTEXT_CHANGED` par run : le 409 voulu de GATE03.
Vitest complet : 3076 réussis, 2 ignorés (`rls.e2e.test.ts`, exécuté par la
matrice RLS du runner, verte à chaque run). OpenAPI régénéré et validé ;
typecheck et ESLint des fichiers touchés passent. `git diff --check` ne
signale que les CR des lignes ajoutées à `server.ts` et `registry.ts`, fichiers
déjà en CRLF dans l'historique ; il est propre avec
`core.whitespace=cr-at-eol`.

Une exécution `w3-full-1` (3 workers, la configuration rouge du matin) a
annoncé `exit=0` en 413 s sur sa sortie, mais la VM WSL s'est arrêtée juste
après (`Wsl/Service/CreateInstance/E_FAIL` au redémarrage, cause non
attribuée) : son journal, son manifeste et son rapport n'ont pas été écrits sur
disque. Elle ne compte pas comme preuve. Le registre de sa pile, resté orphelin,
a été détruit sur son identité exacte (`stop` puis `stack destroy`, répertoire
de travail recréé puis retiré). Après redémarrage, `w3-full-3` (3 workers) est
verte 67/67 avec manifeste `passed`, sans reprise, parcours 349 s : la
configuration rouge du matin passe.

**Requalification parallèle non acquise** : le critère (deux suites complètes
vertes, en commençant par 2 workers) n'est pas atteint. À 2 workers, HUB02,
indépendant de la course corrigée, échoue 2 fois sur 3 ; à 3 workers, une seule
suite verte est prouvée. `E2E_ARMY_WORKERS` reste à 1 par défaut.

## Limites

- La traduction 409 des écritures de configuration (rôles MO, tranches,
  flags, adhésions) n'est pas couverte par un parcours ; seule la création de
  devis l'est.
- Une écriture de configuration pendant un calcul du tenant reste refusée par
  conception du garde ; elle est désormais réessayable. La sélection `full`,
  qui contient `extended/settings-connected.e2e.ts` (tranches et rôles MO),
  n'est pas qualifiée en parallèle.
- La création calcule ses totaux sans le verrou partagé : c'était déjà le cas,
  l'ancienne prise exclusive des rôles étant une instruction séparée,
  antérieure au calcul. Hors périmètre.
