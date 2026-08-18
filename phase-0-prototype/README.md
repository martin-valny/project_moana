# Phase 0 — Visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8. No live data, no backend — one hardcoded
fake swell ("Helena") crossing the North Atlantic, rendered on a cinematic
dark globe, with a draggable timeline, tap-to-select, and local-only
Follow.

The visual engine (the globe surface itself) is on its third iteration.
Round 1 used a GPU particle field for the ambient ocean texture. Round 2
replaced it with a domain-warped fractal-noise shader per a corrected
visual-engine brief. Round 3 (current) is a remediation pass against a
third brief that reviewed round 2's screenshots and found the sphere had
no actual curvature-driven shading (it read as a flat map cutout), the
bloom pipeline wasn't triggering, several UI elements had real CSS bugs,
and the exact colour palette needed calibrating against specific hex
values. See "The visual engine" and "Round 3: visual remediation" below.

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
2. If land: a tone nearly identical to deep ocean (barely a shade
   different), with a low-opacity coastline stroke picked out via the
   mask's screen-space derivative (`fwidth`) — a silhouette that rewards
   close inspection, not a map (§5.1 / brief-v3 Fix 6).
3. If ocean: fBm double-domain-warped (capped at 3 octaves feeding the
   warp itself so ribbons stay long and clean rather than finely
   speckled — brief-v3 Fix 2), animated by advecting the sample position
   over time, biased by Helena's current heading and scaled by her
   current (normalised) energy — so the flow's dominant direction and how
   defined the ribbons look are both real data, not arbitrary (§1.2). A
   three-stop colour ramp (near-black → cobalt → a pale cyan-white
   authored well above 1.0 so only the brightest crests trip the bloom
   threshold) with a secondary noise sample blending in sparse teal
   undertones (a minor accent, not a dominant tone).
4. **Curvature-driven shading** (brief-v3 Fix 1): the true per-fragment
   view direction (`normalize(-vViewPosition)`, not the camera's fixed
   forward axis) dotted with the surface normal darkens the surface
   toward the true geometric silhouette and stays full-bright facing the
   camera — the piece that was missing entirely in round 2, which is why
   it read as a flat map cutout instead of a lit sphere. The atmosphere
   shell uses the same true-view-direction approach for its Fresnel term.

**Scope note on the data bias:** Phase 0 has exactly one swell, not a
populated field, so the flow bias is a single global vector/scalar rather
than the per-cell direction/energy a real `SwellFieldFrame` will provide
from Phase 2 onward. It's still Helena's real current values, not a
constant — just not spatially varying yet, because there's nothing to vary
it by.

Bloom is selective (`luminanceThreshold` ~0.55, tuned empirically — see
"Round 3" below for why 0.85 caught nothing) so only ribbon crests, the
Helena marker/arc, and the atmosphere rim bloom, not the whole scene. The
Canvas explicitly sets `toneMapping: NoToneMapping` so HDR peak colours
reach the bloom pass unclamped. A very subtle film-grain pass sits
alongside the vignette; both are meant to be felt, not seen.

## Attribution decision (§3.3, revised in round 3)

A hairline "Data: Open-Meteo" credit originally sat permanently at the
bottom-right corner. Round 3's brief flagged this as debug-looking text
that shouldn't appear in the main experience, and Phase 0 has no live
Open-Meteo data yet (Helena is hardcoded) so the CC BY 4.0 "visible
wherever the data is displayed" requirement doesn't actually bite yet —
so the standalone label was removed. The wordmark ("MOANA.") is now the
tap target that opens the same "About the data" sheet, keeping the credit
reachable without adding a visible element. **This needs revisiting before
Phase 1 ships real data** — a wordmark-only affordance is a reasonable
call for a placeholder-data prototype, not obviously enough once the app
is actually displaying CC-licensed data; re-open this decision then rather
than assuming it's still settled. See `MASTER_BUILD_PLAN.md` §3.3/§11 row
17 for the original decision this revises.

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

## Round 3: visual remediation

A third brief reviewed round 2's screenshots and diagnosed one root cause
("the globe isn't shaded as a real 3D sphere") plus nine secondary
problems, each with a numbered fix and a self-check. All nine were
addressed:

