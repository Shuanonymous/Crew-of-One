# Mech Customization — layers, ownership, voting, networking

The whole crew builds ONE shared mech in the hangar before a run. The
server owns the build at all times; clients only render it and file
requests.

## Layers

| Layer | Catalog (shared/loadout.js) | Visible change | Stat change |
|---|---|---|---|
| `frame` | Vanguard / Warden / Bastion | silhouette widths, extra plate on Bastion | hp, speed, turn, mass, DR |
| `head` | Oracle / Cyclops / Talon | sensor cluster, single optic, hawk visor | beam charge/damage, lock range |
| `torso` | Aegis / Furnace / Rampart | reactor iris, radiator stacks, glacis slabs | cooling (beam burn), DR, speed |
| `armL` / `armR` | Breaker / Piledriver / Falchion / Howler / Bulwark | fist, ram, blade fin, tri-barrel cannon, tower shield | melee mult, grants cannon, DR |
| `legs` | Strider / Colossus / Vector / Anchor | greaves, stompers, calf thrusters, outriggers | speed, kick, stability, grants dash |
| `shoulderL` / `shoulderR` | Empty / Hydra / Sentry / Projector / Forge | rocket pod, auto turret, emitter vanes, crane rig | grants pods/turret, DR, regen |
| `armorKit` | None / Skirmish / Siege | applique plates chest→limbs | DR vs speed |
| `paint` | 6 curated presets + custom | primary/secondary/accent/emissive, finish, weathering | none |
| `decal` | stripes / digits / wedge / crest | chest + pauldron markings | none |
| `callsign` | free text (sanitized) + presets | hangar nameplate | none |

Compatibility (enforced server-side in `validateBuild`):
- Bulwark shield and Siege kit require Warden or Bastion frames.
- Vector thruster legs require Vanguard or Warden frames.
- Custom paint is hex-validated and luminance-clamped.

## Sockets

`mechfab.js` exposes named articulation nodes; attachments bolt into them:
`sockL`/`sockR` (shoulder hardpoints), `foreArmL/R`, `fistL/R`, `shinL/R`,
`hipL/R`, `chest` (backpack), `head` (emitter). Run upgrades reuse the same
sockets (see "Run upgrades" below), so hangar gear and field refits never
overlap: a mid-run Hydra purchase lands on a free shoulder or the backpack.

## Role ownership

Stations are previewed in the hangar (`previewRoles`) and are exactly the
roles the next run will use.

| Layer | Owner |
|---|---|
| legs, torso | LEGS (pilot) |
| armL, shoulderL | ARM_L |
| armR, shoulderR | ARM_R |
| head | HEAD (fire control) |
| frame, armorKit, paint, decal, callsign | SHARED (crew decision) |

2–3 player crews combine automatically because ownership follows the role
split (e.g. in a 2-crew, the arms+head player owns both arms, both
shoulders and the head). Solo players own everything.

## Proposals, votes, locks, host resolution

- The **owner** of a layer edits it directly.
- Anyone else's pick becomes a **proposal** carrying their name; it never
  silently overwrites. Proposals collect votes; a **strict majority
  auto-applies**. The owner (or host) can **accept** or **dismiss** at any
  time.
- Any owner can **lock** a layer; locked layers reject every change until
  the locker (or host) unlocks.
- The **host is the deadlock-breaker**: host set/accept always lands.
- Every applied change **clears the ready check**; the crew list shows
  per-player READY state and the launch button reflects it. The host can
  still launch without full ready (host confirmation fallback).
- A sensible default build (Warden/Oracle/Aegis/Breakers/Strider) means a
  crew can hit LAUNCH immediately.

## Presets

Saved to `localStorage` (`coo-presets`) — no accounts. Loading a preset
applies the layers you own and leaves the rest to the crew (the host can
apply a preset wholesale).

## Networking & authority

- Client → server: `{ t:'loadout', op, layer, value }` with ops
  `set | propose | vote | accept | dismiss | lock | unlock | ready | preset`.
- Server → room: full serialized state `{ build, owners, locks, proposals,
  ready, rev }` after every change (also on join, so late joiners sync).
- On START the server re-validates the build (`validateBuild`), enforces
  the **duel budget** (24 pts, mirror-match: both duel mechs run the same
  validated build so there is no stat advantage), derives all gameplay
  stats server-side (`deriveStats`) and bakes them into the `Mech`.
- The mech snapshot carries `build` + `up`, so every client (including
  reconnects/late spectators) renders identical components, colours and
  attachments.
- TRAINING allows live `set` ops mid-run (instant component swapping via
  `game.setBuild`), preserving hull fraction.

## Run upgrades (visible, synchronized)

Every shop purchase physically modifies the mech through the same socket
system, replicated via the snapshot `up` field:

| Upgrade | Visible change |
|---|---|
| COMPOSITE PLATING T1–T5 | chest slab → pauldron caps → forearm guards → thigh plates → shin plates |
| FIST SERVOS T1–T3 | knuckle rings → emissive knuckle bar → forearm conduits |
| ACTUATOR OVERDRIVE | calf pistons, then booster nozzles with glow |
| CAPACITOR BANKS | head emitter conduits → cooling fins → spine conduit |
| ROCKET FIST | forearm booster nozzles |
| SHOULDER TURRET | Sentry gun on a free shoulder (backpack if both taken) |
| ROCKET PODS | Hydra pod on a free shoulder (backpack if both taken) |
| ROTARY CANNON | underslung tri-barrel on the right forearm |
| DASH THRUSTERS | backpack booster pack (unless Vector legs already carry it) |

The refit shop previews any hover **live on the deployed mech** before
purchase (`renderer.previewUpgrade`).
