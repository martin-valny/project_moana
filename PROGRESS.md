# Project Moana — Progress Report

Last updated: 2026-08-17, branch `claude/moana-master-build-plan-v2-zjs07y`.

This file exists so a new agent picking up this repo cold can tell the user
exactly what's happened and what decision is needed next, without
re-deriving context. Read this before doing anything else in this repo.

**The full plan this file references by section number (§4.5, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file too; this one
assumes it as background.

## Where the project stands — READ THIS FIRST

**Phase −1 has now run against FOUR real events across two coasts and two
winters. The finding is clear and specific: the clustering/tracking
mechanism works — every single event (4/4) produces a real, coherent,
multi-day trackable system — but the plan's exact "period ≥12s" groundswell
threshold is one second tighter than real events consistently need. At
period≥11, 3 of 4 events clear the 72h/2,000km bar outright across every
swept setting, and the 4th misses by 0.6% on distance alone.** That's the
headline. Everything below is how the investigation got there (five
rounds, two real bugs found and fixed, several false leads caught and
corrected) — read it for the evidence, but the decision this file exists to
surface is: **is loosening the groundswell definition from 12s to ~11s an
acceptable fix, or does 12s reflect a requirement that shouldn't move?**
See "Round 4 result" below for the full 4-event table before deciding.
Full technical detail for the original Dec 2025 event specifically is in
`phase-1-validation/README.md`.

**History (round 1 → 3, single-event basis, before the 4-event picture
below existed):**

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

## Round 4, in progress: three more real events, to answer "is 66h typical or unlucky?"

User asked for three more real events to test, directly following from the
question Round 3 raised. Three were researched and added to `WINDOWS` in
`fetch_real_data.py` -- different storms, different seasons, one different
target coast (Portugal instead of Ireland), across two winters:

- `clean2_ireland_nov2023` (2023-11-02 to 2023-11-15): brackets Nov 9, 2023,
  Conor Maguire's widely-covered "swell of the decade" session at
  Mullaghmore -- same coast as the Round 1-3 event, different storm/year.
- `clean3_nazare_feb2024` (2024-02-18 to 2024-03-02): brackets Feb 24, 2024,
  the giant Nazaré swell where Sebastian Steudtner rode a wave measured at
  28.57m. Different target coast (Portugal).
- `clean4_nazare_jan2025` (2025-01-22 to 2025-02-04): brackets Jan 25-30,
  2025, Storm Herminia, Nazaré, waves reported over 20m. Different storm,
  same coast as the one above.

A new script, `test_event.py`, runs the 16-combination sweep against a
single fetched event and evaluates it against the clean-window bar (72h+/
2000km+) without needing a paired messy window -- sanity-checked against
the already-known Dec 2025 result (reproduces 2/16, 66h/3,263km at
period=13, exactly as before) before being used for anything new.

**Not yet fetched — this environment still has no internet access**, same
as every previous round. Fetch on a machine with real internet access:

```bash
cd phase-1-validation
python3 fetch_real_data.py --window clean2_ireland_nov2023
python3 fetch_real_data.py --window clean3_nazare_feb2024
python3 fetch_real_data.py --window clean4_nazare_jan2025
```

Each writes its own `raw_<window>.json` (the `--window` name is used as the
output filename stem automatically). Hand all three back (gitignored, so
`git add -f raw_clean2_ireland_nov2023.json raw_clean3_nazare_feb2024.json
raw_clean4_nazare_jan2025.json` or send directly), then test each one:

```bash
python3 test_event.py raw_clean2_ireland_nov2023.json
python3 test_event.py raw_clean3_nazare_feb2024.json
python3 test_event.py raw_clean4_nazare_jan2025.json
```

Each prints its own 16-row pass table and writes `output_<name>/` with a
GIF and centroid-path plot, same format as the original Dec 2025 test.

## Round 4 result — all three fetched and tested. This is the clearest finding yet.

```
event                        n_pass/16   p=11,floor=20 (4 combos)      p=13 range (h)
Dec 2025 (Mullaghmore)        2/16       90h,90h,72h,72h  (2/4 miss on distance, 1987km vs 2000km bar -- a 0.6% miss)
Nov 2023 (Mullaghmore)        5/16       96h,90h,90h,90h  (4/4 pass)
Feb 2024 (Nazaré)             8/16       132h,120h,132h,120h (4/4 pass)
Jan 2025 (Nazaré)             8/16       114h,72h,120h,72h (4/4 pass)
```

**At the plan's own period≥12s definition (tested via period_threshold=13,
the closest swept value): 0 of 4 real events pass.** Durations range 24h
(Nov 2023, worst case) to 66h (Dec 2025, best case) — always short, by a
real and varying margin, never close to a coincidence.

