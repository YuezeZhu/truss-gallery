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
records. Within each topology, variants are sorted by accepted VF ascending.
Records with equal VF use their original record id as a stable tie-breaker;
node displacement and radius are displayed as attributes, not sorting keys.
They receive deterministic per-topology names `V0001`, `V0002`, …; the
original record id remains available for audit and joins. The UI therefore
shows `T-C1-0001 · ... · V0001` without using a variant id as a complexity
rank.
