"""Resumable analytical TPMS-32 generation, screened before property solves.

python -m tpms100k.generate probe
python -m tpms100k.generate run --workers 16 --stop-after 100
python -m tpms100k.generate run --workers 16
python -m tpms100k.generate audit
"""
from __future__ import annotations
import os
for _key in ("OMP_NUM_THREADS","OPENBLAS_NUM_THREADS","MKL_NUM_THREADS"):
    os.environ[_key]="1"
import argparse
import collections
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import random
import sqlite3
import subprocess
import sys
import time
from datetime import datetime,timezone
import numpy as np
from tpms100k import geometry as g
from numerical_homogenization import homogenize as elastic
from thermal_homogenization import homogenize as thermal

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get("TPMS_DATA_DIR",r"D:\yueze\LatticeDataset\native_runs\tpms100k_analytic"))
DB=DATA/"records.sqlite"
GOAL=100000
QUOTAS=np.tile([334,333,333],100)

def compact(value):return json.dumps(value,separators=(",",":"),ensure_ascii=False,allow_nan=False)
def atomic(path,value):
    pending=path.with_suffix(path.suffix+".pending")
    pending.write_text(compact(value),encoding="utf-8"); pending.replace(path)
def timestamp():return datetime.now(timezone.utc).isoformat(timespec="seconds")

