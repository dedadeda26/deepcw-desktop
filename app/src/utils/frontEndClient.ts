import {
  applyFrontEnd,
  buildFrontEndJob,
  publishFrontEndStatus,
  type FrontEndJob,
  type FrontEndStatus,
} from "./cwFilter";

/**
 * Off-thread driver for the DSP front end.
 *
 * Why a worker: `CwFrontEnd.processOfflineStable()` needs roughly 50 ms per
 * 12 s block (two passes) and up to 300 ms for a 30 s window. On the renderer
 * thread that is visible as a stuttering waterfall, and the decode loop calls
 * it several times per cycle (EN + JA, plus the streaming tail). Everything
 * here is therefore async; the synchronous path only remains as a fallback for
 * environments without module workers.
 *
 * The last result is memoised per input array: the EN and JA passes of one
 * decode cycle hand in the *same* Float32Array, so the filter runs once.
 */

type Waiter = {
  resolve: (value: { audio: Float32Array; status: FrontEndStatus }) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const waiters = new Map<number, Waiter>();

/** key = input array (weakly held), value = signature + the block produced. */
const cache = new WeakMap<
  Float32Array,
  { signature: string; audio: Float32Array; status: FrontEndStatus }
>();

function signatureOf(job: FrontEndJob, length: number): string {
  const o = job.options;
  return [
    length,
    o.fs ?? 9600,
    o.profile ?? "",
    o.searchHz?.join(",") ?? "",
    o.adaptBand ? 1 : 0,
    o.humEnabled ? 1 : 0,
    o.notchEnabled ? 1 : 0,
    o.forceEngage ? 1 : 0,
    o.bandHz ?? "",
  ].join("|");
}

function remember(
  source: Float32Array,
  signature: string,
  audio: Float32Array,
  status: FrontEndStatus,
) {
  cache.set(source, { signature, audio, status });
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    // Vite rewrites this into a separate chunk at build time.
    worker = new Worker(new URL("./frontEndWorker.ts", import.meta.url), {
      type: "module",
      name: "deepcw-front-end",
    });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        audio?: Float32Array;
        status?: FrontEndStatus;
        error?: string;
      }>,
    ) => {
      const message = event.data;
      const waiter = waiters.get(message.id);
      if (!waiter) return;
      waiters.delete(message.id);

      if (message.error || !message.audio || !message.status) {
        waiter.reject(new Error(message.error ?? "front-end worker returned no audio"));
        return;
      }
      waiter.resolve({ audio: message.audio, status: message.status });
    };
    worker.onerror = (event) => {
      console.warn("[front-end] worker failed, falling back to sync", event.message);
      workerBroken = true;
      worker?.terminate();
      worker = null;
      waiters.forEach(({ reject }) => reject(new Error("front-end worker error")));
      waiters.clear();
    };
  } catch (error) {
    console.warn("[front-end] cannot start worker, using sync fallback", error);
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runInWorker(
  audio: Float32Array,
  job: FrontEndJob,
): Promise<{ audio: Float32Array; status: FrontEndStatus }> {
  const target = getWorker();
  if (!target) return Promise.reject(new Error("no worker"));

  const id = nextId++;
  // `audio` is only borrowed: copy it so the caller's buffer stays valid (it is
  // handed over to the worker and detached).
  const copy = audio.slice();
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    try {
      target.postMessage({ id, audio: copy, job }, [copy.buffer]);
    } catch (error) {
      waiters.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Filtered copy of `audio` (or the input itself when the filter is off).
 * Never blocks the renderer for longer than a message hop.
 */
export async function applyFrontEndAsync(
  audio: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
): Promise<Float32Array> {
  const job = buildFrontEndJob(filterFreq, filterWidth, audio.length);
  if (!job) return audio;

  const signature = signatureOf(job, audio.length);
  const hit = cache.get(audio);
  if (hit && hit.signature === signature) {
    publishFrontEndStatus(hit.status);
    return hit.audio;
  }

  try {
    const { audio: filtered, status } = await runInWorker(audio, job);
    publishFrontEndStatus(status);
    remember(audio, signature, filtered, status);
    return filtered;
  } catch {
    // Worker unavailable: do it inline rather than not at all.
    const filtered = applyFrontEnd(audio, filterFreq, filterWidth);
    return filtered;
  }
}

