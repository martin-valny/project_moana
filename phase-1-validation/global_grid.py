"""Real global ocean grid, using the `global-land-mask` package (Natural
Earth-derived, vectorized, no external data file) instead of grid.py's
hand-rolled North Atlantic-only boxes -- which took real bug-hunting to get
right for one basin and was never meant to generalize (see grid.py's
docstring). This is the "swap in a real geospatial dataset" step flagged
as a known must-do for going beyond a single basin.

Also fixes a real bug grid.py has and never needed to care about: no
international date line wraparound. A cell at lon=178 and a cell at
lon=-178 are neighbors on the actual globe (2 degrees of longitude apart,
not 356) but grid.py's neighbors_of() would never connect them. Any
Pacific-crossing swell tracked globally would hit this.
"""
import numpy as np
from global_land_mask import globe

LAT_MIN, LAT_MAX, LAT_STEP = -78, 78, 2
LON_MIN, LON_MAX, LON_STEP = -180, 180, 3  # LON_MAX exclusive -- -180 and 180 are the same meridian


def build_grid():
    """Returns (cells, index_of), same interface as grid.py."""
    lats = np.arange(LAT_MIN, LAT_MAX + 1, LAT_STEP)
    lons = np.arange(LON_MIN, LON_MAX, LON_STEP)
    LAT, LON = np.meshgrid(lats, lons, indexing="ij")
    is_land = globe.is_land(LAT, LON)

    cells = []
    for i in range(LAT.shape[0]):
        for j in range(LAT.shape[1]):
            if not is_land[i, j]:
                cells.append((round(float(LAT[i, j]), 4), round(float(LON[i, j]), 4)))
    index_of = {c: i for i, c in enumerate(cells)}
    return cells, index_of


def _wrap_lon(lon):
    """Wrap longitude into [-180, 180)."""
    return ((lon + 180) % 360) - 180


def neighbors_of(cell, index_of):
    """8-connected neighbors, WITH international date line wraparound --
    the fix grid.py never needed for a single basin that doesn't touch it."""
    lat, lon = cell
    out = []
    for dlat in (-LAT_STEP, 0, LAT_STEP):
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
    total = ((LAT_MAX - LAT_MIN) // LAT_STEP + 1) * ((LON_MAX - LON_MIN) // LON_STEP)
    print(f"total grid boxes: {total}, ocean cells: {len(cells)} "
          f"({100 * len(cells) / total:.0f}% ocean)")
