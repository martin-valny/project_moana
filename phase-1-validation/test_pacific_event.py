"""Test the "7,000-mile swell" (July 2024): storm off New Zealand's Chatham
Islands -> Tahiti (Code Red at Teahupo'o) -> Hawaii -> California, ~10,000km,
crossing both the equator and the international date line over ~2 weeks.

The real test of everything found/fixed for global scale in this session:
the real land mask (global-land-mask via pacific_grid.py), the date-line
wraparound fix (verified synthetically in test_dateline.py, now on real
data), and whether tracking holds together over a much longer real
distance/duration than the North Atlantic events tested so far.

Usage:
  python3 fetch_real_data.py --window pacific_2024 --grid pacific  # elsewhere, real internet
  python3 test_pacific_event.py raw_pacific_2024.json
"""
import argparse
import json

from pacific_grid import build_grid, neighbors_of
from real_data import load_raw_to_frames
from sweep import PARAM_GRID, run_scenario, evaluate_clean
from visualize import run_and_plot

CELLS, INDEX_OF = build_grid()


def _neighbor_fn(cell):
    return neighbors_of(cell, INDEX_OF)


def _lon_transform(lon):
    # Shift the -180..-109 segment to 180..251 so the plot doesn't split
    # the region across both edges at the date line.
    return lon if lon >= 0 else lon + 360


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("raw_json")
    parser.add_argument("--out", default="output_pacific_2024")
    args = parser.parse_args()

    frames = load_raw_to_frames(args.raw_json)
    print(f"=== Testing Pacific 2024 event: {args.raw_json} ({len(frames)} frames) ===\n")

    rows = []
    for params in PARAM_GRID:
        result = run_scenario("event", params, frames=frames, neighbor_fn=_neighbor_fn)
        ev = evaluate_clean(result)
        rows.append({"params": params, "eval": ev})

    n_pass = sum(r["eval"]["passed"] for r in rows)
    print(f"{n_pass}/{len(rows)} parameter combinations passed the clean-window bar "
          f"(72h+ / 2000km+) ({100*n_pass/len(rows):.0f}%)\n")
    header = f"{'period':>7} {'floor':>6} {'angtol':>7} {'minsz':>6} | {'dur_h':>6} {'dist_km':>8} {'pass':>6}"
    print(header)
    for r in rows:
        p, ev = r["params"], r["eval"]
        print(f"{p['period_threshold']:>7} {p['energy_floor']:>6} {p['angular_tolerance']:>7} "
              f"{p['min_cluster_size']:>6} | {ev['best_duration_h']:>6.0f} {ev['best_dist_km']:>8.0f} "
              f"{str(ev['passed']):>6}")

    import os
    os.makedirs(args.out, exist_ok=True)
    with open(f"{args.out}/sweep_results.json", "w") as f:
        json.dump({"source": args.raw_json, "n_passed": n_pass, "n_combinations": len(rows), "rows": rows}, f, indent=2)

    representative = rows[0]["params"]
    gif = run_and_plot("event", frames, representative, args.out,
                        neighbor_fn=_neighbor_fn, all_cells=CELLS, lon_transform=_lon_transform)
    print(f"\nwrote {gif} and {args.out}/event_centroid_paths.png")
    print("Check the centroid path plot for whether it crosses the seam (lon "
          "~180, shown here around x=180) and the equator (lat=0) in one piece.")


if __name__ == "__main__":
    main()
