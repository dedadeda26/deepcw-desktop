import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  DECODE_FRAME_STRIDE_SAMPLES,
  FFT_LENGTH,
  PILEUP_FILTER_WIDTH_HZ,
  SAMPLE_RATE,
} from "../const";
import { loadModel, runInferenceDetailed } from "../utils/inference";
import type { InferenceBackend } from "../utils/inferenceProtocol";
import { waitForNextAudioChunk } from "../useDecode";
import type { AudioBufferState } from "./useAudioProcessing";
import type { PileupTrack } from "../utils/pileupCandidates";

type UsePileupDecodeParams = {
  stream: MediaStream | null;
  backend: InferenceBackend;
  audioBufferRef: MutableRefObject<AudioBufferState>;
  tracksRef: MutableRefObject<PileupTrack[]>;
  enabled: boolean;
  decodeWindowSeconds: number;
};

export type PileupRow = {
  id: number;
  frequency: number;
  text: string;
  active: boolean;
};

type UsePileupDecodeResult = {
  textMap: Record<number, string>;
  rows: PileupRow[];
  isDecoding: boolean;
  loaded: boolean;
  loadError: string | null;
  clearTrack: (id: number) => void;
  clearAll: () => void;
};

type TrackState = {
  id: number;
  frequency: number;
  committed: string;
  pending: string;
  /** Absolute sample position already committed (exclusive). */
  committedUntil: number;
  lastSeen: number;
};

const HISTORY_KEEP_MS = 20000;
const MAX_TRACK_CHARS = 600;
/** Characters closer than this to the window end are still unstable. */
const TAIL_GUARD_SAMPLES = Math.round(1.2 * SAMPLE_RATE);
const DECODE_INTERVAL_MS = 600;

/**
 * Multi-signal decoding with incremental text.
 *
 * Each detected track is decoded on its own (band shifted to the model centre)
 * and characters are committed once their frame lies outside the tail guard —
 * exactly the rule the single-signal transcript uses. The result is that text
 * keeps growing, instead of being replaced every time the decoder window
 * slides.
 */
