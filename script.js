/* ============================================================
   Gem Merge Rush — script.js (v3.0)
   Vanilla JS, no dependencies.

   CORE RULES — copied verbatim, never touched in this pass:
   getNeighborIndices, getMergeResultTier, evaluateGameOver's
   full-grid-plus-no-moves check, the conveyor spawn tier range
   (1-3), the merge economy (10 coins/merge, tier*15 score, +50
   bonus at Black Opal), and the Magic Gem economy (5 uses/game,
   3s ad countdown, destroy-only, use spent only on an actual
   destroy). Everything else here is a performance, visual,
   audio, or UX layer wrapped around those rules.

   One deliberate exception to "no forced reflows": staggerCellsIn()
   uses a synchronous offsetWidth read. That path only runs once,
   on restart — never during hot gameplay — so it's not part of
   the performance concern the rest of this file addresses.
   ============================================================ */

/* ---------------- Constants ---------------- */

const GRID_SIZE = 4;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 1500;
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const MERGE_ANIM_MS = 260;
const FLIGHT_DURATION_MS = 300;
const MAGIC_USES_MAX = 5;
const HINT_DELAY_MS = 8000;
const STAT_COUNT_DURATION_MS = 420;

const GEM_NAMES = {
  1: "Ruby",
  2: "Sapphire",
  3: "Emerald",
  4: "Amethyst",
  5: "Diamond",
  6: "Topaz",
  7: "Black Opal"
};

const GEM_SYMBOLS = {
  1: "R",
  2: "S",
  3: "E",
  4: "A",
  5: "D",
  6: "T",
  7: "O"
};

const STORAGE_KEYS = {
  highScore: "gmr_high_score",
  coins: "gmr_coins",
  audioMuted: "gmr_audio_muted",
  tutorialSeen: "gmr_tutorial_seen"
};

const TUTORIAL_SLIDES = [
  {
    title: "Place gems from the belt",
    body: "Tap a gem waiting on the conveyor belt, then tap any empty cell on the grid to place it there."
  },
  {
    title: "Merge to go up a tier",
    body: "Place a gem next to a matching gem and they merge into the next tier, earning score and coins."
  },
  {
    title: "Stuck? Use a Magic Gem",
    body: "Watch a short ad to enter Magic Mode and clear one gem from the grid. You get 5 per game."
  }
];

/* ---------------- State ---------------- */

const state = {
  grid: new Array(TOTAL_CELLS).fill(null),
  conveyor: [],
  selectedConveyorIndex: null,
  score: 0,
  coins: 0,
  highScore: 0,
  gameOver: false,
  magicUsesRemaining: MAGIC_USES_MAX,
  magicModeActive: false,
  inputLocked: false,
  totalMerges: 0,
  highestTierReached: 0,
  bestAtGameStart: 0,
  recordBrokenThisGame: false,
  gameStartTimestamp: 0,
  conveyorFullWarned: false,
  audioMuted: false
};

let idCounter = 1;
let spawnTimeoutHandle = null;
let hintTimeoutHandle = null;
let magicBusy = false;
let displayedScore = 0;
let displayedCoins = 0;
let displayedHighScore = 0;
let tutorialIndex = 0;
let renderedGemIds = new Array(TOTAL_CELLS).fill(null);

/* ---------------- DOM references ---------------- */

const gridEl = document.getElementById("grid");
const conveyorEl = document.getElementById("conveyor");
const floatingLayer = document.getElementById("floating-layer");
const scoreValueEl = document.getElementById("score-value");
const coinValueEl = document.getElementById("coin-value");
const highscoreValueEl = document.getElementById("highscore-value");
const highscorePillEl = document.getElementById("highscore-pill");
const adButton = document.getElementById("ad-button");
const cancelMagicBtn = document.getElementById("cancel-magic-btn");
const toastContainer = document.getElementById("toast-container");
const gameOverOverlay = document.getElementById("game-over-overlay");
const finalScoreText = document.getElementById("final-score-text");
const finalHighscoreText = document.getElementById("final-highscore-text");
const statTierText = document.getElementById("stat-tier-text");
const statMergesText = document.getElementById("stat-merges-text");
const statTimeText = document.getElementById("stat-time-text");
const restartButton = document.getElementById("restart-button");
const restartHeaderBtn = document.getElementById("restart-header-btn");
const soundToggleBtn = document.getElementById("sound-toggle-btn");
const helpBtn = document.getElementById("help-btn");
const bgCanvas = document.getElementById("bg-canvas");
const screenFlashEl = document.getElementById("screen-flash");
const boardWrapperEl = document.getElementById("board-wrapper");
const tutorialOverlay = document.getElementById("tutorial-overlay");
const tutorialTitleEl = document.getElementById("tutorial-title");
const tutorialBodyEl = document.getElementById("tutorial-body");
const tutorialDotsEl = document.getElementById("tutorial-dots");
const tutorialBackBtn = document.getElementById("tutorial-back-btn");
const tutorialNextBtn = document.getElementById("tutorial-next-btn");
const tutorialSkipBtn = document.getElementById("tutorial-skip-btn");

/* ---------------- Small utilities ---------------- */

function nextId() {
  return idCounter++;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Restarts a CSS animation via a double requestAnimationFrame instead of a
// synchronous offsetWidth reflow read, so hot-path effects (pops, shakes)
// never force layout.
function restartAnimation(el, className) {
  el.classList.remove(className);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add(className);
    });
  });
}

