import { Box } from "@mantine/core";
import { MIN_FREQ_HZ, MAX_FREQ_HZ } from "./const";
import type { PileupTrack } from "./utils/pileupCandidates";

type PileupOverlayProps = {
  tracks: PileupTrack[];
  minFreqHz?: number;
  maxFreqHz?: number;
};

/**
 * Thin frequency markers for detected signals. The decoded text lives in the
 * track list below the waterfall (much more readable than overlaying it).
 */
export const PileupOverlay = ({
  tracks,
  minFreqHz = MIN_FREQ_HZ,
  maxFreqHz = MAX_FREQ_HZ,
}: PileupOverlayProps) => {
  const range = maxFreqHz - minFreqHz;

  return (
    <Box
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {tracks.map((track) => {
        const topPercent = ((maxFreqHz - track.frequency) / range) * 100;
        return (
          <div
            key={track.id}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${topPercent}%`,
              height: 1,
              background: "rgba(92, 139, 255, 0.45)",
              borderTop: "1px dashed rgba(92, 139, 255, 0.9)",
            }}
          >
            <span
              style={{
                position: "absolute",
                right: 8,
                top: -8,
                fontSize: 10,
                lineHeight: 1,
                color: "#9db8ff",
                background: "rgba(10, 14, 20, 0.8)",
                padding: "1px 4px",
                borderRadius: 2,
                fontFamily: "Cascadia Mono, Consolas, monospace",
              }}
            >
              {track.frequency}
            </span>
          </div>
        );
      })}
    </Box>
  );
};
