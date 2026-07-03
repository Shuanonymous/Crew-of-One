# Crew of One — Progress

**Status: COMPLETE and DEPLOYED — live at https://crew-of-one.onrender.com**

---

# UPDATE PASS (feel / variety / atmosphere overhaul)

All six requested sections shipped. Every tuning value is listed below for
fast adjustment after the next playtest — they all live in
`shared/constants.js` (server feel) and the noted client files.

## 1. Game feel — "weight, not lag"
| Value | Was | Now | Where |
|---|---|---|---|
| Max walk speed | 5.2 | **7.8** (+50%) | `MECH.maxWalkSpeed` |
| Walk force (accel) | 2100 | **3800** (~0.25 s to full speed, reacts same frame) | `MECH.walkForce` |
| Brake rate (keys released) | 2.4 | **3.2** | `MECH.brakeRate` |
| Turn torque / damping | 2400 / 900 | **5200 / 1300** | `MECH.turnTorque/Damping` |
| Punch windup / swing / recover | .55/.22/.50 | **.34/.16/.30** | `MECH.punch` |
| Punch damage / knockback | 14 / 900 | **16 / 1150** | `MECH.punch` |
| Kick windup / swing / recover | .70/.30/.90 | **.46/.24/.60** | `MECH.kick` |
| Kick damage / knockback | 30 / 2100 | **36 / 2600** | `MECH.kick` |
| Hitstop | — | **80 ms punch, 110 ms kick, 70 ms rocket** | `main.js handleEvents` |
| Shake (step/punch/kick/fall/slam) | — | **0.14 / 0.4 / 0.75 / 1.1 / 1.2** trauma | `main.js` |
| Damage numbers | — | DOM pop-offs; laser purple, ≥30 dmg = big red | `main.js dmgNumber` |
| Monster speed | crab 2.3, pigeon 3.1 | **crab 3.2, pigeon 4.3** (+~38%) | `MONSTERS` |
| Monster recover times | 1.1 / 1.4 | **0.7 / 0.9** (telegraphs kept ≥1.1 s) | `MONSTERS` |

## 2. Laser overhaul
- Always-on **crew-visible targeting line + reticle** (server computes the
  aim endpoint every tick; guide thickens with charge, turns hot pink on
  target).
- **DPS 42 → 110**, fire time 1.4 → **2.4 s** (sweepable across a pack),
  beam radius 2.2 → 2.6, range 60 → 75. Charge time still 3.0 s
  (1.65 s with Espresso Laser) and the mech still roots — the tension stays.
- White-hot core + additive purple sheath (bloom makes it glow), scorch
  decals + spark bursts at the impact point, hitmarker ping + purple damage
  numbers.

## 3. Monster variety (all distinct behaviors, not palette swaps)
| Type | HP (base+/wave) | Speed | The problem it poses |
|---|---|---|---|
| SCUTTLER (rusher) | 16+3 | 7.5 | Packs; punishes slow crews; 0.55 s telegraph |
| CRABZILLA | 42+8 | 3.2 | Baseline bruiser (+ gustless swipes) |
| PIGEONZILLA | 95+11 | 4.3 | Heavy; 35% chance wing-gust (0 dmg, huge shove) |
| LOOGIE LOUIE (spitter) | 55+8 | 2.8 | Lobs dodgeable arcing globs from 26–34 m; backs away if approached |
| SIR CLANKSALOT (tank) | 320+35 | 1.5 | Takes 25% melee damage — laser or rockets required |
| DIVE-BOMB DAVE (flyer) | 40+6 | 9 (dive 26) | Circles at y=15, telegraphed dive line locks at YOUR position — sidestep |
| GRABLIN (swarmling) | 3 | 8.5 | Latches on, 1.4 dps each — KICK to shake them all off (point-blank hits ignore the arc) |
| BOSS (every 5th wave) | 850+30×wave | 2.3 | Named; 60% melee resist; 3 patterns: 3-hit swipe combo / summon rushers / ground slam (17 m radial, 1.9 s telegraph); top-screen health bar |

Boss names: Baroness Pinchelot the Unreasonable, Gary Devourer of Bus Stops,
Judge Clawstice, Kevin the Absolute Unit, Duke Slamwich III, Princess
Stompathy. Wave recipes 1–10 hand-mixed (see `WAVES`), formula after,
boss every 5th.

## 4. Art direction — stylized cinematic
- Golden-hour sun (low elevation → long shadows) + cool rim light behind.
- Giant sun/moon disc, 2 rings of silhouetted skyline, 70 drifting embers,
  gradient-canvas sky.
- **Palette journey per wave**: sunset → dusk → neon night → dawn (3.5 s
  crossfade on each wave start; `PALETTES` in `render.js`).
- UnrealBloom (strength .55, threshold .82) + CSS vignette.
- Buildings: water towers / AC units / antennas / neon strips (deterministic
  per building), puntable car props (server-simulated, mass 2.5,
  punt impulse = knockback × 0.055).
- Mech de-goofed: bobble antenna → blade antenna with blinking warning
  light; googly eyes stay on the monsters only.

## 5. Music & sound
- `music.js`: procedural step-sequencer, A minor, 112 BPM. Layers: pad+arp
  (lobby/shop) → +kick/snare/hats+bass (waves) → +detuned lead & double-time
  hats (boss). Crossfades 1.2 s. All synthesized — nothing licensed.
- New sfx: sub-bass layer in impacts, laser hitmarker ping, glob splat,
  flyer screech, per-type roar pitches (tank 0.45, rusher 1.8, boss 0.32).

## 6. Verification
- `npm test`: **43 + 24 checks, ALL PASS** (includes new per-behavior tests:
  spitter range-keeping + projectile damage, tank melee resist, flyer dive,
  swarm latch/kick-clear, boss wave-5 spawn + name + bar + slam + summon,
  car punting).
- Headless-browser: two-tab regression ALL PASS, zero console errors;
  screenshots verified (palette shift, guide/reticle, beam, skyline, neon).
- Live URL re-verified after redeploy.

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
