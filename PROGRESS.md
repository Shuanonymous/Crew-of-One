# Crew of One — Progress

**Status: COMPLETE and DEPLOYED — live at https://crew-of-one.onrender.com**

A goofy Pacific Rim: 2–8 friends in a room (4-letter code, no accounts) jointly
pilot ONE huge, slow, heavy mech. Each pilot is a different body part. Waves of
goofy kaiju attack a low-poly city. Comedy through coordination failure.

## How to run it

```
npm install
npm start          # http://localhost:3000
npm test           # both test suites (game logic + websocket integration)
```

## Technology

- **Three.js** — 3D in the browser, no build step (ES modules + import map)
- **cannon-es** — physics, running ON THE SERVER (authoritative). Clients send
  inputs, receive 20 Hz snapshots, and render 120 ms behind with interpolation,
  so every pilot sees the same mech.
- **Node.js + Express + ws** — one service serves the game files AND the
  websockets. Deploys as a single free-tier service.
- **WebAudio** — all sound effects are synthesized in code (no audio files).

## What's built (everything)

### The mech
- Huge, slow, deliberate: braking feet, thundering footstep THUDs with screen
  shake, slow turns toward wherever the HEAD player looks.
- ARMS: left/right fists punch with a windup (J/K work as backup keys).
- LEGS: WASD to walk (relative to the LEGS player's own camera), SPACE to kick —
  the kick hits like a truck but guts your balance mid-kick.
- HEAD: mouse aims, holds fire to charge the eye laser — 3 s charge during which
  the whole mech is rooted. The laser also roots the mech while firing.
- Falls ragdoll comically for 3.5 s, then the mech gets back up where it fell
  (brief mercy invulnerability after).

### Roles (shuffle every round)
- 1 pilot: everything. 2: LEGS / ARMS+HEAD. 3: LEGS / ARMS / HEAD.
- 4: LEGS / LEFT ARM / RIGHT ARM / HEAD.
- 5+: roles double up round-robin — two people sharing the legs is the premise,
  not a bug.
- Disconnect mid-run: the leaver's parts merge into a teammate (big on-screen
  notice + new role banner).

### Kaiju Brawl (main mode)
- Waves of CRABZILLA (angry crab, claw swipes) and PIGEONZILLA (pecks, and a
  wing-gust that shoves the mech across the plaza). All attacks loudly
  telegraphed; HP and damage scale each wave.
- Kills pay credits -> between waves a 25 s shop: repairs, COMICALLY LARGE
  FISTS, ESPRESSO LASER (faster charge), ROCKET PUNCH (whiffed punches launch
  the fist), LEG ARMOR, LEG DAY PROTOCOL (walk speed).
- One shared mech HP pool. Death = "MADE IT TO WAVE X" summary (kills, credits,
  punches, kicks, lasers, faceplants) + ONE MORE RUN with rotated roles.

### Mech Duel
- Two crews, two mechs, same combat systems, 160 HP each, win screen + rematch.

### Training Course
- Timed objectives that teach every role: walk 3 rings, punch 2 cardboard
  kaiju, kick over a crate tower, laser a balloon.

### Presentation
- PEAK-ish look: painterly gradient sky, chunky flat-color city with lit
  windows, parked cars, googly eyes + angry eyebrows on every monster.
- Title screen, 30-second how-to-play, lobby with invite link + mode picker,
  giant always-on "YOU ARE THE LEGS" role banner with key hints, crewmate
  list, HP/laser/credit HUD, per-monster health bars, comedy toasts
  ("BOOT!", "FLAP FLAP FLAP"), synthesized sfx for everything.

## Self-testing (all green)

- `test/server-logic.test.js` — 24 checks: waves spawn, punches/kicks/laser
  damage and kill, credits pay, shop applies/rejects purchases, movement locks
  during laser charge, mech death ends the run with a summary, duel finds a
  winner, training completes.
- `test/rooms.test.js` — 24 checks over real websockets: 4-letter codes,
  join (case-insensitive), bad-code rejection, host-only start, 3-player role
  split, live position sync between clients, role-gated input (ARMS can't
  walk), disconnect role-merge, duel crew assignment, training world,
  AGAIN-with-rotated-roles, empty-room cleanup.
- Headless-Chromium browser tests (Playwright): title -> create -> lobby ->
  solo brawl, kill a crab -> credits -> shop -> buy gating -> next wave; and a
  two-tab run: invite link, 2-player role split, shared mech moves for both
  tabs, run-over screen, ONE MORE RUN role rotation, back-to-lobby -> duel with
  opposing crews -> win screen; training objectives HUD. Zero console errors.
- Production check: clean `git archive` -> `npm ci --omit=dev` ->
  `PORT=8123 node server/index.js` -> all routes 200.

## Judgment calls (the log)

- **Combat aiming is per-player.** Punches go where the ARMS player's camera
  points, the laser where the HEAD looks, walking is relative to the LEGS
  player's camera. Maximum interdependence, maximum yelling.
- **The mech turns to face the HEAD's camera.** The legs can walk any
  direction, but the body slowly swings to the HEAD's view — so the HEAD
  effectively steers everyone's punches. Argue about it.
- **Anyone can spend the crew's shared credits in the shop.** Chaos is content.
- **Kick self-knockback**: kicking shoves the kicker back a little. Physics
  comedy, and it makes the "powerful but risky" promise true.
- **Pigeon gust does zero damage** but launches the mech. Getting yeeted across
  the plaza is funnier than losing HP.
- **Monsters die by flipping upside down and sinking.** Never scary.
- **J/K backup punch keys** so trackpad players (and automated tests) can box.
- **Solo player gets laser on E** (mouse buttons are busy punching).
- **After a run, only the host can restart or return the room to the lobby** —
  prevents 8-person button mashing from eating the "one more round" moment.
- **Spectators**: joining mid-run makes you a spectator; you're dealt in next
  round automatically.
- **Sunset palette** instead of noon: warmer, more PEAK, hides the fact that
  boxes are boxes.
- Gravity is -30 and the mech masses 60 units: everything lands with authority.

## Deployment state

**LIVE: https://crew-of-one.onrender.com** — Render free-tier web service,
created via the Render API with the owner's key, deployed from the public
repo's `claude/crew-of-one-game-uv7dmi` branch with auto-deploy on push.
Verified post-deploy: HTTP 200 on `/` and `/healthz`, and a two-client
websocket session on the live URL (room created, roles split, mech walked
14 m with both clients seeing identical positions).

The repo also stays portable to other hosts (single service, binds
`process.env.PORT`, `/healthz` endpoint):
- `render.yaml` — Render Blueprint (what's live now)
- `Dockerfile` — works anywhere containers run
- `fly.toml` — Fly.io
- `railway.json` — Railway

## Gotchas for future sessions

- cannon-es `applyForce(force, point)`: the 2nd argument is an offset RELATIVE
  TO THE CENTER OF MASS, not a world position. A world position there adds a
  huge phantom torque that flips bodies instantly.
- The mech hovers (no ground friction) — the explicit brake force in
  `mech.js` is what stops it from ice-skating. Don't remove it.
- Held/grabbed/constrained objects must not collide with the body holding
  them (`collideConnected = false`) or the solver fights itself.
- Server tests that let crabs maul the mech will hit the DEAD phase, which
  freezes `game.step()` — reset `game.phase` before reusing a game instance.
- Room loops (`setInterval`) are per-room and MUST be cleared in
  `stopLoop()` paths (again/toLobby/dispose) or they leak.
