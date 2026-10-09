import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import {
_resetForTest,
getSnapshot,
initStore,
setLastAffaire
} from "@/lib/stores/last-affaire-store";

describe("last-affaire-store", () => {
  beforeEach(() => {
    _resetForTest();
    localStorage.clear();
  });

  afterEach(() => {
    _resetForTest();
  });

  it("initStore clears previous in-memory project when next profile has no stored affaire", () => {
    localStorage.setItem(
      "hex-last-affaire:v1:user-1",
      JSON.stringify({ projectId: "proj-42" })
    );

    initStore("user-1");
    expect(getSnapshot()).toBe("proj-42");

    initStore("user-2");
    expect(getSnapshot()).toBeNull();
  });

  it("setLastAffaire can persist to the provided profile scope before initStore runs", () => {
    setLastAffaire("proj-88", "user-1");

    const raw = localStorage.getItem("hex-last-affaire:v1:user-1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).projectId).toBe("proj-88");

    initStore("user-1");
    expect(getSnapshot()).toBe("proj-88");
  });

  it("does not throw when localStorage is unavailable", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    expect(() => initStore("user-1")).not.toThrow();
    expect(() => setLastAffaire("abc")).not.toThrow();
    // In-memory state still works
    expect(getSnapshot()).toBe("abc");

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
