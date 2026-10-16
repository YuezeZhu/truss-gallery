"""Frozen v1 periodic analytical TPMS geometry, without persisted grids.

The user's formulas are unchanged. An optional, bounded periodic coordinate
warp changes shape, and a scalar threshold selects a solid phase or sheet.
`halfwidth` is an implicit-field value, NOT a physical wall thickness.
These are TPMS-derived level sets, not certified exact minimal surfaces.
"""
from __future__ import annotations

import hashlib
import importlib.util
import itertools
from pathlib import Path
import numpy as np
from scipy.ndimage import label, generate_binary_structure

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source" / "TPMS_generate.py"
SOURCE_SHA256 = "26b88948792eb01fd4e4843c90938938f5cf70fa3e1c18f665ad00bbd8d8d784"
VERSION = "tpms-periodic-warp-v1"
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
    raise RuntimeError("The frozen TPMS formula source changed")
_spec = importlib.util.spec_from_file_location("tpms_user_source", SOURCE)
_library = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_library)

FAMILIES = [
    {"id":"gyroid-sheet","name":"Gyroid Sheet","design":"Shell-TPMS Gyroid","mode":"sheet"},
    {"id":"diamond-sheet","name":"Diamond Sheet","design":"Shell-TPMS Diamond","mode":"sheet"},
    {"id":"lidinoid-sheet","name":"Lidinoid Sheet","design":"Shell-TPMS Lidinoid","mode":"sheet"},
    {"id":"splitp-sheet","name":"Split-P Sheet","design":"Shell-TPMS Split-P","mode":"sheet"},
    {"id":"primitive-sheet","name":"Primitive Sheet","design":"Shell-TPMS Schwarz","mode":"sheet"},
    {"id":"gyroid-solid","name":"Gyroid Skeletal","design":"Skeletal-TPMS Schoen gyroid","mode":"solid"},
    {"id":"diamond-solid","name":"Diamond Skeletal","design":"Skeletal-TPMS Schwarz diamond","mode":"solid"},
    {"id":"primitive-solid","name":"Primitive Skeletal","design":"Skeletal-TPMS Schwarz primitive","mode":"solid"},
    {"id":"bodydiagonal-solid","name":"Body Diagonals Skeletal","design":"Skeletal-TPMS Body diagonals with nodes","mode":"solid"},
]
BY_ID = {r["id"]:r for r in FAMILIES}

def parameters(family_id: str, geometry_index: int, *, seed: int=20261015) -> dict:
    """512 distinct deterministic shape draws per family; no phase-only draws."""
    f = list(BY_ID).index(family_id)
    rng=np.random.default_rng(np.random.SeedSequence([seed,f,geometry_index]))
    a=rng.uniform(-.04,.04,3) if geometry_index else np.zeros(3)
    b=rng.uniform(-.012,.012,3) if geometry_index else np.zeros(3)
    offset=float(rng.uniform(-.2,.2)) if BY_ID[family_id]["mode"]=="sheet" and geometry_index else 0.0
    return {"version":VERSION,"family_id":family_id,"geometry_index":geometry_index,
            "warp_a":a.tolist(),"warp_b":b.tolist(),"surface_offset":offset}

def field(params: dict, resolution: int=32, *, grid="centers") -> np.ndarray:
    if params["version"]!=VERSION: raise ValueError("Unknown geometry version")
    axis=(np.arange(resolution,dtype=float)+.5)/resolution if grid=="centers" else np.linspace(0,1,resolution)
    return field_points(params,*np.meshgrid(axis,axis,axis,indexing="ij"))

def field_points(params, x,y,z):
    coords=[x,y,z]; warped=[]
    for i in range(3):
        own=coords[i]; nxt=coords[(i+1)%3]; other=coords[(i+2)%3]
        warped.append(own+params["warp_a"][i]*np.sin(2*np.pi*own)*(.65+.35*np.cos(2*np.pi*nxt))
                      +params["warp_b"][i]*np.sin(4*np.pi*own)*np.cos(2*np.pi*other))
    result,_=_library.tpms_library(*warped,c=0.0,tpms_design=BY_ID[params["family_id"]]["design"],
                                   cell_sizes=(1,1,1),origin=(0,0,0),silent=True)
    return np.asarray(result,dtype=np.float64)

def score(params, values):
    return np.abs(values-params["surface_offset"]) if BY_ID[params["family_id"]]["mode"]=="sheet" else -values

def tune(params:dict,target:float,lo:float,hi:float):
    values=score(params,field(params)); sorted_values=np.sort(values.ravel()); n=values.size
    k=int(round(target*n)); options=[]
    for delta in range(-40,41):
        index=min(n-1,max(1,k+delta))
        threshold=float((sorted_values[index-1]+sorted_values[index])/2)
        count=int(np.searchsorted(sorted_values,threshold,side="right")); density=count/n
        if lo<=density<hi: options.append((abs(density-target),threshold,density))
    if not options: raise ValueError("no_quantized_vf_in_target_interval")
    _,threshold,density=min(options)
    return values<=threshold,threshold,density

