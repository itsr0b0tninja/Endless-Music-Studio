const minor = [0, 2, 3, 5, 7, 8, 10];
const dorian = [0, 2, 3, 5, 7, 9, 10];
const blues = [0, 3, 5, 6, 7, 10];

const i = [0, 0, 3, 7];
const iv = [5, 0, 3, 7];
const flatSix = [8, 0, 4, 7];
const flatSeven = [10, 0, 4, 7];
const flatThree = [3, 0, 4, 7];
const dominant = [7, 0, 4, 7];
const minor7 = [0, 0, 3, 7, 10];
const major7 = [3, 0, 4, 7, 11];
const fourth9 = [5, 0, 4, 7, 10, 14];
const seventh13 = [10, 0, 4, 10, 14, 21];

const noirProfile = {
  name: "Noir Synth", tempo: 64, keys: [0, 2, 3, 5, 7, 9], scale: blues, mode: "minor blues",
};

export const profiles = {
  chip: {
    name: "8-bit Console", tempo: 128, keys: [0, 2, 4, 5, 7, 9], scale: minor, mode: "minor",
    progressions: [
      [i, flatSix, flatThree, flatSeven],
      [i, iv, flatSix, dominant],
      [i, flatSeven, flatSix, dominant],
      [flatThree, flatSeven, iv, i],
    ],
    rhythms: [
      [[0, .45], [.5, .45], [1, .7], [2, .47], [2.75, .23], [3, .72]],
      [[0, .71], [1, .48], [1.5, .35], [2.25, .48], [3, .72]],
      [[0, .37], [.5, .37], [1, .35], [1.5, .37], [2, .65], [3, .43], [3.5, .43]],
    ],
  },
  fm: {
    name: "16-bit Console", tempo: 108, keys: [0, 2, 4, 5, 7, 9], scale: dorian, mode: "Dorian",
    progressions: [
      [minor7, fourth9, seventh13, major7],
      [minor7, major7, fourth9, seventh13],
      [minor7, seventh13, fourth9, minor7],
      [major7, seventh13, minor7, fourth9],
    ],
    rhythms: [
      [[.05, .69], [1.08, .43], [1.62, .42], [2.55, 1.12]],
      [[.55, .61], [1.32, .63], [2.1, .7], [3.16, .57]],
      [[0, .9], [1.55, .44], [2.31, .39], [2.85, .86]],
    ],
  },
  noir: noirProfile,
  "noir-studio": { ...noirProfile, name: "Noir Studio", scoreStyle: "noir" },
};

