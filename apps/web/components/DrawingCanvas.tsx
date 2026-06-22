"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import clsx from "clsx";

export interface DrawingCanvasHandle {
  /** Export as a PNG data URL, or null if blank. */
  toPngDataUrl: () => string | null;
  clear: () => void;
}

const RES = 512; // internal resolution (keeps PNGs small, well under the 2MB limit)
const COLORS = ["#1a1a1e", "#ff5c8a", "#5cc8ff", "#b6ff5c", "#ffd23f", "#ffffff"];
const SIZES = [3, 8, 18];
const UNDO_DEPTH = 25;

export const DrawingCanvas = forwardRef<DrawingCanvasHandle>(function DrawingCanvas(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const dirty = useRef(false);

  const [color, setColor] = useState(COLORS[1]);
  const [size, setSize] = useState(SIZES[1]);
  const [eraser, setEraser] = useState(false);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  useEffect(() => {
    const c = ctx();
    if (!c) return;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, RES, RES);
    c.lineCap = "round";
    c.lineJoin = "round";
  }, []);

  const pushUndo = () => {
    const c = ctx();
    if (!c) return;
    undoStack.current.push(c.getImageData(0, 0, RES, RES));
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift();
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * RES,
      y: ((e.clientY - rect.top) / rect.height) * RES,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    drawing.current = true;
    dirty.current = true;
    last.current = pos(e);
    // a dot for taps
    const c = ctx();
    if (c && last.current) {
      c.beginPath();
      c.fillStyle = eraser ? "#ffffff" : color;
      c.arc(last.current.x, last.current.y, size / 2, 0, Math.PI * 2);
      c.fill();
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ctx();
    const p = pos(e);
    if (!c || !last.current) return;
    c.strokeStyle = eraser ? "#ffffff" : color;
    c.lineWidth = size;
    c.beginPath();
    c.moveTo(last.current.x, last.current.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last.current = p;
  };

  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const undo = () => {
    const c = ctx();
    const prev = undoStack.current.pop();
    if (c && prev) c.putImageData(prev, 0, 0);
  };

  const clear = () => {
    const c = ctx();
    if (!c) return;
    pushUndo();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, RES, RES);
    dirty.current = false;
  };

  useImperativeHandle(ref, () => ({
    toPngDataUrl: () => (dirty.current ? (canvasRef.current?.toDataURL("image/png") ?? null) : null),
    clear,
  }));

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={RES}
        height={RES}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="aspect-square w-full touch-none rounded-xl border-2 border-black bg-white shadow-chunk"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`color ${c}`}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
              className={clsx(
                "h-7 w-7 rounded-full border-2",
                color === c && !eraser ? "border-paper" : "border-black",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex gap-1">
          {SIZES.map((s) => (
            <button
              key={s}
              aria-label={`brush ${s}`}
              onClick={() => setSize(s)}
              className={clsx(
                "flex h-7 w-7 items-center justify-center rounded-lg border-2 border-black bg-ink-soft",
                size === s && "ring-2 ring-slop2",
              )}
            >
              <span className="rounded-full bg-paper" style={{ width: s, height: s }} />
            </button>
          ))}
        </div>
        <button
          onClick={() => setEraser((e) => !e)}
          className={clsx(
            "rounded-lg border-2 border-black px-2 py-1 text-sm font-bold",
            eraser ? "bg-slop2 text-black" : "bg-ink-soft text-paper",
          )}
        >
          eraser
        </button>
        <button
          onClick={undo}
          className="rounded-lg border-2 border-black bg-ink-soft px-2 py-1 text-sm font-bold"
        >
          undo
        </button>
        <button
          onClick={clear}
          className="rounded-lg border-2 border-black bg-ink-soft px-2 py-1 text-sm font-bold"
        >
          clear
        </button>
      </div>
    </div>
  );
});
