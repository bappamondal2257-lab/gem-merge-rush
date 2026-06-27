/* ============================================================
   Gem Merge Rush — script.js
   Vanilla JS, no dependencies. Fully self-contained game logic.

   Update notes (this revision):
   - FIX: restored the file's missing tail section (the rest of
     activateMagicMode(), event wiring, and the init() function +
     call were missing, which is why the grid/conveyor never
     rendered — buildGridDOM() and spawnConveyorGem() were never
     being invoked).
   - init() now runs safely whether the DOM is already parsed
     (script loaded with `defer`) or not yet parsed, and logs a
     clear console error instead of failing silently if required
     DOM elements are missing.
   - All other logic (selection, drop-targets, merge rules,
     game-over evaluation, audio, Magic Mode) is unchanged.
   ============================================================ */

/* ---------------- Constants ---------------- */

const GRID_SIZE = 4;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 1500; // Faster belt: was 3000ms, now twice as fast.
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const MERGE_ANIM_MS = 260;
const MAGIC_USES_MAX = 5; // Total Magic Gem uses allowed per game.

// Gem chain: tiers 1-3 spawn on the belt. 4-7 only ever appear via merging.
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
  coins: "gmr_coins"
};

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
  magicModeActive: false
};

let idCounter = 1;
let spawnIntervalHandle = null;
let magicBusy = false; // True only while the ad countdown is playing.

/* ---------------- DOM references ---------------- */

const gridEl = document.getElementById("grid");
const conveyorEl = document.getElementById("conveyor");
const floatingLayer = document.getElementById("floating-layer");
const scoreValueEl = document.getElementById("score-value");
const coinValueEl = document.getElementById("coin-value");
const highscoreValueEl = document.getElementById("highscore-value");
const adButton = document.getElementById("ad-button");
const toastContainer = document.getElementById("toast-container");
const gameOverOverlay = document.getElementById("game-over-overlay");
const finalScoreText = document.getElementById("final-score-text");
const finalHighscoreText = document.getElementById("final-highscore-text");
const restartButton = document.getElementById("restart-button");
const restartHeaderBtn = document.getElementById("restart-header-btn");

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

/* ---------------- Audio System (Web Audio API, no audio files) ---------------- */

let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Plays a single oscillator tone with a short attack/decay envelope so it
// doesn't click. Every sound effect in the game is built from this helper.
function playTone(options) {
  const {
    frequency,
    duration,
    type = "sine",
    volume = 0.2,
    delaySeconds = 0,
    frequencyEnd = null
  } = options;

  try {
    const ctx = ensureAudioContext();
    const startTime = ctx.currentTime + delaySeconds;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (frequencyEnd !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(frequencyEnd, 1),
        startTime + duration
      );
    }

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  } catch (err) {
    // Audio can be blocked before any user gesture, or unsupported entirely.
    // Either way, the game keeps working silently without sound.
  }
}

function playPlaceSound() {
  playTone({ frequency: 480, duration: 0.08, type: "triangle", volume: 0.15 });
}

function playMergeSound(tier) {
  // Pitch rises with tier so higher-tier merges feel more rewarding.
  const baseFreq = 240 + tier * 55;
  playTone({
    frequency: baseFreq,
    duration: 0.16,
    type: "sine",
    volume: 0.2,
    frequencyEnd: baseFreq * 1.6
  });
}

function playCoinSound() {
  // Subtle confirmation chime, deliberately delayed 700ms after the merge
  // sound it rewards. The delay is scheduled on the audio clock itself,
  // not via setTimeout, so it stays accurate during chain merges.
  playTone({
    frequency: 1300,
    duration: 0.12,
    type: "sine",
    volume: 0.1,
    delaySeconds: 0.7
  });
}

function playDestroySound() {
  playTone({
    frequency: 200,
    duration: 0.22,
    type: "sawtooth",
    volume: 0.18,
    frequencyEnd: 45
  });
}

