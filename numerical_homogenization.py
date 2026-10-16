"""Periodic voxel finite-element homogenization for one cubic unit cell.

The input is a boolean (N, N, N) array of solid *elements*, ordered x, y, z.
Opposite nodes share degrees of freedom.  The Voigt order is
``[xx, yy, zz, xy, yz, zx]`` with engineering shear strains.

This CPU/SciPy implementation replaces the original experimental Torch script,
which exited during assembly and hard-coded an unavailable CUDA data directory.
The original is retained as numerical_homogenization_torch_legacy.py.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import LinearOperator, cg


CORNER_BITS = np.array(
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
     [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], dtype=np.int64
)
VOIGT_ORDER = ["xx", "yy", "zz", "xy", "yz", "zx"]


def isotropic_elastic_tensor(young: float, poisson: float) -> np.ndarray:
    if young <= 0 or not (-1.0 < poisson < 0.5):
        raise ValueError("Require E > 0 and -1 < nu < 0.5")
    lam = young * poisson / ((1 + poisson) * (1 - 2 * poisson))
    mu = young / (2 * (1 + poisson))
    result = np.zeros((6, 6), dtype=np.float64)
    result[:3, :3] = lam
    result[np.arange(3), np.arange(3)] += 2 * mu
    result[3:, 3:] = np.eye(3) * mu
    return result


def hexahedron_matrices(n: int, elastic_tensor: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return the 24x24 trilinear element stiffness and 24x6 affine displacements."""
    h = 1.0 / n
    signs = CORNER_BITS.astype(np.float64) * 2 - 1
    ke = np.zeros((24, 24), dtype=np.float64)
    for xi in (-1 / np.sqrt(3), 1 / np.sqrt(3)):
        for eta in (-1 / np.sqrt(3), 1 / np.sqrt(3)):
            for zeta in (-1 / np.sqrt(3), 1 / np.sqrt(3)):
                sx, sy, sz = signs.T
                grad = np.stack((
                    sx * (1 + sy * eta) * (1 + sz * zeta),
                    sy * (1 + sx * xi) * (1 + sz * zeta),
                    sz * (1 + sx * xi) * (1 + sy * eta),
                ), axis=1) / (4 * h)
                b = np.zeros((6, 24), dtype=np.float64)
                for a, (dx, dy, dz) in enumerate(grad):
                    col = 3 * a
                    b[0, col] = dx
                    b[1, col + 1] = dy
                    b[2, col + 2] = dz
                    b[3, col:col + 2] = (dy, dx)
                    b[4, col + 1:col + 3] = (dz, dy)
                    b[5, col] = dz
                    b[5, col + 2] = dx
                ke += (h / 2) ** 3 * (b.T @ elastic_tensor @ b)

    affine = np.zeros((24, 6), dtype=np.float64)
    for a, (x, y, z) in enumerate(CORNER_BITS * h):
        p = 3 * a
        affine[p, 0] = x
        affine[p + 1, 1] = y
        affine[p + 2, 2] = z
        affine[p, 3], affine[p + 1, 3] = y / 2, x / 2
        affine[p + 1, 4], affine[p + 2, 4] = z / 2, y / 2
        affine[p, 5], affine[p + 2, 5] = z / 2, x / 2
    return ke, affine


