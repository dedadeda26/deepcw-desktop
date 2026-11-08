/**
 * DeepCW front-end filter (deterministic DSP pre-processing).
 *
 * A TypeScript port of the offline reference implementation in
 * `filter/cw_filter4.py`, adapted to the desktop decoder pipeline (9600 Hz mono
 * float audio, per-decode-block processing instead of a real-time stream).
 *
 * Per 8 ms frame (32 ms window, 75 % overlap, sqrt-Hann + OLA) it:
 *   - blanks static crashes (very short spikes only — CW elements are tens of ms),
 *   - tracks the noise floor per bin (fast down, very slow up),
 *   - acquires the CW tone by prominence voting, then tracks it slowly,
 *   - applies a soft band-pass around the tone, width following the keying speed,
 *   - notches steady carriers and mains hum,
 *   - applies a dead-zone AGC so slow fading (QSB) is levelled,
 *   - blends filtered / raw audio per frame from the band "dirtiness", so a
 *     clean signal is essentially left alone.
 *
 * Difference from the Python reference: `processOfflineStable()` runs the
 * analyser twice over the same block and seeds the second pass with the
 * converged tone / noise state. A single offline pass spends its first
 * 1–2.5 s acquiring the tone (output = raw meanwhile), which is a large share
 * of a 6–12 s decode window; priming makes the whole block filtered.
 */

const EPS = 1e-12;

export type FrontEndProfileName = "mild" | "normal" | "aggressive";

export type FrontEndProfile = {
  name: string;
  /** Slow floor rise (~0.65 dB/s). */
  noiseSlow: number;
  /** Fast rise, reacts to bursts (~1 dB/s). */
  noiseFast: number;
  noiseBias: number;
  /** Wiener gain floor, dB. */
  gainFloorDb: number;
  ddAlpha: number;
  trackSpanHz: number;
  outsideGain: number;
  notchEnabled: boolean;
  notchOccupancy: number;
  notchFloor: number;
  agcEnabled: boolean;
  agcDeadZoneDb: number;
  agcMaxDb: number;
  agcTimeS: number;
  blankEnabled: boolean;
  blankThreshold: number;
  humEnabled: boolean;
};

function baseProfile(name: FrontEndProfileName): FrontEndProfile {
  const profile: FrontEndProfile = {
    name,
    noiseSlow: 1.0012,
    noiseFast: 1.02,
    noiseBias: 1.4,
    gainFloorDb: -14.0,
    ddAlpha: 0.97,
    trackSpanHz: 260.0,
    outsideGain: 0.12,
    notchEnabled: true,
    notchOccupancy: 0.75,
    notchFloor: 0.04,
    agcEnabled: true,
    agcDeadZoneDb: 6.0,
    agcMaxDb: 8.0,
    agcTimeS: 0.5,
    blankEnabled: true,
    blankThreshold: 10.0,
    humEnabled: true,
  };

  if (name === "mild") {
    profile.gainFloorDb = -10.0;
    profile.notchOccupancy = 0.85;
    profile.outsideGain = 0.3;
    profile.agcMaxDb = 4.0;
    profile.blankThreshold = 9.0;
  } else if (name === "aggressive") {
    profile.gainFloorDb = -20.0;
    profile.notchOccupancy = 0.65;
    profile.outsideGain = 0.05;
    profile.agcMaxDb = 10.0;
    profile.blankThreshold = 4.0;
  }

  return profile;
}

export type CwFrontEndOptions = {
  fs?: number;
  winMs?: number;
  /** Fixed band half-width; `null` (default) adapts it to the keying speed. */
  bandHz?: number | null;
  profile?: FrontEndProfileName;
  /** Tone search range, Hz. */
  searchHz?: [number, number];
  adaptBand?: boolean;
  humEnabled?: boolean;
  notchEnabled?: boolean;
  lowSnrEngage?: boolean;
  forceEngage?: boolean;
};

export type FrontEndStatus = {
  locked: boolean;
  confident: boolean;
  toneHz: number;
  wpm: number;
  /** 0 = pure passthrough, 1 = full gain applied. */
  mix: number;
  bandHz: number;
};

/* -------------------------------------------------------------------------- */
/* FFT                                                                        */
/* -------------------------------------------------------------------------- */

type FftTables = {
  n: number;
  rev: Int32Array;
  cos: Float64Array;
  sin: Float64Array;
};

const fftCache = new Map<number, FftTables>();

function getFftTables(n: number): FftTables {
  const cached = fftCache.get(n);
  if (cached) return cached;

  const rev = new Int32Array(n);
  let bits = 0;
  while (1 << bits < n) bits += 1;
  for (let i = 0; i < n; i += 1) {
    let value = 0;
    for (let b = 0; b < bits; b += 1) {
      value = (value << 1) | ((i >> b) & 1);
    }
    rev[i] = value;
  }

  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    const angle = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(angle);
    sin[k] = Math.sin(angle);
  }

  const tables: FftTables = { n, rev, cos, sin };
  fftCache.set(n, tables);
  return tables;
}

