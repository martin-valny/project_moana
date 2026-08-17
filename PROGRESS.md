# Project Moana — Progress Report

Last updated: 2026-08-17, branch `claude/moana-master-build-plan-v2-zjs07y`.

This file exists so a new agent picking up this repo cold can tell the user
exactly what to run next without re-deriving context. Read this before doing
anything else in this repo.

## Where the project stands

The repo holds the "Master Build Plan v2" for Moana (an internal codename —
see the plan's §12.1 for why no public branding exists yet). The plan's
own rule: **do not build Phase 0 app code before Phase −1 passes.** Phase −1
tests the single assumption the whole product depends on — that real
marine forecast data clusters into discrete, trackable, nameable "swell"
objects rather than a fuzzy continuous field. That test has **not passed
yet**, because it hasn't run against real data. This is the current,
only, and blocking priority. Nothing else in the plan should be started
before it does.

## What's been built: `phase-1-validation/`

A throwaway validation harness (script-based, not a notebook — same
throwaway spirit) implementing the plan's §4.5 clustering/tracking
algorithm and §8 Phase −1 test procedure:

- Region-growing clustering with direction/period tolerance + energy floor
- Group-velocity-projected tracking (not naive nearest-centroid, which the
  plan explicitly warns breaks on the ~500km/6h jumps real groundswell
  makes) with 1-2 missed-frame tolerance and merge/split lineage
- A 16-combination parameter sweep (period threshold, energy floor, angular
  tolerance, min cluster size) — the plan requires sweeping, not hand-picking
- GIF + centroid-path visualization for the required "blind read" test

**It has only been run against synthetic data**, because this session's
sandbox cannot reach the internet — confirmed by direct test:
`open-meteo.com`, `noaa.gov`, and `google.com` all reject at the network
proxy with 403 (org policy, not transient). The synthetic run (16/16
parameter combinations passing) proves the *code* is logically correct. It
proves **nothing about the actual product assumption** — that only happens
once this runs against real ERA5/Open-Meteo data for the two required test
windows. Do not report Phase −1 as passed based on the synthetic result.
See `phase-1-validation/README.md` for full technical detail, including a
bug that was caught and fixed along the way (an early version of the
synthetic generator made the messy scenario pass trivially by producing
almost no detectable clusters at all — recalibrated to force genuine
simultaneity).

## Exactly what to run next

**Step 1 — fetch real data.** Run this somewhere with actual internet
access (your own machine, a CI job, or a Claude Code environment configured
with a permissive network policy — NOT a fresh session in this same kind of
sandboxed environment unless its network policy is confirmed open first):

```bash
git clone <this repo>
cd project_moana
git checkout claude/moana-master-build-plan-v2-zjs07y
cd phase-1-validation
pip install requests
python3 fetch_real_data.py --window clean    # Dec 11-24 2025
python3 fetch_real_data.py --window messy    # Sep 8-21 2025 -- UNVERIFIED, see below
```

This produces `raw_clean.json` and `raw_messy.json` (gitignored — hand them
back rather than expecting them in the repo).

**Step 2 — validate the messy window before trusting it.** The "messy"
date range (Sep 8-21, 2025) is an unverified placeholder — picked as a
generic shoulder-season fortnight, not confirmed quiet. Before running the
actual test, plot the raw significant wave height from `raw_messy.json` and
eyeball it: mixed short-period trains with no single dominant long-period
system is what "messy" needs to mean. If it turns out to have a dominant
system after all, pick a different two-week window and re-fetch. Do not
skip this check — the plan is explicit that verifying this from data beats
guessing from news silence.

**Step 3 — run the actual Phase −1 test:**

```bash
python3 run_validation.py --real raw_clean.json raw_messy.json
```

This prints the same 16-combination sweep pass/fail table the synthetic run
did, against real data this time, and regenerates the GIFs/centroid plots
in `output/`.

**Step 4 — apply the plan's actual pass criteria (§8), by hand, to the
real-data output:**
- Clean window: at least one cluster holds a stable ID for 72+ hours and
  travels 2,000+ km. (`run_validation.py` checks this automatically and
  reports it — but read the centroid-path plot yourself too.)
- Messy window: no more than ~5 simultaneous clusters in a typical frame.
- Robustness: a *range* of the 16 parameter settings should pass, not one
  knife-edge combination. Universal 16/16 passing is *also* worth a second
  look (per this session's own experience with synthetic data producing a
  vacuous pass) — check the messy window actually shows real multi-cluster
  moments, not just near-empty frames.
- **Blind read test:** show the clean-window GIF, unlabelled, to someone
  who doesn't already know the answer. Time them. If they can't say "how
  many distinct things are moving, and follow one across frames" within
  about 30 seconds, that's a real signal, not a formality.

**Step 5 — report back honestly.** If it passes: Phase −1 is genuinely
clear, and Phase 0 (visual-only prototype, per §8) can start. If it fails:
read the plan's failure-mode table (fragmentation / blob-merge / ID
flicker / genuine merge-split) and the fallback option (pivot from
"adopt a system" to "adopt an arrival" — track energy building at a
specific coastline instead of a whole moving system). That pivot decision
is explicitly flagged in the plan as something to escalate to the user
rather than decide unilaterally — don't make that call solo.

## Other open items from the master plan discussion (lower priority than Phase −1)

These came up during planning but are **not blocking** — do not act on them
before Phase −1 clears:

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
  README.md              full technical status, more detail than this file
  physics.py              haversine, bearing, great-circle interpolation, Cg=1.56T
  grid.py                 N. Atlantic ocean grid + crude land mask (synthetic-test only,
                           NOT for production -- see file header)
  synthetic.py             synthetic clean/messy swell field generator
  clustering.py            §4.5 region-growing clustering
  tracking.py              §4.5 group-velocity-projected tracking + lineage
  sweep.py                 16-combination parameter sweep + pass-criteria checks
  visualize.py             GIF + centroid-path plots
  fetch_real_data.py       real-data fetcher (run OUTSIDE this sandbox -- see above)
  real_data.py             converts fetched real data into the pipeline's frame format
  run_validation.py        CLI entry point -- synthetic (default) or --real
  output/                  generated artifacts (currently synthetic-data results only)
```
