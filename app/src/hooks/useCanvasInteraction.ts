import { useEffect, useRef } from "react";
import { MAX_FREQ_HZ, MIN_FREQ_HZ } from "../const";
import { clampFrequencyToRange } from "../utils/frequencyUtils";

type UseCanvasInteractionParams = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  filterFreq: number | null;
  setFilterFreq: (freq: number) => void;
  enabled?: boolean;
  minFreqHz?: number;
  maxFreqHz?: number;
};

const calculateFrequencyFromY = (
  y: number,
  canvasHeight: number,
  minFreqHz: number,
  maxFreqHz: number,
): number => {
  const invY = canvasHeight - y;
  const frequencyRange = maxFreqHz - minFreqHz;
  const rawFrequency = minFreqHz + (invY / canvasHeight) * frequencyRange;

  return clampFrequencyToRange(rawFrequency, minFreqHz, maxFreqHz);
};

/**
 * Waterfall interaction:
 *  - click / drag anywhere to place the decode band (live feedback while dragging)
 *  - mouse wheel nudges it by 20 Hz (5 Hz with Shift)
 */
export const useCanvasInteraction = ({
  canvasRef,
  filterFreq,
  setFilterFreq,
  enabled = true,
  minFreqHz = MIN_FREQ_HZ,
  maxFreqHz = MAX_FREQ_HZ,
}: UseCanvasInteractionParams) => {
  const filterFreqRef = useRef(filterFreq);
  filterFreqRef.current = filterFreq;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;

    const updateFromPointer = (clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const frequency = calculateFrequencyFromY(
        clientY - rect.top,
        rect.height,
        minFreqHz,
        maxFreqHz,
      );
      setFilterFreq(Math.round(frequency));
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      canvas.style.cursor = "ns-resize";
      updateFromPointer(event.clientY);
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      updateFromPointer(event.clientY);
      event.preventDefault();
    };

    const stopDragging = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "crosshair";
      try {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* ignore */
      }
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = filterFreqRef.current;
      if (current == null) return;
      const step = event.shiftKey ? 5 : 20;
      const next =
        event.deltaY < 0 ? current + step : current - step;
      setFilterFreq(
        Math.round(clampFrequencyToRange(next, minFreqHz, maxFreqHz)),
      );
    };

    canvas.style.cursor = "crosshair";
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", stopDragging);
      canvas.removeEventListener("pointercancel", stopDragging);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.style.cursor = "";
    };
  }, [canvasRef, enabled, maxFreqHz, minFreqHz, setFilterFreq]);
};
