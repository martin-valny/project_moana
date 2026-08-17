"""Converts a raw_<window>.json produced by fetch_real_data.py into the same
frame format synthetic.generate_frames() produces, so sweep.py / run_validation.py
work unmodified against real data once it's available.

Updated after the real-data Phase -1 result: rather than collapsing each
cell to a single "dominant" component (whichever of swell/wind-wave has
higher H^2*T), this now emits a separate candidate record per available
component (primary swell, secondary swell if the fetch included it, wind
sea) -- matching how operational wave models (WAVEWATCH III et al.)
partition the spectrum into multiple coexisting systems before tracking
any of them, instead of forcing one "winning" value per point. See
clustering.py's docstring for how these get consumed.
"""
import json

# Order matters only for readability; clustering treats every candidate
# as an independent point regardless of which component it came from.
COMPONENTS = [
    ("swell_wave_height", "swell_wave_period", "swell_wave_direction"),
    ("secondary_swell_wave_height", "secondary_swell_wave_period", "secondary_swell_wave_direction"),
    ("wind_wave_height", "wind_wave_period", "wind_wave_direction"),
]


def load_raw_to_frames(path, step_hours=6, min_height_m=0.1):
    with open(path) as f:
        raw = json.load(f)

    cell_data = raw["cells"]
    any_cell = next(iter(cell_data.values()))
    times = any_cell["time"]

    frames = []
    for t_idx in range(0, len(times), step_hours):
        cell_records = {}
        for key, series in cell_data.items():
            lat_s, lon_s = key.split(",")
            cell = (float(lat_s), float(lon_s))
            if t_idx >= len(series.get("time", [])):
                continue

            def val(name):
                arr = series.get(name)
                return arr[t_idx] if arr and t_idx < len(arr) else None

            records = []
            for h_key, p_key, d_key in COMPONENTS:
                h, p, d = val(h_key), val(p_key), val(d_key)
                if h is None or p is None or d is None or h < min_height_m:
                    continue
                records.append({
                    "swell_height": h,
                    "swell_period": p,
                    "direction_from": d % 360,
                    "energy": round(h ** 2 * p, 3),
                    "category": "groundswell" if p >= 12.0 else "wind_sea",
                })

            if records:
                cell_records[cell] = records

        frames.append({"t": t_idx // step_hours, "hours": t_idx, "cells": cell_records})

    return frames


if __name__ == "__main__":
    import sys
    frames = load_raw_to_frames(sys.argv[1] if len(sys.argv) > 1 else "raw_clean.json")
    n_multi = sum(1 for f in frames for recs in f["cells"].values() if len(recs) > 1)
    print(f"{len(frames)} frames, {len(frames[0]['cells']) if frames else 0} cells in frame 0, "
          f"{n_multi} cell-frames with 2+ simultaneous components")
