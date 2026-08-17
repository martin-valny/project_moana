# Project Moana — Progress Report

Last updated: 2026-08-17, branch `claude/moana-master-build-plan-v2-zjs07y`.

This file is a complete handoff record: what was done, how, what worked,
why, and what's next — written so a new agent (or the user, cold) can pick
up without re-reading the whole conversation history that produced it.

**The full plan this file references by section number (§4.4, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file first for the
product vision and rules; this file is the build/validation log against it.

---

## Status, one line

**Phase −1 is passed (decided 2026-08-17). Phase 0 (the visual-only
prototype, `phase-0-prototype/`) is built and verified by automated means
— it still needs the plan's actual falsifiable gate, five non-surfers
timed on a physical phone, which no agent session can run itself.**
Everything below explains how both conclusions were reached and what's
available to build on.

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

### Verified, and how

No physical phone or human testers were available in this session, so
verification stopped at what automation can actually confirm:

- `npm run build` (typecheck + production build) and `npm run lint`
  (oxlint) both clean.
- A Playwright smoke test (`phase-0-prototype/smoke-test.mjs`) against the
  built app in headless Chromium (iPhone-sized viewport): zero console/page
  errors, taps Helena's marker and confirms the panel opens with her name,
  clicks Follow and confirms `localStorage` persists
  `["helena-phase0"]`, drag-rotates the globe and confirms the view
  actually changes, moves the time scrubber to "3 Days" and confirms
  Helena's rendered position changes, opens the attribution sheet and
  confirms its content.
- Manual visual review of six screenshots at each of those states (dark
  navy palette, no red/orange/heat-map colours anywhere, no
  dashboard/table/chart chrome, minimal panel matching §2.3 step 5).

### What's still open — the actual gate

**The falsifiable test in §8 has not been run**: *"hand the phone to five
people who don't surf, say nothing, and time whether they rotate the globe
unprompted for 30+ seconds."* This requires physical devices and real
people in the room, which is outside what any agent session can do itself.
Automated verification above (build/lint/smoke-test/screenshots) confirms
the prototype is functionally correct and structurally on-brief; it is
**not** a substitute for the actual human test, and Phase 0 should not be
declared "passed" until that test happens. Recommended next step for
whoever picks this up: `cd phase-0-prototype && npm install && npm run
dev`, load it on a phone on the same network, and run the test as
specified.

Also not yet done, lower-priority than the human test: no dynamic/battery
adaptive-quality logic (§5.3's "adaptive quality" is scoped to the mobile
build, not required for a web-authored Phase 0 prototype, but worth a
reminder it's not here yet); the production JS bundle is ~1.2MB
un-code-split (fine for a local prototype, would want addressing before
any real deployment).

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

**Phase 0 is built** (`phase-0-prototype/`, see the section above) but
**not yet passed** — it's blocked on the one thing no agent session can do
itself: handing a phone to five non-surfers and timing whether they rotate
the globe unprompted for 30+ seconds. Whoever picks this up next should
run that test before treating Phase 0 as cleared and moving to Phase 1. If
it fails, §8 says iterate on shaders/motion/typography rather than adding
data complexity to compensate.

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
