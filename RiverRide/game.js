// ─── RiverRide ───────────────────────────────────────────────────────────────

const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const fuelEl  = document.getElementById('fuel');
const levelEl = document.getElementById('level');
const msgEl   = document.getElementById('overlay-msg');

// ── Constants ────────────────────────────────────────────────────────────────
const W = 400, H = 600;
canvas.width  = W;
canvas.height = H;

const SCROLL_SPEED_INIT = 1.0;
const SPEED_INCREMENT   = 0.0002;
const RIVER_W_MIN       = 180;
const RIVER_W_MAX       = 360;
const RIVER_W_START     = 250;
const SEGMENT_H         = 4;          // px per river slice
const SEGMENTS          = Math.ceil(H / SEGMENT_H) + 8;
const DRIFT_MAX         = 1.4;
const FUEL_DRAIN        = 0.008;      // per frame
const FUEL_PICKUP       = 40;
const BULLET_SPEED      = 8;
const ENEMY_INTERVAL    = 120;        // frames between enemies
const FUEL_INTERVAL     = 200;
const ISLAND_INTERVAL    = 280;       // frames between island spawns
const ISLAND_MIN_RIVER_W = 200;       // river must be at least this wide
const LEVEL_FRAMES       = 2200;      // scrolling frames before bridge appears
const BRIDGE_HP          = 2;         // always 2 shots to destroy

// ── State ────────────────────────────────────────────────────────────────────
let running, score, lives, fuel, scrollSpeed;
let segments = [];   // [{cx, w}]  – river centre x and width
let plane    = {};
let bullets  = [];
let enemies  = [];
let fuelPads = [];
let islands  = [];   // [{cx, cy, rx, ry}] – elliptical land masses
let bridge   = null; // {y, cx, w, hp, maxHp} – end-of-level bridge
let explosions = [];
let frameCount, enemyTimer, fuelTimer, islandTimer, levelFrames;
let level = 1;
let keys  = {};
// River width has its own momentum so changes are dramatic but smooth
let riverWidthTarget = RIVER_W_START;
let riverWidthDrift  = 0;
// Sub-segment scroll offset (0..SEGMENT_H) for smooth river scrolling
let riverScrollOffset = 0;
// State of the leading edge used to generate the next segment at the top
let riverLeadCx = W / 2, riverLeadW = RIVER_W_START, riverLeadDrift = 0;

// ── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

startBtn.addEventListener('click', startGame);

// ── Assets ────────────────────────────────────────────────────────────────────
const planeImg      = new Image(); planeImg.src      = 'plane.svg';
const planeImgLeft  = new Image(); planeImgLeft.src  = 'plane_left.svg';
const planeImgRight = new Image(); planeImgRight.src = 'plane_right.svg';
const enemyImg      = new Image(); enemyImg.src      = 'enemy.svg';

// ── River generation ─────────────────────────────────────────────────────────
function pickNewWidthTarget() {
  // Randomly jump to a wide or narrow stretch
  return RIVER_W_MIN + Math.random() * (RIVER_W_MAX - RIVER_W_MIN);
}

function stepRiver(cx, w, drift) {
  // Width: pull toward target with momentum, occasional retarget
  if (Math.random() < 0.015) riverWidthTarget = pickNewWidthTarget();
  riverWidthDrift += (riverWidthTarget - w) * 0.008 + (Math.random() - 0.5) * 1.2;
  riverWidthDrift  = Math.max(-3, Math.min(3, riverWidthDrift));
  w += riverWidthDrift;
  w  = Math.max(RIVER_W_MIN, Math.min(RIVER_W_MAX, w));

  // Centre x drift
  drift += (Math.random() - 0.5) * 0.5;
  drift  = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, drift));
  cx    += drift;
  cx     = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, cx));
  return { cx, w, drift };
}

function initRiver() {
  segments = [];
  riverWidthTarget = RIVER_W_START;
  riverWidthDrift  = 0;
  riverScrollOffset = 0;
  let cx = W / 2, w = RIVER_W_START, drift = 0;
  // Generate forward then reverse so segments[0]=top(ahead), segments[last]=bottom(behind)
  for (let i = 0; i < SEGMENTS; i++) {
    ({ cx, w, drift } = stepRiver(cx, w, drift));
    segments.push({ cx, w });
  }
  segments.reverse();
  // Lead state continues forward from the last-generated point (now segments[0])
  riverLeadCx = cx; riverLeadW = w; riverLeadDrift = drift;
}

// Called each frame when not paused — advances offset and prepends new segments
function scrollRiver() {
  riverScrollOffset += scrollSpeed;
  while (riverScrollOffset >= SEGMENT_H) {
    riverScrollOffset -= SEGMENT_H;
    const next = stepRiver(riverLeadCx, riverLeadW, riverLeadDrift);
    riverLeadCx = next.cx; riverLeadW = next.w; riverLeadDrift = next.drift;
    segments.unshift({ cx: next.cx, w: next.w });
    segments.pop();
  }
}

