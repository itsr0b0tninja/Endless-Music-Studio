import { composeBar, randomFrom } from "./composer.mjs";

import { amp, filter, frequency, oscillator } from "./audio-tools.mjs";
import { NoirSynth } from "./noir-audio.mjs";
import { NoirStudioSynth } from "./noir-studio.mjs";

const noirSynths = { noir: NoirSynth, "noir-studio": NoirStudioSynth };

function pulse(ctx, duty) {
  const cosine = new Float32Array(40);
  const sine = new Float32Array(40);
  for (let harmonic = 1; harmonic < cosine.length; harmonic++) {
    cosine[harmonic] = 2 * Math.sin(Math.PI * duty * harmonic) / (Math.PI * harmonic);
  }
  return ctx.createPeriodicWave(cosine, sine);
}

function noiseBuffer(ctx) {
  const length = Math.round(ctx.sampleRate * .35);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = randomFrom("studio percussion");
  for (let sample = 0; sample < length; sample++) data[sample] = rng() * 2 - 1;
  return buffer;
}

function impulse(ctx) {
  const length = Math.round(ctx.sampleRate * 2.7);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const rng = randomFrom("studio room");
  for (let side = 0; side < 2; side++) {
    const data = buffer.getChannelData(side);
    let smoothNoise = 0;
    for (let sample = 0; sample < length; sample++) {
      const time = sample / ctx.sampleRate;
      smoothNoise = smoothNoise * .52 + (rng() * 2 - 1) * .48;
      data[sample] = smoothNoise * Math.min(1, time * 40) * Math.exp(-time * 2.5);
    }
  }
  return buffer;
}

export class Synth {
  constructor(ctx, destination, assets) {
    this.ctx = ctx;
    this.assets = assets ?? {
      pulseLead: pulse(ctx, .25), pulseArp: pulse(ctx, .125),
      noise: noiseBuffer(ctx), room: impulse(ctx),
    };
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.ambience = ctx.createConvolver();
    this.ambience.buffer = this.assets.room;
    const wet = ctx.createGain();
    wet.gain.value = .52;
    this.ambience.connect(wet).connect(this.output);

    this.noir = null;
  }

  voiceOutput(pan, room = 0) {
    const { ctx } = this;
    const gain = ctx.createGain();
    const stereo = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : ctx.createGain();
    if (stereo.pan) stereo.pan.value = pan;
    gain.connect(stereo).connect(this.output);
    if (room) {
      const send = ctx.createGain();
      send.gain.value = room;
      stereo.connect(send).connect(this.ambience);
    }
    return gain;
  }

  triggerBar(bar, style, intensity, time, reset = false) {
    const Renderer = noirSynths[style];
    if (this.noir && (reset || style !== this.noirStyle)) {
      this.noir.fadeOut(time, Renderer ? 1.15 : .62);
      this.noir = null;
    }
    if (Renderer) {
      if (!this.noir) {
        this.noir = new Renderer(this.ctx, this.output, this.assets.noir);
        this.assets.noir = this.noir.assets;
        this.noirStyle = style;
      }
      this.noir.play(bar, intensity, time);
      return;
    }
    const seconds = 60 / bar.bpm;
    const balance = style === "fm" ? 1.22 : 1;
    for (const note of bar.events) {
      const event = { ...note, level: note.level * balance };
      const at = time + event.beat * seconds;
      const duration = event.duration * seconds;
      if (["kick", "snare", "hat"].includes(event.track)) this.drums(style, event, at);
      else if (style === "chip") this.chip(event, at, duration);
      else this.fm(event, at, duration, intensity);
    }
  }

  chip(event, at, duration) {
    const { ctx, assets } = this;
    const lead = event.track === "lead";
    const bass = event.track === "bass";
    const shape = bass ? "triangle" : lead ? assets.pulseLead : assets.pulseArp;
    const tone = oscillator(ctx, shape, frequency(event.pitch));
    const gain = this.voiceOutput(0);
    tone.connect(gain);
    amp(gain, at, duration, .003, Math.min(.04, duration * .53),
      event.level * (bass ? .22 : lead ? .104 : .046), .74);
    tone.start(at);
    tone.stop(at + duration + .005);
  }

  fm(event, at, duration, intensity) {
    const { ctx } = this;
    const bass = event.track === "bass";
    const lead = event.track === "lead";
    const hz = frequency(event.pitch);
    const tone = oscillator(ctx, "sine", hz);
    const modulator = oscillator(ctx, "sine", hz * (lead ? 2 : bass ? 1 : 3));
    const depth = ctx.createGain();
    const tail = duration + (bass ? .04 : lead ? .095 : .17);
    const gain = this.voiceOutput(event.pan ?? 0, bass ? 0 : .20);
    modulator.connect(depth).connect(tone.frequency);
    tone.connect(gain);
    const strength = bass ? 1.0 : lead ? 1.9 : 1.45;
    depth.gain.setValueAtTime(hz * (strength + intensity * .008), at);
    depth.gain.exponentialRampToValueAtTime(hz * (lead ? .5 : .23), at + tail * .79);
    amp(gain, at, tail, bass ? .008 : .014, Math.min(tail * .69, .28),
      event.level * (bass ? .21 : lead ? .14 : .063), bass ? .40 : .48);
    for (const voice of [tone, modulator]) {
      voice.start(at);
      voice.stop(at + tail + .009);
    }
  }