function playGameOverSound() {
  // A short descending three-note cadence.
  playTone({ frequency: 392, duration: 0.22, type: "triangle", volume: 0.22 });
  playTone({ frequency: 330, duration: 0.22, type: "triangle", volume: 0.2, delaySeconds: 0.18 });
  playTone({ frequency: 262, duration: 0.4, type: "triangle", volume: 0.22, delaySeconds: 0.36 });
}

/* ---------------- Persistence ---------------- */

function loadPersisted() {
  try {
    const storedHigh = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10);
    const storedCoins = parseInt(localStorage.getItem(STORAGE_KEYS.coins), 10);
    state.highScore = Number.isFinite(storedHigh) ? storedHigh : 0;
    state.coins = Number.isFinite(storedCoins) ? storedCoins : 0;
  } catch (err) {
    state.highScore = 0;
    state.coins = 0;
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

// Returns the resulting tier if gemA and gemB can merge, or null if they can't.
function getMergeResultTier(gemA, gemB) {
  if (!gemA || !gemB) return null;
  if (gemA.isWild && gemB.isWild) return null;
  if (gemA.isWild) return gemB.tier < MAX_TIER ? gemB.tier + 1 : null;
  if (gemB.isWild) return gemA.tier < MAX_TIER ? gemA.tier + 1 : null;
  if (gemA.tier === gemB.tier && gemA.tier < MAX_TIER) return gemA.tier + 1;
  return null;
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

function createGemElement(gem, extraClass) {
  const el = document.createElement("div");
  const tierClass = gem.isWild ? "wild" : `tier-${gem.tier}`;
  el.className = `gem ${tierClass}${extraClass ? " " + extraClass : ""}`;
  el.textContent = gem.isWild ? "✦" : GEM_SYMBOLS[gem.tier];
  el.title = gem.isWild ? "Magic Wildcard Gem" : `${GEM_NAMES[gem.tier]} (Tier ${gem.tier})`;
  return el;
}

function renderGrid() {
  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    cell.innerHTML = "";
    const gem = state.grid[i];
    if (gem) {
      cell.appendChild(createGemElement(gem));
    }
  }
  updateDropTargets();
  updateMagicTargets();
}

// UNCHANGED: highlights empty cells as valid drop targets while a conveyor
// gem is selected. This is the original logic, untouched.
function updateDropTargets() {
  const cells = gridEl.children;
  const showTargets = state.selectedConveyorIndex !== null && !state.gameOver;
  for (let i = 0; i < cells.length; i++) {
    const isValidTarget = showTargets && state.grid[i] === null;
    cells[i].classList.toggle("drop-target", isValidTarget);
  }
}

// Highlights occupied cells as destroy targets while Magic Mode is armed.
// Kept fully separate from updateDropTargets above so that function never
// has to change.
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
  el.classList.remove("pop-anim");
  void el.offsetWidth; // force reflow so the animation can restart
  el.classList.add("pop-anim");
}

function updateScoreboard() {
  scoreValueEl.textContent = String(state.score);
  coinValueEl.textContent = String(state.coins);
  highscoreValueEl.textContent = String(state.highScore);
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

/* ---------------- Floating reward text ---------------- */

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

/* ---------------- Sparkle / smoke destroy effect ---------------- */

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
    const offsetX = Math.cos(angle) * distance;
    const offsetY = Math.sin(angle) * distance;

    particle.style.left = `${centerX}px`;
    particle.style.top = `${centerY}px`;
    particle.style.setProperty("--sparkle-x", `${offsetX}px`);
    particle.style.setProperty("--sparkle-y", `${offsetY}px`);
    particle.style.animationDelay = `${Math.random() * 0.05}s`;

    floatingLayer.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove());
  }
}

/* ---------------- Conveyor spawning ---------------- */

function spawnConveyorGem() {
  if (state.gameOver) return;
  if (state.conveyor.length >= CONVEYOR_MAX) return;
  const tier = randInt(1, 3); // Ruby, Sapphire, or Emerald only
  state.conveyor.push({ tier, isWild: false, id: nextId() });
  renderConveyor();
}

