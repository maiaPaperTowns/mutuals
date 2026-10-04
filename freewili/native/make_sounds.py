"""Photon Pup's character sounds: little chiptune effects synthesized from scratch (no samples, no licenses).

→ native/photon/display/photon_sounds.c (int16 mono 8 kHz: the OG's i2s_audio runs at 8000 Hz, so every tone stays under 2.5 kHz)
→ native/out/sounds/*.wav previews

  python3 native/make_sounds.py
"""
import math
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 8000  # fixed by the BSP's i2s_audio_init(); Nyquist 4 kHz
ROOT = Path(__file__).resolve().parent
OUT_C = ROOT / "photon" / "display" / "photon_sounds.c"
OUT_WAV = ROOT / "out" / "sounds"


def tone(freq0: float, freq1: float, dur: float, wave_: str = "square", vol: float = 0.5,
         attack: float = 0.005, decay: float = 4.0, vibrato: float = 0.0) -> list[float]:
    """A note sliding freq0 → freq1, with a quick attack and exponential decay."""
    n = int(RATE * dur)
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq0 + (freq1 - freq0) * (i / max(1, n - 1))
        if vibrato:
            f *= 1 + 0.02 * math.sin(2 * math.pi * vibrato * t)
        phase += 2 * math.pi * f / RATE
        if wave_ == "square":
            s = 0.6 if math.sin(phase) >= 0 else -0.6  # softened square: chiptune but not harsh
        elif wave_ == "triangle":
            s = 2 / math.pi * math.asin(math.sin(phase))
        else:
            s = math.sin(phase)
        env = min(1.0, t / attack) * math.exp(-decay * t)
        out.append(s * env * vol)
    return out


def rest(dur: float) -> list[float]:
    return [0.0] * int(RATE * dur)


def mix(*tracks: list[float]) -> list[float]:
    n = max(len(t) for t in tracks)
    return [sum(t[i] if i < len(t) else 0.0 for t in tracks) for i in range(n)]


# ---- puppy noises: synthesized, voiced like a small dog (harmonic-rich sweep + a breath of noise) ----
_rng = __import__("random").Random(7)


def voiced(f_start: float, f_peak: float, f_end: float, dur: float, vol: float = 0.6, breath: float = 0.12,
           harmonics: tuple[float, ...] = (1.0, 0.55, 0.3, 0.15), vibrato: float = 0.0) -> list[float]:
    """A pitch contour start → peak (at 30%) → end, built from a few harmonics, so it sounds throaty, not beepy."""
    n = int(RATE * dur)
    out, phase, lp = [], 0.0, 0.0
    for i in range(n):
        x, t = i / max(1, n - 1), i / RATE
        f = f_start + (f_peak - f_start) * (x / 0.3) if x < 0.3 else f_peak + (f_end - f_peak) * ((x - 0.3) / 0.7)
        if vibrato:
            f *= 1 + 0.03 * math.sin(2 * math.pi * vibrato * t)
        phase += 2 * math.pi * f / RATE
        v = sum(a * math.sin((k + 1) * phase) for k, a in enumerate(harmonics) if (k + 1) * f < RATE / 2 - 300)
        lp += 0.35 * (_rng.uniform(-1, 1) - lp)  # soft breath noise
        env = min(1.0, t / 0.008) * (1 - x) ** 1.4
        out.append((v / sum(harmonics) + breath * lp) * env * vol)
    return out


def puppy_yip() -> list[float]:
    return voiced(900, 1500, 1000, 0.09, 0.7)


def puppy_arf() -> list[float]:
    """A tiny 'arf!': low-ish bark with more breath, then a squeaky tail."""
    return voiced(550, 900, 600, 0.11, 0.75, breath=0.25) + voiced(1000, 1250, 900, 0.06, 0.45)


def puppy_whimper() -> list[float]:
    return voiced(1300, 1500, 900, 0.45, 0.5, breath=0.05, harmonics=(1.0, 0.25), vibrato=9)


def puppy_pant(times: int = 3) -> list[float]:
    """Happy 'hah-hah-hah': short breathy bursts."""
    out = []
    for _ in range(times):
        out += voiced(500, 600, 450, 0.07, 0.45, breath=0.9, harmonics=(1.0, 0.4)) + rest(0.06)
    return out


def puppy_yawn() -> list[float]:
    return voiced(700, 1100, 450, 0.6, 0.45, breath=0.2, harmonics=(1.0, 0.5, 0.2))


def yip() -> list[float]:
    """Two puppy yips: quick upward-then-down squeaks."""
    return puppy_yip() + rest(0.07) + [v * 0.85 for v in puppy_yip()] + rest(0.05) + puppy_pant(2)


def match_ding() -> list[float]:
    """Bright ding-ding (sine + a bit of octave shimmer)."""
    d1 = mix(tone(1318, 1318, 0.22, "sine", 0.55, decay=9), tone(1976, 1976, 0.22, "sine", 0.12, decay=14))
    d2 = mix(tone(1760, 1760, 0.32, "sine", 0.55, decay=7), tone(2349, 2349, 0.32, "sine", 0.10, decay=12))
    return d1[: int(RATE * 0.12)] + d2[: int(RATE * 0.22)] + puppy_arf()


