# BPUT Hackathon 2026 — Inauguration (slim)

Three-screen ceremony presentation:

1. **Countdown** — 15 seconds  
2. **Reveal** — “Officially Inaugurated”  
3. **Final photo** — full-bleed closing photograph  

No editor. Open `index.html` in a modern browser (Chrome / Edge recommended).

## Final photograph

Save the closing photo as one of:

- `assets/images/final-photo.jpg` (or `.jpeg` / `.png` / `.webp`)
- `assets/final-photo.jpg` (or `.jpeg` / `.png` / `.webp`)

You can drop it in while the show is running; the Final screen polls every 3 seconds until it finds the file.

Press **P** to toggle fill-screen vs whole-photo framing.

## Sound

Sound starts **on**. Browsers need one click or key press to unlock audio; after that the ambient bed plays. Press **M** to mute.

Cues (in `assets/audio/`):

| File | When |
|------|------|
| `welcome-ambient.wav` | Looping bed on the READY / start page |
| `countdown-pulse.wav` | One pulse per second for displayed 15…2 |
| `reveal-cinematic.wav` | Starts on **1**; impact on **0** |
| `final-chime.wav` | Short chime when the final photo appears |
| `final-ambient.wav` | Final photograph ambient bed |

To regenerate audio (needs NumPy + SciPy):

```bash
python tools/make_audio.py
```

## Operator keys

| Key | Action |
|-----|--------|
| Space / → / Enter | Start the 15 s countdown; later Next (Reveal → Final) |
| S | Skip to reveal |
| R | Restart (back to countdown) |
| F | Full screen |
| M | Sound on / off |
| P | Photo fit (cover / contain) |
| C | Pin / hide controls |
| Tab | Show controls |
| ? / H | Help |

Hover or tap the bottom edge to reveal on-screen controls.

## Timing

- Countdown: **15.0 s** (absolute deadline) + **0.6 s** zero hold  
- Reveal: **7.0 s**, then auto-advance to Final (Space also works after 2.5 s dwell)  
