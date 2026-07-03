# Crew of One — Progress

A friendslop party game: 2–8 players join via a room code, get split into
crews, and each crew jointly pilots ONE wobbly giant robot through an
obstacle course. Each crew member controls a different body part.

## How to run it locally

1. Install Node.js (LTS version) from https://nodejs.org
2. In a terminal, inside this project folder:
   - `npm install`   (first time only)
   - `npm start`
3. Open http://localhost:3000 in Chrome, Edge, Firefox, or Safari.

## Technology (chosen for simplicity + one-service deployment)

- **Three.js** — 3D rendering in the browser
- **cannon-es** — physics engine, runs ON THE SERVER (authoritative:
  clients only send inputs and render interpolated state, so all
  players always see the same robot)
- **Node.js + Express + ws** — one server serves the game files AND the
  WebSocket connection, so it deploys as a single service (Railway /
  Render / Fly.io ready)
- **No build step** — files are served as-is via ES modules + import map

## Phase status

### ✅ Phase 1 — one robot, solo control, flat test area (DONE)
- Server-authoritative physics at 60 Hz, state broadcast at 20 Hz,
  clients interpolate 120 ms behind for smoothness
- The robot: a hovering torso on an invisible spring ("legs"), soft
  balance torque (soft = wobbly on purpose), noodle arms drawn to
  server-computed hand positions, googly eyes that slosh around,
  bobble antenna, scissoring cartoon legs
- Controls (solo): WASD walk, Space jump, mouse look/aim, click grab
  (hold click near an object to latch on; click on nothing = shove),
  Q/E lean
- Falling past ~70° tilt → comedy ragdoll spin → respawn after 3 s
  ("CLANG!" / "TIMBER!" toasts)
- Test area: flat ground, ramp, 5 crates, one very puntable beach ball
- Grabbed objects are hugged to the chest with a capped grip force
  (stuck objects stretch your grip instead of yanking you over);
  held objects don't collide with the torso
- Props that fall off the world respawn from the sky

**Test it:** run it (see above), open http://localhost:3000, click, and
walk around with WASD. Try punting the pink ball and picking up crates.

### ⬜ Phase 2 — multiplayer (NEXT)
- 4-letter room codes, join via shared link
- Role split: LEGS / ARMS / HEAD+BALANCE (2 players: Legs+Balance and
  Arms+Head)
- Host starts the round; disconnect mid-round merges the lost role into
  a teammate
- Two browser tabs pilot one robot together

### ⬜ Phase 3 — obstacle course, checkpoints, rounds, scoreboard
- Gaps, seesaw platforms, narrow beam, one swinging hazard
- Checkpoint respawns, ~3-minute rounds, best-time display (co-op mode)

### ⬜ Phase 4 — race mode + polish
- Second crew, head-to-head race, automatic role shuffling each round
- Sounds, ragdoll flair, funny role-assignment screen, "one more round"

### ⬜ Phase 5 — deploy to a real URL

## Notes / decisions made along the way
- Gravity is stronger than Earth (-22) so falls feel snappy and comedic
- Walking into the crate pile at full speed can trip the robot — kept
  on purpose, it's funny and rewards careful crew driving
- Carrying something at arm's length shifts your balance — the
  HEAD/BALANCE player will need to lean against it (emergent teamwork!)
- In solo mode lean is on Q/E (A/D are taken by walking); when roles
  are split, the HEAD player leans with A/D as speced
- Server tuning constants all live in `shared/constants.js`

## Gotcha for future sessions
- cannon-es `applyForce(force, point)`: the 2nd argument is an offset
  RELATIVE TO THE CENTER OF MASS, not a world position. Passing a world
  position adds a huge phantom torque that flips the robot. (Cost us an
  hour in Phase 1.)
