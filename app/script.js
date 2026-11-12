/* =====================================================================
   BPUT inauguration — Countdown (15s) → Reveal → Final photo
   Plain JavaScript, no libraries. Sound muted until the operator presses M.
   ===================================================================== */
(() => {
  'use strict';

  const ext = (base, list) => list.map(e => `${base}.${e}`);

  const CONFIG = {
    assets: {
      finalPhoto: [
        ...ext('assets/images/final-photo', ['jpg', 'jpeg', 'png', 'webp']),
        ...ext('assets/final-photo', ['jpg', 'jpeg', 'png', 'webp']),
      ],
    },
    audio: {
      dir: 'assets/audio/',
      defaultVolume: 100,
      muteFadeMs: 450,
      restartFadeMs: 500,
      resumeFadeMs: 600,
      skipRevealOffset: 0.55,
      resyncMs: 120,
      preloadDelayMs: 2500,
      cues: {
        ready:      { file: 'welcome-ambient.wav',  loop: true, gain: 1,    fadeIn: 1800, fadeOut: 900 },
        countdown:  { file: 'countdown-pulse.wav',  gain: 1,    fadeIn: 0,    fadeOut: 150 },
        reveal:     { file: 'reveal-cinematic.wav', gain: 1,    fadeIn: 0,    fadeOut: 700 },
        finalChime: { file: 'final-chime.wav',      gain: 1.15, fadeIn: 0,    fadeOut: 400 },
        final:      { file: 'final-ambient.wav',    gain: 1.45, fadeIn: 400,  fadeOut: 1500 },
      },
    },
    countdownSeconds: 15,
    zeroHoldMs: 600,
    revealMs: 7000,
    revealMinDwellMs: 2500,
    transitionLockMs: 700,
    finalPhotoPosition: '50% 35%',
    finalPhotoFit: 'cover',
    particles: 48,
    idleHideMs: 3500,
    controlsShowMs: 4500,
  };

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();

  const stage = $('#stage');
  const iTargets = ['.bg-glow', '#pulseRing', '.count-bg', '#cdNum'].map(q => $(q)).filter(Boolean);
  function setI(v) { iTargets.forEach(e => e.style.setProperty('--i', v)); }
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches) || params.has('simple');
  root.classList.toggle('reduced', reduced);

  const timers = new Set();
  const schedule = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  let stageScale = 1;
  function applyScale() {
    stageScale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--s', stageScale.toFixed(5));
    fx.resize(stageScale);
  }

  function tryLoad(list) {
    return new Promise(resolve => {
      let i = 0;
      const next = () => {
        if (i >= list.length) return resolve(null);
        const src = list[i++];
        const im = new Image();
        im.onload = () => resolve(src);
        im.onerror = next;
        im.src = src;
      };
      next();
    });
  }

  const assetState = {};
  function showStatus() {
    const el = $('#assetStatus');
    const lines = [
      assetState.finalPhoto
        ? 'OK       final photograph found'
        : 'not yet  final photograph — save as assets/images/final-photo.jpg',
      '',
      'Visual mode  ' + perf.tier.toUpperCase() + '  (' + perf.reason + ')',
    ];
    if (el) el.textContent = lines.join('\n');
  }

  function applyAsset(key, src) {
    assetState[key] = src;
    $$(`[data-asset="${key}"]`).forEach(holder => {
      const img = $('img', holder);
      if (src) {
        img.src = src;
        img.decoding = 'async';
        holder.classList.remove('missing');
        delete holder.dataset.ph;
      } else {
        holder.classList.add('missing');
        const first = CONFIG.assets[key][0];
        holder.dataset.ph = `FINAL PHOTOGRAPH NOT FOUND\n\nSave your photo as  assets/images/final-photo.jpg\n(.jpg, .jpeg, .png or .webp)\n\nThis screen stays up until you restart.`;
      }
    });
  }

  async function resolveAsset(key, fresh) {
    const list = fresh ? CONFIG.assets[key].map(p => p + '?t=' + Date.now()) : CONFIG.assets[key];
    const src = await tryLoad(list);
    applyAsset(key, src);
    return src;
  }

  function watchFinalPhoto() {
    if (assetState.finalPhoto) return;
    resolveAsset('finalPhoto', true).then(src => {
      showStatus();
      if (!src && state === 'FINAL_PHOTO') schedule(watchFinalPhoto, 3000);
    });
  }

  const perf = (() => {
    const TIERS = ['high', 'mid', 'low'];
    const forced = params.get('perf');
    const isForced = TIERS.includes(forced);
    let tier = 'high', reason = '', monitorRaf = 0;
    const listeners = [];

    function softwareRenderer() {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (!gl) return 'no WebGL';
        const e = gl.getExtension('WEBGL_debug_renderer_info');
        const name = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : '';
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
        return /swiftshader|llvmpipe|software|basic render|softpipe/i.test(name) ? name : '';
      } catch (err) { return ''; }
    }
    function detect() {
      if (isForced) return [forced, 'forced by ?perf=' + forced];
      if (reduced) return ['low', 'reduced motion / simple mode'];
      const cores = navigator.hardwareConcurrency || 4;
      const mem = navigator.deviceMemory || 8;
      const soft = softwareRenderer();
      if (soft) return ['low', 'no GPU acceleration (' + soft + ')'];
      if (cores <= 2 || mem <= 2) return ['low', cores + ' cores, ' + mem + ' GB'];
      const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      if (cores <= 4 || mem <= 4 || coarse) return ['mid', cores + ' cores, ' + mem + ' GB' + (coarse ? ', touch device' : '')];
      return ['high', cores + ' cores, ' + mem + ' GB'];
    }
    function apply(t, why) {
      tier = t; reason = why;
      TIERS.forEach(x => root.classList.toggle('perf-' + x, x === t));
      listeners.forEach(fn => fn(t));
      console.info('[BPUT] performance tier:', t, '(' + why + ')');
    }
    function lower(why) {
      const i = TIERS.indexOf(tier);
      if (i < TIERS.length - 1) apply(TIERS[i + 1], why);
      if (tier === 'low') stopMonitor();
    }
    function startMonitor() {
      if (isForced || monitorRaf) return;
      let last = 0, wStart = 0, frames = 0, peak = 0, bad = 0;
      const t0 = now();
      const tick = t => {
        monitorRaf = requestAnimationFrame(tick);
        if (document.hidden) { last = 0; return; }
        if (!last) { last = t; wStart = t; frames = 0; return; }
        const dt = t - last; last = t;
        if (dt > 250) { wStart = t; frames = 0; return; }
        frames++;
        if (t - wStart < 1500) return;
        const fps = frames * 1000 / (t - wStart); wStart = t; frames = 0;
        if (now() - t0 < 2500) return;
        peak = Math.max(peak, fps);
        const floor = Math.max(24, Math.min(40, peak * 0.72));
        bad = fps < floor ? bad + 1 : 0;
        if (bad >= 2) { bad = 0; lower('measured ' + fps.toFixed(0) + ' fps'); }
      };
      monitorRaf = requestAnimationFrame(tick);
    }
    function stopMonitor() { cancelAnimationFrame(monitorRaf); monitorRaf = 0; }
    function init() { const [t, why] = detect(); apply(t, why); startMonitor(); }
    function refresh() { if (isForced) return; stopMonitor(); const [t, why] = detect(); apply(t, why); startMonitor(); }
    return { init, refresh, onChange: fn => listeners.push(fn), get tier() { return tier; }, get reason() { return reason; } };
  })();

  const fx = (() => {
    const canvas = $('#fx');
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return { start() {}, stop() {}, setMode() {}, setIntensity() {}, resize() {}, setQuality() {} };

    const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
    let parts = [], mode = 'ambient', modeT = 0, intensity = 0;
    let raf = 0, last = 0, running = false, q = 1, clock = 0, scaleNow = 1;
    const MULT = { high: 1, mid: 0.45, low: 0.18 };
    // Cap canvas pixel ratio — 2x DPR at 1920×1080 was a major Reveal GPU spike.
    const QCAP = { high: 1.25, mid: 1, low: 0.75 };
    const isLow = () => perf.tier === 'low';
    const COLORS = ['77,143,255', '255,255,255', '224,192,120'];
    const LINK = '77,143,255';

    function make(i) {
      const z = 0.35 + Math.random() * 0.65;
      return {
        x: Math.random() * W, y: Math.random() * H, z,
        r: (0.9 + Math.random() * 1.9) * z,
        vx: (Math.random() - 0.5) * 12 * z, vy: -(4 + Math.random() * 10) * z,
        hue: i % 9 === 0 ? 2 : (i % 5 === 0 ? 1 : 0),
        tw: Math.random() * 6.28, bx: 0, by: 0,
      };
    }
    const count = () => {
      const heavy = mode === 'converge' || mode === 'burst';
      const base = CONFIG.particles * (MULT[perf.tier] || 1) * (heavy ? 0.55 : 1);
      const n = Math.max(10, Math.round(base));
      return reduced ? Math.min(24, n) : n;
    };
    function populate() { parts = Array.from({ length: count() }, (_, i) => make(i)); }
    function trimToMode() {
      const n = count();
      if (parts.length > n) parts.length = n;
      else while (parts.length && parts.length < n) parts.push(make(parts.length));
    }

    function setMode(m) {
      if (m === mode) return;
      mode = m; modeT = 0;
      trimToMode();
      if (m === 'burst') {
        parts.forEach(p => {
          const dx = p.x - CX, dy = p.y - CY, d = Math.hypot(dx, dy) || 1;
          const sp = 220 + Math.random() * 700;
          p.bx = dx / d * sp; p.by = dy / d * sp;
          if (d < 4) { const a = Math.random() * 6.28; p.bx = Math.cos(a) * sp; p.by = Math.sin(a) * sp; }
        });
      }
    }
    function setIntensity(v) { intensity = clamp(v, 0, 1); }

    function step(dt) {
      modeT += dt;
      for (const p of parts) {
        if (mode === 'ambient' || mode === 'countdown') {
          const k = mode === 'countdown' ? 1 + 3.2 * intensity : 1;
          p.x += p.vx * dt * k; p.y += p.vy * dt * k;
          if (mode === 'countdown' && intensity > 0.02) {
            const a = 0.06 * intensity * p.z * dt, c = Math.cos(a), s = Math.sin(a);
            const dx = p.x - CX, dy = p.y - CY;
            p.x = CX + dx * c - dy * s; p.y = CY + dx * s + dy * c;
          }
        } else if (mode === 'converge') {
          const f = 1 - Math.exp(-dt * (1.1 + modeT * 1.2) * (0.7 + p.z * 0.5));
          const dx = CX - p.x, dy = CY - p.y;
          p.x += dx * f - dy * 0.35 * f; p.y += dy * f + dx * 0.35 * f;
        } else if (mode === 'burst') {
          p.x += p.bx * dt; p.y += p.by * dt;
          const dec = Math.exp(-dt * 1.2); p.bx *= dec; p.by *= dec;
        }
        if (p.x < -30) p.x += W + 60; else if (p.x > W + 30) p.x -= W + 60;
        if (p.y < -30) p.y += H + 60; else if (p.y > H + 30) p.y -= H + 60;
      }
    }

    function draw() {
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const linking = (mode === 'ambient' || mode === 'countdown') && !isLow();
      const reach = (perf.tier === 'mid' ? 100 : 120) + intensity * 50;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const a = (0.22 + 0.55 * p.z) * (0.78 + 0.22 * Math.sin(clock * 1.8 + p.tw));
        ctx.fillStyle = `rgba(${COLORS[p.hue]},${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (mode === 'converge' || mode === 'burst' ? 0.5 : 0), 0, 6.283); ctx.fill();
        if (linking && p.z > 0.6) {
          for (let j = i + 1; j < parts.length; j++) {
            const o = parts[j];
            if (o.z <= 0.6) continue;
            const dx = p.x - o.x, dy = p.y - o.y, d2 = dx * dx + dy * dy;
            if (d2 < reach * reach) {
              const la = (1 - Math.sqrt(d2) / reach) * (0.16 + 0.18 * intensity);
              ctx.strokeStyle = `rgba(${LINK},${la.toFixed(3)})`;
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(o.x, o.y); ctx.stroke();
            }
          }
        }
      }
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      const el = t - last;
      // Reveal converge/burst: cap ~30fps so CSS title/rings stay smooth.
      const heavy = mode === 'converge' || mode === 'burst';
      if ((isLow() || heavy) && el < 30) return;
      const dt = Math.min(0.05, (el / 1000) || 0);
      last = t; clock += dt;
      step(dt); draw();
    }
    function start() {
      if (!parts.length) populate();
      if (reduced) { stop(); draw(); return; }
      if (running) return;
      running = true; last = now(); raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }
    function resize(scale) {
      scaleNow = scale;
      const cap = QCAP[perf.tier] || 2;
      q = Math.min(cap, Math.max(0.5, scale * (window.devicePixelRatio || 1)));
      const w = Math.round(W * q), h = Math.round(H * q);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (parts.length && (!running || reduced)) draw();
    }
    function setQuality() {
      const n = count();
      if (parts.length > n) parts.length = n;
      else while (parts.length && parts.length < n) parts.push(make(parts.length));
      resize(scaleNow);
    }
    return { start, stop, setMode, setIntensity, resize, setQuality };
  })();

  const sound = (() => {
    const A = CONFIG.audio;
    const btn = $('#btnSnd'), vol = $('#vol');
    const cues = {};
    let enabled = true, unlocked = false, unlockAt = 0, ticker = 0, stateAt = 0, lastResync = 0;
    let revealCued = false, revealAt = 0;

    const master = () => { const v = clamp(vol.value / 100, 0, 1); return v * v; };
    const apply  = c => {
      const v = clamp(c.level * c.d.gain * master(), 0, 1);
      if (c.vol !== undefined && Math.abs(v - c.vol) < 0.002 && v > 0 && v < 1) return;
      c.vol = v;
      try { c.el.volume = v; } catch (e) { /* ignore */ }
    };
    const later  = fn => setTimeout(() => { try { fn(); } catch (e) { console.warn('[BPUT] sound:', e); } }, 0);
    const list   = () => Object.keys(cues).map(k => cues[k]);
    const available = () => list().some(c => !c.failed);

    function fadeTo(c, target, ms, then) {
      c.from = c.level; c.target = target; c.t0 = now(); c.dur = Math.max(1, ms); c.then = then || null;
      if (ms <= 0) { c.level = target; apply(c); c.dur = -1; c.then = null; if (then) then(); return; }
      if (!ticker) ticker = setInterval(step, 40);
    }
    function step() {
      const t = now();
      list().forEach(c => {
        if (c.dur < 0) return;
        const k = clamp((t - c.t0) / c.dur, 0, 1);
        c.level = c.from + (c.target - c.from) * (k * k * (3 - 2 * k));
        apply(c);
        if (k >= 1) { c.dur = -1; const fn = c.then; c.then = null; if (fn) fn(); }
      });
      if (!list().some(c => c.dur >= 0)) { clearInterval(ticker); ticker = 0; }
    }

    function release(c, ms) {
      if (!c.playing) return;
      fadeTo(c, 0, ms != null ? ms : c.d.fadeOut, () => {
        try { c.el.pause(); c.el.currentTime = 0; } catch (e) { /* ignore */ }
        c.playing = false; c.level = 0;
      });
    }
    function ensureSrc(c) {
      if (c.requested) return;
      c.requested = true;
      c.el.preload = 'auto';
      c.el.src = A.dir + c.d.file;
    }
    function play(name, o) {
      o = o || {};
      if (!enabled || !unlocked) return; // unlocked after the first click/key (browser autoplay rule)
      const c = cues[name];
      if (!c || c.failed) return;
      list().forEach(x => { if (x !== c && x.playing && x.target !== 0) release(x); });
      if (c.playing && !o.restart) {
        if (c.target < 1) fadeTo(c, 1, A.resumeFadeMs);
        return;
      }
      ensureSrc(c);
      const fi = o.fadeIn != null ? o.fadeIn : c.d.fadeIn;
      c.then = null; c.dur = -1;
      try { c.el.currentTime = o.offset || 0; } catch (e) { /* ignore */ }
      c.level = fi > 0 ? 0 : 1; apply(c);
      c.playing = true;
      const p = c.el.play();
      if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') blocked(c); });
      fadeTo(c, 1, fi);
    }
    function blocked(c) {
      c.playing = false;
      unlocked = false;
      // Keep Sound on in the UI; browsers need one click/key before audio can start.
      toast('Tap or press any key once to start sound.', 4000);
    }

    function syncToState() {
      const age = now() - stateAt;
      switch (state) {
        case 'COUNTDOWN': {
          if (!countdown.active || countdown.done) {
            play('ready'); // waiting / READY page ambient
            break;
          }
          const e = countdown.elapsed;
          if (e < CONFIG.countdownSeconds - 1.7) play('countdown', { restart: true, offset: e, fadeIn: 500 });
          break;
        }
        case 'INAUGURATION_REVEAL': {
          const e = (now() - revealAt) / 1000;
          if (e < 8) play('reveal', { restart: true, offset: Math.max(0, e), fadeIn: e > 1.5 ? 700 : 0 });
          break;
        }
        case 'FINAL_PHOTO':
          play('final', { restart: true, offset: Math.min(age / 1000, 20), fadeIn: 500 });
          break;
        default: break;
      }
    }

    function beginFinal() {
      unlock();
      play('finalChime', { restart: true });
      schedule(() => {
        if (state === 'FINAL_PHOTO') play('final', { restart: true, fadeIn: 400 });
      }, 1100);
    }

    function onState(next) {
      stateAt = now();
      try {
        switch (next) {
          case 'COUNTDOWN':
            revealCued = false;
            // Ambient bed on the READY page; countdown pulses start only after Start
            play('ready');
            // Warm the reveal cue so decode doesn't hitch at zero → reveal.
            if (cues.reveal) ensureSrc(cues.reveal);
            break;
          case 'INAUGURATION_REVEAL':
            if (!revealCued) {
              revealCued = true;
              revealAt = now() - A.skipRevealOffset * 1000;
              play('reveal', { restart: true, offset: A.skipRevealOffset });
            }
            break;
          case 'FINAL_PHOTO':
            beginFinal();
            break;
          default: break;
        }
      } catch (e) { console.warn('[BPUT] sound:', e); }
    }

    function countdownTick(n) {
      if (n === 1) {
        revealCued = true;
        const dueAt = countdown.deadline - 1000;
        revealAt = dueAt;
        later(() => {
          const late = Math.max(0, (now() - dueAt) / 1000);
          play('reveal', { restart: true, offset: late > 0.03 ? late : 0 });
        });
        return;
      }
      const c = cues.countdown;
      if (!c || !c.playing || n >= CONFIG.countdownSeconds) return;
      const el = c.el;
      if (!el.seeking && now() - lastResync > 2500 && Math.abs(el.currentTime - countdown.elapsed) > A.resyncMs / 1000) {
        lastResync = now();
        setTimeout(() => {
          if (!c.playing || state !== 'COUNTDOWN') return;
          try { el.volume = 0; el.currentTime = countdown.elapsed + 0.02; } catch (e) { /* ignore */ }
          setTimeout(() => apply(c), 45);
        }, 350);
      }
    }

    function reset() {
      revealCued = false;
      list().forEach(c => { if (c.playing) release(c, A.restartFadeMs); });
    }

    function label() {
      btn.textContent = enabled ? 'Sound on' : 'Sound off';
      btn.setAttribute('aria-pressed', String(enabled));
      btn.setAttribute('aria-label', 'Sound: ' + (enabled ? 'on' : 'off') + ' (M)');
    }
    function preload() { list().forEach(ensureSrc); }
    function prime() {
      list().forEach(c => {
        if (c.playing || c.failed || c.primed) return;
        c.primed = true;
        c.el.muted = true;
        const done = () => { if (!c.playing) { try { c.el.pause(); c.el.currentTime = 0; } catch (e) { /* ignore */ } } c.el.muted = false; };
        const p = c.el.play();
        if (p && p.then) p.then(done, () => { c.el.muted = false; }); else done();
      });
    }
    function unlock() {
      if (!enabled || unlocked) return;
      preload();
      if (!available()) {
        enabled = false; label();
        toast('No sound files found in ' + A.dir, 5000);
        return;
      }
      unlocked = true;
      unlockAt = now();
      prime();
      syncToState();
    }
    function toggle() {
      // First click on "Sound on" also unlocks audio (pointerdown). Don't treat that same click as mute.
      if (enabled && unlocked && now() - unlockAt < 600) {
        label();
        toast('Sound on.', 1500);
        return;
      }
      if (enabled && unlocked) {
        enabled = false; unlocked = false; unlockAt = 0; label();
        list().forEach(c => { if (c.playing) release(c, A.muteFadeMs); });
        toast('Sound muted.', 1500);
        return;
      }
      enabled = true; label();
      if (!unlocked) unlock();
      else syncToState();
      toast('Sound on.', 1500);
    }
    function setVolume() { list().forEach(apply); }

    function init() {
      vol.value = A.defaultVolume;
      Object.keys(A.cues).forEach(name => {
        const d = A.cues[name];
        const el = new Audio();
        el.preload = 'none'; el.loop = !!d.loop; el.volume = 0;
        const c = { name, d, el, level: 0, from: 0, target: 0, t0: 0, dur: -1, then: null, playing: false, failed: false, requested: false, primed: false };
        el.addEventListener('error', () => {
          c.failed = true; c.playing = false;
          console.warn('[BPUT] sound file not found or not playable:', A.dir + d.file);
          if (!available()) { enabled = false; label(); btn.disabled = true; btn.title = 'No sound files in ' + A.dir; }
        });
        el.addEventListener('ended', () => { c.playing = false; c.level = 0; c.dur = -1; c.then = null; });
        cues[name] = c;
      });
      label();
      preload();
      // Browsers block autoplay until a gesture — unlock on the first click/key.
      const arm = () => unlock();
      document.addEventListener('pointerdown', arm, { capture: true, once: true, passive: true });
      document.addEventListener('keydown', arm, { capture: true, once: true });
      setTimeout(preload, A.preloadDelayMs);
    }
    function beginCountdown() { unlock(); play('countdown', { restart: true }); }
    return { init, toggle, setVolume, onState, countdownTick, beginCountdown, beginFinal, unlock, reset, label, get on() { return enabled; } };
  })();

  const countdown = (() => {
    const numEl = $('#cdNum'), ringProg = $('#ringProg'), ringHead = $('#ringHead'), pulse = $('#pulseRing');
    const unitEl = $('#cdUnit');
    const screenEl = $('#screen-COUNTDOWN');
    const R = 372, C = 2 * Math.PI * R;
    const total = CONFIG.countdownSeconds * 1000;
    let running = false, done = false, deadline = 0, startedAt = 0, raf = 0, watchdog = 0, shown = null, tickCb = null;

    ringProg.style.strokeDasharray = C.toFixed(2);

    function setNumber(n) {
      numEl.classList.remove('is-ready');
      if (unitEl) unitEl.hidden = false;
      const old = numEl.lastElementChild;
      if (old) { old.classList.remove('in'); old.classList.add('out'); setTimeout(() => old.remove(), 520); }
      const el = document.createElement('span');
      el.className = 'n in'; el.textContent = String(n);
      numEl.appendChild(el);
      numEl.setAttribute('aria-label', n + (n === 1 ? ' second remaining' : ' seconds remaining'));
    }
    function setRing(progress) {
      ringProg.style.strokeDashoffset = (C * progress).toFixed(2);
      const th = (-90 + 360 * (1 - progress)) * Math.PI / 180;
      ringHead.setAttribute('cx', (R * Math.cos(th)).toFixed(2));
      ringHead.setAttribute('cy', (R * Math.sin(th)).toFixed(2));
    }
    function update() {
      if (!running) return;
      const remaining = Math.max(0, deadline - now());
      const progress = 1 - remaining / total;
      const n = Math.ceil(remaining / 1000 - 1e-9);
      setRing(progress);
      fx.setIntensity(progress * progress);
      if (n !== shown) {
        shown = n;
        setNumber(n);
        const i = progress * progress;
        setI(i.toFixed(3));
        screenEl.classList.toggle('final10', n <= 10 && n > 0);
        screenEl.classList.toggle('final5', n <= 5 && n > 0);
        pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');
        if (tickCb) { try { tickCb(n); } catch (e) { /* sound must never disturb the clock */ } }
      }
      if (remaining <= 0) finish();
    }
    function loop() { raf = 0; if (!running) return; update(); if (running) raf = requestAnimationFrame(loop); }

    function start() {
      if (running || done) return false;
      running = true; shown = null;
      startedAt = now(); deadline = startedAt + total;
      raf = requestAnimationFrame(loop);
      watchdog = setInterval(update, 250);
      update();
      return true;
    }
    function halt() {
      running = false;
      cancelAnimationFrame(raf); raf = 0;
      clearInterval(watchdog); watchdog = 0;
    }
    function finish() {
      if (!running) return;
      halt(); done = true;
      setRing(1);
      screenEl.classList.add('zero'); screenEl.classList.remove('final10');
      schedule(() => go('INAUGURATION_REVEAL', 'countdown-complete'), CONFIG.zeroHoldMs);
    }
    function stop() { halt(); }
    function reset() {
      halt(); done = false; shown = null; startedAt = 0;
      numEl.classList.add('is-ready');
      if (unitEl) unitEl.hidden = true;
      numEl.innerHTML = '<span class="n ready in">READY</span>';
      numEl.setAttribute('aria-label', 'Ready to begin');
      screenEl.classList.remove('zero', 'final10', 'final5');
      pulse.classList.remove('go');
      ringProg.style.strokeDashoffset = '0';
      setRing(0);
      setI('0');
      fx.setIntensity(0);
    }
    return {
      start, stop, reset, update,
      onTick(fn) { tickCb = fn; },
      get elapsed() { return startedAt ? (now() - startedAt) / 1000 : 0; },
      get deadline() { return deadline; },
      get active() { return running || done; }, get done() { return done; },
    };
  })();

  const ORDER = ['COUNTDOWN', 'INAUGURATION_REVEAL', 'FINAL_PHOTO'];
  const ALLOWED = {
    COUNTDOWN:           ['INAUGURATION_REVEAL'],
    INAUGURATION_REVEAL: ['FINAL_PHOTO'],
    FINAL_PHOTO:         [],
  };
  const UI = {
    COUNTDOWN:           { next: 'start', skip: true  },
    INAUGURATION_REVEAL: { next: 'dwell', skip: false },
    FINAL_PHOTO:         { next: false,   skip: false },
  };

  const screens = {};
  ORDER.forEach(s => { screens[s] = $('#screen-' + s); });

  let state = null;
  let dwellOk = false;
  let countdownArmed = true;   // true until Start begins the 15 s clock
  let lastTransition = -Infinity;

  const btn = {
    next: $('#btnNext'), skip: $('#btnSkip'), restart: $('#btnRestart'),
    fs: $('#btnFs'), help: $('#btnHelp'), snd: $('#btnSnd'),
  };

  function updateControls() {
    const ui = UI[state];
    const waitingStart = state === 'COUNTDOWN' && countdownArmed && !countdown.active;
    const nextOn = ui.next === true || (ui.next === 'dwell' && dwellOk) || (ui.next === 'start' && waitingStart);
    const showNext = !!ui.next && (ui.next !== 'start' || waitingStart);
    btn.next.disabled = !nextOn;
    btn.next.classList.toggle('invisible', !showNext);
    btn.skip.disabled = !ui.skip;
    if (waitingStart) {
      btn.next.textContent = 'START';
      btn.next.setAttribute('aria-label', 'Start the 15 second countdown (Space or Right Arrow)');
    } else {
      btn.next.textContent = 'NEXT';
      btn.next.setAttribute('aria-label', 'Next (Space or Right Arrow)');
    }
  }
  function focusPrimary() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
  }

  const onEnter = {
    COUNTDOWN() {
      fx.setMode('countdown');
      countdownArmed = true;
      countdown.reset();
      // wait for Start / Space — do not start the clock yet
    },
    INAUGURATION_REVEAL() {
      countdownArmed = false;
      // Brief pause lets the screen cross-fade settle before particle work starts.
      fx.stop();
      schedule(() => { fx.start(); fx.setMode('converge'); }, 180);
      schedule(() => fx.setMode('burst'), 1000);
      schedule(() => fx.setMode('ambient'), 2800);
      schedule(() => { dwellOk = true; updateControls(); }, CONFIG.revealMinDwellMs);
      schedule(() => go('FINAL_PHOTO', 'auto'), CONFIG.revealMs);
    },
    FINAL_PHOTO() {
      countdownArmed = false;
      setI('0');
      fx.stop();
      watchFinalPhoto();
    },
  };
  const onLeave = {
    COUNTDOWN() { countdown.stop(); },
  };

  function beginCountdown() {
    if (state !== 'COUNTDOWN' || !countdownArmed || countdown.active) return false;
    countdownArmed = false;
    if (!countdown.start()) { countdownArmed = true; return false; }
    sound.beginCountdown();
    updateControls();
    return true;
  }

  function applyState(next) {
    const prev = state;
    if (prev && onLeave[prev]) onLeave[prev]();
    clearTimers();
    state = next; dwellOk = false;
    root.dataset.state = next; stage.dataset.state = next;
    ORDER.forEach(s => screens[s].classList.toggle('is-active', s === next));
    if (next !== 'FINAL_PHOTO') fx.start();
    updateControls();
    onEnter[next]();
    sound.onState(next);
    focusPrimary();
  }

  function go(next) {
    if (!ALLOWED[state] || !ALLOWED[state].includes(next)) return false;
    lastTransition = now();
    applyState(next);
    return true;
  }
  const locked = () => now() - lastTransition < CONFIG.transitionLockMs;

  function advance() {
    if (locked()) return;
    switch (state) {
      case 'COUNTDOWN': beginCountdown(); break;
      case 'INAUGURATION_REVEAL': if (dwellOk) go('FINAL_PHOTO'); break;
      default: break;
    }
  }
  function skipToReveal() {
    if (!UI[state].skip) return;
    go('INAUGURATION_REVEAL');
  }

  function restart() {
    clearTimers();
    countdown.stop();
    countdown.reset();
    countdownArmed = true;
    sound.reset();
    fx.setMode('ambient');
    $('#photoStage').classList.toggle('contain', CONFIG.finalPhotoFit === 'contain');
    state = null;
    lastTransition = now();
    applyState('COUNTDOWN');
    toast('Program restarted. Press Start when ready.', 2200);
  }

  const confirmEl = $('#confirm'), helpEl = $('#help');
  const dlg = { open: false, onYes: null, openedAt: 0 };

  function ask(title, text, yesLabel, onYes) {
    $('#cfTitle').textContent = title;
    $('#cfText').textContent = text;
    $('#cfYes').textContent = yesLabel + ' (Enter)';
    dlg.open = true; dlg.onYes = onYes; dlg.openedAt = now();
    confirmEl.hidden = false;
    $('#cfYes').focus({ preventScroll: true });
  }
  function closeConfirm() {
    dlg.open = false; dlg.onYes = null; confirmEl.hidden = true;
    focusPrimary();
  }
  function acceptConfirm() {
    if (now() - dlg.openedAt < 350) return;
    const fn = dlg.onYes; closeConfirm(); if (fn) fn();
  }
  function askRestart() {
    ask('Restart the program?', 'This returns to the countdown. A countdown that is running will be cancelled.', 'Restart', restart);
  }
  function askSkip() {
    if (!UI[state].skip) return;
    ask('Skip to the inauguration reveal?',
        'The countdown will be cancelled and the reveal begins immediately.',
        'Skip to reveal', skipToReveal);
  }
  const showHelp = () => { helpEl.hidden = false; $('#helpClose').focus({ preventScroll: true }); };
  const closeHelp = () => { helpEl.hidden = true; focusPrimary(); };

  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen() {
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { toast('Full screen is not available here. Press F11 instead.'); return; }
    const p = req.call(el);
    if (p && p.catch) p.catch(() => toast('Full screen was blocked. Press F11 instead.'));
  }
  function onFsChange() {
    btn.fs.textContent = fsEl() ? 'Exit full screen' : 'Full screen';
    applyScale();
  }

  let idleTimer = 0;
  function wake() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stage.classList.add('idle'), CONFIG.idleHideMs);
  }

  const controlsEl = $('#controls');
  let ctlTimer = 0, tapArmed = false;
  function showControls(ms) {
    stage.classList.add('ctl-show');
    clearTimeout(ctlTimer);
    ctlTimer = setTimeout(hideControls, ms || CONFIG.controlsShowMs);
  }
  function hideControls() {
    clearTimeout(ctlTimer);
    stage.classList.remove('ctl-show');
    if (controlsEl.contains(document.activeElement)) document.activeElement.blur();
  }
  function bindHiddenControls() {
    controlsEl.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      tapArmed = !stage.classList.contains('ctl-show');
      showControls();
      setTimeout(() => { tapArmed = false; }, 600);
    }, true);
    controlsEl.addEventListener('click', e => { if (tapArmed) { tapArmed = false; e.stopPropagation(); e.preventDefault(); } }, true);
    controlsEl.addEventListener('focusin', () => showControls());
    controlsEl.addEventListener('click', () => { if (stage.classList.contains('ctl-show')) showControls(); });
  }

  function togglePhotoFit() {
    const ps = $('#photoStage');
    const contain = ps.classList.toggle('contain');
    toast(contain ? 'Photo: whole picture visible (nothing cropped).' : 'Photo: filling the screen.', 2000);
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    wake();
    const k = e.key;

    if (dlg.open) {
      if (k === 'Enter') { e.preventDefault(); if (document.activeElement && document.activeElement.id === 'cfNo') closeConfirm(); else acceptConfirm(); }
      else if (k === 'Escape') { e.preventDefault(); closeConfirm(); }
      else if (k === 'Tab') { e.preventDefault(); ($('#cfYes') === document.activeElement ? $('#cfNo') : $('#cfYes')).focus(); }
      return;
    }
    if (!helpEl.hidden) {
      if (['Escape', 'Enter', '?', 'h', 'H'].includes(k)) { e.preventDefault(); closeHelp(); }
      return;
    }

    const ae = document.activeElement, tag = ae && ae.tagName;
    if (tag === 'INPUT') { if (k === 'Escape') ae.blur(); return; }
    const onOtherButton = tag === 'BUTTON' && ae.id !== 'btnNext';

    switch (k) {
      case ' ':          if (onOtherButton) return; e.preventDefault(); if (!e.repeat) advance(); break;
      case 'Enter':      if (tag === 'BUTTON') return; e.preventDefault(); if (!e.repeat) advance(); break;
      case 'ArrowRight': case 'PageDown': e.preventDefault(); if (!e.repeat) advance(); break;
      case 'ArrowLeft':  case 'PageUp':
        e.preventDefault();
        if (state === 'COUNTDOWN' && countdown.active) toast('The countdown is running. Use Restart if it must be stopped.');
        break;
      case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
      case 'r': case 'R': e.preventDefault(); if (!e.repeat) askRestart(); break;
      case 's': case 'S': e.preventDefault(); if (!e.repeat) askSkip(); break;
      case 'm': case 'M': sound.toggle(); break;
      case 'c': case 'C': stage.classList.toggle('ctl-pin'); hideControls(); break;
      case 'Tab':        showControls(); break;
      case 'Escape':     if (stage.classList.contains('ctl-show') || stage.classList.contains('ctl-pin')) { stage.classList.remove('ctl-pin'); hideControls(); } break;
      case 'p': case 'P': togglePhotoFit(); break;
      case '?': case 'h': case 'H': showHelp(); break;
      default: break;
    }
  }

  function bindControls() {
    btn.next.addEventListener('click', advance);
    btn.skip.addEventListener('click', askSkip);
    btn.restart.addEventListener('click', askRestart);
    btn.fs.addEventListener('click', toggleFullscreen);
    btn.help.addEventListener('click', showHelp);
    btn.snd.addEventListener('click', () => sound.toggle());
    $('#vol').addEventListener('input', sound.setVolume);
    $('#cfYes').addEventListener('click', acceptConfirm);
    $('#cfNo').addEventListener('click', closeConfirm);
    $('#helpClose').addEventListener('click', closeHelp);

    bindHiddenControls();
    document.addEventListener('keydown', onKey);
    ['pointermove', 'pointerdown'].forEach(t => document.addEventListener(t, wake, { passive: true }));
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('resize', applyScale);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) countdown.update(); });
    document.addEventListener('contextmenu', e => e.preventDefault());
    if (mq && mq.addEventListener) mq.addEventListener('change', () => {
      reduced = mq.matches || params.has('simple');
      root.classList.toggle('reduced', reduced);
      perf.refresh();
      fx.stop(); if (state !== 'FINAL_PHOTO') fx.start();
    });
  }

  function init() {
    document.documentElement.style.setProperty('--photo-pos', CONFIG.finalPhotoPosition);
    $('#photoStage').classList.toggle('contain', CONFIG.finalPhotoFit === 'contain');

    perf.onChange(() => { fx.setQuality(); showStatus(); });
    perf.init();
    applyScale();
    countdown.reset();
    countdown.onTick(sound.countdownTick);
    sound.init();
    bindControls();
    applyState('COUNTDOWN');
    wake();
    showControls();
    showStatus();
    toast('Press Start (or Space) to begin the 15 second countdown.', 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
