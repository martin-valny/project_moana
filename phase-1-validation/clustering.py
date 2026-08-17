"""Per-frame clustering, per master plan §4.5:

  1. Filter cells to period above threshold and energy above a floor.
  2. Region-grow across adjacent cells where direction agrees within an
     angular tolerance and period within a period tolerance.
  3. Discard clusters below a minimum cell count.
"""
from dataclasses import dataclass, field

from grid import build_grid, neighbors_of
from physics import angular_diff

_CELLS, _INDEX_OF = build_grid()


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


def cluster_frame(cell_records, period_threshold, energy_floor,
                   angular_tolerance, period_tolerance, min_cluster_size):
    """cell_records: {(lat,lon): record} for one frame (see synthetic._cell_record).
    Returns list[Cluster]."""
    candidates = {
        c: r for c, r in cell_records.items()
        if r["swell_period"] >= period_threshold and r["energy"] >= energy_floor
    }

    visited = set()
    clusters = []
    for start in candidates:
        if start in visited:
            continue
        # BFS region-growth
        queue = [start]
        visited.add(start)
        member = [start]
        while queue:
            cur = queue.pop()
            cur_rec = candidates[cur]
            for nb in neighbors_of(cur, _INDEX_OF):
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

        if len(member) < min_cluster_size:
            continue

        lat_c = sum(m[0] for m in member) / len(member)
        lon_c = sum(m[1] for m in member) / len(member)
        total_energy = sum(candidates[m]["energy"] for m in member)
        mean_period = sum(candidates[m]["swell_period"] * candidates[m]["energy"] for m in member) / total_energy
        mean_dir = _weighted_circular_mean(
            [(candidates[m]["direction_from"], candidates[m]["energy"]) for m in member]
        )
        category = "groundswell" if mean_period >= 12.0 else "wind_sea"
        clusters.append(Cluster(
            cells=member,
            centroid=(lat_c, lon_c),
            mean_direction=mean_dir,
            mean_period=mean_period,
            total_energy=total_energy,
            category=category,
        ))
    return clusters
