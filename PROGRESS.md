# Crew of One — Progress (V2 VISUAL & CUSTOMIZATION REBUILD)

**Production status: UNCHANGED.** V1 remains live at
https://crew-of-one.onrender.com deploying from `main`. Everything below
ships on the branch `claude/v2-visual-mech-rebuild-wu5u5g`; a separate
Render preview service is defined in `render.yaml`
(`crew-of-one-v2-preview`) and deploy steps are in PLAYTEST.md.
Rollback point: `main` @ `fc907ec` (tagged `v1-stable` locally; tag push
is blocked by the integration's branch-scoped credentials — the commit
hash is the rollback reference).

Status vocabulary used below, honestly:
- **VERIFIED** — covered by automated tests and/or reviewed in the
  captured screenshots (docs/visual-review/).
- **IMPLEMENTED** — code-complete and exercised by the smoke flows, but
  not pixel-reviewed from every angle.
- **PARTIAL / LIMITATION** — real, listed at the bottom, no disguises.

---

## 1 · Mech rebuild — VERIFIED
- New modular kitbash factory (`public/js/mechfab.js`): every visible part
  is authored geometry — beveled extruded plates (hex/wedge outlines),
  lathed hydraulics with sleeves, vent banks, cable runs, layered pauldrons,
  segmented abdomen, sculpted feet — merged per articulation node
  (~40–60 draw calls/mech). No visible raw engine primitive on the mech.
- Full articulation: hips/knees/ankles with level-sole compensation,
  analytic two-bone IK arms with elbows and outward pole vectors, chest
  twist toward aim, aiming head, charge-reactive eye. Walk gait, kick
  (windup/swing/recover), ragdoll and death poses are driven from
  server state.
- 3 frames × 3 heads × 3 torsos × 5 arms (per side) × 4 legs × 5 shoulder
  mounts (per side) × 3 armour kits × 6 paint presets + custom paint,
  4 decals, callsigns — all visibly different (screenshots 02/03).

## 2 · Pre-run collaborative hangar — VERIFIED
- The lobby IS the hangar: full-screen 3D bay (gantry, work lights, deck
  crew for scale, steam, hazard rings) with drag-orbit + wheel zoom +
  per-layer component highlight and an idle pose.
- Role-owned stations, named proposals, votes with majority auto-apply,
  locks, host resolution, ready check, localStorage presets, duel budget
  meter, live stat readout. All server-authoritative
  (`server/loadout.js` + `shared/loadout.js` validation/derivation).
- E2E-verified with two real browsers: sync, proposal-not-overwrite,
  majority vote application, incompatibility rejection, ready broadcast.

## 3 · Visible run upgrades + previews — VERIFIED
- Every shop upgrade physically attaches through the socket system
  (armor tiers walk down the body; pods/turret/cannon/thrusters/emitter
  hardware mount visibly). Replicated via snapshot `up` → identical on
  all clients and after reconnect. Hovering a shop item previews the
  attachment on the live mech before purchase (screenshots 11/12).

## 4 · Environment rebuild — VERIFIED
- Zoned district generator (server/city.js): glass core with setback
  towers, concrete commercial, brick residential, corrugated industrial
  quarter, flood-channel waterfront with embankments and cranes.
- Scale cues everywhere: parked cars/vans/buses, traffic signals,
  streetlights, lane dashes + crosswalks (real geometry), sidewalk
  aprons, entrance awnings with lit doorways, rooftop water towers/HVAC/
  antennas/parapets, billboards, war damage + rubble.
- Facades: per-archetype generated sheets with normal maps AND separate
  emissive window maps — windows glow at night regardless of wall tint.
  Destructible buildings preserved from V1 (server-side HP, synced
  collapses, rubble).

## 5 · Atmosphere & weather — VERIFIED
- Square particles are gone. Rain is ONE InstancedMesh of fine crossed-
  quad streaks, wind-sheared, density-limited near the camera.
- Weather machine rolls fronts during play (storm/rain/overcast/clear
  night/golden/dawn) crossfading sky gradient, fog, key/rim/fill,
  cloud deck, stars/moon/sun, lightning (real jagged bolt + delayed
  thunder). Wet-street roughness/puddle maps retained and improved.

## 6 · Camera — VERIFIED
- Close over-shoulder combat framing (the mech dominates the frame),
  chest-height target, shoulder offset, dynamic FOV on sprint/beam/kick,
  building-aware boom shortening, budgeted impact shake, camera-follow
  character fill so the hull never silhouettes out.

## 7 · Monsters — VERIFIED (models/anims), see limitation on variety
- New Abyssal family (`monsterfab.js`): Ravager bruisers (4 armored
  variants incl. Bulwark Titan and crested boss) rebuilt from
  noise-sculpted hides + overlapping shell plates with articulated
  4-leg gait, claw telegraphs/slams, jaw gape, stagger, hit flash,
  collapse deaths, bioluminescent weak-seam vents. Stormcaller
  (winged brute), Bile Spitter, Razorwing, Gnashers reworked to the
  serious palette with the same state-driven animation set.
