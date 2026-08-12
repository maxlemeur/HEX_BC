# Registre d'amélioration de la codebase

Ce document est la checklist d'exécution durable du chantier lancé le 11 août 2026.
Chaque lot doit rester atomique, être validé à hauteur de son risque et produire un
commit local dédié. Aucun push, déploiement ou changement Supabase distant ne fait
partie de ce chantier sans autorisation distincte.

## Règles de clôture d'un lot

- Le périmètre et les invariants à préserver sont écrits avant modification.
- Les régressions ciblées, le lint des fichiers touchés et `git diff --check` passent.
- Typecheck, Vitest complet, build ou E2E sont ajoutés selon le rayon d'impact.
- Les limites de validation et les effets externes non exécutés sont consignés.
- Le diff complet est relu, puis seuls les fichiers du lot sont commités.

## Vue d'ensemble

| Ordre | Priorité | Lot | I/R/E | Score | Statut | Commit |
| ---: | :---: | --- | :---: | ---: | :---: | --- |
| 0 | Prérequis | Migrer Next.js vers 16.3 | — | — | Terminé | `chore(deps): upgrade Next.js to 16.3` |
| 1 | P0 | Corriger les dépendances exposées et identifiants E2E | 5/5/2 | 40 | Terminé | `fix(security): harden document dependencies and E2E credentials` |
| 2 | P0 | Rendre migrations et RLS réellement reproductibles | 5/5/3 | 30 | Terminé | `fix(db): make local migrations and RLS reproducible` |
| 3 | P1 | Unifier la frontière auth/tenant/service-role | 5/5/2 | 40 | Terminé | `fix(auth): unify active tenant boundaries` |
| 4 | P1 | Fiabiliser les garde-fous CI et locaux | 4/4/1 | 40 | Terminé | `ci: enforce production quality gates` |
| 5 | P1 | Transactionnaliser les workflows et effets externes | 5/5/4 | 20 | Terminé | `fix(workflows): make external effects recoverable` |
| 6 | P1 | Décomposer les hotspots par strangler | 5/4/3 | 27 | Terminé | `refactor(architecture): deepen workflow modules` |
| 7 | P2 | Terminer le moteur de calcul v2 et gouverner les contrats | 4/4/4 | 16 | Terminé | `feat(estimates): govern calculation engine v2` |

Le score reprend la formule de priorisation de l'audit :
`(impact + risque) × (6 - effort)`.

## Lot 0 — Migration Next.js 16.3

### Périmètre

- [x] Passer `next` et `eslint-config-next` de 16.2.10 à 16.3.0.
- [x] Garder React et React DOM à leur version actuelle si les peer dependencies le permettent.
- [x] Vérifier les conventions Next.js obsolètes ou concurrentes dans le dépôt.
- [x] Examiner le diff du lockfile et l'état de l'audit de dépendances.
- [x] Exécuter OpenAPI, typecheck, lint, Vitest complet et build de production.
- [x] Effectuer un smoke HTTP sur le build produit si l'environnement local le permet.
- [x] Relire, documenter et committer le lot sans push.

### Preuves et décisions

- État initial : `main` propre à `9ba8717d`, Node 24.14.0, npm 11.4.1.
- Cible vérifiée au registre npm : Next.js 16.3.0 accepte Node >= 20.9 et React 18/19.
- Guide officiel consulté : le codemod de montée majeure 15 → 16 n'est pas
  requis pour cette montée mineure déjà située en 16.x ; les incompatibilités
  locales restent néanmoins vérifiées par recherche et par build.
- `src/proxy.ts` est l'unique frontière compilée par Next.js 16.3.0. Le vieux
  `middleware.ts`, absent du bundle et fonctionnellement divergent, avait été
  conservé afin que sa suppression soit traitée avec les invariants auth du lot 3.
- Le lockfile reflète les dépendances natives de Next.js 16.3, notamment Sharp 0.35.
- L'audit de production après migration recense 6 vulnérabilités restantes
  (4 élevées, 2 modérées), contre 17 avant migration. Elles relèvent du lot 1.

### Validation

- `npm run validate-openapi` : succès.
- `npm run typecheck -- --incremental false` : succès.
- `npm run lint` : succès, zéro avertissement.
- `npx vitest run --maxWorkers=4` : 510 fichiers réussis, 1 ignoré ;
  3 548 tests réussis, 2 ignorés.
- `npm run build` : succès avec Next.js 16.3.0 et Turbopack, 42 pages statiques générées.
- `npm run build -- --webpack` : succès avec Next.js 16.3.0 et Webpack,
  chemin de build configuré par `vercel.json`.
- Smoke `next start` : HTTP 200 sur un asset statique, `/` et `/login`.
- Effets externes : aucun push, déploiement, envoi ou changement Supabase distant.

