"""Entry point: runs the full Phase -1 validation (parameter sweep + GIFs +
centroid paths) and prints a pass/fail readout against the master plan's
§8 criteria.

Usage:
  python3 run_validation.py                      # synthetic data (default)
  python3 run_validation.py --real raw_clean.json raw_messy.json
"""
import argparse
import json

from sweep import run_sweep, run_scenario, evaluate_clean, evaluate_messy, PARAM_GRID
from visualize import run_and_plot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", nargs=2, metavar=("CLEAN_JSON", "MESSY_JSON"), default=None,
                         help="use real data (from fetch_real_data.py + real_data.py) instead of synthetic")
    parser.add_argument("--out", default="output")
    args = parser.parse_args()

    if args.real:
        from real_data import load_raw_to_frames
        clean_frames = load_raw_to_frames(args.real[0])
        messy_frames = load_raw_to_frames(args.real[1])
        source = "REAL DATA"
    else:
        from synthetic import generate_frames
        clean_frames = generate_frames("clean")
        messy_frames = generate_frames("messy")
        source = "SYNTHETIC DATA (code-logic validation only -- see README)"

    print(f"=== Phase -1 validation: {source} ===\n")

    rows = []
    for params in PARAM_GRID:
        clean_result = run_scenario("clean", params, frames=clean_frames)
        messy_result = run_scenario("messy", params, frames=messy_frames)
        clean_eval = evaluate_clean(clean_result)
        messy_eval = evaluate_messy(messy_result)
        rows.append({"params": params, "clean": clean_eval, "messy": messy_eval,
                      "both_passed": clean_eval["passed"] and messy_eval["passed"]})

    n_pass = sum(r["both_passed"] for r in rows)
    print(f"{n_pass}/{len(rows)} parameter combinations passed both criteria "
          f"({100*n_pass/len(rows):.0f}%)")
    if n_pass == 0:
        print("FAIL: no parameter setting passed. See §8 failure-mode guidance.")
    elif n_pass == len(rows):
        print("Passed at every swept setting -- per the plan, treat universal passing as "
              "worth a second look too (make sure the messy scenario has genuine ambiguity).")
    else:
        print("Passed on a subset of settings -- inspect which parameters separate pass from fail.")

    with open(f"{args.out}/sweep_results.json", "w") as f:
        json.dump({"source": source, "n_passed_both": n_pass, "n_combinations": len(rows), "rows": rows}, f, indent=2)

    representative = rows[0]["params"]
    for scenario, frames in (("clean", clean_frames), ("messy", messy_frames)):
        gif = run_and_plot(scenario, frames, representative, args.out)
        print(f"\n{scenario}: wrote {gif} and {scenario}_centroid_paths.png")
        print("-> Now do the blind read test from §8: show the GIF unlabelled to someone "
              "and ask 'how many distinct things are moving, and can you follow one across?'")


if __name__ == "__main__":
    main()
