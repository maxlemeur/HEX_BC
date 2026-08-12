# Sécurité, multi-tenant et plateforme

> **Source : le code relu au 2026-08-12 pour les frontières auth/tenant.** Les métriques globales non liées restent la photographie du 2026-07-29. En cas de divergence, le code fait foi et ce document doit être corrigé.

Périmètre couvert : `src/proxy.ts`, `src/lib/auth/**`, `src/lib/supabase/**`, `src/lib/memberships/**`, `src/lib/feature-flags.ts`, `src/lib/file-validation.ts`, les pages `dashboard/{admin,memberships,tenants,profile}`, les routes `api/{memberships,tenants,feature-flags,audit,admin,internal,portal}`, `src/app/{login,signup}`, les tests `*security-regressions.test.ts` + `rls.e2e.test.ts`, et les migrations de durcissement.

---

## 1. Modèle multi-tenant

### 1.1 Tables porteuses

- `public.tenants` : `id`, `name`, `slug unique`, `created_by` (FK `profiles`), `is_active boolean not null default true` — `supabase/migrations/013_multitenant_core_s5.sql:11-19`. `created_by` prend `auth.uid()` par défaut depuis `supabase/migrations/021_fix_bulk_update_tenant_bootstrap_and_admin_hardening_v2.sql:289-290`.
- `public.tenant_memberships` : `tenant_id`, `user_id`, `role public.tenant_role not null default 'viewer'`, `is_default`, contrainte `unique (tenant_id, user_id)` — `supabase/migrations/013_multitenant_core_s5.sql:21-30`.
- Enum `public.tenant_role` créé avec `('admin','engineer','viewer')` — `supabase/migrations/013_multitenant_core_s5.sql:5` ; la valeur `'director'` est ajoutée par `supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql:5`. Le type généré reflète les quatre valeurs : `src/types/database.ts:3367`.
- Un rôle applicatif distinct et antérieur vit sur `profiles.role` (`'buyer' | 'site_manager' | 'admin'`) — `src/lib/auth/server.ts:14`. Il n'intervient pas dans les policies RLS tenant.

### 1.2 Fonctions d'autorisation partagées

Les trois helpers sont redéfinis par `supabase/migrations/20260713135334_harden_active_tenant_and_profile_rls.sql`, en `security definer` et `set search_path = ''` :

| Fonction | Définition courante | Comportement |
| --- | --- | --- |
| `current_tenant_id()` | `…:4-18` | Premier membership de `auth.uid()`, **joint sur `tenants` avec `t.is_active`**, ordonné `is_default desc, created_at asc`, `limit 1` |
| `is_tenant_member(uuid)` | `…:20-44` | Tenant actif **et** (membership existant **ou** `is_admin_user()`) |
| `has_tenant_role(uuid, tenant_role[])` | `…:46-75` | Tenant actif **et** (membership avec rôle dans la liste **ou** `is_admin_user()`) |
| `can_view_profile(uuid)` | `…:77-101` | Soi-même, `is_admin_user()`, ou co-membre d'un tenant actif |

Les définitions historiques (`supabase/migrations/013_multitenant_core_s5.sql:50-107`) ne testent pas `is_active` ; c'est exactement ce que vérifie `src/lib/auth-tenant-rls-security-regressions.test.ts:33-52`.

`public.is_admin_user()` lit le JWT : `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'` ou `… ->> 'is_admin' = 'true'` — `supabase/migrations/021_fix_bulk_update_tenant_bootstrap_and_admin_hardening_v2.sql:9-11`. C'est un **bypass transverse** : tout porteur de ce claim satisfait `is_tenant_member` et `has_tenant_role` pour n'importe quel tenant actif. `app_metadata` n'est pas modifiable par l'utilisateur via l'API Supabase publique, mais aucune vérification côté dépôt ne le garantit — non vérifié ici.

`can_view_profile` est révoqué de `public, anon` et accordé à `authenticated` — `…:103-104`. La policy `profiles` correspondante remplace un ancien `using (true)` — `…:106-113`.

### 1.3 Amorçage à l'inscription

`public.handle_new_user()` (`supabase/migrations/20260713132306_isolate_self_signup_tenants.sql:4-52`, `security definer`, `set search_path = ''`) crée le profil avec `role = 'buyer'` codé en dur (`:20`), puis **un tenant neuf** `'Espace personnel'` de slug `'signup-' || new.id` (`:29-35`), puis un membership `admin` / `is_default = true` sur ce seul tenant (`:37-48`). La fonction est révoquée de `public, anon, authenticated, service_role` (`:54-55`).

La version antérieure lisait `raw_user_meta_data->>'role'` et rattachait au tenant `'hydro-express'` — `supabase/migrations/20260222194000_signup_membership_bootstrap.sql`, cité par `src/lib/signup-tenant-security-regressions.test.ts:19-20`.

Amorçage manuel d'un tenant : `can_bootstrap_tenant_membership(tenant, user, role)` n'autorise que `user = auth.uid()`, `role = 'admin'`, tenant créé par l'appelant, et **aucun** membership préexistant sur ce tenant — `supabase/migrations/021_…_v2.sql:292-318`.

L'inscription publique est un simple `supabase.auth.signUp({email, password})` côté navigateur — `src/app/signup/page.tsx:25-28`.

---

## 2. Matrice rôle × opération

Rôles du tenant : `admin`, `engineer`, `viewer`, `director`. « Propriétaire » = `estimate_projects.user_id = auth.uid()`.

