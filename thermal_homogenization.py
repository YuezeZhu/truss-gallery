"""Periodic voxel homogenization of effective thermal conductivity.

The input is a boolean ``(N, N, N)`` array of solid hexahedral elements.
Opposite nodes share a degree of freedom.  The solid conductivity is isotropic;
void elements are omitted, matching the zero-void-conductivity assumption in
the Torch reference supplied with the project.

The returned ``K_H`` tensor uses Cartesian order ``[x, y, z]`` and is
normalized by the unit-cell volume.  With ``solid_conductivity=1``, a fully
solid cell therefore returns the 3x3 identity matrix.
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
     [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    dtype=np.int64,
)
AXIS_ORDER = ["x", "y", "z"]


def hexahedron_matrices(
    n: int, conductivity_tensor: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Return the 8x8 scalar element matrix and three affine fields."""
    h = 1.0 / n
    signs = CORNER_BITS.astype(np.float64) * 2 - 1
    ke = np.zeros((8, 8), dtype=np.float64)
    gauss = (-1 / np.sqrt(3), 1 / np.sqrt(3))
    for xi in gauss:
        for eta in gauss:
            for zeta in gauss:
                sx, sy, sz = signs.T
                grad = np.stack((
                    sx * (1 + sy * eta) * (1 + sz * zeta),
                    sy * (1 + sx * xi) * (1 + sz * zeta),
                    sz * (1 + sx * xi) * (1 + sy * eta),
                ), axis=1) / (4 * h)
                ke += (h / 2) ** 3 * (grad @ conductivity_tensor @ grad.T)

    # Exact nodal values for the three unit macroscopic temperature gradients.
    affine = CORNER_BITS.astype(np.float64) * h
    return ke, affine


def homogenize(
    voxel: np.ndarray,
    *,
    solid_conductivity: float = 1.0,
    rtol: float = 1e-8,
    maxiter: int = 1600,
) -> dict:
    """Solve three periodic cell problems and return effective conductivity."""
    start = time.perf_counter()
    voxel = np.asarray(voxel, dtype=bool)
    if voxel.ndim != 3 or len(set(voxel.shape)) != 1:
        raise ValueError("voxel must have shape (N, N, N)")
    n = voxel.shape[0]
    if n < 2 or not voxel.any():
        raise ValueError("Require a nonempty cubic voxel cell with N >= 2")
    if solid_conductivity <= 0:
        raise ValueError("solid_conductivity must be positive")

    k_base = np.eye(3, dtype=np.float64) * solid_conductivity
    ke, affine = hexahedron_matrices(n, k_base)
    cells = np.argwhere(voxel).astype(np.int64)
    corners = (cells[:, None, :] + CORNER_BITS[None, :, :]) % n
    node_ids = np.ravel_multi_index(corners.reshape(-1, 3).T, (n, n, n))
    _, local_ids = np.unique(node_ids, return_inverse=True)
    dof = local_ids.reshape(-1, 8)
    ndof = int(local_ids.max()) + 1
    nelem = len(cells)

    rows = np.repeat(dof, 8, axis=1).ravel()
    cols = np.tile(dof, (1, 8)).ravel()
    values = np.broadcast_to(ke, (nelem, 8, 8)).ravel()
    matrix = sparse.coo_matrix(
        (values, (rows, cols)), shape=(ndof, ndof)
    ).tocsr()
    del rows, cols, values

    element_force = ke @ affine
    rhs = np.zeros((ndof, 3), dtype=np.float64)
    np.add.at(rhs, dof.ravel(), np.tile(element_force, (nelem, 1)))

    # Fix the constant-temperature null mode.  A tiny ridge also stabilizes
    # separate solid components without assigning a physical conductivity to
    # the void phase.
    free = np.arange(1, ndof)
    diagonal = matrix.diagonal()[free]
    ridge = 1e-10 * float(diagonal.max())
    reduced = matrix[free, :][:, free] + ridge * sparse.eye(
        len(free), format="csr"
    )
    reduced_diagonal = reduced.diagonal()
    preconditioner = LinearOperator(
        reduced.shape,
        matvec=lambda x: x / reduced_diagonal,
        dtype=np.float64,
    )

    correction = np.zeros((ndof, 3), dtype=np.float64)
    iterations: list[int] = []
    residuals: list[float] = []
    for case in range(3):
        count = [0]

        def tick(_x: np.ndarray) -> None:
            count[0] += 1

        solution, status = cg(
            reduced,
            rhs[free, case],
            M=preconditioner,
            rtol=rtol,
            atol=0.0,
            maxiter=maxiter,
            callback=tick,
        )
        denominator = max(float(np.linalg.norm(rhs[free, case])), 1e-30)
        relative_residual = float(
            np.linalg.norm(reduced @ solution - rhs[free, case]) / denominator
        )
        if status != 0 or relative_residual > 5 * rtol:
            raise RuntimeError(
                f"CG failed for {AXIS_ORDER[case]}: status={status}, "
                f"iterations={count[0]}, residual={relative_residual:.3g}"
            )
        correction[free, case] = solution
        iterations.append(count[0])
        residuals.append(relative_residual)

    local_fields = affine[None, :, :] - correction[dof]
    ke_fields = np.einsum("ab,ebj->eaj", ke, local_fields, optimize=True)
    k_eff = np.einsum(
        "eai,eaj->ij", local_fields, ke_fields, optimize=True
    )
    k_eff = (k_eff + k_eff.T) / 2
    return {
        "K_H": k_eff.tolist(),
        "K_base": k_base.tolist(),
        "axis_order": AXIS_ORDER,
        "solid_conductivity": solid_conductivity,
        "void_conductivity": 0.0,
        "relative_density": float(voxel.mean()),
        "resolution": n,
        "solid_elements": nelem,
        "active_temperature_dofs": ndof,
        "cg_iterations": iterations,
        "relative_residuals": residuals,
        "regularization_diagonal": ridge,
        "wall_seconds": time.perf_counter() - start,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("voxel", type=Path, help="Boolean (N,N,N) .npy file")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--solid-conductivity", type=float, default=1.0)
    parser.add_argument("--rtol", type=float, default=1e-8)
    parser.add_argument("--maxiter", type=int, default=1600)
    args = parser.parse_args()
    result = homogenize(
        np.load(args.voxel),
        solid_conductivity=args.solid_conductivity,
        rtol=args.rtol,
        maxiter=args.maxiter,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} ({result['wall_seconds']:.1f} s)")


if __name__ == "__main__":
    main()
