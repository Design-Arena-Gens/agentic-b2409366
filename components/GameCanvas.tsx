"use client";
import { useEffect, useRef, useState } from 'react';
import { generateVentsLayout } from '@lib/maze';
import { bfsNextStep } from '@lib/pathfinding';

type Vec2 = { x: number; y: number };

const TILE = 24; // pixels per tile
const GRID_W = 40;
const GRID_H = 26;

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function length(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function toGrid(p: Vec2) { return { x: Math.floor(p.x), y: Math.floor(p.y) }; }

function inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H; }

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(true);
  const [won, setWon] = useState(false);
  const [lost, setLost] = useState(false);
  const [hint, setHint] = useState('Find the exit vent. Avoid the Stalker.');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;

    const width = TILE * GRID_W;
    const height = TILE * GRID_H;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = '100%';

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // World state
    const vents = generateVentsLayout(GRID_W, GRID_H);

    // Place player at top-left most open
    let start: Vec2 = { x: 1, y: 1 };
    outer: for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        if (vents[y][x] === 0) { start = { x, y }; break outer; }
      }
    }

    // Exit at farthest open tile
    let exit: Vec2 = start;
    let far = 0;
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        if (vents[y][x] === 0) {
          const d = Math.hypot(x - start.x, y - start.y);
          if (d > far) { far = d; exit = { x, y }; }
        }
      }
    }

    const player = {
      pos: { x: start.x + 0.5, y: start.y + 0.5 },
      vel: { x: 0, y: 0 },
      speed: 4.0,
      sprint: 6.0,
      crawling: true,
      stamina: 1.0,
    };

    const stalker = {
      pos: { x: exit.x + 0.5, y: exit.y + 0.5 },
      speed: 3.2,
      lastHeard: { x: exit.x, y: exit.y },
      cooldown: 0,
    };

    const flashlight = {
      angle: 0,
      fov: Math.PI / 6,
      range: 8.5,
    };

    const keys: Record<string, boolean> = {};
    const onKey = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = e.type === 'keydown'; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width * (TILE * GRID_W);
      const sy = (e.clientY - rect.top) / rect.height * (TILE * GRID_H);
      const px = player.pos.x * TILE;
      const py = player.pos.y * TILE;
      flashlight.angle = Math.atan2(sy - py, sx - px);
    };
    window.addEventListener('mousemove', onMouseMove);

    const audio = createAudio();
    audio.setAmbient(true);

    const collisions = (nx: number, ny: number) => {
      const gx = Math.floor(nx);
      const gy = Math.floor(ny);
      if (!inBounds(gx, gy)) return true;
      return vents[gy][gx] === 1;
    };

    let last = performance.now();
    let raf = 0;

    const step = (now: number) => {
      if (!running || won || lost) { draw(); return; }
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;

      // Input
      const crawlToggle = keys[' '] || keys['space'];
      if (crawlToggle) player.crawling = true;
      const sprinting = keys['shift'] && !player.crawling && player.stamina > 0.1;
      const move = { x: 0, y: 0 };
      if (keys['w'] || keys['arrowup']) move.y -= 1;
      if (keys['s'] || keys['arrowdown']) move.y += 1;
      if (keys['a'] || keys['arrowleft']) move.x -= 1;
      if (keys['d'] || keys['arrowright']) move.x += 1;
      const mag = Math.hypot(move.x, move.y) || 1;
      move.x /= mag; move.y /= mag;

      const maxSpeed = player.crawling ? player.speed * 0.6 : (sprinting ? player.sprint : player.speed);

      const nx = player.pos.x + move.x * maxSpeed * dt;
      const ny = player.pos.y + move.y * maxSpeed * dt;
      // simple axis-aligned collision
      if (!collisions(nx, player.pos.y)) player.pos.x = nx;
      if (!collisions(player.pos.x, ny)) player.pos.y = ny;

      // stamina dynamics
      if (sprinting && (Math.abs(move.x) + Math.abs(move.y) > 0)) player.stamina = Math.max(0, player.stamina - dt * 0.25);
      else player.stamina = Math.min(1, player.stamina + dt * 0.15);

      // noise propagation
      const noise = (sprinting ? 1.0 : player.crawling ? 0.2 : 0.5) * (Math.abs(move.x) + Math.abs(move.y) > 0 ? 1 : 0.3);
      if (noise > 0.4) audio.playFootstep();
      if (noise > 0.6) stalker.lastHeard = toGrid(player.pos);

      // stalker behavior
      stalker.cooldown -= dt;
      const pCell = toGrid(player.pos);
      const sCell = toGrid(stalker.pos);
      const see = hasLineOfSight(vents, sCell, pCell);
      const target = see ? pCell : stalker.lastHeard;
      if ((see || stalker.cooldown <= 0) && (target.x !== sCell.x || target.y !== sCell.y)) {
        const next = bfsNextStep(vents, sCell, target);
        if (next) {
          const dir = { x: next.x + 0.5 - stalker.pos.x, y: next.y + 0.5 - stalker.pos.y };
          const dm = Math.hypot(dir.x, dir.y) || 1;
          stalker.pos.x += (dir.x / dm) * stalker.speed * dt;
          stalker.pos.y += (dir.y / dm) * stalker.speed * dt;
        } else {
          // wander
          stalker.pos.x += (Math.random() - 0.5) * 0.5 * dt;
          stalker.pos.y += (Math.random() - 0.5) * 0.5 * dt;
        }
        stalker.cooldown = 0.08;
      }

      // check win/lose
      if (pCell.x === exit.x && pCell.y === exit.y) {
        setWon(true); setRunning(false); audio.setAmbient(false); audio.playWin();
      }
      if (length(player.pos, stalker.pos) < 0.45) {
        setLost(true); setRunning(false); audio.setAmbient(false); audio.playJumpscare();
      }

      draw();
      raf = requestAnimationFrame(step);
    };

    const draw = () => {
      // clear
      ctx.fillStyle = '#06090c';
      ctx.fillRect(0, 0, width, height);

      // vents grid
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          if (vents[y][x] === 1) {
            ctx.fillStyle = '#0f151b';
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          } else {
            ctx.fillStyle = '#0a0f14';
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
            // lines
            ctx.strokeStyle = 'rgba(30,45,60,0.15)';
            ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
          }
        }
      }

      // exit
      ctx.fillStyle = '#1dd3b0';
      ctx.fillRect(exit.x * TILE + 6, exit.y * TILE + 6, TILE - 12, TILE - 12);

      // stalker trail glow
      ctx.fillStyle = '#521c26';
      ctx.beginPath();
      ctx.arc(stalker.pos.x * TILE, stalker.pos.y * TILE, 6, 0, Math.PI * 2);
      ctx.fill();

      // player
      ctx.fillStyle = '#9ccfff';
      ctx.beginPath();
      ctx.arc(player.pos.x * TILE, player.pos.y * TILE, 5, 0, Math.PI * 2);
      ctx.fill();

      // lighting: dark overlay then carve with flashlight
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const darkness = ctx.createLinearGradient(0, 0, 0, height);
      darkness.addColorStop(0, 'rgba(0,0,0,0.85)');
      darkness.addColorStop(1, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = darkness;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'destination-out';
      const px = player.pos.x * TILE;
      const py = player.pos.y * TILE;

      // cone flashlight
      ctx.translate(px, py);
      ctx.rotate(flashlight.angle);
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, flashlight.range * TILE);
      grad.addColorStop(0, 'rgba(255,255,255,0.96)');
      grad.addColorStop(0.05, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      const spread = Math.tan(flashlight.fov) * flashlight.range * TILE;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(flashlight.range * TILE, -spread);
      ctx.lineTo(flashlight.range * TILE, spread);
      ctx.closePath();
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.restore();

      // subtle vision around player
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      const aura = ctx.createRadialGradient(px, py, 2, px, py, 80);
      aura.addColorStop(0, 'rgba(255,255,255,0.45)');
      aura.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(px, py, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // vignette
      const vg = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) / 2.2, width / 2, height / 2, Math.min(width, height) / 1.2);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);
    };

    const hasLineOfSight = (grid: number[][], a: Vec2, b: Vec2) => {
      // Bresenham through grid cells
      let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      while (true) {
        if (grid[y0]?.[x0] === 1) return false;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      return true;
    };

    draw();
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mousemove', onMouseMove);
      audio.dispose();
    };
  }, [running, won, lost]);

  const handleRestart = () => {
    setWon(false); setLost(false); setRunning(false);
    // force re-mount canvas by toggling key
    requestAnimationFrame(() => setRunning(true));
  };

  return (
    <div className="canvasWrap">
      <canvas ref={canvasRef} className="canvas" />
      <div className="hud">
        <div className="row">
          <div className="badge">Stay low. Keep quiet.</div>
          <div className="badge">Vent Nightmare</div>
        </div>
        {(won || lost) && (
          <div className="centerOverlay">
            <div className="modal">
              <h3>{won ? 'Escaped the Vents' : 'You Were Caught'}</h3>
              <p>{won ? 'You found the exit grate.' : 'The Stalker found you in the vents.'}</p>
              <button className="linkBtn" onClick={handleRestart}>Play Again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function createAudio() {
  const ctx = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;
  let ambientNode: { stop: () => void } | null = null;
  function setAmbient(on: boolean) {
    if (!ctx) return;
    if (on && !ambientNode) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 38; // low hum
      g.gain.value = 0.03;
      o.connect(g).connect(ctx.destination);
      o.start();
      ambientNode = { stop: () => { try { o.stop(); g.disconnect(); } catch {} ambientNode = null; } };
    } else if (!on && ambientNode) {
      ambientNode.stop(); ambientNode = null;
    }
  }
  function playFootstep() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200 + Math.random() * 60, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.02, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.2);
  }
  function playJumpscare() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(90, now);
    o.frequency.exponentialRampToValueAtTime(600, now + 0.25);
    g.gain.setValueAtTime(0.0005, now);
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.00001, now + 1.1);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 1.2);
  }
  function playWin() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(440, now);
    o.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    g.gain.setValueAtTime(0.0004, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.00001, now + 0.8);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.9);
  }
  function dispose() { if (ambientNode) ambientNode.stop(); try { ctx?.close(); } catch {} }
  return { setAmbient, playFootstep, playJumpscare, playWin, dispose };
}
