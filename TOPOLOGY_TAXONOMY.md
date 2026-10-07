# Topology taxonomy

The gallery keeps the original `topology_id` values as immutable provenance
keys.  The public `display_name` is a separate taxonomy name and does not
change the sample index or the reproducibility path.

## Two-level names

Topology names use the simple-to-complex order:

`T-C<level>-<ordinal> · <Readable symmetry> (<point-group>)`

Examples:

- `T-C1-0001 · Cubic symmetry (Oh)`
- `T-C3-0012 · Tetragonal symmetry (D4h)`
- `T-C5-0420 · Orthorhombic symmetry (D2h)`

- The readable symmetry name is computed from the expanded full-cell graph under all 48 signed
  permutations of the cubic cell.  The current catalog contains `D2h` (8
  operations), `D4h` (16 operations), and `Oh` (48 operations).
- The technical point-group code remains in parentheses so that the name is
  understandable to non-specialists without losing crystallographic precision.
- `C1`–`C5` is a graph-complexity band.  The primary key is full-cell member
  count, followed by full-cell node count and cycle rank.  Bands are quintiles
  of the complete catalog, so a variant count never affects the topology rank.
- The topology ordinal is counted within the complexity level, so `T-C1-*`
  always appears before `T-C2-*`. It is not a substitute for the underlying
  complexity metrics.

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
The UI displays names such as `T-C1-0001 · G0001 · R0001` while the original
record id remains available for audit and property joins. Moving nodes does
not change the topology-complexity rank.
