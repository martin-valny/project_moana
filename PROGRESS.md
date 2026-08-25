# Project Moana — Progress Report

Last updated: 2026-08-25, branch `claude/swell-landmass-collision-j5f80b`.
Working tree clean, everything below is pushed.

**The current build is round 22 — a lattice-aligned noise-drift bug that
banded the ocean's texture after a few idle minutes, fixed on top of
round 21's land-texture mirror fix and round 20's contrast-power lever for
enclosed seas.** Rounds 14 and 15 landed the current visual model:
dispersive packets rather than filled disc sectors, brightness rather than
hue as the strength signal, no drawn line or marker for Helena, the
continents behind the water, and a panel glyph that tracks the scrubber.
Round 17 changed no pixels — it settled the filament question and cleaned
up after it.

> ### Left running, the ocean used to band into contour lines — read "22." before touching the noise's time terms
>
> Any `vec3(scalar)` fed into this shader's simplex-noise coordinates is
> suspect: broadcasting one value to all three axes drives that offset
> dead along `(1,1,1)`, which is a degenerate direction for the
> Ashima/Gustavson noise this project uses — the cell-skew step treats it
> specially, so moving along it re-hashes the same relative corner of each
> lattice cell instead of sampling independently, and the field stops
> looking random. The ocean's "slow independent evolution" term did exactly
> this with `uTime`, and it only took a couple of minutes of idle real time
> to become visible as parallel banding across the swell. Fixed by giving
> the three axes different rates instead of one shared scalar. See "22."
> for the direct before/after A/B that confirmed both the bug and the fix.
>
> ### The land texture was mirrored north/south — read "21." before trusting any screenshot of this app
>
> `THREE.Texture.flipY` defaults to `true` and nothing in `GlobeSphere.tsx`
> ever set it, so the shader sampled the real Earth mask and night-lights
> texture reflected through the equator: a correctly shaped planet with
> every landmass on the wrong side of the equator from where it really is.
> This is separate from, and predates, all the land-*shadow* work in "15."
> through "20." — the shadow physics reads the same mask through a
> `<canvas>`, which was never flipped, so every shadow decision in those
> rounds was computed against real geography. Only what got drawn was
> wrong, which is exactly what made round "20."'s own screenshot
> verification misleading without anyone noticing — the swell in that
> screenshot really was behaving correctly, just next to a mirrored
> coastline. Fixed by two `flipY = false` lines. See "21." for how this was
> found (real city coordinates projected through the app's own camera
> landed nowhere near the coastline drawn on screen) and for a real
> chokepoint at Panama re-verified against now-correct geography.

> ### Land shadowing is round 19's baked atlas, tuned in round 20
>
> Four rounds ("15."–"18.") modelled land shadowing *per great-circle ray*
> and all four were reverted — a per-ray model's shadow boundaries are
> geometrically straight lines, and softening them by a physically accurate
> amount (round "18."'s Fresnel aperture) isn't enough at the zoom the app is
> actually viewed at (~5-7km/pixel with the globe filling the frame): real
> ocean-swell diffraction widths for these wavelengths are only tens of km
> even thousands of km downstream. See "18b." for the measurements that
> pinned this down (roughly 300 hard radial boundaries across six sources;
> leak scans showed the *blocking strength* was already correct — the
> problem was purely smoothness).
>
> **Round 19 replaces the live per-ray model with a one-time CPU bake.** Per
> source: find each bearing's first land hit (as before, closed against
> sub-cell islands), then blur *each radius ring independently* with a
> deliberately wide, explicitly stylistic softening (`SHADOW_SOFT_FLOOR_KM =
> 200`, not physics-derived) into a full (bearing x radius) grid of
> already-blurred transmission values. The shader does one bilinear texture
> lookup per source per fragment — no live aperture sum, so there's no
> tap-count-vs-cost tradeoff forcing the aperture to stay narrow.
>
> **An iterative diffusion-PDE march (propagate energy outward, absorb on
> land, diffuse every step) was tried first and abandoned — not for being a
> bad idea, but for a real numerical failure mode:** a discrete Gaussian
> kernel evaluated at integer cell offsets with sigma below about half a cell
> transfers essentially nothing to its neighbours, so many small steps never
> accumulate the way the continuous diffusion equation says they should.
> Measured directly: a point that had just cleared 250km of land stayed
> frozen at its raw absorbed value across 5,700km of further, entirely
> open-water travel. Baking per-ring independently (no iteration) sidesteps
> this entirely. See "19." for the full account, including two spherical-
> geometry bugs found chasing the PDE approach that are worth knowing about
> if anyone tries it again.
>
> **Round 19 was numerically correct and still looked wrong: `SHADOW_SOFT_FLOOR_KM`
> controls how far a boundary is softened, not how dark a partially-lit point
> reads once the swell's own brightness and bloom are layered on top**, so an
> enclosed sea a few hundred km across still read as "lit" even with every
> chokepoint numerically well under 0.1. Round 20 adds a second, orthogonal
> lever, `SHADOW_CONTRAST_POWER = 2` (`transmission ** POWER`, applied after
> the blur) — smooth and monotonic everywhere, so it can't reintroduce a hard
> edge, only steepen the falloff the blur already produces. See "20." for the
> raw-field renders that made the effect visible and the ground-truth sweep
> that picked 2 as the value that fixes the complaint without paying much of
> the same edges-toward-hard cost round "18." was reverted for.
>
> Verified against the real mask, the real sources, and — this is the check
> the last four "15."-"18." rounds didn't have — actual zoomed screenshots of
> the exact scene reported broken (Central America / the Caribbean, camera
> driven to match). Read "19." and "20." before touching `swellField.ts`'s
> shadow section or `landOcclusion.ts`.

> ### The filament question is closed — read this before "fixing" the shader
>
> The ocean's noise sampling is **isotropic on purpose.** It is not a bug and
> it is not waiting to be fixed.
>
> It *was* a bug for a long time: rounds 1-8 stretched the noise domain along
> the flow to produce streaks, round 9 replaced the global flow vector with a
> per-fragment tangent, and that silently reduced the stretch to a uniform
> scale (`f` is a tangent at `vPos`, so `dot(vPos, f) ≡ 0`, measured
> 1.665e-16). Rounds 9-16 rendered isotropic noise under a comment insisting
> they produced streaks.
>
> Round 16 found it and fixed it properly. The user rejected the result on
> sight — "ugly", and it was: hard, evenly spaced contour lines. Shown both
> frames side by side afterwards, they chose the soft field: *"the first/left
> image is way better."* **So this is now the chosen look, arrived at by
> comparison rather than by accident.**
>
> Round 17 deleted the dead code and the misleading comment, and inverted the
> guard: `B2` in `parity-probe.mjs` now asserts the sampling **stays**
> isotropic, so a stretch cannot reappear without someone deciding to.
> `git show 1856985` has the working anisotropic implementation if this is
> ever revisited.

This file is a complete handoff record: what was done, how, what worked,
why, and what's next — written so a new agent (or the user, cold) can pick
up without re-reading the whole conversation history that produced it.

