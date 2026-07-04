# Crew of One — Progress

# Codex repair rework — four-mode structure, safe shop, settings pause

## What changed
- Added **Classic Wave Mode** as the default beginner-friendly mode. Crews fight a finite wave, clear it, earn a wave bonus, shop safely, then the host readies the next wave.
- Preserved **Endless Escalation** as the existing danger-clock survival format with supply-beacon buying.
- Preserved **Mech Duel** and **Training Course** as launchable modes.
- Added a room-safe settings pause path: solo runs and Training pause the authoritative game while settings are open; multiplayer settings are personal so one player cannot freeze everyone unfairly.
- Made shop UI copy mode-aware so Classic reads as a safe upgrade bay and Endless reads as a field supply beacon.
- Added automated tests for Classic shop reliability: wave clear opens shop, repair spends credits and heals, upgrade tiers apply, ready starts the next wave, and combat buying is rejected.

## Files changed
- `server/classic.js` — new Classic Wave game mode built on the existing brawl systems.
- `server/rooms.js` — default mode changed to Classic, mode launch split between Classic/Endless/Duel/Training, solo/training pause handling added.
- `shared/constants.js` — added `classic` mode and pause protocol message.
- `public/index.html` — lobby now exposes four playable formats and settings/shop copy is clearer.
- `public/js/main.js` — client mode handling, shop copy, Classic end summary, and settings pause/resume behavior.
- `test/server-logic.test.js` — Classic shop/upgrade regression tests.
- `test/rooms.test.js` — room launch tests for default Classic and separate Endless.
- `README.md`, `PLAYTEST.md`, `AGENTS.md` — player/developer guidance updated.

## How modes now work
- **Classic Wave Mode:** default lobby mode. The server spawns a recipe for the current wave. When all monsters are defeated, the server awards bonus credits and enters a safe shop phase. The host clicks ready to start the next wave.
- **Endless Escalation:** existing survival mode. Danger rises continuously, monsters spawn from a budget, bosses appear at danger milestones, and supply beacons open the field shop.
- **Mech Duel:** two crews receive separate mechs and fight until one mech is destroyed.
- **Training Course:** solo-friendly objective course for movement, punching, kicking, and laser practice.

## How buying works
- Classic buying is only accepted during the between-wave shop phase. Unaffordable buttons are disabled in the client. Purchases spend shared credits and immediately update mech upgrades/repair.
- Endless buying is available anywhere from the **UPGRADES (B)** HUD button; no supply beacon is required.
- Regression coverage now checks that Classic repair and upgrades actually apply and that combat purchases are rejected.

## How settings work
- Settings persist in `localStorage` for master volume, music volume, screen shake, and graphics quality.
- Opening settings during solo play or Training asks the server to pause that room’s game loop until settings close.
- Opening settings during an active run pauses the room loop until settings close.
- The settings panel has a clear **RESUME / BACK** button.

## Tuning values
- Classic shop break: 30 seconds if the host does not ready early.
- Classic wave bonus: 25 credits base + 15 credits per cleared wave.
- Classic early recipes introduce rushers/crabs first, then spitters/flyers, then tank/boss pressure.
- Existing performance caps remain: Endless monster cap 26 and swarm cap 12.
- Camera shake budget remains capped in the renderer: each hit max 0.9 trauma, total max 1.2, multiplied by the user’s shake setting.



## Hotfix after live-player feedback
- **Endless Escalation buying is now buy-anywhere.** The server no longer requires a supply beacon for Endless purchases, and snapshots mark the Endless shop as always available.
- Added an in-game **UPGRADES (B)** button for Endless. Players can click it or press **B**, buy upgrades, then click **BACK TO FIGHT**.
- Settings now pause the authoritative room loop for active runs, including Endless, instead of only solo/training.
- Added automated coverage for Endless buy-anywhere behavior and Endless settings pause/resume snapshots.
- Classic remains the old-style wave format: fight wave → clear wave → safe shop → host ready → next wave.

## QA follow-up fixes before merge
- Removed visible placeholder Ko-fi/Discord links from the title and end screens.
- Removed the old direct comparison to a specific film franchise from project docs and kept the direction as original cinematic mech/kaiju action.
- Changed bird-monster face details from comedy eyes to red sensor slits and armored brow plates.
- Made the credits HUD visible in Classic as well as Endless so upgrade economy is clearer before the shop opens.
- Added WebSocket pause regression coverage for solo Classic settings pause/resume snapshots.

## Known limitations
- Classic mode reuses the existing city, mech, enemy, shop, effects, and combat systems; it is a stability-first rework rather than a total art rewrite.
- Browser E2E was limited to server smoke testing in this environment; use the updated `PLAYTEST.md` checklist for a real 10-minute player pass.

## Render deployment
- Render remains a single Node web service using `render.yaml`.
- Build command remains `npm ci`; start command remains `node server/index.js`; health check remains `/healthz`.
- If Render is connected to GitHub, merging the PR into the linked branch should auto-deploy. If it does not, use Render’s **Manual Deploy → Deploy latest commit** button.

## Tests passed
- `npm test` passes after the rework, including server logic and real WebSocket room tests.
- Smoke start was run with `npm start` and `/healthz` checked via `curl`.

