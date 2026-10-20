"""Synthesize a Morse (CW) test recording for DeepCW Desktop.

Usage:
    python tools/gen_cw.py --text "CQ CQ DE N0CALL" --wpm 25 --freq 700 \
        --seconds 12 --snr-db 6 --out public/test/sample-cw.wav
"""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np

MORSE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.",
    "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-", "L": ".-..",
    "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.",
    "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": "-..-",
    "Y": "-.--", "Z": "--..", "0": "-----", "1": ".----", "2": "..---",
    "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...",
    "8": "---..", "9": "----.", "/": "-..-.", "?": "..--..", ".": ".-.-.-",
    ",": "--..--", "=": "-...-", "+": ".-.-.",
}


def keying_timeline(text: str, wpm: int) -> list[tuple[float, float]]:
    """Return [(start, end)] key-down intervals in seconds."""
    dot = 1.2 / wpm
    timeline: list[tuple[float, float]] = []
    cursor = 0.0

    for char_index, char in enumerate(text):
        if char == " ":
            cursor += 4 * dot  # 3 for the character gap + 4 for the word gap
            continue

        pattern = MORSE.get(char.upper())
        if pattern is None:
            continue

        for element in pattern:
            duration = dot if element == "." else 3 * dot
            timeline.append((cursor, cursor + duration))
            cursor += duration + dot

        cursor += 2 * dot  # end of character (total gap = 3 dots)
        _ = char_index

    return timeline


def render(timeline: list[tuple[float, float]], seconds: float, sample_rate: int, freq: float) -> np.ndarray:
    total = int(round(seconds * sample_rate))
    audio = np.zeros(total, dtype=np.float64)
    t = np.arange(total, dtype=np.float64) / sample_rate
    carrier = np.sin(2.0 * np.pi * freq * t)

    ramp = int(0.005 * sample_rate)
    envelope = np.zeros(total, dtype=np.float64)

    for start, end in timeline:
        first = int(round(start * sample_rate))
        last = int(round(end * sample_rate))
        if first >= total:
            break
        last = min(last, total)
        if last <= first:
            continue
        segment_length = last - first
        local = np.ones(segment_length, dtype=np.float64)
        edge = min(ramp, segment_length // 2)
        if edge > 0:
            shape = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, edge, endpoint=False))
            local[:edge] = shape
            local[-edge:] = shape[::-1]
        envelope[first:last] = np.maximum(envelope[first:last], local)

    signal = carrier * envelope
    return signal


def add_noise(signal: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    if snr_db is None:
        return signal
    signal_power = np.mean(signal**2)
    if signal_power <= 0:
        return signal
    noise_power = signal_power / (10.0 ** (snr_db / 10.0))
    noise = rng.normal(0.0, np.sqrt(noise_power), signal.shape)
    return signal + noise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", default="CQ CQ DE N0CALL")
    parser.add_argument("--wpm", type=int, default=25)
    parser.add_argument("--freq", type=float, default=700.0)
    parser.add_argument("--seconds", type=float, default=12.0)
    parser.add_argument("--snr-db", type=float, default=6.0)
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out", type=Path, default=Path("public/test/sample-cw.wav"))
    args = parser.parse_args()

    timeline = keying_timeline(args.text, args.wpm)
    audio = render(timeline, args.seconds, args.sample_rate, args.freq)
    audio = add_noise(audio, args.snr_db, np.random.default_rng(args.seed))
    peak = np.max(np.abs(audio)) or 1.0
    audio = audio / peak * 0.8

    pcm = np.clip(audio * 32767.0, -32768, 32767).astype("<i2")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.out), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(args.sample_rate)
        wav.writeframes(pcm.tobytes())

    print(
        f"wrote {args.out} ({args.seconds:.1f}s, {args.wpm} WPM, {args.freq:.0f} Hz, "
        f"SNR {args.snr_db} dB, {len(timeline)} elements)"
    )


if __name__ == "__main__":
    main()
