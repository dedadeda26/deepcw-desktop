import { memo, useRef, useState } from "react";
import { Box } from "@mantine/core";
import { MIN_FREQ_HZ, MAX_FREQ_HZ } from "./const";
import { useSpectrogramRenderer } from "./hooks/useSpectrogramRenderer";
import { useCanvasInteraction } from "./hooks/useCanvasInteraction";
import { calculateBandPosition } from "./utils/frequencyUtils";

type ScopeProps = {
  stream: MediaStream;
  setFilterFreq: (freq: number) => void;
  filterFreq: number | null;
  filterWidth: number;
  decodeWindowSeconds: number;
  disableInteraction?: boolean;
  height?: number;
  minFreqHz?: number;
  maxFreqHz?: number;
  brightness?: number;
  maxDevicePixelRatio?: number;
};

export const Scope = memo(function Scope({
  stream,
  setFilterFreq,
  filterFreq,
  filterWidth,
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
      {!disableInteraction && filterFreq != null && (
        <div
          className="dcw-band"
          style={{
            top: `${topPercent}%`,
            height: `${heightPercent}%`,
          }}
        >
          <div
            className={`dcw-band-grip ${
              dragging ? "dcw-band-grip--active" : ""
            }`}
          >
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
    </Box>
  );
});
