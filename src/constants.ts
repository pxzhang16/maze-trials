const MAX_TILE_SIZE = 64;
const HUD_HEIGHT = 50;

export let TILE_SIZE = MAX_TILE_SIZE;

export function computeTileSize(levelWidth: number, levelHeight: number, availableHeight?: number): void {
  const maxW = window.innerWidth * 0.95;
  const maxH = availableHeight ?? window.innerHeight * 0.55;
  const fitW = Math.floor(maxW / levelWidth);
  const fitH = Math.floor(maxH / (levelHeight + HUD_HEIGHT / MAX_TILE_SIZE));
  TILE_SIZE = Math.min(MAX_TILE_SIZE, fitW, fitH);
  if (TILE_SIZE < 16) TILE_SIZE = 16;
}

export const COLORS = {
  wall: '#3a3a4a',
  wallLight: '#4a4a5a',
  floor: '#c8c0b0',
  floorAlt: '#c0b8a8',
  exit: '#40c040',
  exitGlow: '#60e060',
  boxNormal: '#b07830',
  boxNormalStroke: '#7a5020',
  boxRedBuddy: '#d03030',
  boxRedBuddyStroke: '#901818',
  robotA: '#4090e0',
  robotC: '#e0a030',
  robotSelected: '#ffffff',
  attachLine: '#ff60ff',
  hudBg: 'rgba(0,0,0,0.75)',
  hudText: '#ffffff',
  winOverlay: 'rgba(0,0,0,0.6)',
  winText: '#40ff40',
};
