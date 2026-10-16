# TPMS-32 compact dataset

This adapter uses `source/TPMS_generate.py`, copied unchanged from the user’s
attachment (SHA256 `26b88948792eb01fd4e4843c90938938f5cf70fa3e1c18f665ad00bbd8d8d784`).
The source is imported as a library; its example and mesh-repair routine are
not executed. The desktop original is never modified.

## Generation and diversity

Nine family/mode combinations: five sheet bands (Gyroid, Diamond, Lidinoid,
Split-P, Primitive) and four solid phases (Gyroid, Diamond, Primitive, Body
Diagonals). Alias names with identical formulas do not create extra families.
There are 512 deterministic shape parameter sets per family, not 4,608 proven
distinct topologies. A bounded, invertible periodic coordinate warp changes
shape. Sheet level offsets additionally vary the reference surface. These are
TPMS-derived implicit geometries, not certified exact minimal surfaces.

For sheet samples, `threshold` is a scalar-field halfwidth. It is **not a
constant physical wall thickness**. For solid samples, the material is the
positive phase selected by an isovalue. The actual 32^3 VF is tuned by order
statistics without randomly breaking ties or editing individual voxels.

Goal: 100,000 accepted unique samples in VF [0.05, 0.35). Each of 10 coarse
3-percentage-point bins has 10,000 samples. Each contains 30 fine bins of width
0.001, with exact target counts repeating 334,333,333. This measures density
coverage at 0.1 percentage-point resolution; it does not assert mathematically
continuous VF on a finite binary grid.

## Quality and properties

- Material components are checked under six-neighbor periodic connectivity.
  A correctly cut periodic surface may have several pieces within one cell;
  all must join into **one** periodic material component. Winding rank must be
  three, not merely one contact on each axis.
- All six voxel faces must contain material. The analytic field agrees at
  corresponding exact boundary coordinates. First/last voxel-center layers
  need not be identical: those are different coordinates, not the exact faces.
- No cubic point-group symmetry is assumed or mislabeled after warping.
- Raw 32^3 hashes and canonical hashes under all 48 signed cube permutations
  reject exact and rotation/reflection-equivalent duplicates before solves.
- Reuse the Truss periodic hexahedral FE solvers without modifying them:
  E0=1, nu=0.3, k0=1, void stiffness/conductivity omitted. Require converged
  residuals, finite tensors, positive eigenvalues >1e-8, and Voigt energy bounds.
- Six-dimensional Voigt order: xx, yy, zz, xy, yz, zx (engineering shear).
  E is the mean of 1/S11, 1/S22, 1/S33, where S=inv(C_H).

The initial 100 fully solved records all reconstructed bit-exactly, with 10
records per coarse VF bin and no raw or cube-symmetry-equivalent duplicates.
One family having no passing samples does not cause screening to be relaxed.

## Storage and commands

Data: `records.sqlite` under `TPMS_DATA_DIR` (defaults to
`D:/yueze/LatticeDataset/native_runs/tpms100k_analytic/records.sqlite`).
Only formula IDs, geometry/threshold parameters, upper-triangle C_H/K_H,
engineering moduli and compact quality metadata are persisted. No per-sample
voxel grid, SDF, OBJ or STL is saved. Frozen source and geometry/solver hashes
are recorded in `provenance.json`. A changed kernel cannot silently resume an
existing nonempty dataset.

Run from the repository root after installing `tpms100k/requirements.txt`:

```powershell
python -m unittest tpms100k.tests -v
python -m tpms100k.generate probe --per-cell 5
python -m tpms100k.generate run --workers 32 --stop-after 100
python -m tpms100k.generate run --workers 32
python -m tpms100k.generate audit
python -m tpms100k.publish
```

`live.json` is an atomic progress snapshot. `generation.log` and
`generation.err` belong to the launched background production run. A Windows
file lock prevents a second producer. Creating `stop.request` in the dataset
directory drains in-flight solves and stops safely; remove that request before
resuming. The database uses WAL and can serve the local gallery while writing.

Local gallery: `http://localhost:4173/#tpms-browser`. Browse family -> shape
perturbation -> VF result. The TPMS gallery can switch between formula families
and a searchable, paginated index of all shape configurations, with a live 3D
preview per shape. Every stored record is accessible through paginated queries,
not only representative variants. The MC preview evaluates the same implicit
geometry on an 80^3 node grid; homogenized properties use the saved 32^3
element-center geometry. Meshes are generated in memory and never reused as
solver input. Charts are regenerated every five minutes; use the gallery
refresh button to fetch the latest catalog and chart images.

The full interactive gallery uses the local Python API. Start it from this
repository with `node scripts/local_server.mjs 4173`; set `TPMS_DATA_DIR` to the
folder containing `records.sqlite` and `live.json` when using another location.
GitHub Pages only serves static files and does not run these API routes.