**At period_threshold=11 (one second below the plan's definition), energy_floor=20:
3 of 4 events pass all four angular-tolerance/min-cluster-size combinations
outright** (90-132h, comfortably clearing 72h, several with 3,000-5,800km).
**The 4th (Dec 2025) misses on only 2 of 4 combinations, and only on the
distance criterion — 1,987km against the 2,000km bar, a 0.6% miss** with
duration (72h) exactly at the bar.

**This directly answers Round 3's open question, and reframes it.** The
66h/3,263km Dec 2025 result wasn't unlucky — if anything it was the
*strongest* of the four events at the strict period≥12 threshold (60-66h vs
24-60h for Nov 2023, ~42h for both Nazaré events). What's actually
happening: **the clustering/tracking mechanism is sound and consistently
finds a real, coherent, multi-day, thousands-of-km trackable system in
every single real event tested (4 for 4) — the plan's specific "period ≥12s"
cutoff for what counts as a trackable groundswell is the actual limiting
factor, not the algorithm.** A one-second adjustment to that threshold (11s
instead of 12s, still very much "long-period groundswell" physically, not
a stretch to call it that) turns "0/4 events pass" into "essentially 4/4
events pass," with the exact code already in this repo — no further
tracking or clustering changes needed to test this claim.

**This is a real decision, not a coding task:** is loosening the
groundswell definition from 12s to 11s (or wherever the real cutoff turns
out to be after a touch more testing) an acceptable adjustment to make, or
does the plan's 12s threshold reflect a hard product/narrative requirement
("groundswell" specifically, not "long-period swell generally") that
shouldn't move? That's yours to weigh, not something to decide unilaterally
-- but the evidence now points at a specific, small, well-targeted fix
rather than "the mechanic doesn't work" or "needs a fundamentally different
approach."

## Round 5, also in progress: does this scale to real-time, whole-ocean tracking?

User asked whether the mechanism works at the scale of scanning all oceans
in real time, not just one basin. Split into what's a compute/cost question
(answered without new data) and what's a genuine data-and-topology question
(needs a real test):

**Compute and cost -- fine, worked out from what's already known.**
Clustering is near-linear in cell count (global ~7,500 cells vs. the ~450
tested is a 15x jump, still sub-second per frame). Tracking's Hungarian
assignment scales with concurrent track count, not grid size -- trivial
even at 50-100 simultaneous global systems. "Real time" in the plan's own
architecture (§4.3) already means a batch job every 3-6h, matching how
often the underlying wave models refresh anyway, not literal streaming.
Re-costed the API budget with the now-9 variables (secondary swell added in
Round 3) at global scale, 6-hourly refresh: ~463K calls/month, still under
half the $29/month Standard plan's 1M cap.

**What was actually untested, and what's been done about it:**

1. **Land masking.** The hand-rolled North Atlantic box (`grid.py`) took
   real bug-hunting to get right for one basin (see Round 3) and was never
   going to generalize. Replaced, for global/regional testing, with the
   `global-land-mask` PyPI package -- real (Natural Earth-derived),
   vectorized, computes the whole global grid in ~1ms, and correctly
   resolves the exact west-of-Scotland bug found by hand in Round 3
   without any manual boxes. New file: `global_grid.py`. `grid.py` itself
   is untouched -- the already-validated North Atlantic results stay
   reproducible on it exactly as before.
2. **International date line wraparound -- a real bug, found and fixed.**
   `grid.py`'s adjacency never needed to handle lon=180/-180 (the North
   Atlantic box doesn't touch it). It doesn't wrap: a cell at lon=178 and
   one at lon=-178 are neighbors on the real globe (2 degrees apart) but
   were never connected. Confirmed this actually breaks tracking with a
   synthetic test (`test_dateline.py`): a swell crossing the seam split
   into two separate track IDs and lost 36h of continuity (180h with the
   fix vs. 144h/split-into-two without it). Fixed in `global_grid.py`'s
   neighbor lookup (wraps correctly) and in `clustering.py`'s cluster
   centroid longitude averaging (a plain arithmetic mean of 179 and -179
   gives 0, not ±180 -- switched to a circular mean, the same fix
   already used for wave direction). `clustering.py`/`sweep.py`/
   `visualize.py` also got a `neighbor_fn` parameter so a different grid
   can be plugged in without touching the validated North Atlantic path
   (confirmed no regression: North Atlantic real-data result unchanged,
   2/16, same durations, only floating-point-level centroid differences
   from the more correct longitude averaging).
3. **Pole-adjacent grid density -- flagged, not fixed.** On a fixed-degree
   grid, one longitude step is ~334km at the equator but only ~69km at
   78°N/S. Tracking itself is latitude-independent (works in real km via
   haversine throughout), but clustering granularity (what a "3-cell
   cluster" physically represents) isn't consistent across latitudes.
   Not fixed -- would mean a reduced/variable-resolution grid, real scope
   creep beyond what was asked. Worth knowing before someone tunes global
   parameters.
4. **The big one: does tracking hold together over a REAL long-distance,
   cross-hemisphere, date-line-crossing event, not just a synthetic one?**
   Set up a test for the "7,000-mile swell" of July 2024 -- a real, widely
   covered event (Surfline "7,000-Mile Swell Kicks Off July"): a storm off
   New Zealand's Chatham Islands on Jul 8, 2024 generated 20s-period
   groundswell that hit Tahiti Jul 10-11 (Code Red conditions at
   Teahupo'o), Hawaii the following week, then California -- ~10,000km,
   crossing both the equator and the date line, over ~2 weeks. New files:
   `pacific_grid.py` (a ~1,200-cell region spanning New Zealand to
   California, using the real land mask + date-line-aware adjacency) and
   `test_pacific_event.py`. Smoke-tested the whole pipeline (fetch ->
   cluster -> track -> plot) against a synthetic version of this exact
   geometry first -- got a single continuous 114h/9,838km track crossing
   both the seam and the equator cleanly -- before trusting it enough to
   ask for real data.

**Not yet fetched -- same reason as every other round, no internet here,
and this one is bigger** (~1,200 cells vs. ~400, so noticeably slower):

```bash
cd phase-1-validation
python3 -m pip install global-land-mask   # new dependency, needed for --grid pacific
python3 fetch_real_data.py --window pacific_2024 --grid pacific
```

Hand back `raw_pacific_2024.json` (gitignored, `git add -f` it or send
directly), then:

```bash
python3 test_pacific_event.py raw_pacific_2024.json
```

Prints the same 16-row pass table as the other event tests, plus a
centroid-path plot worth looking at directly for whether the track
visually crosses the date line (around lon 180 in the plot, which uses a
shifted 0-360 longitude convention so the region doesn't render split
across both edges) and the equator (lat 0) in one continuous piece, the
way the synthetic smoke test did.

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
  clustering.py            §4.5 region-growing clustering; accepts neighbor_fn to use a different grid (Round 5)
  tracking.py              §4.5 tracking + lineage; predicts from observed velocity when available (Round 3 fix)
  sweep.py                 16-combination parameter sweep + pass-criteria checks
  visualize.py             GIF + centroid-path plots; accepts neighbor_fn/all_cells/lon_transform (Round 5)
  smoothing.py             temporal smoothing preprocessing -- tried, didn't help, kept for the record
  fetch_real_data.py       real-data fetcher (run OUTSIDE this sandbox); probes for secondary swell; --grid pacific
  real_data.py             converts fetched real data into the pipeline's frame format; multi-component per cell
  diagnose_api.sh          isolates Open-Meteo request-parameter issues
  run_validation.py        CLI entry point -- synthetic (default) or --real, optional --smooth
  test_event.py            tests one real North-Atlantic-grid event alone (Round 4)
  global_grid.py           real global ocean grid (global-land-mask package) + date-line-aware adjacency (Round 5)
  pacific_grid.py          NZ-to-California test region, real mask + date-line adjacency (Round 5)
  test_dateline.py         synthetic date-line-crossing test -- found + verified the wraparound bug (Round 5)
  test_pacific_event.py    tests the real July 2024 "7,000-mile swell" event (Round 5, not yet fetched)
  output/                  current artifacts -- Round 3 North Atlantic REAL DATA result (2/16, near-pass, see above)
  output_pacific_2024/     Pacific event results once fetched and tested (Round 5, doesn't exist yet)
  raw_clean.json           real fetched data, Dec 11-24 2025, incl. secondary swell (gitignored, local after fetch)
  raw_messy.json           real fetched data, Sep 8-21 2025, incl. secondary swell (gitignored, local after fetch)
```
