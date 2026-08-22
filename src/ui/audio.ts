// Synth SFX on Web Audio — no samples, no assets. Muted by S.sound; the
// context unlocks on the first user gesture (Sfx.unlock from a tap handler).
import { S } from '../state.ts';

export const Sfx = (() => {
  let ctx: AudioContext | null = null;
  function ac(): AudioContext | null {
    if (!ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f: number, dur: number, type?: OscillatorType, gain?: number, slideTo?: number | null, delay?: number) {
    if (!S.sound) return; const c = ac(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.07, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur: number, gain?: number, hz?: number, delay?: number) {
    if (!S.sound) return; const c = ac(); if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = hz || 1400; f.Q.value = .9;
    const g = c.createGain(); g.gain.value = gain || 0.05;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(c.currentTime + (delay || 0));
  }
  return {
    unlock() { ac(); },
    tick() { tone(520 + Math.random() * 380, 0.035, 'square', 0.022); },
    roll() { noise(0.16, 0.045, 2200); },
    /* cards zipping together: a run of dry clicks, not one noise burst — the
       rune deal shuffles for three seconds, and three silent seconds read as
       a hang rather than as suspense */
    riffle() { for (let i = 0; i < 11; i++) noise(0.026, 0.03, 2400 + Math.random() * 1100, i * 0.032); },
    place() { tone(180, 0.12, 'triangle', 0.09, 90); noise(0.07, 0.04, 900); },
    kill() { tone(720, 0.28, 'sawtooth', 0.075, 110); noise(0.3, 0.07, 600); },
    mult() { tone(880, 0.1, 'triangle', 0.06); tone(1320, 0.12, 'triangle', 0.05, null, 0.07); },
    /* a spell: an upward sweep with a shimmer over it — nothing else in the
       game rises, so a cast is audible without looking */
    spell() { tone(240, 0.34, 'triangle', 0.06, 940); tone(1180, 0.3, 'sine', 0.04, 1760, 0.05); noise(0.26, 0.03, 2600); },
    pass() { tone(392, 0.16, 'triangle', 0.05); tone(587, 0.2, 'triangle', 0.045, null, 0.11); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.32, 'triangle', 0.075, null, i * 0.1)); },
    lose() { [440, 349, 262].forEach((f, i) => tone(f, 0.4, 'sine', 0.075, null, i * 0.13)); },
    tap() { tone(1200, 0.04, 'square', 0.03); }
  };
})();

export function vibrate(ms: number | number[]): void {
  try { if (navigator.vibrate && S.sound) navigator.vibrate(ms); } catch { /* no haptics */ }
}
