# Phase 0 — Visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8. No live data, no backend — one hardcoded
fake swell ("Helena") crossing the North Atlantic, rendered on a cinematic
dark globe, with a draggable timeline, tap-to-select, and local-only
Follow.

The visual engine (the globe surface itself) is on its thirteenth
iteration.
Round 1 used a GPU particle field. Round 2 replaced it with a domain-warped
fractal-noise shader. Round 3 fixed missing curvature shading, a dead bloom
pipeline, and several CSS bugs. Round 4 was the first pass with the actual
reference image in hand and fixed structural issues (anisotropic ribbons,
framing, a real land-mask bug). Round 5 replaced the shading model
itself — the globe had curvature but no actual light, which read as "obvious"
shading rather than a lit 3D object. Round 6 evaluated an external "visual
fix pack" against the real build, rejected 4 of its 5 claims as
stale/inapplicable, and fixed the one real issue it found (a
straight-segment swell path, now a true spline). Round 7 replaced flat
procedural land/ocean colour with real Earth texture data after the user
rejected another round of pure parameter tuning, and fixed two real bugs a
naive tuning pass would never have caught. Round 8 stopped describing the
reference and started measuring it — found the globe was framed at ~97% of
the viewport where the reference is ~74% (a close-up, not a planet), and
three tooling bugs, two of which meant earlier rounds' own screenshots
weren't showing what a user would actually see. Round 9 turned "make the
filaments actual swell propagation" into real multi-source swell physics,
and in doing so found that **the ocean shader had never actually animated
over time in this project's history** — a React Three Fiber uniforms bug
present since round 2, invisible in every prior round's static screenshots.
Round 10 fixed the sharp dividing lines round 9 shipped with, using a
lateral-inhibition mechanism the user proposed themselves, found and fixed
two further pole-singularity artifacts only visible from a rotated camera
angle, and replaced noise-driven teal patches with a strength-coded
light-blue-to-purple colour ramp. Round 11 restyled Helena's own path and
current-position marker — untouched by rounds 7–10's work on the ocean
shader itself, and still a hard opaque white line and dot predating the
swell-strength colour language — onto the same soft-gradient palette and
no-hard-edges look. Round 12 made the timeline's existing
past-through-future drag range actually discoverable, gated each source's
energy so it fades in at its own spawn moment instead of showing a
residual dot beforehand, and gave each swell a trailing wake (bright
leading edge, receding toward its origin) so a single static frame hints
at motion without the timeline needing to be scrubbed at all. Round 13
(current) found the strength-colour ramp, wired into the ocean shader
since round 10, wasn't actually reaching the render in the body of the
field — only Helena's own path reliably showed it — and fixed two
dilution bugs plus an ACES-tonemap saturation-crushing mechanism at the
bright end (round 10 hit the same mechanism at the dark end). Confirmed
visible in real screenshots, though still fairly subtle overall — see the
round's own honest assessment. See "Round 7" through "Round 13" below.

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

## Round 7: real Earth textures, not another procedural-tuning pass

The user posted the actual reference image directly in conversation for
the first time and said the round-6 build "doesn't look anything like
this." A first plan draft proposed the same kind of thing every round
since 2 had done — nudge shader colour/threshold constants, re-screenshot,
compare by eye. The user rejected that: *"make sure you are going to
transform it onto reference picture... not just do another round of
expensive iteration... check all tools that can be used to render it
pretty premium feel."*

**What that pushback actually unlocked:** testing direct network calls
from this sandbox found `raw.githubusercontent.com` and
`registry.npmjs.org` reachable, even though NASA's own image servers and
Wikimedia are blocked at the proxy — a materially different, more
permissive network policy than the fully-offline sandbox described
elsewhere in this project's history (see `PROGRESS.md`'s Phase −1
section). That meant real Earth texture data was actually fetchable, which
changes the right move entirely: ground the render in real
photographic/data texture instead of trying to fake that level of detail
from noise parameters alone.