## Lot 1 — Dépendances exposées et identifiants E2E

- [x] Recalculer l'audit de production après le lot Next.js.
- [x] Mettre à niveau PDF.js et ses tests de worker/budget.
- [x] Remplacer ou confiner les parseurs tableurs encore vulnérables.
- [x] Supprimer tout identifiant E2E de repli du code et échouer fermé sans secrets.
- [x] Ajouter les régressions et contrôles de dépendances adaptés.
- [x] Valider, documenter et committer le lot.

### Preuves et décisions

- `pdfjs-dist` est épinglé à 6.2.108, première version corrigée de
  GHSA-hq66-cqwq-w95j. Le parseur désactive explicitement le scripting et reste
  enfermé dans un `worker_threads.Worker` terminable avec budgets de temps et de
  mémoire déjà couverts par les tests.
- Les polices standard résolues dynamiquement par PDF.js sont maintenant incluses
  dans les traces des trois routes `/api/imports`. Les manifestes de production
  contiennent le module PDF.js et les polices sous Turbopack comme sous Webpack.
- SheetJS est remplacé par le tarball officiel 0.20.3, avec URL versionnée et
  intégrité SHA-512 dans le lockfile. Les chemins CommonJS, ESM, worker et les
  exports XLSX existants ont été exercés.
- La dépendance `uuid` d'ExcelJS est forcée à 11.1.1. Une régression traverse la
  mise en forme conditionnelle qui appelle `uuid.v4()` et une autre le writer
  streaming réellement utilisé par les exports.
- Les valeurs E2E de repli ont été retirées du code et de la documentation
  courante. Un validateur unique exige les quatre variables critiques, rejette
  les valeurs blanches et ne rapporte que leurs noms ; la CI appelle ce même
  contrat avant Playwright. La clé service-role reste facultative et n'est pas
  injectée globalement afin de ne pas contourner les tests RLS utilisateur.
- La rotation/révocation du compte exposé et une éventuelle purge destructive de
  l'historique Git sont des effets externes non exécutés dans ce lot. Les valeurs
  antérieures doivent être considérées compromises jusqu'à rotation.
- Limite conservatrice : un ancien fichier BIFF `.xls` utilisant une codepage
  étendue n'est pas présent dans les fixtures. Les formats XLSX/XLSM du dépôt
  passent ; la compatibilité de ce cas historique reste à verrouiller séparément.

### Validation

- `npm ci` : succès depuis le lockfile, 850 paquets installés ; audit complet à
  zéro vulnérabilité connue.
- `npm audit --omit=dev` : zéro vulnérabilité de production.
- Tests ciblés : 14 fichiers et 72 assertions réussis après isolation des groupes ;
  un premier run groupé avait fait sortir un worker Vitest sans assertion en échec.
- `npm run lint` et `npm run typecheck` : succès.
- `npx vitest run --maxWorkers=4` : 512 fichiers réussis, 1 ignoré ;
  3 554 tests réussis, 2 ignorés.
- Contrat Playwright : le projet setup découvre bien le test d'authentification et
  le validateur accepte un environnement synthétique complet.
- `npm run build` et `npm run build -- --webpack` : succès avec Next.js 16.3.0 ;
  OpenAPI est valide et synchronisé dans les deux cas.
- Effets externes : aucun push, déploiement, envoi, rotation de compte ou
  changement Supabase distant.

## Lot 2 — Migrations et RLS reproductibles

- [x] Rejouer l'historique dans une base éphémère et identifier le premier blocage réel.
- [x] Corriger uniquement par nouvelles migrations ou outillage, sans réécrire l'historique.
- [x] Rendre la matrice RLS comportementale et impossible à déclarer verte sans exécution.
- [x] Synchroniser la documentation et les preuves de schéma.
- [x] Valider et documenter le lot.
- [x] Committer le lot.

### Preuves et décisions

- Supabase CLI est épinglé exactement à `2.109.1`, version du dernier reset
  historique prouvé. Le seed est explicitement désactivé tant qu'aucun
  `supabase/seed.sql` suivi n'existe.
- Le manifeste SHA-256 couvre les 194 migrations. Les 35 noms legacy et l'unique
  tombstone vide sont figés ; toute nouvelle migration doit utiliser un horodatage
  UTC à 14 chiffres strictement postérieur à la base Git.
- Le garde Git compare la branche au SHA cible : une migration déjà présente ne
  peut être ni modifiée, ni supprimée, ni renommée, même si son hash de manifeste
  est modifié dans le même changement. Seuls l'ajout d'une migration canonique et
  l'évolution cohérente du manifeste sont admis.
