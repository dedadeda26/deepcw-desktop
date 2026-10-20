import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Group,
  NativeSelect,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  DEFAULT_DECODE_BANDWIDTH_HZ,
  DEFAULT_DECODE_CENTER_FREQ_HZ,
  DECODE_WINDOW_OPTIONS,
  SAMPLE_RATE,
  PILEUP_WINDOW_S,
  PILEUP_MIN_FREQ_HZ,
  PILEUP_MAX_FREQ_HZ,
  type DecodeWindowSeconds,
} from "./const";
import { Scope } from "./Scope";
import { useDecode } from "./useDecode";
import { useAudioProcessing } from "./hooks/useAudioProcessing";
import { useAudioPassthrough } from "./hooks/useAudioPassthrough";
import { useFilteredPassthroughStream } from "./hooks/useFilteredPassthroughStream";
import { useLoadProgress } from "./hooks/useLoadProgress";
import { usePileupDecode } from "./hooks/usePileupDecode";
import { usePileupDetection } from "./hooks/usePileupDetection";
import { usePersistedState } from "./hooks/usePersistedState";
import { useStreamingDecode } from "./hooks/useStreamingDecode";
import { useRig } from "./hooks/useRig";
import { useWsjtx } from "./hooks/useWsjtx";
import type { BackgroundController } from "./hooks/useBackground";
import { DecodeDisplay } from "./DecodeDisplay";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { LoadProgressBars } from "./LoadProgressBars";
import { PileupOverlay } from "./PileupOverlay";
import { StreamingTranscriptDisplay } from "./StreamingTranscriptDisplay";
import { TrackList } from "./components/TrackList";
import {
  SettingsPage,
  type AudioSettings,
  type DecodeSettings,
} from "./components/SettingsPage";
import type { PileupTrack } from "./utils/pileupCandidates";
import {
  INFERENCE_BACKEND_OPTIONS,
  type InferenceBackend,
} from "./utils/inferenceProtocol";
import { hasMatchingOption, parseStringOption } from "./utils/optionUtils";
import {
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  type QualityPreset,
} from "./quality";
import { useI18n } from "./i18n";

type DecoderMode = "normal" | "pileup" | "benchmark";
type DecoderLanguage = "EN" | "EN/JA";

const FILTER_WIDTH_OPTIONS = [
  100,
  150,
  250,
  500,
  DEFAULT_DECODE_BANDWIDTH_HZ,
] as const;
const MODE_OPTIONS = ["normal", "pileup", "benchmark"] as const;
const QUALITY_OPTIONS: readonly QualityPreset[] = [
  "high",
  "balanced",
  "fast",
  "custom",
];
const LANGUAGE_OPTIONS: readonly DecoderLanguage[] = ["EN", "EN/JA"];
const BACKEND_OPTIONS: readonly InferenceBackend[] =
  INFERENCE_BACKEND_OPTIONS.map((option) => option.value);

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 15;
const CW_PITCH_HZ = 800;

const isValidFontSize = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= MIN_FONT_SIZE &&
  value <= MAX_FONT_SIZE;

const isValidBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

function formatHz(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz) || hz <= 0) return "—";
  return hz.toLocaleString("en-US");
}

function formatTranscriptForExport(body: string): string {
  const savedAt = new Date().toLocaleString();
  return ["DeepCW Desktop — CW transcript", `Saved: ${savedAt}`, "", body, ""].join(
    "\n",
  );
}

function defaultTranscriptFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `deepcw-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  const desktop = window.deepcwDesktop;
  if (desktop?.copyText) {
    try {
      await desktop.copyText(text);
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

type DecoderProps = {
  background: BackgroundController;
};

export const Decoder = ({ background }: DecoderProps) => {
  const { t, lang, setLang } = useI18n();

  const [mode, setMode] = usePersistedState<DecoderMode>(
    "decoder.mode",
    "normal",
    (value): value is DecoderMode => hasMatchingOption(value, MODE_OPTIONS),
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [filterFreq, setFilterFreq] = useState(DEFAULT_DECODE_CENTER_FREQ_HZ);
  const [filterWidth, setFilterWidth] = usePersistedState<number>(
    "decoder.filterWidth",
    800,
    (value): value is number => hasMatchingOption(value, FILTER_WIDTH_OPTIONS),
  );
  const [language, setLanguage] = usePersistedState<DecoderLanguage>(
    "decoder.language",
    "EN",
    (value): value is DecoderLanguage =>
      hasMatchingOption(value, LANGUAGE_OPTIONS),
  );
  const [backend, setBackend] = usePersistedState<InferenceBackend>(
    "decoder.backend",
    "standard",
    (value): value is InferenceBackend =>
      hasMatchingOption(value, BACKEND_OPTIONS),
  );
  const [decodeWindowSeconds, setDecodeWindowSeconds] =
    usePersistedState<DecodeWindowSeconds>(
      "decoder.decodeWindowSeconds",
      12,
      (value): value is DecodeWindowSeconds =>
        hasMatchingOption(value, DECODE_WINDOW_OPTIONS),
    );
  const [quality, setQuality] = usePersistedState<QualityPreset>(
    "decoder.quality",
    DEFAULT_QUALITY,
    (value): value is QualityPreset =>
      hasMatchingOption(value, QUALITY_OPTIONS),
  );

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [selectedAudioInput, _setSelectedAudioInput] =
    usePersistedState<string>(
      "decoder.selectedAudioInput",
      "",
      (value): value is string => typeof value === "string",
    );
  const [selectedAudioOutput, setSelectedAudioOutput] =
    usePersistedState<string>(
      "decoder.selectedAudioOutput",
      "",
      (value): value is string => typeof value === "string",
    );

  const [fontSize, setFontSize] = usePersistedState<number>(
    "decoder.fontSize",
    DEFAULT_FONT_SIZE,
    isValidFontSize,
  );
  const [showTimestamps, setShowTimestamps] = usePersistedState<boolean>(
    "decoder.showTimestamps",
    false,
    isValidBoolean,
  );
  const [alwaysOnTop, setAlwaysOnTop] = usePersistedState<boolean>(
    "decoder.alwaysOnTop",
    false,
    isValidBoolean,
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState<"main" | "settings">("main");
  const [appVersion, setAppVersion] = useState("0.9.3");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAudioContextRef = useRef<AudioContext | null>(null);
  const fileSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pileupTracksRef = useRef<PileupTrack[]>([]);

  const rig = useRig();
  const wsjtx = useWsjtx();

  const isPileup = mode === "pileup";
  const isBenchmark = mode === "benchmark";

  const {
    isSupported: isPassthroughSupported,
    audioOutputDevices,
    syncAudioOutputDevices,
  } = useAudioPassthrough(selectedAudioOutput, () => setSelectedAudioOutput(""));

  useFilteredPassthroughStream({
    stream,
    enabled: mode === "normal",
    selectedAudioOutput,
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
  });

  useEffect(() => {
    if (
      selectedAudioInput &&
      audioInputDevices.length > 0 &&
      !audioInputDevices.some((device) => device.deviceId === selectedAudioInput)
    ) {
      _setSelectedAudioInput("");
    }
  }, [audioInputDevices, selectedAudioInput, _setSelectedAudioInput]);

  useEffect(() => {
    if (!isBenchmark || !stream) {
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, [isBenchmark, stream]);

  const effectiveWindowSeconds = isPileup
    ? PILEUP_WINDOW_S
    : decodeWindowSeconds;
  const progressLanguage = isPileup ? "EN" : language;

  const audioBufferRef = useAudioProcessing(stream, effectiveWindowSeconds);
  const loadProgress = useLoadProgress(
    backend,
    progressLanguage,
    isPileup ? "narrow" : "standard",
    isPileup,
  );

  const {
    loaded,
    loadedJa,
    loadError: normalLoadError,
    currentText,
    currentTextTick,
    currentTextVersion,
    currentTextJa,
    currentTextJaTick,
    currentTextJaVersion,
    isDecoding,
    clearCurrentText,
  } = useDecode({
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
    stream,
    language: isPileup ? "EN" : language,
    backend,
    decodeWindowSeconds: effectiveWindowSeconds,
    audioBufferRef,
    enabled: mode === "normal",
  });

  const {
    segments: streamingSegments,
    text: streamingText,
    pendingText: streamingPendingText,
    pendingTextJa: streamingPendingTextJa,
    loadError: streamingLoadError,
    clearTranscript,
  } = useStreamingDecode({
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
    stream,
    language: isPileup ? "EN" : language,
    backend,
    enabled: mode === "normal",
  });

  const {
    tracks: pileupTracks,
    loaded: pileupDetectionLoaded,
    loadError: pileupDetectionLoadError,
  } = usePileupDetection({
    stream,
    backend,
    audioBufferRef,
    enabled: isPileup,
    minFreqHz: PILEUP_MIN_FREQ_HZ,
    maxFreqHz: PILEUP_MAX_FREQ_HZ,
  });

  useEffect(() => {
    pileupTracksRef.current = pileupTracks;
  }, [pileupTracks]);

  const {
    rows: pileupRows,
    isDecoding: isPileupDecoding,
    loaded: pileupLoaded,
    loadError: pileupLoadError,
    clearTrack: clearPileupTrack,
    clearAll: clearPileupAll,
  } = usePileupDecode({
    stream,
    backend,
    audioBufferRef,
    tracksRef: pileupTracksRef,
    enabled: isPileup,
    decodeWindowSeconds: effectiveWindowSeconds,
  });

  const applyQuality = useCallback(
    (nextQuality: QualityPreset) => {
      setQuality(nextQuality);
      if (nextQuality === "custom") {
        return;
      }
      const preset = QUALITY_PRESETS[nextQuality];
      setBackend(preset.model);
      setDecodeWindowSeconds(preset.windowSeconds);
    },
    [setBackend, setDecodeWindowSeconds, setQuality],
  );

  const refreshAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputDevices(
        devices.filter((device) => device.kind === "audioinput"),
      );
      syncAudioOutputDevices(devices);
    } catch {
      /* no media backend */
    }
  }, [syncAudioOutputDevices]);

  // Unlock device labels up-front so the input selector is usable before the
  // first decode (previously it stayed disabled until START).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((track) => track.stop());
      } catch {
        /* permission denied — the list still enumerates default devices */
      }
      if (!cancelled) {
        await refreshAudioDevices();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAudioDevices]);

  useEffect(() => {
    void window.deepcwDesktop?.info().then((info) => {
      if (info?.version) setAppVersion(info.version);
    });
  }, []);

  useEffect(() => {
    window.deepcwDesktop?.setLanguage(lang);
  }, [lang]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && view === "settings") {
        setView("main");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  const stopFilePlayback = useCallback(() => {
    const source = fileSourceRef.current;
    fileSourceRef.current = null;
    if (source) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
    }

    const audioContext = fileAudioContextRef.current;
    fileAudioContextRef.current = null;
    if (audioContext) {
      void audioContext.close().catch(() => undefined);
    }
  }, []);

  const stopAudio = useCallback(() => {
    stopFilePlayback();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
    setFileName(null);
  }, [stopFilePlayback, stream]);

  const getStream = useCallback(
    async (deviceId?: string) => {
      setAudioError(null);
      stopFilePlayback();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            sampleRate: SAMPLE_RATE,
            channelCount: 1,
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
          },
        });
        setStream(newStream);
        setFileName(null);
        await refreshAudioDevices();
      } catch (error) {
        setStream(null);
        setAudioError(
          error instanceof Error
            ? `${t("error.microphone")}: ${error.message}`
            : t("error.microphone"),
        );
      }
    },
    [refreshAudioDevices, stopFilePlayback, stream, t],
  );

  const playAudioFile = useCallback(
    async (name: string, data: ArrayBuffer) => {
      setAudioError(null);
      stopFilePlayback();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      try {
        const audioContext = new AudioContext();
        const decodedBuffer = await audioContext.decodeAudioData(data.slice(0));
        await audioContext.resume();

        const padding = Math.round(0.5 * decodedBuffer.sampleRate);
        const paddedBuffer = audioContext.createBuffer(
          1,
          decodedBuffer.length + padding * 2,
          decodedBuffer.sampleRate,
        );
        paddedBuffer.copyToChannel(decodedBuffer.getChannelData(0), 0, padding);

        const destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createBufferSource();
        source.buffer = paddedBuffer;
        source.connect(destination);

        fileAudioContextRef.current = audioContext;
        fileSourceRef.current = source;

        source.onended = () => {
          if (fileSourceRef.current !== source) {
            return;
          }
          fileSourceRef.current = null;
          setStream(null);
          setFileName(null);
          void audioContext.close().catch(() => undefined);
          fileAudioContextRef.current = null;
        };

        setFileName(name);
        setStream(destination.stream);
        source.start();
      } catch (error) {
        stopFilePlayback();
        setStream(null);
        setFileName(null);
        setAudioError(
          error instanceof Error
            ? `${t("error.audioFile")}: ${error.message}`
            : t("error.audioFile"),
        );
      }
    },
    [stopFilePlayback, stream, t],
  );

  const openAudioFile = useCallback(async () => {
    const desktop = window.deepcwDesktop;
    if (desktop?.openAudioFile) {
      const file = await desktop.openAudioFile();
      if (file) {
        await playAudioFile(file.name, file.data);
      }
      return;
    }
    fileInputRef.current?.click();
  }, [playAudioFile]);

  const handleSelectInput = useCallback(
    (deviceId: string) => {
      _setSelectedAudioInput(deviceId);
      if (stream && fileName == null) {
        void getStream(deviceId || undefined);
      }
    },
    [_setSelectedAudioInput, fileName, getStream, stream],
  );

  const loadError = isPileup
    ? (pileupDetectionLoadError ?? pileupLoadError)
    : isBenchmark
      ? null
      : (normalLoadError ?? streamingLoadError);
  const isLoading = isPileup
    ? !pileupLoaded || !pileupDetectionLoaded
    : isBenchmark
      ? false
      : !loaded || (language === "EN/JA" && !loadedJa);
  const showJapaneseDisplay = mode === "normal" && language === "EN/JA";
  const isRunning = stream != null;
  const scopeHeight = isPileup ? 316 : 252;

  const dialHz = rig.status.frequency;
  const audioOffsetHz = filterFreq;
  const signalHz = dialHz != null ? dialHz + audioOffsetHz : null;

  const transcriptBody = [streamingText, streamingPendingText]
    .filter(Boolean)
    .join(" ")
    .trim();
  const hasTranscript = transcriptBody.length > 0 || currentText.length > 0;

  const markCopied = useCallback(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, []);

  const pileupExportText = pileupRows
    .filter((row) => row.text)
    .map((row) => `${row.frequency} Hz\t${row.text}`)
    .join("\n");

  const handleClear = useCallback(() => {
    if (isPileup) {
      clearPileupAll();
      setSavedPath(null);
      if (wsjtx.config.enabled) {
        wsjtx.sendClear();
      }
      return;
    }
    clearTranscript();
    clearCurrentText();
    setSavedPath(null);
    if (wsjtx.config.enabled) {
      wsjtx.sendClear();
    }
  }, [clearCurrentText, clearPileupAll, clearTranscript, isPileup, wsjtx]);

  const handleCopy = useCallback(async () => {
    const textToCopy = isPileup
      ? pileupExportText
      : [streamingText, streamingPendingText].filter(Boolean).join(" ").trim();
    if (!textToCopy) return;
    await copyToClipboard(textToCopy);
    markCopied();
  }, [isPileup, markCopied, pileupExportText, streamingPendingText, streamingText]);

  const handleSave = useCallback(async () => {
    const body = formatTranscriptForExport(
      isPileup
        ? pileupExportText
        : [streamingText, streamingPendingText].filter(Boolean).join(" ").trim(),
    );
    const desktop = window.deepcwDesktop;

    if (desktop?.saveTextFile) {
      const path = await desktop.saveTextFile(body, defaultTranscriptFileName());
      if (path) setSavedPath(path);
      return;
    }

    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultTranscriptFileName();
    anchor.click();
    URL.revokeObjectURL(url);
  }, [isPileup, pileupExportText, streamingPendingText, streamingText]);

  const handleStop = useCallback(() => {
    stopAudio();
  }, [stopAudio]);

  const handleStart = useCallback(() => {
    void getStream(selectedAudioInput || undefined);
  }, [getStream, selectedAudioInput]);

  const handleQsy = useCallback(() => {
    if (signalHz == null || !rig.status.connected) return;
    void rig.setFrequency(Math.max(0, Math.round(signalHz - CW_PITCH_HZ)));
    setFilterFreq(CW_PITCH_HZ);
  }, [rig, signalHz]);

  const handleQsyTrack = useCallback(
    (audioFrequency: number) => {
      if (dialHz == null || !rig.status.connected) return;
      const target = dialHz + audioFrequency - CW_PITCH_HZ;
      void rig.setFrequency(Math.max(0, Math.round(target)));
      setFilterFreq(CW_PITCH_HZ);
    },
    [dialHz, rig],
  );

  const actionsRef = useRef<Record<string, () => void>>({});
  actionsRef.current = {
    clear: handleClear,
    copy: () => {
      void handleCopy();
    },
    save: () => {
      void handleSave();
    },
    "open-file": () => {
      void openAudioFile();
    },
    settings: () => setView("settings"),
    "toggle-decode": () => {
      if (isRunning) {
        handleStop();
      } else {
        handleStart();
      }
    },
    "top-on": () => setAlwaysOnTop(true),
    "top-off": () => setAlwaysOnTop(false),
  };

  useEffect(() => {
    const desktop = window.deepcwDesktop;
    if (!desktop?.onMenuAction) return;
    return desktop.onMenuAction((action) => actionsRef.current[action]?.());
  }, []);

  useEffect(() => {
    void window.deepcwDesktop?.setAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop]);

  useEffect(() => {
    void window.deepcwDesktop?.setAwake(isRunning);
  }, [isRunning]);

  useEffect(() => {
    document.title = isRunning
      ? `DeepCW Desktop — ${t("common.receiving")}`
      : "DeepCW Desktop";
  }, [isRunning, t]);

  // Broadcast our dial frequency to N1MM / WSJT-X listeners.
  useEffect(() => {
    if (!wsjtx.config.enabled) return;
    const tick = () => {
      if (dialHz == null) return;
      wsjtx.sendStatus({
        dialFrequency: dialHz,
        mode: "CW",
        rxDF: audioOffsetHz,
        txDF: audioOffsetHz,
        decoding: isRunning,
        subMode: "CW",
      });
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [audioOffsetHz, dialHz, isRunning, wsjtx]);

  const lastSentSegmentRef = useRef(0);
  useEffect(() => {
    if (!wsjtx.config.enabled) return;
    for (const segment of streamingSegments) {
      if (segment.id <= lastSentSegmentRef.current) continue;
      lastSentSegmentRef.current = segment.id;
      const text = segment.en?.text?.trim();
      if (!text) continue;
      wsjtx.sendDecode({
        message: text,
        deltaFrequency: segment.filterFreq ?? audioOffsetHz,
        mode: "CW",
        snr: 0,
      });
    }
  }, [audioOffsetHz, streamingSegments, wsjtx]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => playAudioFile(file.name, buffer));
    },
    [playAudioFile],
  );

  const decodeSettings: DecodeSettings = {
    quality,
    setQuality: applyQuality,
    model: backend,
    setModel: setBackend,
    windowSeconds: decodeWindowSeconds,
    setWindowSeconds: (seconds) =>
      setDecodeWindowSeconds(seconds as DecodeWindowSeconds),
    bandwidth: filterWidth,
    setBandwidth: setFilterWidth,
    bandwidthOptions: FILTER_WIDTH_OPTIONS,
    language,
    setLanguage,
    timestamps: showTimestamps,
    setTimestamps: setShowTimestamps,
    fontSize,
    setFontSize,
  };

  const audioSettings: AudioSettings = {
    inputDevices: audioInputDevices.map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Device ${index + 1}`,
    })),
    selectedInput: selectedAudioInput,
    onSelectInput: handleSelectInput,
    outputDevices: audioOutputDevices.map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Device ${index + 1}`,
    })),
    selectedOutput: selectedAudioOutput,
    onSelectOutput: setSelectedAudioOutput,
    onRefreshDevices: () => {
      void refreshAudioDevices();
    },
    showOutput: isPassthroughSupported,
  };

  if (view === "settings") {
    return (
      <div style={{ height: "100%", minHeight: 0 }}>
        <SettingsPage
          onClose={() => setView("main")}
          decode={decodeSettings}
          audio={audioSettings}
          background={background}
          rig={rig}
          wsjtx={wsjtx}
          onOpenDataFolder={() => {
            void window.deepcwDesktop?.openDataFolder();
          }}
          onResetSettings={() => {
            try {
              window.localStorage.clear();
            } catch {
              /* ignore */
            }
            void window.deepcwDesktop?.background.clear();
            window.location.reload();
          }}
          version={appVersion}
        />
      </div>
    );
  }

  const statusText = isRunning
    ? isLoading
      ? t("common.loading")
      : t("common.receiving")
    : t("common.idle");

  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        minHeight: 0,
        padding: 10,
        boxSizing: "border-box",
        outline: isDragging ? "2px dashed var(--dcw-accent)" : undefined,
        outlineOffset: -6,
      }}
    >
      <div className="dcw-header">
        <Group gap={8} wrap="nowrap">
          <img
            src="./icon.svg"
            alt=""
            width={26}
            height={26}
            style={{ borderRadius: 4, display: "block" }}
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1 }}>
              DeepCW
            </div>
            <div className="dcw-label">{t("app.tagline")}</div>
          </div>
        </Group>

        <div className="dcw-sep" />

        <Button
          size="sm"
          w={92}
          color={isRunning ? "red" : "accent"}
          variant={isRunning ? "default" : "filled"}
          onClick={isRunning ? handleStop : handleStart}
        >
          {isRunning ? t("main.stop") : t("main.start")}
        </Button>

        <NativeSelect
          size="xs"
          w={130}
          value={mode}
          onChange={(event) => {
            const nextMode = parseStringOption(
              event.currentTarget.value,
              MODE_OPTIONS,
            );
            if (nextMode !== undefined) setMode(nextMode);
          }}
          data={[
            { value: "normal", label: t("mode.normal") },
            { value: "pileup", label: t("mode.pileup") },
            { value: "benchmark", label: t("mode.benchmark") },
          ]}
        />

        <div className="dcw-sep" />

        <Group gap={14} wrap="nowrap">
          <div className="dcw-group dcw-header-dial">
            <span className="dcw-label">{t("header.dial")}</span>
            <span className="dcw-readout">{formatHz(dialHz)}</span>
          </div>
          <div className="dcw-group">
            <span className="dcw-label">{t("header.audio")}</span>
            <span className="dcw-readout">{filterFreq} Hz</span>
          </div>
          <div className="dcw-group dcw-header-sig">
            <span className="dcw-label">{t("header.sig")}</span>
            <span className="dcw-readout">{formatHz(signalHz)}</span>
          </div>
          <Tooltip label={t("header.qsyTip")}>
            <Button
              size="compact-xs"
              variant="default"
              disabled={!rig.status.connected || signalHz == null}
              onClick={handleQsy}
            >
              {t("header.qsy")}
            </Button>
          </Tooltip>
        </Group>

        <Box style={{ flex: 1, minWidth: 12 }} />

        <Box className="dcw-header-progress" style={{ width: 150 }}>
          <LoadProgressBars progress={loadProgress} />
        </Box>

        <Tooltip label={t("toolbar.fileTip")}>
          <Button
            size="compact-sm"
            variant="default"
            aria-label={t("common.file")}
            onClick={() => void openAudioFile()}
            style={{ display: isPileup ? undefined : "none" }}
          >
            {t("common.file")}
          </Button>
        </Tooltip>

        <Group gap={6} wrap="nowrap">
          <span
            className={`dcw-led ${
              isRunning ? "dcw-led--on" : isLoading ? "dcw-led--warn" : ""
            }`}
          />
          <span className="dcw-label" style={{ minWidth: 46 }}>
            {statusText}
          </span>
        </Group>

        <Button
          size="compact-xs"
          variant="default"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
          title={t("header.language")}
        >
          {lang === "zh" ? "中文" : "EN"}
        </Button>

        <Tooltip label={`${t("common.settings")} (Ctrl+,)`}>
          <Button
            size="compact-sm"
            variant="default"
            aria-label="Settings"
            onClick={() => setView("settings")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 7h9M17 7h3M4 17h5M13 17h7" />
              <circle cx="15" cy="7" r="2.1" />
              <circle cx="11" cy="17" r="2.1" />
            </svg>
          </Button>
        </Tooltip>
      </div>

      {isBenchmark ? (
        <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <BenchmarkPanel />
        </Box>
      ) : (
        <>
          {stream ? (
            <Box style={{ position: "relative" }}>
              <Scope
                stream={stream}
                setFilterFreq={setFilterFreq}
                filterFreq={isPileup ? null : filterFreq}
                filterWidth={filterWidth}
                decodeWindowSeconds={effectiveWindowSeconds}
                disableInteraction={isPileup}
                height={scopeHeight}
                brightness={isPileup ? 0.75 : 1}
                maxDevicePixelRatio={isPileup ? 1.25 : undefined}
                {...(isPileup && {
                  minFreqHz: PILEUP_MIN_FREQ_HZ,
                  maxFreqHz: PILEUP_MAX_FREQ_HZ,
                })}
              />
              {isPileup && (
                <PileupOverlay
                  tracks={pileupTracks}
                  minFreqHz={PILEUP_MIN_FREQ_HZ}
                  maxFreqHz={PILEUP_MAX_FREQ_HZ}
                />
              )}
            </Box>
          ) : (
            <Box
              className="dcw-scope"
              style={{
                height: scopeHeight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <Text size="sm" c="dimmed" fw={600}>
                {t("main.noInputTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("main.noInputHint")}
              </Text>
            </Box>
          )}

          {isPileup ? (
            <TrackList
              rows={pileupRows}
              isDecoding={isPileupDecoding}
              dialHz={dialHz}
              canQsy={rig.status.connected}
              onQsy={handleQsyTrack}
              onCopy={(text) => {
                void copyToClipboard(text);
              }}
              onClearRow={clearPileupTrack}
              onClearAll={clearPileupAll}
              grow
            />
          ) : (
          <div
            className="dcw-panel"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {!isPileup && (
              <Box px={10} pt={4}>
                <DecodeDisplay
                  text={currentText}
                  isDecoding={isDecoding}
                  decodeWindowSeconds={decodeWindowSeconds}
                  animationTick={currentTextTick}
                  animationVersion={currentTextVersion}
                  fontSize={20}
                  height={30}
                />
                {showJapaneseDisplay && (
                  <DecodeDisplay
                    text={currentTextJa}
                    isDecoding={isDecoding}
                    backgroundColor="#2a0a1c"
                    decodeWindowSeconds={decodeWindowSeconds}
                    animationTick={currentTextJaTick}
                    animationVersion={currentTextJaVersion}
                    fontSize={18}
                    height={28}
                  />
                )}
              </Box>
            )}

            <Flex
              gap={4}
              wrap="wrap"
              align="center"
              px={10}
              py={6}
              style={{ borderBottom: "1px solid var(--dcw-border)" }}
            >
              <Button
                size="compact-xs"
                variant="default"
                onClick={handleClear}
                disabled={!hasTranscript}
                title={t("toolbar.clearTip")}
              >
                {t("common.clear")}
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => void handleCopy()}
                disabled={!hasTranscript}
                title={t("toolbar.copyTip")}
              >
                {copied ? t("common.copyDone") : t("common.copy")}
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => void handleSave()}
                disabled={!hasTranscript}
                title={t("toolbar.saveTip")}
              >
                {t("common.save")}
              </Button>
              <div className="dcw-sep" style={{ height: 18 }} />
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => void openAudioFile()}
                title={t("toolbar.fileTip")}
              >
                {t("common.file")}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() =>
                  setFontSize((value) => Math.max(MIN_FONT_SIZE, value - 1))
                }
                disabled={fontSize <= MIN_FONT_SIZE}
                title={t("toolbar.fontDown")}
              >
                A-
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() =>
                  setFontSize((value) => Math.min(MAX_FONT_SIZE, value + 1))
                }
                disabled={fontSize >= MAX_FONT_SIZE}
                title={t("toolbar.fontUp")}
              >
                A+
              </Button>
              <Button
                size="compact-xs"
                variant={showTimestamps ? "filled" : "subtle"}
                color={showTimestamps ? "accent" : "gray"}
                onClick={() => setShowTimestamps((value) => !value)}
                title={t("toolbar.tsTip")}
              >
                TS
              </Button>
              <Button
                size="compact-xs"
                variant={alwaysOnTop ? "filled" : "subtle"}
                color={alwaysOnTop ? "accent" : "gray"}
                onClick={() => setAlwaysOnTop((value) => !value)}
                title={t("toolbar.topTip")}
              >
                TOP
              </Button>
              <Box style={{ flex: 1 }} />
              {(fileName || savedPath) && (
                <Text size="xs" c="dimmed" truncate style={{ maxWidth: 320 }}>
                  {fileName
                    ? `${t("main.fileLabel")}: ${fileName}`
                    : `${t("main.savedLabel")}: ${savedPath}`}
                </Text>
              )}
            </Flex>

            <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
              <StreamingTranscriptDisplay
                segments={streamingSegments}
                pendingText={streamingPendingText}
                variant="en"
                backgroundColor="transparent"
                backend={backend}
                fontSize={fontSize}
                showTimestamps={showTimestamps}
                placeholder={t("main.placeholder")}
                fill
              />
              {showJapaneseDisplay && (
                <StreamingTranscriptDisplay
                  segments={streamingSegments}
                  pendingText={streamingPendingTextJa}
                  variant="ja"
                  backgroundColor="#2a0a1c"
                  backend={backend}
                  fontSize={fontSize}
                  showTimestamps={showTimestamps}
                  enableRedecodePopup
                />
              )}
            </Stack>
          </div>
          )}
        </>
      )}

      {(loadError || audioError) && (
        <Box className="dcw-panel" px={10} py={6}>
          <Text size="xs" c="red.4">
            {loadError ?? audioError}
          </Text>
        </Box>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.opus"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void file
            .arrayBuffer()
            .then((buffer) => playAudioFile(file.name, buffer));
        }}
      />
    </div>
  );
};
