#!/usr/bin/env python3
"""Encode assets/audio/*.wav (or tools/source-assets/*.wav) to AAC M4A for the site.

Requires ffmpeg on PATH. Safe for iPhone Safari — do not ship WAV to Pages.

  python tools/encode_audio_m4a.py
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT = os.path.join(ROOT, 'assets', 'audio')
SOURCES = [
    os.path.join(ROOT, 'tools', 'source-assets'),
    OUT,
]

def ffmpeg():
    return shutil.which('ffmpeg') or ''

def main():
    ff = ffmpeg()
    if not ff:
        print('ffmpeg not found on PATH', file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    wavs = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if name.lower().endswith('.wav'):
                wavs.append(os.path.join(d, name))
    if not wavs:
        print('No .wav files found in tools/source-assets or assets/audio')
        return 1
    for src in sorted(set(wavs)):
        base = os.path.splitext(os.path.basename(src))[0]
        dest = os.path.join(OUT, base + '.m4a')
        cmd = [ff, '-y', '-i', src, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dest]
        print('Encoding', base + '.m4a')
        subprocess.check_call(cmd)
    print('Done. Keep WAV masters in tools/source-assets/ (not deployed).')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
