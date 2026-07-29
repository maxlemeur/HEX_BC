# Backlog ouvert

> État au **2026-07-29**, établi par croisement des tickets avec `git log`, les migrations et les
> tests de régression. Tout ce qui était livré a été archivé.
>
> ⚠️ **Les statuts déclarés à l'intérieur des fichiers ne sont pas fiables** (héritage : 24 tickets
> déclarés « À faire » étaient en réalité livrés). Ce README est la référence, pas les en-têtes.

---

## 1. Bugs en production — à traiter en premier

[`bugs-est-e23/`](bugs-est-e23/) — trois défauts constatés sur `EST-394`, jamais corrigés :

| Ticket | Défaut |
|---|---|
| `EST-433` | Disparition de « Expliquer ce prix » après duplication de version |
| `EST-434` | Incohérence entre le résumé de delta global et le delta de ligne (majeur) |
| `EST-435` | Impact marge insuffisamment explicite dans le panneau delta (mineur) |

> Ces numéros entrent en **collision** avec `tickets/EST-433/434/435` de l'archive, qui sont des
> tickets d'exécution totalement différents. Les bugs sont antérieurs (2026-03-10) mais les tickets
> homonymes sont cités dans des messages de commit — renuméroter les **bugs** en EST-453/454/455 est
> l'option à coût nul.

## 2. Défauts métier actifs — non ticketés

Découverts par l'audit du 2026-07-29, documentés dans
[`../metier/ecarts-standards-btp.md`](../metier/ecarts-standards-btp.md) § 1. Aucun n'a de ticket.

| Priorité | Défaut |
|---|---|
| 🔴 | **Aucune colonne `unit` sur `estimate_items`** — l'export DPGF prend la `description` pour unité |
| 🔴 | **Le sous-détail de prix est détruit** à l'insertion d'un ouvrage dans un devis |
| 🔴 | **`margin_bp` vaut 0 par défaut** et rend le repli inatteignable → toute règle `min_margin` se déclenche à tort |
| 🟠 | **La TVA est en `Math.round`** alors que `bankersRound` est la règle ailleurs |

## 3. Bloc métier BTP — le vrai backlog produit

[`tickets/`](tickets/) — 21 tickets, **jamais commencés**, qui portent l'essentiel de la valeur
sectorielle restante :

| Plage | Sujet |
|---|---|
| `EST-301`, `EST-302` | Structure de prix : frais de chantier, frais généraux, bénéfice et aléas |
| `EST-311`, `EST-312` | Bibliothèque d'ouvrages, bases de prix de référence (Batiprix / UNTEC) |
| `EST-321`, `EST-322` | Métrés et formules de quantité |
| `EST-331` → `EST-334` | Situations de travaux, avenants, retenue de garantie, DGD |
| `EST-341` → `EST-343` | Lots, allotissement, sous-traitance par ligne |
| `EST-351` → `EST-354` | Conformité : taux réduits, récapitulatif multi-TVA, mentions légales |
| `EST-361` → `EST-364` | PDF professionnel, normes BTP, remises multi-niveaux |

> ⚠️ `EST-351` (récapitulatif TVA par taux) **contredit `EST-E27`**, livré, qui impose un document
> sans ligne de TVA en autoliquidation. Les deux règles doivent être conditionnées par
> `contractor_role`.

> ⚠️ `EST-301` / `EST-302` dépendent de la bascule de moteur (phase F de T6) selon
> `EST-E15-DECISIONS`, alors que l'épic les classe P0. Arbitrage à rendre.

## 4. Collaboration et boucle client — M8, abandonnée

`EST-401` → `EST-404` (collaboration, revue par exception) et `EST-411` → `EST-414` (revision engine).
**Zéro commit, zéro migration.** Des contrats front avaient été écrits pour un backend jamais
développé ; ils ont été supprimés lors de l'audit.

À trancher : relancer ou fermer explicitement.

## 5. Divers

| Ticket | Sujet |
|---|---|
| `EST-244`, `EST-245` | Relances automatiques, négociation client |
| `EST-263` | Observabilité (aucun Sentry / OTel / Datadog dans `package.json`) |
| `EST-265` | Tests de charge (aucun k6 / artillery) |
| `EST-431`, `EST-432` | Bugs QA de l'épic EST-E22 |
| `EST-434` | Hardening UX cockpit v2 |

## 6. IA

[`IAV2-E04-niveau-c-pre-chiffrage-exploitable.md`](IAV2-E04-niveau-c-pre-chiffrage-exploitable.md) —
seul épic IA encore ouvert. Les vagues E01/E02/E03/E05 sont livrées.

⚠️ Référentiel incohérent : cet épic utilise la nomenclature `IAV2-0xx` tandis que le code et le
séquencement utilisent `EST-42x`, sans table de correspondance.

## 7. Refactoring

[`refacto/`](refacto/) — les 3 seuls des 16 refactos initiaux qui restent :

| Ticket | Cible | État |
|---|---|---|
| `REF-007` | `src/components/affaires/AffaireHub.tsx` | ❌ **Non fait, et le fichier a grossi** : 1 770 → **2 128 lignes** |
| `REF-002` | `src/components/estimates/EstimateEditorTable.tsx` | ⚠️ Partiel : 2 900 → 2 468 lignes, objectif −40 % non tenu (−15 %) |
| `REF-015` | `src/components/takeoff/TakeoffReviewPage.tsx` | ❌ Non fait : 1 528 → 1 600 lignes |

## 8. Tickets livrés sans documentation

Livrés et mergés, mais sans fichier ticket nulle part. À créer rétroactivement si la traçabilité
compte : **EST-118, 436, 440, 446, 449, 450, 451, 452**.

Preuves : `src/lib/est449-…test.ts` → `est452-affaire-register-events-follow-up.test.ts`,
`supabase/migrations/030_est_118_bulk_update_version_token_guard.sql`, commits
`774ffa25 feat(EST-446)`, `6b907289 fix(EST-451)`.

---

## Recommandation

Ce dossier est un **instantané de transition**, pas une solution. Ces items ont besoin d'un statut qui
bouge, d'un assignataire et d'une date — trois choses qu'un fichier Markdown en dépôt ne fournit pas.
Les quatre mois de dérive du dossier `tickets/` l'ont démontré : sept tickets ont été livrés sans
jamais y entrer.

**Migrez-les vers un vrai tracker**, et supprimez ce dossier.
