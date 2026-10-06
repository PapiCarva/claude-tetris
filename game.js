'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - nut (gris metálico)
];

const COLORS_LIGHT = [
  null,
  '#00acc1', // I
  '#f9a825', // O
  '#8e24aa', // T
  '#43a047', // S
  '#e53935', // Z
  '#1e88e5', // J
  '#fb8c00', // L
  '#607d8b', // N
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const QUEUE_SIZE = 5;
const ENERGY_MAX = 100;
const ENERGY_PER_LINE = 25;
const PEEK_MS = 30000;
const SLOW_MS = 10000;
const SLOW_FACTOR = 2.5;
const ABILITIES = ['peek', 'swap', 'slow', 'undo', 'hold'];
const PIECE_LETTERS = [null, 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'N'];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const energyFill = document.getElementById('energy-fill');
const abilityStatusEl = document.getElementById('ability-status');
const abilityMenu = document.getElementById('ability-menu');
const abilityList = document.getElementById('ability-list');
const swapList = document.getElementById('swap-list');
const menuTitle = document.getElementById('menu-title');
const menuHint = document.getElementById('menu-hint');
const pauseMenu = document.getElementById('pause-menu');
const pauseMain = document.getElementById('pause-main');
const pauseControlsView = document.getElementById('pause-controls-view');
const pauseTitle = document.getElementById('pause-title');
const startLevelSelect = document.getElementById('start-level-select');
const skinSelect = document.getElementById('skin-select');
const undoBtn = abilityList.querySelector('[data-ability="undo"]');

// ---- Records (pantalla de inicio / game over) ----
const RECORDS_KEY = 'tetrisRecords';
const MAX_TOP = 5;
const startScreen = document.getElementById('start-screen');
const startTable = document.getElementById('start-table');
const startStats = document.getElementById('start-stats');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const recordsBox = document.getElementById('records-box');
const recordBadge = document.getElementById('record-badge');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const recordMsg = document.getElementById('record-msg');
const overlayTable = document.getElementById('overlay-table');
const overlayStats = document.getElementById('overlay-stats');

let comboStreak = 0;   // piezas consecutivas que limpian líneas
let maxCombo = 0;      // máximo de la partida actual
let pendingRecord = null; // récord de la partida terminada aún sin guardar

const MAX_START_LEVEL = 10;
let startLevel = loadStartLevel(); // nivel con el que empieza la próxima partida
let gameStartLevel = 1;            // nivel con el que empezó la partida actual
let resumeGuard = false;           // ignora teclas tras reanudar hasta keyup o ~150ms
let resumeTimer = null;

let theme = 'dark';
let gridColor = '#22222e';

let board, current, queue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let energy, gameTime, peekUntil, slowUntil, peekShown, held, holdCharges, holdUsedThisPiece, undoSnapshot, menuOpen, swapMode;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function createPiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return createPiece(Math.floor(Math.random() * (PIECES.length - 1)) + 1);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (!cleared) comboStreak = 0;
  if (cleared) {
    comboStreak++;
    if (comboStreak > maxCombo) maxCombo = comboStreak;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(gameStartLevel, Math.floor(lines / 10) + 1);
    dropInterval = baseInterval();
    energy = Math.min(ENERGY_MAX, energy + cleared * ENERGY_PER_LINE);
    updateHUD();
  }
}

function baseInterval() {
  return Math.max(100, 1000 - (level - 1) * 90);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  undoSnapshot = {
    board: board.map(row => [...row]),
    type: current.type,
    queue: [...queue],
    score, lines, level, comboStreak, maxCombo,
  };
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = queue.shift();
  queue.push(randomPiece());
  holdUsedThisPiece = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  energyFill.style.width = `${energy}%`;
  energyFill.classList.toggle('full', energy >= ENERGY_MAX);
  updateStatus();
}

function updateStatus() {
  const parts = [];
  if (energy >= ENERGY_MAX) parts.push('E: habilidad lista');
  if (gameTime < peekUntil) parts.push(`Ver 5: ${Math.ceil((peekUntil - gameTime) / 1000)}s`);
  if (gameTime < slowUntil) parts.push(`Lento: ${Math.ceil((slowUntil - gameTime) / 1000)}s`);
  if (holdCharges > 0 && held === null) parts.push('Hold listo (C)');
  const text = parts.join(' · ');
  if (abilityStatusEl.textContent !== text) abilityStatusEl.textContent = text;
}

// ---- Habilidades ----