  drums(style, event, at) {
    const { ctx } = this;
    const chip = style === "chip";
    if (event.track === "kick") {
      const gain = this.voiceOutput(0);
      const length = chip ? .145 : .21;
      const voice = oscillator(ctx, chip ? "triangle" : "sine", chip ? 109 : 142);
      voice.frequency.exponentialRampToValueAtTime(46, at + length * .54);
      voice.connect(gain);
      amp(gain, at, length, .004, length - .01, event.level * .25);
      voice.start(at);
      voice.stop(at + length + .01);
      return;
    }
    const hat = event.track === "hat";
    const length = hat ? .063 : chip ? .106 : .184;
    const source = ctx.createBufferSource();
    source.buffer = this.assets.noise;
    source.playbackRate.value = chip ? (hat ? .84 : .54) : 1;
    const toneFilter = filter(ctx, hat ? "highpass" : "bandpass", hat ? 6300 : chip ? 1600 : 1850);
    const gain = this.voiceOutput(chip ? 0 : hat ? .29 : -.11, chip ? 0 : .18);
    source.connect(toneFilter).connect(gain);
    amp(gain, at, length, .003, length - .004, event.level * (hat ? .12 : .27));
    source.start(at);
    source.stop(at + length + .004);
  }

  silence() {
    const at = this.ctx.currentTime;
    this.noir?.fadeOut(at, .055);
    this.output.gain.setTargetAtTime(0, at, .008);
    setTimeout(() => this.output.disconnect(), 65);
  }
}

export class Playback {
  constructor(config) {
    this.config = { ...config };
    this.state = "ready";
    this.records = [];
    this.timer = null;
    this.suspendTimer = null;
  }

  setConfig(config) {
    const volumeChanged = config.volume !== this.config.volume;
    this.config = { ...config };
    if (this.ctx && volumeChanged) {
      this.master.gain.setTargetAtTime(this.config.volume / 100 * .92, this.ctx.currentTime, .037);
    }
  }

  async play() {
    if (this.state === "playing") return;
    clearTimeout(this.suspendTimer);
    if (!this.ctx) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw new Error("This browser does not support Web Audio.");
      this.ctx = new Context();
      this.master = this.ctx.createGain();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 13;
      limiter.ratio.value = 8;
      limiter.attack.value = .008;
      limiter.release.value = .20;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.master.gain.value = this.config.volume / 100 * .92;
    }
    await this.ctx.resume();
    if (this.state === "ready") {
      this.synth = new Synth(this.ctx, this.master, this.assets);
      this.assets = this.synth.assets;
      this.records = [];
      this.startTime = this.ctx.currentTime + .052;
      this.nextTime = this.startTime;
    }
    this.state = "playing";
    this.tick();
    this.startClock();
  }

  async pause() {
    if (this.state !== "playing") return;
    await this.ctx.suspend();
    this.stopClock();
    this.state = "paused";
  }

  stop() {
    this.stopClock();
    if (this.synth) this.synth.silence();
    this.synth = null;
    this.records = [];
    this.state = "ready";
    if (this.ctx) {
      this.suspendTimer = setTimeout(() => {
        if (this.state === "ready") this.ctx.suspend().catch(() => {});
      }, 85);
    }
  }

  startClock() {
    if (!this.timer && !this.worker) {
      try {
        const worker = new Worker(new URL("./clock.mjs", import.meta.url), { type: "module" });
        this.worker = worker;
        worker.onmessage = () => this.tick();
        worker.onerror = () => {
          if (this.worker !== worker) return;
          worker.terminate();
          this.worker = null;
          if (this.state === "playing") this.timer = setInterval(() => this.tick(), 35);
        };
      } catch {
        this.timer = setInterval(() => this.tick(), 35);
      }
    }
  }

  stopClock() {
    this.worker?.terminate();
    this.worker = null;
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.state !== "playing" || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    if (this.nextTime > now + .17) return;
    // Skip the missed time after a sleeping tab or device. Keep the previous musical position.
    this.nextTime = Math.max(this.nextTime, now + .012);
    const previous = this.records.at(-1);
    const reset = !previous || previous.config.seed !== this.config.seed || previous.config.style !== this.config.style;
    const bar = composeBar(this.config, reset ? 0 : previous.bar.index + 1);
    const start = this.nextTime;
    const end = start + 4 * 60 / bar.bpm;
    this.synth.triggerBar(bar, this.config.style, this.config.intensity, start, reset);
    this.records.push({ bar, config: this.config, start, end, epoch: reset ? start : previous.epoch });
    if (this.records.length > 8) this.records.shift();
    this.nextTime = end;
  }

  frame() {
    if (this.state === "ready") return null;
    const now = this.ctx.currentTime;
    const active = this.records.findLast(record => record.start <= now) ?? this.records[0];
    if (!active) return null;
    return {
      active,
      records: this.records,
      position: Math.min(4, Math.max(0, (now - active.start) * active.bar.bpm / 60)),
      elapsed: Math.max(0, now - this.startTime),
    };
  }
}
