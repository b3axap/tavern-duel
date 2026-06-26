'use strict';
// Процедурный звук на WebAudio — без аудио-файлов. Глобальный объект SFX.

const SFX = (() => {
  let ctx = null;
  let master = null;
  let muted = localStorage.getItem('td_mute') === '1';

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Один осцилляторный «голос» с огибающей.
  function voice(type, f0, f1, t0, dur, gain = 0.3, destination = null) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(destination || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // Шумовой всплеск (для свистов, ударов, шуршания).
  function noise(t0, dur, gain = 0.2, filterType = 'bandpass', f0 = 1200, f1 = null, q = 1) {
    const c = ensure(); if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter(); flt.type = filterType; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t0);
    if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  }

  function t() { const c = ensure(); return c ? c.currentTime : 0; }

  const lib = {
    click()   { if (muted) return; const x = t(); voice('square', 320, 240, x, 0.06, 0.12); },
    hover()   { if (muted) return; const x = t(); voice('sine', 600, 720, x, 0.04, 0.05); },
    buy()     { if (muted) return; const x = t(); voice('triangle', 680, 880, x, 0.09, 0.18); voice('sine', 1320, 1760, x + 0.04, 0.12, 0.12); noise(x, 0.05, 0.06, 'highpass', 4000); },
    sell()    { if (muted) return; const x = t(); voice('triangle', 520, 300, x, 0.12, 0.16); voice('sine', 900, 600, x, 0.1, 0.08); },
    reroll()  { if (muted) return; const x = t(); noise(x, 0.22, 0.16, 'bandpass', 800, 3200, 0.7); noise(x + 0.08, 0.18, 0.12, 'bandpass', 1200, 600, 0.7); },
    upgrade() { if (muted) return; const x = t(); [523, 659, 784, 1047].forEach((f, i) => voice('triangle', f, f, x + i * 0.06, 0.28, 0.16)); },
    ready()   { if (muted) return; const x = t(); voice('sawtooth', 196, 220, x, 0.5, 0.12); voice('sawtooth', 294, 330, x, 0.5, 0.1); voice('sawtooth', 392, 440, x + 0.05, 0.5, 0.08); },
    attack()  { if (muted) return; const x = t(); noise(x, 0.13, 0.16, 'bandpass', 700, 2600, 0.6); voice('sawtooth', 180, 90, x, 0.12, 0.08); },
    hit()     { if (muted) return; const x = t(); voice('sine', 160, 60, x, 0.16, 0.32); noise(x, 0.09, 0.18, 'lowpass', 900); },
    shield()  { if (muted) return; const x = t(); voice('sine', 1400, 1400, x, 0.18, 0.12); voice('sine', 2100, 2100, x, 0.18, 0.08); },
    death()   { if (muted) return; const x = t(); voice('sawtooth', 220, 50, x, 0.32, 0.2); noise(x, 0.2, 0.16, 'lowpass', 1400, 200); },
    heroHit() { if (muted) return; const x = t(); voice('sine', 120, 40, x, 0.3, 0.4); noise(x, 0.18, 0.24, 'lowpass', 600); },
    win()     { if (muted) return; const x = t(); [523, 659, 784, 1047, 1319].forEach((f, i) => voice('triangle', f, f, x + i * 0.1, 0.5, 0.18)); },
    lose()    { if (muted) return; const x = t(); [440, 370, 311, 233].forEach((f, i) => voice('sawtooth', f, f, x + i * 0.14, 0.5, 0.14)); },
  };

  return {
    play(name) { const f = lib[name]; if (f) try { f(); } catch {} },
    unlock() { ensure(); },
    isMuted() { return muted; },
    toggleMute() { muted = !muted; localStorage.setItem('td_mute', muted ? '1' : '0'); if (!muted) this.play('click'); return muted; },
  };
})();

window.SFX = SFX;
