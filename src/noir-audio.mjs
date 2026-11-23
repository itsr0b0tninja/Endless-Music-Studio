import { amp, drift, filter, frequency, oscillator, stereo, wave } from "./audio-tools.mjs";
import { randomFrom } from "./composer.mjs";

function buildRoom(ctx) {
  const buffer = ctx.createBuffer(2, Math.round(ctx.sampleRate * 6.25), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const rng = randomFrom(`Noir hall ${channel}`);
    const samples = buffer.getChannelData(channel);
    const reflections = channel === 0 ? [.066, .139, .23] : [.093, .158, .265];
    let smoothed = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / ctx.sampleRate;
      const damping = .48 + .22 * Math.min(time / 2, 1);
      smoothed = damping * smoothed + (rng() * 2 - 1) * (1 - damping);
      const early = time < .4
        ? reflections.reduce((gain, reflection) => gain + .32 * Math.exp(-Math.abs(time - reflection) * 140), 0)
        : 0;
      const bloom = Math.min(1, time / .19);
      samples[i] = smoothed * (bloom + early) * Math.exp(-time * 1.23);
    }
  }
  return buffer;
}

function buildAir(ctx) {
  const buffer = ctx.createBuffer(2, Math.round(ctx.sampleRate * 5.2), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const rng = randomFrom(`Noir air ${channel}`);
    const samples = buffer.getChannelData(channel);
    let slow = 0;
    let soft = 0;
    for (let i = 0; i < samples.length; i++) {
      const noise = rng() * 2 - 1;
      slow = .981 * slow + .019 * noise;
      soft = .76 * soft + .24 * noise;
      const fade = Math.min(1, i / 1200, (samples.length - 1 - i) / 1200);
      samples[i] = (slow * 2.2 + soft * .41) * fade;
    }
  }
  return buffer;
}

function layer(ctx, destination, shape, hz, detune, level) {
  const voice = oscillator(ctx, shape, hz, detune);
  const mix = ctx.createGain();
  mix.gain.value = level;
  voice.connect(mix).connect(destination);
  return voice;
}

function swell(param, start, duration, attack, tail, level) {
  param.setValueAtTime(.00001, start);
  param.linearRampToValueAtTime(level * .72, start + attack);
  param.linearRampToValueAtTime(level, start + attack + (duration - attack) * .36);
  param.linearRampToValueAtTime(level * .71, start + duration);
  param.linearRampToValueAtTime(level * .14, start + duration + tail * .64);
  param.exponentialRampToValueAtTime(.00001, start + duration + tail);
}

