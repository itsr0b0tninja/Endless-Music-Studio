import { amp, drift, filter, frequency, oscillator, stereo, wave } from "./audio-tools.mjs";
import { NoirSynth } from "./noir-audio.mjs";

const padLayers = [
  { wave: "dusk", detune: -5.8, width: -.26, attack: 1.00, release: 2.36, level: .082, cutoff: 590, sweep: 910, resonance: .72 },
  { wave: "reed", detune: 6.9, width: .27, attack: 2.19, release: 2.91, level: .065, cutoff: 520, sweep: 1150, resonance: 1.62 },
];
const leadLayers = [
  { wave: "dusk", detune: -2.8, width: -.20, attack: .28, release: 1.39, level: .142, cutoff: 630, sweep: 1330, resonance: .94 },
  { wave: "brass", detune: 5.1, width: .23, attack: .52, release: 1.98, level: .110, cutoff: 590, sweep: 1830, resonance: 1.56 },
];

function buildVoices(ctx) {
  // Browser oscillator tables remove harmonics above Nyquist at playback pitch.
  const brass = Array.from({ length: 24 }, (_, index) => {
    const harmonic = index + 1;
    return (harmonic % 2 ? 1 : .91) / harmonic ** 1.04;
  });
  const reed = Array.from({ length: 21 }, (_, index) => {
    const harmonic = index + 1;
    return Math.sin(Math.PI * .31 * harmonic) / (harmonic * Math.sin(Math.PI * .31));
  });
  const drive = Float32Array.from({ length: 513 }, (_, index) => {
    const x = index / 256 - 1;
    return Math.tanh(1.48 * (x + .075 * x * x)) / Math.tanh(1.48);
  });
  return {
    dusk: wave(ctx, [1, .41, .204, .079, .092, .044, .031, .025, .018]),
    reed: wave(ctx, reed),
    brass: wave(ctx, brass),
    drive,
  };
}

// Interpolate continuously through attack, pressure, and release points.
function shape(param, start, length, points) {
  const values = new Float32Array(160);
  let segment = 0;
  for (let sample = 0; sample < values.length; sample++) {
    const time = length * sample / (values.length - 1);
    while (segment < points.length - 2 && time > points[segment + 1][0]) segment++;
    const [leftTime, leftValue] = points[segment];
    const [rightTime, rightValue] = points[segment + 1];
    const fraction = Math.min(1, (time - leftTime) / (rightTime - leftTime));
    const eased = fraction * fraction * (3 - 2 * fraction);
    values[sample] = leftValue + (rightValue - leftValue) * eased;
  }
  param.setValueCurveAtTime(values, start, length);
}

export class NoirStudioSynth extends NoirSynth {
  constructor(ctx, destination, assets) {
    super(ctx, destination, assets);
    this.assets.studio ??= buildVoices(ctx);
    this.room.delayTime.value = .067;

    this.ensemble = filter(ctx, "highpass", 300, .66);
    this.chorusMotion = [];
    for (const { time, rate, extent, pan } of [
      { time: .016, rate: .217, extent: .0013, pan: -.78 },
      { time: .024, rate: .333, extent: .0017, pan: .80 },
    ]) {
      const delay = ctx.createDelay(.05);
      delay.delayTime.value = time;
      const motion = oscillator(ctx, "sine", rate);
      const depth = ctx.createGain();
      depth.gain.value = extent;
      motion.connect(depth).connect(delay.delayTime);
      motion.start();
      this.chorusMotion.push(motion);

      const softened = filter(ctx, "lowpass", 2750, .65);
      const returnLevel = ctx.createGain();
      returnLevel.gain.value = .28;
      const panner = stereo(ctx, pan);
      this.ensemble.connect(delay).connect(softened).connect(returnLevel).connect(panner).connect(this.color);
      panner.connect(this.room);
    }
  }

  pad(event, start, duration, intensity) {
    for (const layer of padLayers) this.analogVoice(event, layer, start, duration, intensity, false);
  }

  horn(event, start, duration, intensity) {
    for (const layer of leadLayers) this.analogVoice(event, layer, start, duration, intensity, true);
    this.breath(event, start, duration);
  }

  analogVoice(event, layer, start, duration, intensity, lead) {
    const { ctx } = this;
    const color = event.color;
    const energy = intensity / 100;
    const hz = frequency(event.pitch);
    const upper = layer.detune > 0;
    const attack = Math.min(layer.attack * (.81 + color * .36), duration * .65);
    const tail = layer.release * (.88 + color * .26);
    const length = duration + tail;
    const end = start + length + .014;
    const peakTime = attack + (duration - attack) * (upper ? .48 : .24);
    const center = layer.cutoff + hz * (lead ? .64 : .72);
    const peakCutoff = center + layer.sweep * (.44 + energy * .39 + color * .19);
    const level = event.level * layer.level * (.83 + energy * .20);
    const pan = Math.max(-.85, Math.min(.85, (event.pan ?? (color - .5) * .15) + layer.width));
    const voice = oscillator(ctx, this.assets.studio[layer.wave], hz, layer.detune);
    const highPass = filter(ctx, "highpass", hz * (upper ? .54 : .25), .71);
    const lowPass = filter(ctx, "lowpass", center, layer.resonance);
    const saturation = ctx.createWaveShaper();
    saturation.curve = this.assets.studio.drive;
    saturation.oversample = "2x";
    const output = this.voice(pan, lead ? .78 : .66, lead ? .57 : .10);
    voice.connect(highPass).connect(lowPass).connect(saturation).connect(output);
    output.connect(this.ensemble);

    shape(output.gain, start, length, [
      [0, 0], [attack, level * (upper ? .49 : .77)], [peakTime, level],
      [duration, level * (upper ? .57 : .71)], [duration + tail * .46, level * .22], [length, 0],
    ]);
    shape(lowPass.frequency, start, length, [
      [0, center * .78], [attack, center * (upper ? 1.04 : 1.17)], [peakTime, peakCutoff],
      [duration, center + (peakCutoff - center) * .43], [length, center * .70],
    ]);
    drift(ctx, lowPass.frequency, .19 + color * .13, 34 + energy * 30, start, end);
    drift(ctx, voice.detune, .27 + color * (upper ? .37 : .23), upper ? 3.7 : 2.2, start, end);
    if (lead) {
      const cents = layer.detune;
      shape(voice.detune, start, length, [
        [0, cents + event.bend * (upper ? .70 : 1.18)],
        [attack, cents + (upper ? 3 : 8)], [peakTime, cents + .8],
        [duration, cents + (upper ? 3 : -2)], [length, cents - 8],
      ]);
      drift(ctx, voice.detune, 4.27 + color * .73, (upper ? 18 : 12) + energy * 5, start, end, attack);
    }
    voice.start(start);
    voice.stop(end);
  }

  breath(event, start, duration) {
    const { ctx } = this;
    const air = ctx.createBufferSource();
    air.buffer = this.assets.air;
    const tone = filter(ctx, "bandpass", 1520 + event.color * 520, .77);
    const gain = this.voice((event.color - .5) * .22, .83);
    const length = Math.min(.48 + event.color * .27, duration * .60);
    air.connect(tone).connect(gain);
    amp(gain, start, length, .13, length * .55, event.level * .049, .38);
    air.start(start, .4 + event.color * 2);
    air.stop(start + length + .012);
  }

  fadeOut(start, length) {
    super.fadeOut(start, length);
    for (const motion of this.chorusMotion) motion.stop(start + length);
  }
}
