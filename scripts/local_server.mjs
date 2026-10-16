import { createServer } from "node:http";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const scriptsDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectDir = resolve(scriptsDir, "..");
const publicDir = resolve(projectDir, "dist");
const shellOutputDir = resolve(process.env.TRUSS_SHELL_OUTPUT || "D:/yueze/LatticeDataset/native_runs/shell_complexity_extremes40");
const shell100kDir = resolve(process.env.TRUSS_SHELL_100K || "D:/yueze/LatticeDataset/native_runs/shell100k_ranked");
const shellExe = resolve(process.env.TRUSS_SHELL_EXE || "D:/yueze/LatticeDataset/native_build/shell/Release/psl.exe");
const defaultLiveFile = resolve(projectDir, "..", "truss100k", "live.json");
const liveFile = resolve(process.env.TRUSS_LIVE_FILE || defaultLiveFile);
const port = Number(process.env.TRUSS_GALLERY_PORT || process.argv[2] || 4173);
let shellRowsPromise;
let shellRowsVersion;
const shellMeshCache = new Map();
const tpmsMeshCache = new Map();
const tpmsDataDir = resolve(process.env.TPMS_DATA_DIR || "D:/yueze/LatticeDataset/native_runs/tpms100k_analytic");

function tpmsQuery(action, url) {
  const args = ["-m", "tpms100k.serve", action];
  for (const [query, flag, pattern] of [["family","--family",/^[a-z-]+$/],["geometry","--geometry",/^\d{1,3}$/],["id","--id",/^\d{1,6}$/],["page","--page",/^\d{1,4}$/],["resolution","--resolution",/^\d{2}$/],["order","--order",/^(asc|desc)$/]]) {
    const value = url.searchParams.get(query);
    if (value != null) { if (!pattern.test(value)) throw new Error("Invalid TPMS query"); args.push(flag,value); }
  }
  return new Promise((resolveQuery, rejectQuery) => {
    const child = spawn(process.env.TPMS_PYTHON || "python",args,{cwd:projectDir,windowsHide:true,env:{...process.env,OPENBLAS_NUM_THREADS:"1",OMP_NUM_THREADS:"1",MKL_NUM_THREADS:"1"}});
    const output=[];let error="";
    child.stdout.on("data",chunk=>output.push(chunk));child.stderr.on("data",chunk=>error+=chunk);
    child.on("error",rejectQuery);child.on("close",code=>code===0?resolveQuery(Buffer.concat(output)):rejectQuery(new Error(error.slice(-1200)||"TPMS query failed")));
  });
}

const fallbackLive = {
  schema: "truss100k-live-v1",
  goal: 100000,
  accepted: 0,
  attempts: 0,
  rejected: 0,
  status: "preparing",
  density_bins: [],
  latest: [],
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".obj": "text/plain; charset=utf-8",
};

function safeAssetPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const candidate = resolve(publicDir, `.${requested}`);
  if (candidate !== publicDir && !candidate.startsWith(`${publicDir}${sep}`)) return null;
  return candidate;
}

async function readLive() {
  try {
    return JSON.parse(await readFile(liveFile, "utf8"));
  } catch {
    return fallbackLive;
  }
}

async function readShellRows() {
  const manifests = Array.from({length: 10}, (_, bin) => join(shell100kDir, `bin${String(bin).padStart(2, "0")}`, "manifest.json"));
  const version = (await Promise.all(manifests.map(async path => {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  }))).join("|");
  if (!shellRowsPromise || shellRowsVersion !== version) {
    shellRowsVersion = version;
    shellRowsPromise = (async () => {
    const rows = new Map();
    for (let bin = 0; bin < 10; bin++) {
      const binDir = join(shell100kDir, `bin${String(bin).padStart(2, "0")}`);
      const payload = JSON.parse(await readFile(join(binDir, "manifest.json"), "utf8"));
      for (const row of payload.samples) {
        rows.set(row.output_id, {
          inputPath: resolve(binDir, row.input),
          diameter: row.diameter, smoothness: row.smoothness, thickness: row.thickness,
        });
      }
    }
    return rows;
    })().catch(error => {
      shellRowsVersion = undefined;
      shellRowsPromise = undefined;
      throw error;
    });
  }
  return shellRowsPromise;
}

function runShellMesh(row, output) {
  return new Promise((resolveRun, rejectRun) => {
    const args = ["generate", "--skeleton", row.inputPath, "--cell-size", "2", "--resolution", "32", "--mesh-resolution", "48", "--diameter", String(row.diameter), "--smoothness", String(row.smoothness), "--thickness", String(row.thickness), "--threads", "4", "--output", output];
    const child = spawn(shellExe, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(stderr || `psl exited with code ${code}`)));
  });
}

