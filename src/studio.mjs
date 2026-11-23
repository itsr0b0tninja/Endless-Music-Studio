import { Playback } from "./audio.mjs";
import { composeBar, profiles } from "./composer.mjs";

const element = id => document.getElementById(id);
const sliders = ["intensity", "variation", "volume"];
const styles = document.querySelectorAll("input[name=style]");
const play = element("play");
const stop = element("stop");
const error = element("error");
const seedButton = element("new-seed");
const canvas = element("score");
const playhead = element("playhead");
const readouts = {
  state: element("status").querySelector("span"),
  style: element("playing-style"),
  phrase: element("phrase-label"),
  music: element("key-tempo"),
  elapsed: element("elapsed"),
  seed: element("seed-display"),
};
const storageKey = "endless-music-studio-v1";

function freshSeed() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (random[0] % 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
}

function loadSettings() {
  const config = { style: "chip", intensity: 55, variation: 45, volume: 65, seed: freshSeed() };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (stored && Object.hasOwn(profiles, stored.style)) config.style = stored.style;
    if (stored && /^[A-Z0-9]{6}$/.test(stored.seed)) config.seed = stored.seed;
    for (const name of sliders) {
      const value = stored?.[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        config[name] = Math.round(Math.min(100, Math.max(0, value)));
      }
    }
  } catch {
    // Playback works in a browser that blocks storage.
  }
  return config;
}

const config = loadSettings();
const playback = new Playback(config);
let busy = false;
let animation = 0;
let needsDraw = true;
let lastActive;
let lastScheduled;

function updateText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function updateSlider(name) {
  const field = element(name);
  const percent = `${config[name]}%`;
  field.style.setProperty("--level", percent);
  element(`${name}-value`).value = percent;
}

function saveSettings() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(config));
  } catch {
    // The controls remain available for this session.
  }
  playback.setConfig(config);
  needsDraw = true;
  render();
}

function displayTime(elapsed) {
  const total = Math.floor(elapsed);
  const hours = Math.floor(total / 3600);
  const minute = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const second = String(total % 60).padStart(2, "0");
  updateText(readouts.elapsed, hours ? `${hours}:${minute}:${second}` : `${minute}:${second}`);
  const duration = `PT${total}S`;
  if (readouts.elapsed.dateTime !== duration) readouts.elapsed.dateTime = duration;
}

function setup() {
  document.body.dataset.style = config.style;
  for (const name of sliders) {
    const field = element(name);
    field.value = config[name];
    updateSlider(name);
    field.addEventListener("input", () => {
      config[name] = Number(field.value);
      updateSlider(name);
      saveSettings();
    });
  }
  for (const choice of styles) {
    choice.checked = choice.value === config.style;
    choice.addEventListener("change", () => {
      if (!choice.checked) return;
      config.style = choice.value;
      saveSettings();
    });
  }
  seedButton.addEventListener("click", () => {
    let next = freshSeed();
    if (next === config.seed) next = freshSeed();
    config.seed = next;
    saveSettings();
  });
  play.addEventListener("click", togglePlay);
  stop.addEventListener("click", () => {
    playback.stop();
    error.hidden = true;
    refreshTransport();
    render();
  });
  window.addEventListener("keydown", event => {
    if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("button,input,a,select,textarea,[contenteditable]")) return;
    event.preventDefault();
    togglePlay();
  });
  new ResizeObserver(() => {
    needsDraw = true;
    render();
  }).observe(canvas);
  refreshTransport();
  saveSettings();
}

async function togglePlay() {
  if (busy) return;
  busy = true;
  error.hidden = true;
  refreshTransport();
  try {
    if (playback.state === "playing") await playback.pause();
    else await playback.play();
  } catch (failure) {
    error.textContent = failure.message || "Playback could not start. Try Play again.";
    error.hidden = false;
  } finally {
    busy = false;
    refreshTransport();
    render();
  }
}

function refreshTransport() {
  const { state } = playback;
  const stateLabel = state === "playing" ? "Playing" : state === "paused" ? "Paused" : "Ready";
  element("status").dataset.state = state;
  updateText(readouts.state, stateLabel);
  play.dataset.state = state;
  play.querySelector(".play-label").textContent = state === "playing" ? "Pause" : state === "paused" ? "Resume" : "Play";
  play.setAttribute("aria-disabled", String(busy));
  stop.disabled = busy || state === "ready";
}

