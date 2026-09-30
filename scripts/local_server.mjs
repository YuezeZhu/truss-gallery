import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectDir = resolve(scriptsDir, "..");
const publicDir = resolve(projectDir, "dist");
const defaultLiveFile = resolve(projectDir, "..", "truss100k", "live.json");
const liveFile = resolve(process.env.TRUSS_LIVE_FILE || defaultLiveFile);
const port = Number(process.env.TRUSS_GALLERY_PORT || process.argv[2] || 4173);

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
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
  console.log(`Truss Atlas local server: http://localhost:${port}`);
  console.log(`Live progress source: ${liveFile}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
