// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAutoSaveDraftFromLocal,
  clearConflictDraftFromSession,
  readAutoSaveDraftFromLocal,
  readConflictDraftFromSession,
  writeAutoSaveDraftToLocal,
  writeConflictDraftToSession,
} from "@/lib/estimates/editor-drafts";

const FIXED_NOW = "2026-07-15T16:45:00.000Z";
const CONFLICT_KEY = "estimate:edit:conflict-draft:";
const AUTOSAVE_KEY = "estimate:edit:autosave-buffer:";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("estimate editor conflict drafts", () => {
  it("round-trips settings, items and saved timestamp in session storage", () => {
    const draft = {
      settings: { title: "Devis principal", margin: 1.2 },
      items: [{ id: "line-1", title: "Tube" }],
      saved_at: "2026-07-14T10:00:00.000Z",
    };

    writeConflictDraftToSession("version-1", draft);

    expect(
      readConflictDraftFromSession<
        { title: string; margin: number },
        { id: string; title: string }
      >("version-1")
    ).toEqual(draft);
    expect(readConflictDraftFromSession("version-2")).toBeNull();
  });

  it("rejects malformed drafts and supplies a stable timestamp when absent", () => {
    window.sessionStorage.setItem(`${CONFLICT_KEY}invalid-json`, "{");
    window.sessionStorage.setItem(
      `${CONFLICT_KEY}invalid-settings`,
      JSON.stringify({ settings: [], items: [], saved_at: FIXED_NOW })
    );
    window.sessionStorage.setItem(
      `${CONFLICT_KEY}invalid-items`,
      JSON.stringify({ settings: null, items: {}, saved_at: FIXED_NOW })
    );
    window.sessionStorage.setItem(
      `${CONFLICT_KEY}fallback-time`,
      JSON.stringify({ settings: null, items: [] })
    );

    expect(readConflictDraftFromSession("invalid-json")).toBeNull();
    expect(readConflictDraftFromSession("invalid-settings")).toBeNull();
    expect(readConflictDraftFromSession("invalid-items")).toBeNull();
    expect(readConflictDraftFromSession("fallback-time")).toEqual({
      settings: null,
      items: [],
      saved_at: FIXED_NOW,
    });
  });

  it("clears only the requested conflict draft", () => {
    writeConflictDraftToSession("version-1", {
      settings: null,
      items: [{ id: "line-1" }],
      saved_at: FIXED_NOW,
    });
    writeConflictDraftToSession("version-2", {
      settings: null,
      items: [{ id: "line-2" }],
      saved_at: FIXED_NOW,
    });

    clearConflictDraftFromSession("version-1");

    expect(readConflictDraftFromSession("version-1")).toBeNull();
    expect(readConflictDraftFromSession("version-2")).not.toBeNull();
  });
});

describe("estimate editor autosave drafts", () => {
  it("round-trips buffered updates with a stable generated timestamp", () => {
    type DraftUpdate = {
      title?: string;
      quantity?: number;
      unit_price_ht_cents?: number;
    };
    const updates: { id: string; updates: DraftUpdate }[] = [
      { id: "line-1", updates: { title: "Tube acier", quantity: 2 } },
      { id: "line-2", updates: { unit_price_ht_cents: 1500 } },
    ];

    writeAutoSaveDraftToLocal("version-1", updates);

    expect(
      readAutoSaveDraftFromLocal<DraftUpdate>("version-1")
    ).toEqual({
      buffered_updates: updates,
      saved_at: FIXED_NOW,
    });
  });

  it("filters malformed entries and rejects invalid or empty payloads", () => {
    window.localStorage.setItem(`${AUTOSAVE_KEY}invalid-json`, "{");
    window.localStorage.setItem(
      `${AUTOSAVE_KEY}mixed`,
      JSON.stringify({
        buffered_updates: [
          null,
          { id: "", updates: { title: "ignored" } },
          { id: "line-invalid", updates: [] },
          { id: "line-valid", updates: { title: "kept" } },
        ],
        saved_at: "   ",
      })
    );
    window.localStorage.setItem(
      `${AUTOSAVE_KEY}empty`,
      JSON.stringify({ buffered_updates: [] })
    );

    expect(readAutoSaveDraftFromLocal("invalid-json")).toBeNull();
    expect(readAutoSaveDraftFromLocal("empty")).toBeNull();
    expect(readAutoSaveDraftFromLocal("mixed")).toEqual({
      buffered_updates: [
        { id: "line-valid", updates: { title: "kept" } },
      ],
      saved_at: FIXED_NOW,
    });
  });

  it("clears autosave storage explicitly and when writing an empty buffer", () => {
    const updates = [{ id: "line-1", updates: { title: "Tube" } }];
    writeAutoSaveDraftToLocal("version-1", updates);
    writeAutoSaveDraftToLocal("version-2", updates);

    clearAutoSaveDraftFromLocal("version-1");
    expect(readAutoSaveDraftFromLocal("version-1")).toBeNull();
    expect(readAutoSaveDraftFromLocal("version-2")).not.toBeNull();

    writeAutoSaveDraftToLocal("version-2", []);
    expect(readAutoSaveDraftFromLocal("version-2")).toBeNull();
  });
});
