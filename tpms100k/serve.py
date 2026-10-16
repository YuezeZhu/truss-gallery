"""Read-only CLI bridge for the existing local Node gallery server."""
import argparse
import json
import sqlite3
import sys
import numpy as np
from tpms100k.generate import DATA,DB
from tpms100k import geometry as g

def main():
    p=argparse.ArgumentParser();p.add_argument("action",choices=["catalog","geometries","variants","record","mesh"])
    p.add_argument("--family",default="gyroid-sheet");p.add_argument("--geometry",type=int,default=0)
    p.add_argument("--id",type=int,default=1);p.add_argument("--page",type=int,default=0)
    p.add_argument("--resolution",type=int,default=72);p.add_argument("--order",choices=["asc","desc"],default="asc")
    a=p.parse_args()
    if a.family not in g.BY_ID or not 0<=a.geometry<512 or not 0<=a.page<10000 or not 20<=a.resolution<=96:raise ValueError("Invalid request")
    con=sqlite3.connect(f"file:{DB.as_posix()}?mode=ro",uri=True,timeout=10)
    if a.action=="catalog":
        families=[]
        for f in g.FAMILIES:
            count,geometries=con.execute("SELECT count(*),count(DISTINCT geometry_index) FROM samples WHERE family=?",(f['id'],)).fetchone()
            sample=con.execute("SELECT id FROM samples WHERE family=? ORDER BY abs(density-.2),id LIMIT 1",(f['id'],)).fetchone()
            families.append({**f,"count":count,"geometries":geometries,"representative_id":sample[0] if sample else None})
        print(json.dumps({"count":sum(f["count"] for f in families),"families":families}));return
    if a.action=="geometries":
        rows=[]
        shape_query="""WITH ranked AS (
          SELECT geometry_index,id,density,
            count(*) OVER(PARTITION BY geometry_index) AS shape_count,
            min(density) OVER(PARTITION BY geometry_index) AS min_density,
            max(density) OVER(PARTITION BY geometry_index) AS max_density,
            row_number() OVER(PARTITION BY geometry_index ORDER BY abs(density-.2),id) AS rank
          FROM samples WHERE family=?
        ) SELECT geometry_index,shape_count,min_density,max_density,id FROM ranked WHERE rank=1"""
        for index,count,minimum,maximum,representative_id in con.execute(shape_query,(a.family,)):
            params=g.parameters(a.family,index);magnitude=float(np.linalg.norm(params['warp_a']+params['warp_b']))
            rows.append({"index":index,"count":count,"min_vf":minimum,"max_vf":maximum,"magnitude":magnitude,"representative_id":representative_id})
        rows.sort(key=lambda r:(r["magnitude"],r["index"]),reverse=a.order=="desc")
        print(json.dumps({"total":len(rows),"rows":rows}));return
    if a.action=="variants":
        order="DESC" if a.order=="desc" else "ASC"
        total=con.execute("SELECT count(*) FROM samples WHERE family=? AND geometry_index=?",(a.family,a.geometry)).fetchone()[0]
        rows=[{"id":i,"vf":d,"young":e,"conductivity":k} for i,d,e,k in con.execute(f"SELECT id,density,young,conductivity FROM samples WHERE family=? AND geometry_index=? ORDER BY density {order},id LIMIT 80 OFFSET ?",(a.family,a.geometry,a.page*80))]
        print(json.dumps({"total":total,"page":a.page,"rows":rows}));return
    item=con.execute("SELECT record_json FROM samples WHERE id=?",(a.id,)).fetchone()
    if not item:raise ValueError("TPMS sample not found")
    record=json.loads(item[0])
    if a.action=="record":print(item[0]);return
    points,faces=g.mesh_arrays(record,a.resolution)
    import trimesh
    mesh=trimesh.Trimesh(points,faces,process=True)
    # Clipping MC ghost cells onto the exact cube planes can collapse
    # triangles. Remove only zero-area / duplicate faces; never fill holes
    # or modify the material field to make a preview pass.
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    if not mesh.is_watertight:raise ValueError("Preview mesh is not watertight at the requested resolution")
    points,faces=mesh.vertices,mesh.faces
    lines=[f"# {record['id']} MC {a.resolution}^3; normalized cell [-1,1]^3\n"]
    lines.extend(f"v {x:.7g} {y:.7g} {z:.7g}\n" for x,y,z in points)
    lines.extend(f"f {x+1} {y+1} {z+1}\n" for x,y,z in faces)
    sys.stdout.write("".join(lines))
if __name__=="__main__":main()