/* ---------------- Audio System (Web Audio API, no audio files) ---------------- */

let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let droneGain = null;
let droneOscillators = [];
let droneStarted = false;

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx) {
    try {
      audioCtx = new AudioContextClass();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = state.audioMuted ? 0 : 1;
      masterGain.connect(audioCtx.destination);

      sfxGain = audioCtx.createGain();
      sfxGain.gain.value = 1;
      sfxGain.connect(masterGain);

      droneGain = audioCtx.createGain();
      droneGain.gain.value = 0.045;
      droneGain.connect(masterGain);
    } catch (err) {
      audioCtx = null;
      return null;
    }
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(options) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const {
    frequency,
    duration,
    type = "sine",
    volume = 0.2,
    delaySeconds = 0,
    frequencyEnd = null
  } = options;

  try {
    const startTime = ctx.currentTime + delaySeconds;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (frequencyEnd !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(frequencyEnd, 1), startTime + duration);
    }

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(sfxGain);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  } catch (err) {
    // Ignore playback errors; game continues silently.
  }
}

// Short filtered noise burst — used for whoosh/crunch textures a plain
// oscillator can't produce.
function playNoiseBurst(options) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const {
    duration,
    volume = 0.2,
    delaySeconds = 0,
    filterStart = 2200,
    filterEnd = 300,
    filterType = "bandpass"
  } = options;

  try {
    const startTime = ctx.currentTime + delaySeconds;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterStart, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 1), startTime + duration);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(sfxGain);

    noiseSource.start(startTime);
    noiseSource.stop(startTime + duration + 0.02);
  } catch (err) {
    // Ignore playback errors; game continues silently.
  }
}

function playPlaceSound() {
  playNoiseBurst({ duration: 0.1, volume: 0.14, filterStart: 2600, filterEnd: 600 });
  playTone({ frequency: 200, duration: 0.09, type: "sine", volume: 0.1, frequencyEnd: 110 });
}

function playMergeSound(tier) {
  const baseFreq = 240 + tier * 55;
  const intervalRatio = 1.12 + tier * 0.045;
  playTone({ frequency: baseFreq, duration: 0.18, type: "sine", volume: 0.18, frequencyEnd: baseFreq * 1.5 });
  playTone({
    frequency: baseFreq * intervalRatio,
    duration: 0.18,
    type: "triangle",
    volume: 0.12,
    frequencyEnd: baseFreq * intervalRatio * 1.5
  });
}

function playComboChime(step) {
  const semitone = Math.pow(2, 1 / 12);
  const freq = 900 * Math.pow(semitone, Math.max(0, step - 2));
  playTone({ frequency: freq, duration: 0.14, type: "sine", volume: 0.14, delaySeconds: 0.05 });
}

function playCoinSound() {
  // Ascending arpeggio, deliberately starting 700ms after the merge sound
  // it rewards. Scheduled on the audio clock, not setTimeout, so it stays
  // accurate through chain merges.
  const notes = [1300, 1560, 1860];
  notes.forEach((freq, i) => {
    playTone({ frequency: freq, duration: 0.11, type: "sine", volume: 0.09, delaySeconds: 0.7 + i * 0.08 });
  });
}

function playDestroySound() {
  playNoiseBurst({ duration: 0.18, volume: 0.16, filterStart: 1800, filterEnd: 120, filterType: "lowpass" });
  playTone({ frequency: 140, duration: 0.26, type: "sine", volume: 0.16, frequencyEnd: 35 });
}

function playGameOverSound() {
  const notes = [392, 349, 311, 262];
  notes.forEach((freq, i) => {
    const delaySeconds = i * 0.2;
    playTone({ frequency: freq, duration: 0.26, type: "triangle", volume: 0.2, delaySeconds });
    playTone({ frequency: freq, duration: 0.22, type: "sine", volume: 0.08, delaySeconds: delaySeconds + 0.08 });
  });
}

function playFanfare() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((freq, i) => {
    playTone({ frequency: freq, duration: 0.16, type: "triangle", volume: 0.16, delaySeconds: i * 0.09 });
  });
}

function startAmbientDrone() {
  if (droneStarted) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  try {
    [55, 82.5].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(droneGain);
      osc.start();
      droneOscillators.push(osc);
    });
    droneStarted = true;
  } catch (err) {
    // Ignore; game works without the drone.
  }
}

function setAudioMuted(muted) {
  state.audioMuted = muted;
  if (masterGain && audioCtx) {
    try {
      masterGain.gain.linearRampToValueAtTime(muted ? 0 : 1, audioCtx.currentTime + 0.05);
    } catch (err) {
      // Ignore.
    }
  }
  applyAudioButtonLabel();
}

function toggleAudioMuted() {
  const ctx = ensureAudioContext();
  if (ctx) startAmbientDrone();
  setAudioMuted(!state.audioMuted);
  persistAudioPref();
}

function applyAudioButtonLabel() {
  soundToggleBtn.textContent = state.audioMuted ? "🔇" : "🔊";
  soundToggleBtn.setAttribute("aria-label", state.audioMuted ? "Unmute sound" : "Mute sound");
  soundToggleBtn.classList.toggle("muted", state.audioMuted);
}

function primeAudioOnFirstInteraction() {
  ensureAudioContext();
  startAmbientDrone();
}

