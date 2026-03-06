# V3 Approbation / Direction -> Equipe C Frontend Implementation Contract

## Scope equipe C

Ce contrat couvre :

- `V3-019` file de revue par exception
- `V3-021` dashboard portefeuille marge / risque / completude
- `V3-022` file priorisee `a envoyer cette semaine`
- `V3-023` alertes synthetiques d'affaire a risque

## Consommation amont

- donnees d'approbation et permissions fournies par equipe A
- signaux de risque fournis par :
  - [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md)
- comptes de test de revue / direction :
  - [docs/test-logins.md](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/test-logins.md)

Si le backend n'est pas encore fige, ce document sert de contrat a stabiliser avant demarrage FE.

## Surfaces frontend a construire

### 1) File `Approbations`

Fichiers cibles :

- `src/app/dashboard/approvals/page.tsx`
- `src/components/approvals/ApprovalQueue.tsx`
- `src/components/approvals/ApprovalQueueCard.tsx`
- `src/components/approvals/ApprovalFilters.tsx`

### 2) Dashboard direction

Fichiers cibles :

- `src/app/dashboard/direction/page.tsx`
- `src/components/direction/RiskPortfolioDashboard.tsx`
- `src/components/direction/WeeklySendPriorityQueue.tsx`
- `src/components/direction/RiskAlertBanner.tsx`

## Contrat de donnees attendu

```ts
fetchApprovalQueue(filters: {
  sortBy?: "priority" | "amount" | "margin" | "age";
  onlyExceptions?: boolean;
}): Promise<Array<{
  projectId: string;
  versionId: string;
  projectName: string;
  versionLabel: string;
  amountHtCents: number;
  marginBp: number | null;
  riskScore: number;
  exceptionCount: number;
  requestAgeLabel: string;
  exceptionGroups: Array<{
    key: "price" | "quantities" | "vat_conformity" | "missing_proofs" | "missing_documents";
    count: number;
  }>;
  visualState: "new" | "seen" | "commented" | "resolved";
}>>;

fetchDirectionRiskDashboard(filters: {
  agencyId?: string | null;
  ownerUserId?: string | null;
  lot?: string | null;
  horizon?: "this_week" | "this_month";
}): Promise<{
  cards: Array<{
    projectId: string;
    projectName: string;
    amountHtCents: number;
    marginBp: number | null;
    riskScore: number;
    coveragePercent: number;
    openHypothesesCount: number;
    approvalStatus: "not_required" | "required" | "in_review" | "approved" | "changes_requested";
    sendTargetAt: string | null;
  }>;
  alerts: Array<{
    alertId: string;
    level: "info" | "warning" | "critical";
    label: string;
    reasons: string[];
    status: "assumed" | "to_process" | "false_positive";
  }>;
}>;
```

Mutations attendues :

```ts
markApprovalItemState(input: {
  projectId: string;
  state: "seen" | "review_laurent" | "blocking" | "acceptable";
}): Promise<{ ok: true }>;

assignWeeklyReviewOwner(input: {
  projectId: string;
  ownerUserId: string;
}): Promise<{ ok: true }>;
```

## Regles UX obligatoires

- Le tri et les filtres doivent rester visibles sans monopoliser l'ecran.
- Les cartes doivent exposer 3 niveaux de lecture :
  - scan rapide
  - details de risque
  - entree cockpit
- Les alertes synthetiques ne doivent pas multiplier les pastilles sans contexte.
- Le dashboard doit fonctionner pour Nadia sans connaissance de l'editeur.

## QA checklist frontend

- l'utilisateur identifie les 3 affaires prioritaires en moins de 30 secondes
- un clic depuis une carte ouvre la bonne vue de validation
- les alertes ont toujours une raison lisible
- le mode `Exceptions seulement` ne casse pas la comprehension globale
- utiliser le compte `director` documente dans [docs/test-logins.md](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/test-logins.md) pour les parcours de revue direction
