# Phase -1 clustering validation

Implements the master plan's §8 Phase -1: validate that swell clustering
produces satisfying, discrete, persistent characters *before* building
anything else. Deliverable is throwaway code, per the plan -- a script
here rather than a notebook, but the same "no app code, no shaders" spirit.

## Status: code validated on synthetic data. Real data not yet run.

**This environment cannot reach the internet.** Direct test confirmed
`open-meteo.com`, `noaa.gov`, and even `google.com` all reject at this
session's network proxy with 403 (organization policy, not a transient
failure -- see `/root/.ccr/README.md`). Only package registries (PyPI, npm)
are allowlisted. So the actual Phase -1 test -- real ERA5/Open-Meteo data
for a real North Atlantic winter -- has not run yet. What's here instead:

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
   data via Open-Meteo's archive/era5_ocean mode, and an adapter
   (`real_data.py`) that turns its output into the same frame format the
   synthetic generator produces -- so the whole pipeline is a drop-in swap
   once real data exists.

**What this does and doesn't prove:** it proves the clustering/tracking
*code* is logically correct and behaves sensibly under conditions designed
to be hard (large per-frame jumps relative to cluster radius, two systems
close enough in space to risk merging, several concurrent systems that
must stay distinct). It does **not** prove the product assumption -- that
holds only once this runs against real ERA5 data for the two required
windows and clears the plan's actual pass bar. Treat the results below as
"the mechanism works when the physics is realistic," not as Phase -1
itself passing.

## How to get real data flowing

Pick one:
- Run `fetch_real_data.py` somewhere with normal internet access (your
  machine, CI, a Claude Code environment with a permissive network
  policy), then hand back `raw_clean.json` / `raw_messy.json`.
- Grant this environment broader egress and re-run from here.

Then: `python3 run_validation.py --real raw_clean.json raw_messy.json`

## Results so far (synthetic data)

```
16/16 parameter combinations passed both criteria (100%)
```

Per-combination detail in `output/sweep_results.json`. Notes:

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

## Real-data test windows (research, not yet run)

- **Clean:** Dec 11-24, 2025, bracketing the December 18, 2025 Mullaghmore
  Head (Ireland) swell -- widely reported as the largest in ~5 years at
  that break. ERA5 should have finalized this period by now (~3 month lag).
- **Messy:** Sep 8-21, 2025 shoulder-season fortnight -- **unverified
  placeholder**. Per the plan's own guidance, verify this by plotting the
  raw significant wave height once fetched rather than by searching news
  for an absence of events; swap the dates in `fetch_real_data.py` if it
  turns out not to be messy.

## Files

| File | Purpose |
|---|---|
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
