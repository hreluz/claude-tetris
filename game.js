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
  '#64b5f6', // J - blue
  '#ffb74d', // L - orange
  '#f4511e', // bomb - deep orange
  '#ffeb3b', // lightning - electric yellow
  '#26a69a', // gravity - teal
  '#b3e5fc', // freeze - ice blue
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
  [[8]],                                       // bomb
  [[9]],                                       // lightning
  [[10]],                                      // gravity
  [[11]],                                      // freeze
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const BOMB_TYPE = 8;
const BOMB_CHANCE = 0.05;
const LIGHTNING_TYPE = 9;
const LIGHTNING_CHANCE = 0.03;
const GRAVITY_TYPE = 10;
const GRAVITY_CHANCE = 0.03;
const FALL_DURATION = 900;
const FREEZE_TYPE = 11;
const FREEZE_CHANCE = 0.03;
const FREEZE_DURATION = 5000;

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
const themeToggleBtn = document.getElementById('theme-toggle');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, explosionFlash, fallAnimation, animating, freezeUntil;

const THEME_KEY = 'tetris-theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  applyTheme(isLight ? 'dark' : 'light');
  if (board) {
    draw();
    drawNext();
  }
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const roll = Math.random();
  let type;
  if (roll < BOMB_CHANCE) {
    type = BOMB_TYPE;
  } else if (roll < BOMB_CHANCE + LIGHTNING_CHANCE) {
    type = LIGHTNING_TYPE;
  } else if (roll < BOMB_CHANCE + LIGHTNING_CHANCE + GRAVITY_CHANCE) {
    type = GRAVITY_TYPE;
  } else if (roll < BOMB_CHANCE + LIGHTNING_CHANCE + GRAVITY_CHANCE + FREEZE_CHANCE) {
    type = FREEZE_TYPE;
  } else {
    type = Math.floor(Math.random() * 7) + 1;
  }
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
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

function explode(cx, cy) {
  for (let r = cy - 1; r <= cy + 1; r++) {
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      board[r][c] = 0;
    }
  }
  explosionFlash = { cx, cy, start: performance.now() };
}

function strikeRow(y) {
  board.splice(y, 1);
  board.unshift(new Array(COLS).fill(0));
  lines += 1;
  score += (LINE_SCORES[1] || 0) * level;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  updateHUD();
}

function computeCompactMoves() {
  const newBoard = createBoard();
  const moves = [];
  for (let c = 0; c < COLS; c++) {
    const filled = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c] !== 0) filled.push({ from: r, color: board[r][c] });
    }
    const startRow = ROWS - filled.length;
    filled.forEach((f, i) => {
      const to = startRow + i;
      newBoard[to][c] = f.color;
      if (f.from !== to) moves.push({ col: c, from: f.from, to, color: f.color });
    });
  }
  return { moves, newBoard };
}

function startCompaction() {
  const { moves, newBoard } = computeCompactMoves();
  if (!moves.length) {
    finishLock();
    return;
  }
  moves.forEach(m => { board[m.from][m.col] = 0; });
  fallAnimation = { moves, newBoard, start: performance.now() };
  animating = true;
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
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
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

function finishLock() {
  clearLines();
  spawn();
}

function lockPiece() {
  if (current.type === BOMB_TYPE) {
    explode(current.x, current.y);
    finishLock();
  } else if (current.type === LIGHTNING_TYPE) {
    strikeRow(current.y);
    finishLock();
  } else if (current.type === GRAVITY_TYPE) {
    startCompaction();
  } else if (current.type === FREEZE_TYPE) {
    freezeUntil = performance.now() + FREEZE_DURATION;
    finishLock();
  } else {
    merge();
    finishLock();
  }
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  if (colorIndex === BOMB_TYPE) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.7)';
    context.beginPath();
    context.arc(cx, cy, size / 8, 0, Math.PI * 2);
    context.fill();
  } else if (colorIndex === LIGHTNING_TYPE) {
    const bx = x * size;
    const by = y * size;
    const pts = [
      [0.58, 0.02], [0.22, 0.56], [0.46, 0.56],
      [0.30, 0.98], [0.82, 0.40], [0.52, 0.40],
    ];
    context.fillStyle = color;
    context.beginPath();
    pts.forEach(([px, py], i) => {
      const px2 = bx + px * size;
      const py2 = by + py * size;
      if (i === 0) context.moveTo(px2, py2); else context.lineTo(px2, py2);
    });
    context.closePath();
    context.fill();
  } else if (colorIndex === GRAVITY_TYPE) {
    const bx = x * size;
    const by = y * size;
    context.fillStyle = color;
    // stem
    context.fillRect(bx + size * 0.4, by + size * 0.12, size * 0.2, size * 0.4);
    // arrowhead
    context.beginPath();
    context.moveTo(bx + size * 0.2, by + size * 0.5);
    context.lineTo(bx + size * 0.8, by + size * 0.5);
    context.lineTo(bx + size * 0.5, by + size * 0.85);
    context.closePath();
    context.fill();
  } else if (colorIndex === FREEZE_TYPE) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    const r = size / 2 - 4;
    context.strokeStyle = color;
    context.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const angle = (Math.PI / 3) * i;
      context.beginPath();
      context.moveTo(cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
      context.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      context.stroke();
    }
  } else {
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    // highlight
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();
  ctx.strokeStyle = gridColor || '#22222e';
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

  if (animating) {
    // falling blocks settling into place
    const t = Math.min(1, (performance.now() - fallAnimation.start) / FALL_DURATION);
    const eased = t * t;
    for (const m of fallAnimation.moves) {
      const y = m.from + (m.to - m.from) * eased;
      drawBlock(ctx, m.col, y, m.color, BLOCK);
    }
  } else {
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

  // freeze tint
  if (performance.now() < freezeUntil) {
    ctx.fillStyle = 'rgba(179,229,252,0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const secsLeft = Math.ceil((freezeUntil - performance.now()) / 1000);
    ctx.fillStyle = '#e1f5fe';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`❄ ${secsLeft}s`, canvas.width - 8, 20);
    ctx.textAlign = 'left';
  }

  // explosion flash
  if (explosionFlash) {
    const elapsed = performance.now() - explosionFlash.start;
    if (elapsed < 200) {
      const { cx, cy } = explosionFlash;
      ctx.globalAlpha = 1 - elapsed / 200;
      ctx.fillStyle = '#fff59d';
      for (let r = cy - 1; r <= cy + 1; r++) {
        for (let c = cx - 1; c <= cx + 1; c++) {
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
        }
      }
      ctx.globalAlpha = 1;
    } else {
      explosionFlash = null;
    }
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (animating) {
    if (ts - fallAnimation.start >= FALL_DURATION) {
      board = fallAnimation.newBoard;
      fallAnimation = null;
      animating = false;
      finishLock();
    }
  } else if (ts < freezeUntil) {
    // frozen: skip automatic drop, but manual controls still work
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  explosionFlash = null;
  fallAnimation = null;
  animating = false;
  freezeUntil = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver || animating) return;
  switch (e.code) {
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

restartBtn.addEventListener('click', init);
themeToggleBtn.addEventListener('click', toggleTheme);

initTheme();
init();