| Opération | admin | engineer | viewer | director | Référence |
| --- | --- | --- | --- | --- | --- |
| Lire / écrire `estimate_versions` (policy `for all`) | oui | oui si propriétaire | non | — | `013_multitenant_core_s5.sql:1403-1420` |
| Lire `estimate_versions` sans être propriétaire | oui | non | non | oui | `20260306143000_v3_015…sql:266-284` |
| Insert/update/delete `estimate_items` (version `draft` uniquement) | oui | oui si propriétaire | non | non | `20260304161000_ux2_017_rls_viewer_readonly.sql:7-104` |
| Écrire `estimate_assembly_members` | oui | oui | non | non | `20260727030000_harden_estimate_assembly_member_write_roles.sql:19-56` |
| Écrire structure drafts / version-zero drafts | oui | oui (créateur) | non | non | `20260713140444_harden_estimate_workflow_write_boundaries.sql:9-65` |
| Insert `dpgf_imports` | oui | oui | non | non | `20260713134332_harden_ingestion_audit_boundaries.sql:36-46` |
| Update `takeoff_items` (policy `as restrictive`) | oui | oui | non | non | `20260713140006_enforce_takeoff_operator_mutations.sql:51-69` |
| Insert / update / delete `portal_tokens` | oui | oui | non | non | `20260305150000_create_labor_roles.sql:148-180` |
| Select `portal_tokens` | oui | oui si propriétaire | non | non | `20260305150000_create_labor_roles.sql:128-146` |
| Lire `feature_flags` | oui | oui | oui | oui | `022_feature_flags.sql:27-31` |
| Écrire `feature_flags` | oui | non | non | non | `022_feature_flags.sql:33-38` + `src/lib/feature-flags.ts:206-209` |
| Lire `audit_logs` | oui | non | non | non | `013_multitenant_core_s5.sql:1587-1591` |
| Insert `audit_logs` (périmètre restreint) | oui | oui | oui\* | oui\* | `20260304174000_performance_advisor_fk_and_rls_policy_dedup.sql:16-45` |
| Créer / modifier / supprimer un membership | oui | non | non | non | `013_multitenant_core_s5.sql:1082-1099` + `src/lib/memberships/server.ts:99-102` |
| Update / delete `tenants` | oui | non | non | non | `013_multitenant_core_s5.sql:1060-1071` |
| Envoyer un devis par email | oui | oui | non | non | `src/lib/estimates/write-access.ts:7-9` appelé en `src/lib/email/send-estimate.ts:125` |
| Approuver / décider une revue | oui | non | non | oui | `src/lib/approvals/server.ts:148`, `:220` |
| Accéder aux pages `/dashboard/{admin,tenants,memberships}` | oui | non | non | non | `src/app/dashboard/admin/page.tsx:10-12`, `…/tenants/page.tsx:9-11`, `…/memberships/page.tsx:9-11` |

\* La policy d'insert `audit_logs` ne teste pas le rôle : elle exige `user_id = auth.uid()`, `tenant_id = current_tenant_id()` et une correspondance stricte avec un `takeoff_jobs` du tenant — `20260304174000_…sql:20-45`.

La matrice attendue par le test E2E (`src/lib/estimates/rls.e2e.test.ts:76-110`) est plus étroite pour `engineer` sur `audit_logs` (`select: false`, `insert: true`) et refuse tout au `viewer` sur six tables. Elle est évaluée avec un projet dont le propriétaire est l'ingénieur (`src/lib/estimates/rls.e2e.test.ts:262`).

Deux invariants supplémentaires côté serveur : un admin ne peut pas retirer le dernier admin du tenant (`src/lib/memberships/server.ts:355-360`, `:398-403`) ni supprimer son propre membership (`:394-396`).

---

## 3. Authentification : ce que fait la Proxy, et ce qu'elle ne fait pas

`src/proxy.ts` est l'unique frontière Next.js 16 compilée pour toutes les routes sauf `_next/static`, `_next/image` et `favicon.ico`. Elle reconstruit un client Supabase depuis les cookies, appelle `auth.getUser()` et propage les cookies rafraîchis. Une configuration Supabase publique absente échoue explicitement au lieu de laisser passer une session non vérifiée.

La Proxy redirige un visiteur non authentifié de `/dashboard/**` vers `/login`, et un utilisateur déjà authentifié de `/login` ou `/signup` vers `/dashboard`. Elle ne décide toutefois d'aucun rôle ni tenant ; ces autorisations restent portées par :

- Les Server Components : `requireUser()` fait `redirect("/login")` si `auth.getUser()` ne retourne rien — `src/lib/auth/server.ts:22-33` ; `getUserContext()` l'appelle et joint le profil + le premier membership — `src/lib/auth/server.ts:65-73`. Le layout dashboard consomme `getUserContext()` — `src/app/dashboard/layout.tsx:11`.
- Les route handlers : les chemins tenant stricts convergent vers `src/lib/auth/tenant-context.ts`, qui exige une membership jointe à un tenant actif ; les variantes auth-only réutilisent ses primitives neutres.
- Le RLS Postgres, qui reste la dernière barrière si un handler oublie un contrôle.

Le client Server Component (`src/lib/supabase/server.ts`) a un `setAll()` volontairement vide : le rafraîchissement de session est porté par `src/proxy.ts`.

`src/app/api/docs/route.ts` n'exige aucune authentification : il est gouverné par `ENABLE_OPENAPI_DOCS`, `NODE_ENV !== "production"` ou `VERCEL_ENV === "preview"` — `src/app/api/docs/route.ts:17-28`.

Aucun en-tête de sécurité HTTP (CSP, HSTS, `X-Frame-Options`) n'est défini au niveau applicatif : `grep -c "headers" next.config.ts` renvoie `0`, et la seule occurrence de `Content-Security-Policy` du dépôt est une `<meta>` dans une iframe de prévisualisation (`src/components/DevisPreviewModal.tsx:134`).

---

## 4. Row Level Security

Mesures obtenues sur `supabase/migrations/*.sql` (185 fichiers) :

