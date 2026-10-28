import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEstimateV3Settings, type UseEstimateV3SettingsInput } from "@/hooks/useEstimateV3Settings";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

afterEach(cleanup);

function input() {
  const data = createEstimateEditorResponseFixture();
  return { version: data.version, items: data.items, laborRoles: [], laborSplitEnabled: false } satisfies UseEstimateV3SettingsInput;
}

describe("v3 settings editing", () => {
  it("keeps invalid text visible and blocks payloads without turning the last valid coefficient into zero", () => {
    const { result } = renderHook(() => useEstimateV3Settings(input()));
    act(() => result.current!.setText("sale_coefficient_fo", ""));
    expect(result.current!.texts.sale_coefficient_fo).toBe("");
    expect(result.current!.draft!.sale_coefficient_fo).toBe(1.3);
    expect(result.current!.hasErrors).toBe(false);
    expect(result.current!.isDirty).toBe(true);
    let payload: ReturnType<NonNullable<typeof result.current>["buildSavePayload"]>;
    act(() => { payload = result.current!.buildSavePayload(); });
    expect(payload!).toMatchObject({ ok: false, reason: "field_errors" });
    expect(result.current!.hasErrors).toBe(true);
  });

  it("preserves a local draft and invalid text while moving its confirmed baseline", () => {
    const initial = input();
    const { result, rerender } = renderHook((props) => useEstimateV3Settings(props), { initialProps: initial });
    act(() => {
      result.current!.updateDraft({ title: "Titre local" });
      result.current!.applyInput("sale_coefficient_fo", "incorrect");
    });
    rerender({ ...initial, version: { ...initial.version!, title: "Titre confirmé", sale_coefficient_fo: 1.5 } });
    expect(result.current!.saved!.title).toBe("Titre confirmé");
    expect(result.current!.saved!.sale_coefficient_fo).toBe(1.5);
    expect(result.current!.draft!.title).toBe("Titre local");
    expect(result.current!.draft!.sale_coefficient_fo).toBe(1.3);
    expect(result.current!.texts.sale_coefficient_fo).toBe("incorrect");
    act(() => result.current!.reset());
    expect(result.current!.draft).toEqual(result.current!.saved);
    expect(result.current!.texts.sale_coefficient_fo).toBe("1,50");
    expect(result.current!.hasErrors).toBe(false);
    expect(result.current!.isDirty).toBe(false);
  });

  it("keeps the user's text when only the version revision changes", () => {
    const initial = input();
    const { result, rerender } = renderHook((props) => useEstimateV3Settings(props), { initialProps: initial });
    act(() => result.current!.applyInput("sale_coefficient_fo", ""));
    rerender({ ...initial, version: { ...initial.version!, updated_at: "2026-10-28T10:00:00.123457Z" } });
    expect(result.current!.texts.sale_coefficient_fo).toBe("");
    expect(result.current!.hasErrors).toBe(true);
  });

  it("waits for VAT propagation and resumes the waiting save once with its answer", async () => {
    const { result } = renderHook(() => useEstimateV3Settings(input()));
    act(() => result.current!.applyInput("tax_rate", "10"));
    const onAsk = vi.fn();
    let answer!: Promise<boolean>;
    act(() => { answer = result.current!.askTaxPropagation(onAsk); });
    expect(onAsk).toHaveBeenCalledOnce();
    expect(result.current!.taxPropagation).toEqual({ rateBp: 1000, lineCount: 1 });
    const duplicateSave = vi.fn();
    act(() => result.current!.confirmTaxPropagation(true, duplicateSave));
    await expect(answer).resolves.toBe(true);
    expect(duplicateSave).not.toHaveBeenCalled();
    expect(result.current!.buildSavePayload()).toMatchObject({ ok: true, payload: { tax_rate_bp: 1000, apply_tax_rate_to_lines: true } });
  });

  it("cancels a pending VAT decision without saving", async () => {
    const { result } = renderHook(() => useEstimateV3Settings(input()));
    act(() => result.current!.applyInput("tax_rate", "10"));
    let answer!: Promise<boolean>;
    act(() => { answer = result.current!.askTaxPropagation(); });
    act(() => result.current!.cancelTaxPropagation());
    await expect(answer).resolves.toBe(false);
    expect(result.current!.taxPropagation).toBeNull();
    expect(result.current!.buildSavePayload()).toMatchObject({ ok: false, reason: "tax_propagation_required" });
  });

  it("resets the document draft and visual input when another version opens", () => {
    const initial = input();
    const { result, rerender } = renderHook((props) => useEstimateV3Settings(props), { initialProps: initial });
    act(() => result.current!.applyInput("sale_coefficient_fo", ""));
    rerender({ ...initial, version: { ...initial.version!, id: "another-version", sale_coefficient_fo: 1.7 } });
    expect(result.current!.draft!.sale_coefficient_fo).toBe(1.7);
    expect(result.current!.hasErrors).toBe(false);
    expect(result.current!.isDirty).toBe(false);
  });
});