// ── Game init ─────────────────────────────────────────────────────────────────
function startGame() {
  overlay.style.display = 'none';
  score      = 0;
  lives      = 3;
  fuel       = 100;
  scrollSpeed = SCROLL_SPEED_INIT;
  frameCount  = 0;
  enemyTimer  = 0;
  fuelTimer   = 0;
  bullets     = [];
  enemies     = [];
  fuelPads    = [];
  islands     = [];
  bridge      = null;
  explosions  = [];
  islandTimer = 0;
  levelFrames = 0;
  level       = 1;
  riverScrollOffset = 0;
  plane = { x: W / 2, y: H * 0.7, w: 24, h: 32, shootCooldown: 0 };
  initRiver();
  running = true;
  requestAnimationFrame(loop);
}

// ── Spawning ──────────────────────────────────────────────────────────────────
function spawnEnemy() {
  const seg = segments[2];  // near top of visible area
  const cx = seg.cx, hw = seg.w / 2 - 12;
  const x  = cx + (Math.random() * 2 - 1) * hw;
  enemies.push({ x, y: 0, w: 20, h: 20, vx: (Math.random() - 0.5) * 1.5, vy: scrollSpeed + 0.5 });
}

function spawnFuelPad() {
  const seg = segments[2];
  const cx = seg.cx, hw = seg.w / 2 - 20;
  const x  = cx + (Math.random() * 2 - 1) * hw;
  fuelPads.push({ x, y: 0, w: 30, h: 14 });
}

function spawnIsland() {
  const seg = segments[2];
  if (seg.w < ISLAND_MIN_RIVER_W) return;
  const rx  = 12 + Math.random() * 22;          // half-width 12–34px
  const ry  = 28 + Math.random() * 50;          // half-height 28–78px
  const margin = rx + 18;
  const maxOff = seg.w / 2 - margin;
  if (maxOff <= 0) return;
  const cx = seg.cx + (Math.random() * 2 - 1) * maxOff;
  islands.push({ cx, cy: -ry, rx, ry });
}

function spawnBridge() {
  const seg = segments[2];
  bridge = { y: -10, cx: seg.cx, w: seg.w - 6, hp: BRIDGE_HP, maxHp: BRIDGE_HP };
}

// ── Collision ─────────────────────────────────────────────────────────────────
function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2
      && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function riverEdgesAt(screenY) {
  const idx = Math.floor((screenY - riverScrollOffset) / SEGMENT_H);
  const seg = segments[Math.max(0, Math.min(segments.length - 1, idx))];
  return { left: seg.cx - seg.w / 2, right: seg.cx + seg.w / 2 };
}

// ── Explosions ────────────────────────────────────────────────────────────────
function addExplosion(x, y) {
  explosions.push({ x, y, r: 4, life: 30, maxLife: 30 });
}

