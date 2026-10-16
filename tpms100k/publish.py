"""Small catalog + PNG charts; full records stay in one SQLite database."""
import json
from pathlib import Path
import sqlite3
import numpy as np
from tpms100k.generate import DATA,DB,ROOT,atomic
from tpms100k.geometry import FAMILIES
OUT=ROOT/"dist"/"tpms-data"

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(f"file:{DB.as_posix()}?mode=ro",uri=True)
    families=[]
    for f in FAMILIES:
        count,geometries=con.execute("SELECT count(*),count(DISTINCT geometry_index) FROM samples WHERE family=?",(f['id'],)).fetchone()
        sample=con.execute("SELECT id FROM samples WHERE family=? ORDER BY abs(density-.2),id LIMIT 1",(f['id'],)).fetchone()
        families.append({**f,"count":count,"geometries":geometries,"representative_id":sample[0] if sample else None})
    atomic(OUT/"catalog.json",{"count":sum(f["count"] for f in families),"goal":100000,"families":families})
    rows=np.asarray(con.execute("SELECT density,young,conductivity FROM samples").fetchall())
    con.close()
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for column,title,ylabel,name in [(1,"TPMS-32 effective Young's modulus","Mean directional Young's modulus E","youngs.png"),(2,"TPMS-32 effective thermal conductivity","Conductivity (Kxx + Kyy + Kzz) / 3","conductivity.png")]:
        fig,ax=plt.subplots(figsize=(10,5.6),dpi=160)
        if rows.size:ax.scatter(rows[:,0]*100,rows[:,column],s=2,alpha=.28,color="#258b9f",linewidths=0)
        else:ax.text(.5,.5,"No fully solved samples yet",ha="center",transform=ax.transAxes)
        ax.set(xlim=(5,35),xlabel="Volume fraction (%)",ylabel=ylabel);ax.set_title(title,loc="left",pad=12)
        ax.text(1,1.04,f"{len(rows):,} computed records",ha="right",transform=ax.transAxes,fontsize=8,color="#617482")
        ax.grid(alpha=.14);fig.tight_layout()
        temp=OUT/(name+".pending");fig.savefig(temp,format="png");temp.replace(OUT/name);plt.close(fig)
    print(json.dumps({"published":len(rows),"output":str(OUT)}),flush=True)
if __name__=="__main__":main()
