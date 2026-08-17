"""South/Central/North Pacific regional grid, for testing whether tracking
holds together across a real long-distance, cross-hemisphere, date-line-
crossing swell -- the "7,000-mile swell" of July 2024 (storm off New
Zealand's Chatham Islands -> Tahiti -> Hawaii -> California).

Reuses global_grid.py's real land mask (global-land-mask, not a hand-rolled
box) and its date-line-aware neighbor lookup -- this region straddles the
seam by construction (New Zealand ~176E, California ~-120W).

Box: roughly 45S to 40N, 170E to -110W (going the short way, through 180).
"""
import numpy as np
from global_land_mask import globe

LAT_MIN, LAT_MAX, LAT_STEP = -46, 40, 2
LON_STEP = 3
# Longitude range expressed as the actual short path across the date line:
# 170E (=170) through 180/-180 to -110 (=250 degrees... no, the short way).
# Build it explicitly as two segments to keep this readable.
_LON_EAST = list(np.arange(170, 180, LON_STEP))          # 170E .. <180
_LON_WEST = list(np.arange(-180, -109, LON_STEP))        # -180 .. <-109W
LONS = _LON_EAST + _LON_WEST


def build_grid():
    lats = np.arange(LAT_MIN, LAT_MAX + 1, LAT_STEP)
    cells = []
    for lat in lats:
        for lon in LONS:
            if not globe.is_land(float(lat), float(lon)):
                cells.append((round(float(lat), 4), round(float(lon), 4)))
    index_of = {c: i for i, c in enumerate(cells)}
    return cells, index_of


def _wrap_lon(lon):
    return ((lon + 180) % 360) - 180


def neighbors_of(cell, index_of):
    lat, lon = cell
    out = []
    for dlat in (-2, 0, 2):
        for dlon in (-LON_STEP, 0, LON_STEP):
            if dlat == 0 and dlon == 0:
                continue
            new_lat = lat + dlat
            if new_lat < LAT_MIN or new_lat > LAT_MAX:
                continue
            new_lon = _wrap_lon(lon + dlon)
            key = (round(new_lat, 4), round(new_lon, 4))
            if key in index_of:
                out.append(key)
    return out


if __name__ == "__main__":
    cells, _ = build_grid()
    total = (LAT_MAX - LAT_MIN + 2) // 2 * len(LONS)
    print(f"total grid boxes: ~{total}, ocean cells: {len(cells)} "
          f"({100 * len(cells) / total:.0f}% ocean)")