def connect():
    DATA.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(DB,timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.executescript('''
    CREATE TABLE IF NOT EXISTS samples(
      id INTEGER PRIMARY KEY, family TEXT NOT NULL, geometry_index INTEGER NOT NULL,
      bucket INTEGER NOT NULL, fine INTEGER NOT NULL, density REAL NOT NULL,
      voxel_hash TEXT UNIQUE NOT NULL, canonical_hash TEXT UNIQUE NOT NULL,
      young REAL NOT NULL, conductivity REAL NOT NULL, record_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS family_geometry ON samples(family,geometry_index,density);
    CREATE INDEX IF NOT EXISTS fine_density ON samples(fine,density);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS failures(reason TEXT PRIMARY KEY,count INTEGER NOT NULL);
    ''')
    metadata={"schema":"tpms100k-analytic-v1","source_script_sha256":g.SOURCE_SHA256,
       "geometry_program_sha256":hashlib.sha256((g.HERE/"geometry.py").read_bytes()).hexdigest(),
       "mechanical_program_sha256":hashlib.sha256((ROOT/"numerical_homogenization.py").read_bytes()).hexdigest(),
       "thermal_program_sha256":hashlib.sha256((ROOT/"thermal_homogenization.py").read_bytes()).hexdigest(),
       "material":{"young":1.0,"poisson":.3,"conductivity":1.0},
       "goal":GOAL,"vf_range":[.05,.35],"coarse_bin_goal":10000,
       "fine_bin_width":.001,"fine_quotas":QUOTAS.tolist(),"geometry_version":g.VERSION,
       "shape_pool_per_family":512,"families":g.FAMILIES,
       "symmetry_policy":"periodic coordinate warp; no cubic point group assumed",
       "boundary_policy":"analytic opposite-face equality plus voxel periodic bridges; first/last cell-center layers need not be identical",
       "storage":"formulas, warp/threshold parameters, compact tensors and quality only; no voxel/mesh persistence"}
    old=con.execute("SELECT value FROM metadata WHERE key='config'").fetchone()
    if old and json.loads(old[0])!=metadata:
        if con.execute("SELECT count(*) FROM samples").fetchone()[0]:
            raise RuntimeError("Frozen geometry/solver/config changed; use a new dataset version")
        # A preflight-only database has no accepted data to invalidate.
        atomic(DATA/"provenance_preflight.json",json.loads(old[0]))
        con.execute("UPDATE metadata SET value=? WHERE key='config'",(compact(metadata),))
        atomic(DATA/"provenance.json",metadata)
    con.execute("INSERT OR IGNORE INTO metadata VALUES('config',?)",(compact(metadata),));con.commit()
    if not (DATA/"provenance.json").exists():atomic(DATA/"provenance.json",metadata)
    return con

def failure(con,reason):
    con.execute("INSERT INTO failures VALUES(?,1) ON CONFLICT(reason) DO UPDATE SET count=count+1",(reason,))

def candidate(family,index,fine,seed):
    rng=random.Random(seed); params=g.parameters(family,index)
    lo=.05+fine*.001; hi=.05+(fine+1)*.001
    target=lo+rng.random()*.001
    try:vox,threshold,density=g.tune(params,target,lo,hi)
    except ValueError as exc:return {"accepted":False,"reasons":[str(exc)]}
    quality=g.screen(params,vox)
    if not quality["accepted"]:return quality
    raw,canonical=g.hashes(vox)
    return {"accepted":True,"record":{"family_id":family,"geometry":params,"geometry_index":index,
       "threshold":threshold,"threshold_meaning":"field halfwidth" if g.BY_ID[family]["mode"]=="sheet" else "negative isovalue",
       "target_vf":target,"density":density,"bucket":fine//30,"fine":fine,
       "voxel_sha256":raw,"canonical_sha256":canonical,"resolution":32,"quality":quality}}

def solve(record):
    start=time.perf_counter()
    try:
        vox=g.recreate(record)
        if hashlib.sha256(vox.astype(np.uint8).tobytes()).hexdigest()!=record["voxel_sha256"]:
            raise ValueError("reconstruction_hash_mismatch")
        a=elastic(vox,young=1.0,poisson=.3,rtol=1e-7,maxiter=2400)
        b=thermal(vox,solid_conductivity=1.0,rtol=1e-8,maxiter=2400)
        C=np.asarray(a["C_H"]);K=np.asarray(b["K_H"])
        if not np.isfinite(C).all() or not np.isfinite(K).all():raise ValueError("nonfinite_tensor")
        min_c=float(np.linalg.eigvalsh(C).min());min_k=float(np.linalg.eigvalsh(K).min())
        if min_c<1e-8 or min_k<1e-8:raise ValueError("mechanism_or_non_spanning_properties")
        if np.linalg.eigvalsh(record["density"]*np.asarray(a["C_base"])-C).min() < -1e-7:raise ValueError("elastic_voigt_bound")
        if np.linalg.eigvalsh(record["density"]*np.eye(3)-K).min() < -1e-7:raise ValueError("thermal_voigt_bound")
        compliance=np.linalg.inv(C);young=(1/np.diag(compliance)[:3]).tolist()
        record.update({"C_H_upper":C[np.triu_indices(6)].tolist(),"K_H_upper":K[np.triu_indices(3)].tolist(),
           "young_directional":young,"young_mean":float(np.mean(young)),"K_mean":float(np.trace(K)/3),
           "solver":"truss-periodic-hexahedral-fe","voigt_order":a["voigt_order"]})
        record["quality"].update({"mechanical_residual":max(a["relative_residuals"]),"thermal_residual":max(b["relative_residuals"]),
           "mechanical_iterations":a["cg_iterations"],"thermal_iterations":b["cg_iterations"],
           "mechanical_regularization":a["regularization_diagonal"],"thermal_regularization":b["regularization_diagonal"],
           "min_C_eigenvalue":min_c,"min_K_eigenvalue":min_k,"property_seconds":time.perf_counter()-start})
        return {"accepted":True,"record":record}
    except Exception as exc:return {"accepted":False,"reasons":["property_failure"],"error":str(exc),"seconds":time.perf_counter()-start}

def probe(per_cell=5):
    con=connect();rows=[];start=time.time()
    for family in g.BY_ID:
        for b in range(10):
            passed=0;reasons=collections.Counter()
            for j in range(per_cell):
                r=candidate(family,1+j*7,b*30+(j*7)%30,20261015+b*100+j)
                passed+=r["accepted"];reasons.update(r.get("reasons",[]))
            rows.append({"family":family,"bucket":b,"attempts":per_cell,"passed":passed,"reasons":dict(reasons)})
    result={"rows":rows,"elapsed_seconds":time.time()-start,"attempts":len(rows)*per_cell,"passed":sum(r["passed"] for r in rows)}
    atomic(DATA/"geometry_probe.json",result)
    print(compact(result),flush=True);con.close()

def run(workers,stop_after=0):
    import msvcrt
    DATA.mkdir(parents=True,exist_ok=True)
    lock=(DATA/"generation.lock").open("a+b");lock.seek(0)
    if not lock.read(1):lock.write(b"0");lock.flush()
    lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise RuntimeError("Another TPMS generation process already owns this dataset")
    con=connect();start=time.time();rng=random.Random(20261015+int(time.time()))
    counts=np.zeros(300,dtype=int);family_counts=collections.Counter();known=set();raw_known=set()
    for fine,family,canonical,raw in con.execute("SELECT fine,family,canonical_hash,voxel_hash FROM samples"):
        counts[fine]+=1;family_counts[(family,fine//30)]+=1;known.add(canonical);raw_known.add(raw)
    probe_data=json.loads((DATA/"geometry_probe.json").read_text()) if (DATA/"geometry_probe.json").exists() else {"rows":[]}
    rates={(r["family"],r["bucket"]):(r["passed"]+.5)/(r["attempts"]+1) for r in probe_data["rows"]}
    failures=collections.Counter(dict(con.execute("SELECT reason,count FROM failures")))
    attempts=0;added=0;rejected=0;duplicates=0;pending_counts=collections.Counter();pending_families=collections.Counter()
    pending_hashes=set();pending_raw=set();last_publish=0;last_live=0;initial=int(counts.sum())
    limit=min(GOAL,stop_after) if stop_after else GOAL
    future_map={};stopping=False
    def live(phase):
        nonlocal last_live
        value={"schema":"tpms100k-live-v1","phase":phase,"goal":GOAL,"accepted":int(counts.sum()),"initial":initial,
           "this_run_added":added,"attempts_this_run":attempts,"rejected_this_run":rejected,"duplicates_this_run":duplicates,
           "vf_bin_counts":[int(x) for x in counts.reshape(10,30).sum(axis=1)],"vf_fine_counts":counts.tolist(),
           "empty_fine_bins":np.flatnonzero(counts==0).tolist(),"family_counts":{f:sum(v for (ff,_),v in family_counts.items() if ff==f) for f in g.BY_ID},
           "failure_counts":dict(failures),"pending_properties":len(future_map),"updated_at":timestamp(),
           "elapsed_seconds":time.time()-start,"new_records_per_hour":added*3600/max(time.time()-start,1)}
        atomic(DATA/"live.json",value);last_live=time.time()
        print(compact({k:v for k,v in value.items() if k not in ("vf_fine_counts","empty_fine_bins")}),flush=True)
    def reject(reason):
        failures[reason]+=1;failure(con,reason)
    def publish():
        nonlocal last_publish
        subprocess.run([sys.executable,"-m","tpms100k.publish"],cwd=ROOT,check=True)
        last_publish=time.time()
    live("generating");publish()
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            while True:
                if (DATA/"stop.request").exists():stopping=True
                filled=0
                while not stopping and len(future_map)<workers*2 and int(counts.sum())+len(future_map)<limit and filled<workers*12:
                    unfinished=[i for i in range(300) if counts[i]+pending_counts[i]<QUOTAS[i]]
                    if not unfinished:break
                    # Pilot is stratified over the ten broad VF bands, rather
                    # than stopping with only the easiest densities solved.
                    b=min({i//30 for i in unfinished},key=lambda b:counts[b*30:(b+1)*30].sum()+sum(pending_counts[i] for i in range(b*30,(b+1)*30)))
                    choices=[i for i in unfinished if i//30==b]
                    fine=min(choices,key=lambda i:(counts[i]+pending_counts[i])/QUOTAS[i]+rng.random()*.0001)
                    families=list(g.BY_ID)
                    weights=[.1/len(families)+rates.get((f,b),.5)/(1+family_counts[(f,b)]+pending_families[(f,b)])**.5 for f in families]
                    family=rng.choices(families,weights=weights,k=1)[0]
                    result=candidate(family,rng.randrange(512),fine,rng.getrandbits(64));attempts+=1;filled+=1
                    if not result["accepted"]:
                        rejected+=1
                        for reason in result.get("reasons",[]):reject(reason)
                        continue
                    r=result["record"];digest=r["canonical_sha256"];raw=r["voxel_sha256"]
                    if digest in known or digest in pending_hashes or raw in raw_known or raw in pending_raw:
                        duplicates+=1;reject("duplicate_before_property_solve");continue
                    pending_hashes.add(digest);pending_raw.add(raw);pending_counts[fine]+=1;pending_families[(family,b)]+=1
                    future_map[pool.submit(solve,r)]=r
                if future_map:
                    done,_=concurrent.futures.wait(future_map,timeout=1,return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in done:
                        source=future_map.pop(future);fine=source["fine"];family=source["family_id"]
                        pending_hashes.remove(source["canonical_sha256"]);pending_raw.remove(source["voxel_sha256"])
                        pending_counts[fine]-=1;pending_families[(family,fine//30)]-=1
                        result=future.result()
                        if not result["accepted"]:
                            rejected+=1;reject("property_failure")
                            con.execute("INSERT OR REPLACE INTO metadata VALUES('last_property_error',?)",(result.get("error",""),));continue
                        r=result["record"];sample_id=int(counts.sum())+1;r["id"]=f"TPMS-{sample_id:06d}"
                        con.execute("INSERT INTO samples VALUES(?,?,?,?,?,?,?,?,?,?,?)",(sample_id,family,r["geometry_index"],r["bucket"],fine,r["density"],r["voxel_sha256"],r["canonical_sha256"],r["young_mean"],r["K_mean"],compact(r)))
                        counts[fine]+=1;family_counts[(family,fine//30)]+=1;known.add(r["canonical_sha256"]);raw_known.add(r["voxel_sha256"]);added+=1
                    con.commit()
                if time.time()-last_live>=10:con.commit();live("draining" if stopping else "generating")
                if time.time()-last_publish>=300:publish()
                if not future_map and (stopping or int(counts.sum())>=limit):break
                if attempts>=20000 and added==0:
                    raise RuntimeError("No new passing records after 20,000 attempts; sampler needs adjustment")
        live("stopped" if stopping else "complete" if int(counts.sum())==GOAL else "pilot_complete")
        publish()
    except BaseException as exc:
        con.rollback();atomic(DATA/"last_error.json",{"error":str(exc),"time":timestamp()});live("failed");raise
    finally:con.close();lock.close()

def audit():
    con=connect();n=con.execute("SELECT count(*),count(DISTINCT voxel_hash),count(DISTINCT canonical_hash) FROM samples").fetchone()
    fine=np.zeros(300,dtype=int)
    for i,c in con.execute("SELECT fine,count(*) FROM samples GROUP BY fine"):fine[i]=c
    missing=0
    for (text,) in con.execute("SELECT record_json FROM samples"):
        r=json.loads(text)
        missing+=not(len(r.get("C_H_upper",[]))==21 and len(r.get("K_H_upper",[]))==6)
    result={"count":n[0],"unique_raw_voxels":n[1],"unique_up_to_cube_symmetry":n[2],"missing_tensors":missing,
       "bin_counts":fine.reshape(10,30).sum(axis=1).tolist(),"fine_empty":np.flatnonzero(fine==0).tolist(),
       "fine_min":int(fine.min()),"fine_max":int(fine.max()),"target_reached":bool(np.array_equal(fine,QUOTAS))}
    atomic(DATA/"audit.json",result);print(compact(result));con.close()

def main():
    p=argparse.ArgumentParser();p.add_argument("command",choices=["probe","run","audit"])
    p.add_argument("--workers",type=int,default=16);p.add_argument("--stop-after",type=int,default=0);p.add_argument("--per-cell",type=int,default=5)
    args=p.parse_args()
    if args.command=="probe":probe(args.per_cell)
    elif args.command=="audit":audit()
    else:run(args.workers,args.stop_after)
if __name__=="__main__":main()
