"use client";

import { useState, type ComponentProps } from "react";
import { Modal } from "@/components/ui-legacy/Modal";

import { EstimateEventsTimeline } from "@/components/estimates/EstimateEventsTimeline";
import { EstimateSettingsPanel, type EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import { EstimateSuggestionRulesManager } from "@/components/estimates/EstimateSuggestionRulesManager";
import { LaborRolesManager } from "@/components/estimates/LaborRolesManager";
import { MarginTiersManager } from "@/components/estimates/MarginTiersManager";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type { EstimateVersionEvent } from "@/lib/estimates/client";
import type { Database } from "@/types/database";

type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule = Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type EstimateSettingsPanelProps = ComponentProps<typeof EstimateSettingsPanel>;
type LaborRolesManagerProps = ComponentProps<typeof LaborRolesManager>;
type MarginTiersManagerProps = ComponentProps<typeof MarginTiersManager>;
type SuggestionRulesManagerProps = ComponentProps<typeof EstimateSuggestionRulesManager>;
type AuditLogEntry = {
  id: string;
  action: string;
  table_name: string;
  record_id: string;
  created_at: string;
};

type EstimateEditorDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  hasUnsavedSettings: boolean;
  onDiscardSettings: () => void;
  onSaveBeforeClose: () => Promise<boolean>;
  projectName: string;
  versionNumber: number;
  settings: EstimateSettingsState;
  totals: EstimateTotals | null;
  isSavingSettings: boolean;
  isSaveBlocked: boolean;
  isFrozen?: boolean;
  storedMarginMultiplier?: number;
  onChangeSettings: EstimateSettingsPanelProps["onChange"];
  onSaveSettings: EstimateSettingsPanelProps["onSave"];
  laborRoles: LaborRole[];
  onCreateRole: LaborRolesManagerProps["onCreate"];
  onUpdateRole: LaborRolesManagerProps["onUpdate"];
  isSavingMarginTiers: boolean;
  marginTiersError: string | null;
  canEditMarginTiers: boolean;
  onCreateTier: MarginTiersManagerProps["onCreate"];
  onUpdateTier: MarginTiersManagerProps["onUpdate"];
  onDeleteTier: MarginTiersManagerProps["onDelete"];
  suggestionRules: SuggestionRule[];
  categories: EstimateCategory[];
  isSavingRules: boolean;
  rulesError: string | null;
  onCreateSuggestionRule: SuggestionRulesManagerProps["onCreate"];
  onUpdateSuggestionRule: SuggestionRulesManagerProps["onUpdate"];
  isAdmin: boolean;
  timelineEvents: EstimateVersionEvent[];
  isTimelineLoading: boolean;
  timelineError: string | null;
  onRefreshTimeline: () => void;
  isAuditLoading: boolean;
  auditError: string | null;
  auditLogs: AuditLogEntry[];
  onRefreshAuditLogs: () => void;
  formatAuditTimestamp: (value: string) => string;
};

