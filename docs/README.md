# Documentation

> Réorganisée le **2026-07-29**. Tout ce qui n'est pas listé ci-dessous comme *vivant* est dans
> [`archive/`](archive/) et ne doit pas être utilisé pour inférer l'état du système.

## Par où commencer

| Vous voulez… | Lisez |
|---|---|
| Travailler sur ce dépôt | [`../AGENTS.md`](../AGENTS.md) — le contrat opérationnel |
| Comprendre le produit | [`../README.md`](../README.md) |
| Toucher aux calculs | [`metier/regles-de-calcul.md`](metier/regles-de-calcul.md) — **obligatoire avant tout changement** |
| Comprendre un terme métier | [`metier/glossaire.md`](metier/glossaire.md) |
| Comprendre statuts et validations | [`metier/cycle-de-vie.md`](metier/cycle-de-vie.md) |
| Savoir ce qui manque ou est cassé | [`metier/ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) |
| Savoir ce qui reste à faire | [`backlog/`](backlog/) |

## Documentation vivante

### `metier/` — règles métier

Établies par lecture du code, chaque règle ancrée sur un `fichier:ligne`. **En cas de divergence avec
le code, c'est le code qui fait foi et ce document qui doit être corrigé.**

- [`regles-de-calcul.md`](metier/regles-de-calcul.md) — montants, arrondis, formule de ligne, marge,
  remises, TVA, hiérarchie, les deux moteurs de calcul
- [`glossaire.md`](metier/glossaire.md) — vocabulaire du chiffrage BTP, et ce que le produit en fait
- [`cycle-de-vie.md`](metier/cycle-de-vie.md) — statuts, immutabilité, scellement, rôles, gating,
  approbations, portail, application d'un métré
- [`ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) — défauts actifs, dette assumée,
  angles morts

### `backlog/` — ce qui reste ouvert

- [`tickets/`](backlog/tickets/) — 36 tickets encore ouverts, dont le bloc métier BTP (EST-301 → 364)
- [`bugs-est-e23/`](backlog/bugs-est-e23/) — 3 bugs **encore présents en production**
- [`refacto/`](backlog/refacto/) — REF-002, REF-007, REF-015 : les seuls refactos non faits
- [`IAV2-E04-…`](backlog/) — seul épic IA encore ouvert

### `user_story/` — épics actifs

Épics partiels, ouverts, ou en cours de bascule. Les épics livrés sont dans
[`archive/2026-03/epics-livres/`](archive/2026-03/epics-livres/).

⚠️ **Les statuts déclarés dans ces fichiers ne sont pas fiables** — l'audit en a trouvé 22 faux.
Vérifiez dans le code avant d'agir.

Cas particulier : [`user_story/AUDIT-2026-07-inventaire.md`](user_story/AUDIT-2026-07-inventaire.md)
est **généré** par [`../scripts/extract-audit-artifact.mjs`](../scripts/extract-audit-artifact.mjs)
depuis `AUDIT-2026-07-source.normalized.json`, et un test vitest vérifie sa régénération à l'octet
près. **Ne jamais l'éditer à la main ni le déplacer.**

### Opérations

- [`../supabase/README.md`](../supabase/README.md) — base de données, migrations
- [`../e2e/README.md`](../e2e/README.md) — suites de tests bout-en-bout
- [`test-logins.md`](test-logins.md) — comptes de test (jamais d'identifiant committé)
- [`sofinther-automation.md`](sofinther-automation.md) — récupération des prix fournisseur
- [`security-remediation-91386191.md`](security-remediation-91386191.md) — registre de remédiation
  (campagne close : 95 constats traités)
- [`performance/EST-264.md`](performance/EST-264.md) — protocole de benchmark de l'éditeur

### Audit

- [`AUDIT-DOCUMENTATION-2026-07-29.md`](AUDIT-DOCUMENTATION-2026-07-29.md) — d'où vient cette
  réorganisation, et pourquoi

## Archive

[`archive/2026-03/`](archive/2026-03/) contient les vagues produit v1 → vNext, les épics livrés, les
~85 tickets livrés, les analyses et les prompts d'agent. **Lisez l'avertissement en entrée** avant de
vous appuyer sur l'un de ces fichiers.

## Règles de tenue

1. **Un sujet, un document.** Pas de consolidation qui recopie une autre source.
2. **Pas d'état sans preuve.** Une affirmation sur ce qui est implémenté cite un `fichier:ligne`.
3. **Pas de statut non daté.** Un statut sans date est un mensonge en devenir.
4. **Les artefacts éphémères ne sont pas de la documentation.** Handoffs, prompts d'agent et plans de
   sprint n'ont pas leur place ici : l'historique git suffit.
5. **Le code fait foi.** Quand la doc et le code divergent, c'est la doc qu'on corrige.
