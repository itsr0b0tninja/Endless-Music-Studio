export function frequency(pitch) {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function amp(node, at, duration, attack, release, level, sustain = .72) {
  const value = node.gain;
  const peak = at + attack;
  const tail = Math.max(peak, at + duration - release);
  value.setValueAtTime(.00001, at);
  value.linearRampToValueAtTime(level, peak);
  if (tail > peak) value.exponentialRampToValueAtTime(level * sustain, tail);
  value.exponentialRampToValueAtTime(.00001, at + duration);
}

export function filter(ctx, type, cutoff, resonance = .707) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = cutoff;
  node.Q.value = resonance;
  return node;
}

export function oscillator(ctx, type, hz, detune = 0) {
  const node = ctx.createOscillator();
  if (typeof type === "string") node.type = type;
  else node.setPeriodicWave(type);
  node.frequency.value = hz;
  node.detune.value = detune;
  return node;
}

export function wave(ctx, harmonics) {
  return ctx.createPeriodicWave(new Float32Array(harmonics.length + 1), Float32Array.of(0, ...harmonics));
}

export function stereo(ctx, pan) {
  if (typeof ctx.createStereoPanner !== "function") return ctx.createGain();
  const node = ctx.createStereoPanner();
  node.pan.value = pan;
  return node;
}

export function drift(ctx, parameter, speed, depth, start, end, delay = 0) {
  const voice = oscillator(ctx, "sine", speed);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(delay ? 0 : depth, start);
  if (delay) {
    gain.gain.setValueAtTime(0, start + delay);
    gain.gain.linearRampToValueAtTime(depth, Math.min(start + delay + .64, end));
  }
  voice.connect(gain).connect(parameter);
  voice.start(start);
  voice.stop(end);
  return gain;
}