| Mesure | Valeur | Commande |
| --- | --- | --- |
| Tables distinctes passées en `enable row level security` | 96 | `grep -rhoiE "public\.[a-z_]+ enable row level security" supabase/migrations/*.sql \| sed -E 's/ enable.*//' \| sort -u \| wc -l` |
| Tables distinctes passées en `force row level security` | 46 | même commande avec `force` |
| Instructions `create policy` | 515 | `grep -rhciE "^create policy" supabase/migrations/*.sql \| awk '{s+=$1} END {print s}'` |
| Noms de policies distincts | 393 | `grep -rhoiE '^create policy "[^"]+"' supabase/migrations/*.sql \| sort -u \| wc -l` |
| Policies `as restrictive` | 20, toutes dans un seul fichier | `grep -rc "as restrictive" supabase/migrations/*.sql \| grep -v ":0"` |
| Fonctions `security definer` | 61 occurrences | `grep -rhciE "security definer" supabase/migrations/*.sql \| awk '{s+=$1} END {print s}'` |

Le nombre d'instructions n'est pas le nombre de policies vivantes : de nombreuses migrations font `drop policy if exists` puis recréent (par exemple `supabase/migrations/20260718155244_restore_estimate_documents_storage.sql:24-31`). L'état réel se lit en base.

`force row level security` couvre notamment `estimate_projects`, `estimate_versions`, `estimate_items`, `estimate_categories`, `labor_roles`, `purchase_order_devis`, `estimate_suggestion_rules` (`supabase/migrations/004_harden_estimate_devis_rls_s1.sql:11-17`), `takeoff_jobs`/`takeoff_results`/`takeoff_items` (`supabase/migrations/20260224123000_tkf001_takeoff_schema.sql:296-298`), `plan_sets`/`plan_files` (`supabase/migrations/20260224203000_tkf017_takeoff_plans.sql:218-219`), et `estimate_ai_generation_budgets` (`supabase/migrations/20260713142735_harden_estimate_ai_generation_budgets.sql:28`).

Les 20 policies `as restrictive` de `supabase/migrations/20260713140006_enforce_takeoff_operator_mutations.sql` ajoutent une condition **cumulative** `has_tenant_role(admin|engineer)` sur `takeoff_items`, `takeoff_dpgf_links`, `takeoff_dpgf_review_decisions`, `takeoff_price_suggestions`, `estimate_risk_alerts`, `plan_sets`, `plan_files`.

Certaines tables sensibles retirent complètement les privilèges de table aux rôles API, RLS mise à part : `revoke all on table public.estimate_ai_generation_budgets from public / anon / authenticated` (`supabase/migrations/20260713142735_…sql:30-32`) et `takeoff_apply_override_consumptions` (`supabase/migrations/20260713132407_harden_takeoff_apply_and_storage.sql:16-17`).

`supabase/schema.sql` n'est pas la source de vérité : il commence par une quarantaine de `drop table … cascade` (`supabase/schema.sql:7-21`) et ne déclare que 40 tables. Le `README` du dossier le documente explicitement (`supabase/README.md:10-17`).

---

## 5. Triggers de garde

Fonctions trigger `guard_* / enforce_* / validate_* / prevent_* / assign_*` (liste : `grep -rhoE "create or replace function public\.(guard_|enforce_|validate_|prevent_|assign_)[a-z_]*" supabase/migrations/*.sql | sort -u`). Les plus structurantes :

| Fonction | Table | Invariant | Référence |
| --- | --- | --- | --- |
| `guard_profile_role_update()` | `profiles` | Refuse tout changement de `profiles.role` dès que `auth.uid()` est non nul (`42501 / PROFILE_ROLE_IMMUTABLE`) | `021_…_v2.sql:14-35` |
| `assign_tenant_id()` | 9 tables enfants | Recalcule `tenant_id` depuis la ligne parente, sinon `current_tenant_id()` | `20260222020000_est181_assign_tenant_id_audit_logs_guard.sql:4-81` |
| `assign_portal_tokens_tenant_id()` | `portal_tokens` | `security definer` ; interdit de changer `version_id`/`tenant_id` en UPDATE, force `tenant_id` depuis la version, échoue en `23503` si la version manque | `20260713135408_harden_portal_pdf_capabilities.sql:3-43` |
| `enforce_estimate_document_canonical_path()` | `estimate_documents` | Force le tenant du parent et impose `tenant/projet/version/<sha256>.pdf` à toute nouvelle publication `ready` ; une ligne historique inchangée peut conserver un unique fichier `.pdf` sous `tenant/projet`, nommé par l'UUID de version ou par l'ancien nom commercial | `20260812011616_estimate_pdf_publication_fencing.sql` |
| `enforce_takeoff_item_mutation_before_apply()` | `takeoff_items` | Verrou consultatif par job, `job_id` immuable, gel des items après `status='applied'` | `20260713132407_…sql:20-71` |
| `enforce_takeoff_apply_security()` | `takeoff_jobs` | Sur passage à `applied` : verrou brouillon actif de l'appelant + seuil de confiance, sinon override admin consommé une seule fois via `takeoff_apply_override_consumptions` | `20260713132407_…sql:365-371`, table `:3-17` |
| `enforce_plan_set_resource_budget()` | `plan_files` | Verrou par plan set ; fichier ∈ ]0, 52 428 800] octets ; ≤ 20 fichiers ; ≤ 104 857 600 octets cumulés | `20260713150322_enforce_plan_set_resource_budgets.sql:22-62` |
| `guard_estimate_versions_readonly()` | `estimate_versions` | Gèle le contenu hors `draft` ; en `sending`, n'autorise que la pose unique du sceau puis une transition de statut | `20260811231759_transactional_estimate_email_outbox.sql` |
| `guard_estimate_email_dispatch_mutation()` | `estimate_emails` | Enveloppe initiale immuable, transitions d'outbox bornées, identité fournisseur stable | `20260811231759_transactional_estimate_email_outbox.sql` |
| `guard_estimate_email_pdf_publication()` | `estimate_emails` | Refuse `preparing → queued` si chemin, hash, révision ou publication PDF ne correspondent pas ; pendant `sending`, exige le même dispatch email | `20260812011616_estimate_pdf_publication_fencing.sql` |
| `guard_estimate_email_dispatch_events_append_only()` | `estimate_email_dispatch_events` | Journal de dispatch append-only ; les suppressions ne sont permises qu'en cascade avec le parent | `20260811231759_transactional_estimate_email_outbox.sql` |
| `guard_purchase_order_devis_storage_path()` | `purchase_order_devis` | Rend tenant, commande et chemin immuables ; exige `purchase-orders/<purchase_order_id>/<filename>` sans sous-dossier ni traversée | `20260812000456_transactional_procurement_reset_cleanup.sql` |
| `guard_estimate_review_cycles_insert/update()` | cycles de revue | Passées en `security definer` pour contourner le RLS `tenant_memberships` lors de la validation du relecteur | `20260306235500_v3_019_review_cycle_guard_security_definer.sql:3-4` |
| `prevent_affaire_intake_event_mutation()` / `prevent_affaire_register_event_mutation()` | journaux d'affaire | Événements append-only (policies + `revoke update, delete` + trigger) | `20260713134332_…sql` (assertions : `src/lib/ingestion-security-regressions.test.ts:30-44`) |

