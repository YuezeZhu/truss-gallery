"""Generate gallery metadata and WebP geometry renders from Truss-32 voxels."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image
import vtk
from vtk.util import numpy_support


ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "datasets" / "truss32"
SITE = ROOT / "truss-gallery"
DIST = SITE / "dist"
COLORS = {
    "panetta": (0.28, 0.72, 1.0),
    "eth": (1.0, 0.57, 0.23),
}


def render_voxel(voxel: np.ndarray, output: Path, source: str, size: int = 420) -> None:
    padded = np.pad(np.asarray(voxel, dtype=np.uint8), 1)
    image = vtk.vtkImageData()
    image.SetDimensions(*padded.shape)
    image.SetSpacing(1.0, 1.0, 1.0)
    scalars = numpy_support.numpy_to_vtk(
        padded.ravel(order="F"), deep=True, array_type=vtk.VTK_UNSIGNED_CHAR
    )
    image.GetPointData().SetScalars(scalars)

    surface = vtk.vtkFlyingEdges3D()
    surface.SetInputData(image)
    surface.SetValue(0, 0.5)
    surface.ComputeNormalsOn()

    normals = vtk.vtkPolyDataNormals()
    normals.SetInputConnection(surface.GetOutputPort())
    normals.SetFeatureAngle(50)
    normals.SplittingOff()

    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(normals.GetOutputPort())
    mapper.ScalarVisibilityOff()
    actor = vtk.vtkActor()
    actor.SetMapper(mapper)
    actor.GetProperty().SetColor(*COLORS[source])
    actor.GetProperty().SetInterpolationToPBR()
    actor.GetProperty().SetMetallic(0.08)
    actor.GetProperty().SetRoughness(0.38)

    outline_source = vtk.vtkOutlineSource()
    outline_source.SetBounds(0.5, 32.5, 0.5, 32.5, 0.5, 32.5)
    outline_mapper = vtk.vtkPolyDataMapper()
    outline_mapper.SetInputConnection(outline_source.GetOutputPort())
    outline = vtk.vtkActor()
    outline.SetMapper(outline_mapper)
    outline.GetProperty().SetColor(0.45, 0.55, 0.67)
    outline.GetProperty().SetOpacity(0.32)
    outline.GetProperty().SetLineWidth(1.0)

    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.027, 0.047, 0.078)
    renderer.SetBackground2(0.065, 0.095, 0.14)
    renderer.GradientBackgroundOn()
    renderer.AddActor(actor)
    renderer.AddActor(outline)
    renderer.SetUseDepthPeeling(True)
    renderer.SetMaximumNumberOfPeels(32)
    renderer.SetOcclusionRatio(0.1)

    camera = renderer.GetActiveCamera()
    camera.SetPosition(70, -68, 58)
    camera.SetFocalPoint(16.5, 16.5, 16.5)
    camera.SetViewUp(0, 0, 1)
    camera.ParallelProjectionOn()
    camera.SetParallelScale(27)

    light = vtk.vtkLight()
    light.SetLightTypeToSceneLight()
    light.SetPosition(40, -35, 80)
    light.SetFocalPoint(16, 16, 16)
    light.SetIntensity(1.1)
    renderer.AddLight(light)

    fill = vtk.vtkLight()
    fill.SetLightTypeToSceneLight()
    fill.SetPosition(-50, 10, 25)
    fill.SetFocalPoint(16, 16, 16)
    fill.SetIntensity(0.45)
    renderer.AddLight(fill)

    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(True)
    window.SetSize(size, size)
    window.SetMultiSamples(4)
    window.AddRenderer(renderer)
    window.Render()

    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGB()
    capture.ReadFrontBufferOff()
    capture.Update()

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temporary:
        png_path = Path(temporary.name)
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(png_path))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()
    with Image.open(png_path) as rendered:
        rendered.save(output, "WEBP", quality=82, method=6)
    png_path.unlink(missing_ok=True)
    window.Finalize()


def tensor_diagonal(matrix: list[list[float]]) -> list[float]:
    array = np.asarray(matrix, dtype=np.float64)
    return np.diag(array).tolist()


def build_sample(source: str, directory: Path, image_dir: Path, force: bool) -> dict:
    metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
    mechanical = json.loads((directory / "mechanical.json").read_text(encoding="utf-8"))
    thermal = json.loads((directory / "thermal.json").read_text(encoding="utf-8"))
    voxel = np.load(directory / "voxel_32.npy")
    sample_id = metadata["sample_id"]
    image_path = image_dir / f"{sample_id}.webp"
    if force or not image_path.is_file():
        render_voxel(voxel, image_path, source)

    source_mechanical = None
    source_path = directory / "mechanical_source.json"
    if source_path.is_file():
        source_mechanical = json.loads(source_path.read_text(encoding="utf-8"))

    c_eff = np.asarray(mechanical["C_H"], dtype=np.float64)
    k_eff = np.asarray(thermal["K_H"], dtype=np.float64)
    return {
        "id": sample_id,
        "source": source,
        "sourceLabel": "Panetta / MeshFEM" if source == "panetta" else "ETH Zürich",
        "image": f"images/{sample_id}.webp",
        "density": float(voxel.mean()),
        "solidVoxels": int(voxel.sum()),
        "voxelHash": hashlib.sha256(voxel.tobytes()).hexdigest()[:12],
        "C": c_eff.tolist(),
        "Cdiag": np.diag(c_eff).tolist(),
        "K": k_eff.tolist(),
        "Kdiag": np.diag(k_eff).tolist(),
        "minC": float(np.linalg.eigvalsh(c_eff).min()),
        "minK": float(np.linalg.eigvalsh(k_eff).min()),
        "mechanicalResidual": float(max(mechanical["relative_residuals"])),
        "thermalResidual": float(max(thermal["relative_residuals"])),
        "mechanicalIterations": mechanical["cg_iterations"],
        "thermalIterations": thermal["cg_iterations"],
        "sourceCdiag": tensor_diagonal(source_mechanical["C_H_orthotropic"])
        if source_mechanical else None,
        "sourceSampleIndex": metadata.get("source_sample_index"),
        "skeletonEdges": metadata.get("full_skeleton_edges"),
        "targetDensity": metadata.get("target_relative_density"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    image_dir = DIST / "images"
    data_dir = DIST / "data"
    samples: list[dict] = []
    for source in ("panetta", "eth"):
        manifest = json.loads((DATASET / source / "manifest.json").read_text(encoding="utf-8"))
        records = [x for x in manifest["records"] if x.get("status") == "accepted"]
        for number, record in enumerate(records, 1):
            print(f"[{source} {number}/{len(records)}] {record['sample_id']}", flush=True)
            samples.append(
                build_sample(
                    source,
                    DATASET / source / record["sample_id"],
                    image_dir,
                    args.force,
                )
            )

    samples.sort(key=lambda item: (item["source"], item["id"]))
    densities = [item["density"] for item in samples]
    payload = {
        "generatedFrom": "datasets/truss32",
        "resolution": 32,
        "sampleCount": len(samples),
        "uniqueVoxelCount": len({item["voxelHash"] for item in samples}),
        "densityRange": [min(densities), max(densities)],
        "samples": samples,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "samples.json").write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Wrote {len(samples)} samples to {data_dir / 'samples.json'}")


if __name__ == "__main__":
    main()
