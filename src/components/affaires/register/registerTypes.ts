import type {
  AffaireRegisterEntry,
  AffaireRegisterEntryKind,
  AffaireRegisterRevalidationCause,
  AffaireRegisterRevalidationImpactedStage,
  AffaireRegisterEntrySeverity,
  AffaireRegisterEntryStatus,
  AffaireRegisterPageResult,
  AffaireRegisterScopeOptions,
  AffaireRegisterSummary,
  AffaireRegisterTimelineEvent,
} from "@/lib/affaires/register";

export type AffaireRegisterCardProps = {
  projectId: string;
  versionId: string | null;
  registerPage: AffaireRegisterPageResult | null;
  scopeOptions: AffaireRegisterScopeOptions;
  summary?: AffaireRegisterSummary | null;
  timelineEvents?: AffaireRegisterTimelineEvent[];
  isReadOnly?: boolean;
  errorMessage?: string;
};

export type RegisterScopeType = "project" | "lot" | "line" | "exception";

export type RegisterEntryFormState = {
  kind: AffaireRegisterEntryKind;
  severity: AffaireRegisterEntrySeverity;
  text: string;
  scopeType: RegisterScopeType;
  scopeId: string;
  scopeRef: string;
  scopeLabel: string;
  sourceFileName: string;
};

export type RegisterRevalidationFormState = {
  cause: AffaireRegisterRevalidationCause;
  impactedStages: AffaireRegisterRevalidationImpactedStage[];
  triggerFileName: string;
};

export type PendingTransition =
  | {
      kind: "status";
      entry: AffaireRegisterEntry;
      nextStatus: AffaireRegisterEntryStatus;
    }
  | {
      kind: "continue_with_hypothesis";
      entry: AffaireRegisterEntry;
    }
  | {
      kind: "request_revalidation";
      entry: AffaireRegisterEntry;
    };
