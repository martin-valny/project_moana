"""Synthetic North Atlantic swell fields standing in for real ERA5/Open-Meteo
data, which this environment cannot fetch (see fetch_real_data.py + README).

This is NOT a substitute for the real Phase -1 test in the master plan.
It exists to prove the clustering (clustering.py) and tracking (tracking.py)
code is logically correct -- realistic group velocities, realistic clutter,
a case designed to test the "two distinct systems shouldn't merge" failure
mode, and a "messy" scenario with no dominant system -- before spending real
API budget or engineer time hooking it to live data.

Two scenarios, mirroring §8 Phase -1:
  - "clean": one long-lived, long-period, fast-moving hero pulse crossing
    most of the box, an unrelated secondary pulse, plus wind-sea clutter.
  - "messy": five to six short-lived, medium-period pulses with no
    single dominant system, plus the same clutter.
"""
import math
import random

from grid import build_grid, _rough_is_land
from physics import (
    haversine_km, bearing_deg, destination_point, great_circle_point, group_velocity_kmh,
)

STEP_HOURS = 6


class Blob:
    def __init__(self, name, origin, target, period_s, height_peak_m,
                 decay_per_hour, sigma_km, start_hour, height_floor_m=0.15,
                 lifespan_h=None):
        self.name = name
        self.origin = origin
        self.lat, self.lon = origin
        self.period_s = period_s
        self.height = height_peak_m
        self.decay_per_hour = decay_per_hour
        self.sigma_km = sigma_km
        self.start_hour = start_hour
        self.height_floor_m = height_floor_m
        self.lifespan_h = lifespan_h  # hard cutoff; None = governed by decay only
        self.cg_kmh = group_velocity_kmh(period_s)
        # Fixed great-circle track: an "anchor" point far beyond the target
        # along the origin->target heading, so the blob travels a real
        # geodesic indefinitely instead of homing/steering toward a fixed
        # coordinate (which caused unphysical oscillation near arrival) or
        # holding a constant compass bearing (a rhumb line, which spirals
        # poleward over long distances and exited the grid box too fast).
        initial_bearing = bearing_deg(origin[0], origin[1], target[0], target[1])
        self._anchor = destination_point(origin[0], origin[1], initial_bearing, 20000)
        self._anchor_dist_km = haversine_km(origin[0], origin[1], self._anchor[0], self._anchor[1])
        self._dist_traveled_km = 0.0

    def advance(self, hours_elapsed_since_start):
        self.height = max(0.0, self.height - self.decay_per_hour * STEP_HOURS)
        self._dist_traveled_km += self.cg_kmh * STEP_HOURS
        self.lat, self.lon = great_circle_point(
            self.origin[0], self.origin[1], self._anchor[0], self._anchor[1],
            self._dist_traveled_km, self._anchor_dist_km,
        )

    def direction_from_deg(self):
        # Direction FROM which the swell is arriving = reverse of the
        # bearing at the current point along the great-circle track.
        ahead = great_circle_point(
            self.origin[0], self.origin[1], self._anchor[0], self._anchor[1],
            self._dist_traveled_km + 50, self._anchor_dist_km,
        )
        travel_bearing = bearing_deg(self.lat, self.lon, ahead[0], ahead[1])
        return (travel_bearing + 180) % 360

    def alive(self, hour):
        if self.lifespan_h is not None and (hour - self.start_hour) > self.lifespan_h:
            return False
        return self.height > self.height_floor_m