- All combat remains telegraphed server-side state machines — no
  damage from overlap.

## 8 · UI rebuild — VERIFIED
- Command-interface: blue-black glass, thin steel borders, cyan/amber/red
  telemetry, uppercase tracked labels, mono numerals. The yellow
  prototype banner is gone; stations show as a slim top chip.
- New HUD: mech-silhouette status (tint tracks hull), systems readout
  (RKT ammo / CANNON state / SENTRY / THRUSTERS / PLATE tier), threat
  clock, credits, boss bar, crew states, ping markers, refit side-panel
  shop with previews, professional end report.

## 9 · Audio — IMPLEMENTED
- Score direction rebuilt: 96 BPM, low synthetic brass swells + heroic
  rising motif, war-tom fills, industrial anvil hits, sub bass; distinct
  hangar (pre-deployment) state; danger-driven continuous mix + boss
  layer. All procedural WebAudio, zero copied melodies.
- SFX remain the synthesized set (servos, impacts, beam, rockets, roars,
  thunder) with distance attenuation and instance caps.

## 10 · Four modes — VERIFIED
- Classic / Endless / Duel / Training all launch and run through the E2E
  gate. Customization feeds Classic+Endless; Duel is a mirror match under
  a 24-pt budget (validated server-side — fairness by construction);
  Training allows live component swapping.

## 11 · QA evidence — VERIFIED
- `npm test`: server-logic + rooms + loadout (22 new assertions) + full
  Playwright E2E — 35/35 PASS including 6 new hangar tests, two real
  browser clients, every UI button, zero console errors.
- `npm run visual`: 13 documented screenshots in `docs/visual-review/`
  (title, hangar default/customized, storm spawn, golden weather, melee,
  rockets, beam, monsters, boss, shop preview, upgraded mech, summary).
- `npm run playtest`: 5-minute Endless soak — see measured numbers in
  the "Performance" section below.

## Performance (measured honestly)
- Measured in this container via SwiftShader (software rasterizer — no
  GPU), so absolute FPS here is not representative of player hardware;
  the GPU-independent main-thread cost is the meaningful number.
- 5-minute Endless soak (playtest bot, quality=medium):
  main-thread frame cost **avg 2.68 ms/frame (≈373 fps capable), max
  22.3 ms**; memory 33→92 MB over 5 min with a healthy GC sawtooth
  (growth < 150 MB gate PASS); 0 console errors; 0 NaN positions; the bot
  bought 15 upgrades. Software-raster fps in the container was ~1 fps —
  that is SwiftShader CPU-rasterizing the full V2 scene and is logged as
  informational, not a gate; on real GPUs rasterization runs on the GPU
  while the measured main thread has ~14 ms of headroom.
- Budgets in place: instanced rain, merged/batched city, pooled
  effects/projectiles, monster cap (26), quality presets, disposal on
  rebuild. No 60 FPS claim is made for real GPUs beyond the main-thread
  headroom shown above — verify on the preview URL.

## Known limitations (nothing below is disguised as done)
- **No Blender/GLTF assets**: the container has no Blender and no asset
  network; the pipeline is procedural kitbash by design (documented in
  ASSET_PIPELINE.md with the GLTF migration path). LODs are budget-based
  (caps/fog/instancing) rather than per-mesh LOD chains.
- **Spitter/Razorwing/Gnasher** kept their V1 skeleton logic with
  reworked materials/sculpt helpers; the Ravager family and Stormcaller
  got the full rebuild. More per-species polish is future work.
- **Cannon barrels don't spin** visually and the Sentry turret doesn't
  track (merged geometry); muzzle/tracer effects carry the read.
- **Shield arm** soaks are passive DR; there is no projected-bubble
  shield VFX yet. Forge Rig repairs are a stat trickle + rig model, no
  welding-drone animation yet.
- **Weather ambience audio** (rain loop/wind bed) not yet tied to the
  weather machine; thunder is.
- **Boss screenshot uses a test-only summon hook** (COO_TEST_CREDITS-
  gated, inert in production) because reaching danger 3 takes 3 minutes.
- Duel is a mirror match (both mechs share the crew's build) — fair and
  budget-capped, but per-crew asymmetric duel builds are future work.
- Screenshots were captured under software rendering; on a real GPU the
  MSAA/bloom output is cleaner than the evidence PNGs.

## Test-only affordances (never active in production)
- `COO_TEST_CREDITS` env → deterministic shop E2E; also gates `testShop`
  and `testBoss` websocket hooks (visual suite only).
- `COO_TEST_SPAWN` env → seeds the spawner for deterministic tests.
None are set in any deploy config.
