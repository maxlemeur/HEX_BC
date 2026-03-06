# EST-E24 -> Equipe C Frontend Implementation Contract

## Scope equipe C

Ce contrat couvre :

- `EST-374` command bar contextuelle du cockpit
- `EST-401` presence, lecture partagee et commentaires temps reel
- `EST-402` file de revue par exception assignable
- `EST-403` revue multi-role et checklists par profil

## Consommation amont

- [EST-E21-FS-A-HANDOFF](./EST-E21-FS-A-HANDOFF.md)
- [EST-E23-FS-B-HANDOFF](./EST-E23-FS-B-HANDOFF.md)

Les contrats backend specifiques a E24 doivent etre geles sur cette base avant implementation FE.

## Surfaces frontend a construire

### 1) Command bar cockpit

Fichiers cibles :

- `src/components/cockpit/CockpitCommandBar.tsx`
- `src/components/cockpit/CockpitCommandPreview.tsx`

### 2) Presence et commentaires

Fichiers cibles :

- `src/components/collaboration/PresenceAvatars.tsx`
- `src/components/collaboration/CommentThreadPanel.tsx`
- `src/components/collaboration/MentionsInbox.tsx`

### 3) File d'exceptions assignable

Fichiers cibles :

- `src/components/exceptions/MyExceptionsView.tsx`
- `src/components/exceptions/TeamExceptionsView.tsx`
- `src/components/exceptions/ExceptionAssignmentSheet.tsx`

### 4) Checklists multi-role

Fichiers cibles :

- `src/components/review/RoleChecklist.tsx`
- `src/components/review/ChecklistProgress.tsx`

## Contrat de donnees attendu

```ts
fetchCockpitCommandBar(projectId: string): Promise<{
  suggestions: Array<{
    actionId: string;
    label: string;
    intent: "analyze_plans" | "generate_structure" | "view_exceptions" | "list_hypotheses" | "prepare_validation";
    preview: string;
    destructive: boolean;
  }>;
}>;

fetchCollaborationState(projectId: string): Promise<{
  presence: Array<{
    userId: string;
    displayName: string;
    roleLabel: string;
    activeScopeLabel: string | null;
  }>;
  threads: Array<{
    threadId: string;
    scopeType: "project" | "lot" | "line" | "proof" | "exception";
    scopeLabel: string;
    status: "open" | "resolved" | "reopened";
    mentionCount: number;
    lastMessageAt: string;
  }>;
}>;

fetchAssignableExceptions(projectId: string): Promise<{
  unassigned: Array<{
    exceptionId: string;
    label: string;
    severity: "info" | "warning" | "critical";
  }>;
  mine: Array<{
    exceptionId: string;
    label: string;
    dueAt: string | null;
    status: "open" | "resolved" | "awaiting_validation";
  }>;
  team: Array<{
    exceptionId: string;
    label: string;
    ownerName: string | null;
    dueAt: string | null;
    status: "open" | "resolved" | "awaiting_validation";
  }>;
}>;

fetchRoleChecklist(projectId: string, role: "junior" | "senior" | "director"): Promise<{
  progressPercent: number;
  points: Array<{
    pointId: string;
    label: string;
    category: "completeness" | "pricing" | "proofs" | "risk" | "compliance";
    status: "compliant" | "to_review" | "not_applicable";
  }>;
}>;
```

## Regles UX obligatoires

- La command bar doit rester metier, pas technique.
- Les commentaires temps reel ne doivent pas noyer le cockpit principal.
- L'assignation d'exceptions doit etre faisable en 2 interactions maximum.
- Les checklists par profil doivent retirer du bruit, pas ajouter un deuxieme outil.

## QA checklist frontend

- la command bar s'ouvre au clavier et au clic
- l'utilisateur voit qui est actif sur l'affaire
- les vues `Mes exceptions` et `Exceptions de l'equipe` restent complementaires
- le pourcentage de revue evolue avec les points checklist