`supabase/migrations/20260727112139_revoke_trigger_function_api_execute.sql:5-19` retire `execute` à `public, anon, authenticated, service_role` sur cinq fonctions trigger internes (`assign_portal_tokens_tenant_id`, `enforce_estimate_document_canonical_path`, `enforce_plan_set_resource_budget`, `enforce_takeoff_apply_security`, `enforce_takeoff_item_mutation_before_apply`) — le commentaire du fichier précise que révoquer `PUBLIC` seul ne suffit pas sur un projet Supabase managé (`:1-3`).

Budgets IA : `acquire_estimate_ai_generation_lease` exige un membership `admin|engineer` **et** un `draft_locks` non expiré de l'appelant (`20260713142735_…sql:79-93`), sérialise par `pg_advisory_xact_lock` sur le tenant (`:101-103`), et plafonne à **4 fenêtres actives par tenant** et **2 par utilisateur** (`:118`). Bail = **5 minutes**, fenêtre = **10 minutes** (`:154-155`).

---

## 6. Client service-role

`createServiceRoleClient()` instancie un client avec `SUPABASE_SERVICE_ROLE_KEY`, `autoRefreshToken: false`, `persistSession: false`, et **met le client en cache module** (`src/lib/supabase/service-role.ts:5`, `:27-47`). Le commentaire du fichier énonce la règle : « Bypasses RLS — use only in server-side code for operations that don't have an authenticated user context » (`src/lib/supabase/service-role.ts:22-26`). `createOptionalServiceRoleClient()` retourne `null` si la configuration manque (`:14-20`).

Appels recensés (`grep -rn "createServiceRoleClient\|createOptionalServiceRoleClient" src/ --include=*.ts --include=*.tsx | grep -v "\.test\."`) :

| Site | Contexte d'authentification |
| --- | --- |
| `src/app/portal/[token]/page.tsx:51` | **Aucun utilisateur** : page publique, autorisation portée par le token seul |
| `src/app/api/portal/[token]/accept/route.ts:88` | **Aucun utilisateur** : autorisation par token |
| `src/app/api/portal/[token]/reject/route.ts:39` | **Aucun utilisateur** : autorisation par token |
| `src/lib/memberships/server.ts:190` (`listCandidates`) | Précédé de `getAuthenticatedContext` + `assertTenantAdmin` (`:248-250`) |
| `src/lib/memberships/server.ts:294` (`createMembership`) | Précédé de `assertTenantAdmin` (`:277`) |
| `src/lib/estimates/pdf-generator.tsx`, `src/lib/estimates/pdf-publication.ts` | Lecture/signature avec repli utilisateur ; début, publication et échec des métadonnées par RPC service-role protégées par token |
| `src/lib/estimates/rules-engine.ts:2188`, `:2833`, `:3384`, `:3571` | Repli `?? input.context.supabase` selon les cas |
| `src/lib/affaires/intake-server.ts:2501`, `src/lib/affaires/register-server.ts:961`, `src/lib/estimates/generated-ouvrages.ts:1630`, `src/lib/takeoff/plans.ts:1065` | Appels RPC / stockage dans des fonctions déjà contextualisées |
| `src/lib/email/estimate-email-outbox.ts` | Mutations d'outbox et appel Resend après authentification applicative ; les RPC revérifient acteur, rôle et tenant actif |
| `src/lib/workflows/durable-recovery.ts`, `src/lib/procurement/storage-cleanup-outbox.ts` | Route cron interne protégée par `CRON_SECRET` ; dispatch durable et suppression d'objets déjà inscrits dans l'outbox |

L'usage service-role dans `listCandidates` est délibéré et testé : le RLS `profiles` ayant été resserré, l'annuaire de recherche passe par un client privilégié borné à l'admin du tenant — `src/lib/auth-tenant-rls-security-regressions.test.ts:89-99`.

Parmi les RPC explicitement réservées au rôle Postgres `service_role` et
révoquées de `public, anon, authenticated` figurent
`claim_portal_estimate_decision`,
`update_affaire_register_entry_with_event`, ainsi que
`begin_estimate_pdf_generation`, `publish_estimate_pdf_generation` et
`fail_estimate_pdf_generation`.

Le worker takeoff construit son client privilégié localement via la factory canonique `src/lib/supabase/service-role.ts`. Le relais Edge → Next ne transporte que `x-takeoff-worker-secret` et `x-correlation-id` ; aucune clé service-role ne traverse cette frontière HTTP.

Les nouveaux workflows privilégiés ne prennent pas le service-role pour une
autorisation métier implicite :

- les RPC d'email initial exigent `current_user = 'service_role'`, puis
  revérifient l'acteur applicatif, son rôle `admin|engineer`, la version et le
  tenant actif ; les rôles `authenticated` n'ont plus de privilège d'écriture
  direct sur `estimate_emails` ;
- les RPC de PDF revérifient le même acteur, puis protègent la publication par
  token, révision, statut et dispatch. `authenticated` n'a plus aucun DML sur
  `estimate_documents`, ni aucune mutation Storage dans le bucket documentaire ;