- Le workflow `E2E RLS Matrix` n'utilise plus aucun secret distant ni chemin de
  succès par skip. Il démarre un projet Supabase éphémère à ports uniques, rejoue
  l'historique, contrôle l'inventaire, exécute pgTAP, provisionne trois utilisateurs
  Auth locaux, exige exactement deux tests RLS réussis, puis arrête sans backup et
  supprime la pile éphémère. Cette suppression est la frontière de cleanup : le test
  ne contourne pas les triggers immuables pour effacer ses fixtures.
- Les quatre migrations historiques date-only restent non renommées. Comme la CLI
  les exécute mais ne les marque pas dans la colonne d'historique appliqué, pgTAP
  vérifie directement leurs neuf index, la liaison DPGF, l'unicité tenant-aware,
  les trois RPC analytics et l'absence de l'ancienne contrainte.
- Deux nouvelles migrations UTC restaurent les privilèges relationnels absents
  d'un reset frais : capacité serveur sur les tables/séquences publiques, puis
  allowlist Data API des tables Estimates, audit, plans et takeoff réellement utilisées.
  `audit_logs` reste append-only hors lecture admin.
- Le privilège `DELETE` de `estimate_projects` reste nécessaire à la RPC
  `SECURITY INVOKER` appelée par la route API, ainsi qu'aux quatre rollbacks de
  création. Une policy
  restrictive ajoute les invariants opérateur et non-archivé ; le trigger existant
  conserve l'invariant « versions draft uniquement » sans récursion RLS.
- Les écritures takeoff authentifiées sont limitées à `admin|engineer`. Une policy
  et des triggers refusent un état initial, tenant, version, chemin Storage ou
  plan-set forgé, ainsi que les champs worker/provider. La RPC d'application gardée
  pose seule le marqueur transactionnel et refuse les viewers ; la matrice exerce
  aussi le cas d'un propriétaire rétrogradé viewer.
- Le workflow échoue fermé sur toute dérive détectée. Son caractère bloquant pour
  un merge dépend toutefois de la protection de branche GitHub, non vérifiée ici.
- La route DELETE délègue désormais au chemin canonique
  `bulkDeleteDraftAffaires`/RPC. La matrice appelle réellement la RPC sur une affaire
  avec journaux intake/register, vérifie leur cascade et refuse une version non-draft.
  Le test de route couvre séparément le mapping HTTP avec une RPC mockée ; il ne
  constitue pas un E2E HTTP vers PostgreSQL.

### Validation

- `npm run supabase:migrations:git-guard` : succès sur le diff local, trois chemins
  Supabase ajoutés dans ce lot.
- `npm run supabase:validate` : 194 fichiers, 194 versions uniques, manifeste exact.
- `npm run db:ci:local` : reset réel vert sous Docker, inventaire local cohérent,
  pgTAP vert et matrice RLS comportementale 2/2 verte avec trois comptes éphémères.
- Tests ciblés runner, garde Git, historique, route DELETE, helper de suppression et
  workflows takeoff : 7 fichiers et 66 tests verts ; lint global et typecheck verts.
- `npm audit` et `npm audit --omit=dev` : zéro vulnérabilité après ajout de la CLI.
- Les deux runs Vitest globaux antérieurs aux derniers scénarios ne sont pas une
  preuve du snapshot final : l'un avait un timeout isolé, l'autre une sortie de
  worker sans assertion métier en échec. La stabilité du pool reste au lot 4.
- Effets externes : aucun projet lié, aucune migration distante, aucun push ni
  déploiement.

## Lot 3 — Frontière auth/tenant/service-role

- [x] Créer un contexte serveur unique qui exige un tenant actif.
- [x] Séparer clairement session utilisateur, autorisation tenant et capacité service-role.
- [x] Migrer les consommateurs par façade compatible et ajouter des règles d'architecture.
- [x] Couvrir les chemins positifs, tenant inactif et accès inter-tenant.
- [x] Valider et documenter le lot.
- [x] Committer le lot.

### Preuves et décisions

- `src/lib/auth/tenant-context.ts` est la frontière canonique : lecture de la
  session, résolution ordonnée d'une membership dont le tenant est actif, puis
  contexte strict avec rôle et statut administrateur. La façade historique
  d'Estimates reste un adaptateur étroit, sans seconde implémentation.
- Les clones de résolution tenant et les consommateurs qui importaient le
  god-module Estimates pour l'auth utilisent désormais ce module. Les variantes
  dont le contrat d'erreur est spécifique réutilisent les primitives neutres au
  lieu de dupliquer la requête.
- La construction et le cache service-role locaux d'Estimates sont supprimés au
  profit de `src/lib/supabase/service-role.ts` ; son petit wrapper de compatibilité
  ne fait que déléguer. Le worker takeoff utilise lui aussi cette factory et la
  clé service-role n'est plus relayée par header entre l'Edge Function et Next.js.
