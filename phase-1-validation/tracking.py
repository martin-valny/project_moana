"""Cross-frame tracking, per master plan §4.5.

The naive failure mode the plan calls out explicitly: nearest-centroid
matching breaks because a 14s swell moves ~470km in a single 6h step, often
further than the cluster's own radius. This implements the plan's fix:
project each track's expected position forward using group velocity +
direction, then match to the nearest cluster to the *predicted* position.
Tracks survive up to `max_missed_frames` missing frames before dying.

Merges/splits are treated as physical events (lineage via parent_id /
merged_into), not bugs -- also per §4.5.
"""
from dataclasses import dataclass, field

from physics import destination_point, group_velocity_kmh, haversine_km

try:
    from scipy.optimize import linear_sum_assignment
    HAVE_SCIPY = True
except ImportError:
    HAVE_SCIPY = False

INFEASIBLE_COST = 1e9


@dataclass
class Track:
    id: int
    first_detected_hour: float
    parent_id: object = None
    last_seen_hour: float = None
    ended_hour: object = None
    merged_into: object = None
    missed_frames: int = 0
    cells: set = field(default_factory=set)
    centroid: tuple = None
    mean_period: float = None
    mean_direction: float = None
    total_energy: float = None
    path: list = field(default_factory=list)  # [(hour, lat, lon)]

    @property
    def alive(self):
        return self.ended_hour is None

    def duration_hours(self):
        if not self.path:
            return 0.0
        return self.path[-1][0] - self.path[0][0]

    def path_length_km(self):
        total = 0.0
        for (h1, la1, lo1), (h2, la2, lo2) in zip(self.path, self.path[1:]):
            total += haversine_km(la1, lo1, la2, lo2)
        return total


def _predict_position(track, target_hour):
    hours_elapsed = target_hour - track.last_seen_hour
    if hours_elapsed <= 0:
        return track.centroid
    cg_kmh = group_velocity_kmh(track.mean_period)
    travel_bearing = (track.mean_direction + 180) % 360
    dist_km = cg_kmh * hours_elapsed
    return destination_point(track.centroid[0], track.centroid[1], travel_bearing, dist_km)


def _overlap_fraction(cells_a, cells_b):
    a, b = set(cells_a), set(cells_b)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


class Tracker:
    def __init__(self, max_match_distance_km=450, max_missed_frames=2, merge_overlap_threshold=0.3):
        self.max_match_distance_km = max_match_distance_km
        self.max_missed_frames = max_missed_frames
        self.merge_overlap_threshold = merge_overlap_threshold
        self.active = []
        self.ended = []
        self._next_id = 1

    def _new_track(self, hour, cluster, parent_id=None):
        t = Track(id=self._next_id, first_detected_hour=hour, parent_id=parent_id)
        self._next_id += 1
        self._apply_cluster(t, hour, cluster)
        return t

    def _apply_cluster(self, track, hour, cluster):
        track.last_seen_hour = hour
        track.missed_frames = 0
        track.cells = set(cluster.cells)
        track.centroid = cluster.centroid
        track.mean_period = cluster.mean_period
        track.mean_direction = cluster.mean_direction
        track.total_energy = cluster.total_energy
        track.path.append((hour, cluster.centroid[0], cluster.centroid[1]))

    def step(self, hour, clusters):
        if not self.active or not clusters:
            matches, unmatched_tracks, unmatched_clusters = {}, list(range(len(self.active))), list(range(len(clusters)))
        else:
            cost = [[INFEASIBLE_COST] * len(clusters) for _ in self.active]
            for i, track in enumerate(self.active):
                pred = _predict_position(track, hour)
                for j, cl in enumerate(clusters):
                    d = haversine_km(pred[0], pred[1], cl.centroid[0], cl.centroid[1])
                    if d <= self.max_match_distance_km:
                        cost[i][j] = d
            if HAVE_SCIPY:
                row_ind, col_ind = linear_sum_assignment(cost)
            else:
                row_ind, col_ind = _greedy_assignment(cost)
            matches = {}
            matched_tracks, matched_clusters = set(), set()
            for i, j in zip(row_ind, col_ind):
                if cost[i][j] < INFEASIBLE_COST:
                    matches[i] = j
                    matched_tracks.add(i)
                    matched_clusters.add(j)
            unmatched_tracks = [i for i in range(len(self.active)) if i not in matched_tracks]
            unmatched_clusters = [j for j in range(len(clusters)) if j not in matched_clusters]

        matched_cluster_cells = []  # for merge/split overlap checks

        # 1. matched tracks continue
        for i, j in matches.items():
            self._apply_cluster(self.active[i], hour, clusters[j])
            matched_cluster_cells.append(clusters[j].cells)

        # 2. unmatched tracks: check merge, else count as missed / expire
        still_active = []
        for i, track in enumerate(self.active):
            if i in matches:
                still_active.append(track)
                continue
            merged = False
            for j in matches.values():
                if _overlap_fraction(track.cells, clusters[j].cells) >= self.merge_overlap_threshold:
                    track.ended_hour = hour
                    track.merged_into = self.active[[k for k, v in matches.items() if v == j][0]].id
                    merged = True
                    break
            if merged:
                self.ended.append(track)
                continue
            track.missed_frames += 1
            if track.missed_frames > self.max_missed_frames:
                track.ended_hour = track.last_seen_hour
                self.ended.append(track)
            else:
                still_active.append(track)

        # 3. unmatched clusters: new track, or split from a track that just matched
        new_tracks = []
        for j in unmatched_clusters:
            parent_id = None
            for i, jj in matches.items():
                if _overlap_fraction(self.active[i].cells, clusters[j].cells) >= self.merge_overlap_threshold:
                    parent_id = self.active[i].id
                    break
            new_tracks.append(self._new_track(hour, clusters[j], parent_id=parent_id))

        self.active = still_active + new_tracks

    def finalize(self, last_hour):
        for t in self.active:
            if t.ended_hour is None and t.last_seen_hour < last_hour:
                pass  # left alive at end of simulation window; not a death
        return self.active, self.ended


def _greedy_assignment(cost):
    """Fallback if scipy is unavailable -- greedy nearest match."""
    import copy
    cost = copy.deepcopy(cost)
    rows, cols = [], []
    n, m = len(cost), len(cost[0]) if cost else 0
    used_r, used_c = set(), set()
    pairs = [(cost[i][j], i, j) for i in range(n) for j in range(m)]
    pairs.sort()
    for c, i, j in pairs:
        if i in used_r or j in used_c:
            continue
        used_r.add(i)
        used_c.add(j)
        rows.append(i)
        cols.append(j)
    return rows, cols
