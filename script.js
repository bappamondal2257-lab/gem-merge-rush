/* Gem Merge Rush — Complete script.js with Sounds, Animations & Original Logic */

// 1. Audio System Setup (Web Audio API)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  // ব্রাউজার অডিও পলিসি ব্লক করলে তা ঠিক করার জন্য
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'place') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'merge') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'coin') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.setValueAtTime(900, now + 0.1);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'gameover') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.8);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    osc.start(now);
    osc.stop(now + 0.8);
  }
}

// 2. Constants & Variables
const GRID_SIZE = 4;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 3000;
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const STORAGE_KEYS = { highScore: "gmr_high_score", coins: "gmr_coins" };

const GEM_SYMBOLS = { 1: "R", 2: "S", 3: "E", 4: "A", 5: "D", 6: "T", 7: "O" }; 

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
let adBusy = false;

// 3. DOM Elements Setup
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

// 4. Helper & Animation Functions
function nextId() { return idCounter++; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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

// Stats Animation function
function animateStat(element) {
  element.classList.remove("pop-anim");
  void element.offsetWidth; // trigger DOM reflow
  element.classList.add("pop-anim");
}

function updateScoreboard() {
  if (scoreValueEl.textContent !== String(state.score)) {
    scoreValueEl.textContent = String(state.score);
    animateStat(scoreValueEl);
  }
  if (coinValueEl.textContent !== String(state.coins)) {
    coinValueEl.textContent = String(state.coins);
    animateStat(coinValueEl);
  }
  if (state.score > state.highScore) {
    state.highScore = state.score;
    persist();
  }
  highscoreValueEl.textContent = String(state.highScore);
}

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

function spawnFloatingReward(cellIndex, text) {
  const cellEl = gridEl.children[cellIndex];
  if (!cellEl) return;
  const rect = cellEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "floating-reward";
  el.textContent = text;
  
  const wrapperRect = document.getElementById("app").getBoundingClientRect();
  el.style.left = `${rect.left - wrapperRect.left + rect.width / 2}px`;
  el.style.top = `${rect.top - wrapperRect.top + rect.height / 2}px`;
  
  floatingLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// 5. Grid and Conveyor Logic
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

function createGemElement(gem) {
  const el = document.createElement("div");
  const tierClass = gem.isWild ? "wild" : `tier-${gem.tier}`;
  el.className = `gem ${tierClass}`;
  el.textContent = gem.isWild ? "✦" : (GEM_SYMBOLS[gem.tier] || "?");
  return el;
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

function renderGrid() {
  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    cells[i].innerHTML = "";
    if (state.grid[i]) {
      cells[i].appendChild(createGemElement(state.grid[i]));
    }
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
      if (state.selectedConveyorIndex === i) {
        gemEl.classList.add("selected");
      }
      slot.appendChild(gemEl);
    }
    conveyorEl.appendChild(slot);
  }
}

function spawnConveyorGem() {
  if (state.gameOver || state.conveyor.length >= CONVEYOR_MAX) return;
  state.conveyor.push({ tier: randInt(1, 3), isWild: false, id: nextId() });
  renderConveyor();
}

// 6. Merging and Interaction Logic
async function resolveMergesAt(index) {
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    const current = state.grid[index];
    if (!current) break;
    
    const neighbors = getNeighborIndices(index);
    for (const neighborIndex of neighbors) {
      const neighbor = state.grid[neighborIndex];
      const resultTier = getMergeResultTier(current, neighbor);
      
      if (resultTier !== null) {
        state.grid[neighborIndex] = null;
        state.grid[index] = { tier: resultTier, isWild: false, id: nextId() };
        
        playSound('merge');
        spawnFloatingReward(index, '+10');
        
        state.score += (resultTier * 15);
        state.coins += 10;
        
        renderGrid();
        updateScoreboard();
        persist();
        
        await delay(300);
        mergedSomething = true;
        break; 
      }
    }
  }
  evaluateGameOver();
}

function handleGridCellClick(index) {
  if (state.gameOver || state.selectedConveyorIndex === null) return;
  if (state.grid[index] !== null) return;
  
  const gem = state.conveyor.splice(state.selectedConveyorIndex, 1)[0];
  state.selectedConveyorIndex = null;
  state.grid[index] = gem;
  
  playSound('place');
  renderConveyor();
  renderGrid();
  
  resolveMergesAt(index);
}

// 7. Perfect Game Over Logic
function evaluateGameOver() {
  const isFull = state.grid.every(cell => cell !== null);
  if (!isFull) return;

  let possibleMerge = false;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    const current = state.grid[i];
    const neighbors = getNeighborIndices(i);
    for (const neighborIndex of neighbors) {
      const neighbor = state.grid[neighborIndex];
      if (getMergeResultTier(current, neighbor) !== null) {
        possibleMerge = true;
        break;
      }
    }
    if (possibleMerge) break;
  }

  if (!possibleMerge) {
    triggerGameOver();
  }
}

function triggerGameOver() {
  state.gameOver = true;
  clearInterval(spawnIntervalHandle);
  playSound('gameover');
  
  finalScoreText.textContent = `Score: ${state.score}`;
  finalHighscoreText.textContent = `Best: ${state.highScore}`;
  gameOverOverlay.classList.remove("hidden");
}

// 8. Ads and Magic Gem Logic
async function handleWatchAd() {
  if (state.gameOver || adBusy) return;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  adBusy = true;
  adButton.disabled = true;
  const originalText = adButton.textContent;
  
  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) {
    adButton.textContent = `▶ Ad playing... ${s}`;
    await delay(1000);
  }
  
  const emptyIndices = [];
  for(let i=0; i<TOTAL_CELLS; i++){
    if(state.grid[i] === null) emptyIndices.push(i);
  }
  
  if (emptyIndices.length > 0) {
    const targetIndex = emptyIndices[randInt(0, emptyIndices.length - 1)];
    state.grid[targetIndex] = { tier: null, isWild: true, id: nextId() };
    playSound('coin');
    renderGrid();
    evaluateGameOver();
  } else {
    showToast("Grid is full! Cannot place magic gem.");
  }
  
  adButton.textContent = originalText;
  adButton.disabled = false;
  adBusy = false;
}

// 9. Initialization System
function init() {
  loadPersisted();
  updateScoreboard();
  buildGridDOM();
  
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

  renderGrid();
  spawnConveyorGem();
  spawnIntervalHandle = setInterval(spawnConveyorGem, SPAWN_INTERVAL_MS);
}

init();