**The full plan this file references by section number (§4.4, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file first for the
product vision and rules; this file is the build/validation log against it.

---

## Status, one line

**Phase −1 is passed (decided 2026-08-17). Phase 0's visual prototype
(`phase-0-prototype/`) has had seventeen rounds: fifteen landed, and two built
and reverted (13 and 16). The current state is round 17.**

**Filaments are no longer an open thread.** Round 16's mechanism worked and was
rejected on looks; shown both renders side by side the user chose the soft
isotropic field, so it is the decided look and round 17 tidied up behind that
decision without moving a pixel. What remains blocking Phase 0 is the §8 gate —
five non-surfers, a physical phone — and nothing in the shader.

The user's two round-13 complaints ("I dont wna that line there... the swell
movement, body, entity has to be intuitive *using color gradients, filament
movements etc.*" and "you kinda just make everything look blue") both turned
out to be structural, and both were measured before anything was changed:

- **The purple never rendered.** The round-10..13 weak→strong ramp needed its
  input above ~0.6 before green drops below red — i.e. before it reads violet
  at all — while the field's measured working range was 0.05..0.45, mean 0.30,
  all-time max 0.869. The violet half of that ramp was never once requested on
  any frame. Round 13's three tuning passes were all downstream of a variable
  that could not move.
- **Nothing read as moving** because the brightest part of a swell was not its
  leading edge. Measured on the CPU, the old on-axis weight profile varied only
  ~1.5:1 across 70% of a swell's radius and peaked at d ≈ 0.7 × front —
  *behind* the front — with the storm origin still at 57% of peak. A filled
  sector reads as a region, not a thing in motion.

Round 14 replaced the model rather than the constants. **This is still gated on
the plan's own falsifiable test — five non-surfers timed on a physical phone —
which no agent session can run itself, and which has not run yet.**

**If you're picking this up cold, read in this order:** (1) this "Status"
section and the box above it, (2) **"Round 17"** — how the filament question
was closed and what the B2 gate now asserts, then **"Round 16"** for the
mechanism it decided against, (3) "Round
15" and "Round 14" for the current mechanisms and the bugs the harness caught,
(4) "The metrics harness" (in the round-14 entry) for how to re-run the gates,
(5) "Round 13" for the reverted colour work's own diagnosis (still true — the
ACES-at-extremes finding is load bearing in round 14's colour design),
(6) "Round 12" for the bidirectional timeline and source spawn-in, (7) "Round
10" for lateral inhibition and pole-zone spirals, (8) "Round 9" for the
swell-physics rework and its central lesson (verify uniform updates actually
reach the GPU by checking object identity, not by reading back the JS value you
just set — the two can silently diverge), (9) "Round 8" for how "measure the
reference, don't describe it" found a large framing error, (10) "Round 7" for
the real-texture rework, (11) "Round 6" for how to evaluate an external critique
without trusting or dismissing it blindly, (12) skim "What was built" and rounds
2–5 for context.

**Recurring lesson worth internalising before you start.** Four separate bugs in
this project have been the same shape: *two places holding what should be one
fact, or a stated fact nobody measured.* The uniforms-cloning bug (round 9 — the
ocean had never animated; seven rounds of screenshots were all plausible static
frames), the hand-written heading contradicting its own waypoints, the 'WNW'
label on an ENE path, and the anisotropy no-op. In every case the code *said*
the right thing in a comment and did something else, and in every case it was
found late and by accident. **Measure the claim, don't read it.**

The anisotropy one is now closed twice over: the dead code is gone, and `B2`
asserts the property the comment claims. That is the pattern worth copying —
when a comment states a fact about the code, prefer a sub-second gate over a
sentence. Rounds 9-16 would have been very different with one.

## Where this stands right now, and what to pick up

**Verified after round 17** (run 2026-08-20): build and lint clean; Stage A
5/5; parity `B` 0.000368 against a 0.02 tolerance and `B2` 1.0001 against
1.0 ± 0.02; Stage C 9/9; `smoke-test.mjs` passes both viewports with zero
console errors; `panel-glass-test.mjs` and `rotate-test.mjs` pass.

Round 17 is a no-pixel change, and the numbers below confirm it: every gate
landed within normal run-to-run animation variance of its round-15 value
(M2 2.56→2.57, M4p 3.53→3.56, M10 0.684→0.689).

| Gate | Measured | Threshold |
|---|---|---|
| M1 leading-edge dominance (model) | 0.03% of band width | ≤ 15% |
| M4 still-frame asymmetry (model) | 4.68× | ≥ 3.0× |
| M8 / M8b dynamic range, clipping | P99 ≥ 0.831; 0.868% of globe | ≥ 0.65; ≤ 1.5% |
| M9 bands not a wash | 14.8% of globe | ≤ 22% |
| B CPU/GPU parity | 0.000368 | ≤ 0.02 |
| B2 sampling stays isotropic | 1.0001 | 1.0 ± 0.02 |
| M2 brightness range on screen | **2.57×** | ≥ 2.5× |
| M3 no violet leakage | 0 of 587,885 px | ≤ 0.1% |
| M1p / M4p packet shape on screen | 0.90 × rLead; 3.56× | 1.0 ± 0.18; ≥ 1.25× |
| M5a / M5b scrub advances, redraws | all edges advance; 29.6% px changed | — |
| M7 glyph matches data | delta (0.00, 0.00)° | ≤ 1.5° |
| M10 land subordinate to water | 0.689 | 0.35–0.90 |

**M2 has under 3% of margin and is the gate most likely to flip** on any change
to the colour chain or the land treatment (both move the ocean's luminance
distribution). If it drops, the answer is more contrast in the bands, not a
lower threshold.

### Open items, roughly in priority order

1. **The §8 gate has never run** — five non-surfers timed on a physical phone.
   No agent session can run it, and Phase 0 is not finishable without it. With
   filaments closed, this is not merely the biggest outstanding item, it is
   very nearly the only one, and it needs the user.
2. **The pre-Phase-1 ingestion spike is done, and its fix is live (see "10."
   and "11." under the Phase −1 investigation, and "Thread B" under "What's
   next").** The spike found that real per-cell energy (138-1,078 measured)
   blew past the shader's Helena-calibrated `ENERGY_RANGE`, clamping half a
   real track's points to maximum brightness, and that a real track's
   centroid can double back in a way Helena's hand-placed path never does.
   Both are now fixed in `phase-0-prototype/src/data/` — pulse-driven
   sources normalise against their own path's own energy span instead of a
   shared ceiling, and front distance tracks a running max instead of the
   current, possibly-backtracked position — on the user's direct
   instruction rather than waiting behind the §8 item above. The real track
   is now a live sixth source in the same build §8 will eventually test.
   What's still open under this: the full metrics-harness re-run (item 1
   under "Thread B"), not yet done. Real Phase 1 (scheduled ingestion,
   storage, the full seven-basin grid) has still not been started, correctly
   — it's real Phase 1 work and was never in scope for this spike.
3. **Nothing is known-broken.** Land treatment and the panel glyph were the
   user's two round-15 asks and both landed. Filaments are decided, not
   deferred (see the box at the top). Round 17 left the frame untouched.

### Things the user has decided, so don't re-litigate

- **Isotropic ocean sampling, no filaments.** Decided in round 17 by direct
  comparison of both renders, then re-confirmed against two middle-ground
  variants ("current no filaments is best"). The soft field is the chosen look,
  not a limitation being worked around. `B2` guards it. Do not reopen this on
  the theory that a subtler version exists — one was built and it doesn't.
- **No purple.** Dropped in round 14 with the user's agreement, after measuring
  that it never rendered. M3 now asserts zero red-dominant ocean pixels.
- **No drawn line or marker on the globe.** Removed in round 14; the path lives
  in the panel glyph only.
- **Helena's front comes from her own waypoints**, not `Cg` — her track runs
  2.6× slower than her stated period implies.
- **Packet decay is floored** (~0.35–1.0 rather than the physical 0.10–1.0) so
  swells stay legible across the whole scrubber.

### Running the harness

```bash
cd phase-0-prototype
npm install
npm run build && npm run lint
node --import ./ts-resolve-hook.mjs --experimental-strip-types field-metrics.mjs --cpu     # Stage A, seconds
npm run preview -- --port 4173 &
node --import ./ts-resolve-hook.mjs --experimental-strip-types parity-probe.mjs            # Stage B, ~1s
node --import ./ts-resolve-hook.mjs --experimental-strip-types field-metrics.mjs --pixels  # Stage C, ~5 min
node smoke-test.mjs && node panel-glass-test.mjs && node rotate-test.mjs
node timeline-shots.mjs   # screenshots at every labelled stop, both viewports
```

**Land shadowing is live again as of round "19."**, baked once per source
into `landOcclusion.ts`'s shadow atlas; `parity-probe.mjs`'s `B3` covers the
pack/upload/sample round trip (much smaller than round "18."'s `B3` since
there's no live aperture math left in GLSL to duplicate — see "19."). There
is no standalone CPU gate file this round; the ground-truth basin-wide
scoring that validated `SHADOW_SOFT_FLOOR_KM` was scratch tooling, not
committed, per this project's own convention — reuse the *methodology* (score
unambiguous points only, sweep both wrongly-lit and wrongly-dark) rather than
a plain threshold scan if this needs re-tuning; round "19." found a naive
threshold scan flags thousands of false "leaks" that are actually legitimate
coastal diffraction. **Whatever changes this: verify at zoom, not just at
globe scale** — every gate before round "19." measured at ~16-20km/pixel,
where the failure the user actually saw (hard edges, ~5-7km/pixel) was
invisible.

**Do all geometry work in Stage A.** It runs against the TypeScript model with
no renderer, so an iteration costs milliseconds against the ~60 s a screenshot
costs in this sandbox (software WebGL, ~1.2 fps measured, and OrbitControls
damping needs ~60 s of wall clock before frames are comparable). Four of round
14's five bugs were caught there.

**And do not let a green harness decide the look.** Rounds 13 and 16 both
passed every automated check and were both rejected on sight. The gates prove a
mechanism reaches the screen; only the user can say whether it should.

---

## Round 14 planning (superseded — round 14 has since landed; see "Round 14" under Phase 0)

**Kept as the record of what was planned before implementation. The plan
below was followed, with two additions it did not anticipate: Helena's
front had to be derived from her own path rather than Cg, and her
amplitude had to come from her interpolated waypoint rather than
`path[0]`. Both are described in the round-14 entry.**

### What the user actually asked for

Verbatim: *"I dont like what you did compare to last version.. I dont
like the line at all.. like i dont wna that line there. the swel movement,
body, entity has to be intuitive using color gradients, filament movements
etc. moreover you kinda just make everything look blue."* Two distinct
points:

1. **Round 13's colour work made the ocean read as broadly flatter/bluer**
   than before, not more colourful — already reverted, see above. Nothing
   further to do here except not repeat the same mistake (see "What to
   avoid" below).
2. **The line has to go, full stop — not restyled again, removed.** Round
   11 already tried once to fix "I don't like the white line and circle"
   by softening it (gradient stroke, glow billboard instead of a solid
   dot). That was the wrong kind of fix for what the user now wants: they
   were never objecting to the line's *styling*, they're objecting to a
   *separately-drawn path object existing at all*, distinct from the
   ocean's own procedural rendering. Position, direction, and identity
   need to emerge from the same colour-gradient/filament-flow language the
   rest of the swell field already uses, not from a Three.js `Line` +
   billboard sprite layered on top of it.

### The key fact that makes this tractable, not a rewrite

**Helena is already one of the sources in `buildSwellSources()`**
(`swellSources.ts`): `const helena: SwellSource = { origin, direction,
periodS, heightM, spawnOffsetHours: HELENA_MIN_OFFSET_HOURS, ... }`,
derived directly from `pulse.path[0]`. She already renders in the ocean
shader with the exact same directional-cone, colour-ramp, and
trailing-wake machinery (rounds 9/10/12) as the five invented decorative
sources. The separate `HelenaPath.tsx` component — the curved multi-day
line plus the glowing current-position marker — is *additional*,
redundant rendering layered on top of a swell that already has its own
visual presence in the field. Removing `HelenaPath.tsx`'s visible output
is not "how do we show her instead" so much as "stop drawing a second,
conflicting representation of something already shown."

### Concrete plan

1. **Remove `HelenaPath.tsx`'s visible rendering** — the `<Line>` (trail)
   and the `<Billboard>` glow (marker). Her swell cone in `GlobeSphere.tsx`
   already conveys position (the cone's origin/spread), direction (the
   cone's own flow direction, feeding the same anisotropic noise stretch
   as every other source), strength (the colour ramp, once round 13's
   *concept* — not its specific tuning — is redone properly), and recency
   (the round-12 trailing wake, spawn-ramp fade-in).
2. **Interaction still needs solving**: §6/§8 require tap-to-select and
   Follow. `HelenaPath.tsx` currently supplies the only click target (an
   invisible hit-sphere at `currentPos`). Options, not yet evaluated:
   - Raycast against `GlobeSphere`'s own mesh and compute, per click,
     whether the hit point falls within Helena's own cone (known
     analytically: same `spread`/`arrived` test the shader already
     computes, re-derivable on the JS side from `sources[0]`, `offsetHours`
     and the click's unprojected lat/lon) — no visible marker needed at
     all, tap anywhere on her actual swell.
   - Keep a *small*, low-opacity hit-target mesh at her current position
     for tap reliability (mobile tap targets need real screen area — the
     existing `radius * 0.05` sphere in `HelenaPath.tsx` exists for
     exactly this reason, see its own comment), but make it **fully
     invisible** (`opacity={0}`, as it already effectively is for the hit
     mesh) rather than rendering any of the glow/line on top — pure
     interaction affordance, zero visual footprint. Probably the
     pragmatic first move: keeps `?e2e=1` / `window.__moanaMarker` (used
     by `smoke-test.mjs`) working unchanged, since that hook reads
     `currentPos`, not anything about the line's visual style.
   - If "which swell is Helena" needs to be visually findable at all
     (vs. leaving that entirely to the panel/UI), that's a *design*
     question for the user, not something to guess at — e.g. a distinct
     hue reserved for her vs. the decorative sources would contradict the
     "one shared colour language" instruction, so probably not that.
3. **"Current position" without a drawn marker** is the part most worth
   getting the user's read on before implementing rather than guessing:
   does "intuitive, using colour gradients and filament movement" mean the
   *leading edge* of Helena's own cone (already the brightest, most
   saturated part per round 12's wake) is sufficient to answer "where is
   she right now," or does the product actually need a distinct
   "you-are-here" cue independent of the swell rendering? Worth asking
   directly rather than assuming either way — this is the one open
   product question in an otherwise mostly-mechanical task.
4. Once `HelenaPath.tsx` no longer draws anything, decide whether the file
   still needs to exist at all (maybe just the invisible hit-target,
   folded into `Globe.tsx` directly) or whether it's cleaner deleted with
   click-handling moved elsewhere. Don't leave dead/unused component
   scaffolding behind.

### What to avoid repeating

Round 13's actual failure wasn't its diagnosis (kept, still true) — it was
**tuning shader constants against screenshots without stepping back to ask
whether the visual language itself was right.** Three tuning passes
(colour weights → curve shape → mist-extent gating) each measurably
"fixed" what was being tested and still produced a result the user didn't
want, because the deeper ask (no separate line, ocean-native
representation) was never on the table until they said so directly. Don't
default to "keep adjusting numbers until a screenshot looks better" as the
first move here — the fix this time is structural (remove a whole
rendering path), not a blend weight.

### Verification, once implemented

- `smoke-test.mjs` currently asserts on `window.__moanaMarker` and a
  click-driven panel open — confirm what "select Helena" means once there's
  no visible marker to reference in test descriptions, even if the
  underlying hook stays the same.
- Screenshot at a few timeline positions and confirm Helena's own cone is
  still distinguishable as "the one with the panel/Follow button," not
  just visually identical to the five decorative sources with no way to
  tell them apart.
- Re-run `panel-glass-test.mjs` and `rotate-test.mjs` — removing a
  rendered layer shouldn't break either, but confirm rather than assume.
- Show the user a fresh screenshot before considering this done — round 13
  is the second time in this session a "confirmed working" change wasn't
  actually what the user wanted once they saw it themselves; don't declare
  victory from automated checks alone on a subjective visual-language
  change like this one.

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

### Round 8: measuring the reference instead of describing it — and three tooling/quality bugs

The user posted the reference image again after round 7 and said it was
"better but still doesn't look like this." Round 8 stopped describing the
reference in prose and started **measuring** it, which turned up one large
compositional error and three bugs — two of which meant the previous
rounds' screenshots weren't showing what a user would actually see.

**The composition was wrong, and by a measurable amount.** In the
reference the globe spans ~74% of the frame width with clear black space
past both limbs, cropped only top and bottom — a whole planet. Round 4's
`FillFrameCamera` was set so the sphere spanned ~97% of frame width. That
is not a planet, it is a close-up of a patch of ocean: at that zoom the
visible area is roughly a 60° arc, so whatever landmass sits near the
camera axis fills the screen. Fixed by extracting the constant as
`DISC_COVERAGE = 0.74` in `Globe.tsx`. FOV stays telephoto (8°), which is
what gives the near-full hemisphere with little perspective distortion
that the reference also shows; only the distance changes.

Worth recording honestly: **round 6 rejected the external fix pack's
framing complaint**, on the grounds that the code deliberately made the
globe overflow the frame and the fix pack's description of it ("small,
centered, marble in space") didn't match what was rendering. The
description really didn't match — but the underlying instinct that the
framing was wrong was right, and dismissing the claim on the strength of
the mismatched description meant two more rounds passed before it was
caught. A wrong description of a real problem is still a real problem.

**Bug: `shot.mjs` was not deterministic and never showed the opening
composition.** It was the only script of the four that didn't set
`reducedMotion`, so idle auto-rotation kept running — and under this
sandbox's software-rendered WebGL a single screenshot takes tens of
seconds of wall-clock time, during which the globe spins a long way. Every
tuning screenshot therefore landed on an essentially arbitrary longitude.
Several rounds of "why is there a huge continent in the middle of frame?"
were partly this artifact. Fixed by setting `reducedMotion: 'reduce'`, as
the other three scripts already did.

**Bug: `prefers-reduced-motion` silently forced the LOW quality tier.**
`qualityTier.ts` had `if (prefersReducedMotion || cores <= 2 || ...) return
SETTINGS.low`, which conflates a vestibular-comfort preference with device
capability. Two consequences, both real: any user with reduced-motion set
got a 2-octave globe instead of 5 for no reason (the correct response to
that preference is to stop the motion, which `Globe.tsx` already does
separately), and — because *every* screenshot and test script sets
`reducedMotion` for determinism — all of this project's automated visual
checking had been rendering the low tier rather than what a typical user
sees. Round 7's "octave cap raised to the tier's real budget" fix was
therefore invisible in its own verification screenshots. Fixed by keying
the tier on hardware only.

**Verified rather than assumed: the camera and texture mapping are
correct.** Screenshots kept showing a large landmass near the centre of a
view aimed at 24°N/−48°W, which is open ocean (Sargasso Sea), so this
looked like a possible repeat of round 4's 180°-offset mask bug. Checked
two ways instead of by eye: sampling `earth-water.png` at eight known
land/ocean coordinates (8/8 correct), and computing the expected screen
projection of known landmarks against a temporary debug build with land
tinted flat red. Greenland projected to (258,108) and rendered there;
Helena's marker to (262,185) and rendered there; the Amazon to (210,336)
and rendered there. **No bug — the mass is North and South America,
correctly placed; the earlier visual reading of it was simply wrong.** The
debug build was reverted immediately. Recording this because "the render
looks geographically implausible" recurs in this project and eyeballing
continent shapes on a partially-lit sphere has now produced a false alarm
as well as a true one (round 4).

**Visual changes**, all in `GlobeSphere.tsx` unless noted: land lifted out
of the near-black hole round 7 over-corrected it into, with a gentler
luminance curve so real terrain texture shows; ribbon ramps widened
(the reference's flow reads as translucent feathered veils, closer to
cirrus or aurora than to painted streaks — widening a ramp is what softens
an edge, the noise shape was never the problem); palette desaturated
toward the reference's steel blue and muted olive-green rather than
saturated royal blue and vivid teal; lit floor raised (the reference has
essentially no dark side); tonal range rebalanced toward deeper water with
more delicate highlights. In `Globe.tsx` the round-7 colour grade's
saturation was cut 0.18 → 0.05: a global saturation boost *multiplies*
what the shader already produced, so it was compounding with the palette's
own saturation rather than grading it.

Two overshoots were caught and corrected within the round rather than
shipped: the first atmosphere pass (shell 1.085, alpha 0.45) produced a
distinct teal *ring* with its own visible outer edge — at whole-disc
framing an 8.5%-of-radius shell is a large object in frame, not a haze —
and the first teal pass produced vivid emerald blotches over half the
ocean once the blend bug from round 7 was fixed and the bands softened.

**Still not matched, honestly:** the reference is a polished render (very
likely with real current data and volumetric atmosphere behind it). This
is closer in composition, tonality and colour than any previous round, but
a real-time procedural fBm shader is not going to land on it exactly, and
the remaining gap is mostly in the fineness of the filament detail and the
photographic quality of the atmosphere. Further convergence needs the
user's eye on specific remaining differences, not more self-directed
tuning.

### Round 9: real swell propagation, and the ocean had never actually animated

The user looked at round 8's build and asked four things at once: why the
ocean looked "kinda smeared," why the atmosphere glow had "no transitions,"
whether the continents were over-detailed, and — the substantial one —
whether the filament pattern could be *actual swell propagation*, showing
where each swell can potentially go, rather than a decorative texture.

**The smearing question had a precise answer.** The ocean shader was not
visualising currents at all — `GlobeSphere.tsx`'s `uFlowBias` was a single
global direction (Helena's own compass heading) applied to the *entire
planet*. Every fragment stretched the same way, which is exactly what
"smeared" describes. The other two points were quick, real fixes: the
atmosphere shell's Fresnel term was inverted (brightest at the shell's
*outer* edge, fading *inward* toward the planet, then hard-cut where the
geometry ends — the opposite of a real halo), fixed by normalising against
the limb angle so it peaks at the planet's edge and fades smoothly outward;
land's luminance lift was pulled back from round 8's level, which read as
more detailed than §5.1 wants for orientation-only continents.

**The substantial fix, decided with the user:** several invented storm
sources (`src/data/swellSources.ts`) alongside Helena, each radiating a
directional great-circle fan from its own origin, using
`Cg = 1.56 × period` — the same deep-water group-velocity formula
`phase-1-validation/physics.py`'s `group_velocity_kmh` already uses, kept
identical deliberately rather than inventing a second number for the same
physics. `GlobeSphere.tsx`'s ocean branch now loops over up to 6 sources
per fragment computing: how far each front has travelled (a soft leading
edge, since real swell fills in behind a front rather than vanishing ahead
of it), a ~60°-wide directional spread around each storm's actual heading,
and distance falloff — then uses the energy-weighted direction for the
*existing* anisotropic sampling (rounds 2/4's engineering, untouched) and
total local energy for contrast. Anisotropy ratio lowered from ~10:1 to
~5:1, since direction genuinely varying by position needs less stretch to
read as flow than one constant direction ever could.
`MASTER_BUILD_PLAN.md` §8 constrained the scrubber to Helena's marker only;
decision-log row 18 records this deliberate, user-directed supersession —
still zero live data, every additional source invented on the same footing
as Helena, flagged in `swellSources.ts`'s own header.

**Two real bugs, both found by refusing to trust a screenshot that "looked
plausible" and checking numerically instead of by eye:**

1. **A sharp diamond/kite artifact at each source's own origin.**
   "Direction pointing away from a point on a sphere" is a vector field
   with a genuine mathematical singularity exactly at that point — the
   hairy-ball problem. Bearing rotates arbitrarily fast in the immediate
   neighbourhood of the origin, and the directional-spread test, though
   correct everywhere else, cut a visible pie-slice there. Fixed by
   blending the spread test toward fully omnidirectional within ~15° of
   each source's own origin — physically reasonable too: a storm's
   generation area isn't strongly directional yet, only the swell radiating
   away from it organizes into one. Verified by direct reasoning about the
   geometry, then confirmed gone in fresh screenshots at multiple angles.

2. **The much bigger one: the timeline scrub did not visibly change the
   field at all**, discovered only because this round insisted on a
   specific, falsifiable check (screenshot at "Now" and "3 Days", diff the
   pixels) rather than eyeballing two renders. The diff came back as
   **exactly zero** differing ocean pixels — not "subtle," zero — even
   though the JS-side computation (`angularFrontDistanceRad`, the
   `frontArray`/`energyArray` `useMemo`s) was independently verified
   correct at every single step: console-logged values changed correctly
   with `offsetHours`, the assignment to the uniforms object's `.value`
   was confirmed immediately afterward to hold the new numbers. Every
   signal available from *inside the React code* said this was working.

   **The actual cause**, found only by reaching into the running page and
   comparing object identity directly (`materialRef.current.uniforms
   .uSourceFront === surfaceUniforms.uSourceFront` → `false`): React Three
   Fiber's `<shaderMaterial uniforms={x}>` clones the uniforms object once,
   when the prop is first applied — it does not keep `material.uniforms`
   as a live reference to the object passed in. Every uniform update in
   this file, since round 2 introduced this shader, mutated the original
   JS object's `.value` property, which is a copy the renderer never reads
   again after mount. Confirmed directly and unambiguously:
   `materialRef.current.uniforms.uTime.value` read `0` on a running page,
   and still read `0` three seconds later. **The ocean shader has never
   actually animated over time in this project's history.** Every
   screenshot across every one of the previous eight rounds happened to
   look like a plausible static frame of a complex noise field — nobody
   noticed because a frozen intricate pattern still looks like "a
   swirling ocean" in any single image, and no round's verification ever
   compared the same fixed camera angle at two different timestamps.

   Fixed by mutating the material's own uniforms through a `ref`
   (`materialRef.current.uniforms.X.value = ...`) instead of the
   `surfaceUniforms` object, which is now correctly understood as existing
   only to set *initial* values via the JSX prop.

   **Worth recording honestly: the first fix attempt was wrong**, in an
   instructive way. The symptom ("timeline scrub doesn't change the field")
   looked exactly like a stale-closure bug — `useFrame`'s callback
   capturing an old `frontArray` and never picking up a fresh one — and a
   debug log seemed to confirm it (the value logged inside `useFrame` was
   stuck at hour-0's numbers). Switching that specific update from
   `useFrame` to a `useEffect` with explicit dependencies was a real,
   worthwhile improvement in its own right (it's the more correct trigger
   regardless), and is kept. But re-testing after shipping it found the
   field *still* wasn't responding — the stale-closure theory explained the
   symptom plausibly but was not the actual cause. Only the
   object-identity check found the real one. The lesson: when a value you
   just set doesn't seem to take effect, verify by reading it back from the
   actual consumer (the material three.js is drawing with), not from the
   variable you set it on — the two can silently be different objects.

**Verified post-fix, not assumed:** with the camera held fixed
(`prefers-reduced-motion`, autorotate off), 27% of ocean pixels differ
across a fixed 5-second window purely from `uTime`-driven animation, where
before the fix 0% did. Between "Now" and "3 Days" on the timeline, 20% of
ocean pixels (everything outside the marker/path/timeline UI regions)
differ, where before the fix — checked with the *same* diff methodology,
generous wait times up to 12 seconds to rule out this sandbox's documented
slow-rendering as a confound — 0% did. `smoke-test.mjs` (both viewports),
`panel-glass-test.mjs`, and `rotate-test.mjs` all still pass with zero
console errors.

**Not fully polished, said plainly:** where several sources' directional
fans overlap at "3 Days"' larger front sizes, the result reads as a fairly
graphic, crisp "spoke" pattern rather than the soft feathered look rounds
7–8 tuned for elsewhere on the globe — smooth (no hard edges, no NaN
artifacts, the singularity fix holds), but more diagrammatic than
photographic. It's a legible answer to "where can this swell go," which
was the actual ask, but softening the fan-edge transition further is a
reasonable target for a future round if the user wants it less graphic.
**Addressed in round 10** — see below.

### Round 10: lateral inhibition, pole-zone spirals, and a strength-coded colour ramp

Round 9's own closing note flagged it: where several sources' fans
overlapped, the result read as a "graphic, crisp spoke pattern" rather than
a soft transition. The user saw it live and named the mechanism themselves
— "sometimes I think we'll need to step down a bit on reality... use some
smart kinda 'lateral inhibition' where strongest swell inhibits smaller
ones" — and asked for two more things in the same message: each swell
source should read as a legible directional cone (not just a texture
variation), and colour should encode strength, deep purple for the
strongest swell down to light blue for the weakest.

**The seam mechanism, confirmed by reading the code before changing
anything:** `flowAccum += away * w` was a plain linear vector sum across
sources. Where two sources have comparable weight but different `away`
directions, `f = normalize(flowAccum)` depends sensitively on their exact
weight ratio, sweeping through a range of directions over a narrow spatial
band as dominance flips from one source to the other. That band feeds
straight into the anisotropic noise stretch, and noise is chaotic with
respect to its sampling direction — a smooth rotation of `f` renders as a
visible seam. Fixed with the user's own proposed mechanism: sharpen the
weight used for *direction* only (`wDir = pow(w, 3.0)`), so the locally-
strongest source dominates instead of being averaged with weaker
neighbours, while energy stays a true sum (overlapping swells genuinely do
carry more combined brightness, and that part already read fine).

**Sharpening surfaced two latent bugs that testing at a single default
camera angle had never exposed**, both found by rotating to a different
orientation and looking again rather than trusting the first screenshot:

1. A pinwheel/starburst artifact at each source's own origin. `away` (the
   outward tangent fed into `flowAccum`) has the exact same hairy-ball
   singularity `toP` did in round 9 — bearing sweeps through its full range
   over a tiny distance near the origin. Round 9's `poleFade` fix only ever
   blended `spread` (the cone-test magnitude), never this direction, so it
   was already a latent bug; sharpening concentrated weight most heavily
   exactly at `d=0` (where `falloff` peaks), turning it into a visible
   artifact. Fixed the same way as `spread`: blend `away` toward the stable
   source direction `D` within the same pole-fade radius.
2. That fix removed the point singularity but left a softer spiral/vortex
   ring in the transition band around it, found by rotating the camera to
   bring a source's own origin into frame (the default angle only ever
   showed inter-source seams, never a source's own centre up close).
   `away`'s bearing-dependence doesn't respect where `poleFade` is in its
   ramp, so the blended direction still visibly twists across roughly
   `d ∈ (0, 0.26)`. Rather than chase the twist itself, an energy-weighted
   "pole confidence" (how much of the locally dominant weight comes from
   inside some source's own pole-fade zone) now suppresses the anisotropic
   stretch ratio *and* the domain-warp's `f`-dependent drift/evolve terms
   in that zone — domain warping amplifies small input changes by design,
   so `f`'s residual rotation there alone was enough to redraw the spiral
   even after the stretch ratio itself was correctly faded to isotropic.
   The near-origin zone now renders as a soft, non-directional cloud
   instead of a stretched pinwheel — consistent with `spread`'s own
   original physical framing (a storm's generation area isn't organised
   into a direction yet).

**Colour scheme:** replaced the old teal patches (`tealPatch`, a regional
tint driven by arbitrary positional noise, `snoise(vPos * 1.35 + 17.0)`,
unrelated to any actual swell data) with a ramp driven by `fieldEnergy01` —
already exactly the right per-fragment signal, zero outside every source's
footprint, rising toward each source's own weight inside it — from
`uSwellWeak` (light blue) to `uSwellStrong` (purple). This turned out to
answer the "legible cone" ask for free: the cone *shape* already existed
geometrically (`spread × arrived`), it just rendered in nearly the same
blue as the calm water around it: colour makes the existing shape visible
rather than adding a second mechanism to draw one.

**One real bug in the first version of the colour ramp, found by testing
rather than assumed correct:** the first `uSwellStrong` picked, `#5b2a8c`,
never showed as purple anywhere on the globe — every sample, even at
`fieldEnergy01 ≈ 0.9`, came back a plain blue. Isolated with a sequence of
throwaway debug renders (`color = fieldEnergy01` as grayscale to confirm
the energy signal itself was fine; `color = midColor`; `color = uSwellStrong`
raw) rather than re-tuning blindly: `#5b2a8c`'s linear-space luminance is
very low (~0.06 after `THREE.Color`'s automatic sRGB→linear conversion,
confirmed directly in Node), and this pipeline's ACES filmic tonemap —
combined with the lighting/scatter multipliers already in the shader —
crushes dark, saturated inputs like that toward a desaturated navy almost
indistinguishable from the surrounding water. A brighter, more saturated
violet (`#a855f7`) survives the same pipeline intact (confirmed: raw render
of just that uniform shows clearly as purple at a known-ocean pixel).
Lesson for picking any future shader colour constant here: check it through
the actual render pipeline, not just as a hex value — this stack's
tonemapping is not colour-preserving at low luminance.

Also tuned once the colour survived: the crest/foam highlight
(`uOceanBright`, a flat near-white) was painting straight over the
strongest part of every swell's core — exactly where the purple should be
most visible, since a swell's crest and its most energetic point are the
same place. Tinted the crest highlight itself toward `swellColor`
(`fieldEnergy01 * 0.6`) so strong-swell foam carries a violet-white cast
instead of erasing the colour signal; the ordinary mid-tone blend also now
scales its own penetration weight up with energy (`0.60 → 0.88`) so a
strong swell's core reads as dominantly purple rather than a thin tinted
veil.

**Verified:** `npm run build` and `npm run lint` clean. `smoke-test.mjs`
(both viewports), `panel-glass-test.mjs`, and `rotate-test.mjs` all pass
with zero console errors — `rotate-test.mjs` specifically is what surfaced
both pole-zone bugs above, since the default camera angle used for `shot.mjs`
never brought a source's own origin close enough into frame to show them.
Visual: fresh screenshots at the default angle and both `rotate-test.mjs`
angles show smooth gradient transitions where multiple sources' fans meet
(no hard dividing lines), each active source reading as a distinct
purple-cored, blue-edged wedge fanning out from its origin, and no
pinwheel/spiral artifacts at any source's own centre across three tested
camera orientations.

### Round 11: restyling Helena's path/marker off the hard white line and dot

The user's reaction to round 10's screenshots was specific: "I don't like
the white line. And circle... the whole visualization has to be fluid
enough for user to understand the projected path and current position
without the ugly line." Helena's own path (`HelenaPath.tsx`) had never been
touched by rounds 7–10's work on the ocean shader itself — it was still an
opaque white `Line` (cobalt-to-white gradient, `lineWidth={1.1}`, normal
blending) with a flat, opaque, unlit sphere as the current-position marker,
predating the round-9/10 swell-strength colour language entirely. It read
exactly as the user described: a line-chart overlay dropped onto the
painting, not part of it — while every other piece of "where is the swell
and how strong" information had, by round 10, moved onto soft gradients and
a shared colour ramp.

**Restyled onto the same language, not removed** — the user still wants to
be able to read the projected path and current position, just not via a
hard line: new shared `swellPalette.ts` (`SWELL_WEAK`/`SWELL_STRONG`,
`#8fd6f0`/`#a855f7`) exports the exact colours `GlobeSphere.tsx`'s
`uSwellWeak`/`uSwellStrong` uniforms already use, imported by both files so
the two can't drift apart. Helena's trail now interpolates along this same
ramp by each waypoint's own energy (previously an unrelated cobalt-to-white
gradient keyed the same way but meaning nothing shared with the rest of the
scene) — the trail now reads as one more swell in the same system, not a
separately-coloured chart line. The marker's opaque sphere (a flat white
circle with a hard silhouette regardless of viewing angle) is replaced with
a camera-facing (`<Billboard>`) soft radial-glow plane, a small hand-written
shader (`GLOW_FRAGMENT`) blending a tight core and a wide soft halo to zero
alpha at the edge — a light source, not a drawn dot — coloured by the
current point's own energy on the same ramp. The trail itself also now
fades in/out over the first ~8% and last ~14% of its length (scaling vertex
colour toward black) instead of stopping abruptly at two hard line-caps,
and renders as two passes sharing the same points — a wide, low-opacity
halo underneath a thin bright core — for a brushstroke feel rather than a
single uniform stroke width.

**One real bug found in testing, not assumed away:** the first version
used `AdditiveBlending` on the trail (matching the ocean shader's own
glow-heavy aesthetic), which produced a small blown-out flare exactly at
the path's tip in every screenshot. Root cause: where the 3D curve bends
toward or away from the camera, many of its sampled points project into a
handful of screen pixels, and additive blending sums their brightness
rather than capping it — dozens of overlapping near-transparent segments
in the same pixels add up to a bright flare regardless of how dim any one
of them is. Confirmed by cropping and inspecting the exact pixels (not
just eyeballing "looks better/worse"): the flare tracked the tip precisely
across rebuilds and disappeared entirely when blending was switched back
to normal alpha compositing, which caps a pixel at the vertex colour
itself instead of summing overlapping draws. Kept `AdditiveBlending` only
on the marker's own glow billboard, which is a single small plane, not
120+ overlapping line segments, so the same failure mode doesn't apply
there.

**Verified:** `npm run build` and `npm run lint` clean. `smoke-test.mjs`
(both viewports — the marker's invisible hit-target mesh and `?e2e=1`
screen-position hook are unchanged, so tap-to-open-panel and the timeline
moving the marker both still pass), `panel-glass-test.mjs`, and
`rotate-test.mjs` all pass with zero console errors. Visual: fresh
screenshots at the default angle, both `rotate-test.mjs` angles, and the
open-panel view all show a soft glowing gradient stroke fading into the
water at both ends, a diffuse marker glow with no hard edge, and no flare
at the path's tip.

### Round 12: a bidirectional timeline, sources that spawn in, and a trailing wake

The user's own framing, after seeing round 11: "the ocean should be
moving - showing some past periods as well as prediction." Brainstormed
two complementary directions with them before building anything — a
manual scrubber that reaches into real history, versus baking recency
into the field's own rendering so a single static frame reads as alive
without requiring interaction — and built both, since they answer
different needs (one lets a user deliberately go dig into history, the
other is what makes the *default* view feel like something in motion).

**The scrubber already went both ways; nothing on screen said so.**
`Timeline`'s drag range has always been `HELENA_MIN_OFFSET_HOURS` (−18) to
`HELENA_MAX_OFFSET_HOURS` (96) — the full span of Helena's own hardcoded
path data — but every labelled stop sat at "Now" or later ("Now",
"Tomorrow", "3 Days"). A user could already drag left of "Now" into real
history; nothing hinted they could. Added a labelled stop at the range's
actual past extreme, tied to the real constant
(`` `-${Math.abs(HELENA_MIN_OFFSET_HOURS)}h` ``) so it can't drift out of
range if Helena's path data ever changes. First attempt used the fuller
label "18h Ago", which visibly collided with "Now"'s label — only 18 of
the track's 114 total hours separate them, not enough room for two
multi-word labels that close together. Shortened to "-18h" and confirmed
in a fresh screenshot that the collision was gone.

**Sources now fade in at their own spawn moment instead of always showing
something.** `angularFrontDistanceRad` already clamped a source's front to
a 0 radius before its `spawnOffsetHours` (so scrubbing before a source
existed was already safe, not broken) — but its *energy* was never gated
the same way, and the shader's own `arrived` test (`smoothstep` around a
front of exactly 0) evaluates to 0.5 exactly at a source's origin
regardless, so every source rendered as a small fixed dot at its origin
even scrubbed to well before it had actually started generating. New
`spawnRamp01(spawnOffsetHours, forecastHours)` in `swellSources.ts` fades
a source's energy in linearly over its first 4 hours, multiplied into the
same `energyArray` the shader already reads — scrubbing to before a
source's spawn time now shows genuinely nothing there, not a residual
mark.

**Each swell now reads as a wake, not a flat plateau.** Previously
`arrived` was a flat 1 for the entire region a front had already passed,
falling to 0 only right at the leading edge — physically defensible (these
are ongoing storms, still generating, not a single pulse) but meant a
single static frame carried no cue that water near a source's origin is
*older* than water at its growing edge; nothing looked like it was
mid-motion without actually scrubbing the timeline. Split into
`leadingEdge` (the original crisp cutoff — kept exactly as-is, since "the
swell hasn't reached here yet" is real information that should stay sharp)
and a new `trailFade`, which dims the long-passed part of the wake back
toward the origin (floor at 30%, never fully gone — it's still there,
just older), ramping to full brightness by roughly 75% of the way out to
the front. Purely a legibility device, same spirit as round 11's fade on
Helena's own path, not a change to the underlying physics. Verified by
hand-tracing the formula (`trailFade` is 0 exactly at the origin, 1 by
75% of the front's radius, independent of the separate distance-`falloff`
term that dims for an unrelated geometric-spreading reason) rather than
trusting a screenshot — a first attempt at reading this back from a
rendered pixel sample was contaminated by the current-position marker's
own glow sitting at the sample point, a reminder that visual sampling
needs a sample point actually clear of other rendered elements.

**Verified:** `npm run build` and `npm run lint` clean. `smoke-test.mjs`
(both viewports), `panel-glass-test.mjs`, and `rotate-test.mjs` all pass
with zero console errors. Visual: screenshots at "-18h", "Now", "Tomorrow"
and "3 Days" show clear, monotonic growth of every source's front across
the full range, the new stop's label legible with no collision, and a
mostly-calm ocean at "-18h" where only the earliest-spawning invented
sources have anything to show yet.

### Round 17: closing the filament question, and a guard that points the other way

**Status: landed. No pixels changed — verified by the full harness, every gate
within run-to-run animation variance of its round-15 value.**

#### What prompted it

Round 16 was reverted for looking wrong, which left the project in an awkward
place: a known bug live in the shader, a comment above it asserting the
opposite, and the two gates that would have caught it thrown away with the
revert. The open-items list carried "fix the anisotropy no-op" as priority 2
with a note that it was "*not* optional if filaments are wanted."

Nobody had actually checked whether filaments were still wanted. Round 16's
frame had been seen alone, judged "ugly", and reverted — it had never been put
next to the alternative.

So it was: both commits built, the same "+3 Days" frame rendered from each at
the same viewport and camera, and the same ocean region cropped from both. The
user's answer was immediate — *"well the first/left image is way better"* —
choosing the soft isotropic field over the anisotropic one.

**That converts a bug into a decision.** The measurements either side of the
comparison:

| | current (round 15/17) | round 16 (reverted) |
|---|---|---|
| B2 anisotropy ratio | 1.000 | 11.248 |
| reads as | soft, smoky, directionless | hard, evenly spaced contour lines |
| verdict | **chosen** | rejected on sight, twice |

#### What changed in the code

Nothing that renders. The anisotropy decomposition was already a no-op, so
deleting it is provably behaviour-preserving rather than a re-tune:

```glsl
vec3 along  = dot(vPos, f) * f;   // identically 0 — f is a tangent at vPos
vec3 across = vPos - along;       // therefore exactly vPos
vec3 coord  = along * mix(1.0, alongScale, dirConfidence)
            + across * mix(1.0, 1.75, dirConfidence);
```

collapses to `vPos * mix(1.0, 1.75, dirConfidence)`, measured 2.5e-16 apart.
`alongScale` died with it. Three things deliberately survived: `dirConfidence`,
`flowMag` and `poleConfidence` still gate the flow travel and domain warp
below, and `periodMix` still drives hue — the stretch was only ever one of its
consumers.

The long comment above it was the actual liability and is now replaced by one
that says what the code does, with the history that explains why the previous
comment said something else for six rounds.

#### The guard, pointed the other way

`B2` came back, inverted. Round 16's version asserted the sampling *is*
anisotropic; as a permanent gate that would demand a look the user has now
rejected twice. So it asserts the opposite: equal arc-length steps taken
radially and tangentially from a point must map to equal separations in noise
space, ratio 1.0 ± 0.02. Measured 1.0001.

This is not "anisotropy is banned." It is "a stretch cannot appear here without
someone deciding to" — the review moment that was missing when round 9 removed
one by accident. Reintroducing a stretch means updating this threshold in the
same commit, which is exactly the conversation that should happen.

**One thing was fixed on the way in.** Round 16's B2 was a JS reimplementation
of the frame function, commented "Mirrors moanaSourceFrame() in
swellField.ts" — the same two-places-holding-one-fact shape that let the
original bug survive, and a probe that would happily pass against a shader that
had drifted from its copy. The transform now lives in the shared
`SWELL_FIELD_GLSL` as `moanaNoiseCoord()`, and B2 compiles and measures **that
function**, the one the ocean shader calls. There is no second copy to drift.

#### The lesson, which is round 16's lesson inverted

Round 16's stated mistake was treating "filaments are measurable" as the goal
when the goal was "filaments look like weather." The follow-on mistake, nearly
made here, was treating "the bug is real" as sufficient reason to fix it. It
was real, it was fixed correctly, and fixing it made the product worse.

**A correct diagnosis does not entitle you to the repair.** What settled it was
not more analysis but the cheapest possible experiment: build both, render the
same frame, put them side by side, ask. That took about fifteen minutes against
six rounds of the question staying open.


#### The middle ground was tested, and there isn't one

Before treating the decision as final, the obvious question was asked: round 16
pushed contrast hard to satisfy a threshold, so would a much weaker version read
as texture rather than contour lines? Two attempts, both rendered at the same
frame, viewport and camera as the comparison above.

**Attempt 1 — round 16 with the levers pulled back.** `FILAMENTS_PER_BAND`
3.2 → 2.2, the band ramp widened from `smoothstep(-0.16, 0.30)` back toward the
shipped `(-0.35, 0.52)`, the crest highlight given a later onset and steeper
power so it lights far fewer edges, and per-filament brightness variation added
(low-frequency across the fine axis, slow along the long one) so striations
stop rendering at identical intensity. That is round 16's own "what a future
attempt must do differently" brief, implemented. Result: better than round 16,
still reads as banding. It sat much closer to the rejected frame than to the
shipped one.

**Attempt 2 — a different structure, not a knob turn.** The swell's *envelope*
sampled isotropically (identical to what ships) with the anisotropic sample
mixed in at `0.20 * dirConfidence`, so the grain modulates brightness *inside* a
band instead of drawing new ones. That did remove the contours. It also made
the directional texture essentially invisible, and let round 16's
dominant-frame-tie faceting through as hard straight seams — at a low mix
weight there is not enough weight left to fade the tie out.

**The finding, which is why this is closed rather than deferred:** the
striations come from the same threshold that produces the bands. Push them hard
enough to see and they cross that threshold and become bands of their own —
contour lines. Damp them below it and they stop being visible at all. There is
no setting in between. Round 16's brief assumed the problem was restraint; it is
structural.

Real filaments would need the texture to live somewhere other than the band
ramp's input — a rewrite of the ocean's colour chain, not a round of tuning. On
the evidence, not worth it. Shown all three frames, the user's verdict was
unchanged: *"current no filaments is best."*

Neither experiment was committed. Both are reproducible from `1856985` plus the
edits described above.

### Round 16: the anisotropy no-op — found, fixed, reverted for looking wrong

**Status: built, shown to the user, and reverted at their request ("ok, this is
ugly .. revert it back before this itteration"). Superseded by round 17, which
closed the question this entry left open: shown both renders side by side the
user chose the soft isotropic field, so the sampling is now isotropic *by
decision* and the dead code and its misleading comment are gone.** Retrieve the
anisotropic implementation with `git show 1856985` (the revert is `1159d0f`).

The entry below is kept because its diagnosis is still correct and still the
best explanation of why the ocean has no filament structure. What has changed
is the conclusion: this is no longer a bug awaiting a fix, and the "what a
future attempt must do differently" list at the end is now a brief for a
direction nobody is currently taking. Read round 17 first.

#### What prompted it

After round 15 the user said: *"I still don't really see the filament ribbon
structures you described so nice before?? Tell me why before you start doing
anything."*

They were right, and the reason was not tuning. It was a latent bug.

#### The finding — the shader's anisotropy does nothing

`GlobeSphere.tsx` decomposed the noise sample position along the flow tangent:

```glsl
vec3 along  = dot(vPos, f) * f;
vec3 across = vPos - along;
vec3 coord  = along * mix(1.0, alongScale, dirConfidence)
            + across * mix(1.0, 1.75, dirConfidence);
```

`f` comes from `moanaFlow()` and is a **tangent at `vPos`**. A tangent vector on
a unit sphere is perpendicular to the position vector by construction, so
`dot(vPos, f)` is identically zero. Measured: **1.665e-16**. Therefore `along`
is the zero vector, `across` is exactly `vPos`, and the whole expression
reduces to a uniform scale — `|coord − vPos·B| = 2.5e-16`. **Isotropic.**

The comment that sat directly above it read: *"The single most important line in
this shader… Sampling isotropically can only ever produce curly, equal-sided
blobs — no colour-ramp or threshold tuning turns those into streaks."* That
comment is correct. The line beneath it had been doing exactly the thing it
warned against.

**It broke in round 9.** Before then `f` was a single global flow direction
applied planet-wide — a fixed world-space vector, *not* tangent everywhere, so
`dot(vPos, f)` was non-zero and the decomposition genuinely worked. Round 9
replaced it with the per-fragment `away` tangent, which is tangent everywhere,
and silently zeroed `along`. **Rounds 9 through 15 all rendered isotropic noise
while every comment in the file said "streaks".** It also explains why round 10
needed lateral inhibition for seams: the seams were real, but the stretch
supposedly amplifying them was not there.

#### Why it cannot be repaired in place

`vPos` is the surface *normal*, so it has no component in the tangent plane.
Any linear map built from tangent axes leaves it untouched:
`outerProduct(t, t) * vPos = t * dot(t, vPos) = 0` for every tangent `t`. There
is no matrix-on-position fix. **The sampling space itself has to change.**

#### What was built (and reverted)

Sample the noise in the dominant source's own polar frame — distance out from
the storm, and arc length around it. A radially propagating wave field supplies
that coordinate system for free, it is well-defined everywhere, and filament
orientation becomes a single swap between its two axes.

```glsl
vec2 moanaSourceFrame(vec3 S, vec3 D, vec3 P, float d) {
  vec3 E = normalize(cross(S, D));
  vec3 raw = P - S * dot(S, P);
  vec3 toP = length(raw) > 1e-4 ? normalize(raw) : D;
  float bearing = atan(dot(toP, E), dot(toP, D));
  return vec2(d, bearing * sin(d));   // radial arc, tangential arc
}
```

The `sin(d)` converts bearing into true arc length, so filament *width* stays
constant as a packet travels instead of fanning out. Two singularities handle
themselves: the bearing seam at ±π sits behind the storm where the directional
cone has already cut the field to zero, and as `d → 0` the `sin(d)` collapses
the coordinate smoothly rather than spinning.

**Three coupled defects found on the way, each independently fatal:**

1. **`dirConfidence` collapsed cubically.** It was derived from
   `length(flowAccum)` where `flowAccum += away * pow(w, 3.0)` — round 10's
   lateral inhibition, which exists to sharpen which source wins the
   *direction*. Reusing that cubed magnitude as a *confidence* meant `w = 0.3`
   in a packet body gave `0.027 × 6 = 0.16`, so anisotropy would have applied
   only at the brightest peaks even after the projection was fixed. Fixed by
   deriving it from the un-cubed dominant weight.
2. **Hard polygonal faceting.** Where two sources tie, the dominant polar frame
   flips between two entirely different coordinate systems and the noise jumps
   with it. Unlike a direction vector, two polar frames cannot be blended into a
   meaningful third — so the fix is to fade to isotropic across the tie
   (`smoothstep(0.55, 0.85, bestWeight / energyAccum)`).
3. **One band ramp fed both the ambient ocean and the swell.** Narrowing it so
   striations cross threshold crisply also turned the entire calm ocean into
   high-contrast contour lines. Split into `ambient` (wide, soft) and `band`
   (narrow, crisp, energy-gated).

Filament frequency was also made proportional to band width, so filament
**count** across a band stays constant. A fixed value cannot serve both a
0.12 rad young packet and a 0.35 rad mature one: 6.5 gave a wavelength wider
than a young band (under one filament across it), and 14 turned the +3 Days
frame into contour spaghetti. Both failure modes were observed directly.

#### The two gates it added — gone with the revert

Nothing in the harness could see this bug, because every metric measured the
packet *envelope* (M1/M4/M1p/M4p), its *range* (M2/M8), its *hue* (M3), its
*motion* (M5) or its *coverage* (M9). **None measured whether the texture inside
a packet has a direction at all.** That is precisely why a no-op survived six
rounds of "the filaments look good".

- **B2 (parity probe):** steps the same arc length radially and tangentially
  from a point and asserts the two map to measurably different separations in
  noise space. Under the reverted-to code that ratio is exactly 1.0. Sub-second,
  no rendering. This is the cheapest possible guard against the whole bug class.
- **M11 (pixel metrics):** luminance variance across the band vs along it,
  median over 10 track pairs. Scored 2.74x with filaments visible; ~1.0 means
  isotropic.

Both had to be reverted with the rest: they would fail against the restored
code — correctly — and a permanently-red gate is worse than none. **If you
reattempt this, bring B2 back first.** It costs nothing and it is the check
that would have caught this in round 9.

#### Why it was reverted

The mechanism worked and was measurable, but the result read as **topographic
contour lines** — regular, hard-edged, evenly spaced. Legible as filaments,
nothing like the reference's soft organic ribbons. The user's verdict was
"ugly", and they were right.

The mistake was mine and it is worth naming precisely: **I treated "filaments
are measurable" as the goal when the goal was "filaments look like weather."**
M11 went green while the frame got worse. A gate proving a mechanism reaches the
screen says nothing about whether it should.

#### What a future attempt must do differently

- **Go far subtler.** The reverted version pushed contrast and frequency hard to
  satisfy a threshold. Filaments should be a *texture* you notice on second
  look, not the dominant feature of every band.
- **Vary brightness between filaments.** Every striation rendered at the same
  intensity, which is most of why it read as contour lines rather than water.
  Real filaments differ from one another.
- **Leave the domain warp alone.** It was cut from 0.34 to 0.06 mid-round on
  evidence that later proved invalid (see the metric lessons below), and at 0.06
  the filaments were ruler-straight. The warp is what makes them wander.
- **Check the `crest` term.** It stacks a hard highlight on every band edge and
  compounds the contour-line reading.
- **Do not chase M11's number.** Set it low enough to catch the no-op (~1.6) and
  judge the look by eye.

**This list has since been tried, and it does not work** — see "The middle
ground was tested, and there isn't one" in the round-17 entry above. Implemented
faithfully (subtler contrast, per-filament brightness variation, warp left
alone, crest weakened) the result still read as banding. The limitation is
structural, not a matter of restraint. Treat the list as history, not as a
brief.

#### Two metric lessons, both hard-won

1. **Correlation length was the wrong statistic.** It reported 1.47x on a frame
   whose radial-vs-tangential *variance* differed 5.49x, because fBm's high
   octaves decay autocorrelation in **both** directions and compress the ratio
   toward 1 regardless of how anisotropic the field is. Variance answers the
   question directly and is robust to spectral content.
2. **A single sample track is not reproducible on an animating field.** The same
   probe swung **5.49x → 1.94x between two runs with no code change**, because
   `uTime` moved the noise underneath it. This is round 13's lesson resurfacing
   in a new place: never characterise an animating field from one fixed sample.
   M11 ended up taking a median over 10 track pairs spread across bearing and
   depth.

A third, smaller: **M10's first baseline was wrong** in the same family — it
compared land against seven sampled sea points that all happened to land in calm
gaps between bands (18.8 mean, against 39 for water generally), which asks land
to be darker than the darkest thing in frame. It now uses the ocean median over
~590k pixels.

---

### Round 15: land subordination and the glyph, both measured

Two follow-ups the user approved after seeing round 14, plus a correction to
something round 14 asserted without checking.

**"The continents read heavy" was not a darkness problem.** Round 14's
handover said land read too heavy against the reference and guessed it was
too dark. Measured at interior points, land came out at mean luminance
**39.6 against an ocean median of 37** — land and water were sitting at
essentially the *same* brightness. Nothing was pushing land back, so a large
contiguous mass of static speckled terrain competed on equal terms with the
moving water around it and read as a hole punched through the field. The fix
was subordination, not darkening for its own sake: a base below the water's
mid-tone (`#16293f` -> `#0c1727`), a steeper and weaker terrain lift
(`pow(nightLum, 1.8) * 0.62` -> `pow(nightLum, 2.3) * 0.30`) so the speckle
stops rivalling the ocean's filaments texturally, and the coast contour
raised (0.20 -> 0.26) to keep land legible *as* land once the fill recedes.
Land now measures 0.70x the ocean median. **M10** holds it in 0.35..0.90 —
both bounds matter, since round 7 already overshot into black voids from the
other direction.

**The glyph now obeys the globe's grammar rather than borrowing its
colours.** Round 14 made it data-driven but it was a near-straight kinked
polyline with a fixed gradient. Three changes: Catmull-Rom through every
waypoint emitted as cubic beziers (passes through each point exactly — the
track is not smoothed *away*, only drawn without corners); a wide faint pass
under a thin bright one, so it glows rather than being drawn; and the
gradient keyed to **where "now" actually sits along the track** instead of a
fixed 55%. That last one is the substantive one — the glyph is now brightest
exactly at the present, feathers back into the past behind it, and dims ahead
into forecast the swell has not reached. Same sentence the ocean is saying,
at thumbnail scale, and it moves as the scrubber moves.

Progress is measured along the **gradient's own axis** (x), not by arc length
or waypoint index. A `linearGradient` with `x1=0,x2=1` interpolates across the
element's horizontal extent, so stop offsets are fractions of x; measuring any
other way lands the highlight near the dot rather than on it, which at this
scale is the difference between the highlight meaning "here" and meaning
nothing.

**Two harness bugs this surfaced, both in the measurement rather than the
code:**

1. **M7 returned NaN** the moment the glyph was smoothed — its inverter
   parsed only `M`/`L` segments, and a cubic bezier's first four numbers are
   off-curve control points. Now it takes the last coordinate pair of each
   segment, which is the on-curve waypoint.
2. **M10's first baseline was wrong.** It compared land against seven sampled
   sea points, all of which happened to land in calm gaps between swell bands
   — 18.8 mean, against 39 for water generally. Measuring land against the
   *darkest* water on the globe is a much harsher requirement than "land
   should recede behind the water", and it would swing with scrub position
   besides. The comparator is now the ocean median over ~590k pixels.

**Verified:** build and lint clean; Stage A 5/5, Stage B parity 0.000368,
Stage C 9/9, all three Playwright suites pass in both viewports with zero
console errors. M2 improved from its round-14 knife-edge 2.51 to **2.58** —
recessing the land raised the ocean median's contrast against the bands
rather than harming it.

---

### Round 14: dispersive packets, brightness-first colour, and no drawn line

The round that acted on the user's two round-13 complaints by changing the
model instead of the constants. Every number quoted below was measured, not
estimated, and the harness that measured them is now part of the repo.

#### What was wrong, measured before anything was changed

Both complaints were structural, and both were upstream of everything round
13 had been tuning:

**"You kinda just make everything look blue" — the purple was never
rendering.** Replaying the round-10..13 colour chain over the field's actual
values showed the weak→strong ramp only reads violet (green dropping below
red) above roughly 0.6, while `fieldEnergy01` measured mean **0.30**, P99
0.385..0.654 across the scrubber, and an all-time global max of **0.869**
reached on ~0.1% of the globe. The violet half of the ramp was never once
requested on any frame. No amount of downstream compositing work could have
fixed that, which is exactly why round 13's three passes did not.

**"The swell movement, body, entity has to be intuitive" — the brightest part
of a swell was not its leading edge.** Reproducing the old `w(d)` profile on
the CPU: it varied only **~1.5:1 across 70% of a swell's radius**, peaked at
**d ≈ 0.7 × front** (behind the front), and left the storm origin at **57% of
peak**. That is a plateau. A filled disc sector reads as a *region*; nothing
in a still frame said which way anything was going.

#### The reference image, and what was taken from it

The user supplied a reference and asked for thinking "in this range" rather
than a copy. Four things it does that the old build did not:

1. **Ribbons, not wedges.** Long filaments, feathered ends, a bright spine —
   comet-shaped. The structural gap.
2. **Brightness carries the information, hue carries identity.** Near-white
   core → cyan → deep blue tails, with hue barely varying. **Zero purple
   anywhere in the image.**
3. **Direction is legible in a still frame** purely from asymmetry: sharp on
   one side, long feather on the other.
4. **The line moved into the panel.** The small arc glyph beside "HELENA" *is*
   the path at thumbnail scale — the reference answers "where is she, which
   way is she going" without drawing anything on the sphere. That is a direct
   answer to the open question round 13's session left.

#### The five mechanisms

**1. Dispersive packets replace the filled sector.** A storm emits a spectrum,
and its long-period components outrun its short ones, so what it launches is a
*band* that stretches as it travels — which is why groundswell arrives
long-period-first. Each source now has two radii instead of one front:
`rLead` from `Cg(T+2.0)`, `rTrail` from `Cg(T−3.5)`, floored to a minimum
width. Within the band the envelope is `s^1.6` times a sharp outer cutoff, so
it peaks *exactly* at the leading edge and feathers backward — a comet.
Measured band width grows 2.9° at +6h to 26.7° at +96h. Amplitude falls out of
geometry rather than a hand-tuned falloff: stretching and lateral spreading
both dilute a fixed energy, giving 1.00 → 0.10 raw, floored to 1.00 → 0.42.

**2. The colour signal moved to a channel that survives the pipeline.**
Luminance and saturation carry energy and recency; hue only says *which* swell
you are looking at, across a narrow cyan-to-teal range driven by period. This
respects round 13's own finding rather than discarding it — ACES crushes
saturation at both extremes, so nothing now asks hue to carry meaning where
brightness is extreme. `swellPalette.ts` was replaced outright. No purple.

**3. Filament anisotropy scales with period** — roughly 3.9:1 for a 13 s
wind-swell up to 8:1 for a 17 s groundswell, so the two identity cues (hue and
filament shape) reinforce rather than decorate independently.

**4. The scrub drags the water.** `uTime` and `offsetHours` used to be
independent clocks, so scrubbing moved the packet edges while the texture
underneath sat still — the ocean re-drew rather than responding. The noise
phase now advects with the scrub as well, at 0.004 rad/hour, deliberately well
under the ~0.0141 a 16 s group velocity implies (wave *energy* travels at Cg;
the water surface does not). `useDampedValue` gives the scrubber
critically-damped inertia so a flick does not teleport the field.

**5. Identity without a line.** `HelenaPath.tsx` is **deleted** — both `Line`
passes, the glow billboard, and the invisible hit-sphere. Selection raycasts
the globe, unprojects to a unit vector, and takes an argmax of the field's own
per-source weight, so you select the swell you can actually see. The panel's
arc glyph, previously the hardcoded decorative curve `M2 68 Q 96 2 191 33`, is
now projected from `pulse.path` with the dot at the interpolated current
position. Selection also drives a **focus pull** — the selected swell lifts,
the others recede — measured at bright-pixel fraction 3.70% → 2.91%.

#### One fact, one place

Hit-testing needs the same weight function the shader renders, so the math
genuinely has to exist in two languages this round. That is this project's
most expensive recurring bug shape (round 9's uniforms-cloning bug; the
hand-written heading that contradicted its own waypoints; the 'WNW' label on an
ENE path). `src/data/swellField.ts` is the single source of truth: TypeScript
for the CPU, a `SWELL_FIELD_GLSL` string for the shader, written as
line-by-line transliterations — and `parity-probe.mjs` asserts they agree
rather than trusting that they do. Worst measured divergence: **0.000368**,
against a 0.02 tolerance.

#### Two data bugs the round exposed

Both were latent, both were hidden by the old plateau, and both would have
become visible contradictions the moment the leading edge became the hero.

**Helena travelled at the wrong speed.** Her hardcoded path covers 3594 km in
114 h — about 32 km/h — while her stated ~14.8 s mean period implies a group
velocity of ~83 km/h. A **2.6× disagreement**, 9× on her final legs. With the
front now the brightest feature *and* the panel glyph driven off the same
waypoints, a `Cg`-propagated front would have raced visibly ahead of where the
glyph says she is. Fixed by deriving her front from her own path; the invented
storms keep `Cg`, because for them `Cg` *is* the data.

**Helena rendered at her weakest moment, permanently.** Her `SwellSource` took
height and period from `pulse.path[0]` — 2.6 m / 13.5 s, her *first and
weakest* waypoint — and never updated, while her data is a full time series
peaking at 4.6 m / 16.7 s. Measured at the opening frame she came out at
amplitude **0.194, the dimmest source on the globe**, against Kaimana's 0.637.
The swell the entire panel is about was the hardest one to see. Her amplitude
and period now come from the interpolated waypoint. Direction deliberately does
not: a packet's heading is set when the storm generates it.

#### What the self-checking harness caught

The loop was built to stop round 13 repeating — tuning constants against
screenshots with nothing able to say the effort was misdirected. It earned its
keep five times, and four of the five were caught in the CPU stage in seconds
rather than the ~60 s a screenshot costs in this sandbox:

1. **A fixed `FRONT_FEATHER` inverted the comet on young packets.** Band width
   grows ~10× over the scrubber, so any absolute feather is a small fraction of
   a mature band and a large fraction of a young one — at +12h it made the
   leading edge *softer* than the trailing feather, pointing the direction cue
   backwards. Feather is now a fraction of width, making the asymmetry
   scale-invariant.
2. **`FIELD_GAIN` — round 13's exact failure, caught before it shipped.** The
   raw field's P99 measured 0.385..0.654, so a 0..1 colour ramp built on it
   would once again never have reached its top. M8 now fails if the range ever
   collapses again.
3. **One pole-fade constant had to become two.** The old single 0.26 rad blend
   zone was tuned against filled sectors whose fronts reached 0.5..1.5 rad. A
   young *packet* sits entirely inside 0.26 rad — Helena's is at 0.085..0.135
   at "Now" — so the directional cone blended to fully omnidirectional and she
   rendered as a ring. First render of the round was hard-edged bubbles.
4. **Rotating the globe silently cleared the selection.** Now that the whole
   globe is the tap target, R3F fired `onClick` at the end of every drag.
   Caught by `panel-glass-test.mjs`, which rotates with the panel open and
   photographs the result: it reported the panel opening, and the screenshot
   showed no panel. Fixed with a drag-vs-tap distance threshold.
5. **M9 did not exist until the +3 Days frame needed it.** Mature packets
   merged into one pale mint wash covering most of the hemisphere. Peak
   brightness (M8) says nothing about how much *area* is lit, and the
   reference's whole character is selective ribbons over genuinely dark water.

One measurement was itself wrong and was fixed rather than worked around:
M1p first failed at 0.79 × rLead because it argmax'd a single noisy scanline
through a deliberately jittered edge. Averaging across a fan of tracks was the
honest fix. M8b was likewise re-expressed as a fraction of the *globe* after
failing at -18h on a 7.28% ratio that turned out to be 17 pixels.

#### Verified, honestly

`npm run build` and `npm run lint` clean. All three pre-existing Playwright
suites pass in both viewports, zero console errors. Gate results at the state
being handed over:

| Gate | Measured | Threshold |
|---|---|---|
| M1 leading-edge dominance (model) | 0.03% of band width | ≤ 15% |
| M4 still-frame asymmetry (model) | 4.68× | ≥ 3.0× |
| M8 dynamic range | P99 ≥ 0.831 | ≥ 0.65 |
| M8b not broadly clipped | 0.868% of globe | ≤ 1.5% |
| M9 bands not a wash | 14.8% of globe | ≤ 22% |
| B CPU/GPU parity | 0.000368 | ≤ 0.02 |
| M2 brightness range on screen | **2.51×** | ≥ 2.5× |
| M3 no violet leakage | **0 of 718,550 px** | ≤ 0.1% |
| M1p leading edge brightest on screen | 0.91 × rLead | 1.0 ± 0.18 |
| M4p asymmetry survives pipeline | 3.63× | ≥ 1.25× |
| M5a/M5b scrub advances and redraws | all edges advance; 30.4% of px changed | — |
| M7 glyph matches data | delta (0.00, 0.00)° | ≤ 1.5° |

**Said plainly: M2 passes at 2.51 against a 2.5 threshold — that is a margin
of under one percent, not a comfortable pass.** It is the gate most likely to
flip on any future change to the colour chain, and if it does the answer is
more contrast in the bands, not a lower threshold.

**Not verified by any of this: whether it looks right.** Automated gates
establish that the mechanism reaches the screen and that the failures of
rounds 10–13 cannot silently recur. They cannot settle a subjective visual
question, and round 13 is the second time in this project a change passed
every check and still was not what the user wanted once they saw it.

#### The metrics harness

```bash
cd phase-0-prototype
npm run build && npm run lint
node --import ./ts-resolve-hook.mjs --experimental-strip-types field-metrics.mjs --cpu     # Stage A
npm run preview -- --port 4173 &
node --import ./ts-resolve-hook.mjs --experimental-strip-types parity-probe.mjs            # Stage B
node --import ./ts-resolve-hook.mjs --experimental-strip-types field-metrics.mjs --pixels  # Stage C
node smoke-test.mjs && node panel-glass-test.mjs && node rotate-test.mjs                   # Stage D
node timeline-shots.mjs                                                                    # Stage E
```

`ts-resolve-hook.mjs` lets the harnesses import the app's own TypeScript
directly (the app uses extensionless bundler-style imports; Node requires
extensions), so they measure the code that ships rather than a transcription
of it. No bundler needed — Vite 8 ships rolldown, not esbuild, and adding a
dependency just to run a test would be a poor trade.

**Stage A is where geometry gets tuned.** It runs against the TypeScript model
with no renderer at all, so an iteration costs milliseconds against the ~60 s a
screenshot costs here. Four of the five bugs above were caught there.

#### Sandbox constraints that still apply

Unchanged from round 13 and still load-bearing: this environment renders at
**~1.2 fps** (software WebGL, no GPU, measured directly). OrbitControls damping
needs **~60 s** of wall clock to settle before screenshots are comparable — a
20 s wait catches the camera mid-ease and produces different framing run to
run independent of any code change. `smoke-test.mjs`'s 30 s click timeout is
calibrated for this, not a defect. `detectQualityTier()` is deliberately *not*
keyed on reduced-motion, so test screenshots render the high tier.

#### Open, and deliberately not done

- **The §8 gate has still not run**: five non-surfers timed on a physical
  phone. No agent session can run it.
- **Land treatment was left alone.** The continents read heavier against the
  reference than the ocean does, but that is round 7/8/9 territory and outside
  what this round was asked to change. Worth a look if the user agrees.
- **The panel's arc glyph is honest but plain** — Helena's real track is nearly
  a straight diagonal in lon/lat, so the glyph no longer looks like the
  reference's graceful curve. It now shows the data instead of a decoration,
  which was the point; whether it should be styled further is a design call.

---

### Round 13: making the strength colour actually reach the ocean body (reverted — superseded by round 14 above)

**This round's code was reverted at commit `6161186`** after the user saw
it and disliked the result, and separately changed direction on Helena's
line/marker (see "Status" and "Round 14 planning" at the top of this
file). Kept below as history — the diagnosis is real and the mistakes are
worth not repeating — but `GlobeSphere.tsx` no longer contains any of the
colour/coverage changes this section describes.

The user asked directly: "so swell colour scale is just in the 'line'
depicting swell direction? — that's kinda weird. I'd like it to be somehow
encoded in the actual body of swell in the ocean." Checked the code first:
the light-blue-to-purple ramp (round 10) was genuinely wired into the
ocean shader's `midColor`/`crestColor`, not just the path. But **sampling
actual rendered pixels well away from Helena's line, across a grid inside
a swell's own visible cloud, came back plain blue at every single point** —
confirming the user's read was correct about what actually renders, even
though the code disagreed. This round is a case study in a shader change
that reads correctly on paper failing to reach the screen for three
separate, stacked reasons, found by measuring at every step rather than
re-guessing after each fix.

**Bug 1 — colour only ever entered the ocean's base tone scaled by `band`**
(how much ribbon-noise detail sits at that exact pixel). The large
low-detail areas between ribbons — most of a swell's actual visible
footprint — stayed at flat `uOceanDeep` blue no matter how strong the
swell there was, because nothing ever blended colour in independent of
that noise term. Fixed with a second, band-independent wash
(`mix(uOceanDeep, midColor, fieldEnergy01 * 0.85)`) so the base tone shifts
with strength across a swell's whole footprint, not just wherever the
ribbon noise happens to be bright.

**Bug 2 — the crest highlight's blend anchor was fighting the colour it was
supposed to carry.** Round 10 tinted crests toward `swellColor` but still
blended *toward* `uOceanBright`, a separately-authored near-white
deliberately overexposed (1.55x) so only crests trip bloom. uOceanBright's
own brightness is roughly double swellColor's, so even an 80% blend weight
toward swellColor left a 20% near-white remainder bright enough to pull
red and green channels back toward parity — exactly what erases a colour
signal that depends on them staying apart (blue vs. purple). Fixed at the
root: `crestColor` now scales `swellColor`'s own brightness
(`swellColor * mix(1.0, 1.5, fieldEnergy01)`) instead of blending toward a
different colour entirely, so its hue can no longer drift from the
strength ramp no matter the weight.

**Bug 3, the one that took the longest to pin down — a first fix attempt
for Bug 2 (`mix(1.3, 3.0, fieldEnergy01)`, reasoning that STRONG's own
luminance is much darker than WEAK's and needs more boost to bloom the
same way) overshot into the exact opposite failure mode round 10 hit.**
Isolating the raw `crestColor` on-screen to check it directly showed pure
white everywhere, regardless of the underlying hue — ACES tonemapping
crushes saturation at extreme brightness the same way round 10 found it
crushes saturation in near-darkness. Settled on a much smaller multiplier
range after checking the actual rendered result, not just the formula.

**Worth recording honestly: two debugging methodologies from earlier
rounds turned out to have real failure modes of their own, found here:**

1. **Overriding the whole ocean with a single debug colour to inspect it
   (used successfully in round 10) is invalid once that colour's own
   luminance exceeds the bloom threshold.** Doing so makes every pixel in
   the frame bloom-eligible simultaneously, and Bloom's blur then averages
   brightness across the *entire* ocean rather than the small, localised
   area a real blend would actually occupy — producing a uniform wash that
   has nothing to do with how that colour behaves in the real composited
   scene. Caught by comparing an isolated debug render against the real,
   non-overridden `oceanColor` output rather than trusting the debug image
   alone.
2. **Sampling fixed pixel coordinates across separate screenshots is not
   a fair comparison when the field being measured is continuously
   animating** (round 9's own uTime-driven noise). A formula change that
   appeared to do nothing at a specific coordinate, re-tested run to run,
   turned out to be working correctly — the noise pattern had simply moved
   between screenshots, so the same screen pixel wasn't sampling the same
   part of the field twice. Resolved by scanning whole screenshots for the
   most colour-shifted pixel rather than trusting any single fixed
   coordinate across runs.

Also found and worked around, unrelated to the colour work itself: this
session's sandbox measured **1.2 fps** (95.6s for 120 real animation
frames, directly instrumented via `requestAnimationFrame` timestamps, not
estimated) — software/CPU WebGL rasterisation with no GPU, rendering a
genuinely expensive multi-source fBm shader. At that frame rate,
`OrbitControls`' damping (`dampingFactor: 0.07`) takes far longer in
wall-clock time to settle than on a normal device, and a fixed ~20s
screenshot wait (previously sufficient) was catching the camera mid-ease
into its final framing, producing different-looking screenshots run to
run independent of any code change. A ~60s wait was needed for this
session's tests to be reliably comparable. **This is a property of this
specific sandboxed environment, not the app** — the same shader on any
GPU-accelerated device should render close to 60fps, and this was
confirmed by directly measuring, not assumed.

**Verified, honestly:** `npm run build` and `npm run lint` clean;
`smoke-test.mjs` (both viewports), `panel-glass-test.mjs`, and
`rotate-test.mjs` all still pass with zero console errors despite the
sandbox's current slowness. The fix is confirmed genuinely reaching the
render — scanning whole screenshots (not fixed coordinates) found clearly
purple pixels (e.g. `(191,124,237)`, R clearly above G) inside a swell's
body away from any line, and one of `rotate-test.mjs`'s two angles shows
an unmistakable violet-lavender tint through an entire swell's cloud, not
just its line. **That said, said plainly: the overall visual impression
across most screenshots is still fairly subtle** — much of a swell's
visible footprint still reads closer to blue-white than to a strongly
purple body, particularly where sources overlap or energy is moderate
rather peaking. The mechanism is now demonstrably correct and reaching
the screen; whether it reads as *strongly enough* colour-coded at a glance
is a genuine open question for the user's own eyes, not something this
session's automated checks can settle. A reasonable next lever if it's
still not enough, not yet tried: `crest * 0.38`'s own blend weight (the
near-white-leaning crest highlight still dilutes the more strongly-tinted
mid-tone wash underneath it at high `crest` values) or scoping a
saturation boost to the ocean specifically rather than continuing to tune
the ocean shader's own constants further.

**Addendum, same session, commit `21c53d8`:** the user checked screenshots
after the above and reported still seeing no purple. Verified directly and
agreed — the "genuinely purple pixels exist" claim above was true but
misleading: they were isolated crest peaks in a much larger blue/white
mist. The actual bug, found by cropping in on a real screenshot rather
than re-tuning blind: **the misty ribbon shape's visible extent never
depended on energy at all, only its noise contrast did** — `band`/`crest`
crossed their thresholds fine even at zero swell energy, so genuinely calm
water still showed a visible mist, and the eye reads that whole mist as
"the swell," most of which was never coloured. Fixed by gating
`band`/`crest`'s own coverage on a new `ribbonPresence` term (not just
their contrast), so the visible cloud now shrinks to actually track where
colour is. Also replaced the round-13-first-pass ramps with a shared
`colourRamp` (`smoothstep(0.12, 0.5, fieldEnergy01)`) after a `pow(...,
0.45)` attempt overshot — boosting low-near-zero energy too, broadly
paling and enlarging the cloud rather than concentrating colour — and cut
crest's own blend weight (0.38 → 0.22, the exact lever flagged above as
untried) so it no longer paints over the now-more-saturated mid-tone.
Verified by disabling Bloom entirely and A/B-comparing screenshots:
contrary to this round's first-pass theory (left corrected in the code
comment), Bloom's blur was **not** the dominant cause — the pre-addendum
render looked nearly identical with Bloom on or off; the real dilution was
upstream in the shader's own coverage logic. Post-fix, purple is now
visible as a halo around Helena's line, not just isolated points — see
`phase-0-prototype/README.md`'s own round-13 entry for a fuller account.
Screenshots sent to the user directly; not reproduced here since this
file doesn't carry images.