function openAbilityMenu() {
  if (paused || gameOver || menuOpen || energy < ENERGY_MAX) return;
  menuOpen = true;
  cancelAnimationFrame(animId);
  undoBtn.disabled = !undoSnapshot;
  showAbilityList();
  abilityMenu.classList.remove('hidden');
}

function showAbilityList() {
  swapMode = false;
  menuTitle.textContent = 'HABILIDAD';
  menuHint.textContent = 'Esc para cancelar';
  abilityList.classList.remove('hidden');
  swapList.classList.add('hidden');
}

function closeAbilityMenu() {
  menuOpen = false;
  swapMode = false;
  abilityMenu.classList.add('hidden');
  lastTime = performance.now();
  if (!paused && !gameOver) animId = requestAnimationFrame(loop);
}

function finishAbility() {
  energy = 0;
  closeAbilityMenu();
  updateHUD();
  draw();
  drawNext();
  drawHold();
}

function chooseAbility(id) {
  switch (id) {
    case 'peek':
      peekUntil = gameTime + PEEK_MS;
      break;
    case 'swap':
      swapMode = true;
      menuTitle.textContent = 'ELIGE PIEZA';
      menuHint.textContent = 'Esc para volver';
      abilityList.classList.add('hidden');
      swapList.classList.remove('hidden');
      return;
    case 'slow':
      slowUntil = gameTime + SLOW_MS;
      break;
    case 'undo':
      if (!undoSnapshot) return;
      restoreSnapshot();
      break;
    case 'hold':
      holdCharges = 1;
      break;
    default:
      return;
  }
  finishAbility();
}

function applySwap(type) {
  const piece = createPiece(type);
  if (collide(piece.shape, piece.x, piece.y)) {
    // no cabe en la posición de spawn: intentar en la posición actual
    piece.x = Math.min(current.x, COLS - piece.shape[0].length);
    piece.y = current.y;
    if (collide(piece.shape, piece.x, piece.y)) {
      menuHint.textContent = 'No cabe esa pieza';
      return;
    }
  }
  current = piece;
  finishAbility();
}

function restoreSnapshot() {
  board = undoSnapshot.board;
  score = undoSnapshot.score;
  lines = undoSnapshot.lines;
  level = undoSnapshot.level;
  comboStreak = undoSnapshot.comboStreak;
  maxCombo = undoSnapshot.maxCombo;
  queue = undoSnapshot.queue;
  dropInterval = baseInterval();
  dropAccum = 0;
  current = createPiece(undoSnapshot.type);
  holdUsedThisPiece = false;
  undoSnapshot = null;
}

function holdPiece() {
  if (holdCharges <= 0 && held === null) return;
  if (holdUsedThisPiece) return;
  if (held === null) {
    held = current.type;
    holdCharges--;
    spawn();
    holdUsedThisPiece = true;
  } else {
    current = createPiece(held);
    held = null;
    holdUsedThisPiece = true;
    if (collide(current.shape, current.x, current.y)) endGame();
  }
  drawHold();
  updateHUD();
}

function handleMenuKey(e) {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (swapMode) showAbilityList();
    else closeAbilityMenu();
    return;
  }
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (!m) return;
  const n = Number(m[1]);
  if (swapMode) {
    if (n >= 1 && n < PIECES.length) applySwap(n);
  } else if (n >= 1 && n <= ABILITIES.length) {
    if (ABILITIES[n - 1] === 'undo' && !undoSnapshot) return;
    chooseAbility(ABILITIES[n - 1]);
  }
}

// ---- Skins ----

// camino de rectángulo redondeado (roundRect con fallback manual)
function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// hash determinista (sin random por frame) para la textura pixel art
function pixelNoise(type, i, j) {
  const h = Math.imul(type * 73856093 ^ i * 19349663 ^ j * 83492791, 2654435761);
  return ((h >>> 0) % 100) / 100;
}

