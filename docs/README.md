# Documentation

> **Refondue le 2026-07-29.** L'ancien corpus — 254 fichiers d'épics, tickets, plans et archives — a
> été supprimé. Il déclarait 22 statuts faux sur 26, portait 197 liens cassés et citait 95 chemins de
> code qui n'existaient plus.
>
> Tout ce qui suit obéit à un contrat unique : **chaque affirmation d'existence porte une référence
> `fichier:ligne`, chaque affirmation d'absence porte la commande qui la prouve.**
> En cas de divergence avec le code, **c'est la documentation qu'on corrige**.

## Par où commencer

| Vous voulez… | Lisez |
|---|---|
| Travailler sur ce dépôt | [`../AGENTS.md`](../AGENTS.md) — le contrat opérationnel |
| Comprendre le produit en 2 minutes | [`../README.md`](../README.md) |
| **Toucher aux calculs** | [`metier/regles-de-calcul.md`](metier/regles-de-calcul.md) — **obligatoire avant tout changement** |
| Comprendre un terme métier | [`metier/glossaire.md`](metier/glossaire.md) |
| Comprendre statuts et validations | [`metier/cycle-de-vie.md`](metier/cycle-de-vie.md) |
| Savoir ce qui est cassé ou manquant | [`metier/ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) |
| Travailler sur un domaine précis | [`domaines/`](domaines/) |

---

## `metier/` — les règles transverses

| Document | Contenu |
|---|---|
| [`regles-de-calcul.md`](metier/regles-de-calcul.md) | Centimes et points de base, arrondis, formule de ligne, marge, coefficient, remises, TVA, autoliquidation, hiérarchie, **les deux moteurs de calcul et pourquoi un seul s'exécute** |
| [`glossaire.md`](metier/glossaire.md) | Vocabulaire du chiffrage BTP — et ce que le produit en fait réellement |
| [`cycle-de-vie.md`](metier/cycle-de-vie.md) | Statuts, transitions, immutabilité à trois couches, scellement, rôles, gating, approbations, portail, application d'un métré |
| [`ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) | **8 défauts actifs**, ce qui est absent (avec preuve), ce qui est présent mais contre-intuitif, la dette technique |

## `domaines/` — la référence fonctionnelle

Un document par domaine, écrit depuis le code sans lire l'ancienne documentation.

| Domaine | Couvre |
|---|---|
| [`affaires-intake.md`](domaines/affaires-intake.md) | Hub affaire, dépôt et classification des pièces, brief IA, registre d'hypothèses, synchro plans, file manager |
| [`chiffrage-editeur.md`](domaines/chiffrage-editeur.md) | Structure du devis, éditeur tableur, raccourcis, presse-papier, verrou, templates et ouvrages, brouillons IA, versions et diff, qualité |
| [`metre-takeoff.md`](domaines/metre-takeoff.md) | Pipeline sync/batch, Gemini, niveaux A/B/C, jeux de plans, revue, preuves, rapprochement DPGF, radar de risque |
| [`catalogue-prix.md`](domaines/catalogue-prix.md) | Produits, fournisseurs, pricebook, indices, taux de change, barèmes de marge, import CSV, fraîcheur des prix |
| [`imports-dpgf.md`](domaines/imports-dpgf.md) | Chaîne canonique CSV/XLSX/**PDF** → `dpgf_rows_raw` → mappings → import, provenance |
| [`validation-approbations.md`](domaines/validation-approbations.md) | Moteur de règles, les 19 drapeaux de gating, cycles de revue, journal, vue direction, cockpit, analytics |
| [`sorties-documents.md`](domaines/sorties-documents.md) | PDF, exports DPGF/BDC/xlsx, email, portail client, bons de commande |
| [`securite-multi-tenant.md`](domaines/securite-multi-tenant.md) | Tenants, rôles, RLS, triggers de garde, service-role, Storage, feature flags, audit, frontières à haut risque |

## Opérations

| Document | Contenu |
|---|---|
| [`../supabase/README.md`](../supabase/README.md) | Base de données et migrations |
| [`../e2e/README.md`](../e2e/README.md) | Suites de tests bout-en-bout |
| [`test-logins.md`](test-logins.md) | Comptes de test — **aucun identifiant n'est jamais committé** |
| [`sofinther-automation.md`](sofinther-automation.md) | Récupération des prix fournisseur |
| [`security-remediation-91386191.md`](security-remediation-91386191.md) | Registre de remédiation, campagne close (95 constats traités) |

## Audit

[`audit/AUDIT-2026-07-inventaire.md`](audit/AUDIT-2026-07-inventaire.md) — 27 bugs et 73 constats
UX/UI avec un statut de rapprochement par item.

> 🔒 **Fichier généré. Ne jamais l'éditer à la main ni le déplacer.** Il est régénéré par
> [`../scripts/extract-audit-artifact.mjs`](../scripts/extract-audit-artifact.mjs) depuis
> `audit/AUDIT-2026-07-source.normalized.json`, et
> [`../src/lib/audit-artifact-generator.test.ts`](../src/lib/audit-artifact-generator.test.ts)
> vérifie la régénération à l'octet près.

[`AUDIT-DOCUMENTATION-2026-07-29.md`](AUDIT-DOCUMENTATION-2026-07-29.md) — l'audit qui a motivé cette
refonte. Instantané daté : son plan d'action est exécuté.

---

## Règles de tenue

Ces cinq règles sont ce qui a manqué au corpus précédent. Les tenir coûte moins cher que de refaire
cet audit.

1. **Pas d'affirmation sans preuve.** Une existence se cite `fichier:ligne` ; une absence se prouve
   par la commande qui ne retourne rien. Une absence se périme comme une présence.
2. **Pas de statut.** « À faire », « livré », « en cours » n'ont pas leur place ici : ces champs
   mentaient dans 22 cas sur 26 parce que personne ne les relisait. L'état d'avancement appartient à
   un tracker et à `git log`.
3. **Un sujet, un document.** Pas de consolidation qui recopie une autre source : l'ancien corpus
   avait trois documents décrivant le même plan vNext, et une analyse de 3 522 lignes qui recopiait
   l'index en divergeant.
4. **Les artefacts éphémères ne sont pas de la documentation.** Handoffs, prompts d'agent, plans de
   sprint : l'historique git suffit.
5. **Le code fait foi.** Quand la doc et le code divergent, c'est la doc qu'on corrige — jamais
   l'inverse.
