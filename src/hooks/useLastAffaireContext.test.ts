import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetForTest,
  getServerSnapshot,
  getSnapshot,
  initStore,
  setLastAffaire,
  subscribe,
} from "@/lib/stores/last-affaire-store";

describe("last-affaire-store", () => {
  beforeEach(() => {
    _resetForTest();
    localStorage.clear();
  });

  afterEach(() => {
    _resetForTest();
  });

  it("getServerSnapshot returns null", () => {
    expect(getServerSnapshot()).toBeNull();
  });

  it("getSnapshot returns null initially", () => {
    expect(getSnapshot()).toBeNull();
  });

  it("setLastAffaire updates getSnapshot", () => {
    setLastAffaire("abc");
    expect(getSnapshot()).toBe("abc");
  });

  it("setLastAffaire overwrites previous value", () => {
    setLastAffaire("abc");
    setLastAffaire("def");
    expect(getSnapshot()).toBe("def");
  });

  it("subscribe notifies listeners after setLastAffaire", () => {
    const listener = vi.fn();
    subscribe(listener);
    setLastAffaire("abc");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();
    setLastAffaire("abc");
    expect(listener).not.toHaveBeenCalled();
  });

  it("initStore reads from localStorage", () => {
    localStorage.setItem(
      "hex-last-affaire:v1:user-1",
      JSON.stringify({ projectId: "proj-42" })
    );
    initStore("user-1");
    expect(getSnapshot()).toBe("proj-42");
  });

  it("initStore with null profileId uses unscoped key", () => {
    localStorage.setItem(
      "hex-last-affaire:v1",
      JSON.stringify({ projectId: "proj-99" })
    );
    initStore(null);
    expect(getSnapshot()).toBe("proj-99");
  });

  it("initStore with empty localStorage keeps null", () => {
    initStore("user-1");
    expect(getSnapshot()).toBeNull();
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

  it("setLastAffaire persists to localStorage", () => {
    initStore("user-1");
    setLastAffaire("proj-7");
    const raw = localStorage.getItem("hex-last-affaire:v1:user-1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).projectId).toBe("proj-7");
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
