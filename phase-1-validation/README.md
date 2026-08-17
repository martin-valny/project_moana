# Phase -1 clustering validation

Implements the master plan's §8 Phase -1: validate that swell clustering
produces satisfying, discrete, persistent characters *before* building
anything else. Deliverable is throwaway code, per the plan -- a script
here rather than a notebook, but the same "no app code, no shaders" spirit.

## Status: much closer after fixing two real bugs. Still short of a clean pass -- your call on whether it's close enough.

**Read this section before doing anything else with this repo.** Three
rounds of real-data testing happened. Round 1 found a genuine shortfall.
Round 2 (research + a ruled-out false lead) pointed at the data model.
**Round 3 found and fixed two real bugs in the tracker and in this
project's own crude test land mask** -- not in the underlying physics or
the plan's approach -- and the result changed materially: from a jagged,
knife-edge 2/16 with a chaotic 25-30-track visual, to a smooth, consistent
result where the plan's own period definition (≥12s) now holds a real,
geographically-sensible track (heading from mid-Atlantic toward Ireland,
arriving right around the actual Dec 18 event) for **66h across 3,263km**
-- short of the 72h bar, but by 6 hours, consistently, not by a wild
margin. A looser (but still swept) parameter setting holds a different,
independently-legitimate long-lived system for **90h across 3,611km**,
clearing the bar outright. Per §8's own instruction ("Escalate this
decision rather than deciding it unilaterally"), whether "66h, consistently,
6h short" counts as close enough to proceed is your call, not an agent's --
see the Round 3 section below for the full picture before deciding. Do not
start Phase 0 until that decision is made.

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
specific case.

The messy window (Sep 8-21, 2025, still unverified as genuinely
representative) showed ~0 persistent clusters at every tested setting,
including the loosest one -- trivially "passes" the ≤5 ceiling, but so
trivially that it doesn't really stress-test "keep several systems
separate" the way the criterion intends. Worth a second messy window too.

### Round 2 investigation: what the literature says, and two more ruled-out fixes

Prompted by "shouldn't this be trackable? go find how others do it." Two
findings, one of them a caught false lead -- included here because it's a
useful example of not trusting a first result:

- **How operational forecasting actually does this.** WAVEWATCH III doesn't
  track a single "dominant value per grid point." It partitions each
  point's full spectrum into windsea + up to 5 separate swell systems first
  (Hanson & Phillips 2001), and only *then* runs a dedicated spatial
  tracking algorithm across grid points and time -- because, per published
  work on exactly this ("Spatially Tracking Wave Events in Partitioned
  Numerical Wave Model Outputs," arXiv:1812.06662), partition labels alone
  don't preserve spatial/temporal coherence without additional processing.
  That's an independent, academic confirmation of the exact instability
  seen here. It directly validates trying Open-Meteo's secondary/tertiary
  swell fields (§4.1) instead of collapsing each cell to one value.
- **False lead, caught and corrected: does finer time resolution help?**
  First pass looked like a huge win -- 78h at 1-hour steps vs. 36h at
  6-hour steps, at the plan's own period threshold. It wasn't real. The
  tracker's match-distance tolerance (450km) was calibrated for 6-hour
  steps; at 1-hour steps, real expected displacement is ~10x smaller, so
  the same fixed tolerance was loose enough to bridge essentially unrelated
  nearby blips into a falsely "continuous" track (net displacement was
  3,386km against a *reported* cumulative path of 8,146km -- and the track
  wandered from 50°N down to 20°N, the grid's edge, nothing like a
  swell heading toward Ireland). Rerun with the match tolerance properly
  scaled to each timestep: **36h → 18h → 17h as resolution goes from 6h to
  1h** -- finer sampling alone doesn't help and mildly hurts. Confirms the
  problem is the data model, not the sampling cadence.
- **Tried: splitting swell vs. wind-sea into independent clusterable
  candidates per cell** (instead of picking whichever has higher energy),
  as a first step toward the partitioning approach above --
  implemented in `clustering.py`/`real_data.py` now. On the data already in
  hand (no secondary swell field yet), this alone was a wash to mildly
  worse (60h vs. 78h at the loosest threshold) -- unsurprising in
  hindsight: separating swell from wind-sea without also separating
  *coexisting swell trains* just adds more competing candidate points to
  the same graph. The real test of the partitioning hypothesis needs actual
  secondary-swell data, which the original fetch didn't request.
  `fetch_real_data.py` now probes for `secondary_swell_wave_*` and
  includes it if the API supports it (gracefully drops it otherwise,
  learning from the `models=era5_ocean` failure -- see Bug 1 below). A
  fresh fetch with this is the next concrete step, not yet run.

### Round 3: secondary swell data, and two real bugs found and fixed

A user re-fetched with the updated script; `secondary_swell_wave_*` **is**
supported by this model (122,160/134,736 non-null, same coverage as
primary). Running it through the multi-component pipeline gave 4/16 --
better than the original 2/16, and for the first time the degradation
across the period-threshold sweep was *smooth* (96→90→78→78h passing at
period=11/floor=20; a consistent 54-60h band failing at floor=40; 30-48h at
period=13) instead of jagged. That was itself informative enough to keep
investigating rather than stop at "4/16, still not robust."

**Bug found: the tracker's position prediction was actively wrong for large
clusters.** Traced the actual huge, obviously-real cluster underlying the
Dec 18 event (79→118→137→159→180→195→164 cells across hours 150-186,
clearly one coherent, growing-then-shrinking system by any visual
inspection) through the tracker frame by frame. Clustering found it
correctly every single frame. The *tracker* lost it: at hour 180, the
predicted position was 468km from the actual cluster centroid -- 18km over
the 450km match threshold -- because the physics-based prediction assumed
the cluster would move in the direction implied by the energy-weighted mean
of every member cell's reported wave direction (274° round trip that frame,
implying near-due-east travel), while the cluster's actual centroid had
moved almost due *south* between the two frames. A large region-grown
blob's centroid motion reflects how its boundary reshapes (cells joining on
one edge, aging out on another as period/energy cross the threshold
locally) as much as it reflects bulk wave propagation -- these aren't
guaranteed to point the same way. One bad prediction was enough to
permanently lose a 150+ cell cluster's ID; a fresh ID picked it up next
frame and the "story" restarted from zero.

