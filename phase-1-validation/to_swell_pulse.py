"""Thread B of the pre-Phase-1 ingestion spike (see PROGRESS.md "What's
next" -> Thread B): convert a real tracked swell system into the
`SwellPulse` shape `phase-0-prototype/src/data/types.ts` defines, so it can
be dropped into the globe shader the same way `helena.ts` is -- a real
`Track` from `tracking.py`, run against real, already-fetched Open-Meteo
data, instead of hand-placed waypoints.

Originally hardcoded to the one track round "10." was about (`raw_clean.json`,
Dec 2025 Mullaghmore). Generalised in round "12." to take any of the real
windows in this directory, so the energy-range fix in `swellSources.ts`
could be QC'd against more than the one track it was built against -- still
not a general-purpose library beyond this repo's five real windows, since
the id/name/basin per file is a short hardcoded table, not inferred.

Usage:
  python3 to_swell_pulse.py [raw_json] > pulse.json
  python3 to_swell_pulse.py raw_clean2_ireland_nov2023.json > ../phase-0-prototype/src/data/realTrackPulse2.json
"""
import json
import sys

from clustering import cluster_frame
from real_data import load_raw_to_frames
from tracking import Tracker

# label / origin_basin per real window, for the pulse's id/name/narrative.
# origin_basin for raw_pacific_2024 is north_pacific: Phase -1's own README
# describes it as the real July 2024 New Zealand -> California event, and a
# North Pacific / South Pacific crossing is conventionally named for the
# hemisphere its *origin* sits in (south of the equator here), but the
# invented `kaimana` source in swellSources.ts already claims south_pacific
# for that exact real corridor -- north_pacific here keeps the two distinct
# rather than colliding on the same enum value.
WINDOW_INFO = {
    "raw_clean.json": ("mullaghmore-dec2025", "Dec 2025 Mullaghmore", "north_atlantic"),
    "raw_clean2_ireland_nov2023.json": ("ireland-nov2023", "Nov 2023 Ireland", "north_atlantic"),
    "raw_clean3_nazare_feb2024.json": ("nazare-feb2024", "Feb 2024 Nazare", "north_atlantic"),
    "raw_clean4_nazare_jan2025.json": ("nazare-jan2025", "Jan 2025 Nazare", "north_atlantic"),
    "raw_pacific_2024.json": ("pacific-jul2024", "Jul 2024 Pacific crossing", "north_pacific"),
    "raw_messy.json": ("messy-window", "Messy quiet window", "north_atlantic"),
}

RAW_JSON = sys.argv[1] if len(sys.argv) > 1 else "raw_clean.json"

# The one param combination from test_event.py's sweep that passed the
# clean-window bar (72h+ / 2000km+) at the plan's validated period
# threshold of 11s across every real clean/eventful window tested so far
# (period=11 / floor=20 / angtol=30 / minsz=3; minsz=5 ties on every window
# checked -- 3 is used here, the more permissive of the two, matching
# evaluate_clean's own "best by duration" tie-break).
PARAMS = dict(period_threshold=11.0, energy_floor=20.0, angular_tolerance=30.0, min_cluster_size=3)


def run_and_record(frames, neighbor_fn=None):
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
            neighbor_fn=neighbor_fn,
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


def _neighbor_fn_for(raw_json):
    """The North Atlantic events all use grid.py's default adjacency
    (cluster_frame's own default). The Pacific crossing spans the date line
    and both hemispheres, which grid.py's fixed North Atlantic index can't
    resolve -- test_pacific_event.py already established it needs
    pacific_grid.py's neighbor_fn instead."""
    if raw_json == "raw_pacific_2024.json":
        from pacific_grid import build_grid, neighbors_of
        cells, index_of = build_grid()
        return lambda cell: neighbors_of(cell, index_of)
    return None


def main():
    slug, label, basin = WINDOW_INFO[RAW_JSON]
    frames = load_raw_to_frames(RAW_JSON)
    with open(RAW_JSON) as f:
        times = next(iter(json.load(f)["cells"].values()))["time"]

    tracks, history = run_and_record(frames, neighbor_fn=_neighbor_fn_for(RAW_JSON))
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
        "id": f"{slug}-spike",
        "name": f"{label} (Track {best.id})",
        "first_detected_at": path[0]["timestamp"],
        "ended_at": path[-1]["timestamp"],
        "parent_id": None,
        "origin_basin": basin,
        "category": "groundswell",
        "path": path,
        "narrative_description": (
            f"Real groundswell tracked from Open-Meteo Marine API data "
            f"({RAW_JSON}, {label}, {best.duration_hours():.0f}h, "
            f"{best.path_length_km():.0f}km), period_threshold=11 -- "
            f"ingestion spike QC, not invented data."
        ),
    }

    print(json.dumps(pulse, indent=2))

    print(
        f"track {best.id}: {len(path)} points, {best.duration_hours():.0f}h, "
        f"{best.path_length_km():.0f}km, period {min(p['swell_period'] for p in path):.1f}-"
        f"{max(p['swell_period'] for p in path):.1f}s, height {min(p['swell_height'] for p in path):.2f}-"
        f"{max(p['swell_height'] for p in path):.2f}m",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