/* ---------------- Persistence ---------------- */

function loadPersisted() {
  try {
    const storedHigh = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10);
    const storedCoins = parseInt(localStorage.getItem(STORAGE_KEYS.coins), 10);
    state.highScore = Number.isFinite(storedHigh) ? storedHigh : 0;
    state.coins = Number.isFinite(storedCoins) ? storedCoins : 0;
    state.audioMuted = localStorage.getItem(STORAGE_KEYS.audioMuted) === "1";
  } catch (err) {
    state.highScore = 0;
    state.coins = 0;
    state.audioMuted = false;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.highScore, String(state.highScore));
    localStorage.setItem(STORAGE_KEYS.coins, String(state.coins));
  } catch (err) {
    // Ignore write failures silently; game still works in-memory.
  }
}

function persistAudioPref() {
  try {
    localStorage.setItem(STORAGE_KEYS.audioMuted, state.audioMuted ? "1" : "0");
  } catch (err) {
    // Ignore.
  }
}

function hasSeenTutorial() {
  try {
    return localStorage.getItem(STORAGE_KEYS.tutorialSeen) === "1";
  } catch (err) {
    return false;
  }
}

function markTutorialSeen() {
  try {
    localStorage.setItem(STORAGE_KEYS.tutorialSeen, "1");
  } catch (err) {
    // Ignore.
  }
}

/* ---------------- Grid / merge math (CORE RULES — UNCHANGED) ---------------- */

function getNeighborIndices(index) {
  const row = Math.floor(index / GRID_SIZE);
  const col = index % GRID_SIZE;
  const neighbors = [];
  if (row > 0) neighbors.push(index - GRID_SIZE);
  if (col < GRID_SIZE - 1) neighbors.push(index + 1);
  if (row < GRID_SIZE - 1) neighbors.push(index + GRID_SIZE);
  if (col > 0) neighbors.push(index - 1);
  return neighbors;
}

function getMergeResultTier(gemA, gemB) {
  if (!gemA || !gemB) return null;
  if (gemA.isWild && gemB.isWild) return null;
  if (gemA.isWild) return gemB.tier < MAX_TIER ? gemB.tier + 1 : null;
  if (gemB.isWild) return gemA.tier < MAX_TIER ? gemA.tier + 1 : null;
  if (gemA.tier === gemB.tier && gemA.tier < MAX_TIER) return gemA.tier + 1;
  return null;
}

/* ---------------- Starfield background (canvas) ---------------- */

let starParticles = [];
let starfieldRafHandle = null;
let lastStarfieldTime = null;
const prefersReducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function createStarParticle() {
  return {
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    radius: 0.6 + Math.random() * 1.6,
    speed: 4 + Math.random() * 10,
    twinkleOffset: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.5 + Math.random() * 0.6
  };
}