- les claims et renouvellements intake/takeoff joignent `tenants.is_active` et
  sont protégés par un token de bail ; une suspension empêche le prochain appel
  fournisseur ou sa persistance par un worker obsolète ;
- le nettoyage Storage procurement exige le service-role seulement pour
  retirer l'objet puis acquitter une entrée d'outbox. Celle-ci conserve le
  `purchase_order_id` et le worker revalide son namespace avant la suppression.
  La suppression métier qui alimente cette outbox conserve ses gardes
  admin/tenant côté RPC.

Sources : `supabase/migrations/20260811231238_durable_workflow_recovery.sql`,
`20260811231759_transactional_estimate_email_outbox.sql`,
`20260812000456_transactional_procurement_reset_cleanup.sql` et
`20260812011616_estimate_pdf_publication_fencing.sql`.

---

## 7. Storage

Sept buckets, tous `public = false` :

| Bucket | Taille max (octets) | Types MIME | Définition |
| --- | --- | --- | --- |
| `devis` | 10 485 760 | pdf, png, jpeg, webp | `003_create_devis_storage.sql:2-10` |
| `dpgf-imports` | 52 428 800 | csv, ms-excel, xlsx, octet-stream | `011_dpgf_import_tables_s3.sql:115-129` |
| `estimate-documents` | 20 971 520 | `application/pdf` | `20260222050000_est201_pdf_server.sql:126-134`, réappliqué en `do update` par `20260718155244_restore_estimate_documents_storage.sql:3-22` |
| `takeoff-files` | 10 485 760 | csv, ms-excel, xlsx | `20260224171000_tkf007_takeoff_storage_bucket.sql:3-16` |
| `plan-files` | 52 428 800 | `application/pdf` | `20260224203000_tkf017_takeoff_plans.sql:341-349` |
| `affaire-intake` | 52 428 800 | 11 types (pdf, images, txt, csv, rfc822, doc/docx, xls/xlsx) | `20260306210000_est371_affaire_intake.sql:407-427` |

Conventions de chemin appliquées par les policies :

- `estimate-documents` : toute nouvelle publication suit
  `tenant/projet/version/<sha256>.pdf`. `authenticated` peut lire seulement un
  objet référencé par une ligne `ready` et n'a aucune policy
  `INSERT`/`UPDATE`/`DELETE` ; l'upload est réservé au service-role. Le chemin
  historique reste lisible seulement s'il est déjà référencé comme unique fichier
  `.pdf` sous `tenant/projet`, nommé par l'UUID de version ou par l'ancien nom
  commercial. Son chemin et son empreinte sont alors immuables —
  `20260812011616_estimate_pdf_publication_fencing.sql`.
- `plan-files` : exactement 3 segments, premier segment `= current_tenant_id()`, jointure sur `plan_sets`+`plan_files` et `pf.file_path = objects.name` — `20260224203000_…sql:356-382`.
- `affaire-intake` : exactement 4 segments `tenant/projet/upload/document`, `d.storage_path = objects.name`, `upload_status = 'uploaded'` — `20260306210000_…sql:434-453`.
- `takeoff-files` : premier segment `= current_tenant_id()`, deuxième segment validé comme UUID par regex, jointure `tj.source_file_path = objects.name` — `20260713132407_…sql:376-409`.
- `devis` : exactement `purchase-orders/<purchase_order_id>/<filename>` côté
  métadonnée, chemin immuable et recoupé avec le tenant parent ; les policies
  exigent une commande `<> 'canceled'`, sa propriété ou le rôle admin. Le drain
  service-role répète la validation du namespace avant suppression —
  `20260708120000_harden_devis_storage_policies.sql:13-105`,
  `20260812000456_transactional_procurement_reset_cleanup.sql`.
- `dpgf-imports` : premier segment `= auth.uid()::text` **et** `has_tenant_role(current_tenant_id(), admin|engineer)` — `20260713134332_…sql:248-259`.

TTL des URL signées, valeurs exactes :

| Constante | Valeur | Fichier |
| --- | --- | --- |
| `SIGNED_URL_TTL_SECONDS` (devis, bons de commande) | `60 * 10` | `src/app/api/purchase-orders/[id]/devis/route.ts:11`, `…/[devisId]/route.ts:9` |
| `SIGNED_URL_TTL_SECONDS` (PDF de devis) | `60 * 60` | `src/lib/estimates/pdf-generator.tsx:201` |
| `PLAN_FILE_UPLOAD_SIGNED_URL_TTL_SECONDS` | `60 * 60 * 2` | `src/lib/takeoff/plans.ts:28` |
| `PLAN_FILE_DOWNLOAD_SIGNED_URL_TTL_SECONDS` | `60 * 10` | `src/lib/takeoff/plans.ts:29` |
| URL signée d'un devis de commande (page) | `60 * 10` en littéral | `src/app/dashboard/orders/[id]/page.tsx:167` |

Validation applicative des fichiers : `validateFileForUpload` refuse fichier absent, taille `<= 0`, taille `> maxFileSizeBytes` (défaut **10 485 760**, libellé « 10 Mo »), extension hors liste, type MIME hors liste ; un MIME vide est accepté par défaut (`allowEmptyMimeType` vaut `true`) — `src/lib/file-validation.ts:1-95`. Limites intake : **50 Mio** par fichier (`src/lib/affaires/intake.ts:4`), **20 fichiers** par lot (`src/lib/affaires/intake-server.ts:313`), **100 Mio** par lot (`:314`), corps multipart plafonné à **105 Mio** (`src/app/api/affaires/[projectId]/intake/files/route.ts:15`).

---

## 8. Feature flags

Mécanisme : table `public.feature_flags (tenant_id, flag_key, enabled, value)` avec `unique (tenant_id, flag_key)` et `tenant_id … on delete restrict` — `supabase/migrations/022_feature_flags.sql:3-12`. Portée strictement tenant.

