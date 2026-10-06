"""Classify full-cell lattice topologies and add stable display names.

The source ids remain unchanged because they are the reproducibility keys used
by the sample index.  This script adds a public taxonomy based only on the
expanded full-cell graph: a symmetry point-group label, graph-complexity
metrics, and a human-readable name.  Variant records are intentionally not
used to rank topology complexity.

The classifier is dependency-free so it can be rerun on a fresh checkout.
"""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_CATALOG = ROOT / "truss100k" / "catalog.json"
TARGETS = [
    ROOT / "truss-gallery" / "catalog.json",
    ROOT / "github-upload" / "catalog.json",
]

POINT_DECIMALS = 8


def point_key(point: list[float] | tuple[float, float, float]) -> tuple[float, float, float]:
    return tuple(round(float(value), POINT_DECIMALS) for value in point)


def expand_eth(topology: dict) -> tuple[list[tuple[float, float, float]], set[tuple[int, int]]]:
    """Expand the stored positive-octant ETH graph by three reflections."""
    node_ids: dict[tuple[float, float, float], int] = {}
    nodes: list[tuple[float, float, float]] = []
    edges: set[tuple[int, int]] = set()

    def node_id(point: tuple[float, float, float]) -> int:
        key = point_key(point)
        if key not in node_ids:
            node_ids[key] = len(nodes)
            nodes.append(key)
        return node_ids[key]

    for signs in itertools.product((-1.0, 1.0), repeat=3):
        for first, second in topology["edges"]:
            a = tuple(float(topology["nodes"][first][axis]) * signs[axis] for axis in range(3))
            b = tuple(float(topology["nodes"][second][axis]) * signs[axis] for axis in range(3))
            left, right = node_id(a), node_id(b)
            if left != right:
                edges.add(tuple(sorted((left, right))))
    return nodes, edges


def full_graph(topology: dict) -> tuple[list[tuple[float, float, float]], set[tuple[int, int]]]:
    if topology.get("source") == "eth":
        return expand_eth(topology)
    nodes = [point_key(point) for point in topology["nodes"]]
    edges = {tuple(sorted((int(first), int(second)))) for first, second in topology["edges"]}
    return nodes, edges


def signed_permutation_operations() -> list[tuple[tuple[int, int, int], tuple[int, int, int], int]]:
    operations = []
    for permutation in itertools.permutations(range(3)):
        inversions = sum(
            permutation[left] > permutation[right]
            for left in range(3)
            for right in range(left + 1, 3)
        )
        permutation_sign = -1 if inversions % 2 else 1
        for signs in itertools.product((-1, 1), repeat=3):
            determinant = permutation_sign * signs[0] * signs[1] * signs[2]
            operations.append((permutation, signs, determinant))
    return operations


OPERATIONS = signed_permutation_operations()


def symmetry_order(
    nodes: list[tuple[float, float, float]], edges: set[tuple[int, int]]
) -> tuple[int, int]:
    """Count the signed cube operations preserving the node/edge graph."""
    lookup = {point: index for index, point in enumerate(nodes)}
    preserved_edges = set(edges)
    total = 0
    proper = 0
    for permutation, signs, determinant in OPERATIONS:
        mapping: list[int] = []
        for point in nodes:
            transformed = point_key(tuple(signs[axis] * point[permutation[axis]] for axis in range(3)))
            if transformed not in lookup:
                break
            mapping.append(lookup[transformed])
        else:
            transformed_edges = {
                tuple(sorted((mapping[first], mapping[second]))) for first, second in edges
            }
            if transformed_edges == preserved_edges:
                total += 1
                proper += int(determinant == 1)
    return total, proper


def symmetry_label(order: int) -> str:
    # These are the full signed-cube groups observed in the current catalog.
    # The generic fallback keeps the naming deterministic if a future source
    # introduces a different subgroup.
    return {
        48: "Oh",
        24: "O",
        16: "D4h",
        12: "D3d",
        8: "D2h",
        4: "C2h",
        2: "Ci",
        1: "C1",
    }.get(order, f"G{order}")


def symmetry_name(order: int) -> str:
    return {
        48: "Cubic",
        24: "Cubic rotational",
        16: "Tetragonal",
        12: "Trigonal",
        8: "Orthorhombic",
        4: "Monoclinic",
        2: "Centrosymmetric",
        1: "Asymmetric",
    }.get(order, f"{symmetry_label(order)} group")


def connected_components(node_count: int, edges: set[tuple[int, int]]) -> int:
    adjacency = [[] for _ in range(node_count)]
    for first, second in edges:
        adjacency[first].append(second)
        adjacency[second].append(first)
    seen: set[int] = set()
    components = 0
    for start in range(node_count):
        if start in seen:
            continue
        components += 1
        stack = [start]
        seen.add(start)
        while stack:
            current = stack.pop()
            for neighbour in adjacency[current]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
    return components


