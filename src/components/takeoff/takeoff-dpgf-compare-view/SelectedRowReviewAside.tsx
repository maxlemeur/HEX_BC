"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type {
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfReviewDecision,
  TakeoffRiskAlert,
} from "@/lib/takeoff/types";

import {
  DECISION_LABELS,
  DECISION_VARIANT,
  PROOF_KIND_LABELS,
  PROOF_TYPE_BORDER,
  PROOF_TYPE_LABELS,
  RISK_SEVERITY_LABELS,
  RISK_SEVERITY_VARIANT,
  RISK_STATUS_LABELS,
  RISK_STATUS_VARIANT,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  type ProofKind,
} from "@/components/takeoff/takeoff-dpgf-compare-view/constants";
import {
  formatConfidence,
  formatProofConfidence,
  getDecisionImpactText,
} from "@/components/takeoff/takeoff-dpgf-compare-view/utils";

type RiskActionTarget = {
  alertId: string;
  status: "assumed" | "false_positive";
  causeLabel: string;
  scopeLabel: string;
};

function ProofList({
  label,
  proofs,
}: {
  label: string;
  proofs: TakeoffDpgfComparisonProof[];
}) {
  if (proofs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-4">
        <p className="text-sm font-medium text-[var(--slate-800)]">{label}</p>
        <p className="mt-2 text-sm text-[var(--slate-600)]">Aucun élément.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">{label}</p>
      {proofs.map((proof) => (
        <article
          key={proof.proof_id}
          className={`rounded-2xl border border-[var(--border)] border-l-4 ${PROOF_TYPE_BORDER[proof.type]} bg-white p-4 shadow-sm`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--slate-900)]">{proof.label}</p>
            <Badge variant="neutral" size="sm">
              {PROOF_TYPE_LABELS[proof.type]}
            </Badge>
            {proof.type === "plan_zone" && proof.source ? (
              <Badge variant="info" size="sm">
                {proof.source}
              </Badge>
            ) : null}
            {proof.type === "formula" ? (
              <Badge variant="warning" size="sm">
                Agrégation
              </Badge>
            ) : null}
          </div>
          {proof.type !== "plan_zone" ? (
            <p className="mt-2 text-xs text-[var(--slate-600)]">Source : {proof.source}</p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {formatProofConfidence(proof.confidence_score)}
          </p>
          {proof.note ? (
            proof.type === "comment" ? (
              <blockquote className="mt-2 border-l-2 border-emerald-300 pl-3 text-sm italic leading-6 text-[var(--slate-700)]">
                {proof.note}
              </blockquote>
            ) : (
              <p className="mt-2 text-sm leading-6 text-[var(--slate-700)]">{proof.note}</p>
            )
          ) : null}
        </article>
      ))}
    </section>
  );
}

function DecisionPill({
  active,
  decision,
  onClick,
}: {
  active: boolean;
  decision: TakeoffDpgfReviewDecision;
  onClick: (decision: TakeoffDpgfReviewDecision) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "primary" : DECISION_VARIANT[decision]}
      className={!active ? "justify-start" : undefined}
      onClick={() => onClick(decision)}
    >
      {DECISION_LABELS[decision]}
    </Button>
  );
}

type SelectedRowReviewAsideProps = {
  selectedRow: TakeoffDpgfComparisonRow | null;
  selectedLineRiskItems: TakeoffRiskAlert[];
  proofGroups: Record<ProofKind, TakeoffDpgfComparisonProof[]>;
  draftDecision: TakeoffDpgfReviewDecision | null;
  decisionReason: string;
  decisionSaving: boolean;
  onDecisionSelect: (decision: TakeoffDpgfReviewDecision) => void;
  onDecisionReasonChange: (value: string) => void;
  onDecisionSave: () => void;
  onOpenManualLinkModal: () => void;
  onOpenEvidencePanel: () => void;
  onOpenPriceSuggestionPanel: () => void;
  onRiskAction: (target: RiskActionTarget) => void;
};

