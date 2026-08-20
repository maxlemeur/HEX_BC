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

// jsdom implements neither the layout APIs nor the pointer-capture APIs that
// headless UI primitives call on mount. Each shim below is *gap-filling*: it is
// installed only when the real thing is missing, and always left `writable` and
// `configurable` so a test can still swap in its own spy. Two already do —
// `SignaturePad.test.tsx` assigns `global.ResizeObserver`, and
// `IntakeWorkspace.test.tsx` assigns `Element.prototype.scrollIntoView` — and
// both must keep winning over these defaults.
if (typeof globalThis.ResizeObserver !== "function") {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

if (typeof globalThis.Element === "function") {
  const elementProto = globalThis.Element.prototype as unknown as Record<
    string,
    unknown
  >;

  // `scrollIntoView` is absent from jsdom; the pointer-capture trio exists on
  // the spec but not on jsdom's Element, and menus/selects call them while
  // resolving a press.
  const layoutShims: Record<string, (...args: never[]) => unknown> = {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  };

  for (const [name, impl] of Object.entries(layoutShims)) {
    if (typeof elementProto[name] !== "function") {
      Object.defineProperty(elementProto, name, {
        writable: true,
        configurable: true,
        value: impl,
      });
    }
  }
}

// jsdom ships no `PointerEvent`, so `userEvent`'s pointer sequences fall back to
// mouse events and any `new PointerEvent(...)` in component code throws.
// MouseEvent carries every property these primitives read.
if (typeof globalThis.PointerEvent !== "function") {
  Object.defineProperty(globalThis, "PointerEvent", {
    writable: true,
    configurable: true,
    value: globalThis.MouseEvent,
  });
}
