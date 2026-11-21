# sokoban-solver-01-run-20261121

[![make.fun](https://make.fun/badge.svg)](https://make.fun)
[![competition](https://img.shields.io/badge/make.fun-sokoban--solver--01--run--20261121-blue)](https://make.fun/c/sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for the make.fun competition
[sokoban-solver-01-run-20261121](https://make.fun/c/sokoban-solver-01-run-20261121).

## How it works

The generator's levels are a one-square-wide hallway plus 1–4 rooms of at most 6×6, each holding
3–4 boxes; a box pushed through a door can never come back, so every box stays in its room and the
push-optimal count of a level is the sum of its rooms' optima. The solver exploits that structure:

1. **Decomposition** — articulation points (iterative Tarjan) of the floor graph find the door of
   each room; a component of floor\{door} without the player that holds an equal number of boxes
   and goals is a room, and each box is assigned to the smallest such component containing it.
2. **Per-room push-optimal A\*** — states are (sorted box positions, canonical player-reachability
   square), cost is pushes, and the heuristic is the sum over boxes of a backward push BFS distance
   to the nearest goal; squares with infinite distance are dead and pruned.
3. **Stitching** — room solutions are concatenated in door order, with deterministic walking moves
   (BFS avoiding current box positions) between rooms.

The result is deterministic and answers all five instances of a set within the 60-second wall.

## Usage

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` runs on Node 22 (erasable TypeScript, `node:fs`/`node:path` only, no dependencies).

## License

MIT — see [LICENSE](LICENSE).
