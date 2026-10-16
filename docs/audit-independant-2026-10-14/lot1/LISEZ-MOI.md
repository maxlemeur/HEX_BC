# Lot 1 et étape 0 du lot 2 — travail archivé (16/10/2026)

Ce dossier conserve, sous forme de patch, le travail local réalisé le 14 et le 15/10/2026 à la suite de
l'audit indépendant, et jamais publié. Le 16/10, le porteur a décidé de ne pas le publier : le projet est
en développement, toutes les données sont fictives, la sécurité n'est pas prioritaire. L'arbre de travail
a été ramené à `98408ef0`.

- Patch : [`lot1-et-etape0-2026-10-16.patch`](lot1-et-etape0-2026-10-16.patch), 59 fichiers,
  +4 598 / −2 465 lignes, SHA-256 `5b9527b76d004ee5525d6fd9c109f24cde73b4394ce4da3c6f6136e31d6def6f`.
- Base : `98408ef0` (`origin/main` au 16/10). Vérifié le 16/10 dans un worktree jetable :
  `git apply --check` sans conflit, puis les 59 fichiers reconstitués sont identiques à l'arbre archivé
  (aux fins de ligne près).
- Réappliquer tout ou partie : `git apply --include='<chemin>' docs/audit-independant-2026-10-14/lot1/lot1-et-etape0-2026-10-16.patch`.

## Contenu

| Sujet (audit) | Fichiers principaux | Remarque pour une reprise |
| --- | --- | --- |
| Forçage d'envoi : motif obligatoire, refus si une approbation est exigée, trace dans l'événement d'envoi (S-11) | `src/lib/estimates/force-send-policy.ts` (+ test), `server.ts`, `schemas.ts`, `client.ts`, `EstimateSendGatingDialog.tsx`, `useEstimateEditorStatusController.ts` | Règle métier du circuit de validation, réutilisable indépendamment de la sécurité. |
| Annuaire d'adhésion par adresse exacte, refus d'ajout direct d'un compte existant (S-08) | `src/lib/memberships/*`, `MembershipsManager.tsx`, routes et OpenAPI | Supprime l'ajout de membres tant qu'un parcours d'invitation n'existe pas. |
| RLS `tenant_memberships` (S-09) | `supabase/migrations/20261014172511_restrict_tenant_membership_writes.sql`, `tenant-membership-boundaries.test.sql`, `security-invariants.test.sql` | À réhorodater avant toute reprise : `20261015190000` est publiée après elle. |
| Interrupteur d'inscription `SELF_SIGNUP_ENABLED` (ouvert par défaut) | `src/lib/auth/self-signup.ts`, `HomeLanding.tsx`, `LoginView.tsx`, `SignupForm.tsx` | — |
| En-têtes HTTP, santé, sauvegarde chiffrée, `.env.example`, `.gitignore` | `next.config.ts`, `src/app/api/health/*`, `.github/workflows/supabase-backup.yml` | — |
| Documentation TesterArmy 0.20.0 | `docs/testing/*`, `e2e/README.md` | Supplantée par la migration publiée en 0.21.0 (`d484c5a1`, `a25b5c40`). |
| `zod` épinglé à `4.4.3` | `package.json`, `package-lock.json` | Empêche qu'un `npm install` fasse passer l'application à la version imbriquée sous `e2e`. |

Non inclus : le retrait de l'index de `.claude/settings.local.json`, de l'archive
`docs/handoff-prestataire-2026-10-14/handoff-audit-independant-2026-10-14.zip` et du classeur
`docs/prd_file/Feuille de calcul sans titre.xlsx` (lot 1 de sécurité, abandonné).
