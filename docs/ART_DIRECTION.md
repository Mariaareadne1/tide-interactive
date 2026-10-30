# TIDE — art direction

TIDE is the fifth piece in the family (MEADOW, POND, HIVE, SKY). Same hand, same page, the smallest idea yet: you draw in the wet sand with your finger, little crabs come and walk along your line, and the sea gently takes it back. It should feel quiet and a little bittersweet — never sad.

Measured against MEADOW's "Illustrated aerial references" (`meadow/docs/REFERENCE_ANALYSIS.md`): a painted tile floating on warm paper, seen from an elevated three-quarter angle, with gouache colour, a warm sun and lavender shade.

**Drawn pass (2026-10-30).** The palette stays soft (a brighter, map-like palette was tried and rolled back as too loud); what makes it feel *drawn* is ink and pencil on top of the paint: a wobbly sepia pen outline around everything that stands up from the sand (crabs, rocks, pebbles, seaweed, grass), a blue-grey pen line along the water's edge and the running wave, little arched pen strokes sketched over the sea, pencil hatching inside cast shadows and on the shaded side of rocks, and the paper's tooth under it all.

## Composition
- **The tile.** 20 × 15 world metres, standing for a 4 × 3 m cove (1 world m = 20 real cm). The camera sits on the +z side, so the **sea lies along the near edge and waves run up the screen** — their reach is easy to read, and the lines you draw sit in the middle of the page, above the toolbar.
- **Bands, front to back:** turquoise shallows into deep blue → a bowed shoreline (the cove curves back in the middle) → a band of darker, glossy wet sand (~2.5 m) → pale dry sand with old ripple marks → a broken line of washed-up seaweed at the high-water mark → dunes with marram grass along the back edge.
- **Accents:** a cluster of rounded rocks in the back-left dunes; an outcrop at the waterline on the right with a dark wet foot and a little green weed; pebbles thickest near the rocks and on the lower beach.
- **Clouds:** two small painted clouds drift along the back edge over the paper; their soft shadows (from clouds above the camera) slide across the sand.

## Palette (sRGB)
| | |
|---|---|
| Dry sand | `#eed9b0` → `#f4e3bd`, warm glaze pools, faint deeper painted patches |
| Wet sand | `#c7a175` → `#d3b083`, with a faint sky sheen |
| Groove trough | the sand underneath: warmer and damper (×0.8/0.68/0.54 dry, ×0.64/0.52/0.40 wet) |
| Shallows → deep | `#b4e4dd` → `#8ccad9` → `#74b2cf` |
| Foam | `#f7f9f4` |
| Crabs | coral `#ec8a6c`, apricot `#eaa56a`, rose `#e39488`, sand `#dcb07e`; pale belly `#f3dfc4`; claw tips umber |
| Ink | sepia pen ×(0.30, 0.25, 0.25) for outlines; blue-grey ×(0.34, 0.43, 0.52) at the water's edge, ×(0.5, 0.62, 0.74) for wave strokes; pencil hatch ×(0.6, 0.54, 0.6) |
| Paper | `#f4efe4` |

## The groove (the heart of the piece)
- A real height-field displacement: a trough with a slightly pushed-up lip either side. Normals come from the heightmap per pixel, so the shaded wall and the lit wall read as *pressed in* under the one painted sun.
- Wet sand: crisper, deeper, darker trough. Dry sand: wider, shallower, its edge crumbling grain by grain, the lip more pronounced.
- A few loose grains along the lips; a cavity darkening at the bottom.
- Drawn larger than life (a groove is ~4 cm of real sand, ~10 px at 1440 × 900) so it reads at the app's camera — MEADOW's rule for characters, applied to the line.

## The sea taking it
- A wave is a thin sheet of clear water — the sand stays visible under a pale turquoise glaze — with a lacy foam edge that is thick as it runs up and a fine broken thread as it draws back.
- It leaves the sand glossy and darker, then dries over a few seconds.
- It erases gradually: grooves smear and flatten over two or three waves; foam lingers in what is left of the line and its bubbles pop one by one.

## Crabs
- Rounded shells (flat belly, domed back, freckles, a pale sheen on the crown), tiny glossy black eyes on stalks with a catchlight, two plump claws, eight short jointed legs. No faces, no smiles.
- Larger than life: ~35 px across at 1440 × 900.
- They scuttle **sideways** with a quick alternating leg cycle; squash and stretch on stops, pops and waves.

## Rules carried from the siblings
- `new THREE.Color('#hex')` is already linear — never convert again.
- Shade on light colours turns lavender-grey, not darker of the same hue; the crab material uses a warm pink-lavender shade tint so coral never goes purple.
- Specks are round, never square hash cells.
- Shadows never arrive before the thing that casts them.
