# D2 — Sécurité applicative et cycle de vie des offres

Audit indépendant, axe D2. Rédigé le 14/10/2026.

**Périmètre et méthode.**
- Lecture du code et des migrations, faite sur le dépôt vivant vers 13 h 30, soit quelques minutes après la
  capture de l'archive. Les chemins sont relatifs à la racine du dépôt.
- Vérifications à l'exécution sur la pile locale isolée, signalées par « exécuté » (voir `C-parcours.md`).
- Statuts : **Confirmé**, **Probable**, **À vérifier**, **Non audité**.
- Les contrôles qui reposent sur les 20 migrations non suivies, notamment
  `20261013130248_estimate_offer_client_contract.sql`, n'existent pas en production tant qu'elles n'y sont
  pas appliquées : **Non audité** côté production.

## 1. Authentification et autorisation

**Mécanismes en place.**
- `src/proxy.ts:43-61` rafraîchit la session et redirige les anonymes hors de `/dashboard/**`. Il ne bloque
  rien sous `/api/**`, si bien que chaque route doit faire son propre contrôle.
- La frontière stricte est `getAuthenticatedTenantContext` (`src/lib/auth/tenant-context.ts:88-117`) :
  - 401 sans utilisateur, 403 sans entreprise active ;
  - l'entreprise est déduite de l'adhésion par défaut, jamais du client.
- `getUserContext` renvoie `tenantId: null` au lieu d'échouer (`src/lib/auth/server.ts:62-70`). L'appelant
  doit donc vérifier lui-même.
- Rôle « rédacteur » = admin ou engineer (`src/lib/estimates/write-access.ts:7-21`). Là où l'application ne
  vérifie pas le rôle (suppression de lignes, création de prix), la RLS ou le SQL font barrage :
  `20260304161000_ux2_017_rls_viewer_readonly.sql`, `20260811185118_restore_authenticated_estimate_privileges.sql`.

**Vérifié à l'exécution.**
- Un admin d'une autre entreprise reçoit 404 en lecture, en modification, sur les lignes et sur le PDF.
- Une écriture sans bail d'édition de page renvoie 409.
- Une version envoyée est en lecture seule (403), et le retour `sent → draft` est refusé.

## 2. Usages du client service-role

Le service-role est employé pour le portail, les PDF, l'outbox e-mail, le moteur de règles, le métré, les
dépôts de pièces, le registre et la récupération durable. Dans la plupart des cas, la propriété de la cible
est vérifiée d'abord sous la session de l'utilisateur, ou par une RPC qui recontrôle l'acteur.

Exceptions relevées :

| Usage | Risque | Statut |
|---|---|---|
| `src/lib/memberships/server.ts:169-200`, recherche de candidats | Recherche sur **tous** les profils de toutes les entreprises, pour tout admin d'entreprise. Tout compte auto-inscrit est admin de son espace personnel. | **Confirmé à l'exécution** : l'admin B obtient nom et e-mail des 4 utilisateurs de A |
| `src/lib/memberships/server.ts:264-320`, ajout d'un membre | L'existence de n'importe quel utilisateur est vérifiée par service-role, puis l'insertion est tentée. Elle échoue (409) seulement par effet de bord : le comptage passe sous RLS, voit 0 adhésion, et l'insertion tente `is_default = true`, qui heurte l'index unique. | **Confirmé à l'exécution** |
| `src/lib/estimates/rules-engine.ts:2848` | Lecture de `audit_logs` (réservée aux admins par la RLS) pour des relecteurs non admins | Probable, faible |
| `src/lib/affaires/register-server.ts:929` | Fonction SQL service-role sans contrôle d'acteur ; elle repose sur la lecture applicative préalable | Probable, faible |

## 3. Portail client

- **Jeton.** `gen_random_uuid()`, environ 122 bits, stocké **en clair**. Il est lisible par le propriétaire de
  l'affaire et par les admins (`20260305150000_create_labor_roles.sql:128-146`), qui pourraient donc accepter
  à la place du client.
- **Expiration.** Contrôlée par la page, les routes et le SQL.
- **Décision.** Unique et verrouillée. Elle exige un jeton `pending` non expiré, une version `sent`, un sceau
  cohérent et un envoi réussi (`claim_portal_estimate_decision`).
- **Signature.** Seuls le préfixe PNG et une taille de 700 Ko sont contrôlés ; le contenu de l'image ne l'est pas.
- **Exposition.** La page ne rend que `ClientContract1`, une liste fermée de champs de vente : aucun coût,
  marge, coefficient ni prix fournisseur (`src/lib/estimates/offer-contract.ts:5-76`).
