# Plan d'implementation VNext — V3 Addendum + V4

## Hypothèses

- La base affaire-centric V2 est disponible (`/dashboard/affaires`, hub affaire, import unifié).
- Le track V3 Takeoff E01-E03 existe déjà ou arrive sur `main` avant le démarrage M7.
- Ce plan couvre :
  - l'addendum V3 Takeoff (7 stories amendées)
  - le track V3 Approbation / Direction (12 stories)
  - les epics EST-E21 à EST-E25 (20 stories)

> Points : S=1, M=2, L=3, XL=5. Total : **89 points**.

## Equipes

| Equipe | Profil | Focus principal | Charge (pts) |
| ------ | ------ | --------------- | ------------ |
| **A** | Fullstack | Workflow affaire, approbation, portail et boucle client | 30 |
| **B** | Fullstack | IA, moteurs preuve/prix/risque, génération assistée | 29 |
| **C** | Frontend | Cockpit affaire, review, dashboards, collaboration temps réel | 30 |

---

## Assignation par equipe

### Equipe A — Fullstack workflow / approbation / client

> Cette equipe porte plusieurs surfaces front metier. Les stories marquees `Oui` en `UX front` ne sont pas de simples branchements UI : elles demandent un vrai travail de microcopie, de hierarchie visuelle et d'etats d'erreur/confirmation.

| Story | Titre | Epic | Effort | Couches | UX front | Soin UX | Point UX critique | Handoff UX | Dependances |
| ----- | ----- | ---- | ------ | ------- | -------- | ------- | ----------------- | ---------- | ----------- |
| V3-015 | Rôle `director` et seuils d'approbation | [V3-E04](../v3/V3-E04-role-direction-permissions.md) | M | DB Back Front | Oui | Eleve | Statuts et raisons de declenchement lisibles en langage metier | — | V3 takeoff baseline |
| V3-016 | Valider sans éditer / retour correction | [V3-E04](../v3/V3-E04-role-direction-permissions.md) | M | Back Front | Oui | Eleve | Actions de validation claires sans exposer l'editeur complet | — | V3-015 |
| V3-017 | Journal de décision d'approbation | [V3-E04](../v3/V3-E04-role-direction-permissions.md) | S | DB Back Front | Oui | Moyen | Timeline d'audit lisible sans bruit | — | V3-015 |
| V3-018 | Soumettre à validation depuis le hub | [V3-E05](../v3/V3-E05-workflow-approbation-affaire.md) | M | Back Front | Oui | Eleve | Synthese pre-envoi avec distinction nette blocants / alertes | — | V3-015, V3-016 |
| V3-020 | Retour correction et resoumission guidée | [V3-E05](../v3/V3-E05-workflow-approbation-affaire.md) | M | Back Front | Oui | Eleve | Checklist de correction directement actionnable | — | V3-018, V3-019 |
| V3-024 | Publication sécurisée d'une version client | [V3-E07](../v3/V3-E07-portail-client-lite.md) | M | Back Front | Oui | Eleve | Parcours de partage rassurant, publication et revocation explicites | [HANDOFF](./V3-E07-FS-A-HANDOFF.md) | V3-018 |
| V3-025 | Questions client contextualisées | [V3-E07](../v3/V3-E07-portail-client-lite.md) | M | Back Front | Oui | Eleve | Thread contextualise version / lot / ligne sans ambiguite | [HANDOFF](./V3-E07-FS-A-HANDOFF.md) | V3-024 |
| EST-371 | Ingestion dossier multi-documents et classement IA | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) | L | Back AI Front Storage | Oui | Eleve | Dropzone, correction du classement et gestion des ambiguïtés | [HANDOFF](./EST-E21-FS-A-HANDOFF.md) | stockage affaire/plans/documents |
| EST-372 | Brief affaire généré automatiquement | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) | M | Back AI Front | Oui | Eleve | Brief editable, sourcé et compréhensible en un coup d'oeil | [HANDOFF](./EST-E21-FS-A-HANDOFF.md) | EST-371 |
| EST-373 | Registre d'hypothèses et pièces manquantes | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) | M | DB Back Front | Oui | Moyen | Registre exploitable sans noyer l'utilisateur dans les exceptions | — | EST-371 |
| EST-381 | Génération d'ouvrages depuis texte libre / CCTP | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) | L | AI Back Front | Oui | Eleve | Review avant insertion avec provenance et niveau de confiance lisibles | [HANDOFF](./EST-381-FS-A-HANDOFF.md) | EST-372 |
| EST-404 | Journal des corrections et apprentissage équipe | [EST-E24](../EST-E24-collaboration-revue-exception.md) | M | DB Back AI | Oui | Moyen | Ecran de synthese utile pour capitaliser sans exposer une UX analytique brute | — | EST-401, EST-402 |
| EST-412 | Analyse d'impact quantités / prix / marge | [EST-E25](../EST-E25-revision-engine-boucle-client.md) | L | Back Front AI | Oui | Eleve | Impact priorise et lisible pour lancer une V2 sans relecture exhaustive | [HANDOFF](./EST-412-FS-A-HANDOFF.md) | EST-411, EST-391 |
| EST-414 | Questions client -> tâches -> décisions | [EST-E25](../EST-E25-revision-engine-boucle-client.md) | M | Back Front | Oui | Moyen | Conversion d'un retour client en action interne sans perte de contexte | — | V3-025, EST-411 |