export function EstimateEditorDrawer({
  isOpen,
  onClose,
  hasUnsavedSettings,
  onDiscardSettings,
  onSaveBeforeClose,
  projectName,
  versionNumber,
  settings,
  totals,
  isSavingSettings,
  isSaveBlocked,
  isFrozen = false,
  storedMarginMultiplier,
  onChangeSettings,
  onSaveSettings,
  laborRoles,
  onCreateRole,
  onUpdateRole,
  isSavingMarginTiers,
  marginTiersError,
  canEditMarginTiers,
  onCreateTier,
  onUpdateTier,
  onDeleteTier,
  suggestionRules,
  categories,
  isSavingRules,
  rulesError,
  onCreateSuggestionRule,
  onUpdateSuggestionRule,
  isAdmin,
  timelineEvents,
  isTimelineLoading,
  timelineError,
  onRefreshTimeline,
  isAuditLoading,
  auditError,
  auditLogs,
  onRefreshAuditLogs,
  formatAuditTimestamp,
}: EstimateEditorDrawerProps) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [savingBeforeClose, setSavingBeforeClose] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const requestClose = () => {
    if (isSavingSettings || savingBeforeClose) return;
    if (hasUnsavedSettings) {
      setSaveError(false);
      setConfirmClose(true);
    } else {
      onClose();
    }
  };
  const saveAndClose = async () => {
    if (savingBeforeClose || isSavingSettings) return;
    setSavingBeforeClose(true);
    setSaveError(false);
    try {
      if (await onSaveBeforeClose()) {
        setConfirmClose(false);
        onClose();
      } else {
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      setSavingBeforeClose(false);
    }
  };
  if (!isOpen) return null;

  return (
    <>
      <Modal.Root open={confirmClose} onOpenChange={(open) => {
        if (!savingBeforeClose) setConfirmClose(open);
      }}>
        <Modal.Content closeOnEscapeKey={!savingBeforeClose} closeOnOverlayClick={!savingBeforeClose} containerClassName="sm:max-w-lg">
          <Modal.Header><Modal.Title>Enregistrer les modifications du paramétrage ?</Modal.Title></Modal.Header>
          <Modal.Body>
            <p>Vos modifications ne sont pas encore enregistrées. Vous pouvez les enregistrer, les abandonner ou continuer à modifier le paramétrage.</p>
            {saveError && <p role="alert" className="text-danger">L’enregistrement n’a pas abouti. Le paramétrage reste ouvert ; vérifiez les erreurs avant de réessayer.</p>}
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-secondary btn-sm" disabled={savingBeforeClose} onClick={() => setConfirmClose(false)} data-modal-autofocus="true">Continuer à modifier</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={savingBeforeClose} onClick={() => {
              onDiscardSettings();
              setConfirmClose(false);
              onClose();
            }}>Abandonner les modifications</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={savingBeforeClose || isSaveBlocked || isSavingSettings} onClick={() => void saveAndClose()}>{savingBeforeClose ? "Enregistrement…" : "Enregistrer"}</button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={requestClose}
        aria-hidden="true"
        data-testid="estimate-editor-drawer-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paramétrage du devis"
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full lg:max-w-7xl flex-col border-l border-[var(--slate-200)] bg-surface shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !confirmClose) {
            requestClose();
          }
        }}
        tabIndex={-1}
        data-testid="estimate-editor-drawer"
      >
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-4 py-3 lg:px-6 lg:py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">Paramétrage</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={requestClose}
            aria-label="Fermer"
            data-testid="estimate-editor-drawer-close-button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6 space-y-6">
          <EstimateSettingsPanel
            projectName={projectName}
            versionNumber={versionNumber}
            settings={settings}
            totals={totals}
            isSaving={isSavingSettings}
            isReadOnly={isSaveBlocked || isSavingSettings}
            isFrozen={isFrozen}
            storedMarginMultiplier={storedMarginMultiplier}
            error={null}
            onChange={onChangeSettings}
            onSave={onSaveSettings}
          />

          <LaborRolesManager
            roles={laborRoles}
            isSaving={isSavingSettings || isSaveBlocked}
            error={null}
            onCreate={onCreateRole}
            onUpdate={onUpdateRole}
          />

          <MarginTiersManager
            tiers={(settings.margin_tiers ?? []) as MarginTierRow[]}
            isSaving={isSavingMarginTiers}
            error={marginTiersError}
            canEdit={canEditMarginTiers}
            onCreate={onCreateTier}
            onUpdate={onUpdateTier}
            onDelete={onDeleteTier}
          />

          <EstimateSuggestionRulesManager
            rules={suggestionRules}
            categories={categories}
            laborRoles={laborRoles}
            isSaving={isSavingRules || isSaveBlocked}
            error={rulesError}
            onCreate={onCreateSuggestionRule}
            onUpdate={onUpdateSuggestionRule}
          />

          {isAdmin ? (
            <>
              <EstimateEventsTimeline
                events={timelineEvents}
                isLoading={isTimelineLoading}
                error={timelineError}
                onRefresh={onRefreshTimeline}
              />
              <div className="dashboard-card p-8" data-testid="estimate-editor-drawer-audit-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--slate-800)]">Audit admin</h2>
                    <p className="text-xs text-[var(--slate-500)]">Dernieres operations journalisees sur cette version.</p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={onRefreshAuditLogs}
                    disabled={isAuditLoading}
                    data-testid="estimate-editor-drawer-refresh-audit-button"
                  >
                    {isAuditLoading ? "Chargement..." : "Actualiser"}
                  </button>
                </div>

                {auditError ? (
                  <div className="alert alert-error mt-6" data-testid="estimate-editor-drawer-audit-error">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                    {auditError}
                  </div>
                ) : null}

                <div className="table-scroll mt-6" data-testid="estimate-editor-drawer-audit-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Action</th>
                        <th>Table</th>
                        <th>Record ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="text-sm text-[var(--slate-500)]">
                              {isAuditLoading
                                ? "Chargement des logs d'audit..."
                                : "Aucun log d'audit recent pour cette version."}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{formatAuditTimestamp(log.created_at)}</td>
                            <td className="font-medium uppercase">{log.action}</td>
                            <td>
                              <span className="font-mono text-xs text-[var(--slate-600)]">
                                {log.table_name}
                              </span>
                            </td>
                            <td>
                              <span className="font-mono text-xs text-[var(--slate-600)]">
                                {log.record_id}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {isAuditLoading && auditLogs.length > 0 ? (
                  <p className="mt-3 text-sm text-[var(--slate-500)]">Actualisation des logs en cours...</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