function resizeStarfieldCanvas() {
  if (!bgCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  bgCanvas.width = window.innerWidth * dpr;
  bgCanvas.height = window.innerHeight * dpr;
  bgCanvas.style.width = `${window.innerWidth}px`;
  bgCanvas.style.height = `${window.innerHeight}px`;
}

function drawStarfieldFrame(timestamp, deltaSeconds = 0) {
  if (!bgCanvas) return;
  const ctx = bgCanvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (const star of starParticles) {
    if (deltaSeconds > 0) {
      star.y += star.speed * deltaSeconds;
      if (star.y > window.innerHeight + 4) {
        star.y = -4;
        star.x = Math.random() * window.innerWidth;
      }
    }
    const twinkle = 0.35 + 0.35 * Math.sin((timestamp / 1000) * star.twinkleSpeed + star.twinkleOffset);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 244, 214, ${twinkle.toFixed(3)})`;
    ctx.fill();
  }
}

function runStarfieldLoop(timestamp) {
  if (lastStarfieldTime === null) lastStarfieldTime = timestamp;
  const deltaSeconds = Math.min(0.1, (timestamp - lastStarfieldTime) / 1000);
  lastStarfieldTime = timestamp;
  drawStarfieldFrame(timestamp, deltaSeconds);
  starfieldRafHandle = requestAnimationFrame(runStarfieldLoop);
}

function setupStarfield() {
  if (!bgCanvas || !bgCanvas.getContext) return;
  resizeStarfieldCanvas();
  const starCount = window.innerWidth < 500 ? 26 : 40;
  starParticles = Array.from({ length: starCount }, createStarParticle);
  window.addEventListener("resize", resizeStarfieldCanvas);

  if (prefersReducedMotion) {
    drawStarfieldFrame(performance.now(), 0);
    return;
  }
  starfieldRafHandle = requestAnimationFrame(runStarfieldLoop);
}

/* ---------------- Rendering ---------------- */

function buildGridDOM() {
  gridEl.innerHTML = "";
  for (let i = 0; i < TOTAL_CELLS; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(i);
    gridEl.appendChild(cell);
  }
}

function getGemVisualRect(containerEl) {
  const gemEl = containerEl.querySelector(".gem");
  return gemEl ? gemEl.getBoundingClientRect() : containerEl.getBoundingClientRect();
}

function createGemElement(gem, extraClass) {
  const el = document.createElement("div");
  const tierClass = gem.isWild ? "wild" : `tier-${gem.tier}`;
  el.className = `gem ${tierClass}${extraClass ? " " + extraClass : ""}`;
  el.title = gem.isWild ? "Magic Wildcard Gem" : `${GEM_NAMES[gem.tier]} (Tier ${gem.tier})`;

  const badge = document.createElement("span");
  badge.className = "gem-badge";
  badge.textContent = gem.isWild ? "✦" : GEM_SYMBOLS[gem.tier];
  el.appendChild(badge);

  return el;
}

// Diffed render: only touches a cell's DOM if its gem's id actually
// changed since the last render, instead of wiping and rebuilding all 16
// cells on every call.
function renderGrid() {
  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    const gem = state.grid[i];
    const currentId = gem ? gem.id : null;
    if (renderedGemIds[i] === currentId) continue;

    const cellEl = cells[i];
    cellEl.innerHTML = "";
    if (gem) cellEl.appendChild(createGemElement(gem));
    renderedGemIds[i] = currentId;
  }
  updateDropTargets();
  updateMagicTargets();
}

// UNCHANGED: highlights empty cells as valid drop targets while a conveyor
// gem is selected.
function updateDropTargets() {
  const cells = gridEl.children;
  const showTargets = state.selectedConveyorIndex !== null && !state.gameOver;
  for (let i = 0; i < cells.length; i++) {
    const isValidTarget = showTargets && state.grid[i] === null;
    cells[i].classList.toggle("drop-target", isValidTarget);
  }
}

// Highlights occupied cells as destroy targets while Magic Mode is armed.
// Kept fully separate from updateDropTargets so that function never changes.
function updateMagicTargets() {
  const cells = gridEl.children;
  const showTargets = state.magicModeActive && !state.gameOver;
  for (let i = 0; i < cells.length; i++) {
    const isValidTarget = showTargets && state.grid[i] !== null;
    cells[i].classList.toggle("magic-target", isValidTarget);
  }
}

function renderConveyor() {
  conveyorEl.innerHTML = "";
  for (let i = 0; i < CONVEYOR_MAX; i++) {
    const slot = document.createElement("div");
    slot.className = "conveyor-slot";
    const gem = state.conveyor[i];
    if (gem) {
      slot.classList.add("filled");
      const gemEl = createGemElement(gem);
      gemEl.dataset.conveyorIndex = String(i);
      if (state.selectedConveyorIndex === i) gemEl.classList.add("selected");
      slot.appendChild(gemEl);
    }
    conveyorEl.appendChild(slot);
  }
}

function triggerStatPop(el) {
  restartAnimation(el, "pop-anim");
}

function updateScoreboard() {
  displayedScore = state.score;
  displayedCoins = state.coins;
  displayedHighScore = state.highScore;
  scoreValueEl.textContent = String(state.score);
  coinValueEl.textContent = String(state.coins);
  highscoreValueEl.textContent = String(state.highScore);
}

function getDisplayedValue(kind) {
  if (kind === "score") return displayedScore;
  if (kind === "coins") return displayedCoins;
  return displayedHighScore;
}

function setDisplayedValue(kind, value) {
  if (kind === "score") displayedScore = value;
  else if (kind === "coins") displayedCoins = value;
  else displayedHighScore = value;
}

// Animates a stat's displayed number counting up toward its new value
// instead of jumping instantly.
function animateStatCountTo(el, targetValue, kind) {
  const startValue = getDisplayedValue(kind);
  if (startValue === targetValue) {
    el.textContent = String(targetValue);
    return;
  }
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / STAT_COUNT_DURATION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.round(startValue + (targetValue - startValue) * eased);
    setDisplayedValue(kind, currentValue);
    el.textContent = String(currentValue);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      setDisplayedValue(kind, targetValue);
      el.textContent = String(targetValue);
    }
  }

  requestAnimationFrame(step);
}

function updateHighScoreDisplay() {
  if (displayedHighScore !== state.highScore) {
    animateStatCountTo(highscoreValueEl, state.highScore, "highScore");
  }
}

/* ---------------- Toasts ---------------- */

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-fade");
    setTimeout(() => toast.remove(), 400);
  }, 1700);
}

/* ---------------- Floating / particle effects ---------------- */

function spawnFloatingReward(cellIndex, text) {
  const cellEl = gridEl.children[cellIndex];
  const cellRect = cellEl.getBoundingClientRect();
  const layerRect = floatingLayer.getBoundingClientRect();

  const el = document.createElement("div");
  el.className = "floating-reward";
  el.textContent = text;
  el.style.left = `${cellRect.left - layerRect.left + cellRect.width / 2}px`;
  el.style.top = `${cellRect.top - layerRect.top + cellRect.height / 2}px`;

  floatingLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function spawnCellRipple(index) {
  const cellEl = gridEl.children[index];
  const ripple = document.createElement("div");
  ripple.className = "cell-ripple";
  cellEl.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

function spawnSparkleEffect(cellIndex) {
  const cellEl = gridEl.children[cellIndex];
  const cellRect = cellEl.getBoundingClientRect();
  const layerRect = floatingLayer.getBoundingClientRect();
  const centerX = cellRect.left - layerRect.left + cellRect.width / 2;
  const centerY = cellRect.top - layerRect.top + cellRect.height / 2;
  const particleCount = 8;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("div");
    particle.className = "sparkle-particle";
    const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 26 + Math.random() * 20;

    particle.style.left = `${centerX}px`;
    particle.style.top = `${centerY}px`;
    particle.style.setProperty("--sparkle-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--sparkle-y", `${Math.sin(angle) * distance}px`);
    particle.style.animationDelay = `${Math.random() * 0.05}s`;

    floatingLayer.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove());
  }
}

function spawnConfettiBurst() {
  const boardRect = gridEl.getBoundingClientRect();
  const layerRect = floatingLayer.getBoundingClientRect();
  const centerX = boardRect.left - layerRect.left + boardRect.width / 2;
  const centerY = boardRect.top - layerRect.top + boardRect.height / 2;
  const colors = ["#ffd76a", "#ff8a9a", "#74eeb4", "#6fc3f7", "#d2acf7"];

  for (let i = 0; i < 18; i++) {
    const particle = document.createElement("div");
    particle.className = "confetti-particle";
    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 60;

    particle.style.left = `${centerX}px`;
    particle.style.top = `${centerY}px`;
    particle.style.background = colors[i % colors.length];
    particle.style.setProperty("--sparkle-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--sparkle-y", `${Math.sin(angle) * distance - 20}px`);
    particle.style.animationDelay = `${Math.random() * 0.08}s`;
    particle.style.animationDuration = `${0.7 + Math.random() * 0.3}s`;

    floatingLayer.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove());
  }
}

function spawnComboBadge(comboCount) {
  const badge = document.createElement("div");
  badge.className = "combo-badge";
  badge.textContent = `${comboCount}× Combo!`;
  floatingLayer.appendChild(badge);
  badge.addEventListener("animationend", () => badge.remove());
}

function triggerScreenFlash() {
  restartAnimation(screenFlashEl, "flash-active");
}

function triggerNewHighScoreEffect() {
  restartAnimation(highscorePillEl, "rainbow-glow");
  spawnConfettiBurst();
  playFanfare();
  showToast("🏆 New Best Score!");
}

/* ---------------- Hint system ---------------- */

function resetHintTimer() {
  clearTimeout(hintTimeoutHandle);
  clearHints();
  if (state.gameOver) return;
  hintTimeoutHandle = setTimeout(showHints, HINT_DELAY_MS);
}

function clearHints() {
  gridEl.querySelectorAll(".hint-glow").forEach((el) => el.classList.remove("hint-glow"));
}

// Read-only: reuses getNeighborIndices / getMergeResultTier purely to find
// which cells COULD merge right now. Never mutates game state.
function showHints() {
  if (state.gameOver || state.magicModeActive) return;

  const hintablePairs = new Set();
  state.grid.forEach((gem, i) => {
    if (!gem) return;
    getNeighborIndices(i).forEach((n) => {
      if (getMergeResultTier(gem, state.grid[n]) !== null) {
        hintablePairs.add(i);
        hintablePairs.add(n);
      }
    });
  });

  hintablePairs.forEach((i) => {
    const cellEl = gridEl.children[i];
    cellEl.classList.add("hint-glow");
    const gemEl = cellEl.querySelector(".gem");
    if (gemEl) gemEl.classList.add("hint-glow");
  });
}

/* ---------------- Conveyor spawning ---------------- */

function spawnConveyorGem() {
  if (state.gameOver) return;

  if (state.conveyor.length >= CONVEYOR_MAX) {
    if (!state.conveyorFullWarned) {
      state.conveyorFullWarned = true;
      restartAnimation(conveyorEl, "belt-full-flash");
      showToast("Belt full — place a gem!");
    }
    return;
  }

  const tier = randInt(1, 3); // Ruby, Sapphire, or Emerald only
  state.conveyor.push({ tier, isWild: false, id: nextId() });
  renderConveyor();
}

// setTimeout re-scheduled after each spawn (instead of setInterval) so the
// belt's timing can't drift under load.
function scheduleNextSpawn() {
  clearTimeout(spawnTimeoutHandle);
  spawnTimeoutHandle = setTimeout(() => {
    spawnConveyorGem();
    scheduleNextSpawn();
  }, SPAWN_INTERVAL_MS);
}

/* ---------------- Selection logic (UNCHANGED core, additive guards) ---------------- */

function selectConveyorItem(index) {
  if (state.gameOver || state.inputLocked) return;
  resetHintTimer();
  if (state.magicModeActive) {
    showToast("Magic Mode is active — tap a gem on the grid to destroy it");
    return;
  }
  state.selectedConveyorIndex = state.selectedConveyorIndex === index ? null : index;
  renderConveyor();
  updateDropTargets();
}

function cancelSelection() {
  if (state.selectedConveyorIndex === null) return;
  state.selectedConveyorIndex = null;
  renderConveyor();
  updateDropTargets();
}

/* ---------------- Placement & merging (CORE RULES — UNCHANGED) ---------------- */

function flashShake(index) {
  restartAnimation(gridEl.children[index], "shake");
}

// Flies a gem clone from its conveyor slot to its destination cell using
// the Web Animations API. Falls back to an instant placement if .animate()
// is unsupported or the user prefers reduced motion.
function flyGemBetweenRects(gem, sourceRect, destRect) {
  return new Promise((resolve) => {
    try {
      const layerRect = floatingLayer.getBoundingClientRect();
      const sourceCenterX = sourceRect.left - layerRect.left + sourceRect.width / 2;
      const sourceCenterY = sourceRect.top - layerRect.top + sourceRect.height / 2;
      const destCenterX = destRect.left - layerRect.left + destRect.width / 2;
      const destCenterY = destRect.top - layerRect.top + destRect.height / 2;
      const destGemWidth = destRect.width * 0.86;
      const destGemHeight = destRect.height * 0.86;
      const scaleX = sourceRect.width > 0 ? destGemWidth / sourceRect.width : 1;
      const scaleY = sourceRect.height > 0 ? destGemHeight / sourceRect.height : 1;
      const dx = destCenterX - sourceCenterX;
      const dy = destCenterY - sourceCenterY;

      const flyEl = createGemElement(gem);
      flyEl.classList.add("flying-gem");
      flyEl.style.position = "absolute";
      flyEl.style.left = `${sourceCenterX}px`;
      flyEl.style.top = `${sourceCenterY}px`;
      flyEl.style.width = `${sourceRect.width}px`;
      flyEl.style.height = `${sourceRect.height}px`;
      flyEl.style.transform = "translate(-50%, -50%) scale(1)";
      floatingLayer.appendChild(flyEl);

      if (typeof flyEl.animate !== "function" || prefersReducedMotion) {
        flyEl.remove();
        resolve();
        return;
      }

      const animation = flyEl.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)" },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scaleX}, ${scaleY})` }
        ],
        { duration: FLIGHT_DURATION_MS, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" }
      );

      const cleanup = () => {
        flyEl.remove();
        resolve();
      };
      animation.addEventListener("finish", cleanup);
      animation.addEventListener("cancel", cleanup);
    } catch (err) {
      resolve();
    }
  });
}