def _hero_and_secondary_blobs():
    hero = Blob(
        name="hero",
        origin=(24.0, -50.0),      # mid-North Atlantic
        target=(60.0, -18.0),      # curving toward the Norwegian Sea, chosen
                                    # (via simulation, see grid.py's crude mask)
                                    # to stay clear of the coarse land mask for
                                    # 100h+ of travel -- the point here is
                                    # validating the tracking algorithm across
                                    # a real multi-day crossing, not literal
                                    # landfall geography.
        period_s=13.0,
        height_peak_m=4.8,
        decay_per_hour=0.0143,     # stays alive ~300h, well past the crossing
        sigma_km=300,
        start_hour=0,
    )
    secondary = Blob(
        name="secondary",
        origin=(45.0, -25.0),
        target=(40.0, -10.0),      # heading toward Iberia, unrelated system
        period_s=13.0,
        height_peak_m=3.0,
        decay_per_hour=0.030,      # dies out in ~4 days
        sigma_km=250,
        start_hour=24,
    )
    return [hero, secondary]


def _path_survives_mask(origin, target, period_s, lifespan_h):
    """Reject a proposed messy-blob track if it would cross into the coarse
    land mask before its lifespan is up -- otherwise most tracks aimed
    loosely toward Europe get truncated within a frame or two of their peak,
    leaving the messy scenario with almost nothing to detect."""
    cg_kmh = group_velocity_kmh(period_s)
    bearing0 = bearing_deg(origin[0], origin[1], target[0], target[1])
    anchor = destination_point(origin[0], origin[1], bearing0, 20000)
    anchor_dist = haversine_km(origin[0], origin[1], anchor[0], anchor[1])
    hour, dist = 0, 0.0
    while hour <= lifespan_h:
        lat, lon = great_circle_point(origin[0], origin[1], anchor[0], anchor[1], dist, anchor_dist)
        if _rough_is_land(lat, lon) or not (20 <= lat <= 65 and -80 <= lon <= 0):
            return False
        hour += STEP_HOURS
        dist += cg_kmh * STEP_HOURS
    return True


def _messy_blobs(total_hours, rng):
    origins = [
        (30.0, -60.0), (38.0, -45.0), (48.0, -30.0),
        (58.0, -35.0), (33.0, -20.0), (50.0, -55.0),
        (26.0, -35.0), (42.0, -55.0), (35.0, -50.0),
        (44.0, -20.0), (55.0, -45.0), (28.0, -25.0),
        (52.0, -55.0), (38.0, -18.0),
    ]
    blobs = []
    for i, origin in enumerate(origins):
        lifespan_h = rng.uniform(24, 60)  # 1-2.5 days, more of them fit in the window
        period = rng.uniform(9.0, 13.5)   # skewed slightly so more clear a groundswell threshold
        height = rng.uniform(2.2, 4.0)

        # Retry with a shrinking search window until the track stays in
        # open water (per the crude mask) for its whole lifespan.
        target = None
        for attempt in range(8):
            spread = max(3, 15 - attempt * 2)
            candidate = (
                origin[0] + rng.uniform(-spread, spread),
                origin[1] + rng.uniform(-spread, spread),
            )
            if _path_survives_mask(origin, candidate, period, lifespan_h):
                target = candidate
                break
        if target is None:
            target = (origin[0], origin[1] - 5)  # fall back: drift west, safely offshore

        # Near-flat energy for most of the lifespan (real short-period wind
        # swell holds fairly steady until the front passes), decaying to
        # ~40% of peak by the hard cutoff -- NOT decaying to zero, which
        # was killing these blobs within 1-2 frames of their peak and
        # leaving the "messy" scenario with almost nothing to detect.
        decay_per_hour = (height * 0.6) / lifespan_h
        start = rng.uniform(0, max(1, total_hours * 0.75))
        blobs.append(Blob(
            name=f"messy_{i}",
            origin=origin,
            target=target,
            period_s=period,
            height_peak_m=height,
            decay_per_hour=decay_per_hour,
            sigma_km=rng.uniform(180, 280),
            start_hour=start,
            lifespan_h=lifespan_h,
        ))

    # Deterministic, guaranteed-overlapping trio: geographically separated,
    # simultaneously alive for a stretch, all clearing the groundswell
    # period threshold. Random staggering above rarely produces genuine
    # 2-3-way simultaneity by chance; this directly stress-tests the
    # "distinct systems shouldn't merge" failure mode from §4.5, which is
    # the actual point of the ceiling criterion, not just an absence check.
    fixed = [
        dict(name="messy_fixed_A", origin=(35.0, -45.0), target=(38.0, -35.0),
             period_s=12.5, height_peak_m=3.2, start_hour=100, lifespan_h=80, sigma_km=220),
        dict(name="messy_fixed_B", origin=(55.0, -40.0), target=(52.0, -28.0),
             period_s=11.5, height_peak_m=3.0, start_hour=110, lifespan_h=80, sigma_km=220),
        dict(name="messy_fixed_C", origin=(40.0, -18.0), target=(37.0, -12.0),
             period_s=13.0, height_peak_m=2.8, start_hour=120, lifespan_h=70, sigma_km=200),
    ]
    for spec in fixed:
        blobs.append(Blob(
            name=spec["name"], origin=spec["origin"], target=spec["target"],
            period_s=spec["period_s"], height_peak_m=spec["height_peak_m"],
            decay_per_hour=(spec["height_peak_m"] * 0.6) / spec["lifespan_h"],
            sigma_km=spec["sigma_km"], start_hour=spec["start_hour"], lifespan_h=spec["lifespan_h"],
        ))
    return blobs


