"""Refresh public symmetry labels without recomputing topology classification.

The underlying source ids, symmetry point-group codes, complexity ranks, and
sample records are left unchanged. This is a display-name-only migration.
"""

from __future__ import annotations

import json
from pathlib import Path


GALLERY = Path(__file__).resolve().parents[1]
MIRROR = GALLERY.parent / "github-upload"
LABELS = {8: "1/8 Reflection", 16: "1/16 Symmetry", 48: "1/48 Symmetry"}
TARGETS = [
    *(directory / name for directory in (GALLERY, MIRROR)
      for name in ("catalog.json", "topology_taxonomy.json", "topology_browser.json", "samples.json")),
    *(GALLERY / "dist" / "data" / name for name in ("catalog.json", "topology_browser.json", "samples.json")),
]


def rename(path: Path) -> int:
    if not path.is_file():
        return 0
    payload = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    for topology in payload.get("topologies", []):
        label = LABELS.get(topology.get("symmetry_order"))
        if not label:
            continue
        rank = topology["complexity_rank"]
        code = f"T-{rank:05d}-{label.replace(' ', '-')}"
        updates = {
            "symmetry_name": label,
            "topology_code": code,
            "display_name": code,
        }
        if "taxonomy_description" in topology:
            updates["taxonomy_description"] = (
                f"{label} ({topology['symmetry_code']}) · "
                f"complexity rank {rank} · {topology['full_cell_node_count']} nodes · "
                f"{topology['full_cell_edge_count']} members"
            )
        if any(topology.get(key) != value for key, value in updates.items()):
            topology.update(updates)
            changed += 1
    if changed:
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return changed


if __name__ == "__main__":
    for target in TARGETS:
        print(f"{target}: {rename(target)} renamed")
