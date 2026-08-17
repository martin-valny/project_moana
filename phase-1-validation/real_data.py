"""Converts a raw_<window>.json produced by fetch_real_data.py into the same
frame format synthetic.generate_frames() produces, so sweep.py / run_validation.py
work unmodified against real data once it's available.

For each cell/hour, picks whichever of {swell, wind_wave} has higher H^2*T
as the "dominant" component -- matching §4.4's single primary-component
model and the same precedence rule synthetic.py uses.
"""
import json


def load_raw_to_frames(path, step_hours=6):
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

            swell_h, swell_p, swell_d = val("swell_wave_height"), val("swell_wave_period"), val("swell_wave_direction")
            wind_h, wind_p, wind_d = val("wind_wave_height"), val("wind_wave_period"), val("wind_wave_direction")

            candidates = []
            if swell_h is not None and swell_p is not None:
                candidates.append((swell_h ** 2 * swell_p, swell_h, swell_p, swell_d))
            if wind_h is not None and wind_p is not None:
                candidates.append((wind_h ** 2 * wind_p, wind_h, wind_p, wind_d))
            if not candidates:
                continue
            energy, height, period, direction = max(candidates, key=lambda c: c[0])
            if direction is None:
                continue

            cell_records[cell] = {
                "swell_height": height,
                "swell_period": period,
                "direction_from": direction % 360,
                "energy": round(energy, 3),
                "category": "groundswell" if period >= 12.0 else "wind_sea",
            }

        frames.append({"t": t_idx // step_hours, "hours": t_idx, "cells": cell_records})

    return frames


if __name__ == "__main__":
    import sys
    frames = load_raw_to_frames(sys.argv[1] if len(sys.argv) > 1 else "raw_clean.json")
    print(f"{len(frames)} frames, {len(frames[0]['cells']) if frames else 0} cells in frame 0")