**Assets used**, downloaded and visually inspected (not just assumed
correct) before committing to them: `earth-night.jpg` and
`earth-water.png` from `vasturiano/three-globe`'s demo assets — an
MIT-licensed, widely-used data-viz-globe library (not adopted as a
dependency; just its demo textures, the standard NASA-Blue-Marble-derived
imagery reused across the three.js ecosystem for years). `earth-night.jpg`
turned out to already sit close to this app's own established dark navy
palette when inspected directly — real continent structure and subtle
city-light warmth, still dark and atmospheric rather than a legible
daytime map. `earth-water.png` is a real, much higher-fidelity land/ocean
mask (actual river networks visible) than this project's own hand-rolled
scanline-fill mask. **Flag, not silent (§0 rule 2):** third-party mirror,
not NASA's own distribution — written up with the source/caveat in
`public/textures/SOURCES.md`, worth revisiting before any release beyond
the immediate working group.

**The technical change, in `GlobeSphere.tsx`:** the real texture is now
sampled at every fragment and used for both land (replacing a flat
near-invisible colour) and as a subtle real-detail multiply layered under
the existing procedural ocean ribbons — not as a replacement for them. The
anisotropic domain-warp ribbon shader itself (rounds 2/4's real
engineering) is untouched. Also: the octave cap that silently limited the
ribbon noise to 3 octaves regardless of quality tier (`qualityTier.ts`
budgets 5 on the high tier, but the shader never used more than 3) now
uses the tier's real budget; the atmosphere fresnel (cut to "a whisper" in
round 5 specifically because it was fighting camera-relative shading for
attention — a problem round 5 itself already solved) is brighter and
broader; the exposure range is wider throughout. `Globe.tsx` gained a
colour-grade pass (`HueSaturation`/`BrightnessContrast`/`ToneMapping`)
using `postprocessing` effects that were already a dependency but unused —
deliberately applied *after* Bloom in the composer chain, not via
`renderer.toneMapping`, specifically so it doesn't reintroduce round 3's
already-diagnosed tone-mapping/bloom-clamping bug (verified: bloom
highlights are still visibly present in every post-change screenshot).

**Two real bugs, found by actually screenshotting and reasoning about the
code — not by guessing at more numbers:**

1. **Land leaked a bright, uniform, satellite-photo tan** across every
   continent on the first render — nothing like "mostly dark,
   distinguishable via subtle warmth," and nothing like the reference's
   more muted continents either. `pow(nightLum, 0.8)` was too gentle a
   curve: ordinary mid-grey terrain luminance (which most land pixels
   have) wasn't suppressed enough before being added on top of the
   near-black base. Fixed with a much steeper `pow(nightLum, 2.2)`, so
   only genuinely bright source pixels (city lights, ice sheets) lift
   noticeably.
2. **Teal was completely invisible — at every camera angle tested (4
   independent screenshots: 2 default, 2 rotated).** First guess was a
   frequency/threshold problem (the teal noise field's own features were
   wide enough that a whole visible hemisphere could land inside one
   "zero" region) — raised both the frequency and the blend weight. No
   change at all. **The real cause, found only by reading through the
   blend chain line by line rather than tuning yet another number:** the
   ocean colour block was two independent, sequential `mix()` calls (deep
   → teal, then separately deep → mid). The second call's weight (up to
   0.85) structurally overwrote almost everything the first one set,
   *regardless* of the teal weight — raising that weight could never have
   fixed this. Fixed by blending mid/teal into one colour first
   (`mix(uOceanMid, uOceanTeal, tealPatch)`), then mixing that single
   result in once. Verified with fresh screenshots at multiple angles:
   real teal/green patches now visible, integrated with the bright ribbon
   crests rather than washed out by the second mix.

**An already-known issue recurred during verification, not caused by this
round:** `smoke-test.mjs`'s Follow-Swell click hit the same hardcoded-8s
timeout documented in round 6 — same failure mode (this sandbox's
software-rendered WebGL, sometimes too loaded in a given session for an 8s
click-actionability window). Not re-diagnosed since round 6 already did
the full workup; now recurring across two separate sessions, so worth
bumping the timeout in `smoke-test.mjs:45` outright if it happens a third
time rather than re-investigating from scratch again.

**Not independently verified against the literal reference image
pixel-for-pixel**: worked from the image as seen in conversation plus a
detailed description captured while writing the plan, not a saved file on
disk — the user didn't provide one as a file this round. `public/textures/`
is proof this sandbox can now persist and use a real image file if a
future round gets one.

