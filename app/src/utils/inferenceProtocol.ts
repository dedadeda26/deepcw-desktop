export type Lang = "en" | "ja";
export type EnglishModelVariant = "standard" | "narrow";
export type ModelKey =
  | "en"
  | "en_narrow"
  | "ja"
  | "cw_detect";
export type InferenceDecodeMode = "display" | "plain" | "detailed";
export type InferenceWordSpaceSpan = {
  startFrame: number;
  endFrame: number;
};
export type InferenceCharacterSpan = {
  char: string;
  startFrame: number;
  endFrame: number;
};

/**
 * The DeepCW engine ships two model sizes. "standard" is the high-accuracy
 * model, "tiny" is the smaller/faster one.
 */
export type InferenceBackend = "standard" | "tiny";
export type LoadProgressStage = "ort" | "model";

export const INFERENCE_BACKEND_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "tiny", label: "Tiny" },
] as const;
export const MODEL_KEYS: readonly ModelKey[] = [
  "en",
  "en_narrow",
  "ja",
  "cw_detect",
] as const;

export function getModelKey(
  lang: Lang,
  englishModelVariant: EnglishModelVariant = "standard",
): ModelKey {
  if (lang === "ja") {
    return "ja";
  }

  if (englishModelVariant === "narrow") {
    return "en_narrow";
  }

  return "en";
}

type RequestBase = {
  type: string;
  backend: InferenceBackend;
};

export type WorkerRequestPayload =
  | (RequestBase & {
      type: "loadModel";
      lang: Lang;
      englishModelVariant: EnglishModelVariant;
      modelSize: InferenceBackend;
      modelData: Uint8Array;
    })
  | (RequestBase & {
      type: "loadCwDetectionModel";
      modelData: Uint8Array;
    })
  | (RequestBase & {
      type: "resetCwDetectionState";
      trackerId?: number;
    })
  | (RequestBase & {
      type: "runInference";
      lang: Lang;
      modelSize: InferenceBackend;
      audioBuffer: Float32Array;
      filterFreq: number | null;
      filterWidth: number;
      shiftTargetFreq?: number;
      englishModelVariant: EnglishModelVariant;
      decodeMode: InferenceDecodeMode;
    })
  | (RequestBase & {
      type: "runMultiInference";
      modelSize: InferenceBackend;
      audioBuffer: Float32Array;
      tracks: { id: number; frequency: number }[];
    })
  | (RequestBase & {
      type: "detectCwBins";
      audioBuffer: Float32Array;
      minFreqHz: number;
      maxFreqHz: number;
      trackerId: number;
    });

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type WorkerResponse =
  | {
      id: number;
      type: "loadProgress";
      stage: LoadProgressStage;
      modelId?: number;
      progress: number;
    }
  | { id: number; type: "modelLoaded" }
  | { id: number; type: "stateReset" }
  | {
      id: number;
      type: "inferenceResult";
      text: string;
      plainText?: string;
      wordSpaceSpans?: InferenceWordSpaceSpan[];
      characterSpans?: InferenceCharacterSpan[];
    }
  | {
      id: number;
      type: "multiInferenceResult";
      textMap: Record<number, string>;
      plainTextMap?: Record<number, string>;
      confidenceMap?: Record<number, number[]>;
      copyRangeMap?: Record<number, unknown>;
    }
  | {
      id: number;
      type: "cwDetectionResult";
      tracks: { id: number; frequency: number }[];
      probabilityBins: { frequency: number; probability: number }[];
    }
  | { id: number; type: "error"; error: string };
