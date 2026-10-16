# tpms_trimesh.py
import numpy as np
from skimage import measure
import trimesh
from typing import Sequence, Tuple, Optional


# -----------------------------
# 1) 你的 TPMS 函数库
# -----------------------------
def tpms_library(X, Y, Z, c, tpms_design, cell_sizes, origin, silent=False):
    w_x = 1 / cell_sizes[0] * 2 * np.pi
    w_y = 1 / cell_sizes[1] * 2 * np.pi
    w_z = 1 / cell_sizes[2] * 2 * np.pi

    if tpms_design == 'Skeletal-TPMS Schoen gyroid' or tpms_design == 'Shell-TPMS Gyroid':
        F = (np.cos(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) +
             np.cos(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) +
             np.cos(w_z * (Z + origin[2])) * np.sin(w_x * (X + origin[0])) - c)
        t = 0.125

    elif tpms_design == 'Skeletal-TPMS Schwarz diamond':
        F = (np.cos(w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
             np.sin(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) - c)
        t = 0

    elif tpms_design == 'Skeletal-TPMS Schwarz primitive (pinched)' or tpms_design == 'Skeletal-TPMS Schwarz primitive':
        F = (np.cos(w_x * (X + origin[0])) + np.cos(w_y * (Y + origin[1])) + np.cos(w_z * (Z + origin[2])) - c)
        t = 0

    elif tpms_design == 'Skeletal-TPMS Body diagonals with nodes':
        F = (2 * (np.cos(w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) +
                  np.cos(w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
                  np.cos(w_z * (Z + origin[2])) * np.cos(w_x * (X + origin[0]))) -
             (np.cos(2 * w_x * (X + origin[0])) + np.cos(2 * w_y * (Y + origin[1])) + np.cos(2 * w_z * (Z + origin[2]))) - c)
        t = 0

    elif tpms_design == 'Shell-TPMS Diamond':
        F = (np.sin(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) +
             np.sin(w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
             np.cos(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
             np.cos(w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) - c)
        t = 0.115

    elif tpms_design == 'Shell-TPMS Lidinoid':
        F = (np.sin(2 * w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) +
             np.sin(w_x * (X + origin[0])) * np.sin(2 * w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
             np.cos(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) * np.sin(2 * w_z * (Z + origin[2])) -
             np.cos(2 * w_x * (X + origin[0])) * np.cos(2 * w_y * (Y + origin[1])) -
             np.cos(2 * w_y * (Y + origin[1])) * np.cos(2 * w_z * (Z + origin[2])) -
             np.cos(2 * w_z * (Z + origin[2])) * np.cos(2 * w_x * (X + origin[0])) + 0.3 - c)
        t = 0.37

    elif tpms_design == 'Shell-TPMS Split-P':
        F = (1.1 * (np.sin(2 * w_x * (X + origin[0])) * np.cos(w_y * (Y + origin[1])) * np.sin(w_z * (Z + origin[2])) +
                    np.sin(w_x * (X + origin[0])) * np.sin(2 * w_y * (Y + origin[1])) * np.cos(w_z * (Z + origin[2])) +
                    np.cos(w_x * (X + origin[0])) * np.sin(w_y * (Y + origin[1])) * np.sin(2 * w_z * (Z + origin[2]))) -
             0.2 * (np.cos(2 * w_x * (X + origin[0])) * np.cos(2 * w_y * (Y + origin[1])) +
                    np.cos(2 * w_y * (Y + origin[1])) * np.cos(2 * w_z * (Z + origin[2])) +
                    np.cos(2 * w_z * (Z + origin[2])) * np.cos(2 * w_x * (X + origin[0]))) -
             0.4 * (np.cos(2 * w_x * (X + origin[0])) + np.cos(2 * w_y * (Y + origin[1])) + np.cos(2 * w_z * (Z + origin[2]))) - c)
        t = 0.19

    elif tpms_design == 'Shell-TPMS Schwarz':
        F = (np.cos(w_x * (X + origin[0])) + np.cos(w_y * (Y + origin[1])) + np.cos(w_z * (Z + origin[2])) - c)
        t = 0.0875

    else:
        if not silent:
            print('Design not found in library')
        F = 0
        t = 0

    return F, t


# -----------------------------
# 2) 网格生成与体素场
# -----------------------------
def make_grid(
    n_cells: Sequence[int]=(3,3,3),
    cell_sizes: Sequence[float]=(10.0,10.0,10.0),
    samples_per_cell: Sequence[int]=(60,60,60),
):
    n_cells = np.array(n_cells, int)
    cell_sizes = np.array(cell_sizes, float)
    samples_per_cell = np.array(samples_per_cell, int)

    L = n_cells * cell_sizes              # 盒子总尺寸
    N = n_cells * samples_per_cell        # 各向采样点数
    Nx, Ny, Nz = N.tolist()

    xs = np.linspace(0.0, L[0], Nx, endpoint=True)
    ys = np.linspace(0.0, L[1], Ny, endpoint=True)
    zs = np.linspace(0.0, L[2], Nz, endpoint=True)

    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')

    spacing = (
        (xs[1] - xs[0]) if Nx > 1 else 1.0,
        (ys[1] - ys[0]) if Ny > 1 else 1.0,
        (zs[1] - zs[0]) if Nz > 1 else 1.0,
    )
    return X, Y, Z, spacing


def build_scalar_field(
    tpms_design: str,
    cell_sizes: Sequence[float],
    c: float,
    X: np.ndarray, Y: np.ndarray, Z: np.ndarray,
    thickness_value: Optional[float]=None
):
    F, builtin_t = tpms_library(X, Y, Z, c=c,
                                tpms_design=tpms_design,
                                cell_sizes=cell_sizes,
                                origin=(0,0,0))
    # 厚壳：G = thickness - |F|，取 G=0 ↔ |F| = thickness
    if thickness_value is not None and thickness_value > 0:
        volume = (thickness_value - np.abs(F)).astype(np.float32)
        level = 0.0
    else:
        volume = F.astype(np.float32)
        level = 0.0  # F=0
    return volume, level, builtin_t


# -----------------------------
# 3) marching cubes + trimesh 导出
# -----------------------------
def mc_to_trimesh(
    volume: np.ndarray,
    level: float,
    spacing: Tuple[float, float, float]
) -> trimesh.Trimesh:
    """
    使用 scikit-image marching cubes，返回处理后的 trimesh.Trimesh
    """
    volume = np.pad(
        volume, 1, mode="constant",
        constant_values=level-1e5  # 一个远离等值面的常数
    )
    # skimage 返回的顶点已经乘了 spacing
    verts, faces, normals, _ = measure.marching_cubes(
        volume, level=level, spacing=spacing
    )

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)

    # 轻量清理：修复法向、合并重复点、删除退化三角形
    mesh.remove_degenerate_faces()
    mesh.remove_duplicate_faces()
    mesh.remove_infinite_values()
    mesh.remove_unreferenced_vertices()
    mesh.rezero()  # 平移到靠近原点，避免大坐标带来的精度问题

    # 尝试修复非流形/空洞（可按需开启）
    # 这一步可能比较耗时，但能显著提高打印/CAE 兼容性
    trimesh.repair.fill_holes(mesh)
    trimesh.repair.fix_inversion(mesh)
    trimesh.repair.fix_normals(mesh)
    # 可选：如果需要严格 watertight，可尝试：
    # trimesh.repair.fill_holes(mesh)
    # 如果仍不 watertight，可用 boolean/voxel 等更强力手段（我可以再给你范例）

    return mesh


def export_mesh(
    mesh: trimesh.Trimesh,
    out_path: str = "tpms.stl"
):
    """
    根据后缀导出 STL/OBJ/PLY 等。STL 默认二进制。
    """
    ext = out_path.split(".")[-1].lower()
    if ext == "stl":
        mesh.export(out_path)  # 默认二进制 STL
    elif ext in ("obj", "ply", "glb", "gltf"):
        mesh.export(out_path)
    else:
        # 未知后缀就按 STL 导出
        out_path = out_path + ".stl"
        mesh.export(out_path)
    return out_path


# -----------------------------
# 4) 一键生成
# -----------------------------
def generate_tpms(
    tpms_design: str = "Shell-TPMS Gyroid",
    n_cells: Sequence[int]=(3,3,3),
    cell_sizes: Sequence[float]=(10.0,10.0,10.0),   # 物理单位（比如 mm）
    samples_per_cell: Sequence[int]=(60,60,60),
    c: float = 0.0,
    thickness_value: Optional[float]=None,          # None/<=0 → F=0；>0 → |F|=thickness
    out_path: str = "tpms_trimesh.stl",
):
    X, Y, Z, spacing = make_grid(
        n_cells=n_cells,
        cell_sizes=cell_sizes,
        samples_per_cell=samples_per_cell
    )
    volume, level, builtin_t = build_scalar_field(
        tpms_design=tpms_design,
        cell_sizes=cell_sizes,
        c=c,
        X=X, Y=Y, Z=Z,
        thickness_value=thickness_value
    )
    mesh = mc_to_trimesh(volume, level, spacing)
    out = export_mesh(mesh, out_path)
    print(f"[OK] 输出: {out}")
    print(f"网格统计：顶点 {len(mesh.vertices)}, 三角形 {len(mesh.faces)}, watertight={mesh.is_watertight}")
    print(f"建议函数厚度 t = {builtin_t}")
    return mesh, builtin_t


if __name__ == "__main__":
    # 示例 1：Gyroid，F=0 表面
    # generate_tpms(
    #     tpms_design="Shell-TPMS Gyroid",
    #     n_cells=(3,3,3),
    #     cell_sizes=(10.0,10.0,10.0),
    #     samples_per_cell=(64,64,64),
    #     c=0.0,
    #     thickness_value=None,                       # F=0
    #     out_path="tpms_gyroid_surface_trimesh.stl"
    # )

    # 示例 2：Gyroid，“厚壳” |F| = t 的双层边界
    _, t0 = generate_tpms(
        tpms_design="Shell-TPMS Diamond",
        n_cells=(3,3,3),
        cell_sizes=(10.0,10.0,10.0),
        samples_per_cell=(64,64,64),
        c=0.0,
        thickness_value=0.1,                      # 也可以用上一行返回的 t0
        out_path="tpms_gyroid_shell_trimesh.stl"
    )
