# Dépôt takeoff et idempotence

## Défaillances définies avant correction

Le cas Army TKF05 de candidate 4 a exposé un vrai refus Storage : la première
création CSV avec `Idempotency-Key` reçoit 400 `StorageAccessDenied`. Le dépôt
utilise `upsert` avant la création du job, alors que les politiques SELECT et
UPDATE exigent déjà le job et son chemin exact. INSERT seul autorise le dépôt
initial. Aucune politique RLS ne doit être élargie pour corriger cet ordre.

Les autres défaillances à préserver dans cette correction sont :

- Deux requêtes de même clé et contenu peuvent passer ensemble la recherche
  initiale. Une erreur Storage sur le chemin partagé empêcherait l'arbitrage
  par la clé primaire du job et ferait échouer une création idempotente valide.
- Un chemin partagé rend le fichier du gagnant vulnérable au remplacement ou
  au nettoyage de la tentative perdante ; inversement, un chemin distinct non
  nettoyé laisserait un objet orphelin.
- Une même clé avec un autre contenu doit rester un conflit 409 et préserver
  intégralement le job et le fichier retenus.
- Un replay après succès doit retourner le même job sans nouveau dépôt ni
  nouvel audit, y compris lorsque les conditions de création ont changé.

## Exception d'isolation

TKF05 vérifie le vrai Storage et le parcours HTTP, mais ne peut pas imposer
de façon répétable l'intervalle entre les recherches d'idempotence et les
INSERT concurrents. La suite existante `src/app/api/takeoff/jobs/route.test.ts`
force cet intervalle avec une barrière de deux uploads. Son stockage simulé
conserve les contenus et applique les suppressions réelles du rollback : les
oracles portent sur un seul job, la même identité retournée, le contenu encore
lisible du fichier gagnant et l'absence du fichier perdant. Ces régressions
sont écrites et exécutées rouges avant le changement de `server.ts`.

Le correctif garde le job déterministe par tenant et clé, mais attribue
un chemin immutable propre à chaque tentative. Le fingerprint reste lisible
dans le chemin pour reconnaître les replays historiques. L'INSERT unique du
job tranche les courses ; seule la tentative perdante est nettoyée.

La suite ciblée a produit 19 réussites et deux échecs avant correction : refus
400 de l'upload initial et chemin partagé des requêtes identiques concurrentes.
Après correction, les 21 cas ont passé, y compris le conflit de contenu et les
replays historiques. La revue indépendante a ensuite retiré le test isolé du
refus initial et son option de mock : TKF05 couvre déjà ce comportement avec le
vrai Storage. Les deux courses écrites avant code restent conservées ; la suite
finale compte donc 20 cas. Les sorties sont conservées dans
`.codex-tmp/army-migration-20261015/takeoff-upload-before/red-executed.log` et
`green.log`, puis `green-final.log` après ce retrait. Le premier lancement isolé a été bloqué avant collecte par un
renommage de cache Vite interdit dans le sandbox ; ce résultat distinct reste
dans `red.log`. Le rejeu Army avec le vrai Storage reste nécessaire.

## Limite distincte

L'audit est actuellement écrit après l'INSERT du job. Un replay concurrent
peut observer ce job avant un éventuel échec d'audit et son rollback. Cette
fenêtre antérieure n'est pas une garantie transactionnelle apportée par la
correction Storage ; elle demanderait une correction atomique distincte.
