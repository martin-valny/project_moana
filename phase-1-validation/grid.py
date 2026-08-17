"""North Atlantic ocean-only grid, per Phase -1 setup in the master plan (§8):

  ~20-65N, 80W-0, 2 deg lat x 3 deg lon.

The land/sea mask below is a hand-rolled set of bounding boxes, NOT a real
coastline dataset. It's good enough to keep obviously-inland cells out of a
throwaway synthetic validation run. Production ingestion (§4.2) must use a
real mask (e.g. Natural Earth or GSHHG) -- do not reuse this function there.
"""

LAT_MIN, LAT_MAX, LAT_STEP = 20, 65, 2
LON_MIN, LON_MAX, LON_STEP = -80, 0, 3


def _rough_is_land(lat, lon):
    # Greenland
    if lat >= 59 and -50 <= lon <= -20:
        return True
    # Eastern Canada / New England coast
    if lon >= -80 and lon <= -63 and lat <= 46:
        return True
    # Atlantic Canada / Newfoundland / Labrador
    if -70 <= lon <= -52 and 46 <= lat <= 58:
        return True
    # Iberia, France, British Isles, Ireland (eastern edge of box)
    if lon >= -9 and lat <= 61:
        return True
    # NW Africa
    if lat <= 35 and lon >= -9:
        return True
    return False


def build_grid():
    """Returns (cells, index_of) where cells is a list of (lat, lon) ocean
    cells and index_of maps (lat, lon) -> position in cells, for adjacency
    lookups."""
    cells = []
    lat = LAT_MIN
    while lat <= LAT_MAX:
        lon = LON_MIN
        while lon <= LON_MAX:
            if not _rough_is_land(lat, lon):
                cells.append((round(lat, 4), round(lon, 4)))
            lon += LON_STEP
        lat += LAT_STEP
    index_of = {c: i for i, c in enumerate(cells)}
    return cells, index_of


def neighbors_of(cell, index_of):
    """8-connected neighbors on the lat/lon grid that are also ocean cells."""
    lat, lon = cell
    out = []
    for dlat in (-LAT_STEP, 0, LAT_STEP):
        for dlon in (-LON_STEP, 0, LON_STEP):
            if dlat == 0 and dlon == 0:
                continue
            key = (round(lat + dlat, 4), round(lon + dlon, 4))
            if key in index_of:
                out.append(key)
    return out


if __name__ == "__main__":
    cells, _ = build_grid()
    total = ((LAT_MAX - LAT_MIN) // LAT_STEP + 1) * ((LON_MAX - LON_MIN) // LON_STEP + 1)
    print(f"total grid boxes: {total}, ocean cells: {len(cells)} "
          f"({100 * len(cells) / total:.0f}% ocean)")