### Equipe B — Fullstack IA / moteurs preuve-prix-risque

> Cette equipe construit des moteurs techniques, mais aussi des surfaces experts directement visibles. Les ecrans ou panneaux ci-dessous demandent une UX de confiance : provenance, certitude, choix explicites et jamais d'automatisme opaque.

| Story | Titre | Epic | Effort | Couches | UX front | Soin UX | Point UX critique | Handoff UX | Dependances |
| ----- | ----- | ---- | ------ | ------- | -------- | ------- | ----------------- | ---------- | ----------- |
| V3-010 | Comparaison DPGF vs Takeoff preuve-centrique | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | L | Back Front AI | Oui | Tres eleve | Matching, preuves, filtres et decisions de revue sans confusion | [HANDOFF](./EST-E23-FS-B-HANDOFF.md) | V3-E03 baseline |
| EST-382 | Génération structure lots / chapitres | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) | L | AI Back Front | Oui | Eleve | Preview de structure, fusion et gestion des doublons | — | EST-371, EST-372 |
| EST-383 | Suggestions de sous-détail et ouvrages composés | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) | L | AI Back Front | Oui | Eleve | Edition fine du sous-detail avant validation | — | EST-381, EST-382 |
| EST-384 | Brouillon complet `dossier -> V0` | [EST-E22](../EST-E22-draft-assiste-ouvrages.md) | XL | AI Back Front DB | Oui | Tres eleve | Revue V0 avec provenance, confiance et manques visibles ligne par ligne | [HANDOFF](./EST-384-FS-B-HANDOFF.md) | EST-372, EST-381, EST-382 |
| EST-391 | Evidence Graph par ligne | [EST-E23](../EST-E23-preuve-prix-risque.md) | L | DB Back Front | Oui | Eleve | Panneau preuves consultable vite sans perdre le contexte editeur | [HANDOFF](./EST-E23-FS-B-HANDOFF.md) | V3-010 |
| EST-392 | Suggestion de prix avec fourchette et sources | [EST-E23](../EST-E23-preuve-prix-risque.md) | L | AI Back Front | Oui | Eleve | Fourchette, sources et choix d'application doivent etre immediatement compréhensibles | [HANDOFF](./EST-E23-FS-B-HANDOFF.md) | EST-391 |
| EST-393 | Radar d'incohérences et marge à risque | [EST-E23](../EST-E23-preuve-prix-risque.md) | M | Back Front AI | Oui | Eleve | Priorisation des risques et niveau de criticite sans effet "sapin de Noel" | — | V3-010, EST-391 |
| EST-394 | Explication des prix et des deltas | [EST-E23](../EST-E23-preuve-prix-risque.md) | M | AI Back Front | Oui | Moyen | Difference claire entre faits, hypotheses et inférences | — | EST-392 |
| EST-411 | Lecture des retours client et détection des changements | [EST-E25](../EST-E25-revision-engine-boucle-client.md) | L | AI Back Front | Oui | Eleve | Synthese des changements corrigeable avant toute action V2 | [HANDOFF](./EST-E25-FS-B-HANDOFF.md) | V3-024, V3-025 |
| EST-413 | Réponse assistée et contre-proposition structurée | [EST-E25](../EST-E25-revision-engine-boucle-client.md) | M | AI Back Front | Oui | Moyen | Brouillon de reponse utile, editable et rattache a sa base factuelle | [HANDOFF](./EST-E25-FS-B-HANDOFF.md) | EST-411, EST-412 |