Lecture : `is_tenant_member(tenant_id)` (`022_feature_flags.sql:27-31`). Écriture : `has_tenant_role(tenant_id, ['admin'])` (`:33-38`), doublé côté serveur par `if (membership.role !== "admin") throw forbidden(…)` — `src/lib/feature-flags.ts:206-209`. La clé est normalisée en majuscules et contrainte à `/^[A-Z0-9_]+$/`, longueur ≤ 64 — `src/lib/feature-flags.ts:63-68`, `:77-79`.

`isFeatureEnabled` renvoie `false` sur toute erreur, absence de ligne, ou `enabled !== true` — `src/lib/feature-flags.ts:249-279`. `getFeatureFlagValueForTenant` renvoie `null` si le flag est désactivé — `:302-311`. **Un flag absent équivaut donc à désactivé.**

| Clé | Défaut effectif | Référence |
| --- | --- | --- |
| `TAKEOFF_MODULE_ENABLED` | `false`, inséré pour chaque tenant existant et par trigger `after insert on tenants` | `20260224153000_tkf005_takeoff_feature_flag.sql:3-26` |
| `TAKEOFF_C_CHUNK_THRESHOLD_PAGES` | 15 | `src/lib/takeoff/constants.ts:23` |
| `TAKEOFF_C_CHUNK_SIZE_PAGES` | 10 | `src/lib/takeoff/constants.ts:24` |
| `TAKEOFF_C_CHUNK_OVERLAP_PAGES` | 2 | `src/lib/takeoff/constants.ts:25` |
| `TAKEOFF_C_MAX_PDF_PAGES` | 200 | `src/lib/takeoff/constants.ts:26` |
| `TAKEOFF_C_TIMEOUT_MS` | 300 000 (bornes 120 000 / 900 000) | `src/lib/takeoff/constants.ts:27-29` |
| `TAKEOFF_C_MAX_TOTAL_TOKENS` | 400 000 | `src/lib/takeoff/constants.ts:30` |
| `TAKEOFF_C_MAX_COST_CENTS` | 2 500 | `src/lib/takeoff/constants.ts:31` |
| `TAKEOFF_AI_ESCALATION_ENABLED` | `false` | `src/lib/takeoff/constants.ts:32` |
| `TAKEOFF_AI_ESCALATION_MIN_CONFIDENCE` | 0.75 | `src/lib/takeoff/constants.ts:33` |
| `TAKEOFF_AI_ESCALATION_MAX_COST_CENTS` | 500 | `src/lib/takeoff/constants.ts:34` |
| `TAKEOFF_GEMINI_BATCH_MODE` | `false` | `src/lib/takeoff/constants.ts:35` |
| `TAKEOFF_LOW_CONFIDENCE_THRESHOLD` | lu par le trigger d'apply | `20260713132407_…sql` (assertion : `src/lib/takeoff/apply-storage-security-regressions.test.ts:37`) |
| `STALE_PRICE_DAYS` | 90 | `src/lib/catalogue/stale-prices.ts:1`, consommé en `src/lib/feature-flags.ts:317-323` |
| `EST_031_LABOR_SPLIT` | absent ⇒ `false` | `src/lib/estimates/calc-context.ts:26` |
| `ESTIMATE_ITEM_AID_REGEX` | absent ⇒ motif par défaut | `src/lib/estimates/schemas.ts:14`, `src/lib/estimates/server.ts:1850-1856` |
| `ESTIMATE_GATING_BLOCKING_FLAGS` / `ESTIMATE_GATING_WARNING_FLAGS` | absent ⇒ `null` | `src/lib/estimates/gating.ts:39-40`, `src/lib/estimates/anomaly-history.ts:97-98` |
| `PREFERRED_SUPPLIER_ID` | absent ⇒ aucun ; valeur validée comme UUID | `src/lib/estimates/server.ts:970-976` |
| `PRICE_IMPORT_GUIDED_ASSISTANT`, `PRICE_IMPORT_BDC_PROFILE`, `PRICE_IMPORT_CREATE_ASSIST`, `PRICE_IMPORT_MULTI_SUPPLIER` | absent ⇒ `false` | `src/lib/feature-flags.ts:44-54` |
| `ESTIMATE_EDITOR_VIRTUALIZATION_MODE` / `…_AUTO_THRESHOLD` | absent ⇒ défaut code | `src/lib/estimate-editor-virtualization.ts:5-8` |

Deux échappatoires d'environnement court-circuitent le flag tenant pour le module takeoff : `TAKEOFF_MODULE_FORCE_ENABLED` et `TAKEOFF_MODULE_ENABLED_BY_DEFAULT` renvoient `true` avant toute lecture en base — `src/lib/takeoff/feature-flags.ts:145-157`.

API : `GET /api/feature-flags` et `PATCH /api/feature-flags`, tenant par défaut = premier membership de l'appelant, surchargeable par `tenant_id` dans la requête/le corps — `src/app/api/feature-flags/route.ts:95-137`. L'autorisation reste portée par `getTenantMembershipOrThrow` (`src/lib/feature-flags.ts:142-163`). L'UI d'administration est réservée au `tenant_role === "admin"` — `src/app/dashboard/admin/flags/page.tsx:10-12`.

---

## 9. Journal d'audit

`GET /api/audit` exige un utilisateur (`src/app/api/audit/route.ts:39-45`), accepte `table_name`, `estimate_version_id` (validé UUID, `:32-34`, `:61-66`) et `limit` (défaut 50, plafond 200 — `:5-6`, `:29`). Aucun filtre de tenant n'est ajouté par le handler : l'isolation vient du RLS, et une erreur contenant « row-level security » est retransformée en HTTP 403 (`:87-90`).

Côté base : lecture réservée à `has_tenant_role(tenant_id, ['admin'])` (`013_multitenant_core_s5.sql:1587-1591`) ; insertion couverte par une policy unique et très contrainte (`20260304174000_…sql:16-45`) après fusion de trois policies antérieures (`:12-14`). `tenant_id` est recalculé par trigger depuis `estimate_version_id` (`20260222020000_…sql:40-48`).

