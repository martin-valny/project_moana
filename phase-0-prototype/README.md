# Phase 0 — Visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8. No live data, no backend — one hardcoded
fake swell ("Helena") crossing the North Atlantic, rendered on a cinematic
dark globe, with a draggable timeline, tap-to-select, and local-only
Follow.

The visual engine (the globe surface itself) is on its second iteration.
The first used a GPU particle field for the ambient ocean texture; it was
replaced with a domain-warped fractal-noise shader per a corrected
visual-engine brief — a single shader pass that reads as marbled, swirling
cobalt/cyan ribbons rather than discrete points, matches the intended art
direction far more closely, and is cheaper to render. See "The visual
engine" below.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173, instant HMR — author here
npm run build      # typecheck + production build
npm run preview    # serve the production build
npm run lint       # oxlint
```

Authored in a browser per §5.2 ("iterate on web, judge on phone") — Vite +
React Three Fiber, not Expo. Judge it by loading `npm run dev`'s URL on a
physical phone (same Wi-Fi network, `vite --host` if needed) or after
deploying the `npm run build` output, held in the hand, at night.

## What's here

- `src/data/` — the hardcoded `SwellPulse`/`SwellPathPoint` types (mirrors
  `MASTER_BUILD_PLAN.md` §9.1) and Helena's invented path (`helena.ts`),
  anchored to whenever the app loads so "Now" always makes sense.
  `interpolate.ts` reads an arbitrary point in time off that path — the
  only thing the timeline is allowed to move — and normalises her energy
  to 0..1 for the shader.
- `src/three/` — the globe:
  - `GlobeSphere` — one shader pass doing three things at once: samples a
    real (if deliberately coarse) coastline mask for orientation, renders
    the domain-warped fBm "swell surface" over ocean, and (a second mesh)
    a Fresnel atmosphere rim glow. Land and ocean share one pass so
    they're always in registration.
  - `shaders/noise.ts` — the standard Ashima/Gustavson 3D simplex noise.
  - `shaders/fbm.ts` — fractal Brownian motion plus a **double** domain
    warp (Iñigo Quilez's technique — one warp layer still reads as
    blobby clouds; the second is what actually produces long, marbled,
    self-similar ribbons instead).
  - `HelenaPath` — the one data-driven, tappable trail: a thin raised arc
    (bows up mid-path, settles at the ends) with a cobalt→bright-cyan
    vertex-colour gradient keyed to each waypoint's energy, in the same
    palette family as the surface shader rather than a separate line
    graphic.
  - `qualityTier.ts` — a single startup heuristic (cores/memory/mobile
    UA/reduced-motion) picking an octave count + bloom mip-blur setting
    once, not per frame (shader recompilation is expensive; branching
    isn't worth it for this).
- `src/components/` — `Masthead` (wordmark + tagline, top-left),
  `Timeline` (thin draggable timeline, Now/Tomorrow/3 Days as labelled
  snap points, not the only reachable positions), `SwellPanel` (the
  right-side glass panel: name, one uppercase descriptor, Follow —
  deliberately nothing else), `Attribution` (§3.3 decision — see below).
- `src/hooks/useFollow.ts` — Follow persistence via `localStorage`, the
  web stand-in for §9.2's AsyncStorage requirement (same key/shape,
  trivial swap when this ports to Expo).
- `scripts/generate-land-mask.mjs` — one-time asset generator, not part of
  the app build. Rasterizes `world-atlas`'s real 110m land topology into
  `public/textures/land-mask.png` (1024×512, single channel) via a plain
  scanline polygon fill — no native canvas dependency. Re-run it if the
  mask ever needs regenerating; the output is otherwise checked in.

## The visual engine

`GlobeSphere`'s fragment shader, per fragment:

1. Reconstructs lat/lon directly from the fragment's normalized sphere
   position (not the built-in UV attribute) so the land mask lookup is
   guaranteed to agree with `geo.ts`'s lat/lon-to-vector3 convention used
   everywhere else in the app.
2. If land: a flat, restrained tone — a silhouette for orientation, not a
   map (§5.1: "barely visible... not enough to read as an atlas").
3. If ocean: 5-octave fBm, double-domain-warped, animated by advecting
   the sample position over time, biased by Helena's current heading and
   scaled by her current (normalised) energy — so the flow's dominant
   direction and how defined the ribbons look are both real data, not
   arbitrary (§1.2). A three-stop colour ramp (near-black → cobalt → a
   pale cyan-white authored above 1.0 so only the brightest crests trip
   the bloom threshold) with a secondary noise sample blending in
   occasional teal undertones.

**Scope note on the data bias:** Phase 0 has exactly one swell, not a
populated field, so the flow bias is a single global vector/scalar rather
than the per-cell direction/energy a real `SwellFieldFrame` will provide
from Phase 2 onward. It's still Helena's real current values, not a
constant — just not spatially varying yet, because there's nothing to vary
it by.

Bloom is tuned selective (`luminanceThreshold` ~0.85) so only ribbon
crests and the atmosphere rim bloom, not the whole scene — global bloom
was explicitly ruled out (it reads as a wash, not "premium"). A very
subtle film-grain pass sits alongside the vignette; both are meant to be
felt, not seen.

## Attribution decision (§3.3)

Made here, not deferred: a hairline "Data: Open-Meteo" credit sits
permanently at the bottom-right corner (satisfies CC BY 4.0's "visible
wherever the data is displayed" unconditionally), and tapping it opens a
one-tap sheet with the full credit, CC BY 4.0 link, and a note that Phase 0
itself has no live data. Both options from the plan, combined rather than
chosen between. See `MASTER_BUILD_PLAN.md` §3.3/§11 row 17.

## A flag worth reading (§0 rule 2: "flag, don't silently build")

`Masthead` renders the literal text "MOANA." as a wordmark, because the
reference image and brief specified it. `MASTER_BUILD_PLAN.md` §12.1 is
explicit that "Moana" is an internal codename only, not clear for logos,
brand assets, domains, or store listings. A plain text string in a
throwaway web prototype is not a domain or a designed logo and costs
nothing to change later, so it was left in rather than blocking on it —
but it genuinely is a "brand asset" in spirit, and should be swapped
before this prototype is shown outside the immediate working group, and
certainly before anything resembling it ships.

## Build bugs worth knowing about (fixed, but instructive)

- **Round 1 (particle field, since replaced):** the point-size formula's
  distance-scale constant was tuned for a different camera setup and came
  out ~15-20x too large, so thousands of points rendered as huge
  overlapping blobs; bloom turned that into a solid moiré mess. Root cause
  was never in the noise/motion logic — always screenshot a running build
  rather than trusting a clean typecheck.
- **The base globe was originally near-invisible:** `meshStandardMaterial`
  on a near-black colour under three.js's physically-correct light units
  needs much higher light intensities than the scene had. Fixed (both
  then and in the current shader-based globe) by not depending on scene
  light intensity at all — the surface shader supplies its own colour.
- **Single domain warp reads as clouds, not ribbons:** the first fBm pass
  (one warp layer) produced blobby, cauliflower-like clusters. Iñigo
  Quilez's double-warp technique (warp the warp) is specifically what
  turns that into the long, self-similar, marbled ribbon look — documented
  in `shaders/fbm.ts` since it's easy to reintroduce the single-warp
  version by accident while tuning.

## Falsifiable test — not yet run

§8's actual Phase 0 gate: **hand the phone to five people who don't surf,
say nothing, and time whether they rotate the globe unprompted for 30+
seconds.** This requires physical devices and real people and hasn't been
run yet — see `PROGRESS.md` for what's been verified instead (build,
render correctness, interaction wiring via an automated Playwright smoke
test, and visual review against the reference brief) and what's still
outstanding.

`smoke-test.mjs` is a Playwright script (not a human test, just a
regression check) that loads the built app headlessly, verifies no console
errors, taps Helena's marker, follows her, moves the timeline, and opens
the attribution sheet. Run it against `npm run preview` on port 4173:

```bash
npm run build
npm run preview -- --port 4173 &
node smoke-test.mjs
```