- Une régression d'architecture scanne les sources de production : elle interdit
  le retour d'un import auth depuis le god-module Estimates, toute nouvelle
  factory service-role directe et tout header de relais de la clé privilégiée.
  Les mocks testent désormais la frontière canonique.
- Le `middleware.ts` legacy, ignoré par Next.js 16, est supprimé. La régression
  interdit son retour et reconnaît `src/proxy.ts` comme unique frontière de refresh
  cookies et de redirection de session ; la documentation sécurité est alignée.
- La migration append-only
  `20260811212848_enforce_active_tenant_boundaries.sql` rend les ACL legacy
  déterministes : `authenticated` a uniquement `SELECT` sur `tenants` et le CRUD
  requis sur `tenant_memberships`, toujours sous RLS ; `anon` et `PUBLIC` restent
  révoqués. Les policies masquent tenant et memberships dès suspension.
- Les pages et décisions du portail public filtrent aussi le tenant actif. La RPC
  service-role verrouille ensemble tenant et version avant de réclamer un token :
  une suspension concurrente ne peut donc laisser une décision partielle.
- Les tokens existants ne sont ni expirés ni détruits : ils sont suspendus tant
  que le tenant est inactif et redeviennent utilisables après réactivation
  seulement s'ils sont encore pending et non expirés.
- Le changement de tenant par défaut passe par une RPC atomique et bornée à
  `auth.uid()`. Elle verrouille aussi l'ancien défaut masqué par une suspension,
  refuse une cible inactive ou étrangère et préserve la règle qui interdit de
  quitter un défaut non-admin.
- Limite volontaire : les workers takeoff/intake utilisant le service-role ne
  définissent pas encore le cycle de vie d'un travail déjà en file lors d'une
  suspension. Cette décision métier (pause réversible, annulation ou reprise) est
  reportée au lot 5 plutôt que d'introduire silencieusement un état irréversible.

### Validation

- `npm run supabase:validate` : 195 fichiers et 195 versions uniques, manifeste exact.
- `npm run supabase:migrations:git-guard` : succès, quatre chemins Supabase autorisés.
- `npm run db:ci:local` : reset frais, inventaire exact, pgTAP vert et matrice RLS
  comportementale 2/2 verte. Le scénario couvre la relation PostgREST
  `tenants!inner`, le contournement historique `created_by`, le tenant suspendu et
  le token portail sans mutation partielle, ainsi que le basculement atomique
  depuis un ancien défaut suspendu.
- Tests ciblés worker/factory/frontières d'architecture : 4 fichiers et 25 tests verts.
- `npm run lint` et `npm run typecheck` : succès.
- `npx vitest run --maxWorkers=4` : 515 fichiers réussis, 1 ignoré ;
  3 583 tests réussis, 2 ignorés.
- `npm run build` : OpenAPI valide, compilation Next.js 16.3 réussie et 42 pages
  statiques générées ; la sortie confirme `src/proxy.ts` comme unique Proxy.
- Effets externes : aucun projet Supabase distant lié ou modifié, aucun push ni
  déploiement.

## Lot 4 — Garde-fous CI et locaux

- [x] Ajouter build et smoke de production aux contrôles requis.
- [x] Stabiliser le pool Vitest global et rendre les limites de ressources explicites en CI.
- [x] Ajouter audit de dépendances avec exceptions explicites, justifiées et expirables.
- [x] Empêcher les nouveaux cycles et l'aggravation des hotspots par baseline.
- [x] Ajouter des seuils ciblés sur les frontières critiques, sans seuil global cosmétique.
- [x] Valider, documenter et committer le lot.

### Preuves et décisions

- Le check existant `Quality Gate` reste sans secret et conserve son nom afin de
  réutiliser une éventuelle règle de branche. Il contrôle désormais dépendances,
  signatures, architecture, OpenAPI, TypeScript, ESLint, les deux projets Vitest,
  les seuils critiques, puis le même build Webpack que celui configuré dans
  `vercel.json`.
- `verify:production` produit lui-même l'artefact, démarre directement
  `next start` sur loopback, vérifie `/`, `/login`, la redirection d'authentification de
  `/dashboard` et un asset émis sous `/_next/static`, puis exige la terminaison du
  processus et la fermeture du stub local. Le premier prototype a révélé puis
  corrigé un orphelin Windows causé par le wrapper `npm run start`.
- Vitest utilise explicitement `forks` et quatre workers. Un timeout XLSX observé
  sous contention n'était pas reproductible fonctionnellement ; les deux cas
  `header-row` concernés par le timeout observé disposent désormais d'un budget
  de 15 secondes. Les autres tests conservent le timeout strict par défaut.