L'export CSV d'historique d'anomalies neutralise les formules (`^[\t\r\n ]*[=+\-@]`) — `src/app/api/admin/anomaly-history/route.ts`, vérifié par `src/lib/estimates/workflow-write-security-regressions.test.ts:117`.

---

## 10. Tests de régression et CI

Le socle comprend des régressions structurelles exécutées par Vitest `node` et
une matrice qui se connecte réellement à la pile Supabase locale. Les suites qui
lisent le SQL des migrations avec `fs.readFileSync` attestent du **contenu des
fichiers**, pas à elles seules du comportement d'une base réelle.

| Fichier | Cas | Objet |
| --- | --- | --- |
| `src/lib/auth-tenant-rls-security-regressions.test.ts` | 5 | helpers `is_active`, `can_view_profile`, `search_path = ''`, annuaire service-role |
| `src/lib/signup-tenant-security-regressions.test.ts` | 5 | isolation du tenant d'auto-inscription, non-confiance aux métadonnées |
| `src/lib/trigger-function-execute-security-regressions.test.ts` | 2 | révocation d'`execute` sur 5 fonctions trigger |
| `src/lib/estimates/portal-pdf-security-regressions.test.ts` | 3 | parent immuable du token portail, RPC réservée `service_role`, chemin PDF canonique |
| `src/lib/est201-pdf-rls-regressions.test.ts` | 2 | policies `estimate_documents` et objets Storage |
| `src/lib/estimates/workflow-security-regressions.test.ts` | 7 | statut/sceau/révision non choisis par l'appelant, décisions d'approbation |
| `src/lib/estimates/workflow-write-security-regressions.test.ts` | 9 | rôles d'écriture, conflits de lot, neutralisation CSV |
| `src/lib/ingestion-security-regressions.test.ts` | 3 | DPGF, journaux append-only, RPC registre |
| `src/lib/takeoff/apply-storage-security-regressions.test.ts` | 11 | garde d'apply, override consommable une fois, Storage takeoff, policies restrictives |
| `src/lib/estimates/rls.e2e.test.ts` | 2 | **matrice RLS réelle** contre une base Supabase |

`rls.e2e.test.ts` est le seul à se connecter. Il est gardé par
`describe.runIf(RLS_E2E_ENABLED)`, authentifie trois rôles éphémères
(`admin`, `engineer`, `viewer`), sème deux tenants et exerce les frontières
tenant, portail, Estimates et takeoff ainsi que l'isolation inter-tenant. Le
runner local exige exactement les deux tests de premier niveau réussis : un
skip ou une matrice vide fait échouer le job.

CI (`.github/workflows/`, 5 fichiers) :

- `quality-gate.yml` : sur `pull_request` et `push` vers `main`, sans secret
  distant. Il contrôle audit et signatures des dépendances, budgets
  d'architecture, OpenAPI, TypeScript, ESLint, les deux projets Vitest avec un
  pool borné, la couverture ciblée des frontières critiques, puis construit
  l'artefact Webpack utilisé par Vercel et le démarre avec `next start` pour un
  smoke HTTP.
- `e2e-rls-matrix.yml` : sans secret distant, il vérifie l'historique append-only,
  démarre une pile Supabase isolée, rejoue les migrations, exécute pgTAP et la
  matrice RLS avec des utilisateurs locaux éphémères, puis nettoie la pile. Un
  skip, zéro test, une migration divergente ou un nettoyage en échec rend le job
  rouge.
- `e2e-playwright-critical.yml` : uniquement sur `push main`, dans
  l'environnement GitHub nommé `e2e-staging`. Les secrets sont limités
  aux deux steps qui en ont besoin, la cible Supabase doit correspondre au nom
  d'hôte autorisé, les runs sont sérialisés et aucune clé service-role n'est
  injectée. Les traces d'authentification ne sont pas archivées. Les règles de
  protection de cet environnement sont une configuration distante à vérifier.
- `supabase-backup.yml` : dump planifié avec la CLI Supabase verrouillée par le
  lock npm et artefact à rétention configurée. `release-please.yml` ouvre ou met
  à jour la release PR puis, après sa fusion, crée le tag et la GitHub Release ;
  il ne déploie pas l'application.

Les actions tierces sont référencées par SHA complet. L'obligation effective de
ces jobs avant merge dépend toutefois des règles GitHub de protection de
branche, qui ne sont pas prouvables depuis le checkout local.

---

## 11. Variables d'environnement sensibles

`.env.example` déclare 11 variables sans valeur. Aucune valeur n'est reproduite ici.

