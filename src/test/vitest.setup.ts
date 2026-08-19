import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Vitest runs without `globals`, so Testing Library cannot install its own
// auto-cleanup (it looks for a global `afterEach`). Without this hook, roots
// rendered by a test stay mounted until the file ends: React keeps scheduler
// work queued on `setImmediate`, and that callback can run after Vitest has
// torn down the jsdom environment, throwing `ReferenceError: window is not
// defined` as an unhandled error attributed to whichever file was running.
// Unmounting after each test flushes that work while `window` still exists.
afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