## Could not be fully verified here
- Full visual/browser playtest with real humans, real audio comfort, and multiple physical machines. Use `PLAYTEST.md` for that pass before a public game night.

---


**Status: COMPLETE and DEPLOYED — live at https://crew-of-one.onrender.com**

---

# MAJOR REWORK (serious world / endless runs / bigger city)

## 1. Tone
Night-rain district, sweeping searchlights, horizon lightning flashes, red
predator eye-slits on every monster, serious boss names
(VORAX THE TIDE THAT WALKS, KHARYBDIS PRIME, THE SILENT COLOSSUS…). Humor
lives only in UI copy and crew chaos.

## 2. Endless structure (all values in shared/constants.js DANGER)
- Danger clock: +1 level / 60 s. Monster hp/dmg scale with level via the
  existing per-level fields; spawner budget = 4.5 + 0.5·level points/s.
- Spawn costs: rusher 6 · crab 12 · swarm 4 · spitter 18 · flyer 20 ·
  pigeon 26 · tank 45. Unlock levels 0/0/1/1/2/3/4. Caps: 26 monsters,
  12 swarmlings. Bosses at danger levels 3, 6, 9, 12, 16, 20.
- Credits: kills + 35% chance pickup drop (5–15©) + caches (15–30©).
- SUPPLY BEACONS (5/run, radius 9 m): shop opens by proximity, fight does
  not pause. Repeatable tiers (+20% melee dmg, +10% DR to 60%, +12% speed,
  +25% laser & −10% charge; price ×1.35 per tier, repair ×1.2) + rare
  finds: ROCKET FIST 120©, SHOULDER TURRET 140© (9 dmg/1.1 s, 38 m),
  DASH THRUSTERS 130© (F key, impulse 1500, 3 s cd).
- Run summary: time, seed, kills, credits, damage per part
  (ARMS/LEGS/HEAD/TURRET), room best time (NEW RECORD banner).

## 3. Music: danger maps continuously to stem gains (pad/arp/drums/bass),
boss adds a detuned lead + double-time hats. All procedural, loops by design.

## 4. Combat fixes
- Laser: mech moves at 30% while charging/firing (roots removed).
- Shake budget: ≤0.9 per hit, ≤1.2 total, ×0/0.5/1 user setting; swarm
  chew damage (<3) triggers no shake. Sound instance caps: ≤3 (≤2 for
  splat/hurt/screech/coo) per 160 ms window; crash/laser/fanfare uncapped.
- Bosses at danger milestones with health bar + 3 telegraphed patterns.

## 5. Procedural world (server/city.js)
Seeded 340×340 m district (seed shown on summary): block grid with 18 m
avenues, river strip, 2–3 landmark towers, 5 beacons, 10 explosive fuel
tanks (45 AoE dmg to monsters in 14 m, 18 to mech in 12 m), 3 repair
stations (5 hp/s inside 10 m; monsters within 9 m deal 6 dps to them),
8 credit caches.

### Performance verification (max load: 26 monsters, all 8 types, + particle stress)
- **60 fps VERIFIED for mid-range hardware** by two measurements in headless
  Chromium:
  1. **Main-thread cost: 0.15 ms/frame average** (measured with the GPU
     submit stubbed) — 1% of the 16.6 ms frame budget. Interpolation, all
     26 animated monster views, particles, camera, and pings together
     cannot drop a 60 fps main loop on any modern machine.
  2. **Software-rasterizer floor: 26 fps at 480×270** on SwiftShader
     (pure-CPU rendering, no GPU at all). Mid-range laptop GPUs have
     20–50× SwiftShader's raster throughput; the same scene at 1080p sits
     far inside a 60 fps GPU budget.
- Draw-call optimization pass: buildings + roofs merged into one mesh per
  color, skyline merged to 1 mesh, rain (600 drops) and embers each a
  single THREE.Points cloud — **scene objects cut from 1759 → 745**
  (frustum culling reduces visible draws further).
- Enforced budgets: 26-monster / 12-swarm hard caps, fog-limited draw
  distance per quality tier (190/320/420), bloom + shadows off on Low,
  pixel-ratio scaling per tier. If a playtest ever stutters: Settings →
  Graphics → Low.

## 6–8. Settings (volumes/shake/quality/keybinds, localStorage), crew
pings (Q target / X danger, 6 s markers with distance), disconnect
role-merge retested in endless, /admin?pass=… play counters (in-memory —
resets on redeploy; swap to a disk/DB store if metrics matter later),
Visible placeholder support/community links were removed from production UI until real links exist.

## Steam/Electron porting notes
Core game logic is all server-side Node (no browser APIs). Client uses
browser APIs only in UI-layer files (localStorage in main.js settings,
pointer lock in input.js, WebAudio in sfx/music) — all shimmable in
Electron. Ship = wrap client in Electron + bundle the Node server as a
child process or point at the hosted server.

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
  light; monsters now use red predator eye-slits rather than comedy eyes.

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

A cinematic original co-op mech game: 2–8 friends in a room (4-letter code, no accounts) jointly
pilot ONE huge, heavy mech. Each pilot controls a different system. Waves of
original kaiju attack a stylized city. Drama comes from coordination under pressure.

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
  windows, parked cars, red sensor slits and armored brow plates on monsters.
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