**Fix:** `tracking.py`'s `_predict_position` now extrapolates from the
track's own last two observed centroid fixes (standard practice in general
object tracking) when available, falling back to the physics-based
group-velocity estimate only for a brand-new track with no observed
velocity yet. This is not the "naive nearest-centroid" matching the plan
warns against (which predicts zero movement) -- it uses the track's own
recently observed velocity instead of an external physical assumption that
turned out not to hold for large, reshaping clusters.

**Bug found, second: this project's own crude land mask was wrong exactly
where it mattered.** While tracing the fix above, `(58,-9)` and `(58,-8)` --
real open ocean west of Scotland, in the path of a swell heading toward
Ireland/Scotland -- turned out to be masked as "land" by `grid.py`'s
original flat `lon >= -9 and lat <= 61` rule. Refined to a piecewise
approximation that recedes east with latitude (still crude, still not for
production -- see the file). Checked whether this was the cause of the
remaining shortfall: it wasn't, for this specific case (the real swell
period at that location genuinely drops from 13.8s to 12.1s hour to hour as
it nears shore, a legitimate physical/data signal, not a masking artifact)
-- but it was a real bug worth fixing regardless, and may matter for other
events or the messy window.

**Result after both fixes, at the plan's own period_threshold≥12s
definition:** a track starting mid-Atlantic (46.6°N,-46.1°W) at hour 132
moves consistently northeast -- 49.9°N,-36.9°W → 52.1°N,-27.7°W →
50.4°N,-20.5°W (hour 168, almost exactly the real Dec 18 00:00 event time)
→ 56.3°N,-13.6°W -- for **66 continuous hours across 3,263km**, ending as
its measured period drops below 13s approaching the coast. That's a
real, geographically-sensible, single-ID story arriving right when the
actual event did. It's 6 hours short of the plan's 72h bar, consistently
across all 8 period=13 parameter combinations (66h or 60h, never wildly
off) -- not a knife-edge anymore. Separately, at period_threshold=11, a
different (broader, likely storm-center-associated rather than
forward-radiating-groundswell) system tracks cleanly for **90h across
3,611km**, clearing the bar outright, at 2 of the 4 period=11/floor=20
combinations (the other 2, at looser angular tolerance, hold a shorter
72h/1,987km version of the same or a different track).

**Net read:** this no longer looks like "the mechanic doesn't work." It
looks like "the mechanic works and the remaining gap is a parameter/
definition question" -- is a 6-hour, consistent shortfall against a
72-hour bar that was itself a chosen round number, on n=1 real event, reason
to keep tuning, loosen the bar, or call it close enough? That's a real
judgment call, not something further code changes alone resolve -- see
`PROGRESS.md` for the concrete options.

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

## Results: real data (current -- Round 3, with secondary swell + both bug fixes)

```
2/16 parameter combinations passed both criteria (12%) -- but see the Round 3
section above: the numeric count alone undersells what changed. The failing
combinations now cluster smoothly in a 60-66h band (period=13, the plan's
own definition) instead of swinging wildly 24-78h, and one real, visually
coherent, geographically-sensible track (mid-Atlantic to near Ireland,
arriving right at the real event's timing) holds for 66h/3,263km -- 6h short
of the bar, consistently, not by knife-edge luck. A different legitimate
system clears the bar outright at 90h/3,611km under a looser (still swept)
setting.
```

`output/sweep_results.json`, `output/clean_centroid_paths.png`,
`output/clean_clusters.gif`, `output/messy_centroid_paths.png`,
`output/messy_clusters.gif` all reflect this current run (Dec 11-24 2025
clean window, Sep 8-21 2025 messy window, multi-component clustering with
secondary swell data, fixed tracker prediction, fixed land mask). Earlier
rounds' numbers (2/16 pre-fix with a chaotic 25-30-track visual, 4/16 with
secondary swell but the tracker bug still present) are described in the
Round 2/3 narrative above rather than kept as separate output files --
`output/` holds only the current, most-informative state.

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
| `clustering.py` | §4.5 region-growing clustering; now operates over multiple simultaneous candidate systems per cell (swell/wind-sea/secondary-swell), not one collapsed value |
| `tracking.py` | §4.5 group-velocity-projected tracking with lineage |
| `sweep.py` | parameter sweep + pass-criteria evaluation |
| `visualize.py` | GIF + centroid-path plots |
| `fetch_real_data.py` | real Open-Meteo historical marine data fetcher (not runnable in this sandbox); probes for secondary swell component support before the full fetch |
| `real_data.py` | converts fetched real data into the pipeline's frame format; emits a record per available wave component per cell, not just the dominant one |
| `run_validation.py` | CLI entry point, synthetic or real |
| `test_event.py` | tests a single real event against the clean-window bar alone, no paired messy window needed -- used for Round 4's additional events |
| `output/` | generated artifacts |
