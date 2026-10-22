import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

const projectRoot = resolve("C:/Users/admin/Documents/ChatGPT/LatticeDataset");
const siteRoot = resolve(projectRoot, "truss-gallery");
const outputRoot = resolve(siteRoot, "dist/ppl-data");
await mkdir(outputRoot, { recursive: true });

// PPL variants are defined by a fixed skeleton plus plate parameters. Export
// only those parameters for the public preview; never copy the 100+ GB of
// temporary surface OBJ files into the static website.
const previewFields = [
  "id",
  "vf",
  "thickness",
  "orientation",
  "topology_id",
  "youngs_modulus",
  "thermal_diagonal_mean",
  "C_H_upper",
  "K_H_upper",
  "C_diag",
  "K_diag",
  "min_C",
  "min_K",
  "mechanical_residual",
  "thermal_residual",
  "boundary_faces",
  "solid_components",
  "properties_status",
  "symmetry",
  "generator",
  "plate_edges",
  "plate_template",
  "plate_overrides",
];
function previewRow(row) {
  const result = {};
  for (const key of previewFields) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  return result;
}

function compactPlateParameters(config) {
  const plates = Array.isArray(config.plates) ? config.plates : [];
  if (!plates.length) throw new Error("PPL sample has no plate parameters");
  const signature = (plate) => [
    String(plate.start || "midpoint"),
    Number(plate.thickness || 0),
    Number(plate.alpha || 0),
    Number(plate.beta || 0),
    Number(plate.normal_translation || 0),
  ];
  const template = signature(plates[0]);
  const overrides = [];
  for (let index = 1; index < plates.length; index++) {
    const values = signature(plates[index]);
    if (values.every((value, part) => value === template[part])) continue;
    overrides.push({ edge: index, values });
  }
  if (overrides.length) {
    // The public page can still reconstruct every plate, but retaining only
    // genuinely different per-edge settings keeps each variant shard compact.
    return { template, overrides };
  }
  return { template, overrides: [] };
}
const productionRoot = resolve(
  process.env.PPL_PRODUCTION_DIR ||
  "D:/yueze/LatticeDataset/Plate/generated/full100k_parts_20261020",
);
const trussCatalogPath = resolve(siteRoot, "dist/catalog.json");

await mkdir(outputRoot, { recursive: true });

const trussCatalog = JSON.parse(await readFile(trussCatalogPath, "utf8"));
const trussTopologies = new Map(
  trussCatalog.topologies.map((topology) => [topology.id, topology]),
);
const fullCellCache = new Map();

function pointKey(point) {
  return point.map((value) => Number(value).toFixed(8)).join(",");
}

