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
Untried next steps that could still change the picture, roughly in order
of how promising they seem:
1. Fetch Open-Meteo's secondary/tertiary swell components (mentioned in
   the plan's §4.1) and cluster on separated wave trains instead of one
   dominant component per cell — the current implementation collapses each
   grid cell to a single "biggest" component, which may be discarding the
   actual coherent long-period signal in favor of locally louder
   short-period noise at many points.
2. Cluster in period-direction space rather than filtering geographically
   first — the plan's own §8 suggestion, though originally aimed at the
   *merge* failure mode rather than this one.
3. Test a second real event (different season, different storm track) to
   see if this is a property of this one event or a general pattern.
4. If none of that changes the picture: the plan's own documented fallback
   is to pivot from adopting a *system* to adopting an *arrival* — track
   energy building at a specific coastline instead of a whole moving
   system. Less romantic, more tractable, preserves most of the emotional
   payoff. This is the option the plan explicitly says to escalate rather
   than decide alone.

**What you (or a next agent, on your explicit instruction) might do next**
is any of #1-3 above as further diagnosis, or a direct conversation about
whether #4 is warranted already. Don't default to #4 without at least
trying #1, which is the most likely to actually be the fix — but that's a
recommendation, not a decision made on your behalf.

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

**Fetch more real data** (for a second test event, or anything else) —
same process as before, on a machine with real internet access:

```bash
cd phase-1-validation
python3 fetch_real_data.py --window clean   # or add a new window to WINDOWS in the script
```

Hand back the resulting `raw_*.json` (gitignored, so `git add -f` it or
send directly), then:

```bash
python3 run_validation.py --real raw_clean.json raw_messy.json
```

**To try secondary/tertiary swell components** (next-step #1 above):
`real_data.py`'s `load_raw_to_frames()` currently picks whichever of
`{swell, wind_wave}` has higher H²T per cell. Open-Meteo's marine API can
return secondary/tertiary swell component variables on some models (per
plan §4.1) — `fetch_real_data.py` doesn't request them yet. This would be
new fetcher variables plus a change to how `real_data.py` picks/separates
components, then a re-run of the same pipeline.

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