### Regles UX pour les equipes fullstack

- Toute proposition IA doit afficher sa **provenance**, son **niveau de confiance** et un **choix explicite** avant insertion ou validation.
- Les statuts doivent etre rediges en **langage metier** et jamais exposes comme des etats techniques internes.
- Les vues de review doivent separer clairement ce qui est **bloquant**, **a confirmer** et **simplement informatif**.
- Toute story fullstack avec `UX front = Oui` doit etre relue avec le prisme `Marie / Laurent / Nadia`, pas seulement au niveau contrat API.

### Equipe C — Frontend cockpit / review / collaboration

| Story | Titre | Epic | Effort | Couches | Dependances |
| ----- | ----- | ---- | ------ | ------- | ----------- |
| V3-005 | Card plans, preuves & exceptions | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | M | Back Front | V3-E02 baseline |
| V3-007 | Activity Center Mètres | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | L | Back Front | V3-005 |
| V3-009 | Action rapide `Analyser les plans` | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | S | Front | V3-005 |
| V3-012 | UX `Assisté / Production / Validation` | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | M | Front | V3-007 |
| V3-013 | Plans dans flow import | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | M | Front | V3-005 |
| V3-014 | Auto-proposition de mètre | [Addendum V3](../v3/V3-UPDATE-TAKEOFF.md) | M | Back Front | V3-013 |
| V3-019 | File de revue par exception | [V3-E05](../v3/V3-E05-workflow-approbation-affaire.md) | L | Back Front | V3-018 |
| V3-021 | Dashboard portefeuille marge / risque / complétude | [V3-E06](../v3/V3-E06-dashboard-direction-risque.md) | M | Back Front | V3-015, V3-019 |
| V3-022 | File priorisée `à envoyer cette semaine` | [V3-E06](../v3/V3-E06-dashboard-direction-risque.md) | M | Back Front | V3-021 |
| V3-023 | Alertes synthétiques d'affaire à risque | [V3-E06](../v3/V3-E06-dashboard-direction-risque.md) | S | Back Front | V3-021, EST-393 |
| V3-026 | Acceptation simple ou demande de nouvelle version | [V3-E07](../v3/V3-E07-portail-client-lite.md) | M | Back Front | V3-024, V3-025 |
| EST-374 | Command bar contextuelle du cockpit | [EST-E21](../EST-E21-ai-intake-brief-affaire.md) | M | Front Back AI | EST-371, EST-372 |
| EST-401 | Présence, lecture partagée et commentaires temps réel | [EST-E24](../EST-E24-collaboration-revue-exception.md) | M | Front Back Realtime | V3-019 |
| EST-402 | File de revue par exception assignable | [EST-E24](../EST-E24-collaboration-revue-exception.md) | M | Back Front | V3-019, EST-401 |
| EST-403 | Revue multi-rôle et checklists par profil | [EST-E24](../EST-E24-collaboration-revue-exception.md) | M | Back Front | EST-402 |

### Contrats d'implementation front equipe C

