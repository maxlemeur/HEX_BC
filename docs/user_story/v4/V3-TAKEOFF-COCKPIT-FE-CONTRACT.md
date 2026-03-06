# V3 Addendum -> Equipe C Frontend Implementation Contract

## Scope equipe C

Ce contrat couvre les stories frontend du cockpit takeoff :

- `V3-005` card plans, preuves & exceptions
- `V3-007` activity center metres
- `V3-009` action rapide `Analyser les plans`
- `V3-012` modes `Assiste / Production / Validation`
- `V3-013` plans dans flow import
- `V3-014` auto-proposition de metre

## Consommation amont

- backend V3 takeoff existant (`plan_sets`, `takeoff_jobs`, pages affaire-centriques)
- signaux preuves/risques quand disponibles :
  - [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md)

## Surfaces frontend a construire

### 1) Hub affaire

Fichiers cibles :

- `src/components/affaires/PlansProofsExceptionsCard.tsx`
- `src/components/affaires/TakeoffQuickAction.tsx`

Comportements attendus :

- resume metier visible en une phrase
- CTA differencies :
  - `Voir les plans`
  - `Voir les exceptions`
  - `Analyser les plans`
- etats explicites :
  - aucun plan
  - analyse en cours
  - analyse echouee
  - analyse a verifier

### 2) Activity Center Metres

Fichiers cibles :

- `src/app/dashboard/affaires/[projectId]/takeoff/page.tsx`
- `src/components/takeoff/TakeoffActivityCenter.tsx`
- `src/components/takeoff/TakeoffJobsTable.tsx`
- `src/components/takeoff/TakeoffExceptionsTab.tsx`
- `src/components/takeoff/TakeoffApplicationHistoryTab.tsx`

Comportements attendus :

- 3 tabs : `Jobs`, `Exceptions`, `Historique d'application`
- filtres : version, lot, set de plans
- vue exploitable par Nadia sans lecture technique

### 3) Import enrichi et auto-proposition

Fichiers cibles :

- `src/components/import/PlanIntakeStep.tsx`
- `src/components/takeoff/TakeoffLaunchPrompt.tsx`

Comportements attendus :

- etape plans clairement optionnelle mais recommandee
- auto-proposition non bloquante
- choix :
  - lancer maintenant
  - plus tard
  - ne plus proposer sur cette affaire

### 4) Mode de review

Fichiers cibles :

- `src/components/takeoff/review/TakeoffReviewModeSwitch.tsx`
- `src/components/takeoff/review/AssistedReviewPanel.tsx`
- `src/components/takeoff/review/ValidationReviewPanel.tsx`

Comportements attendus :

- `Assiste` :
  - cartes
  - langage metier
  - decisions simples
- `Production` :
  - table dense
  - raccourcis
  - edition rapide
- `Validation` :
  - exceptions
  - trous de couverture
  - hypotheses ouvertes

## Contrat de donnees attendu

Le frontend equipe C attend au minimum les surfaces suivantes :

```ts
fetchAffaireHubPlansSummary(projectId: string): Promise<{
  planSetCount: number;
  planFileCount: number;
  latestJob: {
    jobId: string;
    status: "running" | "done" | "failed" | "review_required";
    label: string;
  } | null;
  coveragePercent: number;
  exceptionCount: number;
  openQuestionsCount: number;
  failureReasonLabel: string | null;
}>;

fetchTakeoffActivityCenter(projectId: string, filters: {
  versionId?: string | null;
  lot?: string | null;
  planSetId?: string | null;
}): Promise<{
  counters: {
    technicalJobs: number;
    usableJobs: number;
    blockingExceptionsJobs: number;
  };
  jobs: Array<{
    jobId: string;
    versionLabel: string;
    lotLabel: string | null;
    planSetLabel: string | null;
    levelLabel: "Rapide" | "Standard" | "Detaille";
    statusLabel: string;
    itemCount: number;
    coveragePercent: number;
    exceptionCount: number;
    confidenceLabel: "Elevee" | "Moyenne" | "Faible";
    appliedCount: number;
    createdAt: string;
    carriedOverFrom: string | null;
  }>;
}>;

launchTakeoffAnalysis(input: {
  projectId: string;
  versionId: string;
  planSetId: string;
  level: "rapid" | "standard" | "detailed";
}): Promise<{
  jobId: string;
  nextRecommendedAction: string;
}>;
```

## Regles UX obligatoires

- Toujours afficher des libelles metier, jamais `job failed`, `level A`, `confidence 0.62`.
- L'etat vide sans plans doit rester pedagogique et actionnable.
- La card hub doit etre lisible sur mobile sans tableau.
- Les tabs du centre d'activite ne doivent pas noyer les exceptions sous les jobs.
- Le switch de mode de review ne doit jamais faire perdre l'etat local de revue.

## QA checklist frontend

- la card hub reste comprehensible en moins de 10 secondes
- un utilisateur peut lancer une analyse sans connaitre le jargon technique
- la vue `Validation` fonctionne sans exposition de controles experts inutiles
- le flow import + plans + auto-proposition reste viable sur tablette