- **À l'exécution.** Sans service e-mail, aucun jeton n'est créé, et le portail n'a pas pu être rejoué
  (**Non audité**).

## 4. RLS, fonctions SECURITY DEFINER et stockage

- RLS activée sur toutes les tables `public` créées par migration. Les tables `private.*` sont dans un schéma
  non exposé.
- Les fonctions SECURITY DEFINER fixent un `search_path`. Quelques anciennes utilisent `public` au lieu de `''`.
- `is_tenant_member` et `has_tenant_role` renvoient vrai si `is_admin_user()` est vrai. Ce drapeau JWT est
  posé côté serveur ; il donne lecture et écriture inter-entreprises. Il faut inventorier qui le porte en
  production (**À vérifier**).
- Six compartiments privés avec limites de taille et de type, et des politiques par entreprise.
- Le contrôle des fichiers déposés repose sur l'extension et le type déclaré par le navigateur. Seul l'en-tête
  `%PDF-` est vérifié, pour les imports.

## 5. Cycle de vie des offres

**États et transitions.**
- Statuts : `draft`, `sending`, `sent`, `accepted`, `archived`. Le refus du client archive le devis.
- Les transitions passent par une RPC service-role qui recontrôle l'acteur.
- Une version non brouillon est figée, y compris pour le service-role.

**Approbation.** Elle n'est imposée que par l'application. La transition SQL ne vérifie pas
`approval_status`, et un admin peut forcer l'envoi.
- **Confirmé à l'exécution** : version passée `sent` et scellée avec une approbation requise mais absente,
  marge 0 %. `approval_status` reste `not_required` alors que la règle exigeait une approbation.

**Cohérence du document.** La publication du PDF exige que l'instantané et les totaux soient identiques à la
version, et le sceau couvre le calcul, le contrat client et l'empreinte du PDF.
- **À l'exécution**, le PDF n'expose ni coût ni marge, mais porte l'identité légale codée en dur de HYDRO
  EXPRESS (`src/lib/company-info.ts`) pour une autre entreprise.

## 6. E-mail, débit, validation, IA

- **Envoi.** Réservé aux rédacteurs, avec une clé d'idempotence obligatoire. Sans clé Resend : erreur 500
  explicite, et le devis reste brouillon (exécuté).
- **Débit.** Aucune limitation applicative : portail, envoi, imports et IA sans plafond.
- **Validation.** Zod est largement utilisé, sauf dans les routes du portail.
- **SSRF.** Aucun `fetch` serveur sur une URL fournie par l'utilisateur.
- **IA.** Pièces, e-mails et tableurs sont envoyés à Gemini, avec le nom de fichier interpolé dans le prompt et
  sans consigne de méfiance. La sortie est contrainte par un schéma JSON et reste un brouillon à valider.
  Impact limité, mais la séparation stricte entre « données » et « instructions » demandée par la vision
  n'est pas réalisée.
- **En-têtes.** Aucun en-tête de sécurité global : ni CSP, ni `frame-ancestors`, ni `Referrer-Policy`.

## 7. Registre de sécurité de l'équipe confronté au code

| Affirmation | Verdict |
|---|---|
| Inscription libre isolée dans un espace personnel (R001-001/002) | **Confirmé** (`20260713132306_isolate_self_signup_tenants.sql`). Chaque inscrit est admin de son espace, ce qui alimente la fuite de §2. |
| R001-003 : recherches inter-entreprises côté serveur après contrôle admin | **Infirmé en effet** : le contrôle porte sur « admin de sa propre entreprise », que tout inscrit obtient |
| R002-001 : portail expiré redirigé avant toute lecture | **Confirmé** (code) |
| R002-005 : pas de décisions contradictoires | **Confirmé** (code) |
| R005-001 : statut et sceau seulement par RPC service-role | **Confirmé** (code et exécution) |
| « 95/95 fixed » | Clôture prouvée sur bases isolées ; **non transposable** à la production sans inventaire |

## 8. Priorités (axe D2)

1. Fermer l'annuaire inter-entreprises et l'inscription libre (positionnement V1 mono-entreprise).
2. Identité légale par entreprise, ou outil mono-entreprise assumé.
3. Forçage de l'approbation réservé à une seconde personne, avec motif et trace.
4. Jetons de portail hachés, limitation de débit sur portail et envoi, en-têtes de sécurité.
5. Inventaire du drapeau `is_admin_user()` en production.
6. Contrôle du contenu des fichiers déposés et consigne de méfiance dans les prompts IA.
