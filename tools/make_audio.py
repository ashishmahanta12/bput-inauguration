#!/usr/bin/env python3
"""
BPUT Hackathon 2026 - slim ceremony sound design (15 s countdown)
=================================================================
Writes the three cues used by this build to assets/audio/*.wav
Deterministic (fixed random seeds): running it twice gives identical files.

    python tools/make_audio.py            # needs numpy + scipy only, no internet

Timeline (matches app/script.js and styles.css)
  countdown-pulse.wav   14.0 s   one pulse on every displayed second, 15 ... 2
  reveal-cinematic.wav   9.0 s   t=0 is the moment "1" appears; the impact lands at t=1.0 = zero
  final-ambient.wav     42.0 s   calm bed for the final photograph
"""
import os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly
from scipy.io import wavfile

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'audio'))
TWO_PI = 2 * np.pi

# --------------------------------------------------------------------------------------
# basics
# --------------------------------------------------------------------------------------
def n_(sec):  return int(round(sec * SR))
def tt(sec):  return np.arange(n_(sec)) / SR

def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)

_NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def hz(name):
    """'F#4' -> 369.99 Hz"""
    m = _NOTE[name[0]]
    i = 1
    if name[i] == '#': m += 1; i += 1
    elif name[i] == 'b': m -= 1; i += 1
    midi = 12 * (int(name[i:]) + 1) + m
    return 440.0 * 2 ** ((midi - 69) / 12)

def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45) / (SR / 2), 'low', output='sos')
    return sosfilt(sos, x, axis=-1)

def hp(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), 'high', output='sos')
    return sosfilt(sos, x, axis=-1)

def bp(x, lo, hi, order=2):
    sos = butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], 'band', output='sos')
    return sosfilt(sos, x, axis=-1)

def sweep_bp(x, fc_curve, q=1.4, block=256):
    """Band-pass noise whose centre frequency follows fc_curve (one value per sample)."""
    out = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        fc = float(fc_curve[min(i + block // 2, len(x) - 1)])
        bw = fc / q
        lo, hi = max(40.0, fc - bw / 2), min(SR * 0.45, fc + bw / 2)
        sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        y, zi = sosfilt(sos, x[i:i + block], zi=zi)
        out[i:i + block] = y * (1000.0 / fc) ** 0.35        # gentle tilt so high sweeps are not harsh
    return out

def stereo(mono, pan=0.0):
    ang = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(ang), mono * np.sin(ang)])

def add(buf, sig, t0, gain=1.0, pan=0.0, wrap=False):
    s = sig if sig.ndim == 2 else stereo(sig, pan)
    N, n = buf.shape[1], s.shape[1]
    i = n_(t0)
    if wrap:
        i %= N
        first = min(n, N - i)
        buf[:, i:i + first] += s[:, :first] * gain
        if n > first:
            buf[:, :n - first] += s[:, first:n] * gain
    else:
        end = min(N, i + n)
        if end > i:
            buf[:, i:end] += s[:, :end - i] * gain

# --------------------------------------------------------------------------------------
# room reverb (synthetic impulse response: dark late tail, short bright early part)
# --------------------------------------------------------------------------------------
def make_ir(rt60, seed, pre=0.012):
    r = np.random.default_rng(seed)
    n = n_(rt60 * 1.15)
    t = np.arange(n) / SR
    noise = r.standard_normal((2, n))
    low = lp(noise, 2200)
    high = noise - low
    ir = low * np.exp(-6.91 * t / rt60) + 0.55 * high * np.exp(-6.91 * t / (rt60 * 0.32))
    ir *= np.minimum(1.0, t / 0.02)                      # soft onset
    ir[:, :n_(pre)] = 0
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    return ir

def reverb(x, rt60, wet=0.35, seed=7, circular=False):
    """Returns the WET signal only (same length as x). circular=True wraps the tail for seamless loops."""
    ir = make_ir(rt60, seed)
    N = x.shape[1]
    if circular:
        ir = ir[:, :N]
        return np.fft.irfft(np.fft.rfft(x, axis=1) * np.fft.rfft(ir, n=N, axis=1), n=N, axis=1) * wet
    out = np.stack([fftconvolve(x[c], ir[c])[:N] for c in range(2)])
    return out * wet

# --------------------------------------------------------------------------------------
# voices
# --------------------------------------------------------------------------------------
def bell(f, dur, decay, amp=1.0, bright=1.0):
    """Soft glass / bell: sine + a few fast-decaying partials. Attack 3 ms."""
    t = tt(dur)
    s = np.sin(TWO_PI * f * t)
    for ratio, a, k in ((2.0, 0.30, 0.55), (2.76, 0.12, 0.40), (4.1, 0.05, 0.25), (5.4, 0.03, 0.18)):
        if f * ratio < SR * 0.4:
            s += bright * a * np.sin(TWO_PI * f * ratio * t) * np.exp(-t / (decay * k))
    return s * np.minimum(1.0, t / 0.003) * np.exp(-t / decay) * amp

def thump(f_lo, f_hi, dur, tau, amp=1.0, drop=0.035, h2=0.38):
    """Soft electronic pulse: sine with a quick downward pitch drop. 2nd harmonic keeps it audible on laptop speakers."""
    t = tt(dur)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / drop)
    ph = TWO_PI * np.cumsum(f) / SR
    env = np.minimum(1.0, t / 0.005) * np.exp(-t / tau)
    return (np.sin(ph) + h2 * np.sin(2 * ph) * np.exp(-t / (tau * 0.5))) * env * amp