function animate() {
  animation = 0;
  render();
}

function render() {
  const frame = playback.frame();
  const active = frame?.active;
  const audible = active?.config ?? config;
  if (document.body.dataset.style !== audible.style) document.body.dataset.style = audible.style;
  const styleName = profiles[audible.style].name;
  const queue = audible.style !== config.style
    ? ` · ${profiles[config.style].name} queued`
    : audible.seed !== config.seed ? " · new seed queued" : "";
  updateText(readouts.style, styleName + queue);
  updateText(readouts.seed, `Seed ${audible.seed}`);
  displayTime(frame?.elapsed ?? 0);

  const scheduled = frame?.records.at(-1);
  if (needsDraw || lastActive !== active || lastScheduled !== scheduled) {
    const bar = active?.bar ?? composeBar(config, 0);
    const first = bar.phrase * 4;
    const previewConfig = audible.style === config.style && audible.seed === config.seed ? config : audible;
    const phrase = Array.from({ length: 4 }, (_, index) => {
      const actual = frame?.records.find(record => record.epoch === active.epoch && record.bar.index === first + index);
      return actual?.bar ?? composeBar(previewConfig, first + index);
    });
    updateText(readouts.phrase, `Phrase ${String(bar.phrase + 1).padStart(2, "0")} · ${bar.section}`);
    updateText(readouts.music, `${bar.keyName} · ${bar.bpm} BPM`);
    drawPhrase(phrase);
    needsDraw = false;
    lastActive = active;
    lastScheduled = scheduled;
  }
  playhead.hidden = !frame;
  if (frame) {
    const position = (active.bar.index % 4 * 4 + frame.position) / 16;
    playhead.style.transform = `translateX(${Math.min(canvas.clientWidth - 1, canvas.clientWidth * position)}px)`;
  }
  if (playback.state === "playing" && !animation) animation = requestAnimationFrame(animate);
}

function noteRow(event) {
  const pitch = event.pitch;
  const ratio = (value, floor, ceiling) => Math.min(1, Math.max(0, (value - floor) / (ceiling - floor)));
  switch (event.track) {
    case "lead": return .31 - ratio(pitch, 58, 86) * .26;
    case "keys":
    case "harmony": return .58 - ratio(pitch, 50, 80) * .21;
    case "bass": return .80 - ratio(pitch, 32, 57) * .16;
    case "kick": return .94;
    case "snare": return .90;
    default: return .86;
  }
}

function drawPhrase(bars) {
  const graphics = canvas.getContext("2d");
  const { clientWidth: width, clientHeight: height } = canvas;
  if (!graphics || !width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  graphics.setTransform(scale, 0, 0, scale, 0, 0);
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const beatWidth = width / 16;

  graphics.lineWidth = 1;
  for (let beat = 0; beat <= 16; beat++) {
    graphics.strokeStyle = beat % 4 === 0 ? "#424353" : "#282a38";
    const x = Math.min(width - .5, Math.floor(beat * beatWidth) + .5);
    graphics.beginPath();
    graphics.moveTo(x, 0);
    graphics.lineTo(x, height);
    graphics.stroke();
  }
  for (let row = 0; row <= 25; row++) {
    const y = Math.min(height - .5, Math.floor(row / 25 * height) + .5);
    graphics.strokeStyle = [0, 8, 15, 21, 25].includes(row) ? "#373848" : "#232431";
    graphics.beginPath();
    graphics.moveTo(0, y);
    graphics.lineTo(width, y);
    graphics.stroke();
  }

  const rowHeight = Math.max(2.5, height * .025);
  const palette = { lead: accent, harmony: "#9492dc", keys: "#aaa6e5", bass: "#63c4ba" };
  bars.forEach((bar, slot) => {
    for (const event of bar.events) {
      if (event.track === "air") continue;
      const x = (slot * 4 + event.beat) * beatWidth + 1;
      const y = noteRow(event) * height;
      const length = Math.min(width - x, Math.max(2, event.duration * beatWidth - 1.7));
      graphics.fillStyle = palette[event.track] ?? "#ad8a77";
      graphics.globalAlpha = event.track === "lead" ? .93 : Math.min(.96, .46 + event.level * .48);
      const drum = !Object.hasOwn(palette, event.track);
      graphics.fillRect(x, y - rowHeight / 2, drum ? Math.min(length, 5) : length, rowHeight);
    }
  });
  graphics.globalAlpha = 1;
}

setup();
