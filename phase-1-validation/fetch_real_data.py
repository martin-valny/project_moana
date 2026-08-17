"""Fetch real historical marine data for the Phase -1 test windows.

NOT RUNNABLE IN THIS SANDBOX: this environment's network egress policy is
default-deny for general internet hosts, confirmed by direct test --
open-meteo.com, noaa.gov, and even google.com all reject at the proxy with
403 (org policy, not a transient error). Only PyPI/npm-class registries are
allowlisted here. Run this script somewhere with normal internet access
(your machine, a CI job, a Claude Code environment configured with a more
permissive network policy), then hand the resulting raw_<window>.json files
back for the clustering/tracking pipeline to consume in place of synthetic.py.

Uses Open-Meteo's Marine Weather API historical/archive mode (era5_ocean
model), per master plan §4.1/§4.3. Grid and variables match grid.py.

  pip install requests
  python3 fetch_real_data.py --window clean   # Dec 11-24 2025, Mullaghmore
  python3 fetch_real_data.py --window messy    # a quiet shoulder-season week

Before trusting the "messy" window, sanity-check it against the raw
significant-wave-height time series once fetched (per the master plan's own
guidance) rather than assuming a news-quiet fortnight is data-quiet.
"""
import argparse
import json
import time

from grid import build_grid

BASE_URL = "https://marine-api.open-meteo.com/v1/marine"
VARIABLES = [
    "swell_wave_height", "swell_wave_direction", "swell_wave_period",
    "wind_wave_height", "wind_wave_direction", "wind_wave_period",
]

WINDOWS = {
    "clean": ("2025-12-11", "2025-12-24"),   # brackets the Dec 18 2025
                                              # Mullaghmore swell -- see the
                                              # master plan discussion; verify
                                              # ERA5 has finalized this period
                                              # (usually ~3 month lag) before
                                              # relying on it.
    "messy": ("2025-09-08", "2025-09-21"),   # shoulder-season candidate --
                                              # UNVERIFIED. Pull it, plot
                                              # significant wave height, and
                                              # confirm by eye there's no
                                              # single dominant long-period
                                              # system before treating this
                                              # as the messy window. Swap the
                                              # dates here if it turns out
                                              # not to be messy.
}


def fetch_cell(session, lat, lon, start_date, end_date, retries=3):
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(VARIABLES),
        "models": "era5_ocean",
        "cell_selection": "sea",
    }
    for attempt in range(retries):
        resp = session.get(BASE_URL, params=params, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        time.sleep(2 ** attempt)
    resp.raise_for_status()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--window", choices=WINDOWS.keys(), required=True)
    parser.add_argument("--out", default=None)
    parser.add_argument("--batch-sleep", type=float, default=0.2,
                         help="seconds between requests, be polite to the API")
    args = parser.parse_args()

    import requests
    start_date, end_date = WINDOWS[args.window]
    cells, _ = build_grid()
    out_path = args.out or f"raw_{args.window}.json"

    session = requests.Session()
    raw = {"window": args.window, "start_date": start_date, "end_date": end_date, "cells": {}}
    for i, (lat, lon) in enumerate(cells):
        print(f"[{i+1}/{len(cells)}] fetching ({lat}, {lon})...")
        try:
            data = fetch_cell(session, lat, lon, start_date, end_date)
            raw["cells"][f"{lat},{lon}"] = data.get("hourly", {})
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(args.batch_sleep)

    with open(out_path, "w") as f:
        json.dump(raw, f)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
