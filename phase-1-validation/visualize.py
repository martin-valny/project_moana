"""Per-frame scatter (colored by track ID, consistent across frames) stitched
into a GIF, plus a centroid-path plot -- per master plan §8's "ugly
matplotlib is correct here; this is not an aesthetic test."
"""
import hashlib
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from clustering import cluster_frame
from grid import build_grid
from tracking import Tracker

_ALL_CELLS, _ = build_grid()


def _color_for_id(track_id):
    h = hashlib.md5(str(track_id).encode()).hexdigest()
    return f"#{h[:6]}"


def run_and_plot(scenario, frames, params, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tracker = Tracker()
    frame_pngs = []
    all_tracks_by_hour = {}  # hour -> {cell: track_id}

    for frame in frames:
        clusters = cluster_frame(
            frame["cells"],
            period_threshold=params["period_threshold"],
            energy_floor=params["energy_floor"],
            angular_tolerance=params["angular_tolerance"],
            period_tolerance=3.0,
            min_cluster_size=params["min_cluster_size"],
        )
        prev_ids = {t.id: t for t in tracker.active}
        tracker.step(frame["hours"], clusters)
        # Map each active track's current cluster cells -> its id, for plotting.
        cell_to_id = {}
        for t in tracker.active:
            for c in t.cells:
                cell_to_id[c] = t.id
        all_tracks_by_hour[frame["hours"]] = cell_to_id

    for frame in frames:
        cell_to_id = all_tracks_by_hour[frame["hours"]]
        fig, ax = plt.subplots(figsize=(7, 6))
        bg_lats = [c[0] for c in _ALL_CELLS if c not in cell_to_id]
        bg_lons = [c[1] for c in _ALL_CELLS if c not in cell_to_id]
        ax.scatter(bg_lons, bg_lats, s=4, c="#dddddd", zorder=1)
        for track_id in sorted(set(cell_to_id.values())):
            lats = [c[0] for c, tid in cell_to_id.items() if tid == track_id]
            lons = [c[1] for c, tid in cell_to_id.items() if tid == track_id]
            ax.scatter(lons, lats, s=22, c=_color_for_id(track_id), label=f"id {track_id}", zorder=2)
        ax.set_xlim(-82, 2)
        ax.set_ylim(18, 67)
        ax.set_title(f"{scenario} scenario -- hour {frame['hours']} (day {frame['hours']/24:.1f})")
        ax.set_xlabel("lon")
        ax.set_ylabel("lat")
        if cell_to_id:
            ax.legend(loc="upper left", fontsize=7, framealpha=0.7)
        png_path = os.path.join(out_dir, f"{scenario}_{frame['t']:03d}.png")
        fig.savefig(png_path, dpi=90)
        plt.close(fig)
        frame_pngs.append(png_path)

    gif_path = os.path.join(out_dir, f"{scenario}_clusters.gif")
    _make_gif(frame_pngs, gif_path)

    tracker.finalize(frames[-1]["hours"])
    _plot_centroid_paths(tracker.active + tracker.ended, scenario, out_dir)

    for p in frame_pngs:
        os.remove(p)

    return gif_path


def _make_gif(png_paths, gif_path, duration_ms=250):
    from PIL import Image
    frames = [Image.open(p) for p in png_paths]
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=duration_ms, loop=0)


def _plot_centroid_paths(tracks, scenario, out_dir):
    fig, ax = plt.subplots(figsize=(7, 6))
    for t in tracks:
        if len(t.path) < 2:
            continue
        lats = [p[1] for p in t.path]
        lons = [p[2] for p in t.path]
        ax.plot(lons, lats, "-o", ms=3, c=_color_for_id(t.id), label=f"id {t.id} ({t.duration_hours():.0f}h)")
    ax.set_xlim(-82, 2)
    ax.set_ylim(18, 67)
    ax.set_title(f"{scenario} scenario -- centroid paths")
    ax.set_xlabel("lon")
    ax.set_ylabel("lat")
    ax.legend(loc="upper left", fontsize=7, framealpha=0.7)
    fig.savefig(os.path.join(out_dir, f"{scenario}_centroid_paths.png"), dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    from synthetic import generate_frames

    representative_params = dict(period_threshold=12.0, energy_floor=25.0, angular_tolerance=40.0, min_cluster_size=4)
    for scenario in ("clean", "messy"):
        frames = generate_frames(scenario)
        gif = run_and_plot(scenario, frames, representative_params, "output")
        print(f"{scenario}: wrote {gif}")