- L'audit npm bloque toute alerte `moderate`, `high` ou `critical`. Une exception
  doit correspondre exactement au paquet et à la source npm, nommer un responsable,
  contenir une justification et une expiration UTC ; exception expirée, dupliquée
  ou devenue inutile fait elle aussi échouer le gate. La baseline ne contient
  aucune exception.
- Le budget d'architecture analyse les imports runtime TypeScript et refuse tout
  nouveau cycle ou extension de composante fortement connexe. Le seul cycle
  autorisé reste Estimates ↔ ouvrages générés. Les 37 modules déjà au-dessus de
  1 000 lignes non vides ont chacun un plafond exact ; tout autre module dépassant
  1 000 lignes échoue. Une hausse de baseline reste un changement de configuration
  visible à relire, pas une autorisation implicite.
- La couverture est ciblée sur `tenant-context`, la factory service-role et le
  validateur E2E, avec seuils par fichier. Aucun seuil global artificiel ne masque
  les grands domaines historiques encore insuffisamment couverts.
- Les actions GitHub sont épinglées par SHA complet et Dependabot suit npm et les
  actions. Le backup installe sans scripts, vérifie les signatures puis la CLI
  Supabase verrouillée `2.109.1` avant de recevoir l'URL DB dans les seuls steps de
  validation et dump.
- Les workflows qui reçoivent un secret ne sont plus déclenchables manuellement
  depuis une branche. Le Playwright distant ne tourne qu'après `push main`, dans
  l'environnement GitHub nommé `e2e-staging`, sans service-role ni traces archivées ;
  les deux skips takeoff deviennent des échecs CI, les flakies sont refusés, et les
  scénarios critiques vérifient route et statut final.
- Limite assumée : le workflow de PR couvre le build/smoke sans secret et les tests
  auth unitaires, pas le Playwright distant. La suite distante détecte donc une
  régression fonctionnelle après le push sur `main`. L'environnement `e2e-staging` et le statut
  « required » des checks sont des configurations GitHub externes non vérifiées ici.

### Validation

- `npm run check:quality` : succès en 150,6 s. Audit à zéro finding bloquant,
  868 paquets signés et 309 attestations vérifiées ; OpenAPI, typecheck et lint verts.
- Projet Vitest Node : 321 fichiers réussis, 1 ignoré ; 2 317 tests réussis,
  2 ignorés. Projet jsdom : 198 fichiers et 1 297 tests réussis.
- Couverture critique : 12/12 tests ; 95,91 % statements, 95,45 % branches,
  100 % fonctions et 97,91 % lignes au total, avec seuils par frontière respectés.
- Architecture : 820 modules, 37 budgets explicites et un seul cycle runtime
  autorisé. Les cinq régressions synthétiques du garde sont vertes.
- `npm run verify:production` : Webpack, 42/42 pages, quatre probes HTTP dont un
  asset `_next/static`, puis PID et port fermés ; durée 66,1 s.
- Découverte Playwright critique : 37 tests dans 8 fichiers. La suite distante
  n'a pas été exécutée faute d'autorisation et de secrets staging dans ce checkout.
- `git diff --check` : succès, hors avertissements de normalisation CRLF. Aucun
  workflow GitHub distant, backup, push, release, déploiement ou effet Supabase
  distant n'a été exécuté.

## Lot 5 — Workflows et effets externes transactionnels

- [x] Remplacer ou transactionnaliser les quatre DELETE directs de rollback de création et couvrir leurs échecs intermédiaires.
- [x] Transactionnaliser d'abord la réécriture des bons de commande.
- [x] Introduire une outbox idempotente pour les envois et dispatchs externes retenus.
- [x] Distinguer état métier, livraison en attente, succès et échec réconciliable.
- [x] Ajouter retry, reprise des états bloqués et tests d'échec intermédiaire.
- [x] Définir puis tester le cycle de vie des jobs takeoff/intake déjà en file
  lorsqu'un tenant est suspendu, sans appel fournisseur sur un tenant inactif.
- [x] Valider et documenter le lot.
- [x] Committer le lot.

### Décisions et périmètre

- Sept migrations append-only introduisent les baux de reprise takeoff/intake,
  l'état `sending`, l'outbox d'email initial, les écritures atomiques devis/commandes,
  le cleanup Storage procurement, le fencing de publication PDF et le compteur
  `sending` des affaires. Les claims, renouvellements et finalisations contrôlent
  le tenant actif et utilisent des tokens de bail ou de publication comparés sous
  verrou ; la reprise interne est exposée derrière `CRON_SECRET`.
- L'envoi initial d'un devis est préparé dans une transaction : enveloppe, contenu,
  PDF et clé fournisseur sont figés avant Resend. Un `Idempotency-Key` UUID stable
  permet le replay du même dispatch ; un rejet fournisseur certain rend le dispatch
  terminal et impose une nouvelle clé, tandis qu'une issue ambiguë devient
  réconciliable sans annoncer à tort un succès.
