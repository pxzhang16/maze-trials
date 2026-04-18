import { applyAction } from '../logic';
import type { SolverAction } from '../solver';
import type { Direction, GameAction, GameState, RobotId } from '../types';
import type { DialogueMoment, MomentSemantic } from './types';

const DIR_CN: Record<Direction, string> = {
  up: '上',
  down: '下',
  left: '左',
  right: '右',
};

const MIN_RUN_LENGTH = 3;
const MERGE_WINDOW = 2;

const MAX_ROBOT_SWITCH = 3;
const MAX_BEFORE_LONG_PUSH = 3;

interface Run {
  startIndex: number;
  length: number;
  direction: Direction;
  robot: RobotId;
}

interface Snapshot {
  selectedRobot: RobotId;
  attachedBoxIndex: [number | null, number | null]; // by [R1, R2]
  boxPositions: { x: number; y: number }[];
}

// Deep-clone and replay actions; snapshots[i] = state BEFORE action i.
// snapshots[actions.length] = final state after all actions.
function simulate(initialState: GameState, actions: SolverAction[]): Snapshot[] {
  const state: GameState = JSON.parse(JSON.stringify(initialState));
  const snapshots: Snapshot[] = [];
  for (let i = 0; i < actions.length; i++) {
    snapshots.push(capture(state));
    applyAction(state, actions[i] as GameAction);
  }
  snapshots.push(capture(state));
  return snapshots;
}

function capture(state: GameState): Snapshot {
  return {
    selectedRobot: state.robots[state.selectedRobotIndex].id,
    attachedBoxIndex: [state.robots[0].attachedBoxIndex, state.robots[1].attachedBoxIndex],
    boxPositions: state.boxes.map((b) => ({ x: b.pos.x, y: b.pos.y })),
  };
}

function isRedBox(state: GameState, boxIdx: number | null): boolean {
  if (boxIdx === null) return false;
  return state.boxes[boxIdx]?.isRedBuddy ?? false;
}

function detectRuns(actions: SolverAction[]): Run[] {
  const runs: Run[] = [];
  let currentRobot: RobotId = 'R1';
  let runStart = -1;
  let runDir: Direction | null = null;
  let runLen = 0;

  const flush = () => {
    if (runDir !== null && runLen >= MIN_RUN_LENGTH && runStart >= 0) {
      runs.push({ startIndex: runStart, length: runLen, direction: runDir, robot: currentRobot });
    }
    runDir = null;
    runLen = 0;
    runStart = -1;
  };

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === 'selectRobot') {
      flush();
      currentRobot = a.id;
      continue;
    }
    if (a.type === 'toggleAttach') {
      flush();
      continue;
    }
    if (a.type === 'move') {
      if (runDir === a.direction) {
        runLen++;
      } else {
        flush();
        runDir = a.direction;
        runLen = 1;
        runStart = i;
      }
    }
  }
  flush();
  return runs;
}

// During a run [start, start+length), check whether any box position changed
// between snapshots[start] and snapshots[start+length]. Returns the box index
// that moved (or null), and whether it's the red box.
function detectPushTarget(
  initialState: GameState,
  snapshots: Snapshot[],
  run: Run,
): { kind: 'red_r3' | 'normal' | 'none'; boxIdx: number | null } {
  const before = snapshots[run.startIndex];
  const after = snapshots[run.startIndex + run.length];
  for (let bi = 0; bi < before.boxPositions.length; bi++) {
    const a = before.boxPositions[bi];
    const b = after.boxPositions[bi];
    if (a.x !== b.x || a.y !== b.y) {
      return { kind: isRedBox(initialState, bi) ? 'red_r3' : 'normal', boxIdx: bi };
    }
  }
  return { kind: 'none', boxIdx: null };
}

// Look ahead from a selectRobot to figure out why we switched.
function detectSwitchReason(
  actions: SolverAction[],
  switchIndex: number,
): MomentSemantic['switchReason'] {
  for (let i = switchIndex + 1; i < actions.length && i < switchIndex + 6; i++) {
    const a = actions[i];
    if (a.type === 'toggleAttach') return 'next_robot_attached';
    if (a.type === 'move') return 'next_robot_walks';
    if (a.type === 'selectRobot') return 'unknown';
  }
  return 'unknown';
}

function dedupeAdjacent(moments: DialogueMoment[]): DialogueMoment[] {
  const out: DialogueMoment[] = [];
  for (const m of moments) {
    const last = out[out.length - 1];
    if (
      last &&
      last.trigger === m.trigger &&
      m.triggerActionIndex - last.triggerActionIndex < MERGE_WINDOW
    ) {
      continue;
    }
    out.push(m);
  }
  return out;
}

function evenSample<T>(items: T[], maxKeep: number): T[] {
  if (items.length <= maxKeep) return items;
  if (maxKeep <= 0) return [];
  if (maxKeep === 1) return [items[Math.floor(items.length / 2)]];
  const step = (items.length - 1) / (maxKeep - 1);
  const kept: T[] = [];
  for (let i = 0; i < maxKeep; i++) {
    kept.push(items[Math.round(i * step)]);
  }
  return kept;
}

