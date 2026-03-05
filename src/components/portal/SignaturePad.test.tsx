import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignaturePad } from "./SignaturePad";

// ---------------------------------------------------------------------------
// Mocks — jsdom doesn't support canvas, mock getContext + ResizeObserver
// ---------------------------------------------------------------------------

const mockCtx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  setTransform: vi.fn(),
  strokeStyle: "",
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
};

beforeEach(() => {
  // Mock canvas getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => "data:image/png;base64,MOCK"
  );

  // Mock ResizeObserver
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof ResizeObserver;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignaturePad", () => {
  const onSign = vi.fn();
  const onClear = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders canvas with correct accessibility attributes", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} />);

    const canvas = screen.getByRole("img", { name: "Zone de signature" });
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName).toBe("CANVAS");
  });

  it("shows placeholder text when empty", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} />);

    expect(
      screen.getByText("Dessinez votre signature ici")
    ).toBeInTheDocument();
  });

  it("shows 'Signature (optionnel)' label", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} />);

    expect(screen.getByText("Signature")).toBeInTheDocument();
    expect(screen.getByText("(optionnel)")).toBeInTheDocument();
  });

  it("does not show clear button when empty", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} />);

    expect(screen.queryByText("Effacer")).not.toBeInTheDocument();
  });

  it("applies disabled styling when disabled", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} disabled />);

    const canvas = screen.getByRole("img", { name: "Zone de signature" });
    expect(canvas.className).toContain("cursor-not-allowed");
    expect(canvas.className).toContain("opacity-50");
  });

  it("hides placeholder when disabled", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} disabled />);

    expect(
      screen.queryByText("Dessinez votre signature ici")
    ).not.toBeInTheDocument();
  });

  it("calls getContext on mount (canvas setup)", () => {
    render(<SignaturePad onSign={onSign} onClear={onClear} />);

    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d");
  });
});
