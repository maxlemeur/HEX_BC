"use client";

import { ChevronRight } from "lucide-react";

import { RegisterEntryForm } from "./register/RegisterEntryForm";
import { RegisterEntryList } from "./register/RegisterEntryList";
import { RegisterExportActions } from "./register/RegisterExportActions";
import { RegisterFiltersBar } from "./register/RegisterFiltersBar";
import { RegisterPagination } from "./register/RegisterPagination";
import { RegisterSubmissionBlockers } from "./register/RegisterSubmissionBlockers";
import { RegisterSummaryCards } from "./register/RegisterSummaryCards";
import { RegisterTimeline } from "./register/RegisterTimeline";
import { RegisterTransitionDialog } from "./register/RegisterTransitionDialog";
import { getRegisterBlockingCount } from "./register/registerViewModel";
import type { AffaireRegisterCardProps } from "./register/registerTypes";
import { useAffaireRegisterCardController } from "./register/useAffaireRegisterCardController";
import "./register/RegisterList.css";

export type { AffaireRegisterCardProps } from "./register/registerTypes";

const EMPTY_TIMELINE_EVENTS: NonNullable<AffaireRegisterCardProps["timelineEvents"]> = [];

export function AffaireRegisterCard({
  isReadOnly = false,
  errorMessage,
  versionId,
  timelineEvents = EMPTY_TIMELINE_EVENTS,
  ...props
}: Readonly<AffaireRegisterCardProps>) {
  const controller = useAffaireRegisterCardController({
    ...props,
    versionId,
    timelineEvents,
    isReadOnly,
    errorMessage,
  });

  if (errorMessage) {
    return (
      <section className="affaire-register">
        <h2 className="register-heading">Points à traiter</h2>
        <p className="mt-4 text-sm text-muted-foreground">{errorMessage}</p>
      </section>
    );
  }

  return (
    <section className="affaire-register" aria-label="Points à traiter"
      aria-busy={controller.isFilterPending || controller.isMutationPending}>
      <header className="register-header">
        <div>
          <h2 className="register-heading">Points à traiter</h2>
          <RegisterSummaryCards summary={controller.effectiveSummary} />
        </div>
        <RegisterExportActions projectId={props.projectId} versionId={versionId} />
      </header>
      <RegisterSubmissionBlockers summary={controller.effectiveSummary} />
      {isReadOnly ? <p className="register-readonly">Consultation uniquement</p> : null}
      <RegisterFiltersBar
        filterStatus={controller.filterStatus}
        filterSeverity={controller.filterSeverity}
        filterKind={controller.filterKind}
        filterRevalidationRequired={controller.filterRevalidationRequired}
        filterBlockingOnly={controller.filterBlockingOnly}
        blockingCount={getRegisterBlockingCount(controller.effectiveSummary)}
        hasActiveFilters={controller.hasActiveFilters}
        onApplyFilters={controller.applyFilters}
        onResetFilters={controller.resetFilters}
      />
      <div className="sr-only" aria-live="polite">
        {controller.isFilterPending ? "Mise à jour des filtres…" : controller.items.length + " résultats"}
      </div>
      {controller.isLoading ? (
        <p className="register-empty" aria-live="polite">Chargement du registre…</p>
      ) : (
        <RegisterEntryList
          key={controller.registerPage?.filters.focusEntryId ?? "register"}
          items={controller.items}
          hasActiveFilters={controller.hasActiveFilters}
          isReadOnly={isReadOnly}
          isMutationPending={controller.isMutationPending}
          pendingEntryId={controller.pendingEntryId}
          focusedEntryId={controller.registerPage?.filters.focusEntryId}
          onOpenTransitionDialog={controller.openTransitionDialog}
        />
      )}
      {!isReadOnly ? (
        <RegisterEntryForm
          form={controller.form}
          activeScopeOptions={controller.activeScopeOptions}
          versionId={versionId}
          isMutationPending={controller.isMutationPending}
          isExpanded={controller.isFormExpanded}
          canCreateEntry={controller.canCreateEntry}
          formHint={controller.formHint}
          formReadinessMessage={controller.formReadinessMessage}
          scopeHelpMessage={controller.scopeHelpMessage}
          onToggleExpanded={controller.setIsFormExpanded}
          onUpdateForm={controller.updateForm}
          onScopeTypeChange={controller.handleScopeTypeChange}
          onCreateEntry={() => void controller.handleCreateEntry()}
        />
      ) : null}
      {controller.inlineFeedback ? (
        <p className="register-feedback" role="status">{controller.inlineFeedback.message}</p>
      ) : null}
      {controller.registerPage?.filters.cursor || controller.registerPage?.nextCursor ? (
        <RegisterPagination
          cursor={controller.registerPage.filters.cursor}
          nextCursor={controller.registerPage.nextCursor}
          isFilterPending={controller.isFilterPending}
          onApplyCursor={(cursor) => controller.applyFilters({ cursor })}
        />
      ) : null}
      {timelineEvents.length > 0 ? (
        <details className="register-history">
          <summary><ChevronRight size={16} aria-hidden="true" />Historique récent du registre</summary>
          <RegisterTimeline timelineEvents={timelineEvents} />
        </details>
      ) : null}
      <RegisterTransitionDialog
        pendingTransition={controller.pendingTransition}
        transitionComment={controller.transitionComment}
        revalidationForm={controller.revalidationForm}
        isMutationPending={controller.isMutationPending}
        isConfirmDisabled={controller.isTransitionConfirmDisabled}
        onClose={controller.closeTransitionDialog}
        onConfirm={() => void controller.handleConfirmTransition()}
        onChangeComment={controller.setTransitionComment}
        onChangeRevalidationCause={controller.setRevalidationCause}
        onToggleRevalidationStage={controller.toggleRevalidationStage}
        onChangeRevalidationTriggerFileName={controller.setRevalidationTriggerFileName}
      />
    </section>
  );
}