## Round 8: measuring the reference, and three tooling/quality bugs

After round 7 the user looked again: "better but still doesn't look like
this." Round 8 stopped working from a prose description of the reference
and started measuring it.

**Composition — the big one.** Measured on the reference image: the globe
spans **~74% of frame width**, with clear black space past both limbs,
cropped only top and bottom. Round 4's `FillFrameCamera` had it at ~97% —
edge to edge. That is not a planet, it's a close-up of a patch of ocean;
at that zoom you see roughly a 60° arc, so whichever landmass happens to
sit near the camera axis fills the screen. Now `DISC_COVERAGE = 0.74` in
`Globe.tsx`. FOV stays 8° (telephoto is what gives a near-full hemisphere
with little perspective distortion — the reference has that too); only the
camera distance changes.

Note for the record: **round 6 rejected the external fix pack's framing
complaint.** Its description ("small, centered, marble in space") genuinely
didn't match what was rendering — but its instinct that the framing was
wrong was correct, and dismissing the claim because the description was
wrong cost two rounds. A bad description of a real problem is still a real
problem.

**Bug 1 — `shot.mjs` was non-deterministic and never showed the opening
view.** It was the only one of the four scripts not setting
`reducedMotion`, so idle auto-rotation ran throughout — and a single
screenshot here takes tens of seconds of wall-clock time under
software-rendered WebGL, so the globe spun a long way before the shot was
taken. Every tuning screenshot landed on an arbitrary longitude. Several
rounds of "why is a huge continent in the middle of the frame?" were partly
this artifact rather than the framing itself.

**Bug 2 — `prefers-reduced-motion` silently forced the LOW quality tier.**
`qualityTier.ts` read `if (prefersReducedMotion || cores <= 2 || memory <=
2) return SETTINGS.low`, conflating a vestibular-comfort preference with
device capability. Two real consequences: anyone with reduced-motion set
got a 2-octave globe instead of 5 for no reason (the right response to that
preference is to stop *motion*, which `Globe.tsx` does separately), and
since every screenshot/test script sets `reducedMotion` for determinism,
**all automated visual checking in this project had been rendering the low
tier**. Round 7's "raise the octave cap to the tier's real budget" fix was
invisible in its own verification screenshots because of this. Now keyed on
hardware only.

**Not a bug, but verified rather than assumed.** Screenshots kept showing a
big landmass near the centre of a view aimed at 24°N/−48°W — open ocean —
which looked like a possible repeat of round 4's 180°-longitude mask bug.
Checked two ways rather than by eye: sampled `earth-water.png` at eight
known land/ocean coordinates (8/8 correct), then built a temporary debug
version with land tinted flat red and compared against computed
projections. Greenland projected to screen (258,108) and rendered there;
Helena's marker (262,185); the Amazon (210,336) — all matching. **The
camera and mapping are correct; the mass is North and South America and
the earlier visual reading of it was simply wrong.** Debug build reverted
immediately. Worth recording: eyeballing continent shapes on a
partially-lit sphere has now produced one false alarm as well as one true
find (round 4), so this project should reach for the numeric check first.

**Visual changes** (all `GlobeSphere.tsx` unless noted): land lifted out of
the black-hole state round 7 over-corrected into, with a gentler luminance
curve so real terrain texture reads; ribbon ramps widened, since the
reference's flow is translucent feathered veil rather than painted streak
and *ramp width is what softens an edge* — the noise shape was never the
problem; palette desaturated toward the reference's steel blue and muted
olive rather than saturated royal blue and vivid teal; lit floor raised
(the reference has essentially no dark side); tonal range rebalanced toward
deeper water carrying more delicate highlights. In `Globe.tsx`, round 7's
colour-grade saturation cut 0.18 → 0.05 — a global saturation boost
*multiplies* what the shader already produced, so it was compounding with
the palette rather than grading it.