async function handleGridCellClick(index) {
  if (state.gameOver || state.inputLocked) return;
  resetHintTimer();

  if (state.magicModeActive) {
    await handleMagicDestroy(index);
    return;
  }

  // --- Original placement guard clauses, unchanged. ---

  if (state.selectedConveyorIndex === null) {
    showToast("Pick a gem from the belt first");
    return;
  }

  if (state.grid[index] !== null) {
    flashShake(index);
    showToast("That cell's taken — pick an empty one");
    return;
  }

  state.inputLocked = true;

  const sourceIndex = state.selectedConveyorIndex;
  const sourceRect = getGemVisualRect(conveyorEl.children[sourceIndex]);
  const gem = state.conveyor.splice(sourceIndex, 1)[0];
  state.selectedConveyorIndex = null;
  state.conveyorFullWarned = false;
  renderConveyor();

  const destRect = gridEl.children[index].getBoundingClientRect();
  await flyGemBetweenRects(gem, sourceRect, destRect);

  state.grid[index] = gem;
  renderGrid();
  playPlaceSound();
  spawnCellRipple(index);

  const gemEl = gridEl.children[index].querySelector(".gem");
  if (gemEl) gemEl.classList.add("placed");

  await resolveMergesAt(index);
  evaluateGameOver();
  persist();

  state.inputLocked = false;
}