def blip(f, amp=1.0, tau=0.11):
    """Clean 'sonar' ping."""
    t = tt(0.7)
    s = np.sin(TWO_PI * f * t) + 0.12 * np.sin(TWO_PI * 2 * f * t) * np.exp(-t / 0.05)
    return s * np.minimum(1.0, t / 0.008) * np.exp(-t / tau) * amp

def pad_voice(f, n, loop_len=None, detunes=(-7, 0, 6), nh=9, roll=1.6, seed=0):
    """Warm chorused pad voice -> (low, high) bands so brightness can 'breathe' independently."""
    r = np.random.default_rng(seed)
    t = np.arange(n) / SR
    lo = np.zeros(n)
    hi = np.zeros(n)
    for d in detunes:
        ff = f * 2 ** (d / 1200)
        if loop_len:
            ff = round(ff * loop_len) / loop_len            # whole cycles per loop -> phase wraps seamlessly
        for h in range(1, nh + 1):
            fh = ff * h
            if fh > 9000:
                break
            s = np.sin(TWO_PI * fh * t + r.uniform(0, TWO_PI)) / (h ** roll)
            if h <= 2: lo += s
            else:      hi += s
    return lo / len(detunes), hi / len(detunes)

def drone(n, ramp, notes=(('D2', 0.55), ('A2', 0.30), ('D3', 0.12))):
    t = np.arange(n) / SR
    s = np.zeros(n)
    for nm, a in notes:
        f = hz(nm)
        s += a * (np.sin(TWO_PI * f * t) + 0.18 * np.sin(TWO_PI * 2 * f * t))
    return s * ramp

def airy_noise(n, lo, hi, seed, loop=False):
    r = np.random.default_rng(seed)
    x = r.standard_normal(n)
    if loop:                                                  # filter 3 copies, keep the middle one: no seam
        return bp(np.tile(x, 3), lo, hi)[n:2 * n]
    return bp(x, lo, hi)

# --------------------------------------------------------------------------------------
# finishing
# --------------------------------------------------------------------------------------
SCALE = {}                                                    # remembers each file's final gain (for level matching)

def hp_loop(x, fc):
    """High-pass a loop without disturbing the seam (filter three copies, keep the middle one)."""
    n = x.shape[1]
    return hp(np.tile(x, (1, 3)), fc)[:, n:2 * n]

def finish(x, peak=None, rms_db=None, cap=None, fade_in=0.03, fade_out=0.15, loop=False, key=None):
    """Normalise to a PEAK (cues with a clear accent) or to an RMS level (ambient beds), then fade the ends."""
    x = np.tanh(x * 0.9) / np.tanh(0.9)                       # transparent soft limiter
    x = x - x.mean(axis=1, keepdims=True)
    if rms_db is not None:
        g = 10 ** (rms_db / 20) / np.sqrt(np.mean(x ** 2))
        if cap is not None and np.max(np.abs(x)) * g > cap:
            g = cap / np.max(np.abs(x))
    else:
        g = peak / np.max(np.abs(x))
    x = x * g
    if key:
        SCALE[key] = g
    if not loop:
        n = x.shape[1]
        a, b = n_(fade_in), n_(fade_out)
        if a: x[:, :a] *= smooth(np.arange(a) / a)
        if b: x[:, -b:] *= smooth(np.arange(b, 0, -1) / b)
    return x

