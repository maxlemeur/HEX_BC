"use client";

import { useRef, useState, type ComponentProps } from "react";

import { EstimateEventsTimeline } from "@/components/estimates/EstimateEventsTimeline";
import { EstimateMutationRecoveryAlert, type EstimateMutationRecovery } from "@/components/estimates/editor/EstimateMutationRecoveryAlert";
import { EstimateSettingsPanel, type EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import { EstimateSuggestionRulesManager } from "@/components/estimates/EstimateSuggestionRulesManager";
import { LaborRolesManager } from "@/components/estimates/LaborRolesManager";
import { MarginTiersManager } from "@/components/estimates/MarginTiersManager";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type { EstimateVersionEvent } from "@/lib/estimates/client";
import type { Database } from "@/types/database";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { XIcon } from "lucide-react";

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
  recovery?: EstimateMutationRecovery;
  isFrozen?: boolean;
  storedMarginMultiplier?: number;
  onChangeSettings: EstimateSettingsPanelProps["onChange"];
  onSaveSettings: EstimateSettingsPanelProps["onSave"];
  /** Lot 2, sous-lot 2.6 : réglages d'une v3 (`useEstimateV3Settings`), nuls en v1/v2. */
  v3Settings?: EstimateSettingsPanelProps["v3"];
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
  recovery,
  isFrozen = false,
  storedMarginMultiplier,
  onChangeSettings,
  onSaveSettings,
  v3Settings = null,
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
  const continueEditingRef = useRef<HTMLButtonElement>(null);
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
      <Dialog
        open={confirmClose}
        onOpenChange={(open) => {
          if (!savingBeforeClose) setConfirmClose(open);
        }}
        disablePointerDismissal={savingBeforeClose}
      >
        <DialogContent size="md" showCloseButton={false} initialFocus={continueEditingRef}>
          <DialogHeader>
            <DialogTitle>Enregistrer les modifications du paramétrage ?</DialogTitle>
            <DialogDescription>
              Vos modifications ne sont pas encore enregistrées. Vous pouvez les enregistrer, les abandonner ou continuer à modifier le paramétrage.
            </DialogDescription>
          </DialogHeader>
          {saveError && (
            <Alert variant="danger">
              L’enregistrement n’a pas abouti. Le paramétrage reste ouvert ; vérifiez les erreurs avant de réessayer.
            </Alert>
          )}
          <DialogFooter>
            <Button ref={continueEditingRef} type="button" variant="outline" size="md" disabled={savingBeforeClose} onClick={() => setConfirmClose(false)}>
              Continuer à modifier
            </Button>
            <Button type="button" variant="outline" size="md" disabled={savingBeforeClose} onClick={() => {
              onDiscardSettings();
              setConfirmClose(false);
              onClose();
            }}>
              Abandonner les modifications
            </Button>
            <Button type="button" variant="primary" size="md" disabled={savingBeforeClose || isSaveBlocked || isSavingSettings} onClick={() => void saveAndClose()}>
              {savingBeforeClose ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div
        className="fixed inset-0 z-40 bg-[rgb(2_6_23/0.2)]"
        onClick={requestClose}
        aria-hidden="true"
        data-testid="estimate-editor-drawer-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paramétrage du devis"
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full lg:max-w-7xl flex-col border-l border-border bg-surface shadow-xl"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || confirmClose) return;
          // Escape pressed in a dialog opened from the drawer (portalled, but
          // bubbling through the React tree) closes that dialog only.
          const nearestDialog =
            event.target instanceof Element
              ? event.target.closest('[role="dialog"], [role="alertdialog"]')
              : null;
          if (nearestDialog && nearestDialog !== event.currentTarget) return;
          requestClose();
        }}
        tabIndex={-1}
        data-testid="estimate-editor-drawer"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 lg:px-6 lg:py-4">
          <h2 className="text-sm font-semibold text-foreground">Paramétrage</h2>
          <IconButton
            type="button"
            size="icon"
            label="Fermer"
            tooltipSide="left"
            icon={<XIcon aria-hidden="true" />}
            onClick={requestClose}
            data-testid="estimate-editor-drawer-close-button"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6 space-y-6">
          {recovery ? <EstimateMutationRecoveryAlert recovery={recovery} /> : null}
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
            v3={v3Settings}
          />

          <LaborRolesManager
            roles={laborRoles}
            canManage={!isSaveBlocked && !isFrozen}
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
              <Card className="p-5 sm:p-8" data-testid="estimate-editor-drawer-audit-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Audit admin</h2>
                    <p className="text-xs text-muted-foreground">Dernières opérations journalisées sur cette version.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={onRefreshAuditLogs}
                    disabled={isAuditLoading}
                    data-testid="estimate-editor-drawer-refresh-audit-button"
                  >
                    {isAuditLoading ? "Chargement…" : "Actualiser"}
                  </Button>
                </div>

                {auditError ? (
                  <Alert variant="danger" className="mt-6" data-testid="estimate-editor-drawer-audit-error">
                    {auditError}
                  </Alert>
                ) : null}

                <div
                  className="table-scroll mt-6"
                  role="region"
                  aria-label="Journal d’audit de la version"
                  tabIndex={0}
                  data-testid="estimate-editor-drawer-audit-table"
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Action</th>
                        <th scope="col">Table</th>
                        <th scope="col">Identifiant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="text-sm text-muted-foreground">
                              {isAuditLoading
                                ? "Chargement du journal d’audit…"
                                : "Aucune opération journalisée récemment pour cette version."}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{formatAuditTimestamp(log.created_at)}</td>
                            <td className="font-medium uppercase">{log.action}</td>
                            <td>
                              <span className="font-mono text-xs text-muted-foreground">
                                {log.table_name}
                              </span>
                            </td>
                            <td>
                              <span className="font-mono text-xs text-muted-foreground">
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
                  <p className="mt-3 text-sm text-muted-foreground" role="status">Actualisation du journal en cours…</p>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
