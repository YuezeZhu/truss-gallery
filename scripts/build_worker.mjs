// Package the existing static gallery into a small Worker with live R2 status.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const project = resolve(import.meta.dirname, "..");
const files = ["index.html", "styles.css", "geometry.js", "app.js", "live.js", "data/samples.json", "data/topology_browser.json"];
const binaryFiles = ["assets/truss100k_youngs_modulus.png", "assets/truss100k_thermal_diagonal_mean.png"];
const assets = Object.fromEntries(files.map((name) => [
  `/${name}`,
  readFileSync(resolve(project, "dist", name), "utf8"),
]));
const binaryAssets = Object.fromEntries(binaryFiles.map((name) => [
  `/${name}`,
  readFileSync(resolve(project, "dist", name)).toString("base64"),
]));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const worker = `const ASSETS = ${JSON.stringify(assets)};
const BINARY_ASSETS = ${JSON.stringify(binaryAssets)};
const CONTENT_TYPES = ${JSON.stringify(contentTypes)};
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const empty = { schema: "truss100k-live-v1", goal: 100000, accepted: 0, attempts: 0, rejected: 0, status: "preparing", density_bins: [], latest: [] };

function reply(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/live") {
      if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
      try {
        const object = await env.BUCKET.get("truss100k/live.json");
        return new Response(object ? object.body : JSON.stringify(empty), { headers: JSON_HEADERS });
      } catch (error) {
        return reply({ error: "live_status_unavailable" }, 503);
      }
    }
    if (url.pathname === "/api/ingest") {
      if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
      if (!env.TRUSS_INGEST_TOKEN || request.headers.get("X-Truss-Ingest-Token") !== env.TRUSS_INGEST_TOKEN) {
        return reply({ error: "forbidden" }, 403);
      }
      const body = await request.text();
      if (body.length > 150000) return reply({ error: "too_large" }, 413);
      let data;
      try { data = JSON.parse(body); } catch { return reply({ error: "invalid_json" }, 400); }
      if (data.schema !== "truss100k-live-v1" || data.goal !== 100000 || !Array.isArray(data.latest) || data.latest.length > 6 || !Array.isArray(data.density_bins)) {
        return reply({ error: "invalid_snapshot" }, 400);
      }
      try {
        await env.BUCKET.put("truss100k/live.json", body, { httpMetadata: { contentType: "application/json" } });
        return reply({ saved: true });
      } catch (error) {
        return reply({ error: "save_failed" }, 503);
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method_not_allowed" }, 405);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const content = ASSETS[path];
    const binaryContent = BINARY_ASSETS[path];
    if (content === undefined && binaryContent === undefined) return new Response("Not found", { status: 404 });
    const extension = path.slice(path.lastIndexOf("."));
    if (binaryContent !== undefined) {
      const bytes = Uint8Array.from(atob(binaryContent), (character) => character.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: { "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream", "Cache-Control": "public, max-age=3600" },
      });
    }
    return new Response(request.method === "HEAD" ? null : content, {
      headers: { "Content-Type": CONTENT_TYPES[extension] || "text/plain", "Cache-Control": path === "/index.html" ? "no-cache" : "public, max-age=3600" },
    });
  },
};
`;

const output = resolve(project, "dist", "server");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "index.js"), worker);
console.log(`Built Worker with ${files.length} gallery assets`);
