# Archive — instantané de mars 2026

> ⚠️ **N'utilisez aucun fichier de ce dossier pour savoir ce qui est implémenté.**
>
> **Les statuts qu'on y lit sont faux dans une large majorité des cas**, et toujours dans le même
> sens : « À faire » sur du travail livré et mergé depuis. Un développeur qui prend ces fichiers au
> mot réimplémente de l'existant.
>
> **Sources de vérité** : le code, `supabase/migrations/`, `git log`, et
> [`docs/metier/`](../../metier/).

Archivé le 2026-07-29 à l'issue de l'audit
[`AUDIT-DOCUMENTATION-2026-07-29.md`](../../AUDIT-DOCUMENTATION-2026-07-29.md).

---

## Pourquoi ces fichiers ont été archivés plutôt que supprimés

Ils gardent une valeur d'**intention** : ils disent ce qu'on voulait construire et pourquoi, ce que ni
le code ni git ne racontent. Certaines décisions de conception ne sont écrites qu'ici.

Ce qu'ils ne disent pas, en revanche, c'est **l'état du système**. C'est toute la différence.

---

## Contenu

| Dossier | Contenu | État réel de l'implémentation |
|---|---|---|
| [`v1/`](v1/) | Takeoff — TKF-E01 → E07 | **LIVRÉE**. ✅ **Seule vague dont les statuts déclarés sont exacts et datés** — le rapport `REPORT-TAKEOFF-V1-2026-03-07.md` reste une référence honnête |
| [`v2/`](v2/) | Refonte UX TIMAX — UX2-E01 → E06 | **LIVRÉE** (25 stories sur 27). Les 6 épics affichent « À faire » : faux |
| [`v3/`](v3/) | Métrés + Direction — V3-E01 → E07 | **PARTIELLE** (21/26). ⚠️ **V3-E07 « portail client lite » n'a jamais été démarré** (V3-024/025/026) |
| [`v4/`](v4/) | IA / preuve / boucle client — EST-E21 → E25 | **PARTIELLE**. M7 livrée (EST-371 → 394) ; ⚠️ **M8 abandonnée** (EST-401 → 414) |
| [`vNext/`](vNext/) | Convergence TIMAX — VNEXT-E01 → E06 | **LIVRÉE** (57 commits en 2 jours). Les 6 épics affichent « À faire » : faux. `TIMAX-vNext-backlog-structure.md` reste la meilleure spec fonctionnelle jamais écrite du produit |
| [`IAv2/`](IAv2/) | Industrialisation IA — IAV2-E01 → E05 | **PARTIELLE**. EST-421 → 429 livrés ; E04 (niveau C exploitable) jamais démarrée → remontée dans [`docs/backlog/`](../../backlog/) |
| [`to-refacto/`](to-refacto/) | REF-001 → REF-016 | **13 faits sur 16**, tous affichés « À faire ». Les 3 restants sont dans [`docs/backlog/refacto/`](../../backlog/refacto/) |
| [`epics-livres/`](epics-livres/) | EST-E02, E03, E04, E06, E07, E08, E09, E10, E12, E13-plan, E21, E23 | **Tous livrés**, tous affichés « À faire » ou « Proposé » |
| [`tickets/`](tickets/) | ~85 tickets livrés | Les 36 encore ouverts sont dans [`docs/backlog/tickets/`](../../backlog/tickets/) |
| [`analyses/`](analyses/) | ANALYSE-COMPLETE-CHIFFRAGE-BTP, MVP-ANALYSIS, PRD-ANALYSIS, SEQUENCING-3-TEAMS, MVP_game_changer, backlog-chiffrage-comparatif | Vues d'un MVP entièrement livré. `ANALYSE-COMPLETE` porte à elle seule **152 des 197 liens cassés** du dépôt ; seule sa PARTIE 1 (comparatif DeviSOC / Batigest / Batiprix / Onaya / EBP) garde une valeur |
| [`handoffs/`](handoffs/) | EST-E26 phases B et C, HANDOFF audit-backlog, vérification visuelle | Artefacts de passation, périmés par nature. Deux d'entre eux s'auto-avertissent comme tels |
| [`prompts/`](prompts/) | context.md, context-proof-pack.md, prompt-epics-user-stories-vnext, prompt-vnext-proof-pack | **Prompts d'agent**, pas de la documentation. Certains ne sont que des templates à trous |
| [`prd/`](prd/) | PRD_Metre_Assiste_Gemini3 | Fonctionnalité livrée. Garde une valeur de référence sur les **invariants IA** (draft-only, jamais d'auto-apply) |
| [`benchmarks/`](benchmarks/) | EST-101 | Benchmark SQL, sans rapport avec le ticket EST-101 |

---

## Pièges connus dans cette archive

1. **Chemins absolus d'une autre machine.** `to-refacto/PLAN.md` et plusieurs fichiers `v3/` / `v4/`
   pointent vers `/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/…`. Tous morts.

2. **Corruption par search-replace.** Le commit `65da8470` (2026-07-15) a remplacé « assemblage » par
   « ouvrage » dans toute la doc sans relecture, produisant « l'ouvrage de page », « le point
   d'ouvrage », « ouvrages d'ouvrages ». C'est la **seule** modification qu'ont subie `v1/`, `v2/`,
   `v3/` et `to-refacto/` depuis mars.

3. **Collision de numéros EST-433/434/435.** Les tickets de `tickets/` et les bugs de
   [`docs/backlog/bugs-est-e23/`](../../backlog/bugs-est-e23/) sont **six tickets différents** portant
   trois numéros. Ce ne sont pas des doublons.

4. **Deux « VNext » différents.** Le plan dans `v4/IMPLEMENTATION_PLAN.md` s'intitule « VNext » alors
   que `vNext/` contient un plan « vNext » sans rapport, écrit un mois plus tard.

5. **8 tickets livrés n'ont jamais eu de fichier** : EST-118, 436, 440, 446, 449, 450, 451, 452.
   Cherchez-les dans `git log` et dans `src/lib/est4*-*.test.ts`, pas ici.
