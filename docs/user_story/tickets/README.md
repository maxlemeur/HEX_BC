# Index tickets EST-xxx

> Generation: automatique depuis `EST-E*.md` + les plans d'implementation (`SEQUENCING-3-TEAMS.md`, `v4/IMPLEMENTATION_PLAN.md`).
> Regle: 1 ticket execution = 1 fichier `EST-xxx.md`.

## Couverture

- Tickets indexes dans ce tableau: **115**
- Tickets presents dans le sequencing M0-M4: **35**
- Tickets hors plan (backlog): **30**
- Tickets M5/M6 (nouvelles stories): **21**
- Tickets M7/M8 VNext: **20**
- Tickets M9 IAv2: **9**
- Fichiers `EST-*` hors index historique: **2** (`EST-125.md`, `EST-125-dev-report.md`)

## Tickets

| Ticket | Titre | Sequencing | Phase/Vague | Equipe | Effort | Milestone | Epic source |
|--------|-------|---------------|-------------|--------|--------|-----------|-------------|
| [EST-006](./EST-006.md) | Feature flags runtime | Oui | 0/0.1 | A | M | M0 | [EST-E01](../EST-E01-foundations-dx.md) |
| [EST-007](./EST-007.md) | Design system tokens & component kit | Non | - | Backlog | M | M0 | [EST-E01](../EST-E01-foundations-dx.md) |
| [EST-025](./EST-025.md) | Double discount (remise en cascade) | Non | - | Backlog | M | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-026](./EST-026.md) | Rounding invariant enforcement | Oui | 0/0.3 | B | S | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-027](./EST-027.md) | Multi-currency support | Non | - | Backlog | L | M3 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-028](./EST-028.md) | Marge par tranches de valeur projet | Oui | 0/0.1 | B | M | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-029](./EST-029.md) | Classification Type FO (type de fourniture) | Oui | 0/0.3 | C | S | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-030](./EST-030.md) | Comparaison multi-fournisseurs par article | Oui | 3/3.2 | A | L | M2 | [EST-E09](../EST-E09-suggestions.md) |
| [EST-031](./EST-031.md) | Split MO Atelier / Chantier | Oui | 0/0.2 | A | M | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-032](./EST-032.md) | Coefficient de majoration temps de pose | Oui | 0/0.3 | C | S | M0 | [EST-E02](../EST-E02-db-engine.md) |
| [EST-033](./EST-033.md) | Identifiant structure AID | Non | - | Backlog | S | M1 | [EST-E07](../EST-E07-structure.md) |
| [EST-034](./EST-034.md) | Import format OPTIMA | Oui | 4/4.1 | B | M | M2 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-035](./EST-035.md) | Import CSV Price Book | Oui | 3/3.1 | B | M | M2 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-036](./EST-036.md) | Events append-only (estimate_version_events) | Oui | 5/5.1 | C | S | M3 | [EST-E03](../EST-E03-security-immutability.md) |
| [EST-037](./EST-037.md) | Rules engine : garde-fous marge/remise + approbations | Oui | 6/6.1 | A | L | M4 | [EST-E08](../EST-E08-quality-gating.md) |
| [EST-044](./EST-044.md) | Optimistic concurrency control | Oui | 0/0.1 | C | M | M0 | [EST-E03](../EST-E03-security-immutability.md) |
| [EST-045](./EST-045.md) | Draft lock (pessimistic) | Oui | 0/0.2 | C | M | M0 | [EST-E03](../EST-E03-security-immutability.md) |
| [EST-046](./EST-046.md) | Immutability seal on sent versions | Oui | 0/0.2 | B | S | M0 | [EST-E03](../EST-E03-security-immutability.md) |
| [EST-064](./EST-064.md) | Streaming export endpoint | Non | - | Backlog | M | M0 | [EST-E04](../EST-E04-api.md) |
| [EST-065](./EST-065.md) | OpenAPI/Swagger documentation | Non | - | Backlog | M | M0 | [EST-E04](../EST-E04-api.md) |
| [EST-066](./EST-066.md) | Batch operations API | Non | - | Backlog | L | M0 | [EST-E04](../EST-E04-api.md) |
| [EST-081](./EST-081.md) | Liste devis amelioree | Non | - | Backlog | M | M1 | [EST-E05](../EST-E05-ui-base.md) |
| [EST-082](./EST-082.md) | Creation guidee (wizard) | Non | - | Backlog | M | M1 | [EST-E05](../EST-E05-ui-base.md) |
| [EST-083](./EST-083.md) | Dashboard recapitulatif | Non | - | Backlog | M | M1 | [EST-E05](../EST-E05-ui-base.md) |
| [EST-084](./EST-084.md) | Mode impression ameliore | Non | - | Backlog | M | M1 | [EST-E05](../EST-E05-ui-base.md) |
| [EST-101](./EST-101.md) | Navigation clavier tableur | Oui | 1/1.1 | A | L | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-102](./EST-102.md) | Edition inline rapide | Oui | 1/1.2 | A | M | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-103](./EST-103.md) | Multi-selection et actions groupees | Oui | 1/1.2 | B | L | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-104](./EST-104.md) | Copier/Coller depuis Excel | Oui | 1/1.3 | A | L | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-105](./EST-105.md) | Auto-save debounce | Oui | 1/1.1 | B | M | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-106](./EST-106.md) | Undo/Redo global | Oui | 1/1.2 | C | L | M1 | [EST-E06](../EST-E06-turbo-editor.md) |
| [EST-121](./EST-121.md) | Sous-totaux par section | Oui | 0/0.3 | A | M | M0 | [EST-E07](../EST-E07-structure.md) |
| [EST-122](./EST-122.md) | Sections imbriquees (2 niveaux) | Non | - | Backlog | L | M1 | [EST-E07](../EST-E07-structure.md) |
| [EST-123](./EST-123.md) | Conversion section / ligne | Non | - | Backlog | S | M1 | [EST-E07](../EST-E07-structure.md) |
| [EST-124](./EST-124.md) | Numerotation automatique | Non | - | Backlog | S | M1 | [EST-E07](../EST-E07-structure.md) |
| [EST-141](./EST-141.md) | Gating envoi (sent) | Oui | 4/4.1 | A | M | M2 | [EST-E08](../EST-E08-quality-gating.md) |
| [EST-142](./EST-142.md) | Checklist completude | Oui | 4/4.2 | A | M | M2 | [EST-E08](../EST-E08-quality-gating.md) |
| [EST-143](./EST-143.md) | Detection d'outliers | Oui | 3/3.2 | B | M | M2 | [EST-E08](../EST-E08-quality-gating.md) |
| [EST-144](./EST-144.md) | Historique des anomalies | Non | - | Backlog | S | M2 | [EST-E08](../EST-E08-quality-gating.md) |
| [EST-161](./EST-161.md) | Scoring et classement des suggestions | Oui | 2/2.1 | C | M | M1 | [EST-E09](../EST-E09-suggestions.md) |
| [EST-162](./EST-162.md) | Application en masse des suggestions | Oui | 2/2.2 | C | M | M1 | [EST-E09](../EST-E09-suggestions.md) |
| [EST-163](./EST-163.md) | Apprentissage des corrections | Non | - | Backlog | L | M2 | [EST-E09](../EST-E09-suggestions.md) |
| [EST-164](./EST-164.md) | Suggestions depuis le catalogue | Oui | 3/3.1 | A | M | M2 | [EST-E09](../EST-E09-suggestions.md) |
| [EST-181](./EST-181.md) | Templates de devis | Oui | 2/2.1 | A | L | M1 | [EST-E10](../EST-E10-reuse-templates.md) |
| [EST-182](./EST-182.md) | Ouvrages reutilisables | Oui | 2/2.1 | B | L | M1 | [EST-E10](../EST-E10-reuse-templates.md) |
| [EST-183](./EST-183.md) | Duplication partielle (section) | Non | - | Backlog | M | M1 | [EST-E10](../EST-E10-reuse-templates.md) |
| [EST-184](./EST-184.md) | Import depuis un autre devis | Non | - | Backlog | M | M1 | [EST-E10](../EST-E10-reuse-templates.md) |
| [EST-201](./EST-201.md) | Generation PDF serveur | Oui | 3/3.1 | C | L | M2 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-202](./EST-202.md) | Export DPGF aller-retour | Non | - | Backlog | M | M3 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-203](./EST-203.md) | Hash d'integrite document | Non | - | Backlog | S | M3 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-204](./EST-204.md) | Import multi-format | Non | - | Backlog | L | M3 | [EST-E11](../EST-E11-imports-exports.md) |
| [EST-221](./EST-221.md) | Diff visuel entre versions | Oui | 5/5.1 | A | L | M3 | [EST-E12](../EST-E12-versioning.md) |
| [EST-222](./EST-222.md) | Timeline des versions | Oui | 5/5.1 | B | M | M3 | [EST-E12](../EST-E12-versioning.md) |
| [EST-223](./EST-223.md) | Scenarios alternatifs | Oui | 5/5.2 | A | M | M3 | [EST-E12](../EST-E12-versioning.md) |
| [EST-224](./EST-224.md) | Changelog automatique | Oui | 5/5.2 | B | M | M3 | [EST-E12](../EST-E12-versioning.md) |
| [EST-241](./EST-241.md) | Envoi par email | Non | - | Backlog | L | M4 | [EST-E13](../EST-E13-lifecycle-client.md) |
| [EST-242](./EST-242.md) | Portail client | Non | - | Backlog | L | M4 | [EST-E13](../EST-E13-lifecycle-client.md) |
| [EST-243](./EST-243.md) | Acceptation et signature | Non | - | Backlog | M | M4 | [EST-E13](../EST-E13-lifecycle-client.md) |
| [EST-244](./EST-244.md) | Relance automatique | Non | - | Backlog | M | M4 | [EST-E13](../EST-E13-lifecycle-client.md) |
| [EST-245](./EST-245.md) | Negociation (contre-proposition) | Non | - | Backlog | L | M4 | [EST-E13](../EST-E13-lifecycle-client.md) |
| [EST-261](./EST-261.md) | Tests RLS end-to-end | Non | - | Backlog | L | M4 | [EST-E14](../EST-E14-observability-tests.md) |
| [EST-262](./EST-262.md) | Tests E2E parcours critique | Non | - | Backlog | L | M4 | [EST-E14](../EST-E14-observability-tests.md) |
| [EST-263](./EST-263.md) | Metriques et monitoring | Non | - | Backlog | M | M4 | [EST-E14](../EST-E14-observability-tests.md) |
| [EST-264](./EST-264.md) | Optimisation performance editeur | Oui | 1/1.1 | C | L | M1 | [EST-E14](../EST-E14-observability-tests.md) |
| [EST-265](./EST-265.md) | Tests de charge API | Non | - | Backlog | M | M4 | [EST-E14](../EST-E14-observability-tests.md) |
| [EST-301](./EST-301.md) | Decomposition DS/FC/FG/B&A | Non | M5/V1 | Backlog | L | M5 | [EST-E15](../EST-E15-structure-prix-btp.md) |
| [EST-302](./EST-302.md) | Coefficients rendement et pertes | Non | M5/V1 | Backlog | M | M5 | [EST-E15](../EST-E15-structure-prix-btp.md) |
| [EST-311](./EST-311.md) | Ouvrages composes (sous-detail prix) | Non | M5/V2 | Backlog | L | M5 | [EST-E16](../EST-E16-ouvrages-bibliotheque.md) |
| [EST-312](./EST-312.md) | Connexion Batiprix/UNTEC | Non | M5/V2 | Backlog | L | M5 | [EST-E16](../EST-E16-ouvrages-bibliotheque.md) |
| [EST-321](./EST-321.md) | Formules dans les quantites | Non | M5/V1 | Backlog | L | M5 | [EST-E17](../EST-E17-metres-formules.md) |
| [EST-322](./EST-322.md) | Carnet de metres integre | Non | M5/V2 | Backlog | L | M5 | [EST-E17](../EST-E17-metres-formules.md) |
| [EST-331](./EST-331.md) | Situations de travaux | Non | M6/V3 | Backlog | XL | M6 | [EST-E18](../EST-E18-situations-avenants.md) |
| [EST-332](./EST-332.md) | Avenants / travaux supplementaires | Non | M6/V3 | Backlog | L | M6 | [EST-E18](../EST-E18-situations-avenants.md) |
| [EST-333](./EST-333.md) | Retenue de garantie et cautions | Non | M6/V3 | Backlog | M | M6 | [EST-E18](../EST-E18-situations-avenants.md) |
| [EST-334](./EST-334.md) | Decompte General Definitif (DGD) | Non | M6/V4 | Backlog | L | M6 | [EST-E18](../EST-E18-situations-avenants.md) |
| [EST-341](./EST-341.md) | Lots techniques (allotissement) | Non | M6/V3 | Backlog | L | M6 | [EST-E19](../EST-E19-lots-sous-traitance.md) |
| [EST-342](./EST-342.md) | Sous-traitance dans le devis | Non | M6/V3 | Backlog | M | M6 | [EST-E19](../EST-E19-lots-sous-traitance.md) |
| [EST-343](./EST-343.md) | Consultation fournisseurs automatisee | Non | M6/V4 | Backlog | L | M6 | [EST-E19](../EST-E19-lots-sous-traitance.md) |
| [EST-351](./EST-351.md) | Multi-TVA (20%/10%/5.5%) + recap | Non | M5/V1 | Backlog | M | M5 | [EST-E20](../EST-E20-conformite-pdf-pro.md) |
| [EST-352](./EST-352.md) | Mentions legales obligatoires | Non | M5/V1 | Backlog | S | M5 | [EST-E20](../EST-E20-conformite-pdf-pro.md) |
| [EST-353](./EST-353.md) | Page de garde et recapitulatif | Non | M5/V2 | Backlog | M | M5 | [EST-E20](../EST-E20-conformite-pdf-pro.md) |
| [EST-354](./EST-354.md) | Conditions generales et particulieres | Non | M5/V2 | Backlog | M | M5 | [EST-E20](../EST-E20-conformite-pdf-pro.md) |
| [EST-361](./EST-361.md) | Suivi budgetaire projet (prev. vs realise) | Non | M6/V4 | Backlog | L | M6 | [EST-E18](../EST-E18-situations-avenants.md) |
| [EST-362](./EST-362.md) | Referentiel normes BTP (DTU, RE2020...) | Non | M5/V2 | Backlog | M | M5 | [EST-E20](../EST-E20-conformite-pdf-pro.md) |
| [EST-363](./EST-363.md) | Ouvrages favoris et acces rapide | Non | M5/V2 | Backlog | S | M5 | [EST-E16](../EST-E16-ouvrages-bibliotheque.md) |
| [EST-364](./EST-364.md) | Remises multi-niveaux (devis/section/ligne) | Non | M5/V1 | Backlog | M | M5 | [EST-E15](../EST-E15-structure-prix-btp.md) |
| [EST-371](./EST-371.md) | Ingestion dossier multi-documents et classement IA | VNext | 7/7.2 | A | L | M7 | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) |
| [EST-372](./EST-372.md) | Brief affaire genere automatiquement | VNext | 7/7.3 | A | M | M7 | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) |
| [EST-373](./EST-373.md) | Registre hypotheses / pieces manquantes | VNext | 7/7.4 | A | M | M7 | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) |
| [EST-374](./EST-374.md) | Command bar contextuelle du cockpit | VNext | 7/7.5 | C | M | M7 | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) |
| [EST-381](./EST-381.md) | Generation d'ouvrages depuis texte libre ou CCTP | VNext | 7/7.4 | A | L | M7 | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) |
| [EST-382](./EST-382.md) | Generation automatique de structure lots / chapitres | VNext | 7/7.3 | B | L | M7 | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) |
| [EST-383](./EST-383.md) | Suggestions de sous-detail et ouvrages composes | VNext | 7/7.5 | B | L | M7 | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) |
| [EST-384](./EST-384.md) | Brouillon complet dossier -> V0 | VNext | 8/8.1 | B | XL | M8 | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) |
| [EST-391](./EST-391.md) | Evidence Graph par ligne | VNext | 7/7.2 | B | L | M7 | [EST-E23](../EST-E23-preuve-prix-risque.md) |
| [EST-392](./EST-392.md) | Suggestion de prix avec fourchette et sources | VNext | 7/7.3 | B | L | M7 | [EST-E23](../EST-E23-preuve-prix-risque.md) |
| [EST-393](./EST-393.md) | Radar d'incoherences et marge a risque | VNext | 7/7.2 | B | M | M7 | [EST-E23](../EST-E23-preuve-prix-risque.md) |
| [EST-394](./EST-394.md) | Explication des prix et des deltas de version | VNext | 7/7.4 | B | M | M7 | [EST-E23](../EST-E23-preuve-prix-risque.md) |
| [EST-401](./EST-401.md) | Presence, lecture partagee et commentaires temps reel | VNext | 7/7.5 | C | M | M7 | [EST-E24](../EST-E24-collaboration-revue-exception.md) |
| [EST-402](./EST-402.md) | File de revue par exception assignable | VNext | 7/7.5 | C | M | M7 | [EST-E24](../EST-E24-collaboration-revue-exception.md) |
| [EST-403](./EST-403.md) | Revue multi-role et checklists par profil | VNext | 8/8.1 | C | M | M8 | [EST-E24](../EST-E24-collaboration-revue-exception.md) |
| [EST-404](./EST-404.md) | Journal des corrections et apprentissage equipe | VNext | 7/7.5 | A | M | M7 | [EST-E24](../EST-E24-collaboration-revue-exception.md) |
| [EST-411](./EST-411.md) | Lecture des retours client et detection des changements | VNext | 8/8.1 | B | L | M8 | [EST-E25](../EST-E25-revision-engine-boucle-client.md) |
| [EST-412](./EST-412.md) | Analyse d'impact quantites / prix / marge | VNext | 8/8.2 | A | L | M8 | [EST-E25](../EST-E25-revision-engine-boucle-client.md) |
| [EST-413](./EST-413.md) | Reponse assistee et contre-proposition structuree | VNext | 8/8.2 | B | M | M8 | [EST-E25](../EST-E25-revision-engine-boucle-client.md) |
| [EST-414](./EST-414.md) | Questions client -> taches -> decisions | VNext | 8/8.2 | A | M | M8 | [EST-E25](../EST-E25-revision-engine-boucle-client.md) |
| [EST-421](./EST-421.md) | Persistance batch provider et etats jobs | IAv2 | 9/9.1 | A | M | M9 | [IAV2-E01](../IAv2/IAV2-E01-batch-durable-reprise.md) |
| [EST-422](./EST-422.md) | Plafond budget global avant escalation | IAv2 | 9/9.1 | B | M | M9 | [IAV2-E02](../IAv2/IAV2-E02-routing-budget-confiance.md) |
| [EST-423](./EST-423.md) | Instrumentation des corrections humaines | IAv2 | 9/9.1 | C | M | M9 | [IAV2-E03](../IAv2/IAV2-E03-evaluation-pilote-metier.md) |
| [EST-424](./EST-424.md) | Worker de reconciliation Batch et state machine | IAv2 | 9/9.2 | A | L | M9 | [IAV2-E01](../IAv2/IAV2-E01-batch-durable-reprise.md) |
| [EST-425](./EST-425.md) | Classifieur document et niveau recommande | IAv2 | 9/9.2 | B | M | M9 | [IAV2-E02](../IAv2/IAV2-E02-routing-budget-confiance.md) |
| [EST-426](./EST-426.md) | Monitoring hub et statuts lisibles | IAv2 | 9/9.2 | C | M | M9 | [IAV2-E05](../IAv2/IAV2-E05-ux-lancement-monitoring-remediation.md) |
| [EST-427](./EST-427.md) | Actions operateur de reprise et remediation | IAv2 | 9/9.3 | A | M | M9 | [IAV2-E01](../IAv2/IAV2-E01-batch-durable-reprise.md) |
| [EST-428](./EST-428.md) | Robustesse PDF terrain et echec explicite | IAv2 | 9/9.3 | B | M | M9 | [IAV2-E05](../IAv2/IAV2-E05-ux-lancement-monitoring-remediation.md) |
| [EST-429](./EST-429.md) | Dashboard pilote et criteres go/no-go | IAv2 | 9/9.3 | C | M | M9 | [IAV2-E03](../IAv2/IAV2-E03-evaluation-pilote-metier.md) |

## Usage

- Les details fonctionnels canoniques restent dans les fichiers `EST-E..`.
- Les fichiers `tickets/EST-xxx.md` servent au pilotage execution (owner, dependances, done, liens PR).
- Mettre a jour le statut dans le ticket `EST-xxx.md` et dans l outil de tracking.
- Pour tester une UI, un parcours ou capturer une preuve visuelle d'un flux, les equipes peuvent utiliser le skill [`agent-browser`](../../../.agents/skills/agent-browser/SKILL.md).
