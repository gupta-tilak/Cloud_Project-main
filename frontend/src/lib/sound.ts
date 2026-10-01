// Short alarm beeps via WebAudio (no audio files). Browsers only allow sound
// after the user has clicked something on the page, which joining does.
let ctx: AudioContext | null = null;

export function unlockSound() {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    /* no audio support */
  }
}

export function beep(kind: 'alarm' | 'info' = 'alarm') {
  try {
    unlockSound();
    if (!ctx) return;
    const times = kind === 'alarm' ? [0, 0.25, 0.5] : [0];
    for (const t of times) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = kind === 'alarm' ? 880 : 660;
      g.gain.setValueAtTime(0.08, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    }
    if (kind === 'alarm') navigator.vibrate?.([300, 100, 300]);
  } catch {
    /* ignore */
  }
}