Two overshoots caught within the round rather than shipped: an atmosphere
pass at shell 1.085 / alpha 0.45 produced a distinct teal **ring** with its
own visible outer edge (at whole-disc framing, an 8.5%-of-radius shell is a
large object in frame, not a haze), and the first teal pass produced vivid
emerald blotches across half the ocean once round 7's blend bug was fixed
and the bands were softened.

**Still not matched, plainly:** the reference is a polished render, very
likely with real current data and volumetric atmosphere behind it. This is
much closer in composition, tonality and colour than any previous round,
but a real-time procedural fBm shader will not land on it exactly. The
remaining gap is mostly filament fineness and the photographic quality of
the atmosphere, and closing it further needs the user pointing at specific
differences rather than more self-directed tuning.

## Round 9: real swell propagation, and the ocean had never actually animated

The user asked four things about round 8 at once: why the ocean looked
"kinda smeared," why the atmosphere had "no transitions," whether the
continents were over-detailed, and — the substantial one — whether the
filament pattern could be actual swell propagation, showing where each
swell can potentially go, rather than decoration.

**Why it was smeared:** the shader never visualised currents at all.
`uFlowBias` was one global direction (Helena's own compass heading) applied
to the entire planet — every fragment stretched the same way, which is
exactly what "smeared" describes. Two quick real fixes alongside it: the
atmosphere's Fresnel term was inverted (brightest at the shell's outer
edge, fading inward, then hard-cut at the geometry boundary — the opposite
of a real halo), normalised against the limb angle instead so it peaks at
the planet's edge and fades outward; land's luminance lift pulled back from
round 8's level, which read as more detail than §5.1 wants for
orientation-only continents.