const SKINS = {
  retro: {
    colors: COLORS,
    colorsLight: COLORS_LIGHT,
    drawBlock(context, px, py, color, size) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(px + 1, py + 1, size - 2, 4);
    },
  },
  neon: {
    // mismos colores en ambos temas: el canvas siempre es oscuro
    colors: [null, '#00e5ff', '#ffee00', '#d500f9', '#00ff6a', '#ff1744', '#2979ff', '#ff9100', '#c0d0ff'],
    colorsLight: [null, '#00e5ff', '#ffee00', '#d500f9', '#00ff6a', '#ff1744', '#2979ff', '#ff9100', '#c0d0ff'],
    drawBlock(context, px, py, color, size) {
      context.shadowColor = color;
      context.shadowBlur = Math.max(4, size * 0.4);
      context.fillStyle = color;
      context.fillRect(px + 2, py + 2, size - 4, size - 4);
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      // núcleo más claro
      context.fillStyle = 'rgba(255,255,255,0.25)';
      context.fillRect(px + 4, py + 4, size - 8, size - 8);
    },
  },
  pastel: {
    colors: [null, '#a8e6ef', '#fff1b8', '#e1bee7', '#c8e6c9', '#f8bbd0', '#bbdefb', '#ffe0b2', '#d7dde0'],
    colorsLight: [null, '#7fd3e0', '#f5d97a', '#c99ad6', '#9fd3a3', '#ee98b3', '#90bff0', '#f5c27a', '#b4bec4'],
    drawBlock(context, px, py, color, size) {
      const r = Math.max(2, size * 0.28);
      context.fillStyle = color;
      roundRectPath(context, px + 1, py + 1, size - 2, size - 2, r);
      context.fill();
      // brillo suave
      context.fillStyle = 'rgba(255,255,255,0.35)';
      roundRectPath(context, px + size * 0.2, py + size * 0.15, size * 0.45, size * 0.18, size * 0.09);
      context.fill();
    },
  },
  pixel: {
    colors: [null, '#29b6f6', '#fdd835', '#ab47bc', '#66bb6a', '#ef5350', '#5c6bc0', '#ffa726', '#90a4ae'],
    colorsLight: [null, '#0288d1', '#f9a825', '#8e24aa', '#388e3c', '#d32f2f', '#3949ab', '#ef6c00', '#607d8b'],
    drawBlock(context, px, py, color, size, type) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      // sub-cuadros claros/oscuros deterministas por tipo y posición
      const cell = Math.max(3, Math.round(size / 6));
      const inner = size - 2;
      const n = Math.ceil(inner / cell);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = pixelNoise(type, i, j);
          if (v < 0.25) context.fillStyle = 'rgba(255,255,255,0.22)';
          else if (v > 0.7) context.fillStyle = 'rgba(0,0,0,0.2)';
          else continue;
          const w = Math.min(cell, inner - i * cell);
          const h = Math.min(cell, inner - j * cell);
          context.fillRect(px + 1 + i * cell, py + 1 + j * cell, w, h);
        }
      }
      // borde oscuro de 1px
      context.strokeStyle = 'rgba(0,0,0,0.45)';
      context.lineWidth = 1;
      context.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
    },
  },
};

let skin = 'retro';

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const s = SKINS[skin];
  const color = (theme === 'light' ? s.colorsLight : s.colors)[colorIndex];
  context.globalAlpha = alpha ?? 1;
  s.drawBlock(context, x * size, y * size, color, size, colorIndex);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // al terminar, la pieza que no cupo no se dibuja encima del tablero
  if (gameOver) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// dibuja la forma recortada y centrada en un slot de ancho w y alto slotH
function drawCentered(context, shape, w, y0, slotH, size) {
  const rows = [], cols = [];
  shape.forEach((row, r) => row.forEach((v, c) => {
    if (v) { rows.push(r); cols.push(c); }
  }));
  const minR = Math.min(...rows), maxR = Math.max(...rows);
  const minC = Math.min(...cols), maxC = Math.max(...cols);
  const offX = (w - (maxC - minC + 1) * size) / 2;
  const offY = y0 + (slotH - (maxR - minR + 1) * size) / 2;
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      drawBlock(context, offX / size + (c - minC), offY / size + (r - minR), shape[r][c], size);
}

function drawNext() {
  const peek = gameTime < peekUntil;
  peekShown = peek;
  const h = peek ? 250 : 120;
  if (nextCanvas.height !== h) nextCanvas.height = h;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!peek) {
    drawCentered(nextCtx, queue[0].shape, 120, 0, 120, 30);
    return;
  }
  for (let i = 0; i < QUEUE_SIZE; i++)
    drawCentered(nextCtx, queue[i].shape, 120, i * 50, 50, 14);
}

function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (held !== null) drawCentered(holdCtx, PIECES[held], 120, 0, 120, 30);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  showGameOverRecords();
  overlay.classList.remove('hidden');
  if (pendingRecord) nameInput.focus(); // solo funciona con el overlay visible
  draw();
}

// ---- Records ----

function loadRecords() {
  const empty = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!data || !Array.isArray(data.top)) return empty;
    const top = data.top
      .filter(r => r && Number.isFinite(r.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TOP);
    return {
      top,
      bestCombo: Number(data.bestCombo) || 0,
      maxLines: Number(data.maxLines) || 0,
    };
  } catch {
    return empty;
  }
}

function saveRecords(rec) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch {}
}

