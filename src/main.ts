import { LEVELS } from './levels';
import { createStateFromLevel } from './state';
import { applyAction } from './logic';
import { setupInput } from './input';
import { createRenderer } from './renderer';
import { solve } from './solver';
import type { GameAction } from './types';
import type { SolverAction } from './solver';
import './style.css';

let currentLevelIndex = 0;
let state = createStateFromLevel(LEVELS[currentLevelIndex]);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const solveBtn = document.getElementById('solve-btn') as HTMLButtonElement;
const levelSelectDiv = document.getElementById('level-select') as HTMLDivElement;

let playbackTimer: ReturnType<typeof setInterval> | null = null;

// --- Level select buttons ---
function buildLevelSelect(): void {
  levelSelectDiv.innerHTML = '';
  LEVELS.forEach((level, i) => {
    const btn = document.createElement('button');
    btn.textContent = `L${i + 1}`;
    btn.title = level.name;
    if (i === currentLevelIndex) btn.classList.add('active');
    btn.addEventListener('click', () => {
      stopPlayback();
      currentLevelIndex = i;
      state = createStateFromLevel(LEVELS[currentLevelIndex]);
      buildLevelSelect();
      render();
    });
    levelSelectDiv.appendChild(btn);
  });
}

function stopPlayback(): void {
  if (playbackTimer !== null) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  solveBtn.textContent = 'AI SOLVE';
  solveBtn.disabled = false;
}

function handleAction(action: GameAction): void {
  if (action.type === 'reset') {
    stopPlayback();
    state = createStateFromLevel(LEVELS[currentLevelIndex]);
    render();
    return;
  }

  if (action.type === 'nextLevel') {
    stopPlayback();
    if (state.won && currentLevelIndex < LEVELS.length - 1) {
      currentLevelIndex++;
      state = createStateFromLevel(LEVELS[currentLevelIndex]);
      buildLevelSelect();
    }
    render();
    return;
  }

  if (state.won || playbackTimer !== null) return;

  applyAction(state, action);
  render();
  if (state.won) startWinSequence();
}

function render(): void {
  renderer.render(state, LEVELS[currentLevelIndex].name);
}

function startWinSequence(): void {
  // Phase 1: after 2s, R3 revives (box disappears, healthy beetle)
  setTimeout(() => {
    state.winPhase = 1;
    render();
    // Phase 2: after 2 more seconds, show victory overlay
    setTimeout(() => {
      state.winPhase = 2;
      render();
    }, 2000);
  }, 2000);
}

function startPlayback(actions: SolverAction[]): void {
  state = createStateFromLevel(LEVELS[currentLevelIndex]);
  render();

  let i = 0;
  solveBtn.textContent = `REPLAYING 0/${actions.length}`;

  playbackTimer = setInterval(() => {
    if (i >= actions.length) {
      stopPlayback();
      if (state.won) startWinSequence();
      return;
    }

    // Apply exactly as a human player would — no implicit manipulation
    applyAction(state, actions[i] as GameAction);
    i++;
    solveBtn.textContent = `REPLAYING ${i}/${actions.length}`;
    render();
  }, 400);
}

solveBtn.addEventListener('click', () => {
  if (playbackTimer !== null) return;

  solveBtn.textContent = 'SOLVING...';
  solveBtn.disabled = true;

  setTimeout(() => {
    const t0 = performance.now();
    const freshState = createStateFromLevel(LEVELS[currentLevelIndex]);
    const solution = solve(freshState, {
      seed: Date.now(),
      attempts: 3,
      perAttemptTimeoutMs: 10_000,
      randomness: 0.001,
    });
    const dt = performance.now() - t0;

    if (solution) {
      console.log(`Solved in ${dt.toFixed(0)}ms, ${solution.length} steps`);
      startPlayback(solution);
    } else {
      console.log(`No solution found (${dt.toFixed(0)}ms)`);
      solveBtn.textContent = 'NO SOLUTION';
      setTimeout(() => {
        solveBtn.textContent = 'AI SOLVE';
        solveBtn.disabled = false;
      }, 2000);
    }
  }, 50);
});

setupInput(handleAction);
buildLevelSelect();

// Touch controls
document.querySelectorAll<HTMLButtonElement>('.tc-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    switch (action) {
      case 'up': handleAction({ type: 'move', direction: 'up' }); break;
      case 'down': handleAction({ type: 'move', direction: 'down' }); break;
      case 'left': handleAction({ type: 'move', direction: 'left' }); break;
      case 'right': handleAction({ type: 'move', direction: 'right' }); break;
      case 'select-r1': handleAction({ type: 'selectRobot', id: 'R1' }); break;
      case 'select-r2': handleAction({ type: 'selectRobot', id: 'R2' }); break;
      case 'attach': handleAction({ type: 'toggleAttach' }); break;
      case 'reset': handleAction({ type: 'reset' }); break;
      case 'next': handleAction({ type: 'nextLevel' }); break;
    }
  });
});

render();
