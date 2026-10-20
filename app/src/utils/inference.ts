import type {
  InferenceCharacterSpan,
  EnglishModelVariant,
  InferenceDecodeMode,
  InferenceBackend,
  InferenceWordSpaceSpan,
  Lang,
  ModelKey,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerResponse,
} from "./inferenceProtocol";
import { MODEL_KEYS, getModelKey } from "./inferenceProtocol";

/**
 * Thin client for the official DeepCW WASM inference worker.
 *
 * The worker itself (`/engine/inferenceWorker.js`) is the engine bundle that
 * ships with the DeepCW web application. It owns the model containers
 * (`/models/<sha256>.onnx`), the feature extraction and the CTC decoder, so the
 * UI only has to feed it 9600 Hz mono float audio and render the returned text.
 */

type FinalWorkerResponse = Exclude<WorkerResponse, { type: "loadProgress" }>;

type PendingRequest = {
  resolve: (response: FinalWorkerResponse) => void;
  reject: (error: Error) => void;
};

export type DetailedInferenceResult = {
  displayText: string;
  plainText: string;
  wordSpaceSpans: InferenceWordSpaceSpan[];
  characterSpans: InferenceCharacterSpan[];
};

export type BackendLoadProgress = {
  ort: number;
  model: Record<ModelKey, number>;
};

export type CwDetectionCandidate = {
  id: number;
  frequency: number;
  snrDb: number;
};

type RunInferenceOptions = {
  lang?: Lang;
  backend?: InferenceBackend;
  shiftTargetFreq?: number;
  englishModelVariant?: EnglishModelVariant;
  decodeMode?: InferenceDecodeMode;
};

/**
 * Model ids as returned by the engine's model selector:
 *   0 = JA standard   1 = EN narrow standard   2 = CW detection
 *   3 = EN standard   4 = JA tiny              5 = EN narrow tiny
 *   6 = EN tiny
 * The sha256 file names are the exact payloads the web app downloads.
 */
const MODEL_FILES: Record<number, string> = {
  0: "65c7d03ac703f283aacf1e169e169ecb0ece888a74d0ace77455acc8d2cb08b6",
  1: "b26c51681289a23c0e7c6759929ec3569d94ed326bca913e9ffde446604411ca",
  2: "1b693d4551fcfbfbd6878f650234b2d5f357efcd5095a2c213cd70bfb72d983e",
  3: "10e8afb767c288f6cab1346ed9e0b6563c5809464dbf5e0407f0340cf272cb60",
  4: "cfc70990648f5c5121ebaa1b3c79d480f512167d7ca8dfb7b38b40547ba31067",
  5: "8c945257ea8f57361335d10d67d796acc9c42ea75a88032a899e55e50d7679f4",
  6: "b329de21e6c4c103c883c841221485edfb2a2fbeaf03d810bbb11bec68951001",
};

const DETECTION_MODEL_FILE = MODEL_FILES[2];

function getModelId(
  lang: Lang,
  englishModelVariant: EnglishModelVariant,
  modelSize: InferenceBackend,
): number {
  if (lang === "ja") {
    return modelSize === "tiny" ? 4 : 0;
  }
  if (englishModelVariant === "narrow") {
    return modelSize === "tiny" ? 5 : 1;
  }
  return modelSize === "tiny" ? 6 : 3;
}

let inferenceWorker: Worker | null = null;
let nextRequestId = 1;

function createModelKeyRecord<T>(createValue: () => T): Record<ModelKey, T> {
  return Object.fromEntries(
    MODEL_KEYS.map((modelKey) => [modelKey, createValue()]),
  ) as Record<ModelKey, T>;
}

const modelLoadPromises: Record<InferenceBackend, Map<number, Promise<void>>> = {
  standard: new Map(),
  tiny: new Map(),
};

const modelBytesCache = new Map<string, Uint8Array>();
const pendingRequests = new Map<number, PendingRequest>();
const progressSubscribers = new Set<() => void>();
const loadProgressState: Record<InferenceBackend, BackendLoadProgress> = {
  standard: { ort: 0, model: createModelKeyRecord(() => 0) },
  tiny: { ort: 0, model: createModelKeyRecord(() => 0) },
};

function notifyProgressSubscribers(): void {
  progressSubscribers.forEach((listener) => {
    listener();
  });
}

function setLoadProgress(
  backend: InferenceBackend,
  stage: "ort" | "model",
  progress: number,
  modelKey?: ModelKey,
): void {
  const nextProgress = Math.max(0, Math.min(progress, 1));
  const backendProgress = loadProgressState[backend];

  if (stage === "ort") {
    if (backendProgress.ort === nextProgress) return;
    backendProgress.ort = nextProgress;
    notifyProgressSubscribers();
    return;
  }

  if (!modelKey) return;
  if (backendProgress.model[modelKey] === nextProgress) return;
  backendProgress.model[modelKey] = nextProgress;
  notifyProgressSubscribers();
}