// UNCHANGED selection/toggle logic below, with one additive guard at the
// very top: selecting a conveyor gem is blocked while Magic Mode is armed,
// so the two interaction modes can never collide. When Magic Mode is not
// active, behavior is identical to before.
function selectConveyorItem(index) {
  if (state.gameOver) return;
  if (state.magicModeActive) {
    showToast("Magic Mode is active — tap a gem on the grid to destroy it");
    return;
  }
  state.selectedConveyorIndex = state.selectedConveyorIndex === index ? null : index;
  renderConveyor();
  updateDropTargets();
}

/* ---------------- Placement & merging (CORE RULES — UNCHANGED) ---------------- */

function flashShake(index) {
  const cell = gridEl.children[index];
  cell.classList.remove("shake");
  void cell.offsetWidth;
  cell.classList.add("shake");
  setTimeout(() => cell.classList.remove("shake"), 320);
}

async function handleGridCellClick(index) {
  if (state.gameOver) return;

  // Magic Mode branch. When armed, every grid tap destroys a gem instead
  // of running the original placement flow below.
  if (state.magicModeActive) {
    await handleMagicDestroy(index);
    return;
  }

  // --- Everything below this line is the original, unmodified placement logic. ---

  if (state.selectedConveyorIndex === null) {
    showToast("Pick a gem from the belt first");
    return;
  }

  if (state.grid[index] !== null) {
    flashShake(index);
    showToast("That cell's taken — pick an empty one");
    return;
  }

  const gem = state.conveyor.splice(state.selectedConveyorIndex, 1)[0];
  state.selectedConveyorIndex = null;
  state.grid[index] = gem;

  renderConveyor();
  renderGrid();
  playPlaceSound();

  const gemEl = gridEl.children[index].querySelector(".gem");
  if (gemEl) gemEl.classList.add("placed");

  await resolveMergesAt(index);
  evaluateGameOver();
  persist();
}

// Repeatedly checks the gem at `index` against its neighbors and merges
// while matches exist, allowing chain merges from a single placement.
// UNCHANGED core merge rule.
async function resolveMergesAt(index) {
  let mergedSomething = true;

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
      if (neighborGemEl) neighborGemEl.classList.add("pop-out");

      await delay(MERGE_ANIM_MS);

      state.grid[neighborIndex] = null;
      state.grid[index] = { tier: resultTier, isWild: false, id: nextId() };
      renderGrid();

      const newGemEl = gridEl.children[index].querySelector(".gem");
      if (newGemEl) newGemEl.classList.add("placed");

      awardMerge(resultTier, index);
      mergedSomething = true;
      break;
    }
  }
}

function awardMerge(resultTier, cellIndex) {
  const coinGain = 10;
  const scoreGain = resultTier * 15;

  state.score += scoreGain;
  state.coins += coinGain;

  playMergeSound(resultTier);
  playCoinSound();

  if (resultTier === MAX_TIER) {
    state.coins += 50;
    showToast("🎉 Black Opal formed! +50 bonus coins");
  }

  if (state.score > state.highScore) {
    state.highScore = state.score;
  }

  spawnFloatingReward(cellIndex, `+${coinGain}`);
  updateScoreboard();
  triggerStatPop(scoreValueEl);
  triggerStatPop(coinValueEl);
}

/* ---------------- Magic Gem destruction ---------------- */

async function handleMagicDestroy(index) {
  const gem = state.grid[index];

  if (!gem) {
    showToast("Tap a gem, not an empty cell");
    return;
  }

  // Spend the use immediately so a fast second tap can't double-spend it.
  state.magicModeActive = false;
  state.magicUsesRemaining = Math.max(0, state.magicUsesRemaining - 1);
  updateMagicModeUI();
  updateMagicTargets();

  const cellEl = gridEl.children[index];
  const gemEl = cellEl.querySelector(".gem");

  playDestroySound();
  spawnSparkleEffect(index);
  cellEl.classList.add("shake");
  if (gemEl) gemEl.classList.add("destroy-pop");

  await delay(320); // let the shake + sparkle + pop animation finish

  cellEl.classList.remove("shake");
  state.grid[index] = null;
  renderGrid();

  evaluateGameOver();
  persist();
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
  clearInterval(spawnIntervalHandle);

  playGameOverSound();

  finalScoreText.textContent = `Score: ${state.score}`;
  finalHighscoreText.textContent = `Best: ${state.highScore}`;
  gameOverOverlay.classList.remove("hidden");

  updateDropTargets();
  updateMagicTargets();
  updateMagicModeUI();
  persist();
}

