"""Build the browser index for every generated truss record.

The gallery keeps the full 32^3 voxel data out of the web bundle.  Each index
row contains the identifiers, geometry controls, the compressed upper
triangles of C_H/K_H, and quality indicators needed by the shared detail
viewer.  The catalog supplies the shared topology skeleton when a row opens.
"""

from __future__ import annotations

import json
import gzip
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATABASE = ROOT / "truss100k" / "records.sqlite"
TARGET_DIRS = [
    ROOT / "truss-gallery" / "dist" / "data",
    ROOT / "truss-gallery" / "github-pages" / "data",
]


def unpack_upper(values: list[float], size: int) -> list[list[float]]:
    matrix = [[0.0 for _ in range(size)] for _ in range(size)]
    next_value = 0
    for row in range(size):
        for column in range(row, size):
            value = float(values[next_value])
            matrix[row][column] = value
            matrix[column][row] = value
            next_value += 1
    return matrix


def inverse(matrix: list[list[float]]) -> list[list[float]]:
    size = len(matrix)
    augmented = [row[:] + [1.0 if row_index == column else 0.0 for column in range(size)] for row_index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-18:
            raise ValueError("singular stiffness matrix")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if abs(factor) < 1e-20:
                continue
            augmented[row] = [left - factor * right for left, right in zip(augmented[row], augmented[column])]
    return [row[size:] for row in augmented]


def index_row(record: dict, dataset: str, row_number: int, topology_id: str, density: float) -> dict:
    stiffness = unpack_upper(record["C_H_upper"], 6)
    compliance = inverse(stiffness)
    youngs = sum(1.0 / compliance[index][index] for index in range(3)) / 3.0
    conductivity = unpack_upper(record["K_H_upper"], 3)
    displacements = [
        [int(index), round(float(dx), 4), round(float(dy), 4), round(float(dz), 4)]
        for index, dx, dy, dz in record.get("node_displacements", [])
    ]
    displacement_norms = [
        (float(dx) ** 2 + float(dy) ** 2 + float(dz) ** 2) ** 0.5
        for _index, dx, dy, dz in displacements
    ]
    return {
        "n": row_number,
        "id": record["id"],
        "dataset": dataset,
        "source": record["source"],
        "topology_id": topology_id,
        "source_index": record.get("base_source_index"),
        "density": round(float(density), 7),
        "radius": round(float(record["radius"]), 7),
        "node_displacements": displacements,
        "node_count": len(displacements),
        "perturbation_type": "node-position + radius" if displacements else "radius-only",
        "perturbation_max_norm": round(max(displacement_norms, default=0.0), 7),
        "perturbation_rms_norm": round(
            (sum(value * value for value in displacement_norms) / len(displacement_norms)) ** 0.5
            if displacement_norms else 0.0,
            7,
        ),
        # Keep the constitutive data in upper-triangle form: this is enough to
        # reconstruct the same matrices used by the topology detail viewer,
        # without storing any 32^3 occupancy array.
        "C_H_upper": [float(value) for value in record["C_H_upper"]],
        "K_H_upper": [float(value) for value in record["K_H_upper"]],
        "quality": {
            "relative_density": float(record["quality"].get("relative_density", density)),
            "solid_voxels": int(record["quality"].get("solid_voxels", 0)),
            "minimum_C_eigenvalue": float(record["quality"].get("minimum_C_eigenvalue", 0.0)),
            "minimum_K_eigenvalue": float(record["quality"].get("minimum_K_eigenvalue", 0.0)),
            "mechanical_max_relative_residual": float(record["quality"].get("mechanical_max_relative_residual", 0.0)),
            "thermal_max_relative_residual": float(record["quality"].get("thermal_max_relative_residual", 0.0)),
            "voxel_sha256": str(record["quality"].get("voxel_sha256", "")),
        },
        "youngs": youngs,
        "thermal": sum(conductivity[index][index] for index in range(3)) / 3.0,
    }


def load_rows() -> list[dict]:
    rows: list[dict] = []
    with sqlite3.connect(DATABASE) as connection:
        query = "SELECT id, source, topology_id, density, record_json FROM {table} ORDER BY id"
        # Keep the main records first in the database query, then sort the
        # combined gallery by VF in ``main`` so the plotted range reads left to
        # right and the VF-gap records fill the visible intervals naturally.
        for dataset, table in (("samples", "samples"), ("gap_samples", "gap_samples")):
            for _db_id, _source, topology_id, density, raw in connection.execute(query.format(table=table)):
                record = json.loads(raw)
                rows.append(index_row(record, dataset, len(rows) + 1, topology_id, density))
    return rows


def main() -> None:
    rows = load_rows()
    rows.sort(key=lambda row: (row["density"], row["source"], row["id"]))
    for index, row in enumerate(rows, start=1):
        row["n"] = index
    counts = {
        "samples": sum(row["dataset"] == "samples" for row in rows),
        "gap_samples": sum(row["dataset"] == "gap_samples" for row in rows),
        "all": len(rows),
    }
    payload = {
        "schema": "truss-full-index-v1",
        "description": "Metadata index for every accepted truss record; shared skeletons come from catalog.json.",
        "counts": counts,
        "page_size": 50,
        "rows": rows,
    }
    shard_count = 4
    shard_size = (len(rows) + shard_count - 1) // shard_count
    for part_number in range(1, shard_count + 1):
        part_rows = rows[(part_number - 1) * shard_size : part_number * shard_size]
        part_payload = {**payload, "rows": part_rows}
        text = json.dumps(part_payload, ensure_ascii=False, separators=(",", ":"))
        compressed = gzip.compress(text.encode("utf-8"), compresslevel=9)
        for target_dir in TARGET_DIRS:
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / f"sample_index_{part_number}.json.gz"
            target.write_bytes(compressed)
            print(f"Wrote part {part_number} ({len(part_rows):,} rows, {target.stat().st_size:,} compressed bytes) to {target}")


if __name__ == "__main__":
    main()