def write(name, x, rate=SR, loop=False):
    if rate != SR:
        if loop:                                              # periodic extension -> no resampling transient at the seam
            n = x.shape[1]
            x3 = np.tile(x, (1, 3))
            y = resample_poly(x3, 320, 441, axis=1)
            m = y.shape[1] // 3
            x = y[:, m:2 * m]
        else:
            x = resample_poly(x, 320, 441, axis=1)
    r = np.random.default_rng(1)
    d = (r.random(x.shape) - r.random(x.shape)) / 32768.0     # +-1 LSB triangular dither
    pcm = np.clip(np.round((x + d) * 32767), -32768, 32767).astype('<i2')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    wavfile.write(path, rate, pcm.T)
    rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    pk = 20 * np.log10(np.max(np.abs(x)) + 1e-12)
    print(f'{name:24s} {x.shape[1] / rate:6.2f} s  {rate} Hz  peak {pk:6.1f} dBFS  rms {rms:6.1f} dBFS  {os.path.getsize(path) / 1e6:5.2f} MB')

# ======================================================================================
# 1. WELCOME - soft ambient futuristic atmosphere (seamless 40 s loop)
# ======================================================================================
def make_welcome():
    L = 40.0
    N = n_(L)
    t = np.arange(N) / SR
    bed = np.zeros((2, N))
    voicing = [('D2', 1.00, -0.10), ('A2', 0.70, 0.10), ('E3', 0.50, -0.35), ('B3', 0.34, 0.30),
               ('F#4', 0.20, -0.20), ('A4', 0.12, 0.35)]          # D sus2 / add9 - open, bright, unresolved
    for i, (nm, a, pan) in enumerate(voicing):
        lo, hi = pad_voice(hz(nm), N, loop_len=L, seed=10 + i)
        breathe = 0.62 + 0.38 * np.sin(TWO_PI * (1 + i % 3) * t / L + i * 1.3)
        bright = 0.30 + 0.70 * (0.5 + 0.5 * np.sin(TWO_PI * (2 + i % 2) * t / L + i * 0.7))
        add(bed, (lo * breathe + hi * bright * 0.55) * a, 0, pan=pan)
    # sparse glass notes, long tails (D major pentatonic, so any combination is consonant)
    r = np.random.default_rng(2026)
    penta = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'A4', 'B4']
    send = np.zeros((2, N))
    when = 2.0
    while when < L - 3.0:
        nm = penta[r.integers(len(penta))]
        add(send, bell(hz(nm), 6.0, 1.5, amp=r.uniform(0.07, 0.12)), when, pan=r.uniform(-0.7, 0.7), wrap=True)
        when += r.uniform(3.6, 6.2)
    out = bed * 0.85 + reverb(bed, 5.5, 0.45, seed=31, circular=True) + reverb(send, 7.0, 1.1, seed=32, circular=True) + send * 0.25
    out = hp_loop(out, 38)
    out = finish(out, rms_db=-23.5, cap=0.55, loop=True)
    return out

# ======================================================================================
# 2. CHIEF GUEST - gentle, dignified cue (11.5 s)
# ======================================================================================
def make_guest():
    D = 11.5
    N = n_(D)
    t = np.arange(N) / SR
    buf = np.zeros((2, N))
    send = np.zeros((2, N))
    env = smooth((t - 0.1) / 2.6) * (1 - smooth((t - 5.8) / 4.8))       # soft swell, long smooth release
    for i, (nm, a, pan) in enumerate([('D3', 1.0, -0.15), ('A3', 0.8, 0.2), ('D4', 0.6, -0.3), ('F#4', 0.42, 0.3),
                                      ('A4', 0.30, -0.1), ('E5', 0.10, 0.15)]):
        lo, hi = pad_voice(hz(nm), N, seed=40 + i, nh=8, roll=1.7)
        add(buf, (lo + hi * 0.35 * smooth((t - 1.0) / 3.0)) * env * a, 0, pan=pan)   # steady, warm, no pitch movement
    add(buf, drone(N, env * 0.65, notes=(('D2', 0.7), ('A2', 0.25))), 0, pan=0)
    # the motif: A - D - F# - A, rising, unhurried
    for when, nm, amp, decay, pan in ((0.95, 'A4', 0.20, 1.5, -0.25), (1.85, 'D5', 0.20, 1.5, 0.25),
                                      (2.80, 'F#5', 0.19, 1.7, -0.2), (3.95, 'A5', 0.22, 2.4, 0.15)):
        add(send, lp(bell(hz(nm), 7.0, decay, amp=amp * 0.8, bright=0.35), 3800), when - 0.35, pan=pan)
    out = buf * 0.7 + reverb(buf, 3.8, 0.38, seed=41) + reverb(send, 4.2, 0.9, seed=42) + send * 0.35
    return finish(hp(out, 40), rms_db=-19.5, cap=0.62, fade_in=0.05, fade_out=1.8)