// UNCHANGED control flow: same while/for/break structure as before, same
// calls to getNeighborIndices / getMergeResultTier, same merge order. Only
// the neighbor's exit animation (merge-suck instead of pop-out) and combo
// tracking are new.
async function resolveMergesAt(index) {
  let mergedSomething = true;
  let comboCount = 0;

  while (mergedSomething) {
    mergedSomething = false;
    const current = state.grid[index];
    if (!current) break;

    const neighbors = getNeighborIndices(index);
    for (const neighborIndex of neighbors) {
      const neighborGem = state.grid[neighborIndex];
      const resultTier = getMergeResultTier(current, neighborGem);
      if (resultTier === null) continue;

      const cellEl = gridEl.children[index];
      const neighborCellEl = gridEl.children[neighborIndex];
      const gemEl = cellEl.querySelector(".gem");
      const neighborGemEl = neighborCellEl.querySelector(".gem");

      if (gemEl) gemEl.classList.add("pulse");
      if (neighborGemEl) {
        const currentCellRect = cellEl.getBoundingClientRect();
        const neighborCellRect = neighborCellEl.getBoundingClientRect();
        const mergeDx = (currentCellRect.left + currentCellRect.width / 2) - (neighborCellRect.left + neighborCellRect.width / 2);
        const mergeDy = (currentCellRect.top + currentCellRect.height / 2) - (neighborCellRect.top + neighborCellRect.height / 2);
        neighborGemEl.style.setProperty("--merge-dx", `${mergeDx}px`);
        neighborGemEl.style.setProperty("--merge-dy", `${mergeDy}px`);
        neighborGemEl.classList.add("merge-suck");
      }

      await delay(MERGE_ANIM_MS);

      state.grid[neighborIndex] = null;
      state.grid[index] = { tier: resultTier, isWild: false, id: nextId() };
      renderGrid();

      const newGemEl = gridEl.children[index].querySelector(".gem");
      if (newGemEl) newGemEl.classList.add("placed");

      comboCount += 1;
      awardMerge(resultTier, index);
      if (comboCount >= 2) {
        spawnComboBadge(comboCount);
        playComboChime(comboCount);
      }

      mergedSomething = true;
      break;
    }
  }
}

