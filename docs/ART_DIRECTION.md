# TIDE — art direction

TIDE is the fifth piece in the family (MEADOW, POND, HIVE, SKY). Same hand, same page, the smallest idea yet: you draw in the wet sand with your finger, little crabs come and walk along your line, and the sea gently takes it back. It should feel quiet and a little bittersweet — never sad.

Measured against MEADOW's "Illustrated aerial references" (`meadow/docs/REFERENCE_ANALYSIS.md`): a painted tile floating on a white page, seen from an elevated three-quarter angle, with gouache colour, a warm sun and lavender shade.

**Brighter pass (2026-10-30).** Retuned toward bold illustrated aerial maps — golden fields, cobalt rivers, crisp greens on white: flat, saturated colour fields with painted tonal patches and definite soft shadow shapes, rather than the earlier pastel wash. Shade is lighter, the final grade adds saturation instead of restraining it, and the vignette is nearly gone so the page reads white.

## Composition
- **The tile.** 20 × 15 world metres, standing for a 4 × 3 m cove (1 world m = 20 real cm). The camera sits on the +z side, so the **sea lies along the near edge and waves run up the screen** — their reach is easy to read, and the lines you draw sit in the middle of the page, above the toolbar.
- **Bands, front to back:** turquoise shallows into deep blue → a bowed shoreline (the cove curves back in the middle) → a band of darker, glossy wet sand (~2.5 m) → pale dry sand with old ripple marks → a broken line of washed-up seaweed at the high-water mark → dunes with marram grass along the back edge.
- **Accents:** a cluster of rounded rocks in the back-left dunes; an outcrop at the waterline on the right with a dark wet foot and a little green weed; pebbles thickest near the rocks and on the lower beach.
- **Clouds:** two small painted clouds drift along the back edge over the paper; their soft shadows (from clouds above the camera) slide across the sand.

## Palette (sRGB)
| | |
|---|---|
| Dry sand | gold `#f7d46b` → `#ffe387`, with darker ochre painted patches (×0.9/0.84/0.74) and warm glaze pools |
| Wet sand | ochre `#e5ab52` → `#edb861`, with a faint sky sheen |
| Groove trough | the sand underneath: warmer and damper (×0.84/0.66/0.46 dry, ×0.68/0.50/0.34 wet) |
| Dunes | a meadow of `#459a38` → `#7abd3d` with a crisp, wandering edge; marram tufts `#3d9438` → `#a8d64d` |
| Shallows → deep | turquoise `#52dbd6` → `#219ed6` → cobalt `#1f61c2` |
| Foam | `#f7f9f4` |
| Crabs | red `#f0523a`, orange `#f47a2c`, raspberry `#e8455c`, coral `#ff6a4a`; pale belly; claw tips dark umber |
| Rocks | blue-slate `#c2c8dc` → `#8b94b4`, darker wet foot |
| Seaweed | greens `#1f5a34` → `#5a8a2c` |
| Paper | white `#fcfbf8` |

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