/** In-place complex FFT (decimation in time, radix 2, forward / e^-i). */
function fftInPlace(re: Float64Array, im: Float64Array, t: FftTables): void {
  const n = t.n;
  const rev = t.rev;

  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0, k = 0; j < half; j += 1, k += step) {
        const c = t.cos[k];
        const s = t.sin[k];
        const left = start + j;
        const right = left + half;
        const tr = re[right] * c - im[right] * s;
        const ti = re[right] * s + im[right] * c;
        re[right] = re[left] - tr;
        im[right] = im[left] - ti;
        re[left] += tr;
        im[left] += ti;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* front end                                                                  */
/* -------------------------------------------------------------------------- */

export class CwFrontEnd {
  readonly fs: number;
  readonly win: number;
  readonly hop: number;
  readonly nBins: number;
  readonly profile: FrontEndProfile;

  private readonly bandBaseHz: number;
  private readonly adaptBand: boolean;
  private readonly searchHz: [number, number];
  private readonly lowSnrEngage: boolean;
  private readonly forceEngage: boolean;

  private readonly window: Float64Array;
  private readonly winNorm: number;
  private readonly binHz: Float64Array;
  private readonly searchMask: Uint8Array;
  private readonly humMask: Uint8Array;

  // capture / tracking constants (see cw_filter4.py)
  private readonly acqWarmS = 0.45;
  private readonly acqMinS = 1.0;
  private readonly acqMaxS = 2.5;
  private readonly dropS = 3.0;
  private readonly wpmPerRising = 7.1;
  private readonly bandPerWpm = 4.5;
  private readonly bandMinHz = 110;
  private readonly bandMaxHz = 280;

  // -- streaming state ------------------------------------------------------ //
  private input = new Float64Array(0);
  private readonly ola: Float64Array;
  private noiseSlow: Float64Array | null = null;
  private noiseFast: Float64Array | null = null;
  private readonly pEma: Float64Array;
  private readonly p2Ema: Float64Array;
  private readonly cv: Float64Array;
  private readonly gammaPrev: Float64Array;
  private readonly gainPrev: Float64Array;
  private readonly occupied: Float64Array;
  private readonly notchMask: Uint8Array;
  private toneHz: number;
  private toneCand = 0;
  private readonly toneHist: Float64Array;
  private tonePos = 0;
  private weak = false;
  private locked = false;
  private lockConfident = false;
  private mix = 1;
  private agcDb = 0;
  private levelRef: number | null = null;
  private frames = 0;

  private readonly acqVotes: Float64Array;
  private readonly acqScore: Float64Array;
  private acqFrames = 0;
  private acqWall = 0;
  private aliveMiss = 0;

  private wpmEst = 25;
  private bandNow: number;
  private readonly envBuf: Float64Array;
  private envPos = 0;
  private envFilled = 0;
  private lockFrame = 0;
  // last known good state, so the UI keeps showing the tone even when the
  // block ends in silence (which drops the liveness lock)
  private reportedLocked = false;
  private reportedTone = 0;
  private reportedWpm = 0;
  private reportedMix = 0;

  // -- scratch (never aliased across stages) -------------------------------- //
  private readonly idx: Int32Array;
  private readonly voted: Int32Array;
  private readonly power: Float64Array;
  private readonly noise: Float64Array;
  private readonly score: Float64Array;
  private readonly aux: Float64Array;
  private readonly gain: Float64Array;
  private readonly sortBuf: Float64Array;
  private readonly envSeg: Float64Array;
  private readonly envSorted: Float64Array;
  private readonly frame: Float64Array;
  private readonly fftRe: Float64Array;
  private readonly fftIm: Float64Array;
  private readonly specRe: Float64Array;
  private readonly specIm: Float64Array;

  constructor(options: CwFrontEndOptions = {}) {
    const fs = Math.round(options.fs ?? 9600);
    const winMs = options.winMs ?? 32;
    this.fs = fs;
    this.profile = baseProfile(options.profile ?? "normal");
    if (options.humEnabled != null) this.profile.humEnabled = options.humEnabled;
    if (options.notchEnabled != null) {
      this.profile.notchEnabled = options.notchEnabled;
    }

    let win = 64;
    while (win < (fs * winMs) / 1000) win <<= 1;
    this.win = win;
    this.hop = Math.max(8, win >> 2);
    this.nBins = (win >> 1) + 1;

    this.searchHz = options.searchHz ?? [250, 3500];
    this.bandBaseHz = options.bandHz ?? this.profile.trackSpanHz;
    this.adaptBand =
      Boolean(options.adaptBand ?? true) && options.bandHz == null;
    this.lowSnrEngage = Boolean(options.lowSnrEngage);
    this.forceEngage = Boolean(options.forceEngage);

    this.window = new Float64Array(win);
    for (let i = 0; i < win; i += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
      this.window[i] = Math.sqrt(Math.max(hann, 0));
    }

    const acc = new Float64Array(win * 4);
    for (let start = 0; start < win * 3; start += this.hop) {
      for (let i = 0; i < win; i += 1) {
        const value = this.window[i];
        acc[start + i] += value * value;
      }
    }
    const normSlice = acc.slice(win, win * 3);
    normSlice.sort();
    const medianAcc = normSlice[normSlice.length >> 1];
    this.winNorm = 1 / Math.max(medianAcc, EPS);

    this.binHz = new Float64Array(this.nBins);
    for (let i = 0; i < this.nBins; i += 1) {
      this.binHz[i] = (i * fs) / win;
    }

    this.searchMask = new Uint8Array(this.nBins);
    for (let i = 0; i < this.nBins; i += 1) {
      const hz = this.binHz[i];
      this.searchMask[i] =
        hz >= this.searchHz[0] && hz <= this.searchHz[1] ? 1 : 0;
    }

    this.humMask = new Uint8Array(this.nBins);
    const binWidth = fs / win;
    for (const freq of [50, 100, 150, 60, 120, 180]) {
      for (let i = 0; i < this.nBins; i += 1) {
        if (Math.abs(this.binHz[i] - freq) < binWidth * 1.2) {
          this.humMask[i] = 1;
        }
      }
    }

    this.ola = new Float64Array(win);
    this.pEma = new Float64Array(this.nBins);
    this.p2Ema = new Float64Array(this.nBins);
    this.cv = new Float64Array(this.nBins);
    this.gammaPrev = new Float64Array(this.nBins);
    this.gainPrev = new Float64Array(this.nBins);
    this.occupied = new Float64Array(this.nBins);
    this.notchMask = new Uint8Array(this.nBins);
    this.toneHist = new Float64Array(80);
    this.acqVotes = new Float64Array(this.nBins);
    this.acqScore = new Float64Array(this.nBins);
    this.toneHz = (this.searchHz[0] + this.searchHz[1]) / 2;
    this.bandNow = this.bandBaseHz;
    this.envBuf = new Float64Array(
      Math.max(32, Math.round((2 * this.fs) / this.hop)),
    );

    this.idx = new Int32Array(this.nBins);
    this.voted = new Int32Array(this.nBins);
    this.power = new Float64Array(this.nBins);
    this.noise = new Float64Array(this.nBins);
    this.score = new Float64Array(this.nBins);
    this.aux = new Float64Array(this.nBins);
    this.gain = new Float64Array(this.nBins);
    this.sortBuf = new Float64Array(this.nBins);
    this.envSeg = new Float64Array(this.envBuf.length);
    this.envSorted = new Float64Array(this.envBuf.length);
    this.frame = new Float64Array(win);
    this.fftRe = new Float64Array(win);
    this.fftIm = new Float64Array(win);
    this.specRe = new Float64Array(this.nBins);
    this.specIm = new Float64Array(this.nBins);

    this.reset();
  }

  get latencySamples(): number {
    return this.win - this.hop;
  }

  reset(): void {
    this.input = new Float64Array(0);
    this.ola.fill(0);
    this.noiseSlow = null;
    this.noiseFast = null;
    this.pEma.fill(0);
    this.p2Ema.fill(0);
    this.cv.fill(0);
    this.gammaPrev.fill(1);
    this.gainPrev.fill(1);
    this.occupied.fill(0);
    this.notchMask.fill(0);
    this.toneHz = (this.searchHz[0] + this.searchHz[1]) / 2;
    this.toneCand = 0;
    this.toneHist.fill(0);
    this.tonePos = 0;
    this.weak = false;
    this.locked = false;
    this.lockConfident = false;
    this.mix = 1;
    this.agcDb = 0;
    this.levelRef = null;
    this.frames = 0;
    this.acqVotes.fill(0);
    this.acqScore.fill(0);
    this.acqFrames = 0;
    this.acqWall = 0;
    this.aliveMiss = 0;
    this.wpmEst = 25;
    this.bandNow = this.bandBaseHz;
    this.envBuf.fill(0);
    this.envPos = 0;
    this.envFilled = 0;
    this.lockFrame = 0;
    this.reportedLocked = false;
    this.reportedTone = 0;
    this.reportedWpm = 0;
    this.reportedMix = 0;
  }

  getStatus(): FrontEndStatus {
    const locked = this.locked || this.reportedLocked;
    return {
      locked,
      confident: this.lockConfident || this.reportedLocked,
      toneHz: locked ? (this.locked ? this.toneHz : this.reportedTone) : 0,
      wpm: this.reportedWpm || this.wpmEst,
      mix: Math.max(this.reportedMix, this.mix),
      bandHz: this.bandNow * (this.weak ? 1.7 : 1),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* streaming                                                               */
  /* ------------------------------------------------------------------------ */

  process(block: Float32Array | Float64Array): Float32Array {
    if (block.length === 0) return new Float32Array(0);

    let input: Float32Array | Float64Array = block;
    if (this.profile.blankEnabled) input = this._blank(block);

    const previous = this.input;
    const merged = new Float64Array(previous.length + input.length);
    merged.set(previous);
    merged.set(input, previous.length);
    this.input = merged;

    const out = new Float32Array(
      Math.max(0, Math.floor((this.input.length - this.win) / this.hop) + 1) *
        this.hop,
    );
    let written = 0;
    let offset = 0;

    while (this.input.length - offset >= this.win) {
      this._processFrame(offset);
      for (let i = 0; i < this.hop; i += 1) out[written + i] = this.ola[i];
      written += this.hop;
      this.ola.copyWithin(0, this.hop);
      this.ola.fill(0, this.win - this.hop);
      offset += this.hop;
    }

    if (offset > 0) this.input = this.input.slice(offset);

    return written === out.length ? out : out.slice(0, written);
  }

  processOffline(audio: Float32Array | Float64Array): Float32Array {
    this.reset();
    return this._processPadded(audio);
  }

  /**
   * Offline processing with a priming pass: pass 1 only converges the tone
   * tracker / noise floor, pass 2 renders the audio with that state in place,
   * so the output is filtered from the first sample.
   */
  processOfflineStable(audio: Float32Array | Float64Array): Float32Array {
    if (audio.length < this.win * 2) {
      this.reset();
      const copy = new Float32Array(audio.length);
      copy.set(audio);
      return copy;
    }

    // On very long blocks the acquisition cost is a small share of the block,
    // so the priming pass is not worth the extra CPU.
    if (audio.length > this.fs * 20) {
      return this.processOffline(audio);
    }

    this.reset();
    this._processPadded(audio);
    const snapshot = this._snapshot();

    this.reset();
    this._restore(snapshot);
    return this._processPadded(audio);
  }

  private _processPadded(audio: Float32Array | Float64Array): Float32Array {
    const latency = this.win - this.hop;
    const padded = new Float64Array(latency + audio.length + this.win);
    padded.set(audio, latency);
    const out = this.process(padded);
    const result = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i += 1) {
      result[i] = out[latency + i] ?? 0;
    }
    return result;
  }

  private _snapshot() {
    return {
      toneHz: this.toneHz,
      locked: this.locked,
      lockConfident: this.lockConfident,
      weak: this.weak,
      mix: this.mix,
      agcDb: this.agcDb,
      levelRef: this.levelRef,
      wpmEst: this.wpmEst,
      bandNow: this.bandNow,
      noiseSlow: this.noiseSlow ? this.noiseSlow.slice() : null,
      noiseFast: this.noiseFast ? this.noiseFast.slice() : null,
      pEma: this.pEma.slice(),
      p2Ema: this.p2Ema.slice(),
      cv: this.cv.slice(),
      occupied: this.occupied.slice(),
      notchMask: this.notchMask.slice(),
      gainPrev: this.gainPrev.slice(),
      gammaPrev: this.gammaPrev.slice(),
    };
  }

  private _restore(snapshot: ReturnType<CwFrontEnd["_snapshot"]>): void {
    this.toneHz = snapshot.toneHz;
    this.locked = snapshot.locked;
    this.lockConfident = snapshot.lockConfident;
    this.weak = snapshot.weak;
    this.mix = snapshot.mix;
    this.agcDb = snapshot.agcDb;
    this.levelRef = snapshot.levelRef;
    this.wpmEst = snapshot.wpmEst;
    this.bandNow = snapshot.bandNow;
    this.noiseSlow = snapshot.noiseSlow;
    this.noiseFast = snapshot.noiseFast;
    this.pEma.set(snapshot.pEma);
    this.p2Ema.set(snapshot.p2Ema);
    this.cv.set(snapshot.cv);
    this.occupied.set(snapshot.occupied);
    this.notchMask.set(snapshot.notchMask);
    this.gainPrev.set(snapshot.gainPrev);
    this.gammaPrev.set(snapshot.gammaPrev);
    // Pretend the lock is old, otherwise the first 0.12 s passes through.
    this.lockFrame = -1e9;
  }

  /* ------------------------------------------------------------------------ */
  /* one frame                                                               */
  /* ------------------------------------------------------------------------ */

  private _processFrame(offset: number): void {
    const win = this.win;
    const window = this.window;
    const frame = this.frame;
    const source = this.input;
    for (let i = 0; i < win; i += 1) frame[i] = source[offset + i];

    const fftRe = this.fftRe;
    const fftIm = this.fftIm;
    for (let i = 0; i < win; i += 1) {
      fftRe[i] = frame[i] * window[i];
      fftIm[i] = 0;
    }
    const tables = getFftTables(win);
    fftInPlace(fftRe, fftIm, tables);
    this.frames += 1;

    for (let i = 0; i < this.nBins; i += 1) {
      this.specRe[i] = fftRe[i];
      this.specIm[i] = fftIm[i];
      this.power[i] = fftRe[i] * fftRe[i] + fftIm[i] * fftIm[i];
    }

    if (!this._analyse()) {
      // unity gain through the same analysis/synthesis pair
      const scale = this.winNorm;
      for (let i = 0; i < win; i += 1) {
        this.ola[i] += frame[i] * window[i] * window[i] * scale;
      }
      return;
    }

    const gain = this._gain();
    for (let i = 0; i < this.nBins; i += 1) {
      fftRe[i] = this.specRe[i] * gain[i];
      fftIm[i] = this.specIm[i] * gain[i];
    }
    for (let i = 1; i < this.nBins - 1; i += 1) {
      fftRe[win - i] = fftRe[i];
      fftIm[win - i] = -fftIm[i];
    }
    fftIm[0] = 0;
    fftIm[this.nBins - 1] = 0;
    for (let i = 0; i < win; i += 1) fftIm[i] = -fftIm[i];
    fftInPlace(fftRe, fftIm, tables);
    const scale = this.winNorm / win;
    for (let i = 0; i < win; i += 1) {
      this.ola[i] += fftRe[i] * window[i] * scale;
    }
  }

  /** Updates statistics and the tone tracker. True when this frame is filtered. */
  private _analyse(): boolean {
    const p = this.profile;
    const n = this.nBins;

    for (let i = 0; i < n; i += 1) {
      this.pEma[i] = 0.9 * this.pEma[i] + 0.1 * this.power[i];
      this.p2Ema[i] = 0.9 * this.p2Ema[i] + 0.1 * this.power[i] * this.power[i];
    }
    for (let i = 0; i < n; i += 1) {
      const mean = Math.max(this.pEma[i], EPS);
      const variance = Math.max(this.p2Ema[i] - this.pEma[i] * this.pEma[i], 0);
      this.cv[i] = 0.9 * this.cv[i] + (0.1 * Math.sqrt(variance)) / mean;
    }

    if (this.noiseSlow == null || this.noiseFast == null) {
      this.noiseSlow = new Float64Array(n);
      this.noiseFast = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        this.noiseSlow[i] = Math.max(this.power[i], 1e-9);
        this.noiseFast[i] = Math.max(this.power[i], 1e-9);
      }
    }
    const noiseSlow = this.noiseSlow;
    const noiseFast = this.noiseFast;
    for (let i = 0; i < n; i += 1) {
      noiseSlow[i] = Math.max(
        Math.min(this.power[i], noiseSlow[i] * p.noiseSlow),
        1e-9,
      );
      noiseFast[i] = Math.max(
        Math.min(this.power[i], noiseFast[i] * p.noiseFast),
        1e-9,
      );
      this.noise[i] = Math.max(noiseSlow[i] * p.noiseBias, noiseFast[i] * 0.8);
    }

    for (let i = 0; i < n; i += 1) {
      const gamma = this.power[i] / Math.max(this.noise[i], EPS);
      this.occupied[i] = 0.9 * this.occupied[i] + 0.1 * (gamma > 8 ? 1 : 0);
      const carrier = this.occupied[i] > p.notchOccupancy && this.cv[i] < 0.45;
      const awayFromTone = Math.abs(this.binHz[i] - this.toneHz) > 30;
      this.notchMask[i] =
        carrier && awayFromTone && this.power[i] > this.noise[i] * 4 ? 1 : 0;
    }

    this._trackTone();

    if (this.locked) {
      this.reportedLocked = true;
      this.reportedTone = this.toneHz;
      this.reportedWpm = this.wpmEst;
    }

    if (this.locked && this.adaptBand) this._updateBand();

    if (!this.locked) return false;
    if (this.frames - this.lockFrame < Math.round((0.12 * this.fs) / this.hop)) {
      return false;
    }
    return true;
  }

  private _median(values: Float64Array, count: number): number {
    if (count <= 0) return 0;
    const buf = this.sortBuf;
    for (let i = 0; i < count; i += 1) buf[i] = values[i];
    const slice = buf.subarray(0, count);
    slice.sort();
    const mid = count >> 1;
    return count % 2 === 0 ? 0.5 * (slice[mid - 1] + slice[mid]) : slice[mid];
  }

  private _trackTone(): void {
    const n = this.nBins;
    const power = this.power;
    const noise = this.noise;
    const score = this.score;

    for (let i = 0; i < n; i += 1) {
      score[i] = this.pEma[i] * Math.min(Math.max(this.cv[i] / 0.5, 0), 1);
    }

    let idxCount = 0;
    for (let i = 0; i < n; i += 1) {
      if (this.searchMask[i] && !this.notchMask[i]) this.idx[idxCount++] = i;
    }
    if (idxCount === 0) {
      for (let i = 0; i < n; i += 1) {
        if (this.searchMask[i]) this.idx[idxCount++] = i;
      }
    }
    if (idxCount === 0) return;

    let best = this.idx[0];
    for (let k = 1; k < idxCount; k += 1) {
      if (score[this.idx[k]] > score[best]) best = this.idx[k];
    }
    const peakHz = this.binHz[best];

    if (!this.locked) {
      this.acqWall += 1;
      const tS = (this.acqWall * this.hop) / this.fs;
      if (tS < this.acqWarmS) return;

      for (let k = 0; k < idxCount; k += 1) {
        this.aux[k] = score[this.idx[k]];
      }
      const medScore = this._median(this.aux, idxCount);

      const prominent =
        score[best] > 3 * Math.max(medScore, EPS) &&
        power[best] > 3 * noise[best];
      if (prominent) {
        this.acqScore[best] += score[best];
        this.acqVotes[best] += 1;
        this.acqFrames += 1;
      }
      if (tS < this.acqMinS) return;

      if (this.acqFrames > 0) {
        let top = this.idx[0];
        for (let k = 1; k < idxCount; k += 1) {
          if (this.acqScore[this.idx[k]] > this.acqScore[top]) top = this.idx[k];
        }
        const frac = this.acqVotes[top] / Math.max(this.acqFrames, 1);
        for (let k = 0; k < idxCount; k += 1) {
          this.aux[k] = this.pEma[this.idx[k]];
        }
        const medPeak = this._median(this.aux, idxCount);
        if (
          frac >= 0.4 &&
          this.pEma[top] > 4 * noise[top] &&
          this.pEma[top] > 3 * medPeak &&
          this.cv[top] > 0.4
        ) {
          this._setLock(top, true);
          return;
        }
      }

      if (tS >= this.acqMaxS) {
        // Fallback lock: only bins that actually received votes (i.e. showed a
        // prominent keyed peak) and still look keyed right now. A handful of
        // random noise frames must not be enough to declare a tone.
        let votedCount = 0;
        if (this.acqFrames >= 5) {
          for (let k = 0; k < idxCount; k += 1) {
            const index = this.idx[k];
            if (this.acqVotes[index] > 0) this.voted[votedCount++] = index;
          }
        }

        let frac = 0;
        if (votedCount > 0) {
          let topVoted = this.voted[0];
          for (let k = 1; k < votedCount; k += 1) {
            const index = this.voted[k];
            if (this.acqVotes[index] > this.acqVotes[topVoted]) {
              topVoted = index;
            }
          }
          frac = this.acqVotes[topVoted] / Math.max(this.acqFrames, 1);
        }

        let liveBest = -1;
        let liveValue = 0;
        for (let k = 0; k < votedCount; k += 1) {
          const index = this.voted[k];
          if (this.cv[index] > 0.3 && score[index] > liveValue) {
            liveValue = score[index];
            liveBest = index;
          }
        }

        if (liveBest >= 0 && liveValue > 0 && frac >= 0.2) {
          this._setLock(liveBest, false);
        } else {
          this.acqVotes.fill(0);
          this.acqScore.fill(0);
          this.acqFrames = 0;
          this.acqWall = 0;
        }
      }
      return;
    }

    // ---- locked: slow track / migration / liveness ------------------------ //
    let here = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < n; i += 1) {
      const distance = Math.abs(this.binHz[i] - this.toneHz);
      if (distance < bestDistance) {
        bestDistance = distance;
        here = i;
      }
    }

    for (let k = 0; k < idxCount; k += 1) this.aux[k] = score[this.idx[k]];
    const medScore = this._median(this.aux, idxCount);

    const confidentPeak =
      score[best] > 3 * Math.max(medScore, EPS) && power[best] > 3 * noise[best];

    if (confidentPeak) {
      this.toneHist[this.tonePos] = peakHz;
      this.tonePos = (this.tonePos + 1) % this.toneHist.length;
      if (this.frames > 40) {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < this.toneHist.length; i += 1) {
          const value = this.toneHist[i];
          if (value > 0) {
            if (value < min) min = value;
            if (value > max) max = value;
          }
        }
        if (max - min > 180) this.weak = true;
      }
      const delta = peakHz - this.toneHz;
      if (Math.abs(delta) <= 25) {
        this.toneHz += 0.2 * delta;
        this.toneCand = 0;
      } else if (this.cv[here] < 0.35) {
        this.toneCand += 1;
        if (this.toneCand >= 3) {
          this.toneHz = peakHz;
          this.toneCand = 0;
        }
      } else if (score[best] > 4 * score[here] + 1) {
        this.toneCand += 1;
        if (this.toneCand >= 75) {
          this.toneHz = peakHz;
          this.toneCand = 0;
        }
      } else {
        this.toneCand = 0;
        this.weak = true;
      }
    }

    if (power[here] > noise[here] * 2 || this.cv[here] > 0.4) {
      this.aliveMiss = 0;
    } else {
      this.aliveMiss += 1;
      if ((this.aliveMiss * this.hop) / this.fs > this.dropS) {
        this.locked = false;
        this.lockConfident = false;
        this.weak = false;
        this.toneCand = 0;
        this.acqVotes.fill(0);
        this.acqScore.fill(0);
        this.acqFrames = 0;
        this.acqWall = 0;
      }
    }
  }

  private _setLock(index: number, confident: boolean): void {
    this.toneHz = this.binHz[index];
    this.locked = true;
    this.lockConfident = confident;
    this.weak = !confident;
    this.toneHist.fill(0);
    this.tonePos = 0;
    this.toneCand = 0;
    this.lockFrame = this.frames;
    this.aliveMiss = 0;
    this.acqVotes.fill(0);
    this.acqScore.fill(0);
    this.acqFrames = 0;
    this.acqWall = 0;
  }

  private _updateBand(): void {
    const band = this.bandNow * (this.weak ? 1.7 : 1);
    const n = this.nBins;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(this.binHz[i] - this.toneHz) <= band) {
        sum += this.power[i];
        count += 1;
      }
    }
    if (count === 0) return;

    this.envBuf[this.envPos] = sum / count;
    this.envPos = (this.envPos + 1) % this.envBuf.length;
    this.envFilled = Math.min(this.envFilled + 1, this.envBuf.length);

    if (this.frames % 16 !== 0) return;
    if (this.envFilled < this.envBuf.length) return;

    const segCount = this.envBuf.length;
    for (let i = 0; i < segCount; i += 1) {
      this.envSeg[i] = this.envBuf[(this.envPos + i) % segCount];
      this.envSorted[i] = this.envSeg[i];
    }
    this.envSorted.sort();

    const lo = this.envSorted[Math.floor(0.15 * (segCount - 1))];
    const hi = this.envSorted[Math.floor(0.85 * (segCount - 1))];
    if (hi <= lo * 1.5) return;

    let rising = 0;
    let armed = true;
    for (let i = 0; i < segCount; i += 1) {
      const value = this.envSeg[i];
      if (armed && value >= hi) {
        rising += 1;
        armed = false;
      } else if (!armed && value <= lo) {
        armed = true;
      }
    }
    const rate = rising / ((segCount * this.hop) / this.fs);
    const wpmRaw = Math.min(Math.max(rate * this.wpmPerRising, 8), 60);
    this.wpmEst = 0.9 * this.wpmEst + 0.1 * wpmRaw;
    const target = Math.min(
      Math.max(this.bandPerWpm * this.wpmEst, this.bandMinHz),
      this.bandMaxHz,
    );
    this.bandNow = 0.9 * this.bandNow + 0.1 * target;
  }

  private _gain(): Float64Array {
    const p = this.profile;
    const n = this.nBins;
    const power = this.power;
    const noise = this.noise;
    const gain = this.gain;

    for (let i = 0; i < n; i += 1) {
      const gamma = power[i] / Math.max(noise[i], EPS);
      const xi =
        p.ddAlpha * this.gainPrev[i] * this.gainPrev[i] * this.gammaPrev[i] +
        (1 - p.ddAlpha) * Math.max(gamma - 1, 0);
      let value = Math.sqrt(xi / (1 + xi));
      value = Math.max(value, Math.pow(10, p.gainFloorDb / 20));
      this.gammaPrev[i] = gamma;
      gain[i] = value;
    }

    const bandHz = this.bandNow * (this.weak ? 1.7 : 1);
    const edge = Math.max(30, 0.6 * bandHz);

    let inBandSum = 0;
    let inBandCount = 0;
    let outBandSum = 0;
    let outBandCount = 0;
    let noiseInBand = 0;
    let noiseOutBand = 0;

    for (let i = 0; i < n; i += 1) {
      if (!this.searchMask[i]) continue;
      if (Math.abs(this.binHz[i] - this.toneHz) <= bandHz) {
        inBandSum += power[i];
        noiseInBand += noise[i];
        inBandCount += 1;
      } else {
        outBandSum += power[i];
        noiseOutBand += noise[i];
        outBandCount += 1;
      }
    }

    let outsideGain = p.outsideGain;
    if (outBandCount > 0) {
      const interference =
        outBandSum / outBandCount / Math.max(noiseOutBand / outBandCount, EPS);
      outsideGain =
        interference < 2
          ? 1
          : Math.min(Math.max(1 / Math.sqrt(interference), 0.1), 0.6);
    }

    for (let i = 0; i < n; i += 1) {
      const distance = Math.abs(this.binHz[i] - this.toneHz);
      const weight = Math.min(Math.max((bandHz + edge - distance) / edge, 0), 1);
      gain[i] = weight * gain[i] + (1 - weight) * outsideGain;
      if (this.binHz[i] < 80) gain[i] *= 0.02;
      if (p.humEnabled && this.humMask[i]) gain[i] *= 0.05;
      if (p.notchEnabled && this.notchMask[i]) gain[i] *= p.notchFloor;
    }

    if (inBandCount === 0 || noiseInBand <= 0) {
      this.gainPrev.set(gain);
      return gain;
    }

    const meanIn = inBandSum / inBandCount;
    const meanNoiseIn = noiseInBand / inBandCount;
    const bandSnr = 10 * Math.log10(Math.max(meanIn, EPS) / Math.max(meanNoiseIn, EPS));

    let keyedSum = 0;
    let keyedCount = 0;
    let ringSum = 0;
    let ringNoise = 0;
    let ringCount = 0;
    for (let i = 0; i < n; i += 1) {
      if (!this.searchMask[i]) continue;
      const distance = Math.abs(this.binHz[i] - this.toneHz);
      if (distance <= bandHz) continue;
      if (this.cv[i] > 0.5 && power[i] > noise[i] * 16) {
        keyedSum += power[i];
        keyedCount += 1;
      }
      if (distance > 60 && distance < 250) {
        ringSum += power[i];
        ringNoise += noise[i];
        ringCount += 1;
      }
    }

    const qrm = keyedCount > 0 ? keyedSum / keyedCount / Math.max(meanIn, EPS) : 0;

    const scale = this.lockConfident ? (bandSnr < 10 ? 0.85 : 0.55) : 0.35;
    const engage = this.forceEngage || (this.lowSnrEngage && bandSnr < 10);

    let bypass = false;
    if (ringCount > 0) {
      const ringRatio = ringSum / ringCount / Math.max(ringNoise / ringCount, EPS);
      if (ringRatio > 8 && !engage) bypass = true;
    }
    if (qrm > 0.02 && !engage) bypass = true;

    this.mix = bypass ? 0 : Math.min(Math.max(0.3 + scale, 0), 1);
    if (this.mix > this.reportedMix) this.reportedMix = this.mix;
    if (bypass) {
      this.gainPrev.fill(1);
      gain.fill(1);
      return gain;
    }

    for (let i = 0; i < n; i += 1) {
      gain[i] = 1 + this.mix * (gain[i] - 1);
    }

    // time smoothing only — frequency averaging would smear the tone
    for (let i = n - 1; i >= 1; i -= 1) {
      gain[i] = 0.3 * gain[i - 1] + 0.7 * gain[i];
    }

    if (p.agcEnabled && this.mix > 0.05) {
      let bandPower = 0;
      for (let i = 0; i < n; i += 1) {
        if (Math.abs(this.binHz[i] - this.toneHz) <= bandHz) {
          bandPower += power[i] * gain[i] * gain[i];
        }
      }
      bandPower /= inBandCount;
      const levelDb = 10 * Math.log10(Math.max(bandPower, 1e-12));
      if (this.levelRef == null) this.levelRef = levelDb;
      const refA = Math.exp(-this.hop / (3 * this.fs));
      this.levelRef = refA * this.levelRef + (1 - refA) * levelDb;
      const dev = levelDb - this.levelRef;
      const want =
        Math.abs(dev) <= p.agcDeadZoneDb
          ? 0
          : Math.min(
              Math.max(-dev + Math.sign(dev) * p.agcDeadZoneDb, -p.agcMaxDb),
              p.agcMaxDb,
            );
      const a = Math.exp(-this.hop / (p.agcTimeS * this.fs));
      this.agcDb = a * this.agcDb + (1 - a) * want;
      if (bandSnr > 0 || this.agcDb < 0) {
        const factor = Math.pow(10, this.agcDb / 20);
        for (let i = 0; i < n; i += 1) gain[i] *= factor;
      }
    }

    this.gainPrev.set(gain);
    return gain;
  }

  /* ------------------------------------------------------------------------ */
  /* impulse blanking                                                        */
  /* ------------------------------------------------------------------------ */

  private _blank(
    block: Float32Array | Float64Array,
  ): Float32Array | Float64Array {
    const length = block.length;
    if (length < 16) return block;

    const smooth = Math.max(4, Math.round(this.fs * 0.001));
    const env = new Float64Array(length);
    let running = 0;
    for (let i = 0; i < length; i += 1) {
      running += Math.abs(block[i]);
      if (i >= smooth) running -= Math.abs(block[i - smooth]);
      env[i] = running / Math.min(i + 1, smooth);
    }

    const sorted = Float64Array.from(env);
    sorted.sort();
    const reference = sorted[Math.floor(0.75 * (length - 1))];
    if (reference < 1e-5) return block;

    const threshold = this.profile.blankThreshold * reference;
    const maxRun = Math.max(2, Math.round(0.004 * this.fs));
    const pad = Math.max(1, Math.round(this.fs * 0.002));

    const keep = new Uint8Array(length);
    let anySpike = false;
    let runStart = -1;
    for (let i = 0; i < length; i += 1) {
      if (env[i] > threshold) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        if (i - runStart <= maxRun) {
          keep.fill(1, runStart, i);
          anySpike = true;
        }
        runStart = -1;
      }
    }
    if (runStart >= 0 && length - runStart <= maxRun) {
      keep.fill(1, runStart, length);
      anySpike = true;
    }
    if (!anySpike) return block;

    const widened = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      if (!keep[i]) continue;
      widened.fill(1, Math.max(0, i - pad), Math.min(length, i + pad + 1));
    }

    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) out[i] = widened[i] ? 0 : block[i];
    return out;
  }
}

