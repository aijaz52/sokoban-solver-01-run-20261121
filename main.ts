// sokoban-solver-01-run-20261121 entry: push-optimal solver.
// SPDX-License-Identifier: MIT
// Reads /input/<id>/level.txt, writes /output/<id>/solution.txt (LURD moves, one per step).
// Level structure (make.fun generator): a one-square-wide hallway plus 1-4 rooms of at most 6x6,
// each holding 3-4 boxes; a box pushed through a door can never come back, so every box stays in
// its room and the push-optimal count of the level is the sum of the rooms' optima. The solver
// decomposes the level into rooms (via articulation points of the floor graph), solves each room
// with a push-optimal A*, and stitches the room solutions together with walking moves.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Level = { W: number; H: number; wall: Uint8Array; goal: Uint8Array; box: Uint8Array; player: number };
type Room = { floor: Set<number>; door: number; boxes: number[]; goals: Set<number> };
type Node = { boxes: number[]; boxSet: Set<number>; player: number; parent: number; walk: string; push: string; g: number; min: number };
// [dx, dy, letter], fixed order for deterministic tie-breaking
const DIRS: Array<[number, number, string]> = [[0, -1, 'u'], [0, 1, 'd'], [-1, 0, 'l'], [1, 0, 'r']];
const DELTA = (W: number) => ({ u: -W, d: W, l: -1, r: 1 } as Record<string, number>);

function parse(text: string): Level {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const H = lines.length, W = Math.max(...lines.map((l) => l.length));
  const wall = new Uint8Array(W * H), goal = new Uint8Array(W * H), box = new Uint8Array(W * H);
  let player = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = lines[y][x] ?? ' '; const p = y * W + x;
    if (c === '#') wall[p] = 1;
    if (c === '.' || c === '*' || c === '+') goal[p] = 1;
    if (c === '$' || c === '*') box[p] = 1;
    if (c === '@' || c === '+') player = p;
  }
  return { W, H, wall, goal, box, player };
}

function floorAdj(W: number, H: number, wall: Uint8Array): Array<number[] | null> {
  const N = W * H; const adj: Array<number[] | null> = [];
  for (let p = 0; p < N; p++) {
    if (wall[p]) { adj.push(null); continue; }
    const x = p % W, y = (p / W) | 0; const r: number[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const c = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
      r.push(c !== -1 && !wall[c] ? c : -1);
    }
    adj.push(r);
  }
  return adj;
}

// Iterative Tarjan articulation points over the floor graph.
function articulations(N: number, adj: Array<number[] | null>): Set<number> {
  const disc = new Int32Array(N).fill(-1), low = new Int32Array(N), parent = new Int32Array(N).fill(-1);
  const arts = new Set<number>(); let time = 0;
  for (let root = 0; root < N; root++) {
    if (disc[root] !== -1 || adj[root] === null) continue;
    const stack: Array<[number, number]> = [[root, 0]];
    disc[root] = low[root] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, ci] = top;
      if (ci < (adj[u] as number[]).length) {
        top[1]++;
        const v = (adj[u] as number[])[ci];
        if (v === -1) continue;
        if (disc[v] === -1) { parent[v] = u; disc[v] = low[v] = time++; stack.push([v, 0]); }
        else if (v !== parent[u]) low[u] = Math.min(low[u], disc[v]);
      } else {
        stack.pop();
        if (parent[u] !== -1) {
          low[parent[u]] = Math.min(low[parent[u]], low[u]);
          if (low[u] >= disc[parent[u]]) arts.add(parent[u]);
        }
      }
    }
  }
  return arts;
}

function componentsExcluding(N: number, adj: Array<number[] | null>, blocked: Set<number>): { comp: Int32Array; count: number } {
  const comp = new Int32Array(N).fill(-1); let c = 0;
  for (let s = 0; s < N; s++) {
    if (comp[s] !== -1 || blocked.has(s) || adj[s] === null) continue;
    const q = [s]; comp[s] = c;
    for (let h = 0; h < q.length; h++) {
      const nb = adj[q[h]] as number[] | null;
      for (const v of nb) if (v !== -1 && comp[v] === -1 && !blocked.has(v)) { comp[v] = c; q.push(v); }
    }
    c++;
  }
  return { comp, count: c };
}

