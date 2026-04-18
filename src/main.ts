import { LEVELS } from './levels';
import { createStateFromLevel } from './state';
import { applyAction } from './logic';
import { setupInput } from './input';
import { createRenderer } from './renderer';
import { solve } from './solver';
import type { GameAction } from './types';
import type { SolverAction } from './solver';
import { scanTriggers } from './dialogue/triggers';
import { requestAllDialogues } from './dialogue/client';
import * as dialoguePanel from './dialogue/panel';
import type { DialogueLine, DialogueMoment } from './dialogue/types';
import './style.css';

const PLAYBACK_STEP_MS = 400;

let currentLevelIndex = 0;
let state = createStateFromLevel(LEVELS[currentLevelIndex]);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const solveBtn = document.getElementById('solve-btn') as HTMLButtonElement;
const levelSelectDiv = document.getElementById('level-select') as HTMLDivElement;

let playbackAbort: AbortController | null = null;

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
      dialoguePanel.reset();
      currentLevelIndex = i;
      state = createStateFromLevel(LEVELS[currentLevelIndex]);
      buildLevelSelect();
      render();
    });
    levelSelectDiv.appendChild(btn);
  });
}

function stopPlayback(): void {
  if (playbackAbort) {
    playbackAbort.abort();
    playbackAbort = null;
  }
  solveBtn.textContent = 'AI SOLVE';
  solveBtn.disabled = false;
}

function isPlaying(): boolean {
  return playbackAbort !== null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function handleAction(action: GameAction): void {
  if (action.type === 'reset') {
    stopPlayback();
    dialoguePanel.reset();
    state = createStateFromLevel(LEVELS[currentLevelIndex]);
    render();
    return;
  }

  if (action.type === 'nextLevel') {
    stopPlayback();
    if (state.won && currentLevelIndex < LEVELS.length - 1) {
      currentLevelIndex++;
      dialoguePanel.reset();
      state = createStateFromLevel(LEVELS[currentLevelIndex]);
      buildLevelSelect();
    }
    render();
    return;
  }

  if (state.won || isPlaying()) return;

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

// Per-playback dialogue cache: moment.triggerActionIndex -> lines
let dialogueCache: Map<number, DialogueLine[]> = new Map();
let playedMomentIndices: Set<number> = new Set();

async function renderMomentFromCache(
  moment: DialogueMoment,
  signal: AbortSignal,
): Promise<void> {
  const lines = dialogueCache.get(moment.triggerActionIndex) ?? [];
  for (const line of lines) {
    if (signal.aborted) return;
    await dialoguePanel.appendLine(line);
  }
  playedMomentIndices.add(moment.triggerActionIndex);
}

function startBackgroundRetry(
  moments: DialogueMoment[],
  levelIndex: number,
  signal: AbortSignal,
): void {
  void requestAllDialogues(moments, levelIndex, signal).then((retry) => {
    if (signal.aborted) return;
    if (retry.usedFallback) {
      console.log('[dialogue] background retry also failed; keeping fallback');
      return;
    }
    let swapped = 0;
    for (const m of moments) {
      if (playedMomentIndices.has(m.triggerActionIndex)) continue;
      const lines = retry.cache.get(m.triggerActionIndex);
      if (lines) {
        dialogueCache.set(m.triggerActionIndex, lines);
        swapped++;
      }
    }
    console.log(`[dialogue] background retry succeeded; swapped ${swapped} unrendered moments`);
  });
}

async function startPlayback(actions: SolverAction[]): Promise<void> {
  const initialState = createStateFromLevel(LEVELS[currentLevelIndex]);
  const moments = scanTriggers(actions, currentLevelIndex, initialState);
  const momentsByIndex = new Map<number, DialogueMoment>();
  for (const m of moments) momentsByIndex.set(m.triggerActionIndex, m);

  const ctrl = new AbortController();
  playbackAbort = ctrl;
  const signal = ctrl.signal;

  dialoguePanel.reset();
  state = createStateFromLevel(LEVELS[currentLevelIndex]);
  render();
  dialogueCache = new Map();
  playedMomentIndices = new Set();

  // Pre-fetch all dialogue in one LLM call.
  solveBtn.textContent = '生成对话...';
  const t0 = performance.now();
  const batch = await requestAllDialogues(moments, currentLevelIndex, signal);
  const dt = performance.now() - t0;
  console.log(
    `[dialogue] prefetch ${moments.length} moments in ${dt.toFixed(0)}ms` +
      (batch.usedFallback ? ' (fallback)' : ' (LLM)'),
  );
  if (signal.aborted) {
    if (playbackAbort === ctrl) playbackAbort = null;
    solveBtn.textContent = 'AI SOLVE';
    solveBtn.disabled = false;
    return;
  }
  dialogueCache = batch.cache;
  if (batch.usedFallback) startBackgroundRetry(moments, currentLevelIndex, signal);

  solveBtn.textContent = `REPLAYING 0/${actions.length}`;

  try {
    for (let i = 0; i <= actions.length; i++) {
      if (signal.aborted) return;

      const moment = momentsByIndex.get(i);
      if (moment) await renderMomentFromCache(moment, signal);
      if (signal.aborted) return;

      if (i === actions.length) break;

      applyAction(state, actions[i] as GameAction);
      render();
      solveBtn.textContent = `REPLAYING ${i + 1}/${actions.length}`;

      await sleep(PLAYBACK_STEP_MS, signal);
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('[playback] unexpected error', err);
    }
    return;
  } finally {
    if (playbackAbort === ctrl) playbackAbort = null;
    solveBtn.textContent = 'AI SOLVE';
    solveBtn.disabled = false;
  }

  if (state.won) startWinSequence();
}

solveBtn.addEventListener('click', () => {
  if (isPlaying()) return;

  solveBtn.textContent = 'SOLVING...';
  solveBtn.disabled = true;

  setTimeout(() => {
    const t0 = performance.now();
    const freshState = createStateFromLevel(LEVELS[currentLevelIndex]);
    const solution = solve(freshState);
    const dt = performance.now() - t0;

    if (solution) {
      console.log(`Solved in ${dt.toFixed(0)}ms, ${solution.length} steps`);
      void startPlayback(solution);
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
