"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SignaturePadProps = {
  onSign: (base64: string) => void;
  onClear: () => void;
  disabled?: boolean;
};

const INK_COLOR = "#1e3a5f";
const LINE_WIDTH = 2;

export function SignaturePad({
  onSign,
  onClear,
  disabled = false,
}: SignaturePadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const hasStrokesRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Setup canvas size + context
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 150;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    setupCanvas();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setupCanvas();
      // Clear strokes on resize (canvas is reset)
      if (hasStrokesRef.current) {
        hasStrokesRef.current = false;
        setIsEmpty(true);
        onClear();
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [setupCanvas, onClear]);

  const getPosition = useCallback(
    (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        const touch = e.touches[0];
        if (!touch) return null;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const startStroke = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      isDrawingRef.current = true;

      const pos = getPosition(e);
      if (!pos) return;

      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    },
    [disabled, getPosition]
  );

  const continueStroke = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || disabled) return;
      e.preventDefault();

      const pos = getPosition(e);
      if (!pos) return;

      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    [disabled, getPosition]
  );

  const endStroke = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    hasStrokesRef.current = true;
    setIsEmpty(false);

    const canvas = canvasRef.current;
    if (canvas) {
      onSign(canvas.toDataURL("image/png"));
    }
  }, [onSign]);

  // Attach events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => startStroke(e);
    const onMouseMove = (e: MouseEvent) => continueStroke(e);
    const onMouseUp = () => endStroke();
    const onTouchStart = (e: TouchEvent) => startStroke(e);
    const onTouchMove = (e: TouchEvent) => continueStroke(e);
    const onTouchEnd = () => endStroke();

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [startStroke, continueStroke, endStroke]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Re-apply context settings after clear
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    hasStrokesRef.current = false;
    setIsEmpty(true);
    onClear();
  }, [onClear]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--slate-700)]">
          Signature <span className="text-[var(--slate-400)]">(optionnel)</span>
        </label>
        {!isEmpty && (
          <button
            type="button"
            className="text-xs font-medium text-[var(--slate-500)] underline hover:text-[var(--slate-700)]"
            onClick={handleClear}
            disabled={disabled}
          >
            Effacer
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-lg border ${
          disabled
            ? "border-[var(--slate-200)] bg-[var(--slate-100)]"
            : "border-[var(--slate-300)] bg-[var(--slate-50)]"
        }`}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Zone de signature"
          className={`block w-full ${disabled ? "cursor-not-allowed opacity-50" : "cursor-crosshair"}`}
          style={{ touchAction: "none" }}
        />
        {isEmpty && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[var(--slate-400)]">
              Dessinez votre signature ici
            </span>
          </div>
        )}
        {/* Sign-here line */}
        <div className="pointer-events-none absolute bottom-4 left-6 right-6 border-b border-dashed border-[var(--slate-300)]" />
      </div>
    </div>
  );
}
