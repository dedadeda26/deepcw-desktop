import type { InferenceBackend } from "./utils/inferenceProtocol";

export type QualityPreset = "high" | "balanced" | "fast" | "custom";

export type QualityDefinition = {
  label: string;
  description: string;
  model: InferenceBackend;
  windowSeconds: 6 | 12 | 18 | 30;
};

export const QUALITY_PRESETS: Record<
  Exclude<QualityPreset, "custom">,
  QualityDefinition
> = {
  high: {
    label: "High",
    description: "Standard model, 18 s window — best weak-signal copy (default)",
    model: "standard",
    windowSeconds: 18,
  },
  balanced: {
    label: "Balanced",
    description: "Standard model, 12 s window — lower latency, still excellent",
    model: "standard",
    windowSeconds: 12,
  },
  fast: {
    label: "Fast",
    description: "Tiny model, 12 s window — lightest CPU load",
    model: "tiny",
    windowSeconds: 12,
  },
};

export const DEFAULT_QUALITY: QualityPreset = "balanced";
