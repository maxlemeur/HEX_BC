"use client";

import { RegisterEntryForm } from "./register/RegisterEntryForm";
import { RegisterEntryList } from "./register/RegisterEntryList";
import { RegisterExportActions } from "./register/RegisterExportActions";
import { RegisterFiltersBar } from "./register/RegisterFiltersBar";
import { RegisterPagination } from "./register/RegisterPagination";
import { RegisterSubmissionBlockers } from "./register/RegisterSubmissionBlockers";
import { RegisterSummaryCards } from "./register/RegisterSummaryCards";
import { RegisterTimeline } from "./register/RegisterTimeline";
import { RegisterTransitionDialog } from "./register/RegisterTransitionDialog";
import type { AffaireRegisterCardProps } from "./register/registerTypes";
import { useAffaireRegisterCardController } from "./register/useAffaireRegisterCardController";

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
      <section className="dashboard-card p-5">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Registre hypothèses & pièces manquantes
        </h2>
        <div className="mt-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      </section>
    );
  }

  return (
    <section
      className="dashboard-card p-5"
      aria-busy={controller.isFilterPending || controller.isMutationPending}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Registre hypothèses & pièces manquantes
          </h2>
          <p className="mt-0.5 text-xs text-[var(--slate-500)]">
            Hypothèses & pièces manquantes du dossier.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RegisterExportActions
            projectId={props.projectId}
            versionId={versionId}
          />
          {controller.hasActiveFilters ? (
            <div className="rounded-full bg-[var(--brand-blue)]/10 px-2.5 py-1 text-xs text-[var(--brand-blue)]">
              Vue filtrée
              {controller.activeFiltersLabel ? ` · ${controller.activeFiltersLabel}` : ""}
            </div>
          ) : null}
          {controller.isFilterPending ? (
            <div
              className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs text-[var(--slate-600)]"
              aria-live="polite"
            >
              Mise à jour des filtres…
            </div>
          ) : null}
          {isReadOnly ? (
            <div className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs text-[var(--slate-600)]">
              Consultation uniquement
            </div>
          ) : null}
        </div>
      </div>

      <RegisterSummaryCards
        itemCount={controller.items.length}
        summary={controller.effectiveSummary}
        onApplyFilters={controller.applyFilters}
      />

      <RegisterSubmissionBlockers
        items={controller.items}
        summary={controller.effectiveSummary}
        onApplyFilters={controller.applyFilters}
      />

      <div className="mt-3 flex items-center justify-end">
        <div className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs text-[var(--slate-600)]">
          {controller.items.length} résultat{controller.items.length > 1 ? "s" : ""}
        </div>
      </div>

      {controller.isLoading ? (
        <div
          className="mt-4 rounded-2xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/80 px-4 py-8 text-center"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-[var(--slate-700)]">
            Chargement du registre…
          </p>
          <p className="mt-2 text-sm text-[var(--slate-500)]">
            Récupération des points ouverts, avec historique récent et filtres disponibles.
          </p>
        </div>
      ) : null}

      {(controller.effectiveSummary.openQuestionsCount > 0 ||
        controller.items.length > 0 ||
        controller.hasActiveFilters) && (
        <RegisterFiltersBar
          filterStatus={controller.filterStatus}
          filterSeverity={controller.filterSeverity}
          filterKind={controller.filterKind}
          hasActiveFilters={controller.hasActiveFilters}
          onApplyFilters={controller.applyFilters}
          onResetFilters={controller.resetFilters}
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
        <div
          className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
            controller.inlineFeedback.tone === "success"
              ? "border-[var(--success)]/20 bg-[var(--success)]/5 text-[var(--slate-700)]"
              : "border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 text-[var(--slate-700)]"
          }`}
          aria-live="polite"
        >
          {controller.inlineFeedback.message}
        </div>
      ) : null}

      <RegisterEntryList
        items={controller.items}
        hasActiveFilters={controller.hasActiveFilters}
        isReadOnly={isReadOnly}
        isMutationPending={controller.isMutationPending}
        pendingEntryId={controller.pendingEntryId}
        onOpenTransitionDialog={controller.openTransitionDialog}
      />

      <RegisterTimeline timelineEvents={timelineEvents} />

      <RegisterPagination
        cursor={controller.registerPage?.filters.cursor ?? null}
        nextCursor={controller.registerPage?.nextCursor ?? null}
        isFilterPending={controller.isFilterPending}
        onApplyCursor={(cursor) => controller.applyFilters({ cursor })}
      />

      <RegisterTransitionDialog
        pendingTransition={controller.pendingTransition}
        transitionComment={controller.transitionComment}
        isMutationPending={controller.isMutationPending}
        onClose={controller.closeTransitionDialog}
        onConfirm={() => void controller.handleConfirmTransition()}
        onChangeComment={controller.setTransitionComment}
      />
    </section>
  );
}