// ── Update ────────────────────────────────────────────────────────────────────
function update() {
  frameCount++;
  score = Math.floor(frameCount * scrollSpeed / 10);

  // Always scroll
  scrollSpeed += SPEED_INCREMENT;
  scrollRiver();

  // Level timer & bridge spawn
  levelFrames++;
  if (!bridge && levelFrames >= LEVEL_FRAMES) {
    spawnBridge();
    levelFrames = 0;
  }

  // Bridge scrolls down like any other object
  if (bridge) bridge.y += scrollSpeed;

  // Plane movement
  const spd = 3;
  if ((keys['ArrowLeft']  || keys['KeyA']) && plane.x - plane.w / 2 > 0)  plane.x -= spd;
  if ((keys['ArrowRight'] || keys['KeyD']) && plane.x + plane.w / 2 < W)  plane.x += spd;
  if ((keys['ArrowUp']    || keys['KeyW']) && plane.y - plane.h / 2 > 0)  plane.y -= spd;
  if ((keys['ArrowDown']  || keys['KeyS']) && plane.y + plane.h / 2 < H)  plane.y += spd;

  // Shoot
  plane.shootCooldown = Math.max(0, plane.shootCooldown - 1);
  if ((keys['Space'] || keys['KeyZ']) && plane.shootCooldown === 0) {
    bullets.push({ x: plane.x, y: plane.y - plane.h / 2, w: 4, h: 10 });
    plane.shootCooldown = 12;
  }

  // Fuel drain
  fuel -= FUEL_DRAIN;
  if (fuel <= 0) { fuel = 0; die(); return; }

  // Spawn
  enemyTimer++;
  if (enemyTimer >= ENEMY_INTERVAL)  { spawnEnemy();   enemyTimer  = 0; }
  fuelTimer++;
  if (fuelTimer  >= FUEL_INTERVAL)   { spawnFuelPad(); fuelTimer   = 0; }
  islandTimer++;
  if (islandTimer >= ISLAND_INTERVAL){ spawnIsland();  islandTimer = 0; }

  // Bullets
  bullets = bullets.filter(b => b.y > -20);
  bullets.forEach(b => b.y -= BULLET_SPEED);

  // Enemies
  enemies.forEach(e => { e.x += e.vx; e.y += e.vy; });
  enemies = enemies.filter(e => e.y < H + 40);

  // Fuel pads
  fuelPads.forEach(f => f.y += scrollSpeed);
  fuelPads = fuelPads.filter(f => f.y < H + 40);

  // Islands – scroll and kill plane on hit
  islands.forEach(isl => isl.cy += scrollSpeed);
  islands = islands.filter(isl => isl.cy - isl.ry < H + 40);
  islands.forEach(isl => {
    const dx = (plane.x - isl.cx) / isl.rx;
    const dy = (plane.y - isl.cy) / isl.ry;
    if (dx * dx + dy * dy < 1) { addExplosion(plane.x, plane.y); die(); }
  });

  // Bullet–enemy
  bullets.forEach(b => {
    enemies = enemies.filter(e => {
      if (rectsOverlap(b, e)) { addExplosion(e.x, e.y); b.y = -999; return false; }
      return true;
    });
  });

  // Bullet–bridge
  if (bridge) {
    const br = { x: bridge.cx, y: bridge.y, w: bridge.w, h: 14 };
    bullets = bullets.filter(b => {
      if (rectsOverlap(b, br)) {
        bridge.hp--;
        addExplosion(b.x, bridge.y);
        if (bridge.hp <= 0) {
          for (let i = -1; i <= 1; i++)
            addExplosion(bridge.cx + i * bridge.w * 0.35, bridge.y);
          bridge = null;
          level++;
        }
        return false;
      }
      return true;
    });
  }

  // Player–bridge: instant game over
  if (bridge) {
    const br = { x: bridge.cx, y: bridge.y, w: bridge.w, h: 14 };
    if (rectsOverlap(plane, br)) {
      addExplosion(plane.x, plane.y);
      lives = 1; // die() will decrement to 0
      die();
    }
  }

  // Player–enemy
  enemies.forEach(e => {
    if (rectsOverlap(plane, e)) { addExplosion(e.x, e.y); die(); }
  });

  // Player–fuel
  fuelPads = fuelPads.filter(f => {
    if (rectsOverlap(plane, f)) { fuel = Math.min(100, fuel + FUEL_PICKUP); return false; }
    return true;
  });

  // Bank collision
  const { left, right } = riverEdgesAt(plane.y);
  if (plane.x - plane.w / 2 < left || plane.x + plane.w / 2 > right) {
    addExplosion(plane.x, plane.y);
    die();
  }

  // Explosions
  explosions.forEach(ex => ex.life--);
  explosions = explosions.filter(ex => ex.life > 0);
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  // River — start at i=-1 so the extra segment above always covers the top gap
  for (let i = -1; i < SEGMENTS; i++) {
    const seg = segments[Math.max(0, i)];
    const y   = i * SEGMENT_H + riverScrollOffset;
    // Banks
    ctx.fillStyle = '#3a5a1a';
    ctx.fillRect(0,                  y, seg.cx - seg.w / 2,     SEGMENT_H + 1);
    ctx.fillRect(seg.cx + seg.w / 2, y, W - seg.cx - seg.w / 2, SEGMENT_H + 1);
    // Water
    ctx.fillStyle = '#1a3a6a';
    ctx.fillRect(seg.cx - seg.w / 2, y, seg.w, SEGMENT_H + 1);
  }

  // River shimmer
  ctx.strokeStyle = '#2a5aaa44';
  ctx.lineWidth = 1;
  for (let i = -1; i < SEGMENTS; i += 8) {
    const seg = segments[Math.max(0, i)];
    const y   = i * SEGMENT_H + riverScrollOffset + SEGMENT_H / 2;
    ctx.beginPath();
    ctx.moveTo(seg.cx - seg.w * 0.2, y);
    ctx.lineTo(seg.cx + seg.w * 0.2, y);
    ctx.stroke();
  }

  // Islands
  islands.forEach(isl => {
    // Shadow / shore ring
    ctx.fillStyle = '#2a4a10';
    ctx.beginPath();
    ctx.ellipse(isl.cx, isl.cy, isl.rx + 4, isl.ry + 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Land body
    ctx.fillStyle = '#3a6018';
    ctx.beginPath();
    ctx.ellipse(isl.cx, isl.cy, isl.rx, isl.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = '#4a7a22';
    ctx.beginPath();
    ctx.ellipse(isl.cx - isl.rx * 0.2, isl.cy - isl.ry * 0.25, isl.rx * 0.45, isl.ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Bridge
  if (bridge) {
    const bL = bridge.cx - bridge.w / 2;
    const bR = bridge.cx + bridge.w / 2;
    const by = bridge.y;

    // Concrete pillars on each bank
    ctx.fillStyle = '#888';
    ctx.fillRect(bL - 14, by - 22, 14, 44);
    ctx.fillRect(bR,      by - 22, 14, 44);

    // Bridge deck
    ctx.fillStyle = '#aaa';
    ctx.fillRect(bL, by - 8, bridge.w, 16);

    // Steel trusses
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bL, by - 8); ctx.lineTo(bridge.cx, by + 8); ctx.lineTo(bR, by - 8);
    ctx.moveTo(bL, by + 8); ctx.lineTo(bridge.cx, by - 8); ctx.lineTo(bR, by + 8);
    ctx.stroke();

    // Road markings
    ctx.strokeStyle = '#fff6';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(bL + 4, by); ctx.lineTo(bR - 4, by);
    ctx.stroke();
    ctx.setLineDash([]);

    // HP bar
    const hpFrac = bridge.hp / bridge.maxHp;
    ctx.fillStyle = '#222';
    ctx.fillRect(bL, by - 30, bridge.w, 7);
    ctx.fillStyle = hpFrac > 0.55 ? '#0f0' : hpFrac > 0.25 ? '#ff0' : '#f44';
    ctx.fillRect(bL, by - 30, bridge.w * hpFrac, 7);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(bL, by - 30, bridge.w, 7);

  }

  // Fuel pads
  fuelPads.forEach(f => {
    ctx.fillStyle = '#f80';
    ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
    ctx.fillStyle = '#ff0';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('FUEL', f.x, f.y + 4);
  });

  // Enemies
  enemies.forEach(e => {
    if (enemyImg.complete && enemyImg.naturalWidth > 0) {
      ctx.drawImage(enemyImg, e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
    } else {
      ctx.fillStyle = '#f44';
      ctx.beginPath();
      ctx.moveTo(e.x, e.y + e.h / 2);
      ctx.lineTo(e.x - e.w / 2, e.y - e.h / 2);
      ctx.lineTo(e.x + e.w / 2, e.y - e.h / 2);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Bullets
  ctx.fillStyle = '#ff0';
  bullets.forEach(b => ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h));

  // Plane
  const movingLeft  = keys['ArrowLeft']  || keys['KeyA'];
  const movingRight = keys['ArrowRight'] || keys['KeyD'];
  const activeImg   = movingLeft  ? planeImgLeft
                    : movingRight ? planeImgRight
                    : planeImg;
  if (activeImg.complete && activeImg.naturalWidth > 0) {
    ctx.drawImage(activeImg, plane.x - plane.w / 2, plane.y - plane.h / 2, plane.w, plane.h);
  } else {
    // Fallback triangle while image loads
    ctx.fillStyle = '#0cf';
    ctx.beginPath();
    ctx.moveTo(plane.x, plane.y - plane.h / 2);
    ctx.lineTo(plane.x - plane.w / 2, plane.y + plane.h / 2);
    ctx.lineTo(plane.x, plane.y + plane.h / 4);
    ctx.lineTo(plane.x + plane.w / 2, plane.y + plane.h / 2);
    ctx.closePath();
    ctx.fill();
  }

  // Explosions
  explosions.forEach(ex => {
    const t = ex.life / ex.maxLife;
    ctx.globalAlpha = t;
    ctx.fillStyle = `hsl(${30 + (1 - t) * 30}, 100%, 60%)`;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.r + (1 - t) * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // UI sync
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  fuelEl.value = fuel;
  levelEl.textContent = level;
}

// ── Die / Game-over ───────────────────────────────────────────────────────────
let dying = false;
function die() {
  if (dying) return;
  dying = true;
  lives--;
  livesEl.textContent = lives;

  if (lives <= 0) {
    running = false;
    setTimeout(() => {
      msgEl.innerHTML = `GAME OVER<br>Score: ${score}`;
      startBtn.textContent = 'PLAY AGAIN';
      overlay.style.display = 'flex';
      dying = false;
    }, 800);
  } else {
    // Reset plane position briefly
    setTimeout(() => {
      plane = { x: W / 2, y: H * 0.7, w: 24, h: 32, shootCooldown: 0 };
      fuel = Math.max(30, fuel);
      dying = false;
    }, 600);
  }
}

// ── Loop ──────────────────────────────────────────────────────────────────────
function loop() {
  if (!running) return;
  update();
  draw();
  requestAnimationFrame(loop);
}