### Verified, and how (as of round 13, before its revert — HEAD `21c53d8`; current HEAD `6161186` is round 12's code, byte-identical)

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
  attribution text sits in the main view, zero console/page errors.
  **Passing both viewports at HEAD.** The Follow Swell click step timed out
  at its hardcoded 8000ms in three separate sessions (rounds 6, 7, 8) —
  never a real defect: round 6 established that the click succeeds at
  ~10.2s under a longer ceiling and that the timeout reproduced on
  unmodified code. Playwright waits for a rendered frame before a click is
  actionable, and frames are slow here under software WebGL, so 8000ms was
  measuring this environment's frame rate rather than the app. Round 8
  raised it to a named `CLICK_TIMEOUT = 30000`; the suite then passed both
  viewports cleanly for the first time since round 5.
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
should not be declared "passed" until that test happens.

**As of round 12 (2026-08-19 conversation, HEAD `8ad90e9`): the user has
been walked through all of this directly** — what the falsifiable gate is
and why no agent session can run it, how Phase 1+ would work (real
Open-Meteo data, full global grid, a 3-6h-refreshed static JSON bundle —
not a live stream, but "live" relative to how slowly swell actually
moves), and was sent a 16-second screen-recorded video
(`recordVideo`, not committed anywhere — it only exists as a chat
attachment) showing the build actually animating: auto-rotate spinning,
the ocean's own time-based noise running, both disabled in every other
screenshot in this file for determinism. They have **not yet run the
human test** — this session ended on that explanation, not on a pass/fail
result. **Whoever picks this up next: don't re-explain any of the above,
the user already has it. Ask whether the phone test has happened yet.**