def homogenize(
    voxel: np.ndarray,
    *,
    young: float = 1.0,
    poisson: float = 0.3,
    rtol: float = 1e-7,
    maxiter: int = 1200,
) -> dict:
    """Solve six periodic cell problems and return the effective 6x6 tensor."""
    start = time.perf_counter()
    voxel = np.asarray(voxel, dtype=bool)
    if voxel.ndim != 3 or len(set(voxel.shape)) != 1:
        raise ValueError("voxel must have shape (N, N, N)")
    n = voxel.shape[0]
    if n < 2 or not voxel.any():
        raise ValueError("Require a nonempty cubic voxel cell with N >= 2")

    c_base = isotropic_elastic_tensor(young, poisson)
    ke, affine = hexahedron_matrices(n, c_base)
    cells = np.argwhere(voxel).astype(np.int64)
    corners = (cells[:, None, :] + CORNER_BITS[None, :, :]) % n
    node_ids = np.ravel_multi_index(corners.reshape(-1, 3).T, (n, n, n))
    _, local_ids = np.unique(node_ids, return_inverse=True)
    ndof = 3 * (int(local_ids.max()) + 1)
    dof = (3 * local_ids.reshape(-1, 8, 1) + np.arange(3)).reshape(-1, 24)
    nelem = len(cells)

    rows = np.repeat(dof, 24, axis=1).ravel()
    cols = np.tile(dof, (1, 24)).ravel()
    values = np.broadcast_to(ke, (nelem, 24, 24)).ravel()
    stiffness = sparse.coo_matrix((values, (rows, cols)), shape=(ndof, ndof)).tocsr()
    del rows, cols, values

    nodal_force = ke @ affine
    rhs = np.zeros((ndof, 6), dtype=np.float64)
    np.add.at(rhs, dof.ravel(), -np.tile(nodal_force, (nelem, 1)))

    # Remove translation and stabilize truly free mechanisms. The ridge is eight
    # orders below a typical diagonal entry; it is reported in the metadata.
    free = np.arange(3, ndof)
    diagonal = stiffness.diagonal()[free]
    ridge = 1e-9 * float(diagonal.max())
    reduced = stiffness[free, :][:, free] + ridge * sparse.eye(len(free), format="csr")
    preconditioner = LinearOperator(
        reduced.shape, matvec=lambda x: x / reduced.diagonal(), dtype=np.float64
    )
    fluctuation = np.zeros((ndof, 6), dtype=np.float64)
    iterations = []
    residuals = []
    for case in range(6):
        count = [0]
        def tick(_x: np.ndarray) -> None:
            count[0] += 1
        solution, status = cg(
            reduced, rhs[free, case], M=preconditioner,
            rtol=rtol, atol=0.0, maxiter=maxiter, callback=tick,
        )
        relative_residual = float(
            np.linalg.norm(reduced @ solution - rhs[free, case])
            / max(np.linalg.norm(rhs[free, case]), 1e-30)
        )
        if status != 0 or relative_residual > 5 * rtol:
            raise RuntimeError(
                f"CG failed for {VOIGT_ORDER[case]}: status={status}, "
                f"iterations={count[0]}, residual={relative_residual:.3g}"
            )
        fluctuation[free, case] = solution
        iterations.append(count[0])
        residuals.append(relative_residual)

    total_u = affine[None, :, :] + fluctuation[dof]
    ke_u = np.einsum("ab,ebj->eaj", ke, total_u, optimize=True)
    c_eff = np.einsum("eai,eaj->ij", total_u, ke_u, optimize=True)
    c_eff = (c_eff + c_eff.T) / 2
    return {
        "C_H": c_eff.tolist(),
        "C_base": c_base.tolist(),
        "voigt_order": VOIGT_ORDER,
        "young": young,
        "poisson": poisson,
        "relative_density": float(voxel.mean()),
        "resolution": n,
        "solid_elements": nelem,
        "active_dofs": ndof,
        "cg_iterations": iterations,
        "relative_residuals": residuals,
        "regularization_diagonal": ridge,
        "wall_seconds": time.perf_counter() - start,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("voxel", type=Path, help="Boolean (N,N,N) .npy voxel file")
    parser.add_argument("--output", type=Path, required=True, help="JSON result path")
    parser.add_argument("--young", type=float, default=1.0)
    parser.add_argument("--poisson", type=float, default=0.3)
    parser.add_argument("--rtol", type=float, default=1e-7)
    parser.add_argument("--maxiter", type=int, default=1200)
    args = parser.parse_args()
    result = homogenize(
        np.load(args.voxel), young=args.young, poisson=args.poisson,
        rtol=args.rtol, maxiter=args.maxiter,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} ({result['wall_seconds']:.1f} s)")


if __name__ == "__main__":
    main()