function renderRecordsTable(table, top, highlight) {
  table.replaceChildren();
  const head = table.insertRow();
  ['#', 'NOMBRE', 'PUNTOS', 'LÍN', 'NIV', 'COMBO'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  });
  if (!top.length) {
    const td = table.insertRow().insertCell();
    td.colSpan = 6;
    td.className = 'empty';
    td.textContent = 'Sin récords todavía';
    return;
  }
  top.forEach((r, i) => {
    const tr = table.insertRow();
    if (i === highlight) tr.className = 'highlight';
    [i + 1, r.name || '---', Number(r.score).toLocaleString(), r.lines ?? 0, r.level ?? 1, r.combo ?? 0]
      .forEach(v => { tr.insertCell().textContent = v; });
  });
}

function statsText(rec) {
  return `Mejor combo: ${rec.bestCombo} · Máx. líneas: ${rec.maxLines}`;
}

function showStartScreen() {
  const rec = loadRecords();
  renderRecordsTable(startTable, rec.top, -1);
  startStats.textContent = statsText(rec);
  startScreen.classList.remove('hidden');
}

function showGameOverRecords() {
  const rec = loadRecords();
  const newCombo = maxCombo > rec.bestCombo;
  const newLines = lines > rec.maxLines;
  if (newCombo) rec.bestCombo = maxCombo;
  if (newLines) rec.maxLines = lines;
  if (newCombo || newLines) saveRecords(rec);

  const qualifies = score > 0 && (rec.top.length < MAX_TOP || score > rec.top[rec.top.length - 1].score);
  pendingRecord = qualifies ? { score, lines, level, combo: maxCombo } : null;

  const badges = [];
  if (newCombo) badges.push('combo');
  if (newLines) badges.push('líneas');
  if (badges.length) recordBadge.textContent = `¡Nuevo récord! (${badges.join(' y ')})`;
  recordBadge.classList.toggle('hidden', !badges.length);
  overlayStats.textContent = `${statsText(rec)} · Esta partida: combo ${maxCombo}`;
  renderRecordsTable(overlayTable, rec.top, -1);
  recordsBox.classList.remove('hidden');
  nameForm.classList.toggle('hidden', !qualifies);
  recordMsg.textContent = qualifies ? '¡Entraste al top 5! Escribe tu nombre.' : 'No entraste al top 5.';
  if (qualifies) nameInput.value = '';
}

function saveName() {
  if (!pendingRecord) return;
  const rec = loadRecords();
  const entry = { name: nameInput.value.trim().slice(0, 12) || 'Anónimo', ...pendingRecord, date: new Date().toISOString() };
  pendingRecord = null;
  // tras las puntuaciones iguales (la partida más antigua gana el empate)
  let idx = rec.top.findIndex(r => r.score < entry.score);
  if (idx === -1) idx = rec.top.length;
  rec.top.splice(idx, 0, entry);
  rec.top = rec.top.slice(0, MAX_TOP);
  saveRecords(rec);
  nameForm.classList.add('hidden');
  recordMsg.textContent = idx < MAX_TOP ? 'Récord guardado.' : '';
  renderRecordsTable(overlayTable, rec.top, idx);
  overlayStats.textContent = statsText(rec);
  nameInput.blur();
}

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveName(); }
});
saveNameBtn.addEventListener('click', () => { saveName(); saveNameBtn.blur(); });

playBtn.addEventListener('click', () => { playBtn.blur(); startGame(); });

