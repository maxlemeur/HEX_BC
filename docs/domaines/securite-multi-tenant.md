# Frontières de sécurité

Repères relus sur le code le 23 octobre 2026. Ce document décrit les invariants
à préserver ; il ne remplace ni les politiques SQL effectives ni une vérification
de l'environnement déployé. Les dispositions du scan restent dans le
[registre de remédiation](../security-remediation-91386191.md).

## Utilisateur, tenant actif et rôles

[tenant-context.ts](../../src/lib/auth/tenant-context.ts) centralise
l'authentification serveur (`auth.getUser`) et la résolution du membership actif :
membership par défaut, sinon le plus ancien, en excluant les tenants suspendus.
Cette lecture est mémorisée à l'échelle de la requête, pas entre utilisateurs.

[proxy.ts](../../src/proxy.ts) rafraîchit la session et redirige les pages
dashboard non authentifiées. Une redirection ou un bouton masqué ne constitue
pas une autorisation : les routes et fonctions serveur doivent encore contrôler
tenant, rôle, ressource et opération.

Les rôles tenant sont `admin`, `engineer`, `director`, `viewer`. Le rôle du
profil est une notion distincte. Les écritures de devis exigent `admin` ou
`engineer` ; les décisions d'approbation exigent `admin` ou `director`, avec les
contrôles d'accès supplémentaires du workflow.
Voir [write-access.ts](../../src/lib/estimates/write-access.ts),
[approvals/server.ts](../../src/lib/approvals/server.ts) et
[memberships/server.ts](../../src/lib/memberships/server.ts).

L'auto-inscription crée un espace personnel isolé et son membership ; les
métadonnées fournies par l'utilisateur n'accordent pas de rôle privilégié.
Voir [migration d'inscription](../../supabase/migrations/20260713132306_isolate_self_signup_tenants.sql).

## Base de données et clients privilégiés

Les RLS, contraintes et triggers complètent les vérifications applicatives.
Lire les définitions **dans l'ordre des migrations** : compter les `create policy`
de l'historique ne donne pas le nombre de politiques actives.
Les fonctions `current_tenant_id`, `is_tenant_member` et `has_tenant_role`
contrôlent notamment le tenant actif ; le privilège transversal administrateur
reste une frontière distincte à préserver.
Voir [helpers d'autorisation](../../supabase/migrations/20260713135334_harden_active_tenant_and_profile_rls.sql)
et [durcissement des tenants actifs](../../supabase/migrations/20260811212848_enforce_active_tenant_boundaries.sql).

Le [client service-role](../../src/lib/supabase/service-role.ts) contourne les
RLS. Sa clé reste côté serveur. Toute utilisation doit être précédée d'un
contrôle explicite de l'acteur et du périmètre, ou relever d'une capacité/route
interne dédiée. Une RPC privilégiée ne doit pas faire confiance au seul
`tenant_id` ou `user_id` fourni par l'appelant. Les fonctions internes conservent
leurs restrictions d'exécution et de `search_path`.

## Documents, portail et effets externes

- Les chemins Storage doivent être validés contre leur ressource propriétaire.
  Une URL signée est une capacité temporaire ; le chemin ne prouve pas l'accès.
  Les validations d'upload vivent dans [file-validation.ts](../../src/lib/file-validation.ts)
  et les modules de documents concernés.
- Le portail vérifie token, échéance, tenant actif et offre émise. Il rend le
  contrat client prévu, sans exposer les données internes du devis. Voir
  [portal-offer.ts](../../src/lib/estimates/portal-offer.ts) et
  [offer-document.ts](../../src/lib/estimates/offer-document.ts).
- La publication PDF contrôle jeton de génération, révision et dispatch ; les
  snapshots, sceaux et montants émis sont immuables. Voir le
  [cycle de vie](../metier/cycle-de-vie.md).
- Les workers et reprises contrôlent le tenant actif avant les effets externes
  et respectent leur bail. Un worker remplacé ne doit pas persister un résultat
  tardif. Voir [active-tenant.ts](../../src/lib/workflows/active-tenant.ts),
  [durable-recovery.ts](../../src/lib/workflows/durable-recovery.ts) et
  [async-worker.ts](../../src/lib/takeoff/async-worker.ts).
- Les feature flags changent la disponibilité fonctionnelle ; ils ne remplacent
  ni autorisation ni RLS. Les exceptions d'environnement doivent être lues dans
  le consommateur, notamment [takeoff/feature-flags.ts](../../src/lib/takeoff/feature-flags.ts).

## Vérifier une modification

Choisir les preuves à la frontière affectée : refus croisés entre tenants,
rôles non autorisés, tenant suspendu, révision ou bail obsolète, chemin Storage
étranger, offre/document incohérents et rejeu d'effet externe. Conserver les
tests SQL/RLS et de concurrence que le navigateur ne peut pas remplacer.

Les [tests SQL](../../supabase/tests/database/) couvrent notamment gouvernance,
approbations, portail, outbox et moteur 3. Les parcours se trouvent dans
[e2e/army](../../e2e/army/) ; les commandes et protections restent dans le
[guide CI](../testing/tester-army-ci.md) et le
[runbook Supabase](../../supabase/README.md). Cette revue documentaire n'exécute
pas ces suites et ne modifie aucun accès ni environnement distant.

Les contraintes de chemins Storage et de cascade des plans sont définies par
[la migration plans](../../supabase/migrations/20260224203000_tkf017_takeoff_plans.sql)
et ses durcissements ultérieurs. Les
[anciens diagnostics TKF017](https://github.com/maxlemeur/HEX_BC/blob/9ee18ca8187d1e4f76e8b196be90d85e2fa1334b/supabase/migrations/20260224203000_tkf017_takeoff_plans_smoke_test.md)
restent consultables dans Git. Leur retrait de la documentation courante ne
prouve pas une couverture automatisée équivalente de chaque assertion de
profondeur de chemin, fichier orphelin ou cascade `plan_sets → plan_files`.