export function getLoadProgressSnapshot(
  backend: InferenceBackend,
): BackendLoadProgress {
  const progress = loadProgressState[backend];

  return {
    ort: progress.ort,
    model: { ...progress.model },
  };
}

export function subscribeToLoadProgress(listener: () => void): () => void {
  progressSubscribers.add(listener);

  return () => {
    progressSubscribers.delete(listener);
  };
}

function resetWorker(message: string): void {
  inferenceWorker?.terminate();
  inferenceWorker = null;

  modelLoadPromises.standard.clear();
  modelLoadPromises.tiny.clear();

  pendingRequests.forEach(({ reject }) => {
    reject(new Error(message));
  });
  pendingRequests.clear();

  loadProgressState.standard.ort = 0;
  loadProgressState.tiny.ort = 0;
  MODEL_KEYS.forEach((modelKey) => {
    loadProgressState.standard.model[modelKey] = 0;
    loadProgressState.tiny.model[modelKey] = 0;
  });
  notifyProgressSubscribers();
}

function getWorker(): Worker {
  if (inferenceWorker) return inferenceWorker;

  inferenceWorker = new Worker(
    new URL("/engine/inferenceWorker.js", globalThis.location.origin),
    { type: "module" },
  );

  inferenceWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;

    if (message.type === "loadProgress") {
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) return;

    pendingRequests.delete(message.id);

    if (message.type === "error") {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message);
  };

  inferenceWorker.onerror = (event: ErrorEvent) => {
    resetWorker(event.message || "Inference worker crashed.");
  };

  return inferenceWorker;
}

let requestChain: Promise<unknown> = Promise.resolve();

/**
 * The engine is a single WASM instance, so requests are serialised: running two
 * decodes concurrently corrupts the shared model state.
 */
function sendMessage(
  request: WorkerRequestPayload,
  transfer?: Transferable[],
) {
  const run = requestChain.then(() => {
    const worker = getWorker();
    const requestId = nextRequestId++;
    const message = { ...request, id: requestId } as WorkerRequest;

    return new Promise<FinalWorkerResponse>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
      worker.postMessage(message, transfer ?? []);
    });
  });

  requestChain = run.catch(() => undefined);

  return run;
}

function reportModelProgress(
  backend: InferenceBackend,
  modelKey: ModelKey,
  progress: number,
): void {
  setLoadProgress(backend, "model", progress, modelKey);
}

