/* Gem Merge Rush — Final Stable Script */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;

  if (type === 'place') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(300, now);
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
  } else if (type === 'merge') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
  } else if (type === 'coin') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(1600, now + 0.1);
    gain.gain.setValueAtTime(0.03, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  } else if (type === 'destroy') {
    osc.type = 'square'; osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
  } else if (type === 'gameover') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.8);
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
  }
  osc.start(now); osc.stop(now + (type === 'gameover' ? 0.8 : 0.4));
}

const GRID_SIZE = 4;
const TOTAL_CELLS = 16;
const CONVEYOR_MAX = 5;
const SPAWN_INTERVAL_MS = 3000;
const MAX_TIER = 7;
const AD_COUNTDOWN_SECONDS = 3;
const MAX_MAGIC_USES = 5;
const STORAGE_KEYS = { highScore: "gmr_high_score", coins: "gmr_coins" };
const GEM_SYMBOLS = { 1: "R", 2: "S", 3: "E", 4: "A", 5: "D", 6: "T", 7: "O" };

const state = { grid: new Array(TOTAL_CELLS).fill(null), conveyor: [], selectedConveyorIndex: null, score: 0, coins: 0, highScore: 0, gameOver: false, magicUsesLeft: MAX_MAGIC_USES, isMagicMode: false };

let idCounter = 1, spawnIntervalHandle = null, adBusy = false;

const gridEl = document.getElementById("grid"), conveyorEl = document.getElementById("conveyor"), scoreValueEl = document.getElementById("score-value"), coinValueEl = document.getElementById("coin-value"), highscoreValueEl = document.getElementById("highscore-value"), adButton = document.getElementById("ad-button"), gameOverOverlay = document.getElementById("game-over-overlay"), finalScoreText = document.getElementById("final-score-text"), finalHighscoreText = document.getElementById("final-highscore-text");

function nextId() { return idCounter++; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function loadPersisted() {
  state.highScore = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10) || 0;
  state.coins = parseInt(localStorage.getItem(STORAGE_KEYS.coins), 10) || 0;
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.highScore, state.highScore);
  localStorage.setItem(STORAGE_KEYS.coins, state.coins);
}

function animateStat(element) {
  element.classList.remove("pop-anim");
  void element.offsetWidth; element.classList.add("pop-anim");
}

function updateScoreboard() {
  if (scoreValueEl.textContent !== String(state.score)) { scoreValueEl.textContent = state.score; animateStat(scoreValueEl); }
  if (coinValueEl.textContent !== String(state.coins)) { coinValueEl.textContent = state.coins; animateStat(coinValueEl); }
  if (state.score > state.highScore) { state.highScore = state.score; persist(); }
  highscoreValueEl.textContent = state.highScore;
}

function getNeighborIndices(index) {
  const row = Math.floor(index / GRID_SIZE), col = index % GRID_SIZE, neighbors = [];
  if (row > 0) neighbors.push(index - GRID_SIZE);
  if (col < GRID_SIZE - 1) neighbors.push(index + 1);
  if (row < GRID_SIZE - 1) neighbors.push(index + GRID_SIZE);
  if (col > 0) neighbors.push(index - 1);
  return neighbors;
}

function getMergeResultTier(gemA, gemB) {
  if (!gemA || !gemB || gemA.tier !== gemB.tier || gemA.tier >= MAX_TIER) return null;
  return gemA.tier + 1;
}

function createGemElement(gem) {
  const el = document.createElement("div");
  el.className = `gem tier-${gem.tier}`;
  el.textContent = GEM_SYMBOLS[gem.tier] || "?";
  return el;
}

function renderGrid() {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    gridEl.children[i].innerHTML = "";
    if (state.grid[i]) gridEl.children[i].appendChild(createGemElement(state.grid[i]));
  }
  const showDrop = state.selectedConveyorIndex !== null && !state.gameOver && !state.isMagicMode;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (state.isMagicMode && state.grid[i] !== null) gridEl.children[i].classList.add("drop-target");
    else gridEl.children[i].classList.toggle("drop-target", showDrop && state.grid[i] === null);
  }
}