resetRecordsBtn.addEventListener('click', () => {
  resetRecordsBtn.blur();
  if (!confirm('¿Borrar todos los records?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch {}
  showStartScreen();
});


function loadStartLevel() {
  try {
    const n = parseInt(localStorage.getItem('startLevel'), 10);
    return n >= 1 && n <= MAX_START_LEVEL ? n : 1;
  } catch {
    return 1;
  }
}

function showPauseMain() {
  pauseTitle.textContent = 'PAUSA';
  pauseMain.classList.remove('hidden');
  pauseControlsView.classList.add('hidden');
}

function showPauseControls() {
  pauseTitle.textContent = 'CONTROLES';
  pauseMain.classList.add('hidden');
  pauseControlsView.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    pauseMenu.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur(); // el select no debe quedar con foco
    // evita movimientos accidentales con teclas aún pulsadas al reanudar
    resumeGuard = true;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { resumeGuard = false; }, 150);
    lastTime = performance.now();
    dropAccum = 0;
    animId = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(animId);
    showPauseMain();
    startLevelSelect.value = String(startLevel);
    pauseMenu.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused || menuOpen) return;
  const dt = ts - lastTime;
  lastTime = ts;
  gameTime += dt;
  dropAccum += dt;
  const interval = gameTime < slowUntil ? dropInterval * SLOW_FACTOR : dropInterval;
  if (dropAccum >= interval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  updateStatus();
  if ((gameTime < peekUntil) !== peekShown) drawNext();
  draw();
  // endGame() puede haberse llamado desde lockPiece(); no reprogramar el frame
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

// reinicia el estado sin arrancar el bucle
function resetState() {
  board = createBoard();
  comboStreak = 0;
  maxCombo = 0;
  pendingRecord = null;
  recordsBox.classList.add('hidden');
  score = 0;
  lines = 0;
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  resumeGuard = false;
  dropInterval = baseInterval();
  dropAccum = 0;
  lastTime = performance.now();
  energy = 0;
  gameTime = 0;
  peekUntil = 0;
  slowUntil = 0;
  peekShown = false;
  held = null;
  holdCharges = 0;
  holdUsedThisPiece = false;
  undoSnapshot = null;
  menuOpen = false;
  swapMode = false;
  queue = Array.from({ length: QUEUE_SIZE }, randomPiece);
  spawn();
  updateHUD();
  drawHold();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  abilityMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
}

function startGame() {
  resetState();
  startScreen.classList.add('hidden');
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (!startScreen.classList.contains('hidden')) return;
  if (menuOpen) { handleMenuKey(e); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    if (e.repeat || gameOver) return;
    // Escape dentro de la sub-vista de controles vuelve a la lista
    if (paused && e.code === 'Escape' && !pauseControlsView.classList.contains('hidden')) showPauseMain();
    else togglePause();
    return;
  }
  if (e.code === 'Space') e.preventDefault();
  if (paused || gameOver || resumeGuard) return;
  switch (e.code) {
    case 'KeyE':
      openAbilityMenu();
      break;
    case 'KeyC':
      holdPiece();
      break;
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  restartBtn.blur();
  saveName(); // si quedó un récord sin guardar, se guarda con el nombre escrito (o "Anónimo")
  startGame();
});

document.addEventListener('keyup', e => {
  // el keyup de la tecla que reanudó no cuenta
  if (e.code === 'KeyP' || e.code === 'Escape') return;
  resumeGuard = false;
  clearTimeout(resumeTimer);
});

pauseMenu.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur(); // evita que Space active el botón durante la partida
  switch (btn.id) {
    case 'pause-resume': togglePause(); break;
    case 'pause-restart': startGame(); break;
    case 'pause-controls': showPauseControls(); break;
    case 'pause-back': showPauseMain(); break;
  }
});

startLevelSelect.addEventListener('change', () => {
  startLevel = Math.min(MAX_START_LEVEL, Math.max(1, Number(startLevelSelect.value) || 1));
  try { localStorage.setItem('startLevel', String(startLevel)); } catch {}
  startLevelSelect.blur();
});

abilityMenu.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  btn.blur(); // evita que Space active el botón durante la partida
  if (btn.dataset.ability) chooseAbility(btn.dataset.ability);
  else if (btn.dataset.type) applySwap(Number(btn.dataset.type));
});

function applyTheme(name) {
  theme = name;
  document.documentElement.dataset.theme = name;
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || gridColor;
  themeToggle.textContent = name === 'dark' ? '☀ Modo claro' : '🌙 Modo oscuro';
  // redibujar también con el juego en pausa o terminado
  if (current) {
    draw();
    drawNext();
    drawHold();
  }
}

function loadTheme() {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applySkin(name) {
  if (!SKINS[name]) name = 'retro';
  skin = name;
  document.documentElement.dataset.skin = name;
  skinSelect.value = name;
  // el --grid depende de la skin (neon fuerza fondo oscuro)
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || gridColor;
  if (current) {
    draw();
    drawNext();
    drawHold();
  }
}

function loadSkin() {
  try {
    const s = localStorage.getItem('skin');
    return SKINS[s] ? s : 'retro';
  } catch {
    return 'retro';
  }
}

skinSelect.addEventListener('change', () => {
  try { localStorage.setItem('skin', skinSelect.value); } catch {}
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que Space (hard drop) abra el select
});

// al cerrar el desplegable sin cambiar nada, también soltar el foco
skinSelect.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'Enter') skinSelect.blur();
});

themeToggle.addEventListener('click', () => {
  const name = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', name); } catch {}
  applyTheme(name);
  themeToggle.blur(); // evita que Space active el botón durante la partida
});

applySkin(loadSkin());
applyTheme(loadTheme());
resetState();
draw();
showStartScreen();