**The real feature:** several invented storm sources
(`src/data/swellSources.ts`) alongside Helena, each radiating a directional
great-circle fan using `Cg = 1.56 × period` — the same formula
`phase-1-validation/physics.py`'s `group_velocity_kmh` already uses,
deliberately kept identical rather than inventing a second number for the
same physics. The ocean branch loops over up to 6 sources per fragment:
front arrival (soft leading edge — swell fills in behind a front, it
doesn't vanish ahead of it), a ~60°-wide directional spread around each
storm's real heading, and distance falloff, then feeds the energy-weighted
result into the *existing* anisotropic sampling (rounds 2/4's engineering,
untouched) and total energy into contrast. Anisotropy dropped from ~10:1 to
~5:1 — direction genuinely varying by position needs less stretch to read
as flow than one constant ever could. This deliberately supersedes
`MASTER_BUILD_PLAN.md` §8's "scrubber moves only Helena's marker"
constraint — recorded as decision-log row 18, still zero live data.

**Bug 1 — a sharp diamond artifact at each source's own origin.**
"Direction away from a point on a sphere" has a genuine singularity
exactly at that point (the hairy-ball problem): bearing rotates
arbitrarily fast in the immediate neighbourhood, and the directional-spread
test — correct everywhere else — cut a visible pie-slice there. Fixed by
blending the spread test toward omnidirectional within ~15° of each
source's origin, which is physically reasonable too: a storm's generation
area isn't strongly directional yet, only the swell radiating away from it
organizes into one.

**Bug 2, the significant one — the timeline scrub did not visibly change
the field, at all.** Found only because this round demanded a specific,
falsifiable check — screenshot "Now" and "3 Days," diff the pixels —
instead of eyeballing two renders side by side. The result: **exactly
zero** differing ocean pixels, even though the JS-side computation was
verified correct at every step along the way (console-logged
`frontArray` values changed correctly with `offsetHours`; the assignment
to the uniform's `.value` was confirmed immediately after to hold the new
numbers). Every signal reachable from inside the React code said this was
working.

The actual cause, found only by comparing object identity directly in a
running page (`materialRef.current.uniforms.uSourceFront ===
surfaceUniforms.uSourceFront` → **false**): React Three Fiber's
`<shaderMaterial uniforms={x}>` clones the uniforms object once, when the
prop is first applied — `material.uniforms` is never a live reference to
the object passed in. Every uniform update in this file, since round 2
introduced this shader, mutated the original JS object's `.value`, which
is a copy the renderer never reads again after mount. Confirmed
unambiguously: `materialRef.current.uniforms.uTime.value` read `0` on a
running page, and still read `0` three seconds later. **The ocean has
never actually animated over time in this project's history** — every
screenshot in every round happened to look like a plausible static frame
of a complex noise field, and no round's own verification ever compared
the same fixed camera angle at two different timestamps to catch it. Fixed
by mutating the material's own uniforms through a `ref` instead of the
object that was only ever good for setting *initial* values via the JSX
prop.

**The first fix attempt was wrong, instructively.** The symptom looked
exactly like a stale closure — `useFrame`'s callback holding an old
`frontArray` — and a debug log seemed to confirm it. Switching that update
from `useFrame` to a `useEffect` with explicit dependencies was a real
improvement in its own right (kept), but re-testing afterward showed the
field still wasn't responding: the theory explained the symptom
plausibly but wasn't the actual cause. Only the object-identity check
found the real one. Lesson worth keeping: when a value you just set
doesn't seem to take effect, verify by reading it back from the actual
consumer — the material three.js is drawing with — not from the variable
you set it on. The two can silently be different objects.

**Verified post-fix:** camera held fixed (autorotate off), 27% of ocean
pixels differ across a 5-second window purely from `uTime` animation
(0% before the fix). Between "Now" and "3 Days," 20% of ocean pixels
(excluding all UI regions) differ (0% before, checked with generous wait
times up to 12s to rule out this sandbox's documented render slowness as a
confound). `smoke-test.mjs`, `panel-glass-test.mjs`, `rotate-test.mjs` all
still pass, zero console errors.

**Not fully polished:** where several sources' fans overlap at "3 Days"'
larger front sizes, the result reads as a fairly graphic, crisp "spoke"
pattern rather than the soft feathered look tuned elsewhere — smooth, no
hard edges or artifacts, but more diagrammatic than photographic. It
answers "where can this swell go" legibly, which was the actual ask;
softening the fan-edge transition further is a reasonable future-round
target if the user wants it less graphic. **Addressed in round 10.**

## Round 10: lateral inhibition, pole-zone spirals, and a strength-coded colour ramp

The user saw round 9's spoke pattern live and named the fix themselves —
lateral inhibition, the strongest local swell should suppress weaker
overlapping ones rather than blend with them — plus two more asks in the
same message: each source should read as a legible directional cone, and
colour should encode strength, deep purple for the strongest swell down to
light blue for the weakest.

**The seam mechanism:** `flowAccum += away * w` was a plain linear vector
sum across sources. Where two sources have comparable weight but different
directions, `f = normalize(flowAccum)` sweeps through a range of directions
over a narrow spatial band as dominance flips between them — harmless for a
colour blend, but that band feeds straight into the anisotropic noise
stretch, and noise is chaotic with respect to its sampling direction, so
the rotation renders as a visible seam. Fixed with the user's own proposed
mechanism: sharpen the weight used for *direction* only
(`wDir = pow(w, 3.0)`), so the locally-strongest source dominates instead
of being averaged with weaker neighbours, while energy stays a true sum.

**Sharpening surfaced two latent bugs a single default camera angle had
never exposed** — both found by rotating to a different orientation:

1. A pinwheel artifact at each source's own origin: `away` has the exact
   same hairy-ball singularity `toP` did in round 9, but round 9's
   `poleFade` fix only ever blended `spread`, never this direction — a
   latent bug sharpening turned visible by concentrating weight exactly
   where the direction is least defined. Fixed the same way as `spread`:
   blend `away` toward the stable source direction within the same
   pole-fade radius.
2. That fix removed the point singularity but left a softer spiral in the
   transition band around it — found only by rotating the camera to bring
   a source's own origin into frame, which the default angle never did.
   An energy-weighted "pole confidence" now suppresses both the
   anisotropic stretch ratio *and* the domain-warp's direction-dependent
   drift/evolve terms in that zone; domain warping amplifies small input
   changes by design, so the direction's residual rotation alone was
   enough to redraw the spiral even after the stretch ratio was already
   fading correctly.

**Colour scheme:** replaced the noise-driven teal patches
(`snoise(vPos * 1.35 + 17.0)`, unrelated to any actual data) with a ramp
driven by `fieldEnergy01` — already exactly the right per-fragment signal —
from light blue to purple. This answered the "legible cone" ask for free:
the cone shape already existed geometrically, it just rendered in nearly
the same blue as the surrounding water; colour makes the existing shape
visible rather than adding a second mechanism to draw one.

**One real bug in the first colour pick, found by testing, not assumed:**
`#5b2a8c` never rendered as purple anywhere — isolated with a sequence of
throwaway debug renders (grayscale energy signal, then the blended colour,
then the raw uniform alone) rather than re-tuning blindly. Its linear-space
luminance is very low after `THREE.Color`'s automatic sRGB→linear
conversion, and this pipeline's ACES filmic tonemap crushes dark, saturated
inputs toward a desaturated navy indistinguishable from the surrounding
water. A brighter violet (`#a855f7`) survives the same pipeline intact.
Lesson: check a shader colour constant through the actual render pipeline,
not just as a hex value — this stack's tonemapping is not colour-preserving
at low luminance. Also tinted the crest/foam highlight toward the strength
colour (it was painting flat white straight over each swell's most
energetic point, erasing the colour signal exactly where it mattered most).

**Verified:** `npm run build`/`npm run lint` clean; `smoke-test.mjs` (both
viewports), `panel-glass-test.mjs`, `rotate-test.mjs` all pass, zero
console errors — `rotate-test.mjs` specifically is what surfaced both
pole-zone bugs, since the default screenshot angle never brought a source's
own origin close enough into frame. Fresh screenshots at three camera
orientations show smooth transitions where sources' fans meet, each active
source reading as a distinct purple-cored, blue-edged wedge, and no
pinwheel/spiral artifacts at any source's centre.

## Round 11: restyling Helena's path/marker off the hard white line and dot

The user's reaction to round 10 was specific: "I don't like the white
line. And circle... the whole visualization has to be fluid enough for
user to understand the projected path and current position without the
ugly line." `HelenaPath.tsx` had never been touched by rounds 7–10's work
on the ocean shader — still an opaque white `Line` with a flat, unlit
sphere marker, predating the swell-strength colour language entirely. It
read exactly as described: a line-chart overlay dropped onto the painting,
not part of it.

**Restyled onto the same language, not removed** — the user still wants
to read the projected path and current position, just not via a hard
line. New shared `swellPalette.ts` exports the exact colours
`GlobeSphere.tsx`'s `uSwellWeak`/`uSwellStrong` uniforms already use,
imported by both files so they can't drift apart. Helena's trail now
interpolates along this same ramp by each waypoint's energy, instead of an
unrelated cobalt-to-white gradient — it reads as one more swell in the
same system now, not a separately-coloured chart line. The marker's opaque
sphere (a flat white circle, hard silhouette from any angle) is replaced
with a camera-facing (`<Billboard>`) soft radial-glow plane — a small
hand-written shader blending a tight core and a wide halo to zero alpha at
the edge, a light source rather than a drawn dot — coloured by the current
point's own energy on the same ramp. The trail also fades in/out over its
first ~8% and last ~14% instead of stopping at two hard line-caps, and
renders as a wide low-opacity halo pass underneath a thin bright core pass
for a brushstroke feel rather than one uniform stroke.

**One real bug found in testing:** the first version used
`AdditiveBlending` on the trail, which produced a small blown-out flare
exactly at the path's tip. Root cause: where the 3D curve bends toward or
away from the camera, many sampled points project into a handful of
screen pixels, and additive blending sums their brightness instead of
capping it — dozens of overlapping near-transparent segments in the same
pixels add up bright regardless of how dim any one is. Confirmed by
cropping and inspecting the exact pixels rather than eyeballing "looks
better": the flare tracked the tip precisely across rebuilds and vanished
when blending switched to normal alpha compositing, which caps a pixel at
the vertex colour instead of summing overlapping draws. Kept
`AdditiveBlending` only on the marker's own glow billboard — a single
small plane, not 120+ overlapping segments, so the failure mode doesn't
apply there.

**Verified:** `npm run build`/`npm run lint` clean; `smoke-test.mjs` (both
viewports — the marker's hit-target and `?e2e=1` hook are unchanged, so
tap-to-open-panel and timeline-moves-marker both still pass),
`panel-glass-test.mjs`, `rotate-test.mjs` all pass, zero console errors.
Fresh screenshots at the default angle, both rotate angles, and the
open-panel view show a soft glowing gradient stroke fading into the water
at both ends, a diffuse marker glow with no hard edge, and no flare at the
path's tip.

## Round 12: a bidirectional timeline, sources that spawn in, and a trailing wake

The user's own framing after round 11: "the ocean should be moving -
showing some past periods as well as prediction." Brainstormed two
complementary directions with them first — a manual scrubber reaching into
real history, versus baking recency into the field's own rendering so a
static frame reads as alive without interaction — and built both, since
they answer different needs.

**The scrubber already went both ways; nothing said so.** `Timeline`'s
drag range has always spanned `HELENA_MIN_OFFSET_HOURS` (−18) to
`HELENA_MAX_OFFSET_HOURS` (96), but every labelled stop sat at "Now" or
later. Added a labelled stop at the range's actual past extreme, tied to
the real constant so it can't drift out of range. First label ("18h Ago")
visibly collided with "Now" — only 18 of the track's 114 total hours
separate them; shortened to "-18h" and confirmed the collision was gone.

**Sources now fade in at their own spawn moment.**
`angularFrontDistanceRad` already clamped a source's front to 0 before its
spawn time, but energy was never gated the same way, and the shader's own
`arrived` test evaluates to 0.5 exactly at a source's origin regardless —
every source showed a small fixed dot at its origin even scrubbed to
before it had actually started. New `spawnRamp01()` fades a source's
energy in linearly over its first 4 hours; scrubbing to before spawn now
shows genuinely nothing.

**Each swell now reads as a wake, not a flat plateau.** Previously
`arrived` was flat behind the leading edge, falling only right at the
edge itself — physically defensible (ongoing storms, not a single pulse)
but meant a static frame carried no cue that water near an origin is
*older* than water at the growing edge. Split into `leadingEdge` (the
original crisp cutoff, kept exactly as-is) and a new `trailFade`, dimming
the long-passed part of the wake toward the origin (floor at 30%, never
fully gone), ramping to full brightness by ~75% of the way to the front.
A legibility device, not a physics change. Verified by hand-tracing the
formula rather than trusting a screenshot — a first attempt at reading it
back from a rendered pixel sample was contaminated by the marker's own
glow sitting right at the sample point.

**Verified:** `npm run build`/`npm run lint` clean; `smoke-test.mjs` (both
viewports), `panel-glass-test.mjs`, `rotate-test.mjs` all pass, zero
console errors. Screenshots at "-18h", "Now", "Tomorrow", and "3 Days"
show clear, monotonic growth of every source's front across the full
range, the new stop's label legible with no collision, and a mostly-calm
ocean at "-18h" where only the earliest-spawning sources have anything to
show yet.

## Round 13: making the strength colour actually reach the ocean body

The user asked directly: "so swell colour scale is just in the 'line'
depicting swell direction? — that's kinda weird. I'd like it to be somehow
encoded in the actual body of swell in the ocean." Checking the code
first: the strength ramp (round 10) genuinely was wired into the ocean
shader, not just the path. But sampling actual rendered pixels well away
from Helena's line, across a grid inside a swell's own cloud, came back
plain blue at every point — the user's read of what actually renders was
correct even though the code disagreed. Three separate, stacked reasons
found by measuring at every step rather than re-guessing after each fix:

**Bug 1** — colour only ever entered the ocean's base tone scaled by
`band` (ribbon-noise detail at that exact pixel), so the large low-detail
areas between ribbons — most of a swell's visible footprint — stayed flat
blue regardless of strength. Fixed with a second, band-independent wash so
the base tone shifts with energy across a swell's whole footprint.

**Bug 2** — the crest highlight's blend anchor was fighting the colour it
carried: round 10 tinted crests toward `swellColor` but still blended
*toward* a separately-authored near-white constant deliberately
overexposed for bloom, whose own brightness is roughly double
swellColor's — even an 80% blend weight left a near-white remainder bright
enough to erase the hue difference the colour signal depends on. Fixed at
the root: the crest highlight now scales swellColor's own brightness
rather than blending toward a different colour entirely.

**Bug 3, the one that took longest to pin down** — a first fix for Bug 2
overshot into the exact opposite failure mode round 10 hit at the dark
end: isolating the raw result on-screen showed pure white everywhere
regardless of hue, ACES tonemapping crushing saturation at extreme
brightness the same way it crushes it in near-darkness. Settled on a much
smaller multiplier range after checking the actual rendered result.

**Two debugging methodologies turned out to have real failure modes of
their own, worth recording:**
1. Overriding the whole ocean with a single debug colour (used
   successfully in round 10) is invalid once that colour's own luminance
   exceeds the bloom threshold — every pixel becomes bloom-eligible
   simultaneously and Bloom's blur averages brightness across the *entire*
   ocean, producing a uniform wash unrelated to how that colour behaves in
   the real composited scene.
2. Sampling fixed pixel coordinates across separate screenshots isn't a
   fair comparison when the field is continuously animating (round 9's own
   time-based noise) — a formula change that appeared to do nothing at a
   coordinate, re-tested run to run, was actually working; the noise
   pattern had simply moved between screenshots. Resolved by scanning
   whole screenshots for the most colour-shifted pixel instead.

Also found and worked around, unrelated to the colour work: this session's
sandbox measured **1.2 fps**, directly instrumented via
`requestAnimationFrame` timestamps (95.6s for 120 real frames), not
estimated — software/CPU WebGL with no GPU, rendering a genuinely
expensive multi-source shader. At that rate `OrbitControls`' damping takes
far longer in wall-clock time to settle than on a real device, and this
session's usual ~20s screenshot wait was catching the camera still easing
into its final framing — a ~60s wait was needed for reliable comparisons.
This is a property of this specific sandbox, not the app; the same shader
on any GPU-accelerated device should render close to 60fps.

**Verified, honestly:** `npm run build`/`npm run lint` clean;
`smoke-test.mjs` (both viewports), `panel-glass-test.mjs`,
`rotate-test.mjs` all still pass, zero console errors, despite the
sandbox's slowness. The fix is confirmed genuinely reaching the render —
scanning whole screenshots found clearly purple pixels inside a swell's
body away from any line, and one `rotate-test.mjs` angle shows an
unmistakable violet-lavender tint through an entire swell's cloud. **Said
plainly: the overall visual impression across most screenshots is still
fairly subtle** — much of a swell's footprint still reads closer to
blue-white than strongly purple, particularly where sources overlap or
energy is moderate. The mechanism is now demonstrably correct and reaching
the screen; whether it reads as strongly enough at a glance is a genuine
open question for the user's own eyes.

**Addendum, same session, commit `21c53d8`:** the user checked and
reported still seeing no purple. Verified directly and agreed — the
"purple pixels exist" claim above was true but misleading, since they were
isolated crest peaks against a much larger blue/white mist. The actual
bug, found by cropping in on a real screenshot: **the misty ribbon
shape's visible extent never depended on energy at all, only its noise
contrast did** — `band`/`crest` crossed their thresholds fine even at zero
swell energy, so genuinely calm water still showed a visible mist, and the
eye reads that whole mist as "the swell," most of which was never
coloured. Fixed by gating `band`/`crest`'s own coverage on a new
`ribbonPresence` term, not just their contrast, so the visible cloud now
shrinks to track where colour actually is. Replaced the earlier
`pow(fieldEnergy01, 0.45)` ramp (which overshot the other way, boosting
near-zero energy too and broadly paling/enlarging the cloud) with a
`smoothstep(0.12, 0.5, fieldEnergy01)` curve that stays flat at genuinely
calm energy. Cut crest's own blend weight 0.38 → 0.22 — the exact lever
flagged above as untried — since even with correct hue it was still
painting over the now-more-saturated mid-tone.

Verified by disabling Bloom entirely and A/B-comparing screenshots:
contrary to this round's first theory, Bloom's blur was **not** the
dominant cause — the pre-addendum render looked nearly identical with
Bloom on or off. The real dilution was upstream, in the shader's own
coverage logic, not in post-processing. Purple is now visible as a halo
around Helena's line rather than isolated points.

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