function renderConveyor() {
  conveyorEl.innerHTML = "";
  for (let i = 0; i < CONVEYOR_MAX; i++) {
    const slot = document.createElement("div"); slot.className = "conveyor-slot";
    if (state.conveyor[i]) {
      slot.classList.add("filled");
      const gemEl = createGemElement(state.conveyor[i]);
      gemEl.dataset.conveyorIndex = i;
      if (state.selectedConveyorIndex === i) gemEl.classList.add("selected");
      slot.appendChild(gemEl);
    }
    conveyorEl.appendChild(slot);
  }
}

async function resolveMergesAt(index) {
  let merged = true;
  while (merged) {
    merged = false;
    const current = state.grid[index];
    if (!current) break;
    const neighbors = getNeighborIndices(index);
    for (const nIdx of neighbors) {
      const neighbor = state.grid[nIdx];
      const nextTier = getMergeResultTier(current, neighbor);
      if (nextTier) {
        state.grid[nIdx] = null; state.grid[index] = { tier: nextTier, id: nextId() };
        playSound('merge'); state.score += (nextTier * 15); state.coins += 10;
        renderGrid(); updateScoreboard(); persist();
        setTimeout(() => playSound('coin'), 700);
        await delay(300); merged = true; break;
      }
    }
  }
  evaluateGameOver();
}

function handleGridCellClick(index) {
  if (state.gameOver) return;
  if (state.isMagicMode) {
    if (state.grid[index]) {
      state.grid[index] = null; state.isMagicMode = false; playSound('destroy');
      renderGrid(); adButton.textContent = `▶ Magic Remover (${--state.magicUsesLeft} Left) 💎`;
      evaluateGameOver();
    }
    return;
  }
  if (state.selectedConveyorIndex === null || state.grid[index]) return;
  state.grid[index] = state.conveyor.splice(state.selectedConveyorIndex, 1)[0];
  state.selectedConveyorIndex = null; playSound('place');
  renderConveyor(); renderGrid(); resolveMergesAt(index);
}

function evaluateGameOver() {
  const isFull = state.grid.every(c => c !== null);
  if (!isFull) return;
  let canMerge = false;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    const neighbors = getNeighborIndices(i);
    for (const nIdx of neighbors) if (getMergeResultTier(state.grid[i], state.grid[nIdx])) canMerge = true;
  }
  if (!canMerge && state.magicUsesLeft === 0) triggerGameOver();
}

function triggerGameOver() {
  state.gameOver = true; clearInterval(spawnIntervalHandle); playSound('gameover');
  finalScoreText.textContent = `Score: ${state.score}`; finalHighscoreText.textContent = `Best: ${state.highScore}`;
  gameOverOverlay.classList.remove("hidden");
}

async function handleWatchAd() {
  if (state.gameOver || adBusy || state.magicUsesLeft <= 0 || state.isMagicMode) return;
  adBusy = true; const original = adButton.textContent;
  for (let s = AD_COUNTDOWN_SECONDS; s > 0; s--) { adButton.textContent = `▶ Ad playing... ${s}`; await delay(1000); }
  state.isMagicMode = true; adButton.textContent = "Tap a gem to destroy!"; renderGrid(); adBusy = false;
}

// Initial setup
loadPersisted(); updateScoreboard(); buildGridDOM();
conveyorEl.addEventListener("click", (e) => { if (state.isMagicMode) return; const el = e.target.closest(".gem"); if (el) { state.selectedConveyorIndex = parseInt(el.dataset.conveyorIndex, 10); renderConveyor(); renderGrid(); } });
gridEl.addEventListener("click", (e) => { const cell = e.target.closest(".cell"); if (cell) handleGridCellClick(parseInt(cell.dataset.index, 10)); });
adButton.addEventListener("click", handleWatchAd);
document.getElementById("restart-button").addEventListener("click", () => location.reload());
document.getElementById("restart-header-btn").addEventListener("click", () => location.reload());
renderGrid();
spawnIntervalHandle = setInterval(() => { if (!state.gameOver && state.conveyor.length < CONVEYOR_MAX) { state.conveyor.push({ tier: randInt(1, 3), id: nextId() }); renderConveyor(); } }, SPAWN_INTERVAL_MS);
    