export function SelectedRowReviewAside({
  selectedRow,
  selectedLineRiskItems,
  proofGroups,
  draftDecision,
  decisionReason,
  decisionSaving,
  onDecisionSelect,
  onDecisionReasonChange,
  onDecisionSave,
  onOpenManualLinkModal,
  onOpenEvidencePanel,
  onOpenPriceSuggestionPanel,
  onRiskAction,
}: Readonly<SelectedRowReviewAsideProps>) {
  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      {!selectedRow ? (
        <div className="rounded-[28px] border border-[var(--border)] bg-white p-6 shadow-sm">
          <p className="text-sm text-[var(--slate-600)]">
            Sélectionnez une ligne pour afficher les preuves, hypothèses et décisions.
          </p>
        </div>
      ) : (
        <div className="space-y-5 rounded-[28px] border border-[var(--border)] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                Revue détaillée
              </p>
              <h3 className="mt-2 text-xl font-semibold text-[var(--slate-950)]">
                {selectedRow.line_label}
              </h3>
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                Position {selectedRow.dpgf.position}
                {selectedRow.dpgf.source_file_name ? ` · ${selectedRow.dpgf.source_file_name}` : ""}
                {selectedRow.dpgf.source_page ? ` · ligne ${selectedRow.dpgf.source_page}` : ""}
              </p>
            </div>
            <Badge variant={STATUS_BADGE_VARIANT[selectedRow.review_status]}>
              {STATUS_LABELS[selectedRow.review_status]}
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                Matching
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--slate-950)]">
                {Math.round(selectedRow.matching_score * 100)}%
              </p>
              <p className="mt-1 text-xs text-[var(--slate-600)]">
                Mode: {selectedRow.matched_by ?? "aucun"}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                Suggestion IA
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                {selectedRow.suggested_decision
                  ? DECISION_LABELS[selectedRow.suggested_decision]
                  : "Aucune suggestion"}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-600)]">
                Confiance globale {formatConfidence(selectedRow.confidence_score)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Radar ligne
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                  {selectedRow.risk
                    ? `${RISK_SEVERITY_LABELS[selectedRow.risk.severity]} · ${selectedRow.risk.score}/100`
                    : "Aucun signal specifique sur cette ligne"}
                </p>
                <p className="mt-1 text-xs text-[var(--slate-600)]">
                  {selectedRow.risk?.causes.length
                    ? selectedRow.risk.causes.join(" · ")
                    : "Le radar complet reste visible dans la file A traiter."}
                </p>
              </div>
              {selectedRow.risk?.status ? (
                <Badge variant={RISK_STATUS_VARIANT[selectedRow.risk.status]}>
                  {RISK_STATUS_LABELS[selectedRow.risk.status]}
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {selectedLineRiskItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--slate-600)]">
                  Aucun signal de risque persistant sur cette ligne.
                </div>
              ) : (
                selectedLineRiskItems.map((item) => (
                  <article
                    key={item.alert_id}
                    className="rounded-2xl border border-[var(--border)] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={RISK_SEVERITY_VARIANT[item.severity]} size="sm">
                            {RISK_SEVERITY_LABELS[item.severity]}
                          </Badge>
                          <Badge variant={RISK_STATUS_VARIANT[item.status]} size="sm">
                            {RISK_STATUS_LABELS[item.status]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                          {item.cause_label}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-[var(--slate-900)]">
                        {item.risk_score}/100
                      </p>
                    </div>

                    {item.reason_labels.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.reason_labels.map((reason) => (
                          <Badge key={reason} variant="neutral" size="sm">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {item.provenance.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {item.provenance.map((entry) => (
                          <div
                            key={[
                              item.alert_id,
                              entry.kind,
                              entry.label,
                              entry.source,
                              entry.note ?? "",
                            ].join("-")}
                            className="rounded-xl border border-[var(--border)] bg-[var(--slate-50)] px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="neutral" size="sm">
                                {PROOF_KIND_LABELS[entry.kind]}
                              </Badge>
                              <p className="text-xs font-semibold text-[var(--slate-900)]">
                                {entry.label}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-[var(--slate-600)]">
                              {entry.source}
                              {entry.confidence_score !== null
                                ? ` · ${formatProofConfidence(entry.confidence_score)}`
                                : ""}
                            </p>
                            {entry.note ? (
                              <p className="mt-1 text-xs leading-5 text-[var(--slate-600)]">
                                {entry.note}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {item.review_note ? (
                      <p className="mt-3 text-xs leading-5 text-[var(--slate-600)]">
                        Note humaine : {item.review_note}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          onRiskAction({
                            alertId: item.alert_id,
                            status: "assumed",
                            causeLabel: item.cause_label,
                            scopeLabel: item.scope_label,
                          })
                        }
                      >
                        Assumer
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onRiskAction({
                            alertId: item.alert_id,
                            status: "false_positive",
                            causeLabel: item.cause_label,
                            scopeLabel: item.scope_label,
                          })
                        }
                      >
                        Faux positif
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Décision humaine appliquée
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                  {selectedRow.applied_decision
                    ? DECISION_LABELS[selectedRow.applied_decision.decision]
                    : "Aucune décision appliquée"}
                </p>
              </div>
              {selectedRow.applied_decision ? (
                <Badge
                  variant={selectedRow.applied_decision.source === "carried_over" ? "warning" : "info"}
                >
                  {selectedRow.applied_decision.source === "carried_over"
                    ? `Reprise v${selectedRow.applied_decision.carried_over_from_version_number ?? "?"}`
                    : "Version courante"}
                </Badge>
              ) : null}
            </div>
            {selectedRow.applied_decision?.reason ? (
              <p className="mt-3 text-sm leading-6 text-[var(--slate-700)]">
                {selectedRow.applied_decision.reason}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[var(--slate-950)]">
                  Traçabilité persistée
                </p>
                <p className="mt-1 text-xs text-[var(--slate-600)]">
                  Provenance détaillée, historique et remplacements de preuves.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onOpenPriceSuggestionPanel}
                  data-testid="takeoff-dpgf-open-price-suggestion-button"
                >
                  Suggestion de prix
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onOpenEvidencePanel}
                  data-testid="takeoff-dpgf-open-evidence-panel-button"
                >
                  Historique et provenance
                </Button>
              </div>
            </div>
            <ProofList label={PROOF_KIND_LABELS.fact} proofs={proofGroups.fact} />
            <ProofList label={PROOF_KIND_LABELS.hypothesis} proofs={proofGroups.hypothesis} />
            <ProofList label={PROOF_KIND_LABELS.inference} proofs={proofGroups.inference} />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Arbitrage humain
                </p>
                <p className="mt-2 text-sm text-[var(--slate-600)]">
                  Sélection explicite obligatoire avant application.
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={onOpenManualLinkModal}>
                Recomposer les liens
              </Button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {(Object.keys(DECISION_LABELS) as TakeoffDpgfReviewDecision[]).map((decision) => (
                <DecisionPill
                  key={decision}
                  active={draftDecision === decision}
                  decision={decision}
                  onClick={onDecisionSelect}
                />
              ))}
            </div>

            {draftDecision ? (
              <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {getDecisionImpactText(draftDecision, selectedRow)}
              </p>
            ) : null}

            <div className="mt-4">
              <label className="form-label" htmlFor="dpgf-review-reason">
                Justification humaine
              </label>
              <textarea
                id="dpgf-review-reason"
                name="dpgf_review_reason"
                autoComplete="off"
                className="form-input min-h-[120px] py-3"
                value={decisionReason}
                placeholder="Distinguer les faits observés, les hypothèses retenues et les corrections manuelles à faire…"
                onChange={(event) => onDecisionReasonChange(event.target.value)}
                maxLength={2000}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--slate-500)]">
                Provenance visible, confiance explicite, aucune application silencieuse.
              </p>
              <Button type="button" size="sm" loading={decisionSaving} onClick={onDecisionSave}>
                Enregistrer la décision
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