- Toute nouvelle publication PDF utilise la clé immuable
  `tenant/projet/version/<sha256>.pdf`, avec upload `upsert: false` puis publication
  conditionnée par le token, la révision, le statut et le dispatch. La lecture
  historique reste bornée à un unique nom de fichier PDF déjà référencé, UUID ou
  nom commercial historique, qui ne peut changer ni de chemin ni d'empreinte.
- La réécriture et la suppression d'une commande sont atomiques en base. Les chemins
  Storage à supprimer sont capturés dans une outbox durable, puis revalidés dans le
  namespace strict `purchase-orders/<purchase_order_id>/<filename>` avant l'appel
  privilégié. La création d'un devis et le remplacement des lignes de commande ne
  reposent plus sur des `DELETE` applicatifs compensatoires.

### Validation

- Manifeste migrations, validation et garde Git : 202/202 fichiers cohérents.
  `npm run db:ci:local` est vert sur un reset frais : inventaire exact, pgTAP,
  matrice RLS 2/2 et cleanup complet de la pile éphémère.
- Architecture : 833 modules analysés et un seul cycle runtime autorisé. OpenAPI
  synchronisé, typecheck et lint globaux verts.
- Projet Vitest Node, après un premier crash transitoire d'un worker sans assertion
  métier en échec : relance verte, 330 fichiers réussis, 1 ignoré ; 2 386 tests
  réussis, 2 ignorés. Projet jsdom : 198 fichiers et 1 304 tests réussis.
- Couverture critique : 12/12 tests ; 95,91 % statements, 95,45 % branches,
  100 % fonctions et 97,91 % lignes. Audit : zéro finding bloquant ; 868 paquets
  signés et 309 attestations vérifiées.
- `npm run verify:production` : OpenAPI synchronisé, Next.js 16.3 compilé par
  Webpack en 11,9 s, TypeScript en 3,3 s et 42/42 pages générées. Le serveur
  `127.0.0.1:60003` était prêt en 105 ms ; les probes HTTP et asset sont vertes,
  avec le verdict final `Production Webpack build and HTTP smoke passed.`

### Limites explicites

- Aucun Supabase distant, email réel, fournisseur, push ou déploiement n'a été
  exercé. Le cron toutes les cinq minutes exige Vercel Pro ou Enterprise ; le plan,
  `CRON_SECRET` et le déploiement ne sont pas vérifiés.
- Seul l'email initial passe par l'outbox ; les notifications d'acceptation et
  d'approbation restent best-effort. L'idempotence fournisseur est bornée à 23 h ;
  au-delà, ou si le résultat demeure ambigu, le dispatch reste `unknown` sans
  interface de réconciliation dédiée dans ce lot.
- La concurrence procurement est couverte par verrouillage structurel, pas par un
  vrai test Vn/Vn+1 à deux sessions. Les upserts de catégories et rôles de main-d'œuvre
  précèdent encore la transaction, mais sont idempotents ; la validation directe des
  totaux/FK par RPC est différée au lot 7.
- La réouverture des commandes est préservée. La création multi-fournisseur reste
  séquentielle avec compensation. Une publication PDF supplantée après upload peut
  laisser un objet content-addressé orphelin ; son cleanup différé reste à traiter.

## Lot 6 — Décomposition des hotspots par strangler

- [x] Poser des tests comportementaux sur les hotspots ciblés avant extraction.
- [x] Extraire des cas d'usage derrière des façades compatibles, sans migration big-bang.
- [x] Casser le cycle runtime Estimates ↔ ouvrages générés.
- [x] Réduire le rôle d'orchestrateur des grands hooks et composants choisis.
- [x] Mesurer taille, complexité, fan-out et couverture avant/après.
- [x] Valider, documenter et committer le lot.

### Décisions et mesures

- Le skill `improve-codebase-architecture` et ses dépendances de méthode sont
  verrouillés dans `skills-lock.json`. L'audit a retenu trois seams au test de
  suppression positif : leur retrait remettrait bien la complexité dans les
  orchestrateurs, elle ne disparaîtrait pas derrière un simple adaptateur.
- La provenance des ouvrages générés passe par l'interface unique
  `enrichEstimateItemsWithGeneratedOuvrageProvenance`. `server.ts` ne dépend plus
  du générateur de commandes métier : le cycle runtime Estimates ↔ ouvrages
  générés passe de 1 à 0 et son ancienne allowlist est supprimée.
- Le chargement des sources Takeoff est isolé derrière `loadTakeoffSource` :
  métadonnées, téléchargements Storage, budgets fichiers/octets/pages, validation
  et fusion PDF, puis provenance par page. Baux, états, provider et persistance
  restent dans le processeur.
