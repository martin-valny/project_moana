# Project Moana — Progress Report

Last updated: 2026-08-17, branch `claude/moana-master-build-plan-v2-zjs07y`.

This file exists so a new agent picking up this repo cold can tell the user
exactly what's happened and what decision is needed next, without
re-deriving context. Read this before doing anything else in this repo.

**The full plan this file references by section number (§4.5, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file too; this one
assumes it as background.

## Where the project stands — READ THIS FIRST

**Phase −1 has run against real data three rounds now. The picture changed
a lot between round 1 and round 3 — read the current state, not just the
headline number.** Round 1 found a real shortfall. Round 2 was research
plus a caught false lead. **Round 3 found and fixed two real bugs — one in
the tracker, one in this project's own crude test land mask — and the
result improved from a jagged, no-robust-range failure to a smooth,
narrow, 6-hour-short-of-the-bar result**, on the one real event tested so
far. Full evidence, plots, and reasoning are in
`phase-1-validation/README.md` — read that in full before deciding
anything. Short version:

**Round 1:** the real December 18, 2025 Mullaghmore event is genuinely and
hugely present in the fetched data (10.6m/13.5s peak, correctly timed), but
at the plan's own groundswell definition (period ≥12s) the longest track
held only 36h/1,814km — well under 72h/2,000km — and a fine period sweep
gave a jagged, non-monotonic result (78h→42h→36h→24h→42h), the plan's own
named signature of a knife-edge rather than a robust pass. The one
numerically-passing setting did so amid a chaotic field of ~25-30 other
simultaneous short tracks.

**Round 2:** researched how operational wave forecasting actually does
this. WAVEWATCH III partitions each grid point's spectrum into windsea + up
to 5 separate swell systems *first* (Hanson & Phillips 2001), then runs
dedicated spatial tracking on top — published work (arXiv:1812.06662)
confirms a single collapsed "dominant value per point" isn't coherent
enough to track alone. That validated trying Open-Meteo's secondary swell
field. Also caught and corrected a false lead: finer time resolution
looked like a big win (78h vs 36h) but was a measurement artifact from an
under-scaled match-distance tolerance bridging unrelated blips — corrected,
it actually got slightly worse (36h→18h→17h as resolution increased).

**Round 3 — the material change.** A re-fetch confirmed Open-Meteo does
support `secondary_swell_wave_*` for this model. Using it (multi-component
clustering instead of one dominant value per cell) alone brought the result
to a smoother, more consistent pattern (4/16, no longer wildly jagged) —
informative enough to keep digging rather than stop. That digging found two
concrete bugs:

1. **Tracker prediction bug.** Traced the actual huge, obviously-real
   cluster underlying the Dec 18 event (79→195 cells, growing then
   shrinking smoothly over 36+ hours) frame by frame. Clustering found it
   correctly every single frame. The *tracker* lost it: at one frame, the
   predicted position missed by 468km against a 450km match threshold,
   because the physics-based prediction assumed the cluster moves in the
   direction implied by the mean of every member cell's reported wave
   direction — which, for a large reshaping region, isn't the same thing as
   which way its centroid is actually drifting (observed: implied travel
   direction ~94° east; actual centroid motion that frame: due south). One
   bad prediction lost a 150+ cell cluster's identity outright. **Fixed:**
   the tracker now predicts from the track's own last two observed
   positions (standard practice in general object tracking) when
   available, not purely a physical assumption about where it "should" go.
2. **Land mask bug.** While tracing bug 1, found real open ocean west of
   Scotland (58°N,-9°W and 58°N,-8°W — directly in the path of a swell
   heading toward Ireland/Scotland) was wrongly masked as "land" by this
   project's own crude, hand-rolled test mask. Fixed with a better (still
   crude, still not for production) piecewise approximation. Checked
   whether this caused the remaining shortfall — it didn't, for this
   specific case (the real data shows the swell's measured period
   genuinely drops below 13s as it nears shore, a real physical signal) —
   but it was a real bug worth fixing regardless.

**Result after both fixes:** at the plan's own period≥12s definition, a
track starting mid-Atlantic at hour 132 moves consistently northeast,
passing almost exactly through the real event's time and place (hour 168 ≈
Dec 18 00:00), and holds together for **66 continuous hours across
3,263km** — a real, geographically-sensible, single-ID story arriving right
when the actual event did. That's 6 hours short of the 72h bar,
*consistently* across all 8 period=13 parameter combinations (66h or 60h,
never wildly off) — not a knife-edge. Separately, a different, legitimate
long-lived system clears the bar outright at 90h/3,611km under a looser
(still swept) setting.

**The actual decision now, per the plan's own "escalate, don't decide
unilaterally" instruction:** this no longer reads as "the mechanic doesn't
work." It reads as "the mechanic works, and there's a real but narrow gap
between one specific parameter setting's result (66h) and a round-number
bar (72h) that the plan chose without claiming it was physically exact,
tested against exactly one real event." Is that close enough to proceed,
worth one more real test event to see if 66h-vs-72h is typical or unlucky,
or worth loosening the bar itself? That's not a code question — it's yours.

## What's been built: `phase-1-validation/`

