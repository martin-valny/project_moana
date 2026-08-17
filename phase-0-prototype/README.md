# Phase 0 — Visual-only prototype

Per `MASTER_BUILD_PLAN.md` §8. No live data, no backend — one hardcoded
fake swell ("Helena") crossing the North Atlantic, rendered on a cinematic
dark globe, with a time scrubber, tap-to-inspect, and local-only Follow.

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
  `MASTER_BUILD_PLAN.md` §9.1) and Helena's invented path
  (`helena.ts`), anchored to whenever the app loads so "Now" always makes
  sense. `interpolate.ts` reads an arbitrary point in time off that path —
  the only thing the time scrubber is allowed to move.
- `src/three/` — the globe: `GlobeSphere` (dark navy planet + fresnel rim,
  custom-shaded rather than relying on three.js's physically-correct
  light units, which otherwise leave a near-black material invisible),
  `AmbientField` (the ambient "living ocean" particle field, not
  data-driven — ~3,200 points drifting via simplex noise, deliberately
  dimmer/smaller than Helena's own trail), `HelenaPath` (the one
  data-driven, tappable trail + marker).
- `src/components/` — `TimeScrubber`, `SwellPanel` (name, one-line
  narrative, Follow, and a details toggle gating the only raw numbers in
  the app per §6.1), `Attribution` (§3.3 decision — see below).
- `src/hooks/useFollow.ts` — Follow persistence via `localStorage`, the
  web stand-in for §9.2's AsyncStorage requirement (same key/shape,
  trivial swap when this ports to Expo).

## Attribution decision (§3.3)

Made here, not deferred: a hairline "Data: Open-Meteo" credit sits
permanently at the bottom-right corner (satisfies CC BY 4.0's "visible
wherever the data is displayed" unconditionally), and tapping it opens a
one-tap sheet with the full credit, CC BY 4.0 link, and a note that Phase 0
itself has no live data. Both options from the plan, combined rather than
chosen between. See `MASTER_BUILD_PLAN.md` §3.3/§11 row 17.

## A build bug worth knowing about (fixed, but instructive)

The first render of `AmbientField` produced a huge moiré/scale-pattern
mess covering the whole globe, not the intended soft drifting points. Root
cause: the point-size formula's distance-scale constant was tuned for a
different camera setup and came out ~15-20x too large, so each of the
~3,200 points rendered as a 50-150px blob; thousands of overlapping
additive blobs plus bloom produced the pattern. Fixed by rederiving the
constant from the actual camera-to-surface distance. Separately, the base
globe was originally near-invisible because `meshStandardMaterial` on a
near-black colour under three.js's physically-correct light units needs
much higher light intensities than the default scene had — replaced with
a small self-contained lighting shader so the look doesn't depend on
tuning global light units correctly.

## Falsifiable test — not yet run

§8's actual Phase 0 gate: **hand the phone to five people who don't surf,
say nothing, and time whether they rotate the globe unprompted for 30+
seconds.** This requires physical devices and real people and hasn't been
run yet — see `PROGRESS.md` for what's been verified instead (build,
render correctness, interaction wiring via an automated Playwright smoke
test) and what's still outstanding.

`smoke-test.mjs` is a Playwright script (not a human test, just a
regression check) that loads the built app headlessly, verifies no console
errors, taps Helena's marker, follows her, moves the time scrubber, and
opens the attribution sheet. Run it against `npm run preview` on port 4173:

```bash
npm run build
npm run preview -- --port 4173 &
node smoke-test.mjs
```