function restartGame() {
  state.grid = new Array(TOTAL_CELLS).fill(null);
  state.conveyor = [];
  state.selectedConveyorIndex = null;
  state.score = 0;
  state.gameOver = false;
  state.magicUsesRemaining = MAGIC_USES_MAX;
  state.magicModeActive = false;
  magicBusy = false;

  gameOverOverlay.classList.add("hidden");

  renderGrid();
  renderConveyor();
  updateScoreboard();
  updateMagicModeUI();

  clearInterval(spawnIntervalHandle);
  spawnConveyorGem();
  spawnIntervalHandle = setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);

  persist();
}

/* ---------------- Watch Ad → Magic Mode ---------------- */

function getAdButtonLabel() {
  if (state.magicUsesRemaining <= 0) return "No Magic Gems Left";
  return `Watch Ad for Magic Gem (${state.magicUsesRemaining} Left)`;
}

function updateMagicModeUI() {
  adButton.textContent = state.magicModeActive
    ? "✦ Tap a gem to destroy it"
    : getAdButtonLabel();

  adButton.disabled =
    state.gameOver || state.magicModeActive || state.magicUsesRemaining <= 0 || magicBusy;

  adButton.classList.toggle("magic-armed", state.magicModeActive);
  gridEl.classList.toggle("magic-mode", state.magicModeActive);
}

async function handleWatchAd() {
  if (state.gameOver || magicBusy || state.magicModeActive) return;

  if (state.magicUsesRemaining <= 0) {
    showToast("No Magic Gems left this game");
    return;
  }

  magicBusy = true;
  adButton.disabled = true;

  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) {
    adButton.textContent = `▶ Ad playing... ${s}`;
    await delay(1000);
  }

  magicBusy = false;
  activateMagicMode();
}

function activateMagicMode() {
  state.magicModeActive = true;
  // Cancel any pending placement selection so the two modes never collide.
  state.selectedConveyorIndex = null;
  renderConveyor();
  updateDropTargets();
  updateMagicTargets();
  updateMagicModeUI();
  showToast("Magic Mode: tap any gem on the grid to destroy it");
}

/* ---------------- Event wiring ---------------- */

conveyorEl.addEventListener("click", (e) => {
  const gemEl = e.target.closest(".gem");
  if (!gemEl) return;
  selectConveyorItem(parseInt(gemEl.dataset.conveyorIndex, 10));
});

gridEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  handleGridCellClick(parseInt(cell.dataset.index, 10));
});

adButton.addEventListener("click", handleWatchAd);
restartButton.addEventListener("click", restartGame);
restartHeaderBtn.addEventListener("click", restartGame);

/* ---------------- Init ---------------- */

function init() {
  // Defensive check: if index.html ids don't match these lookups, fail
  // loudly in the console instead of silently doing nothing.
  const requiredElements = {
    gridEl, conveyorEl, floatingLayer, scoreValueEl, coinValueEl,
    highscoreValueEl, adButton, toastContainer, gameOverOverlay,
    finalScoreText, finalHighscoreText, restartButton, restartHeaderBtn
  };
  const missing = Object.entries(requiredElements)
    .filter(([, el]) => !el)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(
      "Gem Merge Rush: could not start — missing DOM elements:",
      missing.join(", "),
      ". Check that index.html ids match the ids used in script.js."
    );
    return;
  }

  loadPersisted();
  buildGridDOM();
  renderGrid();
  renderConveyor();
  updateScoreboard();
  updateMagicModeUI();

  spawnConveyorGem();
  spawnIntervalHandle = setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);
}

// Runs init() safely whether the DOM is already parsed (e.g. this script
// was loaded with the `defer` attribute, so document.readyState is already
// past "loading") or not yet parsed (script loaded some other way).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
