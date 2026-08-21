"""Temporal smoothing of a cell's period/direction/height before clustering.

Real single-cell time series are noisier than the plan's synthetic model
assumed -- see phase-1-validation/README.md's "what the real data showed"
section. A real cell can report period dropping from 15s to 11s and back
within 12-18h even in the middle of a genuine, well-documented groundswell
event, because Open-Meteo's marine variables report the single dominant
component per hour, and which train is briefly dominant can flicker as
multiple trains cross the same point. That flicker fragments clustering at
tight period thresholds.

This is the master plan's own §8-listed fix for the "fragmentation" failure
mode ("spatially smooth direction/period before clustering -- cheap fix").
Implemented here as a centered rolling window over time, per cell,
independent of clustering itself, so it's a drop-in preprocessing step.
"""
import math


def smooth_frames(frames, window=3, min_samples=2):
    """window is in frames (each frame is 6h, so window=3 is +/-6h, an 18h
    centered window). Returns a new list of frames in the same format."""
    half = window // 2
    n = len(frames)

    # cell -> list of (frame_index, record) so we can look up neighbors by index
    cell_series = {}
    for i, frame in enumerate(frames):
        for cell, rec in frame["cells"].items():
            cell_series.setdefault(cell, {})[i] = rec

    smoothed_frames = []
    for i, frame in enumerate(frames):
        new_cells = {}
        for cell in frame["cells"]:
            series = cell_series[cell]
            window_recs = [series[j] for j in range(max(0, i - half), min(n, i + half + 1)) if j in series]
            if len(window_recs) < min_samples:
                continue
            height = sum(r["swell_height"] for r in window_recs) / len(window_recs)
            period = sum(r["swell_period"] for r in window_recs) / len(window_recs)
            # circular mean for direction, energy-weighted so the more
            # energetic frames in the window dominate the averaged heading
            weights = [max(r["energy"], 0.01) for r in window_recs]
            x = sum(w * math.sin(math.radians(r["direction_from"])) for r, w in zip(window_recs, weights))
            y = sum(w * math.cos(math.radians(r["direction_from"])) for r, w in zip(window_recs, weights))
            direction = math.degrees(math.atan2(x, y)) % 360
            energy = height ** 2 * period
            new_cells[cell] = {
                "swell_height": round(height, 3),
                "swell_period": round(period, 2),
                "direction_from": round(direction, 1),
                "energy": round(energy, 3),
                "category": "groundswell" if period >= 11.0 else "wind_sea",
            }
        smoothed_frames.append({"t": frame["t"], "hours": frame["hours"], "cells": new_cells})
    return smoothed_frames
