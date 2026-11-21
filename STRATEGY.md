# Strategy

The scored quantity is pushes, and a level earns full marks only at its push-optimal count P*. The
generator seals P* by construction: every level is a hallway plus independent rooms, boxes never
leave their room, and P* is the sum of the rooms' optima. So the entry never searches the whole
level — it recovers the room structure with articulation points of the floor graph (a component of
floor\{door} that holds equal boxes and goals and no player is a room), and solves each room with a
push-optimal A* whose state is the sorted box set plus the canonical player-reachability square and
whose heuristic is the sum of backward push distances to goals, with dead squares pruned. Rooms are
stitched in door order with walking BFS; every tie-break is fixed, so the two graded executions
produce byte-identical output.
