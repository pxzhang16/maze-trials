import type { GameState, Box, Robot, Vec2 } from './types';
import { TILE_SIZE, COLORS } from './constants';

export interface Renderer {
  render(state: GameState, levelName: string): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')!;

  function render(state: GameState, levelName: string): void {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = state.width * TILE_SIZE;
    const logicalH = state.height * TILE_SIZE + 50;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, logicalW, logicalH);

    drawGrid(ctx, state);
    drawSafeZoneOverlay(ctx, state);
    drawBoxes(ctx, state);
    drawAttachmentLines(ctx, state);
    drawRobots(ctx, state);

    // In winPhase >= 1, draw R3 as a healthy beetle (revived)
    if (state.winPhase >= 1) {
      const r3 = state.boxes.find(b => b.isRedBuddy);
      if (r3) {
        const px = r3.pos.x * TILE_SIZE, py = r3.pos.y * TILE_SIZE;
        ctx.fillStyle = COLORS.exit;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        drawBeetle(ctx, px + TILE_SIZE / 2, py + TILE_SIZE / 2,
          TILE_SIZE * 0.456, '#1a6b2a', 'R3', 0, false);
      }
    }

    // Selection ring drawn LAST — always on top of everything
    drawSelectionRing(ctx, state);

    drawHUD(ctx, state, levelName);

    if (state.winPhase >= 2) {
      drawWinOverlay(ctx, state);
    }
  }

  return { render };
}

// --- Grid ---
function drawGrid(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const tile = state.grid[y][x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      switch (tile) {
        case 'wall':
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Light edge for 3D effect
          ctx.fillStyle = COLORS.wallLight;
          ctx.fillRect(px, py, TILE_SIZE, 3);
          ctx.fillRect(px, py, 3, TILE_SIZE);
          break;
        case 'floor':
          ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case 'exit':
          ctx.fillStyle = COLORS.exit;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Draw exit arrow / marker
          ctx.fillStyle = COLORS.exitGlow;
          ctx.font = `bold ${TILE_SIZE * 0.22}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('REPAIR', px + TILE_SIZE / 2, py + TILE_SIZE / 2 - TILE_SIZE * 0.1);
          ctx.fillText('ROOM', px + TILE_SIZE / 2, py + TILE_SIZE / 2 + TILE_SIZE * 0.15);
          break;
      }
    }
  }
}

// --- Safe zone overlay ---
function drawSafeZoneOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Draw semi-transparent green on safe zone tiles (except exit itself)
  for (const s of state.safeZone) {
    if (state.grid[s.y][s.x] === 'exit') continue;
    const px = s.x * TILE_SIZE, py = s.y * TILE_SIZE;
    ctx.fillStyle = 'rgba(60, 180, 80, 0.2)';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  }

  // Label "HOME" centered on the safe zone
  if (state.safeZone.length > 0) {
    const ex = state.exitPos.x, ey = state.exitPos.y;
    // Place "HOME" below the repair room (bottom row of safe zone)
    const labelX = (ex + 0.5) * TILE_SIZE;
    const labelY = (ey + 1.7) * TILE_SIZE;
    ctx.fillStyle = 'rgba(60, 180, 80, 0.6)';
    ctx.font = `bold ${TILE_SIZE * 0.32}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HOME', labelX, labelY);
  }
}

// --- Boxes ---
function drawBoxes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const box of state.boxes) {
    drawBox(ctx, box);
  }
}

