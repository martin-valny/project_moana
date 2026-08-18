# Phase 0 — Visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8. No live data, no backend — one hardcoded
fake swell ("Helena") crossing the North Atlantic, rendered on a cinematic
dark globe, with a draggable timeline, tap-to-select, and local-only
Follow.

The visual engine (the globe surface itself) is on its fifth iteration.
Round 1 used a GPU particle field. Round 2 replaced it with a domain-warped
fractal-noise shader. Round 3 fixed missing curvature shading, a dead bloom
pipeline, and several CSS bugs. Round 4 was the first pass with the actual
reference image in hand and fixed structural issues (anisotropic ribbons,
framing, a real land-mask bug). Round 5 replaced the shading model
itself — the globe had curvature but no actual light, which read as "obvious"
shading rather than a lit 3D object. Round 6 (current) wasn't new user
feedback — it evaluated an external "visual fix pack" against the real
build, rejected 4 of its 5 claims as stale/inapplicable, and fixed the one
real issue it found (a straight-segment swell path, now a true spline). See
"Round 5" and "Round 6" below.

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
  snap points, not the only reachable positions), `SwellPanel` (right-side
  detail: name, one uppercase descriptor, path arc, Follow — no card or
  panel background, just a hairline rule), `Attribution` (§3.3 — see below).
- `src/hooks/useFollow.ts` — Follow persistence via `localStorage`, the
  web stand-in for §9.2's AsyncStorage requirement (same key/shape,
  trivial swap when this ports to Expo).
- `scripts/generate-land-mask.mjs` — one-time asset generator, not part of
  the app build. Rasterizes `world-atlas`'s real 110m land topology into
  `public/textures/land-mask.png` (2048×1024, single channel) via a plain
  scanline polygon fill — no native canvas dependency — then box-blurs it so
  the shader can derive a smooth coastline contour. Re-run it if the mask
  ever needs regenerating; the output is otherwise checked in.

## The visual engine

`GlobeSphere`'s fragment shader, per fragment:

1. Reconstructs lat/lon directly from the fragment's normalized sphere
   position (not the built-in UV attribute) so the land mask lookup is
   guaranteed to agree with `geo.ts`'s lat/lon-to-vector3 convention used
   everywhere else in the app.
2. If land: a tone nearly identical to deep ocean (barely a shade
   different), with a low-opacity coastline stroke taken as a narrow band
   around the blurred mask's 0.5 contour — a silhouette that rewards close
   inspection, not a map (§5.1).
3. If ocean: the sample position is first split along/across the flow
   direction and scaled unequally, so features run ~10x longer along the
   flow than across it — this anisotropy is what makes ribbons rather than
   curls, and no amount of colour tuning substitutes for it. That
   coordinate then feeds double-domain-warped fBm, advected over time,
   biased by Helena's real current heading and scaled by her current
   (normalised) energy, so both the dominant flow direction and how
   defined the ribbons look are real data, not arbitrary (§1.2). A
   three-stop colour ramp (near-black → cobalt → a pale cyan-white
   authored well above 1.0 so only the brightest crests trip the bloom
   threshold), with a secondary low-frequency sample adding sparse teal
   patches (a minor accent, never a dominant tone).