def classify(catalog: dict) -> list[dict]:
    enriched: list[dict] = []
    for topology in catalog["topologies"]:
        nodes, edges = full_graph(topology)
        components = connected_components(len(nodes), edges)
        edge_count = len(edges)
        node_count = len(nodes)
        cycles = edge_count - node_count + components
        order, proper_order = symmetry_order(nodes, edges)
        enriched.append({
            **topology,
            "full_cell_node_count": node_count,
            "full_cell_edge_count": edge_count,
            "average_degree": round(2.0 * edge_count / max(node_count, 1), 6),
            "cycle_rank": cycles,
            "connected_components": components,
            "symmetry_order": order,
            "proper_symmetry_order": proper_order,
            "symmetry_code": symmetry_label(order),
            "symmetry_name": symmetry_name(order),
            "symmetry_method": (
                "three coordinate-plane reflections"
                if topology.get("source") == "eth"
                else "full-cell signed-cube symmetry from topology enumeration"
            ),
        })

    # Full-cell member count is the primary complexity measure. Node count and
    # cycle rank make ties deterministic without using source names or ids.
    ordered = sorted(
        enriched,
        key=lambda item: (
            item["full_cell_edge_count"],
            item["full_cell_node_count"],
            item["cycle_rank"],
            item["average_degree"],
            item["symmetry_order"],
            item["id"],
        ),
    )
    total = len(ordered)
    for rank, item in enumerate(ordered, start=1):
        percentile = (rank - 1) / max(total - 1, 1)
        level = min(5, int(percentile * 5) + 1)
        item["complexity_rank"] = rank
        item["complexity_level"] = level
        item["complexity_label"] = ["Sparse", "Light", "Medium", "Dense", "Highly connected"][level - 1]

    # Public topology names follow the same simple-to-complex order as the
    # ranking. The source ids remain hidden implementation keys.
    naming_order = sorted(
        enriched,
        key=lambda item: (
            item["complexity_level"],
            item["complexity_rank"],
            item["id"],
        ),
    )
    bucket_counts: dict[int, int] = {}
    for item in naming_order:
        level = item["complexity_level"]
        bucket_counts[level] = bucket_counts.get(level, 0) + 1
        item["taxonomy_code"] = f"{item['symmetry_code']}-C{item['complexity_level']}"
        item["topology_code"] = f"T-C{level}-{bucket_counts[level]:04d}"
        item["display_name"] = f"{item['topology_code']} · {item['symmetry_name']} symmetry ({item['symmetry_code']})"
        item["taxonomy_description"] = (
            f"{item['symmetry_name']} symmetry ({item['symmetry_code']}) · complexity C{item['complexity_level']} "
            f"({item['complexity_label']}) · {item['full_cell_node_count']} nodes · "
            f"{item['full_cell_edge_count']} members"
        )
    return enriched


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def patch_topology_list(path: Path, classified: dict[str, dict]) -> None:
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    for topology in payload.get("topologies", []):
        source = classified.get(topology.get("catalog_id", topology.get("id")))
        if source:
            for key in (
                "display_name", "topology_code", "taxonomy_code", "taxonomy_description",
                "symmetry_code", "symmetry_order", "symmetry_method",
                "symmetry_name",
                "complexity_rank", "complexity_level", "complexity_label",
                "full_cell_node_count", "full_cell_edge_count", "average_degree",
                "cycle_rank", "connected_components",
            ):
                topology[key] = source[key]
    write_json(path, payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=SOURCE_CATALOG)
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    topologies = classify(catalog)
    enriched_catalog = {**catalog, "schema": "truss100k-catalog-v2", "topologies": topologies}
    classified = {topology["id"]: topology for topology in topologies}
    for target in TARGETS:
        write_json(target, enriched_catalog)
        taxonomy_rows = sorted(
            (
                {
                    key: topology[key]
                    for key in (
                        "id", "display_name", "topology_code", "taxonomy_code", "taxonomy_description",
                        "symmetry_code", "symmetry_order", "symmetry_method",
                        "symmetry_name",
                        "complexity_rank", "complexity_level", "complexity_label",
                        "full_cell_node_count", "full_cell_edge_count", "average_degree",
                        "cycle_rank", "connected_components",
                    )
                }
                for topology in topologies
            ),
            key=lambda item: item["complexity_rank"],
        )
        write_json(target.with_name("topology_taxonomy.json"), {
            "schema": "truss-topology-taxonomy-v1",
            "description": "Full-cell symmetry and graph-complexity classification; variant counts are not ranking inputs.",
            "topologies": taxonomy_rows,
        })
        patch_topology_list(target.with_name("topology_browser.json"), classified)
        patch_topology_list(target.with_name("samples.json"), classified)
    print(json.dumps({
        "topologies": len(topologies),
        "symmetry": {
            code: sum(item["symmetry_code"] == code for item in topologies)
            for code in sorted({item["symmetry_code"] for item in topologies})
        },
        "complexity": {
            str(level): sum(item["complexity_level"] == level for item in topologies)
            for level in range(1, 6)
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