export const usePileupDecode = ({
  stream,
  backend,
  audioBufferRef,
  tracksRef,
  enabled,
}: UsePileupDecodeParams): UsePileupDecodeResult => {
  const [textMap, setTextMap] = useState<Record<number, string>>({});
  const [rows, setRows] = useState<PileupRow[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRef = useRef(new Map<number, TrackState>());
  const modelSelectionSignature = backend;
  const loaded = loadedSignature === modelSelectionSignature;

  useEffect(() => {
    setLoadError(null);
  }, [backend]);

  useEffect(() => {
    if (!enabled || loaded) {
      return;
    }

    let cancelled = false;
    setLoadError(null);

    void loadModel("en", backend, "narrow")
      .then(() => {
        if (!cancelled) {
          setLoadedSignature(modelSelectionSignature);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Failed to load pileup inference model.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backend, enabled, loaded, modelSelectionSignature]);

  const publish = useCallback(() => {
    const now = performance.now();
    const active = tracksRef.current;
    const activeIds = new Set(active.map((track) => track.id));
    const states = stateRef.current;

    for (const track of active) {
      const existing = states.get(track.id);
      if (existing) {
        existing.frequency = track.frequency;
        existing.lastSeen = now;
      } else {
        states.set(track.id, {
          id: track.id,
          frequency: track.frequency,
          committed: "",
          pending: "",
          committedUntil: 0,
          lastSeen: now,
        });
      }
    }

    for (const [id, state] of states) {
      if (!activeIds.has(id) && now - state.lastSeen > HISTORY_KEEP_MS) {
        states.delete(id);
      }
    }

    const nextRows: PileupRow[] = [...states.values()]
      .sort((left, right) => left.frequency - right.frequency)
      .map((state) => ({
        id: state.id,
        frequency: state.frequency,
        text: `${state.committed}${state.pending}`.trim(),
        active: activeIds.has(state.id),
      }));

    const nextTexts: Record<number, string> = {};
    for (const state of states.values()) {
      if (state.committed) nextTexts[state.id] = state.committed;
    }

    setRows(nextRows);
    setTextMap(nextTexts);
  }, [tracksRef]);

  useEffect(() => {
    if (!stream || !loaded || !enabled) {
      setIsDecoding(false);
      return;
    }

    let cancelled = false;
    setIsDecoding(true);

    const decodeLoop = async () => {
      let lastAudioVersion = -1;
      let lastRoundAt = 0;

      while (!cancelled) {
        const audioVersion = audioBufferRef.current.version;
        if (audioVersion === lastAudioVersion) {
          await waitForNextAudioChunk(
            audioBufferRef,
            audioVersion,
            () => cancelled,
          );
          if (cancelled) return;
          continue;
        }
        lastAudioVersion = audioVersion;

        const now = performance.now();
        if (now - lastRoundAt < DECODE_INTERVAL_MS) {
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          continue;
        }
        lastRoundAt = now;

        const tracks = [...tracksRef.current];
        if (tracks.length === 0) {
          publish();
          continue;
        }

        const buffer = audioBufferRef.current.samples;
        // Exact audio clock: every written sample is counted, so character
        // positions are stable between rounds and nothing is committed twice.
        const windowEndSample = audioBufferRef.current.totalSamples;
        const windowStartSample = windowEndSample - buffer.length;
        const commitLimit = windowEndSample - TAIL_GUARD_SAMPLES;

        for (const track of tracks) {
          if (cancelled) return;

          const state = stateRef.current.get(track.id) ?? {
            id: track.id,
            frequency: track.frequency,
            committed: "",
            pending: "",
            committedUntil: 0,
            lastSeen: now,
          };
          stateRef.current.set(track.id, state);
          state.lastSeen = now;
          state.frequency = track.frequency;

          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await runInferenceDetailed(
              buffer,
              null,
              PILEUP_FILTER_WIDTH_HZ,
              {
                lang: "en",
                backend,
                shiftTargetFreq: track.frequency,
                englishModelVariant: "standard",
              },
            );
            if (cancelled) return;

            // characterSpans describe plainText (one entry per character);
            // displayText is padded to time slots and cannot be indexed by them.
            const plain = result.plainText ?? "";
            const spans = result.characterSpans;
            if (!plain || spans.length !== plain.length) {
              continue;
            }

            let committed = state.committed;
            let pending = "";

            // Where does the un-committed part of this window start? The window
            // begins before the last committed character, so look for the tail of
            // the committed text inside the window text (latest occurrence wins
            // when a message repeats). Frame positions jitter by ±1 frame between
            // rounds, so aligning on text is what prevents duplicates.
            let startIndex = -1;
            if (committed.length === 0) {
              startIndex = 0;
            } else if (plain.startsWith(committed)) {
              // Early rounds: the window text is just growing at the end.
              startIndex = committed.length;
            } else {
              const maxMatch = Math.min(plain.length, committed.length);
              for (let size = maxMatch; size >= 3; size -= 1) {
                const index = plain.lastIndexOf(committed.slice(-size));
                if (index >= 0) {
                  startIndex = index + size;
                  break;
                }
              }
            }

            // Without a reliable anchor, leave the text alone rather than risk
            // appending the same characters twice.
            if (startIndex < 0) {
              continue;
            }

            for (let index = startIndex; index < spans.length; index += 1) {
              const span = spans[index];
              if (!span) continue;
              const character = span.char ?? plain[index];
              if (!character) continue;
              const absoluteEnd =
                windowStartSample +
                span.endFrame * DECODE_FRAME_STRIDE_SAMPLES +
                FFT_LENGTH;
              if (absoluteEnd <= state.committedUntil) {
                continue;
              }
              if (absoluteEnd <= commitLimit) {
                committed += character;
                state.committedUntil = absoluteEnd;
              } else {
                pending += character;
              }
            }

            if (/[A-Z0-9]/i.test(committed)) {
              state.committed = committed.slice(-MAX_TRACK_CHARS);
            }
            state.pending = pending.slice(-MAX_TRACK_CHARS);
          } catch (error) {
            console.error("Pileup decode failed", error);
          }
        }

        publish();
      }
    };

    void decodeLoop();

    return () => {
      cancelled = true;
      setIsDecoding(false);
    };
  }, [audioBufferRef, backend, enabled, loaded, publish, stream, tracksRef]);

  useEffect(() => {
    if (enabled) return;
    stateRef.current.clear();
    setRows([]);
    setTextMap({});
  }, [enabled]);

  const clearTrack = useCallback(
    (id: number) => {
      const state = stateRef.current.get(id);
      if (!state) return;
      state.committed = "";
      state.pending = "";
      // Keep committedUntil: the characters already on screen must not come
      // back from the next window.
      publish();
    },
    [publish],
  );

  const clearAll = useCallback(() => {
    const activeIds = new Set(tracksRef.current.map((track) => track.id));
    for (const [id, state] of stateRef.current) {
      state.committed = "";
      state.pending = "";
      // Rows for signals that are already gone disappear completely.
      if (!activeIds.has(id)) {
        stateRef.current.delete(id);
      }
    }
    publish();
  }, [publish, tracksRef]);

  return {
    textMap,
    rows,
    isDecoding,
    loaded,
    loadError,
    clearTrack,
    clearAll,
  };
};