1. **No curvature shading at all** — see "The visual engine" above. This
   was the real root cause; the surface shader had zero dependence on
   surface normal or view direction, so nothing about it could ever read
   as a lit sphere regardless of what the ocean texture looked like.
2. **Ribbons too speckled** — reduced the octave count feeding the domain
   warp itself (still using the full budget for the final sample), and
   increased warp strength, for fewer/longer/cleaner ribbon shapes.
3. **Atmosphere read as a flat ring** — same true-view-direction fix as
   #1, applied to the atmosphere shell's Fresnel term; also fixed an
   inverted-range bug in the `smoothstep` (see below).
4. **No bloom bleed** — two compounding causes: the Canvas wasn't
   disabling three.js's default tone mapping, so HDR peak colours were
   being clamped before the bloom pass ever saw them; and separately,
   `luminanceThreshold` was set high enough (0.85) that almost nothing in
   the actual rendered range crossed it. Fixed both, then re-tuned peak
   brightness and the colour ramp's upper band so genuine "crests" have
   enough separation from the mid-tones for a threshold to be meaningful.
5. **Palette calibration** — applied the brief's exact hex ranges for
   every colour stop (ocean deep/mid/bright/teal, atmosphere, land,
   coastline, panel fill/border, text).
6. **Land too detailed/high-contrast** — land fill dropped to nearly the
   same tone as deep ocean; only a low-opacity coastline stroke (derived
   from the mask's screen-space derivative, not a separate outline asset)
   remains visible, and only on close inspection.
7. **UI panel not genuinely translucent** — verified via a targeted test
   (rotate the globe so a bright/detailed area sits behind the panel,
   then screenshot): coastline shapes are visibly blurred through it, so
   the existing `backdrop-filter: blur(22px)` + low-opacity fill was
   already correct; no change needed here beyond confirming it.
8. **Debug text, timeline chips, starfield** — three separate real bugs,
   not just polish:
   - The attribution credit's plain-text presence in the main view — see
     "Attribution decision" above.
   - The timeline's active label rendered as a filled pill/chip. Root
     cause: `.stopLabel` and `.stopLabelActive` are applied as
     alternatives (never both at once), but only `.stopLabel` reset the
     browser's default `<button>` background/border — so the *active*
     state was the one leaking default button chrome. Fixed by moving the
     reset properties onto a shared selector both classes get.
   - Starfield count/brightness turned down so it reads as sparse and
     intentional rather than scattered debug dots.
9. **Path arc inconsistent with the ocean palette** — recoloured to the
   exact same deep/bright stops as the surface shader (including the same
   HDR headroom on the bright end), so it blooms consistently with the
   ribbon crests instead of looking like a separately-styled line
   overlay.

**A bug worth flagging on its own:** the atmosphere Fresnel fix in step 3
initially had the `smoothstep` edges in the wrong order for the corrected
(true per-fragment) view-direction math, which would have made the glow
brightest on the *far* side of the shell and dimmest at the rim — the
opposite of "brightest at the silhouette." Caught by reasoning through
what range `dot(normal, viewDir)` actually takes for a `BackSide`-rendered
shell (always ≤ 0, exactly 0 at the true silhouette) before trusting the
formula, not by screenshot alone — worth being deliberately suspicious of
sign/range assumptions in Fresnel-style shaders generally.

**Two self-check scripts** (ad hoc, not part of `npm run lint`/`build`,
kept because the brief's self-checks are worth re-running after future
shader changes):

- `rotate-test.mjs` — drags the globe to two different orientations and
  screenshots each, for visually confirming curvature shading and rim
  glow move correctly with orientation (Fix 1 / Fix 3's self-checks).
- `panel-glass-test.mjs` — rotates a detailed area behind the panel's
  screen position before opening it, to confirm the backdrop blur is
  actually showing globe content through (Fix 7's self-check).

**Not independently verified:** this remediation was tuned against the
brief's written description and hex values, not a literal pixel-level
comparison against the reference JPG it mentions (`46c566c2....jpg`) —
that file wasn't available to this session. If there's a meaningful gap
still, a direct side-by-side would catch it faster than more iteration
against the text description alone.

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