const form = ["Theme", "Theme variation", "Contrast", "Return", "Development", "Theme variation", "Contrast", "Return"];
const noteNames = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function randomFrom(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function closestPitch(target, tonic, intervals) {
  const center = Math.floor((target - tonic) / 12);
  let nearest = target;
  let distance = Infinity;
  for (let octave = center - 1; octave <= center + 1; octave++) {
    for (const interval of intervals) {
      const pitch = tonic + octave * 12 + interval;
      if (Math.abs(target - pitch) < distance) {
        nearest = pitch;
        distance = Math.abs(target - pitch);
      }
    }
  }
  return nearest;
}

function wrapPitch(pitch, floor) {
  return floor + ((pitch - floor) % 12 + 12) % 12;
}

export function compositionInfo(style, seed) {
  const profile = profiles[style];
  const rng = randomFrom(`${seed}|${profile.scoreStyle ?? style}|composition`);
  const key = pick(profile.keys, rng);
  return {
    key,
    keyName: `${noteNames[key]} ${profile.mode}`,
    bpm: profile.tempo + pick([-4, -2, 0, 2, 4], rng),
    home: Math.floor(rng() * 3),
  };
}

export function composeBar(config, index) {
  const { style, seed, intensity, variation } = config;
  const info = compositionInfo(style, seed);
  const profile = profiles[style];
  if ((profile.scoreStyle ?? style) === "noir") return composeNoirBar(config, index, info);
  const energy = intensity / 100;
  const change = variation / 100;
  const phrase = Math.floor(index / 4);
  const slot = index % 4;
  const section = form[phrase % form.length];
  const contrasting = section === "Contrast" || section === "Development";
  const motifFamily = contrasting ? section : "theme";
  const motif = randomFrom(`${seed}|${style}|${motifFamily}|${slot % 2}`);
  const details = randomFrom(`${seed}|${style}|${index}|details`);
  const changes = randomFrom(`${seed}|${style}|${phrase}|harmony`);
  let progression = info.home;
  if (contrasting || (section === "Theme variation" && changes() < change * .7)) {
    progression = (info.home + (changes() < .48 + change * .19 ? 1 : 3)) % profile.progressions.length;
  }
  const [root, ...chord] = profile.progressions[progression][slot];
  const tonic = 60 + info.key;
  const bass = wrapPitch(tonic + root, 36);
  const events = [];
  const note = (track, pitch, beat, duration, level, extra = {}) => {
    events.push({ track, pitch, beat, duration, level, ...extra });
  };

  const rhythmSet = pick(profile.rhythms, motif);
  const contour = [0, 5, 7, 3, 9, 2, -2, 12];
  let target = tonic + (contrasting ? 8 : 3) + pick([-3, 0, 2, 5], motif);
  for (let position = 0; position < rhythmSet.length; position++) {
    const [beat, duration] = rhythmSet[position];
    target += pick(contour, motif) - 4;
    if (target > tonic + 16) target -= 7;
    if (target < tonic - 3) target += 7;
    if (position && details() < (1 - energy) * .32) continue;
    const ornament = position > 0 && details() < change * .62;
    const anchored = !ornament && (position === 0 || position === rhythmSet.length - 1 || Number.isInteger(beat));
    const pitch = anchored
      ? closestPitch(target, tonic + root, chord.slice(0, 3))
      : closestPitch(target + (ornament ? pick([-3, 2, 4], details) : 0), tonic, profile.scale);
    note("lead", pitch, beat, duration, .59 + energy * .17 + details() * .14);
  }

  if (style === "chip") {
    for (const beat of energy > .66 ? [0, .75, 1.5, 2, 2.75, 3.5] : [0, 1.5, 2, 3.25]) {
      const pitch = beat === 2 ? bass + 7 : bass;
      note("bass", pitch, beat, beat === 0 ? .64 : .43, .69 + energy * .16);
    }
    const step = energy > .7 ? .25 : .5;
    for (let beat = 0; beat < 4; beat += step) {
      if (details() > .3 + energy * .8 && beat % 1 !== 0) continue;
      const index = Math.floor(beat / step + slot) % chord.length;
      const pitch = wrapPitch(tonic + root + chord[index], 56) + (beat % 1 === .75 ? 12 : 0);
      note("harmony", pitch, beat, step * .57, .42 + energy * .22);
    }
  } else {
    for (const beat of energy > .63 ? [0, .82, 1.59, 2, 2.81, 3.58] : [0, 1.58, 2.27, 3.4]) {
      const pitch = beat > 3 ? bass + 12 : beat > 1 && beat < 2 ? bass + 7 : bass;
      note("bass", pitch, beat, beat === 0 ? .63 : .4, .68 + energy * .19);
    }
    for (const beat of energy > .58 ? [.04, 1.6, 2.62] : [.15, 2.42]) {
      chord.slice(1, 5).forEach((interval, voice) => {
        note("harmony", wrapPitch(tonic + root + interval, 54), beat + voice * .024, .68,
          .38 + energy * .14, { pan: (voice % 2 ? .45 : -.45) * (voice < 2 ? .7 : 1) });
      });
    }
    if (details() < .28 + energy * .6) {
      note("harmony", wrapPitch(tonic + root + pick(chord, details), 68), 3.52, .36, .52, { pan: .39 });
    }
  }

  const kicks = energy > .64 ? [0, 1.5, 2.5, 3.5] : [0, 2.5];
  for (const beat of kicks) note("kick", 36, beat, .26, .58 + energy * .25);
  for (const beat of [1, 3]) note("snare", 43, beat, .19, .49 + energy * .26);
  for (const beat of energy > .53 ? [.5, 1.5, 2, 2.5, 3.5] : [.5, 2.5]) {
    note("hat", 49, beat + (style === "fm" ? .06 : 0), .095, .30 + details() * .25);
  }
  if (slot === 3 && change > .32 && details() < change) {
    const pickup = closestPitch(tonic + 11, tonic, profile.scale);
    note("lead", pickup, 3.73, .233, .52);
  }

  return {
    index, phrase, section, keyName: info.keyName, bpm: info.bpm,
    events: events.sort((left, right) => left.beat - right.beat),
  };
}

// Pitches sit in similar registers across the changes, with common tones between voicings.
const noirHome = [0, 7, 14, 15, 22];
const noirOpen = [0, 7, 12, 15, 26];
const noirFlatSix = [8, 8, 12, 15, 19];
const noirFourth = [5, 8, 12, 15, 19];
const noirFlatThree = [3, 7, 10, 14, 19];
const noirFlatSeven = [10, 5, 12, 14, 20];
const noirDominant = [7, 7, 11, 17, 22];
const noirChanges = [
  [noirHome, noirFlatSix, noirFourth, noirOpen],
  [noirHome, noirFlatThree, noirFlatSix, noirDominant],
  [noirOpen, noirFourth, noirFlatSeven, noirHome],
  [noirFlatSix, noirFlatThree, noirFourth, noirDominant],
];

// Lead figures specify onset, length, relative pitch, and the initial scoop in cents.
const noirPhrases = [
  [
    [[1.72, 2.75, 19, -47]],
    [[1.18, 1.38, 15, -36], [2.75, 2.75, 14, -68]],
    [],
    [[.83, 2.97, 12, -31]],
  ],
  [
    [[1.12, 3.24, 15, -37]],
    [[1.48, 2.43, 17, -65]],
    [[2.08, 2.67, 22, -41]],
    [[1.43, 2.37, 19, -31]],
  ],
  [
    [[2.06, 2.16, 22, -48]],
    [[1.15, 1.39, 18, -39], [2.71, 1.76, 19, -52]],
    [],
    [[1.24, 2.73, 15, -76]],
  ],
];
const noirForm = ["Theme", "Response", "Drift", "Return", "Afterglow", "Theme variation", "Suspension", "Return"];

function composeNoirBar({ seed, intensity, variation }, index, info) {
  const energy = intensity / 100;
  const change = variation / 100;
  const phrase = Math.floor(index / 4);
  const slot = index % 4;
  const section = noirForm[phrase % noirForm.length];
  const rng = randomFrom(`${seed}|noir|${index}`);
  const passage = Math.floor(index / 8);
  const progression = noirChanges[(info.home + [0, 1, 0, 3, 2, 1][passage % 6]) % noirChanges.length];
  const [root, ...voices] = progression[Math.floor(index / 2) % 4];
  const tonic = 48 + info.key;
  const chordTones = [root, ...voices.map(pitch => pitch % 12)];
  const events = [];
  const note = (track, pitch, beat, duration, level, options = {}) => {
    events.push({ track, pitch, beat, duration, level, ...options });
  };

  if (index % 2 === 0) {
    note("bass", wrapPitch(tonic + root, 32), .32, 7.3, .62 + energy * .21);
    const pans = [-.48, .44, -.29, .51];
    for (const [voice, semitones] of voices.entries()) {
      const beat = [.08, .46, .86, .31][voice] + rng() * .19;
      const duration = 7.35 - beat * .44 + rng() * .48;
      note("harmony", tonic + semitones, beat, duration, .48 + energy * .23, {
        pan: pans[voice], color: rng(), release: 1.75 + rng() * .78,
      });
    }
    note("air", 0, 0, 8, .64 + rng() * .19, { color: rng() });
  }

  const figure = section === "Response" || section === "Suspension" ? (info.home + 1) % 3 : info.home;
  const motif = noirPhrases[figure][slot];
  const roomForLead = section !== "Afterglow" || (slot === 3 && energy > .65);
  if (roomForLead) {
    for (const [beat, duration, pitch, bend] of motif) {
      const bendVariation = rng() * 22 - 11;
      const target = tonic + pitch + (rng() < change * .43 ? pick([-3, -2, 2, 3], rng) : 0);
      const intervals = duration > 2.1 ? chordTones : blues;
      note("lead", closestPitch(target, tonic, intervals), beat + rng() * .21, duration,
        .62 + energy * .22 + rng() * .10, { bend: bend + bendVariation, color: rng() });
    }
  }

  if ((slot === 2 || slot === 3) && rng() < .20 + energy * .40 + change * .24) {
    const pitch = closestPitch(tonic + pick([27, 31, 34], rng), tonic, chordTones);
    note("keys", pitch, 1.05 + rng() * 1.8, 2.48, .31 + energy * .21, { pan: rng() < .5 ? -.55 : .55 });
  }

  return {
    index, phrase, section, keyName: info.keyName, bpm: info.bpm,
    events: events.sort((left, right) => left.beat - right.beat),
  };
}
