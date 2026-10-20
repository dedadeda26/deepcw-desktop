import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { AudioBufferState } from "./useAudioProcessing";
import { waitForNextAudioChunk } from "../useDecode";
import {
  detectCwBins,
  loadCwDetectionModel,
  resetCwDetectionState,
} from "../utils/inference";
import type { InferenceBackend } from "../utils/inferenceProtocol";
import {
  pileupTracksChanged,
  type PileupTrack,
} from "../utils/pileupCandidates";

type UsePileupDetectionParams = {
  stream: MediaStream | null;
  backend: InferenceBackend;
  audioBufferRef: MutableRefObject<AudioBufferState>;
  enabled: boolean;
  minFreqHz: number;
  maxFreqHz: number;
};

type UsePileupDetectionResult = {
  tracks: PileupTrack[];
  loaded: boolean;
  loadError: string | null;
  isDetecting: boolean;
};

const DETECTION_MIN_INTERVAL_MS = 600;
const TRACKER_ID = 1;

/**
 * Multi-signal detection.
 *
 * Unlike the old web UI, the signal tracker itself now lives inside the WASM
 * engine (`runAudioTracks`): it keeps stable track ids, applies presence
 * thresholds and handles hold/release. The renderer just polls it and renders
 * whatever tracks it reports.
 */
export const usePileupDetection = ({
  stream,
  backend,
  audioBufferRef,
  enabled,
  minFreqHz,
  maxFreqHz,
}: UsePileupDetectionParams): UsePileupDetectionResult => {
  const [tracks, setTracks] = useState<PileupTrack[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [loadedBackend, setLoadedBackend] =
    useState<InferenceBackend | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reportedTracksRef = useRef<PileupTrack[]>([]);
  const loaded = loadedBackend === backend;

  useEffect(() => {
    setLoadError(null);
  }, [backend]);

  useEffect(() => {
    if (!enabled || loaded) {
      return;
    }

    let cancelled = false;
    setLoadError(null);

    void loadCwDetectionModel(backend)
      .then(() => {
        if (!cancelled) {
          setLoadedBackend(backend);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Failed to load CW detection model.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backend, enabled, loaded]);

  useEffect(() => {
    if (!stream || !loaded || !enabled) {
      setIsDetecting(false);
      reportedTracksRef.current = [];
      setTracks([]);
      if (loaded) {
        void resetCwDetectionState(backend, TRACKER_ID);
      }
      return;
    }

    let cancelled = false;
    setIsDetecting(true);

    const detectLoop = async () => {
      let lastAudioVersion = -1;
      let lastDetectionAt = 0;

      while (!cancelled) {
        const audioVersion = audioBufferRef.current.version;
        if (audioVersion === lastAudioVersion) {
          await waitForNextAudioChunk(
            audioBufferRef,
            audioVersion,
            () => cancelled,
          );
          if (cancelled) {
            return;
          }
          continue;
        }

        lastAudioVersion = audioVersion;

        const now = performance.now();
        if (now - lastDetectionAt < DETECTION_MIN_INTERVAL_MS) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, DETECTION_MIN_INTERVAL_MS / 2),
          );
          continue;
        }
        lastDetectionAt = now;

        try {
          const candidates = await detectCwBins(
            audioBufferRef.current.samples,
            backend,
            minFreqHz,
            maxFreqHz,
            0,
            0,
            [],
            TRACKER_ID,
          );
          if (cancelled) {
            return;
          }

          const nextTracks: PileupTrack[] = candidates
            .map((candidate) => ({
              id: candidate.id,
              frequency: Math.round(candidate.frequency),
            }))
            .sort((left, right) => left.frequency - right.frequency);

          if (pileupTracksChanged(reportedTracksRef.current, nextTracks)) {
            reportedTracksRef.current = nextTracks;
            setTracks(nextTracks);
          }
        } catch (error) {
          console.error("Pileup detection failed", error);
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      }
    };

    void detectLoop();

    return () => {
      cancelled = true;
      setIsDetecting(false);
      reportedTracksRef.current = [];
      setTracks([]);
      void resetCwDetectionState(backend, TRACKER_ID);
    };
  }, [
    audioBufferRef,
    backend,
    enabled,
    loaded,
    maxFreqHz,
    minFreqHz,
    stream,
  ]);

  return { tracks, loaded, loadError, isDetecting };
};