async function shellMesh(row) {
  const cached = shellMeshCache.get(row.inputPath);
  if (cached) return cached;
  const work = await mkdtemp(join(tmpdir(), "latticeverse-shell-"));
  const output = join(work, "mesh.obj");
  try {
    await runShellMesh(row, output);
    const body = await readFile(output);
    shellMeshCache.set(row.inputPath, body);
    while (shellMeshCache.size > 6) shellMeshCache.delete(shellMeshCache.keys().next().value);
    return body;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/tpms-live" || url.pathname === "/api/tpms-data" || url.pathname === "/api/tpms-mesh") {
    if (request.method !== "GET" && request.method !== "HEAD") {response.writeHead(405);response.end();return;}
    try {
      let body;
      const mesh=url.pathname==="/api/tpms-mesh";
      if (url.pathname==="/api/tpms-live") body=await readFile(join(tpmsDataDir,"live.json"));
      else {
        const action=mesh?"mesh":(url.searchParams.get("action")||"catalog");
        if (!["catalog","geometries","variants","record","mesh"].includes(action)) throw new Error("Invalid TPMS action");
        if (mesh) {
          const key=url.search;
          if (!tpmsMeshCache.has(key)) {
            const promise=tpmsQuery(action,url).catch(error=>{tpmsMeshCache.delete(key);throw error;});
            tpmsMeshCache.set(key,promise);
            while(tpmsMeshCache.size>12)tpmsMeshCache.delete(tpmsMeshCache.keys().next().value);
          }
          body=await tpmsMeshCache.get(key);
        } else body=await tpmsQuery(action,url);
      }
      response.writeHead(200,{"Content-Type":mesh?"text/plain; charset=utf-8":"application/json; charset=utf-8","Cache-Control":mesh?"public, max-age=3600":"no-store"});
      response.end(request.method==="HEAD"?undefined:body);
    } catch(error) {response.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});response.end(error.message);}
    return;
  }
  if (url.pathname === "/api/live") {
    const body = JSON.stringify(await readLive());
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    if (request.method !== "HEAD") response.end(body);
    else response.end();
    return;
  }

  if (url.pathname === "/api/shell100k-mesh") {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    try {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Shell variant id");
      const rows = await readShellRows();
      const row = rows.get(id);
      if (!row) { response.writeHead(404); response.end("Shell variant not found"); return; }
      const body = await shellMesh(row);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" });
      if (request.method !== "HEAD") response.end(body); else response.end();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Shell mesh generation failed: ${error.message}`);
    }
    return;
  }

  if (url.pathname === "/api/shell100k-skeleton") {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    try {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Shell variant id");
      const rows = await readShellRows();
      const row = rows.get(id);
      if (!row) { response.writeHead(404); response.end("Shell variant not found"); return; }
      const body = await readFile(row.inputPath);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      if (request.method !== "HEAD") response.end(body); else response.end();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Shell skeleton failed: ${error.message}`);
    }
    return;
  }

  // The Shell gallery stays local and reads the generated OBJ/PNG files in
  // place, avoiding a second copy of the meshes inside the web directory.
  if (url.pathname.startsWith("/shell-data/")) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice("/shell-data/".length));
    if (!/^(manifest\.json|catalog\.json|summary\.json|topology-[A-Za-z0-9_-]+\.json|(?:meshes|previews)\/rank_\d{5}\.(?:obj|png))$/.test(relative)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const root = /^(catalog|summary|topology-)/.test(relative) ? resolve(publicDir, "shell-data") : shellOutputDir;
    const filename = resolve(root, relative);
    if (!filename.startsWith(`${root}${sep}`) || !existsSync(filename)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": types[extname(filename).toLowerCase()] || "application/octet-stream",
      "Cache-Control": relative === "manifest.json" ? "no-store" : "public, max-age=3600",
    });
    if (request.method !== "HEAD") response.end(body);
    else response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  const filename = safeAssetPath(url.pathname);
  if (!filename || !existsSync(filename)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const body = await readFile(filename);
  const headers = {
    "Content-Type": types[extname(filename).toLowerCase()] || "application/octet-stream",
    "Cache-Control": filename.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  };
  response.writeHead(200, headers);
  if (request.method !== "HEAD") response.end(body);
  else response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LatticeVerse local server: http://127.0.0.1:${port}`);
  console.log(`Live progress source: ${liveFile}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