// Economy is byte-for-byte the same math as before: +10 coins/merge,
// score += tier*15, +50 bonus coins at MAX_TIER. Everything below that is
// presentation (sound, flash, counting animation, high-score fanfare).
function awardMerge(resultTier, cellIndex) {
  const coinGain = 10;
  const scoreGain = resultTier * 15;

  state.score += scoreGain;
  state.coins += coinGain;
  state.totalMerges += 1;
  if (resultTier > state.highestTierReached) {
    state.highestTierReached = resultTier;
  }

  playMergeSound(resultTier);
  playCoinSound();

  if (resultTier >= 5) {
    triggerScreenFlash();
  }

  if (resultTier === MAX_TIER) {
    state.coins += 50;
    showToast("🎉 Black Opal formed! +50 bonus coins");
  }

  if (!state.recordBrokenThisGame && state.score > state.bestAtGameStart) {
    state.recordBrokenThisGame = true;
    triggerNewHighScoreEffect();
  }

  if (state.score > state.highScore) {
    state.highScore = state.score;
  }

  spawnFloatingReward(cellIndex, `+${coinGain}`);
  animateStatCountTo(scoreValueEl, state.score, "score");
  animateStatCountTo(coinValueEl, state.coins, "coins");
  updateHighScoreDisplay();
  triggerStatPop(scoreValueEl);
  triggerStatPop(coinValueEl);
}

/* ---------------- Magic Gem ---------------- */

async function handleMagicDestroy(index) {
  const gem = state.grid[index];
  if (!gem) {
    showToast("Tap a gem, not an empty cell");
    return;
  }

  state.inputLocked = true;
  // Spend the use immediately so a fast second tap can't double-spend it.
  state.magicModeActive = false;
  state.magicUsesRemaining = Math.max(0, state.magicUsesRemaining - 1);
  updateMagicModeUI();
  updateMagicTargets();

  const cellEl = gridEl.children[index];
  const gemEl = cellEl.querySelector(".gem");

  playDestroySound();
  spawnSparkleEffect(index);
  restartAnimation(cellEl, "shake");
  if (gemEl) gemEl.classList.add("destroy-pop");

  await delay(320);

  state.grid[index] = null;
  renderGrid();

  evaluateGameOver();
  persist();
  resetHintTimer();
  state.inputLocked = false;
}

function getAdButtonLabel() {
  if (state.magicUsesRemaining <= 0) return "No Magic Gems Left";
  return `Watch Ad for Magic Gem (${state.magicUsesRemaining} Left)`;
}

function updateMagicModeUI() {
  adButton.textContent = state.magicModeActive ? "✦ Tap a gem to destroy it" : getAdButtonLabel();
  adButton.disabled = state.gameOver || state.magicModeActive || state.magicUsesRemaining <= 0 || magicBusy;
  adButton.classList.toggle("magic-armed", state.magicModeActive);
  gridEl.classList.toggle("magic-mode", state.magicModeActive);
  cancelMagicBtn.classList.toggle("hidden", !state.magicModeActive);
}

async function handleWatchAd() {
  if (state.gameOver || magicBusy || state.magicModeActive || state.inputLocked) return;

  if (state.magicUsesRemaining <= 0) {
    showToast("No Magic Gems left this game");
    return;
  }

  magicBusy = true;
  adButton.disabled = true;
  ensureAudioContext();
  startAmbientDrone();

  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) {
    adButton.textContent = `▶ Ad playing... ${s}`;
    await delay(1000);
  }

  magicBusy = false;
  activateMagicMode();
}

function activateMagicMode() {
  state.magicModeActive = true;
  state.selectedConveyorIndex = null;
  clearTimeout(hintTimeoutHandle);
  clearHints();
  renderConveyor();
  updateDropTargets();
  updateMagicTargets();
  updateMagicModeUI();
  showToast("Magic Mode: tap any gem on the grid to destroy it");
}

function cancelMagicMode() {
  if (!state.magicModeActive) return;
  state.magicModeActive = false;
  updateMagicModeUI();
  updateMagicTargets();
  resetHintTimer();
  showToast("Magic Mode cancelled");
}

/* ---------------- Game over (EVALUATION LOGIC — UNCHANGED) ---------------- */

function evaluateGameOver() {
  if (state.grid.includes(null)) return; // board still has space

  const hasMove = state.grid.some((gem, i) =>
    getNeighborIndices(i).some((n) => getMergeResultTier(gem, state.grid[n]) !== null)
  );

  if (!hasMove) triggerGameOver();
}

function triggerGameOver() {
  state.gameOver = true;
  state.magicModeActive = false;
  clearTimeout(spawnTimeoutHandle);
  clearTimeout(hintTimeoutHandle);
  clearHints();

  playGameOverSound();

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - state.gameStartTimestamp) / 1000));
  finalScoreText.textContent = `Score: ${state.score}`;
  finalHighscoreText.textContent = `Best: ${state.highScore}`;
  statTierText.textContent = state.highestTierReached > 0
    ? `Highest Gem: ${GEM_NAMES[state.highestTierReached]} (Tier ${state.highestTierReached})`
    : "Highest Gem: —";
  statMergesText.textContent = `Total Merges: ${state.totalMerges}`;
  statTimeText.textContent = `Time Played: ${elapsedSeconds}s`;

  boardWrapperEl.classList.add("board-blurred");
  gameOverOverlay.classList.remove("hidden");

  updateDropTargets();
  updateMagicTargets();
  updateMagicModeUI();
  persist();
}

/* ---------------- Restart ---------------- */

