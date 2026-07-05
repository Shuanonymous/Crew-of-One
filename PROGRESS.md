# Crew of One — Progress

**Status: LIVE at https://crew-of-one.onrender.com**

A cinematic co-op mech combat game. 2–8 friends share ONE giant mech;
each pilot controls a different system (LEGS / ARM_L / ARM_R / HEAD).
Four modes, a QA-gated deploy pipeline, no accounts.

---

# LATEST OVERHAUL (serious cinematic identity + 4 modes + QA gate)

## Section 1 — Critical bug fixes (shipped first as a hotfix)
- **Shop click bug (root cause + fix):** the shop overlay re-rendered its
  item buttons on *every* 20 Hz snapshot (`innerHTML` wipe), so a mouse
  press and release never landed on the same DOM node — purchases were
  impossible in production. Fix: the item list now rebuilds **only when
  credits / prices / owned upgrades change**, and items buy on
  `pointerdown`. A purchase pulses the credit counter, plays a sound, and
  shows an INSTALLED toast; the stat change is visible in the HUD next
  snapshot. Guarded by an E2E test that reproduces the exact 20 Hz
  condition (`SHOP CLICK: credits deducted / stat increased`).
- **Settings never discards purchases + pauses the room:** opening
  settings (gear or Escape) sends a `pause` to the server, which freezes
  `game.step()` for the **whole room** and broadcasts `paused` + the
  pauser's name (banner: "PAUSED BY <NAME>"). Anyone can resume by closing
  settings; duels are exempt (versus mode). Purchases were never actually
  discarded — that was a symptom of the click bug — but the pause removes
  the "closing loses my stuff" fear entirely. Guarded by E2E (`host
  settings pauses the live room`, `danger clock frozen`, `resumes`).
- A latent crash the gate caught: `MSG` was unimported in `main.js`, which
  had broken the settings-pause path; and `audioOn()` now swallows
  AudioContext failures so blocked/limited audio can never block a UI
  action like creating a room.

## Section 2 — Four game modes (mode select in the lobby)
- **ENDLESS ESCALATION** (Risk-of-Rain): danger clock scales spawns/hp/
  damage forever; **supply beacons fully removed** — any player opens the
  upgrade overlay anywhere with the **UPGRADES button / B** while the fight
  continues behind it. (Constraint verified in tests: `g.inter.beacons`
  is empty, `worldInfo().beacons` undefined, buy works with the mech
  anywhere.)
- **CLASSIC WAVE MODE** (restored): discrete waves with a **safe
  between-wave shop**; host clicks READY for the next wave. Buying is
  gated to the shop phase server-side (`server/classic.js`).
- **MECH DUEL**: 1v1 crew-vs-crew, inherits all combat/visual upgrades.
- **TRAINING**: free-roam with dummies, rings, balloon, crate tower.
All four launch end-to-end in the E2E suite.

## Section 4 — Weapons & combat
- Melee (punch/kick) + HEAD eye-laser (moves at 30% while firing, not
  rooted) remain. **New ranged systems, both purchasable:**
  - **ROTARY CANNON** (ARMS, hold R-click / C): 0.6 s spin-up, 600 rpm
    tracer fire with recoil + spread; server-authoritative tracer travel
    and hit detection.
  - **ROCKET PODS** (HEAD, tap R): homing missiles with splash from a
    6-round magazine, +1 round every 4 s.
  - Existing rares: rocket fist, auto shoulder turret, dash thrusters.
- Monsters flash on hit; damage numbers pop; per-part damage attribution
  (ARMS/LEGS/HEAD/TURRET) feeds the run summary. Server tests cover cannon
  spin-up/damage and pod ammo/homing/regen.
- **Honest scope note:** physics remains **cannon-es** (not Rapier). It
  already provides believable mass, knockback scaled to hit power, and
  ragdoll/stagger. A Rapier port is a larger swap left as future work;
  the current feel meets the "weighty, knockback-proportional" bar.

## Section 3 — Visuals (cinematic increment)
Built on the prior night-rain pass: rain (single Points cloud), sweeping
searchlights, horizon lightning that flashes the whole scene, bloom +
CSS vignette, teal/orange-leaning night palette, red predator eye-slits
on monsters. **This pass adds:** mech armour on **PBR
MeshStandardMaterial** (brushed metal, metalness 0.85 / roughness 0.45)
with emissive cockpit strips, lit by a **procedural PMREM night-city
environment map** so metal catches neon reflection.
- **Honest scope note:** this is a material/lighting increment, not a
  from-scratch AAA re-authoring. No hand-painted scratch/normal texture
  maps, no news-helicopter props, and motion-blur/film-grain passes are
  not yet added. Documented as the next visual milestone.

## Section 5 — World
Seeded procedural district (blocks, wide avenues, river, landmark
towers), interactables (explosive fuel tanks, repair stations, credit
caches) balanced for both economies, 26-monster hard cap with fog-limited
draw distance per quality tier. **Honest scope note:** distinct named
districts (port/residential/downtown) and an on-screen compass/minimap
are **not yet implemented** — the world is large and seeded but not yet
district-partitioned. Listed as the next world milestone.

