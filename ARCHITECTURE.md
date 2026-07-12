# Architecture — Crew of One V2

Browser game, no build step. Node server is authoritative for everything
that matters; browsers render and predict nothing.

```
├── server/                    Node (ES modules)
│   ├── index.js               express static + ws upgrade + health/admin
│   ├── rooms.js               room codes, players, role preview/rotation,
│   │                          loadout broadcast, mode select, game loop
│   ├── loadout.js             LoadoutCrew — collaborative hangar session
│   │                          (ownership, proposals, votes, locks, ready)
│   ├── mech.js                authoritative mech: physics body, stations,
│   │                          punches/kick/beam/cannon/pods/turret, build
│   │                          stats via shared/loadout deriveStats
│   ├── monsters.js            Abyssal behaviors (melee/ranged/flyer/swarm/boss)
│   ├── city.js                seeded ZONED district generator + collision
│   ├── brawl.js               ENDLESS: danger clock, spawner, economy, shop,
│   │                          destructible buildings
│   ├── classic.js             CLASSIC: waves + safe refit phase (extends brawl)
│   ├── duel.js                DUEL: two mirror-build mechs
│   └── training.js            TRAINING: objectives + live component swap
├── shared/                    imported by BOTH sides
│   ├── constants.js           tuning, roles, modes, messages
│   └── loadout.js             customization catalog, validateBuild,
│   │                          deriveStats, duel budget, paint clamps
├── public/
│   ├── index.html / style.css command-interface UI (hangar, HUD, refit)
│   └── js/
│       ├── main.js            app flow, HUD, hangar UI, shop, settings
│       ├── net.js             ws client + snapshot interpolation buffer
│       ├── input.js           role-gated input → server
│       ├── render.js          Renderer: world build, MechView (IK rig),
│       │                      camera, effects, upgrade preview
│       ├── mechfab.js         modular kitbash mech factory (see ASSET_PIPELINE)
│       ├── monsterfab.js      articulated creature views
│       ├── cityfab.js         district visuals: facades, roads, vehicles
│       ├── atmosphere.js      weather machine, rain, lightning, sky, clouds
│       ├── hangar.js          customization bay scene (orbit/zoom/highlight)
│       ├── music.js           adaptive procedural score
│       └── sfx.js             synthesized sound effects
└── test/
    ├── server-logic.test.js   headless gameplay units
    ├── rooms.test.js          room/role/lobby units
    ├── loadout.test.js        catalog validation + session rules
    ├── e2e.test.js            Playwright QA gate (2 real clients, all modes)
    ├── visual.test.js         screenshot evidence → docs/visual-review/
    └── playtest-bot.test.js   5-minute endless soak + perf measurements
```

## Authority & trust boundaries

- **Combat**: all hit resolution is server-side (melee wedges with
  windup→active→recover state machines, tracer travel, missile homing +
  splash, beam raycast). Clients only send inputs for the stations they
  hold; `applyInput` gates by role. Monster damage comes from telegraphed
  attack states, not overlap.
- **Builds**: hangar state lives in `LoadoutCrew` on the server. Every op
  is permission-checked (ownership/locks/host); every value goes through
  `validateBuild`; stats come from `deriveStats` at spawn. Clients never
  send stats.
- **Economy**: prices, credits and purchases are server-side (`buy()`),
  with tiered price growth. The snapshot's `up` state is what all clients
  render — purchases are visible to everyone and survive reconnect
  because they're in every snapshot.
- **World**: destructible building HP is server-side; collapses broadcast
  by id and are idempotently replayed from snapshots for late joiners.

## Netcode

20 Hz snapshots, 60 Hz physics. Clients render `INTERP_DELAY_MS` in the
past, interpolating between the two bracketing snapshots (`net.sample()`).
Events (hits, roars, purchases, collapses) piggyback on snapshots. Rooms
are 4-letter codes; a player IS their websocket (no accounts).

## Rendering

three.js r165, ACES filmic tonemapping, MSAA render target, restrained
UnrealBloom, PMREM environment for PBR metals. One directional shadow
that follows the action. Weather owns the light rig (see atmosphere.js).
The mech is a node hierarchy driven by snapshots: analytic two-bone IK
arms, gait with hip/knee/ankle articulation, chest twist toward aim,
head aim, eye charge, socketed upgrade attachments.

## Test / deploy pipeline

`npm test` = server-logic + rooms + loadout + full Playwright E2E.
`npm run qa` adds the 5-minute playtest bot. `node test/visual.test.js`
regenerates the screenshot evidence. Deploys are gated on `npm test`
(see PROGRESS.md / render.yaml — production tracks `main`, the V2
preview service tracks the V2 branch).