async function fetchModelBytes(
  fileName: string,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> {
  const cached = modelBytesCache.get(fileName);
  if (cached) {
    onProgress?.(1);
    return cached;
  }

  const response = await fetch(`/models/${fileName}.onnx`);
  if (!response.ok) {
    throw new Error(`E 3001 (model HTTP ${response.status})`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? "0");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    modelBytesCache.set(fileName, bytes);
    onProgress?.(1);
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    if (totalBytes > 0) {
      onProgress?.(Math.min(received / totalBytes, 0.99));
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  modelBytesCache.set(fileName, bytes);
  onProgress?.(1);
  return bytes;
}

export async function loadModel(
  lang: Lang = "en",
  backend: InferenceBackend = "standard",
  englishModelVariant: EnglishModelVariant = "standard",
): Promise<void> {
  const modelId = getModelId(lang, englishModelVariant, backend);
  const modelKey = getModelKey(lang, englishModelVariant);
  const promises = modelLoadPromises[backend];
  const cachedPromise = promises.get(modelId);
  if (cachedPromise) {
    return cachedPromise;
  }

  const promise = (async () => {
    const modelBytes = await fetchModelBytes(MODEL_FILES[modelId], (progress) =>
      reportModelProgress(backend, modelKey, progress * 0.5),
    );

    await sendMessage({
      type: "loadModel",
      lang,
      backend,
      englishModelVariant,
      modelSize: backend,
      modelData: modelBytes,
    });

    setLoadProgress(backend, "ort", 1);
    reportModelProgress(backend, modelKey, 1);
  })().catch((error) => {
    promises.delete(modelId);
    throw error;
  });

  promises.set(modelId, promise);

  return promise;
}

export async function loadCwDetectionModel(
  backend: InferenceBackend = "standard",
): Promise<void> {
  const modelKey: ModelKey = "cw_detect";
  const promises = modelLoadPromises[backend];
  const cachedPromise = promises.get(2);
  if (cachedPromise) return cachedPromise;

  const promise = (async () => {
    const modelBytes = await fetchModelBytes(DETECTION_MODEL_FILE, (progress) =>
      reportModelProgress(backend, modelKey, progress),
    );

    await sendMessage({
      type: "loadCwDetectionModel",
      backend,
      modelData: modelBytes,
    });

    setLoadProgress(backend, "ort", 1);
    reportModelProgress(backend, modelKey, 1);
  })().catch((error) => {
    promises.delete(2);
    throw error;
  });

  promises.set(2, promise);

  return promise;
}

async function requestInference(
  audioBuffer: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
  options: RunInferenceOptions = {},
): Promise<WorkerResponse | null> {
  const {
    lang = "en",
    backend = "standard",
    shiftTargetFreq,
    englishModelVariant = "standard",
    decodeMode = "display",
  } = options;

  try {
    await loadModel(lang, backend, englishModelVariant);
  } catch (error) {
    console.error("Failed to load inference model", error);
    throw error;
  }

  const audioCopy = audioBuffer.slice();

  try {
    return await sendMessage(
      {
        type: "runInference",
        lang,
        backend,
        audioBuffer: audioCopy,
        filterFreq,
        filterWidth,
        shiftTargetFreq,
        englishModelVariant,
        modelSize: backend,
        decodeMode,
      },
      [audioCopy.buffer],
    );
  } catch (error) {
    console.error("Inference worker error", error);
    throw error;
  }
}

export async function runInference(
  audioBuffer: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
  options: RunInferenceOptions = {},
): Promise<string> {
  const response = await requestInference(audioBuffer, filterFreq, filterWidth, {
    ...options,
    decodeMode: "display",
  });

  return (response?.type === "inferenceResult" ? response.text : "") ?? "";
}

export async function runInferencePlain(
  audioBuffer: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
  options: RunInferenceOptions = {},
): Promise<string> {
  const response = await requestInference(audioBuffer, filterFreq, filterWidth, {
    ...options,
    decodeMode: "plain",
  });

  return (response?.type === "inferenceResult" ? response.text : "") ?? "";
}

export async function runInferenceDetailed(
  audioBuffer: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
  options: RunInferenceOptions = {},
): Promise<DetailedInferenceResult> {
  const response = await requestInference(audioBuffer, filterFreq, filterWidth, {
    ...options,
    decodeMode: "detailed",
  });

  if (response?.type !== "inferenceResult") {
    return {
      displayText: "",
      plainText: "",
      wordSpaceSpans: [],
      characterSpans: [],
    };
  }

  return {
    displayText: response.text ?? "",
    plainText: response.plainText ?? response.text ?? "",
    wordSpaceSpans: response.wordSpaceSpans ?? [],
    characterSpans: response.characterSpans ?? [],
  };
}

export async function runPileupInference(
  audioBuffer: Float32Array,
  tracks: { id: number; frequency: number }[],
  backend: InferenceBackend = "standard",
): Promise<Record<number, string>> {
  if (tracks.length === 0) {
    return {};
  }

  try {
    await loadModel("en", backend, "narrow");
    const audioCopy = audioBuffer.slice();
    const response = await sendMessage(
      {
        type: "runMultiInference",
        backend,
        audioBuffer: audioCopy,
        tracks,
        modelSize: backend,
      },
      [audioCopy.buffer],
    );

    if (response.type === "multiInferenceResult") {
      // Prefer the compact text: displayText pads characters to their time
      // slots, which looks broken in a one-line list row.
      return response.plainTextMap ?? response.textMap ?? {};
    }
  } catch (error) {
    console.error("Pileup inference error", error);
  }

  return {};
}

export async function detectCwBins(
  audioBuffer: Float32Array,
  backend: InferenceBackend = "standard",
  minFreqHz: number,
  maxFreqHz: number,
  _lockSnrThresholdDb = 0,
  _releaseSnrThresholdDb = 0,
  _lockedFrequencies: number[] = [],
  trackerId = 1,
): Promise<CwDetectionCandidate[]> {
  try {
    await loadCwDetectionModel(backend);
  } catch (error) {
    console.error("Failed to load CW detection model", error);
    return [];
  }

  const audioCopy = audioBuffer.slice();

  try {
    const response = await sendMessage(
      {
        type: "detectCwBins",
        backend,
        audioBuffer: audioCopy,
        minFreqHz,
        maxFreqHz,
        trackerId,
      },
      [audioCopy.buffer],
    );

    if (response.type === "cwDetectionResult") {
      return response.tracks.map((track) => ({
        id: track.id,
        frequency: track.frequency,
        snrDb: 0,
      }));
    }
  } catch (error) {
    console.error("CW detection error", error);
  }

  return [];
}

export async function resetCwDetectionState(
  backend: InferenceBackend = "standard",
  trackerId = 1,
): Promise<void> {
  try {
    await sendMessage({
      type: "resetCwDetectionState",
      backend,
      trackerId,
    });
  } catch {
    /* ignore */
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetWorker("Inference worker reloaded.");
  });
}
