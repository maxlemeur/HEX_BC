# Épics actifs

> Réorganisé le **2026-07-29**. L'index précédent annonçait « 14 epics », en indexait 25, ignorait les
> deux épics les plus actifs (E26, E27), et annonçait « 21 migrations » et « 12 route handlers » là où
> il y en a **187** et **122**. Il a été remplacé.
>
> ⚠️ **Les statuts déclarés à l'intérieur de ces fichiers ne sont pas fiables.** L'audit en a trouvé
> 22 faux, toujours dans le même sens (« À faire » sur du livré). Vérifiez dans le code.
>
> Les épics **livrés** sont dans
> [`../archive/2026-03/epics-livres/`](../archive/2026-03/epics-livres/).

---

## En cours

| Épic | Sujet | État réel |
|---|---|---|
| [`EST-E26-reconciliation-totaux.md`](EST-E26-reconciliation-totaux.md) | Unification des deux moteurs de calcul (T6) | **En cours.** ⚠️ La spec elle-même est dépassée : elle affirme que `calc_engine_version` n'est lue nulle part, alors qu'elle l'est sur 6 surfaces, et le gate de `computeReadOnlyTotals` est livré. Seul l'éditeur épingle encore la v1. Voir [`../metier/regles-de-calcul.md` § 8](../metier/regles-de-calcul.md) |
| [`EST-E27-DECISIONS-regime-tva-sous-traitance.md`](EST-E27-DECISIONS-regime-tva-sous-traitance.md) | Autoliquidation TVA sous-traitance | ⚠️ **Le plan du §4 est intégralement livré**, alors que le document se lit comme un plan à exécuter d'un bloc. Seul le §6 (recherche fiscale sourcée) garde sa valeur |
| [`EST-E22-draft-assiste-ouvrages.md`](EST-E22-draft-assiste-ouvrages.md) | Draft assisté d'ouvrages | **Livré, QA ouverte.** Seul épic dont le statut déclaré est exact |

## Partiellement livrés

| Épic | Ce qui manque réellement |
|---|---|
| [`EST-E01-foundations-dx.md`](EST-E01-foundations-dx.md) | EST-007 (Storybook) |
| [`EST-E05-ui-base.md`](EST-E05-ui-base.md) | EST-083 : `EstimateDashboard.tsx` est du code mort |
| [`EST-E11-imports-exports.md`](EST-E11-imports-exports.md) | EST-203 (hash de document), EST-204 (Batigest / Onaya) |
| [`EST-E13-lifecycle-client.md`](EST-E13-lifecycle-client.md) | EST-244 (relances), EST-245 (`estimate_negotiations` est une table morte) |
| [`EST-E14-observability-tests.md`](EST-E14-observability-tests.md) | EST-263 (aucun APM), EST-265 (aucun test de charge) |
| [`EST-E15-structure-prix-btp.md`](EST-E15-structure-prix-btp.md) + [`EST-E15-DECISIONS-structure-prix.md`](EST-E15-DECISIONS-structure-prix.md) | Incrément 1 livré ; **EST-301/302 (FC/FG/B&A) absents**. ⚠️ Les deux fichiers se contredisent sur le typage des coefficients (bp vs numeric) et sur l'ordonnancement face à T6 |
| [`EST-E16-ouvrages-bibliotheque.md`](EST-E16-ouvrages-bibliotheque.md) | ⚠️ Le document affirme qu'il n'y a pas de sous-détail par nature de coût — **c'est faux**, il existe depuis mars… mais il est détruit à l'insertion. Voir [`../metier/ecarts-standards-btp.md` § 1.2](../metier/ecarts-standards-btp.md) |
| [`EST-E20-conformite-pdf-pro.md`](EST-E20-conformite-pdf-pro.md) | ⚠️ Sa section « existant » est fausse sur la multi-TVA, et **EST-351 contredit EST-E27** (livré) |
| [`EST-E24-collaboration-revue-exception.md`](EST-E24-collaboration-revue-exception.md) | EST-401 (temps réel) |

## Jamais commencés — et c'est exact

| Épic | Sujet |
|---|---|
| [`EST-E17-metres-formules.md`](EST-E17-metres-formules.md) | Carnet de métrés, formules de quantité |
| [`EST-E18-situations-avenants.md`](EST-E18-situations-avenants.md) | Situations, avenants, retenue de garantie, DGD |
| [`EST-E19-lots-sous-traitance.md`](EST-E19-lots-sous-traitance.md) | Allotissement, sous-traitance par ligne |
| [`EST-E25-revision-engine-boucle-client.md`](EST-E25-revision-engine-boucle-client.md) | Moteur de révision |

## Rôles

| Rôle | Code | Périmètre |
|---|---|---|
| Chiffreur | `engineer` | Crée et édite les devis en brouillon |
| Direction | `director` | Validation, revue, portefeuille de risque |
| Admin | `admin` | Tenants, membres, feature flags, règles, forçages |
| Lecteur | `viewer` | Lecture seule |

## Audit UX/UI

[`AUDIT-2026-07-inventaire.md`](AUDIT-2026-07-inventaire.md) — 27 bugs et 73 constats UX avec un
statut de rapprochement par item. **Le seul document dont l'état a été vérifié par sondage et trouvé
exact**, et honnête sur sa propre incomplétude (49 constats non rouverts).

> 🔒 **Fichier généré. Ne jamais l'éditer à la main ni le déplacer.** Il est régénéré par
> [`../../scripts/extract-audit-artifact.mjs`](../../scripts/extract-audit-artifact.mjs) depuis
> `AUDIT-2026-07-source.normalized.json`, et
> [`../../src/lib/audit-artifact-generator.test.ts`](../../src/lib/audit-artifact-generator.test.ts)
> vérifie la régénération à l'octet près.

---

Backlog d'exécution : [`../backlog/`](../backlog/) · Règles métier : [`../metier/`](../metier/)