| Domaine frontend | Stories couvertes | Contrat frontend | Contrats backend / handoff a consommer |
| ---------------- | ----------------- | ---------------- | -------------------------------------- |
| Cockpit takeoff | V3-005, V3-007, V3-009, V3-012, V3-013, V3-014 | [V3-TAKEOFF-COCKPIT-FE-CONTRACT](./V3-TAKEOFF-COCKPIT-FE-CONTRACT.md) | backend V3 takeoff existant + [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md) |
| Approbation / direction | V3-019, V3-021, V3-022, V3-023 | [V3-APPROVAL-DIRECTION-FE-CONTRACT](./V3-APPROVAL-DIRECTION-FE-CONTRACT.md) | sorties equipe A + [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md) |
| Portail client decision | V3-026 | [V3-E07-FE-CONTRACT](./V3-E07-FE-CONTRACT.md) | [V3-E07-FS-A-HANDOFF](./V3-E07-FS-A-HANDOFF.md) |
| Collaboration cockpit | EST-374, EST-401, EST-402, EST-403 | [EST-E24-FE-CONTRACT](./EST-E24-FE-CONTRACT.md) | [EST-E21-FS-A-HANDOFF](./EST-E21-FS-A-HANDOFF.md) + [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md) |

---

## Phase 7 — M7

### Vague 7.1 — Gouvernance V3 + cockpit assisté

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | V3-015 (M) + V3-017 (S) | 3 | Rôle `director`, règles d'approbation et journal d'audit |
| **B** | V3-010 (L) | 3 | Base preuve-centrique du compare DPGF / takeoff |
| **C** | V3-005 (M) + V3-009 (S) | 3 | Card hub et CTA métier dans le cockpit affaire |

### Vague 7.2 — Intake dossier + evidence foundation

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | V3-016 (M) + EST-371 (L) | 5 | Valider sans éditer + ingestion multi-documents |
| **B** | EST-391 (L) + EST-393 (M) | 5 | Graphe de preuves et premier radar de risque |
| **C** | V3-007 (L) + V3-012 (M) | 5 | Activity Center Mètres et mode de review Assisté / Production / Validation |

### Vague 7.3 — Soumission, brief et structure assistée

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | V3-018 (M) + EST-372 (M) | 4 | Soumission à validation + brief affaire généré |
| **B** | EST-382 (L) + EST-392 (L) | 6 | Structure auto des lots + fourchettes de prix expliquées |
| **C** | V3-013 (M) + V3-014 (M) + V3-019 (L) | 7 | Intake plans dans l'import, auto-proposition de mètre et file d'approbation par exception |

### Vague 7.4 — Dossier cadré + dashboard direction

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | EST-373 (M) + EST-381 (L) | 5 | Registre hypothèses / pièces manquantes + ouvrages depuis texte |
| **B** | EST-394 (M) | 2 | Explications prix / delta sur base preuve + pricing |
| **C** | V3-021 (M) + V3-022 (M) + V3-023 (S) | 5 | Dashboard portefeuille, file hebdo et alertes synthétiques |

### Vague 7.5 — Collaboration et correction outillée

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | V3-020 (M) + EST-404 (M) | 4 | Retour correction guidé + journal des corrections équipe |
| **B** | EST-383 (L) | 3 | Suggestions de sous-détail et ouvrages composés |
| **C** | EST-374 (M) + EST-401 (M) + EST-402 (M) | 6 | Command bar cockpit, présence/commentaires, assignation des exceptions |

### Tests obligatoires phase 7

- `[UT]`
  - règles d'approbation, scoring risque, mapping preuves, synthèses IA
  - classement documentaire, génération brief, provenance des ouvrages
  - reducers review / exceptions / checklist / collaboration
- `[E2E]`
  - `dossier entrant -> brief -> hypothèses -> hub affaire`
  - `plans -> mètre -> preuves -> comparaison -> validation`
  - `soumission -> file d'approbation -> retour correction -> resoumission`
  - `command bar -> revue par exception -> assignation`
- `Gate P7`
  - un dossier brut peut devenir une affaire pilotable sans re-saisie manuelle
  - chaque ligne à risque expose au moins une preuve, un statut ou une explication
  - la revue par exception est exploitable par un profil direction sans passer par l'éditeur expert
- `Outillage UI / parcours`
  - les equipes peuvent utiliser le skill [`agent-browser`](../../../.agents/skills/agent-browser/SKILL.md) pour tester les parcours UI, les etats de review et capturer des screenshots de validation
  - workflow recommande : `open -> snapshot -i -> interact -> re-snapshot`, puis `wait --load networkidle` et `diff snapshot` si un changement doit etre verifie
  - utiliser des sessions nommees par flux ou par equipe, puis fermer la session en fin de test pour eviter les collisions

