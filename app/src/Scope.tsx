import { memo, useCallback, useRef, useState } from "react";
import { Box } from "@mantine/core";
import { MIN_FREQ_HZ, MAX_FREQ_HZ, MIN_BANDWIDTH_HZ } from "./const";
import { useSpectrogramRenderer } from "./hooks/useSpectrogramRenderer";
import { useCanvasInteraction } from "./hooks/useCanvasInteraction";
import {
  calculateBandPosition,
  calculateVisibleBandBounds,
  clampFrequencyToRange,
} from "./utils/frequencyUtils";

type ScopeProps = {
  stream: MediaStream;
  setFilterFreq: (freq: number) => void;
  filterFreq: number | null;
  filterWidth: number;
  /** Enables the drag handles that resize the decode band. */
  setFilterWidth?: (width: number) => void;
  onBandCommit?: () => void;
  decodeWindowSeconds: number;
  disableInteraction?: boolean;
  height?: number;
  minFreqHz?: number;
  maxFreqHz?: number;
  brightness?: number;
  maxDevicePixelRatio?: number;
};

type Edge = "top" | "bottom";

export const Scope = memo(function Scope({
  stream,
  setFilterFreq,
  filterFreq,
  filterWidth,
  setFilterWidth,
  onBandCommit,
  decodeWindowSeconds,
  disableInteraction,
  height = 252,
  minFreqHz = MIN_FREQ_HZ,
  maxFreqHz = MAX_FREQ_HZ,
  brightness,
  maxDevicePixelRatio,
}: ScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<Edge | null>(null);
  const dragRef = useRef<{
    edge: Edge;
    lowerFreq: number;
    upperFreq: number;
  } | null>(null);
  // While dragging only a local preview is updated: committing every pointer
  // move would restart the decode pipeline dozens of times per second.
  const [preview, setPreview] = useState<{
    topPercent: number;
    heightPercent: number;
    width: number;
    center: number;
  } | null>(null);
  const previewRef = useRef<typeof preview>(null);

  useSpectrogramRenderer({
    stream,
    canvasRef,
    decodeWindowSeconds,
    minFreqHz,
    maxFreqHz,
    brightness,
    maxDevicePixelRatio,
  });

  useCanvasInteraction({
    canvasRef,
    filterFreq,
    setFilterFreq,
    enabled: !disableInteraction,
    minFreqHz,
    maxFreqHz,
  });

  const { topPercent, heightPercent } = calculateBandPosition(
    filterFreq,
    filterWidth,
    minFreqHz,
    maxFreqHz,
  );

  const frequencyFromPointer = useCallback(
    (clientY: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return minFreqHz;
      const rect = canvas.getBoundingClientRect();
      const ratio = (rect.bottom - clientY) / rect.height;
      return clampFrequencyToRange(
        minFreqHz + ratio * (maxFreqHz - minFreqHz),
        minFreqHz,
        maxFreqHz,
      );
    },
    [maxFreqHz, minFreqHz],
  );

  const beginResize = useCallback(
    (edge: Edge) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (disableInteraction || !setFilterWidth || filterFreq == null) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = calculateVisibleBandBounds(
        filterFreq,
        filterWidth,
        minFreqHz,
        maxFreqHz,
      );
      dragRef.current = {
        edge,
        lowerFreq: bounds.lowerFreq,
        upperFreq: bounds.upperFreq,
      };
      setResizing(edge);
      const element = event.currentTarget;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        moveEvent.preventDefault();
        const pointerHz = frequencyFromPointer(moveEvent.clientY);
        let lower = drag.lowerFreq;
        let upper = drag.upperFreq;

        if (drag.edge === "top") {
          upper = Math.max(pointerHz, lower + MIN_BANDWIDTH_HZ);
          upper = Math.min(upper, maxFreqHz);
        } else {
          lower = Math.min(pointerHz, upper - MIN_BANDWIDTH_HZ);
          lower = Math.max(lower, minFreqHz);
        }

        const range = maxFreqHz - minFreqHz;
        const next = {
          topPercent: ((maxFreqHz - upper) / range) * 100,
          heightPercent: ((upper - lower) / range) * 100,
          width: Math.max(MIN_BANDWIDTH_HZ, Math.round(upper - lower)),
          center: Math.round((upper + lower) / 2),
        };
        previewRef.current = next;
        setPreview(next);
      };

      const handleUp = () => {
        const pending = previewRef.current;
        dragRef.current = null;
        previewRef.current = null;
        setPreview(null);
        setResizing(null);
        element.removeEventListener("pointermove", handleMove);
        element.removeEventListener("pointerup", handleUp);
        element.removeEventListener("pointercancel", handleUp);

        if (!pending) return;
        // Commit once, on release.
        setFilterWidth(pending.width);
        setFilterFreq(
          Math.round(
            clampFrequencyToRange(pending.center, minFreqHz, maxFreqHz),
          ),
        );
        onBandCommit?.();
      };

      element.addEventListener("pointermove", handleMove);
      element.addEventListener("pointerup", handleUp);
      element.addEventListener("pointercancel", handleUp);
    },
    [
      disableInteraction,
      filterFreq,
      filterWidth,
      frequencyFromPointer,
      maxFreqHz,
      minFreqHz,
      onBandCommit,
      setFilterFreq,
      setFilterWidth,
    ],
  );

  const showBand = !disableInteraction && filterFreq != null;
  const bandTopPercent = preview ? preview.topPercent : topPercent;
  const bandHeightPercent = preview ? preview.heightPercent : heightPercent;
  const bandWidthLabel = Math.round(preview ? preview.width : filterWidth);
  const bandHeight = (bandHeightPercent / 100) * height;

  return (
    <Box
      className="dcw-scope"
      style={{ height: `${height}px` }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: `${height}px`,
          background: "#070a0f",
        }}
      />
      {showBand && (
        <div
          className="dcw-band"
          style={{
            top: `${bandTopPercent}%`,
            height: `${bandHeightPercent}%`,
          }}
        >
          <div
            className={`dcw-band-grip ${
              dragging && !resizing ? "dcw-band-grip--active" : ""
            }`}
          >
            <span />
            <span />
            <span />
          </div>

          {setFilterWidth && bandHeight >= 26 && (
            <div className="dcw-band-label">{bandWidthLabel} Hz</div>
          )}

          {setFilterWidth && (
            <>
              <div
                className={`dcw-band-handle dcw-band-handle--top ${
                  resizing === "top" ? "dcw-band-handle--active" : ""
                }`}
                onPointerDown={beginResize("top")}
                title="Drag to change the bandwidth"
              />
              <div
                className={`dcw-band-handle dcw-band-handle--bottom ${
                  resizing === "bottom" ? "dcw-band-handle--active" : ""
                }`}
                onPointerDown={beginResize("bottom")}
                title="Drag to change the bandwidth"
              />
            </>
          )}
        </div>
      )}
    </Box>
  );
});
