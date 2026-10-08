# Topology taxonomy

The gallery keeps the original `topology_id` values as immutable provenance
keys.  The public `display_name` is a separate taxonomy name and does not
change the sample index or the reproducibility path.

## Topology names

Topology names use the simple-to-complex order:

`T-<global-rank>-<symmetry fraction>`

Examples:

- `T-00001-1/48-Symmetry`
- `T-00002-1/48-Symmetry`
- `T-10362-1/8-Reflection`

- The symmetry fraction is computed from the expanded full-cell graph under all 48 signed
  permutations of the cubic cell. The current catalog contains `D2h` (8
  operations, displayed as `1/8 Reflection`), `D4h` (16 operations,
  `1/16 Symmetry`), and `Oh` (48 operations, `1/48 Symmetry`). The latter
  two include axis permutations/rotations, not just reflections.
- Technical point-group codes remain in metadata for analysis but are omitted
  from public names.
- The number is a single rank across the complete catalog, with no complexity
  bands. The primary key is full-cell member count, followed by full-cell node
  count and cycle rank. Variant count never affects the topology rank.
- The symmetry suffix describes the full-cell graph but does not restart or
  affect the global complexity numbering. It belongs to the unperturbed base
  skeleton; moving nodes can lower the symmetry of an individual variant.

The catalog also stores `full_cell_node_count`, `full_cell_edge_count`,
`average_degree`, `cycle_rank`, `symmetry_order`, and `symmetry_method` so the
classification can be inspected or regenerated with
`scripts/classify_topologies.py`.

## Variant attributes

Every full-index row retains the exact sparse `node_displacements` and `radius`
and now also exposes compact summaries:

- `perturbation_type`: `node-position + radius` or `radius-only`;
- `perturbation_max_norm`: largest Euclidean displacement of one moved node;
- `perturbation_rms_norm`: RMS Euclidean displacement over moved nodes;
- `density`: the accepted 32³ volume fraction (shown as VF in the UI).

The original ids remain available for audit and for joining to the property
records. Within a topology, identical node-displacement arrays form one node
geometry. Node geometries are sorted by RMS displacement, then maximum
displacement, moved-node count, and displacement coordinates. They are named
`G0001`, `G0002`, … . Within each geometry, radius results are sorted by
accepted VF (using record id to break ties) and named `R0001`, `R0002`, … .
The UI displays names such as `T-00001-1/48-Symmetry · G0001 · R0001` while the original
record id remains available for audit and property joins. Moving nodes does
not change the topology-complexity rank.
