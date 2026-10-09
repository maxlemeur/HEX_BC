"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SignaturePadProps = {
  onSign: (base64: string) => void;
  onClear: () => void;
  disabled?: boolean;
};

type Point = { x: number; y: number };
/** Points en pixels CSS, avec la largeur du canvas au moment du tracé. */
type Stroke = { width: number; points: Point[] };

// Encre de l'image PNG exportée (donnée de la signature, pas un style d'interface).
const INK_COLOR = "#1e3a5f";
const LINE_WIDTH = 2;
const CANVAS_HEIGHT = 150;

function applyInkStyle(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function SignaturePad({
  onSign,
  onClear,
  disabled = false,
}: SignaturePadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([]);
  const widthRef = useRef(0);
  const [isEmpty, setIsEmpty] = useState(true);

  /**
   * UX70 : redimensionner un canvas l'efface. Une rotation de l'écran perdait
   * donc la signature en cours. Les traits sont conservés et retracés, réduits
   * proportionnellement si la zone devient plus étroite.
   */
  const redrawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    for (const stroke of strokesRef.current) {
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      const scale = stroke.width > 0 ? Math.min(1, widthRef.current / stroke.width) : 1;
      ctx.beginPath();
      ctx.moveTo(first.x * scale, first.y * scale);
      if (rest.length === 0) {
        ctx.lineTo(first.x * scale + 0.01, first.y * scale);
      }
      for (const point of rest) {
        ctx.lineTo(point.x * scale, point.y * scale);
      }
      ctx.stroke();
    }
  }, []);

  // Setup canvas size + context
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return false;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    if (width === widthRef.current && canvas.width === Math.round(width * dpr)) {
      return false;
    }
    widthRef.current = width;

    canvas.width = width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyInkStyle(ctx);
    return true;
  }, []);

  useEffect(() => {
    setupCanvas();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (!setupCanvas() || strokesRef.current.length === 0) return;
      redrawStrokes();
      const canvas = canvasRef.current;
      if (canvas) {
        onSign(canvas.toDataURL("image/png"));
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [setupCanvas, redrawStrokes, onSign]);

  const getPosition = useCallback(
    (e: MouseEvent | TouchEvent): Point | null => {
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

      const pos = getPosition(e);
      if (!pos) return;

      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      isDrawingRef.current = true;
      strokesRef.current.push({ width: widthRef.current, points: [pos] });
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
      strokesRef.current.at(-1)?.points.push(pos);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    [disabled, getPosition]
  );

  const endStroke = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
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

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyInkStyle(ctx);

    strokesRef.current = [];
    setIsEmpty(true);
    onClear();
  }, [onClear]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground-secondary">
          Signature <span className="font-normal text-muted-foreground">(facultative)</span>
        </p>
        {!isEmpty ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            disabled={disabled}
          >
            Effacer la signature
          </Button>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden rounded-lg border",
          disabled ? "border-border bg-muted" : "border-border-strong bg-surface-subtle"
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Zone de signature"
          className={cn(
            "block w-full touch-none",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-crosshair"
          )}
        />
        {isEmpty && !disabled ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-muted-foreground">
              Dessinez votre signature ici
            </span>
          </div>
        ) : null}
        {/* Sign-here line */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-6 bottom-4 left-6 border-b border-dashed border-border-strong"
        />
      </div>
    </div>
  );
}
