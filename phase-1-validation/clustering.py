"""Per-frame clustering, per master plan §4.5:

  1. Filter cells to period above threshold and energy above a floor.
  2. Region-grow across adjacent cells where direction agrees within an
     angular tolerance and period within a period tolerance.
  3. Discard clusters below a minimum cell count.

Updated after the real-data Phase -1 result: operational wave forecasting
doesn't cluster a single "dominant component per cell" value -- WAVEWATCH
III partitions each grid point's spectrum into windsea + up to 5 separate
swell systems first (Hanson & Phillips 2001), and only then runs a
dedicated spatial-tracking step on top, specifically because a single
collapsed value per point isn't spatially/temporally coherent enough to
track on its own. `cell_records` here therefore accepts EITHER the old
single-record-per-cell format (what synthetic.py produces) OR a list of
records per cell (multiple simultaneous components -- e.g. primary swell,
secondary swell, wind-sea -- from real_data.py). Region-growing treats each
component as its own point in the graph; components at the same cell are
graph-adjacent to each other too, so a coexisting swell and wind-sea system
at one location can belong to two different clusters instead of being
forced into one "winning" value.
"""
from dataclasses import dataclass, field

from grid import build_grid, neighbors_of
from physics import angular_diff

_CELLS, _INDEX_OF = build_grid()


def _default_neighbors(cell):
    return neighbors_of(cell, _INDEX_OF)


@dataclass
class Cluster:
    cells: list
    centroid: tuple
    mean_direction: float
    mean_period: float
    total_energy: float
    category: str


def _weighted_circular_mean(dirs_weights):
    import math
    x = sum(w * math.sin(math.radians(d)) for d, w in dirs_weights)
    y = sum(w * math.cos(math.radians(d)) for d, w in dirs_weights)
    return math.degrees(math.atan2(x, y)) % 360


def _node_neighbors(node, cells_by_loc, neighbor_fn):
    cell, idx = node
    out = []
    for other_idx in range(len(cells_by_loc[cell])):
        if other_idx != idx:
            out.append((cell, other_idx))
    for nb_cell in neighbor_fn(cell):
        for other_idx in range(len(cells_by_loc.get(nb_cell, ()))):
            out.append((nb_cell, other_idx))
    return out


def cluster_frame(cell_records, period_threshold, energy_floor,
                   angular_tolerance, period_tolerance, min_cluster_size,
                   neighbor_fn=None):
    """cell_records: {(lat,lon): record} or {(lat,lon): [record, ...]} for one
    frame. Returns list[Cluster].

    neighbor_fn: optional cell -> [neighbor cells] override, defaulting to
    the North Atlantic grid.py. Pass global_grid.neighbors_of (bound to its
    own index_of) to cluster over the real global, date-line-wrapping grid
    instead -- see test_dateline.py."""
    neighbor_fn = neighbor_fn or _default_neighbors
    cells_by_loc = {
        cell: (val if isinstance(val, list) else [val])
        for cell, val in cell_records.items()
    }

    candidates = {}
    for cell, records in cells_by_loc.items():
        for idx, r in enumerate(records):
            if r["swell_period"] >= period_threshold and r["energy"] >= energy_floor:
                candidates[(cell, idx)] = r

    visited = set()
    clusters = []
    for start in candidates:
        if start in visited:
            continue
        # BFS region-growth over (cell, component-index) points
        queue = [start]
        visited.add(start)
        member = [start]
        while queue:
            cur = queue.pop()
            cur_rec = candidates[cur]
            for nb in _node_neighbors(cur, cells_by_loc, neighbor_fn):
                if nb in visited or nb not in candidates:
                    continue
                nb_rec = candidates[nb]
                if angular_diff(cur_rec["direction_from"], nb_rec["direction_from"]) > angular_tolerance:
                    continue
                if abs(cur_rec["swell_period"] - nb_rec["swell_period"]) > period_tolerance:
                    continue
                visited.add(nb)
                queue.append(nb)
                member.append(nb)

        unique_cells = list(dict.fromkeys(cell for cell, idx in member))
        if len(unique_cells) < min_cluster_size:
            continue

        # Plain arithmetic mean for longitude breaks for a cluster spanning
        # the international date line (179 and -179 average to 0, not
        # +/-180) -- circular mean handles that the same way direction
        # already does above.
        lat_c = sum(m[0] for m in unique_cells) / len(unique_cells)
        lon_c = _weighted_circular_mean([(m[1], 1.0) for m in unique_cells])
        if lon_c > 180:
            lon_c -= 360
        total_energy = sum(candidates[m]["energy"] for m in member)
        mean_period = sum(candidates[m]["swell_period"] * candidates[m]["energy"] for m in member) / total_energy
        mean_dir = _weighted_circular_mean(
            [(candidates[m]["direction_from"], candidates[m]["energy"]) for m in member]
        )
        category = "groundswell" if mean_period >= 12.0 else "wind_sea"
        clusters.append(Cluster(
            cells=unique_cells,
            centroid=(lat_c, lon_c),
            mean_direction=mean_dir,
            mean_period=mean_period,
            total_energy=total_energy,
            category=category,
        ))
    return clusters