function applyCaps(moments: DialogueMoment[]): DialogueMoment[] {
  const byType: Record<string, DialogueMoment[]> = {};
  for (const m of moments) (byType[m.trigger] ||= []).push(m);

  const kept = new Set<DialogueMoment>();

  for (const m of byType.level_start || []) kept.add(m);
  for (const m of byType.level_clear || []) kept.add(m);
  for (const m of byType.before_tow || []) kept.add(m);
  for (const m of byType.rescuing_r3 || []) kept.add(m);

  for (const m of evenSample(byType.robot_switch || [], MAX_ROBOT_SWITCH)) kept.add(m);

  const pushes = (byType.before_long_push || []).slice().sort((a, b) => runLengthOf(b) - runLengthOf(a));
  for (const m of pushes.slice(0, MAX_BEFORE_LONG_PUSH)) kept.add(m);

  return moments.filter((m) => kept.has(m));
}

function runLengthOf(m: DialogueMoment): number {
  const match = /(\d+)\s*格/.exec(m.context.upcomingActions);
  return match ? parseInt(match[1], 10) : 0;
}

export function scanTriggers(
  actions: SolverAction[],
  levelIndex: number,
  initialState: GameState,
): DialogueMoment[] {
  const snapshots = simulate(initialState, actions);
  const moments: DialogueMoment[] = [];

  // 1. level_start
  moments.push({
    triggerActionIndex: 0,
    trigger: 'level_start',
    context: {
      activeRobot: 'R1',
      upcomingActions: `刚进入 Level ${levelIndex + 1}，准备开始解题`,
    },
  });

  // 2. robot_switch — every effective selectRobot
  let currentRobot: RobotId = 'R1';
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === 'selectRobot' && a.id !== currentRobot) {
      currentRobot = a.id;
      const reason = detectSwitchReason(actions, i);
      const reasonText =
        reason === 'next_robot_attached'
          ? `轮到 ${currentRobot}，需要它来抓取/拉一个箱子`
          : reason === 'next_robot_walks'
          ? `轮到 ${currentRobot}，它要直接走/推`
          : `轮到 ${currentRobot} 行动`;
      moments.push({
        triggerActionIndex: i,
        trigger: 'robot_switch',
        context: {
          activeRobot: currentRobot,
          upcomingActions: reasonText,
          semantic: { switchReason: reason },
        },
      });
    } else if (a.type === 'selectRobot') {
      currentRobot = a.id;
    }
  }

  // 3. before_tow / before_long_push from runs
  const runs = detectRuns(actions);
  for (const run of runs) {
    const robotIdx = run.robot === 'R1' ? 0 : 1;
    const attachedBefore = snapshots[run.startIndex].attachedBoxIndex[robotIdx];

    if (attachedBefore !== null) {
      // Tow run
      const kind: 'red_r3' | 'normal' = isRedBox(initialState, attachedBefore) ? 'red_r3' : 'normal';
      const objText = kind === 'red_r3' ? '红色 R3' : '普通箱';
      moments.push({
        triggerActionIndex: run.startIndex,
        trigger: 'before_tow',
        context: {
          activeRobot: run.robot,
          upcomingActions: `${run.robot} 拉着${objText}向${DIR_CN[run.direction]}走 ${run.length} 格`,
          semantic: { attachedBox: kind },
        },
      });
    } else {
      // Push or walk run — look at whether boxes moved during the run
      const push = detectPushTarget(initialState, snapshots, run);
      const targetText =
        push.kind === 'red_r3'
          ? `推着红色 R3 向${DIR_CN[run.direction]}前进 ${run.length} 格`
          : push.kind === 'normal'
          ? `推一个普通箱清路，向${DIR_CN[run.direction]}走 ${run.length} 格`
          : `自己走 ${run.length} 格，没推东西`;
      moments.push({
        triggerActionIndex: run.startIndex,
        trigger: 'before_long_push',
        context: {
          activeRobot: run.robot,
          upcomingActions: `${run.robot} ${targetText}`,
          semantic: { pushTarget: push.kind },
        },
      });
    }
  }

  // 4. rescuing_r3 — first toggleAttach where the resulting attached box is red
  let rescued = false;
  let trackingRobot: RobotId = 'R1';
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === 'selectRobot') {
      trackingRobot = a.id;
      continue;
    }
    if (a.type === 'toggleAttach' && !rescued) {
      const robotIdx = trackingRobot === 'R1' ? 0 : 1;
      const attachedAfter = snapshots[i + 1].attachedBoxIndex[robotIdx];
      if (attachedAfter !== null && isRedBox(initialState, attachedAfter)) {
        moments.push({
          triggerActionIndex: i,
          trigger: 'rescuing_r3',
          context: {
            activeRobot: trackingRobot,
            upcomingActions: `${trackingRobot} 终于抓到了 R3（红色箱），下一步开始往救援区拖`,
            semantic: { attachedBox: 'red_r3' },
          },
        });
        rescued = true;
      }
    }
  }

  // 5. level_clear — fires after the last action completes
  moments.push({
    triggerActionIndex: actions.length,
    trigger: 'level_clear',
    context: {
      activeRobot: currentRobot,
      upcomingActions: '他们成功把 R3 送回救援区，关卡通关',
    },
  });

  moments.sort((a, b) => a.triggerActionIndex - b.triggerActionIndex);
  return applyCaps(dedupeAdjacent(moments));
}
