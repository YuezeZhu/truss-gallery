"""Split the complete variant/property index into small on-demand topology shards."""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from pathlib import Path


GALLERY = Path(__file__).resolve().parents[1]
OUTPUT = GALLERY / "dist" / "data"
SHARD_COUNT = 64


def geometry_key(row: dict) -> tuple:
    return tuple(
        (int(node), *(round(float(value), 4) for value in (dx, dy, dz)))
        for node, dx, dy, dz in row.get("node_displacements", [])
    )


def main() -> None:
    catalog = json.loads((GALLERY / "catalog.json").read_text(encoding="utf-8"))
    topology_by_id = {item["id"]: item for item in catalog["topologies"]}
    rows_by_shard: dict[int, list[dict]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    geometries: dict[str, set[tuple]] = defaultdict(set)

    for part in range(1, 5):
        with gzip.open(GALLERY / f"sample_index_{part}.json.gz", "rt", encoding="utf-8") as stream:
            payload = json.load(stream)
        for row in payload["rows"]:
            topology_id = row["topology_id"]
            rank = topology_by_id[topology_id]["complexity_rank"]
            shard = (rank - 1) % SHARD_COUNT
            rows_by_shard[shard].append(row)
            counts[topology_id] += 1
            geometries[topology_id].add(geometry_key(row))

    if len(counts) != len(topology_by_id):
        raise ValueError(f"Expected {len(topology_by_id)} populated topologies; found {len(counts)}")
    if sum(counts.values()) != 120_894:
        raise ValueError(f"Expected 120,894 variants; found {sum(counts.values())}")

    shard_dir = OUTPUT / "topology_shards"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for shard in range(SHARD_COUNT):
        payload = {"schema": "topology-shard-v1", "rows": rows_by_shard[shard]}
        target = shard_dir / f"shard_{shard:02d}.json.gz"
        with target.open("wb") as output:
            with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as compressed:
                compressed.write(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))

    index = {
        "schema": "topology-shards-v1",
        "topology_count": len(topology_by_id),
        "variant_count": sum(counts.values()),
        "shard_count": SHARD_COUNT,
        "topologies": {
            topology_id: {
                "variants": counts[topology_id],
                "geometries": len(geometries[topology_id]),
                "shard": (topology["complexity_rank"] - 1) % SHARD_COUNT,
            }
            for topology_id, topology in topology_by_id.items()
        },
    }
    (OUTPUT / "topology_counts.json").write_text(
        json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    print(f"Wrote {SHARD_COUNT} shards for {index['topology_count']:,} topologies and {index['variant_count']:,} variants")


if __name__ == "__main__":
    main()
