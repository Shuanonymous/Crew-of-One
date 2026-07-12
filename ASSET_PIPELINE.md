# Asset Pipeline — Crew of One V2

## Honest constraints first

This project ships **no binary asset files**. The build environment for V2
had **no Blender** (verified: `which blender` → not installed) and the
sandbox cannot fetch third-party asset packs, so the GLTF/Blender leg of
the originally-planned pipeline is **blocked by unavailable tooling** and
documented as such in PROGRESS.md. Instead, V2 ships an **original
procedural kitbash pipeline**: every visible model is authored in code
from designed outlines, lathes and plate stacks — the "original kitbashed
parts created for this project" path. There are **zero downloaded assets**
(see ATTRIBUTION.md), which also keeps the licensing surface empty.

## Why this still meets the "no visible primitives" bar

Raw engine primitives read as primitives because of hard 90° corners,
single-material surfaces and unbroken silhouettes. The kitbash helpers
attack all three:

- `plateGeo/hexPlate/wedgePlate` — armor plates are **extruded 2D
  outlines with real bevels** (chamfered edges catch rim light).
- `latheGeo/pistonGeo/sleeveGeo` — smooth-shaded revolves for hydraulics,
  actuator drums, thruster bells, sensor domes.
- `ventGeo`, `cableGeo` — louvre banks and catenary cable runs for
  mechanical read-through.
- `hideGeo/shellGeo/spikeGeo` (monsterfab) — noise-displaced sculpts with
  recomputed smooth normals for organic mass; overlapping shell plates.
- Weathering/roughness/facade/decal sheets are generated CanvasTextures.

Primitive boxes remain ONLY where the rules allow: invisible physics
collision (cannon-es boxes), the distant skyline silhouette ring, debris
chunks, and building cores that carry world-unit-tiled facade sheets with
normal + emissive maps (they read as windowed architecture, not boxes).

## Performance architecture

- **Merge-per-material**: mech parts collect into per-node, per-material
  buckets (`Kit`) and bake into ~40–60 draw calls per mech.
- **Batching**: buildings merge per archetype+colour; lamps, traffic
  signals, parked vehicles, sidewalks, rubble each merge to a handful of
  draws; distant skyline is one mesh + one Points cloud.
- **Instancing**: rain is a single `InstancedMesh` (crossed-quad streaks).
- **Pooling**: tracers, missiles, smoke, scorch marks, debris chunks are
  pooled/capped.
- **Quality presets** (low/medium/high) scale pixel ratio, shadows, bloom,
  fog distance and rain count.
- Disposal: world groups dispose geometry on rebuild; mech fabs dispose on
  build changes.

## Adding a part (5 steps)

1. Add the catalog entry in `shared/loadout.js` (id, name, cost, stats,
   `requiresFrame` if constrained).
2. Author the geometry in `public/js/mechfab.js` inside the matching
   builder (`buildArm`, `buildLeg`, `buildShoulderMount`, …) using the
   kit helpers; write into an articulation node + material slot.
3. If it needs animation, expose a node in `buildMech`'s skeleton and
   drive it from `MechView` in `render.js`.
4. Stats apply automatically through `deriveStats`; server validation
   through `validateBuild`.
5. Add a line to MECH_CUSTOMIZATION.md and a case to the loadout tests.

## Future GLTF path (when Blender/asset tooling is available)

The renderer is standard three.js `MeshStandardMaterial` + Group
hierarchies, so swapping a procedural part for a GLB is mechanical:
load with `GLTFLoader`, attach under the same named node, keep the same
material slots. Export requirements when that day comes: Y-up, meters,
draco/meshopt compressed, ≤30k tris per mech part, PBR metal-rough,
baked AO in a second UV set, LOD1 at ~30% tris.
