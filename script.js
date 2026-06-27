/* Gem Merge Rush — script.js */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'place') {
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
  } else if (type === 'merge') {
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
  } else if (type === 'coin') {
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
  }

  osc.start();
  osc.stop(audioCtx.currentTime + 0.3);
}

/* --- Rest of the existing game logic starts here --- */

const GRID_SIZE = 4;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 3000;
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const AD_COOLDOWN_SECONDS = 20;
const MERGE_ANIM_MS = 260;
const AD_BUTTON_DEFAULT_TEXT = "▶ Watch Ad for Magic Gem 💎";

const GEM_NAMES = { 1: "Ruby", 2: "Sapphire", 3: "Emerald", 4: "Amethyst", 5: "Diamond", 6: "Topaz", 7: "Black Opal" };
const GEM_SYMBOLS = { 1: "R", 2: "S", 3: "E", 4: "A", 5: "D", 6: "T", 7: "O" };
const STORAGE_KEYS = { highScore: "gmr_high_score", coins: "gmr_coins" };

const state = { grid: new Array(TOTAL_CELLS).fill(null), conveyor: [], selectedConveyorIndex: null, score: 0, coins: 0, highScore: 0, gameOver: false };

let idCounter = 1;
let spawnIntervalHandle = null;
let adCooldownIntervalHandle = null;
let adBusy = false;

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

function nextId() { return idCounter++; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function loadPersisted() {
  const storedHigh = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10);
  const storedCoins = parseInt(localStorage.getItem(STORAGE_KEYS.coins), 10);
  state.highScore = Number.isFinite(storedHigh) ? storedHigh : 0;
  state.coins = Number.isFinite(storedCoins) ? storedCoins : 0;
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.highScore, String(state.highScore));
  localStorage.setItem(STORAGE_KEYS.coins, String(state.coins));
}

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
  return el;
}

function renderGrid() {
  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    cells[i].innerHTML = "";
    if (state.grid[i]) cells[i].appendChild(createGemElement(state.grid[i]));
  }
  updateDropTargets();
}

function updateDropTargets() {
  const cells = gridEl.children;
  const showTargets = state.selectedConveyorIndex !== null && !state.gameOver;
  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.toggle("drop-target", showTargets && state.grid[i] === null);
  }
}

function renderConveyor() {
  conveyorEl.innerHTML = "";
  for (let i = 0; i < CONVEYOR_MAX; i++) {
    const slot = document.createElement("div");
    slot.className = "conveyor-slot";
    if (state.conveyor[i]) {
      slot.classList.add("filled");
      const gemEl = createGemElement(state.conveyor[i]);
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

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.classList.add("toast-fade"); setTimeout(() => toast.remove(), 400); }, 1700);
}

function spawnFloatingReward(cellIndex, text) {
  const cellEl = gridEl.children[cellIndex];
  const rect = cellEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "floating-reward";
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  floatingLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function spawnConveyorGem() {
  if (state.gameOver || state.conveyor.length >= CONVEYOR_MAX) return;
  state.conveyor.push({ tier: randInt(1, 3), isWild: false, id: nextId() });
  renderConveyor();
}

function handleGridCellClick(index) {
  if (state.gameOver || state.selectedConveyorIndex === null) return;
  if (state.grid[index] !== null) return;
  
  const gem = state.conveyor.splice(state.selectedConveyorIndex, 1)[0];
  state.selectedConveyorIndex = null;
  state.grid[index] = gem;
  playSound('place'); // Sound trigger
  renderConveyor();
  renderGrid();
  resolveMergesAt(index);
}

async function resolveMergesAt(index) {
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    const current = state.grid[index];
    if (!current) break;
    const neighbors = getNeighborIndices(index);
    for (const neighborIndex of neighbors) {
      const resultTier = getMergeResultTier(current, state.grid[neighborIndex]);
      if (resultTier !== null) {
        state.grid[neighborIndex] = null;
        state.grid[index] = { tier: resultTier, isWild: false, id: nextId() };
        playSound('merge'); // Sound trigger
        spawnFloatingReward(index, '+10');
        state.score += (resultTier * 15);
        state.coins += 10;
        renderGrid();
        updateScoreboard();
        mergedSomething = true;
        break;
      }
    }
  }
}

async function handleWatchAd() {
  if (state.gameOver || adBusy) return;
  adBusy = true;
  adButton.disabled = true;
  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) {
    adButton.textContent = `▶ Ad playing... ${s}`;
    await delay(1000);
  }
  const empty = state.grid.map((g, i) => g === null ? i : -1).filter(i => i !== -1);
  if (empty.length > 0) {
    state.grid[empty[randInt(0, empty.length - 1)]] = { tier: null, isWild: true, id: nextId() };
    playSound('coin'); // Sound trigger
    renderGrid();
  }
  adButton.disabled = false;
  adButton.textContent = AD_BUTTON_DEFAULT_TEXT;
  adBusy = false;
}

conveyorEl.addEventListener("click", (e) => {
  const gemEl = e.target.closest(".gem");
  if (gemEl) {
    state.selectedConveyorIndex = parseInt(gemEl.dataset.conveyorIndex, 10);
    renderConveyor();
    updateDropTargets();
  }
});

gridEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (cell) handleGridCellClick(parseInt(cell.dataset.index, 10));
});

adButton.addEventListener("click", handleWatchAd);
restartButton.addEventListener("click", () => location.reload());
restartHeaderBtn.addEventListener("click", () => location.reload());

buildGridDOM();
renderGrid();
spawnConveyorGem();
setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);
       
