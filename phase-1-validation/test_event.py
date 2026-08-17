"""Test a single real "clean"-type event window against the plan's §8
clean-window pass criteria (72h+ continuous track, 2000km+), without
needing a paired messy window each time. For checking whether Round 3's
66h/3,263km result on the Dec 2025 event is typical or a one-off.

Usage:
  python3 test_event.py raw_clean2_ireland_nov2023.json
  python3 test_event.py raw_clean3_nazare_feb2024.json --out output_nazare2024
"""
import argparse
import json

from real_data import load_raw_to_frames
from sweep import PARAM_GRID, run_scenario, evaluate_clean
from visualize import run_and_plot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("raw_json")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    frames = load_raw_to_frames(args.raw_json)
    label = args.raw_json.replace("raw_", "").replace(".json", "")
    out_dir = args.out or f"output_{label}"
    import os
    os.makedirs(out_dir, exist_ok=True)

    print(f"=== Testing event: {args.raw_json} ({len(frames)} frames) ===\n")

    rows = []
    for params in PARAM_GRID:
        result = run_scenario("event", params, frames=frames)
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

    with open(f"{out_dir}/sweep_results.json", "w") as f:
        json.dump({"source": args.raw_json, "n_passed": n_pass, "n_combinations": len(rows), "rows": rows}, f, indent=2)

    representative = rows[0]["params"]
    gif = run_and_plot("event", frames, representative, out_dir)
    print(f"\nwrote {gif} and {out_dir}/event_centroid_paths.png")


if __name__ == "__main__":
    main()
