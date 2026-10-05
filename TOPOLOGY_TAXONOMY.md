# Topology taxonomy

The gallery keeps the original `topology_id` values as immutable provenance
keys.  The public `display_name` is a separate taxonomy name and does not
change the sample index or the reproducibility path.

## Name format

`<Readable symmetry> · Complexity <level> · <ordinal>`

Examples:

- `Cubic · Complexity 1 · 0001 (Oh)`
- `Tetragonal · Complexity 3 · 0012 (D4h)`
- `Orthorhombic · Complexity 5 · 0420 (D2h)`

- The readable symmetry name is computed from the expanded full-cell graph under all 48 signed
  permutations of the cubic cell.  The current catalog contains `D2h` (8
  operations), `D4h` (16 operations), and `Oh` (48 operations).
- The technical point-group code remains in parentheses so that the name is
  understandable to non-specialists without losing crystallographic precision.
- `C1`–`C5` is a graph-complexity band.  The primary key is full-cell member
  count, followed by full-cell node count and cycle rank.  Bands are quintiles
  of the complete catalog, so a variant count never affects the topology rank.
- The final ordinal only disambiguates names inside one symmetry/complexity
  bucket; it is not a complexity score.

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
records.  The UI uses the taxonomy name for topology cards and variant labels,
while the original id is not used as a complexity rank.
