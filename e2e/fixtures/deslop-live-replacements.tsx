import { useState } from "react";
import { createRoot } from "react-dom/client";

import {
  AssemblyEditorDialog,
  type AssemblyEditorInput,
} from "../../src/components/estimates/AssemblyEditorDialog";
import { AssistedReviewPanel } from "../../src/components/takeoff/review/AssistedReviewPanel";
import type { ReviewItem } from "../../src/components/takeoff/TakeoffReviewPage";
import { ToastProvider } from "../../src/components/ui-legacy/Toast";

async function captureEvent(event: unknown) {
  const response = await fetch("/fixture-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error("Capture locale impossible.");
}

function AssemblyFixture() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save(input: AssemblyEditorInput) {
    setSaving(true);
    try {
      await captureEvent({ action: "assembly-submit", input });
      setOpen(false);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sauvegarde échouée.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Ouvrage — fixture locale</h1>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Créer un ouvrage
      </button>
      {saved && <p role="status">Ouvrage enregistré localement</p>}
      {error && <p role="alert">{error}</p>}
      {open && (
        <AssemblyEditorDialog
          isSubmitting={saving}
          laborRoles={[]}
          supplyTypes={[]}
          onClose={() => setOpen(false)}
          onSubmit={save}
        />
      )}
    </main>
  );
}

function makeItem(id: string, designation: string, excluded = false): ReviewItem {
  return {
    id,
    designation,
    quantity: 2,
    unit: "u",
    confidence: 0.9,
    evidence: "Plan synthétique, page 1",
    source_file_name: "fixture-deslop.pdf",
    source_page: 1,
    metadata: {},
    is_excluded: excluded,
    exclusion_reason: excluded ? "Exclusion de fixture" : null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-10-02T08:00:00.000Z",
    updated_at: "2026-10-02T08:00:00.000Z",
    _dirty: false,
    _saving: false,
    _error: null,
  };
}

function ReviewFixture() {
  const [items, setItems] = useState<ReviewItem[]>([
    makeItem("11111111-1111-4111-8111-111111111111", "Tube PVC"),
    makeItem("22222222-2222-4222-8222-222222222222", "Vis", true),
    makeItem("33333333-3333-4333-8333-333333333333", "Coude"),
  ]);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState("");

  // The production panel owns the review actions. This fixture supplies the
  // parent state and acknowledges callbacks through a loopback capture server.
  async function setInclusion(ids: string[], excluded: boolean) {
    try {
      await captureEvent({ action: excluded ? "exclude" : "include", ids });
      setItems((previous) => previous.map((item) => ids.includes(item.id)
        ? { ...item, is_excluded: excluded, exclusion_reason: excluded ? "Écarté" : null }
        : item));
      if (excluded) {
        setReviewedIds((previous) => new Set([...previous, ...ids]));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action échouée.");
    }
  }

  async function apply() {
    try {
      await captureEvent({
        action: "apply-click",
        reviewedIds: [...reviewedIds],
        markedIds: [...markedIds],
        excludedIds: items.filter((item) => item.is_excluded).map((item) => item.id),
      });
      setApplied(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Application échouée.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Revue assistée — fixture locale</h1>
      <AssistedReviewPanel
        items={items}
        reviewedIds={reviewedIds}
        markedForReviewIds={markedIds}
        onReviewedIdsChange={setReviewedIds}
        onMarkedForReviewIdsChange={setMarkedIds}
        onExcludeItems={(ids) => { void setInclusion(ids, true); }}
        onIncludeItems={(ids) => { void setInclusion(ids, false); }}
        onApplyClick={() => { void apply(); }}
        isApplyReady
      />
      {applied && <p role="status">Application demandée localement</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

const scenario = new URLSearchParams(window.location.search).get("scenario");
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    {scenario === "assembly" ? <AssemblyFixture /> : <ReviewFixture />}
  </ToastProvider>,
);
