# Phase -1 clustering validation

Implements the master plan's §8 Phase -1: validate that swell clustering
produces satisfying, discrete, persistent characters *before* building
anything else. Deliverable is throwaway code, per the plan -- a script
here rather than a notebook, but the same "no app code, no shaders" spirit.

## Status: REAL DATA HAS RUN. Result: does not robustly pass. Escalate before building Phase 0.

**Read this section before doing anything else with this repo.** The actual
Phase -1 test -- clustering/tracking against real marine data for the real
December 2025 North Atlantic groundswell -- has now run. It does not clear
the plan's own bar robustly. This is not a code bug and not a data-fetch
bug (both of those happened first and were fixed and ruled out -- see
below). Per §8's own instruction ("Escalate this decision rather than
deciding it unilaterally"), this needs the user's decision on how to
proceed, not a unilateral pivot. Do not start Phase 0 until that decision
is made.

### What the real clean-window data actually showed

The December 18, 2025 Mullaghmore event is genuinely, enormously present in
the data -- peak 10.6m / 13.5s at grid cell (58,-23) at 2025-12-18T00:00,
timed almost exactly with the widely-reported real-world event, and the
swell component (not wind-wave) dominates the energy budget throughout, so
component conflation isn't the issue. The pipeline correctly found it.

But tracking it as one coherent, followable system does not hold up:

- At the plan's **own stated groundswell definition** (period ≥12s, §4.4),
  the longest track achieved only **36h / 1,814km** -- well under the 72h /
  2,000km bar.
- A fine sweep of the period threshold (11.0 → 13.0 in 0.5 steps) gives
  **78h → 42h → 36h → 24h → 42h** -- non-monotonic and jagged, not a smooth
  degradation. That's the plan's own named failure signature: *"a result
  that works at exactly one setting is itself a failure signal."*
