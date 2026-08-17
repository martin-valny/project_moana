"""Synthetic test: does a swell tracked across the international date line
stay one continuous track, or does it fragment at the seam?

Nothing in the North Atlantic Phase -1 validation ever touched lon=180/-180,
so this was completely untested. Uses the real global grid (global_grid.py)
instead of the North Atlantic-only grid.py, and a single clean hero blob
(re-using synthetic.py's Blob physics) crossing the seam -- this is a grid-
topology test, not another clustering-robustness test, so no background
clutter is needed; that's already been stress-tested elsewhere.
"""
import math

from clustering import cluster_frame
from global_grid import build_grid, neighbors_of
from physics import haversine_km
from synthetic import Blob, STEP_HOURS, _cell_record
from tracking import Tracker

CELLS, INDEX_OF = build_grid()


def _neighbor_fn(cell):
    return neighbors_of(cell, INDEX_OF)


def generate_dateline_frames(total_days=10, seed=1):
    import random
    rng = random.Random(seed)

    hero = Blob(
        name="pacific_crosser",
        origin=(35.0, 145.0),   # off Japan
        target=(35.0, -140.0),  # toward the US west coast -- great-circle
                                  # path from here runs almost due east,
                                  # straight across lon=180/-180.
        period_s=14.0,
        height_peak_m=4.0,
        decay_per_hour=0.010,
        sigma_km=350,
        start_hour=0,
    )

    total_hours = total_days * 24
    steps = total_hours // STEP_HOURS
    frames = []
    for step in range(steps):
        hour = step * STEP_HOURS
        cell_records = {}
        for cell in CELLS:
            # light background clutter so clustering has a realistic floor
            if rng.random() < 0.1:
                p, h = rng.uniform(4, 9), rng.uniform(0.3, 1.2)
                cell_records[cell] = _cell_record(h, p, rng.uniform(0, 360))

        if hour > 0:
            hero.advance(hour)
        if hero.alive(hour):
            for cell in CELLS:
                d_km = haversine_km(hero.lat, hero.lon, cell[0], cell[1])
                if d_km > 3 * hero.sigma_km:
                    continue
                amp = math.exp(-0.5 * (d_km / hero.sigma_km) ** 2)
                h = hero.height * amp
                if h < 0.1:
                    continue
                candidate = _cell_record(h, hero.period_s, hero.direction_from_deg())
                if cell not in cell_records or candidate["energy"] > cell_records[cell]["energy"]:
                    cell_records[cell] = candidate

        frames.append({"t": step, "hours": hour, "cells": cell_records})
    return frames, hero


def main():
    frames, hero = generate_dateline_frames()
    print(f"hero blob: origin {hero.origin}, target (-140 via crossing 180), "
          f"period {hero.period_s}s, {len(frames)} frames over {len(frames)*STEP_HOURS}h")

    tracker = Tracker()
    crossed_seam = False
    for frame in frames:
        clusters = cluster_frame(
            frame["cells"], period_threshold=12.0, energy_floor=20.0,
            angular_tolerance=40.0, period_tolerance=3.0, min_cluster_size=3,
            neighbor_fn=_neighbor_fn,
        )
        tracker.step(frame["hours"], clusters)

    active, ended = tracker.active, tracker.ended
    best = max(active + ended, key=lambda t: t.duration_hours())
    print(f"\nlongest track: id={best.id} duration={best.duration_hours()}h "
          f"path_length={best.path_length_km():.0f}km n_points={len(best.path)}")
    print("path:")
    prev_lon = None
    for h, lat, lon in best.path:
        flag = ""
        if prev_lon is not None and abs(lon - prev_lon) > 90:
            flag = "  <-- crosses the seam here"
            crossed_seam = True
        print(f"  h={h:>4} lat={lat:6.1f} lon={lon:7.1f}{flag}")
        prev_lon = lon

    print()
    if crossed_seam and best.duration_hours() >= 72:
        print("PASS: a single track held together continuously across the "
              "international date line for 72h+.")
    elif crossed_seam:
        print(f"PARTIAL: track crossed the seam but only held for "
              f"{best.duration_hours()}h (< 72h).")
    else:
        print("FAIL: track never crossed the seam in one piece -- check "
              "whether it fragmented into separate tracks on each side.")
        print(f"All tracks: {[(t.id, t.duration_hours(), t.path[0][2], t.path[-1][2]) for t in active+ended]}")


if __name__ == "__main__":
    main()
