# Documentation

Cet index distingue les guides à utiliser sur le checkout courant des preuves
et audits datés. Le contrat opérationnel est dans [AGENTS.md](../AGENTS.md) ;
les versions et commandes exécutables sont dans [package.json](../package.json)
et son lockfile. Une preuve historique conserve sa révision, ses entrées et ses
limites ; elle ne certifie pas une nouvelle version.

## Par où commencer

| Vous voulez… | Lisez |
|---|---|
| Travailler sur ce dépôt | [`../AGENTS.md`](../AGENTS.md) — le contrat opérationnel |
| Comprendre le produit en 2 minutes | [`../README.md`](../README.md) |
| **Toucher aux calculs** | [`metier/regles-de-calcul.md`](metier/regles-de-calcul.md) — **obligatoire avant tout changement** |
| Comprendre un terme métier | [`metier/glossaire.md`](metier/glossaire.md) |
| Comprendre statuts et validations | [`metier/cycle-de-vie.md`](metier/cycle-de-vie.md) |
| Relire les écarts historiques du produit | [`metier/ecarts-standards-btp.md`](metier/ecarts-standards-btp.md), avec les dates de revalidation de chaque section |
| Travailler sur un domaine précis | [`domaines/`](domaines/) |

---

## `metier/` — les règles transverses

| Document | Contenu |
|---|---|
| [`regles-de-calcul.md`](metier/regles-de-calcul.md) | Centimes et points de base, arrondis, TVA, hiérarchie et contrat épinglé de chaque version : moteurs historiques 1/2 et création en moteur 3, sauf politique 2 explicite |
| [`glossaire.md`](metier/glossaire.md) | Vocabulaire du chiffrage BTP — et ce que le produit en fait réellement |
| [`cycle-de-vie.md`](metier/cycle-de-vie.md) | Statuts, transitions, immutabilité à trois couches, scellement, rôles, gating, approbations, portail, application d'un métré |
| [`ecarts-standards-btp.md`](metier/ecarts-standards-btp.md) | Photographie du 29 juillet et revalidations indiquées par section ; vérifier le code courant avant toute décision |

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
| [`testing/tester-army-local-development.md`](testing/tester-army-local-development.md) | Parcours ciblés et développement sur une pile native locale possédée |
| [`testing/tester-army-ci.md`](testing/tester-army-ci.md) | Sélection par impact, jobs, preuves et garde-fous CI |
| [`testing/tester-army-calc-v3.md`](testing/tester-army-calc-v3.md) | Qualification des phases du moteur 3 |
| [`testing/large-estimate-statement-budget.md`](testing/large-estimate-statement-budget.md) | Budgets, volumes réels et limites des mesures SQL et route |
| [`../e2e/fixtures/business/README.md`](../e2e/fixtures/business/README.md) | Fixtures publiques fictives et campagne distincte sur les originaux privés |
| [`test-logins.md`](test-logins.md) | Comptes de test — **aucun identifiant n'est jamais committé** |
| [`sofinther-automation.md`](sofinther-automation.md) | Récupération des prix fournisseur |
| [`security-remediation-91386191.md`](security-remediation-91386191.md) | Registre canonique des dispositions du scan identifié ; ne pas réécrire ses sources |

La qualité locale passe par `npm run verify:pr`. Le contrôle de confidentialité
`npm run check:repository-hygiene` examine les chemins publics et les signatures
de secrets, y compris dans les archives Office ; il ne constitue pas une
certification de confidentialité des contenus métier ou des PDF compressés.
Les originaux sont décrits dans [la notice du corpus privé](prd_file/README.md).

## Audits et preuves historiques

[`audit/AUDIT-2026-07-inventaire.md`](audit/AUDIT-2026-07-inventaire.md) — 27 bugs et 73 constats
UX/UI avec un statut de rapprochement par item.

> 🔒 **Fichier généré. Ne jamais l'éditer à la main ni le déplacer.** Il est régénéré par
> [`../scripts/extract-audit-artifact.mjs`](../scripts/extract-audit-artifact.mjs) depuis
> `audit/AUDIT-2026-07-source.normalized.json`, et
> [`../src/lib/audit-artifact-generator.test.ts`](../src/lib/audit-artifact-generator.test.ts)
> vérifie la régénération à l'octet près.

[`AUDIT-DOCUMENTATION-2026-07-29.md`](AUDIT-DOCUMENTATION-2026-07-29.md) — l'audit qui a motivé cette
refonte. Instantané daté : son plan d'action est exécuté.

[`AUDIT-DETTE-TECHNIQUE-2026-10-10.md`](AUDIT-DETTE-TECHNIQUE-2026-10-10.md) — dette technique priorisée
(28 postes, plan par phases), delta de
[`AUDIT-DETTE-TECHNIQUE-2026-08-19.md`](AUDIT-DETTE-TECHNIQUE-2026-08-19.md). Instantanés datés.

Les suivis conservés comprennent [le registre de décomposition](codebase-improvement-ledger.md),
[la migration des parcours legacy](testing/legacy-to-army-migration-2026-10-19.md),
[le dossier d'audit indépendant](audit-independant-2026-10-14/LISEZ-MOI.md)
et [l'assainissement local du 19 octobre](testing/repository-hygiene-2026-10-19.md).
Les archives de transmission et les originaux non anonymisés restent dans le
dossier privé local ; leurs notices ne sont pas des liens de téléchargement public.

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
4. **Conserver une seule source par sujet.** Les archives privées, copies de
   sources, profils et journaux bruts restent hors Git. Les preuves utiles
   conservent un résumé daté et leur identité ; l'historique n'est pas réécrit.
5. **Le code fait foi.** Quand la doc et le code divergent, c'est la doc qu'on corrige — jamais
   l'inverse.
