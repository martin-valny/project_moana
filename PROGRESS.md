# Project Moana — Progress Report

Last updated: 2026-08-17, branch `claude/moana-master-build-plan-v2-zjs07y`.

This file exists so a new agent picking up this repo cold can tell the user
exactly what's happened and what decision is needed next, without
re-deriving context. Read this before doing anything else in this repo.

**The full plan this file references by section number (§4.5, §8, etc.) is
`MASTER_BUILD_PLAN.md` at the repo root.** Read that file too; this one
assumes it as background.

## Where the project stands — READ THIS FIRST

**Phase −1 has now run against real data, and the result does not robustly
pass.** This is not a code bug, not a data-fetch bug (both of those
happened first, on the way here, and were found and fixed — see below) —
it's a real, if still preliminary (n=1 test event), signal that the
current clustering approach doesn't reliably hold a single swell system
together for 72+ hours the way the plan's central assumption requires.

Per the plan's own §8 instruction — *"Escalate this decision rather than
deciding it unilaterally"* — **this needs your decision, not another
agent's unilateral pivot.** Do not start Phase 0 app code until you've
decided how to proceed. Full technical detail and the actual evidence
(numbers, a chaotic centroid-path plot, ruled-out fixes) is in
`phase-1-validation/README.md`'s status section — read that in full before
deciding. Short version:

- The real December 18, 2025 Mullaghmore event is genuinely and hugely
  present in the fetched data (10.6m/13.5s peak, correctly timed). The
  pipeline found it fine.
- But at the plan's own groundswell definition (period ≥12s), the longest
  continuous track only held for 36h across 1,814km — well under the
  required 72h/2,000km.
- A fine sweep of the period threshold gives a jagged, non-monotonic result
  (78h → 42h → 36h → 24h → 42h as threshold moves from 11.0 to 13.0) — the
  plan's own named signature of a knife-edge, not a robust pass.
- The one parameter combination that does numerically pass only does so
  amid a chaotic field of ~25-30 other simultaneous short-lived tracks —
  see `phase-1-validation/output/clean_centroid_paths.png` directly. A
  human looking at that would not see "one clear thing to follow."
- Two of the plan's own suggested fixes were tried and didn't help:
  temporal smoothing (§8's listed fix for "fragmentation") made it
  neutral-to-worse; loosening the tracker's missed-frame tolerance made
  zero difference.

**This is one real test event.** It's a real signal, not a proven verdict.

**Round 2 (this session, same day):** researched how operational wave
forecasting actually does this. WAVEWATCH III doesn't track a single
"dominant value per grid point" — it partitions each point's spectrum into
windsea + up to 5 separate swell systems first (Hanson & Phillips 2001),
then runs dedicated spatial tracking on top, because (per published work,
arXiv:1812.06662) a single collapsed value per point isn't spatially/
temporally coherent enough to track alone. That's independent confirmation
of the exact instability found above, and directly validates trying
Open-Meteo's secondary swell field. Two more things tested:

- **Finer time resolution — looked like a big win, wasn't.** First test
  showed 78h at 1-hour steps vs. 36h at 6-hour steps. Turned out to be a
  measurement artifact: the tracker's match-distance tolerance was still
  calibrated for 6-hour steps, so at 1-hour steps it was loose enough to
  bridge unrelated nearby blips into a fake "continuous" track (net
  displacement 3,386km vs. a claimed cumulative path of 8,146km, wandering
  from 50°N down to the grid's southern edge — nothing like the real
  event). With the tolerance properly scaled to each timestep: 36h → 18h →
  17h as resolution increases. Finer sampling alone doesn't help.
- **Split swell vs. wind-sea into independent candidates per cell**
  (instead of picking whichever has higher energy) — implemented in
  `clustering.py`/`real_data.py`. On the data already in hand, this alone
  was a wash to mildly worse. Expected, in hindsight: separating swell
  from wind-sea without also separating *coexisting swell trains* just
  adds more candidates to the same graph. `fetch_real_data.py` now probes
  for and requests `secondary_swell_wave_*` if the API supports it — the
  real test of the partitioning hypothesis, not yet run.

**Next step, concretely:** re-run the fetch (same commands as before) with
the updated `fetch_real_data.py` — it'll print whether the API actually
supports secondary swell data for this model, and if so, `run_validation.py
--real` will automatically use it (no flag needed, `real_data.py` picks it
up if present). If that still doesn't produce a robust pass, the remaining
options are (a) cluster in period-direction space rather than filtering
geographically first (plan's own §8 suggestion, originally aimed at a
different failure mode), (b) test a second real event to see if this is
event-specific, or (c) the plan's own documented fallback: pivot from
adopting a *system* to adopting an *arrival* (track energy building at one
coastline instead of a whole moving system) — the option the plan
explicitly says to escalate rather than decide alone. Don't jump to (c)
without trying the secondary-swell re-fetch first; that's still the most
promising untried lever.

## What's been built: `phase-1-validation/`

A throwaway validation harness (script-based, not a notebook — same
throwaway spirit) implementing the plan's §4.5 clustering/tracking
algorithm and §8 Phase −1 test procedure end-to-end:

- Region-growing clustering with direction/period tolerance + energy floor
- Group-velocity-projected tracking (not naive nearest-centroid, which the
  plan explicitly warns breaks on the ~500km/6h jumps real groundswell
  makes) with missed-frame tolerance and merge/split lineage
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

**Re-fetch real data with secondary swell support** (the current top
priority next step) — same process as before, on a machine with real
internet access:

```bash
cd phase-1-validation
python3 fetch_real_data.py --window clean
python3 fetch_real_data.py --window messy
```

Watch for the `probe:` lines near the start of each run — they'll say
either `secondary swell component available, requesting: [...]` or
`dropping unsupported variables`. Either way it's informative. Hand back
the resulting `raw_*.json` (gitignored, so `git add -f` it or send
directly), then:

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
  tracking.py              §4.5 group-velocity-projected tracking + lineage
  sweep.py                 16-combination parameter sweep + pass-criteria checks
  visualize.py             GIF + centroid-path plots
  smoothing.py             temporal smoothing preprocessing -- tried, didn't help, kept for the record
  fetch_real_data.py       real-data fetcher (run OUTSIDE this sandbox)
  real_data.py             converts fetched real data into the pipeline's frame format
  diagnose_api.sh          isolates Open-Meteo request-parameter issues
  run_validation.py        CLI entry point -- synthetic (default) or --real, optional --smooth
  output/                  current artifacts -- REAL DATA result (2/16, see above), not synthetic
  raw_clean.json           real fetched data, Dec 11-24 2025 (gitignored, present locally after fetch)
  raw_messy.json           real fetched data, Sep 8-21 2025 (gitignored, present locally after fetch)
```