def double_yes() -> list[float]:
    """Happy rising arpeggio C5 E5 G5 C6 with a sparkle on top."""
    notes = [523, 659, 784, 1047]
    arp = []
    for f in notes:
        arp += tone(f, f, 0.09, "square", 0.42, decay=6)
    arp += tone(1047, 1047, 0.28, "square", 0.42, decay=5, vibrato=6)
    sparkle = rest(0.36) + tone(1568, 1568, 0.08, "sine", 0.25, decay=20) + tone(2093, 2093, 0.12, "sine", 0.25, decay=16)
    return mix(arp, sparkle) + puppy_yip() + rest(0.05) + puppy_yip()


def womp() -> list[float]:
    """Too slow: two sad descending womps."""
    return tone(392, 330, 0.2, "triangle", 0.6, decay=3) + rest(0.03) + tone(349, 247, 0.3, "triangle", 0.6, decay=2.5) + puppy_whimper()


def coffee() -> list[float]:
    """Bubbly rising blups, then a happy slurp. Square + mid-high pitch: the badge's tiny speaker
    barely moves air below ~600 Hz, so the first (400 Hz sine) version was nearly silent."""
    out = []
    for f in (700, 900, 1150):
        out += tone(f, f * 1.5, 0.08, "square", 0.5, decay=8) + rest(0.03)
    return out + puppy_arf()


def nap() -> list[float]:
    """Soft, slow descending lullaby."""
    out = []
    for f in (1319, 1175, 1047, 784):  # an octave up from the first draft so the small speaker can play it
        out += tone(f, f, 0.15, "triangle", 0.5, attack=0.02, decay=3)
    return puppy_yawn() + rest(0.05) + out


# The pup's voice: macOS `say` with Samantha (the clearest built-in voice), pitched up a little so it sounds
# small and cute. Played right after each effect, in the same clip. Without `say` (not a Mac) effects play alone.
# Pitch-up: the speech is relabelled as faster than it is, then afconvert (Apple's band-limited resampler) brings
# it down to the badge's 8 kHz cleanly; a home-made resampler made it muffled and fizzy.
VOICE, RATE_WPM, PITCH = "Samantha", 155, 1.34  # higher + a touch slower = small, cute, still clear
LINES = {"yip": "hi friend!", "match": "ooh! a match!", "yes": "double yes!", "miss": "aww... too slow",
         "coffee": "coffee time!", "nap": "nap time"}


def voice(text: str) -> list[float]:
    if not shutil.which("say") or not shutil.which("afconvert"):
        return []
    with tempfile.TemporaryDirectory() as d:
        aiff, mid, wav = Path(d) / "v.aiff", Path(d) / "mid.wav", Path(d) / "v.wav"
        subprocess.run(["say", "-v", VOICE, "-r", str(RATE_WPM), "-o", str(aiff), text], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", "-c", "1", str(aiff), str(mid)], check=True)
        with wave.open(str(mid)) as w:
            frames = w.readframes(w.getnframes())
        with wave.open(str(mid), "wb") as w:  # same samples, claimed faster → higher pitch
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(22050 * PITCH)); w.writeframes(frames)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", "-q", "127", str(mid), str(wav)],
                       check=True)
        with wave.open(str(wav)) as w:
            raw = w.readframes(w.getnframes())
    out = [v / 32768 for v in struct.unpack(f"<{len(raw) // 2}h", raw)]
    while out and abs(out[0]) < 0.01:
        out.pop(0)
    while out and abs(out[-1]) < 0.01:  # no trailing silence (the driver plays exactly the clip)
        out.pop()
    peak = max((abs(v) for v in out), default=1) or 1
    # gentle compression: quiet syllables come up, so words stay clear on the tiny speaker
    return [math.tanh(2.2 * v / peak) / math.tanh(2.2) * 0.9 for v in out]


SOUNDS = {"yip": yip, "match": match_ding, "yes": double_yes, "miss": womp, "coffee": coffee, "nap": nap}


def to_int16(samples: list[float]) -> list[int]:
    peak = max(1e-9, max(abs(s) for s in samples))
    g = min(1.0, 0.95 / peak)
    return [max(-32767, min(32767, int(s * g * 32767))) for s in samples]


def main() -> None:
    OUT_WAV.mkdir(parents=True, exist_ok=True)
    parts = ["/* Generated by native/make_sounds.py: synthesized chiptune effects, 8 kHz mono int16. */",
             '#include "photon_sounds.h"', ""]
    total = 0
    for name, fn in SOUNDS.items():
        said = voice(LINES[name]) if name in LINES else []
        tail = rest(0.04) + puppy_pant(3) if name == "yes" else []
        pcm = to_int16(fn() + (rest(0.05) + said if said else []) + tail)
        total += len(pcm)
        with wave.open(str(OUT_WAV / f"{name}.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))
        rows = [", ".join(str(v) for v in pcm[i : i + 20]) for i in range(0, len(pcm), 20)]
        parts.append(f"const int16_t snd_{name}[{len(pcm)}] = {{\n" + ",\n".join(rows) + "\n};")
        parts.append(f"const unsigned snd_{name}_len = {len(pcm)};\n")
    OUT_C.write_text("\n".join(parts) + "\n")
    print(f"{len(SOUNDS)} sounds, {total / RATE:.1f} s, {total * 2 / 1024:.0f} KB → {OUT_C.name}; previews in {OUT_WAV}")


if __name__ == "__main__":
    main()