def recreate(record:dict,resolution:int=32):
    params=record["geometry"]
    return score(params,field(params,resolution))<=record["threshold"]

def signed_solid(record:dict,resolution:int=80):
    # Node samples include the exact physical boundary. Explicit coordinate
    # mapping is used after MC; never `rezero` an individual mesh to its bbox.
    return record["threshold"]-score(record["geometry"],field(record["geometry"],resolution,grid="nodes"))

def boundary_error(params:dict)->float:
    t=np.linspace(0,1,17); p,q=np.meshgrid(t,t,indexing="ij"); errors=[]
    for axis in range(3):
        left=[p,q,np.zeros_like(p)]; right=[p,q,np.ones_like(p)]
        left=np.roll(np.asarray(left),axis,axis=0); right=np.roll(np.asarray(right),axis,axis=0)
        errors.append(float(np.max(np.abs(field_points(params,*left)-field_points(params,*right)))))
    return max(errors)

def hashes(voxel):
    raw=hashlib.sha256(np.asarray(voxel,dtype=np.uint8).tobytes()).hexdigest()
    # Cube rotations/reflections do not inflate the unique count.
    candidates=[]
    for axes in itertools.permutations(range(3)):
        transformed=voxel.transpose(axes)
        for flips in itertools.product((False,True),repeat=3):
            item=transformed[tuple(slice(None,None,-1) if f else slice(None) for f in flips)]
            candidates.append(np.packbits(item,bitorder="little").tobytes())
    canonical=hashlib.sha256(min(candidates)).hexdigest()
    return raw,canonical

def periodic_connectivity(labels,components):
    """Merge cut-cell pieces and measure winding rank on the periodic torus."""
    parent=list(range(components+1)); offsets=np.zeros((components+1,3),dtype=int)
    windings=[]
    def find(i):
        if parent[i]!=i:
            old=parent[i];root,shift=find(old)
            offsets[i]+=shift;parent[i]=root
        return parent[i],offsets[i].copy()
    for axis in range(3):
        a=labels.take(-1,axis=axis);b=labels.take(0,axis=axis);mask=(a>0)&(b>0)
        pairs=np.unique(np.stack([a[mask],b[mask]],axis=1),axis=0)
        translation=np.eye(3,dtype=int)[axis]
        for first,second in pairs:
            ra,pa=find(int(first));rb,pb=find(int(second))
            delta=pa+translation-pb
            if ra==rb:
                if np.any(delta):windings.append(delta)
            else:parent[rb]=ra;offsets[rb]=delta
    roots={find(i)[0] for i in range(1,components+1)}
    rank=int(np.linalg.matrix_rank(np.asarray(windings))) if windings else 0
    return len(roots),rank

def screen(params,voxel):
    labels,components=label(voxel,generate_binary_structure(3,1))
    periodic_components,winding_rank=periodic_connectivity(labels,components)
    faces=[int(voxel.take(side,axis=axis).sum()) for axis in range(3) for side in (0,-1)]
    error=boundary_error(params)
    reasons=[]
    if periodic_components!=1: reasons.append("solid_not_periodically_connected")
    if winding_rank!=3: reasons.append("not_three_dimensionally_spanning")
    if not all(faces): reasons.append("missing_boundary_contact")
    if error>1e-10: reasons.append("nonperiodic_analytic_boundary")
    # Check wrapping paths in all three directions, not just touching faces.
    spanning=[bool(np.any(voxel.take(0,axis=i)&voxel.take(-1,axis=i))) for i in range(3)]
    if not all(spanning): reasons.append("no_periodic_face_bridge")
    warp_bound=max((2*np.pi+2*np.pi*.35)*abs(a)+(4*np.pi+2*np.pi)*abs(b) for a,b in zip(params["warp_a"],params["warp_b"]))
    if warp_bound>=1: reasons.append("warp_not_invertible_by_bound")
    return {"accepted":not reasons,"reasons":reasons,"connected_components":int(components),
            "periodic_connected_components":periodic_components,"periodic_winding_rank":winding_rank,
            "boundary_solid_counts":faces,"periodic_boundary_error":error,"periodic_face_bridges":spanning,
            "opposite_voxel_faces_equal":[bool(np.array_equal(voxel.take(0,axis=i),voxel.take(-1,axis=i))) for i in range(3)],
            "warp_jacobian_deviation_bound":float(warp_bound),"actual_vf":float(voxel.mean())}

def mesh_arrays(record,resolution=80):
    from skimage.measure import marching_cubes
    volume=signed_solid(record,resolution)
    # Cap on the EXACT cell planes, rather than arbitrarily filling holes.
    # Copy boundary values to one ghost layer; set only exterior values void.
    padded=np.pad(volume,1,constant_values=-1e6)
    vertices,faces,_,_=marching_cubes(padded,0,spacing=(1/(resolution-1),)*3,allow_degenerate=False)
    vertices-=1/(resolution-1)
    vertices=np.clip(vertices,0,1)*2-1
    return vertices,faces
