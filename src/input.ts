import type { GameAction, Direction } from './types';
import { TILE_SIZE } from './constants';

export function setupInput(
  onAction: (action: GameAction) => void,
  canvas: HTMLCanvasElement,
  onTap: (gridX: number, gridY: number) => void,
): void {
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowUp':
        onAction({ type: 'move', direction: 'up' });
        e.preventDefault();
        break;
      case 'ArrowDown':
        onAction({ type: 'move', direction: 'down' });
        e.preventDefault();
        break;
      case 'ArrowLeft':
        onAction({ type: 'move', direction: 'left' });
        e.preventDefault();
        break;
      case 'ArrowRight':
        onAction({ type: 'move', direction: 'right' });
        e.preventDefault();
        break;
      case 'q':
      case 'Q':
        onAction({ type: 'selectRobot', id: 'R1' });
        break;
      case 'e':
      case 'E':
        onAction({ type: 'selectRobot', id: 'R2' });
        break;
      case ' ':
        onAction({ type: 'toggleAttach' });
        e.preventDefault();
        break;
      case 'r':
      case 'R':
        onAction({ type: 'reset' });
        break;
      case 'n':
      case 'N':
        onAction({ type: 'nextLevel' });
        break;
    }
  });

  function canvasPosToGrid(clientX: number, clientY: number): { gx: number; gy: number } {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((clientX - rect.left) / rect.width * (canvas.width / (window.devicePixelRatio || 1)) / TILE_SIZE);
    const gy = Math.floor((clientY - rect.top) / rect.height * (canvas.height / (window.devicePixelRatio || 1)) / TILE_SIZE);
    return { gx, gy };
  }

  canvas.addEventListener('click', (e) => {
    const { gx, gy } = canvasPosToGrid(e.clientX, e.clientY);
    onTap(gx, gy);
  });

  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 30;
  const TAP_MAX_DIST = 15;

  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < TAP_MAX_DIST && absDy < TAP_MAX_DIST) {
      const { gx, gy } = canvasPosToGrid(t.clientX, t.clientY);
      onTap(gx, gy);
      e.preventDefault();
      return;
    }

    if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return;

    let direction: Direction;
    if (absDx > absDy) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dy > 0 ? 'down' : 'up';
    }
    onAction({ type: 'move', direction });
    e.preventDefault();
  }, { passive: false });
}
