"""Refresh construction-symmetry names without recomputing graph symmetry.

The underlying source ids, symmetry point-group codes, complexity ranks, and
sample records are left unchanged. Detected graph symmetry stays in metadata.
"""

from __future__ import annotations

import json
from pathlib import Path


GALLERY = Path(__file__).resolve().parents[1]
MIRROR = GALLERY.parent / "github-upload"
LABELS = {"eth": "1/8 Reflection", "panetta": "1/48 Symmetry"}
TARGETS = [
    *(directory / name for directory in (GALLERY, MIRROR)
      for name in ("catalog.json", "topology_taxonomy.json", "topology_browser.json", "samples.json")),
    *(GALLERY / "dist" / "data" / name for name in ("catalog.json", "topology_browser.json", "samples.json")),
]


def rename(path: Path) -> int:
    if not path.is_file():
        return 0
    payload = json.loads(path.read_text(encoding="utf-8"))
    source_by_id = {}
    if path.name == "topology_taxonomy.json":
        catalog = json.loads(path.with_name("catalog.json").read_text(encoding="utf-8"))
        source_by_id = {item["id"]: item["source"] for item in catalog["topologies"]}
    changed = 0
    for topology in payload.get("topologies", []):
        source = topology.get("source") or source_by_id.get(topology.get("id"))
        label = LABELS.get(source)
        if not label:
            continue
        updates = {"construction_symmetry_name": label}
        if source_by_id:
            updates["source"] = source
        rank = topology.get("complexity_rank")
        if rank is not None:
            code = f"T-{rank:05d}-{label.replace(' ', '-')}"
            updates["topology_code"] = code
            updates["display_name"] = code
        if "taxonomy_description" in topology and rank is not None:
            updates["taxonomy_description"] = (
                f"{label} construction · detected base group {topology['symmetry_code']} · "
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