- `buildAffaireFlowPanelModel` concentre la matrice pure de décision du parcours
  affaire. Le composant conserve rendu, drag/drop, navigation, reclassification
  et effets ; aucune nouvelle couche réseau ou abstraction métier n'est ajoutée.
- Lignes non vides des orchestrateurs : ouvrages générés 4 073 → 3 822,
  processeur Takeoff 4 106 → 3 711, panneau Affaire 2 704 → 1 577. Les nouveaux
  modules profonds comptent respectivement 372, 420 et 908 lignes, tous sous le
  plafond de 1 000.
- Sites de décision dans les orchestrateurs : 460 → 397, 381 → 333 et 556 → 271.
  La complexité combinée n'est pas présentée comme supprimée : elle vaut 479,
  381 et 565 après extraction. Le gain recherché et obtenu est la localité, une
  interface plus petite et un rôle d'orchestration plus net. Le fan-out runtime
  des orchestrateurs vaut respectivement 5 → 5, 16 → 16 et 10 → 9.

### Validation

- Régressions ciblées : 115/115 tests Node et 41/41 tests modèle/UI verts ; les
  tests DOM, interactions et accessibilité existants sont conservés.
- Vitest complet : projet Node 331 fichiers réussis, 1 ignoré, 2 391 tests
  réussis, 2 ignorés ; projet jsdom 199 fichiers et 1 307 tests réussis.
- ESLint global, typecheck, OpenAPI et `git diff --check` : succès. Architecture :
  836 modules, zéro cycle runtime autorisé ou détecté, avec plafonds abaissés aux
  nouvelles tailles.
- Build Webpack Next.js 16.3 : compilation en 10,8 s, TypeScript en 8,1 s et
  42/42 pages générées.
- Aucun push, déploiement, migration distante, fournisseur ou autre effet externe
  n'a été exécuté. Le gros hook éditeur reste volontairement hors de ce strangler :
  son interface actuelle serait trop large et superficielle pour une extraction sûre.

## Lot 7 — Moteur de calcul v2 et contrats

- [x] Établir des fixtures golden v1/v2 et préserver les devis historiques scellés.
- [x] Basculer les nouvelles versions, l'éditeur et les exports sur le contrat gouverné.
- [x] Conserver le moteur v1 comme contrat de compatibilité sans réécrire l'historique métier.
- [x] Inventorier les routes ↔ OpenAPI et expliciter les exclusions.
- [x] Régénérer puis valider les artefacts de contrat et le manifeste de migrations.
- [x] Exécuter les validations finales, relire le diff complet et committer le lot.

### Périmètre et décisions — terminé

- Toutes les créations de devis qui ne sont pas une duplication passent par la
  façade `persistCanonicalEstimateV2` de
  `src/lib/estimates/canonical-v2-creation.ts`. Elle normalise les sources
  vierge, template et import DPGF, calcule le contrat v2, puis franchit un seul
  seam atomique : la RPC service-role `persist_estimate_creation_atomic`. La
  RPC reçoit explicitement `tenant_id` et `actor_user_id`, vérifie l'acteur et
  ses droits, puis crée ou réutilise le projet, la version, la hiérarchie et le
  lien d'import dans une transaction. Le régime contractuel de TVA est conservé
  depuis la requête ou la dernière version ; le cas `subcontractor` est contrôlé
  jusqu'aux totaux de ligne et au pied sans TVA.
- La duplication reste une opération distincte via
  `duplicate_estimate_version` : elle repart en brouillon, ne reprend pas le
  sceau et conserve `calc_engine_version` de la version source. Les anciens
  créateurs SQL sont retirés des chemins applicatifs et leurs droits d'exécution
  sont révoqués ; aucune version historique n'est réécrite ni basculée en v2.
  La même transaction conserve l'AID, la provenance et les liens Takeoff issus
  des jobs directs, des liens hérités et des décisions de revue ; il n'existe
  plus de second passage best-effort propre à la duplication.
- Les brouillons v2 sont calculés en direct. Avant la première capture
  d'approbation et avant l'envoi, `freeze_estimate_v2_snapshot` fige par CAS le
  contexte de calcul, la révision, les totaux de version et cinq colonnes par
  ligne : PU HT net, FO nette, MO nette, MO atelier nette et MO chantier nette.
  Les totaux HT, TVA et TTC de ligne sont figés dans la même opération. Le mode
  `approval` refuse un verrou actif détenu par un autre utilisateur ; le mode
  `send` exige le verrou de brouillon de l'acteur.
- Les changements externes qui participent au calcul invalident atomiquement le
  snapshot des brouillons concernés : tranches de marge, taux ou propriétaire
  d'un rôle référencé et flag `EST_031_LABOR_SPLIT`. Les versions finalisées
  restent immuables. La marge effective v2 provient du multiplicateur réellement
  figé ; en mode par tranches, un snapshot absent ou périmé échoue fermé.
