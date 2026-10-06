"""Add compact, explicit perturbation summaries to existing gallery rows."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from build_full_index import assign_variant_names, variant_sort_key


ROOT = Path(__file__).resolve().parents[2]
TARGET_DIRS = [ROOT / "truss-gallery", ROOT / "github-upload"]


def summary(displacements: list[list[float]]) -> dict:
    norms = [
        (float(dx) ** 2 + float(dy) ** 2 + float(dz) ** 2) ** 0.5
        for _index, dx, dy, dz in displacements
    ]
    return {
        "perturbation_type": "node-position + radius" if displacements else "radius-only",
        "perturbation_max_norm": round(max(norms, default=0.0), 7),
        "perturbation_rms_norm": round(
            (sum(value * value for value in norms) / len(norms)) ** 0.5 if norms else 0.0,
            7,
        ),
    }


def update_row(row: dict) -> None:
    row.update(summary(row.get("node_displacements") or []))


def update_json(path: Path) -> None:
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    for row in payload.get("samples", []):
        update_row(row)
    for topology in payload.get("topologies", []):
        variants = topology.get("variants", [])
        for variant in variants:
            update_row(variant)
            variant["topology_id"] = topology.get("catalog_id", topology.get("id", ""))
        assign_variant_names(variants)
        variants.sort(key=variant_sort_key)
        for variant in variants:
            variant.pop("topology_id", None)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def update_shard(path: Path) -> None:
    if not path.is_file():
        return
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    for row in payload.get("rows", []):
        update_row(row)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(encoded)


def main() -> None:
    for directory in TARGET_DIRS:
        update_json(directory / "samples.json")
        update_json(directory / "topology_browser.json")
        for part in range(1, 5):
            update_shard(directory / f"sample_index_{part}.json.gz")


if __name__ == "__main__":
    main()