function fullCellGraph(topology) {
  if (fullCellCache.has(topology.id)) return fullCellCache.get(topology.id);

  const nodeIds = new Map();
  const nodes = [];
  const edges = new Set();
  const nodeId = (point) => {
    const key = pointKey(point);
    if (!nodeIds.has(key)) {
      nodeIds.set(key, nodes.length);
      nodes.push(point.map(Number));
    }
    return nodeIds.get(key);
  };

  // ETH stores only the positive octant. The public Gallery must draw the
  // complete cell assembled by the three coordinate-plane reflections.
  const signs = topology.source === "eth"
    ? [-1, 1].flatMap((x) => [-1, 1].flatMap((y) =>
      [-1, 1].map((z) => [x, y, z])))
    : [[1, 1, 1]];
  for (const mirror of signs) {
    for (const [first, second] of topology.edges) {
      const point = (index) => topology.nodes[index].map(
        (value, axis) => Number(value) * mirror[axis],
      );
      const a = nodeId(point(first));
      const b = nodeId(point(second));
      if (a !== b) edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }

  const explicitEdges = [...edges].map((edge) => edge.split(":").map(Number));
  const graph = { nodes, edges: explicitEdges };
  fullCellCache.set(topology.id, graph);
  return graph;
}

async function walkJsonLines(path) {
  const exists = await stat(path).then(() => true, () => false);
  if (!exists) return [];
  const rows = [];
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

const partNames = (await readdir(productionRoot))
  .filter((name) => /^part_\d\d$/.test(name))
  .sort();

const samples = [];
const seenIds = new Set();
const seenCanonical = new Map();
const generatedCounts = [];
const binCounts = new Array(10).fill(0);
const failureReasons = new Map();
let attempted = 0;
let rejected = 0;
let duplicateCount = 0;
let unverifiedCount = 0;

function fineBin(value) {
  return Math.max(0, Math.min(299, Math.floor((Number(value) - 0.05) / 0.001)));
}

for (const partName of partNames) {
  const partRoot = join(productionRoot, partName);
  const sampleRoot = join(partRoot, "samples");
  const progressPath = join(partRoot, "progress.jsonl");
  const progress = await walkJsonLines(progressPath);
  const partAttempts = progress.length;
  const partRejected = progress.filter((row) => row.status !== "accepted").length;
  attempted += partAttempts;
  rejected += partRejected;
  for (const row of progress) {
    if (row.status !== "accepted") {
      const reason = row.error || (row.thickness_guesses ? "no_valid_thickness" : "candidate_rejected");
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
    }
  }

  let names = [];
  try {
    names = (await readdir(sampleRoot)).filter((name) => /^ppl_\d{6}\.json$/.test(name)).sort();
  } catch {
    generatedCounts.push({
      part: partName,
      generated: 0,
      attempted: partAttempts,
      verified: 0,
      properties: 0,
    });
    continue;
  }

  let partVerified = 0;
  let partProperties = 0;
  for (const name of names) {
    const localId = name.replace(/\.json$/, "");
    // Existing workers were started before partition-aware IDs were added, so
    // each part directory legitimately contains ppl_000001.json. The directory
    // is the partition namespace; expose a stable globally unique gallery ID.
    const id = name.match(/^ppl_\d\d_/) ? localId : `${partName}_${localId}`;
    if (seenIds.has(id)) continue;
    let config;
    try {
      config = JSON.parse(await readFile(join(sampleRoot, name), "utf8"));
    } catch {
      continue;
    }
    seenIds.add(id);
    const topology = trussTopologies.get(config.topology_id);
    if (!topology) continue;

    const vf = Number(config.vf_32_observed);
    const verifiedVf = Number(config.vf_32);
    const thickness = Number(config.plates?.[0]?.thickness ?? 0);
    const alpha = Number(config.plates?.[0]?.alpha ?? 0);
    const beta = Number(config.plates?.[0]?.beta ?? 0);
    const start = String(config.plates?.[0]?.start || "midpoint");
    let plateParameters;
    try {
      plateParameters = compactPlateParameters(config);
    } catch {
      continue;
    }
    const verified = Boolean(config.verified_32);
    if (!verified) unverifiedCount++;
    // A verified sidecar is the only record eligible for the property catalog.
    // Generated-but-unvalidated records remain visible in the progress numbers
    // but never masquerade as complete samples.
    if (!verified || !Number.isFinite(verifiedVf)) continue;
    const propertiesOk = config.properties?.status === "ok";
    if (!propertiesOk) continue;
    const credibleDirections = (config.properties?.youngs_modulus_directions || [])
      .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 10);
    if (!credibleDirections.length) continue;
    partVerified++;
    partProperties++;

    // Always retain the current generated record. Before the VTK audit writes
    // its canonical occupancy hash, no cross-file deduplication is asserted.
    const canonicalHash = config.voxel_canonical_sha256 || null;
    if (canonicalHash && seenCanonical.has(canonicalHash)) {
      duplicateCount++;
      continue;
    }
    if (canonicalHash) seenCanonical.set(canonicalHash, id);

    const vfIndex = Math.max(0, Math.min(9, Math.floor((verifiedVf - 0.05) / 0.03)));
    binCounts[vfIndex]++;
    samples.push({
      id,
      local_id: localId,
      part: partName,
      topology_id: config.topology_id,
      vf: verifiedVf,
      fine_vf_bin: fineBin(verifiedVf),
      thickness,
      orientation: { start, alpha, beta },
      source: config.source,
      verified_32: verified,
      voxel_canonical_sha256: canonicalHash,
      C_H_upper: config.properties?.C_H_upper || [],
      K_H_upper: config.properties?.K_H_upper || [],
      C_diag: config.properties?.C_diag || [],
      K_diag: config.properties?.K_diag || [],
      youngs_modulus: config.properties?.youngs_modulus ?? null,
      thermal_diagonal_mean: config.properties?.thermal_diagonal_mean ?? null,
      min_C: config.properties?.min_C ?? null,
      min_K: config.properties?.min_K ?? null,
      mechanical_residual: config.properties?.mechanical_residual ?? null,
      thermal_residual: config.properties?.thermal_residual ?? null,
      boundary_faces: config.checks?.boundary_faces || null,
      solid_components: config.checks?.solid_components ?? null,
      symmetric: config.checks?.symmetric ?? null,
      properties_status: config.properties?.status || "pending",
      symmetry: config.symmetry || (config.source === "panetta" ? "one_in_48" : "octet"),
      generator: config.topology?.generator || null,
      plate_edges:
        config.topology?.panetta_1_in_48_edges ||
        config.topology?.panetta_octet_edges ||
        [],
      plate_template: plateParameters.template,
      plate_overrides: plateParameters.overrides,
    });
  }
  generatedCounts.push({
    part: partName,
    generated: names.length,
    verified: partVerified,
    properties: partProperties,
  });
}

const groups = new Map();
for (const sample of samples) {
  if (!groups.has(sample.topology_id)) groups.set(sample.topology_id, []);
  groups.get(sample.topology_id).push(sample);
}

const topologyRows = [];
for (const [topologyId, variants] of groups) {
  const topology = trussTopologies.get(topologyId);
  const graph = fullCellGraph(topology);
  const points = graph.nodes;
  const edges = graph.edges;
  const degree = new Array(points.length).fill(0);
  for (const [a, b] of edges) {
    degree[a]++;
    degree[b]++;
  }
  const adjacency = Array.from({ length: points.length }, () => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const reached = new Set();
  if (points.length) {
    const queue = [0];
    reached.add(0);
    while (queue.length) {
      const node = queue.shift();
      for (const neighbor of adjacency[node]) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }
  const components = points.length ? 1 + Array.from({ length: points.length }, (_, i) => i)
    .filter((i) => !reached.has(i) && degree[i] > 0).length : 0;
  const cycles = Math.max(0, edges.length - points.length + Math.max(1, components));
  const orientedVariants = [...variants].sort((left, right) =>
    left.orientation.alpha - right.orientation.alpha ||
    left.orientation.beta - right.orientation.beta ||
    left.orientation.start.localeCompare(right.orientation.start));
  const orientationGroups = [];
  const orientationMap = new Map();
  for (const sample of orientedVariants) {
    const key = `${sample.orientation.start}|${sample.orientation.alpha.toFixed(8)}|${sample.orientation.beta.toFixed(8)}`;
    if (!orientationMap.has(key)) {
      const group = { key, start: sample.orientation.start, alpha: sample.orientation.alpha, beta: sample.orientation.beta, variants: [] };
      orientationMap.set(key, group);
      orientationGroups.push(group);
    }
    orientationMap.get(key).variants.push(sample);
  }
  orientationGroups.sort((left, right) =>
    left.start.localeCompare(right.start) || left.alpha - right.alpha || left.beta - right.beta);
  const variantRows = [];
  for (const orientation of orientationGroups) {
    orientation.variants.sort((left, right) => left.vf - right.vf || left.thickness - right.thickness || left.id.localeCompare(right.id));
    for (const sample of orientation.variants) {
      variantRows.push({
        ...sample,
        orientation_key: orientation.key,
        orientation_name: `${orientation.start} / α${orientation.alpha.toFixed(3)} / β${orientation.beta.toFixed(3)}`,
      });
    }
  }
  const shardName = `topology-${topologyId}.json`;
  await writeFile(join(outputRoot, shardName), JSON.stringify({
    schema: "ppl100k-variants-v1",
    topology_id: topologyId,
    variants: variantRows.map(previewRow),
  }));
  topologyRows.push({
    id: topologyId,
    name: null,
    source_id: topologyId,
    source: topology.source,
    points,
    edges,
    nodes: points.length,
    members: edges.length,
    cycle_rank: cycles,
    symmetry: topology.source === "panetta" ? "1/48 Symmetry" : "1/8 Reflection",
    variants: variantRows.length,
    orientations: orientationGroups.length,
    variant_shard: shardName,
    min_vf: variantRows.length ? Math.min(...variantRows.map((row) => row.vf)) : null,
    max_vf: variantRows.length ? Math.max(...variantRows.map((row) => row.vf)) : null,
  });
}

topologyRows.sort((left, right) =>
  left.members - right.members ||
  left.nodes - right.nodes ||
  left.cycle_rank - right.cycle_rank ||
  left.source_id.localeCompare(right.source_id));
topologyRows.forEach((topology, index) => {
  topology.rank = index + 1;
  topology.name = `Plate T-${String(index + 1).padStart(4, "0")}`;
});

const empiricalEdges = Array.from({ length: 300 }, () => null);
for (const sample of samples) {
  const index = sample.fine_vf_bin;
  if (empiricalEdges[index] == null || sample.vf < empiricalEdges[index]) empiricalEdges[index] = sample.vf;
}
const catalog = {
  schema: "ppl100k-catalog-v1",
  count: samples.length,
  unique_count: samples.length,
  candidate_count: attempted,
  rejected_count: rejected,
  duplicate_count: duplicateCount,
  unverified_count: unverifiedCount,
  property_count: samples.filter((row) => row.properties_status === "ok").length,
  generated_count: generatedCounts.reduce((sum, part) => sum + part.generated, 0),
  verified_count: generatedCounts.reduce((sum, part) => sum + part.verified, 0),
  topology_count: topologyRows.length,
  vf_bin_counts: binCounts,
  empirical_fine_edges: empiricalEdges,
  failure_reasons: Object.fromEntries(failureReasons),
  topologies: topologyRows,
};

// The detail page fetches a topology's shard only when it is opened. Keeping
// the 2k+ full-cell skeletons out of the first request makes the 100k catalog
// responsive while preserving complete geometry for every top-level card.
const catalogSummary = {
  ...catalog,
  topologies: topologyRows.map((topology) => {
    const { points, edges, ...summary } = topology;
    return summary;
  }),
};
await writeFile(join(outputRoot, "catalog.json"), JSON.stringify(catalogSummary));
await writeFile(join(outputRoot, "topology-geometries.json"), JSON.stringify({
  schema: "ppl100k-topology-geometries-v1",
  topologies: topologyRows.map(({ id, points, edges }) => ({ id, points, edges })),
}));
await writeFile(join(outputRoot, "completion-status.json"), JSON.stringify({
  schema: "ppl100k-completion-v1",
  phase: samples.length >= 100000 ? "count_reached_pending_validation" : "generating",
  target: 100000,
  unique_count: samples.length,
  candidate_count: attempted,
  rejected_count: rejected,
  topology_count: topologyRows.length,
  vf_bin_counts: binCounts,
  empty_fine_bins: empiricalEdges.map((value, index) => value == null ? index : null).filter((value) => value != null),
  parts: generatedCounts,
  generated_at: new Date().toISOString(),
}, null, 2) + "\n");

console.log(JSON.stringify({
  samples: samples.length,
  topologies: topologyRows.length,
  attempts: attempted,
  rejected,
  unverified: unverifiedCount,
  bins: binCounts,
}, null, 2));