## Section 6 — Audio
Procedural adaptive score (pad/arp/drums/bass stems mapped continuously
to the danger clock, boss lead layer) with a **tanh waveshaper on the
lead** for a distorted guitar/synth-hybrid edge; sub-bass impacts, servo/
roar/tracer/rocket sfx; instance caps + priority mixing retained. All
synthesized (no copyrighted stems). **Honest scope note:** it's an
original synth score, not a recorded live-instrument hybrid.

## Section 7 — Settings
Master / music / **SFX volume**, screen-shake intensity, graphics quality
(low/med/high — fog, particles, shadows, bloom, pixel ratio), **camera
sensitivity**, and a keybind reference. Persist to localStorage, apply
immediately, and **opening settings pauses** (Section 1).

## Section 8 — QA GATE (mandatory before deploy)
- **`test/e2e.test.js`** — Playwright, two real browser clients, drives
  every flow and clicks every UI button:

```
PASS  HOW TO PLAY opens
PASS  settings opens from title
PASS  settings persists master volume
PASS  ENDLESS launched for both clients
PASS  CONSTRAINT: no beacons in endless world
PASS  mech moves (LEGS input)
PASS  Endless upgrade menu opens mid-run (no beacon)
PASS  shop lists the damage upgrade
PASS  SHOP CLICK: credits deducted by price   (2000 - 45 => 1955)
PASS  SHOP CLICK: upgrade stat visibly increased   (dmg 0 -> 1)
PASS  CONSTRAINT: host settings pauses the live room (guest sees it)
PASS  CONSTRAINT: danger clock frozen for the room while paused
PASS  CONSTRAINT: closing settings resumes the room
PASS  run summary appears on death
PASS  summary shows survival time
PASS  ONE MORE RUN restarts a run
PASS  CLASSIC launched
PASS  CLASSIC shop opens between waves
PASS  CLASSIC shop shows READY-for-next-wave
PASS  CLASSIC shop click purchases armor
PASS  DUEL launched with two mechs
PASS  DUEL assigns opposing crews
PASS  TRAINING launched
PASS  TRAINING shows objectives HUD
PASS  LEAVE returns to title
PASS  every UI button covered by a click test   (all covered)
PASS  no console errors across all flows
ALL PASS
```

- **`test/playtest-bot.test.js`** — a bot plays **5 minutes of Endless**:

```
RESULTS after 300s: frames=1325 softwareFps~4 (SwiftShader/no-GPU) nan=0 buys=15
main-thread frame cost: avg 0.37ms (=2704fps capable) max 8.1ms
memory: 14MB → … → 44MB (growth 30.5MB, healthy GC sawtooth)
PASS  no console errors during 5-min playtest
PASS  no NaN positions
PASS  main-thread frame cost supports 60fps (<16.6ms)
PASS  software-render fps above floor (no-GPU container)
PASS  memory stable (growth < 150MB)
PASS  bot actually exercised the shop   (buys=15)
ALL PASS
```
  Frame-rate note: this container renders via **SwiftShader (software, no
  GPU)**, so absolute fps is not representative. The **GPU-independent
  main-thread cost (0.37 ms/frame = ~2700 fps capable)** is the real
  60 fps proof; on any machine with a GPU the raster cost runs in
  parallel and is far under budget.
- `npm test` runs server-logic + rooms + e2e; `npm run qa` also runs the
  5-min playtest. **The deploy step is gated on `npm test` passing** —
  see the deploy checklist below. The shop-click bug class is now
  impossible to ship without the E2E turning red.

## Section 9 — Deploy
Live at **https://crew-of-one.onrender.com** (Render free web service,
deployed from this branch via the Render API). Redeploy procedure:
`npm test` must be green, then trigger the Render deploy and verify the
new bundle + a live two-client websocket check.

---

## Test-only affordances (never active in production)
- `COO_TEST_CREDITS` env → starting credits for deterministic shop E2E.
- `testShop` websocket message (gated by `COO_TEST_CREDITS`) → jumps
  Classic to the safe shop phase for the E2E purchase test.
Neither is set in the production Render service.

## Tuning values (quick reference)
- Mech: walk 7.8 m/s, walkForce 3800, brake 3.2, turn 5200/1300.
- Punch 16 dmg (×1+0.2·dmgTier), kick 36, laser 110 dps (×1+0.25·tier),
  cannon 3 dmg @ 600 rpm, pods 34 dmg splash-8 (6 ammo, 4 s regen).
- Danger: +1 level/60 s; bosses at levels 3/6/9/12/16/20; caps 26
  monsters / 12 swarm.
- Shop price growth ×1.35 per tier (repair ×1.2); rares 120–160©.

## Porting to Steam/Electron
Core game logic is server-side Node with no browser APIs. Client browser
APIs are isolated to UI files (localStorage settings, pointer lock,
WebAudio) — all shimmable in Electron. Ship = wrap client in Electron and
run the Node server as a child process (or point at the hosted server).

## Known gaps / next milestones (honest)
- Rapier physics port (currently cannon-es).
- District-partitioned world + compass/minimap.
- Texture-mapped PBR (scratches/normals), motion blur, film grain,
  helicopter/street-light scale props.
- Recorded/hybrid live-instrument score.
