import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve("D:/yueze/LatticeDataset");
const sourceDir = resolve(root, "native_runs/shell100k_ranked");
const outDir = resolve("C:/Users/admin/Documents/ChatGPT/LatticeDataset/truss-gallery/dist/shell-data");
await mkdir(outDir, { recursive: true });

const groups = new Map();
const bins = [];
let count = 0;
let vfMin = Infinity, vfMax = -Infinity;
const ids = new Set();
const propertyMap = new Map();
const elasticMap = new Map();
try {
  for (const line of (await readFile(join(sourceDir,"shell_properties.jsonl"),"utf8")).split(/\r?\n/)) {
    if (line.trim()) { const record=JSON.parse(line); if (record.status==="ok") elasticMap.set(record.id,record); }
  }
} catch { /* The original elasticity cache is optional. */ }
try {
  const propertyText = await readFile(join(sourceDir, "shell_properties_v2.jsonl"), "utf8");
  for (const line of propertyText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const property = JSON.parse(line); propertyMap.set(property.id, property); }
    catch { /* An actively appended final record may be incomplete. */ }
  }
} catch {
  // Properties are optional while a large batch is still being solved.
}
let propertyCount=0, propertyFailed=0;
for (let bin = 0; bin < 10; bin++) {
  const binDir = join(sourceDir, `bin${String(bin).padStart(2, "0")}`);
  const manifest = JSON.parse(await readFile(join(binDir, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) throw new Error(`Bin ${bin} has no samples`);
  bins.push(manifest.samples.length);
  for (const row of manifest.samples) {
    const vf = Number(row.density);
    const lo = 0.05 + 0.03 * bin, hi = 0.05 + 0.03 * (bin + 1);
    if (!(lo <= vf && vf < hi) || row.vf_bin !== bin) throw new Error(`Out-of-bin sample ${row.output_id}: ${vf}`);
    if (ids.has(row.output_id)) throw new Error(`Duplicate sample ID ${row.output_id}`);
    ids.add(row.output_id);
    count++; vfMin = Math.min(vfMin, vf); vfMax = Math.max(vfMax, vf);
    const group = groups.get(row.topology_id) || { topology_id: row.topology_id, variants: [], sample: row, binDir };
    const property = propertyMap.get(row.output_id);
    const elastic = property?.status === "ok" ? property : elasticMap.get(row.output_id);
    if (property?.status === "ok") propertyCount++;
    else if (property?.status === "failed") propertyFailed++;
    const displacementEntries = [...(row.node_displacements || [])].sort((a,b)=>a[0]-b[0]);
    const displacementNorm = Math.sqrt(displacementEntries.reduce((sum, entry) => sum+entry.slice(1).reduce((s,x)=>s+x*x,0),0));
    group.variants.push({
      id: row.output_id,
      vf_bin: row.vf_bin,
      vf,
      target_vf: Number(row.target_density ?? 0),
      diameter: Number(row.diameter ?? 0),
      smoothness: Number(row.smoothness ?? 0),
      thickness: Number(row.thickness ?? 0),
      source: row.source || "unknown",
      source_sample_id: row.source_sample_id,
      boundary_axes: row.actual_boundary_axes || [],
      connectivity: row.connectivity_status || "unknown",
      symmetry: row.symmetry_mode || "unknown",
      mesh_components: row.mesh_components ?? null,
      voxel_components: row.voxel_components_6_neighbor ?? null,
      skeleton_coverage: row.skeleton_coverage_fraction ?? null,
      node_displacements: displacementEntries,
      geometry_key: JSON.stringify(displacementEntries),
      displacement_norm: displacementNorm,
      properties_status: property?.status || (elastic ? "elastic_only" : "pending"),
      C_H_upper: elastic?.C_upper || [],
      K_H_upper: property?.K_upper || [],
      youngs_modulus: elastic?.young_mean ?? null,
      thermal_diagonal_mean: property?.K_mean ?? null,
      C_diag: elastic?.C_diag || [],
      K_diag: property?.K_diag || [],
      min_C: elastic?.min_C ?? null,
      min_K: property?.min_K ?? null,
      thermal_residual: property?.thermal_residual ?? null,
      property_wall_seconds: property?.wall_seconds ?? null,
    });
    groups.set(row.topology_id, group);
  }
}

function parseSkeleton(text) {
  const edges = [];
  const points = [];
  const index = new Map();
  for (const line of text.split(/\r?\n/)) {
    const values = line.trim().split(",").map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) continue;
    const key = values.map((value) => value.toFixed(12)).join(",");
    let point = index.get(key);
    if (point == null) { point = points.length; index.set(key, point); points.push(values); }
    if (edges.length % 2) edges.push(point);
    else edges.push(point);
  }
  const pairEdges = [];
  for (let i = 0; i + 1 < edges.length; i += 2) {
    if (edges[i] !== edges[i + 1]) pairEdges.push([edges[i], edges[i + 1]]);
  }
  return { points, edges: pairEdges };
}

const topologies = [];
for (const group of groups.values()) {
  const first = group.variants[0];
  const csv = resolve(group.binDir, group.sample.input);
  const skeleton = parseSkeleton(await readFile(csv, "utf8"));
  group.variants.sort((a, b) => a.vf - b.vf || a.diameter - b.diameter || a.id.localeCompare(b.id));
  const rank = 1 + topologies.length;
  topologies.push({
    id: group.topology_id,
    name: `Shell T-${String(rank).padStart(4, "0")}`,
    source_id: group.topology_id,
    points: skeleton.points,
    edges: skeleton.edges,
    nodes: skeleton.points.length,
    members: skeleton.edges.length,
    variants: group.variants.length,
    symmetry: first.symmetry,
    variant_shard: `topology-${group.topology_id}.json`,
  });
  await writeFile(join(outDir, `topology-${group.topology_id}.json`), JSON.stringify({ schema: "shell100k-variants-v1", topology_id: group.topology_id, variants: group.variants }));
}
topologies.sort((a, b) => a.members - b.members || a.nodes - b.nodes || a.source_id.localeCompare(b.source_id));
topologies.forEach((topology, index) => { topology.rank = index + 1; topology.name = `Shell T-${String(index + 1).padStart(4, "0")}`; });
const reportNames = (await readdir(sourceDir)).filter((name) => /^dedup_report_.*\.json$/.test(name)).sort();
const dedupReport = reportNames.length ? JSON.parse(await readFile(join(sourceDir, reportNames.at(-1)), "utf8")) : null;
const catalog = {
  schema: "shell100k-catalog-v1",
  count,
  unique_count: count,
  original_count: dedupReport?.original_count ?? count,
  duplicate_count: dedupReport?.duplicate_count ?? 0,
  property_count: propertyCount,
  property_failed: propertyFailed,
  vf_bin_counts: bins,
  vf_empty_bins: bins.map((value, index) => value ? null : index).filter((value) => value != null),
  topology_count: topologies.length,
  topologies,
};
await writeFile(join(outDir, "catalog.json"), JSON.stringify(catalog));
await writeFile(join(outDir, "summary.json"), JSON.stringify({ schema: "shell100k-summary-v1", count, unique_count: count, original_count: catalog.original_count, duplicate_count: catalog.duplicate_count, topology_count: topologies.length, vf_min: vfMin, vf_max: vfMax, bins }));
console.log(`Wrote ${topologies.length} topologies and ${count} variants to ${outDir}`);
