# CREW of ONE — Art Direction: **STEEL RAIN**

One committed look, carried through render, UI, and sound. The reference
feel is a kaiju film shot on a long lens at night in the rain — not a
cartoon, not neon-cyberpunk candy: a grounded coastal city being taken
apart by something enormous while the power is still mostly on.

## The look, in one paragraph

An overcast storm deck, lit from below by the city. Cold blue-grey key
light, warm sodium practicals, teal–orange split-tone grade. Everything
is wet: the streets pool into broken mirrors, metal picks up neon.
Surfaces are *materials*, not colors — painted armor chips down to bare
steel, concrete streaks under windowsills, chitin plates dome and crack.
The camera is a documentary rig: handheld drift, rotational flinches on
impact, a fast FOV punch-in when something heavy lands.

## How it is built (no asset downloads, all procedural)

Every texture is authored at load into canvases and used as a full PBR
set (albedo / normal / roughness, plus emissive where things are lit):

| Surface | Sheet |
| --- | --- |
| Mech armor | per-crew-color painted plate: recursive panel seams, rivet rows, edge chips to bare steel, stencils (`NO STEP`, unit numbers, hazard chevrons), grime streaks. Normal map from a matching height field. |
| City facades | 3 architectural families (precast office / glass curtain wall / masonry industrial), each with an emissive sheet of scattered lit interiors (per-floor occupancy clustering, furniture silhouettes) and recessed-window relief. |
| Streets | wet asphalt: aggregate grain, repair patches, tar-snake cracks, oil stains — and a roughness map full of mirror puddles that catch the environment. |
| Kaiju | Voronoi chitin plates (glossy domes, rough seams, pale tubercles), anisotropic wrinkle-fold leather hide, wet blotched amphibian skin with raised warts, scalloped feather rows. Bodies are fBm-displaced hulls so no silhouette reads as a primitive. |
| Sky | a tiling storm-cloud dome, cold at the zenith, bruised sodium at the horizon, slowly rotating. |

Lighting rig: cold directional key (with soft shadows), warm sodium
counter-fill, cool rim, hemisphere storm ambient, a faint camera-follow
fill so the hero mech never collapses to silhouette, and a PMREM
environment (authored "night city" light cards) that all PBR metal and
water reflects.

Post chain (GPU tiers): GTAO (high) → tight bloom → grade pass
(lift/gain split-tone, S-curve, saturation, edge chromatic aberration,
animated grain, vignette, hull-critical red bleed) → ACES tone mapping.

Weather: instanced wind-sheared rain streaks, ground splash rings, low
drifting mist sheets, gust-breathing FogExp2, horizon lightning with an
actual jagged bolt mesh and delayed thunder.

## UI

Military-industrial glass: chamfered dark panels (clip-path), hairline
strokes, stencil headings with wide tracking, amber command accents,
segmented integrity bars, backdrop blur. No rotated stickers, no emoji.

## Sound

All synthesized, matched to the picture: inharmonic struck-plate clangs
with sub punch, servo-spooled windups, footstep ground-slam + armor
rattle, blast crashes that sweep down into rumble with debris crackle,
and a looping storm ambience bed (rain patter / gust LFO wind / city
rumble) under the adaptive score.

## Performance contract

- Quality tiers: low / medium / high (pixel ratio, shadows, GTAO, bloom,
  rain density, mist).
- A software rasterizer (SwiftShader/llvmpipe — CI, GPU-less VMs) is
  auto-detected and drops MSAA, bloom, the grade pass, and anisotropy so
  the game stays playable and the QA gate stays honest. `?fullfx` forces
  the full chain anywhere.
- All static city geometry is merged into a handful of draw calls; rain
  and light pools are single instanced meshes; displaced kaiju hulls are
  cached per type and shared.
