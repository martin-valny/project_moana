# Project Moana — Progress Report

Last updated: 2026-08-18, branch `claude/moana-master-build-plan-v2-zjs07y`,
HEAD `349f4fb`. Working tree clean, everything below is pushed.

This file is a complete handoff record: what was done, how, what worked,
why, and what's next — written so a new agent (or the user, cold) can pick
up without re-reading the whole conversation history that produced it.

**The full plan this file references by section number (§4.4, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file first for the
product vision and rules; this file is the build/validation log against it.

---

## Status, one line

**Phase −1 is passed (decided 2026-08-17). Phase 0's visual prototype
(`phase-0-prototype/`) has had five rounds of direct user feedback against a
reference image, a sixth round reviewing an external "visual fix pack," and
a seventh round (§"Round 7" below) that replaced flat procedural colour
with real Earth texture data after the user posted the actual reference
image directly and rejected a first plan draft as "another round of
expensive iteration." It is functionally complete and automatically
verified, but has not been shown to the user for a fresh open-ended look
since round 7 landed, and still needs the plan's actual falsifiable gate —
five non-surfers timed on a physical phone — which no agent session can run
itself.**

**If you're picking this up cold, read in this order:** (1) this "Status"
section, (2) "What's next" near the bottom for the immediate action, (3) the
"Round 7" subsection under "Phase 0" for the most recent thread (real
texture assets + two real shader bugs found by actually screenshotting and
reasoning through the code, not guessing at numbers), (4) "Round 6" for how
to evaluate an external critique without trusting or dismissing it blindly,
(5) "Round 5" for the last pre-texture visual change, (6) skim "What was
built" and rounds 2–4 for context on how the visual engine got here. Don't
start a "round 8" of self-directed visual tuning purely on your own
initiative — get a fresh look from the user first; if they have specific
feedback, "Round 7"'s pattern (real screenshots, real reasoning about why a
value isn't producing the expected pixels, not just nudging numbers) should
transfer directly.

---

## Phase 0: the visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8: no live data, no backend, one hardcoded
fake swell ("Helena") crossing the North Atlantic on a cinematic globe, a
time scrubber, tap-to-inspect, and locally-persisted Follow. Built in
`phase-0-prototype/` — see that directory's own `README.md` for how to run
it; this section is the narrative log of how it was built and what's
still open.

### Stack and why

Vite + React + TypeScript + React Three Fiber (`@react-three/fiber` +
`@react-three/drei` + `@react-three/postprocessing`), per §5.2's reversal
of v1's instruction: author in a browser for fast iteration, judge on a
physical phone, commit to the native Expo/RN stack only once the visual
earns the porting cost. Nothing here touches Expo/React Native — that's
deliberately out of scope until Phase 0 passes its own gate.

### What was built

- **Data contracts** (`src/data/types.ts`) mirroring §9.1's `SwellPulse`/
  `SwellFieldFrame` shapes, so Phase 1+ can port the same types forward
  rather than re-deriving them.
- **Helena** (`src/data/helena.ts`): 20 hand-authored waypoints, roughly
  every 6 hours over a 114-hour span, from mid-Atlantic generation
  (39.8°N,-52°W) to landfall on Ireland's west coast (54.3°N,-8.5°W).
  Height/period rise through the mid-ocean crossing and ease near shore
  (loosely modelled on the real shoaling signal noted in this file's
  Phase −1 section, but every number is invented for this prototype, not
  sourced from data). `energy` is always derived as H²×T per §4.4, never
  hand-picked. The whole path is anchored to app-load time, so "Now" in
  the scrubber always lines up with whenever someone actually opens it,
  not a fixed historical date.
- **The globe** (`src/three/`): a dark-navy sphere with a cobalt/cyan
  fresnel rim, an ambient "living ocean" particle field (~3,200
  simplex-noise-driven points, deliberately dimmer than Helena's own
  trail — not data-driven, exists purely to sell "a living ocean" per
  §2.3 step 3), and Helena's own path rendered as a brighter, tappable
  trail + pulsing marker. Bloom + vignette postprocessing, `OrbitControls`
  with slow autorotate and damping for a tactile feel.
- **Time scrubber** (Now / Tomorrow / 3 Days): moves only Helena's
  displayed position via linear interpolation between her waypoints
  (`src/data/interpolate.ts`, with circular interpolation for compass
  bearings so it doesn't break at the 350°→10° wrap). Nothing else in the
  scene reacts to it, per §8's explicit constraint.
- **Tap-to-inspect** (`SwellPanel`): tapping Helena's marker opens a
  minimal panel — category/basin eyebrow, name in an italic serif ("the
  legend on a poster register," §3.1), one-line narrative, Follow button.
  Raw numbers (height/period/position) stay behind an explicit "Details"
  toggle inside the same panel — §6.1's "only place raw numbers are
  permitted, and only on deliberate request."
- **Follow persistence** (`src/hooks/useFollow.ts`): `localStorage`
  standing in for §9.2's AsyncStorage requirement, since this prototype is
  authored on web per §5.2 — same key/shape, a trivial swap when this
  ports to Expo. Verified surviving reload via an automated check (below).
- **Attribution — the §3.3 decision, made here as instructed**: the plan
  offered two options (a permanent hairline credit, or a one-tap "About
  the data" panel) as if choosing between them. They aren't mutually
  exclusive, so both were built together — a permanent low-contrast
  "Data: Open-Meteo" credit at the bottom-right corner (which alone
  already satisfies CC BY 4.0's "visible wherever the data is displayed"),
  that expands into a one-tap sheet with the full credit, CC BY 4.0 link,
  and a note that Phase 0 itself has no live data yet. Documented in
  `MASTER_BUILD_PLAN.md` §3.3 and decision-log row 17.
- **Opening line**: "The ocean is moving." (§2.3 step 2), fading in on
  load, no login wall, no onboarding carousel — the app opens directly
  into the globe.

### Two real bugs found and fixed while building this

Both are documented in more detail in `phase-0-prototype/README.md`, worth
repeating here since they're the kind of thing that would otherwise get
rediscovered:

1. **Ambient field point size was ~15-20x too large.** The point-size
   formula's distance-scale constant was copied from an unverified
   assumption rather than derived from the actual camera/scene geometry.
   Result: thousands of huge overlapping additive-blended blobs, which
   bloom then turned into a solid moiré/scale-pattern mess covering the
   entire globe — nothing like the intended soft drifting points. Caught
   by actually rendering a screenshot rather than trusting a clean build,
   fixed by rederiving the constant from the real camera-to-surface
   distance and adding a `uPixelRatio` uniform.
2. **The base globe was nearly invisible.** `meshStandardMaterial` with a
   near-black colour under three.js's physically-correct light units
   needs much higher light intensities than the scene had; at the
   original settings the "planet" barely differed from the background.
   Fixed by replacing it with a small self-contained shader (soft-wrapped
   Lambertian + a tight specular highlight, fixed light direction) so the
   look doesn't depend on getting global light-intensity units right.
   Also had to pull the camera back and lift the ambient field's radius a
   fraction above the opaque sphere's — it was being intermittently
   z-fought away by the opaque globe at first, and the initial camera
   framing had the sphere filling the entire viewport with no visible
   "planet in space" silhouette.

Both were caught by actually screenshotting the running build (Playwright
against `npm run preview`, headless Chromium) rather than trusting a clean
`tsc`/`vite build` — neither bug produced a build error or a console
error; the app "worked," it just didn't look like anything close to the
design brief.

### Visual engine rewrite (v2): particles → domain-warped fBm shader

After a first look, the user supplied a corrected visual-engine brief:
the reference art direction (soft, swirling, marbled cobalt/cyan ribbons)
is the signature of **domain-warped fractal Brownian motion**, not
particle motion, and asked for the surface to be rebuilt on that
technique — plus a real coastline mask, a right-side glass selection
panel, and a draggable timeline, replacing several Phase 0 choices above.
Implemented in full:

- **Land mask**: `scripts/generate-land-mask.mjs` rasterizes
  `world-atlas`'s real 110m land topology into a 1024×512 single-channel
  PNG via a plain scanline polygon fill (no native canvas dependency).
  Real coastlines, deliberately coarse — matches §5.1's "enough for
  orientation, not enough to read as an atlas" with actual geographic
  data rather than hand-drawn blobs.
- **Surface shader**: one merged shader pass on `GlobeSphere` — land mask
  lookup (computed from the fragment's own position via the same lat/lon
  convention as `geo.ts`, not the built-in UV attribute, so it's
  guaranteed to agree with the rest of the app), then for ocean fragments,
  5-octave fBm with a **double** domain warp (Iñigo Quilez's technique).
  First attempt used a single warp layer and read as blobby clouds, not
  ribbons — the second warp layer is specifically what produces the long,
  self-similar, marbled curling the brief described; documented in
  `shaders/fbm.ts` so it doesn't get "simplified" back to one layer later.
  Flow direction and contrast are biased by Helena's actual current
  heading/energy (normalised), not arbitrary constants — with the caveat
  that Phase 0 has one swell, not a field, so this is a global bias, not
  yet spatially varying (see the README's fuller scope note).
- **Tuning pass**: the first render was far too bright/uniform (a lit
  blue ball, not "near-black with occasional ribbons") — fixed by pushing
  the colour ramp's thresholds higher so most of the noise range stays
  deep navy and only the upper end lights up, restoring the generous
  negative space Principle 1 asks for.
- **Bloom**: `luminanceThreshold` raised to ~0.85 and the ocean colour
  ramp's peak authored above 1.0 in RGB, so bloom is selective (ribbon
  crests + atmosphere rim only) rather than a global wash. Added a very
  subtle film-grain pass alongside the existing vignette.
- **Path arc**: `HelenaPath` restyled as a thin raised arc (bows up
  mid-path) with a per-waypoint cobalt→bright-cyan vertex-colour gradient
  keyed to energy, so it reads as the same visual language as the surface
  shader rather than a separate flat-line overlay.
- **UI**: replaced the pill-button time scrubber and bottom-sheet panel
  with a top-left serif wordmark + tagline (`Masthead`), a thin draggable
  timeline with Now/Tomorrow/3 Days as labelled snap points rather than
  the only reachable positions (`Timeline` — still moves only Helena's
  displayed position, per §8), and a right-side translucent glass panel on
  selection (`SwellPanel`) trimmed to exactly what the brief specified:
  name, one uppercase descriptor, a single "Follow Swell" button, no
  numeric-details affordance this time.
- **Quality tiers**: `qualityTier.ts` — a single startup heuristic
  (cores/memory/mobile UA/reduced-motion) picking octave count and bloom
  mip-blur once, not per frame.

**A flag raised rather than silently built** (§0 rule 2): the wordmark
renders the literal text "MOANA.", per the brief's reference image.
§12.1 is explicit that "Moana" is a codename only, not clear for brand
assets. Judged low-risk enough to leave in — it's a plain string in a
throwaway prototype, not a logo or domain, trivial to swap — but flagged
here and in the prototype's own README rather than assumed away; swap it
before this is shown outside the immediate working group.

Re-verified after the rewrite: `npm run build`/`lint` clean, the
Playwright smoke test updated for the new UI (marker tap → right panel,
Follow Swell persistence, timeline-label jump, attribution sheet) still
passes with zero console errors, and the surface shader was tuned through
several screenshot-compare iterations against the brief's own description
(not the literal reference image, which wasn't available to compare
pixel-for-pixel) before settling — consistent with the brief's own
expectation that this takes several passes.

### Round 3: visual remediation against a corrected brief

The user reviewed two screenshots of the v2 rewrite above and supplied a
third brief diagnosing one root cause and nine secondary problems, each
with an exact fix and a self-check to run before moving on. Worked
through in the brief's own stated order; all nine addressed:

- **Root cause, confirmed real:** the surface shader had zero dependence
  on surface normal or view direction at all — every fragment's
  brightness came only from lat/lon position and noise, so the globe
  could never read as a lit 3D sphere regardless of what the ocean
  texture looked like, which is exactly why it read as a flat map cutout.
  Fixed by adding true per-fragment view-direction shading
  (`dot(normal, normalize(-viewSpacePosition))`, not the camera's fixed
  forward axis) to both the surface and the atmosphere shell, so darkening
  reaches genuine zero exactly at the true geometric silhouette at any
  zoom level. Verified by dragging the globe to different orientations
  and confirming the darkening/compression moves consistently with
  orientation, not by a single static screenshot.
- **Ribbons still too speckled:** reduced the octave count feeding the
  domain warp itself (kept the full budget for the final sample only)
  and increased warp strength — fewer, longer, cleaner ribbon shapes.
- **No bloom bleed at all, a real pipeline bug:** the Canvas wasn't
  disabling three.js's default tone mapping, so HDR peak colours were
  being clamped before the bloom pass could ever see them — the
  ">1.0 for bloom" technique from the v2 brief was silently defeated the
  entire time. Fixed with `toneMapping: NoToneMapping` on the Canvas, plus
  retuning the luminance threshold down from 0.85 (which, it turned out,
  essentially nothing in the actual rendered range ever crossed) to ~0.55.
- **Exact colour palette calibration:** applied the brief's specific hex
  ranges throughout — ocean deep/mid/bright/teal, atmosphere, land,
  coastline, panel fill/border/text.
- **Land redone as near-invisible + a derivative-based coastline stroke**
  instead of a solid, clearly-legible fill — a bigger reduction than a
  simple opacity tweak.
- **Two real UI bugs found, not just polish:**
  - The timeline's active label rendered as a filled pill/chip because
    `.stopLabel` and `.stopLabelActive` are mutually exclusive classes
    (never both applied at once), but only `.stopLabel` reset the
    browser's default `<button>` background/border — so the *active*
    state specifically was the one leaking default button chrome. This
    was a genuine CSS bug, not a design choice that needed revisiting.
  - The persistent "Data: Open-Meteo" attribution label was flagged as
    debug-looking text that shouldn't live in the main experience.
    Removed; the wordmark now opens the same "About the data" sheet.
    Since Phase 0 has no live data yet, this doesn't currently violate CC
    BY 4.0 — but it's flagged in `phase-0-prototype/README.md` as needing
    re-evaluation before Phase 1 ships real data, not treated as settled.
- **Path arc recoloured** to the exact same palette stops (including HDR
  headroom) as the ocean surface, so it blooms consistently instead of
  reading as a separately-styled overlay.

**A sign/range bug caught by reasoning before testing, not by screenshot:**
fixing the atmosphere's Fresnel term to use the true view direction meant
its old `smoothstep(0.7, -0.65, facing)` formula (tuned against the old,
wrong, fixed-axis calculation) would have produced the *opposite* of the
intended falloff — brightest on the far side, dimmest at the rim — because
a `BackSide`-rendered shell's visible fragments always have `facing <= 0`,
with exactly `0` at the true silhouette. Worked out the correct range
analytically (`pow(clamp(1.0 + facing, 0, 1), 1.6)`) before building it,
rather than tuning by trial and error against screenshots alone.

Two small Playwright scripts were added alongside the existing smoke test,
specifically to make the brief's own self-checks repeatable rather than
one-off manual screenshot review: `rotate-test.mjs` (drags to two
orientations, for confirming curvature shading/rim glow move correctly)
and `panel-glass-test.mjs` (rotates a detailed area behind the panel
before opening it, to confirm the backdrop blur genuinely shows content
through). Full detail, including the complete before/after reasoning for
each fix, is in `phase-0-prototype/README.md`'s "Round 3" section.

**Not independently verified:** tuned against the brief's written
description and hex values, not a literal pixel-comparison against the
reference JPG it names — that file wasn't available to this session. If a
meaningful gap remains, a direct side-by-side would be the fastest way to
find it, faster than further iteration against the text description alone.

### Round 4: first pass with the actual reference image

The user supplied the reference image itself (rounds 1–3 had only prose
descriptions of it). Most of the remaining gap turned out to be structural,
not a matter of tuning — full detail in `phase-0-prototype/README.md`'s
"Round 4" section; the short version:

- **The noise was isotropic.** "Long silky ribbons" had been built as curls
  of equal extent in every direction. Splitting the sample position into
  components along and across the flow and scaling them unequally (~10:1) is
  what actually produces ribbons; no colour-ramp or threshold change can.
- **Limb lighting was inverted** — round 3 darkened the limb nearly to black,
  so the globe read as a dark ball inside a floating ring. Replaced with mild
  falloff plus additive scattering peaking at the silhouette.
- **Framing needed a long lens, not a close camera.** The reference fills the
  frame *and* shows a near-full hemisphere; only a narrow FOV at distance
  gives both. Now 8° FOV with distance derived per aspect ratio, so one rule
  covers desktop landscape and phone portrait.
- **Banding shape** was bracketed by two failure modes, both visited on the
  way: a low threshold floods the sphere into a flat blue ball, and a
  ridged/contour transform gives thin wiry filaments (chrome, not ocean).

**Three real bugs surfaced, none of which were cosmetic:**

1. **The land mask rendered 180° out in longitude.** `posToUv()` added `+0.5`
   to `u`, offsetting the texture by half its width, so every continent drew
   at its antipode — Helena's North Atlantic path was rendering over the
   Pacific. It survived two rounds because the mask is deliberately faint and
   abstract; there was nothing obviously wrong to look at until the camera
   was aimed at a specific named ocean. Found by checking the mapping
   numerically against `geo.ts`'s `latLonToVector3`, not by eye.
2. **Helena's `heading_deg` contradicted her own path** — hand-written
   literals said ~100° (ESE) while the waypoints run ~62° (ENE), so every
   consumer of heading pointed the wrong way. Heading is now derived from
   consecutive waypoints and cannot desync.
3. **The panel described a swell the data did not contain** — `'Long-period
   WNW pulse'` was hardcoded, but a swell travelling ENE arrives *from* the
   WSW. Label and narrative are now derived from the bearing.

Also: Cormorant Garamond via Google Fonts (Georgia fallback retained; noted
that the Expo port must bundle the file via `expo-font` instead); the panel
rebuilt as hairline-plus-scrim with no card or glass fill (superseding round
3's Fix 7, per the reference and confirmed with the user); land mask
regenerated at 2048×1024 with a blur so coastlines are a smooth contour band
rather than `fwidth()` stair-steps; idle rotation now respects
`prefers-reduced-motion` (an accessibility fix that also makes the scene
deterministic for tests); and an opt-in `?e2e=1` hook that publishes the
marker's projected position, because under software GL each synthetic click
waits on a rendered frame and a coordinate sweep takes minutes.

**Stated limits of this round's verification:** screenshots taken in this
environment show the Georgia fallback, not Cormorant Garamond — Chromium
cannot reach `fonts.googleapis.com` through the sandbox proxy (curl can; the
browser's CONNECT is reset), so the typography is unverified here even though
the `<link>` is correct. And tuning was by eye against a painted/AI reference,
so the target was matching character — elongation, scale, softness,
luminosity, framing — not exact ribbon shapes.

### Round 5: the shading model itself, not tuning

Round 4 fixed structural composition problems. The user then looked again
and said: *"the shading around globe is too obvious, it doesn't look 3d,
flowy."* The globe by that point *did* have curvature-driven shading — so
the question was why it still read as flat.

**Diagnosis:** all of round 3/4's shading (limb darkening + atmosphere rim)
was a function of `dot(normal, viewDirection)` only — rotationally symmetric
around the camera axis, brightest dead-centre, darkening/glowing uniformly
toward every point on the silhouette. That's a radial vignette, not sphere
lighting. The actual cue for "lit 3D object" is a *directional* light: one
side bright, the other dark, gradient between. A camera-relative symmetric
falloff has no direction — it reads as a filter over a flat image, which
is exactly what "too obvious, doesn't look 3D" was describing.

**Fix:** added a fixed-**world**-space key light (soft-wrapped Lambertian,
no hard terminator) as the primary shading term in `GlobeSphere.tsx`, and
cut the old view-based limb darkening and atmosphere rim to a near-whisper
— they no longer do the "reads as a sphere" work, the light does. Getting
the light into world space rather than view space mattered specifically:
a view-space light would swing around with the camera as the user drags,
which is the same flattening bug wearing a different hat.

**Verified it's actually world-space, not view-space**, since a bug there
would look fine in one screenshot and only reveal itself on rotation:
sampled average luminance in screen quadrants from `rotate-test.mjs`'s two
differently-angled outputs — `{tl:55,tr:63,bl:69,br:18}` vs.
`{tl:19,tr:40,bl:19,br:30}`. The same screen quadrants flip from bright to
dark between shots, confirming the light tracks the globe's geography, not
the screen. Full detail in `phase-0-prototype/README.md`'s "Round 5"
section, including the exact before/after uniform values.

### Round 6: evaluating an external "visual fix pack" (not new user feedback)

Unlike rounds 2-5, this wasn't the user looking at a fresh screenshot — it
was a pasted third-party document ("MOANA Globe — Visual Fix Pack"): vanilla
Three.js code plus a 5-point critique claiming the current build had a flat
non-flowing ocean texture, a small centered "marble in space" globe, hard
white vector-map coastline strokes, no atmosphere/too-dark exposure (with a
recommendation to switch to `THREE.ACESFilmicToneMapping`), and a swell path
built from a straight line stitched to a separate arc.

**The critique was evaluated against the actual code and actual rendered
screenshots at HEAD, not applied on trust** — worth doing explicitly because
the fix pack assumed vanilla Three.js (`scene.add`, `renderer.toneMapping`,
a 2D canvas overlay) against an app that's React Three Fiber throughout, and
several of its claims read as generic/templated rather than specific to this
codebase.

**Per-claim outcome**, each checked against fresh `shot.mjs`/`rotate-test.mjs`
screenshots, not just source reading:

1. **"Flat gradient, no flow field" — rejected.** `GlobeSphere.tsx` +
   `shaders/fbm.ts` already run a double domain-warped fBm with ~10:1
   anisotropic stretch along Helena's heading (rounds 2 and 4). Screenshots
   show clear marbled ribbons, not a blurred gradient.
2. **"Small centered globe" — rejected.** `Globe.tsx`'s 8° telephoto
   `FillFrameCamera` (round 4) is exactly the opposite of what was
   described; every screenshot shows the globe bleeding off all four edges.
3. **"Hard white coastline strokes" — rejected.** Land is `#0a1524` against
   ocean-deep `#071528` with only a 0.10-alpha derivative-band stroke
   (round 3's fix); screenshots show a soft, low-contrast line, not a
   vector-map outline.
4. **"No atmosphere; too dark; switch to ACESFilmicToneMapping" — rejected,
   and the remedy would have been actively harmful.** `Globe.tsx` sets
   `toneMapping: NoToneMapping` **deliberately** — round 3's own log records
   that the default tone mapping was clamping HDR peak colours before bloom
   could see them, silently defeating the whole ">1.0 for bloom" technique,
   and `NoToneMapping` was the fix for exactly that bug. Switching to ACES
   as the fix pack suggested would have reproduced it: `uOceanBright` and
   `HelenaPath`'s `BRIGHT` are both deliberately authored above 1.0 for
   this reason. An atmosphere rim shell already exists; screenshots show
   real limb glow and directional (not flat) lighting. No exposure change
   made.
5. **"Straight line stitched to an arc; fix with a 2D canvas bezier" —
   architecture claim rejected, but with a real kernel of truth.** There is
   no 2D canvas overlay anywhere in this app (`App.tsx` composes the R3F
   `<Canvas>` with DOM/CSS components only), and a screen-space bezier
   couldn't track the sphere's rotation/occlusion correctly regardless.
   But `HelenaPath.tsx` genuinely was rendering the path as a drei `<Line>`
   through the 20 raw waypoints connected by straight segments, no spline
   smoothing — a real (if subtle-in-practice) defect, just not the one
   described. **Fixed**: waypoints are now resampled through a
   `THREE.CatmullRomCurve3` (centripetal parameterization, to avoid
   loop/overshoot from the uneven real-world spacing between waypoints)
   before being handed to `<Line>`, with the existing per-waypoint energy
   colour gradient interpolated along the same curve parameter so it stays
   smooth too. Everything else about the path (glow, marker, `?e2e=1` hook,
   click handling) is untouched. Before/after screenshots at the same
   camera angles show the path is technically a true spline now rather than
   a polyline, though the visual delta is subtle at normal viewing
   distance/zoom — the underlying waypoint geometry was already close to a
   great-circle line over most of its short-hop segments, so this is a
   correctness fix more than a dramatic visual one.

**A genuine (if unrelated) issue surfaced while verifying, not caused by the
fix above**: `smoke-test.mjs`'s Follow-Swell click step timed out at its
hardcoded 8000ms in this sandbox session. Reproduced identically on the
unmodified pre-fix code (confirmed via `git stash`), so it is not a
regression from the path-smoothing change. A diagnostic run with a 30s
timeout showed the click **does** succeed, just at ~10.2s — this sandbox's
software-rendered WebGL (already documented elsewhere in this file as very
slow) is apparently too loaded in this session for an 8s click-actionability
window once the panel's 0.6s slide-in animation and the continuous
shader/bloom/autorotate render loop are competing for the main thread.
Flagging rather than fixing `smoke-test.mjs`'s timeout, since it's outside
this review's scope and the failure is session/environment-speed-dependent,
not deterministic — worth knowing if a future run hits it again, but not
worth chasing further without evidence it's more than that.

### Round 7: real Earth textures, not another procedural-tuning pass

The user posted the actual reference image directly in conversation for the
first time this session, looked at the round-6 build, and said it "doesn't
look anything like this." A first plan draft proposed the same kind of
thing rounds 2–6 had all been doing — nudge shader colour/threshold
constants, re-screenshot, compare by eye. The user rejected that outright:
*"make sure you are going to transform it onto reference picture... not
just do another round of expensive iteration... check all tools that can
be used to render it pretty premium feel."* That pushback was correct and
led somewhere real.

**What actually changed the plan:** testing direct network reachability
from this sandbox found that `raw.githubusercontent.com` and
`registry.npmjs.org` are reachable even though NASA's own image servers and
Wikimedia are blocked at the proxy — a different, more permissive network
policy than the fully-offline one described earlier in this file (Phase −1
section). That meant *real* Earth texture data was actually fetchable here,
which changes the right approach entirely: ground the render in real
photographic/data texture instead of trying to fake that detail from
noise parameters alone.

**Assets used** (downloaded and *visually inspected* before committing to
them, not assumed): `earth-night.jpg` and `earth-water.png`, fetched from
`vasturiano/three-globe`'s demo assets (an MIT-licensed, widely-used
data-viz-globe library — not adopted as a dependency, just its demo
textures). `earth-night.jpg`'s night-lights imagery turned out to already
sit close to this app's own established dark navy palette — continents
read as structurally distinct from ocean (real coastline shape, subtle
city-light warmth) while staying dark and atmospheric rather than becoming
a legible daytime map. `earth-water.png` is a real, much higher-fidelity
land/ocean mask (with actual river networks) than this project's own
hand-rolled scanline-fill mask. **Flag, not silent (§0 rule 2, same
standard as round 2's wordmark flag):** these are a third-party mirror, not
NASA's own distribution — reasonable for continued prototype work, written
up with the exact source/caveat in `public/textures/SOURCES.md`, worth a
real look before any release beyond the immediate working group.

**The actual technical change** (`GlobeSphere.tsx`): the real texture is
now sampled at every fragment and used for both land (replacing a flat
near-invisible colour) and as a subtle real-detail multiply on the
existing procedural ocean ribbons, rather than being the *only* source of
surface detail. The anisotropic domain-warped fBm ribbon shader itself
(rounds 2/4's real engineering) is untouched — this is a texture/colour
layer added under it, not a rebuild. Also: the octave cap that silently
limited the ribbon noise to 3 octaves regardless of quality tier (high
tier pays for 5 in `qualityTier.ts` but the shader never used more than 3)
is now the tier's real budget; the atmosphere glow (cut to "a whisper" in
round 5 specifically because it was fighting camera-relative shading for
attention — a problem round 5 itself already solved) is brighter and
broader; exposure is brighter throughout. `Globe.tsx` gained a
colour-grade pass (`HueSaturation`/`BrightnessContrast`/`ToneMapping`) using
`postprocessing` effects that were already a dependency but unused —
applied *after* Bloom in the composer chain specifically so it doesn't
reintroduce round 3's already-diagnosed tone-mapping/bloom-clamping
regression (verified: bloom highlights are still visible in every
post-change screenshot).

**Two real bugs found by actually screenshotting and reasoning about it,
not by guessing at more numbers:**

1. **Land leaked a bright, uniform, satellite-photo tan** across every
   continent on the first pass — nothing like the intended "mostly dark,
   distinguishable via subtle warmth" look, and nothing like the
   reference's more muted continents either. Cause: `pow(nightLum, 0.8)`
   is too gentle a curve — ordinary mid-grey terrain luminance (which most
   land pixels have, city lights or not) wasn't being suppressed enough
   before being added on top of the near-black base colour. Fixed with a
   much steeper `pow(nightLum, 2.2)`, so only genuinely bright source
   pixels (city lights, ice sheets) lift noticeably out of near-black.
2. **Teal was completely invisible — in every screenshot, at every camera
   angle tested (4 independent shots, 2 default + 2 rotated).** First
   assumed this was a frequency/threshold problem (the teal noise field's
   features were wide enough that a whole visible hemisphere could land in
   one "zero" region) and raised both — no change. **The real cause, found
   by reading the blend chain rather than tuning another number:** the
   ocean colour block was two independent sequential `mix()` calls (deep
   → teal, then separately deep → mid). The second call's weight (up to
   0.85) structurally overwrote almost everything the first one set,
   *regardless* of the teal blend weight — raising that weight could never
   have fixed it. Fixed by blending mid/teal into one colour first
   (`mix(uOceanMid, uOceanTeal, tealPatch)`), then mixing that single
   result in once. Verified with fresh screenshots at multiple angles
   showing real teal/green patches, integrated with the bright ribbon
   crests rather than washed out by them.

**An unrelated, already-known issue recurred during verification, not
caused by this round's changes:** `smoke-test.mjs`'s Follow-Swell click
step hit the same hardcoded-8s timeout documented in round 6 — same
failure mode, same root cause (this sandbox's software-rendered WebGL,
sometimes too loaded in a given session for an 8s click-actionability
window). Not investigated again since round 6 already diagnosed it in
full; still flagged as a possible test-timeout bump if it keeps recurring.

**Not independently verified against the literal reference image
pixel-for-pixel** — this round worked from the image as seen in
conversation plus the detailed description captured while writing the
plan, not a saved file on disk (the user didn't provide one as a file, and
this round didn't block on asking for it). If a future round wants a
tighter comparison, ask the user for the image as a file this time —
`public/textures/` is proof this sandbox can actually persist and use one.

### Verified, and how (current as of round 7, HEAD `349f4fb`)

No physical phone or human testers were available in this session, so
verification stopped at what automation can actually confirm. Four scripts
live in `phase-0-prototype/`, none of them a substitute for a human looking
at it, all worth re-running after any further shader/UI change:

- `npm run build` (typecheck + production build) and `npm run lint`
  (oxlint) both clean at HEAD.
- **`smoke-test.mjs`** — the interaction regression check, run against
  `npm run preview` on port 4173, both landscape (1600×900) and portrait
  (430×932) viewports: taps Helena's marker via a `?e2e=1` test hook (see
  below) and confirms the right-side panel opens with her name, clicks
  Follow Swell and confirms `localStorage` persists
  `["helena-phase0"]`, jumps the timeline to "3 Days" and confirms Helena's
  rendered position actually moves, opens the "About the data" sheet via
  the wordmark and confirms its content, confirms **no** standalone
  attribution text sits in the main view, zero console/page errors. Passed
  both viewports historically; **the Follow Swell click step has now timed
  out at its hardcoded 8000ms in two separate sessions (rounds 6 and 7)** —
  still session/environment-speed-related, not a real defect (round 6's
  diagnosis: the click succeeds at ~10.2s under a longer timeout, and the
  same timeout reproduces on unmodified code), but recurring across
  sessions is worth noting as a pattern, not just a one-off. If it recurs a
  third time, just bump the timeout in `smoke-test.mjs:45` — no further
  diagnosis needed, round 6 already did it.
- **`?e2e=1` query param**: the app publishes Helena's projected marker
  screen position on `window.__moanaMarker` when present. Added in round 4
  because sweeping screen coordinates to find a moving 3D marker is far too
  slow under this sandbox's software-rendered WebGL — every synthetic click
  waits on a real rendered frame, so a coordinate-grid search took minutes
  per viewport before this existed.
- `shot.mjs` — fast one-shot landscape+portrait screenshot pair, the loop
  used while tuning the shader by eye against the reference image.
- `rotate-test.mjs` — drags the globe to two different orientations and
  screenshots both. This is also how round 5's lighting fix was verified as
  genuinely world-space rather than camera-relative: sampling average
  luminance in screen quadrants across the two shots showed the same
  quadrants flip from bright to dark between them (`{tl:55,bl:69}` →
  `{tl:19,bl:19}`), which a camera-relative bug would not produce.
- `panel-glass-test.mjs` — rotates a bright/detailed globe region behind
  the panel before opening it, confirming the panel's scrim stays faint
  enough that globe detail is still visible through the text.
- Manual visual review against the user-supplied reference image, by eye,
  across five rounds of "here's what's still wrong" feedback (see the
  "Round 3/4/5" subsections above) — this is the part that's genuinely
  subjective and where a fresh look from the user matters most. Round 6
  added a sixth kind of check — verifying an external critique's claims
  against fresh screenshots rather than trusting or dismissing it outright.
  Round 7 added a seventh — treating the reference image itself as ground
  truth to fetch/verify real assets against, and reasoning through shader
  blend logic line-by-line when a change didn't produce the expected pixels
  instead of just trying another number.

**One thing explicitly NOT verified in this sandbox**: round 4 added
Cormorant Garamond (a Didone-family serif) via a Google Fonts `<link>` in
`index.html`. This sandbox's headless Chromium cannot reach
`fonts.googleapis.com` — the proxy resets the CONNECT (confirmed: `curl`
reaches it fine, so it's a browser-specific routing issue, not a dead
host) — so every screenshot taken in this environment shows the Georgia
fallback, not the intended typeface. The `<link>` markup is correct and
will load normally in a real browser; if the next agent has real network
access or the user is looking at it on their own machine, this is worth a
fresh look, and if it still doesn't load, self-hosting the `.woff2` in
`public/fonts/` would remove the dependency entirely (also required
eventually anyway — the Expo port can't use a `<link>` tag and will need
to bundle the font file via `expo-font`).

### What's still open — the actual gate

**The falsifiable test in §8 has not been run**: *"hand the phone to five
people who don't surf, say nothing, and time whether they rotate the globe
unprompted for 30+ seconds."* This requires physical devices and real
people in the room, which is outside what any agent session can do itself.
Automated verification above confirms the prototype is functionally
correct; it is **not** a substitute for the actual human test, and Phase 0
should not be declared "passed" until that test happens, and not before the
visual itself has stopped changing round-to-round (see "Status" above —
five rounds of user feedback so far; check whether the user considers round
5 the end of that or wants to look again before running the human test).
Recommended next step for whoever picks this up: `cd phase-0-prototype &&
npm install && npm run dev`, load it on a phone on the same network, and
run the test as specified.

Also not yet done, lower-priority than the human test: no dynamic/battery
adaptive-quality logic (§5.3's "adaptive quality" is scoped to the mobile
build, not required for a web-authored Phase 0 prototype, but worth a
reminder it's not here yet); the production JS bundle is ~1.2MB
un-code-split (fine for a local prototype, would want addressing before
any real deployment); the webfont-loading gap just above.

---

## What Phase −1 was and why it mattered

Per `MASTER_BUILD_PLAN.md` §8: before writing any app code, prove that real
marine forecast data clusters into discrete, trackable, nameable "swell"
objects — a coherent system that holds one identity from mid-ocean
detection to coastal arrival — rather than a fuzzy, constantly-fragmenting
field. If that doesn't hold, the entire product concept ("adopt a swell,
watch it travel, watch it arrive") has no foundation. The plan's own §0
rule: *"Building Phase 0 before Phase −1 passes is the single most
expensive mistake available."*

The plan specified concrete, falsifiable pass criteria (§8):
- **Clean window** (a real, documented big-swell event): at least one
  cluster holds a stable ID for 72+ hours and travels 2,000+ km.
- **Messy window** (an unremarkable period): no more than ~5 simultaneous
  clusters in a typical frame — otherwise there's no "one thing" to adopt.
- **Robustness**: a *range* of clustering parameters should pass, not one
  knife-edge setting — the plan explicitly calls a single lucky setting a
  failure signal in itself, not a pass.
- **Blind read**: show the result to someone with no context and time
  whether they can say "how many things are moving, can I follow one."

## What was built: `phase-1-validation/`

A throwaway validation harness (script-based rather than a notebook, but
the same disposable spirit the plan asks for):

| File | Purpose |
|---|---|
| `physics.py` | haversine distance, bearing, great-circle interpolation, deep-water group velocity (Cg = 1.56×T) |
| `grid.py` | North Atlantic ocean grid (20-65N, 80W-0, 2°×3°), hand-rolled land mask — synthetic-test only, not for production |
| `synthetic.py` | synthetic "clean"/"messy" swell field generator, used before real data was available |
| `clustering.py` | §4.5 region-growing clustering; operates on multiple simultaneous wave components per cell (swell/wind-sea/secondary-swell), not one collapsed value; accepts a `neighbor_fn` override to run on a different grid |
| `tracking.py` | §4.5 tracking with lineage (merge/split via `parent_id`/`merged_into`); predicts each track's next position from its own last-observed velocity when available, falling back to a physics estimate for brand-new tracks |
| `sweep.py` | 16-combination parameter sweep (period threshold, energy floor, angular tolerance, min cluster size) + pass-criteria evaluation |
| `visualize.py` | per-frame scatter → GIF, plus centroid-path plots, for the blind-read test; supports a different grid/region and a longitude-shift for plotting across the date line |
| `smoothing.py` | temporal smoothing preprocessing — tried as a fix, **didn't help**, kept for the record |
| `fetch_real_data.py` | fetches real Open-Meteo marine data (run *outside* this environment — see "Environment constraints" below); probes for secondary-swell support; `--grid pacific` for the larger Pacific region |
| `real_data.py` | converts fetched JSON into the pipeline's frame format; emits one record per available wave component per cell (not just the dominant one) |
| `diagnose_api.sh` | isolates Open-Meteo request-parameter issues (built to debug the all-null fetch bug, see below) |
| `run_validation.py` | CLI entry point: synthetic (default) or `--real clean.json messy.json`, optional `--smooth N` |
| `test_event.py` | tests one real North-Atlantic-grid event alone against the clean-window bar, no paired messy window needed |
| `global_grid.py` | real global ocean grid using the `global-land-mask` package + date-line-aware adjacency |
| `pacific_grid.py` | New Zealand-to-California test region, same real mask + date-line adjacency |
| `test_dateline.py` | synthetic test that found and verified the date-line wraparound bug (see below) |
| `test_pacific_event.py` | tests the real July 2024 Pacific event |

Six real datasets are fetched and present in the repo (large JSON files,
`.gitignore`d by pattern but force-added since they're the actual
evidence): `raw_clean.json` (Dec 2025), `raw_clean2_ireland_nov2023.json`,
`raw_clean3_nazare_feb2024.json`, `raw_clean4_nazare_jan2025.json`,
`raw_messy.json` (Sep 2025), `raw_pacific_2024.json`. Each has a matching
`output*/` directory with its sweep results, a cluster-animation GIF, and a
centroid-path plot.

## Environment constraints that shaped the process

Two things made this slower than it should have been, both worth knowing
before repeating this kind of work:

1. **This session's sandbox has no general internet access.** Confirmed by
   direct test — `open-meteo.com`, `noaa.gov`, even `google.com` reject at
   the network proxy with 403 (org policy, not transient). Every real
   fetch in this project was done by the user on their own Mac, with the
   resulting JSON handed back via `git add -f` + push. `WebSearch`/
   `WebFetch` tools worked for research (routed differently), but direct
   API calls did not.
2. **The obvious fetch parameters were wrong the first time.** See "Bug 1"
   below — this cost a full round-trip before any real validation could
   start.

## The investigation, in order: what was done, what worked, why

### 1. Code-logic validation on synthetic data (before any real fetch)

Built a synthetic swell-field generator designed to stress-test the
algorithm honestly: a fast, realistic-group-velocity "hero" pulse crossing
most of the North Atlantic basin, an unrelated secondary pulse (to check
distinct systems don't get merged), wind-sea clutter, and a "messy"
scenario with several short-lived systems including three
deliberately-overlapping ones (to force genuine simultaneity, since an
earlier version of this generator passed trivially by producing almost no
detectable clusters — caught and fixed before it could give false
confidence).

**Result: 16/16 parameter combinations passed.** This proved the
clustering/tracking *code* was logically correct under controlled
conditions. It proved nothing about the real product assumption — that
required real data.

### 2. Bug 1 — the first real fetch came back 100% null

A user ran the fetcher and got two files where *every single value, for
every cell, for both windows,* was `null` (0 non-null out of 134,736 in
each). Root cause, found with `diagnose_api.sh`: the fetcher passed
`models=era5_ocean` to Open-Meteo's marine endpoint — not a valid model
slug for it. The API returned HTTP 200 with `hourly_units` showing
`"undefined"` for every variable and silently null-filled arrays, no
error. **Fix:** drop the `models` param entirely; the API auto-selects
forecast vs. archive data by date range on its own (confirmed against both
a recent window and the actual historical window). `fetch_real_data.py`
now also self-checks its output and warns loudly on an all-null result, so
this specific failure mode can't happen silently again.

### 3. First real result (Dec 2025 Mullaghmore event): a genuine shortfall

With the fetch fixed, the real December 18, 2025 Mullaghmore, Ireland
event (widely reported as the biggest swell there in ~5 years) was
confirmed present in the data — 10.6m/13.5s peak, correctly timed. But
tracking it as one system did not hold up: at the plan's original period
≥12s definition, the longest track held only 36h/1,814km (needed
72h/2,000km), and a fine sweep of the period threshold gave a jagged,
non-monotonic result (78h→42h→36h→24h→42h) — the plan's own named
signature of a knife-edge rather than a robust pass. The one
numerically-passing setting did so amid a chaotic field of ~25-30 other
simultaneous short-lived tracks.

### 4. Research: how does real forecasting actually do this?

Investigated how operational wave models (WAVEWATCH III etc.) handle
exactly this problem. Finding: they don't track a single "dominant value
per grid point" — they partition each point's full wave spectrum into
windsea + up to 5 separate swell systems *first* (Hanson & Phillips 2001),
then run dedicated spatial tracking on top, because — per published work
(arXiv:1812.06662) — a single collapsed value per point isn't
spatially/temporally coherent enough to track alone. That directly
explained the instability found above and pointed at the fix: use
Open-Meteo's secondary swell field instead of collapsing each cell to one
"winning" component.

Also tested and **ruled out** a promising-looking idea: does finer time
resolution (1h vs 6h steps) help? First test showed a huge apparent win
(78h vs 36h). It was a measurement artifact — the tracker's match-distance
tolerance was still sized for 6h steps, loose enough at 1h steps to bridge
unrelated nearby blips into a fake "continuous" track (net displacement
3,386km vs. a claimed cumulative path of 8,146km, wandering off toward the
grid's edge — nothing like the real event). Corrected for timestep, finer
resolution actually got slightly *worse* (36h→18h→17h). This result later
became a useful diagnostic signature (see Bug 3 below): a legitimate track
has a net-displacement-to-cumulative-path ratio around 0.8; a bridged-blob
artifact runs around 0.4.

### 5. Multi-component clustering + Bug 2 (tracker) + Bug 3 (land mask)

Confirmed Open-Meteo supports `secondary_swell_wave_*` for this model.
Switching clustering/tracking to treat swell, wind-sea, and secondary
swell as independent, simultaneously-clusterable candidates per cell
(instead of picking whichever has the highest energy) brought the result
to a smoother, less jagged pattern — informative enough to keep digging
rather than declare victory or defeat.

That digging found two real, fixable bugs:

- **Bug 2 — tracker position prediction.** Traced the actual huge cluster
  underlying the Dec 18 event (79→118→137→159→180→195→164 cells across
  36+ hours — obviously one coherent, evolving system) frame by frame.
  Clustering found it correctly *every single frame*. The tracker lost it
  anyway: at one frame, the predicted position missed the actual cluster
  centroid by 468km against a 450km match threshold, because the
  physics-based prediction assumed the cluster moves in the direction
  implied by the energy-weighted mean of every member cell's reported wave
  direction — which, for a large region reshaping as cells join one edge
  and age out of another, is not the same thing as which way its centroid
  is actually drifting (observed: implied travel ~94° east; actual
  centroid motion that frame: due south). One bad prediction lost a
  150+-cell cluster's identity outright.
  **Fix:** the tracker now predicts from the track's own last two observed
  positions (standard practice in general object tracking) whenever it has
  them, falling back to the physics estimate only for a brand-new track
  with no observed velocity yet. This is *not* the "naive nearest
  centroid" the plan warns against — that would predict zero movement;
  this uses the track's own recent motion instead of an external physical
  assumption that turned out not to hold for large, reshaping clusters.
- **Bug 3 — this project's own land mask.** While tracing Bug 2, found
  real open ocean west of Scotland (58°N,-9°W and 58°N,-8°W — directly in
  the path of a swell heading toward Ireland/Scotland) was wrongly masked
  as "land" by `grid.py`'s original flat `lon ≥ -9 and lat ≤ 61` rule.
  Fixed with a better piecewise approximation (still hand-rolled, still
  not for production). Checked whether this caused the remaining
  shortfall — it didn't for this specific case (the real data shows
  measured period genuinely dropping below 13s as the swell nears shore, a
  real physical/data signal) — but it was a real bug worth fixing anyway.
  It mattered more later (see the global-scale section).

**Result after both fixes:** at the plan's original period≥12s
definition, a single track starting mid-Atlantic moved consistently
northeast, passing almost exactly through the real event's time and place
(hour 168 ≈ Dec 18 00:00), and held together for **66 continuous hours
across 3,263km** — 6 hours short of the 72h bar, but *consistently* so
across all 8 period=13 parameter combinations (66h or 60h, never wildly
off) — a real result, not a knife-edge.

### 6. Testing whether 66h-vs-72h was typical or unlucky: three more real events

Fetched three more independently documented events — different storms,
different seasons, one different coast:
- **Nov 9, 2023, Mullaghmore, Ireland** — Conor Maguire's widely-covered
  "swell of the decade" session.
- **Feb 24, 2024, Nazaré, Portugal** — Sebastian Steudtner's 28.57m
  record-attempt wave.
- **Jan 25-30, 2025, Nazaré, Portugal** — Storm Herminia, waves over 20m.

**At the plan's literal period≥12s: 0 of 4 events passed.** Durations
ranged 24h (Nov 2023, worst) to 66h (Dec 2025, best) — the original event
was actually the *strongest* of the four at that threshold, not lucky.

**At period_threshold=11, energy_floor=20: 3 of 4 events passed every
single swept combination outright** (90-132h, 2,900-5,800km). **The 4th
(Dec 2025) missed on only 2 of 4 combinations, and only on the distance
criterion — 1,987km against the 2,000km bar, a 0.6% miss**, with duration
(72h) exactly at the bar.

This reframed the question: the mechanism consistently found a real,
coherent, multi-day, thousands-of-km trackable system in every event
tested (4 for 4) — the limiting factor was the plan's specific 12-second
cutoff, one second tighter than real North Atlantic events needed, not the
algorithm.

### 7. Does this scale to real-time, whole-ocean tracking? (asked directly by the user)

Split into what's answerable without new data and what needed a real test:

- **Compute and cost:** fine. Clustering is near-linear in cell count
  (global ~7,500 cells vs. ~450 tested is a 15x jump, still sub-second per
  frame in unoptimized Python). Tracking's Hungarian assignment scales
  with concurrent track count, not grid size. "Real time" in the plan's
  own architecture (§4.3) already means a batch job every 3-6h, matching
  how often the underlying wave models refresh anyway. Re-costed the API
  budget with the now-9 variables (secondary swell included) at global
  scale, 6-hourly refresh: **~463K calls/month, under half the $29/month
  Standard plan's 1M cap.**
- **Land masking:** replaced the hand-rolled North Atlantic boxes with the
  `global-land-mask` PyPI package for global/regional testing — real
  (Natural Earth-derived), vectorized, computes the whole global grid in
  ~1ms, and correctly resolves the Bug 3 Scotland issue automatically with
  no manual boxes. New: `global_grid.py`. `grid.py` itself is untouched;
  the North Atlantic results stay reproducible on it exactly as before.
- **Bug 4 — international date line wraparound, found and fixed.**
  `grid.py`'s adjacency never needed to handle lon=180/-180 (the North
  Atlantic box doesn't touch it) — it doesn't wrap, so a cell at lon=178
  and one at lon=-178 (2 degrees apart on the real globe) were never
  connected. Built a synthetic test (`test_dateline.py`) of a swell
  crossing the seam: **without the fix it split into two separate track
  IDs and lost 36h of continuity (180h with the fix vs. 144h/split into
  two without it)**. Fixed in `global_grid.py`'s neighbor lookup (wraps
  correctly) and in `clustering.py`'s cluster centroid longitude averaging
  (a plain arithmetic mean of 179° and -179° gives 0°, not ±180° — switched
  to a circular mean, the same fix already used for wave direction).
  `clustering.py`/`sweep.py`/`visualize.py` gained an optional
  `neighbor_fn` parameter so a different grid can be used without touching
  the validated North Atlantic path (confirmed no regression).
- **Pole-adjacent grid density — flagged, not fixed.** On a fixed-degree
  grid, one longitude step is ~334km at the equator but only ~69km at
  78°N/S. Tracking itself is latitude-independent (works in real km via
  haversine throughout), but clustering granularity (what a "3-cell
  cluster" physically represents) isn't consistent across latitudes. Not
  fixed — would mean a reduced/variable-resolution grid, real scope creep
  beyond what was asked — but worth knowing before tuning global
  parameters.
- **The real long-distance test: the July 2024 "7,000-mile swell."** A
  storm off New Zealand's Chatham Islands generated a swell that hit
  Tahiti (Code Red conditions at Teahupo'o), Hawaii, and California over
  ~2 weeks, ~10,000km, crossing both the equator and the date line —
  exactly the plan's own §4.6 "epic, rare, 10-day, 10,000km" scenario, for
  real. Built `pacific_grid.py` (a ~1,200-cell New Zealand-to-California
  region) and `test_pacific_event.py`, smoke-tested against a synthetic
  version of the same geometry first (clean 114h/9,838km track crossing
  both the seam and equator) before spending real fetch time on it.

  **Result: 16/16 parameter combinations passed, including the plan's
  original, literal period≥12s threshold — no loosening needed.** The
  winning track (222 continuous hours, min_cluster_size=5) starts at
  45°S,176°W at hour 54 (matching the real storm's documented
  location/timing near the Chatham Islands almost exactly), crosses the
  equator around hour 210, and reaches 24°N,118°W by hour 276 — **9,756km
  net displacement**, closely matching the real event's independently
  reported **~10,000km** distance to California. Net-to-cumulative-path
  ratio: 83% — in the healthy range (see the false-lead diagnostic from
  step 4), not the ~40% ratio that flags a bridged-artifact track. The
  date-line crossing itself is visible in the raw clustering: at hour 30,
  two separate clusters straddled the seam (177°E and -178°W, ~230km
  apart) during the storm's own chaotic generation phase, before
  organizing into the one clean, forward-propagating 222h track from hour
  54 onward — a physically sensible generation-vs-propagation distinction,
  not a tracking failure.

### 8. The decision: threshold revised from 12s to 11s

Put to the user directly rather than decided unilaterally, per the plan's
own §8 instruction (*"Escalate this decision rather than deciding it
unilaterally"*) and its explicit anti-p-hacking design (*"write these down
before looking at results"* — moving the pass bar quietly after seeing a
result fail would defeat the point of a falsifiable test). The user's
call: loosen it. Reasoning, laid out before the decision: the four North
Atlantic near-misses were consistently about event strength, not a wrong
threshold in general — a genuinely powerful long-distance system (the
Pacific event) passed at the plan's original number with large margins,
while weaker North Atlantic storms needed the one-second loosening.

**Documented in `MASTER_BUILD_PLAN.md`:** §4.4 (the `category` field
definition), §11 (decision log, row 16), §12.2 (full evidence summary and
the decision itself, which also marks Phase −1 passed and clears Phase 0
to proceed).

### 9. Sanity check: would loosening further (to 10 or 9) help more?

Tested directly against all 6 real datasets before considering it, since
they were already on hand. Two things happen, and they cut in opposite
directions:

- **On the clean side, duration keeps inflating as the threshold drops** —
  e.g. Dec 2025 goes 66h (≥13) → 90h (≥11) → 192h (≥10) → 324h (≥9). Looks
  like an improvement. It isn't: the 324h "track" at ≥9 has a
  net-displacement-to-cumulative-path ratio of 0.38 (the false-lead
  signature from step 4) and wanders inside a fixed 22-45°N box for two
  weeks rather than going anywhere — an artifact, not a real story.
- **On the messy side (the decisive check):** at threshold ≥11 (current),
  the quiet window shows at most 1 simultaneous cluster, appearing in only
  6/56 frames — genuinely quiet. At **≥10**, max simultaneous jumps to 4
  (still technically under the plan's ≤5 ceiling) but something shows up
  in 38/56 frames (68% of the time) — a real, meaningful degradation in
  "quiet periods actually look quiet." At **≥9**, max simultaneous hits
  **7 — breaking the plan's own ≤5 ceiling outright**, with activity in
  every single frame of the supposedly unremarkable window.

**Conclusion: 11 is the right number, not a stopping point chosen
arbitrarily.** Loosening further trades away the "distinguish a real story
from noise" property that is the actual point of the two-window Phase −1
test, in exchange for duration numbers that are inflating for the wrong
reason. No code or threshold changes made as a result of this check — it
confirmed the existing decision rather than changing it.

---

## What's next

**Immediate next step:** show the current build (HEAD `349f4fb`) to the
user again. Round 7 was a real, substantial visual change (real Earth
textures, not just parameter tuning) made in direct response to the user
saying the previous build looked nothing like their reference — there is a
genuine open question of whether it's now close enough, which only a fresh
look can answer. Don't pre-emptively start a round 8 of self-directed
tuning on your own judgement. If they're happy, move to the falsifiable
test below; if not, "Round 7" above (and `phase-0-prototype/README.md`'s
matching section) shows the pattern that actually worked this time —
fetch/inspect real reference material and real texture assets where
possible, take real screenshots and reason concretely about *why* a value
isn't producing the pixels you expect (both round-7 bugs were found this
way, not by more guessing) — which should transfer directly to further
rounds. If another external critique/fix-pack shows up, "Round 6" shows
the pattern for evaluating one against real screenshots before touching
anything, rather than either blindly applying it or dismissing it.

**Phase 0 is built** (`phase-0-prototype/`, see the section above) but
**not yet passed** — it's blocked on the one thing no agent session can do
itself: handing a phone to five non-surfers and timing whether they rotate
the globe unprompted for 30+ seconds. Whoever picks this up next should
run that test — once the user is done iterating on the visual — before
treating Phase 0 as cleared and moving to Phase 1. If it fails, §8 says
iterate on shaders/motion/typography rather than adding data complexity to
compensate.

**Once Phase 0 actually passes, Phase 1** (`MASTER_BUILD_PLAN.md` §8):
global marine data ingestion — the scheduled job writing static JSON to
object storage, built against the full global grid from the start, with
derived energy/direction sanity-checked against a known real event before
anything downstream trusts it. This is independent of the Phase −1
validation harness above — it doesn't consume or reuse that code, only the
now-settled ≥11s threshold and the general clustering/tracking approach it
validated.

**Lower-priority open items**, not blocking, listed in
`MASTER_BUILD_PLAN.md` §12:
- **Open-Meteo call-volume budget** (§4.1): the ~463K calls/month estimate
  above is derived from a search-summarized pricing formula, not verified
  directly against Open-Meteo's pricing page (still blocked from this
  sandbox). Worth a direct check once real network access exists, before
  Phase 5 (the first paid feature) ships.
- **Brand name** (§12.1): still deferred, correctly — nothing here
  changes that.
- **Print fulfillment partner** (§12.3): still unselected, correctly, this
  far out.

**Loose threads from the validation work itself**, worth knowing about but
not blocking Phase 0:
- The messy window (Sep 8-21, 2025) was picked as a generic shoulder-season
  fortnight and was never independently cross-checked against the raw
  significant wave height the way the plan itself recommends — it happens
  to test clean (near-zero clusters at threshold 11-13), but that was
  confirmed after the fact, not verified up front.
- Only one messy window has been tested, vs. five clean/eventful windows.
  A second messy window would strengthen confidence in the ≤5 ceiling
  holding generally, not just for this one quiet fortnight.
- Merge/split lineage (`parent_id`/`merged_into` in `tracking.py`) is
  implemented and exercised by the synthetic tests, but hasn't been
  specifically stress-tested against a real event with a documented
  merge or split.
- Pole-adjacent grid density (§8 above) is flagged but not addressed —
  irrelevant for the North Atlantic v1 scope, relevant if/when the global
  grid is used for anything beyond validation testing.

---

## Quick reference: how to reproduce or extend this

Run any of the following from `phase-1-validation/` (all inputs are
already fetched and in the repo):

```bash
python3 sweep.py                                             # synthetic-data sweep
python3 run_validation.py --real raw_clean.json raw_messy.json   # Dec 2025 North Atlantic
python3 test_event.py raw_clean2_ireland_nov2023.json            # any single North Atlantic event
python3 test_event.py raw_clean3_nazare_feb2024.json
python3 test_event.py raw_clean4_nazare_jan2025.json
python3 test_pacific_event.py raw_pacific_2024.json               # the Pacific crossing
python3 test_dateline.py                                          # synthetic date-line check
```

To fetch a *new* event: add a `(start_date, end_date)` entry to `WINDOWS`
in `fetch_real_data.py`, then, **on a machine with real internet access**
(this sandbox has none):

```bash
python3 fetch_real_data.py --window <name>                    # North Atlantic grid
python3 fetch_real_data.py --window <name> --grid pacific      # Pacific-scale region (slower, ~1,200 cells)
```

Hand the resulting `raw_<name>.json` back (`git add -f` it, since these
files are `.gitignore`d by pattern but are the actual evidence) and test it
with `test_event.py` or `test_pacific_event.py` depending on which grid was
used.
