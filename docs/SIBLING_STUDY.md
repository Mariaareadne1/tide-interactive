# What TIDE takes from its siblings

All four siblings are MIT-licensed by the same author; TIDE copies and adapts their code and keeps no cross-repo imports.

| From | Taken | Changed for TIDE |
|---|---|---|
| MEADOW / HIVE `engine/Engine.ts` | renderer, fixed-step override, dynamic resolution with a median + lockout, GPU-synced capture | none beyond naming |
| `engine/post.ts` | Khronos PBR Neutral tone curve, lavender shadow grade, vignette, grain | none |
| `engine/shadows.ts` | one sun shadow map with contact-hardening receivers | box fitted to a low beach (−0.3 … 1.6 m) |
| `scene/shaderChunks.ts` | `paintLight`, `castLight`, noise | adds `uCalm` |
| `scene/camera.ts` | elevated 3/4 camera solved to fit the tile, quarter turn on portrait | none |
| `scene/terrain.ts` + `groundGlsl.ts` | painted ground, dry-brush `paintEdge`, TS↔GLSL twin generated from the same numbers | becomes beach + swash + sea in one surface, sampling the sand heightmap |
| `scene/details.ts` | instanced painted tufts | marram grass leaning away from the sea |
| `scene/paint.ts` | the gouache prop material | used for rocks, pebbles, seaweed and the crabs |
| POND `scene/water.ts` | foam bands, glints, ripple rings, sky reflection | painted into the sea branch of the beach shader |
| POND `creatures/pose.ts` + behaviours/controllers | flat numeric poses, pure time behaviours, cross-fades, `pulse`/`ring` helpers | crab keys; controller plans for lines and waves |
| HIVE `interaction/PointerInput.ts` | one pointer state machine, coalesced events, pointer capture, second-finger abort | press on sand stamps live; sea ripples; off-tile shiver |
| MEADOW `DrawingOverlay` | ink that shivers away | used only for strokes off the tile |
| `capture/recorder.ts` | MP4/WebM negotiation, compositing canvas | no ink layer: the line is in the scene |
| `scripts/*.mjs`, `playwright.config.ts` | shoot / strip / sheet / perf, Metal ANGLE | adapted to the beach |

Lessons applied: colours from hex are already linear; things mid-animation stay pickable (crabs are picked by their live, animated position); the dev machine is often loaded, so frame benchmarks run back-to-back with a GPU readback after each.