If they want to run it themselves rather than through an agent session:
`cd phase-0-prototype && npm install && npm run dev`, load it on a phone
on the same network, run the test as specified. If they want a live,
fully-interactive session (drag it with their own hands, not a recorded
video) rather than more screenshots/recordings from an agent, that also
requires Claude Code running *locally* on their own machine — a remote
"Claude Code on the web" session like this one has no network path to
their browser and can only ever produce screenshots or recorded video, not
a live connection.

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

### 10. The ingestion spike (Thread B): a real track breaks the round-14 brightness-as-motion cue

Done as a follow-up to the sections above, per the handoff this file left for
a fresh agent (see the old "Thread B" text this section replaces, still
readable in git history at `8d7a4f7`). The question was concretely scoped:
*does the round 14/15 packet aesthetic survive contact with real, messy
per-cell data, or does it need retuning before Phase 2?*

**Step 1 — run the pipeline for real.** `python3 test_event.py raw_clean.json`
at the validated `period_threshold=11` passes 90h / 3619km (`output_clean/`,
committed) — the same result number the old Thread B text quoted from
memory, now actually reproduced rather than assumed.

**Step 2 — the converter.** `phase-1-validation/to_swell_pulse.py` re-runs
clustering + tracking while also recording each surviving track's per-frame
period/direction/energy/cell-count (`Track` itself only keeps the latest
snapshot of those, which loses exactly the per-point detail a `SwellPulse`
needs), picks the track that passed step 1 (id 35), and emits it in the
`SwellPulse` shape `types.ts` defines — 16 points, energy-per-cell derived
as `total_energy / n_cells` (a representative single-component energy, not
the whole cluster's summed total) and `swell_height` back-derived from that
via the same H²×T convention `helena.ts` uses. Output committed at
`output_clean/swell_pulse_track35.json`.

**Step 3 — swap it in.** Built as a second pulse-driven `SwellSource`
alongside Helena in `swellSources.ts` (in place of the invented `boreas`
entry, keeping the source count at `MAX_SWELL_SOURCES`), reusing
`resolveSwellSources`'s existing pulse-driven path unchanged, and rendered
the "3 Days" frame both with and without the swap (`npm run build` +
`npm run preview` + a one-off Playwright screenshot, then a `pngjs` pixel
diff against the same frame with `boreas` still in). Verified: `npm run
build` and `npm run lint` both clean with the swap in place.

**Step 4 — judge. It does not survive contact with real data**, and the
reason is measurable rather than a matter of taste:

- **Energy saturates the shader's calibration.** `interpolate.ts`'s
  `normalizeEnergy` clamps to 1.0 above `ENERGY_RANGE.max = 400` — a range
  calibrated against Helena's own invented 22-353 span. This track's
  per-point energy-per-cell measures **138 to 1,078**, and **8 of its 16
  points (50%) already exceed 400** on their own. Round 14's whole
  legibility mechanism is the leading edge reading as the brightest,
  most-recently-arrived part of the packet (see "Round 14" above) — with
  half the real track's points pinned at maximum brightness regardless of
  where the front actually is, that cue goes flat for a large fraction of
  its 90h run. This is `phase-1-validation/README.md`'s "adjust the
  art-direction layer, not the underlying data" case exactly: the fix
  belongs in `ENERGY_RANGE`, not in the tracker.
- **The track itself is non-monotonic in a way Helena's hand-placed path
  never is.** The region-grown cluster this track follows grows from 24
  cells to 195 and back to 165, and its energy-weighted mean direction
  swings 234.7°→317.1° and partway back over the 90h run — the same
  "centroid drift from a reshaping blob, not bulk translation" failure mode
  `tracking.py`'s own `_predict_position` docstring already names as
  observed on this exact dataset. `packetFromFront` measures a front's
  distance as the angular distance from the source's fixed origin to its
  *current* interpolated position, which assumes that distance grows
  monotonically; a track whose centroid genuinely doubles back can make a
  packet's rendered front radius shrink and regrow rather than simply
  advance — a failure mode Helena's smooth, monotonic hand-placed path
  structurally cannot exercise, so nothing in rounds 1-17 tested it.
- Screenshots taken (`/tmp`, not committed — this is a spike, not a
  deliverable per §5 of the original plan text) support this: the swapped
  packet renders as a tighter, higher-contrast band shape than the invented
  `boreas` packet it replaced, consistent with the saturation finding
  above, though the sandbox's continuous shader animation (`uTime` keeps
  running under `reducedMotion`, which only stops camera autorotate) makes
  a clean pixel-for-pixel diff between two separate page loads noisy
  outside the region actually occupied by the swapped source.

