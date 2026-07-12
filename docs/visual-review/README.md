# Visual Review — Crew of One V2

Regenerate with `npm run visual` (writes into this folder). All shots were
captured by Playwright at 1600×900 under SwiftShader (CPU rasterizer — the
container has no GPU); real hardware renders the same frames with cleaner
MSAA/bloom.

## Before / after

| | |
|---|---|
| `00-BEFORE-v1-title.png` / `00-BEFORE-v1-spawn.png` | V1 (`v1-stable`, commit fc907ec): distant primitive mech, dark box city, square particles, yellow prototype banner |
| `04-city-spawn-storm.png` | V2 spawn: close cinematic camera, kitbashed mech, zoned district with lit facades, streak rain, command HUD |

Acceptance criteria from the brief, checked against these images:
- mech no longer reads as raw primitives → 02/03/04/12
- mech no longer tiny in frame → 04/06/08/12
- buildings no longer repeated black boxes → 04/09/10/12 (zoned archetypes, emissive windows, roads, vehicles)
- rain no longer giant squares → 04 (instanced streaks)
- UI no longer the yellow prototype → all shots (command interface)
- upgrades change the mech physically → 11 (hover preview) vs 12 (installed)
- monsters animate (gait/telegraph/stagger/death) → 09/10/12 (poses differ per state; motion verified in the E2E/playtest runs)

## Index

| File | What it proves |
|---|---|
| 01-title | command-styled title over the living district |
| 02-hangar-default | hangar bay: gantry, deck crew scale cues, default Warden |
| 03-hangar-customized | Bastion + Piledriver + Bulwark + Hydra + Sentry + Siege kit + Vermilion paint; stat tradeoffs visible |
| 04-city-spawn-storm | storm front, streak rain, road markings, scale cues |
| 05-weather-golden | same district under the golden-hour front (weather machine range) |
| 06-melee-swing | punch active frames (IK arm extension) |
| 07-rocket-launch | Hydra pod launch + trails |
| 08-beam-firing | convergence beam charge/fire state |
| 09-monsters | Ravager pack: articulated gait, shell plates, vent glow |
| 10-boss | named boss banner + crested boss Ravager |
| 11-shop-upgrade-preview | refit panel with hover preview ON the live mech |
| 12-upgraded-mech | purchased plate/pods/cannon/thrusters physically installed |
| 13-run-summary | operation report screen |