- The only combination that numerically passes (period_threshold=11,
  looser than the plan's own definition) does so **inside a visually
  chaotic field of ~25-30 other simultaneous short-lived tracks** --
  see `output/clean_centroid_paths.png`. One 78h track is technically
  there, but a human looking at this would not see "one thing to follow."
  That's a direct fail on the plan's own blind-read criterion, independent
  of the numeric threshold.
- Root cause, as best determined: real single-point swell period genuinely
  drifts by several seconds within under a day even during one storm's
  passage (classic dispersion -- long-period components outrun short-period
  ones), which is real ocean physics, not sensor noise or a data bug.
- Two of the plan's own suggested fixes were tried and ruled out:
  **temporal smoothing** (§8's listed fix for "fragmentation") made results
  neutral-to-worse, not better (`smoothing.py`, window=3 barely changed it,
  window=5 dropped to 0/16). **Increasing the tracker's missed-frame
  tolerance** (2 → 4 → 6) made zero difference -- the shortfall isn't a
  bridgeable gap, it's structural.

**Caveats on this result, honestly:** this is n=1 -- one real event, one
test window, one grid resolution, one land mask (a crude one, see `grid.py`).
It's not yet a general verdict on "swells don't cluster," only a real,
concrete signal against the current threshold-filtering approach on this
specific case. Untried options that could still change the picture: (a)
testing a second real event to see if this is a one-off or a pattern, (b)
clustering in period-direction space rather than filtering geographically
first (the plan's own §8 suggestion for the *merge* failure mode, not yet
applied here), (c) fetching Open-Meteo's secondary/tertiary swell
components to separate coexisting trains instead of collapsing each cell to
one dominant component, which this implementation currently does. None of
these have been tried yet -- they're the natural next steps, not a
conclusion that the mechanic is dead.

The messy window (Sep 8-21, 2025, still unverified as genuinely
representative) showed ~0 persistent clusters at every tested setting,
including the loosest one -- trivially "passes" the ≤5 ceiling, but so
trivially that it doesn't really stress-test "keep several systems
separate" the way the criterion intends. Worth a second messy window too.

### Path here: two bugs hit and fixed before reaching this result

**Bug 1 -- fetch returned 100% null values.** First real-data attempt came
back with *every single value, for every cell, for both windows* null.
Root cause, found via `diagnose_api.sh`: the fetcher passed
`models=era5_ocean`, not a valid model slug for this endpoint -- the API
returned HTTP 200 with `hourly_units` showing `"undefined"` and silent
null-filled arrays, no error. Fixed by dropping `models` entirely (the API
auto-selects forecast vs. archive data by date range). `fetch_real_data.py`
now also self-checks and warns loudly on an all-null result so this can't
go unnoticed again.

**Bug 2 -- this environment itself has no internet access.** Confirmed by
direct test: `open-meteo.com`, `noaa.gov`, even `google.com` all reject at
this session's network proxy with 403 (org policy). Real-data fetching has
to happen on a machine with actual internet access (it did, on a user's
Mac), with the resulting JSON files handed back via git.

What's here otherwise:

1. A synthetic swell-field generator (`synthetic.py`) standing in for real
   data, built to genuinely stress-test the algorithm: a fast-moving,
   realistic-group-velocity hero pulse crossing most of the basin (the
   "clean" case), an unrelated secondary pulse to check distinct systems
   don't get merged, wind-sea clutter, and -- in the "messy" case -- a mix
   of randomly-staggered short systems plus three deterministic,
   guaranteed-overlapping systems so simultaneity is actually exercised,
   not just hoped for by random seed luck.
2. The clustering (`clustering.py`) and tracking (`tracking.py`) algorithms
   from §4.5, implemented as specified: region-growing with direction/period
   tolerance, and group-velocity-projected-position matching (not naive
   nearest-centroid, which the plan explicitly calls out as the wrong
   approach) with 1-2 missed-frame tolerance and merge/split lineage.
3. A parameter sweep (`sweep.py`) across 16 combinations of period
   threshold, energy floor, angular tolerance, and minimum cluster size --
   per the plan's instruction not to hand-pick thresholds.
4. Visualization (`visualize.py`) -- per-frame scatter colored by track ID,
   stitched to GIF, plus centroid-path plots, for the blind-read test.
5. A ready-to-run fetcher (`fetch_real_data.py`) for real historical marine
   data, and an adapter (`real_data.py`) that turns its output into the same
   frame format the synthetic generator produces -- so the whole pipeline is
   a drop-in swap once real data exists.

**What this does and doesn't prove:** it proves the clustering/tracking
*code* is logically correct and behaves sensibly under conditions designed
to be hard (large per-frame jumps relative to cluster radius, two systems
close enough in space to risk merging, several concurrent systems that
must stay distinct). It does **not** prove the product assumption -- that
holds only once this runs against real ERA5 data for the two required
windows and clears the plan's actual pass bar. Treat the results below as
"the mechanism works when the physics is realistic," not as Phase -1
itself passing.

## How to get more real data flowing (for a second test event, or a redo)

Pick one:
- Run `fetch_real_data.py` somewhere with normal internet access (your
  machine, CI, a Claude Code environment with a permissive network policy),
  then hand back `raw_<window>.json`. The script prints a non-null value
  count and warns loudly if the fetch came back empty.
- Grant this environment broader egress and re-run from here.

Then: `python3 run_validation.py --real raw_clean.json raw_messy.json`
(optionally `--smooth N` to test temporal smoothing, though see above --
it didn't help on the one real window tested so far).

## Results: real data (current, see status section above for the read)

```
2/16 parameter combinations passed both criteria (12%) -- non-robust, see above
```

`output/sweep_results.json`, `output/clean_centroid_paths.png`,
`output/clean_clusters.gif`, `output/messy_centroid_paths.png`,
`output/messy_clusters.gif` all reflect this real-data run (Dec 11-24 2025
clean window, Sep 8-21 2025 messy window). `output/clean_centroid_paths.png`
in particular is worth opening directly -- it's the single clearest piece of
evidence, showing the chaotic multi-track field described above.

## Results: synthetic data (superseded by real data above -- kept for the code-logic record)

```
16/16 parameter combinations passed both criteria (100%)
```

This ran before real data was available and validates the clustering/
tracking *code*, not the product assumption -- see the real-data result
above for the actual Phase -1 read. Kept here because it's still useful
evidence the algorithm itself behaves correctly under controlled
conditions; the real-data shortfall is about real ocean data being messier
than the synthetic model assumed, not a bug in this code. The synthetic
`output/` files themselves have been overwritten by the real-data run above
-- re-run `python3 run_validation.py` (no `--real` flag) to regenerate them
if you want to see them again. Notes below are from that earlier run:

- **Clean scenario:** the hero pulse held one stable ID for 72-78h across
  ~5,300-5,600km at every swept parameter setting -- correctly surviving
  the ~470-540km per-6h-step jumps the plan warns naive nearest-centroid
  matching would break on. A physically-unrelated secondary pulse was
  never absorbed into it.
- **Messy scenario:** simultaneous cluster count varied meaningfully across
  parameter settings (0 to 4), never exceeding the plan's ≤5 ceiling, and
  correctly kept the three deliberately-overlapping, closely-spaced test
  systems as separate IDs rather than merging them (§4.5's "blob merge"
  failure mode).
- **16/16 passing is itself flagged, not just reported.** The plan warns
  that a single knife-edge combination passing is a failure signal; the
  same suspicion applies in reverse to *universal* passing on synthetic
  data, since it's easy to build synthetic clutter too mild to ever fail
  anything. First pass at the messy generator did exactly that (max
  simultaneous clusters was 0-1 almost everywhere) until it was recalibrated
  to include guaranteed-overlap systems -- see the comments in
  `_messy_blobs()` in `synthetic.py`. Real data doesn't have this problem
  by construction, which is another reason it's the thing that actually
  needs to run.
- `output/clean_centroid_paths.png` and `output/messy_centroid_paths.png`
  are worth a direct look. `output/*_clusters.gif` are the blind-read-test
  artifacts -- per the plan, show one to someone unlabelled and time
  whether they can follow a single thing across frames.

## Real-data test windows (used; see results above)

- **Clean:** Dec 11-24, 2025, bracketing the December 18, 2025 Mullaghmore
  Head (Ireland) swell -- widely reported as the largest in ~5 years at
  that break. Confirmed present in the fetched data: 10.6m/13.5s peak at
  (58,-23), 2025-12-18T00:00, matching the real-world event closely.
- **Messy:** Sep 8-21, 2025 shoulder-season fortnight -- still not
  independently verified as representative (only checked that it produces
  near-zero clusters, which is *consistent* with "quiet" but was never
  cross-checked by eye against the raw significant wave height per the
  plan's own guidance). A second, verified messy window would strengthen
  this result.

## Files

| File | Purpose |
|---|---|
| `diagnose_api.sh` | isolates Open-Meteo request-parameter issues (used to find the `models=era5_ocean` bug) |
| `smoothing.py` | temporal smoothing preprocessing, tried as the plan's §8 fragmentation fix -- didn't help, kept for the record |
| `physics.py` | haversine, bearing, great-circle interpolation, group velocity (Cg = 1.56T) |
| `grid.py` | North Atlantic ocean grid (20-65N, 80W-0, 2x3deg) with a **crude, hand-rolled** land mask -- fine for this synthetic test, not for production (§4.2 needs a real coastline dataset e.g. Natural Earth/GSHHG) |
| `synthetic.py` | synthetic "clean" and "messy" swell fields |
| `clustering.py` | §4.5 region-growing clustering |
| `tracking.py` | §4.5 group-velocity-projected tracking with lineage |
| `sweep.py` | parameter sweep + pass-criteria evaluation |
| `visualize.py` | GIF + centroid-path plots |
| `fetch_real_data.py` | real Open-Meteo historical marine data fetcher (not runnable in this sandbox) |
| `real_data.py` | converts fetched real data into the pipeline's frame format |
| `run_validation.py` | CLI entry point, synthetic or real |
| `output/` | generated artifacts |