// Rooms: for each articulation point d, components of floor\{d} that do not hold the player and
// hold boxes are candidate rooms when box count equals goal count (a room is sealed by its door:
// all its boxes and goals are inside). For each box keep the smallest candidate containing it —
// larger candidates merge several rooms across the hallway and must be ignored.
function findRooms(level: Level, adj: Array<number[] | null>): Room[] {
  const { W, H, wall, goal, box, player } = level;
  const N = W * H;
  const arts = articulations(N, adj);
  const boxes: number[] = [];
  for (let p = 0; p < N; p++) if (box[p]) boxes.push(p);
  const roomOf = new Map<number, { size: number; floor: number[]; door: number; key: string }>();
  for (const d of arts) {
    const { comp, count } = componentsExcluding(N, adj, new Set([d]));
    const startC = comp[player];
    for (let c = 0; c < count; c++) {
      if (c === startC) continue;
      const sq: number[] = []; let nb = 0, ng = 0;
      for (let p = 0; p < N; p++) if (comp[p] === c) { sq.push(p); if (box[p]) nb++; if (goal[p]) ng++; }
      if (nb === 0 || nb !== ng) continue;
      const key = sq.slice().sort((a, b) => a - b).join(',');
      for (const p of sq) {
        const cur = roomOf.get(p);
        if (!cur || sq.length < cur.size) roomOf.set(p, { size: sq.length, floor: sq, door: d, key });
      }
    }
  }
  const rooms = new Map<string, Room>();
  for (const p of boxes) {
    const r = roomOf.get(p);
    if (!r) throw new Error(`box not in a room at ${p}`);
    if (!rooms.has(r.key)) rooms.set(r.key, { floor: new Set([...r.floor, r.door]), door: r.door, boxes: [], goals: new Set() });
    (rooms.get(r.key) as Room).boxes.push(p);
  }
  for (const room of rooms.values()) for (let p = 0; p < N; p++) if (room.floor.has(p) && goal[p]) room.goals.add(p);
  return [...rooms.values()].sort((a, b) => a.door - b.door);
}

function walkPath(vis: Set<number>, from: number, to: number, nbr: Map<number, number[]>, W: number): string {
  if (from === to) return '';
  const prev = new Map<number, [number, string]>([[from, [-1, '']]]); const q = [from];
  for (let h = 0; h < q.length; h++) {
    const p = q[h];
    for (const [dx, dy, L] of DIRS) {
      const c = p + dx + dy * W;
      if (c < 0 || c > 1e9 || !nbr.has(c) || !vis.has(c) || prev.has(c)) continue;
      prev.set(c, [p, L]);
      if (c === to) { let s = '', cur = c; while (cur !== from) { const [pp, LL] = prev.get(cur) as [number, string]; s = LL + s; cur = pp; } return s; }
      q.push(c);
    }
  }
  throw new Error('no walk path');
}

