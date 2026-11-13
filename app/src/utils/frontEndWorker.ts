/**
 * Worker entry for the DSP front end.
 *
 * The analyser needs 50–300 ms for a decode window. Running it on the renderer
 * thread stalls the waterfall (and everything else) for that long, several
 * times per decode cycle, which is what made the spectrum look frozen. Here it
 * runs off-thread and only the finished block comes back.
 */
import { runFrontEndJob, type FrontEndJob } from "./cwFilter";

type Request = {
  id: number;
  audio: Float32Array;
  job: FrontEndJob;
};

type Response =
  | { id: number; audio: Float32Array; status: unknown }
  | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: Response, transfer?: Transferable[]) => void;
};

scope.onmessage = (event: MessageEvent<Request>) => {
  const { id, audio, job } = event.data ?? ({} as Request);
  try {
    const { audio: filtered, status } = runFrontEndJob(audio, job);
    const message: Response = { id, audio: filtered, status };
    // Hand the buffer over instead of copying ~1 MB back.
    scope.postMessage(message, [filtered.buffer]);
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