---

## Phase 8 — M8

### Vague 8.1 — Portail client + V0 assistée

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | V3-024 (M) + V3-025 (M) | 4 | Publication sécurisée et questions client contextualisées |
| **B** | EST-384 (XL) + EST-411 (L) | 8 | Brouillon V0 complet + lecture des retours client |
| **C** | EST-403 (M) + V3-026 (M) | 4 | Checklists multi-rôle + réponse client simple côté portail |

### Vague 8.2 — Revision engine et réponse assistée

| Equipe | Stories | Points | Description |
| ------ | ------- | ------ | ----------- |
| **A** | EST-412 (L) + EST-414 (M) | 5 | Analyse d'impact et conversion questions -> tâches / V2 |
| **B** | EST-413 (M) | 2 | Brouillon de réponse / contre-proposition structurée |
| **C** | Buffer QA / polish / intégration client loop | 0 | Stabilisation UX, accessibilité et QA cross-flows |

### Tests obligatoires phase 8

- `[UT]`
  - diff de retours client, calcul d'impact, carry-over des zones non touchées
  - classification des décisions client et mapping vers tâches / exceptions / hypothèses
- `[E2E]`
  - `publication version -> question client -> création tâche -> V2`
  - `retour client mail/portail -> détection changement -> analyse d'impact -> draft réponse`
  - `V0 assistée -> revue -> validation -> publication`
- `Gate P8`
  - une demande client V2 peut être absorbée sans repartir d'un devis vide
  - l'historique client/interne reste traçable du premier partage à la décision finale
- `Outillage UI / parcours`
  - le skill [`agent-browser`](../../../.agents/skills/agent-browser/SKILL.md) peut etre utilise pour rejouer `publication -> portail -> retour client -> V2`, verifier les messages d'etat et prendre des captures avant merge
  - privilegier `snapshot -i`, les waits explicites et `diff snapshot` pour confirmer qu'une action modifie bien l'ecran attendu
  - pour les flux sensibles, garder une session dediee par scenario (`portal`, `review`, `client-loop`) afin d'isoler les essais

---

## Chemins critiques

### Workflow validation

```text
V3-015 -> V3-016 -> V3-018 -> V3-019 -> V3-020
```

### Intake vers brouillon assisté

```text
EST-371 -> EST-372 -> EST-381 / EST-382 -> EST-384
```

### Preuve / prix / risque

```text
V3-010 -> EST-391 -> EST-392 -> EST-394
               └-> EST-393
```

### Boucle client / révision

```text
V3-024 -> V3-025 -> EST-411 -> EST-412 -> EST-413
                       └-----------------> EST-414
```

---

## Coordination inter-equipes

| Moment | Handoff | Impact |
| ------ | ------- | ------ |
| Fin 7.1 | B livre les contrats `preuves / compare`, C branche les vues cockpit V3 | débloque EST-391 et les écrans direction |
| Fin 7.2 | A livre ingestion dossier, C branche les entrées cockpit et import | débloque brief, command bar et génération assistée |
| Fin 7.3 | C livre la file d'approbation, A branche soumission / resoumission | débloque correction guidée et dashboards |
| Fin 7.5 | C livre la couche collaboration, A active l'historique des corrections | débloque apprentissage équipe |
| Fin 8.1 | A livre le portail client, B branche lecture retours et impact | débloque EST-E25 |

## Regles de gestion

1. Pas de merge M7/M8 sans tests sur les flux `intake`, `review`, `client loop`.
2. Toute story IA doit distinguer ce qui est **certain** de ce qui est **inféré**.
3. Toute story de validation ou client loop doit écrire un historique exploitable par audit.
4. L'équipe C démarre ses surfaces sur contrat de données gelé, sans attendre la fin complète du backend.
5. Le buffer de fin M8 est réservé à la stabilisation du flux `publication -> retour client -> V2`.
6. Quand une equipe veut valider une UI ou un parcours reel, elle peut s'appuyer sur le skill [`agent-browser`](../../../.agents/skills/agent-browser/SKILL.md) plutot que sur une verification manuelle non tracee.