**Verdict: not promoted.** Per this file's own instruction to itself
("keep it out of the production data path unless the result is good enough
to actually replace a decorative source outright"), the `swellSources.ts`
swap was reverted after judging it — `boreas` is back, `git diff` against
before this round is empty for that file. What's kept: `to_swell_pulse.py`
(the converter, real and re-runnable) and `output_clean/
swell_pulse_track35.json` (its output, as evidence). Nothing from this round
touched `phase-0-prototype/src/data/` in the final state.

**What this actually answers:** the round 14/15 aesthetic does not survive
contact with real data unmodified — but the specific way it fails is
narrow and fixable (recalibrate `ENERGY_RANGE` against real data's own
range, and treat `packetFromFront`'s monotonic-distance assumption as
something a real, potentially non-monotonic track can violate), not a sign
the packet model itself is wrong. That recalibration is real Phase 2 work
(per §8: adjust art-direction, not the underlying tracker), not a second
spike.

### 11. The fix, put to the user directly, and promoted to production

Round "10." above left this gated behind Thread A per §8's own build order.
The user overrode that explicitly — asked for the fix and to see it on real
data — so this is done now rather than deferred, on their direct instruction
rather than an agent decision to jump the gate.

**Both root causes from round "10." are fixed in
`phase-0-prototype/src/data/`, nothing in `phase-1-validation/` changed:**

1. **`normalizeEnergy` (`interpolate.ts`) now takes an explicit `range`
   parameter instead of reading a hardcoded module constant.** First attempt
   was a single range shared across every source, computed as the max peak
   energy over whatever's loaded (`computeEnergyRange`) — built, screenshotted,
   and rejected before commit: calibrating one shared ceiling to whichever
   source is biggest makes every *other* source dimmer whenever a bigger one
   is loaded, and the real track is ~3x bigger than Helena, so the fix
   regressed Helena's and every invented source's already-tuned brightness
   globe-wide for a problem that was never theirs (screenshots compared in
   this round's diff, not committed — this rejected attempt never landed).
   **What's actually in `swellSources.ts` now:** each *pulse-driven* source
   (Helena, the real track) normalises against its own path's own energy
   span via `energyRangeFor`, so its own arc always uses the full 0..1 range
   regardless of absolute magnitude — for Helena this reproduces the exact
   0..353 the old hardcoded constant used, since that constant was already
   "Helena's own min/max" per its own original comment, just hardcoded
   instead of derived. Cg-driven invented sources have no path to derive a
   range from and keep the original fixed `INVENTED_ENERGY_RANGE` (0..400),
   completely untouched — nothing about their tuning, or the M2/M8/M9 gates
   built around it, changes.
2. **`frontDistanceRad` (`swellSources.ts`, replacing the inline
   `Math.acos` call in `resolveSwellSources`) reads the *running max*
   angular distance any already-reached waypoint has achieved, not the
   current waypoint's own distance.** Helena's hand-placed path never
   needed this — she always moves outward — but the real track's centroid
   drifts backward as its region-grown cluster reshapes (the same 90h track
   from round "10.": distance from origin shrinks and regrows twice). Taking
   the running max means the rendered front can only ever advance or hold,
   never visibly retreat, which is what "how far has this swell's energy
   reached" means physically.

**Verified:** `npm run build` and `npm run lint` clean. `smoke-test.mjs`
(both viewports), `panel-glass-test.mjs`, and `rotate-test.mjs` all pass with
zero console errors, against the real track wired in as a genuine sixth
source (replacing invented `boreas`, same as round "10."'s reverted spike —
this time kept). Real per-cell energy (138-1,078 across this one track) no
longer clamps: at "3 Days" the real track's band shows the same soft,
graded brightness structure the invented sources have, where before the fix
it was a flat, textureless wash (screenshots compared directly, not
committed).

**One new thing this round found, not a regression:** at "Now" and
"Tomorrow" the real track renders as a bright, fairly hard-edged crescent —
but so does Helena at "Now" in the completely unmodified app (confirmed by
reverting this round's two files and reshooting: same shape, same cause).
`MIN_BAND_WIDTH_RAD`'s own comment in `swellField.ts` already documents this
exact look ("Helena is the case that forced it — her front is derived from
her own slow waypoint path, so at 'Now' she is only 8 deg out, and a [narrow]
band there rendered as a crisp little moon rather than a wisp of weather"),
raised from 0.05 to 0.12 rad specifically to soften it, not eliminate it. The
real track has the same shape early in its life for the same reason (a
young, narrow band) — this is existing, accepted behaviour for any young
pulse-driven source, not something introduced here, so nothing was changed
for it.

**Not re-run:** the Stage A/B/C metrics harness (`parity-probe.mjs`,
`field-metrics.mjs`) and the full `timeline-shots.mjs` sweep, since neither
invented-source calibration nor Helena's own numbers changed — only a new
sixth source and how *its* energy and front distance are computed. Worth a
full harness pass before this is treated as done for Phase 2 proper, not
required to answer "how does it look."

### 12. QC: does the round "11." fix generalise past the one track it was built against?

The user asked directly: rerun against more real data, for more QC. Round
"10." only ever measured one real track (Mullaghmore). This round runs the
same pipeline against the other four real windows already in this repo and
checks the fix's two properties in code, not by eye.

**`to_swell_pulse.py` generalised** to take any real window as an argument
(`python3 to_swell_pulse.py raw_clean2_ireland_nov2023.json`) instead of
being hardcoded to `raw_clean.json`, via a small `WINDOW_INFO` table (id/
label/basin per file) and a `_neighbor_fn_for` that picks `pacific_grid.py`
over the default North Atlantic `grid.py` for the Pacific crossing — the one
window that needs it, per `test_pacific_event.py`'s own precedent. Same
`period_threshold=11` params as round "10.", confirmed against each
window's existing `sweep_results.json` before converting: all four already
passed the clean-window bar at these exact params (Ireland 96h/3890km,
Nazaré Feb 2024 132h/4002km, Nazaré Jan 2025 114h/5702km, Pacific
72h/3097km). Output committed alongside each window's existing evidence:
`output_clean2_ireland_nov2023/swell_pulse.json`,
`output_clean3_nazare_feb2024/swell_pulse.json`,
`output_clean4_nazare_jan2025/swell_pulse.json`,
`output_pacific_2024/swell_pulse.json`.

**Real energy ranges across all five tracks now measured, not just
Mullaghmore's:** Ireland 36-531, Nazaré Feb 2024 36-438, Nazaré Jan 2025
65-661, Pacific 110-319, against Mullaghmore's already-known 138-1,078 —
confirms the earlier finding wasn't a one-off: every real track's range
sits well above the old fixed 0-400 ceiling at its high end, and no two
tracks share a range, which is the actual argument against ever picking a
new fixed constant instead of the per-source fix.

**Real centroid backtracking measured across all five, not assumed from
one:** three of five tracks backtrack from their own origin at least once
(Mullaghmore 3 of 15 steps, max single-step regression 182km; Ireland 1 of
16, 41km; Nazaré Feb 2024 2 of 21, 43km) and two don't (Nazaré Jan 2025 and
Pacific are both naturally monotonic, like Helena). So the bug round "10."
found is real and recurring, not an artifact of the one track it was found
on — and also not universal, which is exactly the kind of thing a
one-track spike can't tell apart from noise.

**`qc-real-pulses.mjs` (new, committed) makes both properties a runnable
check instead of an eyeballed screenshot,** against the actual exported
functions the app renders with (`frontDistanceRad`, `energyRangeFor`,
`normalizeEnergy`, `pulseSource` — the first three newly exported from
`swellSources.ts` for exactly this): for each of the five real pulses,
samples 201 points across its own timespan and asserts front distance never
regresses and normalised energy never pins more than 2 points at the exact
0 or 1 ends. **All five pass:**

```
PASS Track 35 | range 0-1078 | front monotonic: true (worst regression 0.00000 rad) | amp clamped-high: 0/201, clamped-low: 0/201
PASS Nov 2023 Ireland (Track 25) | range 0-530 | front monotonic: true (worst regression 0.00000 rad) | amp clamped-high: 1/201, clamped-low: 0/201
PASS Feb 2024 Nazare (Track 21) | range 0-438 | front monotonic: true (worst regression 0.00000 rad) | amp clamped-high: 0/201, clamped-low: 0/201
PASS Jan 2025 Nazare (Track 20) | range 0-661 | front monotonic: true (worst regression 0.00000 rad) | amp clamped-high: 0/201, clamped-low: 0/201
PASS Jul 2024 Pacific crossing (Track 27) | range 0-319 | front monotonic: true (worst regression 0.00000 rad) | amp clamped-high: 1/201, clamped-low: 0/201
```

Run it with `node --import ./ts-resolve-hook.mjs --experimental-strip-types qc-real-pulses.mjs` from `phase-0-prototype/`.

**Verified:** `npm run build` and `npm run lint` clean (including the three
new exports and the QC script itself). `smoke-test.mjs`, `panel-glass-test.mjs`
and `rotate-test.mjs` re-run against the same build and still pass — this
round only added exports and a converter/QC script, the rendered app is
byte-identical to round "11."'s.

**What this settles, and what it doesn't.** It settles that the round "11."
mechanism — normalise each pulse against its own path, track a running-max
front — is correct by construction and holds for every real track measured
so far, not just the one it was built against. It does not mean five real
tracks are enough to call the *visual* question closed: only Mullaghmore's
been put on the actual globe and screenshotted (round "11."). The other four
are QC'd numerically here (`qc-real-pulses.mjs`) but not yet rendered and
judged by eye the way §5.1 ultimately requires.

### 13. A real, pre-existing bug: the far end of the scrubber washes out white

**Found by the user, live, on their own machine** — they installed Node,
ran the app locally, and reported: dragging the timeline glitches, and
swells render badly or vanish once they stop. Reproduced directly (dragged
the actual running app in a headless browser, screenshotted through the
drag and after release) rather than guessed at from the report alone.

**Isolated first, before touching anything:** reverted `swellSources.ts`
and `interpolate.ts` to their exact pre-round-"11." content (the original,
Boreas-only, no-real-track build) and dragged to the same spot. **Identical
blowout.** This is not a real-data regression — it is a latent bug in the
Phase 0 prototype itself, present since whenever the packet model last
changed shape, that nothing had ever looked at.

**Why nothing caught it:** the automated screenshot tooling every round
from 1 through 17 checked (`timeline-shots.mjs`, `shot.mjs`) only ever
captures four fixed stops — `-18h`, `Now`, `Tomorrow`, `3 Days` (+72h) —
never the far quarter of the scrubber toward its actual max, `+96h`. The
one harness that *does* sample that far (`field-metrics.mjs`'s CPU model,
`AGES`/`SCRUB_HOURS` both reach 96) was passing the whole time — M8b's own
worst-case clip at 96h measured 0.930%, under its 1.5% ceiling — because
0.930% of the *full sphere* is still a visually obvious white patch on the
half that's actually on screen, and the metric had never been eyeballed
against a real screenshot at that specific age to notice it looked worse
than the number suggested.

**Root cause, found by reading `swellField.ts` end to end rather than
guessing from the render:** `packetFromFront`'s band `width` has a floor
(`MIN_BAND_WIDTH_RAD`, so a freshly-spawned packet isn't a useless sliver)
but no ceiling — `width = rLead * relativeWidth` grows forever as a source
ages. A band's own *brightness* is self-limiting (`packetAttenuation`'s
`stretch` term decays toward `ATTEN_FLOOR` as width grows, by design), but
its *footprint* is not — an ever-widening ring keeps covering more of the
globe even after its own brightness has already floored out. With
`MAX_SWELL_SOURCES` (6) sources all doing this independently, several
eventually overlap across a shared region near the scrubber's far end, and
`fieldAt`'s energy is a true *sum* across sources — so a shared region with
several floored-but-wide bands overlapping still sums past the clip
threshold. Measured directly: "any energy" coverage of the globe jumps from
32% at 72h to 52% at 96h, nearly doubling in the scrubber's last quarter —
exactly the "width keeps growing, so does overlap" mechanism, not a
coincidence.

**Fix:** `MAX_BAND_WIDTH_RAD = 0.35` (`swellField.ts`), the missing ceiling
next to the existing floor, applied in the one shared `packetFromFront`
both Cg-driven invented sources and pulse-driven sources (Helena, the real
track) route through. `0.35` rad is not arbitrary: the CPU model's own
natural width at 72h — the last age every prior round actually verified —
is 0.349 rad, just under it, so everything already measured and gated
through "3 Days" is numerically unchanged; only the previously-untested
tail beyond it, where the bug lives, is constrained.

**Verified, before and after, not assumed:**

| | 72h (unchanged range) | 96h (the bug's range) |
|---|---|---|
| M8b worst clip | — | 0.930% → **0.427%** (threshold 1.5%) |
| M9 "strong" (≥0.35) coverage | — | 14.4% → **8.3%** (threshold 22%) |
| Near-white pixels, actual screenshot | — | 1.03% → **0.40%** of frame |

`npm run build` / `npm run lint` clean. `field-metrics.mjs` (CPU, Stage A):
5/5 gates still pass, all other ages' numbers unchanged (the whole point of
picking 0.35 against the 72h figure). `smoke-test.mjs` (both viewports),
`panel-glass-test.mjs`, `rotate-test.mjs`, and `qc-real-pulses.mjs` (all
five real pulses) all still pass. No GLSL change needed and no parity risk:
`packetFromFront` is CPU-only — it produces the `rLead`/`rTrail` numbers
that get uploaded as uniforms, the shader never recomputes it, so the same
function backs both the CPU model and the actual render already, before
and after this fix.

**Not fully eliminated, said plainly:** the 96h frame still shows a
visibly brighter patch than 72h's — 0.40% near-white and 8.3% "strong"
coverage is a large improvement, not zero. Two real options if it needs to
go further: lower `MAX_BAND_WIDTH_RAD` more (trades some of the mature-band
softness the reference wants), or add a genuine fade-out for very old
sources rather than just `ATTEN_FLOOR`'s permanent floor (a bigger change,
touches the "why doesn't anything ever disappear" decision from round 14).
Neither attempted here — the fix stops at what the measured regression
needed.

**Also true, and worth saying:** this bug sat in the prototype through
sixteen rounds of visual tuning and every metrics gate passing, and the
thing that actually found it was a person dragging the real app on their
own machine. The automated harnesses check specific, named states; they do
not check the whole reachable state space, and the timeline's own far end
was outside what any of them looked at.

### 14. A second bug round "13." didn't touch: the scrubber itself could diverge

**Round "13." fixed a real bug, but it wasn't the one the user kept hitting
after pulling it.** They reported it again, worse, triggered by the
slightest drag near the timeline's *start* this time, not the far end —
"it kinda storms through and swell disappears." Reproduced directly again
(dragging the running dev server, not the production preview build round
"13." was verified against — a real gap in how that round was tested,
closed here by testing dev mode too), and this time the disappearance
didn't recover: even returning the scrubber to "Now" left the ocean
featureless.

**Root cause, found by instrumenting the actual value rather than guessing
from screenshots:** exposed `offsetHours` (the raw pointer target) and
`scrubHours` (`useDampedValue`'s critically-damped follow of it,
`useDampedValue.ts`) side by side during a drag. `offsetHours` stayed sane
throughout. `scrubHours` did not — it reached **-103,339** within four real
frames of a small, slow drag, then kept diverging on repeat runs into the
billions. Every source resolves *its* `offsetHours` from this value, so a
diverged `scrubHours` reads as every swell being an astronomical distance
from anything real — i.e. gone — and stays gone, because a corrupted spring
restarted from that state doesn't recover in four frames either.

Logging every physics step pinned it to two independent problems, not one:

1. **The animation loop was torn down and rebuilt on every `target`
   change.** `useDampedValue`'s `requestAnimationFrame` loop lived inside a
   `useEffect` with `target` in its own dependency array — looked harmless
   (`step` already reads the current value through a ref, not a captured
   `target`), but a drag fires many pointermove events per second, and each
   one cancelled the in-flight frame and rescheduled a fresh one.
2. **The integrator is numerically unstable at its own documented worst
   case.** Semi-implicit Euler on this critically-damped spring
   (`frequencyHz = 5`, so `omega ≈ 31.4`) is only stable while
   `omega * dt` stays under ~0.83 — checked by computing the discrete
   update matrix's eigenvalues directly: `dt = 1/30` (the step's own
   existing ceiling, added so a backgrounded tab returning after seconds
   wouldn't integrate one huge step) has a max eigenvalue of **1.80**
   (unconditionally diverging); `dt = 1/60` has **0.74** (stable). One
   frame at the clamped ceiling barely nudges the value; several
   *consecutive* ones — which repeatedly restarting the loop (problem 1)
   reliably produces, and which this project's own software-rendered
   sandbox produces on nearly every frame regardless — compound into
   exactly the divergence measured.

**Fixed both, separately, because they're different failures:**

1. `startLoop` (`useDampedValue.ts`) is now a stable function, a no-op
   whenever a loop is already running (`rafIdRef` doubles as "is one
   scheduled" and the id to cancel) — calling it once per pointermove still
   happens, but costs one guard check instead of a teardown/rebuild.
   (First version of this half introduced its own bug, caught before
   commit: the unmount-cleanup effect cancelled the frame but didn't reset
   `rafIdRef` to 0, which is invisible in a production build but freezes
   the loop *permanently* under React StrictMode's dev-only double-invoke —
   `offsetHours` kept updating, `scrubHours` never moved again. Fixed by
   resetting the ref in the same cleanup that cancels the frame.)
2. `step` now **sub-steps** rather than clamping-and-taking-one-step: a
   frame whose real elapsed time exceeds `MAX_STABLE_DT` (`1/60`, with real
   margin under the ~0.83 line for this hook's `omega`) is integrated as
   several `MAX_STABLE_DT`-sized steps back to back. This keeps the
   simulation stable and accurate at *any* real frame rate — 120fps down to
   the handful of fps this sandbox's software renderer manages — rather
   than only being correct in the narrow band it happened to be tuned
   against before. (An intermediate version fixed only the sign of `dt`,
   clamping it to `>= 0` rather than letting a rare out-of-order frame
   timestamp run the physics backward — genuinely necessary on its own,
   kept — but insufficient alone: `dt` clamped to exactly `1/30` is still
   past the instability line even when it's never negative.)

**Verified:** instrumented re-test (same technique that found it) shows
`scrubHours` tracking smoothly and staying bounded throughout a drag that
previously diverged within four frames, and settling cleanly back to the
target after release. Screenshotted mid-drag and after release — full
detail both times, no disappearance. `npm run build` / `npm run lint`
clean. `smoke-test.mjs`, `panel-glass-test.mjs`, `rotate-test.mjs`,
`field-metrics.mjs` (CPU, 5/5, numbers unchanged from round "13.") and
`qc-real-pulses.mjs` (all five real pulses) all still pass — this round
touches only `useDampedValue.ts`, which nothing else in the metrics
harness exercises.

**Why round "13." missed this:** it was verified against `npm run preview`
(the production build) exclusively, and its own drag tests happened not to
hit the unstable regime — a coincidence of which specific frame timings
that run's synthetic drag produced, not evidence this bug is dev-mode-only.
This round's own repro work was done against `npm run dev` (what the user
actually ran); the fix was then re-verified against `npm run preview` too
(the regression suite above), so both are now covered, but the instability
itself lives in `useDampedValue.ts`'s math — it does not depend on which
build serves the code.

### [REVERTED — see "18b."] 15. Swells were reading straight through continents — no land-awareness at all

**Reported by the user, watching the animation:** "swell kinda continue
'under' continents and then just reappear on the other side... like if
they somehow continue traveling under it." Checking the shader confirmed it
exactly: the packet weight (`moanaSourceWeight`, `swellField.ts`) is pure
spherical geometry — angular distance from a source's origin — with the
land mask used only to recolour a fragment, never consulted when deciding
how much swell reaches it. A source on one side of a continent and a point
on the other are just two points at some angular separation; nothing in the
model knew there was a landmass between them.

**Design, put to the user rather than assumed:** offered three
implementation shapes (per-frame raycast, precomputed per-source visibility,
a cheap midpoint check); the user's own reply reframed the *physics*
question first — "swell that hits large land mass disappear, swell that
hits some smaller island bend somehow, weakens?" — real coastal behaviour
(shadowing vs. diffraction), not a rendering trick. Agreed and proposed a
single continuous mechanism that produces both ends of that spectrum for
free rather than two special cases: attenuate a source's reach at a point by
how much *contiguous land* the great-circle path between them crosses — a
short land crossing (a small island) barely attenuates, a long one (a
continent) attenuates to nearly nothing, with no separate "island" vs.
"continent" branch anywhere. The user's answer to the resulting question was
"yes."

**The physics (`swellField.ts`, shared CPU/GPU code — same file every other
round's packet math lives in, for the same reason: shader and hit-testing
must agree, not reimplement).** `pathOcclusion(origin, point, isLand)`
samples `OCCLUSION_SAMPLES` (24) points along the great-circle arc between
origin and point (`slerpUnit`, excluding both endpoints), counts what
fraction read as land, converts that fraction of the full angular distance
into a land-crossing arc length, and returns
`exp(-landAngularLength / LAND_BLOCK_SCALE_RAD)` with `LAND_BLOCK_SCALE_RAD
= 0.05` rad (~320 km) — an exponential, so a sliver of coastline knocks off
a little, a real continent knocks off effectively all of it, with one
tunable constant rather than a threshold to tune per case.

**Why precomputed, not per-frame:** every source's origin is fixed for the
whole session (`buildSwellSources` never moves one), so "how shadowed is
this point on the globe, from this source" never changes after the sources
are built. Baking it once into a texture the shader samples is the same
answer as calling `pathOcclusion` per-fragment per-source every frame, at a
fraction of the cost.

**Three architecture attempts before one actually worked — kept here
honestly, per this file's own convention, because the dead ends are the
part someone picking this up cold would otherwise redo:**

1. **One packed atlas, `NearestFilter`, 180×90 texels/source (2°/texel).**
   Worked, rendered, no crash — but visibly blocky: a staircase along every
   coastline. `NearestFilter` was load-bearing here to stop `LinearFilter`
   blending a source's band into its neighbour's when packed edge-to-edge
   in one texture. Doubling resolution to 360×180 made the steps finer, not
   smooth — confirms it was a filtering problem, not a resolution one.
2. **One `sampler2D` per source, real `LinearFilter`, no packing.** The
   filtering fix, but it needs `uniform sampler2D uOcclusion[MAX_SOURCES]`
   indexed by the swell loop's own loop variable — and this GLSL profile
   rejected it outright: "array index for samplers must be constant
   integral expressions," the moment it hit a real browser (cascading into
   "useProgram: program not valid" / a framebuffer feedback-loop warning as
   symptoms of the invalid program, not causes). Dynamic sampler-array
   indexing is a hard constraint of this environment, not something to try
   harder against.
3. **One packed atlas again, but padded (shipped).** Each source gets a
   `PAD = 2`-row margin of duplicated edge data above and below its true
   `ATLAS_HEIGHT_PER_SOURCE = 64` rows (`landOcclusion.ts`'s
   `buildOcclusionAtlas`). `LinearFilter` samples at most one texel either
   side of the exact coordinate, so at a band's true top/bottom edge it now
   blends with a *copy of its own* edge value instead of a different
   source's data — smooth interpolation, no cross-source bleed, a single
   `sampler2D` (`uOcclusionAtlas`), no dynamic indexing anywhere. The
   shader computes each source's padded V coordinate inline
   (`OCCLUSION_HEIGHT_PER_SOURCE`/`OCCLUSION_PAD`/`OCCLUSION_BAND_HEIGHT`,
   literals mirroring `landOcclusion.ts`'s constants the same way
   `MAX_SOURCES` already mirrors `MAX_SWELL_SOURCES` in this file) —
   `landOcclusion.ts` also exports `atlasHeight(sourceCount)` so the JS
   side building the `THREE.DataTexture` can't drift out of sync with the
   padding baked into the atlas it sizes.

**A real crash along the way, and an instructive false fix.** Wiring
`isLand` (built once per land-mask image, in `GlobeSphere.tsx`) up to
`Globe.tsx`'s hit-testing via `onLandReady={setIsLand}` crashed instantly:
`TypeError: Cannot read properties of null (reading '1')` inside `isLand`
itself. First guess was a `THREE.RedFormat`/software-renderer
incompatibility and switching to `RGBAFormat` — didn't fix it, same crash,
a red herring. The dev-mode stack trace pointed at React's own
`basicStateReducer`: passing a function (`isLand`) directly to a `useState`
setter is interpreted as a *functional updater* — React called
`isLand(prevState)`, i.e. `isLand(null)`, hence `null[1]`. Fixed by
`onLandReady={(fn) => setIsLand(() => fn)}`, so the setter receives a
function that *returns* `isLand` rather than being called with it.
`Globe.tsx`'s `handlePick` now multiplies `sourceWeightAt` by the same
`pathOcclusion` the shader applies, so tap and render can't disagree the
way earlier rounds' hit-testing and shading already don't.

**Verified.** `npm run build` / `npm run lint` clean. Screenshotted against
`npm run preview` at the "3 Days" stop, then again after a large camera
drag: a bright swell ribbon now visibly truncates at a continent's
coastline instead of continuing across it, with no staircase or blockiness
along the edge and no console errors, shader-compile failures, or context
loss. `field-metrics.mjs --cpu` (5/5), `parity-probe.mjs` (both gates),
`qc-real-pulses.mjs` (all five real windows), `smoke-test.mjs`,
`panel-glass-test.mjs`, and `rotate-test.mjs` all still pass — none of them
exercise land occlusion directly (it lives entirely in the shader and
`Globe.tsx`'s hit-testing, neither of which the CPU-only harnesses touch),
so this is confirming no regression, not new coverage of this feature.

**Not fully solved:** there is no automated check that the GLSL band-V
math in `GlobeSphere.tsx` still matches `landOcclusion.ts`'s
`sampleBandV`/`atlasHeight` — verified by reading both side by side at
implementation time, the same way `MAX_SOURCES` mirroring
`MAX_SWELL_SOURCES` has always been eyeballed rather than gated. Given this
project's own recurring bug shape (two places holding one fact), a
`parity-probe.mjs`-style check comparing `pathOcclusion` output against a
sampled texel from the actual built atlas would close that gap properly;
not done here since it needs the atlas plus a CPU decode of a padded band,
which is more scaffolding than this round's fix needed.

### [REVERTED — see "18b."] 16. Round "15." reduced the bug, it didn't close it — the user still saw swells crossing Central America

**Reported immediately after round "15." shipped:** "still see swell passing through eg central america etc." Rather than guess, tested `pathOcclusion` directly against the *actual* production sources and the real `earth-water.png` mask (Node, `buildSwellSources`/`resolveSwellSources` imported unmodified) at real chokepoints, and found round "15." had two separate, real bugs of its own — not a rendering artifact, not a user misread.

**Bug 1 — sampling aliasing.** `pathOcclusion` spread a *fixed* count (24) of
samples evenly across however far apart origin and point were. Fine for a
nearby point; for a source thousands of km away the spacing grows past the
width of most countries. Measured directly: from the real North Atlantic
source (`Track 35`) to Costa Rica's Pacific coast (~4655km away, correctly
crossing all of Central America), 24 evenly-spread samples landed **0 of 24
on land** — reporting a completely clear path straight through solid
ground, occlusion = 1.0000. Denser sampling of the exact same path (300
samples) found land the whole way through: occlusion ≈ 0.003. The fixed
sample count wasn't a slightly-too-coarse approximation, it was silently
missing entire countries.

**Bug 2 — decay scale six times too generous.** Even on paths where round
"15." *did* detect land, `LAND_BLOCK_SCALE_RAD = 0.05` rad (~320km) let a
few-hundred-km landmass through at roughly half strength rather than
extinguishing it. Measured against the real `Kaimana` source reaching the
Gulf of Mexico (which has no water route from the South Pacific — the
direct path necessarily crosses Mexico/Central America): **21% of its
energy leaked straight through**, a small but visibly-nonzero glow the
shader would render right where the coastline should have gone dark. A
real continent doesn't attenuate a swell to half strength; it stops it.

**Fix, both in `pathOcclusion` (`swellField.ts`):**

1. **Sample at a fixed angular step, not a fixed count.** `OCCLUSION_STEP_RAD
   = 0.004` (~25km — matched to `earth-water.png`'s own resolution, 1600px
   wide; sampling finer than the mask's own texel size buys nothing).
   Sample count is now `ceil(d / OCCLUSION_STEP_RAD)`, capped at
   `MAX_OCCLUSION_SAMPLES = 200` so the atlas bake (below) stays bounded —
   the cap only ever coarsens sampling for near-antipodal distances, where
   every source's packet has already decayed to nothing anyway.
2. **`LAND_BLOCK_SCALE_RAD` lowered from 0.05 rad to 0.008 rad (~51km).**
   Re-run against the same real chokepoints: a landmass upward of ~100km
   wide now reads under 5% transmission (visually gone), while a genuinely
   small feature — tens of km — still only dents it, which is the
   large-blocks/small-weakens split the user asked for in round "15.",
   just tuned to an actual physical scale instead of one six times too
   loose.
3. **The sampling walk itself changed from repeated `slerp` to a fixed
   per-step rotation** (Rodrigues' formula around the great-circle plane's
   normal, computing `cos`/`sin` of the step angle once per call instead of
   twice per sample) — a straight performance fix, not a behaviour change,
   needed because #1 raises the typical sample count roughly 5-10x over
   round "15." and this is called ~50,000 times baking one source's atlas
   band.

**Verified against real production code, not synthetic points.** A sweep
script (`land-occlusion-sweep.mjs`, not committed — scratch, per this
project's convention) imports `buildSwellSources`/`resolveSwellSources`/
`sourceWeightAt`/`pathOcclusion` unmodified and the real `earth-water.png`
mask, and checks the worst-case rendered brightness (`weight × occlusion`)
at six chokepoints across the full -18h..96h scrub range:

| chokepoint | worst leak (round "15.") | worst leak (this round) |
|---|---|---|
| Gulf of Mexico (behind Central America) | 0.0218 | 0.00003 |
| Caribbean Sea (behind Central America) | not measured, same class of bug | 0.00196 |
| Gulf of California (behind mainland Mexico) | not measured | 0.02653 |
| Red Sea / Black Sea (behind Africa/Europe) | not measured | ~0.00000 |

Two legitimate open-ocean paths were also checked to confirm they *don't* get over-blocked
by the tighter scale: Kaimana (South Pacific) reaching the Gulf of Panama
(a real, land-free Pacific approach) and Track 35 reaching mid-North
Atlantic both still read occlusion = 1.0000, unchanged. The remaining
non-zero leaks (Caribbean, Gulf of California) are an order of magnitude
smaller than round "15."'s Gulf-of-Mexico leak and, on inspection, are
largely real open-water approaches (the Gulf of California's own mouth
opens directly onto the Pacific; a South Pacific swell can genuinely enter
there without crossing land) rather than land aliasing — not chased further
this round.

Also re-ran the full existing regression suite: `field-metrics.mjs --cpu`
(5/5), `parity-probe.mjs` (both gates), `qc-real-pulses.mjs` (all five real
windows), `npm run build` / `npm run lint` all clean — none of these
exercise `pathOcclusion` directly, so this confirms no regression rather
than new coverage.

**Not fully solved / left open:**
- **Browser confirmation of the exact reported scene (Central America on
  screen) is still pending as of this writing** — this sandbox's software
  WebGL renderer is slow enough (a GPU process pinned at 300%+ CPU for
  minutes to render a handful of frames, independent of this fix) that
  driving the camera to a specific hemisphere and screenshotting reliably
  within a normal tool timeout has been the bottleneck, not the fix itself.
  The numeric verification above uses the exact same `pathOcclusion` the
  shader's atlas is baked from and the exact real land mask, so it is not
  a guess about what will render — but it is not a screenshot either, and
  should be spot-checked against a real machine.
- **Atlas bake time grew.** Measured in Node against the real functions,
  baking one source's full 128×64 atlas band (what round "15."'s
  `buildOcclusionAtlas` does six times, once per source, in a `useMemo` at
  mount) takes ~1.4s for all six sources combined, up from round "15."'s
  fixed-24-sample version (not separately measured then, but roughly
  5-10x fewer samples). This is a one-time cost at load, not per-frame,
  but it is a real addition to first-load time worth knowing about if §8's
  gate ever measures time-to-interactive; moving the bake to a Web Worker
  would remove it from the main thread if that becomes a problem, not done
  here.

### 18b. All four land-shadow rounds reverted, and the measurements that say why

**Reported by the user on round "18."'s build:** *"thats really bad... you
introduced some sharp straight edges/breaks in swell and swell is still
traveling under the continents... Lets revert to version 15/16.. anywhere
before we start dealing with traveling under continents."* Done — the code is
back to `d92bfcf`, the parent of the first land commit.

**The revert is exact.** The land work touched six files and nothing else, and
rounds "15."–"17." made *pure additions* to `swellField.ts` (103 insertions, 0
deletions), so nothing unrelated was entangled. `parity-probe.mjs` was
untouched by those rounds — reverting it only drops the `B3` gate round "18."
added. Verified after the revert: build and lint clean, Stage A 5/5, parity
`B` 0.000999 and `B2` 1.0001, `qc-real-pulses` all five windows, smoke both
viewports with zero console errors, `panel-glass-test`, `rotate-test`, and
**Stage C back to 9/9 with M2 at 2.69** — which also confirms round "18."'s M2
drop to 2.44 was caused by the land work and nothing else.

**Four measurements worth more than the four attempts.** These were taken
against the shipped "18." build before reverting it, and they are the reason a
fifth attempt should not be a fifth variation on ray-casting:

1. **~300 hard radial boundaries.** Each source's bearing row is a step
   function; every step renders as a straight lit/dark line along a great
   circle. Counted within the radius packets reach: 41–78 steps per source,
   13–31 of them over 0.1 rad, worst 2.93 rad.
2. **The blocking was already right.** Of ~44,000 (source, ocean point) pairs,
   only **4** were lit above 0.15 with more than 150 km of land on the direct
   path, and none above 0.34. The failure was smoothness, not strength.
3. **Beams through channels.** Measured across whole basins instead of at one
   point: Helena reaches 0.994 at the Yucatán Channel with the rest of the Gulf
   of Mexico at ~0, and 1.000 in the SE Caribbean through the Antilles. Real
   openings, but drawn as hard-edged fingers into semi-enclosed seas — which is
   what "still traveling under the continents" was describing.
4. **`M2`'s threshold assumed land-blind propagation.** Round "18." dropped it
   to 2.44 purely by removing ocean that had been lit through the Americas.
   Whatever replaces this will move `M2` again; that is expected, and the
   answer is not to lower the threshold.

**Three process failures, each of which cost a round:**

- **Every gate measured at globe scale (~16–20 km/pixel), where 25 km of
  softening is one pixel and invisible.** The user inspects at far higher zoom,
  where the same boundary is several pixels of hard edge. A metric suite can be
  entirely green against a build that looks broken. Zoomed screenshots have to
  be a gate.
- **Gates tested single hand-picked points.** Round "18."'s `L1` asserted the
  Caribbean was dark using *one* sample at 15°N 75°W, which read 0.000. Sampling
  the whole basin found 1.000. A gate that tests one point tests one point.
- **A hypothesis was rejected on a badly-formed test.** Searching for
  "beams through straits" looked for corridors that were *never* blocked and
  found one, so the idea was dropped — but the real beams are blocked, just
  further out than the point being lit. The test criterion, not the hypothesis,
  was wrong. Re-derive the criterion before believing a negative result.

**What the next attempt must be.** Not another per-ray model. Production
spectral wave models propagate energy on a grid and suppress the flux across
cells containing land — SWAN's obstacle transmission coefficients, and
WAVEWATCH III's obstruction grids (Chawla & Tolman), where islands too small to
resolve become a fractional transmission rather than a binary block. Every
value is then a weighted average of a widening neighbourhood, so the field is
smooth by construction and a hard boundary is not expressible. It also gives
the user's own framing — *"land masses that swell will just dissipate on, and
islands that will bend the swell"* — from one mechanism: lateral spread after
travelling `L` is `sqrt(D·L)`, so a shadow of transverse width `W` refills
after `L ≈ W²/4D`, quadratic in `W`, which separates an islet from a continent
with no hand-classification. Note this also finally settles Panama, which broke
rounds "15."–"17.": what blocks it is not its ~70 km along-ray thickness
(indistinguishable from an islet) but the transverse span of the barrier it
belongs to — measured at ~10,900 km from a Pacific source.

**Two numbers a next attempt will need, both of which round "18." got wrong.**
Max `rLead` across the full scrub range is **2.406 rad (15,332 km)**, not the
~1.3 assumed — so capping a radial march at what packets reach saves about
12% against π, not "half". And a water-route detour field must be computed as
the difference of two runs of the *same* solver on the *same* grid: measured
against the analytic great circle, a 1° grid reports a +246 km detour on an
open-ocean control that should be zero (grid anisotropy), and its cell-centre
sampling leaks straight through Central America. Mark a cell as land if *any*
underlying mask texel is land.

### 19. A baked (bearing x radius) atlas — land shadowing without a live per-fragment aperture

**Approved plan's mechanism (a propagating diffusion PDE) hit a real numerical
wall and was replaced mid-implementation** with something more robust that
meets the same measured criteria. Both the wall and the replacement are
recorded here because the wall is worth knowing about before anyone tries the
PDE approach again, and the replacement is what's actually shipped.

**Why a per-ray model (rounds "15."-"18.") can't be patched into looking
soft.** A shadow boundary in that family of models is the set of points where
one bearing is blocked and its neighbour isn't — a great circle, i.e. a
straight line on screen. Round "18." softened that boundary with a Fresnel
aperture, and the aperture width was *physically accurate* for ocean-swell
wavelengths (tens of metres to a few hundred) — which is exactly the problem:
real diffraction at those wavelengths is only tens of km wide even thousands
of km downstream, narrower than a single pixel at the zoom the app is
actually viewed at. Physical accuracy doesn't hand you visual softness for
free here; making it look soft is a deliberate, non-physical choice.

**First attempt: an iterative diffusion march, abandoned for a real numerical
failure.** SWAN's obstacle transmission coefficients and WAVEWATCH III's
obstruction grids (Chawla & Tolman) both propagate energy outward on a grid
and suppress it crossing land, rather than ray-casting — physically the more
defensible approach, and what the approved plan specified. Implemented as:
per source, march outward in (bearing, radius), absorbing energy that crosses
land and re-diffusing laterally every step. Building this surfaced bugs worth
recording so they aren't repeated:

- **A one-sided-padding bug in the periodic box blur** produced out-of-bounds
  reads for bearings near the end of the array, silently corrupting ~98% of
  the baked field with garbage (caught by a delta-function sanity check —
  blur a single spike, confirm the mass stays 1.0 and stays centred — which
  should be standard practice before trusting any blur implementation).
- **A flat `r * R_KM * dtheta` was used for the transverse arc length at
  angular distance `r` from a point on a sphere.** The correct relation is
  `R_KM * sin(r) * dtheta`. Past r=pi/2 these diverge badly (measured: 3x
  overestimated cell width at r=2.37 rad), which *underestimates* the needed
  blur by the same factor — exactly why sharp edges kept reappearing at large
  r no matter how the diffusion coefficient was tuned.
- **The real, unfixable one: sub-cell sigma underflows.** A discrete Gaussian
  kernel evaluated at integer cell offsets with sigma below about half a cell
  gives immediate neighbours a weight of `exp(-1/(2*sigma^2))`, which is
  astronomically small for sigma < 0.3 — meaning repeated small diffusion
  steps essentially never accumulate, unlike the continuous diffusion
  equation they're meant to approximate. This regime is common, not an edge
  case: cell width in km grows with distance from the source, so at any fixed
  physical diffusion budget per step, cells eventually outgrow it. Measured
  directly: a bearing that had just cleared 250km of land (transmission
  0.00004) stayed frozen at that exact value across 5,700km of further,
  entirely open-water travel — diffusion simply never engaged. Fixing this
  properly needs either far higher angular resolution or an implicit solver;
  both are more machinery than this problem needs given the alternative
  below already meets every measured criterion, so it wasn't pursued further.

**What shipped instead: bake the *destination*, not the process.** Per
source: `buildShadowRow` finds each bearing's first land hit (unchanged from
round "18.", including the morphological closing against sub-cell islands —
Central America blocks a 587-bearing-wide span versus the 1-2 bearings an
islet blocks, over two orders of magnitude apart, so the closing width has a
wide safe range). Then, instead of reading that row live per fragment,
`bakeShadowGrid` blurs *every radius ring independently* — an O(n) box-blur
approximation of a Gaussian (three passes, prefix-sum based, correct
regardless of kernel width) with sigma floored at `SHADOW_SOFT_FLOOR_KM =
200` — into a full `SHADOW_BEARINGS x SHADOW_RADIUS_RINGS` grid of
already-blurred values. No iteration, so the sub-cell-underflow failure mode
above doesn't apply: each ring is one clean convolution, not thousands of
compounding tiny ones.

**This also removes the tap-count-vs-cost tradeoff that kept round "18."'s
aperture narrow.** A 200km-wide aperture needs hundreds of taps near a
source (where a bearing cell is a few km wide) — far more than any live
per-fragment sum could afford. Baking once on the CPU has no such limit: the
shader's only job is one bilinear `texture2D` lookup per source per fragment,
against a grid that's already fully blurred. This is also why the CPU/GPU
parity gate needed here (`B3`, `parity-probe.mjs`) is much smaller than round
"18."'s: there's no aperture math left to duplicate in GLSL, only a
coordinate transform (bearing/radius -> texel), so `B3` just confirms the
pack/upload/bilinear-sample round trip reproduces what
`shadowTransmissionAt` computes straight from the baked grid.

**`SHADOW_SOFT_FLOOR_KM` was swept, not guessed**, against a ground-truth
score (classify real (source, ocean point) pairs by dense-march land-crossing
into "should be dark," "should be lit," or "too close to this source's own
shadow boundary to have a known answer," then score only the unambiguous
ones — the same methodology round "18." used, reused because it's the one
that actually catches over/under-blocking rather than conflating it with
"any point near any coastline"):

| floor | deep-shadow wrongly lit | deep-clear wrongly dark | max water-water jump |
|---|---|---|---|
| 120km | 0 | 5 | 0.054 |
| **200km (shipped)** | **0** | **7** | **0.034** |
| 280km | 64 | 179 | 0.025 |

200km sits at the point where deep-shadow leaks are still zero and smoothness
is markedly better than 120km, for only two more false-dim points out of
~19,000 scored. 280km starts leaking through real barriers — the aperture
grows wide enough to reach past them — so it's a real ceiling, not a
knob to keep turning for more smoothness.

**Named chokepoints, all six real sources, after the fix:** Pacific side of
Panama reads 0.960 for the one Pacific source (kaimana) and 0.000 for the
rest — a real approach, correctly lit only from the ocean it's actually on.
Every other tested point (Caribbean side of Panama, Gulf of Mexico interior,
Caribbean interior, behind Cuba, Mediterranean interior) reads at or under
0.095 for all six sources.

**Verified against a zoomed screenshot of the exact scene reported broken —
the check the previous four rounds didn't have.** Using the closed-loop
camera driving built in round "18." (`window.__moanaProject` under `?e2e=1`),
drove the camera to Panama (9N, 80W) and screenshotted at the isthmus, tight
enough to fill the frame with it. The swell now curls into the Caribbean
side, following the coastline, and stops there with no visible straight edge
at any zoom tested — cropped 3x into the tightest shot shows only the
pre-existing dispersive-packet ripple texture (present in open ocean too,
confirmed by comparison), no new banding from the bake.

**Verified, numerically.** `npm run build` / `npm run lint` clean. Stage A
5/5; parity `B` 0.000999, `B2` 1.0001, `B3` worst delta 0.00301 (tolerance
0.03, wider than round "18."'s B3 because this gate is checking a bilinear
texture round-trip through 8-bit quantisation, not exact arithmetic — see the
gate's own comment); `qc-real-pulses` all five real windows; `smoke-test.mjs`
both viewports, zero console errors; `panel-glass-test.mjs`; `rotate-test.mjs`.
Bake time measured at ~450ms for six sources in Node against the real mask —
comparable to round "18."'s ~294ms atlas-free bake, and a one-time cost the
same way that one was.

**`M2` fails again, at 2.42 against its 2.5 threshold — same finding as round
"18.", not a new one.** `P50` is unchanged at 39; the drop is `P95` (94, down
from the land-blind baseline's 106), because `M2` averages over all ocean
pixels and a real fraction of previously-lit ocean was swell that had crossed
a continent. This file's own answer for a low `M2` is "more contrast in the
bands, not a lower threshold" (`FIELD_GAIN`, currently 1.8, has headroom:
`M8b` clipping is 0.380% against a 1.5% ceiling) — a *look* decision on a
visual the user has spent many rounds converging on, so not taken
unilaterally here either.

**New gate:** `parity-probe.mjs`'s `B3` (described above) replaces round
"18."'s `B3` and `land-shadow-metrics.mjs`, both of which were removed by the
"18b." revert. No standalone `land-shadow-metrics.mjs` was re-added this round
— the ground-truth scoring above was done as scratch tooling, per this
project's own convention of not committing throwaway analysis scripts. If
this needs re-tuning, the methodology (score only unambiguous points, sweep
against both wrongly-lit and wrongly-dark) is worth reusing rather than
rebuilding from a plain threshold scan, which round "18b." also found gives
false signals (a naive leak scan on this very model flagged 7,000+ "leaks"
that were mostly legitimate coastal diffraction, not bugs).

### 20. Round "19." was numerically right and still looked wrong — the missing lever was contrast, not width

**Reported after round "19." shipped, with a screenshot:** "is it pushed? cause
it still runs under central america.." Every gate from round "19." was still
green, and the named chokepoints were still numerically correct (Pacific side
of Panama lit only from the Pacific source, Caribbean side at or under 0.095
for all six) — so this wasn't a repeat of round "16."'s bug (values wrong) or
round "18."'s (hard edges). Re-driving the closed-loop camera to the same
Panama/Caribbean view confirmed the report: the water on the Caribbean
side of the isthmus, and the enclosed seas behind it (Gulf of Honduras, the
approach to the Gulf of Mexico), read as noticeably lit rather than
contained, even though `shadowTransmissionAt` at every sampled point there
was well under 0.1.

**Root cause: `SHADOW_SOFT_FLOOR_KM` controls how far a shadow boundary is
softened, not how dark a partially-transmitting point looks — and only the
second one is what a screenshot judges.** An enclosed sea only a few hundred
km across sits almost entirely within 200km of its own boundary, so nearly
every point in it lands in the 0.3-0.7 range of the blur rather than near 0.
A pixel at 0.4 transmission, multiplied by the swell's own brightness and
then pushed through the app's bloom pass, still reads as "there's swell
here" to the eye — the ground-truth score doesn't catch this because it
classifies points by a threshold, not by how the *gradient across an
enclosed body of water* reads once colour and bloom are layered on top.

**First fix tried, and rejected by measurement: narrowing the floor to
80km.** This does genuinely change the baked field — 52% of pixels differ
from the 200km bake — but a before/after screenshot of the same scene barely
looked different, because the values were still mostly non-zero, just less
so. Width alone was the wrong lever. Reverted back to 200km, which round
"19." had already established as the wider value with the better measured
smoothness (120km/200km/280km sweep, "19." above).

**The actual fix: a separate contrast-power lever, `SHADOW_CONTRAST_POWER`,
applied after the blur (`transmission ** POWER`).** This is orthogonal to
the floor — it doesn't change *how far* a boundary is softened, only *how
quickly* brightness falls off across the softening the floor already
produces, and it can't introduce a new discontinuity: the function is
monotonic and smooth everywhere with fixed points at 0 and 1 regardless of
POWER. Rendering the raw transmission field directly (no swell colour, no
bloom, no animation — a debug PNG of `shadowTransmissionAt` over the
Gulf of Honduras/Caribbean/Yucatán region) at POWER = 1/2/3/4 made the
effect directly visible: the lit cone at each opening narrows and the
interior of each enclosed sea darkens at every step.

**POWER = 2 was chosen against the same ground-truth score round "19." used**,
swept 1/2/3/4/6:

| power | deep-shadow wrongly lit | clear-water wrongly dark | max water-water jump |
|---|---|---|---|
| 1 (round "19." shipped) | 0 | 7 | 0.068 |
| **2 (shipped)** | **0** | **149** | **0.086** |
| 3 | 0 | 283 | 0.098 |
| 4 | 0 | 373 | 0.106 |
| 6 | 0 | 481 | 0.115 |

Zero deep-shadow leaks at every power tested. But "clear-water wrongly dark"
— genuinely open water whose bearing sits close, in bearing-space, to a real
shadow boundary, so the blur bleeds a little shadow onto it — rises steeply
with power: this is the same edges-toward-hard regression round "18." was
reverted for, just reachable through this lever instead of the aperture
width. 2 sits close to the POWER=1 baseline on that cost while still cutting
the named chokepoints' transmission by roughly 4x (Gulf of Mexico entrance:
0.260/0.203 -> 0.069/0.047) — chosen as the smaller of the two values
(2 and 3) that read as clearly contained in the raw-field comparison, not
just dimmer. `SHADOW_SOFT_FLOOR_KM` stays at 200 — this round changes only
`SHADOW_CONTRAST_POWER`, added at 2.

**A methodological trap worth recording: point-sampling fixed screen pixels
across separate screenshots is unreliable here, and this project already
knew that.** Before settling on the above, single-pixel before/after
comparisons across separate Playwright launches (power=1 vs power=6, ~4-5s
settle) gave an inconsistent result — one sampled point got *brighter*
going into a supposedly darker bake. `field-metrics-pixels.mjs`'s own header
comment already documents why: "the field animates continuously, so the
same pixel is not the same part of the field twice... round 13 concluded a
formula change did nothing on exactly that mistake, when in fact the noise
had simply moved between screenshots," and its `SETTLE_MS = 60000` exists
because this sandbox's software-WebGL camera easing needs far longer than
it looks like it should to settle to a comparable frame. The ad-hoc scripts
in this round violated both established rules (short settle, fixed-pixel
sampling) before this was noticed; the numbers they produced were not used
to decide anything above — the raw-field renderer and the ground-truth score,
neither of which depends on the live scene's animation, were.

Also checked and ruled out as the cause of "still looks lit": Bloom
postprocessing. Disabling it (`intensity={0}` in `Globe.tsx`, temporarily,
reverted after) and re-screenshotting the same view produced almost no
visible change from the bloom-enabled version — the swell's own brightness
and colour ramp, not the bloom pass, is what was carrying a 0.4-transmission
pixel across the "still reads as lit" line.

**Verified.** `npm run build` / `npm run lint` clean. Stage A 5/5;
`qc-real-pulses.mjs` all five real windows; parity `B` worst divergence
0.000999, `B2` ratio 1.0001, `B3` worst delta 0.00333 (all against the same
tolerances round "19." passed at); Stage C **8 of 9** — `M2` fails again at
2.41 against 2.5, the same pre-existing, already-documented finding from
round "19." (2.44), not a new regression from this round (P50 unchanged at
39; still the user's call per "19."'s note, threshold not lowered);
`smoke-test.mjs` both viewports, zero console errors; `panel-glass-test.mjs`;
`rotate-test.mjs`. Screenshotted Panama fresh via the closed-loop camera
(`window.__moanaProject`, `?e2e=1`): the bright swell fills the Pacific/Gulf
of Panama side, bends visibly around the small islands there, and stops flat
at the isthmus — nothing visible on the Caribbean side in the same frame.
**Correction, round "21.": this screenshot was itself misread — the globe's
land texture was rendering north/south-mirrored at the time (a bug that
predates this round, fixed in "21."), so the coastline in that screenshot
was not actually Central America's. The `SHADOW_CONTRAST_POWER` fix above
is still correct — everything about it was validated against the CPU model
and the real mask, neither of which goes through the texture pipeline — but
re-verify against a real screenshot using "21."'s fix before trusting a
screenshot of this scene again.

No new gate added this round — the ground-truth scorer used for the sweep
above reused round "19."'s methodology as scratch tooling (deleted after,
per this project's convention of not committing throwaway analysis
scripts); `parity-probe.mjs`'s `B3` already covers the CPU/GPU round trip
for the baked grid and needed no changes since `SHADOW_CONTRAST_POWER` is
applied before the grid is baked, not in the GLSL sampling path.

### 21. The globe's land texture was rendering north/south-mirrored — found while re-checking round "20."

**The user looked at round "20."'s verification screenshot and pushed back
immediately: "Wait what?? It is on Caribbean side on the screenshot you
provided.. you also have globe somehow twisted."** They were right on both
counts, and this was not a land-shadow bug at all — it was a real rendering
bug in `GlobeSphere.tsx`, unrelated to rounds "19."/"20.", that had been
there since round "7." introduced the real Natural-Earth mask.

**Root cause: `THREE.Texture.flipY` defaults to `true`, and nothing in this
codebase ever set it.** The shader's `posToUv` derives `v` straight from
latitude (`v = acos(p.y) / pi`, 0 at the north pole), matching every CPU
reader of the same PNG — `buildIsLand`'s canvas (`ctx.getImageData`, which
does not flip) and the plain `pngjs` readers the offline harnesses use.
`THREE.TextureLoader` does not match that: its default `flipY = true`
uploads the image reflected across its horizontal midline (the GL-texture
convention, v=0 at the bottom), so the shader was sampling `uLandMask` and
`uNightTexture` at `v` reflected through the equator. The result was a real,
correctly shaped Earth with every landmass mirrored north/south — Central
America's outline, say, drawn as if the Northern and Southern hemispheres
had swapped places.

**Why this went unnoticed for fourteen rounds of visual QA:** the mirror is
internally consistent — recognisable coastline shapes, correct relative
sizes, a plausible-looking planet — so nothing about it screamed "broken" on
its own. It only became checkable by projecting *known* real-world
coordinates through the app's own camera and comparing them against the
picture, which is what round "20."'s re-verification (below) finally did.

**Crucially, the land shadow *physics* (rounds "19."/"20.") was never
affected.** `buildIsLand` reads the mask via a `<canvas>` and
`getImageData`, never through a `THREE.Texture`, so every shadow-shape
decision, every ground-truth score, and every chokepoint number in rounds
"15."-"20." was computed against correctly oriented geography the whole
time. Only what got *drawn* was wrong. This means round "20."'s own
verification screenshot was misleading in a specific way: the swell shown in
it really was being blocked and shaped correctly — just next to the wrong
coastline outline, because that outline was mirrored.

**Found by:** projecting a list of real cities (Panama City, Colón, Miami,
Havana, Cancún, Acapulco, Cartagena, Bogotá, Guayaquil, Caracas — chosen to
straddle both sides of Central America and both hemispheres) through
`window.__moanaProject` (the same debug hook used to drive the camera) and
marking them on a screenshot of the exact camera position round "20."
screenshotted. Every single marker landed in open ocean, nowhere near the
coastline drawn on screen — Panama City and Colón (a few km apart in
reality) projected essentially on top of each other, both in water, both
nowhere near the isthmus shape visible in the picture. Setting
`landMask.flipY = false` and re-running the identical check landed every
marker exactly where it belongs — Miami on Florida, Havana on Cuba, Panama
City and Colón either side of the real isthmus.

**Fix:** `landMask.flipY = false` and `nightTexture.flipY = false` in
`GlobeSphere.tsx` (both textures are sampled with the same `uv`, computed
once from `posToUv`, so both needed the same fix). Two lines.

**Re-verified round "20."'s fix against the now-correct geography.**
Projected `sourceWeightAt` for `kaimana` (the Pacific source that lights
Panama) against Panama's real coordinates across the scrub range to find
when a packet is actually there (weight peaks ~0.14 around h=66, not at the
"3 Days"/h=72 preset used before — see `check-drift`/`shot-panama-swell`
scratch scripts, deleted after). Screenshotted that moment: the swell washes
up Costa Rica's and Panama's real Pacific coastline and stops there cleanly;
the Caribbean side — Cuba, Jamaica, the Panama Canal's Atlantic mouth,
Colombia's Caribbean coast, all correctly shaped and positioned this time —
shows no swell energy at all in the same frame. This is the verification
round "20." intended to do and, because of this bug, didn't actually do.

**Verified.** `npm run build` / `npm run lint` clean. Parity `B`/`B2`/`B3`
and `qc-real-pulses` unchanged (none of them render through
`THREE.TextureLoader`, so none could have caught this, and none were
affected by the fix). Stage A 5/5 (CPU-only, likewise unaffected). Stage C
**8 of 9, and `M2` now passes**: 2.70 against the 2.50 threshold, up from
round "20."'s 2.41 — the correctly positioned land mask changes which ocean
pixels count as "near a coastline" for the field's own dynamic range, which
is a plausible side effect of a real orientation fix, not something tuned
for. `M10` (land stays subordinate to water) now **fails**, and for the
mirror-image reason M2 now passes: `M10` samples luminance at a fixed list
of real-world "interior land" points, and before this fix those points
(via the same mirrored texture) were landing on whatever the flipped render
happened to show there — not necessarily real land at all. Sampling true
land now gives `landMean` 7.0 against an ocean median of 41 (ratio 0.170,
below the gate's 0.35 floor) — genuinely darker than what the gate was
calibrated against, because the gate was calibrated against mismeasured
points. The screenshots above don't show land reading as a void competing
with the water — it looks like the same restrained, orientation-only land
treatment the design has always intended, just correctly placed — but
`FIELD_GAIN`/land-shading are look decisions on a visual the user has spent
many rounds converging on, so `M10`'s threshold was left alone rather than
adjusted unilaterally, same treatment `M2` has gotten every round it's
flipped. **This needs the user's call**: either `M10`'s floor was
miscalibrated by this same bug and should move to reflect true land
darkness, or land should be lightened slightly now that it's measured
correctly. `smoke-test.mjs` both viewports, zero console errors;
`panel-glass-test.mjs`; `rotate-test.mjs`.

No new gate added — this is a rendering-pipeline bug, not a land-shadow
model change, so nothing about `parity-probe.mjs`'s `B3` or the shadow atlas
needed touching. `check-drift.mjs`, `verify-geo.mjs`, `shot-panama-swell.mjs`,
`mark.mjs`, and `crop.mjs` were scratch tooling for this investigation,
deleted after, per this project's convention.

### 22. Smooth swell turned into banded contour lines after a few minutes idle — a lattice-aligned noise drift

**Reported with a screenshot:** left running untouched for "even just a few
minutes," the ocean's marbled swell texture developed distinct, thin,
roughly-parallel contour lines instead of staying a smooth gradient. Not a
land-shadow issue, not a geometry issue — this is the domain-warped fBm
noise that paints the water's flowing texture (`GlobeSphere.tsx`, the
`SURFACE_FRAGMENT` shader), unrelated to rounds 15-21.

**Root cause: the animation's time-driven offset moves exactly along
simplex noise's one degenerate direction.** The noise's "slow independent
evolution" term was:

```glsl
vec3 evolve = f * 0.15 * dirConfidence + vec3(uTime * 0.009);
```

`vec3(uTime * 0.009)` broadcasts the *same* scalar to all three axes —
every fragment on the globe, identically, drifts in a dead-straight line
along the `(1,1,1)` direction as `uTime` (seconds since page load) grows.
That direction is not neutral for the simplex noise implementation this
project uses (`shaders/noise.ts`, standard Ashima/Gustavson): its cell-skew
step (`i = floor(v + dot(v, vec3(1/3)))`) treats `(1,1,1)` as a special
axis — moving along it shifts which lattice cell a sample falls in
*without changing where in the cell it falls*, so successive samples along
that line keep re-hashing the same relative corner instead of landing on
independent pseudo-random values. The result reads as correlated banding,
not noise. This is a documented caveat of this noise family (animate along
the lattice diagonal and the grid shows through) — not a bug in the
Ashima/Gustavson code, a bug in how this shader drove it.

**Why "even just a few minutes" and not hours:** this is a *direction*
problem, not a magnitude/precision one (round "21." briefly considered and
ruled out a float32-precision hypothesis for the same reason — the numbers
involved after a few minutes are nowhere near where float32 struggles).
Any accumulated drift that is a non-trivial fraction of one noise cell
along the exact diagonal is enough to expose the correlation; at
`uTime * 0.009` that only takes on the order of a minute or two.

**Confirmed by direct A/B, not just code reading.** Loaded the app, took a
screenshot, waited 3 minutes untouched (`reducedMotion: 'reduce'` so the
camera doesn't drift, isolating the ocean animation itself), screenshotted
again, and cropped into the swell band both times:
- **Old code:** smooth and marbled at t=0; by t=180s a young, freshly
  spawned packet already shows a faint seam, and a mature ("3 Days") packet
  with a long-travelled ribbon shows clearly, unambiguously banded parallel
  contour lines running along its length and coastward edge — a direct
  match for the screenshot.
- **Fixed code, identical scenario:** the mature ribbon at t=180s is back
  to soft marbled gradients, materially indistinguishable from its own
  t=0 frame. The A/B was done by `git stash`-ing the fix to get a clean
  before/after on the same commit, not by comparing across unrelated runs.

**Fix:** give the three axes different, non-integer-ratio rates instead of
one shared scalar, so the drift direction is off the lattice diagonal —
same speed as before (`vec3(0.0091, 0.0069, 0.0113)` has almost the same
magnitude as the old `vec3(0.009)`), just not degenerate:

```glsl
vec3 evolve = f * 0.15 * dirConfidence + vec3(uTime * 0.0091, uTime * 0.0069, uTime * 0.0113);
```

Two lines changed, both in `GlobeSphere.tsx`.

**Verified.** `npm run build` / `npm run lint` clean. Parity `B` 0.000999,
`B2` 1.0001, `B3` worst delta 0.00333 — all unchanged from round "21.",
expected since this only touches the ocean's decorative noise phase, not
land shadowing or the noise's isotropy fade. `qc-real-pulses.mjs` all five
real windows. Stage A 5/5. Stage C 8/9 — `M2` 2.65 (still passing, same
ballpark as "21."'s 2.70), `M10` still fails at 0.171 (same pre-existing,
already-documented finding from "21.", not something this round touched or
could have moved — land colour is untouched here). `smoke-test.mjs` both
viewports, zero console errors; `panel-glass-test.mjs`; `rotate-test.mjs`.

No new gate added — this was verified by direct visual A/B (see above)
rather than a numeric threshold, because the defect is about the
*correlation structure* of a noise field over time, which the existing
gates (calibrated on short-lived Playwright sessions, seconds not minutes
of `uTime`) were never positioned to catch. Worth knowing if this class of
bug recurs: any `vec3(scalar)` fed into this noise family's coordinate is
suspect, not just time-driven ones.

### [REVERTED — see "18b."] 18. The land-shadow model was wrong in kind, not in tuning — rewritten as a shadow

**Reported by the user after rounds "15."-"17.":** *"in last two rounds we've
been trying to 'stop' the swell when it hit landmass.. it didn't really work..
in first attempt swells continue to run under continents.. second attempt kinda
mess everything up and created somewhat choppy speckles patterns to swells -
very bad."* Both halves of that were reproduced numerically before anything was
changed, and both were real.

**What all three previous rounds had in common.** Every one of them modelled
land the same way: walk the great-circle arc from source to point, count how
much of it reads as land, attenuate by `exp(-landLength / scale)`. Round "15."
tuned the sample count, round "16." tuned the sampling step and the decay
scale, round "17." moved where it was evaluated. Nobody questioned the model,
and the model was the bug, in two independent ways:

1. **It quantised catastrophically.** The shader summed a small *integer*
   count of land hits. Measured on a 40-degree path at the shipped 40-sample
   cap: zero land samples gives transmission 1.0000 and **one gives 0.1129**.
   So whether a single sample happened to land on an island decided whether a
   pixel was bright or black — and adjacent pixels made that coin flip
   independently. Measured in the Caribbean, **11.2% of neighbouring sample
   pairs differed by more than 0.25, with jumps as large as 0.997.** That is
   exactly the speckle the user described, and it is inherent to the model:
   no tuning fixes an output that is a low integer count.
2. **It undersampled.** That same 40-sample cap spreads samples **108km apart
   on a 40-degree path** — four times coarser than the 25km land mask it
   reads, so whole countries fall between samples. Round "16." had fixed this
   for the CPU (whose cap is 200) but its GLSL mirror kept 40: two places
   holding one fact, this file's own recurring bug shape, for the fourth time.

**The replacement — a shadow, not an attenuation.** Land casts a *shadow*, and
the only thing that puts energy back into a shadow is *diffraction around its
edges*. So, per source, bake one number per bearing — the angular distance at
which that ray first meets land — and ask, for any point, what fraction of the
first Fresnel zone around the direct ray is unobstructed. That is the standard
Fresnel-clearance model for wave shadowing, and it produces both halves of what
the user asked for in round "15." (*"swell that hits large land mass disappear,
swell that hits some smaller island bend somehow, weakens?"*) from one
mechanism, with no island/continent special case. Measured, 1200km downstream:
an 8km islet transmits 1.000, a 30km island 0.24, Panama's ~70km isthmus 0.05,
and anything from 150km up 0.000.

**Why per-bearing and not another atlas.** Rounds "15."/"16." baked a lat/lon
atlas and round "17." deleted it for a per-fragment march, and both framings
were wrong the same way: they stored the answer on a grid laid over the
*destination*, where the structure is arbitrarily fine, when the quantity is a
property of a *ray*. Indexed by bearing, one source's whole shadow is 2048
floats with the distance along each ray stored as a continuous number — there
is no destination grid left to be coarser than the geography. The bake is
**294ms for six sources** against the ~1.4s round "16." measured for its atlas,
and the render samples 13 texels of a 48KB texture instead of up to 40 of a
mip-mapped 1600x800 one, so round "17."'s open worry about per-fragment cost is
answered rather than inherited.

**It cannot speckle by construction.** The taps sit on fixed bearing centres
and only their Gaussian weights slide with the fragment's position, so
transmission is a continuous function of where the fragment is. That is a
property of the shape of the computation, not of a constant that could drift.

**Two things measurement caught that reasoning had got wrong**, both worth
keeping because both were confidently argued first:

- **Sub-sampling each bearing cell** (so an obstacle narrower than a cell
  costs less than the whole cell) was built on a clear argument and measured
  to change the globe's partial-transmission area from 3.376% to 3.326% and
  the scored error counts not at all, for 4x the bake time. Removed.
- **An early scoring harness asked "direct ray clear => must be lit"** and
  reported 414 errors. Inspecting one: its direct ray was clear, but it sat
  **8.5km from a geometric shadow edge**, where half a Fresnel zone is
  obstructed and ~0.33 is the correct answer. The criterion ignored the very
  physics being tested. Rescored by shadow-interior rather than by ray:
  **the shipped model gets 423 deep-shadow points wrong and the new one 0.**

**A real artifact the screenshot caught and the metrics did not.** The first
build put hard thin dark lines across the North Atlantic swell — shadows cast
by islands too small to draw, beginning abruptly at an invisible obstacle with
blunt square ends. Two attempts to soften them physically (a directional-spread
term, then a two-pass aperture) both failed, and widening the blur only added
mush. The structure that fixed it came from measuring rather than arguing:
Central America blocks a **587-bearing-wide** span of a Pacific source's row,
against the **one or two bearings** an islet blocks — over two orders of
magnitude apart. A morphological closing on the row (`SHADOW_CLOSE_BEARINGS`)
fills valleys narrower than its element while leaving wider ones and every peak
untouched, so it removes exactly those isolated near-blocks and nothing else,
cannot weaken a real barrier at that separation, and leaves narrow *straits*
passing swell through them.

**The CPU/GPU gap both earlier rounds flagged is now closed.** Rounds "15." and
"17." each wrote a GLSL mirror of the land math, each verified it by reading
the two side by side, and each wrote down that a real check was the thing worth
adding. `parity-probe.mjs`'s new **B3** compiles the shipped `SWELL_SHADOW_GLSL`
against a real 16-bit shadow texture and the real mask and asserts it matches
the TypeScript at eight points including Panama — worst delta 0.00000. The
shader and `Globe.tsx`'s hit-testing now read the same baked `Float32Array`, so
there is one model and one copy of the data.

**New gate: `land-shadow-metrics.mjs`** (Stage L, CPU only, ~300ms) asserts the
five properties these four rounds were each missing — L1 enclosed seas stay
dark, L2 open ocean is not over-blocked, L3 the field is smooth not speckled,
L4 small obstacles bend where large ones block, L5 swell still reaches the
coast it is running at. It discriminates: on L3's exact scan the shipped
round-"17." model measures **0.999** against the new model's **0.349** and a
0.5 threshold.

**Verified.** `npm run build` / `npm run lint` clean. Stage A 5/5; Stage L 5/5;
parity `B` 0.000999, `B2` 1.0001, `B3` 0.00000; Stage C **8 of 9**;
`qc-real-pulses.mjs` all five real windows; `smoke-test.mjs` both viewports,
zero console errors; `panel-glass-test.mjs`, `rotate-test.mjs`. Screenshotted
before and after from an identical camera (landmark positions projected through
the app's own `__moanaProject` in both runs, so the frames are comparable): the
speckled blocks off Central America and in the Caribbean are gone, the Atlantic
swell stops at West Africa instead of crossing it, and the shadow field
rendered directly to an equirectangular image shows a clean lit lobe.

**Not fully solved — `M2` fails at 2.44 against its 2.5 threshold, and this
needs the user's call.** It is not a bug and not a regression in the swell
itself: `P50` is unchanged at 39 and `M4p`/`M1p` are unmoved (3.27x against a
3.26x baseline), so the bands have exactly the contrast they had. What dropped
is `P95`, 106 -> 95, because `M2` averages over *all* ocean pixels and a large
part of the frame's bright ocean was previously swell that had crossed the
Americas. The gate's calibration assumed land-blind propagation, so fixing the
propagation moved it. This file's own instruction for a low `M2` is "more
contrast in the bands, not a lower threshold" — the levers are `FIELD_GAIN`
(1.8 now, with real headroom: `M8b` clipping is 0.413% against a 1.5% ceiling
and `M9` 8.2% against 22%) or the colour ramp. Both are *look* decisions on a
visual the user has spent seventeen rounds converging on, so neither was taken
unilaterally. **Do not lower the threshold to make this pass.**

### [REVERTED — see "18b."] 17. Round "16." was still wrong — not the sampling, the destination grid

**Reported again, with a screenshot this time:** "still there look .. the
swell is coming from left passing under central america and continuos
right." The screenshot showed a bright swell ribbon sitting in open water
right up to a coastline, with no visible staircase or blockiness — round
"16."'s fixes had clearly landed — but with the coastline itself doing
nothing to it.

**Root cause: a resolution ceiling round "16." never touched.** Round
"16." fixed how densely `pathOcclusion` samples *along* a source-to-point
path. It never touched the other axis of the bug: the *destination* grid
the computed values get stored into. `landOcclusion.ts`'s atlas is 128×64
texels per source — about 2.8° per texel, ~310km at the equator. Central
America's Panama isthmus is ~70km wide. No matter how accurately
`pathOcclusion` computes any *individual* texel's value, a grid this coarse
has no texel that ever lands squarely on a 70km feature — `LinearFilter`
just interpolates between whatever open-ocean texels happen to bracket it,
producing a smooth, never-quite-zero gradient across the whole region
instead of a hard cutoff at the actual coastline. Tuning the atlas
resolution to fix this properly does not work either: resolving a 70km
feature needs texel spacing under ~35km, roughly 80× more texels than
128×64 — at the per-texel cost round "16." already measured, that is a
30s+ synchronous bake, not a viable fix.

**The fix: stop baking a destination grid at all.** `GlobeSphere.tsx`'s
fragment shader now calls its own GLSL mirror of `pathOcclusion` directly
against `uLandMask` — the same full-resolution land-mask texture the base
ocean/land coloring already samples — once per fragment, per source,
inside the existing per-source loop. There is no grid to be coarser than
the geography any more: every rendered pixel evaluates its own exact
position against the real mask, the same one `isLand` reads on the CPU
side. Gated behind `if (w > 0.0)`, so the sampling loop only actually runs
for a fragment inside a source's current packet ring — most fragments,
most of the time, skip it entirely — which is a cost model the atlas
approach could never have, since it had to precompute every point on the
globe for every source regardless of whether that source's ring would ever
reach there.

`landOcclusion.ts` lost `buildOcclusionAtlas`/`atlasHeight`/`ATLAS_WIDTH`/
`ATLAS_HEIGHT_PER_SOURCE` entirely — the whole atlas-baking half of the
file. What's left is just `buildIsLand`, still needed for `Globe.tsx`'s
CPU-side hit-testing, which continues to call the same `pathOcclusion`
from `swellField.ts` unchanged (round "16."'s sampling/decay-scale fix was
correct and stays exactly as shipped — the bug this round found was purely
about how the shader turned that correct math into pixels, not the math
itself).

**Verified.** `npm run build` / `npm run lint` clean. Full regression suite
still passes: `field-metrics.mjs --cpu` (5/5), `parity-probe.mjs` (both
gates), `qc-real-pulses.mjs` (all five real windows), `smoke-test.mjs`,
`panel-glass-test.mjs`, `rotate-test.mjs` — none exercise land occlusion
directly, so this confirms no regression rather than new coverage of this
specific fix.

Round "16." left browser confirmation of the exact reported scene
outstanding, blocked on this sandbox's slow software renderer making
camera-drag automation unreliable. Solved that properly this round instead
of guessing: the app already exposes `window.__moanaProject` under `?e2e=1`
(built for `field-metrics.mjs`'s pixel harness) — projecting a known
lat/lon to screen coordinates and its camera-facing state made it possible
to *drive* the camera toward Panama (9°N, 80°W) with closed-loop feedback
(drag, re-project, check error, repeat) instead of guessing drag distances
and hoping. Landed centered and facing in 5 iterations. Cropped in tight on
the isthmus itself: the bright swell ribbon sits entirely in the Caribbean
water east of the isthmus, stopping cleanly at the coastline — no bleed
onto the landmass, no glow reappearing on the Pacific side. This is the
first round of this bug that has an actual screenshot of the specific
scene the user reported, not just numeric proof against the same functions
that render it.

**Not fully solved:** performance of the new per-fragment sampling on real
hardware hasn't been measured — only functional correctness and this
sandbox's own (software-rendered, not representative) frame rate. The `w >
0.0` gate should make this cheap in practice (most fragments skip the loop
entirely most of the time), but that is reasoning from the code, not a
measurement on a real GPU. Worth a real-device check if the §8 gate or
further use surfaces any frame-rate regression.

---

## What's next

**Two independent threads, and they can run in parallel — neither blocks the
other.** Thread A is the §8 human gate, unchanged from before and still
needing the user. Thread B — the ingestion spike and its fix — is now done
(see "10." and "11." above); what's left is a narrower harness follow-up.
Land occlusion (see "15."-"18.") is a real bug the user found while
exercising Thread B's real data, and took four rounds to actually close —
"15."-"17." all tuned one model, and "18." replaced it (read "18." first; the
three below it are the dead ends it came out of):
round "15." added the mechanism but sampled too coarsely and used too loose
a decay scale, round "16." fixed both of those but was still bottlenecked
by a coarse destination texture atlas, and round "17." removed the atlas
entirely in favour of computing occlusion live per fragment against the
real land mask — verified this time against a screenshot of the specific
scene the user reported (Panama), not just numeric proof. Real-device
performance of the per-fragment approach is the one thing still unmeasured
(see "17."'s "Not fully solved").

### Thread A — the §8 gate (unchanged, still needs the user)

**Phase 0 is built** (`phase-0-prototype/`) but **not yet passed** — blocked on
the one thing no agent session can do itself: handing a phone to five
non-surfers and timing whether they rotate the globe unprompted for 30+
seconds. Run it once the user is done iterating on the visual (round 17 closed
the filament question — see the box at the top of this file — so there may be
nothing left to iterate on). If it fails, §8 says iterate on shaders/motion/
typography, not add data complexity to compensate.

### Thread B — done: the ingestion spike found a bug and fixed it

**Round "10." found it, round "11." fixed it, on the user's direct
instruction rather than waiting behind Thread A.** The real track from
`phase-1-validation/output_clean/swell_pulse_track35.json` is now a live
sixth source in `phase-0-prototype/src/data/swellSources.ts` (replacing
invented `boreas`), with both root causes fixed: `normalizeEnergy` now
normalises each pulse-driven source against its own path's energy span
(`energyRangeFor`) instead of a shared, Helena-only ceiling, and
`frontDistanceRad` tracks the running-max distance a track has reached
instead of its current, possibly-backtracked position. Helena's own
calibration and every invented source are numerically untouched by this —
see "11." for the full before/after and what was tried and rejected first.

**What's left under this thread, now that the fix is live and QC'd against
all five real windows (see "12."):**
1. Re-run the Stage A/B/C metrics harness (`parity-probe.mjs`,
   `field-metrics.mjs`) and the full `timeline-shots.mjs` sweep with the real
   track wired in, and record the numbers the way rounds 1-17 do — this
   round verified build/lint/smoke/panel/rotate and `qc-real-pulses.mjs`,
   not the full gate suite.
2. Decide whether the real track stays wired in as a permanent sixth source
   or reverts to spike status once §8 is actually run — right now it is
   live in the same build the §8 gate will eventually test, which was not
   true when round "10." wrote this file.
3. ~~Convert a second real track... to confirm the per-source-range fix
   generalises~~ — done in "12.": all five real windows pass
   `qc-real-pulses.mjs` (never clamps flat, front never regresses). What
   that round explicitly did *not* do: render the other four on the actual
   globe and judge them by eye the way Mullaghmore was in "11." — only the
   numeric properties are checked for those four, not the look.
4. `MAX_BAND_WIDTH_RAD` (round "13.") reduces the far-scrubber washout,
   doesn't eliminate it — 96h is still visibly brighter than 72h. Revisit
   if the §8 gate (or just further eyeballing) says it's still not calm
   enough; round "13." lists the two real options (tighter width cap, or a
   genuine old-age fade) and deliberately didn't pick between them.

**Coverage gap round "13." exposed, worth fixing on its own:**
`timeline-shots.mjs`'s `STOPS` (`-18h`, `Now`, `Tomorrow`, `3 Days`) never
reaches the scrubber's actual far end (`+96h`) — every round's visual
verification through 17 rounds had a blind spot there, which is exactly
where round "13."'s bug lived. Worth adding a `+96h` (or similarly-named)
stop so future rounds' routine screenshots cover the whole reachable range,
not just the four hand-picked ones.

### Lower-priority open items, not blocking either thread
`MASTER_BUILD_PLAN.md` §12:
- **Open-Meteo call-volume budget** (§4.1): the ~463K calls/month estimate is
  derived from a search-summarized pricing formula, not verified directly
  against Open-Meteo's pricing page (still blocked from this sandbox — same
  network policy as above). Worth a direct check once real network access
  exists, before Phase 5 (the first paid feature) ships.
- **Brand name** (§12.1): still deferred, correctly — nothing here changes
  that.
- **Print fulfillment partner** (§12.3): still unselected, correctly, this
  far out.

**Loose threads from the Phase −1 validation work itself**, worth knowing
about but not blocking either thread above:

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