/* -------------------------------------------------------------------------- */
/* engine integration                                                         */
/* -------------------------------------------------------------------------- */

export type FrontEndSettings = {
  enabled: boolean;
  profile: FrontEndProfileName;
  /** Follow the keying speed instead of using a fixed band width. */
  autoBand: boolean;
  humEnabled: boolean;
  notchEnabled: boolean;
  /** Restrict the tone capture to the band selected on the waterfall. */
  followSelection: boolean;
  /** Ignore the "leave it alone" heuristics and always apply the gain. */
  forceEngage: boolean;
};

export const DEFAULT_FRONT_END_SETTINGS: FrontEndSettings = {
  enabled: false,
  profile: "normal",
  autoBand: true,
  humEnabled: true,
  notchEnabled: true,
  followSelection: true,
  // Off by default: the front end keeps the reference implementation's
  // "stay out of the way" behaviour and only engages when the band is actually
  // dirty. Turning this on forces the gain even next to a keyed neighbour.
  forceEngage: false,
};

let frontEndSettings: FrontEndSettings = { ...DEFAULT_FRONT_END_SETTINGS };

export function setFrontEndSettings(next: Partial<FrontEndSettings>): void {
  frontEndSettings = { ...frontEndSettings, ...next };
}

export function getFrontEndSettings(): FrontEndSettings {
  return frontEndSettings;
}