export class NoirSynth {
  constructor(ctx, destination, assets) {
    this.ctx = ctx;
    this.assets = assets ?? {
      pad: wave(ctx, [1, .30, .245, .14, .115, .068, .051, .033, .018, .011]),
      brass: wave(ctx, [1, .62, .33, .24, .15, .093, .075, .063, .043, .028, .017]),
      room: buildRoom(ctx),
      air: buildAir(ctx),
    };
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.color = filter(ctx, "highshelf", 1450);
    this.color.connect(this.output);

    this.room = ctx.createDelay(.25);
    this.room.delayTime.value = .047;
    const hall = ctx.createConvolver();
    hall.buffer = this.assets.room;
    const lowCut = filter(ctx, "highpass", 170);
    const damping = filter(ctx, "lowpass", 2640);
    const wet = ctx.createGain();
    wet.gain.value = .78;
    this.room.connect(hall).connect(lowCut).connect(damping).connect(wet).connect(this.color);

    this.echo = ctx.createGain();
    for (const [seconds, pan, level] of [[.43, -.60, .36], [.74, .65, .23]]) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = seconds;
      const softened = filter(ctx, "lowpass", 1660, .65);
      const tap = ctx.createGain();
      tap.gain.value = level;
      const space = stereo(ctx, pan);
      this.echo.connect(delay).connect(softened).connect(tap).connect(space).connect(this.color);
      space.connect(this.room);
    }
  }

  voice(pan, room, echo = 0) {
    const { ctx } = this;
    const gain = ctx.createGain();
    const panner = stereo(ctx, pan);
    gain.connect(panner).connect(this.color);
    const send = ctx.createGain();
    send.gain.value = room;
    panner.connect(send).connect(this.room);
    if (echo) {
      const reflection = ctx.createGain();
      reflection.gain.value = echo;
      gain.connect(reflection).connect(this.echo);
    }
    return gain;
  }

  play(bar, intensity, start) {
    const seconds = 60 / bar.bpm;
    this.color.gain.setTargetAtTime((intensity - 52) * .077, start, .44);
    for (const event of bar.events) {
      const at = start + event.beat * seconds;
      const duration = event.duration * seconds;
      switch (event.track) {
        case "bass": this.bass(event, at, duration); break;
        case "harmony": this.pad(event, at, duration, intensity); break;
        case "lead": this.horn(event, at, duration, intensity); break;
        case "keys": this.keys(event, at, duration); break;
        case "air": this.air(event, at, duration); break;
      }
    }
  }

  pad(event, start, duration, intensity) {
    const { ctx, assets } = this;
    const hz = frequency(event.pitch);
    const color = event.color;
    const length = duration + event.release;
    const end = start + length + .015;
    const tone = filter(ctx, "lowpass", 700, .62);
    tone.frequency.setValueAtTime(360 + hz * .69, start);
    tone.frequency.exponentialRampToValueAtTime(810 + color * 190 + intensity * 4, start + 2.1 + color);
    tone.frequency.exponentialRampToValueAtTime(620 + intensity * 2, start + length);
    drift(ctx, tone.frequency, .09 + color * .12, 65, start, end);

    const envelope = this.voice(event.pan, .65);
    tone.connect(envelope);
    swell(envelope.gain, start, duration, 1.04 + color * .76, event.release, event.level * .137);
    const lower = layer(ctx, tone, assets.pad, hz, -7 + color * 2, .42);
    const upper = layer(ctx, tone, assets.pad, hz, 5 + color * 3, .31);
    const body = layer(ctx, tone, "triangle", hz, -1, .27);
    drift(ctx, lower.detune, .18 + color * .13, 2.7, start, end);
    drift(ctx, upper.detune, .13 + color * .09, 3.1, start, end);
    for (const voice of [lower, upper, body]) {
      voice.start(start);
      voice.stop(end);
    }
  }

  bass(event, start, duration) {
    const { ctx } = this;
    const hz = frequency(event.pitch);
    const tail = 1.65;
    const end = start + duration + tail + .01;
    const tone = filter(ctx, "lowpass", 360);
    const envelope = this.voice(0, .12);
    tone.connect(envelope);
    swell(envelope.gain, start, duration, 1.06, tail, event.level * .16);
    const fundamental = layer(ctx, tone, "sine", hz, 0, .67);
    const body = layer(ctx, tone, "triangle", hz, 1.7, .33);
    for (const voice of [fundamental, body]) {
      voice.start(start);
      voice.stop(end);
    }
  }

  horn(event, start, duration, intensity) {
    const { ctx, assets } = this;
    const hz = frequency(event.pitch);
    const color = event.color;
    const tail = 1.24 + color * .48;
    const end = start + duration + tail + .012;
    const tone = filter(ctx, "lowpass", 900, .88);
    const cutoff = tone.frequency;
    cutoff.setValueAtTime(420 + hz * .46, start);
    cutoff.exponentialRampToValueAtTime(970 + hz * .71 + intensity * 6, start + Math.min(.95, duration * .54));
    cutoff.exponentialRampToValueAtTime(640 + hz * .56, end);
    const envelope = this.voice((color - .5) * .22, .81, .65);
    tone.connect(envelope);
    swell(envelope.gain, start, duration, Math.min(.26 + color * .22, duration * .38), tail, event.level * .225);

    const first = layer(ctx, tone, assets.brass, hz, 0, .49);
    const second = layer(ctx, tone, assets.brass, hz, 0, .27);
    const foundation = layer(ctx, tone, "triangle", hz, 0, .24);
    const vibrato = drift(ctx, first.detune, 4.35 + color * .86, 14 + color * 10, start, end, .36 + color * .12);
    vibrato.connect(second.detune);
    vibrato.connect(foundation.detune);
    for (const [voice, cents] of [[first, -3], [second, 5.4], [foundation, .4]]) {
      voice.detune.setValueAtTime(event.bend + cents, start);
      voice.detune.linearRampToValueAtTime(cents + 6, start + .23 + color * .10);
      voice.detune.linearRampToValueAtTime(cents, start + .58 + color * .17);
      voice.detune.linearRampToValueAtTime(cents - 10, end - .021);
      voice.start(start);
      voice.stop(end);
    }
  }

  keys(event, start, duration) {
    const { ctx } = this;
    const fundamental = frequency(event.pitch);
    const tone = this.voice(event.pan, .78, .44);
    for (const [ratio, level, tail] of [[1, .104, 1.31], [2, .038, .87], [3.01, .024, .57], [4.06, .011, .37]]) {
      const length = duration * .4 + tail;
      const voice = oscillator(ctx, "sine", fundamental * ratio);
      const gain = ctx.createGain();
      voice.connect(gain).connect(tone);
      amp(gain, start, length, .025 + ratio * .004, length * .7, level * event.level, .32);
      voice.start(start);
      voice.stop(start + length + .01);
    }
  }

  air(event, start, duration) {
    const { ctx } = this;
    const voice = ctx.createBufferSource();
    voice.buffer = this.assets.air;
    voice.loop = true;
    const lowCut = filter(ctx, "highpass", 135);
    const shade = filter(ctx, "lowpass", 590 + event.color * 370, .5);
    const envelope = this.voice(0, .62);
    const end = start + duration + 1.82;
    drift(ctx, shade.frequency, .15, 145, start, end);
    voice.connect(lowCut).connect(shade).connect(envelope);
    swell(envelope.gain, start, duration, 1.78, 1.8, event.level * .082);
    voice.start(start, event.color * 2);
    voice.stop(end);
  }

  fadeOut(start, length) {
    const end = start + length;
    this.output.gain.setValueAtTime(1, start);
    this.output.gain.linearRampToValueAtTime(0, end);
    // Disconnect on the audio clock so pausing preserves the transition.
    const cleanup = this.ctx.createConstantSource();
    cleanup.offset.value = 0;
    cleanup.connect(this.output);
    cleanup.onended = () => this.output.disconnect();
    cleanup.start(start);
    cleanup.stop(end);
  }
}