def _background_cell(rng):
    """Calm-or-wind-sea background clutter for a single cell/frame."""
    if rng.random() < 0.35:
        period = rng.uniform(4.0, 9.0)
        height = rng.uniform(0.3, 1.4)
        direction = rng.uniform(0, 360)
    else:
        period, height, direction = 3.0, 0.1, rng.uniform(0, 360)
    return height, period, direction


def _cell_record(height, period, direction_from):
    energy = height ** 2 * period
    category = "groundswell" if period >= 12.0 else "wind_sea"
    return {
        "swell_height": round(height, 3),
        "swell_period": round(period, 2),
        "direction_from": round(direction_from % 360, 1),
        "energy": round(energy, 3),
        "category": category,
    }


def generate_frames(scenario, total_days=14, seed=42):
    """Returns list of frames: {"t": step_index, "hours": h, "cells": {(lat,lon): record}}."""
    rng = random.Random(seed)
    cells, _ = build_grid()
    total_hours = total_days * 24
    steps = total_hours // STEP_HOURS

    if scenario == "clean":
        blobs = _hero_and_secondary_blobs()
    elif scenario == "messy":
        blobs = _messy_blobs(total_hours, rng)
    else:
        raise ValueError(scenario)

    frames = []
    for step in range(steps):
        hour = step * STEP_HOURS
        cell_records = {}
        for cell in cells:
            h, p, d = _background_cell(rng)
            cell_records[cell] = _cell_record(h, p, d)

        for blob in blobs:
            if hour < blob.start_hour:
                continue
            hours_since_start = hour - blob.start_hour
            if hours_since_start > 0:
                blob.advance(hours_since_start)
            if not blob.alive(hour):
                continue
            for cell in cells:
                d_km = haversine_km(blob.lat, blob.lon, cell[0], cell[1])
                if d_km > 3 * blob.sigma_km:
                    continue
                amp = math.exp(-0.5 * (d_km / blob.sigma_km) ** 2)
                h = blob.height * amp
                if h < 0.1:
                    continue
                candidate = _cell_record(h, blob.period_s, blob.direction_from_deg())
                if candidate["energy"] > cell_records[cell]["energy"]:
                    cell_records[cell] = candidate

        frames.append({"t": step, "hours": hour, "cells": cell_records})

    return frames


if __name__ == "__main__":
    for scenario in ("clean", "messy"):
        frames = generate_frames(scenario)
        max_energy = max(c["energy"] for f in frames for c in f["cells"].values())
        print(f"{scenario}: {len(frames)} frames, peak cell energy {max_energy:.1f}")
