import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { router, toast } = vi.hoisted(() => ({ router: { push: vi.fn() }, toast: { success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => toast }));
vi.mock("@/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false, value: null }) }));
vi.mock("@/lib/estimates/client-locks", () => ({ releaseEstimateDraftLock: vi.fn() }));
vi.mock("@/lib/takeoff/apply-draft-lock", () => ({ ensureTakeoffApplyDraftLock: vi.fn() }));
vi.mock("@/lib/takeoff/client", () => ({ applyTakeoffJob: vi.fn(), isTakeoffApiError: () => false }));

import {
  TAKEOFF_APPLY_SENT_TITLE,
  takeoffApplySentDescription,
  useTakeoffApplyConfirm,
} from "@/components/takeoff/review/useTakeoffReviewSupport";
import type { TakeoffApplyWizardSubmitPayload } from "@/components/takeoff/TakeoffApplyWizard";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { applyTakeoffJob } from "@/lib/takeoff/client";
import type { TakeoffApplyResponse } from "@/lib/takeoff/types";

// After the takeoff is sent, the review navigates to the estimate editor in the same document. The draft lease of a
// page is scoped by version, user and page identity (draft-lock-session-client.ts), and a client-side navigation keeps
// the identity: the editor's acquisition adopts the lease still held, and a release landing after it would delete the
// editor's lease. Written before the fix, which released fire-and-forget after `onApplied` (the navigation) had run.

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const PAYLOAD: TakeoffApplyWizardSubmitPayload = { targetSectionId: SECTION_ID, targetSectionLabel: "Section A", strategy: "append",
  pageDecisions: [] };
const RESPONSE = { job: { id: JOB_ID, status: "applied" }, summary: { scope: "section", created_count: 1, updated_count: 0,
  ignored_count: 0, created_ids: ["33333333-3333-4333-8333-333333333333"], item_links: [] } } as unknown as TakeoffApplyResponse;

const LANDING = `/dashboard/estimates/${VERSION_ID}/edit?focusItemId=33333333-3333-4333-8333-333333333333`;
const SENT_TOAST = { title: TAKEOFF_APPLY_SENT_TITLE, description: "1 ligne créée, 0 mise à jour, 0 ignorée." };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("useTakeoffApplyConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyTakeoffJob).mockResolvedValue(RESPONSE);
  });

  it("gives back the lease it took before the review navigates away", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
    const release = deferred<{ released: boolean }>();
    vi.mocked(releaseEstimateDraftLock).mockReturnValue(release.promise);
    const onApplied = vi.fn();
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    let confirmed: Promise<void> = Promise.resolve();
    act(() => { confirmed = result.current.confirm(PAYLOAD); });
    await vi.waitFor(() => expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID));
    expect(onApplied).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    await act(async () => { release.resolve({ released: true }); await confirmed; });
    expect(onApplied).toHaveBeenCalledWith(RESPONSE, PAYLOAD);
    expect(toast.success).toHaveBeenCalledWith(SENT_TOAST);
    expect(router.push).toHaveBeenCalledWith(LANDING);
    expect(result.current.submitting).toBe(false);
  });

  it("still lands when the release fails: the editor adopts the lease of its own page identity", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
    vi.mocked(releaseEstimateDraftLock).mockRejectedValue(new Error("network"));
    const onApplied = vi.fn();
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    await act(() => result.current.confirm(PAYLOAD));
    expect(onApplied).toHaveBeenCalledWith(RESPONSE, PAYLOAD);
    expect(result.current.error).toBeNull();
  });

  it("keeps a lease it did not take (an editor of this page holds it)", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: false, errorMessage: null });
    const onApplied = vi.fn();
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    await act(() => result.current.confirm(PAYLOAD));
    expect(releaseEstimateDraftLock).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("sends the mapping rules' own plan: no overrides, the strategy and the page decisions as chosen", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: false, errorMessage: null });
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied: vi.fn() }));

    await act(() => result.current.confirm({ ...PAYLOAD, strategy: "merge" }));
    expect(applyTakeoffJob).toHaveBeenCalledTimes(1);
    const [jobId, request, versionId] = vi.mocked(applyTakeoffJob).mock.calls[0];
    expect([jobId, versionId]).toEqual([JOB_ID, VERSION_ID]);
    expect(request).toMatchObject({ strategy: "merge", target_section_id: SECTION_ID, page_decisions: [] });
    expect(request).not.toHaveProperty("overrides");
  });

  // The independent review (2026-11-18): Back, or a link of the guard panel, can leave the review while the application
  // or the release is pending; the hook then called the old `onApplied`, which pushed the estimator to the editor from
  // whatever screen they had reached. Written before the fix.
  it("gives the lease back but never lands once the review is left during the application", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
    const application = deferred<TakeoffApplyResponse>();
    vi.mocked(applyTakeoffJob).mockReturnValue(application.promise);
    const release = deferred<{ released: boolean }>();
    vi.mocked(releaseEstimateDraftLock).mockReturnValue(release.promise);
    const onApplied = vi.fn();
    const { result, unmount } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    let confirmed: Promise<void> = Promise.resolve();
    act(() => { confirmed = result.current.confirm(PAYLOAD); });
    await vi.waitFor(() => expect(applyTakeoffJob).toHaveBeenCalledTimes(1));
    unmount();
    application.resolve(RESPONSE);
    await vi.waitFor(() => expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID));
    release.resolve({ released: true });
    await confirmed;
    expect(onApplied).not.toHaveBeenCalled();
    // The sending did happen: it is said (the toast outlives the review), without moving the estimator.
    expect(toast.success).toHaveBeenCalledWith(SENT_TOAST);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("never lands once the review is left during the release", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
    const release = deferred<{ released: boolean }>();
    vi.mocked(releaseEstimateDraftLock).mockReturnValue(release.promise);
    const onApplied = vi.fn();
    const { result, unmount } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    let confirmed: Promise<void> = Promise.resolve();
    act(() => { confirmed = result.current.confirm(PAYLOAD); });
    await vi.waitFor(() => expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID));
    unmount();
    release.resolve({ released: true });
    await confirmed;
    expect(onApplied).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("never lands from a call another job superseded", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: false, errorMessage: null });
    const application = deferred<TakeoffApplyResponse>();
    vi.mocked(applyTakeoffJob).mockReturnValue(application.promise);
    const onApplied = vi.fn();
    const { result, rerender } = renderHook(({ jobId }) => useTakeoffApplyConfirm({ jobId, versionId: VERSION_ID, onApplied }),
      { initialProps: { jobId: JOB_ID } });

    let confirmed: Promise<void> = Promise.resolve();
    act(() => { confirmed = result.current.confirm(PAYLOAD); });
    await vi.waitFor(() => expect(applyTakeoffJob).toHaveBeenCalledTimes(1));
    rerender({ jobId: "11111111-1111-4111-8111-111111111112" });
    await act(async () => { application.resolve(RESPONSE); await confirmed; });
    expect(onApplied).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  // The re-check of 0fd09a20 (finding 6): only the landing checked the call's identity; the refusal of a call another job
  // superseded, and its « Envoi… », showed on the next review. Written before the fix.
  describe("a call another job or version superseded", () => {
    const OTHER_JOB = "11111111-1111-4111-8111-111111111112";
    type Lock = Awaited<ReturnType<typeof ensureTakeoffApplyDraftLock>>;
    const renderConfirm = () => renderHook(({ jobId }) => useTakeoffApplyConfirm({ jobId, versionId: VERSION_ID, onApplied: vi.fn() }),
      { initialProps: { jobId: JOB_ID } });

    it("never shows its sending nor its refusal on the review shown since, and still gives its lease back", async () => {
      vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
      vi.mocked(releaseEstimateDraftLock).mockResolvedValue({ released: true });
      const application = deferred<TakeoffApplyResponse>();
      vi.mocked(applyTakeoffJob).mockReturnValue(application.promise);
      const { result, rerender } = renderConfirm();
      let confirmed: Promise<void> = Promise.resolve();
      act(() => { confirmed = result.current.confirm(PAYLOAD); });
      await vi.waitFor(() => expect(applyTakeoffJob).toHaveBeenCalledTimes(1));
      expect(result.current.submitting).toBe(true);
      rerender({ jobId: OTHER_JOB });
      expect(result.current.submitting).toBe(false);
      await act(async () => { application.reject(new Error("refused")); await confirmed; });
      expect(result.current.error).toBeNull();
      expect(result.current.errorGuard).toBeNull();
      expect(result.current.submitting).toBe(false);
      expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID);
    });

    it("never shows the refusal of an earlier visit to the same job (A → B → A)", async () => {
      vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: false, errorMessage: null });
      const application = deferred<TakeoffApplyResponse>();
      vi.mocked(applyTakeoffJob).mockReturnValue(application.promise);
      const { result, rerender } = renderConfirm();
      let confirmed: Promise<void> = Promise.resolve();
      act(() => { confirmed = result.current.confirm(PAYLOAD); });
      await vi.waitFor(() => expect(applyTakeoffJob).toHaveBeenCalledTimes(1));
      rerender({ jobId: OTHER_JOB });
      rerender({ jobId: JOB_ID });
      expect(result.current.submitting).toBe(false);
      await act(async () => { application.reject(new Error("refused")); await confirmed; });
      expect(result.current.error).toBeNull();
      expect(result.current.submitting).toBe(false);
    });

    it("never shows a lock refused after another job was shown", async () => {
      const lock = deferred<Lock>();
      vi.mocked(ensureTakeoffApplyDraftLock).mockReturnValue(lock.promise);
      const { result, rerender } = renderConfirm();
      let confirmed: Promise<void> = Promise.resolve();
      act(() => { confirmed = result.current.confirm(PAYLOAD); });
      rerender({ jobId: OTHER_JOB });
      await act(async () => {
        lock.resolve({ acquired: false, shouldRelease: false, errorMessage: "Un autre utilisateur modifie ce brouillon." });
        await confirmed;
      });
      expect(result.current.error).toBeNull();
      expect(applyTakeoffJob).not.toHaveBeenCalled();
    });

    it("still shows the refusal of the review's own call", async () => {
      vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: false, shouldRelease: false,
        errorMessage: "Un autre utilisateur modifie ce brouillon." });
      const { result } = renderConfirm();
      await act(() => result.current.confirm(PAYLOAD));
      expect(result.current.error).toBe("Un autre utilisateur modifie ce brouillon.");
      expect(result.current.submitting).toBe(false);
    });
  });

  it("runs one application for two confirmations in the same tick", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: false, errorMessage: null });
    const onApplied = vi.fn();
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    await act(async () => { await Promise.all([result.current.confirm(PAYLOAD), result.current.confirm(PAYLOAD)]); });
    expect(ensureTakeoffApplyDraftLock).toHaveBeenCalledTimes(1);
    expect(applyTakeoffJob).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("releases the lease it took after a refusal, and never lands", async () => {
    vi.mocked(ensureTakeoffApplyDraftLock).mockResolvedValue({ acquired: true, shouldRelease: true, errorMessage: null });
    vi.mocked(releaseEstimateDraftLock).mockResolvedValue({ released: true });
    vi.mocked(applyTakeoffJob).mockRejectedValue(new Error("refused"));
    const onApplied = vi.fn();
    const { result } = renderHook(() => useTakeoffApplyConfirm({ jobId: JOB_ID, versionId: VERSION_ID, onApplied }));

    await act(() => result.current.confirm(PAYLOAD));
    expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID);
    expect(onApplied).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Erreur lors de l'envoi au tableau de chiffrage.");
  });
});

describe("takeoffApplySentDescription", () => {
  it("counts the lines in French, singular up to one", () => {
    expect(takeoffApplySentDescription({ created_count: 2, updated_count: 1, ignored_count: 0 }))
      .toBe("2 lignes créées, 1 mise à jour, 0 ignorée.");
    expect(takeoffApplySentDescription({ created_count: 1, updated_count: 3, ignored_count: 2 }))
      .toBe("1 ligne créée, 3 mises à jour, 2 ignorées.");
  });
});