// Push-optimal A* over (boxes, player-reachability canonical square) inside one room.
// The state key uses the minimum-index square the player can reach without pushing; the actual
// player position rides in the node only to rebuild the move string. Heuristic: sum over boxes of
// the backward-push-BFS distance to the nearest goal (admissible); squares with infinite distance
// are dead and pruned.
function solveRoom(floorSet: Set<number>, W: number, H: number, boxes0: number[], goals: Set<number>, player: number): { moves: string; pushes: number } | null {
  const N = Math.max(player, ...floorSet) + 1;
  const adjOk = (p: number) => floorSet.has(p);
  const distArr = new Map<number, number>();
  {
    const q: number[] = [];
    for (const g of goals) if (floorSet.has(g)) { distArr.set(g, 0); q.push(g); }
    for (let h = 0; h < q.length; h++) {
      const cur = q[h]; const dc = distArr.get(cur) as number;
      for (const [dx, dy] of DIRS) {
        const d = dx + dy * W;
        const p = cur - d, behind = p - d;
        if (!adjOk(p) || !adjOk(behind)) continue;
        if (!distArr.has(p)) { distArr.set(p, dc + 1); q.push(p); }
      }
    }
  }
  for (const b of boxes0) if (!distArr.has(b)) return null; // box can never reach a goal

  const nbr = new Map<number, number[]>();
  for (const p of floorSet) {
    const x = p % W, y = (p / W) | 0; const r: number[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const c = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
      r.push(c !== -1 && adjOk(c) ? c : -1);
    }
    nbr.set(p, r);
  }
  const reach = (boxSet: Set<number>, from: number): Set<number> => {
    const vis = new Set<number>([from]); const st = [from];
    for (let h = 0; h < st.length; h++) for (const q of nbr.get(st[h]) as number[]) if (q !== -1 && !vis.has(q) && !boxSet.has(q)) { vis.add(q); st.push(q); }
    return vis;
  };
  const hOf = (b: number[]) => { let s = 0; for (const p of b) s += distArr.get(p) as number; return s; };
  const keyOf = (b: number[]) => b.join(',');
  const solved = (b: number[]) => b.every((p) => goals.has(p));

  const nodes: Node[] = []; const seen = new Map<string, number>(); const open: Array<[number, number]> = [];
  const heapPush = (f: number, i: number) => { open.push([f, i]); let c = open.length - 1; while (c > 0) { const pa = (c - 1) >> 1; if (open[pa][0] <= open[c][0]) break; [open[pa], open[c]] = [open[c], open[pa]]; c = pa; } };
  const heapPop = (): [number, number] => { const t = open[0]; const l = open.pop() as [number, number]; if (open.length) { open[0] = l; let c = 0; for (;;) { let a = 2 * c + 1, b2 = a + 1, m = c; if (a < open.length && open[a][0] < open[m][0]) m = a; if (b2 < open.length && open[b2][0] < open[m][0]) m = b2; if (m === c) break; [open[m], open[c]] = [open[c], open[m]]; c = m; } } return t; };

  const b0 = boxes0.slice().sort((a, c) => a - c);
  nodes.push({ boxes: b0, boxSet: new Set(b0), player, parent: -1, walk: '', push: '', g: 0, min: player });
  seen.set(keyOf(b0) + '|' + player, 0);
  heapPush(hOf(b0), 0);
  while (open.length) {
    const [, ni] = heapPop();
    const node = nodes[ni];
    const k = keyOf(node.boxes) + '|' + node.min;
    if (node.g > (seen.get(k) ?? Infinity)) continue;
    if (solved(node.boxes)) { let s = ''; let cur = ni; while (cur >= 0) { s = nodes[cur].walk + nodes[cur].push + s; cur = nodes[cur].parent; } return { moves: s, pushes: node.g }; }
    const vis = reach(node.boxSet, node.player);
    for (const b of node.boxes) {
      for (const [dx, dy, L] of DIRS) {
        const d = dx + dy * W, to = b + d, from = b - d;
        if (!adjOk(to) || !adjOk(from) || node.boxSet.has(to) || !vis.has(from)) continue;
        if (!distArr.has(to)) continue; // dead square
        const nb = node.boxes.map((p) => (p === b ? to : p)).sort((a, c) => a - c);
        const boxSet = new Set(nb);
        const r = reach(boxSet, b);
        let min = b; for (const p of r) if (p < min) min = p;
        const ck = keyOf(nb) + '|' + min;
        const ng = node.g + 1;
        if ((seen.get(ck) ?? Infinity) <= ng) continue;
        seen.set(ck, ng);
        nodes.push({ boxes: nb, boxSet, player: b, parent: ni, walk: walkPath(vis, node.player, from, nbr, W), push: L, g: ng, min });
        heapPush(ng + hOf(nb), nodes.length - 1);
      }
    }
  }
  return null;
}

function solve(level: Level): string {
  const { W, H, wall, goal, player } = level;
  const N = W * H;
  const adj = floorAdj(W, H, wall);
  const rooms = findRooms(level, adj);
  const floorAll = new Set<number>();
  for (let p = 0; p < N; p++) if (!wall[p]) floorAll.add(p);
  const curBoxes = new Set<number>();
  for (let p = 0; p < N; p++) if (level.box[p]) curBoxes.add(p);
  const nbrAll = new Map<number, number[]>();
  for (const p of floorAll) {
    const x = p % W, y = (p / W) | 0; const r: number[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const c = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
      r.push(c !== -1 && !wall[c] ? c : -1);
    }
    nbrAll.set(p, r);
  }
  let moves = '';
  let cur = player;
  const delta = DELTA(W);
  for (const room of rooms) {
    // walking moves to the room's door, avoiding the current box positions
    if (cur !== room.door) {
      const prev = new Map<number, [number, string]>([[cur, [-1, '']]]); const q = [cur]; let found = false;
      for (let h = 0; h < q.length && !found; h++) {
        const p = q[h];
        for (const [dx, dy, L] of DIRS) {
          const c = p + dx + dy * W;
          if (c < 0 || c >= N || wall[c] || curBoxes.has(c) || prev.has(c)) continue;
          prev.set(c, [p, L]);
          if (c === room.door) { found = true; break; }
          q.push(c);
        }
      }
      if (!found) throw new Error(`no walk path to door ${room.door}`);
      let seg = '', c2 = room.door;
      while (c2 !== cur) { const [pp, LL] = prev.get(c2) as [number, string]; seg = LL + seg; c2 = pp; }
      moves += seg;
    }
    const r = solveRoom(room.floor, W, H, room.boxes, room.goals, room.door);
    if (!r) throw new Error(`room unsolved at door ${room.door}`);
    moves += r.moves;
    let pcur = room.door;
    for (const m of r.moves.toLowerCase()) {
      const d = delta[m];
      const np = pcur + d;
      if (curBoxes.has(np)) { curBoxes.delete(np); curBoxes.add(np + d); }
      pcur = np;
    }
    cur = pcur;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  let moves = '';
  try {
    moves = solve(parse(readFileSync(join(I, id, 'level.txt'), 'utf8')));
  } catch {
    moves = '';
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