- En v2, tout rôle de main-d'œuvre référencé doit appartenir au propriétaire de
  l'affaire. Le calcul applicatif, la création atomique, le trigger d'item et le
  gel SQL refusent une incohérence avec
  `ESTIMATE_LABOR_ROLE_OWNER_MISMATCH`. Le repli historique à un taux nul reste
  volontairement limité au moteur v1.
- Les surfaces non brouillon relisent les montants figés au lieu de recalculer
  avec les tarifs, paliers ou flags courants : fiche et impression, éditeur en
  lecture seule, PDF, portail client et exports CSV/XLSX/DPGF/BDC. Le sceau v3
  couvre la hiérarchie, les entrées, le contexte, la révision, les cinq snapshots
  et les totaux ; la vérification conserve les candidats v2 et v1 historiques.
- La soumission d'approbation passe par `open_estimate_review_cycle`, une RPC
  service-role idempotente qui crée dans une seule transaction cycle,
  approbations et événement `approval_submitted`. Après une modification, la
  resoumission remplace le cycle obsolète et ses approbations actives sans
  fabriquer de décision. La file, les commentaires et les corrections refusent
  les cycles remplacés ; une demande de corrections crée atomiquement un item
  `pending` par commentaire. Les cycles remplacés restent auditables en base,
  mais ne disposent pas encore d'un rendu dédié dans l'historique UI.
- L'inventaire OpenAPI découvre les méthodes HTTP réellement exportées par les
  fichiers `route.ts` et échoue fermé sur toute opération absente, doublonnée ou
  exclusion obsolète. Le contrat courant répartit 170 opérations en 165
  documentées et 5 exclusions d'infrastructure ou de compatibilité explicitement
  justifiées dans `src/lib/openapi/route-exclusions.ts`.
- Le refactor suit des modules profonds : `estimate-allocation.ts`,
  `estimate-v2-snapshot.ts`, `useEstimateEditorCalculation.ts`,
  `canonical-v2-creation.ts`, `estimate-seal.ts`, `v2-snapshot-server.ts`,
  `approval-v2-snapshot.ts`, `route-contracts*.ts` et `route-coverage.ts`.
  Les orchestrateurs conservent leurs responsabilités de coordination et aucun
  plafond d'architecture n'est relevé pour absorber le lot.
- Contrôle final du 12 août : `npm run check:architecture` passe sur 850 modules,
  sans cycle runtime autorisé ni détecté et sans relèvement de plafond.

### Validation — preuves de clôture

- Tests ciblés : les régressions calcul, snapshot, approbation, création canonique,
  email, PDF, exports et OpenAPI passent ; elles sont aussi incluses dans les
  suites complètes ci-dessous.
- Reset Supabase, pgTAP et matrice RLS : `npm run db:ci:local` passe sur une
  stack Docker éphémère isolée. Le reset local, l'application et l'inventaire
  des 203 migrations, les cinq fichiers pgTAP et la matrice RLS comportementale
  passent ensemble. Cette preuve ne touche aucune base Supabase distante.
- OpenAPI : `npm run validate-openapi` passe avec 125 routes et 170 opérations,
  dont 165 documentées et 5 exclusions explicites. Le manifeste Supabase passe
  `npm run supabase:validate` avec 203 fichiers et 203 versions uniques.
- Qualité agrégée : `npm run check:quality` passe, avec audits dépendances et
  signatures, TypeScript, ESLint, architecture et toutes les suites applicatives.
  Les 868 paquets audités possèdent une signature de registre vérifiée et 309 une
  attestation ; aucune alerte de dépendance bloquante ni exception active.
- Vitest complet : projet Node, 337 fichiers passés et 1 ignoré, 2 474 tests
  passés et 2 ignorés ; projet jsdom, 200 fichiers et 1 314 tests passés.
- Couverture critique : 12/12 tests, 95,91 % des instructions, 95,45 % des
  branches, 100 % des fonctions et 97,91 % des lignes.
- Build Next.js 16.3 : `npm run verify:production` passe avec Webpack,
  compilation en 10,3 s, TypeScript en 4,2 s, 42/42 pages générées et smoke HTTP
  du serveur de production réussi.
- `git diff --check` passe ; seuls des avertissements de normalisation CRLF→LF
  sont émis. Deux contre-revues finales indépendantes n'ont identifié aucun
  blocker P0/P1 résiduel ; la dernière a été répétée après la preuve SQL.
- Commit local dédié : `feat(estimates): govern calculation engine v2`.
- Effets externes : aucun n'est requis ni autorisé par ce lot ; la clôture devra
  consigner les actions réellement exécutées sans revendiquer push, déploiement
  ou migration Supabase distante.