const NEUTRAL_STATUS: FrontEndStatus = {
  locked: false,
  confident: false,
  toneHz: 0,
  wpm: 0,
  mix: 0,
  bandHz: 0,
};

let latestStatus: FrontEndStatus = { ...NEUTRAL_STATUS };
const statusListeners = new Set<() => void>();

function publishStatus(next: FrontEndStatus): void {
  const previous = latestStatus;
  const changed =
    next.locked !== previous.locked ||
    next.confident !== previous.confident ||
    Math.round(next.toneHz / 5) !== Math.round(previous.toneHz / 5) ||
    Math.round(next.wpm) !== Math.round(previous.wpm) ||
    next.mix > 0.05 !== previous.mix > 0.05;
  if (!changed) return;
  latestStatus = next;
  statusListeners.forEach((listener) => listener());
}

export function getFrontEndStatus(): FrontEndStatus {
  return latestStatus;
}

export function subscribeFrontEndStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function resetFrontEndStatus(): void {
  latestStatus = { ...NEUTRAL_STATUS };
  statusListeners.forEach((listener) => listener());
}

/**
 * Runs the front end over one decode block. Returns the input array untouched
 * when the filter is disabled or the block is too short to analyse.
 */
export function applyFrontEnd(
  audio: Float32Array,
  filterFreq: number | null,
  filterWidth: number,
): Float32Array {
  const settings = frontEndSettings;
  if (!settings.enabled || audio.length < 2048) return audio;

  let searchHz: [number, number] = [200, 4200];
  if (settings.followSelection && filterFreq != null) {
    const half = Math.max(80, (filterWidth || 800) / 2 + 40);
    const low = Math.max(60, filterFreq - half);
    const high = Math.min(4600, filterFreq + half);
    if (high - low > 120) searchHz = [low, high];
  }

  try {
    const frontEnd = new CwFrontEnd({
      fs: 9600,
      profile: settings.profile,
      searchHz,
      adaptBand: settings.autoBand,
      humEnabled: settings.humEnabled,
      notchEnabled: settings.notchEnabled,
      // Reference behaviour: the front end steps aside (true passthrough) when
      // it cannot clearly help. `forceEngage` is the user's override.
      lowSnrEngage: false,
      forceEngage: settings.forceEngage,
    });
    const filtered = frontEnd.processOfflineStable(audio);
    publishStatus(frontEnd.getStatus());
    return filtered;
  } catch (error) {
    console.error("Front-end filter failed", error);
    return audio;
  }
}
