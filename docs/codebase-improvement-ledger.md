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
| 2 | P0 | Rendre migrations et RLS réellement reproductibles | 5/5/3 | 30 | À faire | — |
| 3 | P1 | Unifier la frontière auth/tenant/service-role | 5/5/2 | 40 | À faire | — |
| 4 | P1 | Fiabiliser les garde-fous CI et locaux | 4/4/1 | 40 | À faire | — |
| 5 | P1 | Transactionnaliser les workflows et effets externes | 5/5/4 | 20 | À faire | — |
| 6 | P1 | Décomposer les hotspots par strangler | 5/4/3 | 27 | À faire | — |
| 7 | P2 | Terminer le moteur de calcul v2 et gouverner les contrats | 4/4/4 | 16 | À faire | — |

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
  `middleware.ts`, absent du bundle et fonctionnellement divergent, est conservé
  dans ce lot afin que sa suppression ou fusion soit traitée avec les invariants
  auth du lot 3 plutôt que par une suppression mécanique.
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

- [ ] Rejouer l'historique dans une base éphémère et identifier le premier blocage réel.
- [ ] Corriger uniquement par nouvelles migrations ou outillage, sans réécrire l'historique.
- [ ] Rendre la matrice RLS comportementale et impossible à déclarer verte sans exécution.
- [ ] Synchroniser la documentation et les preuves de schéma.
- [ ] Valider, documenter et committer le lot.

## Lot 3 — Frontière auth/tenant/service-role

- [ ] Créer un contexte serveur unique qui exige un tenant actif.
- [ ] Séparer clairement session utilisateur, autorisation tenant et capacité service-role.
- [ ] Migrer les consommateurs par façade compatible et ajouter des règles d'architecture.
- [ ] Couvrir les chemins positifs, tenant inactif et accès inter-tenant.
- [ ] Valider, documenter et committer le lot.

## Lot 4 — Garde-fous CI et locaux

- [ ] Ajouter build et smoke de production aux contrôles requis.
- [ ] Ajouter audit de dépendances avec exceptions explicites, justifiées et expirables.
- [ ] Empêcher les nouveaux cycles et l'aggravation des hotspots par baseline.
- [ ] Ajouter des seuils ciblés sur les frontières critiques, sans seuil global cosmétique.
- [ ] Valider, documenter et committer le lot.

## Lot 5 — Workflows et effets externes transactionnels

- [ ] Transactionnaliser d'abord la réécriture des bons de commande.
- [ ] Introduire une outbox idempotente pour les envois et dispatchs externes retenus.
- [ ] Distinguer état métier, livraison en attente, succès et échec réconciliable.
- [ ] Ajouter retry, reprise des états bloqués et tests d'échec intermédiaire.
- [ ] Valider, documenter et committer le lot.

## Lot 6 — Décomposition des hotspots par strangler

- [ ] Poser des tests comportementaux sur les hotspots ciblés avant extraction.
- [ ] Extraire des cas d'usage derrière des façades compatibles, sans migration big-bang.
- [ ] Casser le cycle runtime Estimates ↔ ouvrages générés.
- [ ] Réduire le rôle d'orchestrateur des grands hooks et composants choisis.
- [ ] Mesurer taille, complexité, fan-out et couverture avant/après.
- [ ] Valider, documenter et committer le lot.

## Lot 7 — Moteur de calcul v2 et contrats

- [ ] Établir des fixtures golden v1/v2 et préserver les devis historiques scellés.
- [ ] Basculer les nouvelles versions, l'éditeur et les exports sur le contrat gouverné.
- [ ] Réduire progressivement les branches v1 sans réécrire l'historique métier.
- [ ] Vérifier l'exhaustivité routes ↔ OpenAPI et expliciter les exclusions.
- [ ] Régénérer et valider les artefacts de contrat concernés.
- [ ] Valider, documenter et committer le lot.
