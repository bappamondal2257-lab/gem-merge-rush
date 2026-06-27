/* ============================================================
   Gem Merge Rush — script.js
   Vanilla JS, no dependencies. Fully self-contained game logic.
   ============================================================ */

/* ---------------- Constants ---------------- */

const GRID_SIZE = 4;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 3000;
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const AD_COOLDOWN_SECONDS = 20;
const MERGE_ANIM_MS = 260;
const AD_BUTTON_DEFAULT_TEXT = "▶ Watch Ad for Magic Gem 💎";

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
  gameOver: false
};

let idCounter = 1;
let spawnIntervalHandle = null;
let adCooldownIntervalHandle = null;
let adBusy = false;

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

/* ---------------- Persistence ---------------- */

function loadPersisted() {
  try {
    const storedHigh = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10);
    const storedCoins = parseInt(localStorage.getItem(STORAGE_KEYS.coins), 10);
    state.highScore = Number.isFinite(storedHigh) ? storedHigh : 0;
    state.coins = Number.isFinite(storedCoins) ? storedCoins : 0;
  } catch (err) {
    // localStorage unavailable (private mode, etc.) — fall back to defaults.
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

/* ---------------- Grid / merge math ---------------- */

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
  if (gemA.isWild && gemB.isWild) return null; // two wildcards don't merge with each other
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
}

function updateDropTargets() {
  const cells = gridEl.children;
  const showTargets = state.selectedConveyorIndex !== null && !state.gameOver;
  for (let i = 0; i < cells.length; i++) {
    const isValidTarget = showTargets && state.grid[i] === null;
    cells[i].classList.toggle("drop-target", isValidTarget);
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

/* ---------------- Conveyor spawning ---------------- */

function spawnConveyorGem() {
  if (state.gameOver) return;
  if (state.conveyor.length >= CONVEYOR_MAX) return;
  const tier = randInt(1, 3); // Ruby, Sapphire, or Emerald only
  state.conveyor.push({ tier, isWild: false, id: nextId() });
  renderConveyor();
}

function selectConveyorItem(index) {
  if (state.gameOver) return;
  state.selectedConveyorIndex = state.selectedConveyorIndex === index ? null : index;
  renderConveyor();
  updateDropTargets();
}

/* ---------------- Placement & merging ---------------- */

function flashShake(index) {
  const cell = gridEl.children[index];
  cell.classList.remove("shake");
  void cell.offsetWidth; // force reflow so the animation can restart
  cell.classList.add("shake");
  setTimeout(() => cell.classList.remove("shake"), 320);
}

async function handleGridCellClick(index) {
  if (state.gameOver) return;

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

  const gemEl = gridEl.children[index].querySelector(".gem");
  if (gemEl) gemEl.classList.add("placed");

  await resolveMergesAt(index);
  evaluateGameOver();
  persist();
}

// Repeatedly checks the gem at `index` against its neighbors and merges
// while matches exist, allowing chain merges from a single placement.
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

  if (resultTier === MAX_TIER) {
    state.coins += 50;
    showToast("🎉 Black Opal formed! +50 bonus coins");
  }

  if (state.score > state.highScore) {
    state.highScore = state.score;
  }

  spawnFloatingReward(cellIndex, `+${coinGain}`);
  updateScoreboard();
}

/* ---------------- Game over ---------------- */

function evaluateGameOver() {
  if (state.grid.includes(null)) return; // board still has space

  const hasMove = state.grid.some((gem, i) =>
    getNeighborIndices(i).some((n) => getMergeResultTier(gem, state.grid[n]) !== null)
  );

  if (!hasMove) triggerGameOver();
}

function triggerGameOver() {
  state.gameOver = true;
  clearInterval(spawnIntervalHandle);
  adButton.disabled = true;

  finalScoreText.textContent = `Score: ${state.score}`;
  finalHighscoreText.textContent = `Best: ${state.highScore}`;
  gameOverOverlay.classList.remove("hidden");

  updateDropTargets();
  persist();
}

function restartGame() {
  state.grid = new Array(TOTAL_CELLS).fill(null);
  state.conveyor = [];
  state.selectedConveyorIndex = null;
  state.score = 0;
  state.gameOver = false;

  gameOverOverlay.classList.add("hidden");

  if (adCooldownIntervalHandle) {
    clearInterval(adCooldownIntervalHandle);
    adCooldownIntervalHandle = null;
  }
  adBusy = false;
  adButton.disabled = false;
  adButton.textContent = AD_BUTTON_DEFAULT_TEXT;

  renderGrid();
  renderConveyor();
  updateScoreboard();

  clearInterval(spawnIntervalHandle);
  spawnConveyorGem();
  spawnIntervalHandle = setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);

  persist();
}

/* ---------------- Watch Ad → Magic Gem ---------------- */

async function handleWatchAd() {
  if (state.gameOver || adBusy) return;
  adBusy = true;
  adButton.disabled = true;

  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) {
    adButton.textContent = `▶ Ad playing... ${s}`;
    await delay(1000);
  }

  adButton.textContent = "✨ Spawning Magic Gem...";
  await delay(400);

  await spawnWildcardOnGrid();
  await startAdCooldown();
}

function spawnWildcardOnGrid() {
  const emptyIndices = [];
  state.grid.forEach((gem, i) => {
    if (gem === null) emptyIndices.push(i);
  });

  if (emptyIndices.length === 0) {
    showToast("Grid is full — no room for the Magic Gem!");
    return Promise.resolve();
  }

  const targetIndex = emptyIndices[randInt(0, emptyIndices.length - 1)];
  state.grid[targetIndex] = { tier: null, isWild: true, id: nextId() };
  renderGrid();

  const gemEl = gridEl.children[targetIndex].querySelector(".gem");
  if (gemEl) gemEl.classList.add("placed");
  showToast("✨ Magic Wildcard Gem placed!");

  return resolveMergesAt(targetIndex).then(() => {
    evaluateGameOver();
    persist();
  });
}

function startAdCooldown() {
  return new Promise((resolve) => {
    let remaining = AD_COOLDOWN_SECONDS;
    adButton.textContent = `⏳ Magic Gem ready in ${remaining}s`;

    adCooldownIntervalHandle = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(adCooldownIntervalHandle);
        adCooldownIntervalHandle = null;
        adBusy = false;
        adButton.disabled = state.gameOver;
        adButton.textContent = AD_BUTTON_DEFAULT_TEXT;
        resolve();
      } else {
        adButton.textContent = `⏳ Magic Gem ready in ${remaining}s`;
      }
    }, 1000);
  });
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
  loadPersisted();
  buildGridDOM();
  renderGrid();
  renderConveyor();
  updateScoreboard();

  spawnConveyorGem();
  spawnIntervalHandle = setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);
}

init();