A throwaway validation harness (script-based, not a notebook — same
throwaway spirit) implementing the plan's §4.5 clustering/tracking
algorithm and §8 Phase −1 test procedure end-to-end:

- Region-growing clustering with direction/period tolerance + energy floor,
  operating on multiple simultaneous wave components per cell (swell,
  wind-sea, secondary swell) rather than one collapsed "dominant" value
- Position-predicted tracking (not naive nearest-centroid, which the plan
  explicitly warns breaks on the ~500km/6h jumps real groundswell makes) —
  predicts from the track's own observed velocity once it has one, falling
  back to a group-velocity/direction physical estimate for brand-new
  tracks — with missed-frame tolerance and merge/split lineage
- A 16-combination parameter sweep (period threshold, energy floor, angular
  tolerance, min cluster size) — the plan requires sweeping, not hand-picking
- GIF + centroid-path visualization for the required "blind read" test
- A real-data fetcher, a temporal-smoothing preprocessor, and a diagnostic
  script, all added along the way as bugs surfaced (see below)

It first ran on synthetic data (proved the code logically correct, not the
product assumption — see `phase-1-validation/README.md` for that history),
then on real data once two unrelated bugs were found and fixed:

1. **This sandbox has no internet access.** Confirmed by direct test —
   `open-meteo.com`, `noaa.gov`, `google.com` all reject with 403 (org
   policy). A user fetched real data on their own Mac and handed the JSON
   back via git instead.
2. **The first real fetch came back 100% null** (every value, every cell,
   both windows). Root cause: the fetcher passed `models=era5_ocean`, an
   invalid model slug for this endpoint — the API returned HTTP 200 with
   `hourly_units:"undefined"` and silently null-filled arrays, no error.
   Fixed by dropping the `models` param entirely; the API auto-selects
   forecast vs. archive data by date range on its own.

Both are fixed and were not the cause of the current result — the second
real fetch came back ~91% non-null and the December 2025 event is clearly
present in it. The shortfall described above is a real clustering/tracking
result, not a leftover data problem.

## If you want to pursue next steps yourself

**Secondary swell data is already in use** (Round 3, done) — no need to
re-fetch for that specifically. If you want to test a **second real event**
(the most useful next diagnostic, per the "is 66h typical or unlucky"
question above), add a new window to `WINDOWS` in `fetch_real_data.py` and
fetch it the same way, on a machine with real internet access:

```bash
cd phase-1-validation
python3 fetch_real_data.py --window <your-new-window-name>
```

Watch for the `probe:` line near the start — confirms secondary swell
support (already known to work for this model, but worth re-confirming if
anything about the request changes). Hand back the resulting `raw_*.json`
(gitignored, so `git add -f` it or send directly), then:

```bash
python3 run_validation.py --real raw_clean.json raw_messy.json
```

No extra flag needed — `real_data.py` automatically includes secondary
swell as a separate clusterable candidate per cell if the fetch got it.

## Other open items from the master plan discussion (lower priority than Phase −1)

These came up during planning but are **not blocking** — do not act on them
before the Phase −1 escalation above is resolved:

- **Open-Meteo call-volume budget**: a rough estimate (done via search,
  not verified against the primary pricing page — this environment's
  network block prevented fetching it directly) suggested the $29/month
  Standard plan (1M calls/month) is plausible at 6-hourly refresh with
  6-8 variables, but tight-to-over-budget at 3-hourly refresh or 12+
  variables. Re-verify against Open-Meteo's actual pricing page once
  network access exists, and decide the refresh cadence explicitly rather
  than defaulting to the more expensive option.
- **Brand name** (§12.1): still deferred, correctly. Nothing here changes
  that.
- **Print fulfillment partner** (§12.3): still unselected, correctly, this
  far out.

## File map

```
phase-1-validation/
  README.md              full technical status and the actual evidence -- read this in full
  physics.py              haversine, bearing, great-circle interpolation, Cg=1.56T
  grid.py                 N. Atlantic ocean grid + crude land mask (synthetic-test only,
                           NOT for production -- see file header)
  synthetic.py             synthetic clean/messy swell field generator (code-logic validation)
  clustering.py            §4.5 region-growing clustering
  tracking.py              §4.5 tracking + lineage; predicts from observed velocity when available (Round 3 fix)
  sweep.py                 16-combination parameter sweep + pass-criteria checks
  visualize.py             GIF + centroid-path plots
  smoothing.py             temporal smoothing preprocessing -- tried, didn't help, kept for the record
  fetch_real_data.py       real-data fetcher (run OUTSIDE this sandbox); probes for secondary swell support
  real_data.py             converts fetched real data into the pipeline's frame format; multi-component per cell
  diagnose_api.sh          isolates Open-Meteo request-parameter issues
  run_validation.py        CLI entry point -- synthetic (default) or --real, optional --smooth
  output/                  current artifacts -- Round 3 REAL DATA result (2/16 but smooth/near-pass, see above)
  raw_clean.json           real fetched data, Dec 11-24 2025, incl. secondary swell (gitignored, local after fetch)
  raw_messy.json           real fetched data, Sep 8-21 2025, incl. secondary swell (gitignored, local after fetch)
```
