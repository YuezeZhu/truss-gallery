"""Copy the canonical skeleton and property dataset into the static Gallery."""

from __future__ import annotations

import json
import sqlite3
import shutil
from pathlib import Path

from build_full_index import main as build_full_index


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "truss32_minimal" / "dataset.json"
TARGET = ROOT / "truss-gallery" / "dist" / "data" / "samples.json"
TOPOLOGY_TARGET = ROOT / "truss-gallery" / "dist" / "data" / "topology_browser.json"
CATALOG_TARGET = ROOT / "truss-gallery" / "dist" / "data" / "catalog.json"
TRUSS100K = ROOT / "truss100k"


def topology_signature(topology: dict) -> tuple:
    points = tuple(tuple(round(float(value), 8) for value in point) for point in topology["nodes"])
    edges = tuple(sorted(tuple(int(value) for value in edge) for edge in topology["edges"]))
    return points, edges


def build_topology_browser(dataset: dict) -> None:
    """Build a compact topology index with real 100k-record variants.

    The gallery keeps the 301 curated topology shapes from the compact dataset,
    then attaches up to eight actual records from truss100k to each shape. This
    keeps the browser payload small while making radius and node-position
    variants visible without embedding the full property tensors.
    """
    catalog = json.loads((TRUSS100K / "catalog.json").read_text(encoding="utf-8"))["topologies"]
    catalog_by_signature = {topology_signature(item): item for item in catalog}
    pairs = []
    for topology in dataset["topologies"]:
        match = catalog_by_signature.get(topology_signature(topology))
        if match is None:
            raise ValueError(f"Could not match topology {topology['id']} to truss100k catalog")
        pairs.append((topology, match))

    catalog_ids = [match["id"] for _, match in pairs]
    placeholders = ",".join("?" for _ in catalog_ids)
    variants_by_catalog_id = {catalog_id: [] for catalog_id in catalog_ids}
    with sqlite3.connect(TRUSS100K / "records.sqlite") as connection:
        rows = connection.execute(
            f"SELECT id, source, topology_id, density, record_json "
            f"FROM samples WHERE topology_id IN ({placeholders})",
            catalog_ids,
        )
        for sample_id, source, topology_id, density, record_json in rows:
            record = json.loads(record_json)
            variants_by_catalog_id[topology_id].append({
                "id": f"{source}_{int(sample_id):06d}",
                "radius": float(record["radius"]),
                "density": float(density),
                "node_displacements": record.get("node_displacements", []),
            })

    topologies = []
    for topology, match in pairs:
        variants = sorted(
            variants_by_catalog_id[match["id"]],
            key=lambda item: (item["radius"], item["id"]),
        )
        if len(variants) > 8:
            variants = [variants[round(index * (len(variants) - 1) / 7)] for index in range(8)]
        topologies.append({
            "id": topology["id"],
            "source": topology["source"],
            "nodes": topology["nodes"],
            "edges": topology["edges"],
            "variants": variants,
            "catalog_id": match["id"],
        })
    TOPOLOGY_TARGET.parent.mkdir(parents=True, exist_ok=True)
    TOPOLOGY_TARGET.write_text(
        json.dumps({"schema": "truss-topology-browser-v1", "topologies": topologies}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Copied {len(topologies)} topology groups with {sum(len(item['variants']) for item in topologies)} variants to {TOPOLOGY_TARGET}")


def main() -> None:
    dataset = json.loads(SOURCE.read_text(encoding="utf-8"))
    if dataset["schema"] != "truss32-minimal-v1":
        raise ValueError("Unexpected compact dataset schema")
    if len(dataset["samples"]) != 303:
        raise ValueError("Expected 303 accepted samples")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)
    shutil.copyfile(TRUSS100K / "catalog.json", CATALOG_TARGET)
    print(f"Copied {len(dataset['samples'])} skeleton records to {TARGET}")
    build_topology_browser(dataset)
    build_full_index()


if __name__ == "__main__":
    main()