| Variable | Exposition | Usage |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navigateur | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts` |
| `E2E_ALLOWED_SUPABASE_HOST` | CI E2E | nom d'hôte exact autorisé pour la cible Supabase distante de staging |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur | construction des clients centralisée dans `src/lib/supabase/service-role.ts`; publication PDF et outbox échouent fermées sans ce rôle ; `src/lib/takeoff/edge-trigger.ts` l'utilise uniquement pour appeler l'Edge Function, sans la relayer au worker Next.js |
| `TAKEOFF_WORKER_SECRET` | serveur | `src/app/api/internal/takeoff/process-job/route.ts:18` |
| `TAKEOFF_WORKER_URL` | serveur | déclaré en `.env.example:10` |
| `CRON_SECRET` | serveur | bearer exigé par `GET /api/internal/workflows/recover`; protège la reprise takeoff/intake et le drain Storage procurement |
| `GEMINI_API_KEY` | serveur | `src/lib/takeoff/gemini-client.ts:974`, `:1037`, `:1115` |
| `RESEND_API_KEY`, `EMAIL_FROM` | serveur | `src/lib/email/send-estimate.ts`, `src/app/api/portal/[token]/accept/route.ts` |
| `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` | navigateur | `src/lib/email/send-estimate.ts` |
| `ENABLE_OPENAPI_DOCS` | serveur | `src/app/api/docs/route.ts:18` |
| `TAKEOFF_MODULE_FORCE_ENABLED`, `TAKEOFF_MODULE_ENABLED_BY_DEFAULT` | serveur | `src/lib/takeoff/feature-flags.ts:146-155` — absentes de `.env.example` |

---

## 12. Frontières à haut risque

`AGENTS.md:101-102` nomme ces frontières comme telles ; ce qui suit décrit leur état.

**Tokens portail.** Le token est un `uuid not null default gen_random_uuid()` stocké **en clair**, indexé en unique — `20260305150000_create_labor_roles.sql:70`, `:83-84`. Il n'y a ni hachage ni secret dérivé. L'expiration est portée par `expires_at` (colonne obligatoire, `:72`) et vérifiée à chaque lecture (`src/app/portal/[token]/page.tsx:65-75`, `src/app/api/portal/[token]/accept/route.ts:111-116`). Le portail est entièrement servi par un client service-role : `src/app/portal/[token]/page.tsx:51`. Aucune limitation de débit n'est présente sur ces routes : `grep -rin "ratelimit\|rate-limit" src/app/api/portal/ src/app/portal/ | wc -l` renvoie `0` — la connaissance du token vaut donc lecture complète du devis, et l'énumération n'est freinée que par l'espace UUID. La décision d'acceptation passe par `claim_portal_estimate_decision`, qui exige `current_user = 'service_role'`, verrouille la version en `for update`, n'accepte que le statut `sent`, et périme les autres tokens de la même version (`20260713135408_…sql:62-66`, `:85-144`). La route d'acceptation revalide le contrat documentaire côté API, en commentant explicitement que la page n'est pas une frontière de sécurité (`src/app/api/portal/[token]/accept/route.ts:118-146`). La signature est plafonnée à `700_000` caractères base64 et doit commencer par `data:image/png;base64,` (`:13-14`, `:70-86`).

**Service-role.** Client mis en cache au niveau module (`src/lib/supabase/service-role.ts:5`) : il traverse les requêtes du même processus. Trois sites l'utilisent sans aucun utilisateur authentifié (portail). Le worker takeoff réutilise cette factory canonique localement ; l'appelant HTTP ne peut plus fournir ni substituer la clé service-role.

**Worker takeoff.** L'authentification est une comparaison de chaînes non constante en temps : `providedSecret !== expectedSecret` (`src/app/api/internal/takeoff/process-job/route.ts:34`) ; `grep -rn "timingSafeEqual" src/ | wc -l` renvoie `0`. En `NODE_ENV === "test"`, un secret de repli codé en dur est utilisé si la variable est absente (`:23-25`).

**Storage.** Les policies dépendent de conventions de chemin
(`storage.foldername`) recoupées par des jointures sur la ligne métier. Pour les
PDF de devis, la nouvelle clé contient le SHA-256, l'upload est immuable
(`upsert: false`) et les écritures Storage comme la publication des métadonnées
contractuelles sont réservées au service-role. Une tentative supplantée après
l'upload peut toutefois laisser un objet orphelin, sans nettoyage différé dans
ce lot. Le bucket `devis` a vécu
une phase où toute personne authentifiée pouvait lire, écrire et supprimer
l'ensemble du bucket (`003_create_devis_storage.sql:13-35`), remplacée par
`20260708120000_harden_devis_storage_policies.sql:4-105`.

**Effets de bord email.** Un `admin` ou `engineer` du tenant choisit toujours les
destinataires `to`/`cc`, mais l'envoi initial passe désormais par une outbox
transactionnelle. Un `Idempotency-Key` UUID est obligatoire ; l'enveloppe, le
corps rendu, le chemin et le SHA-256 du PDF sont figés avant l'appel Resend ; un
bail de 120 secondes et une clé fournisseur stable empêchent deux workers
actifs d'envoyer des charges différentes. La finalisation enregistre
l'identifiant fournisseur et le statut `sent` sous verrou. Une réponse ambiguë
ou une reprise au-delà de 23 heures passe le dispatch à `unknown` et interdit le
rejeu automatique (`src/lib/email/send-estimate.ts`,
`src/lib/email/estimate-email-outbox.ts`, migration
`20260811231759_transactional_estimate_email_outbox.sql`).

Un rejet certain place au contraire la ligne en `failed` et libère
`sending → draft`. Si la charge était déjà figée, la clé de requête reste
consommée : le même dispatch ne peut pas être régénéré et une nouvelle tentative
doit porter une nouvelle `Idempotency-Key`.

Cette frontière ne couvre pas encore toutes les notifications : la
confirmation d'acceptation et la demande de revue d'approbation restent en
meilleur effort. Leur échec est journalisé sans annuler la décision métier.
Aucun consommateur cron autonome ne reprend encore les dispatchs email
`queued` ; une nouvelle soumission identique est nécessaire. Le statut
`unknown` exige un rapprochement fournisseur.

**Protections partielles à connaître.**

- La résolution applicative converge vers `src/lib/auth/tenant-context.ts` et
  filtre `tenants!inner(is_active)`. Les workers intake/takeoff et l'outbox
  email appliquent maintenant le même invariant avant leurs effets externes :
  la file conserve le travail, mais un tenant suspendu n'est pas dispatché et
  ne peut renouveler son bail.
- `is_admin_user()` accorde un accès transverse à tous les tenants actifs dès que le JWT porte le claim (`021_…_v2.sql:9-11`).
- Les régressions qui comparent du texte SQL et l'exécution sur une base locale
  ne prouvent pas l'état d'un projet Supabase partagé.
- La cadence `*/5` de `vercel.json` exige un plan Vercel Pro ou Enterprise,
  `CRON_SECRET` et un déploiement effectif. Ces trois conditions distantes ne
  sont pas prouvées par le checkout ; aucune migration Supabase distante ni
  aucun effet externe réel n'a été exécuté pour cette mise à jour documentaire.
- Aucun en-tête de sécurité HTTP applicatif (`next.config.ts` ne définit pas `headers()`).