function drawBox(ctx: CanvasRenderingContext2D, box: Box): void {
  const px = box.pos.x * TILE_SIZE;
  const py = box.pos.y * TILE_SIZE;
  const margin = 6;
  const size = TILE_SIZE - margin * 2;

  if (box.isRedBuddy) {
    // Red cargo box
    ctx.fillStyle = COLORS.boxRedBuddy;
    roundRect(ctx, px + margin, py + margin, size, size, 6);
    ctx.fill();
    ctx.strokeStyle = COLORS.boxRedBuddyStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Beetle inside the box (same size as R1/R2, collapsed = unconscious)
    drawBeetle(
      ctx,
      px + TILE_SIZE / 2,
      py + TILE_SIZE / 2,
      TILE_SIZE * 0.456,
      '#cc8888',
      'R3',
      0,
      true
    );
  } else {
    // Normal cardboard box
    ctx.fillStyle = COLORS.boxNormal;
    roundRect(ctx, px + margin, py + margin, size, size, 6);
    ctx.fill();
    ctx.strokeStyle = COLORS.boxNormalStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cardboard cross lines
    ctx.beginPath();
    ctx.moveTo(px + margin, py + TILE_SIZE / 2);
    ctx.lineTo(px + TILE_SIZE - margin, py + TILE_SIZE / 2);
    ctx.moveTo(px + TILE_SIZE / 2, py + margin);
    ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE - margin);
    ctx.strokeStyle = COLORS.boxNormalStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Facing direction to rotation angle (0 = up)
const FACING_ANGLE: Record<string, number> = {
  up: 0,
  right: Math.PI / 2,
  down: Math.PI,
  left: -Math.PI / 2,
};

// Draw a hexapod robot seen from top-down (MINIHEXA style)
// Drawn facing UP in local coords, then rotated by `rot`
function drawBeetle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  label: string,
  rot: number = 0,
  collapsed: boolean = false
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const bodyR = r * 0.5;

  // --- 6 legs, 3 per side ---
  const legOffsets = [-0.55, 0, 0.55];
  // Collapsed = legs curled inward (unconscious) but still visible
  const seg1 = collapsed ? r * 0.2 : r * 0.28;
  const seg2 = collapsed ? r * 0.16 : r * 0.22;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const oy of legOffsets) {
    for (const side of [-1, 1]) {
      const hipX = side * bodyR * 0.8;
      const hipY = oy * bodyR * 1.6;
      const kneeX = hipX + side * seg1;
      const kneeY = hipY + (collapsed ? seg1 * 0.5 : oy * 0.15 * seg1);
      const footX = collapsed ? kneeX - side * seg2 * 0.5 : kneeX + side * seg2;
      const footY = kneeY + (collapsed ? seg2 * 0.8 : seg2 * 0.4);

      // Shadow
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(footX, footY);
      ctx.stroke();
      // Main leg
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(footX, footY);
      ctx.stroke();
      // Joint & foot
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Antennae at the front ---
  const antennaRootY = -bodyR * 0.68;
  const antennaTipY = -bodyR * (collapsed ? 1.08 : 1.38);
  const antennaSpread = bodyR * 0.14;
  const antennaCurl = bodyR * (collapsed ? 0.12 : 0.28);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(side * antennaSpread, antennaRootY);
    ctx.quadraticCurveTo(
      side * (antennaSpread + antennaCurl * 0.75),
      -bodyR * 1.02,
      side * (antennaSpread + antennaCurl),
      antennaTipY
    );
  }
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(side * antennaSpread, antennaRootY);
    ctx.quadraticCurveTo(
      side * (antennaSpread + antennaCurl * 0.75),
      -bodyR * 1.02,
      side * (antennaSpread + antennaCurl),
      antennaTipY
    );
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * (antennaSpread + antennaCurl), antennaTipY, bodyR * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Round body ---
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner ring detail
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, bodyR * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  // --- Eyes at front (top in local coords) ---
  const eyeY = -bodyR * 0.55;
  const eyeSpread = bodyR * 0.35;
  const eyeR = bodyR * 0.18;
  if (collapsed) {
    // Half-shut eyes (unconscious)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-eyeSpread, eyeY, eyeR * 0.7, 0, Math.PI * 2);
    ctx.arc(eyeSpread, eyeY, eyeR * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // Closed line
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-eyeSpread - eyeR * 0.5, eyeY);
    ctx.lineTo(-eyeSpread + eyeR * 0.5, eyeY);
    ctx.moveTo(eyeSpread - eyeR * 0.5, eyeY);
    ctx.lineTo(eyeSpread + eyeR * 0.5, eyeY);
    ctx.stroke();
  } else {
    // Normal open eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-eyeSpread, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeSpread, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-eyeSpread, eyeY - eyeR * 0.15, eyeR * 0.5, 0, Math.PI * 2);
    ctx.arc(eyeSpread, eyeY - eyeR * 0.15, eyeR * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Label (counter-rotate so text stays upright) ---
  ctx.rotate(-rot);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${r * 0.456}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, bodyR * 0.2);

  ctx.restore();
}

// --- Robots ---
function drawRobots(ctx: CanvasRenderingContext2D, state: GameState): void {
  state.robots.forEach((robot, i) => {
    drawRobot(ctx, robot, i === state.selectedRobotIndex);
  });
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, state: GameState): void {
  const robot = state.robots[state.selectedRobotIndex];
  const cx = robot.pos.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = robot.pos.y * TILE_SIZE + TILE_SIZE / 2;
  const radius = TILE_SIZE * 0.456;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.robotSelected;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  robot: Robot,
  _isSelected: boolean
): void {
  const cx = robot.pos.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = robot.pos.y * TILE_SIZE + TILE_SIZE / 2;
  const radius = TILE_SIZE * 0.456;
  const color = robot.id === 'R1' ? COLORS.robotA : COLORS.robotC;

  drawBeetle(ctx, cx, cy, radius, color, robot.id, FACING_ANGLE[robot.facing] ?? 0);

  // Attachment indicator (small dot)
  if (robot.attachedBoxIndex !== null) {
    ctx.beginPath();
    ctx.arc(cx + radius * 0.7, cy - radius * 0.7, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.attachLine;
    ctx.fill();
  }
}

// --- Attachment Lines ---
function drawAttachmentLines(
  ctx: CanvasRenderingContext2D,
  state: GameState
): void {
  for (const robot of state.robots) {
    if (robot.attachedBoxIndex !== null) {
      const box = state.boxes[robot.attachedBoxIndex];
      if (box) {
        drawDashedLine(ctx, robot.pos, box.pos);
      }
    }
  }
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2
): void {
  const fx = from.x * TILE_SIZE + TILE_SIZE / 2;
  const fy = from.y * TILE_SIZE + TILE_SIZE / 2;
  const tx = to.x * TILE_SIZE + TILE_SIZE / 2;
  const ty = to.y * TILE_SIZE + TILE_SIZE / 2;

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = COLORS.attachLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.restore();
}

// --- HUD (drawn below the grid) ---
function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  levelName: string
): void {
  const hudY = state.height * TILE_SIZE;
  const hudH = 50;
  const canvasW = state.width * TILE_SIZE;

  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(0, hudY, canvasW, hudH);

  const fontSize = Math.min(16, canvasW / 22);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textBaseline = 'middle';
  const cy = hudY + hudH / 2;

  const selRobot = state.robots[state.selectedRobotIndex];
  const robotColor = selRobot.id === 'R1' ? COLORS.robotA : COLORS.robotC;
  const attached = selRobot.attachedBoxIndex !== null;

  if (canvasW < 400) {
    // Compact: two items only — robot status (left) + steps (right)
    ctx.fillStyle = robotColor;
    ctx.textAlign = 'left';
    ctx.fillText('Robot: ' + selRobot.id + (attached ? ' LINK' : ''), 10, cy);

    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = 'right';
    ctx.fillText(`${state.steps} steps`, canvasW - 10, cy);
  } else {
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = 'left';
    ctx.fillText(levelName, 10, cy);

    ctx.fillStyle = robotColor;
    ctx.textAlign = 'center';
    ctx.fillText(
      `${selRobot.id}` + (attached ? ' [ATTACHED]' : ''),
      canvasW / 2,
      cy
    );

    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = 'right';
    ctx.fillText(`Steps: ${state.steps}`, canvasW - 10, cy);
  }
}

// --- Win Overlay ---
function drawWinOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState
): void {
  const w = state.width * TILE_SIZE;
  const h = state.height * TILE_SIZE;

  ctx.fillStyle = COLORS.winOverlay;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = COLORS.winText;
  ctx.font = `bold ${TILE_SIZE * 0.6}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R3 REPAIRED!', w / 2, h / 2 - 20);

  ctx.font = `${TILE_SIZE * 0.3}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('All robots safe! Press N for next level', w / 2, h / 2 + 25);
}

// --- Utility: rounded rectangle ---
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