4. **Curvature-driven shading**: the true per-fragment view direction
   (`normalize(-vViewPosition)`, not the camera's fixed forward axis)
   dotted with the surface normal. Round 2 had no such term at all, which
   is why the globe read as a flat map cutout; round 3 added it but
   darkened the limb nearly to black, which read as a dark ball inside a
   ring. It is now mild falloff plus an *additive* scattering term peaking
   at the silhouette, so the edge is luminous. The atmosphere shell uses
   the same true-view-direction approach for its Fresnel term.

**Scope note on the data bias:** Phase 0 has exactly one swell, not a
populated field, so the flow bias is a single global vector/scalar rather
than the per-cell direction/energy a real `SwellFieldFrame` will provide
from Phase 2 onward. It's still Helena's real current values, not a
constant — just not spatially varying yet, because there's nothing to vary
it by.

Bloom is selective (`luminanceThreshold` ~0.6, tuned empirically — see
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
so the standalone label was removed. The wordmark ("MOANA") is now the
tap target that opens the same "About the data" sheet, keeping the credit
reachable without adding a visible element. **This needs revisiting before
Phase 1 ships real data** — a wordmark-only affordance is a reasonable
call for a placeholder-data prototype, not obviously enough once the app
is actually displaying CC-licensed data; re-open this decision then rather
than assuming it's still settled. See `MASTER_BUILD_PLAN.md` §3.3/§11 row
17 for the original decision this revises.

## A flag worth reading (§0 rule 2: "flag, don't silently build")

`Masthead` renders the literal text "MOANA" as a wordmark, because the
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

**Self-check scripts** (ad hoc, not part of `npm run lint`/`build`, kept
because these checks are worth re-running after any shader change):

- `shot.mjs` — one landscape + one portrait screenshot, for eyeballing the
  visual against the reference. The fastest loop while tuning.
- `rotate-test.mjs` — drags the globe to two different orientations and
  screenshots each, for confirming curvature shading and rim glow move
  correctly with orientation.
- `panel-glass-test.mjs` — rotates a bright, detailed area behind the
  panel before opening it, to confirm the scrim stays faint enough to see
  the globe through.

**Not independently verified:** this remediation was tuned against the
brief's written description and hex values, not a literal pixel-level
comparison against the reference JPG it mentions (`46c566c2....jpg`) —
that file wasn't available to this session. If there's a meaningful gap
still, a direct side-by-side would catch it faster than more iteration
against the text description alone.

## Round 4: working from the reference

Rounds 1–3 were tuned against *prose* ("long silky ribbons"). With the
reference image available, most of the remaining gap turned out to be
structural rather than a matter of tuning:

1. **The noise was isotropic.** "Long silky ribbons" had been implemented as
   curls with equal extent in every direction, at small scale. No colour-ramp
   or threshold change can elongate a shape. The fix is to split the sample
   position into components along and across the flow direction and scale
   them unequally (`along * 0.2 + across * 2.0`), so features run ~10x longer
   along the flow than across it. This is the single line that matters most
   in the whole shader.
2. **Feature scale was ~5x too small** — corrected alongside the anisotropy,
   since bigger isotropic blobs are not an improvement.
3. **Limb lighting was inverted.** Round 3 darkened the limb almost to black
   (floor 0.08) and put a saturated shell around it, so the globe read as a
   dark ball inside a floating ring. A lit planet does the opposite at the
   edge: mild surface falloff plus *additive* atmospheric scattering peaking
   at the silhouette. Base ocean was lifted at the same time.
4. **Framing was wrong in an unobvious way.** The reference shows a globe
   that fills the frame *and* a near-full hemisphere of geography. Only a
   long lens gives both: a wide FOV pulled in close also fills the frame, but
   crops to a small patch with heavy perspective. FOV is now 8°, with camera
   distance derived per-aspect (see `FillFrameCamera`) so one rule covers
   desktop landscape and phone portrait.
5. **Banding shape.** Two failure modes bracket the target and both were
   visited on the way: a threshold low enough to light the whole sphere
   (flat blue ball), and a ridged/contour transform (thin wiry filaments,
   like chrome). The reference's feathery wisps sit between them — broad
   soft `smoothstep` bands with a small, rare bright core.

### Three real bugs this pass uncovered

- **The land mask was rendered 180° out in longitude.** `posToUv()` added
  `+0.5` to the computed `u`, offsetting the texture by half its width, so
  every continent drew at its antipode. Helena's North Atlantic path was
  therefore rendering over the Pacific. It went unnoticed for two rounds
  because the mask is deliberately faint and abstract — there was nothing
  obviously "wrong" to look at until the camera was pointed at a specific
  named ocean. Caught by checking the mapping numerically against
  `geo.ts`'s `latLonToVector3` rather than by eye.
- **Helena's `heading_deg` contradicted her own path.** The hand-written
  literals said ~100° (ESE) while the waypoints run ~62° (ENE). Anything
  consuming heading — most visibly the shader's flow direction — pointed the
  wrong way. Heading is now *derived* from consecutive waypoints, so the two
  cannot desync.
- **The panel described a swell the data did not contain.** `'Long-period
  WNW pulse'` was a hardcoded string; a swell travelling ENE arrives *from*
  the WSW. Both the panel label and the narrative description are now
  derived from the bearing via `originSector()`.

### Also in this pass

- **Typography**: Cormorant Garamond (a Didone-family serif) via Google
  Fonts, with the Georgia/Palatino stack retained as fallback. *Note for the
  Expo port: React Native cannot use a `<link>` — bundle the font file with
  `expo-font` instead.*
- **The panel is no longer a panel.** Per the reference: no card, no border
  box, no frosted glass. A thin vertical hairline is the only structural
  mark, over a scrim faint enough to keep the globe visible through it. This
  supersedes round 3's Fix 7, which had asked for frosted glass.
- **Land mask** regenerated at 2048×1024 with a box blur, so the coastline
  can be a smooth band around the 0.5 contour instead of `fwidth()` on a hard
  0/1 mask (which produced the previous rounds' stair-stepped outlines).
- **Idle rotation now respects `prefers-reduced-motion`** — an accessibility
  fix that also makes the scene deterministic for the automated checks.
- **`?e2e=1` test hook.** The app publishes Helena's projected marker
  position on `window` when that flag is present (off by default). Sweeping
  screen coordinates to find the marker is not viable here: under software
  GL every synthetic click waits on a rendered frame, so a grid search takes
  minutes.

### Verification limits, stated plainly

- Screenshots taken in this environment show the **Georgia fallback, not
  Cormorant Garamond** — Chromium cannot reach `fonts.googleapis.com` through
  the sandbox proxy (curl can; the browser's CONNECT is reset). The `<link>`
  is correct and loads normally on a real machine, but the typography has not
  been visually verified here.
- Tuning was done against the reference image by eye. It is a painted/AI
  mockup, so exact ribbon shapes are not reproducible; the target was
  matching character — elongation, scale, softness, luminosity, framing.

## Round 5: the shading model itself was the problem

After round 4 landed, the user looked at it again: *"the shading around
globe is too obvious, it doesn't look 3d, flowy."* The globe *did* have
curvature shading by then (round 3/4's per-fragment view-direction limb
darkening + atmosphere rim) — so why did it still look flat?

**Because none of that shading was directional.** Both the limb-darkening
term and the atmosphere rim were functions of `dot(normal, viewDirection)`
only — rotationally symmetric around the camera axis, brightest dead-centre,
darkening/glowing *uniformly* toward every point on the silhouette. That is
a radial vignette, not sphere lighting. The actual perceptual cue for "this
is a lit 3D object" is a *directional* light — one side brighter, the other
darker, with a soft gradient between them. A camera-relative, rotationally
symmetric falloff has no direction to it at all; it reads as a filter laid
over a flat image, which is exactly what "too obvious" and "doesn't look
3D" were describing. It also explains "not flowy" as a side effect rather
than a separate complaint: a uniform dark ring around the whole disc
competes with the ribbon pattern for attention instead of receding behind
it.

(The very first globe implementation, before the fBm ocean shader existed,
did have proper Lambertian wrap-lighting with a fixed light direction. It
was dropped when the ocean shader replaced it and never reintroduced —
rounds 3–4 added view-based limb/rim effects as a substitute, which solved
a real but different problem, "does the sphere read as curved," without
ever supplying the directional cue that makes something look *lit*.)

**Fix, all in `GlobeSphere.tsx`'s `SURFACE_FRAGMENT`:**

1. Added a fixed-**world**-space key light: `float lambert =
   dot(vWorldNormal, uLightDir); float lit = smoothstep(-0.6, 0.9,
   lambert); color *= mix(0.62, 1.12, lit);` — soft-wrapped (no hard
   terminator line) so it stays calm rather than dramatic, and gentle
   enough that the unlit side still clearly shows the ribbon pattern
   rather than going near-black.
2. This needs a new `vWorldNormal` varying
   (`normalize(mat3(modelMatrix) * normal)`), not the existing
   `vViewNormal`. Getting this right matters: a *view-space* light would
   swing around with the camera as the user drags, which is the exact
   same flattening problem in a different guise — the light has to be
   fixed relative to the globe's actual geography, not the viewer.
3. The old view-based limb darkening and atmosphere rim didn't disappear
   — they were cut to a whisper, since the key light now does the "reads
   as a sphere" work: limb darkening floor `0.5 → 0.88`, its falloff
   narrowed to just the true grazing angle; the additive rim scatter's
   peak `0.6 → 0.2` and its falloff power `2.2 → 4.0`; the separate
   atmosphere shell scaled down (`1.1 → 1.045`) with a narrower, dimmer
   fresnel term (power `2.4 → 3.5`, peak alpha `0.42 → 0.22`).

**Verifying it's actually world-space and not just "looks plausible in one
screenshot"** mattered more than usual here, since a subtle bug (light
computed in the wrong space) would look fine in a single frame and only
reveal itself on rotation. Sampled average luminance in screen quadrants
from `rotate-test.mjs`'s two output images at different camera angles:

```
rotate-1: { tl: 55.1, tr: 63.2, bl: 69.1, br: 18.3 }
rotate-2: { tl: 18.6, tr: 39.8, bl: 19.4, br: 29.7 }
```

The same screen quadrants swap from bright to dark between the two shots
(top-left 55→19, bottom-left 69→19) — confirming the light is tied to the
globe's geography, not the screen. A camera-relative bug would have kept
these numbers roughly constant across both shots.

## Round 6: evaluating an external "visual fix pack," not new user feedback

Unlike rounds 2-5, the input this time wasn't the user reacting to a fresh
screenshot — it was a pasted third-party document, a vanilla Three.js "fix
pack" claiming 5 problems: a flat non-flowing ocean texture, a small
centered "marble in space" globe, hard white vector-map coastline strokes,
no atmosphere glow with an underexposed/flat look (recommending
`THREE.ACESFilmicToneMapping`), and a swell path built from a straight line
stitched to a separate arc.

The critique was checked against the actual code and fresh
`shot.mjs`/`rotate-test.mjs` screenshots at HEAD rather than applied on
trust — worth doing explicitly here because the fix pack assumed vanilla
Three.js (`scene.add`, `renderer.toneMapping`, a 2D canvas overlay) against
an app that's React Three Fiber throughout, so nothing in it was a drop-in
patch regardless of whether the diagnosis was right, and several of the
claims read as generic rather than specific to this codebase.

**Outcome: 4 of 5 claims rejected as describing a stale or nonexistent
state; 1 had a real kernel of truth and was fixed.**

- **Ocean texture, framing, coastlines — all rejected outright.** The
  double-warp anisotropic fBm (rounds 2/4), the 8° telephoto
  `FillFrameCamera` (round 4), and the near-invisible land + soft
  derivative-stroke coastline (round 3) already do what the fix pack asked
  for. Screenshots confirm it: clear marbled ribbons, the globe bleeding off
  all four edges, a soft low-contrast coastline — none of the described
  problems are present.
- **Atmosphere/exposure — rejected, and the proposed fix would have
  regressed a real bug fix.** An atmosphere rim shell already exists, and
  screenshots show genuine directional lighting (round 5), not a flat cold
  vignette. The fix pack's specific remedy — switch to
  `THREE.ACESFilmicToneMapping` — would have reintroduced round 3's bloom
  bug verbatim: `Globe.tsx` sets `toneMapping: NoToneMapping` *because*
  the default tone mapping was clamping HDR peak colours (`uOceanBright`,
  `HelenaPath`'s `BRIGHT`, both deliberately authored above 1.0) before
  bloom could ever see them. No exposure change made.
- **Swell path — the one real fix.** The fix pack's specific claim (a
  straight segment stitched to a separately-drawn arc, to be replaced with
  a 2D canvas `quadraticCurveTo` overlay) doesn't match this app's
  architecture at all — there is no 2D canvas overlay anywhere in it, and a
  screen-space curve couldn't track the sphere's rotation/occlusion
  correctly regardless. But reading `HelenaPath.tsx` directly found a real,
  if differently-shaped, defect: the path was a drei `<Line>` connecting the
  20 raw waypoints from `data/helena.ts` with straight segments — no spline
  smoothing at all. With waypoints ~6h apart, that's a genuine polyline, not
  a curve.

  **Fix:** the same 20 waypoints (unchanged) are now resampled through a
  `THREE.CatmullRomCurve3` (`centripetal` type, to avoid the loop/overshoot
  artifacts that chordal or uniform parameterization can produce when
  waypoint spacing is uneven) before being handed to `<Line>`. Colour
  interpolation needed care: `CatmullRomCurve3.getPoint(t)` maps `t`
  uniformly by *waypoint index* regardless of curve type (`t=0` is waypoint
  0, `t=1` is the last waypoint, segments are evenly spaced in `t` by index
  — the curve type only changes the tangent shape within each segment, not
  which `t` range a segment occupies), so each sampled curve point's
  fractional waypoint index (`k/divisions * (n-1)`) could be used to
  linearly interpolate between the same two waypoints' existing
  energy-based colours the straight-segment version used per-vertex —
  keeping the cobalt→bright gradient smooth at curve resolution instead of
  only at waypoint resolution. Glow, marker, the `?e2e=1` hook, and click
  handling are untouched.

  Before/after screenshots at matching camera angles (`rotate-test.mjs`)
  confirm the curve is genuinely smoother — no vertex is visible on close
  crop — but the visual delta is subtle at normal zoom: most of Helena's
  visible arc runs through waypoints that are already close to a
  great-circle line over their short 6h hops, so this is a real correctness
  fix more than a dramatic visual one.

**An unrelated issue surfaced during verification, not caused by the fix
above:** `smoke-test.mjs`'s Follow-Swell click step timed out at its
hardcoded `{ timeout: 8000 }` in this sandbox session. Bisected with `git
stash` — reproduces identically on the unmodified pre-round-6 code, so it
predates this change. A one-off diagnostic script with a 30s timeout showed
the click **does** succeed, at ~10.2s — this sandbox's software-rendered
WebGL (see "Environment constraints" elsewhere in this project's docs) is
apparently too loaded in this session for an 8s actionability window once
the panel's 0.6s CSS slide-in animation and the continuous
shader/bloom/autorotate render loop are competing for the main thread.
Left as a flagged, not-yet-fixed item rather than bumping the timeout —
it's a session/environment-speed question outside this review's scope, and
one confirmed reproduction under a 30s ceiling isn't enough to be sure
8000ms is wrong everywhere versus just slow here.

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