function staggerCellsIn() {
  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    const cellEl = cells[i];
    cellEl.classList.remove("cell-enter");
    cellEl.style.animationDelay = `${i * 30}ms`;
    void cellEl.offsetWidth; // one-off reflow; restart path only, not hot gameplay
    cellEl.classList.add("cell-enter");
  }
}

function restartGame() {
  clearTimeout(spawnTimeoutHandle);
  clearTimeout(hintTimeoutHandle);
  clearHints();

  state.grid = new Array(TOTAL_CELLS).fill(null);
  state.conveyor = [];
  state.selectedConveyorIndex = null;
  state.score = 0;
  state.gameOver = false;
  state.magicUsesRemaining = MAGIC_USES_MAX;
  state.magicModeActive = false;
  state.inputLocked = false;
  state.totalMerges = 0;
  state.highestTierReached = 0;
  state.bestAtGameStart = state.highScore;
  state.recordBrokenThisGame = false;
  state.gameStartTimestamp = Date.now();
  state.conveyorFullWarned = false;
  magicBusy = false;

  gameOverOverlay.classList.add("hidden");
  boardWrapperEl.classList.remove("board-blurred");
  cancelMagicBtn.classList.add("hidden");

  buildGridDOM();
  renderedGemIds = new Array(TOTAL_CELLS).fill(null);
  renderGrid();
  staggerCellsIn();
  renderConveyor();
  updateScoreboard();
  updateMagicModeUI();

  spawnConveyorGem();
  scheduleNextSpawn();
  resetHintTimer();

  persist();
}

/* ---------------- Tutorial ---------------- */

function renderTutorialSlide() {
  const slide = TUTORIAL_SLIDES[tutorialIndex];
  tutorialTitleEl.textContent = slide.title;
  tutorialBodyEl.textContent = slide.body;

  tutorialDotsEl.innerHTML = "";
  TUTORIAL_SLIDES.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "tutorial-dot" + (i === tutorialIndex ? " active" : "");
    tutorialDotsEl.appendChild(dot);
  });

  tutorialBackBtn.disabled = tutorialIndex === 0;
  tutorialNextBtn.textContent = tutorialIndex === TUTORIAL_SLIDES.length - 1 ? "Got it" : "Next";
}

function openTutorial() {
  tutorialIndex = 0;
  renderTutorialSlide();
  tutorialOverlay.classList.remove("hidden");
}

function closeTutorial() {
  tutorialOverlay.classList.add("hidden");
  markTutorialSeen();
}

function tutorialNext() {
  if (tutorialIndex < TUTORIAL_SLIDES.length - 1) {
    tutorialIndex += 1;
    renderTutorialSlide();
  } else {
    closeTutorial();
  }
}

function tutorialBack() {
  if (tutorialIndex > 0) {
    tutorialIndex -= 1;
    renderTutorialSlide();
  }
}

/* ---------------- Event wiring ---------------- */

conveyorEl.addEventListener("click", (e) => {
  const gemEl = e.target.closest(".gem");
  if (!gemEl) {
    cancelSelection();
    return;
  }
  selectConveyorItem(parseInt(gemEl.dataset.conveyorIndex, 10));
});

gridEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  handleGridCellClick(parseInt(cell.dataset.index, 10));
});

adButton.addEventListener("click", handleWatchAd);
cancelMagicBtn.addEventListener("click", cancelMagicMode);
restartButton.addEventListener("click", restartGame);
restartHeaderBtn.addEventListener("click", restartGame);
soundToggleBtn.addEventListener("click", toggleAudioMuted);
helpBtn.addEventListener("click", openTutorial);
tutorialNextBtn.addEventListener("click", tutorialNext);
tutorialBackBtn.addEventListener("click", tutorialBack);
tutorialSkipBtn.addEventListener("click", closeTutorial);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state.magicModeActive) cancelMagicMode();
  else if (state.selectedConveyorIndex !== null) cancelSelection();
});

document.addEventListener("pointerdown", primeAudioOnFirstInteraction, { once: true });

/* ---------------- Init ---------------- */

function init() {
  const requiredElements = {
    gridEl, conveyorEl, floatingLayer, scoreValueEl, coinValueEl, highscoreValueEl,
    highscorePillEl, adButton, cancelMagicBtn, toastContainer, gameOverOverlay,
    finalScoreText, finalHighscoreText, statTierText, statMergesText, statTimeText,
    restartButton, restartHeaderBtn, soundToggleBtn, helpBtn, bgCanvas, screenFlashEl,
    boardWrapperEl, tutorialOverlay, tutorialTitleEl, tutorialBodyEl, tutorialDotsEl,
    tutorialBackBtn, tutorialNextBtn, tutorialSkipBtn
  };
  const missing = Object.entries(requiredElements).filter(([, el]) => !el).map(([name]) => name);
  if (missing.length > 0) {
    console.error("Gem Merge Rush: could not start — missing DOM elements:", missing.join(", "));
    return;
  }

  loadPersisted();
  applyAudioButtonLabel();
  setupStarfield();

  buildGridDOM();
  renderedGemIds = new Array(TOTAL_CELLS).fill(null);
  renderGrid();
  renderConveyor();
  updateScoreboard();
  updateMagicModeUI();

  state.bestAtGameStart = state.highScore;
  state.gameStartTimestamp = Date.now();

  spawnConveyorGem();
  scheduleNextSpawn();
  resetHintTimer();

  if (!hasSeenTutorial()) {
    openTutorial();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
