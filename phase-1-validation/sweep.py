"""Parameter sweep + pass-criteria evaluation, per master plan §8 Phase -1.

Deliberately does NOT hand-pick thresholds: sweeps period_threshold,
energy_floor, angular_tolerance, and min_cluster_size across 16 combinations,
and checks whether a *range* of settings passes -- a single knife-edge
combination that works is itself a failure signal per the plan.
"""
import itertools
import json

from clustering import cluster_frame
from synthetic import generate_frames
from tracking import Tracker

PERIOD_THRESHOLDS = [11.0, 13.0]
ENERGY_FLOORS = [20.0, 40.0]
ANGULAR_TOLERANCES = [30.0, 50.0]
MIN_CLUSTER_SIZES = [3, 5]

PARAM_GRID = [
    dict(period_threshold=pt, energy_floor=ef, angular_tolerance=at, min_cluster_size=mc)
    for pt, ef, at, mc in itertools.product(
        PERIOD_THRESHOLDS, ENERGY_FLOORS, ANGULAR_TOLERANCES, MIN_CLUSTER_SIZES
    )
]


def run_scenario(scenario, params, frames=None):
    frames = frames if frames is not None else generate_frames(scenario)
    tracker = Tracker()
    clusters_per_frame = []
    for frame in frames:
        clusters = cluster_frame(
            frame["cells"],
            period_threshold=params["period_threshold"],
            energy_floor=params["energy_floor"],
            angular_tolerance=params["angular_tolerance"],
            period_tolerance=3.0,
            min_cluster_size=params["min_cluster_size"],
        )
        clusters_per_frame.append(clusters)
        tracker.step(frame["hours"], clusters)
    active, ended = tracker.finalize(frames[-1]["hours"])
    all_tracks = active + ended
    return {
        "params": params,
        "clusters_per_frame": clusters_per_frame,
        "tracks": all_tracks,
        "frames": frames,
    }


def evaluate_clean(result):
    best = None
    for t in result["tracks"]:
        dur, dist = t.duration_hours(), t.path_length_km()
        if best is None or dur > best[0]:
            best = (dur, dist)
    passed = any(t.duration_hours() >= 72 and t.path_length_km() >= 2000 for t in result["tracks"])
    return {"passed": passed, "best_duration_h": best[0] if best else 0, "best_dist_km": best[1] if best else 0}


def evaluate_messy(result):
    max_simultaneous = max((len(c) for c in result["clusters_per_frame"]), default=0)
    passed = max_simultaneous <= 5
    return {"passed": passed, "max_simultaneous_clusters": max_simultaneous}


def run_sweep():
    clean_frames = generate_frames("clean")
    messy_frames = generate_frames("messy")

    rows = []
    for params in PARAM_GRID:
        clean_result = run_scenario("clean", params, frames=clean_frames)
        messy_result = run_scenario("messy", params, frames=messy_frames)
        clean_eval = evaluate_clean(clean_result)
        messy_eval = evaluate_messy(messy_result)
        rows.append({
            "params": params,
            "clean": clean_eval,
            "messy": messy_eval,
            "both_passed": clean_eval["passed"] and messy_eval["passed"],
        })

    n_pass = sum(r["both_passed"] for r in rows)
    summary = {
        "n_combinations": len(rows),
        "n_passed_both": n_pass,
        "pass_rate": n_pass / len(rows),
        "rows": rows,
    }
    return summary


if __name__ == "__main__":
    summary = run_sweep()
    print(f"{summary['n_passed_both']}/{summary['n_combinations']} parameter combinations passed both criteria "
          f"({summary['pass_rate']*100:.0f}%)\n")
    header = f"{'period':>7} {'floor':>6} {'angtol':>7} {'minsz':>6} | {'clean_dur_h':>11} {'clean_km':>9} {'clean_ok':>9} | {'max_simul':>9} {'messy_ok':>9} | both"
    print(header)
    for r in summary["rows"]:
        p = r["params"]
        c, m = r["clean"], r["messy"]
        print(f"{p['period_threshold']:>7} {p['energy_floor']:>6} {p['angular_tolerance']:>7} "
              f"{p['min_cluster_size']:>6} | {c['best_duration_h']:>11.0f} {c['best_dist_km']:>9.0f} "
              f"{str(c['passed']):>9} | {m['max_simultaneous_clusters']:>9} {str(m['passed']):>9} | "
              f"{r['both_passed']}")

    with open("output/sweep_results.json", "w") as f:
        json.dump({
            "n_combinations": summary["n_combinations"],
            "n_passed_both": summary["n_passed_both"],
            "pass_rate": summary["pass_rate"],
            "rows": [
                {"params": r["params"], "clean": r["clean"], "messy": r["messy"], "both_passed": r["both_passed"]}
                for r in summary["rows"]
            ],
        }, f, indent=2)
