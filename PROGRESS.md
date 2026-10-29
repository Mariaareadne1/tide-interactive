# Progress

| Milestone | State |
|---|---|
| 0. Repo, sibling study, art direction | done — `docs/SIBLING_STUDY.md`, `docs/ART_DIRECTION.md` |
| 1. Painted cove tile | done — sand (dry/wet, ripple marks, grains), sea (shallows, foam lines, glints, ripples), dune grass, rocks, pebbles, seaweed line, clouds and cloud shadows, sun shadows |
| 2. Sand heightmap and live drawing | done — live groove with trough and lip, wet vs dry character, undo |
| 3. Waves | done — deterministic schedule, run-up / pause / draw-back, foam edge, wet gloss and drying, gradual erosion, foam and bubbles in grooves |
| 4. Crabs | done — model, sideways scuttle, following lines (corners, ends), word strokes grouped, fleeing or burrowing from waves and returning, pottering and greeting; selection, Follow / Wave / Burrow, dragging |
| 7. Third round (2026-10-29) | done — Add a crab is now tap-to-place with a + cursor (no drawing); the dance is the Can-Can at 144 BPM, ~11 s instead of ~20 s; fixed undo leaving the renderer's clear colour transparent black, which blacked out the paper behind the beach after every undo (and so after every hatch) |
| 6. Second round (2026-10-27) | done — draw a crab (Add a crab + a closed loop), everyone lines up and dances to a synthesised calypso, footprints and burrow hollows, sound (surf, fingertip, crabs, song; mute remembered; recordings carry it), lacier sea foam, froth, caustics and a glisten on receding water |
| 5. UI, capture, mobile, reduced motion, polish, demo, docs | done — see README; demo at `docs/media/tide-demo.mp4` (18.9 s, 1600 × 900 source, 59.6 fps) |

Checks at the last commit: 31 unit tests, 19 E2E tests on dev and on the production build, typecheck, lint and build all pass.

Deployed 2026-10-27 at https://tide-interactive.vercel.app (Vercel CLI; redeploy with `npx vercel --prod` after pushing).

Open: the limits listed at the end of `CASE_STUDY.md`.
