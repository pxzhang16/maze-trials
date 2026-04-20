import type { GameState, Direction } from './types';
import { applyAction } from './logic';

// Solver outputs real GameActions — identical to human player input
export type SolverAction =
  | { type: 'move'; direction: Direction }
  | { type: 'selectRobot'; id: 'R1' | 'R2' }
  | { type: 'toggleAttach' };

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const DIR_NAMES: Direction[] = ['up', 'down', 'left', 'right'];

class MinHeap {
  private d: [number, number][] = [];
  get size(): number { return this.d.length; }
  push(pri: number, val: number): void {
    this.d.push([pri, val]);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[i][0] >= this.d[p][0]) break;
      [this.d[i], this.d[p]] = [this.d[p], this.d[i]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top = this.d[0];
    const last = this.d.pop()!;
    if (this.d.length > 0) {
      this.d[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < this.d.length && this.d[l][0] < this.d[m][0]) m = l;
        if (r < this.d.length && this.d[r][0] < this.d[m][0]) m = r;
        if (m === i) break;
        [this.d[i], this.d[m]] = [this.d[m], this.d[i]];
        i = m;
      }
    }
    return top;
  }
}

// ============================================================
// Macro-move solver using connected-component abstraction.
// State key = (compSig, canonicalBoxPositions) where compSig
// encodes the component IDs of both robots (unlabeled pair).
// Exact robot positions stored as witnesses in witnessMap.
// Transition = one robot walks to a box and pushes/pulls it.
// ============================================================
export function solve(gameState: GameState): SolverAction[] | null {
  const W = gameState.width;
  const H = gameState.height;
  const M = W * H;
  const exitIdx = gameState.exitPos.y * W + gameState.exitPos.x;
  const redIdx = gameState.boxes.findIndex((b) => b.isRedBuddy);
  const nBox = gameState.boxes.length;
  const nNormal = nBox - 1;

  const wall = new Uint8Array(M);
  const safe = new Uint8Array(M);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (gameState.grid[y][x] === 'wall') wall[y * W + x] = 1;
  for (const s of gameState.safeZone) safe[s.y * W + s.x] = 1;

  // Map non-wall cells to compact IDs 0..F-1
  const cellToId = new Int16Array(M).fill(-1);
  const idToCell: number[] = [];
  for (let i = 0; i < M; i++) {
    if (!wall[i]) {
      cellToId[i] = idToCell.length;
      idToCell.push(i);
    }
  }
  const F = idToCell.length; // number of floor cells

  const distToExit = new Int16Array(M).fill(-1);
  {
    const q: number[] = [exitIdx];
    distToExit[exitIdx] = 0;
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      const nd = distToExit[c] + 1;
      const cx = c % W, cy = (c - cx) / W;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (!wall[ni] && distToExit[ni] === -1) { distToExit[ni] = nd; q.push(ni); }
      }
    }
  }

  // --- Dijkstra heuristic from R3: h = (dist[exit] + K*blockers) * W, W=3 ---
  const DIJK_K = 10;
  const djDist = new Int16Array(M);
  // Mini binary heap for Dijkstra on ~60 nodes
  const djHeap: number[] = new Array(M * 2); // interleaved [cost, node]
  let djHeapLen = 0;
  function djPush(cost: number, node: number) {
    let i = djHeapLen++;
    djHeap[i * 2] = cost; djHeap[i * 2 + 1] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (djHeap[i * 2] >= djHeap[p * 2]) break;
      // swap
      const tc = djHeap[i*2], tn = djHeap[i*2+1];
      djHeap[i*2] = djHeap[p*2]; djHeap[i*2+1] = djHeap[p*2+1];
      djHeap[p*2] = tc; djHeap[p*2+1] = tn;
      i = p;
    }
  }
  function djPop(): [number, number] {
    const cost = djHeap[0], node = djHeap[1];
    djHeapLen--;
    if (djHeapLen > 0) {
      djHeap[0] = djHeap[djHeapLen*2]; djHeap[1] = djHeap[djHeapLen*2+1];
      let i = 0;
      while (true) {
        let m = i; const l = 2*i+1, r = 2*i+2;
        if (l < djHeapLen && djHeap[l*2] < djHeap[m*2]) m = l;
        if (r < djHeapLen && djHeap[r*2] < djHeap[m*2]) m = r;
        if (m === i) break;
        const tc = djHeap[i*2], tn = djHeap[i*2+1];
        djHeap[i*2] = djHeap[m*2]; djHeap[i*2+1] = djHeap[m*2+1];
        djHeap[m*2] = tc; djHeap[m*2+1] = tn;
        i = m;
      }
    }
    return [cost, node];
  }

  function dijkstraFromR3(boxes: number[], r1: number, r2: number): number {
    const r3pos = boxes[redIdx];
    djDist.fill(32767);
    djDist[r3pos] = 0;
    djHeapLen = 0;
    djPush(0, r3pos);
    // Track which targets we've found
    let distR1 = 32767, distR2 = 32767, distExit = 32767;
    let found = 0;
    while (djHeapLen > 0 && found < 3) {
      const [cost, c] = djPop();
      if (cost > djDist[c]) continue;
      if (c === r1 && distR1 === 32767) { distR1 = cost; found++; }
      if (c === r2 && distR2 === 32767) { distR2 = cost; found++; }
      if (c === exitIdx && distExit === 32767) { distExit = cost; found++; }
      if (found >= 3) break;
      const cx = c % W, cy = (c - cx) / W;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (wall[ni]) continue;
        let edgeCost = 1;
        for (let j = 0; j < nBox; j++) {
          if (j !== redIdx && boxes[j] === ni) { edgeCost = 1 + DIJK_K; break; }
        }
        const nc = cost + edgeCost;
        if (nc < djDist[ni]) {
          djDist[ni] = nc;
          djPush(nc, ni);
        }
      }
    }
    return distR1 + distR2 + distExit;
  }

  // --- Connected-component abstraction for robot positions ---
  // Flood-fill free cells (not wall, not box) and label connected components.
  const compBuf = new Uint16Array(M);
  function computeComponents(boxes: number[]): Uint16Array {
    compBuf.fill(0);
    let label = 0;
    const q: number[] = [];
    for (let i = 0; i < M; i++) {
      if (wall[i] || compBuf[i] !== 0) continue;
      let isBox = false;
      for (let j = 0; j < nBox; j++) if (boxes[j] === i) { isBox = true; break; }
      if (isBox) continue;
      label++;
      compBuf[i] = label;
      q.length = 0;
      q.push(i);
      let h = 0;
      while (h < q.length) {
        const c = q[h++];
        const cx2 = c % W, cy2 = (c - cx2) / W;
        for (let dd = 0; dd < 4; dd++) {
          const nnx = cx2 + DX[dd], nny = cy2 + DY[dd];
          if (nnx < 0 || nnx >= W || nny < 0 || nny >= H) continue;
          const ni = nny * W + nnx;
          if (compBuf[ni] !== 0 || wall[ni]) continue;
          let niBox = false;
          for (let j = 0; j < nBox; j++) if (boxes[j] === ni) { niBox = true; break; }
          if (niBox) continue;
          compBuf[ni] = label;
          q.push(ni);
        }
      }
    }
    return compBuf;
  }

  // --- Precompute C(n,k) for combination encoding ---
  const maxCN = F + 1;
  const maxCK = nNormal + 1;
  const combC: number[][] = [];
  for (let n = 0; n <= maxCN; n++) {
    combC[n] = new Array(maxCK).fill(0);
    combC[n][0] = 1;
    for (let k = 1; k <= Math.min(n, maxCK - 1); k++) {
      combC[n][k] = combC[n-1][k-1] + combC[n-1][k];
    }
  }

  // Rank sorted array of k distinct values from 0..F-1
  function comboRank(sorted: number[], k: number): number {
    let rank = 0;
    for (let i = 0; i < k; i++) rank += combC[sorted[i]][i + 1];
    return rank;
  }

  // Unrank back to sorted array (uses pre-allocated buffer)
  const unrankBuf: number[] = new Array(nNormal);
  function comboUnrank(rank: number, k: number): number[] {
    const result = unrankBuf;
    let r = rank;
    for (let i = k - 1; i >= 0; i--) {
      let v = i;
      while (combC[v + 1][i + 1] <= r) v++;
      result[i] = v;
      r -= combC[v][i + 1];
    }
    return result;
  }

  // --- Abstract state encoding: [compSig, safeFlags, combo(normals), R3 floor ID] ---
  // compSig = min(c1,c2)*16 + max(c1,c2), max 256 values
  // safeFlags = 0-2 (unlabeled count of robots in safe zone)
  const nbuf: number[] = new Array(nNormal);
  const comboSize = combC[F][nNormal];

  function computeSafeFlags(r1: number, r2: number): number {
    return (safe[r1] ? 1 : 0) + (safe[r2] ? 1 : 0); // unlabeled: count, not which
  }

  function encodeAbstract(compSig: number, sf: number, boxes: number[]): number {
    const r3fid = cellToId[boxes[redIdx]];
    let ni = 0;
    for (let i = 0; i < nBox; i++)
      if (i !== redIdx) nbuf[ni++] = cellToId[boxes[i]];
    for (let i = 0; i < nNormal - 1; i++)
      for (let j = i + 1; j < nNormal; j++)
        if (nbuf[i] > nbuf[j]) { const t = nbuf[i]; nbuf[i] = nbuf[j]; nbuf[j] = t; }
    const cr = comboRank(nbuf, nNormal);
    // Pack: compSig * 3 * comboSize * F + sf * comboSize * F + cr * F + r3fid
    return (compSig * 3 + sf) * comboSize * F + cr * F + r3fid;
  }

  function decodeBoxes(k: number, outBoxes: number[]): void {
    const r3fid = k % F;
    let remainder = Math.floor(k / F);
    const cr = remainder % comboSize;
    // compSig = Math.floor(remainder / comboSize); // not needed for boxes

    outBoxes[redIdx] = idToCell[r3fid];
    const normalFids = comboUnrank(cr, nNormal);
    let ni = 0;
    for (let i = 0; i < nBox; i++) {
      if (i !== redIdx) outBoxes[i] = idToCell[normalFids[ni++]];
    }
  }

  // Witness map: abstract key -> packed(r1, r2) where packed = r1 * M + r2
  const witnessMap = new Map<number, number>();

  function packWitness(r1: number, r2: number): number { return r1 * M + r2; }
  function unpackWitness(packed: number): [number, number] {
    const r2 = packed % M;
    const r1 = (packed - r2) / M;
    return [r1, r2];
  }

  // Legacy decode for expandAndValidate — reconstructs exact positions from witnessMap
  function decodeStateFromWitness(key: number, outBoxes: number[]): [number, number] {
    decodeBoxes(key, outBoxes);
    const w = witnessMap.get(key);
    if (w === undefined) return [0, 0]; // should never happen
    return unpackWitness(w);
  }

  function pathToSafe(from: number, boxes: number[], otherRobot: number): number[] | null {
    if (safe[from]) return [];
    const visited = new Uint8Array(M);
    const prev = new Int32Array(M).fill(-1);
    const prevDir = new Int8Array(M).fill(-1);
    visited[from] = 1;
    const q: number[] = [from];
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      const cx = c % W, cy = (c - cx) / W;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (visited[ni] || wall[ni] || boxes.includes(ni) || ni === otherRobot) continue;
        visited[ni] = 1; prev[ni] = c; prevDir[ni] = d;
        if (safe[ni]) {
          const path: number[] = [];
          let p = ni;
          while (p !== from) { path.unshift(prevDir[p]); p = prev[p]; }
          return path;
        }
        q.push(ni);
      }
    }
    return null;
  }

  // --- A* Search ---
  const initR1 = gameState.robots[0].pos.y * W + gameState.robots[0].pos.x;
  const initR2 = gameState.robots[1].pos.y * W + gameState.robots[1].pos.x;
  const initBoxes: number[] = gameState.boxes.map(b => b.pos.y * W + b.pos.x);

  const initComp = computeComponents(initBoxes);
  const initC1 = initComp[initR1], initC2 = initComp[initR2];
  const initCompSig = Math.min(initC1, initC2) * 16 + Math.max(initC1, initC2);
  const initSF = computeSafeFlags(initR1, initR2);
  const initKey = encodeAbstract(initCompSig, initSF, initBoxes);

  const parent = new Map<number, number>();
  const actionInfo = new Map<number, number>();
  const gMap = new Map<number, number>();
  const heap = new MinHeap();
  const lastMove = new Map<number, number>();

  parent.set(initKey, -1);
  gMap.set(initKey, 0);
  witnessMap.set(initKey, packWitness(initR1, initR2));
  heap.push(dijkstraFromR3(initBoxes, initR1, initR2) * 3, initKey);
  lastMove.set(initKey, -1);

  // Pre-allocated buffers for BFS cache (avoid per-state allocation)
  const reachDistBufs = [new Int16Array(M), new Int16Array(M)];
  const bfsQBuf: number[] = [];

  const MAX = 3_000_000;
  const TIMEOUT = 10_000; // 10 seconds
  const startTime = performance.now();
  const bp: number[] = new Array(nBox);
  let explored = 0;

  while (heap.size > 0 && explored < MAX) {
    if ((explored & 0xFFF) === 0 && performance.now() - startTime > TIMEOUT) {
      console.log(`Solver: timeout after ${explored} states, ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
      return null;
    }
    const [, ck] = heap.pop();
    if (!gMap.has(ck)) continue;
    decodeBoxes(ck, bp);
    const [r1, r2] = unpackWitness(witnessMap.get(ck)!);
    explored++;

    // Compute components for current box layout
    const comp = computeComponents(bp);

    // Goal: R3 on exit + BOTH robots reachable to safe zone
    if (bp[redIdx] === exitIdx) {
      const c1 = comp[r1], c2 = comp[r2];
      let c1Safe = false, c2Safe = false;
      for (let i = 0; i < M; i++) {
        if (safe[i]) {
          if (comp[i] === c1) c1Safe = true;
          if (comp[i] === c2) c2Safe = true;
        }
      }
      if (c1Safe && c2Safe) {
        const actions = expandAndValidate(ck);
        if (actions) {
          console.log(`Solver: verified solution, ${explored} states, ${actions.length} actions`);
          return actions;
        }
      }
    }

    const g = gMap.get(ck)!;
    const rpos = [r1, r2];
    const prevMove = lastMove.get(ck)!;
    const prevBoxPos = prevMove >= 0 ? (prevMove >> 2) : -1;
    const prevDir = prevMove >= 0 ? (prevMove & 3) : -1;

    // BFS cache: compute reachability + distance for each robot once per state
    // Uses pre-allocated buffers to avoid per-state allocation
    reachDistBufs[0].fill(-1);
    reachDistBufs[1].fill(-1);
    for (let ri = 0; ri < 2; ri++) {
      const dist = reachDistBufs[ri];
      dist[rpos[ri]] = 0;
      bfsQBuf.length = 0;
      bfsQBuf.push(rpos[ri]);
      let bfsH = 0;
      while (bfsH < bfsQBuf.length) {
        const c = bfsQBuf[bfsH++];
        const nd = dist[c] + 1;
        const cx2 = c % W, cy2 = (c - cx2) / W;
        for (let dd = 0; dd < 4; dd++) {
          const nnx = cx2 + DX[dd], nny = cy2 + DY[dd];
          if (nnx < 0 || nnx >= W || nny < 0 || nny >= H) continue;
          const ni = nny * W + nnx;
          if (dist[ni] >= 0 || wall[ni] || ni === rpos[1 - ri]) continue;
          let isBox = false;
          for (let j = 0; j < nBox; j++) if (bp[j] === ni) { isBox = true; break; }
          if (isBox) continue;
          dist[ni] = nd;
          bfsQBuf.push(ni);
        }
      }
    }
    const reachDist = reachDistBufs;

    // For each robot, try macro moves (push/pull each box 1..N tiles)
    for (let ri = 0; ri < 2; ri++) {
      const robotPos = rpos[ri];
      const otherPos = rpos[1 - ri];
      const rDist = reachDist[ri];

      for (let bi = 0; bi < nBox; bi++) {
        const bpos0 = bp[bi];
        const bx0 = bpos0 % W, by0 = (bpos0 - bx0) / W;

        for (let d = 0; d < 4; d++) {
          const dx = DX[d], dy = DY[d];
          // Anti-reversal: don't undo the last box move
          if (prevBoxPos === bpos0 && d === (prevDir ^ 1)) continue;

          // --- PUSH slide: robot walks behind box, then pushes 1..N tiles ---
          const psx = bx0 - dx, psy = by0 - dy;
          if (psx >= 0 && psx < W && psy >= 0 && psy < H) {
            const pushFrom = psy * W + psx;
            if (!wall[pushFrom] && pushFrom !== otherPos) {
              let pfBlk = false;
              for (let j = 0; j < nBox; j++) if (j !== bi && bp[j] === pushFrom) { pfBlk = true; break; }
              if (!pfBlk) {
                if (rDist[pushFrom] < 0) continue; // unreachable
                {
                  const walkLen = rDist[pushFrom];
                  // Slide box 1..N tiles in direction d
                  let cx = bx0, cy = by0;
                  for (let n = 1; ; n++) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
                    const dest = ny * W + nx;
                    if (wall[dest]) break;
                    if (dest === otherPos) break;
                    if (bi !== redIdx && safe[dest]) break;
                    { let dup = false; for (let j = 0; j < nBox; j++) if (j !== bi && bp[j] === dest) { dup = true; break; } if (dup) break; }

                    const ng = g + walkLen + n;
                    const robotEnd = (cy * W + cx); // robot follows behind box
                    const newR1 = ri === 0 ? robotEnd : rpos[0];
                    const newR2 = ri === 1 ? robotEnd : rpos[1];
                    const saved = bp[bi]; bp[bi] = dest;
                    const newComp = computeComponents(bp);
                    const nc1 = newComp[newR1], nc2 = newComp[newR2];
                    const newCompSig = Math.min(nc1, nc2) * 16 + Math.max(nc1, nc2);
                    const newSF = computeSafeFlags(newR1, newR2);
                    const nk = encodeAbstract(newCompSig, newSF, bp);
                    bp[bi] = saved;
                    if (!parent.has(nk)) {
                      parent.set(nk, ck);
                      gMap.set(nk, ng);
                      witnessMap.set(nk, packWitness(newR1, newR2));
                      actionInfo.set(nk, (n << 5) | (ri << 4) | (d << 2) | 0);
                      lastMove.set(nk, (dest << 2) | d);
                      heap.push(ng + dijkstraFromR3(bp, newR1, newR2) * 3 - (bi === redIdx ? 1 : 0), nk);
                    }
                    cx = nx; cy = ny;
                  }
                }
              }
            }
          }

          // --- PULL slide: robot walks adjacent to box, then pulls 1..N tiles ---
          {
            // For the first pull, robot must reach bpos0+delta and bpos0+2*delta must be clear
            const firstPullFrom = (by0 + dy) * W + (bx0 + dx); // robot stands here
            if (bx0 + dx >= 0 && bx0 + dx < W && by0 + dy >= 0 && by0 + dy < H &&
                !wall[firstPullFrom]) {
              let fpBlk = false;
              for (let j = 0; j < nBox; j++) if (j !== bi && bp[j] === firstPullFrom) { fpBlk = true; break; }
              if (!fpBlk && firstPullFrom !== otherPos) {
                if (rDist[firstPullFrom] < 0) continue;
                {
                  const walkLen = rDist[firstPullFrom];
                  // Slide: robot pulls box, both move in direction d
                  let rCx = bx0 + dx, rCy = by0 + dy; // current robot pos (= firstPullFrom)
                  for (let n = 1; ; n++) {
                    // Robot moves one more step in dir d
                    const rnx = rCx + dx, rny = rCy + dy;
                    if (rnx < 0 || rnx >= W || rny < 0 || rny >= H) break;
                    const rDest2 = rny * W + rnx;
                    if (wall[rDest2] || rDest2 === otherPos) break;
                    { let dup = false; for (let j = 0; j < nBox; j++) if (j !== bi && bp[j] === rDest2) { dup = true; break; } if (dup) break; }

                    // Box follows to robot's old position
                    const bDest = rCy * W + rCx; // robot's previous pos
                    if (bi !== redIdx && safe[bDest]) break;

                    const ng = g + walkLen + n;
                    const newR1 = ri === 0 ? rDest2 : rpos[0];
                    const newR2 = ri === 1 ? rDest2 : rpos[1];
                    const saved = bp[bi]; bp[bi] = bDest;
                    const newComp2 = computeComponents(bp);
                    const nc1p = newComp2[newR1], nc2p = newComp2[newR2];
                    const newCompSig2 = Math.min(nc1p, nc2p) * 16 + Math.max(nc1p, nc2p);
                    const newSF2 = computeSafeFlags(newR1, newR2);
                    const nk = encodeAbstract(newCompSig2, newSF2, bp);
                    bp[bi] = saved;
                    if (!parent.has(nk)) {
                      parent.set(nk, ck);
                      gMap.set(nk, ng);
                      witnessMap.set(nk, packWitness(newR1, newR2));
                      actionInfo.set(nk, (n << 5) | (ri << 4) | (d << 2) | 2);
                      lastMove.set(nk, (bDest << 2) | d);
                      heap.push(ng + dijkstraFromR3(bp, newR1, newR2) * 3 - (bi === redIdx ? 1 : 0), nk);
                    }
                    rCx = rnx; rCy = rny;
                  }
                }
              }
            }
          }
        }
      }

      // Robot walks to safe zone (no box interaction)
      if (!safe[robotPos]) {
        const walk = pathToSafe(robotPos, bp, otherPos);
        if (walk && walk.length > 0) {
          let pos = robotPos;
          for (const wd of walk) {
            const px = pos % W, py = (pos - px) / W;
            pos = (py + DY[wd]) * W + (px + DX[wd]);
          }
          const wR1 = ri === 0 ? pos : rpos[0];
          const wR2 = ri === 1 ? pos : rpos[1];
          // Recompute components (compBuf may have been overwritten by push/pull)
          const walkComp = computeComponents(bp);
          const wc1 = walkComp[wR1], wc2 = walkComp[wR2];
          const wCompSig = Math.min(wc1, wc2) * 16 + Math.max(wc1, wc2);
          const wSF = computeSafeFlags(wR1, wR2);
          const nk = encodeAbstract(wCompSig, wSF, bp);
          const ng = g + walk.length;
          if (!parent.has(nk)) {
            parent.set(nk, ck);
            gMap.set(nk, ng);
            witnessMap.set(nk, packWitness(wR1, wR2));
            actionInfo.set(nk, (0 << 5) | (ri << 4) | 1); // walkOnly
            lastMove.set(nk, -1);
            heap.push(ng + dijkstraFromR3(bp, wR1, wR2) * 3, nk);
          }
        }
      }
    }
  }

  console.log(`Solver: exhausted ${explored} states, no solution`);
  return null;

  // =======================================================
  // Expand macro plan into explicit GameActions on a real
  // game state clone. Every action goes through applyAction.
  // =======================================================
  function expandAndValidate(goalKey: number): SolverAction[] | null {
    const chain: number[] = [];
    let k = goalKey;
    while (k !== -1) { chain.unshift(k); k = parent.get(k)!; }

    // Clone game state
    const s: GameState = {
      grid: gameState.grid,
      width: gameState.width,
      height: gameState.height,
      robots: [
        { ...gameState.robots[0], pos: { ...gameState.robots[0].pos } },
        { ...gameState.robots[1], pos: { ...gameState.robots[1].pos } },
      ],
      boxes: gameState.boxes.map(b => ({ pos: { ...b.pos }, isRedBuddy: b.isRedBuddy })),
      exitPos: gameState.exitPos,
      safeZone: gameState.safeZone,
      selectedRobotIndex: 0,
      steps: 0,
      won: false,
      winPhase: 0,
    };

    const actions: SolverAction[] = [];
    const curBp: number[] = new Array(nBox);
    const nextBp: number[] = new Array(nBox);

    function emit(a: SolverAction): boolean {
      const ok = applyAction(s, a as any);
      if (!ok && a.type === 'move') return false;
      actions.push(a);
      return true;
    }

    function selectRobot(ri: number): void {
      const id = ri === 0 ? 'R1' as const : 'R2' as const;
      if (s.selectedRobotIndex !== ri) emit({ type: 'selectRobot', id });
    }

    // BFS walk on the REAL game state
    function walkRobotTo(ri: number, tx: number, ty: number): boolean {
      selectRobot(ri);
      const robot = s.robots[ri];
      if (robot.pos.x === tx && robot.pos.y === ty) return true;

      // Detach if attached (to avoid accidental tow during walk)
      if (robot.attachedBoxIndex !== null) emit({ type: 'toggleAttach' });

      // BFS on actual game positions
      const from = robot.pos.y * W + robot.pos.x;
      const to = ty * W + tx;
      const otherR = s.robots[1 - ri];
      const otherPos = otherR.pos.y * W + otherR.pos.x;
      const boxPositions = s.boxes.map(b => b.pos.y * W + b.pos.x);

      const visited = new Uint8Array(M);
      const prev = new Int32Array(M).fill(-1);
      const prevDir = new Int8Array(M).fill(-1);
      visited[from] = 1;
      const q: number[] = [from];
      let h = 0;
      while (h < q.length) {
        const c = q[h++];
        const cx = c % W, cy = (c - cx) / W;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const ni = ny * W + nx;
          if (visited[ni] || wall[ni]) continue;
          if (ni !== to && (boxPositions.includes(ni) || ni === otherPos)) continue;
          visited[ni] = 1; prev[ni] = c; prevDir[ni] = d;
          if (ni === to) {
            const path: number[] = [];
            let p = to;
            while (p !== from) { path.unshift(prevDir[p]); p = prev[p]; }
            for (const dd of path) {
              if (!emit({ type: 'move', direction: DIR_NAMES[dd] })) return false;
            }
            return true;
          }
          q.push(ni);
        }
      }
      return false; // unreachable
    }

    for (let ci = 0; ci < chain.length - 1; ci++) {
      decodeStateFromWitness(chain[ci], curBp);
      decodeStateFromWitness(chain[ci + 1], nextBp);

      const info = actionInfo.get(chain[ci + 1])!;
      const ri = (info >> 4) & 1;
      const walkOnly = (info & 1) === 1;
      const isPull = ((info >> 1) & 1) === 1;
      const dir = (info >> 2) & 3;

      const slideN = info >> 5; // number of tiles to push/pull

      if (walkOnly) {
        const [nr1, nr2] = decodeStateFromWitness(chain[ci + 1], nextBp);
        const targetPos = ri === 0 ? nr1 : nr2;
        const tx = targetPos % W, ty = (targetPos - tx) / W;
        if (!walkRobotTo(ri, tx, ty)) return null;
      } else {
        // Find which box moved
        let oldPos = -1;
        if (curBp[redIdx] !== nextBp[redIdx]) {
          oldPos = curBp[redIdx];
        } else {
          const oldN: number[] = [], newN: number[] = [];
          for (let i = 0; i < nBox; i++) {
            if (i !== redIdx) { oldN.push(curBp[i]); newN.push(nextBp[i]); }
          }
          for (const p of oldN) if (!newN.includes(p)) { oldPos = p; break; }
        }
        if (oldPos < 0) return null;

        const obx = oldPos % W, oby = (oldPos - obx) / W;

        if (isPull) {
          // Walk to adjacent position (box_pos + delta)
          const wx = obx + DX[dir], wy = oby + DY[dir];
          if (!walkRobotTo(ri, wx, wy)) return null;
          selectRobot(ri);
          const robot = s.robots[ri];

          // Count adjacent boxes to decide if facing adjustment is needed
          let adjCount = 0;
          for (let dd = 0; dd < 4; dd++) {
            const nx = robot.pos.x + DX[dd], ny = robot.pos.y + DY[dd];
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
              if (s.boxes.some(b => b.pos.x === nx && b.pos.y === ny)) adjCount++;
            }
          }

          if (adjCount > 1) {
            // Multiple adjacent boxes — need to face the target box
            const neededFacing = DIR_NAMES[dir ^ 1]; // opposite of pull direction
            if (robot.facing !== neededFacing) {
              const awayX = wx + DX[dir], awayY = wy + DY[dir];
              if (awayX >= 0 && awayX < W && awayY >= 0 && awayY < H && !wall[awayY * W + awayX]) {
                const awayPos = awayY * W + awayX;
                const boxPositions = s.boxes.map(b => b.pos.y * W + b.pos.x);
                const otherPos = s.robots[1 - ri].pos.y * W + s.robots[1 - ri].pos.x;
                if (!boxPositions.includes(awayPos) && awayPos !== otherPos) {
                  emit({ type: 'move', direction: DIR_NAMES[dir] });
                  emit({ type: 'move', direction: neededFacing });
                }
              }
            }
          }

          // Attach (single box = auto, multiple = uses facing)
          emit({ type: 'toggleAttach' });
          if (robot.attachedBoxIndex === null) return null;
          const attached = s.boxes[robot.attachedBoxIndex];
          if (attached.pos.x !== obx || attached.pos.y !== oby) {
            emit({ type: 'toggleAttach' });
            return null;
          }

          // Pull N tiles
          for (let step = 0; step < slideN; step++) {
            if (!emit({ type: 'move', direction: DIR_NAMES[dir] })) return null;
          }

          // Detach
          emit({ type: 'toggleAttach' });
        } else {
          // Push: walk to behind the box
          const wx = obx - DX[dir], wy = oby - DY[dir];
          if (!walkRobotTo(ri, wx, wy)) return null;

          // Push N tiles (continuous moves in direction d)
          selectRobot(ri);
          for (let step = 0; step < slideN; step++) {
            if (!emit({ type: 'move', direction: DIR_NAMES[dir] })) return null;
          }
        }
      }
    }

    // Walk any robot not in safe zone back home
    for (let ri = 0; ri < 2; ri++) {
      const rr = s.robots[ri];
      const rrPos = rr.pos.y * W + rr.pos.x;
      if (!safe[rrPos]) {
        const otherRr = s.robots[1 - ri];
        const otherRrPos = otherRr.pos.y * W + otherRr.pos.x;
        const boxPos = s.boxes.map(b => b.pos.y * W + b.pos.x);
        // BFS to nearest safe tile
        selectRobot(ri);
        if (rr.attachedBoxIndex !== null) emit({ type: 'toggleAttach' });
        const visited2 = new Uint8Array(M);
        const prev2 = new Int32Array(M).fill(-1);
        const prevDir2 = new Int8Array(M).fill(-1);
        visited2[rrPos] = 1;
        const q2: number[] = [rrPos];
        let h2 = 0;
        let found = false;
        while (h2 < q2.length && !found) {
          const c = q2[h2++];
          const cx = c % W, cy = (c - cx) / W;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d], ny = cy + DY[d];
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const ni = ny * W + nx;
            if (visited2[ni] || wall[ni] || boxPos.includes(ni) || ni === otherRrPos) continue;
            visited2[ni] = 1; prev2[ni] = c; prevDir2[ni] = d;
            if (safe[ni]) {
              const path: number[] = [];
              let p = ni;
              while (p !== rrPos) { path.unshift(prevDir2[p]); p = prev2[p]; }
              for (const dd of path) {
                if (!emit({ type: 'move', direction: DIR_NAMES[dd] })) break;
              }
              found = true; break;
            }
            q2.push(ni);
          }
        }
      }
    }

    return s.won ? actions : null;
  }
}