# ======================================================================================
# 3. COUNTDOWN - 14.0 s of pulses, one on every displayed second 15 ... 2
#    (the program starts the reveal cue when "1" appears, so this file ends exactly there)
# ======================================================================================
def make_countdown():
    D = 14.0
    PULSES = 14                                                    # seconds 15 ... 2
    N = n_(D)
    t = np.arange(N) / SR
    dry = np.zeros((2, N))
    send = np.zeros((2, N))
    penta = [hz(n) for n in ('D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'E5', 'F#5', 'A5', 'B5', 'D6')]

    # --- underlying drone: barely there at 15, rising faster across the shorter window
    ramp = 0.045 + 0.20 * smooth(t / (D - 1.0)) ** 1.3
    ramp *= smooth(t / 0.8) * (1 - smooth((t - (D - 0.06)) / 0.06))
    ramp *= 1 + 0.10 * np.cos(TWO_PI * t)
    add(dry, drone(N, ramp), 0, pan=0)

    # --- soft tonal rise: D4 -> D5 over the last ~8 s (compressed from the 30 s design)
    rise_at = 6.0
    tr = np.clip(t - rise_at, 0, None)
    gf = hz('D4') * 2 ** (tr / (D - rise_at))
    rise = np.sin(TWO_PI * np.cumsum(gf) / SR) * (smooth(tr / (D - rise_at)) ** 2) * 0.055 * (t >= rise_at)
    add(send, rise, 0, pan=0)

    # --- one pulse per second, each a little different from the last
    for k in range(0, PULSES):
        p = k / (PULSES - 1.0)
        q = p ** 1.5
        f_lo = 78 + 30 * p
        add(dry, thump(f_lo, f_lo * 2.1, 0.55, 0.12 + 0.03 * (1 - p), amp=0.22 + 0.50 * q), k, pan=0)
        f = penta[int(round(p * (len(penta) - 1)))]
        pg = blip(f, amp=0.040 + 0.130 * q)
        add(send, pg, k, pan=-0.15)
        add(send, pg, k + 0.375, gain=0.30, pan=0.55)
        add(send, pg, k + 0.750, gain=0.11, pan=-0.55)
        if k >= 5:                                                   # last ten displayed seconds (10 ... 2): off-beat ticks
            tk = bell(hz('D6') if k % 2 else hz('A5'), 0.25, 0.05, amp=0.04 + 0.05 * q)
            add(send, tk, k + 0.5, pan=-0.3 if k % 2 else 0.3)
        if k >= 11:                                                  # last three (4 ... 2): quarter-note shimmer
            tk = bell(hz('F#6'), 0.2, 0.04, amp=0.03 + 0.03 * q)
            add(send, tk, k + 0.25, pan=0.4)
            add(send, tk, k + 0.75, pan=-0.4)

    # --- milestones that match the on-screen colour changes: 10 s and 5 s remaining
    #     displayed 15 at t=0 → 10 remaining at t=5; 5 remaining at t=10
    add(send, bell(hz('A5'), 3.0, 0.9, amp=0.075), 5.0, pan=-0.2)
    add(send, bell(hz('D6'), 3.0, 1.0, amp=0.09), 10.0, pan=0.2)
    add(send, bell(hz('A5'), 3.0, 0.9, amp=0.06), 10.0, pan=-0.3)

    out = dry + reverb(send, 1.9, 0.42, seed=71) + send * 0.75 + reverb(dry, 1.2, 0.10, seed=72)
    return finish(hp(out, 36), 0.55, fade_in=0.01, fade_out=0.06, key='countdown')

# ======================================================================================
# 4. REVEAL - refined cinematic whoosh + soft impact at zero (14.0 s)
#    t = 0.0  the moment "1" appears (the program starts this file then)
#    t = 1.0  zero  -> impact
#    t = 2.8  the particle burst on the reveal screen (zero + 0.6 s hold + 1.2 s) -> a soft bloom
# ======================================================================================
def make_reveal(lead=1.0):
    D = 9.0
    N = n_(D)
    t = np.arange(N) / SR
    dry = np.zeros((2, N))
    send = np.zeros((2, N))
    IMPACT = 1.0

    # --- t = 0: the final pulse (same voice as the countdown) - drone carries on from where the countdown stopped
    add(dry, thump(108, 227, 0.6, 0.12, amp=0.72 * lead), 0.0)
    add(send, blip(hz('D6'), amp=0.17 * lead), 0.0, pan=-0.15)
    add(send, blip(hz('D6'), amp=0.17 * lead), 0.375, gain=0.30, pan=0.55)
    ramp = 0.245 * lead * smooth(t / 0.04) * (1 + 0.10 * np.cos(TWO_PI * t) * (t < 1.0))
    ramp *= np.where(t < IMPACT, 1.0, 1.0 + 0.5 * np.exp(-(t - IMPACT) / 1.0) / max(lead, 0.2)) * (1 - smooth((t - 4.2) / 3.0))
    add(dry, drone(N, ramp), 0, pan=0)

    # --- the whoosh: a band of air that rises and opens, then lands on the impact
    n_w = n_(0.98)
    tw = np.arange(n_w) / SR
    fc = 230 * (7600 / 230) ** (tw / 0.98) ** 1.15
    r = np.random.default_rng(81)
    whoosh = np.stack([sweep_bp(r.standard_normal(n_w), fc), sweep_bp(r.standard_normal(n_w), fc)])
    whoosh *= smooth((tw - 0.04) / 0.94) ** 2.2 * 0.62
    whoosh *= 1 - smooth((tw - 0.955) / 0.025)                        # hand over to the impact cleanly
    add(dry, whoosh, 0.0)
    # a soft tonal glide inside the whoosh (G3 -> G5), barely audible, gives it direction
    gl = tw
    gf = hz('G3') * 4 ** (gl / 0.98)
    glide = np.sin(TWO_PI * np.cumsum(gf) / SR) * smooth((tw - 0.1) / 0.8) ** 2 * (1 - smooth((tw - 0.95) / 0.03)) * 0.085
    add(send, glide, 0.0, pan=0)

    # --- the impact at zero: low body + soft shimmer. Powerful in feel, soft in edge.
    add(dry, thump(46, 112, 2.4, 0.62, amp=0.95, drop=0.09, h2=0.22), IMPACT)
    body = lp(np.random.default_rng(82).standard_normal(n_(0.4)), 210, 3) * np.exp(-np.arange(n_(0.4)) / SR / 0.07)
    add(dry, body / (np.max(np.abs(body)) + 1e-9) * 0.42, IMPACT)
    for nm, amp, dec, pan, off in (('D5', 0.17, 2.6, -0.3, 0.0), ('A5', 0.15, 2.6, 0.3, 0.012), ('D6', 0.12, 2.4, -0.15, 0.024),
                                   ('F#6', 0.065, 2.0, 0.2, 0.036)):
        add(send, bell(hz(nm), 8.0, dec, amp=amp), IMPACT + off, pan=pan)
    # the exhale: air falling away after the hit
    n_e = n_(1.9)
    te = np.arange(n_e) / SR
    fe = 6200 * (520 / 6200) ** (te / 1.9)
    re = np.random.default_rng(83)
    exhale = np.stack([sweep_bp(re.standard_normal(n_e), fe), sweep_bp(re.standard_normal(n_e), fe)]) * (np.exp(-te / 0.55) * 0.20)
    add(dry, exhale, IMPACT)

    # --- the pad that carries the reveal screen, with one soft bloom when the particles burst
    BLOOM = IMPACT + 1.8
    env = smooth((t - IMPACT + 0.1) / 1.6) * np.where(t < 3.2, 1.0, np.exp(-(t - 3.2) / 1.7))
    env = env * (1 + 0.55 * np.exp(-((t - BLOOM) / 0.55) ** 2))
    pad = np.zeros((2, N))
    for i, (nm, a, pan) in enumerate([('D3', 1.0, -0.15), ('A3', 0.85, 0.15), ('D4', 0.65, -0.3), ('F#4', 0.5, 0.3),
                                      ('A4', 0.38, -0.12), ('E5', 0.2, 0.12), ('D5', 0.22, 0.25)]):
        lo, hi = pad_voice(hz(nm), N, seed=90 + i, nh=8, roll=1.6)
        add(pad, (lo + hi * 0.5) * a, 0, pan=pan)
    pad *= env * 0.085
    for j, nm in enumerate(('D5', 'F#5', 'A5', 'D6', 'F#6')):         # the bloom arpeggio, soft
        add(send, bell(hz(nm), 6.0, 1.9, amp=0.075 - 0.007 * j), BLOOM + 0.085 * j, pan=-0.4 + 0.2 * j)
    dry += pad

    out = dry * 0.9 + reverb(dry, 3.8, 0.28, seed=84) + reverb(send, 4.8, 0.95, seed=85) + send * 0.32
    return finish(hp(out, 32), 0.88, fade_in=0.01, fade_out=2.2, key='reveal')

# ======================================================================================
# 5. MID-EVALUATION - short, clean notification (2.2 s)
# ======================================================================================
def make_mid():
    D = 2.4
    N = n_(D)
    send = np.zeros((2, N))
    add(send, bell(hz('E5'), 1.6, 0.30, amp=0.60, bright=0.6), 0.00, pan=-0.12)
    add(send, bell(hz('B5'), 1.9, 0.46, amp=0.55, bright=0.6), 0.15, pan=0.12)
    add(send, bell(hz('E6'), 1.9, 0.52, amp=0.22, bright=0.4), 0.15, pan=0.0)       # a touch of sparkle on the second note
    out = send + reverb(send, 1.2, 0.30, seed=95)
    return finish(hp(out, 120), 0.60, fade_in=0.004, fade_out=0.45)

# ======================================================================================
# 6. FINAL PHOTOGRAPH - calm ambient that fades out smoothly (42 s)
# ======================================================================================
def make_final():
    D = 42.0
    N = n_(D)
    t = np.arange(N) / SR
    bed = np.zeros((2, N))
    send = np.zeros((2, N))
    env = smooth(t / 5.0) * (1 - smooth((t - 18.0) / 21.0))               # 5 s in, long smooth fade, silent by 39 s
    for i, (nm, a, pan) in enumerate([('D2', 0.9, 0.0), ('A2', 0.55, 0.12), ('D3', 0.8, -0.18), ('A3', 0.6, 0.2),
                                      ('E4', 0.4, -0.3), ('F#4', 0.36, 0.3), ('A4', 0.22, -0.12), ('B4', 0.12, 0.15)]):
        lo, hi = pad_voice(hz(nm), N, seed=120 + i, nh=8, roll=1.7)
        breathe = 0.7 + 0.3 * np.sin(TWO_PI * (0.05 + 0.013 * i) * t + i)
        add(bed, (lo * breathe + hi * 0.45 * breathe) * a, 0, pan=pan)
    bed *= env * 0.9
    r = np.random.default_rng(130)
    notes = ['A5', 'F#5', 'E5', 'D5', 'B4', 'A4', 'D5', 'F#5', 'A5', 'E5']
    when = 3.5
    for nm in notes:
        e = float(1 - smooth((when - 16.0) / 20.0))
        add(send, bell(hz(nm), 8.0, 1.9, amp=0.11 * e), when, pan=r.uniform(-0.6, 0.6))
        when += r.uniform(3.2, 4.6)
    out = bed * 0.85 + reverb(bed, 5.2, 0.45, seed=133) + reverb(send, 6.0, 1.0, seed=134) + send * 0.28
    return finish(hp(out, 36), rms_db=-23.5, cap=0.55, fade_in=0.05, fade_out=1.0)

# --------------------------------------------------------------------------------------
if __name__ == '__main__':
    print('writing to', OUT)
    write('countdown-pulse.wav',  make_countdown())
    make_reveal(1.0)                                      # pass 1: learn this file's final gain
    lead = 1.05 * SCALE['countdown'] / SCALE['reveal']    # the reveal's first pulse = the countdown's last pulse, +0.4 dB
    write('reveal-cinematic.wav', make_reveal(lead))
    write('final-ambient.wav',    make_final(),     rate=32000)
