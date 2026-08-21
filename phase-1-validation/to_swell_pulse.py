"""Thread B of the pre-Phase-1 ingestion spike (see PROGRESS.md "What's
next" -> Thread B): convert a real tracked swell system into the
`SwellPulse` shape `phase-0-prototype/src/data/types.ts` defines, so it can
be dropped into the globe shader the same way `helena.ts` is -- a real
`Track` from `tracking.py`, run against real, already-fetched Open-Meteo
data, instead of hand-placed waypoints.

This is deliberately NOT a generic library: it hardcodes the one track this
spike is about (the best-passing run against `raw_clean.json`, the Dec 2025
Mullaghmore event, at the plan's own validated period_threshold=11 setting)
rather than building a general Track->SwellPulse converter for tracks that
haven't been picked yet.

Usage:
  python3 to_swell_pulse.py > ../phase-0-prototype/src/data/realTrackPulse.json
"""
import json

from clustering import cluster_frame
from real_data import load_raw_to_frames
from tracking import Tracker

RAW_JSON = "raw_clean.json"

# The one param combination from test_event.py's sweep that passed the
# clean-window bar (72h+ / 2000km+) at the plan's validated period
# threshold of 11s: 90h / 3619km. (period=11 / floor=20 / angtol=30 / minsz=3
# and minsz=5 tie on this data -- 3 is used here, the more permissive of the
# two, matching evaluate_clean's own "best by duration" tie-break.)
PARAMS = dict(period_threshold=11.0, energy_floor=20.0, angular_tolerance=30.0, min_cluster_size=3)


def run_and_record(frames):
    """Same loop as sweep.run_scenario, but also records each track's
    per-frame (period, direction, energy, cell-count) history -- Track
    itself only keeps the latest snapshot of those fields plus a bare
    (hour, lat, lon) path, which loses exactly the per-point detail a
    SwellPathPoint needs."""
    tracker = Tracker()
    history = {}  # track id -> list of (hour, lat, lon, period, direction, energy, n_cells)
    for frame in frames:
        clusters = cluster_frame(
            frame["cells"],
            period_threshold=PARAMS["period_threshold"],
            energy_floor=PARAMS["energy_floor"],
            angular_tolerance=PARAMS["angular_tolerance"],
            period_tolerance=3.0,
            min_cluster_size=PARAMS["min_cluster_size"],
        )
        tracker.step(frame["hours"], clusters)
        for t in tracker.active:
            if t.last_seen_hour == frame["hours"]:
                history.setdefault(t.id, []).append((
                    frame["hours"], t.centroid[0], t.centroid[1],
                    t.mean_period, t.mean_direction, t.total_energy, len(t.cells),
                ))
    active, ended = tracker.finalize(frames[-1]["hours"])
    return active + ended, history


def main():
    frames = load_raw_to_frames(RAW_JSON)
    with open(RAW_JSON) as f:
        times = next(iter(json.load(f)["cells"].values()))["time"]

    tracks, history = run_and_record(frames)
    best = max(tracks, key=lambda t: t.duration_hours())
    points = history[best.id]

    path = []
    for hour, lat, lon, period, direction_from, total_energy, n_cells in points:
        energy_per_cell = total_energy / n_cells  # H^2*T proxy for one representative cell, not the whole cluster
        height = (energy_per_cell / period) ** 0.5
        path.append({
            "timestamp": f"{times[hour]}:00Z",
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "energy": round(energy_per_cell, 3),
            "swell_height": round(height, 3),
            "swell_period": round(period, 3),
            # direction_from -> heading_deg is the same reciprocal-bearing
            # convention helena.ts and physics.py's direction_to_vector use.
            "heading_deg": round((direction_from + 180) % 360, 1),
        })

    pulse = {
        "id": "mullaghmore-dec2025-spike",
        "name": "Track " + str(best.id),
        "first_detected_at": path[0]["timestamp"],
        "ended_at": path[-1]["timestamp"],
        "parent_id": None,
        "origin_basin": "north_atlantic",
        "category": "groundswell",
        "path": path,
        "narrative_description": (
            f"Real North Atlantic groundswell tracked from Open-Meteo Marine "
            f"API data ({RAW_JSON}, {best.duration_hours():.0f}h, "
            f"{best.path_length_km():.0f}km), period_threshold=11 -- "
            f"Thread B of the pre-Phase-1 ingestion spike, not invented data."
        ),
    }

    print(json.dumps(pulse, indent=2))

    import sys
    print(
        f"track {best.id}: {len(path)} points, {best.duration_hours():.0f}h, "
        f"{best.path_length_km():.0f}km, period {min(p['swell_period'] for p in path):.1f}-"
        f"{max(p['swell_period'] for p in path):.1f}s, height {min(p['swell_height'] for p in path):.2f}-"
        f"{max(p['swell_height'] for p in path):.2f}m",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