describe("v3 settings owned by the editor document", () => {
  function connected() {
    const initial = input();
    const document = new EstimateEditorDocument({
      actorId: "actor-1", tenantId: initial.version.tenant_id, versionId: initial.version.id,
    });
    document.setConfirmedVersion(initial.version);
    const view = renderHook(() => useEstimateV3Settings({
      ...initial, document, version: document.getSnapshot().version,
    }));
    return { ...view, document, initial };
  }

  it("uses the document draft directly and reacts to external confirmation without maintaining a local copy", () => {
    const { result, document, initial } = connected();
    act(() => result.current!.updateDraft({ title: "Titre local" }));
    expect(result.current!.draft).toBe(document.getV3Settings().draft);
    expect(document.getV3Settings().draft!.title).toBe("Titre local");
    act(() => document.setConfirmedVersion({ ...initial.version, title: "Titre confirmé", sale_coefficient_fo: 1.5 }));
    expect(result.current!.saved).toBe(document.getV3Settings().saved);
    expect(result.current!.saved!.sale_coefficient_fo).toBe(1.5);
    expect(result.current!.draft!.title).toBe("Titre local");
    act(() => document.discardSettings());
    expect(result.current!.draft!.title).toBe("Titre confirmé");
    expect(result.current!.isDirty).toBe(false);
  });

  it("keeps invalid text through a line receipt that only advances the confirmed revision", () => {
    const { result, document, initial } = connected();
    act(() => result.current!.applyInput("sale_coefficient_fo", ""));
    const before = document.getV3Settings();
    act(() => document.setConfirmedVersion({ ...initial.version, updated_at: "2026-10-28T10:00:00.123457Z" }));
    expect(document.getV3Settings()).toBe(before);
    expect(result.current!.texts.sale_coefficient_fo).toBe("");
    expect(result.current!.hasErrors).toBe(true);
    expect(result.current!.draft!.sale_coefficient_fo).toBe(1.3);
  });

  it("keeps a pending VAT question through a line receipt and builds one payload from its answer", async () => {
    const { result, document, initial } = connected();
    act(() => result.current!.applyInput("tax_rate", "10"));
    let answer!: Promise<boolean>;
    act(() => { answer = result.current!.askTaxPropagation(); });
    act(() => document.setConfirmedVersion({ ...initial.version, updated_at: "2026-10-28T10:00:00.123457Z" }));
    expect(document.getV3Settings().taxPropagation).toEqual({ rateBp: 1000, lineCount: 1 });
    act(() => result.current!.confirmTaxPropagation(false, vi.fn()));
    await expect(answer).resolves.toBe(true);
    expect(result.current!.buildSavePayload()).toMatchObject({ ok: true, payload: { tax_rate_bp: 1000 } });
    const payload = result.current!.buildSavePayload();
    expect(payload.ok && payload.payload).not.toHaveProperty("apply_tax_rate_to_lines");
  });

  it("rejects callbacks captured by another actor even when the version id is unchanged", () => {
    const { result, document, initial } = connected();
    const oldEdit = result.current!.updateDraft;
    const oldRequestSave = result.current!.requestSave;
    act(() => {
      document.changeScope({ actorId: "actor-2", tenantId: initial.version.tenant_id, versionId: initial.version.id });
      document.setConfirmedVersion(initial.version);
    });
    act(() => oldEdit({ title: "Saisie de l’ancien acteur" }));
    expect(document.getV3Settings().draft!.title).toBe(initial.version.title);
    const save = vi.fn();
    expect(oldRequestSave(save)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    act(() => result.current!.updateDraft({ title: "Saisie actuelle" }));
    expect(document.getV3Settings().draft!.title).toBe("Saisie actuelle");
  });

  it("releases a save waiting for VAT confirmation when the document identity changes", async () => {
    const { result, document, initial } = connected();
    act(() => result.current!.applyInput("tax_rate", "10"));
    let answer!: Promise<boolean>;
    act(() => { answer = result.current!.askTaxPropagation(); });
    const staleConfirm = result.current!.confirmTaxPropagation;
    act(() => {
      document.changeScope({ actorId: "actor-2", tenantId: initial.version.tenant_id, versionId: initial.version.id });
      document.setConfirmedVersion(initial.version);
    });
    await expect(answer).resolves.toBe(false);
    const save = vi.fn();
    act(() => staleConfirm(true, save));
    expect(save).not.toHaveBeenCalled();
    expect(result.current!.taxPropagation).toBeNull();
    expect(result.current!.draft!.tax_rate_bp).toBe(2000);
  });

  it("resets to the latest document confirmation even before React has rerendered", () => {
    const { result, document, initial } = connected();
    act(() => result.current!.updateDraft({ title: "Titre local" }));
    act(() => {
      document.setConfirmedVersion({ ...initial.version, title: "Dernière confirmation" });
      result.current!.reset();
    });
    expect(document.getV3Settings().draft!.title).toBe("Dernière confirmation");
    expect(result.current!.isDirty).toBe(false);
  });
});
